// ════════════════════════════════════════════════════════════════════
//  포트폴리오 시뮬레이터 탭
//
//  비중 슬라이더를 움직이면 수익률 그래프가 즉시 다시 그려집니다.
//  (데이터를 한 번 불러온 뒤에는 계산이 순식간이라 재조회가 필요 없어요)
// ════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  alignSeries, runBacktest, computeMetrics,
  correlationMatrix, annualReturns, normalizeWeights
} from '../lib/backtest.js';
import { loadHistories, parseCsvSeries } from '../lib/history.js';
import { EquityChart, DrawdownChart, CorrelationHeatmap, AnnualBars } from './Charts.jsx';

const SCENARIO_KEY = 'portfolio-scenarios-v1';
const PALETTE = ['#4FD1C5', '#FFB020', '#B18CFF', '#60A5FA', '#FF8FA3', '#3DDC97'];
const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

function pct(v, digits = 1) {
  if (!isFinite(v)) return '-';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(digits) + '%';
}
function money(v) {
  if (!isFinite(v)) return '-';
  return '$' + Math.round(v).toLocaleString('en-US');
}

// ── 성과 지표 카드 ─────────────────────────────────────────────────
function MetricCard({ label, value, color, sub, tip }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
      <div style={{ color: '#5C666F', fontSize: 10 }}>{label}</div>
      <div className="mono font-bold" style={{ color: color || '#E8ECEF', fontSize: 17, marginTop: 2 }}>
        {value}
      </div>
      {sub && <div style={{ color: '#4A535C', fontSize: 9, marginTop: 1 }}>{sub}</div>}
      {tip && <div style={{ color: '#4A535C', fontSize: 9, marginTop: 3, lineHeight: 1.4 }}>{tip}</div>}
    </div>
  );
}

// ── 비중 슬라이더 한 줄 ────────────────────────────────────────────
function WeightSlider({ ticker, name, raw, normalized, color, onChange, onRemove }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="mono font-bold" style={{ fontSize: 12 }}>{ticker}</span>
          <span className="truncate" style={{ color: '#8B96A5', fontSize: 11 }}>{name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="mono font-bold" style={{ color: '#4FD1C5', fontSize: 13 }}>
            {(normalized * 100).toFixed(1)}%
          </span>
          <button onClick={onRemove} aria-label={ticker + ' 제외'}
            style={{ color: '#5C666F', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      </div>
      <input type="range" min="0" max="100" step="1" value={raw}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color }} />
    </div>
  );
}

export default function BacktestTab({ holdings = [], phase2 = [], toast }) {
  // ── 시뮬레이션 대상 자산 목록 (내 보유종목에서 가져옴) ──
  const universe = useMemo(() => {
    const seen = new Map();
    [...holdings, ...phase2].forEach((a) => {
      if (!a.ticker) return;
      if (!seen.has(a.ticker)) {
        seen.set(a.ticker, {
          ticker: a.ticker,
          name: a.name || a.ticker,
          isCrypto: !!a.isCrypto,
          isKRW: !!a.isKRW,
          divYield: a.price > 0 ? (a.divPerShare || 0) / a.price : 0
        });
      }
    });
    return [...seen.values()];
  }, [holdings, phase2]);

  const [source, setSource] = useState('demo');
  const [years, setYears] = useState(10);
  const [rebalanceMonth, setRebalanceMonth] = useState(1);
  const [initialValue, setInitialValue] = useState(10000);
  const [useDividend, setUseDividend] = useState(false);
  const [logScale, setLogScale] = useState(false);

  const [included, setIncluded] = useState(() => universe.map((u) => u.ticker));
  const [weights, setWeights] = useState({});
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [csvData, setCsvData] = useState({});
  const [scenarios, setScenarios] = useState([]);
  const fileRef = useRef(null);

  // 보유종목이 바뀌면 대상 목록도 갱신
  useEffect(() => {
    setIncluded((prev) => {
      const valid = universe.map((u) => u.ticker);
      const kept = prev.filter((t) => valid.includes(t));
      return kept.length ? kept : valid;
    });
  }, [universe]);

  // 비중 초기값: 균등
  useEffect(() => {
    setWeights((prev) => {
      const next = { ...prev };
      included.forEach((t) => { if (next[t] == null) next[t] = 50; });
      return next;
    });
  }, [included]);

  // 저장된 시나리오 불러오기
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCENARIO_KEY);
      if (raw) setScenarios(JSON.parse(raw));
    } catch (e) { /* 무시 */ }
  }, []);

  function persistScenarios(list) {
    setScenarios(list);
    try { localStorage.setItem(SCENARIO_KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
  }

  const activeAssets = useMemo(
    () => universe.filter((u) => included.includes(u.ticker)),
    [universe, included]
  );

  const normWeights = useMemo(
    () => normalizeWeights(weights, included),
    [weights, included]
  );

  // ── 데이터 불러오기 ──
  async function handleLoad() {
    if (!activeAssets.length) {
      toast && toast('warn', '시뮬레이션할 종목이 없어요. 먼저 내 자산에 종목을 추가해 주세요');
      return;
    }
    setLoading(true);
    setErrors([]);
    try {
      const { series: s, errors: errs } = await loadHistories(activeAssets, {
        source, years, csvData, seed: 7
      });
      const usable = Object.keys(s).filter((k) => s[k] && s[k].length > 1);
      if (!usable.length) {
        setErrors(errs.length ? errs : ['불러온 데이터가 없어요']);
        setSeries(null);
      } else {
        setSeries(s);
        setErrors(errs);
        if (errs.length) toast && toast('warn', `일부 종목 실패: ${errs.length}개`);
        else toast && toast('success', `과거 데이터 ${usable.length}개 종목을 불러왔어요`);
      }
    } catch (e) {
      setErrors([e.message || '알 수 없는 오류']);
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }

  // ── 핵심: 비중이 바뀔 때마다 즉시 재계산 ──
  const result = useMemo(() => {
    if (!series) return null;
    const filtered = {};
    included.forEach((t) => { if (series[t]) filtered[t] = series[t]; });
    const aligned = alignSeries(filtered);
    if (!aligned.dates.length || aligned.tickers.length === 0) return null;

    const divYield = {};
    if (useDividend) {
      activeAssets.forEach((a) => { divYield[a.ticker] = a.divYield || 0; });
    }

    const common = {
      dates: aligned.dates, prices: aligned.prices, tickers: aligned.tickers,
      weights, initialValue, dividendYield: useDividend ? divYield : null
    };

    const rebalanced = runBacktest({ ...common, rebalanceMonth });
    const buyHold = runBacktest({ ...common, rebalanceMonth: 0 });

    const mReb = computeMetrics(rebalanced.curve, aligned.dates);
    const mBuy = computeMetrics(buyHold.curve, aligned.dates);

    return {
      aligned,
      rebalanced, buyHold,
      metrics: mReb, metricsBuyHold: mBuy,
      annual: annualReturns(rebalanced.curve, aligned.dates),
      corr: correlationMatrix(aligned.prices, aligned.tickers)
    };
  }, [series, included, weights, rebalanceMonth, initialValue, useDividend, activeAssets]);

  // ── 차트에 그릴 선들 ──
  const chartSeries = useMemo(() => {
    if (!result) return [];
    const lines = [
      { curve: result.rebalanced.curve, color: '#4FD1C5', emphasis: true, label: '현재 설정 (리밸런싱)' },
      { curve: result.buyHold.curve, color: '#5C666F', dashed: true, emphasis: false, label: '리밸런싱 없이 보유' }
    ];
    scenarios.forEach((sc, i) => {
      if (!sc.curve || sc.curve.length !== result.rebalanced.curve.length) return;
      lines.push({ curve: sc.curve, color: PALETTE[(i + 1) % PALETTE.length], emphasis: false, label: sc.name });
    });
    return lines;
  }, [result, scenarios]);

  function saveScenario() {
    if (!result) return;
    const name = `시나리오 ${scenarios.length + 1}`;
    const entry = {
      id: Date.now(),
      name,
      weights: { ...normWeights },
      rebalanceMonth,
      curve: result.rebalanced.curve,
      cagr: result.metrics.cagr,
      mdd: result.metrics.mdd,
      totalReturn: result.metrics.totalReturn,
      volatility: result.metrics.volatility
    };
    persistScenarios([...scenarios, entry].slice(-5));
    toast && toast('success', `${name} 저장됨 · 그래프에 함께 표시돼요`);
  }

  function applyPreset(kind) {
    const next = { ...weights };
    if (kind === 'equal') {
      included.forEach((t) => { next[t] = 50; });
    } else if (kind === 'current') {
      // 내 실제 보유 평가액 비중을 그대로 가져오기
      const values = {};
      let total = 0;
      [...holdings, ...phase2].forEach((a) => {
        if (!included.includes(a.ticker)) return;
        const v = (a.qty || 0) * (a.price || 0);
        values[a.ticker] = (values[a.ticker] || 0) + v;
        total += v;
      });
      if (total <= 0) {
        toast && toast('warn', '보유 수량이 입력된 종목이 없어요');
        return;
      }
      included.forEach((t) => { next[t] = Math.round(((values[t] || 0) / total) * 100); });
    }
    setWeights(next);
  }

  function handleCsvUpload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const nextCsv = { ...csvData };
    let done = 0;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        // 파일명에서 티커 추측: AAPL.csv → AAPL
        const guess = file.name.replace(/\.[^.]+$/, '').toUpperCase();
        try {
          nextCsv[guess] = parseCsvSeries(ev.target.result);
        } catch (err) {
          setErrors((p) => [...p, `${file.name}: ${err.message}`]);
        }
        done++;
        if (done === files.length) {
          setCsvData(nextCsv);
          toast && toast('success', `CSV ${Object.keys(nextCsv).length}개 준비됨 · 아래 불러오기를 눌러주세요`);
        }
      };
      reader.readAsText(file);
    });
  }

  const m = result?.metrics;
  const mb = result?.metricsBuyHold;

  return (
    <div className="space-y-5">

      {/* ── 데모 데이터 경고 ── */}
      {source === 'demo' && (
        <div className="rounded-lg p-3.5" style={{ background: '#2A2113', border: '1px solid #4A3B1F' }}>
          <div style={{ color: '#FFB020', fontSize: 12, fontWeight: 'bold' }}>⚠️ 지금은 데모(가짜) 데이터예요</div>
          <div style={{ color: '#B8C1CA', fontSize: 11, lineHeight: 1.6, marginTop: 3 }}>
            컴퓨터가 난수로 만들어낸 가상의 가격 곡선입니다. 실제 시세가 아니에요.
            기능이 어떻게 작동하는지 보는 용도이고, <b style={{ color: '#FFB020' }}>여기 나오는 수익률은
            투자 판단에 쓰면 안 됩니다.</b> 실제 데이터를 쓰려면 아래에서 소스를 바꿔주세요.
          </div>
        </div>
      )}

      {/* ── 1. 데이터 소스 ── */}
      <div className="panel rounded-lg p-5">
        <div className="text-sm font-bold mb-1">① 과거 데이터 가져오기</div>
        <div style={{ color: '#5C666F', fontSize: 11, marginBottom: 12 }}>
          백테스트는 과거 가격 기록이 필요해요. 어디서 가져올지 고르세요.
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { k: 'demo', l: '데모', d: '가짜 데이터' },
            { k: 'live', l: '실제 시세', d: '코인만 즉시' },
            { k: 'csv', l: 'CSV', d: '직접 업로드' }
          ].map((o) => (
            <button key={o.k} onClick={() => { setSource(o.k); setSeries(null); }}
              className="py-2.5 rounded-md"
              style={{
                background: source === o.k ? '#132A28' : '#161C22',
                border: '1px solid ' + (source === o.k ? '#4FD1C5' : '#1F262D'),
                color: source === o.k ? '#4FD1C5' : '#8B96A5', fontSize: 12
              }}>
              <div style={{ fontWeight: 'bold' }}>{o.l}</div>
              <div style={{ fontSize: 9, opacity: 0.75 }}>{o.d}</div>
            </button>
          ))}
        </div>

        {source === 'live' && (
          <div className="rounded-md p-3 mb-3" style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
            <div style={{ color: '#B8C1CA', fontSize: 11, lineHeight: 1.6 }}>
              <b style={{ color: '#4FD1C5' }}>코인</b>은 CoinGecko에서 바로 가져와요 (설정 불필요).<br />
              <b style={{ color: '#FFB020' }}>주식</b>은 내 Cloudflare Worker에 <span className="mono">candle</span> 엔드포인트를
              추가해야 작동해요. 방법은 함께 드린 <span className="mono">WORKER_GUIDE.md</span>에 적어뒀어요.
            </div>
          </div>
        )}

        {source === 'csv' && (
          <div className="rounded-md p-3 mb-3" style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
            <div style={{ color: '#B8C1CA', fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>
              Yahoo Finance 등에서 받은 CSV를 올려주세요. <b>파일 이름이 티커</b>가 됩니다
              (예: <span className="mono">QQQ.csv</span>). 여러 개 한 번에 선택 가능해요.
            </div>
            <button onClick={() => fileRef.current?.click()} className="w-full py-2 rounded-md"
              style={{ background: '#1A2027', color: '#4FD1C5', fontSize: 11, border: '1px solid #1F262D' }}>
              CSV 파일 선택하기
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" multiple
              onChange={handleCsvUpload} style={{ display: 'none' }} />
            {Object.keys(csvData).length > 0 && (
              <div className="mono" style={{ color: '#3DDC97', fontSize: 10, marginTop: 6 }}>
                준비됨: {Object.keys(csvData).join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div style={{ color: '#5C666F', fontSize: 10, marginBottom: 4 }}>투자 기간</div>
            <select value={years} onChange={(e) => { setYears(Number(e.target.value)); setSeries(null); }}
              className="w-full text-sm rounded px-2 py-2"
              style={{ background: '#0B0E11', border: '1px solid #1F262D', color: '#E8ECEF' }}>
              {[3, 5, 7, 10, 15, 20].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <div>
            <div style={{ color: '#5C666F', fontSize: 10, marginBottom: 4 }}>리밸런싱 시점</div>
            <select value={rebalanceMonth} onChange={(e) => setRebalanceMonth(Number(e.target.value))}
              className="w-full text-sm rounded px-2 py-2"
              style={{ background: '#0B0E11', border: '1px solid #1F262D', color: '#E8ECEF' }}>
              {MONTH_NAMES.map((mn, i) => <option key={i} value={i + 1}>매년 {mn} 초</option>)}
              <option value={0}>리밸런싱 안 함</option>
            </select>
          </div>
        </div>

        <button onClick={handleLoad} disabled={loading}
          className="w-full py-3 rounded-md font-bold"
          style={{ background: loading ? '#1A2027' : '#4FD1C5', color: loading ? '#5C666F' : '#0B0E11', fontSize: 13 }}>
          {loading ? '불러오는 중...' : series ? '데이터 다시 불러오기' : '과거 데이터 불러오기'}
        </button>

        {errors.length > 0 && (
          <div className="mt-3 rounded-md p-3" style={{ background: '#241417', border: '1px solid #4A2126' }}>
            {errors.map((er, i) => (
              <div key={i} style={{ color: '#FF8A8A', fontSize: 10, lineHeight: 1.6 }}>· {er}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. 비중 조절 ── */}
      {universe.length === 0 ? (
        <div className="panel rounded-lg p-6 text-center">
          <div style={{ fontSize: 26 }}>📊</div>
          <div className="text-sm font-bold mt-2">시뮬레이션할 종목이 없어요</div>
          <div style={{ color: '#8B96A5', fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            먼저 <b>내 자산</b> 탭에서 종목을 추가하면<br />여기서 비중을 바꿔가며 실험할 수 있어요.
          </div>
        </div>
      ) : (
        <div className="panel rounded-lg p-5">
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="text-sm font-bold">② 비중 조절</div>
            <div className="flex gap-1.5">
              <button onClick={() => applyPreset('equal')} className="px-2 py-1 rounded"
                style={{ background: '#1A2027', color: '#8B96A5', fontSize: 10 }}>균등</button>
              <button onClick={() => applyPreset('current')} className="px-2 py-1 rounded"
                style={{ background: '#1A2027', color: '#8B96A5', fontSize: 10 }}>내 실제 비중</button>
            </div>
          </div>
          <div style={{ color: '#5C666F', fontSize: 11, marginBottom: 12 }}>
            슬라이더를 움직이면 아래 그래프가 <b style={{ color: '#4FD1C5' }}>즉시</b> 다시 그려져요.
          </div>

          <div className="space-y-2">
            {activeAssets.map((a, i) => (
              <WeightSlider key={a.ticker} ticker={a.ticker} name={a.name}
                raw={weights[a.ticker] ?? 50}
                normalized={normWeights[a.ticker] ?? 0}
                color={PALETTE[i % PALETTE.length]}
                onChange={(v) => setWeights((p) => ({ ...p, [a.ticker]: v }))}
                onRemove={() => setIncluded((p) => p.filter((t) => t !== a.ticker))} />
            ))}
          </div>

          {included.length < universe.length && (
            <button onClick={() => setIncluded(universe.map((u) => u.ticker))}
              className="w-full mt-2 py-2 rounded-md"
              style={{ background: '#161C22', border: '1px dashed #2B3544', color: '#4FD1C5', fontSize: 11 }}>
              제외한 종목 다시 넣기
            </button>
          )}

          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <label className="flex items-center gap-1.5" style={{ color: '#B8C1CA', fontSize: 11 }}>
              <input type="checkbox" checked={useDividend} onChange={(e) => setUseDividend(e.target.checked)} />
              배당 재투자 근사 반영
            </label>
            <label className="flex items-center gap-1.5" style={{ color: '#B8C1CA', fontSize: 11 }}>
              <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
              로그 눈금
            </label>
          </div>
          {useDividend && (
            <div style={{ color: '#4A535C', fontSize: 9, marginTop: 4, lineHeight: 1.5 }}>
              현재 배당수익률이 과거에도 같았다고 가정한 <b>거친 근사치</b>예요. 정확하게 하려면
              배당이 반영된 수정주가(Adj Close) CSV를 쓰세요.
            </div>
          )}
        </div>
      )}

      {/* ── 3. 결과 ── */}
      {result && m && (
        <>
          <div className="panel rounded-lg p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="text-sm font-bold">③ 시뮬레이션 결과</div>
              <span className="mono" style={{ color: '#5C666F', fontSize: 10 }}>
                {result.aligned.dates[0]} ~ {result.aligned.dates[result.aligned.dates.length - 1]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <MetricCard label="총 수익률" value={pct(m.totalReturn)}
                color={m.totalReturn >= 0 ? '#3DDC97' : '#FF5C5C'}
                sub={`${money(initialValue)} → ${money(m.finalValue)}`} />
              <MetricCard label="연평균 수익률 (CAGR)" value={pct(m.cagr)}
                color={m.cagr >= 0 ? '#3DDC97' : '#FF5C5C'}
                sub={`${m.years.toFixed(1)}년 기준`} />
              <MetricCard label="최대 낙폭 (MDD)" value={pct(m.mdd)} color="#FF5C5C"
                sub={m.mddRange ? `${m.mddRange.from.slice(0, 7)} → ${m.mddRange.to.slice(0, 7)}` : ''} />
              <MetricCard label="변동성 (연율)" value={(m.volatility * 100).toFixed(1) + '%'}
                color="#FFB020" sub={`샤프 ${m.sharpe.toFixed(2)}`} />
            </div>

            <div className="rounded-md p-3 mb-4" style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
              <div style={{ color: '#8B96A5', fontSize: 11, lineHeight: 1.7 }}>
                <b style={{ color: '#E8ECEF' }}>리밸런싱 효과:</b> 매년 {MONTH_NAMES[rebalanceMonth - 1] || '—'} 리밸런싱하면
                CAGR <span className="mono" style={{ color: '#4FD1C5' }}>{pct(m.cagr)}</span>,
                안 하면 <span className="mono" style={{ color: '#8B96A5' }}>{pct(mb.cagr)}</span>.
                최대낙폭은 <span className="mono" style={{ color: '#4FD1C5' }}>{pct(m.mdd)}</span> vs
                <span className="mono" style={{ color: '#8B96A5' }}> {pct(mb.mdd)}</span>.
                <br />
                <span style={{ color: '#5C666F', fontSize: 10 }}>
                  리밸런싱은 보통 수익률을 높이기보다 <b>낙폭을 줄이는</b> 쪽으로 작동해요.
                </span>
              </div>
            </div>

            <div style={{ color: '#8B96A5', fontSize: 11, marginBottom: 4 }}>자산 성장 곡선</div>
            <EquityChart series={chartSeries} dates={result.aligned.dates} logScale={logScale} />

            <div className="flex flex-wrap gap-3 mt-2 mb-4">
              {chartSeries.map((l, i) => (
                <span key={i} className="flex items-center gap-1.5" style={{ fontSize: 10, color: '#8B96A5' }}>
                  <span style={{ width: 12, height: 2, background: l.color, display: 'inline-block' }} />
                  {l.label}
                </span>
              ))}
            </div>

            <div style={{ color: '#8B96A5', fontSize: 11, marginBottom: 4 }}>
              낙폭 추이 <span style={{ color: '#5C666F' }}>· 고점 대비 얼마나 빠져 있었는지</span>
            </div>
            <DrawdownChart drawdowns={m.drawdowns} dates={result.aligned.dates} />

            <div style={{ color: '#8B96A5', fontSize: 11, margin: '16px 0 6px' }}>연도별 수익률</div>
            <AnnualBars data={result.annual} />

            <button onClick={saveScenario} className="w-full mt-4 py-2.5 rounded-md"
              style={{ background: '#1A2027', color: '#4FD1C5', fontSize: 12, border: '1px solid #1F262D' }}>
              이 비중을 시나리오로 저장하고 비교하기
            </button>
          </div>

          {/* ── 시나리오 비교표 ── */}
          {scenarios.length > 0 && (
            <div className="panel rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold">저장한 시나리오</div>
                <button onClick={() => persistScenarios([])}
                  style={{ color: '#5C666F', fontSize: 10 }}>전체 삭제</button>
              </div>
              <div className="space-y-2">
                {scenarios.map((sc, i) => (
                  <div key={sc.id} className="rounded-md p-3"
                    style={{ background: '#0F1318', border: '1px solid #1F262D' }}>
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: PALETTE[(i + 1) % PALETTE.length] }} />
                        <span style={{ fontSize: 12, fontWeight: 'bold' }}>{sc.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => {
                          const next = {};
                          Object.keys(sc.weights).forEach((t) => { next[t] = Math.round(sc.weights[t] * 100); });
                          setWeights(next);
                          toast && toast('info', `${sc.name}의 비중을 불러왔어요`);
                        }} style={{ color: '#4FD1C5', fontSize: 10 }}>불러오기</button>
                        <button onClick={() => persistScenarios(scenarios.filter((x) => x.id !== sc.id))}
                          style={{ color: '#5C666F', fontSize: 10 }}>삭제</button>
                      </div>
                    </div>
                    <div className="flex gap-3 flex-wrap mono" style={{ fontSize: 10 }}>
                      <span style={{ color: '#3DDC97' }}>CAGR {pct(sc.cagr)}</span>
                      <span style={{ color: '#FF5C5C' }}>MDD {pct(sc.mdd)}</span>
                      <span style={{ color: '#FFB020' }}>변동성 {(sc.volatility * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ color: '#4A535C', fontSize: 9, marginTop: 4 }}>
                      {Object.keys(sc.weights).map((t) => `${t} ${(sc.weights[t] * 100).toFixed(0)}%`).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 상관관계 매트릭스 ── */}
          <div className="panel rounded-lg p-5">
            <div className="text-sm font-bold mb-1">상관관계 매트릭스</div>
            <div style={{ color: '#5C666F', fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
              두 자산이 <b style={{ color: '#FF5C5C' }}>같이 움직이면 +1</b>,
              <b style={{ color: '#4FD1C5' }}> 반대로 움직이면 -1</b>이에요.
              값이 낮은 자산끼리 묶어야 분산투자 효과가 생겨요.
              전부 빨갛다면 종목 수만 많을 뿐 실제로는 한 곳에 몰빵한 것과 비슷합니다.
            </div>
            <CorrelationHeatmap matrix={result.corr} tickers={result.aligned.tickers} />
          </div>

          {/* ── 한계 안내 ── */}
          <div className="rounded-lg p-4" style={{ background: '#161C22', border: '1px solid #4A3B1F' }}>
            <div style={{ color: '#FFB020', fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
              백테스트를 믿을 때 주의할 점
            </div>
            <div style={{ color: '#B8C1CA', fontSize: 11, lineHeight: 1.75 }}>
              <b>1. 생존 편향</b> — 지금 내 목록에 있는 종목은 이미 "살아남은" 종목이에요.
              10년 전에 이 조합을 고를 수 있었을지는 전혀 다른 문제입니다.<br />
              <b>2. CAGR은 예측이 아니에요</b> — 과거에 실제로 그랬다는 기록일 뿐,
              앞으로의 기대수익률이 아닙니다.<br />
              <b>3. 세금·수수료·환율</b>이 반영되지 않았어요. 리밸런싱할 때마다 양도세와
              거래비용이 실제로 발생합니다.<br />
              <b>4. MDD를 견딜 수 있는지</b>가 핵심이에요. -40%는 숫자로는 한 줄이지만,
              실제로 겪으면 계획을 포기하게 만드는 크기입니다.
            </div>
          </div>
        </>
      )}

      {!result && series && (
        <div className="panel rounded-lg p-5 text-center" style={{ color: '#8B96A5', fontSize: 12 }}>
          겹치는 기간이 없어요. 종목을 줄이거나 기간을 짧게 해보세요.
        </div>
      )}
    </div>
  );
}
