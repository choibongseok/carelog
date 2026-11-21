/**
 * 브라우저용 메모리 엔진. 서버와 같은 규칙을 따르되 저장소·큐는 메모리 구조다.
 * 요약·여정·알림 판정·수집 검증은 서버의 src/domain 을 그대로 import 한다(규칙을 다시 쓰지 않는다).
 */
import { detectAlert } from '../../../src/domain/alerts';
import { evaluateJourney, JourneyEvents, MissionProgress, PROGRAM } from '../../../src/domain/journey';
import { computeDailySummary, DailySummary, isPostMealSpike } from '../../../src/domain/summary';
import { addDays, dayStart, utcDay } from '../../../src/domain/time';
import { NormalizedEvent, parseBatch, Rejected } from '../../../src/domain/validation';

export const TICK_MIN = 5;
export const TICKS_PER_DAY = 288;
export const START_DAY = '2026-11-02';
export const MAX_ATTEMPTS = 3;
const RANGE = { low: 70, high: 180 };
const ALERT = { alertLow: 70, alertHigh: 250 };
const BATCH_EVERY_TICKS = 3;

export interface RawEvent {
  eventId: string;
  type: 'glucose' | 'meal' | 'activity';
  measuredAt: string;
  [k: string]: unknown;
}

export interface OutboxMsg {
  id: number;
  day: string;
  events: { eventId: string; kind: string; measuredAt: string; mgdl: number | null }[];
  createdTick: number;
  published: boolean;
}

export interface QueueMsg {
  outboxId: number;
  day: string;
  events: OutboxMsg['events'];
  attempts: number;
  availableTick: number;
  enqueuedTick: number;
  lastError?: string;
}

export interface LogLine {
  seq: number;
  at: string; // 가상 시각
  stage: '기기' | '수집' | '아웃박스' | '큐' | '소비자' | '병의원' | '조작';
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface Counters {
  sent: number;
  stored: number;
  duplicates: number;
  rejected: number;
  outOfOrder: number;
  published: number;
  processed: number;
  skipped: number;
  retries: number;
  deadLetters: number;
  alerts: number;
}

export interface AlertRow {
  eventId: string;
  kind: 'low' | 'high';
  mgdl: number;
  measuredAt: string;
}

export interface JourneyState {
  startedOn: string;
  currentWeek: number;
  completed: boolean;
  progress: MissionProgress[];
  transitions: { from: number; to: number | null; at: string }[];
}

export interface AuditRow {
  at: string;
  action: string;
  allowed: boolean;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: Rejected[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEALS = [
  { h: 7.5, label: '아침', carbs: 50, rise: 55 },
  { h: 12.5, label: '점심', carbs: 70, rise: 75 },
  { h: 19, label: '저녁', carbs: 90, rise: 90 },
];

export class Engine {
  readonly seed: number;
  tick = 0;
  failConsumer = false;
  offline = false;
  consent = true;

  private rand: () => number;
  private store = new Map<string, NormalizedEvent>();
  private maxMeasured = 0;
  private buffer: RawEvent[] = [];
  private sent: RawEvent[] = [];
  held: RawEvent[][] = [];
  outbox: OutboxMsg[] = [];
  queue: QueueMsg[] = [];
  deadLetters: QueueMsg[] = [];
  private processed = new Set<number>();
  private lastProcessed?: QueueMsg;
  private outboxSeq = 0;
  private seq = 0;
  private summaries = new Map<string, DailySummary>();
  alerts: AlertRow[] = [];
  private alertKeys = new Set<string>();
  journey: JourneyState | null = null;
  audit: AuditRow[] = [];
  log: LogLine[] = [];
  counters: Counters = { sent: 0, stored: 0, duplicates: 0, rejected: 0, outOfOrder: 0, published: 0, processed: 0, skipped: 0, retries: 0, deadLetters: 0, alerts: 0 };
  private delaySumTicks = 0;
  private delayCount = 0;

  constructor(seed = 7) {
    this.seed = seed;
    this.rand = mulberry32(seed);
  }

  /** 가상 시계: 시작일 00:00 UTC 에서 tick 마다 5분. */
  get now(): Date {
    return new Date(dayStart(START_DAY).getTime() + this.tick * TICK_MIN * 60_000);
  }
  get day(): string {
    return utcDay(this.now);
  }

  private note(stage: LogLine['stage'], msg: string, level: LogLine['level'] = 'info'): void {
    this.log.push({ seq: ++this.seq, at: this.now.toISOString().slice(0, 16).replace('T', ' '), stage, level, msg });
    if (this.log.length > 200) this.log.shift();
  }

  // ---------- 기기 ----------
  private glucoseAt(t: Date): number {
    const dayIdx = Math.floor((t.getTime() - dayStart(START_DAY).getTime()) / 86400_000);
    const hour = t.getUTCHours() + t.getUTCMinutes() / 60;
    let v = 105 + 8 * Math.sin((2 * Math.PI * hour) / 24) + (this.rand() - 0.5) * 8;
    for (const m of MEALS) {
      const dt = hour - m.h;
      const rise = m.label === '저녁' && dayIdx % 3 === 0 ? 160 : m.rise;
      if (dt > 0 && dt < 3) v += rise * (dt / 0.75) * Math.exp(1 - dt / 0.75);
    }
    if (dayIdx % 3 === 1 && hour >= 3 && hour <= 3.5) v = 52 + (this.rand() - 0.5) * 4;
    return Math.round(Math.min(Math.max(v, 40), 400));
  }

  /** 가상 시계를 한 칸(5분) 진행하고 기기 기록을 만들며 파이프라인을 한 번 돌린다. */
  async step(): Promise<void> {
    this.tick++;
    const t = this.now;
    const ms = t.getTime();
    this.buffer.push({ eventId: `cgm-${ms}`, type: 'glucose', measuredAt: t.toISOString(), mgdl: this.glucoseAt(t) });
    const hour = t.getUTCHours() + t.getUTCMinutes() / 60;
    for (const m of MEALS) {
      if (hour === m.h) {
        this.buffer.push({ eventId: `meal-${ms}`, type: 'meal', measuredAt: t.toISOString(), carbsG: m.carbs, label: m.label });
      }
    }
    if (t.getUTCHours() === 17 && t.getUTCMinutes() === 0) {
      this.buffer.push({ eventId: `act-${ms}`, type: 'activity', measuredAt: t.toISOString(), activityType: 'walk', durationMin: 30 });
    }
    if (this.tick % BATCH_EVERY_TICKS === 0) await this.flush();
    await this.pump();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.sent.push(...batch);
    if (this.sent.length > 120) this.sent.splice(0, this.sent.length - 120);
    if (this.offline) {
      this.held.push(batch);
      this.note('기기', `오프라인: ${batch.length}건을 기기에 보관(묶음 ${this.held.length}개)`, 'warn');
      return;
    }
    this.counters.sent += batch.length;
    this.ingest(batch);
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  // ---------- 수집(멱등) ----------
  /** 서버의 IngestService 와 같은 규칙: 검증 → 같은 eventId 는 한 번 → 저장과 아웃박스를 함께 기록. */
  ingest(events: RawEvent[]): IngestResult {
    const parsed = parseBatch(events, this.now);
    this.counters.rejected += parsed.rejected.length;
    const seen = new Set<string>();
    let duplicates = 0;
    const fresh: NormalizedEvent[] = [];
    for (const v of parsed.valid) {
      const id = v.event.eventId;
      if (seen.has(id) || this.store.has(id)) {
        duplicates++;
        continue;
      }
      seen.add(id);
      fresh.push(v.event);
    }
    let late = 0;
    for (const e of fresh) {
      this.store.set(e.eventId, e);
      const ms = e.measuredAt.getTime();
      if (ms < this.maxMeasured) late++;
      else this.maxMeasured = ms;
    }
    const byDay = new Map<string, OutboxMsg['events']>();
    for (const e of fresh) {
      const d = utcDay(e.measuredAt);
      const l = byDay.get(d) ?? [];
      l.push({ eventId: e.eventId, kind: e.kind, measuredAt: e.measuredAt.toISOString(), mgdl: e.glucoseMgdl });
      byDay.set(d, l);
    }
    for (const [day, evs] of byDay) this.outbox.push({ id: ++this.outboxSeq, day, events: evs, createdTick: this.tick, published: false });
    this.counters.stored += fresh.length;
    this.counters.duplicates += duplicates;
    this.counters.outOfOrder += late;
    this.note('수집', `받음 ${events.length}건 → 저장 ${fresh.length}, 중복 차단 ${duplicates}, 거부 ${parsed.rejected.length}${late ? `, 순서 역전 반영 ${late}` : ''}`, duplicates || parsed.rejected.length ? 'warn' : 'info');
    return { accepted: fresh.length, duplicates, rejected: parsed.rejected };
  }

  // ---------- 아웃박스 → 큐 → 소비자 ----------
  relay(): number {
    const rows = this.outbox.filter((r) => !r.published);
    for (const r of rows) {
      r.published = true;
      this.queue.push({ outboxId: r.id, day: r.day, events: r.events, attempts: 0, availableTick: this.tick, enqueuedTick: this.tick });
    }
    this.counters.published += rows.length;
    if (rows.length) this.note('아웃박스', `${rows.length}행을 큐로 발행`);
    return rows.length;
  }

  async consume(limit = 10): Promise<void> {
    const ready = this.queue.filter((m) => m.availableTick <= this.tick).slice(0, limit);
    for (const msg of ready) {
      try {
        if (this.failConsumer) throw new Error('주입된 소비자 실패');
        await this.handle(msg);
        this.queue = this.queue.filter((m) => m !== msg);
      } catch (err) {
        msg.attempts++;
        msg.lastError = (err as Error).message;
        this.counters.retries++;
        if (msg.attempts >= MAX_ATTEMPTS) {
          this.queue = this.queue.filter((m) => m !== msg);
          this.deadLetters.push(msg);
          this.counters.deadLetters++;
          this.note('큐', `메시지 #${msg.outboxId}: ${MAX_ATTEMPTS}회 모두 실패 → dead-letter`, 'error');
        } else {
          msg.availableTick = this.tick + 2 ** (msg.attempts - 1);
          this.note('큐', `메시지 #${msg.outboxId}: 실패(${msg.attempts}/${MAX_ATTEMPTS}) → ${2 ** (msg.attempts - 1)}틱 뒤 재시도`, 'warn');
        }
      }
    }
  }

  async pump(): Promise<void> {
    this.relay();
    await this.consume();
  }

  /** 서버의 DomainEventHandler 와 같은 순서: 처리 이력 확인 → 요약 재계산 → 알림 → 여정. */
  private async handle(msg: QueueMsg): Promise<void> {
    if (this.processed.has(msg.outboxId)) {
      this.counters.skipped++;
      this.note('소비자', `메시지 #${msg.outboxId}: 이미 처리함 → 건너뜀`);
      return;
    }
    this.processed.add(msg.outboxId);
    this.delaySumTicks += this.tick - msg.enqueuedTick;
    this.delayCount++;
    this.summaries.set(msg.day, this.computeSummary(msg.day));
    let newAlerts = 0;
    for (const e of msg.events) {
      if (e.kind !== 'glucose' || e.mgdl === null) continue;
      const kind = detectAlert(e.mgdl, ALERT);
      if (!kind || this.alertKeys.has(e.eventId)) continue;
      this.alertKeys.add(e.eventId);
      this.alerts.push({ eventId: e.eventId, kind, mgdl: e.mgdl, measuredAt: e.measuredAt });
      newAlerts++;
    }
    this.counters.alerts += newAlerts;
    const before = this.journey?.currentWeek;
    await this.advanceJourney();
    this.counters.processed++;
    this.lastProcessed = msg;
    this.note('소비자', `메시지 #${msg.outboxId}: ${msg.day} 요약 갱신${newAlerts ? `, 알림 ${newAlerts}건` : ''}${this.journey && before !== undefined && this.journey.currentWeek !== before ? `, 여정 ${before}→${this.journey.currentWeek}주차` : ''}`);
  }

  private eventsOn(day: string): NormalizedEvent[] {
    const from = dayStart(day).getTime();
    const to = dayStart(addDays(day, 1)).getTime();
    return [...this.store.values()].filter((e) => e.measuredAt.getTime() >= from && e.measuredAt.getTime() < to);
  }

  private computeSummary(day: string): DailySummary {
    const evs = this.eventsOn(day);
    const readings = evs.filter((e) => e.kind === 'glucose').map((e) => ({ measuredAt: e.measuredAt, mgdl: e.glucoseMgdl as number }));
    return computeDailySummary(readings, evs.filter((e) => e.kind === 'meal').map((e) => e.measuredAt), RANGE);
  }

  private async advanceJourney(): Promise<void> {
    const all = [...this.store.values()];
    if (all.length === 0) return;
    const firstDay = utcDay(new Date(Math.min(...all.map((e) => e.measuredAt.getTime()))));
    if (!this.journey) this.journey = { startedOn: firstDay, currentWeek: 1, completed: false, progress: [], transitions: [] };
    else if (this.journey.currentWeek === 1 && firstDay < this.journey.startedOn) this.journey.startedOn = firstDay;
    const j = this.journey;
    if (j.completed) return;
    const ev: JourneyEvents = {
      glucose: all.filter((e) => e.kind === 'glucose').map((e) => e.measuredAt),
      meals: all.filter((e) => e.kind === 'meal').map((e) => e.measuredAt),
      activities: all.filter((e) => e.kind === 'activity').map((e) => e.measuredAt),
    };
    const res = await evaluateJourney(j.startedOn, j.currentWeek, ev);
    for (const p of res.progress) {
      const i = j.progress.findIndex((x) => x.week === p.week && x.mission === p.mission);
      if (i >= 0) j.progress[i] = p;
      else j.progress.push(p);
    }
    for (const t of res.transitions) {
      if (!j.transitions.some((x) => x.from === t.from)) j.transitions.push({ ...t, at: this.now.toISOString() });
    }
    j.currentWeek = res.currentWeek;
    j.completed = res.completed;
  }

  // ---------- 조작 ----------
  /** 최근에 보낸 기록 20건을 같은 eventId 로 다시 보낸다(재전송). */
  resendDuplicates(n = 20): IngestResult {
    const batch = this.sent.slice(-n);
    this.counters.sent += batch.length;
    this.note('조작', `최근 ${batch.length}건을 같은 eventId 로 재전송`);
    return this.ingest(batch);
  }

  setOffline(on: boolean): void {
    this.offline = on;
    this.note('조작', on ? '기기 오프라인: 이후 기록은 기기에 보관' : '기기 온라인 복귀');
  }

  /** 보관한 묶음을 역순(최신 묶음부터)으로 보낸다: 순서 역전 도착. */
  async releaseHeld(): Promise<void> {
    const batches = [...this.held].reverse();
    this.held = [];
    this.offline = false;
    this.note('조작', `보관한 ${batches.length}개 묶음을 역순으로 전송`);
    for (const b of batches) {
      this.counters.sent += b.length;
      this.ingest(b);
    }
    await this.pump();
  }

  setFailConsumer(on: boolean): void {
    this.failConsumer = on;
    this.note('조작', on ? '소비자 실패 주입 켬' : '소비자 실패 주입 끔', on ? 'warn' : 'info');
  }

  /** dead-letter 를 큐로 되돌려 다시 처리한다. */
  async replayDeadLetters(): Promise<void> {
    const dl = this.deadLetters;
    this.deadLetters = [];
    for (const m of dl) this.queue.push({ ...m, attempts: 0, availableTick: this.tick, enqueuedTick: this.tick });
    this.note('조작', `dead-letter ${dl.length}건을 큐로 재처리`);
    await this.pump();
  }

  /** 큐가 같은 메시지를 한 번 더 전달하는 경우(at-least-once). */
  async redeliver(): Promise<boolean> {
    if (!this.lastProcessed) return false;
    this.queue.push({ ...this.lastProcessed, attempts: 0, availableTick: this.tick, enqueuedTick: this.tick });
    this.note('조작', `메시지 #${this.lastProcessed.outboxId} 를 큐가 다시 전달`);
    await this.pump();
    return true;
  }

  setConsent(on: boolean): void {
    this.consent = on;
    this.note('병의원', on ? '사용자가 병의원 조회에 동의' : '사용자가 동의를 철회(즉시 차단)', on ? 'info' : 'warn');
  }

  /** 병의원이 일일 요약을 조회. 동의 여부는 매번 확인하고 허용·거부 모두 감사 로그에 남긴다. */
  clinicView(day: string): { status: 200; summary: DailySummary | null } | { status: 404 } {
    const allowed = this.consent;
    this.audit.push({ at: this.now.toISOString().slice(0, 16).replace('T', ' '), action: `일일 요약 조회 ${day}`, allowed });
    this.note('병의원', allowed ? `요약 조회 허용(200) ${day}` : '요약 조회 거부(404): 동의 없음', allowed ? 'info' : 'warn');
    return allowed ? { status: 200, summary: this.summaries.get(day) ?? null } : { status: 404 };
  }

  // ---------- 조회 ----------
  summaryFor(day: string): DailySummary | null {
    return this.summaries.get(day) ?? null;
  }

  /** 저장된 기록의 하루치(차트용). 소비자와 무관하게 수집된 기록 그대로다. */
  chartDay(day: string) {
    const evs = this.eventsOn(day).sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
    const readings = evs.filter((e) => e.kind === 'glucose').map((e) => ({ measuredAt: e.measuredAt, mgdl: e.glucoseMgdl as number }));
    const meals = evs.filter((e) => e.kind === 'meal').map((e) => ({ at: e.measuredAt, label: e.mealLabel ?? '식사', spike: isPostMealSpike(e.measuredAt, readings) }));
    return { readings, meals, alerts: this.alerts.filter((a) => a.measuredAt.startsWith(day)) };
  }

  timeline(n = 8) {
    return [...this.store.values()].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()).slice(0, n);
  }

  get storedCount(): number {
    return this.store.size;
  }
  get outboxPending(): number {
    return this.outbox.filter((r) => !r.published).length;
  }
  get avgQueueDelayTicks(): number {
    return this.delayCount ? this.delaySumTicks / this.delayCount : 0;
  }
  get journeyStart(): string {
    return PROGRAM;
  }
}
