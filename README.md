# Shared Course RAG MCP

一个部署在服务器上的共享课程资料库：合作方只需配置远程 MCP URL 和 Bearer Key，即可共同上传 PDF、混合检索内容、分页读取解析文本并下载原文件。

## 核心架构

1. Agent 连接 `https://materials.for-fdd.xyz/mcp`。
2. FastAPI 与 Streamable HTTP MCP 共用一个单 worker 进程。
3. PDF 原文件保存在服务端卷；PostgreSQL + pgvector 保存元数据、文本块和向量。
4. 检索融合词法匹配与向量相似度，返回原文、文档和 PDF 页码，不生成答案。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `prepare_material_upload` | 校验元数据、提醒疑似重复并生成短期上传 URL |
| `get_upload_result` | 查询上传、解析和索引结果 |
| `list_materials` | 按学校、专业、课程等精确筛选资料 |
| `search_course_material` | 词法 + pgvector + RRF 混合检索 |
| `get_document_content` | 分页读取一份文档的完整解析内容 |
| `get_document_download` | 获取原 PDF 的短期下载 URL |

## 连接

在 Codex 或 MCP Inspector 中添加远程 Streamable HTTP 服务：

- URL：`https://materials.for-fdd.xyz/mcp`
- Header：`Authorization: Bearer <合作密钥>`

服务端 instructions 会要求 Agent 在回答课程资料问题前先检索；客户端是否强制遵守仍取决于客户端/Agent 配置。

## 本地验证

```powershell
uv sync --extra dev
uv run ruff check material_service mcp_server evaluation tests
uv run pytest -q
docker compose -f deploy/compose.yaml --env-file .env build
```

部署步骤见 [`docs/deployment-runbook.md`](docs/deployment-runbook.md)，完整 JSON 字段见 [`docs/api-contract.md`](docs/api-contract.md)。

## 当前边界

- POC 只接受可提取文字的 text-based PDF；暂不做 OCR。
- 一个共享 Key 对应一个共享资料库；暂不做用户权限、删除和历史版本。
- 上传与下载 URL 短期有效且单次使用。
- 工程闭环不等于检索效果已达标；真实效果仍需用真实 PDF 和标注问题运行 `evaluation/`。
