import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { Simulation } from '../src/sim/simulation';
import { makeSaveFile, restoreSim } from '../src/sim/save';

describe('station queues after last service', () => {
  it('clears waiting passengers once the last train has parked', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      count: 500,
      maxAgents: 4000,
      seed: 424242,
    });
    sim.fund = 100000;
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(940, 1085).station!;
    expect(sim.createLine([a.id, b.id], 0).ok).toBe(true);
    sim.setPaused(false);
    sim.advanceMinutes(500);
    expect(sim.waitingAt(a.id) + sim.waitingAt(b.id)).toBeGreaterThan(0);
    sim.advanceMinutes(580);
    expect(sim.waitingAt(a.id)).toBe(0);
    expect(sim.waitingAt(b.id)).toBe(0);
    expect(sim.entriesBestAt(a.id)).toBeGreaterThan(0);
    expect(sim.exitsBestAt(a.id)).toBeGreaterThan(0);
    const restored = restoreSim(JSON.parse(JSON.stringify(makeSaveFile(sim, 'auto').data)));
    expect(restored.entriesBestAt(a.id)).toBeGreaterThan(0);
    expect(restored.exitsBestAt(a.id)).toBeGreaterThan(0);
  }, 20000);
});
