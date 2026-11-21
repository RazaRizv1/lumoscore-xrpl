// Stops the dashboard NETWORK card flashing its raw contents before the chain panel is built.
//
// WHAT RAZA SAW (2026-10-28, screenshot of lumoscore.com/dashboard): the first card in the stats
// row rendered as a wallet-style pill -- a network logo, the word NETWORK and "XRP Ledger" -- and
// then snapped to the "Network Stats" heading it is supposed to be. "Where did this flash suddenly
// come from."
//
// WHY IT HAPPENS. The card is STATIC markup:
//
//   <div class="greeting-row"><div class="greeting"><div class="status-row">
//     <span class="status-pill lx-netcard"><span class="lx-netpill"><img src="data:image/webp...">
//
// and its logo is an inline base64 data URI, so it paints on the FIRST frame with no network wait.
// The rule that hides it is scoped to an ancestor that does not exist yet:
//
//   .lx-xlmpanel>.status-row>.status-pill.lx-netcard img, ... {display:none!important}
//
// `.lx-xlmpanel` is created at RUNTIME -- `p=document.createElement("div");
// p.className="lx-xlmpanel lx-loading"` -- and the status row is moved into it. Until that line
// runs there is no ancestor to match, so the card shows everything the rule exists to hide. That is
// the flash pattern this codebase has paid for before: A JS GATE CANNOT FIX A FLASH IN MARKUP THAT
// PRECEDES IT. The fix has to be a rule that is already true at first paint.
//
// NOT MINE, AND NOT NEW. The identical structure is in the STELLAR build -- same static card, same
// JS-created panel, same panel-scoped hide rule -- so the flash is inherited and exists on both
// forks. ("A bug on one fork is usually in all of them.") What cannot be ruled out is that adding a
// script to this page widened an already-present window from imperceptible to visible; this fix
// removes the window entirely, so the timing stops mattering either way.
//
// WHY UNSCOPING IS SAFE HERE. Measured across both built trees: `status-pill lx-netcard` appears on
// exactly TWO pages per fork -- lumoscore-home.html and lumoscore-home-mobile.html -- both of which
// sit inside `.greeting-row` and both of which build the panel. There is no page that shows this
// card as a network pill on purpose, so dropping the `.lx-xlmpanel` ancestor from the selector
// cannot take a pill away from a page that wants one. The transform ABORTS if that stops being true.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);
const DQ = String.fromCharCode(34);

const ID = 'lx-xnetflash';
const CARD = 'status-pill lx-netcard';

function die(msg) {
  console.error('xrpl netcard flash: ABORT - ' + msg + ' (nothing written)');
  process.exit(1);
}

// Our own <style id="..."> only. stripscript.js handles <script id="..."> and nothing else, so the
// style needs its own removal or a re-run would stack a second copy on every build.
function stripStyle(html, id) {
  const open = '<' + 'style id=' + DQ + id + DQ;
  const close = '<' + '/' + 'style>';
  let out = html, i;
  while ((i = out.indexOf(open)) >= 0) {
    const e = out.indexOf(close, i);
    if (e < 0) break;                       // malformed: leave it rather than cut to the end
    out = out.slice(0, i) + out.slice(e + close.length);
  }
  return out;
}

// The same three declarations the panel-scoped block applies, minus the ancestor that has to be
// built first. Values are copied from that block verbatim so the card does not move when the panel
// finally arrives and its own rules take over.
const CSS = '<' + 'style id=' + DQ + ID + DQ + '>'
  + '.status-row>.status-pill.lx-netcard img,'
  + '.status-row>.status-pill.lx-netcard .lx-netpill,'
  + '.status-row>.status-pill.lx-netcard .lx-netmeta{display:none!important}'
  + '.status-row>.status-pill.lx-netcard::before{content:' + DQ + 'Network Stats' + DQ + ';'
  + 'font:800 16.5px/1.2 ' + DQ + 'Hanken Grotesk' + DQ + ',system-ui,sans-serif;'
  + 'letter-spacing:-.01em;color:var(--text)}'
  + '.status-row>.status-pill.lx-netcard{flex-direction:row!important;align-items:center!important;'
  + 'gap:9.9px;justify-content:flex-start!important;padding-right:24.2px!important}'
  + '<' + '/' + 'style>';

// Same gate the other dashboard transforms use, so they cannot disagree about which page this is.
function isDashboard(h) {
  return h.indexOf('id=' + DQ + 'activityList' + DQ) >= 0 && h.indexOf('status-row') >= 0;
}

let files = 0, pages = 0, noCard = 0, offDash = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing - skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  let changed = false;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const hasCard = h.indexOf(CARD) >= 0;

    // A page carrying the card that is NOT the dashboard would be a page that wants the pill, and
    // the unscoped selector would silently blank it. That is the one thing this must never do.
    if (hasCard && !isDashboard(h)) { offDash++; continue; }
    if (!isDashboard(h)) continue;
    if (!hasCard) { noCard++; continue; }

    h = stripStyle(h, ID);                  // idempotent: a re-run replaces, never stacks
    const hi = h.indexOf('<' + '/head>');
    if (hi < 0) { console.error('  ' + key + ': no closing head - skipped'); continue; }

    // Last in the head, so it also wins on order against the inherited lx-netpillcss block that
    // styles this same card as a pill.
    json[key] = h.slice(0, hi) + CSS + h.slice(hi);
    changed = true;
    pages++;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

if (offDash) die(offDash + ' non-dashboard page(s) carry the network card - the unscoped rule would blank a pill that is meant to show');
if (!pages) die('no dashboard page carried ' + CARD + ' - the base may have changed');
console.log('xrpl netcard flash: first-paint rule on ' + pages + ' page key(s) across ' + files
  + ' container(s)' + (noCard ? '; ' + noCard + ' dashboard page(s) had no network card' : ''));
