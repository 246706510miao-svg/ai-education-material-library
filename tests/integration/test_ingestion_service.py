from collections.abc import Iterator
from io import BytesIO
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from material_service.app.errors import (
    DatabaseUnavailableError,
    PdfTextNotExtractableError,
    TransferTokenInvalidError,
)
from material_service.app.models import (
    Document,
    DocumentChunk,
    DocumentVersion,
    IngestionRun,
    StoredFile,
)
from material_service.app.schemas import IngestMetadata
from material_service.app.services import MaterialService
from material_service.app.transfers import TransferTokenService
from tests.fixture_factory import create_image_only_pdf, create_text_pdf
from tests.integration.test_migrations import alembic_config


@pytest.fixture(autouse=True)
def migrated_database(postgres_url: str, postgres_engine: Engine) -> Iterator[None]:
    command.upgrade(alembic_config(postgres_url), "head")
    yield
    with postgres_engine.begin() as connection:
        connection.execute(text("DROP TRIGGER IF EXISTS reject_document_insert ON documents"))
        connection.execute(text("DROP FUNCTION IF EXISTS reject_document_insert()"))
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
            return [[0.0] * 384 for _text in texts]

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


def metadata(title: str = "多重积分讲义") -> IngestMetadata:
    return IngestMetadata(
        title=title,
        school="南京理工大学",
        major="计算机科学与技术",
        course="高等数学",
        unit="多重积分",
        source_name="课程资料整理",
        material_type="course_material",
    )


def pdf_stream(path: Path) -> BytesIO:
    return BytesIO(path.read_bytes())


def row_count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_ingest_pdf_persists_one_traceable_document(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A successful response must correspond to a complete file/document/version/chunk graph."""
    path = create_text_pdf(tmp_path / "text.pdf")

    result = service.ingest_pdf(pdf_stream(path), path.name, metadata(), "request-one")

    assert result.status == "success"
    assert result.page_count == 2
    assert result.chunk_count == 1
    assert result.searchable is True
    assert result.duplicate_file is False
    with Session(postgres_engine) as session:
        assert row_count(session, StoredFile) == 1
        assert row_count(session, Document) == 1
        assert row_count(session, DocumentVersion) == 1
        assert row_count(session, DocumentChunk) == 1
        run = session.scalar(select(IngestionRun))
        assert run is not None
        assert run.status == "success"
        document = session.get(Document, result.document_id)
        assert document is not None
        assert document.current_version_id == result.document_version_id


def test_ingest_pdf_returns_the_original_result_for_an_idempotent_retry(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A client retry with the same key must not duplicate database rows."""
    path = create_text_pdf(tmp_path / "retry.pdf")
    first = service.ingest_pdf(pdf_stream(path), path.name, metadata(), "same-request")

    second = service.ingest_pdf(pdf_stream(path), path.name, metadata(), "same-request")

    assert second == first
    with Session(postgres_engine) as session:
        assert row_count(session, IngestionRun) == 1
        assert row_count(session, Document) == 1
        assert row_count(session, DocumentChunk) == first.chunk_count


def test_ingest_pdf_rejects_identical_file_bytes_as_a_new_document(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """The same physical PDF must return the existing document instead of duplicating it."""
    path = create_text_pdf(tmp_path / "shared.pdf")
    first = service.ingest_pdf(pdf_stream(path), path.name, metadata("讲义 A"), "request-a")

    second = service.ingest_pdf(pdf_stream(path), path.name, metadata("讲义 B"), "request-b")

    assert first.file_id == second.file_id
    assert second.status == "duplicate"
    assert second.duplicate_file is True
    assert first.document_id == second.document_id
    with Session(postgres_engine) as session:
        assert row_count(session, StoredFile) == 1
        assert row_count(session, Document) == 1


def test_possible_duplicate_requires_metadata_bound_confirmation(
    service: MaterialService, tmp_path: Path
) -> None:
    """A same-scope similar title must be shown before another PDF can be uploaded."""
    path = create_text_pdf(tmp_path / "existing.pdf")
    existing = service.ingest_pdf(pdf_stream(path), path.name, metadata(), "existing-request")

    pending = service.prepare_material_upload(metadata("多重积分讲义（第二版）"))

    assert pending.status == "confirmation_required"
    assert pending.confirmation_id
    assert pending.possible_duplicates[0].document_id == existing.document_id
    assert pending.possible_duplicates[0].download_url.startswith("/transfers/downloads/")

    changed = metadata("完全不同的标题")
    with pytest.raises(TransferTokenInvalidError):
        service.prepare_material_upload(changed, pending.confirmation_id)


def test_image_only_pdf_records_failure_without_searchable_rows(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A scan failure must remain auditable but must not leak an empty document into search."""
    path = create_image_only_pdf(tmp_path / "scan.pdf")

    with pytest.raises(PdfTextNotExtractableError):
        service.ingest_pdf(pdf_stream(path), path.name, metadata(), "scan-request")

    with Session(postgres_engine) as session:
        assert row_count(session, Document) == 0
        assert row_count(session, DocumentVersion) == 0
        assert row_count(session, DocumentChunk) == 0
        run = session.scalar(select(IngestionRun))
        assert run is not None
        assert run.status == "failed"
        assert run.stage == "extracting"
        assert run.error_code == "PDF_TEXT_NOT_EXTRACTABLE"


def test_database_write_failure_rolls_back_material_and_records_failure(
    service: MaterialService, postgres_engine: Engine, tmp_path: Path
) -> None:
    """A failed document insert must not leave a partially searchable graph."""
    path = create_text_pdf(tmp_path / "database-failure.pdf")
    with postgres_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE FUNCTION reject_document_insert() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'forced document failure';
                END;
                $$ LANGUAGE plpgsql;
                CREATE TRIGGER reject_document_insert
                BEFORE INSERT ON documents
                FOR EACH ROW EXECUTE FUNCTION reject_document_insert();
                """
            )
        )

    with pytest.raises(DatabaseUnavailableError):
        service.ingest_pdf(pdf_stream(path), path.name, metadata(), "database-failure")

    with Session(postgres_engine) as session:
        assert row_count(session, Document) == 0
        assert row_count(session, DocumentVersion) == 0
        assert row_count(session, DocumentChunk) == 0
        run = session.scalar(select(IngestionRun))
        assert run is not None
        assert run.status == "failed"
        assert run.error_code == "DATABASE_UNAVAILABLE"

