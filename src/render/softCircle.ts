import { Texture } from 'pixi.js';

const cache = new Map<number, Texture>();

/**
 * 生成柔边圆形贴图，用于笔刷区域。hardness 0..1 控制实心比例。
 */
export function softCircleTexture(hardness = 0.5): Texture {
  const key = Math.round(Math.max(0, Math.min(1, hardness)) * 10) / 10;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建笔刷贴图');
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  const solid = 0.18 + key * 0.62;
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(solid, 'rgba(255,255,255,0.82)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, c - 1, 0, Math.PI * 2);
  ctx.fill();
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  cache.set(key, texture);
  return texture;
}
