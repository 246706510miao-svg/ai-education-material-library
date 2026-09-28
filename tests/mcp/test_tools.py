from types import SimpleNamespace

import pytest

from mcp_server.server import create_server


class FakeMaterialService:
    def __init__(self) -> None:
        self.last_search_request = None

    def search_materials(self, request):  # type: ignore[no-untyped-def]
        self.last_search_request = request
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


@pytest.mark.asyncio
async def test_search_tool_applies_njust_computer_science_defaults() -> None:
    """An omitted scope must search the documented default instead of the whole library."""
    service = FakeMaterialService()
    server = create_server(service)  # type: ignore[arg-type]

    await server.call_tool("search_course_material", {"query": "多重积分"})

    assert service.last_search_request.school == "南京理工大学"
    assert service.last_search_request.major == "计算机科学与技术"


@pytest.mark.asyncio
async def test_search_tool_preserves_user_supplied_school_and_major() -> None:
    """Explicit user scope must override both defaults."""
    service = FakeMaterialService()
    server = create_server(service)  # type: ignore[arg-type]

    await server.call_tool(
        "search_course_material",
        {"query": "多重积分", "school": "东南大学", "major": "软件工程"},
    )

    assert service.last_search_request.school == "东南大学"
    assert service.last_search_request.major == "软件工程"
