import { computeDailySummary } from '../../../src/domain/summary';
import { Engine, MAX_ATTEMPTS, RawEvent, START_DAY, TICKS_PER_DAY } from './engine';

const g = (id: string, hhmm: string, mgdl: number): RawEvent => ({ eventId: id, type: 'glucose', measuredAt: `${START_DAY}T${hhmm}:00.000Z`, mgdl });
async function run(e: Engine, ticks: number) {
  for (let i = 0; i < ticks; i++) await e.step();
}
const noTime = (s: unknown) => JSON.stringify(s);

describe('브라우저 엔진', () => {
  it('같은 eventId 를 다시 보내면 저장하지 않고 중복으로 센다', async () => {
    const e = new Engine();
    await run(e, 30);
    const before = e.storedCount;
    const r = e.resendDuplicates(10);
    expect(r).toMatchObject({ accepted: 0, duplicates: 10 });
    expect(e.storedCount).toBe(before);
    expect(e.counters.duplicates).toBe(10);
  });

  it('잘못된 값은 거부하고 나머지는 저장한다', async () => {
    const e = new Engine();
    await run(e, 3);
    const r = e.ingest([g('ok-1', '00:05', 110), g('bad-1', '00:05', 9999), { eventId: 'x y', type: 'glucose', measuredAt: `${START_DAY}T00:05:00.000Z`, mgdl: 100 }]);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toHaveLength(2);
    expect(e.counters.rejected).toBe(2);
  });

  it('저장과 함께 아웃박스 행이 생기고 릴레이가 큐로 옮긴다', async () => {
    const e = new Engine();
    await run(e, 2);
    e.ingest([g('a', '00:05', 100)]);
    expect(e.outboxPending).toBe(1);
    expect(e.relay()).toBe(1);
    expect(e.outboxPending).toBe(0);
    expect(e.queue).toHaveLength(1);
  });

  it('소비자가 만든 일일 요약은 서버와 같은 계산 함수의 결과와 같다', async () => {
    const e = new Engine();
    await run(e, 100);
    const chart = e.chartDay(START_DAY);
    const want = computeDailySummary(chart.readings, chart.meals.map((m) => m.at), { low: 70, high: 180 });
    expect(e.summaryFor(START_DAY)).toEqual(want);
  });

  it('큐가 같은 메시지를 다시 전달해도 한 번만 반영한다', async () => {
    const e = new Engine();
    await run(e, 40);
    const processed = e.counters.processed;
    expect(await e.redeliver()).toBe(true);
    expect(e.counters.processed).toBe(processed);
    expect(e.counters.skipped).toBe(1);
  });

  it('소비자 실패를 주입하면 재시도 끝에 dead-letter 로 가고, 해제 후 재처리하면 반영된다', async () => {
    const e = new Engine();
    await run(e, 2);
    e.setFailConsumer(true);
    await run(e, 20);
    expect(e.counters.deadLetters).toBeGreaterThan(0);
    expect(e.counters.retries).toBeGreaterThanOrEqual(e.counters.deadLetters * MAX_ATTEMPTS);
    expect(e.summaryFor(START_DAY)).toBeNull();
    e.setFailConsumer(false);
    await e.replayDeadLetters();
    expect(e.deadLetters).toHaveLength(0);
    expect(e.summaryFor(START_DAY)?.readings).toBeGreaterThan(0);
  });

  it('저혈당·고혈당 알림은 같은 기록당 한 번만 만든다', async () => {
    const e = new Engine();
    await run(e, 2);
    e.ingest([g('lo', '00:05', 50), g('hi', '00:10', 300)]);
    await e.pump();
    await e.redeliver();
    expect(e.alerts.map((a) => a.kind).sort()).toEqual(['high', 'low']);
  });

  it('하루를 돌리면 1주차 미션을 채워 2주차로 전환한다', async () => {
    const e = new Engine();
    await run(e, TICKS_PER_DAY);
    expect(e.journey?.currentWeek).toBe(2);
    expect(e.journey?.transitions[0]).toMatchObject({ from: 1, to: 2 });
  });

  it('동의가 없으면 404 이고 동의 후에는 200, 철회하면 바로 막히며 모두 감사 로그에 남는다', async () => {
    const e = new Engine();
    await run(e, 30);
    e.setConsent(false);
    expect(e.clinicView(START_DAY).status).toBe(404);
    e.setConsent(true);
    expect(e.clinicView(START_DAY).status).toBe(200);
    e.setConsent(false);
    expect(e.clinicView(START_DAY).status).toBe(404);
    expect(e.audit.map((a) => a.allowed)).toEqual([false, true, false]);
  });

  it('같은 시드로 돌리면 결과가 결정적이다', async () => {
    const a = new Engine(5);
    const b = new Engine(5);
    await run(a, 120);
    await run(b, 120);
    expect(noTime(a.summaryFor(START_DAY))).toBe(noTime(b.summaryFor(START_DAY)));
    expect(a.storedCount).toBe(b.storedCount);
  });

  it('오프라인 보관 후 역순으로 보내도 최종 요약은 순서대로 보낸 것과 같고 순서 역전 반영이 집계된다', async () => {
    const normal = new Engine(3);
    await run(normal, 150);
    const late = new Engine(3);
    await run(late, 30);
    late.setOffline(true);
    await run(late, 90);
    expect(late.held.length).toBeGreaterThan(5);
    await late.releaseHeld();
    await run(late, 30);
    expect(late.counters.outOfOrder).toBeGreaterThan(0);
    expect(noTime(late.summaryFor(START_DAY))).toBe(noTime(normal.summaryFor(START_DAY)));
  });

  it('하루가 지나면 다음 날 요약이 따로 만들어진다', async () => {
    const e = new Engine();
    await run(e, TICKS_PER_DAY + 40);
    expect(e.day).toBe('2026-11-03');
    expect(e.summaryFor('2026-11-02')?.readings).toBe(TICKS_PER_DAY - 1); // 첫 기록은 00:05
    expect(e.summaryFor('2026-11-03')?.readings).toBeGreaterThan(0);
  });
});
