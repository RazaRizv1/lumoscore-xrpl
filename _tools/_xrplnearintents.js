// Replace the bridge page's Axelar route-discovery layer with the NEAR Intents (1Click) route.
//
// The layer this removes listed the chains Axelar reaches from the XRP Ledger and stated plainly that
// transfers were not wired. That was honest, and it was also the whole of what it did: no quotes, no
// send, no prices. NEAR Intents replaces it with 35 destination chains, live quotes and a real
// transfer, and it does so with NATIVE assets at the far end rather than a wrapped representation.
//
// AXELAR IS NOT GONE FOR GOOD. It is coming back as the second of three routes, and the reason it was
// parked here is now known to be wrong: this file's predecessor said executing needed "Squid's routing
// API (an x-integrator-id nobody has yet)". An outbound Axelar ITS transfer from XRPL needs no such
// thing -- it is a Payment to the gateway rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw carrying four memos. That
// note was about general routing and it kept a buildable route shelved.
//
// THE OLD SCRIPT IS STRIPPED BY ID, not left to fight for the same DOM. Two layers painting one bridge
// wizard is how this project produced a page that offered routes it did not have.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const { injectCollector } = require(__dirname + '/xrpladdr.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplnibridge';
const OLD = 'lx-xrplbridge';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
let page = fs.readFileSync(__dirname + '/browser/nibridge.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

// ---- THE TWO CHAIN LISTS MUST AGREE -----------------------------------------------------------------
// The page offers a destination; the Pages Function decides whether to price it. When the two drift the
// symptom is NOT an error -- on the Stellar build the picker simply showed "0 ASSETS" for the missing
// chains and every quote to them failed as 'unsupported destination asset', which looked like an outage
// rather than a typo. So the build refuses rather than leaving a comment asking someone to remember.
const fn = fs.readFileSync(__dirname + '/../functions/lxapi/oneclick.js', 'utf8');
const fnBlock = fn.match(/const CHAINS = \{([\s\S]*?)\n\};/);
const pgBlock = page.match(/var NI_CHAIN = \{([\s\S]*?)\n  \};/);
if (!fnBlock || !pgBlock) {
  console.error('  could not read the CHAINS / NI_CHAIN maps — aborting');
  process.exit(1);
}
// COMMENTS COME OUT FIRST. Both maps carry prose explaining themselves, and prose contains colons --
// "reach each other through this route: XRP -> XLM" made the server look as though it priced a chain
// called `route`. The gate caught it on its own first run, which is the behaviour wanted, but a
// checker that reports a word from a sentence as a missing chain is a checker nobody will trust twice.
const keysOf = (s) => [...s.replace(/\/\/[^\n]*/g, '').matchAll(/(?:^|[\s,{])([a-z][a-z0-9]*)\s*:/g)]
  .map((m) => m[1]).sort();
const fnKeys = keysOf(fnBlock[1]);
const pgKeys = keysOf(pgBlock[1]);
const missingOnPage = fnKeys.filter((k) => pgKeys.indexOf(k) < 0);
const missingOnServer = pgKeys.filter((k) => fnKeys.indexOf(k) < 0);
if (missingOnPage.length || missingOnServer.length) {
  console.error('  CHAINS and NI_CHAIN disagree — aborting');
  if (missingOnPage.length) console.error('    priced by the function, not offered by the page: ' + missingOnPage.join(', '));
  if (missingOnServer.length) console.error('    offered by the page, not priced by the function: ' + missingOnServer.join(', '));
  process.exit(1);
}

page = injectCollector(page, 'browser/nibridge.js');
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

    // Both the CCTP layer (in case this runs on a fresh container) and the Axelar layer this replaces.
    for (const id of ['lx-cctp-js', OLD, ID]) {
      const gone = stripById(h, id);
      h = gone.html;
      if (id !== ID) stripped += gone.removed;
    }

    // Guard on `br-steps`, which is the bridge's own step rail and appears on exactly the three bridge
    // keys. NOT on id="lxBrPending" -- that element is CREATED by the CCTP layer, so stripping that
    // layer removes the very thing the guard looked for. NOT on br-netbox either: it is on the ACCOUNT
    // pages too, and would have put a bridge on a page about someone's balances. Measured, not assumed.
    if (h.indexOf('br-steps') < 0) { if (h !== before) json[key] = h; continue; }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl NEAR Intents bridge: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); ' + fnKeys.length + ' destination chains agree with the Pages Function; '
  + 'stripped ' + stripped + ' older bridge layer(s)');
if (!pages) { console.error('  ! no page carried br-steps — nothing was wired'); process.exit(1); }
