import { countPostMealChecks, evaluateJourney, JourneyEvents, weekProgress } from './journey';

const START = '2026-11-02';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000Z`);
const empty = (): JourneyEvents => ({ glucose: [], meals: [], activities: [] });

/** 1주차 미션(기록 20회, 식후 측정 3회)을 채우는 데이터. */
function week1Done(): JourneyEvents {
  const ev = empty();
  for (let i = 0; i < 20; i++) ev.glucose.push(at('2026-11-03', `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`));
  for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) {
    ev.meals.push(at(day, '12:00'));
    ev.glucose.push(at(day, '12:45'));
  }
  return ev;
}

describe('여정 진행', () => {
  it('식후 측정은 식사 30~150분 뒤의 기록만 센다', async () => {
    const meals = [at(START, '12:00'), at(START, '18:00'), at(START, '21:00')];
    const glucose = [at(START, '12:29'), at(START, '12:30'), at(START, '20:31'), at(START, '21:10')];
    // 12:00 식사: 12:30 있음 → 1, 18:00 식사: 20:31(151분)·없음 → 0, 21:00 식사: 21:10(10분) → 0
    expect(countPostMealChecks(meals, glucose)).toBe(1);
  });

  it('미션이 모자라면 현재 주차를 유지한다', async () => {
    const ev = week1Done();
    ev.glucose.pop();
    ev.glucose.pop();
    ev.glucose.pop();
    const res = await evaluateJourney(START, 1, { ...ev, glucose: ev.glucose.slice(0, 10) });
    expect(res.currentWeek).toBe(1);
    expect(res.transitions).toEqual([]);
    expect(res.completed).toBe(false);
  });

  it('1주차 미션을 모두 채우면 2주차로 전환한다', async () => {
    const res = await evaluateJourney(START, 1, week1Done());
    expect(res.currentWeek).toBe(2);
    expect(res.transitions).toEqual([{ from: 1, to: 2 }]);
  });

  it('다른 주차의 기록은 해당 주차 진행에 섞이지 않는다', async () => {
    const ev = empty();
    ev.glucose.push(at('2026-11-02', '08:00'), at('2026-11-09', '08:00'), at('2026-11-10', '08:00'));
    expect(weekProgress(START, 1, ev).find((m) => m.mission === 'glucose_logs')?.value).toBe(1);
    expect(weekProgress(START, 2, ev).find((m) => m.mission === 'glucose_logs')?.value).toBe(2);
  });

  it('늦게 도착한 기록으로 여러 주차를 한 번에 연속 전환할 수 있다', async () => {
    const ev = week1Done();
    // 2주차: 기록 30, 식후 5
    for (let i = 0; i < 30; i++) ev.glucose.push(at('2026-11-10', `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`));
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      ev.meals.push(at(day, '19:00'));
      ev.glucose.push(at(day, '19:40'));
    }
    const res = await evaluateJourney(START, 1, ev);
    expect(res.transitions).toEqual([{ from: 1, to: 2 }, { from: 2, to: 3 }]);
    expect(res.currentWeek).toBe(3);
  });

  it('4주차까지 모두 채우면 프로그램이 완료된다', async () => {
    const ev = empty();
    const weeks = [
      { n: 1, g: 20, m: 3, a: 0 },
      { n: 2, g: 30, m: 5, a: 0 },
      { n: 3, g: 40, m: 8, a: 3 },
      { n: 4, g: 40, m: 10, a: 5 },
    ];
    for (const w of weeks) {
      const base = (w.n - 1) * 7;
      const day = (d: number) => `2026-11-${String(2 + base + d).padStart(2, '0')}`;
      for (let i = 0; i < w.g; i++) ev.glucose.push(at(day(i % 7), `${String(6 + Math.floor(i / 7)).padStart(2, '0')}:00`));
      for (let i = 0; i < w.m; i++) {
        ev.meals.push(at(day(i % 7), `${String(8 + Math.floor(i / 7) * 5).padStart(2, '0')}:00`));
        ev.glucose.push(at(day(i % 7), `${String(8 + Math.floor(i / 7) * 5).padStart(2, '0')}:45`));
      }
      for (let i = 0; i < w.a; i++) ev.activities.push(at(day(i % 7), '17:00'));
    }
    const res = await evaluateJourney(START, 1, ev);
    expect(res.completed).toBe(true);
    expect(res.transitions[res.transitions.length - 1]).toEqual({ from: 4, to: null });
  });

  it('이미 넘어간 단계는 기록이 없어도 되돌아가지 않는다', async () => {
    const res = await evaluateJourney(START, 3, empty());
    expect(res.currentWeek).toBe(3);
    expect(res.transitions).toEqual([]);
  });
});
