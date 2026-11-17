"""SQLite 持久化层：用户与处理任务(job)历史。仅用标准库 sqlite3。"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.db"))


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS users(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                pw_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS jobs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT,
                original INTEGER,
                cleaned INTEGER,
                removed_empty INTEGER,
                removed_dup INTEGER,
                headers_json TEXT,
                rows_json TEXT,
                summary_headers_json TEXT,
                summary_rows_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS doc_jobs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT,
                fields_json TEXT,
                results_json TEXT,
                text_snippet TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                filename TEXT,
                fields_json TEXT,
                content BLOB,
                status TEXT NOT NULL DEFAULT 'pending',
                result_json TEXT,
                error TEXT,
                progress INTEGER NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                priority INTEGER NOT NULL DEFAULT 0,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS doc_files(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                filename TEXT,
                size INTEGER,
                content BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, sha256)
            )"""
        )
        for col, ddl in (("progress", "INTEGER NOT NULL DEFAULT 0"),
                         ("attempts", "INTEGER NOT NULL DEFAULT 0"),
                         ("max_attempts", "INTEGER NOT NULL DEFAULT 3"),
                         ("priority", "INTEGER NOT NULL DEFAULT 0"),
                         ("cancel_requested", "INTEGER NOT NULL DEFAULT 0")):
            try:
                c.execute(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass
        for col, ddl in (("file_id", "INTEGER"), ("content_hash", "TEXT"), ("size", "INTEGER")):
            try:
                c.execute(f"ALTER TABLE doc_jobs ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass


# ---------- 密码 ----------
def hash_pw(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 60000).hex()
    return f"{salt}${digest}"


def verify_pw(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(password, salt), stored)


# ---------- 用户 ----------
def ensure_user(username: str, password: str) -> int:
    with _conn() as c:
        row = c.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if row:
            return int(row["id"])
        cur = c.execute("INSERT INTO users(username, pw_hash) VALUES(?,?)", (username, hash_pw(password)))
        return int(cur.lastrowid)


def get_user(username: str):
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None


# ---------- 任务历史 ----------
def save_job(user_id: int, filename: str, stats: dict, headers, rows,
             summary_headers=None, summary_rows=None) -> int:
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO jobs(user_id, filename, original, cleaned, removed_empty, removed_dup,
                headers_json, rows_json, summary_headers_json, summary_rows_json)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                user_id, filename, stats.get("original"), stats.get("cleaned"),
                stats.get("removed_empty"), stats.get("removed_dup"),
                json.dumps(headers, ensure_ascii=False),
                json.dumps(rows, ensure_ascii=False),
                json.dumps(summary_headers, ensure_ascii=False) if summary_headers else None,
                json.dumps(summary_rows, ensure_ascii=False) if summary_rows else None,
            ),
        )
        return int(cur.lastrowid)


def list_jobs(user_id: int, q: str = "", limit: int = 20, offset: int = 0):
    where = "user_id=?"
    params: list = [user_id]
    if q:
        where += " AND filename LIKE ?"
        params.append(f"%{q}%")
    with _conn() as c:
        total = c.execute(f"SELECT COUNT(*) n FROM jobs WHERE {where}", params).fetchone()["n"]
        rows = c.execute(
            f"""SELECT id, filename, original, cleaned, removed_empty, removed_dup, created_at
                FROM jobs WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows], int(total)


def get_job(user_id: int, job_id: int):
    with _conn() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=? AND user_id=?", (job_id, user_id)).fetchone()
        return dict(row) if row else None


def delete_job(user_id: int, job_id: int) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM jobs WHERE id=? AND user_id=?", (job_id, user_id))
        return cur.rowcount > 0


# ---------- 文档提取历史 ----------
def save_file(user_id: int, sha256: str, filename: str, size: int, content: bytes):
    """保存原始文件并去重（同一用户相同内容只存一份）。返回 (file_id, is_new)。"""
    with _conn() as c:
        row = c.execute("SELECT id FROM doc_files WHERE user_id=? AND sha256=?", (user_id, sha256)).fetchone()
        if row:
            return int(row["id"]), False
        cur = c.execute(
            "INSERT INTO doc_files(user_id, sha256, filename, size, content) VALUES(?,?,?,?,?)",
            (user_id, sha256, filename, size, sqlite3.Binary(content)),
        )
        return int(cur.lastrowid), True


def get_file(user_id: int, file_id: int):
    with _conn() as c:
        row = c.execute("SELECT * FROM doc_files WHERE id=? AND user_id=?", (file_id, user_id)).fetchone()
        return dict(row) if row else None


def file_stats(user_id: int):
    with _conn() as c:
        row = c.execute("SELECT COUNT(*) n, COALESCE(SUM(size),0) s FROM doc_files WHERE user_id=?", (user_id,)).fetchone()
        return {"files": int(row["n"]), "bytes": int(row["s"])}


def save_doc_job(user_id: int, filename: str, fields, results, text_snippet: str,
                 file_id=None, content_hash=None, size=0) -> int:
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO doc_jobs(user_id, filename, fields_json, results_json, text_snippet,
                                    file_id, content_hash, size)
               VALUES(?,?,?,?,?,?,?,?)""",
            (user_id, filename, json.dumps(fields, ensure_ascii=False),
             json.dumps(results, ensure_ascii=False), (text_snippet or "")[:500],
             file_id, content_hash, size),
        )
        return int(cur.lastrowid)


def list_doc_jobs(user_id: int, q: str = "", limit: int = 20, offset: int = 0):
    where = "user_id=?"
    params: list = [user_id]
    if q:
        where += " AND (filename LIKE ? OR text_snippet LIKE ?)"
        like = f"%{q}%"
        params += [like, like]
    with _conn() as c:
        total = c.execute(f"SELECT COUNT(*) n FROM doc_jobs WHERE {where}", params).fetchone()["n"]
        rows = c.execute(
            f"""SELECT id, filename, fields_json, created_at, file_id, content_hash, size FROM doc_jobs
                WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
        return [dict(r) for r in rows], int(total)


def get_doc_job(user_id: int, job_id: int):
    with _conn() as c:
        row = c.execute("SELECT * FROM doc_jobs WHERE id=? AND user_id=?", (job_id, user_id)).fetchone()
        return dict(row) if row else None


def delete_doc_job(user_id: int, job_id: int) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM doc_jobs WHERE id=? AND user_id=?", (job_id, user_id))
        return cur.rowcount > 0


# ---------- 异步任务队列 ----------
def create_task(user_id: int, filename: str, fields, content: bytes, priority: int = 0) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO tasks(user_id, filename, fields_json, content, priority) VALUES(?,?,?,?,?)",
            (user_id, filename, json.dumps(fields, ensure_ascii=False), sqlite3.Binary(content), priority),
        )
        return int(cur.lastrowid)


def next_pending_task():
    return claim_next_task()


def claim_next_task():
    """原子领取一个待处理任务（跨线程安全），并把 attempts+1。"""
    c = sqlite3.connect(DB_PATH, isolation_level=None, timeout=15)
    c.row_factory = sqlite3.Row
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM tasks WHERE status='pending' ORDER BY priority DESC, id LIMIT 1").fetchone()
        if not row:
            c.execute("COMMIT")
            return None
        c.execute(
            "UPDATE tasks SET status='processing', attempts=attempts+1, progress=5, updated_at=datetime('now') WHERE id=?",
            (row["id"],),
        )
        c.execute("COMMIT")
        return dict(row)
    except Exception:  # noqa: BLE001
        try:
            c.execute("ROLLBACK")
        except Exception:  # noqa: BLE001
            pass
        return None
    finally:
        c.close()


def set_task_status(task_id: int, status: str, result: str | None = None,
                    error: str | None = None, progress: int | None = None) -> None:
    sets = ["status=?", "result_json=?", "error=?", "updated_at=datetime('now')"]
    params: list = [status, result, error]
    if progress is not None:
        sets.append("progress=?")
        params.append(progress)
    params.append(task_id)
    with _conn() as c:
        c.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", params)


def set_task_progress(task_id: int, progress: int) -> None:
    with _conn() as c:
        c.execute("UPDATE tasks SET progress=?, updated_at=datetime('now') WHERE id=?", (progress, task_id))


def retry_task(user_id: int, task_id: int) -> bool:
    with _conn() as c:
        cur = c.execute(
            "UPDATE tasks SET status='pending', attempts=0, progress=0, error=NULL, cancel_requested=0, updated_at=datetime('now') WHERE id=? AND user_id=? AND status!='processing'",
            (task_id, user_id),
        )
        return cur.rowcount > 0


def cancel_task(user_id: int, task_id: int) -> str | None:
    """取消任务：排队中直接取消；处理中标记取消请求。返回状态或 None。"""
    with _conn() as c:
        row = c.execute("SELECT status FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not row:
            return None
        if row["status"] == "pending":
            c.execute("UPDATE tasks SET status='canceled', updated_at=datetime('now') WHERE id=?", (task_id,))
            return "canceled"
        if row["status"] == "processing":
            c.execute("UPDATE tasks SET cancel_requested=1, updated_at=datetime('now') WHERE id=?", (task_id,))
            return "canceling"
        return row["status"]


def is_cancel_requested(task_id: int) -> bool:
    with _conn() as c:
        row = c.execute("SELECT cancel_requested FROM tasks WHERE id=?", (task_id,)).fetchone()
        return bool(row and row["cancel_requested"])


def list_tasks(user_id: int, limit: int = 100):
    with _conn() as c:
        rows = c.execute(
            """SELECT id, filename, status, error, progress, attempts, max_attempts, priority,
                      cancel_requested, created_at, updated_at
               FROM tasks WHERE user_id=? ORDER BY id DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_task(user_id: int, task_id: int):
    with _conn() as c:
        row = c.execute(
            """SELECT id, user_id, filename, status, result_json, error, progress, attempts, max_attempts,
                      priority, cancel_requested, created_at, updated_at
               FROM tasks WHERE id=? AND user_id=?""",
            (task_id, user_id),
        ).fetchone()
        return dict(row) if row else None


def delete_task(user_id: int, task_id: int) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))
        return cur.rowcount > 0
