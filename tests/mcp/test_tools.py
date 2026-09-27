from pathlib import Path

import httpx
import pytest

from mcp_server.client import MaterialApiClient
from mcp_server.server import create_server


def api_client(handler) -> MaterialApiClient:  # type: ignore[no-untyped-def]
    return MaterialApiClient(
        base_url="https://materials.example.test",
        api_token="tool-token",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_server_exposes_exactly_three_structured_material_tools() -> None:
    """Scope drift must not silently expose SQL or answer-generation tools."""
    client = api_client(lambda _request: httpx.Response(200, json={"status": "success"}))
    server = create_server(client)

    tools = await server.list_tools()

    assert {tool.name for tool in tools} == {
        "upload_pdf",
        "list_materials",
        "search_materials",
    }
    serialized = " ".join(str(tool.inputSchema).casefold() for tool in tools)
    assert "sql" not in serialized
    assert "prompt" not in serialized


@pytest.mark.asyncio
async def test_search_tool_returns_the_remote_structured_json() -> None:
    """The MCP layer must not convert candidate chunks into a generated answer."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/materials/search"
        return httpx.Response(
            200,
            json={
                "status": "success",
                "items": [
                    {
                        "chunk_id": "chunk_one",
                        "text": "Change the order of integration.",
                        "document_id": "doc_one",
                        "document_title": "多重积分讲义",
                        "page_start": 2,
                        "page_end": 2,
                        "source_name": "课程资料整理",
                        "source_type": "course_material",
                        "quality_flags": [],
                        "score": 0.8,
                        "score_type": "full_text_rank",
                    }
                ],
            },
        )

    server = create_server(api_client(handler))

    result = await server.call_tool("search_materials", {"query": "Change the order"})

    assert isinstance(result, tuple)
    _content_blocks, structured_content = result
    assert structured_content["tool"] == "search_materials"
    assert structured_content["result"]["items"][0]["page_start"] == 2


def test_upload_tool_rejects_missing_path_without_calling_remote_api(tmp_path: Path) -> None:
    """The user-visible MCP upload boundary must validate the local file first."""
    network_called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal network_called
        network_called = True
        return httpx.Response(500)

    client = api_client(handler)

    with pytest.raises(FileNotFoundError):
        client.upload_pdf(
            file_path=tmp_path / "missing.pdf",
            metadata={
                "title": "缺失资料",
                "course": "高等数学",
                "unit": "多重积分",
                "source_name": "测试",
                "source_type": "course_material",
            },
        )

    assert network_called is False

