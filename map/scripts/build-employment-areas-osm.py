"""Build employment areas from OSM landuse=industrial polygons.

Adjacent industrial parcels are merged into employment districts, named by
the nearest named industrial park or town/village. Area and building floor
area are calculated; jobs are a game-balancing estimate.

Outputs:
  analysis/employment-areas-osm.geojson
  analysis/employment-areas-osm.csv
  analysis/employment-areas-osm-summary.json
"""
from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path

from shapely.geometry import Point, Polygon, shape
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
MX = 111_320.0 * math.cos(math.radians(23.13))
MY = 110_540.0


def area_km2(g):
    return abs(g.area) * MX * MY / 1_000_000


def main():
    raw = json.loads((AN / "raw" / "industrial-landuse.json").read_text(encoding="utf-8"))["features"]
    places = json.loads((AN / "places.geojson").read_text(encoding="utf-8"))["features"]
    named = json.loads((AN / "raw" / "industrial-named.json").read_text(encoding="utf-8"))["elements"]
    buildings = json.loads((AN / "buildings-osm.geojson").read_text(encoding="utf-8"))["features"]
    core = list(csv.DictReader((AN / "employment-areas.csv").open(encoding="utf-8-sig")))
    admin = json.loads((AN / "admin-areas.geojson").read_text(encoding="utf-8"))["features"]
    towns = [
        (f["properties"]["name"], shape(f["geometry"]).buffer(0))
        for f in admin if f["properties"].get("admin_level") == 8
    ]

    def town_of(pt):
        for name, geom in towns:
            if geom.covers(pt):
                return name
        return ""

    polys = []
    for f in raw:
        c = f["geometry"]["coordinates"]
        p = Polygon(c[0], c[1:]).buffer(0)
        if not p.is_empty:
            polys.append(p)
    # 25m buffer dissolves adjacent parcels/factory compounds into districts.
    merged = unary_union([p.buffer(25 / 111_000) for p in polys])
    clusters = list(merged.geoms) if hasattr(merged, "geoms") else [merged]

    place_pts = [(f["properties"], Point(f["geometry"]["coordinates"])) for f in places]
    named_pts = []
    park_re = re.compile(r"工业园|产业园|开发区|高新区|物流|科技园|基地|集聚|园区|工业区")
    for e in named:
        c = e.get("center") or {}
        n = e.get("tags", {}).get("name", "")
        if c.get("lon") and c.get("lat") and park_re.search(n):
            named_pts.append((n, Point(c["lon"], c["lat"])))

    bpoints = []
    bfloor = []
    for b in buildings:
        c = b["geometry"]["coordinates"][0][0]
        bpoints.append(Point(c[0], c[1]))
        bfloor.append(float(b["properties"].get("floor_area_m2") or 0))
    btree = STRtree(bpoints)

    core_pts = [Point(float(r["lon"]), float(r["lat"])) for r in core]
    rows = []
    seen_names = set()
    cluster_towns = set()
    for g in clusters:
        a = area_km2(g)
        if a < 0.05:
            continue
        c = g.representative_point()
        # Skip if this district already has a curated core employment point.
        if any(c.distance(p) <= 0.012 for p in core_pts):
            continue
        # Name priority: nearest named industrial park within 2km, else nearest place.
        town_name = town_of(c)
        nearest_place = ""
        best_place = 1e9
        for pl, pt in place_pts:
            d = c.distance(pt)
            if d < best_place:
                best_place, nearest_place = d, pl["name"]
        name = ""
        best = 1e9
        for n, p in named_pts:
            d = c.distance(p)
            if d < best and d <= 0.02:
                best, name = d, n
        if not name:
            name = f"{town_name}工业区" if town_name else f"{nearest_place}工业区"
        if name in seen_names:
            name = f"{name}·{nearest_place}"
        seen_names.add(name)
        idxs = btree.query(g)
        bcount = len(idxs)
        floor = sum(bfloor[int(i)] for i in idxs) / 1_000_000
        jobs = int(max(300, min(30000, max(floor * 1_000_000 / 60, a * 4000))))
        level = 4 if (a >= 0.8 or jobs >= 5000) else 3 if (a >= 0.2 or jobs >= 1500) else 2
        tier = "A" if level == 4 else "B" if level == 3 else "C"
        rows.append({
            "name": name,
            "town_name": town_name,
            "nearest_place": nearest_place,
            "poi_type": "industry",
            "category": "employment_osm",
            "tier": tier,
            "level": level,
            "radius_km": 3 if level == 4 else 2 if level == 3 else 1.2,
            "daily": jobs,
            "area_km2": round(a, 4),
            "building_count": bcount,
            "floor_area_km2": round(floor, 3),
            "lon": round(c.x, 7),
            "lat": round(c.y, 7),
            "source": "OSM landuse=industrial",
            "confidence": "medium",
            "note": "相邻工业用地合并；名称取最近工业园/镇村，就业量为估算",
        })
        if town_name:
            cluster_towns.add(town_name)

    named_by_town = {}
    for n, pt in named_pts:
        t = town_of(pt)
        if t:
            named_by_town.setdefault(t, []).append((n, pt))
    for town, pts in named_by_town.items():
        if town in cluster_towns or len(pts) < 2:
            continue
        town_geom = next((g for n, g in towns if n == town), None)
        area = 0.0
        if town_geom is not None:
            inside = [p for p in polys if town_geom.covers(p.representative_point())]
            if inside:
                area = area_km2(unary_union(inside))
        cx = sum(p.x for _, p in pts) / len(pts)
        cy = sum(p.y for _, p in pts) / len(pts)
        count = len(pts)
        jobs = int(max(300, min(20000, max(count * 120, area * 4000))))
        level = 3 if (count >= 10 or area >= 0.5) else 2
        name = f"{town}工业集聚区"
        if name in seen_names:
            name = f"{name}·{pts[0][0]}"
        seen_names.add(name)
        rows.append({
            "name": name,
            "town_name": town,
            "nearest_place": pts[0][0],
            "poi_type": "industry",
            "category": "employment_town",
            "tier": "B" if level == 3 else "C",
            "level": level,
            "radius_km": 2 if level == 3 else 1.2,
            "daily": jobs,
            "area_km2": round(area, 4),
            "building_count": 0,
            "floor_area_km2": 0.0,
            "lon": round(cx, 7),
            "lat": round(cy, 7),
            "source": "OSM named industrial points + landuse",
            "confidence": "medium",
            "note": f"{town} 有 {count} 个命名工业点，合并为镇级就业集聚区",
        })

    rows.sort(key=lambda r: (-r["area_km2"], -r["daily"]))
    features = []
    for i, r in enumerate(rows, 1):
        r["id"] = f"EM{i:03d}"
        features.append({"type": "Feature", "properties": r, "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]}})
    (AN / "employment-areas-osm.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-employment-osm", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "employment-areas-osm.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    summary = {
        "clusters": len(rows),
        "areaKm2": round(sum(r["area_km2"] for r in rows), 2),
        "byLevel": {str(l): sum(1 for r in rows if r["level"] == l) for l in (4, 3, 2)},
        "top": [(r["name"], r["area_km2"], r["daily"]) for r in rows[:12]],
        "note": "Only industrial landuse polygons not within 1.2km of a curated core employment POI; names are nearest named park/place.",
        "files": ["employment-areas-osm.geojson", "employment-areas-osm.csv"],
    }
    (AN / "employment-areas-osm-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
