"""Smoke tests for the installed Phase 0 package and its schema dependency."""

from importlib.metadata import version

import pytest
from jsonschema import Draft202012Validator, ValidationError

import skillguard_engine
from skillguard_engine.__main__ import main


def test_installed_package_version() -> None:
    assert version("skillguard-engine") == skillguard_engine.__version__


def test_module_entry_point_is_available() -> None:
    assert callable(main)


def test_jsonschema_validates_a_valid_document() -> None:
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate({"name": "foundation"})


def test_jsonschema_rejects_an_invalid_document() -> None:
    validator = Draft202012Validator({"type": "string"})
    with pytest.raises(ValidationError):
        validator.validate(123)
