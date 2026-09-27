# 共享教学资料库验收记录

> 本文档是执行记录，不是完成声明。只有“实际结果”和“证据路径”被当场填写的项目才能标记 `PASS` 或 `FAIL`。

## 环境版本

| 项目 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| Python | `python --version` | Python 3.12.x |  |  | NOT RUN |  |
| PostgreSQL | `SELECT version()` | PostgreSQL 16.x |  |  | NOT RUN |  |
| PyMuPDF | `python -c "import pymupdf; print(pymupdf.version)"` | 输出实际版本 |  |  | NOT RUN |  |
| MCP SDK | `uv run python -m mcp_server.server --version` | 输出 SDK 版本 |  |  | NOT RUN | 同时记录客户端协议信息 |

## 本地自动化与容器

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 静态检查 | `uv run ruff check material_service mcp_server frontend_poc tests` | 0 个错误 |  |  | NOT RUN |  |
| 全量测试 | `uv run pytest -q` | 0 个失败 |  |  | NOT RUN |  |
| Compose 展开 | `docker compose -f deploy/compose.yaml config` | 成功，无对外 DB 端口 |  |  | NOT RUN |  |
| 数据库迁移 | `docker compose ... run --rm material-service alembic upgrade head` | 升级至 head |  |  | NOT RUN |  |
| 内部健康 | `/health` 与 `/ready` | `ok` / `ready` |  |  | NOT RUN |  |
| 文本 PDF 上传 | 2 页文本 PDF | 有 ID、页数、片段数 |  |  | NOT RUN |  |
| 幂等重试 | 相同 `idempotency_key` | ID 相同，不新增记录 |  |  | NOT RUN |  |
| 重复文件 | 同文件、新幂等键 | `duplicate_file=true` |  |  | NOT RUN |  |
| 扫描 PDF | 无文字 PDF | `PDF_TEXT_NOT_EXTRACTABLE` |  |  | NOT RUN |  |
| 伪装 PDF | 错误文件内容 | `NOT_A_PDF` |  |  | NOT RUN |  |
| 存在词检索 | 已入库关键词 | 返回原文、来源和页码 |  |  | NOT RUN |  |
| 无结果检索 | 不存在的词 | `not_found` 且 `items=[]` |  |  | NOT RUN |  |
| Token 错误 | `Bearer wrong-token` | `UNAUTHORIZED` |  |  | NOT RUN |  |
| 数据库故障 | 停止 PostgreSQL 后请求 | `DATABASE_UNAVAILABLE` |  |  | NOT RUN | 故障演练后立即恢复 DB |
| 重启持久化 | 停止/启动 Compose 后再查 | 原资料仍可检索 |  |  | NOT RUN | 不使用 `--volumes` |

## SH 与公网验收

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| SH 只读快照 | 手册阶段 1 | 容器、网络、端口、磁盘、DNS 可确认 |  |  | NOT RUN |  |
| 新栈内部就绪 | 手册阶段 3 | 迁移成功，`/ready` 成功 |  |  | NOT RUN |  |
| Caddy 备份 | 时间戳副本 | 副本存在 |  |  | NOT RUN |  |
| Caddy 配置校验 | `caddy validate` | 成功 |  |  | NOT RUN | 失败则不 reload |
| 原站点回归 | `https://for-fdd.xyz/` | 变更前后均正常 |  |  | NOT RUN |  |
| 新站 HTTPS | `/health` 和 `/ready` | TLS 有效，状态正常 |  |  | NOT RUN |  |
| Windows HTTP 冒烟 | `deploy/sh-smoke.ps1` | 上传和检索成功 |  |  | NOT RUN |  |
| 第二台机器 MCP | `tools/list` + 3 个工具 | 均返回结构化 JSON |  |  | NOT RUN |  |

## 边界和接受的风险

| 检查 | 命令/输入 | 预期结果 | 实际结果 | 证据路径 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 范围声明 | 对照设计文档 | 未实现 OCR、RAG、向量库、私有资料、更新/删除、异步 Worker |  |  | NOT RUN |  |
| 备份边界 | 对照部署手册 | 没有备份或恢复保证 |  |  | NOT RUN | PostgreSQL 卷和 PDF 卷必须成对保留 |
