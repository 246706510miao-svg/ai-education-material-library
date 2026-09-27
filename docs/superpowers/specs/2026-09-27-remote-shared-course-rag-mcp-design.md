# 远程共享课程资料 RAG MCP 设计

> 日期：2026-09-27  
> 状态：已确认，作为完整实施依据

## 1. 目标与边界

在 SH 服务器上部署一个远程 Streamable HTTP MCP。合作方只配置
`https://materials.for-fdd.xyz/mcp` 和一个共享 Bearer Key，即可把文本型 PDF 上传到同一个公共资料库、检索证据、分页读取解析文本并下载原始 PDF。

MCP 只返回资料、证据和稳定 JSON，不调用生成模型回答问题。Agent 负责依据证据组织回答。第一版不实现 OCR、私人资料、用户级权限、删除工具、异步 Worker、历史版本或自动备份。

## 2. 总体架构

```text
Codex / 其他 MCP Host
  -> HTTPS Streamable HTTP + Bearer Key
  -> Caddy: https://materials.for-fdd.xyz/mcp
  -> Python MCP/FastAPI 单进程、单 Worker
       -> PDF 上传、解析和切块
       -> 轻量多语言 embedding（CPU、本地加载一次）
       -> PostgreSQL 16 + pgvector
       -> 私有文件卷
```

合作方只配置 `/mcp`。PDF 字节通过 MCP 动态签发的短期同域上传 URL 传输；原件下载同样使用短期签名 URL。普通 `/v1` 业务 API 不作为合作方正式接口。

## 3. MCP 工具

所有工具使用稳定 `structuredContent` JSON；响应包含 `status` 和 `request_id`。

1. `prepare_material_upload`
   - 首次调用校验六个必填元数据并检查疑似重复。
   - 有疑似重复时返回 `confirmation_required`、绑定原始元数据的 `confirmation_id` 和候选资料短期下载 URL。
   - 再次携带 `confirmation_id` 与 `confirm_distinct_material=true` 后签发短期上传 URL。
2. `get_upload_result`
   - 返回 `waiting_upload|processing|success|partial_success|failed|expired|duplicate`。
   - embedding 失败但关键词索引可用时返回 `partial_success`。
3. `list_materials`
   - 分页列出资料，并返回可选学校、专业、课程、单元和资料类型范围。
4. `search_course_material`
   - 中文词法、英文全文与向量召回后使用 RRF 融合。
   - 支持可选元数据过滤、游标分页和调试分数。
5. `get_document_content`
   - 按片段游标或 PDF 页码范围读取解析文本。
   - 单次限制片段数、页数和字符数，超出时返回 `next_cursor`。
6. `get_document_download`
   - 按 `document_id` 生成 5 至 15 分钟有效的原始 PDF 下载 URL。

Server instructions 和工具描述声明：课程资料、教材、课件和考试内容应先调用 `search_course_material`；没有证据时不得把模型记忆描述为资料库事实。

## 4. 上传与重复处理

上传必填：`school`、`major`、`course`、`unit`、`material_type`、`title`。可选：`source_name`、`author`、`publication_year`、`description`、`is_official_source`。

文本字段去除首尾空白并合并连续空格。上传前在学校、专业、课程、资料类型相同的范围内，用规范化标题相等或包含关系判断疑似重复。用户确认不同后仍可上传为新资料。

文件上传完成后计算 SHA-256。字节完全相同则不新建资料，返回 `duplicate`、已有 `document_id` 和短期下载 URL。第一版每份资料只有一个版本；保留 `document_versions` 表作为内部结构，但不暴露版本管理。

成功上传立即进入公共库。任何持有共享 Key 的合作方都能检索和下载。错误资料第一版不提供 MCP 删除工具，必要时管理员手工停用数据库记录。

## 5. 数据模型

沿用 `stored_files -> documents -> document_versions -> document_chunks`，清空现有 POC 数据并用新迁移重建。

`documents` 的必填检索范围字段为：

```text
school, major, course, unit, material_type, title
```

`document_chunks` 保留正文、页码、章节、质量标记，并增加最终模型固定维度的 `embedding vector(N)`、`embedding_model` 和 `embedding_version`。PostgreSQL 镜像切换为 PostgreSQL 16 + pgvector，数据库不发布宿主机端口。

原始 PDF 保存在服务器私有卷；MCP 不返回真实 `storage_key` 或服务器路径。

## 6. 解析、切块与向量

第一版只接受文本型 PDF。扫描件返回 `PDF_TEXT_NOT_EXTRACTABLE`。

切块优先按标题、段落和页码，目标 600 至 1200 字符；过长段落再切分，相邻块重叠约 100 至 200 字符。正文继续保留页码、`heading_path`、`formula_status`、`has_figure` 与 `quality_flags`。

embedding 输入拼接学校、专业、课程、单元、资料标题、章节标题和正文；MCP 返回的 `text` 仍只包含原始正文。

先选择一个可在 SH 的 4 核 CPU、3.6 GiB 内存环境中运行的临时轻量多语言模型完成工程闭环。模型在 Web 进程中加载一次，只运行一个 Worker。效果验收再用真实资料比较 2 至 3 个候选，确定最终模型后重建向量。

## 7. 混合检索

候选来源：

- 中文：短语、正文包含、标题与元数据命中；
- 英文：PostgreSQL `tsvector` 全文检索；
- 语义：pgvector 余弦距离。

各取内部 Top 20，使用 RRF 合并、按 chunk 去重，再应用相关性门槛。普通响应只返回最终排名和 `retrieval_modes`；`debug=true` 时增加词法排名、向量排名、相似度和 RRF 分数。

查询支持可选的学校、专业、课程、单元、资料类型和 `document_id` 精确过滤。Agent 先通过 `list_materials` 获得规范值。默认返回 5 条，单页硬上限 20 条，可用游标继续读取。

向量检索不可用时降级为词法检索并返回 `partial_success`；没有足够相关证据时返回 `not_found`；数据库整体不可用时返回 `DATABASE_UNAVAILABLE`。

## 8. 上传与下载通道

`prepare_material_upload` 签发一次性上传令牌。上传请求使用 `PUT /transfers/uploads/{token}` 传送 `application/pdf` 字节；令牌短期有效、单次使用，并绑定元数据、文件名和大小上限。PUT 同步执行保存、解析、切块、embedding 和入库；最长 120 秒。

`get_document_download` 签发短期下载令牌，`GET /transfers/downloads/{token}` 流式返回当前原件。上传和下载 URL 是 MCP 动态结果，不是合作方需要预先配置的第二入口。

## 9. 部署

在现有 `shared-material-library` 上实施。保留当前 Caddy、Compose、FastAPI、Alembic 和测试体系，新增远程 MCP ASGI 应用并挂载 `/mcp`。Caddy 继续反向代理 `material-service:8000`；PostgreSQL 和内部端口不暴露。

数据库重建和 PostgreSQL 镜像替换前先核对目标卷。当前 POC 数据允许清空，但不得影响 `for-mygirl` 的 MySQL、Redis、Caddy或其他容器。

## 10. 验收

工程闭环必须证明：Codex与 MCP Inspector能通过 URL和共享 Key连接；发现并调用六个工具；完成 PDF 上传、公共检索、全文分页和原件下载；第二连接能查到第一连接上传的资料；重复提醒、确认与 SHA-256 拒绝有效；混合检索、向量降级、`not_found` 和数据库故障语义可复现。

效果闭环在工程闭环后进行：使用真实文本型 PDF、30 至 50 道中文问题和 5 至 10 道无答案问题比较 2 至 3 个轻量模型。评测前只能声明“工程闭环完成，真实检索效果待验”。

根目录 `README.md` 只写项目定位、架构、六个工具、最短接入、开发验证、部署入口与已知边界，保持清晰简短。
