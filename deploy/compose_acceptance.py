"""Run a real six-tool acceptance flow from inside the application container."""

import asyncio
import os

import httpx
import pymupdf
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

BASE_URL = os.getenv("MATERIAL_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
API_TOKEN = os.getenv("MATERIAL_SERVICE_API_TOKEN", "local-acceptance-token")
HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}
METADATA = {
    "school": "南京理工大学",
    "major": "计算机科学与技术",
    "course": "高等数学",
    "unit": "多重积分",
    "material_type": "course_material",
    "title": "Compose acceptance multiple integrals",
    "source_name": "synthetic acceptance",
}


def pdf_bytes() -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Double integral. Change the order of integration.")
    value = document.tobytes()
    document.close()
    return value


async def call(session: ClientSession, name: str, arguments: dict) -> dict:
    result = await session.call_tool(name, arguments)
    if result.isError:
        raise RuntimeError(f"{name} failed: {result.content}")
    return dict(result.structuredContent or {})


async def main() -> None:
    mcp_http = httpx.AsyncClient(headers=HEADERS)
    async with streamable_http_client(
        f"{BASE_URL}/mcp", http_client=mcp_http
    ) as (read_stream, write_stream, _get_session_id):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            assert names == {
                "prepare_material_upload",
                "get_upload_result",
                "list_materials",
                "search_course_material",
                "get_document_content",
                "get_document_download",
            }
            prepared = await call(session, "prepare_material_upload", METADATA)
            assert prepared["status"] == "ready"
            content = pdf_bytes()
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=130.0) as client:
                uploaded = (
                    await client.put(
                        prepared["upload_url"],
                        content=content,
                        headers={"Content-Type": "application/pdf", "X-Filename": "acceptance.pdf"},
                    )
                ).json()
            assert uploaded["status"] in {"success", "partial_success"}
            result = await call(
                session, "get_upload_result", {"intent_id": prepared["intent_id"]}
            )
            document_id = result["document_id"]
            searched = await call(
                session,
                "search_course_material",
                {"query": "Change the order of integration", "limit": 5},
            )
            assert searched["items"][0]["document_id"] == document_id
            parsed = await call(
                session, "get_document_content", {"document_id": document_id}
            )
            assert "Double integral" in parsed["items"][0]["text"]
            download = await call(
                session, "get_document_download", {"document_id": document_id}
            )
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=130.0) as client:
                downloaded = await client.get(download["download_url"])
            assert downloaded.content == content
            similar = await call(session, "prepare_material_upload", METADATA)
            assert similar["status"] == "confirmation_required"
            exact_metadata = {**METADATA, "title": "Byte-identical acceptance copy"}
            exact_prepared = await call(
                session, "prepare_material_upload", exact_metadata
            )
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=130.0) as client:
                exact = (
                    await client.put(
                        exact_prepared["upload_url"],
                        content=content,
                        headers={"Content-Type": "application/pdf", "X-Filename": "copy.pdf"},
                    )
                ).json()
            assert exact["status"] == "duplicate"
            assert exact["document_id"] == document_id
            print(
                {
                    "tools": len(names),
                    "upload": uploaded["status"],
                    "search_hits": len(searched["items"]),
                    "duplicate_confirmation": similar["status"],
                    "sha_duplicate": exact["status"],
                }
            )
    await mcp_http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
