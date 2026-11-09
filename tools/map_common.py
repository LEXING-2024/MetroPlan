"""Shared cartographic helpers for the Duanzhou-Dinghu terrain map."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "maps" / "source"

WEST, SOUTH, EAST, NORTH = 112.320, 23.000, 112.820, 23.260
BASE_WIDTH, BASE_HEIGHT = 2560, 1440
# Render scale: 1.0 = 2560 × 1440, 1.5 = 3840 × 2160 (4K), 2.0 = 5120 × 2880.
SCALE = float(os.environ.get("MAP_SCALE") or 1.0)
WIDTH = int(round(BASE_WIDTH * SCALE))
HEIGHT = int(round(BASE_HEIGHT * SCALE))
ZOOM = 13

# Palette — warm paper, sage relief, desaturated water.
PAPER = (244, 240, 230)
PAPER_DARK = (234, 229, 216)
INK = (73, 74, 64)
INK_SOFT = (103, 104, 91)
WATER = (181, 207, 211)
WATER_DEEP = (157, 189, 195)
WATER_EDGE = (139, 169, 173)
BOUNDARY = (112, 116, 101)


def lonlat_to_world(lon: float, lat: float, z: int = ZOOM) -> tuple[float, float]:
    n = 256.0 * (2**z)
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


_X0F, _Y0F = lonlat_to_world(WEST, NORTH)
_X1F, _Y1F = lonlat_to_world(EAST, SOUTH)


def project(lon: float, lat: float) -> tuple[float, float]:
    wx, wy = lonlat_to_world(lon, lat)
    px = (wx - _X0F) / (_X1F - _X0F) * WIDTH
    py = (wy - _Y0F) / (_Y1F - _Y0F) * HEIGHT
    return px, py


def project_many(coords: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    return [project(lon, lat) for lon, lat in coords]


def load_json(name: str) -> dict:
    return json.loads((SOURCE / name).read_text(encoding="utf-8"))


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def assemble_rings(segments: list[list[tuple[float, float]]], tol: float = 2e-6) -> list[list[tuple[float, float]]]:
    """Join multipolygon member ways into closed rings (lon/lat)."""
    segments = [s for s in segments if len(s) >= 2]
    rings: list[list[tuple[float, float]]] = []
    while segments:
        ring = list(segments.pop(0))
        changed = True
        while changed and not (len(ring) > 3 and _dist(ring[0], ring[-1]) < tol):
            changed = False
            for i, seg in enumerate(segments):
                if _dist(ring[-1], seg[0]) < tol:
                    ring.extend(seg[1:])
                elif _dist(ring[-1], seg[-1]) < tol:
                    ring.extend(list(reversed(seg))[1:])
                else:
                    continue
                segments.pop(i)
                changed = True
                break
        if len(ring) >= 3:
            if _dist(ring[0], ring[-1]) >= tol:
                ring.append(ring[0])
            rings.append(ring)
    return rings


def water_shapes(data: dict) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """Return (outer rings, inner rings) from Overpass water output."""
    outers: list[list[tuple[float, float]]] = []
    inners: list[list[tuple[float, float]]] = []
    for el in data.get("elements", []):
        if el.get("type") == "way":
            tags = el.get("tags", {})
            if tags.get("natural") not in ("water", "wetland"):
                continue
            # Fish ponds and tiny tanks add noise at this scale; keep the named
            # lakes/reservoirs and anything with real extent.
            if tags.get("water") == "pond":
                continue
            pts = [(p["lon"], p["lat"]) for p in (el.get("geometry") or []) if p]
            if len(pts) < 3:
                continue
            lons = [p[0] for p in pts]
            lats = [p[1] for p in pts]
            if tags.get("water") is None and tags.get("name") is None:
                if (max(lons) - min(lons)) * (max(lats) - min(lats)) < 3e-5:
                    continue
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            outers.append(pts)
        elif el.get("type") == "relation":
            members = el.get("members") or []
            for role in ("outer", "inner"):
                segs = []
                for m in members:
                    if not m or m.get("role") != role:
                        continue
                    pts = [(p["lon"], p["lat"]) for p in (m.get("geometry") or []) if p]
                    if len(pts) >= 2:
                        segs.append(pts)
                rings = assemble_rings(segs)
                (outers if role == "outer" else inners).extend(rings)
    return outers, inners


def draw_ring_mask(rings: list[list[tuple[float, float]]], size: tuple[int, int] = (WIDTH, HEIGHT)) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for ring in rings:
        pts = project_many(ring)
        if len(pts) >= 3:
            draw.polygon(pts, fill=255)
    return mask


def gaussian_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    radius = max(1, int(round(sigma * 3)))
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    k /= k.sum()
    pad = radius
    p = np.pad(a.astype(np.float32), ((pad, pad), (pad, pad)), mode="edge")
    h, w = a.shape
    tmp = np.zeros_like(a, dtype=np.float32)
    for i, kv in enumerate(k):
        tmp += kv * p[pad : pad + h, i : i + w]
    out = np.zeros_like(a, dtype=np.float32)
    for i, kv in enumerate(k):
        out += kv * p[i : i + h, pad : pad + w]
    return out


def elevation_tint(dem: np.ndarray) -> np.ndarray:
    stops = np.array([-20, 10, 40, 100, 200, 350, 550, 750, 1000], dtype=np.float32)
    colors = np.array(
        [
            [239, 234, 218],
            [237, 233, 216],
            [232, 230, 210],
            [223, 226, 202],
            [210, 218, 190],
            [193, 206, 176],
            [173, 191, 162],
            [151, 174, 148],
            [128, 157, 137],
        ],
        dtype=np.float32,
    )
    rgb = np.empty(dem.shape + (3,), dtype=np.float32)
    for c in range(3):
        rgb[..., c] = np.interp(dem, stops, colors[:, c])
    return rgb


def hillshade(dem: np.ndarray, azimuth: float = 315.0, altitude: float = 38.0) -> np.ndarray:
    smooth = gaussian_blur(dem, 1.1)
    dx_m = (EAST - WEST) * 111_320.0 * math.cos(math.radians((SOUTH + NORTH) / 2)) / WIDTH
    dy_m = (NORTH - SOUTH) * 110_900.0 / HEIGHT
    gy, gx = np.gradient(smooth, dy_m, dx_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = math.radians(azimuth)
    alt = math.radians(altitude)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0.0, 1.0)
