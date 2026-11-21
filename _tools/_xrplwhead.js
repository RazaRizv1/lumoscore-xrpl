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

// ---- the third chip state: connected, but on another network -------------------------------------
//
// This fork's container holds a FROZEN copy of Stellar's header script, so the fix made in Stellar's
// _wallet_header.js does not arrive here on its own — it has to be re-applied as rewrites, below.
//
// The bug: `on` was `!!(wallet||addr)`, and localStorage is shared across every chain on the combined
// site. A visitor connected on Stellar who opened an XRPL page got a chip showing their G… address,
// their Freighter mark and a green connected dot, under an "XRP Ledger" label, with a copy button
// that handed out the foreign address. Measured on staging d63cdcae in both directions.
//
// The chain is read from <html data-lx-wallet-chain>, which the lx-wrongchain layer in <head> has
// already resolved. NOT from lumos.network: that key still holds the pre-multichain value "mainnet"
// for anyone who connected before the rework and never self-heals, so comparing it to a chain name
// would strip the chip from the oldest users. One resolver, one answer — or the chip contradicts the
// notice three lines below it.
const FC_HEAD = 'var wallet=ls("lumos.wallet"),addr=ls("lumos.address");'
  + 'var LXCH={stellar:"Stellar",xrpl:"XRP Ledger",near:"NEAR",arc:"Arc",hedera:"Hedera"};'
  + 'var fc="";try{var _d=document.documentElement;'
  + 'if(_d.classList.contains("lx-wrongchain")&&addr){var _n=_d.getAttribute("data-lx-wallet-chain")||"";'
  + 'fc=_n?(LXCH[_n]||_n):"";}}catch(_e){}'
  // addr is dropped for the whole render pass, so nothing downstream writes the foreign address into
  // .lx-tw-addr or re-points a data-copy at it.
  + 'if(fc)addr=null;'
  + 'var on=!!(wallet||addr)&&!fc;mobileMenu(on,addr,fc);';

// Two earlier versions of this branch shipped and are no longer written out anywhere: the normalise
// step in the page loop strips whatever is there before the rule re-applies, so no version history
// is kept here. For the record, V1 added lx-tw-disc — the Launch App pill's class — and so rendered
// 178x42 at 19.8px bold white. RAZA, 2026-11-14: "just look at how it messed up top right side".
// A statement of fact had become the loudest call to action on the page.
//
// The current version MUTATES the existing chip rather than replacing its markup: same pill, same size, same font —
// only the text, the copy button and the dot change. data-lxorig / data-lxdisc are still set so the
// restore path in the if(on) branch puts the original markup back verbatim when a wallet for THIS
// chain connects. The class is deliberately NOT added; that was the whole bug.
const FC_RENDER = 'else if(fc){if(chip.getAttribute("data-lxorig")==null)chip.setAttribute("data-lxorig",chip.innerHTML);'
  + 'chip.setAttribute("data-lxdisc","1");'
  // Clear the Launch App pill state explicitly — something else puts the chip into it during load,
  // and .lx-tw-disc carries !important background/border/colour plus padding:0 22px and centring.
  + 'chip.classList.remove("lx-tw-disc");'
  + 'chip.style.removeProperty("background");chip.style.removeProperty("border-color");chip.style.removeProperty("color");'
  + 'chip.setAttribute("title","Connected on "+fc+" ' + B + 'u2014 switch wallets to use this network.");'
  + 'var fae=chip.querySelector(".lx-tw-addr");'
  + 'if(fae){fae.textContent="On "+fc;fae.style.setProperty("opacity",".7");}'
  + 'else{chip.innerHTML=\'<span class="lx-tw-addr" style="opacity:.7">On \'+fc+\'</span>\';}'
  + 'var fcp=chip.querySelector(".lx-tw-copy");if(fcp)fcp.style.setProperty("display","none","important");'
  + 'var fcs=chip.querySelectorAll("[data-copy]");for(var fi=0;fi<fcs.length;fi++)fcs[fi].removeAttribute("data-copy");'
  + 'var fdt=chip.querySelector(".lx-tw-dot");if(fdt)fdt.style.setProperty("background","#8a8fa3","important");}';

const DISC = 'else{if(chip.getAttribute("data-lxorig")==null)chip.setAttribute("data-lxorig",chip.innerHTML);'
  + 'chip.setAttribute("data-lxdisc","1");chip.classList.add("lx-tw-disc");'
  + 'chip.setAttribute("title","Launch the app");'
  + 'chip.style.setProperty("background","#ea6a2c","important");'
  + 'chip.style.setProperty("border-color","#ea6a2c","important");'
  + 'chip.style.setProperty("color","#fff","important");'
  + 'chip.innerHTML=\'<span class="lx-tw-cbtn">Launch App\'+ARROW+\'</span>\';}}';

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
  // ---- REVERT of the wrong-network chip ------------------------------------------------------------
  //
  // RAZA, 2026-11-14: "You need to show the exact same thing that you're showing on dashboard header
  // even when we open any other network pages." The header shows the connected wallet on every page,
  // whatever chain the page is for. Naming the chain is the BODY NOTICE's job — lx-wrongchain already
  // says "View only mode. You are currently connected to Stellar…" and links to the right page.
  //
  // These rules carry the containers back to the stock forms. The `else if(fc){…}` branch itself is
  // removed by the normalise step in the page loop, so it needs no rule here. Do not reintroduce a
  // connected test: NEAR's fork had one and it rendered "Launch App" at a connected visitor while
  // hiding the Disconnect control.
  [
    [FC_HEAD],
    'var wallet=ls("lumos.wallet"),addr=ls("lumos.address");var on=!!(wallet||addr);mobileMenu(on,addr);',
    'the connected test',
  ],
  [
    ['if(!chip){mobileLaunch(on||!!fc);'],
    'if(!chip){mobileLaunch(on);',
    'the mobile launch pill',
  ],
  [
    ['function mobileMenu(on,addr,fc){try{'],
    'function mobileMenu(on,addr){try{',
    'the mobile menu signature',
  ],
  [
    ['for(var i=0;i<los.length;i++)los[i].style.display=(on||fc)?"":"none";'],
    'for(var i=0;i<los.length;i++)los[i].style.display=on?"":"none";',
    'the mobile disconnect control',
  ],
  [
    ['if(mn)mn.textContent=fc?"Wrong network":(on&&addr?trunc(addr):(on?"":"Not connected"));'],
    'if(mn)mn.textContent=on&&addr?trunc(addr):(on?"":"Not connected");',
    'the mobile account name',
  ],
  [
    ['if(ms)ms.textContent=fc?("Connected on "+fc):(on?("Connected ' + B + 'u00b7 "+netLabel()):"Tap to connect a wallet");'],
    'if(ms)ms.textContent=on?("Connected ' + B + 'u00b7 "+netLabel()):"Tap to connect a wallet";',
    'the mobile account sub',
  ],
  [
    ['if(row&&row.style)row.style.display=(on||fc)?"":"none";'],
    'if(row&&row.style)row.style.display=on?"":"none";',
    'the mobile account row',
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

    // NORMALISE FIRST: strip any previously-applied wrong-network branch, whatever version it is,
    // so the rule below always rewrites from the single baseline form [DISC]. Without this, every
    // revision of that branch has to be kept in the rule's "may start from" list for ever — and the
    // list is exact strings, so one stale entry means the rule silently misses and ships the old
    // markup. The branch is delimited exactly: it starts at `else if(fc){` and ends where the
    // Launch App `else{` begins, which is a string this file already owns.
    const fcAt = p.indexOf('else if(fc){');
    if (fcAt >= 0) {
      const discAt = p.indexOf('else{if(chip.getAttribute("data-lxorig")', fcAt);
      if (discAt > fcAt) p = p.slice(0, fcAt) + p.slice(discAt);
    }

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
