"""Download and mosaic AWS Terrain Tiles (Terrarium) for the Duanzhou-Dinghu map.

Outputs:
  assets/maps/source/dem_crop.npy       float32 elevation in metres, north-up
  assets/maps/source/dem_meta.json      georeferencing metadata
  assets/maps/source/dem_preview.png    quick grayscale preview
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "maps" / "source"
TILE_DIR = SOURCE / "terrain"
SOURCE.mkdir(parents=True, exist_ok=True)
TILE_DIR.mkdir(parents=True, exist_ok=True)

# WGS84 bounds, chosen for a 16:9 frame around Duanzhou + Dinghu.
WEST, SOUTH, EAST, NORTH = 112.320, 23.000, 112.820, 23.260
ZOOM = 13
TILE_SIZE = 256
OUT_W, OUT_H = 2560, 1440
UA = "MetroPlan-terrain-basemap/1.0 (local cartography project)"


def lonlat_to_world(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = TILE_SIZE * (2**z)
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def tile_range() -> tuple[int, int, int, int, float, float, float, float]:
    x0f, y0f = lonlat_to_world(WEST, NORTH, ZOOM)
    x1f, y1f = lonlat_to_world(EAST, SOUTH, ZOOM)
    x0, x1 = math.floor(x0f / TILE_SIZE), math.floor(x1f / TILE_SIZE)
    y0, y1 = math.floor(y0f / TILE_SIZE), math.floor(y1f / TILE_SIZE)
    return x0, x1, y0, y1, x0f, y0f, x1f, y1f


def fetch_tile(x: int, y: int) -> tuple[int, int, Path]:
    path = TILE_DIR / f"{ZOOM}_{x}_{y}.png"
    if path.exists() and path.stat().st_size > 1000:
        return x, y, path
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)
            return x, y, path
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed {url}: {last_err}")


def decode_terrarium(img: Image.Image) -> np.ndarray:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    return arr[..., 0] * 256.0 + arr[..., 1] + arr[..., 2] / 256.0 - 32768.0


def main() -> None:
    x0, x1, y0, y1, x0f, y0f, x1f, y1f = tile_range()
    tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(f"zoom {ZOOM}: {len(tiles)} tiles, x={x0}..{x1}, y={y0}..{y1}")

    paths: dict[tuple[int, int], Path] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_tile, x, y): (x, y) for x, y in tiles}
        for i, fut in enumerate(as_completed(futures), 1):
            x, y, path = fut.result()
            paths[(x, y)] = path
            if i % 20 == 0 or i == len(tiles):
                print(f"  downloaded {i}/{len(tiles)}")

    # Mosaic the tile range.
    mosaic = np.zeros(((y1 - y0 + 1) * TILE_SIZE, (x1 - x0 + 1) * TILE_SIZE), dtype=np.float32)
    for (x, y), path in paths.items():
        with Image.open(path) as im:
            elev = decode_terrarium(im)
        yy = (y - y0) * TILE_SIZE
        xx = (x - x0) * TILE_SIZE
        mosaic[yy : yy + TILE_SIZE, xx : xx + TILE_SIZE] = elev

    # Crop to exact bounds.
    cx0 = int(round(x0f - x0 * TILE_SIZE))
    cy0 = int(round(y0f - y0 * TILE_SIZE))
    cx1 = int(round(x1f - x0 * TILE_SIZE))
    cy1 = int(round(y1f - y0 * TILE_SIZE))
    crop = mosaic[cy0:cy1, cx0:cx1]
    print(f"crop {crop.shape[1]}x{crop.shape[0]}, elevation {crop.min():.0f}..{crop.max():.0f} m")

    # Resize to the master frame using bilinear resampling.
    elev_img = Image.fromarray(crop, mode="F")
    elev_img = elev_img.resize((OUT_W, OUT_H), Image.Resampling.BILINEAR)
    dem = np.asarray(elev_img, dtype=np.float32)
    np.save(SOURCE / "dem_crop.npy", dem)

    meta = {
        "bounds_wgs84": [WEST, SOUTH, EAST, NORTH],
        "zoom": ZOOM,
        "tile_range": [x0, x1, y0, y1],
        "width": OUT_W,
        "height": OUT_H,
        "projection": "Web Mercator (EPSG:3857)",
        "elevation_units": "metres",
        "source": "AWS Terrain Tiles (Mapzen Terrarium), SRTM/ETOPO derived",
        "attribution": "Terrain tiles: Mapzen / AWS Open Data; elevation data: SRTM",
        "min_elevation": float(dem.min()),
        "max_elevation": float(dem.max()),
    }
    (SOURCE / "dem_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # Preview with a simple contrast stretch.
    lo, hi = np.percentile(dem, 1), np.percentile(dem, 99)
    preview = np.clip((dem - lo) / max(hi - lo, 1) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(preview).save(SOURCE / "dem_preview.png")
    print("saved dem_crop.npy, dem_meta.json, dem_preview.png")


if __name__ == "__main__":
    main()
