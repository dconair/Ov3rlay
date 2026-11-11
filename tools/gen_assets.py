#!/usr/bin/env python3
"""Erzeugt die Grafiken und Videos im Branding von brand/brand.json (modernes Blau/Teal-Design für IRL-Streams).

Benötigt: Python 3, Pillow, numpy und ffmpeg. Ergebnis: payload/assets/
Mit --placeholder-logo entsteht zusätzlich brand/logo.png (nur einmal nötig, danach liegt dort das eigene Logo).
Eigene Dateien (Logo, Hintergründe, Stinger) können später einfach unter
demselben Namen in payload/assets/ ersetzt werden, die Szenen bleiben gleich.
"""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "payload" / "assets"
W, H = 1920, 1080
TAN = math.tan(math.radians(12))  # Neigung der Wisch-Kanten im Stinger
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


BRAND = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
TEAL = hex_rgb(BRAND["colors"]["primary"])
BLUE = hex_rgb(BRAND["colors"]["secondary"])
DARK = hex_rgb(BRAND["colors"]["dark"])
WHITE = hex_rgb(BRAND["colors"]["light"])


def font(size):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ease(t):
    t = np.clip(t, 0.0, 1.0)
    return np.where(t < 0.5, 4 * t ** 3, 1 - (-2 * t + 2) ** 3 / 2)


def save_supersampled(draw_fn, size, path, scale=2):
    """Zeichnet in doppelter Auflösung und verkleinert für saubere Kanten."""
    img = Image.new("RGBA", (size[0] * scale, size[1] * scale), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(img), scale)
    img.resize(size, Image.LANCZOS).save(path, optimize=True)


# --- Bilder -----------------------------------------------------------------

def rounded(d, box, radius, **kw):
    d.rounded_rectangle(box, radius=radius, **kw)


def gradient_h(width, height, left, right):
    """Waagerechter Verlauf als RGB-Array."""
    t = np.linspace(0, 1, width, dtype=np.float32)[None, :, None]
    row = np.array(left, np.float32) * (1 - t) + np.array(right, np.float32) * t
    return np.repeat(row, height, axis=0).astype(np.uint8)


def frame_cam(path):
    """Dünner Verlaufsrahmen mit Eckmarken um ein Kamerabild (Innenfläche transparent)."""
    arm, thick, line = 110, 14, 6

    def draw(d, s):
        d.rectangle([0, 0, W * s - 1, H * s - 1], outline=TEAL + (140,), width=line * s)
        for (cx, cy), (dx, dy), color in (((0, 0), (1, 1), TEAL), ((W, H), (-1, -1), BLUE),
                                          ((W, 0), (-1, 1), TEAL), ((0, H), (1, -1), BLUE)):
            x, y = cx * s, cy * s
            d.rectangle(sorted_box(x, y, x + dx * arm * s, y + dy * thick * s), fill=color + (255,))
            d.rectangle(sorted_box(x, y, x + dx * thick * s, y + dy * arm * s), fill=color + (255,))

    save_supersampled(draw, (W, H), path)


def sorted_box(x0, y0, x1, y1):
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def lower_third(path):
    """Abgerundete, dunkle Platte mit Verlaufs-Akzent links."""
    w, h = 1100, 180

    def draw(d, s):
        rounded(d, [0, 0, w * s - 1, h * s - 1], 28 * s, fill=DARK + (222,), outline=WHITE + (46,), width=2 * s)
        rounded(d, [26 * s, 30 * s, 36 * s, (h - 30) * s], 5 * s, fill=TEAL + (255,))
        rounded(d, [26 * s, (h // 2) * s, 36 * s, (h - 30) * s], 5 * s, fill=BLUE + (255,))

    save_supersampled(draw, (w, h), path)


def panel(path):
    """Halbtransparente Karte hinter Texten der Titelszenen."""
    w, h = 1500, 340

    def draw(d, s):
        rounded(d, [0, 0, w * s - 1, h * s - 1], 40 * s, fill=DARK + (150,), outline=TEAL + (110,), width=2 * s)

    save_supersampled(draw, (w, h), path)


def live_badge(path):
    """Kapsel mit Punkt für das LIVE-Zeichen; der Text 'LIVE' kommt als Textquelle darüber."""
    w, h = 176, 56

    def draw(d, s):
        rounded(d, [0, 0, w * s - 1, h * s - 1], (h // 2) * s, fill=DARK + (225,), outline=TEAL + (200,), width=2 * s)
        d.ellipse([18 * s, (h // 2 - 8) * s, 34 * s, (h // 2 + 8) * s], fill=TEAL + (255,))

    save_supersampled(draw, (w, h), path)


def accent_line(path):
    """Dünne Verlaufslinie; Periode 960 teilt 1920 -> nahtlos scrollbar."""
    h = 8
    half = gradient_h(480, h, TEAL, BLUE)
    row = np.concatenate([half, half[:, ::-1], half, half[:, ::-1]], axis=1)  # teal -> blau -> teal, 2 Perioden
    Image.fromarray(row, "RGB").save(path, optimize=True)


def placeholder_logo(path):
    """Neutrales Platzhalter-Logo: Verlaufskachel mit Monogramm (wird später durch das eigene ersetzt)."""
    size = 1000
    mix = np.clip((np.add.outer(np.arange(size), np.arange(size)) / (2 * size - 2)), 0, 1)[..., None].astype(np.float32)
    rgb = (np.array(TEAL, np.float32) * (1 - mix) + np.array(BLUE, np.float32) * mix).astype(np.uint8)
    tile = Image.fromarray(rgb, "RGB").convert("RGBA")
    mask = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 2 - 1, size * 2 - 1], radius=440, fill=255)
    tile.putalpha(mask.resize((size, size), Image.LANCZOS))
    d = ImageDraw.Draw(tile)
    text = BRAND["name"][:2].lower()
    f = font(430)
    box = d.textbbox((0, 0), text, font=f)
    d.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1] - 20), text, font=f, fill=DARK)
    d.rounded_rectangle([size * 0.36, size * 0.76, size * 0.64, size * 0.79], radius=14, fill=DARK)
    tile.save(path, optimize=True)


def cam_offline(path, label, phase=0.1):
    img = Image.fromarray(bg_frame(W, H, phase))
    d = ImageDraw.Draw(img)
    for text, size, y, color in (("KAMERA NICHT VERBUNDEN", 72, 470, WHITE), (label, 44, 570, TEAL)):
        box = d.textbbox((0, 0), text, font=font(size))
        d.text(((W - (box[2] - box[0])) / 2, y), text, font=font(size), fill=color)
    img.save(path, optimize=True)


# --- Hintergrund-Loop ---------------------------------------------------------

# (Farbe, Mitte x, Mitte y, Bahnradius x, Bahnradius y, Umläufe pro Loop, Versatz, Sigma, Stärke)
BLOBS = [
    (TEAL, 420, 300, 260, 140, 1, 0.00, 380, 0.26),
    (BLUE, 1500, 760, 300, 160, 1, 0.35, 440, 0.34),
    (TEAL, 1400, 200, 200, 120, 2, 0.60, 300, 0.12),
    (BLUE, 380, 880, 220, 100, 2, 0.10, 340, 0.16),
]
_NOISE = np.random.default_rng(7).integers(-1, 2, (H, W, 1)).astype(np.int16)  # fest -> kein Flackern, weniger Banding


def bg_frame(w, h, phase):
    """Dunkles Marineblau mit langsam kreisenden, weichen Teal- und Blau-Lichtern.
    phase in [0,1): periodisch (ganze Umläufe), damit der Loop nahtlos ist."""
    hw, hh = w // 2, h // 2  # weiche Verläufe: halbe Auflösung genügt
    y, x = np.mgrid[0:hh, 0:hw].astype(np.float32) * 2
    top, bottom = np.array((11, 24, 42), np.float32), np.array(DARK, np.float32)
    img = top + (bottom - top) * (y / h)[..., None]
    for color, cx, cy, rx, ry, turns, offset, sigma, strength in BLOBS:
        a = 2 * np.pi * (turns * phase + offset)
        px, py = cx + rx * np.cos(a), cy + ry * np.sin(a)
        glow = strength * np.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * sigma ** 2))
        img = img + np.array(color, np.float32) * glow[..., None]
    r2 = ((x / w - 0.5) ** 2 + (y / h - 0.5) ** 2)[..., None]
    img *= 1 - 0.85 * r2
    small = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    big = np.asarray(small.resize((w, h), Image.BILINEAR)).astype(np.int16)
    if (w, h) == (W, H):
        big = big + _NOISE
    return np.clip(big, 0, 255).astype(np.uint8)


def encode(frames, args, out, fps=30):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-s", f"{W}x{H}", "-r", str(fps), *args["in"],
           "-i", "-", *args["out"], str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for frame in frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg fehlgeschlagen: " + " ".join(cmd))


def bg_loop(path, seconds=8):
    n = seconds * 30
    encode((bg_frame(W, H, i / n) for i in range(n)),
           {"in": ["-pix_fmt", "rgb24"],
            "out": ["-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an"]},
           path)


# --- Stinger-Übergang (VP9 mit Alpha) ------------------------------------------

STINGER_SECONDS = 1.1
STINGER_FPS = 60  # entspricht dem Standard-Profil (1080p60); Stinger-Guides empfehlen die Ausgabe-FPS
STINGER_COVER_MS = 520  # Mitte der Phase 0,44 bis 0,60 s, in der der Bildschirm vollständig verdeckt ist (ca. 10 Bilder)


def stinger_frames(logo):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u = x + y * TAN
    umax = W + H * TAN + 4
    layers = [(TEAL, 0.00, 0.68), (BLUE, 0.04, 0.64), (DARK, 0.08, 0.60)]  # (Farbe, Start vorn, Start hinten)
    logo_img = Image.open(logo).convert("RGBA").resize((420, 420), Image.LANCZOS)
    for i in range(round(STINGER_SECONDS * STINGER_FPS)):
        t = i / STINGER_FPS
        rgba = np.zeros((H, W, 4), np.float32)
        for color, front_start, back_start in layers:
            front = ease((t - front_start) / 0.36) * umax
            back = ease((t - back_start) / 0.36) * umax
            cover = np.clip(front - u + 0.5, 0, 1) * np.clip(u - back + 0.5, 0, 1)
            rgba[..., :3] = rgba[..., :3] * (1 - cover[..., None]) + np.array(color, np.float32) * cover[..., None]
            rgba[..., 3] = rgba[..., 3] * (1 - cover) + 255 * cover
        frame = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
        pop = float(smoothstep(0.28, 0.46, t) * (1 - smoothstep(0.60, 0.78, t)))
        if pop > 0:
            size = int(420 * (0.85 + 0.15 * pop))
            scaled = logo_img.resize((size, size), Image.LANCZOS)
            scaled.putalpha(scaled.getchannel("A").point(lambda a: int(a * pop)))
            frame.alpha_composite(scaled, ((W - size) // 2, (H - size) // 2))
        yield np.asarray(frame)


def stinger(path, logo):
    encode(stinger_frames(logo),
           {"in": ["-pix_fmt", "rgba"],
            "out": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
                    "-auto-alt-ref", "0", "-an"]},
           path, fps=STINGER_FPS)


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg wird benötigt (macOS: brew install ffmpeg, Linux: apt install ffmpeg).")
    for sub in ("branding", "overlays", "video", "fonts"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    if "--placeholder-logo" in sys.argv:
        placeholder_logo(ROOT / "brand" / "logo.png")
    logo = OUT / "branding" / "logo.png"
    shutil.copyfile(ROOT / "brand" / "logo.png", logo)
    frame_cam(OUT / "overlays" / "frame_cam.png")
    lower_third(OUT / "overlays" / "lower_third.png")
    panel(OUT / "overlays" / "panel.png")
    live_badge(OUT / "overlays" / "live_badge.png")
    accent_line(OUT / "overlays" / "accent_line.png")
    for cam in BRAND["cameras"]:
        cam_offline(OUT / "overlays" / f"cam_offline_{cam['id']}.png", cam["label"])
    bg_loop(OUT / "video" / "bg_loop.mp4")
    stinger(OUT / "video" / "stinger.webm", logo)
    print("Assets erzeugt in", OUT)


if __name__ == "__main__":
    main()
