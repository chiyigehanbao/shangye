# 公网演示启动（Windows 本机 + Cloudflare Tunnel）
# 用法：
#   $env:APP_URL="https://app.example.com"
#   .\scripts\run-public.ps1
# 注意：仅绑定 127.0.0.1，公网访问由 cloudflared 负责，不需要开防火墙端口。

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $env:APP_URL -or $env:APP_URL -notmatch "^https://") {
    Write-Host "请先设置 APP_URL，例如：" -ForegroundColor Yellow
    Write-Host '  $env:APP_URL="https://app.example.com"' -ForegroundColor Yellow
    exit 1
}

if (-not $env:ENV) { $env:ENV = "production" }
if (-not $env:COOKIE_SECURE) { $env:COOKIE_SECURE = "1" }
if (-not $env:SEED_DEMO) { $env:SEED_DEMO = "1" }
if (-not $env:AI_MODE) { $env:AI_MODE = "auto" }

if (-not $env:ADMIN_PASSWORD) {
    Write-Warning "未设置 ADMIN_PASSWORD，将使用默认管理员密码；公开演示前请修改。"
}

Write-Host "[FlowDesk] 公网模式：$env:APP_URL" -ForegroundColor Cyan
Write-Host "[FlowDesk] 本机监听：http://127.0.0.1:8077" -ForegroundColor DarkGray
Write-Host "[FlowDesk] 下一步：cloudflared tunnel run flowdesk" -ForegroundColor DarkGray
Write-Host ""

python -m uvicorn app.main:app `
    --host 127.0.0.1 `
    --port 8077 `
    --workers 1 `
    --proxy-headers `
    --forwarded-allow-ips="127.0.0.1,::1"
