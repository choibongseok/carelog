import { detectAlert } from './alerts';

const T = { alertLow: 70, alertHigh: 250 };

describe('알림 판정', () => {
  it('임계 미만은 low, 초과는 high 로 판정한다', () => {
    expect(detectAlert(54, T)).toBe('low');
    expect(detectAlert(300, T)).toBe('high');
    expect(detectAlert(120, T)).toBeNull();
  });

  it('경계값 자체는 알리지 않는다', () => {
    expect(detectAlert(70, T)).toBeNull();
    expect(detectAlert(250, T)).toBeNull();
    expect(detectAlert(69, T)).toBe('low');
    expect(detectAlert(251, T)).toBe('high');
  });

  it('사용자별 임계값을 따른다', () => {
    expect(detectAlert(65, { alertLow: 60, alertHigh: 200 })).toBeNull();
    expect(detectAlert(210, { alertLow: 60, alertHigh: 200 })).toBe('high');
  });
});
