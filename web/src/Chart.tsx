import { Engine, TICKS_PER_DAY } from './engine/engine';
import { dayStart } from '../../src/domain/time';

const W = 720;
const H = 290;
const M = { l: 40, r: 12, t: 14, b: 28 };
const Y_MIN = 40;
const Y_MAX = 320;

/** 하루치 혈당 곡선. 수집된 기록 그대로 그리므로 오프라인으로 늦게 오는 구간은 비어 있다가 채워진다. */
export function Chart({ engine, day }: { engine: Engine; day: string }) {
  const { readings, meals, alerts } = engine.chartDay(day);
  const t0 = dayStart(day).getTime();
  const x = (ms: number) => M.l + ((ms - t0) / 86400_000) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * (H - M.t - M.b);
  // 5분 간격을 넘게 비어 있으면 선을 끊어 "아직 도착하지 않은 구간"을 보여 준다.
  let d = '';
  let prev = 0;
  for (const r of readings) {
    const ms = r.measuredAt.getTime();
    d += `${prev && ms - prev <= 6 * 60_000 ? 'L' : 'M'}${x(ms).toFixed(1)},${y(r.mgdl).toFixed(1)}`;
    prev = ms;
  }
  const nowMs = engine.now.getTime();
  const showNow = nowMs >= t0 && nowMs < t0 + 86400_000 && engine.tick > 0;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${day} 혈당 곡선. 측정 ${readings.length}회, 식사 ${meals.length}회, 알림 ${alerts.length}건`} data-testid="chart" data-points={readings.length}>
      <rect x={M.l} y={y(180)} width={W - M.l - M.r} height={y(70) - y(180)} className="band" />
      {[70, 180, 250].map((v) => (
        <g key={v}>
          <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v === 250 ? 'grid warn' : 'grid'} />
          <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="tick">{v}</text>
        </g>
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={x(t0 + h * 3600_000)} y={H - 8} textAnchor="middle" className="tick">{String(h).padStart(2, '0')}시</text>
      ))}
      {showNow && <line x1={x(nowMs)} x2={x(nowMs)} y1={M.t} y2={H - M.b} className="now" />}
      {meals.map((m) => (
        <g key={m.at.toISOString()}>
          <line x1={x(m.at.getTime())} x2={x(m.at.getTime())} y1={M.t} y2={H - M.b} className="meal" />
          <text x={x(m.at.getTime()) + 3} y={M.t + 10} className="mealtxt">{m.label}</text>
          {m.spike && (
            <g>
              <circle cx={x(m.at.getTime() + 45 * 60_000)} cy={M.t + 26} r="7" className="spike" />
              <text x={x(m.at.getTime() + 45 * 60_000)} y={M.t + 30} textAnchor="middle" className="spiketxt">↑</text>
            </g>
          )}
        </g>
      ))}
      <path d={d} className="line" />
      {alerts.map((a) => {
        const cx = x(Date.parse(a.measuredAt));
        const cy = y(a.mgdl);
        return a.kind === 'high' ? (
          <polygon key={a.eventId} points={`${cx},${cy - 7} ${cx - 6},${cy + 4} ${cx + 6},${cy + 4}`} className="pt-high"><title>고혈당 {a.mgdl}</title></polygon>
        ) : (
          <polygon key={a.eventId} points={`${cx},${cy + 7} ${cx - 6},${cy - 4} ${cx + 6},${cy - 4}`} className="pt-low"><title>저혈당 {a.mgdl}</title></polygon>
        );
      })}
      <text x={W - M.r} y={M.t + 8} textAnchor="end" className="tick">{readings.length}/{TICKS_PER_DAY - 1}회 도착</text>
    </svg>
  );
}
