# 本地开发/演示启动（Windows PowerShell）
# 依赖：Python 3.11+，先执行 pip install -r requirements.txt
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $env:ENV) { $env:ENV = "development" }
if (-not $env:AI_MODE) { $env:AI_MODE = "auto" }

Write-Host "[FlowDesk] 启动 http://127.0.0.1:8000" -ForegroundColor Cyan
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --reload
