import hmac
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from material_service.app.api import router
from material_service.app.config import Settings, get_settings
from material_service.app.db import build_session_factory
from material_service.app.embedding import EmbeddingProvider, FastEmbedProvider
from material_service.app.errors import MaterialServiceError
from material_service.app.services import MaterialService
from material_service.app.transfers import TransferTokenService
from mcp_server.server import create_server

ERROR_STATUS = {
    "UNAUTHORIZED": 401,
    "INVALID_ARGUMENT": 400,
    "NOT_A_PDF": 400,
    "PDF_CORRUPTED": 400,
    "FILE_TOO_LARGE": 413,
    "TOO_MANY_PAGES": 422,
    "PDF_TEXT_NOT_EXTRACTABLE": 422,
    "DATABASE_UNAVAILABLE": 503,
    "EMBEDDING_UNAVAILABLE": 503,
    "TRANSFER_TOKEN_INVALID": 403,
    "STORAGE_UNAVAILABLE": 503,
    "PDF_PROCESSING_TIMEOUT": 504,
    "INTERNAL_ERROR": 500,
}


def _error_response(request: Request, code: str, message: str, status_code: int) -> JSONResponse:
    request_id = getattr(request.state, "request_id", uuid4().hex)
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "error",
            "error_code": code,
            "message": message,
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


def create_app(
    settings: Settings | None = None,
    embedding_provider: EmbeddingProvider | None = None,
) -> FastAPI:
    active_settings = settings or get_settings()
    session_factory = build_session_factory(active_settings)
    active_embedding_provider = embedding_provider or FastEmbedProvider(
        model_name=active_settings.embedding_model_name,
        dimension=active_settings.embedding_dimension,
        batch_size=active_settings.embedding_batch_size,
    )
    transfer_service = TransferTokenService(
        active_settings.transfer_signing_secret.get_secret_value().encode("utf-8")
    )
    material_service = MaterialService(
        session_factory=session_factory,
        storage_root=active_settings.material_storage_root,
        max_file_bytes=active_settings.max_file_bytes,
        max_pdf_pages=active_settings.max_pdf_pages,
        chunk_target_chars=active_settings.chunk_target_chars,
        chunk_max_chars=active_settings.chunk_max_chars,
        chunk_overlap_chars=active_settings.chunk_overlap_chars,
        processing_timeout_seconds=active_settings.processing_timeout_seconds,
        embedding_provider=active_embedding_provider,
        transfer_service=transfer_service,
        upload_url_ttl_seconds=active_settings.upload_url_ttl_seconds,
        download_url_ttl_seconds=active_settings.download_url_ttl_seconds,
    )
    mcp = create_server(material_service)
    mcp_app = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        async with mcp_app.router.lifespan_context(mcp_app):
            yield

    app = FastAPI(title="Shared Material Service", version="0.1.0", lifespan=lifespan)
    app.state.settings = active_settings
    app.state.session_factory = session_factory
    app.state.embedding_provider = active_embedding_provider
    app.state.transfer_service = transfer_service
    app.state.material_service = material_service

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        request.state.request_id = request.headers.get("X-Request-ID") or uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.middleware("http")
    async def mcp_bearer_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path == "/mcp" or request.url.path.startswith("/mcp/"):
            supplied = request.headers.get("Authorization", "")
            expected = (
                "Bearer " + active_settings.material_service_api_token.get_secret_value()
            )
            if not hmac.compare_digest(supplied, expected):
                return _error_response(
                    request, "UNAUTHORIZED", "A valid Bearer token is required.", 401
                )
            if request.url.path == "/mcp":
                request.scope["path"] = "/mcp/"
                request.scope["raw_path"] = b"/mcp/"
        return await call_next(request)

    @app.exception_handler(MaterialServiceError)
    async def material_error_handler(
        request: Request, error: MaterialServiceError
    ) -> JSONResponse:
        status_code = ERROR_STATUS.get(error.error_code, 500)
        return _error_response(request, error.error_code, str(error), status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, _error: RequestValidationError
    ) -> JSONResponse:
        return _error_response(request, "INVALID_ARGUMENT", "Request parameters are invalid.", 422)

    app.include_router(router)
    app.mount("/mcp", mcp_app)
    return app

