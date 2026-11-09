"""Extract named landuse=residential polygons as residential communities (小区)."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
LAT0 = 23.13
MX = 111_320.0 * math.cos(math.radians(LAT0))
MY = 110_540.0


def main() -> None:
    lu = json.loads((AN / "residential-landuse.geojson").read_text(encoding="utf-8"))
    units = json.loads((AN / "residential-units.geojson").read_text(encoding="utf-8"))
    sites = json.loads((AN / "residential-sites.geojson").read_text(encoding="utf-8"))
    buildings = json.loads((AN / "buildings-osm.geojson").read_text(encoding="utf-8"))

    unit_geoms = [(u["properties"], shape(u["geometry"]).buffer(0)) for u in units["features"]]
    site_geoms = [(s["properties"], shape(s["geometry"])) for s in sites["features"]]
    bpoints = []
    bprops = []
    for b in buildings["features"]:
        coords = b["geometry"]["coordinates"]
        bpoints.append(Point(coords[0][0][0], coords[0][0][1]))
        bprops.append(b["properties"])
    tree = STRtree(bpoints)

    features = []
    rows = []
    for f in lu["features"]:
        p = f["properties"]
        if not p.get("name"):
            continue
        geom = shape(f["geometry"]).buffer(0)
        if geom.is_empty:
            continue
        c = geom.representative_point()
        unit_name = ""
        for up, ug in unit_geoms:
            if ug.covers(c):
                unit_name = up["name"]
                break
        nearest = None
        nd = 1e9
        for sp, sg in site_geoms:
            d = sg.distance(c)
            if d < nd:
                nd = d
                nearest = sp
        idxs = tree.query(geom)
        count = len(idxs)
        res_count = sum(1 for i in idxs if bprops[int(i)]["building_type"] == "residential")
        floor = sum(float(bprops[int(i)]["floor_area_m2"]) for i in idxs) / 1_000_000

        props = {
            "name": p["name"],
            "community_type": "小区 / 住宅用地",
            "area_km2": round(float(p["area_km2"]), 6),
            "area_ha": round(float(p["area_ha"]), 3),
            "center_lon": round(c.x, 7),
            "center_lat": round(c.y, 7),
            "unit_name": unit_name,
            "nearest_site_id": nearest["site_id"] if nearest and nd <= 0.015 else "",
            "nearest_site_grade": nearest["grade"] if nearest and nd <= 0.015 else "",
            "nearest_site_m": round(nd * 111_000, 0) if nearest and nd <= 0.015 else "",
            "building_count": count,
            "residential_building_count": res_count,
            "floor_area_km2": round(floor, 6),
        }
        features.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})
        rows.append(props)

    features.sort(key=lambda f: -f["properties"]["area_km2"])
    rows.sort(key=lambda p: -p["area_km2"])
    (AN / "residential-communities.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-residential-communities", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "residential-communities.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        w.writeheader()
        w.writerows(rows)

    summary = {
        "source": "OSM landuse=residential polygons with name, © OpenStreetMap contributors (ODbL)",
        "count": len(rows),
        "areaKm2": round(sum(r["area_km2"] for r in rows), 3),
        "namedShareOfResidentialLandusePct": round(
            sum(r["area_km2"] for r in rows) / sum(float(f["properties"]["area_km2"]) for f in lu["features"]) * 100,
            2,
        ),
        "top10": [(r["name"], r["area_km2"]) for r in rows[:10]],
        "note": "landuse=residential names often correspond to housing estates/楼盘, but a polygon can cover more than one compound; not a legal boundary.",
        "files": ["residential-communities.geojson", "residential-communities.csv"],
    }
    (AN / "residential-communities-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
