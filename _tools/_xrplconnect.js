// Replace the inherited Stellar connect flow with an XRP Ledger one.
//
// Two things happen here, and the first matters more than the second:
//
// 1. STRIP `lx-realconnect`. It is 43KB of Freighter / LOBSTR / xBull / Albedo / WalletConnect
//    logic, and in this project it is already dead: it wires `.lxw-row` elements built by `lx-mc`,
//    and `lx-mc` was never carried into the XRPL containers. Left in place it is not merely useless
//    -- every one of its paths ends in `localStorage['lumos.address'] = <a Stellar G-address>`, the
//    exact key the XRPL wallet layer reads. A dead flow that half-works is worse than no flow.
//
// 2. INJECT xrpl-core + browser/connect.js, read from files and injected verbatim. Same rule as
//    the wallet layer: browser code never lives inside a quoted string in a transform, because
//    every escaping accident in the Stellar project came from exactly that.
//
// Note the core is injected here AND by _xrplwallet.js rather than once in a shared block. That is
// deliberate: a shared block would make the two transforms order-dependent (whichever appended last
// would win), and ordering bugs between transforms are silent. The core is pure functions whose only
// side effect is assigning window.lxx, so defining it twice costs ~4KB on wallet pages and cannot
// misbehave.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplconnect';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/connect.js', 'utf8');
// The XLS-56 Batch builder rides with connect because it is keyed on the connected wallet and every
// flow that might batch -- swap, bridge, launchpad -- is on a page that already carries lxc. It ships
// INERT: every wallet defaults to not-capable, so until one is proven this changes nothing for anyone.
const batch = fs.readFileSync(__dirname + '/browser/batch.js', 'utf8');

for (const src of [core, page, batch]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}

// batch.js reads lxc.transport(), so connect must define window.lxc before it runs. They are
// concatenated in that order below; this asserts the dependency rather than trusting the order to
// survive an edit.
if (batch.indexOf('window.lxb') < 0 || page.indexOf('window.lxc = {') < 0) {
  console.error('  ! connect/batch contract broken — expected window.lxc in connect.js and window.lxb in batch.js');
  process.exit(1);
}

// Loud, because a build that quietly ships a connect flow nobody can use is the worst outcome here.
if (!/var XAMAN_KEY = '[0-9a-f-]{36}'/.test(page)) {
  console.warn('  ! Xaman API key not set in _tools/browser/connect.js — Xaman will show "Setup needed"');
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n' + batch + '\n</' + 'script>';

// DO NOT PAINT A PAGE WE ARE ABOUT TO LEAVE.
//
// A phone comes back from the Xaman app at XAMAN_RETURN ('/trade/xrpl') because that address is
// registered in the Xaman app and cannot be chosen from here. The connect layer rides at the END of
// <body>, so by the time it can adopt the session and hop to the landing, the trade page has already
// parsed and painted — RAZA sees the market table for a moment on the way through, which is what he
// reported after the landing fix itself was working ("that bug ... where it takes to trade main page
// for split seconds is still here").
//
// So this sits in <head> and hides the document for the handful of frames between arriving and
// leaving. It changes no part of the sign-in: the SDK still completes exactly as before, the handshake
// parameters are untouched, and the only difference is that nothing is drawn meanwhile.
//
// THREE GUARDS, because a page hidden by mistake is far worse than a flash:
//   * only on XAMAN_RETURN, and only when the URL carries Xaman's own return parameters or a
//     sign-in started here in the last fifteen minutes — the same staleness window backTarget() uses
//   * a timer reveals the page regardless after five seconds, so a sign-in that never completes
//     leaves a usable trade page rather than a blank one
//   * visibility, not display, so layout is unaffected and nothing reflows when it lifts
const RETURN_ID = 'lx-xreturn';
const RETURN_HEAD = '<script id="' + RETURN_ID + '">(function(){try{'
  + 'if(location.pathname!=="/trade/xrpl")return;'
  + 'var back=null;try{back=JSON.parse(localStorage.getItem("lumos.xamanBack")||"null");}catch(_){}'
  + 'var fresh=!!(back&&back.t&&(Date.now()-back.t)<900000);'
  + 'var ret=/xumm|xApp|access_token|authorization_code/i.test(location.href);'
  + 'if(!ret&&!fresh)return;'
  + 'var st=document.createElement("style");st.id="' + RETURN_ID + '-css";'
  + 'st.textContent="html{visibility:hidden!important}";'
  + '(document.head||document.documentElement).appendChild(st);'
  + 'setTimeout(function(){try{st.parentNode&&st.parentNode.removeChild(st);}catch(_){}} ,5000);'
  + '}catch(_){}})();</' + 'script>';

// ---- the design's OTHER connect modal ------------------------------------------------------------
// `#lcConnectModal` is a second, separate inherited modal (the `lc-*` family — not the `lxw-*` one
// that designConnected() still mounts for the connected screen). Its list is seven STELLAR wallets:
// Freighter, xBull, Rabet, Albedo, LOBSTR, WalletConnect, Hana.
//
// It is unreachable — its only opener is `.lc-guest-open`, and no element on any XRPL page carries
// that class, so the block sits inside `<div id="lcConnectModal" hidden>` for the life of the page.
// Unreachable is not the same as harmless: the markup still ships, and a crawler reading the HTML
// finds seven wrong-chain wallet names on a site about the XRP Ledger. Same reason the copy pass
// exists — see _xrplbridgecopy.
//
// Only the `.lc-wgroup` blocks go. `.lc-wempty` is a sibling INSIDE the same list and the design's
// script reads it (`modal.querySelector('.lc-wempty')`), so it stays; the script's own guard
// (`if (!modal) return;`) means nothing here can orphan a lookup either way.
//
// Idempotent by construction: the cut is driven by finding `<div class="lc-wgroup">`, so a second
// run finds none and changes nothing.
function matchDiv(h, a) {
  // Index just past the `</div>` that closes the tag starting at `a`. Divs never self-close.
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = a;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    if (m[0][1] === '/') { if (--depth === 0) return m.index + m[0].length; }
    else depth++;
  }
  return -1;
}

// Two screens in the same modal also NAME a wallet, outside the list: the connecting screen's
// heading and the connected card's meta line. The design's script overwrites both at runtime
// (`'Confirming with ' + state.wallet`, `walDone.textContent = state.wallet`), but that script can
// only run from an opener this build has none of, so the static text is what ships. Neutral wording
// keeps each element, its id and its sentence shape exactly as designed.
//
// Verified uniform across all seven page keys that carry them before being written as exact strings
// — the hand-written gates that silently disabled correct rules three times in _xrplbridgecopy were
// all cases of guessing the source text instead of reading it.
const PLACEHOLDERS = [
  ['<h4 id="lcConnectingTitle">Confirming with Freighter</h4>',
   '<h4 id="lcConnectingTitle">Confirming with your wallet</h4>'],
  ['<span id="lcWalletNameDone">Freighter</span>',
   '<span id="lcWalletNameDone">Wallet</span>'],
];

function stripWalletList(h) {
  const OPEN = '<div class="lc-wgroup">';
  let out = h, cut = 0;
  for (;;) {
    const a = out.indexOf(OPEN);
    if (a < 0) break;
    const end = matchDiv(out, a);
    if (end < 0) { console.error('  unbalanced .lc-wgroup — left in place'); break; }
    cut += (out.slice(a, end).match(/class="lc-wrow"/g) || []).length;
    out = out.slice(0, a) + out.slice(end);
  }
  // Idempotent: no replacement CONTAINS its own search string, so a second run finds nothing. (The
  // one-way gate that bit _xrplbridgecopy was a rule whose search text survived its own replacement.)
  let title = 0;
  for (const [from, to] of PLACEHOLDERS) {
    if (out.indexOf(from) < 0) continue;
    out = out.split(from).join(to);
    title++;
  }
  return { h: out, cut, title };
}

let files = 0, pages = 0, stripped = 0, wrows = 0, wpages = 0, titles = 0, headPages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    const old = new RegExp('<script id="lx-realconnect">[\\s\\S]*?<\\/script>', 'g');
    if (old.test(h)) { h = h.replace(old, ''); stripped++; }

    const mine = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(mine, '');

    const wl = stripWalletList(h);
    if (wl.cut || wl.title) { h = wl.h; wrows += wl.cut; titles += wl.title; if (wl.cut) wpages++; }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    h = h.slice(0, bi) + SCRIPT + h.slice(bi);

    // The paint guard goes in <head>, where it can act before the first frame. Stripped first, /g, for
    // the same reason as the block above: one strip against two stale copies leaves a duplicate.
    const oldRet = new RegExp('<script id="' + RETURN_ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(oldRet, '');
    if (h.indexOf('</head>') >= 0) { h = h.replace('</head>', RETURN_HEAD + '</head>'); headPages++; }

    json[key] = h;
    pages++;
  }

  // </ inside a JSON string would close the container's own script tag when the file is parsed.
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl connect: injected on ' + pages + ' page key(s) (' + headPages + ' with the paint guard) across ' + files + ' container(s); '
  + 'stripped the Stellar flow from ' + stripped
  + '; removed ' + wrows + ' Stellar wallet row(s) from ' + wpages + ' page key(s)'
  + ', neutralised ' + titles + ' connecting-screen placeholder(s)');
