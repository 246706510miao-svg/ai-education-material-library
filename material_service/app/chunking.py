import re
from dataclasses import dataclass

from material_service.app.pdf_parser import FORMULA_HINTS, ParsedChunk, ParsedPage

_HEADING = re.compile(r"^(?:第[一二三四五六七八九十百0-9]+[章节篇部]|\d+(?:\.\d+)*\s+)")


@dataclass(frozen=True, slots=True)
class _Part:
    text: str
    page: int
    heading_path: list[str] | None
    has_figure: bool
    formula_warning: bool


def _parts(pages: list[ParsedPage], max_chars: int) -> list[_Part]:
    result: list[_Part] = []
    heading_path: list[str] | None = None
    for page in pages:
        paragraphs = [value.strip() for value in re.split(r"\n\s*\n", page.text) if value.strip()]
        for paragraph in paragraphs:
            if len(paragraph) <= 80 and _HEADING.match(paragraph):
                heading_path = [paragraph]
            formula_warning = page.has_figure or any(
                hint in paragraph.casefold() for hint in FORMULA_HINTS
            )
            for offset in range(0, len(paragraph), max_chars):
                result.append(
                    _Part(
                        text=paragraph[offset : offset + max_chars],
                        page=page.number,
                        heading_path=heading_path,
                        has_figure=page.has_figure,
                        formula_warning=formula_warning,
                    )
                )
    return result


def build_chunks(
    pages: list[ParsedPage],
    *,
    target_chars: int,
    max_chars: int,
    overlap_chars: int,
) -> list[ParsedChunk]:
    """Build bounded, overlapping chunks while retaining page and quality provenance."""

    if target_chars <= 0 or max_chars <= 0:
        raise ValueError("target_chars and max_chars must be positive")
    if target_chars > max_chars:
        raise ValueError("target_chars must not exceed max_chars")
    if overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("overlap_chars must be non-negative and smaller than target_chars")

    parts = _parts(pages, max_chars)
    chunks: list[ParsedChunk] = []
    current_text = ""
    current_parts: list[_Part] = []

    def flush() -> None:
        nonlocal current_text, current_parts
        if not current_text:
            return
        has_figure = any(part.has_figure for part in current_parts)
        formula_warning = any(part.formula_warning for part in current_parts)
        flags: list[str] = []
        if has_figure:
            flags.append("HAS_FIGURE")
        if formula_warning:
            flags.append("FORMULA_MAY_BE_INCOMPLETE")
        heading = next(
            (part.heading_path for part in reversed(current_parts) if part.heading_path), None
        )
        chunks.append(
            ParsedChunk(
                chunk_index=len(chunks),
                page_start=current_parts[0].page,
                page_end=current_parts[-1].page,
                text=current_text,
                heading_path=heading,
                content_type="body",
                text_quality="partial" if flags else "complete",
                formula_status="possibly_missing" if formula_warning else "preserved",
                has_figure=has_figure,
                quality_flags=flags,
            )
        )
        overlap = current_text[-overlap_chars:] if overlap_chars else ""
        last_part = current_parts[-1]
        current_text = overlap
        current_parts = [last_part] if overlap else []

    for part in parts:
        separator = "\n\n" if current_text else ""
        proposed = f"{current_text}{separator}{part.text}"
        if current_text and len(proposed) > target_chars:
            flush()
            separator = "\n\n" if current_text else ""
            proposed = f"{current_text}{separator}{part.text}"
        if len(proposed) > max_chars:
            available = max_chars - len(current_text) - len(separator)
            if available > 0:
                current_text = f"{current_text}{separator}{part.text[:available]}"
                current_parts.append(part)
                flush()
            remainder = part.text[max(available, 0) :]
            step = max_chars - overlap_chars
            for offset in range(0, len(remainder), step):
                piece = remainder[offset : offset + max_chars]
                if not piece:
                    continue
                current_text = piece
                current_parts = [part]
                if len(piece) == max_chars:
                    flush()
            continue
        current_text = proposed
        current_parts.append(part)
    flush()
    return chunks
