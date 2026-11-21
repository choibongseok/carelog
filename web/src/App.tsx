import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart } from './Chart';
import { API_BASE } from './config';
import { Engine, MAX_ATTEMPTS, START_DAY } from './engine/engine';
import { addDays } from '../../src/domain/time';

const SPEEDS = [1, 4, 16, 64];
const MISSION_LABEL: Record<string, string> = { glucose_logs: '혈당 기록', post_meal_checks: '식후 측정', activity_logs: '활동 기록' };

function readTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('carelog-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engineRef = useRef<Engine>(new Engine());
  const engine = engineRef.current;
  const [, setVersion] = useState(0);
  const [playing, setPlaying] = useState(params.get('autoplay') !== '0' && !reduced);
  const [speed, setSpeed] = useState(4);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const [viewOffset, setViewOffset] = useState(0); // 0 = 가상 오늘
  const [clinicResult, setClinicResult] = useState<string>('');
  const busy = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('carelog-theme', theme);
    } catch {
      /* 무시 */
    }
  }, [theme]);

  const act = useCallback(async (fn: () => Promise<void> | void) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
      setVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => void act(() => engine.step()), 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, act, engine]);

  const day = engine.day;
  const viewDay = addDays(day, -viewOffset);
  const summary = engine.summaryFor(viewDay);
  const tl = engine.timeline(8);
  const c = engine.counters;
  const j = engine.journey;
  const alerts = [...engine.alerts].reverse().slice(0, 6);
  const reset = () => {
    engineRef.current = new Engine();
    setViewOffset(0);
    setClinicResult('');
    setVersion((v) => v + 1);
  };

  return (
    <div className="page">
      <div className="banner" role="note" data-testid="banner">
        <strong>브라우저 시뮬레이션</strong> · 합성 데이터 · 의료 조언 아님
        {API_BASE && <span> · 라이브 백엔드({API_BASE}) 연결은 아직 구현되지 않았습니다</span>}
      </div>
      <header className="head">
        <div>
          <h1>Carelog</h1>
          <p className="lede">기록 한 줄이 요약·여정·알림이 되기까지. 서버와 같은 규칙(<code>src/domain</code>)을 브라우저에서 그대로 돌립니다.</p>
        </div>
        <div className="head-actions">
          <a href="https://github.com/choibongseok/carelog" className="link">소스 저장소</a>
          <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'dark'} data-testid="theme">
            {theme === 'dark' ? '밝은 화면' : '어두운 화면'}
          </button>
        </div>
      </header>

      <section className="controls" aria-label="시뮬레이션 조작">
        <div className="group">
          <button className="primary" onClick={() => setPlaying(!playing)} aria-pressed={playing} data-testid="play">{playing ? '일시정지' : '재생'}</button>
          <button onClick={() => void act(() => engine.step())} data-testid="step">1틱 진행(5분)</button>
          <div role="radiogroup" aria-label="속도" className="seg">
            {SPEEDS.map((s) => (
              <button key={s} role="radio" aria-checked={speed === s} onClick={() => setSpeed(s)} className={speed === s ? 'on' : ''}>{s}×</button>
            ))}
          </div>
          <span className="clock" data-testid="clock">가상 시각 {engine.now.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
        </div>
        <div className="group">
          <button onClick={() => void act(() => { engine.resendDuplicates(); })} data-testid="dup">중복 재전송</button>
          <button onClick={() => void act(() => engine.setOffline(!engine.offline))} aria-pressed={engine.offline} className={engine.offline ? 'on' : ''} data-testid="offline">
            {engine.offline ? '오프라인 중(보관 ' + engine.held.length + '묶음)' : '기기 오프라인으로'}
          </button>
          <button onClick={() => void act(() => engine.releaseHeld())} disabled={engine.held.length === 0} data-testid="release">오프라인 묶음 늦게 보내기(역순)</button>
          <button onClick={() => void act(() => engine.setFailConsumer(!engine.failConsumer))} aria-pressed={engine.failConsumer} className={engine.failConsumer ? 'on danger' : ''} data-testid="fail">
            소비자 실패 주입 {engine.failConsumer ? '켬' : '끔'}
          </button>
          <button onClick={() => void act(() => engine.replayDeadLetters())} disabled={engine.deadLetters.length === 0} data-testid="replay">dead-letter 재처리({engine.deadLetters.length})</button>
          <button onClick={() => void act(async () => { await engine.redeliver(); })} data-testid="redeliver">큐 중복 전달</button>
          <button className="ghost" onClick={reset} data-testid="reset">처음부터</button>
        </div>
      </section>

      <main className="cols">
        <div className="col">
          <section className="card" aria-labelledby="h-curve">
            <div className="card-head">
              <h2 id="h-curve">혈당 곡선 <small>{viewDay}</small></h2>
              <div className="seg" role="group" aria-label="날짜 이동">
                <button onClick={() => setViewOffset(Math.min(viewOffset + 1, Math.floor(engine.tick / 288)))} aria-label="이전 날" disabled={viewDay <= START_DAY}>◀</button>
                <button onClick={() => setViewOffset(Math.max(viewOffset - 1, 0))} aria-label="다음 날" disabled={viewOffset === 0}>▶</button>
              </div>
            </div>
            <Chart engine={engine} day={viewDay} />
            <ul className="legend">
              <li><span className="sw band-sw" />목표 범위 70–180</li>
              <li><span className="sym">┆</span>식사</li>
              <li><span className="sym spike-sym">↑</span>식후 급상승</li>
              <li><span className="sym">▲</span>고혈당 알림</li>
              <li><span className="sym">▼</span>저혈당 알림</li>
            </ul>
          </section>

          <section className="tiles" aria-label="일일 요약">
            <Tile label="평균 혈당" value={summary?.avgGlucose ?? null} unit="mg/dL" testid="t-avg" />
            <Tile label="목표 범위 내" value={summary?.timeInRangePct ?? null} unit="%" testid="t-tir" />
            <Tile label="식후 급상승" value={summary ? summary.postMealSpikes : null} unit="회" testid="t-spike" />
            <Tile label="요약 기준 측정" value={summary ? summary.readings : null} unit="회" testid="t-readings" />
          </section>
          {!summary && <p className="hint">요약은 소비자가 처리한 뒤에 나타납니다(수집된 기록과 시차가 있을 수 있어요).</p>}

          <section className="card" aria-labelledby="h-journey">
            <h2 id="h-journey">여정 <small>4주 프로그램</small></h2>
            {!j ? (
              <p className="muted">첫 기록이 처리되면 시작합니다.</p>
            ) : (
              <>
                <ol className="weeks" data-testid="weeks">
                  {[1, 2, 3, 4].map((w) => (
                    <li key={w} className={w < j.currentWeek || j.completed ? 'done' : w === j.currentWeek ? 'now' : ''} aria-current={w === j.currentWeek ? 'step' : undefined}>
                      {w}주차<span className="state">{w < j.currentWeek || j.completed ? ' 완료' : w === j.currentWeek ? ' 진행 중' : ''}</span>
                    </li>
                  ))}
                </ol>
                <div className="missions">
                  {j.progress.filter((p) => p.week === j.currentWeek).map((p) => (
                    <div key={p.mission} className="mission">
                      <div className="mrow"><span>{MISSION_LABEL[p.mission]}</span><span>{Math.min(p.value, p.target)} / {p.target}</span></div>
                      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={Math.min(p.value, p.target)} aria-label={MISSION_LABEL[p.mission]}>
                        <i style={{ width: `${Math.min(100, (p.value / p.target) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {j.transitions.length > 0 && <p className="hint" data-testid="transitions">단계 전환 {j.transitions.map((t) => `${t.from}→${t.to ?? '완료'}`).join(', ')}</p>}
              </>
            )}
          </section>

          <div className="two">
            <section className="card" aria-labelledby="h-alert">
              <h2 id="h-alert">알림 <small>저장 + 로그만, 발송 없음</small></h2>
              {alerts.length === 0 ? <p className="muted">없음</p> : (
                <ul className="list" data-testid="alerts">
                  {alerts.map((a) => (
                    <li key={a.eventId}><b className={a.kind === 'high' ? 'tag high' : 'tag low'}>{a.kind === 'high' ? '▲ 고혈당' : '▼ 저혈당'}</b> {a.mgdl} mg/dL <time>{a.measuredAt.slice(5, 16).replace('T', ' ')}</time></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card" aria-labelledby="h-tl">
              <h2 id="h-tl">타임라인 <small>측정 시각 순</small></h2>
              {tl.length === 0 ? <p className="muted">기록 없음</p> : (
                <ul className="list" data-testid="timeline">
                  {tl.map((e) => (
                    <li key={e.eventId}><b>{e.kind === 'glucose' ? `${e.glucoseMgdl} mg/dL` : e.kind === 'meal' ? `식사 ${e.mealLabel ?? ''}` : `활동 ${e.activityType}`}</b> <time>{e.measuredAt.toISOString().slice(5, 16).replace('T', ' ')}</time></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <div className="col">
          <section className="card" aria-labelledby="h-flow">
            <h2 id="h-flow">처리 파이프라인</h2>
            <ol className="flow" data-testid="flow">
              <Stage name="기기 버퍼" n={engine.bufferSize} sub={engine.offline ? `보관 ${engine.held.length}묶음` : '15분마다 전송'} warn={engine.offline} testid="s-buffer" />
              <Stage name="수집 API" n={c.stored} sub="저장(멱등)" testid="s-stored" />
              <Stage name="아웃박스" n={engine.outboxPending} sub="미발행 적체" warn={engine.outboxPending > 0} testid="s-outbox" />
              <Stage name="큐" n={engine.queue.length} sub={engine.queue.some((m) => m.attempts > 0) ? '재시도 대기 포함' : '대기'} warn={engine.queue.length > 5} testid="s-queue" />
              <Stage name="소비자" n={c.processed} sub={`처리 완료 · 평균 지연 ${engine.avgQueueDelayTicks.toFixed(1)}틱`} testid="s-consumer" />
              <Stage name="dead-letter" n={engine.deadLetters.length} sub={`${MAX_ATTEMPTS}회 실패 시`} warn={engine.deadLetters.length > 0} testid="s-dlq" />
            </ol>
            <p className="hint">소비자 결과 → 일일 요약 · 여정 · 알림. 같은 eventId 는 한 번만, 요약은 측정 시각 기준으로 다시 계산합니다.</p>
            <dl className="counters">
              <Counter k="전송한 기록" v={c.sent} id="c-sent" />
              <Counter k="저장" v={c.stored} id="c-stored" />
              <Counter k="중복 차단" v={c.duplicates} id="c-dup" />
              <Counter k="거부" v={c.rejected} id="c-rejected" />
              <Counter k="순서 역전 반영" v={c.outOfOrder} id="c-ooo" />
              <Counter k="재시도" v={c.retries} id="c-retry" />
              <Counter k="dead-letter" v={c.deadLetters} id="c-dlq" />
              <Counter k="중복 수신 건너뜀" v={c.skipped} id="c-skip" />
              <Counter k="알림 생성" v={c.alerts} id="c-alert" />
            </dl>
          </section>

          <section className="card" aria-labelledby="h-clinic">
            <h2 id="h-clinic">병의원 보기 <small>동의 기반 접근</small></h2>
            <label className="switch">
              <input type="checkbox" role="switch" checked={engine.consent} onChange={(e) => void act(() => { engine.setConsent(e.target.checked); setClinicResult(''); })} data-testid="consent" />
              <span>사용자가 이 병의원에 조회를 동의함</span>
            </label>
            <button onClick={() => void act(() => {
              const r = engine.clinicView(viewDay);
              setClinicResult(r.status === 200 ? (r.summary ? `200 · 평균 ${r.summary.avgGlucose} mg/dL, 목표 범위 ${r.summary.timeInRangePct}%, 급상승 ${r.summary.postMealSpikes}회` : '200 · 아직 요약 없음') : '404 · 환자를 찾을 수 없다(동의 없음)');
            })} data-testid="clinic-view">병의원이 {viewDay} 요약 조회</button>
            <p className="result" role="status" data-testid="clinic-result">{clinicResult || '조회 결과가 여기에 나옵니다.'}</p>
            <table className="audit" data-testid="audit">
              <caption>감사 로그(허용·거부 모두)</caption>
              <thead><tr><th>가상 시각</th><th>동작</th><th>결과</th></tr></thead>
              <tbody>
                {engine.audit.slice(-5).reverse().map((a, i) => (
                  <tr key={i}><td>{a.at}</td><td>{a.action}</td><td>{a.allowed ? '허용' : '거부'}</td></tr>
                ))}
                {engine.audit.length === 0 && <tr><td colSpan={3} className="muted">아직 없음</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="card" aria-labelledby="h-log">
            <h2 id="h-log">이벤트 로그</h2>
            <ol className="log" data-testid="log" aria-live="off">
              {[...engine.log].reverse().slice(0, 14).map((l) => (
                <li key={l.seq} className={l.level}><span className="stage">{l.stage}</span> <time>{l.at.slice(5)}</time> {l.level === 'error' ? '✕ ' : l.level === 'warn' ? '! ' : ''}{l.msg}</li>
              ))}
              {engine.log.length === 0 && <li className="muted">재생하면 로그가 쌓입니다.</li>}
            </ol>
          </section>
        </div>
      </main>
      <footer className="foot">
        브라우저 안의 메모리 시뮬레이션입니다. 서버·DB·큐에 연결되어 있지 않고 모든 데이터는 합성입니다. 의료 조언이나 진단이 아닙니다.
      </footer>
    </div>
  );
}

function Tile({ label, value, unit, testid }: { label: string; value: number | null; unit: string; testid: string }) {
  return (
    <div className="tile">
      <span className="tl">{label}</span>
      <span className="tv" data-testid={testid}>{value === null ? '—' : value}<small>{value === null ? '' : unit}</small></span>
    </div>
  );
}

function Stage({ name, n, sub, warn, testid }: { name: string; n: number; sub: string; warn?: boolean; testid: string }) {
  return (
    <li className={warn ? 'stage-box warn' : 'stage-box'}>
      <span className="sn">{name}</span>
      <span className="sv" data-testid={testid}>{n}</span>
      <span className="ss">{warn ? '⚠ ' : ''}{sub}</span>
    </li>
  );
}

function Counter({ k, v, id }: { k: string; v: number; id: string }) {
  return (
    <div className="counter">
      <dt>{k}</dt>
      <dd data-testid={id}>{v}</dd>
    </div>
  );
}
