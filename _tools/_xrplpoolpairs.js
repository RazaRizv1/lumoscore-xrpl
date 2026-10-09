// Build-time map: XRPL AMM account -> the pair it holds, for the pool page's <title>.
//
// WHY THIS IS A BAKED MAP AND NOT AN EDGE LOOKUP. `/pools/<chain>/id/<account>` is served with a
// title that names the account and not the pair -- "Liquidity pool rhWTXC…tcS3 on the XRP Ledger" --
// and `poolIdSeo()` in Stellar's extract_site.js says exactly why: "the edge does not know it without
// a lookup, and a title that guesses is worse than one that is merely general". That objection is
// about guessing, not about looking up, and it is answered by knowing the answer in advance:
//
//   AN AMM ACCOUNT'S PAIR NEVER CHANGES. An AMM is created for one asset pair and its pseudo-account
//   exists to hold that pair; there is no operation that repoints an existing AMM at different
//   assets. So a map built at build time can be INCOMPLETE but it cannot be WRONG, which is the
//   property that makes baking it safe where guessing would not be.
//
// The alternative, a subrequest per pool page, would add latency to every render, a dependency on a
// third party being up at read time, and a failure path that has to fall back to this title anyway.
//
// WHY 500 AND NOT ALL OF THEM. The upstream reports 31,378 AMMs. That map would be megabytes of
// object literal parsed on every isolate start, against a 10ms CPU budget, to serve titles for pools
// nobody visits. 500 is five pages at the upstream's 100-row cap, ordered by volume, and the sitemap
// lists only the top 100 -- so every page a crawler is pointed at is covered several times over, and
// a direct visit to something deeper still gets the account-named title it gets today.
//
// NEVER WRITE AN EMPTY MAP OVER A GOOD ONE. A failed fetch here must not silently blank the titles
// for the whole next deploy; it exits non-zero and leaves the previous file exactly as it was.
//
// A PARTIAL RUN IS A GOOD RUN, and the first version of this got that wrong: it fetched four pages,
// took a 429 on the fifth, threw away all 400 pairs it already had and wrote nothing. The upstream's
// rate limit is tight enough that a full five pages is not reliably available, so a page that fails
// now stops the walk and keeps what came before it.
//
// AND THE RESULT IS UNIONED WITH THE PREVIOUS FILE, which is sound for exactly the reason the whole
// approach is: a pair never changes, so an entry written by an earlier run cannot have gone stale.
// Coverage therefore only ever grows, and a rate-limited build cannot shrink it.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'poolpairs.generated.json');
const UP = 'https://api.xrpl.to/api/amm';
const PAGE = 100;          // the upstream's cap: limit=200 returns 100
const PAGES = 5;           // 500 pools, by volume

// A User-Agent is mandatory on this upstream -- without one it refuses.
const HEADERS = {
  accept: 'application/json',
  'User-Agent': 'LumosCore-build/1.0 (+https://lumoscore.com)',
};

// A currency is its own code up to three characters and 40 hex characters beyond that. Trailing NULs
// are padding, not characters. Same decoder as functions/_xrplsitemap.js, deliberately: the two must
// agree on what a token is called or the sitemap and the title would disagree.
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

// The native side comes back as currency "XRP" with issuer "XRPL".
function sideName(a) {
  if (!a) return '';
  const cur = decodeCurrency(a.currency || a.c || '');
  if (!cur) return '';
  if (cur === 'XRP' && (!a.issuer || a.issuer === 'XRPL')) return 'XRP';
  return cur;
}

// Rendered into a <title>, so it has to be plain text. Anything outside the printable range, or a
// character that would need escaping, means this pool keeps the account-named title rather than
// getting a mangled one.
function usableName(n) {
  return !!n && n.length <= 24 && /^[\x20-\x7E]+$/.test(n) && !/[<>&"']/.test(n);
}

function isAccount(a) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(String(a || ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THIS UPSTREAM RATE-LIMITS, and five pages back to back trips it: the first run of this tool took a
// 429 on page 2. Pages are spaced, and a 429 is waited out rather than treated as a failure — it is
// a "come back later", and the whole point of the guard below is that we do not write a short map.
// Anything that is not a 429 fails immediately; retrying a 500 in a build is just a slower failure.
async function getPage(offset) {
  const url = UP + '?limit=' + PAGE + '&offset=' + offset + '&sort=volume&status=active';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: HEADERS });
    if (r.ok) return r.json();
    if (r.status !== 429) throw new Error('upstream ' + r.status + ' at offset ' + offset);
    const wait = 3000 * (attempt + 1);
    console.log('  429 at offset ' + offset + ' — waiting ' + (wait / 1000) + 's');
    await sleep(wait);
  }
  throw new Error('upstream still rate-limiting at offset ' + offset + ' after 4 attempts');
}

(async () => {
  const map = {};
  let fetched = 0, stoppedBy = '';
  for (let p = 0; p < PAGES; p++) {
    if (p) await sleep(1500);
    let d;
    try {
      d = await getPage(p * PAGE);
    } catch (err) {
      // Keep the pages already in hand -- see the note above. Reported, never swallowed.
      stoppedBy = err.message;
      break;
    }
    // The upstream names this array `pools` on the paged endpoint; the other keys are what older
    // shapes used. Taking whichever is present is how functions/_xrplsitemap.js reads it too.
    const rows = (d && (d.pools || d.amms || d.rows || d.data)) || [];
    if (!rows.length) break;
    fetched += rows.length;
    for (const row of rows) {
      const acct = row && row.ammAccount;
      if (!isAccount(acct) || map[acct]) continue;
      const a = sideName(row.asset1 || row.asset || row.a1);
      const b = sideName(row.asset2 || row.a2);
      if (!usableName(a) || !usableName(b)) continue;
      map[acct] = a + ' / ' + b;
    }
    if (rows.length < PAGE) break;
  }

  const fresh = Object.keys(map).length;
  // A run that produced almost nothing is a failed run wearing a success's clothes. The floor is
  // deliberately well under one page, so a genuinely smaller upstream does not trip it.
  if (fresh < 50) {
    throw new Error('only ' + fresh + ' pair(s) resolved from ' + fetched + ' row(s)'
      + (stoppedBy ? ' (' + stoppedBy + ')' : '') + ' — refusing to write');
  }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const merged = Object.assign({}, prev, map);     // a pair never changes, so new wins harmlessly
  // Sorted, so a rebuild that changes nothing produces a byte-identical file and an empty diff.
  const sorted = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n', 'utf8');
  console.log('xrpl pool pairs: ' + Object.keys(sorted).length + ' pair(s)'
    + ' (' + fresh + ' fetched from ' + fetched + ' row(s), was ' + Object.keys(prev).length + ')'
    + (stoppedBy ? ' — walk stopped early: ' + stoppedBy : '')
    + ' -> ' + path.basename(OUT));
})().catch((e) => {
  console.error('xrpl pool pairs: ' + e.message + ' — previous file left in place');
  process.exit(1);
});
