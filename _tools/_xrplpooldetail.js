// Wire the pool detail page to the ledger.
//
// The page shipped MOCK reserves -- 3,420,180 XRP against a real 412.5 for LUMOS/XRP, roughly 8,000x
// out -- under a fabricated 64-hex "Pool ID" that is not the right shape for this ledger, where a
// pool is addressed by its AMM ACCOUNT. Stripping lx-ammdata left nothing overwriting that mock, and
// every row of the Pools table links here.
//
// lx-ammdata is already gone from these pages (see _xrplpools.js); this only injects the renderer.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplpooldetail';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/pooldetail.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">' + '\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    // Strip from EVERY page first. A previous run guarded on 'pool-header', which also appears in
    // stylesheets, so the block landed on 12 keys instead of 3. Narrowing the guard alone would have
    // left those 9 copies in place forever, since a narrower guard never revisits them.
    const before = h;
    h = stripById(h, ID).html;
    // #tvlChart is unique to the pool detail page in markup, not shared with any stylesheet.
    if (h.indexOf('id="tvlChart"') < 0) { if (h !== before) json[key] = h; continue; }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl pool detail: injected on ' + pages + ' page key(s) across ' + files + ' container(s)');
if (!pages) console.error('  ! no page carried .pool-header — nothing was wired');
