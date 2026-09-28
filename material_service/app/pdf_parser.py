from dataclasses import dataclass
from pathlib import Path

import pymupdf

from material_service.app.errors import (
    PdfCorruptedError,
    PdfTextNotExtractableError,
    TooManyPagesError,
)

PARSER_VERSION = "pdf-parser-0.1"
FORMULA_HINTS = ("integral", "∫", "region", "limit", "积分", "区域", "上限", "下限")


@dataclass(frozen=True, slots=True)
class ParsedPage:
    number: int
    text: str
    has_figure: bool


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    pages: list[ParsedPage]

    @property
    def page_count(self) -> int:
        return len(self.pages)


@dataclass(frozen=True, slots=True)
class ParsedChunk:
    chunk_index: int
    page_start: int
    page_end: int
    text: str
    heading_path: list[str] | None
    content_type: str
    text_quality: str
    formula_status: str
    has_figure: bool
    quality_flags: list[str]


def extract_pdf(path: Path, max_pages: int) -> ParsedDocument:
    """Extract one-based text pages from a supported PDF."""

    try:
        document = pymupdf.open(path)
    except (pymupdf.FileDataError, RuntimeError, ValueError) as error:
        raise PdfCorruptedError("The PDF is corrupted or cannot be opened.") from error

    try:
        if document.needs_pass:
            raise PdfCorruptedError("Encrypted PDFs are not supported in the first version.")
        if document.page_count > max_pages:
            raise TooManyPagesError(f"PDF has more than the {max_pages}-page limit.")
        pages = [
            ParsedPage(
                number=index + 1,
                text=page.get_text("text"),
                has_figure=bool(page.get_images(full=True)),
            )
            for index, page in enumerate(document)
        ]
    except (PdfCorruptedError, TooManyPagesError):
        raise
    except (pymupdf.FileDataError, RuntimeError, ValueError) as error:
        raise PdfCorruptedError("The PDF content could not be extracted.") from error
    finally:
        document.close()

    if not any(page.text.strip() for page in pages):
        raise PdfTextNotExtractableError("The PDF contains no extractable text.")
    return ParsedDocument(pages=pages)


def chunk_pages(pages: list[ParsedPage], max_chars: int) -> list[ParsedChunk]:
    """Compatibility wrapper for callers that do not request overlap."""

    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    from material_service.app.chunking import build_chunks

    return build_chunks(
        pages,
        target_chars=max_chars,
        max_chars=max_chars,
        overlap_chars=0,
    )

