import { at, bearer, createTestApp, dayOf, drainOutbox, glucose, login, meal, resetAll, sendBatch, TestApp } from './helpers';

describe('조회 API', () => {
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

  it('타임라인 커서 페이지네이션은 모든 기록을 중복·누락 없이 순회한다', async () => {
    const events = Array.from({ length: 25 }, (_, i) => glucose(`g${i}`, at(1, `${String(8 + Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`), 100 + i));
    // 같은 측정 시각 2건을 넣어 id 로 순서를 가르는 경우를 만든다.
    events.push(glucose('same-1', at(1, '08:00'), 90), glucose('same-2', at(1, '08:00'), 91));
    await sendBatch(t, u1, events);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/me/timeline?limit=10${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await t.http.get(url).set(bearer(u1));
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i: { eventId: string }) => i.eventId));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(27);
    expect(new Set(seen).size).toBe(27);
  });

  it('타임라인의 limit·cursor 가 잘못되면 400 이다', async () => {
    for (const q of ['limit=0', 'limit=201', 'limit=abc', 'cursor=garbage']) {
      expect((await t.http.get(`/v1/me/timeline?${q}`).set(bearer(u1))).status).toBe(400);
    }
  });

  it('사용자는 userId 를 지정해도 자기 기록만 본다', async () => {
    await sendBatch(t, u1, [glucose('mine', at(1, '08:00'), 100)]);
    await sendBatch(t, u2, [glucose('theirs', at(1, '08:00'), 100)]);
    const res = await t.http.get('/v1/me/timeline?userId=user-2').set(bearer(u1));
    expect(res.body.items.map((i: { eventId: string }) => i.eventId)).toEqual(['mine']);
  });

  it('주간 요약은 월요일 시작 7일 범위를 합산한다', async () => {
    const monday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 7);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    await sendBatch(t, u1, [glucose('a', `${monday}T08:00:00Z`, 100), glucose('b', `${monday}T09:00:00Z`, 140), glucose('c', `${monday}T10:00:00Z`, 200), meal('m', `${monday}T07:00:00Z`)]);
    await drainOutbox(t);
    const res = await t.http.get(`/v1/me/summary/weekly?date=${monday}`).set(bearer(u1));
    expect(res.body).toMatchObject({ weekStart: monday, readings: 3, avgGlucose: 146.7, meals: 1 });
    expect(res.body.days).toHaveLength(1);
  });

  it('날짜 형식이 틀리면 400 이다', async () => {
    expect((await t.http.get('/v1/me/summary/daily?date=2026-13-01').set(bearer(u1))).status).toBe(400);
    expect((await t.http.get('/v1/me/summary/weekly?date=yesterday').set(bearer(u1))).status).toBe(400);
  });

  it('요약은 Redis 에 캐시되어 두 번째 조회는 DB 를 거치지 않는다', async () => {
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 100)]);
    await drainOutbox(t);
    const day = dayOf(1);
    await t.http.get(`/v1/me/summary/daily?date=${day}`).set(bearer(u1));
    expect(await t.redis.get(`summary:daily:user-1:${day}`)).not.toBeNull();
    // DB 를 직접 바꿔도 캐시가 유효한 동안은 캐시 값이 나온다.
    await t.db.updateTable('daily_summaries').set({ readings: 99 }).execute();
    expect((await t.http.get(`/v1/me/summary/daily?date=${day}`).set(bearer(u1))).body.readings).toBe(1);
    const metrics = (await t.http.get('/metrics')).text;
    expect(metrics).toMatch(/carelog_summary_cache_total\{result="hit"\} 1/);
  });

  it('여정 현황은 가입 전에는 enrolled=false 이다', async () => {
    expect((await t.http.get('/v1/me/journey').set(bearer(u1))).body).toEqual({ enrolled: false });
  });
});
