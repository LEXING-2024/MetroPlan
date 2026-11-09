"""Build the Duanzhou–Dinghu terrain basemap.

Outputs (assets/maps):
  duanzhou-dinghu-terrain.png          labelled 2560x1440 master
  duanzhou-dinghu-terrain-clean.png    unlabelled 2560x1440 master
  duanzhou-dinghu-terrain-1920.png     labelled 1920x1080 web size
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from map_common import (
    BOUNDARY,
    EAST,
    HEIGHT,
    INK,
    INK_SOFT,
    NORTH,
    PAPER,
    SCALE,
    SOURCE,
    SOUTH,
    WATER,
    WATER_DEEP,
    WATER_EDGE,
    WEST,
    WIDTH,
    draw_ring_mask,
    gaussian_blur,
    hillshade,
    load_json,
    project,
    project_many,
    water_shapes,
)

OUT = SOURCE.parent
FONT_SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
FONT_SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
FONT_LATIN = r"C:\Windows\Fonts\georgia.ttf"


def font(path: str, size: int, variation: str | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(path, size)
    if variation:
        try:
            f.set_variation_by_name(variation)
        except Exception:
            pass
    return f


def mix(rgb: np.ndarray, color: tuple[int, int, int], alpha: np.ndarray) -> np.ndarray:
    a = np.clip(alpha, 0, 1)[..., None]
    return rgb * (1 - a) + np.array(color, dtype=np.float32)[None, None, :] * a


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def build_terrain() -> np.ndarray:
    dem = np.load(SOURCE / "dem_crop.npy")
    hs = hillshade(dem, azimuth=318, altitude=34)
    hs = gaussian_blur(hs, 1.3)

    stops = np.array([-20, 8, 25, 55, 100, 180, 300, 450, 650, 850, 1050], dtype=np.float32)
    colors = np.array(
        [
            [242, 237, 225],
            [238, 235, 220],
            [232, 232, 213],
            [223, 227, 203],
            [211, 219, 191],
            [197, 209, 178],
            [181, 197, 163],
            [163, 183, 149],
            [143, 167, 136],
            [124, 151, 124],
            [107, 137, 116],
        ],
        dtype=np.float32,
    )
    tint = np.empty(dem.shape + (3,), dtype=np.float32)
    for c in range(3):
        tint[..., c] = np.interp(dem, stops, colors[:, c])

    shade = 1.0 + (hs - 0.5) * 0.31
    rgb = tint * shade[..., None]

    # Higher ground sits under denser forest, so it should read deeper.
    upland = smoothstep(120, 620, dem)
    rgb = mix(rgb, (96, 122, 102), upland * 0.10)

    # Cool the deepest shadow pockets so the relief reads as atmospheric, not dirty.
    shadow = np.clip((0.42 - hs) * 2.2, 0, 1)
    rgb = mix(rgb, (111, 128, 111), shadow * 0.12)

    # Paper mottling, kept almost subliminal.
    rng = np.random.default_rng(11)
    coarse = gaussian_blur(rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32), 24)
    coarse /= max(float(np.abs(coarse).max()), 1e-6)
    rgb *= 1.0 + coarse[..., None] * 0.015
    return np.clip(rgb, 0, 255)


def road_geometry() -> list[tuple[str, list[tuple[float, float]]]]:
    data = load_json("osm_roads.json")
    roads = []
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        pts = [p for p in (el.get("geometry") or []) if p]
        if len(pts) < 2:
            continue
        cls = el.get("tags", {}).get("highway", "")
        roads.append((cls, project_many([(p["lon"], p["lat"]) for p in pts])))
    return roads


def place_nodes() -> list[dict]:
    data = load_json("osm_places.json")
    out = []
    for el in data.get("elements", []):
        if el.get("type") != "node":
            continue
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        out.append({"name": name, "place": tags.get("place"), "lon": el["lon"], "lat": el["lat"]})
    return out


def urban_layer(rgb: np.ndarray, roads, places) -> np.ndarray:
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    d = ImageDraw.Draw(mask)
    for cls, pts in roads:
        width = 11 if cls in ("motorway", "trunk", "primary") else 7
        d.line(pts, fill=255, width=width, joint="curve")

    # Town kernels add a little weight where the road net is sparse.
    for p in places:
        if p["place"] in ("city", "town", "suburb"):
            x, y = project(p["lon"], p["lat"])
            r = 64 if p["place"] == "city" else 38
            d.ellipse((x - r, y - r, x + r, y + r), fill=170)

    density = np.asarray(mask, dtype=np.float32) / 255.0
    density = gaussian_blur(density, 28)
    density /= max(float(np.percentile(density, 99.7)), 1e-6)
    density = np.clip(density, 0, 1)

    dem = np.load(SOURCE / "dem_crop.npy")
    lowland = smoothstep(110, 20, dem)
    alpha = smoothstep(0.07, 0.50, density) * lowland * 0.52
    rgb = mix(rgb, (198, 190, 170), alpha)

    # Fine grain in the built-up areas only.
    rng = np.random.default_rng(21)
    grain = rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32)
    grain = gaussian_blur(grain, 0.7) * 3.2
    rgb = np.clip(rgb + grain[..., None] * alpha[..., None] * 0.20, 0, 255)
    return rgb


def draw_streams(rgb: np.ndarray, wm: np.ndarray) -> np.ndarray:
    """Fine blue linework for channels, clipped out of the filled water."""
    data = load_json("osm_water.json")
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        if tags.get("waterway") not in ("river", "canal"):
            continue
        pts = [p for p in (el.get("geometry") or []) if p]
        if len(pts) < 2:
            continue
        d.line(project_many([(p["lon"], p["lat"]) for p in pts]), fill=(118, 153, 159, 165), width=2)
    alpha = np.asarray(layer.getchannel("A"), dtype=np.float32) / 255.0
    alpha *= 1.0 - wm
    layer.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)))
    base = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    return np.asarray(Image.alpha_composite(base, layer).convert("RGB"), dtype=np.float32)


def water_layer(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    outer, inner = water_shapes(load_json("osm_water.json"))
    out_mask = draw_ring_mask(outer)
    in_mask = draw_ring_mask(inner)
    wm = np.asarray(out_mask, dtype=np.float32) / 255.0
    im = np.asarray(in_mask, dtype=np.float32) / 255.0
    wm = np.clip(wm - im, 0, 1)
    wm = np.asarray(Image.fromarray((wm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.55)), dtype=np.float32) / 255.0

    depth = gaussian_blur(wm, 10)
    depth = np.clip((depth - 0.48) * 2.0, 0, 1)
    water_rgb = np.array(WATER, dtype=np.float32)[None, None, :] * (1 - depth[..., None]) + np.array(
        WATER_DEEP, dtype=np.float32
    )[None, None, :] * depth[..., None]

    # Subtle surface modulation.
    rng = np.random.default_rng(31)
    ripple = gaussian_blur(rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32), 2.2)
    ripple /= max(float(np.abs(ripple).max()), 1e-6)
    water_rgb = water_rgb * (1 + ripple[..., None] * 0.012)

    rgb = mix(rgb, (0, 0, 0), wm * 0)  # keep shape
    rgb = rgb * (1 - wm[..., None] * 0.95) + water_rgb * (wm[..., None] * 0.95)

    # Edge darkening, one pixel wide.
    eroded = np.asarray(
        Image.fromarray((wm * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float32
    ) / 255.0
    edge = np.clip(wm - eroded, 0, 1)
    edge = gaussian_blur(edge, 0.6)
    rgb = mix(rgb, WATER_EDGE, np.clip(edge * 3.5, 0, 1) * 0.55)
    return rgb, wm


def draw_roads(rgb: np.ndarray, roads) -> np.ndarray:
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    styles = {
        "motorway": ((177, 164, 139, 88), 2.2),
        "trunk": ((177, 164, 139, 80), 2.0),
        "primary": ((181, 169, 146, 58), 1.4),
        "motorway_link": ((177, 164, 139, 52), 1.1),
        "trunk_link": ((177, 164, 139, 48), 1.1),
        "primary_link": ((181, 169, 146, 40), 1.0),
    }
    for cls, pts in roads:
        style = styles.get(cls)
        if not style:
            continue
        color, width = style
        d.line(pts, fill=color, width=max(1, int(round(width))), joint="curve")
    base = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    return np.asarray(Image.alpha_composite(base, layer).convert("RGB"), dtype=np.float32)


def dashed_line(draw, pts, fill, width=2, dash=18, gap=11):
    if len(pts) < 2:
        return
    phase = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        t = 0.0
        while t < seg:
            pos = phase % (dash + gap)
            remain = (dash - pos) if pos < dash else (dash + gap - pos)
            t2 = min(seg, t + remain)
            if pos < dash:
                a = (x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg)
                b = (x0 + (x1 - x0) * t2 / seg, y0 + (y1 - y0) * t2 / seg)
                draw.line([a, b], fill=fill, width=width)
            t = t2
            phase += t2 - t


def draw_boundaries(img: Image.Image) -> Image.Image:
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    data = load_json("osm_boundaries.json")
    for rel in data.get("elements", []):
        for m in rel.get("members") or []:
            pts = [p for p in (m.get("geometry") or []) if p]
            if len(pts) < 2:
                continue
            dashed_line(d, project_many([(p["lon"], p["lat"]) for p in pts]), BOUNDARY + (128,), 2, 18, 11)
    return Image.alpha_composite(img.convert("RGBA"), layer)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt, tracking: int) -> tuple[float, float]:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = sum(draw.textlength(ch, font=fnt) for ch in text) + tracking * max(0, len(text) - 1)
    return w, bbox[3] - bbox[1]


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    fnt,
    fill,
    tracking: int = 0,
    anchor: str = "mm",
    stroke_width: int = 0,
    stroke_fill=None,
):
    x, y = xy
    total, _ = text_size(draw, text, fnt, tracking)
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    # vertical: use the font's baseline-ish bbox
    bbox = draw.textbbox((0, 0), text, font=fnt)
    h = bbox[3] - bbox[1]
    if anchor[1] == "m":
        y -= h / 2 + bbox[1]
    elif anchor[1] == "s":
        y -= h + bbox[1]
    for ch in text:
        draw.text(
            (x, y),
            ch,
            font=fnt,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
            anchor="ls",
        )
        x += draw.textlength(ch, font=fnt) + tracking


def landmark_label(
    draw: ImageDraw.ImageDraw,
    lon: float,
    lat: float,
    title: str,
    subtitle: str | None = None,
    size: int = 24,
    color=INK_SOFT,
    marker: str = "dot",
    offset: tuple[int, int] = (0, -26),
):
    x, y = project(lon, lat)
    fnt = font(FONT_SERIF, size, "Medium")
    sub = font(FONT_SANS, max(12, int(size * 0.52)), "Regular")
    # marker
    if marker == "peak":
        draw.polygon([(x, y - 7), (x - 7, y + 5), (x + 7, y + 5)], outline=color + (170,), width=1)
    elif marker == "dot":
        draw.ellipse((x - 2.5, y - 2.5, x + 2.5, y + 2.5), fill=color + (150,))
    tx, ty = x + offset[0], y + offset[1]
    draw_tracked(draw, (tx, ty), title, fnt, color + (185,), tracking=max(1, size // 12), anchor="ms", stroke_width=3, stroke_fill=PAPER + (150,))
    if subtitle:
        draw_tracked(
            draw,
            (tx, ty + size + 5),
            subtitle,
            sub,
            color + (120,),
            tracking=2,
            anchor="ms",
            stroke_width=2,
            stroke_fill=PAPER + (120,),
        )


def draw_labels(img: Image.Image, roads, places) -> Image.Image:
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # District names, generously tracked.
    district_font = font(FONT_SERIF, 50, "Regular")
    district_en = font(FONT_LATIN, 13)
    for name, en, lon, lat in [
        ("端州区", "DUANZHOU", 112.449, 23.090),
        ("鼎湖区", "DINGHU", 112.628, 23.213),
    ]:
        x, y = project(lon, lat)
        draw_tracked(d, (x, y), name, district_font, INK + (195,), tracking=14, anchor="mm", stroke_width=5, stroke_fill=PAPER + (195,))
        draw_tracked(d, (x, y + 42), en, district_en, INK + (115,), tracking=6, anchor="mm", stroke_width=2, stroke_fill=PAPER + (150,))

    # City mark.
    cx, cy = project(112.468, 23.048)
    d.rectangle((cx - 5, cy - 5, cx + 5, cy + 5), outline=INK + (180,), width=2)
    d.rectangle((cx - 2, cy - 2, cx + 2, cy + 2), fill=INK + (180,))
    draw_tracked(d, (cx + 14, cy + 2), "肇庆", font(FONT_SERIF, 22, "Medium"), INK + (170,), tracking=2, anchor="lm", stroke_width=3, stroke_fill=PAPER + (150,))

    # Water names.
    river_font = font(FONT_SERIF, 34, "Light")
    rx, ry = project(112.664, 23.169)
    draw_tracked(d, (rx, ry - 30), "西 江", river_font, (83, 118, 124, 190), tracking=10, anchor="mm", stroke_width=4, stroke_fill=PAPER + (110,))
    draw_tracked(d, (rx, ry - 30 + 30), "XI RIVER", font(FONT_LATIN, 12), (83, 118, 124, 115), tracking=5, anchor="mm", stroke_width=2, stroke_fill=PAPER + (100,))

    draw_tracked(
        d,
        project(112.457, 23.072),
        "星 湖",
        font(FONT_SERIF, 20, "Light"),
        (83, 118, 124, 160),
        tracking=4,
        anchor="mm",
        stroke_width=3,
        stroke_fill=PAPER + (120,),
    )

    # Mountains and landmarks.
    landmark_label(d, 112.512, 23.183, "鼎湖山", "鸡笼顶  1000 m", size=30, marker="peak", offset=(0, -22))
    landmark_label(d, 112.465, 23.125, "北岭山", "BEILING", size=27, marker="peak", offset=(0, -18))
    landmark_label(d, 112.621, 23.111, "烂柯山", "880 m", size=27, marker="peak", offset=(0, -20))
    landmark_label(d, 112.489, 23.069, "七星岩", size=22, marker="dot", offset=(8, -16))

    # Towns, deliberately quiet.
    town_font = font(FONT_SANS, 20, "Regular")
    town_names = [
        ("小湘", 112.392, 23.141),
        ("凤凰", 112.560, 23.201),
        ("莲花", 112.672, 23.236),
        ("永安", 112.691, 23.182),
        ("沙浦", 112.681, 23.158),
        ("大沙", 112.758, 23.246),
        ("金利", 112.774, 23.089),
        ("蚬岗", 112.681, 23.043),
        ("金渡", 112.518, 23.040),
    ]
    for name, lon, lat in town_names:
        x, y = project(lon, lat)
        d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=INK_SOFT + (120,), outline=PAPER + (180,), width=1)
        draw_tracked(d, (x + 8, y + 1), name, town_font, INK_SOFT + (155,), tracking=2, anchor="lm", stroke_width=3, stroke_fill=PAPER + (150,))

    return Image.alpha_composite(img.convert("RGBA"), layer)


def finish(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    # Very subtle vignette to settle the frame.
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    cx, cy = WIDTH / 2, HEIGHT / 2
    r = np.sqrt(((xx - cx) / (WIDTH * 0.62)) ** 2 + ((yy - cy) / (HEIGHT * 0.62)) ** 2)
    vig = np.clip((r - 0.55) * 0.12, 0, 0.055)
    arr *= (1 - vig[..., None])
    # Fine paper grain.
    rng = np.random.default_rng(99)
    grain = rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32)
    arr += grain[..., None] * 1.6
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    if SCALE != 1:
        raise SystemExit(
            "build_map.py 只支持 2560 × 1440；4K 请用 build_simple_map.py（MAP_SCALE=1.5）。"
        )
    print("terrain...")
    rgb = build_terrain()
    roads = road_geometry()
    places = place_nodes()
    print(f"roads={len(roads)} places={len(places)}")

    print("urban texture...")
    rgb = urban_layer(rgb, roads, places)
    print("water...")
    rgb, wm = water_layer(rgb)
    print("streams...")
    rgb = draw_streams(rgb, wm)
    print("roads...")
    rgb = draw_roads(rgb, roads)

    img = Image.fromarray(rgb.astype(np.uint8), "RGB")
    img = draw_boundaries(img)

    clean = finish(img)
    clean.save(OUT / "duanzhou-dinghu-terrain-clean.png", optimize=True)
    print("labels...")
    labelled = finish(draw_labels(img, roads, places))
    labelled.save(OUT / "duanzhou-dinghu-terrain.png", optimize=True)
    labelled.resize((1920, 1080), Image.Resampling.LANCZOS).save(OUT / "duanzhou-dinghu-terrain-1920.png", optimize=True)
    print("saved outputs")


if __name__ == "__main__":
    main()
