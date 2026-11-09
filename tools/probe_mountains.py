"""Probe: natural mountain silhouettes from the DEM via OpenCV contours."""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageDraw

from map_common import HEIGHT, PAPER, SOURCE, WIDTH, gaussian_blur

DEM = np.load(SOURCE / "dem_crop.npy")


def chaikin(points: list[tuple[float, float]], iterations: int = 2) -> list[tuple[float, float]]:
    pts = points
    for _ in range(iterations):
        out = []
        n = len(pts)
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % n]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        pts = out
    return pts


def contours_for(threshold: float, sigma: float = 7.0, min_area: float = 3000.0):
    small = np.asarray(Image.fromarray(DEM, "F").resize((1280, 720), Image.Resampling.BILINEAR), dtype=np.float32)
    small = gaussian_blur(small, sigma)
    mask = (small > threshold).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    rows = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < min_area:
            continue
        c = cv2.approxPolyDP(c, 2.0, True)
        pts = [(float(p[0][0]) / 1280 * WIDTH, float(p[0][1]) / 720 * HEIGHT) for p in c]
        rows.append((a, chaikin(pts, 2)))
    rows.sort(key=lambda r: r[0], reverse=True)
    return rows


def main() -> None:
    im = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    d = ImageDraw.Draw(im, "RGBA")
    rows = contours_for(92)
    print("kept", len(rows), [round(r[0]) for r in rows])
    for area, c in rows[:6]:
        d.polygon(c, fill=(207, 218, 189, 255))
    high = contours_for(480, sigma=6, min_area=300)
    print("high", len(high), [round(r[0]) for r in high])
    for area, c in high[:4]:
        d.polygon(c, fill=(185, 202, 169, 110))
    im.resize((1280, 720), Image.Resampling.LANCZOS).save(SOURCE / "probe_mountains.png")
    print("saved")


if __name__ == "__main__":
    main()
