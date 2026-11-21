import { bearer, createTestApp, glucose, login, meal, sendBatch, TestApp, at, activity } from './helpers';

describe('기록 수집', () => {
  let t: TestApp;
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    t = await createTestApp({ background: false });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    const { resetAll } = await import('./helpers');
    await resetAll(t);
    u1 = await login(t, 'user1@demo.test');
    u2 = await login(t, 'user2@demo.test');
  });

  it('수집한 기록은 PostgreSQL 에 정규화되고 원본은 MongoDB 에 남는다', async () => {
    const res = await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 110), meal('m1', at(1, '08:30')), activity('a1', at(1, '18:00'))]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 3, accepted: 3, duplicates: 0, rejected: [] });
    const rows = await t.db.selectFrom('health_events').selectAll().where('user_id', '=', 'user-1').orderBy('measured_at').execute();
    expect(rows.map((r) => [r.kind, r.glucose_mgdl, r.carbs_g, r.duration_min])).toEqual([
      ['glucose', 110, null, null],
      ['meal', null, 60, null],
      ['activity', null, null, 30],
    ]);
    const raw = await t.mongo.db(t.cfg.mongoDb).collection('raw_events').findOne({ _id: 'user-1:g1' as never });
    expect(raw).toMatchObject({ userId: 'user-1', eventId: 'g1', deviceId: 'dev-1', deliveries: 1, payload: { mgdl: 110 } });
  });

  it('같은 eventId 를 다시 보내면 중복으로 차단하고 행이 늘지 않는다', async () => {
    const events = [glucose('g1', at(1, '08:00'), 110), glucose('g2', at(1, '08:05'), 115)];
    await sendBatch(t, u1, events);
    const again = await sendBatch(t, u1, [...events, glucose('g3', at(1, '08:10'), 120)]);
    expect(again.body).toMatchObject({ accepted: 1, duplicates: 2 });
    const n = await t.db.selectFrom('health_events').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(3);
    const raw = await t.mongo.db(t.cfg.mongoDb).collection('raw_events').findOne({ _id: 'user-1:g1' as never });
    expect(raw?.deliveries).toBe(2);
  });

  it('한 배치 안의 같은 eventId 는 한 건만 저장한다', async () => {
    const res = await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 110), glucose('g1', at(1, '08:00'), 110)]);
    expect(res.body).toMatchObject({ accepted: 1, duplicates: 1 });
  });

  it('eventId 는 사용자별로 독립이라 다른 사용자의 같은 ID 는 영향을 주지 않는다', async () => {
    await sendBatch(t, u1, [glucose('same', at(1, '08:00'), 110)]);
    const res = await sendBatch(t, u2, [glucose('same', at(1, '08:00'), 95)]);
    expect(res.body).toMatchObject({ accepted: 1, duplicates: 0 });
  });

  it('잘못된 항목은 rejected 로 돌려주고 나머지는 저장한다', async () => {
    const res = await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 110), { eventId: 'bad', type: 'glucose', measuredAt: at(1, '08:05'), mgdl: 9999 }, glucose('g2', at(1, '08:10'), 120)]);
    expect(res.body.accepted).toBe(2);
    expect(res.body.rejected).toEqual([{ index: 1, eventId: 'bad', reason: expect.stringContaining('mgdl') }]);
  });

  it('순서가 뒤바뀌어 늦게 도착한 기록도 측정 시각 순으로 조회된다', async () => {
    await sendBatch(t, u1, [glucose('g3', at(1, '10:00'), 130)]);
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 100), glucose('g2', at(1, '09:00'), 110)]);
    const res = await t.http.get('/v1/me/timeline').set(bearer(u1));
    expect(res.body.items.map((i: { eventId: string }) => i.eventId)).toEqual(['g3', 'g2', 'g1']);
  });

  it('기록과 같은 트랜잭션으로 아웃박스 행이 날짜별로 만들어진다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(2, '23:55'), 100), glucose('g2', at(1, '00:05'), 105), glucose('g3', at(1, '00:10'), 110)]);
    const rows = await t.db.selectFrom('outbox').selectAll().orderBy('id').execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.published_at === null && r.user_id === 'user-1')).toBe(true);
    const payloads = rows.map((r) => r.payload as { day: string; events: unknown[] });
    expect(payloads.map((p) => p.events.length).sort()).toEqual([1, 2]);
  });

  it('중복만 담긴 배치는 아웃박스 행을 만들지 않는다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 110)]);
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 110)]);
    const n = await t.db.selectFrom('outbox').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it('토큰이 없거나 병의원 토큰이면 수집이 거부된다', async () => {
    const noToken = await t.http.post('/v1/logs/batch').send({ events: [glucose('g1', at(1, '08:00'), 110)] });
    expect(noToken.status).toBe(401);
    const clinic = await login(t, 'clinic1@demo.test', 'clinic');
    const asClinic = await sendBatch(t, clinic, [glucose('g1', at(1, '08:00'), 110)]);
    expect(asClinic.status).toBe(403);
  });

  it('events 가 비었거나 500건을 넘으면 400 으로 거부한다', async () => {
    expect((await sendBatch(t, u1, [])).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => glucose(`g${i}`, at(1, '08:00'), 100));
    expect((await sendBatch(t, u1, many)).status).toBe(400);
    const ok = Array.from({ length: 500 }, (_, i) => glucose(`g${i}`, at(1, '08:00'), 100));
    expect((await sendBatch(t, u1, ok)).body.accepted).toBe(500);
  });
});
