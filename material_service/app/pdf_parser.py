import re
from dataclasses import dataclass
from pathlib import Path

import fitz

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


@dataclass(frozen=True, slots=True)
class _Segment:
    text: str
    page: int
    has_figure: bool
    formula_may_be_incomplete: bool


def extract_pdf(path: Path, max_pages: int) -> ParsedDocument:
    """Extract one-based text pages from a supported PDF."""

    try:
        document = fitz.open(path)
    except (fitz.FileDataError, RuntimeError, ValueError) as error:
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
    except (fitz.FileDataError, RuntimeError, ValueError) as error:
        raise PdfCorruptedError("The PDF content could not be extracted.") from error
    finally:
        document.close()

    if not any(page.text.strip() for page in pages):
        raise PdfTextNotExtractableError("The PDF contains no extractable text.")
    return ParsedDocument(pages=pages)


def _segments(pages: list[ParsedPage], max_chars: int) -> list[_Segment]:
    result: list[_Segment] = []
    for page in pages:
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", page.text) if part.strip()]
        for paragraph in paragraphs:
            formula_warning = page.has_figure or any(
                hint in paragraph.casefold() for hint in FORMULA_HINTS
            )
            if len(paragraph) <= max_chars:
                result.append(
                    _Segment(paragraph, page.number, page.has_figure, formula_warning)
                )
                continue
            for offset in range(0, len(paragraph), max_chars):
                result.append(
                    _Segment(
                        paragraph[offset : offset + max_chars],
                        page.number,
                        page.has_figure,
                        formula_warning,
                    )
                )
    return result


def chunk_pages(pages: list[ParsedPage], max_chars: int) -> list[ParsedChunk]:
    """Combine paragraphs up to a bound while retaining their page range and warnings."""

    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    segments = _segments(pages, max_chars)
    chunks: list[ParsedChunk] = []
    current: list[_Segment] = []

    def flush() -> None:
        if not current:
            return
        text = "\n\n".join(segment.text for segment in current)
        has_figure = any(segment.has_figure for segment in current)
        formula_warning = any(segment.formula_may_be_incomplete for segment in current)
        quality_flags: list[str] = []
        if has_figure:
            quality_flags.append("HAS_FIGURE")
        if formula_warning:
            quality_flags.append("FORMULA_MAY_BE_INCOMPLETE")
        chunks.append(
            ParsedChunk(
                chunk_index=len(chunks),
                page_start=current[0].page,
                page_end=current[-1].page,
                text=text,
                heading_path=None,
                content_type="body",
                text_quality="partial" if quality_flags else "complete",
                formula_status="possibly_missing" if formula_warning else "preserved",
                has_figure=has_figure,
                quality_flags=quality_flags,
            )
        )
        current.clear()

    for segment in segments:
        proposed_length = len(segment.text)
        if current:
            proposed_length += sum(len(item.text) for item in current) + 2 * len(current)
        if current and proposed_length > max_chars:
            flush()
        current.append(segment)
    flush()
    return chunks

