"""Probe render: terrain + OSM water + boundaries, no labels."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from map_common import (
    BOUNDARY,
    HEIGHT,
    INK,
    PAPER,
    SOURCE,
    WATER,
    WATER_DEEP,
    WATER_EDGE,
    WIDTH,
    draw_ring_mask,
    elevation_tint,
    hillshade,
    load_json,
    project,
    project_many,
    water_shapes,
)


def dashed_line(draw: ImageDraw.ImageDraw, pts, fill, width=2, dash=14, gap=9):
    if len(pts) < 2:
        return
    phase = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        t = 0.0
        while t < seg:
            remain = dash if phase % (dash + gap) < dash else gap
            t2 = min(seg, t + remain)
            if phase % (dash + gap) < dash:
                a = (x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg)
                b = (x0 + (x1 - x0) * t2 / seg, y0 + (y1 - y0) * t2 / seg)
                draw.line([a, b], fill=fill, width=width)
            t = t2
            phase += t2 - t


def main() -> None:
    dem = np.load(SOURCE / "dem_crop.npy")
    hs = hillshade(dem, azimuth=315, altitude=34)
    tint = elevation_tint(dem)
    shade = 0.72 + (hs - 0.5) * 0.55
    rgb = tint * shade[..., None]
    rgb = np.clip(rgb, 0, 255)

    # Gentle paper mottling.
    rng = np.random.default_rng(7)
    coarse = gaussian = None
    from map_common import gaussian_blur

    coarse = gaussian_blur(rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32), 28)
    coarse /= max(abs(coarse.min()), abs(coarse.max()), 1e-6)
    rgb = rgb * (1 + coarse[..., None] * 0.018)

    # Water mask.
    outer, inner = water_shapes(load_json("osm_water.json"))
    out_mask = draw_ring_mask(outer)
    in_mask = draw_ring_mask(inner)
    wm = np.asarray(out_mask, dtype=np.float32) / 255.0
    im = np.asarray(in_mask, dtype=np.float32) / 255.0
    wm = np.clip(wm - im, 0, 1)
    # soften the mask just a touch for antialiased banks
    wm_img = Image.fromarray((wm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    wm = np.asarray(wm_img, dtype=np.float32) / 255.0

    # Water colour: slightly deeper toward the middle of broad channels.
    from map_common import gaussian_blur as gb

    depth = gb(wm, 9)
    depth = np.clip((depth - 0.55) * 2.2, 0, 1)
    water_rgb = np.array(WATER, dtype=np.float32)[None, None, :] * (1 - depth[..., None]) + np.array(
        WATER_DEEP, dtype=np.float32
    )[None, None, :] * depth[..., None]
    rgb = rgb * (1 - wm[..., None] * 0.96) + water_rgb * (wm[..., None] * 0.96)

    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(img)

    # Water edge
    edge = np.clip(wm - np.asarray(
        Image.fromarray((wm * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float32) / 255.0,
        0,
        1,
    )
    edge = gb(edge, 0.7)
    edge_img = Image.fromarray((np.clip(edge * 2.2, 0, 1) * 255).astype(np.uint8), "L")
    edge_rgba = Image.new("RGBA", (WIDTH, HEIGHT), WATER_EDGE + (0,))
    edge_rgba.putalpha(edge_img.point(lambda v: int(v * 0.55)))
    img = Image.alpha_composite(img.convert("RGBA"), edge_rgba).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Boundaries
    bdata = load_json("osm_boundaries.json")
    for rel in bdata.get("elements", []):
        for m in rel.get("members") or []:
            pts = [p for p in (m.get("geometry") or []) if p]
            if len(pts) < 2:
                continue
            dashed_line(draw, project_many([(p["lon"], p["lat"]) for p in pts]), BOUNDARY + (150,), 2, 16, 10)

    # River centerlines for the smaller tributaries (subtle).
    wdata = load_json("osm_water.json")
    for el in wdata.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        if tags.get("waterway") not in ("river", "canal"):
            continue
        pts = [p for p in (el.get("geometry") or []) if p]
        if len(pts) < 2:
            continue
        draw.line(project_many([(p["lon"], p["lat"]) for p in pts]), fill=(127, 164, 169, 170), width=2)

    img.save(SOURCE / "probe_terrain_water.png")
    print("saved probe")


if __name__ == "__main__":
    main()
