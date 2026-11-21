import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { SCHEMA_SQL } from '../src/db/schema';
import type { DB } from '../src/db/types';
import { DEMO_PASSWORD, seedDemo } from '../src/seed';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: cfg.databaseUrl }) }) });
  try {
    await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(727001)`.execute(trx);
      await sql.raw(SCHEMA_SQL).execute(trx);
    });
    await seedDemo(db);
    console.log('시드 계정 준비 완료(합성 데이터)');
    console.log(`  사용자:  user1@demo.test … user10@demo.test  / 비밀번호 ${DEMO_PASSWORD}`);
    console.log(`  병의원:  clinic1@demo.test, clinic2@demo.test (role=clinic) / 비밀번호 ${DEMO_PASSWORD}`);
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
