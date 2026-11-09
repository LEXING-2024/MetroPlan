"""Curated destination POIs ranked by fame / cross-city trip attraction.

Not a residential-amenity coverage list. Markets/convenience stores are
deliberately excluded: they serve local daily needs, not citywide visitation.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"

# name, tier, kind, lon, lat, fame, reason
POIS = [
    ("七星岩", "S", "scenic", 112.47270, 23.08057, 100, "国家 5A 级星湖旅游景区核心，肇庆第一城市名片"),
    ("鼎湖山", "S", "scenic", 112.56550, 23.16700, 98, "国家 5A 级景区、国家级自然保护区，岭南名山；入口坐标为近似值"),
    ("宋城墙", "S", "heritage", 112.45491, 23.04807, 93, "全国重点文物保护单位，肇庆古城标志"),
    ("阅江楼", "S", "heritage", 112.46669, 23.04736, 91, "全国重点文物保护单位、叶挺独立团团部旧址，红色旅游目的地"),
    ("梅庵", "S", "heritage", 112.44231, 23.05297, 88, "全国重点文物保护单位，岭南古建筑名刹"),
    ("包公祠", "S", "heritage", 112.42950, 23.04786, 84, "包公文化核心纪念地，城市文化 IP"),
    ("崇禧塔", "S", "heritage", 112.47774, 23.04720, 82, "西江古塔地标，省级文物保护单位"),
    ("肇庆市博物馆", "S", "culture", 112.45955, 23.05074, 80, "城市级综合博物馆，新馆"),
    ("羚羊峡古栈道", "S", "scenic", 112.52516, 23.08441, 80, "西江三峡之一，古道/峡谷徒步目的地"),
    ("砚洲岛", "S", "scenic", 112.60986, 23.17466, 78, "西江江心岛、包公掷砚传说地，渡口型旅游点"),
    ("七星岩牌坊广场", "S", "landmark", 112.46436, 23.05983, 86, "肇庆夜间地标和旅游集散节点"),
    ("肇庆东站", "A", "transit", 112.65812, 23.21739, 85, "高铁门户，跨城客流最大入口之一"),
    ("肇庆站", "A", "transit", 112.44584, 23.08471, 82, "普速/城际铁路站，传统城市门户"),
    ("鼎湖东站", "A", "transit", 112.65498, 23.21668, 75, "城际铁路站，服务鼎湖—肇庆新区"),
    ("鼎湖山站", "A", "transit", 112.58198, 23.17665, 72, "城际站，鼎湖山景区主要轨道接驳"),
    ("肇庆城东粤运汽车站", "A", "transit", 112.48601, 23.06227, 72, "长途客运主站，跨市客流入口"),
    ("肇庆市第一人民医院", "A", "medical", 112.50400, 23.09984, 80, "城市级三甲综合医院，跨区就医目的地"),
    ("肇庆市中医院", "A", "medical", 112.44938, 23.05617, 74, "城市级中医医院"),
    ("肇庆市第二人民医院", "A", "medical", 112.49315, 23.05444, 72, "城市级综合医院"),
    ("高要区人民医院", "A", "medical", 112.46490, 23.05253, 70, "高要区级综合医院"),
    ("端州区人民医院", "A", "medical", 112.45832, 23.05332, 68, "端州区级综合医院"),
    ("鼎湖区人民医院", "A", "medical", 112.56964, 23.19193, 65, "鼎湖区级综合医院"),
    ("星湖国际广场", "A", "mall", 112.46682, 23.05880, 74, "城市级商业综合体，邻近牌坊广场"),
    ("益华国际广场", "A", "mall", 112.49788, 23.07117, 72, "城市级商业综合体"),
    ("肇庆万达广场", "A", "mall", 112.55641, 23.14644, 70, "鼎湖/肇庆新区商业中心"),
    ("肇庆市体育中心", "A", "sports", 112.44857, 23.06284, 68, "城市级体育场馆，赛事/演出目的地"),
    ("肇庆学院", "A", "education", 112.48883, 23.11071, 72, "本科高校，学生/家长跨城出行"),
    ("广东理工学院", "A", "education", 112.54108, 23.14340, 65, "本科高校，鼎湖校区"),
    ("肇庆医学院", "A", "education", 112.58021, 23.20619, 63, "医学类高校，鼎湖校区"),
    ("北岭山森林公园", "B", "park", 112.49848, 23.11735, 58, "城市近郊山体公园"),
    ("波海公园", "B", "park", 112.45422, 23.08185, 55, "星湖西岸城市公园"),
    ("牌坊公园", "B", "park", 112.46529, 23.06397, 60, "牌坊广场周边城市公园"),
    ("城东公园", "B", "park", 112.48336, 23.05692, 55, "端州城东片区综合公园"),
    ("砚阳湖公园", "B", "park", 112.59726, 23.19452, 58, "肇庆新区大型湖体公园"),
    ("长利湖沙滩公园", "B", "park", 112.60345, 23.20736, 54, "肇庆新区滨水休闲公园"),
    ("鼎湖体育公园", "B", "park", 112.56616, 23.17977, 50, "鼎湖区体育主题公园"),
    ("星湖湾公园", "B", "park", 112.46956, 23.06560, 50, "星湖湾社区体育公园"),
    # Universities / colleges
    ("广东工商职业技术大学", "A", "education", 112.47300, 23.09628, 60, "本科层次职业大学，城市级高校"),
    ("广东金融学院肇庆校区", "B", "education", 112.47355, 23.08781, 58, "本科高校校区"),
    ("广东肇庆航空职业学院", "B", "education", 112.62327, 23.05336, 52, "航空类高职院校"),
    # Notable high schools
    ("广东肇庆中学", "A", "education", 112.49216, 23.09547, 70, "肇庆头部中学，跨区招生/家长出行"),
    ("肇庆市第一中学", "A", "education", 112.50879, 23.06187, 68, "市属重点中学"),
    ("肇庆市端州中学", "B", "education", 112.48572, 23.05705, 58, "端州区重点中学"),
    ("肇庆市颂德中学", "B", "education", 112.48688, 23.06792, 55, "端州区中学"),
    ("高要区第一中学", "B", "education", 112.45843, 23.02743, 56, "高要区重点中学"),
    ("鼎湖中学", "B", "education", 112.57586, 23.19490, 53, "鼎湖区重点中学"),
    ("肇庆市实验中学", "B", "education", 112.46640, 23.02813, 52, "市属中学"),
    ("鼎湖区广利高级中学", "B", "education", 112.61005, 23.19153, 48, "鼎湖区广利片区高中"),
    ("肇庆加美学校", "B", "education", 112.44228, 23.08696, 50, "民办学校"),
    # Museums / cultural venues
    ("中国端砚博物馆", "A", "culture", 112.50872, 23.07030, 76, "端砚文化专题博物馆，城市文化名片"),
    ("端砚文化村", "A", "culture", 112.50858, 23.07056, 60, "端砚文化/文创街区"),
    ("星湖博物馆", "B", "culture", 112.47614, 23.07549, 58, "星湖景区专题博物馆"),
    ("肇庆学院博物馆", "B", "culture", 112.48984, 23.10982, 50, "高校博物馆"),
    ("肇庆城市规划展览馆", "B", "culture", 112.59441, 23.20035, 55, "城市规划展示场馆"),
    ("星岩书院", "B", "culture", 112.46087, 23.05450, 55, "古城文化书院"),
    ("石牌里民宿文创街区", "B", "culture", 112.48826, 23.08510, 50, "文创/民宿街区"),
    ("肇庆儿童公园", "A", "park", 112.463334, 23.052665, 66, "百年儿童公园，城市亲子地标"),
    ("紫云谷", "A", "scenic", 112.582704, 23.128753, 74, "西江羚羊峡/烂柯山生态景区，广东小九寨，唐代砚坑"),
    ("庆云寺", "B", "culture", 112.541287, 23.171386, 60, "鼎湖山庆云寺，岭南名刹"),
    ("白石村", "B", "culture", 112.510057, 23.068889, 58, "端砚文化发源地/白石村"),
    ("肇庆新区体育中心", "A", "sports", 112.603450, 23.211800, 72, "肇庆新区城市级体育中心"),
    ("西江体育场", "A", "sports", 112.453380, 23.046870, 64, "端州老城西江体育场"),
    ("端州体育场", "B", "sports", 112.463340, 23.053380, 58, "端州区体育场"),
    ("肇庆市国家水上运动训练基地", "B", "sports", 112.458750, 23.081240, 60, "国家级水上运动训练基地"),
]


def main():
    features = []
    rows = []
    for name, tier, kind, lon, lat, fame, reason in POIS:
        props = {
            "name": name,
            "tier": tier,
            "kind": kind,
            "fame_score": fame,
            "reason": reason,
            "lon": lon,
            "lat": lat,
        }
        rows.append(props)
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        })
    features.sort(key=lambda f: (-f["properties"]["fame_score"], f["properties"]["name"]))
    rows.sort(key=lambda p: (-p["fame_score"], p["name"]))
    (AN / "destination-pois.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-destination-pois", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "destination-pois.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    summary = {
        "count": len(rows),
        "byTier": {t: sum(1 for r in rows if r["tier"] == t) for t in "SAB"},
        "note": "Fame/importance ranking for cross-city trip attraction, not residential amenity coverage. Scores are expert-curated from scenic/heritage/hospital/transit/university status; 鼎湖山 entrance coordinate is approximate.",
        "files": ["destination-pois.geojson", "destination-pois.csv", "destination-pois.png"],
    }
    (AN / "destination-pois-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    render(features)


def project(lon, lat):
    west, south, east, north = 112.32, 23.00, 112.82, 23.26
    x = (lon - west) / (east - west) * 2560
    y0 = math.asinh(math.tan(math.radians(north)))
    y1 = math.asinh(math.tan(math.radians(south)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * 1440
    return x, y


def render(features):
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    colors = {"S": (180, 72, 48, 235), "A": (190, 135, 55, 225), "B": (92, 120, 76, 210)}
    for f in features:
        p = f["properties"]
        x, y = project(p["lon"], p["lat"])
        r = 10 if p["tier"] == "S" else 8
        d.ellipse((x - r, y - r, x + r, y + r), fill=colors[p["tier"]], outline=(248, 244, 234, 240), width=2)
    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    font = ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 15)
    shown = []
    for f in sorted(features, key=lambda f: (f["properties"]["tier"] != "S", -f["properties"]["fame_score"])):
        p = f["properties"]
        x, y = project(p["lon"], p["lat"])
        text = p["name"]
        b = d.textbbox((0, 0), text, font=font)
        w, h = b[2] - b[0], b[3] - b[1]
        rect = (x + 12, y - h / 2 - 3, x + 12 + w, y + h / 2 + 3)
        if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
            continue
        if rect[2] > 2560 or rect[3] > 1440:
            continue
        shown.append(rect)
        d.text((x + 15, y), text, font=font, fill=(65, 55, 42), anchor="lm", stroke_width=2, stroke_fill=(248, 244, 234, 230))
    d.rectangle((34, 32, 760, 142), fill=(248, 244, 234, 232))
    serif = ImageFont.truetype(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf", 31)
    d.text((54, 48), "目的地型 POI", font=serif, fill=(52, 56, 47))
    d.text((56, 87), "S 城市名片 · A 城市级枢纽/医院/高校/商业 · B 片区级公园", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(110, 115, 98))
    d.text((56, 112), "按知名度与跨区域到访吸引力排序，不按菜市场/便利店覆盖排序", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 12), fill=(70, 74, 62))
    d.rectangle((34, 1260, 270, 1350), fill=(248, 244, 234, 225))
    for i, (tier, label) in enumerate([("S", "S 城市名片"), ("A", "A 城市级"), ("B", "B 片区级")]):
        yy = 1280 + i * 22
        d.ellipse((50, yy - 6, 62, yy + 6), fill=colors[tier])
        d.text((72, yy - 8), label, font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 11), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 鼎湖山入口坐标为近似值", font=ImageFont.truetype(r"C:\Windows\Fonts\NotoSansSC-VF.ttf", 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "destination-pois.png", optimize=True)
    print("wrote", AN / "destination-pois.png", "labels", len(shown))


if __name__ == "__main__":
    main()
