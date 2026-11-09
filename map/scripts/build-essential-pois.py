"""Rank essential POIs by how many A/B residential sites they actually serve.

Categories mirror the game's POI taxonomy:
hospital / school / daily (mall/supermarket/market) / park / transit / scenic / stadium

Outputs:
  analysis/essential-pois.geojson
  analysis/essential-pois.csv
  analysis/poi-gaps.csv
  analysis/poi-summary.json
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"
MX = 111_320.0 * math.cos(math.radians(23.13))
MY = 110_540.0

SERVICE_KM = {
    "hospital": 4.0,
    "school": 1.5,
    "daily": 1.5,
    "park": 2.0,
    "transit": 3.0,
    "scenic": 3.0,
    "stadium": 3.0,
}
CATEGORY_LABEL = {
    "hospital": "医疗",
    "school": "学校",
    "daily": "日常商业",
    "park": "公园",
    "transit": "铁路/渡口/客运站",
    "scenic": "景点/文化",
    "stadium": "体育",
}
CATEGORY_ORDER = ["transit", "hospital", "school", "daily", "park", "scenic", "stadium"]


def xy(lon, lat):
    return ((lon - 112.57) * MX, (lat - 23.13) * MY)


def category(p):
    cls, sub = p.get("class"), p.get("subclass")
    if cls in {"hospital", "clinic", "doctors", "dentist"}:
        return "hospital"
    if cls in {"school", "college", "university", "kindergarten"}:
        return "school"
    if cls in {"mall", "supermarket", "marketplace", "grocery"} or sub in {"mall", "supermarket", "marketplace", "department_store"}:
        return "daily"
    if cls in {"park", "garden"}:
        return "park"
    if cls in {"railway", "ferry_terminal"} or (cls == "bus" and sub == "bus_station"):
        return "transit"
    if cls in {"attraction", "viewpoint", "museum"}:
        return "scenic"
    if cls in {"stadium", "sports_centre"}:
        return "stadium"
    return None


def main():
    pois = json.loads((AN / "raw" / "pois.json").read_text(encoding="utf-8"))["features"]
    sites = json.loads((AN / "residential-sites.geojson").read_text(encoding="utf-8"))["features"]
    selected_sites = [s for s in sites if s["properties"].get("suitable")]
    site_xy = []
    for s in selected_sites:
        p = s["properties"]
        site_xy.append((xy(p["center_lon"], p["center_lat"]), p))

    essential = []
    nearest_by_site = [dict() for _ in selected_sites]
    by_cat = defaultdict(list)
    for f in pois:
        p = f["properties"]
        cat = category(p)
        if not cat:
            continue
        lon, lat = f["geometry"]["coordinates"]
        px, py = xy(lon, lat)
        distances = []
        for i, ((sx, sy), sp) in enumerate(site_xy):
            d = math.hypot(px - sx, py - sy) / 1000
            distances.append(d)
            if cat not in nearest_by_site[i] or d < nearest_by_site[i][cat][0]:
                nearest_by_site[i][cat] = (d, p["name"])
        by_cat[cat].append((f, distances))

    for cat in CATEGORY_ORDER:
        threshold = SERVICE_KM[cat]
        for f, distances in by_cat[cat]:
            served = [(d, selected_sites[i]["properties"]) for i, d in enumerate(distances) if d <= threshold]
            if not served:
                continue
            served_a = sum(1 for _, sp in served if sp["grade"] == "A")
            served_b = sum(1 for _, sp in served if sp["grade"] == "B")
            area = sum(sp["built_area_km2"] for _, sp in served)
            p = f["properties"]
            essential.append({
                "type": "Feature",
                "properties": {
                    "name": p["name"],
                    "category": cat,
                    "category_label": CATEGORY_LABEL[cat],
                    "class": p["class"],
                    "subclass": p["subclass"],
                    "served_sites": len(served),
                    "served_A": served_a,
                    "served_B": served_b,
                    "served_area_km2": round(area, 3),
                    "score": round(served_a * 2 + served_b + area * 10, 1),
                },
                "geometry": f["geometry"],
            })

    essential.sort(key=lambda f: (CATEGORY_ORDER.index(f["properties"]["category"]), -f["properties"]["score"]))
    (AN / "essential-pois.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-essential-pois", "features": essential}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (AN / "essential-pois.csv").open("w", encoding="utf-8-sig", newline="") as f:
        rows = [x["properties"] | {"lon": x["geometry"]["coordinates"][0], "lat": x["geometry"]["coordinates"][1]} for x in essential]
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        w.writeheader()
        w.writerows(rows)

    gap_rows = []
    for i, (_, sp) in enumerate(site_xy):
        row = {
            "site_id": sp["site_id"],
            "name": sp["name"],
            "grade": sp["grade"],
            "built_area_km2": sp["built_area_km2"],
        }
        missing = []
        for cat in CATEGORY_ORDER:
            threshold = SERVICE_KM[cat]
            d, _name = nearest_by_site[i].get(cat, (999, ""))
            row[f"nearest_{cat}_km"] = round(d, 2)
            if d > threshold:
                missing.append(cat)
        row["missing"] = ",".join(missing)
        row["missing_count"] = len(missing)
        gap_rows.append(row)

    gap_rows.sort(key=lambda r: (-r["missing_count"], -float(r["built_area_km2"])))
    with (AN / "poi-gaps.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(gap_rows[0].keys()) if gap_rows else [])
        w.writeheader()
        w.writerows(gap_rows)

    summary = {"sites": len(selected_sites), "categories": {}}
    for cat in CATEGORY_ORDER:
        rows = [x["properties"] for x in essential if x["properties"]["category"] == cat]
        covered = sum(1 for i in range(len(selected_sites)) if nearest_by_site[i].get(cat, (999,))[0] <= SERVICE_KM[cat])
        summary["categories"][cat] = {
            "label": CATEGORY_LABEL[cat],
            "pois": len(rows),
            "coveredSites": covered,
            "gapSites": len(selected_sites) - covered,
            "coveragePct": round(covered / len(selected_sites) * 100, 1),
            "serviceKm": SERVICE_KM[cat],
            "top": [
                {"name": r["name"], "served_sites": r["served_sites"], "score": r["score"]}
                for r in rows[:5]
            ],
        }
    summary["mostNeeded"] = sorted(
        (
            {"category": cat, "gapSites": v["gapSites"], "coveragePct": v["coveragePct"]}
            for cat, v in summary["categories"].items()
        ),
        key=lambda x: (-x["gapSites"], x["coveragePct"]),
    )
    (AN / "poi-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
