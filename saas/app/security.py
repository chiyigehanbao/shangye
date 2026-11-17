"""认证、会话与权限。"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response

from . import config
from . import database as db
from .quota import PLANS

PBKDF2_ITERATIONS = 210_000
_ATTEMPTS: dict[str, list[float]] = {}
_ATTEMPTS_LOCK = threading.Lock()


# ---------------- 密码 ----------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$", 3)
        if algo != "pbkdf2":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations)).hex()
        return hmac.compare_digest(calc, digest)
    except (ValueError, TypeError):
        # 兼容旧格式 salt$digest
        try:
            salt, digest = stored.split("$", 1)
            calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 60_000).hex()
            return hmac.compare_digest(calc, digest)
        except (ValueError, TypeError):
            return False


def password_problem(password: str) -> Optional[str]:
    if len(password or "") < 8:
        return "密码至少 8 位"
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        return "密码需同时包含字母和数字"
    return None


# ---------------- 登录限流 ----------------
def check_login_rate(ip: str) -> None:
    now_ts = time.time()
    with _ATTEMPTS_LOCK:
        bucket = [t for t in _ATTEMPTS.get(ip, []) if now_ts - t < 600]
        _ATTEMPTS[ip] = bucket
        if len(bucket) >= 10:
            raise HTTPException(429, "登录尝试过于频繁，请 10 分钟后再试")


def note_login_failure(ip: str) -> None:
    with _ATTEMPTS_LOCK:
        _ATTEMPTS.setdefault(ip, []).append(time.time())


def clear_login_failures(ip: str) -> None:
    with _ATTEMPTS_LOCK:
        _ATTEMPTS.pop(ip, None)


# ---------------- 会话 ----------------
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int, workspace_id: int | None, ip: str = "", ua: str = "") -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    db.insert(
        """INSERT INTO sessions(token_hash, user_id, workspace_id, expires_at, created_at, ip, user_agent)
           VALUES(?,?,?,?,?,?,?)""",
        (_token_hash(token), user_id, workspace_id, expires, db.now(), ip, (ua or "")[:300]),
    )
    # 顺手清理过期会话
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (db.now(),))
    return token


def revoke_session(token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))


def resolve_token(token: str) -> dict | None:
    if not token:
        return None
    row = db.fetchone(
        """SELECT s.id AS session_id, s.workspace_id, s.expires_at, s.created_at AS session_created,
                  u.id, u.email, u.name, u.is_active, u.is_admin
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash=?""",
        (_token_hash(token),),
    )
    if not row:
        return None
    if row["expires_at"] < db.now():
        db.execute("DELETE FROM sessions WHERE id=?", (row["session_id"],))
        return None
    if not row["is_active"]:
        return None
    return row


def token_from_request(request: Request) -> str:
    token = request.cookies.get(config.COOKIE_NAME, "")
    if not token:
        header = request.headers.get("authorization", "")
        if header.lower().startswith("bearer "):
            token = header[7:].strip()
    return token


# ---------------- 当前上下文 ----------------
@dataclass
class Auth:
    user: dict
    session: dict
    workspace: dict
    role: str

    @property
    def workspace_id(self) -> int:
        return int(self.workspace["id"])

    @property
    def user_id(self) -> int:
        return int(self.user["id"])

    @property
    def plan(self) -> dict:
        return PLANS.get(self.workspace.get("plan", "free"), PLANS["free"])

    @property
    def is_platform_admin(self) -> bool:
        return bool(self.user.get("is_admin"))

    @property
    def is_workspace_admin(self) -> bool:
        return self.role in ("owner", "admin")


def _first_workspace(user_id: int) -> dict | None:
    return db.fetchone(
        """SELECT w.*, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
           WHERE m.user_id=? ORDER BY w.id LIMIT 1""",
        (user_id,),
    )


def get_auth(request: Request) -> Auth:
    token = token_from_request(request)
    row = resolve_token(token)
    if not row:
        raise HTTPException(401, "未登录或会话已过期")

    user = {"id": row["id"], "email": row["email"], "name": row["name"],
            "is_active": row["is_active"], "is_admin": row["is_admin"]}
    workspace_id = row["workspace_id"]

    membership = None
    if workspace_id:
        membership = db.fetchone(
            """SELECT w.*, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
               WHERE m.user_id=? AND m.workspace_id=?""",
            (user["id"], workspace_id),
        )
    if not membership:
        membership = _first_workspace(user["id"])
        if membership:
            db.execute("UPDATE sessions SET workspace_id=? WHERE id=?", (membership["id"], row["session_id"]))
        else:
            # 平台管理员没有工作区时，自动补一个
            if user["is_admin"]:
                from .seed import create_workspace_for_user
                create_workspace_for_user(user["id"], f"{user['name']} 的工作区", "team")
                membership = _first_workspace(user["id"])
            if not membership:
                raise HTTPException(403, "当前账号没有可用工作区")

    session = {"id": row["session_id"], "workspace_id": membership["id"]}
    return Auth(user=user, session=session, workspace=dict(membership), role=membership["role"])


def require_workspace_admin(auth: Auth = Depends(get_auth)) -> Auth:
    if not (auth.is_workspace_admin or auth.is_platform_admin):
        raise HTTPException(403, "需要工作区管理员权限")
    return auth


def require_platform_admin(auth: Auth = Depends(get_auth)) -> Auth:
    if not auth.is_platform_admin:
        raise HTTPException(403, "需要平台管理员权限")
    return auth


# ---------------- Cookie ----------------
def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        config.COOKIE_NAME, token,
        max_age=config.SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=config.COOKIE_SECURE, path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(config.COOKIE_NAME, path="/")
