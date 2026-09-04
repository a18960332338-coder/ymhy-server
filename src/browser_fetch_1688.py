#!/usr/bin/env python3
"""1688 商品页真实浏览器渲染抓取（headful 真实 Chrome，用户手动过 x5sec 验证码）。

用 Playwright 自己启动/管理一个 headful 真实 Chrome（channel="chrome"，自动 --no-sandbox，
协议兼容本机 Chrome 版本），加载商品页后轮询等待用户拖滑块过验证码；cookie 通过
user-data-dir 持久化（同一 profile 复用，过了一次后后续通常不再弹验证码）。

用法:
  browser_fetch_1688.py <url> [--user-data-dir <path>] [--timeout <秒>]
输出 (stdout): 渲染后的完整 HTML（失败写 stderr，exit code 非 0）
"""
from __future__ import annotations

import argparse
import os
import sys
import time

from playwright.sync_api import sync_playwright


def _passed(page) -> bool:
    """判断是否已离开验证码拦截页（过码成功）。"""
    try:
        url = page.url or ""
        title = (page.title() or "").strip()
        # 仍处验证码拦截页的典型特征
        if "_____tmd_____/punish" in url or "x5secdata" in url:
            return False
        if "验证码" in title or title in ("验证码拦截", "验证", ""):
            return False
        return True
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--user-data-dir", required=True)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--poll-interval", type=float, default=2.0)
    args = ap.parse_args()

    os.makedirs(args.user_data_dir, exist_ok=True)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=args.user_data_dir,
            channel="chrome",
            headless=False,  # headful：用户能看到窗口手动拖滑块
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:  # noqa: BLE001
            print(f"goto warn: {type(e).__name__}", file=sys.stderr)

        deadline = time.time() + args.timeout
        ok = False
        while time.time() < deadline:
            time.sleep(args.poll_interval)
            if _passed(page):
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                ok = True
                break
            print(
                f"[waiting] url={page.url[:70]} title={(page.title() or '')[:30]!r}",
                file=sys.stderr,
            )

        if not ok:
            print(f"error: 等待验证码通过超时（{args.timeout}s）。请在 Chrome 窗口拖动滑块完成验证", file=sys.stderr)
            try:
                ctx.close()
            except Exception:
                pass
            return 2

        html = page.content()
        try:
            ctx.close()
        except Exception:
            pass
        sys.stdout.write(html)
        sys.stdout.flush()
        return 0


if __name__ == "__main__":
    sys.exit(main())