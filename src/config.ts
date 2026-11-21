export interface AppConfig {
  port: number;
  databaseUrl: string;
  mongoUrl: string;
  mongoDb: string;
  redisUrl: string;
  jwtSecret: string;
  relayIntervalMs: number;
  queueName: string;
  jobAttempts: number;
  jobBackoffMs: number;
  summaryCacheTtlSec: number;
  runBackground: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** 환경 변수에서 설정을 읽는다. 테스트는 env.ts 에서 별도 DB·큐 이름을 지정한다. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' ? Number(v) : d);
  return {
    port: num(env.PORT, 3100),
    databaseUrl: env.DATABASE_URL ?? 'postgres://carelog:carelog@localhost:55432/carelog',
    mongoUrl: env.MONGO_URL ?? 'mongodb://localhost:55017',
    mongoDb: env.MONGO_DB ?? 'carelog',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:56379',
    jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
    relayIntervalMs: num(env.RELAY_INTERVAL_MS, 500),
    queueName: env.QUEUE_NAME ?? 'domain-events',
    jobAttempts: num(env.JOB_ATTEMPTS, 5),
    jobBackoffMs: num(env.JOB_BACKOFF_MS, 1000),
    summaryCacheTtlSec: num(env.SUMMARY_CACHE_TTL_SEC, 60),
    runBackground: env.RUN_BACKGROUND !== 'false',
  };
}
