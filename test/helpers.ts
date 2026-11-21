import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Kysely, sql } from 'kysely';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, AppConfig } from '../src/config';
import { DomainEventHandler } from '../src/consumer/handler';
import { KYSELY, MONGO, REDIS } from '../src/db/db.module';
import type { DB } from '../src/db/types';
import { OutboxRelay } from '../src/outbox/outbox.relay';
import { EVENT_QUEUE, EventMessage } from '../src/queue/queue.module';
import { seedDemo } from '../src/seed';
import { configureApp } from '../src/setup';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  db: Kysely<DB>;
  redis: Redis;
  mongo: MongoClient;
  queue: Queue;
  relay: OutboxRelay;
  handler: DomainEventHandler;
  cfg: AppConfig;
  close: () => Promise<void>;
}

interface Options {
  /** false 면 릴레이·워커를 띄우지 않고 테스트가 직접 relayOnce/handle 을 호출한다. */
  background?: boolean;
  handler?: Type<DomainEventHandler>;
}

export async function createTestApp(opts: Options = {}): Promise<TestApp> {
  process.env.RUN_BACKGROUND = opts.background === false ? 'false' : 'true';
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.handler) builder.overrideProvider(DomainEventHandler).useClass(opts.handler);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  app.enableShutdownHooks();
  await app.init();
  const t: TestApp = {
    app,
    http: request(app.getHttpServer()),
    db: app.get<Kysely<DB>>(KYSELY),
    redis: app.get<Redis>(REDIS),
    mongo: app.get<MongoClient>(MONGO),
    queue: app.get<Queue>(EVENT_QUEUE),
    relay: app.get(OutboxRelay),
    handler: app.get(DomainEventHandler),
    cfg: app.get<AppConfig>(APP_CONFIG),
    close: () => app.close(),
  };
  await resetAll(t);
  return t;
}

/** 모든 저장소를 비우고 데모 계정을 다시 심는다. */
export async function resetAll(t: TestApp): Promise<void> {
  await sql`truncate table audit_logs, consents, alerts, journey_transitions, journey_progress, journeys, daily_summaries, dead_letters, processed_messages, outbox, health_events, clinics, users restart identity cascade`.execute(t.db);
  await t.redis.flushdb();
  await t.mongo.db(t.cfg.mongoDb).collection('raw_events').deleteMany({});
  await t.queue.obliterate({ force: true });
  await seedDemo(t.db);
}

export async function login(t: TestApp, email: string, role: 'user' | 'clinic' = 'user'): Promise<string> {
  const res = await t.http.post('/v1/auth/login').send({ email, password: 'demo1234', role });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.body.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 오늘(UTC)에서 n일 전 hh:mm 의 ISO 시각. n>=1 이면 미래가 되지 않는다. */
export function at(daysAgo: number, hhmm: string): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
}
export const dayOf = (daysAgo: number) => at(daysAgo, '00:00').slice(0, 10);

export const glucose = (eventId: string, measuredAt: string, mgdl: number) => ({ eventId, type: 'glucose', measuredAt, mgdl });
export const meal = (eventId: string, measuredAt: string, carbsG = 60) => ({ eventId, type: 'meal', measuredAt, carbsG, label: '식사' });
export const activity = (eventId: string, measuredAt: string) => ({ eventId, type: 'activity', measuredAt, activityType: 'walk', durationMin: 30 });

export function sendBatch(t: TestApp, token: string, events: unknown[], deviceId = 'dev-1') {
  return t.http.post('/v1/logs/batch').set(bearer(token)).send({ deviceId, events });
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 15000, stepMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** 아웃박스의 모든 행을 큐 없이 처리기에 직접 넘긴다(배경 처리 없이 소비자 로직만 검증할 때). */
export async function drainOutbox(t: TestApp): Promise<number> {
  const rows = await t.db.selectFrom('outbox').selectAll().orderBy('id').execute();
  for (const r of rows) {
    const msg: EventMessage = { outboxId: r.id, type: r.type, userId: r.user_id, payload: r.payload as EventMessage['payload'], createdAt: r.created_at.toISOString() };
    await t.handler.handle(msg);
  }
  return rows.length;
}

export const outboxMessages = async (t: TestApp): Promise<EventMessage[]> =>
  (await t.db.selectFrom('outbox').selectAll().orderBy('id').execute()).map((r) => ({
    outboxId: r.id,
    type: r.type,
    userId: r.user_id,
    payload: r.payload as EventMessage['payload'],
    createdAt: r.created_at.toISOString(),
  }));
