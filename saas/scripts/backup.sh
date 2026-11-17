#!/usr/bin/env bash
# 在线备份 SQLite（调用 Python sqlite3 backup API，避免复制 WAL 中的半写状态）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="flowdesk-${STAMP}.db"

docker compose exec -T app python - "$NAME" <<'PY'
import os, sqlite3, sys, time
name = sys.argv[1]
src = os.environ.get("DATABASE_PATH", "/app/data/flowdesk.db")
dst = os.path.join("/app/data/backups", name)
os.makedirs(os.path.dirname(dst), exist_ok=True)
con = sqlite3.connect(src)
bak = sqlite3.connect(dst)
with bak:
    con.backup(bak)
con.close()
bak.close()
print(dst)
PY

# 保留 14 天
find data/backups -type f -name 'flowdesk-*.db' -mtime +14 -delete 2>/dev/null || true
echo "备份完成：data/backups/${NAME}"
