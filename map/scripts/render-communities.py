"""Render named landuse=residential communities (小区) over the paper map."""
from pathlib import Path
import json
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
W, H = 2560, 1440
SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
INK = (52, 56, 47)


def project(lon, lat):
    x = (lon - WEST) / (EAST - WEST) * W
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * H
    return x, y


def main():
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    data = json.loads((AN / "residential-communities.geojson").read_text(encoding="utf-8"))
    for f in data["features"]:
        coords = f["geometry"]["coordinates"]
        polys = [coords] if f["geometry"]["type"] == "Polygon" else coords
        for poly in polys:
            outer = [project(x, y) for x, y in poly[0]]
            draw.polygon(outer, fill=(180, 98, 63, 95))
            draw.line(outer, fill=(150, 70, 40, 170), width=1)
    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    labels = sorted(data["features"], key=lambda f: -f["properties"]["area_km2"])[:45]
    shown = []
    font = ImageFont.truetype(SANS, 12)
    for f in labels:
        p = f["properties"]
        x, y = project(p["center_lon"], p["center_lat"])
        text = p["name"]
        box = d.textbbox((0, 0), text, font=font)
        w, h = box[2] - box[0], box[3] - box[1]
        rect = (x - w / 2 - 4, y - h / 2 - 3, x + w / 2 + 4, y + h / 2 + 3)
        if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
            continue
        if not (0 <= x <= W and 0 <= y <= H):
            continue
        shown.append(rect)
        d.text((x, y), text, font=font, fill=(120, 62, 40, 245), anchor="mm", stroke_width=2, stroke_fill=(248, 244, 234, 240))
    d.rectangle((34, 32, 930, 145), fill=(248, 244, 234, 232))
    d.text((54, 48), "小区 / 住宅用地", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "OSM landuse=residential 且有名称的面 · 643 个 · 19.94 km²", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    d.text((56, 112), "多数对应楼盘/小区；面内可能包含多个小区，不能当法定宗地", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 小区边界为 OSM landuse，非产权边界", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "residential-communities.png", optimize=True)
    print("wrote", AN / "residential-communities.png", "labels", len(shown))


if __name__ == "__main__":
    main()
