// The Aptos design strings the picker sweep did not cover — audit items 11-17, and the five more
// that writing this file uncovered.
//
// NOT FORK DRIFT. Measured 2026-10-07: every pattern here exists on STELLAR in identical counts, so
// these are inherited Aptos-template leftovers that both builds carry. The audit filed them under
// "XRPL-only" and that was wrong. Fixing them here is a correction, not a divergence; Stellar's
// copies are logged separately and this file never touches that repo.
//
// ALL OF IT IS REPLACED AT RUNTIME, which is once again why it survived: every check anyone ran was
// on the rendered page. `ltoken.js` builds its own `chain-pill` reading "XRP Ledger"; `bridge.js`
// rewrites the review block; the `lc-*` connect modal holding two of these is dead markup (the live
// one is `lxw-*`, and nothing in this repo references `lc-mfoot` or `lcNetNameDone`). Crawlers, LLMs
// and our own MCP connector read the markup, so the markup has to be right.
//
// THE FIRST VERSION OF THIS FILE ABORTED ON ITS OWN GUARD, and that is the reason the list below is
// longer than the audit's. Sweeping only items 11-17 left `>Aptos` text nodes behind, the guard
// refused to write, and the survivors turned out to include the worst one in the set:
//
//   <h1 class="page-title lx-sronly">Explore the <span class="hl">Aptos</span> DEX</h1>
//
// on the MOBILE Trade page. The desktop hero was corrected earlier the same day and verified by
// fetching /trade/xrpl — which serves the desktop file, because mobile is UA-served. So a phone
// visiting the XRPL Trade page was being handed an h1 naming another chain entirely.
//
// WHAT EACH REPLACEMENT IS ANCHORED TO, because none is a guess:
//
//   11  The LUMOS pool pills carry the chain in their CLASS already (`chain-pill stellar`,
//       `chain-pill xrpl`) and both read "Aptos". LUMOS genuinely exists on both chains, so the
//       text is made to agree with the class the design already assigned. Same for the mobile
//       chart legend's `dot stellar` / `dot xrpl` pair, and the two tooltip rows built in script,
//       which are keyed on the `accent` and `xrplColor` variables respectively.
//   12  `lcNetNameDone` is the network name in the dead modal's "You're connected" state.
//   13  "Powered by Aptos Wallet Standard" is REMOVED, not translated. There is no XRPL equivalent
//       to name, the <a> was already href="#", and carrying no attribution beats inventing one.
//       The footer keeps its other child, so nothing is left empty.
//   14  The bridge's connected chip — same network-name substitution.
//   15  The review block is set to EXACTLY what bridge.js writes in its own empty state: send
//       "0 XRP", recv "—", sendnet "XRP Ledger", recvnet "—" (bridge.js 439-453, nibridge.js
//       2464-2466). Nothing is invented; this file states what the code states. The fabricated
//       "100 BVET" and "~92.0 XRP" go with it, and that is not scope creep — correcting the network
//       alone would leave the page claiming you send 100 BVET *from the XRP Ledger*, a worse
//       sentence than the one it replaces.
//   16  The LUMOS pools table's "Network" column, 22 cells.
//   17  Two HTML comments: a file that describes itself wrongly misleads whoever reads it next.
//   18  The mobile Trade h1 above.
//   19  `asset-overview`'s tag row reads "Aptos XRP Ledger DEX" — an earlier copy pass replaced
//       "Aptos DEX" with "XRP Ledger DEX" and left the leading word, so the fix is to drop it.
//   20  The rewards network chip.
//
// NOT TOUCHED, deliberately:
//   * The 30 `lumoscore-admin-*` page keys. They are thick with this mock, and none of them is
//     built here — `dist/xrpl` contains zero admin files, because the admin panel builds from the
//     STELLAR containers (`extract_site.js aptos --admin`) and ships to its own project. Sweeping
//     them would be edits nothing emits.
//   * Element ids such as `ctPriceAptos`. Script writes to them by name; renaming an id without the
//     reader is how a working chart stops updating.
//   * The mock pair names on the LUMOS page (`LUMOS / APT`, `/ aBTC`, `/ CELL`, `/ GUI`, `/ MESO`,
//     `/ DROP`). Replacing them means choosing pairs, and we have ten real ones in rewards.js's ECO
//     map — but that is RAZA's call, not a sweep's, and the list is rebuilt at runtime regardless.
//
// The baked base64 Aptos marks are stripped wherever they sit beside one of these: both runtime
// owners re-icon those nodes (bridge.js setIcon, ltoken.js's row builder), and a coloured-letter
// fallback beats another chain's logo.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);
const DASH = String.fromCharCode(0x2014);   // em dash, exactly what bridge.js writes
const MID = String.fromCharCode(0x00b7);    // the middle dot in "Aptos · Mainnet"
const XRPL = 'XRP Ledger';

// A string `find` is a literal; a RegExp `find` is used as given. `strip` means "nothing left to
// strip is fine"; `removal` means the done-state is an absence.
// ORDER MATTERS ONLY FOR THE STRIPS, which are anchored on text the later rules rewrite.
const RULES = [
  { id: '15 logo', find: /<img\s+src="data:image[^"]*"[^>]*>(?=<\/span><span class="am" data-rv="send">)/g, repl: '', strip: true },
  { id: '16 logo', find: /<img\s+src="data:image[^"]*"[^>]*>(?=<\/span>\s*Aptos<\/span><\/td>)/g, repl: '', strip: true },
  { id: '14 logo', find: /<img\s+src="data:image[^"]*"[^>]*>(?=<\/span><span class="nm">Aptos<\/span>)/g, repl: '', strip: true },
  { id: '20 logo', find: /<img\s+src="data:image[^"]*"[^>]*>(?=<\/span>Aptos<span class="cdot">)/g, repl: '', strip: true },

  { id: '11 pill-stellar', find: '<span class="chain-pill stellar">Aptos</span>', repl: '<span class="chain-pill stellar">Stellar</span>' },
  { id: '11 pill-xrpl', find: '<span class="chain-pill xrpl">Aptos</span>', repl: '<span class="chain-pill xrpl">' + XRPL + '</span>' },
  { id: '11 legend-stellar', find: '<span class="dot stellar"></span>Aptos</span>', repl: '<span class="dot stellar"></span>Stellar</span>' },
  { id: '11 legend-xrpl', find: '<span class="dot xrpl"></span>Aptos</span>', repl: '<span class="dot xrpl"></span>' + XRPL + '</span>' },
  { id: '11 tooltip-stellar', find: /(accent \+ '"><\/span>' \+\s*'<span class="ct-name">)Aptos/g, repl: '$1Stellar' },
  { id: '11 tooltip-xrpl', find: /(xrplColor \+ '"><\/span>' \+\s*'<span class="ct-name">)Aptos/g, repl: '$1' + XRPL },

  { id: '12 netname', find: '<span id="lcNetNameDone">Aptos</span>', repl: '<span id="lcNetNameDone">' + XRPL + '</span>' },
  { id: '13 attribution', find: '<span class="lc-mfoot-attr">Powered by <a href="#">Aptos Wallet Standard</a></span>', repl: '', removal: true },
  { id: '14 chip', find: '<span class="nm">Aptos</span><span class="st">Connected</span>', repl: '<span class="nm">' + XRPL + '</span><span class="st">Connected</span>' },

  { id: '15 sendnet', find: 'data-rv="sendnet">Aptos<', repl: 'data-rv="sendnet">' + XRPL + '<' },
  { id: '15 send', find: 'data-rv="send">100 BVET<', repl: 'data-rv="send">0 XRP<' },
  { id: '15 recv', find: 'data-rv="recv">~92.0 XRP<', repl: 'data-rv="recv">' + DASH + '<' },
  { id: '15 recvnet', find: 'data-rv="recvnet">XRP Ledger<', repl: 'data-rv="recvnet">' + DASH + '<' },

  // The "Network" column. Matched on "> Aptos</span></td>" rather than on the preceding </span>,
  // because 22 of the 28 cells close an <img> wrapper and the other 6 close an inline <svg> — the
  // narrower form silently left those six saying Aptos.
  { id: '16 cell', find: '> Aptos</span></td>', repl: '> ' + XRPL + '</span></td>' },
  { id: '22 cmp-row', find: '</span></span> Aptos</div>', repl: '</span></span> ' + XRPL + '</div>' },
  // The holder rows: "Aptos · 1.12% of supply" and "Aptos · 1.12%". The leading space is what keeps
  // this off rule 21's ">Aptos · Mainnet<", which has none.
  { id: '23 holder-chain', find: '> Aptos ' + MID + ' ', repl: '> ' + XRPL + ' ' + MID + ' ' },

  // The addr-row network label, which the design indents across three lines:
  //   </span>\n   </span>\n   Aptos\n   </span>\n   <span class="addr-value">…
  // Anchored on the addr-value span that follows rather than on the whitespace, which differs
  // between the desktop and phone templates.
  { id: '31 addr-chain', find: /Aptos(\s*<\/span>\s*<span class="addr-value)/g, repl: XRPL + '$1' },

  { id: '24 aria-amm', find: 'aria-label="Aptos AMM"', repl: 'aria-label="' + XRPL + ' AMM"' },
  { id: '25 aria-dex', find: 'aria-label="Aptos DEX"', repl: 'aria-label="' + XRPL + ' DEX"' },
  // "View on Explorer" is already the wording this build ships elsewhere (4 occurrences in
  // _tools/browser). Not "View on Bithomp", though Bithomp is our explorer: every one of these
  // anchors is href="#", and naming a destination a dead link does not reach is worse than not
  // naming one. The dead href is logged separately.
  { id: '26 explorer', find: 'View on Aptos Explorer', repl: 'View on Explorer' },
  { id: '27 issuance-fee', find: 'One-time Aptos asset issuance fee', repl: 'One-time ' + XRPL + ' asset issuance fee' },
  // Visible asset-description prose. The trailing asset is corrected in a second rule that runs
  // after this one, so it can anchor on the already-corrected sentence.
  { id: '28 dex-name', find: 'Aptos Decentralized Exchange', repl: XRPL + ' DEX' },
  { id: '29 against-native', find: XRPL + ' DEX against APT.', repl: XRPL + ' DEX against XRP.' },
  // The inherited signin's wallet-kit label, written into #walletKit on load. All three entries get
  // the same value: this build only ever connects XRPL wallets, and the default path is sw("hedera")
  // — so leaving the other two would have shown "Aptos Wallet Standard" on first paint. The four
  // names are read off this page's own wallet grid, not chosen here.
  {
    id: '30 signin-kit',
    find: 'var L={hedera:"Aptos Wallet Standard",stellar:"Aptos Wallet Standard",xrpl:"Xaman ' + MID + ' Aptos"}',
    repl: 'var L={hedera:"Xaman ' + MID + ' GemWallet ' + MID + ' Crossmark ' + MID + ' WalletConnect",'
      + 'stellar:"Xaman ' + MID + ' GemWallet ' + MID + ' Crossmark ' + MID + ' WalletConnect",'
      + 'xrpl:"Xaman ' + MID + ' GemWallet ' + MID + ' Crossmark ' + MID + ' WalletConnect"}',
  },

  { id: '17 comment-a', find: '<!-- Aptos ' + DASH + ' Trading Activity -->', repl: '<!-- ' + XRPL + ' ' + DASH + ' Trading Activity -->' },
  { id: '17 comment-b', find: '<!-- New Mints on Aptos -->', repl: '<!-- New Mints on the ' + XRPL + ' -->' },

  { id: '18 mobile-h1', find: 'Explore the <span class="hl">Aptos</span> DEX', repl: 'Explore the <span class="hl">' + XRPL + '</span> DEX' },

  { id: '19 ovtag-dex', find: '<span class="ov-tag">Aptos XRP Ledger DEX</span>', repl: '<span class="ov-tag">' + XRPL + ' DEX</span>' },
  { id: '19 ovtag', find: '<span class="ov-tag">Aptos</span>', repl: '<span class="ov-tag">' + XRPL + '</span>' },
  { id: '19 abouttag-dex', find: '<span class="about-tag">Aptos XRP Ledger DEX</span>', repl: '<span class="about-tag">' + XRPL + ' DEX</span>' },
  { id: '19 abouttag', find: '<span class="about-tag">Aptos</span>', repl: '<span class="about-tag">' + XRPL + '</span>' },

  { id: '20 rewards-chip', find: '</span>Aptos<span class="cdot"></span>', repl: '</span>' + XRPL + '<span class="cdot"></span>' },

  // asset-overview's network badge, in both the desktop badge and the phone's spec row. No runtime
  // owner — checked: nothing in _tools/browser substitutes on "Mainnet" or on these classes.
  { id: '21 chain-badge', find: '>Aptos ' + MID + ' Mainnet<', repl: '>' + XRPL + ' ' + MID + ' Mainnet<' },
];

// NOT SWEPT, and the second of these is the important one.
//
// `lumoscore-admin-*` (30 keys): not built from this repo at all. `dist/xrpl` contains zero admin
// files, because the admin panel builds from the STELLAR containers (`extract_site.js aptos
// --admin`) and ships to its own project. Editing them here changes nothing anyone serves.
//
// `lumoscore-launch-confirm*` and `lumoscore-launch-review*`: THEIR APTOS PLACEHOLDERS ARE
// LOAD-BEARING. `launchpad.js`'s paintConfirm() fills that page by replacing known placeholder
// STRINGS in its text nodes rather than by selector — its own comment explains why, the nodes move
// — and the list it matches on is ['Aptos Coin' -> the token's name], ['APT / APT pool'],
// ['APT/APT pool'], /· n APT/ and /\bAPT\b/ -> the ticker. Sweeping "Aptos Coin" to anything would
// leave that substitution matching nothing, and the launch confirmation would stop naming the token
// the user just minted. Fixing these means editing the markup and that pairs list together, in one
// change, with the mint flow exercised afterwards — not in a text sweep. Logged for RAZA instead.
const SKIP = (key) => key.indexOf('lumoscore-admin') === 0
  || key.indexOf('lumoscore-launch-confirm') === 0
  || key.indexOf('lumoscore-launch-review') === 0;

const count = (h, find) => (find instanceof RegExp
  ? (h.match(find) || []).length
  : h.split(find).length - 1);

const applied = {};
const problems = [];
const staged = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  if (!fs.existsSync(file)) { problems.push(file + ': missing'); continue; }
  const data = read(file);
  let json, s, e;
  try { ({ json, s, e } = getContents(data)); } catch (err) { problems.push(file + ': ' + err.message); continue; }

  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string' || SKIP(key)) continue;
    let h = json[key];
    const before = h;
    for (const r of RULES) {
      const n = count(h, r.find);
      if (!n) continue;
      h = (r.find instanceof RegExp) ? h.replace(r.find, r.repl) : h.split(r.find).join(r.repl);
      applied[r.id] = (applied[r.id] || 0) + n;
      touched += n;
    }
    if (h !== before) json[key] = h;
  }
  staged.push({ file, data, s, e, json, touched });
}

// Silence is the failure mode this guards against: a renamed class or a re-indented template would
// leave the sweep matching nothing, reporting success, and shipping the Aptos strings anyway.
if (!problems.length) {
  const live = staged.map((st) => Object.keys(st.json)
    .filter((k) => typeof st.json[k] === 'string' && !SKIP(k))
    .map((k) => st.json[k]).join('')).join('');

  for (const r of RULES) {
    if (applied[r.id] || r.strip) continue;
    if (r.removal) {
      // The MARKUP form, not the class name: `.lc-mfoot-attr a { ... }` stays in the stylesheet
      // after the span is gone, and checking for the bare class made the second run abort on a
      // page that was already correct.
      if (live.indexOf('<span class="lc-mfoot-attr">') >= 0) problems.push(r.id + ': still present after the pass');
      continue;
    }
    const done = (r.find instanceof RegExp) ? null : r.repl;
    if (done && live.indexOf(done) < 0) {
      problems.push(r.id + ': neither the Aptos form nor the fixed form found — did the markup move?');
    }
  }
  // Any surviving Aptos TEXT NODE or visible ATTRIBUTE in a page this file is responsible for means
  // a rule is missing. Both guards were widened after they let something through:
  //   * ">Aptos" alone missed "> Aptos</span></td>" — six table cells behind an inline <svg>.
  //   * text-only missed title="One-time Aptos asset issuance fee" and two aria-labels.
  // Deliberately NOT a bare /Aptos/: the rewards sentence "Aptos distributions are anchored to this
  // same contract" is excluded on purpose (see the report — it needs a rewrite, not a swap, because
  // "contract" is Stellar/EVM wording that is wrong on this ledger either way), and so are this
  // repo's own source comments, which mention the mock they exist to describe.
  const leftText = live.match(/>\s*Aptos[^<]{0,30}/g) || [];
  if (leftText.length) {
    problems.push(leftText.length + ' Aptos text node(s) survive: '
      + [...new Set(leftText)].slice(0, 6).map((x) => JSON.stringify(x.trim())).join(', '));
  }
  const leftAttr = live.match(/(?:aria-label|title|data-tooltip|alt|placeholder)="[^"]*Aptos[^"]*"/g) || [];
  if (leftAttr.length) {
    problems.push(leftAttr.length + ' Aptos attribute(s) survive: '
      + [...new Set(leftAttr)].slice(0, 4).map((x) => JSON.stringify(x)).join(', '));
  }
}

if (problems.length) {
  console.error('xrpl aptos sweep: ABORT ' + DASH + ' nothing written.');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

const total = Object.keys(applied).reduce((n, k) => n + applied[k], 0);
console.log('xrpl aptos sweep: ' + total + ' replacement(s)'
  + (total ? ' ' + DASH + ' ' + Object.keys(applied).map((k) => k + ':' + applied[k]).join(', ') : ' (already clean)'));
