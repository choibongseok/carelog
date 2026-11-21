import { at, bearer, createTestApp, dayOf, drainOutbox, glucose, login, resetAll, sendBatch, TestApp } from './helpers';

describe('병의원(B2B) 접근 통제', () => {
  let t: TestApp;
  let u1: string;
  let u2: string;
  let c1: string;
  let c2: string;
  const day = dayOf(1);

  beforeAll(async () => {
    t = await createTestApp({ background: false });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAll(t);
    u1 = await login(t, 'user1@demo.test');
    u2 = await login(t, 'user2@demo.test');
    c1 = await login(t, 'clinic1@demo.test', 'clinic');
    c2 = await login(t, 'clinic2@demo.test', 'clinic');
    await sendBatch(t, u1, [glucose('g1', at(1, '08:00'), 100), glucose('g2', at(1, '08:05'), 140)]);
    await sendBatch(t, u2, [glucose('g3', at(1, '08:00'), 90)]);
    await drainOutbox(t);
  });

  const grant = (token: string, clinicId: string) => t.http.post('/v1/me/consents').set(bearer(token)).send({ clinicId });
  const view = (token: string, userId: string) => t.http.get(`/v1/clinic/patients/${userId}/summary/daily?date=${day}`).set(bearer(token));

  it('동의한 병의원만 환자의 요약을 볼 수 있다', async () => {
    expect((await view(c1, 'user-1')).status).toBe(404);
    await grant(u1, 'clinic-1');
    const res = await view(c1, 'user-1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ readings: 2, avgGlucose: 120 });
  });

  it('동의가 없는 사용자와 존재하지 않는 사용자는 같은 응답이라 존재 여부가 드러나지 않는다', async () => {
    const noConsent = await view(c1, 'user-2');
    const missing = await view(c1, 'user-999');
    expect(noConsent.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(noConsent.body).toEqual(missing.body);
  });

  it('다른 병의원이 받은 동의로는 조회할 수 없다(IDOR)', async () => {
    await grant(u1, 'clinic-1');
    expect((await view(c2, 'user-1')).status).toBe(404);
    expect((await t.http.get('/v1/clinic/patients/user-1/summary/weekly').set(bearer(c2))).status).toBe(404);
  });

  it('동의를 철회하면 캐시가 남아 있어도 즉시 차단된다', async () => {
    await grant(u1, 'clinic-1');
    expect((await view(c1, 'user-1')).status).toBe(200); // 요약이 Redis 에 캐시된다
    expect(await t.redis.get(`summary:daily:user-1:${day}`)).not.toBeNull();
    const revoke = await t.http.delete('/v1/me/consents/clinic-1').set(bearer(u1));
    expect(revoke.status).toBe(200);
    expect((await view(c1, 'user-1')).status).toBe(404);
    expect((await t.http.get('/v1/clinic/patients').set(bearer(c1))).body).toEqual([]);
  });

  it('철회 뒤 다시 동의하면 다시 볼 수 있다', async () => {
    await grant(u1, 'clinic-1');
    await t.http.delete('/v1/me/consents/clinic-1').set(bearer(u1));
    await grant(u1, 'clinic-1');
    expect((await view(c1, 'user-1')).status).toBe(200);
  });

  it('조회는 허용·거부 모두 감사 로그에 남고 사용자가 확인할 수 있다', async () => {
    await view(c1, 'user-1'); // 거부
    await grant(u1, 'clinic-1');
    await view(c1, 'user-1'); // 허용
    const rows = await t.db.selectFrom('audit_logs').selectAll().orderBy('id').execute();
    expect(rows.map((r) => [r.clinic_id, r.user_id, r.action, r.allowed])).toEqual([
      ['clinic-1', 'user-1', 'view_daily_summary', false],
      ['clinic-1', 'user-1', 'view_daily_summary', true],
    ]);
    expect(rows[1].request_id).toBeTruthy();
    const log = await t.http.get('/v1/me/access-log').set(bearer(u1));
    expect(log.body.map((l: { allowed: boolean }) => l.allowed)).toEqual([true, false]);
    expect((await t.http.get('/v1/me/access-log').set(bearer(u2))).body).toEqual([]);
  });

  it('병의원 환자 목록에는 동의한 사용자만 나온다', async () => {
    await grant(u1, 'clinic-1');
    await grant(u2, 'clinic-2');
    const list = await t.http.get('/v1/clinic/patients').set(bearer(c1));
    expect(list.body.map((p: { userId: string }) => p.userId)).toEqual(['user-1']);
  });

  it('사용자 토큰으로 병의원 API 를, 병의원 토큰으로 사용자 API 를 부르면 403 이다', async () => {
    expect((await t.http.get('/v1/clinic/patients').set(bearer(u1))).status).toBe(403);
    expect((await t.http.get('/v1/me/timeline').set(bearer(c1))).status).toBe(403);
    expect((await t.http.get('/v1/me/consents').set(bearer(c1))).status).toBe(403);
  });

  it('없는 병의원에 동의하거나 활성 동의가 없는데 철회하면 404 이다', async () => {
    expect((await grant(u1, 'clinic-999')).status).toBe(404);
    expect((await t.http.delete('/v1/me/consents/clinic-1').set(bearer(u1))).status).toBe(404);
  });
});
