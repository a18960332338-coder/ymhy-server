"""猫咪图资源管理: 扫描本地文件夹, 生成资源池, 支持 MD5 去重与随机匹配。"""
from __future__ import annotations

import logging
import random
from pathlib import Path
from typing import Dict, List, Optional

from .config import Config
from .image_utils import compute_hash, list_images, validate_image

logger = logging.getLogger("cat_manager")


class CatResource:
    def __init__(self, path: Path, md5: str) -> None:
        self.path = path
        self.name = path.name
        self.md5 = md5

    def to_dict(self) -> Dict[str, str]:
        return {"name": self.name, "path": str(self.path), "md5": self.md5}


class CatManager:
    """猫咪图资源池: 扫描 -> 去重 -> 提供随机匹配。"""

    def __init__(self, config: Config) -> None:
        self.cat_dir: Path = config.cat_images_dir
        self._pool: List[CatResource] = []

    # ============ 资源池构建 ============
    def scan(self) -> Dict[str, object]:
        """扫描猫咪图目录, 校验格式并按 MD5 去重, 返回统计信息。"""
        self._pool = []
        seen_md5: Dict[str, Path] = {}
        skipped_invalid = 0
        skipped_dup = 0

        for p in list_images(self.cat_dir):
            if not validate_image(p):
                skipped_invalid += 1
                logger.debug("跳过无效图片: %s", p)
                continue
            md5 = compute_hash(p)
            if md5 in seen_md5:
                skipped_dup += 1
                logger.debug("跳过重复图片: %s (与 %s 重复)", p, seen_md5[md5])
                continue
            seen_md5[md5] = p
            self._pool.append(CatResource(p, md5))

        logger.info(
            "猫咪图扫描完成: 可用=%d, 无效=%d, 重复=%d", len(self._pool), skipped_invalid, skipped_dup
        )
        return {
            "total": len(self._pool),
            "skipped_invalid": skipped_invalid,
            "skipped_duplicate": skipped_dup,
            "resources": [r.to_dict() for r in self._pool],
        }

    # ============ 资源访问 ============
    @property
    def pool(self) -> List[CatResource]:
        return self._pool

    def size(self) -> int:
        return len(self._pool)

    def get_random(self, exclude: Optional[set] = None) -> Optional[CatResource]:
        """随机返回一张猫咪图, 可排除已用过的 MD5。"""
        if not self._pool:
            return None
        candidates = [r for r in self._pool if not exclude or r.md5 not in exclude] or self._pool
        return random.choice(candidates)

    def list_resources(self) -> List[Dict[str, str]]:
        return [r.to_dict() for r in self._pool]
