// account_tx from the edge, cached, for the dashboard's Platform Activity card.
//
// RAZA 2026-10-18, user report: "On dashboard, platform activity takes extremely long to appear. And
// sometimes it doesnt even load" — with a screenshot of the card reading "Could not read the XRP
// Ledger."
//
// WHAT IT COSTS TODAY. platformSwaps() in dashboard.js reads account_tx on the fee collector, then
// ONE account_tx AT limit 200 PER ACCOUNT that has paid a fee, up to twelve of them. That is up to
// thirteen of the heaviest read the ledger offers, issued from the reader's own browser, against a
// node that meters by UNITS rather than requests (2000 per 10s — see [[xrplcluster-meters-units]]).
// A single dashboard load can spend that budget by itself, and what the node refuses becomes the
// card's "Could not read the XRP Ledger."
//
// AND EVERY VISITOR PAYS IT SEPARATELY FOR THE SAME ANSWER. Platform activity is not personal: it is
// the same list for everyone looking at the dashboard. Thirteen metered calls per visitor, for a
// result that is identical across all of them, is the exact shape xrplparticipants.js was moved here
// to fix — "one call from HERE instead: cached at the edge for everyone looking at the same table,
// off the visitor's IP".
//
// Browser and Worker reach different nodes, and that is not incidental: xrplcluster answers a Worker
// with 418, while Ripple's own nodes refuse the browser cross-origin. So this is also the only side
// from which s1/s2 can be asked at all. Same split as /lxapi/xrplpath.
//
// CACHING IS CORRECT HERE AND WRONG IN xrplpath. A path-find prices one account's swap at one moment
// and must never be shared; a public transaction list is the same for every reader, so 60s of
// sharing costs freshness nobody can perceive and saves thirteen metered reads per visitor.
//
// A FAILURE IS NEVER STORED AS AN ANSWER. Only a real response is cached; an unreachable ledger
// returns 502 and caches nothing, so the next reader retries instead of inheriting the outage for a
// minute. See [[never-cache-a-failure-as-an-answer]].
const RPCS = ['https://s2.ripple.com:51234/', 'https://s1.ripple.com:51234/'];
const TTL = 60;
const ACCT = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const json = (body, secs, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': secs > 0 ? ('public, max-age=' + secs) : 'no-store',
  },
});

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const acct = String(url.searchParams.get('a') || '');
  // Capped at what the caller actually asks for. An unbounded limit is a cost handed to us by
  // whoever calls, and this is a public endpoint.
  const n = Math.min(200, Math.max(1, parseInt(url.searchParams.get('n') || '20', 10) || 20));
  if (!ACCT.test(acct)) return json({ ok: false, error: 'bad account' }, 0, 400);

  // Guarded the way _issuerdomain.js guards it: the Cache API is a runtime feature, and the endpoint
  // must still answer correctly where it is absent rather than throw before reaching the ledger.
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }
  const key = new Request(url.origin + url.pathname + '?a=' + acct + '&n=' + n);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }

  let last = 'ledger unavailable';
  for (const node of RPCS) {
    let r;
    try {
      r = await fetch(node, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'LumosCore/1.0 (+https://lumoscore.com)' },
        body: JSON.stringify({
          method: 'account_tx',
          params: [{ account: acct, limit: n, binary: false, ledger_index_min: -1, ledger_index_max: -1 }],
        }),
      });
    } catch (e) { last = 'ledger unreachable'; continue; }
    if (!r.ok) { last = 'ledger ' + r.status; continue; }
    const j = await r.json().catch(() => null);
    const res = j && j.result;
    if (!res) { last = 'ledger unavailable'; continue; }
    // actNotFound is a real answer about a real account — an account with no history — and every node
    // will say the same. It is not a reason to try the next one, and it caches like any other answer.
    if (res.error && res.error !== 'actNotFound') { last = res.error_message || res.error; continue; }

    const out = json({ ok: true, result: { transactions: res.transactions || [] } }, TTL);
    if (cache && context.waitUntil) context.waitUntil(cache.put(key, out.clone()));
    return out;
  }
  return json({ ok: false, error: last }, 0, 502);
}
