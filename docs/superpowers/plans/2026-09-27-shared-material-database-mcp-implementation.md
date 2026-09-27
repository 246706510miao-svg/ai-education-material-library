# Shared Material Database and MCP POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable shared PostgreSQL material library that accepts text-based PDFs, synchronously extracts and stores page-traceable chunks, exposes HTTP list/search APIs, and proves the same operations through a local MCP POC.

**Architecture:** A local MCP Server reads a user's local PDF and calls a remote FastAPI `material-service` over HTTPS. The service owns authentication, file validation/storage, PyMuPDF extraction, chunking, idempotent PostgreSQL writes, and candidate retrieval; Caddy terminates HTTPS while PostgreSQL and the PDF directory remain private.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16, PyMuPDF, official MCP Python SDK, httpx, pytest, Docker Compose, Caddy 2.8.

**Spec:** `docs/superpowers/specs/2026-09-27-shared-material-database-mcp-design.md`

## Global Constraints

- Scope is public Nanjing University of Science and Technology advanced-mathematics “multiple integrals” material only.
- Accept text-extractable PDF files only; reject scanned/no-text PDFs with `PDF_TEXT_NOT_EXTRACTABLE`.
- Do not implement OCR, RAG, embeddings, vector search, natural-language teaching answers, private data, delete/update tools, arbitrary SQL, background queues, or automatic backups.
- MCP runs locally and calls the HTTP API; it never connects directly to PostgreSQL.
- All business responses are structured JSON; multipart is used only to transfer the PDF bytes.
- Default limits: 50 MB, 300 pages, 120-second synchronous processing timeout, 10 default search results, 50 maximum results, approximately 1500 characters per chunk.
- Use one project API Token from environment configuration; never commit a real token or database password.
- Store original PDFs outside PostgreSQL and store only a platform-independent storage key in the database.
- Preserve page traceability and distinguish `not_found` from execution failures.
- Deploy to SH (`Ubuntu 24.04.4`, Docker `29.1.3`, Compose `2.40.3`) behind the existing `caddy:2.8-alpine` container at `materials.for-fdd.xyz`.
- Do not interrupt the existing `for-mygirl` stack; validate and reload Caddy instead of rebuilding it.
- This directory is now a Git repository on branch `main`; do not add the existing research directory, competition PDF, or legacy Markdown files unless the user explicitly requests it.

---

## Planned File Map

```text
.gitignore                          Generated files, secrets and local data
.env.example                       Shared configuration names and safe defaults
pyproject.toml                     Workspace dependencies and pytest settings
material_service/app/main.py       FastAPI application and lifespan
material_service/app/config.py     Typed environment configuration
material_service/app/errors.py     Stable business errors and handlers
material_service/app/auth.py       Bearer token dependency
material_service/app/db.py         SQLAlchemy engine/session wiring
material_service/app/models.py     Six persisted entity models
material_service/app/schemas.py    HTTP request/response schemas
material_service/app/storage.py    PDF validation and atomic file storage
material_service/app/pdf_parser.py PDF extraction and page-aware chunking
material_service/app/repositories.py Focused database reads/writes
material_service/app/services.py   Idempotent synchronous ingestion and search
material_service/app/api.py        `/v1`, `/health`, and `/ready` routes
migrations/env.py                  Alembic metadata wiring
migrations/versions/...py          Initial schema migration
mcp_server/server.py               Three local MCP tools
frontend_poc/app.py                Minimal upload/list/search demonstration
deploy/compose.yaml                PostgreSQL and material-service deployment
deploy/material-service.Dockerfile Service image
deploy/Caddyfile.example           `materials.for-fdd.xyz` proxy block
docs/api-contract.md               Copyable HTTP and MCP examples
docs/deployment-runbook.md         Staged SH deployment and rollback
docs/acceptance-record.md          Commands and evidence checklist
tests/unit/...                     Storage/parser/chunker tests
tests/integration/...              PostgreSQL/API/transaction tests
tests/mcp/...                      MCP-to-HTTP mapping tests
tests/e2e/...                      Container and remote smoke tests
```

---

### Task 1: Create the Python workspace and configuration boundary

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `pyproject.toml`
- Create: `material_service/__init__.py`
- Create: `material_service/app/__init__.py`
- Create: `material_service/app/config.py`
- Create: `tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings` with exact environment-backed limits, database URL, storage root and API token.
- Produces: `get_settings() -> Settings`, consumed by the API, database, storage and authentication tasks.

- [ ] **Step 1: Add ignore rules without hiding existing project source documents**

Create `.gitignore` with:

```gitignore
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
*.py[cod]
.env
data/
dist/
build/
*.egg-info/
coverage.xml
.coverage
htmlcov/
```

- [ ] **Step 2: Write the configuration test**

```python
from pathlib import Path

from material_service.app.config import Settings


def test_settings_defaults_are_the_approved_mvp_limits(tmp_path: Path) -> None:
    settings = Settings(
        database_url="postgresql+psycopg://material:secret@localhost/materials",
        material_service_api_token="test-token",
        material_storage_root=tmp_path,
    )
    assert settings.max_file_bytes == 50 * 1024 * 1024
    assert settings.max_pdf_pages == 300
    assert settings.processing_timeout_seconds == 120
    assert settings.default_search_limit == 10
    assert settings.max_search_limit == 50
    assert settings.chunk_max_chars == 1500
```

- [ ] **Step 3: Run the test and verify the expected import failure**

Run: `python -m pytest tests/unit/test_config.py -q`

Expected: FAIL because `material_service.app.config` does not exist.

- [ ] **Step 4: Implement typed settings and dependency metadata**

Implement `Settings` with `pydantic-settings`; use `SecretStr` for the token and password-bearing URL, `Path` for storage, and the exact defaults from Global Constraints. Configure `pyproject.toml` for Python `>=3.12`, runtime dependencies `fastapi`, `uvicorn`, `pydantic-settings`, `sqlalchemy`, `psycopg[binary]`, `alembic`, `pymupdf`, `python-multipart`, `httpx`, and `mcp`; add `pytest`, `pytest-asyncio`, `testcontainers[postgres]`, and `ruff` as development dependencies.

Create `.env.example` with non-secret examples:

```dotenv
DATABASE_URL=postgresql+psycopg://material:change-me@postgres:5432/materials
MATERIAL_SERVICE_API_TOKEN=replace-before-start
MATERIAL_STORAGE_ROOT=/data/materials
MAX_FILE_BYTES=52428800
MAX_PDF_PAGES=300
PROCESSING_TIMEOUT_SECONDS=120
DEFAULT_SEARCH_LIMIT=10
MAX_SEARCH_LIMIT=50
CHUNK_MAX_CHARS=1500
```

- [ ] **Step 5: Run the focused test and lint**

Run: `python -m pytest tests/unit/test_config.py -q`

Expected: `1 passed`.

Run: `python -m ruff check material_service tests/unit/test_config.py`

Expected: exit code 0.

- [ ] **Step 6: Commit the workspace boundary**

```bash
git add .gitignore .env.example pyproject.toml material_service tests/unit/test_config.py
git commit -m "build: initialize material service workspace"
```

---

### Task 2: Define PostgreSQL models and the initial migration

**Files:**
- Create: `material_service/app/db.py`
- Create: `material_service/app/models.py`
- Create: `alembic.ini`
- Create: `migrations/env.py`
- Create: `migrations/script.py.mako`
- Create: `migrations/versions/20260927_0001_initial_material_schema.py`
- Create: `tests/integration/test_migrations.py`
- Create: `tests/integration/test_model_constraints.py`

**Interfaces:**
- Produces: `Base`, `SessionFactory`, and `session_scope()`.
- Produces models: `StoredFile`, `Document`, `DocumentVersion`, `DocumentChunk`, `IngestionRun`, `ApiClient`.
- Enforces unique SHA-256, idempotency key, `(document_id, version_number)`, and `(document_version_id, chunk_index)` constraints.

- [ ] **Step 1: Write migration and constraint tests against a disposable PostgreSQL container**

The tests must start PostgreSQL 16 with testcontainers, run `alembic upgrade head`, inspect all six tables, and assert duplicate SHA-256 and duplicate ingestion idempotency keys raise `IntegrityError`.

```python
EXPECTED_TABLES = {
    "stored_files",
    "documents",
    "document_versions",
    "document_chunks",
    "ingestion_runs",
    "api_clients",
}
```

- [ ] **Step 2: Run the migration tests and verify failure**

Run: `python -m pytest tests/integration/test_migrations.py tests/integration/test_model_constraints.py -q`

Expected: FAIL because Alembic and models are not implemented.

- [ ] **Step 3: Implement models with UUID string identifiers and UTC timestamps**

Use explicit prefixes generated by application helpers (`file_`, `doc_`, `docv_`, `chunk_`, `run_`, `client_`). Define enums as checked strings so API values remain portable. Store `heading_path` and `quality_flags` as PostgreSQL JSONB. Add a PostgreSQL generated/search-vector strategy only if it can be expressed and tested in this migration; otherwise add a GIN index over `to_tsvector('simple', text)` via an expression index.

- [ ] **Step 4: Implement the initial Alembic migration**

The migration must create all foreign keys, uniqueness constraints and lookup indexes in one deterministic revision. `downgrade()` must drop dependent tables in reverse order. Do not seed the real API Token in the migration.

- [ ] **Step 5: Run migration up, constraint tests, downgrade and re-upgrade**

Run: `python -m pytest tests/integration/test_migrations.py tests/integration/test_model_constraints.py -q`

Expected: all tests pass, including `upgrade → downgrade → upgrade`.

- [ ] **Step 6: Commit the schema**

```bash
git add material_service/app/db.py material_service/app/models.py alembic.ini migrations tests/integration
git commit -m "feat: add material library database schema"
```

---

### Task 3: Implement PDF validation and atomic original-file storage

**Files:**
- Create: `material_service/app/errors.py`
- Create: `material_service/app/storage.py`
- Create: `tests/fixtures/text-multiple-integrals.pdf`
- Create: `tests/fixtures/scanned-no-text.pdf`
- Create: `tests/fixtures/not-a-pdf.pdf`
- Create: `tests/unit/test_storage.py`

**Interfaces:**
- Produces: `validate_pdf_header(stream) -> None`.
- Produces: `store_pdf(stream, original_name, storage_root, max_bytes) -> StoredFilePayload`.
- `StoredFilePayload` contains `sha256`, `size_bytes`, `storage_key`, `original_name`, `mime_type`.
- Raises: `NotAPdfError`, `FileTooLargeError`, `StorageUnavailableError` with stable error codes.

- [ ] **Step 1: Generate small deterministic PDF fixtures in a test helper**

Use PyMuPDF inside `tests/fixture_factory.py` to create one two-page text PDF and one image-only page PDF; write non-PDF bytes beginning with `%PDF` and random trailing data for the corrupted/forged cases. The fixture generator must be callable from tests and must not rely on external downloads.

- [ ] **Step 2: Write failing storage tests**

Cover valid `%PDF-` header, wrong header, byte limit overflow, filename sanitization, deterministic SHA-256, deduplicated storage key, and atomic rename from a temporary file.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `python -m pytest tests/unit/test_storage.py -q`

Expected: FAIL because storage functions do not exist.

- [ ] **Step 4: Implement streaming validation and storage**

Read in bounded chunks while hashing; never load a 50 MB PDF wholly into memory. Write to `<storage_root>/.tmp/<uuid>.part`, `fsync`, then atomically rename to `<storage_root>/<sha256[:2]>/<sha256>.pdf`. Reject unsafe names for display purposes but never use the submitted name as the storage path.

- [ ] **Step 5: Run tests and inspect the temporary directory cleanup assertion**

Run: `python -m pytest tests/unit/test_storage.py -q`

Expected: all tests pass and failed uploads leave no `.part` files.

- [ ] **Step 6: Commit file storage**

```bash
git add material_service/app/errors.py material_service/app/storage.py tests/fixture_factory.py tests/fixtures tests/unit/test_storage.py
git commit -m "feat: validate and store original PDF files"
```

---

### Task 4: Implement page-aware PDF extraction and chunking

**Files:**
- Create: `material_service/app/pdf_parser.py`
- Create: `tests/unit/test_pdf_parser.py`
- Create: `tests/unit/test_chunking.py`

**Interfaces:**
- Produces: `extract_pdf(path: Path, max_pages: int) -> ParsedDocument`.
- Produces: `chunk_pages(pages: list[ParsedPage], max_chars: int) -> list[ParsedChunk]`.
- `ParsedChunk` contains `chunk_index`, `page_start`, `page_end`, `text`, `heading_path`, `content_type`, `text_quality`, `formula_status`, `has_figure`.
- Raises: `PdfCorruptedError`, `TooManyPagesError`, `PdfTextNotExtractableError`.

- [ ] **Step 1: Write parser tests for text, image-only, corrupt and over-page-limit PDFs**

Require page numbers to be one-based in persisted/output data. Assert the text fixture returns both pages and the scanned fixture raises `PDF_TEXT_NOT_EXTRACTABLE`.

- [ ] **Step 2: Write chunking tests**

Cover paragraph boundaries, a paragraph longer than 1500 characters, no empty chunks, stable indexes, cross-page chunks, page range preservation and reconstruction without dropped non-whitespace text.

- [ ] **Step 3: Run parser tests and verify failure**

Run: `python -m pytest tests/unit/test_pdf_parser.py tests/unit/test_chunking.py -q`

Expected: FAIL because parser types/functions do not exist.

- [ ] **Step 4: Implement extraction and deterministic chunking**

Use `fitz.open(path)`, reject encrypted/corrupt inputs, enforce page count before extraction, capture `page.get_text("text")`, and mark `has_figure` when `page.get_images()` is non-empty. First-version formula status is `possibly_missing` when extracted text contains common integral/limit context or a page has images; it is a warning, not a claim of mathematical completeness.

Split on blank-line paragraph boundaries, append paragraphs until `max_chars`, and hard-split only a single over-limit paragraph. Never remove page attribution.

- [ ] **Step 5: Run parser tests**

Run: `python -m pytest tests/unit/test_pdf_parser.py tests/unit/test_chunking.py -q`

Expected: all tests pass.

- [ ] **Step 6: Commit parsing**

```bash
git add material_service/app/pdf_parser.py tests/unit/test_pdf_parser.py tests/unit/test_chunking.py
git commit -m "feat: extract and chunk text PDF pages"
```

---

### Task 5: Build idempotent synchronous ingestion

**Files:**
- Create: `material_service/app/repositories.py`
- Create: `material_service/app/services.py`
- Create: `material_service/app/schemas.py`
- Create: `tests/integration/test_ingestion_service.py`

**Interfaces:**
- Consumes: `store_pdf`, `extract_pdf`, `chunk_pages`, SQLAlchemy session and six models.
- Produces: `MaterialService.ingest_pdf(upload, metadata, idempotency_key) -> IngestResult`.
- Produces: `IngestResult(status, document_id, document_version_id, file_id, page_count, chunk_count, duplicate_file, searchable)`.

- [ ] **Step 1: Write the success and idempotency integration tests**

Assert one text PDF creates one file, one document, one version, N chunks and one successful run. Repeating the same `idempotency_key` must return the same identifiers without new rows. Uploading identical bytes with a new key and distinct metadata must reuse `stored_files` while creating a separate logical document.

- [ ] **Step 2: Write failure atomicity tests**

Inject parser failure and database failure. Assert failed versions are not searchable, no partial chunks remain, `ingestion_runs` contains the stable error, and a `.part` file is not left behind.

- [ ] **Step 3: Run the integration tests and verify failure**

Run: `python -m pytest tests/integration/test_ingestion_service.py -q`

Expected: FAIL because repository/service methods do not exist.

- [ ] **Step 4: Implement focused repositories and the service transaction**

Repositories must expose named operations rather than arbitrary query execution. The service creates a `running` ingestion record, stores/reuses the file, parses outside the final chunk insert transaction, then atomically writes document/version/chunks and changes the run to `success`. On a known error it records `failed`, `stage`, and `error_code`; unexpected exceptions map to `INTERNAL_ERROR` after server-side logging.

Use a monotonic timer and enforce `processing_timeout_seconds` between major stages. Do not attempt unsafe thread cancellation; if the elapsed duration exceeds the limit before the database commit, return `PDF_PROCESSING_TIMEOUT` and keep the version non-searchable.

- [ ] **Step 5: Run ingestion and transaction tests**

Run: `python -m pytest tests/integration/test_ingestion_service.py -q`

Expected: all tests pass.

- [ ] **Step 6: Commit ingestion**

```bash
git add material_service/app/repositories.py material_service/app/services.py material_service/app/schemas.py tests/integration/test_ingestion_service.py
git commit -m "feat: add idempotent synchronous material ingestion"
```

---

### Task 6: Add list and candidate-search behavior

**Files:**
- Modify: `material_service/app/repositories.py`
- Modify: `material_service/app/services.py`
- Modify: `material_service/app/schemas.py`
- Create: `tests/integration/test_material_queries.py`

**Interfaces:**
- Produces: `MaterialService.list_materials(course, unit, limit, cursor) -> MaterialPage`.
- Produces: `MaterialService.search_materials(SearchRequest) -> SearchResponse`.
- Returns only current versions where `searchable=true`; excludes `text_quality=unusable`.

- [ ] **Step 1: Write seeded query tests**

Seed two public multiple-integrals documents plus one non-searchable failed version. Test course/unit/document filters, stable ordering, limit clamping, keyword matches, source/page fields, `partial` quality flags, exclusion of unusable chunks, and empty result semantics.

- [ ] **Step 2: Run query tests and verify failure**

Run: `python -m pytest tests/integration/test_material_queries.py -q`

Expected: FAIL because list/search methods do not exist.

- [ ] **Step 3: Implement parameterized PostgreSQL retrieval**

Use metadata predicates plus PostgreSQL text ranking. Return `score_type="full_text_rank"`. Treat a blank query as `INVALID_ARGUMENT`; cap limit at 50. Do not accept table names, SQL fragments, order-by strings or raw filters from callers.

- [ ] **Step 4: Run query tests and inspect generated SQL parameters**

Run: `python -m pytest tests/integration/test_material_queries.py -q`

Expected: all tests pass; a test SQLAlchemy event listener confirms user text is sent as a bound parameter.

- [ ] **Step 5: Commit queries**

```bash
git add material_service/app/repositories.py material_service/app/services.py material_service/app/schemas.py tests/integration/test_material_queries.py
git commit -m "feat: list and search stored material chunks"
```

---

### Task 7: Expose authenticated FastAPI endpoints and stable errors

**Files:**
- Create: `material_service/app/auth.py`
- Create: `material_service/app/api.py`
- Create: `material_service/app/main.py`
- Modify: `material_service/app/errors.py`
- Create: `tests/integration/test_api.py`
- Create: `tests/integration/test_health.py`

**Interfaces:**
- Produces: `create_app(settings: Settings | None = None) -> FastAPI`.
- Produces endpoints: `POST /v1/materials/ingest`, `GET /v1/materials`, `POST /v1/materials/search`, `GET /health`, `GET /ready`.
- Produces error envelope: `{status, error_code, message, request_id}`.

- [ ] **Step 1: Write API contract tests**

Cover missing/wrong/correct Bearer Token, multipart upload, JSON search, list filters, request ID response header, all stable error codes, `not_found`, and response-body absence of stack traces and token values.

- [ ] **Step 2: Write health/readiness tests**

`/health` must stay 200 when PostgreSQL is unavailable. `/ready` must return 503 with `DATABASE_UNAVAILABLE` or `STORAGE_UNAVAILABLE` when dependencies fail.

- [ ] **Step 3: Run API tests and verify failure**

Run: `python -m pytest tests/integration/test_api.py tests/integration/test_health.py -q`

Expected: FAIL because the app and routes do not exist.

- [ ] **Step 4: Implement authentication, request IDs, routes and handlers**

Compare the configured Token using `secrets.compare_digest`. Apply authentication to `/v1`, but not `/health` and `/ready`. Do not log multipart bodies. Map domain exceptions to deterministic HTTP statuses: 400 invalid input/PDF, 401 unauthorized, 413 file too large, 422 no extractable text, 503 database/storage unavailable, 504 processing timeout, 500 internal error.

- [ ] **Step 5: Run API tests**

Run: `python -m pytest tests/integration/test_api.py tests/integration/test_health.py -q`

Expected: all tests pass.

- [ ] **Step 6: Run the complete local test suite**

Run: `python -m pytest -q`

Expected: all Tasks 1–7 tests pass.

- [ ] **Step 7: Commit the API**

```bash
git add material_service/app/auth.py material_service/app/api.py material_service/app/main.py material_service/app/errors.py tests/integration
git commit -m "feat: expose authenticated material service API"
```

---

### Task 8: Implement the local MCP Server

**Files:**
- Create: `mcp_server/__init__.py`
- Create: `mcp_server/client.py`
- Create: `mcp_server/server.py`
- Create: `tests/mcp/test_client.py`
- Create: `tests/mcp/test_tools.py`

**Interfaces:**
- Produces tools: `upload_pdf`, `list_materials`, `search_materials`.
- Consumes: `MATERIAL_SERVICE_BASE_URL` and `MATERIAL_SERVICE_API_TOKEN`.
- The upload tool reads a local path and sends bytes to `/v1/materials/ingest`; server-side code never interprets that local path.

- [ ] **Step 1: Write mocked HTTP-client tests**

Assert the client sends Bearer auth, a UUID idempotency key, multipart bytes and metadata; maps HTTP errors to structured MCP tool errors; and never logs the Token or file contents.

- [ ] **Step 2: Write MCP tool-schema tests**

Assert exactly three tools are discoverable and their schemas contain no SQL or natural-language answer parameter. Reject a missing/non-file local path before any network call.

- [ ] **Step 3: Run MCP tests and verify failure**

Run: `python -m pytest tests/mcp -q`

Expected: FAIL because MCP modules do not exist.

- [ ] **Step 4: Implement the API client and MCP tools**

Use `httpx.Client` with explicit connect/read/write timeouts, including a read timeout slightly above 120 seconds. Return service JSON unchanged except for a small MCP envelope that identifies the tool. Record the installed MCP SDK version at startup or in `--version` output.

- [ ] **Step 5: Run MCP tests and an Inspector/manual discovery smoke**

Run: `python -m pytest tests/mcp -q`

Expected: all tests pass.

Run the installed SDK's stdio server command, then use the compatible MCP Inspector/client to verify `tools/list` and one invalid-path `tools/call`. Save the exact SDK/protocol versions in `docs/acceptance-record.md` during Task 11.

- [ ] **Step 6: Commit MCP support**

```bash
git add mcp_server tests/mcp
git commit -m "feat: add local MCP material tools"
```

---

### Task 9: Build the minimal POC interface

**Files:**
- Create: `frontend_poc/app.py`
- Create: `frontend_poc/README.md`
- Create: `tests/unit/test_frontend_poc.py`

**Interfaces:**
- Consumes the same MCP tools or MCP-facing client entrypoints used by real clients.
- Produces a local page/CLI with upload, list and search operations and raw structured result display.

- [ ] **Step 1: Write presentation-boundary tests**

Assert uploaded file paths and metadata are passed to `upload_pdf`, searches display text/title/page/source, and `not_found` is shown differently from `error`. Stub the MCP/client boundary; do not call a model.

- [ ] **Step 2: Run the POC test and verify failure**

Run: `python -m pytest tests/unit/test_frontend_poc.py -q`

Expected: FAIL because the POC does not exist.

- [ ] **Step 3: Implement the smallest observable interface**

Use a simple Python UI or CLI that can select/provide a PDF path, collect the five required metadata fields, call the local MCP path, list materials, search keywords and display raw JSON plus a compact table. Do not add chat, RAG, answer generation, user accounts or design-system work.

- [ ] **Step 4: Run tests and manually exercise the normal and no-result paths**

Run: `python -m pytest tests/unit/test_frontend_poc.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit the POC**

```bash
git add frontend_poc tests/unit/test_frontend_poc.py
git commit -m "feat: add minimal material MCP demonstration"
```

---

### Task 10: Package PostgreSQL and material-service for SH

**Files:**
- Create: `deploy/material-service.Dockerfile`
- Create: `deploy/compose.yaml`
- Create: `deploy/Caddyfile.example`
- Create: `deploy/sh-smoke.ps1`
- Create: `tests/e2e/test_compose_smoke.py`

**Interfaces:**
- Produces: immutable service image and an independent Compose project.
- Produces persistent volumes: PostgreSQL data and original PDF storage.
- Produces internal health/readiness checks and no direct PostgreSQL public port.

- [ ] **Step 1: Write Compose policy tests**

Parse `deploy/compose.yaml` and assert PostgreSQL has no host-published port, both persistent volumes exist, secrets come from environment variables, service health depends on PostgreSQL readiness, and neither service binds 80/443.

- [ ] **Step 2: Run the policy test and verify failure**

Run: `python -m pytest tests/e2e/test_compose_smoke.py -q`

Expected: FAIL because deployment files do not exist.

- [ ] **Step 3: Implement the image and independent Compose project**

Use a non-root service user, pin the Python base image by minor version, copy only required source, run Alembic as a separate deployment command, and mount `/data/materials`. Add an external `material_proxy` network for Caddy connectivity; do not attach the service to the existing application's private database network.

- [ ] **Step 4: Add the Caddy site example**

```caddyfile
materials.for-fdd.xyz {
    request_body {
        max_size 50MB
    }
    reverse_proxy material-service:8000 {
        transport http {
            read_timeout 130s
            write_timeout 130s
        }
    }
}
```

The deployment runbook must adapt the exact syntax to the installed Caddy 2.8 configuration and run validation before reload.

- [ ] **Step 5: Build and run local container smoke tests**

Run: `docker compose -f deploy/compose.yaml config`

Expected: exit code 0 with resolved service definitions and no published PostgreSQL port.

Run: `docker compose -f deploy/compose.yaml up -d --build`

Expected: PostgreSQL and material-service become healthy.

Run: `python -m pytest tests/e2e/test_compose_smoke.py -q`

Expected: all tests pass, including `/health`, `/ready`, upload, search and restart persistence.

- [ ] **Step 6: Stop containers without deleting volumes**

Run: `docker compose -f deploy/compose.yaml down`

Expected: containers stop; named volumes remain. Do not use `--volumes`.

- [ ] **Step 7: Commit deployment packaging**

```bash
git add deploy tests/e2e/test_compose_smoke.py
git commit -m "build: package material service for deployment"
```

---

### Task 11: Write contracts and the staged SH deployment runbook

**Files:**
- Create: `docs/api-contract.md`
- Create: `docs/deployment-runbook.md`
- Create: `docs/acceptance-record.md`

**Interfaces:**
- Produces the operator-facing execution sequence, rollback boundaries and copyable request examples.
- Records observed evidence without upgrading planned or unverified behavior into facts.

- [ ] **Step 1: Document exact API and MCP examples**

Include copyable multipart upload, list, search, `not_found`, unauthorized, scanned PDF and database-unavailable examples. Use placeholders such as `${MATERIAL_SERVICE_API_TOKEN}` in commands, never a real secret. Document MCP local configuration with `MATERIAL_SERVICE_BASE_URL=https://materials.for-fdd.xyz`.

- [ ] **Step 2: Write the SH deployment stages**

The runbook must contain these approval/verification gates:

1. Read-only snapshot: existing containers, networks, ports, disk, Caddyfile path and DNS.
2. Create `/opt/material-library` project directory without touching `/opt/for-mygirl`.
3. Transfer image/Compose/config and create the project-only external proxy network.
4. Start PostgreSQL, run migration, start service, verify internal `/health` and `/ready`.
5. Back up `/opt/for-mygirl/shared/prod/Caddyfile` to a timestamped sibling file.
6. Attach existing Caddy to the external proxy network through its Compose definition or a documented reversible network connection.
7. Add only the `materials.for-fdd.xyz` site block.
8. Run `caddy validate --config /etc/caddy/Caddyfile` inside the Caddy container.
9. Reload Caddy; do not restart the whole `for-mygirl` stack.
10. Verify existing `for-fdd.xyz` services still respond before testing the new subdomain.
11. Run HTTPS upload/search from Windows and MCP upload/search from a second machine.

For every stage, list the expected output, stop condition and rollback command. Never use `docker compose down --volumes` on SH.

- [ ] **Step 3: Create the acceptance record template without unverified claims**

Use a table with columns: check, command/input, expected result, actual result, evidence path, status, notes. Pre-fill status as `NOT RUN`; this is a test record, not a completion claim.

- [ ] **Step 4: Verify documentation consistency**

Run searches that fail on placeholders or scope drift:

```powershell
rg -n "[T]BD|[T]ODO|[F]IXME|[N]ginx|vector database|OCR implemented|backup completed" docs deploy
rg -n "materials\.for-fdd\.xyz|PDF_TEXT_NOT_EXTRACTABLE|DATABASE_UNAVAILABLE|not_found" docs
```

Expected: the first command has no unintended matches; the second finds contract and deployment references.

- [ ] **Step 5: Commit operator documentation**

```bash
git add docs/api-contract.md docs/deployment-runbook.md docs/acceptance-record.md
git commit -m "docs: add material service contracts and deployment runbook"
```

---

### Task 12: Run the full local and remote acceptance sequence

**Files:**
- Modify: `docs/acceptance-record.md`

**Interfaces:**
- Consumes every prior task.
- Produces fresh evidence for each claim in the design's completion definition.

- [ ] **Step 1: Run all static and automated checks locally**

Run:

```powershell
python -m ruff check material_service mcp_server frontend_poc tests
python -m pytest -q
docker compose -f deploy/compose.yaml config
```

Expected: zero lint errors, zero test failures, valid Compose configuration.

- [ ] **Step 2: Run local container acceptance**

Start the Compose stack, run migrations, upload the text fixture, repeat the same idempotency key, upload the scanned and forged fixtures, search a present and absent phrase, stop/start the stack, and search again. Record actual request IDs and row/response counts.

- [ ] **Step 3: Pause for the explicit SH deployment-stage approval**

Present the read-only SH snapshot and the exact files/containers/networks that will change. Do not deploy merely because local tests passed.

- [ ] **Step 4: Execute the approved staged SH runbook**

At every stage, stop on unexpected output. Do not modify the existing Caddyfile until the new PostgreSQL and service pass internal readiness. If Caddy validation fails, restore the timestamped Caddyfile and do not reload.

- [ ] **Step 5: Run public HTTPS and second-machine MCP acceptance**

Verify certificate validity, `/health`, authenticated upload, list, present/absent search, error Token, and local MCP `tools/list` plus all three tool calls. Re-check the existing `for-mygirl` endpoints after the new site is live.

- [ ] **Step 6: Record actual evidence and unresolved boundaries**

Update `docs/acceptance-record.md` with actual outputs. Explicitly retain unimplemented boundaries: OCR, RAG, vectors, private data, delete/update, asynchronous Worker and backups.

- [ ] **Step 7: Run final verification before any completion claim**

Run:

```powershell
git status --short
python -m ruff check material_service mcp_server frontend_poc tests
python -m pytest -q
```

Then run the documented public smoke command and read the complete output. Only report a completed POC if all local and remote required checks have fresh passing evidence.

- [ ] **Step 8: Commit the evidence record**

```bash
git add docs/acceptance-record.md
git commit -m "test: record material service acceptance evidence"
```

---

## Execution Checkpoints

- After Task 2: review entity names, constraints and migration reversibility.
- After Task 5: review ingestion atomicity, idempotency and failure records.
- After Task 8: review MCP schemas and confirm no model/RAG scope entered.
- After Task 10: review container persistence and ensure PostgreSQL is not public.
- Before Task 12 Step 4: obtain a separate deployment-stage approval based on a fresh SH snapshot.
- After Task 12: compare every completion-definition item in the design spec with fresh evidence.

