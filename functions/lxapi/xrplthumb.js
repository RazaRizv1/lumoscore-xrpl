// Token logos, proxied so the API key never reaches the browser.
//
// xrpl.to's thumbnail endpoint REQUIRES a key — it answers 401 without one, which is why every
// token on this site has been drawing letter initials. The key is a server-side credential, so the
// page cannot call that endpoint directly: putting it in front-end code would publish it to anyone
// who opens devtools, and it is the same key that carries this project's whole request budget.
//
// So the image is fetched here and passed through. The browser only ever sees /lxapi/xrplthumb.
//
// Cached hard. A token's logo effectively never changes, and every row of every market table asks
// for one, so this is the highest-volume endpoint in the project by a wide margin.

const UP = 'https://api.xrpl.to/api/thumb/';
const TTL = 604800;                    // a week; logos do not move

// Only the sizes xrpl.to actually serves. Anything else is rejected rather than passed through,
// so this cannot be turned into an open image proxy for arbitrary upstream paths.
const SIZES = [16, 32, 40, 48, 64, 96, 128];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // A token id is an md5: exactly 32 hex characters. Validated rather than forwarded, so nothing
  // else can be appended to the upstream path.
  let id = (url.searchParams.get('id') || '').trim().toLowerCase();

  // ...and the id is DERIVABLE, which is what lets the wallet draw logos at all.
  //
  // Every other list on this site takes the id from an API row (`m`), because it is listing tokens
  // the API just ranked. The wallet lists what an ACCOUNT holds, straight off account_lines, and a
  // holding is frequently nowhere near the top of any ranking — so there is no row to take it from,
  // and one lookup per holding would be dozens of requests to price a single page.
  //
  // The id turns out to be md5(issuer + "_" + currencyHex), verified against all 50 rows of
  // /lxapi/xrpltokens with zero mismatches. So the caller passes what it already knows and this
  // derives the rest. It is done HERE and not in the page because JS has no built-in MD5 and the
  // Web Crypto standard does not include it — Cloudflare supports it as an extension to
  // crypto.subtle.digest, so the edge can do in one line what the browser would need a vendored
  // hash implementation for.
  if (!id) {
    const iss = (url.searchParams.get('iss') || '').trim();
    const cur = (url.searchParams.get('cur') || '').trim().toUpperCase();
    // Shapes only, and both are required: an r-address and a currency (a 3-char code or 40 hex).
    if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(iss) && /^([0-9A-F]{40}|[A-Z0-9]{3})$/.test(cur)) {
      try {
        const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(iss + '_' + cur));
        id = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { /* falls through to the 400 below */ }
    }
  }

  if (!/^[0-9a-f]{32}$/.test(id)) {
    return new Response('bad id', { status: 400, headers: { 'cache-control': 'public, max-age=3600' } });
  }
  let w = parseInt(url.searchParams.get('w') || '48', 10);
  if (SIZES.indexOf(w) < 0) w = 48;

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?id=' + id + '&w=' + w, request);
  const hit = await cache.match(key);
  if (hit) return hit;

  const headers = { accept: 'image/webp,image/*', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' };
  if (env && env.XRPLTO_API_KEY) headers['x-api-key'] = env.XRPLTO_API_KEY;

  let upstream;
  try {
    upstream = await fetch(UP + id + '?w=' + w, { headers });
  } catch (e) {
    return new Response('upstream unreachable', { status: 502 });
  }

  // 401 here means the key is missing or rejected. Say so with a status the page can ignore
  // quietly — a missing logo must never break a row.
  if (!upstream.ok) {
    return new Response('no logo', {
      status: upstream.status === 401 ? 404 : upstream.status,
      headers: { 'cache-control': 'public, max-age=600' },
    });
  }

  const body = await upstream.arrayBuffer();
  const res = new Response(body, {
    headers: {
      'content-type': upstream.headers.get('content-type') || 'image/webp',
      'cache-control': 'public, max-age=' + TTL + ', immutable',
      'access-control-allow-origin': '*',
    },
  });
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
