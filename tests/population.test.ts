import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import {
  GROUP_COMMUTER,
  GROUP_FLEXIBLE,
  GROUP_REVERSE,
  GROUP_STUDENT,
  PROFILE_META,
} from '../src/sim/constants';
import { createAgents } from '../src/sim/population';
import type { PopulationField, Zone } from '../src/sim/types';

function twoDistrictField(): PopulationField {
  const zones: Zone[] = [
    { id: 1, name: '小镇', kind: 'residential', x: 0, y: 0, r: 20, weight: 1, dots: 1 },
    { id: 2, name: '大城', kind: 'residential', x: 100, y: 0, r: 20, weight: 1, dots: 1 },
    { id: 3, name: '就业区', kind: 'employment', x: 50, y: 50, r: 20, weight: 1, dots: 1 },
  ];
  return {
    zones,
    dots: [],
    residential: [
      { x: 0, y: 0, zone: 1, population: 100 },
      { x: 100, y: 0, zone: 2, population: 900 },
    ],
    employment: [{ x: 50, y: 50, zone: 3 }],
    mixed: [],
    poiZones: [],
    pois: [],
    pxPerKm: 50,
  };
}

describe('住宅抽样', () => {
  it('按住宅单元人口加权，而不是按 cell 数量平均', () => {
    const { agents } = createAgents(twoDistrictField(), 1000, 7, 'mixed');
    let big = 0;
    let small = 0;
    for (let i = 0; i < agents.count; i++) {
      if (agents.homeX[i]! > 50) big++;
      else if (agents.homeX[i]! < 50) small++;
    }
    // 800 个正向 / 灵活 agent 从两片住宅里抽；人口 9:1，期望约 720 : 80。
    expect(big).toBeGreaterThan(650);
    expect(small).toBeGreaterThan(20);
    expect(big / (big + small)).toBeGreaterThan(0.85);
    expect(big / (big + small)).toBeLessThan(0.95);
  });

  it('混合模式反向通勤占基础样本 10%，不再和正向一样多', () => {
    const { agents } = createAgents(twoDistrictField(), 1000, 7, 'mixed');
    const counts = [0, 0, 0];
    for (let i = 0; i < agents.count; i++) {
      const g = agents.group[i]!;
      if (g === GROUP_COMMUTER) counts[0]!++;
      else if (g === GROUP_REVERSE) counts[1]!++;
      else if (g === GROUP_FLEXIBLE) counts[2]!++;
    }
    expect(counts).toEqual([700, 100, 200]);
  });

  it('学生按走读 / 住宿拆分，学生占比降到 15% 左右，社会人士更多', () => {
    const { agents } = createAgents(TERRAIN_MAP.createField(), undefined, 20260101, 'mixed', 30_000);
    let students = 0;
    let boarders = 0;
    let adults = 0;
    const profiles = new Array<number>(PROFILE_META.length).fill(0);
    for (let i = 0; i < agents.count; i++) {
      const profile = agents.profile[i] ?? 0;
      profiles[profile] = (profiles[profile] ?? 0) + 1;
      if (agents.group[i] === GROUP_STUDENT) {
        students++;
        if (agents.dayRule[i] === 2) boarders++;
      } else {
        adults++;
      }
    }
    expect(students / agents.count).toBeLessThan(0.18);
    expect(students).toBeLessThan(adults);
    expect(boarders).toBeGreaterThan(0);
    expect(boarders / students).toBeGreaterThan(0.2);
    expect(profiles.reduce((sum, n) => sum + n, 0)).toBe(agents.count);
    // 住宿生必须落在“中学住宿 / 高校住宿”画像里。
    expect((profiles[15] ?? 0) + (profiles[16] ?? 0)).toBe(boarders);
  });

  it('一部分正向通勤者的工作地直接是 POI', () => {
    const { agents } = createAgents(TERRAIN_MAP.createField(), undefined, 20260101, 'mixed', 30_000);
    let poiWorkers = 0;
    for (let i = 0; i < agents.count; i++) {
      if (agents.workAtPoi[i] === 1) {
        poiWorkers++;
        expect(agents.group[i]).toBe(GROUP_COMMUTER);
        expect(agents.workZone[i]).toBeGreaterThanOrEqual(10_000);
      }
    }
    expect(poiWorkers).toBeGreaterThan(0);
    expect(poiWorkers / agents.count).toBeLessThan(0.1);
  });

  it('车辆拥有率步行最多、电动车其次、汽车最少，且每人速度不同', () => {
    const { agents } = createAgents(TERRAIN_MAP.createField(), undefined, 20260101, 'mixed', 30_000);
    const counts: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < agents.count; i++) {
      const v = agents.vehicle[i] ?? 0;
      counts[v]!++;
      const speed = agents.speedKmh[i]!;
      if (v === 0) expect(speed).toBeGreaterThanOrEqual(4);
      else if (v === 1) expect(speed).toBeGreaterThanOrEqual(13);
      else expect(speed).toBeGreaterThanOrEqual(24);
    }
    expect(counts[0]).toBeGreaterThan(counts[1]!);
    expect(counts[1]).toBeGreaterThan(counts[2]!);
    expect(counts[2]).toBeGreaterThan(0);
  });

  it('人口很大的住宅 cell 不会让所有 agent 共用同一坐标', () => {
    const { agents } = createAgents(TERRAIN_MAP.createField(), undefined, 20260101, 'mixed', 30_000);
    const points = new Map<string, number>();
    let max = 0;
    for (let i = 0; i < agents.count; i++) {
      const key = `${Math.round(agents.homeX[i]!)},${Math.round(agents.homeY[i]!)}`;
      const n = (points.get(key) ?? 0) + 1;
      points.set(key, n);
      if (n > max) max = n;
    }
    // 未加抖动时，一个人口 6.8 万的 cell 会让数十人共用一个点。
    expect(max).toBeLessThan(20);
  });

  it('自定义地图没有 population 时退化为等概率，保持旧行为', () => {
    const field = twoDistrictField();
    field.residential.forEach((c) => delete c.population);
    const { agents } = createAgents(field, 1000, 7, 'mixed');
    let big = 0;
    let small = 0;
    for (let i = 0; i < agents.count; i++) {
      if (agents.homeX[i]! > 50) big++;
      else if (agents.homeX[i]! < 50) small++;
    }
    expect(Math.abs(big - small)).toBeLessThan(120);
  });
});
