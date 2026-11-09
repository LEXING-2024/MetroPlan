import type { PopulationField } from '../types';
import { buildPlansAndTrips } from './activities';
import { buildPlaceLibrary } from './places';
import { buildSyntheticPopulation } from './population';
import type {
  ActivityDemandSummary,
  ActivityModel,
  ActivityModelOptions,
  ActivityPlaceKind,
  ActivityPurpose,
  BackgroundMode,
  PersonRole,
} from './types';

function emptyPlaces(): Record<ActivityPlaceKind, number> {
  return {
    home: 0,
    work: 0,
    school: 0,
    shopping: 0,
    leisure: 0,
    medical: 0,
    mixed: 0,
  };
}

function emptyRoles(): Record<PersonRole, number> {
  return { worker: 0, student: 0, retiree: 0, homemaker: 0, child: 0 };
}

function emptyModes(): Record<BackgroundMode, number> {
  return { walk: 0, ebike: 0, bus: 0, car: 0 };
}

function emptyPurposes(): Record<ActivityPurpose, number> {
  return {
    home: 0,
    work: 0,
    school: 0,
    shopping: 0,
    leisure: 0,
    medical: 0,
    errand: 0,
  };
}

export function buildActivityModel(
  field: PopulationField,
  options: ActivityModelOptions = {},
): ActivityModel {
  const seed = options.seed ?? 20260101;
  const library = buildPlaceLibrary(field);
  const { households, persons } = buildSyntheticPopulation(field, library, {
    ...options,
    seed,
  });
  const { plans, trips } = buildPlansAndTrips(persons, field, library, seed);

  const places = emptyPlaces();
  for (const place of library.places) places[place.kind] += 1;

  const personsByRole = emptyRoles();
  const personsByMode = emptyModes();
  const tripModeByPerson = new Map<number, BackgroundMode>();
  for (const person of persons) personsByRole[person.role] += 1;
  for (const trip of trips) {
    if (!tripModeByPerson.has(trip.personId)) tripModeByPerson.set(trip.personId, trip.mode);
  }
  for (const mode of tripModeByPerson.values()) personsByMode[mode] += 1;

  const tripsByPurpose = emptyPurposes();
  const tripsByMode = emptyModes();
  const departureByHour = new Array<number>(24).fill(0);
  let distanceSum = 0;
  for (const trip of trips) {
    tripsByPurpose[trip.purpose] += 1;
    tripsByMode[trip.mode] += 1;
    const hour = Math.min(23, Math.max(0, Math.floor(trip.departMin / 60)));
    departureByHour[hour] = (departureByHour[hour] ?? 0) + 1;
    distanceSum += trip.distanceKm;
  }

  const summary: ActivityDemandSummary = {
    places,
    households: households.length,
    persons: persons.length,
    personsByRole,
    personsByMode,
    trips: trips.length,
    tripsByPurpose,
    tripsByMode,
    averageTripKm: trips.length > 0 ? distanceSum / trips.length : 0,
    departureByHour,
    representedResidents: persons.reduce((sum, person) => sum + person.weight, 0),
    mobilePersons: tripModeByPerson.size,
  };

  return {
    places: library.places,
    households,
    persons,
    plans,
    trips,
    summary,
    seed,
  };
}

export * from './types';
export { buildPlaceLibrary } from './places';
export { buildSyntheticPopulation } from './population';
export { buildPlansAndTrips } from './activities';
