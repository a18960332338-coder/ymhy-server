#!/usr/bin/env python3
"""云眠花园主图生成工具 V1.0 - CLI 入口。

子命令:
  crawl      批量爬取 1688 主图 (需在 config.yaml 启用 alibaba)
  cats       扫描猫咪图资源池
  synthesize 单组合成: 指定主图 + 猫咪图
  batch      批量合成: 用已爬取的主图 + 随机猫咪图
  pipeline   全流程: 爬取 -> 批量合成

示例:
  python main.py cats
  python main.py synthesize --main output/crawled/123_1.jpg --cat input/cat_images/cat1.png
  python main.py batch --template 0
  python main.py pipeline
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from src.cat_manager import CatManager
from src.crawler_1688 import Crawler1688
from src.image_utils import list_images
from src.synthesizer import get_synthesizer, SeedreamPending, Synthesizer
from src.scheduler import BatchScheduler
from src.config import get_config


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def read_links(links_file: Path) -> list[str]:
    if not links_file.exists():
        return []
    links = []
    for line in links_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            links.append(line)
    return links


# ============ 子命令实现 ============
def cmd_cats(args, cfg) -> None:
    cm = CatManager(cfg)
    info = cm.scan()
    print(f"猫咪图资源池: 可用 {info['total']} 张 (无效 {info['skipped_invalid']}, 重复 {info['skipped_duplicate']})")
    for r in info["resources"]:
        print(f"  - {r['name']}  md5={r['md5'][:12]}...")


def cmd_crawl(args, cfg) -> None:
    links = read_links(cfg.product_links)
    if not links:
        print("未在 input/product_links.txt 中找到有效链接")
        return
    crawler = Crawler1688(cfg)
    results = crawler.crawl_batch(links)
    total_imgs = 0
    for pid, r in results.items():
        print(f"[{pid}] {r['status']}  图片数={len(r['images'])}  {r['reason']}")
        total_imgs += len(r["images"])
    print(f"爬取结束: 共 {total_imgs} 张图片 -> {cfg.crawled_dir}")


def cmd_synthesize(args, cfg) -> None:
    synthesizer: Synthesizer = get_synthesizer(cfg)
    scheduler = BatchScheduler(cfg)
    prompt = scheduler.get_prompt(args.template, args.subject)
    main = Path(args.main)
    cat = Path(args.cat)
    if not main.exists():
        print(f"主图不存在: {main}")
        return
    if not cat.exists():
        print(f"猫咪图不存在: {cat}")
        return
    out = Path(args.out) if args.out else (cfg.synthesized_dir / f"single_{main.stem}.png")
    try:
        synthesizer.synthesize(main, cat, prompt, out)
        print(f"合成完成: {out}")
        print(f"  引擎: {synthesizer.__class__.__name__}")
    except SeedreamPending as e:
        print(f"任务已入队 Seedream 待生成: {out}")
        print(f"  提示: 请在此会话中调用 Agent 的 GenerateImage 工具完成真实生成")
        print(f"  详情: {e}")


def cmd_batch(args, cfg) -> None:
    main_images = list_images(cfg.crawled_dir)
    if not main_images:
        print(f"未在 {cfg.crawled_dir} 找到主图, 请先执行 crawl 或放入主图")
        return
    cm = CatManager(cfg)
    cm.scan()
    if cm.size() == 0:
        print(f"未在 {cfg.cat_images_dir} 找到猫咪图, 请先放入猫咪图")
        return
    scheduler = BatchScheduler(cfg)
    report = scheduler.run(main_images, cm, template_index=args.template, subject=args.subject)
    _print_report(report)


def cmd_pipeline(args, cfg) -> None:
    # 1. 爬取
    links = read_links(cfg.product_links)
    if links:
        print("=== 步骤1: 爬取 1688 主图 ===")
        cmd_crawl(args, cfg)
    else:
        print("=== 步骤1: 跳过爬取 (无链接) ===")
    # 2. 批量合成
    print("=== 步骤2: 批量合成 ===")
    cmd_batch(args, cfg)


def _print_report(report) -> None:
    print("\n===== 批量任务报告 =====")
    print(f"批次: {report.batch_id}")
    print(f"总数: {report.total}  成功: {report.success}  失败: {report.fail}  成功率: {report.to_dict()['success_rate']}")
    for it in report.items:
        flag = "OK " if it.status == "success" else "ERR"
        print(f"  [{it.index:02d}] {flag}  {Path(it.main_image).name} + {Path(it.cat_image).name}  ({it.elapsed:.2f}s)  {it.reason}")


# ============ 参数解析 ============
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cloud-sleep-garden",
        description="云眠花园主图生成工具 V1.0 (1688主图爬取 + 猫咪元素AI合成)",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="调试日志")
    p.add_argument("-c", "--config", default=None, help="配置文件路径(默认 config.yaml)")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("cats", help="扫描猫咪图资源池")
    sp.set_defaults(func=cmd_cats)

    sp = sub.add_parser("crawl", help="批量爬取 1688 主图")
    sp.set_defaults(func=cmd_crawl)

    sp = sub.add_parser("synthesize", help="单组合成")
    sp.add_argument("--main", required=True, help="家纺主图路径")
    sp.add_argument("--cat", required=True, help="猫咪图路径")
    sp.add_argument("--template", type=int, default=0, help="关键词模板序号")
    sp.add_argument("--subject", default=None, help="家纺品类描述(覆盖默认)")
    sp.add_argument("--out", default=None, help="输出路径")
    sp.set_defaults(func=cmd_synthesize)

    sp = sub.add_parser("batch", help="批量合成(用已爬取主图)")
    sp.add_argument("--template", type=int, default=0, help="关键词模板序号")
    sp.add_argument("--subject", default=None, help="家纺品类描述(覆盖默认)")
    sp.set_defaults(func=cmd_batch)

    sp = sub.add_parser("pipeline", help="全流程: 爬取 -> 批量合成")
    sp.add_argument("--template", type=int, default=0, help="关键词模板序号")
    sp.add_argument("--subject", default=None, help="家纺品类描述(覆盖默认)")
    sp.set_defaults(func=cmd_pipeline)

    return p


def main() -> int:
    args = build_parser().parse_args()
    setup_logging(args.verbose)
    cfg = get_config(args.config)
    cfg.ensure_dirs()
    args.func(args, cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
