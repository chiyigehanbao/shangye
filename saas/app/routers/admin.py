"""平台管理后台：用户、工作区、用量、审计、健康检查。"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import __version__, ai, audit, config, database as db, quota, workers
from ..security import Auth, require_platform_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])
START_AT = time.time()


class UserPatch(BaseModel):
    is_active: bool


class PlanPatch(BaseModel):
    plan: str


def _db_size() -> int:
    try:
        return config.DB_PATH.stat().st_size
    except OSError:
        return 0


@router.get("/overview")
def overview(auth: Auth = Depends(require_platform_admin)):
    users = int(db.scalar("SELECT COUNT(*) FROM users") or 0)
    active_users = int(db.scalar("SELECT COUNT(*) FROM users WHERE is_active=1") or 0)
    workspaces = int(db.scalar("SELECT COUNT(*) FROM workspaces") or 0)
    plan_rows = db.fetchall("SELECT plan, COUNT(*) AS n FROM workspaces GROUP BY plan")
    plan_counts = {row["plan"]: int(row["n"]) for row in plan_rows}
    mrr = sum(quota.PLANS.get(p, {}).get("price", 0) * n for p, n in plan_counts.items())
    month = db.month_prefix()
    return {
        "users": {"total": users, "active": active_users},
        "workspaces": {"total": workspaces, "plans": plan_counts},
        "mrr": mrr,
        "jobs": {
            "excel": int(db.scalar("SELECT COUNT(*) FROM excel_jobs") or 0),
            "docs": int(db.scalar("SELECT COUNT(*) FROM doc_jobs") or 0),
            "quotes": int(db.scalar("SELECT COUNT(*) FROM quotes") or 0),
            "analytics": int(db.scalar("SELECT COUNT(*) FROM analytics_jobs") or 0),
        },
        "month": {
            "runs": int(db.scalar("SELECT COALESCE(SUM(units),0) FROM usage_events WHERE created_at LIKE ?",
                                  (f"{month}%",)) or 0),
            "ai_calls": int(db.scalar("SELECT COUNT(*) FROM ai_logs WHERE created_at LIKE ?",
                                      (f"{month}%",)) or 0),
        },
        "storage_bytes": int(db.scalar("SELECT COALESCE(SUM(size),0) FROM doc_files") or 0),
        "db_bytes": _db_size(),
        "workers": workers.stats(),
        "ai": ai.status(),
        "uptime_seconds": int(time.time() - START_AT),
        "version": __version__,
    }


@router.get("/users")
def users(q: str = "", page: int = 1, page_size: int = 20,
          auth: Auth = Depends(require_platform_admin)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    where, params = "1=1", []
    if q:
        where += " AND (u.email LIKE ? OR u.name LIKE ?)"
        like = f"%{q}%"
        params += [like, like]
    total = int(db.scalar(f"SELECT COUNT(*) FROM users u WHERE {where}", params) or 0)
    rows = db.fetchall(
        f"""SELECT u.id, u.email, u.name, u.is_active, u.is_admin, u.created_at, u.last_login_at,
                   (SELECT COUNT(*) FROM memberships m WHERE m.user_id=u.id) AS workspaces,
                   (SELECT COALESCE(SUM(e.units),0) FROM usage_events e
                     WHERE e.user_id=u.id AND e.created_at LIKE ?) AS month_units
            FROM users u WHERE {where} ORDER BY u.id DESC LIMIT ? OFFSET ?""",
        [f"{db.month_prefix()}%"] + params + [page_size, (page - 1) * page_size],
    )
    return {"users": rows, "total": total, "page": page, "page_size": page_size}


@router.patch("/users/{user_id}")
def patch_user(user_id: int, req: UserPatch, auth: Auth = Depends(require_platform_admin)):
    user = db.fetchone("SELECT * FROM users WHERE id=?", (user_id,))
    if not user:
        raise HTTPException(404, "用户不存在")
    if user_id == auth.user_id and not req.is_active:
        raise HTTPException(400, "不能停用自己的账号")
    db.execute("UPDATE users SET is_active=? WHERE id=?", (1 if req.is_active else 0, user_id))
    if not req.is_active:
        db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
    audit.log(None, auth.user_id, "admin.user_status", user["email"],
              {"active": req.is_active})
    return {"ok": True}


@router.get("/workspaces")
def workspaces(q: str = "", page: int = 1, page_size: int = 20,
               auth: Auth = Depends(require_platform_admin)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    where, params = "1=1", []
    if q:
        where += " AND (w.name LIKE ? OR w.slug LIKE ?)"
        like = f"%{q}%"
        params += [like, like]
    total = int(db.scalar(f"SELECT COUNT(*) FROM workspaces w WHERE {where}", params) or 0)
    rows = db.fetchall(
        f"""SELECT w.id, w.name, w.slug, w.plan, w.created_at,
                   u.email AS owner_email,
                   (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id=w.id) AS members,
                   (SELECT COALESCE(SUM(e.units),0) FROM usage_events e
                     WHERE e.workspace_id=w.id AND e.created_at LIKE ?) AS month_units,
                   (SELECT COALESCE(SUM(f.size),0) FROM doc_files f
                     WHERE f.workspace_id=w.id) AS storage_bytes
            FROM workspaces w LEFT JOIN users u ON u.id=w.owner_id
            WHERE {where} ORDER BY w.id DESC LIMIT ? OFFSET ?""",
        [f"{db.month_prefix()}%"] + params + [page_size, (page - 1) * page_size],
    )
    return {"workspaces": rows, "total": total, "page": page, "page_size": page_size}


@router.patch("/workspaces/{workspace_id}/plan")
def patch_plan(workspace_id: int, req: PlanPatch, auth: Auth = Depends(require_platform_admin)):
    if req.plan not in quota.PLANS:
        raise HTTPException(400, "套餐不存在")
    workspace = db.fetchone("SELECT * FROM workspaces WHERE id=?", (workspace_id,))
    if not workspace:
        raise HTTPException(404, "工作区不存在")
    db.execute("UPDATE workspaces SET plan=? WHERE id=?", (req.plan, workspace_id))
    audit.log(workspace_id, auth.user_id, "admin.plan", workspace["name"],
              {"from": workspace["plan"], "to": req.plan})
    return {"ok": True}


@router.get("/audit")
def audit_all(page: int = 1, page_size: int = 30, auth: Auth = Depends(require_platform_admin)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    total = int(db.scalar("SELECT COUNT(*) FROM audit_logs") or 0)
    rows = db.fetchall(
        """SELECT a.id, a.action, a.target, a.ip, a.created_at,
                  w.name AS workspace_name, u.email AS user_email
           FROM audit_logs a
           LEFT JOIN workspaces w ON w.id=a.workspace_id
           LEFT JOIN users u ON u.id=a.user_id
           ORDER BY a.id DESC LIMIT ? OFFSET ?""",
        (page_size, (page - 1) * page_size),
    )
    return {"logs": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/health")
def health(auth: Auth = Depends(require_platform_admin)):
    return {
        "ok": True,
        "version": __version__,
        "env": config.ENV,
        "db_bytes": _db_size(),
        "workers": workers.stats(),
        "ai": ai.status(force=True),
        "uptime_seconds": int(time.time() - START_AT),
        "plans": {k: quota.PLANS[k]["runs"] for k in quota.PLAN_ORDER},
    }
