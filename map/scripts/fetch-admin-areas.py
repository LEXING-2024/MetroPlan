"""Fetch raw OSM layers for the area build (split requests avoid Overpass 502)."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "analysis" / "raw"
BBOX = "22.98,112.30,23.28,112.84"
ENDPOINT = "https://overpass-api.de/api/interpreter"


def overpass(query: str) -> bytes:
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=data,
        headers={
            "User-Agent": "MetroPlan-area-research/1.0",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        return resp.read()


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    jobs = {}
    for level in ("6", "8", "10", "11"):
        jobs[f"admin{level}.json"] = (
            f'[out:json][timeout:180];relation["boundary"="administrative"]'
            f'["admin_level"="{level}"]({BBOX});out geom;'
        )
    jobs["residential.json"] = (
        f'[out:json][timeout:180];way["landuse"="residential"]({BBOX});out geom;'
    )
    jobs["places.json"] = (
        f'[out:json][timeout:120];node["place"~"village|hamlet|quarter|suburb|town"]'
        f"({BBOX});out geom;"
    )
    jobs["buildings-osm.json"] = (
        f'[out:json][timeout:240];way["building"]({BBOX});out geom;'
    )

    for name, query in jobs.items():
        target = RAW / name
        body = overpass(query)
        target.write_bytes(body)
        count = len(json.loads(body).get("elements", []))
        print(f"{name}: {len(body) / 1024 / 1024:.2f} MiB, {count} elements")


if __name__ == "__main__":
    main()
