"""SQLite 数据层。

设计取舍：单机 2C2G 的演示型 SaaS 用 SQLite + WAL 最稳、最省内存；
所有 SQL 都集中在这里和路由层，后续换 PostgreSQL 只需要替换连接与少量语法。
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  pw_hash       TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL DEFAULT 'free',
  owner_id   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   TEXT NOT NULL,
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL,
  workspace_id INTEGER,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS usage_events(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  module       TEXT NOT NULL,
  action       TEXT NOT NULL,
  units        INTEGER NOT NULL DEFAULT 1,
  meta_json    TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER,
  user_id      INTEGER,
  action       TEXT NOT NULL,
  target       TEXT,
  detail_json  TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  token        TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  accepted_at  TEXT
);

CREATE TABLE IF NOT EXISTS excel_jobs(
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         INTEGER NOT NULL,
  user_id              INTEGER NOT NULL,
  filename             TEXT,
  original             INTEGER,
  cleaned              INTEGER,
  removed_empty        INTEGER,
  removed_dup          INTEGER,
  headers_json         TEXT,
  rows_json            TEXT,
  summary_headers_json TEXT,
  summary_rows_json    TEXT,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_files(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  filename     TEXT,
  size         INTEGER,
  content      BLOB,
  created_at   TEXT NOT NULL,
  UNIQUE(workspace_id, sha256)
);

CREATE TABLE IF NOT EXISTS doc_jobs(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  filename       TEXT,
  fields_json    TEXT,
  results_json   TEXT,
  text_snippet   TEXT,
  file_id        INTEGER,
  content_hash   TEXT,
  size           INTEGER,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_tasks(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  filename        TEXT,
  fields_json     TEXT,
  content         BLOB,
  status          TEXT NOT NULL DEFAULT 'pending',
  result_json     TEXT,
  error           TEXT,
  progress        INTEGER NOT NULL DEFAULT 0,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  priority        INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  customer      TEXT,
  currency      TEXT NOT NULL DEFAULT 'CNY',
  tax_rate      REAL NOT NULL DEFAULT 6,
  discount_rate REAL NOT NULL DEFAULT 0,
  note          TEXT,
  items_json    TEXT NOT NULL,
  subtotal      REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax           REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  filename     TEXT,
  headers_json TEXT NOT NULL,
  rows_json    TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_jobs(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  dataset_id   INTEGER NOT NULL,
  filename     TEXT,
  config_json  TEXT,
  result_json  TEXT,
  insight      TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  plan         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'CNY',
  status       TEXT NOT NULL DEFAULT 'paid',
  period_start TEXT,
  period_end   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_logs(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER,
  user_id      INTEGER,
  module       TEXT,
  provider     TEXT,
  ok           INTEGER NOT NULL DEFAULT 1,
  latency_ms   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_ws_time ON usage_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_ws_time ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_excel_ws_time ON excel_jobs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_doc_ws_time ON doc_jobs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_doc_tasks_ws ON doc_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_ws_time ON quotes(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_datasets_ws ON datasets(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_ws ON invoices(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def month_prefix() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


@contextmanager
def connect():
    config.ensure_dirs()
    conn = sqlite3.connect(str(config.DB_PATH), timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    config.ensure_dirs()
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.executescript(SCHEMA)
        _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    """轻量迁移：给旧库补列，避免升级时手工改表。"""
    wanted = {
        "users": [("is_active", "INTEGER NOT NULL DEFAULT 1"), ("is_admin", "INTEGER NOT NULL DEFAULT 0")],
        "doc_tasks": [("max_attempts", "INTEGER NOT NULL DEFAULT 3"),
                      ("cancel_requested", "INTEGER NOT NULL DEFAULT 0")],
        "quotes": [("status", "TEXT NOT NULL DEFAULT 'draft'")],
    }
    for table, cols in wanted.items():
        for col, ddl in cols:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass


# ---------------- 通用查询 ----------------
def fetchone(sql: str, params: Iterable[Any] = ()) -> dict | None:
    with connect() as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
        return dict(row) if row else None


def fetchall(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    with connect() as conn:
        cur = conn.execute(sql, tuple(params))
        return int(cur.rowcount)


def insert(sql: str, params: Iterable[Any] = ()) -> int:
    with connect() as conn:
        cur = conn.execute(sql, tuple(params))
        return int(cur.lastrowid)


def scalar(sql: str, params: Iterable[Any] = (), default: Any = 0) -> Any:
    row = fetchone(sql, params)
    if not row:
        return default
    value = next(iter(row.values()))
    return default if value is None else value


def json_load(value: str | None, default=None):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def json_dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
