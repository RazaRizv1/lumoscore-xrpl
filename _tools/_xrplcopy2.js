// Correct wrong-chain COPY in the static markup, site-wide.
//
// The runtime layers fix the copy on the elements they own, but a lot of the design's prose lives in
// modals, popups and cards that no data layer touches — so it was only discovered by opening things:
// "Launch tokens on the Aptos DEX", "Assets on Aptos" in the search popup, "Initialize a new pool on
// Aptos AMM", "Connected · Aptos" in the wallet menu. A sweep of VISIBLE text misses all of it,
// because none of it is visible until you interact.
//
// WHY A BUILD-TIME PASS IS SAFE HERE, when a blanket find-and-replace over the rendered page would
// not be: live market data never appears in static markup. The XRP Ledger genuinely has a token coded
// XLM whose issuer is named "Stellar Lumens" — both arrive from the API at runtime, so neither can be
// reached from here. Nothing this file touches came from a ledger.
//
// AND WHY THE LIST IS EXPLICIT rather than a regex over every occurrence of "Aptos" or "Stellar":
//
//   * The sign-in network picker legitimately offers Stellar — RAZA asked for Stellar + XRP Ledger
//     as the two networks — so "Stellar" as a NETWORK NAME must survive.
//   * The bridge FAQ deliberately explains that the claim step belongs to Circle's CCTP on the
//     Stellar build; rewriting that sentence would make it nonsense.
//   * Docs and blog posts may discuss other chains on purpose.
//
// So this rewrites named sentences and nothing else. Anything not on the list is left alone, and a
// phrase that stops matching is REPORTED rather than silently skipped — if the design's wording
// changes, the build says so instead of quietly shipping the old chain's name.
//
// Mock NUMBERS ("18 APT", "0.00001 APT") are deliberately not here: those are values, the runtime
// layers overwrite them with real ones, and freezing a different number into the markup would just
// create a second thing to keep in sync.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// from -> to. Longest first so a phrase is never half-rewritten by a shorter one.
const PHRASES = [
  ['Only send APT and Aptos-based assets to this address',
    'Only send XRP and XRP Ledger assets to this address'],
  ['Trustlines let you hold non-native assets on Aptos',
    'Trustlines let you hold issued assets on the XRP Ledger'],
  ['Initialize a new pool on Aptos AMM', 'Initialize a new pool on the XRP Ledger AMM'],
  ['Launch tokens on the Aptos DEX', 'Launch tokens on the XRP Ledger DEX'],
  ['Trade pairs on Aptos DEX', 'Trade pairs on the XRP Ledger DEX'],
  ['Recipient address', 'Recipient address'],                 // untouched; kept as a no-op anchor
  ['Your Aptos address', 'Your XRP Ledger address'],
  ['Assets on Aptos', 'Assets on the XRP Ledger'],
  ['Connected · Aptos', 'Connected · XRP Ledger'],
  // THE LAUNCH SCREENS. "Once your token is minted on the Aptos network" on the review step, and
  // "Your token is now live on the Aptos network" on the confirmation — the two moments where
  // someone has just committed real money to issuing an asset and is being told which chain it
  // landed on. Naming the wrong one there is the worst placement of this mistake on the whole site.
  //
  // The "Aptos Coin ($APT)" placeholders on those same pages are NOT here: the launchpad passes the
  // real name and ticker through localStorage and fills them in, so they are template text, not copy.
  ['on the Aptos network', 'on the XRP Ledger'],
  // A row label on the review step's Additional Liquidity block. Only found by putting a draft in
  // localStorage and actually loading the page — it is not in the empty state.
  ['Extra APT', 'Extra XRP'],

  // The wallet FAQ, which appears on the landing page. Claimable payments are a Stellar feature; on
  // this ledger a payment of an asset you do not trust simply fails, and a Check is the nearest
  // thing — a promise of payment the sender writes, which you cash yourself.
  ['What are claimable payments?', 'What are Checks?'],
  ['A payment someone has sent that is waiting for you to accept, used when it cannot be delivered straight away, usually because you do not hold a trustline for that asset yet. Add the trustline and claim it.',
    'A Check is a promise of payment someone writes to you on the ledger, which you cash yourself when '
    + 'you are ready. It is not the same as a payment being held for you: on the XRP Ledger a payment '
    + 'of an asset you have no trust line for simply fails rather than waiting. Add the trust line '
    + 'first, then cash the Check.'],

  ['Aptos wallet', 'XRP Ledger wallet'],
  ['Aptos DEX', 'XRP Ledger DEX'],
  ['Aptos AMM', 'XRP Ledger AMM'],
  ['on Aptos', 'on the XRP Ledger'],
];

// Elements whose ENTIRE text is a bare network name. Handled separately because replacing the bare
// word everywhere would also hit prose the list above already covers, and network-name pills are the
// only place a lone "Aptos" is meant to be a label.
const BARE = ['sp-filter-pill', 'ad-nm', 'net-tag', 'nx-net', 'lxns-name'];

let files = 0, pages = 0, hits = 0;
const per = {};
const unseen = new Set(PHRASES.map(function (p) { return p[0]; }));

// Rewrite only TEXT between tags: never attributes, never script or style bodies.
function rewriteText(html) {
  let out = '', i = 0, changed = 0;
  const re = /<(script|style)\b[\s\S]*?<\/\1>|<[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(i, m.index);
    const done = applyPhrases(text);
    changed += done.n;
    out += done.s + m[0];
    i = m.index + m[0].length;
  }
  const tail = applyPhrases(html.slice(i));
  changed += tail.n;
  out += tail.s;
  return { html: out, n: changed };
}

// THE GATE IS DERIVED FROM THE RULES, not written by hand.
//
// It was `text.indexOf('Aptos') < 0 -> skip`, which was right until a phrase was added that does not
// contain the word: "Extra APT". The rule was correct, the gate silently skipped every chunk it
// applied to, and the label survived three deploys. That is the THIRD time in this project a
// hand-written fast-path filter has quietly disabled a rule that was right — the docs transform did
// it twice — so this one is computed from PHRASES and cannot drift from them.
//
// Each phrase contributes its first word; a chunk is examined if it contains any of them.
const GATE = (function () {
  const words = new Set();
  for (const [from] of PHRASES) {
    const w = String(from).split(/[^A-Za-z]+/).filter(Boolean)[0];
    if (w) words.add(w);
  }
  return new RegExp([...words].join('|'));
})();

function applyPhrases(text) {
  if (!text || !GATE.test(text)) return { s: text, n: 0 };
  let n = 0, s = text;
  for (const [from, to] of PHRASES) {
    if (from === to) continue;
    if (s.indexOf(from) < 0) continue;
    const parts = s.split(from);
    n += parts.length - 1;
    per[from] = (per[from] || 0) + (parts.length - 1);
    unseen.delete(from);
    s = parts.join(to);
  }
  return { s: s, n: n };
}

// A bare network-name label: <span class="ad-nm">Aptos</span>
function rewriteBare(html) {
  let n = 0, s = html;
  for (const cls of BARE) {
    const re = new RegExp('(<[a-z]+[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>)\\s*Aptos\\s*(<)', 'gi');
    s = s.replace(re, function (m0, open, close) { n++; per['<.' + cls + '>Aptos'] = (per['<.' + cls + '>Aptos'] || 0) + 1; return open + 'XRP Ledger' + close; });
  }

  // THE LABEL IS NOT ALWAYS THE FIRST THING INSIDE THE TAG. The search popup's chain filter is
  //     <button class="sp-filter-pill" data-chain="xrpl"><span class="ch-ico xrpl" …></span> Aptos </button>
  // so the word sits after a nested icon and the rule above — which expects the text immediately
  // after the opening tag — never saw it. The element was already marked data-chain="xrpl"; only its
  // wording disagreed, which is the tell: keying on that marker is exact, because an element the
  // design itself labels as XRPL cannot legitimately be called Aptos.
  // The same trick names the OTHER network correctly too. The multi-chain design used "Aptos" as its
  // placeholder for what is really Stellar, so the sibling pill reads data-chain="stellar" with the
  // label "Aptos" — and Stellar is a network LumosCore genuinely offers, so the fix is to call it
  // Stellar rather than to remove it.
  [['xrpl', 'XRP Ledger'], ['stellar', 'Stellar']].forEach(function (pair) {
    const chain = pair[0], label = pair[1];
    const re = new RegExp('(<button[^>]*data-chain="' + chain + // The window has to clear the icon, which is an inline base64 SVG and can run to a few KB.
      '"[^>]*>)([\\s\\S]{0,6000}?)(<\\/button>)', 'gi');
    s = s.replace(re, function (m0, open, body, close) {
      if (body.indexOf('Aptos') < 0) return m0;
      const fixed = body.replace(/(^|>)([^<]*)\bAptos\b/g, function (x, pre, mid) { return pre + mid + label; });
      if (fixed === body) return m0;
      n++;
      per['data-chain="' + chain + '" label'] = (per['data-chain="' + chain + '" label'] || 0) + 1;
      return open + fixed + close;
    });
  });

  return { html: s, n: n };
}

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const before = json[key];
    if (before.indexOf('Aptos') < 0) continue;
    const a = rewriteText(before);
    const b = rewriteBare(a.html);
    const total = a.n + b.n;
    if (!total) continue;
    json[key] = b.html;
    hits += total;
    pages++;
    changed = true;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl copy pass: ' + hits + ' replacement(s) on ' + pages + ' page key(s) across '
  + files + ' container(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) {
  console.log('   x' + String(per[k]).padStart(4) + '  ' + k.slice(0, 62));
}
// Idempotent, so "unseen" on a second run is expected. It only means something on the FIRST run
// after a base re-copy, which is when a reworded design would show up.
const left = [...unseen].filter(function (p) { return PHRASES.find(function (x) { return x[0] === p; })[1] !== p; });
if (left.length && hits) {
  console.error('  note: these phrases matched nothing this run (already applied, or reworded upstream):');
  for (const p of left) console.error('     ' + p);
}
