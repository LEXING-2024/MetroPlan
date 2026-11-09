"""Render raw OSM buildings colored by known use class."""
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
COLORS = {
    "residential": (180, 98, 63, 185),
    "industrial": (90, 75, 60, 190),
    "commercial": (186, 145, 78, 180),
    "civic": (74, 107, 79, 170),
    "unknown": (145, 140, 128, 105),
    "other": (120, 115, 104, 100),
}


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
    data = json.loads((AN / "buildings-osm.geojson").read_text(encoding="utf-8"))
    counts = {}
    for f in data["features"]:
        kind = f["properties"]["building_type"]
        counts[kind] = counts.get(kind, 0) + 1
        coords = f["geometry"]["coordinates"]
        pts = [project(x, y) for x, y in coords[0]]
        fill = COLORS.get(kind, COLORS["other"])
        draw.polygon(pts, fill=fill)

    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((34, 32, 930, 156), fill=(248, 244, 234, 232))
    d.text((54, 48), "建筑用途分类", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "OSM 原始 building=* 标签 · 5,756 栋可用建筑", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    d.text((56, 112), "住宅 1,476 · 工业 199 · 商业 215 · 公共 256 · 未标注 3,506", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))
    d.rectangle((34, 1270, 420, 1360), fill=(248, 244, 234, 226))
    legend = [
        ("residential", "住宅（含公寓/宿舍）"),
        ("industrial", "工业/仓储"),
        ("commercial", "商业"),
        ("civic", "学校/医院等"),
        ("unknown", "building=yes（用途未知）"),
    ]
    for i, (kind, label) in enumerate(legend):
        yy = 1289 + i * 15
        d.rectangle((50, yy - 5, 78, yy + 5), fill=COLORS[kind], outline=COLORS[kind])
        d.text((88, yy - 7), label, font=ImageFont.truetype(SANS, 10), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 住宅用途仅统计有明确 building 标签的建筑", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "building-types.png", optimize=True)
    print("wrote", AN / "building-types.png", counts)


if __name__ == "__main__":
    main()
