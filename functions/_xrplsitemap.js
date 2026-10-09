// The XRP Ledger asset urls for sitemap.xml.
//
// WHY THIS EXISTS. Measured 2026-10-07 on the combined deploy: the sitemap carried 542 urls, 289 of
// them Stellar asset pages fetched live from Horizon, and NOT ONE XRPL asset page. Those pages exist
// and are individually titled — /trade/xrpl/RLUSD-rMxC… returns a real page — but nothing linked to
// them and nothing listed them, so the deepest and most numerous part of this site was invisible.
//
// Kept as its own module rather than inlined into sitemap.xml.js, because that file belongs to the
// Stellar repo and XRPL work does not touch it. combine_with_stellar.js copies this file next to it
// and adds two lines to call it, so the Stellar build is unchanged and the combined build gains the
// urls.
//
// IT CALLS api.xrpl.to DIRECTLY RATHER THAN OUR OWN /lxapi/xrplpools, and that is the one thing in
// here that must not be "simplified". A Pages Function fetching its own hostname gets the Cloudflare
// Access login page back as a 200 — `.ok` is true, the JSON parse fails, and the list comes back
// empty. The sitemap would look healthy while publishing nothing, which is the worst shape for this
// to fail in. The same upstream and the same key that /lxapi/xrplpools uses are used here.
//
// ONLY ASSETS WITH A POOL, which is Stellar's rule and its reasoning: "submitting thousands of dead
// tickers would bury the pages that matter and looks like spam". The ledger carries ~20,000 tokens;
// a few hundred of them trade.
//
// THE POOL PAGES THEMSELVES ARE LISTED TOO (added 2026-10-09). The first version of this walked the
// AMM list and emitted only the two asset urls per row, so /pools/xrpl/id/<account> was in exactly the
// position /trade/xrpl/<asset> had been in before this file existed: real, individually titled pages
// — /pools/xrpl/id/rhWTXC… returns "XRP / RLUSD liquidity pool on the XRP Ledger" — that nothing
// listed. Measured on the deployed sitemap: 199 /pools/stellar/ urls against 0 for XRPL.
//
// Stellar emits both kinds from one pass over its pools (sitemap.xml.js), and at different weights:
// 0.6 for a pool page, 0.7 for an asset page. That split is kept rather than flattened, which is why
// this returns {path, priority} objects instead of bare strings — one upstream call, both lists, the
// same weights Stellar publishes.
//
// The account field is `ammAccount`, read off our own lxapi/xrplpools.js (`acct: String(p.ammAccount
// || '')`) rather than guessed from the url scheme — the proxy is the one place in this repo that is
// known to parse this upstream correctly.
const UP = 'https://api.xrpl.to/api';
const LIMIT = 200;

// A currency is its own code up to three characters and 40 hex characters beyond that. The url uses
// the ticker a reader would recognise, so the hex form is decoded back. Trailing NULs are padding,
// not characters.
function decodeCurrency(c) {
  const s = String(c || '');
  if (!/^[0-9A-Fa-f]{40}$/.test(s)) return s;
  let out = '';
  for (let i = 0; i < 40; i += 2) {
    const b = parseInt(s.slice(i, i + 2), 16);
    if (b) out += String.fromCharCode(b);
  }
  return out;
}

// A url segment has to survive being read back by the asset page, which splits on the LAST dash and
// requires the tail to be an r-address. A ticker containing a dash is therefore fine; one containing
// a slash or a space is not, so anything outside the ledger's own printable range is dropped rather
// than published as a url that 404s.
function usable(code) {
  return !!code && code !== 'XRP' && /^[\x21-\x7E]+$/.test(code) && code.indexOf('/') < 0;
}

// Checked rather than trusted: a malformed account would publish a url that 404s, and a sitemap full
// of 404s is worse than one missing entries. Classic r-address shape, base58 without 0 O I l.
function isAccount(a) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(String(a || ''));
}

export async function xrplSitemapUrls(env) {
  try {
    const headers = { accept: 'application/json' };
    if (env && env.XRPLTO_API_KEY) headers['x-api-key'] = env.XRPLTO_API_KEY;
    const r = await fetch(UP + '/amm?limit=' + LIMIT + '&sort=volume&status=active', {
      headers,
      // Cached by status, never blanket: a 429 or a 5xx frozen at the colo for half an hour would
      // empty the sitemap for everyone behind it.
      cf: { cacheTtlByStatus: { '200-299': 1800, '300-399': 0, '400-599': 0 }, cacheEverything: true },
    });
    if (!r.ok) return [];
    const d = await r.json();
    const rows = (d && (d.amms || d.rows || d.pools || d.data)) || [];

    const seen = new Set();
    const seenPool = new Set();
    const out = [];
    for (const p of rows) {
      // The pool's own page. One url per AMM account, and the account is the whole identity here —
      // unlike Stellar, where a pool is named by its two sides and needs a canonical ordering to stop
      // the same pool appearing twice.
      const acct = (p && p.ammAccount) || '';
      if (isAccount(acct) && !seenPool.has(acct)) {
        seenPool.add(acct);
        out.push({ path: '/pools/xrpl/id/' + acct, priority: '0.6' });
      }
      // The upstream has used more than one shape for a pool's two sides; take whichever is present
      // rather than assuming, and ignore anything that is not a token with an issuer.
      for (const a of [p && p.asset, p && p.asset2, p && p.a1, p && p.a2]) {
        if (!a) continue;
        const issuer = a.issuer || a.i || '';
        const code = decodeCurrency(a.currency || a.c || '');
        if (!issuer || !usable(code)) continue;
        const seg = code + '-' + issuer;
        if (seen.has(seg)) continue;
        seen.add(seg);
        out.push({ path: '/trade/xrpl/' + encodeURIComponent(seg), priority: '0.7' });
      }
    }
    return out;
  } catch (e) {
    // A sitemap missing these urls is recoverable; a sitemap that 500s is not.
    return [];
  }
}
