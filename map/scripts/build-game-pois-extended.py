"""Extend the curated 88 POIs with OSM local POIs.

Core 88 = high-confidence city destinations/employment.
Extended = additional named OSM schools, hospitals, museums, stations,
ferries, parks and industrial/logistics areas at level 1-3.

Daily is a game-balancing estimate, not measured traffic.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
DAILY = {6: 80000, 5: 30000, 4: 12000, 3: 5000, 2: 1800, 1: 600}
RADIUS = {6: 8, 5: 5, 4: 3, 3: 2, 2: 1.2, 1: 0.6}
HIGH_SCHOOL = re.compile(r"中学|高中|实验学校|外国语|附属学校|职业|技工|中专")


def clean_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "")


def main():
    core = list(csv.DictReader((AN / "game-pois.csv").open(encoding="utf-8-sig")))
    core_names = {clean_name(r["name"]) for r in core}
    core_station_names = {
        clean_name(r["name"]).removesuffix("站")
        for r in core if r["poi_type"] == "station"
    }
    rows = [dict(r) for r in core]
    seen = {(clean_name(r["name"]), r["poi_type"]) for r in core}

    pois = json.loads((AN / "raw" / "pois.json").read_text(encoding="utf-8"))["features"]
    for f in pois:
        p = f["properties"]
        name = clean_name(p["name"])
        if not name or name in core_names:
            continue
        cls, sub = p["class"], p["subclass"]
        lon, lat = f["geometry"]["coordinates"]
        if not (WEST <= lon <= EAST and SOUTH <= lat <= NORTH):
            continue
        if cls in {"school", "college", "university", "kindergarten"}:
            typ = "school"
            level = 3 if cls in {"college", "university"} or HIGH_SCHOOL.search(name) else 2
        elif cls in {"hospital", "clinic", "doctors", "dentist"}:
            typ = "hospital"
            level = 3 if cls == "hospital" else 1
        elif cls in {"park", "garden"}:
            typ = "park"
            level = 2
        elif cls in {"museum", "attraction", "viewpoint"}:
            typ = "scenic"
            level = 2
        elif cls in {"railway"}:
            typ = "station"
            level = 3
        elif cls == "bus" and sub == "bus_station":
            typ = "station"
            level = 2
        elif cls == "ferry_terminal":
            typ = "ferry"
            level = 2
        elif cls in {"stadium", "sports_centre"}:
            typ = "stadium"
            level = 2
        elif cls == "mall" or (cls == "shop" and sub == "mall"):
            typ = "mall"
            level = 2
        else:
            continue
        if typ == "station" and name.removesuffix("站") in core_station_names:
            continue
        if typ == "scenic" and name in {"肇庆市博物馆新馆"}:
            continue
        if name == "宝月儿童公园":
            continue
        key = (name, typ)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "poi_type": typ,
            "category": "local",
            "tier": "C",
            "level": level,
            "radius_km": RADIUS[level],
            "daily": DAILY[level],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "source": "OSM local POI",
            "confidence": "medium",
            "note": p.get("class", "") + "/" + p.get("subclass", ""),
        })

    # Named industrial/logistics areas from OSM, only the ones with real names.
    ind = json.loads((AN / "raw" / "industrial-named.json").read_text(encoding="utf-8"))["elements"]
    keywords = re.compile(r"工业园|产业园|开发区|高新区|物流|科技园|基地|集聚|园区|工业区")
    for e in ind:
        tags = e.get("tags") or {}
        name = clean_name(tags.get("name", ""))
        if not name or name in core_names:
            continue
        c = e.get("center") or {}
        lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None or not (WEST <= lon <= EAST and SOUTH <= lat <= NORTH):
            continue
        if not keywords.search(name):
            continue
        typ = "industry"
        key = (name, typ)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "poi_type": typ,
            "category": "employment_local",
            "tier": "C",
            "level": 2,
            "radius_km": RADIUS[2],
            "daily": DAILY[2],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "source": "OSM industrial landuse",
            "confidence": "medium",
            "note": "named industrial/logistics area",
        })

    # OSM industrial-landuse districts (High-quality spatial evidence, names
    # derived from nearest park/town); complements the curated employment list.
    emp = list(csv.DictReader((AN / "employment-areas-osm.csv").open(encoding="utf-8-sig")))
    for r in emp:
        name = clean_name(r["name"])
        if not name or name in core_names:
            continue
        key = (name, "industry")
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "poi_type": "industry",
            "category": "employment_osm",
            "tier": r["tier"],
            "level": int(r["level"]),
            "radius_km": float(r["radius_km"]),
            "daily": int(r["daily"]),
            "lon": float(r["lon"]),
            "lat": float(r["lat"]),
            "source": "OSM landuse=industrial",
            "confidence": "medium",
            "note": r.get("note", ""),
        })

    rows.sort(key=lambda r: ({"S": 0, "A": 1, "B": 2, "C": 3}[r["tier"]], r["poi_type"], -int(r["daily"])))
    features = []
    for i, r in enumerate(rows, 1):
        r["id"] = f"E{i:04d}" if r["tier"] == "C" else r.get("id", f"P{i:03d}")
        features.append({
            "type": "Feature",
            "properties": r,
            "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
        })

    (AN / "game-pois-extended.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-game-pois-extended", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "game-pois-extended.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    by_type = {}
    for r in rows:
        by_type[r["poi_type"]] = by_type.get(r["poi_type"], 0) + 1
    summary = {
        "total": len(rows),
        "core": len(core),
        "localAdded": len(rows) - len(core),
        "byType": dict(sorted(by_type.items())),
        "byTier": {t: sum(1 for r in rows if r["tier"] == t) for t in "SABC"},
        "note": f"Core {len(core)} is high-confidence curated. C-level points are named OSM local POIs with medium confidence; level 1-2 should be filtered by the game if needed.",
        "files": ["game-pois-extended.geojson", "game-pois-extended.csv"],
    }
    (AN / "game-pois-extended-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
