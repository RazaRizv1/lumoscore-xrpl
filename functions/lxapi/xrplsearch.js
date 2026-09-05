// Token search for the XRP Ledger.
//
// Replaces a Stellar index that was live on every XRPL page: typing "USD" into the search box on
// this site returned Stellar assets with G-issuers, and prefetched their logos. Same class of
// wrong-chain layer as the Trade market table.
//
// A TICKER IS NOT AN IDENTITY, and on this ledger the search box is where that bites first. A search
// for "USD" returns, right now: RLUSD (Ripple), USDC (Circle), USD (Bitstamp), USD (RippleFox),
// USDT (XRPS), USDC (GateHub). Two different USDs and two different USDCs, all real, none of them
// each other. So every result carries its issuer, and results are ordered by 24h volume so the one
// people actually mean is first -- ordering by name would put the impostor above the real thing.
//
// Proxied and cached for the same reason as the other feeds: 333 upstream requests per DAY per IP.
// A search box firing per keystroke from the visitor's own IP would exhaust that in one session.

const UP = 'https://api.xrpl.to/api';
const TTL = 300;                       // a query's result set moves slowly; the cache does the work

const json = (body, secs) => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + secs,
    'access-control-allow-origin': '*',
  },
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function upstream(path, env) {
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
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  if (q.length < 2) return json({ ok: true, q, rows: [] }, 60);

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?q=' + encodeURIComponent(q.toLowerCase()), request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let out;
  try {
    // `filter` is a text search on the token name. limit caps at 50 when a filter is present.
    const r = await upstream('/tokens?limit=50&sort=vol24hxrp&order=desc&lightweight=true'
      + '&filter=' + encodeURIComponent(q), env);

    const xrpPerUsd = Number(r && r.exch && r.exch.USD);
    const usdPerXrp = xrpPerUsd > 0 ? 1 / xrpPerUsd : null;

    const rows = ((r && r.tokens) || []).map((t) => ({
      n: String(t.name || ''),
      u: String(t.user || ''),               // issuer's display name
      i: String(t.issuer || ''),
      c: String(t.currency || ''),
      h: num(t.holders),
      v: num(t.vol24hxrp),
      p: num(t.exch),
      vf: t.verified ? 1 : 0,
    })).filter((t) => t.n && t.i);

    out = {
      ok: true, q, total: num(r && r.total), count: rows.length, rows,
      usd: usdPerXrp,
      src: 'xrpl.to', attribution: 'Data by xrpl.to', attributionUrl: 'https://xrpl.to',
    };
  } catch (e) {
    // An empty result set is honest. A stale one from another chain is not.
    return json({ ok: false, q, error: String((e && e.message) || e), rows: [] }, 30);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
