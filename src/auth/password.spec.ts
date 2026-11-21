import { hashPassword, verifyPassword } from './password';

describe('비밀번호 해시', () => {
  it('맞는 비밀번호만 통과한다', () => {
    const h = hashPassword('demo1234');
    expect(verifyPassword('demo1234', h)).toBe(true);
    expect(verifyPassword('demo12345', h)).toBe(false);
  });

  it('같은 비밀번호도 솔트가 달라 해시가 다르고, 깨진 형식은 거부한다', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('a'));
    expect(verifyPassword('a', 'plain')).toBe(false);
  });
});
