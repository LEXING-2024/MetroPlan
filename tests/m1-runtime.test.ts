import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { buildActivityModel } from '../src/sim/activity';
import { Simulation } from '../src/sim/simulation';
import { makeSaveFile, restoreSim } from '../src/sim/save';

describe('M1 drives Simulation', () => {
  it('maps M1 persons and trips into agents and chains', () => {
    const field = TERRAIN_MAP.createField();
    const model = buildActivityModel(field, { seed: 20260101 });
    const sim = new Simulation({
      field,
      activity: true,
      activityModel: model,
      walkNetwork: false,
      walkChoice: false,
    });
    expect(sim.activitySource).toBe('m1');
    expect(sim.agents.count).toBe(model.persons.length);
    expect(sim.activityStats().trips).toBe(model.trips.length);
    expect(sim.activityStats().multiTripAgents).toBeGreaterThan(0);
  }, 20000);

  it('keeps the M1 source through save/load', () => {
    const field = TERRAIN_MAP.createField();
    const model = buildActivityModel(field, { seed: 20260101 });
    const sim = new Simulation({
      field,
      activity: true,
      activityModel: model,
      walkNetwork: false,
      walkChoice: false,
    });
    const restored = restoreSim(JSON.parse(JSON.stringify(makeSaveFile(sim, 'auto').data)));
    expect(restored.activitySource).toBe('m1');
    expect(restored.agents.count).toBe(model.persons.length);
    expect(restored.activityStats().trips).toBe(model.trips.length);
  }, 20000);
});
