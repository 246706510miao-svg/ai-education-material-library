import argparse
import importlib.metadata
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from material_service.app.schemas import IngestMetadata, SearchRequest
from material_service.app.services import MaterialService


def _json(model: Any) -> dict[str, Any]:
    return dict(model.model_dump(mode="json"))


def create_server(service: MaterialService) -> FastMCP:
    server = FastMCP(
        name="shared-course-rag",
        instructions=(
            "Search this shared course-material library before answering course-content "
            "questions. Cite document titles and PDF page ranges from retrieved evidence. "
            "If the user omits school or major, use 南京理工大学 and 计算机科学与技术, "
            "state that default scope, and explain that providing their school and major "
            "can produce more precise results. Explicit user scope always overrides defaults. "
            "Use prepare_material_upload before transferring a PDF."
        ),
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(
            allowed_hosts=[
                "materials.for-fdd.xyz",
                "testserver",
                "localhost:*",
                "127.0.0.1:*",
            ]
        ),
    )

    @server.tool(structured_output=True)
    def prepare_material_upload(
        school: str,
        major: str,
        course: str,
        unit: str,
        material_type: str,
        title: str,
        source_name: str | None = None,
        author: str | None = None,
        publication_year: int | None = None,
        description: str | None = None,
        is_official_source: bool = False,
        confirmation_id: str | None = None,
    ) -> dict[str, Any]:
        """Prepare a shared PDF upload and report possible duplicates before transfer."""
        metadata = IngestMetadata(
            school=school,
            major=major,
            course=course,
            unit=unit,
            material_type=material_type,
            title=title,
            source_name=source_name,
            author=author,
            publication_year=publication_year,
            description=description,
            is_official_source=is_official_source,
        )
        return _json(service.prepare_material_upload(metadata, confirmation_id))

    @server.tool(structured_output=True)
    def get_upload_result(intent_id: str) -> dict[str, Any]:
        """Return the processing result for a prepared upload intent."""
        return _json(service.get_upload_result(intent_id))

    @server.tool(structured_output=True)
    def list_materials(
        school: str | None = None,
        major: str | None = None,
        course: str | None = None,
        unit: str | None = None,
        material_type: str | None = None,
        limit: int = 5,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List searchable shared materials with exact scope filters."""
        return _json(
            service.list_materials(
                school=school,
                major=major,
                course=course,
                unit=unit,
                material_type=material_type,
                limit=limit,
                cursor=cursor,
            )
        )

    @server.tool(structured_output=True)
    def search_course_material(
        query: str,
        school: str = "南京理工大学",
        major: str = "计算机科学与技术",
        course: str | None = None,
        unit: str | None = None,
        material_type: str | None = None,
        document_id: str | None = None,
        limit: int = 5,
        cursor: str | None = None,
        debug: bool = False,
    ) -> dict[str, Any]:
        """Search evidence in a school/major scope; defaults to NJUST computer science."""
        return _json(
            service.search_materials(
                SearchRequest(
                    query=query,
                    school=school,
                    major=major,
                    course=course,
                    unit=unit,
                    material_type=material_type,
                    document_id=document_id,
                    limit=limit,
                    cursor=cursor,
                    debug=debug,
                )
            )
        )

    @server.tool(structured_output=True)
    def get_document_content(
        document_id: str, limit: int = 20, cursor: str | None = None
    ) -> dict[str, Any]:
        """Page through the full parsed text of one current document."""
        return _json(service.get_document_content(document_id, limit=limit, cursor=cursor))

    @server.tool(structured_output=True)
    def get_document_download(document_id: str) -> dict[str, Any]:
        """Create a short-lived URL for downloading one original PDF."""
        return _json(service.get_document_download(document_id))

    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Remote shared course RAG MCP")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args()
    if args.version:
        print(f"mcp-sdk {importlib.metadata.version('mcp')}")
        return
    raise SystemExit("Run material_service.app.main:app to serve the remote /mcp endpoint.")


if __name__ == "__main__":
    main()
