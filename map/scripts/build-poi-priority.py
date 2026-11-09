"""Curate the small set of POIs that matter most for residential coverage."""
from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AN = ROOT / "analysis"


def main() -> None:
    rows = list(csv.DictReader((AN / "essential-pois.csv").open(encoding="utf-8-sig")))
    out = []
    seen = set()

    def add(tier, cat, row, reason):
        key = (row["name"], cat)
        if key in seen:
            return
        seen.add(key)
        out.append({
            "tier": tier,
            "category": cat,
            "name": row["name"],
            "subclass": row["subclass"],
            "served_sites": row["served_sites"],
            "served_A": row["served_A"],
            "served_B": row["served_B"],
            "served_area_km2": row["served_area_km2"],
            "score": row["score"],
            "lon": row["lon"],
            "lat": row["lat"],
            "reason": reason,
        })

    def top(cat, subclasses, n):
        pool = [r for r in rows if r["category"] == cat and r["subclass"] in subclasses]
        pool.sort(key=lambda r: (-float(r["score"]), -int(r["served_sites"])))
        return pool[:n]

    for r in top("hospital", {"hospital"}, 5):
        add("P0", "hospital", r, "城市级/片区级医院，覆盖最多 A/B 住宅聚落")
    for r in top("school", {"school"}, 5):
        add("P0", "school", r, "小学/中学，日常通学必需")
    for r in top("daily", {"marketplace", "supermarket", "mall"}, 5):
        add("P0", "daily", r, "菜市场/超市/商场，日常消费必需")
    for r in top("transit", {"station", "bus_station"}, 5):
        add("P0", "transit", r, "铁路站或客运站，外部通勤/接驳必需")
    for r in top("park", {"park", "garden"}, 3):
        add("P1", "park", r, "社区/城市公园，生活质量配套")
    for r in top("hospital", {"clinic", "doctors"}, 3):
        add("P1", "clinic", r, "基层诊所/卫生服务，补医院覆盖")
    for r in top("transit", {"ferry_terminal"}, 2):
        add("P1", "ferry", r, "渡口，跨江/水上游线补充")
    for r in top("scenic", {"attraction", "viewpoint", "museum"}, 3):
        add("P2", "scenic", r, "景点/文化，非日常必需，提升吸引力")
    for r in top("stadium", {"stadium", "sports_centre"}, 2):
        add("P2", "stadium", r, "体育设施，非日常必需")

    with (AN / "poi-priority.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"wrote {len(out)} priority POIs")


if __name__ == "__main__":
    main()
