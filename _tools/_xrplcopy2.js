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

  // THE TRUSTLINE COST, on the $LUMOS page's own trustline dialog — the one the "LUMOS Trustline
  // gate" opens. It read "Reserves 0.5 APT from your account": another chain's asset AND another
  // chain's number, in the sentence that tells someone what opening a trust line will cost them.
  //
  // 0.2 XRP is the owner-reserve increment, and a trust line is one owned object. Read off the
  // ledger, not from documentation: server_info reports base 1 / inc 0.2 today, and the wallet layer
  // takes the live value for anything it calculates. Only this piece of static prose states it as a
  // constant — if an amendment ever moves it, this line is what goes stale, and it is the reason the
  // figure appears exactly once rather than being repeated across the site.
  ['Reserves 0.5 APT from your account', 'Reserves 0.2 XRP from your account'],

  // A route label in the same dialog family, naming the pay side as Aptos.
  ['APT → LUMOS (Direct)', 'XRP → LUMOS (Direct)'],

  // The design's baked balance, sitting above a MAX button in a dialog that moves money. Blanked
  // rather than invented, exactly as the wallet's own field-label balances were.
  ['Balance: 25,420.18 APT', 'Balance: —'],
  ['Initialize a new pool on Aptos AMM', 'Initialize a new pool on the XRP Ledger AMM'],
  ['Launch tokens on the Aptos DEX', 'Launch tokens on the XRP Ledger DEX'],
  ['Trade pairs on Aptos DEX', 'Trade pairs on the XRP Ledger DEX'],
  ['Recipient address', 'Recipient address'],                 // untouched; kept as a no-op anchor
  ['Your Aptos address', 'Your XRP Ledger address'],
  ['Assets on Aptos', 'Assets on the XRP Ledger'],
  ['Connected · Aptos', 'Connected · XRP Ledger'],
  // THE NETWORK FEE LINE, on 100 blocks across the site. Only the UNIT is wrong: the XRP Ledger's
  // base fee genuinely is 10 drops, which is 0.00001 XRP, so the figure stands and the asset changes.
  //
  // Most of these sit in dialogs a live layer rewrites before anyone reads them — Send and Swap both
  // do. Create Pool does not, and that is where it was caught: "Network fee ~0.00001 APT" on an
  // otherwise clean XRP Ledger dialog. Fixing the literal covers the one that is read and is a no-op
  // wherever a layer would have overwritten it anyway.
  ['~0.00001 APT', '~0.00001 XRP'],
  // The search box's own example query, in its hint row.
  ['asset:APT', 'asset:XRP'],
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

  // FOUND BY SWEEPING THE FIVE PAGES NOBODY HAD LOOKED AT — bridge, launchpad, rewards, $LUMOS and
  // account. Not one of these is visible on load; every one lives in a dialog or a help panel, which
  // is why looking at the pages found nothing and a markup scan found all of it.

  // Bridge, the "how it works" step. Names the source chain as Aptos on an XRP Ledger bridge.
  ['(Aptos and your destination network)', '(the XRP Ledger and your destination network)'],

  // Launchpad, the additional-liquidity help. The page where someone commits real money to an
  // issuance, telling them to add another chain's asset to the pool.
  // BOTH PHRASINGS, because the phone's copy is not the desktop's: "to THE initial liquidity pool"
  // on desktop and "to YOUR initial liquidity pool" on mobile. Fixing one left the other shipping,
  // which is the same mobile-container trap that has caught this project before — the counts said
  // 2 pages fixed and 1 still matching, and that single leftover was the phone.
  ['Add extra APT to the initial liquidity pool', 'Add extra XRP to the initial liquidity pool'],
  ['Add extra APT to your initial liquidity pool', 'Add extra XRP to your initial liquidity pool'],

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

// COPY THAT LIVES INSIDE A SCRIPT, and the narrow exception it needs.
//
// The rule below is "never script bodies", and that is the right default: script text is logic and
// ledger data, and a blanket rewrite there is how a real token coded XLM or an issuer genuinely
// named "Stellar Lumens" would get mangled.
//
// But the $LUMOS trustline dialog is written by the design's OWN script:
//     if (sub) sub.textContent = 'Reserves 0.5 APT from your account';
// so fixing the markup achieved nothing — the script puts the Aptos wording back the moment the
// dialog opens, which is why the phrase survived a pass that reported 74 replacements.
//
// Handled as an explicit list of EXACT QUOTED LITERALS rather than by relaxing the rule: each entry
// includes the surrounding quote characters, so it can only ever match a complete string literal
// that the design authored, never a fragment of an identifier or a value read from an API.
const SCRIPT_LITERALS = [
  ["'Reserves 0.5 APT from your account'", "'Reserves 0.2 XRP from your account'"],
  ['"Reserves 0.5 APT from your account"', '"Reserves 0.2 XRP from your account"'],
];

// [regex with a leading capture group, replacement]. The capture is whatever preceded the match and
// is put back untouched — it exists only to prove the match was not part of a bigger number.
const GUARDED = [
  [/(^|[^0-9.])0\.5 APT/g, '0.2 XRP'],
];

// LITERALS THAT INCLUDE THEIR OWN TAG, because the text alone is too dangerous to match.
//
// The launchpad's amount field carries `<span class="input-suffix">APT</span>` — the UNIT beside a
// box someone types a number into. The text chunk is the three letters "APT", and a phrase rule for
// that would rewrite every APT on the site, including ones inside prose the list above handles
// deliberately. Anchoring to the class turns an unsafe rule into an exact one.
const MARKUP_LITERALS = [
  ['class="input-suffix">APT<', 'class="input-suffix">XRP<'],
];

let markupFixes = 0;

function rewriteMarkupLiterals(html) {
  let h = html;
  for (const [from, to] of MARKUP_LITERALS) {
    if (h.indexOf(from) < 0) continue;
    const parts = h.split(from);
    markupFixes += parts.length - 1;
    h = parts.join(to);
  }
  return h;
}

let scriptFixes = 0;

// Every rule's search string, so the page-level gate above can never skip a page a rule would have
// matched. Built from the rule tables rather than typed out.
const TRIGGERS = PHRASES.map(function (p) { return p[0]; })
  .concat(SCRIPT_LITERALS.map(function (p) { return p[0]; }))
  .concat(MARKUP_LITERALS.map(function (p) { return p[0]; }))
  .concat(['Aptos']);                       // rewriteBare works on the bare word

function rewriteScriptLiterals(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, function (block) {
    let b = block;
    for (const [from, to] of SCRIPT_LITERALS) {
      if (b.indexOf(from) < 0) continue;
      b = b.split(from).join(to);
      scriptFixes++;
    }
    return b;
  });
}

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
  // The GUARDED rules have to feed the gate as well, or a chunk that only one of them matches is
  // skipped before it is ever tested. "0.5 APT" happens to survive today because another phrase
  // contributes the word APT — that is luck, not derivation, and this file's whole point is that a
  // gate which does not come from the rules eventually disagrees with them.
  for (const [re] of GUARDED) {
    const w = String(re.source).split(/[^A-Za-z]+/).filter(Boolean)[0];
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

  // GUARDED RULES, for a phrase that is a SUBSTRING OF A LARGER NUMBER.
  //
  // "Each trustline reserves <strong>0.5 APT</strong> from your account" is real prose on 30 pages,
  // and the figure sits alone inside its own tag — so the text chunk here is exactly "0.5 APT" and
  // a plain rule would fix it. But the same eight characters also occur inside "−340.5 APT", a mock
  // activity amount, three times in MARKUP where a plain rule would reach it and quietly produce
  // "−340.2 XRP" — a corrupted number rather than a corrected one.
  //
  // Measured before writing the rule: 30 standalone, 3 digit-prefixed. Hence the lookbehind-by-hand.
  for (const [re, to] of GUARDED) {
    s = s.replace(re, function (m0, pre) {
      n++;
      per[String(re)] = (per[String(re)] || 0) + 1;
      return pre + to;
    });
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

    // THE OUTER GATE IS DERIVED TOO, and it was not.
    //
    // It read `before.indexOf('Aptos') < 0 -> continue`, which is the exact hand-written gate this
    // file already warns about thirty lines up — the note about "Extra APT" being silently skipped.
    // The warning was written for the INNER gate and the outer one was left as it was, so it stayed
    // a live example of the thing it cautions against: the trustline literal says
    // "Reserves 0.5 APT", with no "Aptos" anywhere in it, so any page carrying that string and not
    // the word would have been skipped without a sound.
    //
    // Now the trigger list comes from the rules themselves and cannot fall out of step with them.
    if (!TRIGGERS.some(function (t) { return before.indexOf(t) >= 0; })) continue;

    // The script-literal count has to travel INTO `total`, not just into the summary line. It did
    // not at first, and `if (!total) continue` then threw the rewritten page away: the build
    // cheerfully reported "+3 in script literals" while writing none of them to disk, because the
    // markup half of that page had nothing left to change.
    const sBefore = scriptFixes, mBefore = markupFixes;
    const withScripts = rewriteMarkupLiterals(rewriteScriptLiterals(before));
    const sDone = (scriptFixes - sBefore) + (markupFixes - mBefore);

    const a = rewriteText(withScripts);
    const b = rewriteBare(a.html);
    const total = a.n + b.n + sDone;
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

console.log('xrpl copy pass: ' + hits + ' replacement(s) (+' + scriptFixes + ' script, +' + markupFixes + ' tag-bound) on ' + pages + ' page key(s) across '
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
