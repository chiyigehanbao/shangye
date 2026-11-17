"""文档解析与字段提取：规则 + AI 兜底，支持 txt / md / csv / pdf / docx / xlsx。"""
from __future__ import annotations

import io
import re

EXTRACTORS = [
    ("手机号", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("邮箱", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("身份证号", re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")),
    ("金额", re.compile(r"(?:¥|￥)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:元|万元|万)")),
    ("日期", re.compile(r"\d{4}\s?[-/年.]\s?\d{1,2}\s?[-/月.]\s?\d{1,2}\s?日?")),
    ("合同/订单号", re.compile(r"[A-Z]{2,}-?\d{4,}")),
    ("网址", re.compile(r"https?://[^\s，。；]+")),
]

PAIR_FIELDS = [
    ("甲方", r"甲方[:：]\s*([^\s，。；\n]{2,40})"),
    ("乙方", r"乙方[:：]\s*([^\s，。；\n]{2,40})"),
]

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
TEXT_EXTS = (".txt", ".md", ".csv", ".log", ".json", ".xml", ".html", ".htm")


def is_image(filename: str) -> bool:
    return (filename or "").lower().endswith(IMAGE_EXTS)


def decode_text(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return content.decode(enc)
        except Exception:  # noqa: BLE001
            continue
    return content.decode("utf-8", "ignore")


def _pdf_text(content: bytes, progress_cb=None) -> str:
    import pypdf
    reader = pypdf.PdfReader(io.BytesIO(content))
    total = len(reader.pages)
    parts = []
    for i, page in enumerate(reader.pages):
        parts.append(page.extract_text() or "")
        if progress_cb:
            progress_cb(i + 1, total)
    return "\n".join(parts)


def _docx_text(content: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(content))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _xlsx_text(content: bytes) -> str:
    import pandas as pd
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None)
    parts = []
    for name, df in sheets.items():
        parts.append(f"[工作表: {name}]")
        parts.append(df.to_csv(index=False))
    return "\n".join(parts)


def extract_text(filename: str, content: bytes, progress_cb=None) -> str:
    name = (filename or "").lower()
    if name.endswith(TEXT_EXTS):
        return decode_text(content)
    if name.endswith(".pdf"):
        return _pdf_text(content, progress_cb)
    if name.endswith(".docx"):
        return _docx_text(content)
    if name.endswith((".xlsx", ".xls")):
        return _xlsx_text(content)
    if is_image(name):
        raise ValueError("图片需要视觉模型，请先转成 PDF 或直接粘贴文字")
    raise ValueError("暂不支持该文件类型，请上传 txt / md / csv / pdf / docx / xlsx")


def fields_to_list(raw: str) -> list[str]:
    return [f.strip() for f in re.split(r"[，,、\s]+", raw or "") if f.strip()]


def rule_extract(text: str) -> list[dict]:
    rows = []
    for field, regex in EXTRACTORS:
        found = list(dict.fromkeys(m.group(0).strip() for m in regex.finditer(text)))
        if found:
            rows.append({"field": field, "value": "、".join(found[:20]), "source": "规则"})
    for field, pattern in PAIR_FIELDS:
        match = re.search(pattern, text)
        if match:
            rows.append({"field": field, "value": match.group(1).strip(), "source": "规则"})
    return rows


def fallback_fields(text: str, fields: list[str]) -> list[dict]:
    out = []
    for field in fields:
        value = "未找到"
        if re.search(r"电话|手机|联系", field):
            m = re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text)
            value = m.group(0) if m else value
        elif re.search(r"邮箱|邮件|email", field, re.I):
            m = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
            value = m.group(0) if m else value
        elif re.search(r"金额|价格|费用|总额|价款|报价", field):
            m = re.search(r"(?:¥|￥)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:元|万元|万)", text)
            value = m.group(0) if m else value
        elif re.search(r"日期|时间|签订", field):
            m = re.search(r"\d{4}\s?[-/年.]\s?\d{1,2}\s?[-/月.]\s?\d{1,2}\s?日?", text)
            value = m.group(0) if m else value
        elif re.search(r"甲方", field):
            m = re.search(r"甲方[:：]\s*([^\s，。；\n]{2,40})", text)
            value = m.group(1).strip() if m else value
        elif re.search(r"乙方", field):
            m = re.search(r"乙方[:：]\s*([^\s，。；\n]{2,40})", text)
            value = m.group(1).strip() if m else value
        elif re.search(r"编号|订单号|合同号", field):
            m = re.search(r"[A-Z]{2,}-?\d{4,}", text)
            value = m.group(0) if m else value
        out.append({"field": field, "value": value, "source": "规则兜底"})
    return out


def build_matrix(jobs: list[dict]):
    """多文档对齐：一行一个文档，一列一个字段。"""
    fields: list[str] = []
    for job in jobs:
        for row in job.get("results", []):
            if row["field"] not in fields:
                fields.append(row["field"])
    headers = ["文档"] + fields
    rows = []
    for job in jobs:
        mapping = {r["field"]: r["value"] for r in job.get("results", [])}
        rows.append([job.get("filename", "")] + [mapping.get(f, "") for f in fields])
    return headers, rows
