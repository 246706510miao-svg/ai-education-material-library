# 共享教学资料库验收记录

> 本文档是执行记录，不是完成声明。只有“实际结果”和“证据路径”被当场填写的项目才能标记 `PASS` 或 `FAIL`。

## 环境版本

| 项目 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| Python | `uv run python --version` | Python 3.12.x | Python 3.12.13 | 2026-09-27 本地验收命令输出 | PASS |  |
| PostgreSQL | `SELECT version()` | PostgreSQL 16.x | PostgreSQL 16.15, Alpine, 64-bit | 2026-09-27 本地容器输出 | PASS |  |
| PyMuPDF | `python -c "import pymupdf; print(pymupdf.version)"` | 输出实际版本 | 1.28.2 | 2026-09-27 本地验收命令输出 | PASS |  |
| MCP SDK | `uv run python -m mcp_server.server --version` | 输出 SDK 版本 | mcp-sdk 1.30.0 | 2026-09-27 本地验收命令输出 | PASS | 实际客户端协议握手尚未远程验收 |

## 本地自动化与容器

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 静态检查 | `uv run ruff check material_service mcp_server frontend_poc tests` | 0 个错误 | `All checks passed!` | 2026-09-27 本地验收命令输出 | PASS |  |
| 全量测试 | `uv run pytest -q` | 0 个失败 | `51 passed in 10.61s` | 2026-09-27 本地验收命令输出 | PASS |  |
| Compose 展开 | `docker compose -f deploy/compose.yaml config --quiet` | 成功，无对外 DB 端口 | 退出码 0；策略测试确认两个服务无 `ports` | 命令输出 + `tests/e2e/test_compose_smoke.py` | PASS |  |
| 数据库迁移 | `docker compose ... run --rm material-service alembic upgrade head` | 升级至 head | PostgreSQL migration context 成功，head 已应用 | 2026-09-27 本地容器输出 | PASS | Alembic 环境变量覆盖问题已有回归测试 |
| 内部健康 | `/health` 与 `/ready` | `ok` / `ready` | `{"status":"ok"}` / `{"status":"ready"}` | 2026-09-27 本地容器输出 | PASS |  |
| 文本 PDF 上传 | 2 页文本 PDF | 有 ID、页数、片段数 | `doc_4e3480f46c8846bd92ee3467684a54af`，2 页，1 片段 | 2026-09-27 完整接口验收输出 | PASS | `searchable=true` |
| 幂等重试 | 相同 `local-acceptance-20260927-v1` | ID 相同，不新增记录 | `retry_same_ids=true` | 2026-09-27 完整接口验收输出 | PASS |  |
| 重复文件 | 同文件、新幂等键 | `duplicate_file=true` | 新 `document_id`，复用 `file_56afcbbc787e44c699809b3104940fc4`，`duplicate_file=true` | 2026-09-27 完整接口验收输出 | PASS |  |
| 扫描 PDF | 无文字 PDF | `PDF_TEXT_NOT_EXTRACTABLE` | HTTP 422，`request_id=82a495e78e234ce1ac3d46b86bd3dcbc` | 2026-09-27 完整接口验收输出 | PASS |  |
| 伪装 PDF | 错误文件内容 | `NOT_A_PDF` | HTTP 400，`request_id=c1a3c1b5a4fc42cd860a0977569366ed` | 2026-09-27 完整接口验收输出 | PASS |  |
| 存在词检索 | `Fubini` | 返回原文、来源和页码 | 2 项，页码 1-2，来源 `local acceptance` | 2026-09-27 完整接口验收输出 | PASS | 两个逻辑资料复用同一文件 |
| 无结果检索 | `phrase-that-cannot-exist-92741` | `not_found` 且 `items=[]` | 与预期一致 | 2026-09-27 完整接口验收输出 | PASS |  |
| Token 错误 | `Bearer wrong-token` | `UNAUTHORIZED` | HTTP 401，`request_id=fc8aef2950bc4889885bbb88ba1c1a0e` | 2026-09-27 完整接口验收输出 | PASS |  |
| 数据库故障 | 停止 PostgreSQL 后请求 | `DATABASE_UNAVAILABLE` | HTTP 503，`request_id=2ce78e3eb0c64d75910a996760540904` | 2026-09-27 故障演练输出 | PASS | 已立即恢复 DB |
| 重启持久化 | 停止/启动服务与 DB 后再查 | 原资料仍可检索 | `/ready=ready`，`Fubini` 仍返回 2 项和原 `document_id` | 2026-09-27 恢复与持久化输出 | PASS | 未使用 `--volumes` |

## SH 与公网验收

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| SH 只读快照 | 手册阶段 1 | 容器、网络、端口、磁盘、DNS 可确认 | Ubuntu 24.04.4，Docker 29.1.3，Compose 2.40.3，根盘剩余 19G；Caddy 独占 80/443；DNS 后续解析到 `124.222.112.238` | 2026-09-27 SSH 只读快照与部署前复查 | PASS | 首次快照时 DNS 未生效，确认生效后才开始写入 |
| 新栈内部就绪 | 手册阶段 3 | 迁移成功，`/ready` 成功 | 迁移 `20260927_0001` 成功，`/health=ok`，`/ready=ready` | 2026-09-27 SH Compose 与容器内请求输出 | PASS | PostgreSQL 和 API 均未发布宿主机端口 |
| Caddy 备份 | 时间戳副本 | 副本存在 | `/opt/for-mygirl/shared/prod/Caddyfile.material-library-20260927-1618.bak`，498 bytes | 2026-09-27 SH `stat` 输出 | PASS |  |
| Caddy 配置校验 | `caddy validate` | 成功 | `Valid configuration` | 2026-09-27 Caddy 容器校验输出 | PASS | 通过容器内候选文件热加载，未重建容器 |
| 原站点回归 | `https://for-fdd.xyz/` | 变更前后均正常 | 变更前后均为 HTTP 200 | 2026-09-27 SH `curl` 输出 | PASS |  |
| 新站 HTTPS | `/health` 和 `/ready` | TLS 有效，状态正常 | Let's Encrypt `YE1`，CN=`materials.for-fdd.xyz`；`ok` / `ready` | 2026-09-27 SH `curl` 与 `openssl s_client` 输出 | PASS | 证书截止 2026-12-26 |
| Windows HTTP 冒烟 | 本机到公网 HTTPS | 上传和检索成功 | `doc_f62f9180592448248d0f88743781756a`，2 页/1 片段，命中页码 1-2 | 2026-09-27 本机 Docker/httpx 公网输出 | PASS | Windows 本地 DNS/代理/Schannel 干扰脚本，验收容器使用正确 SNI 与证书校验 |
| 第二台机器 MCP | `tools/list` + 3 个工具 | 均返回结构化 JSON | 本机隔离容器已通过真实 stdio MCP；协议 `2025-11-25`，3 工具全成功 | 2026-09-27 MCP ClientSession 输出 | NOT RUN | 尚未由队友的第二台物理机器复验，不升级为 PASS |

## 边界和接受的风险

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 范围声明 | 对照设计文档 | 未实现 OCR、RAG、向量库、私有资料、更新/删除、异步 Worker | 代码和部署均保持该范围 | 当前提交 + 公网/MCP 验收 | PASS |  |
| 备份边界 | 对照部署手册 | 没有备份或恢复保证 | 未实现备份，文档已明示风险 | `docs/deployment-runbook.md` | PASS | PostgreSQL 卷和 PDF 卷必须成对保留 |
