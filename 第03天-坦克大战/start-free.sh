#!/usr/bin/env bash
# 免费方案：本机游戏服 + Cloudflare 临时公网隧道
# 用法：./start-free.sh
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3099}"

echo "=== 1) 启动游戏服务器 (port $PORT) ==="
if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已有服务在跑，跳过 npm start"
else
  node server.js &
  SERVER_PID=$!
  echo "server pid=$SERVER_PID"
  sleep 1
fi

if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "健康检查失败：http://127.0.0.1:$PORT/health"
  exit 1
fi
echo "本机 OK: http://127.0.0.1:$PORT"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "未找到 cloudflared，请先: brew install cloudflared"
  exit 1
fi

echo ""
echo "=== 2) 启动 Cloudflare 免费隧道 ==="
echo "出现 https://xxxx.trycloudflare.com 后，把该链接发给同学即可。"
echo "每人可用自己的热点/流量打开同一链接，再创建/加入房间。"
echo "按 Ctrl+C 结束隧道（本机游戏服若是本次脚本启动的会一起停）。"
echo ""

# 若本脚本启动了 server，退出时尽量清掉
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 国内网络常拦 QUIC/UDP，强制 http2 更稳
cloudflared tunnel --url "http://127.0.0.1:$PORT" --protocol http2 --no-autoupdate
