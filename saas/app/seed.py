"""首次启动的演示数据。可重复执行，不会重复插入。

- 平台管理员：admin@flowdesk.dev / Admin@12345
- 演示账号：  demo@flowdesk.dev  / Demo@12345
- 团队成员：  member@flowdesk.dev / Member@12345
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from . import config, database as db, security, workers


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return (base or f"ws-{secrets.token_hex(3)}")[:40] + "-" + secrets.token_hex(3)


def _ensure_user(email: str, name: str, password: str, is_admin: int = 0) -> int:
    email = email.lower()
    row = db.fetchone("SELECT id FROM users WHERE email=?", (email,))
    if row:
        if is_admin:
            db.execute("UPDATE users SET is_admin=1 WHERE id=?", (row["id"],))
        return int(row["id"])
    return db.insert(
        "INSERT INTO users(email, name, pw_hash, is_admin, created_at) VALUES(?,?,?,?,?)",
        (email, name, security.hash_password(password), is_admin, db.now()),
    )


def create_workspace_for_user(user_id: int, name: str, plan: str = "free") -> int:
    existing = db.fetchone(
        """SELECT w.id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
           WHERE m.user_id=? ORDER BY w.id LIMIT 1""",
        (user_id,),
    )
    if existing:
        return int(existing["id"])
    return db.insert(
        "INSERT INTO workspaces(name, slug, plan, owner_id, created_at) VALUES(?,?,?,?,?)",
        (name, _slug(name), plan, user_id, db.now()),
    )


def _ensure_membership(workspace_id: int, user_id: int, role: str) -> None:
    if not db.fetchone("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?",
                       (workspace_id, user_id)):
        db.insert("INSERT INTO memberships(workspace_id, user_id, role, created_at) VALUES(?,?,?,?)",
                  (workspace_id, user_id, role, db.now()))


def _sample_sales(rows: int = 0):
    stores = ["北京店", "上海店", "广州店", "成都店"]
    goods = [("拿铁", 30), ("美式", 26), ("蛋糕", 38), ("轻食", 45)]
    state = 20260101

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        return state / 0x7FFFFFFF

    data = []
    start = datetime.now(timezone.utc).date() - timedelta(days=13)
    for i in range(14):
        day = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        for store in stores:
            for _ in range(2 + int(rnd() * 2)):
                good, base = goods[int(rnd() * len(goods)) % len(goods)]
                qty = 1 + int(rnd() * 4)
                amount = qty * (base + int(rnd() * 12))
                data.append([day, store, good, qty, amount])
    headers = ["日期", "门店", "商品", "数量", "金额"]
    return headers, data


def seed_all() -> None:
    admin_id = _ensure_user(config.ADMIN_EMAIL, config.ADMIN_NAME, config.ADMIN_PASSWORD, is_admin=1)
    admin_ws = create_workspace_for_user(admin_id, "FlowDesk 平台", "team")
    _ensure_membership(admin_ws, admin_id, "owner")

    if not config.SEED_DEMO:
        return

    demo_id = _ensure_user(config.DEMO_EMAIL, config.DEMO_NAME, config.DEMO_PASSWORD)
    demo_ws = create_workspace_for_user(demo_id, config.DEMO_WORKSPACE, "pro")
    _ensure_membership(demo_ws, demo_id, "owner")

    member_id = _ensure_user("member@flowdesk.dev", "林晓", "Member@12345")
    _ensure_membership(demo_ws, member_id, "member")

    _seed_quotes(demo_ws, demo_id)
    _seed_excel(demo_ws, demo_id)
    _seed_docs(demo_ws, demo_id)
    _seed_analytics(demo_ws, demo_id)
    _seed_billing(demo_ws)
    _seed_usage(demo_ws, [demo_id, member_id])
    _seed_audit(demo_ws, demo_id)


def _seed_quotes(workspace_id: int, user_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM quotes WHERE workspace_id=?", (workspace_id,), 0):
        return
    from .services import quotes as Q

    samples = [
        {
            "title": "星野咖啡 · 官网与数据工具", "customer": "星野咖啡（北京）有限公司",
            "currency": "CNY", "tax_rate": 6, "discount_rate": 5, "status": "sent",
            "note": "报价有效期 30 天，签约后 3 个工作日内启动。",
            "items": [
                {"name": "品牌官网设计与开发", "unit": "项", "qty": 1, "price": 6800},
                {"name": "Excel 每日销售汇总工具", "unit": "项", "qty": 1, "price": 2200},
                {"name": "服务器部署与上线", "unit": "人天", "qty": 2, "price": 600},
            ],
        },
        {
            "title": "青禾贸易 · 合同字段抽取试点", "customer": "青禾贸易有限公司",
            "currency": "CNY", "tax_rate": 6, "discount_rate": 0, "status": "accepted",
            "note": "先做 200 份合同试点，验收后转年度服务。",
            "items": [
                {"name": "合同关键字段抽取（甲方/金额/日期）", "unit": "项", "qty": 1, "price": 3200},
                {"name": "批量任务队列与导出", "unit": "项", "qty": 1, "price": 1800},
            ],
        },
    ]
    for sample in samples:
        calc = Q.compute(sample["items"], sample["tax_rate"], sample["discount_rate"])
        db.insert(
            """INSERT INTO quotes(workspace_id, user_id, title, customer, currency, tax_rate,
                   discount_rate, note, items_json, subtotal, discount, tax, total, status, created_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (workspace_id, user_id, sample["title"], sample["customer"], sample["currency"],
             calc["tax_rate"], calc["discount_rate"], sample["note"], db.json_dump(calc["items"]),
             calc["subtotal"], calc["discount"], calc["tax"], calc["total"], sample["status"],
             db.now(), db.now()),
        )


def _seed_excel(workspace_id: int, user_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM excel_jobs WHERE workspace_id=?", (workspace_id,), 0):
        return
    headers = ["日期", "门店", "商品", "数量", "金额"]
    rows = [
        ["2026-10-01", "北京店", "拿铁", 3, 90],
        ["2026-10-01", "上海店", "美式", 2, 52],
        ["2026-10-02", "北京店", "拿铁", 2, 60],
        ["2026-10-02", "广州店", "蛋糕", 1, 38],
        ["2026-10-03", "北京店", "蛋糕", 4, 152],
        ["2026-10-03", "成都店", "轻食", 2, 90],
        ["2026-10-03", "上海店", "拿铁", 3, 90],
    ]
    summary_headers = ["门店", "求和"]
    summary_rows = [["北京店", 302], ["上海店", 142], ["广州店", 38], ["成都店", 90]]
    db.insert(
        """INSERT INTO excel_jobs(workspace_id, user_id, filename, original, cleaned, removed_empty,
               removed_dup, headers_json, rows_json, summary_headers_json, summary_rows_json, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (workspace_id, user_id, "10月门店销售示例.csv", 11, 7, 3, 1,
         db.json_dump(headers), db.json_dump(rows), db.json_dump(summary_headers),
         db.json_dump(summary_rows), db.now()),
    )


def _seed_docs(workspace_id: int, user_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM doc_jobs WHERE workspace_id=?", (workspace_id,), 0):
        return
    results = [
        {"field": "甲方", "value": "星野咖啡（北京）有限公司", "source": "规则"},
        {"field": "乙方", "value": "青禾供应链有限公司", "source": "规则"},
        {"field": "合同金额", "value": "¥128,000.00", "source": "规则"},
        {"field": "签订日期", "value": "2026-09-18", "source": "规则"},
        {"field": "联系电话", "value": "13800138000", "source": "规则"},
    ]
    snippet = ("甲方：星野咖啡（北京）有限公司  乙方：青禾供应链有限公司  "
               "合同金额：¥128,000.00 签订日期：2026-09-18 联系电话：13800138000")
    content = (snippet + "\n\n第一条 采购内容\n第二条 交付与验收\n第三条 付款方式\n").encode("utf-8")
    file_id, _ = workers.save_file(workspace_id, user_id, "星野咖啡_采购合同.txt", content)
    db.insert(
        """INSERT INTO doc_jobs(workspace_id, user_id, filename, fields_json, results_json,
               text_snippet, file_id, content_hash, size, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (workspace_id, user_id, "星野咖啡_采购合同.txt",
         db.json_dump(["甲方", "乙方", "合同金额", "签订日期", "联系电话"]),
         db.json_dump(results), snippet, file_id, hashlib.sha256(content).hexdigest(),
         len(content), db.now()),
    )


def _seed_analytics(workspace_id: int, user_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM datasets WHERE workspace_id=?", (workspace_id,), 0):
        return
    from .services import analytics as A

    headers, rows = _sample_sales()
    dataset_id = db.insert(
        """INSERT INTO datasets(workspace_id, user_id, filename, headers_json, rows_json, row_count, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (workspace_id, user_id, "门店销售示例.csv", db.json_dump(headers),
         db.json_dump(rows), len(rows), db.now()),
    )
    cfg = {"date": "日期", "category": "门店", "amount": "金额", "top_n": 0}
    result = A.analyze(headers, rows, cfg)
    db.insert(
        """INSERT INTO analytics_jobs(workspace_id, user_id, dataset_id, filename, config_json,
               result_json, insight, created_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        (workspace_id, user_id, dataset_id, "门店销售示例.csv", db.json_dump(cfg),
         db.json_dump(result), A.rule_insight(result), db.now()),
    )


def _seed_billing(workspace_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM invoices WHERE workspace_id=?", (workspace_id,), 0):
        return
    now = datetime.now(timezone.utc)
    for months_ago, amount in ((1, 9900), (0, 9900)):
        start = (now - timedelta(days=30 * months_ago)).strftime("%Y-%m-%d")
        end = (now + timedelta(days=30 * (1 - months_ago))).strftime("%Y-%m-%d")
        db.insert(
            """INSERT INTO invoices(workspace_id, plan, amount_cents, currency, status,
                   period_start, period_end, created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (workspace_id, "pro", amount, "CNY", "paid", start, end,
             (now - timedelta(days=30 * months_ago)).strftime("%Y-%m-%d %H:%M:%S")),
        )


def _seed_usage(workspace_id: int, user_ids: list[int]) -> None:
    if db.scalar("SELECT COUNT(*) FROM usage_events WHERE workspace_id=?", (workspace_id,), 0):
        return
    modules = [("excel", "process"), ("docs", "extract"), ("quotes", "ai_generate"),
               ("analytics", "analyze"), ("docs", "extract")]
    today = datetime.now(timezone.utc)
    for i in range(14):
        day = today - timedelta(days=13 - i)
        for j, (module, action) in enumerate(modules):
            if (i + j) % 3 == 0:
                continue
            units = 1 + ((i * 5 + j * 3) % 3)
            created = day.replace(hour=9 + (j % 8), minute=(i * 7) % 60, second=0)
            db.insert(
                """INSERT INTO usage_events(workspace_id, user_id, module, action, units, meta_json, created_at)
                   VALUES(?,?,?,?,?,?,?)""",
                (workspace_id, user_ids[j % len(user_ids)], module, action, units, None,
                 created.strftime("%Y-%m-%d %H:%M:%S")),
            )
    for i in range(8):
        db.insert(
            """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
               VALUES(?,?,?,?,1,?,?)""",
            (workspace_id, user_ids[i % len(user_ids)],
             ["excel.report", "docs.extract", "quotes.generate", "analytics.insight"][i % 4],
             ["api", "rules", "ollama"][i % 3], 600 + i * 120, db.now()),
        )


def _seed_audit(workspace_id: int, user_id: int) -> None:
    if db.scalar("SELECT COUNT(*) FROM audit_logs WHERE workspace_id=?", (workspace_id,), 0):
        return
    from . import audit
    for action, target in (
        ("workspace.rename", config.DEMO_WORKSPACE),
        ("excel.process", "10月门店销售示例.csv"),
        ("docs.extract", "星野咖啡_采购合同.txt"),
        ("quote.create", "星野咖啡 · 官网与数据工具"),
        ("analytics.analyze", "门店销售示例.csv"),
    ):
        audit.log(workspace_id, user_id, action, target)
