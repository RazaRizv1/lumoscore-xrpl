// "Launch Token" on an XRP Ledger page should open the XRP Ledger launchpad.
//
// RAZA 2026-10-11, connected with Xaman: "I am already connected to XRP so why it's taking me to the
// hub page when I'm tapping launch asset. It should have taken me to /launchpad/XRPL directly."
//
// /launchpad is the NETWORK CHOOSER, and it is the right destination for someone who has not picked
// a chain yet -- it is also an indexed landing page, so it stays exactly as it is. What is wrong is
// asking the question again on a page whose url already answers it: every one of these links sits on
// a /<section>/xrpl page, reached from an XRPL wallet, and the chooser then offers Stellar as though
// the reader might have meant that.
//
// THE BUILD ALREADY DISAGREED WITH ITSELF. Measured before writing this: lumoscore-dex.html carried
// two href="/launchpad" and one href="/launchpad/xrpl", home three and one, wallet one and one. The
// chain-specific ones came from the footer nav; the rest are the design's own buttons, untouched
// since the fork. So this is not a new destination, it is the one the footer on the same page was
// already using.
//
// Stellar is deliberately NOT given the same treatment here. Its pages are not all one chain in the
// way these are -- the landing page and the hubs are shared -- and RAZA asked for the XRPL half.
//
// SCOPED TO THE EXACT STRING href="/launchpad" FOLLOWED BY A QUOTE-CLOSING CHARACTER, so
// /launchpad/xrpl and /launchpad/stellar are left alone and a second run is a no-op rather than
// producing /launchpad/xrpl/xrpl.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const FILES = ['lumoscore-xrpl-desktop.html', 'lumoscore-xrpl-mobile.html'];
const FROM = 'href="/launchpad"';
const TO = 'href="/launchpad/xrpl"';

// The chooser itself. Rewriting a link on the hub would send a reader who deliberately opened the
// network picker straight past it.
const SKIP = /^lumoscore-launch-hub|^lumoscore-landing/;

let containers = 0, pages = 0, links = 0;

for (const file of FILES) {
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  containers++;

  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string') continue;
    if (SKIP.test(key)) continue;
    if (h.indexOf(FROM) < 0) continue;
    const n = h.split(FROM).length - 1;
    json[key] = h.split(FROM).join(TO);
    pages++; links += n;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl launch links: ' + links + ' launchpad link(s) pointed at /launchpad/xrpl on '
  + pages + ' page key(s) across ' + containers + ' container(s)');

// Verify, because a silent no-op here looks identical to a pass that worked.
let left = 0;
for (const file of FILES) {
  let data; try { data = read(file); } catch (e) { continue; }
  const { json } = getContents(data);
  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string' || SKIP.test(key)) continue;
    if (h.indexOf(FROM) >= 0) { left++; console.error('  ! ' + key + ': still has ' + FROM); }
  }
}
if (left) process.exit(1);
