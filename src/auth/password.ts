import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt$<salt hex>$<hash hex>. 데모 시드 계정용이며 외부 IdP 는 쓰지 않는다. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(plain, salt, 32).toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}
