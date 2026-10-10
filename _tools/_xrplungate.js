// Open the two pages this build still gates that Stellar deliberately does not.
//
// RAZA 2026-10-06: "fix the bridge/xrpl redirect". /bridge/xrpl served 200 and then bounced to the
// landing page a moment later — the right HTML, thrown away by its own first script:
//
//   <script id="lx-authgate">(function(){try{
//     if(!(localStorage.getItem("lumos.wallet")||localStorage.getItem("lumos.address")))
//       location.replace("/");}catch(_){}})();</script>
//
// No wallet in localStorage, no page. On a first visit that is everyone, so the Bridge page was
// unreachable to every visitor who had not already connected — including from the chain switcher and
// from our own footer.
//
// THIS IS THE FROZEN BASE AGAIN, not a decision anyone made here. Stellar's `_authgate.js` lists
// `lumoscore-bridge` and `lumoscore-rewards` in PUBLIC_BASES, opened 2026-09-24, with its reason
// written out: "these are the pages we PROMOTE, and bouncing an unsigned visitor to the landing page
// threw the click away … Nothing can be SIGNED without a wallet either way — this gate was protecting
// the view, not the money." This fork copied the containers before that, so it kept the old gate, and
// lumoscore.com/bridge/stellar serves no `lx-authgate` at all while /bridge/xrpl served one.
// [[xrpl-inherits-a-frozen-stellar-build]], [[lumoscore-authgate-redirect]]
//
// REWARDS IS INCLUDED, and that is a judgement I am flagging rather than hiding: RAZA asked about
// Bridge. It is the same script, on the same frozen list, opened on the same day for the same stated
// reason, and leaving it would mean shipping a fix that covers one of two identical breakages.
//
// WHAT STAYS GATED, deliberately, matching Stellar's own note: the dashboard/home and wallet pages
// (both meaningless with no wallet) and the three launchpad steps (every one needs a signature).
// `asset-overview` stays gated too — it is NOT in Stellar's PUBLIC_BASES either, so gating it is
// parity, not a bug. Measured before writing this, both builds' lists side by side.
//
// Stripping, not rewriting: the guard is one self-contained script with a stable id, so removing it
// by id leaves no half-disabled remnant and is idempotent on re-runs.
//
// The container is JSON-escaped, so this goes through the repo's read()/getContents() pair.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// Base page names, variant suffixes stripped before comparing — keys arrive as
// "lumoscore-bridge-dark.html", "lumoscore-rewards-mobile.html" and so on. Substring matching would
// be wrong here for the same reason it is in Stellar's isPublicPage: a prefix can leak.
const OPEN = new Set([
  'lumoscore-bridge',
  'lumoscore-rewards',
  // ADDED 2026-10-10, the same parity rule this file already runs on. Stellar's _authgate.js now lists
  // lumoscore-launch-token in PUBLIC_BASES, so the note above ("the three launchpad steps stay gated")
  // is true of two of them from today, not three: review and confirm stay shut, the FORM opens.
  //
  // IT HAS TO BE DONE HERE OR THE HUB IS HALF BROKEN. /launchpad is one url for both chains
  // (COOKIE_HUBS in _lumosparent.js — RAZA chose the cookie over a /launchpad/xrpl route on
  // 2026-10-09), so the chooser's XRP Ledger card writes lx_chain=xrpl and navigates to /launchpad,
  // which the middleware then answers with THIS build's page. Opening only Stellar's copy would mean
  // the Stellar card works and the XRPL card still bounces to "/" — from the same chooser, with
  // nothing on screen to explain the difference.
  //
  // Same reasoning as bridge and rewards above, and the same limit: nothing can be SIGNED without a
  // wallet. The form is viewable; the step-1 CTA asks for a wallet via _connectgate.js on the Stellar
  // side, and the signing steps behind it are still gated here.
  'lumoscore-launch-token',
]);

function base(k) {
  let b = k.replace(/\.html$/, ''), prev;
  do { prev = b; b = b.replace(/-(dark|light|mobile)$/, ''); } while (b !== prev);
  return b;
}

const GATE = new RegExp('<script id="lx-authgate">[' + B + 's' + B + 'S]*?<' + B + '/script>', 'g');

let files = 0, opened = 0;
const names = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    if (typeof json[k] !== 'string') continue;
    if (!OPEN.has(base(k))) continue;
    const before = json[k];
    const after = before.replace(GATE, '');
    if (after === before) continue;                 // already open — re-runs are no-ops
    json[k] = after;
    opened++;
    names.push(k.replace('.html', '').replace('lumoscore-', ''));
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl ungate: auth guard removed from ' + opened + ' page key(s) across ' + files
  + ' container(s)' + (names.length ? ' — ' + names.join(', ') : ''));
