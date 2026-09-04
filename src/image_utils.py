"""图片校验工具: 基于 Pillow 做格式校验、白底检测、哈希去重。"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Dict, List

from PIL import Image

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff"}


def is_supported_image(path: str | Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTS


def validate_image(path: str | Path) -> bool:
    """校验图片可被 Pillow 正常打开且为受支持格式（JPG/PNG/WebP 等）。"""
    p = Path(path)
    if not p.exists() or not is_supported_image(p):
        return False
    try:
        with Image.open(p) as im:
            im.verify()  # 仅校验, 不解码
        return True
    except Exception:
        return False


def get_image_info(path: str | Path) -> Dict[str, object]:
    """返回图片基础信息: 宽高、格式、色彩模式。"""
    with Image.open(path) as im:
        return {
            "width": im.width,
            "height": im.height,
            "format": im.format,
            "mode": im.mode,
        }


def compute_hash(path: str | Path) -> str:
    """计算文件 MD5, 用于猫咪图去重校验。"""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def is_white_background(path: str | Path, threshold: int = 245, sample_ratio: float = 0.1) -> bool:
    """粗略判断是否为白底图: 采样四角区域, 像素均值接近白色视为白底。

    Args:
        path: 图片路径
        threshold: RGB 均值 >= threshold 视为接近白色
        sample_ratio: 角落采样区域占边长的比例
    """
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            sw, sh = max(1, int(w * sample_ratio)), max(1, int(h * sample_ratio))
            corners = [
                (0, 0, sw, sh),                 # 左上
                (w - sw, 0, w, sh),             # 右上
                (0, h - sh, sw, h),             # 左下
                (w - sw, h - sh, w, h),         # 右下
            ]
            total, count = 0, 0
            for box in corners:
                for px in im.crop(box).getdata():
                    total += sum(px) / 3.0
                    count += 1
            avg = total / count if count else 0
            return avg >= threshold
    except Exception:
        return False


def list_images(directory: str | Path) -> List[Path]:
    """列出目录下所有受支持的图片文件。"""
    d = Path(directory)
    if not d.exists():
        return []
    return sorted([p for p in d.iterdir() if p.is_file() and is_supported_image(p)])


def load_image_bytes(path: str | Path) -> bytes:
    with open(path, "rb") as f:
        return f.read()
