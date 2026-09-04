#!/bin/bash
# 云眠花园主图生成工具 - 原生启动器 (修复架构 + PATH 问题版)
PROJ="/Users/chenshiyi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a7311c786184bee09f00896"
FRONT_DIR="$PROJ/web/app"
FRONT_URL="http://127.0.0.1:5173/"
BACK_PORT=8000
FRONT_PORT=5173
LOG="/tmp/csg-launcher-$$.log"
BACK_LOG="/tmp/csg-backend.log"
FRONT_LOG="/tmp/csg-frontend.log"

# --- 补充 PATH，确保能找到 node/npm/npx ---
export PATH="/usr/local/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.14/bin:$PATH"
# --- 强制 Python 以本机原生架构(arm64)运行，避免 pydantic_core 架构不兼容 ---
export ARCHPREFERENCE="arm64"
RUN_ARCH=""
command -v arch >/dev/null 2>&1 && RUN_ARCH="arch -arm64"

PY_BIN=""
# --- 找 python3 (优先 Frameworks 版本) ---
for c in "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3" "/usr/local/bin/python3" "/opt/homebrew/bin/python3" "/usr/bin/python3"; do
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then
    if $RUN_ARCH "$c" --version 2>/dev/null | grep -q "Python 3"; then
      PY_BIN="$c"
      break
    fi
  fi
done
[ -z "$PY_BIN" ] && PY_BIN="$(command -v python3 || command -v python)"

# --- 找 npx 绝对路径 ---
NPX_BIN="$(command -v npx 2>/dev/null || echo /usr/local/bin/npx)"

# --- 端口占用检测复用 ---
port_in_use() {
  (echo > /dev/tcp/127.0.0.1/$1) >/dev/null 2>&1
}

# --- 清空旧日志 ---
: > "$LOG"

echo "[启动] 时间: $(date)" >> "$LOG"
echo "[启动] Python: $PY_BIN" >> "$LOG"
echo "[启动] npx: $NPX_BIN" >> "$LOG"
echo "[启动] arch: $(uname -m), RUN_ARCH='$RUN_ARCH'" >> "$LOG"
echo "[启动] 项目: $PROJ" >> "$LOG"

# --- 启动 FastAPI 后端 ---
if port_in_use $BACK_PORT; then
  echo "[后端] $BACK_PORT 已占用，复用现有后端" >> "$LOG"
else
  cd "$PROJ"
  echo "[后端] 启动: $RUN_ARCH $PY_BIN -m uvicorn app:app --port $BACK_PORT" >> "$LOG"
  nohup $RUN_ARCH "$PY_BIN" -m uvicorn app:app --host 127.0.0.1 --port $BACK_PORT >> "$BACK_LOG" 2>&1 &
  BACK_PID=$!
  echo "[后端] 启动 PID=$BACK_PID, 等待就绪..." >> "$LOG"
  for _ in {1..60}; do
    port_in_use $BACK_PORT && { echo "[后端] 就绪 ✓" >> "$LOG"; break; }
    sleep 0.5
  done
fi

# --- 启动 Vite 前端 dev server ---
if port_in_use $FRONT_PORT; then
  echo "[前端] $FRONT_PORT 已占用，复用现有服务" >> "$LOG"
else
  cd "$FRONT_DIR"
  echo "[前端] 启动: $NPX_BIN vite --port $FRONT_PORT" >> "$LOG"
  nohup "$NPX_BIN" vite --host 127.0.0.1 --port $FRONT_PORT >> "$FRONT_LOG" 2>&1 &
  FRONT_PID=$!
  echo "[前端] 启动 PID=$FRONT_PID, 等待就绪..." >> "$LOG"
  for _ in {1..60}; do
    port_in_use $FRONT_PORT && { echo "[前端] 就绪 ✓" >> "$LOG"; break; }
    sleep 0.5
  done
fi

# --- 打开浏览器 ---
sleep 1
open "$FRONT_URL"
echo "[启动] 已打开浏览器: $FRONT_URL" >> "$LOG"
exit 0
