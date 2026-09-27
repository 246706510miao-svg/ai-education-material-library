# Remote shared course RAG MCP acceptance

Status values are evidence-based: `PASS`, `FAIL`, or `NOT RUN`. Engineering closure and retrieval-effect closure are tracked separately.

| Area | Evidence | Status | Boundary |
|---|---|---|---|
| Historical baseline | `uv run pytest -q` → `51 passed in 37.98s` before implementation | PASS | Old POC baseline only |
| Configuration | Task 1 focused tests → `2 passed`; Ruff passed | PASS | Local |
| pgvector schema | Task 2 focused tests → `8 passed`; migration downgrade/upgrade passed | PASS | Temporary pgvector container |
| Chunking/PDF | Task 3 focused tests → `11 passed` | PASS | Text-based PDF only |
| Embedding boundary | Task 4 unit tests → `3 passed`; real model returned 384 dimensions | PASS | Local Windows smoke; SH RSS not measured yet |
| Upload/transfers | Task 5 focused tests → `14 passed` | PASS | Local temporary database |
| Hybrid retrieval | Task 6 focused tests → `8 passed` | PASS | Synthetic deterministic embeddings in integration tests |
| Content/download | Task 7 focused tests → `13 passed` | PASS | Local temporary database |
| Remote MCP protocol | `uv run pytest tests/mcp -q` → `3 passed` | PASS | In-process Streamable HTTP |
| Compose contract | `uv run pytest tests/e2e/test_compose_smoke.py -q` → `4 passed` | PASS | Config rendering only |
| Docker image | `docker compose ... build material-service` completed | PASS | Local build |
| Current full suite | Task 12 command | NOT RUN | Must run after all edits |
| Local Compose end-to-end | Fresh pgvector stack and six-tool workflow | NOT RUN | Required for engineering closure |
| SH deployment | `/opt/material-library`, Caddy and public `/mcp` | NOT RUN | Must preserve `for-mygirl` |
| Codex public connection | Six tools and representative calls | NOT RUN | Requires deployed URL and key |
| MCP Inspector | Six tools and representative calls | NOT RUN | Requires deployed URL and key |
| Real retrieval effect | 3–5 PDFs, 30–50 Chinese questions, 5–10 no-answer cases | NOT RUN | No effectiveness claim yet |

Current conclusion: implementation is in progress. Do not claim engineering closure until Task 12 local and SH evidence is recorded. Do not claim retrieval-effect closure until the real evaluation corpus has run.
