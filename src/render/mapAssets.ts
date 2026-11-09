import { Texture } from 'pixi.js';
import mapUrl2k from '../../assets/maps/duanzhou-dinghu-simple.png';
import mapUrl4k from '../../assets/maps/duanzhou-dinghu-simple-4k.png';
import { WORLD_H, WORLD_W } from '../sim/constants';
import { MIXED_ZONES, buildPopulationDots } from '../sim/zones';

export interface MapAssets {
  mapTexture: Texture;
  dotTexture: Texture;
  /** 0 = 陆地, 1 = 水面, 2 = 山体 */
  mask: Uint8Array;
}

/**
 * 底图按屏幕物理像素挑选：地图始终铺满视口短边，物理宽度超过 2560 时
 * 直接用 3840 × 2160 的原生 4K 版，避免 2560 底图被放大后发虚。
 */
function pickMapUrl(): string {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const physicalWidth = Math.min(
    window.innerWidth * dpr,
    window.innerHeight * dpr * (WORLD_W / WORLD_H),
  );
  return physicalWidth > WORLD_W * 0.94 ? mapUrl4k : mapUrl2k;
}

function classify(r: number, g: number, b: number): number {
  if (b - r > 10) return 1;
  if (g - r > 6 && b < g - 8) return 2;
  return 0;
}

export async function loadMapAssets(): Promise<MapAssets> {
  const img = new Image();
  img.decoding = 'async';
  img.src = pickMapUrl();
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 画布');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, WORLD_W, WORLD_H);
  const pixels = ctx.getImageData(0, 0, WORLD_W, WORLD_H).data;

  const mask = new Uint8Array(WORLD_W * WORLD_H);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    mask[i] = classify(pixels[p] ?? 0, pixels[p + 1] ?? 0, pixels[p + 2] ?? 0);
  }

  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = WORLD_W;
  dotCanvas.height = WORLD_H;
  const dctx = dotCanvas.getContext('2d');
  if (!dctx) throw new Error('无法创建点阵画布');

  // 混合 / 商业区：极淡中性色底
  for (const zone of MIXED_ZONES) {
    const grad = dctx.createRadialGradient(zone.x, zone.y, zone.r * 0.2, zone.x, zone.y, zone.r);
    grad.addColorStop(0, 'rgba(122, 118, 104, 0.10)');
    grad.addColorStop(1, 'rgba(122, 118, 104, 0)');
    dctx.fillStyle = grad;
    dctx.beginPath();
    dctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
    dctx.fill();
  }

  const dots = buildPopulationDots();
  dctx.fillStyle = 'rgba(150, 126, 100, 0.52)';
  for (const d of dots) {
    const idx = (d.y | 0) * WORLD_W + (d.x | 0);
    if (mask[idx] !== 0) continue;
    if (d.kind !== 'residential') continue;
    dctx.beginPath();
    dctx.arc(d.x, d.y, 1.55, 0, Math.PI * 2);
    dctx.fill();
  }
  dctx.fillStyle = 'rgba(90, 119, 137, 0.46)';
  for (const d of dots) {
    const idx = (d.y | 0) * WORLD_W + (d.x | 0);
    if (mask[idx] !== 0) continue;
    if (d.kind !== 'employment') continue;
    dctx.beginPath();
    dctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2);
    dctx.fill();
  }

  const mapTexture = Texture.from(img);
  mapTexture.source.scaleMode = 'linear';
  const dotTexture = Texture.from(dotCanvas);
  dotTexture.source.scaleMode = 'linear';

  return { mapTexture, dotTexture, mask };
}

export { mapUrl2k, mapUrl4k };
