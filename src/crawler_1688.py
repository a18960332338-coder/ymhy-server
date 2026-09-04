"""1688主图爬取引擎 - API接入层。

按用户要求, 当前仅实现接入层骨架(stub):
  - 链接解析、API签名组装、图片下载与白底过滤均已实现;
  - 真正调用 1688 product.search.queryProductDetail 的部分在 alibaba.enabled=false 时
    直接走【HTML 兜底解析】（静态 HTML 抽取 + 常见全局状态 JSON 抽取 + 懒加载属性识别），
    无需 OpenAPI 即可正常使用；拿到 App Key/Secret/Access Token 后填入 config.yaml 并将
    enabled 改为 true, 再补全 _call_api 内的请求/响应解析即可启用真实 API。
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import requests

from .config import Config
from .image_utils import is_white_background

logger = logging.getLogger("crawler_1688")

# 常驻浏览器 daemon 子进程句柄（backend 拉起后跨请求复用；模块级单例）
_DAEMON_PROC: Optional[Any] = None

# 1688 / 阿里系常见图片域名（用于 HTML 兜底解析 + 质量过滤）
_ALI_IMAGE_DOMAINS = (
    "cbu01.alicdn.com",
    "img.alicdn.com",
    "ae01.alicdn.com",
    "s.alicdn.com",
    "img.alibaba.com",
    "img.alicdn.com",
)

# 需要被视为"缩略小图"而跳过的尺寸模式（如果匹配到，不会加入到用户可选列表里）
_THUMB_SIZE_RE = re.compile(
    r"\.(?:30x30|40x40|50x50|60x60|80x80|100x100|120x120|150x150|160x160|200x200|"
    r"220x220|240x240|310x310|360x360|search|sum)\.[^.]+$",
    re.IGNORECASE,
)

# 常见 1688 图片 URL 中把"缩略尺寸"替换为大图（无尺寸后缀或 Q90 原图）的规则
def _to_big_image(url: str) -> str:
    """把 1688/cbu/ae 的缩略 URL 转成原图 URL（去掉 .NxN. / .search. / .sum. 等尺寸段）。"""
    if not url:
        return url
    # 把 ".60x60.jpg" / ".310x310.jpg" / ".search.jpg" 这种形式统一替换成 ".jpg"（原图）
    url2 = re.sub(
        r"\.(?:\d+x\d+|search|sum)(?=\.[^.]+(?:\?|$))",
        "",
        url,
        flags=re.IGNORECASE,
    )
    return url2


def parse_product_id(url: str) -> Optional[str]:
    """从 1688 商品链接中提取 offerId（兼容带 query、m.1688.com 以及 offer=xxx 参数写法）。"""
    m = re.search(r"offer[/=](\d+)", url)
    if m:
        return m.group(1)
    m2 = re.search(r"offerId=(\d+)", url, re.IGNORECASE)
    if m2:
        return m2.group(1)
    m3 = re.search(r"id=(\d{8,})", url, re.IGNORECASE)
    return m3.group(1) if m3 else None


class Crawler1688:
    def __init__(self, config: Config) -> None:
        self.config = config  # 持有完整 Config，便于读取 browser 段
        self.cfg = config.alibaba
        self.browser_cfg = getattr(config, "browser", {}) or {}
        self.crawled_dir: Path = config.crawled_dir
        self.session = requests.Session()
        # 桌面端 Chrome 128 UA（更像真实浏览器，带 Sec-Ch-Ua / Sec-Fetch / Referer 全套头
        # 降低被 1688 反爬直接拦截到 punish 页的概率）
        self._desktop_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,image/apng,*/*;q=0.8"
            ),
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"macOS"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Upgrade-Insecure-Requests": "1",
            "Referer": "https://www.1688.com/",
        }
        # 移动端 iPhone Safari UA（1688 的 m.1688.com 反爬强度明显弱于桌面版；
        # 当桌面版返回 _____tmd_____/punish 拦截页时，就切到移动版 URL + 这个 UA 重试）
        self._mobile_headers = {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh-Hans;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://m.1688.com/",
        }
        self.session.headers.update(self._desktop_headers)
        # 最近一次被 1688 风控拦截的类型（None/punish/captcha），供上层给出明确错误提示
        self.last_blocked: Optional[str] = None

    # ============ 公共入口 ============
    def crawl_batch(self, urls: List[str]) -> Dict[str, Dict[str, Any]]:
        """批量爬取, 返回 {product_id: {"images": [本地路径], "status": ..., "reason": ...}}。"""
        results: Dict[str, Dict[str, Any]] = {}
        for url in urls:
            pid = parse_product_id(url) or url
            try:
                imgs = self.crawl_one(url)
                results[pid] = {"images": imgs, "status": "ok" if imgs else "empty", "reason": ""}
                logger.info("[%s] 爬取完成, 图片数=%d", pid, len(imgs))
            except Exception as e:
                results[pid] = {"images": [], "status": "fail", "reason": str(e)}
                logger.warning("[%s] 爬取失败: %s", pid, e)
        return results

    def crawl_one(self, url: str) -> List[str]:
        """旧流程：一次性解析并下载全部主图（主流程不再使用，保留兼容）。"""
        sel = self.parse_images_for_selection(url)
        local_paths: List[str] = []
        for img in sel.get("images", []):
            from ._impl import _safe_name  # 延迟 import，避免循环
            ext = self._guess_ext(img["url"])
            out = self.crawled_dir / f"1688_{sel['product_id']}_{img['index']:02d}_{int(time.time())}{ext}"
            try:
                self.download_selected_image(img["url"], out)
                local_paths.append(str(out))
            except Exception:  # noqa: BLE001
                continue
        return local_paths

    def parse_images_for_selection(self, url: str, *, limit: int = 5) -> Dict[str, Any]:
        """只解析商品主图URL列表（不下载、不入库），供前端展示让用户选择。

        返回结构:
          {
            "product_id": str,
            "title": str,
            "images": [
              {"index": 1, "url": str, "thumb_url": str | None}
            ]
          }

        参数:
          limit: 返回多少张主图（默认按用户要求只取前 5 张）
        """
        pid = parse_product_id(url)
        if not pid:
            raise ValueError(f"无法解析商品ID，请确认链接是否包含 offerId（如 https://detail.1688.com/offer/xxxxxx.html）: {url}")

        image_urls: List[str] = []
        title = ""

        # 1) 优先 OpenAPI（如果启用了）
        if self.cfg.get("enabled", False):
            try:
                image_urls = self.fetch_image_urls(pid)
            except Exception as e:  # noqa: BLE001
                logger.warning("1688 OpenAPI 调用失败，降级走 HTML 解析: %s", e)
                image_urls = []

        # 2) OpenAPI 没启用或返回空 → 走 HTML 兜底
        if not image_urls:
            image_urls, title = self._scrape_images_from_html(url)

        # 3) 统一去重 + 过滤掉明显是缩略小图的 URL + 转大图 URL
        dedup: List[str] = []
        seen = set()
        for u in image_urls:
            if not u:
                continue
            if _THUMB_SIZE_RE.search(u):
                # 缩略尺寸后缀：尝试转大图
                u = _to_big_image(u)
                # 如果转换后还能匹配到更小的尺寸段（比如双重后缀），再过滤一次
                if _THUMB_SIZE_RE.search(u):
                    continue
            # 必须是 https?:// 绝对 URL
            if not u.startswith("http://") and not u.startswith("https://"):
                continue
            key = u.split("?", 1)[0]  # 去重忽略 query 差异
            if key in seen:
                continue
            seen.add(key)
            dedup.append(u)
        # 按用户需求：每个商品最多只保留前 limit 张主图（默认 5）
        image_urls = dedup[: max(0, limit)]

        images = []
        for idx, u in enumerate(image_urls, start=1):
            thumb = self._to_thumb(u)
            images.append({"index": idx, "url": u, "thumb_url": thumb})
        return {
            "product_id": pid,
            "title": title,
            "images": images,
            "blocked": bool(self.last_blocked),
            "blocked_reason": self.last_blocked or "",
        }

    def download_selected_image(
        self,
        image_url: str,
        out_path: Path,
        *,
        skip_white_filter: bool = True,
    ) -> Path:
        """按用户选择下载一张图片到指定路径。

        Args:
          skip_white_filter: 默认 True，跳过白底过滤（因为是用户预览后主动保存的
            商品场景图，1688 大多数不是纯白底，保留原图即可）。旧批量爬取流程
            如需保留过滤，显式传 False。
        """
        # 下载前尝试转大图（用户可能选到了缩略图版本）
        big_url = _to_big_image(image_url)
        ok = self._download(big_url, out_path, skip_white_filter=skip_white_filter)
        if not ok:
            # 大图失败，回退原始 URL
            ok = self._download(image_url, out_path, skip_white_filter=skip_white_filter)
        if not ok:
            raise RuntimeError(f"下载失败或被白底过滤: {image_url}")
        return out_path

    # ============ HTML 兜底解析（API未启用/失败时抓HTML主图）============
    def _scrape_images_from_html(self, url: str) -> Tuple[List[str], str]:
        """从商品页面 HTML 抽取主图 URL + 商品标题。

        抓取策略（四层降级，每一步命中都会写 INFO 日志方便后端查 0 图原因）：
          1) 桌面版 detail.1688.com：带完整 Chrome 128 头 + Sec-*；如果命中
             punish/x5secdata 或 body<5KB 无 alicdn，判定为风控拦截页。
          2) 切移动版 m.1688.com/offer/<PID>.html：如果移动版也跳 punish 或
             跳 show.1688.com/...404/「商品无法查看或已下架」，判定为移动端
             不可用（商品确实下架/私密）。
          3) 解析 <script type="application/ld+json">（2025 年 1688 桌面版新
             结构，主图直接写在 @type=Product 的 image 数组里）。
          4) 其它常见抽取（og:image / img data-* / img src alicdn / 全局 JSON
             递归 / 整页阿里系图片 URL 正则兜底）。
        """
        pid = parse_product_id(url)

        # -------- step 1: 尝试桌面版（原始 URL） --------
        html = self._fetch_html(url, self._desktop_headers)
        desktop_punish = self._html_is_punish(html)
        logger.info(
            "[offer=%s] desktop fetch len=%d punish=%s url=%s",
            pid, len(html or ""), desktop_punish, url[:120],
        )
        if html and desktop_punish and pid:
            # -------- step 2: 被 punish → 切到移动版 m.1688.com/offer/<pid>.html 重试 --------
            mobile_url = f"https://m.1688.com/offer/{pid}.html"
            mobile_html = self._fetch_html(mobile_url, self._mobile_headers)
            mobile_punish = self._html_is_punish(mobile_html)
            mobile_404 = False
            if mobile_html:
                t = re.search(r"<title[^>]*>([^<]{0,300})</title>", mobile_html, re.I)
                title_s = (t.group(1) if t else "").strip()
                if ("OFFER_IS_NOT_EXSIT" in mobile_html or "404" in mobile_html[:3000] or
                        "无法查看或已下架" in title_s):
                    mobile_404 = True
            logger.info(
                "[offer=%s] mobile fetch len=%s punish=%s 404=%s",
                pid, len(mobile_html or "") if mobile_html else 0, mobile_punish, mobile_404,
            )
            if mobile_html and not mobile_punish and not mobile_404:
                html = mobile_html
            elif mobile_html and not mobile_punish and mobile_404:
                # 移动版不是 punish 但跳了 404（商品下架/私密），仍然拿这份 HTML 抽
                # （可能 og:image 或 JSON 里能拿到首图），但标记一下
                html = mobile_html
                logger.warning("[offer=%s] 移动版返回商品已下架/404 页面，继续尽力抽取", pid)

        if not html:
            return [], ""

        # -------- 浏览器兜底：requests 桌面版 + 移动版都被风控时，用真实 Chrome 渲染过 x5sec --------
        #  首次会触发滑块验证码，由用户在 headful Chrome 窗口手动拖动；cookie 写入 user-data-dir 复用。
        if self._html_is_punish(html):
            browser_html = self._fetch_via_browser(url)
            if browser_html and not self._html_is_punish(browser_html):
                logger.info("[offer=%s] browser fallback succeeded, html_len=%d", pid, len(browser_html))
                html = browser_html
            else:
                logger.warning("[offer=%s] browser fallback unavailable or still punish", pid)

        urls: List[str] = []
        title = ""

        # -------- 0) 优先解析 JSON-LD（2025 年 1688 桌面版把主图写在 <script type=application/ld+json> 里）
        #    通常结构是 { "@context":"schema.org","@type":"Product","name":"xxx","image":["//img.alicdn.com/...","..."], ... }
        #    或者是 { "@graph":[{ "@type":"Product",... }] }
        ld_blob = None
        ld_m = re.search(
            r'<script\s+type=["\']application/ld\+json["\'][^>]*>([\s\S]{0,20000}?)</script>',
            html,
            re.IGNORECASE,
        )
        if ld_m:
            try:
                ld_blob = json.loads(ld_m.group(1).strip())
            except Exception:  # noqa: BLE001
                ld_blob = None
        if ld_blob:
            candidates = []
            if isinstance(ld_blob, list):
                candidates = ld_blob
            elif isinstance(ld_blob, dict):
                if "@graph" in ld_blob and isinstance(ld_blob["@graph"], list):
                    candidates = ld_blob["@graph"]
                else:
                    candidates = [ld_blob]
            for c in candidates:
                if not isinstance(c, dict):
                    continue
                t = str(c.get("@type") or "").lower()
                if not t.endswith("product"):
                    continue
                if not title:
                    name = c.get("name")
                    if isinstance(name, str) and name:
                        title = name.strip().split("【")[0].split("-")[0].strip()
                imgs = c.get("image") or []
                if isinstance(imgs, str):
                    imgs = [imgs]
                for u in imgs:
                    if isinstance(u, str) and u:
                        # JSON-LD 里经常写 "//img.alicdn.com/xxx.jpg"（无协议），补 https:
                        if u.startswith("//"):
                            u = "https:" + u
                        if u and u not in urls:
                            urls.append(u)
                break

        # -------- 标题 --------
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if not title and m:
            title = m.group(1).strip().split("【")[0].split("-")[0].strip()
        if not title:
            m2 = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html, re.IGNORECASE)
            if m2:
                title = m2.group(1).strip()

        # -------- 1) og:image --------
        m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html, re.IGNORECASE)
        if m:
            u = m.group(1).strip()
            if u.startswith("//"):
                u = "https:" + u
            if u and u not in urls:
                urls.append(u)

        # -------- 2) 常见 <img> 标签所有常见懒加载/自定义 data-* 属性 --------
        img_attr_pat = re.compile(
            r'<img[^>]+(?:data-original|data-src|data-img|data-bigimg|'
            r'data-lazy-src|data-lazyload|data-ks-lazyload|data-realsrc|'
            r'data-thumb|data-image|data-raw)="([^"]+(?:\.(?:jpg|jpeg|png|webp)[^"]*)?)"',
            re.IGNORECASE | re.DOTALL,
        )
        for mm in img_attr_pat.finditer(html):
            u = mm.group(1).strip()
            if u and u not in urls:
                urls.append(u)

        # -------- 3) <img src="http(s)://xxx.alicdn.com/..."> 只抓阿里系大图域名 --------
        src_pat = re.compile(
            r'<img[^>]+src="(https?://[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
            re.IGNORECASE | re.DOTALL,
        )
        for mm in src_pat.finditer(html):
            u = mm.group(1)
            # 必须包含阿里系图片域名（否则广告/页面装饰图也会被抓进来）
            if any(d in u for d in _ALI_IMAGE_DOMAINS) or "/imgextra/" in u:
                if ".60x60." in u or ".40x40." in u or ".search." in u:
                    continue
                if u not in urls:
                    urls.append(u)

        # -------- 4) 尝试解析 1688 页面常见全局 JSON 状态：window.xxx = {...} --------
        #   覆盖：__INITIAL_STATE__ / offerDetailData / data / iDetailData / offerInfo 等
        json_globals: List[Tuple[str, str]] = re.findall(
            r"window\.([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]*?\})\s*;?\s*</script>",
            html,
            flags=re.IGNORECASE,
        )
        # 兜底：script 中出现的 "imageUrls" / "picUrls" / "images" 纯数组 JSON（只要能 parse）
        arr_blobs: List[str] = re.findall(
            r'"(?:imageUrls|picUrls|images|mainImages|skuPics|detailPics)"\s*:\s*(\[[\s\S]{0,6000}?\])',
            html,
            flags=re.IGNORECASE,
        )
        all_imgs_from_json: List[str] = []
        for name, blob in json_globals:
            try:
                obj = json.loads(blob)
            except Exception:  # noqa: BLE001
                continue
            all_imgs_from_json.extend(self._extract_images_recursive(obj))
        for blob in arr_blobs:
            try:
                arr = json.loads(blob)
                if isinstance(arr, list):
                    all_imgs_from_json.extend(self._extract_images_recursive(arr))
            except Exception:  # noqa: BLE001
                continue
        for u in all_imgs_from_json:
            if isinstance(u, str) and u and u not in urls:
                urls.append(u)

        # -------- 5) 最兜底：扫描整个 HTML（含 <script> 内的 JSON）找所有阿里系图片 URL --------
        #    适配场景：1688 移动版 (m.1688.com) 会把主图 URL 写在 <script> 内的全局
        #    JSON 状态里，但不是标准 window.VAR = {...} 结构（可能被打包成立即执行函数
        #    或三元赋值等），上面第 4) 步抓不到；用简单字符串正则可以一网打尽。
        global_re = re.compile(
            r"(https?://[^\s\"'<>]+"
            r"(?:" + "|".join(re.escape(d) for d in _ALI_IMAGE_DOMAINS) + r"|/imgextra/|/img/ibank/)"
            r"[^\s\"'<>]*\.(?:jpg|jpeg|png|webp)[^\s\"'<>]*)",
            re.IGNORECASE,
        )
        for mm in global_re.finditer(html):
            u = mm.group(1)
            # 典型异常值清理：末尾带的分号、右括号、逗号、反斜杠等 JSON/代码符号
            u = re.sub(r"[;,\)\\\]]+$", "", u)
            if u and u not in urls:
                urls.append(u)

        logger.info(
            "[offer=%s] 最终抽取结果：候选图片 %d 张，title=%s",
            pid, len(urls), (title or "")[:100],
        )
        # 记录本次是否被风控拦截（供上层给出明确错误提示，而不是笼统的"没有发现主图"）
        if not urls:
            self.last_blocked = self._html_block_reason(html)
        else:
            self.last_blocked = None
        return urls, title

    # ---------- 辅助：用指定 headers 抓 HTML，错误吞掉返回 "" ----------
    def _fetch_html(self, url: str, headers: Dict[str, str]) -> str:
        try:
            r = self.session.get(url, timeout=30, allow_redirects=True, headers=headers)
            r.raise_for_status()
            return r.text or ""
        except Exception as e:  # noqa: BLE001
            logger.warning("1688 详情页抓取失败 [%s]: %s", url[:80], e)
            return ""

    # ---------- 辅助：判断一段 HTML 是否是 1688 的 punish 反爬校验页 ----------
    @staticmethod
    def _html_is_punish(html: str) -> bool:
        if not html:
            return True
        # 1688 punish 页的典型标志：脚本里会跳转到 /_____tmd_____/punish?x5secdata=...
        if "_____tmd_____/punish" in html or "x5secdata" in html:
            return True
        # 页面极小（< 5KB）且找不到任何 alicdn 域名痕迹：基本就是 punish / 空壳占位页
        if len(html) < 5000 and not any(d in html for d in _ALI_IMAGE_DOMAINS):
            return True
        return False

    # ---------- 辅助：识别 1688 拦截页的具体类型（punish / captcha），非拦截页返回 None ----------
    @staticmethod
    def _html_block_reason(html: str) -> Optional[str]:
        """区分 1688 风控拦截的类型：
          - captcha：需要验证码/滑块（window._config_={"action":"captcha",...} 或含 x5step）
          - punish：普通 JS 挑战拦截页（_____tmd_____/punish）
        非拦截页返回 None。"""
        if not html:
            return "网络/空响应"
        if "_____tmd_____/punish" in html or "x5secdata" in html:
            if 'captcha' in html or 'x5step' in html:
                return "captcha"
            return "punish"
        if len(html) < 5000 and not any(d in html for d in _ALI_IMAGE_DOMAINS):
            return "punish"
        return None

    # ---------- 浏览器兜底：常驻 Chrome daemon（登录/过码一次，后续复用，免重复验证）----------
    def _browser_enabled(self) -> bool:
        """检查 config.browser 是否配齐 python + user_data_dir，且解释器存在。"""
        py = (self.browser_cfg or {}).get("python", "")
        return bool(py) and os.path.exists(str(py))

    def _daemon_base(self) -> str:
        port = int((self.browser_cfg or {}).get("daemon_port", 9333))
        return f"http://127.0.0.1:{port}"

    def _daemon_alive(self) -> bool:
        try:
            req = urllib.request.Request(
                self._daemon_base() + "/status", data=b"{}", method="POST",
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception:  # noqa: BLE001
            return False

    def _ensure_daemon(self) -> bool:
        """daemon 未运行时，用 browser venv 的 python 拉起 browser_daemon.py 子进程。"""
        if self._daemon_alive():
            return True
        if not self._browser_enabled():
            return False
        global _DAEMON_PROC
        py = str((self.browser_cfg or {}).get("python", ""))
        port = int((self.browser_cfg or {}).get("daemon_port", 9333))
        user_data_dir = os.path.expanduser(str((self.browser_cfg or {}).get("user_data_dir", "")))
        script = str(Path(__file__).resolve().parent / "browser_daemon.py")
        env = dict(os.environ)
        env["BROWSER_DAEMON_PORT"] = str(port)
        env["BROWSER_DAEMON_UDD"] = user_data_dir
        log_path = "/tmp/yunmian-browser-daemon.log"
        try:
            proc = subprocess.Popen(
                [py, script],
                env=env,
                stdout=open(log_path, "a"),
                stderr=open(log_path, "a"),
                start_new_session=True,  # 脱离 backend 会话，backend 重启也不影响已登录的 daemon
            )
            _DAEMON_PROC = proc
            logger.info("browser daemon started pid=%s (port=%d)", proc.pid, port)
        except Exception as e:  # noqa: BLE001
            logger.warning("browser daemon start failed: %s", e)
            return False
        # 等待就绪（最多 15s）
        for _ in range(30):
            time.sleep(0.5)
            if self._daemon_alive():
                return True
        return self._daemon_alive()

    def _call_daemon(self, action: str, payload: Dict[str, Any], timeout: int) -> Dict[str, Any]:
        """POST 到常驻 daemon，返回解析后的 JSON dict；失败抛异常。"""
        req = urllib.request.Request(
            self._daemon_base() + "/" + action,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
        return json.loads(body) if body else {}

    def _run_browser(self, url: str) -> Optional[str]:
        """通过常驻 Chrome daemon 抓取渲染后的商品页 HTML。浏览器常驻复用会话：
        用户登录/过一次验证码后，后续链接复用同一浏览器，不再逐条弹验证码。"""
        if not self._browser_enabled():
            return None
        timeout_s = int((self.browser_cfg or {}).get("timeout", 180))
        try:
            if not self._ensure_daemon():
                logger.warning("browser daemon 不可用")
                return None
            logger.info(
                "[offer=%s] browser daemon fetch (timeout=%ss)",
                parse_product_id(url) or "?", timeout_s,
            )
            r = self._call_daemon("fetch", {"url": url, "timeout": timeout_s}, timeout_s + 30)
        except Exception as e:  # noqa: BLE001
            logger.warning("[offer=%s] daemon fetch failed: %s", parse_product_id(url) or "?", e)
            return None
        if not r.get("ok"):
            logger.warning(
                "[offer=%s] daemon fetch not ok: %s",
                parse_product_id(url) or "?", r.get("error"),
            )
            return None
        html = r.get("html") or ""
        if not html or self._html_is_punish(html):
            logger.warning(
                "[offer=%s] daemon got punish/empty (len=%d)",
                parse_product_id(url) or "?", len(html),
            )
            return None
        return html

    def _fetch_via_browser(self, url: str) -> Optional[str]:
        """浏览器兜底：复用常驻 Chrome 会话（用户登录后免重复验证）。"""
        if not self._browser_enabled():
            return None
        return self._run_browser(url)

    def warmup(self, url: str = "") -> bool:
        """预热：确保常驻 Chrome 已启动并打开 1688 登录页，等用户手动登录/过码一次。
        之后批量解析复用同一浏览器会话（cookie 常驻），通常不再逐条弹验证码。"""
        if not self._browser_enabled():
            return False
        try:
            if not self._ensure_daemon():
                return False
            r = self._call_daemon("login", {}, 60)
            return bool(r.get("ok"))
        except Exception as e:  # noqa: BLE001
            logger.warning("warmup failed: %s", e)
            return False

    def login1688(self) -> bool:
        """打开 1688 登录页（常驻 Chrome），用户登录一次后免重复验证。"""
        if not self._browser_enabled():
            return False
        try:
            if not self._ensure_daemon():
                return False
            r = self._call_daemon("login", {}, 60)
            return bool(r.get("ok"))
        except Exception as e:  # noqa: BLE001
            logger.warning("login1688 failed: %s", e)
            return False

    # ---------- 辅助：从任意嵌套 JSON 中递归抽所有"长得像图片 URL"的字符串 ----------
    def _extract_images_recursive(self, node: Any) -> List[str]:
        out: List[str] = []
        if isinstance(node, str):
            if (node.startswith("http://") or node.startswith("https://")) and \
                    any(d in node for d in _ALI_IMAGE_DOMAINS) or \
                    (node.startswith("https:") and (".jpg" in node or ".png" in node or ".webp" in node)):
                out.append(node)
        elif isinstance(node, list):
            for x in node:
                out.extend(self._extract_images_recursive(x))
        elif isinstance(node, dict):
            for _, v in node.items():
                out.extend(self._extract_images_recursive(v))
        return out

    @staticmethod
    def _to_thumb(url: str) -> Optional[str]:
        """把 1688/cbu 图片URL转换为 310x310 缩略图URL（如果是已知域名）。"""
        if not url:
            return None
        if any(d in url for d in _ALI_IMAGE_DOMAINS):
            # 原图 URL → 310 缩略：在扩展名前插入 ".310x310"
            if ".search." in url or "60x60" in url:
                url = url.replace(".60x60.", ".310x310.")
            else:
                url2 = re.sub(r"\.(jpg|jpeg|png|webp)(\?|$)", r".310x310.\1\2", url, flags=re.IGNORECASE)
                if url2 != url:
                    return url2
            return url
        return url

    # ============ API 接入层 ============
    def fetch_image_urls(self, product_id: str) -> List[str]:
        """调用 1688 商详API提取主图URL列表(首图 + 副图)。若未启用则返回空（调用方自动降级到 HTML 兜底）。"""
        if not self.cfg.get("enabled", False):
            return []
        resp = self._call_api(product_id)
        return self._parse_images(resp)

    def _call_api(self, product_id: str) -> Dict[str, Any]:
        """组装并调用 product.search.queryProductDetail。"""
        params = {
            "app_key": self.cfg.get("app_key", ""),
            "method": self.cfg.get("api_name", "product.search.queryProductDetail"),
            "format": "json",
            "v": self.cfg.get("api_version", "1.0.0"),
            "sign_method": "hmac",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "productId": product_id,
            "access_token": self.cfg.get("access_token", ""),
        }
        params["sign"] = self._sign(params)
        endpoint = self.cfg.get("endpoint", "https://gw.open.1688.com/openapi")
        url = f"{endpoint}/{params['method']}/{params['v']}"
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _sign(self, params: Dict[str, Any]) -> str:
        """HMAC-SHA256 签名(占位实现, 按官方文档规则调整)。"""
        import hmac
        import hashlib
        secret = self.cfg.get("app_secret", "").encode("utf-8")
        items = sorted((k, str(v)) for k, v in params.items() if k != "sign")
        msg = "".join(f"{k}{v}" for k, v in items).encode("utf-8")
        return hmac.new(secret, msg, hashlib.sha256).hexdigest().upper()

    def _parse_images(self, resp: Dict[str, Any]) -> List[str]:
        """从商详响应解析主图URL列表。响应结构因API版本而异, 这里给出常见字段适配。"""
        try:
            info = (
                resp.get("productInfo")
                or resp.get("result")
                or resp.get("data", {}).get("productInfo")
                or {}
            )
            imgs = info.get("images") or info.get("imageUrls") or info.get("picUrls") or []
            if isinstance(imgs, str):
                imgs = [imgs]
            if not imgs and info.get("picUrl"):
                imgs = [info["picUrl"]]
            # 兼容：offerImageList / imageList 数组
            if not imgs:
                imgs = info.get("offerImageList") or info.get("imageList") or []
            return [x for x in imgs if isinstance(x, str)]
        except Exception as e:  # noqa: BLE001
            logger.warning("解析商详图片失败: %s", e)
            return []

    # ============ 图片下载与白底检测 ============
    def _is_white_url(self, url: str) -> bool:
        """HEAD 无法判断白底，乐观返回 True，下载后再校验。"""
        return True

    def _download(self, url: str, out_path: Path, *, skip_white_filter: bool = False) -> bool:
        try:
            r = self.session.get(url, timeout=30, allow_redirects=True)
            r.raise_for_status()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(r.content)
            if not skip_white_filter and self.cfg.get("filter_non_white", True) and not is_white_background(out_path):
                out_path.unlink(missing_ok=True)
                return False
            return True
        except Exception as e:  # noqa: BLE001
            logger.debug("下载失败 %s: %s", url, e)
            return False

    @staticmethod
    def _guess_ext(url: str) -> str:
        m = re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", url, re.IGNORECASE)
        return f".{m.group(1).lower()}" if m else ".jpg"
