#!/usr/bin/env bash
# FlowDesk 一键部署（Linux + Docker Compose）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\033[1;36m[FlowDesk]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "未安装 Docker，请先安装 Docker Engine 与 Compose 插件。"
docker compose version >/dev/null 2>&1 || fail "未找到 docker compose 插件。"

if [ ! -f .env ]; then
  cp .env.example .env
  warn "已生成 .env，请先修改其中的 ADMIN_PASSWORD、APP_URL、AI_API_KEY 等配置，然后重新执行本脚本。"
  exit 1
fi

# 防止把示例密码带上生产
if grep -qE '^ADMIN_PASSWORD=(ChangeMe_Admin_2026|Admin@12345)$' .env; then
  warn "检测到 .env 仍使用示例管理员密码，建议立即修改。"
fi
if grep -qE '^ENV=development$' .env; then
  warn "ENV 仍为 development，生产部署建议改为 production。"
fi

mkdir -p data/uploads data/backups backups
if [ "$(id -u)" = "0" ]; then
  chown -R 1000:1000 data backups
else
  if [ "$(stat -c '%u' data 2>/dev/null || echo 0)" != "1000" ]; then
    warn "data 目录所有者不是 1000。若容器无法写数据库，请执行：sudo chown -R 1000:1000 data backups"
  fi
fi

say "构建镜像…"
docker compose build

say "启动服务…"
docker compose up -d

PORT="$(grep -E '^HTTP_PORT=' .env | tail -n1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-80}"

say "等待健康检查…"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    say "服务已就绪：http://127.0.0.1:${PORT}"
    say "浏览器打开后使用 .env 中的管理员账号登录，或使用演示账号。"
    docker compose ps
    exit 0
  fi
  sleep 2
done

docker compose ps
docker compose logs --tail=80 app
fail "健康检查超时，请查看上面日志。"
