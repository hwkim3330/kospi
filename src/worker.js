// ============================================================
// KOSPI Board — Cloudflare Worker
// Naver Finance API + Yahoo Finance (no Kiwoom dependency)
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
      }
      if (url.pathname === '/api/market') return json(await getMarketData());
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ===================== DATA =====================
const YAHOO = {
  // Korean
  kospi:      { s: '^KS11',     name: 'KOSPI',           cat: 'kr' },
  kosdaq:     { s: '^KQ11',     name: 'KOSDAQ',          cat: 'kr' },
  // US
  sp500:      { s: '^GSPC',     name: 'S&P 500',         cat: 'us' },
  nasdaq:     { s: '^IXIC',     name: 'NASDAQ',          cat: 'us' },
  dow:        { s: '^DJI',      name: 'DOW',             cat: 'us' },
  vix:        { s: '^VIX',      name: 'VIX',             cat: 'us' },
  // Futures
  nasdaqFut:  { s: 'NQ=F',     name: 'NASDAQ 100 선물',  cat: 'fut' },
  sp500Fut:   { s: 'ES=F',     name: 'S&P 500 선물',     cat: 'fut' },
  // Asia
  nikkei:     { s: '^N225',     name: 'Nikkei 225',      cat: 'asia' },
  shanghai:   { s: '000001.SS', name: 'Shanghai',        cat: 'asia' },
  hangSeng:   { s: '^HSI',     name: 'Hang Seng',        cat: 'asia' },
  // FX & Commodities
  usdkrw:     { s: 'USDKRW=X', name: 'USD/KRW',         cat: 'fx' },
  dxy:        { s: 'DX-Y.NYB', name: 'Dollar Index',     cat: 'fx' },
  gold:       { s: 'GC=F',     name: 'Gold',             cat: 'cmd' },
  wti:        { s: 'CL=F',     name: 'WTI',              cat: 'cmd' },
  natgas:     { s: 'NG=F',     name: 'Natural Gas',      cat: 'cmd' },
  // Bonds
  us10y:      { s: '^TNX',     name: 'US 10Y',           cat: 'bond' },
  us5y:       { s: '^FVX',     name: 'US 5Y',            cat: 'bond' },
  us13w:      { s: '^IRX',     name: 'US 13W',           cat: 'bond' },
};

const NAVER_STOCKS = {
  'NVDA.O':  '엔비디아',
  'TSLA.O':  '테슬라',
  'AAPL.O':  '애플',
  'MSFT.O':  '마이크로소프트',
  'AMZN.O':  '아마존',
  'GOOG.O':  '구글',
  'META.O':  '메타',
  'TSM.N':   'TSMC',
  'AVGO.O':  '브로드컴',
  'AMD.O':   'AMD',
};

async function getMarketData() {
  const entries = Object.entries(YAHOO);
  const naverEntries = Object.entries(NAVER_STOCKS);

  const [yahooResults, naverResults] = await Promise.all([
    Promise.allSettled(entries.map(([, v]) => fetchYahoo(v.s))),
    Promise.allSettled(naverEntries.map(([sym]) => fetchNaver(sym))),
  ]);

  const indicators = {};
  entries.forEach(([key, info], i) => {
    const r = yahooResults[i];
    if (r.status === 'fulfilled' && r.value) {
      indicators[key] = { ...r.value, name: info.name, cat: info.cat };
    }
  });

  const usStocks = [];
  naverEntries.forEach(([sym, nameKr], i) => {
    const r = naverResults[i];
    if (r.status === 'fulfilled' && r.value) {
      usStocks.push({ symbol: sym.split('.')[0], nameKr, ...r.value });
    }
  });

  return { indicators, usStocks, marketStatus: getMarketStatus(), updated: new Date().toISOString() };
}

async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!r.ok) return null;
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose || meta.chartPreviousClose || price;
    const change = price - prev;
    const pct = prev ? (change / prev) * 100 : 0;
    const closes = (d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    return { value: price, change, changePct: pct, sparkline: closes.slice(-20) };
  } catch { return null; }
}

async function fetchNaver(symbol) {
  try {
    const r = await fetch(`https://api.stock.naver.com/stock/${symbol}/basic`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
    });
    if (!r.ok) {
      // Fallback: try .OQ for NASDAQ stocks
      const alt = symbol.replace('.O', '.OQ');
      const r2 = await fetch(`https://api.stock.naver.com/stock/${alt}/basic`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
      });
      if (!r2.ok) return null;
      const d2 = await r2.json();
      return parseNaverStock(d2);
    }
    return parseNaverStock(await r.json());
  } catch { return null; }
}

function parseNaverStock(d) {
  const price = parseFloat((d.closePrice || d.currentPrice || '0').replace(/,/g, ''));
  const change = parseFloat((d.compareToPreviousClosePrice || '0').replace(/,/g, ''));
  const pct = parseFloat(d.fluctuationsRatio || 0);
  if (!price) return null;
  return { value: price, change, changePct: pct };
}

function getMarketStatus() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours(), m = kst.getUTCMinutes(), day = kst.getUTCDay();
  const t = h * 60 + m;
  if (day === 0 || day === 6) return { s: 'closed', l: '주말 휴장' };
  if (t >= 540 && t <= 930) return { s: 'open', l: '장중' };
  if (t >= 510 && t < 540) return { s: 'pre', l: '장전' };
  if (t > 930 && t <= 960) return { s: 'after', l: '장후' };
  return { s: 'closed', l: '장마감' };
}

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' }; }
function json(d, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=15' } }); }

// ===================== HTML =====================
const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>KOSPI Board - 실시간 시장 대시보드</title>
<meta name="description" content="KOSPI, KOSDAQ, 글로벌 지수 실시간 대시보드">
<meta name="theme-color" content="#0a0d14">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📊</text></svg>">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<style>
@font-face{font-family:'Pretendard';font-weight:400;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-Regular.woff2') format('woff2')}
@font-face{font-family:'Pretendard';font-weight:500;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-Medium.woff2') format('woff2')}
@font-face{font-family:'Pretendard';font-weight:600;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-SemiBold.woff2') format('woff2')}
@font-face{font-family:'Pretendard';font-weight:700;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-Bold.woff2') format('woff2')}
@font-face{font-family:'Pretendard';font-weight:800;src:url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/woff2/Pretendard-ExtraBold.woff2') format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0d14;--surface:#111827;--card:#161d2e;--card-hover:#1c2540;
  --border:rgba(255,255,255,0.06);--border-h:rgba(255,255,255,0.12);
  --t1:#f0f2f5;--t2:#8b92a5;--t3:#4b5168;
  --up:#ef4444;--up-bg:rgba(239,68,68,0.08);
  --dn:#3b82f6;--dn-bg:rgba(59,130,246,0.08);
  --flat:#6b7280;
  --accent:#8b5cf6;--accent-bg:rgba(139,92,246,0.1);
  --r:12px;--rs:8px;
  --font:'Pretendard',-apple-system,'Segoe UI',sans-serif;
  --mono:'SF Mono','Cascadia Mono','Consolas',monospace;
}
html{font-size:14px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--font);background:var(--bg);color:var(--t1);min-height:100vh;min-height:100dvh}
body::before{content:'';position:fixed;inset:0;height:500px;background:radial-gradient(ellipse 70% 40% at 50% -10%,rgba(139,92,246,0.06),transparent);pointer-events:none;z-index:0}

.wrap{max-width:1280px;margin:0 auto;padding:0 16px;position:relative;z-index:1}

/* Header */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:20px 0 16px;flex-wrap:wrap;gap:10px}
.hdr-l{display:flex;align-items:center;gap:10px}
.hdr h1{font-size:1.35rem;font-weight:800;letter-spacing:-0.02em;background:linear-gradient(135deg,var(--t1),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:16px;font-size:0.7rem;font-weight:600}
.badge.open{background:rgba(16,185,129,0.1);color:#10b981;border:1px solid rgba(16,185,129,0.2)}
.badge.closed{background:rgba(107,114,128,0.1);color:#9ca3af;border:1px solid rgba(107,114,128,0.15)}
.badge.pre,.badge.after{background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.15)}
.dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.open .dot{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.hdr-r{display:flex;align-items:center;gap:12px}
.time{font-size:.75rem;color:var(--t3);font-family:var(--mono);font-variant-numeric:tabular-nums}
.rbtn{background:var(--accent-bg);border:1px solid rgba(139,92,246,.2);color:#a78bfa;border-radius:var(--rs);padding:5px 12px;cursor:pointer;font-size:.75rem;font-weight:600;font-family:var(--font);transition:all .2s;display:flex;align-items:center;gap:5px}
.rbtn:hover{background:rgba(139,92,246,.18)}
.rbtn.spin svg{animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.rbtn svg{width:13px;height:13px}

/* Tabs */
.tabs{display:flex;gap:2px;padding:4px;background:var(--surface);border-radius:10px;margin-bottom:20px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tabs::-webkit-scrollbar{display:none}
.tab{padding:7px 16px;border-radius:7px;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .2s;color:var(--t3);border:none;background:none;font-family:var(--font)}
.tab:hover{color:var(--t2)}
.tab.on{color:var(--t1);background:var(--card)}

/* Grid */
.grid{display:grid;gap:10px}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.g5{grid-template-columns:repeat(5,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
.sec{display:none}.sec.show{display:block}
.sec-t{font-size:.72rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px 4px}

/* Card */
.c{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;transition:all .2s;position:relative;overflow:hidden;cursor:default}
.c:hover{border-color:var(--border-h);background:var(--card-hover);transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,0,0,.25)}
.c-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.c-nm{font-size:.78rem;font-weight:600;color:var(--t2)}
.c-sub{font-size:.62rem;color:var(--t3);font-weight:500}
.c-val{font-size:1.7rem;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin-bottom:6px;font-variant-numeric:tabular-nums}
.c-chg{display:flex;align-items:baseline;gap:6px;font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.c-chg .p{opacity:.65;font-size:.75rem}
.c.up .c-val,.c.up .c-chg{color:var(--up)}
.c.dn .c-val,.c.dn .c-chg{color:var(--dn)}
.c.flat .c-val{color:var(--t1)}.c.flat .c-chg{color:var(--flat)}
.c.up{border-bottom:2px solid rgba(239,68,68,.3)}
.c.dn{border-bottom:2px solid rgba(59,130,246,.3)}

/* Large card */
.c-lg{padding:20px 22px}
.c-lg .c-val{font-size:2.1rem}
.c-lg .c-chg{font-size:.85rem}
.c-dt{display:flex;gap:16px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);font-size:.7rem;color:var(--t3);font-variant-numeric:tabular-nums}
.c-dt span{display:flex;flex-direction:column;gap:1px}
.c-dt .lb{font-size:.6rem;opacity:.6}

/* Sparkline */
.spark{margin-top:10px;height:28px;width:100%}
.spark svg{width:100%;height:100%}

/* US Stocks table */
.tbl{background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.tbl table{width:100%;border-collapse:collapse}
.tbl th{font-size:.68rem;font-weight:600;color:var(--t3);letter-spacing:.05em;padding:10px 14px;text-align:left;border-bottom:1px solid var(--border);background:rgba(255,255,255,.01)}
.tbl td{padding:9px 14px;font-size:.82rem;border-bottom:1px solid rgba(255,255,255,.02)}
.tbl tr:last-child td{border:none}
.tbl tr:hover td{background:rgba(255,255,255,.015)}
.tbl .r{text-align:right}
.tbl .sym{font-weight:700;color:var(--t1);font-family:var(--mono);font-size:.78rem}
.tbl .knm{font-size:.72rem;color:var(--t2);margin-left:6px}
.tbl .prc{font-weight:600;font-variant-numeric:tabular-nums;font-family:var(--mono)}
.tbl .chg{font-weight:600;font-variant-numeric:tabular-nums;font-family:var(--mono)}
.tbl .chg.up{color:var(--up)}.tbl .chg.dn{color:var(--dn)}.tbl .chg.flat{color:var(--flat)}

/* Skeleton */
.sk{background:linear-gradient(90deg,var(--surface) 25%,rgba(255,255,255,.03) 50%,var(--surface) 75%);background-size:200% 100%;animation:shm 1.5s infinite;border-radius:6px}
@keyframes shm{to{background-position:-200% 0}}
.sk1{height:32px;width:55%;margin-bottom:6px}.sk2{height:16px;width:35%}

/* Footer */
.ft{padding:28px 0;margin-top:24px;border-top:1px solid var(--border);text-align:center;font-size:.7rem;color:var(--t3);line-height:1.7}

/* Responsive */
@media(max-width:900px){.g4,.g5{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.g4,.g5,.g3,.g2{grid-template-columns:1fr}.c-lg .c-val{font-size:1.7rem}.hdr-r{width:100%;justify-content:space-between}.tbl{overflow-x:auto}.tbl table{min-width:480px}}

.fade{animation:fi .35s ease}
@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="wrap">
  <header class="hdr">
    <div class="hdr-l">
      <h1>KOSPI Board</h1>
      <div class="badge closed" id="badge"><span class="dot"></span><span id="bLabel">--</span></div>
    </div>
    <div class="hdr-r">
      <span class="time" id="clock">--:-- KST</span>
      <button class="rbtn" id="rbtn" onclick="load()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        새로고침
      </button>
    </div>
  </header>

  <nav class="tabs" id="tabs">
    <button class="tab on" data-t="core">핵심 지표</button>
    <button class="tab" data-t="global">글로벌 지수</button>
    <button class="tab" data-t="fx">환율 · 원자재</button>
    <button class="tab" data-t="bond">금리 · 채권</button>
    <button class="tab" data-t="stock">미국 주식</button>
  </nav>

  <!-- 핵심 지표 -->
  <section class="sec show" id="s-core">
    <div class="sec-t">한국 시장</div>
    <div class="grid g3" id="kr" style="margin-bottom:16px">
      <div class="c c-lg"><div class="sk sk1"></div><div class="sk sk2"></div></div>
      <div class="c c-lg"><div class="sk sk1"></div><div class="sk sk2"></div></div>
      <div class="c c-lg"><div class="sk sk1"></div><div class="sk sk2"></div></div>
    </div>
    <div class="sec-t">선물</div>
    <div class="grid g3" id="fut">
      <div class="c"><div class="sk sk1"></div><div class="sk sk2"></div></div>
      <div class="c"><div class="sk sk1"></div><div class="sk sk2"></div></div>
      <div class="c"><div class="sk sk1"></div><div class="sk sk2"></div></div>
    </div>
  </section>

  <!-- 글로벌 지수 -->
  <section class="sec" id="s-global">
    <div class="sec-t">미국</div>
    <div class="grid g4" id="us" style="margin-bottom:16px"></div>
    <div class="sec-t">아시아</div>
    <div class="grid g3" id="asia"></div>
  </section>

  <!-- 환율 · 원자재 -->
  <section class="sec" id="s-fx">
    <div class="sec-t">환율</div>
    <div class="grid g2" id="fx" style="margin-bottom:16px"></div>
    <div class="sec-t">원자재</div>
    <div class="grid g3" id="cmd"></div>
  </section>

  <!-- 금리 · 채권 -->
  <section class="sec" id="s-bond">
    <div class="sec-t">미국 국채 금리</div>
    <div class="grid g3" id="bond"></div>
  </section>

  <!-- 미국 주식 -->
  <section class="sec" id="s-stock">
    <div class="sec-t">미국 주요 종목</div>
    <div class="tbl" id="stbl"></div>
  </section>

  <footer class="ft">
    <p>본 서비스는 투자 참고용 정보를 제공하며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
    <p>Data: Yahoo Finance · Naver Finance &bull; 30초 자동 갱신</p>
  </footer>
</div>

<script>
let D = null;

document.addEventListener('DOMContentLoaded', () => {
  load();
  setInterval(() => load(), 30000);
  document.getElementById('tabs').addEventListener('click', e => {
    if (!e.target.classList.contains('tab')) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    e.target.classList.add('on');
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('show'));
    document.getElementById('s-' + e.target.dataset.t).classList.add('show');
  });
});

async function load() {
  const b = document.getElementById('rbtn');
  b.classList.add('spin');
  try {
    const r = await fetch('/api/market');
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
    render();
  } catch(e) { console.error(e); }
  b.classList.remove('spin');
}

function render() {
  if (!D) return;
  const ind = D.indicators || {};
  const ms = D.marketStatus;

  // Status
  const badge = document.getElementById('badge');
  badge.className = 'badge ' + (ms?.s || 'closed');
  document.getElementById('bLabel').textContent = ms?.l || '--';

  // Clock
  if (D.updated) {
    const d = new Date(D.updated);
    const k = new Date(d.getTime() + 9*3600000);
    document.getElementById('clock').textContent =
      String(k.getUTCHours()).padStart(2,'0') + ':' +
      String(k.getUTCMinutes()).padStart(2,'0') + ':' +
      String(k.getUTCSeconds()).padStart(2,'0') + ' KST';
  }

  // Korean
  renderCards('kr', ['kospi','kosdaq','usdkrw'], ind, true);
  // Futures
  renderCards('fut', ['nasdaqFut','sp500Fut','vix'], ind, false);
  // US
  renderCards('us', ['sp500','nasdaq','dow','vix'], ind, false);
  // Asia
  renderCards('asia', ['nikkei','shanghai','hangSeng'], ind, false);
  // FX
  renderCards('fx', ['usdkrw','dxy'], ind, false);
  // Commodities
  renderCards('cmd', ['gold','wti','natgas'], ind, false);
  // Bonds
  renderCards('bond', ['us10y','us5y','us13w'], ind, false);
  // US Stocks
  renderStocks(D.usStocks || []);
}

function renderCards(id, keys, ind, large) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = keys.map(k => {
    const d = ind[k];
    if (!d) return emptyCard(k);
    return card(d, large);
  }).join('');
}

function card(d, large) {
  const dir = d.change > 0 ? 'up' : d.change < 0 ? 'dn' : 'flat';
  const arrow = d.change > 0 ? '▲ ' : d.change < 0 ? '▼ ' : '';
  const cls = large ? 'c c-lg fade ' + dir : 'c fade ' + dir;
  const dec = getDecimals(d.value);

  let spark = '';
  if (d.sparkline && d.sparkline.length > 2) {
    spark = mkSparkline(d.sparkline, dir);
  }

  return '<div class="' + cls + '">' +
    '<div class="c-hd"><span class="c-nm">' + esc(d.name) + '</span></div>' +
    '<div class="c-val">' + fmtN(d.value, dec) + '</div>' +
    '<div class="c-chg">' + arrow + fmtC(d.change, dec) +
    ' <span class="p">(' + fmtP(d.changePct) + ')</span></div>' +
    spark + '</div>';
}

function renderStocks(stocks) {
  const el = document.getElementById('stbl');
  if (!stocks.length) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3)">데이터 로딩 중...</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>종목</th><th class="r">현재가 (USD)</th><th class="r">등락률</th></tr></thead><tbody>' +
    stocks.map(s => {
      const dir = s.changePct > 0 ? 'up' : s.changePct < 0 ? 'dn' : 'flat';
      const arrow = s.changePct > 0 ? '▲ ' : s.changePct < 0 ? '▼ ' : '';
      return '<tr class="fade"><td><span class="sym">' + esc(s.symbol) + '</span><span class="knm">' + esc(s.nameKr) + '</span></td>' +
        '<td class="r prc">$' + fmtN(s.value, 2) + '</td>' +
        '<td class="r chg ' + dir + '">' + arrow + fmtP(s.changePct) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function mkSparkline(data, dir) {
  const w = 220, h = 28, pad = 2;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v,i) => {
    const x = pad + (i/(data.length-1)) * (w-pad*2);
    const y = h - pad - ((v-mn)/rng) * (h-pad*2);
    return x+','+y;
  }).join(' ');
  const color = dir==='up' ? 'var(--up)' : dir==='dn' ? 'var(--dn)' : 'var(--flat)';
  const gid = 'g'+Math.random().toString(36).slice(2,7);
  const lx = pad+(w-pad*2), area = pts+' '+lx+','+h+' '+pad+','+h;
  return '<div class="spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">' +
    '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+color+'" stop-opacity=".18"/><stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>' +
    '<polygon points="'+area+'" fill="url(#'+gid+')"/>' +
    '<polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
}

function getDecimals(v) { if (v >= 1000) return 2; if (v >= 100) return 2; if (v >= 10) return 2; return 3; }
function fmtN(n,d) { return n == null || isNaN(n) ? '--' : Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtC(n,d) { if (n==null||isNaN(n)) return '--'; return (n>0?'+':'')+Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtP(n) { if (n==null||isNaN(n)) return '--'; return (n>0?'+':'')+n.toFixed(2)+'%'; }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function emptyCard(k) { return '<div class="c"><div class="c-hd"><span class="c-nm">'+k+'</span></div><div class="c-val" style="color:var(--t3)">--</div><div class="c-chg" style="color:var(--t3)">--</div></div>'; }
</script>
</body>
</html>`;
