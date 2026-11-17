"""计费：套餐、订阅（沙箱）、发票、用量。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import audit, database as db, quota
from ..security import Auth, get_auth, require_workspace_admin

router = APIRouter(prefix="/api/billing", tags=["billing"])


class SubscribeReq(BaseModel):
    plan: str
    cycle: str = "monthly"


def _invoices(workspace_id: int, limit: int = 12) -> list[dict]:
    return db.fetchall(
        """SELECT id, plan, amount_cents, currency, status, period_start, period_end, created_at
           FROM invoices WHERE workspace_id=? ORDER BY id DESC LIMIT ?""",
        (workspace_id, limit),
    )


def _summary(auth: Auth) -> dict:
    return {
        "sandbox": True,
        "plan": auth.plan,
        "usage": quota.summary(auth.workspace_id, auth.workspace["plan"]),
        "invoices": _invoices(auth.workspace_id),
        "plans": [quota.PLANS[k] for k in quota.PLAN_ORDER],
    }


@router.get("/plans")
def plans():
    return {"plans": [quota.PLANS[k] for k in quota.PLAN_ORDER], "sandbox": True}


@router.get("/summary")
def summary(auth: Auth = Depends(get_auth)):
    return _summary(auth)


@router.get("/invoices")
def invoices(auth: Auth = Depends(get_auth)):
    return {"invoices": _invoices(auth.workspace_id, 50)}


@router.post("/subscribe")
def subscribe(req: SubscribeReq, auth: Auth = Depends(require_workspace_admin)):
    if req.plan not in ("pro", "team"):
        raise HTTPException(400, "请选择 Pro 或 Team 套餐")
    if req.cycle not in ("monthly", "yearly"):
        raise HTTPException(400, "计费周期只能是 monthly 或 yearly")
    if auth.role != "owner" and not auth.is_platform_admin:
        raise HTTPException(403, "只有工作区所有者可以变更套餐")

    plan = quota.PLANS[req.plan]
    amount = plan["price_year"] if req.cycle == "yearly" else plan["price"]
    now = datetime.now(timezone.utc)
    days = 365 if req.cycle == "yearly" else 30
    period_end = (now + timedelta(days=days)).strftime("%Y-%m-%d")

    db.execute("UPDATE workspaces SET plan=? WHERE id=?", (req.plan, auth.workspace_id))
    db.insert(
        """INSERT INTO invoices(workspace_id, plan, amount_cents, currency, status,
               period_start, period_end, created_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        (auth.workspace_id, req.plan, int(amount * 100), "CNY", "paid",
         now.strftime("%Y-%m-%d"), period_end, db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "billing.subscribe", req.plan,
              {"cycle": req.cycle, "amount": amount, "sandbox": True})

    auth.workspace["plan"] = req.plan
    auth.role = auth.role
    return {"ok": True, "sandbox": True, "plan": plan, "amount": amount, "cycle": req.cycle, **_summary(auth)}


@router.post("/cancel")
def cancel(auth: Auth = Depends(require_workspace_admin)):
    if auth.role != "owner" and not auth.is_platform_admin:
        raise HTTPException(403, "只有工作区所有者可以取消订阅")
    db.execute("UPDATE workspaces SET plan='free' WHERE id=?", (auth.workspace_id,))
    audit.log(auth.workspace_id, auth.user_id, "billing.cancel", "free", {"sandbox": True})
    auth.workspace["plan"] = "free"
    return {"ok": True, "sandbox": True, **_summary(auth)}
