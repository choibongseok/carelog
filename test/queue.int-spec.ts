import { Injectable } from '@nestjs/common';
import { DomainEventHandler, HandleResult } from '../src/consumer/handler';
import type { EventMessage } from '../src/queue/queue.module';
import { at, bearer, createTestApp, dayOf, glucose, login, resetAll, sendBatch, TestApp, waitFor } from './helpers';

/** 항상 실패하는 처리기: 재시도와 dead-letter 경로를 검증한다. */
@Injectable()
class AlwaysFailing extends DomainEventHandler {
  static calls = 0;
  override async handle(_msg: EventMessage): Promise<HandleResult> {
    AlwaysFailing.calls++;
    throw new Error('boom');
  }
}

/** 처음 두 번만 실패하는 처리기. */
@Injectable()
class FailsTwice extends DomainEventHandler {
  static calls = 0;
  override async handle(msg: EventMessage): Promise<HandleResult> {
    if (++FailsTwice.calls <= 2) throw new Error('transient');
    return super.handle(msg);
  }
}

describe('큐 재시도와 dead-letter', () => {
  it('소비자가 계속 실패하면 재시도 횟수만큼 시도하고 dead_letters 에 남긴다', async () => {
    AlwaysFailing.calls = 0;
    const t: TestApp = await createTestApp({ handler: AlwaysFailing });
    try {
      const token = await login(t, 'user1@demo.test');
      await sendBatch(t, token, [glucose('g1', at(1, '08:00'), 100)]);
      const dead = await waitFor(async () => (await t.db.selectFrom('dead_letters').selectAll().execute())[0]);
      expect(AlwaysFailing.calls).toBe(3); // JOB_ATTEMPTS=3
      expect(dead).toMatchObject({ attempts: 3, reason: 'boom', queue: t.cfg.queueName });
      const metrics = (await t.http.get('/metrics')).text;
      expect(metrics).toMatch(/carelog_consumer_failures_total 3/);
      expect(metrics).toMatch(/carelog_dead_letters_total 1/);
    } finally {
      await t.close();
    }
  });

  it('일시적으로 실패해도 재시도로 성공하면 dead-letter 로 가지 않고 한 번만 반영된다', async () => {
    FailsTwice.calls = 0;
    const t: TestApp = await createTestApp({ handler: FailsTwice });
    try {
      const token = await login(t, 'user1@demo.test');
      await sendBatch(t, token, [glucose('g1', at(1, '08:00'), 40)]);
      await waitFor(async () => (await t.http.get(`/v1/me/summary/daily?date=${dayOf(1)}`).set(bearer(token))).body.readings === 1);
      expect(FailsTwice.calls).toBe(3);
      expect(await t.db.selectFrom('dead_letters').selectAll().execute()).toHaveLength(0);
      expect(await t.db.selectFrom('alerts').selectAll().execute()).toHaveLength(1);
      await resetAll(t);
    } finally {
      await t.close();
    }
  });
});
