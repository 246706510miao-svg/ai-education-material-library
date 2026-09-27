import argparse
import json
from pathlib import Path
from typing import Any, Protocol

from mcp_server.client import MaterialApiClient, MaterialApiError


class UploadClient(Protocol):
    def upload_pdf(self, *, file_path: Path, metadata: dict[str, Any]) -> dict[str, Any]: ...


def display_result(result: dict[str, Any]) -> str:
    status = result.get("status")
    if status == "not_found":
        return "未找到匹配资料。"
    if status == "error":
        return f"调用失败 [{result.get('error_code', 'UNKNOWN')}]: {result.get('message', '')}"
    items = result.get("items")
    if isinstance(items, list) and items:
        lines = ["资料 | 来源 | 页码 | 正文"]
        for item in items:
            page_range = f"{item.get('page_start', '-')}-{item.get('page_end', '-')}"
            lines.append(
                " | ".join(
                    [
                        str(item.get("document_title", item.get("title", ""))),
                        str(item.get("source_name", "")),
                        page_range,
                        str(item.get("text", "")),
                    ]
                )
            )
        return "\n".join(lines)
    return json.dumps(result, ensure_ascii=False, indent=2)


def upload_from_form(
    client: UploadClient,
    *,
    file_path: Path,
    title: str,
    course: str,
    unit: str,
    source_name: str,
    source_type: str,
) -> str:
    result = client.upload_pdf(
        file_path=file_path,
        metadata={
            "title": title,
            "course": course,
            "unit": unit,
            "source_name": source_name,
            "source_type": source_type,
        },
    )
    return display_result(result)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Shared material library POC")
    subcommands = parser.add_subparsers(dest="command", required=True)

    upload = subcommands.add_parser("upload", help="Upload and parse a local text PDF")
    upload.add_argument("file_path", type=Path)
    upload.add_argument("--title", required=True)
    upload.add_argument("--course", default="高等数学")
    upload.add_argument("--unit", default="多重积分")
    upload.add_argument("--source-name", required=True)
    upload.add_argument("--source-type", default="course_material")

    listing = subcommands.add_parser("list", help="List searchable materials")
    listing.add_argument("--course")
    listing.add_argument("--unit")
    listing.add_argument("--limit", type=int, default=10)

    search = subcommands.add_parser("search", help="Search stored source chunks")
    search.add_argument("query")
    search.add_argument("--course")
    search.add_argument("--unit")
    search.add_argument("--document-id")
    search.add_argument("--limit", type=int, default=10)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    client = MaterialApiClient.from_environment()
    try:
        if args.command == "upload":
            rendered = upload_from_form(
                client,
                file_path=args.file_path,
                title=args.title,
                course=args.course,
                unit=args.unit,
                source_name=args.source_name,
                source_type=args.source_type,
            )
        elif args.command == "list":
            rendered = display_result(
                client.list_materials(course=args.course, unit=args.unit, limit=args.limit)
            )
        else:
            rendered = display_result(
                client.search_materials(
                    query=args.query,
                    course=args.course,
                    unit=args.unit,
                    document_id=args.document_id,
                    limit=args.limit,
                )
            )
    except MaterialApiError as error:
        rendered = display_result(
            {
                "status": "error",
                "error_code": error.error_code,
                "message": str(error),
                "request_id": error.request_id,
            }
        )
    print(rendered)


if __name__ == "__main__":
    main()

