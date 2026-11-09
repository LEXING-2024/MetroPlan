/**
 * 公历 / 日历 / 时段速度规则。
 * 纯函数，不依赖 DOM，也不依赖渲染层。
 */

export const DAY_MINUTES = 1440;
export const START_YEAR = 2026;
export const START_MONTH = 1;
export const START_DAY_OF_MONTH = 1;
export const START_DAY_INDEX = 0;
/** 2026-01-01 06:00 对应的绝对分钟数。 */
export const START_TOTAL_MINUTES = 6 * 60;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_DAYS[month - 1] ?? 30;
}

/** Howard Hinnant 的 days_from_civil：返回 1970-01-01 起的天数。 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 逆运算：从 1970-01-01 起的天数还原公历日期。 */
function civilFromDays(days: number): DateParts {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { year: y + (m <= 2 ? 1 : 0), month: m, day: d };
}

const EPOCH = daysFromCivil(START_YEAR, START_MONTH, START_DAY_OF_MONTH);

export function dayIndexFromDate(year: number, month: number, day: number): number {
  return daysFromCivil(year, month, day) - EPOCH;
}

export function dateFromDayIndex(dayIndex: number): DateParts {
  return civilFromDays(EPOCH + dayIndex);
}

/** 0 = 周日, 1 = 周一 … 6 = 周六。 */
export function weekdayOf(dayIndex: number): number {
  return (((EPOCH + dayIndex + 4) % 7) + 7) % 7;
}

export function weekdayLabel(dayIndex: number): string {
  return WEEKDAY_NAMES[weekdayOf(dayIndex)] ?? '周四';
}

export function splitTime(totalMinutes: number): { day: number; minuteOfDay: number } {
  const day = Math.floor(totalMinutes / DAY_MINUTES);
  return { day, minuteOfDay: totalMinutes - day * DAY_MINUTES };
}

export function startOfDay(dayIndex: number): number {
  return dayIndex * DAY_MINUTES;
}

export function formatDate(dayIndex: number): string {
  const d = dateFromDayIndex(dayIndex);
  return `${d.year}年${d.month}月${d.day}日`;
}

export function formatShortDate(dayIndex: number): string {
  const d = dateFromDayIndex(dayIndex);
  return `${d.month}月${d.day}日`;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatClock(minuteOfDay: number): string {
  const m = Math.floor(Math.max(0, Math.min(DAY_MINUTES - 0.0001, minuteOfDay)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function formatDateTime(dayIndex: number, minuteOfDay: number): string {
  return `${formatDate(dayIndex)} ${formatClock(minuteOfDay)}`;
}

export type PeriodId = 'night' | 'beforeAm' | 'amPeak' | 'offPeak' | 'pmPeak' | 'beforeNight';

export interface PeriodInfo {
  id: PeriodId;
  label: string;
  /** 自动速度：游戏分钟 / 真实秒 */
  speed: number;
  /** 是否属于高峰（1x） */
  peak: boolean;
}

const NIGHT: PeriodInfo = { id: 'night', label: '夜间', speed: 16, peak: false };
const BEFORE_AM: PeriodInfo = { id: 'beforeAm', label: '早高峰前', speed: 8, peak: false };
const AM_PEAK: PeriodInfo = { id: 'amPeak', label: '早高峰', speed: 1, peak: true };
const OFF_PEAK: PeriodInfo = { id: 'offPeak', label: '平峰', speed: 8, peak: false };
const PM_PEAK: PeriodInfo = { id: 'pmPeak', label: '晚高峰', speed: 1, peak: true };
const BEFORE_NIGHT: PeriodInfo = { id: 'beforeNight', label: '夜间前', speed: 8, peak: false };

/** 时段边界（分钟）：06:00 / 07:00 / 09:00 / 17:00 / 19:00 / 24:00 */
export const PERIOD_BOUNDARIES = [360, 420, 540, 1020, 1140, 1440];

export function periodOf(minuteOfDay: number): PeriodInfo {
  const m = ((minuteOfDay % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (m < 360) return NIGHT;
  if (m < 420) return BEFORE_AM;
  if (m < 540) return AM_PEAK;
  if (m < 1020) return OFF_PEAK;
  if (m < 1140) return PM_PEAK;
  return BEFORE_NIGHT;
}

export function autoSpeedOf(minuteOfDay: number): number {
  return periodOf(minuteOfDay).speed;
}

/** 时段边界中大于 time 的下一个绝对值（含每天 00:00 结算点）。 */
export function nextBoundaryAfter(time: number): number {
  const dayStart = Math.floor(time / DAY_MINUTES) * DAY_MINUTES;
  const candidates = [0, 360, 410, 420, 540, 1010, 1020, 1140];
  for (const tod of candidates) {
    const abs = dayStart + tod;
    if (abs > time + 1e-6) return abs;
  }
  return dayStart + DAY_MINUTES;
}
