import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { WORLD_H, WORLD_W } from '../src/sim/constants';
import { estimatePopulation } from '../src/sim/population';
import { Simulation } from '../src/sim/simulation';
import { makeSaveFile, restoreSim } from '../src/sim/save';

function pureSim(seed = 424242): Simulation {
  return new Simulation({
    field: TERRAIN_MAP.createField(),
    activity: true,
    demand: 'commuter',
    seed,
  });
}

describe('纯通勤模式', () => {
  it('人口估算只保留通勤抽样，不再生成 POI 专项', () => {
    const field = TERRAIN_MAP.createField();
    const mixed = estimatePopulation(field, 'mixed');
    const pure = estimatePopulation(field, 'commuter');
    expect(pure.poiVisitors).toBe(0);
    expect(pure.agents).toBe(pure.commuters);
    expect(pure.agents).toBe(field.residential.length);
    expect(mixed.poiVisitors).toBeGreaterThan(0);
    expect(mixed.agents).toBeGreaterThan(pure.agents);
  });

  it('只生成通勤 / 反向通勤，活动链为家 → 工作 → 家', () => {
    const sim = pureSim();
    const counts = sim.groupCounts();
    expect(sim.demandMode).toBe('commuter');
    expect(sim.pureCommuter).toBe(true);
    expect(sim.activityMode).toBe(true);
    expect(counts[0]! + counts[1]!).toBe(sim.agents.count);
    expect(counts[2]).toBe(0);
    expect(counts[3]).toBe(0);
    expect(counts[4]).toBe(0);
    expect(counts[5]).toBe(0);
    expect(counts[6]).toBe(0);

    const stats = sim.activityStats();
    expect(stats.chains).toBe(sim.agents.count);
    // 纯通勤不插入下班顺路休闲点。
    expect(stats.multiTripAgents).toBe(0);
    expect(stats.trips).toBeGreaterThan(sim.agents.count);
  });

  it('没有地铁时，通勤者用步行 / 电动车 / 公交 / 汽车完成出行', () => {
    const sim = pureSim();
    sim.advanceMinutes(240);
    const stats = sim.activityStats();
    expect(stats.backgroundTrips).toBeGreaterThan(0);
    expect(stats.metroTrips).toBe(0);
    expect(sim.stats.delivered).toBeGreaterThan(0);
  });

  it('有地铁且明显更快时，通勤者会坐地铁', () => {
    const sim = pureSim();
    sim.fund = 100000;
    const inside = (x: number, y: number): boolean =>
      x >= 24 && y >= 24 && x <= WORLD_W - 24 && y <= WORLD_H - 24;
    const homeZone = sim.zones
      .filter((z) => z.kind === 'residential' && inside(z.x, z.y))
      .sort((a, b) => b.dots - a.dots)[0]!;
    const workZone = sim.zones
      .filter((z) => z.kind === 'employment' && inside(z.x, z.y))
      .sort((a, b) => b.dots - a.dots)[0]!;
    const a = sim.placeStation(homeZone.x, homeZone.y).station!;
    const b = sim.placeStation(workZone.x, workZone.y).station!;
    expect(sim.createLine([a.id, b.id], 0).ok).toBe(true);
    sim.advanceMinutes(600);
    expect(sim.activityStats().metroTrips).toBeGreaterThan(0);
  });

  it('存档保留纯通勤口径，读档后重建活动链', () => {
    const sim = pureSim(77);
    sim.advanceMinutes(120);
    const file = makeSaveFile(sim, 'manual-1');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    expect(restored.demandMode).toBe('commuter');
    expect(restored.activityMode).toBe(true);
    expect(restored.agents.count).toBe(sim.agents.count);
    expect(restored.activityStats().chains).toBe(sim.agents.count);
    expect(restored.activityStats().multiTripAgents).toBe(0);
  });
});
