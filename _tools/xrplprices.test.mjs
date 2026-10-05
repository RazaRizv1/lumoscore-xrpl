// Drives the real endpoint module with the edge globals stubbed, so the refusal path can be exercised
// on demand instead of waiting for xrpl.to to rate-limit us again.
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); },
  },
};
let MODE = 'ok';
globalThis.fetch = async (url) => {
  if (MODE === '429') return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } });
  // One page of the shape the endpoint reads; enough for a non-empty map and a usable XRP/USD.
  const tokens = [
    { issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', currency: '524C555344000000000000000000000000000000', exch: 0.667, pro24h: 1.1, pro7d: 2.2 },
    { issuer: 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha', currency: '4C554D4F53000000000000000000000000000000', exch: 0.0000228, pro24h: 1, pro7d: 1 },
  ];
  return new Response(JSON.stringify({ tokens, exch: { USD: 1.5 } }), { headers: { 'content-type': 'application/json' } });
};

const { onRequest } = await import('../functions/lxapi/xrplprices.js');
const ctx = (u) => ({ request: new Request(u), env: {}, waitUntil: (p) => p });
const URL_ = 'https://x.test/lxapi/xrplprices';

const read = async (r) => ({ status: r.status, cc: r.headers.get('cache-control'), body: await r.json() });

let fail = 0;
const check = (name, cond, got) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// 1. a success populates the last-good store
MODE = 'ok';
let a = await read(await onRequest(ctx(URL_)));
check('success returns prices', a.body.ok === true && Object.keys(a.body.t).length > 0, a.body);
check('success is stamped with asOf', typeof a.body.asOf === 'number' && a.body.asOf > 0, a.body.asOf);
check('success is not marked stale', !a.body.stale, a.body.stale);

// 2. drop ONLY the serving copy, as its 120s TTL would, then refuse upstream
store.delete(URL_ + '?t=');
MODE = '429';
let b = await read(await onRequest(ctx(URL_)));
check('refusal serves the last good prices', b.body.ok === true && Object.keys(b.body.t).length > 0, b.body);
check('and marks them stale', b.body.stale === true, b.body.stale);
check('and reports the age and the error', typeof b.body.ageSec === 'number' && /429/.test(b.body.error || ''), b.body);
check('and is never re-cached as fresh', b.cc === 'no-store', b.cc);

// 3. a different token set must not borrow another set's prices
let c = await read(await onRequest(ctx(URL_ + '?t=XRP')));
check('another token set refuses rather than borrowing', c.body.ok === false && Object.keys(c.body.t).length === 0, c.body);

// 4. past STALE_MAX it refuses outright
const old = await (store.get(URL_ + '/__last?t=')).json();
old.asOf = Date.now() - 901 * 1000;
store.set(URL_ + '/__last?t=', new Response(JSON.stringify(old), { headers: { 'content-type': 'application/json' } }));
store.delete(URL_ + '?t=');
let d = await read(await onRequest(ctx(URL_)));
check('a last-good older than 15 min is refused, not served', d.body.ok === false && Object.keys(d.body.t).length === 0, d.body);

console.log(fail ? ('\n' + fail + ' FAILED') : '\nall checks passed');
process.exit(fail ? 1 : 0);
