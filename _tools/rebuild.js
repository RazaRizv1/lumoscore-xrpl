// The XRPL build recipe, in one place.
//
// Everything the fork looks like comes from Stellar's containers; everything it DOES comes from the
// transforms below, applied over them in this order. Running it end to end is how the fork inherits a
// Stellar design fix — copy the base again, re-run, and the fix arrives with no porting.
//
//   node _tools/rebuild.js          re-run the transforms over the current containers (fast, idempotent)
//   node _tools/rebuild.js --base   re-copy the Stellar base first, then run the whole chain
//
// --base READS C:\LumosCore. It never writes there. That repo is git-connected to production, so a
// write is a deploy; this script opens it with readFileSync and nothing else.
//
// WHY THE ORDER MATTERS, in the two places it actually does:
//   * _xrplnav first — later transforms match on routes it rewrites.
//   * _xrpldashtop AFTER _xrpldash — _xrpldash strips the inherited `lx-dashtop` script, and running
//     the replacement before that strip would simply hand it back to be removed again.
//   * _xrplstripstellar last — it removes by id, so it must run after every injector has settled,
//     and running it last also means a re-run cannot leave a stripped layer resurrected.
//   * _xrplbridgepolish AFTER _xrplnearintents — the polish styles the route panel that the bridge
//     client builds, and its stylesheet must land later in source order to win against the design's.
// Everything between is independent; the order there is just stable so diffs stay readable.
//
// _xrplbridge IS GONE FROM THIS LIST, replaced by _xrplnearintents, and that was overdue rather than
// a change of plan. It injected the route-DISCOVERY layer: a live list of the chains Axelar reaches,
// with transfers stated as not wired. All three routes are now built, and _xrplnearintents strips
// `lx-xrplbridge` along with `lx-cctp-js` — so leaving it here injected a layer purely to have it
// removed a step later.
//
// It was ALSO the reason the bridge was one `node _tools/rebuild.js` away from disappearing. The real
// bridge reached production by running its transform BY HAND; this recipe still rebuilt the page with
// the discovery layer, so anyone running the documented command would have quietly shipped a bridge
// that says "Transfers are not enabled from this page yet" over three working routes.
//
// _xrpltypescale IS DELIBERATELY ABSENT. The Stellar base already carries Stellar's 1.1x scale, so
// running it here yields 1.21x — measured: .ft-col h4 at 20.9px on Stellar against 22.99px here,
// which is exactly the "everything is slightly too big" RAZA reported and matched by zooming to 90%.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STELLAR = 'C:' + path.sep + 'LumosCore';

const CHAIN = [
  '_xrplnav', '_xrplconnect', '_xrplwhead', '_xrplfeerate', '_xrplaunchpad', '_xrpldash', '_xrpldashtop', '_xrpltrade',
  '_xrpldexasset', '_xrplpools', '_xrplpoolsmock', '_xrplcreatepool', '_xrplqorders', '_xrplpooldetail', '_xrplaccount', '_xrplwallet', '_xrpltrustbtn', '_xrplrewards',
  '_xrplltoken', '_xrplnearintents', '_xrplbridgepolish', '_xrplsearch', '_xrplcopy', '_xrplreveal', '_xrplseo',
  '_xrplnetpicker', '_xrplchoosenet', '_xrpldashboxes', '_xrpllisting', '_xrplroutes', '_nofollow',
  '_xrplorphan', '_xrplbridgecopy', '_xrplbridgehiw', '_xrpldocs', '_xrplcopy2',
  // AFTER _xrpldocs AND _xrplcopy2, both of which swap Stellar's words for this ledger's. The bridge
  // docs name Stellar on purpose -- it is one of the thirty-nine destinations -- so a generic pass
  // running afterwards would "correct" a chain name into nonsense.
  '_xrplbridgedocs', '_xrplstripstellar',
  // LAST, and that position is load-bearing: it mirrors each page's visible FAQ into its schema.org
  // block, so it must run after every pass that can change that copy. Moved earlier, it would
  // faithfully republish the exact sentences the later passes are about to correct.
  '_xrplfaqld',
];

if (process.argv.indexOf('--base') >= 0) {
  for (const dev of ['desktop', 'mobile']) {
    const from = path.join(STELLAR, 'lumoscore-aptos-' + dev + '.html');
    const to = path.join(ROOT, 'lumoscore-xrpl-' + dev + '.html');
    if (!fs.existsSync(from)) { console.error('missing Stellar base: ' + from); process.exit(1); }
    fs.writeFileSync(to, fs.readFileSync(from));       // read-only on the Stellar side
    console.log('base  ' + dev + '  <- ' + path.basename(from));
  }
}

let failed = 0;
for (const name of CHAIN) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) { console.error('SKIP  ' + name + '  (no such transform)'); failed++; continue; }
  process.stdout.write(name + '\n');
  try {
    execFileSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('FAIL  ' + name);
    failed++;
  }
}

if (failed) { console.error('\n' + failed + ' transform(s) did not complete — NOT safe to build'); process.exit(1); }
console.log('\nchain complete — now: npm run build && npm run predeploy && npm run deploy');
