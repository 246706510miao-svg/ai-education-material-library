# Remote MCP contract

Endpoint: `POST https://materials.for-fdd.xyz/mcp` using Streamable HTTP. Every MCP request requires `Authorization: Bearer <key>`. Tool results are structured JSON.

## Shared fields

Required upload metadata: `school`, `major`, `course`, `unit`, `material_type`, `title`.

Optional metadata: `source_name`, `author`, `publication_year`, `description`, `is_official_source`.

Stable statuses: `ready`, `confirmation_required`, `success`, `partial_success`, `duplicate`, `not_found`, `error`.

## Tools

### `prepare_material_upload`

Accepts upload metadata and optional `confirmation_id`. Returns either:

```json
{"status":"ready","intent_id":"intent_...","upload_url":"/transfers/uploads/...","expires_in_seconds":600}
```

or suspected duplicates with `confirmation_id`, `document_id`, `title`, and a short-lived `download_url`. Resubmit unchanged metadata with that confirmation to continue.

### `get_upload_result`

Input: `intent_id`. Returns identifiers, page/chunk counts, `retrieval_modes`, optional `warning_code`, and duplicate state.

### `list_materials`

Exact filters: `school`, `major`, `course`, `unit`, `material_type`. Optional `limit` (maximum 20) and `cursor`.

### `search_course_material`

Required `query`; optional exact scope filters, `document_id`, `limit`, `cursor`, and `debug`. Returns ranked raw chunks with document metadata, page range, quality flags, score, next cursor and active retrieval modes. Debug-only fields expose component ranks and cosine similarity.

### `get_document_content`

Input: `document_id`, optional `limit` and `cursor`. Returns raw parsed chunks in source order with pages, headings and quality flags.

### `get_document_download`

Input: `document_id`. Returns a short-lived same-domain URL; no server path or storage key is exposed.

## Binary transfers

- `PUT /transfers/uploads/{token}` with raw PDF body and optional `X-Filename`.
- `GET /transfers/downloads/{token}` returns the original PDF.
- Tokens expire and are single-use. Upload bytes are rejected when the PDF header, size, page or text-extraction constraints fail.

## Error envelope

```json
{"status":"error","error_code":"...","message":"...","request_id":"..."}
```

Embedding failure after successful parsing is not a total failure: the document remains searchable lexically and returns `partial_success`, `retrieval_modes: ["lexical"]`, and `warning_code: "EMBEDDING_FAILED"`.
