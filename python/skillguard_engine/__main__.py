"""One bounded stdin request, one JSON stdout response; never execute skill content."""

from __future__ import annotations

import json
import sys
from typing import Any, BinaryIO

from skillguard_engine.protocol import (
    ProtocolError,
    error_response,
    handle_request,
    read_request,
    validate_response,
)


def _failure(error: Exception) -> dict[str, Any]:
    if isinstance(error, ProtocolError):
        return error_response(error)
    if isinstance(error, (MemoryError, RecursionError, OverflowError)):
        return error_response(ProtocolError("RESOURCE_LIMIT", "Engine resource limit exceeded"))
    return error_response(ProtocolError("INTERNAL_ERROR", "Engine could not process the request"))


def _process(stream: BinaryIO) -> dict[str, Any]:
    try:
        return handle_request(read_request(stream))
    except Exception as error:
        return _failure(error)


def main() -> int:
    try:
        response = _process(sys.stdin.buffer)
        try:
            validate_response(response)
        except Exception as error:
            response = _failure(error)
            validate_response(response)
        output = json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except Exception as error:
        # Even missing/corrupt packaged schemas must fail closed without a traceback.
        response = _failure(error)
        output = json.dumps(response, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    try:
        if not response["ok"]:
            sys.stderr.write(f"skillguard-engine: {response['error']['code']}\n")
        sys.stdout.write(output + "\n")
        sys.stdout.flush()
    except Exception:
        return 3
    return 0 if response["ok"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
