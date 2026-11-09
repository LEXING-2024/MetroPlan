import { describe, expect, it } from 'vitest';
import raw from '../map/game-data/terrain-rules.json?raw';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { Simulation } from '../src/sim/simulation';
import { terrainAt } from '../src/sim/terrainRules';

const grid = JSON.parse(raw) as {
  width: number;
  height: number;
  cellPx: number;
  slopeMaxDeg: number[];
  waterFraction: number[];
};

function pointAt(index: number): { x: number; y: number } {
  return {
    x: (index % grid.width) * grid.cellPx + grid.cellPx / 2,
    y: Math.floor(index / grid.width) * grid.cellPx + grid.cellPx / 2,
  };
}

describe('terrain population data', () => {
  it('禄村不再把工业建筑足迹当成 6.8 万人的住宅区', () => {
    const field = TERRAIN_MAP.createField();
    const zone = field.zones.find((z) => z.name === '禄村');
    expect(zone).toBeTruthy();
    const cells = field.residential.filter((c) => c.zone === zone!.id);
    const population = cells.reduce((sum, c) => sum + (c.population ?? 0), 0);
    expect(population).toBeGreaterThan(0);
    expect(population).toBeLessThan(5_000);
  });
});

describe('terrain station constraints', () => {
  it('rejects water and very steep mountain cells', () => {
    const water = grid.waterFraction.findIndex((v) => v > 0.5);
    expect(water).toBeGreaterThanOrEqual(0);
    const wp = pointAt(water);
    expect(terrainAt(wp.x, wp.y).suitable).toBe(false);
    expect(terrainAt(wp.x, wp.y).reason).toContain('水域');

    const steep = grid.slopeMaxDeg.findIndex((v) => v > 30);
    expect(steep).toBeGreaterThanOrEqual(0);
    const sp = pointAt(steep);
    expect(terrainAt(sp.x, sp.y).suitable).toBe(false);
    expect(terrainAt(sp.x, sp.y).reason).toContain('坡度');
  });

  it('does not allow a terrain station on water', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      count: 80,
      maxAgents: 3000,
      seed: 7,
      enforceTerrain: true,
    });
    const water = grid.waterFraction.findIndex((v, i) => {
      const p = pointAt(i);
      return v > 0.5 && p.x > 30 && p.y > 30 && p.x < 2530 && p.y < 1410;
    });
    const p = pointAt(water);
    const result = sim.canPlaceStation(p.x, p.y);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('水域');
  });
});
