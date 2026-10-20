"""Generates Promptly's original app icons from code (reproducible, no external assets).

Glyph: three rounded "script lines" — the middle one is the bright reading line with a small
record dot — on the brand violet. Run: python3 scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "assets"
VIOLET_TOP = (122, 107, 248)
VIOLET_BOTTOM = (91, 75, 232)
REC = (255, 77, 90)
WHITE = (255, 255, 255)
SS = 4  # supersampling factor


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(VIOLET_TOP, VIOLET_BOTTOM))
        for x in range(size):
            px[x, y] = c
    return img


def draw_glyph(size: int, scale: float, mono: bool = False) -> Image.Image:
    """Transparent layer with the glyph centred; `scale` = glyph width / canvas."""
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = s * scale
    left = (s - w) / 2
    bar_h = w * 0.13
    gap = w * 0.12
    total_h = bar_h * 3 + gap * 2
    top = (s - total_h) / 2
    dim = (255, 255, 255, 255 if mono else 120)
    bars = [
        (left + w * 0.10, top, left + w * 0.82, dim),
        (left, top + bar_h + gap, left + w, (255, 255, 255, 255)),
        (left + w * 0.10, top + 2 * (bar_h + gap), left + w * 0.62, dim),
    ]
    for x0, y0, x1, color in bars:
        d.rounded_rectangle([x0, y0, x1, y0 + bar_h], radius=bar_h / 2, fill=color)
    if not mono:
        # Record dot sits inside the reading line, at its left end.
        cy = top + bar_h + gap + bar_h / 2
        r = bar_h * 0.28
        cx = left + bar_h / 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=REC + (255,))
    return layer.resize((size, size), Image.LANCZOS)


def main() -> None:
    # iOS / generic icon: opaque, full-bleed (iOS applies its own mask).
    icon = gradient(1024).convert("RGBA")
    icon.alpha_composite(draw_glyph(1024, 0.62))
    icon.convert("RGB").save(ROOT / "icon.png")

    # Android adaptive: glyph inside the 66% safe zone.
    gradient(512).save(ROOT / "android-icon-background.png")
    draw_glyph(512, 0.48).save(ROOT / "android-icon-foreground.png")
    draw_glyph(432, 0.48, mono=True).save(ROOT / "android-icon-monochrome.png")

    # Splash: glyph only (background colour comes from app.json).
    splash = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    splash.alpha_composite(draw_glyph(1024, 0.42))
    splash.save(ROOT / "splash-icon.png")

    fav = gradient(48).convert("RGBA")
    fav.alpha_composite(draw_glyph(48, 0.66))
    fav.save(ROOT / "favicon.png")


if __name__ == "__main__":
    main()
