from tempfile import SpooledTemporaryFile
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from material_service.app.auth import require_api_token
from material_service.app.errors import (
    DatabaseUnavailableError,
    FileTooLargeError,
    StorageUnavailableError,
)
from material_service.app.schemas import (
    IngestMetadata,
    IngestResult,
    MaterialPage,
    PrepareUploadResult,
    SearchRequest,
    SearchResponse,
)
from material_service.app.services import MaterialService

router = APIRouter()
protected = APIRouter(prefix="/v1", dependencies=[Depends(require_api_token)])


def get_service(request: Request) -> MaterialService:
    return request.app.state.material_service


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request) -> dict[str, str]:
    try:
        with request.app.state.session_factory() as session:
            session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise DatabaseUnavailableError("The material database is unavailable.") from error
    root = request.app.state.settings.material_storage_root
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / ".ready-probe"
        probe.write_bytes(b"ready")
        probe.unlink()
    except OSError as error:
        raise StorageUnavailableError("PDF storage is unavailable.") from error
    return {"status": "ready"}


@protected.post("/materials/ingest", response_model=IngestResult)
def ingest_material(
    request: Request,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()],
    school: Annotated[str, Form()],
    major: Annotated[str, Form()],
    course: Annotated[str, Form()],
    unit: Annotated[str, Form()],
    material_type: Annotated[str, Form()],
    idempotency_key: Annotated[str, Form()],
    source_name: Annotated[str | None, Form()] = None,
    author: Annotated[str | None, Form()] = None,
    publication_year: Annotated[int | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    is_official_source: Annotated[bool, Form()] = False,
) -> IngestResult:
    metadata = IngestMetadata(
        title=title,
        school=school,
        major=major,
        course=course,
        unit=unit,
        material_type=material_type,
        source_name=source_name,
        author=author,
        publication_year=publication_year,
        description=description,
        is_official_source=is_official_source,
    )
    return get_service(request).ingest_pdf(
        file.file,
        file.filename or "document.pdf",
        metadata,
        idempotency_key,
    )


@protected.post("/materials/uploads/prepare", response_model=PrepareUploadResult)
def prepare_upload(
    request: Request,
    metadata: IngestMetadata,
    confirmation_id: str | None = None,
) -> PrepareUploadResult:
    return get_service(request).prepare_material_upload(metadata, confirmation_id)


@protected.get("/materials/uploads/{intent_id}", response_model=IngestResult)
def get_upload_result(request: Request, intent_id: str) -> IngestResult:
    return get_service(request).get_upload_result(intent_id)


@router.put("/transfers/uploads/{token}", response_model=IngestResult)
async def put_upload(request: Request, token: str) -> IngestResult:
    max_bytes = request.app.state.settings.max_file_bytes
    total = 0
    with SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b") as stream:
        async for chunk in request.stream():
            total += len(chunk)
            if total > max_bytes:
                raise FileTooLargeError(f"PDF exceeds the {max_bytes}-byte limit.")
            stream.write(chunk)
        stream.seek(0)
        return get_service(request).put_upload(
            token,
            stream,
            request.headers.get("X-Filename", "document.pdf"),
        )


@router.get("/transfers/downloads/{token}")
def download_file(request: Request, token: str) -> FileResponse:
    path, original_name, mime_type = get_service(request).resolve_download(token)
    return FileResponse(path, filename=original_name, media_type=mime_type)


@protected.get("/materials", response_model=MaterialPage)
def list_materials(
    request: Request,
    course: str | None = None,
    unit: str | None = None,
    limit: Annotated[int, Query(ge=1)] = 10,
    cursor: str | None = None,
) -> MaterialPage:
    return get_service(request).list_materials(
        course=course,
        unit=unit,
        limit=limit,
        cursor=cursor,
    )


@protected.post("/materials/search", response_model=SearchResponse)
def search_materials(request: Request, payload: SearchRequest) -> SearchResponse:
    return get_service(request).search_materials(payload)


router.include_router(protected)

