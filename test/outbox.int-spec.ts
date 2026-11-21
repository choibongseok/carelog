import { createTestApp, glucose, login, resetAll, sendBatch, TestApp, at } from './helpers';

describe('아웃박스 릴레이', () => {
  let t: TestApp;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp({ background: false });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetAll(t);
    token = await login(t, 'user1@demo.test');
  });

  const seedRows = async (n: number) => {
    for (let i = 0; i < n; i++) await sendBatch(t, token, [glucose(`g${i}`, at(1, '08:00'), 100 + i)]);
  };

  it('미발행 행을 큐에 넣고 발행 시각을 남긴다', async () => {
    await seedRows(3);
    expect(await t.relay.relayOnce()).toBe(3);
    const pending = await t.db.selectFrom('outbox').selectAll().where('published_at', 'is', null).execute();
    expect(pending).toHaveLength(0);
    const counts = await t.queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting).toBe(3);
  });

  it('이미 발행한 행은 다시 발행하지 않는다', async () => {
    await seedRows(2);
    await t.relay.relayOnce();
    expect(await t.relay.relayOnce()).toBe(0);
  });

  it('릴레이 두 개가 동시에 돌아도 각 행은 한 번만 발행된다', async () => {
    await seedRows(20);
    const [a, b] = await Promise.all([t.relay.relayOnce(10), t.relay.relayOnce(10)]);
    expect(a + b).toBe(20);
    const counts = await t.queue.getJobCounts('waiting');
    expect(counts.waiting).toBe(20);
  });

  it('같은 아웃박스 ID 를 큐에 다시 넣어도 작업은 하나로 합쳐진다', async () => {
    await seedRows(1);
    await t.relay.relayOnce();
    await t.db.updateTable('outbox').set({ published_at: null }).execute(); // 표시 직전에 죽은 상황을 흉내
    await t.relay.relayOnce();
    const counts = await t.queue.getJobCounts('waiting');
    expect(counts.waiting).toBe(1);
  });
});
