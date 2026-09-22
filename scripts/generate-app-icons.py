#!/usr/bin/env python3
"""Regenerate the three runtime icons and the classic installer icon."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
OPTIONS = BUILD / 'app-icons'
CLASSIC_SOURCE = ROOT / 'src/renderer/src/assets/app-icon-classic.png'


def make_quantum_icon() -> Image.Image:
    size = 1024
    icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    background = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pixels = background.load()
    for y in range(size):
        for x in range(size):
            radius = math.hypot((x - 590) / 760, (y - 490) / 760)
            light = max(0, 1 - radius)
            pixels[x, y] = (int(19 + 17 * light), int(22 + 22 * light), int(43 + 49 * light), 255)
    mask = Image.new('L', (size, size))
    ImageDraw.Draw(mask).rounded_rectangle((80, 80, 944, 944), radius=176, fill=255)
    icon.paste(background, (0, 0), mask)

    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((560, 470, 785, 695), fill=(44, 203, 255, 175))
    glow_draw.line((290, 328, 730, 328), fill=(73, 169, 255, 180), width=64)
    icon.alpha_composite(glow.filter(ImageFilter.GaussianBlur(65)))

    orbit = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    orbit_draw = ImageDraw.Draw(orbit)
    orbit_draw.ellipse((490, 386, 850, 780), outline=(69, 212, 255, 125), width=13)
    orbit_draw.ellipse((520, 405, 800, 750), outline=(153, 123, 255, 110), width=8)
    orbit = orbit.rotate(-30, resample=Image.Resampling.BICUBIC, center=(670, 583))
    icon.alpha_composite(orbit)

    draw = ImageDraw.Draw(icon)
    draw.rounded_rectangle((269, 287, 749, 371), radius=18, fill=(88, 193, 255, 255))
    draw.rounded_rectangle((382, 338, 467, 754), radius=18, fill=(88, 193, 255, 255))
    draw.ellipse((574, 498, 760, 684), fill=(93, 227, 255, 255))
    draw.ellipse((613, 537, 721, 645), fill=(193, 250, 255, 255))
    for x, y, radius in ((788, 420, 11), (517, 734, 7), (211, 511, 7), (812, 700, 5)):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(145, 226, 255, 220))

    icon.putalpha(ImageChops.multiply(icon.getchannel('A'), mask))
    return icon


def write_installer_icons(classic: Image.Image) -> None:
    classic.save(BUILD / 'icon.png')
    for size in (256, 512):
        classic.resize((size, size), Image.Resampling.LANCZOS).save(BUILD / f'icon-{size}.png')
    classic.save(BUILD / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    classic.save(BUILD / 'icon.icns', format='ICNS')


def main() -> None:
    OPTIONS.mkdir(exist_ok=True)
    classic = Image.open(CLASSIC_SOURCE).convert('RGBA')
    classic.save(OPTIONS / 'classic.png')
    make_quantum_icon().save(OPTIONS / 'quantum.png')
    write_installer_icons(classic)


if __name__ == '__main__':
    main()
