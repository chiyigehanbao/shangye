"""集中配置。所有配置均可通过环境变量覆盖，方便本地 / Docker / 云服务器切换。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DB_PATH = Path(os.getenv("DATABASE_PATH", str(DATA_DIR / "flowdesk.db")))

APP_NAME = os.getenv("APP_NAME", "FlowDesk")
APP_URL = os.getenv("APP_URL", "http://localhost:8000")
ENV = os.getenv("ENV", "development").lower()

# ---------- 会话 ----------
COOKIE_NAME = os.getenv("COOKIE_NAME", "fd_session")
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "7"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"

# ---------- 平台管理员（首次启动自动创建） ----------
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@flowdesk.dev")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@12345")
ADMIN_NAME = os.getenv("ADMIN_NAME", "平台管理员")

# ---------- 演示账号 ----------
SEED_DEMO = os.getenv("SEED_DEMO", "1") == "1"
DEMO_EMAIL = os.getenv("DEMO_EMAIL", "demo@flowdesk.dev")
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@12345")
DEMO_NAME = os.getenv("DEMO_NAME", "陈默")
DEMO_WORKSPACE = os.getenv("DEMO_WORKSPACE", "星野工作室")

# ---------- 上传限制 ----------
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "15"))
MAX_DOC_FILES = int(os.getenv("MAX_DOC_FILES", "20"))

# ---------- 文档异步队列 ----------
DOC_WORKERS = max(1, int(os.getenv("DOC_WORKERS", "1")))
DOC_TASK_MAX_ATTEMPTS = int(os.getenv("DOC_TASK_MAX_ATTEMPTS", "3"))

# ---------- AI ----------
# auto: 云 API -> Ollama -> 规则；api: 只用云 API；ollama: 只用本地；rules: 只用规则
AI_MODE = os.getenv("AI_MODE", "auto").lower()
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "deepseek-chat")
OLLAMA_BASE = os.getenv("OLLAMA_BASE", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5")
AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "45"))

# ---------- 安全 ----------
# 生产环境建议设为你的域名，例如 https://flowdesk.example.com
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "uploads").mkdir(parents=True, exist_ok=True)
