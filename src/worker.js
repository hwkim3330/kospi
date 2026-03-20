// ============================================================
// KOSPI Board — Cloudflare Worker (v2 — 3-tab redesign)
// Proxies index-board.space API + Yahoo Finance + renders dashboard
// ============================================================

const API_BASE = 'https://index-board.space';
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }
    try {
      const p = url.pathname;
      if (p === '/' || p === '/index.html') {
        return new Response(HTML, {
          headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' },
        });
      }
      if (p === '/api/market') {
        // Fetch index-board + Samsung E&A in parallel
        const [ibRes, seaRes] = await Promise.all([
          fetch(`${API_BASE}/api/market`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          }),
          fetch(`${YAHOO_BASE}/028050.KS?interval=1d&range=5d`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          }).catch(() => null),
        ]);
        let data;
        try { data = await ibRes.json(); } catch { data = {}; }
        // Merge Samsung E&A
        if (seaRes && seaRes.ok) {
          try {
            const yf = await seaRes.json();
            const meta = yf?.chart?.result?.[0]?.meta;
            const closes = yf?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
            if (meta && closes) {
              const price = meta.regularMarketPrice;
              const prev = meta.chartPreviousClose || meta.previousClose;
              const chg = price - prev;
              const chgPct = prev ? (chg / prev) * 100 : 0;
              const spark = closes.filter(v => v != null);
              const seaIndicator = {
                symbol: '028050.KS',
                name: 'Samsung E&A',
                nameKr: '삼성E&A',
                price, change: chg, changePercent: chgPct,
                sparkline: spark,
                category: 'stock',
                marketClosed: meta.currentTradingPeriod?.regular ? Date.now() / 1000 > meta.currentTradingPeriod.regular.end : true,
              };
              if (!data.indicators) data.indicators = [];
              data.indicators.push(seaIndicator);
            }
          } catch (e) { /* ignore parse errors */ }
        }
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=15' },
        });
      }
      if (p === '/api/matrix') {
        const r = await fetch(`${API_BASE}/api/matrix`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        });
        const data = await r.text();
        return new Response(data, {
          headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
        });
      }
      if (p === '/favicon.ico') return new Response(null, { status: 204 });
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

// ===================== HTML =====================
const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>KOSPI 선행지표 대시보드</title>
<meta name="description" content="코스피 선행지표 실시간 모니터링">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#09090b">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📊</text></svg>">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#09090b;--bg-card:#18181b;--bg-card-h:#1f1f23;--bg-muted:#27272a;
  --border:#27272a;--border-l:#3f3f46;
  --text:#fafafa;--text-s:#a1a1aa;--text-m:#71717a;
  --up:#ef4444;--up-bg:rgba(239,68,68,.08);
  --down:#3b82f6;--down-bg:rgba(59,130,246,.08);
  --flat:#71717a;
  --green:#22c55e;--green-bg:rgba(34,197,94,.1);
  --amber:#f59e0b;--amber-bg:rgba(245,158,11,.1);
  --font:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;
  --radius:12px;
  --safe-b:env(safe-area-inset-bottom,0px);
}
html{font-size:14px;-webkit-font-smoothing:antialiased}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100dvh;line-height:1.5;
  padding-bottom:calc(64px + var(--safe-b))}
a{color:inherit;text-decoration:none}
button{font-family:var(--font);cursor:pointer}

/* Layout */
.wrap{max-width:960px;margin:0 auto;padding:0 16px 24px}

/* Header — compact */
.hdr{padding:12px 0;display:flex;align-items:center;justify-content:space-between}
.hdr-l{display:flex;align-items:center;gap:8px}
.hdr h1{font-size:15px;font-weight:700;letter-spacing:-.02em}
.hdr-r{display:flex;align-items:center;gap:8px}
.clock{font-size:10px;color:var(--text-m);font-variant-numeric:tabular-nums;font-weight:500}
.btn-r{
  display:flex;align-items:center;gap:4px;
  background:none;border:1px solid var(--border);color:var(--text-s);
  border-radius:8px;padding:5px 10px;font-size:11px;font-weight:500;transition:.15s;
  min-height:44px;min-width:44px;justify-content:center;
}
.btn-r:hover{border-color:var(--border-l);color:var(--text)}
.btn-r.spin svg{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-r svg{width:14px;height:14px}

/* Badge */
.badge{
  display:inline-flex;align-items:center;gap:5px;
  font-size:10px;font-weight:700;padding:3px 10px;border-radius:100px;
  text-transform:uppercase;letter-spacing:.03em;
}
.badge.open{background:var(--green-bg);color:var(--green)}
.badge.closed{background:var(--bg-muted);color:var(--text-m)}
.badge.pre,.badge.after,.badge.nxt{background:var(--amber-bg);color:var(--amber)}
.dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.open .dot{animation:blink 1.8s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}

/* Bottom Tab Bar — fixed, mobile-app style */
.tab-bar{
  position:fixed;bottom:0;left:0;right:0;z-index:100;
  display:flex;
  background:rgba(9,9,11,.92);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-top:1px solid var(--border);
  padding:0 0 var(--safe-b);
}
.tab-bar .tab{
  flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;
  padding:10px 0 8px;
  font-size:10px;font-weight:600;color:var(--text-m);
  background:none;border:none;
  min-height:50px;
  transition:.15s;
}
.tab-bar .tab svg{width:20px;height:20px;stroke-width:1.8}
.tab-bar .tab:hover{color:var(--text-s)}
.tab-bar .tab.on{color:var(--text)}
.tab-bar .tab.on svg{color:var(--green)}

/* Section */
.sec{margin-bottom:14px}
.sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sec-t{font-size:12px;font-weight:700;color:var(--text-s)}
.sec-sub{font-size:10px;color:var(--text-m)}
.sep{height:1px;background:var(--border);margin:2px 0 10px}

/* Grid */
.g{display:grid;gap:8px}
.g1{grid-template-columns:1fr}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.g5{grid-template-columns:repeat(5,1fr)}

/* Card */
.c{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 14px;transition:.15s;position:relative;overflow:hidden;
}
.c:hover{background:var(--bg-card-h)}
.c-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}
.c-name{font-size:11px;font-weight:600;color:var(--text-m);display:flex;align-items:center;gap:4px}
.c-name .kr{font-size:10px;color:var(--text-m);opacity:.6}
.c-session{font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600}
.c-session.live{background:var(--green-bg);color:var(--green)}
.c-session.closed{background:var(--bg-muted);color:var(--text-m)}
.c-val{font-size:20px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.2;margin-bottom:3px}
.c-chg{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.c-chg .pct{opacity:.65}
.c.up .c-val,.c.up .c-chg{color:var(--up)}
.c.down .c-val,.c.down .c-chg{color:var(--down)}
.c.flat .c-val{color:var(--text)}
.c.flat .c-chg{color:var(--flat)}

/* Large card */
.c-lg .c-val{font-size:26px}
.c-lg{padding:14px 16px}

/* Sparkline */
.spark{margin-top:6px;height:24px;width:100%;opacity:.75}
.spark svg{width:100%;height:100%}

/* Fear & Greed Gauge */
.fg{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px 18px;display:flex;align-items:center;gap:18px;
}
.fg-score{font-size:38px;font-weight:900;letter-spacing:-.04em;line-height:1}
.fg-label{font-size:11px;font-weight:700;margin-bottom:2px}
.fg-bar{height:6px;border-radius:3px;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);position:relative;flex:1}
.fg-dot{position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--bg);top:-3px;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.4)}

/* KOSPI Futures */
.fut{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 16px;display:flex;align-items:center;justify-content:space-between;
}
.fut-l{display:flex;align-items:center;gap:12px}
.fut-name{font-size:11px;font-weight:600;color:var(--text-s)}
.fut-val{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
.fut-chg{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.fut-meta{display:flex;gap:14px;font-size:10px;color:var(--text-m);font-variant-numeric:tabular-nums}
.fut-meta span{display:flex;gap:3px}
.fut-meta .label{color:var(--text-m);opacity:.6}

/* Matrix panel */
.mx-score{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;text-align:center;
}
.mx-num{font-size:52px;font-weight:900;letter-spacing:-.04em;line-height:1}
.mx-sig{font-size:12px;font-weight:800;margin:6px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.mx-desc{font-size:11px;color:var(--text-m);line-height:1.5;margin-top:6px}
.mx-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}
.mx-cat{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:10px;text-align:center;
}
.mx-cat-name{font-size:10px;font-weight:700;color:var(--text-m);margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em}
.mx-cat-score{font-size:22px;font-weight:900;letter-spacing:-.03em}
.mx-cat-chg{font-size:10px;font-weight:600;color:var(--text-m);margin-top:2px}

/* Matrix detail */
.mx-detail{margin-top:12px}
.mx-detail-cat{margin-bottom:12px}
.mx-detail-title{font-size:12px;font-weight:700;color:var(--text-s);margin-bottom:6px;display:flex;align-items:center;gap:8px}
.mx-detail-title .score{font-variant-numeric:tabular-nums}
.mx-items{display:grid;gap:4px}
.mx-item{
  display:flex;align-items:center;justify-content:space-between;
  background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
  padding:10px 14px;font-size:12px;
}
.mx-item-name{font-weight:600;color:var(--text-s)}
.mx-item-score{font-weight:800;font-variant-numeric:tabular-nums}
.mx-item-hl{font-size:10px;color:var(--text-m);margin-top:2px;line-height:1.4}

/* Sectors */
.mx-sectors{margin-top:12px}
.mx-sec-row{
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
  margin-bottom:4px;font-size:12px;
}
.mx-sec-name{font-weight:600;color:var(--text-s)}
.mx-sec-score{font-weight:800;font-variant-numeric:tabular-nums}
.mx-sec-outlook{font-size:10px;color:var(--text-m)}

/* Risk warnings */
.mx-risks{margin-top:12px}
.mx-risk{
  padding:10px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);
  border-radius:8px;margin-bottom:4px;font-size:11px;color:var(--up);line-height:1.4;
}

/* Panel */
.panel{display:none}
.panel.on{display:block}

/* Skeleton */
.sk{background:linear-gradient(90deg,var(--bg-card) 25%,#222 50%,var(--bg-card) 75%);background-size:200% 100%;animation:shm 1.5s infinite;border-radius:6px}
@keyframes shm{to{background-position:-200% 0}}
.sk-h{height:28px;width:50%;margin-bottom:6px}
.sk-s{height:16px;width:30%}
.sk-card{height:100px;border-radius:var(--radius)}

/* Footer */
.ft{padding:16px 0;border-top:1px solid var(--border);text-align:center;font-size:10px;color:var(--text-m);line-height:1.8;margin-top:12px}

/* Responsive */
@media(max-width:768px){
  .g3{grid-template-columns:repeat(2,1fr)}
  .g4{grid-template-columns:repeat(2,1fr)}
  .g5{grid-template-columns:repeat(2,1fr)}
  .c-lg .c-val{font-size:22px}
  .mx-grid{grid-template-columns:repeat(3,1fr)}
  .fg{flex-direction:column;align-items:stretch;gap:10px}
  .fg-score{text-align:center;font-size:34px}
  .fut{flex-direction:column;align-items:stretch;gap:8px}
  .hdr h1{font-size:14px}
  .c{padding:10px 12px}
  .c-lg{padding:12px 14px}
  .c-val{font-size:18px}
}
@media(max-width:480px){
  .g2,.g3,.g4,.g5{grid-template-columns:1fr}
  .mx-grid{grid-template-columns:repeat(2,1fr)}
  .wrap{padding:0 12px 20px}
  .c-val{font-size:17px}
  .c-lg .c-val{font-size:20px}
  .fg-score{font-size:30px}
  .mx-num{font-size:44px}
  .mx-cat-score{font-size:20px}
}

/* Fade in */
.fi{animation:fadein .3s ease}
@keyframes fadein{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

/* Score colors */
.score-ex-bear{color:#ef4444}
.score-bear{color:#f87171}
.score-s-bear{color:#fb923c}
.score-neutral{color:#fbbf24}
.score-s-bull{color:#a3e635}
.score-bull{color:#4ade80}
.score-ex-bull{color:#22c55e}
</style>
</head>
<body>
<div class="wrap">

<header class="hdr">
  <div class="hdr-l">
    <h1>📊 선행지표</h1>
    <span class="badge closed" id="badge"><span class="dot"></span><span id="badgeTxt">--</span></span>
  </div>
  <div class="hdr-r">
    <span class="clock" id="clock">--:--:-- KST</span>
    <button class="btn-r" id="rbtn" onclick="load()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    </button>
  </div>
</header>

<div class="sep"></div>

<!-- ========== TAB 1: 시장 ========== -->
<div class="panel on" id="p-market">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 시장</span></div>
    <div class="g g2" id="krIdx">
      <div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
    </div>
  </section>

  <section class="sec" id="futSec" style="display:none">
    <div class="sec-h"><span class="sec-t">코스피200 선물</span></div>
    <div id="futBox"></div>
  </section>

  <section class="sec" id="fgSec" style="display:none">
    <div class="sec-h"><span class="sec-t">Fear & Greed Index</span></div>
    <div id="fgBox"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">선물</span></div>
    <div class="g g2" id="futIdx">
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">핵심 지표</span></div>
    <div class="g g3" id="coreIdx">
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">개별 종목</span></div>
    <div class="g g2" id="stockIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 연동</span></div>
    <div class="g g3" id="krRelIdx"></div>
  </section>
</div>

<!-- ========== TAB 2: 글로벌 ========== -->
<div class="panel" id="p-global">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">글로벌 지수</span></div>
    <div class="g g3" id="glIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">원자재</span></div>
    <div class="g g3" id="cmdIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">금리 / 채권</span></div>
    <div class="g g3" id="rateIdx"></div>
  </section>
</div>

<!-- ========== TAB 3: 전망 ========== -->
<div class="panel" id="p-forecast">
  <div id="mxBox"><div class="sk sk-card" style="height:200px;margin-bottom:12px"></div></div>
</div>

<footer class="ft">
  <p>투자 참고용 정보이며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
  <p style="margin-top:4px;opacity:.5">Data: index-board.space · 30초 자동갱신</p>
</footer>

</div>

<!-- Bottom Tab Bar -->
<nav class="tab-bar" id="tabBar">
  <button class="tab on" data-t="market">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    시장
  </button>
  <button class="tab" data-t="global">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
    글로벌
  </button>
  <button class="tab" data-t="forecast">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    전망
  </button>
</nav>

<script>
let D=null,MX=null;
document.addEventListener('DOMContentLoaded',()=>{load();setInterval(load,30000);initTabs()});

function initTabs(){
  const bar=document.getElementById('tabBar');
  bar.querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click',()=>{
      bar.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      const t=b.dataset.t;
      ['market','global','forecast'].forEach(p=>{
        const el=document.getElementById('p-'+p);
        if(el)el.classList.toggle('on',p===t);
      });
      if(t==='forecast'&&!MX)loadMatrix();
      if(t==='global'&&D)renderGlobal(D);
    });
  });
}

async function load(){
  const b=document.getElementById('rbtn');b.classList.add('spin');
  try{
    const r=await fetch('/api/market');
    if(!r.ok)throw new Error(r.status);
    D=await r.json();
    render(D);
    // Also render global if visible
    if(document.getElementById('p-global').classList.contains('on'))renderGlobal(D);
  }catch(e){console.error('Load error:',e)}
  finally{b.classList.remove('spin')}
}

async function loadMatrix(){
  try{
    const r=await fetch('/api/matrix');
    if(!r.ok)throw new Error(r.status);
    MX=await r.json();
    renderMatrix(MX);
  }catch(e){
    document.getElementById('mxBox').innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">매트릭스 데이터를 불러올 수 없습니다</div>';
  }
}

function render(d){
  rClock(d.updatedAt);
  const inds=d.indicators||[];

  // Market status
  const kospi=inds.find(i=>i.symbol==='^KS11');
  if(kospi)rStatus(kospi.marketClosed,kospi.sessionType);

  // Korean indices (KOSPI, KOSDAQ)
  const kr=inds.filter(i=>['^KS11','^KQ11'].includes(i.symbol));
  rCards('krIdx',kr,true);

  // KOSPI Futures
  if(d.kospiFutures)rFutures(d.kospiFutures);

  // Fear & Greed
  if(d.fearGreed)rFearGreed(d.fearGreed);

  // Futures (NQ, ES)
  const futs=inds.filter(i=>['NQ=F','ES=F'].includes(i.symbol));
  rCards('futIdx',futs,false);

  // Core indicators: USD/KRW, Gold, WTI, VIX, DXY
  const coreSymbols=['KRW=X','GC=F','CL=F','^VIX','DX-Y.NYB'];
  const coreOther=inds.filter(i=>coreSymbols.includes(i.symbol));
  rCards('coreIdx',coreOther,false);

  // Individual stocks: Samsung Electronics + Samsung E&A
  const stockSymbols=['005930.KS','028050.KS'];
  const stocks=inds.filter(i=>stockSymbols.includes(i.symbol));
  rCards('stockIdx',stocks,false);

  // Korean related (EWY, KORU, BTC)
  const krRel=inds.filter(i=>['EWY','KORU','BTC-KRW'].includes(i.symbol));
  rCards('krRelIdx',krRel,false);
}

function renderGlobal(d){
  const inds=d.indicators||[];

  // Global indices: VIX, Nikkei, Shanghai, SOX, MSCI EM
  const glSymbols=['^VIX','^N225','000001.SS','^SOX','EEM'];
  const gl=inds.filter(i=>glSymbols.includes(i.symbol));
  // Also pick up any 'global' category items
  const glCat=inds.filter(i=>i.category==='global'&&!glSymbols.includes(i.symbol));
  rCards('glIdx',[...gl,...glCat],false);

  // Commodities: Gold, Silver, Copper, Nat Gas, WTI
  const cmdSymbols=['GC=F','SI=F','HG=F','NG=F','CL=F'];
  const cmd=inds.filter(i=>cmdSymbols.includes(i.symbol));
  const cmdCat=inds.filter(i=>i.category==='commodity'&&!cmdSymbols.includes(i.symbol));
  rCards('cmdIdx',[...cmd,...cmdCat],false);

  // Rates: US 10Y, 2Y, spread
  const rateSymbols=['^TNX','^IRX'];
  const rates=inds.filter(i=>rateSymbols.includes(i.symbol));
  const rateCat=inds.filter(i=>i.category==='rates'&&!rateSymbols.includes(i.symbol));
  rCards('rateIdx',[...rates,...rateCat],false);
}

function rStatus(closed,session){
  const b=document.getElementById('badge');
  const t=document.getElementById('badgeTxt');
  if(closed){b.className='badge closed';t.textContent='마감'}
  else if(session==='pre'){b.className='badge pre';t.textContent='장전'}
  else if(session==='after'){b.className='badge after';t.textContent='장후'}
  else{b.className='badge open';t.textContent='장중'}
}

function rClock(iso){
  if(!iso)return;
  const d=new Date(iso);
  const k=new Date(d.getTime()+9*36e5);
  document.getElementById('clock').textContent=
    [k.getUTCHours(),k.getUTCMinutes(),k.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':')+' KST';
}

function rCards(id,items,lg){
  const el=document.getElementById(id);
  if(!el||!items.length)return;
  el.innerHTML=items.map(i=>mkCard(i,lg)).join('');
}

function mkCard(d,lg){
  const dir=d.change>0?'up':d.change<0?'down':'flat';
  const arr=d.change>0?'▲':d.change<0?'▼':'';
  const dec=d.price>=10000?0:d.price>=100?2:d.price>=1?2:4;
  const spark=d.sparkline&&d.sparkline.length>2?mkSpark(d.sparkline,dir):'';
  const session=d.marketClosed?'<span class="c-session closed">마감</span>':'<span class="c-session live">LIVE</span>';
  return '<div class="c '+(lg?'c-lg ':'')+dir+' fi">'
    +'<div class="c-top"><span class="c-name">'+esc(d.nameKr||d.name)+(d.name&&d.name!==d.nameKr?' <span class="kr">'+esc(d.name)+'</span>':'')+'</span>'+session+'</div>'
    +'<div class="c-val">'+fn(d.price,dec)+'</div>'
    +'<div class="c-chg"><span>'+arr+' '+fc(d.change,dec)+'</span><span class="pct">('+fp(d.changePercent)+')</span></div>'
    +spark+'</div>';
}

function rFutures(f){
  const sec=document.getElementById('futSec');
  const box=document.getElementById('futBox');
  if(!f||!f.price){sec.style.display='none';return}
  sec.style.display='';
  const dir=f.change>0?'up':f.change<0?'down':'flat';
  const clr=dir==='up'?'var(--up)':dir==='down'?'var(--down)':'var(--text)';
  const arr=f.change>0?'▲':f.change<0?'▼':'';
  box.innerHTML='<div class="fut fi">'
    +'<div class="fut-l"><div>'
    +'<div class="fut-name">'+esc(f.name)+(f.isNightSession?' (야간)':'')+'</div>'
    +'<div class="fut-val" style="color:'+clr+'">'+fn(f.price,2)+'</div>'
    +'<div class="fut-chg" style="color:'+clr+'">'+arr+' '+fc(f.change,2)+' ('+fp(f.changePercent)+')</div>'
    +'</div></div>'
    +'<div class="fut-meta">'
    +'<span><span class="label">고가</span>'+fn(f.high,2)+'</span>'
    +'<span><span class="label">저가</span>'+fn(f.low,2)+'</span>'
    +'<span><span class="label">거래량</span>'+fvol(f.volume)+'</span>'
    +'<span><span class="label">베이시스</span>'+fc(f.basis,2)+'</span>'
    +'</div></div>';
}

function rFearGreed(fg){
  const sec=document.getElementById('fgSec');
  const box=document.getElementById('fgBox');
  if(!fg||fg.value==null){sec.style.display='none';return}
  sec.style.display='';
  const v=fg.value;
  const clr=v<=25?'var(--up)':v<=45?'var(--amber)':v<=55?'var(--text-s)':v<=75?'var(--green)':'var(--green)';
  box.innerHTML='<div class="fg fi">'
    +'<div><div class="fg-score" style="color:'+clr+'">'+v+'</div></div>'
    +'<div style="flex:1"><div class="fg-label" style="color:'+clr+'">'+esc(fg.label)+'</div>'
    +'<div class="fg-bar"><div class="fg-dot" style="left:'+v+'%"></div></div>'
    +'<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-m);margin-top:4px">'
    +'<span>Extreme Fear</span><span>Extreme Greed</span></div></div></div>';
}

function renderMatrix(d){
  const box=document.getElementById('mxBox');
  const o=d.overall;
  if(!o){box.innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">데이터 없음</div>';return}
  const clr=scoreColor(o.score);

  let html='<div class="mx-score fi">'
    +'<div class="mx-num" style="color:'+clr+'">'+o.score+'</div>'
    +'<div class="mx-sig" style="color:'+clr+'">'+esc(o.signal)+'</div>'
    +'<div class="mx-desc">'+esc(o.keyDriver)+'</div>'
    +'<div class="mx-desc" style="color:var(--up);opacity:.8;margin-top:4px">⚠ '+esc(o.keyRisk)+'</div>'
    +'</div>';

  // Category scores (5 categories)
  html+='<div class="mx-grid">';
  (d.categories||[]).forEach(cat=>{
    const c=scoreColor(cat.score);
    const chgStr=cat.change>0?'+'+cat.change:String(cat.change);
    html+='<div class="mx-cat fi">'
      +'<div class="mx-cat-name">'+esc(cat.nameEn||cat.name)+'</div>'
      +'<div class="mx-cat-score" style="color:'+c+'">'+cat.score+'</div>'
      +'<div class="mx-cat-chg">'+chgStr+'</div></div>';
  });
  html+='</div>';

  // Detail per category
  html+='<div class="mx-detail">';
  (d.categories||[]).forEach(cat=>{
    html+='<div class="mx-detail-cat"><div class="mx-detail-title">'+esc(cat.name)
      +' <span class="score" style="color:'+scoreColor(cat.score)+'">'+cat.score+'</span>'
      +'<span style="font-size:10px;color:var(--text-m);font-weight:500">'+esc(cat.summary||'')+'</span></div>'
      +'<div class="mx-items">';
    (cat.details||[]).forEach(dt=>{
      html+='<div class="mx-item"><div><span class="mx-item-name">'+esc(dt.name)+'</span>'
        +'<div class="mx-item-hl">'+esc(dt.headline||'')+'</div></div>'
        +'<div class="mx-item-score" style="color:'+scoreColor(dt.score)+'">'+dt.score+'</div></div>';
    });
    html+='</div></div>';
  });
  html+='</div>';

  // Sectors (if available)
  if(d.sectors&&d.sectors.length){
    html+='<div class="mx-sectors"><div class="sec-h" style="margin-top:12px"><span class="sec-t">섹터별 전망</span></div>';
    d.sectors.forEach(s=>{
      html+='<div class="mx-sec-row fi">'
        +'<span class="mx-sec-name">'+esc(s.name)+'</span>'
        +'<span class="mx-sec-outlook">'+esc(s.outlook||'')+'</span>'
        +'<span class="mx-sec-score" style="color:'+scoreColor(s.score)+'">'+s.score+'</span></div>';
    });
    html+='</div>';
  }

  // Risks (if available)
  if(d.risks&&d.risks.length){
    html+='<div class="mx-risks"><div class="sec-h" style="margin-top:12px"><span class="sec-t">주요 리스크</span></div>';
    d.risks.forEach(r=>{
      html+='<div class="mx-risk fi">⚠ '+esc(r.text||r.description||r)+'</div>';
    });
    html+='</div>';
  }

  box.innerHTML=html;
}

function scoreColor(s){
  if(s<=15)return'#ef4444';if(s<=25)return'#f87171';if(s<=35)return'#fb923c';
  if(s<=45)return'#fbbf24';if(s<=55)return'#a1a1aa';if(s<=65)return'#a3e635';
  if(s<=75)return'#4ade80';return'#22c55e';
}

// === Sparkline ===
function mkSpark(data,dir){
  if(!data||data.length<2)return'';
  const w=240,h=24,pad=1;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>{
    const x=pad+(i/(data.length-1))*(w-pad*2);
    const y=h-pad-((v-mn)/rng)*(h-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  const clr=dir==='up'?'#ef4444':dir==='down'?'#3b82f6':'#71717a';
  const gid='g'+Math.random().toString(36).slice(2,6);
  const lastX=(w-pad).toFixed(1);
  const ap=pts+' '+lastX+','+h+' '+pad+','+h;
  return '<div class="spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+clr+'" stop-opacity="0.15"/>'
    +'<stop offset="100%" stop-color="'+clr+'" stop-opacity="0"/></linearGradient></defs>'
    +'<polygon points="'+ap+'" fill="url(#'+gid+')"/>'
    +'<polyline points="'+pts+'" fill="none" stroke="'+clr+'" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
    +'</svg></div>';
}

// === Formatters ===
function fn(n,d){if(n==null||isNaN(n))return'--';return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fc(n,d){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fp(n){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+n.toFixed(2)+'%'}
function fvol(n){if(!n)return'--';if(n>=1e8)return(n/1e8).toFixed(1)+'억';if(n>=1e4)return Math.round(n/1e4)+'만';return n.toLocaleString('ko-KR')}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
</script>
</body>
</html>`;
