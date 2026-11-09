"""Generate a tiny seamless-ish paper grain overlay for the MapLibre stage.

The texture is deliberately subtle: RGB is a warm grey and alpha stays below
~7%. It is tiled over the map with `mix-blend-mode: multiply`, giving the flat
vector colours the same slightly fibrous paper feel as the game's static map.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "paper-grain.png"
SIZE = 512
rng = np.random.default_rng(20260101)

# Fine grain + a slower fibre pattern.
fine = rng.normal(0.0, 1.0, (SIZE, SIZE)).astype(np.float32)
fibre = rng.normal(0.0, 1.0, (SIZE, SIZE)).astype(np.float32)
fibre = np.asarray(
    Image.fromarray(((fibre * 24) + 128).clip(0, 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(2.2)
    ),
    dtype=np.float32,
)
fibre = (fibre - 128.0) / 24.0
field = fine * 0.65 + fibre * 0.55

# Soft clip so there are no hard black specks.
field = np.tanh(field * 0.95)

alpha = (3.2 + (field + 1.0) * 2.4).clip(0, 9).astype(np.uint8)
rgb = np.empty((SIZE, SIZE, 3), dtype=np.uint8)
rgb[..., 0] = 92
rgb[..., 1] = 84
rgb[..., 2] = 66

img = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
