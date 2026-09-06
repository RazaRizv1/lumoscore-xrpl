// AMM pools on the XRP Ledger, for the Pools page.
//
// Replaces `lx-ammdata` (~286KB), which drives four pages and was walking Stellar's Horizon on an
// XRP Ledger site -- the Pools page literally reported "Ranking the network's pools… 7,800 scanned
// so far" while ranking Stellar pools, then rendered TVL in XLM.
//
// RANKED BY VOLUME, NOT LIQUIDITY, and that is a measured decision rather than a preference.
// Asking the upstream for sort=liquidity returns five BITx/… pools each claiming 113,142,29x of
// liquidity and ZERO 24h volume -- nominal value conjured out of a worthless token pairing with
// itself. sort=volume returns XRP/RLUSD, XRP/FUZZY, XRP/ARMY, XRP/USDC: pools people actually
// trade. A "top pools" table sorted by a number anyone can inflate for free is worse than no table.
//
// The response also carries the network-wide summary the page's overview cards need, which comes
// from the same request rather than a second one that could disagree with it.

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

// The upstream marks the native side with issuer "XRPL" and currency "XRP".
function side(a) {
  if (!a) return null;
  return {
    c: String(a.currency || ''),
    i: a.issuer === 'XRPL' ? '' : String(a.issuer || ''),
    v: num(a.value),
    m: String(a.md5 || ''),
  };
}

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
    const r = await upstream('/amm?limit=' + n + '&sort=volume&status=active', env);
    const rows = ((r && r.pools) || []).map((p) => {
      const a = p.apy24h || {};
      return {
        id: String(p._id || ''),
        acct: String(p.ammAccount || ''),
        a1: side(p.asset1), a2: side(p.asset2),
        // tradingFee is in units of 1/1000 of a percent, so 205 is 0.205%.
        fee: num(p.tradingFee) == null ? null : num(p.tradingFee) / 1000,
        liq: num(a.liquidity), vol: num(a.volume), fees: num(a.fees), apy: num(a.apy),
        holders: num(p.lpHolderCount),
        depth: (p.health && p.health.depth) || '',
      };
    });

    const s = (r && r.summary) || {};
    out = {
      ok: true, count: rows.length, total: num(r && r.total),
      summary: {
        liquidity: num(s.totalLiquidity),
        vol24: num(s.totalVolume24h),
        fees24: num(s.totalFees24h),
        avgFee: num(s.avgFee),
      },
      rows,
      src: 'xrpl.to', attribution: 'Data by xrpl.to', attributionUrl: 'https://xrpl.to',
    };
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e), rows: [] }, 30);
  }

  const res = json(out, TTL);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
