// ============================================================
// KOSPI Board — Cloudflare Worker (v6)
// index-board.space 최대 활용 + Naver + Polymarket + Upbit
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

      // ===== 시장 데이터 =====
      if (p === '/api/market') {
        const [ibRes, naverRes, brentRes] = await Promise.all([
          fetch(`${API_BASE}/api/market`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }),
          fetch(`${NAVER_POLL}/005930,000660,028050`, { headers: { 'User-Agent': UA, Referer: NAVER_FIN } }).catch(() => null),
          fetch(`${YAHOO}/BZ=F?interval=1d&range=5d`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null),
        ]);
        let data;
        try { data = await ibRes.json(); } catch { data = {}; }
        if (!data.indicators) data.indicators = [];

        if (naverRes && naverRes.ok) {
          try {
            const nv = await naverRes.json();
            const nameMap = { '005930': '삼성전자', '000660': 'SK하이닉스', '028050': '삼성E&A' };
            for (const s of (nv.datas || [])) {
              const code = s.itemCode;
              const ov = s.overMarketPriceInfo || {};
              const isNxt = ov.overMarketStatus === 'OPEN' && (ov.tradingSessionType === 'AFTER_MARKET' || ov.tradingSessionType === 'NXT');
              const isOpen = s.marketStatus === 'OPEN';
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

      // ===== index-board.space 프록시 =====
      if (p === '/api/matrix') {
        return proxy(`${API_BASE}/api/matrix`, 60);
      }
      if (p === '/api/briefing') {
        return proxy(`${API_BASE}/api/briefing`, 30);
      }
      if (p === '/api/news') {
        const market = url.searchParams.get('market') || 'kospi';
        return proxy(`${API_BASE}/api/news?market=${market}`, 60);
      }
      if (p === '/api/investor') {
        return proxy(`${API_BASE}/api/investor`, 15);
      }
      if (p === '/api/program') {
        return proxy(`${API_BASE}/api/program`, 15);
      }
      if (p === '/api/weekly') {
        return proxy(`${API_BASE}/api/weekly-briefing`, 60);
      }
      if (p === '/api/quiz') {
        return proxy(`${API_BASE}/api/quiz`, 60);
      }
      if (p === '/api/nasdaq') {
        return proxy(`${API_BASE}/api/nasdaq`, 15);
      }
      if (p === '/api/nq-briefing') {
        return proxy(`${API_BASE}/api/briefing/nasdaq`, 30);
      }

      // ===== 네이버 테마/업종 =====
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

      // ===== 지정학 (Polymarket) =====
      if (p === '/api/geopolitics') {
        try {
          const r = await fetch('https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false', {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
          });
          if (!r.ok) throw new Error('Polymarket ' + r.status);
          const raw = await r.json();
          const keywords = /iran|china|taiwan|korea|war|nuclear|nato|russia|recession|tariff|oil|israel|military|ceasefire|trump|missile|sanction|invasion/i;
          const events = [];
          for (const ev of (raw || [])) {
            const title = ev.title || '';
            const desc = ev.description || '';
            if (!keywords.test(title) && !keywords.test(desc)) continue;
            const market = (ev.markets || [])[0] || {};
            const prices = market.outcomePrices ? JSON.parse(market.outcomePrices) : [];
            const yesPrice = prices[0] ? parseFloat(prices[0]) : null;
            const volume = parseFloat(market.volume || ev.volume || 0);
            const impact = classifyImpact(title + ' ' + desc);
            events.push({ title, question: market.question || title, yesPrice, volume, slug: ev.slug || '', impact });
          }
          const lvlOrder = { HIGH: 0, MED: 1, LOW: 2 };
          events.sort((a, b) => (lvlOrder[a.impact.level] || 2) - (lvlOrder[b.impact.level] || 2) || b.volume - a.volume);
          return json({ events }, 60);
        } catch (e) {
          return json({ events: [], error: e.message }, 60);
        }
      }

      // ===== 원화 스테이블코인 =====
      if (p === '/api/stable') {
        try {
          const [upbitRes, binBtcRes, binEthRes, ibRes] = await Promise.all([
            fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-USDT,KRW-USDC', {
              headers: { Accept: 'application/json' },
            }).catch(() => null),
            fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {
              headers: { Accept: 'application/json' },
            }).catch(() => null),
            fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', {
              headers: { Accept: 'application/json' },
            }).catch(() => null),
            fetch(`${API_BASE}/api/market`, {
              headers: { 'User-Agent': UA, Accept: 'application/json' },
            }).catch(() => null),
          ]);

          let upbit = {};
          if (upbitRes && upbitRes.ok) {
            const arr = await upbitRes.json();
            for (const t of arr) {
              upbit[t.market] = {
                price: t.trade_price,
                change: t.signed_change_rate || 0,
                changePct: (t.signed_change_rate || 0) * 100,
                volume24h: t.acc_trade_price_24h || 0,
                high: t.high_price, low: t.low_price,
                prevClose: t.prev_closing_price || t.trade_price,
              };
            }
          }

          let binBtc = {}, binEth = {};
          if (binBtcRes && binBtcRes.ok) {
            const d = await binBtcRes.json();
            binBtc = { price: parseFloat(d.lastPrice), changePct: parseFloat(d.priceChangePercent), volume: parseFloat(d.quoteVolume) };
          }
          if (binEthRes && binEthRes.ok) {
            const d = await binEthRes.json();
            binEth = { price: parseFloat(d.lastPrice), changePct: parseFloat(d.priceChangePercent), volume: parseFloat(d.quoteVolume) };
          }

          // 공식 환율 + 선물 + KOSPI
          let officialFx = 1450, nqChange = 0, esChange = 0, fridayClose = 2650;
          if (ibRes && ibRes.ok) {
            const ibData = await ibRes.json();
            const inds = ibData.indicators || [];
            const fx = inds.find(i => i.symbol === 'KRW=X');
            const nq = inds.find(i => i.symbol === 'NQ=F');
            const es = inds.find(i => i.symbol === 'ES=F');
            const ks = inds.find(i => i.symbol === '^KS11');
            if (fx && fx.price) officialFx = fx.price;
            if (nq && nq.changePercent) nqChange = nq.changePercent / 100;
            if (es && es.changePercent) esChange = es.changePercent / 100;
            if (ks && ks.price) fridayClose = ks.price;
          }

          const usdtKrw = upbit['KRW-USDT']?.price || null;
          const usdcKrw = upbit['KRW-USDC']?.price || null;
          const btcKrw = upbit['KRW-BTC']?.price || null;
          const ethKrw = upbit['KRW-ETH']?.price || null;
          const btcUsd = binBtc.price || null;
          const ethUsd = binEth.price || null;

          // 프리미엄 계산
          const usdtPremium = usdtKrw ? ((usdtKrw / officialFx) - 1) * 100 : null;
          const usdcPremium = usdcKrw ? ((usdcKrw / officialFx) - 1) * 100 : null;
          const kimchiPremium = (btcKrw && btcUsd && officialFx) ? ((btcKrw / (btcUsd * officialFx)) - 1) * 100 : null;
          const ethKimchi = (ethKrw && ethUsd && officialFx) ? ((ethKrw / (ethUsd * officialFx)) - 1) * 100 : null;

          // 합성 KOSPI
          const btcChg = upbit['KRW-BTC']?.change || 0;
          const ethChg = upbit['KRW-ETH']?.change || 0;
          const synthetic = fridayClose * (1 + btcChg * 0.3) * (1 + ethChg * 0.1) * (1 + nqChange * 0.4) * (1 + esChange * 0.2);

          return json({
            stablecoin: {
              usdt: { price: usdtKrw, premium: rd2(usdtPremium), volume: upbit['KRW-USDT']?.volume24h },
              usdc: { price: usdcKrw, premium: rd2(usdcPremium), volume: upbit['KRW-USDC']?.volume24h },
            },
            premium: {
              kimchi: rd2(kimchiPremium),
              ethKimchi: rd2(ethKimchi),
              usdtPremium: rd2(usdtPremium),
            },
            crypto: [
              { symbol: 'BTC/KRW', price: btcKrw, changePct: rd2(upbit['KRW-BTC']?.changePct), volume: upbit['KRW-BTC']?.volume24h, high: upbit['KRW-BTC']?.high, low: upbit['KRW-BTC']?.low },
              { symbol: 'ETH/KRW', price: ethKrw, changePct: rd2(upbit['KRW-ETH']?.changePct), volume: upbit['KRW-ETH']?.volume24h, high: upbit['KRW-ETH']?.high, low: upbit['KRW-ETH']?.low },
              { symbol: 'BTC/USD', price: btcUsd, changePct: rd2(binBtc.changePct), volume: binBtc.volume },
              { symbol: 'ETH/USD', price: ethUsd, changePct: rd2(binEth.changePct), volume: binEth.volume },
            ],
            officialFx: rd2(officialFx),
            synthetic: { price: rd2(synthetic), change: rd2(synthetic - fridayClose), changePct: rd2(fridayClose ? ((synthetic - fridayClose) / fridayClose) * 100 : 0), fridayClose },
            components: { btc: rd2(btcChg * 100), eth: rd2(ethChg * 100), nq: rd2(nqChange * 100), es: rd2(esChange * 100) },
          }, 10);
        } catch (e) {
          return json({ error: e.message }, 10);
        }
      }

      if (p === '/favicon.ico') return new Response(null, { status: 204 });
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
};

function rd2(v) { return v != null ? Math.round(v * 100) / 100 : null; }

function classifyImpact(text) {
  const t = text.toLowerCase();
  if (/war|invasion|military.strike|nuclear.attack/.test(t)) return { direction: 'down', level: 'HIGH' };
  if (/ceasefire|peace.deal|peace.agreement/.test(t)) return { direction: 'up', level: 'MED' };
  if (/tariff|recession|fed.rate/.test(t)) return { direction: 'down', level: 'MED' };
  if (/trump|election/.test(t)) return { direction: 'volatile', level: 'MED' };
  if (/sanction|missile|strike/.test(t)) return { direction: 'down', level: 'MED' };
  if (/china|taiwan|korea|israel|russia|nato|iran|oil/.test(t)) return { direction: 'volatile', level: 'LOW' };
  return { direction: 'volatile', level: 'LOW' };
}

async function proxy(url, maxAge) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    return new Response(await r.text(), {
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': `public, max-age=${maxAge}` },
    });
  } catch (e) {
    return json({ error: e.message }, maxAge);
  }
}

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
<meta name="mobile-web-app-capable" content="yes">
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
  --purple:#a855f7;--purple-bg:rgba(168,85,247,.1);
  --font:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;
  --radius:12px;--safe-b:env(safe-area-inset-bottom,0px);
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
.btn-r{display:flex;align-items:center;gap:4px;background:none;border:1px solid var(--border);color:var(--text-s);
  border-radius:8px;padding:5px 10px;font-size:11px;font-weight:500;transition:.15s;min-height:44px;min-width:44px;justify-content:center}
.btn-r:hover{border-color:var(--border-l);color:var(--text)}
.btn-r.spin svg{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-r svg{width:14px;height:14px}

.badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.03em}
.badge.open{background:var(--green-bg);color:var(--green)}
.badge.closed{background:var(--bg-muted);color:var(--text-m)}
.badge.pre,.badge.after,.badge.nxt{background:var(--amber-bg);color:var(--amber)}
.dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.open .dot{animation:blink 1.8s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}

/* Tab Bar */
.tab-bar{position:fixed;bottom:0;left:0;right:0;z-index:100;display:flex;
  background:rgba(9,9,11,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-top:1px solid var(--border);padding:0 0 var(--safe-b)}
.tab-bar .tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:8px 0 6px;font-size:10px;font-weight:600;color:var(--text-m);
  background:none;border:none;min-height:50px;transition:.15s}
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

.g{display:grid;gap:6px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}

/* Card */
.c{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:10px 12px;transition:.15s;position:relative;overflow:hidden}
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

/* Rank rows */
.rank-list{display:flex;flex-direction:column;gap:3px}
.rank-row{display:flex;align-items:center;gap:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
  padding:9px 12px;font-size:12px;transition:.15s}
a.rank-row{text-decoration:none;color:inherit}
.rank-row:hover{background:var(--bg-card-h)}
.rank-num{font-size:10px;font-weight:800;color:var(--text-m);width:16px;text-align:center;flex-shrink:0}
.rank-name{flex:1;font-weight:600;color:var(--text-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank-chg{font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.rank-chg.up{color:var(--up)}.rank-chg.down{color:var(--down)}
.rank-detail{font-size:9px;color:var(--text-m);flex-shrink:0;display:flex;gap:6px}
.rank-detail .u{color:var(--up)}.rank-detail .d{color:var(--down)}

/* Briefing */
.brief{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.brief-text{font-size:12px;line-height:1.7;color:var(--text-s);word-break:keep-all}
.brief-meta{font-size:9px;color:var(--text-m);margin-top:6px}

/* Investor */
.inv-row{display:flex;align-items:center;gap:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 14px}
.inv-name{font-size:11px;font-weight:700;color:var(--text-s);min-width:50px}
.inv-bar{flex:1;height:18px;border-radius:4px;background:var(--bg-muted);position:relative;overflow:hidden}
.inv-fill{height:100%;border-radius:4px;position:absolute;top:0}
.inv-val{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;min-width:65px;text-align:right}

/* News */
.news-item{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;transition:.15s}
.news-item:hover{background:var(--bg-card-h)}

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

/* Geo */
.geo-summary{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;display:flex;align-items:center;gap:16px;margin-bottom:10px}
.geo-score-box{text-align:center;min-width:80px}
.geo-score-num{font-size:36px;font-weight:900;letter-spacing:-.04em;line-height:1}
.geo-score-label{font-size:9px;font-weight:700;color:var(--text-m);margin-top:4px;text-transform:uppercase}
.geo-impact-summary{flex:1;display:flex;gap:16px;justify-content:center}
.geo-impact-item{text-align:center}
.geo-impact-count{font-size:22px;font-weight:800}
.geo-impact-label{font-size:9px;color:var(--text-m);font-weight:600}
.geo-evt{display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
  padding:10px 12px;font-size:12px;transition:.15s}
a.geo-evt{text-decoration:none;color:inherit}
.geo-evt:hover{background:var(--bg-card-h)}
.geo-evt-title{flex:1;font-weight:600;color:var(--text-s);line-height:1.4}
.geo-evt-prob{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;min-width:50px;text-align:right}
.geo-evt-vol{font-size:9px;color:var(--text-m);min-width:60px;text-align:right}
.geo-badge{font-size:8px;font-weight:800;padding:2px 6px;border-radius:4px;flex-shrink:0;text-transform:uppercase;letter-spacing:.03em}
.geo-badge.down-high{background:rgba(239,68,68,.15);color:var(--up)}
.geo-badge.down-med{background:rgba(239,68,68,.1);color:#f87171}
.geo-badge.up-med{background:var(--green-bg);color:var(--green)}
.geo-badge.volatile-med,.geo-badge.volatile-low{background:var(--amber-bg);color:var(--amber)}
.geo-badge.down-low{background:var(--bg-muted);color:var(--text-m)}

/* Stable / Premium */
.prem-hero{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;text-align:center;margin-bottom:8px}
.prem-label{font-size:10px;font-weight:700;color:var(--text-m);margin-bottom:4px;text-transform:uppercase}
.prem-val{font-size:42px;font-weight:900;letter-spacing:-.04em;line-height:1}
.prem-sub{font-size:11px;color:var(--text-m);margin-top:6px}
.prem-row{display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.prem-row-name{font-size:11px;font-weight:700;color:var(--text-s);min-width:70px}
.prem-row-price{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;flex:1}
.prem-row-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px}
.synth-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;text-align:center}
.synth-label{font-size:10px;font-weight:700;color:var(--text-m);margin-bottom:4px}
.synth-price{font-size:28px;font-weight:900;letter-spacing:-.04em;line-height:1}
.synth-chg{font-size:12px;font-weight:700;margin-top:4px}
.synth-friday{font-size:10px;color:var(--text-m);margin-top:3px}
.synth-comp{display:flex;gap:8px;justify-content:center;margin-top:8px;font-size:9px;color:var(--text-m)}
.synth-comp span{display:flex;align-items:center;gap:3px}
.synth-dot{width:6px;height:6px;border-radius:50%;display:inline-block}

/* Trading */
.trade-box{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.trade-bal{font-size:11px;color:var(--text-m);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.trade-bal b{color:var(--text);font-size:14px;font-weight:800}
.trade-section{margin-bottom:12px}
.trade-section-h{font-size:10px;font-weight:700;color:var(--text-m);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between}
.trade-section-h .price{color:var(--text);font-size:12px;font-weight:800}
.trade-btns{display:flex;gap:6px}
.trade-btn{flex:1;padding:10px;border:none;border-radius:8px;font-size:12px;font-weight:700;color:#fff;min-height:44px;transition:.15s}
.trade-btn.buy{background:#ef4444}.trade-btn.buy:hover{background:#dc2626}
.trade-btn.sell{background:#3b82f6}.trade-btn.sell:hover{background:#2563eb}
.trade-btn:disabled{opacity:.3;cursor:not-allowed}
.trade-pos-item{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg-muted);border-radius:6px;margin-bottom:4px;font-size:11px}
.trade-pos-info{display:flex;flex-direction:column;gap:2px}
.trade-pos-type{font-weight:700;font-size:10px;text-transform:uppercase}
.trade-pos-entry{font-size:9px;color:var(--text-m)}
.trade-pos-pnl{font-weight:800;font-size:13px;font-variant-numeric:tabular-nums}
.trade-close{background:none;border:1px solid var(--border);color:var(--text-s);border-radius:4px;padding:3px 8px;font-size:9px;font-weight:600;cursor:pointer;min-height:28px}
.trade-close:hover{border-color:var(--border-l);color:var(--text)}
.trade-hist{margin-top:8px;max-height:120px;overflow-y:auto}
.trade-hist-item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:9px;color:var(--text-m)}
.trade-reset{background:none;border:1px solid var(--border);color:var(--text-m);border-radius:4px;padding:2px 8px;font-size:8px;cursor:pointer;min-height:24px}
.trade-reset:hover{border-color:var(--border-l);color:var(--text)}

/* Mag7 / Sector */
.mag7-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;transition:.15s}
a.mag7-card{display:block;text-decoration:none;color:inherit}
.mag7-card:hover{background:var(--bg-card-h)}
.mag7-sym{font-size:9px;font-weight:800;color:var(--text-m);letter-spacing:.02em;display:flex;align-items:center;gap:4px}
.mag7-sym .sub{font-weight:500;opacity:.5}
.mag7-price{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.3;margin:2px 0}
.mag7-chg{font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}
.mag7-card.up .mag7-price,.mag7-card.up .mag7-chg{color:var(--up)}
.mag7-card.down .mag7-price,.mag7-card.down .mag7-chg{color:var(--down)}
.mag7-card.flat .mag7-price{color:var(--text)}

/* Panel */
.panel{display:none}.panel.on{display:block}

/* Skeleton */
.sk{background:linear-gradient(90deg,var(--bg-card) 25%,#222 50%,var(--bg-card) 75%);background-size:200% 100%;animation:shm 1.5s infinite;border-radius:6px}
@keyframes shm{to{background-position:-200% 0}}
.sk-h{height:24px;width:50%;margin-bottom:4px}.sk-s{height:14px;width:30%}
.sk-card{height:80px;border-radius:var(--radius)}

.ft{padding:12px 0;border-top:1px solid var(--border);text-align:center;font-size:9px;color:var(--text-m);line-height:1.8;margin-top:10px}

@media(max-width:768px){
  .g3{grid-template-columns:repeat(2,1fr)}
  .g4{grid-template-columns:repeat(2,1fr)}
  .c-lg .c-val{font-size:20px}
  .mx-grid{grid-template-columns:repeat(3,1fr)}
  .fg{flex-direction:column;align-items:stretch;gap:10px}
  .fg-score{text-align:center;font-size:32px}
  .fut{flex-direction:column;align-items:stretch;gap:6px}
  .geo-summary{flex-direction:column;gap:10px}
  .prem-val{font-size:32px}
}
@media(max-width:480px){
  .g2,.g3,.g4{grid-template-columns:1fr}
  .mx-grid{grid-template-columns:repeat(2,1fr)}
  .wrap{padding:0 12px 20px}
  .c-val{font-size:16px}.c-lg .c-val{font-size:19px}
  .fg-score{font-size:28px}
  .mx-num{font-size:40px}
  .prem-val{font-size:28px}
  .geo-impact-summary{flex-direction:column;gap:8px}
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

<!-- TAB 1: 시장 -->
<div class="panel on" id="p-market">
  <section class="sec" id="briefSec" style="display:none">
    <div class="sec-h"><span class="sec-t">AI 브리핑</span><span class="sec-sub" id="briefType"></span></div>
    <div id="briefBox"></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">한국 시장</span></div>
    <div class="g g2" id="krIdx"><div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div><div class="c c-lg"><div class="sk sk-h"></div><div class="sk sk-s"></div></div></div>
  </section>
  <section class="sec" id="futSec" style="display:none">
    <div class="sec-h"><span class="sec-t">코스피200 선물</span></div>
    <div id="futBox"></div>
  </section>
  <section class="sec" id="fgSec" style="display:none">
    <div class="sec-h"><span class="sec-t">Fear & Greed</span></div>
    <div id="fgBox"></div>
  </section>
  <section class="sec" id="invSec" style="display:none">
    <div class="sec-h"><span class="sec-t">투자자별 매매</span><span class="sec-sub" id="invDate"></span></div>
    <div class="rank-list" id="invBox"></div>
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
  <section class="sec" id="newsSec" style="display:none">
    <div class="sec-h"><span class="sec-t">시장 뉴스</span></div>
    <div class="rank-list" id="newsBox"></div>
  </section>
  <section class="sec" id="themeSec" style="display:none">
    <div class="sec-h"><span class="sec-t">테마 상위</span><span class="sec-sub">네이버금융</span></div>
    <div class="rank-list" id="themeList"></div>
  </section>
  <section class="sec" id="sectorSec" style="display:none">
    <div class="sec-h"><span class="sec-t">업종 상위</span><span class="sec-sub">네이버금융</span></div>
    <div class="rank-list" id="sectorList"></div>
  </section>
  <section class="sec" id="weeklySec" style="display:none">
    <div class="sec-h"><span class="sec-t">주간 리뷰</span></div>
    <div id="weeklyBox"></div>
  </section>
</div>

<!-- TAB 2: 글로벌 -->
<div class="panel" id="p-global">
  <section class="sec" id="nqBriefSec" style="display:none">
    <div class="sec-h"><span class="sec-t">NASDAQ AI 브리핑</span></div>
    <div id="nqBriefBox"></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">Magnificent 7</span><span class="sec-sub">나스닥</span></div>
    <div class="g g4" id="mag7Box"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">US 섹터 ETF</span></div>
    <div class="g g3" id="sectorEtfBox"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
  </section>
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

<!-- TAB 3: 지정학 -->
<div class="panel" id="p-geo">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">지정학 리스크</span><span class="sec-sub">Polymarket</span></div>
    <div id="geoSummary"><div class="sk sk-card" style="height:80px"></div></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">예측시장 이벤트</span></div>
    <div class="rank-list" id="geoEvents"><div class="sk sk-card" style="height:200px"></div></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">종합 전망 (Matrix)</span></div>
    <div id="mxBox"><div class="sk sk-card" style="height:140px"></div></div>
  </section>
</div>

<!-- TAB 4: 원화스테이블 -->
<div class="panel" id="p-stable">
  <section class="sec">
    <div class="sec-h"><span class="sec-t">김치 프리미엄</span><span class="sec-sub">BTC 기준</span></div>
    <div id="premHero"><div class="sk sk-card" style="height:100px"></div></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">스테이블코인 원화 시세</span><span class="sec-sub">Upbit</span></div>
    <div class="rank-list" id="stableBox"></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">크립토</span></div>
    <div class="g g2" id="cryptoBox"></div>
  </section>
  <section class="sec">
    <div class="sec-h"><span class="sec-t">합성 KOSPI 주말 지수</span><span class="sec-sub">BTC+NQ+ES+ETH</span></div>
    <div id="synthBox"></div>
  </section>
  <section class="sec" style="margin-top:4px">
    <div class="sec-h"><span class="sec-t">가상 트레이딩</span><span class="sec-sub">USDT + KOSPI 선물</span></div>
    <div id="tradeBox"></div>
  </section>
</div>

<footer class="ft">
  <p>투자 참고용 · 손실은 투자자 본인에게 귀속</p>
  <p style="margin-top:3px;opacity:.5">index-board.space · Naver · Polymarket · Upbit · Binance · 30초 갱신</p>
</footer>
</div>

<nav class="tab-bar" id="tabBar">
  <button class="tab on" data-t="market">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    시장
  </button>
  <button class="tab" data-t="global">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
    글로벌
  </button>
  <button class="tab" data-t="geo">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    지정학
  </button>
  <button class="tab" data-t="stable">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
    원화스테이블
  </button>
</nav>

<script>
let D=null,MX=null,TH=null,SC=null,GEO=null,STB=null,NQ=null,NQB=null;
const TABS=['market','global','geo','stable'];
let stableTimer=null;

document.addEventListener('DOMContentLoaded',()=>{load();setInterval(load,30000);initTabs()});

function initTabs(){
  document.getElementById('tabBar').querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click',()=>{
      document.getElementById('tabBar').querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      const t=b.dataset.t;
      TABS.forEach(p=>{const el=document.getElementById('p-'+p);if(el)el.classList.toggle('on',p===t)});
      if(t==='global'){if(!NQ)loadNasdaq();if(!NQB)loadNqBriefing()}
      if(t==='geo'){if(!GEO)loadGeo();if(!MX)loadMatrix()}
      if(t==='stable'){loadStable();startStableTimer();renderTrade()}else{stopStableTimer()}
    });
  });
}
function startStableTimer(){stopStableTimer();stableTimer=setInterval(loadStable,10000)}
function stopStableTimer(){if(stableTimer){clearInterval(stableTimer);stableTimer=null}}

async function load(){
  const b=document.getElementById('rbtn');b.classList.add('spin');
  try{
    const r=await fetch('/api/market');if(!r.ok)throw new Error(r.status);
    D=await r.json();render(D);renderGlobal(D);
    if(!TH)loadThemes();if(!SC)loadSectors();
    loadBriefing();loadInvestor();loadNews();loadWeekly();
  }catch(e){console.error(e)}
  finally{b.classList.remove('spin')}
}

async function loadBriefing(){
  try{const r=await fetch('/api/briefing');if(!r.ok)return;const d=await r.json();renderBriefing(d)}catch(e){}
}
async function loadInvestor(){
  try{const r=await fetch('/api/investor');if(!r.ok)return;const d=await r.json();renderInvestor(d)}catch(e){}
}
async function loadNews(){
  try{const r=await fetch('/api/news?market=kospi');if(!r.ok)return;const d=await r.json();renderNews(d)}catch(e){}
}
async function loadWeekly(){
  try{const r=await fetch('/api/weekly');if(!r.ok)return;const d=await r.json();renderWeekly(d)}catch(e){}
}
async function loadMatrix(){
  try{const r=await fetch('/api/matrix');if(!r.ok)throw 0;MX=await r.json();renderMatrix(MX)}
  catch(e){document.getElementById('mxBox').innerHTML='<div style="text-align:center;color:var(--text-m);padding:40px">매트릭스 로딩 실패</div>'}
}
async function loadThemes(){
  try{const r=await fetch('/api/themes');if(!r.ok)throw 0;TH=await r.json();renderThemes(TH.themes||[])}catch(e){}
}
async function loadSectors(){
  try{const r=await fetch('/api/sectors');if(!r.ok)throw 0;SC=await r.json();renderSectors(SC.sectors||[])}catch(e){}
}
async function loadGeo(){
  try{const r=await fetch('/api/geopolitics');if(!r.ok)throw 0;GEO=await r.json();renderGeo(GEO)}
  catch(e){document.getElementById('geoSummary').innerHTML='<div style="color:var(--text-m);padding:20px;text-align:center">로딩 실패</div>';document.getElementById('geoEvents').innerHTML=''}
}
async function loadStable(){
  try{const r=await fetch('/api/stable');if(!r.ok)throw 0;STB=await r.json();renderStable(STB)}catch(e){}
}
async function loadNasdaq(){
  try{const r=await fetch('/api/nasdaq');if(!r.ok)throw 0;NQ=await r.json();renderNasdaq(NQ)}catch(e){}
}
async function loadNqBriefing(){
  try{const r=await fetch('/api/nq-briefing');if(!r.ok)return;const d=await r.json();NQB=d;renderNqBriefing(d)}catch(e){}
}

// ============ RENDER: 시장 ============
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

function renderBriefing(d){
  if(!d||!d.text)return;
  document.getElementById('briefSec').style.display='';
  const typeMap={pre:'장전',intra:'장중',post:'장후'};
  document.getElementById('briefType').textContent=typeMap[d.type]||d.type||'';
  document.getElementById('briefBox').innerHTML='<div class="brief fi"><div class="brief-text">'+esc(d.text)+'</div>'
    +(d.generatedAt?'<div class="brief-meta">'+timeAgo(d.generatedAt)+'</div>':'')+'</div>';
}

function renderInvestor(d){
  if(!d||(!d.individual&&!d.foreign))return;
  document.getElementById('invSec').style.display='';
  if(d.date)document.getElementById('invDate').textContent=d.date;
  const items=[
    {name:'개인',data:d.individual,clr:'var(--amber)'},
    {name:'외국인',data:d.foreign,clr:'var(--down)'},
    {name:'기관',data:d.institution,clr:'var(--green)'},
  ];
  const maxAbs=Math.max(...items.map(i=>Math.abs(i.data?.net||0)),1);
  document.getElementById('invBox').innerHTML=items.map(i=>{
    const net=i.data?.net||0;
    const dir=net>0?'up':net<0?'down':'flat';
    const clr=dir==='up'?'var(--up)':dir==='down'?'var(--down)':'var(--flat)';
    const w=Math.abs(net)/maxAbs*100;
    const side=net>=0?'left':'right';
    return '<div class="inv-row fi">'
      +'<span class="inv-name">'+i.name+'</span>'
      +'<div class="inv-bar"><div class="inv-fill" style="width:'+w+'%;background:'+i.clr+';'+side+':0;opacity:.3"></div></div>'
      +'<span class="inv-val" style="color:'+clr+'">'+(net>0?'+':'')+fn(net,0)+'억</span>'
      +'</div>';
  }).join('');
}

function renderNews(d){
  const items=d?.items||[];
  if(!items.length)return;
  document.getElementById('newsSec').style.display='';
  document.getElementById('newsBox').innerHTML=items.slice(0,8).map(n=>{
    const title=n.title||n.headline||n.text||'';
    if(!title)return'';
    return '<div class="news-item fi" style="margin-bottom:3px"><div style="font-weight:600;color:var(--text-s);line-height:1.5">'+esc(title)+'</div>'
      +(n.source?'<div style="font-size:9px;color:var(--text-m);margin-top:2px">'+esc(n.source)+'</div>':'')+'</div>';
  }).join('');
}

function renderWeekly(d){
  if(!d||!d.summary)return;
  document.getElementById('weeklySec').style.display='';
  let h='<div class="brief fi"><div class="brief-text">'+esc(d.summary)+'</div>';
  if(d.performance&&d.performance.length){
    h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    d.performance.forEach(p=>{
      const dir=p.weekChangePercent>0?'up':p.weekChangePercent<0?'down':'flat';
      const clr=dir==='up'?'var(--up)':dir==='down'?'var(--down)':'var(--text-m)';
      h+='<span style="font-size:10px;font-weight:600;color:'+clr+'">'+esc(p.nameKr||p.symbol)+' '+(p.weekChangePercent>0?'+':'')+p.weekChangePercent.toFixed(1)+'%</span>';
    });
    h+='</div>';
  }
  h+='<div class="brief-meta">'+esc((d.weekStart||'')+' ~ '+(d.weekEnd||''))+'</div></div>';
  document.getElementById('weeklyBox').innerHTML=h;
}

function renderGlobal(d){
  const inds=d.indicators||[];
  const glS=['^VIX','NKD=F','^N225','000001.SS','^SOX','EEM','DX-Y.NYB'];
  rCards('glIdx',[...inds.filter(i=>glS.includes(i.symbol)),...inds.filter(i=>i.category==='global'&&!glS.includes(i.symbol))],false);
  const cmdS=['GC=F','SI=F','HG=F','NG=F','CL=F','BZ=F'];
  rCards('cmdIdx',[...inds.filter(i=>cmdS.includes(i.symbol)),...inds.filter(i=>i.category==='commodity'&&!cmdS.includes(i.symbol))],false);
  const rateS=['^TNX','^IRX'];
  rCards('rateIdx',[...inds.filter(i=>rateS.includes(i.symbol)),...inds.filter(i=>i.category==='rates'&&!rateS.includes(i.symbol))],false);
}

function renderThemes(themes){
  if(!themes.length)return;
  document.getElementById('themeSec').style.display='';
  document.getElementById('themeList').innerHTML=themes.slice(0,10).map((t,i)=>{
    const isUp=t.change.startsWith('+');
    return '<a class="rank-row fi" href="https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no='+t.no+'" target="_blank" rel="noopener">'
      +'<span class="rank-num">'+(i+1)+'</span><span class="rank-name">'+esc(t.name)+'</span>'
      +'<span class="rank-detail"><span class="u">'+t.up+'</span><span class="d">'+t.down+'</span></span>'
      +'<span class="rank-chg '+(isUp?'up':'down')+'">'+esc(t.change)+'</span></a>';
  }).join('');
}
function renderSectors(sectors){
  if(!sectors.length)return;
  document.getElementById('sectorSec').style.display='';
  document.getElementById('sectorList').innerHTML=sectors.slice(0,10).map((s,i)=>{
    const isUp=s.change.startsWith('+');
    return '<a class="rank-row fi" href="https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no='+s.no+'" target="_blank" rel="noopener">'
      +'<span class="rank-num">'+(i+1)+'</span><span class="rank-name">'+esc(s.name)+'</span>'
      +'<span class="rank-detail"><span class="u">'+s.up+'</span><span class="d">'+s.down+'</span></span>'
      +'<span class="rank-chg '+(isUp?'up':'down')+'">'+esc(s.change)+'</span></a>';
  }).join('');
}

// ============ RENDER: 지정학 ============
function renderGeo(data){
  const events=data.events||[];
  const downH=events.filter(e=>e.impact.direction==='down'&&e.impact.level==='HIGH').length;
  const downM=events.filter(e=>e.impact.direction==='down'&&e.impact.level==='MED').length;
  const upEv=events.filter(e=>e.impact.direction==='up').length;
  const volEv=events.filter(e=>e.impact.direction==='volatile').length;
  const riskScore=Math.min(100,downH*25+downM*10+volEv*3);
  const riskClr=riskScore>=60?'var(--up)':riskScore>=30?'var(--amber)':'var(--green)';
  const riskLabel=riskScore>=60?'HIGH':riskScore>=30?'MODERATE':'LOW';

  document.getElementById('geoSummary').innerHTML='<div class="geo-summary fi">'
    +'<div class="geo-score-box"><div class="geo-score-num" style="color:'+riskClr+'">'+riskScore+'</div>'
    +'<div class="geo-score-label" style="color:'+riskClr+'">'+riskLabel+'</div></div>'
    +'<div class="geo-impact-summary">'
    +'<div class="geo-impact-item"><div class="geo-impact-count" style="color:var(--up)">'+(downH+downM)+'</div><div class="geo-impact-label">하락</div></div>'
    +'<div class="geo-impact-item"><div class="geo-impact-count" style="color:var(--green)">'+upEv+'</div><div class="geo-impact-label">상승</div></div>'
    +'<div class="geo-impact-item"><div class="geo-impact-count" style="color:var(--amber)">'+volEv+'</div><div class="geo-impact-label">변동</div></div>'
    +'</div></div>';

  const el=document.getElementById('geoEvents');
  if(!events.length){el.innerHTML='<div style="text-align:center;color:var(--text-m);padding:20px">이벤트 없음</div>';return}
  el.innerHTML=events.slice(0,20).map(ev=>{
    const badgeCls=ev.impact.direction+'-'+ev.impact.level.toLowerCase();
    const dirLabel=ev.impact.direction==='down'?'▼':ev.impact.direction==='up'?'▲':'◆';
    const prob=ev.yesPrice!=null?Math.round(ev.yesPrice*100)+'%':'--';
    const vol=ev.volume>=1e6?(ev.volume/1e6).toFixed(1)+'M':ev.volume>=1e3?Math.round(ev.volume/1e3)+'K':Math.round(ev.volume);
    const link=ev.slug?'https://polymarket.com/event/'+ev.slug:'';
    const tag=link?'a href="'+esc(link)+'" target="_blank" rel="noopener"':'div';
    const etag=link?'a':'div';
    return '<'+tag+' class="geo-evt fi"><span class="geo-badge '+badgeCls+'">'+dirLabel+'</span>'
      +'<span class="geo-evt-title">'+esc(ev.title)+'</span>'
      +'<span class="geo-evt-prob">'+prob+'</span>'
      +'<span class="geo-evt-vol">$'+vol+'</span></'+etag+'>';
  }).join('');
}

function renderMatrix(d){
  const box=document.getElementById('mxBox');
  const o=d.overall||d;
  const score=o.score;
  if(score==null){box.innerHTML='<div style="text-align:center;color:var(--text-m);padding:30px">데이터 없음</div>';return}
  const clr=scoreColor(score);
  let h='<div class="mx-score fi"><div class="mx-num" style="color:'+clr+'">'+score+'</div>'
    +'<div class="mx-sig" style="color:'+clr+'">'+esc(o.signal||'')+'</div>'
    +'<div class="mx-desc">'+esc(o.keyDriver||'')+'</div>'
    +(o.keyRisk?'<div class="mx-desc" style="color:var(--up);opacity:.8;margin-top:3px">⚠ '+esc(o.keyRisk)+'</div>':'')
    +'</div>';
  const cats=d.categories||[];
  if(cats.length){
    h+='<div class="mx-grid">';
    cats.forEach(cat=>{
      h+='<div class="mx-cat fi"><div class="mx-cat-name">'+esc(cat.nameEn||cat.name)+'</div>'
        +'<div class="mx-cat-score" style="color:'+scoreColor(cat.score)+'">'+cat.score+'</div>'
        +'<div class="mx-cat-chg">'+(cat.change>0?'+':'')+cat.change+'</div></div>';
    });
    h+='</div>';
  }
  if(d.risks&&d.risks.length){
    h+='<div style="margin-top:10px">';
    d.risks.forEach(r=>{
      const title=typeof r==='string'?r:(r.title||r.text||'');
      const lvl=typeof r==='object'?(r.level||''):'';
      const lvlB=lvl==='high'?'<span style="background:rgba(239,68,68,.15);color:var(--up);padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;margin-right:4px">HIGH</span>':'';
      h+='<div style="padding:8px 12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:8px;margin-bottom:3px;font-size:10px;line-height:1.5" class="fi">'
        +'<div style="color:var(--up);font-weight:700">'+lvlB+'⚠ '+esc(title)+'</div></div>';
    });
    h+='</div>';
  }
  box.innerHTML=h;
}

// ============ RENDER: 원화스테이블 ============
function renderStable(d){
  if(!d||d.error){return}
  const p=d.premium||{};

  // 김치 프리미엄 히어로
  const kp=p.kimchi;
  const kpClr=kp>0?'var(--up)':kp<0?'var(--down)':'var(--text)';
  document.getElementById('premHero').innerHTML='<div class="prem-hero fi">'
    +'<div class="prem-label">김치 프리미엄 (BTC 기준)</div>'
    +'<div class="prem-val" style="color:'+kpClr+'">'+(kp!=null?(kp>0?'+':'')+kp.toFixed(2)+'%':'--')+'</div>'
    +'<div class="prem-sub">공식 환율: '+fn(d.officialFx,0)+' KRW/USD'
    +(p.ethKimchi!=null?' · ETH 기준: '+(p.ethKimchi>0?'+':'')+p.ethKimchi.toFixed(2)+'%':'')
    +'</div></div>';

  // 스테이블코인 시세
  const st=d.stablecoin||{};
  let stH='';
  if(st.usdt&&st.usdt.price!=null){
    const premClr=st.usdt.premium>0?'var(--up)':'var(--down)';
    const premBg=st.usdt.premium>0?'var(--up-bg)':'var(--down-bg)';
    stH+='<div class="prem-row fi"><span class="prem-row-name">USDT/KRW</span>'
      +'<span class="prem-row-price">'+fn(st.usdt.price,0)+'</span>'
      +(st.usdt.premium!=null?'<span class="prem-row-badge" style="color:'+premClr+';background:'+premBg+'">'+(st.usdt.premium>0?'+':'')+st.usdt.premium.toFixed(2)+'%</span>':'')
      +'</div>';
  }
  if(st.usdc&&st.usdc.price!=null){
    const premClr2=st.usdc.premium>0?'var(--up)':'var(--down)';
    const premBg2=st.usdc.premium>0?'var(--up-bg)':'var(--down-bg)';
    stH+='<div class="prem-row fi" style="margin-top:4px"><span class="prem-row-name">USDC/KRW</span>'
      +'<span class="prem-row-price">'+fn(st.usdc.price,0)+'</span>'
      +(st.usdc.premium!=null?'<span class="prem-row-badge" style="color:'+premClr2+';background:'+premBg2+'">'+(st.usdc.premium>0?'+':'')+st.usdc.premium.toFixed(2)+'%</span>':'')
      +'</div>';
  }
  document.getElementById('stableBox').innerHTML=stH||'<div style="color:var(--text-m);font-size:11px;padding:10px">데이터 없음</div>';

  // 크립토
  const crypto=d.crypto||[];
  document.getElementById('cryptoBox').innerHTML=crypto.map(c=>{
    if(!c.price)return'';
    const cdir=c.changePct>0?'up':c.changePct<0?'down':'flat';
    const isKrw=c.symbol.includes('KRW');
    return '<div class="c fi '+cdir+'">'
      +'<div class="c-top"><span class="c-name">'+esc(c.symbol)+'</span><span class="c-session live">24H</span></div>'
      +'<div class="c-val">'+(isKrw?fn(c.price,0):fn(c.price,2))+'</div>'
      +'<div class="c-chg"><span>'+fp(c.changePct)+'</span>'
      +(c.volume?'<span class="pct">vol:'+fvol(c.volume)+'</span>':'')
      +'</div></div>';
  }).join('');

  // 합성 KOSPI
  const syn=d.synthetic||{};
  const comp=d.components||{};
  if(syn.price){
    const sdir=syn.change>0?'up':syn.change<0?'down':'flat';
    const sclr=sdir==='up'?'var(--up)':sdir==='down'?'var(--down)':'var(--text)';
    const arr=syn.change>0?'▲':syn.change<0?'▼':'';
    document.getElementById('synthBox').innerHTML='<div class="synth-card fi">'
      +'<div class="synth-label">합성 KOSPI (가중 모델)</div>'
      +'<div class="synth-price" style="color:'+sclr+'">'+fn(syn.price,2)+'</div>'
      +'<div class="synth-chg" style="color:'+sclr+'">'+arr+' '+fc(syn.change,2)+' ('+fp(syn.changePct)+')</div>'
      +'<div class="synth-friday">금요일 종가: '+fn(syn.fridayClose,2)+'</div>'
      +'<div class="synth-comp">'
      +'<span><span class="synth-dot" style="background:#f59e0b"></span>BTC 30% '+fp2(comp.btc)+'</span>'
      +'<span><span class="synth-dot" style="background:#8b5cf6"></span>NQ 40% '+fp2(comp.nq)+'</span>'
      +'<span><span class="synth-dot" style="background:#3b82f6"></span>ES 20% '+fp2(comp.es)+'</span>'
      +'<span><span class="synth-dot" style="background:#06b6d4"></span>ETH 10% '+fp2(comp.eth)+'</span>'
      +'</div></div>';
  }
  renderTrade();
}

// ============ RENDER: 글로벌 NASDAQ ============
function renderNasdaq(d){
  const inds=d.indicators||[];
  const mag7=inds.filter(i=>i.category==='mag7');
  if(mag7.length){
    document.getElementById('mag7Box').innerHTML=mag7.map(s=>{
      const dir=s.changePercent>0?'up':s.changePercent<0?'down':'flat';
      const spark=s.sparkline&&s.sparkline.length>2?mkSpark(s.sparkline,dir):'';
      return '<a class="mag7-card fi '+dir+'" href="https://finance.yahoo.com/quote/'+esc(s.symbol)+'" target="_blank" rel="noopener">'
        +'<div class="mag7-sym">'+esc(s.symbol)+(s.nameKr?' <span class="sub">'+esc(s.nameKr)+'</span>':'')+'</div>'
        +'<div class="mag7-price">'+fn(s.price,2)+'</div>'
        +'<div class="mag7-chg">'+fp(s.changePercent)+'</div>'
        +spark+'</a>';
    }).join('');
  }
  const sectors=inds.filter(i=>i.category==='sector');
  if(sectors.length){
    document.getElementById('sectorEtfBox').innerHTML=sectors.map(s=>{
      const dir=s.changePercent>0?'up':s.changePercent<0?'down':'flat';
      return '<a class="mag7-card fi '+dir+'" href="https://finance.yahoo.com/quote/'+esc(s.symbol)+'" target="_blank" rel="noopener">'
        +'<div class="mag7-sym">'+esc(s.symbol)+' <span class="sub">'+esc(s.nameKr||s.name)+'</span></div>'
        +'<div class="mag7-price">'+fn(s.price,2)+'</div>'
        +'<div class="mag7-chg">'+fp(s.changePercent)+'</div></a>';
    }).join('');
  }
}
function renderNqBriefing(d){
  if(!d||!d.text)return;
  document.getElementById('nqBriefSec').style.display='';
  document.getElementById('nqBriefBox').innerHTML='<div class="brief fi"><div class="brief-text">'+esc(d.text)+'</div>'
    +(d.generatedAt?'<div class="brief-meta">'+timeAgo(d.generatedAt)+'</div>':'')+'</div>';
}

// ============ TRADING ============
const TRADE_KEY='kospi-vt-v1';
const POINT_VAL=250000;
const MARGIN=5000000;
function getTrade(){try{return JSON.parse(localStorage.getItem(TRADE_KEY))||newTrade()}catch(e){return newTrade()}}
function newTrade(){return{balance:10000000,positions:[],history:[]}}
function saveTrade(s){localStorage.setItem(TRADE_KEY,JSON.stringify(s))}

function renderTrade(){
  const box=document.getElementById('tradeBox');
  if(!box)return;
  if(!STB){box.innerHTML='<div style="text-align:center;color:var(--text-m);padding:20px;font-size:11px">데이터 로딩중...</div>';return}
  const s=getTrade();
  const usdtPrice=STB?.stablecoin?.usdt?.price||0;
  const synthPrice=STB?.synthetic?.price||0;

  let totalPnl=0;
  const posHtml=s.positions.map(function(p,i){
    let pnl=0;
    if(p.type==='usdt'){
      pnl=(usdtPrice-p.entry)*p.qty;
    }else{
      pnl=p.dir==='long'?(synthPrice-p.entry)*POINT_VAL:(p.entry-synthPrice)*POINT_VAL;
    }
    totalPnl+=pnl;
    const pnlClr=pnl>0?'var(--up)':pnl<0?'var(--down)':'var(--text)';
    const typeClr=p.dir==='short'?'var(--down)':'var(--up)';
    const label=p.type==='usdt'?'USDT x'+p.qty:(p.dir==='long'?'KOSPI 롱':'KOSPI 숏');
    const entryStr=p.type==='usdt'?fn(p.entry,0):fn(p.entry,2);
    return '<div class="trade-pos-item fi">'
      +'<div class="trade-pos-info"><span class="trade-pos-type" style="color:'+typeClr+'">'+label+'</span>'
      +'<span class="trade-pos-entry">진입 '+entryStr+'</span></div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span class="trade-pos-pnl" style="color:'+pnlClr+'">'+(pnl>0?'+':'')+fn(Math.round(pnl),0)+'</span>'
      +'<button class="trade-close" onclick="closeTrade('+i+')">청산</button></div></div>';
  }).join('');

  const histHtml=s.history.slice(-5).reverse().map(function(h){
    const pnlClr=h.pnl>0?'var(--up)':h.pnl<0?'var(--down)':'var(--text-m)';
    const d=new Date(h.ts);
    const ts=(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    return '<div class="trade-hist-item"><span>'+esc(h.label)+'</span><span>'+ts+'</span>'
      +'<span style="color:'+pnlClr+';font-weight:700">'+(h.pnl>0?'+':'')+fn(h.pnl,0)+'</span></div>';
  }).join('');

  const equity=s.balance+totalPnl;
  const eqClr=equity>=10000000?'var(--green)':'var(--up)';
  const canBuyUsdt=usdtPrice>0&&s.balance>=usdtPrice*100;
  const canFutures=synthPrice>0&&s.balance>=MARGIN;
  const hasUsdt=s.positions.some(function(p){return p.type==='usdt'});
  const hasFutures=s.positions.some(function(p){return p.type==='futures'});

  box.innerHTML='<div class="trade-box fi">'
    +'<div class="trade-bal"><div>잔고 <b>'+fn(s.balance,0)+'</b>원'
    +(totalPnl?'  평가 <b style="color:'+eqClr+'">'+(totalPnl>0?'+':'')+fn(Math.round(totalPnl),0)+'</b>':'')
    +'</div><button class="trade-reset" onclick="confirmReset()">초기화</button></div>'
    +'<div style="display:flex;gap:10px">'
    +'<div class="trade-section" style="flex:1">'
    +'<div class="trade-section-h"><span>USDT/KRW</span><span class="price">'+(usdtPrice?fn(usdtPrice,0):'--')+'</span></div>'
    +'<div class="trade-btns">'
    +'<button class="trade-btn buy" onclick="buyUsdt()"'+(canBuyUsdt?'':' disabled')+'>매수 100</button>'
    +'<button class="trade-btn sell" onclick="sellUsdt()"'+(hasUsdt?'':' disabled')+'>전량매도</button>'
    +'</div></div>'
    +'<div class="trade-section" style="flex:1">'
    +'<div class="trade-section-h"><span>KOSPI 선물</span><span class="price">'+(synthPrice?fn(synthPrice,2):'--')+'</span></div>'
    +'<div class="trade-btns">'
    +'<button class="trade-btn buy" onclick="buyFutures(\\'long\\')"'+(canFutures&&!hasFutures?'':' disabled')+'>롱</button>'
    +'<button class="trade-btn sell" onclick="buyFutures(\\'short\\')"'+(canFutures&&!hasFutures?'':' disabled')+'>숏</button>'
    +'</div></div></div>'
    +(s.positions.length?'<div style="margin-top:10px">'+posHtml+'</div>':'<div style="text-align:center;color:var(--text-m);font-size:10px;padding:12px">포지션 없음</div>')
    +(histHtml?'<div class="trade-hist"><div style="font-size:9px;font-weight:700;color:var(--text-m);margin-bottom:4px">최근 거래</div>'+histHtml+'</div>':'')
    +'<div style="font-size:8px;color:var(--text-m);margin-top:8px;opacity:.5">USDT: 100개 단위 · KOSPI 선물: 1pt=25만원, 증거금 500만원</div>'
    +'</div>';
}

function buyUsdt(){
  const s=getTrade();
  const price=STB?.stablecoin?.usdt?.price;
  if(!price)return;
  const qty=100;
  const cost=price*qty;
  if(s.balance<cost)return;
  s.balance-=cost;
  s.positions.push({type:'usdt',entry:price,qty:qty,ts:Date.now()});
  s.history.push({label:'USDT x'+qty+' 매수 @'+fn(price,0),pnl:0,ts:Date.now()});
  saveTrade(s);renderTrade();
}
function sellUsdt(){
  const s=getTrade();
  const price=STB?.stablecoin?.usdt?.price;
  if(!price)return;
  const idx=s.positions.findIndex(function(p){return p.type==='usdt'});
  if(idx===-1)return;
  const p=s.positions[idx];
  const pnl=Math.round((price-p.entry)*p.qty);
  s.balance+=Math.round(price*p.qty);
  s.positions.splice(idx,1);
  s.history.push({label:'USDT x'+p.qty+' 매도 @'+fn(price,0),pnl:pnl,ts:Date.now()});
  saveTrade(s);renderTrade();
}
function buyFutures(dir){
  const s=getTrade();
  const price=STB?.synthetic?.price;
  if(!price||s.balance<MARGIN)return;
  if(s.positions.some(function(p){return p.type==='futures'}))return;
  s.balance-=MARGIN;
  s.positions.push({type:'futures',dir:dir,entry:price,ts:Date.now()});
  s.history.push({label:'KOSPI '+(dir==='long'?'롱':'숏')+' @'+fn(price,2),pnl:0,ts:Date.now()});
  saveTrade(s);renderTrade();
}
function closeTrade(idx){
  const s=getTrade();
  const p=s.positions[idx];
  if(!p)return;
  let pnl=0;
  if(p.type==='usdt'){
    const price=STB?.stablecoin?.usdt?.price||p.entry;
    pnl=Math.round((price-p.entry)*p.qty);
    s.balance+=Math.round(price*p.qty);
    s.history.push({label:'USDT x'+p.qty+' 매도 @'+fn(price,0),pnl:pnl,ts:Date.now()});
  }else{
    const price=STB?.synthetic?.price||p.entry;
    pnl=Math.round(p.dir==='long'?(price-p.entry)*POINT_VAL:(p.entry-price)*POINT_VAL);
    s.balance+=MARGIN+pnl;
    s.history.push({label:'KOSPI '+(p.dir==='long'?'롱':'숏')+' 청산 @'+fn(price,2),pnl:pnl,ts:Date.now()});
  }
  s.positions.splice(idx,1);
  saveTrade(s);renderTrade();
}
function confirmReset(){
  if(confirm('트레이딩 데이터를 초기화하시겠습니까?')){
    localStorage.removeItem(TRADE_KEY);renderTrade();
  }
}

// ============ COMMON ============
function rStatus(closed,session){
  const b=document.getElementById('badge'),t=document.getElementById('badgeTxt');
  if(closed){b.className='badge closed';t.textContent='마감'}
  else if(session==='pre'){b.className='badge pre';t.textContent='장전'}
  else if(session==='after'){b.className='badge after';t.textContent='장후'}
  else{b.className='badge open';t.textContent='장중'}
}
function rClock(iso){
  if(iso){const d=new Date(iso),k=new Date(d.getTime()+9*36e5);
    document.getElementById('updated').textContent='갱신 '+[k.getUTCHours(),k.getUTCMinutes()].map(v=>String(v).padStart(2,'0')).join(':')}
}
function tickClock(){
  const n=new Date(),k=new Date(n.getTime()+9*36e5);
  document.getElementById('clock').textContent=[k.getUTCHours(),k.getUTCMinutes(),k.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':')+' KST';
}
setInterval(tickClock,1000);tickClock();

function rCards(id,items,lg){
  const el=document.getElementById(id);if(!el||!items.length)return;
  el.innerHTML=items.map(i=>mkCard(i,lg)).join('');
}
function mkCard(d,lg){
  const dir=d.change>0?'up':d.change<0?'down':'flat';
  const arr=d.change>0?'▲':d.change<0?'▼':'';
  const dec=d.price>=10000?0:d.price>=100?2:d.price>=1?2:4;
  const spark=d.sparkline&&d.sparkline.length>2?mkSpark(d.sparkline,dir):'';
  const st=d.sessionType;
  const session=st==='nxt'?'<span class="c-session nxt">NXT</span>':d.marketClosed?'<span class="c-session closed">마감</span>':'<span class="c-session live">LIVE</span>';
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
  const m=sym.match(/^(\\d{6})\\.KS$/);if(m)return'https://finance.naver.com/item/main.naver?code='+m[1];
  if(sym==='^KS11')return'https://finance.naver.com/sise/sise_index.naver?code=KOSPI';
  if(sym==='^KQ11')return'https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ';
  if(sym==='BTC-KRW')return'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=BTC_KRW';
  if(sym==='KRW=X')return'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW';
  if(sym.startsWith('^'))return'https://finance.yahoo.com/quote/'+encodeURIComponent(sym);
  return'https://finance.yahoo.com/quote/'+encodeURIComponent(sym);
}
function rFutures(f){
  const sec=document.getElementById('futSec'),box=document.getElementById('futBox');
  if(!f||!f.price){sec.style.display='none';return}sec.style.display='';
  const dir=f.change>0?'up':f.change<0?'down':'flat';
  const clr=dir==='up'?'var(--up)':dir==='down'?'var(--down)':'var(--text)';
  const arr=f.change>0?'▲':f.change<0?'▼':'';
  box.innerHTML='<div class="fut fi"><div class="fut-l"><div>'
    +'<div class="fut-name">'+esc(f.name)+(f.isNightSession?' (야간)':'')+'</div>'
    +'<div class="fut-val" style="color:'+clr+'">'+fn(f.price,2)+'</div>'
    +'<div class="fut-chg" style="color:'+clr+'">'+arr+' '+fc(f.change,2)+' ('+fp(f.changePercent)+')</div>'
    +'</div></div><div class="fut-meta">'
    +'<span><span class="label">고</span>'+fn(f.high,2)+'</span>'
    +'<span><span class="label">저</span>'+fn(f.low,2)+'</span>'
    +'<span><span class="label">량</span>'+fvol(f.volume)+'</span>'
    +'<span><span class="label">베이시스</span>'+fc(f.basis,2)+'</span>'
    +'</div></div>';
}
function rFearGreed(fg){
  const sec=document.getElementById('fgSec'),box=document.getElementById('fgBox');
  if(!fg||fg.value==null){sec.style.display='none';return}sec.style.display='';
  const v=fg.value;
  const clr=v<=25?'var(--up)':v<=45?'var(--amber)':v<=55?'var(--text-s)':v<=75?'var(--green)':'var(--green)';
  box.innerHTML='<div class="fg fi"><div><div class="fg-score" style="color:'+clr+'">'+v+'</div></div>'
    +'<div style="flex:1"><div class="fg-label" style="color:'+clr+'">'+esc(fg.label)+'</div>'
    +'<div class="fg-bar"><div class="fg-dot" style="left:'+v+'%"></div></div>'
    +'<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-m);margin-top:3px">'
    +'<span>Extreme Fear</span><span>Extreme Greed</span></div></div></div>';
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
  const pts=data.map((v,i)=>{const x=pad+(i/(data.length-1))*(w-pad*2);const y=h-pad-((v-mn)/rng)*(h-pad*2);return x.toFixed(1)+','+y.toFixed(1)}).join(' ');
  const clr=dir==='up'?'#ef4444':dir==='down'?'#3b82f6':'#71717a';
  const gid='g'+Math.random().toString(36).slice(2,6);
  const ap=pts+' '+(w-pad).toFixed(1)+','+h+' '+pad+','+h;
  return '<div class="spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+clr+'" stop-opacity=".12"/><stop offset="100%" stop-color="'+clr+'" stop-opacity="0"/></linearGradient></defs>'
    +'<polygon points="'+ap+'" fill="url(#'+gid+')"/>'
    +'<polyline points="'+pts+'" fill="none" stroke="'+clr+'" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
}

function fn(n,d){if(n==null||isNaN(n))return'--';return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fc(n,d){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fp(n){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+n.toFixed(2)+'%'}
function fp2(n){if(n==null||isNaN(n))return'--';return(n>0?'+':'')+n.toFixed(1)+'%'}
function fvol(n){if(!n)return'--';if(n>=1e12)return(n/1e12).toFixed(1)+'조';if(n>=1e8)return(n/1e8).toFixed(1)+'억';if(n>=1e4)return Math.round(n/1e4)+'만';return n.toLocaleString('ko-KR')}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function timeAgo(iso){try{const d=new Date(iso),n=Date.now(),m=Math.floor((n-d.getTime())/60000);if(m<60)return m+'분 전';if(m<1440)return Math.floor(m/60)+'시간 전';return Math.floor(m/1440)+'일 전'}catch(e){return''}}
</script>
</body>
</html>`;
