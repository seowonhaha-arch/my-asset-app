# 실제 주식 과거 데이터 연결하기

시뮬레이터의 "실제 시세" 모드에서 **코인은 지금 바로 작동**하지만
(CoinGecko가 브라우저 직접 호출을 허용해서요), **주식은 프록시 서버에
엔드포인트를 하나 추가해야** 합니다. 이 문서가 그 방법이에요.

---

## 왜 추가 작업이 필요한가요?

두 가지 이유예요.

**1. 지금 API는 "현재 가격"만 줍니다.**
앱이 쓰는 `endpoint=quote`는 오늘 가격 하나만 돌려줘요.
백테스트는 10년치 월별 가격이 필요합니다.

**2. Finnhub 무료 플랜에는 과거 데이터가 없어요.**
Finnhub의 `/stock/candle` 엔드포인트는 유료 플랜 전용으로 바뀌었습니다.
그래서 아래에서는 **Stooq**라는 무료 소스를 쓰는 방법을 안내해요.
(회원가입도, API 키도 필요 없습니다.)

**3. 브라우저에서 Stooq를 직접 못 부릅니다.**
CORS라는 브라우저 보안 정책 때문에, 다른 도메인의 데이터를 JS로 직접
가져올 수 없어요. 그래서 내 Worker가 대신 가져와서 전달해주는
"중계자" 역할을 해야 합니다. 이미 그 Worker를 갖고 계시니 거기에
기능만 하나 더 붙이면 돼요.

---

## 추가할 코드

Cloudflare 대시보드에서 기존 Worker를 열고, 요청을 분기하는 곳에
아래 `candle` 처리를 추가하세요.

```js
// ── 과거 시세 (Stooq CSV 중계) ──────────────────────────────
if (endpoint === 'candle') {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) {
    return json({ error: 'symbol 파라미터가 없습니다' }, 400);
  }

  // 티커를 Stooq 형식으로 변환
  //   AAPL       → aapl.us
  //   005930.KS  → 005930.kr
  let stooqSymbol;
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.KS') || upper.endsWith('.KQ')) {
    stooqSymbol = upper.slice(0, -3).toLowerCase() + '.kr';
  } else {
    stooqSymbol = upper.toLowerCase() + '.us';
  }

  // i=m 은 월별 데이터 (i=d 로 바꾸면 일별)
  const stooqUrl =
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=m`;

  const res = await fetch(stooqUrl, {
    cf: { cacheTtl: 86400, cacheEverything: true }   // 하루 캐싱
  });

  if (!res.ok) {
    return json({ error: `Stooq 오류 ${res.status}` }, 502);
  }

  const csv = await res.text();

  // Stooq가 없는 종목엔 헤더만 돌려주거나 "No data"를 줍니다
  if (!csv || csv.trim().length < 20 || /no data/i.test(csv)) {
    return json({ error: `${symbol} 과거 데이터를 찾을 수 없습니다` }, 404);
  }

  // CSV → { t: [unix초...], c: [종가...] } 형태로 변환
  // (앱의 fetchProxyHistory 가 이 형식을 기대합니다)
  const lines = csv.trim().split('\n').slice(1);   // 첫 줄은 헤더
  const t = [];
  const c = [];

  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 5) continue;
    const date = cols[0];
    const close = parseFloat(cols[4]);             // Date,Open,High,Low,Close,Volume
    if (!isFinite(close) || close <= 0) continue;
    const ms = Date.parse(date + 'T00:00:00Z');
    if (!isFinite(ms)) continue;
    t.push(Math.floor(ms / 1000));
    c.push(close);
  }

  if (!t.length) {
    return json({ error: '변환된 데이터가 없습니다' }, 404);
  }

  return json({ s: 'ok', t, c });
}
```

`json()` 헬퍼가 없다면 이런 함수를 하나 만들어 두세요. **CORS 헤더가
반드시 있어야** 브라우저가 응답을 받을 수 있습니다.

```js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Client-Key,Content-Type'
    }
  });
}
```

---

## 제대로 붙었는지 확인하기

브라우저 주소창에 아래를 붙여넣어 보세요.

```
https://finnhub-proxy.seowonhaha.workers.dev?endpoint=candle&symbol=QQQ
```

이런 모양이 나오면 성공이에요.

```json
{"s":"ok","t":[1104537600,1107216000,...],"c":[38.9,39.7,...]}
```

그 다음 앱에서 **시뮬레이터 → 실제 시세 → 과거 데이터 불러오기**를
누르면 진짜 데이터로 백테스트가 돌아갑니다.

---

## 알아두면 좋은 점

**Stooq 데이터는 배당이 빠진 "가격만"입니다.**
SCHD나 KO처럼 배당이 큰 종목은 실제 총수익보다 낮게 나와요.
정확하게 하려면 배당이 반영된 수정주가(Adjusted Close)가 필요한데,
그건 Yahoo Finance CSV를 직접 받아서 **CSV 모드**로 올리는 게 가장
확실합니다.

**Stooq에 없는 종목도 있어요.**
미국 대형주·주요 ETF는 대체로 잘 나오고, 한국 종목은 종목마다
편차가 있습니다. 404가 뜨면 CSV 모드를 쓰세요.

**호출 간격을 두세요.**
앱은 종목당 1.2초 간격으로 순차 호출하도록 이미 만들어뒀어요.
Worker에 하루짜리 캐시(`cacheTtl: 86400`)를 넣어둬서 같은 종목을
다시 불러도 Stooq를 또 때리지 않습니다.

---

## 대안: CSV 모드가 제일 확실해요

Worker를 건드리기 부담스러우면 이 방법이 가장 정확합니다.

1. Yahoo Finance에서 종목 페이지 → **Historical Data** 탭
2. 기간을 10년으로, 빈도를 **Monthly**로 설정
3. **Download** 클릭
4. 받은 파일 이름을 티커로 바꾸기 (예: `QQQ.csv`)
5. 앱에서 **시뮬레이터 → CSV → 파일 선택**

Yahoo CSV에는 `Adj Close`(수정종가) 열이 있어서 **배당이 이미 반영**돼
있습니다. 앱의 파싱 코드가 이 열을 자동으로 우선 사용하도록 만들어뒀어요.
백테스트 정확도로만 따지면 이게 최선입니다.
