/**
 * M1 activity-based demand model.
 *
 * This module is intentionally independent of the running Simulation. It
 * describes places, synthetic households/persons, daily activity plans and
 * trips; the existing Simulation keeps running untouched until M2.
 */

export type ActivityPurpose =
  | 'home'
  | 'work'
  | 'school'
  | 'shopping'
  | 'leisure'
  | 'medical'
  | 'errand';

export type ActivityPlaceKind =
  | 'home'
  | 'work'
  | 'school'
  | 'shopping'
  | 'leisure'
  | 'medical'
  | 'mixed';

/** M1 only assigns background modes; metro is added in M3. */
export type BackgroundMode = 'walk' | 'ebike' | 'bus' | 'car';

export interface ActivityPlace {
  id: number;
  kind: ActivityPlaceKind;
  name: string;
  x: number;
  y: number;
  zoneId: number;
  /** Number of residents / jobs / visits the place can absorb. */
  capacity: number;
  /** Relative within-kind attractiveness. */
  attraction: number;
  openMin: number;
  closeMin: number;
  poiId?: number;
}

export type PersonRole = 'worker' | 'student' | 'retiree' | 'homemaker' | 'child';

export interface SyntheticHousehold {
  id: number;
  homePlaceId: number;
  /** Number of real households represented by this synthetic household. */
  weight: number;
  personIds: number[];
}

export interface SyntheticPerson {
  id: number;
  householdId: number;
  homePlaceId: number;
  age: number;
  role: PersonRole;
  workPlaceId?: number;
  schoolPlaceId?: number;
  hasCar: boolean;
  hasEBike: boolean;
  /** Number of real residents represented by this synthetic person. */
  weight: number;
  /** Only used for a parent escort chain. */
  escortStudentId?: number;
}

export interface PlannedActivity {
  purpose: ActivityPurpose;
  placeId: number;
  /** Earliest sensible start (minutes after midnight). */
  startMin: number;
  /** Latest sensible end; flexible activities may shift earlier/later. */
  endMin: number;
  flexible: boolean;
}

export interface ActivityPlan {
  personId: number;
  activities: PlannedActivity[];
}

export interface ActivityTrip {
  personId: number;
  fromPlaceId: number;
  toPlaceId: number;
  purpose: ActivityPurpose;
  departMin: number;
  arriveMin: number;
  distanceKm: number;
  mode: BackgroundMode;
}

export interface ActivityDemandSummary {
  places: Record<ActivityPlaceKind, number>;
  households: number;
  persons: number;
  personsByRole: Record<PersonRole, number>;
  personsByMode: Record<BackgroundMode, number>;
  trips: number;
  tripsByPurpose: Record<ActivityPurpose, number>;
  tripsByMode: Record<BackgroundMode, number>;
  averageTripKm: number;
  /** Trips per hour bucket, 0..23. */
  departureByHour: number[];
  /** Sum of person weights, i.e. the represented resident population. */
  representedResidents: number;
  /** Number of synthetic persons that have at least one non-home activity. */
  mobilePersons: number;
}

export interface ActivityModel {
  places: ActivityPlace[];
  households: SyntheticHousehold[];
  persons: SyntheticPerson[];
  plans: ActivityPlan[];
  trips: ActivityTrip[];
  summary: ActivityDemandSummary;
  seed: number;
}

export interface ActivityModelOptions {
  seed?: number;
  /** Target number of synthetic households. */
  householdTarget?: number;
  /** Hard cap on synthetic persons, mostly for tests/very large maps. */
  maxPersons?: number;
  /** Long-term workplace distance decay in km. */
  workDecayKm?: number;
}
