"""工作台概览。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import ai, database as db, quota
from ..security import Auth, get_auth

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _count(table: str, workspace_id: int) -> int:
    return int(db.scalar(f"SELECT COUNT(*) FROM {table} WHERE workspace_id=?", (workspace_id,)) or 0)


def _recent(workspace_id: int) -> list[dict]:
    items: list[dict] = []
    for row in db.fetchall(
        """SELECT id, filename, original, cleaned, created_at FROM excel_jobs
           WHERE workspace_id=? ORDER BY id DESC LIMIT 4""", (workspace_id,)):
        items.append({"type": "excel", "id": row["id"], "title": row["filename"],
                      "meta": f"清洗 {row['original']} → {row['cleaned']} 行", "created_at": row["created_at"]})
    for row in db.fetchall(
        """SELECT id, filename, size, created_at FROM doc_jobs
           WHERE workspace_id=? ORDER BY id DESC LIMIT 4""", (workspace_id,)):
        items.append({"type": "doc", "id": row["id"], "title": row["filename"],
                      "meta": f"提取完成 · {(row['size'] or 0) / 1024:.0f} KB", "created_at": row["created_at"]})
    for row in db.fetchall(
        """SELECT id, title, customer, total, currency, created_at FROM quotes
           WHERE workspace_id=? ORDER BY id DESC LIMIT 4""", (workspace_id,)):
        items.append({"type": "quote", "id": row["id"], "title": row["title"],
                      "meta": f"{row['customer'] or '未填客户'} · {row['currency']} {row['total']:,.2f}",
                      "created_at": row["created_at"]})
    for row in db.fetchall(
        """SELECT id, filename, result_json, created_at FROM analytics_jobs
           WHERE workspace_id=? ORDER BY id DESC LIMIT 4""", (workspace_id,)):
        result = db.json_load(row["result_json"], {}) or {}
        total = (result.get("kpis") or {}).get("total", 0)
        items.append({"type": "analytics", "id": row["id"], "title": row["filename"],
                      "meta": f"看板分析 · 销售额 {total:,.0f}", "created_at": row["created_at"]})
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:8]


@router.get("")
def dashboard(auth: Auth = Depends(get_auth)):
    ws = auth.workspace_id
    month = db.month_prefix()
    counts = {
        "excel": _count("excel_jobs", ws),
        "docs": _count("doc_jobs", ws),
        "quotes": _count("quotes", ws),
        "analytics": _count("analytics_jobs", ws),
    }
    month_counts = {
        "runs": quota.usage_units(ws, month),
        "ai_calls": int(db.scalar(
            "SELECT COUNT(*) FROM ai_logs WHERE workspace_id=? AND created_at LIKE ?",
            (ws, f"{month}%")) or 0),
    }
    return {
        "counts": counts,
        "month": month_counts,
        "recent": _recent(ws),
        "usage_series": quota.usage_series(ws, 14),
        "usage": quota.summary(ws, auth.workspace["plan"]),
        "plan": auth.plan,
        "workspace": {"id": ws, "name": auth.workspace["name"], "role": auth.role},
        "ai": ai.status(),
    }
