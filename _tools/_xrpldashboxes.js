// Replace the Stellar product-card filler on the dashboard with the XRP Ledger one.
//
// The four product cards and their twelve data-k slots are BUILD-TIME MARKUP inherited with the
// containers — verified: 13 data-k slots present with every <script> stripped out. So the cards are
// the design's, they stay exactly as they are, and only the script that fills them changes. Nothing
// here draws UI.
//
// WHY STRIP RATHER THAN LAYER ON TOP. lx-dashboxes fetches /lxapi/poolstats, /lxapi/pools,
// /lxapi/dexassets and /lxapi/assetsearch, none of which this project serves, and its catch handlers
// write an em dash into all eight fetched slots. Leaving it in place would put two writers on every
// slot with the outcome decided by which request lost — a 404 resolves fast, a real answer does not.
// Stripping it makes this the single writer for all twelve.
//
// Usage: node _tools/_xrpldashboxes.js   (run it after _xrpldash, before _xrpltypescale is not
// relevant — this injects no styles.)
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpldashboxes';
const STELLAR_ID = 'lx-dashboxes';

const page = fs.readFileSync(__dirname + '/browser/dashboxes.js', 'utf8');
if (page.indexOf('</' + 'script') >= 0) {
  console.error('  dashboxes.js contains a closing script tag — aborting');
  process.exit(1);
}
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0, skipped = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    // Only pages that actually carry the cards. Guarding on the slots rather than on a page name
    // means this cannot wire a page that merely mentions them.
    if (h.indexOf('data-k="ppool"') < 0 || h.indexOf('data-k="ltok"') < 0) continue;

    h = stripById(h, ID).html;                      // idempotent
    const gone = stripById(h, STELLAR_ID);
    h = gone.html;
    stripped += gone.removed;

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { skipped++; continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl dashboard boxes: filled on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped ' + stripped + ' Stellar filler(s)'
  + (skipped ? '; ' + skipped + ' skipped (no closing body)' : ''));
if (!pages) console.error('  ! no page carried the product-card slots — nothing was wired');
