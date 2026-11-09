import type { Application } from 'pixi.js';
import { formatClock, formatDate } from '../sim/calendar';
import { DEFAULT_FARE, PROFILE_META, SAVE_VERSION, STATION_COST } from '../sim/constants';
import { distanceToSegment } from '../sim/network';
import { stationThermal } from '../sim/heat';
import { makeSaveFile, restoreSim } from '../sim/save';
import type { SaveFile, SaveMeta } from '../sim/save';
import { Simulation } from '../sim/simulation';
import { deleteSave, getSave, latestSave, listSaves, putSave, saveMapId, SLOT_LABELS } from '../sim/storage';
import { DEFAULT_MAP_ID, getBuiltinMap, mapSummaries } from '../maps/registry';
import type { FareConfig, Line, SimEvent, Station, StationSize, TrainKind } from '../sim/types';
import { PEOPLE_PER_DOT, hitZoneIn } from '../sim/zones';
import { poiZoneId } from '../sim/mapData';
import { poiMarkerBounds } from '../render/poiMarkers';
import { curvePolyline } from '../sim/lineCurve';
import { JOBS_PER_EMPLOYMENT_DOT } from '../sim/population';
import type { Scene } from '../render/scene';
import { Editor } from '../editor/editor';
import { getMap } from '../editor/mapStore';
import type { CustomMapData } from '../sim/types';
import { GameUI } from '../ui/gameUi';
import type { MenuInfo, PlacementInfo, Tool, UiActions } from '../ui/gameUi';
import { int, yen } from '../ui/format';
import { buildActivityModel } from '../sim/activity';

/** 默认混合客流 + M2 活动链；纯通勤 / M1 / M3 / M4 是显式开启的实验层。 */
const QUERY =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
/** 默认：混合客流 + M2 活动链；纯通勤改为 `?commuter=1` 的可选实验。 */
const M4_MODE = QUERY.get('m4') !== '0';
const ACTIVITY_MODE = true;
/** M1 仍作为显式实验层，避免默认把旧 agent 人口换掉。 */
const M1_MODE = QUERY.get('m1') === '1';
const COMMUTER_MODE = QUERY.get('commuter') === '1';
const WALK_NETWORK = QUERY.get('m3') !== '0' || M4_MODE;

interface Point {
  x: number;
  y: number;
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export class Game implements UiActions {
  private scene: Scene;
  private app: Application;
  ui: GameUI;
  editor: Editor;
  sim: Simulation | null = null;

  private tool: Tool = 'select';
  private pointer: Point | null = null;
  private pointerScreen: Point | null = null;
  private previewPos: Point | null = null;
  private stationSize: StationSize = 'standard';
  private lineDraft: number[] = [];
  private editingLineId: number | null = null;
  private branchParentId: number | null = null;
  private hoverStation: number | null = null;
  private hoverLine: number | null = null;
  private hoverZone: number | null = null;
  private selectedStation: number | null = null;
  private selectedLine: number | null = null;
  private selectedZone: number | null = null;
  private highlightLineId: number | null = null;
  private panning: { x: number; y: number } | null = null;
  private fpsFrames = 0;
  private fpsMark = 0;

  /** 组团人口 / 岗位与密度：按 sim 缓存，悬停时只查表。 */
  private zoneStatsCache = new WeakMap<
    Simulation,
    Map<number, { value: number; density: number }>
  >();

  private metas: SaveMeta[] = [];
  private menuReturn = false;
  private selectedMapId = DEFAULT_MAP_ID;
  private lastMapId = DEFAULT_MAP_ID;
  private unsub: (() => void) | null = null;
  private lastTs = 0;
  private lastSavedGameMinute = 0;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  /** 线路曲线的命中缓存：只在 net.version 变化时重建。 */
  private lineHitCache = new Map<number, { version: number; curve: Array<{ x: number; y: number }> }>();

  constructor(scene: Scene, app: Application) {
    this.scene = scene;
    this.app = app;
    const storedMap = typeof localStorage !== 'undefined' ? localStorage.getItem('metro-last-map') : null;
    if (getBuiltinMap(storedMap)) this.lastMapId = storedMap!;
    this.selectedMapId = this.lastMapId;
    this.ui = new GameUI(this);
    this.editor = new Editor(app, scene, this);
    this.bindEvents();
    this.resize();
  }

  async boot(): Promise<void> {
    this.metas = await listSaves().catch(() => []);
    this.ui.setSaveMetas(this.metasFor(this.lastMapId));
    this.ui.showMenu(this.menuInfo());
    this.lastTs = performance.now();
    requestAnimationFrame(this.frame);
  }

  private metasFor(mapId: string): SaveMeta[] {
    return this.metas.filter((m) => saveMapId(m) === mapId);
  }

  private menuInfo(): MenuInfo {
    const latest = this.metasFor(this.lastMapId)[0];
    const mapName = getBuiltinMap(this.lastMapId)?.name ?? latest?.mapName ?? '';
    const label =
      this.menuReturn && this.sim
        ? `当前进度 · ${this.sim.mapName} · ${formatDate(this.sim.dayIndex())} ${formatClock(this.sim.timeOfDay())}`
        : latest
          ? `${mapName} · ${latest.dateLabel} · 基金 ${yen(latest.fund)}`
          : '暂无存档';
    const maps = mapSummaries();
    const selected = maps.find((m) => m.id === this.selectedMapId);
    const population =
      this.menuReturn && this.sim && this.sim.mapId === this.selectedMapId
        ? this.sim.agents.count
        : COMMUTER_MODE
          ? (selected?.commuters ?? 0)
          : (selected?.agents ?? 0);
    return {
      hasSave: (this.menuReturn && !!this.sim) || !!latest,
      latestLabel: label,
      maps,
      selectedMapId: this.selectedMapId,
      lastMapId: this.lastMapId,
      population,
      profileCount: COMMUTER_MODE ? 4 : PROFILE_META.length,
      commuterOnly: COMMUTER_MODE,
    };
  }

  // ————————————————————————— 主循环 —————————————————————————

  private frame = (now: number): void => {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTs) / 1000));
    this.lastTs = now;
    if (this.editor.isActive()) {
      this.scene.setVectorVisible(false);
      this.editor.tick();
      this.app.renderer.render(this.app.stage);
      requestAnimationFrame(this.frame);
      return;
    }
    this.fpsFrames++;
    if (now - this.fpsMark >= 500) {
      const fps = Math.round((this.fpsFrames * 1000) / Math.max(1, now - this.fpsMark));
      this.ui.setFps(fps);
      this.fpsFrames = 0;
      this.fpsMark = now;
    }
    const menu = this.ui.isMenuVisible();
    if (menu) {
      // 首页只显示静态图片背景；不推进模拟，也不渲染 WebGL 地图。
      this.scene.setVectorVisible(false);
      this.app.canvas.style.visibility = 'hidden';
      requestAnimationFrame(this.frame);
      return;
    }
    this.scene.setVectorVisible(true);
    this.app.canvas.style.visibility = 'visible';
    if (this.sim) this.sim.tick(dt);
    this.updateHover();
    this.updateCursor();
    this.updateHoverLabel(false);
    this.scene.render(this.sim, {
      hoverStation: this.hoverStation,
      hoverLine: this.hoverLine,
      hoverZone: this.hoverZone,
      selectedStation: this.selectedStation,
      selectedLine: this.selectedLine,
      selectedZone: this.selectedZone,
      preview: this.tool === 'station' ? this.previewPos : null,
      previewValid: this.previewPos ? (this.sim?.canPlaceStation(this.previewPos.x, this.previewPos.y).ok ?? false) : false,
      lineDraft: this.lineDraft,
      draftBase: this.draftBaseIds(),
      draftLineId: this.editingLineId ?? this.branchParentId,
      draftBranch: this.branchParentId !== null,
      draftHex: this.lineDraft.length > 0 ? this.ui.getDraftSettings().hex : null,
      groupFilter: this.ui.getGroupFilter(),
      previewRadius: this.sim?.walkRadiusPx ?? 100,
      previewCoreRadius: this.sim?.coreWalkRadiusPx() ?? 25,
      layers: this.ui.getLayers(),
      highlightLine: this.highlightLineId,
    });
    if (this.sim) this.ui.update(this.sim);
    this.ui.setScaleBar(this.sim?.pxPerKm ?? 22, this.scene.scale, !!this.sim);
    this.app.renderer.render(this.app.stage);
    requestAnimationFrame(this.frame);
  };

  private resize(): void {
    this.scene.resize(window.innerWidth, window.innerHeight);
    this.editor?.syncWorld();
  }

  // ————————————————————————— 输入 —————————————————————————

  private bindEvents(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointermove', (ev) => {
      if (this.editor.isActive()) return;
      const p = this.toWorld(ev);
      this.pointer = p;
      const rect = this.app.canvas.getBoundingClientRect();
      this.pointerScreen = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      // 查看 / 建站 / 画线都允许拖动地图；拖动超过阈值后本次不再触发点击。
      if (this.pointerDown && !this.panning) {
        const dx = ev.clientX - this.pointerDown.x;
        const dy = ev.clientY - this.pointerDown.y;
        if (Math.hypot(dx, dy) > 6) {
          this.panning = { x: this.pointerDown.x, y: this.pointerDown.y };
          this.pointerDown = null;
        }
      }
      if (this.panning) {
        this.scene.panBy(ev.clientX - this.panning.x, ev.clientY - this.panning.y);
        this.panning = { x: ev.clientX, y: ev.clientY };
        this.app.canvas.style.cursor = 'grabbing';
        return;
      }
    });
    canvas.addEventListener('pointerdown', (ev) => {
      if (this.editor.isActive()) return;
      if (ev.button === 1 || ev.button === 2) {
        ev.preventDefault();
        this.panning = { x: ev.clientX, y: ev.clientY };
        this.app.canvas.style.cursor = 'grabbing';
        return;
      }
      this.pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (ev) => {
      if (this.editor.isActive()) return;
      if (this.panning) {
        this.panning = null;
        this.app.canvas.style.cursor = 'default';
        return;
      }
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      if (moved > 6 || performance.now() - down.t > 700) return;
      this.pointer = this.toWorld(ev);
      this.onClick();
    });
    canvas.addEventListener('wheel', (ev) => {
      if (this.editor.isActive() || this.ui.isMenuVisible() || this.ui.isOverlayOpen()) return;
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const rect = this.app.canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      this.scene.zoomAt(sx, sy, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    canvas.addEventListener('pointerleave', () => {
      if (this.editor.isActive()) return;
      this.pointer = null;
      this.pointerScreen = null;
      this.ui.hideHoverLabel();
      this.hoverStation = null;
      this.hoverLine = null;
      this.hoverZone = null;
    });

    window.addEventListener('resize', () => this.resize());

    window.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (this.editor.isActive()) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.code === 'KeyS') {
        ev.preventDefault();
        void this.openSaveModal();
        return;
      }
      if (this.ui.isMenuVisible()) return;
      if (!this.sim) return;
      switch (ev.code) {
        case 'Space':
          ev.preventDefault();
          if (!this.ui.isOverlayOpen()) this.sim.setPaused(!this.sim.paused);
          break;
        case 'Escape':
          this.handleEscape();
          break;
        case 'Enter':
          this.handleEnter();
          break;
        case 'KeyB':
          this.setTool('station');
          break;
        case 'KeyL':
          this.setTool('line');
          break;
        case 'KeyV':
          this.setTool('select');
          break;
        default:
          break;
      }
    });

    window.addEventListener('beforeunload', (ev) => {
      if (!this.sim) return;
      if (this.sim.time - this.lastSavedGameMinute > 5) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
  }

  private toWorld(ev: PointerEvent): Point {
    const rect = this.app.canvas.getBoundingClientRect();
    return this.scene.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  private updateHover(): void {
    if (!this.sim || this.ui.isMenuVisible() || this.ui.isOverlayOpen() || !this.pointer) {
      this.hoverStation = null;
      this.hoverLine = null;
      this.hoverZone = null;
      return;
    }
    if (this.tool === 'station') {
      this.hoverStation = null;
      this.hoverLine = null;
      this.hoverZone = null;
      return;
    }
    const p = this.pointer;
    const station = this.hitStation(p.x, p.y);
    if (station) {
      this.hoverStation = station.id;
      this.hoverLine = null;
      this.hoverZone = null;
      return;
    }
    this.hoverStation = null;
    const line = this.hitLine(p.x, p.y);
    if (line) {
      this.hoverLine = line.id;
      this.hoverZone = null;
      return;
    }
    this.hoverLine = null;
    this.hoverZone = this.hitVisibleZone(p.x, p.y);
  }

  /** Hidden zone / POI layers must not open their old popups. */
  private hitVisibleZone(x: number, y: number): number | null {
    if (!this.sim) return null;
    const layers = this.ui.getLayers();
    if (layers.poi) {
      // POI zones carry a large influence radius (1–8 km). Clicking anywhere
      // inside that radius must not select the POI; hit only the marker.
      let best: { id: number; d: number } | null = null;
      const scale = Math.max(0.001, this.scene.scale);
      for (const poi of this.sim.pois) {
        const zoneId = poiZoneId(poi);
        if (!this.sim.zoneMap.has(zoneId)) continue;
        const d = Math.hypot(x - poi.x, y - poi.y);
        const hitRadius = (poiMarkerBounds(poi.level ?? 3) + 4) / scale;
        if (d <= hitRadius && (!best || d < best.d)) best = { id: zoneId, d };
      }
      if (best) return best.id;
    }
    if (!layers.zones) return null;
    const zone = hitZoneIn(
      this.sim.zones.filter((z) => z.id < 10000),
      x,
      y,
    );
    return zone?.id ?? null;
  }

  private zoneStats(sim: Simulation): Map<number, { value: number; density: number }> {
    const cached = this.zoneStatsCache.get(sim);
    if (cached) return cached;
    const counts = new Map<number, number>();
    for (const d of sim.dots) counts.set(d.zone, (counts.get(d.zone) ?? 0) + 1);
    const pxPerKm = Math.max(1, sim.pxPerKm);
    const stats = new Map<number, { value: number; density: number }>();
    for (const z of sim.zones) {
      if (z.id >= 10000) continue;
      const dots = counts.get(z.id) ?? 0;
      const perDot = z.kind === 'employment' ? JOBS_PER_EMPLOYMENT_DOT : PEOPLE_PER_DOT;
      const value = dots * perDot;
      const area = (Math.PI * z.r * z.r) / (pxPerKm * pxPerKm);
      stats.set(z.id, { value, density: area > 0 ? value / area : 0 });
    }
    this.zoneStatsCache.set(sim, stats);
    return stats;
  }

  private updateHoverLabel(menu: boolean): void {
    if (!this.sim || menu || this.ui.isOverlayOpen() || !this.pointerScreen || this.tool === 'station' || this.selectedZone !== null) {
      this.ui.hideHoverLabel();
      this.ui.hideSurgeBubble();
      return;
    }
    let text: string | null = null;
    if (this.hoverStation !== null) {
      const s = this.sim.net.stationById.get(this.hoverStation);
      if (s) {
        const waiting = this.sim.waitingAt(s.id);
        const thermal = stationThermal(s, waiting);
        if (thermal.ratio >= 0.75 && s.lines.length > 0) {
          this.ui.hideHoverLabel();
          this.ui.showSurgeBubble(thermal, this.scene.worldToScreen(s.x, s.y));
          return;
        }
        text = `${s.name} · 候车 ${waiting}`;
      }
    }
    this.ui.hideSurgeBubble();
    if (this.hoverLine !== null) {
      const line = this.sim.net.lineById.get(this.hoverLine);
      if (line) text = `${line.id} 号线 · ${line.stationIds.length} 站`;
    } else if (this.hoverZone !== null) {
      const zone = this.sim.zoneMap.get(this.hoverZone);
      if (zone) {
        if (zone.id >= 10000) {
          text = `${zone.name} · POI`;
        } else {
          const stat = this.zoneStats(this.sim).get(zone.id);
          const unit = zone.kind === 'employment' ? '岗位' : '人';
          if (stat && stat.value > 0) {
            text = `${zone.name} · ${int(stat.value)} ${unit} · ${int(stat.density)} ${unit}/km²`;
          } else {
            text = `${zone.name} · ${zone.kind === 'mixed' ? '混合 / 商业区' : zone.kind === 'employment' ? '就业区' : '住宅区'}`;
          }
        }
      }
    }
    if (text) this.ui.setHoverLabel(text, this.pointerScreen.x, this.pointerScreen.y);
    else this.ui.hideHoverLabel();
  }

  private updateCursor(): void {
    const canvas = this.app.canvas;
    if (this.panning) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (!this.sim || this.ui.isMenuVisible() || this.ui.isOverlayOpen()) {
      canvas.style.cursor = 'default';
      return;
    }
    if (this.tool === 'station') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (this.tool === 'line') {
      canvas.style.cursor = this.hoverStation !== null ? 'pointer' : 'crosshair';
      return;
    }
    const hoverable = this.hoverStation !== null || this.hoverLine !== null || this.hoverZone !== null;
    canvas.style.cursor = hoverable ? 'pointer' : 'grab';
  }

  private onClick(): void {
    if (!this.sim || !this.pointer) return;
    const p = this.pointer;
    if (this.tool === 'station') {
      this.previewPos = { x: p.x, y: p.y };
      this.syncPreview();
      return;
    }
    if (this.tool === 'line') {
      const station = this.hitStation(p.x, p.y);
      if (!station) {
        this.ui.toast('画线时请点击车站', 'info');
        return;
      }
      // 已经闭合的环线不再接受新站，避免把首尾拆开。
      if (
        this.lineDraft.length > 3 &&
        this.lineDraft[0] === this.lineDraft[this.lineDraft.length - 1]
      ) {
        this.ui.toast('环线已闭合，点「完成」建成或取消', 'info');
        return;
      }
      // 延长既有线路时，点回线路端点 / 新延长的端点：直接把这一端接回起点成环。
      // 不要求先接新站：A·B·C 点 A 就补出 C→A 这一段（按 1 段计费）。
      if (this.editingLineId !== null && this.lineDraft.length > 1 && this.lineDraft.includes(station.id)) {
        const original = this.sim.net.lineById.get(this.editingLineId)?.stationIds ?? [];
        const pos = original.indexOf(station.id);
        const isOriginalEnd = pos === 0 || pos === original.length - 1;
        const draftPos = this.lineDraft.indexOf(station.id);
        if (draftPos >= 0 && (isOriginalEnd || !original.includes(station.id))) {
          // 以点到的那一站为新起点，绕一圈后回到它自己。
          const rotated = [
            ...this.lineDraft.slice(draftPos),
            ...this.lineDraft.slice(0, draftPos),
          ];
          rotated.push(station.id);
          this.lineDraft = rotated;
          this.ui.showDraft(this.sim, this.lineDraft, this.editingLineId, null);
          this.ui.toast('已接回该站，点「完成延长」成环', 'info');
          return;
        }
      }
      if (this.lineDraft.length > 0 && this.lineDraft[this.lineDraft.length - 1] === station.id) return;
      if (this.lineDraft.includes(station.id)) {
        // 画新线时点击起点：闭合成环线。
        if (this.editingLineId === null && station.id === this.lineDraft[0]) {
          if (this.lineDraft.length >= 3) {
            this.lineDraft.push(station.id);
            this.ui.showDraft(this.sim, this.lineDraft, null, null);
            this.ui.toast('已闭合成环线，点「完成」建成', 'info');
            return;
          }
          this.ui.toast('环线至少需要 3 个车站', 'warn');
          return;
        }
        if (this.editingLineId !== null) {
          const line = this.sim.net.lineById.get(this.editingLineId);
          const index = line ? line.stationIds.indexOf(station.id) : -1;
          if (line && index > 0 && index < line.stationIds.length - 1) {
            // 中间站：从这里分出一条共用干线颜色的支线。
            this.branchParentId = line.id;
            this.editingLineId = null;
            this.lineDraft = [station.id];
            this.ui.showDraft(this.sim, this.lineDraft, null, line.id);
            this.ui.toast('已选为分支起点，继续点击新车站', 'info');
            return;
          }
          this.ui.toast('端点请点击线路外侧的新车站延长；中间站可分支', 'info');
        } else {
          this.ui.toast('该车站已在这条线上', 'warn');
        }
        return;
      }
      if (this.editingLineId !== null) {
        // 既有线路：按点击位置接到较近的一端。
        const line = this.sim.net.lineById.get(this.editingLineId);
        if (!line) return;
        const first = this.sim.net.stationById.get(this.lineDraft[0]!);
        const last = this.sim.net.stationById.get(this.lineDraft[this.lineDraft.length - 1]!);
        if (!first || !last) return;
        const dFirst = Math.hypot(first.x - station.x, first.y - station.y);
        const dLast = Math.hypot(last.x - station.x, last.y - station.y);
        if (dFirst <= dLast) this.lineDraft.unshift(station.id);
        else this.lineDraft.push(station.id);
      } else {
        this.lineDraft.push(station.id);
      }
      this.ui.showDraft(this.sim, this.lineDraft, this.editingLineId, this.branchParentId);
      this.ui.setTool('line');
      return;
    }
    const station = this.hitStation(p.x, p.y);
    if (station) {
      this.selectStation(station);
      return;
    }
    const line = this.hitLine(p.x, p.y);
    if (line) {
      this.selectLine(line.id);
      return;
    }
    const zoneId = this.hitVisibleZone(p.x, p.y);
    const zone = zoneId !== null ? this.sim.zoneMap.get(zoneId) : undefined;
    if (zone) {
      this.selectedZone = zone.id;
      this.selectedStation = null;
      this.selectedLine = null;
      this.ui.hideStation();
      this.ui.hideLine();
      const screen = this.scene.worldToScreen(p.x, p.y);
      this.ui.showZone(this.sim, zone, screen);
      return;
    }
    this.clearSelection();
  }

  private handleEscape(): void {
    if (this.ui.isOverlayOpen()) {
      this.ui.closeOverlay();
      return;
    }
    if (this.ui.closePopovers()) return;
    if (this.previewPos) {
      this.cancelPlacement();
      return;
    }
    if (this.lineDraft.length > 0) {
      this.cancelLine();
      return;
    }
    if (this.selectedStation !== null || this.selectedLine !== null || this.selectedZone !== null) {
      this.clearSelection();
      return;
    }
    this.setTool('select');
  }

  private handleEnter(): void {
    if (this.previewPos) {
      this.confirmStation();
      return;
    }
    if (this.lineDraft.length >= 2) this.finishLine();
  }

  // ————————————————————————— 命中测试 —————————————————————————

  private hitStation(x: number, y: number): Station | null {
    if (!this.sim) return null;
    let best: Station | null = null;
    // 图标屏幕固定，点击热区也按屏幕像素换算，避免放大后热区过大。
    let bestD = 20 / Math.max(0.001, this.scene.scale);
    for (const s of this.sim.net.stations) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private hitLine(x: number, y: number): Line | null {
    if (!this.sim) return null;
    let best: Line | null = null;
    // 线路宽度屏幕固定，命中宽度也按屏幕像素换算。
    let bestD = 10 / Math.max(0.001, this.scene.scale);
    for (const line of this.sim.net.lines) {
      let entry = this.lineHitCache.get(line.id);
      if (!entry || entry.version !== this.sim.net.version) {
        const stations = line.stationIds
          .map((id) => this.sim!.net.stationById.get(id))
          .filter((s): s is Station => !!s);
        entry = { version: this.sim.net.version, curve: curvePolyline(stations, line.id, 8) };
        this.lineHitCache.set(line.id, entry);
      }
      const curve = entry.curve;
      for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i]!;
        const b = curve[i + 1]!;
        const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
        if (d < bestD) {
          bestD = d;
          best = line;
        }
      }
    }
    return best;
  }

  // ————————————————————————— 选择 —————————————————————————

  selectStation(station: Station): void {
    if (!this.sim) return;
    this.selectedStation = station.id;
    this.selectedLine = null;
    this.selectedZone = null;
    this.ui.hideLine();
    this.ui.hideZone();
    this.ui.showStation(station);
  }

  setHighlightLine(lineId: number | null): void {
    this.highlightLineId = lineId;
  }

  setLineColor(lineId: number, colorIndex: number, hex: string): void {
    if (!this.sim) return;
    this.sim.setLineColor(lineId, colorIndex, hex);
  }

  setLineService(lineId: number, startMin: number, endMin: number): void {
    if (!this.sim) return;
    this.sim.setLineService(lineId, startMin, endMin);
  }

  setTrainSpan(lineId: number, trainId: number, startId: number, endId: number): void {
    if (!this.sim) return;
    const res = this.sim.setTrainSpan(lineId, trainId, startId, endId);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法设置运行区间', 'warn');
      return;
    }
    const line = this.sim.net.lineById.get(lineId);
    if (line) this.ui.showLine(this.sim, line);
  }

  setTrainSpanFlexible(lineId: number, trainId: number, startId: number, endId: number): void {
    if (!this.sim) return;
    const res = this.sim.setTrainSpanFlexible(lineId, trainId, startId, endId);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法设置运行区间', 'warn');
      return;
    }
    const line = this.sim.net.lineById.get(lineId);
    if (line) this.ui.showLine(this.sim, line);
  }

  swapTrainSpan(lineId: number, trainId: number): void {
    if (!this.sim) return;
    const res = this.sim.swapTrainSpan(lineId, trainId);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法调换端点', 'warn');
      return;
    }
    const line = this.sim.net.lineById.get(lineId);
    if (line) this.ui.showLine(this.sim, line);
  }

  resetView(): void {
    this.scene.resetCamera();
  }

  selectLine(lineId: number): void {
    if (!this.sim) return;
    const line = this.sim.net.lineById.get(lineId);
    if (!line) return;
    this.selectedLine = lineId;
    this.selectedStation = null;
    this.selectedZone = null;
    this.ui.hideStation();
    this.ui.hideZone();
    this.ui.showLine(this.sim, line);
  }

  clearSelection(): void {
    this.selectedStation = null;
    this.selectedLine = null;
    this.selectedZone = null;
    this.ui.hideStation();
    this.ui.hideLine();
    this.ui.hideZone();
  }

  // ————————————————————————— UiActions —————————————————————————

  setPaused(value: boolean): void {
    this.sim?.setPaused(value);
  }

  newGameOnMap(mapId: string): void {
    if (!getBuiltinMap(mapId)) return;
    this.selectedMapId = mapId;
    void this.startNewGame('standard');
  }

  private rememberMap(mapId: string): void {
    if (!getBuiltinMap(mapId)) return;
    this.lastMapId = mapId;
    this.selectedMapId = mapId;
    try {
      localStorage.setItem('metro-last-map', mapId);
    } catch {
      // 隐私模式下忽略
    }
  }

  private applyMapStyle(mapId: string): void {
    const def = getBuiltinMap(mapId);
    const plain = def?.style === 'plain';
    const custom = !!this.sim?.map;
    this.scene.setPlainMap(plain);
    this.scene.setVectorBase(this.scene.hasVectorBasemap() && !plain && !custom);
    // 矢量地形图暂时不铺旧住宅/就业/POI；纯色图和自定义图仍依赖这些旧图层。
    this.ui.setLayer('zones', plain || custom);
    this.ui.setLayer('poi', plain || custom);
  }

  setStationSize(size: StationSize): void {
    this.stationSize = size;
  }

  setSpeed(speed: number): void {
    this.sim?.setSpeed(speed);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.panning = null;
    this.pointerDown = null;
    this.previewPos = null;
    this.ui.hidePlacement();
    if (tool === 'line' && this.editingLineId !== null) {
      this.editingLineId = null;
      this.branchParentId = null;
      this.lineDraft = [];
      this.ui.hideDraft();
    }
    if (tool !== 'line') {
      this.editingLineId = null;
      this.branchParentId = null;
      this.lineDraft = [];
      this.ui.hideDraft();
    }
    this.clearSelection();
    this.ui.setTool(tool);
    if (this.sim && tool === 'line' && this.sim.net.stations.length < 2) {
      this.ui.toast('先建至少两个车站，再开始画线', 'info');
    }
  }

  private syncPreview(): void {
    if (!this.sim || !this.previewPos) {
      this.ui.hidePlacement();
      return;
    }
    const { x, y } = this.previewPos;
    const check = this.sim.canPlaceStation(x, y);
    const coverage = this.sim.previewCoverage(x, y);
    const screen = this.scene.worldToScreen(x, y);
    const info: PlacementInfo = {
      x,
      y,
      screen,
      coverage,
      valid: check.ok,
      reason: check.reason,
    };
    this.ui.showPlacement(this.sim, info);
  }

  confirmStation(): void {
    if (!this.sim || !this.previewPos) return;
    const { x, y } = this.previewPos;
    const res = this.sim.placeStation(x, y, this.stationSize);
    if (!res.ok || !res.station) {
      this.ui.toast(res.reason ?? '无法建站', 'warn');
      this.syncPreview();
      return;
    }
    const station = res.station;
    this.ui.toast(`「${station.name}」已建成 · −${yen(STATION_COST)}`, 'success');
    this.previewPos = null;
    this.ui.hidePlacement();
    this.selectedStation = station.id;
    this.selectedLine = null;
    this.ui.hideLine();
    this.ui.showStation(station);
  }

  cancelPlacement(): void {
    this.previewPos = null;
    this.ui.hidePlacement();
  }

  undoStation(): void {
    if (!this.sim) return;
    const res = this.sim.undoLastStation();
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法撤回', 'warn');
      return;
    }
    this.previewPos = null;
    this.ui.hidePlacement();
    this.clearSelection();
    this.ui.toast(`已撤回最近车站 · +${yen(STATION_COST)}`, 'success');
  }

  finishLine(): void {
    if (!this.sim) return;
    if (this.lineDraft.length < 2) {
      this.ui.toast('线路至少需要连接 2 个车站', 'warn');
      return;
    }
    const ids = [...this.lineDraft];
    if (this.branchParentId !== null) {
      const parentId = this.branchParentId;
      const res = this.sim.createBranch(parentId, ids);
      if (!res.ok) {
        this.ui.toast(res.reason ?? '无法建设支线', 'warn');
        return;
      }
      this.branchParentId = null;
      this.lineDraft = [];
      this.ui.hideDraft();
      this.ui.toast(`支线已建成 · −${yen(res.cost ?? 0)}（含 1 列车）`, 'success');
      this.tool = 'select';
      this.ui.setTool('select');
      if (res.lineId) this.selectLine(res.lineId);
      return;
    }
    if (this.editingLineId !== null) {
      const lineId = this.editingLineId;
      const res = this.sim.extendLine(lineId, ids);
      if (!res.ok) {
        this.ui.toast(res.reason ?? '无法延长线路', 'warn');
        return;
      }
      this.editingLineId = null;
      this.lineDraft = [];
      this.ui.hideDraft();
      this.ui.toast(`线路已延长 · −${yen(res.cost ?? 0)}`, 'success');
      this.tool = 'select';
      this.ui.setTool('select');
      this.selectLine(lineId);
      return;
    }
    const settings = this.ui.getDraftSettings();
    const cost = this.sim.lineQuote(ids);
    const res = this.sim.createLine(ids, settings.colorIndex, settings.hex, settings.startMin, settings.endMin);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法建线', 'warn');
      return;
    }
    this.lineDraft = [];
    this.ui.hideDraft();
    this.ui.toast(`线路已建成 · −${yen(cost)}（含 1 列车）`, 'success');
    this.tool = 'select';
    this.ui.setTool('select');
    if (res.lineId) this.selectLine(res.lineId);
  }

  cancelLine(): void {
    if (this.lineDraft.length > 0) {
      const what =
        this.branchParentId !== null ? '已取消分支' : this.editingLineId !== null ? '已取消延长' : '已取消画线';
      this.ui.toast(what, 'info');
    }
    this.editingLineId = null;
    this.branchParentId = null;
    this.lineDraft = [];
    this.ui.hideDraft();
  }

  addTrain(lineId: number): void {
    this.buyTrain(lineId, 'local');
  }

  buyTrain(lineId: number, kind: TrainKind): void {
    if (!this.sim) return;
    const line = this.sim.net.lineById.get(lineId);
    if (!line) return;
    if (kind === 'express' && line.expressStops.length < 2) {
      this.ui.showExpressPicker(this.sim, line, true);
      return;
    }
    const res = this.sim.addTrain(lineId, kind);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法加车', 'warn');
      return;
    }
    this.ui.showLine(this.sim, line);
    this.ui.toast(kind === 'express' ? '已加一列快车 · −¥2,600' : '已加一列慢车 · −¥2,000', 'success');
  }

  setExpressStops(lineId: number, stationIds: number[]): void {
    if (!this.sim) return;
    const res = this.sim.setExpressStops(lineId, stationIds);
    if (!res.ok) this.ui.toast(res.reason ?? '保存失败', 'warn');
  }

  openExpressPicker(lineId: number, buyAfter: boolean): void {
    if (!this.sim) return;
    const line = this.sim.net.lineById.get(lineId);
    if (line) this.ui.showExpressPicker(this.sim, line, buyAfter);
  }

  removeTrain(lineId: number): void {
    if (!this.sim) return;
    const res = this.sim.removeTrain(lineId);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法减车', 'warn');
      return;
    }
    const line = this.sim.net.lineById.get(lineId);
    if (line) this.ui.showLine(this.sim, line);
    this.ui.toast('已减一列车（不返还购买费）', 'info');
  }

  removeLine(lineId: number): void {
    if (!this.sim) return;
    const refund = this.sim.refundOf(lineId);
    const res = this.sim.removeLine(lineId);
    if (!res.ok) {
      this.ui.toast(res.reason ?? '无法拆线', 'warn');
      return;
    }
    this.clearSelection();
    this.ui.toast(`线路已拆除 · +${yen(refund)}`, 'success');
  }

  /** 草稿里属于既有线路的车站：延长 / 分支时这些区段不再重复预览。 */
  private draftBaseIds(): number[] {
    const lineId = this.editingLineId ?? this.branchParentId;
    if (lineId === null || !this.sim) return [];
    return this.sim.net.lineById.get(lineId)?.stationIds ?? [];
  }

  extendLine(lineId: number): void {
    if (!this.sim) return;
    const line = this.sim.net.lineById.get(lineId);
    if (!line) return;
    if (this.lineDraft.length > 0) this.cancelLine();
    this.editingLineId = lineId;
    this.branchParentId = null;
    this.lineDraft = [...line.stationIds];
    this.tool = 'line';
    this.previewPos = null;
    this.ui.hidePlacement();
    this.clearSelection();
    this.ui.setTool('line');
    this.ui.showDraft(this.sim, this.lineDraft, lineId);
    this.ui.toast('延长线路：点击新车站接在两端，完成后按新增区段计费', 'info');
  }

  toggleGroup(_group: number): void {
    // 渲染层直接读取 UI 中的筛选状态
  }

  toggleSetting(key: keyof Simulation['settings']): void {
    if (!this.sim) return;
    this.sim.settings[key] = !this.sim.settings[key];
  }

  setFare(key: keyof FareConfig, value: number): void {
    if (!this.sim) return;
    const limits: Record<keyof FareConfig, [number, number]> = {
      base: [0, 20],
      freeKm: [0, 50],
      stepKm: [1, 50],
      step: [0, 10],
    };
    const [min, max] = limits[key];
    this.sim.fare[key] = Math.min(max, Math.max(min, value));
  }

  resetFare(): void {
    if (!this.sim) return;
    this.sim.fare = { ...DEFAULT_FARE };
  }

  // ————————————————————————— 存档 —————————————————————————

  private currentSaveMapId(): string {
    if (this.ui.isMenuVisible()) return this.selectedMapId;
    return this.sim?.mapId ?? this.selectedMapId;
  }

  private async refreshMetas(mapId = this.currentSaveMapId()): Promise<void> {
    this.metas = await listSaves().catch(() => []);
    this.ui.setSaveMetas(this.metasFor(mapId));
  }

  async openSaveModal(): Promise<void> {
    await this.refreshMetas();
    this.ui.showSaveSlots();
  }

  openSettings(): void {
    if (!this.sim) return;
    this.ui.showSettings(this.sim);
  }

  async saveSlot(slot: string): Promise<void> {
    if (!this.sim) return;
    try {
      const file = makeSaveFile(this.sim, slot);
      await putSave(file);
      this.lastSavedGameMinute = this.sim.time;
      this.ui.toast(`已保存到${SLOT_LABELS[slot] ?? slot}`, 'success');
      await this.refreshMetas();
      if (this.ui.isOverlayOpen()) this.ui.showSaveSlots();
    } catch (err) {
      this.ui.toast(`保存失败：${(err as Error).message}`, 'warn');
    }
  }

  async loadSlot(slot: string): Promise<void> {
    try {
      const stored = await getSave(slot, this.currentSaveMapId());
      if (!stored) {
        this.ui.toast('该槽位没有存档', 'warn');
        return;
      }
      const sim = restoreSim(stored.data);
      const bg = await this.loadMapBackground(sim.mapId);
      this.startWithSim(sim, bg);
      this.ui.toast('存档已载入 · 按空格继续', 'success');
    } catch (err) {
      this.ui.showLoadError(`读取存档失败：${(err as Error).message}`);
    }
  }

  async deleteSlot(slot: string): Promise<void> {
    const ok = await this.ui.confirm({
      title: '删除存档',
      body: `将删除${SLOT_LABELS[slot] ?? slot}，删除后无法恢复。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSave(slot, this.currentSaveMapId());
      await this.refreshMetas(this.currentSaveMapId());
      this.ui.showSaveSlots();
      this.ui.toast('存档已删除', 'info');
    } catch (err) {
      this.ui.toast(`删除失败：${(err as Error).message}`, 'warn');
    }
  }

  exportSave(): void {
    if (!this.sim) return;
    const file = makeSaveFile(this.sim, 'export');
    const date = formatDate(this.sim.dayIndex()).replace('年', '-').replace('月', '-').replace('日', '');
    downloadJson(`metro-plan-${date}.json`, JSON.stringify(file));
    this.ui.toast('已导出 JSON 存档', 'success');
  }

  async importSave(file: File): Promise<void> {
    if (this.sim) {
      const ok = await this.ui.confirm({
        title: '导入存档',
        body: '导入会用文件中的进度覆盖当前进度，当前未保存的进度将丢失。确定继续？',
        confirmLabel: '导入',
      });
      if (!ok) return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<SaveFile> & { format?: string };
      if (parsed.format !== 'metro-plan-save' || !parsed.data || !parsed.saveVersion) {
        throw new Error('不是有效的《交通规划》存档文件');
      }
      const mismatch = parsed.saveVersion !== SAVE_VERSION;
      const sim = restoreSim(parsed.data);
      const bg = await this.loadMapBackground(sim.mapId);
      this.startWithSim(sim, bg);
      this.ui.toast(
        mismatch
          ? `存档版本 ${parsed.saveVersion} 与当前 ${SAVE_VERSION} 不一致，可能无法正确加载`
          : '存档已导入',
        mismatch ? 'warn' : 'success',
      );
    } catch (err) {
      this.ui.showLoadError(`导入存档失败：${(err as Error).message}`);
    }
  }

  // ————————————————————————— 生命周期 —————————————————————————

  private startWithSim(sim: Simulation, backgroundImage: HTMLImageElement | null = null): void {
    this.unsub?.();
    this.sim = sim;
    this.unsub = sim.on(this.onSimEvent);
    this.tool = 'select';
    this.previewPos = null;
    this.lineDraft = [];
    this.pointer = null;
    this.hoverStation = null;
    this.hoverLine = null;
    this.hoverZone = null;
    this.selectedStation = null;
    this.selectedLine = null;
    this.selectedZone = null;
    this.ui.resetPanels();
    this.ui.resetTutorial();
    this.ui.resetTransient();
    this.ui.setTool('select');
    this.ui.setGroupFilter(new Array(7).fill(true));
    this.scene.resetCamera();
    if (this.editor.isActive()) this.editor.close();
    this.ui.root.classList.remove('hidden');
    if (sim.map) this.scene.setCustomMap(sim.map, sim.dots, sim.pois, backgroundImage, sim.pxPerKm);
    else this.scene.setCustomMap(null, [], [], null);
    this.scene.setResidentialPlaces(sim.residentialPlaces);
    this.scene.setPois(sim.pois);
    this.ui.hideMenu();
    this.applyMapStyle(sim.mapId);
    if (getBuiltinMap(sim.mapId)) this.rememberMap(sim.mapId);
    this.lastSavedGameMinute = sim.time;
    this.menuReturn = false;
    this.ui.update(sim);
    void this.refreshMetas();
  }

  private onSimEvent = (event: SimEvent): void => {
    if (event.type === 'settle') {
      this.ui.dailyCard(event.record);
      void this.autoSave();
    } else if (event.type === 'peakSoon') {
      this.ui.peak(event.kind === 'am' ? '早高峰即将开始' : '晚高峰即将开始');
      this.ui.toast(
        event.kind === 'am' ? '06:50 · 早高峰即将开始' : '16:50 · 晚高峰即将开始',
        'info',
      );
    } else if (event.type === 'period') {
      if (event.peak) this.ui.peak(`${event.label} · 自动 1x`);
    }
  };

  private async loadMapBackground(mapId: string): Promise<HTMLImageElement | null> {
    try {
      const stored = await getMap(mapId);
      const dataUrl = stored?.map.background?.dataUrl;
      if (!dataUrl) return null;
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      return img;
    } catch {
      return null;
    }
  }

  private async autoSave(): Promise<void> {
    if (!this.sim) return;
    try {
      await putSave(makeSaveFile(this.sim, 'auto'));
      this.lastSavedGameMinute = this.sim.time;
      this.ui.flashAutoSave();
      await this.refreshMetas();
    } catch {
      // 自动保存失败不打断游戏
    }
  }

  async openEditor(): Promise<void> {
    this.scene.resetCamera();
    this.sim?.setPaused(true);
    this.ui.hideMenu();
    this.ui.closeOverlay();
    this.ui.root.classList.add('hidden');
    await this.editor.open();
  }

  async closeEditor(): Promise<void> {
    this.editor.close();
    this.ui.root.classList.remove('hidden');
    if (this.sim) this.sim.setPaused(true);
    this.menuReturn = !!this.sim;
    await this.refreshMetas(this.sim?.mapId ?? this.lastMapId);
    this.ui.showMenu(this.menuInfo());
  }

  startCustomGame(sim: Simulation, map: CustomMapData, image: HTMLImageElement | null): void {
    this.editor.close();
    this.ui.root.classList.remove('hidden');
    this.startWithSim(sim, image);
    this.ui.toast(`开始游戏：${map.name}`, 'success');
  }

  newGame(mode: 'standard' | 'tutorial'): void {
    this.createGame(mode);
  }

  /** UI 入口：先显示加载卡片，再同步生成城市。 */
  async startNewGame(mode: 'standard' | 'tutorial'): Promise<void> {
    this.ui.showGameLoading(
      mode === 'tutorial' ? '正在准备教程' : '正在生成城市',
      '正在铺设路网与客流…',
    );
    // 让加载卡片先渲染一帧，再开始同步生成 10 万人的城市。
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => window.setTimeout(resolve, 56));
    });
    try {
      this.createGame(mode);
    } catch (err) {
      console.error('[metro-plan] 生成城市失败', err);
      this.ui.toast(`生成失败：${(err as Error).message}`, 'warn');
    } finally {
      this.ui.hideGameLoading();
    }
  }

  private createGame(mode: 'standard' | 'tutorial'): void {
    const def = getBuiltinMap(this.selectedMapId) ?? getBuiltinMap(DEFAULT_MAP_ID)!;
    const field = def.createField();
    const activityModel = M1_MODE
      ? buildActivityModel(field, { seed: 20260101 })
      : undefined;
    const sim = new Simulation({
      mode,
      field,
      mapId: def.id,
      mapName: def.name,
      pxPerKm: def.pxPerKm,
      activity: ACTIVITY_MODE,
      activityModel,
      demand: COMMUTER_MODE ? 'commuter' : 'mixed',
      // 默认只开 M2；M1 / M3 / M4 通过 ?m1=1 / ?m3=1 / ?m4=1 显式开启。
      walkNetwork: WALK_NETWORK,
      walkChoice: M4_MODE,
      enforceTerrain: def.style === 'terrain',
    });
    sim.setPaused(mode === 'tutorial');
    this.startWithSim(sim);
    this.ui.toast(
      mode === 'tutorial'
        ? `${def.name} · 先建两个车站，再画一条线`
        : `${def.name} · 先建站，再画线`,
      'info',
    );
  }

  async continueGame(): Promise<void> {
    if (this.menuReturn && this.sim) {
      this.ui.hideMenu();
      this.menuReturn = false;
      this.ui.toast('已回到当前进度', 'info');
      return;
    }
    try {
      const stored = await latestSave(this.lastMapId);
      if (!stored) {
        this.ui.showMenu(this.menuInfo());
        return;
      }
      const sim = restoreSim(stored.data);
      const bg = await this.loadMapBackground(sim.mapId);
      this.startWithSim(sim, bg);
      this.ui.toast(`已载入 ${stored.meta.dateLabel} 的存档`, 'success');
    } catch (err) {
      this.ui.showLoadError(`读取存档失败：${(err as Error).message}`);
    }
  }

  async backToMenu(): Promise<void> {
    const ok = await this.ui.confirm({
      title: '返回主菜单',
      body: '当前进度会保留在内存中，可通过「继续」返回。自动存档不受影响。',
      confirmLabel: '返回主菜单',
    });
    if (!ok) return;
    if (this.sim) this.sim.setPaused(true);
    this.menuReturn = true;
    await this.refreshMetas(this.sim?.mapId ?? this.lastMapId);
    this.ui.showMenu(this.menuInfo());
  }

  // 供调试使用
  getSaveMetas(): SaveMeta[] {
    return this.metas;
  }
}



