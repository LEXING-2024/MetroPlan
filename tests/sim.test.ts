import { describe, expect, it } from 'vitest';
import { GEO_POIS, GEO_ZONES } from '../src/maps/geoData';
import {
  autoSpeedOf,
  dateFromDayIndex,
  dayIndexFromDate,
  formatClock,
  formatDate,
  isLeapYear,
  nextBoundaryAfter,
  periodOf,
  splitTime,
  weekdayOf,
  daysInMonth,
} from '../src/sim/calendar';
import { START_FUND, TRAIN_COST } from '../src/sim/constants';
import { HEAT_GH, HEAT_GW, buildHeatFrame, stationThermal, tideWeights } from '../src/sim/heat';
import { Simulation } from '../src/sim/simulation';
import { makeSaveFile, restoreSim, snapshotSim } from '../src/sim/save';
import { planTrip } from '../src/sim/pathfinding';
import { segmentTravel } from '../src/sim/network';
import { stationAccessProbability } from '../src/sim/access';
import { POI_LEVEL_META, poiDailyRange, poiProfileWeight, poiTimeWeight } from '../src/sim/mapData';
import { PLAIN_MAP } from '../src/maps/plain';
import { TERRAIN_MAP } from '../src/maps/terrain';

function newSim(): Simulation {
  // 测试关注行为而非 10 万规模；用 12k 上限缩短每个用例的构造成本。
  return new Simulation({ seed: 7, maxAgents: 12_000 });
}

describe('公历与日历', () => {
  it('闰年规则正确', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2028, 4)).toBe(30);
    expect(daysInMonth(2028, 12)).toBe(31);
  });

  it('跨月与闰日滚动', () => {
    expect(dayIndexFromDate(2026, 2, 1) - dayIndexFromDate(2026, 1, 31)).toBe(1);
    expect(dayIndexFromDate(2026, 3, 1) - dayIndexFromDate(2026, 2, 28)).toBe(1);
    expect(dayIndexFromDate(2028, 2, 29) - dayIndexFromDate(2028, 2, 28)).toBe(1);
    expect(dayIndexFromDate(2028, 3, 1) - dayIndexFromDate(2028, 2, 29)).toBe(1);
    expect(dayIndexFromDate(2027, 1, 1) - dayIndexFromDate(2026, 12, 31)).toBe(1);
  });

  it('日期还原与星期与系统日历一致', () => {
    const base = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 800; i += 17) {
      const d = new Date(base.getTime() + i * 86400000);
      const idx = dayIndexFromDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      expect(idx).toBe(i);
      expect(dateFromDayIndex(idx)).toEqual({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
      });
      expect(weekdayOf(idx)).toBe(d.getUTCDay());
    }
    expect(formatDate(0)).toBe('2026年1月1日');
    expect(weekdayOf(0)).toBe(4); // 周四
  });

  it('时间格式与 23:59 → 00:00', () => {
    expect(formatClock(6 * 60)).toBe('06:00');
    expect(formatClock(23 * 60 + 59)).toBe('23:59');
    expect(splitTime(1440)).toEqual({ day: 1, minuteOfDay: 0 });
    expect(formatClock(splitTime(1440).minuteOfDay)).toBe('00:00');
  });

  it('时段与自动速度', () => {
    expect(periodOf(0).speed).toBe(16);
    expect(periodOf(6 * 60).speed).toBe(8);
    expect(periodOf(7 * 60).speed).toBe(1);
    expect(periodOf(8 * 60 + 30).speed).toBe(1);
    expect(periodOf(12 * 60).speed).toBe(8);
    expect(periodOf(17 * 60 + 30).speed).toBe(1);
    expect(periodOf(21 * 60).speed).toBe(8);
    expect(autoSpeedOf(2 * 60)).toBe(16);
  });

  it('时段边界推进', () => {
    expect(nextBoundaryAfter(6 * 60)).toBe(410);
    expect(nextBoundaryAfter(410)).toBe(420);
    expect(nextBoundaryAfter(1439)).toBe(1440);
    expect(nextBoundaryAfter(1440)).toBe(1440 + 360);
  });
});

describe('模拟核心', () => {
  it('初始时间、基金与车站永久性接口', () => {
    const sim = newSim();
    expect(sim.time).toBe(360);
    expect(formatDate(sim.dayIndex())).toBe('2026年1月1日');
    expect(sim.fund).toBe(START_FUND);
    expect(sim.agents.count).toBeGreaterThanOrEqual(8_000);
    expect(sim.agents.count).toBeLessThanOrEqual(150_000);
    expect('removeStation' in sim).toBe(false);
    expect('removeStation' in sim.net).toBe(false);
    expect((sim as unknown as Record<string, unknown>).removeStation).toBeUndefined();
  });

  it('放站扣款，且允许相邻车站建得很近', () => {
    const sim = newSim();
    const a = sim.placeStation(825, 1150);
    expect(a.ok).toBe(true);
    expect(sim.fund).toBe(START_FUND - 1000);
    const b = sim.placeStation(830, 1155);
    expect(b.ok).toBe(true);
    expect(sim.fund).toBe(START_FUND - 2000);
    expect(sim.net.stations.length).toBe(2);
  });

  it('放站资金不足时拒绝', () => {
    const sim = newSim();
    sim.fund = 500;
    expect(sim.placeStation(825, 1150).ok).toBe(false);
  });

  it('线路费用与拆线返还 50%', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    const c = sim.placeStation(1000, 1100).station!;
    expect(sim.fund).toBe(START_FUND - 3000);
    const res = sim.createLine([a.id, b.id, c.id], 0);
    expect(res.ok).toBe(true);
    // 2 段 × 500 + 1 列车 2000
    expect(sim.fund).toBe(START_FUND - 3000 - 3000);
    expect(sim.net.lines[0]!.buildCost).toBe(1000);
    const before = sim.fund;
    expect(sim.removeLine(res.lineId!).ok).toBe(true);
    expect(sim.fund).toBe(before + 500);
    expect(sim.net.lines.length).toBe(0);
    expect(sim.net.trains.length).toBe(0);
    expect(sim.net.stations.length).toBe(3);
  });

  it('加车扣款、减车不返还', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    const res = sim.createLine([a.id, b.id], 0);
    const fundAfterLine = sim.fund;
    expect(sim.addTrain(res.lineId!).ok).toBe(true);
    expect(sim.fund).toBe(fundAfterLine - TRAIN_COST);
    expect(sim.removeTrain(res.lineId!).ok).toBe(true);
    expect(sim.fund).toBe(fundAfterLine - TRAIN_COST);
    expect(sim.net.lines[0]!.trains.length).toBe(1);
  });

  it('负基金不能拆线', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    const line = sim.createLine([a.id, b.id], 0).lineId!;
    sim.fund = -10;
    expect(sim.removeLine(line).ok).toBe(false);
  });

  it('线路总里程与列车时速决定区段运行时间', () => {
    const sim = newSim();
    const a = sim.placeStation(700, 1100).station!;
    const b = sim.placeStation(800, 1100).station!;
    const c = sim.placeStation(1000, 1100).station!;
    expect(segmentTravel(a, b, sim.pxPerKm, 100)).toBeLessThan(
      segmentTravel(b, c, sim.pxPerKm, 100),
    );
    const lineId = sim.createLine([a.id, b.id, c.id], 0).lineId!;
    const line = sim.net.lineById.get(lineId)!;
    expect(line.speedKmh).toBe(80);
    expect(sim.lineLengthKm(lineId)).toBeCloseTo(300 / sim.pxPerKm, 5);
    expect(sim.lineOneWayMinutes(lineId)).toBeCloseTo((300 / sim.pxPerKm / 80) * 60, 5);
    const localOneWay = sim.net.lineOneWayMinutes(line, sim.pxPerKm, 'local');
    const expressOneWay = sim.net.lineOneWayMinutes(line, sim.pxPerKm, 'express');
    expect(expressOneWay).toBeCloseTo((localOneWay * 80) / 120, 5);

    const file = makeSaveFile(sim, 'manual-1');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    expect(restored.net.lines[0]!.speedKmh).toBe(80);
  });

  it('站点辐射：300 m 内 85%，500 m 70%，1.2 km 45%，2 km 5%', () => {
    expect(stationAccessProbability(0)).toBeCloseTo(0.85, 2);
    expect(stationAccessProbability(300)).toBeCloseTo(0.85, 2);
    expect(stationAccessProbability(500)).toBeCloseTo(0.7, 2);
    expect(stationAccessProbability(650)).toBeGreaterThan(0.45);
    expect(stationAccessProbability(650)).toBeLessThan(0.7);
    expect(stationAccessProbability(800)).toBeGreaterThan(0.45);
    expect(stationAccessProbability(800)).toBeLessThan(0.7);
    expect(stationAccessProbability(1000)).toBeGreaterThan(0.45);
    expect(stationAccessProbability(1000)).toBeLessThan(0.7);
    expect(stationAccessProbability(1200)).toBeCloseTo(0.45, 2);
    expect(stationAccessProbability(1500)).toBeGreaterThan(0.05);
    expect(stationAccessProbability(1500)).toBeLessThan(0.45);
    expect(stationAccessProbability(2000)).toBeCloseTo(0.05, 2);
    expect(stationAccessProbability(2001)).toBe(0);
    expect(stationAccessProbability(5000)).toBe(0);
  });

  it('默认站点最大辐射为 2 km，放站预览区分核心与有效覆盖', () => {
    const sim = newSim();
    expect((sim.walkRadiusPx / sim.pxPerKm) * 1000).toBeCloseTo(2000, 6);
    expect((sim.coreWalkRadiusPx() / sim.pxPerKm) * 1000).toBeCloseTo(500, 6);
    const preview = sim.previewCoverage(825, 1150);
    expect(preview.residents).toBeGreaterThan(0);
    expect(preview.coreResidents).toBeGreaterThanOrEqual(0);
    expect(preview.coreResidents).toBeLessThanOrEqual(preview.residents);
    expect(preview.coreJobs).toBeLessThanOrEqual(preview.jobs);
  });

  it('A* 能找到乘车路径', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    sim.createLine([a.id, b.id], 0);
    const plan = planTrip(sim.net, 760, 1100, 880, 1100);
    expect(plan).not.toBeNull();
    expect(plan!.legs.length).toBe(1);
    expect(plan!.legs[0]!.from).toBe(a.id);
    expect(plan!.legs[0]!.to).toBe(b.id);
    expect(plan!.total).toBeGreaterThan(0);
  });

  it('起点与终点共用同一车站时按步行处理', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    sim.placeStation(1000, 1100);
    sim.createLine([a.id, sim.net.stations[1]!.id], 0);
    const plan = planTrip(sim.net, 760, 1100, 800, 1120, { walkRadius: 112 });
    expect(plan).not.toBeNull();
    expect(plan!.legs.length).toBe(0);
  });

  it('最近的车站没接线路时，会改走步行范围内的其他车站', () => {
    const sim = newSim();
    const near = sim.placeStation(760, 1100).station!;
    const far = sim.placeStation(850, 1100).station!;
    const dest = sim.placeStation(1000, 1100).station!;
    sim.createLine([far.id, dest.id], 0);
    const plan = planTrip(sim.net, 760, 1100, 1000, 1100, { walkRadius: 112 });
    expect(plan).not.toBeNull();
    expect(plan!.origin).toBe(far.id);
    expect(plan!.origin).not.toBe(near.id);
    expect(plan!.legs.length).toBe(1);
  });

  it('没有车站时出行计为未服务', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.advanceMinutes(180); // 到 09:00
    expect(sim.stats.unserved).toBeGreaterThan(0);
    expect(sim.stats.ridership).toBe(0);
    expect(sim.stats.delivered).toBe(0);
  });

  it('建成线路后早晚高峰产生客流，并在 00:00 结算', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    // 用整个城区加一条横贯线路
    const points: Array<[number, number]> = [
      [480, 1060],
      [700, 1125],
      [825, 1150],
      [940, 1085],
      [1205, 578],
    ];
    const ids: number[] = [];
    for (const [x, y] of points) {
      const res = sim.placeStation(x, y);
      expect(res.ok).toBe(true);
      ids.push(res.station!.id);
    }
    const line = sim.createLine(ids, 1);
    expect(line.ok).toBe(true);
    const fundAfterBuild = sim.fund;

    sim.advanceMinutes(24 * 60 - 360 - 1);
    expect(sim.stats.ridership).toBeGreaterThan(0);
    expect(sim.stats.delivered).toBeGreaterThan(0);
    expect(sim.stats.trips).toBeGreaterThan(0);

    const ridership = sim.stats.ridership;
    sim.advanceMinutes(2); // 跨过 00:00
    expect(sim.dayIndex()).toBe(1);
    expect(sim.history.length).toBe(1);
    const rec = sim.history[0]!;
    expect(rec.ridership).toBe(ridership);
    expect(rec.revenue).toBeGreaterThan(0);
    expect(rec.cost).toBe(5 * 30 + 1 * 100);
    expect(sim.fund).toBe(fundAfterBuild + rec.revenue - rec.cost);
    expect(sim.stats.ridership).toBe(0);
    expect(formatDate(sim.dayIndex())).toBe('2026年1月2日');
    // 午夜只把在家 / 在岗的人归位；不会把所有人强行设为“在家”。
    for (let i = 0; i < sim.agents.count; i++) {
      const st = sim.agents.state[i]!;
      expect(st).toBeGreaterThanOrEqual(0);
      expect(st).toBeLessThanOrEqual(4);
    }
  });

  it('跨过 00:00 不打断正在走路 / 候车 / 乘车的人', () => {
    const sim = newSim();
    sim.settings.skipNight = false;
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    sim.createLine([a.id, b.id], 0);
    sim.advanceMinutes(1439 - 360); // 23:59
    const agent = 0;
    const ag = sim.agents;
    // 手动让 0 号 agent 处于“步行去站”的状态，跨越午夜时不应被清除。
    ag.state[agent] = 1;
    ag.walkLeft[agent] = 20;
    ag.targetStation[agent] = a.id;
    sim.advanceMinutes(2); // 00:01
    expect(sim.dayIndex()).toBe(1);
    expect(ag.state[agent]).toBe(1);
    expect(ag.walkLeft[agent]).toBeGreaterThan(0);
    expect(ag.walkLeft[agent]).toBeLessThan(20);
    expect(ag.targetStation[agent]).toBe(a.id);
  });

  it('暂停时时间不走，06:50 只提示不自动暂停', () => {
    const sim = newSim();
    sim.setPaused(true);
    const t = sim.time;
    sim.tick(5);
    expect(sim.time).toBe(t);

    const events: string[] = [];
    sim.on((event) => events.push(event.type));
    sim.setPaused(false);
    sim.setSpeed(16);
    sim.advanceMinutes(60);
    expect(sim.time).toBe(420);
    expect(sim.paused).toBe(false);
    expect(events).toContain('peakSoon');
    const peakCount = events.filter((e) => e === 'peakSoon').length;
    sim.advanceMinutes(30);
    expect(events.filter((e) => e === 'peakSoon').length).toBe(peakCount);
  });

  it('夜间跳过会停在当天第一班出发之前，不会跳过 5 点多的早班', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = true;
    sim.time = 1439;
    sim.advanceMinutes(5);
    expect(sim.dayIndex()).toBe(1);
    // 落点在 00:00–06:00 之间，且早于最早的一班出发
    const tod = sim.timeOfDay();
    expect(tod).toBeGreaterThan(0);
    expect(tod).toBeLessThan(360);
    let first = Infinity;
    for (let i = 0; i < sim.agents.count; i++) {
      if (sim.agents.outMin[i]! < first) first = sim.agents.outMin[i]!;
    }
    expect(first).toBeLessThan(360); // 确实有人 5 点多就出门
    // 跳过落点在第一班之前，随后又正常推进了 5 分钟。
    expect(tod).toBeLessThan(first + 6);
  });

  it('教程局可撤回一次最近的车站', () => {
    const sim = new Simulation({ mode: 'tutorial', seed: 3, maxAgents: 12_000 });
    const res = sim.placeStation(825, 1150);
    expect(res.ok).toBe(true);
    expect(sim.fund).toBe(START_FUND - 1000);
    expect(sim.canUndoStation()).toBe(true);
    expect(sim.undoLastStation().ok).toBe(true);
    expect(sim.fund).toBe(START_FUND);
    expect(sim.net.stations.length).toBe(0);
    expect(sim.undoLastStation().ok).toBe(false);
  });

  it('存档往返保持时间、线网、agent 状态', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    sim.createLine([a.id, b.id], 0);
    sim.advanceMinutes(120);
    const file = makeSaveFile(sim, 'manual-1');
    const json = JSON.stringify(file);
    expect(json.length).toBeLessThan(6_000_000);

    const restored = restoreSim(JSON.parse(json).data);
    expect(restored.time).toBeCloseTo(sim.time, 5);
    expect(restored.fund).toBe(sim.fund);
    expect(restored.net.stations.length).toBe(2);
    expect(restored.net.lines.length).toBe(1);
    expect(restored.net.trains.length).toBe(1);
    expect(restored.agents.count).toBe(sim.agents.count);
    expect(restored.profileCounts()).toEqual(sim.profileCounts());
    expect(restored.vehicleCounts()).toEqual(sim.vehicleCounts());
    expect(restored.paused).toBe(sim.paused);
    expect(restored.settings.autoPause).toBe(false);
    const before = restored.stats.ridership;
    restored.tick(0.2);
    expect(restored.stats.ridership).toBeGreaterThanOrEqual(before);
  });

  it('OD 摘要按住宅区统计', () => {
    const sim = newSim();
    const zone = sim.zones.find((z) => z.kind === 'residential')!;
    const summary = sim.zoneOdSummary(zone.id);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.top.length).toBeGreaterThan(0);
    expect(summary.top.length).toBeLessThanOrEqual(3);
  });

  it('覆盖预览返回人口与岗位', () => {
    const sim = newSim();
    const home = sim.zones.find((z) => z.kind === 'residential')!;
    const work = sim.zones.find((z) => z.kind === 'employment')!;
    expect(sim.previewCoverage(home.x, home.y).residents).toBeGreaterThan(0);
    expect(sim.previewCoverage(work.x, work.y).jobs).toBeGreaterThan(0);
    expect(snapshotSim(sim).agents.c).toBe(sim.agents.count);
  });

  it('拆线会清空列车并重新规划在途乘客', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    // 三个站都在 1 km 辐射内，保证测试的是拆线重规划而不是覆盖不足。
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(825, 1150).station!;
    const c = sim.placeStation(840, 1150).station!;
    const lineId = sim.createLine([a.id, b.id, c.id], 0).lineId!;
    sim.advanceMinutes(180);
    expect(sim.stats.ridership).toBeGreaterThan(0);
    const res = sim.removeLine(lineId);
    expect(res.ok).toBe(true);
    expect(sim.net.lines.length).toBe(0);
    expect(sim.net.trains.length).toBe(0);
    for (const queue of sim.queues.values()) {
      for (const agentId of queue) {
        expect(sim.agents.plans[agentId]).not.toBeNull();
      }
    }
    expect(() => sim.advanceMinutes(60)).not.toThrow();
  });

  it('连续 7 天结算保持收支一致且无 NaN', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(825, 1150).station!;
    const c = sim.placeStation(940, 1085).station!;
    sim.createLine([a.id, b.id, c.id], 0);
    let expectedFund = sim.fund;
    for (let d = 0; d < 7; d++) {
      sim.advanceMinutes(1440);
      const rec = sim.history[sim.history.length - 1]!;
      expect(rec.day).toBe(d);
      expectedFund += rec.revenue - rec.cost;
      expect(rec.fund).toBe(expectedFund);
      expect(Number.isFinite(rec.avgCommute)).toBe(true);
    }
    expect(sim.history.length).toBe(7);
    expect(sim.fund).toBe(expectedFund);
    // 06:00 恰好是首班边界，可能已有 1–2 个早班客上车；这里只要求没有异常暴增。
    expect(sim.stats.ridership).toBeLessThan(50);
    expect(sim.dayIndex()).toBe(7);
    for (let i = 0; i < sim.agents.count; i++) {
      expect(Number.isFinite(sim.agents.homeX[i])).toBe(true);
      expect(sim.agents.state[i]).toBeLessThanOrEqual(6);
    }
  }, 20_000);

  it('手动倍速跨时段保持，不被高峰自动切换', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.time = 530;
    sim.setSpeed(4);
    sim.advanceMinutes(15);
    expect(sim.currentSpeed()).toBe(4);

    sim.time = 1010;
    sim.setSpeed(16);
    sim.advanceMinutes(20);
    expect(sim.currentSpeed()).toBe(16);
  });

  it('人口由地图点阵推导，不再固定 4000', () => {
    const terrain = TERRAIN_MAP.createField();
    const plain = PLAIN_MAP.createField();
    const t = new Simulation({ field: terrain, mapId: TERRAIN_MAP.id, mapName: TERRAIN_MAP.name, maxAgents: 12_000 });
    const p = new Simulation({ field: plain, mapId: PLAIN_MAP.id, mapName: PLAIN_MAP.name, maxAgents: 12_000 });
    expect(t.agents.count).toBeGreaterThan(8_000);
    expect(t.agents.count).toBeLessThan(150_000);
    expect(p.agents.count).toBeGreaterThan(8_000);
    expect(p.agents.count).toBeLessThan(150_000);
  });

  it('通勤出发时间分散，形成早峰与晚高峰而不是整齐矩形', () => {
    const sim = newSim();
    const a = sim.agents;
    let before7 = 0;
    let peak = 0;
    let after9 = 0;
    for (let i = 0; i < a.count; i++) {
      const t = a.outMin[i]!;
      if (t < 420) before7++;
      else if (t < 540) peak++;
      else after9++;
    }
    expect(before7).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(0);
    expect(after9).toBeGreaterThan(0);
    // 不是所有人都挤在 07:00–09:00 的同一个窗口里。
    expect(peak).toBeLessThan(a.count * 0.72);
  });

  it('POI 专项群体不再封顶 2000，按日吸引量自然增长', () => {
    const sim = newSim();
    const counts = sim.groupCounts();
    const poiAgents = counts[3]! + counts[4]! + counts[5]! + counts[6]!;
    expect(poiAgents).toBeGreaterThan(2_000);
  });

  it('周末仍有出行，但通勤族明显减少', () => {
    const sim = newSim();
    let weekdayOnly = 0;
    let weekendOnly = 0;
    for (let i = 0; i < sim.agents.count; i++) {
      if (sim.agents.dayRule[i] === 1) weekdayOnly++;
      else if (sim.agents.dayRule[i] === 2) weekendOnly++;
    }
    // 当前人口含通勤、灵活出行与住校生：约 4 成只在工作日出现，
    // 灵活出行与周末回家的学生让周末仍有约 6 成的人外出。
    // 12k 测试上限下基础成年样本被按比例压缩，比例会低于 10 万默认局；
    // 只要求“工作日专属仍是主力、周末仍有人”。
    expect(weekdayOnly).toBeGreaterThan(sim.agents.count * 0.18);
    expect(weekdayOnly).toBeLessThan(sim.agents.count * 0.8);
    expect(weekendOnly).toBeGreaterThan(0);
    expect(weekdayOnly + weekendOnly).toBeLessThan(sim.agents.count);
  });

  it('内置地图包含真实 POI，并产生就医/休闲/接驳/学生群体', () => {
    const sim = newSim();
    expect(sim.pois.length).toBe(692);
    expect(sim.pxPerKm).toBe(50);
    expect(sim.zones.length).toBeGreaterThan(20);
    expect(sim.agents.count).toBeLessThanOrEqual(150_000);
    const counts = sim.groupCounts();
    expect(counts[3]).toBeGreaterThan(0);
    expect(counts[4]).toBeGreaterThan(0);
    expect(counts[5]).toBeGreaterThan(0);
    expect(counts[6]).toBeGreaterThan(0);
    const hospital = sim.pois.find((p) => p.type === 'hospital')!;
    expect(hospital).toBeTruthy();
    expect(sim.zoneMap.has(10000 + hospital.id)).toBe(true);
  });

  it('所有经纬度都精确到 5 位小数，且落在本地图范围内', () => {
    const rows = [...GEO_ZONES, ...GEO_POIS];
    expect(rows.length).toBeGreaterThan(150);
    for (const row of rows) {
      for (const v of [row.lng, row.lat]) {
        expect(Math.abs(v * 1e5 - Math.round(v * 1e5))).toBeLessThan(1e-4);
      }
      expect(row.lng).toBeGreaterThan(111.9);
      expect(row.lng).toBeLessThan(113.2);
      expect(row.lat).toBeGreaterThan(22.7);
      expect(row.lat).toBeLessThan(23.5);
    }
  });

  it('线路可设置颜色与运营时段，时段外列车停运', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    const lineId = sim.createLine([a.id, b.id], 1, '#123456', 360, 420).lineId!;
    const line = sim.net.lineById.get(lineId)!;
    expect(line.hex).toBe('#123456');
    expect(line.startMin).toBe(360);
    expect(line.endMin).toBe(420);
    expect(sim.isLineInService(line, 400)).toBe(true);
    expect(sim.isLineInService(line, 500)).toBe(false);
    expect(sim.setLineService(lineId, 400, 500).ok).toBe(true);
    expect(sim.isLineInService(line, 450)).toBe(true);
    expect(sim.setLineService(lineId, 360, 420).ok).toBe(true);

    sim.advanceMinutes(65); // 07:05，已过 07:00 的运营结束时间
    const train = sim.net.trainById.get(line.trains[0]!)!;
    const before = { index: train.index, prog: train.prog, phase: train.phase, dwell: train.dwellLeft };
    sim.advanceMinutes(10);
    expect({ index: train.index, prog: train.prog, phase: train.phase, dwell: train.dwellLeft }).toEqual(before);
  });

  it('列车可单独设置始发站 / 终点站，到终点自动折返', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    const ids = [
      sim.placeStation(480, 1060).station!.id,
      sim.placeStation(700, 1125).station!.id,
      sim.placeStation(940, 1085).station!.id,
      sim.placeStation(1205, 578).station!.id,
    ];
    const lineId = sim.createLine(ids, 0).lineId!;
    const line = sim.net.lineById.get(lineId)!;
    const train = sim.net.trainById.get(line.trains[0]!)!;

    expect(sim.setTrainSpan(lineId, train.id, ids[1]!, ids[2]!).ok).toBe(true);
    expect(sim.trainSpan(train, line)).toEqual({ start: 1, end: 2 });
    // 起点必须早于终点
    expect(sim.setTrainSpan(lineId, train.id, ids[2]!, ids[1]!).ok).toBe(false);

    // 调换端点：显示方向反转，但实际运行区间仍是同一段。
    expect(sim.swapTrainSpan(lineId, train.id).ok).toBe(true);
    expect(train.startId).toBe(ids[2]);
    expect(train.endId).toBe(ids[1]);
    expect(sim.trainSpan(train, line)).toEqual({ start: 1, end: 2 });

    const dirs = new Set<number>();
    for (let i = 0; i < 90; i++) {
      sim.advanceMinutes(1);
      dirs.add(train.dir);
      expect(train.index).toBeGreaterThanOrEqual(1);
      expect(train.index).toBeLessThanOrEqual(2);
    }
    expect(dirs.has(1)).toBe(true);
    expect(dirs.has(-1)).toBe(true);

    // 运行区间随存档恢复
    const file = makeSaveFile(sim, 'auto');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    const rt = restored.net.trainById.get(train.id)!;
    expect(rt.startId).toBe(ids[2]);
    expect(rt.endId).toBe(ids[1]);
  });

  it('线路记录最高实时客流，并在午夜归档昨日 / 最高日客流', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const ids = [
      sim.placeStation(480, 1060).station!.id,
      sim.placeStation(700, 1125).station!.id,
      sim.placeStation(940, 1085).station!.id,
      sim.placeStation(1205, 578).station!.id,
    ];
    const lineId = sim.createLine(ids, 0).lineId!;
    sim.addTrain(lineId);
    sim.advanceMinutes(180); // 09:00
    const line = sim.net.lineById.get(lineId)!;
    expect(line.ridersToday).toBeGreaterThan(0);
    expect(line.peakOnboard).toBeGreaterThan(0);
    expect(line.peakOnboard).toBeLessThanOrEqual(120);

    sim.advanceMinutes(1439 - 540); // 23:59
    const dayTotal = line.ridersToday;
    sim.advanceMinutes(2); // 跨过 00:00
    expect(line.ridersToday).toBe(0);
    expect(line.ridersLastDay).toBe(dayTotal);
    expect(line.ridersBestDay).toBeGreaterThanOrEqual(dayTotal);
    // 记录值随存档恢复
    const file = makeSaveFile(sim, 'auto');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    const rt = restored.net.lineById.get(lineId)!;
    expect(rt.ridersLastDay).toBe(dayTotal);
    expect(rt.peakOnboard).toBe(line.peakOnboard);
  });

  it('可以画成环线，列车整圈循环不折返', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(900, 1210).station!;
    const c = sim.placeStation(1000, 900).station!;
    const res = sim.createLine([a.id, b.id, c.id, a.id], 0);
    expect(res.ok).toBe(true);
    const line = sim.net.lineById.get(res.lineId!)!;
    expect(line.stationIds).toEqual([a.id, b.id, c.id, a.id]);

    const train = sim.net.trainById.get(line.trains[0]!)!;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      sim.advanceMinutes(1);
      seen.add(train.index);
      expect(train.dir).toBe(1);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]); // 整圈循环，没有折返
    // 只有首尾可以重复；中途重复 / 只有 2 个站的环都不行
    expect(sim.createLine([a.id, b.id, a.id, b.id], 0).ok).toBe(false);
    expect(sim.createLine([a.id, b.id, a.id], 0).ok).toBe(false);
    // 环线不设置运行区间
    expect(sim.setTrainSpan(line.id, train.id, a.id, b.id).ok).toBe(false);
  });

  it('既有线路延长后可以接回起点，变成环线', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(900, 1210).station!;
    const c = sim.placeStation(1000, 900).station!;
    const d = sim.placeStation(650, 850).station!;
    const lineId = sim.createLine([a.id, b.id, c.id], 0).lineId!;
    const res = sim.extendLine(lineId, [a.id, b.id, c.id, d.id, a.id]);
    expect(res.ok).toBe(true);
    expect(res.cost).toBe(2 * 500); // 只收 C→D 与 D→A 两段
    const line = sim.net.lineById.get(lineId)!;
    expect(line.stationIds).toEqual([a.id, b.id, c.id, d.id, a.id]);
    const train = sim.net.trainById.get(line.trains[0]!)!;
    sim.advanceMinutes(120);
    expect(train.dir).toBe(1);
    expect(train.index).toBeGreaterThanOrEqual(0);
    expect(train.index).toBeLessThanOrEqual(3);
  });

  it('A·B·C 可以直接接回起点成环，只收 1 段', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(900, 1210).station!;
    const c = sim.placeStation(1000, 900).station!;
    const lineId = sim.createLine([a.id, b.id, c.id], 0).lineId!;
    const res = sim.extendLine(lineId, [a.id, b.id, c.id, a.id]);
    expect(res.ok).toBe(true);
    expect(res.cost).toBe(500); // 只补 C→A 一段
    const line = sim.net.lineById.get(lineId)!;
    expect(line.stationIds).toEqual([a.id, b.id, c.id, a.id]);
    const train = sim.net.trainById.get(line.trains[0]!)!;
    sim.advanceMinutes(90);
    expect(train.dir).toBe(1);
  });

  it('快车按默认停靠站运行，慢车每站都停', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(760, 1180, 'large').station!;
    const c = sim.placeStation(950, 1020).station!;
    const d = sim.placeStation(1000, 820).station!;
    const lineId = sim.createLine([a.id, b.id, c.id, d.id], 0).lineId!;
    const before = sim.fund;
    const res = sim.addTrain(lineId, 'express');
    expect(res.ok).toBe(true);
    expect(sim.fund).toBe(before - 2600);
    const line = sim.net.lineById.get(lineId)!;
    // 默认：大型换乘站 + 两端终点站
    expect(line.expressStops).toEqual(expect.arrayContaining([a.id, b.id, d.id]));
    expect(line.expressStops).not.toContain(c.id);
    const express = line.trains
      .map((id) => sim.net.trainById.get(id)!)
      .find((t) => t.kind === 'express')!;
    expect(express.kind).toBe('express');

    // 路径选择：长距离会排出快车腿，C 站（非快车停靠）没有快车腿
    const long = planTrip(sim.net, a.x, a.y, d.x, d.y, { pxPerKm: sim.pxPerKm });
    expect(long).not.toBeNull();
    expect(long!.legs.some((leg) => leg.lineId === lineId && leg.service === 'express')).toBe(true);
    const fromC = planTrip(sim.net, c.x, c.y, d.x, d.y, { pxPerKm: sim.pxPerKm });
    expect(fromC).not.toBeNull();
    expect(
      fromC!.legs.some((leg) => leg.lineId === lineId && leg.service === 'express' && leg.from === c.id),
    ).toBe(false);
  });

  it('快车停靠站可以手动修改并存档', () => {
    const sim = newSim();
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(760, 1180, 'large').station!;
    const c = sim.placeStation(950, 1020).station!;
    const d = sim.placeStation(1000, 820).station!;
    const lineId = sim.createLine([a.id, b.id, c.id, d.id], 0).lineId!;
    sim.addTrain(lineId, 'express');
    expect(sim.setExpressStops(lineId, [a.id]).ok).toBe(false);
    const ok = sim.setExpressStops(lineId, [a.id, c.id, d.id]);
    expect(ok.ok).toBe(true);
    expect(sim.net.lineById.get(lineId)!.expressStops).toEqual([a.id, c.id, d.id]);

    const file = makeSaveFile(sim, 'auto');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    const line = restored.net.lineById.get(lineId)!;
    expect(line.expressStops).toEqual([a.id, c.id, d.id]);
    const kinds = line.trains.map((id) => restored.net.trainById.get(id)!.kind);
    expect(kinds).toContain('express');
  });

  it('第二天首班：同一起点的列车按班距错开发车', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const a = sim.placeStation(520, 1120).station!;
    const b = sim.placeStation(760, 1180).station!;
    const c = sim.placeStation(950, 1020).station!;
    const d = sim.placeStation(1000, 820).station!;
    const lineId = sim.createLine([a.id, b.id, c.id, d.id], 0).lineId!;
    sim.addTrain(lineId);
    sim.addTrain(lineId);
    sim.advanceMinutes(1440 + 350 - 360); // 第二天 05:50
    const line = sim.net.lineById.get(lineId)!;
    const headway = sim.lineHeadwayMinutes(lineId);
    const byStation = new Map<number, number[]>();
    for (const id of line.trains) {
      const train = sim.net.trainById.get(id)!;
      if (train.phase !== 0) continue;
      const list = byStation.get(train.index) ?? [];
      if (train.departAt !== undefined) list.push(train.departAt);
      byStation.set(train.index, list);
    }
    let checked = false;
    for (const slots of byStation.values()) {
      if (slots.length < 2) continue;
      checked = true;
      const sorted = [...slots].sort((x, y) => x - y);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(headway * 0.9);
      }
    }
    expect(checked).toBe(true);
  });

  it('三种站型的容量 / 建设费 / 日运营各不相同', () => {
    const sim = newSim();
    sim.fund = 100_000;
    const a = sim.placeStation(520, 1120, 'small').station!;
    const b = sim.placeStation(700, 1125, 'large').station!;
    const c = sim.placeStation(900, 1090, 'standard').station!;
    expect(a.size).toBe('small');
    expect(a.capacity).toBe(60);
    expect(b.capacity).toBe(250);
    expect(c.capacity).toBe(100);
    expect(sim.fund).toBe(100_000 - 600 - 3_000 - 1_000);
    expect(sim.stationCost()).toBe(20 + 80 + 30);
    expect(sim.todayCost()).toBe(20 + 80 + 30);

    const file = makeSaveFile(sim, 'auto');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    expect(restored.net.stationById.get(a.id)!.size).toBe('small');
    expect(restored.net.stationById.get(b.id)!.capacity).toBe(250);
    expect(restored.stationCost()).toBe(20 + 80 + 30);
  });

  it('夜间跳过要等末班车回库，不会在 00:00 直接跳走', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = true;
    const ids = [
      sim.placeStation(480, 1060).station!.id,
      sim.placeStation(700, 1125).station!.id,
      sim.placeStation(940, 1085).station!.id,
      sim.placeStation(1205, 578).station!.id,
    ];
    const lineId = sim.createLine(ids, 0, undefined, 360, 30).lineId!; // 06:00–00:30
    const line = sim.net.lineById.get(lineId)!;
    const train = sim.net.trainById.get(line.trains[0]!)!;
    sim.advanceMinutes(1439 - 360); // 23:59
    // 让末班车处于区间运行中，跨过 00:00 后不能立刻跳夜。
    train.index = 1;
    train.dir = 1;
    train.phase = 1;
    train.prog = 0.1;
    train.riders = [];
    sim.advanceMinutes(1);
    expect(sim.dayIndex()).toBe(1);
    expect(sim.timeOfDay()).toBeLessThan(60);
    // 等它跑完 00:30 收车、回库后才允许跳到第一班出发前。慢车 80 km/h，
    // 末班车折返后还要跑完当前一程，给足 90 分钟。
    sim.advanceMinutes(90);
    expect(sim.timeOfDay()).toBeGreaterThan(200);
  });

  it('末班车跑完当前一程后停在终点站，不立刻消失', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    sim.settings.skipNight = false;
    const ids = [
      sim.placeStation(480, 1060).station!.id,
      sim.placeStation(700, 1125).station!.id,
      sim.placeStation(940, 1085).station!.id,
      sim.placeStation(1205, 578).station!.id,
    ];
    const lineId = sim.createLine(ids, 0, undefined, 360, 540).lineId!; // 06:00–09:00
    const line = sim.net.lineById.get(lineId)!;
    const train = sim.net.trainById.get(line.trains[0]!)!;
    const span = sim.trainSpan(train, line);

    sim.advanceMinutes(190); // 09:10，已经过运营结束时间
    for (let i = 0; i < 20; i++) sim.advanceMinutes(1);
    // 停在区间端点，并保持不动
    expect(train.index === span.start || train.index === span.end).toBe(true);
    const parked = { index: train.index, prog: train.prog, phase: train.phase };
    sim.advanceMinutes(10);
    expect({ index: train.index, prog: train.prog, phase: train.phase }).toEqual(parked);
  });

  it('线路颜色与运营时段随存档恢复', () => {
    const sim = newSim();
    const a = sim.placeStation(760, 1100).station!;
    const b = sim.placeStation(880, 1100).station!;
    sim.createLine([a.id, b.id], 2, '#ABCDEF', 420, 1080);
    const file = makeSaveFile(sim, 'manual-1');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    const line = restored.net.lines[0]!;
    expect(line.hex).toBe('#ABCDEF');
    expect(line.startMin).toBe(420);
    expect(line.endMin).toBe(1080);
  });

  it('POI 有 1–6 级、scale 与日吸引量区间', () => {
    const sim = newSim();
    expect(sim.pois.length).toBe(692);
    for (const poi of sim.pois) {
      expect(poi.level).toBeGreaterThanOrEqual(1);
      expect(poi.level).toBeLessThanOrEqual(6);
      expect(poi.scale).toBeGreaterThanOrEqual(0.5);
      expect(poi.scale).toBeLessThanOrEqual(1.2);
      expect(poi.dailyMax).toBeGreaterThanOrEqual(poi.dailyMin);
      expect(poi.closeMin).toBeGreaterThan(poi.openMin);
    }
    expect(sim.pois.some((p) => p.level === 5)).toBe(true);
    // 新数据包含城市级 5A 景区（七星岩、鼎湖山），因此 6 级是合法的。
    expect(sim.pois.some((p) => p.level === 6)).toBe(true);
    const hospital = sim.pois.find((p) => p.name.includes('第一人民医院'))!;
    expect(hospital.level).toBe(5);
    // 等级基准差距明显，同级差异靠 scale。
    expect(poiDailyRange(5, 1.2).dailyMin).toBeGreaterThan(poiDailyRange(3, 0.8).dailyMax);
    expect(POI_LEVEL_META[5].daily).toBeGreaterThan(POI_LEVEL_META[3].daily);
  });

  it('时间画像：硬截止、软截止、脉冲与周末', () => {
    const sim = newSim();
    const hospital = sim.pois.find((p) => p.type === 'hospital')!;
    expect(hospital.profile).toBe('hard');
    expect(poiTimeWeight(hospital, 16 * 60, 0)).toBeGreaterThan(0);
    expect(poiTimeWeight(hospital, 17 * 60, 0)).toBe(0);
    expect(poiTimeWeight(hospital, 17 * 60 + 5, 0)).toBe(0);

    const mall = sim.pois.find((p) => p.type === 'mall')!;
    expect(poiTimeWeight(mall, 20 * 60, 0)).toBeGreaterThan(
      poiTimeWeight(mall, 21 * 60 + 45, 0),
    );

    const ferry = sim.pois.find((p) => p.type === 'ferry')!;
    expect(ferry.profile).toBe('pulse');
    expect(poiProfileWeight(ferry, 6 * 60)).toBeGreaterThan(poiProfileWeight(ferry, 6 * 60 + 15));

    const school = sim.pois.find((p) => p.type === 'school')!;
    // 第 2 天是周六，学校画像为 0。
    expect(poiTimeWeight(school, 9 * 60, 2)).toBe(0);
  });

  it('OD 流带随时段消失，硬截止 POI 在截止后为 0', () => {
    const sim = newSim();
    const hospital = sim.pois.find((p) => p.type === 'hospital')!;
    const pair = sim.odPairs.find((p) => p.to === 10000 + hospital.id);
    expect(pair).toBeTruthy();
    sim.time = 16 * 60;
    expect(sim.odFlowWeight(pair!)).toBeGreaterThan(0);
    sim.time = 17 * 60 + 5;
    expect(sim.odFlowWeight(pair!)).toBe(0);
  });

  it('赶不上硬截止时取消出行并计入统计', () => {
    const sim = newSim();
    sim.settings.autoPause = false;
    const hospital = sim.pois.find((p) => p.name.includes('第一人民医院'))!;
    const idx = Array.from({ length: sim.agents.count }, (_, i) => i).find(
      (i) => sim.agents.workZone[i] === 10000 + hospital.id,
    );
    expect(idx).toBeDefined();
    const i = idx!;
    const station = sim.placeStation(hospital.x, hospital.y).station!;
    const other = sim.placeStation(hospital.x + 120, hospital.y).station!;
    sim.createLine([station.id, other.id], 0);
    // 起点就在医院站旁边，形成一次很短的步行出行；16:55 出发仍会赶不上 17:00 截止。
    sim.agents.homeX[i] = hospital.x - 10;
    sim.agents.homeY[i] = hospital.y;
    sim.agents.workX[i] = hospital.x;
    sim.agents.workY[i] = hospital.y;
    sim.agents.hasReturn[i] = 0;
    sim.agents.state[i] = 0;
    sim.agents.outMin[i] = 1018;
    sim.time = 1000;
    sim.rebuildSchedule();
    sim.advanceMinutes(30);
    expect(sim.stats.cancelled).toBeGreaterThan(0);
    expect(sim.agents.state[i]).toBe(0);
  });

  it('同一组团多站按东西南北命名', () => {
    const sim = newSim();
    // 选一个四周 18 px 内没有被别的新增村庄抢走归属的组团，
    // 避免地图数据扩充后“最近组团”漂移把用例断言打偏。
    const owns = (zone: { id: number; x: number; y: number; r: number }, dx: number, dy: number) => {
      let bestId = zone.id;
      let bestD = Infinity;
      for (const other of sim.zones) {
        const d = Math.hypot(other.x - (zone.x + dx), other.y - (zone.y + dy)) - other.r * 0.35;
        if (d < bestD) {
          bestD = d;
          bestId = other.id;
        }
      }
      return bestId === zone.id;
    };
    const z = sim.zones.find(
      (zone) =>
        !/[东南西北]$/.test(zone.name) &&
        [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18]].every(([dx, dy]) => owns(zone, dx!, dy!)),
    )!;
    expect(z).toBeTruthy();
    const base = sim.placeStation(z.x, z.y).station!;
    expect(base.name).toBe(z.name);
    const east = sim.placeStation(z.x + 18, z.y).station!;
    expect(east.name).toBe(`${z.name}东`);
    const west = sim.placeStation(z.x - 18, z.y).station!;
    expect(west.name).toBe(`${z.name}西`);
    const north = sim.placeStation(z.x, z.y - 18).station!;
    expect(north.name).toBe(`${z.name}北`);
    const south = sim.placeStation(z.x, z.y + 18).station!;
    expect(south.name).toBe(`${z.name}南`);
  });

  it('既有线路可从两端延长，按新增区段计费', () => {
    const sim = newSim();
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(825, 1150).station!;
    const lineId = sim.createLine([a.id, b.id], 0).lineId!;
    const line = sim.net.lineById.get(lineId)!;

    const c = sim.placeStation(940, 1085).station!;
    const fundAfterC = sim.fund;
    const append = sim.extendLine(lineId, [a.id, b.id, c.id]);
    expect(append.ok).toBe(true);
    expect(append.cost).toBe(500);
    expect(sim.fund).toBe(fundAfterC - 500);
    expect(line.stationIds).toEqual([a.id, b.id, c.id]);
    expect(line.buildCost).toBe(1000);
    expect(line.trains.length).toBe(1);

    const d = sim.placeStation(640, 1100).station!;
    const fundAfterD = sim.fund;
    const prepend = sim.extendLine(lineId, [d.id, a.id, b.id, c.id]);
    expect(prepend.ok).toBe(true);
    expect(sim.fund).toBe(fundAfterD - 500);
    expect(line.stationIds).toEqual([d.id, a.id, b.id, c.id]);
    const train = sim.net.trainById.get(line.trains[0]!)!;
    expect(train.index).toBe(1);
    expect(sim.extendLine(lineId, [a.id, b.id, c.id])).toEqual({
      ok: false,
      reason: '请在线路两端接入至少一个新车站',
    });
  });

  it('可从线路中间站分出一条共用颜色的支线', () => {
    const sim = newSim();
    const a = sim.placeStation(700, 1125).station!;
    const b = sim.placeStation(825, 1150).station!;
    const c = sim.placeStation(940, 1085).station!;
    const d = sim.placeStation(850, 1030).station!;
    const lineId = sim.createLine([a.id, b.id, c.id], 2).lineId!;
    const parent = sim.net.lineById.get(lineId)!;
    const branch = sim.createBranch(lineId, [b.id, d.id]);
    expect(branch.ok).toBe(true);
    const child = sim.net.lineById.get(branch.lineId!)!;
    expect(child.branchOf).toBe(lineId);
    expect(child.color).toBe(parent.color);
    expect(child.hex).toBe(parent.hex);
    expect(child.startMin).toBe(parent.startMin);
    expect(child.endMin).toBe(parent.endMin);
    expect(child.stationIds).toEqual([b.id, d.id]);
    expect(sim.createBranch(lineId, [a.id, d.id]).ok).toBe(false);

    const file = makeSaveFile(sim, 'manual-1');
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    const savedChild = restored.net.lines.find((l) => l.branchOf === lineId);
    expect(savedChild).toBeTruthy();
    expect(savedChild!.stationIds).toEqual([b.id, d.id]);
    expect(savedChild!.hex).toBe(parent.hex);
  });

  it('内置地图数据互相独立，存档记录所属地图', () => {
    const terrain = TERRAIN_MAP.createField();
    const plain = PLAIN_MAP.createField();
    expect(terrain.pois.length).toBe(692);
    expect(plain.pois.length).toBe(213);
    expect(terrain.pois).not.toBe(plain.pois);
    expect(terrain.zones).not.toBe(plain.zones);
    terrain.pois[0]!.name = '地形图临时改名';
    expect(plain.pois[0]!.name).not.toBe('地形图临时改名');

    const sim = new Simulation({
      field: plain,
      mapId: PLAIN_MAP.id,
      mapName: PLAIN_MAP.name,
      pxPerKm: PLAIN_MAP.pxPerKm,
      maxAgents: 12_000,
    });
    const file = makeSaveFile(sim, 'auto');
    expect(file.meta.mapId).toBe(PLAIN_MAP.id);
    expect(file.meta.mapName).toBe(PLAIN_MAP.name);
    const restored = restoreSim(JSON.parse(JSON.stringify(file)).data);
    expect(restored.mapId).toBe(PLAIN_MAP.id);
    expect(restored.mapName).toBe(PLAIN_MAP.name);
    expect(restored.pois.length).toBe(213);
    expect(restored.pois).not.toBe(plain.pois);
  });
});

describe('实时热力（REQ-HEAT-001 / 002）', () => {
  it('潮汐相位：早 / 晚 / 平峰 / 夜间', () => {
    expect(tideWeights(480).phase).toBe('morning');
    expect(tideWeights(1080).phase).toBe('evening');
    expect(tideWeights(780).phase).toBe('day');
    expect(tideWeights(1320).phase).toBe('night');
  });

  it('热力来自正在外出的人，归一化到 0..1', () => {
    const sim = newSim();
    sim.settings.skipNight = false;
    const ids = [
      sim.placeStation(480, 1060).station!.id,
      sim.placeStation(700, 1125).station!.id,
      sim.placeStation(940, 1085).station!.id,
    ];
    sim.createLine(ids, 0);
    sim.advanceMinutes(150); // 06:00 → 08:30，早高峰
    const frame = buildHeatFrame(sim, sim.timeOfDay());
    expect(frame.gw).toBe(HEAT_GW);
    expect(frame.gh).toBe(HEAT_GH);
    expect(frame.values.length).toBe(HEAT_GW * HEAT_GH);
    expect(frame.activePeople).toBeGreaterThan(0);
    let max = 0;
    for (const v of frame.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > max) max = v;
    }
    expect(max).toBeGreaterThan(0.5);
  });

  it('站点超载给出承载力百分比、站外排队人数与满意度', () => {
    const s = stationThermal({ id: 1, name: '测试站', x: 0, y: 0, capacity: 200 }, 260);
    expect(s.ratio).toBeCloseTo(1.3, 5);
    expect(s.overflow).toBe(60);
    expect(s.satisfaction).toBeLessThan(30);
    const calm = stationThermal({ id: 2, name: '空站', x: 0, y: 0, capacity: 200 }, 40);
    expect(calm.overflow).toBe(0);
    expect(calm.satisfaction).toBe(100);
  });
});














