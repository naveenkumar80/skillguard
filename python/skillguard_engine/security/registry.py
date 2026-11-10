"""Immutable metadata loaded only from trusted package resources, never scan paths."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path
from typing import Any

RULE_SET_VERSION = "1.0.0"


@dataclass(frozen=True)
class Rule:
    id: str
    version: str
    title: str
    category: str
    default_severity: str
    confidence: str
    description: str
    remediation: str
    references: tuple[str, ...]


@dataclass(frozen=True)
class Catalog:
    version: str
    rules: tuple[Rule, ...]


def _text(value: Any, maximum: int) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ValueError("Invalid bundled security catalog text")
    return value


@lru_cache(maxsize=1)
def load_catalog() -> Catalog:
    root = files("skillguard_engine.security").joinpath("catalog")
    if not root.is_dir():
        # Match schema loading: Hatch editables keep force-included data in site-packages.
        root = Path(
            str(distribution("skillguard-engine").locate_file("skillguard_engine/security/catalog"))
        )
    data = json.loads(root.joinpath("security-v1.json").read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"version", "rules"}:
        raise ValueError("Invalid bundled security catalog")
    if data["version"] != RULE_SET_VERSION or not isinstance(data["rules"], list):
        raise ValueError("Unsupported bundled security catalog")
    rules: list[Rule] = []
    fields = {
        "id",
        "version",
        "title",
        "category",
        "defaultSeverity",
        "confidence",
        "description",
        "remediation",
        "references",
    }
    for item in data["rules"]:
        if not isinstance(item, dict) or set(item) != fields:
            raise ValueError("Invalid bundled security rule")
        identifier = _text(item["id"], 32)
        if not re.fullmatch(r"SG-SEC-[0-9]{3}", identifier):
            raise ValueError("Invalid bundled security rule identifier")
        if item["version"] != RULE_SET_VERSION or item["category"] != "security":
            raise ValueError("Unsupported bundled security rule")
        if item["defaultSeverity"] not in ("info", "low", "medium", "high", "critical"):
            raise ValueError("Invalid bundled security severity")
        if item["confidence"] not in ("low", "medium", "high"):
            raise ValueError("Invalid bundled security confidence")
        refs = item["references"]
        if not isinstance(refs, list) or len(refs) > 16:
            raise ValueError("Invalid bundled security references")
        references = tuple(_text(ref, 2048) for ref in refs)
        if len(set(references)) != len(references):
            raise ValueError("Duplicate bundled security references")
        rules.append(
            Rule(
                id=identifier,
                version=item["version"],
                title=_text(item["title"], 256),
                category=item["category"],
                default_severity=item["defaultSeverity"],
                confidence=item["confidence"],
                description=_text(item["description"], 2048),
                remediation=_text(item["remediation"], 2048),
                references=references,
            )
        )
    identifiers = [rule.id for rule in rules]
    if not rules or identifiers != sorted(set(identifiers)):
        raise ValueError("Security catalog rules must be unique and ordered")
    return Catalog(version=RULE_SET_VERSION, rules=tuple(rules))
