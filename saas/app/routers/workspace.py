"""工作区、成员、邀请、审计日志。"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import audit, config, database as db, quota
from ..security import Auth, get_auth, require_workspace_admin

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class RenameReq(BaseModel):
    name: str


class InviteReq(BaseModel):
    email: str
    role: str = "member"


class AcceptReq(BaseModel):
    token: str


def _ip(request: Request) -> str:
    return (request.client.host if request.client else "") or ""


@router.get("")
def workspace(auth: Auth = Depends(get_auth)):
    return {
        "id": auth.workspace["id"],
        "name": auth.workspace["name"],
        "slug": auth.workspace["slug"],
        "plan": auth.plan,
        "role": auth.role,
        "created_at": auth.workspace["created_at"],
        "usage": quota.summary(auth.workspace_id, auth.workspace["plan"]),
        "members": quota.members_count(auth.workspace_id),
    }


@router.patch("")
def rename(req: RenameReq, request: Request, auth: Auth = Depends(require_workspace_admin)):
    name = req.name.strip()
    if not (2 <= len(name) <= 40):
        raise HTTPException(400, "工作区名称需为 2-40 个字符")
    db.execute("UPDATE workspaces SET name=? WHERE id=?", (name, auth.workspace_id))
    audit.log(auth.workspace_id, auth.user_id, "workspace.rename", name, None, _ip(request))
    return {"ok": True, "name": name}


@router.get("/members")
def members(auth: Auth = Depends(get_auth)):
    rows = db.fetchall(
        """SELECT u.id, u.email, u.name, u.is_active, m.role, m.created_at,
                  u.last_login_at
           FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.id""",
        (auth.workspace_id,),
    )
    return {"members": rows, "limit": auth.plan["members"], "role": auth.role}


@router.post("/invites")
def create_invite(req: InviteReq, request: Request, auth: Auth = Depends(require_workspace_admin)):
    email = req.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "邮箱格式不正确")
    if req.role not in ("admin", "member"):
        raise HTTPException(400, "角色只能是 admin 或 member")
    quota.check_member_limit(auth.workspace_id, auth.workspace["plan"])
    existing = db.fetchone(
        """SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
           WHERE m.workspace_id=? AND u.email=?""",
        (auth.workspace_id, email),
    )
    if existing:
        raise HTTPException(409, "该用户已在工作区中")

    token = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    db.insert(
        """INSERT INTO invites(workspace_id, email, role, token, expires_at, created_at)
           VALUES(?,?,?,?,?,?)""",
        (auth.workspace_id, email, req.role, token, expires, db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "member.invite", email, {"role": req.role}, _ip(request))
    return {
        "ok": True, "token": token, "email": email, "role": req.role,
        "link": f"{config.APP_URL}/login?invite={token}",
        "expires_at": expires,
    }


@router.post("/invites/accept")
def accept_invite(req: AcceptReq, request: Request, auth: Auth = Depends(get_auth)):
    invite = db.fetchone("SELECT * FROM invites WHERE token=?", (req.token.strip(),))
    if not invite or invite["accepted_at"]:
        raise HTTPException(400, "邀请链接无效或已被使用")
    if invite["expires_at"] < db.now():
        raise HTTPException(400, "邀请链接已过期")
    if invite["email"] != auth.user["email"].lower():
        raise HTTPException(403, "该邀请不属于当前登录邮箱")
    if db.fetchone("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?",
                   (invite["workspace_id"], auth.user_id)):
        return {"ok": True, "workspace_id": invite["workspace_id"]}

    db.insert("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?)",
              (invite["workspace_id"], auth.user_id, invite["role"], db.now()))
    db.execute("UPDATE invites SET accepted_at=? WHERE id=?", (db.now(), invite["id"]))
    db.execute("UPDATE sessions SET workspace_id=? WHERE id=?", (invite["workspace_id"], auth.session["id"]))
    audit.log(invite["workspace_id"], auth.user_id, "member.join", auth.user["email"],
              {"role": invite["role"]}, _ip(request))
    return {"ok": True, "workspace_id": invite["workspace_id"]}


@router.delete("/members/{user_id}")
def remove_member(user_id: int, request: Request, auth: Auth = Depends(require_workspace_admin)):
    target = db.fetchone(
        """SELECT u.email, m.role FROM memberships m JOIN users u ON u.id=m.user_id
           WHERE m.workspace_id=? AND m.user_id=?""",
        (auth.workspace_id, user_id),
    )
    if not target:
        raise HTTPException(404, "成员不存在")
    if target["role"] == "owner":
        raise HTTPException(400, "不能移除工作区所有者")
    if user_id == auth.user_id and not auth.is_platform_admin:
        raise HTTPException(400, "不能移除自己，请先转让所有权")
    db.execute("DELETE FROM memberships WHERE workspace_id=? AND user_id=?", (auth.workspace_id, user_id))
    audit.log(auth.workspace_id, auth.user_id, "member.remove", target["email"], None, _ip(request))
    return {"ok": True}


@router.get("/audit")
def audit_logs(page: int = 1, page_size: int = 20, auth: Auth = Depends(get_auth)):
    if not (auth.is_workspace_admin or auth.is_platform_admin):
        raise HTTPException(403, "需要管理员权限")
    page, page_size = max(1, page), min(100, max(1, page_size))
    total = int(db.scalar("SELECT COUNT(*) FROM audit_logs WHERE workspace_id=?", (auth.workspace_id,)) or 0)
    rows = db.fetchall(
        """SELECT a.id, a.action, a.target, a.detail_json, a.ip, a.created_at,
                  COALESCE(u.name, '系统') AS user_name, u.email
           FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
           WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT ? OFFSET ?""",
        (auth.workspace_id, page_size, (page - 1) * page_size),
    )
    for row in rows:
        row["detail"] = db.json_load(row.pop("detail_json", None), {})
    return {"logs": rows, "total": total, "page": page, "page_size": page_size}
