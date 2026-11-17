"""套餐、配额与用量计量。"""
from __future__ import annotations

from fastapi import HTTPException

from . import database as db

PLANS: dict[str, dict] = {
    "free": {
        "key": "free", "name": "Free", "price": 0, "price_year": 0,
        "runs": 50, "storage_mb": 20, "members": 3,
        "tagline": "个人试用，验证工作流",
        "features": ["全部 4 个自动化模块", "本月 50 次任务", "20 MB 文件存储", "3 个成员席位", "AI 规则兜底"],
    },
    "pro": {
        "key": "pro", "name": "Pro", "price": 99, "price_year": 990,
        "runs": 1000, "storage_mb": 1024, "members": 10,
        "tagline": "自由职业者与小团队",
        "features": ["本月 1000 次任务", "1 GB 文件存储", "10 个成员席位", "云端 AI + 本地模型双通道", "任务历史与批量导出"],
    },
    "team": {
        "key": "team", "name": "Team", "price": 299, "price_year": 2990,
        "runs": 5000, "storage_mb": 10240, "members": 50,
        "tagline": "多成员协作与审计",
        "features": ["本月 5000 次任务", "10 GB 文件存储", "50 个成员席位", "完整审计日志", "更高优先级队列"],
    },
}
PLAN_ORDER = ["free", "pro", "team"]


def plan_info(key: str) -> dict:
    return PLANS.get(key, PLANS["free"])


def usage_units(workspace_id: int, month: str | None = None) -> int:
    month = month or db.month_prefix()
    return int(db.scalar(
        "SELECT COALESCE(SUM(units),0) FROM usage_events WHERE workspace_id=? AND created_at LIKE ?",
        (workspace_id, f"{month}%"),
    ) or 0)


def usage_series(workspace_id: int, days: int = 14) -> list[dict]:
    rows = db.fetchall(
        """SELECT substr(created_at,1,10) AS day, COALESCE(SUM(units),0) AS units
           FROM usage_events WHERE workspace_id=? AND created_at >= date('now', ?)
           GROUP BY day ORDER BY day""",
        (workspace_id, f"-{days} days"),
    )
    return [{"day": r["day"], "units": int(r["units"])} for r in rows]


def storage_bytes(workspace_id: int) -> int:
    return int(db.scalar(
        "SELECT COALESCE(SUM(size),0) FROM doc_files WHERE workspace_id=?", (workspace_id,)) or 0)


def members_count(workspace_id: int) -> int:
    return int(db.scalar("SELECT COUNT(*) FROM memberships WHERE workspace_id=?", (workspace_id,)) or 0)


def summary(workspace_id: int, plan_key: str) -> dict:
    plan = plan_info(plan_key)
    used = usage_units(workspace_id)
    storage = storage_bytes(workspace_id)
    members = members_count(workspace_id)
    return {
        "plan": plan,
        "runs": {"used": used, "limit": plan["runs"], "percent": min(100, round(used / max(1, plan["runs"]) * 100))},
        "storage": {"used": storage, "limit": plan["storage_mb"] * 1024 * 1024,
                    "percent": min(100, round(storage / max(1, plan["storage_mb"] * 1024 * 1024) * 100))},
        "members": {"used": members, "limit": plan["members"]},
    }


def check(workspace_id: int, plan_key: str, cost: int = 1, storage_add: int = 0) -> None:
    plan = plan_info(plan_key)
    used = usage_units(workspace_id)
    if used + cost > plan["runs"]:
        raise HTTPException(402, {
            "code": "quota_exceeded",
            "message": f"本月任务次数已用完（{used}/{plan['runs']}），升级套餐后继续。",
            "upgrade": True,
            "usage": used,
            "limit": plan["runs"],
            "plan": plan_key,
        })
    if storage_add > 0:
        limit = plan["storage_mb"] * 1024 * 1024
        used_storage = storage_bytes(workspace_id)
        if used_storage + storage_add > limit:
            raise HTTPException(402, {
                "code": "storage_exceeded",
                "message": f"文件存储空间不足（已用 {used_storage // 1024 // 1024} MB / {plan['storage_mb']} MB）。",
                "upgrade": True,
                "used": used_storage,
                "limit": limit,
                "plan": plan_key,
            })


def check_member_limit(workspace_id: int, plan_key: str) -> None:
    plan = plan_info(plan_key)
    if members_count(workspace_id) >= plan["members"]:
        raise HTTPException(402, {
            "code": "member_limit",
            "message": f"当前套餐最多 {plan['members']} 个成员，升级后可继续邀请。",
            "upgrade": True,
            "plan": plan_key,
        })


def consume(workspace_id: int, user_id: int, module: str, action: str,
            units: int = 1, meta: dict | None = None) -> None:
    db.insert(
        """INSERT INTO usage_events(workspace_id, user_id, module, action, units, meta_json, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (workspace_id, user_id, module, action, units, db.json_dump(meta) if meta else None, db.now()),
    )
