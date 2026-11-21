export interface Reading {
  measuredAt: Date;
  mgdl: number;
}

export interface Range {
  low: number;
  high: number;
}

export interface DailySummary {
  readings: number;
  avgGlucose: number | null;
  timeInRangePct: number | null;
  postMealSpikes: number;
  meals: number;
}

/** 식후 급상승 판정 상수: 식전 기준값 대비 식후 2시간 안에 이만큼 이상 오르면 1회로 센다. */
export const SPIKE_RISE_MGDL = 50;
const BASELINE_BEFORE_MIN = 30;
const BASELINE_AFTER_MIN = 15;
const POST_WINDOW_MIN = 120;
const MIN = 60_000;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 식사 1건이 식후 급상승인지 판정한다. 입력 순서와 무관하게 측정 시각으로 계산한다.
 * 기준값: 식사 직전 30분 안의 마지막 측정, 없으면 식사 직후 15분 안의 첫 측정.
 */
export function isPostMealSpike(mealAt: Date, readings: Reading[]): boolean {
  const t = mealAt.getTime();
  const sorted = [...readings].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const before = sorted.filter((r) => r.measuredAt.getTime() <= t && t - r.measuredAt.getTime() <= BASELINE_BEFORE_MIN * MIN);
  const baseline =
    before.length > 0
      ? before[before.length - 1]
      : sorted.find((r) => r.measuredAt.getTime() > t && r.measuredAt.getTime() - t <= BASELINE_AFTER_MIN * MIN);
  if (!baseline) return false;
  const after = sorted.filter(
    (r) => r.measuredAt.getTime() > baseline.measuredAt.getTime() && r.measuredAt.getTime() <= t + POST_WINDOW_MIN * MIN,
  );
  if (after.length === 0) return false;
  return Math.max(...after.map((r) => r.mgdl)) - baseline.mgdl >= SPIKE_RISE_MGDL;
}

/** 하루치 측정·식사로 요약을 계산한다. 목표 범위 비율은 측정 개수 기준(균등 간격 CGM 가정). */
export function computeDailySummary(readings: Reading[], mealTimes: Date[], range: Range): DailySummary {
  if (readings.length === 0) {
    return { readings: 0, avgGlucose: null, timeInRangePct: null, postMealSpikes: 0, meals: mealTimes.length };
  }
  const sum = readings.reduce((s, r) => s + r.mgdl, 0);
  const inRange = readings.filter((r) => r.mgdl >= range.low && r.mgdl <= range.high).length;
  const spikes = mealTimes.filter((m) => isPostMealSpike(m, readings)).length;
  return {
    readings: readings.length,
    avgGlucose: round1(sum / readings.length),
    timeInRangePct: round1((inRange / readings.length) * 100),
    postMealSpikes: spikes,
    meals: mealTimes.length,
  };
}

export interface DayRow extends DailySummary {
  day: string;
}

export interface WeeklySummary extends DailySummary {
  weekStart: string;
  days: DayRow[];
}

/** 일일 요약 7개를 측정 개수 가중으로 합친다. */
export function combineWeekly(weekStart: string, days: DayRow[]): WeeklySummary {
  const readings = days.reduce((s, d) => s + d.readings, 0);
  const weighted = (pick: (d: DayRow) => number | null) =>
    readings === 0 ? null : round1(days.reduce((s, d) => s + (pick(d) ?? 0) * d.readings, 0) / readings);
  return {
    weekStart,
    days,
    readings,
    avgGlucose: weighted((d) => d.avgGlucose),
    timeInRangePct: weighted((d) => d.timeInRangePct),
    postMealSpikes: days.reduce((s, d) => s + d.postMealSpikes, 0),
    meals: days.reduce((s, d) => s + d.meals, 0),
  };
}
