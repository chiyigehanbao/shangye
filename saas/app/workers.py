"""文档解析后台队列。单进程内多线程，任务状态落 SQLite，重启后可继续排队。"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading

from . import ai, config, database as db
from .services import docs as D

_stop = threading.Event()
_threads: list[threading.Thread] = []
_started = False


class CancelledError(Exception):
    pass


# ---------------- 公共存储函数 ----------------
def save_file(workspace_id: int, user_id: int, filename: str, content: bytes) -> tuple[int, bool]:
    digest = hashlib.sha256(content).hexdigest()
    row = db.fetchone("SELECT id FROM doc_files WHERE workspace_id=? AND sha256=?",
                      (workspace_id, digest))
    if row:
        return int(row["id"]), True
    file_id = db.insert(
        """INSERT INTO doc_files(workspace_id, user_id, sha256, filename, size, content, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (workspace_id, user_id, digest, filename, len(content), sqlite3.Binary(content), db.now()),
    )
    return file_id, False


def save_doc_job(workspace_id: int, user_id: int, filename: str, fields: list[str],
                 results: list[dict], snippet: str, file_id=None,
                 content_hash=None, size: int = 0) -> int:
    return db.insert(
        """INSERT INTO doc_jobs(workspace_id, user_id, filename, fields_json, results_json,
               text_snippet, file_id, content_hash, size, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (workspace_id, user_id, filename, db.json_dump(fields), db.json_dump(results),
         (snippet or "")[:500], file_id, content_hash, size, db.now()),
    )


# ---------------- 任务队列 ----------------
def _set(task_id: int, status: str | None = None, progress: int | None = None,
         result: str | None = None, error: str | None = None) -> None:
    sets, params = ["updated_at=?"], [db.now()]
    if status is not None:
        sets.append("status=?"); params.append(status)
    if progress is not None:
        sets.append("progress=?"); params.append(progress)
    if result is not None:
        sets.append("result_json=?"); params.append(result)
    if error is not None:
        sets.append("error=?"); params.append(error)
    params.append(task_id)
    db.execute(f"UPDATE doc_tasks SET {', '.join(sets)} WHERE id=?", params)


def _cancel_requested(task_id: int) -> bool:
    return bool(db.scalar("SELECT cancel_requested FROM doc_tasks WHERE id=?", (task_id,), 0))


def claim_next() -> dict | None:
    with db.connect() as conn:
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM doc_tasks WHERE status='pending' ORDER BY priority DESC, id LIMIT 1"
            ).fetchone()
            if not row:
                return None
            conn.execute(
                """UPDATE doc_tasks SET status='processing', attempts=attempts+1,
                       progress=5, updated_at=? WHERE id=?""",
                (db.now(), row["id"]),
            )
            return dict(row)
        except sqlite3.OperationalError:
            return None


def process_task(task: dict) -> dict:
    task_id = int(task["id"])
    if _cancel_requested(task_id):
        raise CancelledError()
    fields = db.json_load(task.get("fields_json"), []) or []
    filename = task.get("filename") or ""
    content = task.get("content") or b""
    _set(task_id, progress=12)

    text = D.extract_text(
        filename, content,
        progress_cb=lambda i, n: _set(task_id, progress=12 + int(45 * i / max(1, n))),
    )
    if _cancel_requested(task_id):
        raise CancelledError()
    text = (text or "").strip()
    if not text:
        raise ValueError("文档内容为空")
    _set(task_id, progress=62)

    file_id, content_hash, size = None, None, 0
    if content:
        content_hash = hashlib.sha256(content).hexdigest()
        size = len(content)
        file_id, _ = save_file(int(task["workspace_id"]), int(task["user_id"]), filename, content)

    if fields:
        results, provider = ai.doc_fields(text, fields)
        if not results:
            results, provider = D.fallback_fields(text, fields), "rules"
    else:
        results, provider = D.rule_extract(text), "rules"
    _set(task_id, progress=90)

    job_id = save_doc_job(
        int(task["workspace_id"]), int(task["user_id"]), filename, fields, results,
        text[:500], file_id, content_hash, size,
    )
    db.insert(
        """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
           VALUES(?,?,?,?,1,?,?)""",
        (task["workspace_id"], task["user_id"], "doc.task", provider, 0, db.now()),
    )
    return {"job_id": job_id, "results": results, "via": provider,
            "char_count": len(text), "file_id": file_id}


def _loop() -> None:
    while not _stop.is_set():
        task = claim_next()
        if not task:
            _stop.wait(0.8)
            continue
        task_id = int(task["id"])
        attempts = int(task.get("attempts") or 0) + 1
        max_attempts = int(task.get("max_attempts") or config.DOC_TASK_MAX_ATTEMPTS)
        try:
            result = process_task(task)
            _set(task_id, status="done", progress=100, result=db.json_dump(result), error="")
        except CancelledError:
            _set(task_id, status="canceled", progress=0, error="已取消")
        except Exception as exc:  # noqa: BLE001
            if attempts < max_attempts:
                _set(task_id, status="pending", progress=0, error=str(exc)[:300])
                _stop.wait(0.6)
            else:
                _set(task_id, status="failed", progress=0, error=str(exc)[:300])


def _recover_stale() -> None:
    """服务重启后回收上次进程遗留的 processing 任务，避免任务永久卡住。"""
    db.execute(
        """UPDATE doc_tasks SET status='canceled', progress=0, error='服务重启，任务已取消',
               updated_at=? WHERE status='processing' AND cancel_requested=1""",
        (db.now(),),
    )
    db.execute(
        """UPDATE doc_tasks SET status='failed', progress=0,
               error=COALESCE(error, '服务重启且已达到最大重试次数'), updated_at=?
           WHERE status='processing' AND attempts >= max_attempts""",
        (db.now(),),
    )
    db.execute(
        """UPDATE doc_tasks SET status='pending', progress=0, error='服务重启，自动重新排队',
               updated_at=? WHERE status='processing'""",
        (db.now(),),
    )


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    _stop.clear()
    _recover_stale()
    for i in range(config.DOC_WORKERS):
        thread = threading.Thread(target=_loop, name=f"doc-worker-{i + 1}", daemon=True)
        thread.start()
        _threads.append(thread)


def stop() -> None:
    _stop.set()
    for thread in _threads:
        thread.join(timeout=3)
    _threads.clear()
    global _started
    _started = False


def stats() -> dict:
    row = db.fetchone(
        """SELECT
             SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) AS processing,
             SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
             SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
             COUNT(*) AS total
           FROM doc_tasks"""
    ) or {}
    return {k: int(v or 0) for k, v in row.items()}
