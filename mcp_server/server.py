import argparse
import importlib.metadata
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from mcp_server.client import MaterialApiClient


def create_server(client: MaterialApiClient) -> FastMCP:
    server = FastMCP(
        name="shared-material-library",
        instructions="Upload and retrieve traceable public course-material chunks.",
    )

    @server.tool(structured_output=True)
    def upload_pdf(
        file_path: str,
        title: str,
        course: str,
        unit: str,
        source_name: str,
        source_type: str = "course_material",
        author: str | None = None,
        publication_year: int | None = None,
        description: str | None = None,
        applicable_school: str | None = None,
        is_official_source: bool = False,
    ) -> dict[str, Any]:
        """Upload one local text-based PDF and return its stored identifiers."""

        result = client.upload_pdf(
            file_path=Path(file_path),
            metadata={
                "title": title,
                "course": course,
                "unit": unit,
                "source_name": source_name,
                "source_type": source_type,
                "author": author,
                "publication_year": publication_year,
                "description": description,
                "applicable_school": applicable_school,
                "is_official_source": is_official_source,
            },
        )
        return {"tool": "upload_pdf", "result": result}

    @server.tool(structured_output=True)
    def list_materials(
        course: str | None = None,
        unit: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """List searchable materials and their traceable metadata."""

        result = client.list_materials(course=course, unit=unit, limit=limit)
        return {"tool": "list_materials", "result": result}

    @server.tool(structured_output=True)
    def search_materials(
        query: str,
        course: str | None = None,
        unit: str | None = None,
        document_id: str | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """Return matching source chunks with document titles and PDF page ranges."""

        result = client.search_materials(
            query=query,
            course=course,
            unit=unit,
            document_id=document_id,
            limit=limit,
        )
        return {"tool": "search_materials", "result": result}

    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Local MCP adapter for shared course materials")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args()
    if args.version:
        print(f"mcp-sdk {importlib.metadata.version('mcp')}")
        return
    create_server(MaterialApiClient.from_environment()).run(transport="stdio")


if __name__ == "__main__":
    main()

