import json
from pathlib import Path

from frontend_poc.app import display_result, upload_from_form


class RecordingClient:
    def __init__(self, result: dict) -> None:
        self.result = result
        self.received_path: Path | None = None
        self.received_metadata: dict | None = None

    def upload_pdf(self, *, file_path: Path, metadata: dict) -> dict:
        self.received_path = file_path
        self.received_metadata = metadata
        return self.result


def test_upload_form_passes_local_path_and_required_metadata(tmp_path: Path) -> None:
    """The POC must send the selected local PDF and all required source fields."""
    path = tmp_path / "material.pdf"
    path.write_bytes(b"%PDF-1.7\nfixture")
    client = RecordingClient(
        {
            "status": "success",
            "document_id": "doc_one",
            "page_count": 2,
            "chunk_count": 3,
        }
    )

    rendered = upload_from_form(
        client,
        file_path=path,
        title="多重积分讲义",
        course="高等数学",
        unit="多重积分",
        source_name="课程资料整理",
        source_type="course_material",
    )

    assert client.received_path == path
    assert client.received_metadata == {
        "title": "多重积分讲义",
        "course": "高等数学",
        "unit": "多重积分",
        "source_name": "课程资料整理",
        "source_type": "course_material",
    }
    assert json.loads(rendered)["document_id"] == "doc_one"


def test_display_result_distinguishes_not_found_from_error() -> None:
    """A normal empty search must not look like a failed service call."""
    not_found = display_result({"status": "not_found", "items": []})
    error = display_result(
        {
            "status": "error",
            "error_code": "DATABASE_UNAVAILABLE",
            "message": "Database unavailable",
        }
    )

    assert "未找到匹配资料" in not_found
    assert "DATABASE_UNAVAILABLE" not in not_found
    assert "调用失败" in error
    assert "DATABASE_UNAVAILABLE" in error


def test_display_result_shows_traceable_search_columns() -> None:
    """Search display must keep text, material title, source and page range visible."""
    rendered = display_result(
        {
            "status": "success",
            "items": [
                {
                    "text": "Change the order of integration.",
                    "document_title": "多重积分讲义",
                    "source_name": "课程资料整理",
                    "page_start": 2,
                    "page_end": 3,
                }
            ],
        }
    )

    assert "多重积分讲义" in rendered
    assert "课程资料整理" in rendered
    assert "2-3" in rendered
    assert "Change the order of integration." in rendered

