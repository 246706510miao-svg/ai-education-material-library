import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import BinaryIO
from uuid import uuid4

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from material_service.app.chunking import build_chunks
from material_service.app.embedding import EmbeddingProvider, build_embedding_text
from material_service.app.errors import (
    DatabaseUnavailableError,
    EmbeddingUnavailableError,
    InvalidArgumentError,
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
from material_service.app.pdf_parser import PARSER_VERSION, extract_pdf
from material_service.app.repositories import (
    document_content_rows,
    document_file_row,
    find_document_by_file,
    find_ingestion_run,
    find_stored_file,
    lexical_candidate_rows,
    load_successful_ingest_result,
    possible_duplicate_rows,
    vector_candidate_rows,
)
from material_service.app.repositories import (
    list_materials as list_material_rows,
)
from material_service.app.retrieval import (
    decode_cursor,
    encode_cursor,
    query_fingerprint,
    reciprocal_rank_fusion,
)
from material_service.app.schemas import (
    DocumentContentItem,
    DocumentContentPage,
    DocumentDownload,
    IngestMetadata,
    IngestResult,
    MaterialPage,
    PossibleDuplicate,
    PrepareUploadResult,
    SearchItem,
    SearchRequest,
    SearchResponse,
)
from material_service.app.storage import StoredFilePayload, store_pdf
from material_service.app.transfers import TransferTokenService


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class MaterialService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        storage_root: Path,
        max_file_bytes: int,
        max_pdf_pages: int,
        chunk_target_chars: int,
        chunk_max_chars: int,
        chunk_overlap_chars: int,
        processing_timeout_seconds: int,
        embedding_provider: EmbeddingProvider,
        transfer_service: TransferTokenService,
        upload_url_ttl_seconds: int = 600,
        download_url_ttl_seconds: int = 600,
    ) -> None:
        self._session_factory = session_factory
        self._storage_root = storage_root
        self._max_file_bytes = max_file_bytes
        self._max_pdf_pages = max_pdf_pages
        self._chunk_target_chars = chunk_target_chars
        self._chunk_max_chars = chunk_max_chars
        self._chunk_overlap_chars = chunk_overlap_chars
        self._processing_timeout_seconds = processing_timeout_seconds
        self._embedding_provider = embedding_provider
        self._transfer_service = transfer_service
        self._upload_url_ttl_seconds = upload_url_ttl_seconds
        self._download_url_ttl_seconds = download_url_ttl_seconds

    @staticmethod
    def _normalized_title(value: str) -> str:
        return re.sub(r"[^\w]+", "", value.casefold())

    @classmethod
    def _metadata_hash(cls, metadata: IngestMetadata) -> str:
        normalized = metadata.model_dump(mode="json")
        normalized["title"] = cls._normalized_title(metadata.title)
        value = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def create_download_url(self, file_id: str) -> str:
        token = self._transfer_service.issue_download(
            file_id=file_id, ttl_seconds=self._download_url_ttl_seconds
        )
        return f"/transfers/downloads/{token}"

    def get_document_content(
        self, document_id: str, *, limit: int = 20, cursor: str | None = None
    ) -> DocumentContentPage:
        bounded_limit = min(max(limit, 1), 20)
        fingerprint = query_fingerprint({"document_id": document_id, "kind": "content"})
        offset = decode_cursor(cursor, fingerprint)
        try:
            with self._session_factory() as session:
                rows = document_content_rows(
                    session,
                    document_id=document_id,
                    offset=offset,
                    limit=bounded_limit + 1,
                )
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error
        visible = rows[:bounded_limit]
        return DocumentContentPage(
            status="success" if visible else "not_found",
            document_id=document_id,
            items=[
                DocumentContentItem(
                    chunk_index=chunk.chunk_index,
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    heading_path=chunk.heading_path,
                    text=chunk.text,
                    quality_flags=chunk.quality_flags,
                )
                for chunk in visible
            ],
            next_cursor=(
                encode_cursor(offset + bounded_limit, fingerprint)
                if len(rows) > bounded_limit
                else None
            ),
        )

    def get_document_download(self, document_id: str) -> DocumentDownload:
        try:
            with self._session_factory() as session:
                row = document_file_row(session, document_id)
                if row is None:
                    return DocumentDownload(
                        status="not_found",
                        document_id=document_id,
                        download_url="",
                        expires_in_seconds=0,
                    )
                _document, _version, stored_file = row
                return DocumentDownload(
                    document_id=document_id,
                    download_url=self.create_download_url(stored_file.id),
                    expires_in_seconds=self._download_url_ttl_seconds,
                )
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def prepare_material_upload(
        self, metadata: IngestMetadata, confirmation_id: str | None = None
    ) -> PrepareUploadResult:
        metadata_hash = self._metadata_hash(metadata)
        try:
            with self._session_factory() as session:
                candidates = possible_duplicate_rows(
                    session,
                    school=metadata.school,
                    major=metadata.major,
                    course=metadata.course,
                    material_type=metadata.material_type,
                )
                title = self._normalized_title(metadata.title)
                duplicates = [
                    (document, version)
                    for document, version in candidates
                    if title in self._normalized_title(document.title)
                    or self._normalized_title(document.title) in title
                ]
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error
        if duplicates and confirmation_id is None:
            token = self._transfer_service.issue_confirmation(
                metadata_hash=metadata_hash, ttl_seconds=self._upload_url_ttl_seconds
            )
            return PrepareUploadResult(
                status="confirmation_required",
                confirmation_id=token,
                possible_duplicates=[
                    PossibleDuplicate(
                        document_id=document.id,
                        title=document.title,
                        download_url=self.create_download_url(version.file_id),
                    )
                    for document, version in duplicates
                ],
            )
        if confirmation_id is not None:
            self._transfer_service.consume_confirmation(
                confirmation_id, metadata_hash=metadata_hash
            )
        intent_id = _new_id("intent")
        token = self._transfer_service.issue_upload(
            intent_id=intent_id,
            metadata=metadata.model_dump(mode="json"),
            ttl_seconds=self._upload_url_ttl_seconds,
        )
        return PrepareUploadResult(
            status="ready",
            intent_id=intent_id,
            upload_url=f"/transfers/uploads/{token}",
            expires_in_seconds=self._upload_url_ttl_seconds,
        )

    def put_upload(self, token: str, stream: BinaryIO, original_name: str) -> IngestResult:
        payload = self._transfer_service.consume_upload(token)
        metadata = IngestMetadata.model_validate(payload["metadata"])
        return self.ingest_pdf(stream, original_name, metadata, str(payload["intent_id"]))

    def get_upload_result(self, intent_id: str) -> IngestResult:
        try:
            with self._session_factory() as session:
                run = find_ingestion_run(session, intent_id)
                if run is None:
                    raise InvalidArgumentError("The upload intent was not found.")
                return load_successful_ingest_result(session, run)
        except InvalidArgumentError:
            raise
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def resolve_download(self, token: str) -> tuple[Path, str, str]:
        payload = self._transfer_service.consume_download(token)
        try:
            with self._session_factory() as session:
                stored_file = session.get(StoredFile, str(payload["file_id"]))
                if stored_file is None:
                    raise InvalidArgumentError("The requested file was not found.")
                return (
                    self._storage_root / stored_file.storage_key,
                    stored_file.original_name,
                    stored_file.mime_type,
                )
        except InvalidArgumentError:
            raise
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def list_materials(
        self,
        *,
        course: str | None = None,
        unit: str | None = None,
        limit: int = 10,
        cursor: str | None = None,
    ) -> MaterialPage:
        del cursor  # Cursor pagination is reserved; the first version is limit-based.
        bounded_limit = min(max(limit, 1), 50)
        try:
            with self._session_factory() as session:
                items = list_material_rows(
                    session,
                    course=course,
                    unit=unit,
                    limit=bounded_limit,
                )
            return MaterialPage(items=items)
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

    def search_materials(self, request: SearchRequest) -> SearchResponse:
        filters = request.model_dump(
            include={
                "school",
                "major",
                "course",
                "unit",
                "material_type",
                "document_id",
            }
        )
        fingerprint = query_fingerprint({"query": request.query, **filters})
        offset = decode_cursor(request.cursor, fingerprint)
        vector_failed = False
        try:
            with self._session_factory() as session:
                lexical = lexical_candidate_rows(
                    session,
                    query=request.query,
                    **filters,
                )
            try:
                query_embedding = self._embedding_provider.embed_texts([request.query])[0]
                with self._session_factory() as session:
                    semantic = vector_candidate_rows(
                        session, query_embedding=query_embedding, **filters
                    )
            except (EmbeddingUnavailableError, SQLAlchemyError):
                semantic = []
                vector_failed = True
        except SQLAlchemyError as error:
            raise DatabaseUnavailableError("The material database is unavailable.") from error

        lexical_ids = [chunk.id for chunk, _document, _score in lexical]
        vector_ids = [chunk.id for chunk, _document, _score in semantic]
        fused = reciprocal_rank_fusion(lexical_ids, vector_ids)
        rows = {
            chunk.id: (chunk, document)
            for chunk, document, _score in [*lexical, *semantic]
        }
        cosine_scores = {chunk.id: float(score or 0.0) for chunk, _doc, score in semantic}
        page = fused[offset : offset + request.limit]
        items = []
        for fused_item in page:
            chunk, document = rows[fused_item.chunk_id]
            items.append(
                SearchItem(
                    chunk_id=chunk.id,
                    text=chunk.text,
                    document_id=document.id,
                    document_title=document.title,
                    school=document.school,
                    major=document.major,
                    course=document.course,
                    unit=document.unit,
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    source_name=document.source_name,
                    material_type=document.material_type,
                    quality_flags=chunk.quality_flags,
                    score=fused_item.score,
                    lexical_rank=fused_item.lexical_rank if request.debug else None,
                    vector_rank=fused_item.vector_rank if request.debug else None,
                    cosine_similarity=(
                        cosine_scores.get(chunk.id) if request.debug else None
                    ),
                )
            )
        next_offset = offset + len(items)
        next_cursor = (
            encode_cursor(next_offset, fingerprint) if next_offset < len(fused) else None
        )
        modes = ["lexical"] + ([] if vector_failed else ["semantic"])
        status = (
            "partial_success"
            if vector_failed and items
            else "success"
            if items
            else "not_found"
        )
        return SearchResponse(
            status=status,
            items=items,
            next_cursor=next_cursor,
            retrieval_modes=modes,
            warning_code="EMBEDDING_FAILED" if vector_failed else None,
        )

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
            duplicate = self._existing_file_result(run_id, stored, started)
            if duplicate is not None:
                return duplicate
            stage = "extracting"
            parsed = extract_pdf(
                self._storage_root / stored.storage_key,
                max_pages=self._max_pdf_pages,
            )
            self._ensure_within_timeout(started)
            stage = "chunking"
            chunks = build_chunks(
                parsed.pages,
                target_chars=self._chunk_target_chars,
                max_chars=self._chunk_max_chars,
                overlap_chars=self._chunk_overlap_chars,
            )
            self._ensure_within_timeout(started)
            embedding_failed = False
            try:
                inputs = [build_embedding_text(metadata, chunk) for chunk in chunks]
                embeddings = self._embedding_provider.embed_texts(inputs)
            except EmbeddingUnavailableError:
                embeddings = [None] * len(chunks)
                embedding_failed = True
            stage = "writing_database"
            return self._write_material(
                run_id=run_id,
                stored=stored,
                metadata=metadata,
                page_count=parsed.page_count,
                chunks=chunks,
                embeddings=embeddings,
                embedding_failed=embedding_failed,
                started=started,
            )
        except MaterialServiceError as error:
            self._mark_failed(run_id, stage, error.error_code, str(error), started)
            raise
        except SQLAlchemyError as error:
            mapped = DatabaseUnavailableError("The material database operation failed.")
            self._mark_failed(run_id, stage, mapped.error_code, str(mapped), started)
            raise mapped from error

    def _existing_file_result(
        self, run_id: str, stored: StoredFilePayload, started: float
    ) -> IngestResult | None:
        with self._session_factory() as session:
            stored_file = find_stored_file(session, stored.sha256)
            if stored_file is None:
                return None
            existing = find_document_by_file(session, stored_file.id)
            if existing is None:
                return None
            document, version = existing
            run = session.get(IngestionRun, run_id)
            if run is None:
                raise DatabaseUnavailableError("The ingestion run disappeared before commit.")
            run.file_id = stored_file.id
            run.document_id = document.id
            run.status = "success"
            run.stage = "duplicate"
            run.duration_ms = int((monotonic() - started) * 1000)
            run.finished_at = datetime.now(UTC)
            session.commit()
            return IngestResult(
                status="duplicate",
                document_id=document.id,
                document_version_id=version.id,
                file_id=stored_file.id,
                page_count=version.page_count,
                chunk_count=version.chunk_count,
                duplicate_file=True,
                searchable=version.searchable,
                download_url=self.create_download_url(stored_file.id),
            )

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
        embeddings: list[list[float] | None],
        embedding_failed: bool,
        started: float,
    ) -> IngestResult:
        with self._session_factory() as session:
            stored_file = find_stored_file(session, stored.sha256)
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
                        embedding=embedding,
                        embedding_model=(
                            None if embedding is None else self._embedding_provider.model_name
                        ),
                        embedding_version=None if embedding is None else "fastembed-0.8.1",
                        created_at=datetime.now(UTC),
                    )
                    for chunk, embedding in zip(chunks, embeddings, strict=True)
                ]
            )
            document.current_version_id = version.id
            run = session.get(IngestionRun, run_id)
            if run is None:
                raise DatabaseUnavailableError("The ingestion run disappeared before commit.")
            run.file_id = stored_file.id
            run.document_id = document.id
            run.status = "success"
            run.stage = "embedding_failed" if embedding_failed else "success"
            run.duration_ms = int((monotonic() - started) * 1000)
            run.finished_at = datetime.now(UTC)
            session.commit()
            return IngestResult(
                status="partial_success" if embedding_failed else "success",
                document_id=document.id,
                document_version_id=version.id,
                file_id=stored_file.id,
                page_count=page_count,
                chunk_count=len(chunks),
                duplicate_file=False,
                searchable=True,
                retrieval_modes=["lexical"] if embedding_failed else ["lexical", "semantic"],
                warning_code="EMBEDDING_FAILED" if embedding_failed else None,
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

