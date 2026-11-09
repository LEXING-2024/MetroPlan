"""Bake the game's DEM crop into a transparent hillshade overlay.

The game ships a 2560x1440 Web-Mercator DEM (assets/maps/source/dem_crop.npy).
Rendering it as a local MapLibre `image` source avoids a runtime dependency on
a third-party DEM endpoint and guarantees that the relief lines up with the
game's original map bounds. The PNG is 3840x2160 so the 4K export stays sharp;
the interactive 1920/2560 views downsample it.

The overlay is neutral: shadows are a cool olive, highlights warm paper, and
flat ground has zero alpha, so the OSM landuse/building palette remains in
charge of the colour.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "assets" / "maps" / "source"
OUT = ROOT / "assets" / "hillshade.png"

WIDTH, HEIGHT = 3840, 2160
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26

dem = np.load(SOURCE / "dem_crop.npy").astype(np.float32)
dem = np.asarray(
    Image.fromarray(dem, "F").resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC),
    dtype=np.float32,
)

# Smooth before differentiating; the raw DEM has terrace/vegetation steps that
# look like noise at street zoom.
sigma = 1.35
radius = max(1, int(round(sigma * 3)))
x = np.arange(-radius, radius + 1, dtype=np.float32)
kernel = np.exp(-(x * x) / (2 * sigma * sigma))
kernel /= kernel.sum()
pad = radius
padded = np.pad(dem, ((pad, pad), (pad, pad)), mode="edge")
tmp = np.zeros_like(dem)
for i, kv in enumerate(kernel):
    tmp += kv * padded[pad : pad + HEIGHT, i : i + WIDTH]
smooth = np.zeros_like(dem)
for i, kv in enumerate(kernel):
    smooth += kv * padded[i : i + HEIGHT, pad : pad + WIDTH]

dx_m = (EAST - WEST) * 111_320.0 * np.cos(np.radians((SOUTH + NORTH) / 2)) / WIDTH
dy_m = (NORTH - SOUTH) * 110_900.0 / HEIGHT
gy, gx = np.gradient(smooth, dy_m, dx_m)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)

azimuth = np.radians(315.0)
altitude = np.radians(34.0)
hs = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect)
hs = np.clip(hs, 0.0, 1.0)

shadow = np.clip((0.58 - hs) / 0.32, 0.0, 1.0) ** 1.35
light = np.clip((hs - 0.60) / 0.34, 0.0, 1.0) ** 1.5

rgba = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
# Shadow pixels.
s_alpha = (shadow * 38.0).astype(np.uint8)
rgba[..., 0] = np.where(light > shadow, 255, 80).astype(np.uint8)
rgba[..., 1] = np.where(light > shadow, 251, 90).astype(np.uint8)
rgba[..., 2] = np.where(light > shadow, 239, 70).astype(np.uint8)
rgba[..., 3] = np.where(light > shadow, (light * 24.0).astype(np.uint8), s_alpha)

# A tiny blur on alpha removes any hard cut at very steep cliffs.
alpha = Image.fromarray(rgba[..., 3], "L").filter(ImageFilter.GaussianBlur(0.7))
rgba[..., 3] = np.asarray(alpha, dtype=np.uint8)

OUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(rgba, "RGBA").save(OUT, optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size / 1024 / 1024:.2f} MiB)")
