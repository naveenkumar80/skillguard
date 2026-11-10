"""Read-only, deterministic security findings from caller-supplied text only."""

from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from itertools import chain
from typing import Any

from skillguard_engine.protocol import InputFile, ProtocolError
from skillguard_engine.security.dependencies import DECLARATION_RULE_ID, declaration_locations
from skillguard_engine.security.patterns import DETECTORS, accepted
from skillguard_engine.security.registry import load_catalog

MAX_FINDINGS = 1000
MAX_RESPONSE_BYTES = 1024 * 1024


def _encoded_size(value: object) -> int:
    # Exactly the entry point's ASCII-safe JSON encoding, excluding its final newline.
    return len(json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")))


def enforce_response_budget(response: object) -> None:
    if _encoded_size(response) + 1 > MAX_RESPONSE_BYTES:
        raise ProtocolError("RESOURCE_LIMIT", "Scan exceeds the 1 MiB response limit")


def _lexical_hits(content: str) -> Iterator[tuple[str, int, int]]:
    for line_number, line in enumerate(content.splitlines(), start=1):
        for detector in DETECTORS:
            for match in detector.pattern.finditer(line):
                if accepted(detector, match, line):
                    yield detector.rule_id, line_number, match.start() + 1


def scan(files: Sequence[InputFile]) -> list[dict[str, Any]]:
    """Scan validated bounded file records; paths are labels, never filesystem inputs.

    Metadata, messages, evidence, remediation and references are content-independent.
    Exceeding either budget raises a safe error instead of returning a partial scan.
    """
    catalog = load_catalog()
    rules = {rule.id: rule for rule in catalog.rules}
    if set(rules) != {detector.rule_id for detector in DETECTORS} | {DECLARATION_RULE_ID}:
        raise ValueError("Security catalog and detector identifiers differ")
    findings: list[dict[str, Any]] = []
    encoded_bytes = 2  # JSON array brackets; envelope checked by protocol dispatch.
    for file in files:
        declarations = (
            (DECLARATION_RULE_ID, line, column)
            for line, column in declaration_locations(file["path"], file["content"])
        )
        for identifier, line_number, column in chain(_lexical_hits(file["content"]), declarations):
            if len(findings) >= MAX_FINDINGS:
                raise ProtocolError("RESOURCE_LIMIT", "Scan exceeds the 1000 finding limit")
            rule = rules[identifier]
            finding: dict[str, Any] = {
                "schemaVersion": "1.0",
                "ruleId": rule.id,
                "title": rule.title,
                "category": rule.category,
                "severity": rule.default_severity,
                "confidence": rule.confidence,
                "path": file["path"],
                "line": line_number,
                "column": column,
                "message": rule.description,
                "evidence": {"redacted": True, "excerpt": "[REDACTED]"},
                "remediation": rule.remediation,
                "references": list(rule.references),
            }
            encoded_bytes += _encoded_size(finding) + bool(findings)
            if encoded_bytes + 1 > MAX_RESPONSE_BYTES:
                raise ProtocolError("RESOURCE_LIMIT", "Scan exceeds the 1 MiB response limit")
            findings.append(finding)
    findings.sort(key=lambda item: (item["path"], item["line"], item["column"], item["ruleId"]))
    return findings


__all__ = ["MAX_FINDINGS", "MAX_RESPONSE_BYTES", "load_catalog", "scan"]
