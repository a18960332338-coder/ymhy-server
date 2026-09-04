#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性迁移脚本：把「账号维度引入前」的旧扁平 output/ 数据，复制进新的
账号隔离布局 output/<account>/<brand>/<bucket>，使两个账号都持有已有数据。

规则：
- 旧扁平布局中，根级 bucket（crawled/synthesized/videos/...）属于默认品牌 cloudsleepgarden；
  output/sofawithcat/<bucket> 属于软居与猫品牌。
- 旧数据 = 创作者账号的原始数据；同时复制一份给云眠花园账号，使两个账号初始数据一致。
- 复制（不移动），保留原文件作为备份。
- 幂等：目标已存在同名文件则跳过，可重复执行。
"""
import shutil
from datetime import datetime
from pathlib import Path

OUT = Path(__file__).resolve().parent / "output"
BRANDS = ["cloudsleepgarden", "sofawithcat"]
ACCOUNTS = ["ymhy", "creator"]
# 与 _brand_dirs 中的 bucket 保持一致
BUCKETS = [
    "crawled", "synthesized", "videos", "video_refs",
    "templates", "cross_templates", "template_results", "crops",
]
MARKER = OUT / ".account_migrated_v1"


def copy_tree(src: Path, dst: Path) -> int:
    """把 src 下的文件复制到 dst（仅当目标不存在时），返回复制数量。"""
    if not src or not src.exists():
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(src.iterdir()):
        if f.is_file():
            t = dst / f.name
            if not t.exists():
                shutil.copy2(f, t)
                n += 1
    return n


def source_for(brand: str, bucket: str) -> Path:
    """旧扁平布局里，某品牌+bucket 的数据来源目录。"""
    if brand == "cloudsleepgarden":
        # 默认品牌的数据在根级 bucket 下
        return OUT / bucket
    # 软居与猫在 output/sofawithcat/<bucket>
    return OUT / "sofawithcat" / bucket


def main() -> None:
    print(f"[migrate] output 根目录: {OUT}")
    total = 0
    for acc in ACCOUNTS:
        for brand in BRANDS:
            for bk in BUCKETS:
                src = source_for(brand, bk)
                dst = OUT / acc / brand / bk
                n = copy_tree(src, dst)
                total += n
                if n:
                    print(f"  +{n:3d}  {acc}/{brand}/{bk}  <- {src}")
    # 猫咪素材：旧布局没有独立 cats 目录；以两个账号现有 cats 的并集互相补齐，保证一致
    for a, b in (("ymhy", "creator"), ("creator", "ymhy")):
        n = copy_tree(OUT / a / "cats", OUT / b / "cats")
        total += n
        if n:
            print(f"  +{n:3d}  cats sync {a} -> {b}")
    MARKER.write_text(f"migrated at {datetime.now().isoformat(timespec='seconds')}\n", encoding="utf-8")
    print(f"[migrate] 完成，共新增复制 {total} 个文件。标记已写入 {MARKER}")


if __name__ == "__main__":
    main()
