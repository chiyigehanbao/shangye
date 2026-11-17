"""销售看板：数据集上传、聚合分析、AI 洞察、导出。"""
from __future__ import annotations

import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import ai, audit, config, database as db, quota
from ..security import Auth, get_auth
from ..services import analytics as A
from ..services import excel as X

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
MAX_ROWS = 20000


class AnalyzeReq(BaseModel):
    dataset_id: int
    config: dict = Field(default_factory=dict)


class InsightReq(BaseModel):
    job_id: int


def _dataset(dataset_id: int, auth: Auth) -> dict:
    row = db.fetchone("SELECT * FROM datasets WHERE id=? AND workspace_id=?",
                      (dataset_id, auth.workspace_id))
    if not row:
        raise HTTPException(404, "数据集不存在，请重新上传")
    return row


def _headers_rows(dataset: dict) -> tuple[list[str], list[list]]:
    return db.json_load(dataset["headers_json"], []), db.json_load(dataset["rows_json"], [])


@router.post("/upload")
async def upload(file: UploadFile = File(...), auth: Auth = Depends(get_auth)):
    content = await file.read()
    if not content:
        raise HTTPException(400, "空文件")
    if len(content) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"文件不能超过 {config.MAX_UPLOAD_MB} MB")
    try:
        df = X.normalize_columns(X.read_table(file.filename or "", content))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"解析失败：{exc}") from exc
    if len(df) == 0 or len(df.columns) == 0:
        raise HTTPException(400, "文件没有可识别的数据")

    truncated = len(df) > MAX_ROWS
    if truncated:
        df = df.head(MAX_ROWS)
    headers, rows = X.df_to_aoa(df)
    suggested = X.auto_config(df)
    dataset_id = db.insert(
        """INSERT INTO datasets(workspace_id, user_id, filename, headers_json, rows_json, row_count, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, file.filename, db.json_dump(headers),
         db.json_dump(rows), len(rows), db.now()),
    )
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "analytics", "upload", 1,
                  {"rows": len(rows), "filename": file.filename})
    audit.log(auth.workspace_id, auth.user_id, "analytics.upload", file.filename,
              {"dataset": dataset_id, "rows": len(rows)})
    return {
        "dataset_id": dataset_id, "filename": file.filename, "row_count": len(rows),
        "headers": headers, "preview": rows[:20], "suggested": suggested,
        "truncated": truncated,
    }


@router.post("/analyze")
def analyze(req: AnalyzeReq, auth: Auth = Depends(get_auth)):
    dataset = _dataset(req.dataset_id, auth)
    headers, rows = _headers_rows(dataset)
    try:
        result = A.analyze(headers, rows, req.config or {})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"分析失败：{exc}") from exc

    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "analytics", "analyze", 1,
                  {"dataset": req.dataset_id, "rows": result["row_count"]})
    job_id = db.insert(
        """INSERT INTO analytics_jobs(workspace_id, user_id, dataset_id, filename, config_json,
               result_json, created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (auth.workspace_id, auth.user_id, req.dataset_id, dataset["filename"],
         db.json_dump(req.config), db.json_dump(result), db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "analytics.analyze", dataset["filename"],
              {"job": job_id, "rows": result["row_count"]})
    return {"job_id": job_id, "dataset_id": req.dataset_id, "filename": dataset["filename"],
            "result": result}


@router.post("/insight")
def insight(req: InsightReq, auth: Auth = Depends(get_auth)):
    job = db.fetchone("SELECT * FROM analytics_jobs WHERE id=? AND workspace_id=?",
                      (req.job_id, auth.workspace_id))
    if not job:
        raise HTTPException(404, "分析记录不存在")
    result = db.json_load(job["result_json"], {}) or {}

    started = time.time()
    text, provider = ai.sales_insight(A.insight_context(result))
    if not text:
        text, provider = A.rule_insight(result), "rules"
    quota.check(auth.workspace_id, auth.workspace["plan"], 1)
    quota.consume(auth.workspace_id, auth.user_id, "analytics", "insight", 1, {"job": req.job_id})
    db.execute("UPDATE analytics_jobs SET insight=? WHERE id=?", (text, req.job_id))
    db.insert(
        """INSERT INTO ai_logs(workspace_id, user_id, module, provider, ok, latency_ms, created_at)
           VALUES(?,?,?,?,1,?,?)""",
        (auth.workspace_id, auth.user_id, "analytics.insight", provider,
         int((time.time() - started) * 1000), db.now()),
    )
    audit.log(auth.workspace_id, auth.user_id, "analytics.insight", f"job:{req.job_id}")
    return {"insight": text, "via": provider, "via_label": ai.label(provider)}


@router.get("/jobs")
def jobs(page: int = 1, page_size: int = 10, auth: Auth = Depends(get_auth)):
    page, page_size = max(1, page), min(100, max(1, page_size))
    total = int(db.scalar("SELECT COUNT(*) FROM analytics_jobs WHERE workspace_id=?",
                          (auth.workspace_id,)) or 0)
    rows = db.fetchall(
        """SELECT id, dataset_id, filename, config_json, result_json, insight, created_at
           FROM analytics_jobs WHERE workspace_id=? ORDER BY id DESC LIMIT ? OFFSET ?""",
        (auth.workspace_id, page_size, (page - 1) * page_size),
    )
    for row in rows:
        result = db.json_load(row.pop("result_json", None), {}) or {}
        row["kpis"] = (result.get("kpis") or {})
        row["config"] = db.json_load(row.pop("config_json", None), {})
    return {"jobs": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/jobs/{job_id}")
def job_detail(job_id: int, auth: Auth = Depends(get_auth)):
    job = db.fetchone("SELECT * FROM analytics_jobs WHERE id=? AND workspace_id=?",
                      (job_id, auth.workspace_id))
    if not job:
        raise HTTPException(404, "分析记录不存在")
    return {
        "id": job["id"], "dataset_id": job["dataset_id"], "filename": job["filename"],
        "created_at": job["created_at"], "config": db.json_load(job["config_json"], {}),
        "result": db.json_load(job["result_json"], {}), "insight": job["insight"],
    }


@router.delete("/jobs/{job_id}")
def job_delete(job_id: int, auth: Auth = Depends(get_auth)):
    changed = db.execute("DELETE FROM analytics_jobs WHERE id=? AND workspace_id=?",
                         (job_id, auth.workspace_id))
    if not changed:
        raise HTTPException(404, "分析记录不存在")
    audit.log(auth.workspace_id, auth.user_id, "analytics.delete", f"job:{job_id}")
    return {"ok": True}


@router.get("/jobs/{job_id}/export")
def job_export(job_id: int, format: str = "xlsx", auth: Auth = Depends(get_auth)):
    job = db.fetchone("SELECT * FROM analytics_jobs WHERE id=? AND workspace_id=?",
                      (job_id, auth.workspace_id))
    if not job:
        raise HTTPException(404, "分析记录不存在")
    result = db.json_load(job["result_json"], {}) or {}
    if format == "csv":
        data = A.build_csv(result)
        return Response(
            content=data, media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote('分类汇总.csv')}"},
        )
    data = A.build_xlsx(result)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote('销售看板.xlsx')}"},
    )
