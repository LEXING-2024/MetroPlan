"""Palette and relief tests, rendered as a contact sheet."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from map_common import HEIGHT, SOURCE, WIDTH, elevation_tint, gaussian_blur, hillshade

DEM = np.load(SOURCE / "dem_crop.npy")
HS = hillshade(DEM, azimuth=315, altitude=36)
HS_SOFT = gaussian_blur(HS, 1.2)


def variant_sage(contrast: float = 0.30, sigma: float = 1.8) -> Image.Image:
    hs = gaussian_blur(HS, sigma)
    stops = np.array([-20, 10, 40, 100, 200, 350, 550, 750, 1000], dtype=np.float32)
    colors = np.array(
        [
            [238, 235, 220],
            [234, 233, 215],
            [227, 229, 207],
            [216, 222, 196],
            [202, 212, 183],
            [184, 199, 168],
            [163, 183, 153],
            [140, 165, 140],
            [116, 146, 128],
        ],
        dtype=np.float32,
    )
    tint = np.empty(DEM.shape + (3,), dtype=np.float32)
    for c in range(3):
        tint[..., c] = np.interp(DEM, stops, colors[:, c])
    shade = 1.0 + (hs - 0.5) * contrast
    rgb = tint * shade[..., None]
    # cool the deepest shadows slightly
    shadow = np.clip((0.48 - hs) * 2.0, 0, 1)
    rgb = rgb * (1 - 0.10 * shadow[..., None]) + np.array([118, 132, 116], dtype=np.float32) * 0.10 * shadow[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def variant_cream(contrast: float = 0.24, sigma: float = 2.2) -> Image.Image:
    hs = gaussian_blur(HS, sigma)
    stops = np.array([-20, 10, 40, 100, 200, 350, 550, 750, 1000], dtype=np.float32)
    colors = np.array(
        [
            [241, 237, 225],
            [237, 233, 219],
            [231, 227, 208],
            [222, 220, 198],
            [209, 210, 187],
            [193, 198, 173],
            [174, 184, 159],
            [152, 167, 145],
            [126, 149, 133],
        ],
        dtype=np.float32,
    )
    tint = np.empty(DEM.shape + (3,), dtype=np.float32)
    for c in range(3):
        tint[..., c] = np.interp(DEM, stops, colors[:, c])
    shade = 1.0 + (hs - 0.5) * contrast
    rgb = tint * shade[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def variant_duotone() -> Image.Image:
    hs = gaussian_blur(HS, 2.0)
    stops = np.array([-20, 10, 40, 100, 200, 350, 550, 750, 1000], dtype=np.float32)
    colors = np.array(
        [
            [237, 232, 217],
            [234, 230, 214],
            [228, 225, 204],
            [216, 216, 192],
            [201, 204, 178],
            [183, 191, 162],
            [162, 176, 147],
            [139, 159, 135],
            [114, 141, 126],
        ],
        dtype=np.float32,
    )
    tint = np.empty(DEM.shape + (3,), dtype=np.float32)
    for c in range(3):
        tint[..., c] = np.interp(DEM, stops, colors[:, c])
    # overlay-blend a cool shadow / warm light ramp
    shadow = np.array([86, 101, 86], dtype=np.float32) / 255
    light = np.array([255, 252, 238], dtype=np.float32) / 255
    ramp = shadow + (light - shadow) * hs[..., None]
    th = tint / 255.0
    rgb = np.where(th < 0.5, 2 * th * ramp, 1 - 2 * (1 - th) * (1 - ramp))
    return Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8))


def main() -> None:
    ims = [variant_sage(0.34, 1.6), variant_cream(0.26, 2.2), variant_duotone()]
    tw, th = 1100, 619
    sheet = Image.new("RGB", (tw * 3, th), "white")
    for i, im in enumerate(ims):
        sheet.paste(im.resize((tw, th), Image.Resampling.LANCZOS), (i * tw, 0))
    sheet.save(SOURCE / "palette_test.png")
    print("saved", sheet.size)


if __name__ == "__main__":
    main()
