"""文档字段提取：单文件、批量队列、历史、导出。"""
from __future__ import annotations

import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from .. import ai, audit, config, database as db, quota, workers
from ..security import Auth, get_auth
from ..services import docs as D
from ..services import excel as X

router = APIRouter(prefix="/api/docs", tags=["docs"])


def _xlsx(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def _log_ai(auth: Auth, module: str, provider: str, latency: float) -> None:
    db.insert(
        """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
           VALUES(?,?,?,?,1,?,?)""",
        (auth.workspace_id, auth.user_id, module, provider, int(latency * 1000), db.now()),
    )


@router.post("/extract")
async def extract(file: UploadFile | None = File(None), text: str = Form(""),
                  fields: str = Form(""), auth: Auth = Depends(get_auth)):
    content = b""
    filename = "粘贴文本"
    file_id = None
    duplicate = False
    size = 0
    if file is not None and file.filename:
        content = await file.read()
        filename = file.filename
        size = len(content)
        if not content:
            raise HTTPException(400, "空文件")
        if size > config.MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"文件不能超过 {config.MAX_UPLOAD_MB} MB")
        quota.check(auth.workspace_id, auth.workspace["plan"], 1, storage_add=size)

    quota.check(auth.workspace_id, auth.workspace["plan"], 1)

    if content:
        try:
            raw = D.extract_text(filename, content)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"解析失败：{exc}") from exc
    else:
        raw = text or ""
    raw = (raw or "").strip()
    if not raw:
        raise HTTPException(400, "内容为空，请上传文件或粘贴文本")

    field_list = D.fields_to_list(fields)
    started = time.time()
    if field_list:
        results, provider = ai.doc_fields(raw, field_list)
        if not results:
            results, provider = D.fallback_fields(raw, field_list), "rules"
    else:
        results, provider = D.rule_extract(raw), "rules"

    if content:
        file_id, duplicate = workers.save_file(auth.workspace_id, auth.user_id, filename, content)

    job_id = workers.save_doc_job(
        auth.workspace_id, auth.user_id, filename, field_list, results,
        raw[:500], file_id, None, size,
    )
    quota.consume(auth.workspace_id, auth.user_id, "docs", "extract", 1,
                  {"filename": filename, "chars": len(raw)})
    _log_ai(auth, "docs.extract", provider, time.time() - started)
    audit.log(auth.workspace_id, auth.user_id, "docs.extract", filename,
              {"job": job_id, "chars": len(raw)})

    return {
        "job_id": job_id, "filename": filename, "char_count": len(raw),
        "results": results, "via": provider, "via_label": ai.label(provider),
        "file_id": file_id, "duplicate": duplicate,
    }


@router.post("/enqueue")
async def enqueue(files: list[UploadFile] = File(...), fields: str = Form(""),
                  priority: int = Form(0), auth: Auth = Depends(get_auth)):
    if not files:
        raise HTTPException(400, "没有有效文件")
    if len(files) > config.MAX_DOC_FILES:
        raise HTTPException(400, f"一次最多 {config.MAX_DOC_FILES} 个文件")
    payload = []
    total_size = 0
    for f in files:
        content = await f.read()
        if not content:
            continue
        if len(content) > config.MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"{f.filename} 超过 {config.MAX_UPLOAD_MB} MB")
        payload.append((f.filename or "未命名", content))
        total_size += len(content)
    if not payload:
        raise HTTPException(400, "没有有效文件")

    quota.check(auth.workspace_id, auth.workspace["plan"], len(payload), storage_add=total_size)
    field_list = D.fields_to_list(fields)
    ids = []
    for filename, content in payload:
        ids.append(db.insert(
            """INSERT INTO doc_tasks(workspace_id, user_id, filename, fields_json, content, priority,
                   max_attempts, created_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (auth.workspace_id, auth.user_id, filename, db.json_dump(field_list),
             content, max(0, priority), config.DOC_TASK_MAX_ATTEMPTS, db.now(), db.now()),
        ))
    quota.consume(auth.workspace_id, auth.user_id, "docs", "enqueue", len(payload),
                  {"files": len(payload)})
    audit.log(auth.workspace_id, auth.user_id, "docs.enqueue", f"{len(payload)} files",
              {"task_ids": ids})
    return {"task_ids": ids, "accepted": len(ids)}


# ---------------- 历史 ----------------
@router.get("/jobs")
def jobs(q: str = "", page: int = 1, page_size: int = 10, auth: Auth = Depends(get_auth)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    where, params = "workspace_id=?", [auth.workspace_id]
    if q:
        where += " AND (filename LIKE ? OR text_snippet LIKE ?)"
        like = f"%{q}%"
        params += [like, like]
    total = int(db.scalar(f"SELECT COUNT(*) FROM doc_jobs WHERE {where}", params) or 0)
    rows = db.fetchall(
        f"""SELECT id, filename, fields_json, created_at, file_id, content_hash, size
            FROM doc_jobs WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
        params + [page_size, (page - 1) * page_size],
    )
    for row in rows:
        row["fields"] = db.json_load(row.pop("fields_json", None), [])
    return {"jobs": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/jobs/{job_id}")
def job_detail(job_id: int, auth: Auth = Depends(get_auth)):
    job = db.fetchone("SELECT * FROM doc_jobs WHERE id=? AND workspace_id=?", (job_id, auth.workspace_id))
    if not job:
        raise HTTPException(404, "记录不存在")
    return {
        "id": job["id"], "filename": job["filename"], "created_at": job["created_at"],
        "fields": db.json_load(job["fields_json"], []),
        "results": db.json_load(job["results_json"], []),
        "file_id": job["file_id"], "size": job["size"],
    }


@router.delete("/jobs/{job_id}")
def job_delete(job_id: int, auth: Auth = Depends(get_auth)):
    if not db.fetchone("SELECT id FROM doc_jobs WHERE id=? AND workspace_id=?", (job_id, auth.workspace_id)):
        raise HTTPException(404, "记录不存在")
    db.execute("DELETE FROM doc_jobs WHERE id=? AND workspace_id=?", (job_id, auth.workspace_id))
    audit.log(auth.workspace_id, auth.user_id, "docs.delete", f"job:{job_id}")
    return {"ok": True}


@router.get("/export")
def export(ids: str, auth: Auth = Depends(get_auth)):
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    if not id_list:
        raise HTTPException(400, "请先选择文档")
    jobs = []
    for job_id in id_list:
        job = db.fetchone("SELECT * FROM doc_jobs WHERE id=? AND workspace_id=?",
                          (job_id, auth.workspace_id))
        if job:
            jobs.append({"filename": job["filename"],
                         "results": db.json_load(job["results_json"], [])})
    if not jobs:
        raise HTTPException(400, "没有可用记录")
    headers, rows = D.build_matrix(jobs)
    return _xlsx(X.build_matrix_excel(headers, rows), "flowdesk-docs.xlsx")


# ---------------- 队列 ----------------
@router.get("/tasks")
def tasks(auth: Auth = Depends(get_auth)):
    rows = db.fetchall(
        """SELECT id, filename, status, error, progress, attempts, max_attempts, priority,
                  cancel_requested, created_at, updated_at
           FROM doc_tasks WHERE workspace_id=? ORDER BY id DESC LIMIT 60""",
        (auth.workspace_id,),
    )
    counts = {"pending": 0, "processing": 0, "done": 0, "failed": 0, "canceled": 0}
    for row in db.fetchall(
        "SELECT status, COUNT(*) AS n FROM doc_tasks WHERE workspace_id=? GROUP BY status",
        (auth.workspace_id,),
    ):
        counts[row["status"]] = int(row["n"])
    return {"tasks": rows, "counts": counts, "workers": config.DOC_WORKERS}


@router.get("/tasks/{task_id}")
def task_detail(task_id: int, auth: Auth = Depends(get_auth)):
    task = db.fetchone("SELECT * FROM doc_tasks WHERE id=? AND workspace_id=?",
                       (task_id, auth.workspace_id))
    if not task:
        raise HTTPException(404, "任务不存在")
    return {
        "id": task["id"], "filename": task["filename"], "status": task["status"],
        "error": task["error"], "progress": task["progress"], "attempts": task["attempts"],
        "max_attempts": task["max_attempts"], "priority": task["priority"],
        "result": db.json_load(task["result_json"], None),
    }


@router.post("/tasks/{task_id}/retry")
def retry(task_id: int, auth: Auth = Depends(get_auth)):
    changed = db.execute(
        """UPDATE doc_tasks SET status='pending', attempts=0, progress=0, error=NULL,
               cancel_requested=0, updated_at=?
           WHERE id=? AND workspace_id=? AND status NOT IN ('processing')""",
        (db.now(), task_id, auth.workspace_id),
    )
    if not changed:
        raise HTTPException(400, "无法重试（任务不存在或正在处理中）")
    return {"ok": True}


@router.post("/tasks/{task_id}/cancel")
def cancel(task_id: int, auth: Auth = Depends(get_auth)):
    task = db.fetchone("SELECT status FROM doc_tasks WHERE id=? AND workspace_id=?",
                       (task_id, auth.workspace_id))
    if not task:
        raise HTTPException(404, "任务不存在")
    if task["status"] == "pending":
        db.execute("UPDATE doc_tasks SET status='canceled', updated_at=? WHERE id=?", (db.now(), task_id))
        return {"ok": True, "status": "canceled"}
    if task["status"] == "processing":
        db.execute("UPDATE doc_tasks SET cancel_requested=1, updated_at=? WHERE id=?", (db.now(), task_id))
        return {"ok": True, "status": "canceling"}
    return {"ok": True, "status": task["status"]}


@router.delete("/tasks/{task_id}")
def task_delete(task_id: int, auth: Auth = Depends(get_auth)):
    changed = db.execute("DELETE FROM doc_tasks WHERE id=? AND workspace_id=?",
                         (task_id, auth.workspace_id))
    if not changed:
        raise HTTPException(404, "任务不存在")
    return {"ok": True}


# ---------------- 原始文件 ----------------
@router.get("/files/stats")
def file_stats(auth: Auth = Depends(get_auth)):
    row = db.fetchone(
        "SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM doc_files WHERE workspace_id=?",
        (auth.workspace_id,),
    ) or {}
    return {"files": int(row.get("files") or 0), "bytes": int(row.get("bytes") or 0)}


@router.get("/files/{file_id}/download")
def file_download(file_id: int, auth: Auth = Depends(get_auth)):
    row = db.fetchone("SELECT * FROM doc_files WHERE id=? AND workspace_id=?",
                      (file_id, auth.workspace_id))
    if not row:
        raise HTTPException(404, "文件不存在")
    filename = row.get("filename") or f"file-{file_id}"
    return Response(
        content=row.get("content") or b"",
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
