# SH 分阶段部署手册

## 1. 原则与变更范围

目标是在 SH 的 `/opt/material-library` 部署 pgvector PostgreSQL 和单 worker `material-service`，再让现有 Caddy 代理 `https://materials.for-fdd.xyz/mcp` 及短期传输 URL。不修改 PostgreSQL 公网端口，不重建 `for-mygirl` 栈，不使用 `docker compose down --volumes`。

以下每个阶段都是独立停止点。实际容器名和 Compose 项目名必须在第 1 阶段重新确认，不得只依赖旧记录。

## 2. 阶段 1：只读现状快照

```bash
ssh SH
uname -a
docker version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker network ls
df -h /
sudo ss -lntp | grep -E ':(80|443)\b'
sudo ls -l /opt/for-mygirl/shared/prod/Caddyfile
sudo sed -n '1,240p' /opt/for-mygirl/shared/prod/Caddyfile
getent hosts materials.for-fdd.xyz
```

- 预期：现有 Caddy 容器、80/443 监听、Caddyfile 路径、磁盘和 DNS 都有明确输出。
- 停止：磁盘不足、DNS 未指向 SH、Caddyfile 路径不同、现有服务不健康或发现端口冲突。
- 回滚：无，本阶段不写入。

## 3. 阶段 2：创建项目目录并传输文件

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/material-library
cd /opt/material-library
```

传入已验证的仓库内容，在服务器上根据 `.env.example` 创建仅当地可读的 `.env`：

```bash
chmod 600 .env
docker network inspect material_proxy >/dev/null 2>&1 || docker network create material_proxy
docker compose -f deploy/compose.yaml --env-file .env config
```

- 预期：只新建 `/opt/material-library`、项目文件和 `material_proxy`；Compose 配置可完整展开。
- 停止：传输文件不完整、数据库密码/API Token/传输签名密钥为示例值、Compose 出现公网端口或网络冲突。
- 回滚：停止本项目容器；确认无其他容器使用后才删除新建的 `material_proxy`。不触碰 `/opt/for-mygirl`。

## 4. 阶段 3：数据库、迁移与内部健康检查

```bash
cd /opt/material-library
docker compose -f deploy/compose.yaml --env-file .env up -d postgres
docker compose -f deploy/compose.yaml --env-file .env run --rm material-service alembic upgrade head
docker compose -f deploy/compose.yaml --env-file .env up -d material-service
docker compose -f deploy/compose.yaml --env-file .env ps
docker compose -f deploy/compose.yaml --env-file .env exec -T material-service \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode()); print(urllib.request.urlopen('http://127.0.0.1:8000/ready').read().decode())"
```

- 预期：PostgreSQL 和服务均健康，迁移到 `head`，内部返回 `ok` 和 `ready`。
- 停止：迁移失败、数据库不就绪、PDF 卷不可写或容器重启循环。此时不得修改 Caddy。
- 回滚：`docker compose -f deploy/compose.yaml --env-file .env down`。保留两个持久卷以便诊断。

## 5. 阶段 4：连接现有 Caddy

先确认 Caddy 容器名，再做可逆网络连接：

```bash
docker network connect material_proxy <existing-caddy-container>
```

若返回已连接，视为幂等成功。长期配置应在现有 Caddy Compose 中声明该外部网络；临时 `network connect` 必须记录，因为容器重建后可能丢失。

```bash
stamp=$(date +%Y%m%d-%H%M%S)
sudo cp -a /opt/for-mygirl/shared/prod/Caddyfile "/opt/for-mygirl/shared/prod/Caddyfile.material-library-$stamp.bak"
```

只追加 `deploy/Caddyfile.example` 中 `materials.for-fdd.xyz` 站点块，随后：

```bash
docker exec <existing-caddy-container> caddy validate --config /etc/caddy/Caddyfile
```

- 预期：校验成功，备份文件存在，新站点只指向 `material-service:8000`。
- 停止：任何 Caddy 校验错误、原站点被改写或 Caddy 无法解析服务容器名。校验失败时绝不 reload。
- 回滚：从时间戳备份恢复 Caddyfile，再次 validate；如有需要，`docker network disconnect material_proxy <existing-caddy-container>`。

## 6. 阶段 5：热加载与回归

```bash
docker exec <existing-caddy-container> caddy reload --config /etc/caddy/Caddyfile
curl -fsS https://for-fdd.xyz/
curl -fsS https://materials.for-fdd.xyz/health
curl -fsS https://materials.for-fdd.xyz/ready
```

- 预期：Caddy 只热加载，原 `for-fdd.xyz` 站点仍正常，新域名 HTTPS 证书有效并返回健康状态。
- 停止：原站点异常、TLS 失败、新域名 502/503 或 `/ready` 失败。
- 回滚：恢复备份 Caddyfile，validate 后 reload；不重启整个 `for-mygirl` 栈。

## 7. 阶段 6：Windows HTTP 与 Codex MCP 验收

Windows 使用 [API 契约](api-contract.md) 或：

```powershell
.\deploy\sh-smoke.ps1 -BaseUrl 'https://materials.for-fdd.xyz' `
  -ApiToken $env:MATERIAL_SERVICE_API_TOKEN `
  -PdfPath 'D:\materials\multiple-integrals.pdf'
```

Codex 只配置远程 URL `https://materials.for-fdd.xyz/mcp` 和 Bearer Key，然后验证 `tools/list` 精确返回 `prepare_material_upload`、`get_upload_result`、`list_materials`、`search_course_material`、`get_document_content`、`get_document_download`。MCP Inspector 使用同一 URL 与 Key 做第二客户端协议验收。

- 预期：HTTP 和 MCP 都返回结构化 JSON，搜索项可回溯资料和页码，上传与下载只暴露短期 URL。
- 停止：仅服务器内可访问、Token 错误、上传超时、MCP 返回非 JSON 或原站点回归失败。
- 回滚：先移除新 Caddy 站点并热加载，再用 `docker compose ... down` 停止本项目；不删除持久卷。

## 8. 已知运维边界

第一版没有自动备份、恢复演练、限速平台、异步 Worker 或删除 API。PostgreSQL 卷和 PDF 卷缺一都不能完整恢复；上传前必须检查 SH 根磁盘剩余空间。
