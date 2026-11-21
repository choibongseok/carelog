import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { KYSELY } from '../db/db.module';
import type { DB } from '../db/types';

/** 인스턴스마다 자기 Registry 를 가진다(테스트에서 앱을 여러 번 띄워도 충돌하지 않는다). */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly ingested = new Counter({ name: 'carelog_events_ingested_total', help: '새로 저장된 기록 수', labelNames: ['kind'], registers: [this.registry] });
  readonly duplicates = new Counter({ name: 'carelog_events_duplicate_total', help: '멱등 키로 차단한 중복 기록 수', registers: [this.registry] });
  readonly rejected = new Counter({ name: 'carelog_events_rejected_total', help: '검증 실패로 거부한 기록 수', registers: [this.registry] });
  readonly alerts = new Counter({ name: 'carelog_alerts_total', help: '생성한 알림 수', labelNames: ['kind'], registers: [this.registry] });
  readonly outboxPending = new Gauge({
    name: 'carelog_outbox_pending',
    help: '아직 큐로 발행되지 않은 아웃박스 행 수',
    registers: [this.registry],
    collect: async () => {
      const row = await this.db.selectFrom('outbox').select(sql<number>`count(*)::int`.as('n')).where('published_at', 'is', null).executeTakeFirstOrThrow();
      this.outboxPending.set(row.n);
    },
  });
  readonly outboxPublished = new Counter({ name: 'carelog_outbox_published_total', help: '큐로 발행한 아웃박스 행 수', registers: [this.registry] });
  readonly queueDelay = new Histogram({
    name: 'carelog_queue_delay_seconds',
    help: '아웃박스 기록 시각부터 소비자 처리 시작까지 걸린 시간',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });
  readonly consumed = new Counter({ name: 'carelog_consumer_processed_total', help: '소비자 처리 결과', labelNames: ['result'], registers: [this.registry] });
  readonly consumerFailures = new Counter({ name: 'carelog_consumer_failures_total', help: '소비자 처리 실패(재시도 포함)', registers: [this.registry] });
  readonly deadLetters = new Counter({ name: 'carelog_dead_letters_total', help: '재시도를 모두 소진해 dead-letter 로 보낸 메시지 수', registers: [this.registry] });
  readonly cache = new Counter({ name: 'carelog_summary_cache_total', help: '요약 캐시 조회 결과', labelNames: ['result'], registers: [this.registry] });
  readonly httpDuration = new Histogram({
    name: 'carelog_http_request_duration_seconds',
    help: 'HTTP 요청 처리 시간',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {
    collectDefaultMetrics({ register: this.registry });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
