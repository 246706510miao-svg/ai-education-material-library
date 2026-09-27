# Remote Shared Course RAG MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the deployed shared material POC into one remote Streamable HTTP MCP that supports shared PDF upload, hybrid retrieval, parsed-content paging, and original-file download.

**Architecture:** Extend the existing FastAPI/PostgreSQL service instead of replacing it. Mount a stateless MCP ASGI app at `/mcp`, keep file bytes in server-side storage, use PostgreSQL full-text/lexical search plus pgvector with RRF, and move binary upload/download through short-lived signed transfer URLs returned by MCP tools.

**Tech Stack:** Python 3.12, FastAPI, MCP Python SDK, SQLAlchemy 2, Alembic, PostgreSQL 16 + pgvector, PyMuPDF, a lightweight CPU multilingual embedding runtime, pytest, Docker Compose, Caddy.

**Spec:** `docs/superpowers/specs/2026-09-27-remote-shared-course-rag-mcp-design.md`

## Global Constraints

- The only manually configured partner endpoint is `https://materials.for-fdd.xyz/mcp` plus one shared Bearer token.
- Public MCP tools return stable structured JSON and never expose database credentials, `storage_key`, or server file paths.
- Required upload metadata is `school`, `major`, `course`, `unit`, `material_type`, and `title`.
- First release accepts text-based PDF only; OCR, user-specific permissions, deletion tools, historical versions, async workers, and backup guarantees are out of scope.
- SH has 4 CPU cores and 3.6 GiB RAM; run one application worker and load one lightweight embedding model once.
- Existing POC rows may be deleted, but no command may delete or recreate `for-mygirl` containers, volumes, databases, or Caddy state.
- Use TDD for every behavior change and preserve `not_found`, `partial_success`, and service-failure distinctions.

---

## File Map

- `material_service/app/models.py`: final relational and vector model.
- `material_service/app/schemas.py`: HTTP/domain request and response contracts.
- `material_service/app/embedding.py`: embedding protocol and local model adapter.
- `material_service/app/chunking.py`: page/paragraph-aware chunk construction.
- `material_service/app/retrieval.py`: lexical/vector candidate retrieval and RRF fusion.
- `material_service/app/transfers.py`: signed upload/download token creation and validation.
- `material_service/app/repositories.py`: parameterized persistence queries only.
- `material_service/app/services.py`: upload, ingestion, search, content, and download orchestration.
- `material_service/app/api.py`: internal health and transfer HTTP routes.
- `material_service/app/main.py`: FastAPI construction and MCP ASGI mount.
- `mcp_server/server.py`: six remote MCP tool definitions, no local API adapter.
- `migrations/versions/20260927_0002_remote_rag_schema.py`: reset POC rows and create final schema/vector extension.
- `deploy/compose.yaml`, `deploy/Caddyfile.example`: pgvector image, one worker, `/mcp` and transfer routing.
- `tests/`: unit, integration, MCP protocol, Compose, and remote acceptance coverage.
- `evaluation/`: real-corpus retrieval evaluation format and runner.
- `README.md`: concise user/developer entry point.

### Task 1: Lock dependencies and runtime configuration

**Files:**
- Modify: `pyproject.toml`
- Modify: `.env.example`
- Modify: `material_service/app/config.py`
- Test: `tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.embedding_model_name`, `embedding_dimension`, `embedding_batch_size`, `transfer_signing_secret`, `upload_url_ttl_seconds`, `download_url_ttl_seconds`, `chunk_target_chars`, `chunk_overlap_chars`, `default_search_limit=5`, and `max_search_limit=20`.

- [ ] **Step 1: Add failing configuration tests**

```python
def test_remote_rag_defaults(settings_env):
    settings = Settings()
    assert settings.default_search_limit == 5
    assert settings.max_search_limit == 20
    assert settings.chunk_target_chars == 900
    assert settings.chunk_overlap_chars == 150
    assert settings.upload_url_ttl_seconds == 600
    assert settings.download_url_ttl_seconds == 600
```

- [ ] **Step 2: Verify the new test fails**

Run: `uv run pytest tests/unit/test_config.py -v`
Expected: FAIL because the new settings do not exist and the old search defaults differ.

- [ ] **Step 3: Pin pgvector, one provisional embedding model, and exact settings**

Choose one lightweight multilingual model as the provisional POC model, pin its exact model ID/revision and vector dimension, then add `pgvector`, its CPU runtime, and validated fields to `Settings`. Put only placeholder values in `.env.example`; require a non-example `TRANSFER_SIGNING_SECRET` at runtime. Later evaluation may compare candidates, but the migration dimension must already be deterministic here.

- [ ] **Step 4: Run configuration tests and lint**

Run: `uv run pytest tests/unit/test_config.py -v && uv run ruff check material_service tests/unit/test_config.py`
Expected: PASS and `All checks passed!`.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock .env.example material_service/app/config.py tests/unit/test_config.py
git commit -m "build: configure remote rag runtime"
```

### Task 2: Rebuild the POC schema with shared scope and pgvector

**Files:**
- Modify: `material_service/app/models.py`
- Create: `migrations/versions/20260927_0002_remote_rag_schema.py`
- Modify: `tests/integration/test_migrations.py`
- Modify: `tests/integration/test_model_constraints.py`

**Interfaces:**
- Produces: required document fields `school`, `major`, `course`, `unit`, `material_type`, `title`; chunk fields `embedding`, `embedding_model`, `embedding_version`; one-version-only document behavior.

- [ ] **Step 1: Write failing migration and model tests**

```python
def test_document_scope_is_required(postgres_engine):
    columns = inspect(postgres_engine).get_columns("documents")
    nullable = {column["name"]: column["nullable"] for column in columns}
    for name in ("school", "major", "course", "unit", "material_type", "title"):
        assert nullable[name] is False

def test_chunk_has_vector_metadata(postgres_engine):
    names = {c["name"] for c in inspect(postgres_engine).get_columns("document_chunks")}
    assert {"embedding", "embedding_model", "embedding_version"} <= names
```

- [ ] **Step 2: Run migration tests and confirm failure**

Run: `uv run pytest tests/integration/test_migrations.py tests/integration/test_model_constraints.py -v`
Expected: FAIL for missing scope/vector columns.

- [ ] **Step 3: Implement the destructive POC-only migration**

The migration must explicitly delete POC ingestion/chunk/document/file rows in foreign-key-safe order, run `CREATE EXTENSION IF NOT EXISTS vector`, rename/replace `applicable_school` and `source_type`, add `major`, and add the fixed-dimension pgvector column pinned in Task 1. It must not touch `api_clients` or any non-project database.

- [ ] **Step 4: Update ORM models and constraints**

Use the pgvector SQLAlchemy type, indexes for exact scope filtering, and a vector index appropriate to the selected distance function. Keep original file metadata and quality fields.

- [ ] **Step 5: Upgrade a fresh PostgreSQL container and run tests**

Run: `uv run pytest tests/integration/test_migrations.py tests/integration/test_model_constraints.py -v`
Expected: PASS with the extension and final columns present.

- [ ] **Step 6: Commit**

```bash
git add material_service/app/models.py migrations/versions/20260927_0002_remote_rag_schema.py tests/integration/test_migrations.py tests/integration/test_model_constraints.py
git commit -m "feat: add shared scope and vector schema"
```

### Task 3: Replace mechanical chunking with page-aware overlapping chunks

**Files:**
- Create: `material_service/app/chunking.py`
- Modify: `material_service/app/pdf_parser.py`
- Modify: `tests/unit/test_chunking.py`
- Modify: `tests/unit/test_pdf_parser.py`

**Interfaces:**
- Produces: `build_chunks(pages, target_chars, max_chars, overlap_chars) -> list[ParsedChunk]` with stable `chunk_index`, `page_start`, `page_end`, `heading_path`, raw `text`, and quality flags.

- [ ] **Step 1: Write boundary and overlap tests**

```python
def test_chunker_prefers_paragraph_boundaries_and_retains_pages():
    chunks = build_chunks(sample_pages(), target_chars=900, max_chars=1200, overlap_chars=150)
    assert chunks[0].page_start == 1
    assert chunks[0].text.endswith("第一节结尾。")
    assert 0 < len(set(chunks[0].text[-150:]) & set(chunks[1].text[:150]))
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/unit/test_chunking.py tests/unit/test_pdf_parser.py -v`
Expected: FAIL because `build_chunks` does not exist.

- [ ] **Step 3: Implement paragraph/page-aware chunking**

Keep raw source text unchanged, never put metadata into `ParsedChunk.text`, cap chunks at 1200 characters, and carry formula/figure quality signals from the parser.

- [ ] **Step 4: Run unit tests**

Run: `uv run pytest tests/unit/test_chunking.py tests/unit/test_pdf_parser.py -v`
Expected: PASS for paragraph preference, page tracking, overlap, scan rejection, and formula flags.

- [ ] **Step 5: Commit**

```bash
git add material_service/app/chunking.py material_service/app/pdf_parser.py tests/unit/test_chunking.py tests/unit/test_pdf_parser.py
git commit -m "feat: add page aware overlapping chunks"
```

### Task 4: Add a local embedding boundary and provisional model

**Files:**
- Create: `material_service/app/embedding.py`
- Create: `tests/unit/test_embedding.py`
- Modify: `material_service/app/main.py`

**Interfaces:**
- Produces: `EmbeddingProvider.embed_texts(texts: list[str]) -> list[list[float]]`, `build_embedding_text(document, chunk) -> str`, and one process-scoped provider instance.

- [ ] **Step 1: Write failing provider and metadata-prefix tests**

```python
def test_embedding_text_contains_metadata_but_preserves_raw_chunk(document, chunk):
    value = build_embedding_text(document, chunk)
    assert "南京理工大学" in value
    assert "多重积分" in value
    assert value.endswith(chunk.text)
    assert chunk.text == "原始正文"
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/unit/test_embedding.py -v`
Expected: FAIL because the embedding module is missing.

- [ ] **Step 3: Verify the provisional model against SH resource constraints**

Record model size, vector dimension, single/batch latency, and peak RSS using a small synthetic set. Confirm that the Task 1 model leaves material-service below the 3.6 GiB host limit with one worker. If it does not, return to Task 1 and change the pinned model and migration dimension before proceeding. Candidate quality comparison belongs to the later real-corpus evaluation, not this engineering smoke.

- [ ] **Step 4: Implement provider caching and batch validation**

Load the model once during application lifespan, return finite vectors of the configured fixed dimension, and raise `EmbeddingUnavailableError` without terminating the process.

- [ ] **Step 5: Run tests and a local memory smoke**

Run: `uv run pytest tests/unit/test_embedding.py -v`
Expected: PASS; smoke output records model name, dimension, batch latency, and RSS.

- [ ] **Step 6: Commit**

```bash
git add material_service/app/embedding.py material_service/app/main.py tests/unit/test_embedding.py docs/acceptance-record.md
git commit -m "feat: add local multilingual embeddings"
```

### Task 5: Implement upload intents, duplicate confirmation, and signed transfers

**Files:**
- Create: `material_service/app/transfers.py`
- Modify: `material_service/app/schemas.py`
- Modify: `material_service/app/repositories.py`
- Modify: `material_service/app/services.py`
- Modify: `material_service/app/api.py`
- Modify: `material_service/app/main.py`
- Create: `tests/unit/test_transfers.py`
- Modify: `tests/integration/test_ingestion_service.py`
- Modify: `tests/integration/test_api.py`

**Interfaces:**
- Produces: `prepare_material_upload`, `put_upload`, `get_upload_result`, `create_download_url`, and signed single-use upload/download tokens.

- [ ] **Step 1: Write failing confirmation and token tests**

```python
def test_possible_duplicate_requires_bound_confirmation(service, existing_document):
    result = service.prepare_material_upload(existing_document.similar_metadata())
    assert result.status == "confirmation_required"
    assert result.possible_duplicates[0].document_id == existing_document.id
    assert result.confirmation_id

def test_upload_token_is_single_use_and_expires(transfer_service, clock):
    token = transfer_service.issue_upload(intent_id="intent_1", ttl_seconds=600)
    transfer_service.consume_upload(token)
    with pytest.raises(TransferTokenInvalidError):
        transfer_service.consume_upload(token)
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `uv run pytest tests/unit/test_transfers.py tests/integration/test_ingestion_service.py tests/integration/test_api.py -v`
Expected: FAIL for missing transfer and confirmation behavior.

- [ ] **Step 3: Implement normalized metadata and possible-duplicate query**

Match exact `school`, `major`, `course`, and `material_type`; compare normalized titles by equality or containment. Bind `confirmation_id` to a hash of the normalized metadata. Any metadata change invalidates confirmation.

- [ ] **Step 4: Implement signed upload and download routes**

Add `PUT /transfers/uploads/{token}` and `GET /transfers/downloads/{token}`. Stream bytes, enforce PDF header/size/page/timeout limits, never accept caller paths, and never expose `storage_key`.

- [ ] **Step 5: Preserve SHA-256 duplicate semantics and partial success**

Byte-identical uploads return `duplicate` with the existing document and a short-lived download URL. Embedding failure after successful parsing stores lexical chunks and returns `partial_success`, `retrieval_modes=["lexical"]`, and `warning_code="EMBEDDING_FAILED"`.

- [ ] **Step 6: Run focused tests**

Run: `uv run pytest tests/unit/test_transfers.py tests/integration/test_ingestion_service.py tests/integration/test_api.py -v`
Expected: PASS for confirmation binding, expiry, single use, duplicate bytes, scan rejection, success, and partial success.

- [ ] **Step 7: Commit**

```bash
git add material_service/app/transfers.py material_service/app/schemas.py material_service/app/repositories.py material_service/app/services.py material_service/app/api.py material_service/app/main.py tests/unit/test_transfers.py tests/integration/test_ingestion_service.py tests/integration/test_api.py
git commit -m "feat: add shared material upload transfers"
```

### Task 6: Implement lexical, vector, and RRF hybrid retrieval

**Files:**
- Create: `material_service/app/retrieval.py`
- Modify: `material_service/app/repositories.py`
- Modify: `material_service/app/services.py`
- Modify: `material_service/app/schemas.py`
- Create: `tests/unit/test_retrieval.py`
- Modify: `tests/integration/test_material_queries.py`

**Interfaces:**
- Produces: `hybrid_search(request: SearchRequest) -> SearchResponse`, cursor paging, exact metadata filters, debug score fields, thresholded `not_found`, and lexical fallback.

- [ ] **Step 1: Write failing RRF and filter tests**

```python
def test_rrf_rewards_chunks_present_in_both_rankings():
    result = reciprocal_rank_fusion(["a", "b"], ["b", "c"], k=60)
    assert result[0].chunk_id == "b"

def test_search_scope_filters_are_exact(service):
    response = service.search_course_material(SearchRequest(query="积分", school="南京理工大学"))
    assert all(item.school == "南京理工大学" for item in response.items)
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/unit/test_retrieval.py tests/integration/test_material_queries.py -v`
Expected: FAIL because hybrid retrieval is not implemented.

- [ ] **Step 3: Implement Chinese lexical and English FTS candidates**

Use parameterized exact metadata filters. Chinese scoring covers normalized phrase/body/title/metadata hits; English uses the existing `tsvector` path. Return internal top 20 per lexical branch.

- [ ] **Step 4: Implement pgvector candidates and RRF**

Embed the query once, retrieve vector top 20 with the same filters, fuse rankings with deterministic tie-breaking, deduplicate chunk IDs, and apply the calibrated relevance threshold.

- [ ] **Step 5: Add page-size cap and opaque cursor**

Default page size is 5 and hard maximum is 20. Cursor must encode the stable final position and query/filter fingerprint so it cannot be reused with changed arguments.

- [ ] **Step 6: Add vector failure fallback and debug output**

Return `partial_success` and lexical items when embedding/vector retrieval fails. Only `debug=true` exposes component ranks, cosine similarity, and RRF score.

- [ ] **Step 7: Run retrieval tests**

Run: `uv run pytest tests/unit/test_retrieval.py tests/integration/test_material_queries.py -v`
Expected: PASS for Chinese phrase hits, English FTS, semantic reformulation, exact filters, RRF, cursor paging, thresholded no-result, and fallback.

- [ ] **Step 8: Commit**

```bash
git add material_service/app/retrieval.py material_service/app/repositories.py material_service/app/services.py material_service/app/schemas.py tests/unit/test_retrieval.py tests/integration/test_material_queries.py
git commit -m "feat: add hybrid course material retrieval"
```

### Task 7: Add parsed-content paging and original-file download

**Files:**
- Modify: `material_service/app/repositories.py`
- Modify: `material_service/app/services.py`
- Modify: `material_service/app/schemas.py`
- Modify: `tests/integration/test_material_queries.py`
- Modify: `tests/integration/test_api.py`

**Interfaces:**
- Produces: `get_document_content(document_id, cursor|page range)` and `get_document_download(document_id)` for the single current version.

- [ ] **Step 1: Write failing content-limit and download tests**

```python
def test_document_content_caps_chars_and_returns_cursor(service, document):
    result = service.get_document_content(document.id, limit=20)
    assert sum(len(item.text) for item in result.items) <= 30_000
    assert result.has_more is bool(result.next_cursor)

def test_download_result_never_exposes_storage_key(service, document):
    result = service.get_document_download(document.id)
    assert result.download_url.startswith("https://")
    assert "storage_key" not in result.model_dump()
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/integration/test_material_queries.py tests/integration/test_api.py -v`
Expected: FAIL for missing content/download methods.

- [ ] **Step 3: Implement chunk cursor and page-range queries**

Allow either cursor paging or `page_start/page_end`, not both. Enforce maximum 20 chunks, 10 pages, and 30,000 returned characters; return complete chunks only and a `next_cursor`.

- [ ] **Step 4: Implement short-lived original download results**

Return filename, MIME type, size, expiry, and signed URL for the only current version. Verify the document is searchable before signing.

- [ ] **Step 5: Run tests and commit**

Run: `uv run pytest tests/integration/test_material_queries.py tests/integration/test_api.py -v`
Expected: PASS.

```bash
git add material_service/app/repositories.py material_service/app/services.py material_service/app/schemas.py tests/integration/test_material_queries.py tests/integration/test_api.py
git commit -m "feat: add material content and downloads"
```

### Task 8: Replace the local adapter with a remote Streamable HTTP MCP

**Files:**
- Rewrite: `mcp_server/server.py`
- Remove or narrow: `mcp_server/client.py`
- Modify: `material_service/app/main.py`
- Rewrite: `tests/mcp/test_tools.py`
- Rewrite: `tests/mcp/test_client.py`
- Create: `tests/mcp/test_remote_protocol.py`

**Interfaces:**
- Produces: stateless `/mcp` endpoint, six tools with structured output, Bearer auth, instructions, and read/write annotations.

- [ ] **Step 1: Write failing in-process Streamable HTTP protocol tests**

```python
async def test_remote_mcp_lists_six_tools(mcp_client):
    tools = await mcp_client.list_tools()
    assert {tool.name for tool in tools.tools} == {
        "prepare_material_upload", "get_upload_result", "list_materials",
        "search_course_material", "get_document_content", "get_document_download",
    }
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/mcp -v`
Expected: FAIL because the server only runs stdio and advertises the old tools.

- [ ] **Step 3: Register the six tools against `MaterialService`**

Use typed schemas and `structured_output=True`. Mark list/search/content/download as read-only; upload preparation and result lookup must describe their external effects accurately. Set server instructions to require evidence search for course-material facts.

- [ ] **Step 4: Mount the MCP ASGI app at `/mcp`**

Use the Python SDK Streamable HTTP app in stateless mode where supported by the pinned SDK. Reuse FastAPI lifespan so the embedding provider and database pool are process-scoped. Apply the same shared Bearer token to MCP calls.

- [ ] **Step 5: Run protocol and tool tests**

Run: `uv run pytest tests/mcp -v`
Expected: PASS for initialize/discovery, exactly six tools, valid calls, invalid arguments, unauthorized calls, and JSON outputs.

- [ ] **Step 6: Commit**

```bash
git add mcp_server/server.py mcp_server/client.py material_service/app/main.py tests/mcp
git commit -m "feat: expose remote course rag mcp"
```

### Task 9: Package pgvector and the one-worker application for SH

**Files:**
- Modify: `deploy/compose.yaml`
- Modify: `deploy/material-service.Dockerfile`
- Modify: `deploy/Caddyfile.example`
- Modify: `tests/e2e/test_compose_smoke.py`
- Modify: `deploy/sh-smoke.ps1`
- Modify: `docs/deployment-runbook.md`

**Interfaces:**
- Produces: one Compose stack with pgvector PostgreSQL, one application worker, persistent files, internal-only database, public `/mcp` and signed transfer routes.

- [ ] **Step 1: Write failing Compose policy tests**

```python
def test_compose_uses_pgvector_and_one_worker(compose_config):
    assert "pgvector" in compose_config["services"]["postgres"]["image"]
    command = compose_config["services"]["material-service"]["command"]
    assert "--workers" in command and "1" in command
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/e2e/test_compose_smoke.py -v`
Expected: FAIL because the current image is `postgres:16-alpine` and no worker command is fixed.

- [ ] **Step 3: Update Compose, image, health checks, and Caddy limits**

Use a pinned PostgreSQL 16 pgvector image, keep volumes named and database unexposed, add embedding/transfer environment variables, and route `/mcp` plus `/transfers/*` through the existing Caddy service without altering `for-mygirl` routes.

- [ ] **Step 4: Extend smoke script**

Test health, MCP discovery, duplicate confirmation, signed upload, upload result, hybrid search, parsed content, and signed download. Redact the shared key and signed tokens in saved logs.

- [ ] **Step 5: Validate Compose and tests**

Run: `docker compose -f deploy/compose.yaml --env-file .env config --quiet`
Expected: exit 0, no PostgreSQL host port, one application worker.

Run: `uv run pytest tests/e2e/test_compose_smoke.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add deploy tests/e2e/test_compose_smoke.py docs/deployment-runbook.md
git commit -m "build: package remote rag mcp for sh"
```

### Task 10: Add the retrieval evaluation harness

**Files:**
- Create: `evaluation/README.md`
- Create: `evaluation/schema.json`
- Create: `evaluation/run.py`
- Create: `evaluation/sample.jsonl`
- Create: `tests/unit/test_evaluation.py`

**Interfaces:**
- Produces: reproducible Top-1/Top-5/no-answer metrics for one candidate index or model, with no claim of real effectiveness until real fixtures are supplied.

- [ ] **Step 1: Write failing metric tests**

```python
def test_metrics_count_expected_page_in_top_five():
    metrics = score_cases(cases=[case("q", "doc_1", [3])], results=[[hit("doc_1", 3)]])
    assert metrics.top5_accuracy == 1.0
```

- [ ] **Step 2: Confirm failure**

Run: `uv run pytest tests/unit/test_evaluation.py -v`
Expected: FAIL because the evaluation module is missing.

- [ ] **Step 3: Implement JSONL validation and metrics**

Require question, expected document, expected page range, and `answerable`. Report Top-1, Top-5, MRR, no-answer precision/recall, latency percentiles, and model metadata.

- [ ] **Step 4: Add a clearly synthetic sample only**

Mark `evaluation/sample.jsonl` as contract validation, not effectiveness evidence. `evaluation/README.md` must state that 3 to 5 real PDFs, 30 to 50 Chinese questions, and 5 to 10 no-answer questions are still required.

- [ ] **Step 5: Run tests and commit**

Run: `uv run pytest tests/unit/test_evaluation.py -v`
Expected: PASS.

```bash
git add evaluation tests/unit/test_evaluation.py
git commit -m "test: add retrieval evaluation harness"
```

### Task 11: Write the concise README and update contracts

**Files:**
- Create: `README.md`
- Create: `tests/unit/test_readme.py`
- Rewrite: `docs/api-contract.md`
- Modify: `docs/acceptance-record.md`

**Interfaces:**
- Produces: one short user-facing entry point and exact six-tool/transfer JSON contracts.

- [ ] **Step 1: Write README acceptance assertions**

Add a unit test or lightweight script that checks `README.md` contains the project purpose, architecture, MCP URL example, six tool names, local verification commands, SH deployment pointer, and explicit boundaries; reject stale references to a required local stdio adapter.

- [ ] **Step 2: Confirm the check fails because README is absent**

Run: `uv run pytest tests/unit/test_readme.py -v`
Expected: FAIL with `README.md` missing.

- [ ] **Step 3: Write a concise README**

Limit the main README to: purpose, four-line architecture, six-tool table, Codex/MCP Inspector connection example, shortest local test commands, deployment pointer, and known boundaries. Put detailed payloads in `docs/api-contract.md` instead of duplicating them.

- [ ] **Step 4: Update acceptance record without overclaiming**

Separate local tests, local Compose, SH deployment, Codex connection, MCP Inspector, and real retrieval effect. Mark unrun items `NOT RUN`; never copy old PASS values into the new system.

- [ ] **Step 5: Run README check and commit**

Run: `uv run pytest tests/unit/test_readme.py -v`
Expected: PASS.

```bash
git add README.md docs/api-contract.md docs/acceptance-record.md tests/unit/test_readme.py
git commit -m "docs: add concise remote mcp guide"
```

### Task 12: Full local verification, SH deployment, and two-client acceptance

**Files:**
- Modify: `docs/acceptance-record.md`
- Modify only if diagnostics require fixes: implementation/test/deploy files from Tasks 1-11

**Interfaces:**
- Produces: evidence-backed completion status for engineering closure; retrieval effectiveness remains separately labeled until real evaluation data exists.

- [ ] **Step 1: Run the complete local suite**

Run: `uv run ruff check material_service mcp_server evaluation tests`
Expected: `All checks passed!`.

Run: `uv run pytest -q`
Expected: zero failures; record the exact count and duration.

- [ ] **Step 2: Build and test local Compose from a clean project database**

Run: `docker compose -f deploy/compose.yaml --env-file .env build`
Expected: successful application image with the provisional model/runtime.

Run: `docker compose -f deploy/compose.yaml --env-file .env up -d postgres && docker compose -f deploy/compose.yaml --env-file .env run --rm material-service alembic upgrade head && docker compose -f deploy/compose.yaml --env-file .env up -d material-service`
Expected: PostgreSQL and material-service healthy; vector extension and final migration at head.

- [ ] **Step 3: Run local MCP end-to-end acceptance**

Use MCP Inspector or the protocol test client to discover six tools, upload a text PDF through the signed URL, poll the result, search it, page parsed content, and download the original. Repeat the upload to prove possible-duplicate confirmation and SHA duplicate rejection.

- [ ] **Step 4: Prepare SH deployment with a verified exact target**

Read-only verify `/opt/material-library`, Compose project `material-library`, the named PostgreSQL/file volumes, current Caddy container, disk, memory, and current health. Back up the project PostgreSQL data and Caddyfile before replacing the PostgreSQL image or applying the destructive POC migration. Stop if the resolved targets differ from the runbook.

- [ ] **Step 5: Deploy in runbook checkpoints**

Build/start pgvector PostgreSQL, apply migration, start one-worker service, verify internal health, validate Caddy, hot reload, and regress `https://for-fdd.xyz/`. Do not use `docker compose down --volumes`.

- [ ] **Step 6: Verify the public MCP from MCP Inspector and Codex**

Configure `https://materials.for-fdd.xyz/mcp` with the shared Bearer key. From each client, list six tools and execute representative read calls. From Codex, upload a local PDF through the signed transfer URL, then use a second connection to retrieve it.

- [ ] **Step 7: Exercise failure paths**

Verify wrong key, expired/single-use transfer token, scan-only PDF, byte duplicate, no result, vector fallback, and controlled database unavailability. Restore services immediately after the database fault test.

- [ ] **Step 8: Record evidence and final boundary**

Fill `docs/acceptance-record.md` with exact commands, outputs, request IDs, timestamps, and PASS/FAIL/NOT RUN. Completion wording must be: engineering closure only unless the real 30-to-50-question evaluation has also run.

- [ ] **Step 9: Run final repository checks and commit**

Run: `git diff --check && uv run ruff check material_service mcp_server evaluation tests && uv run pytest -q`
Expected: all commands exit 0.

```bash
git add docs/acceptance-record.md
git commit -m "test: record remote rag mcp acceptance"
```
