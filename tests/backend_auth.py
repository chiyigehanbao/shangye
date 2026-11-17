"""后端鉴权与持久化测试
运行: python tests/backend_auth.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, "..", "excel-backend"))

# 使用独立的临时数据库，避免污染正式数据
os.environ["DB_PATH"] = os.path.join(tempfile.gettempdir(), "hf_test.db")
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


CSV = ("\ufeff日期,门店,商品,数量,金额\n"
       "2026-01-05,北京店,拿铁,3,90\n"
       "2026-01-05,上海店,美式,2,50\n"
       "2026-01-06,北京店,拿铁,3,90\n"
       ",,,,\n"
       "2026-01-06,广州店,蛋糕,1,40\n"
       "2026-01-07,北京店,蛋糕,4,160\n"
       "2026-01-07,广州店,拿铁,1,30\n").encode("utf-8")

print("== 鉴权 ==")
r = c.post("/api/login", json={"username": "admin", "password": "wrong"})
ok("错误密码返回 401", r.status_code == 401)

r = c.post("/api/login", json={"username": "admin", "password": "admin123"})
ok("正确密码登录成功", r.status_code == 200 and "token" in r.json())
token = r.json()["token"]
H = {"Authorization": "Bearer " + token}

r = c.get("/api/me")
ok("无 token 访问 /api/me 返回 401", r.status_code == 401)

r = c.get("/api/me", headers=H)
ok("/api/me 返回用户名", r.status_code == 200 and r.json()["username"] == "admin")

r = c.post("/api/upload", files={"file": ("a.csv", CSV, "text/csv")})
ok("无 token 上传返回 401", r.status_code == 401)

print("\n== 上传 / 处理 / 持久化 ==")
r = c.post("/api/upload", files={"file": ("a.csv", CSV, "text/csv")}, headers=H)
ok("登录后上传成功", r.status_code == 200 and r.json()["row_count"] == 7)
sid = r.json()["session"]

r = c.post("/api/process", json={"session": sid, "group_by": "门店", "value_col": "金额", "agg": "sum"}, headers=H)
d = r.json()
ok("处理成功并返回 job_id", r.status_code == 200 and "job_id" in d)
sj = {x[0]: x[1] for x in d["summary_rows"]}
ok("汇总数值正确(北京店=340)", sj.get("北京店") == 340, str(sj))
job_id = d["job_id"]

r = c.get("/api/jobs", headers=H)
ok("历史记录包含该任务", r.status_code == 200 and any(j["id"] == job_id for j in r.json()["jobs"]))

r = c.get(f"/api/jobs/{job_id}", headers=H)
ok("任务详情可读取", r.status_code == 200 and r.json()["filename"] == "a.csv")

r = c.get(f"/api/jobs/{job_id}/export", headers=H)
ok("历史任务可重新导出 xlsx", r.status_code == 200 and r.content[:2] == b"PK")

print("\n== 多用户隔离 ==")
uid2 = dbmod.ensure_user("tester2", "pass2")
r = c.post("/api/login", json={"username": "tester2", "password": "pass2"})
H2 = {"Authorization": "Bearer " + r.json()["token"]}
r = c.get(f"/api/jobs/{job_id}", headers=H2)
ok("其他用户无法读取该任务(404)", r.status_code == 404)
r = c.get("/api/jobs", headers=H2)
ok("其他用户历史为空", r.status_code == 200 and r.json()["jobs"] == [])

print("\n== 删除 ==")
r = c.delete(f"/api/jobs/{job_id}", headers=H)
ok("删除任务成功", r.status_code == 200)
r = c.get("/api/jobs", headers=H)
ok("删除后历史中不再出现", all(j["id"] != job_id for j in r.json()["jobs"]))

print("\n============================================")
print(f"结果: {PASS} 通过, {FAIL} 失败")
sys.exit(1 if FAIL else 0)
