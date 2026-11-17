"""Excel 自动化 · 后端服务
FastAPI + Pandas + SQLite(持久化) + 本地 Ollama(可选)
启动: uvicorn main:app --reload --port 8000
默认账号: admin / admin123 （可用环境变量 ADMIN_USER / ADMIN_PASSWORD 覆盖）
"""
import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import docextract
import ollama_client as OL
import processor as P

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
SESSIONS: dict[str, dict] = {}
TOKENS: dict[str, dict] = {}
TOKEN_TTL = 12 * 3600

ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

db.init_db()
db.ensure_user(ADMIN_USER, ADMIN_PASSWORD)

app = FastAPI(title="Excel Automation · Backend", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------- 鉴权 ----------------
def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "未登录")
    token = authorization[7:].strip()
    info = TOKENS.get(token)
    if not info or info["exp"] < time.time():
        TOKENS.pop(token, None)
        raise HTTPException(401, "登录已过期，请重新登录")
    return info["user"]


class LoginReq(BaseModel):
    username: str
    password: str


class ProcessReq(BaseModel):
    session: str
    remove_empty: bool = True
    remove_dup: bool = True
    group_by: Optional[str] = None
    value_col: Optional[str] = None
    agg: str = "sum"


class AIReq(BaseModel):
    session: str
    text: str = ""


@app.post("/api/login")
def login(req: LoginReq):
    user = db.get_user(req.username)
    if not user or not db.verify_pw(req.password, user["pw_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    token = secrets.token_urlsafe(32)
    TOKENS[token] = {"user": {"id": user["id"], "username": user["username"]}, "exp": time.time() + TOKEN_TTL}
    return {"token": token, "username": user["username"]}


@app.post("/api/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.lower().startswith("bearer "):
        TOKENS.pop(authorization[7:].strip(), None)
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return {"username": user["username"]}


@app.get("/api/health")
def health():
    return OL.status()


# ---------------- 上传 / 处理 ----------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(current_user)):
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    try:
        df = P.normalize_columns(P.read_table(file.filename, content))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"解析失败: {e}")
    sid = uuid.uuid4().hex
    SESSIONS[sid] = {"filename": file.filename, "df": df, "cleaned": None,
                     "summary": None, "stats": None, "user_id": user["id"]}
    headers, rows = P.df_to_aoa(df, limit=100)
    return {"session": sid, "filename": file.filename, "columns": list(df.columns),
            "row_count": int(len(df)), "headers": headers, "preview": rows}


def _get_session(sid: str, user: dict) -> dict:
    s = SESSIONS.get(sid)
    if not s or s.get("user_id") != user["id"]:
        raise HTTPException(404, "会话不存在或已过期，请重新上传文件")
    return s


@app.post("/api/process")
def process(req: ProcessReq, user: dict = Depends(current_user)):
    s = _get_session(req.session, user)
    cleaned, stats = P.clean_df(s["df"], req.remove_empty, req.remove_dup)
    summary = None
    if req.group_by:
        try:
            summary = P.aggregate(cleaned, req.group_by, req.value_col, req.agg)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, str(e))
    s["cleaned"], s["summary"], s["stats"] = cleaned, summary, stats

    ch, cr = P.df_to_aoa(cleaned, limit=100)
    sh, sr = (P.df_to_aoa(summary) if summary is not None else (None, []))
    # 全量 rows 用于持久化与历史导出
    _, full_rows = P.df_to_aoa(cleaned, limit=None)
    job_id = db.save_job(user["id"], s["filename"], stats, ch, full_rows, sh, sr)
    return {"session": req.session, "job_id": job_id, "stats": stats,
            "cleaned_headers": ch, "cleaned_rows": cr,
            "summary_headers": sh, "summary_rows": sr}


@app.get("/api/export")
def export(session: str, user: dict = Depends(current_user)):
    s = _get_session(session, user)
    if s["cleaned"] is None:
        raise HTTPException(400, "请先处理数据")
    data = P.build_excel(s["cleaned"], s["summary"])
    return _xlsx_response(data, "result.xlsx")


def _xlsx_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------- 任务历史 ----------------
@app.get("/api/jobs")
def jobs(q: str = "", page: int = 1, page_size: int = 20, user: dict = Depends(current_user)):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    rows, total = db.list_jobs(user["id"], q, page_size, (page - 1) * page_size)
    return {"jobs": rows, "total": total, "page": page, "page_size": page_size}


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: int, user: dict = Depends(current_user)):
    j = db.get_job(user["id"], job_id)
    if not j:
        raise HTTPException(404, "记录不存在")
    return {
        "id": j["id"], "filename": j["filename"], "created_at": j["created_at"],
        "stats": {"original": j["original"], "cleaned": j["cleaned"],
                  "removed_empty": j["removed_empty"], "removed_dup": j["removed_dup"]},
        "cleaned_headers": _load(j["headers_json"]),
        "cleaned_rows": _load(j["rows_json"])[:100],
        "summary_headers": _load(j["summary_headers_json"]),
        "summary_rows": _load(j["summary_rows_json"]),
    }


@app.get("/api/jobs/{job_id}/export")
def job_export(job_id: int, user: dict = Depends(current_user)):
    j = db.get_job(user["id"], job_id)
    if not j:
        raise HTTPException(404, "记录不存在")
    data = P.build_excel_from_records(_load(j["headers_json"]), _load(j["rows_json"]),
                                      _load(j["summary_headers_json"]), _load(j["summary_rows_json"]))
    return _xlsx_response(data, f"job-{job_id}.xlsx")


@app.delete("/api/jobs/{job_id}")
def job_delete(job_id: int, user: dict = Depends(current_user)):
    if not db.delete_job(user["id"], job_id):
        raise HTTPException(404, "记录不存在")
    return {"ok": True}


def _load(s):
    import json
    return json.loads(s) if s else None


# ---------------- AI ----------------
def _rule_parse(columns, text: str) -> dict:
    matched = [c for c in columns if c and c in text]
    if re.search(r"平均|均值|avg", text, re.I):
        agg = "avg"
    elif re.search(r"计数|数量|个数|单数|多少|count|订单数", text, re.I):
        agg = "count"
    elif re.search(r"最大|最高|max", text, re.I):
        agg = "max"
    elif re.search(r"最小|最低|min", text, re.I):
        agg = "min"
    else:
        agg = "sum"
    group = matched[0] if matched else ""
    value = matched[1] if len(matched) > 1 else ""
    return {"groupBy": group, "valueColumn": value, "agg": agg}


@app.post("/api/ai/command")
def ai_command(req: AIReq, user: dict = Depends(current_user)):
    s = _get_session(req.session, user)
    cols = list(s["df"].columns)
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "指令为空")
    sample = "\n".join(" | ".join(str(v) for v in row)
                       for row in s["df"].head(5).itertuples(index=False, name=None))
    parsed, via = OL.parse_command(cols, sample, text)
    if not parsed or parsed.get("groupBy") not in cols:
        parsed, via = _rule_parse(cols, text), "rule"
    return {"plan": parsed, "via": via}


@app.post("/api/ai/report")
def ai_report(req: AIReq, user: dict = Depends(current_user)):
    s = _get_session(req.session, user)
    if s["cleaned"] is None:
        raise HTTPException(400, "请先处理数据")
    stats = s["stats"] or {}
    summary = s["summary"]
    if summary is not None:
        sh, sr = P.df_to_aoa(summary, limit=30)
        summary_text = " | ".join(sh) + "\n" + "\n".join(" | ".join(str(c) for c in r) for r in sr)
    else:
        summary_text = "（未启用汇总）"
    context = (f"原始行数:{stats.get('original')} 清洗后:{stats.get('cleaned')} "
               f"删除空行:{stats.get('removed_empty')} 删除重复:{stats.get('removed_dup')}\n"
               f"汇总结果:\n{summary_text}")
    text, via = OL.report(context)
    if not text:
        text, via = _fallback_report(stats, summary), "rule"
    return {"report": text, "via": via}


def _fallback_report(stats: dict, summary) -> str:
    lines = [f"数据共 {stats.get('original')} 行，清洗后保留 {stats.get('cleaned')} 行"
             f"（删除空行 {stats.get('removed_empty')}、重复 {stats.get('removed_dup')}）。"]
    if summary is not None and len(summary):
        cols = list(summary.columns)
        lines.append(f"按「{cols[0]}」汇总为 {len(summary)} 组。")
        top = summary.head(3)
        lines.append("排名前三：" + "，".join(
            f"{r[0]}={r[1]}" for r in top.itertuples(index=False, name=None)) + "。")
    else:
        lines.append("未启用分组汇总，建议选择分组列与数值列后再生成报告。")
    return "\n".join(lines)


# ---------------- 文档字段提取 ----------------
@app.post("/api/doc/extract")
async def doc_extract(file: Optional[UploadFile] = File(None), text: str = Form(""),
                      fields: str = Form(""), user: dict = Depends(current_user)):
    raw = text or ""
    filename = "粘贴文本"
    file_id = None
    content_hash = None
    size = 0
    duplicate = False
    if file is not None and file.filename:
        content = await file.read()
        if not content:
            raise HTTPException(400, "空文件")
        try:
            if docextract.is_image(file.filename):
                raw = OL.ocr_image(content)  # 需要视觉模型
            else:
                raw = docextract.extract_text(file.filename, content)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"解析失败: {e}")
        filename = file.filename
        content_hash = hashlib.sha256(content).hexdigest()
        size = len(content)
        file_id, is_new = db.save_file(user["id"], content_hash, filename, size, content)
        duplicate = not is_new
    raw = (raw or "").strip()
    if not raw:
        raise HTTPException(400, "内容为空")
    field_list = [f.strip() for f in re.split(r"[，,、\s]+", fields) if f.strip()]
    if field_list:
        res, via = OL.extract_fields(raw, field_list)
        if not res:
            res, via = docextract.fallback_fields(raw, field_list), "rule"
    else:
        res, via = docextract.rule_extract(raw), "rule"
    job_id = db.save_doc_job(user["id"], filename, field_list, res, raw[:500], file_id, content_hash, size)
    return {"job_id": job_id, "filename": filename, "char_count": len(raw), "results": res,
            "via": via, "file_id": file_id, "duplicate": duplicate}


@app.get("/api/doc/jobs")
def doc_jobs(q: str = "", page: int = 1, page_size: int = 20, user: dict = Depends(current_user)):
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    rows, total = db.list_doc_jobs(user["id"], q, page_size, (page - 1) * page_size)
    return {"jobs": rows, "total": total, "page": page, "page_size": page_size}


@app.get("/api/doc/jobs/{job_id}")
def doc_job_detail(job_id: int, user: dict = Depends(current_user)):
    j = db.get_doc_job(user["id"], job_id)
    if not j:
        raise HTTPException(404, "记录不存在")
    return {"id": j["id"], "filename": j["filename"], "created_at": j["created_at"],
            "fields": _load(j["fields_json"]), "results": _load(j["results_json"])}


@app.delete("/api/doc/jobs/{job_id}")
def doc_job_delete(job_id: int, user: dict = Depends(current_user)):
    if not db.delete_doc_job(user["id"], job_id):
        raise HTTPException(404, "记录不存在")
    return {"ok": True}


@app.get("/api/doc/export")
def doc_export(ids: str, user: dict = Depends(current_user)):
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    jobs = []
    for i in id_list:
        j = db.get_doc_job(user["id"], i)
        if j:
            jobs.append({"filename": j["filename"], "results": _load(j["results_json"]) or []})
    if not jobs:
        raise HTTPException(400, "没有可用记录")
    headers, rows = docextract.build_matrix(jobs)
    data = P.build_matrix_excel(headers, rows)
    return _xlsx_response(data, "doc_matrix.xlsx")


# ---------------- 异步任务队列 ----------------
class CancelledError(Exception):
    pass


def _process_task(t: dict) -> dict:
    tid = t["id"]
    db.set_task_progress(tid, 15)
    if db.is_cancel_requested(tid):
        raise CancelledError()
    fields = json.loads(t["fields_json"]) if t.get("fields_json") else []
    filename = t.get("filename") or ""
    content = t.get("content") or b""
    if docextract.is_image(filename):
        text = OL.ocr_image(content)
    else:
        text = docextract.extract_text(
            filename, content,
            progress_cb=lambda i, n: db.set_task_progress(tid, 15 + int(40 * i / max(1, n))),
        )
    text = (text or "").strip()
    db.set_task_progress(tid, 65)
    if db.is_cancel_requested(tid):
        raise CancelledError()
    if not text:
        raise ValueError("内容为空")

    file_id = content_hash = None
    size = 0
    if content:
        content_hash = hashlib.sha256(content).hexdigest()
        size = len(content)
        file_id, _ = db.save_file(t["user_id"], content_hash, filename, size, content)

    if fields:
        res, via = OL.extract_fields(text, fields)
        if not res:
            res, via = docextract.fallback_fields(text, fields), "rule"
    else:
        res, via = docextract.rule_extract(text), "rule"
    db.set_task_progress(tid, 90)
    job_id = db.save_doc_job(t["user_id"], filename, fields, res, text[:500], file_id, content_hash, size)
    return {"job_id": job_id, "results": res, "via": via, "char_count": len(text), "file_id": file_id}


def _worker_loop():
    while True:
        t = db.claim_next_task()
        if not t:
            time.sleep(0.7)
            continue
        try:
            db.set_task_status(t["id"], "done",
                               json.dumps(_process_task(t), ensure_ascii=False), progress=100)
        except CancelledError:
            db.set_task_status(t["id"], "canceled", error="已取消", progress=0)
        except Exception as e:  # noqa: BLE001
            attempts = int(t.get("attempts") or 0)
            max_attempts = int(t.get("max_attempts") or 3)
            if attempts + 1 < max_attempts:
                db.set_task_status(t["id"], "pending", error=str(e))
                time.sleep(0.5)
            else:
                db.set_task_status(t["id"], "failed", error=str(e))


WORKERS = max(1, int(os.getenv("DOC_WORKERS", "2")))
for _ in range(WORKERS):
    threading.Thread(target=_worker_loop, daemon=True).start()


@app.post("/api/doc/enqueue")
async def doc_enqueue(files: list[UploadFile] = File(...), fields: str = Form(""),
                      priority: int = Form(0), user: dict = Depends(current_user)):
    field_list = [f.strip() for f in re.split(r"[，,、\s]+", fields) if f.strip()]
    ids = []
    for f in files:
        content = await f.read()
        if content:
            ids.append(db.create_task(user["id"], f.filename, field_list, content, priority))
    if not ids:
        raise HTTPException(400, "没有有效文件")
    return {"task_ids": ids}


@app.get("/api/doc/tasks")
def doc_tasks(user: dict = Depends(current_user)):
    return {"tasks": db.list_tasks(user["id"])}


@app.get("/api/doc/tasks/{task_id}")
def doc_task_detail(task_id: int, user: dict = Depends(current_user)):
    t = db.get_task(user["id"], task_id)
    if not t:
        raise HTTPException(404, "任务不存在")
    return {"id": t["id"], "filename": t["filename"], "status": t["status"], "error": t["error"],
            "progress": t["progress"], "attempts": t["attempts"], "max_attempts": t["max_attempts"],
            "priority": t["priority"], "result": _load(t["result_json"])}


@app.delete("/api/doc/tasks/{task_id}")
def doc_task_delete(task_id: int, user: dict = Depends(current_user)):
    if not db.delete_task(user["id"], task_id):
        raise HTTPException(404, "任务不存在")
    return {"ok": True}


@app.post("/api/doc/tasks/{task_id}/retry")
def doc_task_retry(task_id: int, user: dict = Depends(current_user)):
    if not db.retry_task(user["id"], task_id):
        raise HTTPException(400, "无法重试（任务不存在或正在处理中）")
    return {"ok": True}


@app.post("/api/doc/tasks/{task_id}/cancel")
def doc_task_cancel(task_id: int, user: dict = Depends(current_user)):
    status = db.cancel_task(user["id"], task_id)
    if status is None:
        raise HTTPException(404, "任务不存在")
    return {"ok": True, "status": status}


@app.get("/api/doc/files/stats")
def doc_file_stats(user: dict = Depends(current_user)):
    return db.file_stats(user["id"])


@app.get("/api/doc/files/{file_id}/download")
def doc_file_download(file_id: int, user: dict = Depends(current_user)):
    f = db.get_file(user["id"], file_id)
    if not f:
        raise HTTPException(404, "文件不存在")
    fn = f.get("filename") or f"file-{file_id}"
    return StreamingResponse(iter([f.get("content") or b""]),
                             media_type="application/octet-stream",
                             headers={"Content-Disposition": f'attachment; filename="{fn}"'})


# 静态前端（放最后挂载）
if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
