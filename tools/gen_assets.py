#!/usr/bin/env python3
"""Erzeugt die Platzhalter-Grafiken und -Videos im Branding von brand/brand.json.

Benötigt: Python 3, Pillow, numpy und ffmpeg. Ergebnis: payload/assets/
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
TAN = math.tan(math.radians(12))  # Neigung wie im Logo
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


BRAND = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
ORANGE = hex_rgb(BRAND["colors"]["primary"])
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

def frame_cam(path):
    """Eckklammern um ein Kamerabild (Innenfläche transparent)."""
    arm, thick = 150, 10

    def draw(d, s):
        d.rectangle([0, 0, W * s - 1, H * s - 1], outline=WHITE + (70,), width=3 * s)
        corners = [
            ((0, 0), (1, 1), ORANGE), ((W, H), (-1, -1), ORANGE),
            ((W, 0), (-1, 1), BLUE), ((0, H), (1, -1), BLUE),
        ]
        for (cx, cy), (dx, dy), color in corners:
            x, y = cx * s, cy * s
            d.rectangle(sorted_box(x, y, x + dx * arm * s, y + dy * thick * s), fill=color + (255,))
            d.rectangle(sorted_box(x, y, x + dx * thick * s, y + dy * arm * s), fill=color + (255,))

    save_supersampled(draw, (W, H), path)


def sorted_box(x0, y0, x1, y1):
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def lower_third(path):
    w, h, skew = 1100, 180, 40

    def draw(d, s):
        d.polygon([(skew * s, 0), (w * s, 0), ((w - skew) * s, h * s), (0, h * s)], fill=DARK + (235,))
        d.polygon([(skew * s, 0), ((skew + 28) * s, 0), (28 * s, h * s), (0, h * s)], fill=ORANGE + (255,))
        d.polygon([(28 * s, (h - 6) * s), ((w - skew) * s, (h - 6) * s), ((w - skew) * s, h * s), (28 * s, h * s)],
                  fill=BLUE + (255,))

    save_supersampled(draw, (w, h), path)


def band_stripes(path):
    """Schräge Warnband-Streifen; Periode 80 teilt 1920 -> nahtlos scrollbar."""
    h, period = 40, 80
    y, x = np.mgrid[0:h, 0:W]
    stripe = ((x + y) % period) < period // 2
    rgb = np.where(stripe[..., None], np.array(ORANGE), np.array(DARK)).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(path, optimize=True)


def cam_offline(path, label, phase=0.1):
    img = Image.fromarray(bg_frame(W, H, phase))
    d = ImageDraw.Draw(img)
    for text, size, y, color in (("KAMERA NICHT VERBUNDEN", 72, 470, WHITE), (label, 44, 570, ORANGE)):
        box = d.textbbox((0, 0), text, font=font(size))
        d.text(((W - (box[2] - box[0])) / 2, y), text, font=font(size), fill=color)
    img.save(path, optimize=True)


# --- Hintergrund-Loop ---------------------------------------------------------

def bg_frame(w, h, phase):
    """Dunkler Hintergrund mit langsam wandernden, schrägen Farbbändern.
    phase in [0,1): periodisch, damit der Loop nahtlos ist."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u = x + y * TAN
    base = np.array(DARK, dtype=np.float32)
    mix = np.clip(u / (w + h * TAN), 0, 1)[..., None]
    color = np.array(ORANGE, np.float32) * (1 - mix) + np.array(BLUE, np.float32) * mix
    wave1 = 0.5 + 0.5 * np.sin(2 * np.pi * (u / 640.0 - phase))
    wave2 = 0.5 + 0.5 * np.sin(2 * np.pi * (u / 1500.0 + phase))
    strength = (0.22 * smoothstep(0.80, 0.97, wave1) + 0.07 * wave2 ** 2)[..., None]
    img = base + (color - base) * strength
    r2 = ((x / w - 0.5) ** 2 + (y / h - 0.5) ** 2)[..., None]
    img *= 1 - 0.9 * r2
    return np.clip(img, 0, 255).astype(np.uint8)


def encode(frames, args, out):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-s", f"{W}x{H}", "-r", "30", *args["in"],
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
            "out": ["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an"]},
           path)


# --- Stinger-Übergang (VP9 mit Alpha) ------------------------------------------

STINGER_SECONDS = 1.1
STINGER_COVER_MS = 520  # Zeitpunkt, an dem der Bildschirm vollständig verdeckt ist


def stinger_frames(logo):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u = x + y * TAN
    umax = W + H * TAN + 4
    layers = [(ORANGE, 0.00, 0.65), (BLUE, 0.05, 0.60), (DARK, 0.10, 0.55)]  # (Farbe, Start vorn, Start hinten)
    logo_img = Image.open(logo).convert("RGBA").resize((420, 420), Image.LANCZOS)
    for i in range(int(STINGER_SECONDS * 30)):
        t = i / 30
        rgba = np.zeros((H, W, 4), np.float32)
        for color, front_start, back_start in layers:
            front = ease((t - front_start) / 0.40) * umax
            back = ease((t - back_start) / 0.40) * umax
            cover = np.clip(front - u + 0.5, 0, 1) * np.clip(u - back + 0.5, 0, 1)
            rgba[..., :3] = rgba[..., :3] * (1 - cover[..., None]) + np.array(color, np.float32) * cover[..., None]
            rgba[..., 3] = rgba[..., 3] * (1 - cover) + 255 * cover
        frame = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
        pop = float(smoothstep(0.30, 0.50, t) * (1 - smoothstep(0.58, 0.72, t)))
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
           path)


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg wird benötigt (macOS: brew install ffmpeg, Linux: apt install ffmpeg).")
    for sub in ("branding", "overlays", "video", "fonts"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    logo = OUT / "branding" / "logo.png"
    shutil.copyfile(ROOT / "brand" / "logo.png", logo)
    frame_cam(OUT / "overlays" / "frame_cam.png")
    lower_third(OUT / "overlays" / "lower_third.png")
    band_stripes(OUT / "overlays" / "band_stripes.png")
    for cam in BRAND["cameras"]:
        cam_offline(OUT / "overlays" / f"cam_offline_{cam['id']}.png", cam["label"])
    bg_loop(OUT / "video" / "bg_loop.mp4")
    stinger(OUT / "video" / "stinger.webm", logo)
    print("Assets erzeugt in", OUT)


if __name__ == "__main__":
    main()
