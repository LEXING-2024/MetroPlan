"""Master residential-candidate map: communities, A/B/C/D sites, all villages."""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
W, H = 3840, 2160
SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
INK = (52, 56, 47)


def project(lon, lat):
    x = (lon - WEST) / (EAST - WEST) * W
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * H
    return x, y


def rings(feature):
    g = feature["geometry"]
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]


def draw_poly(draw, geom, fill, outline, width):
    geoms = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    for g in geoms:
        if g.geom_type != "Polygon":
            continue
        pts = [project(x, y) for x, y in g.exterior.coords]
        draw.polygon(pts, fill=fill)
        draw.line(pts, fill=outline, width=width)
        for hole in g.interiors:
            hp = [project(x, y) for x, y in hole.coords]
            draw.polygon(hp, fill=(0, 0, 0, 0))
            draw.line(hp, fill=outline, width=width)


def label(draw, shown, x, y, text, font, color, pad=3):
    box = draw.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    rect = (x - w / 2 - pad, y - h / 2 - pad, x + w / 2 + pad, y + h / 2 + pad)
    if not (0 <= x - w / 2 and x + w / 2 <= W and 0 <= y - h / 2 and y + h / 2 <= H):
        return False
    if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
        return False
    shown.append(rect)
    draw.text(
        (x, y),
        text,
        font=font,
        fill=color,
        anchor="mm",
        stroke_width=2,
        stroke_fill=(248, 244, 234, 238),
    )
    return True


def main():
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-3840x2160-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    landuse = json.loads((AN / "residential-landuse.geojson").read_text(encoding="utf-8"))["features"]
    communities = json.loads((AN / "residential-communities.geojson").read_text(encoding="utf-8"))["features"]
    sites = json.loads((AN / "residential-sites.geojson").read_text(encoding="utf-8"))["features"]
    villages = json.loads((AN / "residential-villages.geojson").read_text(encoding="utf-8"))["features"]

    # 1) all residential landuse polygons (named and unnamed) = area 28.67 km²
    for f in landuse:
        draw_poly(draw, shape(f["geometry"]), (180, 98, 63, 34), (150, 70, 40, 90), 2)

    # 2) site polygons by grade: A/B thick, C/D thin.
    site_colors = {
        "A": ((180, 98, 63, 18), (150, 70, 40, 230), 4),
        "B": ((194, 161, 94, 14), (160, 125, 55, 210), 3),
        "C": ((130, 130, 115, 10), (100, 100, 90, 160), 2),
        "D": ((92, 78, 64, 12), (70, 58, 45, 180), 2),
    }
    for f in sites:
        p = f["properties"]
        fill, outline, width = site_colors[p["grade"]]
        draw_poly(draw, shape(f["geometry"]), fill, outline, width)

    # 3) all village points (C points included); larger dots for A/B sites' villages.
    for f in villages:
        lon, lat = f["geometry"]["coordinates"]
        x, y = project(lon, lat)
        if 0 <= x < W and 0 <= y < H:
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(68, 73, 60, 150))

    # 4) labels: communities first, then sites, then unmatched quarter points.
    d = ImageDraw.Draw(overlay)
    shown = []
    comm_font = ImageFont.truetype(SANS, 17)
    site_font = ImageFont.truetype(SANS, 19)
    point_font = ImageFont.truetype(SANS, 15)

    for f in sorted(communities, key=lambda f: -f["properties"]["area_km2"])[:25]:
        p = f["properties"]
        x, y = project(p["center_lon"], p["center_lat"])
        label(d, shown, x, y, f"{p['name']}  {p['area_km2']:.2f}", comm_font, (126, 66, 43, 250), 3)

    # Keep the overview readable: label only the largest A/B sites.
    for f in sorted(
        [f for f in sites if f["properties"]["grade"] in ("A", "B")],
        key=lambda f: -f["properties"]["built_area_km2"],
    )[:30]:
        p = f["properties"]
        x, y = project(p["center_lon"], p["center_lat"])
        label(d, shown, x, y, f"{p['name']}  {p['built_area_km2']:.2f}", site_font, (130, 65, 40, 250), 3)

    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((38, 36, 1320, 190), fill=(248, 244, 234, 235))
    d.text((62, 54), "住宅候选总图", font=ImageFont.truetype(SERIF, 48), fill=INK)
    d.text((64, 112), "643 个有名称小区/住宅用地 · 196 个 A/B 聚落 · 443 个 C 村落点", font=ImageFont.truetype(SANS, 19), fill=(110, 115, 98))
    d.text((64, 148), "有面的显示面积 · 无面的用点 · 总图标注前 25 小区 + 前 30 A/B 聚落", font=ImageFont.truetype(SANS, 18), fill=(70, 74, 62))

    # A compact area table keeps all top areas readable without 600+ labels.
    panel_x0, panel_y0, panel_x1, panel_y1 = W - 620, 36, W - 82, 760
    d.rectangle((panel_x0, panel_y0, panel_x1, panel_y1), fill=(248, 244, 234, 232))
    px = panel_x0 + 22
    py = panel_y0 + 20
    d.text((px, py), "面积前 10 小区", font=ImageFont.truetype(SERIF, 24), fill=INK)
    py += 38
    for f in sorted(communities, key=lambda f: -f["properties"]["area_km2"])[:10]:
        p = f["properties"]
        d.text((px, py), f"{p['name'][:10]}  {p['area_km2']:.2f}", font=ImageFont.truetype(SANS, 16), fill=(70, 74, 62))
        py += 23
    py += 12
    d.text((px, py), "面积前 10 A/B 聚落", font=ImageFont.truetype(SERIF, 24), fill=INK)
    py += 38
    top_sites = sorted(
        [f for f in sites if f["properties"]["grade"] in ("A", "B")],
        key=lambda f: -f["properties"]["built_area_km2"],
    )[:10]
    for f in top_sites:
        p = f["properties"]
        d.text((px, py), f"{p['grade']} · {p['name'][:9]}  {p['built_area_km2']:.2f}", font=ImageFont.truetype(SANS, 16), fill=(70, 74, 62))
        py += 23
    d.text((px, panel_y1 - 30), "完整 643 小区 / 267 聚落见 CSV", font=ImageFont.truetype(SANS, 13), fill=(110, 115, 98))

    d.rectangle((38, 1900, 540, 2108), fill=(248, 244, 234, 230))
    legend = [
        ((180, 98, 63, 110), "小区 / 住宅用地（面积）"),
        ((180, 98, 63, 230), "A 明确住宅聚落（面积）"),
        ((194, 161, 94, 210), "B 高可能聚落（面积）"),
        ((100, 100, 90, 180), "C 村落候选（点）"),
        ((70, 58, 45, 180), "D 工业/不宜"),
        ((68, 73, 60, 150), "村落点"),
    ]
    for i, (color, text) in enumerate(legend):
        yy = 1928 + i * 27
        if text.startswith("C"):
            d.ellipse((70, yy - 6, 82, yy + 6), fill=color)
        else:
            d.rectangle((66, yy - 6, 86, yy + 6), outline=color, width=3)
        d.text((100, yy - 10), text, font=ImageFont.truetype(SANS, 16), fill=(70, 74, 62))
    d.text((38, 2130), "数据 © OpenStreetMap contributors (ODbL) · 标注碰撞会隐藏部分名称，完整数据见 CSV", font=ImageFont.truetype(SANS, 15), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "residential-overview.png", optimize=True)
    print("wrote", AN / "residential-overview.png", "labels", len(shown))


if __name__ == "__main__":
    main()
