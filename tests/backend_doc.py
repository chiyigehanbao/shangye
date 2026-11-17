"""后端文档提取 API 测试（规则 + 兜底 + 持久化 + 结构化导出）
运行: python tests/backend_doc.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, "..", "excel-backend"))

os.environ["DB_PATH"] = os.path.join(tempfile.gettempdir(), "hf_doc_test.db")
os.environ["OLLAMA_BASE"] = "http://127.0.0.1:59999"  # 指向无效端口，强制走规则兜底
if os.path.exists(os.environ["DB_PATH"]):
    os.remove(os.environ["DB_PATH"])

sys.path.insert(0, BACKEND)
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import db as dbmod  # noqa: E402

c = TestClient(main.app)
PASS = 0
FAIL = 0


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {extra}")


TXT = "甲方：北京星辰科技有限公司\n签订日期：2026-01-08\n合同金额：￥58,000.00 元\n联系电话：13800138000\n邮箱：service@example.com"

token = c.post("/api/login", json={"username": "admin", "password": "admin123"}).json()["token"]
H = {"Authorization": "Bearer " + token}

print("== 文档提取 ==")
r = c.post("/api/doc/extract", data={"text": TXT, "fields": ""}, headers=H)
d = r.json()
fields = {x["field"] for x in d["results"]}
ok("规则提取成功", r.status_code == 200)
ok("命中手机号/邮箱/金额", {"手机号", "邮箱", "金额"} <= fields, str(fields))
job1 = d["job_id"]

r = c.post("/api/doc/extract", data={"text": TXT, "fields": "合同金额,联系电话"}, headers=H)
d2 = r.json()
ok("字段模式：离线走规则兜底", d2["via"] == "rule" and all(x["source"] == "规则兜底" for x in d2["results"]), str(d2))
vals = {x["field"]: x["value"] for x in d2["results"]}
ok("合同金额被提取", "58,000" in vals.get("合同金额", ""), str(vals))
ok("联系电话被提取", vals.get("联系电话") == "13800138000", str(vals))
job2 = d2["job_id"]

r = c.post("/api/doc/extract", files={"file": ("c.txt", TXT.encode("utf-8"), "text/plain")}, data={"fields": ""}, headers=H)
ok("上传 txt 文件提取", r.status_code == 200 and r.json()["filename"] == "c.txt")
job3 = r.json()["job_id"]

print("\n== 历史与持久化 ==")
r = c.get("/api/doc/jobs", headers=H)
ids = [j["id"] for j in r.json()["jobs"]]
ok("历史含全部文档任务", all(i in ids for i in (job1, job2, job3)), str(ids))
r = c.get(f"/api/doc/jobs/{job1}", headers=H)
ok("任务详情可读取", r.status_code == 200 and len(r.json()["results"]) >= 3)

print("\n== 多用户隔离 ==")
dbmod.ensure_user("tester3", "pass3")
t2 = c.post("/api/login", json={"username": "tester3", "password": "pass3"}).json()["token"]
r = c.get(f"/api/doc/jobs/{job1}", headers={"Authorization": "Bearer " + t2})
ok("其他用户不可见(404)", r.status_code == 404)

print("\n== 结构化 Excel 导出 ==")
r = c.get(f"/api/doc/export?ids={job1},{job2}", headers=H)
ok("导出 xlsx(PK 头)", r.status_code == 200 and r.content[:2] == b"PK")

print("\n== 删除 ==")
r = c.delete(f"/api/doc/jobs/{job1}", headers=H)
ok("删除成功", r.status_code == 200)
r = c.get("/api/doc/jobs", headers=H)
ok("删除后不再出现", job1 not in [j["id"] for j in r.json()["jobs"]])

print("\n== 视觉 OCR（无模型时优雅降级） ==")
import base64 as _b
PNG = _b.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
r = c.post("/api/doc/extract", files={"file": ("p.png", PNG, "image/png")}, data={"fields": ""}, headers=H)
ok("无视觉模型时图片返回 400", r.status_code == 400, str(r.status_code))
ok("提示包含 视觉模型/OCR", ("视觉模型" in r.json().get("detail", "")) or ("OCR" in r.json().get("detail", "")), str(r.json()))
r = c.get("/api/health")
ok("health 含 vision 字段", "vision" in r.json())

print("\n== 异步任务队列 ==")
r = c.post("/api/doc/enqueue",
           files=[("files", ("q1.txt", TXT.encode("utf-8"), "text/plain")),
                  ("files", ("q2.txt", TXT.encode("utf-8"), "text/plain"))],
           data={"fields": ""}, headers=H)
ids = r.json()["task_ids"]
ok("入队返回 2 个任务", len(ids) == 2, str(ids))
import time as _t
sts = {}
for _ in range(80):
    sts = {t["id"]: t["status"] for t in c.get("/api/doc/tasks", headers=H).json()["tasks"]}
    if all(sts.get(i) == "done" for i in ids):
        break
    _t.sleep(0.5)
ok("任务全部完成", all(sts.get(i) == "done" for i in ids), str(sts))

r = c.get(f"/api/doc/tasks/{ids[0]}", headers=H)
d = r.json()
ok("任务结果含邮箱字段", d["status"] == "done" and any(x["field"] == "邮箱" for x in d["result"]["results"]), str(d)[:200])
job_a = d["result"]["job_id"]
job_b = c.get(f"/api/doc/tasks/{ids[1]}", headers=H).json()["result"]["job_id"]
r = c.get(f"/api/doc/export?ids={job_a},{job_b}", headers=H)
ok("队列结果可结构化导出", r.status_code == 200 and r.content[:2] == b"PK")

r = c.post("/api/doc/enqueue", files=[("files", ("bad.png", PNG, "image/png"))], data={"fields": ""}, headers=H)
bad_id = r.json()["task_ids"][0]
bsts = ""
for _ in range(40):
    bsts = c.get(f"/api/doc/tasks/{bad_id}", headers=H).json()["status"]
    if bsts in ("done", "failed"):
        break
    _t.sleep(0.5)
ok("无视觉模型图片任务标记为失败", bsts == "failed", bsts)
ok("删除任务成功", c.delete(f"/api/doc/tasks/{ids[0]}", headers=H).status_code == 200)

print("\n== 分页与搜索 ==")
r = c.get("/api/doc/jobs?q=c.txt", headers=H)
ok("搜索命中 c.txt", any(j["filename"] == "c.txt" for j in r.json()["jobs"]) and r.json()["total"] >= 1)
r = c.get("/api/doc/jobs?q=不存在的关键字XYZ", headers=H)
ok("搜索无结果 total=0", r.json()["total"] == 0, str(r.json()["total"]))
r = c.get("/api/doc/jobs?page=1&page_size=1", headers=H)
ok("分页 page_size=1 返回 1 条且 total 正确", len(r.json()["jobs"]) == 1 and r.json()["total"] >= 2, str(r.json()))

print("\n== 进度与重试 ==")
r = c.get("/api/doc/tasks", headers=H)
t0 = r.json()["tasks"][0]
ok("任务含 进度/尝试/max 字段", all(k in t0 for k in ("progress", "attempts", "max_attempts")), str(t0))
r = c.post(f"/api/doc/tasks/{bad_id}/retry", headers=H)
ok("失败任务可重试(200)", r.status_code == 200, str(r.status_code))

print("\n== 优先级 / 取消 / 原始文件 ==")
r = c.post("/api/doc/enqueue", files=[("files", ("p1.txt", b"hello 13800138000", "text/plain"))],
           data={"fields": "", "priority": "10"}, headers=H)
pid = r.json()["task_ids"][0]
ok("高优先级被记录", c.get(f"/api/doc/tasks/{pid}", headers=H).json()["priority"] == 10)

r = c.post("/api/doc/extract", files={"file": ("keep.txt", b"KEEPCONTENT-123 k@k.com", "text/plain")},
           data={"fields": ""}, headers=H)
d = r.json()
ok("返回 file_id 且非重复", d.get("file_id") and d.get("duplicate") is False, str(d.get("duplicate")))
fid = d["file_id"]
r = c.post("/api/doc/extract", files={"file": ("keep2.txt", b"KEEPCONTENT-123 k@k.com", "text/plain")},
           data={"fields": ""}, headers=H)
ok("相同内容判为重复且共用 file_id", r.json()["duplicate"] is True and r.json()["file_id"] == fid)
r = c.get(f"/api/doc/files/{fid}/download", headers=H)
ok("可下载原始文件", r.status_code == 200 and b"KEEPCONTENT" in r.content)
s = c.get("/api/doc/files/stats", headers=H).json()
ok("存储统计(去重后)", s["files"] >= 1 and s["bytes"] >= 1, str(s))

big = ("甲方：X 电话 13800138000 金额 100 元\n" * 120000).encode("utf-8")
r = c.post("/api/doc/enqueue", files=[("files", ("big.txt", big, "text/plain"))],
           data={"fields": "", "priority": "0"}, headers=H)
bid = r.json()["task_ids"][0]
r = c.post(f"/api/doc/tasks/{bid}/cancel", headers=H)
ok("取消请求被接受", r.status_code == 200 and r.json()["status"] in ("canceled", "canceling"), str(r.json()))
final = ""
for _ in range(60):
    final = c.get(f"/api/doc/tasks/{bid}", headers=H).json()["status"]
    if final == "canceled":
        break
    _t.sleep(0.3)
ok("任务最终为 已取消", final == "canceled", final)

print("\n============================================")
print(f"结果: {PASS} 通过, {FAIL} 失败")
sys.exit(1 if FAIL else 0)
