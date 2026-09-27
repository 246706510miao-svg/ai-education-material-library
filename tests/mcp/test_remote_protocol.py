from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from material_service.app.config import Settings
from material_service.app.main import create_app


class FakeEmbeddingProvider:
    model_name = "test-embedding"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 384 for _text in texts]


def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=SecretStr("postgresql+psycopg://test:test@localhost/test"),
        material_service_api_token=SecretStr("mcp-secret"),
        transfer_signing_secret=SecretStr("transfer-secret"),
        material_storage_root=tmp_path,
    )


def initialize(client: TestClient, token: str | None):  # type: ignore[no-untyped-def]
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "1"},
            },
        },
    )


def test_remote_mcp_requires_bearer_and_initializes(tmp_path: Path) -> None:
    """The one public MCP URL must reject anonymous clients and accept the shared key."""
    with TestClient(
        create_app(settings(tmp_path), embedding_provider=FakeEmbeddingProvider())
    ) as client:
        denied = initialize(client, None)
        accepted = initialize(client, "mcp-secret")

    assert denied.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["result"]["serverInfo"]["name"] == "shared-course-rag"
