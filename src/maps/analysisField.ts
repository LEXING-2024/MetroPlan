import fieldRaw from '../../map/game-data/terrain-field.json?raw';
import type { PopulationField } from '../sim/types';

/**
 * Built-in terrain map population field, generated from map/analysis.
 *
 * The JSON is intentionally parsed per call: Simulation mutates its field
 * (city growth, queues), so separate games must not share arrays.
 */
export function analysisField(): PopulationField {
  return JSON.parse(fieldRaw) as PopulationField;
}
