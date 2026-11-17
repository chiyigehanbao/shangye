"""AI 能力层：云端 OpenAI 兼容 API → 本地 Ollama → 确定性规则。

对外只暴露业务函数，返回 (结果, provider)。provider 用于前端展示与审计，
任何一层失败都不会影响主流程，最差也会走规则兜底。
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

import httpx

from . import config

_OLLAMA_CACHE: dict[str, Any] = {"at": 0.0, "online": False, "models": []}
_LABELS = {"api": "云端 AI", "ollama": "本地模型", "rules": "规则引擎"}


def label(provider: str) -> str:
    return _LABELS.get(provider, provider)


# ---------------- 状态 ----------------
def ollama_status(force: bool = False) -> dict:
    now = time.time()
    if not force and now - _OLLAMA_CACHE["at"] < 30:
        return {"online": _OLLAMA_CACHE["online"], "models": _OLLAMA_CACHE["models"]}
    try:
        r = httpx.get(f"{config.OLLAMA_BASE}/api/tags", timeout=2.0)
        r.raise_for_status()
        models = [m.get("name") for m in r.json().get("models", []) if m.get("name")]
        _OLLAMA_CACHE.update(at=now, online=True, models=models)
    except Exception:  # noqa: BLE001
        _OLLAMA_CACHE.update(at=now, online=False, models=[])
    return {"online": _OLLAMA_CACHE["online"], "models": _OLLAMA_CACHE["models"]}


def status(force: bool = False) -> dict:
    # rules 模式完全离线，避免在 2C2G 上每次状态查询都探测 Ollama
    if config.AI_MODE == "rules":
        ollama = {"online": False, "models": []}
    else:
        ollama = ollama_status(force)
    api = bool(config.AI_API_KEY)
    if config.AI_MODE == "rules":
        active = "rules"
    elif config.AI_MODE == "api":
        active = "api" if api else "rules"
    elif config.AI_MODE == "ollama":
        active = "ollama" if ollama["online"] else "rules"
    else:
        active = "api" if api else ("ollama" if ollama["online"] else "rules")
    return {
        "mode": config.AI_MODE,
        "active": active,
        "active_label": label(active),
        "api_configured": api,
        "api_model": config.AI_MODEL if api else None,
        "ollama_online": ollama["online"],
        "ollama_model": _ollama_model() if ollama["online"] else None,
        "fallback": "规则引擎",
    }


# ---------------- 底层调用 ----------------
def _api_chat(system: str, prompt: str, json_mode: bool) -> Optional[str]:
    if not config.AI_API_KEY:
        return None
    body: dict[str, Any] = {
        "model": config.AI_MODEL,
        "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        r = httpx.post(
            f"{config.AI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {config.AI_API_KEY}", "Content-Type": "application/json"},
            json=body, timeout=config.AI_TIMEOUT,
        )
        r.raise_for_status()
        return (r.json().get("choices") or [{}])[0].get("message", {}).get("content")
    except Exception:  # noqa: BLE001
        return None


def _ollama_model() -> str:
    """优先使用配置的模型；若本地未安装，则自动选择第一个可对话模型。"""
    models = ollama_status()["models"]
    if config.OLLAMA_MODEL in models:
        return config.OLLAMA_MODEL
    for name in models:
        low = name.lower()
        if "embed" not in low and "clip" not in low:
            return name
    return config.OLLAMA_MODEL


def _ollama_chat(system: str, prompt: str, json_mode: bool) -> Optional[str]:
    if not ollama_status()["online"]:
        return None
    body: dict[str, Any] = {
        "model": _ollama_model(),
        "messages": ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.3},
    }
    if json_mode:
        body["format"] = "json"
    try:
        r = httpx.post(f"{config.OLLAMA_BASE}/api/chat", json=body, timeout=min(config.AI_TIMEOUT, 60))
        r.raise_for_status()
        return r.json().get("message", {}).get("content")
    except Exception:  # noqa: BLE001
        return None


def chat(system: str, prompt: str, json_mode: bool = False) -> tuple[Optional[str], str]:
    """按配置顺序尝试；返回 (文本, provider)。"""
    if config.AI_MODE == "rules":
        return None, "rules"
    if config.AI_MODE in ("auto", "api"):
        text = _api_chat(system, prompt, json_mode)
        if text:
            return text, "api"
        if config.AI_MODE == "api":
            return None, "rules"
    if config.AI_MODE in ("auto", "ollama"):
        text = _ollama_chat(system, prompt, json_mode)
        if text:
            return text, "ollama"
    return None, "rules"


def _json(text: Optional[str]) -> Optional[dict]:
    if not text:
        return None
    text = text.strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except ValueError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start:end + 1])
            return data if isinstance(data, dict) else None
        except ValueError:
            return None
    return None


# ---------------- 业务能力 ----------------
def parse_excel_command(columns: list[str], sample: str, text: str) -> tuple[Optional[dict], str]:
    system = "你是数据表格处理助手。只输出 JSON，不要解释。"
    prompt = (
        f"表格列名: {' | '.join(columns)}\n数据样例:\n{sample}\n\n"
        f'用户指令: "{text}"\n\n'
        '返回 JSON: {"groupBy":"分组列名","valueColumn":"数值列名或空","agg":"sum|count|avg|max|min"}。'
        "groupBy 和 valueColumn 必须是上面出现过的列名。"
    )
    raw, provider = chat(system, prompt, json_mode=True)
    data = _json(raw)
    if not data:
        return None, provider
    group = str(data.get("groupBy") or "")
    value = str(data.get("valueColumn") or "")
    agg = str(data.get("agg") or "sum")
    if group not in columns:
        return None, provider
    if value and value not in columns:
        value = ""
    if agg not in ("sum", "count", "avg", "max", "min"):
        agg = "sum"
    return {"groupBy": group, "valueColumn": value, "agg": agg}, provider


def excel_report(context: str) -> tuple[Optional[str], str]:
    system = "你是资深数据分析师，用简洁中文写经营分析报告，分点，突出关键发现与建议，不要编造数据。"
    prompt = f"基于以下表格处理结果，写一份 150-250 字的分析报告：\n{context}"
    return chat(system, prompt)


def doc_fields(text: str, fields: list[str]) -> tuple[Optional[list], str]:
    system = "你是信息抽取助手。只输出 JSON，不要解释。"
    prompt = (
        "从下面文档中提取这些字段：" + "、".join(fields) + "。\n"
        '返回 JSON: {"results":[{"field":"字段名","value":"字段值；找不到填\\"未找到\\""}]}。\n\n'
        "文档内容：\n" + text[:6000]
    )
    raw, provider = chat(system, prompt, json_mode=True)
    data = _json(raw)
    if data and isinstance(data.get("results"), list) and data["results"]:
        rows = []
        for item in data["results"]:
            if isinstance(item, dict) and item.get("field"):
                rows.append({"field": str(item["field"]), "value": str(item.get("value", "未找到")), "source": "AI"})
        if rows:
            return rows, provider
    return None, provider


def quote_items(brief: str) -> tuple[Optional[list], str]:
    system = "你是软件外包报价助手。只输出 JSON，不要解释。"
    prompt = (
        f"客户需求：{brief}\n\n"
        '拆解为 2-5 条报价条目，返回 JSON: {"items":[{"name":"条目名称","unit":"项","qty":1,"price":1200}]}。'
        "价格使用人民币整数，符合国内小型外包行情。"
    )
    raw, provider = chat(system, prompt, json_mode=True)
    data = _json(raw)
    if data and isinstance(data.get("items"), list) and data["items"]:
        items = []
        for it in data["items"][:8]:
            if not isinstance(it, dict):
                continue
            items.append({
                "name": str(it.get("name") or "服务项目")[:120],
                "unit": str(it.get("unit") or "项")[:20],
                "qty": max(0.0, float(it.get("qty") or 1)),
                "price": max(0.0, float(it.get("price") or 0)),
            })
        if items:
            return items, provider
    return None, provider


def sales_insight(context: str) -> tuple[Optional[str], str]:
    system = ("你是资深零售数据分析师，用简洁中文给老板写经营洞察：3-5 条关键发现，"
              "每条一句，最后给 1 条可执行建议。不要编造数据。")
    return chat(system, f"基于以下销售数据写洞察：\n{context}")
