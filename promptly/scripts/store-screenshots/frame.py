#!/usr/bin/env python3
"""Frame raw device screenshots into store-ready marketing images (offline, reproducible).

    python3 scripts/store-screenshots/frame.py --input screenshots/ --locales en he
    python3 scripts/store-screenshots/frame.py --make-samples      # (re)draw the 2 SAMPLE inputs
    python3 scripts/store-screenshots/frame.py --input scripts/store-screenshots/sample

Output: store-assets/out/<locale>/<size>/NN.png and store-assets/out/<locale>/play-feature/
feature-graphic.png (git-ignored). Copy per shot and locale comes from manifest.json.
Only Pillow is required. Hebrew uses libraqm when Pillow has it (correct bidi shaping);
otherwise a simple visual-order fallback is used (see README, "Hebrew").

Final store screenshots must be real captures of the app. The SAMPLE images are placeholders
for demoing the pipeline and must never be uploaded.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent  # promptly/
DEFAULT_OUT = APP / "store-assets" / "out"
ICON = APP / "assets" / "icon.png"

# Brand (src/theme/tokens.ts + scripts/generate-icons.py).
VIOLET_TOP = (122, 107, 248)
VIOLET_500 = (109, 94, 245)
VIOLET_600 = (91, 75, 232)
DEEP = (45, 33, 140)  # darker end of the background gradient, for text contrast
INK_950 = (9, 10, 15)
INK_900 = (15, 17, 24)
INK_800 = (28, 32, 48)
INK_400 = (138, 144, 166)
INK_50 = (245, 246, 250)
VIOLET_100 = (236, 233, 255)
REC_500 = (255, 77, 90)
WHITE = (255, 255, 255)

# Store sizes (portrait). Verified 2026-10-21 against Apple's "Screenshot specifications"
# page; Google's help page was unreachable from the authoring environment (see README).
SIZES = {
    "ios-6.9": (1320, 2868),  # iPhone, Dynamic Island large display
    "ios-6.5": (1284, 2778),  # iPhone, Face ID large display (also accepts 1242x2688)
    "ios-6.1": (1206, 2622),  # iPhone, Dynamic Island medium display ("required" per Apple)
    "play-phone": (1080, 1920),  # Google Play phone, 9:16
}
FEATURE_GRAPHIC = (1024, 500)
RTL_LOCALES = {"he", "ar", "fa"}
SAMPLE_LABEL = "SAMPLE — replace with real screenshot"

# ---------------------------------------------------------------- fonts / text

FONT_CANDIDATES = {
    # Latin: Inter (OFL) when installed; DejaVu Sans as the common fallback.
    "latin-bold": ["/usr/share/fonts/opentype/inter/Inter-Bold.otf",
                   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    "latin-regular": ["/usr/share/fonts/opentype/inter/Inter-Medium.otf",
                      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    # Hebrew: Inter has no Hebrew glyphs. FreeSans (GPL+font exception) and DejaVu Sans do.
    "hebrew-bold": ["/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    "hebrew-regular": ["/usr/share/fonts/truetype/freefont/FreeSans.ttf",
                       "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
}
# Set PROMPTLY_NO_RAQM=1 to preview the fallback used on machines without libraqm.
HAS_RAQM = features.check("raqm") and not os.environ.get("PROMPTLY_NO_RAQM")
_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    key = (kind, size)
    if key not in _font_cache:
        for path in FONT_CANDIDATES[kind]:
            if Path(path).exists():
                engine = ImageFont.Layout.RAQM if HAS_RAQM else ImageFont.Layout.BASIC
                _font_cache[key] = ImageFont.truetype(path, size, layout_engine=engine)
                break
        else:
            sys.exit(f"No font found for {kind}; tried {FONT_CANDIDATES[kind]}")
    return _font_cache[key]


def is_rtl_char(ch: str) -> bool:
    return "֐" <= ch <= "׿" or "؀" <= ch <= "ۿ" or "יִ" <= ch <= "﷿"


def visual_order(text: str) -> str:
    """Fallback bidi for when libraqm is missing: RTL paragraph with embedded LTR runs.

    Splits the line into RTL and LTR runs (spaces/punctuation join the surrounding RTL text),
    reverses the run order and the characters inside RTL runs only, so "AI" or "SRT" stay
    readable. Not a full Unicode Bidi implementation (no mirroring of brackets, no nested
    levels); good enough for short headlines.
    """
    runs: list[tuple[bool, str]] = []
    for ch in text:
        if is_rtl_char(ch):
            rtl = True
        elif ch.isalnum():
            rtl = False
        else:
            rtl = runs[-1][0] if runs else True  # neutral: stick to the previous run
        if runs and runs[-1][0] == rtl:
            runs[-1] = (rtl, runs[-1][1] + ch)
        else:
            runs.append((rtl, ch))
    # Neutrals trailing an LTR run that sit before RTL text belong to the RTL side.
    fixed: list[tuple[bool, str]] = []
    for rtl, s in runs:
        if not rtl:
            core = s.rstrip(" ,.;:—-")
            tail = s[len(core):]
            fixed.append((False, core))
            if tail:
                fixed.append((True, tail))
        else:
            fixed.append((True, s))
    out = []
    for rtl, s in reversed(fixed):
        out.append(s[::-1] if rtl else s)
    return "".join(out)


class Text:
    """Measures and draws one line in a given direction."""

    def __init__(self, rtl: bool):
        self.rtl = rtl

    def kwargs(self) -> dict:
        if self.rtl and HAS_RAQM:
            return {"direction": "rtl", "language": "he"}
        return {}

    def prepare(self, s: str) -> str:
        return visual_order(s) if (self.rtl and not HAS_RAQM) else s

    def width(self, f: ImageFont.FreeTypeFont, s: str) -> float:
        return f.getlength(self.prepare(s), **self.kwargs())

    def wrap(self, f: ImageFont.FreeTypeFont, s: str, max_w: float) -> list[str]:
        lines: list[str] = []
        cur = ""
        for word in s.split():
            trial = f"{cur} {word}".strip()
            if cur and self.width(f, trial) > max_w:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        if cur:
            lines.append(cur)
        return balance(lines, f, self, max_w)

    def draw(self, d: ImageDraw.ImageDraw, xy_edge: tuple[float, float], s: str,
             f: ImageFont.FreeTypeFont, fill, align: str) -> None:
        """align: 'start' (left for LTR, right for RTL) or 'center'. x is the start edge."""
        w = self.width(f, s)
        x, y = xy_edge
        if align == "center":
            x = x - w / 2
        elif self.rtl:
            x = x - w
        d.text((x, y), self.prepare(s), font=f, fill=fill, **self.kwargs())


def balance(lines: list[str], f, t: Text, max_w: float) -> list[str]:
    """Avoid a lone last word: move words down while the widths get more even."""
    if len(lines) < 2:
        return lines
    words_prev = lines[-2].split()
    last = lines[-1]
    while len(words_prev) > 1:
        cand_prev = " ".join(words_prev[:-1])
        cand_last = f"{words_prev[-1]} {last}"
        if t.width(f, cand_last) > max_w or t.width(f, cand_last) > t.width(f, cand_prev):
            break
        words_prev, last = words_prev[:-1], cand_last
    return lines[:-2] + [" ".join(words_prev), last]


def fit_block(t: Text, kind: str, s: str, size: int, max_w: float, max_lines: int):
    """Shrink the font until `s` wraps into at most max_lines."""
    while True:
        f = font(kind, size)
        lines = t.wrap(f, s, max_w)
        if len(lines) <= max_lines or size < 24:
            return f, lines
        size = int(size * 0.92)


# ---------------------------------------------------------------- drawing helpers

def vertical_gradient(w: int, h: int, top, bottom) -> Image.Image:
    col = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        col.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return col.resize((w, h), Image.BICUBIC)


def background(w: int, h: int) -> Image.Image:
    bg = vertical_gradient(w, h, VIOLET_TOP, DEEP).convert("RGBA")
    # Soft light glow behind the device for depth.
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(w * 0.55)
    cx, cy = w // 2, int(h * 0.62)
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(169, 159, 255, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.12))
    bg.alpha_composite(glow)
    return bg


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    ss = 3
    m = Image.new("L", (size[0] * ss, size[1] * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] * ss - 1, size[1] * ss - 1],
                                        radius=radius * ss, fill=255)
    return m.resize(size, Image.LANCZOS)


def device(shot: Image.Image, screen_w: int) -> Image.Image:
    """Screenshot inside a dark rounded bezel. Returns RGBA sized to the bezel."""
    shot = shot.convert("RGB")
    screen_h = round(shot.height * screen_w / shot.width)
    screen = shot.resize((screen_w, screen_h), Image.LANCZOS)
    bezel = max(8, round(screen_w * 0.028))
    radius = round(screen_w * 0.12)
    W, H = screen_w + 2 * bezel, screen_h + 2 * bezel
    dev = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    body = Image.new("RGBA", (W, H), INK_950 + (255,))
    dev.paste(body, (0, 0), rounded_mask((W, H), radius + bezel))
    # Thin highlight rim so the frame reads on dark backgrounds too.
    ImageDraw.Draw(dev).rounded_rectangle([1, 1, W - 2, H - 2], radius=radius + bezel,
                                          outline=(255, 255, 255, 40), width=max(2, bezel // 6))
    dev.paste(screen, (bezel, bezel), rounded_mask((screen_w, screen_h), radius))
    return dev


def with_shadow(canvas: Image.Image, obj: Image.Image, xy: tuple[int, int]) -> None:
    pad = int(obj.width * 0.12)
    sh = Image.new("RGBA", (obj.width + 2 * pad, obj.height + 2 * pad), (0, 0, 0, 0))
    alpha = obj.split()[3].point(lambda a: a * 0.45)
    sh.paste(Image.new("RGBA", obj.size, (20, 10, 60, 255)), (pad, pad), alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(obj.width * 0.04))
    canvas.alpha_composite(sh, (xy[0] - pad, xy[1] - pad + int(obj.width * 0.03)))
    canvas.alpha_composite(obj, xy)


# ---------------------------------------------------------------- compositions

def compose_shot(shot: Image.Image, headline: str, subline: str, size: tuple[int, int],
                 locale: str) -> Image.Image:
    W, H = size
    rtl = locale in RTL_LOCALES
    t = Text(rtl)
    kind = "hebrew" if rtl else "latin"
    margin = round(W * 0.08)
    text_w = W - 2 * margin
    canvas = background(W, H)
    d = ImageDraw.Draw(canvas)

    # Text block. Short screens (Play 9:16) get a slightly smaller type scale.
    tall = H / W > 2
    hl_size = round(W * (0.085 if tall else 0.072))
    sl_size = round(W * (0.042 if tall else 0.038))
    hf, hl_lines = fit_block(t, f"{kind}-bold", headline, hl_size, text_w, 2)
    sf, sl_lines = fit_block(t, f"{kind}-regular", subline, sl_size, text_w, 3)
    hl_lh = round(hf.size * 1.18)
    sl_lh = round(sf.size * 1.38)
    x_edge = W - margin if rtl else margin
    y = round(H * (0.065 if tall else 0.055))
    for line in hl_lines:
        t.draw(d, (x_edge, y), line, hf, WHITE, "start")
        y += hl_lh
    y += round(sf.size * 0.55)
    for line in sl_lines:
        t.draw(d, (x_edge, y), line, sf, VIOLET_100, "start")
        y += sl_lh
    text_bottom = y

    # Device: as large as fits between the text and the bottom margin.
    gap = round(H * 0.035)
    avail_h = H - text_bottom - gap - round(H * 0.045)
    avail_w = W - 2 * round(W * 0.11)
    aspect = shot.height / shot.width
    bezel_frac = 2 * 0.028
    screen_w = int(min(avail_w / (1 + bezel_frac), avail_h / (aspect + bezel_frac)))
    dev = device(shot, screen_w)
    x = (W - dev.width) // 2
    y_dev = text_bottom + gap + (avail_h - dev.height) // 2
    with_shadow(canvas, dev, (x, y_dev))
    return canvas.convert("RGB")  # App Store rejects alpha channels


def compose_feature(tagline: str, locale: str) -> Image.Image:
    W, H = FEATURE_GRAPHIC
    rtl = locale in RTL_LOCALES
    t = Text(rtl)
    kind = "hebrew" if rtl else "latin"
    canvas = Image.new("RGBA", (W, H))
    # Horizontal gradient for the wide banner.
    canvas.paste(vertical_gradient(H, W, VIOLET_TOP, DEEP).rotate(90, expand=True)
                 .transpose(Image.FLIP_LEFT_RIGHT if rtl else Image.FLIP_TOP_BOTTOM), (0, 0))
    icon_size = 260
    icon = Image.open(ICON).convert("RGBA").resize((icon_size, icon_size), Image.LANCZOS)
    mask = rounded_mask((icon_size, icon_size), round(icon_size * 0.225))
    icon_rgba = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    icon_rgba.paste(icon, (0, 0), mask)
    margin = 90
    icon_x = W - margin - icon_size if rtl else margin
    icon_y = (H - icon_size) // 2
    with_shadow(canvas, icon_rgba, (icon_x, icon_y))
    d = ImageDraw.Draw(canvas)
    text_left = margin + icon_size + 60
    text_w = W - text_left - margin
    name_f = font(f"{kind}-bold", 84)
    tag_f, tag_lines = fit_block(t, f"{kind}-regular", tagline, 44, text_w, 2)
    block_h = name_f.size * 1.15 + 18 + len(tag_lines) * tag_f.size * 1.3
    y = (H - block_h) / 2
    x_edge = W - text_left if rtl else text_left
    # The product name stays Latin in every locale (working name, see store-listing-draft.md).
    Text(False).draw(d, (x_edge - name_f.getlength("Promptly") if rtl else x_edge, y),
                     "Promptly", name_f, WHITE, "start")
    y += name_f.size * 1.15 + 18
    for line in tag_lines:
        t.draw(d, (x_edge, y), line, tag_f, VIOLET_100, "start")
        y += tag_f.size * 1.3
    return canvas.convert("RGB")


# ---------------------------------------------------------------- synthetic samples

def make_samples(dest: Path) -> list[Path]:
    """Two obviously fake placeholder screens, labelled SAMPLE, for demoing the pipeline."""
    dest.mkdir(parents=True, exist_ok=True)
    W, H = 1179, 2556  # iPhone 6.1" capture size
    out = []
    specs = [
        ("01-camera-prompter.png", "Camera + prompter", INK_900),
        ("02-voice-follow.png", "Voice Follow", INK_950),
    ]
    for name, title, bg in specs:
        img = Image.new("RGB", (W, H), bg)
        d = ImageDraw.Draw(img)
        # "Camera feed" block and script lines, schematic only.
        d.rectangle([0, 0, W, H], fill=bg)
        d.rounded_rectangle([60, 180, W - 60, 900], radius=40, fill=INK_800)
        lf = font("latin-regular", 52)
        for i, frac in enumerate([0.85, 0.7, 0.9, 0.55]):
            y = 260 + i * 140
            color = WHITE if i == 1 else INK_400
            d.rounded_rectangle([120, y, 120 + (W - 240) * frac, y + 56], radius=28, fill=color)
        d.ellipse([W // 2 - 110, H - 360, W // 2 + 110, H - 140], outline=WHITE, width=12)
        d.ellipse([W // 2 - 80, H - 330, W // 2 + 80, H - 170], fill=REC_500)
        # Big diagonal-free label, centred.
        bf = font("latin-bold", 92)
        d.rounded_rectangle([60, 1150, W - 60, 1700], radius=40, fill=(255, 196, 0))
        for i, line in enumerate(["SAMPLE", "replace with", "real screenshot"]):
            tw = bf.getlength(line)
            d.text(((W - tw) / 2, 1200 + i * 150), line, font=bf, fill=INK_950)
        tw = lf.getlength(title)
        d.text(((W - tw) / 2, 1000), title, font=lf, fill=INK_50)
        d.text((60, H - 80), SAMPLE_LABEL, font=font("latin-regular", 40), fill=INK_400)
        p = dest / name
        img.save(p, optimize=True)
        out.append(p)
    return out


# ---------------------------------------------------------------- CLI

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, help="folder with raw PNG screenshots")
    ap.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--locales", nargs="+", default=["en", "he"])
    ap.add_argument("--sizes", nargs="+", default=list(SIZES), choices=list(SIZES))
    ap.add_argument("--no-feature", action="store_true", help="skip the Play feature graphic")
    ap.add_argument("--make-samples", action="store_true",
                    help=f"write synthetic SAMPLE inputs to {HERE / 'sample'} and exit")
    args = ap.parse_args()

    if args.make_samples:
        for p in make_samples(HERE / "sample"):
            print("sample:", p.relative_to(APP))
        return
    if not args.input:
        ap.error("--input is required (or use --make-samples)")

    print(f"libraqm: {'yes (full bidi shaping)' if HAS_RAQM else 'no (simple RTL fallback)'}")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    written = 0
    for idx, shot_cfg in enumerate(manifest["shots"], start=1):
        src = args.input / shot_cfg["file"]
        if not src.exists():
            print(f"skip {idx:02d}: {src} not found")
            continue
        with Image.open(src) as im:
            shot = im.convert("RGB")
        if "SAMPLE" in src.parent.name.upper() or src.parent.resolve() == (HERE / "sample").resolve():
            print(f"warning: {src.name} is a SAMPLE placeholder — never upload it")
        for loc in args.locales:
            copy = shot_cfg.get(loc)
            if not copy:
                print(f"skip {idx:02d}/{loc}: no copy in manifest")
                continue
            for size_key in args.sizes:
                img = compose_shot(shot, copy["headline"], copy["subline"], SIZES[size_key], loc)
                dst = args.out / loc / size_key / f"{idx:02d}.png"
                dst.parent.mkdir(parents=True, exist_ok=True)
                img.save(dst, optimize=True)
                written += 1
    if not args.no_feature:
        for loc in args.locales:
            tag = manifest.get("tagline", {}).get(loc)
            if tag:
                dst = args.out / loc / "play-feature" / "feature-graphic.png"
                dst.parent.mkdir(parents=True, exist_ok=True)
                compose_feature(tag, loc).save(dst, optimize=True)
                written += 1
    print(f"wrote {written} images to {args.out}")


if __name__ == "__main__":
    main()
