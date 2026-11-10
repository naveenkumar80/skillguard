"""Offline declaration indicators from supplied JSON/requirements text, never paths."""

from __future__ import annotations

import json
import re
from bisect import bisect_right
from collections.abc import Iterator
from typing import NoReturn

from skillguard_engine.protocol import ProtocolError

DECLARATION_RULE_ID = "SG-SEC-014"
MAX_JSON_DEPTH = 32
MAX_DECLARATION_CHARS = 262144
MAX_REQUIREMENT_LINE = 4096
_SECTIONS = frozenset(
    {"dependencies", "devDependencies", "optionalDependencies", "peerDependencies"}
)
_JSON_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^"\s{}\[\]:,]+')
_NPM_NAME = re.compile(r"(?:@[A-Za-z0-9][A-Za-z0-9._~-]{0,63}/)?[A-Za-z0-9][A-Za-z0-9._~-]{0,127}")
_NUMBER = re.compile(r"0|[1-9][0-9]{0,15}")
_SEMVER_IDENTIFIER = re.compile(r"[A-Za-z0-9-]{1,64}")
_REMOTE = re.compile(r"(?:[A-Za-z][A-Za-z0-9+.-]{0,31}://|git@|github:|gitlab:|bitbucket:)")
_NAME_EXTRAS = re.compile(
    r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?"
    r"(?:\[[ \t]*[A-Za-z0-9][A-Za-z0-9._-]{0,63}[ \t]*"
    r"(?:,[ \t]*[A-Za-z0-9][A-Za-z0-9._-]{0,63}[ \t]*){0,15}\])?"
)
_VERSION_CLAUSE = re.compile(r"(===|==|~=|!=|<=|>=|<|>)[ \t]*([A-Za-z0-9][A-Za-z0-9.*!+_-]{0,127})")
_PY_PIN = re.compile(
    r"v?[0-9]{1,16}(?:![0-9]{1,16})?(?:\.[0-9]{1,16}){0,15}"
    r"(?:(?:a|b|rc)[0-9]{1,16})?(?:[.-]?post[0-9]{1,16})?"
    r"(?:[.-]?dev[0-9]{1,16})?(?:\+[A-Za-z0-9]{1,64}(?:[._-][A-Za-z0-9]{1,64}){0,15})?",
    re.IGNORECASE,
)
_MARKER_TOKEN = re.compile(
    r""""[^"\\\r\n]{0,128}"|'[^'\\\r\n]{0,128}'|[a-z_][a-z_0-9]{0,63}|===|==|!=|<=|>=|~=|<|>|\(|\)"""
)
_MARKER_NAMES = frozenset(
    {
        "python_version",
        "python_full_version",
        "os_name",
        "sys_platform",
        "platform_release",
        "platform_system",
        "platform_version",
        "platform_machine",
        "platform_python_implementation",
        "implementation_name",
        "implementation_version",
        "extra",
        "extras",
        "dependency_groups",
    }
)
_HASHES = re.compile(r"(?:[ \t]+--hash=[A-Za-z0-9_-]{1,32}:[A-Fa-f0-9]{1,256}){1,16}")


def _invalid() -> NoReturn:
    raise ProtocolError(
        "INVALID_DEPENDENCY_DECLARATION",
        "Dependency declaration is malformed or unsupported; "
        "review package.json or requirements text",
    ) from None


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _invalid()
        result[key] = value
    return result


def _reject_constant(value: str) -> NoReturn:
    _invalid()


def _check_json_depth(content: str) -> None:
    depth = 0
    quoted = escaped = False
    for character in content:
        if quoted:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
        elif character in "{[":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ProtocolError("RESOURCE_LIMIT", "Dependency JSON exceeds the nesting limit")
        elif character in "}]":
            depth -= 1


def _local(value: str) -> bool:
    if value.lower().startswith(("workspace:", "file:", "link:")):
        if not value.partition(":")[2].strip():
            _invalid()
        return True
    return value.startswith(("./", "../", "/", "\\")) or (
        re.match(r"[A-Za-z]:[/\\]", value) is not None
    )


def _exact_npm(value: str) -> bool:
    if len(value) > 256:
        return False
    main, plus, build = value.partition("+")
    core, dash, prerelease = main.partition("-")
    parts = core.split(".")
    if len(parts) != 3 or not all(_NUMBER.fullmatch(part) for part in parts):
        return False
    for suffix, present, numeric_leading_zero in ((prerelease, dash, True), (build, plus, False)):
        if present:
            identifiers = suffix.split(".")
            if len(identifiers) > 16 or not all(
                _SEMVER_IDENTIFIER.fullmatch(part) for part in identifiers
            ):
                return False
            if numeric_leading_zero and any(
                part.isascii() and part.isdigit() and len(part) > 1 and part.startswith("0")
                for part in identifiers
            ):
                return False
    return True


def _package_locations(content: str) -> Iterator[tuple[int, int]]:
    _check_json_depth(content)
    try:
        # Numeric fields are irrelevant. Do not materialize attacker-sized integers/floats.
        document: object = json.loads(
            content,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_int=lambda value: None,
            parse_float=lambda value: None,
        )
    except (ValueError, RecursionError, OverflowError):
        _invalid()
    if not isinstance(document, dict):
        _invalid()
    for section in _SECTIONS:
        if section not in document:
            continue
        dependencies = document[section]
        if not isinstance(dependencies, dict):
            _invalid()
        for name, version in dependencies.items():
            if not _NPM_NAME.fullmatch(name) or not isinstance(version, str):
                _invalid()

    # Locate only values directly in supported top-level sections. JSON validation above
    # makes this a structural token walk, not a search for decoy field names in strings.
    depth = 0
    section_name = ""
    previous = ""
    starts = [0]
    offset = 0
    for segment in content.splitlines(keepends=True):
        offset += len(segment)
        if offset < len(content):
            starts.append(offset)
    seen_lines: set[int] = set()
    for token in _JSON_TOKEN.finditer(content):
        raw = token[0]
        if raw in ("{", "["):
            depth += 1
        elif raw in ("}", "]"):
            depth -= 1
        elif depth == 1 and raw.startswith('"') and previous in ("{", ","):
            section_name = json.loads(raw)
        elif depth == 2 and section_name in _SECTIONS and previous == ":" and raw.startswith('"'):
            value = json.loads(raw).strip()
            index = bisect_right(starts, token.start()) - 1
            if not _local(value) and not _exact_npm(value) and index not in seen_lines:
                seen_lines.add(index)
                yield index + 1, token.start() - starts[index] + 1
        previous = raw


def _without_comment(line: str) -> str:
    quote = ""
    for index, character in enumerate(line):
        if quote:
            if character == quote:
                quote = ""
        elif character in "'\"":
            quote = character
        elif character == "#" and (index == 0 or line[index - 1].isspace()):
            return line[:index]
    return line


def _check_marker(marker: str) -> None:
    tokens: list[str] = []
    offset = 0
    while offset < len(marker):
        if marker[offset] in " \t":
            offset += 1
            continue
        token = _MARKER_TOKEN.match(marker, offset)
        if token is None:
            _invalid()
        tokens.append(token[0])
        offset = token.end()
    state = depth = 0
    index = 0
    while index < len(tokens):
        token_text = tokens[index]
        operand = token_text.startswith(("'", '"')) or token_text in _MARKER_NAMES
        if state == 0 and token_text == "(":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                _invalid()
        elif state in (0, 2) and operand:
            state += 1
        elif state == 1 and token_text in ("===", "==", "!=", "<=", ">=", "~=", "<", ">", "in"):
            state = 2
        elif state == 1 and token_text == "not" and tokens[index + 1 : index + 2] == ["in"]:
            state = 2
            index += 1
        elif state == 3 and token_text in ("and", "or"):
            state = 0
        elif state == 3 and token_text == ")" and depth:
            depth -= 1
        else:
            _invalid()
        index += 1
    if state != 3 or depth:
        _invalid()


def _requirement_unpinned(text: str) -> bool:
    requirement, separator, marker = text.partition(";")
    if separator:
        _check_marker(marker.strip())
    requirement = requirement.strip()
    if requirement.startswith(("-e ", "--editable ")):
        requirement = requirement.split(maxsplit=1)[1].strip()
        if not requirement:
            _invalid()
    if _local(requirement):
        return False
    if _REMOTE.match(requirement):
        if any(character.isspace() for character in requirement):
            _invalid()
        return True
    name = _NAME_EXTRAS.match(requirement)
    if name is None:
        _invalid()
    specifier = requirement[name.end() :].strip()
    if specifier.startswith("@"):
        reference = specifier[1:].strip()
        if not reference or any(character.isspace() for character in reference):
            _invalid()
        if _local(reference):
            return False
        if not _REMOTE.match(reference):
            _invalid()
        return True
    if not specifier:
        return True
    if specifier.startswith("(") and specifier.endswith(")"):
        specifier = specifier[1:-1].strip()
    # Support same-line pip hashes, without treating hashes as evidence of safety.
    hash_start = re.search(r"[ \t]+--hash", specifier)
    if hash_start:
        if not _HASHES.fullmatch(specifier[hash_start.start() :]):
            _invalid()
        specifier = specifier[: hash_start.start()]
    clauses = specifier.split(",")
    if len(clauses) > 16:
        _invalid()
    parsed = [_VERSION_CLAUSE.fullmatch(clause.strip()) for clause in clauses]
    if not all(parsed):
        _invalid()
    pin = parsed[0]
    return not (
        len(parsed) == 1 and pin is not None and pin[1] == "==" and _PY_PIN.fullmatch(pin[2])
    )


def declaration_locations(path: str, content: str) -> Iterator[tuple[int, int]]:
    """Yield at most one advisory per supported physical declaration line."""
    name = path.rsplit("/", 1)[-1].lower()
    package = name == "package.json"
    requirements = name.startswith("requirements") and name.endswith(".txt")
    if not package and not requirements:
        return
    if len(content) > MAX_DECLARATION_CHARS:
        raise ProtocolError("RESOURCE_LIMIT", "Dependency text exceeds the character limit")
    if package:
        yield from _package_locations(content)
    else:
        for number, line in enumerate(content.splitlines(), start=1):
            declaration = _without_comment(line).strip()
            if not declaration:
                continue
            if len(declaration) > MAX_REQUIREMENT_LINE or declaration.endswith("\\"):
                _invalid()
            if _requirement_unpinned(declaration):
                yield number, len(line) - len(line.lstrip()) + 1
