#!/usr/bin/env python3
"""1688 长驻浏览器守护进程（在装了 playwright 的 venv 中运行）。

核心目的：保持一个真实 Chrome（channel="chrome", headful）【常驻】，复用同一会话里的
cookie / 登录态；用户只需在弹出的窗口里【登录一次 / 过一次验证码】，之后所有解析请求复用
该浏览器，不再每条链接都重新验证。

与旧 browser_fetch_1688.py 的区别：旧脚本每次调用都新起一个 Chrome 并在结束时 ctx.close()，
导致每解析一条都要重新过码、效率极低。本守护进程只启动一次浏览器、一直开着，所有 /fetch
请求都在同一个 context / page 上导航，会话与 cookie 全程保留。

HTTP API（默认 127.0.0.1:9333）：
  POST /fetch   {"url": "...", "timeout": 180} -> {"ok": bool, "html": str, "title": str, "url": str, "error": str}
  POST /login   {}                              -> {"ok": bool, "title": str, "url": str}   （打开 1688 登录页供用户登录一次）
  POST /status  {}                              -> {"ok": bool, "alive": bool, "has_browser": bool, "title": str, "url": str}
  POST /close   {}                              -> {"ok": bool}   （关闭常驻浏览器，下次 /fetch 会重新拉起）

环境变量：
  BROWSER_DAEMON_PORT  监听端口，默认 9333
  BROWSER_DAEMON_UDD   Chrome profile 目录（持久化 cookie），默认 ~/Library/Caches/CloudSleepGarden/chrome-1688
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


PORT = int(os.environ.get("BROWSER_DAEMON_PORT", "9333"))
USER_DATA_DIR = os.path.expanduser(
    os.environ.get("BROWSER_DAEMON_UDD", "~/Library/Caches/CloudSleepGarden/chrome-1688")
)

# 单 worker 线程独占浏览器对象（Playwright sync API 要求同一线程操作）
_jobs: "queue.Queue" = queue.Queue()
_results: dict = {}          # job_id -> (threading.Event, dict_holder)
_results_lock = threading.Lock()
_job_counter = 0
_job_counter_lock = threading.Lock()

# 浏览器单例状态（仅 worker 线程读写）
_state = {
    "pw": None,
    "browser": None,   # chromium persistent context
    "page": None,
}


def _log(msg: str) -> None:
    sys.stderr.write(f"[browser_daemon] {msg}\n")
    sys.stderr.flush()


def _passed(page) -> bool:
    """判断是否已离开验证码拦截页（过码 / 已登录放行）。"""
    try:
        url = page.url or ""
        title = (page.title() or "").strip()
        if "_____tmd_____/punish" in url or "x5secdata" in url:
            return False
        if "验证码" in title or title in ("验证码拦截", "验证", ""):
            return False
        return True
    except Exception:
        return False


def _launch():
    """(重新)启动常驻浏览器，返回一个可用 page。会先关闭旧的 browser/pw（若还活着）。"""
    old = _state["browser"]
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
    old_pw = _state["pw"]
    if old_pw is not None:
        try:
            old_pw.stop()
        except Exception:
            pass
    _state.update(pw=None, browser=None, page=None, last_url="", last_title="")
    _log("launching persistent Chrome ...")
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=USER_DATA_DIR,
        channel="chrome",
        headless=False,  # 必须 headless=False（真实窗口）：用户要能看到窗口登录/拖滑块
        viewport={"width": 1280, "height": 900},
        locale="zh-CN",
        args=["--disable-blink-features=AutomationControlled"],
    )
    ctx.add_init_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    _state.update(pw=pw, browser=ctx, page=page)
    _log(f"Chrome ready, profile={USER_DATA_DIR}")
    return page


def _get_page():
    """返回一个可用的 page：原 page 关闭则复用/新建；浏览器挂了则重新 launch。

    cookie 已持久化到 user_data_dir，重新 launch 后会自动恢复登录态。
    """
    ctx = _state["browser"]
    page = _state["page"]
    if ctx is not None:
        try:
            if page is not None and not page.is_closed():
                return page
            for pg in ctx.pages:
                if not pg.is_closed():
                    _state["page"] = pg
                    return pg
            pg = ctx.new_page()
            _state["page"] = pg
            return pg
        except Exception:  # noqa: BLE001 - context 可能已挂
            pass
    return _launch()


def _goto_with_recovery(url: str):
    """导航到 url；若 page/浏览器被用户关闭，自动重建后重试一次。失败返回 None。"""
    page = _get_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        return page
    except Exception as e:  # noqa: BLE001
        _log(f"goto warn: {type(e).__name__}，尝试重建浏览器后重试")
        try:
            page = _launch()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            return page
        except Exception as e2:  # noqa: BLE001
            _log(f"goto retry warn: {type(e2).__name__}")
            return None


def _do_fetch(url: str, timeout: int) -> dict:
    page = _goto_with_recovery(url)
    if page is None:
        return {"ok": False, "error": "浏览器不可用（页面被关闭且重建失败）"}
    deadline = time.time() + timeout
    ok = False
    while time.time() < deadline:
        time.sleep(2)
        if _passed(page):
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            ok = True
            break
        _log(f"[waiting] url={page.url[:70]} title={(page.title() or '')[:30]!r}")
    if not ok:
        return {"ok": False, "error": f"等待验证超时（{timeout}s），请在 Chrome 窗口完成登录/拖滑块"}
    _state["last_url"] = page.url
    _state["last_title"] = page.title()
    return {"ok": True, "html": page.content(), "title": page.title(), "url": page.url}


def _do_login() -> dict:
    page = _goto_with_recovery("https://login.1688.com/")
    if page is None:
        return {"ok": False, "error": "浏览器不可用（页面被关闭且重建失败）"}
    _state["last_url"] = page.url
    _state["last_title"] = page.title()
    return {"ok": True, "title": page.title(), "url": page.url}


def _do_close() -> dict:
    try:
        if _state["browser"] is not None:
            _state["browser"].close()
    except Exception as e:  # noqa: BLE001
        _log(f"close warn: {e}")
    _state.update(pw=None, browser=None, page=None)
    return {"ok": True}


def _do_status() -> dict:
    # 注意：不能在这里调用 page.title()/page.url()，Playwright 对象非线程安全
    # （page 属于 worker 线程）。只读取普通字段，标题/URL 由 worker 在处理时回写。
    return {
        "ok": True,
        "alive": True,
        "has_browser": _state["browser"] is not None,
        "title": _state.get("last_title", "") or "",
        "url": _state.get("last_url", "") or "",
    }


def _worker() -> None:
    """单线程串行处理所有浏览器操作（保证 Playwright 同线程）。"""
    while True:
        job = _jobs.get()
        if job is None:
            break
        job_id, action, payload = job
        try:
            if action == "fetch":
                res = _do_fetch(payload.get("url", ""), int(payload.get("timeout", 180)))
            elif action == "login":
                res = _do_login()
            elif action == "close":
                res = _do_close()
            else:
                res = {"ok": False, "error": f"unknown action: {action}"}
        except Exception as e:  # noqa: BLE001
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        with _results_lock:
            ev, holder = _results.pop(job_id, (None, None))
        if ev is not None:
            holder["v"] = res
            ev.set()


class _Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}

        path = self.path.split("?")[0].rstrip("/")
        action = path.lstrip("/") or "status"

        # status 只读、不走 worker 队列，避免被长任务阻塞
        if action == "status":
            self._send(_do_status())
            return

        with _job_counter_lock:
            global _job_counter
            _job_counter += 1
            job_id = _job_counter
        ev = threading.Event()
        holder: dict = {}
        with _results_lock:
            _results[job_id] = (ev, holder)
        _jobs.put((job_id, action, payload))

        if not ev.wait(timeout=320):
            self._send({"ok": False, "error": "daemon busy/timeout"}, 504)
            return
        self._send(holder.get("v", {"ok": False, "error": "no result"}))

    def log_message(self, *a):  # noqa: ANN001, ANN002
        pass


def main() -> None:
    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), _Handler)
    _log(f"listening on 127.0.0.1:{PORT} (udd={USER_DATA_DIR})")
    try:
        srv.serve_forever()
    except OSError as e:
        _log(f"serve_forever failed: {e}（可能端口已被其它实例占用，复用即可）")
        sys.exit(0)


if __name__ == "__main__":
    main()
