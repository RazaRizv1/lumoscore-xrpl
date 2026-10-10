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
  '_xrplfaqcard',
  '_xrplfaqld',
  // Removes the inherited auth guard from Bridge and Rewards. Position is not load-bearing — it strips
  // one script by id and nothing downstream re-injects it (checked: the only other mentions of
  // lx-authgate in this repo are two comments). Here so it runs before the page-rebuilding passes
  // below, which would otherwise carry the guard into their rewritten output.
  '_xrplungate',
  // Demotes the hidden network-chooser h1 so each page states one subject. Position is not
  // load-bearing — it rewrites one tag by class and nothing downstream reads h1s — but it sits after
  // the copy passes so it can never be the thing that re-introduces a heading they just corrected.
  '_xrplh1',
  // AFTER _xrplroutes, AND THAT IS NOT A PREFERENCE. The chain switcher is the one layer here whose
  // whole job is to point AWAY from this build, so it is the one layer whose urls _xrplroutes must not
  // touch — and it would touch six of the ten: MAP turns "/trade/stellar" into "/trade/xrpl" and BARE
  // turns "/dashboard" into "/dashboard/xrpl". Injected any earlier, the control would navigate from
  // each page to itself: a switcher that looks live, reports no error, and does nothing.
  //
  // Last rather than merely after _xrplroutes, so the copy passes cannot reach it either. Its menu row
  // reads "Stellar" on purpose. _xrplcopy2 works from an explicit list and preserves that word as a
  // network name, and _xrplstripstellar removes by script id — neither is a hazard today, but the one
  // string this layer cannot afford to have "corrected" is the name of the chain it exists to reach.
  '_xrplchainswitch',
  // AND _nofollow AGAIN, because the pass above rebuilds 94 page keys and a rebuilt page comes back
  // without the rel="nofollow" the earlier run wrote into it. Caught by the predeploy gate on three
  // dex pages, which is the whole reason that gate exists; it is not caught by a successful build.
  // Safe to repeat: it strips its own runtime guard by id before re-adding it, and it only touches
  // <a> tags pointing off-site — the switcher's own targets are internal and script-built, so there
  // is nothing here for it to reach.
  '_nofollow',
  // LAST, and deliberately so. It rewrites the design's static asset-picker buttons, and putting it
  // at the end means no later pass can hand the Aptos mock back — _xrplchainswitch above rebuilds 94
  // page keys, which is already known to drop attributes an earlier pass wrote (see the _nofollow
  // note). Nothing downstream reads those buttons, so there is no cost to running it here, and it is
  // idempotent: a rewritten row is marked data-lxreal="1" and skipped on every subsequent run.
  // Late, for the same reason as the two below: it asserts the MCP page ends up with exactly 14
  // command cards, and _xrplchainswitch above rebuilds 94 page keys. Running before that could have
  // the cards rebuilt away and the assertion fire on a build that was previously fine.
  '_xrplmcptools',
  // After every pass that writes prose, because its whole job is to settle one spelling and any of
  // them could reintroduce the other. Its own guard aborts if a spaced "trust line" survives.
  '_xrpltrustline',
  '_xrplmockassets',
  // Beside _xrplmockassets and for the same reason: last, so no page-rebuilding pass upstream can
  // hand the Aptos strings back. It aborts rather than writing if a ">Aptos" text node survives in
  // any page key it is responsible for, so a moved template fails the build instead of shipping.
  '_xrplaptossweep',
  // The Aptos string _xrplaptossweep could not reach, because it is not design copy: the inherited
  // lx-gate script bakes `var NET="aptos"` — the design CONTAINER's name — and hands it to
  // lxwOpenWallet() and to sessionStorage lumos.connDest whenever no wallet is connected. Rewrites it
  // to "xrpl", makes actNet() prefer the chain named in the url, and drops the stale gate the account
  // pages still carry. Position is not load-bearing: nothing downstream re-injects lx-gate.
  '_xrplwalletgate',
  // The four sign-in icons that 404 silently: two repointed at the network marks that exist, two
  // dead <img> removed so the lettermark behind them is all that is left. Mirrors the ICON_FIX /
  // ICON_DROP block in Stellar's _signinnets.js; /signin is cookie-shared, so both copies need it.
  '_xrplsigninicons',
  // Empties the designer's placeholder user chip, which is hidden from humans by CSS but sits in
  // the HTML an AI crawler reads. Mirrors Stellar's _headerchip.js.
  '_xrplheaderchip',
  // Adds the product hubs to the site-wide footer menu, chain-specific on this build, and undoes
  // three faults in the inherited one: absolute lumoscore.com urls, href=\"#\", and /dashboard
  // labelled Home. Mirrors Stellar's _footernav.js.
  '_xrplfooternav',
  // Dead last, for the same reason as the two above but about CSS rather than prose: it appends one
  // stylesheet to every page key's <head>, and any pass that rebuilds a page key from a donor clone
  // would hand back a head without it. It strips its own block before inserting, so running it here
  // cannot stack copies.
  '_xrplzoomfloor',
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
