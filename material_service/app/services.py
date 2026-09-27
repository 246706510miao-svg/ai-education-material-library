from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import BinaryIO
from uuid import uuid4

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from material_service.app.errors import (
    DatabaseUnavailableError,
    MaterialServiceError,
    PdfProcessingTimeoutError,
)
from material_service.app.models import (
    Document,
    DocumentChunk,
    DocumentVersion,
    IngestionRun,
    StoredFile,
)
from material_service.app.pdf_parser import PARSER_VERSION, chunk_pages, extract_pdf
from material_service.app.repositories import (
    find_ingestion_run,
    find_stored_file,
    load_successful_ingest_result,
)
from material_service.app.schemas import IngestMetadata, IngestResult
from material_service.app.storage import StoredFilePayload, store_pdf


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class MaterialService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        storage_root: Path,
        max_file_bytes: int,
        max_pdf_pages: int,
        chunk_max_chars: int,
        processing_timeout_seconds: int,
    ) -> None:
        self._session_factory = session_factory
        self._storage_root = storage_root
        self._max_file_bytes = max_file_bytes
        self._max_pdf_pages = max_pdf_pages
        self._chunk_max_chars = chunk_max_chars
        self._processing_timeout_seconds = processing_timeout_seconds

    def ingest_pdf(
        self,
        stream: BinaryIO,
        original_name: str,
        metadata: IngestMetadata,
        idempotency_key: str,
    ) -> IngestResult:
        existing = self._existing_result(idempotency_key)
        if existing is not None:
            return existing
        run_id = self._create_run(idempotency_key)
        started = monotonic()
        stage = "storing_file"
        try:
            stored = store_pdf(
                stream,
                original_name,
                self._storage_root,
                max_bytes=self._max_file_bytes,
            )
            self._ensure_within_timeout(started)
            stage = "extracting"
            parsed = extract_pdf(
                self._storage_root / stored.storage_key,
                max_pages=self._max_pdf_pages,
            )
            self._ensure_within_timeout(started)
            stage = "chunking"
            chunks = chunk_pages(parsed.pages, max_chars=self._chunk_max_chars)
            self._ensure_within_timeout(started)
            stage = "writing_database"
            return self._write_material(
                run_id=run_id,
                stored=stored,
                metadata=metadata,
                page_count=parsed.page_count,
                chunks=chunks,
                started=started,
            )
        except MaterialServiceError as error:
            self._mark_failed(run_id, stage, error.error_code, str(error), started)
            raise
        except SQLAlchemyError as error:
            mapped = DatabaseUnavailableError("The material database operation failed.")
            self._mark_failed(run_id, stage, mapped.error_code, str(mapped), started)
            raise mapped from error

    def _existing_result(self, idempotency_key: str) -> IngestResult | None:
        try:
            with self._session_factory() as session:
                run = find_ingestion_run(session, idempotency_key)
                if run is None:
                    return None
                if run.status == "success":
                    return load_successful_ingest_result(session, run)
                if run.status == "failed":
                    error = MaterialServiceError(run.error_message or "Previous ingestion failed.")
                    error.error_code = run.error_code or "INTERNAL_ERROR"
                    raise error
                raise MaterialServiceError("An ingestion with this key is already running.")
        except MaterialServiceError:
            raise
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def _create_run(self, idempotency_key: str) -> str:
        run_id = _new_id("run")
        try:
            with self._session_factory() as session:
                session.add(
                    IngestionRun(
                        id=run_id,
                        idempotency_key=idempotency_key,
                        status="running",
                        stage="validating_file",
                        created_at=datetime.now(UTC),
                    )
                )
                session.commit()
            return run_id
        except IntegrityError as error:
            raise DatabaseUnavailableError(
                "A concurrent ingestion used the same idempotency key; retry the request."
            ) from error
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def _write_material(
        self,
        *,
        run_id: str,
        stored: StoredFilePayload,
        metadata: IngestMetadata,
        page_count: int,
        chunks: list,
        started: float,
    ) -> IngestResult:
        with self._session_factory() as session:
            stored_file = find_stored_file(session, stored.sha256)
            duplicate_file = stored_file is not None
            if stored_file is None:
                stored_file = StoredFile(
                    id=_new_id("file"),
                    sha256=stored.sha256,
                    original_name=stored.original_name,
                    storage_key=stored.storage_key,
                    size_bytes=stored.size_bytes,
                    mime_type=stored.mime_type,
                    created_at=datetime.now(UTC),
                )
                session.add(stored_file)
                session.flush()

            document = Document(
                id=_new_id("doc"),
                **metadata.model_dump(),
                created_at=datetime.now(UTC),
            )
            session.add(document)
            session.flush()
            version = DocumentVersion(
                id=_new_id("docv"),
                document_id=document.id,
                file_id=stored_file.id,
                version_number=1,
                processing_status="ready",
                publication_status="approved",
                searchable=True,
                parser_version=PARSER_VERSION,
                page_count=page_count,
                chunk_count=len(chunks),
                created_at=datetime.now(UTC),
            )
            session.add(version)
            session.flush()
            session.add_all(
                [
                    DocumentChunk(
                        id=_new_id("chunk"),
                        document_version_id=version.id,
                        chunk_index=chunk.chunk_index,
                        page_start=chunk.page_start,
                        page_end=chunk.page_end,
                        text=chunk.text,
                        heading_path=chunk.heading_path,
                        content_type=chunk.content_type,
                        text_quality=chunk.text_quality,
                        formula_status=chunk.formula_status,
                        has_figure=chunk.has_figure,
                        quality_flags=chunk.quality_flags,
                        created_at=datetime.now(UTC),
                    )
                    for chunk in chunks
                ]
            )
            document.current_version_id = version.id
            run = session.get(IngestionRun, run_id)
            if run is None:
                raise DatabaseUnavailableError("The ingestion run disappeared before commit.")
            run.file_id = stored_file.id
            run.document_id = document.id
            run.status = "success"
            run.stage = "success"
            run.duration_ms = int((monotonic() - started) * 1000)
            run.finished_at = datetime.now(UTC)
            session.commit()
            return IngestResult(
                document_id=document.id,
                document_version_id=version.id,
                file_id=stored_file.id,
                page_count=page_count,
                chunk_count=len(chunks),
                duplicate_file=duplicate_file,
                searchable=True,
            )

    def _mark_failed(
        self,
        run_id: str,
        stage: str,
        error_code: str,
        message: str,
        started: float,
    ) -> None:
        try:
            with self._session_factory() as session:
                run = session.get(IngestionRun, run_id)
                if run is None:
                    return
                run.status = "failed"
                run.stage = stage
                run.error_code = error_code
                run.error_message = message
                run.duration_ms = int((monotonic() - started) * 1000)
                run.finished_at = datetime.now(UTC)
                session.commit()
        except SQLAlchemyError:
            return

    def _ensure_within_timeout(self, started: float) -> None:
        if monotonic() - started > self._processing_timeout_seconds:
            raise PdfProcessingTimeoutError("PDF processing exceeded the synchronous timeout.")

