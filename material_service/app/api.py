from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from material_service.app.auth import require_api_token
from material_service.app.errors import DatabaseUnavailableError, StorageUnavailableError
from material_service.app.schemas import (
    IngestMetadata,
    IngestResult,
    MaterialPage,
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
    course: Annotated[str, Form()],
    unit: Annotated[str, Form()],
    source_name: Annotated[str, Form()],
    source_type: Annotated[str, Form()],
    idempotency_key: Annotated[str, Form()],
    author: Annotated[str | None, Form()] = None,
    publication_year: Annotated[int | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    applicable_school: Annotated[str | None, Form()] = None,
    is_official_source: Annotated[bool, Form()] = False,
) -> IngestResult:
    metadata = IngestMetadata(
        title=title,
        course=course,
        unit=unit,
        source_name=source_name,
        source_type=source_type,
        author=author,
        publication_year=publication_year,
        description=description,
        applicable_school=applicable_school,
        is_official_source=is_official_source,
    )
    return get_service(request).ingest_pdf(
        file.file,
        file.filename or "document.pdf",
        metadata,
        idempotency_key,
    )


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

