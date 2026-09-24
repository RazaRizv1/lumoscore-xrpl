// Dashboard → Quick actions → "Custom Swap / Orders": Stellar's three-tab dialog (Swap, Limit, Orders),
// driven by the XRP Ledger. RAZA 2026-09-15: "On XRPL it's a different popup from that we have on stellar."
//
// Injected wherever `#swapModal` exists — the dashboard, desktop and phone. Carries xrpl-core (the phone
// dashboard has no other layer that injects it) and gets the fee collector through the same
// checksum-gated injection write.js uses, so a mistyped collector fails the build instead of shipping.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const { injectCollector } = require(__dirname + '/xrpladdr.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplqorders';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = injectCollector(fs.readFileSync(__dirname + '/browser/qorders.js', 'utf8'), 'qorders.js');
for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = stripById(json[key], ID).html;
    if (h.indexOf('id="swapModal"') < 0) { json[key] = h; continue; }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('xrpl custom swap / orders: wired on ' + pages + ' page key(s)');
if (!pages) { console.error('  ! no page carried #swapModal — nothing was wired'); process.exit(1); }
