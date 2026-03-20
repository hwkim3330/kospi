// ============================================================
// KOSPI Board — Cloudflare Worker
// Proxies index-board.space API + renders dashboard
// ============================================================

const API_BASE = 'https://index-board.space';

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
        const r = await fetch(`${API_BASE}/api/market`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        });
        const data = await r.text();
        return new Response(data, {
          headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=15' },
        });
      }
      if (p === '/api/matrix') {
        const r = await fetch(`${API_BASE}/api/matrix`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
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
}
html{font-size:14px;-webkit-font-smoothing:antialiased}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100dvh;line-height:1.5}
a{color:inherit;text-decoration:none}
button{font-family:var(--font);cursor:pointer}

/* Layout */
.wrap{max-width:960px;margin:0 auto;padding:0 16px 100px}

/* Header */
.hdr{padding:16px 0;display:flex;align-items:center;justify-content:space-between}
.hdr-l{display:flex;align-items:center;gap:10px}
.hdr h1{font-size:16px;font-weight:700;letter-spacing:-.02em}
.hdr-r{display:flex;align-items:center;gap:10px}
.clock{font-size:11px;color:var(--text-m);font-variant-numeric:tabular-nums;font-weight:500}
.btn-r{
  display:flex;align-items:center;gap:4px;
  background:none;border:1px solid var(--border);color:var(--text-s);
  border-radius:8px;padding:5px 10px;font-size:11px;font-weight:500;transition:.15s;
}
.btn-r:hover{border-color:var(--border-l);color:var(--text)}
.btn-r.spin svg{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-r svg{width:13px;height:13px}

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

/* Tabs */
.tabs{display:flex;gap:2px;margin:12px 0;background:var(--bg-card);border-radius:10px;padding:3px;border:1px solid var(--border)}
.tab{
  flex:1;padding:7px 0;text-align:center;font-size:11px;font-weight:600;
  color:var(--text-m);background:none;border:none;border-radius:8px;transition:.15s;
}
.tab:hover{color:var(--text-s)}
.tab.on{background:var(--bg-muted);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.4)}

/* Section */
.sec{margin-bottom:16px}
.sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sec-t{font-size:12px;font-weight:700;color:var(--text-s)}
.sec-sub{font-size:10px;color:var(--text-m)}
.sep{height:1px;background:var(--border);margin:4px 0 12px}

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
  padding:14px 16px;transition:.15s;position:relative;overflow:hidden;
}
.c:hover{background:var(--bg-card-h)}
.c-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
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
.c-lg{padding:16px 18px}

/* Sparkline */
.spark{margin-top:8px;height:26px;width:100%;opacity:.75}
.spark svg{width:100%;height:100%}

/* Fear & Greed Gauge */
.fg{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 20px;display:flex;align-items:center;gap:20px;
}
.fg-score{font-size:42px;font-weight:900;letter-spacing:-.04em;line-height:1}
.fg-label{font-size:12px;font-weight:700;margin-bottom:2px}
.fg-bar{height:6px;border-radius:3px;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);position:relative;flex:1}
.fg-dot{position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--bg);top:-3px;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.4)}

/* KOSPI Futures */
.fut{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px 18px;display:flex;align-items:center;justify-content:space-between;
}
.fut-l{display:flex;align-items:center;gap:12px}
.fut-name{font-size:12px;font-weight:600;color:var(--text-s)}
.fut-val{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
.fut-chg{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.fut-meta{display:flex;gap:16px;font-size:11px;color:var(--text-m);font-variant-numeric:tabular-nums}
.fut-meta span{display:flex;gap:4px}
.fut-meta .label{color:var(--text-m);opacity:.6}

/* Matrix panel */
.mx-score{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;text-align:center;
}
.mx-num{font-size:56px;font-weight:900;letter-spacing:-.04em;line-height:1}
.mx-sig{font-size:12px;font-weight:800;margin:6px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.mx-desc{font-size:12px;color:var(--text-m);line-height:1.5;margin-top:8px}
.mx-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}
.mx-cat{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px;text-align:center;
}
.mx-cat-name{font-size:10px;font-weight:700;color:var(--text-m);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.mx-cat-score{font-size:24px;font-weight:900;letter-spacing:-.03em}
.mx-cat-chg{font-size:10px;font-weight:600;color:var(--text-m);margin-top:2px}
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
.mx-item-hl{font-size:11px;color:var(--text-m);margin-top:2px;line-height:1.4}

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
.ft{padding:20px 0;border-top:1px solid var(--border);text-align:center;font-size:10px;color:var(--text-m);line-height:1.8;margin-top:16px}

/* Responsive */
@media(max-width:768px){
  .g3{grid-template-columns:repeat(2,1fr)}
  .g4{grid-template-columns:repeat(2,1fr)}
  .g5{grid-template-columns:repeat(2,1fr)}
  .c-lg .c-val{font-size:22px}
  .mx-grid{grid-template-columns:repeat(3,1fr)}
  .fg{flex-direction:column;align-items:stretch;gap:12px}
  .fg-score{text-align:center}
  .fut{flex-direction:column;align-items:stretch;gap:8px}
}
@media(max-width:480px){
  .g3,.g4,.g5{grid-template-columns:1fr}
  .mx-grid{grid-template-columns:repeat(2,1fr)}
  .wrap{padding:0 12px 80px}
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
    <h1>📊 선행지표 대시보드</h1>
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

<!-- Main Tabs -->
<div class="tabs" id="mainTabs">
  <button class="tab on" data-t="core">핵심 지표</button>
  <button class="tab" data-t="global">글로벌</button>
  <button class="tab" data-t="commodity">원자재</button>
  <button class="tab" data-t="rates">금리/채권</button>
  <button class="tab" data-t="matrix">투자 매트릭스</button>
</div>

<!-- Core Panel -->
<div class="panel on" id="p-core">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 시장</span></div>
    <div class="g g3" id="krIdx">
      <div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
    </div>
  </section>

  <!-- KOSPI Futures -->
  <section class="sec" id="futSec" style="display:none">
    <div class="sec-h"><span class="sec-t">코스피200 선물</span></div>
    <div id="futBox"></div>
  </section>

  <!-- Fear & Greed -->
  <section class="sec" id="fgSec" style="display:none">
    <div class="sec-h"><span class="sec-t">CNN Fear & Greed Index</span></div>
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
    <div class="sec-h"><span class="sec-t">주요 지표</span></div>
    <div class="g g4" id="coreIdx">
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
      <div class="c"><div class="sk sk-h"></div><div class="sk sk-s"></div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 연동</span></div>
    <div class="g g3" id="krRelIdx"></div>
  </section>
</div>

<!-- Global Panel -->
<div class="panel" id="p-global">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">글로벌 지수</span></div>
    <div class="g g3" id="glAll"></div>
  </section>
</div>

<!-- Commodity Panel -->
<div class="panel" id="p-commodity">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">원자재</span></div>
    <div class="g g3" id="cmdAll"></div>
  </section>
</div>

<!-- Rates Panel -->
<div class="panel" id="p-rates">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">금리 / 채권</span></div>
    <div class="g g3" id="rateAll"></div>
  </section>
</div>

<!-- Matrix Panel -->
<div class="panel" id="p-matrix">
  <div id="mxBox"><div class="sk sk-card" style="height:200px;margin-bottom:12px"></div></div>
</div>

<footer class="ft">
  <p>본 서비스는 투자 참고용 정보를 제공하며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
  <p style="margin-top:4px;opacity:.5">Data: index-board.space · 30초 자동갱신</p>
</footer>

</div>

<script>
let D=null;
document.addEventListener('DOMContentLoaded',()=>{load();setInterval(load,30000);initTabs()});

function initTabs(){
  document.querySelectorAll('.tabs').forEach(w=>{
    w.querySelectorAll('.tab').forEach(b=>{
      b.addEventListener('click',()=>{
        w.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        const t=b.dataset.t;
        const panels=w.id==='mainTabs'?['core','global','commodity','rates','matrix']:[];
        panels.forEach(p=>{const el=document.getElementById('p-'+p);if(el)el.classList.toggle('on',p===t)});
        if(t==='matrix'&&!document.querySelector('.mx-score'))loadMatrix();
      });
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
  }catch(e){console.error('Load error:',e)}
  finally{b.classList.remove('spin')}
}

async function loadMatrix(){
  try{
    const r=await fetch('/api/matrix');
    if(!r.ok)throw new Error(r.status);
    const d=await r.json();
    renderMatrix(d);
  }catch(e){
    document.getElementById('mxBox').innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">매트릭스 데이터를 불러올 수 없습니다</div>';
  }
}

function render(d){
  rClock(d.updatedAt);
  const inds=d.indicators||[];
  const bycat={};
  inds.forEach(i=>{if(!bycat[i.category])bycat[i.category]=[];bycat[i.category].push(i)});

  // Market status from KOSPI
  const kospi=inds.find(i=>i.symbol==='^KS11');
  if(kospi)rStatus(kospi.marketClosed,kospi.sessionType);

  // Korean indices
  const kr=inds.filter(i=>['^KS11','^KQ11'].includes(i.symbol));
  rCards('krIdx',kr,true);

  // KOSPI Futures
  if(d.kospiFutures)rFutures(d.kospiFutures);

  // Fear & Greed
  if(d.fearGreed)rFearGreed(d.fearGreed);

  // Futures
  const futs=inds.filter(i=>['NQ=F','ES=F'].includes(i.symbol));
  rCards('futIdx',futs,false);

  // Core others
  const coreOther=inds.filter(i=>i.category==='core'&&!(['^KS11','^KQ11','NQ=F','ES=F'].includes(i.symbol)));
  rCards('coreIdx',coreOther,false);

  // Korean related
  const krRel=inds.filter(i=>['EWY','KORU','005930.KS','BTC-KRW'].includes(i.symbol));
  rCards('krRelIdx',krRel,false);

  // Global
  const glob=inds.filter(i=>i.category==='global');
  rCards('glAll',glob,false);

  // Commodity
  const cmd=inds.filter(i=>i.category==='commodity');
  rCards('cmdAll',cmd,false);

  // Rates
  const rates=inds.filter(i=>i.category==='rates');
  rCards('rateAll',rates,false);
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
    +'<div class="c-top"><span class="c-name">'+d.nameKr+(d.name&&d.name!==d.nameKr?' <span class="kr">'+d.name+'</span>':'')+'</span>'+session+'</div>'
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
  const spark=f.sparkline&&f.sparkline.length>2?mkSpark(f.sparkline,dir):'';
  box.innerHTML='<div class="fut fi">'
    +'<div class="fut-l"><div>'
    +'<div class="fut-name">'+f.name+(f.isNightSession?' (야간)':'')+'</div>'
    +'<div class="fut-val" style="color:'+clr+'">'+fn(f.price,2)+'</div>'
    +'<div class="fut-chg" style="color:'+clr+'">'+arr+' '+fc(f.change,2)+' ('+fp(f.changePercent)+')</div>'
    +'</div></div>'
    +'<div class="fut-meta">'
    +'<span><span class="label">고가</span>'+fn(f.high,2)+'</span>'
    +'<span><span class="label">저가</span>'+fn(f.low,2)+'</span>'
    +'<span><span class="label">거래량</span>'+fvol(f.volume)+'</span>'
    +'<span><span class="label">베이시스</span>'+fc(f.basis,2)+'</span>'
    +'</div></div>'+spark;
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
    +'<div style="flex:1"><div class="fg-label" style="color:'+clr+'">'+fg.label+'</div>'
    +'<div class="fg-bar"><div class="fg-dot" style="left:'+v+'%"></div></div>'
    +'<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-m);margin-top:4px">'
    +'<span>Extreme Fear</span><span>Extreme Greed</span></div></div></div>';
}

function renderMatrix(d){
  const box=document.getElementById('mxBox');
  const o=d.overall;
  const clr=scoreColor(o.score);

  let html='<div class="mx-score fi">'
    +'<div class="mx-num" style="color:'+clr+'">'+o.score+'</div>'
    +'<div class="mx-sig" style="color:'+clr+'">'+o.signal+'</div>'
    +'<div class="mx-desc">'+esc(o.keyDriver)+'</div>'
    +'<div class="mx-desc" style="color:var(--up);opacity:.8;margin-top:4px">⚠ '+esc(o.keyRisk)+'</div>'
    +'</div>';

  html+='<div class="mx-grid">';
  (d.categories||[]).forEach(cat=>{
    const c=scoreColor(cat.score);
    const chgStr=cat.change>0?'+'+cat.change:cat.change;
    html+='<div class="mx-cat fi">'
      +'<div class="mx-cat-name">'+esc(cat.nameEn||cat.name)+'</div>'
      +'<div class="mx-cat-score" style="color:'+c+'">'+cat.score+'</div>'
      +'<div class="mx-cat-chg">'+chgStr+'</div></div>';
  });
  html+='</div>';

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
  const w=240,h=26,pad=1;
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
function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
</script>
</body>
</html>`;
