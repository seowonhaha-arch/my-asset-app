// ════════════════════════════════════════════════════════════════════
//  내 자산 브리핑 · PF-15
//
//  [PF-15 신규 업데이트]
//  · 당겨서 새로고침 (Pull-to-Refresh) 네이티브 UX 적용
//  · 입력 폼 개선: 포커스 시 '0' 자동 삭제 & 텍스트 전체 선택
//  · 키보드 가림 방지: 입력 폼 터치 시 부드럽게 중앙으로 스크롤
//  · 리밸런싱 경고: 특정 종목 비중 30% 돌파 시 홈에 알림 카드 노출
//  · 환노출 관리: 포트폴리오 탭에 달러(USD) vs 원화(KRW) 비중 표시
// ════════════════════════════════════════════════════════════════════

// Vite로 옮기며 바뀐 부분 ①: CDN <script> 대신 npm 패키지에서 import 합니다.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// [신규] 포트폴리오 시뮬레이터 탭
import BacktestTab from './components/BacktestTab.jsx';

// ═══ [1] CONFIG ═════════════════════════════════════════════════════

const APP_VERSION = "PF-15";
const SCHEMA_VERSION = 9;
const STORAGE_KEY = "portfolio-data-v9";
const LEGACY_STORAGE_KEYS = ["portfolio-data-v8", "portfolio-data-v7", "portfolio-data-v6"];
const METRIC_CACHE_KEY = "portfolio-metric-cache-v1";
const UI_PREF_KEY = "portfolio-ui-pref-v2";

const PROXY_URL = "https://finnhub-proxy.seowonhaha.workers.dev";
const CLIENT_KEY = "1639a4b7aff5f79e5b199673a1be278773127eea3490c344";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const FX_URL = "https://open.er-api.com/v6/latest/USD";

// ── 계좌 ────────────────────────────────────────────────────────────
const ACCOUNTS = [
  { key: "gen1",    label: "일반계좌1", short: "일반1", color: "#4FD1C5", desc: "해외주식 일반 계좌예요" },
  { key: "gen2",    label: "일반계좌2", short: "일반2", color: "#60A5FA", desc: "두 번째 일반 계좌예요" },
  { key: "isa",     label: "ISA",       short: "ISA",  color: "#FFB020", desc: "3년 이상 유지하면 세금 혜택이 있어요" },
  { key: "irp",     label: "IRP",       short: "IRP",  color: "#B18CFF", desc: "퇴직연금 계좌예요. 연말정산 공제 대상이에요" },
  { key: "pension", label: "연금저축",  short: "연금", color: "#FF8FA3", desc: "만 55세 이후 연금으로 받는 계좌예요" }
];
const ACCOUNT_KEYS = ACCOUNTS.map(function (a) { return a.key; });
const ACCOUNT_MAP = {};
ACCOUNTS.forEach(function (a) { ACCOUNT_MAP[a.key] = a; });
function accountOf(key) { return ACCOUNT_MAP[key] || ACCOUNTS[0]; }

// ── 용어 사전 (전문용어 → 일상어) ───────────────────────────────────
const T = {
  cash: "비상금 (실탄)",
  cashShort: "비상금",
  core: "든든한 기둥",
  satellite: "보너스 알파",
  t1: "세일 알림",
  t2: "줍줍 타이밍",
  mdd: "역대 최대 폭락률",
  high52: "1년 중 최고가",
  avgPrice: "내 평균 매수가",
  price: "지금 가격",
  qty: "보유 수량",
  targetQty: "목표 수량",
  div: "1주당 연 배당금"
};

const TIP = {
  cash: "트리거 발동 시 추가 매수에 사용할 대기 자금입니다.",
  coreSat: "기둥은 장기 투자, 보너스 알파는 단기 및 테마 투자입니다.",
  trigger: "고점 대비 하락률을 의미하며, 추가 매수 타이밍을 잡는 데 씁니다.",
  mdd: "최악의 경우 역사적으로 이만큼 떨어질 수 있다는 지표입니다.",
  high52: "최근 1년 동안 이 종목이 찍은 가장 높은 가격이에요. 세일 알림의 기준점이 됩니다.",
  avgPrice: "지금까지 산 가격의 평균이에요. 여러 번 나눠 샀다면 증권사 앱의 평균 단가를 그대로 적으면 됩니다.",
  today: "어제 종가와 비교한 오늘 하루의 변동이에요. 장이 열리기 전이면 0에 가깝습니다.",
  dividend: "지금 보유 수량 기준으로 1년 동안 받을 것으로 예상되는 배당금이에요. 세금을 떼기 전 금액입니다.",
  targetQty: "이 종목을 최종적으로 몇 주까지 모을지 정해두는 값이에요. 달성률 막대의 기준이 됩니다.",
  weight: "전체 자산 중 이 종목이 차지하는 비율이에요. 한 종목이 너무 커지면 위험이 몰립니다.",
  totalValue: "보유 종목 평가액과 비상금을 모두 더한 금액이에요.",
  step: "1단계는 성장 자산을 모으는 기간, 2단계는 배당·성장 코어로 옮기는 기간, 3단계는 배당으로 생활비를 만드는 기간이에요."
};

const CRYPTO_IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink" };
const SUPPORTED_COINS_LABEL = Object.keys(CRYPTO_IDS).join(", ");
const COOLDOWN_MS = { stock: 10000, crypto: 30000, bulk: 20000 };
const QUOTE_CACHE_MS = 60000;
const CRYPTO_CACHE_MS = 30000;

const DEFAULT_GOALS = { finalGoalKRW: 2000000000, dividendGoalKRW: 80000000 };
const CASH_COLOR = "#3B82F6";
const CATEGORY_COLORS = { core: "#4FD1C5", satellite: "#FFB020", phase2: "#B18CFF", cash: CASH_COLOR };

const STATUS_META = {
  normal:    { label: "정상가",      color: "#3DDC97", note: "계획대로 천천히 모아가는 중" },
  t1:        { label: "세일 알림",   color: "#FFB020", note: "평소보다 싸졌어요 · 매수 금액 2배" },
  t2:        { label: "줍줍 타이밍", color: "#FF5C5C", note: "비상금을 꺼낼 타이밍이에요" },
  rebalance: { label: "비중 초과",   color: "#B18CFF", note: "비중이 30%를 넘었어요 · 리밸런싱을 고민해보세요" },
  done:      { label: "목표 달성",   color: "#60A5FA", note: "목표 수량을 다 채웠어요" }
};

// ── 배당 마일스톤 (일상 소비 기준) ──────────────────────────────────
const DIV_MILESTONES = [
  { key: "netflix", icon: "🎬", label: "넷플릭스 구독료", monthly: 17000,  done: "매월 넷플릭스 맘 편히 보는 배당금 달성!" },
  { key: "telecom", icon: "📱", label: "매월 통신비",     monthly: 55000,  done: "매월 통신비 방어 완료!" },
  { key: "coffee",  icon: "☕", label: "하루 한 잔 커피", monthly: 142000, done: "하루 한 잔 스타벅스 커피값 자동 생성!" }
];

const HOLDING_DEFAULTS = { category: "core", account: "gen1", isCrypto: false, isKRW: false, qty: 0, avgPrice: 0, price: 0, high52: 0, targetQty: 0, t1: -15, t2: -30, mdd: 0, divPerShare: 0 };
const PHASE2_DEFAULTS = { account: "gen1", isKRW: false, qty: 0, avgPrice: 0, price: 0, high52: 0, divPerShare: 0 };

const DEFAULT_HOLDINGS = [];
const DEFAULT_PHASE2 = [
  { id: "p1", ticker: "SCHD", name: "SCHD (배당 코어)", account: "gen1", isKRW: false, qty: 0, avgPrice: 0, price: 32.92, high52: 33.50, divPerShare: 1.05 },
  { id: "p2", ticker: "SCHG", name: "SCHG (성장 코어)", account: "gen1", isKRW: false, qty: 0, avgPrice: 0, price: 34.27, high52: 35.42, divPerShare: 0.12 }
];

// ── 온보딩 주력 자산 후보 ───────────────────────────────────────────
const STARTER_ASSETS = [
  { ticker: "TSLA", name: "테슬라", category: "satellite", mdd: -74 },
  { ticker: "NVDA", name: "엔비디아", category: "core", mdd: -66 },
  { ticker: "AAPL", name: "애플", category: "core", mdd: -44 },
  { ticker: "MSFT", name: "마이크로소프트", category: "core", mdd: -37 },
  { ticker: "QQQ", name: "나스닥100 ETF", category: "core", mdd: -35 },
  { ticker: "VOO", name: "S&P500 ETF", category: "core", mdd: -34 },
  { ticker: "BTC", name: "비트코인", category: "satellite", isCrypto: true, mdd: -84 },
  { ticker: "ETH", name: "이더리움", category: "satellite", isCrypto: true, mdd: -80 },
  { ticker: "005930.KS", name: "삼성전자", category: "core", isKRW: true, mdd: -55 }
];

const GOAL_PRESETS = [
  { label: "1억원", value: 100000000 },
  { label: "3억원", value: 300000000 },
  { label: "5억원", value: 500000000 },
  { label: "10억원", value: 1000000000 },
  { label: "20억원", value: 2000000000 }
];

// ── 원클릭 템플릿 ───────────────────────────────────────────────────
const TEMPLATES = {
  dividend: {
    title: "안전제일 배당 템플릿",
    sub: "SCHD 위주 · 흔들림 적게 배당을 모으는 구성",
    icon: "🛡️",
    holdings: [
      { ticker: "VOO", name: "S&P500 ETF", category: "core", account: "isa", qty: 12, avgPrice: 480, price: 512, high52: 540, targetQty: 40, t1: -15, t2: -30, mdd: -34, divPerShare: 6.4 },
      { ticker: "KO", name: "코카콜라", category: "core", account: "gen1", qty: 80, avgPrice: 62, price: 65.4, high52: 74.4, targetQty: 200, t1: -15, t2: -25, mdd: -40, divPerShare: 2.04 },
      { ticker: "O", name: "리얼티인컴 (월배당)", category: "satellite", account: "gen1", qty: 60, avgPrice: 55, price: 57.2, high52: 64, targetQty: 150, t1: -15, t2: -30, mdd: -45, divPerShare: 3.16 }
    ],
    phase2: { SCHD: { qty: 100, avgPrice: 27.5 }, SCHG: { qty: 40, avgPrice: 30.1 } },
    cash: { gen1: 3000, isa: 1500 }
  },
  growth: {
    title: "빅테크 성장 템플릿",
    sub: "QQQ 위주 · 변동성은 크지만 성장에 베팅하는 구성",
    icon: "🚀",
    holdings: [
      { ticker: "QQQ", name: "나스닥100 ETF", category: "core", account: "gen1", qty: 20, avgPrice: 520, price: 566, high52: 590, targetQty: 60, t1: -15, t2: -30, mdd: -35, divPerShare: 3.1 },
      { ticker: "NVDA", name: "엔비디아", category: "core", account: "isa", qty: 40, avgPrice: 152, price: 178, high52: 195, targetQty: 120, t1: -20, t2: -35, mdd: -66, divPerShare: 0.04 },
      { ticker: "TSLA", name: "테슬라", category: "satellite", account: "gen1", qty: 15, avgPrice: 372, price: 402, high52: 463, targetQty: 60, t1: -25, t2: -40, mdd: -74, divPerShare: 0 },
      { ticker: "BTC", name: "비트코인", category: "satellite", account: "gen2", isCrypto: true, qty: 0.08, avgPrice: 92000, price: 108000, high52: 124000, targetQty: 0.3, t1: -25, t2: -40, mdd: -84, divPerShare: 0 }
    ],
    phase2: { SCHG: { qty: 60, avgPrice: 31.2 } },
    cash: { gen1: 2500 }
  }
};

// ═══ [2] UTILS ══════════════════════════════════════════════════════

function uid() { return "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function toNum(v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; }
function toUSD(val, isKRW, fx) { return (isKRW && fx > 0) ? val / fx : val; }

function fmtCurrency(n, isKRW) {
  if (!isFinite(n)) n = 0;
  if (isKRW) return "₩" + Math.round(n).toLocaleString("ko-KR");
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtKRWShort(n) {
  if (!isFinite(n)) return "0원";
  var sign = n < 0 ? "-" : "";
  var abs = Math.abs(n);
  if (abs >= 100000000) {
    var v = abs / 100000000;
    var t = v >= 100 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(2).replace(/\.?0+$/, "");
    return sign + t + "억원";
  }
  if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString("ko-KR") + "만원";
  return sign + Math.round(abs).toLocaleString("ko-KR") + "원";
}

function fmtKRWFull(n) {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function isStale(iso, hours) {
  if (!iso) return true;
  var t = Date.parse(iso);
  if (!isFinite(t)) return true;
  return Date.now() - t > hours * 3600000;
}

function fmtSyncTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  var now = new Date();
  var hh = String(d.getHours()).padStart(2, "0");
  var mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return hh + ":" + mm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
}

function todayKey() {
  var n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}

function greetingByHour() {
  var h = new Date().getHours();
  if (h < 6) return "늦은 밤이네요";
  if (h < 11) return "좋은 아침이에요";
  if (h < 17) return "오늘도 수고 많아요";
  if (h < 22) return "저녁 브리핑이에요";
  return "하루 마무리 브리핑이에요";
}

function isUnsupportedForeign(t) {
  t = String(t || "").toUpperCase();
  if (/\.(KS|KQ)$/.test(t)) return false;
  if (t.indexOf(":") !== -1) return true;
  var m = t.match(/\.([A-Z0-9]+)$/);
  return !!(m && m[1].length >= 2);
}

// ═══ [3] STORAGE ════════════════════════════════════════════════════

function normalizeAccount(v) { return ACCOUNT_KEYS.indexOf(v) !== -1 ? v : "gen1"; }

function normalizeHolding(raw) {
  var h = Object.assign({}, HOLDING_DEFAULTS, raw || {});
  h.id = (typeof h.id === "string" && h.id) ? h.id : uid();
  h.ticker = String(h.ticker || "").toUpperCase();
  h.name = h.name || h.ticker;
  h.category = h.category === "satellite" ? "satellite" : "core";
  h.account = normalizeAccount(h.account);
  h.isCrypto = !!h.isCrypto;
  h.isKRW = !!h.isKRW;
  ["qty", "avgPrice", "price", "high52", "targetQty", "divPerShare"].forEach(function (k) { h[k] = Math.max(0, toNum(h[k], 0)); });
  ["t1", "t2", "mdd"].forEach(function (k) {
    var t = toNum(h[k], HOLDING_DEFAULTS[k]);
    h[k] = t === 0 ? 0 : -Math.abs(t);
  });
  var dp = raw ? raw.dayPct : null;
  h.dayPct = (dp == null || !isFinite(Number(dp))) ? null : Number(dp);
  return h;
}

function normalizePhase2(raw) {
  var p = Object.assign({}, PHASE2_DEFAULTS, raw || {});
  p.id = (typeof p.id === "string" && p.id) ? p.id : uid();
  p.ticker = String(p.ticker || "").toUpperCase();
  p.name = p.name || p.ticker;
  p.account = normalizeAccount(p.account);
  p.isKRW = !!p.isKRW;
  ["qty", "avgPrice", "price", "high52", "divPerShare"].forEach(function (k) { p[k] = Math.max(0, toNum(p[k], 0)); });
  var dp = raw ? raw.dayPct : null;
  p.dayPct = (dp == null || !isFinite(Number(dp))) ? null : Number(dp);
  return p;
}

function normalizeCash(rawCash, legacyBil) {
  var out = {};
  ACCOUNT_KEYS.forEach(function (k) { out[k] = 0; });
  if (rawCash && typeof rawCash === "object") {
    ACCOUNT_KEYS.forEach(function (k) { out[k] = Math.max(0, toNum(rawCash[k], 0)); });
  } else {
    out.gen1 = Math.max(0, toNum(legacyBil, 0));
  }
  return out;
}

function sumCash(cash) {
  return ACCOUNT_KEYS.reduce(function (s, k) { return s + toNum(cash[k], 0); }, 0);
}

function normalizeState(raw) {
  raw = raw || {};
  var goalsRaw = raw.goals || {};
  return {
    holdings: Array.isArray(raw.holdings) ? raw.holdings.map(normalizeHolding) : DEFAULT_HOLDINGS.slice(),
    phase2: Array.isArray(raw.phase2) && raw.phase2.length ? raw.phase2.map(normalizePhase2) : DEFAULT_PHASE2.map(function (p) { return Object.assign({}, p); }),
    cash: normalizeCash(raw.cash, raw.bilBalance),
    exchangeRate: toNum(raw.exchangeRate, 1480) > 0 ? toNum(raw.exchangeRate, 1480) : 1480,
    bilMinPct: Math.max(0, toNum(raw.bilMinPct, 10)),
    goals: { finalGoalKRW: Math.max(0, toNum(goalsRaw.finalGoalKRW, DEFAULT_GOALS.finalGoalKRW)), dividendGoalKRW: Math.max(0, toNum(goalsRaw.dividendGoalKRW, DEFAULT_GOALS.dividendGoalKRW)) },
    history: Array.isArray(raw.history) ? raw.history.filter(function (x) { return x && typeof x.d === "string" && isFinite(Number(x.v)); }).map(function (x) { return { d: x.d, v: Math.round(Number(x.v)) }; }).slice(-370) : [],
    onboarded: raw.onboarded === true || (Array.isArray(raw.holdings) && raw.holdings.length > 0),
    lastPriceSync: typeof raw.lastPriceSync === "string" ? raw.lastPriceSync : null,
    lastBackupAt: typeof raw.lastBackupAt === "string" ? raw.lastBackupAt : null,
    lastUpdated: typeof raw.lastUpdated === "string" ? raw.lastUpdated : null
  };
}

function serializeState(s) {
  return { schemaVersion: SCHEMA_VERSION, holdings: s.holdings, phase2: s.phase2, cash: s.cash, exchangeRate: s.exchangeRate, bilMinPct: s.bilMinPct, goals: s.goals, history: s.history || [], onboarded: !!s.onboarded, lastPriceSync: s.lastPriceSync, lastBackupAt: s.lastBackupAt, lastUpdated: new Date().toISOString() };
}

function loadPersistedState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { state: normalizeState(JSON.parse(raw)), migrated: false };
    for (var i = 0; i < LEGACY_STORAGE_KEYS.length; i++) {
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEYS[i]);
      if (legacy) {
        var st = normalizeState(JSON.parse(legacy));
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(st))); } catch (e) {}
        return { state: st, migrated: true };
      }
    }
  } catch (e) { console.warn("데이터 파싱 오류", e); }
  return null;
}

function loadUiPref() {
  try {
    var raw = localStorage.getItem(UI_PREF_KEY);
    if (raw) {
      var o = JSON.parse(raw);
      return { sort: (o.sort === "weight" || o.sort === "drop") ? o.sort : "default", account: ACCOUNT_KEYS.indexOf(o.account) !== -1 ? o.account : "all" };
    }
  } catch (e) {}
  return { sort: "default", account: "all" };
}
function saveUiPref(p) { try { localStorage.setItem(UI_PREF_KEY, JSON.stringify(p)); } catch (e) {} }

// ═══ [4] MARKET API ═════════════════════════════════════════════════

var __proxyChain = Promise.resolve();
var __proxyLastCallAt = 0;
var PROXY_MIN_GAP_MS = 1100;
function scheduleProxyCall(fn) {
  var run = __proxyChain.then(function () {
    var wait = PROXY_MIN_GAP_MS - (Date.now() - __proxyLastCallAt);
    return wait > 0 ? new Promise(function (r) { setTimeout(r, wait); }) : null;
  }).then(function () {
    __proxyLastCallAt = Date.now();
    return fn();
  });
  __proxyChain = run.then(function () {}, function () {});
  return run;
}

var __cooldowns = {};
function underCooldown(key, ms) { return Date.now() - (__cooldowns[key] || 0) < ms; }
function markCooldown(key) { __cooldowns[key] = Date.now(); }
function cooldownLeft(key, ms) { return Math.max(1, Math.ceil((ms - (Date.now() - (__cooldowns[key] || 0))) / 1000)); }

var __memCache = {};
function memGet(key, ms) { var e = __memCache[key]; return (e && (Date.now() - e.t) < ms) ? e.v : null; }
function memSet(key, v) { __memCache[key] = { t: Date.now(), v: v }; }

var __metricCacheMem = null;
function getMetricCache() {
  if (__metricCacheMem) return __metricCacheMem;
  try {
    var r = localStorage.getItem(METRIC_CACHE_KEY);
    if (r) {
      var o = JSON.parse(r);
      if (o && o.d === todayKey() && o.m) { __metricCacheMem = o.m; return __metricCacheMem; }
    }
  } catch (e) {}
  __metricCacheMem = {};
  return __metricCacheMem;
}
function setMetricCache(sym, val) {
  var m = getMetricCache();
  m[sym] = val;
  try { localStorage.setItem(METRIC_CACHE_KEY, JSON.stringify({ d: todayKey(), m: m })); } catch (e) {}
}

async function fetchJsonOnce(url, options) {
  var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
  var opts = Object.assign({}, options || {}, ctrl ? { signal: ctrl.signal } : {});
  try {
    var res = await fetch(url, opts);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var msg = (data && (data.detail || data.error)) ? String(data.detail || data.error) : ("HTTP " + res.status);
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  try {
    return await fetchJsonOnce(url, options);
  } catch (e) {
    var st = e && e.status;
    var m = String((e && e.message) || "");
    var transient = st === 429 || (st >= 500 && st < 600) || /abort|Failed to fetch|NetworkError|load failed/i.test(m);
    if (!transient) throw e;
    await new Promise(function (r) { setTimeout(r, st === 429 ? 2500 : 1200); });
    return await fetchJsonOnce(url, options);
  }
}

function friendlyApiError(e, prefix) {
  var st = e && e.status;
  var m = String((e && e.message) || "");
  if (st === 429) return prefix + " — 잠깐 사이에 조회를 너무 많이 했어요. 1분 후 다시 시도해 주세요";
  if (st === 401) return prefix + " — 서버 인증에 실패했어요 (설정 > 앱 정보 확인)";
  if (st === 403) return prefix + " — 허용되지 않은 주소에서 접속했어요";
  if (st >= 500 && st < 600) return prefix + " — 서버가 잠시 불안정해요. 조금 뒤에 다시 시도해 주세요";
  if (/abort/i.test(m)) return prefix + " — 응답이 너무 느려요. 잠시 후 다시 시도해 주세요";
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) return prefix + " — 인터넷 연결을 확인해 주세요";
  return prefix + (m ? " — " + m.slice(0, 90) : " — 잠시 후 다시 시도해 주세요");
}

function proxyOpts() { return { headers: { "X-Client-Key": CLIENT_KEY } }; }

async function apiQuote(ticker, isKRW) {
  var isKr = isKRW || /\.(KS|KQ)$/i.test(ticker);
  var endpoint = isKr ? "kr_quote" : "quote";
  var ck = "q:" + endpoint + ":" + ticker;
  var hit = memGet(ck, QUOTE_CACHE_MS);
  if (hit) return hit;

  var d = await scheduleProxyCall(function () {
    return fetchJson(PROXY_URL + "?endpoint=" + endpoint + "&symbol=" + encodeURIComponent(ticker), proxyOpts());
  });
  if (!d) throw new Error("응답 없음");

  var out;
  if (isKr) {
    if (typeof d.c !== "number" || !isFinite(d.c)) throw new Error("국내 시세 응답 오류 (종목코드 확인)");
    var dpKr = (typeof d.pc === "number" && d.pc > 0) ? ((d.c - d.pc) / d.pc) * 100 : null;
    out = { price: d.c, dayHigh: d.h || 0, high52: d.w52h || 0, dayPct: dpKr };
  } else {
    if (typeof d.c !== "number" || (d.c === 0 && d.h === 0)) throw new Error("미국 시세 응답 오류 (티커 확인)");
    var dpUs = (typeof d.dp === "number" && isFinite(d.dp)) ? d.dp : ((typeof d.pc === "number" && d.pc > 0) ? ((d.c - d.pc) / d.pc) * 100 : null);
    out = { price: d.c, dayHigh: d.h || 0, high52: 0, dayPct: dpUs };
  }
  memSet(ck, out);
  return out;
}

async function apiMetric(ticker) {
  var cache = getMetricCache();
  if (cache[ticker]) return cache[ticker];
  try {
    var d = await scheduleProxyCall(function () {
      return fetchJson(PROXY_URL + "?endpoint=metric&symbol=" + encodeURIComponent(ticker), proxyOpts());
    });
    var m = d && d.metric;
    if (!m) {
      var empty = { div: null, high52: 0 };
      setMetricCache(ticker, empty);
      return empty;
    }
    var div = typeof m.dividendPerShareTTM === "number" ? m.dividendPerShareTTM : (typeof m.dividendPerShareAnnual === "number" ? m.dividendPerShareAnnual : null);
    var high = typeof m["52WeekHigh"] === "number" ? m["52WeekHigh"] : 0;
    var out = { div: (typeof div === "number" && div >= 0) ? div : null, high52: high };
    setMetricCache(ticker, out);
    return out;
  } catch (e) {
    return { div: null, high52: 0 };
  }
}

async function apiSearch(q) {
  var t = q.trim();
  var hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t);
  var looksLikeKrCode = /^\d{4,6}$/.test(t);
  var endpoint = (hasKorean || looksLikeKrCode) ? "kr_search" : "search";
  var d = await scheduleProxyCall(function () {
    return fetchJson(PROXY_URL + "?endpoint=" + endpoint + "&q=" + encodeURIComponent(t), proxyOpts());
  });
  var all = (d && d.result) || [];
  if (endpoint === "search") {
    all = all.filter(function (r) {
      if (!r || !r.symbol) return false;
      if (r.symbol.indexOf(":") !== -1) return false;
      return /^[A-Z0-9]+(\.[A-Z])?$/.test(r.symbol);
    });
  }
  return all.slice(0, 6);
}

async function apiCryptoPrices(tickers) {
  var ids = [];
  tickers.forEach(function (t) { var id = CRYPTO_IDS[t]; if (id && ids.indexOf(id) === -1) ids.push(id); });
  if (!ids.length) return {};
  var ck = "c:" + ids.slice().sort().join(",");
  var hit = memGet(ck, CRYPTO_CACHE_MS);
  var d;
  if (hit) {
    d = hit;
  } else {
    d = await fetchJson(COINGECKO_URL + "?ids=" + ids.join(",") + "&vs_currencies=usd&include_24hr_change=true");
    memSet(ck, d);
  }
  var out = {};
  tickers.forEach(function (t) {
    var id = CRYPTO_IDS[t];
    if (id && d[id] && typeof d[id].usd === "number") {
      var ch = d[id].usd_24h_change;
      out[t] = { price: d[id].usd, dayPct: (typeof ch === "number" && isFinite(ch)) ? ch : null };
    }
  });
  return out;
}

async function apiFxKRW() {
  var d = await fetchJson(FX_URL);
  if (d && d.rates && typeof d.rates.KRW === "number") return Number(d.rates.KRW.toFixed(2));
  throw new Error("no fx");
}

// ═══ [5] CALC ═══════════════════════════════════════════════════════

function calcYield(a) { return (!a.avgPrice || a.qty <= 0) ? 0 : ((a.price - a.avgPrice) / a.avgPrice) * 100; }
function calcProfit(a) { return (!a.avgPrice || a.qty <= 0) ? 0 : (a.price - a.avgPrice) * a.qty; }
function dropPct(a) { return (!a.high52 || a.high52 <= 0) ? 0 : ((a.price - a.high52) / a.high52) * 100; }

function statusOf(h) {
  if ((h.targetQty || 0) > 0 && h.qty >= h.targetQty) return "done";
  var d = dropPct(h);
  if (typeof h.t2 === "number" && h.t2 < 0 && d <= h.t2) return "t2";
  if (typeof h.t1 === "number" && h.t1 < 0 && d <= h.t1) return "t1";
  return "normal";
}

function triggerGapText(h) {
  var st = statusOf(h);
  var d = dropPct(h);
  if (st === "normal" && typeof h.t1 === "number" && h.t1 < 0) return T.t1 + "까지 " + (d - h.t1).toFixed(1) + "%p 남음";
  if (st === "t1" && typeof h.t2 === "number" && h.t2 < 0) return T.t2 + "까지 " + (d - h.t2).toFixed(1) + "%p 남음";
  return null;
}

function applyQuoteToAsset(a, q) {
  var next = Object.assign({}, a, { price: q.price });
  next.high52 = Math.max(toNum(a.high52, 0), q.price, toNum(q.dayHigh, 0), toNum(q.metricHigh, 0));
  if (q.div != null) next.divPerShare = q.div;
  if (q.dayPct !== undefined) next.dayPct = q.dayPct;
  return next;
}

function computeSummary(s) {
  var holdings = s.holdings, phase2 = s.phase2, cash = s.cash;
  var exchangeRate = s.exchangeRate, bilMinPct = s.bilMinPct, goals = s.goals;
  var cashTotal = sumCash(cash);

  var phase1TargetUSD = holdings.reduce(function (sum, h) { return sum + toUSD((h.targetQty || 0) * h.price, h.isKRW, exchangeRate); }, 0);
  var phase1CurrentUSD = holdings.reduce(function (sum, h) { return sum + toUSD(h.qty * h.price, h.isKRW, exchangeRate); }, 0);
  var phase1Progress = phase1TargetUSD > 0 ? Math.min(100, (phase1CurrentUSD / phase1TargetUSD) * 100) : 0;
  var phase1Done = phase1TargetUSD > 0 && phase1CurrentUSD >= phase1TargetUSD;

  var phase2ValueUSD = phase2.reduce(function (sum, p) { return sum + toUSD(p.qty * p.price, p.isKRW, exchangeRate); }, 0);
  var phase2InvestedUSD = phase2.reduce(function (sum, p) { return sum + toUSD(p.qty * (p.avgPrice || 0), p.isKRW, exchangeRate); }, 0);
  var phase2ProfitUSD = phase2ValueUSD - phase2InvestedUSD;

  var annualDividendUSD =
    holdings.reduce(function (sum, h) { return sum + toUSD(h.qty * (h.divPerShare || 0), h.isKRW, exchangeRate); }, 0) +
    phase2.reduce(function (sum, p) { return sum + toUSD(p.qty * (p.divPerShare || 0), p.isKRW, exchangeRate); }, 0);

  var annualDividendKRW = annualDividendUSD * exchangeRate;
  var dividendProgress = goals.dividendGoalKRW > 0 ? Math.min(100, (annualDividendKRW / goals.dividendGoalKRW) * 100) : 0;
  var dividendGoalReached = goals.dividendGoalKRW > 0 && annualDividendKRW >= goals.dividendGoalKRW;

  var phase1InvestedUSD = holdings.reduce(function (sum, h) { return sum + toUSD(h.qty * (h.avgPrice || 0), h.isKRW, exchangeRate); }, 0);
  var phase1ProfitUSD = phase1CurrentUSD - phase1InvestedUSD;
  var totalInvestedUSD = phase1InvestedUSD + phase2InvestedUSD;
  var totalValueUSD = phase1CurrentUSD + phase2ValueUSD + cashTotal;
  var bilPctOfTotal = totalValueUSD > 0 ? (cashTotal / totalValueUSD) * 100 : 0;
  var bilLow = totalValueUSD > 0 && bilPctOfTotal < bilMinPct;
  var totalValueKRW = totalValueUSD * exchangeRate;
  var totalProfitUSD = phase1ProfitUSD + phase2ProfitUSD;
  var totalYieldPct = totalInvestedUSD > 0 ? (totalProfitUSD / totalInvestedUSD) * 100 : 0;

  // ── 오늘 총 손익 ──
  var dayBasisUSD = 0, dayChangeUSD = 0, dayCoveredUSD = 0;
  function accDay(v, p) {
    if (p == null || !isFinite(p) || Math.abs(p) > 500 || v <= 0) return;
    var prev = v / (1 + p / 100);
    if (!isFinite(prev) || prev <= 0) return;
    dayBasisUSD += prev;
    dayChangeUSD += (v - prev);
    dayCoveredUSD += v;
  }
  holdings.forEach(function (h) { accDay(toUSD(h.qty * h.price, h.isKRW, exchangeRate), h.dayPct); });
  phase2.forEach(function (p) { accDay(toUSD(p.qty * p.price, p.isKRW, exchangeRate), p.dayPct); });
  var hasDayData = dayBasisUSD > 0;
  var dayChangePct = dayBasisUSD > 0 ? (dayChangeUSD / dayBasisUSD) * 100 : 0;
  var investedValueUSD = phase1CurrentUSD + phase2ValueUSD;
  var dayCoverage = investedValueUSD > 0 ? (dayCoveredUSD / investedValueUSD) * 100 : 0;
  var dayChangeKRW = dayChangeUSD * exchangeRate;

  var phase1KRW = phase1CurrentUSD * exchangeRate;
  var phase2KRW = phase2ValueUSD * exchangeRate;
  var cashKRW = cashTotal * exchangeRate;
  var combinedKRW = phase1KRW + phase2KRW + cashKRW;
  var finalProgress = goals.finalGoalKRW > 0 ? Math.min(100, (combinedKRW / goals.finalGoalKRW) * 100) : 0;
  var seg1 = goals.finalGoalKRW > 0 ? Math.min(100, (phase1KRW / goals.finalGoalKRW) * 100) : 0;
  var seg2 = goals.finalGoalKRW > 0 ? Math.min(100 - seg1, (phase2KRW / goals.finalGoalKRW) * 100) : 0;
  var seg3 = goals.finalGoalKRW > 0 ? Math.min(100 - seg1 - seg2, (cashKRW / goals.finalGoalKRW) * 100) : 0;

  var coreValueUSD = 0, satelliteValueUSD = 0;
  holdings.forEach(function (h) {
    var v = toUSD(h.qty * h.price, h.isKRW, exchangeRate);
    if (h.category === "core") coreValueUSD += v;
    else satelliteValueUSD += v;
  });
  var totalForBar = coreValueUSD + satelliteValueUSD + phase2ValueUSD + cashTotal || 1;
  var corePct = (coreValueUSD / totalForBar) * 100;
  var satellitePct = (satelliteValueUSD / totalForBar) * 100;
  var phase2Pct = (phase2ValueUSD / totalForBar) * 100;
  var cashPct = (cashTotal / totalForBar) * 100;

  var weights = {};
  var wBase = totalValueUSD > 0 ? totalValueUSD : 1;
  holdings.forEach(function (h) { weights[h.id] = (toUSD(h.qty * h.price, h.isKRW, exchangeRate) / wBase) * 100; });
  phase2.forEach(function (p) { weights[p.id] = (toUSD(p.qty * p.price, p.isKRW, exchangeRate) / wBase) * 100; });

  // ── 통화별 자산 비중 (환노출) ──
  var krwValueUSD = 0, usdValueUSD = 0;
  holdings.forEach(function (h) {
    var v = toUSD(h.qty * h.price, h.isKRW, exchangeRate);
    if (h.isKRW) krwValueUSD += v; else usdValueUSD += v;
  });
  phase2.forEach(function (p) {
    var v = toUSD(p.qty * p.price, p.isKRW, exchangeRate);
    if (p.isKRW) krwValueUSD += v; else usdValueUSD += v;
  });
  // 계좌 성격에 따른 현금 통화 배분 (일반 = USD, 절세 = KRW)
  krwValueUSD += (toNum(cash.isa, 0) + toNum(cash.irp, 0) + toNum(cash.pension, 0)) / exchangeRate;
  usdValueUSD += (toNum(cash.gen1, 0) + toNum(cash.gen2, 0));

  var totalFxUSD = krwValueUSD + usdValueUSD || 1;
  var krwPct = (krwValueUSD / totalFxUSD) * 100;
  var usdPct = (usdValueUSD / totalFxUSD) * 100;
  var krwValueKRW = krwValueUSD * exchangeRate;
  var usdValueKRW = usdValueUSD * exchangeRate;

  // ── 계좌별 평가액 ──
  var accountTotals = { all: totalValueUSD };
  ACCOUNT_KEYS.forEach(function (k) { accountTotals[k] = toNum(cash[k], 0); });
  holdings.forEach(function (h) { accountTotals[h.account] += toUSD(h.qty * h.price, h.isKRW, exchangeRate); });
  phase2.forEach(function (p) { accountTotals[p.account] += toUSD(p.qty * p.price, p.isKRW, exchangeRate); });

  // ── 경고 & 액션 아이템 생성 ──
  var actionItems = [];
  holdings.forEach(function (h) {
    var st = statusOf(h);
    var w = weights[h.id] || 0;
    if (st === "t1" || st === "t2") {
      actionItems.push({ h: h, status: st, drop: dropPct(h), weight: w });
    } else if (w >= 30) {
      // 비중 30% 이상 시 리밸런싱 경고 추가
      actionItems.push({ h: h, status: "rebalance", drop: dropPct(h), weight: w });
    }
  });

  // 정렬: 줍줍(t2) -> 세일(t1) -> 비중초과(rebalance) -> 하락 큰 순
  actionItems.sort(function (a, b) {
    var rank = { t2: 1, t1: 2, rebalance: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.drop - b.drop;
  });

  var triggeredCount = actionItems.length;
  var currentPhaseIdx = dividendGoalReached ? 2 : (phase1Done ? 1 : 0);
  var isEmpty = phase1CurrentUSD === 0 && phase2ValueUSD === 0;

  return { exchangeRate, cashTotal, phase1Progress, phase1Done, phase1CurrentUSD, phase2ValueUSD, phase2ProfitUSD, annualDividendKRW, dividendProgress, dividendGoalReached, totalInvestedUSD, totalValueUSD, totalValueKRW, totalProfitUSD, totalYieldPct, phase1KRW, phase2KRW, cashKRW, finalProgress, seg1, seg2, seg3, coreValueUSD, satelliteValueUSD, corePct, satellitePct, phase2Pct, cashPct, bilPctOfTotal, bilLow, actionItems, triggeredCount, currentPhaseIdx, weights, accountTotals, isEmpty, hasDayData, dayChangeUSD, dayChangeKRW, dayChangePct, dayCoverage, krwPct, usdPct, krwValueKRW, usdValueKRW };
}

// ═══ [6] 공용 UI ═════════════════════════════════════════════════════

const IconBase = ({ size = 16, color = "currentColor", children, className = "", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>{children}</svg>
);
const Settings = (p) => <IconBase {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></IconBase>;
const Plus = (p) => <IconBase {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></IconBase>;
const Trash2 = (p) => <IconBase {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></IconBase>;
const ChevronDown = (p) => <IconBase {...p}><polyline points="6 9 12 15 18 9"/></IconBase>;
const ChevronUp = (p) => <IconBase {...p}><polyline points="18 15 12 9 6 15"/></IconBase>;
const ChevronRight = (p) => <IconBase {...p}><polyline points="9 18 15 12 9 6"/></IconBase>;
const X = (p) => <IconBase {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></IconBase>;
const AlertTriangle = (p) => <IconBase {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></IconBase>;
const RefreshCw = (p) => <IconBase {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></IconBase>;
const WifiOff = (p) => <IconBase {...p}><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></IconBase>;
const HomeIcon = (p) => <IconBase {...p}><path d="M3 9.5L12 3l9 6.5"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/></IconBase>;
const WalletIcon = (p) => <IconBase {...p}><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2"/><path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"/><circle cx="17" cy="14" r="1.2"/></IconBase>;
const PieIcon = (p) => <IconBase {...p}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></IconBase>;
const TagIcon = (p) => <IconBase {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></IconBase>;
const LabIcon = (p) => <IconBase {...p}><path d="M3 20h18"/><path d="M5 20V11l5-4"/><path d="M12 20V7l5-3"/><path d="M19 20V9"/></IconBase>;

function useArmed(ms) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(function () { return function () { if (timer.current) clearTimeout(timer.current); }; }, []);
  function fire(cb) {
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(function () { setArmed(false); }, ms || 2500);
      return false;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    cb();
    return true;
  }
  return [armed, fire];
}

// ── 물음표 툴팁 ──
function Tip({ title, text }) {
  const [open, setOpen] = useState(false);
  useEffect(function () {
    if (!open) return;
    var t = setTimeout(function () { setOpen(false); }, 7000);
    function close() { setOpen(false); }
    document.addEventListener("click", close);
    return function () { clearTimeout(t); document.removeEventListener("click", close); };
  }, [open]);
  return (
    <React.Fragment>
      <button type="button" aria-label={(title || "") + " 설명 보기"}
        onClick={function (e) { e.stopPropagation(); setOpen(function (o) { return !o; }); }}
        style={{ width: 15, height: 15, borderRadius: "50%", background: open ? "#4FD1C5" : "#232B33", color: open ? "#0B0E11" : "#8B96A5", fontSize: "10px", fontWeight: "bold", lineHeight: "15px", textAlign: "center", marginLeft: 4, flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>?</button>
      {open && (
        <div className="tip-bubble" style={{ position: "fixed", left: 14, right: 14, bottom: "calc(env(safe-area-inset-bottom, 0px) + 82px)", zIndex: 80, background: "#1B222A", border: "1px solid #33414F", borderRadius: 10, padding: "12px 14px", boxShadow: "0 10px 30px rgba(0,0,0,0.6)" }}>
          {title && <div style={{ color: "#4FD1C5", fontSize: "11px", fontWeight: "bold", marginBottom: 4 }}>{title}</div>}
          <div style={{ color: "#D3DBE3", fontSize: "12px", lineHeight: 1.6 }}>{text}</div>
        </div>
      )}
    </React.Fragment>
  );
}

function LabelTip({ children, tip, title, color, size }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", color: color || "#5C666F", fontSize: size || "10px" }}>
      {children}{tip && <Tip title={title || children} text={tip} />}
    </span>
  );
}

function DayChange({ pct }) {
  if (pct == null || !isFinite(pct) || Math.abs(pct) > 500) return null;
  var up = pct >= 0;
  return <span className="mono" style={{ color: up ? "#3DDC97" : "#FF5C5C", fontSize: "10px" }}>오늘 {up ? "+" : ""}{pct.toFixed(1)}%</span>;
}

function Sparkline({ data, color, height }) {
  if (!data || data.length < 2) return null;
  var W = 300, H = height || 40;
  var vs = data.map(function (p) { return p.v; });
  var min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
  var span = (max - min) || 1;
  var pts = data.map(function (p, i) {
    var x = (i / (data.length - 1)) * (W - 4) + 2;
    var y = H - 3 - ((p.v - min) / span) * (H - 6);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  var area = "2," + (H - 1) + " " + pts.join(" ") + " " + (W - 2) + "," + (H - 1);
  return (
    <svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" style={{ display: "block" }}>
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ToastHost({ toasts, onClose }) {
  const COLORS = { success: "#3DDC97", info: "#4FD1C5", warn: "#FFB020", error: "#FF5C5C" };
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)", zIndex: 68, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} className="toast-item" style={{ pointerEvents: "auto", background: "#161C22", border: "1px solid " + (COLORS[t.type] || "#1F262D"), color: "#E8ECEF", borderRadius: 8, padding: "10px 12px", fontSize: 12, maxWidth: "88%", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.45)" }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[t.type] || "#8B96A5" }} />
          <span style={{ wordBreak: "break-all" }}>{t.msg}</span>
          <button onClick={() => onClose(t.id)} aria-label="알림 닫기" style={{ flexShrink: 0, opacity: 0.7 }}><X size={13} color="#8B96A5" /></button>
        </div>
      ))}
    </div>
  );
}

// ── 입력 폼 컴포넌트 개선 (Focus UX + Keyboard Scroll) ──
function Field({ label, value, onChange, negative, hint, tip, tipTitle, suffix }) {
  function numToText(v) {
    var n = (typeof v === "number" && isFinite(v)) ? v : 0;
    return String(negative ? Math.abs(n) : n);
  }
  const [text, setText] = useState(numToText(value));
  const focused = useRef(false);
  useEffect(function () { if (!focused.current) setText(numToText(value)); }, [value, negative]);

  function handleChange(e) {
    var raw = e.target.value.replace(/[^0-9.]/g, "");
    var firstDot = raw.indexOf(".");
    if (firstDot !== -1) raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
    setText(raw);
    if (raw === "" || raw === ".") { onChange(0); return; }
    var n = parseFloat(raw);
    if (isFinite(n)) onChange(negative ? -n : n);
  }

  function handleFocus(e) {
    focused.current = true;
    if (text === "0") setText(""); // 입력 편의: 0을 자동으로 지워줌
    var el = e.target;
    // 부드럽게 화면 중앙으로 올려서 키보드 가림 방지
    setTimeout(function() { el.select(); }, 50);
    setTimeout(function() { el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 300);
  }

  return (
    <div>
      <div className="mb-1 flex items-center" style={{ color: "#5C666F", fontSize: "10px" }}>
        <span>{label}</span>{tip && <Tip title={tipTitle || label} text={tip} />}
      </div>
      <div className="fld flex items-center rounded" style={{ background: "#0B0E11", border: "1px solid #1F262D" }}>
        {negative && <span className="mono pl-2" style={{ color: "#8B96A5", fontSize: "13px" }}>-</span>}
        <input type="text" inputMode="decimal" value={text} 
          onFocus={handleFocus}
          onBlur={() => { focused.current = false; setText(text === "" ? "0" : numToText(value)); }} 
          onChange={handleChange} 
          className="mono w-full text-sm px-2 py-1.5" style={{ color: "#E8ECEF", border: "none", background: "transparent" }} />
        {suffix && <span className="mono pr-2" style={{ color: "#5C666F", fontSize: "11px" }}>{suffix}</span>}
      </div>
      {hint && <div className="mt-0.5" style={{ color: "#4A535C", fontSize: "9px" }}>{hint}</div>}
    </div>
  );
}

// ── 현금 입력 폼 개선 ──
function CashInput({ value, onChange }) {
  const [text, setText] = useState(String(value || 0));
  const focused = useRef(false);
  useEffect(function () { if (!focused.current) setText(String(value || 0)); }, [value]);
  
  function handleFocus(e) {
    focused.current = true;
    if (text === "0") setText("");
    var el = e.target;
    setTimeout(function() { el.select(); }, 50);
    setTimeout(function() { el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 300);
  }
  
  return (
    <input type="text" inputMode="decimal" value={text}
      onFocus={handleFocus}
      onBlur={() => { focused.current = false; setText(text === "" ? "0" : String(value || 0)); }}
      onChange={(e) => {
        var raw = e.target.value.replace(/[^0-9.]/g, "");
        var fd = raw.indexOf(".");
        if (fd !== -1) raw = raw.slice(0, fd + 1) + raw.slice(fd + 1).replace(/\./g, "");
        setText(raw);
        var n = parseFloat(raw);
        onChange(isFinite(n) ? n : 0);
      }}
      className="mono w-full text-sm px-2 py-1.5" style={{ color: "#E8ECEF", border: "none", background: "transparent" }} />
  );
}

function DonutChart({ segments, size = 148, strokeWidth = 20 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1A2027" strokeWidth={strokeWidth} />
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        if (pct <= 0) return null;
        const dash = pct * circumference;
        const gap = circumference - dash;
        const rotation = (acc / total) * 360 - 90;
        acc += seg.value;
        return <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={seg.color} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${gap}`} strokeLinecap="butt" transform={`rotate(${rotation} ${size / 2} ${size / 2})`} />;
      })}
    </svg>
  );
}

function GoalBar({ title, tip, right, pct, color, sub, segments }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5 gap-2">
        <span className="flex items-center" style={{ color: "#8B96A5", fontSize: "12px" }}>
          {title}{tip && <Tip title={title} text={tip} />}
        </span>
        <span className="mono flex-shrink-0" style={{ color: color, fontSize: "12px" }}>{right}</span>
      </div>
      <div className="w-full h-2.5 rounded-full overflow-hidden flex" style={{ background: "#1A2027" }}>
        {segments
          ? segments.map((s, i) => <div key={i} style={{ width: s.pct + "%", background: s.color, transition: "width .5s ease" }} />)
          : <div style={{ width: Math.max(0, Math.min(100, pct)) + "%", background: color, transition: "width .5s ease" }} />}
      </div>
      {sub && <div className="mt-1" style={{ color: "#5C666F", fontSize: "11px" }}>{sub}</div>}
    </div>
  );
}

function DividendThermometer({ annualKRW, goalKRW }) {
  var last = DIV_MILESTONES[DIV_MILESTONES.length - 1];
  var maxMilestone = last.monthly * 12;
  var scaleMax = annualKRW <= maxMilestone ? maxMilestone : Math.max(annualKRW * 1.08, maxMilestone * 1.2);
  var fillPct = Math.min(100, (annualKRW / scaleMax) * 100);
  var monthly = annualKRW / 12;
  var next = null;
  for (var i = 0; i < DIV_MILESTONES.length; i++) {
    if (annualKRW < DIV_MILESTONES[i].monthly * 12) { next = DIV_MILESTONES[i]; break; }
  }
  var allDone = !next;

  return (
    <div className="panel rounded-lg p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center text-sm font-bold">
          배당 온도계<Tip title="배당 온도계" text={TIP.dividend} />
        </div>
        <div className="mono" style={{ color: "#60A5FA", fontSize: "11px" }}>월 {fmtKRWShort(monthly)}꼴</div>
      </div>
      <div className="mono" style={{ fontSize: "22px", fontWeight: "bold", color: "#E8ECEF" }}>{fmtKRWFull(annualKRW)}</div>
      <div style={{ color: "#5C666F", fontSize: "11px" }}>1년 동안 받을 배당금 (세금 떼기 전)</div>

      <div className="mt-5" style={{ position: "relative", paddingBottom: 40 }}>
        <div style={{ position: "relative", height: 16, borderRadius: 999, background: "#151B21", border: "1px solid #1F262D", overflow: "visible" }}>
          <div style={{ position: "absolute", left: 2, top: 2, bottom: 2, width: "calc(" + fillPct + "% - 4px)", minWidth: fillPct > 0 ? 10 : 0, borderRadius: 999, background: "linear-gradient(90deg, #4FD1C5 0%, #FFB020 60%, #FF7A59 100%)", transition: "width .6s ease" }} />
          {DIV_MILESTONES.map(function (m) {
            var pos = Math.min(100, ((m.monthly * 12) / scaleMax) * 100);
            var reached = annualKRW >= m.monthly * 12;
            return (
              <div key={m.key} style={{ position: "absolute", left: pos + "%", top: -4, bottom: -4, width: 2, background: reached ? "rgba(11,14,17,0.55)" : "#33414F", transform: "translateX(-1px)" }}>
                <div style={{ position: "absolute", top: 26, left: "50%", transform: "translateX(-50%)", textAlign: "center", width: 76 }}>
                  <div style={{ fontSize: "13px", opacity: reached ? 1 : 0.35, filter: reached ? "none" : "grayscale(1)" }}>{m.icon}</div>
                  <div style={{ fontSize: "9px", color: reached ? "#3DDC97" : "#4A535C", whiteSpace: "nowrap" }}>{reached ? "달성" : fmtKRWShort(m.monthly) + "/월"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 rounded-md px-3 py-2.5" style={{ background: allDone ? "#132A28" : "#161C22", border: "1px solid " + (allDone ? "#2E5E56" : "#1F262D") }}>
        {allDone ? (
          <div style={{ color: "#3DDC97", fontSize: "12px", lineHeight: 1.6 }}>☕ {last.done}<br /><span style={{ color: "#8B96A5" }}>이제 최종 목표 {fmtKRWShort(goalKRW)}를 향해 가면 돼요.</span></div>
        ) : (
          <div style={{ fontSize: "12px", lineHeight: 1.6 }}>
            <span style={{ color: "#E8ECEF" }}>{next.icon} 다음 목표 · {next.label}</span>
            <div style={{ color: "#8B96A5" }}>
              연 <span className="mono" style={{ color: "#FFB020" }}>{fmtKRWShort(next.monthly * 12 - annualKRW)}</span>만 더 모으면 “{next.done}”
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {DIV_MILESTONES.map(function (m) {
          var goal = m.monthly * 12;
          var reached = annualKRW >= goal;
          var pct = Math.min(100, (annualKRW / goal) * 100);
          return (
            <div key={m.key} className="flex items-center gap-2.5">
              <span style={{ fontSize: "15px", width: 20, textAlign: "center", opacity: reached ? 1 : 0.4 }}>{m.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between" style={{ fontSize: "11px" }}>
                  <span style={{ color: reached ? "#3DDC97" : "#B8C1CA" }}>{m.label}</span>
                  <span className="mono" style={{ color: reached ? "#3DDC97" : "#5C666F" }}>{reached ? "✓ 달성" : pct.toFixed(0) + "%"}</span>
                </div>
                <div className="w-full rounded-full h-1 mt-1" style={{ background: "#1A2027" }}>
                  <div className="h-1 rounded-full" style={{ width: pct + "%", background: reached ? "#3DDC97" : "#4FD1C5" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BottomNav({ tab, onChange, badge }) {
  return (
    <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 45, background: "rgba(11,14,17,0.94)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderTop: "1px solid #1F262D", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="max-w-3xl mx-auto flex">
        {TABS.map(function (t) {
          var on = tab === t.key;
          var Ico = t.Icon;
          return (
            <button key={t.key} onClick={function () { onChange(t.key); }} aria-label={t.label} aria-current={on ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-1"
              style={{ padding: "9px 0 7px", position: "relative" }}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <Ico size={20} color={on ? "#4FD1C5" : "#5C666F"} />
                {t.key === "home" && badge > 0 && (
                  <span className="mono" style={{ position: "absolute", top: -5, right: -8, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 999, background: "#FF5C5C", color: "#0B0E11", fontSize: "9px", fontWeight: "bold", lineHeight: "15px", textAlign: "center" }}>{badge}</span>
                )}
              </span>
              <span style={{ color: on ? "#4FD1C5" : "#5C666F", fontSize: "10px", fontWeight: on ? "bold" : "normal" }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function AccountChips({ value, onChange, totals, fx }) {
  var items = [{ key: "all", label: "전체", color: "#E8ECEF" }].concat(ACCOUNTS.map(function (a) { return { key: a.key, label: a.label, color: a.color }; }));
  return (
    <div className="chips flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
      {items.map(function (it) {
        var on = value === it.key;
        var amt = (totals && totals[it.key]) || 0;
        return (
          <button key={it.key} onClick={function () { onChange(it.key); }}
            className="flex-shrink-0 rounded-full flex items-center gap-1.5"
            style={{ padding: "7px 12px", background: on ? "#132A28" : "#161C22", border: "1px solid " + (on ? "#4FD1C5" : "#1F262D") }}>
            {it.key !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: it.color }} />}
            <span style={{ color: on ? "#4FD1C5" : "#8B96A5", fontSize: "12px", fontWeight: on ? "bold" : "normal", whiteSpace: "nowrap" }}>{it.label}</span>
            <span className="mono" style={{ color: on ? "#4FD1C5" : "#4A535C", fontSize: "10px", whiteSpace: "nowrap", opacity: 0.85 }}>{fmtKRWShort(amt * fx)}</span>
          </button>
        );
      })}
    </div>
  );
}

function AccountBadge({ account }) {
  var a = accountOf(account);
  return <span className="px-1.5 py-0.5 rounded" style={{ background: "#1A2027", color: a.color, fontSize: "10px", whiteSpace: "nowrap" }}>{a.short}</span>;
}

function SectionTitle({ children, tip, title, right }) {
  return (
    <div className="flex items-center justify-between mb-2 gap-2">
      <div className="flex items-center text-sm font-bold">{children}{tip && <Tip title={title || children} text={tip} />}</div>
      {right}
    </div>
  );
}

const TABS = [
  { key: "home", label: "홈", Icon: HomeIcon },
  { key: "assets", label: "내 자산", Icon: WalletIcon },
  { key: "portfolio", label: "포트폴리오", Icon: PieIcon },
  { key: "lab", label: "시뮬레이터", Icon: LabIcon },
  { key: "settings", label: "설정", Icon: Settings }
];

// ═══ [7] 기능 컴포넌트 ═══════════════════════════════════════════════

// ── 홈: 알림 카드 (세일 및 리밸런싱) ──
function AlertCard({ item, onJump }) {
  var h = item.h, meta = STATUS_META[item.status];
  var isReb = item.status === "rebalance";
  var gap = isReb ? null : triggerGapText(h);
  return (
    <button onClick={function () { onJump(h.id); }} className="w-full text-left rounded-lg p-3.5 flex items-center gap-3"
      style={{ background: "#161C22", border: "1px solid " + (item.status === "t2" ? "#4A2126" : (isReb ? "#332244" : "#4A3B1F")) }}>
      <div className="flex-shrink-0 rounded-md flex items-center justify-center" style={{ width: 38, height: 38, background: item.status === "t2" ? "#2A1518" : (isReb ? "#1D1328" : "#2A2113") }}>
        <TagIcon size={18} color={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="mono font-bold text-sm">{h.ticker}</span>
          <span style={{ color: "#8B96A5", fontSize: "12px" }}>{h.name}</span>
          <AccountBadge account={h.account} />
        </div>
        <div style={{ color: meta.color, fontSize: "11px", marginTop: 2 }}>
          {meta.label} · {isReb ? "현재 비중 " + item.weight.toFixed(1) + "%" : "최고가 대비 " + item.drop.toFixed(1) + "%"} · {meta.note}
        </div>
        {gap && <div className="mono" style={{ color: "#5C666F", fontSize: "10px", marginTop: 1 }}>{gap}</div>}
      </div>
      <ChevronRight size={16} color="#5C666F" />
    </button>
  );
}

function HoldingCard({ h, expanded, onToggle, onChange, onDelete, onRefresh, busy, refreshDisabled, weightPct, registerRef }) {
  const [delArmed, fireDelete] = useArmed(2500);
  const [advOpen, setAdvOpen] = useState(false);
  const status = statusOf(h);
  const meta = STATUS_META[status];
  const d = dropPct(h);
  const value = h.qty * h.price;
  const yld = calcYield(h);
  const prf = calcProfit(h);
  const targetQty = h.targetQty || 0;
  const remainingQty = Math.max(0, targetQty - h.qty);
  const remainingAmount = remainingQty * h.price;
  const targetProgress = targetQty > 0 ? Math.min(100, (h.qty / targetQty) * 100) : 0;
  const sym = h.isKRW ? "₩" : "$";
  const gapText = triggerGapText(h);
  const acc = accountOf(h.account);

  return (
    <div ref={registerRef} className="panel rounded-lg overflow-hidden" style={{ borderLeft: "3px solid " + acc.color }}>
      <div className="flex items-center justify-between p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full led flex-shrink-0" style={{ background: meta.color, color: meta.color }} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="mono font-bold text-sm">{h.ticker}</span>
              <span style={{ color: "#8B96A5", fontSize: "12px" }}>{h.name}</span>
              <AccountBadge account={h.account} />
              {h.isCrypto && <span className="px-1.5 py-0.5 rounded" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "10px" }}>코인</span>}
              {h.isKRW && <span className="px-1.5 py-0.5 rounded" style={{ background: "#1A2027", color: "#B18CFF", fontSize: "10px" }}>국내</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              <span style={{ color: meta.color, fontSize: "11px" }}>{meta.label} · 최고가 대비 {d.toFixed(1)}%</span>
              <DayChange pct={h.dayPct} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="text-right mr-1">
            <div className="mono text-sm font-bold">{fmtCurrency(value, h.isKRW)}</div>
            {h.qty > 0 && h.avgPrice > 0 && (
              <div className="mono" style={{ color: yld >= 0 ? "#3DDC97" : "#FF5C5C", fontSize: "10px" }}>{yld >= 0 ? "+" : ""}{yld.toFixed(1)}%</div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onRefresh(); }} disabled={busy || refreshDisabled} aria-label={h.ticker + " 시세 새로고침"} className="p-2 hover:bg-gray-800 rounded">
            <RefreshCw size={15} color="#4FD1C5" className={busy ? "animate-spin" : ""} />
          </button>
          {expanded ? <ChevronUp size={16} color="#8B96A5" /> : <ChevronDown size={16} color="#8B96A5" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: "1px solid #1F262D" }}>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Field label={T.qty} value={h.qty} onChange={(v) => onChange("qty", v)} />
            <Field label={T.avgPrice + "(" + sym + ")"} tip={TIP.avgPrice} tipTitle={T.avgPrice} value={h.avgPrice || 0} onChange={(v) => onChange("avgPrice", v)} />
            <Field label={T.price + "(" + sym + ")"} value={h.price} onChange={(v) => onChange("price", v)} />
          </div>

          <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: "1px solid #1F262D" }}>
            <div>
              <div className="flex items-center gap-2">
                <span className="mono" style={{ color: d <= 0 ? "#FF5C5C" : "#3DDC97", fontSize: "12px", fontWeight: "bold" }}>최고가 대비 {d.toFixed(1)}%</span>
                {h.mdd ? <span className="mono" style={{ color: "#5C666F", fontSize: "10px" }}>(역대 최악 {h.mdd}%)</span> : null}
              </div>
              {h.qty > 0 && h.avgPrice > 0 && (
                <div className="mono mt-0.5" style={{ color: yld >= 0 ? "#3DDC97" : "#FF5C5C", fontSize: "12px" }}>
                  내 수익 {yld >= 0 ? "+" : ""}{yld.toFixed(1)}% ({fmtCurrency(prf, h.isKRW)})
                </div>
              )}
              {gapText && <div className="mono mt-0.5" style={{ color: "#8B96A5", fontSize: "10px" }}>{gapText}</div>}
            </div>
            <div className="text-right">
              <LabelTip tip={TIP.weight} title="비중" color="#8B96A5" size="11px">비중</LabelTip>
              <div className="mono" style={{ color: weightPct >= 30 ? "#B18CFF" : "#8B96A5", fontSize: "12px" }}>{(weightPct || 0).toFixed(1)}%</div>
            </div>
          </div>

          {targetQty > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1F262D" }}>
              <div className="flex justify-between mb-1" style={{ color: "#8B96A5", fontSize: "11px" }}>
                <span>모으기 달성률 (목표 {targetQty})</span>
                <span className="mono">{targetProgress.toFixed(0)}%</span>
              </div>
              <div className="w-full rounded-full h-1.5 mb-1.5" style={{ background: "#1A2027" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${targetProgress}%`, background: remainingQty <= 0 ? "#3DDC97" : "#4FD1C5" }} />
              </div>
              <div className="mono" style={{ color: remainingQty <= 0 ? "#3DDC97" : "#B8C1CA", fontSize: "12px" }}>
                {remainingQty <= 0 ? "✅ 목표 수량을 다 채웠어요!" : `${remainingQty}개 더 (약 ${fmtCurrency(remainingAmount, h.isKRW)} 필요)`}
              </div>
            </div>
          )}

          <button onClick={() => setAdvOpen((s) => !s)} className="w-full mt-3 py-2 rounded-md flex items-center justify-center gap-1.5"
            style={{ background: "#161C22", border: "1px solid #1F262D", color: "#8B96A5", fontSize: "11px" }}>
            {advOpen ? "상세 설정 접기" : "상세 설정 열기 (알림·배당·목표)"}
            {advOpen ? <ChevronUp size={13} color="#8B96A5" /> : <ChevronDown size={13} color="#8B96A5" />}
          </button>

          {advOpen && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 flex items-center" style={{ color: "#5C666F", fontSize: "10px" }}>
                    자산 성격<Tip title="든든한 기둥 / 보너스 알파" text={TIP.coreSat} />
                  </div>
                  <div className="flex rounded overflow-hidden" style={{ border: "1px solid #1F262D" }}>
                    {[{ k: "core", l: T.core }, { k: "satellite", l: T.satellite }].map((o) => (
                      <button key={o.k} onClick={() => onChange("category", o.k)} className="flex-1 py-1.5"
                        style={{ background: h.category === o.k ? "#132A28" : "#0B0E11", color: h.category === o.k ? "#4FD1C5" : "#5C666F", fontSize: "11px" }}>{o.l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>계좌</div>
                  <select value={h.account} onChange={(e) => onChange("account", e.target.value)} className="w-full text-sm rounded px-2 py-1.5"
                    style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }}>
                    {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={T.high52 + "(" + sym + ")"} tip={TIP.high52} tipTitle={T.high52} value={h.high52} onChange={(v) => onChange("high52", v)} />
                <Field label={T.targetQty} tip={TIP.targetQty} tipTitle={T.targetQty} value={h.targetQty || 0} onChange={(v) => onChange("targetQty", v)} />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2" style={{ borderTop: "1px dashed #1F262D" }}>
                <Field label={T.t1 + "(%)"} tip={TIP.trigger} tipTitle={T.t1} negative value={h.t1 || 0} onChange={(v) => onChange("t1", v)} />
                <Field label={T.t2 + "(%)"} tip={TIP.trigger} tipTitle={T.t2} negative value={h.t2 || 0} onChange={(v) => onChange("t2", v)} />
                <Field label={T.mdd + "(%)"} tip={TIP.mdd} tipTitle={T.mdd} negative value={h.mdd || 0} onChange={(v) => onChange("mdd", v)} />
              </div>
              <div style={{ color: "#4A535C", fontSize: "9px" }}>0을 넣으면 그 알림은 꺼져요 · 언제든 수정할 수 있어요</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={T.div + "(" + sym + ")"} tip={TIP.dividend} tipTitle="연 배당금" value={h.divPerShare || 0} onChange={(v) => onChange("divPerShare", v)} />
                <div>
                  <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>내 예상 연 배당금</div>
                  <div className="mono text-sm rounded px-2 py-1.5" style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#60A5FA" }}>{fmtCurrency(h.qty * (h.divPerShare || 0), h.isKRW)}</div>
                </div>
              </div>
              <button onClick={() => fireDelete(onDelete)} className="w-full py-2 rounded-md flex items-center justify-center gap-1.5"
                style={{ background: delArmed ? "#3A171B" : "#161C22", border: "1px solid " + (delArmed ? "#4A2126" : "#1F262D"), color: delArmed ? "#FF5C5C" : "#5C666F", fontSize: "11px" }}>
                <Trash2 size={13} color={delArmed ? "#FF5C5C" : "#5C666F"} />
                {delArmed ? "한 번 더 누르면 삭제돼요" : "이 종목 삭제"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Phase2Card({ p, onChange, onRefresh, busy, refreshDisabled, weightPct }) {
  const [open, setOpen] = useState(false);
  const value = p.qty * p.price;
  const d = dropPct(p);
  const yld = calcYield(p);
  const prf = calcProfit(p);
  const sym = p.isKRW ? "₩" : "$";
  const acc = accountOf(p.account);
  return (
    <div className="panel rounded-lg overflow-hidden" style={{ borderLeft: "3px solid " + acc.color }}>
      <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setOpen((s) => !s)}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="mono font-bold text-sm">{p.ticker}</span>
            <span style={{ color: "#8B96A5", fontSize: "12px" }}>{p.name}</span>
            <AccountBadge account={p.account} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <span style={{ color: "#8B96A5", fontSize: "11px" }}>최고가 대비 {d.toFixed(1)}%</span>
            <DayChange pct={p.dayPct} />
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="text-right mr-1">
            <div className="mono text-sm font-bold">{fmtCurrency(value, p.isKRW)}</div>
            {p.qty > 0 && p.avgPrice > 0 && (
              <div className="mono" style={{ color: yld >= 0 ? "#3DDC97" : "#FF5C5C", fontSize: "10px" }}>{yld >= 0 ? "+" : ""}{yld.toFixed(1)}%</div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onRefresh(); }} disabled={busy || refreshDisabled} aria-label={p.ticker + " 시세 새로고침"} className="p-2 hover:bg-gray-800 rounded">
            <RefreshCw size={15} color="#4FD1C5" className={busy ? "animate-spin" : ""} />
          </button>
          {open ? <ChevronUp size={16} color="#8B96A5" /> : <ChevronDown size={16} color="#8B96A5" />}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4" style={{ borderTop: "1px solid #1F262D" }}>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Field label={T.qty} value={p.qty} onChange={(v) => onChange("qty", v)} />
            <Field label={T.avgPrice + "(" + sym + ")"} tip={TIP.avgPrice} tipTitle={T.avgPrice} value={p.avgPrice || 0} onChange={(v) => onChange("avgPrice", v)} />
            <Field label={T.price + "(" + sym + ")"} value={p.price} onChange={(v) => onChange("price", v)} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label={T.div + "(" + sym + ")"} tip={TIP.dividend} tipTitle="연 배당금" value={p.divPerShare || 0} onChange={(v) => onChange("divPerShare", v)} />
            <div>
              <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>내 예상 연 배당금</div>
              <div className="mono text-sm rounded px-2 py-1.5" style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#60A5FA" }}>{fmtCurrency(p.qty * (p.divPerShare || 0), p.isKRW)}</div>
            </div>
          </div>
          <div className="mt-2">
            <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>계좌</div>
            <select value={p.account} onChange={(e) => onChange("account", e.target.value)} className="w-full text-sm rounded px-2 py-1.5"
              style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }}>
              {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: "1px solid #1F262D" }}>
            <div className="mono" style={{ color: yld >= 0 ? "#3DDC97" : "#FF5C5C", fontSize: "12px" }}>
              {p.qty > 0 && p.avgPrice > 0 ? "내 수익 " + (yld >= 0 ? "+" : "") + yld.toFixed(1) + "% (" + fmtCurrency(prf, p.isKRW) + ")" : ""}
            </div>
            <div className="mono" style={{ color: "#8B96A5", fontSize: "11px" }}>비중 {(weightPct || 0).toFixed(1)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}

function CashCard({ innerRef, cash, onChange, summary, bilMinPct, filter }) {
  var visible = filter === "all" ? ACCOUNT_KEYS : [filter];
  var shown = visible.reduce(function (s, k) { return s + toNum(cash[k], 0); }, 0);
  return (
    <div ref={innerRef} className="panel rounded-lg p-4" style={{ border: summary.bilLow ? "1px solid #4A3B1F" : "1px solid #1F262D" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center text-sm font-bold">{T.cash}<Tip title={T.cash} text={TIP.cash} /></div>
          <div style={{ color: summary.bilLow ? "#FFB020" : "#8B96A5", fontSize: "11px" }}>
            {summary.bilLow
              ? "⚠ 전체 자산의 " + summary.bilPctOfTotal.toFixed(1) + "%밖에 없어요 (권장 " + bilMinPct + "% 이상)"
              : "전체 자산의 " + summary.bilPctOfTotal.toFixed(1) + "% · 세일 때 꺼내 쓸 돈"}
          </div>
        </div>
        <div className="mono text-sm font-bold flex-shrink-0">{fmtCurrency(shown, false)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visible.map(function (k) {
          var a = accountOf(k);
          return (
            <div key={k}>
              <div className="mb-1 flex items-center gap-1.5" style={{ color: "#5C666F", fontSize: "10px" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />{a.label} ($)
              </div>
              <div className="fld flex items-center rounded" style={{ background: "#0B0E11", border: "1px solid #1F262D" }}>
                <CashInput value={toNum(cash[k], 0)} onChange={function (v) { onChange(k, v); }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RulesPanel({ open, onToggle }) {
  const rows = [
    { color: "#3DDC97", title: "정상가", desc: "계획한 금액만큼 꾸준히 사 모아요" },
    { color: "#FFB020", title: T.t1 + " 도달", desc: "이번 달 매수 금액을 2배로 늘려요" },
    { color: "#FF5C5C", title: T.t2 + " 도달", desc: "비상금을 꺼내서 추가로 사요" }
  ];
  return (
    <div className="panel rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4">
        <div className="flex items-center text-sm font-bold">세일 알림이 켜지면 뭘 하나요?</div>
        {open ? <ChevronUp size={16} color="#8B96A5" /> : <ChevronDown size={16} color="#8B96A5" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ color: "#B8C1CA", fontSize: "12px" }}>
          {rows.map((r) => (
            <div key={r.title} className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
              <div>
                <div className="mono font-bold" style={{ color: "#E8ECEF" }}>{r.title}</div>
                <div style={{ color: "#8B96A5" }}>{r.desc}</div>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 pt-2" style={{ borderTop: "1px solid #1F262D" }}>
            <AlertTriangle size={14} color="#8B96A5" style={{ marginTop: 2, flexShrink: 0 }} />
            <span>사기 전에 한 번만 확인해요. 시장 전체가 같이 내린 건지, 이 회사만 문제가 생긴 건지 구분하는 게 먼저예요.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 종목 추가 모달 (점진적 정보 공개) ──
function AddAssetModal({ defaultAccount, onAdd, onClose }) {
  const [account, setAccount] = useState(ACCOUNT_KEYS.indexOf(defaultAccount) !== -1 ? defaultAccount : "gen1");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState(0);
  const [avgPrice, setAvgPrice] = useState(0);

  const [advOpen, setAdvOpen] = useState(false);
  const [category, setCategory] = useState("core");
  const [isCrypto, setIsCrypto] = useState(false);
  const [isKRW, setIsKRW] = useState(false);
  const [price, setPrice] = useState(0);
  const [high52, setHigh52] = useState(0);
  const [targetQty, setTargetQty] = useState(0);
  const [t1, setT1] = useState(-15);
  const [t2, setT2] = useState(-30);
  const [mdd, setMdd] = useState(0);
  const [divPerShare, setDivPerShare] = useState(0);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [note, setNote] = useState("");
  const searchTimer = useRef(null);

  useEffect(() => {
    var t = ticker.trim();
    if (isCrypto || t.length < 1 || /\.(KS|KQ)$/i.test(t)) { setSuggestions([]); setShowSuggestions(false); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await apiSearch(t);
        setSuggestions(list);
        setShowSuggestions(list.length > 0);
      } catch (e) {} finally { setSearching(false); }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [ticker, isCrypto]);

  useEffect(() => {
    var up = ticker.trim().toUpperCase();
    if (/\.(KS|KQ)$/i.test(up)) setIsKRW(true);
    if (CRYPTO_IDS[up]) setIsCrypto(true);
  }, [ticker]);

  async function selectSuggestion(item) {
    setTicker(item.symbol);
    setName(item.description || item.symbol);
    setShowSuggestions(false);
    setSuggestions([]);
    setAutoFilled(false);
    setNote("");
    setAutoFilling(true);
    try {
      var isKorean = /\.(KS|KQ)$/i.test(item.symbol) || item.type === "KR";
      if (isKorean) setIsKRW(true);
      const q = await apiQuote(item.symbol, isKorean).catch(() => null);
      if (q) { setPrice(q.price); setHigh52(Math.max(q.price, q.dayHigh || 0, q.high52 || 0)); }
      if (!isKorean) {
        const m = await apiMetric(item.symbol);
        if (m.div != null) setDivPerShare(m.div);
        if (m.high52 > 0) setHigh52((prev) => Math.max(prev, m.high52));
      }
      if (q) {
        setAutoFilled(true);
        if (isKorean) setNote("국내 종목은 배당금을 자동으로 못 가져와요 — 상세 설정에서 직접 넣어주세요");
      } else {
        setNote("지금 가격을 못 가져왔어요 — 상세 설정에서 직접 넣어주세요");
      }
    } catch (e) {
      setNote("자동 채우기에 실패했어요 — 상세 설정에서 직접 넣어주세요");
    } finally { setAutoFilling(false); }
  }

  async function fillCryptoPrice() {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    if (!CRYPTO_IDS[t]) { setNote("자동 시세를 지원하지 않는 코인이에요 (지원: " + SUPPORTED_COINS_LABEL + ")"); return; }
    setAutoFilling(true); setNote("");
    try {
      const prices = await apiCryptoPrices([t]);
      const pr = prices[t];
      if (!pr) throw new Error("no price");
      setPrice(pr.price); setHigh52((prev) => Math.max(prev, pr.price));
      setAutoFilled(true);
      if (!name) setName(t);
    } catch (e) { setNote("코인 시세 조회에 실패했어요 — 직접 넣어주세요"); } finally { setAutoFilling(false); }
  }

  const sym = isKRW ? "₩" : "$";
  const canSubmit = ticker.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    onAdd({ ticker: ticker.trim().toUpperCase(), name: name || ticker.trim().toUpperCase(), category, account, isCrypto, isKRW, qty, avgPrice, price: price || avgPrice, high52: Math.max(high52, price || avgPrice), targetQty, t1, t2, mdd, divPerShare });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.8)" }} onClick={onClose}>
      <div className="w-full sm:max-w-md relative" style={{ maxHeight: "92vh", overflowY: "auto", background: "#12161B", border: "1px solid #1F262D", borderRadius: "16px 16px 0 0" }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: "#12161B", borderBottom: "1px solid #1F262D", zIndex: 12 }}>
          <div>
            <div className="text-base font-bold">종목 추가하기</div>
            <div style={{ color: "#5C666F", fontSize: "11px" }}>4가지만 넣으면 나머지는 자동으로 채워져요</div>
          </div>
          <button onClick={onClose} aria-label="닫기" className="p-1 rounded hover:bg-gray-800"><X size={20} color="#8B96A5" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 pb-24">
          <div>
            <div className="mb-1 flex items-center" style={{ color: "#5C666F", fontSize: "10px" }}>
              어느 계좌인가요?<Tip title="계좌 선택" text={accountOf(account).desc} />
            </div>
            <select value={account} onChange={(e) => setAccount(e.target.value)} className="w-full text-sm rounded px-2 py-2.5"
              style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }}>
              {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>

          <div className="relative">
            <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>
              종목 이름 또는 티커 <span style={{ color: "#4A535C" }}>· 몇 글자만 쳐도 자동으로 찾아줘요</span>
            </div>
            <input value={ticker} onChange={(e) => { setTicker(e.target.value.toUpperCase()); setAutoFilled(false); }}
              onFocus={(e) => { setShowSuggestions(suggestions.length > 0); setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }}
              placeholder="예: AAPL, 삼성전자, 005930"
              className="tinput mono w-full text-sm rounded px-2 py-2.5" style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }} />
            {searching && <div style={{ position: "absolute", right: 10, top: 34, fontSize: "10px", color: "#5C666F" }}>찾는 중</div>}
            {showSuggestions && (
              <div className="absolute z-20 mt-1 rounded-md overflow-hidden left-0 right-0"
                style={{ background: "rgba(15, 23, 31, 0.97)", backdropFilter: "blur(10px)", border: "1px solid #2B3544", maxHeight: "220px", overflowY: "auto", boxShadow: "0 10px 25px rgba(0,0,0,0.6)" }}>
                {suggestions.map((s, index) => (
                  <button key={s.symbol} type="button" onClick={() => selectSuggestion(s)}
                    className="w-full text-left px-3 py-2.5"
                    style={{ fontSize: "11px", color: "#E8ECEF", borderBottom: index < suggestions.length - 1 ? "1px solid #252F3A" : "none" }}>
                    <span className="mono font-bold" style={{ color: "#4FD1C5" }}>{s.symbol}</span>
                    <span className="ml-1" style={{ color: "#8B96A5" }}>{s.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {name && (
            <div>
              <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>화면에 표시할 이름</div>
              <input value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }} className="tinput w-full text-sm rounded px-2 py-2"
                style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }} />
            </div>
          )}

          {autoFilling && <div style={{ color: "#4FD1C5", fontSize: "11px" }}>지금 가격이랑 배당금 가져오는 중...</div>}
          {autoFilled && !autoFilling && <div style={{ color: "#3DDC97", fontSize: "11px" }}>지금 가격 {fmtCurrency(price, isKRW)} · 1년 최고가까지 자동으로 채웠어요</div>}
          {note && !autoFilling && <div style={{ color: "#FFB020", fontSize: "11px" }}>{note}</div>}

          <div className="grid grid-cols-2 gap-2">
            <Field label={T.qty} value={qty} onChange={setQty} hint="아직 안 샀으면 0으로 두세요" />
            <Field label={T.avgPrice + " (" + sym + ")"} tip={TIP.avgPrice} tipTitle={T.avgPrice} value={avgPrice} onChange={setAvgPrice} />
          </div>

          {isCrypto && (
            <button type="button" onClick={fillCryptoPrice} disabled={autoFilling} className="w-full py-2 rounded-md"
              style={{ background: "#1A2027", color: "#4FD1C5", fontSize: "11px", border: "1px solid #1F262D" }}>
              코인 지금 가격 불러오기
            </button>
          )}

          <button onClick={() => setAdvOpen((s) => !s)} className="w-full py-2.5 rounded-md flex items-center justify-center gap-1.5"
            style={{ background: "#161C22", border: "1px solid " + (advOpen ? "#4FD1C5" : "#1F262D"), color: advOpen ? "#4FD1C5" : "#8B96A5", fontSize: "12px" }}>
            {advOpen ? "고급 옵션 닫기" : "고급 옵션 열기 (나만의 맞춤 알림 설정)"}
            {advOpen ? <ChevronUp size={14} color={advOpen ? "#4FD1C5" : "#8B96A5"} /> : <ChevronDown size={14} color="#8B96A5" />}
          </button>

          {advOpen && (
            <div className="space-y-3 rounded-md p-3" style={{ background: "#0F1318", border: "1px solid #1F262D" }}>
              <div style={{ color: "#8B96A5", fontSize: "11px", lineHeight: 1.6 }}>
                알림 기준은 <span style={{ color: "#FFB020" }}>-15% / -30%</span>로 미리 넣어뒀어요. 언제든 수정할 수 있어요.
              </div>
              <div>
                <div className="mb-1 flex items-center" style={{ color: "#5C666F", fontSize: "10px" }}>
                  자산 성격<Tip title="든든한 기둥 / 보너스 알파" text={TIP.coreSat} />
                </div>
                <div className="flex rounded overflow-hidden" style={{ border: "1px solid #1F262D" }}>
                  {[{ k: "core", l: T.core }, { k: "satellite", l: T.satellite }].map((o) => (
                    <button key={o.k} onClick={() => setCategory(o.k)} className="flex-1 py-2"
                      style={{ background: category === o.k ? "#132A28" : "#0B0E11", color: category === o.k ? "#4FD1C5" : "#5C666F", fontSize: "12px" }}>{o.l}</button>
                  ))}
                </div>
              </div>
              <Field label={T.targetQty} tip={TIP.targetQty} tipTitle={T.targetQty} value={targetQty} onChange={setTargetQty} />
              <div className="grid grid-cols-3 gap-2">
                <Field label={T.t1 + "(%)"} tip={TIP.trigger} tipTitle={T.t1} negative value={t1} onChange={setT1} />
                <Field label={T.t2 + "(%)"} tip={TIP.trigger} tipTitle={T.t2} negative value={t2} onChange={setT2} />
                <Field label={T.mdd + "(%)"} tip={TIP.mdd} tipTitle={T.mdd} negative value={mdd} onChange={setMdd} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={T.price + " (" + sym + ")"} value={price} onChange={setPrice} />
                <Field label={T.high52 + " (" + sym + ")"} tip={TIP.high52} tipTitle={T.high52} value={high52} onChange={setHigh52} />
              </div>
              <Field label={T.div + " (" + sym + ")"} tip={TIP.dividend} tipTitle="연 배당금" value={divPerShare} onChange={setDivPerShare} />
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-1.5" style={{ color: "#B8C1CA", fontSize: "12px" }}>
                  <input type="checkbox" checked={isCrypto} onChange={(e) => { setIsCrypto(e.target.checked); setNote(""); }} /> 코인이에요
                </label>
                <label className="flex items-center gap-1.5" style={{ color: "#B8C1CA", fontSize: "12px" }}>
                  <input type="checkbox" checked={isKRW} onChange={(e) => { setIsKRW(e.target.checked); setNote(""); }} /> 국내 상장(원화)
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-5 py-4 flex gap-2" style={{ background: "#12161B", borderTop: "1px solid #1F262D", zIndex: 12 }}>
          <button onClick={onClose} className="px-4 py-3 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "13px" }}>취소</button>
          <button onClick={submit} disabled={!canSubmit} className="flex-1 py-3 rounded-md font-bold"
            style={{ background: canSubmit ? "#4FD1C5" : "#1A2027", color: canSubmit ? "#0B0E11" : "#4A535C", fontSize: "13px" }}>
            {accountOf(account).label}에 추가하기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 온보딩 위자드 ──
function OnboardingWizard({ onFinish, onSkip }) {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(DEFAULT_GOALS.finalGoalKRW);
  const [customGoal, setCustomGoal] = useState(0);
  const [picked, setPicked] = useState([]);
  const [account, setAccount] = useState("gen1");

  function togglePick(t) {
    setPicked(function (prev) {
      if (prev.indexOf(t) !== -1) return prev.filter(function (x) { return x !== t; });
      if (prev.length >= 3) return prev;
      return prev.concat([t]);
    });
  }

  const finalGoal = customGoal > 0 ? customGoal * 100000000 : goal;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.86)" }}>
      <div className="w-full sm:max-w-md" style={{ maxHeight: "92vh", overflowY: "auto", background: "#12161B", border: "1px solid #1F262D", borderRadius: "16px 16px 0 0" }}>
        <div className="px-5 pt-5 pb-3">
          <div className="flex gap-1.5 mb-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex-1 h-1 rounded-full" style={{ background: i <= step ? "#4FD1C5" : "#1F262D" }} />
            ))}
          </div>
          {step === 0 && (
            <div>
              <div style={{ fontSize: "26px" }}>👋</div>
              <div className="text-lg font-bold mt-2">아직 입력된 자산이 없네요.</div>
              <div className="mt-1" style={{ color: "#8B96A5", fontSize: "13px", lineHeight: 1.7 }}>
                5분이면 나만의 포트폴리오를 만들 수 있어요.<br />
                어려운 용어는 전부 일상어로 바꿔뒀고, 헷갈리는 곳엔 <span style={{ color: "#4FD1C5" }}>?</span> 버튼을 눌러 설명을 볼 수 있어요.
              </div>
              <div className="mt-4 rounded-md p-3 space-y-2" style={{ background: "#0F1318", border: "1px solid #1F262D", fontSize: "12px", color: "#B8C1CA" }}>
                <div>1️⃣ 목표 금액을 정하고</div>
                <div>2️⃣ 주력 자산을 고르면</div>
                <div>3️⃣ 오늘의 브리핑이 자동으로 만들어져요</div>
              </div>
            </div>
          )}
          {step === 1 && (
            <div>
              <div className="text-lg font-bold">당신의 1차 목표 금액은 얼마인가요?</div>
              <div className="mt-1" style={{ color: "#8B96A5", fontSize: "12px" }}>나중에 설정에서 언제든 바꿀 수 있어요.</div>
              <div className="grid grid-cols-2 gap-2 mt-4">
                {GOAL_PRESETS.map((g) => {
                  var on = customGoal === 0 && goal === g.value;
                  return (
                    <button key={g.value} onClick={() => { setGoal(g.value); setCustomGoal(0); }}
                      className="py-3 rounded-md font-bold"
                      style={{ background: on ? "#132A28" : "#161C22", border: "1px solid " + (on ? "#4FD1C5" : "#1F262D"), color: on ? "#4FD1C5" : "#B8C1CA", fontSize: "14px" }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Field label="직접 입력 (억원)" value={customGoal} onChange={setCustomGoal} hint="0이면 위에서 고른 금액을 써요" />
              </div>
              <div className="mt-3 rounded-md px-3 py-2.5" style={{ background: "#0F1318", border: "1px solid #1F262D", color: "#8B96A5", fontSize: "12px" }}>
                목표 <span className="mono" style={{ color: "#4FD1C5" }}>{fmtKRWShort(finalGoal)}</span> · 홈 화면 게이지가 이 금액을 기준으로 채워져요
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="text-lg font-bold">주력으로 투자하는 자산 3가지를 골라주세요</div>
              <div className="mt-1" style={{ color: "#8B96A5", fontSize: "12px" }}>수량은 나중에 넣어도 돼요. 고르면 목록에 카드가 만들어져요.</div>
              <div className="flex flex-wrap gap-2 mt-4">
                {STARTER_ASSETS.map((a) => {
                  var on = picked.indexOf(a.ticker) !== -1;
                  return (
                    <button key={a.ticker} onClick={() => togglePick(a.ticker)}
                      className="rounded-full px-3 py-2"
                      style={{ background: on ? "#132A28" : "#161C22", border: "1px solid " + (on ? "#4FD1C5" : "#1F262D"), color: on ? "#4FD1C5" : "#B8C1CA", fontSize: "12px" }}>
                      {a.name} <span className="mono" style={{ opacity: 0.6, fontSize: "10px" }}>{a.ticker}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3" style={{ color: picked.length === 3 ? "#3DDC97" : "#5C666F", fontSize: "11px" }}>
                {picked.length}/3 선택됨 {picked.length === 0 ? "· 건너뛰고 나중에 추가해도 괜찮아요" : ""}
              </div>
              <div className="mt-4">
                <div className="mb-1" style={{ color: "#5C666F", fontSize: "10px" }}>주로 쓰는 계좌</div>
                <select value={account} onChange={(e) => setAccount(e.target.value)} className="w-full text-sm rounded px-2 py-2.5"
                  style={{ background: "#0B0E11", border: "1px solid #1F262D", color: "#E8ECEF" }}>
                  {ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 flex gap-2" style={{ borderTop: "1px solid #1F262D" }}>
          {step === 0 ? (
            <button onClick={onSkip} className="px-4 py-3 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "13px" }}>나중에</button>
          ) : (
            <button onClick={() => setStep(step - 1)} className="px-4 py-3 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "13px" }}>이전</button>
          )}
          <button
            onClick={() => { if (step < 2) setStep(step + 1); else onFinish({ finalGoalKRW: finalGoal, tickers: picked, account: account }); }}
            className="flex-1 py-3 rounded-md font-bold" style={{ background: "#4FD1C5", color: "#0B0E11", fontSize: "13px" }}>
            {step < 2 ? "다음" : (picked.length ? "포트폴리오 만들기" : "빈 상태로 시작하기")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 빈 화면 ──
function EmptyState({ onLoadTemplate, onAdd, onRestartOnboarding }) {
  return (
    <div className="space-y-3">
      <div className="panel rounded-lg p-6 text-center">
        <div style={{ fontSize: "30px" }}>🌱</div>
        <div className="text-base font-bold mt-2">아직 입력된 자산이 없네요.</div>
        <div className="mt-1.5" style={{ color: "#8B96A5", fontSize: "12px", lineHeight: 1.7 }}>
          5분이면 나만의 포트폴리오를 만들 수 있어요.<br />직접 넣기가 부담되면 예시 템플릿부터 열어보세요.
        </div>
        <button onClick={onAdd} className="w-full mt-4 py-3 rounded-md font-bold flex items-center justify-center gap-1.5"
          style={{ background: "#4FD1C5", color: "#0B0E11", fontSize: "13px" }}>
          <Plus size={15} color="#0B0E11" /> 첫 종목 추가하기
        </button>
        <button onClick={onRestartOnboarding} className="w-full mt-2 py-2.5 rounded-md"
          style={{ background: "#1A2027", color: "#8B96A5", fontSize: "12px" }}>
          질문 몇 개로 시작하기
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {Object.keys(TEMPLATES).map(function (k) {
          var t = TEMPLATES[k];
          return (
            <button key={k} onClick={function () { onLoadTemplate(k); }} className="panel rounded-lg p-4 text-left flex items-center gap-3">
              <div className="flex-shrink-0 rounded-md flex items-center justify-center" style={{ width: 40, height: 40, background: "#1A2027", fontSize: "19px" }}>{t.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{t.title} 불러오기</div>
                <div style={{ color: "#8B96A5", fontSize: "11px" }}>{t.sub}</div>
              </div>
              <ChevronRight size={16} color="#5C666F" />
            </button>
          );
        })}
      </div>
      <div className="text-center" style={{ color: "#4A535C", fontSize: "10px" }}>템플릿은 예시 데이터예요. 불러온 뒤 수량·평균가만 내 것으로 바꾸면 됩니다.</div>
    </div>
  );
}

// ═══ [8] 탭 화면 ════════════════════════════════════════════════════

// ── 탭 1. 홈 ──
function HomeTab({ summary, goals, history, lastPriceSync, needsInitialSync, isOnline, bulk, onRefreshAll, onJumpHolding, onJumpCash, showRules, onToggleRules, onGoAssets }) {
  const s = summary;
  const dayUp = s.dayChangeUSD >= 0;
  const alerts = s.actionItems;

  return (
    <div className="space-y-5">
      {needsInitialSync && isOnline && (
        <button onClick={onRefreshAll} disabled={!!bulk} className="w-full rounded-lg p-4 flex items-center justify-center gap-2 pulse-cta"
          style={{ background: "#132A28", border: "1px solid #4FD1C5" }}>
          <RefreshCw size={18} color="#4FD1C5" className={bulk ? "animate-spin" : ""} />
          <span style={{ color: "#4FD1C5", fontSize: "13px", fontWeight: "bold" }}>
            {bulk ? "최신 가격 불러오는 중... " + bulk.done + "/" + bulk.total : "먼저 최신 가격으로 한 번 새로고침하기"}
          </span>
        </button>
      )}

      {/* 오늘의 브리핑 */}
      <div className="panel rounded-lg p-5">
        <div style={{ color: "#5C666F", fontSize: "11px" }}>{greetingByHour()}</div>
        <div className="flex items-center mt-0.5" style={{ color: "#8B96A5", fontSize: "12px" }}>
          내 전체 자산<Tip title="내 전체 자산" text={TIP.totalValue} />
        </div>
        <div className="mono font-bold" style={{ fontSize: "32px", lineHeight: 1.2 }}>{fmtKRWShort(s.totalValueKRW)}</div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="mono" style={{ color: "#8B96A5", fontSize: "12px" }}>{fmtCurrency(s.totalValueUSD, false)}</span>
          {s.totalInvestedUSD > 0 && (
            <span className="mono" style={{ color: s.totalProfitUSD >= 0 ? "#3DDC97" : "#FF5C5C", fontSize: "12px" }}>
              전체 수익 {s.totalProfitUSD >= 0 ? "+" : ""}{s.totalYieldPct.toFixed(1)}%
            </span>
          )}
        </div>

        <div className="mt-4 rounded-lg px-4 py-3.5" style={{ background: s.hasDayData ? (dayUp ? "#132A24" : "#241417") : "#161C22", border: "1px solid " + (s.hasDayData ? (dayUp ? "#25503F" : "#4A2126") : "#1F262D") }}>
          <div className="flex items-center justify-between">
            <span className="flex items-center" style={{ color: "#8B96A5", fontSize: "12px" }}>
              오늘 하루 손익<Tip title="오늘 하루 손익" text={TIP.today} />
            </span>
            {s.hasDayData && s.dayCoverage < 90 && <span style={{ color: "#5C666F", fontSize: "10px" }}>가격을 받아온 자산 기준</span>}
          </div>
          {s.hasDayData ? (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="mono font-bold" style={{ fontSize: "22px", color: dayUp ? "#3DDC97" : "#FF5C5C" }}>
                {dayUp ? "+" : ""}{fmtKRWShort(s.dayChangeKRW)}
              </span>
              <span className="mono" style={{ fontSize: "13px", color: dayUp ? "#3DDC97" : "#FF5C5C" }}>
                ({dayUp ? "+" : ""}{s.dayChangePct.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <div className="mt-1" style={{ color: "#5C666F", fontSize: "12px" }}>가격을 새로고침하면 오늘 변동이 표시돼요</div>
          )}
        </div>
      </div>

      {/* 목표 진행률 */}
      <div className="panel rounded-lg p-5 space-y-4">
        <SectionTitle tip={TIP.step} title="3단계 로드맵">목표까지 얼마나 왔을까</SectionTitle>

        <GoalBar title="1단계 · 성장 자산 모으기" right={s.phase1Progress.toFixed(1) + "%"} pct={s.phase1Progress}
          color={s.phase1Done ? "#3DDC97" : "#4FD1C5"}
          sub={s.phase1Done ? "목표 수량을 다 채웠어요 · 2단계로 넘어가도 좋아요" : "각 종목의 목표 수량 합계 대비 지금 평가액"} />

        <GoalBar title={"2단계 · " + fmtKRWShort(goals.finalGoalKRW) + " 만들기"} right={s.finalProgress.toFixed(2) + "%"}
          color="#B18CFF" segments={[{ pct: s.seg1, color: "#4FD1C5" }, { pct: s.seg2, color: "#B18CFF" }, { pct: s.seg3, color: CASH_COLOR }]} sub={null} />
        <div className="flex gap-3 flex-wrap -mt-2" style={{ color: "#8B96A5", fontSize: "11px" }}>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#4FD1C5" }} />1단계 {fmtKRWShort(s.phase1KRW)}</span>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#B18CFF" }} />2단계 {fmtKRWShort(s.phase2KRW)}</span>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: CASH_COLOR }} />{T.cashShort} {fmtKRWShort(s.cashKRW)}</span>
        </div>

        <GoalBar title={"3단계 · 연 배당 " + fmtKRWShort(goals.dividendGoalKRW)} tip={TIP.dividend} right={fmtKRWShort(s.annualDividendKRW)}
          pct={s.dividendProgress} color={s.dividendGoalReached ? "#60A5FA" : "#B18CFF"}
          sub={s.dividendProgress.toFixed(1) + "% · 세금 떼기 전 기준이에요"} />

        <div className="flex gap-2 pt-1">
          {["성장자산 모으기", "배당·성장 코어로", "배당으로 생활"].map((label, i) => (
            <div key={label} className="flex-1 text-center">
              <div className="h-1 rounded-full mb-1.5" style={{ background: i === s.currentPhaseIdx ? "#4FD1C5" : i < s.currentPhaseIdx ? "#3DDC97" : "#1F262D" }} />
              <div style={{ color: i === s.currentPhaseIdx ? "#E8ECEF" : "#4A535C", fontSize: "11px" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 액션 아이템 */}
      <div>
        <SectionTitle title="지금 확인할 것" right={<span className="mono" style={{ color: alerts.length ? "#FFB020" : "#3DDC97", fontSize: "12px" }}>{alerts.length}건</span>}>
          지금 확인할 것
        </SectionTitle>
        {alerts.length === 0 && !s.bilLow ? (
          <div className="panel rounded-lg p-4 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full" style={{ background: "#3DDC97" }} />
            <span style={{ color: "#8B96A5", fontSize: "12px" }}>세일 중인 종목이 없어요. 계획대로 모아가면 됩니다.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((it) => <AlertCard key={it.h.id} item={it} onJump={onJumpHolding} />)}
            {s.bilLow && (
              <button onClick={onJumpCash} className="w-full text-left rounded-lg p-3.5 flex items-center gap-3" style={{ background: "#161C22", border: "1px solid #4A3B1F" }}>
                <div className="flex-shrink-0 rounded-md flex items-center justify-center" style={{ width: 38, height: 38, background: "#2A2113" }}>
                  <AlertTriangle size={18} color="#FFB020" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">{T.cashShort}이 부족해요</div>
                  <div style={{ color: "#FFB020", fontSize: "11px" }}>전체 자산의 {s.bilPctOfTotal.toFixed(1)}% · 세일이 와도 살 돈이 모자랄 수 있어요</div>
                </div>
                <ChevronRight size={16} color="#5C666F" />
              </button>
            )}
          </div>
        )}
      </div>

      {history && history.length >= 2 && (
        <button onClick={onGoAssets} className="panel rounded-lg p-4 w-full text-left">
          {(function () {
            var view = history.slice(-90);
            var first = view[0].v, last = view[view.length - 1].v;
            var chg = first > 0 ? ((last - first) / first) * 100 : 0;
            var col = last >= first ? "#3DDC97" : "#FF5C5C";
            return (
              <React.Fragment>
                <div className="flex justify-between mb-1.5" style={{ fontSize: "11px" }}>
                  <span style={{ color: "#8B96A5" }}>최근 {view.length}일 자산 흐름</span>
                  <span className="mono" style={{ color: col }}>{(chg >= 0 ? "+" : "") + chg.toFixed(1) + "%"}</span>
                </div>
                <Sparkline data={view} color={col} />
              </React.Fragment>
            );
          })()}
        </button>
      )}

      <RulesPanel open={showRules} onToggle={onToggleRules} />

      {lastPriceSync && (
        <div className="text-center" style={{ color: "#4A535C", fontSize: "10px" }}>
          가격 기준 시각 {fmtSyncTime(lastPriceSync)}
        </div>
      )}
    </div>
  );
}

// ── 탭 2. 내 자산 ──
function AssetsTab({ summary, holdings, phase2, cash, accountFilter, onAccountFilter, sortMode, onSortMode, expandedIds, onToggleExpand, anyExpanded, onToggleAll, onAddClick, changeHolding, changePhase2, removeHolding, refreshAsset, busyKey, bulk, onCashChange, bilMinPct, cardRefs, cashRef, isEmpty, onLoadTemplate, onRestartOnboarding }) {
  const fx = summary.exchangeRate;
  const filt = function (x) { return accountFilter === "all" || x.account === accountFilter; };
  const viewHoldings = holdings.filter(filt);
  const viewPhase2 = phase2.filter(filt);
  const SORT_OPTIONS = [{ key: "default", label: "기본" }, { key: "weight", label: "비중" }, { key: "drop", label: "세일순" }];

  return (
    <div className="space-y-5">
      <AccountChips value={accountFilter} onChange={onAccountFilter} totals={summary.accountTotals} fx={fx} />

      {isEmpty && holdings.length === 0 ? (
        <EmptyState onLoadTemplate={onLoadTemplate} onAdd={onAddClick} onRestartOnboarding={onRestartOnboarding} />
      ) : (
        <React.Fragment>
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center text-sm font-bold">1단계 · 모으는 중<Tip title="1단계 자산" text="목표 수량을 정해두고 세일 때마다 사 모으는 성장 자산이에요." /></div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md overflow-hidden" style={{ border: "1px solid #1F262D" }}>
                  {SORT_OPTIONS.map((o) => (
                    <button key={o.key} onClick={() => onSortMode(o.key)} className="px-2.5 py-1.5"
                      style={{ background: sortMode === o.key ? "#132A28" : "#1A2027", color: sortMode === o.key ? "#4FD1C5" : "#5C666F", fontSize: "11px", fontWeight: sortMode === o.key ? "bold" : "normal" }}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <button onClick={onToggleAll} className="px-2.5 py-1.5 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "11px" }}>
                  {anyExpanded ? "모두 접기" : "모두 펼치기"}
                </button>
              </div>
            </div>

            {viewHoldings.length === 0 ? (
              <div className="panel rounded-lg px-4 py-5 text-center" style={{ color: "#5C666F", fontSize: "12px" }}>
                {accountOf(accountFilter).label}에 담긴 종목이 아직 없어요.
              </div>
            ) : (
              <div className="space-y-2">
                {viewHoldings.map((h) => (
                  <HoldingCard key={h.id} h={h} expanded={!!expandedIds[h.id]} onToggle={() => onToggleExpand(h.id)}
                    onChange={(field, v) => changeHolding(h.id, field, v)} onDelete={() => removeHolding(h.id)}
                    onRefresh={() => refreshAsset(h, "holding")} busy={busyKey === h.id} refreshDisabled={!!bulk}
                    weightPct={summary.weights[h.id]} registerRef={(el) => { cardRefs.current[h.id] = el; }} />
                ))}
              </div>
            )}

            <button onClick={onAddClick} className="w-full mt-2 py-3 rounded-lg flex items-center justify-center gap-1.5"
              style={{ background: "#12161B", border: "1px dashed #2B3544", color: "#4FD1C5", fontSize: "12px" }}>
              <Plus size={14} color="#4FD1C5" /> 종목 추가하기
            </button>
          </div>

          <div>
            <SectionTitle title="2단계 자산" tip="1단계 목표를 채운 뒤 옮겨탈 배당·성장 코어예요. SCHD는 배당, SCHG는 성장을 담당해요."
              right={<span className="mono" style={{ color: "#8B96A5", fontSize: "11px" }}>{fmtCurrency(summary.phase2ValueUSD, false)}</span>}>
              2단계 · SCHD·SCHG
            </SectionTitle>
            {viewPhase2.length === 0 ? (
              <div className="panel rounded-lg px-4 py-5 text-center" style={{ color: "#5C666F", fontSize: "12px" }}>
                이 계좌에는 2단계 자산이 없어요. 카드를 열어 계좌를 바꿀 수 있어요.
              </div>
            ) : (
              <div className="space-y-2">
                {viewPhase2.map((p) => (
                  <Phase2Card key={p.id} p={p} onChange={(field, v) => changePhase2(p.id, field, v)}
                    onRefresh={() => refreshAsset(p, "phase2")} busy={busyKey === p.id} refreshDisabled={!!bulk} weightPct={summary.weights[p.id]} />
                ))}
              </div>
            )}
          </div>

          <CashCard innerRef={cashRef} cash={cash} onChange={onCashChange} summary={summary} bilMinPct={bilMinPct} filter={accountFilter} />
        </React.Fragment>
      )}
    </div>
  );
}

// ── 탭 3. 포트폴리오 ──
function PortfolioTab({ summary, holdings, phase2, cash, history, goals }) {
  const s = summary;
  const fx = s.exchangeRate;
  const bars = holdings.map((h) => ({ key: h.id, ticker: h.ticker, value: toUSD(h.qty * h.price, h.isKRW, fx), color: h.category === "core" ? CATEGORY_COLORS.core : CATEGORY_COLORS.satellite }))
    .concat(phase2.map((p) => ({ key: p.id, ticker: p.ticker, value: toUSD(p.qty * p.price, p.isKRW, fx), color: CATEGORY_COLORS.phase2 })))
    .concat([{ key: "cash", ticker: T.cashShort, value: s.cashTotal, color: CATEGORY_COLORS.cash }])
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const maxVal = bars.length ? Math.max.apply(null, bars.map((y) => y.value)) : 1;
  const view = history ? history.slice(-90) : [];

  return (
    <div className="space-y-5">
      <div className="panel rounded-lg p-5">
        <SectionTitle title="자산 배분" tip={TIP.coreSat}>자산 배분</SectionTitle>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="relative flex-shrink-0" style={{ width: 148, height: 148 }}>
            <DonutChart size={148} strokeWidth={20} segments={[
              { value: s.coreValueUSD, color: CATEGORY_COLORS.core },
              { value: s.satelliteValueUSD, color: CATEGORY_COLORS.satellite },
              { value: s.phase2ValueUSD, color: CATEGORY_COLORS.phase2 },
              { value: s.cashTotal, color: CATEGORY_COLORS.cash }
            ]} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="mono font-bold" style={{ fontSize: "13px" }}>{fmtKRWShort(s.totalValueKRW)}</div>
              <div style={{ color: "#5C666F", fontSize: "10px" }}>전체 자산</div>
            </div>
          </div>
          <div className="flex-1 min-w-[150px] space-y-2" style={{ fontSize: "11px", color: "#8B96A5" }}>
            {[
              { c: CATEGORY_COLORS.core, l: T.core, v: s.corePct },
              { c: CATEGORY_COLORS.satellite, l: T.satellite, v: s.satellitePct },
              { c: CATEGORY_COLORS.phase2, l: "2단계 코어", v: s.phase2Pct },
              { c: CATEGORY_COLORS.cash, l: T.cashShort, v: s.cashPct }
            ].map((x) => (
              <div key={x.l} className="flex justify-between">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: x.c }} />{x.l}</span>
                <span className="mono">{x.v.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
        {bars.length > 0 && (
          <div className="mt-5 pt-4 space-y-2" style={{ borderTop: "1px solid #1F262D" }}>
            {bars.map((x) => (
              <div key={x.key} className="flex items-center gap-2">
                <div className="mono flex-shrink-0 truncate" style={{ width: 56, color: "#8B96A5", fontSize: "11px" }}>{x.ticker}</div>
                <div className="flex-1 rounded-full h-2" style={{ background: "#1A2027" }}>
                  <div className="h-2 rounded-full" style={{ width: `${(x.value / maxVal) * 100}%`, background: x.color }} />
                </div>
                <div className="mono flex-shrink-0 text-right" style={{ width: 72, fontSize: "11px" }}>{fmtCurrency(x.value, false)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 신규: 통화별 환노출 관리 바 */}
      <div className="panel rounded-lg p-5">
        <SectionTitle title="통화별 자산 비중" tip="달러와 원화 자산의 비율을 보여줍니다. 해외 일반 계좌의 비상금은 달러로, 절세 계좌(ISA/IRP/연금)의 비상금은 원화로 계산돼요.">통화별 자산 비중 (환노출)</SectionTitle>
        <div className="mt-4">
           <div className="flex justify-between mb-2" style={{ fontSize: "12px", color: "#8B96A5" }}>
             <span>달러 (USD) <span className="mono text-white font-bold ml-1">{s.usdPct.toFixed(1)}%</span></span>
             <span>원화 (KRW) <span className="mono text-white font-bold ml-1">{s.krwPct.toFixed(1)}%</span></span>
           </div>
           <div className="w-full h-3.5 rounded-full overflow-hidden flex" style={{ background: "#1A2027" }}>
             <div style={{ width: s.usdPct + "%", background: "#4FD1C5", transition: "width .5s ease" }} />
             <div style={{ width: s.krwPct + "%", background: "#B18CFF", transition: "width .5s ease" }} />
           </div>
           <div className="flex justify-between mt-2" style={{ color: "#5C666F", fontSize: "11px" }}>
             <span className="mono">{fmtKRWShort(s.usdValueKRW)}</span>
             <span className="mono">{fmtKRWShort(s.krwValueKRW)}</span>
           </div>
        </div>
      </div>

      <DividendThermometer annualKRW={s.annualDividendKRW} goalKRW={goals.dividendGoalKRW} />

      <div className="panel rounded-lg p-5">
        <SectionTitle title="자산 흐름">최근 90일 자산 흐름</SectionTitle>
        {view.length >= 2 ? (
          (function () {
            var first = view[0].v, last = view[view.length - 1].v;
            var chg = first > 0 ? ((last - first) / first) * 100 : 0;
            var col = last >= first ? "#3DDC97" : "#FF5C5C";
            return (
              <React.Fragment>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="mono font-bold" style={{ fontSize: "18px" }}>{fmtKRWShort(last)}</span>
                  <span className="mono" style={{ color: col, fontSize: "12px" }}>{(chg >= 0 ? "+" : "") + chg.toFixed(1) + "% (" + view.length + "일)"}</span>
                </div>
                <Sparkline data={view} color={col} height={64} />
                <div className="flex justify-between mt-1" style={{ color: "#4A535C", fontSize: "10px" }}>
                  <span>{view[0].d}</span><span>{view[view.length - 1].d}</span>
                </div>
              </React.Fragment>
            );
          })()
        ) : (
          <div style={{ color: "#5C666F", fontSize: "12px", lineHeight: 1.7 }}>
            가격을 새로고침한 날마다 그날의 전체 자산이 자동으로 기록돼요.<br />이틀치가 쌓이면 여기에 그래프가 나타납니다.
          </div>
        )}
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="계좌별 자산">계좌별 자산</SectionTitle>
        <div className="space-y-2.5">
          {ACCOUNTS.map((a) => {
            var v = s.accountTotals[a.key] || 0;
            var pct = s.totalValueUSD > 0 ? (v / s.totalValueUSD) * 100 : 0;
            return (
              <div key={a.key} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: 84 }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                  <span style={{ color: "#8B96A5", fontSize: "11px" }}>{a.label}</span>
                </div>
                <div className="flex-1 rounded-full h-2" style={{ background: "#1A2027" }}>
                  <div className="h-2 rounded-full" style={{ width: pct + "%", background: a.color }} />
                </div>
                <div className="mono flex-shrink-0 text-right" style={{ width: 74, fontSize: "11px" }}>{fmtKRWShort(v * fx)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 탭 4. 설정 ──
function SettingsTab({ exchangeRate, onRateChange, onFetchFx, fxBusy, bilMinPct, onBilMinChange, goals, onGoalsChange, onExport, onImportFile, lastBackupAt, backupStale, onResetAll, onRestartOnboarding, onLoadTemplate, lastSaved, saveError }) {
  const [resetArmed, fireReset] = useArmed(3000);
  return (
    <div className="space-y-4">
      <div className="panel rounded-lg p-5">
        <SectionTitle title="환율">환율</SectionTitle>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="1달러는 몇 원인가요? (₩/$)" value={exchangeRate} onChange={onRateChange} /></div>
          <button onClick={onFetchFx} disabled={fxBusy} className="px-3 rounded" style={{ background: "#1A2027", color: "#4FD1C5", fontSize: "12px", border: "1px solid #1F262D", height: "34px" }}>
            {fxBusy ? "조회중" : "자동으로 가져오기"}
          </button>
        </div>
        <div className="mt-1.5" style={{ color: "#4A535C", fontSize: "10px" }}>달러 자산을 원화로 바꿔 보여줄 때 쓰는 값이에요</div>
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="목표 금액">목표 금액</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <Field label="2단계 목표 (억원)" value={goals.finalGoalKRW / 100000000}
            onChange={(v) => onGoalsChange({ finalGoalKRW: Math.max(0, v) * 100000000, dividendGoalKRW: goals.dividendGoalKRW })} />
          <Field label="연 배당 목표 (만원)" tip={TIP.dividend} tipTitle="연 배당 목표" value={goals.dividendGoalKRW / 10000}
            onChange={(v) => onGoalsChange({ finalGoalKRW: goals.finalGoalKRW, dividendGoalKRW: Math.max(0, v) * 10000 })} />
        </div>
        <div className="mt-1.5" style={{ color: "#4A535C", fontSize: "10px" }}>홈 화면의 2·3단계 게이지가 이 값을 기준으로 채워져요</div>
        <div className="mt-3">
          <Field label={T.cashShort + " 최소 비중 (%)"} tip={TIP.cash} tipTitle={T.cash} value={bilMinPct} onChange={onBilMinChange} />
          <div className="mt-1.5" style={{ color: "#4A535C", fontSize: "10px" }}>전체 자산 대비 이 비율보다 적어지면 홈에서 알려줘요</div>
        </div>
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="계좌 안내">계좌 안내</SectionTitle>
        <div className="space-y-2">
          {ACCOUNTS.map((a) => (
            <div key={a.key} className="flex items-start gap-2.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color, marginTop: 5 }} />
              <div>
                <div style={{ color: "#E8ECEF", fontSize: "12px" }}>{a.label}</div>
                <div style={{ color: "#5C666F", fontSize: "11px" }}>{a.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3" style={{ color: "#4A535C", fontSize: "10px" }}>계좌는 종목 카드의 상세 설정에서 언제든 바꿀 수 있어요</div>
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="데이터 백업">데이터 백업 · 복원</SectionTitle>
        <div className="mb-2" style={{ color: backupStale ? "#FFB020" : "#8B96A5", fontSize: "11px" }}>
          {lastBackupAt ? "마지막 백업 · " + new Date(lastBackupAt).toLocaleDateString("ko-KR") : "아직 백업한 적이 없어요"}
          {backupStale ? " · 백업을 한 번 해두면 안심돼요" : ""}
        </div>
        <div className="flex gap-2">
          <button onClick={onExport} className="flex-1 py-2.5 rounded-md font-bold" style={{ background: "#4FD1C5", color: "#0B0E11", fontSize: "12px" }}>
            내 데이터 내보내기
          </button>
          <label className="flex-1 py-2.5 rounded-md text-center cursor-pointer" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            백업 파일 불러오기
            <input type="file" accept=".json,application/json" onChange={onImportFile} style={{ display: "none" }} />
          </label>
        </div>
        <div className="mt-2" style={{ color: "#4A535C", fontSize: "10px" }}>데이터는 이 기기 안에만 저장돼요. 폰을 바꾸기 전에 꼭 내보내세요.</div>
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="다시 시작">처음부터 다시 해보기</SectionTitle>
        <div className="space-y-2">
          <button onClick={onRestartOnboarding} className="w-full py-2.5 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "12px" }}>
            시작 질문 다시 보기
          </button>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(TEMPLATES).map((k) => (
              <button key={k} onClick={() => onLoadTemplate(k)} className="py-2.5 rounded-md" style={{ background: "#1A2027", color: "#8B96A5", fontSize: "11px" }}>
                {TEMPLATES[k].icon} {TEMPLATES[k].title}
              </button>
            ))}
          </div>
          <div style={{ color: "#4A535C", fontSize: "10px" }}>템플릿을 불러오면 지금 목록에 예시 종목이 더해져요</div>
          <button onClick={() => fireReset(onResetAll)} className="w-full py-2.5 rounded-md mt-1"
            style={{ background: resetArmed ? "#3A171B" : "#1A2027", color: resetArmed ? "#FF5C5C" : "#8B96A5", fontSize: "12px", border: "1px solid " + (resetArmed ? "#4A2126" : "#1F262D") }}>
            {resetArmed ? "정말 지울까요? 한 번 더 누르면 실행돼요" : "전체 데이터 초기화"}
          </button>
        </div>
      </div>

      <div className="panel rounded-lg p-5">
        <SectionTitle title="앱 정보">앱 정보</SectionTitle>
        <div style={{ color: "#8B96A5", fontSize: "11px", lineHeight: 1.7 }}>
          버전 <span className="mono" style={{ color: "#4FD1C5" }}>{APP_VERSION}</span><br />
          시세는 60초, 배당·최고가는 하루 단위로 저장해두고 씁니다. 모든 조회는 1.1초 간격으로 하나씩 처리해서 종목이 많아도 안정적으로 갱신돼요.<br />
          API 키는 서버에만 있고 이 앱에는 들어있지 않아요.
        </div>
        {lastSaved && <div className="mono mt-2" style={{ color: "#4A535C", fontSize: "10px" }}>마지막 저장 {new Date(lastSaved).toLocaleString("ko-KR")}</div>}
        {saveError && <div className="mt-1" style={{ color: "#FF5C5C", fontSize: "11px" }}>저장 중 오류가 났어요. 백업 내보내기를 권해요.</div>}
      </div>
    </div>
  );
}

// ═══ [9] APP (상태 관리 및 Pull-to-Refresh 로직) ════════════════════════

function PortfolioConsole() {
  const [holdings, setHoldings] = useState(function () { return DEFAULT_HOLDINGS.slice(); });
  const [phase2, setPhase2] = useState(function () { return DEFAULT_PHASE2.map(function (p) { return Object.assign({}, p); }); });
  const [cash, setCash] = useState(function () { return normalizeCash(null, 0); });
  const [exchangeRate, setExchangeRate] = useState(1480);
  const [bilMinPct, setBilMinPct] = useState(10);
  const [goals, setGoals] = useState(function () { return Object.assign({}, DEFAULT_GOALS); });
  const [history, setHistory] = useState([]);
  const [onboarded, setOnboarded] = useState(true);
  const [lastPriceSync, setLastPriceSync] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(null);

  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("home");
  const [accountFilter, setAccountFilter] = useState(function () { return loadUiPref().account; });
  const [sortMode, setSortMode] = useState(function () { return loadUiPref().sort; });
  const [showRules, setShowRules] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [fxBusy, setFxBusy] = useState(false);
  const [hasRefreshedThisSession, setHasRefreshedThisSession] = useState(false);
  const [expandedIds, setExpandedIds] = useState({});
  const [toasts, setToasts] = useState([]);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);

  // Pull-to-Refresh State
  const [pullDist, setPullDist] = useState(0);
  const startY = useRef(-1);

  const saveTimer = useRef(null);
  const cardRefs = useRef({});
  const cashRef = useRef(null);
  const toastSeq = useRef(0);
  // ── 중복 호출 방지용 잠금 (state가 아니라 ref) ──
  // bulk/busyKey는 리액트 state라서 갱신이 "비동기"로 일어나요.
  // 그래서 버튼을 아주 빠르게 두 번 누르면(더블클릭·당겨서 새로고침과 겹침 등)
  // 두 번째 클릭이 아직 안 바뀐 이전 state를 보고 통과해버려서
  // 전체 새로고침이 통째로 두 번 돌아가는 문제가 있었어요 (모든 종목이 딱 2배로 호출됨).
  // ref는 리액트 렌더링을 기다리지 않고 그 자리에서 즉시 바뀌기 때문에 확실하게 막아줘요.
  const bulkLockRef = useRef(false);
  const busyIdsRef = useRef(new Set());

  const removeToast = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  const toast = useCallback((type, msg, ms) => {
    var id = ++toastSeq.current;
    setToasts((p) => p.slice(-3).concat([{ id: id, type: type, msg: msg }]));
    var life = ms || (type === "error" ? 6000 : type === "warn" ? 5000 : 3200);
    setTimeout(function () { removeToast(id); }, life);
  }, [removeToast]);

  useEffect(() => {
    function onOnline() { setIsOnline(true); toast("success", "인터넷에 다시 연결됐어요"); }
    function onOffline() { setIsOnline(false); }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [toast]);

  function requireOnline() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast("error", "지금은 오프라인이에요 — 연결 후 다시 시도해 주세요");
      return false;
    }
    return true;
  }

  useEffect(() => {
    var res = loadPersistedState();
    if (res) {
      var st = res.state;
      setHoldings(st.holdings); setPhase2(st.phase2); setCash(st.cash);
      setExchangeRate(st.exchangeRate); setBilMinPct(st.bilMinPct); setGoals(st.goals);
      setHistory(st.history); setOnboarded(st.onboarded);
      setLastPriceSync(st.lastPriceSync); setLastBackupAt(st.lastBackupAt);
      if (st.lastUpdated) setLastSaved(st.lastUpdated);
      if (!st.onboarded && st.holdings.length === 0) setShowWizard(true);
      if (res.migrated) toast("info", "기존 데이터를 새 버전으로 옮겨왔어요");
    } else {
      setOnboarded(false);
      setShowWizard(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      var payload = serializeState({ holdings, phase2, cash, exchangeRate, bilMinPct, goals, history, onboarded, lastPriceSync, lastBackupAt });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); setSaveError(false); setLastSaved(payload.lastUpdated); }
      catch (e) { setSaveError(true); }
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [holdings, phase2, cash, exchangeRate, bilMinPct, goals, history, onboarded, lastPriceSync, lastBackupAt, loaded]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [tab]);

  const makeFieldUpdater = (setList) => (id, field, v) => {
    setList((prev) => prev.map((x) => {
      if (x.id !== id) return x;
      if (field === "price") return Object.assign({}, x, { price: v, high52: Math.max(v, toNum(x.high52, 0)) });
      var o = Object.assign({}, x); o[field] = v; return o;
    }));
  };
  const changeHolding = useMemo(() => makeFieldUpdater(setHoldings), []);
  const changePhase2 = useMemo(() => makeFieldUpdater(setPhase2), []);
  function changeCash(accountKey, v) { setCash((prev) => Object.assign({}, prev, { [accountKey]: Math.max(0, toNum(v, 0)) })); }
  function removeHoldingById(id) { setHoldings((prev) => prev.filter((h) => h.id !== id)); toast("info", "종목을 삭제했어요"); }

  function addHolding(nh) {
    var normalized = normalizeHolding(Object.assign({}, nh, { id: uid() }));
    var dup = holdings.some((x) => x.ticker === normalized.ticker && x.account === normalized.account);
    setHoldings((prev) => prev.concat([normalized]));
    setShowAdd(false); setOnboarded(true); setTab("assets");
    if (dup) toast("warn", normalized.ticker + " — 같은 계좌에 같은 종목이 이미 있어요 (그대로 추가했어요)");
    else toast("success", normalized.ticker + "을(를) " + accountOf(normalized.account).label + "에 추가했어요");
  }

  function toggleExpand(id) { setExpandedIds((prev) => Object.assign({}, prev, { [id]: !prev[id] })); }
  const anyExpanded = holdings.some((h) => expandedIds[h.id]);
  function toggleAllExpand() {
    var next = {};
    if (!anyExpanded) holdings.forEach((h) => { next[h.id] = true; });
    setExpandedIds(next);
  }

  function changeSortMode(m) { setSortMode(m); saveUiPref({ sort: m, account: accountFilter }); }
  function changeAccountFilter(a) { setAccountFilter(a); saveUiPref({ sort: sortMode, account: a }); }

  function jumpToHolding(id) {
    setTab("assets"); setAccountFilter("all");
    setExpandedIds((prev) => Object.assign({}, prev, { [id]: true }));
    setTimeout(() => { var el = cardRefs.current[id]; if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 160);
  }
  function jumpToCash() {
    setTab("assets"); setTimeout(() => { if (cashRef.current) cashRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, 160);
  }

  function applyToList(scope, id, q) {
    var upd = (list) => list.map((x) => (x.id === id ? applyQuoteToAsset(x, q) : x));
    if (scope === "holding") setHoldings(upd); else setPhase2(upd);
  }

  async function refreshAsset(asset, scope) {
    if (busyIdsRef.current.has(asset.id)) return; // 같은 카드를 빠르게 연타해도 한 번만 실행되게 막음
    if (bulk) { toast("info", "전체 새로고침이 진행 중이에요"); return; }
    if (!requireOnline()) return;
    busyIdsRef.current.add(asset.id);
    try {
      if (asset.isCrypto) {
        if (!CRYPTO_IDS[asset.ticker]) { toast("warn", asset.ticker + "는 자동 시세를 지원하지 않는 코인이에요"); return; }
        var ckey = "crypto:" + asset.ticker;
        if (underCooldown(ckey, COOLDOWN_MS.crypto)) { toast("info", asset.ticker + " 다시 조회는 " + cooldownLeft(ckey, COOLDOWN_MS.crypto) + "초 후에 가능해요"); return; }
        setBusyKey(asset.id);
        try {
          var prices = await apiCryptoPrices([asset.ticker]);
          var pr = prices[asset.ticker];
          if (!pr) throw new Error("시세 응답 없음");
          applyToList(scope, asset.id, { price: pr.price, dayHigh: 0, metricHigh: 0, div: null, dayPct: pr.dayPct });
          markCooldown(ckey); setLastPriceSync(new Date().toISOString());
        } catch (e) { toast("error", friendlyApiError(e, asset.ticker + " 가격을 못 가져왔어요")); } finally { setBusyKey(null); }
        return;
      }

      var isKr = asset.isKRW || /\.(KS|KQ)$/i.test(asset.ticker);
      if (!isKr && isUnsupportedForeign(asset.ticker)) { toast("warn", asset.ticker + "는 해외 거래소 종목이에요"); return; }

      var skey = "stock:" + asset.ticker;
      if (underCooldown(skey, COOLDOWN_MS.stock)) { toast("info", asset.ticker + " 다시 조회는 " + cooldownLeft(skey, COOLDOWN_MS.stock) + "초 후에 가능해요"); return; }
      setBusyKey(asset.id);
      try {
        if (isKr) {
          var q = await apiQuote(asset.ticker, true);
          applyToList(scope, asset.id, { price: q.price, dayHigh: q.dayHigh, metricHigh: q.high52, div: null, dayPct: q.dayPct });
        } else {
          var results = await Promise.all([apiQuote(asset.ticker, false), apiMetric(asset.ticker)]);
          applyToList(scope, asset.id, { price: results[0].price, dayHigh: results[0].dayHigh, metricHigh: results[1].high52, div: results[1].div, dayPct: results[0].dayPct });
        }
        markCooldown(skey); setLastPriceSync(new Date().toISOString());
      } catch (e) { toast("error", friendlyApiError(e, asset.ticker + " 가격을 못 가져왔어요")); } finally { setBusyKey(null); }
    } finally {
      busyIdsRef.current.delete(asset.id);
    }
  }

  async function refreshAllPrices() {
    // ★ 429 에러의 진짜 원인이었던 부분: bulk(state)만 보고 막으면
    //   버튼을 빠르게 두 번 누를 때 둘 다 통과해버려요. ref로 먼저 즉시 잠급니다.
    if (bulkLockRef.current) return;
    if (bulk) return;
    if (!requireOnline()) return;
    if (underCooldown("bulk", COOLDOWN_MS.bulk)) { toast("info", "전체 새로고침은 " + cooldownLeft("bulk", COOLDOWN_MS.bulk) + "초 후에 다시 가능해요"); return; }
    bulkLockRef.current = true;
    try {
      var skipped = [];
      var stockTargets = holdings.filter((h) => !h.isCrypto).map((h) => ({ scope: "holding", id: h.id, ticker: h.ticker, isKRW: h.isKRW }))
        .concat(phase2.map((p) => ({ scope: "phase2", id: p.id, ticker: p.ticker, isKRW: p.isKRW })))
        .filter((t) => {
          var isKr = t.isKRW || /\.(KS|KQ)$/i.test(t.ticker);
          if (!isKr && isUnsupportedForeign(t.ticker)) { skipped.push(t.ticker); return false; }
          return true;
        });
      var cryptoTickers = [];
      holdings.forEach((h) => { if (h.isCrypto && cryptoTickers.indexOf(h.ticker) === -1) cryptoTickers.push(h.ticker); });

      var total = stockTargets.length + (cryptoTickers.length ? 1 : 0) + 1;
      setBulk({ done: 0, total: total });
      var failed = [];
      var step = () => setBulk((b) => (b ? { done: b.done + 1, total: b.total } : b));

      try { setExchangeRate(await apiFxKRW()); } catch (e) { failed.push("환율"); }
      step();

      if (cryptoTickers.length) {
        try {
          var cp = await apiCryptoPrices(cryptoTickers);
          setHoldings((prev) => prev.map((x) => {
            if (!x.isCrypto) return x;
            var pr = cp[x.ticker];
            return pr == null ? x : applyQuoteToAsset(x, { price: pr.price, dayHigh: 0, metricHigh: 0, div: null, dayPct: pr.dayPct });
          }));
          cryptoTickers.forEach((t) => { if (cp[t] == null) failed.push(t); });
        } catch (e) { failed.push("코인"); }
        step();
      }

      for (var i = 0; i < stockTargets.length; i++) {
        var tgt = stockTargets[i];
        try {
          var isKr = tgt.isKRW || /\.(KS|KQ)$/i.test(tgt.ticker);
          if (isKr) {
            var q = await apiQuote(tgt.ticker, true);
            applyToList(tgt.scope, tgt.id, { price: q.price, dayHigh: q.dayHigh, metricHigh: q.high52, div: null, dayPct: q.dayPct });
          } else {
            var r = await Promise.all([apiQuote(tgt.ticker, false), apiMetric(tgt.ticker)]);
            applyToList(tgt.scope, tgt.id, { price: r[0].price, dayHigh: r[0].dayHigh, metricHigh: r[1].high52, div: r[1].div, dayPct: r[0].dayPct });
          }
        } catch (e) { failed.push(tgt.ticker); }
        step();
      }

      markCooldown("bulk"); setLastPriceSync(new Date().toISOString()); setBulk(null); setHasRefreshedThisSession(true);
      if (failed.length) toast("warn", "일부는 못 가져왔어요: " + failed.join(", "));
      else if (skipped.length) toast("success", "가격 새로고침 완료 · 건너뛴 종목: " + skipped.join(", "));
      else toast("success", "가격을 모두 새로고침했어요");
    } finally {
      bulkLockRef.current = false;
    }
  }

  async function fetchFx() {
    if (!requireOnline()) return;
    setFxBusy(true);
    try { setExchangeRate(await apiFxKRW()); toast("success", "환율을 가져왔어요"); } 
    catch (e) { toast("error", friendlyApiError(e, "환율을 못 가져왔어요")); } 
    finally { setFxBusy(false); }
  }

  function handleExportData() {
    try {
      var payload = serializeState({ holdings, phase2, cash, exchangeRate, bilMinPct, goals, history, onboarded, lastPriceSync, lastBackupAt });
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = "portfolio_backup_" + new Date().toISOString().split("T")[0] + ".json";
      a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setLastBackupAt(new Date().toISOString()); toast("success", "백업 파일을 내보냈어요");
    } catch (e) { toast("error", "백업 파일을 만들지 못했어요"); }
  }

  function handleImportData(e) {
    var file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
    var reader = new FileReader();
    reader.onload = (evt) => {
      try {
        var data = JSON.parse(evt.target.result);
        if (!data || !Array.isArray(data.holdings)) { toast("error", "이 파일은 백업 파일이 아닌 것 같아요"); return; }
        var st = normalizeState(data);
        setHoldings(st.holdings); setPhase2(st.phase2); setCash(st.cash);
        setExchangeRate(st.exchangeRate); setBilMinPct(st.bilMinPct); setGoals(st.goals);
        setHistory(st.history); setOnboarded(true); setLastPriceSync(st.lastPriceSync); setLastBackupAt(st.lastBackupAt);
        toast("success", "백업을 복원했어요 · 종목 " + st.holdings.length + "개");
      } catch (err) { toast("error", "파일을 읽지 못했어요 — JSON 형식을 확인해 주세요"); }
    };
    reader.readAsText(file);
  }

  function handleResetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try { localStorage.removeItem(METRIC_CACHE_KEY); } catch (e) {}
    setHoldings([]); setPhase2(DEFAULT_PHASE2.map((p) => Object.assign({}, p))); setCash(normalizeCash(null, 0));
    setExchangeRate(1480); setBilMinPct(10); setGoals(Object.assign({}, DEFAULT_GOALS));
    setHistory([]); setLastPriceSync(null); setLastBackupAt(null);
    setExpandedIds({}); setOnboarded(false); setShowWizard(true); setTab("home");
    toast("success", "전체 데이터를 지웠어요");
  }

  function loadTemplate(key) {
    var t = TEMPLATES[key]; if (!t) return;
    var added = t.holdings.map(function (h) { return normalizeHolding(Object.assign({}, h, { id: uid() })); });
    setHoldings(function (prev) { return prev.concat(added); });
    setPhase2(function (prev) { return prev.map(function (p) { var v = t.phase2 && t.phase2[p.ticker]; return v ? Object.assign({}, p, { qty: v.qty, avgPrice: v.avgPrice }) : p; }); });
    setCash(function (prev) { return Object.assign({}, prev, t.cash); });
    setOnboarded(true); setTab("assets");
    toast("success", t.title + "을 불러왔어요 · 예시 데이터라서 상단 새로고침을 한 번 눌러주세요", 6000);
  }

  function finishOnboarding(res) {
    setGoals(function (g) { return Object.assign({}, g, { finalGoalKRW: res.finalGoalKRW }); });
    if (res.tickers && res.tickers.length) {
      var made = res.tickers.map(function (tk) {
        var meta = STARTER_ASSETS.filter(function (a) { return a.ticker === tk; })[0] || { ticker: tk, name: tk };
        return normalizeHolding({ id: uid(), ticker: meta.ticker, name: meta.name, category: meta.category || "core", account: res.account, isCrypto: !!meta.isCrypto, isKRW: !!meta.isKRW, qty: 0, avgPrice: 0, price: 0, high52: 0, targetQty: 0, t1: -15, t2: -30, mdd: meta.mdd || 0, divPerShare: 0 });
      });
      setHoldings(function (prev) { return prev.concat(made); });
    }
    setOnboarded(true); setShowWizard(false); setTab(res.tickers && res.tickers.length ? "assets" : "home");
    if (res.tickers && res.tickers.length) {
      toast("success", "포트폴리오를 만들었어요 · 가격을 불러올게요", 4000);
      setTimeout(function () { refreshAllPrices(); }, 400);
    }
  }

  // ── Pull-to-Refresh 로직 ──
  function handleTouchStart(e) {
    if (window.scrollY === 0) startY.current = e.touches[0].clientY;
    else startY.current = -1;
  }
  function handleTouchMove(e) {
    if (startY.current < 0 || bulk) return;
    var dist = e.touches[0].clientY - startY.current;
    if (dist > 0 && window.scrollY === 0) {
      setPullDist(Math.min(dist * 0.45, 80)); 
    }
  }
  function handleTouchEnd() {
    if (pullDist >= 65 && !bulk && isOnline) refreshAllPrices();
    setPullDist(0);
    startY.current = -1;
  }

  const summary = useMemo(() => computeSummary({ holdings, phase2, cash, exchangeRate, bilMinPct, goals }), [holdings, phase2, cash, exchangeRate, bilMinPct, goals]);
  const priceStale = lastPriceSync && isStale(lastPriceSync, 20);
  const needsInitialSync = !hasRefreshedThisSession && isStale(lastPriceSync, 1) && holdings.length > 0;
  const backupStale = !lastBackupAt || isStale(lastBackupAt, 24 * 30);

  const sortedHoldings = useMemo(() => {
    if (sortMode === "default") return holdings;
    var arr = holdings.slice();
    if (sortMode === "weight") arr.sort((a, b) => (summary.weights[b.id] || 0) - (summary.weights[a.id] || 0));
    else arr.sort((a, b) => dropPct(a) - dropPct(b));
    return arr;
  }, [holdings, sortMode, summary]);

  useEffect(function () {
    if (!loaded || !lastPriceSync) return;
    if (summary.isEmpty || summary.totalValueUSD <= 0) return;
    var sync = new Date(lastPriceSync);
    var now = new Date();
    if (isNaN(sync.getTime()) || sync.toDateString() !== now.toDateString()) return;
    var key = todayKey();
    var v = Math.round(summary.totalValueKRW);
    setHistory(function (prev) {
      var last = prev.length ? prev[prev.length - 1] : null;
      if (last && last.d === key) {
        if (last.v === v) return prev;
        return prev.slice(0, -1).concat([{ d: key, v: v }]);
      }
      return prev.concat([{ d: key, v: v }]).slice(-370);
    });
  }, [loaded, lastPriceSync, summary.totalValueKRW, summary.totalValueUSD, summary.isEmpty]);

  const headerTitle = { home: "오늘의 브리핑", assets: "내 자산", portfolio: "포트폴리오", lab: "포트폴리오 시뮬레이터", settings: "설정" }[tab];

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
         style={{ fontFamily: "'Noto Sans KR', sans-serif", background: "#0B0E11", minHeight: "100vh", color: "#E8ECEF", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)" }} className="w-full relative">
      
      {/* PTR 인디케이터 */}
      <div style={{ height: pullDist, overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "center", transition: pullDist === 0 ? "height 0.3s ease" : "none" }}>
        <div style={{ paddingBottom: 16 }}>
          <RefreshCw size={24} color="#4FD1C5" style={{ transform: "rotate(" + (pullDist * 3) + "deg)", opacity: pullDist / 65 }} />
        </div>
      </div>

      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(11,14,17,0.92)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderBottom: "1px solid #1F262D", paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="mono tracking-widest" style={{ color: "#4FD1C5", fontSize: "10px" }}>{APP_VERSION}</span>
              {lastPriceSync && (
                <span className="mono" style={{ color: priceStale ? "#FFB020" : "#5C666F", fontSize: "10px" }}>
                  가격 {fmtSyncTime(lastPriceSync)}{priceStale ? " · 오래됐어요" : ""}
                </span>
              )}
            </div>
            <div className="text-lg font-bold">{headerTitle}</div>
          </div>
          <button onClick={refreshAllPrices} disabled={!!bulk || !isOnline} aria-label="전체 가격 새로고침"
            className="p-2 rounded-md flex items-center gap-1.5" style={{ background: "#1A2027", minHeight: 40, opacity: isOnline ? 1 : 0.5 }}>
            <RefreshCw size={17} color="#4FD1C5" className={bulk ? "animate-spin" : ""} />
            <span className="mono" style={{ color: "#4FD1C5", fontSize: "11px" }}>{bulk ? bulk.done + "/" + bulk.total : "새로고침"}</span>
          </button>
        </div>
        {!isOnline && (
          <div className="max-w-3xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: "#2A2113", border: "1px solid #4A3B1F" }}>
              <WifiOff size={14} color="#FFB020" />
              <span style={{ color: "#FFB020", fontSize: "11px" }}>오프라인이에요 — 저장된 내용은 계속 볼 수 있어요</span>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-5">
        {tab === "home" && (
          <HomeTab summary={summary} goals={goals} history={history} lastPriceSync={lastPriceSync} needsInitialSync={needsInitialSync} isOnline={isOnline} bulk={bulk} onRefreshAll={refreshAllPrices} onJumpHolding={jumpToHolding} onJumpCash={jumpToCash} showRules={showRules} onToggleRules={() => setShowRules((s) => !s)} onGoAssets={() => setTab("portfolio")} />
        )}
        {tab === "assets" && (
          <AssetsTab summary={summary} holdings={sortedHoldings} phase2={phase2} cash={cash} accountFilter={accountFilter} onAccountFilter={changeAccountFilter} sortMode={sortMode} onSortMode={changeSortMode} expandedIds={expandedIds} onToggleExpand={toggleExpand} anyExpanded={anyExpanded} onToggleAll={toggleAllExpand} onAddClick={() => setShowAdd(true)} changeHolding={changeHolding} changePhase2={changePhase2} removeHolding={removeHoldingById} refreshAsset={refreshAsset} busyKey={busyKey} bulk={bulk} onCashChange={changeCash} bilMinPct={bilMinPct} cardRefs={cardRefs} cashRef={cashRef} isEmpty={summary.isEmpty} onLoadTemplate={loadTemplate} onRestartOnboarding={() => setShowWizard(true)} />
        )}
        {tab === "portfolio" && (
          <PortfolioTab summary={summary} holdings={holdings} phase2={phase2} cash={cash} history={history} goals={goals} />
        )}
        {tab === "lab" && (
          <BacktestTab holdings={holdings} phase2={phase2} toast={toast} />
        )}
        {tab === "settings" && (
          <SettingsTab exchangeRate={exchangeRate} onRateChange={setExchangeRate} onFetchFx={fetchFx} fxBusy={fxBusy} bilMinPct={bilMinPct} onBilMinChange={setBilMinPct} goals={goals} onGoalsChange={setGoals} onExport={handleExportData} onImportFile={handleImportData} lastBackupAt={lastBackupAt} backupStale={backupStale} onResetAll={handleResetAll} onRestartOnboarding={() => setShowWizard(true)} onLoadTemplate={loadTemplate} lastSaved={lastSaved} saveError={saveError} />
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} badge={summary.triggeredCount} />

      {showAdd && <AddAssetModal defaultAccount={accountFilter === "all" ? "gen1" : accountFilter} onAdd={addHolding} onClose={() => setShowAdd(false)} />}
      {showWizard && <OnboardingWizard onFinish={finishOnboarding} onSkip={() => { setShowWizard(false); setOnboarded(true); }} />}

      <ToastHost toasts={toasts} onClose={removeToast} />
    </div>
  );
}

// Vite로 옮기며 바뀐 부분 ②: CDN 방식의 ReactDOM.createRoot(...).render(...) 대신
// main.jsx에서 이 컴포넌트를 import해서 렌더링하도록 export만 합니다.
export default PortfolioConsole;