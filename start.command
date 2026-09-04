#!/bin/bash
# ==============================================================
# 云眠花园主图生成工具 —— 一键启动脚本 (macOS / Linux)
# 用法: 终端里 chmod +x start.command 然后双击即可
# ==============================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# —— 颜色 ——
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo -e "${CYAN}🌿  云眠花园 · 一键启动${NC}"
echo "───────────────────────────────────────"
echo "  脚本目录: $SCRIPT_DIR"
echo ""

# —— 1. 检查 Python 3 ——
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ 没找到 python3 命令${NC}"
    echo ""
    echo "请先安装 Python 3.10+ ："
    echo "  macOS  : https://www.python.org/downloads/   或者  brew install python"
    echo "  Ubuntu : sudo apt install python3 python3-venv python3-pip"
    echo ""
    read -rp "按回车退出…" _
    exit 1
fi
PY_VER="$(python3 --version 2>&1)"
echo -e "${GREEN}✔ Python:${NC} $PY_VER"

# —— 2. 虚拟环境（.venv） ——
VENV_DIR="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo -e "${YELLOW}🧱 第一次启动，正在创建虚拟环境 .venv/ （约 10 秒）…${NC}"
    python3 -m venv "$VENV_DIR"
    echo -e "${GREEN}✔ 虚拟环境创建完成${NC}"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# —— 3. 安装依赖（根据 requirements.txt 的时间戳增量安装） ——
INSTALLED_MARK="$VENV_DIR/.installed_ok"
REQS_FILE="$SCRIPT_DIR/requirements.txt"
NEED_INSTALL=0
if [ ! -f "$INSTALLED_MARK" ]; then
    NEED_INSTALL=1
elif [ "$REQS_FILE" -nt "$INSTALLED_MARK" ]; then
    NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = "1" ]; then
    echo ""
    echo -e "${YELLOW}📦 正在安装 Python 依赖（首次安装约 1~3 分钟）…${NC}"
    pip install --upgrade pip > /dev/null
    pip install -r "$REQS_FILE"
    touch "$INSTALLED_MARK"
    echo -e "${GREEN}✔ 依赖安装完成${NC}"
fi

# —— 4. 环境变量文件 (.env) ——
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        echo ""
        echo -e "${YELLOW}⚠️  已自动创建 .env 文件${NC}"
        echo -e "   请用文本编辑器打开: ${CYAN}$ENV_FILE${NC}"
        echo -e "   把 ${CYAN}NANO_BANANA_API_KEY=xxx${NC} 改成你自己的 NanoBanana API Key"
        echo -e "   填完之后按回车继续（如果现在不想填，直接按回车也能启动，只是合成功能不可用）…"
        read -rp "" _
    else
        echo ""
        echo -e "${YELLOW}⚠️  没找到 .env 或 .env.example。若要使用合成功能，请手动创建 .env 并填入 NANO_BANANA_API_KEY。${NC}"
    fi
fi

# 读取 HOST / PORT（默认 127.0.0.1:8000）
APP_HOST="127.0.0.1"
APP_PORT="8000"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC2002
    ENV_HOST="$(cat "$ENV_FILE" | grep -E '^[[:space:]]*APP_HOST[[:space:]]*=' | tail -n1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//')"
    ENV_PORT="$(cat "$ENV_FILE" | grep -E '^[[:space:]]*APP_PORT[[:space:]]*=' | tail -n1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//')"
    [ -n "$ENV_HOST" ] && APP_HOST="$ENV_HOST"
    [ -n "$ENV_PORT" ] && APP_PORT="$ENV_PORT"
fi

# —— 5. 检查前端 dist ——
DIST_INDEX="$SCRIPT_DIR/web/app/dist/index.html"
if [ ! -f "$DIST_INDEX" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  前端打包产物不存在: ${DIST_INDEX}${NC}"
    echo "   可能原因：你收到的项目包没包含 dist/，或者你想最新 build 一次。"
    echo ""
    if command -v npm &> /dev/null; then
        echo -e "检测到本机装了 npm，将尝试自动 build（需要 Node.js 18+）…"
        (cd "$SCRIPT_DIR/web/app" && npm install --no-audit --no-fund && npm run build) || {
            echo -e "${RED}❌ 前端 build 失败，请检查网络后再试；或者让朋友打包一份 dist/ 给你。${NC}"
            read -rp "按回车退出…" _
            exit 1
        }
    else
        echo -e "${RED}❌ 本机没装 npm/node，无法自动 build。${NC}"
        echo "   请让发你的人先执行一遍：cd web/app && npm install && npm run build"
        echo "   然后把整个项目（包含 web/app/dist/）重新发给你。"
        echo ""
        read -rp "按回车退出…" _
        exit 1
    fi
fi

# —— 6. 启动 uvicorn ——
URL="http://${APP_HOST}:${APP_PORT}"
echo ""
echo "───────────────────────────────────────"
echo -e "🚀 启动服务:  ${CYAN}${URL}${NC}"
echo -e "📁 项目目录:  ${SCRIPT_DIR}"
echo -e "🐍 Python:    $(which python3)"
echo "   关闭服务请在本窗口按  Ctrl + C"
echo "───────────────────────────────────────"
echo ""

# 后台起 uvicorn，用 trap 捕获退出信号再杀，保证 Ctrl+C 干净退出
LOG_FILE="$SCRIPT_DIR/.venv/uvicorn.log"
: > "$LOG_FILE"
python3 "$SCRIPT_DIR/app.py" > "$LOG_FILE" 2>&1 &
APP_PID=$!
trap "echo -e '\n${YELLOW}🛑 正在停止服务…${NC}'; kill $APP_PID 2>/dev/null || true; wait 2>/dev/null; echo '已退出，再见 👋'; exit 0" INT TERM EXIT

# 给 uvicorn 3 秒启动
sleep 3

# 判断是否真的起来了
if kill -0 "$APP_PID" 2>/dev/null; then
    echo -e "${GREEN}✔ 服务已启动${NC}"
    echo ""
    echo -e "  👉 在浏览器打开: ${CYAN}${URL}${NC}"
    echo "  （如果没有自动弹出浏览器，请手动访问上面的地址）"
    echo ""
    # 自动打开浏览器
    sleep 1
    if command -v open &> /dev/null; then
        open "$URL" 2>/dev/null || true
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$URL" 2>/dev/null || true
    fi
    echo "  （要关闭服务，请回到本窗口按 Ctrl+C）"
    echo ""
    # 等用户 Ctrl+C
    wait "$APP_PID"
else
    echo -e "${RED}❌ 启动失败，最近 50 行日志：${NC}"
    tail -n 50 "$LOG_FILE" 2>/dev/null || echo "(日志文件不存在)"
    echo ""
    echo "常见原因：端口 8000 被占用 → 改 .env 里的 APP_PORT 换一个，或关掉占用 8000 的程序。"
    read -rp "按回车退出…" _
fi
