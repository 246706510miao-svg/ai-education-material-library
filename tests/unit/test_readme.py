from pathlib import Path


def test_readme_is_concise_and_covers_the_remote_mcp_entrypoint() -> None:
    """The public guide must describe the real remote surface without stale stdio setup."""
    readme = Path(__file__).parents[2] / "README.md"
    text = readme.read_text(encoding="utf-8")
    required = {
        "https://materials.for-fdd.xyz/mcp",
        "prepare_material_upload",
        "get_upload_result",
        "list_materials",
        "search_course_material",
        "get_document_content",
        "get_document_download",
        "uv run pytest -q",
        "docs/deployment-runbook.md",
        "text-based PDF",
    }
    assert required <= set(filter(None, (item if item in text else "" for item in required)))
    assert "required local stdio" not in text.casefold()
    assert len(text.splitlines()) <= 120
