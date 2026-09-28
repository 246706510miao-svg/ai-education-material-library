from datetime import UTC, datetime

import pytest
from alembic import command
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from material_service.app.models import (
    Document,
    DocumentChunk,
    DocumentVersion,
    IngestionRun,
    StoredFile,
)
from tests.integration.test_migrations import alembic_config


@pytest.fixture(autouse=True)
def migrated_database(postgres_url: str) -> None:
    command.upgrade(alembic_config(postgres_url), "head")


def stored_file(file_id: str, sha256: str) -> StoredFile:
    return StoredFile(
        id=file_id,
        sha256=sha256,
        original_name=f"{file_id}.pdf",
        storage_key=f"aa/{sha256}.pdf",
        size_bytes=128,
        mime_type="application/pdf",
        created_at=datetime.now(UTC),
    )


def test_stored_file_sha256_is_unique(postgres_engine: Engine) -> None:
    """Saving identical bytes as a second physical file must be rejected."""
    with Session(postgres_engine) as session:
        session.add_all([stored_file("file_one", "a" * 64), stored_file("file_two", "a" * 64)])

        with pytest.raises(IntegrityError):
            session.commit()


def test_ingestion_idempotency_key_is_unique(postgres_engine: Engine) -> None:
    """Retrying one upload request must not create a second ingestion run."""
    now = datetime.now(UTC)
    with Session(postgres_engine) as session:
        session.add_all(
            [
                IngestionRun(
                    id="run_one",
                    idempotency_key="same-request",
                    status="running",
                    stage="validating_file",
                    created_at=now,
                ),
                IngestionRun(
                    id="run_two",
                    idempotency_key="same-request",
                    status="running",
                    stage="validating_file",
                    created_at=now,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()


def test_document_version_number_is_unique_within_document(postgres_engine: Engine) -> None:
    """Two rows must not claim to be the same version of one logical document."""
    now = datetime.now(UTC)
    with Session(postgres_engine) as session:
        file = stored_file("file_version", "b" * 64)
        document = Document(
            id="doc_one",
            title="多重积分讲义",
            school="南京理工大学",
            major="计算机科学与技术",
            course="高等数学",
            unit="多重积分",
            source_name="课程资料整理",
            material_type="course_material",
            is_official_source=False,
            created_at=now,
        )
        session.add_all([file, document])
        session.flush()
        session.add_all(
            [
                DocumentVersion(
                    id="docv_one",
                    document_id=document.id,
                    file_id=file.id,
                    version_number=1,
                    processing_status="ready",
                    publication_status="approved",
                    searchable=True,
                    parser_version="pdf-parser-0.1",
                    page_count=1,
                    chunk_count=1,
                    created_at=now,
                ),
                DocumentVersion(
                    id="docv_two",
                    document_id=document.id,
                    file_id=file.id,
                    version_number=1,
                    processing_status="ready",
                    publication_status="approved",
                    searchable=True,
                    parser_version="pdf-parser-0.1",
                    page_count=1,
                    chunk_count=1,
                    created_at=now,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()


def test_document_allows_only_one_version(postgres_engine: Engine) -> None:
    """A logical document must not accumulate historical versions in the POC."""
    now = datetime.now(UTC)
    with Session(postgres_engine) as session:
        file = stored_file("file_single_version", "d" * 64)
        document = Document(
            id="doc_single_version",
            title="多重积分讲义",
            school="南京理工大学",
            major="计算机科学与技术",
            course="高等数学",
            unit="多重积分",
            material_type="textbook",
            is_official_source=False,
            created_at=now,
        )
        session.add_all([file, document])
        session.flush()
        session.add_all(
            [
                DocumentVersion(
                    id="docv_single_one",
                    document_id=document.id,
                    file_id=file.id,
                    version_number=1,
                    processing_status="ready",
                    publication_status="approved",
                    searchable=True,
                    parser_version="pdf-parser-0.1",
                    page_count=1,
                    chunk_count=1,
                    created_at=now,
                ),
                DocumentVersion(
                    id="docv_single_two",
                    document_id=document.id,
                    file_id=file.id,
                    version_number=2,
                    processing_status="ready",
                    publication_status="approved",
                    searchable=True,
                    parser_version="pdf-parser-0.1",
                    page_count=1,
                    chunk_count=1,
                    created_at=now,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()


def test_chunk_index_is_unique_within_document_version(postgres_engine: Engine) -> None:
    """Two chunks must not occupy the same ordered position in one version."""
    now = datetime.now(UTC)
    with Session(postgres_engine) as session:
        file = stored_file("file_chunks", "c" * 64)
        document = Document(
            id="doc_chunks",
            title="多重积分例题",
            school="南京理工大学",
            major="计算机科学与技术",
            course="高等数学",
            unit="多重积分",
            source_name="课程资料整理",
            material_type="course_material",
            is_official_source=False,
            created_at=now,
        )
        version = DocumentVersion(
            id="docv_chunks",
            document_id=document.id,
            file_id=file.id,
            version_number=1,
            processing_status="ready",
            publication_status="approved",
            searchable=True,
            parser_version="pdf-parser-0.1",
            page_count=1,
            chunk_count=2,
            created_at=now,
        )
        session.add_all([file, document])
        session.flush()
        session.add(version)
        session.flush()
        session.add_all(
            [
                DocumentChunk(
                    id="chunk_one",
                    document_version_id=version.id,
                    chunk_index=0,
                    page_start=1,
                    page_end=1,
                    text="二重积分定义",
                    content_type="body",
                    text_quality="complete",
                    formula_status="possibly_missing",
                    has_figure=False,
                    created_at=now,
                ),
                DocumentChunk(
                    id="chunk_two",
                    document_version_id=version.id,
                    chunk_index=0,
                    page_start=1,
                    page_end=1,
                    text="二重积分计算",
                    content_type="body",
                    text_quality="complete",
                    formula_status="possibly_missing",
                    has_figure=False,
                    created_at=now,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()

