from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from material_service.app.models import (
    Document,
    DocumentChunk,
    DocumentVersion,
    IngestionRun,
    StoredFile,
)
from material_service.app.schemas import IngestResult, MaterialItem, SearchItem


def find_ingestion_run(session: Session, idempotency_key: str) -> IngestionRun | None:
    return session.scalar(
        select(IngestionRun).where(IngestionRun.idempotency_key == idempotency_key)
    )


def find_stored_file(session: Session, sha256: str) -> StoredFile | None:
    return session.scalar(select(StoredFile).where(StoredFile.sha256 == sha256))


def find_document_by_file(
    session: Session, file_id: str
) -> tuple[Document, DocumentVersion] | None:
    return session.execute(
        select(Document, DocumentVersion)
        .join(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(DocumentVersion.file_id == file_id)
    ).one_or_none()


def possible_duplicate_rows(
    session: Session,
    *,
    school: str,
    major: str,
    course: str,
    material_type: str,
) -> list[tuple[Document, DocumentVersion]]:
    return list(
        session.execute(
            select(Document, DocumentVersion)
            .join(DocumentVersion, Document.current_version_id == DocumentVersion.id)
            .where(
                Document.school == school,
                Document.major == major,
                Document.course == course,
                Document.material_type == material_type,
            )
        ).all()
    )


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
        status=(
            "duplicate"
            if run.stage == "duplicate"
            else "partial_success"
            if run.stage == "embedding_failed"
            else "success"
        ),
        document_id=document.id,
        document_version_id=version.id,
        file_id=run.file_id,
        page_count=version.page_count,
        chunk_count=version.chunk_count,
        duplicate_file=run.stage == "duplicate" or bool(previous_uses),
        searchable=version.searchable,
        retrieval_modes=["lexical"] if run.stage == "embedding_failed" else ["lexical", "semantic"],
        warning_code="EMBEDDING_FAILED" if run.stage == "embedding_failed" else None,
    )


def list_materials_query(
    *, course: str | None, unit: str | None, limit: int
) -> Select[tuple[Document, DocumentVersion]]:
    statement = (
        select(Document, DocumentVersion)
        .join(DocumentVersion, Document.current_version_id == DocumentVersion.id)
        .where(DocumentVersion.searchable.is_(True))
    )
    if course is not None:
        statement = statement.where(Document.course == course)
    if unit is not None:
        statement = statement.where(Document.unit == unit)
    return statement.order_by(Document.created_at.desc(), Document.id).limit(limit)


def list_materials(
    session: Session, *, course: str | None, unit: str | None, limit: int
) -> list[MaterialItem]:
    rows = session.execute(list_materials_query(course=course, unit=unit, limit=limit)).all()
    return [
        MaterialItem(
            document_id=document.id,
            title=document.title,
            school=document.school,
            major=document.major,
            course=document.course,
            unit=document.unit,
            source_name=document.source_name,
            material_type=document.material_type,
            page_count=version.page_count,
            chunk_count=version.chunk_count,
        )
        for document, version in rows
    ]


def search_materials(
    session: Session,
    *,
    query: str,
    course: str | None,
    unit: str | None,
    document_id: str | None,
    limit: int,
) -> list[SearchItem]:
    vector = func.to_tsvector("simple", DocumentChunk.text)
    tsquery = func.websearch_to_tsquery("simple", query)
    score = func.ts_rank_cd(vector, tsquery).label("score")
    statement = (
        select(DocumentChunk, Document, score)
        .join(DocumentVersion, DocumentChunk.document_version_id == DocumentVersion.id)
        .join(Document, DocumentVersion.document_id == Document.id)
        .where(
            Document.current_version_id == DocumentVersion.id,
            DocumentVersion.searchable.is_(True),
            DocumentChunk.text_quality != "unusable",
            or_(vector.op("@@")(tsquery), DocumentChunk.text.ilike(f"%{query}%")),
        )
    )
    if course is not None:
        statement = statement.where(Document.course == course)
    if unit is not None:
        statement = statement.where(Document.unit == unit)
    if document_id is not None:
        statement = statement.where(Document.id == document_id)
    rows = session.execute(
        statement.order_by(score.desc(), DocumentChunk.id).limit(limit)
    ).all()
    return [
        SearchItem(
            chunk_id=chunk.id,
            text=chunk.text,
            document_id=document.id,
            document_title=document.title,
            page_start=chunk.page_start,
            page_end=chunk.page_end,
            source_name=document.source_name,
            material_type=document.material_type,
            quality_flags=chunk.quality_flags,
            score=float(rank or 0.0),
        )
        for chunk, document, rank in rows
    ]

