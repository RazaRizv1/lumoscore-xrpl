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

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}

// Loud, because a build that quietly ships a connect flow nobody can use is the worst outcome here.
if (!/var XAMAN_KEY = '[0-9a-f-]{36}'/.test(page)) {
  console.warn('  ! Xaman API key not set in _tools/browser/connect.js — Xaman will show "Setup needed"');
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0;
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

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  // </ inside a JSON string would close the container's own script tag when the file is parsed.
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl connect: injected on ' + pages + ' page key(s) across ' + files + ' container(s); '
  + 'stripped the Stellar flow from ' + stripped);
