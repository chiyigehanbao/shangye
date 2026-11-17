"""数据处理核心：读取、清洗、汇总、导出。全部使用 Pandas 确定性实现。"""
from io import BytesIO

import pandas as pd

AGG_LABELS = {"sum": "求和", "count": "计数", "avg": "平均", "max": "最大", "min": "最小"}


def read_table(filename: str, content: bytes) -> pd.DataFrame:
    """支持 .xlsx / .xls / .csv（自动尝试常见中文编码，并容忍字段数不一致的行）。"""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        last = None
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return pd.read_csv(BytesIO(content), encoding=enc)
            except Exception as e:  # noqa: BLE001
                last = e
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return pd.read_csv(BytesIO(content), encoding=enc, on_bad_lines="skip")
            except Exception as e:  # noqa: BLE001
                last = e
        raise last
    return pd.read_excel(BytesIO(content))


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols = []
    for i, c in enumerate(df.columns):
        name = str(c).strip()
        cols.append(name if name and name.lower() != "nan" else f"列{i + 1}")
    df.columns = cols
    return df


def _is_empty(x) -> bool:
    try:
        if x is None:
            return True
        if isinstance(x, str):
            return x.strip() == ""
        return bool(pd.isna(x))
    except Exception:  # noqa: BLE001
        return False


def clean_df(df: pd.DataFrame, remove_empty: bool = True, remove_dup: bool = True):
    df = df.copy()
    stats = {"original": int(len(df))}

    if remove_empty:
        before = len(df)
        df = df.dropna(how="all")
        if len(df):
            df = df[~df.apply(lambda r: all(_is_empty(v) for v in r), axis=1)]
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
        g = tmp.groupby(group_by, dropna=False)["__value__"]
        series = {"sum": g.sum, "avg": g.mean, "max": g.max, "min": g.min}.get(agg, g.sum)()
        out = series.reset_index()
        out.columns = [group_by, AGG_LABELS.get(agg, "合计")]

    out = out.sort_values(out.columns[1], ascending=(agg == "min"))
    return out.reset_index(drop=True)


def clean_cell(x):
    try:
        if x is None or (not isinstance(x, str) and pd.isna(x)):
            return ""
    except Exception:  # noqa: BLE001
        pass
    if isinstance(x, pd.Timestamp):
        return x.strftime("%Y-%m-%d")
    return x


def df_to_aoa(df: pd.DataFrame, limit: int | None = None):
    d = df if limit is None else df.head(limit)
    headers = [str(c) for c in d.columns]
    rows = [[clean_cell(v) for v in row] for row in d.itertuples(index=False, name=None)]
    return headers, rows


def build_excel(cleaned: pd.DataFrame, summary: pd.DataFrame | None) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        cleaned.to_excel(writer, sheet_name="清洗后数据", index=False)
        if summary is not None:
            summary.to_excel(writer, sheet_name="汇总", index=False)
    return buf.getvalue()


def build_excel_from_records(headers, rows, summary_headers=None, summary_rows=None) -> bytes:
    """从持久化的记录重建 Excel（用于历史任务重新下载）。"""
    cleaned = pd.DataFrame(rows, columns=headers)
    summary = None
    if summary_headers and summary_rows is not None:
        summary = pd.DataFrame(summary_rows, columns=summary_headers)
    return build_excel(cleaned, summary)


def build_matrix_excel(headers, rows) -> bytes:
    """单表结构化导出（文档字段对齐）。"""
    df = pd.DataFrame(rows, columns=headers)
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="结构化", index=False)
    return buf.getvalue()
