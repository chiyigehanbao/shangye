"""销售看板：服务端聚合、KPI、趋势、分类占比、导出。"""
from __future__ import annotations

from io import BytesIO

import pandas as pd

from .excel import clean_cell, df_to_aoa


def _frame(headers: list[str], rows: list[list]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=headers)


def suggest(headers: list[str], rows: list[list]) -> dict:
    from .excel import auto_config
    df = _frame(headers, rows)
    return auto_config(df)


def _pick(df: pd.DataFrame, name: str) -> str:
    return name if name and name in df.columns else ""


def analyze(headers: list[str], rows: list[list], config: dict) -> dict:
    df = _frame(headers, rows)
    date_col = _pick(df, config.get("date", ""))
    cat_col = _pick(df, config.get("category", ""))
    amt_col = _pick(df, config.get("amount", ""))
    start = (config.get("start") or "").strip()
    end = (config.get("end") or "").strip()
    top_n = int(config.get("top_n") or 0)

    if amt_col:
        df["__amount"] = pd.to_numeric(df[amt_col], errors="coerce").fillna(0.0)
    else:
        df["__amount"] = 1.0

    if date_col:
        df["__date"] = pd.to_datetime(df[date_col], errors="coerce")
        if start:
            df = df[df["__date"].isna() | (df["__date"] >= pd.Timestamp(start))]
        if end:
            df = df[df["__date"].isna() | (df["__date"] <= pd.Timestamp(end) + pd.Timedelta(days=1))]
    else:
        df["__date"] = pd.NaT

    if cat_col:
        df["__cat"] = df[cat_col].fillna("未分类").astype(str).str.strip().replace("", "未分类")
    else:
        df["__cat"] = "全部"

    total = float(df["__amount"].sum())
    orders = int(len(df))
    avg = total / orders if orders else 0.0

    series = []
    best_day = {"date": "-", "value": 0.0}
    if date_col:
        grouped = (df.dropna(subset=["__date"])
                     .assign(__day=lambda d: d["__date"].dt.strftime("%Y-%m-%d"))
                     .groupby("__day")["__amount"].sum()
                     .sort_index())
        series = [{"date": d, "value": round(float(v), 2)} for d, v in grouped.items()]
        if series:
            best_day = max(series, key=lambda x: x["value"])

    cat_group = df.groupby("__cat")["__amount"].sum().sort_values(ascending=False)
    cats = [(str(k), float(v)) for k, v in cat_group.items()]
    if top_n and len(cats) > top_n:
        rest = sum(v for _, v in cats[top_n:])
        cats = cats[:top_n] + [("其他", rest)]
    categories = [{
        "name": name,
        "value": round(value, 2),
        "percent": round(value / total * 100, 1) if total else 0.0,
    } for name, value in cats]

    preview_headers, preview_rows = df_to_aoa(df[headers].head(100))

    return {
        "kpis": {
            "total": round(total, 2),
            "orders": orders,
            "avg": round(avg, 2),
            "best_day": best_day,
            "days": len(series),
            "category_count": len(category_count := [c for c in cats if c[0] != "其他"]),
        },
        "series": series,
        "categories": categories,
        "columns": {"date": date_col, "category": cat_col, "amount": amt_col},
        "row_count": orders,
        "preview": {"headers": preview_headers, "rows": preview_rows},
        "range": {"start": start, "end": end},
    }


def insight_context(result: dict) -> str:
    k = result["kpis"]
    cols = result["columns"]
    top = "，".join(f"{c['name']}:¥{c['value']}" for c in result["categories"][:8])
    return (
        f"指标口径：{cols['category'] or '分类'}=分类，{cols['amount'] or '记录数'}=金额，{cols['date'] or '无'}=日期\n"
        f"总销售额:¥{k['total']}，订单数:{k['orders']}，平均客单价:¥{k['avg']}，"
        f"最高单日:{k['best_day']['date']} ¥{k['best_day']['value']}\n分类合计:{top}"
    )


def rule_insight(result: dict) -> str:
    k = result["kpis"]
    cats = result["categories"]
    lines = [f"总销售额 ¥{k['total']:,.0f}，共 {k['orders']} 单，平均客单价 ¥{k['avg']:,.1f}。"]
    if cats:
        top = cats[0]
        lines.append(f"贡献最高的是「{top['name']}」，合计 ¥{top['value']:,.0f}，占比 {top['percent']}%。")
    if len(cats) > 1:
        lines.append(f"紧随其后的是「{cats[1]['name']}」，¥{cats[1]['value']:,.0f}。")
    if len(cats) > 1 and cats[0]["value"] > cats[1]["value"] * 1.5:
        lines.append(f"头部集中度较高，建议向「{cats[0]['name']}」倾斜资源，同时复盘其余分类的流失原因。")
    if k["best_day"]["date"] != "-":
        lines.append(f"最高单日出现在 {k['best_day']['date']}（¥{k['best_day']['value']:,.0f}），可复盘当日活动或客流。")
    lines.append("建议按周对比分类趋势，优先优化占比下滑且客单价高的品类。")
    return "\n".join(lines)


def build_xlsx(result: dict) -> bytes:
    categories = pd.DataFrame([{"分类": c["name"], "金额": c["value"], "占比%": c["percent"]}
                               for c in result["categories"]])
    series = pd.DataFrame([{"日期": s["date"], "销售额": s["value"]} for s in result["series"]])
    preview = pd.DataFrame(result["preview"]["rows"], columns=result["preview"]["headers"])
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        categories.to_excel(writer, sheet_name="分类汇总", index=False)
        if len(series):
            series.to_excel(writer, sheet_name="趋势", index=False)
        preview.to_excel(writer, sheet_name="明细", index=False)
    return buf.getvalue()


def build_csv(result: dict) -> bytes:
    lines = ["分类,金额,占比%"]
    for c in result["categories"]:
        lines.append(f"{c['name']},{c['value']},{c['percent']}")
    lines.append(f"合计,{result['kpis']['total']},")
    return ("\ufeff" + "\n".join(lines)).encode("utf-8")
