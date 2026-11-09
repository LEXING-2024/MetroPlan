import type { PopulationField } from '../types';
import {
  chooseBackgroundMode,
  chooseFlexiblePlace,
  distanceKm,
  flexiblePlaceKind,
  modeMinutes,
} from './choice';
import type { PlaceLibrary } from './places';
import type {
  ActivityPlace,
  ActivityPlan,
  ActivityPurpose,
  ActivityTrip,
  PlannedActivity,
  SyntheticPerson,
} from './types';

interface PlanContext {
  field: PopulationField;
  library: PlaceLibrary;
  byPerson: Map<number, SyntheticPerson>;
  rng: () => number;
}

function jitter(rng: () => number, mean: number, spread: number): number {
  const t = (rng() + rng() + rng() - 1.5) / 1.5;
  return Math.round(mean + t * spread);
}

function push(
  list: PlannedActivity[],
  purpose: ActivityPurpose,
  placeId: number,
  startMin: number,
  endMin: number,
  flexible = false,
): void {
  list.push({
    purpose,
    placeId,
    startMin,
    endMin,
    flexible,
  });
}

function addFlexibleStop(
  list: PlannedActivity[],
  purpose: 'shopping' | 'leisure' | 'medical' | 'errand',
  from: ActivityPlace,
  atMin: number,
  ctx: PlanContext,
): PlannedActivity | null {
  const candidates = flexiblePlaceKind(purpose, ctx.library);
  const chosen = chooseFlexiblePlace(
    purpose,
    from,
    atMin,
    candidates,
    ctx.field.pxPerKm,
    ctx.rng,
  );
  if (!chosen) return null;
  const start = Math.max(atMin, chosen.openMin);
  const end = start + 35 + Math.round(ctx.rng() * 25);
  push(list, purpose, chosen.id, start, end, true);
  return list[list.length - 1] ?? null;
}

function workerActivities(person: SyntheticPerson, ctx: PlanContext): PlannedActivity[] {
  const list: PlannedActivity[] = [];
  const home = ctx.library.byId.get(person.homePlaceId);
  const work = person.workPlaceId ? ctx.library.byId.get(person.workPlaceId) : undefined;
  if (!home || !work) {
    push(list, 'home', person.homePlaceId, 0, 1440);
    return list;
  }

  push(list, 'home', home.id, 0, 0);
  let workStart = jitter(ctx.rng, 480, 28);
  const workEnd = jitter(ctx.rng, 1050, 42);
  const child = person.escortStudentId ? ctx.byPerson.get(person.escortStudentId) : undefined;
  const school = child?.schoolPlaceId ? ctx.library.byId.get(child.schoolPlaceId) : undefined;

  if (school && child) {
    const dropStart = jitter(ctx.rng, 466, 12);
    push(list, 'school', school.id, dropStart, dropStart + 10);
    workStart = Math.max(workStart, dropStart + 40);
    push(list, 'work', work.id, workStart, workEnd);
    const pickupStart = workEnd + 18;
    push(list, 'school', school.id, pickupStart, pickupStart + 10);
    push(list, 'home', home.id, pickupStart + 30, 1440);
    return list;
  }

  push(list, 'work', work.id, workStart, workEnd);

  if (ctx.rng() < 0.25) {
    const purpose = ctx.rng() < 0.62 ? 'shopping' : 'leisure';
    const stop = addFlexibleStop(list, purpose, work, workEnd + 12, ctx);
    if (stop) {
      push(list, 'home', home.id, stop.endMin + 25, 1440);
      return list;
    }
  }

  push(list, 'home', home.id, workEnd + 25, 1440);
  return list;
}

function studentActivities(person: SyntheticPerson, ctx: PlanContext): PlannedActivity[] {
  const list: PlannedActivity[] = [];
  const home = ctx.library.byId.get(person.homePlaceId);
  const school = person.schoolPlaceId ? ctx.library.byId.get(person.schoolPlaceId) : undefined;
  if (!home || !school) {
    push(list, 'home', person.homePlaceId, 0, 1440);
    return list;
  }
  push(list, 'home', home.id, 0, 0);
  const schoolStart = jitter(ctx.rng, 480, 18);
  const schoolEnd = jitter(ctx.rng, 960, 22);
  push(list, 'school', school.id, schoolStart, schoolEnd);
  if (ctx.rng() < 0.22) {
    const stop = addFlexibleStop(list, 'leisure', school, schoolEnd + 18, ctx);
    if (stop) {
      push(list, 'home', home.id, stop.endMin + 20, 1440);
      return list;
    }
  }
  push(list, 'home', home.id, schoolEnd + 20, 1440);
  return list;
}

function retireeActivities(person: SyntheticPerson, ctx: PlanContext): PlannedActivity[] {
  const list: PlannedActivity[] = [];
  const home = ctx.library.byId.get(person.homePlaceId);
  if (!home) {
    push(list, 'home', person.homePlaceId, 0, 1440);
    return list;
  }
  push(list, 'home', home.id, 0, 0);
  if (ctx.rng() < 0.58) {
    const p = ctx.rng();
    const purpose = p < 0.5 ? 'shopping' : p < 0.82 ? 'leisure' : 'medical';
    const stop = addFlexibleStop(list, purpose, home, jitter(ctx.rng, 585, 55), ctx);
    if (stop) {
      push(list, 'home', home.id, stop.endMin + 25, 1440);
      return list;
    }
  }
  push(list, 'home', home.id, jitter(ctx.rng, 800, 80), 1440);
  return list;
}

function buildPlan(person: SyntheticPerson, ctx: PlanContext): PlannedActivity[] {
  if (person.role === 'worker') return workerActivities(person, ctx);
  if (person.role === 'student') return studentActivities(person, ctx);
  if (person.role === 'retiree' || person.role === 'homemaker') {
    return retireeActivities(person, ctx);
  }
  return [{ purpose: 'home', placeId: person.homePlaceId, startMin: 0, endMin: 1440, flexible: false }];
}

function buildTrips(
  person: SyntheticPerson,
  activities: PlannedActivity[],
  ctx: PlanContext,
): ActivityTrip[] {
  const trips: ActivityTrip[] = [];
  for (let i = 0; i < activities.length - 1; i++) {
    const from = ctx.library.byId.get(activities[i]!.placeId);
    const to = ctx.library.byId.get(activities[i + 1]!.placeId);
    if (!from || !to || from.id === to.id) continue;
    const km = distanceKm(from, to, ctx.field.pxPerKm);
    const mode = chooseBackgroundMode(km, person.hasCar, person.hasEBike, ctx.rng);
    const travel = modeMinutes(mode, km);
    const previous = activities[i]!;
    const next = activities[i + 1]!;
    let depart = Math.max(previous.endMin, Math.round(next.startMin - travel));
    let arrive = Math.round(depart + travel);
    if (arrive < depart + 1) arrive = depart + 1;
    if (arrive > next.startMin) {
      next.startMin = arrive;
      if (next.endMin < next.startMin + 10) next.endMin = next.startMin + 10;
    }
    previous.endMin = depart;
    if (depart < 0 || depart > 1440) continue;
    trips.push({
      personId: person.id,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      purpose: next.purpose,
      departMin: depart,
      arriveMin: Math.min(1440, arrive),
      distanceKm: km,
      mode,
    });
  }
  return trips;
}

export interface PlansAndTrips {
  plans: ActivityPlan[];
  trips: ActivityTrip[];
}

export function buildPlansAndTrips(
  persons: SyntheticPerson[],
  field: PopulationField,
  library: PlaceLibrary,
  seed: number,
): PlansAndTrips {
  const byPerson = new Map(persons.map((person) => [person.id, person]));
  const rng = (() => {
    let a = (seed ^ 0xa5a5a5) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const ctx: PlanContext = { field, library, byPerson, rng };
  const plans: ActivityPlan[] = [];
  const trips: ActivityTrip[] = [];
  for (const person of persons) {
    const activities = buildPlan(person, ctx);
    plans.push({ personId: person.id, activities });
    trips.push(...buildTrips(person, activities, ctx));
  }
  return { plans, trips };
}
