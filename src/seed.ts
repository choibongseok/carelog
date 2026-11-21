import { Kysely } from 'kysely';
import { hashPassword } from './auth/password';
import type { DB } from './db/types';

export const DEMO_PASSWORD = 'demo1234';

/** 데모 계정. 이미 있으면 건드리지 않는다(멱등). 합성 데이터이며 실제 사람과 무관하다. */
export async function seedDemo(db: Kysely<DB>): Promise<void> {
  const hash = hashPassword(DEMO_PASSWORD);
  await db
    .insertInto('users')
    .values(
      Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i + 1}`,
        email: `user${i + 1}@demo.test`,
        password_hash: hash,
        display_name: `사용자 ${i + 1}`,
        // user-3 은 목표 범위가 좁은 사용자(요약 계산에 사용자별 설정이 쓰이는지 보여 준다)
        ...(i === 2 ? { target_low: 80, target_high: 140 } : {}),
      })),
    )
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  await db
    .insertInto('clinics')
    .values([
      { id: 'clinic-1', name: '가상 병의원 A', email: 'clinic1@demo.test', password_hash: hash },
      { id: 'clinic-2', name: '가상 병의원 B', email: 'clinic2@demo.test', password_hash: hash },
    ])
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}
