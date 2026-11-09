import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { Simulation } from '../src/sim/simulation';
import { buildHeatFrame } from '../src/sim/heat';

describe('background-mode heat', () => {
  it('counts non-metro trips when there is no metro at all', () => {
    const sim = new Simulation({
      field: TERRAIN_MAP.createField(),
      activity: true,
      count: 180,
      maxAgents: 3000,
      seed: 424242,
    });
    sim.setPaused(false);
    sim.advanceMinutes(180);
    const frame = buildHeatFrame(sim);
    expect(frame.activePeople).toBeGreaterThan(0);
    expect(frame.backgroundPeople).toBeGreaterThan(0);
    expect(frame.peak).toBeGreaterThan(0);
  });
});
