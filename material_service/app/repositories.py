from sqlalchemy import func, select
from sqlalchemy.orm import Session

from material_service.app.models import (
    Document,
    DocumentVersion,
    IngestionRun,
    StoredFile,
)
from material_service.app.schemas import IngestResult


def find_ingestion_run(session: Session, idempotency_key: str) -> IngestionRun | None:
    return session.scalar(
        select(IngestionRun).where(IngestionRun.idempotency_key == idempotency_key)
    )


def find_stored_file(session: Session, sha256: str) -> StoredFile | None:
    return session.scalar(select(StoredFile).where(StoredFile.sha256 == sha256))


def load_successful_ingest_result(session: Session, run: IngestionRun) -> IngestResult:
    if run.status != "success" or run.document_id is None or run.file_id is None:
        raise ValueError("Ingestion run does not contain a successful result")
    document = session.get(Document, run.document_id)
    if document is None or document.current_version_id is None:
        raise ValueError("Successful ingestion run points to a missing document")
    version = session.get(DocumentVersion, document.current_version_id)
    if version is None:
        raise ValueError("Successful ingestion run points to a missing version")
    previous_uses = session.scalar(
        select(func.count())
        .select_from(DocumentVersion)
        .where(DocumentVersion.file_id == run.file_id, DocumentVersion.id != version.id)
    )
    return IngestResult(
        document_id=document.id,
        document_version_id=version.id,
        file_id=run.file_id,
        page_count=version.page_count,
        chunk_count=version.chunk_count,
        duplicate_file=bool(previous_uses),
        searchable=version.searchable,
    )

