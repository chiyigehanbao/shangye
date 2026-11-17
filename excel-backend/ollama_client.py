"""服务端调用本地 Ollama。地址与模型可用环境变量覆盖：
OLLAMA_BASE 默认 http://localhost:11434
OLLAMA_MODEL 默认 qwen2.5
"""
import base64
import json
import os

import httpx

BASE = os.getenv("OLLAMA_BASE", "http://localhost:11434").rstrip("/")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5")
TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "60"))

VISION_HINTS = ("llava", "bakllava", "vision", "minicpm-v", "moondream",
                "qwen2-vl", "qwen2.5-vl", "qwen2.5vl", "gemma3", "internvl", "pixtral")

_resolved_model: str | None = None


def list_models() -> list[str]:
    try:
        r = httpx.get(f"{BASE}/api/tags", timeout=2.5)
        r.raise_for_status()
        return [m.get("name") for m in r.json().get("models", []) if m.get("name")]
    except Exception:  # noqa: BLE001
        return []


def vision_model() -> str | None:
    """返回可用的视觉模型名；没有则 None。可用 OLLAMA_VISION_MODEL 指定。"""
    forced = os.getenv("OLLAMA_VISION_MODEL", "").strip()
    if forced:
        return forced
    for m in list_models():
        if any(h in m.lower() for h in VISION_HINTS):
            return m
    return None


def ocr_image(image_bytes: bytes, prompt: str = "请提取这张图片中的全部文字，只返回文字内容，不要解释。") -> str:
    vm = vision_model()
    if not vm:
        raise RuntimeError("未检测到视觉模型，请先 `ollama pull llava`（或 minicpm-v / qwen2.5vl）")
    b64 = base64.b64encode(image_bytes).decode("ascii")
    body = {"model": vm, "stream": False,
            "messages": [{"role": "user", "content": prompt, "images": [b64]}]}
    r = httpx.post(f"{BASE}/api/chat", json=body, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["message"]["content"]


def resolve_model() -> str:
    """优先使用环境变量指定的模型；不存在则退回本机第一个可用模型。"""
    global _resolved_model
    if _resolved_model:
        return _resolved_model
    models = list_models()
    if MODEL in models:
        _resolved_model = MODEL
    elif models:
        _resolved_model = models[0]
    else:
        _resolved_model = MODEL
    return _resolved_model


def status() -> dict:
    try:
        r = httpx.get(f"{BASE}/api/tags", timeout=2.5)
        r.raise_for_status()
        models = [m.get("name") for m in r.json().get("models", [])]
        return {"online": True, "base": BASE, "model": resolve_model(), "models": models,
                "vision": vision_model()}
    except Exception as e:  # noqa: BLE001
        return {"online": False, "base": BASE, "model": MODEL, "models": [], "vision": None, "error": str(e)}


def chat(system: str, prompt: str, json_mode: bool = False, temperature: float = 0.4) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    body = {"model": resolve_model(), "messages": messages, "stream": False,
            "options": {"temperature": temperature}}
    if json_mode:
        body["format"] = "json"
    r = httpx.post(f"{BASE}/api/chat", json=body, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["message"]["content"]


def parse_command(columns, sample: str, text: str):
    """把自然语言指令解析成 {groupBy,valueColumn,agg}。失败返回 (None, 'error')。"""
    system = "你是数据表格处理助手。只输出 JSON，不要解释。"
    prompt = (
        f"表格列名: {' | '.join(columns)}\n数据样例:\n{sample}\n\n"
        f'用户指令: "{text}"\n\n'
        '请返回 JSON，字段: {"groupBy":"分组列名","valueColumn":"数值列名或空",'
        '"agg":"sum|count|avg|max|min"}。groupBy/valueColumn 必须是上面出现过的列名。'
    )
    try:
        out = chat(system, prompt, json_mode=True)
        data = json.loads(out)
        return data, "ollama"
    except Exception:  # noqa: BLE001
        return None, "error"


def report(context: str):
    system = "你是资深数据分析师，用简洁中文写经营分析报告，分点，突出关键发现与建议，不要编造数据。"
    prompt = f"基于以下表格处理结果，写一份简短分析报告（150-250字）：\n{context}"
    try:
        return chat(system, prompt), "ollama"
    except Exception:  # noqa: BLE001
        return None, "error"


def extract_fields(text: str, fields):
    """从文本中按字段名抽取值，返回 (results, via)。失败返回 (None, 'error')。"""
    system = "你是信息抽取助手，只输出 JSON，不要解释。"
    prompt = (
        "从下面文档中提取这些字段：" + "、".join(fields) + "。\n"
        '返回 JSON：{"results":[{"field":"字段名","value":"字段值；找不到填\\"未找到\\""}]}。\n\n'
        "文档内容：\n" + text[:4000]
    )
    try:
        out = chat(system, prompt, json_mode=True)
        data = json.loads(out)
        res = data.get("results")
        if isinstance(res, list) and res:
            return res, "ollama"
    except Exception:  # noqa: BLE001
        pass
    return None, "error"
