import { MAX_BATCH, parseBatch } from './validation';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const glucose = (over: Record<string, unknown> = {}) => ({ eventId: 'g-1', type: 'glucose', measuredAt: '2026-11-10T11:55:00Z', mgdl: 110, ...over });

describe('수집 검증', () => {
  it('혈당·식사·활동 이벤트를 정규화한다', () => {
    const p = parseBatch(
      [
        glucose(),
        { eventId: 'm-1', type: 'meal', measuredAt: '2026-11-10T11:00:00Z', carbsG: 60, label: '점심' },
        { eventId: 'a-1', type: 'activity', measuredAt: '2026-11-10T10:00:00Z', activityType: 'walk', durationMin: 30 },
      ],
      NOW,
    );
    expect(p.rejected).toEqual([]);
    expect(p.valid.map((v) => v.event.kind)).toEqual(['glucose', 'meal', 'activity']);
    expect(p.valid[0].event.glucoseMgdl).toBe(110);
    expect(p.valid[1].event.carbsG).toBe(60);
    expect(p.valid[2].event.durationMin).toBe(30);
  });

  it('잘못된 항목만 거부하고 나머지는 받는다', () => {
    const p = parseBatch([glucose(), glucose({ eventId: 'g-2', mgdl: 'abc' }), 'x', glucose({ eventId: 'g-3' })], NOW);
    expect(p.valid.map((v) => v.event.eventId)).toEqual(['g-1', 'g-3']);
    expect(p.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(p.rejected[0].eventId).toBe('g-2');
  });

  it('미래 시각과 30일보다 오래된 시각은 거부한다', () => {
    const p = parseBatch([glucose({ measuredAt: '2026-11-10T12:10:00Z' }), glucose({ eventId: 'g-2', measuredAt: '2026-10-01T00:00:00Z' }), glucose({ eventId: 'g-3', measuredAt: '2026-11-10T12:04:00Z' })], NOW);
    expect(p.valid.map((v) => v.event.eventId)).toEqual(['g-3']);
    expect(p.rejected).toHaveLength(2);
  });

  it('eventId 형식이 틀리면 거부한다', () => {
    const p = parseBatch([glucose({ eventId: '' }), glucose({ eventId: 'a b' }), glucose({ eventId: 'x'.repeat(65) }), glucose({ eventId: 5 })], NOW);
    expect(p.valid).toHaveLength(0);
    expect(p.rejected).toHaveLength(4);
  });

  it('혈당 값이 범위(20~600) 밖이거나 정수가 아니면 거부한다', () => {
    const p = parseBatch([glucose({ mgdl: 19 }), glucose({ eventId: 'b', mgdl: 601 }), glucose({ eventId: 'c', mgdl: 100.5 }), glucose({ eventId: 'd', mgdl: 20 })], NOW);
    expect(p.valid.map((v) => v.event.eventId)).toEqual(['d']);
  });

  it('활동 기록은 종류와 시간이 필요하다', () => {
    const base = { eventId: 'a', type: 'activity', measuredAt: '2026-11-10T10:00:00Z' };
    const p = parseBatch([base, { ...base, eventId: 'b', activityType: 'run' }, { ...base, eventId: 'c', activityType: 'run', durationMin: 20 }], NOW);
    expect(p.valid.map((v) => v.event.eventId)).toEqual(['c']);
  });

  it('events 가 배열이 아니면 예외를 던진다', () => {
    expect(() => parseBatch({}, NOW)).toThrow();
    expect(MAX_BATCH).toBe(500);
  });
});
