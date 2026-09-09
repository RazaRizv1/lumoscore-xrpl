// Price history for a token, for the charts.
//
// The $LUMOS page's chart SVG was built by `lx-ltdata`, so removing that layer left an empty box.
// This is the data behind its replacement.
//
// Proxied for the usual reason — the upstream key must not reach the browser — and because a chart
// with six range buttons is six requests per visitor otherwise, on top of everything else the page
// already fetches.
//
// Returned as a compact array of [timeMs, close] pairs rather than full candles: these charts draw a
// line and an area, not wicks, and sending open/high/low/volume for 180 points would quadruple the
// payload for values nothing renders. If a candlestick view is ever added, widen this then.

import { tokenId } from './_tokenid.js';

const UP = 'https://api.xrpl.to/api';

// Button label -> what the upstream understands. The upstream accepts 1D|5D|7D|1M|3M|1Y|5Y|ALL.
// "1H" is not one of them: it is served as a single day and trimmed client-side to the last hour,
// which is why the trim window travels in the response rather than being guessed by the page.
const RANGES = {
  '1H': { range: '1D', interval: '5m', trimMs: 60 * 60 * 1000 },
  '24H': { range: '1D', interval: '15m' },
  '7D': { range: '7D', interval: '1h' },
  '30D': { range: '1M', interval: '4h' },
  '1Y': { range: '1Y', interval: '1d' },
  'ALL': { range: 'ALL', interval: '1d' },
};

const TTL = 300;

const json = (body, secs) => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + secs,
    'access-control-allow-origin': '*',
  },
});

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Either the upstream's own id, or the issuer + currency it is derived from — the pool pages know
  // a reserve's issuer and currency off the ledger but have no ranking row to read an id out of.
  // See _tokenid.js; the same two forms are accepted by the thumbnail proxy.
  let id = (url.searchParams.get('id') || '').trim().slice(0, 120);
  if (!id) id = await tokenId(url.searchParams.get('iss'), url.searchParams.get('cur'));
  if (!id) return json({ ok: false, error: 'no id' }, 60);

  const label = (url.searchParams.get('r') || '7D').toUpperCase();
  const spec = RANGES[label];
  if (!spec) return json({ ok: false, error: 'bad range' }, 60);

  const vs = (url.searchParams.get('vs') || 'USD').toUpperCase() === 'XRP' ? 'XRP' : 'USD';

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?id=' + encodeURIComponent(id)
    + '&r=' + label + '&vs=' + vs, request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let out;
  try {
    const headers = {
      accept: 'application/json',
      'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)',
    };
    if (env && env.XRPLTO_API_KEY) headers['x-api-key'] = env.XRPLTO_API_KEY;

    const r = await fetch(UP + '/ohlc/' + encodeURIComponent(id)
      + '?range=' + spec.range + '&interval=' + spec.interval + '&vs_currency=' + vs, { headers });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const j = await r.json();

    // [time, open, high, low, close, volume]
    let pts = ((j && j.ohlc) || [])
      .map((c) => [Number(c[0]), Number(c[4])])
      .filter((p) => isFinite(p[0]) && isFinite(p[1]) && p[1] > 0);

    if (spec.trimMs && pts.length) {
      const cut = pts[pts.length - 1][0] - spec.trimMs;
      const trimmed = pts.filter((p) => p[0] >= cut);
      // Only use the trim if something survives it: an illiquid token may have no candle in the
      // last hour at all, and an empty chart is worse than a slightly longer one.
      if (trimmed.length > 1) pts = trimmed;
    }

    out = {
      ok: true, id, range: label, vs,
      interval: String(j && j.interval || spec.interval),
      count: pts.length,
      pts,
      src: 'xrpl.to', attribution: 'Data by xrpl.to', attributionUrl: 'https://xrpl.to',
    };
  } catch (e) {
    return json({ ok: false, id, range: label, error: String((e && e.message) || e), pts: [] }, 60);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
