import { Global, Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { MongoClient } from 'mongodb';
import { Pool, types } from 'pg';
import { Redis } from 'ioredis';
import { APP_CONFIG, AppConfig, loadConfig } from '../config';
import { SCHEMA_SQL } from './schema';
import type { DB } from './types';

export const KYSELY = Symbol('KYSELY');
export const MONGO = Symbol('MONGO');
export const REDIS = Symbol('REDIS');
export const PG_POOL = Symbol('PG_POOL');

// date -> 'YYYY-MM-DD' 문자열(시간대 변환 방지), bigint -> number(id 는 2^53 을 넘지 않는다)
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(20, (v: string) => Number(v));

@Injectable()
class DbLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(MONGO) private readonly mongo: MongoClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    // 동시에 여러 프로세스가 뜨는 경우를 위해 어드바이저리 락 안에서 DDL 을 적용한다.
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(727001)`.execute(trx);
      await sql.raw(SCHEMA_SQL).execute(trx);
    });
    await this.mongo.connect();
    const raw = this.mongo.db(this.cfg.mongoDb).collection('raw_events');
    await raw.createIndex({ userId: 1, receivedAt: -1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
    await this.mongo.close();
    this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => new Pool({ connectionString: cfg.databaseUrl, max: 20 }),
    },
    {
      provide: KYSELY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new Kysely<DB>({ dialect: new PostgresDialect({ pool }) }),
    },
    {
      provide: MONGO,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => new MongoClient(cfg.mongoUrl),
    },
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => new Redis(cfg.redisUrl, { maxRetriesPerRequest: null }),
    },
    DbLifecycle,
  ],
  exports: [APP_CONFIG, PG_POOL, KYSELY, MONGO, REDIS],
})
export class DbModule {}
