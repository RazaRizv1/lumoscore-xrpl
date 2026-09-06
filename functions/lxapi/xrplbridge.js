// Chains reachable from the XRP Ledger through Axelar.
//
// Replaces a page driven by `lx-cctp-js` (~123KB of Circle CCTP), which moved USDC between STELLAR
// and eight EVM chains. Wrong bridge, wrong source chain, on a page whose own heading already said
// "via Axelar".
//
// THE LIST IS FETCHED, NOT HARDCODED. Axelar publishes its live chain registry, and XRPL is in it
// (id "xrpl", chain_type "vm", native XRP) alongside 83 others. A hardcoded list would be wrong the
// first time Axelar adds or removes a chain, and a bridge page that offers a route which no longer
// exists is worse than one that offers fewer.
//
// WHAT THIS DOES NOT DO: quote or execute a transfer. That needs Squid's routing API (which requires
// an x-integrator-id we do not have) and a signed transaction moving real funds. The page says so
// rather than showing a button that looks like it works.

const UP = 'https://api.axelarscan.io/api';
const TTL = 900;                       // the chain registry changes rarely

const json = (body, secs) => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + secs,
    'access-control-allow-origin': '*',
  },
});

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname, request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let out;
  try {
    const r = await fetch(UP + '/getChains', {
      headers: { accept: 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' },
    });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const raw = await r.json();
    const all = Array.isArray(raw) ? raw : (raw.data || []);

    // XRPL must actually be present. If Axelar ever drops it, this page should say the route is
    // unavailable rather than list 83 destinations you cannot reach from here.
    const xrpl = all.find((c) => c.id === 'xrpl');
    if (!xrpl) return json({ ok: false, error: 'xrpl not in the Axelar registry', rows: [] }, 60);

    const rows = all
      .filter((c) => c.id !== 'xrpl' && !c.deprecated && c.name)
      .map((c) => ({
        id: String(c.id || ''),
        name: String(c.name || ''),
        short: String(c.short_name || c.name || ''),
        type: String(c.chain_type || ''),
        // Axelar's own icon, so the list is not a wall of initials.
        img: c.image ? ('https://axelarscan.io' + c.image) : '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    out = {
      ok: true,
      source: { id: xrpl.id, name: xrpl.name, native: (xrpl.native_token && xrpl.native_token.symbol) || 'XRP' },
      count: rows.length,
      rows,
      // Stated in the payload so the page cannot quietly present itself as functional.
      transfers: false,
      note: 'Route discovery only — transfers are not enabled yet.',
      src: 'Axelar', srcUrl: 'https://axelarscan.io',
    };
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e), rows: [] }, 60);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
