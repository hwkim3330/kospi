// ============================================================
// KOSPI Board — Cloudflare Worker (v3)
// index-board.space + Naver Finance + Yahoo Finance
// ============================================================

const API_BASE = 'https://index-board.space';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const NAVER_POLL = 'https://polling.finance.naver.com/api/realtime/domestic/stock';
const NAVER_FIN = 'https://finance.naver.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      const p = url.pathname;

      if (p === '/' || p === '/index.html') {
        return new Response(HTML, {
          headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' },
        });
      }

      if (p === '/api/market') {
        const [ibRes, naverRes, brentRes] = await Promise.all([
          fetch(`${API_BASE}/api/market`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }),
          // Naver polling for Korean stocks
          fetch(`${NAVER_POLL}/005930,000660,028050`, { headers: { 'User-Agent': UA, Referer: NAVER_FIN } }).catch(() => null),
          // Brent crude from Yahoo
          fetch(`${YAHOO}/BZ=F?interval=1d&range=5d`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null),
        ]);
        let data;
        try { data = await ibRes.json(); } catch { data = {}; }
        if (!data.indicators) data.indicators = [];

        // Merge Naver Korean stocks (more accurate than Yahoo for KR market)
        if (naverRes && naverRes.ok) {
          try {
            const nv = await naverRes.json();
            const nameMap = { '005930': '삼성전자', '000660': 'SK하이닉스', '028050': '삼성E&A' };
            for (const s of (nv.datas || [])) {
              const code = s.itemCode;
              const ov = s.overMarketPriceInfo || {};
              const isNxt = ov.overMarketStatus === 'OPEN' && (ov.tradingSessionType === 'AFTER_MARKET' || ov.tradingSessionType === 'NXT');
              const isOpen = s.marketStatus === 'OPEN';
              // Use NXT/after-hours price if available
              let price, chg, chgPct, sessionTag;
              if (isNxt && ov.overPrice) {
                price = Number(String(ov.overPrice).replace(/,/g, ''));
                const regClose = Number(String(s.closePriceRaw || s.closePrice).replace(/,/g, ''));
                chg = price - regClose;
                chgPct = regClose ? (chg / regClose) * 100 : 0;
                sessionTag = 'nxt';
              } else {
                price = Number(String(s.closePriceRaw || s.closePrice).replace(/,/g, ''));
                chg = Number(String(s.compareToPreviousClosePriceRaw || s.compareToPreviousClosePrice).replace(/,/g, ''));
                chgPct = Number(String(s.fluctuationsRatioRaw || s.fluctuationsRatio).replace(/,/g, ''));
                sessionTag = isOpen ? 'open' : 'closed';
              }
              data.indicators = data.indicators.filter(i => i.symbol !== code + '.KS');
              data.indicators.push({
                symbol: code + '.KS', name: nameMap[code] || s.stockName, nameKr: nameMap[code] || s.stockName,
                price, change: chg, changePercent: chgPct,
                category: 'stock', marketClosed: sessionTag === 'closed', sessionType: sessionTag,
              });
            }
          } catch (e) { /* ignore */ }
        }

        // Merge Brent crude
        if (brentRes && brentRes.ok) {
          try {
            const yf = await brentRes.json();
            const meta = yf?.chart?.result?.[0]?.meta;
            const closes = yf?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
            if (meta) {
              const price = meta.regularMarketPrice;
              const prev = meta.previousClose || meta.chartPreviousClose;
              data.indicators.push({
                symbol: 'BZ=F', name: 'Brent Crude', nameKr: '브렌트유',
                price, change: price - prev, changePercent: prev ? ((price - prev) / prev) * 100 : 0,
                sparkline: closes ? closes.filter(v => v != null) : [],
                category: 'commodity', marketClosed: true,
              });
            }
          } catch (e) { /* ignore */ }
        }

        return json(data, 15);
      }

      if (p === '/api/matrix') {
        const r = await fetch(`${API_BASE}/api/matrix`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        return new Response(await r.text(), {
          headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
        });
      }

      if (p === '/api/themes') {
        try {
          const r = await fetch(`${NAVER_FIN}/sise/sise_group.naver?type=theme`, { headers: { 'User-Agent': UA } });
          const buf = await r.arrayBuffer();
          const html = new TextDecoder('euc-kr').decode(buf);
          const themes = [];
          const re = /type=theme&no=(\d+)">(.*?)<\/a>.*?<span[^>]*>\s*([+-]?[\d.]+%)\s*<\/span>.*?<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>/gs;
          let m;
          while ((m = re.exec(html)) !== null && themes.length < 20) {
            themes.push({ no: m[1], name: m[2].trim(), change: m[3], up: +m[4], flat: +m[5], down: +m[6] });
          }
          return json({ themes }, 30);
        } catch (e) {
          return json({ themes: [], error: e.message }, 30);
        }
      }

      if (p === '/api/sectors') {
        try {
          const r = await fetch(`${NAVER_FIN}/sise/sise_group.naver?type=upjong`, { headers: { 'User-Agent': UA } });
          const buf = await r.arrayBuffer();
          const html = new TextDecoder('euc-kr').decode(buf);
          const sectors = [];
          const re = /type=upjong&no=(\d+)">(.*?)<\/a>.*?<span[^>]*>\s*([+-]?[\d.]+%)\s*<\/span>.*?<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>/gs;
          let m;
          while ((m = re.exec(html)) !== null && sectors.length < 15) {
            sectors.push({ no: m[1], name: m[2].trim(), change: m[3], up: +m[4], flat: +m[5], down: +m[6] });
          }
          return json({ sectors }, 30);
        } catch (e) {
          return json({ sectors: [], error: e.message }, 30);
        }
      }

      if (p === '/favicon.ico') return new Response(null, { status: 204 });
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
};

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
function json(data, maxAge) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': `public, max-age=${maxAge}` },
  });
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

.wrap{max-width:960px;margin:0 auto;padding:0 16px 24px}

/* Header */
.hdr{padding:10px 0;display:flex;align-items:center;justify-content:space-between}
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
.badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.03em}
.badge.open{background:var(--green-bg);color:var(--green)}
.badge.closed{background:var(--bg-muted);color:var(--text-m)}
.badge.pre,.badge.after,.badge.nxt{background:var(--amber-bg);color:var(--amber)}
.dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.open .dot{animation:blink 1.8s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}

/* Bottom Tab Bar */
.tab-bar{
  position:fixed;bottom:0;left:0;right:0;z-index:100;
  display:flex;
  background:rgba(9,9,11,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-top:1px solid var(--border);padding:0 0 var(--safe-b);
}
.tab-bar .tab{
  flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:8px 0 6px;font-size:10px;font-weight:600;color:var(--text-m);
  background:none;border:none;min-height:50px;transition:.15s;
}
.tab-bar .tab svg{width:20px;height:20px;stroke-width:1.8}
.tab-bar .tab:hover{color:var(--text-s)}
.tab-bar .tab.on{color:var(--text)}
.tab-bar .tab.on svg{color:var(--green)}

/* Section */
.sec{margin-bottom:12px}
.sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.sec-t{font-size:11px;font-weight:700;color:var(--text-s);text-transform:uppercase;letter-spacing:.02em}
.sec-sub{font-size:10px;color:var(--text-m)}
.sep{height:1px;background:var(--border);margin:2px 0 8px}

/* Grid */
.g{display:grid;gap:6px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.g5{grid-template-columns:repeat(5,1fr)}

/* Card */
.c{
  background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:10px 12px;transition:.15s;position:relative;overflow:hidden;
}
a.c{display:block;text-decoration:none;color:inherit}
.c:hover{background:var(--bg-card-h)}
.c-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.c-name{font-size:10px;font-weight:600;color:var(--text-m);display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-name .kr{font-size:9px;color:var(--text-m);opacity:.5}
.c-session{font-size:8px;padding:2px 5px;border-radius:4px;font-weight:600;flex-shrink:0}
.c-session.live{background:var(--green-bg);color:var(--green)}
.c-session.nxt{background:var(--amber-bg);color:var(--amber)}
.c-session.closed{background:var(--bg-muted);color:var(--text-m)}
.c-val{font-size:18px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.2;margin-bottom:2px}
.c-chg{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}
.c-chg .pct{opacity:.6}
.c.up .c-val,.c.up .c-chg{color:var(--up)}
.c.down .c-val,.c.down .c-chg{color:var(--down)}
.c.flat .c-val{color:var(--text)}.c.flat .c-chg{color:var(--flat)}
.c-lg .c-val{font-size:24px}
.c-lg{padding:12px 14px}

/* Sparkline */
.spark{margin-top:5px;height:22px;width:100%;opacity:.7}
.spark svg{width:100%;height:100%}

/* Fear & Greed */
.fg{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:center;gap:16px}
.fg-score{font-size:36px;font-weight:900;letter-spacing:-.04em;line-height:1}
.fg-label{font-size:11px;font-weight:700;margin-bottom:2px}
.fg-bar{height:5px;border-radius:3px;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);position:relative;flex:1}
.fg-dot{position:absolute;width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid var(--bg);top:-3px;transform:translateX(-50%);box-shadow:0 0 6px rgba(0,0,0,.4)}

/* Futures bar */
.fut{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;justify-content:space-between}
.fut-l{display:flex;align-items:center;gap:10px}
.fut-name{font-size:11px;font-weight:600;color:var(--text-s)}
.fut-val{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
.fut-chg{font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}
.fut-meta{display:flex;gap:12px;font-size:9px;color:var(--text-m);font-variant-numeric:tabular-nums}
.fut-meta span{display:flex;gap:3px}
.fut-meta .label{opacity:.6}

/* Theme / Sector rows */
.rank-list{display:flex;flex-direction:column;gap:3px}
.rank-row{
  display:flex;align-items:center;gap:8px;
  background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
  padding:9px 12px;font-size:12px;transition:.15s;
}
a.rank-row{text-decoration:none;color:inherit}
.rank-row:hover{background:var(--bg-card-h)}
.rank-num{font-size:10px;font-weight:800;color:var(--text-m);width:16px;text-align:center;flex-shrink:0}
.rank-name{flex:1;font-weight:600;color:var(--text-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank-chg{font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.rank-chg.up{color:var(--up)}.rank-chg.down{color:var(--down)}
.rank-detail{font-size:9px;color:var(--text-m);flex-shrink:0;display:flex;gap:6px}
.rank-detail .u{color:var(--up)}.rank-detail .d{color:var(--down)}

/* Matrix */
.mx-score{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;text-align:center}
.mx-num{font-size:48px;font-weight:900;letter-spacing:-.04em;line-height:1}
.mx-sig{font-size:11px;font-weight:800;margin:4px 0;text-transform:uppercase;letter-spacing:.06em}
.mx-desc{font-size:10px;color:var(--text-m);line-height:1.5;margin-top:5px}
.mx-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px}
.mx-cat{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:8px;text-align:center}
.mx-cat-name{font-size:9px;font-weight:700;color:var(--text-m);margin-bottom:2px;text-transform:uppercase;letter-spacing:.03em}
.mx-cat-score{font-size:20px;font-weight:900;letter-spacing:-.03em}
.mx-cat-chg{font-size:9px;font-weight:600;color:var(--text-m);margin-top:1px}
.mx-detail{margin-top:10px}
.mx-detail-cat{margin-bottom:10px}
.mx-detail-title{font-size:11px;font-weight:700;color:var(--text-s);margin-bottom:5px;display:flex;align-items:center;gap:6px}
.mx-items{display:flex;flex-direction:column;gap:3px}
.mx-item{display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:11px}
.mx-item-name{font-weight:600;color:var(--text-s)}
.mx-item-score{font-weight:800;font-variant-numeric:tabular-nums}
.mx-item-hl{font-size:9px;color:var(--text-m);margin-top:1px;line-height:1.4}

/* Panel */
.panel{display:none}.panel.on{display:block}

/* Skeleton */
.sk{background:linear-gradient(90deg,var(--bg-card) 25%,#222 50%,var(--bg-card) 75%);background-size:200% 100%;animation:shm 1.5s infinite;border-radius:6px}
@keyframes shm{to{background-position:-200% 0}}
.sk-h{height:24px;width:50%;margin-bottom:4px}.sk-s{height:14px;width:30%}
.sk-card{height:80px;border-radius:var(--radius)}

/* Footer */
.ft{padding:12px 0;border-top:1px solid var(--border);text-align:center;font-size:9px;color:var(--text-m);line-height:1.8;margin-top:10px}

/* Responsive */
@media(max-width:768px){
  .g3{grid-template-columns:repeat(2,1fr)}
  .g4,.g5{grid-template-columns:repeat(2,1fr)}
  .c-lg .c-val{font-size:20px}
  .mx-grid{grid-template-columns:repeat(3,1fr)}
  .fg{flex-direction:column;align-items:stretch;gap:10px}
  .fg-score{text-align:center;font-size:32px}
  .fut{flex-direction:column;align-items:stretch;gap:6px}
  .hdr h1{font-size:14px}
}
@media(max-width:480px){
  .g2,.g3,.g4,.g5{grid-template-columns:1fr}
  .mx-grid{grid-template-columns:repeat(2,1fr)}
  .wrap{padding:0 12px 20px}
  .c-val{font-size:16px}.c-lg .c-val{font-size:19px}
  .fg-score{font-size:28px}
  .mx-num{font-size:40px}
}

.fi{animation:fadein .25s ease}
@keyframes fadein{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
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
    <span class="clock" id="clock">--:--:--</span>
    <span class="clock" id="updated" style="opacity:.5">갱신: --:--</span>
    <button class="btn-r" id="rbtn" onclick="load()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    </button>
  </div>
</header>
<div class="sep"></div>

<!-- ===== TAB 1: 시장 ===== -->
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
    <div class="sec-h"><span class="sec-t">Fear & Greed</span></div>
    <div id="fgBox"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">선물</span></div>
    <div class="g g2" id="futIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">핵심</span></div>
    <div class="g g3" id="coreIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">개별 종목</span></div>
    <div class="g g3" id="stockIdx"></div>
  </section>

  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 연동</span></div>
    <div class="g g3" id="krRelIdx"></div>
  </section>

  <section class="sec" id="themeSec" style="display:none">
    <div class="sec-h"><span class="sec-t">테마 상위</span><span class="sec-sub">네이버금융</span></div>
    <div class="rank-list" id="themeList"></div>
  </section>

  <section class="sec" id="sectorSec" style="display:none">
    <div class="sec-h"><span class="sec-t">업종 상위</span><span class="sec-sub">네이버금융</span></div>
    <div class="rank-list" id="sectorList"></div>
  </section>
</div>

<!-- ===== TAB 2: 글로벌 ===== -->
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

<!-- ===== TAB 3: 전망 ===== -->
<div class="panel" id="p-forecast">
  <div id="mxBox"><div class="sk sk-card" style="height:180px;margin-bottom:10px"></div></div>
</div>

<footer class="ft">
  <p>투자 참고용 정보이며, 투자 판단에 따른 손실은 투자자 본인에게 귀속됩니다.</p>
  <p style="margin-top:3px;opacity:.5">Data: index-board.space · Naver Finance · 30초 자동갱신</p>
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    전망
  </button>
</nav>

<script>
let D=null,MX=null,TH=null,SC=null;
document.addEventListener('DOMContentLoaded',()=>{load();setInterval(load,30000);initTabs()});

function initTabs(){
  document.getElementById('tabBar').querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click',()=>{
      document.getElementById('tabBar').querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      const t=b.dataset.t;
      ['market','global','forecast'].forEach(p=>{
        const el=document.getElementById('p-'+p);
        if(el)el.classList.toggle('on',p===t);
      });
      if(t==='forecast'&&!MX)loadMatrix();
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
    renderGlobal(D);
    // Load themes & sectors (non-blocking)
    if(!TH)loadThemes();
    if(!SC)loadSectors();
  }catch(e){console.error('Load:',e)}
  finally{b.classList.remove('spin')}
}

async function loadMatrix(){
  try{
    const r=await fetch('/api/matrix');if(!r.ok)throw 0;
    MX=await r.json();renderMatrix(MX);
  }catch(e){document.getElementById('mxBox').innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">매트릭스 데이터를 불러올 수 없습니다</div>'}
}

async function loadThemes(){
  try{
    const r=await fetch('/api/themes');if(!r.ok)throw 0;
    TH=await r.json();renderThemes(TH.themes||[]);
  }catch(e){}
}

async function loadSectors(){
  try{
    const r=await fetch('/api/sectors');if(!r.ok)throw 0;
    SC=await r.json();renderSectors(SC.sectors||[]);
  }catch(e){}
}

function render(d){
  rClock(d.updatedAt);
  const inds=d.indicators||[];
  const kospi=inds.find(i=>i.symbol==='^KS11');
  if(kospi)rStatus(kospi.marketClosed,kospi.sessionType);

  rCards('krIdx',inds.filter(i=>['^KS11','^KQ11'].includes(i.symbol)),true);
  if(d.kospiFutures)rFutures(d.kospiFutures);
  if(d.fearGreed)rFearGreed(d.fearGreed);
  rCards('futIdx',inds.filter(i=>['NQ=F','ES=F'].includes(i.symbol)),false);
  rCards('coreIdx',inds.filter(i=>['KRW=X','GC=F','CL=F','^VIX','DX-Y.NYB','SPREAD'].includes(i.symbol)),false);
  rCards('stockIdx',inds.filter(i=>['005930.KS','000660.KS','028050.KS'].includes(i.symbol)),false);
  rCards('krRelIdx',inds.filter(i=>['EWY','KORU','BTC-KRW'].includes(i.symbol)),false);
}

function renderGlobal(d){
  const inds=d.indicators||[];
  const glS=['^VIX','NKD=F','^N225','000001.SS','^SOX','EEM','DX-Y.NYB'];
  const gl=inds.filter(i=>glS.includes(i.symbol));
  const glCat=inds.filter(i=>i.category==='global'&&!glS.includes(i.symbol));
  rCards('glIdx',[...gl,...glCat],false);

  const cmdS=['GC=F','SI=F','HG=F','NG=F','CL=F','BZ=F'];
  const cmd=inds.filter(i=>cmdS.includes(i.symbol));
  const cmdCat=inds.filter(i=>i.category==='commodity'&&!cmdS.includes(i.symbol));
  rCards('cmdIdx',[...cmd,...cmdCat],false);

  const rateS=['^TNX','^IRX'];
  const rates=inds.filter(i=>rateS.includes(i.symbol));
  const rateCat=inds.filter(i=>i.category==='rates'&&!rateS.includes(i.symbol));
  rCards('rateIdx',[...rates,...rateCat],false);
}

function renderThemes(themes){
  if(!themes.length)return;
  document.getElementById('themeSec').style.display='';
  const el=document.getElementById('themeList');
  el.innerHTML=themes.slice(0,10).map((t,i)=>{
    const isUp=t.change.startsWith('+');
    return '<a class="rank-row fi" href="https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no='+t.no+'" target="_blank" rel="noopener">'
      +'<span class="rank-num">'+(i+1)+'</span>'
      +'<span class="rank-name">'+esc(t.name)+'</span>'
      +'<span class="rank-detail"><span class="u">'+t.up+'</span><span class="d">'+t.down+'</span></span>'
      +'<span class="rank-chg '+(isUp?'up':'down')+'">'+esc(t.change)+'</span>'
      +'</a>';
  }).join('');
}

function renderSectors(sectors){
  if(!sectors.length)return;
  document.getElementById('sectorSec').style.display='';
  const el=document.getElementById('sectorList');
  el.innerHTML=sectors.slice(0,10).map((s,i)=>{
    const isUp=s.change.startsWith('+');
    return '<a class="rank-row fi" href="https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no='+s.no+'" target="_blank" rel="noopener">'
      +'<span class="rank-num">'+(i+1)+'</span>'
      +'<span class="rank-name">'+esc(s.name)+'</span>'
      +'<span class="rank-detail"><span class="u">'+s.up+'</span><span class="d">'+s.down+'</span></span>'
      +'<span class="rank-chg '+(isUp?'up':'down')+'">'+esc(s.change)+'</span>'
      +'</a>';
  }).join('');
}

function rStatus(closed,session){
  const b=document.getElementById('badge'),t=document.getElementById('badgeTxt');
  if(closed){b.className='badge closed';t.textContent='마감'}
  else if(session==='pre'){b.className='badge pre';t.textContent='장전'}
  else if(session==='after'){b.className='badge after';t.textContent='장후'}
  else{b.className='badge open';t.textContent='장중'}
}

function rClock(iso){
  // Update "last updated" time from API
  if(iso){
    const d=new Date(iso),k=new Date(d.getTime()+9*36e5);
    document.getElementById('updated').textContent=
      '갱신 '+[k.getUTCHours(),k.getUTCMinutes()].map(v=>String(v).padStart(2,'0')).join(':');
  }
}

// Live KST clock
function tickClock(){
  const n=new Date();
  const k=new Date(n.getTime()+9*36e5);
  document.getElementById('clock').textContent=
    [k.getUTCHours(),k.getUTCMinutes(),k.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':')+' KST';
}
setInterval(tickClock,1000);tickClock();

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
  const st=d.sessionType;
  const session=st==='nxt'?'<span class="c-session nxt">NXT</span>'
    :d.marketClosed?'<span class="c-session closed">마감</span>'
    :'<span class="c-session live">LIVE</span>';
  const link=cardLink(d.symbol);
  const tag=link?'a href="'+link+'" target="_blank" rel="noopener"':'div';
  const etag=link?'a':'div';
  return '<'+tag+' class="c '+(lg?'c-lg ':'')+dir+' fi">'
    +'<div class="c-top"><span class="c-name">'+esc(d.nameKr||d.name)+(d.name&&d.name!==(d.nameKr||d.name)?' <span class="kr">'+esc(d.name)+'</span>':'')+'</span>'+session+'</div>'
    +'<div class="c-val">'+fn(d.price,dec)+'</div>'
    +'<div class="c-chg"><span>'+arr+' '+fc(d.change,dec)+'</span><span class="pct">('+fp(d.changePercent)+')</span></div>'
    +spark+'</'+etag+'>';
}

function cardLink(sym){
  if(!sym)return'';
  // Korean stocks → Naver Finance
  const m=sym.match(/^(\\d{6})\\.KS$/);
  if(m)return'https://finance.naver.com/item/main.naver?code='+m[1];
  // Korean indices
  if(sym==='^KS11')return'https://finance.naver.com/sise/sise_index.naver?code=KOSPI';
  if(sym==='^KQ11')return'https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ';
  // BTC-KRW
  if(sym==='BTC-KRW')return'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=BTC_KRW';
  // USD/KRW
  if(sym==='KRW=X')return'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW';
  // VIX, SOX etc → Yahoo
  if(sym.startsWith('^'))return'https://finance.yahoo.com/quote/'+encodeURIComponent(sym);
  // Futures, ETFs → Yahoo
  return'https://finance.yahoo.com/quote/'+encodeURIComponent(sym);
}

function rFutures(f){
  const sec=document.getElementById('futSec'),box=document.getElementById('futBox');
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
    +'<span><span class="label">고</span>'+fn(f.high,2)+'</span>'
    +'<span><span class="label">저</span>'+fn(f.low,2)+'</span>'
    +'<span><span class="label">량</span>'+fvol(f.volume)+'</span>'
    +'<span><span class="label">베이시스</span>'+fc(f.basis,2)+'</span>'
    +'</div></div>';
}

function rFearGreed(fg){
  const sec=document.getElementById('fgSec'),box=document.getElementById('fgBox');
  if(!fg||fg.value==null){sec.style.display='none';return}
  sec.style.display='';
  const v=fg.value;
  const clr=v<=25?'var(--up)':v<=45?'var(--amber)':v<=55?'var(--text-s)':v<=75?'var(--green)':'var(--green)';
  box.innerHTML='<div class="fg fi">'
    +'<div><div class="fg-score" style="color:'+clr+'">'+v+'</div></div>'
    +'<div style="flex:1"><div class="fg-label" style="color:'+clr+'">'+esc(fg.label)+'</div>'
    +'<div class="fg-bar"><div class="fg-dot" style="left:'+v+'%"></div></div>'
    +'<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-m);margin-top:3px">'
    +'<span>Extreme Fear</span><span>Extreme Greed</span></div></div></div>';
}

function renderMatrix(d){
  const box=document.getElementById('mxBox');
  const o=d.overall;
  if(!o){box.innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">데이터 없음</div>';return}
  const clr=scoreColor(o.score);
  let h='<div class="mx-score fi">'
    +'<div class="mx-num" style="color:'+clr+'">'+o.score+'</div>'
    +'<div class="mx-sig" style="color:'+clr+'">'+esc(o.signal)+'</div>'
    +'<div class="mx-desc">'+esc(o.keyDriver)+'</div>'
    +'<div class="mx-desc" style="color:var(--up);opacity:.8;margin-top:3px">⚠ '+esc(o.keyRisk)+'</div></div>';
  h+='<div class="mx-grid">';
  (d.categories||[]).forEach(cat=>{
    const c=scoreColor(cat.score);
    h+='<div class="mx-cat fi"><div class="mx-cat-name">'+esc(cat.nameEn||cat.name)+'</div>'
      +'<div class="mx-cat-score" style="color:'+c+'">'+cat.score+'</div>'
      +'<div class="mx-cat-chg">'+(cat.change>0?'+':'')+cat.change+'</div></div>';
  });
  h+='</div><div class="mx-detail">';
  (d.categories||[]).forEach(cat=>{
    h+='<div class="mx-detail-cat"><div class="mx-detail-title">'+esc(cat.name)
      +' <span style="color:'+scoreColor(cat.score)+'">'+cat.score+'</span>'
      +'<span style="font-size:9px;color:var(--text-m);font-weight:500">'+esc(cat.summary||'')+'</span></div>'
      +'<div class="mx-items">';
    (cat.details||[]).forEach(dt=>{
      h+='<div class="mx-item"><div><span class="mx-item-name">'+esc(dt.name)+'</span>'
        +'<div class="mx-item-hl">'+esc(dt.headline||'')+'</div></div>'
        +'<div class="mx-item-score" style="color:'+scoreColor(dt.score)+'">'+dt.score+'</div></div>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  if(d.sectors&&d.sectors.length){
    h+='<div style="margin-top:10px"><div class="sec-h"><span class="sec-t">섹터별 전망</span></div>';
    d.sectors.forEach(s=>{
      const sig=s.signal==='up'?'▲':s.signal==='down'?'▼':'—';
      h+='<div class="rank-row fi" style="flex-wrap:wrap"><div style="display:flex;align-items:center;gap:8px;width:100%">'
        +'<span class="rank-name">'+esc(s.name)+'</span>'
        +'<span style="font-size:10px;color:var(--text-m)">'+sig+'</span>'
        +'<span class="rank-chg" style="color:'+scoreColor(s.score)+'">'+s.score+'</span></div>'
        +(s.catalyst?'<div style="font-size:9px;color:var(--text-m);margin-top:2px;line-height:1.4;width:100%">'+esc(s.catalyst)+'</div>':'')
        +'</div>';
    });
    h+='</div>';
  }
  if(d.risks&&d.risks.length){
    h+='<div style="margin-top:10px"><div class="sec-h"><span class="sec-t">주요 리스크</span></div>';
    d.risks.forEach(r=>{
      const title=typeof r==='string'?r:(r.title||r.text||r.description||'');
      const impact=typeof r==='object'?(r.impact||''):'';
      const lvl=typeof r==='object'?(r.level||''):'';
      const lvlBadge=lvl==='high'?'<span style="background:rgba(239,68,68,.15);color:var(--up);padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px">HIGH</span>':'';
      h+='<div style="padding:8px 12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:8px;margin-bottom:3px;font-size:10px;line-height:1.5" class="fi">'
        +'<div style="color:var(--up);font-weight:700">'+lvlBadge+'⚠ '+esc(title)+'</div>'
        +(impact?'<div style="color:var(--text-m);margin-top:2px;font-size:9px">'+esc(impact)+'</div>':'')
        +'</div>';
    });
    h+='</div>';
  }
  box.innerHTML=h;
}

function scoreColor(s){
  if(s<=15)return'#ef4444';if(s<=25)return'#f87171';if(s<=35)return'#fb923c';
  if(s<=45)return'#fbbf24';if(s<=55)return'#a1a1aa';if(s<=65)return'#a3e635';
  if(s<=75)return'#4ade80';return'#22c55e';
}

function mkSpark(data,dir){
  if(!data||data.length<2)return'';
  const w=200,h=22,pad=1;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>{
    const x=pad+(i/(data.length-1))*(w-pad*2);
    const y=h-pad-((v-mn)/rng)*(h-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  const clr=dir==='up'?'#ef4444':dir==='down'?'#3b82f6':'#71717a';
  const gid='g'+Math.random().toString(36).slice(2,6);
  const ap=pts+' '+(w-pad).toFixed(1)+','+h+' '+pad+','+h;
  return '<div class="spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+clr+'" stop-opacity=".12"/>'
    +'<stop offset="100%" stop-color="'+clr+'" stop-opacity="0"/></linearGradient></defs>'
    +'<polygon points="'+ap+'" fill="url(#'+gid+')"/>'
    +'<polyline points="'+pts+'" fill="none" stroke="'+clr+'" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'
    +'</svg></div>';
}

function fn(n,d){if(n==null||isNaN(n))return'--';return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fc(n,d){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fp(n){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+n.toFixed(2)+'%'}
function fvol(n){if(!n)return'--';if(n>=1e8)return(n/1e8).toFixed(1)+'억';if(n>=1e4)return Math.round(n/1e4)+'만';return n.toLocaleString('ko-KR')}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
</script>
</body>
</html>`;
