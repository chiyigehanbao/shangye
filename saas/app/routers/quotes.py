"""报价单 CRUD 与 AI 条目生成。"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import ai, audit, database as db, quota
from ..security import Auth, get_auth
from ..services import quotes as Q

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


class QuoteReq(BaseModel):
    title: str = "未命名报价单"
    customer: str = ""
    currency: str = "CNY"
    tax_rate: float = 6
    discount_rate: float = 0
    note: str = ""
    items: list[dict] = Field(default_factory=list)
    status: str = "draft"


class BriefReq(BaseModel):
    brief: str


def _validate(req: QuoteReq) -> None:
    if not (1 <= len(req.title.strip()) <= 80):
        raise HTTPException(400, "报价单标题需为 1-80 个字符")
    if req.currency not in Q.CURRENCIES:
        raise HTTPException(400, "不支持的币种")
    if req.status not in Q.STATUSES:
        raise HTTPException(400, "不支持的状态")
    if len(req.items) > 60:
        raise HTTPException(400, "报价条目不能超过 60 条")


@router.get("")
def list_quotes(q: str = "", status: str = "", page: int = 1, page_size: int = 20,
                auth: Auth = Depends(get_auth)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    where, params = "workspace_id=?", [auth.workspace_id]
    if q:
        where += " AND (title LIKE ? OR customer LIKE ?)"
        like = f"%{q}%"
        params += [like, like]
    if status in Q.STATUSES:
        where += " AND status=?"
        params.append(status)
    total = int(db.scalar(f"SELECT COUNT(*) FROM quotes WHERE {where}", params) or 0)
    rows = db.fetchall(
        f"""SELECT id, title, customer, currency, tax_rate, discount_rate, subtotal, discount,
                   tax, total, status, created_at, updated_at
            FROM quotes WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
        params + [page_size, (page - 1) * page_size],
    )
    return {"quotes": rows, "total": total, "page": page, "page_size": page_size}


def _get(quote_id: int, auth: Auth) -> dict:
    row = db.fetchone("SELECT * FROM quotes WHERE id=? AND workspace_id=?",
                      (quote_id, auth.workspace_id))
    if not row:
        raise HTTPException(404, "报价单不存在")
    row["items"] = db.json_load(row.pop("items_json", None), [])
    return row


@router.get("/{quote_id}")
def get_quote(quote_id: int, auth: Auth = Depends(get_auth)):
    row = _get(quote_id, auth)
    row["currency_symbol"] = Q.CURRENCIES.get(row["currency"], "¥")
    return row


@router.post("")
def create_quote(req: QuoteReq, auth: Auth = Depends(get_auth)):
    _validate(req)
    calc = Q.compute(req.items, req.tax_rate, req.discount_rate)
    quote_id = db.insert(
        """INSERT INTO quotes(workspace_id, user_id, title, customer, currency, tax_rate,
               discount_rate, note, items_json, subtotal, discount, tax, total, status, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, req.title.strip(), req.customer.strip(), req.currency,
         calc["tax_rate"], calc["discount_rate"], req.note.strip(), db.json_dump(calc["items"]),
         calc["subtotal"], calc["discount"], calc["tax"], calc["total"], req.status, db.now(), db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "quote.create", req.title,
              {"quote": quote_id, "total": calc["total"]})
    return {"ok": True, "id": quote_id, **calc}


@router.patch("/{quote_id}")
def update_quote(quote_id: int, req: QuoteReq, auth: Auth = Depends(get_auth)):
    _get(quote_id, auth)
    _validate(req)
    calc = Q.compute(req.items, req.tax_rate, req.discount_rate)
    db.execute(
        """UPDATE quotes SET title=?, customer=?, currency=?, tax_rate=?, discount_rate=?,
               note=?, items_json=?, subtotal=?, discount=?, tax=?, total=?, status=?, updated_at=?
           WHERE id=? AND workspace_id=?""",
        (req.title.strip(), req.customer.strip(), req.currency, calc["tax_rate"], calc["discount_rate"],
         req.note.strip(), db.json_dump(calc["items"]), calc["subtotal"], calc["discount"],
         calc["tax"], calc["total"], req.status, db.now(), quote_id, auth.workspace_id),
    )
    audit.log(auth.workspace_id, auth.user_id, "quote.update", req.title,
              {"quote": quote_id, "total": calc["total"]})
    return {"ok": True, "id": quote_id, **calc}


@router.delete("/{quote_id}")
def delete_quote(quote_id: int, auth: Auth = Depends(get_auth)):
    row = _get(quote_id, auth)
    db.execute("DELETE FROM quotes WHERE id=? AND workspace_id=?", (quote_id, auth.workspace_id))
    audit.log(auth.workspace_id, auth.user_id, "quote.delete", row["title"])
    return {"ok": True}


@router.post("/{quote_id}/duplicate")
def duplicate_quote(quote_id: int, auth: Auth = Depends(get_auth)):
    row = _get(quote_id, auth)
    new_id = db.insert(
        """INSERT INTO quotes(workspace_id, user_id, title, customer, currency, tax_rate,
               discount_rate, note, items_json, subtotal, discount, tax, total, status, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, f"{row['title']} · 副本", row["customer"], row["currency"],
         row["tax_rate"], row["discount_rate"], row["note"], db.json_dump(row["items"]),
         row["subtotal"], row["discount"], row["tax"], row["total"], "draft", db.now(), db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "quote.duplicate", row["title"], {"from": quote_id, "to": new_id})
    return {"ok": True, "id": new_id}


@router.post("/ai/generate")
def generate(req: BriefReq, auth: Auth = Depends(get_auth)):
    brief = req.brief.strip()
    if len(brief) < 4:
        raise HTTPException(400, "请用一句话描述项目需求")
    started = time.time()
    items, provider = ai.quote_items(brief)
    if not items:
        items, provider = Q.rule_items(brief), "rules"
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "quotes", "ai_generate", 1, {"chars": len(brief)})
    db.insert(
        """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
           VALUES(?,?,?,?,1,?,?)""",
        (auth.workspace_id, auth.user_id, "quotes.generate", provider,
         int((time.time() - started) * 1000), db.now()),
    )
    return {"items": items, "via": provider, "via_label": ai.label(provider)}
