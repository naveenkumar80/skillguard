"""Strict Phase 1 protocol, with schema resolution restricted to bundled resources."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path
from typing import Any, BinaryIO, Literal, NoReturn, NotRequired, TypedDict, cast

from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from skillguard_engine import __version__

PROTOCOL_VERSION = "1.0"
MAX_REQUEST_BYTES = 4 * 1024 * 1024
_SCHEMA_NAMES = ("finding", "engine-request", "engine-response")


class InputFile(TypedDict):
    path: str
    content: str


class EvaluationSettings(TypedDict):
    enabled: Literal[True]
    consent: Literal[True]
    provider: Literal["openai"]
    model: str
    maxCostUsd: float
    inputPricePerMillion: float
    outputPricePerMillion: float
    maxOutputTokens: int
    maxInputBytes: int
    timeoutMs: int
    maxRetries: int


class EngineRequest(TypedDict):
    protocolVersion: str
    command: str
    files: list[InputFile]
    evaluation: NotRequired[EvaluationSettings]


class ProtocolError(Exception):
    """An error with a fixed, content-independent public message."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@lru_cache(maxsize=1)
def _validators() -> tuple[Draft202012Validator, Draft202012Validator]:
    schema_root = files("skillguard_engine.protocol").joinpath("schema")
    if not schema_root.is_dir():
        # Hatch editable installs import source code but force-include data in site-packages.
        schema_root = Path(
            str(distribution("skillguard-engine").locate_file("skillguard_engine/protocol/schema"))
        )
    schemas: dict[str, dict[str, Any]] = {}
    resources: list[tuple[str, Resource[Any]]] = []
    for name in _SCHEMA_NAMES:
        schema = json.loads(schema_root.joinpath(f"{name}.schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        schemas[name] = schema
        resources.append((schema["$id"], DRAFT202012.create_resource(schema)))
        # Registry's default retriever fails closed; it never opens URI targets.
        registry: Registry[Any] = Registry().with_resources(resources)
    return (
        Draft202012Validator(schemas["engine-request"], registry=registry),
        Draft202012Validator(schemas["engine-response"], registry=registry),
    )


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("INVALID_JSON", "Request JSON contains duplicate object keys")
        result[key] = value
    return result


def _reject_constant(value: str) -> NoReturn:
    raise ProtocolError("INVALID_JSON", "Request JSON must not contain non-finite numbers")


def _finite_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        _reject_constant(value)
    return result


def validate_request(value: object) -> EngineRequest:
    if (
        isinstance(value, dict)
        and "protocolVersion" in value
        and value["protocolVersion"] != PROTOCOL_VERSION
    ):
        raise ProtocolError("UNSUPPORTED_PROTOCOL", "Unsupported protocol version")
    request_validator, _ = _validators()
    try:
        request_validator.validate(value)
    except ValidationError:
        # ValidationError text can contain the entire instance, including skill content.
        raise ProtocolError("INVALID_REQUEST", "Request does not match protocol schema") from None
    request = cast(EngineRequest, value)
    if "evaluation" in request:
        settings = request["evaluation"]
        for name in ("maxCostUsd", "inputPricePerMillion", "outputPricePerMillion"):
            if not math.isfinite(cast(dict[str, Any], settings)[name]):
                raise ProtocolError("INVALID_REQUEST", "Request does not match protocol schema")
        for name in ("maxOutputTokens", "maxInputBytes", "timeoutMs", "maxRetries"):
            if type(cast(dict[str, Any], settings)[name]) is not int:
                raise ProtocolError("INVALID_REQUEST", "Request does not match protocol schema")
        if any(char in cast(dict[str, Any], settings).get("model", "") for char in ("\n", "\r")):
            raise ProtocolError("INVALID_REQUEST", "Request does not match protocol schema")
    paths = [file["path"] for file in request["files"]]
    if len(set(paths)) != len(paths):
        raise ProtocolError("INVALID_REQUEST", "Request file paths must be unique")
    return request


def read_request(stream: BinaryIO) -> EngineRequest:
    raw = stream.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("REQUEST_TOO_LARGE", "Request exceeds the 4 MiB input limit")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise ProtocolError("INVALID_ENCODING", "Request must be encoded as valid UTF-8") from None
    try:
        value: object = json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
        )
    except ValueError:
        raise ProtocolError("INVALID_JSON", "Request must be one strict JSON document") from None
    return validate_request(value)


def handle_request(request: EngineRequest) -> dict[str, Any]:
    from skillguard_engine.security import enforce_response_budget, load_catalog, scan

    if request["command"] not in ("doctor", "scan", "evaluate"):
        raise ProtocolError("INVALID_REQUEST", "Unsupported engine command")
    response: dict[str, Any] = {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": True,
        "findings": scan(request["files"]) if request["command"] == "scan" else [],
        "engine": {
            "version": __version__,
            "capabilities": ["doctor", "scan", "evaluate"],
            "ruleSetVersion": load_catalog().version,
        },
    }
    if request["command"] == "evaluate":
        from skillguard_engine.ai import evaluate

        response["findings"], response["evaluation"] = evaluate(request)
    enforce_response_budget(response)
    return response


def error_response(error: ProtocolError) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "ok": False,
        "findings": [],
        "error": {
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
        },
    }


def validate_response(response: object) -> None:
    _, response_validator = _validators()
    response_validator.validate(response)
