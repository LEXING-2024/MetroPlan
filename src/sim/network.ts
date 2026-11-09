import {
  BUILTIN_PX_PER_KM,
  DEFAULT_SERVICE_END,
  DEFAULT_SERVICE_START,
  DEFAULT_TRAIN_SPEED_KMH,
  LINE_COLORS,
  SEGMENT_COST,
  STATION_SIZES,
  TRAIN_DWELL,
  speedForTrainKind,
} from './constants';
import type { Line, Station, StationSize, Train, TrainKind } from './types';

/** 环线：首尾是同一个车站（例如 A · B · C · A）。 */
export function isLoopLine(line: Line): boolean {
  const n = line.stationIds.length;
  return n >= 4 && line.stationIds[0] === line.stationIds[n - 1];
}

/**
 * 线网数据结构。
 * 注意：车站没有 removed 标志，也不存在 removeStation 接口 —— 0.6.5 的永久性硬规则。
 */
export class Network {
  stations: Station[] = [];
  lines: Line[] = [];
  trains: Train[] = [];
  stationById = new Map<number, Station>();
  lineById = new Map<number, Line>();
  trainById = new Map<number, Train>();
  version = 0;

  private nextStationId = 1;
  private nextLineId = 1;
  private nextTrainId = 1;

  reset(): void {
    this.stations = [];
    this.lines = [];
    this.trains = [];
    this.stationById.clear();
    this.lineById.clear();
    this.trainById.clear();
    this.version++;
    this.nextStationId = 1;
    this.nextLineId = 1;
    this.nextTrainId = 1;
  }

  /** 仅由建站流程调用；外部不存在删除接口。 */
  addStation(
    x: number,
    y: number,
    name: string,
    builtAt: number,
    size: StationSize = 'standard',
  ): Station {
    const station: Station = {
      id: this.nextStationId++,
      x,
      y,
      name,
      capacity: STATION_SIZES[size].capacity,
      size,
      builtAt,
      lines: [],
      entriesBest: 0,
      exitsBest: 0,
    };
    this.stations.push(station);
    this.stationById.set(station.id, station);
    this.version++;
    return station;
  }

  /** 教程关专用：撤回最近一个未接线的车站。正式局不调用。 */
  undoLastStation(station: Station): boolean {
    if (station.lines.length > 0) return false;
    const idx = this.stations.indexOf(station);
    if (idx < 0 || idx !== this.stations.length - 1) return false;
    this.stations.pop();
    this.stationById.delete(station.id);
    this.version++;
    return true;
  }

  addLine(
    stationIds: number[],
    color: number,
    hex?: string,
    startMin = DEFAULT_SERVICE_START,
    endMin = DEFAULT_SERVICE_END,
    speedKmh = DEFAULT_TRAIN_SPEED_KMH,
  ): Line {
    const line: Line = {
      id: this.nextLineId++,
      color,
      hex: hex ?? LINE_COLORS[color % LINE_COLORS.length]!.css,
      startMin,
      endMin,
      speedKmh,
      stationIds: [...stationIds],
      trains: [],
      buildCost: Math.max(0, stationIds.length - 1) * SEGMENT_COST,
      ridersToday: 0,
      ridersLastDay: 0,
      ridersBestDay: 0,
      peakOnboard: 0,
      expressStops: [],
    };
    this.lines.push(line);
    this.lineById.set(line.id, line);
    for (const sid of stationIds) {
      const s = this.stationById.get(sid);
      if (s && !s.lines.includes(line.id)) s.lines.push(line.id);
    }
    this.version++;
    return line;
  }

  addTrain(line: Line, index = 0, dir: 1 | -1 = 1, kind: TrainKind = 'local'): Train {
    const n = line.stationIds.length;
    const safeIndex = n > 0 ? Math.max(0, Math.min(n - 1, index)) : 0;
    const train: Train = {
      id: this.nextTrainId++,
      lineId: line.id,
      kind,
      index: safeIndex,
      prog: 0,
      dir,
      phase: 0,
      dwellLeft: TRAIN_DWELL,
      riders: [],
      startId: line.stationIds[0] ?? 0,
      endId: line.stationIds[n - 1] ?? 0,
    };
    this.trains.push(train);
    this.trainById.set(train.id, train);
    line.trains.push(train.id);
    this.version++;
    return train;
  }

  removeTrain(trainId: number): Train | undefined {
    const train = this.trainById.get(trainId);
    if (!train) return undefined;
    this.trainById.delete(trainId);
    const li = this.trains.indexOf(train);
    if (li >= 0) this.trains.splice(li, 1);
    const line = this.lineById.get(train.lineId);
    if (line) {
      const ti = line.trains.indexOf(trainId);
      if (ti >= 0) line.trains.splice(ti, 1);
    }
    this.version++;
    return train;
  }

  removeLine(lineId: number): Line | undefined {
    const line = this.lineById.get(lineId);
    if (!line) return undefined;
    for (const tid of [...line.trains]) this.removeTrain(tid);
    for (const sid of line.stationIds) {
      const s = this.stationById.get(sid);
      if (!s) continue;
      const idx = s.lines.indexOf(lineId);
      if (idx >= 0) s.lines.splice(idx, 1);
    }
    this.lineById.delete(lineId);
    const li = this.lines.indexOf(line);
    if (li >= 0) this.lines.splice(li, 1);
    this.version++;
    return line;
  }

  lineStations(line: Line): Station[] {
    return line.stationIds.map((id) => this.stationById.get(id)).filter((s): s is Station => !!s);
  }

  /**
   * 延长既有线路：新序列必须包含原序列，且只能在首 / 尾两端插入。
   * 在首端插入时，所有列车下标整体后移，保证列车仍位于原来的区段。
   */
  updateLineStations(lineId: number, stationIds: number[]): boolean {
    const line = this.lineById.get(lineId);
    if (!line) return false;
    const old = line.stationIds;
    if (stationIds.length <= old.length) return false;
    const pre = stationIds.indexOf(old[0]!);
    if (pre < 0) return false;
    for (let i = 0; i < old.length; i++) {
      if (stationIds[pre + i] !== old[i]) return false;
    }
    for (const sid of stationIds) {
      if (!this.stationById.has(sid)) return false;
    }
    for (const sid of stationIds) {
      const station = this.stationById.get(sid);
      if (station && !station.lines.includes(line.id)) station.lines.push(line.id);
    }
    if (pre > 0) {
      for (const tid of line.trains) {
        const train = this.trainById.get(tid);
        if (train) train.index += pre;
      }
    }
    line.stationIds = [...stationIds];
    this.version++;
    return true;
  }

  stationIndexOnLine(line: Line, stationId: number): number {
    return line.stationIds.indexOf(stationId);
  }

  /** 一条线路的往返周期（分钟），用于候车估计；环线只算一圈。 */
  cycleTime(line: Line, pxPerKm = BUILTIN_PX_PER_KM, kind: TrainKind = 'local'): number {
    const travel = this.lineOneWayMinutes(line, pxPerKm, kind);
    const n =
      kind === 'express'
        ? Math.max(2, this.expressStopIndexes(line).length)
        : Math.max(1, line.stationIds.length);
    if (isLoopLine(line)) return Math.max(4, travel + TRAIN_DWELL * n);
    return Math.max(4, travel * 2 + TRAIN_DWELL * 2 * n);
  }

  /** 线路总里程（km）。 */
  lineLengthKm(line: Line, pxPerKm = BUILTIN_PX_PER_KM): number {
    let total = 0;
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const a = this.stationById.get(line.stationIds[i]!);
      const b = this.stationById.get(line.stationIds[i + 1]!);
      if (!a || !b) continue;
      total += Math.hypot(a.x - b.x, a.y - b.y);
    }
    return total / Math.max(1, pxPerKm);
  }

  /** 线路单程运行时间（分钟，不含停站）；按快车 / 慢车设计时速计算。 */
  lineOneWayMinutes(line: Line, pxPerKm = BUILTIN_PX_PER_KM, kind: TrainKind = 'local'): number {
    const speed = speedForTrainKind(kind);
    let total = 0;
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const a = this.stationById.get(line.stationIds[i]!);
      const b = this.stationById.get(line.stationIds[i + 1]!);
      if (!a || !b) continue;
      total += segmentTravel(a, b, pxPerKm, speed);
    }
    return total;
  }

  /** 发车间隔（分钟）。 */
  headwayMinutes(line: Line, pxPerKm = BUILTIN_PX_PER_KM): number {
    const trains = Math.max(1, line.trains.length);
    return this.cycleTime(line, pxPerKm) / trains;
  }

  /** 快车停靠站在线路序列中的下标（升序、去重）。 */
  expressStopIndexes(line: Line): number[] {
    const set = new Set(line.expressStops);
    const out: number[] = [];
    let lastId = -1;
    for (let i = 0; i < line.stationIds.length; i++) {
      const id = line.stationIds[i]!;
      if (id === lastId) continue;
      if (set.has(id)) out.push(i);
      lastId = id;
    }
    return out;
  }

  /** 某类车的发车间隔（分钟）；没有该类列车时返回 Infinity。 */
  serviceHeadway(line: Line, kind: TrainKind, pxPerKm = BUILTIN_PX_PER_KM): number {
    let count = 0;
    for (const id of line.trains) {
      const train = this.trainById.get(id);
      if (train && train.kind === kind) count++;
    }
    if (count === 0) return Infinity;
    return this.cycleTime(line, pxPerKm, kind) / count;
  }

  expectedWait(line: Line, pxPerKm = BUILTIN_PX_PER_KM, kind: TrainKind = 'local'): number {
    const headway = this.serviceHeadway(line, kind, pxPerKm);
    if (!Number.isFinite(headway)) return Infinity;
    return Math.min(9, Math.max(0.6, headway / 2));
  }

  getIds(): [number, number, number] {
    return [this.nextStationId, this.nextLineId, this.nextTrainId];
  }

  setIds(station: number, line: number, train: number): void {
    this.nextStationId = station;
    this.nextLineId = line;
    this.nextTrainId = train;
  }

  /** 读档：整体替换线网。 */
  restore(stations: Station[], lines: Line[], trains: Train[], ids: [number, number, number]): void {
    this.stations = stations;
    this.lines = lines;
    this.trains = trains;
    this.stationById.clear();
    this.lineById.clear();
    this.trainById.clear();
    for (const s of stations) this.stationById.set(s.id, s);
    for (const l of lines) this.lineById.set(l.id, l);
    for (const t of trains) this.trainById.set(t.id, t);
    this.setIds(ids[0], ids[1], ids[2]);
    this.version++;
  }
}

export function segmentTravel(
  a: Station,
  b: Station,
  pxPerKm = BUILTIN_PX_PER_KM,
  speedKmh = DEFAULT_TRAIN_SPEED_KMH,
): number {
  const km = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pxPerKm);
  // 站间距离越长，运行时间越长；不再用固定 3–4.5 分钟的封顶。
  return Math.max(0.25, (km / Math.max(1, speedKmh)) * 60);
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
