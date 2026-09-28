import base64
import hashlib
import hmac
import json
from collections.abc import Callable
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any

from material_service.app.errors import TransferTokenInvalidError


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TransferTokenService:
    """Issue and consume short-lived HMAC capabilities for binary transfers."""

    def __init__(
        self,
        secret: bytes,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not secret:
            raise ValueError("transfer signing secret must not be empty")
        self._secret = secret
        self.clock = clock
        self._used_nonces: set[str] = set()

    def _issue(self, purpose: str, ttl_seconds: int, **claims: Any) -> str:
        payload = {
            "purpose": purpose,
            "exp": int(self.clock().timestamp()) + ttl_seconds,
            "nonce": token_urlsafe(18),
            **claims,
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        encoded = _encode(body.encode("utf-8"))
        signature = _encode(
            hmac.new(self._secret, encoded.encode("ascii"), hashlib.sha256).digest()
        )
        return f"{encoded}.{signature}"

    def _consume(self, token: str, purpose: str) -> dict[str, Any]:
        try:
            encoded, supplied_signature = token.split(".", 1)
            expected_signature = _encode(
                hmac.new(self._secret, encoded.encode("ascii"), hashlib.sha256).digest()
            )
            if not hmac.compare_digest(supplied_signature, expected_signature):
                raise ValueError("signature mismatch")
            payload = json.loads(_decode(encoded))
            nonce = str(payload["nonce"])
            if payload["purpose"] != purpose:
                raise ValueError("wrong purpose")
            if int(payload["exp"]) < int(self.clock().timestamp()):
                raise ValueError("expired")
            if nonce in self._used_nonces:
                raise ValueError("already used")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise TransferTokenInvalidError("The transfer token is invalid or expired.") from error
        self._used_nonces.add(nonce)
        return payload

    def issue_upload(
        self, *, intent_id: str, metadata: dict[str, Any], ttl_seconds: int
    ) -> str:
        return self._issue("upload", ttl_seconds, intent_id=intent_id, metadata=metadata)

    def consume_upload(self, token: str) -> dict[str, Any]:
        return self._consume(token, "upload")

    def issue_download(self, *, file_id: str, ttl_seconds: int) -> str:
        return self._issue("download", ttl_seconds, file_id=file_id)

    def consume_download(self, token: str) -> dict[str, Any]:
        return self._consume(token, "download")

    def issue_confirmation(self, *, metadata_hash: str, ttl_seconds: int) -> str:
        return self._issue("confirmation", ttl_seconds, metadata_hash=metadata_hash)

    def consume_confirmation(self, token: str, *, metadata_hash: str) -> None:
        payload = self._consume(token, "confirmation")
        if not hmac.compare_digest(str(payload.get("metadata_hash", "")), metadata_hash):
            raise TransferTokenInvalidError(
                "The duplicate confirmation does not match the upload metadata."
            )
