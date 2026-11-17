"""审计日志。"""
from __future__ import annotations

from . import database as db


def log(workspace_id: int | None, user_id: int | None, action: str,
        target: str = "", detail: dict | None = None, ip: str = "") -> None:
    db.insert(
        """INSERT INTO audit_logs(workspace_id, user_id, action, target, detail_json, ip, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (workspace_id, user_id, action, target, db.json_dump(detail) if detail else None, ip, db.now()),
    )
