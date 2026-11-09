import { describe, expect, it } from 'vitest';
import { curveAngle, curvePoint, curvePolyline, smoothTravel } from '../src/sim/lineCurve';

describe('线路曲线与列车缓动', () => {
  it('曲线经过站点，并在区段中部产生轻微弯曲', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 120, y: 0 };
    const start = curvePoint(a, b, 0, 0);
    const end = curvePoint(a, b, 0, 1);
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(120, 6);
    expect(end.y).toBeCloseTo(0, 6);
    const mid = curvePoint(a, b, 0, 0.5);
    expect(Math.abs(mid.y)).toBeGreaterThan(1);
    expect(Math.abs(mid.y)).toBeLessThan(8);
    const pts = curvePolyline([a, b], 0, 6);
    expect(pts[0]).toMatchObject({ x: 0, y: 0 });
    expect(pts[pts.length - 1]!.x).toBeCloseTo(120, 6);
  });

  it('列车起步 / 停车速度趋近 0，中段最快', () => {
    expect(smoothTravel(0)).toBe(0);
    expect(smoothTravel(1)).toBe(1);
    expect(smoothTravel(0.5)).toBeCloseTo(0.5, 6);
    const vStart = smoothTravel(0.02) / 0.02;
    const vMid = (smoothTravel(0.52) - smoothTravel(0.5)) / 0.02;
    const vEnd = (smoothTravel(1) - smoothTravel(0.98)) / 0.02;
    expect(vStart).toBeLessThan(0.2);
    expect(vEnd).toBeLessThan(0.2);
    expect(vMid).toBeGreaterThan(1.2);
  });

  it('切线方向随曲线变化', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const angle0 = curveAngle(a, b, 0, 0);
    const angleQuarter = curveAngle(a, b, 0, 0.25);
    expect(Math.abs(angleQuarter)).toBeGreaterThan(0.01);
    expect(angle0).not.toBe(angleQuarter);
  });
});

