"""Compose a before/after contact sheet for the basemap README."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT.parent / "assets" / "maps" / "duanzhou-dinghu-simple-labels.png"
NEW = ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440.png"
OUT = ROOT / "preview" / "comparison.png"

W, H = 2520, 960
M = 48
GAP = 24
IW, IH = 1200, 675

serif = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
sans = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


paper = (244, 240, 230)
ink = (52, 56, 47)
muted = (125, 130, 113)
line = (196, 190, 173)
warm = (180, 98, 63)

canvas = Image.new("RGB", (W, H), paper)
draw = ImageDraw.Draw(canvas)

draw.text((M, 30), "同一片端州 · 鼎湖", font=font(serif, 43), fill=ink)
draw.text(
    (M + 2, 88),
    "112.32–112.82°E  /  23.00–23.26°N   ·   16:9   ·   Web Mercator",
    font=font(sans, 16),
    fill=muted,
)
draw.text((W - M - 2, 92), "BASEMAP STUDY / 2026", font=font(sans, 13), fill=muted, anchor="ra")
draw.line((M, 118, W - M, 118), fill=line, width=1)

game = Image.open(GAME).convert("RGB").resize((IW, IH), Image.Resampling.LANCZOS)
new = Image.open(NEW).convert("RGB").resize((IW, IH), Image.Resampling.LANCZOS)
left = M
right = M + IW + GAP
top = 144
canvas.paste(game, (left, top))
canvas.paste(new, (right, top))
draw.rectangle((left - 1, top - 1, left + IW, top + IH), outline=line, width=1)
draw.rectangle((right - 1, top - 1, right + IW, top + IH), outline=line, width=1)

# Small paper tags over the upper-left of each plate.
def tag(x, y, text, accent=False):
    f = font(sans, 12)
    tw = draw.textlength(text, font=f)
    padx, pady = 10, 6
    fill = (63, 76, 64) if accent else (250, 247, 238)
    fg = (247, 243, 233) if accent else ink
    draw.rounded_rectangle(
        (x, y, x + tw + padx * 2, y + 28),
        radius=6,
        fill=fill,
        outline=None if accent else line,
    )
    draw.text((x + padx, y + pady), text, font=f, fill=fg)


tag(left + 14, top + 14, "BEFORE  /  静态 PNG")
tag(right + 14, top + 14, "AFTER  /  OSM VECTOR", accent=True)

draw.text((left, top + IH + 18), "游戏内置地形底图", font=font(sans, 16), fill=ink)
draw.text(
    (left, top + IH + 43),
    "只保留西江、山体、两个江心岛；没有道路、建筑与设施。",
    font=font(sans, 12),
    fill=muted,
)
draw.text(
    (right, top + IH + 18),
    "MapLibre · OpenFreeMap / OpenMapTiles",
    font=font(sans, 16),
    fill=ink,
)
draw.text(
    (right, top + IH + 43),
    "同一范围；道路、建筑、土地利用、水系与 POI 随缩放逐级展开。",
    font=font(sans, 12),
    fill=muted,
)

draw.line((M, H - 34, W - M, H - 34), fill=line, width=1)
draw.text(
    (M, H - 25),
    "Map data © OpenStreetMap contributors (ODbL)   ·   Tiles OpenFreeMap   ·   Terrain AWS Terrain Tiles / Mapzen Terrarium",
    font=font(sans, 10),
    fill=muted,
)

OUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUT, optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size / 1024 / 1024:.2f} MiB)")
