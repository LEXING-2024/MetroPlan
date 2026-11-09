import { describe, expect, it } from 'vitest';
import {
  buildPopulationField,
  createBlankMap,
  makePoi,
  polygonArea,
  customMinGap,
  customWalkRadius,
  customWalkSpeed,
  poiAgentWindow,
  normalizePoi,
  poiDailyRange,
  poiTimeWeight,
  polygonCentroid,
  regionAreaKm2,
  sampleRegionDots,
} from '../src/sim/mapData';
import { Simulation } from '../src/sim/simulation';
import { makeSaveFile, restoreSim } from '../src/sim/save';
import type { CustomMapData } from '../src/sim/types';

function demoMap(): CustomMapData {
  const map = createBlankMap('测试地图');
  map.pxPerKm = 100;
  map.regions = [
    {
      id: 1,
      type: 'residential',
      name: '西岸居住区',
      weight: 1.2,
      color: '#C9A98A',
      shape: {
        kind: 'polygon',
        points: [
          { x: 600, y: 500 },
          { x: 900, y: 500 },
          { x: 900, y: 760 },
          { x: 600, y: 760 },
        ],
      },
    },
    {
      id: 2,
      type: 'employment',
      name: '东岸就业区',
      weight: 1.4,
      color: '#8FA6B8',
      shape: {
        kind: 'polygon',
        points: [
          { x: 1100, y: 520 },
          { x: 1380, y: 520 },
          { x: 1380, y: 780 },
          { x: 1100, y: 780 },
        ],
      },
    },
  ];
  map.pois = [makePoi('hospital', 1000, 640, 1), makePoi('school', 780, 900, 2)];
  return map;
}

describe('创作模式地图数据', () => {
  it('多边形面积、重心与比例尺换算', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(polygonArea(pts)).toBe(10000);
    expect(polygonCentroid(pts).x).toBeCloseTo(50, 3);
    expect(polygonCentroid(pts).y).toBeCloseTo(50, 3);
    const region = demoMap().regions[0]!;
    expect(regionAreaKm2(region, 100)).toBeCloseTo(7.8, 3);
  });

  it('多边形与笔刷都能生成点阵', () => {
    const map = demoMap();
    const region = map.regions[0]!;
    const dots = sampleRegionDots(region, 100, 1);
    expect(dots.length).toBeGreaterThan(10);
    for (const d of dots) {
      expect(d.x).toBeGreaterThanOrEqual(600);
      expect(d.x).toBeLessThanOrEqual(900);
      expect(d.y).toBeGreaterThanOrEqual(500);
      expect(d.y).toBeLessThanOrEqual(760);
    }
    const brush = {
      id: 3,
      type: 'residential' as const,
      name: '笔刷区',
      weight: 1,
      color: '#C9A98A',
      shape: {
        kind: 'brush' as const,
        stamps: [
          { x: 400, y: 400, r: 80, strength: 1, hardness: 0.5 },
          { x: 450, y: 430, r: 60, strength: 0.8, hardness: 0.5 },
        ],
      },
    };
    const brushDots = sampleRegionDots(brush, 100, 3);
    expect(brushDots.length).toBeGreaterThan(5);
  });

  it('构建人口场并生成 POI 群体', () => {
    const map = demoMap();
    const field = buildPopulationField(map);
    expect(field.zones.length).toBe(4); // 2 区域 + 2 个有群体的 POI
    expect(field.residential.length).toBeGreaterThan(10);
    expect(field.employment.length).toBeGreaterThan(10);
    expect(field.pois.length).toBe(2);
    expect(field.pxPerKm).toBe(100);

    const sim = new Simulation({
      field,
      pxPerKm: 100,
      walkRadiusPx: 90,
      walkSpeed: 9,
      minStationGap: 22,
      map,
      mapId: map.id,
      mapName: map.name,
    });
    expect(sim.agents.count).toBeGreaterThan(500);
    const counts = sim.groupCounts();
    expect(counts[3]).toBeGreaterThan(0);
    expect(counts[6]).toBeGreaterThan(0);
    expect(sim.walkRadiusPx).toBe(90);
    expect(sim.zones.length).toBe(4);
    expect(sim.mapName).toBe('测试地图');
  });

  it('自定义地图的步行半径来自比例尺', () => {
    const map = demoMap();
    const field = buildPopulationField(map);
    const sim = new Simulation({ field, map, pxPerKm: 200, walkRadiusPx: 160, walkSpeed: 15 });
    const near = sim.previewCoverage(750, 630);
    const far = sim.previewCoverage(400, 200);
    expect(near.residents + near.jobs).toBeGreaterThan(0);
    expect(far.residents + far.jobs).toBe(0);
  });

  it('比例尺、POI 时间窗与周末规则', () => {
    expect(customWalkRadius(100)).toBeGreaterThan(50);
    expect(customWalkSpeed(100)).toBeGreaterThan(5);
    expect(customMinGap(100)).toBeGreaterThan(20);
    const school = makePoi('school', 0, 0, 1);
    expect(poiAgentWindow(school, () => 0.5).dayRule).toBe(1);
    const scenic = makePoi('scenic', 0, 0, 2);
    let weekend = 0;
    for (let i = 0; i < 120; i++) {
      if (poiAgentWindow(scenic, Math.random).dayRule === 2) weekend++;
    }
    expect(weekend).toBeGreaterThan(20);
    const map = demoMap();
    const field = buildPopulationField(map);
    const sim = new Simulation({ field, map, pxPerKm: 100 });
    let students = 0;
    for (let i = 0; i < sim.agents.count; i++) {
      if (sim.agents.group[i] === 6) {
        students++;
        // 走读生按工作日规则，住校生按“周末回家”规则；都不应该缺席。
        expect([1, 2]).toContain(sim.agents.dayRule[i]);
      }
    }
    expect(students).toBeGreaterThan(0);
  });

  it('自定义地图存档往返保留地图、POI 群体与日规则', () => {
    const map = demoMap();
    const field = buildPopulationField(map);
    const sim = new Simulation({ field, map, pxPerKm: 100, walkRadiusPx: 80, walkSpeed: 8, mapId: map.id, mapName: map.name });
    sim.settings.autoPause = false;
    sim.advanceMinutes(120);
    const file = makeSaveFile(sim, 'manual-1');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    expect(restored.mapId).toBe(map.id);
    expect(restored.mapName).toBe(map.name);
    expect(restored.map?.regions.length).toBe(2);
    expect(restored.zones.length).toBe(4);
    expect(restored.agents.count).toBe(sim.agents.count);
    expect(restored.groupCounts()[3]).toBeGreaterThan(0);
    expect(restored.pxPerKm).toBe(100);
    expect(restored.walkRadiusPx).toBe(80);
    expect(restored.pois.length).toBe(2);
  });

  it('创作模式 POI 默认 6 级字段，旧地图可迁移', () => {
    const poi = makePoi('hospital', 100, 100, 1);
    expect(poi.level).toBe(3);
    expect(poi.scale).toBe(1);
    expect(poi.profile).toBe('hard');
    expect(poi.dailyMax).toBeGreaterThan(poi.dailyMin);
    expect(poiTimeWeight(poi, 16 * 60, 0)).toBeGreaterThan(0);

    const legacy = {
      id: 9,
      type: 'scenic' as const,
      x: 0,
      y: 0,
      radiusKm: 2,
      weight: 1.3,
      window: 'daytime' as const,
      name: '旧景区',
    };
    const migrated = normalizePoi(legacy as never);
    expect(migrated.level).toBeGreaterThanOrEqual(1);
    expect(migrated.scale).toBeCloseTo(1.2, 5);
    expect(migrated.profile).toBe('soft');
    expect(migrated.openMin).toBe(540);
    expect(migrated.closeMin).toBe(1080);
    expect(migrated.dailyMax).toBe(poiDailyRange(migrated.level, migrated.scale).dailyMax);
  });
});
