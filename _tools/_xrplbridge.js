// Replace the bridge page's Circle CCTP layer with XRP Ledger route discovery.
//
// `lx-cctp-js` (~123KB) moved USDC between STELLAR and eight EVM chains. Wrong bridge, wrong source
// chain, on a page whose own heading already said "via Axelar" while its runtime-set title read
// "Bridge USDC across 8 chains with Circle CCTP".
//
// The replacement lists the networks Axelar can actually reach from the XRP Ledger, fetched live,
// and states plainly that transfers are not wired. Quoting and executing needs Squid's routing API
// (an x-integrator-id nobody has yet) and a signed transaction moving real funds.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplbridge';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/bridge.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">' + '\n' + core + '\n' + page + '\n</' + 'script>';

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

    const before = h;
    const gone = stripById(h, 'lx-cctp-js');
    h = gone.html;
    stripped += gone.removed;
    h = stripById(h, ID).html;

    // NOT id="lxBrPending": that element is CREATED by lx-cctp-js, so stripping that layer removes
    // the very thing the guard looked for and the transform silently wired nothing. Guard on markup
    // the page owns -- br-netbox is the source/destination panel and is in the container itself.
    // br-netbox appears on the ACCOUNT pages too (6 keys, not 3), so it would have put a bridge
    // chip list on a page about someone's balances. br-steps is the bridge's own step rail and
    // appears on exactly the three bridge keys. Measured, not assumed.
    if (h.indexOf('br-steps') < 0) { if (h !== before) json[key] = h; continue; }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl bridge: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped lx-cctp-js from ' + stripped);
if (!pages) console.error('  ! no page carried id="lxBrPending" — nothing was wired');
