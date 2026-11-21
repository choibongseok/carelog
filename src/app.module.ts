import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ClinicController } from './clinic/clinic.controller';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ConsumerModule } from './consumer/consumer.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { IngestModule } from './ingest/ingest.module';
import { MetricsModule } from './metrics/metrics.module';
import { OutboxModule } from './outbox/outbox.relay';
import { QueueModule } from './queue/queue.module';
import { MeController } from './query/me.controller';
import { SummaryService } from './query/summary.service';

@Module({ controllers: [MeController, ClinicController], providers: [SummaryService], exports: [SummaryService] })
class QueryModule {}

@Module({
  imports: [DbModule, MetricsModule, QueueModule, AuthModule, IngestModule, OutboxModule, ConsumerModule, QueryModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
