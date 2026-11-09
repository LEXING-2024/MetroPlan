import { mulberry32 } from '../population';
import type { PopulationField } from '../types';
import { distanceKm, pickWeighted } from './choice';
import type { PlaceLibrary } from './places';
import type {
  ActivityModelOptions,
  PersonRole,
  SyntheticHousehold,
  SyntheticPerson,
} from './types';

interface WorkZone {
  zoneId: number;
  x: number;
  y: number;
  places: PlaceLibrary['works'];
  jobs: number;
}

function totalCapacity(places: Array<{ capacity: number }>): number {
  return places.reduce((sum, place) => sum + place.capacity, 0);
}

function chooseWork(
  home: { x: number; y: number },
  field: PopulationField,
  library: PlaceLibrary,
  pxPerKm: number,
  decayKm: number,
  rng: () => number,
): number | undefined {
  if (library.works.length === 0) return undefined;
  const zoneById = new Map(field.zones.map((zone) => [zone.id, zone]));
  const byZone = new Map<number, WorkZone>();
  for (const place of library.works) {
    let item = byZone.get(place.zoneId);
    if (!item) {
      const zone = zoneById.get(place.zoneId);
      item = {
        zoneId: place.zoneId,
        x: zone?.x ?? place.x,
        y: zone?.y ?? place.y,
        places: [],
        jobs: 0,
      };
      byZone.set(place.zoneId, item);
    }
    item.places.push(place);
    item.jobs += place.capacity;
  }
  const zones = [...byZone.values()];
  const zoneScores = zones.map((zone) => {
    const km = distanceKm(home, zone, pxPerKm);
    return zone.jobs * Math.exp(-km / Math.max(2, decayKm));
  });
  const zone = pickWeighted(zones, zoneScores, rng);
  if (!zone) return undefined;
  return pickWeighted(
    zone.places,
    zone.places.map((place) => place.capacity),
    rng,
  )?.id;
}

function chooseSchool(
  home: { x: number; y: number },
  library: PlaceLibrary,
  pxPerKm: number,
  rng: () => number,
): number | undefined {
  if (library.schools.length === 0) return undefined;
  const scored = library.schools
    .map((place) => {
      const km = distanceKm(home, place, pxPerKm);
      return { place, km, score: place.capacity / Math.pow(km + 0.5, 1.15) };
    })
    .filter((item) => item.km <= 10);
  if (scored.length === 0) {
    return library.schools[0]?.id;
  }
  return pickWeighted(
    scored.map((item) => item.place),
    scored.map((item) => item.score),
    rng,
  )?.id;
}

function personRole(age: number, rng: () => number): PersonRole {
  if (age >= 65) return 'retiree';
  if (age >= 18) return rng() < 0.8 ? 'worker' : 'homemaker';
  if (age >= 6) return 'student';
  return 'child';
}

export interface PopulationResult {
  households: SyntheticHousehold[];
  persons: SyntheticPerson[];
  totalResidents: number;
}

/**
 * Synthetic household/person generator for M1.
 *
 * One selected household represents several real households. A person's
 * `weight` is derived after generation so that the weighted population equals
 * the residential capacity of the current map field.
 */
export function buildSyntheticPopulation(
  field: PopulationField,
  library: PlaceLibrary,
  options: ActivityModelOptions = {},
): PopulationResult {
  const seed = options.seed ?? 20260101;
  const rng = mulberry32(seed ^ 0x51ed27);
  const householdTarget = Math.max(100, options.householdTarget ?? 4200);
  const maxPersons = Math.max(householdTarget, options.maxPersons ?? 24000);
  const decayKm = options.workDecayKm ?? 14;
  const homes = library.homes;
  if (homes.length === 0) {
    return { households: [], persons: [], totalResidents: 0 };
  }

  const totalResidents = totalCapacity(homes);
  const households: SyntheticHousehold[] = [];
  const persons: SyntheticPerson[] = [];
  const homeScores = homes.map((home) => home.capacity);

  for (let h = 0; h < householdTarget && persons.length < maxPersons; h++) {
    const home = pickWeighted(homes, homeScores, rng);
    if (!home) break;
    const householdId = h + 1;
    const adultCount = 1 + (rng() < 0.65 ? 1 : 0) + (rng() < 0.1 ? 1 : 0);
    const childCount = rng() < 0.44 ? 1 + (rng() < 0.18 ? 1 : 0) : 0;
    const elderlyCount = rng() < 0.16 ? 1 : 0;
    const localPersons: SyntheticPerson[] = [];
    const personIds: number[] = [];

    const addPerson = (age: number) => {
      if (persons.length >= maxPersons) return;
      const role = personRole(age, rng);
      const person: SyntheticPerson = {
        id: persons.length + 1,
        householdId,
        homePlaceId: home.id,
        age,
        role,
        hasCar: role !== 'student' && role !== 'child' && rng() < 0.38,
        hasEBike: role !== 'child' && rng() < 0.25,
        weight: 0,
      };
      if (role === 'worker') {
        person.workPlaceId = chooseWork(home, field, library, field.pxPerKm, decayKm, rng);
      } else if (role === 'student') {
        person.schoolPlaceId = chooseSchool(home, library, field.pxPerKm, rng);
      }
      persons.push(person);
      localPersons.push(person);
      personIds.push(person.id);
    };

    for (let i = 0; i < adultCount; i++) addPerson(20 + Math.floor(rng() * 45));
    for (let i = 0; i < childCount; i++) addPerson(1 + Math.floor(rng() * 17));
    for (let i = 0; i < elderlyCount; i++) addPerson(65 + Math.floor(rng() * 18));

    // One parent in a household with a school-age child may escort the child.
    const parent = localPersons.find((person) => person.role === 'worker' && person.workPlaceId);
    const child = localPersons.find(
      (person) => person.role === 'student' && person.schoolPlaceId && person.age <= 12,
    );
    if (parent && child) parent.escortStudentId = child.id;

    households.push({
      id: householdId,
      homePlaceId: home.id,
      weight: 0,
      personIds,
    });
  }

  const personWeight = persons.length > 0 ? totalResidents / persons.length : 0;
  for (const person of persons) person.weight = personWeight;
  for (const household of households) {
    household.weight = household.personIds.length * personWeight;
  }

  return { households, persons, totalResidents };
}
