from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session, sessionmaker

from material_service.app.models import DocumentChunk, DocumentVersion
from material_service.app.schemas import IngestMetadata, SearchRequest
from material_service.app.services import MaterialService
from material_service.app.transfers import TransferTokenService
from tests.fixture_factory import create_text_pdf
from tests.integration.test_migrations import alembic_config


@pytest.fixture(autouse=True)
def migrated_database(postgres_url: str, postgres_engine: Engine) -> Iterator[None]:
    command.upgrade(alembic_config(postgres_url), "head")
    yield
    with postgres_engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE document_chunks, document_versions, ingestion_runs, "
                "documents, stored_files, api_clients CASCADE"
            )
        )


@pytest.fixture
def service(postgres_engine: Engine, tmp_path: Path) -> MaterialService:
    class FakeEmbeddingProvider:
        model_name = "test-embedding"

        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            return [
                ([0.0, 1.0] + [0.0] * 382)
                if "Green theorem" in text or "' OR 1=1 --" in text
                else ([1.0, 0.0] + [0.0] * 382)
                for text in texts
            ]

    return MaterialService(
        session_factory=sessionmaker(bind=postgres_engine, expire_on_commit=False),
        storage_root=tmp_path / "materials",
        max_file_bytes=50 * 1024 * 1024,
        max_pdf_pages=300,
        chunk_target_chars=900,
        chunk_max_chars=1200,
        chunk_overlap_chars=150,
        processing_timeout_seconds=120,
        embedding_provider=FakeEmbeddingProvider(),
        transfer_service=TransferTokenService(b"transfer-test-secret"),
    )


def metadata(title: str, unit: str = "多重积分") -> IngestMetadata:
    return IngestMetadata(
        title=title,
        school="南京理工大学",
        major="计算机科学与技术",
        course="高等数学",
        unit=unit,
        source_name="课程资料整理",
        material_type="course_material",
    )


def ingest(
    service: MaterialService,
    tmp_path: Path,
    *,
    title: str,
    key: str,
    unit: str = "多重积分",
):
    path = create_text_pdf(tmp_path / f"{key}.pdf")
    return service.ingest_pdf(
        BytesIO(path.read_bytes()), path.name, metadata(title, unit), idempotency_key=key
    )


def test_list_materials_filters_scope_and_omits_non_searchable_versions(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A list request must not expose a failed/non-searchable current version."""
    visible = ingest(service, tmp_path, title="多重积分讲义", key="visible")
    hidden = ingest(service, tmp_path, title="未通过资料", key="hidden")
    ingest(service, tmp_path, title="极限讲义", key="other-unit", unit="极限")
    with Session(postgres_engine) as session:
        hidden_version = session.get(DocumentVersion, hidden.document_version_id)
        assert hidden_version is not None
        hidden_version.searchable = False
        session.commit()

    page = service.list_materials(course="高等数学", unit="多重积分", limit=10)

    assert [item.document_id for item in page.items] == [visible.document_id]
    assert page.items[0].title == "多重积分讲义"
    assert page.items[0].page_count == 2


def test_search_materials_returns_traceable_quality_flags(
    service: MaterialService, tmp_path: Path
) -> None:
    """A search hit must contain source, page range, score type and quality warnings."""
    result = ingest(service, tmp_path, title="交换积分次序", key="searchable")

    response = service.search_materials(
        SearchRequest(
            query="Change the order",
            course="高等数学",
            unit="多重积分",
            document_id=result.document_id,
            limit=10,
        )
    )

    assert response.status == "success"
    assert len(response.items) == 1
    item = response.items[0]
    assert item.document_id == result.document_id
    assert item.document_title == "交换积分次序"
    assert item.page_start == 1
    assert item.page_end == 2
    assert item.source_name == "课程资料整理"
    assert item.score_type == "rrf"
    assert "FORMULA_MAY_BE_INCOMPLETE" in item.quality_flags


def test_search_materials_excludes_unusable_chunks(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A chunk marked unusable must never be returned as ordinary evidence."""
    result = ingest(service, tmp_path, title="不可用片段", key="unusable")
    with Session(postgres_engine) as session:
        chunk = session.scalar(
            select(DocumentChunk).where(
                DocumentChunk.document_version_id == result.document_version_id
            )
        )
        assert chunk is not None
        chunk.text_quality = "unusable"
        session.commit()

    response = service.search_materials(SearchRequest(query="Double integral", limit=10))

    assert response.status == "not_found"
    assert response.items == []


def test_search_materials_returns_not_found_for_absent_text(
    service: MaterialService, tmp_path: Path
) -> None:
    """No match is a normal empty result, not a database error."""
    ingest(service, tmp_path, title="多重积分讲义", key="no-match")

    response = service.search_materials(SearchRequest(query="Green theorem", limit=10))

    assert response.status == "not_found"
    assert response.items == []


def test_search_uses_bound_parameters_for_user_text(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """User query text must not be interpolated into SQL."""
    ingest(service, tmp_path, title="安全查询", key="parameterized")
    statements: list[tuple[str, object]] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append((statement, parameters))

    event.listen(postgres_engine, "before_cursor_execute", capture_statement)
    try:
        response = service.search_materials(SearchRequest(query="' OR 1=1 --", limit=10))
    finally:
        event.remove(postgres_engine, "before_cursor_execute", capture_statement)

    assert response.status == "not_found"
    search_statements = [entry for entry in statements if "document_chunks" in entry[0]]
    assert search_statements
    assert all("' OR 1=1 --" not in statement for statement, _ in search_statements)
    assert any("' OR 1=1 --" in repr(parameters) for _, parameters in search_statements)


def test_search_scope_filters_are_exact(service: MaterialService, tmp_path: Path) -> None:
    """A school filter must never leak a similarly named institution into results."""
    ingest(service, tmp_path, title="多重积分讲义", key="scope")

    found = service.search_materials(
        SearchRequest(query="Double integral", school="南京理工大学", limit=5)
    )
    missing = service.search_materials(
        SearchRequest(query="Double integral", school="南京理工", limit=5)
    )

    assert found.status == "success"
    assert all(item.school == "南京理工大学" for item in found.items)
    assert missing.status == "not_found"


def test_document_content_is_paged_and_raw(service: MaterialService, tmp_path: Path) -> None:
    """Whole-document access must be bounded while preserving parsed source text and pages."""
    result = ingest(service, tmp_path, title="分页讲义", key="content-page")

    page = service.get_document_content(result.document_id, limit=1)

    assert len(page.items) == 1
    assert page.items[0].page_start == 1
    assert "Double integral" in page.items[0].text
    assert "school:" not in page.items[0].text


def test_document_download_returns_short_lived_url(
    service: MaterialService, tmp_path: Path
) -> None:
    """Original PDF access must expose a capability URL, never a storage path."""
    result = ingest(service, tmp_path, title="下载讲义", key="download")

    download = service.get_document_download(result.document_id)

    assert download.document_id == result.document_id
    assert download.download_url.startswith("/transfers/downloads/")
    assert "materials" not in download.download_url

