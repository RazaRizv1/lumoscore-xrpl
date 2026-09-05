// Replace the fee-tier layer with one that reads the XRP Ledger.
//
// The inherited `lx-feerate` ships on EVERY page and could never grant the discount: it looked the
// connected address up on horizon.stellar.org against the Stellar LUMOS issuer. With an r-address
// in `lumos.address` that is a 404, swallowed, leaving the rate at 0.2% for everyone. A holder with
// a million LUMOS was charged double, silently, with nothing in the console.
//
// Fee numbers are NOT changed here: 0.2% / 0.1% at 250,000 LUMOS, pool-held LUMOS counting toward
// the threshold. Only the ledger and the issuer change. If the rates themselves ever move, they
// move in the browser file, which stays the single source of truth the Stellar build made it.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplfeerate';
const page = fs.readFileSync(__dirname + '/browser/feerate.js', 'utf8');

if (page.indexOf('</' + 'script') >= 0) {
  console.error('  the source file contains a closing script tag — aborting');
  process.exit(1);
}

// The rate pair is the thing most likely to drift by accident, so it is asserted at build time
// rather than trusted. A silent change here is a change to what every trade costs.
for (const need of ['0.002', '0.001', '250000']) {
  if (page.indexOf(need) < 0) {
    console.error('  ! fee constant ' + need + ' missing from browser/feerate.js — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    const old = new RegExp('<script id="lx-feerate">[\\s\\S]*?<\\/script>', 'g');
    const had = old.test(h);
    if (had) { h = h.replace(old, ''); stripped++; }

    const mine = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    const hadMine = mine.test(h);
    h = h.replace(mine, '');

    // Only pages that actually had a fee layer get one back. Adding it where the Stellar build did
    // not have it would put a wallet lookup on pages that never needed one.
    if (!had && !hadMine) continue;

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl feerate: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar layer from ' + stripped);
