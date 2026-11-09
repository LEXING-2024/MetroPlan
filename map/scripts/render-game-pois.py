"""Render the game-ready POI set by type."""
from pathlib import Path
import csv
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
W, H = 2560, 1440
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
COLORS = {
    "scenic": (180, 72, 48),
    "hospital": (185, 95, 110),
    "station": (80, 105, 140),
    "ferry": (70, 125, 135),
    "school": (188, 145, 60),
    "mall": (150, 100, 155),
    "park": (90, 125, 78),
    "stadium": (130, 100, 160),
    "industry": (110, 95, 72),
}
LABELS = {
    "scenic": "景点/文化",
    "hospital": "医院",
    "station": "铁路/客运",
    "ferry": "渡口",
    "school": "学校/高校",
    "mall": "商场",
    "park": "公园",
    "stadium": "体育",
    "industry": "就业/工业",
}


def project(lon, lat):
    x = (lon - WEST) / (EAST - WEST) * W
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * H
    return x, y


def main():
    rows = list(csv.DictReader((AN / "game-pois.csv").open(encoding="utf-8-sig")))
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r in rows:
        x, y = project(float(r["lon"]), float(r["lat"]))
        c = COLORS[r["poi_type"]]
        if r["poi_type"] == "industry":
            d.rectangle((x - 8, y - 8, x + 8, y + 8), fill=c + (200,), outline=(248, 244, 234, 220), width=2)
        else:
            r0 = 9 if r["level"] in ("6", "5") else 7
            d.ellipse((x - r0, y - r0, x + r0, y + r0), fill=c + (220,), outline=(248, 244, 234, 230), width=2)
    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    font = ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 14)
    shown = []
    for r in sorted(rows, key=lambda r: (-int(r["level"]), -int(r["daily"]))):
        x, y = project(float(r["lon"]), float(r["lat"]))
        text = r["name"]
        b = d.textbbox((0, 0), text, font=font)
        w, h = b[2] - b[0], b[3] - b[1]
        rect = (x + 12, y - h / 2 - 3, x + 12 + w, y + h / 2 + 3)
        if rect[2] > W or rect[3] > H:
            continue
        if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
            continue
        shown.append(rect)
        d.text((x + 15, y), text, font=font, fill=(62, 56, 46), anchor="lm", stroke_width=2, stroke_fill=(248, 244, 234, 230))
    d.rectangle((34, 32, 850, 150), fill=(248, 244, 234, 234))
    d.text((54, 48), "游戏 POI 总表", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf", 31), fill=(52, 56, 47))
    d.text((56, 88), f"{len(rows)} 个 POI · 9 类 · 含 26 个就业/工业点 · 按游戏 level 分级", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(110, 115, 98))
    d.text((56, 114), "S=5/6 城市级 · A=4 · B=3/2 片区级；daily 为游戏估算，不是实测客流", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(70, 74, 62))
    d.rectangle((34, 1200, 420, 1352), fill=(248, 244, 234, 228))
    keys = ["scenic", "hospital", "station", "ferry", "school", "mall", "park", "stadium", "industry"]
    for i, k in enumerate(keys):
        yy = 1222 + i * 14
        c = COLORS[k]
        if k == "industry":
            d.rectangle((50, yy - 5, 64, yy + 5), fill=c)
        else:
            d.ellipse((50, yy - 5, 62, yy + 5), fill=c)
        d.text((72, yy - 7), LABELS[k], font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 10), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 设施坐标来自 OSM，daily 为游戏平衡估算", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "game-pois.png", optimize=True)
    print("wrote", AN / "game-pois.png", "labels", len(shown))


if __name__ == "__main__":
    main()
