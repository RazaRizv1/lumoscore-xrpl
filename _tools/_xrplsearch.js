// Replace the site-wide Stellar search index with an XRP Ledger one.
//
// TWO SCRIPTS ARE STRIPPED, both of which carry a STELLAR asset universe and were running on every
// page of an XRP Ledger site:
//
//   lx-searchassets (~50KB)  the search index itself. Typing "USD" returned Stellar assets with
//                            G-issuers, and prefetched their logos from /lxapi/assetlogo.
//   lx-spico       (~176KB)  a ticker -> Stellar-logo map. It also builds sp-row markup, and it is
//                            what was stamping a Stellar mark onto RLUSD, USDC and ARMY on the Trade
//                            page -- surviving every attempt to opt out by class, because it does
//                            not match on the classes we control.
//
// Removing lx-spico leaves some tokens without a logo. That is the correct outcome: its entire
// dataset is Stellar assets, so on this ledger every logo it draws is either coincidence or a lie,
// and a ticker is not an identity on either chain. Real logos need the xrpl.to API key.
//
// This is a large removal (~227KB per page), so the transform reports exactly what it took out.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplsearch';
const KILL = ['lx-searchassets', 'lx-spico'];

const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/search.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, bytes = 0;
const removed = {};
for (const k of KILL) removed[k] = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    // Every page with the search popup, which is most of them.
    if (h.indexOf('id="spAssetList"') < 0) continue;

    for (const k of KILL) {
      const re = new RegExp('<script id="' + k + '">[\\s\\S]*?<\\/script>', 'g');
      const before = h.length;
      const hits = h.match(re);
      if (hits) { removed[k] += hits.length; h = h.replace(re, ''); bytes += before - h.length; }
    }

    const mine = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(mine, '');

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl search: injected on ' + pages + ' page key(s) across ' + files + ' container(s)');
for (const k of KILL) console.log('  stripped ' + k + ': ' + removed[k] + ' block(s)');
console.log('  removed ' + (bytes / 1024).toFixed(0) + ' KB of Stellar asset data');
if (!pages) console.error('  ! no page carried id="spAssetList" — nothing was wired');
