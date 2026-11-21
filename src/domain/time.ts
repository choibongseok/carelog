/** 날짜는 모두 UTC 기준이다(사용자별 시간대는 한계로 README 에 적는다). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  const d = dayStart(day);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
}

/** 해당 날짜가 속한 주의 월요일. */
export function weekStartMonday(day: string): string {
  const d = dayStart(day);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return addDays(day, -dow);
}

export const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayStart(v).getTime()) && utcDay(dayStart(v)) === v;
