"""Excel / CSV 处理：读取、清洗、汇总、列推断、导出。"""
from __future__ import annotations

from io import BytesIO

import pandas as pd

AGG_LABELS = {"sum": "求和", "count": "计数", "avg": "平均", "max": "最大", "min": "最小"}
DATE_HINT = r"日期|时间|date|day|month|月份|周"
AMOUNT_HINT = r"金额|销售额|销售|收入|营收|总额|合计|价格|费用|成本|price|amount|total|revenue|cost"


def read_table(filename: str, content: bytes) -> pd.DataFrame:
    name = (filename or "").lower()
    if name.endswith(".csv"):
        last = None
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return pd.read_csv(BytesIO(content), encoding=enc)
            except Exception as exc:  # noqa: BLE001
                last = exc
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return pd.read_csv(BytesIO(content), encoding=enc, on_bad_lines="skip")
            except Exception as exc:  # noqa: BLE001
                last = exc
        raise last  # type: ignore[misc]
    return pd.read_excel(BytesIO(content))


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols = []
    for i, col in enumerate(df.columns):
        name = str(col).strip()
        cols.append(name if name and name.lower() != "nan" else f"列{i + 1}")
    df = df.copy()
    df.columns = cols
    return df


def _is_empty(value) -> bool:
    try:
        if value is None:
            return True
        if isinstance(value, str):
            return value.strip() == ""
        return bool(pd.isna(value))
    except Exception:  # noqa: BLE001
        return False


def clean_df(df: pd.DataFrame, remove_empty: bool = True, remove_dup: bool = True):
    df = df.copy()
    stats = {"original": int(len(df))}

    if remove_empty:
        before = len(df)
        df = df.dropna(how="all")
        if len(df):
            df = df[~df.apply(lambda row: all(_is_empty(v) for v in row), axis=1)]
        stats["removed_empty"] = int(before - len(df))
    else:
        stats["removed_empty"] = 0

    if remove_dup:
        before = len(df)
        df = df.drop_duplicates()
        stats["removed_dup"] = int(before - len(df))
    else:
        stats["removed_dup"] = 0

    stats["cleaned"] = int(len(df))
    return df.reset_index(drop=True), stats


def aggregate(df: pd.DataFrame, group_by: str, value_col: str | None = None, agg: str = "sum") -> pd.DataFrame:
    if group_by not in df.columns:
        raise ValueError(f"分组列「{group_by}」不存在")
    if agg == "count":
        out = df.groupby(group_by, dropna=False).size().reset_index(name="计数")
    else:
        if not value_col or value_col not in df.columns:
            raise ValueError(f"数值列「{value_col}」不存在")
        num = pd.to_numeric(df[value_col], errors="coerce")
        tmp = df.assign(__value__=num)
        grouped = tmp.groupby(group_by, dropna=False)["__value__"]
        series = {"sum": grouped.sum, "avg": grouped.mean,
                  "max": grouped.max, "min": grouped.min}.get(agg, grouped.sum)()
        out = series.reset_index()
        out.columns = [group_by, AGG_LABELS.get(agg, "合计")]
    out = out.sort_values(out.columns[1], ascending=(agg == "min"))
    return out.reset_index(drop=True)


def clean_cell(value):
    try:
        if value is None or (not isinstance(value, str) and pd.isna(value)):
            return ""
    except Exception:  # noqa: BLE001
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:  # noqa: BLE001
            pass
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def df_to_aoa(df: pd.DataFrame, limit: int | None = None):
    data = df if limit is None else df.head(limit)
    headers = [str(c) for c in data.columns]
    rows = [[clean_cell(v) for v in row] for row in data.itertuples(index=False, name=None)]
    return headers, rows


def build_excel(cleaned: pd.DataFrame, summary: pd.DataFrame | None) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        cleaned.to_excel(writer, sheet_name="清洗后数据", index=False)
        if summary is not None:
            summary.to_excel(writer, sheet_name="汇总", index=False)
    return buf.getvalue()


def build_excel_from_records(headers, rows, summary_headers=None, summary_rows=None) -> bytes:
    cleaned = pd.DataFrame(rows, columns=headers)
    summary = None
    if summary_headers and summary_rows is not None:
        summary = pd.DataFrame(summary_rows, columns=summary_headers)
    return build_excel(cleaned, summary)


def build_matrix_excel(headers, rows) -> bytes:
    df = pd.DataFrame(rows, columns=headers)
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="结构化", index=False)
    return buf.getvalue()


# ---------------- 列类型推断（服务端） ----------------
def _classify(series: pd.Series) -> str:
    s = series.dropna().astype(str).head(300)
    if s.empty:
        return "empty"
    if s.str.match(r"^\d{4}[-/.年]\d{1,2}").mean() > 0.6:
        return "date"
    num = pd.to_numeric(s.str.replace(r"[^\d.\-]", "", regex=True), errors="coerce")
    if num.notna().mean() > 0.8:
        return "number"
    return "text"


def column_info(df: pd.DataFrame) -> list[dict]:
    out = []
    for i, col in enumerate(df.columns):
        series = df[col]
        kind = _classify(series)
        non_empty = int(series.dropna().astype(str).str.strip().ne("").sum())
        out.append({
            "index": i,
            "name": str(col),
            "type": kind,
            "non_empty": non_empty,
            "distinct": int(series.dropna().astype(str).nunique()),
        })
    return out


def _name_hit(name: str, pattern: str) -> bool:
    return pd.Series([name]).str.contains(pattern, case=False, regex=True).iloc[0]


def auto_config(df: pd.DataFrame) -> dict:
    info = column_info(df)
    date_cols = [c for c in info if c["type"] == "date"]
    num_cols = [c for c in info if c["type"] == "number"]
    text_cols = [c for c in info if c["type"] == "text"]

    date = next((c for c in date_cols if _name_hit(c["name"], DATE_HINT)), None)
    date = date or (date_cols[0] if date_cols else None)

    amount = next((c for c in num_cols if _name_hit(c["name"], AMOUNT_HINT)), None)
    if amount is None and num_cols:
        def total(c):
            return float(pd.to_numeric(df[c["name"]], errors="coerce").abs().sum() or 0)
        amount = max(num_cols, key=total)

    candidates = [c for c in text_cols if 2 <= c["distinct"] <= 60]
    category = max(candidates, key=lambda c: c["distinct"]) if candidates else (text_cols[0] if text_cols else None)

    return {
        "date": date["name"] if date else "",
        "category": category["name"] if category else "",
        "amount": amount["name"] if amount else "",
        "columns": info,
    }
