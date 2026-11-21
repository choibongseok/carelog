import { decodeCursor, encodeCursor } from './cursor';
import { addDays, isDay, weekStartMonday } from './time';

describe('커서', () => {
  it('인코딩한 커서를 그대로 복원한다', () => {
    const c = { at: '2026-11-02T08:00:00.000Z', id: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('잘못된 커서는 null 을 돌려준다', () => {
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"at":"x","id":1}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"at":"2026-11-02T00:00:00Z","id":"1"}').toString('base64url'))).toBeNull();
  });
});

describe('날짜 도우미', () => {
  it('주 시작은 월요일이다', () => {
    expect(weekStartMonday('2026-11-02')).toBe('2026-11-02'); // 월
    expect(weekStartMonday('2026-11-08')).toBe('2026-11-02'); // 일
    expect(weekStartMonday('2026-11-09')).toBe('2026-11-09');
  });

  it('날짜 문자열을 엄격하게 검증한다', () => {
    expect(isDay('2026-11-02')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-1-2')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
