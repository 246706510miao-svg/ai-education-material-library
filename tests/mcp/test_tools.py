from types import SimpleNamespace

import pytest

from mcp_server.server import create_server


class FakeMaterialService:
    def search_materials(self, request):  # type: ignore[no-untyped-def]
        del request
        return SimpleNamespace(
            model_dump=lambda mode="json": {"status": "not_found", "items": []}
        )


@pytest.mark.asyncio
async def test_server_exposes_exactly_six_structured_material_tools() -> None:
    """The remote MCP surface must stay limited to the agreed shared-library workflow."""
    server = create_server(FakeMaterialService())  # type: ignore[arg-type]

    tools = await server.list_tools()

    assert {tool.name for tool in tools} == {
        "prepare_material_upload",
        "get_upload_result",
        "list_materials",
        "search_course_material",
        "get_document_content",
        "get_document_download",
    }
    serialized = " ".join(str(tool.inputSchema).casefold() for tool in tools)
    assert "file_path" not in serialized
    assert "sql" not in serialized


@pytest.mark.asyncio
async def test_search_tool_returns_structured_evidence_without_answer_generation() -> None:
    """The MCP layer must return retrieval JSON and never invent a final answer."""
    server = create_server(FakeMaterialService())  # type: ignore[arg-type]

    result = await server.call_tool("search_course_material", {"query": "多重积分"})

    assert isinstance(result, tuple)
    _blocks, structured = result
    assert structured == {"status": "not_found", "items": []}
