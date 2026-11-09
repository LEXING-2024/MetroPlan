"""Simplified, flat-colour Duanzhou–Dinghu map.

Only the Xi River, its two main islands, and the large mountain masses are
kept. No hillshade, roads, towns or small water bodies.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from map_common import (
    HEIGHT,
    PAPER,
    SCALE,
    SOURCE,
    WIDTH,
    gaussian_blur,
    load_json,
    project,
    water_shapes,
)

OUT = SOURCE.parent
S = SCALE
SUFFIX = os.environ.get("MAP_SUFFIX", "" if S == 1 else f"-{HEIGHT}p")

FONT_SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
FONT_SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
FONT_LATIN = r"C:\Windows\Fonts\georgia.ttf"


def px(value: float) -> int:
    """World-space length (designed at 2560 × 1440) in output pixels."""
    return max(1, int(round(value * S)))


def px_odd(value: float) -> int:
    """Same as `px`, forced odd for PIL Min/MaxFilter kernels."""
    n = px(value)
    return n if n % 2 else n + 1


INK = (77, 82, 70)
INK_SOFT = (100, 104, 90)
RIVER = (183, 210, 214)
RIVER_EDGE = (143, 176, 181)
MOUNTAIN_LOW = (228, 233, 213)
MOUNTAIN_MID = (211, 222, 193)
MOUNTAIN_HIGH = (182, 200, 167)
MOUNTAIN_EDGE = (173, 190, 157)
BOUNDARY = (137, 142, 121)


def font(path: str, size: int, variation: str | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(path, size)
    if variation:
        try:
            f.set_variation_by_name(variation)
        except Exception:
            pass
    return f


def mask_to_image(mask: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), "L")


def image_to_mask(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float32) / 255.0


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill every enclosed hole, including the islands."""
    land = Image.fromarray(((~mask) * 255).astype(np.uint8), "L").copy()
    d = ImageDraw.Draw(land)
    for xy in [(0, 0), (WIDTH - 1, 0), (0, HEIGHT - 1), (WIDTH - 1, HEIGHT - 1)]:
        if land.getpixel(xy) == 255:
            ImageDraw.floodfill(land, xy, 128)
    exterior = np.asarray(land) == 128
    return ~exterior


def river_mask() -> np.ndarray:
    outer, inner = water_shapes(load_json("osm_water.json"))
    from map_common import draw_ring_mask

    out = np.asarray(draw_ring_mask(outer), dtype=np.int16)
    inn = np.asarray(draw_ring_mask(inner), dtype=np.int16)
    wm = np.clip(out - inn, 0, 255).astype(np.uint8)

    img = Image.fromarray(wm, "L").copy()
    seed = tuple(int(v) for v in project(112.66, 23.17))
    if img.getpixel(seed) != 255:
        # Fall back to a point clearly in the western channel.
        seed = tuple(int(v) for v in project(112.55, 23.10))
    ImageDraw.floodfill(img, seed, 128)
    river = np.asarray(img) == 128

    # Close small gaps and erase one-pixel tendrils.
    r = mask_to_image(river.astype(np.float32))
    r = r.filter(ImageFilter.MaxFilter(px_odd(7))).filter(ImageFilter.MinFilter(px_odd(7)))
    r = r.filter(ImageFilter.MinFilter(px_odd(5))).filter(ImageFilter.MaxFilter(px_odd(5)))
    river = image_to_mask(r) > 0.5

    # Drop hairline canals (they read as dashed boundaries at this scale).
    dist = cv2.distanceTransform((river * 255).astype(np.uint8), cv2.DIST_L2, 5)
    core = (dist > 4.5 * S).astype(np.uint8) * 255
    core = cv2.dilate(core, np.ones((px_odd(7), px_odd(7)), np.uint8))
    river = (core > 0) & river

    # Remove every island; the two chosen ones are drawn back explicitly.
    return fill_holes(river)


def chaikin(points: list[tuple[float, float]], iterations: int = 2) -> list[tuple[float, float]]:
    pts = points
    for _ in range(iterations):
        out = []
        n = len(pts)
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % n]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        pts = out
    return pts


def mountain_contours() -> list[list[tuple[float, float]]]:
    """Extract the main mountain masses; the central one includes the west ridge.

    The analysis always runs on the same 1280 × 720 grid, whatever the output
    scale, so every render keeps exactly the same masses — a finer grid shifts
    which pixels cross the elevation threshold and silently drops ridges.
    """
    dem = np.load(SOURCE / "dem_crop.npy")
    grid_w, grid_h = 1280, 720
    small = np.asarray(
        Image.fromarray(dem, "F").resize((grid_w, grid_h), Image.Resampling.BILINEAR), dtype=np.float32
    )
    small = gaussian_blur(small, 9.0)

    def extract(threshold: float):
        mask = (small > threshold).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rows = []
        for c in cnts:
            area = cv2.contourArea(c)
            if area < 6000:
                continue
            m = cv2.moments(c)
            cx = m["m10"] / m["m00"] / grid_w * 0.5 + 112.32
            cy = 23.26 - m["m01"] / m["m00"] / grid_h * 0.26
            c = cv2.approxPolyDP(c, 2.0, True)
            pts = [(float(p[0][0]) / grid_w * WIDTH, float(p[0][1]) / grid_h * HEIGHT) for p in c]
            rows.append((area, cx, cy, chaikin(pts, 3 if S > 1 else 2)))
        rows.sort(key=lambda r: r[0], reverse=True)
        return rows

    high = extract(95)
    low = extract(40)
    selected = [high[0][3]]  # northern range
    if len(high) > 2:
        selected.append(high[2][3])  # left-edge range
    central = next(
        (row[3] for row in low if 112.550 < row[1] < 112.700 and 23.050 < row[2] < 23.160),
        high[1][3] if len(high) > 1 else None,
    )
    if central:
        selected.append(central)
    return selected


def simplify(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    """Ramer–Douglas–Peucker, iterative."""
    if len(points) < 3:
        return points

    def point_line_dist(p, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(p[0] - ax, p[1] - ay)
        t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))

    stack = [(0, len(points) - 1)]
    keep = {0, len(points) - 1}
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        dmax, index = 0.0, start
        for i in range(start + 1, end):
            d = point_line_dist(points[i], points[start], points[end])
            if d > dmax:
                dmax, index = d, i
        if dmax > epsilon:
            keep.add(index)
            stack.append((start, index))
            stack.append((index, end))
    return [points[i] for i in sorted(keep)]


def island_polygons() -> list[tuple[str, list[tuple[float, float]]]]:
    _, inner = water_shapes(load_json("osm_water.json"))
    targets = [("砚洲岛", (112.615, 23.184)), ("黄布沙岛", (112.654, 23.163))]
    chosen = []
    for name, (lon, lat) in targets:
        best = None
        for ring in inner:
            pts = [project(x, y) for x, y in ring]
            if len(pts) < 12:
                continue
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            tx, ty = project(lon, lat)
            dist = math.hypot(cx - tx, cy - ty)
            if best is None or dist < best[0]:
                best = (dist, pts)
        if best:
            chosen.append((name, simplify(best[1], 2.2 * S)))
    return chosen


def dashed_line(draw, pts, fill, width=2, dash=16, gap=10):
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


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt, tracking: int) -> float:
    return sum(draw.textlength(ch, font=fnt) for ch in text) + tracking * max(0, len(text) - 1)


def draw_tracked(draw, xy, text, fnt, fill, tracking=0, anchor="mm", stroke_width=0, stroke_fill=None):
    x, y = xy
    total = text_width(draw, text, fnt, tracking)
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    bbox = draw.textbbox((0, 0), text, font=fnt)
    h = bbox[3] - bbox[1]
    if anchor[1] == "m":
        y -= h / 2 + bbox[1]
    elif anchor[1] == "s":
        y -= h + bbox[1]
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill, anchor="ls")
        x += draw.textlength(ch, font=fnt) + tracking


def finish(img: Image.Image, xx: np.ndarray, yy: np.ndarray) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    rng = np.random.default_rng(5)
    grain = rng.normal(0, 1, (HEIGHT, WIDTH)).astype(np.float32)
    arr += grain[..., None] * 1.4
    rr = np.sqrt(((xx - WIDTH / 2) / (WIDTH * 0.62)) ** 2 + ((yy - HEIGHT / 2) / (HEIGHT * 0.62)) ** 2)
    vig = np.clip((rr - 0.55) * 0.10, 0, 0.045)
    arr *= 1 - vig[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    # Base paper with a gentle warm centre.
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    cx, cy = WIDTH * 0.48, HEIGHT * 0.48
    r = np.sqrt(((xx - cx) / WIDTH) ** 2 + ((yy - cy) / HEIGHT) ** 2)
    base = np.array(PAPER, dtype=np.float32)[None, None, :] + (1 - np.clip(r * 2.2, 0, 1))[..., None] * 4.0

    # Mountain masses: the three largest, drawn as one flat tone.
    mass_mask = Image.new("L", (WIDTH, HEIGHT), 0)
    md = ImageDraw.Draw(mass_mask)
    for points in mountain_contours():
        md.polygon(points, fill=255)
    mass_mask = mass_mask.filter(ImageFilter.GaussianBlur(1.0))
    m = image_to_mask(mass_mask)
    a = m[..., None] * 0.94
    base = base * (1 - a) + np.array(MOUNTAIN_MID, dtype=np.float32)[None, None, :] * a

    # A hairline edge keeps the flat masses legible without adding shading.
    eroded = np.asarray(
        Image.fromarray((m * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(px_odd(3))), dtype=np.float32
    ) / 255.0
    edge = np.clip(m - eroded, 0, 1)
    edge = gaussian_blur(edge, 0.6)
    ea = np.clip(edge * 1.6, 0, 1)[..., None] * 0.22
    base = base * (1 - ea) + np.array(MOUNTAIN_EDGE, dtype=np.float32)[None, None, :] * ea

    # River.
    river = river_mask()
    # Soft edge for a crisp but anti-aliased bank.
    river_img = mask_to_image(river.astype(np.float32)).filter(ImageFilter.GaussianBlur(1.0))
    a = image_to_mask(river_img)[..., None]
    base = base * (1 - a) + np.array(RIVER, dtype=np.float32)[None, None, :] * a

    # River edge line.
    hard = (image_to_mask(river_img) > 0.5).astype(np.uint8) * 255
    eroded = np.asarray(Image.fromarray(hard, "L").filter(ImageFilter.MinFilter(px_odd(3))), dtype=np.float32) / 255.0
    edge = np.clip(image_to_mask(river_img) - eroded, 0, 1)
    edge = gaussian_blur(edge, 0.7)
    ea = np.clip(edge * 2.0, 0, 1)[..., None] * 0.52
    base = base * (1 - ea) + np.array(RIVER_EDGE, dtype=np.float32)[None, None, :] * ea

    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    # Two islands only.
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    islands = island_polygons()
    for _, pts in islands:
        # A narrow water moat keeps the island from reading as part of the bank.
        d.line(pts + [pts[0]], fill=RIVER + (255,), width=px(14), joint="curve")
        d.polygon(pts, fill=PAPER + (255,), outline=RIVER_EDGE + (190,), width=px(2))
    img = Image.alpha_composite(img, layer)

    # Save the unlabelled version first; it is the game-ready background.
    clean = finish(img, xx, yy)
    clean.save(OUT / f"duanzhou-dinghu-simple{SUFFIX}.png", optimize=True)
    if S == 1:
        clean.resize((1920, 1080), Image.Resampling.LANCZOS).save(
            OUT / "duanzhou-dinghu-simple-1920.png", optimize=True
        )

    # Labels.
    d = ImageDraw.Draw(img)
    dist_font = font(FONT_SERIF, px(46), "Regular")
    for name, lon, lat in [("端州区", 112.449, 23.090), ("鼎湖区", 112.628, 23.213)]:
        draw_tracked(d, project(lon, lat), name, dist_font, INK + (205,), tracking=px(12), anchor="mm", stroke_width=px(5), stroke_fill=PAPER + (220,))

    # River name.
    draw_tracked(
        d,
        project(112.664, 23.171),
        "西 江",
        font(FONT_SERIF, px(31), "Light"),
        (73, 111, 118, 220),
        tracking=px(9),
        anchor="mm",
        stroke_width=px(4),
        stroke_fill=RIVER + (160,),
    )

    # Island names.
    for (name, pts) in islands:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        cx = (min(xs) + max(xs)) / 2
        cy = (min(ys) + max(ys)) / 2
        draw_tracked(
            d,
            (cx, cy),
            name,
            font(FONT_SERIF, px(18 if name == "砚洲岛" else 17), "Medium"),
            INK + (170,),
            tracking=px(1),
            anchor="mm",
            stroke_width=px(3),
            stroke_fill=PAPER + (220,),
        )

    # City mark, intentionally tiny.
    x, y = project(112.468, 23.048)
    d.rectangle((x - px(4), y - px(4), x + px(4), y + px(4)), outline=INK + (160,), width=px(1))
    d.rectangle((x - px(1), y - px(1), x + px(1), y + px(1)), fill=INK + (160,))
    draw_tracked(d, (x + px(10), y + px(1)), "肇庆", font(FONT_SERIF, px(18), "Medium"), INK + (165,), tracking=px(1), anchor="lm", stroke_width=px(3), stroke_fill=PAPER + (180,))

    out = finish(img, xx, yy)
    out.save(OUT / f"duanzhou-dinghu-simple-labels{SUFFIX}.png", optimize=True)
    if S == 1:
        out.resize((1920, 1080), Image.Resampling.LANCZOS).save(
            OUT / "duanzhou-dinghu-simple-labels-1920.png", optimize=True
        )
    print(f"saved simple map {WIDTH}x{HEIGHT}; islands:", [n for n, _ in islands])


if __name__ == "__main__":
    main()
