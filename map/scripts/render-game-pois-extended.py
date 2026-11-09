"""Render the extended 635-POI game layer (core large, local small)."""
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


def project(lon, lat):
    x = (lon - WEST) / (EAST - WEST) * W
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * H
    return x, y


def main():
    rows = list(csv.DictReader((AN / "game-pois-extended.csv").open(encoding="utf-8-sig")))
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r in rows:
        x, y = project(float(r["lon"]), float(r["lat"]))
        c = COLORS[r["poi_type"]]
        local = r["tier"] == "C"
        if r["poi_type"] == "industry":
            s = 4 if local else 8
            d.rectangle((x - s, y - s, x + s, y + s), fill=c + (170 if local else 210,))
        else:
            rad = 3 if local else 9
            d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=c + (140 if local else 225,))
    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    font = ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 14)
    shown = []
    for r in sorted([r for r in rows if r["tier"] != "C"], key=lambda r: (-int(r["level"]), -float(r["daily"]))):
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
    d.rectangle((34, 32, 900, 158), fill=(248, 244, 234, 234))
    d.text((54, 48), "游戏 POI 完整版", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf", 31), fill=(52, 56, 47))
    d.text((56, 88), f"{len(rows)} 个 POI · 核心 88 + 本地 547 · 9 类 · 含就业点", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(110, 115, 98))
    d.text((56, 114), "大点=城市级 S/A/B；小点=OSM 本地级 C；level 1-2 可按游戏需要过滤", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(70, 74, 62))
    d.rectangle((34, 1250, 300, 1352), fill=(248, 244, 234, 228))
    keys = ["scenic", "hospital", "station", "ferry", "school", "mall", "park", "stadium", "industry"]
    for i, k in enumerate(keys):
        yy = 1268 + i * 9
        c = COLORS[k]
        if k == "industry":
            d.rectangle((50, yy - 3, 58, yy + 3), fill=c)
        else:
            d.ellipse((50, yy - 3, 56, yy + 3), fill=c)
        d.text((66, yy - 6), k, font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 8), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 本地级为 OSM 命名 POI，置信度中等", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "game-pois-extended.png", optimize=True)
    print("wrote", AN / "game-pois-extended.png", "labels", len(shown))


if __name__ == "__main__":
    main()
