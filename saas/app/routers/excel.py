"""Excel 自动化：上传 → 清洗 → 汇总 → AI 指令 → 导出 → 历史。"""
from __future__ import annotations

import re
import threading
import time
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import ai, audit, config, database as db, quota
from ..security import Auth, get_auth
from ..services import excel as X

router = APIRouter(prefix="/api/excel", tags=["excel"])

SESSIONS: dict[str, dict] = {}
_LOCK = threading.Lock()
_TTL = 2 * 3600
MAX_PERSIST_ROWS = 5000


class ProcessReq(BaseModel):
    session: str
    remove_empty: bool = True
    remove_dup: bool = True
    group_by: str | None = None
    value_col: str | None = None
    agg: str = "sum"


class AIReq(BaseModel):
    session: str
    text: str = ""


def _gc() -> None:
    cutoff = time.time() - _TTL
    with _LOCK:
        for key in [k for k, v in SESSIONS.items() if v["at"] < cutoff]:
            SESSIONS.pop(key, None)


def _session(sid: str, auth: Auth) -> dict:
    sess = SESSIONS.get(sid)
    if not sess or sess["workspace_id"] != auth.workspace_id or sess["user_id"] != auth.user_id:
        raise HTTPException(404, "会话不存在或已过期，请重新上传文件")
    sess["at"] = time.time()
    return sess


def _xlsx(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _log_ai(auth: Auth, module: str, provider: str, ok: bool, started: float) -> None:
    db.insert(
        """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, module, provider, 1 if ok else 0,
         int((time.time() - started) * 1000), db.now()),
    )


@router.post("/upload")
async def upload(file: UploadFile = File(...), auth: Auth = Depends(get_auth)):
    _gc()
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    if len(content) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"文件不能超过 {config.MAX_UPLOAD_MB} MB")
    try:
        df = X.normalize_columns(X.read_table(file.filename or "", content))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"解析失败：{exc}") from exc
    if len(df) == 0 and len(df.columns) == 0:
        raise HTTPException(400, "文件没有可识别的表格内容")

    sid = uuid.uuid4().hex
    SESSIONS[sid] = {
        "at": time.time(), "workspace_id": auth.workspace_id, "user_id": auth.user_id,
        "filename": file.filename, "df": df, "cleaned": None, "summary": None, "stats": None,
    }
    headers, preview = X.df_to_aoa(df, limit=20)
    return {
        "session": sid, "filename": file.filename,
        "columns": [str(c) for c in df.columns],
        "row_count": int(len(df)),
        "headers": headers, "preview": preview,
        "suggested": X.auto_config(df),
    }


@router.post("/process")
def process(req: ProcessReq, auth: Auth = Depends(get_auth)):
    sess = _session(req.session, auth)
    cleaned, stats = X.clean_df(sess["df"], req.remove_empty, req.remove_dup)
    summary = None
    if req.group_by:
        try:
            summary = X.aggregate(cleaned, req.group_by, req.value_col, req.agg)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, str(exc)) from exc

    sess.update(cleaned=cleaned, summary=summary, stats=stats, at=time.time())
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "excel", "process", 1,
                  {"filename": sess["filename"], "rows": stats["cleaned"]})

    ch, _ = X.df_to_aoa(cleaned, limit=MAX_PERSIST_ROWS)
    full_headers, full_rows = X.df_to_aoa(cleaned, limit=MAX_PERSIST_ROWS)
    sh, sr = (X.df_to_aoa(summary, limit=MAX_PERSIST_ROWS) if summary is not None else (None, []))
    job_id = db.insert(
        """INSERT INTO excel_jobs(workspace_id, user_id, filename, original, cleaned, removed_empty,
               removed_dup, headers_json, rows_json, summary_headers_json, summary_rows_json, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, sess["filename"], stats["original"], stats["cleaned"],
         stats["removed_empty"], stats["removed_dup"], db.json_dump(full_headers), db.json_dump(full_rows),
         db.json_dump(sh) if sh else None, db.json_dump(sr) if sh else None, db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "excel.process", sess["filename"],
              {"job": job_id, "rows": stats["cleaned"]})

    ph, pr = X.df_to_aoa(cleaned, limit=100)
    sh2, sr2 = (X.df_to_aoa(summary, limit=200) if summary is not None else (None, []))
    return {
        "session": req.session, "job_id": job_id, "stats": stats,
        "cleaned_headers": ph, "cleaned_rows": pr,
        "summary_headers": sh2, "summary_rows": sr2,
    }


@router.get("/export")
def export(session: str, auth: Auth = Depends(get_auth)):
    sess = _session(session, auth)
    if sess["cleaned"] is None:
        raise HTTPException(400, "请先处理数据")
    return _xlsx(X.build_excel(sess["cleaned"], sess["summary"]), "flowdesk-result.xlsx")


# ---------------- 历史 ----------------
@router.get("/jobs")
def jobs(q: str = "", page: int = 1, page_size: int = 10, auth: Auth = Depends(get_auth)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    where, params = "workspace_id=?", [auth.workspace_id]
    if q:
        where += " AND filename LIKE ?"
        params.append(f"%{q}%")
    total = int(db.scalar(f"SELECT COUNT(*) FROM excel_jobs WHERE {where}", params) or 0)
    rows = db.fetchall(
        f"""SELECT id, filename, original, cleaned, removed_empty, removed_dup, created_at
            FROM excel_jobs WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?""",
        params + [page_size, (page - 1) * page_size],
    )
    return {"jobs": rows, "total": total, "page": page, "page_size": page_size}


def _job(job_id: int, auth: Auth) -> dict:
    job = db.fetchone("SELECT * FROM excel_jobs WHERE id=? AND workspace_id=?", (job_id, auth.workspace_id))
    if not job:
        raise HTTPException(404, "记录不存在")
    return job


@router.get("/jobs/{job_id}")
def job_detail(job_id: int, auth: Auth = Depends(get_auth)):
    job = _job(job_id, auth)
    rows = db.json_load(job["rows_json"], [])
    return {
        "id": job["id"], "filename": job["filename"], "created_at": job["created_at"],
        "stats": {"original": job["original"], "cleaned": job["cleaned"],
                  "removed_empty": job["removed_empty"], "removed_dup": job["removed_dup"]},
        "cleaned_headers": db.json_load(job["headers_json"], []),
        "cleaned_rows": rows[:100],
        "summary_headers": db.json_load(job["summary_headers_json"], None),
        "summary_rows": db.json_load(job["summary_rows_json"], []),
    }


@router.get("/jobs/{job_id}/export")
def job_export(job_id: int, auth: Auth = Depends(get_auth)):
    job = _job(job_id, auth)
    data = X.build_excel_from_records(
        db.json_load(job["headers_json"], []), db.json_load(job["rows_json"], []),
        db.json_load(job["summary_headers_json"], None), db.json_load(job["summary_rows_json"], []),
    )
    return _xlsx(data, f"flowdesk-job-{job_id}.xlsx")


@router.delete("/jobs/{job_id}")
def job_delete(job_id: int, auth: Auth = Depends(get_auth)):
    _job(job_id, auth)
    db.execute("DELETE FROM excel_jobs WHERE id=? AND workspace_id=?", (job_id, auth.workspace_id))
    audit.log(auth.workspace_id, auth.user_id, "excel.delete", f"job:{job_id}")
    return {"ok": True}


# ---------------- AI ----------------
def _rule_plan(columns: list[str], text: str) -> dict:
    matched = [c for c in columns if c and c in text]
    if re.search(r"平均|均值|avg", text, re.I):
        agg = "avg"
    elif re.search(r"计数|数量|个数|单数|多少|count|订单数", text, re.I):
        agg = "count"
    elif re.search(r"最大|最高|max", text, re.I):
        agg = "max"
    elif re.search(r"最小|最低|min", text, re.I):
        agg = "min"
    else:
        agg = "sum"
    return {"groupBy": matched[0] if matched else "", "valueColumn": matched[1] if len(matched) > 1 else "", "agg": agg}


@router.post("/ai/command")
def ai_command(req: AIReq, auth: Auth = Depends(get_auth)):
    sess = _session(req.session, auth)
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "指令为空")
    columns = [str(c) for c in sess["df"].columns]
    sample = "\n".join(" | ".join(str(v) for v in row)
                       for row in sess["df"].head(5).itertuples(index=False, name=None))
    started = time.time()
    plan, provider = ai.parse_excel_command(columns, sample, text)
    if not plan:
        plan, provider = _rule_plan(columns, text), "rules"
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "excel", "ai_command", 1, {"text": text[:120]})
    _log_ai(auth, "excel.command", provider, bool(plan), started)
    return {"plan": plan, "via": provider, "via_label": ai.label(provider)}


def _fallback_report(stats: dict, summary) -> str:
    lines = [f"数据共 {stats.get('original')} 行，清洗后保留 {stats.get('cleaned')} 行"
             f"（删除空行 {stats.get('removed_empty')}、重复 {stats.get('removed_dup')}）。"]
    if summary is not None and len(summary):
        cols = list(summary.columns)
        lines.append(f"按「{cols[0]}」汇总为 {len(summary)} 组。")
        top = summary.head(3)
        lines.append("排名前三：" + "，".join(
            f"{r[0]}={r[1]}" for r in top.itertuples(index=False, name=None)) + "。")
    else:
        lines.append("未启用分组汇总，建议选择分组列与数值列后再生成报告。")
    lines.append("建议继续观察异常值，并把清洗规则固化成模板，减少重复人工。")
    return "\n".join(lines)


@router.post("/ai/report")
def ai_report(req: AIReq, auth: Auth = Depends(get_auth)):
    sess = _session(req.session, auth)
    if sess["cleaned"] is None:
        raise HTTPException(400, "请先处理数据")
    stats = sess["stats"] or {}
    summary = sess["summary"]
    if summary is not None:
        sh, sr = X.df_to_aoa(summary, limit=30)
        summary_text = " | ".join(sh) + "\n" + "\n".join(" | ".join(str(c) for c in r) for r in sr)
    else:
        summary_text = "（未启用汇总）"
    context = (f"原始行数:{stats.get('original')} 清洗后:{stats.get('cleaned')} "
               f"删除空行:{stats.get('removed_empty')} 删除重复:{stats.get('removed_dup')}\n"
               f"汇总结果:\n{summary_text}")
    started = time.time()
    text, provider = ai.excel_report(context)
    if not text:
        text, provider = _fallback_report(stats, summary), "rules"
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "excel", "ai_report", 1)
    _log_ai(auth, "excel.report", provider, True, started)
    return {"report": text, "via": provider, "via_label": ai.label(provider)}
