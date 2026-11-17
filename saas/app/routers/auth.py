"""注册、登录、会话、当前用户。"""
from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import ai, audit, config, database as db, quota, security
from ..security import Auth, get_auth

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterReq(BaseModel):
    email: str
    name: str
    password: str
    workspace_name: str = ""


class LoginReq(BaseModel):
    email: str
    password: str


class SwitchReq(BaseModel):
    workspace_id: int


class ProfileReq(BaseModel):
    name: str


class PasswordReq(BaseModel):
    current: str
    new: str


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return (base or f"ws-{secrets.token_hex(3)}")[:40] + "-" + secrets.token_hex(3)


def _ip(request: Request) -> str:
    return (request.client.host if request.client else "") or ""


def me_payload(auth: Auth) -> dict:
    workspaces = db.fetchall(
        """SELECT w.id, w.name, w.slug, w.plan, w.created_at, m.role
           FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
           WHERE m.user_id=? ORDER BY w.id""",
        (auth.user_id,),
    )
    return {
        "user": {
            "id": auth.user["id"], "email": auth.user["email"], "name": auth.user["name"],
            "is_admin": bool(auth.user.get("is_admin")),
        },
        "workspace": {
            "id": auth.workspace["id"], "name": auth.workspace["name"],
            "slug": auth.workspace["slug"], "plan": auth.workspace["plan"],
            "role": auth.role, "created_at": auth.workspace["created_at"],
        },
        "workspaces": workspaces,
        "plan": auth.plan,
        "usage": quota.summary(auth.workspace_id, auth.workspace["plan"]),
        "ai": ai.status(),
    }


@router.post("/register")
def register(req: RegisterReq, request: Request, response: Response):
    email = req.email.strip().lower()
    name = req.name.strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    if not (1 <= len(name) <= 40):
        raise HTTPException(400, "昵称需为 1-40 个字符")
    problem = security.password_problem(req.password)
    if problem:
        raise HTTPException(400, problem)
    if db.fetchone("SELECT id FROM users WHERE email=?", (email,)):
        raise HTTPException(409, "该邮箱已注册，请直接登录")

    try:
        with db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO users(email, name, pw_hash, created_at) VALUES(?,?,?,?)",
                (email, name, security.hash_password(req.password), db.now()),
            )
            user_id = int(cur.lastrowid)
            ws_name = (req.workspace_name or f"{name} 的工作区").strip()[:40] or f"{name} 的工作区"
            cur = conn.execute(
                "INSERT INTO workspaces(name, slug, plan, owner_id, created_at) VALUES(?,?,?,?,?)",
                (ws_name, _slug(ws_name), "free", user_id, db.now()),
            )
            workspace_id = int(cur.lastrowid)
            conn.execute(
                "INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?)",
                (workspace_id, user_id, "owner", db.now()),
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"注册失败：{exc}") from exc

    token = security.create_session(user_id, workspace_id, _ip(request), request.headers.get("user-agent", ""))
    security.set_session_cookie(response, token)
    audit.log(workspace_id, user_id, "user.register", email, {"workspace": ws_name}, _ip(request))

    auth = Auth(
        user={"id": user_id, "email": email, "name": name, "is_active": 1, "is_admin": 0},
        session={"id": 0, "workspace_id": workspace_id},
        workspace={"id": workspace_id, "name": ws_name, "slug": "", "plan": "free",
                   "owner_id": user_id, "created_at": db.now()},
        role="owner",
    )
    return me_payload(auth)


@router.post("/login")
def login(req: LoginReq, request: Request, response: Response):
    ip = _ip(request)
    security.check_login_rate(ip)
    email = req.email.strip().lower()
    user = db.fetchone("SELECT * FROM users WHERE email=?", (email,))
    if not user or not security.verify_password(req.password, user["pw_hash"]):
        security.note_login_failure(ip)
        raise HTTPException(401, "邮箱或密码错误")
    if not user["is_active"]:
        raise HTTPException(403, "账号已被停用，请联系平台管理员")

    workspace = db.fetchone(
        """SELECT w.*, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
           WHERE m.user_id=? ORDER BY w.id LIMIT 1""",
        (user["id"],),
    )
    if not workspace:
        raise HTTPException(403, "账号没有可用工作区")

    db.execute("UPDATE users SET last_login_at=? WHERE id=?", (db.now(), user["id"]))
    token = security.create_session(user["id"], workspace["id"], ip, request.headers.get("user-agent", ""))
    security.set_session_cookie(response, token)
    security.clear_login_failures(ip)
    audit.log(workspace["id"], user["id"], "user.login", email, None, ip)

    auth = Auth(
        user=user, session={"id": 0, "workspace_id": workspace["id"]},
        workspace=workspace, role=workspace["role"],
    )
    return me_payload(auth)


@router.post("/logout")
def logout(request: Request, response: Response):
    token = security.token_from_request(request)
    if token:
        security.revoke_session(token)
    security.clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(auth: Auth = Depends(get_auth)):
    return me_payload(auth)


@router.post("/switch")
def switch(req: SwitchReq, auth: Auth = Depends(get_auth)):
    membership = db.fetchone(
        """SELECT w.*, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
           WHERE m.user_id=? AND m.workspace_id=?""",
        (auth.user_id, req.workspace_id),
    )
    if not membership:
        raise HTTPException(403, "你不是该工作区成员")
    db.execute("UPDATE sessions SET workspace_id=? WHERE id=?", (req.workspace_id, auth.session["id"]))
    auth.workspace = membership
    auth.role = membership["role"]
    auth.session["workspace_id"] = req.workspace_id
    return me_payload(auth)


@router.patch("/profile")
def update_profile(req: ProfileReq, request: Request, auth: Auth = Depends(get_auth)):
    name = req.name.strip()
    if not (1 <= len(name) <= 40):
        raise HTTPException(400, "昵称需为 1-40 个字符")
    db.execute("UPDATE users SET name=? WHERE id=?", (name, auth.user_id))
    audit.log(auth.workspace_id, auth.user_id, "user.profile", name, None, _ip(request))
    return {"ok": True, "name": name}


@router.post("/password")
def change_password(req: PasswordReq, request: Request, auth: Auth = Depends(get_auth)):
    user = db.fetchone("SELECT * FROM users WHERE id=?", (auth.user_id,))
    if not user or not security.verify_password(req.current, user["pw_hash"]):
        raise HTTPException(400, "当前密码不正确")
    problem = security.password_problem(req.new)
    if problem:
        raise HTTPException(400, problem)
    db.execute("UPDATE users SET pw_hash=? WHERE id=?", (security.hash_password(req.new), auth.user_id))
    db.execute("DELETE FROM sessions WHERE user_id=? AND id<>?", (auth.user_id, auth.session["id"]))
    audit.log(auth.workspace_id, auth.user_id, "user.password", "", None, _ip(request))
    return {"ok": True}
