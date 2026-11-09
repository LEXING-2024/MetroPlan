import type { Simulation } from '../sim/simulation';
import type { ZoneKind } from '../sim/types';

/**
 * 组团气泡：外圈是组团范围，中心核是人口 / 岗位。
 *
 * 设计意图：
 * - 外圈只做很淡的底色，多个组团重叠时自然加深，表达“这一带有人”；
 * - 中心核面积 ∝ 抽样点数（= 人口 / 岗位），屏幕大小固定，不随缩放变化；
 * - 核的颜色按密度三分位加深：同尺寸下越深越密。精确密度看悬停数字。
 */
export interface ZoneBubble {
  zoneId: number;
  x: number;
  y: number;
  /** 外圈半径（世界像素，随缩放变化） */
  r: number;
  kind: ZoneKind;
  fill: number;
  fillAlpha: number;
  /** 中心核的屏幕半径（px）；0 表示没有固定人口（内置混合区）。不随缩放变化。 */
  core: number;
  coreColor: number;
  /** 抽样点 / km²，仅用于调试与分档 */
  density: number;
}

const FILL: Record<ZoneKind, number> = {
  residential: 0x8f6a4e,
  employment: 0x4c7896,
  mixed: 0x8a8678,
};

const FILL_ALPHA: Record<ZoneKind, number> = {
  residential: 0.06,
  employment: 0.062,
  mixed: 0.035,
};

const CORE: Record<'residential' | 'employment', [number, number, number]> = {
  residential: [0xb5a08a, 0x967e64, 0x6f563f],
  employment: [0x93a9b8, 0x5a7789, 0x3c5a6e],
};

const MIXED_CORE = 0x8a8678;

function tercile(list: number[]): [number, number] {
  if (list.length === 0) return [Infinity, Infinity];
  const sorted = [...list].sort((a, b) => a - b);
  const one = sorted[Math.floor(sorted.length / 3)] ?? Infinity;
  const two = sorted[Math.floor((sorted.length * 2) / 3)] ?? Infinity;
  return [one, two];
}

/** 为一个模拟生成所有组团气泡；结果只依赖 zones / dots / pxPerKm，可在外部缓存。 */
export function buildZoneBubbles(sim: Simulation): ZoneBubble[] {
  const pxPerKm = Math.max(1, sim.pxPerKm);
  const dotsByZone = new Map<number, number>();
  for (const d of sim.dots) dotsByZone.set(d.zone, (dotsByZone.get(d.zone) ?? 0) + 1);

  const zones = sim.zones.filter((z) => z.id < 10_000 && z.kind !== null);
  const km2 = (r: number) => (Math.PI * r * r) / (pxPerKm * pxPerKm);
  const densities: Record<'residential' | 'employment', number[]> = {
    residential: [],
    employment: [],
  };
  for (const z of zones) {
    if (z.kind === 'mixed') continue;
    const area = km2(z.r);
    if (area > 0) densities[z.kind].push((dotsByZone.get(z.id) ?? 0) / area);
  }
  const thresholds = {
    residential: tercile(densities.residential),
    employment: tercile(densities.employment),
  };

  let maxDots = 1;
  for (const n of dotsByZone.values()) if (n > maxDots) maxDots = n;

  const out: ZoneBubble[] = [];
  for (const z of zones) {
    const dots = dotsByZone.get(z.id) ?? 0;
    const area = km2(z.r);
    const density = area > 0 ? dots / area : 0;
    let core = 0;
    let coreColor = MIXED_CORE;
    if (dots > 0) {
      // 图标固定屏幕大小：面积 ∝ 点数，半径 ∝ sqrt，映射到 3.5–10 px。
      core = 3.5 + 6.5 * Math.sqrt(dots / maxDots);
      if (z.kind !== 'mixed') {
        const [one, two] = thresholds[z.kind];
        const tier = density < one ? 0 : density < two ? 1 : 2;
        coreColor = CORE[z.kind][tier];
      } else {
        core *= 0.7;
      }
    }
    out.push({
      zoneId: z.id,
      x: z.x,
      y: z.y,
      r: z.r,
      kind: z.kind,
      fill: FILL[z.kind],
      fillAlpha: FILL_ALPHA[z.kind],
      core,
      coreColor,
      density,
    });
  }
  return out;
}
