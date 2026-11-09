"""Build a compact terrain suitability grid for station placement.

The game's DEM is 2560×1440 at 50 px/km. We aggregate it to 20 px cells
(≈400 m) and store max slope + water fraction. The simulation uses this to
reject stations in water or on cliffs; it is not a routing graph.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEM = ROOT / "assets" / "maps" / "source" / "dem_crop.npy"
BASE = ROOT / "assets" / "maps" / "duanzhou-dinghu-simple.png"
OUT = ROOT / "map" / "game-data" / "terrain-rules.json"

CELL = 20
W, H = 2560, 1440
GW, GH = W // CELL, H // CELL

dem = np.load(DEM).astype(np.float32)
# Approximate metres per pixel at 23°N.
dx = (112.82 - 112.32) * 111320 * np.cos(np.radians(23.13)) / W
dy = (23.26 - 23.00) * 110900 / H
gy, gx = np.gradient(dem, dy, dx)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))

img = Image.open(BASE).convert("RGB").resize((W, H), Image.Resampling.BILINEAR)
rgb = np.asarray(img, dtype=np.int16)

slopes = []
waters = []
for gy0 in range(0, H, CELL):
    for gx0 in range(0, W, CELL):
        block = slope[gy0:gy0 + CELL, gx0:gx0 + CELL]
        # Max slope catches cliffs even when the cell average is gentle.
        slopes.append(round(float(block.max()), 1))
        br = rgb[gy0:gy0 + CELL, gx0:gx0 + CELL]
        # Blue water in the baked paper map: b − r > 10.
        water = ((br[:, :, 2] - br[:, :, 0]) > 10).mean()
        waters.append(round(float(water), 3))

OUT.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "width": GW,
    "height": GH,
    "cellPx": CELL,
    "slopeMaxDeg": slopes,
    "waterFraction": waters,
    "source": "dem_crop.npy + duanzhou-dinghu-simple.png",
}
OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KiB), {GW}x{GH}")
