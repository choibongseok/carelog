/**
 * 가상 연속혈당측정기(CGM)와 식사·활동 기록을 만들어 수집 API 로 보낸다.
 * 중복 재전송, 늦게 도착하는 묶음, 순서 역전, 잘못된 값을 일부러 섞는다.
 * 같은 SEED 로 다시 실행하면 같은 eventId 를 보내므로 전부 중복으로 차단되어야 한다.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:53100';
const EMAIL = process.env.SIM_EMAIL ?? 'user1@demo.test';
const DAYS = Number(process.env.SIM_DAYS ?? 3);
const SEED = Number(process.env.SEED ?? 42);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev {
  eventId: string;
  type: 'glucose' | 'meal' | 'activity';
  measuredAt: string;
  [k: string]: unknown;
}

interface SummaryBody {
  readings: number;
  avgGlucose: number | null;
  timeInRangePct: number | null;
  postMealSpikes: number;
}
interface WeeklyBody extends SummaryBody {
  weekStart: string;
}
interface Mission {
  week: number;
  mission: string;
  value: number;
  target: number;
  done: boolean;
}
interface JourneyBody {
  enrolled: boolean;
  currentWeek?: number;
  totalWeeks?: number;
  transitions?: unknown[];
  missions?: Mission[];
}

async function api<T = Record<string, never>>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

const MEALS = [
  { h: 7.5, label: '아침', carbs: 50, rise: 55 },
  { h: 12.5, label: '점심', carbs: 70, rise: 75 },
  { h: 19, label: '저녁', carbs: 90, rise: 160 }, // 마지막 날 저녁은 고혈당 알림을 만들 만큼 크게 오른다
];

function generate(userKey: string): { events: Ev[]; glucoseCount: number } {
  const rand = rng(SEED);
  const events: Ev[] = [];
  let glucoseCount = 0;
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  for (let d = DAYS; d >= 1; d--) {
    const day0 = midnight.getTime() - d * 86400_000;
    const lastDay = d === 1;
    for (const m of MEALS) {
      const t = day0 + m.h * 3600_000;
      events.push({ eventId: `sim-${userKey}-meal-${t}`, type: 'meal', measuredAt: new Date(t).toISOString(), carbsG: m.carbs, label: m.label });
    }
    events.push({ eventId: `sim-${userKey}-act-${day0}`, type: 'activity', measuredAt: new Date(day0 + 17 * 3600_000).toISOString(), activityType: 'walk', durationMin: 30 });
    for (let i = 0; i < 288; i++) {
      const t = day0 + i * 5 * 60_000;
      const hour = i / 12;
      let v = 105 + 8 * Math.sin((2 * Math.PI * hour) / 24) + (rand() - 0.5) * 8;
      for (const m of MEALS) {
        const dt = hour - m.h; // 식사 후 경과 시간(h)
        if (dt > 0 && dt < 3) v += (m.rise * (lastDay || m.h < 19 ? 1 : 0.5) * (dt / 0.75) * Math.exp(1 - dt / 0.75)) / 1;
      }
      if (lastDay && hour >= 3 && hour <= 3.5) v = 52 + (rand() - 0.5) * 4; // 야간 저혈당
      events.push({ eventId: `sim-${userKey}-cgm-${t}`, type: 'glucose', measuredAt: new Date(t).toISOString(), mgdl: Math.round(Math.min(Math.max(v, 40), 400)) });
      glucoseCount++;
    }
  }
  return { events, glucoseCount };
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function main(): Promise<void> {
  const rand = rng(SEED + 1);
  const login = await api<{ accessToken: string; id: string }>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: 'demo1234' }) });
  if (login.status !== 200) throw new Error(`로그인 실패(${login.status}). make seed 를 먼저 실행했는지 확인`);
  const token: string = login.body.accessToken;
  const userId: string = login.body.id;

  const { events, glucoseCount } = generate(userId);
  const unique = events.length;

  // 1) 일부(약 8%)는 한 번 더 보낸다. 2) 시간 순 묶음 중 20%는 맨 뒤로 미룬다(오프라인 뒤늦은 동기화). 3) 묶음 안에서 일부는 뒤집는다.
  const dupes = events.filter(() => rand() < 0.08);
  const invalid: unknown[] = [
    { eventId: 'sim-bad-1', type: 'glucose', measuredAt: new Date().toISOString(), mgdl: 9999 },
    { eventId: 'sim bad 2', type: 'glucose', measuredAt: new Date().toISOString(), mgdl: 100 },
    { eventId: 'sim-bad-3', type: 'sleep', measuredAt: new Date().toISOString() },
  ];
  const batches = chunk([...events, ...dupes], 100);
  const onTime = batches.filter(() => rand() >= 0.2);
  const late = batches.filter((b) => !onTime.includes(b));
  const order = [...onTime, ...late].map((b, i) => (i % 3 === 1 ? [...b].reverse() : b));
  order[0] = [...order[0], ...(invalid as Ev[])];

  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  for (const b of order) {
    const r = await api<{ accepted: number; duplicates: number; rejected: unknown[] }>('/v1/logs/batch', { method: 'POST', token, body: JSON.stringify({ deviceId: 'sim-cgm-1', events: b }) });
    if (r.status !== 200) throw new Error(`수집 실패 ${r.status}: ${JSON.stringify(r.body)}`);
    accepted += r.body.accepted;
    duplicates += r.body.duplicates;
    rejected += r.body.rejected.length;
  }
  console.log(`전송: 고유 ${unique}건(혈당 ${glucoseCount}) + 재전송 ${dupes.length}건 + 잘못된 값 ${invalid.length}건, ${order.length}개 묶음(${late.length}개는 늦게, 일부는 역순)`);
  console.log(`수집 결과: 저장 ${accepted}, 중복 차단 ${duplicates}, 거부 ${rejected}`);

  // 소비자가 처리할 때까지 마지막 날 요약이 채워지길 기다린다.
  const lastDay = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const expectLast = events.filter((e) => e.type === 'glucose' && e.measuredAt.startsWith(lastDay)).length;
  let summary: SummaryBody = { readings: 0, avgGlucose: null, timeInRangePct: null, postMealSpikes: 0 };
  for (let i = 0; i < 120; i++) {
    summary = (await api<SummaryBody>(`/v1/me/summary/daily?date=${lastDay}`, { token })).body;
    if (summary.readings >= expectLast) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const journey = (await api<JourneyBody>('/v1/me/journey', { token })).body;
  const alerts = (await api<{ kind: string; mgdl: number }[]>('/v1/me/alerts', { token })).body;
  const weekly = (await api<WeeklyBody>(`/v1/me/summary/weekly?date=${lastDay}`, { token })).body;

  console.log(`\n일일 요약 ${lastDay}: 측정 ${summary.readings}회, 평균 ${summary.avgGlucose} mg/dL, 목표 범위 ${summary.timeInRangePct}%, 식후 급상승 ${summary.postMealSpikes}회`);
  console.log(`주간 요약 ${weekly.weekStart}~: 측정 ${weekly.readings}회, 평균 ${weekly.avgGlucose} mg/dL, 목표 범위 ${weekly.timeInRangePct}%`);
  console.log(`여정: ${journey.enrolled ? `${journey.currentWeek}/${journey.totalWeeks}주차, 전환 ${journey.transitions?.length ?? 0}회` : '미가입'}`);
  for (const m of (journey.missions ?? []).filter((x) => x.week === journey.currentWeek)) console.log(`  - ${m.mission}: ${m.value}/${m.target}${m.done ? ' 완료' : ''}`);
  console.log(`알림: 저혈당 ${alerts.filter((a) => a.kind === 'low').length}건, 고혈당 ${alerts.filter((a) => a.kind === 'high').length}건`);

  const problems: string[] = [];
  if (summary.readings < expectLast) problems.push(`요약이 채워지지 않음(${summary.readings}/${expectLast})`);
  if (!journey.enrolled) problems.push('여정이 만들어지지 않음');
  if (alerts.length === 0) problems.push('알림이 만들어지지 않음');
  if (problems.length) {
    console.error(`\n실패: ${problems.join(', ')}`);
    process.exit(1);
  }
  console.log('\n시뮬레이션 확인 완료');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
