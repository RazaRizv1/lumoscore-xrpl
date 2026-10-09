// A 16px floor on every field a phone keyboard can open. The XRPL half of _zoomfloor.js.
//
// WHY THIS EXISTS AS ITS OWN PASS. iOS Safari zooms the whole page when a focused input computes to
// less than 16px, and it does NOT zoom back out when the field loses focus. The reader is left in a
// magnified, sideways-scrolling page and has to pinch their way back. Android Chrome does not do it,
// and no desktop browser does, which is exactly why it survives every review that is not done on a
// phone.
//
// Measured on the deployed mobile build across all five XRPL hub routes, reading the computed size
// off each element rather than trusting the stylesheet:
//
//   #poolSearch            /pools/xrpl     13.8px  inherited, frozen
//   #mdxMkSearch           /trade/xrpl     13.8px  inherited, frozen
//   #roundSel              /rewards/xrpl   14.3px  the design's base CSS
//   input.ad-search-input  add-liquidity   14.3px  the design's base CSS
//   input.br-addr-in       /bridge/xrpl    15px    the design's base CSS
//
// THE FIRST TWO CANNOT BE FIXED AT SOURCE HERE, and that is the whole reason this file is not just a
// courtesy copy. This repo has no _tabs.js and no _mobdex.js: the containers are a frozen snapshot of
// Stellar's BUILT pages, so they carry those tools' OUTPUT with no way to re-run them. The pool rule
// arrived three times over (the duplicate-stylesheet pileup), every copy at 13.8px. Fixing them on
// the Stellar side therefore does nothing over here until someone runs `rebuild.js --base`, which
// re-copies the containers -- so this pass has to carry them itself.
//
// input.brd-q is carried here too even though the XRPL bridge search already measures 16px, so that
// this list and _zoomfloor.js's stay character-for-character identical -- the two repos being
// diffable against each other is the only check that catches a field fixed on one chain and not the
// other.
//
// HALF OF THESE ARE CLASSES, NOT IDS, and reading them off a DOM dump is how to get that wrong. The
// first pass wrote `#` for all of them because the script that found them reported
// `el.id || el.name || el.className`, which prints a class exactly like an id. Those rules then sat
// in the page matching nothing. The tell that nearly hid it: .brd-q computes to 16px here already, so
// `#brd-q` doing nothing looked like `#brd-q` working -- a rule that matches nothing is
// indistinguishable from a rule that won unless the before value is known.
//
// !important IS REQUIRED, and for the ids an ID selector on top of it. #poolSearch's inherited rule
// is `.search-box.inline-filter input{...!important}`: an override has to clear both bars --
// !important to compete at all, and an ID (1,0,0 against 0,2,1) to win the specificity tie. The class
// fields are authored without !important, so importance alone settles them; they are written
// `input.x` rather than `.x` so they also outrank a same-class rule added later.
//
// A FLOOR CANNOT ALWAYS WIN, SO IT IS NOT THE ONLY MECHANISM. .br-addr-in stayed at 15px with the
// rule below in the page and matching: _xrplbridgepolish.js writes it through a six-class descendant
// selector, (0,6,0) against this file's (0,1,1), and !important on both sides only moves the fight to
// specificity. It is fixed in _xrplbridgepolish.js instead and kept in the list here as a backstop.
// The lesson for anything added later: check the computed value afterwards, because a losing rule and
// a winning rule look identical in the stylesheet.
//
// THE MOBILE CONTAINER ONLY, AND NO WIDTH QUERY. The first version wrote to both containers behind
// `@media (max-width:820px)`, which looked like the careful choice and was not. The desktop build
// authors these same fields at 16.5px -- already above the floor -- so between 517px and 820px the
// rule was pulling two of them DOWN half a pixel. A rule meant to stop a phone defect was the only
// thing changing the desktop build. Measured by disabling the sheet in the page and re-reading the
// computed sizes, which is the one way to see what a rule is actually doing rather than what it was
// for.
//
// Scoping to the container the phone is served instead of to a width also fixes the other end: a
// tablet in landscape gets the mobile build at ~1024px, is still a touch device, and still zooms on a
// sub-16px field -- a max-width query would have switched the floor off exactly there.
//
// `type=file` is excluded on purpose: there is nothing to type into one, so iOS does not zoom.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-zoomfloor-css';

// Named one per line so a diff shows exactly which field was added or dropped. The "#" / "input."
// split is not cosmetic -- see the note above about rules that matched nothing. Kept identical to
// _zoomfloor.js's list in the Stellar repo, deliberately.
const FIELDS = [
  '#poolSearch',              // pool filter, /pools/xrpl
  '#mdxMkSearch',             // new-mints search, /trade/xrpl
  '#roundSel',                // round picker, /rewards/xrpl
  'input.ad-search-input',    // asset picker inside the add-liquidity dialog
  'input.brd-q',              // network search, /bridge/xrpl
  'input.br-addr-in',         // bridge DESTINATION ADDRESS, /bridge/xrpl
  // The wallet's "Search asset…" field, on both chains. It carries NO id and NO class, which is
  // exactly why the first sweep missed it -- that sweep keyed on ids and classes, so a bare <input>
  // had nothing to report itself by. Matched through its wrapper instead. Broad on purpose: every
  // search box on a phone wants the floor, and the one other element this reaches (#poolSearch, via
  // .search-box.inline-filter) is already floored to the same 16px, so the two cannot disagree.
  '.search-box input',        // wallet asset search, /wallet
];

const CSS = FIELDS.map((s) => s + ':not([type=file])').join(',')
  + '{font-size:16px!important}';
const STYLE = '<style id="' + ID + '">' + CSS + '</style>';

// Remove our own previous block before inserting, so a re-run replaces rather than stacks -- this
// pass is in the rebuild chain and runs on every build. Matching `<style id="ID">` with the ">"
// immediately after the id is the house pattern; nothing else is allowed onto this tag, because an
// extra attribute silently stops every strip regex in the build from matching and the blocks then
// accumulate.
const SELF = new RegExp('<style id="' + ID + '">[\\s\\S]*?<\\/style>', 'g');

// `insert` false strips our block and puts nothing back. Both containers are visited either way: an
// earlier version of this pass DID write to the desktop container, so skipping it outright would
// leave that stylesheet behind for good. Stripping everywhere and inserting in one place is what
// makes the pass converge on the right state from whatever it finds.
function apply(html, insert) {
  const cleaned = html.replace(SELF, '');
  if (!insert) return cleaned;
  const hi = cleaned.indexOf('</head>');
  // No </head> means this page key is a fragment, not a document -- leave it alone rather than
  // appending a stylesheet somewhere it will never be parsed as one.
  if (hi < 0) return null;
  return cleaned.slice(0, hi) + STYLE + cleaned.slice(hi);
}

let floored = 0, cleared = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  const insert = (dev === 'mobile');          // the build a phone is served -- see the note above
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  let json, s, e; try { ({ json, s, e } = getContents(data)); } catch (err) { continue; }
  let changed = false;

  for (const k of Object.keys(json)) {
    const out = apply(json[k], insert);
    if (out === null || out === json[k]) continue;
    json[k] = out; changed = true;
    if (insert) floored++; else cleared++;
  }

  // The page map lives inside a <script> tag, so "</" has to be re-escaped or the serialized JSON
  // closes that tag early and takes the rest of the file with it.
  if (changed) {
    const ser = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + ser + data.slice(e), 'utf8');
  }
}

console.log('xrpl zoomfloor: ' + FIELDS.length + ' field(s) floored at 16px on ' + floored
  + ' phone page key(s)'
  + (cleared ? ('; removed from ' + cleared + ' desktop page key(s)') : ''));
