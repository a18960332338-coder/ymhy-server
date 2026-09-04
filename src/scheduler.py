"""批量任务调度: 配对主图+猫咪图, 按顺序调用合成API, 失败自动重试, 输出日志。"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .cat_manager import CatManager
from .config import Config
from .synthesizer import Synthesizer, get_synthesizer, SeedreamPending

logger = logging.getLogger("scheduler")


@dataclass
class TaskItem:
    index: int
    main_image: str
    cat_image: str
    prompt: str
    status: str = "pending"          # pending | success | fail | pending_seedream
    output: str = ""
    attempts: int = 0
    reason: str = ""
    elapsed: float = 0.0


@dataclass
class BatchReport:
    batch_id: str
    started_at: str
    finished_at: str = ""
    total: int = 0
    success: int = 0
    fail: int = 0
    pending: int = 0
    items: List[TaskItem] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "total": self.total,
            "success": self.success,
            "fail": self.fail,
            "pending": self.pending,
            "success_rate": f"{(self.success / self.total * 100):.1f}%" if self.total else "0%",
            "items": [asdict(i) for i in self.items],
        }


class BatchScheduler:
    def __init__(self, config: Config) -> None:
        self.cfg = config
        self.scfg = config.scheduler
        self.max_pairs: int = int(self.scfg.get("max_pairs", 20))
        self.retry_times: int = int(self.scfg.get("retry_times", 2))
        self.retry_interval: float = float(self.scfg.get("retry_interval", 1))
        self.synthesized_dir: Path = config.synthesized_dir
        self.logs_dir: Path = config.logs_dir
        self.synthesizer: Synthesizer = get_synthesizer(config)
        self.keywords = self._load_keywords()

    # ============ 关键词模板 ============
    def _load_keywords(self) -> Dict[str, Any]:
        kf = self.cfg.keywords_file
        if not kf.exists():
            logger.warning("关键词模板文件不存在: %s", kf)
            return {"templates": [], "default_subject": "product"}
        with open(kf, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def get_prompt(self, template_index: int = 0, subject: Optional[str] = None) -> str:
        templates = self.keywords.get("templates", [])
        subj = subject or self.keywords.get("default_subject", "product")
        if not templates:
            return f"A {subj} with a cute cat, e-commerce product main image, high detail"
        tpl = templates[template_index % len(templates)]
        return tpl["prompt"].format(subject=subj)

    # ============ 配对构造 ============
    def build_pairs(
        self,
        main_images: List[Path],
        cat_manager: CatManager,
        template_index: int = 0,
        subject: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """主图与猫咪图随机配对, 单次最多 max_pairs 组。"""
        pairs: List[Dict[str, Any]] = []
        used_cat_md5: set = set()
        prompt = self.get_prompt(template_index, subject)
        for i, main in enumerate(main_images[: self.max_pairs]):
            cat = cat_manager.get_random(exclude=used_cat_md5)
            if cat is None:
                logger.warning("猫咪图资源不足, 仅配对 %d 组", i)
                break
            used_cat_md5.add(cat.md5)
            pairs.append(
                {"main_image": main, "cat_image": cat.path, "prompt": prompt, "cat_name": cat.name}
            )
        return pairs

    # ============ 批量执行 ============
    def run(
        self,
        main_images: List[Path],
        cat_manager: CatManager,
        template_index: int = 0,
        subject: Optional[str] = None,
    ) -> BatchReport:
        batch_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        report = BatchReport(batch_id=batch_id, started_at=datetime.now().isoformat(timespec="seconds"))
        pairs = self.build_pairs(main_images, cat_manager, template_index, subject)
        report.total = len(pairs)
        logger.info("批量任务启动: batch=%s, 配对数=%d", batch_id, report.total)

        for idx, pair in enumerate(pairs, start=1):
            item = TaskItem(
                index=idx,
                main_image=str(pair["main_image"]),
                cat_image=str(pair["cat_image"]),
                prompt=pair["prompt"],
            )
            out_name = f"{batch_id}_{idx:02d}_{Path(pair['main_image']).stem}_{Path(pair['cat_image']).stem}.png"
            out_path = self.synthesized_dir / out_name

            ok, reason, elapsed = self._run_with_retry(
                pair["main_image"], pair["cat_image"], pair["prompt"], out_path
            )
            if ok is None:
                # Seedream 入队 pending
                item.attempts = 1
                item.status = "pending_seedream"
                item.output = str(out_path)
                item.reason = reason
                item.elapsed = 0.0
                report.pending += 1
            else:
                item.attempts = self.retry_times + 1 if not ok else 1
                item.status = "success" if ok else "fail"
                item.output = str(out_path) if ok else ""
                item.reason = reason
                item.elapsed = elapsed
                if ok:
                    report.success += 1
                else:
                    report.fail += 1
            report.items.append(item)
            
            logger.info(
                "[%d/%d] %s (用时%.2fs)", idx, report.total, item.status.upper(), elapsed
            )

        report.finished_at = datetime.now().isoformat(timespec="seconds")
        self._save_report(report)
        logger.info(
            "批量任务完成: 成功=%d, 失败=%d, 待生成=%d, 成功率=%.1f%%",
            report.success, report.fail, report.pending,
            (report.success / report.total * 100) if report.total else 0.0,
        )
        return report

    def _run_with_retry(
        self, main_image: Path, cat_image: Path, prompt: str, out_path: Path
    ) -> tuple:
        last_err = ""
        for attempt in range(self.retry_times + 1):
            start = time.time()
            try:
                self.synthesizer.synthesize(main_image, cat_image, prompt, out_path)
                return True, "", time.time() - start
            except SeedreamPending as e:
                # Seedream 已入队,不重试,直接返回 pending 标记
                return None, str(e), 0.0
            except Exception as e:
                last_err = str(e)
                logger.warning("第%d次尝试失败: %s", attempt + 1, e)
                if attempt < self.retry_times:
                    time.sleep(self.retry_interval)
        return False, last_err, 0.0

    # ============ 日志持久化 ============
    def _save_report(self, report: BatchReport) -> Path:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        log_path = self.logs_dir / f"batch_{report.batch_id}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info("任务日志已保存: %s", log_path)
        return log_path
