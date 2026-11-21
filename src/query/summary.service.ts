import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Redis } from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config';
import { jsonLogger } from '../common/json-logger';
import { KYSELY, REDIS } from '../db/db.module';
import type { DB } from '../db/types';
import { combineWeekly, DayRow, WeeklySummary } from '../domain/summary';
import { addDays } from '../domain/time';
import { MetricsService } from '../metrics/metrics.service';
import { dailyKey, weeklyKey } from './cache-keys';

export interface DailySummaryView extends DayRow {
  updatedAt: string | null;
}

/** 일일·주간 요약 조회. Redis 에 TTL 캐시하고, 소비자가 갱신하면 무효화한다. */
@Injectable()
export class SummaryService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit) {
        this.metrics.cache.inc({ result: 'hit' });
        return JSON.parse(hit) as T;
      }
    } catch (err) {
      jsonLogger.warn(`cache read failed: ${(err as Error).message}`, 'Summary');
    }
    this.metrics.cache.inc({ result: 'miss' });
    const value = await load();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.cfg.summaryCacheTtlSec);
    } catch (err) {
      jsonLogger.warn(`cache write failed: ${(err as Error).message}`, 'Summary');
    }
    return value;
  }

  daily(userId: string, day: string): Promise<DailySummaryView> {
    return this.cached(dailyKey(userId, day), async () => {
      const r = await this.db.selectFrom('daily_summaries').selectAll().where('user_id', '=', userId).where('day', '=', day).executeTakeFirst();
      if (!r) return { day, readings: 0, avgGlucose: null, timeInRangePct: null, postMealSpikes: 0, meals: 0, updatedAt: null };
      return {
        day,
        readings: r.readings,
        avgGlucose: r.avg_glucose === null ? null : Number(r.avg_glucose),
        timeInRangePct: r.time_in_range_pct === null ? null : Number(r.time_in_range_pct),
        postMealSpikes: r.post_meal_spikes,
        meals: r.meals,
        updatedAt: r.updated_at.toISOString(),
      };
    });
  }

  weekly(userId: string, weekStart: string): Promise<WeeklySummary> {
    return this.cached(weeklyKey(userId, weekStart), async () => {
      const rows = await this.db
        .selectFrom('daily_summaries')
        .selectAll()
        .where('user_id', '=', userId)
        .where('day', '>=', weekStart)
        .where('day', '<', addDays(weekStart, 7))
        .orderBy('day')
        .execute();
      const days: DayRow[] = rows.map((r) => ({
        day: r.day,
        readings: r.readings,
        avgGlucose: r.avg_glucose === null ? null : Number(r.avg_glucose),
        timeInRangePct: r.time_in_range_pct === null ? null : Number(r.time_in_range_pct),
        postMealSpikes: r.post_meal_spikes,
        meals: r.meals,
      }));
      return combineWeekly(weekStart, days);
    });
  }
}
