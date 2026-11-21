import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { Redis } from 'ioredis';
import { jsonLogger } from '../common/json-logger';
import { KYSELY, REDIS } from '../db/db.module';
import type { DB } from '../db/types';
import { detectAlert } from '../domain/alerts';
import { evaluateJourney, JourneyEvents, PROGRAM } from '../domain/journey';
import { computeDailySummary } from '../domain/summary';
import { addDays, dayStart, utcDay, weekStartMonday } from '../domain/time';
import { MetricsService } from '../metrics/metrics.service';
import type { EventMessage } from '../queue/queue.module';
import { dailyKey, weeklyKey } from '../query/cache-keys';

export const CONSUMER_NAME = 'health-recorded';

export type HandleResult = 'ok' | 'duplicate';

/**
 * 도메인 이벤트 처리기. 한 메시지의 모든 쓰기(처리 이력·요약·알림·여정)를 하나의 트랜잭션으로 묶는다.
 * - 사용자 단위 어드바이저리 락: 같은 사용자의 계산이 겹쳐도 항상 나중 계산이 최신 데이터를 읽는다.
 * - processed_messages: 같은 메시지가 다시 와도 두 번 처리하지 않는다.
 * - 요약·여정은 저장된 기록 전체에서 다시 계산(멱등)하므로 도착 순서와 무관하다.
 */
@Injectable()
export class DomainEventHandler {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  async handle(msg: EventMessage): Promise<HandleResult> {
    const result = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${msg.userId}))`.execute(trx);
      const marked = await trx
        .insertInto('processed_messages')
        .values({ consumer: CONSUMER_NAME, outbox_id: msg.outboxId })
        .onConflict((oc) => oc.columns(['consumer', 'outbox_id']).doNothing())
        .executeTakeFirst();
      if (Number(marked.numInsertedOrUpdatedRows ?? 0) === 0) return 'duplicate' as const;

      await this.recomputeSummary(trx, msg);
      await this.createAlerts(trx, msg);
      await this.advanceJourney(trx, msg.userId);
      return 'ok' as const;
    });
    this.metrics.consumed.inc({ result });
    if (result === 'ok') await this.invalidate(msg.userId, msg.payload.day);
    return result;
  }

  private async recomputeSummary(trx: Transaction<DB>, msg: EventMessage): Promise<void> {
    const { userId, payload } = msg;
    const user = await trx.selectFrom('users').select(['target_low', 'target_high']).where('id', '=', userId).executeTakeFirstOrThrow();
    const from = dayStart(payload.day);
    const to = dayStart(addDays(payload.day, 1));
    const rows = await trx
      .selectFrom('health_events')
      .select(['kind', 'measured_at', 'glucose_mgdl'])
      .where('user_id', '=', userId)
      .where('measured_at', '>=', from)
      .where('measured_at', '<', to)
      .where('kind', 'in', ['glucose', 'meal'])
      .execute();
    const readings = rows.filter((r) => r.kind === 'glucose').map((r) => ({ measuredAt: r.measured_at, mgdl: r.glucose_mgdl as number }));
    const meals = rows.filter((r) => r.kind === 'meal').map((r) => r.measured_at);
    const s = computeDailySummary(readings, meals, { low: user.target_low, high: user.target_high });
    const values = {
      readings: s.readings,
      avg_glucose: s.avgGlucose === null ? null : String(s.avgGlucose),
      time_in_range_pct: s.timeInRangePct === null ? null : String(s.timeInRangePct),
      post_meal_spikes: s.postMealSpikes,
      meals: s.meals,
    };
    await trx
      .insertInto('daily_summaries')
      .values({ user_id: userId, day: payload.day, ...values })
      .onConflict((oc) => oc.columns(['user_id', 'day']).doUpdateSet({ ...values, updated_at: sql`now()` }))
      .execute();
  }

  private async createAlerts(trx: Transaction<DB>, msg: EventMessage): Promise<void> {
    const user = await trx.selectFrom('users').select(['alert_low', 'alert_high']).where('id', '=', msg.userId).executeTakeFirstOrThrow();
    for (const e of msg.payload.events) {
      if (e.kind !== 'glucose' || e.mgdl === null) continue;
      const kind = detectAlert(e.mgdl, { alertLow: user.alert_low, alertHigh: user.alert_high });
      if (!kind) continue;
      const created = await trx
        .insertInto('alerts')
        .values({
          user_id: msg.userId,
          event_id: e.eventId,
          kind,
          glucose_mgdl: e.mgdl,
          threshold: kind === 'low' ? user.alert_low : user.alert_high,
          measured_at: e.measuredAt,
        })
        .onConflict((oc) => oc.columns(['user_id', 'event_id']).doNothing())
        .executeTakeFirst();
      if (Number(created.numInsertedOrUpdatedRows ?? 0) > 0) {
        this.metrics.alerts.inc({ kind });
        // 실제 발송 대신 저장과 로그만 남긴다.
        jsonLogger.event('alert.created', { userId: msg.userId, kind, mgdl: e.mgdl, measuredAt: e.measuredAt }, 'Alert');
      }
    }
  }

  private async advanceJourney(trx: Transaction<DB>, userId: string): Promise<void> {
    const first = await trx.selectFrom('health_events').select(sql<Date>`min(measured_at)`.as('at')).where('user_id', '=', userId).executeTakeFirst();
    if (!first?.at) return;
    const firstDay = utcDay(new Date(first.at));
    let j = await trx.selectFrom('journeys').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!j) {
      await trx.insertInto('journeys').values({ user_id: userId, program: PROGRAM, started_on: firstDay, current_week: 1, completed_at: null }).execute();
      j = await trx.selectFrom('journeys').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
    } else if (j.current_week === 1 && firstDay < j.started_on) {
      // 1주차 중에 더 오래된 기록이 늦게 도착하면 시작일을 앞으로 당긴다.
      await trx.updateTable('journeys').set({ started_on: firstDay }).where('user_id', '=', userId).execute();
      j = { ...j, started_on: firstDay };
    }
    if (j.completed_at) return;

    const windowEnd = dayStart(addDays(j.started_on, 28));
    const rows = await trx
      .selectFrom('health_events')
      .select(['kind', 'measured_at'])
      .where('user_id', '=', userId)
      .where('measured_at', '>=', dayStart(j.started_on))
      .where('measured_at', '<', windowEnd)
      .execute();
    const ev: JourneyEvents = {
      glucose: rows.filter((r) => r.kind === 'glucose').map((r) => r.measured_at),
      meals: rows.filter((r) => r.kind === 'meal').map((r) => r.measured_at),
      activities: rows.filter((r) => r.kind === 'activity').map((r) => r.measured_at),
    };
    const res = evaluateJourney(j.started_on, j.current_week, ev);

    for (const p of res.progress) {
      await trx
        .insertInto('journey_progress')
        .values({ user_id: userId, week: p.week, mission: p.mission, value: p.value, target: p.target })
        .onConflict((oc) => oc.columns(['user_id', 'week', 'mission']).doUpdateSet({ value: p.value, target: p.target, updated_at: sql`now()` }))
        .execute();
    }
    for (const t of res.transitions) {
      await trx.insertInto('journey_transitions').values({ user_id: userId, from_week: t.from, to_week: t.to }).onConflict((oc) => oc.columns(['user_id', 'from_week']).doNothing()).execute();
      jsonLogger.event('journey.transition', { userId, from: t.from, to: t.to }, 'Journey');
    }
    if (res.transitions.length > 0 || res.completed) {
      await trx
        .updateTable('journeys')
        .set({ current_week: res.currentWeek, completed_at: res.completed ? sql`now()` : null })
        .where('user_id', '=', userId)
        .execute();
    }
  }

  /** 커밋 뒤 캐시 무효화. 실패해도 TTL 이 상한이다. */
  private async invalidate(userId: string, day: string): Promise<void> {
    try {
      await this.redis.del(dailyKey(userId, day), weeklyKey(userId, weekStartMonday(day)));
    } catch (err) {
      jsonLogger.warn(`cache invalidate failed: ${(err as Error).message}`, 'Consumer');
    }
  }
}
