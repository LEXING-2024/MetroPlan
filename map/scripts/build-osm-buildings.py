"""Build precise OSM buildings (raw ways) with use tags and area stats.

This is the higher-quality companion to the z14 tile extraction:
- raw OSM way geometry (no tile clipping/duplication)
- building=* use tags
- building:levels / height when available

Outputs:
  analysis/buildings-osm.geojson
  analysis/building-osm-stats.csv
  analysis/residential-units-enriched-osm.geojson
  analysis/building-osm-summary.json
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from shapely.geometry import Point, Polygon, shape

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
LAT0 = 23.13
MX = 111_320.0 * math.cos(math.radians(LAT0))
MY = 110_540.0
RASTER_ONLY = {"roof", "no", "construction", "bridge"}

RESIDENTIAL = {
    "residential",
    "apartments",
    "house",
    "dormitory",
    "semidetached_house",
    "terrace",
    "bungalow",
    "villa",
}
INDUSTRIAL = {"industrial", "warehouse", "factory", "hangar", "manufacture", "barn"}
COMMERCIAL = {"commercial", "retail", "office", "hotel", "supermarket", "shop"}
CIVIC = {
    "school",
    "university",
    "college",
    "hospital",
    "kindergarten",
    "civic",
    "government",
    "public",
    "museum",
    "library",
    "train_station",
}
UNKNOWN = {"yes"}


def area_m2(geom) -> float:
    return abs(geom.area) * MX * MY


def classify(tags: dict) -> str:
    b = (tags.get("building") or "").lower()
    if b in RESIDENTIAL:
        return "residential"
    if b in INDUSTRIAL:
        return "industrial"
    if b in COMMERCIAL:
        return "commercial"
    if b in CIVIC:
        return "civic"
    if b in UNKNOWN:
        return "unknown"
    return "other"


def floors(tags: dict) -> tuple[int, str]:
    levels = tags.get("building:levels")
    if levels:
        try:
            n = int(float(str(levels).split(";")[0]))
            if 1 <= n <= 80:
                return n, "levels"
        except ValueError:
            pass
    height = tags.get("height")
    if height:
        try:
            h = float(str(height).lower().replace("m", "").strip())
            if h > 0:
                return max(1, round(h / 3)), "height"
        except ValueError:
            pass
    return 2, "default"


def main() -> None:
    raw = json.loads((AN / "raw" / "buildings-osm.json").read_text(encoding="utf-8"))
    units = json.loads((AN / "residential-units.geojson").read_text(encoding="utf-8"))
    unit_geoms = [
        (i, f["properties"], shape(f["geometry"]).buffer(0))
        for i, f in enumerate(units["features"])
    ]
    stats = [
        {
            "residential_count": 0,
            "residential_footprint_km2": 0.0,
            "residential_floor_area_km2": 0.0,
            "industrial_footprint_km2": 0.0,
            "total_footprint_km2": 0.0,
        }
        for _ in unit_geoms
    ]

    buildings = []
    counts = {"residential": 0, "industrial": 0, "commercial": 0, "civic": 0, "unknown": 0, "other": 0}
    footprints = {k: 0.0 for k in counts}
    floor_areas = {k: 0.0 for k in counts}
    skipped = 0
    for e in raw.get("elements", []):
        if e.get("type") != "way":
            continue
        tags = e.get("tags") or {}
        b = (tags.get("building") or "").lower()
        if b in RASTER_ONLY:
            skipped += 1
            continue
        pts = [(p["lon"], p["lat"]) for p in (e.get("geometry") or []) if p]
        if len(pts) < 4:
            skipped += 1
            continue
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        poly = Polygon(pts).buffer(0)
        if poly.is_empty or poly.area <= 0:
            skipped += 1
            continue
        c = poly.centroid
        kind = classify(tags)
        floors_n, floors_src = floors(tags)
        a = area_m2(poly)
        fa = a * floors_n
        counts[kind] += 1
        footprints[kind] += a
        floor_areas[kind] += fa
        props = {
            "osm_id": e.get("id"),
            "building": b,
            "building_type": kind,
            "name": tags.get("name:zh") or tags.get("name") or "",
            "levels": floors_n if floors_src == "levels" else "",
            "height_m": tags.get("height") or "",
            "floors_est": floors_n,
            "floor_source": floors_src,
            "footprint_m2": round(a, 2),
            "floor_area_m2": round(fa, 2),
        }
        buildings.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [pts]}})

        for idx, _, ug in unit_geoms:
            if ug.covers(c):
                s = stats[idx]
                if kind == "residential":
                    s["residential_count"] += 1
                    s["residential_footprint_km2"] += a / 1_000_000
                    s["residential_floor_area_km2"] += fa / 1_000_000
                if kind == "industrial":
                    s["industrial_footprint_km2"] += a / 1_000_000
                s["total_footprint_km2"] += a / 1_000_000
                break

    (AN / "buildings-osm.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-osm-buildings", "features": buildings}, ensure_ascii=False),
        encoding="utf-8",
    )

    rows = []
    for idx, up, _ in unit_geoms:
        s = stats[idx]
        total_fp = s["total_footprint_km2"]
        p = {
            "name": up["name"],
            "unit_type": up["unit_type"],
            "derived": up["derived"],
            "area_km2": up["area_km2"],
            "residential_building_count": s["residential_count"],
            "residential_footprint_km2": round(s["residential_footprint_km2"], 6),
            "residential_floor_area_km2": round(s["residential_floor_area_km2"], 6),
            "residential_share_pct": round(s["residential_footprint_km2"] / total_fp * 100, 2) if total_fp else 0,
            "industrial_footprint_km2": round(s["industrial_footprint_km2"], 6),
            "total_building_footprint_km2": round(s["total_footprint_km2"], 6),
        }
        rows.append(p)
        up.update({
            "residential_building_count": p["residential_building_count"],
            "residential_footprint_km2": p["residential_footprint_km2"],
            "residential_floor_area_km2": p["residential_floor_area_km2"],
            "residential_share_pct": p["residential_share_pct"],
            "industrial_footprint_km2": p["industrial_footprint_km2"],
            "total_building_footprint_km2": p["total_building_footprint_km2"],
        })
    rows.sort(key=lambda r: -r["residential_footprint_km2"])
    with (AN / "building-osm-stats.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    (AN / "residential-units-enriched-osm.geojson").write_text(
        json.dumps(units, ensure_ascii=False),
        encoding="utf-8",
    )

    summary = {
        "source": "OSM Overpass way[building] out geom, raw footprints, © OpenStreetMap contributors (ODbL)",
        "rawWays": len(raw.get("elements", [])),
        "usedBuildings": len(buildings),
        "skipped": skipped,
        "byType": {
            k: {"count": counts[k], "footprint_km2": round(footprints[k] / 1_000_000, 6), "floor_area_km2": round(floor_areas[k] / 1_000_000, 6)}
            for k in counts
        },
        "explicitResidential": {
            "count": counts["residential"],
            "footprint_km2": round(footprints["residential"] / 1_000_000, 6),
            "floor_area_km2": round(floor_areas["residential"] / 1_000_000, 6),
            "shareOfBuildingsPct": round(counts["residential"] / len(buildings) * 100, 2) if buildings else 0,
        },
        "note": "building=yes (3.5k) remains unknown use; only explicit building tags are classified. floor area uses building:levels, then height/3, then 2-floor default.",
        "files": ["buildings-osm.geojson", "building-osm-stats.csv", "residential-units-enriched-osm.geojson"],
    }
    (AN / "building-osm-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
