// 수집 API 부하 스크립트(고정 도착률). 사용: BASE_URL=http://localhost:53100 k6 run load/ingest.js
import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:53100';
const VUS = Number(__ENV.VUS || 20);
const BATCH = Number(__ENV.BATCH || 20);
const accepted = new Counter('carelog_accepted_events');
const dupes = new Counter('carelog_duplicate_events');

// 고정 도착률로 부하를 건다. 한 요청은 혈당 BATCH 건이며, 측정 시각은 최근 3일에 흩어진다(오프라인 동기화처럼).
const RATE = Number(__ENV.RATE || 100);
export const options = {
  scenarios: {
    ingest: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: VUS,
      maxVUs: VUS * 4,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const ACCOUNTS = [4, 5, 6, 7, 8, 9, 10].map((n) => `user${n}@demo.test`);

export function setup() {
  const tokens = ACCOUNTS.map((email) => {
    const res = http.post(`${BASE}/v1/auth/login`, JSON.stringify({ email, password: 'demo1234' }), { headers: { 'content-type': 'application/json' } });
    if (res.status !== 200) fail(`로그인 실패 ${email}: ${res.status} (make seed 필요)`);
    return res.json('accessToken');
  });
  // 실행마다 다른 접두사를 써서, 다시 돌려도 새 기록으로 들어가게 한다.
  return { tokens, run: Date.now() };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const now = Date.now();
  const events = [];
  for (let i = 0; i < BATCH; i++) {
    events.push({
      eventId: `k6-${data.run}-${__VU}-${__ITER}-${i}`,
      type: 'glucose',
      measuredAt: new Date(now - 60_000 - Math.floor(Math.random() * 3 * 86400_000)).toISOString(),
      mgdl: 80 + Math.floor(Math.random() * 100),
    });
  }
  // 약 10% 는 직전 반복이 새로 보낸 ID(인덱스 5 이후)를 다시 보낸다(재전송).
  if (__ITER > 0) {
    for (let i = 0; i < Math.floor(BATCH / 10); i++) {
      events[i] = { ...events[i], eventId: `k6-${data.run}-${__VU}-${__ITER - 1}-${i + 5}` };
    }
  }
  const res = http.post(`${BASE}/v1/logs/batch`, JSON.stringify({ deviceId: `k6-${__VU}`, events }), {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
  check(res, { '200': (r) => r.status === 200 });
  if (res.status === 200) {
    accepted.add(res.json('accepted'));
    dupes.add(res.json('duplicates'));
  }
}
