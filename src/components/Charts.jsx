// ════════════════════════════════════════════════════════════════════
//  차트 컴포넌트 모음
//  기존 앱이 Sparkline/DonutChart를 직접 SVG로 그리고 있어서,
//  여기서도 새 라이브러리를 추가하지 않고 같은 방식으로 만들었어요.
// ════════════════════════════════════════════════════════════════════

const AXIS = '#2B3544';
const GRID = '#1A2027';
const MUTED = '#5C666F';

function niceNumber(v) {
  if (!isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 100000000) return (v / 100000000).toFixed(1) + '억';
  if (abs >= 10000) return Math.round(v / 10000) + '만';
  if (abs >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

// ── 여러 시나리오를 겹쳐 그리는 수익률 곡선 ────────────────────────
export function EquityChart({ series, dates, height = 240, logScale = false }) {
  const visible = (series || []).filter((s) => s.curve && s.curve.length > 1);
  if (!visible.length || !dates || dates.length < 2) {
    return (
      <div style={{ color: MUTED, fontSize: 12, padding: '32px 0', textAlign: 'center' }}>
        시뮬레이션을 실행하면 여기에 그래프가 나타나요.
      </div>
    );
  }

  const W = 720, H = height;
  const padL = 52, padR = 12, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const tf = (v) => (logScale ? Math.log(Math.max(v, 1e-9)) : v);

  let min = Infinity, max = -Infinity;
  visible.forEach((s) => s.curve.forEach((v) => {
    const t = tf(v);
    if (t < min) min = t;
    if (t > max) max = t;
  }));
  const span = max - min || 1;
  min -= span * 0.06;
  max += span * 0.06;
  const range = max - min;

  const n = visible[0].curve.length;
  const x = (i) => padL + (i / (n - 1)) * plotW;
  const y = (v) => padT + plotH - ((tf(v) - min) / range) * plotH;

  // Y축 눈금 5개
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const tVal = min + (range * i) / 4;
    const actual = logScale ? Math.exp(tVal) : tVal;
    yTicks.push({ y: padT + plotH - (i / 4) * plotH, label: niceNumber(actual) });
  }

  // X축: 연도가 바뀌는 지점
  const xTicks = [];
  let lastYear = null;
  dates.forEach((d, i) => {
    const yr = d.slice(0, 4);
    if (yr !== lastYear) { xTicks.push({ x: x(i), label: yr }); lastYear = yr; }
  });
  const stepX = Math.ceil(xTicks.length / 7);
  const shownX = xTicks.filter((_, i) => i % stepX === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={t.y} y2={t.y} stroke={GRID} strokeWidth="1" />
          <text x={padL - 6} y={t.y + 3} fill={MUTED} fontSize="9" textAnchor="end">{t.label}</text>
        </g>
      ))}
      {shownX.map((t, i) => (
        <text key={i} x={t.x} y={H - 8} fill={MUTED} fontSize="9" textAnchor="middle">{t.label}</text>
      ))}
      <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke={AXIS} strokeWidth="1" />
      <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke={AXIS} strokeWidth="1" />

      {visible.map((s, si) => {
        const pts = s.curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        return (
          <polyline key={si} points={pts} fill="none" stroke={s.color}
            strokeWidth={s.emphasis ? 2.4 : 1.6}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round" strokeLinecap="round"
            opacity={s.emphasis === false ? 0.75 : 1} />
        );
      })}
    </svg>
  );
}

// ── 낙폭(수중) 차트 — 고점 대비 얼마나 빠져 있었나 ─────────────────
export function DrawdownChart({ drawdowns, dates, height = 92, color = '#FF5C5C' }) {
  if (!drawdowns || drawdowns.length < 2) return null;
  const W = 720, H = height;
  const padL = 52, padR = 12, padT = 8, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const worst = Math.min(...drawdowns, -0.01);
  const n = drawdowns.length;
  const x = (i) => padL + (i / (n - 1)) * plotW;
  const y = (v) => padT + (v / worst) * plotH;

  const line = drawdowns.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${padL},${padT} ${line} ${padL + plotW},${padT}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <polygon points={area} fill={color} opacity="0.16" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" />
      <line x1={padL} x2={W - padR} y1={padT} y2={padT} stroke={AXIS} strokeWidth="1" />
      <text x={padL - 6} y={padT + 4} fill={MUTED} fontSize="9" textAnchor="end">0%</text>
      <text x={padL - 6} y={padT + plotH} fill={MUTED} fontSize="9" textAnchor="end">
        {(worst * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

// ── 상관관계 히트맵 ────────────────────────────────────────────────
// 빨강(+1) = 똑같이 움직임 → 분산효과 없음
// 청록(-1) = 반대로 움직임 → 분산효과 큼
function corrColor(v) {
  if (v >= 0) {
    const t = Math.min(1, v);
    const r = Math.round(26 + (255 - 26) * t);
    const g = Math.round(32 + (92 - 32) * t);
    const b = Math.round(39 + (92 - 39) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = Math.min(1, -v);
  const r = Math.round(26 + (79 - 26) * t);
  const g = Math.round(32 + (209 - 32) * t);
  const b = Math.round(39 + (197 - 39) * t);
  return `rgb(${r},${g},${b})`;
}

export function CorrelationHeatmap({ matrix, tickers }) {
  if (!matrix || !matrix.length) return null;
  const n = tickers.length;
  const labelW = 62;
  const cell = Math.max(34, Math.min(64, Math.floor(560 / n)));
  const W = labelW + cell * n;
  const H = labelW + cell * n;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={Math.max(W, 300)} height={Math.max(H, 300)}
        style={{ display: 'block', maxWidth: '100%' }}>
        {tickers.map((t, i) => (
          <text key={'c' + i} x={labelW + cell * i + cell / 2} y={labelW - 8}
            fill="#8B96A5" fontSize="10" textAnchor="middle"
            transform={n > 5 ? `rotate(-45 ${labelW + cell * i + cell / 2} ${labelW - 8})` : undefined}>
            {t.length > 8 ? t.slice(0, 7) + '…' : t}
          </text>
        ))}
        {tickers.map((t, i) => (
          <text key={'r' + i} x={labelW - 8} y={labelW + cell * i + cell / 2 + 3}
            fill="#8B96A5" fontSize="10" textAnchor="end">
            {t.length > 8 ? t.slice(0, 7) + '…' : t}
          </text>
        ))}
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <g key={`${i}-${j}`}>
              <rect x={labelW + cell * j} y={labelW + cell * i}
                width={cell - 2} height={cell - 2} rx="3" fill={corrColor(v)} />
              <text x={labelW + cell * j + (cell - 2) / 2} y={labelW + cell * i + (cell - 2) / 2 + 4}
                fill={Math.abs(v) > 0.55 ? '#0B0E11' : '#B8C1CA'}
                fontSize={cell > 44 ? '11' : '9'} textAnchor="middle" fontWeight={i === j ? 'bold' : 'normal'}>
                {v.toFixed(2)}
              </text>
            </g>
          ))
        )}
      </svg>
    </div>
  );
}

// ── 연도별 수익률 막대 ─────────────────────────────────────────────
export function AnnualBars({ data }) {
  if (!data || !data.length) return null;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.ret)), 0.01);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, height: 110 }}>
      {data.map((d) => {
        const up = d.ret >= 0;
        const h = (Math.abs(d.ret) / maxAbs) * 42;
        return (
          <div key={d.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
            <div style={{ height: 46, display: 'flex', alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}>
              {up && <div style={{ width: '72%', height: h, background: '#3DDC97', borderRadius: '2px 2px 0 0' }} />}
            </div>
            <div style={{ height: 1, width: '100%', background: AXIS }} />
            <div style={{ height: 46, display: 'flex', alignItems: 'flex-start', width: '100%', justifyContent: 'center' }}>
              {!up && <div style={{ width: '72%', height: h, background: '#FF5C5C', borderRadius: '0 0 2px 2px' }} />}
            </div>
            <div style={{ fontSize: 8, color: MUTED, marginTop: 2, whiteSpace: 'nowrap' }}>
              {String(d.year).slice(2)}
            </div>
            <div className="mono" style={{ fontSize: 8, color: up ? '#3DDC97' : '#FF5C5C' }}>
              {(d.ret * 100).toFixed(0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
