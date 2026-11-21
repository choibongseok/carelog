import { activity, at, bearer, createTestApp, dayOf, glucose, login, meal, sendBatch, TestApp, waitFor } from './helpers';

/** 릴레이·워커를 실제로 띄워 HTTP 수집부터 조회까지 비동기 흐름 전체를 확인한다. */
describe('수집 → 아웃박스 → 큐 → 소비자 → 조회 (e2e)', () => {
  let t: TestApp;
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    t = await createTestApp({ background: true });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    const { resetAll } = await import('./helpers');
    await resetAll(t);
    u1 = await login(t, 'user1@demo.test');
    u2 = await login(t, 'user2@demo.test');
  });

  const daily = async (token: string, day: string) => (await t.http.get(`/v1/me/summary/daily?date=${day}`).set(bearer(token))).body;

  it('기록을 보내면 요약·알림이 비동기로 만들어져 조회된다', async () => {
    const res = await sendBatch(t, u1, [
      glucose('g1', at(1, '11:50'), 100),
      meal('m1', at(1, '12:00')),
      glucose('g2', at(1, '12:40'), 175),
      glucose('g3', at(1, '13:30'), 120),
      glucose('g4', at(1, '03:00'), 55),
      glucose('g5', at(1, '19:00'), 280),
    ]);
    expect(res.body.accepted).toBe(6);
    const s = await waitFor(async () => {
      const d = await daily(u1, dayOf(1));
      return d.readings === 5 ? d : undefined;
    });
    expect(s).toMatchObject({ postMealSpikes: 1, meals: 1 });
    const alerts = await waitFor(async () => {
      const a = (await t.http.get('/v1/me/alerts').set(bearer(u1))).body;
      return a.length === 2 ? a : undefined;
    });
    expect(alerts.map((a: { kind: string }) => a.kind).sort()).toEqual(['high', 'low']);
    const metrics = (await t.http.get('/metrics')).text;
    expect(metrics).toMatch(/carelog_queue_delay_seconds_count [1-9]/);
    expect(metrics).toMatch(/carelog_consumer_processed_total\{result="ok"\} [1-9]/);
  });

  it('중복·지연·순서 역전이 섞인 오프라인 동기화도 순서대로 보낸 것과 같은 요약이 된다', async () => {
    const day = 2;
    const all = [
      ...Array.from({ length: 40 }, (_, i) => glucose(`g${i}`, at(day, `${String(7 + Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`), 90 + ((i * 7) % 90))),
      meal('m1', at(day, '07:30')),
      meal('m2', at(day, '10:00')),
      activity('a1', at(day, '17:00')),
    ];
    // u1: 시간 순서대로 한 번에. u2: 역순으로 쪼개고 일부는 두 번 보낸다.
    await sendBatch(t, u1, all);
    const reversed = [...all].reverse();
    await sendBatch(t, u2, reversed.slice(0, 15));
    await sendBatch(t, u2, reversed.slice(10, 30)); // 5건 중복
    await sendBatch(t, u2, [...reversed.slice(25), ...reversed.slice(0, 3)]); // 다시 중복
    const want = await waitFor(async () => {
      const d = await daily(u1, dayOf(day));
      return d.readings === 40 ? d : undefined;
    });
    const got = await waitFor(async () => {
      const d = await daily(u2, dayOf(day));
      return d.readings === 40 && d.meals === 2 ? d : undefined;
    });
    const strip = ({ updatedAt: _u, ...rest }: Record<string, unknown>) => rest;
    expect(strip(got)).toEqual(strip(want));
    const n = await t.db.selectFrom('health_events').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', 'user-2').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(43);
  });

  it('기록이 누적되면 여정이 2주차로 전환된다', async () => {
    const events: unknown[] = [];
    for (let i = 0; i < 20; i++) events.push(glucose(`g${i}`, at(8, `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`), 105));
    for (let d = 0; d < 3; d++) {
      events.push(meal(`m${d}`, at(8 - d, '12:00')), glucose(`p${d}`, at(8 - d, '12:50'), 118));
    }
    await sendBatch(t, u1, events);
    const j = await waitFor(async () => {
      const r = (await t.http.get('/v1/me/journey').set(bearer(u1))).body;
      return r.currentWeek === 2 ? r : undefined;
    });
    expect(j.transitions).toEqual([expect.objectContaining({ from: 1, to: 2 })]);
  });
});
