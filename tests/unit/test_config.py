from pathlib import Path

from material_service.app.config import Settings


def test_settings_defaults_are_the_approved_mvp_limits(tmp_path: Path) -> None:
    """A changed default must not silently exceed the approved POC boundary."""
    settings = Settings(
        database_url="postgresql+psycopg://material:secret@localhost/materials",
        material_service_api_token="test-token",
        material_storage_root=tmp_path,
    )

    assert settings.max_file_bytes == 50 * 1024 * 1024
    assert settings.max_pdf_pages == 300
    assert settings.processing_timeout_seconds == 120
    assert settings.default_search_limit == 10
    assert settings.max_search_limit == 50
    assert settings.chunk_max_chars == 1500

