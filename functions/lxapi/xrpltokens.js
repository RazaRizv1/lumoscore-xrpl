// Market rows for the Trade page: the XRP Ledger's most-traded tokens.
//
// Separate from /lxapi/xrplprices on purpose. That one answers "what is this list of tokens worth",
// keyed by slug and stripped to three numbers. This one answers "what should the market table show",
// ordered by volume and carrying the columns that table has. Merging them would mean sending every
// caller the union of both, and the wallet does not need day high/low or TVL.
//
// One upstream page (top 100 by 24h volume), edge-cached. Same reasons as xrplprices: the anonymous
// tier is 333 requests per DAY per IP, so this cannot be fetched from the visitor's browser.
//
// LOGOS ARE DELIBERATELY ABSENT. xrpl.to's thumbnail endpoint requires an API key -- it answers 401
// without one -- so there is no logo URL to give the page. The browser layer draws initials instead.
// Emitting a URL that 401s would put a broken image beside every token, which is worse than a letter.

const UP = 'https://api.xrpl.to/api';
const TTL = 120;

const json = (body, secs) => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + secs,
    'access-control-allow-origin': '*',
  },
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function upstream(path, env) {
  // The User-Agent is required: without one the upstream answers 403 to everything. Measured.
  const headers = { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' };
  if (env && env.XRPLTO_API_KEY) headers['x-api-key'] = env.XRPLTO_API_KEY;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(UP + path, { headers });
    if (r.ok) return r.json();
    if (r.status !== 429 || attempt === 1) throw new Error('upstream ' + r.status);
    const ra = Number(r.headers.get('retry-after'));
    await sleep(isFinite(ra) && ra > 0 && ra <= 5 ? ra * 1000 : 1200);
  }
  throw new Error('upstream 429');
}

const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const n = Math.min(100, Math.max(1, parseInt(url.searchParams.get('n') || '50', 10) || 50));

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?n=' + n, request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let out;
  try {
    const bulk = await upstream('/tokens?limit=100&sort=vol24hxrp&order=desc&lightweight=true', env);

    // XRP per USD from the same response the prices came from, so the two cannot drift apart.
    const xrpPerUsd = Number(bulk && bulk.exch && bulk.exch.USD);
    const usdPerXrp = xrpPerUsd > 0 ? 1 / xrpPerUsd : null;

    const rows = [];
    for (const t of ((bulk && bulk.tokens) || [])) {
      const p = Number(t.exch);
      if (!isFinite(p)) continue;
      const mm = Array.isArray(t.maxMin24h) ? t.maxMin24h : [];
      rows.push({
        c: t.currency, i: t.issuer,
        n: String(t.name || ''),
        u: String(t.user || ''),               // the issuer's display name, e.g. "Fuzzybear"
        p: p,                                  // price in XRP
        d: num(t.pro24h), w: num(t.pro7d),
        v: num(t.vol24hxrp), t: num(t.tvl),
        x: num(t.vol24htx),                    // trade count in 24h, for the Trades column
        hi: num(mm[0]), lo: num(mm[1]),
        h: num(t.holders),
        vf: t.verified ? 1 : 0,
        o: String(t.origin || ''),
      });
      if (rows.length >= n) break;
    }

    // Same stablecoin guard as xrplprices: USD here is derived from the XRP rate, and an inverted
    // ratio yields plausible-looking prices rather than an error. If nothing anchors it, send null
    // and let the page show XRP only.
    let usd = usdPerXrp;
    const peg = rows.find((r) => r.n === 'RLUSD');
    if (usd == null || !peg || !(peg.p * usd > 0.90 && peg.p * usd < 1.10)) usd = null;

    out = {
      ok: true, usd, count: rows.length, rows,
      src: 'xrpl.to', attribution: 'Data by xrpl.to', attributionUrl: 'https://xrpl.to',
    };
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e), rows: [] }, 30);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
