import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from material_service.app.errors import (
    FileTooLargeError,
    MaterialServiceError,
    NotAPdfError,
    StorageUnavailableError,
)

PDF_HEADER = b"%PDF-"
READ_SIZE = 64 * 1024


@dataclass(frozen=True, slots=True)
class StoredFilePayload:
    sha256: str
    size_bytes: int
    storage_key: str
    original_name: str
    mime_type: str = "application/pdf"


def validate_pdf_header(stream: BinaryIO) -> None:
    """Reject extension-only uploads while preserving the caller's stream position."""

    position = stream.tell()
    try:
        header = stream.read(len(PDF_HEADER))
    finally:
        stream.seek(position)
    if header != PDF_HEADER:
        raise NotAPdfError("The uploaded file does not have a valid PDF header.")


def _safe_original_name(original_name: str) -> str:
    normalized = original_name.replace("\\", "/")
    name = PurePosixPath(normalized).name.strip()
    return name or "document.pdf"


def store_pdf(
    stream: BinaryIO,
    original_name: str,
    storage_root: Path,
    max_bytes: int,
) -> StoredFilePayload:
    """Stream a validated PDF into content-addressed storage using an atomic rename."""

    validate_pdf_header(stream)
    stream.seek(0)
    temp_path: Path | None = None
    try:
        temp_root = storage_root / ".tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size_bytes = 0
        with tempfile.NamedTemporaryFile(dir=temp_root, suffix=".part", delete=False) as temporary:
            temp_path = Path(temporary.name)
            while block := stream.read(READ_SIZE):
                size_bytes += len(block)
                if size_bytes > max_bytes:
                    raise FileTooLargeError(f"PDF exceeds the {max_bytes}-byte upload limit.")
                digest.update(block)
                temporary.write(block)
            temporary.flush()
            os.fsync(temporary.fileno())

        sha256 = digest.hexdigest()
        storage_key = f"{sha256[:2]}/{sha256}.pdf"
        destination = storage_root / Path(storage_key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            temp_path.unlink()
        else:
            os.replace(temp_path, destination)
        temp_path = None
        return StoredFilePayload(
            sha256=sha256,
            size_bytes=size_bytes,
            storage_key=storage_key,
            original_name=_safe_original_name(original_name),
        )
    except MaterialServiceError:
        raise
    except OSError as error:
        raise StorageUnavailableError("PDF storage is unavailable.") from error
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

