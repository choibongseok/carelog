export type AlertKind = 'low' | 'high';

export interface AlertThresholds {
  alertLow: number;
  alertHigh: number;
}

/** 임계값 "미만"이면 저혈당, "초과"이면 고혈당 알림. 경계값 자체는 알리지 않는다. */
export function detectAlert(mgdl: number, t: AlertThresholds): AlertKind | null {
  if (mgdl < t.alertLow) return 'low';
  if (mgdl > t.alertHigh) return 'high';
  return null;
}
