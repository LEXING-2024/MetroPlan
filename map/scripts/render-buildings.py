"""Render the extracted building footprints over the paper basemap."""
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
    data = json.loads((AN / "buildings.geojson").read_text(encoding="utf-8"))
    for f in data["features"]:
        coords = f["geometry"]["coordinates"]
        outer = [project(x, y) for x, y in coords[0]]
        h = f["properties"]["height_m"]
        fill = (88, 78, 62, 115) if h < 12 else (120, 78, 56, 145)
        draw.polygon(outer, fill=fill)
        draw.line(outer, fill=(62, 54, 43, 155), width=1)
        for ring in coords[1:]:
            hole = [project(x, y) for x, y in ring]
            draw.polygon(hole, fill=(0, 0, 0, 0))
    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((34, 32, 820, 138), fill=(248, 244, 234, 230))
    d.text((54, 48), "建筑基底 / 建成区", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "OSM z14 building footprints · 6,104 栋去重 · 8.61 km² 基底", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    d.text((56, 112), "估算地上建筑面积 21.16 km²（按 render_height / 3m 估算层数）", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 建筑用途标签不完整，建筑轮廓≠住宅分类", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "building-footprints.png", optimize=True)
    print("wrote", AN / "building-footprints.png")


if __name__ == "__main__":
    main()
