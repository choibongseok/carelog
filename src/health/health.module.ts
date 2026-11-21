import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Kysely, sql } from 'kysely';
import { MongoClient } from 'mongodb';
import { Redis } from 'ioredis';
import { KYSELY, MONGO, REDIS } from '../db/db.module';
import type { DB } from '../db/types';

async function probe(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
    return 'up';
  } catch {
    return 'down';
  }
}

@ApiTags('ops')
@Controller('health')
class HealthController {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(MONGO) private readonly mongo: MongoClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'PostgreSQL·MongoDB·Redis 연결 상태' })
  async check() {
    const [postgres, mongo, redis] = await Promise.all([
      probe(() => sql`select 1`.execute(this.db)),
      probe(() => this.mongo.db('admin').command({ ping: 1 })),
      probe(() => this.redis.ping()),
    ]);
    const body = { status: postgres === 'up' && mongo === 'up' && redis === 'up' ? 'ok' : 'degraded', postgres, mongo, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
