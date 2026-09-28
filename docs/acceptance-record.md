# Remote shared course RAG MCP acceptance

Status values are evidence-based: `PASS`, `FAIL`, or `NOT RUN`. Engineering closure and retrieval-effect closure are tracked separately.

| Area | Evidence | Status | Boundary |
|---|---|---|---|
| Historical baseline | `uv run pytest -q` → `51 passed in 37.98s` before implementation | PASS | Old POC baseline only |
| Configuration | Task 1 focused tests → `2 passed`; Ruff passed | PASS | Local |
| pgvector schema | Task 2 focused tests → `8 passed`; migration downgrade/upgrade passed | PASS | Temporary pgvector container |
| Chunking/PDF | Task 3 focused tests → `11 passed` | PASS | Text-based PDF only |
| Embedding boundary | Real multilingual model returned 384 dimensions; 241 MB cache preloaded in the SH persistent model volume | PASS | Model correctness smoke, not retrieval-quality proof |
| Upload/transfers | Task 5 focused tests → `14 passed` | PASS | Local temporary database |
| Hybrid retrieval | Task 6 focused tests → `8 passed` | PASS | Synthetic deterministic embeddings in integration tests |
| Content/download | Task 7 focused tests → `13 passed` | PASS | Local temporary database |
| Remote MCP protocol | Canonical `/mcp` no-redirect regression plus public MCP SDK initialization and `tools/list` | PASS | Bearer-protected Streamable HTTP |
| Compose contract | `uv run pytest tests/e2e/test_compose_smoke.py -q` → `4 passed` | PASS | Config rendering only |
| Docker image | `docker compose ... build material-service` completed | PASS | Local build |
| Current full suite | Ruff passed; `pytest -q` → `67 passed in 11.34s` | PASS | Final cache-path implementation |
| Local Compose end-to-end | Fresh pgvector stack; real six-tool workflow; upload/search/content/download/duplicate assertions passed | PASS | Synthetic one-page PDF |
| SH deployment | pgvector `0.8.6`; Alembic `20260927_0002`; HTTPS health/ready; original `for-fdd.xyz` returned 200 | PASS | `/opt/material-library`, one worker |
| Public MCP end-to-end | Six tools; upload `success`; 2 search hits; duplicate confirmation and SHA duplicate branches passed | PASS | MCP Python SDK through public HTTPS URL |
| Codex public connection | URL and Bearer configuration documented; same protocol exercised with official MCP client library | NOT RUN | Requires adding the private key in the user's Codex client |
| MCP Inspector | Deferred until after Codex client test | NOT RUN | User selected Codex first |
| Real retrieval effect | 3–5 PDFs, 30–50 Chinese questions, 5–10 no-answer cases | NOT RUN | No effectiveness claim yet |

Current conclusion: engineering POC closure is complete for the deployed public MCP and shared database workflow. Do not claim retrieval-effect closure until the real evaluation corpus has run.
