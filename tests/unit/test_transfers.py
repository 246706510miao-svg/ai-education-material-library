from datetime import UTC, datetime, timedelta

import pytest

from material_service.app.errors import TransferTokenInvalidError
from material_service.app.transfers import TransferTokenService


def test_upload_token_is_bound_to_payload_and_single_use() -> None:
    """A stolen or replayed upload token must not authorize another transfer."""
    now = datetime(2026, 9, 27, tzinfo=UTC)
    service = TransferTokenService(b"test-signing-secret", clock=lambda: now)
    token = service.issue_upload(
        intent_id="intent_1", metadata={"title": "多重积分"}, ttl_seconds=600
    )

    payload = service.consume_upload(token)

    assert payload["intent_id"] == "intent_1"
    assert payload["metadata"] == {"title": "多重积分"}
    with pytest.raises(TransferTokenInvalidError):
        service.consume_upload(token)


def test_expired_download_token_is_rejected() -> None:
    """An expired download URL must not keep granting access to the original PDF."""
    now = datetime(2026, 9, 27, tzinfo=UTC)
    service = TransferTokenService(b"test-signing-secret", clock=lambda: now)
    token = service.issue_download(file_id="file_1", ttl_seconds=60)
    service.clock = lambda: now + timedelta(seconds=61)

    with pytest.raises(TransferTokenInvalidError):
        service.consume_download(token)


def test_changed_token_signature_is_rejected() -> None:
    """Changing one signed character must invalidate the transfer capability."""
    service = TransferTokenService(b"test-signing-secret")
    token = service.issue_download(file_id="file_1", ttl_seconds=60)
    replacement = "A" if token[-1] != "A" else "B"

    with pytest.raises(TransferTokenInvalidError):
        service.consume_download(f"{token[:-1]}{replacement}")
