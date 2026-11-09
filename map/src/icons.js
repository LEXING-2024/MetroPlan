import { POI_KINDS } from './poi.js';

const SIZE = 52;
const PIXEL_RATIO = 2;
const PAPER = '#f8f4ea';
const INK = '#4f5548';

/**
 * Build a tiny, game-like circular POI badge on a canvas. Baked at 2x so the
 * symbols stay crisp on the 4K export. The glyphs are Chinese single-character
 * abbreviations (医 / 学 / 园 ...), matching the POI language of the game.
 */
function drawBadge(kind) {
  const meta = POI_KINDS[kind] ?? POI_KINDS.default;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * PIXEL_RATIO;
  canvas.height = SIZE * PIXEL_RATIO;
  const ctx = canvas.getContext('2d');
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = 18.2;

  // Soft paper disc, slightly translucent so the map still reads underneath.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = 0.96;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Category ring.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = meta.color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // A tiny inner ring adds the badge feel without visual noise.
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3.4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(79, 85, 72, 0.12)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = '600 18px "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.glyph, cx, cy + 0.8);

  // Pass ImageData rather than the canvas. MapLibre's canvas path uses an
  // OffscreenCanvas round-trip in headless Chrome; ImageData is deterministic.
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function buildPoiIcons() {
  return Object.keys(POI_KINDS).map((kind) => ({
    id: `poi-${kind}`,
    imageData: drawBadge(kind),
    pixelRatio: PIXEL_RATIO,
  }));
}
