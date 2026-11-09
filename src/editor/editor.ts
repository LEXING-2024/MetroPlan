import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DEFAULT_PX_PER_KM, GROUP_META, WORLD_H, WORLD_W } from '../sim/constants';
import {
  LAYER_IDS,
  LAYER_LABELS,
  POI_LEVEL_META,
  POI_LEVEL_ORDER,
  POI_META,
  POI_ORDER,
  POI_PROFILE_LABELS,
  POI_PROFILE_ORDER,
  REGION_META,
  REGION_ORDER,
  buildPopulationField,
  clamp,
  cloneMap,
  createBlankMap,
  customMinGap,
  customWalkRadius,
  customWalkSpeed,
  hexOf,
  hitRegion,
  makePoi,
  normalizePoi,
  applyPoiLevel,
  applyPoiScale,
  poiDailyRange,
  regionAreaKm2,
  regionLayer,
} from '../sim/mapData';
import { Simulation } from '../sim/simulation';
import type {
  CustomMapData,
  LayerId,
  MapPoi,
  MapPoint,
  MapRegion,
  PoiLevel,
  PoiTimeProfile,
  PoiType,
  RegionType,
} from '../sim/types';
import { softCircleTexture } from '../render/softCircle';
import type { Scene } from '../render/scene';
import type { Game } from '../game/game';
import { escapeHtml } from '../ui/format';
import { icon } from '../ui/icons';
import { drawPoiMarker, poiMarkerBounds } from '../render/poiMarkers';
import { loadDraft, saveDraft, saveMap } from './mapStore';

export type EditorTool = 'select' | 'background' | 'scale' | 'polygon' | 'brush' | 'poi';

type DragState =
  | { kind: 'background'; start: MapPoint; baseX: number; baseY: number }
  | { kind: 'poi'; id: number; start: MapPoint; baseX: number; baseY: number }
  | { kind: 'scale' }
  | { kind: 'brush'; last: MapPoint; moved: boolean }
  | null;

const ACCENT = 0x4b6b4f;
const WARM = 0xb4623f;
const INK = 0x33362e;

function dashedCircle(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  color: number,
  width: number,
  alpha: number,
  dashes = 44,
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

function nextId(list: Array<{ id: number }>): number {
  let max = 0;
  for (const item of list) max = Math.max(max, item.id);
  return max + 1;
}

function clockValue(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function parseClock(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  return Math.max(0, Math.min(1440, Number(match[1]) * 60 + Number(match[2])));
}

export class Editor {
  active = false;
  private app: Application;
  private scene: Scene;
  private game: Game;

  map: CustomMapData = createBlankMap();
  private tool: EditorTool = 'select';
  private regionType: RegionType = 'residential';
  private regionWeight = 1;
  private regionName = '';
  private regionColor = REGION_META.residential.css;
  private poiType: PoiType = 'hospital';
  private poiRadiusKm = POI_META.hospital.radiusKm;
  private poiLevel: PoiLevel = POI_META.hospital.level;
  private poiScale = 1;
  private poiProfile: PoiTimeProfile = POI_META.hospital.profile;
  private poiOpen = POI_META.hospital.openMin;
  private poiClose = POI_META.hospital.closeMin;
  private brush = { size: 110, hardness: 0.55, erase: false };

  private selectedRegion: number | null = null;
  private selectedPoi: number | null = null;
  private hoverRegion: number | null = null;
  private hoverPoi: number | null = null;
  private polygon: MapPoint[] = [];
  private scaleLine: { a: MapPoint; b: MapPoint } | null = null;
  private calibrateLength = 0;
  private pointer: MapPoint | null = null;
  private pointerScreen: { x: number; y: number } | null = null;
  private drag: DragState = null;
  private brushRegionId: number | null = null;
  private nextRegionId = 1;
  private nextPoiId = 1;

  private bgImage: HTMLImageElement | null = null;
  private bgTexture: Texture | null = null;
  private bgSprite: Sprite | null = null;

  private root: HTMLElement;
  private panel: HTMLElement;
  private layersEl: HTMLElement;
  private statusScale: HTMLElement;
  private statusGrid: HTMLElement;
  private statusCursor: HTMLElement;
  private statusHint: HTMLElement;
  private scaleBar: HTMLElement;
  private emptyEl: HTMLElement;
  private modalEl: HTMLElement;
  private toastEl: HTMLElement;
  private nameInput!: HTMLInputElement;
  private bgInput!: HTMLInputElement;
  private mapInput!: HTMLInputElement;

  private view = new Container();
  private world = new Container();
  private gridGfx = new Graphics();
  private polyGfx = new Graphics();
  private brushLayer = new Container();
  private poiLayer = new Container();
  private overlayGfx = new Graphics();
  private brushNodes = new Map<number, Container>();

  private undoStack: CustomMapData[] = [];
  private saveTimer = 0;
  private toastTimer = 0;
  private modalResolve: ((value: boolean) => void) | null = null;

  constructor(app: Application, scene: Scene, game: Game) {
    this.app = app;
    this.scene = scene;
    this.game = game;

    this.world.addChild(this.gridGfx, this.brushLayer, this.polyGfx, this.poiLayer, this.overlayGfx);
    this.view.addChild(this.world);
    this.view.visible = false;
    this.app.stage.addChild(this.view);

    this.root = document.createElement('div');
    this.root.id = 'editor-ui';
    this.root.className = 'hidden';
    this.root.innerHTML = this.template();
    document.getElementById('app')?.appendChild(this.root);

    this.panel = this.root.querySelector('#ed-panel') as HTMLElement;
    this.layersEl = this.root.querySelector('#ed-layers') as HTMLElement;
    this.statusScale = this.root.querySelector('#ed-scale-text') as HTMLElement;
    this.statusGrid = this.root.querySelector('#ed-grid-text') as HTMLElement;
    this.statusCursor = this.root.querySelector('#ed-cursor') as HTMLElement;
    this.statusHint = this.root.querySelector('#ed-hint') as HTMLElement;
    this.scaleBar = this.root.querySelector('#ed-scalebar') as HTMLElement;
    this.emptyEl = this.root.querySelector('#ed-empty') as HTMLElement;
    this.modalEl = this.root.querySelector('#ed-modal') as HTMLElement;
    this.toastEl = this.root.querySelector('#ed-toast') as HTMLElement;
    this.nameInput = this.root.querySelector('#ed-name') as HTMLInputElement;
    this.bgInput = this.root.querySelector('#ed-bg-input') as HTMLInputElement;
    this.mapInput = this.root.querySelector('#ed-map-input') as HTMLInputElement;

    this.bind();
    this.syncWorld();
  }

  private template(): string {
    return `
      <header class="ed-top">
        <button class="icon-btn" data-action="back" title="返回主菜单">${icon('back', 16)}</button>
        <div class="ed-title">
          <span class="ed-kicker">创作模式 · CREATOR</span>
          <input id="ed-name" class="ed-name" maxlength="40" value="未命名地图" />
        </div>
        <div class="ed-meta">
          <span id="ed-scale-text">比例尺未校准</span>
          <span id="ed-grid-text">网格 100 px</span>
        </div>
        <div class="ed-actions">
          <button class="icon-btn" data-action="toggle-grid" title="网格开关">${icon('grid', 16)}</button>
          <button class="btn ghost" data-action="undo" title="撤销（Ctrl+Z）">撤销</button>
          <button class="btn ghost" data-action="save">保存</button>
          <button class="btn ghost" data-action="export">导出</button>
          <button class="btn ghost" data-action="import">导入</button>
          <button class="btn primary" data-action="play">开始游戏</button>
        </div>
      </header>
      <div class="ed-toolbar">
        <button class="tool" data-tool="select" title="选择 / 检查（V）">${icon('cursor', 18)}<span>选择</span></button>
        <button class="tool" data-tool="background" title="底图对齐（G）">${icon('map', 18)}<span>底图</span></button>
        <button class="tool" data-tool="scale" title="比例尺校准（M）">${icon('arrow', 18)}<span>比例尺</span></button>
        <button class="tool" data-tool="polygon" title="多边形区域（P）">${icon('line', 18)}<span>多边形</span></button>
        <button class="tool" data-tool="brush" title="笔刷涂抹（B）">${icon('brush', 18)}<span>笔刷</span></button>
        <button class="tool" data-tool="poi" title="POI（O）">${icon('station', 18)}<span>POI</span></button>
      </div>
      <aside class="ed-side">
        <div id="ed-panel" class="ed-panel"></div>
        <div id="ed-layers" class="ed-layers"></div>
      </aside>
      <div class="ed-status">
        <div class="ed-scalebar" id="ed-scalebar"></div>
        <span id="ed-cursor">x — · y —</span>
        <span id="ed-hint"></span>
      </div>
      <div class="ed-empty hidden" id="ed-empty">
        <div class="ed-empty-card">
          <div class="ed-empty-kicker">START A MAP</div>
          <h2>先给地图一张参考，或直接开始画</h2>
          <p>导入 PNG / JPG 作为底图，拉线校准比例尺；用多边形或笔刷绘制住宅、就业、水域；再放上医院、学校、车站等 POI。最后点「开始游戏」。</p>
          <div class="ed-row">
            <button class="btn primary" data-action="import-bg">导入底图</button>
            <button class="btn" data-action="quick-start">直接绘制</button>
          </div>
        </div>
      </div>
      <div class="ed-toast" id="ed-toast"></div>
      <div class="ed-modal-root hidden" id="ed-modal"></div>
      <input type="file" id="ed-bg-input" accept="image/png,image/jpeg" hidden />
      <input type="file" id="ed-map-input" accept=".json,application/json" hidden />
    `;
  }

  private bind(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    canvas.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    canvas.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    canvas.addEventListener('pointerleave', () => {
      if (!this.active) return;
      this.pointer = null;
      this.pointerScreen = null;
      this.updateOverlay();
      this.updateStatus();
    });
    canvas.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });

    window.addEventListener('keydown', (ev) => this.onKey(ev));
    window.addEventListener('resize', () => this.syncWorld());

    this.root.addEventListener('click', (ev) => this.onRootClick(ev));
    this.root.addEventListener('input', (ev) => this.onRootInput(ev));
    this.root.addEventListener('change', (ev) => this.onRootInput(ev));

    this.bgInput.addEventListener('change', () => void this.importBackground());
    this.mapInput.addEventListener('change', () => void this.importMap());
  }

  syncWorld(): void {
    this.world.scale.set(this.scene.scale);
    this.world.position.set(this.scene.offsetX, this.scene.offsetY);
    this.updateScaleBar();
  }

  // ————————————————————————— 生命周期 —————————————————————————

  async open(): Promise<void> {
    if (this.active) return;
    const draft = await loadDraft().catch(() => null);
    this.map = draft ?? createBlankMap();
    this.normalizeMap();
    this.resetIds();
    this.bgImage = null;
    this.bgTexture = null;
    this.bgSprite = null;
    const dataUrl = this.map.background?.dataUrl;
    if (dataUrl) {
      try {
        await this.loadBgImage(dataUrl);
      } catch {
        this.toast('底图无法解码，已忽略', 'warn');
      }
    }
    this.active = true;
    this.root.classList.remove('hidden');
    this.view.visible = true;
    this.scene.world.visible = false;
    this.tool = 'select';
    this.selectedRegion = null;
    this.selectedPoi = null;
    this.polygon = [];
    this.scaleLine = null;
    this.undoStack = [];
    this.brushRegionId = null;
    this.nameInput.value = this.map.name;
    this.syncWorld();
    this.rebuildAll();
    this.renderPanel();
    this.renderLayers();
    this.updateStatus();
    this.setTool('select');
    this.updateEmpty();
    if (this.emptyEl.classList.contains('hidden')) {
      this.toast('创作模式：先校准比例尺，再绘制区域');
    }
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.root.classList.add('hidden');
    this.view.visible = false;
    this.scene.world.visible = true;
    this.pointer = null;
    this.drag = null;
    this.closeModal();
    void this.flushDraft();
  }

  isActive(): boolean {
    return this.active;
  }

  tick(): void {
    if (!this.active) return;
    this.updateOverlay();
  }

  private resetIds(): void {
    this.nextRegionId = nextId(this.map.regions);
    this.nextPoiId = nextId(this.map.pois);
  }

  private normalizeMap(): void {
    this.map.layers = LAYER_IDS.map(
      (id) => this.map.layers?.find((l) => l.id === id) ?? { id, visible: true, locked: false },
    );
    this.map.grid = this.map.grid ?? { enabled: false, stepKm: 0.5 };
    this.map.regions = Array.isArray(this.map.regions) ? this.map.regions : [];
    this.map.pois = Array.isArray(this.map.pois) ? this.map.pois : [];
    if (this.map.pxPerKm !== null) this.map.pxPerKm = clamp(this.map.pxPerKm, 1, 5000);
    for (const r of this.map.regions) {
      if (!r.color) r.color = REGION_META[r.type]?.css ?? '#B9B5A8';
      if (!r.name) r.name = '';
      r.weight = clamp(Number(r.weight) || 1, 0.1, 3);
    }
    for (const p of this.map.pois) {
      if (!POI_META[p.type]) p.type = 'hospital';
      if (!p.name) p.name = POI_META[p.type].label;
      p.radiusKm = clamp(Number(p.radiusKm) || 1, 0.1, 20);
    }
    this.map.pois = this.map.pois.map(normalizePoi);
  }

  // ————————————————————————— 绘制层 —————————————————————————

  private rebuildAll(): void {
    this.rebuildBackground();
    this.rebuildGrid();
    this.rebuildRegions();
    this.rebuildPois();
    this.updateOverlay();
    this.updateStatus();
    this.updateEmpty();
  }

  private rebuildBackground(): void {
    if (this.bgSprite) {
      this.bgSprite.destroy();
      this.bgSprite = null;
    }
    if (!this.map.background || !this.bgTexture) return;
    const bg = this.map.background;
    const sprite = new Sprite(this.bgTexture);
    sprite.anchor.set(0.5);
    sprite.position.set(bg.x, bg.y);
    sprite.scale.set(bg.scale);
    sprite.rotation = (bg.rotation * Math.PI) / 180;
    sprite.alpha = bg.visible ? bg.opacity : 0;
    this.bgSprite = sprite;
    this.world.addChildAt(sprite, 0);
    this.updateOverlay();
  }

  private applyBgTransform(): void {
    const bg = this.map.background;
    if (!bg) return;
    if (this.bgSprite) {
      this.bgSprite.position.set(bg.x, bg.y);
      this.bgSprite.scale.set(bg.scale);
      this.bgSprite.rotation = (bg.rotation * Math.PI) / 180;
      this.bgSprite.alpha = bg.visible ? bg.opacity : 0;
    }
    this.updateOverlay();
  }

  private rebuildGrid(): void {
    const g = this.gridGfx;
    g.clear();
    if (!this.map.grid.enabled) return;
    const step = this.gridStepPx();
    if (step < 4) return;
    const minor: number[] = [];
    const major: number[] = [];
    let index = 0;
    for (let x = 0; x <= WORLD_W + 0.1; x += step, index++) {
      const target = index % 5 === 0 ? major : minor;
      target.push(x, 0, x, WORLD_H);
    }
    index = 0;
    for (let y = 0; y <= WORLD_H + 0.1; y += step, index++) {
      const target = index % 5 === 0 ? major : minor;
      target.push(0, y, WORLD_W, y);
    }
    for (let i = 0; i < minor.length; i += 4) {
      g.moveTo(minor[i]!, minor[i + 1]!).lineTo(minor[i + 2]!, minor[i + 3]!);
    }
    g.stroke({ width: 0.7, color: 0x5a5f52, alpha: 0.08 });
    for (let i = 0; i < major.length; i += 4) {
      g.moveTo(major[i]!, major[i + 1]!).lineTo(major[i + 2]!, major[i + 3]!);
    }
    g.stroke({ width: 1, color: 0x5a5f52, alpha: 0.16 });
  }

  private gridStepPx(): number {
    return this.map.pxPerKm ? Math.max(8, this.map.pxPerKm * this.map.grid.stepKm) : 100;
  }

  private layerState(id: LayerId): { visible: boolean; locked: boolean } {
    return this.map.layers.find((l) => l.id === id) ?? { visible: true, locked: false };
  }

  private regionVisible(region: MapRegion): boolean {
    return this.layerState(regionLayer(region.type)).visible;
  }

  private regionLocked(region: MapRegion): boolean {
    return this.layerState(regionLayer(region.type)).locked;
  }

  private rebuildRegions(): void {
    this.polyGfx.clear();
    for (const node of this.brushNodes.values()) node.destroy({ children: true });
    this.brushNodes.clear();

    for (const region of this.map.regions) {
      if (!this.regionVisible(region)) continue;
      const color = hexOf(region.color);
      if (region.shape.kind === 'polygon') {
        const pts = region.shape.points;
        if (pts.length < 3) continue;
        const flat: number[] = [];
        for (const p of pts) flat.push(p.x, p.y);
        this.polyGfx.poly(flat).fill({ color, alpha: 0.3 });
        this.polyGfx.poly(flat).stroke({ width: 2, color, alpha: 0.75 });
        if (region.id === this.selectedRegion) {
          this.polyGfx.poly(flat).stroke({ width: 3, color: INK, alpha: 0.95 });
          for (const p of pts) {
            this.polyGfx.circle(p.x, p.y, 3.4).fill({ color: 0xfffcf3, alpha: 1 });
            this.polyGfx.circle(p.x, p.y, 3.4).stroke({ width: 1.4, color: INK, alpha: 0.9 });
          }
        }
      } else {
        const node = new Container();
        for (const stamp of region.shape.stamps) {
          const sprite = new Sprite(softCircleTexture(stamp.hardness));
          sprite.anchor.set(0.5);
          sprite.position.set(stamp.x, stamp.y);
          sprite.width = stamp.r * 2;
          sprite.height = stamp.r * 2;
          sprite.tint = color;
          sprite.alpha = 0.32 * clamp(stamp.strength, 0.15, 1);
          node.addChild(sprite);
        }
        this.brushLayer.addChild(node);
        this.brushNodes.set(region.id, node);
      }
    }
    this.updateOverlay();
  }

  private rebuildPois(): void {
    this.poiLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!this.layerState('poi').visible) return;
    for (const poi of this.map.pois) {
      const badge = new Container();
      badge.position.set(poi.x, poi.y);
      const g = new Graphics();
      drawPoiMarker(g, poi);
      badge.addChild(g);
      this.poiLayer.addChild(badge);
    }
    this.updateOverlay();
  }

  private updateOverlay(): void {
    const g = this.overlayGfx;
    g.clear();
    if (!this.active) return;

    // 选中 POI 的影响半径
    const selPoi = this.selectedPoi !== null ? this.map.pois.find((p) => p.id === this.selectedPoi) : null;
    if (selPoi) {
      dashedCircle(g, selPoi.x, selPoi.y, poiMarkerBounds(selPoi.level ?? 3) + 7, hexOf(POI_META[selPoi.type].css), 1.6, 0.7);
    }

    // 选中笔刷区域：包围盒
    const selRegion = this.selectedRegion !== null ? this.map.regions.find((r) => r.id === this.selectedRegion) : null;
    if (selRegion && selRegion.shape.kind === 'brush') {
      const stamps = selRegion.shape.stamps;
      if (stamps.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const s of stamps) {
          minX = Math.min(minX, s.x - s.r);
          minY = Math.min(minY, s.y - s.r);
          maxX = Math.max(maxX, s.x + s.r);
          maxY = Math.max(maxY, s.y + s.r);
        }
        g.rect(minX, minY, maxX - minX, maxY - minY).stroke({ width: 1.4, color: INK, alpha: 0.55 });
      }
    }

    // 悬停 POI
    if (this.hoverPoi !== null) {
      const poi = this.map.pois.find((p) => p.id === this.hoverPoi);
      if (poi) g.circle(poi.x, poi.y, poiMarkerBounds(poi.level ?? 3) + 5).stroke({ width: 2, color: ACCENT, alpha: 0.55 });
    }

    // 悬停区域
    if (this.hoverRegion !== null && this.hoverRegion !== this.selectedRegion) {
      const region = this.map.regions.find((r) => r.id === this.hoverRegion);
      if (region && region.shape.kind === 'polygon' && region.shape.points.length >= 3) {
        const flat: number[] = [];
        for (const p of region.shape.points) flat.push(p.x, p.y);
        g.poly(flat).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      }
    }

    // 背景框
    if (this.tool === 'background' && this.map.background) {
      const bg = this.map.background;
      const rad = (bg.rotation * Math.PI) / 180;
      const w = (bg.width * bg.scale) / 2;
      const h = (bg.height * bg.scale) / 2;
      const corners: MapPoint[] = [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ].map((p) => ({
        x: bg.x + p.x * Math.cos(rad) - p.y * Math.sin(rad),
        y: bg.y + p.x * Math.sin(rad) + p.y * Math.cos(rad),
      }));
      const flat: number[] = [];
      for (const p of corners) flat.push(p.x, p.y);
      g.poly(flat).stroke({ width: 1.2, color: ACCENT, alpha: 0.7 });
      for (const p of corners) g.circle(p.x, p.y, 4).fill({ color: ACCENT, alpha: 0.8 });
    }

    // 进行中的多边形
    if (this.polygon.length > 0) {
      for (let i = 0; i < this.polygon.length; i++) {
        const p = this.polygon[i]!;
        if (i > 0) {
          const q = this.polygon[i - 1]!;
          g.moveTo(q.x, q.y).lineTo(p.x, p.y);
        }
        g.circle(p.x, p.y, 4).fill({ color: ACCENT, alpha: 0.9 });
      }
      if (this.pointer) {
        const last = this.polygon[this.polygon.length - 1]!;
        const dx = this.pointer.x - last.x;
        const dy = this.pointer.y - last.y;
        const len = Math.hypot(dx, dy);
        const steps = Math.min(30, Math.max(1, Math.floor(len / 16)));
        for (let i = 0; i < steps; i += 2) {
          const t0 = i / steps;
          const t1 = Math.min(1, (i + 1) / steps);
          g.moveTo(last.x + dx * t0, last.y + dy * t0);
          g.lineTo(last.x + dx * t1, last.y + dy * t1);
        }
      }
      g.stroke({ width: 2, color: ACCENT, alpha: 0.9 });
      if (this.polygon.length >= 3) {
        const first = this.polygon[0]!;
        g.circle(first.x, first.y, 9).stroke({ width: 2, color: WARM, alpha: 0.9 });
      }
    }

    // 校准线
    if (this.scaleLine) {
      const { a, b } = this.scaleLine;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: 2.2, color: WARM, alpha: 0.95 });
      g.circle(a.x, a.y, 4.5).fill({ color: WARM, alpha: 1 });
      g.circle(b.x, b.y, 4.5).fill({ color: WARM, alpha: 1 });
    }

    // 笔刷光标
    if (this.tool === 'brush' && this.pointer) {
      const color = this.brush.erase ? WARM : ACCENT;
      g.circle(this.pointer.x, this.pointer.y, this.brush.size / 2).stroke({ width: 1.4, color, alpha: 0.75 });
      g.circle(this.pointer.x, this.pointer.y, 2).fill({ color, alpha: 0.8 });
    }
  }

  private updateEmpty(): void {
    const hasContent = this.map.regions.length > 0 || this.map.pois.length > 0 || !!this.map.background;
    this.emptyEl.classList.toggle('hidden', hasContent);
  }

  // ————————————————————————— 状态 / 侧栏 —————————————————————————

  private updateStatus(): void {
    if (!this.active) return;
    const px = this.map.pxPerKm;
    this.statusScale.textContent = px ? `1 km = ${Math.round(px)} px` : '比例尺未校准';
    this.statusGrid.textContent = this.map.grid.enabled
      ? px
        ? `网格 ${this.map.grid.stepKm * 1000 >= 1000 ? `${this.map.grid.stepKm} km` : `${this.map.grid.stepKm * 1000} m`}`
        : '网格 100 px'
      : '网格关闭';
    this.statusCursor.textContent = this.pointer
      ? `x ${Math.round(this.pointer.x)} · y ${Math.round(this.pointer.y)}`
      : 'x — · y —';
    this.statusHint.textContent = this.toolHint();
    this.root.querySelector('[data-action="toggle-grid"]')?.classList.toggle('on', this.map.grid.enabled);
    this.scaleBar.classList.toggle('empty', !px);
    this.updateScaleBar();
  }

  private updateScaleBar(): void {
    const px = this.map.pxPerKm;
    if (!px) {
      this.scaleBar.innerHTML = '<span class="ed-scale-empty">比例尺未校准</span>';
      return;
    }
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10];
    let chosen = 1;
    for (const c of candidates) {
      const width = c * px * this.scene.scale;
      if (width >= 44) {
        chosen = c;
        break;
      }
    }
    const width = chosen * px * this.scene.scale;
    const label = chosen >= 1 ? `${chosen} km` : `${Math.round(chosen * 1000)} m`;
    this.scaleBar.innerHTML = `<i style="width:${Math.round(width)}px"></i><span>${label}</span>`;
  }

  private toolHint(): string {
    switch (this.tool) {
      case 'background':
        return this.map.background ? '拖动平移 · 滚轮缩放 · 面板调整旋转与透明度' : '先在右侧导入一张底图';
      case 'scale':
        return '按住左键拉一条已知长度的线，松开后输入公里数';
      case 'polygon':
        return '逐点点击；点击起点或按 Enter 闭合';
      case 'brush':
        return this.brush.erase ? '按住涂抹删除笔迹' : '按住拖动涂抹；重叠形成密度梯度';
      case 'poi':
        return '点击地图放置 POI；框选已有 POI 可拖动';
      default:
        return '点击区域或 POI 查看和修改属性';
    }
  }

  private renderPanel(): void {
    if (!this.active) return;
    const selRegion =
      this.selectedRegion !== null ? this.map.regions.find((r) => r.id === this.selectedRegion) ?? null : null;
    const selPoi = this.selectedPoi !== null ? this.map.pois.find((p) => p.id === this.selectedPoi) ?? null : null;
    const titles: Record<EditorTool, [string, string]> = {
      select: ['INSPECT', '选择与检查'],
      background: ['BASEMAP', '底图对齐'],
      scale: ['SCALE', '比例尺校准'],
      polygon: ['POLYGON', '多边形区域'],
      brush: ['BRUSH', '笔刷涂抹'],
      poi: ['POI', '兴趣点'],
    };
    const [kicker, title] = titles[this.tool];
    let body = '';
    switch (this.tool) {
      case 'select':
        body = selRegion
          ? `${this.regionPalette(selRegion.type)}${this.regionFields(selRegion)}${this.selectedRegionInfo(selRegion)}`
          : selPoi
            ? `${this.poiPalette(selPoi.type)}${this.poiFields(selPoi)}${this.selectedPoiInfo(selPoi)}`
            : '<p class="ed-help">点击区域或 POI 查看属性。拖动 POI 可移动，拖动底图可平移。</p>';
        break;
      case 'background':
        body = this.backgroundPanel();
        break;
      case 'scale':
        body = this.scalePanel();
        break;
      case 'polygon':
        body = `${this.regionPalette(selRegion?.type ?? this.regionType)}${this.regionFields(selRegion)}${this.selectedRegionInfo(selRegion)}<div class="ed-kv"><span>已放点</span><b>${this.polygon.length}</b></div><div class="ed-row"><button class="btn primary" data-action="poly-finish">完成区域</button><button class="btn ghost" data-action="poly-cancel">清空</button></div><p class="ed-help">逐点点击；点击起点或按 Enter 闭合。当前选中区域会被字段修改。</p>`;
        break;
      case 'brush':
        body = `${this.regionPalette(selRegion?.type ?? this.regionType)}${this.regionFields(selRegion)}<div class="ed-grid2"><label class="ed-field">笔刷大小 <b data-out="brush-size-out">${this.brush.size} px</b><input type="range" min="20" max="360" step="5" value="${this.brush.size}" data-prop="brush-size" /></label><label class="ed-field">硬度 <b data-out="brush-hardness-out">${Math.round(this.brush.hardness * 100)}%</b><input type="range" min="0" max="100" step="5" value="${Math.round(this.brush.hardness * 100)}" data-prop="brush-hardness" /></label></div><label class="ed-check"><input type="checkbox" data-prop="brush-erase" ${this.brush.erase ? 'checked' : ''}/> 擦除模式</label><div class="ed-row"><button class="btn ghost" data-action="brush-new">新建笔刷区域</button></div>${this.selectedRegionInfo(selRegion)}<p class="ed-help">按住拖动涂抹；重叠形成密度梯度，边缘自动衰减。笔迹按当前区域类型归层。</p>`;
        break;
      case 'poi':
        body = `${this.poiPalette(selPoi?.type ?? this.poiType)}${this.poiFields(selPoi)}${this.selectedPoiInfo(selPoi)}<p class="ed-help">点击地图放置 POI。医院 / 景区 / 火车站 / 渡口 / 学校会产生对应出行群体。</p>`;
        break;
    }
    const selection =
      this.tool !== 'background' && this.tool !== 'scale' && (selRegion || selPoi)
        ? `<button class="btn ghost small" data-action="deselect">取消选择</button>`
        : '';
    this.panel.innerHTML = `
      <div class="ed-panel-head">
        <div><div class="p-kicker">${kicker}</div><h3>${title}</h3></div>
        ${selection}
      </div>
      ${body}
      <div class="ed-mapinfo">${this.map.regions.length} 区域 · ${this.map.pois.length} POI · ${this.areaLabel()}</div>
      <button class="btn ghost small" data-action="new-map">新建空白地图</button>
    `;
  }

  private areaLabel(): string {
    const px = this.map.pxPerKm ?? DEFAULT_PX_PER_KM;
    let area = 0;
    for (const r of this.map.regions) area += regionAreaKm2(r, px);
    return `${area.toFixed(1)} km²`;
  }

  private regionPalette(active: RegionType): string {
    return `<div class="ed-palette">${REGION_ORDER.map(
      (t) =>
        `<button class="ed-type${t === active ? ' on' : ''}" data-region-type="${t}" title="${REGION_META[t].label}">
          <i style="background:${REGION_META[t].css}"></i><span>${REGION_META[t].label}</span>
        </button>`,
    ).join('')}</div>`;
  }

  private poiPalette(active: PoiType): string {
    return `<div class="ed-palette poi">${POI_ORDER.map(
      (t) =>
        `<button class="ed-type${t === active ? ' on' : ''}" data-poi-type="${t}" title="${POI_META[t].label}">
          <i class="ed-type-ico" style="color:${POI_META[t].css}">${icon(POI_META[t].icon, 14)}</i><span>${POI_META[t].label}</span>
        </button>`,
    ).join('')}</div>`;
  }

  private regionFields(sel: MapRegion | null): string {
    const type = sel?.type ?? this.regionType;
    const name = escapeHtml(sel?.name ?? this.regionName);
    const weight = sel?.weight ?? this.regionWeight;
    const color = sel?.color ?? this.regionColor;
    const layer = LAYER_LABELS[regionLayer(type)];
    return `
      <div class="ed-fields">
        <label class="ed-field">名称<input type="text" data-prop="region-name" value="${name}" placeholder="可选，例如：老城居住区" maxlength="30" /></label>
        <label class="ed-field">权重 <b data-out="region-weight-out">${weight.toFixed(1)}</b>
          <input type="range" min="0.2" max="3" step="0.1" value="${weight}" data-prop="region-weight" />
        </label>
        <label class="ed-field color">颜色<input type="color" data-prop="region-color" value="${color}" /></label>
        <div class="ed-kv"><span>所属层</span><b>${layer}</b></div>
      </div>`;
  }

  private poiFields(sel: MapPoi | null): string {
    const type = sel?.type ?? this.poiType;
    const radius = sel?.radiusKm ?? this.poiRadiusKm;
    const level = sel?.level ?? this.poiLevel;
    const scale = sel?.scale ?? this.poiScale;
    const profile = sel?.profile ?? this.poiProfile;
    const open = sel?.openMin ?? this.poiOpen;
    const close = sel?.closeMin ?? this.poiClose;
    const range = sel ? { dailyMin: sel.dailyMin, dailyMax: sel.dailyMax } : poiDailyRange(level, scale);
    return `
      <div class="ed-fields">
        <label class="ed-field">等级
          <select data-prop="poi-level">
            ${POI_LEVEL_ORDER.map(
              (l) =>
                `<option value="${l}" ${l === level ? 'selected' : ''}>${l} 级 · ${POI_LEVEL_META[l].label}</option>`,
            ).join('')}
          </select>
        </label>
        <div class="ed-kv"><span>预计日吸引</span><b data-out="poi-daily-out">${range.dailyMin}–${range.dailyMax} 人</b></div>
        <label class="ed-field">同级规模 <b data-out="poi-scale-out">${scale.toFixed(2)}</b>
          <input type="range" min="0.5" max="1.2" step="0.05" value="${scale}" data-prop="poi-scale" />
        </label>
        <label class="ed-field">时间画像
          <select data-prop="poi-profile">
            ${POI_PROFILE_ORDER.map(
              (p) =>
                `<option value="${p}" ${p === profile ? 'selected' : ''}>${POI_PROFILE_LABELS[p]}</option>`,
            ).join('')}
          </select>
        </label>
        <div class="ed-row">
          <label class="ed-field">开放<input type="time" data-prop="poi-open" value="${clockValue(open)}" /></label>
          <label class="ed-field">截止<input type="time" data-prop="poi-close" value="${clockValue(close)}" /></label>
        </div>
        <label class="ed-field">半径 <b data-out="poi-radius-out">${radius.toFixed(1)} km</b>
          <input type="range" min="0.2" max="10" step="0.1" value="${radius}" data-prop="poi-radius" />
        </label>
        <div class="ed-kv"><span>类型</span><b>${POI_META[type].label}</b></div>
      </div>`;
  }

  private selectedRegionInfo(region: MapRegion | null): string {
    if (!region) return '';
    const px = this.map.pxPerKm ?? DEFAULT_PX_PER_KM;
    const area = regionAreaKm2(region, px);
    const count =
      region.shape.kind === 'polygon' ? region.shape.points.length : region.shape.stamps.length;
    return `<div class="ed-sel">
      <div class="ed-sel-head"><b>${escapeHtml(region.name || REGION_META[region.type].label)}</b><span>${area.toFixed(2)} km²</span></div>
      <div class="ed-kv"><span>${region.shape.kind === 'polygon' ? '顶点' : '笔迹'}</span><b>${count}</b></div>
      <button class="btn danger small" data-action="delete-region">删除区域</button>
    </div>`;
  }

  private selectedPoiInfo(poi: MapPoi | null): string {
    if (!poi) return '';
    const group = POI_META[poi.type].group;
    return `<div class="ed-sel">
      <div class="ed-sel-head"><b>${escapeHtml(poi.name || POI_META[poi.type].label)}</b><span>${poi.level} 级 · ${POI_META[poi.type].label}</span></div>
      <div class="ed-kv"><span>预计日吸引</span><b>${poi.dailyMin}–${poi.dailyMax} 人</b></div>
      <div class="ed-kv"><span>时间画像</span><b>${POI_PROFILE_LABELS[poi.profile]} · ${clockValue(poi.openMin)}–${clockValue(poi.closeMin)}</b></div>
      <div class="ed-kv"><span>出行群体</span><b>${group === null ? '不产生' : GROUP_META.find((g) => g.id === group)?.name ?? `群体 ${group}`}</b></div>
      <button class="btn danger small" data-action="delete-poi">删除 POI</button>
    </div>`;
  }

  private backgroundPanel(): string {
    const bg = this.map.background;
    if (!bg) {
      return `<button class="btn primary" data-action="import-bg">导入 PNG / JPG</button>
        <p class="ed-help">建议使用一张真实地图或卫星图。导入后可降低透明度到 10–30%，再在上面绘制。</p>`;
    }
    const scalePct = Math.round(bg.scale * 100);
    return `
      <div class="ed-bgname">${escapeHtml(bg.filename || '参考底图')}<span>${bg.width} × ${bg.height}</span></div>
      <label class="ed-field">透明度 <b data-out="bg-opacity-out">${Math.round(bg.opacity * 100)}%</b>
        <input type="range" min="10" max="30" step="1" value="${Math.round(bg.opacity * 100)}" data-prop="bg-opacity" />
      </label>
      <label class="ed-field">旋转 <b data-out="bg-rotation-out">${Math.round(bg.rotation)}°</b>
        <input type="range" min="0" max="360" step="1" value="${Math.round(bg.rotation)}" data-prop="bg-rotation" />
      </label>
      <label class="ed-field">缩放 <b data-out="bg-scale-out">${scalePct}%</b>
        <input type="range" min="2" max="400" step="1" value="${Math.min(400, Math.max(2, scalePct))}" data-prop="bg-scale" />
      </label>
      <div class="ed-row">
        <button class="btn small" data-action="hide-bg">${bg.visible ? '隐藏' : '显示'}</button>
        <button class="btn small" data-action="center-bg">居中</button>
        <button class="btn small" data-action="fit-bg">适应画布</button>
        <button class="btn small ghost" data-action="remove-bg">移除</button>
      </div>
      <p class="ed-help">拖动地图平移底图；滚轮缩放；面板可旋转对齐。</p>`;
  }

  private scalePanel(): string {
    const px = this.map.pxPerKm;
    const walk = px ? customWalkRadius(px) / px : null;
    return `<p class="ed-help">在图上按住左键，从 A 拖到 B；松开后输入这段距离的实际公里数。比例尺会决定步行半径、POI 半径与区域面积。</p>
      <div class="ed-kv"><span>当前比例尺</span><b>${px ? `1 km = ${Math.round(px)} px` : '未校准'}</b></div>
      ${px ? `<div class="ed-kv"><span>换算步行半径</span><b>${walk!.toFixed(2)} km</b></div>` : ''}
      <div class="ed-kv"><span>网格</span><b>${this.map.grid.enabled ? '开启' : '关闭'}</b></div>
      <label class="ed-field">网格间距
        <select data-prop="grid-step">
          ${[0.25, 0.5, 1, 2]
            .map(
              (v) =>
                `<option value="${v}" ${Math.abs(v - this.map.grid.stepKm) < 0.01 ? 'selected' : ''}>${
                  v >= 1 ? `${v} km` : `${v * 1000} m`
                }</option>`,
            )
            .join('')}
        </select>
      </label>
      <div class="ed-row"><button class="btn ghost small" data-action="toggle-grid">${this.map.grid.enabled ? '关闭网格' : '开启网格'}</button><button class="btn ghost small" data-action="scale-clear">清除比例尺</button></div>
      <p class="ed-help">按 M 可随时切回本工具。</p>`;
  }

  private renderLayers(): void {
    this.layersEl.innerHTML = `<div class="ed-layers-head"><span>图层</span><span class="ed-layers-hint">显示 / 锁定</span></div>${LAYER_IDS.map(
      (id) => {
        const layer = this.layerState(id);
        return `<div class="ed-layer${layer.visible ? '' : ' is-off'}">
          <span class="ed-layer-dot"></span>
          <span class="ed-layer-name">${LAYER_LABELS[id]}</span>
          <button class="icon-btn small" data-layer="${id}" data-layer-toggle="visible" title="${layer.visible ? '隐藏' : '显示'}">${icon(layer.visible ? 'eye' : 'close', 14)}</button>
          <button class="icon-btn small${layer.locked ? ' on' : ''}" data-layer="${id}" data-layer-toggle="locked" title="${layer.locked ? '解锁' : '锁定'}">${icon(layer.locked ? 'lock' : 'unlock', 14)}</button>
        </div>`;
      },
    ).join('')}`;
  }

  // ————————————————————————— 事件 —————————————————————————

  private onPointerDown(ev: PointerEvent): void {
    if (!this.active || this.isModalOpen()) return;
    const p = this.toWorld(ev);
    this.pointer = p;
    this.pointerScreen = this.toScreen(ev);
    if (ev.button !== 0) return;

    if (this.tool === 'background') {
      const bg = this.map.background;
      if (!bg) {
        this.toast('先导入一张底图', 'warn');
        return;
      }
      this.drag = { kind: 'background', start: p, baseX: bg.x, baseY: bg.y };
      this.app.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.tool === 'scale') {
      this.scaleLine = { a: p, b: p };
      this.drag = { kind: 'scale' };
      return;
    }
    if (this.tool === 'polygon') {
      if (this.polygon.length >= 3) {
        const first = this.polygon[0]!;
        if (Math.hypot(p.x - first.x, p.y - first.y) < 14) {
          this.finishPolygon();
          return;
        }
      }
      this.polygon.push(p);
      this.updateOverlay();
      this.renderPanel();
      return;
    }
    if (this.tool === 'brush') {
      this.beginBrush(p);
      return;
    }
    if (this.tool === 'poi') {
      const hit = this.hitPoiAt(p);
      if (hit) {
        this.selectPoi(hit.id);
        this.drag = { kind: 'poi', id: hit.id, start: p, baseX: hit.x, baseY: hit.y };
        return;
      }
      this.placePoi(p);
      return;
    }

    // select
    const poi = this.hitPoiAt(p);
    if (poi) {
      this.selectPoi(poi.id);
      if (!this.layerState('poi').locked) {
        this.drag = { kind: 'poi', id: poi.id, start: p, baseX: poi.x, baseY: poi.y };
      }
      return;
    }
    const region = this.hitRegionAt(p);
    if (region) {
      this.selectedRegion = region.id;
      this.selectedPoi = null;
      this.brushRegionId = region.shape.kind === 'brush' ? region.id : null;
      this.renderPanel();
      this.updateOverlay();
      return;
    }
    this.clearSelection();
  }

  private onPointerMove(ev: PointerEvent): void {
    if (!this.active) return;
    const p = this.toWorld(ev);
    this.pointer = p;
    this.pointerScreen = this.toScreen(ev);
    const drag = this.drag;
    if (drag) {
      if (drag.kind === 'background' && this.map.background) {
        this.map.background.x = drag.baseX + (p.x - drag.start.x);
        this.map.background.y = drag.baseY + (p.y - drag.start.y);
        this.applyBgTransform();
      } else if (drag.kind === 'poi') {
        const poi = this.map.pois.find((x) => x.id === drag.id);
        if (poi) {
          poi.x = drag.baseX + (p.x - drag.start.x);
          poi.y = drag.baseY + (p.y - drag.start.y);
          this.rebuildPois();
        }
      } else if (drag.kind === 'scale' && this.scaleLine) {
        this.scaleLine.b = p;
        this.updateOverlay();
        const len = Math.hypot(p.x - this.scaleLine.a.x, p.y - this.scaleLine.a.y);
        this.statusHint.textContent = `线长 ${Math.round(len)} px`;
      } else if (drag.kind === 'brush') {
        if (this.brush.erase) {
          this.eraseAt(p);
        } else {
          const dist = Math.hypot(p.x - drag.last.x, p.y - drag.last.y);
          const step = Math.max(4, this.brush.size * 0.16);
          if (dist >= step) {
            const n = Math.min(24, Math.floor(dist / step));
            for (let i = 1; i <= n; i++) {
              const t = i / n;
              this.addBrushStamp({
                x: drag.last.x + (p.x - drag.last.x) * t,
                y: drag.last.y + (p.y - drag.last.y) * t,
              });
            }
            drag.last = p;
            drag.moved = true;
          }
        }
      }
      this.updateStatus();
      return;
    }
    if (this.tool === 'select') {
      const poi = this.hitPoiAt(p);
      const region = poi ? null : this.hitRegionAt(p);
      this.hoverPoi = poi?.id ?? null;
      this.hoverRegion = region?.id ?? null;
      this.app.canvas.style.cursor = poi || region ? 'pointer' : 'default';
      this.updateOverlay();
    } else if (this.tool === 'poi') {
      const poi = this.hitPoiAt(p);
      this.hoverPoi = poi?.id ?? null;
      this.app.canvas.style.cursor = 'crosshair';
      this.updateOverlay();
    } else {
      this.hoverPoi = null;
      this.hoverRegion = null;
      this.updateOverlay();
    }
    this.updateStatus();
  }

  private onPointerUp(ev: PointerEvent): void {
    if (!this.active) return;
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind === 'background') {
      this.app.canvas.style.cursor = 'grab';
      this.scheduleSave();
      this.renderPanel();
    } else if (drag?.kind === 'poi') {
      this.scheduleSave();
      this.renderPanel();
    } else if (drag?.kind === 'scale') {
      const line = this.scaleLine;
      this.scaleLine = null;
      if (line) {
        const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
        if (len >= 8) this.openScaleDialog(len);
        else this.toast('线太短，请重新拉一条', 'warn');
      }
      this.updateOverlay();
    } else if (drag?.kind === 'brush') {
      this.scheduleSave();
      this.renderPanel();
    }
    void ev;
  }

  private onWheel(ev: WheelEvent): void {
    if (!this.active || this.tool !== 'background' || !this.map.background) return;
    ev.preventDefault();
    const bg = this.map.background;
    const factor = Math.exp(-ev.deltaY * 0.0012);
    bg.scale = clamp(bg.scale * factor, 0.02, 8);
    this.applyBgTransform();
    this.updateStatus();
    this.scheduleSave();
    this.renderPanel();
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.active) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (this.isModalOpen()) {
      if (ev.code === 'Escape') this.closeModal();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.code === 'KeyZ') {
      ev.preventDefault();
      this.undo();
      return;
    }
    switch (ev.code) {
      case 'Escape':
        if (this.polygon.length > 0) {
          this.polygon = [];
          this.updateOverlay();
          this.renderPanel();
        } else if (this.tool !== 'select') {
          this.setTool('select');
        } else if (this.selectedRegion !== null || this.selectedPoi !== null) {
          this.clearSelection();
        }
        break;
      case 'Enter':
        if (this.tool === 'polygon' && this.polygon.length >= 3) this.finishPolygon();
        break;
      case 'Backspace':
      case 'Delete':
        ev.preventDefault();
        if (this.selectedRegion !== null) this.deleteRegion();
        else if (this.selectedPoi !== null) this.deletePoi();
        break;
      case 'KeyV':
        this.setTool('select');
        break;
      case 'KeyG':
        this.setTool('background');
        break;
      case 'KeyM':
        this.setTool('scale');
        break;
      case 'KeyP':
        this.setTool('polygon');
        break;
      case 'KeyB':
        this.setTool('brush');
        break;
      case 'KeyO':
        this.setTool('poi');
        break;
      default:
        break;
    }
  }

  private onRootClick(ev: MouseEvent): void {
    if (!this.active) return;
    const target = ev.target as HTMLElement;
    const toolBtn = target.closest<HTMLElement>('[data-tool]');
    if (toolBtn) {
      this.setTool(toolBtn.dataset.tool as EditorTool);
      return;
    }
    const regionType = target.closest<HTMLElement>('[data-region-type]');
    if (regionType) {
      this.applyRegionType(regionType.dataset.regionType as RegionType);
      return;
    }
    const poiType = target.closest<HTMLElement>('[data-poi-type]');
    if (poiType) {
      this.applyPoiType(poiType.dataset.poiType as PoiType);
      return;
    }
    const layerBtn = target.closest<HTMLElement>('[data-layer-toggle]');
    if (layerBtn) {
      this.toggleLayer(layerBtn.dataset.layer as LayerId, layerBtn.dataset.layerToggle as 'visible' | 'locked');
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action) this.handleAction(action);
  }

  private onRootInput(ev: Event): void {
    if (!this.active) return;
    const target = ev.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'ed-name') {
      this.map.name = (target as HTMLInputElement).value;
      this.scheduleSave();
      return;
    }
    const prop = target.dataset?.prop;
    if (!prop) return;
    this.handleProp(prop, target);
  }

  private handleProp(prop: string, input: HTMLInputElement | HTMLSelectElement): void {
    const num = Number((input as HTMLInputElement).value);
    const isCheckbox = (input as HTMLInputElement).type === 'checkbox';
    const checked = isCheckbox ? (input as HTMLInputElement).checked : false;
    const selRegion =
      this.selectedRegion !== null ? this.map.regions.find((r) => r.id === this.selectedRegion) ?? null : null;
    const selPoi = this.selectedPoi !== null ? this.map.pois.find((p) => p.id === this.selectedPoi) ?? null : null;
    switch (prop) {
      case 'bg-opacity': {
        if (!this.map.background) break;
        this.map.background.opacity = clamp(num / 100, 0.1, 0.3);
        this.out('bg-opacity-out', `${Math.round(this.map.background.opacity * 100)}%`);
        this.applyBgTransform();
        this.scheduleSave();
        break;
      }
      case 'bg-rotation': {
        if (!this.map.background) break;
        this.map.background.rotation = ((num % 360) + 360) % 360;
        this.out('bg-rotation-out', `${Math.round(this.map.background.rotation)}°`);
        this.applyBgTransform();
        this.scheduleSave();
        break;
      }
      case 'bg-scale': {
        if (!this.map.background) break;
        this.map.background.scale = clamp(num / 100, 0.02, 8);
        this.out('bg-scale-out', `${Math.round(this.map.background.scale * 100)}%`);
        this.applyBgTransform();
        this.scheduleSave();
        break;
      }
      case 'region-name': {
        const value = (input as HTMLInputElement).value;
        if (selRegion) selRegion.name = value;
        else this.regionName = value;
        this.scheduleSave();
        break;
      }
      case 'region-weight': {
        const value = clamp(num, 0.1, 3);
        if (selRegion) selRegion.weight = value;
        else this.regionWeight = value;
        this.out('region-weight-out', value.toFixed(1));
        this.scheduleSave();
        break;
      }
      case 'region-color': {
        const value = (input as HTMLInputElement).value;
        if (selRegion) selRegion.color = value;
        else this.regionColor = value;
        this.rebuildRegions();
        this.scheduleSave();
        break;
      }
      case 'brush-size': {
        this.brush.size = clamp(num, 10, 400);
        this.out('brush-size-out', `${Math.round(this.brush.size)} px`);
        this.updateOverlay();
        break;
      }
      case 'brush-hardness': {
        this.brush.hardness = clamp(num / 100, 0, 1);
        this.out('brush-hardness-out', `${Math.round(this.brush.hardness * 100)}%`);
        break;
      }
      case 'brush-erase':
        this.brush.erase = checked;
        this.renderPanel();
        break;
      case 'poi-radius': {
        const value = clamp(num, 0.1, 20);
        if (selPoi) selPoi.radiusKm = value;
        else this.poiRadiusKm = value;
        this.out('poi-radius-out', `${value.toFixed(1)} km`);
        this.rebuildPois();
        this.scheduleSave();
        break;
      }
      case 'poi-scale': {
        const value = clamp(num, 0.5, 1.2);
        if (selPoi) applyPoiScale(selPoi, value);
        else this.poiScale = value;
        this.out('poi-scale-out', value.toFixed(2));
        const range = selPoi
          ? { dailyMin: selPoi.dailyMin, dailyMax: selPoi.dailyMax }
          : poiDailyRange(this.poiLevel, value);
        this.out('poi-daily-out', `${range.dailyMin}–${range.dailyMax} 人`);
        this.scheduleSave();
        break;
      }
      case 'poi-level': {
        const level = clamp(Math.round(num), 1, 6) as PoiLevel;
        if (level === 6) {
          const others = this.map.pois.filter((p) => p.id !== selPoi?.id && p.level === 6).length;
          if (others >= 2) {
            this.toast('一张地图最多 2 个 6 级 POI', 'warn');
            this.renderPanel();
            return;
          }
        }
        const radius = POI_LEVEL_META[level].radiusKm;
        if (selPoi) {
          applyPoiLevel(selPoi, level);
          this.poiRadiusKm = selPoi.radiusKm;
          const range = { dailyMin: selPoi.dailyMin, dailyMax: selPoi.dailyMax };
          this.out('poi-daily-out', `${range.dailyMin}–${range.dailyMax} 人`);
        } else {
          this.poiLevel = level;
          this.poiRadiusKm = radius;
          const range = poiDailyRange(level, this.poiScale);
          this.out('poi-daily-out', `${range.dailyMin}–${range.dailyMax} 人`);
        }
        this.out('poi-radius-out', `${radius.toFixed(1)} km`);
        const radiusInput = this.root.querySelector<HTMLInputElement>('[data-prop="poi-radius"]');
        if (radiusInput) radiusInput.value = String(radius);
        this.rebuildPois();
        this.scheduleSave();
        break;
      }
      case 'poi-profile': {
        const value = input.value as PoiTimeProfile;
        if (selPoi) selPoi.profile = value;
        else this.poiProfile = value;
        this.scheduleSave();
        break;
      }
      case 'poi-open':
      case 'poi-close': {
        const key = input.dataset.prop === 'poi-open' ? 'openMin' : 'closeMin';
        const value = parseClock(input.value, key === 'openMin' ? 480 : 1020);
        if (selPoi) selPoi[key] = value;
        else if (key === 'openMin') this.poiOpen = value;
        else this.poiClose = value;
        if (selPoi && selPoi.closeMin <= selPoi.openMin) {
          if (key === 'openMin') selPoi.openMin = selPoi.closeMin - 1;
          else selPoi.closeMin = selPoi.openMin + 1;
        } else if (!selPoi && this.poiClose <= this.poiOpen) {
          if (key === 'openMin') this.poiOpen = this.poiClose - 1;
          else this.poiClose = this.poiOpen + 1;
        }
        this.scheduleSave();
        break;
      }
      case 'grid-step': {
        this.map.grid.stepKm = clamp(num, 0.05, 20);
        this.rebuildGrid();
        this.updateStatus();
        this.scheduleSave();
        break;
      }
      default:
        break;
    }
  }

  private out(key: string, value: string): void {
    const el = this.root.querySelector(`[data-out="${key}"]`);
    if (el) el.textContent = value;
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'back':
        void this.game.closeEditor();
        break;
      case 'undo':
        this.undo();
        break;
      case 'save':
        void this.save();
        break;
      case 'export':
        this.openExport();
        break;
      case 'import':
        this.mapInput.click();
        break;
      case 'play':
        this.play();
        break;
      case 'import-bg':
        this.bgInput.click();
        break;
      case 'hide-bg':
        if (this.map.background) {
          this.map.background.visible = !this.map.background.visible;
          this.applyBgTransform();
          this.renderPanel();
          this.scheduleSave();
        }
        break;
      case 'center-bg':
        if (this.map.background) {
          this.map.background.x = WORLD_W / 2;
          this.map.background.y = WORLD_H / 2;
          this.applyBgTransform();
          this.scheduleSave();
        }
        break;
      case 'fit-bg':
        this.fitBackground();
        break;
      case 'remove-bg':
        void this.confirm('移除底图', '底图只是参考图，移除不会删除已绘制的区域和 POI。', '移除', true).then((ok) => {
          if (!ok) return;
          this.map.background = null;
          this.bgImage = null;
          this.bgTexture = null;
          this.rebuildBackground();
          this.renderPanel();
          this.updateStatus();
          this.scheduleSave();
        });
        break;
      case 'poly-finish':
        this.finishPolygon();
        break;
      case 'poly-cancel':
        this.polygon = [];
        this.updateOverlay();
        this.renderPanel();
        break;
      case 'brush-new':
        this.brushRegionId = null;
        this.toast('下一次涂抹会新建一个区域', 'info');
        break;
      case 'delete-region':
        this.deleteRegion();
        break;
      case 'delete-poi':
        this.deletePoi();
        break;
      case 'deselect':
        this.clearSelection();
        break;
      case 'scale-clear':
        this.map.pxPerKm = null;
        this.updateStatus();
        this.rebuildGrid();
        this.renderPanel();
        this.scheduleSave();
        break;
      case 'toggle-grid':
        this.map.grid.enabled = !this.map.grid.enabled;
        this.rebuildGrid();
        this.updateStatus();
        this.renderPanel();
        this.scheduleSave();
        break;
      case 'quick-start':
        this.emptyEl.classList.add('hidden');
        this.setTool('polygon');
        break;
      case 'new-map':
        void this.confirm('新建空白地图', '当前地图内容会被清空。建议先导出备份。', '新建', true).then((ok) => {
          if (!ok) return;
          this.map = createBlankMap();
          this.normalizeMap();
          this.resetIds();
          this.bgImage = null;
          this.bgTexture = null;
          this.bgSprite = null;
          this.selectedRegion = null;
          this.selectedPoi = null;
          this.polygon = [];
          this.undoStack = [];
          this.nameInput.value = this.map.name;
          this.rebuildAll();
          this.renderPanel();
          this.renderLayers();
          this.scheduleSave();
        });
        break;
      case 'modal-close':
        this.closeModal();
        break;
      case 'scale-apply':
        this.applyScale();
        break;
      case 'scale-cancel':
        this.closeModal();
        break;
      case 'export-confirm':
        this.doExport();
        break;
      default:
        break;
    }
  }

  // ————————————————————————— 选择 / 区域 —————————————————————————

  private setTool(tool: EditorTool): void {
    if (tool === this.tool) {
      this.renderPanel();
      return;
    }
    if (this.tool === 'polygon') this.polygon = [];
    this.tool = tool;
    this.scaleLine = null;
    this.app.canvas.style.cursor =
      tool === 'background' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-tool]')) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    }
    this.renderPanel();
    this.updateStatus();
    this.updateOverlay();
    if (tool === 'background' && !this.map.background) {
      this.toast('先导入一张底图，再调整对齐', 'info');
    }
  }

  private applyRegionType(type: RegionType): void {
    this.regionType = type;
    this.regionColor = REGION_META[type].css;
    this.brushRegionId = null;
    const sel =
      this.selectedRegion !== null ? this.map.regions.find((r) => r.id === this.selectedRegion) ?? null : null;
    if (sel) {
      this.pushUndo();
      sel.type = type;
      sel.color = REGION_META[type].css;
      this.rebuildRegions();
      this.scheduleSave();
    }
    this.renderPanel();
    this.renderLayers();
  }

  private applyPoiType(type: PoiType): void {
    if (
      POI_META[type].level === 6 &&
      this.map.pois.filter((p) => p.id !== this.selectedPoi && p.level === 6).length >= 2
    ) {
      this.toast('一张地图最多 2 个 6 级 POI', 'warn');
      return;
    }
    this.poiType = type;
    this.poiRadiusKm = POI_META[type].radiusKm;
    this.poiLevel = POI_META[type].level;
    this.poiScale = 1;
    this.poiProfile = POI_META[type].profile;
    this.poiOpen = POI_META[type].openMin;
    this.poiClose = POI_META[type].closeMin;
    const sel = this.selectedPoi !== null ? this.map.pois.find((p) => p.id === this.selectedPoi) ?? null : null;
    if (sel) {
      this.pushUndo();
      sel.type = type;
      sel.name = POI_META[type].label;
      sel.radiusKm = POI_META[type].radiusKm;
      sel.level = POI_META[type].level;
      sel.scale = 1;
      sel.profile = POI_META[type].profile;
      sel.openMin = POI_META[type].openMin;
      sel.closeMin = POI_META[type].closeMin;
      const range = poiDailyRange(sel.level, sel.scale);
      sel.dailyMin = range.dailyMin;
      sel.dailyMax = range.dailyMax;
      this.rebuildPois();
      this.scheduleSave();
    }
    this.renderPanel();
  }

  private finishPolygon(): void {
    if (this.polygon.length < 3) {
      this.toast('多边形至少需要 3 个点', 'warn');
      return;
    }
    const layer = regionLayer(this.regionType);
    if (this.layerState(layer).locked) {
      this.toast(`${LAYER_LABELS[layer]}已锁定，请先解锁`, 'warn');
      return;
    }
    this.pushUndo();
    const region: MapRegion = {
      id: this.nextRegionId++,
      type: this.regionType,
      name: this.regionName.trim(),
      weight: this.regionWeight,
      color: this.regionColor,
      shape: { kind: 'polygon', points: this.polygon },
    };
    this.map.regions.push(region);
    this.selectedRegion = region.id;
    this.selectedPoi = null;
    this.polygon = [];
    this.rebuildRegions();
    this.renderPanel();
    this.updateStatus();
    this.scheduleSave();
    this.toast(`已添加${REGION_META[region.type].label}`, 'success');
  }

  private beginBrush(p: MapPoint): void {
    const layer = regionLayer(this.regionType);
    if (this.layerState(layer).locked) {
      this.toast(`${LAYER_LABELS[layer]}已锁定，请先解锁`, 'warn');
      return;
    }
    if (this.brush.erase) {
      const target = this.selectedRegion !== null
        ? this.map.regions.find((r) => r.id === this.selectedRegion && r.shape.kind === 'brush')
        : this.findBrushRegionAt(p);
      if (!target) {
        this.toast('没有可擦除的笔迹', 'info');
        return;
      }
      this.pushUndo();
      this.eraseAt(p);
      this.drag = { kind: 'brush', last: p, moved: false };
      return;
    }
    this.pushUndo();
    let region =
      this.brushRegionId !== null
        ? this.map.regions.find((r) => r.id === this.brushRegionId && r.shape.kind === 'brush') ?? null
        : null;
    if (!region || region.type !== this.regionType) {
      region = {
        id: this.nextRegionId++,
        type: this.regionType,
        name: this.regionName.trim(),
        weight: this.regionWeight,
        color: this.regionColor,
        shape: { kind: 'brush', stamps: [] },
      };
      this.map.regions.push(region);
      this.brushRegionId = region.id;
      this.selectedRegion = region.id;
      this.selectedPoi = null;
      this.rebuildRegions();
    }
    this.addBrushStamp(p);
    this.drag = { kind: 'brush', last: p, moved: true };
    this.renderPanel();
  }

  private addBrushStamp(p: MapPoint): void {
    const region =
      this.brushRegionId !== null
        ? this.map.regions.find((r) => r.id === this.brushRegionId && r.shape.kind === 'brush')
        : null;
    if (!region || region.shape.kind !== 'brush') return;
    const stamp = {
      x: p.x,
      y: p.y,
      r: Math.max(6, this.brush.size / 2),
      strength: 1,
      hardness: this.brush.hardness,
    };
    region.shape.stamps.push(stamp);
    let node = this.brushNodes.get(region.id);
    if (!node) {
      node = new Container();
      this.brushLayer.addChild(node);
      this.brushNodes.set(region.id, node);
      for (const s of region.shape.stamps) this.addStampSprite(node, region.color, s);
    } else {
      this.addStampSprite(node, region.color, stamp);
    }
    this.updateOverlay();
  }

  private addStampSprite(node: Container, color: string, stamp: { x: number; y: number; r: number; strength: number; hardness: number }): void {
    const sprite = new Sprite(softCircleTexture(stamp.hardness));
    sprite.anchor.set(0.5);
    sprite.position.set(stamp.x, stamp.y);
    sprite.width = stamp.r * 2;
    sprite.height = stamp.r * 2;
    sprite.tint = hexOf(color);
    sprite.alpha = 0.32 * clamp(stamp.strength, 0.15, 1);
    node.addChild(sprite);
  }

  private eraseAt(p: MapPoint): void {
    const region =
      this.selectedRegion !== null
        ? this.map.regions.find((r) => r.id === this.selectedRegion && r.shape.kind === 'brush')
        : this.findBrushRegionAt(p);
    if (!region || region.shape.kind !== 'brush') return;
    const radius = Math.max(6, this.brush.size / 2);
    const before = region.shape.stamps.length;
    region.shape.stamps = region.shape.stamps.filter((s) => Math.hypot(s.x - p.x, s.y - p.y) > radius + s.r * 0.35);
    if (region.shape.stamps.length === before) return;
    if (region.shape.stamps.length === 0) {
      this.map.regions = this.map.regions.filter((r) => r.id !== region.id);
      if (this.selectedRegion === region.id) this.selectedRegion = null;
      if (this.brushRegionId === region.id) this.brushRegionId = null;
    }
    this.rebuildRegions();
    this.renderPanel();
    this.scheduleSave();
  }

  private findBrushRegionAt(p: MapPoint): MapRegion | null {
    for (let i = this.map.regions.length - 1; i >= 0; i--) {
      const region = this.map.regions[i]!;
      if (region.shape.kind !== 'brush' || !this.regionVisible(region) || this.regionLocked(region)) continue;
      for (const s of region.shape.stamps) {
        if (Math.hypot(s.x - p.x, s.y - p.y) <= s.r) return region;
      }
    }
    return null;
  }

  private hitPoiAt(p: MapPoint): MapPoi | null {
    if (!this.layerState('poi').visible) return null;
    let best: MapPoi | null = null;
    let bestD = 18;
    for (const poi of this.map.pois) {
      const d = Math.hypot(poi.x - p.x, poi.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = poi;
      }
    }
    return best;
  }

  private hitRegionAt(p: MapPoint): MapRegion | null {
    for (let i = this.map.regions.length - 1; i >= 0; i--) {
      const region = this.map.regions[i]!;
      if (!this.regionVisible(region) || this.regionLocked(region)) continue;
      if (hitRegion(region, p.x, p.y, 6)) return region;
    }
    return null;
  }

  private selectPoi(id: number): void {
    this.selectedPoi = id;
    this.selectedRegion = null;
    this.brushRegionId = null;
    const poi = this.map.pois.find((p) => p.id === id) ?? null;
    if (poi) {
      this.poiType = poi.type;
      this.poiRadiusKm = poi.radiusKm;
      this.poiLevel = poi.level;
      this.poiScale = poi.scale;
      this.poiProfile = poi.profile;
      this.poiOpen = poi.openMin;
      this.poiClose = poi.closeMin;
    }
    this.renderPanel();
    this.updateOverlay();
  }

  private placePoi(p: MapPoint): void {
    if (this.layerState('poi').locked) {
      this.toast('POI 层已锁定，请先解锁', 'warn');
      return;
    }
    if (this.poiLevel === 6 && this.map.pois.filter((poi) => poi.level === 6).length >= 2) {
      this.toast('一张地图最多 2 个 6 级 POI', 'warn');
      return;
    }
    this.pushUndo();
    const poi = makePoi(this.poiType, p.x, p.y, this.nextPoiId++);
    poi.radiusKm = this.poiRadiusKm;
    poi.level = this.poiLevel;
    poi.scale = this.poiScale;
    poi.profile = this.poiProfile;
    poi.openMin = this.poiOpen;
    poi.closeMin = this.poiClose;
    const range = poiDailyRange(poi.level, poi.scale);
    poi.dailyMin = range.dailyMin;
    poi.dailyMax = range.dailyMax;
    this.map.pois.push(poi);
    this.selectedPoi = poi.id;
    this.selectedRegion = null;
    this.rebuildPois();
    this.renderPanel();
    this.scheduleSave();
    this.toast(`已放置${POI_META[poi.type].label}`, 'success');
  }

  private deleteRegion(): void {
    if (this.selectedRegion === null) return;
    const id = this.selectedRegion;
    this.pushUndo();
    this.map.regions = this.map.regions.filter((r) => r.id !== id);
    if (this.brushRegionId === id) this.brushRegionId = null;
    this.selectedRegion = null;
    this.rebuildRegions();
    this.renderPanel();
    this.updateStatus();
    this.scheduleSave();
  }

  private deletePoi(): void {
    if (this.selectedPoi === null) return;
    const id = this.selectedPoi;
    this.pushUndo();
    this.map.pois = this.map.pois.filter((p) => p.id !== id);
    this.selectedPoi = null;
    this.rebuildPois();
    this.renderPanel();
    this.scheduleSave();
  }

  private clearSelection(): void {
    this.selectedRegion = null;
    this.selectedPoi = null;
    this.brushRegionId = null;
    this.renderPanel();
    this.updateOverlay();
  }

  private toggleLayer(id: LayerId, what: 'visible' | 'locked'): void {
    const layer = this.map.layers.find((l) => l.id === id);
    if (!layer) return;
    if (what === 'visible') {
      layer.visible = !layer.visible;
      if (!layer.visible) {
        if (this.selectedRegion !== null) {
          const region = this.map.regions.find((r) => r.id === this.selectedRegion);
          if (region && regionLayer(region.type) === id) this.selectedRegion = null;
        }
        if (id === 'poi') this.selectedPoi = null;
      }
    } else {
      layer.locked = !layer.locked;
      if (layer.locked) {
        if (this.selectedRegion !== null) {
          const region = this.map.regions.find((r) => r.id === this.selectedRegion);
          if (region && regionLayer(region.type) === id) this.selectedRegion = null;
        }
        if (id === 'poi') this.selectedPoi = null;
      }
    }
    this.rebuildRegions();
    this.rebuildPois();
    this.renderLayers();
    this.renderPanel();
    this.updateEmpty();
    this.scheduleSave();
  }

  private pushUndo(): void {
    this.undoStack.push(cloneMap(this.map, false));
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  private undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      this.toast('没有可撤销的操作', 'info');
      return;
    }
    const dataUrl = this.map.background?.dataUrl ?? null;
    this.map = snapshot;
    if (this.map.background) this.map.background.dataUrl = dataUrl;
    this.normalizeMap();
    this.resetIds();
    this.selectedRegion = null;
    this.selectedPoi = null;
    this.polygon = [];
    this.brushRegionId = null;
    this.nameInput.value = this.map.name;
    this.rebuildAll();
    this.renderPanel();
    this.renderLayers();
    this.scheduleSave();
  }

  // ————————————————————————— 底图 —————————————————————————

  private async importBackground(): Promise<void> {
    const file = this.bgInput.files?.[0];
    this.bgInput.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      this.toast('只支持 PNG / JPG', 'warn');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      this.toast('图片超过 12MB，请压缩后再试', 'warn');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) {
      this.toast('读取图片失败', 'warn');
      return;
    }
    await this.setBackground(dataUrl, file.name);
  }

  private async setBackground(dataUrl: string, filename: string): Promise<void> {
    await this.loadBgImage(dataUrl);
    const img = this.bgImage;
    if (!img) return;
    const fit = Math.min((WORLD_W * 0.92) / img.naturalWidth, (WORLD_H * 0.92) / img.naturalHeight);
    this.map.background = {
      x: WORLD_W / 2,
      y: WORLD_H / 2,
      scale: clamp(fit, 0.02, 8),
      rotation: 0,
      opacity: 0.25,
      visible: true,
      width: img.naturalWidth,
      height: img.naturalHeight,
      filename,
      dataUrl,
    };
    this.undoStack = [];
    this.rebuildBackground();
    this.updateStatus();
    this.renderPanel();
    this.updateEmpty();
    this.scheduleSave();
    this.toast('底图已导入，可拖动对齐并调整透明度', 'success');
  }

  private async loadBgImage(dataUrl: string): Promise<void> {
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    await img.decode();
    this.bgImage = img;
    this.bgTexture = Texture.from(img);
  }

  private fitBackground(): void {
    const bg = this.map.background;
    const img = this.bgImage;
    if (!bg || !img) return;
    bg.scale = clamp(Math.min((WORLD_W * 0.92) / img.naturalWidth, (WORLD_H * 0.92) / img.naturalHeight), 0.02, 8);
    bg.x = WORLD_W / 2;
    bg.y = WORLD_H / 2;
    this.applyBgTransform();
    this.renderPanel();
    this.scheduleSave();
  }

  // ————————————————————————— 比例尺 —————————————————————————

  private openScaleDialog(lengthPx: number): void {
    this.calibrateLength = lengthPx;
    this.openModal(`
      <div class="ed-modal">
        <div class="p-kicker">CALIBRATE</div>
        <h3>这段距离代表多少公里？</h3>
        <p class="ed-help">线段长度 ${Math.round(lengthPx)} px。输入真实距离后，游戏会用这个比例尺换算步行半径、POI 半径和区域面积。</p>
        <label class="ed-field">距离（公里）
          <input id="ed-km" type="number" min="0.05" max="200" step="0.05" value="1" autofocus />
        </label>
        <div class="ed-modal-actions">
          <button class="btn ghost" data-action="scale-cancel">取消</button>
          <button class="btn primary" data-action="scale-apply">确定比例尺</button>
        </div>
      </div>
    `);
  }

  private applyScale(): void {
    const input = this.modalEl.querySelector<HTMLInputElement>('#ed-km');
    const km = Number(input?.value);
    if (!(km > 0)) {
      this.toast('请输入大于 0 的公里数', 'warn');
      return;
    }
    const px = clamp(this.calibrateLength / km, 1, 5000);
    this.pushUndo();
    this.map.pxPerKm = px;
    this.closeModal();
    this.rebuildGrid();
    this.updateStatus();
    this.renderPanel();
    this.scheduleSave();
    this.toast(`比例尺已设为 1 km = ${Math.round(px)} px`, 'success');
  }

  // ————————————————————————— 导入 / 导出 / 保存 —————————————————————————

  private async save(): Promise<void> {
    this.map.updatedAt = Date.now();
    try {
      await saveMap(this.map);
      await saveDraft(this.map);
      this.toast('地图已保存到浏览器', 'success');
    } catch (err) {
      this.toast(`保存失败：${(err as Error).message}`, 'warn');
    }
  }

  private scheduleSave(): void {
    this.map.updatedAt = Date.now();
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void saveDraft(this.map).catch(() => {});
    }, 900);
  }

  private async flushDraft(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    try {
      await saveDraft(this.map);
    } catch {
      // 草稿保存失败不阻塞
    }
  }

  private openExport(): void {
    this.openModal(`
      <div class="ed-modal">
        <div class="p-kicker">EXPORT</div>
        <h3>导出地图</h3>
        <p class="ed-help">导出为 .json，可在另一台设备或另一个浏览器里导入继续编辑，也可以直接用于生成游戏地图。</p>
        <label class="ed-check"><input type="checkbox" id="ed-pack" checked /> 打包底图（JSON 会变大；不勾选则只保留文件名引用）</label>
        <div class="ed-modal-actions">
          <button class="btn ghost" data-action="modal-close">取消</button>
          <button class="btn primary" data-action="export-confirm">导出 JSON</button>
        </div>
      </div>
    `);
  }

  private doExport(): void {
    const pack = this.modalEl.querySelector<HTMLInputElement>('#ed-pack')?.checked ?? true;
    const map = cloneMap(this.map, pack);
    const payload = {
      format: 'metro-plan-map',
      version: 1,
      exportedAt: Date.now(),
      map,
    };
    const name = (this.map.name || 'map').replace(/[\\/:*?"<>|]/g, '-');
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metro-plan-map-${name}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    this.closeModal();
    this.toast(pack ? '已导出（含底图）' : '已导出（底图仅引用）', 'success');
  }

  private async importMap(): Promise<void> {
    const file = this.mapInput.files?.[0];
    this.mapInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      const raw = (json.map ?? json.data ?? json) as CustomMapData;
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.regions)) {
        throw new Error('不是有效的《交通规划》地图文件');
      }
      this.map = {
        ...createBlankMap(raw.name || '导入地图'),
        ...raw,
        version: 1,
        grid: raw.grid ?? { enabled: false, stepKm: 0.5 },
        layers: raw.layers ?? [],
      };
      this.normalizeMap();
      this.resetIds();
      this.selectedRegion = null;
      this.selectedPoi = null;
      this.polygon = [];
      this.undoStack = [];
      this.bgImage = null;
      this.bgTexture = null;
      this.bgSprite = null;
      if (this.map.background?.dataUrl) {
        await this.loadBgImage(this.map.background.dataUrl).catch(() => {});
      }
      this.nameInput.value = this.map.name;
      this.rebuildAll();
      this.renderPanel();
      this.renderLayers();
      this.scheduleSave();
      this.toast('地图已导入', 'success');
    } catch (err) {
      this.toast(`导入失败：${(err as Error).message}`, 'warn');
    }
  }

  private play(): void {
    const field = buildPopulationField(this.map);
    if (field.residential.length === 0) {
      this.toast('至少需要一个住宅 / 农业 / 混合区域，才能生成居民', 'warn');
      return;
    }
    if (field.employment.length === 0) {
      this.toast('至少需要一个就业 / 商业 / 工业 / 混合区域，才能生成岗位', 'warn');
      return;
    }
    const px = this.map.pxPerKm ?? DEFAULT_PX_PER_KM;
    const walkRadiusPx = customWalkRadius(px);
    const walkSpeed = customWalkSpeed(px);
    const minStationGap = customMinGap(px);
    const sim = new Simulation({
      mode: 'standard',
      field,
      pxPerKm: px,
      walkRadiusPx,
      walkSpeed,
      minStationGap,
      pois: this.map.pois,
      map: this.map,
      mapId: this.map.id,
      mapName: this.map.name,
      seed: this.map.seed,
    });
    this.map.updatedAt = Date.now();
    void saveMap(this.map).catch(() => {});
    void saveDraft(this.map).catch(() => {});
    const image = this.bgImage;
    this.close();
    this.game.startCustomGame(sim, this.map, image);
  }

  // ————————————————————————— 弹窗 / 提示 —————————————————————————

  private openModal(html: string): void {
    this.modalEl.classList.remove('hidden');
    this.modalEl.innerHTML = `<div class="ed-modal-backdrop"></div>${html}`;
  }

  private closeModal(): void {
    this.modalEl.classList.add('hidden');
    this.modalEl.innerHTML = '';
    if (this.modalResolve) {
      const resolve = this.modalResolve;
      this.modalResolve = null;
      resolve(false);
    }
  }

  private isModalOpen(): boolean {
    return !this.modalEl.classList.contains('hidden');
  }

  private confirm(title: string, body: string, confirmLabel: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      this.modalResolve = resolve;
      this.openModal(`
        <div class="ed-modal">
          <div class="p-kicker">CONFIRM</div>
          <h3>${escapeHtml(title)}</h3>
          <p class="ed-help">${escapeHtml(body)}</p>
          <div class="ed-modal-actions">
            <button class="btn ghost" data-action="modal-close">取消</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-action="confirm-yes">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `);
      const yes = this.modalEl.querySelector('[data-action="confirm-yes"]');
      yes?.addEventListener('click', () => {
        const r = this.modalResolve;
        this.modalResolve = null;
        this.modalEl.classList.add('hidden');
        this.modalEl.innerHTML = '';
        r?.(true);
      });
      const backdrop = this.modalEl.querySelector('.ed-modal-backdrop');
      backdrop?.addEventListener('click', () => this.closeModal());
    });
  }

  private toast(text: string, kind: 'info' | 'success' | 'warn' = 'info'): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `ed-toast show ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'ed-toast';
    }, 2200);
  }

  private toScreen(ev: PointerEvent): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  private toWorld(ev: PointerEvent): MapPoint {
    const rect = this.app.canvas.getBoundingClientRect();
    const p = this.scene.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    return { x: clamp(p.x, 0, WORLD_W), y: clamp(p.y, 0, WORLD_H) };
  }

  // 供测试 / 调试
  getState(): { map: CustomMapData; tool: EditorTool; selectedRegion: number | null; selectedPoi: number | null } {
    return { map: this.map, tool: this.tool, selectedRegion: this.selectedRegion, selectedPoi: this.selectedPoi };
  }

  getSceneTransform(): { scale: number; offsetX: number; offsetY: number } {
    return { scale: this.scene.scale, offsetX: this.scene.offsetX, offsetY: this.scene.offsetY };
  }

  get apps(): Application {
    return this.app;
  }

  get pointerScreenPos(): { x: number; y: number } | null {
    return this.pointerScreen;
  }

  // 兼容旧的调试接口
  get regionCount(): number {
    return this.map.regions.length;
  }
}
