// Replace the Trade page's inherited Stellar market layer with an XRP Ledger one.
//
// `lx-dexmain` was not dead here, which makes it the worst thing found in this fork so far. It was
// still running on /xrpl/trade and filling the market table from Horizon: 36 rows of real STELLAR
// assets -- USDC/circle.com, SHX/stronghold.co, yXLM, AQUA -- priced in XLM, under a page titled
// "Trade on the XRP Ledger DEX". A blank page tells you it is broken; this told you it was fine.
//
// It is stripped rather than left to lose a race with the new layer. Two writers on one element is
// exactly the failure this codebase has hit before, and "whichever finishes last wins" is not a
// design -- especially when one of the two writes the wrong chain's data.
//
// Browser code is read from files and injected verbatim, same rule as the other layers: no browser
// code inside quoted strings in a transform, because that is where every escaping accident came from.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpltrade';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/trade.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
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
    // Only the Trade market pages. BOTH ids, because desktop and mobile are different page builds
    // with no markup in common here: desktop has a table (#dexMkTbody), mobile has a card list
    // (#mdxMkList) and carries none of the dex* ids at all. Guarding on the table alone skipped
    // every phone, which left `lx-dexmain` running there and the mobile Trade page still listing
    // Stellar assets with /trade/stellar/ links.
    if (h.indexOf('id="dexMkTbody"') < 0 && h.indexOf('id="mdxMkList"') < 0) continue;

    const old = new RegExp('<script id="lx-dexmain">[\\s\\S]*?<\\/script>', 'g');
    if (old.test(h)) { h = h.replace(old, ''); stripped++; }

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

console.log('xrpl trade: injected on ' + pages + ' page key(s) across ' + files + ' container(s); '
  + 'stripped the Stellar market layer from ' + stripped);
if (!pages) console.error('  ! no page carried id="dexMkTbody" — nothing was wired');
