param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host '已创建 .env。请填写模型 DEEPSEEK_API_KEY 和资料 AXISVERSE_MCP_KEY，然后再次运行。'
    exit 1
}
if (-not (Test-Path -LiteralPath 'node_modules/.modules.yaml')) {
    Invoke-Checked 'pnpm' @('install', '--frozen-lockfile')
}
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    Invoke-Checked 'python' @('-m', 'venv', '.venv')
}
Invoke-Checked '.venv/Scripts/python.exe' @('-m', 'pip', 'install', '-r', 'apps/web/axisverse-mcp/requirements.txt')
if ($Rebuild -or -not (Test-Path -LiteralPath 'apps/web/dist/index.html')) {
    Invoke-Checked 'pnpm' @('run', 'build')
}
Invoke-Checked 'pnpm' @('run', 'axisverse:start')
