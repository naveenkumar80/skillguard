"""Fixed, bounded lexical detectors. No parsing, decoding, execution, or user regexes."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Detector:
    rule_id: str
    pattern: re.Pattern[str]
    contextual: bool = False


def _pattern(source: str, *, case_sensitive: bool = False) -> re.Pattern[str]:
    return re.compile(source, 0 if case_sensitive else re.IGNORECASE)


DETECTORS = (
    Detector(
        "SG-SEC-001",
        _pattern(
            r"(?<!\w)(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})(?!\w)",
            case_sensitive=True,
        ),
    ),
    Detector(
        "SG-SEC-002",
        _pattern(
            r"(?<!\w)(?:AKIA|ASIA)[A-Z0-9]{16}(?!\w)",
            case_sensitive=True,
        ),
    ),
    Detector(
        "SG-SEC-003",
        _pattern(
            r"(?<!-)-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?!-)",
            case_sensitive=True,
        ),
    ),
    Detector(
        "SG-SEC-004",
        _pattern(
            r"(?<!\w)(?P<key_quote>['\"]?)(?:password|passwd|api[_-]?key|client[_-]?secret|"
            r"access[_-]?token|secret[_-]?key)(?P=key_quote)[ \t]{0,8}[:=][ \t]{0,8}"
            r"(?P<quote>['\"])(?P<value>[^'\"\s]{8,256})(?P=quote)",
        ),
    ),
    Detector(
        "SG-SEC-005",
        _pattern(
            r"(?<![\w+.-])(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|mssql)://"
            r"[^\s:/@]{1,64}:(?P<password>[^\s/@:]{1,128})@"
            r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?=[:/\s'\";]|$)",
        ),
    ),
    Detector(
        "SG-SEC-006",
        _pattern(
            r"\b(?:reveal|disclose|print|show|dump|expose)[ \t]+(?:the[ \t]+)?"
            r"(?:(?:hidden|original|full)[ \t]+)?(?:system|developer)[ \t]+"
            r"(?:prompt|instructions)\b",
        ),
        contextual=True,
    ),
    Detector(
        "SG-SEC-007",
        _pattern(
            r"\b(?:send|upload|post|transmit|exfiltrate)[ \t]+(?:(?:all|the)[ \t]+)?"
            r"(?:environment[ \t]+variables|env[ \t]+vars|\.env(?:[ \t]+file)?)"
            r"[ \t]+to[ \t]+(?:https?://|an?[ \t]+(?:external|remote)[ \t]+"
            r"(?:server|endpoint)\b)",
        ),
        contextual=True,
    ),
    Detector(
        "SG-SEC-008",
        _pattern(
            r"\b(?:bypass|disable|override|ignore)[ \t]+(?:(?:all|the)[ \t]+)?"
            r"(?:permission[ \t]+checks|permissions|security[ \t]+checks|"
            r"safety[ \t]+(?:checks|guardrails)|sandbox[ \t]+restrictions|"
            r"approval[ \t]+(?:checks|requirements))\b",
        ),
        contextual=True,
    ),
    Detector(
        "SG-SEC-009",
        _pattern(
            r"\b(?:hide|conceal)[ \t]+(?:(?:all|the|your)[ \t]+)?"
            r"(?:actions|activity|changes|execution)[ \t]+from[ \t]+"
            r"(?:the[ \t]+)?(?:user|operator)\b",
        ),
        contextual=True,
    ),
    Detector(
        "SG-SEC-010",
        _pattern(
            r"(?<![\w./-])(?:curl|wget)[ \t]+[^\r\n|]{1,384}\|[ \t]*"
            r"(?:(?:sudo|env)[ \t]+)?(?:ba|da|z|k)?sh(?![\w./-])",
        ),
    ),
    Detector(
        "SG-SEC-011",
        _pattern(
            r"(?<![\w./-])rm[ \t]+(?P<args>(?:(?:-[A-Za-z]{1,8}|--recursive|"
            r"--force|--no-preserve-root)[ \t]+){1,6})"
            r"(?P<target>/\*?|~/?|\$HOME/?|\$\{HOME\}/?)(?=$|[ \t;|])",
        ),
    ),
    Detector(
        "SG-SEC-012",
        _pattern(
            r"(?<![\w./-])base64[ \t]+(?:--decode|-d)\b[ \t]*\|[ \t]*"
            r"(?:ba|da|z|k)?sh(?![\w./-])|"
            r"\b(?:eval|exec)[ \t]*\([ \t]*(?:base64\.)?b64decode[ \t]*\(",
        ),
    ),
    Detector(
        "SG-SEC-013",
        _pattern(
            r"(?<![\w./-])(?P<installer>(?:python(?:3(?:\.[0-9]{1,2})?)?[ \t]+"
            r"-m[ \t]+)?pip3?[ \t]+install|npm[ \t]+(?:install|i))"
            r"[ \t]+(?P<packages>[^\r\n;&|]{1,512})(?![^\r\n;&|])",
        ),
    ),
)

_NEGATION = _pattern(
    r"\b(?:do[ \t]+not|don['\u2019]t|never|avoid|must[ \t]+not|should[ \t]+not|"
    r"cannot|can['\u2019]t|refuse[ \t]+to|prohibit(?:ed)?)[ \t,]"
)
_PLACEHOLDER = _pattern(
    r"^(?:example|sample|placeholder|changeme|replace[_-]?me|your[_-]|not[_-]?a[_-]?secret)"
)
_PACKAGE_NAME = _pattern(r"[a-z0-9][a-z0-9._-]{0,127}(?:\[[a-z0-9,._-]{1,64}\])?")
_NPM_PACKAGE = _pattern(r"(?:@[a-z0-9][a-z0-9._-]{0,63}/)?[a-z0-9][a-z0-9._-]{0,127}")
_PIP_PIN = _pattern(r"==[a-z0-9][a-z0-9.+!-]{0,63}")
_NPM_PIN = _pattern(r"[0-9]{1,12}\.[0-9]{1,12}\.[0-9]{1,12}(?:[-+][a-z0-9.-]{1,64})?")
_OPTION_ARGUMENTS = frozenset(
    {
        "-r",
        "--requirement",
        "-c",
        "--constraint",
        "-e",
        "--editable",
        "-i",
        "--index-url",
        "--extra-index-url",
        "--target",
        "-t",
        "--prefix",
        "--registry",
        "--cache",
    }
)


def _placeholder(value: str) -> bool:
    return _PLACEHOLDER.search(value) is not None or value.startswith(("$", "${", "{{", "<", "%"))


def _unpinned(match: re.Match[str]) -> bool:
    npm = match["installer"].lower().startswith("npm")
    skip_next = False
    for raw in match["packages"].split():
        token = raw.strip("'\"`")
        if skip_next:
            skip_next = False
            continue
        if token.startswith("-"):
            skip_next = token in _OPTION_ARGUMENTS
            continue
        if npm:
            name, separator, version = token.rpartition("@")
            if not separator or not name:
                name, version = token, ""
            if _NPM_PACKAGE.fullmatch(name) and not _NPM_PIN.fullmatch(version):
                return True
        else:
            name_match = _PACKAGE_NAME.match(token)
            if name_match:
                specifier = token[name_match.end() :]
                if (not specifier or specifier.startswith(("=", ">", "<", "~", "!"))) and not (
                    _PIP_PIN.fullmatch(specifier)
                ):
                    return True
    return False


def accepted(detector: Detector, match: re.Match[str], line: str) -> bool:
    if detector.contextual:
        # Scope a small prefix to the current clause, not the whole document.
        prefix = re.split(r"[;!?]|\.[ \t]+", line[max(0, match.start() - 160) : match.start()])[-1]
        if _NEGATION.search(prefix):
            return False
    if detector.rule_id == "SG-SEC-004":
        return not _placeholder(match["value"])
    if detector.rule_id == "SG-SEC-005":
        return not _placeholder(match["password"])
    if detector.rule_id == "SG-SEC-011":
        args = match["args"].split()
        short = "".join(arg[1:] for arg in args if not arg.startswith("--"))
        return ("r" in short or "--recursive" in args) and ("f" in short or "--force" in args)
    if detector.rule_id == "SG-SEC-013":
        return _unpinned(match)
    return True
