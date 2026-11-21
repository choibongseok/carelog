export type EventKind = 'glucose' | 'meal' | 'activity';

export interface NormalizedEvent {
  eventId: string;
  kind: EventKind;
  measuredAt: Date;
  glucoseMgdl: number | null;
  carbsG: number | null;
  mealLabel: string | null;
  activityType: string | null;
  durationMin: number | null;
}

export interface Rejected {
  index: number;
  eventId: string | null;
  reason: string;
}

export interface ParsedBatch {
  valid: { index: number; raw: Record<string, unknown>; event: NormalizedEvent }[];
  rejected: Rejected[];
}

export const MAX_BATCH = 500;
const MAX_AGE_MS = 30 * 24 * 3600_000; // 오프라인 동기화 허용 기간
const MAX_FUTURE_MS = 5 * 60_000; // 기기 시계 오차 허용
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function normalize(o: Record<string, unknown>, now: Date): NormalizedEvent | string {
  if (typeof o.eventId !== 'string' || !ID_RE.test(o.eventId)) return 'eventId 형식 오류(1~64자 영숫자 . _ : -)';
  if (o.type !== 'glucose' && o.type !== 'meal' && o.type !== 'activity') return 'type 은 glucose|meal|activity';
  if (typeof o.measuredAt !== 'string') return 'measuredAt(ISO 8601 문자열) 필요';
  const at = new Date(o.measuredAt);
  if (Number.isNaN(at.getTime())) return 'measuredAt 해석 불가';
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS) return 'measuredAt 이 미래';
  if (at.getTime() < now.getTime() - MAX_AGE_MS) return 'measuredAt 이 30일보다 오래됨';
  const base: NormalizedEvent = {
    eventId: o.eventId,
    kind: o.type,
    measuredAt: at,
    glucoseMgdl: null,
    carbsG: null,
    mealLabel: null,
    activityType: null,
    durationMin: null,
  };
  if (o.type === 'glucose') {
    if (!isInt(o.mgdl, 20, 600)) return 'mgdl 은 20~600 정수';
    return { ...base, glucoseMgdl: o.mgdl };
  }
  if (o.type === 'meal') {
    if (o.carbsG !== undefined && !isInt(o.carbsG, 0, 500)) return 'carbsG 는 0~500 정수';
    if (o.label !== undefined && (typeof o.label !== 'string' || o.label.length > 64)) return 'label 은 64자 이하 문자열';
    return { ...base, carbsG: (o.carbsG as number | undefined) ?? null, mealLabel: (o.label as string | undefined) ?? null };
  }
  if (typeof o.activityType !== 'string' || o.activityType.length < 1 || o.activityType.length > 32) return 'activityType 은 1~32자 문자열';
  if (!isInt(o.durationMin, 1, 600)) return 'durationMin 은 1~600 정수';
  return { ...base, activityType: o.activityType, durationMin: o.durationMin };
}

/** 배치의 각 항목을 검증한다. 잘못된 항목만 거부하고 나머지는 받는다. */
export function parseBatch(events: unknown, now: Date = new Date()): ParsedBatch {
  const out: ParsedBatch = { valid: [], rejected: [] };
  if (!Array.isArray(events)) throw new Error('events 는 배열이어야 한다');
  events.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      out.rejected.push({ index, eventId: null, reason: '객체가 아님' });
      return;
    }
    const o = raw as Record<string, unknown>;
    const r = normalize(o, now);
    if (typeof r === 'string') {
      out.rejected.push({ index, eventId: typeof o.eventId === 'string' ? o.eventId.slice(0, 64) : null, reason: r });
    } else {
      out.valid.push({ index, raw: o, event: r });
    }
  });
  return out;
}
