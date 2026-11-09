import type { AgentFields } from '../types';
import { createEmptyAgents } from '../population';
import type { ChainPurpose, AgentActivityTrip } from './agentChains';
import type { ActivityModel, ActivityPurpose, ActivityPlace } from './types';

const PURPOSE_MAP: Record<ActivityPurpose, ChainPurpose> = {
  home: 'home',
  work: 'work',
  school: 'school',
  shopping: 'shopping',
  leisure: 'leisure',
  medical: 'medical',
  errand: 'errand',
};

function groupForRole(role: string): number {
  if (role === 'worker') return 0;
  if (role === 'student') return 6;
  return 2;
}

/**
 * M1 → Simulation adapter.
 *
 * M1 already has synthetic persons, places and daily trips. This turns each
 * person into one Simulation agent and each trip into an activity-chain leg.
 * Household/person weights stay in M1's summary; one synthetic person maps to
 * one visible agent (the same convention as the legacy agent field).
 */
export function createM1AgentFields(model: ActivityModel, _pxPerKm: number): AgentFields {
  const places = new Map(model.places.map((place) => [place.id, place]));
  const persons = model.persons;
  const agents = createEmptyAgents(persons.length);
  const tripsByPerson = new Map<number, ActivityModel['trips']>();
  for (const trip of model.trips) {
    const list = tripsByPerson.get(trip.personId);
    if (list) list.push(trip);
    else tripsByPerson.set(trip.personId, [trip]);
  }

  for (let i = 0; i < persons.length; i++) {
    const person = persons[i]!;
    const home = places.get(person.homePlaceId);
    const work =
      places.get(person.workPlaceId ?? -1) ?? places.get(person.schoolPlaceId ?? -1) ?? home;
    const trips = (tripsByPerson.get(person.id) ?? []).slice().sort((a, b) => a.departMin - b.departMin);
    const first = trips[0];
    const last = trips[trips.length - 1];
    agents.homeX[i] = home?.x ?? 0;
    agents.homeY[i] = home?.y ?? 0;
    agents.workX[i] = work?.x ?? home?.x ?? 0;
    agents.workY[i] = work?.y ?? home?.y ?? 0;
    agents.homeZone[i] = home?.zoneId ?? -1;
    agents.workZone[i] = work?.zoneId ?? -1;
    agents.group[i] = groupForRole(person.role);
    agents.jobGroup[i] = agents.group[i]!;
    agents.employed[i] = person.role === 'worker' ? 1 : 0;
    agents.profile[i] = person.role === 'student' ? 13 : person.role === 'retiree' ? 7 : 0;
    agents.vehicle[i] = 0;
    agents.speedKmh[i] = 4.5;
    agents.dayRule[i] = 0;
    agents.outMin[i] = first?.departMin ?? 480;
    agents.backMin[i] = last?.departMin ?? 1080;
    agents.hasReturn[i] = trips.some((trip) => trip.purpose === 'home') ? 1 : 0;
    // Keep the fields meaningful even though M2 drives movement via chains.
    agents.state[i] = 0;
    agents.legIndex[i] = 0;
  }
  return agents;
}

export function createM1ActivityChains(model: ActivityModel): AgentActivityTrip[][] {
  const places = new Map(model.places.map((place) => [place.id, place]));
  const byPerson = new Map<number, AgentActivityTrip[]>();
  for (const trip of model.trips) {
    const from = places.get(trip.fromPlaceId);
    const to = places.get(trip.toPlaceId);
    if (!from || !to) continue;
    const list = byPerson.get(trip.personId);
    const leg: AgentActivityTrip = {
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      purpose: PURPOSE_MAP[trip.purpose],
      plannedDepart: Math.max(0, Math.min(1438, Math.round(trip.departMin))),
      distanceKm: trip.distanceKm,
      mode: trip.mode,
      toHome: trip.purpose === 'home',
    };
    if (list) list.push(leg);
    else byPerson.set(trip.personId, [leg]);
  }
  const chains: AgentActivityTrip[][] = [];
  for (const person of model.persons) {
    const chain = (byPerson.get(person.id) ?? []).sort(
      (a, b) => a.plannedDepart - b.plannedDepart,
    );
    chains.push(chain);
  }
  return chains;
}

export function m1PlaceDistance(
  from: ActivityPlace,
  to: ActivityPlace,
  pxPerKm: number,
): number {
  return Math.hypot(from.x - to.x, from.y - to.y) / Math.max(1, pxPerKm);
}
