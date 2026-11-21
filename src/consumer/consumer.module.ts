import { Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Kysely } from 'kysely';
import { APP_CONFIG, AppConfig } from '../config';
import { jsonLogger } from '../common/json-logger';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';
import { MetricsService } from '../metrics/metrics.service';
import { EventMessage, redisConnection } from '../queue/queue.module';
import { DomainEventHandler } from './handler';

/**
 * BullMQ 워커. 실패하면 큐가 지수 백오프로 재시도하고, 시도를 모두 소진하면 dead_letters 에 남긴다.
 */
@Injectable()
export class EventConsumer implements OnModuleInit, OnApplicationShutdown {
  private worker?: Worker<EventMessage>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly handler: DomainEventHandler,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.runBackground) return;
    this.worker = new Worker<EventMessage>(this.cfg.queueName, (job) => this.process(job), {
      connection: redisConnection(this.cfg.redisUrl),
      concurrency: 8,
    });
    this.worker.on('failed', (job, err) => void this.onFailed(job, err));
    this.worker.on('error', (err) => jsonLogger.error(`worker error: ${err.message}`, undefined, 'Consumer'));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<EventMessage>): Promise<void> {
    this.metrics.queueDelay.observe(Math.max(0, Date.now() - Date.parse(job.data.createdAt)) / 1000);
    await this.handler.handle(job.data);
  }

  private async onFailed(job: Job<EventMessage> | undefined, err: Error): Promise<void> {
    this.metrics.consumerFailures.inc();
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    jsonLogger.event('consumer.failed', { outboxId: job.data.outboxId, attempt: job.attemptsMade, of: attempts, error: err.message }, 'Consumer');
    if (job.attemptsMade < attempts) return;
    try {
      await this.db
        .insertInto('dead_letters')
        .values({ outbox_id: job.data.outboxId, queue: this.cfg.queueName, reason: err.message.slice(0, 500), attempts: job.attemptsMade, payload: JSON.stringify(job.data) })
        .execute();
      this.metrics.deadLetters.inc();
    } catch (e) {
      jsonLogger.error(`dead letter write failed: ${(e as Error).message}`, undefined, 'Consumer');
    }
  }
}

@Module({ providers: [DomainEventHandler, EventConsumer], exports: [DomainEventHandler] })
export class ConsumerModule {}
