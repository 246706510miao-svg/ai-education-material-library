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
    material_storage_root: Path
    max_file_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    max_pdf_pages: int = Field(default=300, gt=0)
    processing_timeout_seconds: int = Field(default=120, gt=0)
    default_search_limit: int = Field(default=10, gt=0)
    max_search_limit: int = Field(default=50, gt=0)
    chunk_max_chars: int = Field(default=1500, gt=0)


@lru_cache
def get_settings() -> Settings:
    """Return one validated settings object for the current process."""

    return Settings()  # type: ignore[call-arg]

