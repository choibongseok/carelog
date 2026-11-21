import { addDays, dayStart } from './time';

export const PROGRAM = 'basic-4w';

export type MissionKey = 'glucose_logs' | 'post_meal_checks' | 'activity_logs';

export interface Mission {
  key: MissionKey;
  target: number;
}

/** 주차별 미션. 주차마다 모든 미션을 채우면 다음 단계로 넘어간다. */
export const WEEKS: { week: number; missions: Mission[] }[] = [
  { week: 1, missions: [{ key: 'glucose_logs', target: 20 }, { key: 'post_meal_checks', target: 3 }] },
  { week: 2, missions: [{ key: 'glucose_logs', target: 30 }, { key: 'post_meal_checks', target: 5 }] },
  { week: 3, missions: [{ key: 'glucose_logs', target: 40 }, { key: 'post_meal_checks', target: 8 }, { key: 'activity_logs', target: 3 }] },
  { week: 4, missions: [{ key: 'glucose_logs', target: 40 }, { key: 'post_meal_checks', target: 10 }, { key: 'activity_logs', target: 5 }] },
];

export interface JourneyEvents {
  glucose: Date[];
  meals: Date[];
  activities: Date[];
}

export interface MissionProgress {
  week: number;
  mission: MissionKey;
  value: number;
  target: number;
}

export interface Transition {
  from: number;
  to: number | null; // null = 프로그램 완료
}

export interface JourneyEvaluation {
  currentWeek: number;
  completed: boolean;
  progress: MissionProgress[];
  transitions: Transition[];
}

const MIN = 60_000;
const POST_MEAL_FROM_MIN = 30;
const POST_MEAL_TO_MIN = 150;

/** 식후 측정: 식사 30~150분 뒤에 혈당 기록이 하나 이상 있는 식사. */
export function countPostMealChecks(meals: Date[], glucose: Date[]): number {
  const g = glucose.map((d) => d.getTime());
  return meals.filter((m) => {
    const t = m.getTime();
    return g.some((x) => x - t >= POST_MEAL_FROM_MIN * MIN && x - t <= POST_MEAL_TO_MIN * MIN);
  }).length;
}

export function weekWindow(startedOn: string, week: number): { from: Date; to: Date } {
  return { from: dayStart(addDays(startedOn, (week - 1) * 7)), to: dayStart(addDays(startedOn, week * 7)) };
}

export interface WeekCounts {
  glucoseLogs: number;
  postMealChecks: number;
  activityLogs: number;
}

/** 주차별 집계 값을 미션 진행률로 바꾼다. */
export function progressFromCounts(week: number, c: WeekCounts): MissionProgress[] {
  const def = WEEKS.find((w) => w.week === week);
  if (!def) return [];
  return def.missions.map((m) => ({
    week,
    mission: m.key,
    target: m.target,
    value: m.key === 'glucose_logs' ? c.glucoseLogs : m.key === 'activity_logs' ? c.activityLogs : c.postMealChecks,
  }));
}

/**
 * 현재 주차부터 미션 달성 여부를 보고 단계를 앞으로만 넘긴다.
 * 늦게 도착한 기록으로 다시 계산해도 이미 넘어간 단계는 되돌아가지 않는다.
 * countsFor 는 주차별 집계를 돌려준다(메모리 배열이든 SQL 집계든 상관없다).
 */
export async function evaluateWeeks(currentWeek: number, countsFor: (week: number) => Promise<WeekCounts>): Promise<JourneyEvaluation> {
  const progress: MissionProgress[] = [];
  const transitions: Transition[] = [];
  let week = currentWeek;
  let completed = currentWeek > WEEKS.length;
  while (!completed) {
    const p = progressFromCounts(week, await countsFor(week));
    progress.push(...p);
    if (!p.every((m) => m.value >= m.target)) break;
    const next = week + 1;
    if (next > WEEKS.length) {
      transitions.push({ from: week, to: null });
      completed = true;
    } else {
      transitions.push({ from: week, to: next });
      week = next;
    }
  }
  return { currentWeek: completed ? WEEKS.length : week, completed, progress, transitions };
}

/** 메모리에 있는 기록으로 한 주차의 집계를 계산한다. */
export function countsFromEvents(startedOn: string, week: number, ev: JourneyEvents): WeekCounts {
  const { from, to } = weekWindow(startedOn, week);
  const within = (d: Date) => d >= from && d < to;
  return {
    glucoseLogs: ev.glucose.filter(within).length,
    activityLogs: ev.activities.filter(within).length,
    postMealChecks: countPostMealChecks(ev.meals.filter(within), ev.glucose),
  };
}

export function weekProgress(startedOn: string, week: number, ev: JourneyEvents): MissionProgress[] {
  return progressFromCounts(week, countsFromEvents(startedOn, week, ev));
}

export function evaluateJourney(startedOn: string, currentWeek: number, ev: JourneyEvents): Promise<JourneyEvaluation> {
  return evaluateWeeks(currentWeek, async (week) => countsFromEvents(startedOn, week, ev));
}
