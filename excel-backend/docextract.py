"""服务端文档字段提取：规则提取 + 关键词兜底 + 文本/PDF 读取。"""
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

PAIR_FIELDS = [("甲方", r"甲方[:：]\s*([^\s，。；\n]{2,40})"),
               ("乙方", r"乙方[:：]\s*([^\s，。；\n]{2,40})")]

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")


def is_image(filename: str) -> bool:
    return (filename or "").lower().endswith(IMAGE_EXTS)


def extract_text(filename: str, content: bytes, progress_cb=None) -> str:
    name = (filename or "").lower()
    if name.endswith((".txt", ".md", ".csv", ".log", ".json")):
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return content.decode(enc)
            except Exception:  # noqa: BLE001
                continue
        return content.decode("utf-8", "ignore")
    if name.endswith(".pdf"):
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        n = len(reader.pages)
        parts = []
        for i, page in enumerate(reader.pages):
            parts.append(page.extract_text() or "")
            if progress_cb:
                progress_cb(i + 1, n)
        return "\n".join(parts)
    raise ValueError("后端仅支持文本/ PDF，图片请用前端 OCR 或接入视觉模型")


def rule_extract(text: str):
    rows = []
    for field, rex in EXTRACTORS:
        found = list(dict.fromkeys(m.group(0).strip() for m in rex.finditer(text)))
        if found:
            rows.append({"field": field, "value": "、".join(found[:20]), "source": "规则"})
    for field, pat in PAIR_FIELDS:
        m = re.search(pat, text)
        if m:
            rows.append({"field": field, "value": m.group(1).strip(), "source": "规则"})
    return rows


def fallback_fields(text: str, fields):
    out = []
    for f in fields:
        v = "未找到"
        if re.search(r"电话|手机|联系", f):
            m = re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text)
            v = m.group(0) if m else v
        elif re.search(r"邮箱|邮件|email", f, re.I):
            m = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
            v = m.group(0) if m else v
        elif re.search(r"金额|价格|费用|总额|价款", f):
            m = re.search(r"(?:¥|￥)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:元|万元|万)", text)
            v = m.group(0) if m else v
        elif re.search(r"日期|时间|签订", f):
            m = re.search(r"\d{4}\s?[-/年.]\s?\d{1,2}\s?[-/月.]\s?\d{1,2}\s?日?", text)
            v = m.group(0) if m else v
        elif re.search(r"甲方", f):
            m = re.search(r"甲方[:：]\s*([^\s，。；\n]{2,40})", text)
            v = m.group(1).strip() if m else v
        elif re.search(r"乙方", f):
            m = re.search(r"乙方[:：]\s*([^\s，。；\n]{2,40})", text)
            v = m.group(1).strip() if m else v
        elif re.search(r"编号|订单号|合同号", f):
            m = re.search(r"[A-Z]{2,}-?\d{4,}", text)
            v = m.group(0) if m else v
        out.append({"field": f, "value": v, "source": "规则兜底"})
    return out


def build_matrix(jobs):
    """把多个文档任务对齐成 一行一个文档 / 一列一个字段 的矩阵。"""
    fields = []
    for j in jobs:
        for r in j.get("results", []):
            if r["field"] not in fields:
                fields.append(r["field"])
    headers = ["文档"] + fields
    rows = []
    for j in jobs:
        m = {r["field"]: r["value"] for r in j.get("results", [])}
        rows.append([j.get("filename", "")] + [m.get(f, "") for f in fields])
    return headers, rows
