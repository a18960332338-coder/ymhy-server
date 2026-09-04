@echo off
REM ==============================================================
REM   云眠花园主图生成工具 —— 一键启动脚本 (Windows)
REM   用法: 双击本文件即可
REM ==============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title 云眠花园 · 启动器

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo.
echo 🌿  云眠花园 · 一键启动
echo ───────────────────────────────────────
echo   项目目录: %SCRIPT_DIR%
echo.

REM —— 1. 检查 Python 3 ——
where py -3 >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo ❌  没找到 Python 3
    echo.
    echo 请先安装 Python 3.10+:
    echo   下载页: https://www.python.org/downloads/
    echo   安装时记得勾选 [√] Add Python to PATH
    echo.
    pause
    exit /b 1
  ) else (
    set "PY=python"
  )
) else (
  set "PY=py -3"
)
for /f "delims=" %%i in ('%PY% --version 2^>^&1') do set PY_VER=%%i
echo ✔ Python: %PY_VER%

REM —— 2. 虚拟环境（.venv）——
set "VENV_DIR=%SCRIPT_DIR%.venv"
if not exist "%VENV_DIR%\Scripts\python.exe" (
  echo.
  echo 🧱  第一次启动，正在创建虚拟环境 .venv\ （约 10 秒）…
  %PY% -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo ❌  创建虚拟环境失败，请手动执行：%PY% -m venv .venv
    pause
    exit /b 1
  )
  echo ✔ 虚拟环境创建完成
)
set "PY_VENV=%VENV_DIR%\Scripts\python.exe"
set "PIP_VENV=%VENV_DIR%\Scripts\pip.exe"

REM —— 3. 安装依赖（按 requirements.txt 时间戳）——
set "INSTALLED_MARK=%VENV_DIR%\.installed_ok"
set "REQS_FILE=%SCRIPT_DIR%requirements.txt"
set NEED_INSTALL=0
if not exist "%INSTALLED_MARK%" set NEED_INSTALL=1
if exist "%INSTALLED_MARK%" if "%REQS_FILE%" neq "%INSTALLED_MARK%" (
  for %%R in ("%REQS_FILE%") do for %%I in ("%INSTALLED_MARK%") do (
    if %%~tR gtr %%~tI set NEED_INSTALL=1
  )
)
if "%NEED_INSTALL%"=="1" (
  echo.
  echo 📦  正在安装 Python 依赖（首次约 1~3 分钟）…
  "%PIP_VENV%" install --upgrade pip >nul
  "%PIP_VENV%" install -r "%REQS_FILE%"
  if errorlevel 1 (
    echo ❌  依赖安装失败，请检查网络后再试
    pause
    exit /b 1
  )
  echo. > "%INSTALLED_MARK%"
  echo ✔ 依赖安装完成
)

REM —— 4. .env 环境变量文件 ——
set "ENV_FILE=%SCRIPT_DIR%.env"
set "ENV_EXAMPLE=%SCRIPT_DIR%.env.example"
if not exist "%ENV_FILE%" (
  if exist "%ENV_EXAMPLE%" (
    copy "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
    echo.
    echo ⚠️  已自动创建 .env 文件
    echo    请用记事本打开: %ENV_FILE%
    echo    把  NANO_BANANA_API_KEY=xxx  改成你自己的 NanoBanana API Key
    echo.
    echo    填完之后请回到本窗口按回车继续。
    echo    （如果现在不想填，直接按回车也能启动，只是合成功能不可用。）
    echo.
    pause
  ) else (
    echo.
    echo ⚠️  没找到 .env 或 .env.example。若要使用合成功能，请手动创建 .env 并填入 NANO_BANANA_API_KEY。
  )
)

set APP_HOST=127.0.0.1
set APP_PORT=8000
if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,2 delims=^=" %%a in (`findstr /r /c:"^[ ]*APP_HOST[ ]*=" "%ENV_FILE%"`) do (
    set "v=%%b"
    set APP_HOST=!v: =!
  )
  for /f "usebackq tokens=1,2 delims=^=" %%a in (`findstr /r /c:"^[ ]*APP_PORT[ ]*=" "%ENV_FILE%"`) do (
    set "v=%%b"
    set APP_PORT=!v: =!
  )
)

REM —— 5. 检查前端 dist ——
set "DIST_INDEX=%SCRIPT_DIR%web\app\dist\index.html"
if not exist "%DIST_INDEX%" (
  echo.
  echo ⚠️  前端打包产物不存在: %DIST_INDEX%
  echo.
  where npm >nul 2>nul
  if not errorlevel 1 (
    echo 检测到本机有 npm，尝试自动 build（需要 Node.js 18+）…
    pushd "%SCRIPT_DIR%web\app"
    call npm install --no-audit --no-fund
    call npm run build
    set BUILD_RC=%ERRORLEVEL%
    popd
    if "%BUILD_RC%" neq "0" (
      echo ❌  前端 build 失败，请检查网络；或让朋友打包一份 dist\ 给你。
      pause
      exit /b 1
    )
  ) else (
    echo ❌  本机没装 npm/node，无法自动 build。
    echo    请让发你的人先执行：cd web\app ^&^& npm install ^&^& npm run build
    echo    然后把整个项目（包含 web\app\dist\）重新发给你。
    echo.
    pause
    exit /b 1
  )
)

REM —— 6. 启动 uvicorn ——
set "URL=http://%APP_HOST%:%APP_PORT%"
echo.
echo ───────────────────────────────────────
echo 🚀 启动服务:  %URL%
echo 📁 项目目录:  %SCRIPT_DIR%
echo 🐍 Python:    %PY_VENV%
echo    关闭服务请在本窗口按  Ctrl + C
echo ───────────────────────────────────────
echo.

set "LOG_FILE=%VENV_DIR%\uvicorn.log"
type nul > "%LOG_FILE%"

REM 后台启动并记录 PID
start /B "" "%PY_VENV%" "%SCRIPT_DIR%app.py" > "%LOG_FILE%" 2>&1
REM 等 3 秒再探活
timeout /t 3 /nobreak >nul

REM 试下 HTTP 看是否起来（用 PowerShell 更稳）
powershell -NoProfile -Command "$done=$false; 1..20 | %% { try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%URL%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { $done=$true; break } } catch {} ; Start-Sleep -Milliseconds 500 }; exit (-not [int]$done)"
set HTTP_OK=%ERRORLEVEL%

if "%HTTP_OK%"=="0" (
  echo ✔ 服务已启动
  echo.
  echo   👉 在浏览器打开: %URL%
  echo   （如果没有自动弹出浏览器，请手动复制上面的地址）
  echo.
  REM 自动打开浏览器
  start "" "%URL%"
  echo   （要关闭服务，请回到本窗口按 Ctrl+C）
  echo.
  REM 保持窗口不退出，直到 Ctrl+C
  pause
  REM 退出时杀掉 app.py（不完美但够用）
  wmic process where "commandline like '%%app.py%%'" delete >nul 2>nul
  exit /b 0
) else (
  echo ❌  启动失败，最近 50 行日志：
  powershell -NoProfile -Command "Get-Content '%LOG_FILE%' -Tail 50"
  echo.
  echo 常见原因：端口 8000 被占用 → 改 .env 里的 APP_PORT 换一个；或关掉占用 8000 的程序。
  echo.
  pause
  exit /b 1
)
