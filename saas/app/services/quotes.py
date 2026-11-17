"""报价单：条目校验、金额计算、AI/规则拆解。"""
from __future__ import annotations

import re

CURRENCIES = {"CNY": "¥", "USD": "$", "EUR": "€"}
STATUSES = {"draft": "草稿", "sent": "已发送", "accepted": "已成交"}

_PRICE_MAP = [
    (r"网站|官网|落地页|前端|页面|设计|ui|logo", 2500),
    (r"excel|表格|汇总|报表|数据|看板", 1200),
    (r"小程序|app|系统|后台|管理|平台", 4000),
    (r"部署|服务器|上线|运维|域名", 500),
    (r"爬虫|采集|抓取", 1500),
    (r"ai|智能|模型|助手|大模型", 2000),
]


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_items(items: list[dict]) -> list[dict]:
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:200]
        if not name:
            continue
        out.append({
            "name": name,
            "unit": str(item.get("unit") or "项").strip()[:20] or "项",
            "qty": max(0.0, _num(item.get("qty"), 1)),
            "price": max(0.0, _num(item.get("price"), 0)),
        })
    return out


def compute(items: list[dict], tax_rate: float = 6, discount_rate: float = 0) -> dict:
    items = normalize_items(items)
    tax_rate = min(100.0, max(0.0, _num(tax_rate)))
    discount_rate = min(100.0, max(0.0, _num(discount_rate)))
    subtotal = sum(i["qty"] * i["price"] for i in items)
    discount = subtotal * discount_rate / 100
    after = subtotal - discount
    tax = after * tax_rate / 100
    return {
        "items": items,
        "subtotal": round(subtotal, 2),
        "discount": round(discount, 2),
        "tax": round(tax, 2),
        "total": round(after + tax, 2),
        "tax_rate": tax_rate,
        "discount_rate": discount_rate,
    }


def rule_items(brief: str) -> list[dict]:
    parts = [s.strip() for s in re.split(r"[，,、+和及/；;\n]+", brief or "") if s.strip()]
    if not parts:
        parts = [brief or "定制开发服务"]
    out = []
    for part in parts[:5]:
        hit = next((price for pattern, price in _PRICE_MAP if re.search(pattern, part.lower())), 800)
        out.append({"name": part[:120], "unit": "项", "qty": 1, "price": hit})
    return out
