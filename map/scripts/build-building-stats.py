"""Dedupe exported building footprints and attach density stats to area units."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
LAT0 = 23.13
MX = 111_320.0 * math.cos(math.radians(LAT0))
MY = 110_540.0


def area_m2(geom) -> float:
    minx, miny, maxx, maxy = geom.bounds
    # local equirectangular area (fast, accurate enough for a 51×29 km bbox)
    return abs(geom.area) * MX * MY


def main() -> None:
    raw = json.loads((AN / "raw" / "buildings.json").read_text(encoding="utf-8"))
    units = json.loads((AN / "residential-units.geojson").read_text(encoding="utf-8"))
    res = json.loads((AN / "residential-landuse.geojson").read_text(encoding="utf-8"))
    res_union = unary_union([shape(f["geometry"]).buffer(0) for f in res["features"]])

    unit_geoms = [
        (i, f["properties"], shape(f["geometry"]).buffer(0))
        for i, f in enumerate(units["features"])
    ]
    stats = [
        {
            "building_count": 0,
            "footprint_km2": 0.0,
            "floor_area_km2": 0.0,
            "residential_footprint_km2": 0.0,
            "residential_floor_area_km2": 0.0,
        }
        for _ in unit_geoms
    ]

    seen = set()
    buildings = []
    skipped_dupes = 0
    footprint_total = 0.0
    floor_total = 0.0
    res_footprint = 0.0
    res_floor = 0.0

    for f in raw["features"]:
        coords = f["geometry"]["coordinates"]
        poly = Polygon(coords[0], coords[1:]).buffer(0)
        if poly.is_empty or poly.area <= 0:
            continue
        c = poly.centroid
        a = area_m2(poly)
        key = (round(c.x, 6), round(c.y, 6), round(a, 0))
        if key in seen:
            skipped_dupes += 1
            continue
        seen.add(key)
        height = max(3.0, float(f["properties"].get("height_m") or 5))
        floors = max(1, round(height / 3))
        floor_area = a * floors
        in_res = res_union.covers(c)
        footprint_total += a
        floor_total += floor_area
        if in_res:
            res_footprint += a
            res_floor += floor_area

        props = {
            "footprint_m2": round(a, 2),
            "height_m": round(height, 1),
            "floors_est": floors,
            "floor_area_m2": round(floor_area, 2),
            "in_residential_landuse": bool(in_res),
        }
        buildings.append({
            "type": "Feature",
            "properties": props,
            "geometry": f["geometry"],
        })

        for idx, up, ug in unit_geoms:
            if ug.covers(c):
                s = stats[idx]
                s["building_count"] += 1
                s["footprint_km2"] += a / 1_000_000
                s["floor_area_km2"] += floor_area / 1_000_000
                if in_res:
                    s["residential_footprint_km2"] += a / 1_000_000
                    s["residential_floor_area_km2"] += floor_area / 1_000_000
                break

    (AN / "buildings.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-buildings", "features": buildings}, ensure_ascii=False),
        encoding="utf-8",
    )

    rows = []
    for idx, up, _ in unit_geoms:
        s = stats[idx]
        area = up["area_km2"]
        p = {
            "name": up["name"],
            "unit_type": up["unit_type"],
            "derived": up["derived"],
            "area_km2": round(area, 6),
            "building_count": s["building_count"],
            "building_footprint_km2": round(s["footprint_km2"], 6),
            "building_floor_area_km2": round(s["floor_area_km2"], 6),
            "building_coverage_pct": round(s["footprint_km2"] / area * 100, 3) if area else 0,
            "residential_footprint_km2": round(s["residential_footprint_km2"], 6),
            "residential_floor_area_km2": round(s["residential_floor_area_km2"], 6),
            "residential_building_pct": round(s["residential_footprint_km2"] / s["footprint_km2"] * 100, 2) if s["footprint_km2"] else 0,
        }
        rows.append(p)
        up.update({
            "building_count": p["building_count"],
            "building_footprint_km2": p["building_footprint_km2"],
            "building_floor_area_km2": p["building_floor_area_km2"],
            "building_coverage_pct": p["building_coverage_pct"],
            "residential_footprint_km2": p["residential_footprint_km2"],
            "residential_floor_area_km2": p["residential_floor_area_km2"],
        })

    rows.sort(key=lambda r: -r["building_footprint_km2"])
    with (AN / "building-stats.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    (AN / "residential-units-enriched.geojson").write_text(
        json.dumps(units, ensure_ascii=False),
        encoding="utf-8",
    )

    summary = {
        "rawPolygons": len(raw["features"]),
        "dedupedBuildings": len(buildings),
        "duplicatesRemoved": skipped_dupes,
        "footprintKm2": round(footprint_total / 1_000_000, 6),
        "floorAreaKm2": round(floor_total / 1_000_000, 6),
        "residentialLanduseFootprintKm2": round(res_footprint / 1_000_000, 6),
        "residentialLanduseFloorAreaKm2": round(res_floor / 1_000_000, 6),
        "residentialLanduseSharePct": round(res_footprint / footprint_total * 100, 2) if footprint_total else 0,
        "note": "footprint = building base; floor area = footprint × estimated floors from render_height/3 m. OSM building tags are not use-specific; residential_* only means the centroid falls inside landuse=residential.",
        "files": ["buildings.geojson", "building-stats.csv", "residential-units-enriched.geojson"],
    }
    (AN / "building-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
