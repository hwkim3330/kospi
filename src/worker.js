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
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>KOSPI Board</title>
<meta name="description" content="KOSPI, KOSDAQ, 글로벌 지수 실시간 모니터링 대시보드">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#080b14">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📊</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg-body:#080b14;
  --bg-surface:#0e1222;
  --bg-card:rgba(16,20,38,0.85);
  --bg-card-hover:rgba(22,28,52,0.95);
  --border:rgba(255,255,255,0.05);
  --border-hover:rgba(255,255,255,0.1);
  --text-primary:#e8eaef;
  --text-secondary:#7c819a;
  --text-muted:#464b64;
  --up:#ff4757;
  --up-bg:rgba(255,71,87,0.08);
  --up-glow:rgba(255,71,87,0.15);
  --down:#3b82f6;
  --down-bg:rgba(59,130,246,0.08);
  --down-glow:rgba(59,130,246,0.15);
  --flat:#6b7280;
  --accent:#8b5cf6;
  --accent-glow:rgba(139,92,246,0.2);
  --radius:14px;
  --radius-sm:8px;
  --shadow:0 4px 32px rgba(0,0,0,0.4);
  --font-sans:'Inter',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono','SF Mono',monospace;
}
html{font-size:15px;-webkit-font-smoothing:antialiased}
body{
  font-family:var(--font-sans);
  background:var(--bg-body);
  color:var(--text-primary);
  min-height:100vh;
  overflow-x:hidden;
}
body::before{
  content:'';position:fixed;top:0;left:0;right:0;height:600px;
  background:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(139,92,246,0.08),transparent);
  pointer-events:none;z-index:0;
}

/* Layout */
.container{max-width:1440px;margin:0 auto;padding:0 20px;position:relative;z-index:1}
.header{padding:28px 0 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.logo{display:flex;align-items:center;gap:12px}
.logo h1{font-size:1.5rem;font-weight:800;letter-spacing:-0.02em;background:linear-gradient(135deg,#e8eaef,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.status-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;letter-spacing:0.02em}
.status-badge.open{background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.2)}
.status-badge.closed{background:rgba(107,114,128,0.12);color:#9ca3af;border:1px solid rgba(107,114,128,0.2)}
.status-badge.pre,.status-badge.after,.status-badge.nxt{background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.2)}
.status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.status-badge.open .status-dot{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
.header-right{display:flex;align-items:center;gap:16px}
.update-time{font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono)}
.refresh-btn{
  background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);
  color:#a78bfa;border-radius:8px;padding:6px 14px;cursor:pointer;
  font-size:0.8rem;font-weight:600;font-family:var(--font-sans);
  transition:all 0.2s;display:flex;align-items:center;gap:6px;
}
.refresh-btn:hover{background:rgba(139,92,246,0.2);border-color:rgba(139,92,246,0.35)}
.refresh-btn.loading{opacity:0.6;pointer-events:none}
.refresh-btn svg{width:14px;height:14px}
.refresh-btn.loading svg{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Sections */
.section{margin-bottom:32px}
.section-title{
  font-size:0.85rem;font-weight:700;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px;
  display:flex;align-items:center;gap:8px;
}
.section-title::after{content:'';flex:1;height:1px;background:var(--border)}

/* Cards Grid */
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}

/* Index Card */
.card{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:20px;
  transition:all 0.25s ease;
  position:relative;
  overflow:hidden;
  backdrop-filter:blur(12px);
}
.card:hover{
  border-color:var(--border-hover);
  background:var(--bg-card-hover);
  transform:translateY(-1px);
  box-shadow:var(--shadow);
}
.card.up{border-left:3px solid var(--up)}
.card.down{border-left:3px solid var(--down)}
.card.flat{border-left:3px solid var(--flat)}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-name{font-size:0.85rem;font-weight:600;color:var(--text-secondary);display:flex;align-items:center;gap:6px}
.card-flag{font-size:1rem}
.card-badge{font-size:0.65rem;padding:2px 6px;border-radius:4px;font-weight:600;letter-spacing:0.02em}
.card-value{
  font-size:1.85rem;font-weight:800;letter-spacing:-0.03em;
  font-family:var(--font-mono);line-height:1.1;margin-bottom:8px;
  font-variant-numeric:tabular-nums;
}
.card-change{display:flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:600;font-family:var(--font-mono)}
.card-change .arrow{font-size:0.7rem}
.card-change .pct{opacity:0.7}
.card.up .card-value,.card.up .card-change{color:var(--up)}
.card.down .card-value,.card.down .card-change{color:var(--down)}
.card.flat .card-value{color:var(--text-primary)}
.card.flat .card-change{color:var(--flat)}

/* Sparkline */
.sparkline{margin-top:12px;height:32px;width:100%}
.sparkline svg{width:100%;height:100%}

/* Card detail row */
.card-details{
  display:flex;gap:12px;margin-top:10px;padding-top:10px;
  border-top:1px solid var(--border);font-size:0.75rem;color:var(--text-muted);
  font-family:var(--font-mono);
}
.card-details span{display:flex;flex-direction:column;gap:2px}
.card-details .label{font-size:0.65rem;color:var(--text-muted);opacity:0.7}

/* Index Card (large) */
.card-lg{padding:24px}
.card-lg .card-value{font-size:2.2rem}

/* Global small card */
.card-sm{padding:16px}
.card-sm .card-value{font-size:1.3rem}
.card-sm .card-change{font-size:0.78rem}

/* Table */
.table-wrap{
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:var(--radius);overflow:hidden;backdrop-filter:blur(12px);
}
.table-wrap table{width:100%;border-collapse:collapse}
.table-wrap th{
  font-size:0.72rem;font-weight:600;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:0.06em;
  padding:12px 16px;text-align:left;
  border-bottom:1px solid var(--border);
  background:rgba(255,255,255,0.02);
  position:sticky;top:0;
}
.table-wrap td{
  padding:10px 16px;font-size:0.85rem;
  border-bottom:1px solid rgba(255,255,255,0.025);
  transition:background 0.15s;
}
.table-wrap tr:hover td{background:rgba(255,255,255,0.02)}
.table-wrap tr:last-child td{border-bottom:none}
.rank-cell{
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:8px;font-weight:700;font-size:0.8rem;
  background:rgba(139,92,246,0.08);color:var(--accent);
  font-family:var(--font-mono);
}
.rank-cell.top3{background:rgba(245,158,11,0.1);color:#f59e0b}
.stock-name{font-weight:600}
.stock-code{font-size:0.72rem;color:var(--text-muted);margin-left:6px;font-family:var(--font-mono)}
.td-price{font-family:var(--font-mono);font-weight:600;text-align:right}
.td-change{font-family:var(--font-mono);font-weight:600;text-align:right}
.td-volume{font-family:var(--font-mono);color:var(--text-secondary);text-align:right;font-size:0.8rem}
.td-change.up{color:var(--up)}
.td-change.down{color:var(--down)}
.td-change.flat{color:var(--flat)}
th.right{text-align:right}

/* Investor section */
.investor-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.investor-card{
  background:var(--bg-card);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px;backdrop-filter:blur(12px);
}
.investor-card h3{font-size:0.9rem;font-weight:700;margin-bottom:12px;color:var(--text-secondary)}
.investor-item{
  display:flex;justify-content:space-between;align-items:center;
  padding:6px 0;font-size:0.82rem;
}
.investor-item .name{font-weight:500}
.investor-item .amount{font-family:var(--font-mono);font-weight:600}
.investor-item .amount.up{color:var(--up)}
.investor-item .amount.down{color:var(--down)}

/* Footer */
.footer{
  padding:32px 0;margin-top:20px;
  border-top:1px solid var(--border);
  text-align:center;font-size:0.75rem;color:var(--text-muted);
  line-height:1.8;
}

/* Skeleton */
.skeleton{
  background:linear-gradient(90deg,var(--bg-surface) 25%,rgba(255,255,255,0.04) 50%,var(--bg-surface) 75%);
  background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;
}
@keyframes shimmer{to{background-position:-200% 0}}
.skel-value{height:36px;width:60%;margin-bottom:8px}
.skel-change{height:18px;width:40%}
.skel-row{height:44px;width:100%;margin-bottom:4px}

/* Error */
.error-card{text-align:center;padding:40px;color:var(--text-muted)}
.error-card .icon{font-size:2rem;margin-bottom:8px}

/* Responsive */
@media(max-width:1024px){
  .grid-4{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:768px){
  html{font-size:14px}
  .container{padding:0 14px}
  .header{padding:20px 0 16px}
  .grid-3{grid-template-columns:1fr}
  .grid-4{grid-template-columns:repeat(2,1fr)}
  .grid-2{grid-template-columns:1fr}
  .investor-grid{grid-template-columns:1fr}
  .card-lg .card-value{font-size:1.8rem}
  .table-wrap{overflow-x:auto}
  .table-wrap table{min-width:600px}
}
@media(max-width:480px){
  .grid-4{grid-template-columns:1fr}
  .header-right{width:100%;justify-content:space-between}
}

/* Animations */
.fade-in{animation:fadeIn 0.4s ease-out}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card-value.flash-up{animation:flashUp 0.6s ease}
.card-value.flash-down{animation:flashDown 0.6s ease}
@keyframes flashUp{0%{background:var(--up-bg)}100%{background:transparent}}
@keyframes flashDown{0%{background:var(--down-bg)}100%{background:transparent}}

/* Tabs */
.tabs{display:flex;gap:4px;margin-bottom:18px;flex-wrap:wrap}
.tab{
  padding:6px 16px;border-radius:8px;font-size:0.8rem;font-weight:600;
  cursor:pointer;transition:all 0.2s;color:var(--text-muted);
  border:1px solid transparent;background:transparent;
  font-family:var(--font-sans);
}
.tab:hover{color:var(--text-secondary);background:rgba(255,255,255,0.03)}
.tab.active{color:var(--accent);background:rgba(139,92,246,0.08);border-color:rgba(139,92,246,0.15)}
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <header class="header">
    <div class="logo">
      <h1>KOSPI Board</h1>
      <div class="status-badge closed" id="marketStatus">
        <span class="status-dot"></span>
        <span id="statusLabel">--</span>
      </div>
    </div>
    <div class="header-right">
      <span class="update-time" id="updateTime">--</span>
      <button class="refresh-btn" id="refreshBtn" onclick="loadData()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        새로고침
      </button>
    </div>
  </header>

  <!-- Korean Indices -->
  <section class="section">
    <div class="section-title">한국 시장</div>
    <div class="grid-3" id="krIndices">
      <div class="card card-lg"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-lg"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-lg"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
    </div>
  </section>

  <!-- Global Indices -->
  <section class="section">
    <div class="section-title">글로벌 지수</div>
    <div class="grid-4" id="globalIndices">
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
    </div>
  </section>

  <!-- FX & Commodities -->
  <section class="section">
    <div class="section-title">환율 & 원자재</div>
    <div class="grid-4" id="fxCommodities">
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
    </div>
  </section>

  <!-- Bonds -->
  <section class="section">
    <div class="section-title">금리 & 채권</div>
    <div class="grid-4" id="bonds">
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
      <div class="card card-sm"><div class="skeleton skel-value"></div><div class="skeleton skel-change"></div></div>
    </div>
  </section>

  <!-- Tabs: Ranking / Investors -->
  <section class="section">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('ranking',this)">거래량 상위</button>
      <button class="tab" onclick="switchTab('investors',this)">투자자 동향</button>
      <button class="tab" onclick="switchTab('risers',this)">상승 종목</button>
    </div>
    <div id="tab-ranking">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:50px">#</th>
            <th>종목</th>
            <th class="right">현재가</th>
            <th class="right">등락률</th>
            <th class="right">거래량</th>
          </tr></thead>
          <tbody id="rankingBody">
            <tr><td colspan="5"><div class="skeleton skel-row"></div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="tab-investors" style="display:none">
      <div class="investor-grid" id="investorGrid"></div>
    </div>
    <div id="tab-risers" style="display:none">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:50px">#</th>
            <th>종목</th>
            <th class="right">현재가</th>
            <th class="right">등락률</th>
          </tr></thead>
          <tbody id="risersBody"></tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <p>본 서비스는 투자 참고용 정보를 제공하며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
    <p>Data: Kiwoom Securities API &bull; Yahoo Finance &bull; Updated every 30s</p>
  </footer>
</div>

<script>
// ===== State =====
let autoRefresh = true;
let refreshTimer = null;
let lastData = null;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  startAutoRefresh();
});

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (autoRefresh) loadData(); }, 30000);
}

// ===== Data Loading =====
async function loadData() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('loading');

  try {
    const resp = await fetch('/api/market');
    if (!resp.ok) throw new Error('API error ' + resp.status);
    const data = await resp.json();
    lastData = data;
    render(data);
  } catch (e) {
    console.error('Load error:', e);
  } finally {
    btn.classList.remove('loading');
  }
}

// ===== Rendering =====
function render(data) {
  renderMarketStatus(data.marketStatus);
  renderKRIndices(data.indices);
  renderGlobalIndices(data.global);
  renderFXCommodities(data.global);
  renderBonds(data.global);
  renderRanking(data.ranking);
  renderInvestors(data.investors);
  renderRisers(data.risers);
  renderUpdateTime(data.updated);
}

function renderMarketStatus(ms) {
  if (!ms) return;
  const badge = document.getElementById('marketStatus');
  const label = document.getElementById('statusLabel');
  badge.className = 'status-badge ' + ms.status;
  label.textContent = ms.label;
}

function renderUpdateTime(iso) {
  const el = document.getElementById('updateTime');
  if (!iso) return;
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9*60*60*1000);
  const hh = String(kst.getUTCHours()).padStart(2,'0');
  const mm = String(kst.getUTCMinutes()).padStart(2,'0');
  const ss = String(kst.getUTCSeconds()).padStart(2,'0');
  el.textContent = hh + ':' + mm + ':' + ss + ' KST';
}

function renderKRIndices(indices) {
  if (!indices) return;
  const el = document.getElementById('krIndices');
  const items = [indices.kospi, indices.kosdaq, indices.kospi200];
  el.innerHTML = items.map(idx => {
    if (!idx || idx.error) return errorCard();
    return indexCard(idx, true);
  }).join('');
}

function indexCard(d, large) {
  const dir = d.change > 0 ? 'up' : d.change < 0 ? 'down' : 'flat';
  const arrow = d.change > 0 ? '▲' : d.change < 0 ? '▼' : '―';
  const cls = large ? 'card card-lg fade-in ' + dir : 'card card-sm fade-in ' + dir;
  const decimals = d.value >= 100 ? 2 : 2;
  const sparkSVG = d.sparkline && d.sparkline.length > 1 ? makeSparkline(d.sparkline, dir) : '';

  let details = '';
  if (large && d.open) {
    details = '<div class="card-details">'
      + '<span><span class="label">시가</span>' + fmtNum(d.open, decimals) + '</span>'
      + '<span><span class="label">고가</span>' + fmtNum(d.high, decimals) + '</span>'
      + '<span><span class="label">저가</span>' + fmtNum(d.low, decimals) + '</span>'
      + '</div>';
  }

  return '<div class="' + cls + '">'
    + '<div class="card-header">'
    + '<span class="card-name"><span class="card-flag">' + (d.flag||'') + '</span>' + d.name + '</span>'
    + '</div>'
    + '<div class="card-value">' + fmtNum(d.value, decimals) + '</div>'
    + '<div class="card-change">'
    + '<span class="arrow">' + arrow + '</span>'
    + '<span>' + fmtChange(d.change, decimals) + '</span>'
    + '<span class="pct">(' + fmtPct(d.changePct) + ')</span>'
    + '</div>'
    + sparkSVG
    + details
    + '</div>';
}

function renderGlobalIndices(global) {
  if (!global) return;
  const el = document.getElementById('globalIndices');
  const keys = ['sp500','nasdaq','dow','vix','nikkei','shanghai'];
  el.innerHTML = keys.map(k => {
    const d = global[k];
    if (!d) return emptySmallCard(k);
    return indexCard({...d, name: d.name, flag: d.flag}, false);
  }).join('');
}

function renderFXCommodities(global) {
  if (!global) return;
  const el = document.getElementById('fxCommodities');
  const keys = ['usdkrw','dxy','gold','wti'];
  el.innerHTML = keys.map(k => {
    const d = global[k];
    if (!d) return emptySmallCard(k);
    return indexCard({...d, name: d.name, flag: d.flag}, false);
  }).join('');
}

function renderBonds(global) {
  if (!global) return;
  const el = document.getElementById('bonds');
  const keys = ['us10y','us2y'];
  el.innerHTML = keys.map(k => {
    const d = global[k];
    if (!d) return emptySmallCard(k);
    return indexCard({...d, name: d.name, flag: d.flag}, false);
  }).join('');
}

function renderRanking(ranking) {
  if (!ranking) return;
  const tbody = document.getElementById('rankingBody');
  if (!ranking.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">데이터 없음</td></tr>';
    return;
  }
  tbody.innerHTML = ranking.map(s => {
    const dir = s.direction;
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    const rankCls = s.rank <= 3 ? 'rank-cell top3' : 'rank-cell';
    return '<tr class="fade-in">'
      + '<td><span class="' + rankCls + '">' + s.rank + '</span></td>'
      + '<td><span class="stock-name">' + s.name + '</span><span class="stock-code">' + s.code + '</span></td>'
      + '<td class="td-price">' + fmtPrice(s.price) + '</td>'
      + '<td class="td-change ' + dir + '">' + arrow + ' ' + fmtPct(s.changePct) + '</td>'
      + '<td class="td-volume">' + fmtVol(s.volume) + '</td>'
      + '</tr>';
  }).join('');
}

function renderInvestors(investors) {
  if (!investors) return;
  const grid = document.getElementById('investorGrid');
  const cards = ['foreign','institution'].map(key => {
    const inv = investors[key];
    if (!inv || !inv.stocks || !inv.stocks.length) return '';
    return '<div class="investor-card fade-in">'
      + '<h3>' + inv.label + ' 순매수 TOP</h3>'
      + inv.stocks.map(s => {
        const dir = s.netQty > 0 ? 'up' : s.netQty < 0 ? 'down' : 'flat';
        return '<div class="investor-item">'
          + '<span class="name">' + s.name + '</span>'
          + '<span class="amount ' + dir + '">' + fmtPrice(Math.abs(s.netQty)) + ' 주</span>'
          + '</div>';
      }).join('')
      + '</div>';
  });
  grid.innerHTML = cards.join('');
}

function renderRisers(risers) {
  if (!risers) return;
  const tbody = document.getElementById('risersBody');
  if (!risers.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">데이터 없음</td></tr>';
    return;
  }
  tbody.innerHTML = risers.map((s, i) => {
    return '<tr class="fade-in">'
      + '<td><span class="rank-cell' + (i < 3 ? ' top3' : '') + '">' + (i+1) + '</span></td>'
      + '<td><span class="stock-name">' + s.name + '</span><span class="stock-code">' + s.code + '</span></td>'
      + '<td class="td-price">' + fmtPrice(s.price) + '</td>'
      + '<td class="td-change up">▲ ' + fmtPct(s.changePct) + '</td>'
      + '</tr>';
  }).join('');
}

// ===== Tabs =====
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['ranking','investors','risers'].forEach(id => {
    document.getElementById('tab-' + id).style.display = id === name ? '' : 'none';
  });
}

// ===== Sparkline =====
function makeSparkline(data, dir) {
  if (!data || data.length < 2) return '';
  const w = 200, h = 32, pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return x + ',' + y;
  }).join(' ');

  const color = dir === 'up' ? 'var(--up)' : dir === 'down' ? 'var(--down)' : 'var(--flat)';
  const gradId = 'g' + Math.random().toString(36).slice(2, 8);

  // Area gradient
  const lastX = pad + (w - pad * 2);
  const areaPoints = points + ' ' + lastX + ',' + h + ' ' + pad + ',' + h;

  return '<div class="sparkline">'
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
    + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.2"/>'
    + '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>'
    + '</linearGradient></defs>'
    + '<polygon points="' + areaPoints + '" fill="url(#' + gradId + ')"/>'
    + '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg></div>';
}

// ===== Formatters =====
function fmtNum(n, d) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtChange(n, d) {
  if (n == null || isNaN(n)) return '--';
  const prefix = n > 0 ? '+' : '';
  return prefix + Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '--';
  const prefix = n > 0 ? '+' : '';
  return prefix + n.toFixed(2) + '%';
}

function fmtPrice(n) {
  if (!n || isNaN(n)) return '--';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtVol(n) {
  if (!n) return '--';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000) return (n / 10000).toFixed(0) + '만';
  return n.toLocaleString('ko-KR');
}

function errorCard() {
  return '<div class="card card-lg"><div class="error-card"><div class="icon">⚠️</div><div>데이터 로딩 실패</div></div></div>';
}

function emptySmallCard(key) {
  return '<div class="card card-sm"><div class="card-header"><span class="card-name">' + key + '</span></div>'
    + '<div class="card-value" style="color:var(--text-muted)">--</div>'
    + '<div class="card-change" style="color:var(--text-muted)">--</div></div>';
}
</script>
</body>
</html>`;
