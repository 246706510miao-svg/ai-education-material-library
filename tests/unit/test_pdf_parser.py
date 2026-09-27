from pathlib import Path

import pytest

from material_service.app.errors import (
    PdfCorruptedError,
    PdfTextNotExtractableError,
    TooManyPagesError,
)
from material_service.app.pdf_parser import extract_pdf
from tests.fixture_factory import create_image_only_pdf, create_text_pdf


def test_extract_pdf_returns_one_based_pages_and_text(tmp_path: Path) -> None:
    """A zero-based or textless result would make stored citations point to the wrong page."""
    path = create_text_pdf(tmp_path / "text.pdf")

    parsed = extract_pdf(path, max_pages=10)

    assert parsed.page_count == 2
    assert [page.number for page in parsed.pages] == [1, 2]
    assert "Double integral" in parsed.pages[0].text
    assert "Change the order" in parsed.pages[1].text


def test_extract_pdf_rejects_an_image_only_pdf(tmp_path: Path) -> None:
    """An image-only PDF must not become a searchable document with empty chunks."""
    path = create_image_only_pdf(tmp_path / "scan.pdf")

    with pytest.raises(PdfTextNotExtractableError) as captured:
        extract_pdf(path, max_pages=10)

    assert captured.value.error_code == "PDF_TEXT_NOT_EXTRACTABLE"


def test_extract_pdf_rejects_a_corrupted_pdf(tmp_path: Path) -> None:
    """Corrupt bytes with a PDF header must be reported separately from a scan."""
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.7\nthis is not a complete pdf")

    with pytest.raises(PdfCorruptedError) as captured:
        extract_pdf(path, max_pages=10)

    assert captured.value.error_code == "PDF_CORRUPTED"


def test_extract_pdf_enforces_the_page_limit_before_returning_content(tmp_path: Path) -> None:
    """A PDF beyond the approved page limit must not proceed to chunking."""
    path = create_text_pdf(tmp_path / "too-many-pages.pdf")

    with pytest.raises(TooManyPagesError) as captured:
        extract_pdf(path, max_pages=1)

    assert captured.value.error_code == "TOO_MANY_PAGES"

