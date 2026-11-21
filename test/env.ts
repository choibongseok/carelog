// 통합·e2e 테스트는 개발용 DB 와 분리된 데이터베이스·큐를 쓴다.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://carelog:carelog@localhost:55432/carelog_test';
process.env.MONGO_URL = process.env.TEST_MONGO_URL ?? 'mongodb://localhost:55017';
process.env.MONGO_DB = 'carelog_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1';
process.env.QUEUE_NAME = 'domain-events-test';
process.env.JWT_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'silent';
process.env.RELAY_INTERVAL_MS = '50';
process.env.JOB_ATTEMPTS = '3';
process.env.JOB_BACKOFF_MS = '20';
