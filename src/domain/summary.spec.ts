import { combineWeekly, computeDailySummary, isPostMealSpike, Reading } from './summary';

const t = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00.000Z`);
const r = (hhmm: string, mgdl: number): Reading => ({ measuredAt: t(hhmm), mgdl });
const RANGE = { low: 70, high: 180 };

describe('일일 요약 계산', () => {
  it('평균 혈당과 목표 범위 내 비율을 계산한다', () => {
    const s = computeDailySummary([r('08:00', 100), r('08:05', 200), r('08:10', 60), r('08:15', 140)], [], RANGE);
    expect(s.readings).toBe(4);
    expect(s.avgGlucose).toBe(125);
    expect(s.timeInRangePct).toBe(50);
  });

  it('측정이 없으면 평균과 비율은 null 이다', () => {
    const s = computeDailySummary([], [t('12:00')], RANGE);
    expect(s).toEqual({ readings: 0, avgGlucose: null, timeInRangePct: null, postMealSpikes: 0, meals: 1 });
  });

  it('사용자별 목표 범위를 적용한다', () => {
    const readings = [r('08:00', 75), r('08:05', 95), r('08:10', 125)];
    expect(computeDailySummary(readings, [], { low: 70, high: 180 }).timeInRangePct).toBe(100);
    expect(computeDailySummary(readings, [], { low: 80, high: 110 }).timeInRangePct).toBe(33.3);
  });

  it('경계값(70, 180)은 범위 안으로 센다', () => {
    expect(computeDailySummary([r('08:00', 70), r('08:05', 180)], [], RANGE).timeInRangePct).toBe(100);
  });

  it('식사 후 2시간 안에 식전 대비 50 이상 오르면 급상승 1회로 센다', () => {
    const readings = [r('11:50', 100), r('12:30', 150), r('13:00', 120)];
    expect(isPostMealSpike(t('12:00'), readings)).toBe(true);
    expect(computeDailySummary(readings, [t('12:00')], RANGE).postMealSpikes).toBe(1);
  });

  it('상승폭이 50 미만이면 급상승이 아니다', () => {
    expect(isPostMealSpike(t('12:00'), [r('11:55', 100), r('12:40', 149)])).toBe(false);
  });

  it('입력 순서가 뒤바뀌어도 같은 결과가 나온다', () => {
    const ordered = [r('11:50', 100), r('12:30', 160), r('13:00', 120)];
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(computeDailySummary(shuffled, [t('12:00')], RANGE)).toEqual(computeDailySummary(ordered, [t('12:00')], RANGE));
  });

  it('식전 기준값이 없으면 식사 직후 15분 안의 첫 측정을 기준으로 삼는다', () => {
    expect(isPostMealSpike(t('12:00'), [r('12:10', 100), r('12:50', 170)])).toBe(true);
    expect(isPostMealSpike(t('12:00'), [r('12:40', 100), r('13:00', 170)])).toBe(false);
  });

  it('식후 2시간을 넘긴 상승은 세지 않는다', () => {
    expect(isPostMealSpike(t('12:00'), [r('11:55', 100), r('14:30', 200)])).toBe(false);
  });
});

describe('주간 요약 합산', () => {
  it('일일 요약을 측정 개수 가중으로 합친다', () => {
    const w = combineWeekly('2026-11-02', [
      { day: '2026-11-02', readings: 100, avgGlucose: 100, timeInRangePct: 100, postMealSpikes: 1, meals: 3 },
      { day: '2026-11-03', readings: 300, avgGlucose: 140, timeInRangePct: 60, postMealSpikes: 2, meals: 3 },
    ]);
    expect(w.readings).toBe(400);
    expect(w.avgGlucose).toBe(130);
    expect(w.timeInRangePct).toBe(70);
    expect(w.postMealSpikes).toBe(3);
    expect(w.meals).toBe(6);
  });
});
