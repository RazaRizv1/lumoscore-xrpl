// One token's details, for the Trade-Asset page.
//
// The page it serves was the most visibly wrong on the site: `lx-dxadata` ignored the token in the
// URL entirely and rendered Stellar LUMOS -- 105 mentions of XLM and 124 Stellar addresses under a
// title reading "LUMOS price, pools and holders on Stellar", reached by clicking any row in the
// XRP Ledger market table.
//
// Proxied and cached like the other feeds: 333 upstream requests per DAY per IP.
//
// The ORDER BOOK is deliberately not here. It comes straight from the XRP Ledger in the browser via
// book_offers -- there is no rate limit worth proxying for, no third party to trust, and a book is
// the one thing on the page that should be as live as the ledger itself.

const UP = 'https://api.xrpl.to/api';
const TTL = 60;

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
  // Accepts the upstream's own id forms: "issuer-currencyHex", an md5, or the literal XRP.
  const id = (url.searchParams.get('id') || '').trim().slice(0, 120);
  if (!id) return json({ ok: false, error: 'no id' }, 30);

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?id=' + encodeURIComponent(id), request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let out;
  try {
    const r = await upstream('/token/' + encodeURIComponent(id), env);
    const t = r && r.token;
    if (!t) return json({ ok: false, error: 'not found', id }, 60);

    // `amount` is everything ever issued; `supply` is what is actually circulating. They differ --
    // for LUMOS, 999,955,352 issued against 705,205,451 circulating -- so both travel, labelled.
    out = {
      ok: true,
      id,
      name: String(t.name || ''),
      user: String(t.user || ''),
      issuer: String(t.issuer || ''),
      currency: String(t.currency || ''),
      price: num(t.exch),                    // in XRP
      usd: num(t.usd),
      p24: num(t.pro24h), p7: num(t.pro7d), p1h: num(t.pro1h),
      vol24: num(t.vol24hxrp), trades24: num(t.vol24htx),
      tvl: num(t.tvl), marketcap: num(t.marketcap),
      holders: num(t.holders), trustlines: num(t.trustlines), offers: num(t.offers),
      issued: num(t.amount), circulating: num(t.supply),
      verified: t.verified ? 1 : 0,
      md5: String(t.md5 || ''),
      domain: String(t.domain || ''),
      origin: String(t.origin || ''),
      src: 'xrpl.to', attribution: 'Data by xrpl.to', attributionUrl: 'https://xrpl.to',
    };
  } catch (e) {
    return json({ ok: false, id, error: String((e && e.message) || e) }, 30);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
