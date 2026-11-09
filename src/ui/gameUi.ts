import {
  EXPRESS_TRAIN_SPEED_KMH,
  GROUP_META,
  LINE_COLORS,
  LOCAL_TRAIN_SPEED_KMH,
  PROFILE_META,
  SEGMENT_COST,
  STATION_SIZES,
  TRAIN_DWELL,
} from '../sim/constants';
import { formatDate, formatClock, weekdayLabel } from '../sim/calendar';
import type { DayRecord, FareConfig, Line, Settings, Station, StationSize, TrainKind, Zone } from '../sim/types';
import type { Simulation } from '../sim/simulation';
import type { SaveMeta } from '../sim/save';
import { isLoopLine } from '../sim/network';
import type { StoredSave } from '../sim/storage';
import { escapeHtml, int, minuteText, relativeTime, yen } from './format';
import type { LayerVisibility } from '../render/scene';
import type { MapSummary } from '../maps/types';
import { renderMapCards } from './mapSelect';
import { icon } from './icons';
import menuBgUrl from '../../assets/maps/duanzhou-dinghu-simple.png';

export type Tool = 'select' | 'station' | 'line';

export interface UiActions {
  setPaused(value: boolean): void;
  setSpeed(speed: number): void;
  setTool(tool: Tool): void;
  confirmStation(): void;
  cancelPlacement(): void;
  undoStation(): void;
  finishLine(): void;
  cancelLine(): void;
  removeLine(lineId: number): void;
  extendLine(lineId: number): void;
  addTrain(lineId: number): void;
  removeTrain(lineId: number): void;
  clearSelection(): void;
  selectLine(lineId: number): void;
  setHighlightLine(lineId: number | null): void;
  setLineColor(lineId: number, colorIndex: number, hex: string): void;
  setLineService(lineId: number, startMin: number, endMin: number): void;
  setStationSize(size: StationSize): void;
  buyTrain(lineId: number, kind: TrainKind): void;
  setExpressStops(lineId: number, stationIds: number[]): void;
  openExpressPicker(lineId: number, buyAfter: boolean): void;
  setTrainSpan(lineId: number, trainId: number, startId: number, endId: number): void;
  setTrainSpanFlexible(lineId: number, trainId: number, startId: number, endId: number): void;
  swapTrainSpan(lineId: number, trainId: number): void;
  resetView(): void;
  toggleGroup(group: number): void;
  toggleSetting(key: keyof Settings): void;
  setFare(key: keyof FareConfig, value: number): void;
  resetFare(): void;
  saveSlot(slot: string): void;
  loadSlot(slot: string): void;
  deleteSlot(slot: string): void;
  exportSave(): void;
  importSave(file: File): void;
  newGame(mode: 'standard' | 'tutorial'): void;
  continueGame(): void;
  backToMenu(): void;
  openEditor(): void;
  openSaveModal(): void;
  openSettings(): void;
  newGameOnMap(mapId: string): void;
  startNewGame(mode: 'standard' | 'tutorial'): void;
}

export interface PlacementInfo {
  x: number;
  y: number;
  screen: { x: number; y: number };
  coverage: {
    residents: number;
    jobs: number;
    coreResidents: number;
    coreJobs: number;
    poiAttraction: number;
  };
  valid: boolean;
  reason?: string;
}

export interface MenuInfo {
  hasSave: boolean;
  latestLabel: string;
  maps: MapSummary[];
  selectedMapId: string;
  lastMapId: string;
  /** 当前选中地图的抽样 agent 数量 */
  population: number;
  /** 人群画像细分数（7 个行为群体之下的年龄 / 职业 / 走读住宿）。 */
  profileCount: number;
  /** 纯通勤局：只展示通勤 / 反向通勤两类群体。 */
  commuterOnly: boolean;
}

function parseClock(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function clockValue(minutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function parseColor(value: string): string | null {
  const raw = value.trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    let body = hex[1]!;
    if (body.length === 3) body = body.split('').map((c) => c + c).join('');
    return `#${body.toUpperCase()}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(raw);
  if (rgb) {
    const parts = [rgb[1]!, rgb[2]!, rgb[3]!].map((n) => Math.max(0, Math.min(255, Number(n))));
    return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  return null;
}

const METRIC_ICONS: Record<string, string> = {
  fund: 'coin',
  population: 'people',
  ridership: 'ticket',
  moving: 'arrow',
  cost: 'gear',
  net: 'trend',
  fare: 'tag',
  commute: 'clock',
};

export class GameUI {
  root: HTMLElement;
  overlay: HTMLElement;
  actions: UiActions;
  private sim: Simulation | null = null;
  private cache = new Map<string, string>();
  private openStationId: number | null = null;
  private openLineId: number | null = null;
  private groupFilter: boolean[] = new Array(GROUP_META.length).fill(true);
  private layers: LayerVisibility = {
    base: true,
    // 新矢量底图先只显示底图、线路与车站；旧住宅/就业/POI 数据仍保留，
    // 后续重新选取地点后再从图层面板打开。
    zones: false,
    od: false,
    lines: true,
    stations: true,
    heat: true,
    poi: false,
  };
  private highlightLineId: number | null = null;
  private lineLegendKey = '';
  private draftInit = false;
  private draftColorIndex = 0;
  private draftHex: string = LINE_COLORS[0]!.css;
  private draftStart = 360;
  private draftEnd = 1410;
  private tutorialDismissed = false;
  private peakTimer = 0;
  private dailyTimer = 0;
  private loadingTimer = 0;
  private menuVisible = false;
  private pendingMapId: string | null = null;
  /** HUD 的 DOM 更新节流到约 11 Hz；数据变化远慢于渲染帧率。 */
  private lastHudAt = 0;
  private lastPaused: boolean | null = null;
  private lastFareKey = '';
  private lastFareTip = '';
  private lastCostTip = '';
  private lastEmploymentTip = '';
  /** 连续低帧率 / 恢复帧率的采样数，用于玻璃效果自动降级。 */
  private lowFpsSamples = 0;
  private highFpsSamples = 0;
  private glassSaver = false;

  constructor(actions: UiActions) {
    this.actions = actions;
    this.root = document.getElementById('game-ui') as HTMLElement;
    this.overlay = document.getElementById('overlay') as HTMLElement;
    this.build();
    this.syncMapExtras();
  }

  private qs<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private setText(key: string, value: string, el?: HTMLElement | null): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    const node = el ?? this.qs(`[data-k="${key}"]`);
    if (node) node.textContent = value;
  }

  private build(): void {
    const groupButtons = GROUP_META.map(
      (g) =>
        `<button class="group-btn on${g.id >= 3 ? ' hidden' : ''}" data-group="${g.id}" aria-pressed="true" title="只看${g.name}的 OD 流带">
          <span class="gdot" style="background:${g.css}"></span><span>${g.short}</span>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <div class="vignette" aria-hidden="true"></div>
      <header class="hud" role="banner">
        <div class="clock-block">
          <div class="date-row">
            <span data-k="date">2026年1月1日</span>
            <span class="weekday" data-k="weekday">周四</span>
          </div>
          <div class="time-row">
            <span class="clock" data-k="clock">06:00</span>
            <span class="mode-tag" data-k="mode">自动 8x</span>
            <span class="peak-tag" id="peak-tag" hidden></span>
          </div>
        </div>
        <div class="speed-group" id="speed-group" role="group" aria-label="速度控制">
          <button class="speed-btn pause-btn" data-speed="0" title="暂停 / 继续（空格）">${icon('pause', 15)}</button>
          <button class="speed-btn" data-speed="1" title="1x：高峰精细观察">1x</button>
          <button class="speed-btn" data-speed="2" title="2x">2x</button>
          <button class="speed-btn" data-speed="4" title="4x">4x</button>
          <button class="speed-btn" data-speed="8" title="8x：平峰">8x</button>
          <button class="speed-btn" data-speed="16" title="16x：夜间">16x</button>
        </div>
        <div class="metrics">
          ${this.metric('fund', '基金', '¥50,000', '剩余基金 · 每日 00:00 结算')}
          ${this.metric('population', '人口', '0', '当前区域总人口 = 当前 agent 数量')}
          ${this.metric('employment', '就业率', '—', '就业人口 / 劳动力（灵活就业也算就业）；通勤范围内没有岗位的人按灵活人群活动')}
          ${this.metric('ridership', '客流', '0', '今日客流 · 每上车一次计 1 人次')}
          ${this.metric('moving', '出行中', '0', '当前正在步行 / 候车 / 乘车的人数')}
          ${this.metric('cost', '运营', '¥0', '日运营成本 · 列车 ¥100 + 车站 ¥30（含闲置站）')}
          ${this.metric('net', '净利', '¥0', '今日净利 = 票款 − 运营成本')}
          ${this.metric('fare', '票价', '¥2 起', '点击修改分段票价', true)}
          ${this.metric('commute', '通勤', '—', '今日平均通勤时间（出发到最终步行到达）')}
        </div>
        <div class="hud-actions">
          <div class="fps-badge" id="fps-badge" title="当前帧率">${icon('gauge', 14)}<b>60</b><span>FPS</span></div>
          <button class="icon-btn" id="btn-save" title="保存进度（Ctrl+S）">${icon('save', 17)}</button>
          <button class="icon-btn" id="btn-settings" title="设置">${icon('settings', 17)}</button>
        </div>
      </header>

      <div class="layer-popover popover hidden" id="layer-popover" role="dialog" aria-label="显示图层">
        <div class="lp-head">
          <div>
            <div class="lp-kicker">MAP LAYERS</div>
            <div class="lp-title">显示图层</div>
          </div>
          <button class="lp-close" id="layer-close" aria-label="关闭图层面板">${icon('close', 14)}</button>
        </div>
        <div class="lp-list">
          ${(
            [
              ['base', '底图', '#CDBB9E'],
              ['heat', '实时热力', '#C0392B'],
              ['zones', '功能区气泡', '#B79E7E'],
              ['od', 'OD 流带', '#9A8873'],
              ['lines', '线路', '#C25B4A'],
              ['stations', '站点与列车', '#3E6E9E'],
              ['poi', 'POI 地点', '#7E9C72'],
            ] as const
          )
            .map(
              ([key, label, color]) =>
                `<label class="lp-row">
                  <span class="lp-name"><i class="lp-dot" style="--c:${color}"></i>${label}</span>
                  <span class="lp-switch"><input type="checkbox" data-layer-key="${key}" ${this.layers[key] ? 'checked' : ''} /><i></i></span>
                </label>`,
            )
            .join('')}
        </div>
        <div class="lp-actions">
          <button class="lp-preset" data-layer-preset="all">全部显示</button>
          <button class="lp-preset" data-layer-preset="clean">只看底图</button>
        </div>
      </div>

      <div class="fare-popover popover hidden" id="fare-popover" role="dialog" aria-label="票价设置">
        <div class="lp-head">
          <div>
            <div class="lp-kicker">FARE</div>
            <div class="lp-title">票价</div>
          </div>
          <button class="lp-close" id="fare-close" aria-label="关闭票价面板">${icon('close', 14)}</button>
        </div>
        <div class="fare-rows">
          <div class="fare-row">
            <span>起步价</span>
            <div class="stepper">
              <button data-fare="base" data-dir="-1" aria-label="降低起步价">−</button>
              <b data-fare-val="base">2</b>
              <button data-fare="base" data-dir="1" aria-label="提高起步价">+</button>
            </div>
          </div>
          <div class="fare-row">
            <span>含公里</span>
            <div class="stepper">
              <button data-fare="freeKm" data-dir="-1" aria-label="减少含公里">−</button>
              <b data-fare-val="freeKm">6</b>
              <button data-fare="freeKm" data-dir="1" aria-label="增加含公里">+</button>
            </div>
          </div>
          <div class="fare-row">
            <span>每段公里</span>
            <div class="stepper">
              <button data-fare="stepKm" data-dir="-1" aria-label="减少每段公里">−</button>
              <b data-fare-val="stepKm">6</b>
              <button data-fare="stepKm" data-dir="1" aria-label="增加每段公里">+</button>
            </div>
          </div>
          <div class="fare-row">
            <span>每段加价</span>
            <div class="stepper">
              <button data-fare="step" data-dir="-1" aria-label="降低每段加价">−</button>
              <b data-fare-val="step">1</b>
              <button data-fare="step" data-dir="1" aria-label="提高每段加价">+</button>
            </div>
          </div>
        </div>
        <div class="fare-ladder" id="fare-ladder"></div>
        <div class="lp-actions">
          <button class="lp-preset" id="fare-reset">恢复默认</button>
        </div>
      </div>

      <div class="toolbar" role="toolbar" aria-label="建设工具">
        <span class="tool-indicator" id="tool-indicator" aria-hidden="true"></span>
        <button class="tool active" data-tool="select" data-tip="查看 · 拖动地图，点击车站 / 线路（V）" aria-label="查看">
          ${icon('cursor', 19)}
        </button>
        <button class="tool" data-tool="station" data-tip="建站 · 点击位置预览，Enter 确认（B）" aria-label="建站">
          ${icon('station', 19)}
        </button>
        <button class="tool" data-tool="line" data-tip="画线 · 依次点击车站，Enter 完成（L）" aria-label="画线">
          ${icon('line', 19)}
        </button>
        <button class="tool hidden" data-tool="undo" id="btn-undo" data-tip="撤回最近一个未接线的车站" aria-label="撤回">
          ${icon('undo', 19)}
        </button>
      </div>

      <div class="map-legend">
        <div class="legend-tools">
          <button class="legend-btn" id="btn-layers" title="显示图层">${icon('layers', 15)}<span>图层</span></button>
          <button class="legend-btn" id="btn-reset" title="复位视图">${icon('reset', 14)}<span>复位</span></button>
        </div>
        <div class="line-legend" id="line-legend"></div>
        <div class="scale-bar hidden" id="scale-bar">
          <span class="scale-line" id="scale-line"></span>
          <span class="scale-label" id="scale-label">2 km</span>
        </div>
        <div class="heat-legend hidden" id="heat-legend" title="正在外出的人流密度">
          <span class="heat-legend-label">人流</span>
          <span class="heat-gradient"></span>
          <span class="heat-legend-scale">少</span>
          <span class="heat-legend-scale">多</span>
        </div>
        <div class="legend" title="外圈 = 组团范围；中心核 = 人口 / 岗位，核越大越密">
          <span><i class="dot res"></i>住宅</span>
          <span><i class="dot emp"></i>就业</span>
        </div>
      </div>

      <div class="filters" role="group" aria-label="群体筛选">${groupButtons}</div>

      <div class="draft-panel hidden" id="draft-panel">
        <div class="draft-info">
          <span class="draft-title" data-k="draft-title">画线中</span>
          <span data-k="draft-count">0 站</span>
          <b data-k="draft-cost">¥0</b>
        </div>
        <div class="draft-colors" id="draft-colors">
          ${LINE_COLORS.map(
            (c, i) =>
              `<button class="draft-swatch" data-draft-swatch="${i}" style="--c:${c.css}" title="${c.name}"></button>`,
          ).join('')}
          <input type="color" id="draft-color" value="${LINE_COLORS[0]!.css}" title="自定义线路颜色" />
          <input type="text" class="hex-input" id="draft-hex" value="${LINE_COLORS[0]!.css}" maxlength="18" spellcheck="false" title="输入 #RRGGBB 或 rgb(r,g,b)" />
        </div>
        <label class="draft-time">运营
          <input type="time" id="draft-start" value="06:00" />
          <span>–</span>
          <input type="time" id="draft-end" value="23:30" />
        </label>
        <div class="draft-actions">
          <button class="btn primary" id="draft-finish" data-k="draft-finish">完成</button>
          <button class="btn ghost" id="draft-cancel">取消</button>
        </div>
      </div>

      <aside class="panel station-panel hidden" id="station-panel" aria-live="polite"></aside>
      <aside class="panel line-panel hidden" id="line-panel" aria-live="polite"></aside>
      <aside class="panel express-panel hidden" id="express-panel" aria-live="polite"></aside>

      <div class="placement popover hidden" id="placement" aria-live="polite"></div>
      <div class="zone-popup popover hidden" id="zone-popup"></div>
      <div class="hover-label hidden" id="hover-label"></div>
      <div class="surge-bubble hidden" id="surge-bubble" role="status" aria-live="polite"></div>

      <div class="toasts" id="toasts" role="status" aria-live="polite"></div>
      <div class="daily-card hidden" id="daily-card" role="status" aria-live="polite"></div>

      <div class="tutorial hidden" id="tutorial">
        <div class="tut-step" data-k="tut-step">1</div>
        <div class="tut-text">
          <b data-k="tut-title">建一个车站</b>
          <span data-k="tut-body">点击地图选择位置，确认后扣 ¥1,000。</span>
        </div>
        <button class="tut-close" id="tut-close" title="隐藏提示">${icon('close', 14)}</button>
      </div>

      <input type="file" id="file-import" accept=".json,application/json" hidden />
    `;

    // 顶栏按钮
    this.qs('#btn-save').addEventListener('click', () => this.actions.openSaveModal());
    this.qs('#btn-settings').addEventListener('click', () => this.actions.openSettings());

    this.qs('#speed-group').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-speed]');
      if (!btn) return;
      const speed = Number(btn.dataset.speed);
      if (speed === 0) this.actions.setPaused(!(this.sim?.paused ?? false));
      else this.actions.setSpeed(speed);
    });

    this.qs('.toolbar').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (tool === 'undo') this.actions.undoStation();
      else this.actions.setTool(tool as Tool);
    });

    this.qs('.filters').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-group]');
      if (!btn) return;
      const group = Number(btn.dataset.group);
      const next = !this.groupFilter[group];
      this.groupFilter[group] = next;
      btn.classList.toggle('on', next);
      btn.setAttribute('aria-pressed', String(next));
      this.actions.toggleGroup(group);
    });

    this.qs('#btn-layers').addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.actions.clearSelection();
      this.hideStation();
      this.hideLine();
      const popover = this.qs('#layer-popover');
      const show = popover.classList.contains('hidden');
      popover.classList.toggle('hidden', !show);
      if (show) this.positionLayerPopover();
    });
    this.qs('#btn-reset').addEventListener('click', () => this.actions.resetView());
    this.qs('#layer-close').addEventListener('click', () => this.hideLayerPopover());
    this.qs('#layer-popover').addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      const key = input.dataset.layerKey as keyof LayerVisibility | undefined;
      if (!key) return;
      this.layers[key] = input.checked;
      this.syncMapExtras();
    });
    this.qs('#layer-popover').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-layer-preset]');
      if (btn) {
        const preset = btn.dataset.layerPreset;
        const on = preset === 'all';
        for (const key of Object.keys(this.layers) as Array<keyof LayerVisibility>) {
          this.layers[key] = key === 'base' ? true : on;
        }
        this.syncLayerChecks();
        return;
      }
    });
    document.addEventListener('pointerdown', (ev) => {
      const target = ev.target as Node;
      if (this.qs('#layer-popover').classList.contains('hidden')) return;
      if (this.qs('#layer-popover').contains(target) || this.qs('#btn-layers').contains(target)) return;
      this.hideLayerPopover();
    });

    // 票价面板：点 HUD 上的「票价」打开，用步进器改分段票价。
    this.qs('[data-metric="fare"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const metric = this.qs('[data-metric="fare"]');
      const popover = this.qs('#fare-popover');
      const show = popover.classList.contains('hidden');
      popover.classList.toggle('hidden', !show);
      if (show) {
        const rect = metric.getBoundingClientRect();
        popover.style.right = 'auto';
        popover.style.left = `${Math.max(12, Math.min(window.innerWidth - 262, rect.left - 96))}px`;
        popover.style.top = `${rect.bottom + 10}px`;
        if (this.sim) this.update(this.sim, true);
      }
    });
    this.qs('.metrics').addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-metric="fare"]');
      if (!target) return;
      ev.preventDefault();
      target.click();
    });
    this.qs('#fare-close').addEventListener('click', () => this.qs('#fare-popover').classList.add('hidden'));
    this.qs('#fare-reset').addEventListener('click', () => this.actions.resetFare());
    this.qs('#fare-popover').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-fare][data-dir]');
      if (!btn || !this.sim) return;
      const key = btn.dataset.fare as keyof FareConfig;
      const dir = Number(btn.dataset.dir);
      this.actions.setFare(key, (this.sim.fare[key] ?? 0) + dir);
      this.update(this.sim);
    });
    document.addEventListener('pointerdown', (ev) => {
      const target = ev.target as Node;
      const popover = this.qs('#fare-popover');
      if (popover.classList.contains('hidden')) return;
      if (popover.contains(target) || this.qs('[data-metric="fare"]').contains(target)) return;
      popover.classList.add('hidden');
    });

    this.qs('#line-legend').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-legend-line]');
      if (!btn) return;
      const id = Number(btn.dataset.legendLine);
      const next = this.highlightLineId === id ? null : id;
      this.highlightLineId = next;
      this.actions.setHighlightLine(next);
      if (next !== null) this.actions.selectLine(id);
      if (this.sim) this.syncLineLegend(this.sim);
    });

    this.qs('#draft-colors').addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-draft-swatch]');
      if (!btn) return;
      const index = Number(btn.dataset.draftSwatch);
      const color = LINE_COLORS[index];
      if (!color) return;
      this.draftColorIndex = index;
      this.draftHex = color.css;
      this.syncDraftColorUI();
    });
    this.qs<HTMLInputElement>('#draft-color').addEventListener('input', (ev) => {
      const input = ev.target as HTMLInputElement;
      this.draftHex = input.value;
      this.syncDraftColorUI();
    });
    this.qs<HTMLInputElement>('#draft-hex').addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      const parsed = parseColor(input.value);
      if (!parsed) {
        input.value = this.draftHex;
        return;
      }
      this.draftHex = parsed;
      this.syncDraftColorUI();
    });
    this.qs<HTMLInputElement>('#draft-start').addEventListener('change', (ev) => {
      this.draftStart = parseClock((ev.target as HTMLInputElement).value, this.draftStart);
    });
    this.qs<HTMLInputElement>('#draft-end').addEventListener('change', (ev) => {
      this.draftEnd = parseClock((ev.target as HTMLInputElement).value, this.draftEnd);
    });

    this.qs('#draft-finish').addEventListener('click', () => this.actions.finishLine());
    this.qs('#draft-cancel').addEventListener('click', () => this.actions.cancelLine());
    this.qs('#tut-close').addEventListener('click', () => {
      this.tutorialDismissed = true;
      this.qs('#tutorial').classList.add('hidden');
    });

    this.qs<HTMLInputElement>('#file-import').addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) this.actions.importSave(file);
      input.value = '';
    });

    this.overlay.addEventListener('change', (ev) => {
      const input = (ev.target as HTMLElement).closest<HTMLInputElement>('[data-fare]');
      if (!input) return;
      const key = input.dataset.fare as keyof FareConfig;
      const value = Number(input.value);
      if (Number.isFinite(value)) this.actions.setFare(key, value);
    });

    this.overlay.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const act = target.closest<HTMLElement>('[data-act]');
      if (act) {
        this.handleMenuAction(act.dataset.act ?? '');
        return;
      }
      const mode = target.closest<HTMLElement>('[data-mode]');
      if (mode) {
        this.overlay.querySelectorAll('[data-mode]').forEach((el) => el.classList.remove('selected'));
        mode.classList.add('selected');
        return;
      }
      const mapCard = target.closest<HTMLElement>('[data-map-id]');
      if (mapCard) {
        this.pendingMapId = mapCard.dataset.mapId ?? null;
        this.overlay.querySelectorAll('[data-map-id]').forEach((el) => el.classList.remove('selected'));
        mapCard.classList.add('selected');
        return;
      }
      const slot = target.closest<HTMLElement>('[data-slot]');
      if (slot) {
        const doWhat = slot.dataset.do;
        const slotId = slot.dataset.slot ?? '';
        if (doWhat === 'save') this.actions.saveSlot(slotId);
        else if (doWhat === 'load') this.actions.loadSlot(slotId);
        else if (doWhat === 'delete') void this.actions.deleteSlot(slotId);
        return;
      }
      const toggle = target.closest<HTMLElement>('[data-key]');
      if (toggle) {
        const key = toggle.dataset.key as keyof Settings;
        this.actions.toggleSetting(key);
        toggle.classList.toggle('on');
        return;
      }
      const doAct = target.closest<HTMLElement>('[data-do]');
      if (doAct) {
        const what = doAct.dataset.do;
        if (what === 'export') this.actions.exportSave();
        else if (what === 'import') this.qs<HTMLInputElement>('#file-import').click();
        else if (what === 'menu') this.actions.backToMenu();
        else if (what === 'close') this.closeOverlay();
        else if (what === 'new') this.showNewGameMaps();
        else if (what === 'map-start') {
          const id = this.pendingMapId;
          if (id) {
            this.closeOverlay();
            this.actions.newGameOnMap(id);
          }
        }
        else if (what === 'settings') this.actions.openSettings();
        else if (what === 'start') {
          const selected = this.overlay.querySelector<HTMLElement>('.mode-card.selected');
          const mode = selected?.dataset.mode === 'tutorial' ? 'tutorial' : 'standard';
          this.actions.startNewGame(mode);
        }
        else if (what === 'confirm') this.resolveConfirm(true);
        else if (what === 'cancel') this.resolveConfirm(false);
        return;
      }
      if (target.dataset.act === 'dismiss' || target.classList.contains('modal-backdrop')) {
        if (target.classList.contains('modal-backdrop')) this.closeOverlay();
      }
    });

    requestAnimationFrame(() => this.syncToolIndicator());
    window.addEventListener('resize', () => {
      this.syncToolIndicator();
      const open = this.root.querySelector<HTMLElement>('.panel:not(.hidden)');
      if (open) this.syncPanelScroll(open);
    });
    if (typeof ResizeObserver !== 'undefined') {
      // 菜单显示/隐藏会改变工具栏尺寸，指示块需要跟着重新测量。
      new ResizeObserver(() => this.syncToolIndicator()).observe(this.qs('.toolbar'));
    }
  }

  /** 面板内容真的放不下时才显示底部渐隐与自绘滚动条。 */
  private syncPanelScroll(panel: HTMLElement): void {
    const scroll = panel.querySelector<HTMLElement>('.panel-scroll');
    if (!scroll) return;
    const can = scroll.scrollHeight > scroll.clientHeight + 2;
    panel.classList.toggle('can-scroll', can);
    let rail = panel.querySelector<HTMLElement>('.panel-rail');
    if (!can) {
      rail?.remove();
      return;
    }
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'panel-rail';
      rail.setAttribute('aria-hidden', 'true');
      rail.innerHTML = '<i></i>';
      panel.appendChild(rail);
      scroll.addEventListener('scroll', () => this.positionPanelRail(panel), { passive: true });
    }
    rail.style.top = `${scroll.offsetTop + 6}px`;
    rail.style.height = `${Math.max(0, scroll.clientHeight - 12)}px`;
    this.positionPanelRail(panel);
  }

  private positionPanelRail(panel: HTMLElement): void {
    const scroll = panel.querySelector<HTMLElement>('.panel-scroll');
    const rail = panel.querySelector<HTMLElement>('.panel-rail');
    const thumb = rail?.firstElementChild as HTMLElement | null;
    if (!scroll || !rail || !thumb) return;
    const track = rail.clientHeight;
    if (track <= 0) return;
    const height = Math.max(26, Math.round(track * (scroll.clientHeight / scroll.scrollHeight)));
    const maxScroll = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    const offset = Math.round((scroll.scrollTop / maxScroll) * (track - height));
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${offset}px)`;
  }
  private syncToolIndicator(): void {
    const bar = this.qs('#tool-indicator');
    const active = this.root.querySelector<HTMLElement>('.tool.active:not(.hidden)');
    if (!bar) return;
    if (!active) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    // 菜单打开时工具栏是 display:none，尺寸为 0；等它重新出现再定位。
    if (active.offsetHeight === 0) {
      bar.classList.add('hidden');
      return;
    }
    const horizontal = window.matchMedia('(max-width: 900px)').matches;
    if (horizontal) {
      bar.style.width = `${active.offsetWidth}px`;
      bar.style.height = `${active.offsetHeight}px`;
      bar.style.transform = `translate(${active.offsetLeft - 6}px, ${active.offsetTop - 6}px)`;
    } else {
      bar.style.width = '';
      bar.style.height = `${active.offsetHeight}px`;
      bar.style.transform = `translateY(${active.offsetTop - 6}px)`;
    }
  }

  private metric(key: string, label: string, value: string, tip: string, clickable = false): string {
    return `
      <div class="metric${clickable ? ' clickable' : ''}" data-metric="${key}" data-tip="${tip}"
        ${clickable ? 'role="button" tabindex="0" aria-label="' + tip + '"' : ''}>
        <span class="m-icon">${icon(METRIC_ICONS[key] ?? 'dot', 15)}</span>
        <span class="m-text">
          <span class="m-label">${label}</span>
          <span class="m-value" data-k="${key}">${value}</span>
        </span>
      </div>`;
  }

  // ————————————————————————— 每帧刷新 —————————————————————————

  update(sim: Simulation, force = false): void {
    this.sim = sim;
    // 每帧都重排整个 HUD 会持续触发样式计算；数据类信息 90ms 刷新一次足够。
    const now = performance.now();
    if (!force && now - this.lastHudAt < 90) return;
    this.lastHudAt = now;

    const date = formatDate(sim.dayIndex());
    const weekday = weekdayLabel(sim.dayIndex());
    const clock = formatClock(sim.timeOfDay());
    this.setText('date', date);
    this.setText('weekday', weekday);
    this.setText('clock', clock);
    this.qs('.clock-block').classList.toggle('paused', sim.paused);

    const speed = sim.currentSpeed();
    const mode = sim.paused
      ? '已暂停'
      : sim.isManualSpeed()
        ? `手动 ${speed}x`
        : `自动 ${speed}x`;
    this.setText('mode', mode);

    if (this.lastPaused !== sim.paused) {
      const pauseBtn = this.qs<HTMLElement>('[data-speed="0"]');
      pauseBtn.innerHTML = sim.paused ? icon('play', 15) : icon('pause', 15);
      pauseBtn.title = sim.paused ? '继续（空格）' : '暂停（空格）';
      pauseBtn.setAttribute('aria-label', sim.paused ? '继续' : '暂停');
      this.lastPaused = sim.paused;
    }

    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-speed]')) {
      const s = Number(btn.dataset.speed);
      const active = s === 0 ? sim.paused : !sim.paused && speed === s;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    this.setText('fund', yen(sim.fund));
    this.qs('[data-k="fund"]').classList.toggle('negative', sim.fund < 0);
    this.setText('population', int(sim.agents.count));
    const employment = sim.employmentStats();
    this.setText('employment', `${Math.round(employment.rate * 100)}%`);
    const employmentTip = `就业 ${int(employment.employed)} / 劳动力 ${int(employment.laborForce)}（灵活就业计入）；规划线网完善后会有更多人找到工作`;
    if (this.lastEmploymentTip !== employmentTip) {
      this.lastEmploymentTip = employmentTip;
      this.qs('[data-metric="employment"]').dataset.tip = employmentTip;
    }
    this.setText('ridership', int(sim.stats.ridership));
    this.setText('moving', int(sim.activeTravelers()));
    this.setText('cost', yen(sim.todayCost()));
    const net = sim.todayRevenue() - sim.todayCost();
    this.setText('net', yen(net));
    this.qs('[data-k="net"]').classList.toggle('negative', net < 0);
    this.setText('fare', `¥${sim.fare.base} 起`);

    const fareTip = `分段票价：¥${sim.fare.base} 含 ${sim.fare.freeKm} km，之后每 ${sim.fare.stepKm} km +¥${sim.fare.step}`;
    if (this.lastFareTip !== fareTip) {
      this.lastFareTip = fareTip;
      this.qs('[data-metric="fare"]').dataset.tip = fareTip;
    }
    const fareKey = `${sim.fare.base}|${sim.fare.freeKm}|${sim.fare.stepKm}|${sim.fare.step}`;
    if (this.lastFareKey !== fareKey) {
      this.lastFareKey = fareKey;
      for (const key of ['base', 'freeKm', 'stepKm', 'step'] as const) {
        const el = this.qs(`[data-fare-val="${key}"]`);
        if (el) el.textContent = String(sim.fare[key]);
      }
      const ladder = [3, 8, 14, 20, 30]
        .map((km) => `<span>${km} km <b>¥${sim.fareForKm(km)}</b></span>`)
        .join('');
      const ladderEl = this.qs('#fare-ladder');
      if (ladderEl) ladderEl.innerHTML = ladder;
    }
    this.setText('commute', minuteText(sim.avgCommute()));

    const idle = sim.net.stations.filter((s) => s.lines.length === 0).length;
    const costTip = `日运营成本 · 列车 ${sim.net.trains.length} × ¥100 + 车站 ${sim.net.stations.length} × ¥30（含闲置 ${idle}）`;
    if (this.lastCostTip !== costTip) {
      this.lastCostTip = costTip;
      this.qs('[data-metric="cost"]').dataset.tip = costTip;
    }

    this.syncGroupButtons(sim);
    this.syncLineLegend(sim);
    this.syncLineLive();
    this.qs('#btn-undo').classList.toggle('hidden', !sim.canUndoStation());
    this.syncStationPanel();
    this.syncLinePanel();
    this.updateTutorial(sim);
  }

  setTool(tool: Tool): void {
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-tool]')) {
      const on = btn.dataset.tool === tool;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    this.root.classList.toggle('build-mode', tool === 'station' || tool === 'line');
    this.syncToolIndicator();
  }

  getLayers(): LayerVisibility {
    return this.layers;
  }

  /** Used by the map adapter when switching between vector / plain / custom maps. */
  setLayer(key: keyof LayerVisibility, visible: boolean): void {
    this.layers[key] = visible;
    this.syncLayerChecks();
  }

  private positionLayerPopover(): void {
    const btn = this.qs('#btn-layers');
    const popover = this.qs('#layer-popover');
    const rect = btn.getBoundingClientRect();
    // 放在左下角按钮的右侧，避免盖住左侧工具栏。
    popover.style.left = `${Math.max(12, Math.min(window.innerWidth - 244, rect.right + 10))}px`;
    popover.style.bottom = `${Math.max(12, window.innerHeight - rect.bottom)}px`;
  }

  private hideLayerPopover(): void {
    this.qs('#layer-popover').classList.add('hidden');
  }

  /** 关闭票价 / 图层这类轻浮层；返回是否真的关掉了东西。 */
  closePopovers(): boolean {
    let closed = false;
    const layer = this.qs('#layer-popover');
    if (!layer.classList.contains('hidden')) {
      layer.classList.add('hidden');
      closed = true;
    }
    const fare = this.qs('#fare-popover');
    if (!fare.classList.contains('hidden')) {
      fare.classList.add('hidden');
      closed = true;
    }
    return closed;
  }

  private syncLayerChecks(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-layer-key]')) {
      const key = input.dataset.layerKey as keyof LayerVisibility;
      input.checked = this.layers[key];
    }
    this.syncMapExtras();
  }

  /** 旧住宅/就业/POI 图层关闭时，不显示对应的图例与群体筛选。 */
  private syncMapExtras(): void {
    this.qs('.legend').classList.toggle('hidden', !this.layers.zones);
    this.qs('.filters').classList.toggle('hidden', !this.layers.zones && !this.layers.poi);
    this.qs('#heat-legend').classList.toggle('hidden', !this.layers.heat);
  }

  setFps(fps: number): void {
    const el = this.qs('#fps-badge');
    const value = el.querySelector('b');
    if (!value) return;
    const text = String(Math.max(0, Math.round(fps)));
    if (this.cache.get('fps') !== text) {
      this.cache.set('fps', text);
      value.textContent = text;
    }
    el.classList.toggle('low', fps < 35);
    el.classList.toggle('mid', fps >= 35 && fps < 55);
    this.guardGlassEffects(fps);
  }

  /**
   * 持续低于 30 FPS 1.5s 时关闭背景模糊与深阴影；回到 50 FPS 以上 6s 后再打开。
   * 采样来自现有 500ms FPS 统计，不额外增加每帧开销。
   */
  private guardGlassEffects(fps: number): void {
    if (typeof document === 'undefined') return;
    if (fps < 30) {
      this.highFpsSamples = 0;
      this.lowFpsSamples++;
      if (!this.glassSaver && this.lowFpsSamples >= 3) {
        this.glassSaver = true;
        this.lowFpsSamples = 0;
        document.body.classList.add('perf-saver');
      }
    } else if (fps > 50) {
      this.lowFpsSamples = 0;
      this.highFpsSamples++;
      if (this.glassSaver && this.highFpsSamples >= 12) {
        this.glassSaver = false;
        this.highFpsSamples = 0;
        document.body.classList.remove('perf-saver');
      }
    } else {
      this.lowFpsSamples = 0;
      this.highFpsSamples = 0;
    }
  }

  setScaleBar(pxPerKm: number, screenScale: number, visible: boolean): void {
    const bar = this.qs('#scale-bar');
    const show = visible && Number.isFinite(pxPerKm) && pxPerKm > 0 && screenScale > 0;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const candidates = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
    let chosen = candidates[candidates.length - 1]!;
    for (const c of candidates) {
      if (pxPerKm * c * screenScale >= 26) {
        chosen = c;
        break;
      }
    }
    const width = Math.max(12, Math.round(pxPerKm * chosen * screenScale));
    const line = this.qs('#scale-line');
    line.style.width = `${width}px`;
    const label = this.qs('#scale-label');
    label.textContent = chosen >= 1 ? `${chosen} km` : `${Math.round(chosen * 1000)} m`;
  }

  getDraftSettings(): { colorIndex: number; hex: string; startMin: number; endMin: number } {
    return {
      colorIndex: this.draftColorIndex,
      hex: this.draftHex,
      startMin: this.draftStart,
      endMin: this.draftEnd,
    };
  }

  private lineLabel(line: Line): string {
    return line.branchOf ? `${line.branchOf} 号线支线` : `${line.id} 号线`;
  }

  syncLineLegend(sim: Simulation): void {    const key = `${sim.net.lines.map((l) => `${l.id}:${l.hex}:${l.color}`).join('|')}|${this.highlightLineId ?? -1}`;
    if (key === this.lineLegendKey) return;
    this.lineLegendKey = key;
    if (this.highlightLineId !== null && !sim.net.lineById.has(this.highlightLineId)) {
      this.highlightLineId = null;
      this.actions.setHighlightLine(null);
    }
    const el = this.qs('#line-legend');
    if (sim.net.lines.length === 0) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = sim.net.lines
      .map((line) => {
        const active = this.highlightLineId === line.id;
        return `<button class="line-chip${active ? ' active' : ''}" data-legend-line="${line.id}" style="--c:${line.hex}" title="${this.lineLabel(line)} · 点击高亮">
          <i></i>${this.lineLabel(line)}
        </button>`;
      })
      .join('');
  }

  private syncDraftColorUI(): void {
    this.root.querySelectorAll<HTMLElement>('[data-draft-swatch]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.draftSwatch) === this.draftColorIndex);
    });
    const input = this.qs<HTMLInputElement>('#draft-color');
    if (input && input.value.toLowerCase() !== this.draftHex.toLowerCase()) input.value = this.draftHex;
    const hexInput = this.qs<HTMLInputElement>('#draft-hex');
    if (hexInput && hexInput.value.toUpperCase() !== this.draftHex.toUpperCase()) hexInput.value = this.draftHex;
  }

  getGroupFilter(): boolean[] {
    return this.groupFilter;
  }

  setGroupFilter(filter: boolean[]): void {
    this.groupFilter = filter;
    this.root.querySelectorAll<HTMLElement>('[data-group]').forEach((btn) => {
      const g = Number(btn.dataset.group);
      btn.classList.toggle('on', filter[g]);
      btn.setAttribute('aria-pressed', String(filter[g]));
    });
  }

  // ————————————————————————— 提示 —————————————————————————

  showGameLoading(title = '正在生成城市', note = '正在铺设路网与客流…'): void {
    const el = document.getElementById('game-loading');
    if (!el) return;
    window.clearTimeout(this.loadingTimer);
    const titleEl = el.querySelector<HTMLElement>('[data-k="gl-title"]');
    const noteEl = el.querySelector<HTMLElement>('[data-k="gl-note"]');
    if (titleEl) titleEl.textContent = title;
    if (noteEl) noteEl.textContent = note;
    el.classList.remove('hidden');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
  }

  hideGameLoading(): void {
    const el = document.getElementById('game-loading');
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
    window.clearTimeout(this.loadingTimer);
    this.loadingTimer = window.setTimeout(() => el.classList.add('hidden'), 320);
  }

  toast(text: string, kind: 'info' | 'success' | 'warn' = 'info'): void {
    const wrap = this.qs('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const glyph = kind === 'success' ? 'check' : kind === 'warn' ? 'warning' : 'dot';
    el.innerHTML = `<span class="t-ico">${icon(glyph, 12)}</span><span>${text}</span>`;
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstElementChild!);
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 260);
    }, 2100);
  }

  peak(label: string): void {
    const tag = this.qs('#peak-tag');
    tag.textContent = label;
    tag.hidden = false;
    tag.classList.remove('show');
    void tag.offsetWidth;
    tag.classList.add('show');
    // 只保留 2.4s，用过渡淡出；不再依赖动画结束事件，避免留下一段透明空位。
    window.clearTimeout(this.peakTimer);
    this.peakTimer = window.setTimeout(() => {
      tag.classList.remove('show');
    }, 2400);
  }

  dailyCard(record: DayRecord): void {
    const card = this.qs('#daily-card');
    const net = record.revenue - record.cost;
    const margin = record.revenue > 0 ? (net / record.revenue) * 100 : 0;
    const perStation = record.stations > 0 ? record.ridership / record.stations : 0;
    card.innerHTML = `
      <div class="d-head">
        <span>${formatDate(record.labelDay)}</span>
        <b>${record.fund < 0 ? '基金告急' : '日结算'}</b>
      </div>
      <div class="d-row"><span>客流</span><b>${int(record.ridership)}</b></div>
      <div class="d-row"><span>取消出行</span><b class="neg">${int(record.cancelled ?? 0)} 次</b></div>
      <div class="d-row"><span>服务可靠性</span><b>${(Math.round((record.reliability ?? 1) * 1000) / 10).toFixed(1)}%</b></div>
      <div class="d-row"><span>票款</span><b class="pos">+${yen(record.revenue)}</b></div>
      <div class="d-row"><span>运营</span><b class="neg">−${yen(record.cost)}</b></div>
      <div class="d-row"><span>净利</span><b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${yen(Math.abs(net))}</b></div>
      <div class="d-row"><span>毛利率</span><b>${margin.toFixed(0)}%</b></div>
      <div class="d-row"><span>站均客流</span><b>${int(Math.round(perStation))}</b></div>
      <div class="d-row total"><span>基金</span><b>${yen(record.fund)}</b></div>
    `;
    card.classList.remove('hidden');
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
    window.clearTimeout(this.dailyTimer);
    this.dailyTimer = window.setTimeout(() => card.classList.remove('show'), 3400);
  }

  flashSaved(text: string): void {
    this.toast(text, 'success');
  }

  flashAutoSave(): void {
    const btn = this.qs('#btn-save');
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
    window.setTimeout(() => btn.classList.remove('pulse'), 1500);
  }

  resetPanels(): void {
    this.hideStation();
    this.hideLine();
    this.hideZone();
    this.hidePlacement();
    this.hideDraft();
    this.placementReady = false;
    this.openStationId = null;
    this.openLineId = null;
  }

  resetTutorial(): void {
    this.tutorialDismissed = false;
    this.qs('#tutorial').classList.add('hidden');
  }

  resetTransient(): void {
    window.clearTimeout(this.dailyTimer);
    window.clearTimeout(this.peakTimer);
    this.closePopovers();
    const card = this.qs('#daily-card');
    card.classList.add('hidden');
    card.classList.remove('show');
    const peak = this.qs('#peak-tag');
    peak.hidden = true;
    peak.classList.remove('show');
    this.qs('#toasts').innerHTML = '';
  }

  // ————————————————————————— 车站 / 线路面板 —————————————————————————

  showStation(station: Station): void {
    this.openStationId = station.id;
    this.openLineId = null;
    this.qs('#line-panel').classList.add('hidden');
    const panel = this.qs('#station-panel');
    panel.classList.remove('hidden');
    const size = STATION_SIZES[station.size ?? 'standard'];
    panel.innerHTML = `
      <button class="ui-close panel-close" id="sp-close" title="关闭（Esc）">${icon('close', 14)}</button>
      <div class="panel-head">
        <div class="panel-title">
          <div class="p-kicker">车站 · ${size.label}</div>
          <h3>${escapeHtml(station.name)}</h3>
        </div>
      </div>
      <div class="panel-scroll">
        <div class="stat-row"><span>候车 / 容量</span><b><span id="sp-wait">0</span> / ${station.capacity}</b></div>
        <div class="meter"><i id="sp-meter"></i></div>
        <div class="stat-row"><span>今日进站</span><b><span id="sp-entries">0</span><small class="stat-peak">历史最高 <span id="sp-entries-best">0</span></small></b></div>
        <div class="stat-row"><span>今日出站</span><b><span id="sp-exits">0</span><small class="stat-peak">历史最高 <span id="sp-exits-best">0</span></small></b></div>
        <div class="stat-row"><span>建设费</span><b>${yen(size.cost)}</b></div>
        <div class="stat-row"><span>日运营成本</span><b>${yen(size.daily)}</b></div>
        <div class="stat-row"><span>状态</span><b id="sp-status"></b></div>
        <div class="chips" id="sp-lines"></div>
        <div class="station-dest">
          <div class="station-dest-head">当前候车目的地</div>
          <div class="station-dest-list" id="sp-dests"><span class="station-dest-empty">暂无候车乘客</span></div>
        </div>
        <div class="panel-hint">${size.note} · 建成后永久保留，不可拆除。</div>
      </div>
    `;
    panel.querySelector('#sp-close')?.addEventListener('click', () => {
      this.actions.clearSelection();
      this.hideStation();
    });
    this.syncStationPanel();
    requestAnimationFrame(() => this.syncPanelScroll(panel));
  }

  /** 线路面板里的“实时客流 / 最高实时 / 昨日 / 最高”随时刷新。 */
  private syncLineLive(): void {
    if (this.openLineId === null || !this.sim) return;
    const line = this.sim.net.lineById.get(this.openLineId);
    if (!line) return;
    let onboard = 0;
    for (const id of line.trains) onboard += this.sim.net.trainById.get(id)?.riders.length ?? 0;
    const set = (sel: string, value: number): void => {
      const el = this.qs(sel);
      if (el && el.textContent !== String(value)) el.textContent = String(value);
    };
    set('#lp-live', onboard);
    set('#lp-peak', line.peakOnboard);
    set('#lp-lastday', line.ridersLastDay);
    set('#lp-bestday', line.ridersBestDay);
  }

  private syncStationPanel(): void {
    if (this.openStationId === null || !this.sim) return;
    const station = this.sim.net.stationById.get(this.openStationId);
    if (!station) {
      this.hideStation();
      return;
    }
    const waiting = this.sim.waitingAt(station.id);
    const ratio = Math.min(1, waiting / station.capacity);
    const waitEl = this.qs('#sp-wait');
    if (waitEl) waitEl.textContent = String(waiting);
    const meter = this.qs<HTMLElement>('#sp-meter');
    if (meter) {
      meter.style.width = `${Math.round(ratio * 100)}%`;
      meter.style.background =
        ratio < 0.5 ? '#6f9c68' : ratio < 0.8 ? '#d8b24c' : '#c0503c';
    }
    const entries = this.qs('#sp-entries');
    if (entries) entries.textContent = int(this.sim.entriesAt(station.id));
    const entriesBest = this.qs('#sp-entries-best');
    if (entriesBest) entriesBest.textContent = int(this.sim.entriesBestAt(station.id));
    const exits = this.qs('#sp-exits');
    if (exits) exits.textContent = int(this.sim.exitsAt(station.id));
    const exitsBest = this.qs('#sp-exits-best');
    if (exitsBest) exitsBest.textContent = int(this.sim.exitsBestAt(station.id));

    const dests = this.sim.waitingDestinationsAt(station.id);
    const destKey = dests.map((d) => `${d.name}:${d.count}`).join('|');
    const destList = this.qs('#sp-dests');
    if (destList && destList.dataset.key !== destKey) {
      destList.dataset.key = destKey;
      const peak = dests.reduce((max, d) => Math.max(max, d.count), 0);
      destList.innerHTML =
        dests.length === 0
          ? '<span class="station-dest-empty">暂无候车乘客</span>'
          : dests
              .map((d) => {
                const width = peak > 0 ? Math.max(8, Math.round((d.count / peak) * 100)) : 0;
                return `<div class="station-dest-row"><i style="--w:${width}%"></i><span>${escapeHtml(d.name)}</span><b>${int(d.count)}</b></div>`;
              })
              .join('');
      requestAnimationFrame(() => this.syncPanelScroll(this.qs('#station-panel')));
    }

    const status = this.qs('#sp-status');
    if (status) {
      if (station.lines.length === 0) {
        const daily = STATION_SIZES[station.size ?? 'standard'].daily;
        status.innerHTML = `<span class="warn">闲置，日运营成本 ${yen(daily)}</span>`;
      } else {
        status.innerHTML = `<span class="ok">已接入 ${station.lines.length} 条线路</span>`;
      }
    }
    const chips = this.qs('#sp-lines');
    if (chips) {
      const key = station.lines.join(',');
      if (chips.dataset.key !== key) {
        chips.dataset.key = key;
        chips.innerHTML = station.lines
          .map((id) => this.sim!.net.lineById.get(id))
          .filter((l): l is Line => !!l)
          .map(
            (l) =>
              `<button class="line-chip" data-line="${l.id}" style="--c:${LINE_COLORS[l.color % LINE_COLORS.length]!.css}">
                <i></i>${l.id} 号线
              </button>`,
          )
          .join('');
        chips.querySelectorAll<HTMLElement>('[data-line]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const line = this.sim?.net.lineById.get(Number(btn.dataset.line));
            if (line && this.sim) {
              this.actions.selectLine(line.id);
              this.showLine(this.sim, line);
            }
          });
        });
      }
    }
  }

  hideStation(): void {
    this.openStationId = null;
    this.qs('#station-panel').classList.add('hidden');
  }

  showLine(sim: Simulation, line: Line): void {
    this.openLineId = line.id;
    this.openStationId = null;
    this.qs('#station-panel').classList.add('hidden');
    const panel = this.qs('#line-panel');
    panel.classList.remove('hidden');
    const color = LINE_COLORS[line.color % LINE_COLORS.length]!;
    const hex = line.hex || color.css;
    const routeHtml = line.stationIds
      .map((id, idx) => {
        const name = sim.net.stationById.get(id)?.name ?? '?';
        const endpoint = idx === 0 || idx === line.stationIds.length - 1;
        return `<span class="route-stop${endpoint ? ' end' : ''}" style="--c:${hex}">${escapeHtml(name)}</span>`;
      })
      .join('');
    const longRoute = line.stationIds.length > 10;
    const lengthKm = sim.lineLengthKm(line.id);
    const oneWay =
      sim.lineOneWayMinutes(line.id) +
      TRAIN_DWELL * Math.max(0, line.stationIds.length - 1);
    const localCount = line.trains.filter((id) => sim.net.trainById.get(id)?.kind !== 'express').length;
    const expressCount = line.trains.filter((id) => sim.net.trainById.get(id)?.kind === 'express').length;
    const mixedKinds = localCount > 0 && expressCount > 0;
    const speedLabel = mixedKinds
      ? `慢车 ${LOCAL_TRAIN_SPEED_KMH} · 快车 ${EXPRESS_TRAIN_SPEED_KMH} km/h`
      : expressCount > 0
        ? `快车 ${EXPRESS_TRAIN_SPEED_KMH} km/h`
        : `慢车 ${LOCAL_TRAIN_SPEED_KMH} km/h`;
    const loop = isLoopLine(line);
    const stationCount = loop ? line.stationIds.length - 1 : line.stationIds.length;
    const onboardNow = line.trains.reduce(
      (n, id) => n + (sim.net.trainById.get(id)?.riders.length ?? 0),
      0,
    );
    const lineStationDaily = line.stationIds.reduce(
      (sum, sid) => sum + STATION_SIZES[sim.net.stationById.get(sid)?.size ?? 'standard'].daily,
      0,
    );
    const trainRows = loop
      ? ''
      : line.trains
      .map((tid, i) => {
        const t = sim.net.trainById.get(tid);
        if (!t) return '';
        const options = (selected: number, other: number): string =>
          line.stationIds
            .map((sid) => {
              const name = sim.net.stationById.get(sid)?.name ?? '?';
              return `<option value="${sid}"${sid === selected ? ' selected' : ''}${sid === other ? ' disabled' : ''}>${escapeHtml(name)}</option>`;
            })
            .join('');
        return `<div class="train-card">
          <div class="train-card-head">
            <span class="train-no">列车 ${i + 1} · ${t.kind === 'express' ? '快车' : '慢车'}</span>
            <button class="train-swap" data-train-swap="${tid}" title="调换始发站与终点站">${icon('swap', 14)}</button>
          </div>
          <div class="train-endpoints">
            <label class="train-endpoint"><span>始发</span><select data-train-start="${tid}" title="始发站">${options(t.startId, t.endId)}</select></label>
            <span class="train-arrow">→</span>
            <label class="train-endpoint"><span>终点</span><select data-train-end="${tid}" title="终点站">${options(t.endId, t.startId)}</select></label>
          </div>
        </div>`;
      })
      .join('');
    panel.innerHTML = `
      <button class="ui-close panel-close" id="lp-close" title="关闭（Esc）">${icon('close', 14)}</button>
      <div class="panel-head">
        <div class="panel-title">
          <div class="p-kicker">线路</div>
          <h3><i class="line-dot" style="background:${hex}"></i>${this.lineLabel(line)}</h3>
        </div>
      </div>
      <div class="panel-scroll">
        <div class="route route-list${longRoute ? ' collapsed' : ''}">${routeHtml}</div>
        ${
          longRoute
            ? `<button class="route-toggle" id="lp-route-toggle" aria-expanded="false">站序 · ${line.stationIds.length} 站 ${icon('chevron', 12)}</button>`
            : ''
        }
        <div class="stat-row"><span>站点</span><b id="lp-stations">${stationCount}</b></div>
        <div class="stat-row"><span>总里程</span><b id="lp-length">${lengthKm.toFixed(1)} km</b></div>
        <div class="stat-row"><span>设计时速</span><b id="lp-speed">${speedLabel}</b></div>
        <div class="stat-row"><span>${loop ? '环线一圈' : mixedKinds ? '单程 · 慢车' : '单程'}</span><b id="lp-runtime">${Math.round(oneWay)} 分钟</b></div>
        <div class="stat-row${expressCount > 0 ? '' : ' hidden'}" id="lp-express-headway-row"><span>快车班距</span><b id="lp-express-headway">—</b></div>
        <div class="stat-row${localCount > 0 ? '' : ' hidden'}" id="lp-local-headway-row"><span>慢车班距</span><b id="lp-local-headway">—</b></div>
        ${
          line.expressStops.length >= 2
            ? `<div class="stat-row"><span>快车停靠</span><b><button class="link-btn" id="lp-express">${line.expressStops.length} 站 · 编辑</button></b></div>`
            : ''
        }
        ${
          trainRows
            ? `<button class="train-toggle" id="lp-train-toggle" aria-expanded="false">
                 <span>列车运行区间</span><b id="lp-trains">${line.trains.length}</b>${icon('chevron', 14)}
               </button>
               <div class="train-list hidden" id="lp-train-list" title="每列车可以单独设置始发站与终点站，到终点自动折返">${trainRows}</div>`
            : ''
        }
        <div class="stat-row"><span>实时 / 峰值</span><b><span id="lp-live">${onboardNow}</span> / <span id="lp-peak">${line.peakOnboard}</span></b></div>
        <div class="stat-row"><span>昨日 / 最高</span><b><span id="lp-lastday">${line.ridersLastDay}</span> / <span id="lp-bestday">${line.ridersBestDay}</span></b></div>
        <div class="stat-row"><span>日运营</span><b id="lp-cost">${yen(sim.lineTrainCost(line.id) + lineStationDaily)}</b></div>
        <div class="line-color-row" id="lp-colors">
          ${LINE_COLORS.map(
            (c, i) =>
              `<button class="draft-swatch${hex.toLowerCase() === c.css.toLowerCase() ? ' active' : ''}" data-line-swatch="${i}" style="--c:${c.css}" title="${c.name}"></button>`,
          ).join('')}
          <input type="color" id="lp-color" value="${hex}" title="自定义线路颜色" />
          <input type="text" class="hex-input" id="lp-hex" value="${hex}" maxlength="18" spellcheck="false" title="输入 #RRGGBB 或 rgb(r,g,b)" />
        </div>
        <label class="line-service">运营
          <input type="time" id="lp-start" value="${clockValue(line.startMin)}" />
          <span>–</span>
          <input type="time" id="lp-end" value="${clockValue(line.endMin)}" />
        </label>
      </div>
      <div class="actions panel-actions">
        <button class="btn" id="lp-extend" title="点击线路外侧新站延长；点击中间站可从此处分支">${icon('line', 14)} 延长 / 分支</button>
        <button class="btn" id="lp-add" title="加车：慢车 ¥2,000 / 快车 ¥2,600">${icon('plus', 14)} 加车</button>
        <button class="btn" id="lp-sub" title="减一列车，不返还购买费">${icon('minus', 14)} 减车</button>
        <button class="btn danger" id="lp-remove" title="拆除线路，返还 50% 建设费">拆线 +${yen(this.sim ? this.sim.refundOf(line.id) : 0)}</button>
      </div>
      <div class="train-menu hidden" id="lp-menu">
        <button class="train-opt" data-buy="local"><b>加慢车（各站停）</b><span>¥2,000 · ¥100/日 · 班次密，短途友好</span></button>
        <button class="train-opt" data-buy="express"><b>加快车（大站停）</b><span>¥2,600 · ¥130/日 · 班次稀，长途快</span></button>
      </div>
    `;
    panel.querySelector('#lp-close')?.addEventListener('click', () => {
      this.actions.clearSelection();
      this.hideLine();
    });
    panel.querySelectorAll<HTMLElement>('[data-line-swatch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.lineSwatch);
        const preset = LINE_COLORS[index];
        if (!preset) return;
        this.actions.setLineColor(line.id, index, preset.css);
        const fresh = sim.net.lineById.get(line.id);
        if (fresh) this.showLine(sim, fresh);
      });
    });
    panel.querySelector<HTMLInputElement>('#lp-color')?.addEventListener('change', (ev) => {
      const value = parseColor((ev.target as HTMLInputElement).value) ?? hex;
      this.actions.setLineColor(line.id, line.color, value);
      const fresh = sim.net.lineById.get(line.id);
      if (fresh) this.showLine(sim, fresh);
    });
    panel.querySelector<HTMLInputElement>('#lp-hex')?.addEventListener('change', (ev) => {
      const input = ev.target as HTMLInputElement;
      const value = parseColor(input.value);
      if (!value) {
        input.value = hex;
        return;
      }
      this.actions.setLineColor(line.id, line.color, value);
      const fresh = sim.net.lineById.get(line.id);
      if (fresh) this.showLine(sim, fresh);
    });
    panel.querySelector<HTMLInputElement>('#lp-start')?.addEventListener('change', (ev) => {
      const start = parseClock((ev.target as HTMLInputElement).value, line.startMin);
      this.actions.setLineService(line.id, start, line.endMin);
    });
    panel.querySelector<HTMLInputElement>('#lp-end')?.addEventListener('change', (ev) => {
      const end = parseClock((ev.target as HTMLInputElement).value, line.endMin);
      this.actions.setLineService(line.id, line.startMin, end);
    });
    panel.querySelector('#lp-express')?.addEventListener('click', () => {
      this.actions.openExpressPicker(line.id, false);
    });
    panel.querySelector('#lp-add')?.addEventListener('click', () => {
      const menu = panel.querySelector('.train-menu');
      menu?.classList.toggle('hidden');
    });
    panel.querySelector('#lp-train-toggle')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget as HTMLElement;
      const list = panel.querySelector('#lp-train-list');
      if (!list) return;
      const hidden = list.classList.toggle('hidden');
      btn.classList.toggle('open', !hidden);
      btn.setAttribute('aria-expanded', String(!hidden));
      this.syncPanelScroll(panel);
    });
    panel.querySelector('#lp-route-toggle')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget as HTMLElement;
      const list = panel.querySelector('.route-list');
      if (!list) return;
      const collapsed = list.classList.toggle('collapsed');
      btn.classList.toggle('open', !collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.innerHTML = collapsed
        ? `站序 · ${line.stationIds.length} 站 ${icon('chevron', 12)}`
        : `收起站序 ${icon('chevron', 12)}`;
      this.syncPanelScroll(panel);
    });
    panel.querySelectorAll<HTMLElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this.actions.buyTrain(line.id, btn.dataset.buy as TrainKind));
    });
    panel.querySelectorAll<HTMLSelectElement>('[data-train-start]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const trainId = Number(sel.dataset.trainStart);
        const train = sim.net.trainById.get(trainId);
        if (!train) return;
        this.actions.setTrainSpanFlexible(line.id, trainId, Number(sel.value), train.endId);
      });
    });
    panel.querySelectorAll<HTMLSelectElement>('[data-train-end]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const trainId = Number(sel.dataset.trainEnd);
        const train = sim.net.trainById.get(trainId);
        if (!train) return;
        this.actions.setTrainSpanFlexible(line.id, trainId, train.startId, Number(sel.value));
      });
    });
    panel.querySelectorAll<HTMLElement>('[data-train-swap]').forEach((btn) => {
      btn.addEventListener('click', () => this.actions.swapTrainSpan(line.id, Number(btn.dataset.trainSwap)));
    });
    panel.querySelector('#lp-extend')?.addEventListener('click', () => this.actions.extendLine(line.id));
    panel.querySelector('#lp-sub')?.addEventListener('click', () => this.actions.removeTrain(line.id));
    panel.querySelector('#lp-remove')?.addEventListener('click', () => {
      void this.confirm({
        title: '拆除线路',
        body: `将拆除 ${line.id} 号线，返还 ${yen(sim.refundOf(line.id))}（建设费的 50%）。列车不返还购买费，车站永久保留。`,
        confirmLabel: '拆除',
        danger: true,
      }).then((ok) => {
        if (ok) this.actions.removeLine(line.id);
      });
    });
    this.syncLinePanel();
    requestAnimationFrame(() => this.syncPanelScroll(panel));
  }

  private syncLinePanel(): void {
    if (this.openLineId === null || !this.sim) return;
    const line = this.sim.net.lineById.get(this.openLineId);
    if (!line) {
      this.hideLine();
      return;
    }
    const trains = this.qs('#lp-trains');
    if (trains) trains.textContent = String(line.trains.length);
    const runtime = this.qs('#lp-runtime');
    if (runtime) {
      const oneWay =
        this.sim.lineOneWayMinutes(line.id) +
        TRAIN_DWELL * Math.max(0, line.stationIds.length - 1);
      runtime.textContent = `${Math.round(oneWay)} 分钟`;
    }
    const localCount = line.trains.filter((id) => this.sim!.net.trainById.get(id)?.kind !== 'express').length;
    const expressCount = line.trains.filter((id) => this.sim!.net.trainById.get(id)?.kind === 'express').length;
    const mixedKinds = localCount > 0 && expressCount > 0;
    const expressRow = this.qs('#lp-express-headway-row');
    const localRow = this.qs('#lp-local-headway-row');
    expressRow?.classList.toggle('hidden', expressCount === 0);
    localRow?.classList.toggle('hidden', localCount === 0);
    const expressHeadway = this.sim.net.serviceHeadway(line, 'express', this.sim.pxPerKm);
    const localHeadway = this.sim.net.serviceHeadway(line, 'local', this.sim.pxPerKm);
    const expressValue = this.qs('#lp-express-headway');
    if (expressValue) {
      expressValue.textContent = Number.isFinite(expressHeadway)
        ? `≈ ${Math.max(1, Math.round(expressHeadway))} 分钟`
        : '—';
    }
    const localValue = this.qs('#lp-local-headway');
    if (localValue) {
      if (!Number.isFinite(localHeadway)) {
        localValue.textContent = '—';
      } else {
        const minutes = Math.max(1, Math.round(localHeadway));
        localValue.innerHTML = mixedKinds
          ? `≈ ${minutes} 分钟 <small class="stat-peak">半班距 ≈ ${Math.max(1, Math.round(localHeadway / 2))} 分</small>`
          : `≈ ${minutes} 分钟`;
      }
    }
    const cost = this.qs('#lp-cost');
    const lineStationDaily = line.stationIds.reduce(
      (sum, sid) => sum + STATION_SIZES[this.sim!.net.stationById.get(sid)?.size ?? 'standard'].daily,
      0,
    );
    if (cost) cost.textContent = yen(this.sim.lineTrainCost(line.id) + lineStationDaily);
    const length = this.qs('#lp-length');
    if (length) length.textContent = `${this.sim.lineLengthKm(line.id).toFixed(1)} km`;
    const speed = this.qs('#lp-speed');
    if (speed) {
      speed.textContent = mixedKinds
        ? `慢车 ${LOCAL_TRAIN_SPEED_KMH} · 快车 ${EXPRESS_TRAIN_SPEED_KMH} km/h`
        : expressCount > 0
          ? `快车 ${EXPRESS_TRAIN_SPEED_KMH} km/h`
          : `慢车 ${LOCAL_TRAIN_SPEED_KMH} km/h`;
    }
    const sub = this.qs<HTMLButtonElement>('#lp-sub');
    if (sub) sub.disabled = line.trains.length === 0;
    const remove = this.qs<HTMLButtonElement>('#lp-remove');
    if (remove) remove.disabled = this.sim.fund < 0;
    const refund = this.qs('#lp-remove');
    if (refund) refund.innerHTML = `拆线 +${yen(this.sim.refundOf(line.id))}`;
  }

  hideLine(): void {
    this.openLineId = null;
    this.qs('#line-panel').classList.add('hidden');
  }

  // ————————————————————————— 快车停靠站 —————————————————————————

  private expressBuyAfter = false;
  private expressDraft = new Set<number>();

  showExpressPicker(sim: Simulation, line: Line, buyAfter: boolean): void {
    this.expressBuyAfter = buyAfter;
    const existing =
      line.expressStops.length >= 2 ? line.expressStops : sim.defaultExpressStops(line);
    this.expressDraft = new Set(existing);
    this.hideLine();
    const panel = this.qs('#express-panel');
    panel.classList.remove('hidden');
    this.renderExpressPanel(sim, line);
  }

  hideExpress(): void {
    this.expressBuyAfter = false;
    this.qs('#express-panel').classList.add('hidden');
  }

  private renderExpressPanel(sim: Simulation, line: Line): void {
    const panel = this.qs('#express-panel');
    const ids = [...new Set(line.stationIds)];
    const endpoints = new Set([line.stationIds[0], line.stationIds[line.stationIds.length - 1]]);
    const rows = ids
      .map((id) => {
        const station = sim.net.stationById.get(id);
        const checked = this.expressDraft.has(id);
        const tag =
          station?.size === 'large' ? '大型换乘' : endpoints.has(id) ? '端点' : '';
        return `<label class="express-row${checked ? ' on' : ''}">
          <input type="checkbox" data-stop="${id}"${checked ? ' checked' : ''} />
          <span>${escapeHtml(station?.name ?? '?')}</span>
          ${tag ? `<em>${tag}</em>` : ''}
        </label>`;
      })
      .join('');
    panel.innerHTML = `
      <button class="ui-close panel-close" id="ep-close" title="关闭">${icon('close', 14)}</button>
      <div class="panel-head">
        <div class="panel-title">
          <div class="p-kicker">快车停靠站</div>
          <h3><i class="line-dot" style="background:${line.hex}"></i>${this.lineLabel(line)}</h3>
        </div>
      </div>
      <div class="panel-scroll">
        <p class="panel-hint">快车只停勾选的车站，慢车每站都停。默认勾选大型换乘站、5/6 级 POI 附近站与线路两端；至少 2 站。</p>
        <div class="express-list">${rows}</div>
        <div class="p-actions">
          <button class="btn primary" id="ep-save">${this.expressBuyAfter ? '保存并购买快车 ¥2,600' : '保存停靠站'}</button>
          <button class="btn ghost" id="ep-cancel">取消</button>
        </div>
      </div>
    `;
    const close = (): void => {
      this.hideExpress();
      this.actions.selectLine(line.id);
    };
    panel.querySelector('#ep-close')?.addEventListener('click', close);
    panel.querySelector('#ep-cancel')?.addEventListener('click', close);
    panel.querySelectorAll<HTMLInputElement>('input[data-stop]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.stop);
        if (cb.checked) this.expressDraft.add(id);
        else this.expressDraft.delete(id);
        cb.closest('.express-row')?.classList.toggle('on', cb.checked);
      });
    });
    panel.querySelector('#ep-save')?.addEventListener('click', () => {
      if (this.expressDraft.size < 2) {
        this.toast('快车至少需要勾选 2 个车站', 'warn');
        return;
      }
      const buy = this.expressBuyAfter;
      this.actions.setExpressStops(line.id, [...this.expressDraft]);
      this.hideExpress();
      if (buy) this.actions.buyTrain(line.id, 'express');
      else this.actions.selectLine(line.id);
    });
    requestAnimationFrame(() => this.syncPanelScroll(panel));
  }

  // ————————————————————————— 建站预览 —————————————————————————

  private placementReady = false;
  private placementSize: StationSize = 'standard';
  private placementCompact = false;
  private placementOffset: { dx: number; dy: number } | null = null;
  private placementAnchor = { x: 0, y: 0 };

  /** 建站面板里的站型选择 / 成本显示。 */
  private syncPlacementSize(): void {
    const panel = this.qs('#placement');
    const size = STATION_SIZES[this.placementSize];
    panel.querySelectorAll<HTMLElement>('[data-station-size]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.stationSize === this.placementSize);
    });
    const build = panel.querySelector('#pv-cost-build');
    if (build) build.textContent = yen(size.cost);
    const daily = panel.querySelector('#pv-cost-daily');
    if (daily) daily.textContent = yen(size.daily);
    const cap = panel.querySelector('#pv-capacity');
    if (cap) cap.textContent = `${size.capacity} 人`;
  }

  showPlacement(sim: Simulation, info: PlacementInfo): void {
    const panel = this.qs('#placement');
    if (!this.placementReady) {
      const maxM = Math.max(1, Math.round((sim.walkRadiusPx / Math.max(1, sim.pxPerKm)) * 1000));
      const coreM = Math.max(1, Math.round((sim.coreWalkRadiusPx() / Math.max(1, sim.pxPerKm)) * 1000));
      panel.innerHTML = `
        <div class="p-head" id="pv-drag" title="按住拖动面板">
          <div class="p-kicker">建站预览 · 面板可拖动</div>
          <button class="icon-btn small" id="pv-collapse" title="收起 / 展开数据">−</button>
        </div>
        <div class="p-title">核心 ${coreM} m · 最大 ${maxM} m</div>
        <div class="p-sizes">
          ${(['small', 'standard', 'large'] as const)
            .map(
              (key) => `<button class="p-size" data-station-size="${key}">
                <b>${STATION_SIZES[key].label}</b>
                <small>${STATION_SIZES[key].capacity} 人 · ${yen(STATION_SIZES[key].cost)}</small>
              </button>`,
            )
            .join('')}
        </div>
        <div class="p-body" id="pv-body">
          <div class="p-grid">
            <div><span>核心居民</span><b id="pv-core-residents">0</b></div>
            <div><span>核心岗位</span><b id="pv-core-jobs">0</b></div>
            <div><span>1km 内居民</span><b id="pv-residents">0</b></div>
            <div><span>1km 内岗位</span><b id="pv-jobs">0</b></div>
          </div>
          <div class="p-poi${sim.demandMode === 'commuter' ? ' hidden' : ''}"><span>覆盖 POI 吸引</span><b id="pv-poi">0</b></div>
          <div class="p-cost">
            <span>承载力 <b id="pv-capacity">100 人</b></span>
            <span>建设费 <b id="pv-cost-build">${yen(STATION_SIZES.standard.cost)}</b></span>
            <span>日运营 <b id="pv-cost-daily">${yen(STATION_SIZES.standard.daily)}</b></span>
          </div>
          <div class="p-tip">车站建成后不可拆除，请确认位置。</div>
        </div>
        <div class="p-state" id="pv-state"></div>
        <div class="p-actions">
          <button class="btn primary" id="pv-confirm">确认建站</button>
          <button class="btn ghost" id="pv-cancel">取消</button>
          <button class="btn ghost hidden" id="pv-undo">撤回最近车站（仅一次）</button>
        </div>
      `;
      panel.querySelector('#pv-confirm')?.addEventListener('click', () => this.actions.confirmStation());
      panel.querySelector('#pv-cancel')?.addEventListener('click', () => this.actions.cancelPlacement());
      panel.querySelector('#pv-undo')?.addEventListener('click', () => this.actions.undoStation());
      panel.querySelectorAll<HTMLElement>('[data-station-size]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.placementSize = (btn.dataset.stationSize as StationSize) ?? 'standard';
          this.actions.setStationSize(this.placementSize);
          this.syncPlacementSize();
        });
      });
      panel.querySelector('#pv-collapse')?.addEventListener('click', () => {
        this.placementCompact = !this.placementCompact;
        panel.classList.toggle('compact', this.placementCompact);
        const btn = panel.querySelector('#pv-collapse');
        if (btn) btn.textContent = this.placementCompact ? '+' : '−';
      });
      // 拖动：按住标题栏移动，松手后记住相对落点的偏移。
      const head = panel.querySelector<HTMLElement>('#pv-drag');
      head?.addEventListener('pointerdown', (ev) => {
        if ((ev.target as HTMLElement | null)?.closest('#pv-collapse')) return;
        ev.preventDefault();
        head.setPointerCapture(ev.pointerId);
        const startX = ev.clientX;
        const startY = ev.clientY;
        const rect = panel.getBoundingClientRect();
        const move = (e: PointerEvent): void => {
          panel.style.left = `${rect.left + (e.clientX - startX)}px`;
          panel.style.top = `${rect.top + (e.clientY - startY)}px`;
        };
        const up = (): void => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          const r = panel.getBoundingClientRect();
          this.placementOffset = { dx: r.left - this.placementAnchor.x, dy: r.top - this.placementAnchor.y };
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
      });
      this.placementReady = true;
      this.syncPlacementSize();
    }
    panel.classList.remove('hidden');
    panel.classList.toggle('compact', this.placementCompact);
    const residents = panel.querySelector('#pv-residents');
    if (residents) residents.textContent = int(info.coverage.residents);
    const coreResidents = panel.querySelector('#pv-core-residents');
    if (coreResidents) coreResidents.textContent = int(info.coverage.coreResidents);
    const jobs = panel.querySelector('#pv-jobs');
    if (jobs) jobs.textContent = int(info.coverage.jobs);
    const coreJobs = panel.querySelector('#pv-core-jobs');
    if (coreJobs) coreJobs.textContent = int(info.coverage.coreJobs);
    const poi = panel.querySelector('#pv-poi');
    if (poi) poi.textContent = int(info.coverage.poiAttraction);
    const stateEl = panel.querySelector('#pv-state');
    if (stateEl) {
      stateEl.className = `p-state ${info.valid ? 'p-ok' : 'p-bad'}`;
      stateEl.innerHTML = info.valid
        ? `${icon('check', 14)} 可在此建站`
        : `${icon('warning', 14)} ${info.reason ?? '不可建站'}`;
    }
    const undo = panel.querySelector('#pv-undo');
    undo?.classList.toggle('hidden', !(sim.tutorial.active && sim.canUndoStation() && !sim.tutorial.undoUsed));
    const confirm = panel.querySelector<HTMLButtonElement>('#pv-confirm');
    if (confirm) confirm.disabled = !info.valid;
    this.placementAnchor = { x: info.screen.x, y: info.screen.y };

    const width = panel.offsetWidth || 272;
    const height = panel.offsetHeight || 260;
    let x = Math.max(12, Math.min(window.innerWidth - width - 12, info.screen.x + 26));
    const tutorial = document.getElementById('tutorial');
    const guard = tutorial && !tutorial.classList.contains('hidden') ? 104 : 14;
    const maxTop = Math.max(86, window.innerHeight - height - guard);
    let y = Math.max(86, Math.min(maxTop, info.screen.y - height / 2));
    if (this.placementOffset) {
      x = Math.max(8, Math.min(window.innerWidth - width - 8, info.screen.x + this.placementOffset.dx));
      y = Math.max(84, Math.min(window.innerHeight - height - 8, info.screen.y + this.placementOffset.dy));
    }
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }

  hidePlacement(): void {
    this.qs('#placement').classList.add('hidden');
  }

  showZone(sim: Simulation, zone: Zone, screen: { x: number; y: number }): void {
    const popup = this.qs('#zone-popup');
    const summary = sim.zoneOdSummary(zone.id);
    const isPoi = zone.id >= 10000;
    const kind = isPoi
      ? 'POI'
      : zone.kind === 'residential'
        ? '住宅区'
        : zone.kind === 'employment'
          ? '就业区'
          : '混合 / 商业区';
    const useIncoming = summary.total === 0 && summary.incoming > 0;
    const list = useIncoming ? summary.topIn : summary.top;
    const rows = list.map((r) => `<li><span>${r.name}</span><b>${int(r.count)}</b></li>`).join('');
    const sub =
      summary.total > 0
        ? `本区 ${int(summary.total)} 人外出，主要前往 ${summary.top.length} 个组团：`
        : useIncoming
          ? `本区吸引 ${int(summary.incoming)} 人次，主要来自 ${summary.topIn.length} 个组团：`
          : zone.kind === 'mixed'
            ? '混合 / 商业区 · 灵活出行族的终点，本地无固定住宅人口。'
            : '本区暂无固定出发人口。';
    popup.innerHTML = `
      <div class="z-head"><span class="z-kind">${kind}</span><b>${escapeHtml(zone.name)}</b></div>
      <div class="z-sub">${sub}</div>
      <ul>${list.length > 0 ? rows : '<li><span>OD 流带仍会经过此处</span><b>—</b></li>'}</ul>
    `;
    popup.classList.remove('hidden');
    const width = 250;
    const height = popup.offsetHeight || 150;
    popup.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, screen.x + 18))}px`;
    popup.style.top = `${Math.max(86, Math.min(window.innerHeight - height - 12, screen.y + 14))}px`;
  }

  hideZone(): void {
    this.qs('#zone-popup').classList.add('hidden');
  }

  setHoverLabel(text: string | null, x: number, y: number): void {
    const el = this.qs('#hover-label');
    if (!text) {
      el.classList.add('hidden');
      this.cache.delete('hover-label');
      return;
    }
    el.classList.remove('hidden');
    if (this.cache.get('hover-label') !== text) {
      el.textContent = text;
      this.cache.set('hover-label', text);
    }
    const width = el.offsetWidth || 90;
    const left = x + 16 + width > window.innerWidth - 10 ? x - width - 16 : x + 16;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.min(window.innerHeight - 40, y + 18)}px`;
  }

  hideHoverLabel(): void {
    this.qs('#hover-label').classList.add('hidden');
    this.cache.delete('hover-label');
  }

  /**
   * 超载车站气泡（REQ-HEAT-001）：悬停爆红站点时说明承载力、站外排队与满意度。
   */
  showSurgeBubble(
    info: { name: string; ratio: number; waiting: number; capacity: number; overflow: number; satisfaction: number },
    stationScreen: { x: number; y: number },
  ): void {
    const el = this.qs('#surge-bubble');
    const pct = Math.round(info.ratio * 100);
    const overflow = Math.max(0, Math.round(info.overflow));
    const key = `${info.name}|${pct}|${overflow}|${info.satisfaction}`;
    if (this.cache.get('surge') !== key) {
      this.cache.set('surge', key);
      const over = info.ratio >= 1;
      const drop = info.satisfaction < 40 ? '满意度暴跌' : info.satisfaction < 70 ? '满意度下滑' : '满意度承压';
      el.innerHTML = `
        <div class="sb-head"><span class="sb-dot"></span><b>${escapeHtml(info.name)}</b><em>${pct}%</em></div>
        <p class="sb-body">${
          over
            ? `当前站口承载力已达 <b>${pct}%</b>，超过 <b>${overflow}</b> 人正在站外排队等待，<b class="sb-warn">${drop}</b>。`
            : `站口承载力已到 <b>${pct}%</b>，候车 <b>${Math.round(info.waiting)}</b> 人，接近饱和，<b class="sb-warn">${drop}</b>。`
        }</p>
        <div class="sb-bar"><i style="width:${Math.min(100, pct)}%"></i></div>
        <div class="sb-meta">候车 ${Math.round(info.waiting)} / 容量 ${Math.round(info.capacity)} · 满意度 ${info.satisfaction}</div>
      `;
    }
    el.classList.remove('hidden');
    el.classList.toggle('critical', info.ratio >= 1);
    const width = el.offsetWidth || 280;
    const height = el.offsetHeight || 96;
    const left = Math.max(10, Math.min(window.innerWidth - width - 10, stationScreen.x - width / 2));
    const top = stationScreen.y - height - 22 < 80 ? stationScreen.y + 22 : stationScreen.y - height - 22;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  hideSurgeBubble(): void {
    const el = this.qs('#surge-bubble');
    el.classList.add('hidden');
    this.cache.delete('surge');
  }

  // ————————————————————————— 画线草稿 —————————————————————————

  showDraft(
    sim: Simulation,
    ids: number[],
    extendLineId: number | null = null,
    branchParentId: number | null = null,
  ): void {
    const panel = this.qs('#draft-panel');
    panel.classList.remove('hidden');
    const line = extendLineId !== null ? sim.net.lineById.get(extendLineId) ?? null : null;
    const parent = branchParentId !== null ? sim.net.lineById.get(branchParentId) ?? null : null;
    panel.classList.toggle('extend', line !== null || parent !== null);
    if (!this.draftInit) {
      const used = new Set(sim.net.lines.map((l) => l.color));
      let index = 0;
      for (let i = 0; i < LINE_COLORS.length; i++) {
        if (!used.has(i)) {
          index = i;
          break;
        }
      }
      if (used.size >= LINE_COLORS.length) index = sim.net.lines.length % LINE_COLORS.length;
      this.draftColorIndex = index;
      this.draftHex = LINE_COLORS[index]!.css;
      this.draftStart = 360;
      this.draftEnd = 1410;
      const start = this.qs<HTMLInputElement>('#draft-start');
      const end = this.qs<HTMLInputElement>('#draft-end');
      if (start) start.value = clockValue(this.draftStart);
      if (end) end.value = clockValue(this.draftEnd);
      this.draftInit = true;
    }
    this.syncDraftColorUI();
    const closed = ids.length > 1 && ids[0] === ids[ids.length - 1];
    const segments = Math.max(0, ids.length - 1);
    const stationCount = closed ? ids.length - 1 : ids.length;
    this.setText('draft-title', parent ? '分支线路' : closed ? '闭合为环线' : line ? '延长线路' : '画线中');
    this.setText('draft-count', `${stationCount} 站 · ${segments} 段`);
    const cost =
      line !== null
        ? Math.max(0, ids.length - line.stationIds.length) * SEGMENT_COST
        : sim.lineQuote(ids);
    this.setText('draft-cost', line !== null ? `+${yen(cost)}` : `${yen(cost)}`);
    const finish = this.qs<HTMLButtonElement>('#draft-finish');
    finish.disabled = ids.length < 2;
    finish.textContent = parent ? '建分支' : line ? '完成延长' : '完成';
  }

  hideDraft(): void {
    this.qs('#draft-panel').classList.add('hidden');
    this.qs('#draft-panel').classList.remove('extend');
    this.draftInit = false;
  }

  // ————————————————————————— 教程 —————————————————————————

  private syncGroupButtons(sim: Simulation): void {
    const counts = sim.groupCounts();
    this.root.querySelectorAll<HTMLElement>('[data-group]').forEach((btn) => {
      const g = Number(btn.dataset.group);
      const active = (counts[g] ?? 0) > 0;
      btn.classList.toggle('hidden', !active);
      btn.classList.toggle('on', this.groupFilter[g] !== false);
      btn.setAttribute('aria-pressed', String(this.groupFilter[g] !== false));
    });
  }

  private updateTutorial(sim: Simulation): void {
    const el = this.qs('#tutorial');
    if (!sim.tutorial.active || this.tutorialDismissed) {
      el.classList.add('hidden');
      return;
    }
    const stations = sim.net.stations.length;
    const lines = sim.net.lines.length;
    let step = 0;
    let title = '';
    let body = '';
    if (stations === 0) {
      step = 1;
      title = '先建一个车站';
      body = '选择「建站」，点击地图查看覆盖范围，再确认建站。¥1,000 一旦花掉不退。';
    } else if (stations === 1) {
      step = 2;
      title = '再建一个车站';
      body = '把第二个车站放在就业区或住宅区，两个站之间才有客流。';
    } else if (lines === 0) {
      step = 3;
      title = '画一条线';
      body = '选择「画线」，依次点击两个车站，按回车或「完成」建成线路。';
    } else if (sim.time < 455 && sim.stats.ridership < 20) {
      step = 4;
      title = '观察早高峰';
      body = '按空格或点顶部暂停按钮让时间走动。红色站点表示候车接近容量，考虑加车。';
    } else {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    this.setText('tut-step', String(step));
    this.setText('tut-title', title);
    this.setText('tut-body', body);
  }

  // ————————————————————————— 主菜单 / 弹窗 —————————————————————————

  showMenu(info: MenuInfo): void {
    this.hideLayerPopover();
    this.menuVisible = true;
    this.lastMenuInfo = info;
    this.root.classList.add('menu-open');
    this.overlay.classList.remove('hidden');
    this.overlay.classList.add('screen');
    this.overlay.innerHTML = `
      <div class="menu-bg" style="background-image:url('${menuBgUrl}')"></div>
      <div class="menu">
        <div class="menu-brand">
          <div class="eyebrow"><span class="rail-dot"></span>TRANSPORT PLAN · 0.9.2</div>
          <h1>交通<em>规划</em></h1>
          <p class="lede">在端州与鼎湖之间，规划一张属于你的交通网。</p>
          <div class="brand-stats">
            <div><b>${int(info.population)}</b><span>${info.commuterOnly ? '通勤个体' : '出行个体'}</span></div>
            <div><b>≈6 分钟</b><span>一个游戏日</span></div>
          </div>
        </div>
        <nav class="menu-nav">
          ${
            info.hasSave
              ? `<button class="menu-btn primary" data-act="continue"><span>继续游戏</span></button>`
              : ''
          }
          <button class="menu-btn${info.hasSave ? '' : ' primary'}" data-act="new"><span>新游戏</span></button>
          <button class="menu-btn" data-act="load"><span>载入存档</span></button>
          <button class="menu-btn" data-act="editor"><span>创作模式</span></button>
          <button class="menu-btn" data-act="import"><span>导入存档</span></button>
        </nav>
        <footer class="menu-foot">
          <span>© OpenStreetMap contributors · OpenFreeMap · AWS Terrain</span>
        </footer>
      </div>
    `;
  }

  hideMenu(): void {
    this.menuVisible = false;
    this.root.classList.remove('menu-open');
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  isMenuVisible(): boolean {
    return this.menuVisible;
  }

  private handleMenuAction(act: string): void {
    if (act === 'continue') this.actions.continueGame();
    else if (act === 'new') this.showNewGameMaps();
    else if (act === 'load') this.actions.openSaveModal();
    else if (act === 'editor') this.actions.openEditor();
    else if (act === 'import') this.qs<HTMLInputElement>('#file-import').click();
  }

  private modal(title: string, subtitle: string, body: string, footer: string): void {
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
          <header>
            <div>
              <div class="p-kicker">${subtitle}</div>
              <h2>${title}</h2>
            </div>
            <button class="icon-btn" data-do="close" title="关闭">${icon('close', 16)}</button>
          </header>
          <div class="modal-body">${body}</div>
          <footer>${footer}</footer>
        </div>
      </div>
    `;
  }

  showNewGameMaps(): void {
    const info = this.lastMenuInfo;
    if (!info) return;
    this.pendingMapId = info.lastMapId || info.selectedMapId || info.maps[0]?.id || null;
    const cards = renderMapCards(info.maps, this.pendingMapId ?? info.selectedMapId);
    this.modal(
      '新游戏',
      'SELECT MAP',
      `<div class="mode-grid map-grid">${cards}</div>
       <div class="modal-note">${icon('map', 15)} 选择地图后开始。每张地图的组团、POI 与存档分开保存。</div>`,
      `<button class="btn ghost" data-do="close">取消</button>
       <button class="btn primary" data-do="map-start">开始游戏</button>`,
    );
  }

  showSaveSlots(): void {
    const metas = this.saveMetas ?? [];
    const bySlot = new Map(metas.map((m) => [m.slot, m]));
    const row = (id: string, title: string, canWrite: boolean) => {
      const meta = bySlot.get(id);
      const info = meta
        ? `${meta.dateLabel} · 基金 ${yen(meta.fund)} · ${meta.stations} 站 / ${meta.lines} 线`
        : '空槽位';
      return `
        <div class="slot${meta ? '' : ' empty'}">
          <div class="slot-main">
            <b>${title}</b>
            <small>${info}${meta ? ` · ${relativeTime(meta.savedAt)}` : ''}</small>
          </div>
          <div class="slot-actions">
            ${canWrite ? `<button class="btn small" data-slot="${id}" data-do="save">保存</button>` : ''}
            <button class="btn small ghost" data-slot="${id}" data-do="load" ${meta ? '' : 'disabled'}>读取</button>
            ${meta ? `<button class="icon-btn small" data-slot="${id}" data-do="delete" title="删除">${icon('trash', 14)}</button>` : ''}
          </div>
        </div>`;
    };
    this.modal(
      '存档',
      'SAVE & LOAD',
      `<div class="slot-list">
        ${row('auto', '自动存档', false)}
        ${row('manual-1', '手动槽位 1', !!this.sim)}
        ${row('manual-2', '手动槽位 2', !!this.sim)}
        ${row('manual-3', '手动槽位 3', !!this.sim)}
      </div>
      <div class="modal-note">自动存档在每天 00:00 结算后写入；手动保存不会暂停游戏。</div>`,
      `<button class="btn ghost" data-do="export">${icon('download', 14)} 导出 JSON</button>
       <button class="btn ghost" data-do="import">${icon('upload', 14)} 导入 JSON</button>
       <button class="btn primary" data-do="close">完成</button>`,
    );
  }

  setSaveMetas(metas: SaveMeta[]): void {
    this.saveMetas = metas;
  }

  private saveMetas: SaveMeta[] | null = null;

  showSettings(sim: Simulation): void {
    const setting = (key: keyof Settings, title: string, body: string) => `
      <div class="switch-row">
        <div><b>${title}</b><span>${body}</span></div>
        <button class="switch ${sim.settings[key] ? 'on' : ''}" data-key="${key}" role="switch" aria-checked="${sim.settings[key]}"></button>
      </div>`;
    this.modal(
      '设置',
      'SETTINGS',
      `<div class="switch-list">
        ${setting('autoPause', '高峰提示', '每天 06:50 / 16:50 提示早晚高峰，不暂停')}
        ${setting('skipNight', '夜间跳过', '直接推进到当天第一班出发前（约 04:45–05:30）')}
      </div>
      <div class="modal-note">${icon('clock', 15)} ${formatDate(sim.dayIndex())} ${formatClock(sim.timeOfDay())} · 地图 ${escapeHtml(sim.mapName)} · ${sim.net.stations.length} 站 / ${sim.net.lines.length} 线 / ${sim.net.trains.length} 车</div>
      <div class="modal-note">Ctrl + 滚轮缩放地图，右键 / 中键拖动平移，左下角「复位」恢复全图。</div>
      <div class="modal-note">地图数据 © OpenStreetMap contributors (ODbL) · 瓦片 OpenFreeMap / OpenMapTiles。游戏内数值与规则版本 0.9.2。</div>`,
      `<button class="btn ghost" data-do="export">导出存档</button>
       <button class="btn ghost" data-do="import">导入存档</button>
       <button class="btn danger" data-do="menu">返回主菜单</button>
       <button class="btn primary" data-do="close">完成</button>`,
    );
  }

  showConfirm(options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmResolver = resolve;
      this.modal(
        options.title,
        'CONFIRM',
        `<p class="confirm-body">${options.body}</p>`,
        `<button class="btn ghost" data-do="cancel">取消</button>
         <button class="btn ${options.danger ? 'danger' : 'primary'}" data-do="confirm">${options.confirmLabel}</button>`,
      );
    });
  }

  private confirmResolver: ((value: boolean) => void) | null = null;

  private resolveConfirm(value: boolean): void {
    const resolve = this.confirmResolver;
    this.confirmResolver = null;
    this.closeOverlay();
    resolve?.(value);
  }

  confirm(options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }): Promise<boolean> {
    return this.showConfirm(options);
  }

  closeOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    if (this.confirmResolver) {
      const r = this.confirmResolver;
      this.confirmResolver = null;
      r(false);
    }
    if (this.menuVisible) this.showMenu(this.lastMenuInfo);
  }

  isOverlayOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  showSaveMetasList(metas: SaveMeta[]): void {
    this.saveMetas = metas;
  }

  setHasSaveInfo(info: MenuInfo): void {
    this.lastMenuInfo = info;
  }

  private lastMenuInfo: MenuInfo = {
    hasSave: false,
    latestLabel: '',
    maps: [],
    selectedMapId: '',
    lastMapId: '',
    population: 0,
    profileCount: PROFILE_META.length,
    commuterOnly: true,
  };

  showError(text: string): void {
    this.toast(text, 'warn');
  }

  showLoadError(text: string): void {
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="alertdialog">
          <header><div><div class="p-kicker">ERROR</div><h2>无法读取存档</h2></div></header>
          <div class="modal-body"><p class="confirm-body">${text}</p></div>
          <footer><button class="btn primary" data-do="close">返回</button></footer>
        </div>
      </div>
    `;
  }

  latestSaveLabel(metas: StoredSave[]): string {
    if (metas.length === 0) return '暂无存档';
    const latest = metas[0]!;
    return `${latest.meta.dateLabel} · 基金 ${yen(latest.meta.fund)}`;
  }
}


