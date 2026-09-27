from pathlib import Path

import httpx
import pytest

from mcp_server.client import MaterialApiClient, MaterialApiError


def test_upload_pdf_sends_authenticated_multipart_and_metadata(tmp_path: Path) -> None:
    """The local MCP client must transfer bytes, not a server-unreadable Windows path."""
    pdf = tmp_path / "material.pdf"
    pdf.write_bytes(b"%PDF-1.7\ncontent")
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("Authorization")
        captured["content_type"] = request.headers.get("Content-Type")
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "status": "success",
                "document_id": "doc_one",
                "document_version_id": "docv_one",
                "file_id": "file_one",
                "page_count": 1,
                "chunk_count": 1,
                "duplicate_file": False,
                "searchable": True,
            },
        )

    client = MaterialApiClient(
        base_url="https://materials.example.test",
        api_token="secret-token",
        transport=httpx.MockTransport(handler),
    )

    result = client.upload_pdf(
        file_path=pdf,
        metadata={
            "title": "多重积分讲义",
            "course": "高等数学",
            "unit": "多重积分",
            "source_name": "课程资料整理",
            "source_type": "course_material",
        },
    )

    assert result["status"] == "success"
    assert captured["authorization"] == "Bearer secret-token"
    assert str(captured["content_type"]).startswith("multipart/form-data; boundary=")
    body = bytes(captured["body"])
    assert b"%PDF-1.7\ncontent" in body
    assert b"idempotency_key" in body
    assert b"material.pdf" in body


def test_upload_pdf_rejects_a_missing_local_path_before_network() -> None:
    """A bad local path must not create a meaningless remote upload request."""
    network_called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal network_called
        network_called = True
        return httpx.Response(500)

    client = MaterialApiClient(
        base_url="https://materials.example.test",
        api_token="secret-token",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(FileNotFoundError):
        client.upload_pdf(
            file_path=Path("missing.pdf"),
            metadata={
                "title": "缺失文件",
                "course": "高等数学",
                "unit": "多重积分",
                "source_name": "测试",
                "source_type": "course_material",
            },
        )

    assert network_called is False


def test_api_error_preserves_structured_error_fields() -> None:
    """MCP callers must receive the service error code instead of an HTTP-only failure."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={
                "status": "error",
                "error_code": "PDF_TEXT_NOT_EXTRACTABLE",
                "message": "The PDF contains no extractable text.",
                "request_id": "req_one",
            },
        )

    client = MaterialApiClient(
        base_url="https://materials.example.test",
        api_token="secret-token",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(MaterialApiError) as captured:
        client.list_materials()

    assert captured.value.error_code == "PDF_TEXT_NOT_EXTRACTABLE"
    assert captured.value.request_id == "req_one"
    assert "secret-token" not in str(captured.value)

