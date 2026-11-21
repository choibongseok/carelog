import { activity, at, bearer, createTestApp, dayOf, drainOutbox, glucose, login, meal, outboxMessages, resetAll, sendBatch, TestApp } from './helpers';

describe('소비자(요약·알림·여정)', () => {
  let t: TestApp;
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    t = await createTestApp({ background: false });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAll(t);
    u1 = await login(t, 'user1@demo.test');
    u2 = await login(t, 'user2@demo.test');
  });

  const daily = async (token: string, day: string) => (await t.http.get(`/v1/me/summary/daily?date=${day}`).set(bearer(token))).body;

  it('메시지를 처리하면 일일 요약이 저장된다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 100), glucose('g2', at(1, '08:05'), 200), glucose('g3', at(1, '08:10'), 60), glucose('g4', at(1, '08:15'), 140)]);
    await drainOutbox(t);
    expect(await daily(u1, dayOf(1))).toMatchObject({ readings: 4, avgGlucose: 125, timeInRangePct: 50, postMealSpikes: 0 });
  });

  it('식후 급상승 횟수가 요약에 반영된다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '11:50'), 100), meal('m1', at(1, '12:00')), glucose('g2', at(1, '12:40'), 170), glucose('g3', at(1, '13:30'), 120)]);
    await drainOutbox(t);
    expect(await daily(u1, dayOf(1))).toMatchObject({ postMealSpikes: 1, meals: 1 });
  });

  it('사용자별 목표 범위 설정이 요약에 적용된다', async () => {
    const u3 = await login(t, 'user3@demo.test'); // 목표 80~140
    const events = [glucose('g1', at(1, '08:00'), 75), glucose('g2', at(1, '08:05'), 100), glucose('g3', at(1, '08:10'), 160)];
    await sendBatch(t, u1, events);
    await sendBatch(t, u3, events);
    await drainOutbox(t);
    expect((await daily(u1, dayOf(1))).timeInRangePct).toBe(100);
    expect((await daily(u3, dayOf(1))).timeInRangePct).toBe(33.3);
  });

  it('같은 메시지를 두 번 처리해도 한 번만 반영된다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 40)]);
    const [msg] = await outboxMessages(t);
    expect(await t.handler.handle(msg)).toBe('ok');
    expect(await t.handler.handle(msg)).toBe('duplicate');
    const alerts = await t.db.selectFrom('alerts').selectAll().execute();
    expect(alerts).toHaveLength(1);
    const processed = await t.db.selectFrom('processed_messages').selectAll().execute();
    expect(processed).toHaveLength(1);
  });

  it('배치가 어떤 순서로 처리돼도 요약 결과가 같다', async () => {
    const early = [glucose('g1', at(1, '08:00'), 100), glucose('g2', at(1, '08:05'), 220)];
    const late = [glucose('g3', at(1, '09:00'), 90), meal('m1', at(1, '07:50'))];
    await sendBatch(t, u1, early);
    await sendBatch(t, u1, late);
    await sendBatch(t, u2, late);
    await sendBatch(t, u2, early);
    const msgs = await outboxMessages(t);
    const forUser = (id: string) => msgs.filter((m) => m.userId === id);
    for (const m of forUser('user-1')) await t.handler.handle(m);
    for (const m of forUser('user-2').reverse()) await t.handler.handle(m);
    const strip = ({ updatedAt: _u, ...rest }: Record<string, unknown>) => rest;
    expect(strip(await daily(u1, dayOf(1)))).toEqual(strip(await daily(u2, dayOf(1))));
  });

  it('저혈당·고혈당 기록은 알림을 만들고 경계값은 만들지 않는다', async () => {
    await sendBatch(t, u1, [glucose('lo', at(1, '03:00'), 65), glucose('edge-lo', at(1, '03:05'), 70), glucose('hi', at(1, '14:00'), 300), glucose('edge-hi', at(1, '14:05'), 250), glucose('ok', at(1, '14:10'), 120)]);
    await drainOutbox(t);
    const res = await t.http.get('/v1/me/alerts').set(bearer(u1));
    expect(res.body.map((a: { kind: string; mgdl: number }) => [a.kind, a.mgdl]).sort()).toEqual([['high', 300], ['low', 65]]);
  });

  it('같은 기록에 대한 알림은 다른 메시지로 다시 와도 한 번만 만든다', async () => {
    await sendBatch(t, u1, [glucose('lo', at(1, '03:00'), 50)]);
    const [msg] = await outboxMessages(t);
    await t.handler.handle(msg);
    await t.handler.handle({ ...msg, outboxId: msg.outboxId + 1000 }); // 새 메시지 ID, 같은 기록
    expect(await t.db.selectFrom('alerts').selectAll().execute()).toHaveLength(1);
  });

  async function week1Events(startDaysAgo: number, prefix: string) {
    const events: unknown[] = [];
    for (let i = 0; i < 20; i++) events.push(glucose(`${prefix}-g${i}`, at(startDaysAgo - 1, `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`), 100));
    for (let d = 0; d < 3; d++) {
      events.push(meal(`${prefix}-m${d}`, at(startDaysAgo - 1 - d, '12:00')));
      events.push(glucose(`${prefix}-p${d}`, at(startDaysAgo - 1 - d, '12:45'), 110));
    }
    return events;
  }

  it('1주차 미션을 채우면 2주차로 전환하고 전환 이력을 남긴다', async () => {
    await sendBatch(t, u1, await week1Events(10, 'w1'));
    await drainOutbox(t);
    const j = (await t.http.get('/v1/me/journey').set(bearer(u1))).body;
    expect(j).toMatchObject({ enrolled: true, currentWeek: 2, completed: false, transitions: [{ from: 1, to: 2 }] });
    expect(j.missions.filter((m: { week: number; done: boolean }) => m.week === 1).every((m: { done: boolean }) => m.done)).toBe(true);
  });

  it('미션이 모자라면 현재 주차에 머문다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(2, '08:00'), 100), activity('a1', at(2, '18:00'))]);
    await drainOutbox(t);
    const j = (await t.http.get('/v1/me/journey').set(bearer(u1))).body;
    expect(j).toMatchObject({ currentWeek: 1, transitions: [] });
    expect(j.missions.find((m: { mission: string }) => m.mission === 'glucose_logs')).toMatchObject({ value: 1, target: 20, done: false });
  });

  it('1주차 중 더 오래된 기록이 늦게 도착하면 시작일을 앞당긴다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(2, '08:00'), 100)]);
    await drainOutbox(t);
    expect((await t.http.get('/v1/me/journey').set(bearer(u1))).body.startedOn).toBe(dayOf(2));
    await sendBatch(t, u1, [glucose('old', at(5, '08:00'), 100)]);
    await drainOutbox(t);
    expect((await t.http.get('/v1/me/journey').set(bearer(u1))).body.startedOn).toBe(dayOf(5));
  });

  it('같은 사용자의 두 메시지를 동시에 처리해도 최종 요약에 모든 기록이 들어간다', async () => {
    await sendBatch(t, u1, Array.from({ length: 30 }, (_, i) => glucose(`a${i}`, at(1, `08:${String(i).padStart(2, '0')}`), 100)));
    await sendBatch(t, u1, Array.from({ length: 30 }, (_, i) => glucose(`b${i}`, at(1, `09:${String(i).padStart(2, '0')}`), 120)));
    const msgs = await outboxMessages(t);
    await Promise.all(msgs.map((m) => t.handler.handle(m)));
    expect(await daily(u1, dayOf(1))).toMatchObject({ readings: 60, avgGlucose: 110 });
  });

  it('처리가 끝나면 요약 캐시가 무효화되어 최신 값이 조회된다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 100)]);
    await drainOutbox(t);
    expect((await daily(u1, dayOf(1))).readings).toBe(1); // 캐시에 적재
    await sendBatch(t, u1, [glucose('g2', at(1, '08:05'), 120)]);
    expect((await daily(u1, dayOf(1))).readings).toBe(1); // 아직 소비 전: 캐시 값
    await drainOutbox(t);
    expect((await daily(u1, dayOf(1))).readings).toBe(2);
  });
});
