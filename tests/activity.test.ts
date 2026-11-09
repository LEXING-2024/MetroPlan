import { describe, expect, it } from 'vitest';
import { TERRAIN_MAP } from '../src/maps/terrain';
import { buildActivityModel } from '../src/sim/activity';
import type { ActivityModel } from '../src/sim/activity';

function smallModel(seed = 12345): ActivityModel {
  return buildActivityModel(TERRAIN_MAP.createField(), {
    seed,
    householdTarget: 700,
    maxPersons: 3000,
  });
}

describe('M1 activity-based demand model', () => {
  it('builds places, households, persons, plans and trips', () => {
    const model = smallModel();
    expect(model.places.length).toBeGreaterThan(0);
    expect(model.summary.places.home).toBeGreaterThan(0);
    expect(model.summary.places.work).toBeGreaterThan(0);
    expect(model.households.length).toBeGreaterThan(0);
    expect(model.persons.length).toBeGreaterThan(0);
    expect(model.trips.length).toBeGreaterThan(0);
    expect(model.summary.representedResidents).toBeGreaterThan(0);
    expect(model.summary.mobilePersons).toBeGreaterThan(0);
  });

  it('keeps every person anchored to a valid home and workplace/school', () => {
    const model = smallModel();
    const byId = new Map(model.places.map((place) => [place.id, place]));
    for (const person of model.persons) {
      expect(byId.get(person.homePlaceId)?.kind).toBe('home');
      if (person.workPlaceId !== undefined) {
        expect(byId.get(person.workPlaceId)?.kind).toBe('work');
      }
      if (person.schoolPlaceId !== undefined) {
        expect(byId.get(person.schoolPlaceId)?.kind).toBe('school');
      }
    }
  });

  it('produces chronological plans that start and end at home', () => {
    const model = smallModel();
    const placeById = new Map(model.places.map((place) => [place.id, place]));
    for (const plan of model.plans) {
      expect(plan.activities.length).toBeGreaterThanOrEqual(1);
      const first = plan.activities[0]!;
      const last = plan.activities[plan.activities.length - 1]!;
      expect(placeById.get(first.placeId)?.kind).toBe('home');
      expect(placeById.get(last.placeId)?.kind).toBe('home');
      for (let i = 0; i < plan.activities.length; i++) {
        const activity = plan.activities[i]!;
        expect(activity.startMin).toBeGreaterThanOrEqual(0);
        expect(activity.endMin).toBeLessThanOrEqual(1440);
        expect(activity.endMin).toBeGreaterThanOrEqual(activity.startMin);
        if (i > 0) {
          expect(activity.startMin).toBeGreaterThanOrEqual(plan.activities[i - 1]!.endMin);
        }
      }
    }
  });

  it('keeps trips inside the day and assigns a background mode', () => {
    const model = smallModel();
    const byId = new Map(model.places.map((place) => [place.id, place]));
    const validModes = new Set(['walk', 'ebike', 'bus', 'car']);
    for (const trip of model.trips) {
      expect(byId.has(trip.fromPlaceId)).toBe(true);
      expect(byId.has(trip.toPlaceId)).toBe(true);
      expect(trip.fromPlaceId).not.toBe(trip.toPlaceId);
      expect(trip.departMin).toBeGreaterThanOrEqual(0);
      expect(trip.departMin).toBeLessThanOrEqual(1440);
      expect(trip.arriveMin).toBeGreaterThanOrEqual(trip.departMin);
      expect(trip.arriveMin).toBeLessThanOrEqual(1440);
      expect(trip.distanceKm).toBeGreaterThan(0);
      expect(validModes.has(trip.mode)).toBe(true);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = smallModel(991);
    const b = smallModel(991);
    expect(a.summary).toEqual(b.summary);
    expect(a.trips.length).toBe(b.trips.length);
  });
});
