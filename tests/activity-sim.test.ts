import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { Simulation } from '../src/sim/simulation';

function activitySim(): Simulation {
  return new Simulation({
    field: TERRAIN_MAP.createField(),
    activity: true,
    count: 240,
    maxAgents: 4000,
    seed: 424242,
  });
}

describe('M2 activity-chain Simulation integration', () => {
  it('builds chains for every agent and counts all chain trips', () => {
    const sim = activitySim();
    const stats = sim.activityStats();
    expect(stats.mode).toBe(true);
    expect(stats.chains).toBe(sim.agents.count);
    expect(stats.trips).toBeGreaterThan(sim.agents.count);
    expect(stats.multiTripAgents).toBeGreaterThan(0);
    // 周末专属 agent 不在周三的活动日内，所以当日 trips 小于全量链。
    expect(sim.stats.trips).toBeGreaterThan(0);
    expect(sim.stats.trips).toBeLessThanOrEqual(stats.trips);
  });

  it('混合客流包含午间 / 下班任务；多数人 routine 稳定，少数不规律者逐日变化', () => {
    const sim = activitySim();
    const stats = sim.activityStats();
    // 旧 M2 只有 2 段通勤；现在约三分之一的人至少有 3 段。
    expect(stats.trips / stats.agents).toBeGreaterThan(2.2);
    expect(stats.multiTripAgents / stats.agents).toBeGreaterThan(0.2);

    const routesOf = (s: Simulation): string[] =>
      (
        s as unknown as {
          activityChains: Array<Array<{ purpose: string; toX: number; toY: number }>>;
        }
      ).activityChains.map((chain) =>
        chain
          .map((trip) => `${trip.purpose}@${Math.round(trip.toX)},${Math.round(trip.toY)}`)
          .join('>'),
      );
    // 第一天结算会做一次全量 POI 目的地重选；从第二天开始才看“日常稳定性”。
    sim.advanceMinutes(1440);
    const before = routesOf(sim);
    sim.advanceMinutes(1440);
    const after = routesOf(sim);
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) changed++;
    }
    const ratio = changed / before.length;
    // 大多数人保持固定 routine；只有少数不规律者 / 重选目的地的人会变。
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.4);
  }, 20_000);

  it('moves background trips without a metro network', () => {
    const sim = activitySim();
    sim.setPaused(false);
    sim.advanceMinutes(180);
    const stats = sim.activityStats();
    expect(stats.backgroundTrips).toBeGreaterThan(0);
    expect(sim.stats.delivered).toBeGreaterThan(0);
    expect(stats.metroTrips).toBe(0);
  });

  it('uses the metro when a station pair covers an activity trip', () => {
    const sim = activitySim();
    sim.fund = 100000;
    const a = sim.placeStation(sim.agents.homeX[0]!, sim.agents.homeY[0]!).station!;
    const b = sim.placeStation(sim.agents.workX[0]!, sim.agents.workY[0]!).station!;
    const line = sim.createLine([a.id, b.id], 0);
    expect(line.ok).toBe(true);
    sim.setPaused(false);
    sim.advanceMinutes(600);
    expect(sim.activityStats().metroTrips).toBeGreaterThan(0);
  });

  it('keeps the old out/back model when the flag is off', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      count: 120,
      maxAgents: 3000,
      seed: 424242,
    });
    expect(sim.activityMode).toBe(false);
    expect(sim.activityStats().chains).toBe(0);
    expect(sim.stats.trips).toBeGreaterThan(0);
  });
});
