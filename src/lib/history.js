// ════════════════════════════════════════════════════════════════════
//  과거 시세 데이터 공급 모듈
//
//  백테스트에는 "과거 몇 년치" 시계열이 필요한데, 앱의 다른 곳에서 쓰는
//  Finnhub quote/metric 엔드포인트는 "오늘 가격 하나"만 줍니다.
//  그래서 이 모듈은 아래 4가지 소스를 갈아끼울 수 있게 만들었습니다.
//  이 중 실제 시세인 것과 아닌 것을 구분해서 봐주세요.
//
//   1) demo   — [가짜] 컴퓨터가 난수로 만든 곡선. 실제 시세 아님, 기능 확인용.
//   2) crypto — [실제] CoinGecko 과거 시세. 코인만 해당, 바로 작동.
//   3) proxy  — [실제] 내 Cloudflare Worker의 candle 엔드포인트. 주식 대상,
//               배포 완료되어 바로 작동 (Stooq 기반 · 월별 · 배당 미반영).
//   4) csv    — [실제] 직접 받은 CSV 파일 업로드. Yahoo Finance의
//               Adj Close를 쓰면 배당까지 반영된 가장 정확한 값이 돼요.
// ════════════════════════════════════════════════════════════════════

import { toMonthly } from './backtest.js';

const PROXY_URL = 'https://finnhub-proxy.seowonhaha.workers.dev';
const CLIENT_KEY = '1639a4b7aff5f79e5b199673a1be278773127eea3490c344';

const CRYPTO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2', LINK: 'chainlink'
};

// ════════════════════════════════════════════════════════════════════
//  1) 데모(합성) 데이터 생성기
//
//  ⚠️⚠️ 이것은 실제 시세가 아닙니다. 컴퓨터가 난수로 만든 가짜 곡선이에요.
//  기능이 어떻게 돌아가는지 눈으로 보려는 용도이지,
//  이걸로 나온 수익률은 아무 의미가 없습니다.
// ════════════════════════════════════════════════════════════════════

// 시드 기반 난수 (같은 시드 → 항상 같은 결과, 재현 가능하게)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 균등난수 → 정규분포 난수 (Box-Muller 변환)
function normalRandom(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 자산 성격별 가상 프로파일 (연 기대수익률 / 연 변동성 / 시장민감도)
// 실제 종목의 과거 수치가 아니라, "이런 성격의 자산이면 대충 이런 느낌"이라는
// 교육용 설정값입니다.
const DEMO_PROFILES = {
  QQQ:  { mu: 0.12, sigma: 0.20, beta: 1.15 },
  VOO:  { mu: 0.10, sigma: 0.15, beta: 1.00 },
  SPY:  { mu: 0.10, sigma: 0.15, beta: 1.00 },
  SCHD: { mu: 0.09, sigma: 0.14, beta: 0.85 },
  SCHG: { mu: 0.12, sigma: 0.19, beta: 1.10 },
  NVDA: { mu: 0.22, sigma: 0.45, beta: 1.60 },
  TSLA: { mu: 0.18, sigma: 0.55, beta: 1.50 },
  AAPL: { mu: 0.14, sigma: 0.27, beta: 1.10 },
  MSFT: { mu: 0.13, sigma: 0.24, beta: 1.00 },
  KO:   { mu: 0.07, sigma: 0.14, beta: 0.55 },
  O:    { mu: 0.07, sigma: 0.18, beta: 0.70 },
  BTC:  { mu: 0.30, sigma: 0.70, beta: 1.20 },
  ETH:  { mu: 0.30, sigma: 0.85, beta: 1.30 }
};
const DEFAULT_PROFILE = { mu: 0.08, sigma: 0.22, beta: 1.0 };

function profileFor(ticker) {
  return DEMO_PROFILES[String(ticker).toUpperCase()] || DEFAULT_PROFILE;
}

// 문자열 → 안정적인 숫자 시드
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 여러 종목을 한 번에 만들어야 "상관관계"가 생깁니다.
// 공통 시장 요인 + 종목 고유 요인으로 나눠서 생성해요.
export function generateDemoSeries(tickers, years = 10, seed = 7) {
  const months = Math.round(years * 12);
  const marketRnd = mulberry32(seed);
  const marketMu = 0.09 / 12;
  const marketSigma = 0.15 / Math.sqrt(12);

  // 공통 시장 수익률
  const marketRets = [];
  for (let i = 0; i < months; i++) {
    marketRets.push(marketMu + marketSigma * normalRandom(marketRnd));
  }

  const endDate = new Date();
  endDate.setDate(1);
  const dates = [];
  for (let i = months; i >= 0; i--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth() - i + 1, 0);
    dates.push(d.toISOString().slice(0, 10));
  }

  const out = {};
  tickers.forEach((t) => {
    const prof = profileFor(t);
    const rnd = mulberry32(hashSeed(t) ^ seed);
    // 고유 변동성 = 전체 변동성에서 시장 설명분을 뺀 나머지
    const idioVar = Math.max(
      0,
      (prof.sigma / Math.sqrt(12)) ** 2 - (prof.beta * marketSigma) ** 2
    );
    const idioSigma = Math.sqrt(idioVar);
    const drift = prof.mu / 12;

    let price = 100;
    const series = [{ d: dates[0], c: price }];
    for (let i = 0; i < months; i++) {
      const r = drift + prof.beta * (marketRets[i] - marketMu) + idioSigma * normalRandom(rnd);
      price *= 1 + r;
      series.push({ d: dates[i + 1], c: Math.max(0.01, price) });
    }
    out[t] = series;
  });

  return out;
}

// ════════════════════════════════════════════════════════════════════
//  2) CoinGecko 과거 시세 (코인 전용 · 지금 바로 작동)
// ════════════════════════════════════════════════════════════════════
export async function fetchCryptoHistory(ticker, years = 10) {
  const id = CRYPTO_IDS[String(ticker).toUpperCase()];
  if (!id) throw new Error(`${ticker}는 지원하지 않는 코인이에요`);

  const days = Math.min(Math.round(years * 365), 3650);
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) throw new Error('CoinGecko 요청이 너무 많아요. 1분 뒤 다시 시도해 주세요');
    throw new Error(`CoinGecko 오류 (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.prices)) throw new Error('CoinGecko 응답 형식이 예상과 달라요');

  const daily = data.prices.map(([ms, price]) => ({
    d: new Date(ms).toISOString().slice(0, 10),
    c: price
  }));
  return toMonthly(daily);
}

// ════════════════════════════════════════════════════════════════════
//  3) 내 프록시 서버의 candle 엔드포인트
//
//  ✅ Worker에 candle 엔드포인트 배포 완료 — 별도 설정 없이 바로 작동합니다.
//  응답 형식: { s: "ok", t: [unix초...], c: [종가...] }
//  (Stooq 기반이라 월별 데이터만 오고, 배당은 반영 안 된 "가격만"의
//   값이에요 — 정확한 총수익이 필요하면 CSV 모드를 쓰세요)
// ════════════════════════════════════════════════════════════════════
export async function fetchProxyHistory(ticker, years = 10) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.round(years * 365.25 * 24 * 3600);
  const url = `${PROXY_URL}?endpoint=candle&symbol=${encodeURIComponent(ticker)}&resolution=M&from=${from}&to=${to}`;

  const res = await fetch(url, { headers: { 'X-Client-Key': CLIENT_KEY } });

  if (res.status === 404) {
    // Worker는 배포되어 있으니, 404는 "엔드포인트가 없다"가 아니라
    // "이 종목은 Stooq에서 과거 데이터를 찾지 못했다"는 뜻이에요.
    let detail = '';
    try { const d = await res.json(); detail = d && d.error; } catch (e) {}
    throw new Error(detail || `${ticker}의 과거 데이터를 Stooq에서 찾지 못했어요 (CSV 모드를 사용해 보세요)`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('프록시 인증에 실패했어요 (X-Client-Key가 Worker의 CLIENT_SECRET과 일치하는지 확인해 주세요)');
  }
  if (res.status === 429) {
    throw new Error('잠깐 사이에 요청이 몰렸어요. 잠시 후 다시 시도해 주세요');
  }
  if (!res.ok) throw new Error(`프록시 오류 (HTTP ${res.status})`);

  const d = await res.json();
  if (!d || !Array.isArray(d.t) || !Array.isArray(d.c) || !d.t.length) {
    throw new Error(`${ticker} 과거 데이터가 비어 있어요`);
  }
  const series = d.t.map((sec, i) => ({
    d: new Date(sec * 1000).toISOString().slice(0, 10),
    c: d.c[i]
  })).filter((p) => isFinite(p.c) && p.c > 0);

  return toMonthly(series);
}

// ════════════════════════════════════════════════════════════════════
//  4) CSV 파싱
//  기대 형식 (헤더 있어도 되고 없어도 됨):
//     2015-01-31,102.5
//     2015-02-28,108.3
//  Yahoo Finance / Stooq에서 내려받은 CSV도 자동 인식합니다.
// ════════════════════════════════════════════════════════════════════
export function parseCsvSeries(text) {
  const lines = String(text).trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('빈 파일이에요');

  let dateIdx = 0;
  let closeIdx = 1;
  let startRow = 0;

  // 첫 줄이 헤더인지 판단
  const firstCells = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const looksLikeHeader = firstCells.some((c) => /date|close|adj|종가|날짜/.test(c));
  if (looksLikeHeader) {
    startRow = 1;
    const di = firstCells.findIndex((c) => /date|날짜/.test(c));
    // 수정종가(Adj Close)가 있으면 그걸 우선 사용 — 배당/분할이 반영된 값이라 더 정확
    let ci = firstCells.findIndex((c) => /adj.*close|수정.*종가/.test(c));
    if (ci === -1) ci = firstCells.findIndex((c) => /close|종가/.test(c));
    if (di !== -1) dateIdx = di;
    if (ci !== -1) closeIdx = ci;
  }

  const series = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length <= Math.max(dateIdx, closeIdx)) continue;
    const rawDate = cells[dateIdx].trim().replace(/"/g, '');
    const close = parseFloat(cells[closeIdx].trim().replace(/["$,]/g, ''));
    if (!isFinite(close) || close <= 0) continue;
    const dt = new Date(rawDate);
    if (isNaN(dt.getTime())) continue;
    series.push({ d: dt.toISOString().slice(0, 10), c: close });
  }

  if (series.length < 2) throw new Error('읽을 수 있는 데이터가 2줄 미만이에요. 형식을 확인해 주세요');
  series.sort((a, b) => a.d.localeCompare(b.d));
  return toMonthly(series);
}

// ════════════════════════════════════════════════════════════════════
//  통합 로더 — 소스에 따라 알맞은 함수를 호출
// ════════════════════════════════════════════════════════════════════
export async function loadHistories(assets, { source = 'demo', years = 10, csvData = {}, seed = 7 } = {}) {
  const tickers = assets.map((a) => a.ticker);
  const result = {};
  const errors = [];

  if (source === 'demo') {
    return { series: generateDemoSeries(tickers, years, seed), errors: [] };
  }

  if (source === 'csv') {
    assets.forEach((a) => {
      if (csvData[a.ticker]) result[a.ticker] = csvData[a.ticker];
      else errors.push(`${a.ticker}: CSV 파일이 업로드되지 않았어요`);
    });
    return { series: result, errors };
  }

  // source === 'live' : 코인은 CoinGecko, 주식은 프록시
  for (const a of assets) {
    try {
      if (a.isCrypto) {
        result[a.ticker] = await fetchCryptoHistory(a.ticker, years);
      } else {
        result[a.ticker] = await fetchProxyHistory(a.ticker, years);
      }
      // API 예의상 호출 간격 두기
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      errors.push(`${a.ticker}: ${e.message}`);
    }
  }
  return { series: result, errors };
}