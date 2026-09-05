// Replace the Account page's Stellar layer with an XRP Ledger one.
//
// `lx-accdata` (~53KB) required a Stellar G-address. On /xrpl/account/<r-address> it printed
// "No Stellar address in this link." and stopped, so the page never worked for a single real
// visitor. Inert rather than wrong -- the better of the two failures, but still a dead page.
//
// `lx-mc` (~19KB) goes with it: it builds the .lxw-* connect modal for the Stellar wallets, which
// this project replaced with its own flow in _xrplconnect.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplaccount';
const KILL = ['lx-accdata', 'lx-mc'];

const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/account.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0;
const removed = {};
for (const k of KILL) removed[k] = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    let touched = false;
    for (const k of KILL) {
      const gone = stripById(h, k);
      if (gone.removed) { h = gone.html; removed[k] += gone.removed; touched = true; }
    }

    if (h.indexOf('id="accAssetsTbl"') < 0) { if (touched) json[key] = h; continue; }

    h = stripById(h, ID).html;

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl account: injected on ' + pages + ' page key(s) across ' + files + ' container(s)');
for (const k of KILL) console.log('  stripped ' + k + ': ' + removed[k] + ' block(s)');
if (!pages) console.error('  ! no page carried id="accAssetsTbl" — nothing was wired');
