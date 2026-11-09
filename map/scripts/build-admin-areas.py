"""Build actual administrative areas and residential landuse for the game bbox.

Input (Overpass `out geom`):
  analysis/raw/admin6.json, admin8.json, admin10.json, admin11.json
  analysis/raw/residential.json
  analysis/raw/places.json

Output:
  analysis/admin-areas.geojson
  analysis/residential-landuse.geojson
  analysis/places.geojson
  analysis/admin-areas.csv
  analysis/residential-landuse.csv
  analysis/area-summary.json
  analysis/admin-areas.png
"""
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point, Polygon, box, mapping
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "analysis" / "raw"
OUT = ROOT / "analysis"
WEST, SOUTH, EAST, NORTH = 112.32, 23.00, 112.82, 23.26
LAT0 = (SOUTH + NORTH) / 2
MX = 111_320.0 * math.cos(math.radians(LAT0))
MY = 110_540.0
PROJECT_BOX = box(WEST, SOUTH, EAST, NORTH)
LEVEL_NAME = {6: "区", 8: "镇 / 街道", 10: "村 / 社区", 11: "自然村"}
SERIF = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
SANS = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
INK = (52, 56, 47)


def read(name: str) -> list[dict]:
    return json.loads((RAW / name).read_text(encoding="utf-8")).get("elements", [])


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def assemble_rings(segments: list[list[tuple[float, float]]], tol=2e-6):
    segments = [s for s in segments if len(s) >= 2]
    rings = []
    while segments:
        ring = list(segments.pop(0))
        changed = True
        while changed and not (len(ring) > 3 and dist(ring[0], ring[-1]) < tol):
            changed = False
            for i, seg in enumerate(segments):
                if dist(ring[-1], seg[0]) < tol:
                    ring.extend(seg[1:])
                elif dist(ring[-1], seg[-1]) < tol:
                    ring.extend(list(reversed(seg))[1:])
                else:
                    continue
                segments.pop(i)
                changed = True
                break
        if len(ring) >= 3:
            if dist(ring[0], ring[-1]) >= tol:
                ring.append(ring[0])
            rings.append(ring)
    return rings


def relation_geometry(e: dict):
    outers: list[list[tuple[float, float]]] = []
    inners: list[list[tuple[float, float]]] = []
    for role, dest in (("outer", outers), ("inner", inners)):
        segs = []
        for m in e.get("members") or []:
            if m.get("role") != role:
                continue
            pts = [(p["lon"], p["lat"]) for p in (m.get("geometry") or []) if p]
            if len(pts) >= 2:
                segs.append(pts)
        dest.extend(assemble_rings(segs))
    if not outers:
        return None
    outer_polys = [Polygon(r).buffer(0) for r in outers if len(r) >= 4]
    inner_polys = [Polygon(r).buffer(0) for r in inners if len(r) >= 4]
    if not outer_polys:
        return None
    geom = unary_union(outer_polys)
    if inner_polys:
        geom = geom.difference(unary_union(inner_polys))
    return geom.buffer(0)


def to_meters(lon: float, lat: float):
    return ((lon - 112.57) * MX, (lat - LAT0) * MY)


def area_km2(geom) -> float:
    return transform(to_meters, geom).area / 1_000_000


def representative(geom) -> tuple[float, float]:
    p = geom.representative_point()
    return p.x, p.y


def name_of(e: dict) -> str:
    t = e.get("tags") or {}
    return t.get("name:zh") or t.get("name") or t.get("name:en") or ""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    admin_features = []
    admin_rows = []
    for lvl in (6, 8, 10, 11):
        for e in read(f"admin{lvl}.json"):
            if e.get("type") != "relation":
                continue
            geom = relation_geometry(e)
            if geom is None or geom.is_empty:
                continue
            clipped = geom.intersection(PROJECT_BOX)
            if clipped.is_empty:
                continue
            name = name_of(e)
            a = area_km2(clipped)
            full = area_km2(geom)
            cx, cy = representative(clipped)
            props = {
                "osm_id": e.get("id"),
                "name": name,
                "admin_level": lvl,
                "level_label": LEVEL_NAME.get(lvl, ""),
                "area_km2": round(a, 6),
                "area_ha": round(a * 100, 3),
                "area_full_km2": round(full, 6),
                "center_lon": round(cx, 7),
                "center_lat": round(cy, 7),
            }
            admin_features.append({
                "type": "Feature",
                "properties": props,
                "geometry": mapping(clipped),
            })
            admin_rows.append(props)

    admin_features.sort(key=lambda f: (f["properties"]["admin_level"], -f["properties"]["area_km2"]))
    admin_rows.sort(key=lambda p: (p["admin_level"], -p["area_km2"]))
    (OUT / "admin-areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-admin-areas", "features": admin_features}, ensure_ascii=False),
        encoding="utf-8",
    )

    with (OUT / "admin-areas.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(admin_rows[0].keys()) if admin_rows else [])
        w.writeheader()
        w.writerows(admin_rows)

    res_features = []
    res_rows = []
    for e in read("residential.json"):
        if e.get("type") != "way":
            continue
        pts = [(p["lon"], p["lat"]) for p in (e.get("geometry") or []) if p]
        if len(pts) < 4:
            continue
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        poly = Polygon(pts).buffer(0)
        if poly.is_empty:
            continue
        clipped = poly.intersection(PROJECT_BOX)
        if clipped.is_empty:
            continue
        a = area_km2(clipped)
        cx, cy = representative(clipped)
        name = name_of(e)
        props = {
            "osm_id": e.get("id"),
            "name": name,
            "area_km2": round(a, 6),
            "area_ha": round(a * 100, 3),
            "center_lon": round(cx, 7),
            "center_lat": round(cy, 7),
        }
        res_features.append({"type": "Feature", "properties": props, "geometry": mapping(clipped)})
        res_rows.append(props)
    res_features.sort(key=lambda f: -f["properties"]["area_km2"])
    res_rows.sort(key=lambda p: -p["area_km2"])
    (OUT / "residential-landuse.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-residential-landuse", "features": res_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (OUT / "residential-landuse.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(res_rows[0].keys()) if res_rows else [])
        w.writeheader()
        w.writerows(res_rows)

    place_features = []
    for e in read("places.json"):
        if e.get("type") != "node" or e.get("lon") is None:
            continue
        t = e.get("tags") or {}
        place_features.append({
            "type": "Feature",
            "properties": {
                "osm_id": e.get("id"),
                "name": t.get("name:zh") or t.get("name") or "",
                "place": t.get("place"),
            },
            "geometry": {"type": "Point", "coordinates": [e["lon"], e["lat"]]},
        })
    (OUT / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-places", "features": place_features}, ensure_ascii=False),
        encoding="utf-8",
    )

    # A single, non-overlapping residential-unit layer:
    # actual level-10 village/community polygons where mapped, and the remaining
    # part of each level-8 town/street polygon elsewhere. The remainder is
    # explicitly marked as derived, because OSM has no village polygon there.
    from shapely.geometry import shape

    level10_union = unary_union([
        shape(f["geometry"]) for f in admin_features if f["properties"]["admin_level"] == 10
    ])
    res_union = unary_union([shape(f["geometry"]) for f in res_features])
    place_points = [
        (f["properties"]["name"], Point(f["geometry"]["coordinates"]))
        for f in place_features
    ]
    units = []
    for f in admin_features:
        p = f["properties"]
        lvl = p["admin_level"]
        if lvl == 10:
            geom = shape(f["geometry"])
            unit_type = "村 / 社区"
            source = "admin10"
            derived = False
        elif lvl == 8:
            geom = shape(f["geometry"]).difference(level10_union).buffer(0)
            unit_type = "镇 / 街道余部"
            source = "admin8-remainder"
            derived = True
        else:
            continue
        if geom.is_empty:
            continue
        a = area_km2(geom)
        if a < 0.0001:
            continue
        r = geom.intersection(res_union)
        rkm = area_km2(r) if not r.is_empty else 0.0
        cx, cy = representative(geom)
        count = sum(1 for _, pt in place_points if geom.contains(pt))
        props = {
            "name": p["name"] if lvl == 10 else f"{p['name']} · 余部",
            "unit_type": unit_type,
            "parent_name": p["name"],
            "admin_level": lvl,
            "source": source,
            "derived": derived,
            "area_km2": round(a, 6),
            "area_ha": round(a * 100, 3),
            "residential_landuse_km2": round(rkm, 6),
            "residential_pct": round(rkm / a * 100, 2) if a else 0,
            "place_points": count,
            "center_lon": round(cx, 7),
            "center_lat": round(cy, 7),
        }
        units.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
    units.sort(key=lambda feat: (feat["properties"]["derived"], -feat["properties"]["area_km2"]))
    (OUT / "residential-units.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-residential-units", "features": units}, ensure_ascii=False),
        encoding="utf-8",
    )
    unit_rows = [f["properties"] for f in units]
    with (OUT / "residential-units.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(unit_rows[0].keys()) if unit_rows else [])
        w.writeheader()
        w.writerows(unit_rows)

    # Attach each village/quarter point to the actual/derived area unit that
    # contains it. Points outside the game bbox stay unassigned.
    unit_geoms = [(u["properties"], shape(u["geometry"])) for u in units]
    place_rows = []
    for f in place_features:
        lon, lat = f["geometry"]["coordinates"]
        pt = Point(lon, lat)
        unit = None
        for props, geom in unit_geoms:
            if geom.covers(pt):
                unit = props
                break
        p = f["properties"]
        p["in_bounds"] = WEST <= lon <= EAST and SOUTH <= lat <= NORTH
        p["unit_name"] = unit["name"] if unit else ""
        p["unit_type"] = unit["unit_type"] if unit else ""
        p["unit_area_km2"] = unit["area_km2"] if unit else ""
        p["unit_derived"] = unit["derived"] if unit else ""
        place_rows.append({
            "name": p["name"],
            "place": p["place"],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "in_bounds": p["in_bounds"],
            "unit_name": p["unit_name"],
            "unit_type": p["unit_type"],
            "unit_area_km2": p["unit_area_km2"],
            "unit_derived": p["unit_derived"],
        })
    (OUT / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "metro-plan-places-with-area", "features": place_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (OUT / "places-with-area.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(place_rows[0].keys()) if place_rows else [])
        w.writeheader()
        w.writerows(place_rows)

    by_level = {}
    for lvl in (6, 8, 10, 11):
        rows = [r for r in admin_rows if r["admin_level"] == lvl]
        by_level[str(lvl)] = {
            "label": LEVEL_NAME[lvl],
            "count": len(rows),
            "area_km2": round(sum(r["area_km2"] for r in rows), 6),
            "names": [r["name"] for r in rows[:12]],
        }

    bbox_km2 = (EAST - WEST) * 111_320 * math.cos(math.radians(LAT0)) * (NORTH - SOUTH) * 110_540 / 1_000_000
    summary = {
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "bboxKm2": round(bbox_km2, 3),
        "source": "OSM Overpass out geom, boundary=administrative + landuse=residential, © OpenStreetMap contributors (ODbL)",
        "adminAreas": by_level,
        "level10CoveragePct": round(by_level["10"]["area_km2"] / bbox_km2 * 100, 2),
        "note": "Level 6/8 cover the full bbox; level 10 only includes mapped village/community boundaries; residential landuse only includes mapped polygons. Do not sum nested levels.",
        "residentialLanduse": {
            "count": len(res_rows),
            "area_km2": round(sum(r["area_km2"] for r in res_rows), 6),
            "bboxPct": round(sum(r["area_km2"] for r in res_rows) / bbox_km2 * 100, 2),
        },
        "residentialUnits": {
            "count": len(units),
            "actualVillageUnits": sum(1 for u in units if not u["properties"]["derived"]),
            "derivedStreetRemainders": sum(1 for u in units if u["properties"]["derived"]),
            "area_km2": round(area_km2(unary_union([shape(u["geometry"]) for u in units])), 6),
            "sumUnitAreaKm2": round(sum(u["properties"]["area_km2"] for u in units), 6),
            "residential_landuse_km2": round(sum(u["properties"]["residential_landuse_km2"] for u in units), 6),
        },
        "places": {
            "count": len(place_features),
            "assignedToUnit": sum(1 for f in place_features if f["properties"]["unit_name"]),
            "byClass": dict(Counter(f["properties"]["place"] for f in place_features)),
        },
        "files": [
            "admin-areas.geojson",
            "residential-units.geojson",
            "residential-landuse.geojson",
            "places.geojson",
            "admin-areas.csv",
            "residential-units.csv",
            "residential-landuse.csv",
            "places-with-area.csv",
        ],
    }
    (OUT / "area-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    render_preview(admin_features, res_rows)
    render_units_preview(units, res_features)


def project(lon: float, lat: float) -> tuple[float, float]:
    width, height = 2560, 1440
    x = (lon - WEST) / (EAST - WEST) * width
    y0 = math.asinh(math.tan(math.radians(NORTH)))
    y1 = math.asinh(math.tan(math.radians(SOUTH)))
    y = (y0 - math.asinh(math.tan(math.radians(lat)))) / (y0 - y1) * height
    return x, y


def draw_polygon(draw, geom, fill, outline, width):
    geoms = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    for g in geoms:
        if g.geom_type != "Polygon":
            continue
        outer = [project(x, y) for x, y in g.exterior.coords]
        draw.polygon(outer, fill=fill)
        draw.line(outer, fill=outline, width=width)
        for ring in g.interiors:
            hole = [project(x, y) for x, y in ring.coords]
            draw.polygon(hole, fill=(0, 0, 0, 0))
            draw.line(hole, fill=outline, width=width)


def render_units_preview(units, res_features):
    from shapely.geometry import shape
    base = Image.open(ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png").convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for f in units:
        geom = shape(f["geometry"])
        if f["properties"]["derived"]:
            draw_polygon(draw, geom, (110, 120, 100, 10), (110, 120, 100, 100), 2)
        else:
            draw_polygon(draw, geom, (180, 98, 63, 14), (180, 98, 63, 145), 2)
    for f in res_features:
        draw_polygon(draw, shape(f["geometry"]), (70, 107, 79, 35), (70, 107, 79, 60), 1)

    labels = sorted(units, key=lambda f: -f["properties"]["area_km2"])
    shown = []
    for f in labels:
        p = f["properties"]
        if p["area_km2"] < 0.9:
            continue
        x, y = project(p["center_lon"], p["center_lat"])
        font = ImageFont.truetype(SANS, 12 if p["derived"] else 13)
        name = p["name"]
        box = draw.textbbox((0, 0), name, font=font)
        w, h = box[2] - box[0], box[3] - box[1]
        rect = (x - w / 2 - 4, y - h / 2 - 3, x + w / 2 + 4, y + h / 2 + 3)
        if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
            continue
        shown.append(rect)
        color = (100, 110, 90, 240) if p["derived"] else (130, 70, 46, 240)
        draw.text((x, y), name, font=font, fill=color, anchor="mm", stroke_width=2, stroke_fill=(248, 244, 234, 240))

    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((34, 32, 900, 145), fill=(248, 244, 234, 230))
    d.text((54, 48), "住宅区候选单元", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "118 个实际村/社区边界 · 30 个镇街余部 · 住宅用地面叠加", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    d.text((56, 112), f"{len(units)} 个单元 · 完整覆盖 1471.10 km² · 住宅用地 28.7 km²", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))
    d.rectangle((34, 1270, 370, 1344), fill=(248, 244, 234, 220))
    legend = [((180, 98, 63, 190), "实际村 / 社区"), ((110, 120, 100, 160), "镇街余部（派生）"), ((70, 107, 79, 120), "住宅用地")]
    for i, (color, text) in enumerate(legend):
        yy = 1288 + i * 19
        d.rectangle((50, yy - 5, 80, yy + 5), outline=color, width=2, fill=color)
        d.text((90, yy - 8), text, font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 面积为裁剪到游戏 bbox 后的等距投影面积", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(OUT / "residential-units.png", optimize=True)
    print("wrote", OUT / "residential-units.png")


def render_preview(features, residential_rows):
    base_path = ROOT / "out" / "duanzhou-dinghu-basemap-2560x1440-nolabels.png"
    base = Image.open(base_path).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    colors = {
        6: ((63, 76, 64, 26), (63, 76, 64, 150), 3),
        8: ((74, 107, 79, 20), (74, 107, 79, 160), 2),
        10: ((180, 98, 63, 14), (180, 98, 63, 150), 2),
        11: ((160, 140, 90, 18), (160, 140, 90, 150), 2),
    }
    for feat in features:
        lvl = feat["properties"]["admin_level"]
        fill, outline, width = colors[lvl]
        geom = Polygon()  # placeholder
        from shapely.geometry import shape
        geom = shape(feat["geometry"])
        draw_polygon(draw, geom, fill, outline, width)

    # labels: level 8 first, then the largest level 10/11 areas
    labels = sorted(
        [f for f in features if f["properties"]["admin_level"] in (8, 10, 11)],
        key=lambda f: (f["properties"]["admin_level"] != 8, -f["properties"]["area_km2"]),
    )
    shown = []
    fonts = {
        8: ImageFont.truetype(SERIF, 22),
        10: ImageFont.truetype(SANS, 12),
        11: ImageFont.truetype(SANS, 11),
    }
    for f in labels:
        p = f["properties"]
        if not p["name"]:
            continue
        lvl = p["admin_level"]
        if lvl == 10 and p["area_km2"] < 0.08:
            continue
        x, y = project(p["center_lon"], p["center_lat"])
        font = fonts[lvl]
        box = draw.textbbox((0, 0), p["name"], font=font)
        w, h = box[2] - box[0], box[3] - box[1]
        rect = (x - w / 2 - 4, y - h / 2 - 3, x + w / 2 + 4, y + h / 2 + 3)
        if any(not (rect[2] < a[0] or rect[0] > a[2] or rect[3] < a[1] or rect[1] > a[3]) for a in shown):
            continue
        shown.append(rect)
        color = (63, 76, 64, 255) if lvl == 8 else (130, 70, 46, 235)
        draw.text((x, y), p["name"], font=font, fill=color, anchor="mm", stroke_width=2, stroke_fill=(248, 244, 234, 235))

    composed = Image.alpha_composite(base, overlay)
    d = ImageDraw.Draw(composed)
    d.rectangle((34, 32, 850, 145), fill=(248, 244, 234, 230))
    d.text((54, 48), "实际行政区 / 村界面积", font=ImageFont.truetype(SERIF, 31), fill=INK)
    d.text((56, 87), "OSM boundary=administrative · 裁剪到 112.32–112.82E / 23.00–23.26N", font=ImageFont.truetype(SANS, 12), fill=(110, 115, 98))
    c6 = sum(1 for f in features if f['properties']['admin_level'] == 6)
    c8 = sum(1 for f in features if f['properties']['admin_level'] == 8)
    c10 = sum(1 for f in features if f['properties']['admin_level'] == 10)
    res_km2 = sum(r['area_km2'] for r in residential_rows)
    d.text((56, 112), f"区 {c6} · 镇/街道 {c8} · 村/社区 {c10} · 住宅用地 {res_km2:.1f} km²", font=ImageFont.truetype(SANS, 12), fill=(70, 74, 62))

    d.rectangle((34, 1270, 360, 1344), fill=(248, 244, 234, 220))
    legend = [(74, 107, 79, 190, "镇 / 街道"), (180, 98, 63, 190, "村 / 社区"), (63, 76, 64, 170, "区界")]
    for i, (r, g, b, a, text) in enumerate(legend):
        yy = 1288 + i * 19
        d.rectangle((50, yy - 5, 80, yy + 5), outline=(r, g, b, 220), width=2, fill=(r, g, b, 18))
        d.text((90, yy - 8), text, font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    d.text((36, 1370), "数据 © OpenStreetMap contributors (ODbL) · 面积按本地等距投影计算", font=ImageFont.truetype(SANS, 11), fill=(70, 74, 62))
    composed.convert("RGB").save(OUT / "admin-areas.png", optimize=True)
    print("wrote", OUT / "admin-areas.png")


if __name__ == "__main__":
    main()
