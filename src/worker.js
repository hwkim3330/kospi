// ============================================================
// KOSPI Board — Cloudflare Worker
// Real-time Korean & Global Market Dashboard
// Kiwoom REST API + Yahoo Finance
// ============================================================

const KIWOOM_BASE = 'https://api.kiwoom.com';

// Token cache (persists within worker isolate)
let cachedToken = null;
let tokenExpiry = 0;

// ===================== MAIN HANDLER =====================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      const path = url.pathname;

      if (path === '/' || path === '/index.html') {
        return new Response(HTML, {
          headers: {
            'Content-Type': 'text/html;charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }

      if (path === '/api/market') {
        const data = await getMarketData(env);
        return jsonResp(data);
      }

      if (path === '/api/indices') {
        const data = await getIndicesOnly(env);
        return jsonResp(data);
      }

      if (path === '/api/ranking') {
        const data = await getRankingOnly(env);
        return jsonResp(data);
      }

      if (path === '/api/global') {
        const data = await fetchGlobalData();
        return jsonResp(data);
      }

      if (path === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return jsonResp({ error: e.message, stack: e.stack }, 500);
    }
  },
};

// ===================== TOKEN =====================
async function getToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const resp = await fetch(`${KIWOOM_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: env.KIWOOM_APP_KEY,
      secretkey: env.KIWOOM_APP_SECRET,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + ((data.expires_in || 86400) - 120) * 1000;
  return cachedToken;
}

// ===================== KIWOOM API =====================
async function kiwoomFetch(env, resource, apiId, body) {
  const token = await getToken(env);

  const resp = await fetch(`${KIWOOM_BASE}/api/dostk/${resource}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Authorization': `Bearer ${token}`,
      'appkey': env.KIWOOM_APP_KEY,
      'appsecret': env.KIWOOM_APP_SECRET,
      'api-id': apiId,
      'cont-yn': 'N',
      'next-key': '0',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kiwoom ${apiId} error ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ===================== DATA AGGREGATION =====================
async function getMarketData(env) {
  const today = getKSTDateString();

  const results = await Promise.allSettled([
    // Korean indices (ka20006)
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '001', base_dt: today }),
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '101', base_dt: today }),
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '201', base_dt: today }),
    // Volume ranking (ka10024)
    kiwoomFetch(env, 'stkinfo', 'ka10024', {
      mrkt_tp: '000', cycle_tp: '5', trde_qty_tp: '5', stex_tp: '1',
    }),
    // Investor daily trading by type - foreign net buy (ka10058)
    kiwoomFetch(env, 'stkinfo', 'ka10058', {
      strt_dt: today, end_dt: today,
      trde_tp: '2', mrkt_tp: '001', invsr_tp: '9000', stex_tp: '1',
    }),
    // Investor daily trading by type - institution net buy (ka10058)
    kiwoomFetch(env, 'stkinfo', 'ka10058', {
      strt_dt: today, end_dt: today,
      trde_tp: '2', mrkt_tp: '001', invsr_tp: '9999', stex_tp: '1',
    }),
    // Global data
    fetchGlobalData(),
    // Upper limit stocks (ka10017) - 상승 종목
    kiwoomFetch(env, 'stkinfo', 'ka10017', {
      mrkt_tp: '000', updown_tp: '2', sort_tp: '3',
      stk_cnd: '0', trde_qty_tp: '00000', crd_cnd: '0',
      trde_gold_tp: '0', stex_tp: '1',
    }),
  ]);

  const [kospi, kosdaq, kospi200, ranking, foreignBuy, instBuy, global, risers] = results;

  return {
    indices: {
      kospi: parseIndexData(kospi, 'KOSPI', '🇰🇷'),
      kosdaq: parseIndexData(kosdaq, 'KOSDAQ', '🇰🇷'),
      kospi200: parseIndexData(kospi200, 'KOSPI 200', '📈'),
    },
    ranking: parseRankingData(ranking),
    investors: {
      foreign: parseInvestorData(foreignBuy, '외국인'),
      institution: parseInvestorData(instBuy, '기관'),
    },
    risers: parseRiserData(risers),
    global: global.status === 'fulfilled' ? global.value : {},
    marketStatus: getMarketStatus(),
    updated: new Date().toISOString(),
  };
}

async function getIndicesOnly(env) {
  const today = getKSTDateString();
  const results = await Promise.allSettled([
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '001', base_dt: today }),
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '101', base_dt: today }),
    kiwoomFetch(env, 'chart', 'ka20006', { inds_cd: '201', base_dt: today }),
  ]);
  return {
    kospi: parseIndexData(results[0], 'KOSPI', '🇰🇷'),
    kosdaq: parseIndexData(results[1], 'KOSDAQ', '🇰🇷'),
    kospi200: parseIndexData(results[2], 'KOSPI 200', '📈'),
    updated: new Date().toISOString(),
  };
}

async function getRankingOnly(env) {
  const data = await kiwoomFetch(env, 'stkinfo', 'ka10024', {
    mrkt_tp: '000', cycle_tp: '5', trde_qty_tp: '5', stex_tp: '1',
  });
  return { ranking: parseRankingData({ status: 'fulfilled', value: data }) };
}

// ===================== PARSERS =====================
function parseIndexData(result, name, flag) {
  if (result.status !== 'fulfilled') {
    return { name, flag, error: true, value: 0, change: 0, changePct: 0, sparkline: [] };
  }

  const data = result.value;
  // Try multiple response keys
  let arr = data.inds_dt_pole_qry || data.inds_dt_pole_chart_qry || data.inds_min_pole_qry || [];
  if (!arr.length) {
    // Fallback: find first array with 'dt' key
    for (const [, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length && v[0].dt) { arr = v; break; }
    }
  }

  if (!arr.length) {
    return { name, flag, error: true, value: 0, change: 0, changePct: 0, sparkline: [] };
  }

  const latest = arr[0];
  // Kiwoom API returns index values * 100 (no decimal point)
  const cur = parseFloat(latest.cur_prc) / 100;
  // Calculate change from previous day's data (arr[1]) since pred_close_pric may be 0
  const prevDay = arr.length > 1 ? arr[1] : null;
  const prev = prevDay ? parseFloat(prevDay.cur_prc) / 100 : cur;
  const change = cur - prev;
  const changePct = prev ? (change / prev) * 100 : 0;

  const sparkline = arr
    .slice(0, 10)
    .reverse()
    .map((d) => parseFloat(d.cur_prc) / 100)
    .filter((v) => !isNaN(v));

  return {
    name,
    flag,
    value: cur,
    change,
    changePct,
    open: parseFloat(latest.open_pric) / 100 || 0,
    high: parseFloat(latest.high_pric) / 100 || 0,
    low: parseFloat(latest.low_pric) / 100 || 0,
    volume: parseInt(latest.trde_qty) || 0,
    date: latest.dt || '',
    sparkline,
    error: false,
  };
}

function parseRankingData(result) {
  if (result.status !== 'fulfilled') return [];
  const arr = result.value?.trde_qty_updt || [];

  return arr.slice(0, 20).map((item, i) => ({
    rank: i + 1,
    code: item.stk_cd || '',
    name: (item.stk_nm || '').trim(),
    price: parseKiwoomAbs(item.cur_prc),    // Price is always positive; +/- is direction
    change: parseKiwoomNum(item.pred_pre),   // Change keeps sign
    changePct: parseFloat(item.flu_rt) || 0,
    volume: parseInt(item.now_trde_qty) || 0,
    prevVolume: parseInt(item.prev_trde_qty) || 0,
    direction: getSigDirection(item.pred_pre_sig),
  }));
}

function parseInvestorData(result, label) {
  if (result.status !== 'fulfilled') return { label, stocks: [] };
  const arr = result.value?.invsr_daly_trde_stk || [];
  return {
    label,
    stocks: arr.slice(0, 10).map((item) => ({
      code: item.stk_cd,
      name: (item.stk_nm || '').trim(),
      netAmount: parseKiwoomNum(item.netslmt_amt),
      netQty: parseKiwoomNum(item.netslmt_qty),
      price: parseKiwoomNum(item.cur_prc),
      changePct: parseFloat(item.pre_rt) || 0,
    })),
  };
}

function parseRiserData(result) {
  if (result.status !== 'fulfilled') return [];
  const arr = result.value?.updown_pric || [];
  return arr.slice(0, 10).map((item) => ({
    code: item.stk_cd,
    name: (item.stk_nm || '').trim(),
    price: parseKiwoomAbs(item.cur_prc),
    changePct: parseFloat(item.flu_rt) || 0,
    volume: parseInt(item.trde_qty) || 0,
  }));
}

function parseKiwoomNum(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[+,]/g, '')) || 0;
}

// Absolute value parser for prices (Kiwoom prefixes +/- for direction)
function parseKiwoomAbs(str) {
  if (!str) return 0;
  return Math.abs(parseFloat(String(str).replace(/[+,]/g, ''))) || 0;
}

function getSigDirection(sig) {
  if (sig === '1' || sig === '2') return 'up';
  if (sig === '4' || sig === '5') return 'down';
  return 'flat';
}

// ===================== GLOBAL DATA (Yahoo Finance) =====================
async function fetchGlobalData() {
  const symbols = {
    sp500: { symbol: '^GSPC', name: 'S&P 500', flag: '🇺🇸' },
    nasdaq: { symbol: '^IXIC', name: 'NASDAQ', flag: '🇺🇸' },
    dow: { symbol: '^DJI', name: 'DOW', flag: '🇺🇸' },
    vix: { symbol: '^VIX', name: 'VIX', flag: '📊' },
    usdkrw: { symbol: 'USDKRW=X', name: 'USD/KRW', flag: '💱' },
    gold: { symbol: 'GC=F', name: 'Gold', flag: '🥇' },
    wti: { symbol: 'CL=F', name: 'WTI', flag: '🛢' },
    dxy: { symbol: 'DX-Y.NYB', name: 'DXY', flag: '💵' },
    nikkei: { symbol: '^N225', name: 'Nikkei 225', flag: '🇯🇵' },
    shanghai: { symbol: '000001.SS', name: 'Shanghai', flag: '🇨🇳' },
    us10y: { symbol: '^TNX', name: 'US 10Y', flag: '🏛' },
    us2y: { symbol: '^IRX', name: 'US 13W', flag: '🏛' },
  };

  const results = {};
  const entries = Object.entries(symbols);

  const fetches = await Promise.allSettled(
    entries.map(([, info]) => fetchYahoo(info.symbol))
  );

  entries.forEach(([key, info], i) => {
    const r = fetches[i];
    if (r.status === 'fulfilled' && r.value) {
      results[key] = { ...r.value, name: info.name, flag: info.flag };
    }
  });

  return results;
}

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose || meta.chartPreviousClose;
    if (!price || !prevClose) return null;

    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const sparkline = closes.filter((v) => v != null);

    return { value: price, change, changePct, sparkline };
  } catch {
    return null;
  }
}

// ===================== HELPERS =====================
function getKSTDateString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

function getMarketStatus() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  const day = kst.getUTCDay();
  const time = h * 60 + m;

  if (day === 0 || day === 6) return { status: 'closed', label: '주말 휴장' };
  if (time >= 540 && time <= 930) return { status: 'open', label: '장중' };
  if (time >= 510 && time < 540) return { status: 'pre', label: '장전' };
  if (time > 930 && time <= 960) return { status: 'after', label: '장후' };
  if (time > 960 && time <= 1200) return { status: 'nxt', label: 'NXT 거래' };
  return { status: 'closed', label: '장마감' };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=20',
    },
  });
}

// ===================== HTML =====================
const HTML = `<!DOCTYPE html>
<html lang="ko" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>KOSPI 선행지표 대시보드</title>
<meta name="description" content="코스피 선행지표 실시간 모니터링 - KOSPI, KOSDAQ, 글로벌 지수, 환율, 원자재">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#111318">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📊</text></svg>">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg-page:#111318;
  --bg-card:#1a1d27;
  --bg-card-hover:#1f222e;
  --bg-tab:#16181f;
  --border:#262a36;
  --border-light:#2d313f;
  --text:#e4e5e9;
  --text-secondary:#9096a4;
  --text-muted:#5c6170;
  --up:#ef4444;
  --up-soft:rgba(239,68,68,0.1);
  --down:#3b82f6;
  --down-soft:rgba(59,130,246,0.1);
  --flat:#6b7280;
  --green:#22c55e;
  --green-soft:rgba(34,197,94,0.1);
  --font:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,system-ui,Roboto,sans-serif;
}
html{font-size:14px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--font);background:var(--bg-page);color:var(--text);min-height:100vh;line-height:1.5}

/* Container */
.wrap{max-width:960px;margin:0 auto;padding:0 16px 80px}

/* Header */
.hdr{padding:20px 0 16px;display:flex;align-items:center;justify-content:space-between}
.hdr-left{display:flex;align-items:center;gap:10px}
.hdr h1{font-size:17px;font-weight:700;color:var(--text);letter-spacing:-0.02em}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px}
.badge.open{background:var(--green-soft);color:var(--green)}
.badge.closed{background:rgba(107,114,128,0.12);color:var(--text-muted)}
.badge.pre,.badge.after,.badge.nxt{background:rgba(251,191,36,0.1);color:#fbbf24}
.badge-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.open .badge-dot{animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
.hdr-right{display:flex;align-items:center;gap:12px}
.hdr-time{font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums}
.btn-refresh{
  background:none;border:1px solid var(--border);color:var(--text-secondary);
  border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:500;
  font-family:var(--font);display:flex;align-items:center;gap:5px;transition:all .15s;
}
.btn-refresh:hover{border-color:var(--border-light);color:var(--text);background:var(--bg-card)}
.btn-refresh.spin svg{animation:rot .8s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}
.btn-refresh svg{width:13px;height:13px}

/* Divider */
.divider{height:1px;background:var(--border);margin:0 0 16px}

/* Tabs */
.tabs{display:flex;gap:2px;margin-bottom:16px;background:var(--bg-tab);border-radius:10px;padding:3px;border:1px solid var(--border)}
.tab-btn{
  flex:1;padding:7px 0;text-align:center;font-size:12px;font-weight:600;
  color:var(--text-muted);background:none;border:none;border-radius:8px;
  cursor:pointer;font-family:var(--font);transition:all .15s;
}
.tab-btn:hover{color:var(--text-secondary)}
.tab-btn.active{background:var(--bg-card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,0.3)}

/* Section */
.sec{margin-bottom:20px}
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sec-title{font-size:13px;font-weight:700;color:var(--text-secondary)}
.sec-sub{font-size:11px;color:var(--text-muted)}

/* Grid */
.g1{display:grid;grid-template-columns:1fr;gap:8px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px}

/* Card */
.c{
  background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
  padding:14px 16px;transition:background .15s;position:relative;overflow:hidden;
}
.c:hover{background:var(--bg-card-hover)}
.c-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.c-name{font-size:12px;font-weight:600;color:var(--text-secondary)}
.c-flag{margin-right:4px}
.c-val{font-size:22px;font-weight:800;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;line-height:1.15;margin-bottom:4px}
.c-chg{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.c-chg .pct{opacity:0.7}
.c.up .c-val,.c.up .c-chg{color:var(--up)}
.c.down .c-val,.c.down .c-chg{color:var(--down)}
.c.flat .c-val{color:var(--text)}
.c.flat .c-chg{color:var(--flat)}

/* Large card */
.c-lg .c-val{font-size:28px}
.c-lg{padding:18px 20px}
.c-detail{display:flex;gap:16px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums}
.c-detail dt{font-size:10px;color:var(--text-muted);opacity:.6;margin-bottom:1px}
.c-detail dd{font-weight:600}

/* Sparkline */
.spark{margin-top:10px;height:28px;width:100%;opacity:0.8}
.spark svg{width:100%;height:100%}

/* Table */
.tbl-wrap{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.tbl-wrap table{width:100%;border-collapse:collapse}
.tbl-wrap th{
  font-size:11px;font-weight:600;color:var(--text-muted);padding:10px 14px;text-align:left;
  border-bottom:1px solid var(--border);background:rgba(255,255,255,0.015);
}
.tbl-wrap td{padding:9px 14px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.02)}
.tbl-wrap tr:last-child td{border-bottom:none}
.tbl-wrap tr:hover td{background:rgba(255,255,255,0.015)}
.th-r{text-align:right}
.td-r{text-align:right}
.td-mono{font-variant-numeric:tabular-nums;font-weight:600}
.td-up{color:var(--up)}
.td-down{color:var(--down)}
.td-flat{color:var(--flat)}
.td-muted{color:var(--text-muted);font-size:12px}
.rk{
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:6px;font-size:11px;font-weight:700;
  background:rgba(99,102,241,0.08);color:#818cf8;
}
.rk.gold{background:rgba(251,191,36,0.08);color:#fbbf24}
.sn{font-weight:600}
.sc{font-size:11px;color:var(--text-muted);margin-left:5px;font-variant-numeric:tabular-nums}

/* Investor */
.inv-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.inv-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px}
.inv-card h3{font-size:13px;font-weight:700;margin-bottom:10px;color:var(--text-secondary)}
.inv-row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px}
.inv-row .inv-name{font-weight:500}
.inv-row .inv-val{font-weight:700;font-variant-numeric:tabular-nums}
.inv-row .inv-val.up{color:var(--up)}
.inv-row .inv-val.down{color:var(--down)}

/* Footer */
.ft{padding:24px 0;margin-top:12px;border-top:1px solid var(--border);text-align:center;font-size:11px;color:var(--text-muted);line-height:1.8}

/* Skeleton */
.sk{background:linear-gradient(90deg,var(--bg-card) 25%,#22252f 50%,var(--bg-card) 75%);background-size:200% 100%;animation:shm 1.5s infinite;border-radius:4px}
@keyframes shm{to{background-position:-200% 0}}
.sk-v{height:30px;width:55%;margin-bottom:6px}
.sk-c{height:16px;width:35%}
.sk-r{height:40px;width:100%;margin-bottom:4px}

/* Error */
.err{text-align:center;padding:32px;color:var(--text-muted);font-size:13px}

/* Tab panels */
.tab-panel{display:none}
.tab-panel.active{display:block}

/* Responsive */
@media(max-width:768px){
  .g3{grid-template-columns:1fr 1fr}
  .g4{grid-template-columns:1fr 1fr}
  .inv-grid{grid-template-columns:1fr}
  .c-lg .c-val{font-size:24px}
}
@media(max-width:480px){
  .g3,.g4{grid-template-columns:1fr}
  .hdr-right{gap:8px}
  .wrap{padding:0 12px 60px}
}

/* Animation */
.fade{animation:fin .35s ease}
@keyframes fin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
</style>
</head>
<body>
<div class="wrap">

<header class="hdr">
  <div class="hdr-left">
    <h1>코스피 선행지표</h1>
    <span class="badge closed" id="badge"><span class="badge-dot"></span><span id="badgeTxt">--</span></span>
  </div>
  <div class="hdr-right">
    <span class="hdr-time" id="clock">--:--:-- KST</span>
    <button class="btn-refresh" id="rbtn" onclick="load()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    </button>
  </div>
</header>

<div class="divider"></div>

<!-- Tabs -->
<div class="tabs" id="mainTabs">
  <button class="tab-btn active" data-tab="core">핵심 지표</button>
  <button class="tab-btn" data-tab="global">글로벌 지수</button>
  <button class="tab-btn" data-tab="commodity">원자재</button>
  <button class="tab-btn" data-tab="rate">금리/채권</button>
</div>

<!-- Core -->
<div class="tab-panel active" id="p-core">
  <section class="sec">
    <div class="sec-head"><span class="sec-title">한국 시장</span></div>
    <div class="g3" id="krIdx">
      <div class="c c-lg"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c c-lg"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c c-lg"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
    </div>
  </section>
  <section class="sec">
    <div class="sec-head"><span class="sec-title">주요 글로벌</span></div>
    <div class="g4" id="glIdx">
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
    </div>
  </section>
  <section class="sec">
    <div class="sec-head"><span class="sec-title">환율</span></div>
    <div class="g3" id="fxIdx">
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
      <div class="c"><div class="sk sk-v"></div><div class="sk sk-c"></div></div>
    </div>
  </section>
</div>

<!-- Global -->
<div class="tab-panel" id="p-global">
  <section class="sec">
    <div class="sec-head"><span class="sec-title">글로벌 지수</span></div>
    <div class="g3" id="glAll"></div>
  </section>
</div>

<!-- Commodity -->
<div class="tab-panel" id="p-commodity">
  <section class="sec">
    <div class="sec-head"><span class="sec-title">원자재</span></div>
    <div class="g3" id="cmdAll"></div>
  </section>
</div>

<!-- Rate -->
<div class="tab-panel" id="p-rate">
  <section class="sec">
    <div class="sec-head"><span class="sec-title">금리 / 채권</span></div>
    <div class="g2" id="rateAll"></div>
  </section>
</div>

<div class="divider" style="margin-top:8px"></div>

<!-- Bottom tabs -->
<div class="tabs" id="btmTabs">
  <button class="tab-btn active" data-tab="ranking">거래량 상위</button>
  <button class="tab-btn" data-tab="risers">상승 종목</button>
  <button class="tab-btn" data-tab="investors">투자자 동향</button>
</div>

<div class="tab-panel active" id="p-ranking">
  <div class="tbl-wrap">
    <table><thead><tr><th style="width:40px">#</th><th>종목</th><th class="th-r">현재가</th><th class="th-r">등락률</th><th class="th-r">거래량</th></tr></thead>
    <tbody id="tbRank"><tr><td colspan="5"><div class="sk sk-r"></div></td></tr></tbody></table>
  </div>
</div>
<div class="tab-panel" id="p-risers">
  <div class="tbl-wrap">
    <table><thead><tr><th style="width:40px">#</th><th>종목</th><th class="th-r">현재가</th><th class="th-r">등락률</th></tr></thead>
    <tbody id="tbRise"></tbody></table>
  </div>
</div>
<div class="tab-panel" id="p-investors">
  <div class="inv-grid" id="invGrid"></div>
</div>

<footer class="ft">
  <p>본 서비스는 투자 참고용 정보를 제공하며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
  <p style="margin-top:4px;opacity:.6">Kiwoom Securities API &middot; Yahoo Finance &middot; 30초 자동갱신</p>
</footer>

</div>

<script>
let D=null,T=null;
document.addEventListener('DOMContentLoaded',()=>{load();T=setInterval(load,30000);initTabs()});

function initTabs(){
  document.querySelectorAll('.tabs').forEach(wrap=>{
    wrap.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        wrap.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const id=btn.dataset.tab;
        const prefix=wrap.id==='mainTabs'?'p-':'p-';
        const panels=wrap.id==='mainTabs'?['core','global','commodity','rate']:['ranking','risers','investors'];
        panels.forEach(p=>{const el=document.getElementById(prefix+p);if(el)el.classList.toggle('active',p===id)});
      });
    });
  });
}

async function load(){
  const b=document.getElementById('rbtn');b.classList.add('spin');
  try{
    const r=await fetch('/api/market');
    if(!r.ok)throw new Error(r.status);
    D=await r.json();render(D);
  }catch(e){console.error(e)}
  finally{b.classList.remove('spin')}
}

function render(d){
  rStatus(d.marketStatus);rClock(d.updated);
  rKR(d.indices);rGlobal(d.global);rFX(d.global);
  rGlobalAll(d.global);rCommodity(d.global);rRate(d.global);
  rRanking(d.ranking);rRisers(d.risers);rInvestors(d.investors);
}

function rStatus(s){if(!s)return;const b=document.getElementById('badge');b.className='badge '+s.status;document.getElementById('badgeTxt').textContent=s.label}

function rClock(iso){if(!iso)return;const d=new Date(iso),k=new Date(d.getTime()+9*36e5);
  document.getElementById('clock').textContent=
    [k.getUTCHours(),k.getUTCMinutes(),k.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':')+' KST'}

// === Cards ===
function card(d,lg){
  const dir=d.change>0?'up':d.change<0?'down':'flat';
  const arr=d.change>0?'▲':d.change<0?'▼':'';
  const dec=d.value>=1000?2:d.value>=100?2:2;
  const spark=d.sparkline&&d.sparkline.length>1?mkSpark(d.sparkline,dir):'';
  let det='';
  if(lg&&d.open){det='<div class="c-detail"><dl><dt>시가</dt><dd>'+fn(d.open,dec)+'</dd></dl><dl><dt>고가</dt><dd>'+fn(d.high,dec)+'</dd></dl><dl><dt>저가</dt><dd>'+fn(d.low,dec)+'</dd></dl></div>'}
  return '<div class="c '+(lg?'c-lg ':'')+dir+' fade"><div class="c-top"><span class="c-name">'+(d.flag?'<span class="c-flag">'+d.flag+'</span>':'')+d.name+'</span></div>'
    +'<div class="c-val">'+fn(d.value,dec)+'</div>'
    +'<div class="c-chg"><span>'+arr+' '+fc(d.change,dec)+'</span><span class="pct">('+fp(d.changePct)+')</span></div>'
    +spark+det+'</div>';
}

function rKR(idx){if(!idx)return;const el=document.getElementById('krIdx');
  el.innerHTML=[idx.kospi,idx.kosdaq,idx.kospi200].map(i=>i&&!i.error?card(i,true):errC()).join('')}

function rGlobal(g){if(!g)return;const el=document.getElementById('glIdx');
  el.innerHTML=['sp500','nasdaq','dow','vix'].map(k=>g[k]?card(g[k],false):emC(k)).join('')}

function rFX(g){if(!g)return;const el=document.getElementById('fxIdx');
  el.innerHTML=['usdkrw','dxy','gold'].map(k=>g[k]?card(g[k],false):emC(k)).join('')}

function rGlobalAll(g){if(!g)return;const el=document.getElementById('glAll');
  el.innerHTML=['sp500','nasdaq','dow','nikkei','shanghai','vix'].map(k=>g[k]?card(g[k],false):emC(k)).join('')}

function rCommodity(g){if(!g)return;const el=document.getElementById('cmdAll');
  el.innerHTML=['gold','wti','dxy'].map(k=>g[k]?card(g[k],false):emC(k)).join('')}

function rRate(g){if(!g)return;const el=document.getElementById('rateAll');
  el.innerHTML=['us10y','us2y'].map(k=>g[k]?card(g[k],false):emC(k)).join('')}

// === Tables ===
function rRanking(r){if(!r)return;const tb=document.getElementById('tbRank');
  if(!r.length){tb.innerHTML='<tr><td colspan="5" class="err">데이터 없음</td></tr>';return}
  tb.innerHTML=r.map(s=>{
    const dc=s.direction==='up'?'td-up':s.direction==='down'?'td-down':'td-flat';
    const ar=s.direction==='up'?'▲ ':s.direction==='down'?'▼ ':'';
    return '<tr class="fade"><td><span class="rk'+(s.rank<=3?' gold':'')+'">'+s.rank+'</span></td>'
      +'<td><span class="sn">'+s.name+'</span><span class="sc">'+s.code+'</span></td>'
      +'<td class="td-r td-mono">'+fpr(s.price)+'</td>'
      +'<td class="td-r td-mono '+dc+'">'+ar+fp(s.changePct)+'</td>'
      +'<td class="td-r td-muted td-mono">'+fvol(s.volume)+'</td></tr>';
  }).join('')}

function rRisers(r){if(!r)return;const tb=document.getElementById('tbRise');
  if(!r.length){tb.innerHTML='<tr><td colspan="4" class="err">데이터 없음</td></tr>';return}
  tb.innerHTML=r.map((s,i)=>'<tr class="fade"><td><span class="rk'+(i<3?' gold':'')+'">'+
    (i+1)+'</span></td><td><span class="sn">'+s.name+'</span><span class="sc">'+s.code+
    '</span></td><td class="td-r td-mono">'+fpr(s.price)+'</td><td class="td-r td-mono td-up">▲ '+
    fp(s.changePct)+'</td></tr>').join('')}

function rInvestors(inv){if(!inv)return;const g=document.getElementById('invGrid');
  g.innerHTML=['foreign','institution'].map(k=>{
    const v=inv[k];if(!v||!v.stocks||!v.stocks.length)return'<div class="inv-card"><h3>'+
      (v?v.label:k)+'</h3><div class="err">데이터 없음</div></div>';
    return'<div class="inv-card fade"><h3>'+v.label+' 순매수 TOP</h3>'+
      v.stocks.map(s=>{const d=s.netQty>0?'up':s.netQty<0?'down':'';
        return'<div class="inv-row"><span class="inv-name">'+s.name+'</span><span class="inv-val '+
          d+'">'+fpr(Math.abs(s.netQty))+' 주</span></div>'}).join('')+'</div>';
  }).join('')}

// === Sparkline ===
function mkSpark(data,dir){
  if(!data||data.length<2)return'';
  const w=220,h=28,p=1,mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>{const x=p+(i/(data.length-1))*(w-p*2);const y=h-p-((v-mn)/rng)*(h-p*2);return x+','+y}).join(' ');
  const clr=dir==='up'?'#ef4444':dir==='down'?'#3b82f6':'#6b7280';
  const gid='s'+Math.random().toString(36).slice(2,7);
  const lx=p+(w-p*2),ap=pts+' '+lx+','+h+' '+p+','+h;
  return'<div class="spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+clr+'" stop-opacity="0.18"/><stop offset="100%" stop-color="'+clr+'" stop-opacity="0"/></linearGradient></defs>'
    +'<polygon points="'+ap+'" fill="url(#'+gid+')"/>'
    +'<polyline points="'+pts+'" fill="none" stroke="'+clr+'" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
}

// === Formatters ===
function fn(n,d){if(n==null||isNaN(n))return'--';return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fc(n,d){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fp(n){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+n.toFixed(2)+'%'}
function fpr(n){if(!n||isNaN(n))return'--';return Math.round(n).toLocaleString('ko-KR')}
function fvol(n){if(!n)return'--';if(n>=1e8)return(n/1e8).toFixed(1)+'억';if(n>=1e4)return(n/1e4).toFixed(0)+'만';return n.toLocaleString('ko-KR')}
function errC(){return'<div class="c c-lg"><div class="err">데이터를 불러올 수 없습니다</div></div>'}
function emC(k){return'<div class="c"><div class="c-top"><span class="c-name">'+k+'</span></div><div class="c-val" style="color:var(--text-muted)">--</div><div class="c-chg" style="color:var(--text-muted)">--</div></div>'}
</script>
</body>
</html>`;
