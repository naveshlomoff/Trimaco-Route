"""Draws the app icons into public/ (same design as public/favicon.svg).

Run: python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
TEAL = (13, 92, 99, 255)
WHITE = (255, 255, 255, 255)
ORANGE = (244, 163, 64, 255)
CURVE = ((16, 46), (16, 30), (48, 38), (48, 20))


def bezier(t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = CURVE
    u = 1 - t
    return (
        u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3,
        u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3,
    )


def draw(size, *, rounded=True, safe_zone=1.0):
    s = size * 4  # draw large, then downscale for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 14 / 64), fill=TEAL)
    else:
        d.rectangle([0, 0, s, s], fill=TEAL)
    k = s / 64 * safe_zone
    off = (s - 64 * k) / 2

    def dot(x, y, r, color):
        cx, cy, rr = off + x * k, off + y * k, r * k
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color)

    for i in range(1, 9):
        dot(*bezier(i / 9), 2, WHITE)
    dot(16, 46, 6, WHITE)
    dot(32, 33.75, 4, WHITE)
    dot(48, 20, 6, ORANGE)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(512, rounded=False, safe_zone=0.8).save(OUT / "icon-512-maskable.png")
# iOS rounds the corners itself and turns transparency black: full square.
draw(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png")
print("icons written to", OUT)
