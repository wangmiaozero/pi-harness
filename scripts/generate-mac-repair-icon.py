#!/usr/bin/env python3
"""生成「修复」App 的徽章图标（主图标 + 右下角橙色扳手徽章）。

仅供维护图标时手动运行，不在构建链中：

    python3 scripts/generate-mac-repair-icon.py

依赖：系统 python3、Pillow、/usr/bin/iconutil（macOS 自带）。
产物写入 resources/macos/QuarantineRepair.app/Contents/Resources/AppIcon.icns。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BASE_ICON = ROOT / 'build' / 'icon.png'
TEMPLATE_RESOURCES = ROOT / 'resources' / 'macos' / 'QuarantineRepair.app' / 'Contents' / 'Resources'
ICONSET_SIZES = [16, 32, 128, 256, 512]


def draw_badge(size: int) -> Image.Image:
    """右下角橙色圆形徽章 + 白色扳手，绘制在透明图层上。"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    cx = int(size * 0.772)
    cy = int(size * 0.772)
    radius = int(size * 0.205)

    # 橙色径向渐变底
    for r in range(radius, 0, -1):
        t = 1 - r / radius
        color = (
            int(251 + (194 - 251) * t),
            int(146 + (65 - 146) * t),
            int(60 + (12 - 60) * t),
            255,
        )
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)

    # 白色描边：在深色/透明背景上均能保持徽章轮廓
    stroke = max(2, int(size * 0.014))
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        outline=(255, 255, 255, 255),
        width=stroke,
    )

    # 扳手：单独图层绘制后旋转 45°，再贴回徽章中心
    wrench_len = int(radius * 1.06)
    tool = Image.new('RGBA', (wrench_len * 2, wrench_len * 2), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tool)
    wcx, wcy = wrench_len, wrench_len
    bar_h = int(wrench_len * 0.30)
    # 柄
    tdraw.rounded_rectangle(
        (wcx - int(wrench_len * 0.92), wcy - bar_h // 2, wcx + int(wrench_len * 0.55), wcy + bar_h // 2),
        radius=bar_h // 2,
        fill=(255, 255, 255, 255),
    )
    # 开口头：C 形弧 + 封闭端圆
    tdraw.ellipse(
        (
            wcx + int(wrench_len * 0.10),
            wcy - int(wrench_len * 0.52),
            wcx + int(wrench_len * 0.92),
            wcy + int(wrench_len * 0.30),
        ),
        outline=(255, 255, 255, 255),
        width=int(wrench_len * 0.24),
    )
    tdraw.ellipse(
        (
            wcx - int(wrench_len * 1.0),
            wcy - int(wrench_len * 0.34),
            wcx - int(wrench_len * 0.42),
            wcy + int(wrench_len * 0.34),
        ),
        fill=(255, 255, 255, 255),
    )
    tool = tool.rotate(-45, resample=Image.Resampling.BICUBIC)
    layer.alpha_composite(tool, (cx - wrench_len, cy - wrench_len))
    return layer


def build_repair_icon() -> Image.Image:
    base = Image.open(BASE_ICON).convert('RGBA')
    base.alpha_composite(draw_badge(base.width))
    return base


def main() -> int:
    if not BASE_ICON.exists():
        print(f'缺少基准图标: {BASE_ICON}', file=sys.stderr)
        return 1
    if not shutil.which('iconutil'):
        print('未找到 iconutil（需要在 macOS 上运行）', file=sys.stderr)
        return 1

    master = build_repair_icon()
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / 'repair.iconset'
        iconset.mkdir()
        for icon_size in ICONSET_SIZES:
            master.resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(
                iconset / f'icon_{icon_size}x{icon_size}.png'
            )
            if icon_size <= 512:
                master.resize((icon_size * 2, icon_size * 2), Image.Resampling.LANCZOS).save(
                    iconset / f'icon_{icon_size}x{icon_size}@2x.png'
                )
        out = TEMPLATE_RESOURCES / 'AppIcon.icns'
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ['iconutil', '-c', 'icns', str(iconset), '-o', str(out)],
            check=True,
        )
        print(f'已生成 {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
