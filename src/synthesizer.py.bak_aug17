"""合成引擎层:统一接口,多种实现。

引擎选择通过 config.lovart.engine 字段控制,优先级:
  1. config.lovart.mock=true -> MockSynthesizer (Pillow 本地占位图,联调用)
  2. config.lovart.engine="nano_banana"  -> NanoBananaSynthesizer (REST API 直连 nananobanana.com)
  3. config.lovart.engine="seedream"   -> SeedreamSynthesizer   (写 pending 队列,由 Agent 调 GenerateImage 真实生成)
  4. config.lovart.engine="lovart_skill"  -> LovartSkillSynthesizer (OpenClaw Skill,subprocess 调 agent_skill.py)
  5. 默认为 MockSynthesizer (兼容性)
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from PIL import Image, ImageDraw

from .config import Config

logger = logging.getLogger("synthesizer")


# ============================================================
# 基类 (统一接口)
# ============================================================
class Synthesizer(ABC):
    """合成引擎基类。"""

    name: str = "base"

    def __init__(self, config: Config) -> None:
        self.cfg = config
        self._lavort_cfg: Dict[str, Any] = getattr(config, "lovart", {}) or getattr(config, "lavort", {})
        self.width: int = int(self._lavort_cfg.get("width", 800))
        self.height: int = int(self._lavort_cfg.get("height", 800))

    @abstractmethod
    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Path,
        width: Optional[int] = None,
        height: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Path:
        """合成一张主图,返回保存路径。失败则抛异常。

        Args:
            model: 可选模型覆盖（仅 NanoBanana 等支持多模型的引擎生效；
                   为 None 时沿用 __init__ 时 self.model 配置）。
        """
        raise NotImplementedError


# ============================================================
# Mock: Pillow 本地合成占位图 (联调)
# ============================================================
class MockSynthesizer(Synthesizer):
    name = "mock"

    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Path,
        width: Optional[int] = None,
        height: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Path:
        w = width or self.width
        h = height or self.height
        canvas = Image.new("RGB", (w, h), (255, 255, 255))
        try:
            main = Image.open(main_image).convert("RGB")
            main.thumbnail((w, h))
            canvas.paste(main, ((w - main.width) // 2, (h - main.height) // 2))
        except Exception as e:
            logger.debug("mock 主图加载失败: %s", e)
        try:
            cat = Image.open(cat_image).convert("RGBA")
            cat.thumbnail((w // 3, h // 3))
            canvas.paste(cat, (w - cat.width - 10, h - cat.height - 10), cat)
        except Exception as e:
            logger.debug("mock 猫咪图加载失败: %s", e)
        draw = ImageDraw.Draw(canvas)
        draw.text((10, 10), f"[MOCK] 云眠花园 [{self.name}]", fill=(255, 0, 0))
        draw.text((10, h - 24), prompt[:60], fill=(80, 80, 80))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out_path, format="PNG")
        return out_path


# ============================================================
# Lovart Skill: subprocess 调用 agent_skill.py (OpenClaw Skill 文档规范)
# ============================================================
class LovartSkillSynthesizer(Synthesizer):
    name = "lovart_skill"

    SKILL_SEARCH_PATHS = [
        Path.home() / ".openclaw/skills/lovart-skill/scripts/agent_skill.py",
        Path.home() / ".openclaw/skills/@lovart-admin/lovart-skill/scripts/agent_skill.py",
        Path.home() / ".skills/lovart-skill/scripts/agent_skill.py",
        Path("/usr/local/share/openclaw/skills/lovart-skill/scripts/agent_skill.py"),
        Path("/opt/openclaw/skills/lovart-skill/scripts/agent_skill.py"),
    ]

    def __init__(self, config: Config) -> None:
        super().__init__(config)
        self.access_key = self._lavort_cfg.get("access_key", "")
        self.secret_key = self._lavort_cfg.get("secret_key", "")
        self.timeout: int = int(self._lavort_cfg.get("timeout", 120))
        self.project_id: str = self._lavort_cfg.get("project_id", "")
        self.project_name: str = self._lavort_cfg.get("project_name", "云眠花园主图生成")
        self._project_initialized = False

    @property
    def skill_script(self) -> Optional[Path]:
        configured = self._lavort_cfg.get("skill_script", "")
        if configured:
            p = Path(configured)
            if p.exists():
                return p
        for p in self.SKILL_SEARCH_PATHS:
            if p.exists():
                return p
        return None

    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Path,
        width: Optional[int] = None,
        height: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Path:
        import os
        import shutil
        import subprocess
        import sys
        import uuid

        script = self.skill_script
        if script is None:
            raise RuntimeError(
                "Lovart skill (agent_skill.py) 未找到。请先安装:\n"
                "  1. brew install openclaw  (或从 https://openclaw.ai 下载)\n"
                "  2. openclaw skills install @lovart-admin/lovart-skill\n"
                "或在 config.yaml -> lovart.skill_script 指定 agent_skill.py 路径。\n"
                "暂时可将 mock 设为 true 进行本地联调。"
            )

        env = dict(os.environ)
        if self.access_key:
            env["LOVART_ACCESS_KEY"] = self.access_key
        if self.secret_key:
            env["LOVART_SECRET_KEY"] = self.secret_key

        def run_cmd(args: List[str], t: int = 120) -> subprocess.CompletedProcess:
            cmd = [sys.executable, str(script)] + args
            result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=t)
            if result.returncode != 0:
                err = result.stderr.strip() or result.stdout.strip()
                raise RuntimeError(f"agent_skill.py {args[0]} 失败: {err[:500]}")
            return result

        def parse_json(stdout: str) -> Optional[Any]:
            stdout = stdout.strip()
            if not stdout:
                return None
            for fn in (
                lambda s: json.loads(s),
                lambda s: json.loads(s[s.find("{"): s.rfind("}") + 1]),
            ):
                try:
                    return fn(stdout)
                except Exception:
                    pass
            for line in reversed(stdout.splitlines()):
                line = line.strip()
                if line.startswith("{"):
                    try:
                        return json.loads(line)
                    except Exception:
                        continue
            return None

        # Step 1: 确保项目已初始化
        if not self._project_initialized:
            cfg_data = parse_json(run_cmd(["config", "--json"], 10).stdout)
            if cfg_data and cfg_data.get("active_project"):
                self.project_id = cfg_data["active_project"]
            elif self.project_id:
                run_cmd(["project-add", "--project-id", self.project_id, "--name", self.project_name], 10)
            else:
                new_pid = f"csg_{uuid.uuid4().hex[:8]}"
                run_cmd(["project-add", "--project-id", new_pid, "--name", self.project_name], 10)
                self.project_id = new_pid
            self._project_initialized = True

        # Step 2: 上传主图 / 猫咪图
        def upload(f: Path) -> str:
            data = parse_json(run_cmd(["upload", "--file", str(f)], 60).stdout)
            if not data or not data.get("url"):
                raise RuntimeError(f"上传失败: {f.name}")
            return data["url"]

        main_url = upload(main_image)
        cat_url = upload(cat_image)
        full_prompt = f"{prompt} | Output size: {width or self.width}x{height or self.height}px, square format."

        # Step 3: chat 合成
        download_dir = out_path.parent / "_lovart_tmp"
        download_dir.mkdir(parents=True, exist_ok=True)
        result = run_cmd(
            [
                "chat", "--prompt", full_prompt,
                "--attachments", f"{main_url},{cat_url}",
                "--json", "--download", "--output-dir", str(download_dir),
            ],
            self.timeout,
        )
        chat_data = parse_json(result.stdout)
        if not chat_data:
            raise RuntimeError(f"chat 返回非JSON: {result.stdout[:500]}")
        if not chat_data.get("generation_succeeded", True):
            raise RuntimeError(f"Lovart 生成失败: {chat_data.get('warning', '未知原因')}")

        # Step 4: 提取结果
        downloaded = chat_data.get("downloaded", []) or []
        if downloaded:
            lp = downloaded[0].get("local_path")
            if lp and Path(lp).exists():
                shutil.copy2(lp, out_path)
                return out_path
            url = downloaded[0].get("url")
            if url:
                import urllib.request
                urllib.request.urlretrieve(url, out_path)
                return out_path
        raise RuntimeError("Lovart 返回成功但无图片产物")


# ============================================================
# Seedream: 写 pending JSONL 队列,由 Agent 调 GenerateImage 真实生成
#   - Python 端: 把任务追加到 output/synthesized/_seedream_pending.jsonl
#   - Agent 端: 读取 pending 队列,逐个调用 GenerateImage -> 写入 out_path
# ============================================================
class SeedreamPending(Exception):
    """Seedream 任务已写入 pending 队列, 等待 Agent 处理。"""


class SeedreamSynthesizer(Synthesizer):
    name = "seedream"

    @property
    def pending_path(self) -> Path:
        return self.cfg.synthesized_dir / "_seedream_pending.jsonl"

    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Path,
        width: Optional[int] = None,
        height: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Path:
        # 先检查 out_path 是否已存在 (Agent 已处理过，或 .jpg 变体已存在)
        if out_path.exists() and out_path.stat().st_size > 1000:
            logger.info("Seedream: 产物已存在,跳过 -> %s", out_path.name)
            return out_path
        # GenerateImage 工具生成的默认扩展名是 .jpg，如果 .png 不存在但 .jpg 已落地，
        # 则直接复制一份到 out_path，保证前端按原始名访问时不会 404
        jpg_variant = out_path.with_suffix(".jpg")
        if jpg_variant.exists() and jpg_variant.stat().st_size > 1000:
            try:
                import shutil as _sh
                _sh.copy2(jpg_variant, out_path)
                logger.info("Seedream: 复用 jpg 变体 -> %s", out_path.name)
                return out_path
            except Exception as e:
                logger.warning("Seedream: 复制 jpg 变体失败,回退 mock: %s", e)

        # 估算 image_size (GenerateImage 工具要求的参数)
        w = width or self.width
        h = height or self.height
        if w == h:
            size = "square_hd" if w >= 1024 else "square"
        elif w > h:
            size = "landscape_16_9" if h < 800 else "landscape_4_3"
        else:
            size = "portrait_16_9" if w < 800 else "portrait_4_3"

        task: Dict[str, Any] = {
            "prompt": prompt,
            "width": w,
            "height": h,
            "image_size": size,
            "out_path": str(Path(out_path).resolve()),
            "main_image": str(Path(main_image).resolve()),
            "cat_image": str(Path(cat_image).resolve()),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        self.pending_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.pending_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(task, ensure_ascii=False) + "\n")

        logger.info("Seedream: 任务已入队 -> %s (size=%s)", out_path.name, size)
        # 标记 stdout 便于 Agent 快速识别
        print(f"\n[SEEDREAM_PENDING] {json.dumps(task, ensure_ascii=False)}", flush=True)
        # 抛特殊异常, 让 scheduler 把该任务记为 "待 Agent 处理"
        raise SeedreamPending(
            f"Seedream 任务已入队 {out_path.name},请调用 GenerateImage 工具生成图片并保存到 out_path"
        )


# ============================================================
# NanoBanana: REST API 直连 nananobanana.com (文生图 + 图生图)
#   - 文档: POST /api/v1/generate (sync 模式)
#   - 图生图: 把主图+猫咪图转 base64 data URL 作为 referenceImageUrls
#   - 默认模型: gemini-2.5-flash-image (后台 displayName 为 "Nano Banana";
#     文档示例里的 "nano-banana" 实测返回 503 model_not_found, 故不用)
# ============================================================
class ConcurrencyLimitError(RuntimeError):
    """账户并发请求限制 (HTTP 429) — 需要更长 backoff。"""
    pass


def _is_concurrency_error(text: str) -> bool:
    """判断响应文本是否表明并发 / 在途任务限制。

    NanoBanana 有时不以 HTTP 429 返回并发限制，而是返回 HTTP 200 + success:false
    （如「有生成任务进行中 / active=1」）。这类情况必须走长退避（等上一张完成），
    否则短退避会在 active 窗口尚未释放时把重试次数耗尽，导致第二张分镜图生成失败。
    """
    if not text:
        return False
    low = text.lower()
    keys = (
        "active", "concurrent", "concurrency", "rate limit", "ratelimit",
        "too many", "in progress", "in_progress", "进行中", "生成任务",
        "排队", "占用", "并发", "busy", "请稍后", "稍后再试", "稍后",
        "another request", "another task", "already",
    )
    return any(k in low for k in keys)


# ====== NanoBanana 官方模型元数据辅助（与 /api/v1/models 解耦时的轻量推断）======
import logging as _logging
_LOGGER = _logging.getLogger("NanoBananaSynthesizer")


def _guess_quality(display_name: str, model_id: str) -> str:
    d = f"{display_name} {model_id}".lower()
    if any(k in d for k in ["4k"]): return "4K 超清"
    if any(k in d for k in ["2k"]): return "2K 高清"
    if any(k in d for k in ["pro"]): return "高清增强"
    if any(k in d for k in ["lite", "flash"]): return "标准"
    return "标准"


def _guess_speed(display_name: str, model_id: str) -> str:
    d = f"{display_name} {model_id}".lower()
    if any(k in d for k in ["fast"]): return "约 20-35s"
    if any(k in d for k in ["4k"]): return "约 90-180s"
    if any(k in d for k in ["2k", "pro"]): return "约 60-120s"
    if any(k in d for k in ["lite", "flash"]): return "约 30-60s"
    return "约 35-90s"


def _guess_tags(display_name: str, model_id: str, cost: int, requires_pro: bool):
    d = f"{display_name} {model_id}".lower()
    tags = []
    if cost == 1: tags.append("性价比高")
    if any(k in d for k in ["pro"]): tags.append("Pro")
    if any(k in d for k in ["4k"]): tags.append("4K")
    if any(k in d for k in ["2k"]): tags.append("2K")
    if any(k in d for k in ["fast"]): tags.append("极速")
    if any(k in d for k in ["seedream", "即梦"]): tags.append("即梦")
    if any(k in d for k in ["gpt-image"]): tags.append("GPT")
    if requires_pro: tags.append("会员可用")
    return tags


class NanoBananaSynthesizer(Synthesizer):
    """NanoBanana (nananobanana.com) 图像生成器 — REST API。

    设计要点(应对真实网络不稳定):
      * 默认为 async 模式: POST 提交立即返回 id → 轮询 GET 直到 completed → 下载。
        每步都是短连接, 不会出现 sync 长等待时 "Connection reset by peer"。
        如配置 mode="sync" 则仍然支持。
      * 每次请求自带重试 (3 次, 指数退避) — 覆盖瞬时 5xx/连接重置/超时。
      * 参考图默认最大边长 512px — 图生图请求体通常 < 1MB, 比 1024px 小 4x, 上传快。
      * requests.Session 关闭 proxy 信任, 避免本地 Clash 等代理软件干扰。
    """

    name = "nano_banana"

    DEFAULT_BASE_URL = "https://www.nananobanana.com"
    DEFAULT_MODEL = "gemini-2.5-flash-image"  # 官方 displayName: "Nano Banana", creditsCost=1
    # API Key 优先级: 环境变量 NANO_BANANA_API_KEY > config.yaml -> nano_banana.api_key > 内置默认
    DEFAULT_API_KEY = "nb_1f33f385302bb3f3a1bcd6f8e722411a983dbe9d2ee73fdaa7d88d8b6e1c2607"

    # 官方模型缓存（10 分钟 TTL），避免每次 list_models / is_valid_model 都去拉外网
    _MODELS_CACHE: List[Dict[str, Any]] = []
    _MODELS_CACHE_AT: float = 0.0
    _MODELS_CACHE_TTL: float = 600.0

    @classmethod
    def _fetch_official_models(cls, api_key: Optional[str] = None,
                               base_url: Optional[str] = None) -> List[Dict[str, Any]]:
        """直连 NanoBanana 官方 /api/v1/models 拉真实可用模型，并过滤只保留支持图生图的版本。"""
        import ssl
        import urllib.request
        import urllib.parse
        import json as _json
        import time as _t

        now = _t.time()
        if cls._MODELS_CACHE and (now - cls._MODELS_CACHE_AT) < cls._MODELS_CACHE_TTL:
            return [dict(m) for m in cls._MODELS_CACHE]

        key = api_key or cls.DEFAULT_API_KEY
        base = (base_url or cls.DEFAULT_BASE_URL).rstrip("/")
        ctx = ssl.create_default_context()
        try:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # noqa: DUO122
        except Exception:
            ctx = None
        req = urllib.request.Request(
            base + "/api/v1/models",
            headers={
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "User-Agent": "CloudSleepGarden/1.0",
            },
        )
        try:
            kwargs: Dict[str, Any] = {"timeout": 15}
            if ctx is not None:
                kwargs["context"] = ctx
            with urllib.request.urlopen(req, **kwargs) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
            data = _json.loads(raw)
            official = data.get("data") if isinstance(data, dict) else None
            if not isinstance(official, list):
                raise RuntimeError("官方 /api/v1/models 返回结构非 data[]")
        except Exception as e:  # noqa: BLE001
            # 外网拉失败：降级用内嵌 fallback（用户现在实际使用的几个，不会被官网不存在 id 坑）
            logger = _LOGGER or __import__("logging").getLogger(__name__)
            logger.warning("NanoBanana 官方模型列表拉取失败，降级内置 fallback: %s", e)
            official = [
                {"name": "gemini-2.5-flash-image", "displayName": "Nano Banana",
                 "creditsCost": 1, "supportsImageInput": True, "requiresPro": False,
                 "description": "基础图像生成模型"},
                {"name": "nanobanan2&pro", "displayName": "Nano Banana Pro",
                 "creditsCost": 3, "supportsImageInput": True, "requiresPro": True,
                 "description": "增强版图像生成模型"},
                {"name": "nanobanan2&pro-2k", "displayName": "Nano Banana Pro 2K",
                 "creditsCost": 4, "supportsImageInput": True, "requiresPro": True,
                 "description": "2K 高分辨率图像生成模型"},
                {"name": "nanobanan-2", "displayName": "Nano Banan 2",
                 "creditsCost": 3, "supportsImageInput": True, "requiresPro": True,
                 "description": ""},
            ]

        normalized: List[Dict[str, Any]] = []
        for m in official:
            if not bool(m.get("supportsImageInput")):
                continue  # 必须支持图生图（主图 + 猫咪 reference）
            name = m.get("name")
            if not name:
                continue
            normalized.append({
                "id": name,
                "displayName": m.get("displayName") or name,
                "creditsCost": int(m.get("creditsCost") or 1),
                "quality": _guess_quality(m.get("displayName") or "", name),
                "speed": _guess_speed(m.get("displayName") or "", name),
                "description": m.get("description") or "",
                "tags": _guess_tags(m.get("displayName") or "", name, int(m.get("creditsCost") or 1),
                                    bool(m.get("requiresPro"))),
                "default": name == cls.DEFAULT_MODEL,
                "requiresPro": bool(m.get("requiresPro")),
            })
        # 默认模型永远放第一个（如果在列表里），保证前端初始值稳定
        normalized.sort(key=lambda m: (0 if m["id"] == cls.DEFAULT_MODEL else
                                       (1 if m.get("creditsCost", 1) == 1 else 2),
                                       m.get("creditsCost", 1)))
        cls._MODELS_CACHE = [dict(m) for m in normalized]
        cls._MODELS_CACHE_AT = now
        return [dict(m) for m in normalized]

    @classmethod
    def list_models(cls) -> List[Dict[str, Any]]:
        """返回真实官方可用且支持图生图的模型列表（10 分钟缓存）。"""
        return cls._fetch_official_models()

    @classmethod
    def is_valid_model(cls, model_id: Optional[str]) -> bool:
        if not model_id:
            return False
        try:
            avail = cls._fetch_official_models()
        except Exception:
            return False
        return any(m["id"] == model_id for m in avail)

    @classmethod
    def resolve_default_model(cls) -> str:
        """返回实际可用的默认模型 id（优先 DEFAULT_MODEL，不在官方列表时 fallback 到第一个 1 积分图生图模型）。"""
        try:
            avail = cls._fetch_official_models()
        except Exception:
            return cls.DEFAULT_MODEL
        if any(m["id"] == cls.DEFAULT_MODEL for m in avail):
            return cls.DEFAULT_MODEL
        cheap = [m for m in avail if int(m.get("creditsCost") or 1) == 1]
        return (cheap or avail)[0]["id"]

    def __init__(self, config: Config) -> None:
        super().__init__(config)
        nb = getattr(config, "nano_banana", {}) or {}
        self.api_key: str = (
            os.environ.get("NANO_BANANA_API_KEY")
            or nb.get("api_key")
            or self.DEFAULT_API_KEY
        )
        self.base_url: str = (nb.get("base_url") or self.DEFAULT_BASE_URL).rstrip("/")
        self.model: str = nb.get("model") or self.DEFAULT_MODEL
        # sync 模式实测更可靠: async 模式下 nananobanana 后端在上游慢时易标 failed(524/504);
        # sync 直接等待, 文生图 ~35-90s 可成功. timeout 240s 覆盖上游高负载+图生图.
        self.mode: str = (nb.get("mode") or "sync").lower()
        self.aspect_ratio: str = nb.get("aspect_ratio", "1:1")
        self.timeout: int = int(nb.get("timeout", 240))
        # 关键修复: 图生图默认开启 (主图 + 猫咪图作为 referenceImageUrls 上传);
        # 此前默认 False → 用户上传的素材根本没发给 NanoBanana, 造成"合成和素材毫无关系"
        self.use_image_to_image: bool = bool(nb.get("use_image_to_image", True))
        # 默认 768px 作为参考图: 比 512 保留更多细节, 仍远小于 1024, 请求体可控 (~1.2MB/2张)
        self.ref_max_side: int = int(nb.get("ref_max_side", 768))
        # 轮询参数 (async 模式用)
        self.poll_interval: float = float(nb.get("poll_interval", 3.0))
        self.poll_max_wait: int = int(nb.get("poll_max_wait", 360))
        # 重试
        self.max_retries: int = int(nb.get("max_retries", 4))
        if not self.api_key:
            raise RuntimeError(
                "NanoBanana 未配置 api_key, 请在 config.yaml -> nano_banana.api_key 填入 "
                "(以 nb_ 开头) 或将 lovart.mock 设为 true 进行联调。"
            )

    # ========= 主入口 =========
    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Path,
        width: Optional[int] = None,
        height: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Path:
        import requests  # 延迟导入
        import json

        out_path.parent.mkdir(parents=True, exist_ok=True)
        # 模型优先级：入参 model（需合法）> 实例 self.model > 默认
        use_model = self.model
        if NanoBananaSynthesizer.is_valid_model(model):
            use_model = model
        # 按入参 width/height 动态计算 aspectRatio（与前端画布尺寸一致，避免输出比例偏离）
        if width and height:
            use_aspect = self._ratio_for(width, height)
        else:
            use_aspect = self.aspect_ratio
        session = self._build_session()
        refs: List[str] = []
        # 只要是合成（必有主图+猫咪两个入参路径）就强制上 referenceImageUrls，
        # 即使 config 里误关 use_image_to_image 也作为兜底开启，避免"传了素材完全没用上"
        if self.use_image_to_image or True:
            for p, label in ((main_image, "main"), (cat_image, "cat")):
                d = self._image_to_data_url(p, self.ref_max_side)
                if d:
                    refs.append(d)
                    size_kb = round(len(d.encode("ascii")) / 1024, 1)
                    logger.info("NanoBanana 参考图[%s]: %s, %sKB, max_side=%s", label, p.name, size_kb, self.ref_max_side)
                else:
                    logger.warning("NanoBanana 参考图[%s] 读取失败, 将跳过: %s", label, p)
        payload: Dict[str, Any] = {
            "prompt": self._build_prompt(prompt, width, height),
            "selectedModel": use_model,
            "mode": self.mode,
            "aspectRatio": use_aspect,
            "quantity": 1,
        }
        if refs:
            payload["referenceImageUrls"] = refs

        # 详细日志: 除 base64 正文以外全部打出来 (refs 仅打长度和前缀, 避免日志爆炸)
        preview_refs = [
            f"[{i}]data_url_len={len(r)} prefix={r[:64]}"
            for i, r in enumerate(refs)
        ]
        payload_for_log = {
            k: (preview_refs if k == "referenceImageUrls" else v)
            for k, v in payload.items()
            if k != "prompt"
        }
        payload_bytes = len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        logger.info(
            "NanoBanana 请求: model=%s mode=%s aspect=%s refs=%d payload_KB=%.1f prompt=%.60s | %s",
            use_model, self.mode, use_aspect, len(refs), payload_bytes / 1024, prompt,
            json.dumps(payload_for_log, ensure_ascii=False),
        )

        if self.mode == "sync":
            data = self._retry(lambda: self._post_sync(session, payload))
            image_urls = data.get("imageUrls") or data.get("outputImageUrls") or []
            inner = data.get("data") or {}
            if not image_urls:
                image_urls = inner.get("outputImageUrls") or inner.get("imageUrls") or []
            credits = data.get("creditsUsed") or inner.get("creditsUsed")
            remaining = data.get("remainingCredits")
        else:
            # async: submit → poll → get result
            submit = self._retry(lambda: self._post_async(session, payload))
            if submit.get("immediate_urls"):
                # 极少数情况下服务器同步返回了结果 (e.g. 小图/缓存)
                image_urls = submit["immediate_urls"]
                credits = None
                remaining = None
                logger.info("NanoBanana submit 已直接返回图片 URL, 跳过轮询")
            else:
                gen_id = submit["id"]
                final = self._poll_until_done(session, gen_id)
                image_urls = final.get("outputImageUrls") or final.get("imageUrls") or []
                credits = final.get("creditsUsed")
                remaining = None
                logger.info("NanoBanana 生成完成 id=%s status=%s", gen_id, final.get("processingStatus"))

        if not image_urls:
            raise RuntimeError(f"NanoBanana 返回无图片 URL")
        img_url = image_urls[0] if isinstance(image_urls, list) else image_urls

        self._retry(lambda: self._download(session, img_url, out_path))
        logger.info(
            "NanoBanana 写入 %s (credits=%s, 剩余=%s, size=%dB)",
            out_path.name, credits or "?", remaining or "?",
            out_path.stat().st_size if out_path.exists() else 0,
        )
        return out_path

    # ========= 视频分镜图生成（文生图 / 图生图）=========
    def generate(
        self,
        text: Optional[str] = None,
        ref_image: Optional[str] = None,
        style_text: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        out_dir: Optional[Path] = None,
        model: Optional[str] = None,
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """文生图 / 图生图（供视频分镜图使用），真实调用 NanoBanana。

        返回 {"filename", "path", "url", "credits", "remaining"}；
        filename 用于拼接后端图片访问地址 /api/image/synthesized/<filename>。

        on_progress: 可选回调，调用时机：
          - async 提交成功: {"stage": "submitted", "gen_id": ...}
          - 轮询中:        {"stage": "polling", "status": ..., "elapsed": ...}
          - 下载结果图:    {"stage": "downloading"}
        """
        import requests

        prompt = (style_text or text or '').strip()
        if not prompt:
            raise RuntimeError('generate 需要 text 或 style_text 提示词')

        # 模型优先级：入参 model（需合法）> 实例 self.model
        use_model = self.model
        if NanoBananaSynthesizer.is_valid_model(model):
            use_model = model

        # 分镜图默认竖屏 9:16；指定宽高则就近映射
        use_aspect = self._ratio_for(width, height) if (width and height) else '9:16'
        session = self._build_session()

        # 参考图：统一转 data URL（NanoBanana 云端访问不到本机 127.0.0.1 地址，必须内联编码）
        refs: List[str] = []
        if ref_image:
            s = str(ref_image).strip()
            if s.startswith('data:'):
                refs.append(s)
            elif s.startswith('http://') or s.startswith('https://'):
                try:
                    r = requests.get(s, timeout=60)
                    if r.status_code == 200 and r.content:
                        d = self._bytes_to_data_url(r.content, self.ref_max_side)
                        if d:
                            refs.append(d)
                            logger.info('NanoBanana 参考图[远程] 已转 data URL, %sB', len(r.content))
                except Exception as e:
                    logger.warning('NanoBanana 参考图下载失败, 该次退化为文生图: %s', e)
            else:
                d = self._image_to_data_url(Path(s), self.ref_max_side)
                if d:
                    refs.append(d)

        payload: Dict[str, Any] = {
            'prompt': prompt,
            'selectedModel': use_model,
            'mode': self.mode,
            'aspectRatio': use_aspect,
            'quantity': 1,
        }
        if refs:
            payload['referenceImageUrls'] = refs

        if self.mode == 'sync':
            data = self._retry(lambda: self._post_sync(session, payload))
            image_urls = data.get('imageUrls') or data.get('outputImageUrls') or []
            inner = data.get('data') or {}
            if not image_urls:
                image_urls = inner.get('outputImageUrls') or inner.get('imageUrls') or []
            credits = data.get('creditsUsed') or inner.get('creditsUsed')
            remaining = data.get('remainingCredits')
        else:
            submit = self._retry(lambda: self._post_async(session, payload))
            if submit.get('immediate_urls'):
                image_urls = submit['immediate_urls']
                credits = None
                remaining = None
            else:
                gen_id = submit['id']
                if on_progress:
                    on_progress({'stage': 'submitted', 'gen_id': gen_id})
                final = self._poll_until_done(session, gen_id, on_progress=on_progress)
                image_urls = final.get('outputImageUrls') or final.get('imageUrls') or []
                credits = final.get('creditsUsed')
                remaining = None

        if not image_urls:
            raise RuntimeError('NanoBanana 返回无图片 URL')
        img_url = image_urls[0] if isinstance(image_urls, list) else image_urls

        if on_progress:
            on_progress({'stage': 'downloading'})
        out_dir = Path(out_dir) if out_dir else Path(self.cfg.synthesized_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f'frame_{int(time.time()*1000)}.png'
        self._retry(lambda: self._download(session, img_url, out_path))

        logger.info(
            'NanoBanana 分镜图写入 %s (credits=%s, 剩余=%s, size=%dB)',
            out_path.name, credits or '?', remaining or '?',
            out_path.stat().st_size if out_path.exists() else 0,
        )
        return {
            'filename': out_path.name,
            'path': str(out_path),
            'url': img_url,
            'credits': credits,
            'remaining': remaining,
        }

    def _bytes_to_data_url(self, raw: bytes, max_side: int) -> Optional[str]:
        """内存中的图片 bytes → JPEG data URL（不落盘）。"""
        try:
            img = Image.open(io.BytesIO(raw)).convert('RGB')
            if max(img.size) > max_side:
                img.thumbnail((max_side, max_side))
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=88)
            b64 = base64.b64encode(buf.getvalue()).decode('ascii')
            return f'data:image/jpeg;base64,{b64}'
        except Exception as e:
            logger.warning('NanoBanana: 参考图 bytes 转换失败: %s', e)
            return None

    # ========= 低层请求 =========
    def _build_session(self):
        import requests
        s = requests.Session()
        s.trust_env = False  # 忽略环境变量里的代理
        s.proxies = {"http": None, "https": None}
        s.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        })
        return s

    @staticmethod
    def _ratio_for(width: int, height: int) -> str:
        """根据 width/height 计算出 NanoBanana 兼容的 aspectRatio 字符串 (近邻映射)."""
        import math
        if not (width and height):
            return "1:1"
        # 约分
        def gcd(a, b):
            while b:
                a, b = b, a % b
            return a
        g = gcd(int(width), int(height))
        rw, rh = width // g, height // g
        # 前端常用预设（NanoBanana 官方支持这些字符串），优先就近映射
        canonical = [
            (1, 1), (3, 4), (4, 3), (2, 3), (3, 2),
            (9, 16), (16, 9), (1, 2), (2, 1), (4, 5), (5, 4),
        ]
        best = None
        best_score = float("inf")
        ratio = width / float(height)
        for (a, b) in canonical:
            diff = abs(a / float(b) - ratio)
            if diff < best_score:
                best_score = diff
                best = (a, b)
        if best is not None and best_score < 0.03:
            return f"{best[0]}:{best[1]}"
        return f"{rw}:{rh}"

    def _post_sync(self, session, payload: Dict[str, Any]) -> Dict[str, Any]:
        import json
        r = session.post(f"{self.base_url}/api/v1/generate", json=payload, timeout=self.timeout)
        if r.status_code == 429:
            # 并发限制：抛特定异常让 _retry 使用更长的 backoff 等当前在途任务跑完
            raise ConcurrencyLimitError(f"sync 429 并发限制: {r.text[:300]}")
        if r.status_code != 200:
            logger.error(
                "NanoBanana sync HTTP %s | req_id=%s | body=%.500s",
                r.status_code, r.headers.get("x-request-id"), r.text,
            )
            raise RuntimeError(f"sync HTTP {r.status_code}: {r.text[:500]}")
        try:
            data = r.json()
        except Exception:
            raise RuntimeError(f"sync 返回非 JSON: status=200 body={r.text[:300]}")
        # 额外打完整响应关键字段 (imageUrls 只打数量, 不打 URL) 方便排错
        try:
            loggable = {
                k: (v if not isinstance(v, list) or k not in ("imageUrls", "outputImageUrls") else f"<{len(v)} urls>")
                for k, v in data.items()
                if k != "data"
            }
            inner = data.get("data") or {}
            if isinstance(inner, dict):
                for k, v in inner.items():
                    loggable[f"data.{k}"] = (
                        f"<{len(v)} urls>" if isinstance(v, list) and k in ("imageUrls", "outputImageUrls") else v
                    )
            logger.info("NanoBanana sync 响应: %s", json.dumps(loggable, ensure_ascii=False)[:600])
        except Exception:
            logger.info("NanoBanana sync 响应 keys=%s", list(data.keys())[:20])
        if not data.get("success"):
            _msg = str(data)
            if _is_concurrency_error(_msg):
                # HTTP 200 但被并发限制（active=1 / 任务进行中）→ 走长退避，等上一张完成
                raise ConcurrencyLimitError(f"sync 并发限制(200-success:false): {_msg[:300]}")
            raise RuntimeError(f"sync 失败: {data}")
        return data

    def _post_async(self, session, payload: Dict[str, Any]) -> Dict[str, Any]:
        r = session.post(f"{self.base_url}/api/v1/generate", json=payload, timeout=60)
        if r.status_code == 429:
            # 并发限制: 抛特定异常让 _retry 用更长 backoff
            raise ConcurrencyLimitError(f"429 并发限制: {r.text[:200]}")
        if r.status_code not in (200, 202):
            logger.error(
                "NanoBanana async HTTP %s | req_id=%s | body=%.500s",
                r.status_code, r.headers.get("x-request-id"), r.text,
            )
            raise RuntimeError(f"async submit HTTP {r.status_code}: {r.text[:500]}")
        data = r.json()
        inner = data.get("data") or {}
        # 兼容多种字段 (实测顶层 generationId; 文档说 data.id)
        gen_id = (
            inner.get("id")
            or data.get("id")
            or inner.get("generationId")
            or data.get("generationId")
        )
        if not gen_id:
            # 退化为同步结果 (有时服务器直接返回图片 URL)
            urls = (
                data.get("imageUrls") or data.get("outputImageUrls")
                or inner.get("outputImageUrls") or inner.get("imageUrls")
            )
            if urls:
                return {"id": "", "immediate_urls": urls}
            _msg = str(data)
            if _is_concurrency_error(_msg):
                # HTTP 200 但被并发限制（active=1 / 任务进行中）→ 走长退避
                raise ConcurrencyLimitError(f"async 并发限制(200-success:false): {_msg[:300]}")
            raise RuntimeError(f"async submit 无 id/generationId: {data}")
        return {"id": gen_id}

    def _poll_until_done(self, session, gen_id: str, on_progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> Dict[str, Any]:
        if not gen_id:
            raise RuntimeError("async mode 但无 id")
        deadline = time.time() + self.poll_max_wait
        interval = self.poll_interval
        _t0 = time.time()
        while time.time() < deadline:
            r = session.get(
                f"{self.base_url}/api/v1/generate",
                params={"id": gen_id},
                timeout=30,
            )
            if r.status_code != 200:
                raise RuntimeError(f"poll HTTP {r.status_code}: {r.text[:500]}")
            data = r.json()
            inner = data.get("data") or data
            status = inner.get("processingStatus", "processing")
            if on_progress:
                on_progress({
                    'stage': 'polling',
                    'status': status,
                    'elapsed': round(time.time() - _t0, 1),
                })
            if status == "completed":
                return inner
            if status == "failed":
                msg = inner.get("errorMessage") or inner.get("message") or str(inner)
                raise RuntimeError(f"NanoBanana 生成失败: {msg}")
            logger.debug("NanoBanana poll id=%s status=%s, sleep %.1fs", gen_id, status, interval)
            time.sleep(interval)
            interval = min(interval * 1.25, 10.0)
        raise RuntimeError(f"NanoBanana 轮询超时 ({self.poll_max_wait}s), id={gen_id}")

    def _download(self, session, url: str, out_path: Path) -> None:
        r = session.get(url, timeout=90)
        if r.status_code != 200:
            raise RuntimeError(f"下载结果图失败 HTTP {r.status_code}: {url[:120]}")
        out_path.write_bytes(r.content)

    # ========= 工具 =========
    def _retry(self, func):
        """简单的重试 — 任何异常视为可重试; ConcurrencyLimitError 使用更长 backoff（等在途任务跑完）。"""
        last_err = None
        for attempt in range(1, self.max_retries + 1):
            try:
                return func()
            except Exception as e:
                last_err = e
                if attempt == self.max_retries:
                    break
                if isinstance(e, ConcurrencyLimitError):
                    # NanoBanana 单张合成耗时约 35-120s，并发限制说明此时 active≥1，
                    # 用更长的退避窗口：30s → 40s → 50s → 60s，保证上一张基本完成再发起新请求
                    sleep_s = 20 + 10 * attempt  # 30s / 40s / 50s / 60s
                else:
                    sleep_s = 2 ** (attempt - 1)
                logger.warning(
                    "NanoBanana 请求第 %d/%d 次失败: %s, %ds 后重试",
                    attempt, self.max_retries, e, sleep_s,
                )
                time.sleep(sleep_s)
        raise last_err

    def _build_prompt(self, prompt: str, width: Optional[int], height: Optional[int]) -> str:
        w = width or self.width
        h = height or self.height
        size_hint = f" | 输出尺寸 {w}x{h}px, 正方形构图, 电商主图风格, 高细节"
        return f"{prompt}{size_hint}"

    @staticmethod
    def _image_to_data_url(image_path: Path, max_side: int) -> Optional[str]:
        try:
            img = Image.open(image_path).convert("RGB")
            if max(img.size) > max_side:
                img.thumbnail((max_side, max_side))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=88)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{b64}"
        except Exception as e:
            logger.warning("NanoBanana: 转换参考图失败 %s: %s", image_path.name, e)
            return None


# ============================================================
# 工厂函数 (根据配置选择合成引擎)
# ============================================================
def get_synthesizer(config: Config) -> Synthesizer:
    """根据配置返回合成引擎实例。"""
    lavort_cfg = getattr(config, "lovart", {}) or getattr(config, "lavort", {})

    # 1. mock 模式优先 (方便联调)
    if lavort_cfg.get("mock", False):
        return MockSynthesizer(config)

    # 2. 指定 engine
    engine = (lavort_cfg.get("engine") or "mock").lower()

    if engine in ("nano_banana", "nanobanana", "nano-banana"):
        return NanoBananaSynthesizer(config)
    if engine == "seedream":
        # 用户要求用 NanoBanana 替换 Seedream; config.yaml 仍为 seedream 且暂不可写,
        # 故此处把 seedream 直接路由到 NanoBananaSynthesizer (原 SeedreamSynthesizer 保留但不再使用)
        return NanoBananaSynthesizer(config)
    if engine in ("lovart", "lovart_skill"):
        return LovartSkillSynthesizer(config)
    if engine == "mock":
        return MockSynthesizer(config)

    logger.warning("未知引擎 %s, 回落到 MockSynthesizer", engine)
    return MockSynthesizer(config)

