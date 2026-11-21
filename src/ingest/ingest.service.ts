import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { MongoClient } from 'mongodb';
import { APP_CONFIG, AppConfig } from '../config';
import { jsonLogger } from '../common/json-logger';
import { KYSELY, MONGO } from '../db/db.module';
import type { DB } from '../db/types';
import { parseBatch, Rejected } from '../domain/validation';
import { utcDay } from '../domain/time';
import { MetricsService } from '../metrics/metrics.service';
import type { HealthRecordedPayload } from '../queue/queue.module';

export interface IngestResult {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: Rejected[];
}

@Injectable()
export class IngestService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(MONGO) private readonly mongo: MongoClient,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * 1) 원본을 MongoDB 에 (userId:eventId) 키로 upsert  2) 같은 PG 트랜잭션에서 정규화 행과 아웃박스 행을 함께 쓴다.
   * 1)이 성공하고 2)가 실패해도 클라이언트 재시도가 같은 키로 이어지므로 안전하다.
   */
  async ingest(userId: string, deviceId: string | undefined, events: unknown[]): Promise<IngestResult> {
    const parsed = parseBatch(events);
    this.metrics.rejected.inc(parsed.rejected.length);

    // 한 배치 안의 같은 eventId 는 첫 항목만 쓴다.
    const seen = new Set<string>();
    const unique = parsed.valid.filter((v) => (seen.has(v.event.eventId) ? false : (seen.add(v.event.eventId), true)));
    const inBatchDuplicates = parsed.valid.length - unique.length;

    if (unique.length > 0) {
      try {
        await this.mongo
          .db(this.cfg.mongoDb)
          .collection('raw_events')
          .bulkWrite(
            unique.map((v) => ({
              updateOne: {
                filter: { _id: `${userId}:${v.event.eventId}` as unknown as never },
                update: {
                  $setOnInsert: { userId, eventId: v.event.eventId, deviceId: deviceId ?? null, receivedAt: new Date(), payload: v.raw },
                  $inc: { deliveries: 1 },
                },
                upsert: true,
              },
            })),
            { ordered: false },
          );
      } catch (err) {
        jsonLogger.error(`raw store failed: ${(err as Error).message}`, undefined, 'Ingest');
        throw new ServiceUnavailableException('원본 저장소에 쓰지 못했다. 같은 요청을 다시 보내도 된다');
      }
    }

    let accepted = 0;
    if (unique.length > 0) {
      accepted = await this.db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto('health_events')
          .values(
            unique.map(({ event: e }) => ({
              user_id: userId,
              event_id: e.eventId,
              kind: e.kind,
              measured_at: e.measuredAt,
              glucose_mgdl: e.glucoseMgdl,
              carbs_g: e.carbsG,
              meal_label: e.mealLabel,
              activity_type: e.activityType,
              duration_min: e.durationMin,
            })),
          )
          .onConflict((oc) => oc.columns(['user_id', 'event_id']).doNothing())
          .returning(['event_id', 'kind', 'measured_at', 'glucose_mgdl'])
          .execute();
        if (inserted.length === 0) return 0;

        // 새로 저장된 기록만 날짜별로 묶어 아웃박스에 같은 트랜잭션으로 남긴다.
        const byDay = new Map<string, HealthRecordedPayload['events']>();
        for (const row of inserted) {
          const day = utcDay(row.measured_at);
          const list = byDay.get(day) ?? [];
          list.push({ eventId: row.event_id, kind: row.kind, measuredAt: row.measured_at.toISOString(), mgdl: row.glucose_mgdl });
          byDay.set(day, list);
          this.metrics.ingested.inc({ kind: row.kind });
        }
        await trx
          .insertInto('outbox')
          .values([...byDay].map(([day, evs]) => ({ type: 'health.recorded', user_id: userId, payload: JSON.stringify({ day, events: evs }) })))
          .execute();
        return inserted.length;
      });
    }

    const duplicates = unique.length - accepted + inBatchDuplicates;
    this.metrics.duplicates.inc(duplicates);
    jsonLogger.event('ingest', { userId, received: events.length, accepted, duplicates, rejected: parsed.rejected.length }, 'Ingest');
    return { received: events.length, accepted, duplicates, rejected: parsed.rejected };
  }
}
