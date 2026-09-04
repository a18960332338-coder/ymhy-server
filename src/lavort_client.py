"""Lovart AI图像合成核心 - 通过 OpenClaw Skill 方式接入。

按 Lovart 官方文档 (https://clawhub.ai/lovart-admin/lovart-skill) 实现:
  - 不直接调用 REST API (RULE #0 禁止)
  - 通过 subprocess 调用 agent_skill.py CLI 命令驱动生成
  - 工作流: config检查 → (首次)创建项目 → upload主图 → upload猫咪图 → chat合成 → 取回结果

命令参考:
  config --json                                    检查本地状态(active_project)
  project-add --project-id PID --name "Name"       创建/绑定项目
  threads --json                                   列出对话线程
  upload --file /path/to/image.png                 上传文件 → 返回 CDN URL
  chat --prompt "..." --attachments "URL1,URL2" --json --download --output-dir DIR
                                                   发送合成请求, 阻塞至完成, 下载结果
  result --thread-id TID --json --download         取回已有线程结果

chat --json 返回结构:
  {
    "thread_id": "xxx",
    "final_status": "done" | "pending_confirmation" | "abort" | "timeout",
    "generation_succeeded": true/false,
    "downloaded": [{"type": "image", "url": "...", "local_path": "/path/to/file.png"}],
    "warning": "...(generation_succeeded=false时)",
    "agent_message": "...(agent文本回复)"
  }

mock 模式: skill 未安装时用 Pillow 本地合成占位图, 便于联调。

本模块文件名保留 lavort_client.py 以兼容已有引用, 实际为 Lovart Skill 接入。
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw

from .config import Config

logger = logging.getLogger("lovart")

# agent_skill.py 常见安装路径 (留空配置时自动搜索)
SKILL_SEARCH_PATHS = [
    Path.home() / ".openclaw/skills/lovart-skill/scripts/agent_skill.py",
    Path.home() / ".openclaw/skills/@lovart-admin/lovart-skill/scripts/agent_skill.py",
    Path.home() / ".skills/lovart-skill/scripts/agent_skill.py",
    Path("/usr/local/share/openclaw/skills/lovart-skill/scripts/agent_skill.py"),
    Path("/opt/openclaw/skills/lovart-skill/scripts/agent_skill.py"),
]


class LovartClient:
    """通过 OpenClaw Lovart Skill 进行图像合成。"""

    def __init__(self, config: Config) -> None:
        # 兼容 config.yaml 中 lovart 配置段 (用 getattr 兼容旧版 Config 仅有 lavort 属性的情况)
        self._lovart_cfg = getattr(config, "lovart", None) or getattr(config, "lavort", {})
        self.access_key = self._lovart_cfg.get("access_key", "")
        self.secret_key = self._lovart_cfg.get("secret_key", "")
        self.width = int(self._lovart_cfg.get("width", 800))
        self.height = int(self._lovart_cfg.get("height", 800))
        self.timeout = int(self._lovart_cfg.get("timeout", 120))
        self.mock = bool(self._lovart_cfg.get("mock", True))
        self.project_id = self._lovart_cfg.get("project_id", "")
        self.project_name = self._lovart_cfg.get("project_name", "云眠花园主图生成")
        self._skill_script: Optional[Path] = None
        self._project_initialized = False

    # ============ Skill 脚本定位 ============
    @property
    def skill_script(self) -> Optional[Path]:
        """返回 agent_skill.py 路径, 找不到返回 None。"""
        if self._skill_script is not None:
            return self._skill_script
        # 1. 配置指定
        configured = self._lovart_cfg.get("skill_script", "")
        if configured:
            p = Path(configured)
            if p.exists():
                self._skill_script = p
                return p
        # 2. 自动搜索
        for p in SKILL_SEARCH_PATHS:
            if p.exists():
                self._skill_script = p
                logger.info("找到 Lovart skill: %s", p)
                return p
        return None

    def is_skill_available(self) -> bool:
        """检查 agent_skill.py 是否可用。"""
        return self.skill_script is not None

    # ============ 公共入口 ============
    def synthesize(
        self,
        main_image: Path,
        cat_image: Path,
        prompt: str,
        out_path: Optional[Path] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> Path:
        """合成单张主图, 返回保存路径。

        mock 模式: 用 Pillow 本地合成占位图。
        真实模式: 通过 agent_skill.py upload + chat 驱动 Lovart 生成。
        """
        if out_path is None:
            raise ValueError("out_path 不能为空")

        if self.mock:
            data = self._mock_synthesize(main_image, cat_image, prompt, width or self.width, height or self.height)
        else:
            if not self.is_skill_available():
                raise RuntimeError(
                    "Lovart skill (agent_skill.py) 未找到。请先安装:\n"
                    "  1. brew install openclaw  (或从 https://openclaw.ai 下载)\n"
                    "  2. openclaw skills install @lovart-admin/lovart-skill\n"
                    "或在 config.yaml -> lovart.skill_script 指定 agent_skill.py 路径。\n"
                    "暂时可将 mock 设为 true 进行本地联调。"
                )
            data = self._call_skill(main_image, cat_image, prompt, out_path, width or self.width, height or self.height)
            if isinstance(data, Path):
                if data != out_path:
                    shutil.copy2(data, out_path)
                return out_path

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(data)
        logger.info("合成完成 -> %s", out_path)
        return out_path

    # ============ Skill 真实调用 ============
    def _call_skill(
        self, main_image: Path, cat_image: Path, prompt: str, out_path: Path, w: int, h: int
    ) -> bytes:
        """通过 agent_skill.py CLI 驱动 Lovart 合成。

        流程:
          1. 首次运行: config --json 检查项目, 无则 project-add 创建
          2. upload --file main_image → 获取 CDN URL
          3. upload --file cat_image → 获取 CDN URL
          4. chat --prompt "..." --attachments "MAIN_URL,CAT_URL" --json --download
          5. 解析返回 JSON, 提取 downloaded[0].local_path → 读取图片 bytes
        """
        env = self._build_env()
        script = self.skill_script
        assert script is not None

        # Step 1: 确保项目已初始化
        self._ensure_project(env, script)

        # Step 2: 上传主图
        main_url = self._upload_file(main_image, env, script)
        if not main_url:
            raise RuntimeError(f"上传主图失败: {main_image}")
        logger.info("主图已上传: %s → %s", main_image.name, main_url)

        # Step 3: 上传猫咪图
        cat_url = self._upload_file(cat_image, env, script)
        if not cat_url:
            raise RuntimeError(f"上传猫咪图失败: {cat_image}")
        logger.info("猫咪图已上传: %s → %s", cat_image.name, cat_url)

        # Step 4: chat 合成
        full_prompt = self._build_prompt_with_size(prompt, w, h)
        download_dir = out_path.parent / "_lovart_tmp"
        download_dir.mkdir(parents=True, exist_ok=True)

        result = self._run_command(
            script, env,
            ["chat", "--prompt", full_prompt, "--attachments", f"{main_url},{cat_url}",
             "--json", "--download", "--output-dir", str(download_dir)],
            timeout=self.timeout,
        )
        chat_data = self._parse_json_output(result.stdout)
        if not chat_data:
            raise RuntimeError(f"chat 返回非JSON: {result.stdout[:500]}")

        # Step 5: 处理结果
        return self._handle_chat_result(chat_data, download_dir, out_path)

    def _build_env(self) -> Dict[str, str]:
        """构建子进程环境变量, 注入 AK/SK。"""
        env = dict(os.environ)
        if self.access_key:
            env["LOVART_ACCESS_KEY"] = self.access_key
        if self.secret_key:
            env["LOVART_SECRET_KEY"] = self.secret_key
        return env

    def _ensure_project(self, env: Dict[str, str], script: Path) -> None:
        """首次运行时检查/创建 Lovart 项目。"""
        if self._project_initialized:
            return

        result = self._run_command(script, env, ["config", "--json"], timeout=10)
        cfg_data = self._parse_json_output(result.stdout)

        if cfg_data and cfg_data.get("active_project"):
            self.project_id = cfg_data["active_project"]
            logger.info("使用已有 Lovart 项目: %s", self.project_id)
        elif self.project_id:
            self._run_command(
                script, env,
                ["project-add", "--project-id", self.project_id, "--name", self.project_name],
                timeout=10,
            )
            logger.info("绑定 Lovart 项目: %s", self.project_id)
        else:
            new_pid = f"csg_{uuid.uuid4().hex[:8]}"
            self._run_command(
                script, env,
                ["project-add", "--project-id", new_pid, "--name", self.project_name],
                timeout=10,
            )
            self.project_id = new_pid
            logger.info("创建新 Lovart 项目: %s (%s)", new_pid, self.project_name)

        self._project_initialized = True

    def _upload_file(self, file_path: Path, env: Dict[str, str], script: Path) -> Optional[str]:
        """上传文件到 Lovart CDN, 返回 URL。"""
        result = self._run_command(
            script, env, ["upload", "--file", str(file_path)], timeout=60,
        )
        data = self._parse_json_output(result.stdout)
        if data and data.get("url"):
            return data["url"]
        logger.warning("upload 返回无 url 字段: %s", result.stdout[:300])
        return None

    def _handle_chat_result(self, chat_data: Dict[str, Any], download_dir: Path, out_path: Path) -> bytes:
        """处理 chat 命令返回结果, 返回图片 bytes。"""
        final_status = chat_data.get("final_status", "")
        succeeded = chat_data.get("generation_succeeded", True)

        if not succeeded:
            warning = chat_data.get("warning", "未知原因")
            agent_msg = chat_data.get("agent_message", "")
            raise RuntimeError(f"Lovart 生成失败: {warning}" + (f" (agent: {agent_msg})" if agent_msg else ""))

        if final_status == "pending_confirmation":
            raise RuntimeError("Lovart 需要用户确认高消耗操作, 暂不支持自动确认")
        if final_status == "abort":
            raise RuntimeError("Lovart 生成被中止")
        if final_status == "timeout":
            logger.warning("Lovart 生成超时, 尝试取回已有结果")

        downloaded = chat_data.get("downloaded", [])
        if not downloaded:
            # 尝试从 artifacts URL 下载
            items = chat_data.get("items", [])
            for item in items:
                if item.get("type") == "generator":
                    for art in item.get("artifacts", []):
                        if art.get("type") == "image" and art.get("content"):
                            return self._download_url(art["content"], out_path)
            raise RuntimeError("Lovart 返回成功但无图片产物")

        local_path = downloaded[0].get("local_path")
        if local_path and Path(local_path).exists():
            with open(local_path, "rb") as f:
                return f.read()

        url = downloaded[0].get("url")
        if url:
            return self._download_url(url, out_path)

        raise RuntimeError(f"无法获取合成结果文件: {downloaded[0]}")

    def _download_url(self, url: str, out_path: Path) -> bytes:
        """下载已生成结果文件的 URL。

        注意: 这是下载 Lovart 已生成完成的结果文件, 不是 API 调用,
        不违反 RULE #0 (RULE #0 禁止的是构造 API 端点, 而非下载产物)。
        优先用 agent_skill.py download 命令, 失败则用 urllib 兜底。
        """
        # 优先走 skill download 命令
        script = self.skill_script
        if script:
            env = self._build_env()
            tmp_dir = out_path.parent / "_lovart_tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            try:
                result = self._run_command(
                    script, env,
                    ["download", "--urls", url, "--output-dir", str(tmp_dir), "--prefix", "lovart_result"],
                    timeout=60,
                )
                data = self._parse_json_output(result.stdout)
                # download 可能返回 JSON 数组或对象
                items = data if isinstance(data, list) else [data] if data else []
                for it in items:
                    lp = it.get("local_path") if isinstance(it, dict) else None
                    if lp and Path(lp).exists():
                        with open(lp, "rb") as f:
                            return f.read()
            except Exception as e:
                logger.debug("skill download 失败, 改用 urllib: %s", e)

        # urllib 兜底 (下载产物文件, 非 API 调用)
        import urllib.request
        tmp = out_path.parent / "_lovart_tmp" / "lovart_download.tmp"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(url, tmp)
            with open(tmp, "rb") as f:
                return f.read()
        except Exception as e:
            raise RuntimeError(f"下载结果文件失败 {url}: {e}") from e

    # ============ subprocess 工具 ============
    def _run_command(
        self, script: Path, env: Dict[str, str], args: List[str], timeout: int = 120
    ) -> subprocess.CompletedProcess:
        """执行 agent_skill.py 子命令。"""
        cmd = [sys.executable, str(script)] + args
        logger.debug("执行: %s", " ".join(cmd[:3]) + " ... " + " ".join(cmd[-2:]))
        result = subprocess.run(
            cmd, env=env, capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            err = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(
                f"agent_skill.py {' '.join(args[:1])} 失败 (exit={result.returncode}): {err[:500]}"
            )
        return result

    @staticmethod
    def _parse_json_output(stdout: str) -> Optional[Any]:
        """从 stdout 解析 JSON (兼容对象/数组/NDJSON/前后有非JSON文本)。"""
        stdout = stdout.strip()
        if not stdout:
            return None
        # 尝试直接解析
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass
        # 尝试提取第一个 { ... } 或 [ ... ] 块
        for opener, closer in (("{", "}"), ("[", "]")):
            start = stdout.find(opener)
            end = stdout.rfind(closer)
            if start >= 0 and end > start:
                try:
                    return json.loads(stdout[start : end + 1])
                except json.JSONDecodeError:
                    continue
        # 尝试 NDJSON (取最后一行 JSON 对象)
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        return None

    @staticmethod
    def _build_prompt_with_size(prompt: str, w: int, h: int) -> str:
        """在 prompt 中加入尺寸要求。"""
        return f"{prompt} | Output size: {w}x{h}px, square format."

    # ============ Mock 合成 (本地联调) ============
    def _mock_synthesize(
        self, main_image: Path, cat_image: Path, prompt: str, w: int, h: int
    ) -> bytes:
        """用 Pillow 本地合成占位图: 主图铺底 + 猫咪图右下角 + 文字水印。"""
        canvas = Image.new("RGB", (w, h), (255, 255, 255))
        try:
            main = Image.open(main_image).convert("RGB")
            main.thumbnail((w, h))
            mx = (w - main.width) // 2
            my = (h - main.height) // 2
            canvas.paste(main, (mx, my))
        except Exception as e:
            logger.debug("mock 主图加载失败: %s", e)
        try:
            cat = Image.open(cat_image).convert("RGBA")
            cat.thumbnail((w // 3, h // 3))
            canvas.paste(cat, (w - cat.width - 10, h - cat.height - 10), cat)
        except Exception as e:
            logger.debug("mock 猫咪图加载失败: %s", e)
        draw = ImageDraw.Draw(canvas)
        draw.text((10, 10), "[MOCK] 云眠花园 AI主图", fill=(255, 0, 0))
        draw.text((10, h - 24), prompt[:60], fill=(80, 80, 80))
        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        return buf.getvalue()


# 兼容旧类名 (历史代码引用 LavortClient)
LavortClient = LovartClient
