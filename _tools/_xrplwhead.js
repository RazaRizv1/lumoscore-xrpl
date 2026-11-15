// The header's wallet chip: the right chain's name, and the right chain's mark.
//
// RAZA, 2026-09-08, on the dashboard: "Also, it says Aptos there."
//
// It does. The container carries a header script (`lx-whead`) that names the connected network, and
// three things in it are wrong on this fork — all inherited, none of them caught by a copy sweep,
// because none of the offending text is in the markup. Measured on the built dashboard:
//
//   1. `var NET="aptos"` is the fallback when localStorage has no `lumos.chain`. A browser that has
//      never connected — or connected before that key existed — renders the account menu as
//      "Gem · Aptos". That is RAZA's report, reproduced: a fresh profile, mobile width, connected.
//   2. `netLabel()` is `n.charAt(0).toUpperCase()+n.slice(1)`, so even the CORRECT stored value
//      produces "Xrpl". The fork's own connect flow writes `lumos.chain = 'xrpl'`, so this is what
//      the header says after a real GemWallet connect: "Gemwallet · Xrpl".
//   3. `NETLOGO` is hardcoded to `/assets/tokens/xlm.png` — Stellar's mark, set as the avatar's
//      background on every page of an XRP Ledger site.
//
// A stale value is handled too, and it is not hypothetical: a browser that used the Stellar site
// first has `lumos.chain = 'stellar'` and would render "Stellar" here. This build serves ONE
// network, so the label is resolved from the chain this build IS, not from whatever a previous
// site left in storage — the value is normalised rather than trusted.
//
// WHY ASSERTED. Each rewrite is an exact string, and a miss is silent: the page keeps working and
// keeps saying "Aptos". So a rewrite that matches neither its original nor its applied form is a
// build failure, not a warning. That is the same discipline as deriving skip-gates from the rule
// table — hand-waved gates in this project have quietly disabled correct rules three times.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// XRP's logo id on xrpl.to, through the same proxy every other token mark on this site uses. Kept
// identical to the one in _xrpldashtop.js on purpose: two marks for the same asset that disagree is
// its own bug.
const XRP_MD5 = '84e5efeb89c4eae8f68188982dc290d8';
const XRP_LOGO = 'url("/lxapi/xrplthumb?id=' + XRP_MD5 + '&w=64")';

// [ [ forms this may start from ], what it must become, a name for the error ]
//
// The first entry is what the container ships. Any further entries are forms THIS transform has
// produced in the past: a container is not always rebuilt from base between runs, so a rule that
// changes its output has to be able to recognise its own earlier work or it aborts on a page it
// itself wrote.
const RULES = [
  [
    ['var NET="aptos";'],
    'var NET="xrpl";',
    'the network fallback',
  ],
  [
    [
      'function netLabel(){var n=actNet();return n?n.charAt(0).toUpperCase()+n.slice(1):"Stellar";}',
      // superseded: it still trusted a stale `lumos.chain` and rendered "Stellar" here
      'function netLabel(){var n=String(actNet()||"").toLowerCase();'
        + 'return n==="stellar"?"Stellar":"XRP Ledger";}',
    ],
    // This build serves ONE network. A different value in storage is stale state left by an earlier
    // version of this fork, not a network the user is on — and measured, `lumos.chain = "stellar"`
    // made an XRP Ledger dashboard label itself "Stellar". The chain this build IS decides.
    'function netLabel(){return "XRP Ledger";}',
    'the network label',
  ],
  [
    ["var NETLOGO='url(" + '"/assets/tokens/xlm.png"' + ")';"],
    "var NETLOGO='" + XRP_LOGO + "';",
    'the network mark',
  ],
  // The same menu names the WALLET, from a lookup that is keyed on the stored id with the
  // punctuation stripped. It knows "gem"; this fork's connect flow stores the display name
  // "GemWallet", which normalises to "gemwallet" and misses — so the entry falls through to the
  // same naive capitaliser and the menu reads "Gemwallet". It is a product's name, so it is spelled
  // the way the product spells it. "gem" is left in place: it is what the Stellar build stores.
  [
    ['xaman:"Xaman",gem:"Gem",'],
    'xaman:"Xaman",gem:"GemWallet",gemwallet:"GemWallet",',
    'the wallet name',
  ],
  // ---- the Launch App pill: size and position ------------------------------------------------------
  //
  // RAZA, 2026-11-15: "Why does XRPL have smaller button and text on header right". Measured on
  // production, /trade/xrpl against /trade/stellar and /trade/near — the theme toggle is identical
  // on all three (19.6x38); only the pill differs:
  //
  //     label  14.9px  vs  19.8px        padding  0 22px  vs  0 20px
  //     gap     8.8px  vs   8px          order    none    vs  order:1  (toggle sits left)
  //
  // WHY IT DRIFTED. The pill's CSS has exactly one owner, Stellar's _wallet_header.js, and this fork
  // owns no copy of it — connect.js says so at its chip builder: "lx-whead, which this project does
  // not own". The container holds a FROZEN build of it, taken before Stellar's b74e221b (2026-10-30,
  // "match the app header to the landing page") raised the label 13.5px -> 19.8px and added order:1.
  // The frozen copy also predates that Stellar build dropping the 1.1x type scale from this block —
  // it still carries the `/*lxts:1.1*/` marker, which is why the BOX is 10% bigger (22px, 8.8px)
  // while the TEXT is much smaller. Two different vintages in one rule, so neither number matches.
  //
  // NEAR looks correct because its copy was frozen after 2026-10-30. Nothing is wrong with the fork's
  // own code; the layer simply stopped tracking its source, and only a rewrite here re-syncs it.
  //
  // SAFE TO WRITE LITERAL px HERE: _xrpltypescale is deliberately absent from rebuild.js (its note at
  // line 34 — the Stellar base already carries the 1.1x, so re-running yields 1.21x). These values are
  // final and will not be scaled again. They are Stellar's current source values, copied exactly.
  [
    [
      '.lx-topwallet.lx-tw-disc{background:var(--accent,#ea6a2c)!important;'
        + 'border-color:var(--accent,#ea6a2c)!important;color:#fff!important;'
        + 'justify-content:center;padding:0 22px;gap:8.8px}',
    ],
    '.lx-topwallet.lx-tw-disc{background:var(--accent,#ea6a2c)!important;'
      + 'border-color:var(--accent,#ea6a2c)!important;color:#fff!important;'
      + 'justify-content:center;padding:0 20px;gap:8px;order:1}',
    'the launch pill box',
  ],
  [
    [
      '.lx-tw-cbtn{display:inline-flex;align-items:center;gap:8.8px;'
        + 'font:700 14.9px/1 "Hanken Grotesk",system-ui,sans-serif;color:#fff;letter-spacing:.01em}',
    ],
    '.lx-tw-cbtn{display:inline-flex;align-items:center;gap:8px;'
      + 'font:700 19.8px/1 "Hanken Grotesk",system-ui,sans-serif;color:#fff;letter-spacing:.01em}',
    'the launch pill label',
  ],
];

let containers = 0, pages = 0;
const applied = {}, already = {}, missed = {};
for (const r of RULES) { applied[r[2]] = 0; already[r[2]] = 0; missed[r[2]] = 0; }

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let p = json[k];
    // Only the pages that actually carry the header script.
    if (p.indexOf('id="lx-whead"') < 0) continue;

    const before = p;
    for (const [froms, to, name] of RULES) {
      // Checked BEFORE the froms: once a page is already correct there is nothing to rewrite, and a
      // rule whose output happens to contain one of its own inputs would otherwise rewrite forever.
      if (p.indexOf(to) >= 0) { already[name]++; continue; }
      const hit = froms.filter((f) => p.indexOf(f) >= 0);
      if (!hit.length) { missed[name]++; continue; }   // the shape changed — see the note above
      for (const f of hit) p = p.split(f).join(to);
      applied[name]++;
    }
    if (p !== before) { json[k] = p; changed = true; pages++; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

const broken = Object.keys(missed).filter((n) => missed[n] > 0);
if (broken.length) {
  console.error('xrpl wallet header: ABORTED — matched neither the inherited nor the applied form:');
  for (const n of broken) console.error('    ' + n + ' (' + missed[n] + ' page key(s))');
  console.error('  The header script changed upstream. Re-read it in the container and update RULES;'
    + ' leaving it is how the fork ships "Aptos" as the network name.');
  process.exit(1);
}

console.log('xrpl wallet header: ' + pages + ' page key(s) across ' + containers + ' container(s) — '
  + RULES.map((r) => r[2] + ' ' + applied[r[2]] + '/' + already[r[2]] + ' (new/already)').join(', '));
