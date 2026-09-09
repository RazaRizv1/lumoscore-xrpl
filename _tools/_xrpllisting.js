// Put the XRP Ledger listing layer on /list-your-token, and take the Stellar one off.
//
// The Stellar layer on this page was not merely dead — it was a live Stellar MAINNET payment path
// reachable from an XRP Ledger site, posting its record to an endpoint this project does not serve.
// See browser/listing.js for the full sequence. It is stripped here rather than in
// _xrplstripstellar.js so that the strip and its replacement land in the same step and the page is
// never left with neither.
//
// The collector address and its build-time checksum gate live in _tools/xrpladdr.js, which every
// caller goes through so that none can skip the check.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpllisting';
const STELLAR_ID = 'lx-listtoken';
// The collector and its checksum gate now live in one place, imported here.
const { FEE_COLLECTOR, injectCollector } = require(__dirname + '/xrpladdr.js');

const page = injectCollector(fs.readFileSync(__dirname + '/browser/listing.js', 'utf8'), 'listing.js');
if (page.indexOf('</' + 'script') >= 0) {
  console.error('  listing.js contains a closing script tag — aborting');
  process.exit(1);
}
const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    // Guard on the page's own controls, not on its name.
    if (h.indexOf('id="ltGo"') < 0 && h.indexOf('id="ltAmt"') < 0) continue;

    h = stripById(h, ID).html;                       // idempotent
    const gone = stripById(h, STELLAR_ID);
    h = gone.html;
    stripped += gone.removed;

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) continue;
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl listing: wired on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped ' + stripped + ' Stellar payment layer(s)');
if (!pages) console.error('  ! no page carried the listing controls — nothing was wired');
