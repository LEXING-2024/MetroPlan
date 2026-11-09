"""Build a game-ready POI set: destinations + employment areas.

Destination POIs come from destination-pois.csv (fame-ranked).
Employment POIs are named OSM industrial/logistics parks and major employers.
Outputs include game fields: poi_type, level, radius_km, daily (estimate).
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"

# name, tier, employment_type, lon, lat, daily_jobs_est, note
EMPLOYMENT = [
    ("肇庆新区电子信息产业园", "A", "industrial_park", 112.65929, 23.19286, 18000, "肇庆新区电子信息产业集群"),
    ("平谦国际产业园", "A", "industrial_park", 112.66952, 23.19269, 15000, "肇庆新区现代产业园"),
    ("希音湾区西部智慧产业园", "A", "logistics", 112.68636, 23.19757, 20000, "跨境电商/供应链龙头"),
    ("肇庆鼎湖京东智能产业园", "A", "logistics", 112.72809, 23.18527, 12000, "京东智能物流/仓储"),
    ("永安工业园", "A", "industrial_park", 112.69709, 23.19188, 16000, "鼎湖永安工业集聚区"),
    ("金陶工业园", "A", "industrial_park", 112.76046, 23.11695, 12000, "高要金利陶瓷产业"),
    ("金渡工业园", "A", "industrial_park", 112.57046, 23.02927, 14000, "高要金渡工业集聚区"),
    ("粤港澳大湾区(高要)预制菜产业园", "A", "industrial_park", 112.56357, 23.02462, 10000, "预制菜/食品加工"),
    ("端州工业园", "A", "industrial_park", 112.51704, 23.08080, 12000, "端州城区工业/科创"),
    ("风华电子工业园", "A", "manufacturing", 112.43726, 23.06920, 15000, "风华高科电子元器件"),
    ("风华高科高端电容基地", "A", "manufacturing", 112.40397, 23.07794, 10000, "风华高科扩产基地"),
    ("广东鸿图科技园", "A", "manufacturing", 112.75597, 23.06946, 8000, "汽车压铸零部件"),
    ("肇庆市物流园", "A", "logistics", 112.43362, 23.07520, 6000, "端州西侧物流集聚"),
    ("广东健力宝", "A", "manufacturing", 112.81345, 23.10120, 5000, "饮料制造龙头"),
    ("贝水工业园", "B", "industrial_park", 112.72592, 23.21579, 8000, "鼎湖贝水工业片区"),
    ("永安镇经济开发区", "B", "industrial_park", 112.69916, 23.18199, 8000, "永安镇工业平台"),
    ("泰隆工业园", "B", "industrial_park", 112.41574, 23.08057, 4000, "端州西侧工业园"),
    ("华英太和产业园", "B", "industrial_park", 112.42602, 23.07434, 3000, "端州小型产业园"),
    ("高要精密物流园", "B", "logistics", 112.52973, 23.04926, 4000, "高要物流节点"),
    ("肇庆中安智谷产业园", "B", "industrial_park", 112.74296, 23.10883, 5000, "高要智造园"),
    ("吉鑫工业园", "B", "industrial_park", 112.74507, 23.10460, 3500, "高要工业园"),
    ("大洲工业区", "B", "industrial_park", 112.41998, 23.07760, 3000, "端州大洲工业区"),
    ("俊富(肇庆)工业园", "B", "industrial_park", 112.41233, 23.08129, 3000, "端州俊富工业园"),
    ("鼎湖山泉工业园区", "B", "manufacturing", 112.57644, 23.17358, 2500, "包装饮用水生产"),
    ("广东新大明铝业", "B", "manufacturing", 112.70113, 23.19801, 2500, "铝型材制造"),
    ("粤隆纺织", "B", "manufacturing", 112.69944, 23.18819, 2000, "纺织制造"),
]

LEVELS = {
    "七星岩": 6, "鼎湖山": 6,
    "宋城墙": 5, "阅江楼": 5, "七星岩牌坊广场": 5, "肇庆市博物馆": 5,
    "梅庵": 4, "包公祠": 4, "崇禧塔": 4, "羚羊峡古栈道": 4, "砚洲岛": 4,
    "肇庆东站": 5, "肇庆站": 4, "鼎湖东站": 3, "鼎湖山站": 3, "肇庆城东粤运汽车站": 4,
    "肇庆市第一人民医院": 5, "肇庆市中医院": 4, "肇庆市第二人民医院": 4,
    "高要区人民医院": 4, "端州区人民医院": 4, "鼎湖区人民医院": 3,
    "星湖国际广场": 4, "益华国际广场": 4, "肇庆万达广场": 4,
    "肇庆市体育中心": 4,
    "肇庆学院": 4, "广东肇庆中学": 4, "肇庆市第一中学": 4,
    "广东理工学院": 3, "肇庆医学院": 3, "广东工商职业技术大学": 3,
    "中国端砚博物馆": 4, "端砚文化村": 3,
    "广东金融学院肇庆校区": 3, "广东肇庆航空职业学院": 3,
    "肇庆市端州中学": 3, "肇庆市颂德中学": 3, "高要区第一中学": 3,
    "鼎湖中学": 3, "肇庆市实验中学": 3, "肇庆加美学校": 3, "鼎湖区广利高级中学": 3,
    "北岭山森林公园": 2, "波海公园": 2, "牌坊公园": 2, "城东公园": 2,
    "砚阳湖公园": 2, "长利湖沙滩公园": 2, "鼎湖体育公园": 2, "星湖湾公园": 2,
    "星湖博物馆": 2, "肇庆学院博物馆": 2, "肇庆城市规划展览馆": 2,
    "星岩书院": 2, "石牌里民宿文创街区": 2,
}
DAILY = {6: 80000, 5: 30000, 4: 12000, 3: 5000, 2: 1800, 1: 600}
RADIUS = {6: 8, 5: 5, 4: 3, 3: 2, 2: 1.2, 1: 0.6}

FERRIES = [
    ("东门广场码头", 3, 112.48256, 23.07622, 3000, "星湖东门/牌坊广场水上游线"),
    ("岩前码头", 3, 112.47279, 23.07086, 2500, "星湖岩前水上交通"),
    ("七星岩南门码头", 3, 112.47681, 23.07391, 2500, "七星岩南门水上游线"),
    ("牌坊广场码头", 3, 112.46436, 23.05983, 3000, "牌坊广场/星湖游船"),
    ("波海码头", 2, 112.44489, 23.08210, 1200, "波海湖社区码头"),
    ("砚洲渡口", 3, 112.61647, 23.18180, 1800, "砚洲岛跨江渡口"),
]


def main():
    dest = list(csv.DictReader((AN / "destination-pois.csv").open(encoding="utf-8-sig")))
    rows = []
    for d in dest:
        kind = d["kind"]
        poi_type = {
            "scenic": "scenic",
            "heritage": "scenic",
            "culture": "scenic",
            "landmark": "scenic",
            "transit": "station",
            "medical": "hospital",
            "education": "school",
            "mall": "mall",
            "park": "park",
            "sports": "stadium",
        }.get(kind, "scenic")
        tier = d["tier"]
        level = LEVELS.get(d["name"], 5 if tier == "S" else 4 if tier == "A" else 3)
        daily = DAILY[level]
        radius = RADIUS[level]
        rows.append({
            "name": d["name"],
            "poi_type": poi_type,
            "category": kind,
            "tier": tier,
            "level": level,
            "radius_km": radius,
            "daily": daily,
            "lon": d["lon"],
            "lat": d["lat"],
            "source": "OSM + curated fame",
            "confidence": "high" if tier in ("S", "A") else "medium",
            "note": d["reason"],
        })

    for name, tier, etype, lon, lat, jobs, note in EMPLOYMENT:
        rows.append({
            "name": name,
            "poi_type": "industry",
            "category": etype,
            "tier": tier,
            "level": 4 if tier == "A" else 3,
            "radius_km": 3 if tier == "A" else 2,
            "daily": jobs,
            "lon": lon,
            "lat": lat,
            "source": "OSM industrial landuse/name",
            "confidence": "medium",
            "note": note,
        })

    for name, level, lon, lat, daily, note in FERRIES:
        rows.append({
            "name": name,
            "poi_type": "ferry",
            "category": "ferry",
            "tier": "A" if level >= 3 else "B",
            "level": level,
            "radius_km": RADIUS[level],
            "daily": daily,
            "lon": lon,
            "lat": lat,
            "source": "OSM ferry_terminal",
            "confidence": "medium",
            "note": note,
        })

    rows.sort(key=lambda r: ({"S": 0, "A": 1, "B": 2}[r["tier"]], r["poi_type"], -int(r["daily"])))
    features = []
    for i, r in enumerate(rows, 1):
        r["id"] = f"P{i:03d}"
        features.append({
            "type": "Feature",
            "properties": r,
            "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
        })
    (AN / "game-pois.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-game-pois", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "game-pois.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    emp_features = [f for f in features if f["properties"]["poi_type"] == "industry"]
    (AN / "employment-areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-employment-areas", "features": emp_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "employment-areas.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows([r for r in rows if r["poi_type"] == "industry"])

    summary = {
        "total": len(rows),
        "byType": {t: sum(1 for r in rows if r["poi_type"] == t) for t in sorted({r["poi_type"] for r in rows})},
        "byTier": {t: sum(1 for r in rows if r["tier"] == t) for t in "SAB"},
        "employment": len(emp_features),
        "note": "daily is an estimated attraction/commuter volume for game balancing, not measured traffic; level is assigned per POI (6 national, 5 citywide, 4 important, 3 district, 2 community).",
        "files": ["game-pois.geojson", "game-pois.csv", "employment-areas.geojson", "employment-areas.csv"],
    }
    (AN / "game-pois-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
