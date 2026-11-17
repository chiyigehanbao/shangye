"""FlowDesk 应用入口。"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, ai, config, database as db, seed, workers
from .routers import admin, analytics, auth, billing, dashboard, docs, excel, quotes, workspace

START_AT = time.time()
log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if config.ENV == "production":
        if config.ADMIN_PASSWORD in ("Admin@12345", "ChangeMe_Admin_2026"):
            log.warning("安全警告：生产环境仍在使用默认管理员密码，请立即修改 ADMIN_PASSWORD。")
        if config.SEED_DEMO:
            log.warning("安全提示：生产环境 SEED_DEMO=1，演示账号可被公开访问；公开演示站可保留，否则请设为 0。")
        if config.APP_URL.startswith("https://") and not config.COOKIE_SECURE:
            log.warning("安全提示：APP_URL 为 HTTPS，但 COOKIE_SECURE=0；建议启用安全 Cookie。")
    db.init_db()
    seed.seed_all()
    workers.start()
    yield
    workers.stop()


app = FastAPI(
    title="FlowDesk API",
    version=__version__,
    description="AI 办公自动化工作台：Excel 清洗、文档抽取、报价单、销售看板。",
    lifespan=lifespan,
    docs_url="/api/_docs" if config.ENV != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if config.ENV != "production" else None,
)

app.add_middleware(GZipMiddleware, minimum_size=1200)
if config.ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # 同源 / 白名单来源校验，防止跨站表单提交
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin", "")
        if origin:
            parsed = urlparse(origin)
            allowed = {urlparse(o).netloc for o in config.ALLOWED_ORIGINS if o}
            if parsed.netloc != request.url.netloc and parsed.netloc not in allowed:
                return JSONResponse({"detail": "跨站请求被拒绝"}, status_code=403)

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'"
    )
    if request.url.path.startswith("/static/vendor/"):
        response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
    elif request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.include_router(auth.router)
app.include_router(workspace.router)
app.include_router(dashboard.router)
app.include_router(excel.router)
app.include_router(docs.router)
app.include_router(quotes.router)
app.include_router(analytics.router)
app.include_router(billing.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"ok": True, "app": config.APP_NAME, "version": __version__,
            "uptime_seconds": int(time.time() - START_AT)}


@app.get("/api/status")
def status():
    """公开状态：不暴露密钥，只告诉前端 AI 当前走哪条通道。"""
    state = ai.status()
    return {"ok": True, "ai_mode": state["active"], "ai_label": state["active_label"],
            "api_configured": state["api_configured"], "ollama_online": state["ollama_online"]}


app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")


def _page(filename: str) -> FileResponse:
    return FileResponse(config.STATIC_DIR / filename, headers={"Cache-Control": "no-cache"})


@app.get("/")
def landing():
    return _page("index.html")


@app.get("/login")
def login_page():
    return _page("login.html")


@app.get("/app")
def app_page():
    return _page("app.html")


@app.get("/favicon.svg")
def favicon():
    return _page("favicon.svg")


@app.get("/robots.txt")
def robots():
    return FileResponse(config.STATIC_DIR / "robots.txt", media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=config.ENV != "production")
