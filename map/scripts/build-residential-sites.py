"""Build evidence-graded residential sites and attach every village point.

Method:
- group OSM buildings by the 148 residential units
- DBSCAN building centroids within each unit (eps 90m, min 3)
- dissolve building footprints + 35m buffer -> built-up site polygon
- grade A/B/C/D using explicit residential buildings, landuse=residential,
  industrial share and nearby village names
- keep all 740 place points as village candidates, linked to units/sites

Outputs:
  analysis/residential-sites.geojson
  analysis/residential-sites.csv
  analysis/residential-villages.geojson
  analysis/residential-villages.csv
  analysis/residential-sites-summary.json
  analysis/residential-sites.png
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import nearest_points, unary_union
from sklearn.cluster import DBSCAN

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
LAT0 = 23.13
MX = 111_320.0 * math.cos(math.radians(LAT0))
MY = 110_540.0
SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
INK = (52, 56, 47)


def xy(lon, lat):
    return ((lon - 112.57) * MX, (lat - LAT0) * MY)


def area_km2(geom):
    return abs(geom.area) * MX * MY / 1_000_000


def read(path):
    return json.loads((AN / path).read_text(encoding="utf-8"))


def main():
    units = read("residential-units.geojson")["features"]
    buildings = read("buildings-osm.geojson")["features"]
    places = read("places.geojson")["features"]
    landuse = read("residential-landuse.geojson")["features"]
    res_landuse = unary_union([shape(f["geometry"]).buffer(0) for f in landuse])

    # Keep building geometry and unit membership.
    unit_geoms = []
    for i, f in enumerate(units):
        geom = shape(f["geometry"]).buffer(0)
        unit_geoms.append((i, f["properties"], geom))
    buildings_by_unit = defaultdict(list)
    for f in buildings:
        c = Polygon(f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1:]).centroid
        for idx, props, ug in unit_geoms:
            if ug.covers(c):
                buildings_by_unit[idx].append((f, c))
                break

    site_features = []
    site_rows = []
    site_counter = 0
    for idx, up, ug in unit_geoms:
        arm = buildings_by_unit.get(idx, [])
        if not arm:
            continue
        pts = np.array([xy(c.x, c.y) for _, c in arm])
        if len(pts) < 3:
            continue
        labels = DBSCAN(eps=90, min_samples=3, n_jobs=1).fit_predict(pts)
        clusters = defaultdict(list)
        for (f, c), label in zip(arm, labels):
            if label >= 0:
                clusters[label].append((f, c))
        for label, members in clusters.items():
            if len(members) < 3:
                continue
            geoms = []
            type_count = defaultdict(int)
            type_fp = defaultdict(float)
            type_floor = defaultdict(float)
            for f, c in members:
                p = Polygon(f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1:]).buffer(0)
                geoms.append(p)
                kind = f["properties"]["building_type"]
                type_count[kind] += 1
                type_fp[kind] += p.area * MX * MY
                type_floor[kind] += p.area * MX * MY * f["properties"]["floors_est"]
            built = unary_union(geoms).buffer(35 / 111_000).intersection(ug)
            if built.is_empty:
                continue
            total_fp = sum(type_fp.values()) / 1_000_000
            res_count = type_count["residential"]
            ind_count = type_count["industrial"]
            res_share = res_count / len(members)
            ind_share = ind_count / len(members)
            res_fp = type_fp["residential"] / 1_000_000
            floor_km2 = sum(type_floor.values()) / 1_000_000
            lu = built.intersection(res_landuse)
            lu_share = area_km2(lu) / max(area_km2(built), 1e-9)

            center = built.representative_point()
            # nearest named place (village/quarter/town) within ~1.2km
            nearby = None
            nearby_d = 1e9
            for pf in places:
                pp = Point(pf["geometry"]["coordinates"])
                d = center.distance(pp)
                if d < nearby_d:
                    nearby_d = d
                    nearby = pf["properties"]
            near_village = nearby_d <= 0.012  # ~1.2 km in degrees
            name = nearby["name"] if near_village and nearby and nearby["name"] else up["name"]

            score = (
                40 * res_share
                + 20 * lu_share
                + 15 * min(1.0, res_count / 15)
                + 10 * (1.0 if near_village else 0.0)
                + 10 * min(1.0, floor_km2 / 0.08)
                - 35 * ind_share
            )
            score = max(0.0, min(100.0, score))

            if ind_share >= 0.5 and res_share < 0.1:
                grade = "D"
                suitable = False
            elif res_count >= 3 and (res_share >= 0.3 or lu_share >= 0.2) and ind_share < 0.3:
                grade = "A"
                suitable = True
            elif res_count >= 1 or lu_share >= 0.15 or (near_village and len(members) >= 5):
                grade = "B"
                suitable = True
            else:
                grade = "C"
                suitable = False

            site_counter += 1
            props = {
                "site_id": f"S{site_counter:03d}",
                "name": name,
                "unit_name": up["name"],
                "grade": grade,
                "suitable": suitable,
                "score": round(score, 1),
                "building_count": len(members),
                "footprint_km2": round(total_fp, 6),
                "floor_area_km2": round(floor_km2, 6),
                "residential_buildings": res_count,
                "residential_share": round(res_share, 3),
                "industrial_buildings": ind_count,
                "industrial_share": round(ind_share, 3),
                "residential_landuse_share": round(lu_share, 3),
                "built_area_km2": round(area_km2(built), 6),
                "center_lon": round(center.x, 7),
                "center_lat": round(center.y, 7),
                "nearby_place": nearby["name"] if near_village and nearby else "",
                "nearby_distance_m": round(nearby_d * 111_000, 0) if near_village else "",
            }
            site_features.append({
                "type": "Feature",
                "properties": props,
                "geometry": mapping(built),
            })
            site_rows.append(props)

    # Keep full place list, attach unit and nearest site.
    site_geoms = [(f["properties"], shape(f["geometry"])) for f in site_features]
    village_rows = []
    # Grade-able villages: all place points, even if no building cluster nearby.
    unit_grade = {}
    for sp, _ in site_geoms:
        ug = next((u for u in units if u["properties"]["name"] == sp["unit_name"]), None)
        if ug is None:
            continue
        key = sp["unit_name"]
        old = unit_grade.get(key)
        rank = {"A": 4, "B": 3, "C": 2, "D": 1}
        if old is None or rank.get(sp["grade"], 0) > rank.get(old, 0):
            unit_grade[key] = sp["grade"]

    for pf in places:
        p = pf["properties"]
        lon, lat = pf["geometry"]["coordinates"]
        pt = Point(lon, lat)
        unit = None
        for _, up, ug in unit_geoms:
            if ug.covers(pt):
                unit = up
                break
        best = None
        best_d = 1e9
        for sp, sg in site_geoms:
            d = sg.distance(pt)
            if d < best_d:
                best_d = d
                best = sp
        p["in_bounds"] = WEST <= lon <= EAST and SOUTH <= lat <= NORTH
        p["unit_name"] = unit["name"] if unit else ""
        p["unit_area_km2"] = unit["area_km2"] if unit else ""
        p["nearest_site_id"] = best["site_id"] if best and best_d <= 0.015 else ""
        p["nearest_site_name"] = best["name"] if best and best_d <= 0.015 else ""
        p["nearest_site_grade"] = best["grade"] if best and best_d <= 0.015 else ""
        p["nearest_site_m"] = round(best_d * 111_000, 0) if best and best_d <= 0.015 else ""
        p["candidate_grade"] = p["nearest_site_grade"] or unit_grade.get(p["unit_name"], "C")
        village_rows.append({
            "name": p["name"],
            "place": p["place"],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "in_bounds": p["in_bounds"],
            "unit_name": p["unit_name"],
            "unit_area_km2": p["unit_area_km2"],
            "nearest_site_id": p["nearest_site_id"],
            "nearest_site_name": p["nearest_site_name"],
            "nearest_site_grade": p["nearest_site_grade"],
            "nearest_site_m": p["nearest_site_m"],
            "candidate_grade": p["candidate_grade"],
        })

    (AN / "residential-sites.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-residential-sites", "features": site_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    (AN / "residential-villages.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-residential-villages", "features": places}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "residential-sites.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(site_rows[0].keys()) if site_rows else [])
        w.writeheader()
        w.writerows(sorted(site_rows, key=lambda r: (-r["suitable"], -r["score"])))
    with (AN / "residential-villages.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(village_rows[0].keys()) if village_rows else [])
        w.writeheader()
        w.writerows(village_rows)

    grades = {g: [r for r in site_rows if r["grade"] == g] for g in "ABCD"}
    summary = {
        "source": "OSM raw buildings + residential-units + places, © OpenStreetMap contributors (ODbL)",
        "sites": len(site_rows),
        "suitableSites": sum(1 for r in site_rows if r["suitable"]),
        "byGrade": {
            g: {
                "count": len(grades[g]),
                "builtAreaKm2": round(sum(r["built_area_km2"] for r in grades[g]), 3),
                "residentialBuildings": sum(r["residential_buildings"] for r in grades[g]),
                "floorAreaKm2": round(sum(r["floor_area_km2"] for r in grades[g]), 3),
            }
            for g in "ABCD"
        },
        "villages": len(village_rows),
        "villagesWithUnit": sum(1 for r in village_rows if r["unit_name"]),
        "villagesWithSite": sum(1 for r in village_rows if r["nearest_site_id"]),
        "note": "A/B are evidence-based candidates; C is a village-only candidate; D is industrial/not recommended. Built area is footprint union + 35m buffer, not a legal boundary.",
        "files": [
            "residential-sites.geojson",
            "residential-sites.csv",
            "residential-villages.geojson",
            "residential-villages.csv",
        ],
    }
    (AN / "residential-sites-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    render_preview(site_features, places)


def project(lon, lat):
    x = (lon - WEST) / (EAST - WEST) * 2560
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * 1440
    return x, y


def draw_poly(draw, geom, fill, outline, width=1):
    geoms = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    for g in geoms:
        if g.geom_type != "Polygon":
            continue
        pts = [project(x, y) for x, y in g.exterior.coords]
        draw.polygon(pts, fill=fill)
        draw.line(pts, fill=outline, width=width)


def render_preview(sites, places):
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    colors = {
        "A": ((180, 98, 63, 150), (150, 70, 40, 190)),
        "B": ((194, 161, 94, 115), (160, 125, 55, 170)),
        "C": ((130, 130, 115, 70), (110, 110, 95, 140)),
        "D": ((92, 78, 64, 130), (70, 58, 45, 180)),
    }
    for f in sites:
        g = shape(f["geometry"])
        fill, outline = colors[f["properties"]["grade"]]
        draw_poly(draw, g, fill, outline)
    for pf in places:
        lon, lat = pf["geometry"]["coordinates"]
        x, y = project(lon, lat)
        if 0 <= x < 2560 and 0 <= y < 1440:
            draw.ellipse((x - 2.5, y - 2.5, x + 2.5, y + 2.5), fill=(70, 74, 62, 150))

    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((34, 32, 900, 145), fill=(248, 244, 234, 232))
    d.text((54, 48), "住宅候选地", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "A 明确住宅 · B 高可能 · C 村落候选 · D 工业/不宜", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    d.text((56, 112), f"{len(sites)} 个聚落 · 740 个村/地名点 · 35m 建成区缓冲", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))
    d.rectangle((34, 1268, 390, 1360), fill=(248, 244, 234, 225))
    legend = [("A", "A 明确住宅"), ("B", "B 高可能"), ("C", "C 村落候选"), ("D", "D 工业/不宜")]
    for i, (g, label) in enumerate(legend):
        yy = 1288 + i * 16
        fill, outline = colors[g]
        d.rectangle((50, yy - 5, 78, yy + 5), fill=fill, outline=outline)
        d.text((88, yy - 7), label, font=ImageFont.truetype(SANS, 10), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 面积为建成区缓冲，不是法定边界", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(AN / "residential-sites.png", optimize=True)
    print("wrote", AN / "residential-sites.png")


if __name__ == "__main__":
    main()
