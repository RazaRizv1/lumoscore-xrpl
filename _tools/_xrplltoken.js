// Replace the $LUMOS page's Stellar layer, and repair the ids a blind find-and-replace broke.
//
// TWO PROBLEMS, BOTH PRE-EXISTING.
//
// 1. `lx-ltdata` (~107KB) rendered STELLAR LUMOS on a page titled "LUMOS on the XRP Ledger":
//    $0.00005425, 936 holders, 996.57M circulating, and a row reading "LUMOS/XLM mark". Underneath
//    it the markup still carries the design's MOCK -- $0.00320, 3,208 holders -- which is 93x the
//    real price and is what shows if the script ever fails.
//
// 2. The XRPL containers were produced by a blind "Stellar" -> "XRP Ledger" replacement that hit
//    ATTRIBUTES, not just prose. It left ids containing a space:
//        id="gradXRP Ledger"   fill="url(#gradXRP Ledger)"
//    A fragment reference with a space does not resolve, so the chart's area gradient is simply
//    dead. This is the damage that a hand-written copy table exists to avoid.
//
// Both are fixed here. The id repair is a plain string swap on two pages -- narrow on purpose, since
// renaming ids is exactly the kind of edit that breaks things quietly.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplltoken';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/ltoken.js', 'utf8');
// The chart ships with this page: its SVG was built by lx-ltdata, so stripping that layer left an
// empty box where the chart had been.
const chart = fs.readFileSync(__dirname + '/browser/chart.js', 'utf8');

for (const src of [core, page, chart]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

// Broken -> repaired. Every one of these currently contains a space, which is illegal in an id and
// fatal in a url(#...) reference.
const IDFIX = [
  // JS IDENTIFIERS the blind replace broke. These are not cosmetic: `var pathXRP Ledger = ...` is a
  // hard SyntaxError that kills the entire 17KB script block it sits in, and the console only says
  // "Unexpected identifier 'Ledger'" with no hint where. They were missed at first because that
  // block has no id and the earlier scan only looked at <script id=...>.
  //
  // NOT fixed, deliberately: `APTXRP Ledger` appears 40 times across the build but always inside a
  // COMMENT -- // ticker at a word start (handles "0.2 APTXRP Ledger") -- where it parses fine.
  // Renaming text inside comments would be churn on 40 files to change nothing.
  ['pathXRP Ledger', 'pathXrpl'],
  ['areaXRP Ledger', 'areaXrpl'],
  ['gradXRP Ledger', 'gradXrplArea'],
  ['chartDotXRP Ledger', 'chartDotXrpl2'],
  ['ctPriceXRP Ledger', 'ctPriceXrpl2'],
  ['ctMcXRP Ledger', 'ctMcXrpl2'],
];


// THE FOOTER BUTTON CARRIES A COUNT, so it is data and is gated like data.
//
// The design ships "View all 14 pools" against a real 22, and the health bot measured it:
// 14 held from 563ms, corrected at 903ms. The .lt-cmp-row values beside it were gated all
// along and this one never was, because it reads as a link rather than as a figure. Stellar
// hit the identical bug on its own copy (_lumostoken.js: "the design is 14 against a real 65")
// and gates it exactly this way; the fork inherited neither the rule nor the reveal.
//
// ltoken.js adds .lxlt once paintTabsAndLinks has written a real count, and drops the COUNT
// rather than the button after six seconds if that never happens -- a hidden link is a worse
// trade than a missing number.
const CSS_ID = 'lx-xrplltoken-css';
const STYLE = '<style id="' + CSS_ID + '">'
  + '.lt-cmp-foot:not(.lxlt) button,.lt-cmp-foot:not(.lxlt) a{visibility:hidden}'
  + '</' + 'style>';
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n' + chart + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0, idFixes = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    // The id repair applies wherever the broken ids appear, independently of the data layer.
    for (const [bad, good] of IDFIX) {
      if (h.indexOf(bad) < 0) continue;
      const before = h.split(bad).length - 1;
      h = h.split(bad).join(good);
      idFixes += before;
    }

    if (h.indexOf('lumos-hero-row') < 0 && h.indexOf('lh-stats') < 0) { json[key] = h; continue; }

    const gone = stripById(h, 'lx-ltdata');
    h = gone.html;
    stripped += gone.removed;

    h = stripById(h, ID).html;

    // STRIP EVERY PREVIOUS COPY, NOT THE FIRST ONE, AND WITHOUT A REGEX.
    //
    // This was `new RegExp('<style id="' + CSS_ID + '">[\s\S]*?</style>', 'g')` and it matched
    // nothing: inside a single-quoted string `\s` and `\S` are not escapes, so the class collapsed
    // to [sS] -- a pattern for the letter s. Every run therefore appended another stylesheet, and
    // the containers went 8 -> 12 and 14 -> 21 copies across three runs before the count was
    // checked. stripById does not help here; it removes <script id>, never <style>.
    //
    // The loop also repairs containers that already piled up, because it removes ALL copies rather
    // than one. Indexed string surgery, so there is no escaping layer left to get wrong.
    var openTag = '<style id="' + CSS_ID + '">';
    var closeTag = '</' + 'style>';
    for (;;) {
      const a = h.indexOf(openTag);
      if (a < 0) break;
      const z = h.indexOf(closeTag, a);
      if (z < 0) break;
      h = h.slice(0, a) + h.slice(z + closeTag.length);
    }

    // THE GATE GOES IN THE HEAD, and that is the whole point of it.
    //
    // First attempt put it at the end of body beside the script, and measured on staging the flash
    // got WORSE, not better:
    //     300ms "View all 14 pools →"  ->  600ms HIDDEN  ->  900ms "View all 22 pools →"
    // Three states instead of two. A stylesheet at the end of body does not exist until the parser
    // reaches it, so the mock paints first and then vanishes -- the reader sees the wrong number AND
    // a disappearing control. A rule that hides a baked value has to be in force before that value
    // can paint, which means the head. Stellar's copy does exactly this for the same reason.
    //
    // The body fallback stays for a page with no </head>, where late is still better than never.
    const hi = h.indexOf('</' + 'head>');
    if (hi >= 0) h = h.slice(0, hi) + STYLE + h.slice(hi);

    // Recomputed AFTER the head insert: the earlier splice shifts every offset after it, and a
    // stale index here would splice the script into the middle of the document.
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + (hi >= 0 ? '' : STYLE) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl $LUMOS: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar layer from ' + stripped
  + '; repaired ' + idFixes + ' broken id reference(s)');
if (!pages) console.error('  ! no page carried the $LUMOS hero — nothing was wired');
