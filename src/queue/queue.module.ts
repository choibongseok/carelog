import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config';

export const EVENT_QUEUE = Symbol('EVENT_QUEUE');

export interface EventMessage {
  outboxId: number;
  type: string;
  userId: string;
  payload: HealthRecordedPayload;
  createdAt: string; // 아웃박스 행 생성 시각(ISO). 큐 지연 측정용
}

export interface HealthRecordedPayload {
  day: string; // 영향받은 UTC 날짜(측정 시각 기준)
  events: { eventId: string; kind: 'glucose' | 'meal' | 'activity'; measuredAt: string; mgdl: number | null }[];
}

/** redis://[:pw@]host:port[/db] 를 BullMQ 연결 옵션으로 바꾼다. */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject(EVENT_QUEUE) private readonly queue: Queue) {}
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EVENT_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        new Queue(cfg.queueName, {
          connection: redisConnection(cfg.redisUrl),
          defaultJobOptions: {
            attempts: cfg.jobAttempts,
            backoff: { type: 'exponential', delay: cfg.jobBackoffMs },
            removeOnComplete: { age: 3600, count: 5000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        }),
    },
    QueueLifecycle,
  ],
  exports: [EVENT_QUEUE],
})
export class QueueModule {}
