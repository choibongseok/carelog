import { at, bearer, createTestApp, glucose, login, resetAll, sendBatch, TestApp } from './helpers';

describe('운영 기능(인증·관측·문서)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ background: false });
  });
  afterAll(() => t.close());
  beforeEach(() => resetAll(t));

  it('시드 계정으로 로그인하면 JWT 를 받고 틀린 비밀번호는 401 이다', async () => {
    const ok = await t.http.post('/v1/auth/login').send({ email: 'user1@demo.test', password: 'demo1234' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ tokenType: 'Bearer', role: 'user', id: 'user-1' });
    const bad = await t.http.post('/v1/auth/login').send({ email: 'user1@demo.test', password: 'nope' });
    const none = await t.http.post('/v1/auth/login').send({ email: 'nobody@demo.test', password: 'demo1234' });
    expect(bad.status).toBe(401);
    expect(none.status).toBe(401);
    expect(bad.body.message).toBe(none.body.message);
    const clinic = await t.http.post('/v1/auth/login').send({ email: 'clinic1@demo.test', password: 'demo1234', role: 'clinic' });
    expect(clinic.body).toMatchObject({ role: 'clinic', id: 'clinic-1' });
  });

  it('변조되었거나 형식이 틀린 토큰은 401 이다', async () => {
    const token = await login(t, 'user1@demo.test');
    const tampered = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
    expect((await t.http.get('/v1/me/alerts').set(bearer(tampered))).status).toBe(401);
    expect((await t.http.get('/v1/me/alerts').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await t.http.get('/v1/me/alerts')).status).toBe(401);
  });

  it('/health 는 PostgreSQL·MongoDB·Redis 가 모두 정상이면 ok 를 돌려준다', async () => {
    const res = await t.http.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', postgres: 'up', mongo: 'up', redis: 'up' });
  });

  it('/metrics 는 수집·중복·아웃박스 적체 지표를 노출한다', async () => {
    const token = await login(t, 'user1@demo.test');
    await sendBatch(t, token, [glucose('g1', at(1, '08:00'), 100), glucose('g2', at(1, '08:05'), 110), { eventId: 'x', type: 'glucose' }]);
    await sendBatch(t, token, [glucose('g1', at(1, '08:00'), 100)]);
    const text = (await t.http.get('/metrics')).text;
    expect(text).toMatch(/carelog_events_ingested_total\{kind="glucose"\} 2/);
    expect(text).toMatch(/carelog_events_duplicate_total 1/);
    expect(text).toMatch(/carelog_events_rejected_total 1/);
    expect(text).toMatch(/carelog_outbox_pending 1/);
    expect(text).toMatch(/carelog_http_request_duration_seconds_count\{method="POST",route="\/v1\/logs\/batch",status="200"\} 2/);
  });

  it('요청 ID 를 응답 헤더로 돌려주고 들어온 유효한 값은 유지한다', async () => {
    const generated = await t.http.get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await t.http.get('/health').set('x-request-id', 'trace-abc-123');
    expect(kept.headers['x-request-id']).toBe('trace-abc-123');
    const replaced = await t.http.get('/health').set('x-request-id', 'bad id with spaces');
    expect(replaced.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('OpenAPI 문서에 수집·조회·병의원 경로가 들어 있다', async () => {
    const res = await t.http.get('/docs-json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/v1/logs/batch', '/v1/me/timeline', '/v1/clinic/patients/{userId}/summary/daily', '/health']));
  });
});

describe('저장소 장애', () => {
  it('Redis 연결이 끊기면 /health 는 503 과 함께 어느 저장소가 내려갔는지 알려준다', async () => {
    const t = await createTestApp({ background: false });
    try {
      t.redis.disconnect();
      const res = await t.http.get('/health');
      expect(res.status).toBe(503);
      expect(res.body.message ?? res.body).toMatchObject({ status: 'degraded', redis: 'down', postgres: 'up', mongo: 'up' });
    } finally {
      await t.close();
    }
  });
});
