from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from material_service.app.config import Settings
from material_service.app.main import create_app


def unavailable_settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=SecretStr(
            "postgresql+psycopg://material:secret@127.0.0.1:1/unavailable?connect_timeout=1"
        ),
        material_service_api_token=SecretStr("health-token"),
        material_storage_root=tmp_path / "materials",
    )


def test_health_reports_process_liveness_when_database_is_unavailable(tmp_path: Path) -> None:
    """A database outage must not make the process-liveness endpoint fail."""
    client = TestClient(create_app(unavailable_settings(tmp_path)))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_database_unavailable_separately(tmp_path: Path) -> None:
    """Readiness must stop traffic when PostgreSQL cannot be reached."""
    client = TestClient(create_app(unavailable_settings(tmp_path)))

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["error_code"] == "DATABASE_UNAVAILABLE"
    assert response.json()["request_id"]

