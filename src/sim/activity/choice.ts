import type { ActivityPlace, ActivityPlaceKind, BackgroundMode } from './types';

export function distanceKm(
  a: { x: number; y: number },
  b: { x: number; y: number },
  pxPerKm: number,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pxPerKm);
}

export function pickWeighted<T>(items: T[], scores: number[], rng: () => number): T | null {
  let total = 0;
  for (const score of scores) total += Math.max(0, score);
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, scores[i] ?? 0);
    if (r <= 0) return items[i] ?? null;
  }
  return items[items.length - 1] ?? null;
}

function isOpen(place: ActivityPlace, minute: number): boolean {
  if (place.closeMin <= place.openMin) {
    return minute >= place.openMin || minute <= place.closeMin;
  }
  return minute >= place.openMin && minute <= place.closeMin;
}

export function modeMinutes(mode: BackgroundMode, km: number): number {
  switch (mode) {
    case 'walk':
      return (km / 4.5) * 60 + 1;
    case 'ebike':
      return (km / 15) * 60 + 1.5;
    case 'bus':
      return (km / 18) * 60 + 8;
    case 'car':
      return (km / 30) * 60 + 5;
  }
}

/** 用 agent 自己的平均速度估算门到门时间；没有速度时回退到固定值。 */
export function travelMinutes(
  mode: BackgroundMode,
  km: number,
  speedKmh?: number,
): number {
  // 公交速度由线路决定，与乘客自己的步行 / 骑行速度无关。
  if (mode === 'bus') return modeMinutes(mode, km);
  if (!speedKmh || speedKmh <= 0) return modeMinutes(mode, km);
  const ride = (km / speedKmh) * 60;
  if (mode === 'walk') return ride + 1;
  if (mode === 'ebike') return ride + 1.5;
  return ride + 5;
}

/** 拥有方式决定默认出行方式；步行只用于 1.5 km 内，再远必须换交通工具。 */
export function modeForVehicle(vehicle: number, km: number): BackgroundMode {
  if (km <= 1.5) return 'walk';
  if (vehicle === 2) return 'car';
  if (vehicle === 1) return km <= 14 ? 'ebike' : 'bus';
  // 没有车也没有电动车的人，长途坐公交，不再步行穿城。
  return 'bus';
}

/** M1 background mode choice; metro is deliberately absent until M3. */
export function chooseBackgroundMode(
  km: number,
  hasCar: boolean,
  hasEBike: boolean,
  rng: () => number,
): BackgroundMode {
  const walkMin = (km / 4.5) * 60 + 1;
  const ebikeMin = (km / 15) * 60 + 1.5;
  const busMin = (km / 18) * 60 + 8;
  const carMin = (km / 30) * 60 + 5;
  const options: Array<{ mode: BackgroundMode; score: number }> = [
    {
      mode: 'walk',
      score: -0.09 * walkMin + (km < 0.8 ? 0.9 : 0) + rng() * 0.3,
    },
  ];
  if (hasEBike) {
    options.push({
      mode: 'ebike',
      score: -0.09 * ebikeMin + (km < 4 ? 0.55 : 0.15) + rng() * 0.3,
    });
  }
  options.push({
    mode: 'bus',
    score: -0.09 * busMin - 0.2 * 2 + 0.1 + rng() * 0.3,
  });
  if (hasCar) {
    options.push({
      mode: 'car',
      score: -0.09 * carMin - 0.2 * km * 0.8 + (km > 4 ? 0.5 : -0.2) + rng() * 0.3,
    });
  }
  return (
    pickWeighted(
      options.map((option) => option.mode),
      options.map((option) => Math.exp(option.score)),
      rng,
    ) ?? 'walk'
  );
}

export function chooseFlexiblePlace(
  kind: 'shopping' | 'leisure' | 'medical' | 'errand',
  from: { x: number; y: number },
  minute: number,
  candidates: ActivityPlace[],
  pxPerKm: number,
  rng: () => number,
): ActivityPlace | null {
  const open = candidates.filter((place) => isOpen(place, minute));
  if (open.length === 0) return null;
  const scores = open.map((place) => {
    const km = distanceKm(from, place, pxPerKm);
    const decay = kind === 'medical' ? 3.4 : kind === 'leisure' ? 5.5 : 4.2;
    return Math.exp(
      Math.log(1 + place.attraction) -
        km / decay -
        (isOpen(place, minute) ? 0 : 1.5) +
        rng() * 0.35,
    );
  });
  return pickWeighted(open, scores, rng);
}

export function flexiblePlaceKind(
  purpose: 'shopping' | 'leisure' | 'medical' | 'errand',
  library: {
    shopping: ActivityPlace[];
    leisure: ActivityPlace[];
    medical: ActivityPlace[];
    mixed: ActivityPlace[];
  },
): ActivityPlace[] {
  if (purpose === 'medical') return library.medical;
  if (purpose === 'leisure') return [...library.leisure, ...library.mixed];
  return [...library.shopping, ...library.mixed];
}

export function placeKindLabel(kind: ActivityPlaceKind): string {
  switch (kind) {
    case 'home':
      return '住宅';
    case 'work':
      return '就业';
    case 'school':
      return '学校';
    case 'shopping':
      return '商业';
    case 'leisure':
      return '休闲';
    case 'medical':
      return '医疗';
    case 'mixed':
      return '混合街区';
  }
}
