// One <h1> per page: demote the network-chooser heading to <h2>.
//
// RAZA 2026-10-07, after an audit comparing the two chains page by page. The h1 counts came out:
//
//            Stellar   XRPL
//   Trade       2        1
//   Pools       2        1
//   Bridge      2        1
//   Rewards     2        1
//   LUMOS       2        2     <- the only one this build gets wrong
//
// XRPL IS THE CORRECT ONE ON FOUR OF THOSE FIVE, which is why this file only touches the fifth.
// Stellar's own `_h1fix.js` states the standard — "two h1s means neither is the title" — and then
// does not catch its own Trade, Pools, Bridge or Rewards pages. Matching Stellar here would have
// meant ADDING a second h1 to four pages that are already right, which is copying a fault rather
// than fixing one. Raised with RAZA before touching anything; his call was to fix this build and log
// the Stellar side separately.
//
// WHAT THE DUPLICATE IS. The same thing Stellar's note describes: the heading of the network-chooser
// section, which ships inside `<section class="lx-lp" hidden>`:
//
//   <main class="page"><section class="lx-lp" hidden><h1 class="lx-lp-h">LUMOS</h1>
//   ...
//   <div class="lumos-id"><h1>LUMOS <span class="ticker-pill">$LUMOS</span></h1>
//
// The second is the visible hero and the real title. Hidden or not, the first is in the markup, and a
// crawler reading two h1s has been told the page has no single subject.
//
// SAFE BECAUSE IT IS MEASURED, NOT ASSUMED. Three page keys carry `<h1 class="lx-lp-h">` and on NONE
// of them is it the only h1 — checked against the built output before this was written, and checked
// again at run time below, per page, so a future page that leads with this heading cannot be left
// with no h1 at all.
//
// NOTHING MOVES AND NOTHING RESTYLES: the rule is `.lx-lp-h`, keyed to the class and not to the tag
// (verified — there is no `h1.lx-lp-h` anywhere in the build), and the section is `hidden` regardless.
// This is a tag change and nothing else.
//
// ---- the other half of "one h1 per page": the pages that have NONE (2026-10-09) -------------------
//
// Found while listing the XRPL pool pages in the sitemap. Making 100 of them crawlable is only half a
// job if what a crawler receives has no heading at all. Counted across the built output: exactly six
// files, two base keys, carry no `<h1` whatsoever —
//
//   lumoscore-amm-pool   (plain, dark, mobile)   the pool detail page
//   lumoscore-signin     (plain, light, mobile)
//
// These are precisely the two entries Stellar's `_h1fix.js` gained on 2026-10-08, AFTER this fork
// copied its containers — which is why they are missing here and the two older ones are not. The
// inherited headings came across already localised ("Your XRP Ledger wallet", "LumosCore dashboard"),
// so there is no wrong-chain wording to correct, only an absence to fill.
//
// SAME MECHANISM AS STELLAR, deliberately: a visually-hidden heading, clipped rather than
// `display:none`, because display:none is the one form a crawler is entitled to discount. No visible
// element changes tag — those pages are finalised and their CSS is keyed to the current tags, so
// promoting a real heading would risk restyling a working page to fix a metadata problem.
//
// THE ANCHOR IS <body>, NOT <main>, and that was measured rather than assumed: neither chain's pool
// page has a <main> at all. Stellar's own heading sits immediately after `<body>`, before the
// `<!--lx-menu-->` comment, which is its third fallback anchor doing the work. XRPL's page opens with
// the identical `<body><!--lx-menu-->`, so the same position applies.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);
const OPEN = '<h1 class="lx-lp-h">';

// base page key -> the heading the page should have carried. "XRP Ledger liquidity pool" mirrors
// Stellar's "Stellar liquidity pool" in this build's own words; the sign-in page is chain-neutral and
// keeps Stellar's wording exactly.
const NEEDS_H1 = {
  'lumoscore-amm-pool': 'XRP Ledger liquidity pool',
  'lumoscore-signin': 'Sign in to LumosCore',
};

// Lifted verbatim from _h1fix.js so the two builds hide the heading the same way. Injected only on
// the pages that get a heading: five XRPL pages already carry this rule from the inherited build, and
// the two above carry neither it nor the heading.
const CSS = '<style id="lx-h1-css">'
  + '.lx-srh1{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;'
  + 'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}'
  + '</style>';

function baseKey(key) {
  return key.replace(/\.html$/, '').replace(/-(dark|light|mobile)$/, '');
}

let files = 0, demoted = 0, skipped = 0, added = 0, styled = 0;
const noAnchor = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    if (typeof json[k] !== 'string') continue;
    let h = json[k];
    const before = h;

    // ---- the duplicate ----
    if (h.indexOf(OPEN) >= 0) {
      // The guard: count the h1s that are NOT this one. If there are none, this heading is the page's
      // only subject and demoting it would leave the page with nothing — worse than the duplicate.
      const total = (h.match(/<h1[\s>]/g) || []).length;
      const mine = h.split(OPEN).length - 1;
      if (total - mine < 1) { skipped++; } else {
        h = h.replace(/<h1 class="lx-lp-h">([\s\S]*?)<\/h1>/g, '<h2 class="lx-lp-h">$1</h2>');
        demoted += mine;
      }
    }

    // ---- the missing ones ----
    // Gated on the page having NO h1 at all, not merely on the key being listed: if one of these
    // pages ever gains a real heading, this must stop adding a second rather than quietly recreate
    // the very duplicate the half above exists to remove.
    const title = NEEDS_H1[baseKey(k)];
    if (title && !/<h1[\s>]/.test(h)) {
      const m = h.match(/<body[^>]*>/);
      if (m) {
        const at = h.indexOf(m[0]) + m[0].length;
        h = h.slice(0, at) + '<h1 class="lx-srh1">' + title + '</h1>' + h.slice(at);
        added++;
      } else {
        // Say so rather than pass. A page listed above and left without its heading is the bug this
        // half exists to fix, and it must not report success while leaving it in place.
        noAnchor.push(k);
      }
    }

    // the stylesheet only goes where the hidden heading actually is
    if (h.indexOf('class="lx-srh1"') >= 0 && h.indexOf('id="lx-h1-css"') < 0) {
      const hi = h.indexOf('</head>');
      if (hi >= 0) { h = h.slice(0, hi) + CSS + h.slice(hi); styled++; }
    }

    if (h !== before) json[k] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

if (noAnchor.length) {
  console.error('xrpl h1: NO <body> ANCHOR on -> ' + noAnchor.join(', '));
  process.exit(1);
}
console.log('xrpl h1: ' + demoted + ' duplicate heading(s) demoted to h2 across ' + files + ' container(s)'
  + '; ' + added + ' missing heading(s) added, ' + styled + ' stylesheet(s) injected'
  + (skipped ? ('; ' + skipped + ' page key(s) left alone — it was their only h1') : ''));
