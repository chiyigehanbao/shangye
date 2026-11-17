#!/usr/bin/env bash
# 危险操作：清空数据库并重新生成演示数据
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "这会删除 data/ 下的数据库与上传文件，并重新生成演示数据。"
read -r -p "确认继续？输入 RESET 继续：" answer
if [ "$answer" != "RESET" ]; then
  echo "已取消。"
  exit 0
fi

docker compose down || true
rm -f data/flowdesk.db data/flowdesk.db-wal data/flowdesk.db-shm
rm -rf data/uploads
docker compose up -d
echo "已重置。首次启动会自动创建管理员与演示数据。"
