# 共享教学资料库 API 与 MCP 契约

## 1. 访问边界

- 公网基址：`https://materials.for-fdd.xyz`
- `/health` 和 `/ready` 无需 Token；`/v1/*` 必须传 `Authorization: Bearer <token>`。
- 业务返回值均为 JSON；只有 PDF 上传请求使用 `multipart/form-data`。
- 调用方不传 SQL，也不直连 PostgreSQL。

PowerShell 会话先设置：

```powershell
$env:MATERIAL_SERVICE_BASE_URL = 'https://materials.for-fdd.xyz'
$env:MATERIAL_SERVICE_API_TOKEN = '<project-token>'
```

## 2. HTTP 接口

### 2.1 存活与就绪

```powershell
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/health"
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/ready"
```

`/health` 成功为 `{"status":"ok"}`；`/ready` 同时验证数据库和 PDF 目录，成功为 `{"status":"ready"}`。

### 2.2 同步上传并解析 PDF

```powershell
$headers = @{ Authorization = "Bearer $env:MATERIAL_SERVICE_API_TOKEN" }
$form = @{
    file = Get-Item -LiteralPath 'D:\materials\multiple-integrals.pdf'
    title = '多重积分讲义'
    course = '高等数学'
    unit = '多重积分'
    source_name = '课程资料整理'
    source_type = 'course_material'
    idempotency_key = [guid]::NewGuid().ToString()
    applicable_school = '南京理工大学'
    is_official_source = 'false'
}
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/v1/materials/ingest" `
    -Method Post -Headers $headers -Form $form
```

可选字段为 `author`、`publication_year`、`description`、`applicable_school`和 `is_official_source`。成功时返回 `document_id`、`document_version_id`、`file_id`、`page_count`、`chunk_count`、`duplicate_file` 和 `searchable`。同一 `idempotency_key` 重试必须返回原结果。

### 2.3 列出资料

```powershell
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/v1/materials?course=%E9%AB%98%E7%AD%89%E6%95%B0%E5%AD%A6&unit=%E5%A4%9A%E9%87%8D%E7%A7%AF%E5%88%86&limit=10" `
    -Headers $headers
```

返回 `status`、`items` 和可选 `next_cursor`；列表不返回全部片段正文。

### 2.4 检索候选片段

```powershell
$body = @{
    query = '交换积分次序'
    course = '高等数学'
    unit = '多重积分'
    limit = 10
} | ConvertTo-Json
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/v1/materials/search" `
    -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

命中项包含片段原文、资料名、`document_id`、PDF 起止页、来源、质量标记、分数及 `score_type=full_text_rank`。正常无结果不是故障：

```json
{"status":"not_found","items":[]}
```

## 3. 稳定错误语义

错误返回的形状为：

```json
{
  "status": "error",
  "error_code": "UNAUTHORIZED",
  "message": "Invalid or missing API token.",
  "request_id": "req_..."
}
```

| 场景 | 错误码 | 要点 |
|---|---|---|
| Token 缺失或错误 | `UNAUTHORIZED` | 不返回内部凭据信息 |
| 扫描件/无可用文字 | `PDF_TEXT_NOT_EXTRACTABLE` | 第一版不做 OCR |
| 伪装成 PDF | `NOT_A_PDF` | 扩展名不能代替文件校验 |
| PDF 损坏 | `PDF_CORRUPTED` | 解析器无法打开 |
| 超过 50 MB / 300 页 | `FILE_TOO_LARGE` / `TOO_MANY_PAGES` | 限制可由服务端环境变量收紧 |
| 数据库不可用 | `DATABASE_UNAVAILABLE` | 不得伪装成 `not_found` |
| PDF 目录不可写 | `STORAGE_UNAVAILABLE` | 检查卷和磁盘 |
| 处理超时 | `PDF_PROCESSING_TIMEOUT` | 默认 120 秒 |

未授权请求示例：

```powershell
Invoke-RestMethod "$env:MATERIAL_SERVICE_BASE_URL/v1/materials?limit=1" `
    -Headers @{ Authorization = 'Bearer wrong-token' }
```

扫描 PDF 和数据库故障的请求形状与正常上传/检索相同；验收时必须核对上述错误码和 `request_id`。

## 4. 本地 MCP Server

MCP 运行在队友电脑上，从本机路径读取 PDF，再通过 HTTPS 上传。它不直连数据库。

```powershell
$env:MATERIAL_SERVICE_BASE_URL = 'https://materials.for-fdd.xyz'
$env:MATERIAL_SERVICE_API_TOKEN = '<project-token>'
uv run python -m mcp_server.server --version
uv run python -m mcp_server.server
```

将后一条命令作为 MCP Client 的 stdio server 配置，并传入上述两个环境变量。可用工具：

- `upload_pdf(file_path, title, course, unit, source_name, ...)`
- `list_materials(course?, unit?, limit=10)`
- `search_materials(query, course?, unit?, document_id?, limit=10)`

工具返回 `{"tool":"<name>","result":{...}}`。工具只返回结构化数据，不生成教学答案，也不包含 RAG 逻辑。
