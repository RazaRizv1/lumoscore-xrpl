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
const fn = fs.readFileSync(__dirname + '/../functions/lxapi/xrploneclick.js', 'utf8');
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

// ---- THE SHIPPED ARTWORK, STAMPED IN --------------------------------------------------------------
// The client prefers assets/networks/<slug>.png over the CoinGecko proxy, and two facts about those
// files belong to the BUILD rather than to the browser: which of them exist, and what version they are.
//
// WHY A VERSION AT ALL. dist/_headers serves /assets/* as 'max-age=31536000, immutable', so a browser
// that has fetched a logo will not revalidate it for a YEAR. Replacing a file in place reaches nobody
// who has visited before -- the Stellar build hit exactly this, with RAZA still seeing an old mark long
// after a build that definitely shipped the new one. The token below is a hash of the logo bytes, so it
// moves only when a logo actually changes, and then busts all of them exactly once.
const crypto = require('crypto');
const A_NET = __dirname + '/../assets/networks';
const A_NI = __dirname + '/../assets/tokens/ni';
const ICONV = (() => {
  try {
    const h = crypto.createHash('md5');
    fs.readdirSync(A_NET).sort().forEach((n) => { h.update(n); h.update(fs.readFileSync(A_NET + '/' + n)); });
    return h.digest('hex').slice(0, 8);
  } catch (e) { return '0'; }
})();
const NI_TOKENS = (() => {
  const o = {};
  try { fs.readdirSync(A_NI).forEach((f) => { const m = f.match(/^([A-Za-z0-9._-]+)\.png$/); if (m) o[m[1]] = 1; }); } catch (e) {}
  return o;
})();
const NET_FILES = (() => {
  const o = {};
  try { fs.readdirSync(A_NET).forEach((f) => { const m = f.match(/^([A-Za-z0-9._-]+)\.png$/); if (m) o[m[1]] = 1; }); } catch (e) {}
  return o;
})();
// A PLACEHOLDER THAT DOES NOT GET REPLACED IS A BROKEN URL ON EVERY LOGO, and it would ship looking
// fine to every check that does not fetch an image. Renaming one in the client is the obvious way to
// cause it, so the build refuses rather than emitting `?v=__LX_ICONV__`.
for (const tok of ['__LX_ICONV__', '__LX_NI_TOKENS__', '__LX_NET_FILES__']) {
  if (page.indexOf(tok) < 0) {
    console.error('  ' + tok + ' is not in browser/nibridge.js — the logo stamp has nowhere to go, aborting');
    process.exit(1);
  }
}
page = page.split('__LX_ICONV__').join(ICONV)
  .split('__LX_NI_TOKENS__').join(JSON.stringify(NI_TOKENS))
  .split('__LX_NET_FILES__').join(JSON.stringify(NET_FILES));

// WHICH DESTINATIONS STILL HAVE NO MARK, said out loud on every run. The client falls back to a grey
// letter disc, which is honest and not a failure -- but silence is how thirty-four of them came to
// look like that without anyone noticing.
const want = [...(page.match(/var NET_FILE = \{([\s\S]*?)\n  \};/) || [null, ''])[1]
  .matchAll(/:\s*'([a-z0-9]+)'/g)].map((m) => m[1]);
const noArt = [...new Set(want.filter((f) => !NET_FILES[f]))];

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
    //
    // `lx-bridge3js` joins them, and it is the subtlest of the three. It is Stellar build output that
    // fills the REVIEW legs' network icons by copying innerHTML out of the source wallet chip and the
    // destination trigger. On this build the source chip carries the XRP TOKEN logo, so it kept
    // putting a token mark into a network slot -- and it never touched the ASSET slots at all, which
    // is why a transfer to Cosmos Hub showed a hardcoded XRP mark beside "4.157246 ATOM". The bridge
    // client paints all four slots itself; leaving this in place would be a second writer racing it
    // on a 250ms interval.
    for (const id of ['lx-cctp-js', 'lx-bridge3js', OLD, ID]) {
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
console.log('  logos: ' + Object.keys(NET_FILES).length + ' network, ' + Object.keys(NI_TOKENS).length
  + ' token, v=' + ICONV + (noArt.length ? ('; no artwork yet for ' + noArt.join(', ')) : ''));
if (!pages) { console.error('  ! no page carried br-steps — nothing was wired'); process.exit(1); }
