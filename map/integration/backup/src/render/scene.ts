import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  GROUP_META,
  LINE_COLORS,
  WORLD_H,
  WORLD_W,
} from '../sim/constants';
import { POI_META, REGION_META, hexOf } from '../sim/mapData';
import type { Simulation } from '../sim/simulation';
import type { CustomMapData, MapPoi, PopulationDot, Station, Zone } from '../sim/types';
import { buildHeatFrame, type HeatFrame } from '../sim/heat';
import { HeatLayer } from './heatLayer';
import type { MapAssets } from './mapAssets';
import { drawPoiGlyph } from './poiGlyph';
import { buildZoneBubbles, type ZoneBubble } from './zoneBubbles';

export interface LayerVisibility {
  base: boolean;
  zones: boolean;
  od: boolean;
  lines: boolean;
  stations: boolean;
  heat: boolean;
  poi: boolean;
}

export interface RenderState {
  hoverStation: number | null;
  hoverLine: number | null;
  hoverZone: number | null;
  selectedStation: number | null;
  selectedLine: number | null;
  selectedZone: number | null;
  preview: { x: number; y: number } | null;
  previewValid: boolean;
  lineDraft: number[];
  /** 草稿里已经属于既有线路的车站：这些区段不重复预览。 */
  draftBase: number[];
  /** 正在延长 / 分支的线路，预览沿用它的颜色。 */
  draftLineId: number | null;
  /** 正在建支线（只有末端能继续接站）。 */
  draftBranch: boolean;
  /** 新建线路时草稿面板里选中的颜色。 */
  draftHex: string | null;
  groupFilter: boolean[];
  previewRadius: number;
  previewCoreRadius: number;
  layers: LayerVisibility;
  highlightLine: number | null;
}

const INK = 0x33362e;
const MUTED = 0x9c9a8e;
const ACCENT = 0x4b6b4f;
const WARM = 0xb4623f;

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 站点图标：绿 → 黄 → 红，按候车 / 承载力渐变。 */
export function stationLoadColor(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.35) return lerpColor(0x2f7d4f, 0x7fae4a, x / 0.35);
  if (x < 0.6) return lerpColor(0x7fae4a, 0xd9b53c, (x - 0.35) / 0.25);
  if (x < 0.82) return lerpColor(0xd9b53c, 0xd4712c, (x - 0.6) / 0.22);
  return lerpColor(0xd4712c, 0xb22f24, (x - 0.82) / 0.18);
}

function dashedCircle(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  color: number,
  width: number,
  alpha: number,
  dashes = 40,
): void {
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i += 2) {
    const a0 = i * step;
    const a1 = a0 + step * 0.72;
    g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    g.arc(x, y, r, a0, a1);
  }
  g.stroke({ width, color, alpha, cap: 'round' });
}

function tracePath(g: Graphics, pts: Array<{ x: number; y: number }>): void {
  if (pts.length < 2) return;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
}

function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += /[\u3400-\u9fff]/.test(ch) ? 1 : 0.58;
  }
  return Math.max(fontSize, units * fontSize);
}

function overlaps(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
}

export class Scene {
  app: Application;
  world = new Container();
  private mapSprite: Sprite;
  private dotSprite: Sprite;
  private bubbleLayer = new Container();
  private bubbleCoreGfx = new Graphics();
  private landMaskCanvas: HTMLCanvasElement | null = null;
  private bubbleSim: Simulation | null = null;
  private bubbleItems: ZoneBubble[] = [];
  private coreScale = -1;
  private plainGfx = new Graphics();
  private fieldDotsGfx = new Graphics();
  private odGfx = new Graphics();
  private lineGfx = new Graphics();
  private heatLayer: HeatLayer | null = null;
  private heatSim: Simulation | null = null;
  private lastHeatKey = '';
  private lastHeatFrame: HeatFrame | null = null;
  private heatDisplay: Float32Array | null = null;
  private lastFrameAt = 0;
  private stationGfx = new Graphics();
  private trainGfx = new Graphics();
  private overlayGfx = new Graphics();
  private poiGfx = new Container();
  private poiBadgeEntries: Array<{
    poi: MapPoi;
    badge: Container;
    radius: number;
    level: number;
    label?: Text;
    /** 标签相对徽章中心的屏幕像素盒 */
    labelBox?: { x0: number; y0: number; x1: number; y1: number };
  }> = [];
  private customLayer = new Container();
  private customBgSprite: Sprite | null = null;
  private customRegionGfx: Graphics | null = null;
  private plainMap = false;

  scale = 1;
  offsetX = 0;
  offsetY = 0;
  zoom = 1;
  panX = 0;
  panY = 0;
  private fitScale = 1;
  private fitOffsetX = 0;
  private fitOffsetY = 0;
  private viewW = 1;
  private viewH = 1;
  private lastLineVersion = -1;
  private lastLineScale = -1;
  private lastOdKey = '';
  private lastOdDraw = 0;
  private lastHighlight: number | null = null;
  private lastEditing: number | null = null;

  constructor(app: Application, assets: MapAssets) {
    this.app = app;
    this.mapSprite = new Sprite(assets.mapTexture);
    this.dotSprite = new Sprite(assets.dotTexture);
    this.mapSprite.width = WORLD_W;
    this.mapSprite.height = WORLD_H;
    this.dotSprite.width = WORLD_W;
    this.dotSprite.height = WORLD_H;

    this.odGfx.zIndex = 1;
    this.dotSprite.zIndex = 0;
    this.bubbleLayer.zIndex = 0.5;
    this.bubbleLayer.addChild(this.bubbleCoreGfx);
    this.landMaskCanvas = this.makeLandMaskCanvas(assets.mask);
    this.mapSprite.zIndex = 0;
    this.plainGfx.zIndex = -2;
    this.plainGfx.rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0xf4ecd9, alpha: 1 });
    this.plainGfx.visible = false;
    this.fieldDotsGfx.zIndex = 0;
    this.fieldDotsGfx.visible = false;
    this.lineGfx.zIndex = 2;
    this.heatLayer = new HeatLayer(this.landMaskCanvas ? Texture.from(this.landMaskCanvas) : null);
    this.heatLayer.view.zIndex = 1.2;
    this.heatLayer.view.visible = false;
    this.stationGfx.zIndex = 4;
    this.trainGfx.zIndex = 5;
    this.overlayGfx.zIndex = 6;
    this.poiGfx.zIndex = 1.5;
    this.customLayer.zIndex = -1;
    this.customLayer.visible = false;

    this.world.addChild(
      this.plainGfx,
      this.fieldDotsGfx,
      this.customLayer,
      this.poiGfx,
      this.mapSprite,
      this.dotSprite,
      this.bubbleLayer,
      this.heatLayer.view,
      this.odGfx,
      this.lineGfx,
      this.stationGfx,
      this.trainGfx,
      this.overlayGfx,
    );
    this.world.sortableChildren = true;
    app.stage.addChild(this.world);
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.viewW = width;
    this.viewH = height;
    this.fitScale = Math.min(width / WORLD_W, height / WORLD_H);
    this.fitOffsetX = (width - WORLD_W * this.fitScale) / 2;
    this.fitOffsetY = (height - WORLD_H * this.fitScale) / 2;
    this.applyCamera();
  }

  private clampPan(): void {
    const mapW = WORLD_W * this.scale;
    const mapH = WORLD_H * this.scale;
    if (mapW >= this.viewW) {
      this.panX = Math.max(this.viewW - mapW - this.fitOffsetX, Math.min(-this.fitOffsetX, this.panX));
    } else {
      this.panX = 0;
    }
    if (mapH >= this.viewH) {
      this.panY = Math.max(this.viewH - mapH - this.fitOffsetY, Math.min(-this.fitOffsetY, this.panY));
    } else {
      this.panY = 0;
    }
  }

  private applyCamera(): void {
    this.scale = this.fitScale * this.zoom;
    this.clampPan();
    this.offsetX = this.fitOffsetX + this.panX;
    this.offsetY = this.fitOffsetY + this.panY;
    this.world.scale.set(this.scale);
    this.world.position.set(this.offsetX, this.offsetY);
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(1, Math.min(5, this.zoom * factor));
    const scale = this.fitScale * this.zoom;
    this.offsetX = screenX - before.x * scale;
    this.offsetY = screenY - before.y * scale;
    this.panX = this.offsetX - this.fitOffsetX;
    this.panY = this.offsetY - this.fitOffsetY;
    this.applyCamera();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.applyCamera();
  }

  resetCamera(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyCamera();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offsetX) / this.scale, y: (sy - this.offsetY) / this.scale };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.offsetX, y: wy * this.scale + this.offsetY };
  }

  render(sim: Simulation | null, state: RenderState): void {
    if (!sim) {
      this.bubbleLayer.visible = false;
      this.bubbleSim = null;
      this.bubbleItems = [];
      this.coreScale = -1;
      this.odGfx.clear();
      this.lineGfx.clear();
      if (this.heatLayer) this.heatLayer.view.visible = false;
      this.stationGfx.clear();
      this.trainGfx.clear();
      this.overlayGfx.clear();
      this.lastLineVersion = -1;
      this.lastOdKey = '';
      this.lastHighlight = null;
      return;
    }
    const layers = state.layers;
    this.plainGfx.visible = layers.base && this.plainMap;
    this.mapSprite.visible = layers.base && !this.plainMap;
    // 组团改用“气泡 + 中心核”，点阵不再参与显示；数据层（sim.dots）仍用于覆盖计算。
    this.bubbleLayer.visible = layers.zones;
    this.dotSprite.visible = false;
    this.fieldDotsGfx.visible = false;
    this.customLayer.visible = this.customLayer.children.length > 0;
    if (this.customBgSprite) this.customBgSprite.visible = layers.base && !this.plainMap;
    if (this.customRegionGfx) this.customRegionGfx.visible = layers.zones;
    this.odGfx.visible = layers.od;
    this.lineGfx.visible = layers.lines;
    if (this.heatLayer) {
      this.heatLayer.view.visible = layers.heat;
      this.heatLayer.setMask(!this.plainMap && !sim.map);
    }
    this.stationGfx.visible = layers.stations;
    this.trainGfx.visible = layers.stations;
    this.poiGfx.visible = layers.poi;
    if (sim !== this.bubbleSim) {
      this.bubbleSim = sim;
      this.bubbleItems = buildZoneBubbles(sim);
      this.drawBubbles(sim);
    } else if (this.scale !== this.coreScale) {
      // 中心核是“图标”：固定屏幕大小，缩放时只改世界半径。
      this.coreScale = this.scale;
      this.drawCores();
    }
    this.updatePoiBadges();

    if (
      sim.net.version !== this.lastLineVersion ||
      state.highlightLine !== this.lastHighlight ||
      state.draftLineId !== this.lastEditing ||
      this.scale !== this.lastLineScale
    ) {
      this.lastLineVersion = sim.net.version;
      this.lastHighlight = state.highlightLine;
      this.lastEditing = state.draftLineId;
      this.lastLineScale = this.scale;
      this.drawLines(sim, state.highlightLine, state.draftLineId);
    }
    const odKey = `${state.groupFilter.join('')}|${state.selectedZone ?? -1}|${state.hoverZone ?? -1}`;
    const now = performance.now();
    // OD 流带随时段变化，但按 1–2 秒刷新即可，不逐帧动画。
    if (odKey !== this.lastOdKey || (layers.od && now - this.lastOdDraw > 1200)) {
      this.lastOdKey = odKey;
      this.lastOdDraw = now;
      this.drawOd(sim, state);
    }
    this.updateHeat(sim, layers.heat);
    this.drawStations(sim);
    this.drawTrains(sim);
    this.drawOverlay(sim, state);
  }

  /**
   * 水面 / 山体掩膜：1280×720 的白底 alpha 图，陆地不透明、水面与山体透明。
   * 气泡整层烘焙成一张纹理后再用它做 destination-in，避免逐圈 mask 的开销。
   */
  private makeLandMaskCanvas(maskData: Uint8Array): HTMLCanvasElement | null {
    const mw = 1280;
    const mh = 720;
    const canvas = document.createElement('canvas');
    canvas.width = mw;
    canvas.height = mh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(mw, mh);
    const stepX = WORLD_W / mw;
    const stepY = WORLD_H / mh;
    for (let y = 0; y < mh; y++) {
      const sy = Math.min(WORLD_H - 1, Math.floor((y + 0.5) * stepY));
      for (let x = 0; x < mw; x++) {
        const sx = Math.min(WORLD_W - 1, Math.floor((x + 0.5) * stepX));
        // 只裁水面；绿地 / 山体照常保留，否则鼎湖、四会的组团会被整片裁掉。
        if (maskData[sy * WORLD_W + sx] === 1) continue;
        const i = (y * mw + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** 组团气泡：整层烘焙成一张柔和渐变纹理，中心核保持矢量、放大不糊。 */
  private drawBubbles(sim: Simulation): void {
    const layer = this.bubbleLayer;
    for (const child of layer.removeChildren()) {
      if (child === this.bubbleCoreGfx) continue;
      if (child instanceof Sprite) child.destroy({ texture: true, textureSource: true });
      else child.destroy();
    }

    const canvas = document.createElement('canvas');
    canvas.width = WORLD_W;
    canvas.height = WORLD_H;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      for (const b of this.bubbleItems) {
        const r = (b.fill >> 16) & 255;
        const g = (b.fill >> 8) & 255;
        const bl = b.fill & 255;
        const a = Math.min(0.4, b.fillAlpha * 2.6);
        const grad = ctx.createRadialGradient(b.x, b.y, b.r * 0.1, b.x, b.y, b.r);
        grad.addColorStop(0, `rgba(${r},${g},${bl},${a})`);
        grad.addColorStop(0.68, `rgba(${r},${g},${bl},${a * 0.92})`);
        grad.addColorStop(0.88, `rgba(${r},${g},${bl},${a * 0.4})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        // 极淡的一圈边界，让“泡”有可读的轮廓；重叠处自然加深。
        ctx.strokeStyle = `rgba(${r},${g},${bl},${Math.min(0.24, a * 0.6)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 地形图不把气泡铺到西江和鼎湖山上；纯色图与自定义图没有这个掩膜。
      if (!this.plainMap && !sim.map && this.landMaskCanvas) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.landMaskCanvas, 0, 0, WORLD_W, WORLD_H);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'linear';
    const sprite = new Sprite(tex);
    sprite.width = WORLD_W;
    sprite.height = WORLD_H;
    layer.addChild(sprite);

    layer.addChild(this.bubbleCoreGfx);
    this.coreScale = this.scale;
    this.drawCores();
  }

  /** 中心核用世界坐标 ÷ 当前缩放，屏幕半径恒为 core px（和站点 / POI 图标一致）。 */
  private drawCores(): void {
    const g = this.bubbleCoreGfx;
    g.clear();
    const k = 1 / Math.max(0.001, this.scale);
    for (const b of this.bubbleItems) {
      if (b.core > 0) {
        g.circle(b.x, b.y, b.core * k).fill({ color: b.coreColor, alpha: 0.92 });
      }
    }
  }

  private drawLines(sim: Simulation, highlight: number | null, editing: number | null = null): void {
    const g = this.lineGfx;
    g.clear();
    // 线路粗细保持屏幕固定，不随地图缩放变粗 / 变细。
    const k = 1 / Math.max(0.001, this.scale);
    const ordered = [...sim.net.lines].sort((a, b) => {
      if (highlight === null) return 0;
      return (a.id === highlight ? 1 : 0) - (b.id === highlight ? 1 : 0);
    });
    for (const line of ordered) {
      const pts = line.stationIds
        .map((id) => sim.net.stationById.get(id))
        .filter((s): s is Station => !!s)
        .map((s) => ({ x: s.x, y: s.y }));
      if (pts.length < 2) continue;
      const color =
        line.hex && line.hex.startsWith('#')
          ? hexOf(line.hex)
          : LINE_COLORS[line.color % LINE_COLORS.length]!.hex;
      const dim = highlight !== null && line.id !== highlight;
      const colorAlpha = dim ? 0.16 : 1;
      // 正在延长 / 分支的线路：一圈同色外发光，线本身不变色不变粗。
      if (line.id === editing) {
        tracePath(g, pts);
        g.stroke({ width: 22 * k, color, alpha: 0.18, cap: 'round', join: 'round' });
      }
      tracePath(g, pts);
      g.stroke({
        width: (highlight === line.id ? 9 : 8) * k,
        color,
        alpha: colorAlpha,
        cap: 'round',
        join: 'round',
      });
    }
  }

  private drawOd(sim: Simulation, state: RenderState): void {
    const g = this.odGfx;
    g.clear();
    const pairs = sim.odPairs;
    const selected = state.selectedZone;
    let index = 0;
    for (const pair of pairs) {
      index++;
      const count = pair.count * sim.odFlowWeight(pair);
      if (count < 4) continue;
      const from = sim.zoneMap.get(pair.from);
      const to = sim.zoneMap.get(pair.to);
      if (!from || !to) continue;
      if (!state.groupFilter[pair.group]) continue;
      const inFocus = selected === null || selected === pair.from || selected === pair.to;
      if (selected !== null && !inFocus) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len;
      const ny = dx / len;
      const bend = Math.min(120, len * 0.17) * (index % 2 === 0 ? 1 : -1);
      const cx = (from.x + to.x) / 2 + nx * bend;
      const cy = (from.y + to.y) / 2 + ny * bend;
      const meta = GROUP_META[pair.group]!;
      const width = Math.min(7, 0.9 + Math.sqrt(count) * 0.62);
      const alpha = selected !== null ? 0.34 : 0.075 + Math.min(0.15, count / 900);
      g.moveTo(from.x, from.y);
      g.quadraticCurveTo(cx, cy, to.x, to.y);
      g.stroke({ width, color: meta.color, alpha, cap: 'round' });
    }
  }

  /**
   * 实时热力：网格数据每 ~260 ms 重算一次（潮汐 + 排队 + 拥堵），
   * 动画时间每帧推进，保证色块是“呼吸”的而不是硬切。
   */
  private updateHeat(sim: Simulation, visible: boolean): void {
    if (!this.heatLayer) return;
    if (!visible) {
      this.heatLayer.view.visible = false;
      return;
    }
    const now = performance.now();
    const dt = this.lastFrameAt > 0 ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 0.016;
    this.lastFrameAt = now;
    const minute = sim.timeOfDay();
    const newSim = sim !== this.heatSim;
    // 每 10 游戏分钟重算一次；建站 / 拆线等线网变化立即重算。
    const key = `${Math.floor(sim.time / 10)}|${sim.net.version}`;
    if (key !== this.lastHeatKey) {
      this.heatSim = sim;
      this.lastHeatKey = key;
      if (newSim) this.heatDisplay = null;
      const frame = buildHeatFrame(sim, minute);
      this.lastHeatFrame = frame;
      // 两帧之间用 Lerp 过渡，热力像在流动而不是硬切。
      if (!this.heatDisplay || this.heatDisplay.length !== frame.values.length) {
        this.heatDisplay = new Float32Array(frame.values);
      } else {
        const shown = this.heatDisplay;
        for (let i = 0; i < shown.length; i++) {
          shown[i] = shown[i]! + (frame.values[i]! - shown[i]!) * 0.7;
        }
      }
      this.heatLayer.setData(this.heatDisplay, frame.queue);
    }
    this.heatLayer.tick(dt);
  }

  /** 供 UI / 其他层读取的最近一帧热力（含站点承载力）。 */
  heatFrame(): HeatFrame | null {
    return this.lastHeatFrame;
  }

  private drawStations(sim: Simulation): void {
    const g = this.stationGfx;
    g.clear();
    // 世界坐标里的图标反向缩放，屏幕上的站点图标大小不随缩放变化。
    const k = 1 / Math.max(0.001, this.scale);
    const clock = performance.now() / 1000;
    for (const station of sim.net.stations) {
      const size = station.size ?? 'standard';
      const baseR = size === 'small' ? 8 : size === 'large' ? 13 : 10;
      if (station.lines.length === 0) {
        g.circle(station.x, station.y, (baseR - 1) * k).stroke({ width: 2.2 * k, color: MUTED, alpha: 0.95 });
        g.circle(station.x, station.y, 2.1 * k).fill({ color: MUTED, alpha: 0.85 });
        continue;
      }
      const waiting = sim.waitingAt(station.id);
      const ratio = waiting / Math.max(1, station.capacity);
      const color = stationLoadColor(ratio);
      const hot = ratio >= 0.9;
      const ringW = size === 'large' ? 3.4 : size === 'small' ? 2.4 : 2.8;
      const dotR = size === 'large' ? 3.6 : size === 'small' ? 2.3 : 2.8;
      if (hot) {
        // 接近 / 超过承载力：红色外扩波纹 + 轻微震动。
        const wobble = Math.min(1.4, Math.max(0, ratio - 0.9) * 1.8) * k;
        const x = station.x + Math.sin(clock * 26 + station.id * 1.7) * wobble;
        const y = station.y + Math.cos(clock * 31 + station.id * 1.3) * wobble * 0.7;
        g.circle(x, y, (baseR + 6 + Math.min(12, Math.max(0, ratio - 0.9) * 12)) * k).fill({ color: 0xc0392b, alpha: 0.13 });
        for (let i = 0; i < 2; i++) {
          const phase = (clock * 0.5 + i * 0.5 + station.id * 0.17) % 1;
          g.circle(x, y, (baseR + 1 + phase * 27) * k).stroke({ width: 2.2 * k, color: 0xc0392b, alpha: (1 - phase) * 0.5 });
        }
        g.circle(x, y, baseR * k).fill({ color, alpha: 1 });
        g.circle(x, y, baseR * k).stroke({ width: ringW * k, color: INK, alpha: 1 });
        g.circle(x, y, dotR * k).fill({ color: 0xfff1e6, alpha: 1 });
        if (size === 'large') this.drawInterchangeRing(x, y, baseR, k, INK);
      } else {
        g.circle(station.x, station.y, baseR * k).fill({ color, alpha: 0.94 });
        g.circle(station.x, station.y, baseR * k).stroke({ width: ringW * k, color: INK, alpha: 0.9 });
        g.circle(station.x, station.y, dotR * k).fill({ color: 0xfffcf3, alpha: 1 });
        if (size === 'large') this.drawInterchangeRing(station.x, station.y, baseR, k, INK);
      }
    }
  }

  /** 大型换乘站：外圈 + 内圈，和普通站一眼区分。 */
  private drawInterchangeRing(x: number, y: number, baseR: number, k: number, ink: number): void {
    const g = this.stationGfx;
    g.circle(x, y, (baseR + 4) * k).stroke({ width: 1.8 * k, color: ink, alpha: 0.55 });
    g.circle(x, y, (baseR - 4.5) * k).stroke({ width: 1.6 * k, color: 0xfffcf3, alpha: 0.85 });
  }

  private drawTrains(sim: Simulation): void {
    const g = this.trainGfx;
    g.clear();
    const k = 1 / Math.max(0.001, this.scale);
    for (const train of sim.net.trains) {
      const line = sim.net.lineById.get(train.lineId);
      if (!line || line.stationIds.length < 2) continue;
      let nextIdx = train.index + train.dir;
      if (nextIdx < 0 || nextIdx >= line.stationIds.length) nextIdx = train.index - train.dir;
      const a = sim.net.stationById.get(line.stationIds[train.index]!);
      const b = sim.net.stationById.get(line.stationIds[nextIdx]!);
      if (!a || !b) continue;
      const t = train.phase === 1 ? train.prog : 0.07;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const shape: Array<[number, number]> = [
        [-9.5 * k, -3.4 * k],
        [-6.4 * k, -5 * k],
        [6.4 * k, -5 * k],
        [9.5 * k, -3.4 * k],
        [9.5 * k, 3.4 * k],
        [6.4 * k, 5 * k],
        [-6.4 * k, 5 * k],
        [-9.5 * k, 3.4 * k],
      ];
      const pts: number[] = [];
      for (const [px, py] of shape) {
        pts.push(x + px * cos - py * sin, y + px * sin + py * cos);
      }
      const color = LINE_COLORS[line.color % LINE_COLORS.length]!.hex;
      g.poly(pts).fill({ color, alpha: 1 });
      g.poly(pts).stroke({ width: 1.8 * k, color: INK, alpha: 0.85, join: 'round' });
      g.circle(x, y, 1.7 * k).fill({ color: 0xfffcf3, alpha: 0.9 });
    }
  }

  private drawOverlay(sim: Simulation, state: RenderState): void {
    const g = this.overlayGfx;
    g.clear();
    const iconK = 1 / Math.max(0.001, this.scale);

    // 悬停组团
    if (state.hoverZone !== null && state.selectedZone === null) {
      const zone = sim.zoneMap.get(state.hoverZone);
      if (zone) this.zoneFill(g, zone, 0, 0x8b8f80);
    }
    if (state.selectedZone !== null) {
      const zone = sim.zoneMap.get(state.selectedZone);
      if (zone) this.zoneFill(g, zone, 0.03, 0x6f7468);
    }

    // 悬停线路
    if (state.hoverLine !== null) {
      const line = sim.net.lineById.get(state.hoverLine);
      if (line) {
        const pts = line.stationIds
        .map((id) => sim.net.stationById.get(id))
        .filter((s): s is Station => !!s)
        .map((s) => ({ x: s.x, y: s.y }));
        tracePath(g, pts);
        g.stroke({ width: 12 * iconK, color: 0x2f332b, alpha: 0.16, cap: 'round', join: 'round' });
      }
    }

    // 悬停 / 选中车站
    if (state.hoverStation !== null) {
      const s = sim.net.stationById.get(state.hoverStation);
      if (s) {
        g.circle(s.x, s.y, 16 * iconK).stroke({ width: 2 * iconK, color: ACCENT, alpha: 0.36 });
      }
    }
    if (state.selectedStation !== null) {
      const s = sim.net.stationById.get(state.selectedStation);
      if (s) {
        dashedCircle(g, s.x, s.y, 19 * iconK, ACCENT, 2.2 * iconK, 0.8, 32);
      }
    }

    // 正在延长 / 分支的既有线路：两端给接站提示（光晕在线路图层里）。
    if (state.draftLineId !== null && state.lineDraft.length > 0) {
      const line = sim.net.lineById.get(state.draftLineId);
      const lineColor =
        line === undefined
          ? ACCENT
          : line.hex && line.hex.startsWith('#')
            ? hexOf(line.hex)
            : LINE_COLORS[line.color % LINE_COLORS.length]!.hex;
      const last = state.lineDraft[state.lineDraft.length - 1]!;
      const ends = state.draftBranch ? [last] : [state.lineDraft[0]!, last];
      for (const id of new Set(ends)) {
        const s = sim.net.stationById.get(id);
        if (!s) continue;
        g.circle(s.x, s.y, 17 * iconK).stroke({ width: 2 * iconK, color: lineColor, alpha: 0.5 });
      }
    }

    // 画线草稿：只画玩家真正点选的区段，不画跟随鼠标的虚线。
    if (state.lineDraft.length > 0) {
      const base = new Set(state.draftBase);
      const pts = state.lineDraft
        .map((id) => sim.net.stationById.get(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ id: s.id, x: s.x, y: s.y }));
      const draft = state.draftLineId !== null ? sim.net.lineById.get(state.draftLineId) : undefined;
      const color =
        draft !== undefined
          ? draft.hex && draft.hex.startsWith('#')
            ? hexOf(draft.hex)
            : LINE_COLORS[draft.color % LINE_COLORS.length]!.hex
          : state.draftHex && state.draftHex.startsWith('#')
            ? hexOf(state.draftHex)
            : 0x2f6f5a;
      // 延长既有线路时，旧区段由线路图层照常绘制，这里只补新增区段。
      const fresh: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (base.has(a.id) && base.has(b.id)) continue;
        fresh.push([a, b]);
      }
      if (fresh.length > 0) {
        for (const [a, b] of fresh) {
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
        }
        g.stroke({ width: 7 * iconK, color, alpha: 0.9, cap: 'round', join: 'round' });
      }
      for (const p of pts) {
        if (base.has(p.id)) continue;
        g.circle(p.x, p.y, 14).stroke({ width: 2.4, color, alpha: 0.9 });
      }
    }

    // 放站预览
    if (state.preview) {
      const { x, y } = state.preview;
      const color = state.previewValid ? ACCENT : WARM;
      g.circle(x, y, state.previewCoreRadius).fill({ color, alpha: 0.05 });
      dashedCircle(g, x, y, state.previewCoreRadius, color, 1.5, 0.95, 40);
      g.circle(x, y, state.previewRadius).fill({ color, alpha: 0.03 });
      dashedCircle(g, x, y, state.previewRadius, color, 1.8, 0.55, 56);
      g.circle(x, y, 13).stroke({ width: 2.4, color, alpha: 0.95 });
      g.circle(x, y, 3).fill({ color, alpha: 0.9 });
      g.moveTo(x - 19, y).lineTo(x - 8, y);
      g.moveTo(x + 8, y).lineTo(x + 19, y);
      g.moveTo(x, y - 19).lineTo(x, y - 8);
      g.moveTo(x, y + 8).lineTo(x, y + 19);
      g.stroke({ width: 1.6, color, alpha: 0.8 });
    }
  }

  setCustomMap(map: CustomMapData | null, dots: PopulationDot[], pois: MapPoi[], image: HTMLImageElement | null, pxPerKm = 50): void {
    this.customLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.customBgSprite = null;
    this.customRegionGfx = null;
    void dots;
    void pois;
    void pxPerKm;
    if (!map) {
      this.customLayer.visible = false;
      this.mapSprite.visible = true;
      this.dotSprite.visible = false;
      return;
    }
    this.customLayer.visible = true;
    this.mapSprite.visible = false;
    this.dotSprite.visible = false;

    if (image && map.background) {
      const bg = map.background;
      const sprite = new Sprite(Texture.from(image));
      sprite.anchor.set(0.5);
      sprite.position.set(bg.x, bg.y);
      sprite.scale.set(bg.scale);
      sprite.rotation = (bg.rotation * Math.PI) / 180;
      sprite.alpha = bg.visible ? bg.opacity : 0;
      this.customBgSprite = sprite;
      this.customLayer.addChild(sprite);
    }

    const marks = new Graphics();
    for (const region of map.regions) {
      const meta = REGION_META[region.type];
      const color = hexOf(meta.css);
      if (region.shape.kind === 'polygon') {
        if (region.shape.points.length < 3) continue;
        const pts: number[] = [];
        for (const p of region.shape.points) pts.push(p.x, p.y);
        marks.poly(pts).fill({ color, alpha: 0.18 });
        marks.poly(pts).stroke({ width: 1.4, color, alpha: 0.38 });
      } else {
        for (const s of region.shape.stamps) {
          marks.circle(s.x, s.y, s.r).fill({ color, alpha: 0.028 * Math.max(0.2, s.strength) });
        }
      }
    }
    this.customRegionGfx = marks;
    this.customLayer.addChild(marks);
  }

  setPois(pois: MapPoi[], pxPerKm: number): void {
    this.poiGfx.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.poiBadgeEntries = [];
    if (pois.length === 0) return;
    const influence = new Graphics();
    for (const poi of pois) {
      influence
        .circle(poi.x, poi.y, Math.max(10, poi.radiusKm * pxPerKm))
        .stroke({ width: 1, color: 0x9c9a8e, alpha: 0.05 });
    }
    this.poiGfx.addChild(influence);
    for (const poi of pois) {
      const meta = POI_META[poi.type];
      const css = meta?.css ?? '#8C97A8';
      const color = hexOf(css);
      const level = poi.level ?? 3;
      const badgeR = 7.2 + level * 1.25;
      const glyphSize = 9 + level * 1.05;
      const badge = new Container();
      badge.position.set(poi.x, poi.y);
      badge.scale.set(1 / Math.max(0.001, this.scale));
      const ring = new Graphics();
      // 等级外环：4 级起加一圈，数字越大越粗、越外扩。
      if (level >= 4) {
        const extra = 2.6 + (level - 4) * 1.5;
        ring.circle(0, 0, badgeR + extra).stroke({
          width: 1.1 + (level - 4) * 0.35,
          color,
          alpha: 0.32 + (level - 4) * 0.08,
        });
      }
      if (level >= 6) {
        ring.circle(0, 0, badgeR + 8.6).stroke({ width: 1.4, color, alpha: 0.5 });
      }
      ring.circle(0, 0, badgeR).fill({ color: 0xfffcf3, alpha: 0.96 });
      ring.circle(0, 0, badgeR).stroke({ width: 1.4 + level * 0.12, color, alpha: 0.92 });
      badge.addChild(ring);
      const glyph = new Graphics();
      drawPoiGlyph(glyph, poi.type, glyphSize, color);
      badge.addChild(glyph);
      this.poiGfx.addChild(badge);
      const outer =
        level >= 6 ? 8.6 : level >= 4 ? 2.6 + (level - 4) * 1.5 : 0;
      this.poiBadgeEntries.push({
        poi,
        badge,
        radius: badgeR + outer,
        level,
      });
    }

    // 名称标签先全部创建，具体显示由 updatePoiBadges 按当前缩放做屏幕空间去重。
    const entryById = new Map(this.poiBadgeEntries.map((e) => [e.poi.id, e]));
    for (const poi of pois) {
      const entry = entryById.get(poi.id);
      if (!entry) continue;
      const meta = POI_META[poi.type];
      const level = poi.level ?? 3;
      const badgeR = 7.2 + level * 1.25;
      const fontSize = 9.5 + level * 0.9;
      const text = poi.name || meta?.label || '';
      if (!text) continue;
      const width = estimateTextWidth(text, fontSize);
      const height = fontSize * 1.12;
      const gap = 4;
      const side = poi.y > WORLD_H - 90 ? 'above' : 'below';
      const offsetY = side === 'below' ? badgeR + gap : -(badgeR + gap);
      const label = new Text({
        text,
        style: {
          fontFamily: 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
          fontSize,
          fill: 0x3c3f36,
          stroke: { color: 0xfffcf3, width: 2.6 },
          align: 'center',
        },
      });
      label.anchor.set(0.5, side === 'below' ? 0 : 1);
      label.position.set(0, offsetY);
      label.alpha = level >= 4 ? 0.95 : 0.8;
      entry.badge.addChild(label);
      entry.label = label;
      entry.labelBox = {
        x0: -width / 2 - 2,
        y0: side === 'below' ? offsetY : offsetY - height - 1,
        x1: width / 2 + 2,
        y1: side === 'below' ? offsetY + height + 1 : offsetY,
      };
    }
    this.updatePoiBadges();
  }

  /**
   * 图标保持屏幕固定大小；缩小时若徽章互相重叠，只保留等级更高的一批，
   * 低等级 POI 暂时隐藏，放大后自动恢复。
   */
  private updatePoiBadges(): void {
    if (this.poiBadgeEntries.length === 0) return;
    const scale = Math.max(0.001, this.scale);
    for (const entry of this.poiBadgeEntries) {
      entry.badge.scale.set(1 / scale);
    }
    const sorted = [...this.poiBadgeEntries].sort(
      (a, b) => b.level - a.level || a.poi.id - b.poi.id,
    );
    const shown: typeof this.poiBadgeEntries = [];
    const shownLabels: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const entry of sorted) {
      let overlapsIcon = false;
      for (const other of shown) {
        const dist =
          Math.hypot(entry.poi.x - other.poi.x, entry.poi.y - other.poi.y) * scale;
        if (dist < entry.radius + other.radius + 1.5) {
          overlapsIcon = true;
          break;
        }
      }
      entry.badge.visible = !overlapsIcon;
      if (overlapsIcon) {
        if (entry.label) entry.label.visible = false;
        continue;
      }
      shown.push(entry);
      if (!entry.label || !entry.labelBox) continue;
      const sx = entry.poi.x * scale;
      const sy = entry.poi.y * scale;
      const box = {
        x0: sx + entry.labelBox.x0,
        y0: sy + entry.labelBox.y0,
        x1: sx + entry.labelBox.x1,
        y1: sy + entry.labelBox.y1,
      };
      const covered = shownLabels.some((p) => overlaps(p, box));
      entry.label.visible = !covered;
      if (!covered) shownLabels.push(box);
    }
  }

  /** 纯色地图使用米黄底；地形地图显示底图。由地图定义决定，不再由玩家切换。 */
  setPlainMap(value: boolean): void {
    this.plainMap = value;
  }

  private zoneFill(g: Graphics, zone: Zone, alpha: number, ring: number | null): void {
    if (alpha > 0) g.circle(zone.x, zone.y, zone.r).fill({ color: 0x8f8c7c, alpha });
    if (ring !== null) {
      dashedCircle(g, zone.x, zone.y, zone.r, ring, 1.6, 0.55, 48);
    }
  }

  renderFrame(): void {
    this.app.renderer.render(this.app.stage);
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}


