import { Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Kysely, sql } from 'kysely';
import { APP_CONFIG, AppConfig } from '../config';
import { jsonLogger } from '../common/json-logger';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';
import { MetricsService } from '../metrics/metrics.service';
import { EVENT_QUEUE, EventMessage, HealthRecordedPayload } from '../queue/queue.module';

/**
 * 아웃박스 릴레이. 미발행 행을 잠그고(SKIP LOCKED, 여러 인스턴스가 떠도 겹치지 않음) 큐에 넣은 뒤 발행 시각을 남긴다.
 * jobId 를 outbox id 로 고정해, 큐에 넣고 표시 전에 죽어도 재발행이 큐 안에서 합쳐진다.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(EVENT_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.runBackground) return;
    this.timer = setInterval(() => void this.tick(), this.cfg.relayIntervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      // 적체가 있으면 쉬지 않고 계속 비운다.
      while (!this.stopped && (await this.relayOnce()) > 0);
    } catch (err) {
      jsonLogger.error(`outbox relay failed: ${(err as Error).message}`, undefined, 'Outbox');
    } finally {
      this.running = false;
    }
  }

  /** 한 번에 최대 limit 건 발행하고 발행한 개수를 돌려준다. */
  async relayOnce(limit = 100): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outbox')
        .selectAll()
        .where('published_at', 'is', null)
        .orderBy('id')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) return 0;
      await this.queue.addBulk(
        rows.map((r) => {
          const data: EventMessage = {
            outboxId: r.id,
            type: r.type,
            userId: r.user_id,
            payload: r.payload as HealthRecordedPayload,
            createdAt: r.created_at.toISOString(),
          };
          return { name: r.type, data, opts: { jobId: `outbox-${r.id}` } };
        }),
      );
      await trx
        .updateTable('outbox')
        .set({ published_at: sql`now()` })
        .where('id', 'in', rows.map((r) => r.id))
        .execute();
      this.metrics.outboxPublished.inc(rows.length);
      return rows.length;
    });
  }
}

@Module({ providers: [OutboxRelay], exports: [OutboxRelay] })
export class OutboxModule {}
