// ════════════════════════════════════════════════════════════════════
//  백테스트 계산 엔진
//
//  이 파일에는 화면(UI) 코드가 하나도 없어요. 순수하게 "숫자를 넣으면
//  숫자가 나오는" 함수만 모아뒀습니다. 이렇게 분리해두면
//  ① 계산이 맞는지 따로 테스트할 수 있고
//  ② 나중에 화면을 바꿔도 계산 로직은 건드릴 필요가 없어요.
// ════════════════════════════════════════════════════════════════════

const MONTHS_PER_YEAR = 12;

// ── 여러 종목의 시계열을 "공통 날짜"로 맞추기 ──────────────────────
// 종목마다 데이터 시작일이 다르면(예: BTC는 2013년부터, SCHD는 2011년부터)
// 겹치는 구간만 잘라내야 공정한 비교가 돼요.
export function alignSeries(seriesMap) {
  const tickers = Object.keys(seriesMap).filter(
    (t) => Array.isArray(seriesMap[t]) && seriesMap[t].length > 1
  );
  if (!tickers.length) return { dates: [], prices: {}, tickers: [] };

  let common = null;
  tickers.forEach((t) => {
    const dateSet = new Set(seriesMap[t].map((p) => p.d));
    common = common === null ? dateSet : new Set([...common].filter((d) => dateSet.has(d)));
  });

  const dates = [...common].sort();
  const prices = {};
  tickers.forEach((t) => {
    const lookup = new Map(seriesMap[t].map((p) => [p.d, p.c]));
    prices[t] = dates.map((d) => lookup.get(d));
  });
  return { dates, prices, tickers };
}

// ── 가격 배열 → 기간별 수익률 배열 ─────────────────────────────────
// [100, 110, 99] → [0.10, -0.10]
export function toReturns(priceArr) {
  const out = [];
  for (let i = 1; i < priceArr.length; i++) {
    const prev = priceArr[i - 1];
    out.push(prev > 0 ? priceArr[i] / prev - 1 : 0);
  }
  return out;
}

// ── 비중 정규화 (합이 1이 되도록) ──────────────────────────────────
export function normalizeWeights(weights, tickers) {
  const total = tickers.reduce((s, t) => s + Math.max(0, weights[t] || 0), 0);
  const out = {};
  if (total <= 0) {
    // 전부 0이면 균등 배분
    tickers.forEach((t) => { out[t] = 1 / tickers.length; });
    return out;
  }
  tickers.forEach((t) => { out[t] = Math.max(0, weights[t] || 0) / total; });
  return out;
}

// ── 핵심: 백테스트 실행 ────────────────────────────────────────────
// options:
//   rebalanceMonth : 1~12 (매년 이 달에 리밸런싱). 0이면 리밸런싱 안 함
//   initialValue   : 시작 자본
//   dividendYield  : { TICKER: 연 배당수익률(0.03 = 3%) } — 배당 재투자 근사
export function runBacktest({ dates, prices, tickers, weights, rebalanceMonth = 1, initialValue = 10000, dividendYield = null }) {
  if (!dates.length || !tickers.length) {
    return { curve: [], dates: [], rebalancePoints: [], finalValue: initialValue };
  }

  const w = normalizeWeights(weights, tickers);

  // 시작 시점에 목표 비중대로 매수
  let shares = {};
  tickers.forEach((t) => {
    const p0 = prices[t][0];
    shares[t] = p0 > 0 ? (initialValue * w[t]) / p0 : 0;
  });

  const curve = [initialValue];
  const rebalancePoints = [];
  let lastRebalanceYear = new Date(dates[0]).getFullYear();

  for (let i = 1; i < dates.length; i++) {
    // 이번 기간의 평가액 계산
    let value = 0;
    tickers.forEach((t) => { value += shares[t] * prices[t][i]; });

    // 배당 재투자 근사: 월 배당수익률만큼 평가액에 더해줌
    if (dividendYield) {
      let divAdd = 0;
      tickers.forEach((t) => {
        const y = dividendYield[t] || 0;
        divAdd += shares[t] * prices[t][i] * (y / MONTHS_PER_YEAR);
      });
      if (divAdd > 0) {
        // 더해진 배당금을 현재 비중대로 재매수한 것으로 처리
        const scale = (value + divAdd) / value;
        if (isFinite(scale) && scale > 0) {
          tickers.forEach((t) => { shares[t] *= scale; });
          value += divAdd;
        }
      }
    }

    curve.push(value);

    // 리밸런싱 판정: 매년 지정한 달의 첫 데이터 포인트에서 1회
    if (rebalanceMonth >= 1 && rebalanceMonth <= 12) {
      const dt = new Date(dates[i]);
      const month = dt.getMonth() + 1;
      const year = dt.getFullYear();
      if (month === rebalanceMonth && year > lastRebalanceYear) {
        tickers.forEach((t) => {
          const p = prices[t][i];
          shares[t] = p > 0 ? (value * w[t]) / p : 0;
        });
        rebalancePoints.push(i);
        lastRebalanceYear = year;
      }
    }
  }

  return {
    curve,
    dates,
    rebalancePoints,
    finalValue: curve[curve.length - 1],
    weights: w
  };
}

// ── 성과 지표 계산 ─────────────────────────────────────────────────
export function computeMetrics(curve, dates, periodsPerYear = MONTHS_PER_YEAR) {
  if (!curve || curve.length < 2) {
    return { totalReturn: 0, cagr: 0, mdd: 0, volatility: 0, sharpe: 0, years: 0, mddRange: null, drawdowns: [] };
  }

  const start = curve[0];
  const end = curve[curve.length - 1];
  const totalReturn = start > 0 ? end / start - 1 : 0;
  const years = (curve.length - 1) / periodsPerYear;
  const cagr = years > 0 && start > 0 ? Math.pow(end / start, 1 / years) - 1 : 0;

  // 최대낙폭 (MDD) — 고점 대비 얼마나 떨어졌는지의 최댓값
  let peak = curve[0];
  let peakIdx = 0;
  let mdd = 0;
  let mddRange = null;
  const drawdowns = [];
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] > peak) { peak = curve[i]; peakIdx = i; }
    const dd = peak > 0 ? curve[i] / peak - 1 : 0;
    drawdowns.push(dd);
    if (dd < mdd) {
      mdd = dd;
      mddRange = { from: dates[peakIdx], to: dates[i], fromIdx: peakIdx, toIdx: i };
    }
  }

  // 변동성 (연율화 표준편차)
  const rets = toReturns(curve);
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length > 1 ? rets.length - 1 : 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(periodsPerYear);

  // 샤프 지수 (무위험수익률 0 가정) — 위험 1단위당 얼마나 벌었나
  const sharpe = volatility > 0 ? cagr / volatility : 0;

  return { totalReturn, cagr, mdd, volatility, sharpe, years, mddRange, drawdowns, finalValue: end };
}

// ── 연도별 수익률 ──────────────────────────────────────────────────
export function annualReturns(curve, dates) {
  const byYear = new Map();
  for (let i = 0; i < curve.length; i++) {
    const y = new Date(dates[i]).getFullYear();
    if (!byYear.has(y)) byYear.set(y, { first: curve[i], last: curve[i] });
    else byYear.get(y).last = curve[i];
  }
  const out = [];
  let prevLast = null;
  [...byYear.keys()].sort().forEach((y) => {
    const rec = byYear.get(y);
    const base = prevLast === null ? rec.first : prevLast;
    out.push({ year: y, ret: base > 0 ? rec.last / base - 1 : 0 });
    prevLast = rec.last;
  });
  return out;
}

// ── 상관관계 매트릭스 ──────────────────────────────────────────────
// 두 자산이 같이 움직이면 +1, 반대로 움직이면 -1, 무관하면 0.
// 분산투자 효과를 보려면 이 값이 낮은 자산끼리 묶는 게 좋아요.
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

export function correlationMatrix(prices, tickers) {
  const rets = {};
  tickers.forEach((t) => { rets[t] = toReturns(prices[t]); });
  const matrix = tickers.map((rowT) =>
    tickers.map((colT) => (rowT === colT ? 1 : pearson(rets[rowT], rets[colT])))
  );
  return matrix;
}

// ── 월 단위로 다운샘플링 (일별 데이터 → 월말 종가) ─────────────────
export function toMonthly(series) {
  const byMonth = new Map();
  series.forEach((p) => {
    const key = p.d.slice(0, 7); // "2024-03"
    const prev = byMonth.get(key);
    if (!prev || p.d >= prev.d) byMonth.set(key, p);
  });
  return [...byMonth.keys()].sort().map((k) => byMonth.get(k));
}
