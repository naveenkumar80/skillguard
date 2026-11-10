"""Protocol contract, static scan, hostile-input, and subprocess regression tests."""

from __future__ import annotations

import io
import json
import socket
import subprocess
import sys
from importlib.metadata import distribution
from pathlib import Path
from typing import Any, cast

import pytest
from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012

from skillguard_engine import __main__ as entry
from skillguard_engine import protocol

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "packages" / "protocol" / "fixtures"
SCHEMAS = ROOT / "packages" / "protocol" / "schema"
SECRET = "PRIVATE_SKILL_CONTENT_DO_NOT_ECHO"


def _fixture(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((FIXTURES / name).read_text(encoding="utf-8")))


def _encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
        "utf-8"
    )


def _request(command: str = "scan", files: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"protocolVersion": "1.0", "command": command, "files": files or []}


@pytest.fixture(scope="module")
def canonical_response_validator() -> Draft202012Validator:
    schemas = [
        json.loads(path.read_text(encoding="utf-8")) for path in sorted(SCHEMAS.glob("*.json"))
    ]
    registry: Registry[Any] = Registry().with_resources(
        (schema["$id"], DRAFT202012.create_resource(schema)) for schema in schemas
    )
    schema = next(schema for schema in schemas if schema["title"] == "Engine response v1.0")
    return Draft202012Validator(schema, registry=registry)


@pytest.fixture
def invoke(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    canonical_response_validator: Draft202012Validator,
) -> Any:
    def run(payload: bytes) -> tuple[dict[str, Any], int, str]:
        monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(payload), encoding="utf-8"))
        code = entry.main()
        captured = capsys.readouterr()
        assert captured.out.count("\n") == 1
        response = cast(dict[str, Any], json.loads(captured.out))
        canonical_response_validator.validate(response)
        assert SECRET not in captured.out + captured.err
        assert "Traceback" not in captured.out + captured.err
        assert code == (0 if response["ok"] else 3)
        if code:
            assert captured.err == f"skillguard-engine: {response['error']['code']}\n"
            assert response["findings"] == []
            assert response["error"]["retryable"] is False
        else:
            assert captured.err == ""
        return response, code, captured.err

    return run


def test_doctor_exact_shared_golden(invoke: Any) -> None:
    response, code, _ = invoke((FIXTURES / "doctor-request.json").read_bytes())
    assert code == 0
    assert response == _fixture("doctor-response.json")


def test_schema_error_exact_shared_golden(invoke: Any) -> None:
    response, _, _ = invoke(_encode({**_request("doctor"), "unexpected": SECRET}))
    assert response == _fixture("error-response.json")


def test_shared_golden_responses_validate(
    canonical_response_validator: Draft202012Validator,
) -> None:
    for name in ("doctor-response.json", "error-response.json"):
        response = _fixture(name)
        canonical_response_validator.validate(response)
        protocol.validate_response(response)


@pytest.mark.parametrize("files", [[], [{"path": "missing/SKILL.md", "content": SECRET}]])
def test_scan_succeeds_without_reading_paths(invoke: Any, files: list[dict[str, str]]) -> None:
    response, code, _ = invoke(_encode(_request(files=files)))
    assert code == 0
    assert response["findings"] == []
    assert response["engine"]["capabilities"] == ["doctor", "scan", "evaluate"]
    assert response["engine"]["ruleSetVersion"] == "1.0.0"


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (b"", "INVALID_JSON"),
        (b"   ", "INVALID_JSON"),
        (b'{"protocolVersion":', "INVALID_JSON"),
        (b"{} {}", "INVALID_JSON"),
        (b"{} " + SECRET.encode(), "INVALID_JSON"),
        (b'{"files":[],}', "INVALID_JSON"),
        (b"// comment\n{}", "INVALID_JSON"),
        (b'{"x":"raw\nnewline"}', "INVALID_JSON"),
        (b"\xef\xbb\xbf{}", "INVALID_JSON"),
        (b'{"x":NaN}', "INVALID_JSON"),
        (b'{"x":Infinity}', "INVALID_JSON"),
        (b'{"x":-Infinity}', "INVALID_JSON"),
        (b'{"x":1e9999}', "INVALID_JSON"),
        (b'{"x":-1e9999}', "INVALID_JSON"),
        (b'{"x":' + b"9" * 10000 + b"}", "INVALID_JSON"),
        (b'{"command":"scan","command":"doctor"}', "INVALID_JSON"),
        (b'{"x":{"path":"a","path":"b"}}', "INVALID_JSON"),
        (b'{"files":[],"f\\u0069les":[]}', "INVALID_JSON"),
        (b'"\xff"', "INVALID_ENCODING"),
        (b'"\xc0\xaf"', "INVALID_ENCODING"),
        (b'"\xed\xa0\x80"', "INVALID_ENCODING"),
        (b'"\xf0\x9f"', "INVALID_ENCODING"),
        (b"[" * 2000 + b"0" + b"]" * 2000, "RESOURCE_LIMIT"),
    ],
)
def test_strict_json_and_encoding(invoke: Any, payload: bytes, expected: str) -> None:
    response, _, _ = invoke(payload)
    assert response["error"]["code"] == expected


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        True,
        1,
        SECRET,
        {},
        {"protocolVersion": "1.0", "command": "doctor"},
        {"command": "doctor", "files": []},
        {"protocolVersion": "1.0", "files": []},
        _request("unknown"),
        {**_request(), "command": False},
        {**_request(), "files": None},
        {**_request(), "files": {}},
        {**_request(), "files": [None]},
        {**_request(), "files": [{"path": "SKILL.md"}]},
        {**_request(), "files": [{"content": SECRET}]},
        {**_request(), "files": [{"path": "SKILL.md", "content": 42}]},
        {**_request(), "files": [{"path": 42, "content": SECRET}]},
        {**_request(), "files": [{"path": "SKILL.md", "content": SECRET, "extra": True}]},
        {**_request(), "$ref": "https://invalid.example/schema.json"},
        {**_request(), "options": {"content": SECRET}},
        _request("doctor", [{"path": "SKILL.md", "content": SECRET}]),
        _request(files=[{"path": "SKILL.md", "content": SECRET}] * 2),
    ],
)
def test_rejects_invalid_contracts(invoke: Any, value: object) -> None:
    response, _, _ = invoke(_encode(value))
    assert response["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("version", ["0.9", "1.1", "2.0", "1", 1, None, False, {}])
def test_rejects_unsupported_versions(invoke: Any, version: object) -> None:
    response, _, _ = invoke(_encode({**_request("doctor"), "protocolVersion": version}))
    assert response["error"]["code"] == "UNSUPPORTED_PROTOCOL"


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/absolute",
        "../SKILL.md",
        "a/../b",
        "./a",
        "a/./b",
        "a//b",
        "a\\b",
        "C:/SKILL.md",
        "a:b",
        "a\x00b",
        "a\nb",
        "a\x1fb",
        "a/..",
        "a/.",
        "a" * 513,
    ],
)
def test_rejects_unsafe_or_oversized_paths(invoke: Any, path: str) -> None:
    response, _, _ = invoke(_encode(_request(files=[{"path": path, "content": SECRET}])))
    assert response["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("length", [1, 511, 512])
def test_path_length_boundaries(invoke: Any, length: int) -> None:
    response, _, _ = invoke(_encode(_request(files=[{"path": "a" * length, "content": ""}])))
    assert response["ok"] is True
    assert response["findings"] == []


@pytest.mark.parametrize("length", [0, 262143, 262144, 262145])
@pytest.mark.parametrize("character", ["x", "\U0001f6e1"])
def test_content_character_boundaries(invoke: Any, length: int, character: str) -> None:
    payload = _encode(_request(files=[{"path": "SKILL.md", "content": character * length}]))
    assert len(payload) < protocol.MAX_REQUEST_BYTES
    response, _, _ = invoke(payload)
    if length <= 262144:
        assert response["ok"] is True
        assert response["findings"] == []
    else:
        assert response["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("count", [999, 1000, 1001])
def test_file_count_boundaries(invoke: Any, count: int) -> None:
    files = [{"path": f"skills/{index}/SKILL.md", "content": ""} for index in range(count)]
    response, _, _ = invoke(_encode(_request(files=files)))
    if count <= 1000:
        assert response["ok"] is True
        assert response["findings"] == []
    else:
        assert response["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("size", [protocol.MAX_REQUEST_BYTES - 1, protocol.MAX_REQUEST_BYTES])
def test_input_byte_limit_is_inclusive(invoke: Any, size: int) -> None:
    payload = _encode(_request("doctor"))
    response, code, _ = invoke(payload + b" " * (size - len(payload)))
    assert code == 0
    assert response == _fixture("doctor-response.json")


@pytest.mark.parametrize("extra", [1, 100])
def test_input_over_byte_limit(invoke: Any, extra: int) -> None:
    response, _, _ = invoke(b" " * (protocol.MAX_REQUEST_BYTES + extra))
    assert response["error"]["code"] == "REQUEST_TOO_LARGE"


def test_stdin_read_is_bounded_to_max_plus_one() -> None:
    class RecordingStream(io.BytesIO):
        def read(self, size: int | None = -1) -> bytes:
            assert size == protocol.MAX_REQUEST_BYTES + 1
            return super().read(size)

    stream = RecordingStream(b" " * (protocol.MAX_REQUEST_BYTES + 100))
    with pytest.raises(protocol.ProtocolError, match="4 MiB"):
        protocol.read_request(stream)
    assert stream.tell() == protocol.MAX_REQUEST_BYTES + 1


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (RecursionError(SECRET), "RESOURCE_LIMIT"),
        (MemoryError(SECRET), "RESOURCE_LIMIT"),
        (OverflowError(SECRET), "RESOURCE_LIMIT"),
        (OSError(SECRET), "INTERNAL_ERROR"),
        (RuntimeError(SECRET), "INTERNAL_ERROR"),
    ],
)
def test_runtime_failures_are_safe(
    invoke: Any, monkeypatch: pytest.MonkeyPatch, error: Exception, expected: str
) -> None:
    def fail(stream: Any) -> protocol.EngineRequest:
        raise error

    monkeypatch.setattr(entry, "read_request", fail)
    response, _, _ = invoke(_encode(_request("doctor")))
    assert response["error"]["code"] == expected


def test_emitted_response_is_validated(invoke: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def invalid_response(request: protocol.EngineRequest) -> dict[str, Any]:
        return {"protocolVersion": "1.0", "ok": True, "findings": [], "secret": SECRET}

    monkeypatch.setattr(entry, "handle_request", invalid_response)
    calls: list[object] = []

    def validate(response: object) -> None:
        calls.append(response)
        protocol.validate_response(response)

    monkeypatch.setattr(entry, "validate_response", validate)
    response, _, _ = invoke(_encode(_request("doctor")))
    assert response["error"]["code"] == "INTERNAL_ERROR"
    assert len(calls) == 2
    assert calls[-1] == response


@pytest.mark.parametrize(
    "error", [FileNotFoundError(SECRET), RecursionError(SECRET), MemoryError(SECRET)]
)
def test_schema_loading_failure_is_safe(
    invoke: Any, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def fail() -> None:
        raise error

    monkeypatch.setattr(protocol, "_validators", fail)
    response, _, _ = invoke(_encode(_request("doctor")))
    expected = (
        "RESOURCE_LIMIT" if isinstance(error, (RecursionError, MemoryError)) else "INTERNAL_ERROR"
    )
    assert response["error"]["code"] == expected


def test_skill_content_is_never_executed(invoke: Any, tmp_path: Path) -> None:
    marker = tmp_path / "executed"
    content = f"__import__('pathlib').Path({str(marker)!r}).write_text('executed')\n"
    response, _, _ = invoke(_encode(_request(files=[{"path": "absent.py", "content": content}])))
    assert response["ok"] is True
    assert response["findings"] == []
    assert not marker.exists()


def test_bundled_schemas_are_canonical() -> None:
    bundled = Path(
        str(distribution("skillguard-engine").locate_file("skillguard_engine/protocol/schema"))
    )
    assert {path.name for path in bundled.iterdir()} == {
        path.name for path in SCHEMAS.glob("*.json")
    }
    for path in SCHEMAS.glob("*.json"):
        assert bundled.joinpath(path.name).read_bytes() == path.read_bytes()


@pytest.mark.parametrize(
    "uri", ["https://invalid.example/schema.json", "file:///secret.json", "urn:unknown"]
)
def test_schema_registry_never_retrieves_external_resources(
    monkeypatch: pytest.MonkeyPatch, uri: str
) -> None:
    def forbid_network(*args: Any, **kwargs: Any) -> Any:
        pytest.fail("Schema resolution must not access the network")

    monkeypatch.setattr(socket, "create_connection", forbid_network)
    validator, _ = protocol._validators()
    external = validator.evolve(schema={"$ref": uri})
    with pytest.raises(Unresolvable):
        external.validate({})


def test_bundled_response_validator_resolves_finding_schema() -> None:
    response = _fixture("doctor-response.json")
    response["findings"] = [
        {
            "schemaVersion": "1.0",
            "ruleId": "SG-TEST-001",
            "title": "Test finding",
            "category": "security",
            "severity": "high",
            "confidence": "high",
            "path": "SKILL.md",
            "line": 1,
            "column": 1,
            "message": "Test message",
            "evidence": {"redacted": True, "excerpt": "[REDACTED]"},
            "remediation": "Test remediation",
            "references": [],
        }
    ]
    protocol.validate_response(response)
    response["findings"][0]["path"] = "../escape"
    with pytest.raises(ValidationError):
        protocol.validate_response(response)


@pytest.mark.parametrize(
    ("payload", "expected", "code"),
    [
        (_encode(_request("doctor")), None, 0),
        (_encode(_request()), None, 0),
        (b'"\xff"', "INVALID_ENCODING", 3),
        (b'{"files":[],"files":[]}', "INVALID_JSON", 3),
        (b"[" * 2000 + b"0" + b"]" * 2000, "RESOURCE_LIMIT", 3),
        (b" " * (protocol.MAX_REQUEST_BYTES + 1), "REQUEST_TOO_LARGE", 3),
    ],
)
def test_subprocess_smoke_from_unrelated_cwd(
    tmp_path: Path,
    canonical_response_validator: Draft202012Validator,
    payload: bytes,
    expected: str | None,
    code: int,
) -> None:
    result = subprocess.run(
        [sys.executable, "-I", "-m", "skillguard_engine"],
        input=payload,
        capture_output=True,
        cwd=tmp_path,
        timeout=20,
        check=False,
    )
    assert result.returncode == code
    stdout = result.stdout.decode("utf-8")
    stderr = result.stderr.decode("utf-8")
    assert len(stdout.splitlines()) == 1
    response = json.loads(stdout)
    canonical_response_validator.validate(response)
    assert "Traceback" not in stderr
    if expected is None:
        # Doctor and empty scan share success metadata; parent owns the shared golden.
        assert response == _fixture("doctor-response.json")
        assert stdout.strip() == json.dumps(
            _fixture("doctor-response.json"), ensure_ascii=True, separators=(",", ":")
        )
        assert stderr == ""
    else:
        assert response["error"]["code"] == expected
        assert stderr.splitlines() == [f"skillguard-engine: {expected}"]
