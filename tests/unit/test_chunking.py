from material_service.app.chunking import build_chunks
from material_service.app.pdf_parser import ParsedPage, chunk_pages


def page(number: int, text: str, *, has_figure: bool = False) -> ParsedPage:
    return ParsedPage(number=number, text=text, has_figure=has_figure)


def test_chunk_pages_preserves_paragraphs_and_cross_page_range() -> None:
    """Combining small paragraphs must retain the first and last source page."""
    chunks = chunk_pages(
        [page(1, "Definition.\n\nRegion D."), page(2, "Change the order.")],
        max_chars=50,
    )

    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].page_start == 1
    assert chunks[0].page_end == 2
    assert chunks[0].text == "Definition.\n\nRegion D.\n\nChange the order."


def test_chunk_pages_hard_splits_only_an_over_limit_paragraph() -> None:
    """One long paragraph must be bounded without producing empty chunks."""
    chunks = chunk_pages([page(3, "abcdefghij")], max_chars=4)

    assert [chunk.text for chunk in chunks] == ["abcd", "efgh", "ij"]
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]
    assert all(chunk.page_start == 3 and chunk.page_end == 3 for chunk in chunks)


def test_chunk_pages_starts_a_new_chunk_at_the_size_boundary() -> None:
    """Appending a paragraph beyond the limit must not create an oversized chunk."""
    chunks = chunk_pages([page(1, "12345\n\n67890")], max_chars=8)

    assert [chunk.text for chunk in chunks] == ["12345", "67890"]
    assert all(len(chunk.text) <= 8 for chunk in chunks)


def test_chunk_pages_carries_quality_warnings_without_dropping_text() -> None:
    """Pages with figures or integral wording must warn callers without hiding the source text."""
    chunks = chunk_pages([page(4, "integral over region D", has_figure=True)], max_chars=100)

    assert chunks[0].text_quality == "partial"
    assert chunks[0].formula_status == "possibly_missing"
    assert chunks[0].has_figure is True
    assert chunks[0].quality_flags == ["HAS_FIGURE", "FORMULA_MAY_BE_INCOMPLETE"]


def test_chunk_pages_ignores_whitespace_only_pages() -> None:
    """Whitespace-only extraction must not create empty searchable chunks."""
    chunks = chunk_pages([page(1, "  \n\n  "), page(2, "Useful text")], max_chars=100)

    assert [chunk.text for chunk in chunks] == ["Useful text"]
    assert chunks[0].page_start == 2


def test_build_chunks_prefers_paragraph_boundaries_and_tracks_heading() -> None:
    """A target boundary must not discard headings or source page provenance."""
    chunks = build_chunks(
        [
            page(
                1,
                "第一节 定义\n\n第一段内容一二三四五六七八九十。"
                "\n\n第二段内容一二三四五六七八九十。",
            ),
            page(2, "第三段内容一二三四五六七八九十。"),
        ],
        target_chars=32,
        max_chars=44,
        overlap_chars=8,
    )

    assert len(chunks) >= 2
    assert chunks[0].page_start == 1
    assert chunks[-1].page_end == 2
    assert chunks[0].heading_path == ["第一节 定义"]
    assert all(len(chunk.text) <= 44 for chunk in chunks)
    assert chunks[0].text[-8:] == chunks[1].text[:8]


def test_build_chunks_keeps_metadata_out_of_returned_text() -> None:
    """Embedding metadata must never be mixed into the raw content returned to callers."""
    chunks = build_chunks(
        [page(1, "原始正文")], target_chars=20, max_chars=30, overlap_chars=5
    )

    assert chunks[0].text == "原始正文"
    assert "school" not in chunks[0].text

