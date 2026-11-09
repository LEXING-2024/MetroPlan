import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { Simulation } from '../src/sim/simulation';
import { WalkRouter } from '../src/sim/walkRouter';

describe('M3 walk routing', () => {
  it('builds a car path as walk access + drive + walk egress', () => {
    const router = new WalkRouter();
    const route = router.carRoute({ x: 700, y: 1125 }, { x: 940, y: 1085 }, 160);
    expect(route).not.toBeNull();
    if (route) {
      expect(route.path.length).toBeGreaterThan(2);
      expect(route.accessMinutes).toBeGreaterThanOrEqual(0);
      expect(route.driveMinutes).toBeGreaterThanOrEqual(0);
      expect(route.egressMinutes).toBeGreaterThanOrEqual(0);
    }
  });
  it('routes between points on the main walking component', () => {
    const router = new WalkRouter();
    const result = router.route({ x: 700, y: 1125 }, { x: 825, y: 1150 });
    expect(result).not.toBeNull();
    expect(result!.minutes).toBeGreaterThan(0);
    expect(result!.meters).toBeGreaterThan(0);
    expect(result!.path.length).toBeGreaterThan(2);
  });

  it('routes along real walking edges instead of a coarse grid', () => {
    const router = new WalkRouter();
    const result = router.route({ x: 700, y: 1125 }, { x: 1205, y: 578 }, 'walk', 160);
    expect(result).not.toBeNull();
    const path = result!.path;
    // 真实路径会包含大量路网节点；粗网格只有几个 48px 格子中心。
    expect(path.length).toBeGreaterThan(20);
    const [ax, ay] = path[0]!;
    const [bx, by] = path[path.length - 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    let maxDev = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const [x, y] = path[i]!;
      const dev = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
      if (dev > maxDev) maxDev = dev;
    }
    expect(maxDev).toBeGreaterThan(2);
  });

  it('is attached to an activity simulation with m3 enabled', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      activity: true,
      walkNetwork: true,
      count: 180,
      maxAgents: 4000,
      seed: 424242,
    });
    expect(sim.walkRouter).not.toBeNull();
    expect(sim.activityStats().walkNodes).toBeGreaterThan(1000);
    expect(sim.activityStats().trips).toBeGreaterThan(0);
  });

  it('enables graph-based station choice with m4', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      activity: true,
      walkNetwork: true,
      walkChoice: true,
      count: 180,
      maxAgents: 4000,
      seed: 424242,
    });
    expect(sim.walkChoice).toBe(true);
    expect(sim.activityStats().walkChoice).toBe(true);
    sim.fund = 100000;
    const a = sim.placeStation(sim.agents.homeX[0]!, sim.agents.homeY[0]!).station!;
    const b = sim.placeStation(sim.agents.workX[0]!, sim.agents.workY[0]!).station!;
    expect(sim.createLine([a.id, b.id], 0).ok).toBe(true);
    sim.setPaused(false);
    sim.advanceMinutes(500);
    expect(sim.activityStats().walkRoutedTrips).toBeGreaterThan(0);
  }, 45000);

  it('uses graph access for metro trips when stations cover an anchor', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      activity: true,
      walkNetwork: true,
      count: 180,
      maxAgents: 4000,
      seed: 424242,
    });
    sim.fund = 100000;
    // 固定用端州步行网覆盖的锚点，避免随机 agent 落在无路网的村点。
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(940, 1085).station!;
    expect(sim.createLine([a.id, b.id], 0).ok).toBe(true);
    sim.setPaused(false);
    sim.advanceMinutes(600);
    expect(sim.activityStats().walkRoutedTrips).toBeGreaterThan(0);
  }, 45000);
});

