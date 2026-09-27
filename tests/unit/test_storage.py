from hashlib import sha256
from io import BytesIO
from pathlib import Path

import pytest

from material_service.app.errors import FileTooLargeError, NotAPdfError
from material_service.app.storage import store_pdf, validate_pdf_header


def pdf_bytes(payload: bytes = b"body") -> bytes:
    return b"%PDF-1.7\n" + payload


def test_validate_pdf_header_rejects_a_non_pdf_stream() -> None:
    """Accepting extension-only files would let arbitrary bytes enter PDF processing."""
    with pytest.raises(NotAPdfError, match="PDF"):
        validate_pdf_header(BytesIO(b"not a pdf"))


def test_validate_pdf_header_preserves_stream_position() -> None:
    """Header validation must not consume bytes needed by storage."""
    stream = BytesIO(pdf_bytes())

    validate_pdf_header(stream)

    assert stream.tell() == 0


def test_store_pdf_hashes_content_and_uses_a_safe_storage_key(tmp_path: Path) -> None:
    """Changing a filename must not change identity or escape the storage root."""
    content = pdf_bytes(b"multiple integral")

    stored = store_pdf(BytesIO(content), "../../unsafe name.pdf", tmp_path, max_bytes=1024)

    digest = sha256(content).hexdigest()
    assert stored.sha256 == digest
    assert stored.size_bytes == len(content)
    assert stored.storage_key == f"{digest[:2]}/{digest}.pdf"
    assert stored.original_name == "unsafe name.pdf"
    assert (tmp_path / stored.storage_key).read_bytes() == content


def test_store_pdf_is_deterministic_for_duplicate_bytes(tmp_path: Path) -> None:
    """Uploading identical bytes twice must resolve to one physical object."""
    content = pdf_bytes(b"same material")

    first = store_pdf(BytesIO(content), "first.pdf", tmp_path, max_bytes=1024)
    second = store_pdf(BytesIO(content), "second.pdf", tmp_path, max_bytes=1024)

    assert first.sha256 == second.sha256
    assert first.storage_key == second.storage_key
    assert len(list(tmp_path.rglob("*.pdf"))) == 1


def test_store_pdf_rejects_oversized_content_and_removes_partial_file(tmp_path: Path) -> None:
    """A rejected upload must not consume persistent space through a `.part` file."""
    with pytest.raises(FileTooLargeError):
        store_pdf(BytesIO(pdf_bytes(b"x" * 100)), "large.pdf", tmp_path, max_bytes=32)

    assert list(tmp_path.rglob("*.part")) == []
    assert list(tmp_path.rglob("*.pdf")) == []

