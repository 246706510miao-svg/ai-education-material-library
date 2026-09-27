from pathlib import Path

from material_service.app.config import Settings


def test_settings_defaults_are_the_approved_remote_rag_limits(tmp_path: Path) -> None:
    """Runtime defaults must keep retrieval and chunking inside the POC boundary."""
    settings = Settings(
        database_url="postgresql+psycopg://material:secret@localhost/materials",
        material_service_api_token="test-token",
        material_storage_root=tmp_path,
        transfer_signing_secret="transfer-secret",
    )

    assert settings.max_file_bytes == 50 * 1024 * 1024
    assert settings.max_pdf_pages == 300
    assert settings.processing_timeout_seconds == 120
    assert settings.default_search_limit == 5
    assert settings.max_search_limit == 20
    assert settings.chunk_target_chars == 900
    assert settings.chunk_max_chars == 1200
    assert settings.chunk_overlap_chars == 150
    assert settings.upload_url_ttl_seconds == 600
    assert settings.download_url_ttl_seconds == 600
    assert settings.embedding_model_name == (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    assert settings.embedding_dimension == 384
    assert settings.embedding_batch_size == 8


def test_transfer_signing_secret_is_required(tmp_path: Path) -> None:
    """Starting without a transfer signing secret must fail validation."""
    try:
        Settings(
            database_url="postgresql+psycopg://material:secret@localhost/materials",
            material_service_api_token="test-token",
            material_storage_root=tmp_path,
        )
    except ValueError as error:
        assert "transfer_signing_secret" in str(error)
    else:
        raise AssertionError("missing transfer_signing_secret was accepted")

