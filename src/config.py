"""配置加载模块: 读取 config.yaml 并解析路径为绝对路径。

沙箱兼容: synthesized_dir / logs_dir 如果受 macOS 沙箱 (EPERM) 写入受限,
则透明 fallback 到 $HOME/Library/Caches/CloudSleepGarden/ 下对应子目录。
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Dict

import yaml

# 项目根目录 (本文件位于 <root>/src/config.py)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"

# macOS 用户级可写缓存目录 (TRAE 沙箱下仍然可写)
_FALLBACK_ROOT = Path.home() / "Library" / "Caches" / "CloudSleepGarden"


def _is_writable(path: Path) -> bool:
    """判断路径(及其父目录)是否可写入 — 用临时文件测试。"""
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=str(path), suffix=".w", delete=True) as f:
            f.write(b".")
            f.flush()
        return True
    except Exception:
        return False


class Config:
    """全局配置单例, 所有路径解析为绝对路径。"""

    def __init__(self, config_path: str | Path | None = None) -> None:
        self.config_path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
        if not self.config_path.exists():
            raise FileNotFoundError(f"配置文件不存在: {self.config_path}")
        with open(self.config_path, "r", encoding="utf-8") as f:
            self._raw: Dict[str, Any] = yaml.safe_load(f) or {}
        self._resolve_paths()
        self._apply_writable_fallbacks()

    # ---- 路径解析 ----
    def _resolve_paths(self) -> None:
        paths = self._raw.get("paths", {})
        self.paths: Dict[str, Path] = {}
        for key, rel in paths.items():
            p = Path(rel)
            self.paths[key] = p if p.is_absolute() else (PROJECT_ROOT / p)

    def _apply_writable_fallbacks(self) -> None:
        """对 synthesized/logs 等纯输出目录, 若受沙箱限制则切换到用户缓存目录。

        输入型目录 (crawled/cat_images) 仅需读取, 不做切换。
        """
        # synthesized_dir
        orig = self.paths.get("synthesized_dir")
        if orig and not _is_writable(orig):
            fb = _FALLBACK_ROOT / "synthesized"
            fb.mkdir(parents=True, exist_ok=True)
            self.paths["synthesized_dir"] = fb
        # logs_dir
        orig = self.paths.get("logs_dir")
        if orig and not _is_writable(orig):
            fb = _FALLBACK_ROOT / "logs"
            fb.mkdir(parents=True, exist_ok=True)
            self.paths["logs_dir"] = fb

    # ---- 目录访问 ----
    @property
    def product_links(self) -> Path:
        return self.paths["product_links"]

    @property
    def cat_images_dir(self) -> Path:
        return self.paths["cat_images_dir"]

    @property
    def crawled_dir(self) -> Path:
        return self.paths["crawled_dir"]

    @property
    def synthesized_dir(self) -> Path:
        return self.paths["synthesized_dir"]

    @property
    def logs_dir(self) -> Path:
        return self.paths["logs_dir"]

    @property
    def keywords_file(self) -> Path:
        return self.paths["keywords_file"]

    # ---- 子配置 ----
    @property
    def alibaba(self) -> Dict[str, Any]:
        return self._raw.get("alibaba", {})

    @property
    def lovart(self) -> Dict[str, Any]:
        return self._raw.get("lovart") or self._raw.get("lavort", {})

    @property
    def lavort(self) -> Dict[str, Any]:
        return self.lovart

    @property
    def scheduler(self) -> Dict[str, Any]:
        return self._raw.get("scheduler", {})

    @property
    def web(self) -> Dict[str, Any]:
        return self._raw.get("web", {})

    @property
    def nano_banana(self) -> Dict[str, Any]:
        return self._raw.get("nano_banana", {})

    @property
    def browser(self) -> Dict[str, Any]:
        return self._raw.get("browser", {})

    # ---- 初始化所有输出目录 ----
    def ensure_dirs(self) -> None:
        for d in [
            self.cat_images_dir,
            self.crawled_dir,
            self.synthesized_dir,
            self.logs_dir,
        ]:
            d.mkdir(parents=True, exist_ok=True)

    def as_dict(self) -> Dict[str, Any]:
        return self._raw


# 默认全局实例
_config: Config | None = None


def get_config(config_path: str | Path | None = None) -> Config:
    global _config
    if _config is None or config_path is not None:
        _config = Config(config_path)
    return _config
