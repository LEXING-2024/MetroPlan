"""Download the game region from OpenFreeMap and pack it for offline use.

Output:
  map/offline/public/tiles.bin          concatenated PBF tiles
  map/offline/public/tile-index.json    "z/x/y" -> [offset, length]
  map/offline/public/glyphs/...         only the glyph ranges the style uses
  map/offline/manifest.json             bounds/zooms/source/counts

The game loads tiles through a custom `metro://` protocol, so no network is
needed at runtime. The pack is copied to dist/ by Vite (`publicDir`).
"""
from __future__ import annotations

import concurrent.futures
import json
import math
import os
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "offline" / "public"
TILES_BIN = OUT / "tiles.bin"
INDEX_JSON = OUT / "tile-index.json"
MANIFEST = ROOT / "offline" / "manifest.json"

WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
MIN_Z, MAX_Z = 9, 14
USER_AGENT = "MetroPlan-offline-builder/1.0 (+https://openstreetmap.org/copyright)"

# Fonts used by map/src/style.js. CJK ideographs are drawn locally through
# MapLibre's localIdeographFontFamily; these ranges cover Latin, punctuation,
# CJK punctuation and full-width forms.
FONT_RANGES = [
    "0-255",
    "256-511",
    "512-767",
    "768-1023",
    "8192-8447",
    "8448-8703",
    "12288-12543",
    "65024-65279",
]
FONT_STACKS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"]


def fetch_bytes(url: str, timeout: int = 40) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def tile_x(lon: float, z: int) -> int:
    return int((lon + 180.0) / 360.0 * (2**z))


def tile_y(lat: float, z: int) -> int:
    n = 2**z
    return int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def tile_ranges(z: int) -> tuple[range, range]:
    x0 = tile_x(WEST, z)
    x1 = tile_x(EAST, z)
    # y increases southwards
    y0 = tile_y(NORTH, z)
    y1 = tile_y(SOUTH, z)
    return range(x0, x1 + 1), range(y0, y1 + 1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "glyphs").mkdir(parents=True, exist_ok=True)

    tilejson = json.loads(fetch_bytes("https://tiles.openfreemap.org/planet"))
    template = tilejson["tiles"][0]
    version = tilejson.get("version", "unknown")
    print("tile template:", template)

    jobs: list[tuple[int, int, int, str]] = []
    for z in range(MIN_Z, MAX_Z + 1):
        xs, ys = tile_ranges(z)
        for x in xs:
            for y in ys:
                url = template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
                jobs.append((z, x, y, url))
    print("tiles:", len(jobs))

    def get_tile(job):
        z, x, y, url = job
        return z, x, y, fetch_bytes(url)

    downloaded: list[tuple[int, int, int, bytes]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(get_tile, job) for job in jobs]
        for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                downloaded.append(fut.result())
            except Exception as exc:
                print("tile failed:", exc)
            if i % 50 == 0 or i == len(futures):
                print(f"  {i}/{len(futures)}")

    downloaded.sort(key=lambda row: (row[0], row[1], row[2]))
    index: dict[str, list[int]] = {}
    offset = 0
    with TILES_BIN.open("wb") as out:
        for z, x, y, data in downloaded:
            index[f"{z}/{x}/{y}"] = [offset, len(data)]
            out.write(data)
            offset += len(data)

    INDEX_JSON.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    glyphs: list[dict[str, object]] = []
    for fontstack in FONT_STACKS:
        encoded = urllib.parse.quote(fontstack, safe="")
        for rng in FONT_RANGES:
            url = f"https://tiles.openfreemap.org/fonts/{encoded}/{rng}.pbf"
            data = fetch_bytes(url)
            target = OUT / "glyphs" / fontstack / f"{rng}.pbf"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            glyphs.append({"font": fontstack, "range": rng, "bytes": len(data)})
            print(f"glyph {fontstack} {rng} {len(data)}")

    manifest = {
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "zooms": [MIN_Z, MAX_Z],
        "tileCount": len(downloaded),
        "tileBytes": offset,
        "tileTemplate": template,
        "openFreeMapVersion": version,
        "fonts": glyphs,
        "fontBytes": sum(int(g["bytes"]) for g in glyphs),
        "source": "© OpenStreetMap contributors (ODbL) · tiles OpenFreeMap / OpenMapTiles",
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"packed {len(downloaded)} tiles / {offset / 1024 / 1024:.2f} MiB; "
        f"glyphs {manifest['fontBytes'] / 1024 / 1024:.2f} MiB"
    )


if __name__ == "__main__":
    main()
