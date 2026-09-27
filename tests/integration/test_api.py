from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, text

from material_service.app.config import Settings
from material_service.app.main import create_app
from tests.fixture_factory import create_image_only_pdf, create_text_pdf
from tests.integration.test_migrations import alembic_config

TOKEN = "test-project-token"


@pytest.fixture(autouse=True)
def migrated_database(postgres_url: str, postgres_engine: Engine) -> Iterator[None]:
    command.upgrade(alembic_config(postgres_url), "head")
    yield
    with postgres_engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE document_chunks, document_versions, ingestion_runs, "
                "documents, stored_files, api_clients CASCADE"
            )
        )


@pytest.fixture
def client(postgres_url: str, tmp_path: Path) -> TestClient:
    class FakeEmbeddingProvider:
        model_name = "test-embedding"

        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return [[0.0] * 384 for _text in texts]

    settings = Settings(
        database_url=SecretStr(postgres_url),
        material_service_api_token=SecretStr(TOKEN),
        transfer_signing_secret=SecretStr("transfer-test-secret"),
        material_storage_root=tmp_path / "materials",
    )
    return TestClient(create_app(settings, embedding_provider=FakeEmbeddingProvider()))


def auth_headers(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def ingest_data(key: str = "api-request") -> dict[str, str]:
    return {
        "title": "多重积分讲义",
        "school": "南京理工大学",
        "major": "计算机科学与技术",
        "course": "高等数学",
        "unit": "多重积分",
        "source_name": "课程资料整理",
        "material_type": "course_material",
        "idempotency_key": key,
    }


def test_v1_routes_require_a_valid_bearer_token(client: TestClient) -> None:
    """A public caller must not list shared materials without the project Token."""
    missing = client.get("/v1/materials")
    wrong = client.get("/v1/materials", headers=auth_headers("wrong-token"))

    assert missing.status_code == 401
    assert wrong.status_code == 401
    for response in (missing, wrong):
        assert response.json()["status"] == "error"
        assert response.json()["error_code"] == "UNAUTHORIZED"
        assert response.json()["request_id"]
        assert response.headers["X-Request-ID"] == response.json()["request_id"]
        assert TOKEN not in response.text


def test_ingest_list_and_search_contract(
    client: TestClient, tmp_path: Path
) -> None:
    """HTTP must expose the same traceable upload/search chain as the service."""
    pdf = create_text_pdf(tmp_path / "api.pdf")
    with pdf.open("rb") as stream:
        uploaded = client.post(
            "/v1/materials/ingest",
            headers=auth_headers(),
            data=ingest_data(),
            files={"file": (pdf.name, stream, "application/pdf")},
        )

    assert uploaded.status_code == 200
    uploaded_body = uploaded.json()
    assert uploaded_body["status"] == "success"
    assert uploaded_body["page_count"] == 2
    assert uploaded_body["chunk_count"] == 1

    listed = client.get(
        "/v1/materials",
        headers=auth_headers(),
        params={"course": "高等数学", "unit": "多重积分"},
    )
    assert listed.status_code == 200
    assert listed.json()["items"][0]["document_id"] == uploaded_body["document_id"]

    searched = client.post(
        "/v1/materials/search",
        headers=auth_headers(),
        json={"query": "Change the order", "limit": 10},
    )
    assert searched.status_code == 200
    assert searched.json()["status"] == "success"
    assert searched.json()["items"][0]["page_end"] == 2


def test_search_not_found_is_a_normal_successful_response(client: TestClient) -> None:
    """No material match must not be reported as a server error."""
    response = client.post(
        "/v1/materials/search",
        headers=auth_headers(),
        json={"query": "content that does not exist", "limit": 10},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "not_found", "items": []}


def test_image_only_pdf_maps_to_the_stable_error_envelope(
    client: TestClient, tmp_path: Path
) -> None:
    """A scan must expose a stable business error without an internal traceback."""
    pdf = create_image_only_pdf(tmp_path / "scan.pdf")
    with pdf.open("rb") as stream:
        response = client.post(
            "/v1/materials/ingest",
            headers=auth_headers(),
            data=ingest_data("scan-request"),
            files={"file": (pdf.name, stream, "application/pdf")},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "PDF_TEXT_NOT_EXTRACTABLE"
    assert "Traceback" not in response.text
    assert response.headers["X-Request-ID"] == response.json()["request_id"]


def test_prepare_upload_returns_signed_url_and_result_can_be_polled(
    client: TestClient, tmp_path: Path
) -> None:
    """The public upload flow must move PDF bytes through a short-lived transfer URL."""
    prepared = client.post(
        "/v1/materials/uploads/prepare",
        headers=auth_headers(),
        json={
            key: value
            for key, value in ingest_data("unused").items()
            if key != "idempotency_key"
        },
    )
    assert prepared.status_code == 200
    body = prepared.json()
    assert body["status"] == "ready"
    assert body["intent_id"]
    assert body["upload_url"].startswith("/transfers/uploads/")

    pdf = create_text_pdf(tmp_path / "signed-upload.pdf")
    uploaded = client.put(
        body["upload_url"],
        content=pdf.read_bytes(),
        headers={"Content-Type": "application/pdf", "X-Filename": pdf.name},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["status"] in {"success", "partial_success"}

    result = client.get(
        f"/v1/materials/uploads/{body['intent_id']}", headers=auth_headers()
    )
    assert result.status_code == 200
    assert result.json()["document_id"] == uploaded.json()["document_id"]

