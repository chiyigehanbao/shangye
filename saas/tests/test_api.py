"""FlowDesk API 回归测试。

运行：pip install -r requirements-dev.txt && pytest -q
使用临时数据库，AI 强制规则模式，不依赖网络。
"""
from __future__ import annotations

import time
import uuid

from conftest import login

DEMO = ("demo@flowdesk.dev", "Demo@12345")
ADMIN = ("admin@flowdesk.dev", "TestAdmin@12345")


def test_public_pages_and_health(client):
    assert client.get("/").status_code == 200
    login_page = client.get("/login")
    assert login_page.status_code == 200
    assert "FlowDesk" in login_page.text
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True


def test_auth_requires_session_and_login(client):
    client.cookies.clear()
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/auth/me").status_code == 401

    bad = client.post("/api/auth/login", json={"email": DEMO[0], "password": "wrong-password"})
    assert bad.status_code in (401, 429)

    me = login(client)
    assert me["user"]["email"] == DEMO[0]
    assert me["workspace"]["role"] == "owner"
    assert me["plan"]["key"] in ("free", "pro", "team")

    current = client.get("/api/auth/me")
    assert current.status_code == 200
    assert current.json()["user"]["email"] == DEMO[0]

    workspace = client.get("/api/workspace")
    assert workspace.status_code == 200
    assert workspace.json()["members"] >= 1
    assert client.get("/api/workspace/members").status_code == 200

    # 安全响应头
    page = client.get("/app")
    assert page.status_code == 200
    assert "content-security-policy" in {k.lower() for k in page.headers}


def test_dashboard(client):
    login(client)
    response = client.get("/api/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert set(data["counts"]) == {"excel", "docs", "quotes", "analytics"}
    assert "usage_series" in data
    assert data["workspace"]["role"] == "owner"


def test_excel_upload_clean_aggregate_export_and_ai(client):
    login(client)
    csv_text = (
        "日期,门店,商品,数量,金额\n"
        "2026-10-01,北京店,拿铁,3,90\n"
        "2026-10-01,上海店,美式,2,52\n"
        "2026-10-02,北京店,拿铁,2,60\n"
        "2026-10-02,广州店,蛋糕,1,38\n"
        "2026-10-03,北京店,蛋糕,4,152\n"
        "2026-10-03,成都店,轻食,2,90\n"
        ",北京店,拿铁,3,90\n"
        "2026-10-01,北京店,拿铁,3,90\n"
    )
    upload = client.post(
        "/api/excel/upload",
        files={"file": ("门店销售.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert upload.status_code == 200, upload.text
    data = upload.json()
    assert data["row_count"] == 8
    assert "门店" in data["columns"]
    session = data["session"]

    processed = client.post("/api/excel/process", json={
        "session": session,
        "remove_empty": True,
        "remove_dup": True,
        "group_by": "门店",
        "value_col": "金额",
        "agg": "sum",
    })
    assert processed.status_code == 200, processed.text
    result = processed.json()
    assert result["stats"]["cleaned"] < 8
    assert result["stats"]["removed_dup"] >= 1
    assert result["summary_headers"] == ["门店", "求和"]
    assert any(row[0] == "北京店" for row in result["summary_rows"])

    export = client.get("/api/excel/export", params={"session": session})
    assert export.status_code == 200
    assert export.content[:2] == b"PK"
    assert len(export.content) > 1000

    ai = client.post("/api/excel/ai/command", json={
        "session": session, "text": "按门店汇总金额"
    })
    assert ai.status_code == 200, ai.text
    assert ai.json()["via"] == "rules"
    assert ai.json()["plan"]["groupBy"] == "门店"

    history = client.get("/api/excel/jobs")
    assert history.status_code == 200
    assert history.json()["total"] >= 1
    job_id = result["job_id"]
    assert client.get(f"/api/excel/jobs/{job_id}").status_code == 200


def test_docs_extract_batch_queue_and_export(client):
    login(client)
    text = (
        "甲方：星河科技有限公司\n"
        "乙方：云帆设计工作室\n"
        "合同金额：人民币 128000 元\n"
        "签订日期：2026-10-18\n"
        "联系电话：13800138000\n"
    )
    extracted = client.post("/api/docs/extract", data={
        "text": text,
        "fields": "甲方,乙方,合同金额,签订日期,联系电话",
    })
    assert extracted.status_code == 200, extracted.text
    body = extracted.json()
    assert body["results"]
    values = {row["field"]: row["value"] for row in body["results"]}
    assert "13800138000" in values.get("联系电话", "") or values.get("联系电话")

    enqueue = client.post(
        "/api/docs/enqueue",
        files=[
            ("files", ("合同A.txt", text.encode("utf-8"), "text/plain")),
            ("files", ("合同B.txt", text.replace("128000", "96000").encode("utf-8"), "text/plain")),
        ],
        data={"fields": "甲方,乙方,合同金额,联系电话"},
    )
    assert enqueue.status_code == 200, enqueue.text
    task_ids = enqueue.json()["task_ids"]
    assert len(task_ids) == 2

    deadline = time.time() + 15
    statuses = {}
    while time.time() < deadline:
        tasks = client.get("/api/docs/tasks").json()["tasks"]
        statuses = {t["id"]: t["status"] for t in tasks}
        if all(statuses.get(i) in ("done", "failed", "canceled") for i in task_ids):
            break
        time.sleep(0.2)
    assert all(statuses.get(i) == "done" for i in task_ids), statuses

    jobs = client.get("/api/docs/jobs").json()
    assert jobs["total"] >= 1
    export = client.get("/api/docs/export", params={"ids": str(body["job_id"])})
    assert export.status_code == 200
    assert export.content[:2] == b"PK"


def test_quotes_crud_and_compute(client):
    login(client)
    payload = {
        "title": "品牌官网建设报价",
        "customer": "星河科技",
        "currency": "CNY",
        "tax_rate": 6,
        "discount_rate": 5,
        "note": "含设计、开发与部署",
        "status": "draft",
        "items": [
            {"name": "品牌官网设计", "unit": "项", "qty": 1, "price": 8000},
            {"name": "响应式开发", "unit": "项", "qty": 1, "price": 12000},
        ],
    }
    created = client.post("/api/quotes", json=payload)
    assert created.status_code == 200, created.text
    quote = created.json()
    assert quote["id"] > 0
    assert quote["total"] > 0
    assert quote["subtotal"] == 20000

    detail = client.get(f"/api/quotes/{quote['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["items"]) == 2

    payload.update({"status": "sent", "discount_rate": 10})
    updated = client.patch(f"/api/quotes/{quote['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["discount"] > quote["discount"]

    listing = client.get("/api/quotes", params={"q": "官网"})
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1

    ai = client.post("/api/quotes/ai/generate", json={
        "brief": "客户需要品牌官网 + 数据看板 + 一年维护"
    })
    assert ai.status_code == 200, ai.text
    assert ai.json()["items"]

    deleted = client.delete(f"/api/quotes/{quote['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/quotes/{quote['id']}").status_code == 404


def test_analytics_upload_analyze_insight_export(client):
    login(client)
    csv_text = (
        "日期,城市,品类,销售额\n"
        "2026-10-01,北京,咖啡,1200\n"
        "2026-10-01,上海,咖啡,980\n"
        "2026-10-02,北京,烘焙,760\n"
        "2026-10-02,广州,咖啡,640\n"
        "2026-10-03,北京,咖啡,1520\n"
        "2026-10-03,成都,轻食,430\n"
    )
    upload = client.post(
        "/api/analytics/upload",
        files={"file": ("销售数据.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert upload.status_code == 200, upload.text
    dataset = upload.json()
    assert dataset["row_count"] == 6
    suggested = dataset["suggested"]
    assert suggested["date"] == "日期"

    analyzed = client.post("/api/analytics/analyze", json={
        "dataset_id": dataset["dataset_id"],
        "config": {
            "date": suggested["date"],
            "category": suggested["category"],
            "amount": suggested["amount"],
        },
    })
    assert analyzed.status_code == 200, analyzed.text
    result = analyzed.json()
    assert result["result"]["kpis"]["total"] == 5530
    assert result["result"]["kpis"]["orders"] == 6
    assert len(result["result"]["categories"]) >= 2
    job_id = result["job_id"]

    insight = client.post("/api/analytics/insight", json={"job_id": job_id})
    assert insight.status_code == 200
    assert insight.json()["insight"]
    assert insight.json()["via"] == "rules"

    export = client.get(f"/api/analytics/jobs/{job_id}/export", params={"format": "xlsx"})
    assert export.status_code == 200
    assert export.content[:2] == b"PK"
    csv_export = client.get(f"/api/analytics/jobs/{job_id}/export", params={"format": "csv"})
    assert csv_export.status_code == 200
    assert "分类" in csv_export.content.decode("utf-8-sig")

    assert client.get("/api/analytics/jobs").json()["total"] >= 1
    assert client.get(f"/api/analytics/jobs/{job_id}").status_code == 200


def test_billing_subscribe_invoice_and_cancel(client):
    login(client)
    plans = client.get("/api/billing/plans")
    assert plans.status_code == 200
    assert len(plans.json()["plans"]) == 3

    summary = client.get("/api/billing/summary")
    assert summary.status_code == 200
    assert summary.json()["sandbox"] is True

    subscribed = client.post("/api/billing/subscribe", json={"plan": "pro", "cycle": "monthly"})
    assert subscribed.status_code == 200, subscribed.text
    assert subscribed.json()["plan"]["key"] == "pro"
    assert client.get("/api/auth/me").json()["plan"]["key"] == "pro"

    invoices = client.get("/api/billing/invoices").json()["invoices"]
    assert invoices
    assert invoices[0]["plan"] == "pro"

    canceled = client.post("/api/billing/cancel")
    assert canceled.status_code == 200
    assert canceled.json()["plan"]["key"] == "free"


def test_tenant_isolation_and_registration(client):
    login(client)
    created = client.post("/api/quotes", json={
        "title": "隔离测试报价",
        "customer": "A 公司",
        "items": [{"name": "服务", "unit": "项", "qty": 1, "price": 100}],
    })
    assert created.status_code == 200
    quote_id = created.json()["id"]

    fresh_email = f"isolation-{uuid.uuid4().hex[:8]}@example.com"
    registered = client.post("/api/auth/register", json={
        "email": fresh_email,
        "name": "隔离用户",
        "password": "Iso@12345",
        "workspace_name": "隔离工作区",
    })
    assert registered.status_code == 200, registered.text
    assert registered.json()["workspace"]["name"] == "隔离工作区"
    assert client.get(f"/api/quotes/{quote_id}").status_code == 404
    assert client.get("/api/quotes").json()["total"] == 0

    # 新用户不能读取演示工作区的文档/分析记录
    assert client.get("/api/docs/jobs").json()["total"] == 0
    assert client.get("/api/analytics/jobs").json()["total"] == 0


def test_admin_console(client):
    login(client, *ADMIN)
    overview = client.get("/api/admin/overview")
    assert overview.status_code == 200, overview.text
    data = overview.json()
    assert data["users"]["total"] >= 3
    assert data["workspaces"]["total"] >= 2
    assert "workers" in data and "ai" in data

    assert client.get("/api/admin/users").status_code == 200
    assert client.get("/api/admin/workspaces").status_code == 200
    assert client.get("/api/admin/audit").status_code == 200
    health = client.get("/api/admin/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    # 普通用户不能访问平台后台
    login(client)
    assert client.get("/api/admin/overview").status_code == 403
