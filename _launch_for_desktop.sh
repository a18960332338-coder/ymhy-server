#!/bin/bash
# ============================================================
# 云眠花园 · 桌面 App 启动逻辑 (供桌面 .app 里的 AppleScript 调用)
# 行为:
#   - 如果 8000 没在监听: 启动 python app.py 后台, 等待端口就绪 (最多 45s)
#   - 如果 8000 已经在监听: 直接复用
# 输出 (stdout):
#   OK:http://127.0.0.1:8000        -> 启动成功 / 复用成功
#   ERR:<描述> ... + 尾部日志      -> 启动失败
# exit code: 0 成功 / 1 失败
# ============================================================
set +e
PROJ_ABS="/Users/chenshiyi/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/work-mode-projects/6a745b7b54ccba0edba6c766"
PY_BIN="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
APP_PORT=8000
APP_HOST="127.0.0.1"
LOG_FILE="/tmp/yunmian-garden-desktop.log"
PID_FILE="/tmp/yunmian-garden-desktop.pid"

# 清旧日志
: > "$LOG_FILE" 2>/dev/null
rm -f "$PID_FILE" 2>/dev/null

# 1) 端口占用检测
port_in_use() {
  /usr/sbin/lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

if port_in_use "$APP_PORT"; then
  # 已经在监听 —— 直接复用, 但先尝试发一次 /api/health 确认不是僵尸
  OK=0
  for _ in 1 2 3; do
    if curl -s --max-time 2 "http://${APP_HOST}:${APP_PORT}/api/health" >/dev/null 2>&1; then
      OK=1
      break
    fi
    sleep 0.3
  done
  if [ "$OK" = "1" ]; then
    echo "OK:http://${APP_HOST}:${APP_PORT}"
    exit 0
  else
    echo "WARN:8000 有进程在监听但 /api/health 不通，准备杀掉旧进程再重新启动..."
    OLD_PIDS=$(/usr/sbin/lsof -tiTCP:"$APP_PORT" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$OLD_PIDS" ]; then
      kill $OLD_PIDS 2>/dev/null
      sleep 0.8
      kill -9 $OLD_PIDS 2>/dev/null
      sleep 0.5
    fi
  fi
fi

# 2) 启动新后端
cd "$PROJ_ABS" || {
  echo "ERR:项目目录不存在或无权限: $PROJ_ABS"
  exit 1
}

if [ ! -x "$PY_BIN" ]; then
  echo "ERR:Python 不存在或不可执行: $PY_BIN
请重新安装 Python 3.10+ (推荐官网 pkg 安装到 /Library/Frameworks/Python.framework/)"
  exit 1
fi

nohup "$PY_BIN" app.py > "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

# 3) 等待端口就绪 (最多 45 秒, 每 0.5 秒探一次 => 90 次)
READY=0
for i in $(seq 1 90); do
  sleep 0.5
  # 先判进程还活着吗
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "ERR:后端进程已退出 (PID=$APP_PID)。最近日志:"
    echo "----"
    tail -n 30 "$LOG_FILE" 2>/dev/null || echo "(无日志)"
    echo "----
请检查:
· 依赖是否已安装: 在终端执行 $PY_BIN -m pip install -r requirements.txt
· 8000 端口是否被其他程序占用: lsof -iTCP:8000 -sTCP:LISTEN
· config.yaml 是否被篡改"
    exit 1
  fi
  if port_in_use "$APP_PORT"; then
    READY=1
    break
  fi
done

if [ "$READY" != "1" ]; then
  echo "ERR:45 秒内端口 $APP_PORT 仍未就绪。最近日志:"
  echo "----"
  tail -n 30 "$LOG_FILE" 2>/dev/null || echo "(无日志)"
  echo "----
请检查:
· 依赖是否已安装
· Python 是否是 arm64 原生 (非 Rosetta), 避免 pydantic 等库的架构不兼容
· 8000 端口是否被防火墙拦截"
  exit 1
fi

# 4) 再额外确认 /api/health 通 (uvicorn 启动完但应用还没 ready 的概率很低, 但再保险一下)
API_OK=0
for _ in $(seq 1 20); do
  if curl -s --max-time 2 "http://${APP_HOST}:${APP_PORT}/api/health" >/dev/null 2>&1; then
    API_OK=1
    break
  fi
  sleep 0.3
done
if [ "$API_OK" != "1" ]; then
  echo "ERR:端口就绪但 /api/health 仍然不通。最近日志:"
  echo "----"
  tail -n 30 "$LOG_FILE" 2>/dev/null || echo "(无日志)"
  exit 1
fi

echo "OK:http://${APP_HOST}:${APP_PORT}"
exit 0
