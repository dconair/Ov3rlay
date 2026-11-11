#!/usr/bin/env python3
"""Erzeugt die Grafiken und Videos im Branding von brand/brand.json (flaches Line-up-Design für IRL- und DJ-Streams).

Benötigt: Python 3, Pillow, numpy und ffmpeg. Ergebnis: payload/assets/
Mit --placeholder-logo entsteht zusätzlich brand/logo.png (nur einmal nötig, danach liegt dort das eigene Logo).
Eigene Dateien (Logo, Hintergründe, Stinger) können später einfach unter
demselben Namen in payload/assets/ ersetzt werden, die Szenen bleiben gleich.
Bewusst flach: harte Kanten, Vollflächen, keine Verläufe und kein Leuchten.
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
FONTS = OUT / "fonts"
W, H = 1920, 1080
TAN = math.tan(math.radians(12))  # Neigung der Wisch-Kanten im Stinger


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


BRAND = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
LIME = hex_rgb(BRAND["colors"]["primary"])
ORANGE = hex_rgb(BRAND["colors"]["secondary"])
INK = hex_rgb(BRAND["colors"]["dark"])
BONE = hex_rgb(BRAND["colors"]["light"])
MUTED = hex_rgb(BRAND["colors"]["muted"])
STRIPE = tuple(int(c + (255 - c) * 0.045) for c in INK)  # kaum sichtbare Streifen im Hintergrund


def anton(size):
    return ImageFont.truetype(str(FONTS / "Anton-Regular.ttf"), size)


def mono(size, bold=True):
    return ImageFont.truetype(str(FONTS / ("SpaceMono-Bold.ttf" if bold else "SpaceMono-Regular.ttf")), size)


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ease(t):
    t = np.clip(t, 0.0, 1.0)
    return np.where(t < 0.5, 4 * t ** 3, 1 - (-2 * t + 2) ** 3 / 2)


def center_text(d, box, text, fnt, fill):
    l, t, r, b = d.textbbox((0, 0), text, font=fnt)
    d.text((box[0] + (box[2] - box[0] - (r - l)) / 2 - l, box[1] + (box[3] - box[1] - (b - t)) / 2 - t), text, font=fnt, fill=fill)


# --- Bilder -----------------------------------------------------------------

def frame_cam(path):
    """Eckmarken in Limette um ein Kamerabild (Innenfläche transparent)."""
    arm, thick = 90, 10
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for x, y, dx, dy in ((0, 0, 1, 1), (W, 0, -1, 1), (0, H, 1, -1), (W, H, -1, -1)):
        d.rectangle(sorted_box(x, y, x + dx * arm, y + dy * thick), fill=LIME + (255,))
        d.rectangle(sorted_box(x, y, x + dx * thick, y + dy * arm), fill=LIME + (255,))
    img.save(path, optimize=True)


def sorted_box(x0, y0, x1, y1):
    return [min(x0, x1), min(y0, y1), max(x0, x1) - 1, max(y0, y1) - 1]


def lower_third(path):
    """Schlanke Tinten-Platte mit Limetten-Streifen links; Name und Zeile liegen als Textquellen darüber."""
    w, h = 640, 96
    img = Image.new("RGBA", (w, h), INK + (255,))
    ImageDraw.Draw(img).rectangle([0, 0, 9, h], fill=LIME + (255,))
    img.save(path, optimize=True)


def ticker_bar(path):
    """Laufband-Hintergrund: Tinte, oben 3 Pixel Limette."""
    img = Image.new("RGBA", (W, 46), INK + (255,))
    ImageDraw.Draw(img).rectangle([0, 0, W, 2], fill=LIME + (255,))
    img.save(path, optimize=True)


def partner_plate(path):
    """Namensschild des Partners: Tinte mit orangem Balken links; Logo-Feld links, Name als Textquelle."""
    w, h = 300, 50
    img = Image.new("RGBA", (w, h), INK + (255,))
    ImageDraw.Draw(img).rectangle([0, 0, 4, h], fill=ORANGE + (255,))
    img.save(path, optimize=True)


def partner_logo_placeholder(path):
    """Neutraler Platzhalter (gestrichelter orange Rahmen, Plus). Die echte Datei bleibt lokal beim Nutzer."""
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(6, size - 6, 16):
        for (x, y) in ((i, 6), (i, size - 8), (6, i), (size - 8, i)):
            d.rectangle([x, y, x + 8, y + 1] if y in (6, size - 8) else [x, y, x + 1, y + 8], fill=ORANGE + (255,))
    d.rectangle([size // 2 - 20, size // 2 - 3, size // 2 + 19, size // 2 + 2], fill=ORANGE + (255,))
    d.rectangle([size // 2 - 3, size // 2 - 20, size // 2 + 2, size // 2 + 19], fill=ORANGE + (255,))
    img.save(path, optimize=True)


def placeholder_logo(path, s=512):
    """Eigenes Platzhalter-Logo: Limetten-Quadrat mit tintenfarbigem 'D' und orangem Punkt. Wird später ersetzt."""
    k = s / 512
    img = Image.new("RGBA", (s, s), LIME + (255,))
    d = ImageDraw.Draw(img)
    center_text(d, (0, 20 * k, s, s), "D", anton(int(430 * k)), INK)
    d.rectangle([s - 112 * k, s - 112 * k, s - 52 * k, s - 52 * k], fill=ORANGE + (255,))
    img.save(path, optimize=True)


def cam_offline(path, label):
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    for x in range(-H, W, 120):  # feine Schrägstreifen
        d.polygon([(x, H), (x + 40, H), (x + 40 + H * TAN * 4, 0), (x + H * TAN * 4, 0)], fill=STRIPE)
    center_text(d, (0, 440, W, 560), "KAMERA NICHT VERBUNDEN", anton(96), BONE)
    center_text(d, (0, 560, W, 620), label.upper(), mono(34), LIME)
    img.save(path, optimize=True)


# --- Videos -------------------------------------------------------------------

FPS = 60


def encode(frames, args, out, size=(W, H), fps=FPS):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-s", f"{size[0]}x{size[1]}", "-r", str(fps), *args["in"],
           "-i", "-", *args["out"], str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for frame in frames:
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg fehlgeschlagen: " + " ".join(cmd))


def bg_frames(seconds=6):
    """Tintenfarbener Grund, breite Schrägstreifen wandern ruhig durchs Bild, eine Limetten-Linie wischt langsam hoch.
    Perioden teilen die Loop-Länge, daher nahtlos."""
    n = seconds * FPS
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    period = 240.0
    base = np.array(INK, np.float32)
    for i in range(n):
        phase = i / n
        u = (x + y * TAN * 3 - phase * period * 4) % period
        stripe = (u < period * 0.28)[..., None]
        frame = np.where(stripe, np.array(STRIPE, np.float32), base)
        line_y = int(H - (H + 40) * phase) if phase else H
        frame[max(line_y, 0):max(line_y, 0) + 3, :, :] = np.array(LIME, np.float32) * 0.35 + base * 0.65
        yield frame.astype(np.uint8)


def bg_loop(path):
    encode(bg_frames(), {"in": ["-pix_fmt", "rgb24"],
                         "out": ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
                                 "-movflags", "+faststart", "-an"]}, path)


def live_tag(path):
    """LIVE-Zeichen mit blinkendem Punkt, 1 Sekunde Loop, VP9 mit Alpha."""
    w, h = 150, 40
    frames = []
    for i in range(FPS):
        img = Image.new("RGBA", (w, h), INK + (255,))
        d = ImageDraw.Draw(img)
        on = i < FPS // 2
        d.rectangle([12, 14, 23, 25], fill=(ORANGE if on else MUTED) + (255,))
        d.text((38, 7), "LIVE", font=mono(20), fill=BONE + (255,))
        frames.append(np.asarray(img))
    encode(iter(frames), {"in": ["-pix_fmt", "rgba"],
                          "out": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
                                  "-auto-alt-ref", "0", "-an"]}, path, size=(w, h))


def eq_bars(path, seconds=4):
    """Equalizer-Balken für Titelszenen: flache Limetten-Balken, die im Takt springen. Ganzzahlige Frequenzen -> nahtloser Loop."""
    w, h, n, bw = 1920, 170, 48, 28
    rng = np.random.default_rng(11)
    ph = rng.random((n, 2))
    k1 = rng.integers(2, 5, n)
    k2 = rng.integers(5, 9, n)
    frames = []
    total = seconds * FPS
    for i in range(total):
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        t = i / total
        for b in range(n):
            v = 0.55 * math.sin(2 * math.pi * (k1[b] * t + ph[b, 0])) + 0.45 * math.sin(2 * math.pi * (k2[b] * t + ph[b, 1]))
            hh = int(14 + (v * 0.5 + 0.5) ** 1.3 * (h - 18))
            x = b * 40 + 6
            color = BONE if b % 8 == 3 else LIME
            d.rectangle([x, h - hh, x + bw - 1, h - 1], fill=color + (255,))
        frames.append(np.asarray(img))
    encode(iter(frames), {"in": ["-pix_fmt", "rgba"],
                          "out": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34",
                                  "-auto-alt-ref", "0", "-an"]}, path, size=(w, h))


# --- Stinger-Übergang (VP9 mit Alpha) ------------------------------------------

STINGER_SECONDS = 1.1
STINGER_LAYERS = [(LIME, 0.00, 0.68), (BONE, 0.04, 0.64), (INK, 0.08, 0.60)]  # (Farbe, Start vorn, Start hinten)


def stinger_frames(logo):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u = x + y * TAN
    umax = W + H * TAN + 4
    logo_img = Image.open(logo).convert("RGBA").resize((360, 360), Image.NEAREST if False else Image.LANCZOS)
    for i in range(round(STINGER_SECONDS * FPS)):
        t = i / FPS
        rgba = np.zeros((H, W, 4), np.float32)
        for color, front_start, back_start in STINGER_LAYERS:
            front = ease((t - front_start) / 0.36) * umax
            back = ease((t - back_start) / 0.36) * umax
            cover = ((u < front) & (u >= back)).astype(np.float32)  # harte Kanten
            rgba[..., :3] = rgba[..., :3] * (1 - cover[..., None]) + np.array(color, np.float32) * cover[..., None]
            rgba[..., 3] = rgba[..., 3] * (1 - cover) + 255 * cover
        frame = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
        pop = float(smoothstep(0.28, 0.46, t) * (1 - smoothstep(0.60, 0.78, t)))
        if pop > 0:
            size = int(360 * (0.8 + 0.2 * pop))
            scaled = logo_img.resize((size, size), Image.LANCZOS)
            scaled.putalpha(scaled.getchannel("A").point(lambda a: int(a * pop)))
            frame.alpha_composite(scaled, ((W - size) // 2, (H - size) // 2))
        yield np.asarray(frame)


def stinger(path, logo):
    encode(stinger_frames(logo), {"in": ["-pix_fmt", "rgba"],
                                  "out": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
                                          "-auto-alt-ref", "0", "-an"]}, path)


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg wird benötigt (macOS: brew install ffmpeg, Linux: apt install ffmpeg).")
    for sub in ("branding", "overlays", "video", "fonts"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    if "--placeholder-logo" in sys.argv:
        placeholder_logo(ROOT / "brand" / "logo.png")
        placeholder_logo(ROOT / "build" / "icon.png", 1024)  # Installer-App-Symbol
        placeholder_logo(ROOT / "electron" / "renderer" / "logo.png", 1024)
    logo = OUT / "branding" / "logo.png"
    shutil.copyfile(ROOT / "brand" / "logo.png", logo)
    frame_cam(OUT / "overlays" / "frame_cam.png")
    lower_third(OUT / "overlays" / "lower_third.png")
    ticker_bar(OUT / "overlays" / "ticker.png")
    partner_plate(OUT / "overlays" / "partner_plate.png")
    if not (OUT / "branding" / "partner_logo.png").exists():  # eine vorhandene (lokale) Datei nie überschreiben
        partner_logo_placeholder(OUT / "branding" / "partner_logo.png")
    for cam in BRAND["cameras"]:
        cam_offline(OUT / "overlays" / f"cam_offline_{cam['id']}.png", cam["label"])
    bg_loop(OUT / "video" / "bg_loop.mp4")
    live_tag(OUT / "video" / "live_tag.webm")
    eq_bars(OUT / "video" / "eq_bars.webm")
    stinger(OUT / "video" / "stinger.webm", logo)
    ticker = OUT / "ticker.txt"
    if not ticker.exists():  # vorhandene (lokale) Laufband-Datei nie überschreiben
        ticker.write_text(BRAND["ticker"] * 2 + "\n", encoding="utf-8")
    print("Assets erzeugt in", OUT)


if __name__ == "__main__":
    main()
