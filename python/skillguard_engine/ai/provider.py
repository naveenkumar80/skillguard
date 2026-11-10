"""Provider-neutral, injectable boundary and the one permitted HTTPS transport."""

from __future__ import annotations

import http.client
import socket
import ssl
import threading
import time
from contextlib import suppress
from typing import Protocol

from skillguard_engine.protocol import ProtocolError

MAX_RESPONSE_BYTES = 64 * 1024


class AIError(ProtocolError):
    """Never include provider, credential, content, or transport exception text."""

    def __init__(self, code: str, *, retryable: bool = False) -> None:
        super().__init__(code, "Advisory AI evaluation could not be completed", retryable=retryable)


class Provider(Protocol):
    def complete(self, *, payload: bytes, api_key: str, deadline: float) -> bytes:
        """Return a bounded provider envelope, respecting the monotonic deadline."""
        ...


def remaining(deadline: float) -> float:
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise AIError("AI_TIMEOUT")
    return seconds


class OpenAIHTTPSProvider:
    """No configurable host, URL, proxy, redirects, tools, or SDK hooks."""

    def complete(self, *, payload: bytes, api_key: str, deadline: float) -> bytes:
        connection = http.client.HTTPSConnection(
            "api.openai.com", timeout=remaining(deadline), context=ssl.create_default_context()
        )
        active: list[socket.socket] = []

        def expire() -> None:
            for sock in active:
                with suppress(OSError):
                    sock.shutdown(socket.SHUT_RDWR)
            connection.close()

        watchdog = threading.Timer(remaining(deadline), expire)
        watchdog.daemon = True
        watchdog.start()
        try:
            # Explicit connection lets us recheck the deadline after DNS/TLS, before sending data.
            connection.connect()
            if connection.sock is not None:
                active.append(connection.sock)
            self._timeout(connection, deadline)
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Accept-Encoding": "identity",
                },
            )
            self._timeout(connection, deadline)
            response = connection.getresponse()
            remaining(deadline)
            if response.status != 200:
                # In particular, never follow a Location header or read/echo an error body.
                raise AIError(
                    "AI_PROVIDER_ERROR", retryable=response.status == 429 or response.status >= 500
                )
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise AIError("AI_INVALID_RESPONSE")
            length = response.getheader("Content-Length")
            if length is not None:
                try:
                    size = int(length)
                except ValueError:
                    raise AIError("AI_INVALID_RESPONSE") from None
                if size < 0:
                    raise AIError("AI_INVALID_RESPONSE")
                if size > MAX_RESPONSE_BYTES:
                    raise AIError("AI_RESPONSE_LIMIT")
            chunks: list[bytes] = []
            size = 0
            while True:
                self._timeout(connection, deadline)
                chunk = response.read1(min(8192, MAX_RESPONSE_BYTES + 1 - size))
                remaining(deadline)
                if not chunk:
                    return b"".join(chunks)
                size += len(chunk)
                if size > MAX_RESPONSE_BYTES:
                    raise AIError("AI_RESPONSE_LIMIT")
                chunks.append(chunk)
        except AIError:
            raise
        except TimeoutError:
            raise AIError("AI_TIMEOUT") from None
        except (OSError, ValueError, http.client.HTTPException):
            remaining(deadline)
            raise AIError("AI_PROVIDER_ERROR", retryable=True) from None
        finally:
            watchdog.cancel()
            connection.close()

    @staticmethod
    def _timeout(connection: http.client.HTTPSConnection, deadline: float) -> None:
        seconds = remaining(deadline)
        if connection.sock is not None:
            connection.sock.settimeout(seconds)
