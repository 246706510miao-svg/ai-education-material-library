from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables or `.env`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: SecretStr
    material_service_api_token: SecretStr
    transfer_signing_secret: SecretStr
    material_storage_root: Path
    max_file_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    max_pdf_pages: int = Field(default=500, gt=0)
    processing_timeout_seconds: int = Field(default=600, gt=0)
    default_search_limit: int = Field(default=5, gt=0)
    max_search_limit: int = Field(default=20, gt=0)
    chunk_target_chars: int = Field(default=900, gt=0)
    chunk_max_chars: int = Field(default=1200, gt=0)
    chunk_overlap_chars: int = Field(default=150, ge=0)
    upload_url_ttl_seconds: int = Field(default=600, gt=0)
    download_url_ttl_seconds: int = Field(default=600, gt=0)
    embedding_model_name: str = (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    embedding_dimension: int = Field(default=384, gt=0)
    embedding_batch_size: int = Field(default=8, gt=0)
    embedding_cache_path: Path = Path("/data/models")


@lru_cache
def get_settings() -> Settings:
    """Return one validated settings object for the current process."""

    return Settings()  # type: ignore[call-arg]

