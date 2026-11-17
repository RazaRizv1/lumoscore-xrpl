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
  '_xrplnosw', '_xrplnav', '_xrplconnect', '_xrplwhead', '_xrplfeerate', '_xrplaunchpad', '_xrpldash', '_xrpldashtop', '_xrpltrade',
  '_xrpldexasset', '_xrplpools', '_xrplpoolsmock', '_xrplcreatepool', '_xrplqorders', '_xrplpooldetail',
  // Beside _xrplpoolsmock and for the same reason, one page further in: the detail page shipped the
  // design's sample pool baked into the markup -- 847 participants, "Pool ID: a468d4…", a price in
  // APT -- and stated it for up to 2.5s before the real pool replaced it. A script cannot unsay
  // that; the browser paints the parsed document first. Must run after _xrplpooldetail, which is
  // what rebuilds those page keys.
  '_xrplpooldetailmock',
  '_xrplaccount', '_xrplwallet', '_xrpltrustbtn', '_xrplrewards',
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
  // One guard added to the inherited logo healer, which wipes the text of any 1-5 character element
  // it can resolve as a ticker. It already refuses pure digits; it did not refuse "1B", and
  // looksLikeIcon() says yes to anything with a gradient background -- which is exactly how the
  // design paints gradient TEXT. So the $LUMOS supply card's headline was blanked 108 times in 13
  // seconds and the card showed nothing where "1B" belongs. Must run AFTER every pass that rebuilds
  // a page from the design, or the unguarded healer comes back with it; it is idempotent and aborts
  // if the healer's own rule is no longer found, so a re-minified nxnav-js fails the build loudly
  // rather than quietly shipping the blank again.
  '_xrpllogoguard',
  // Stellar's trending-tabs crash, inherited with the containers: the IIFE guards its result but not
  // its lookup, so `tList.closest(...)` throws on every dashboard load and kills the rest of that
  // script block. _page_fixes.js fixed it on Stellar 2026-10-13; this copy predates that. Same place
  // in the order as the logo guard and for the same reason -- it patches inherited design code, so it
  // must run after everything that rebuilds a page from the design, and it aborts if renderTrending
  // is no longer found rather than reporting success over a renamed function.
  '_xrpltrendguard',
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
  // Points the design's own "Launch Token" buttons at /launchpad/xrpl rather than the network
  // chooser, on pages whose url has already answered which network. Runs after the footer nav, which
  // writes chain-specific links of its own and would otherwise be the only part of a page that knew.
  '_xrpllaunchlinks',
  // Dead last, for the same reason as the two above but about CSS rather than prose: it appends one
  // stylesheet to every page key's <head>, and any pass that rebuilds a page key from a donor clone
  // would hand back a head without it. It strips its own block before inserting, so running it here
  // cannot stack copies.
  '_xrplzoomfloor',
  // The wrong-chain notice (RAZA 2026-10-16). After _xrplzoomfloor rather than before it only so the
  // list keeps reading in the order things were added; it is independent of everything above, strips
  // its own three blocks by id before inserting, and so cannot stack copies or be stacked on.
  //
  // IT IS IN THIS LIST BECAUSE OF THE BRIDGE. _xrplbridge's note above records what happens when a
  // transform is run by hand and not written down here: the real bridge reached production that way,
  // and the documented rebuild command would quietly have replaced it with an older layer. A
  // `--base` run re-copies the Stellar containers and re-applies only what this array names, so a
  // layer missing from it is a layer that silently disappears on the next full rebuild.
  '_xrplwrongchain',
  // Patches the INHERITED lx-feemodal so the fee banner repaints when the tier resolves. It edits
  // markup that arrives with the Stellar base rather than injecting its own block, so it has to run
  // after anything that could replace that base — in practice nothing does, but last is the safe
  // place for a patch of someone else's script. Gated on the unpatched marker, so a re-run is a
  // no-op rather than a second brace.
  '_xrplfeebanner',
  // Patches the INHERITED lx-walletlogo so the mark beside the connected address follows the WALLET
  // rather than the page, and stays hidden until that is decided (RAZA 2026-10-17: "there's still a
  // flash on some pages that shows Stellar logo for split seconds"). Same shape as the fee banner
  // above — someone else's script, edited in place, keyed on markers that vanish when applied — so
  // it belongs beside it at the end. _xrplwrongchain used to do the chain half of this; it does not
  // any more, and the two must not both come back, because two writers on that node is the flash.
  '_xrplwalletlogo',
  // LAST, AND THAT IS THE POINT. The phone's bottom bar is design markup inside each mobile page
  // key, not a layer of its own, so ANY transform that rebuilds a page key upstream hands it back
  // carrying the base's bar again -- Pools, and after 2026-11-16 the base's own Launch tab pointing
  // at Stellar's launchpad. Running these two at the end means whatever the chain rebuilt is
  // corrected afterwards rather than before.
  //
  // They are also the reason this pair is in the list at all. Registered the day they were written,
  // rather than left to survive in the containers the way _xrplattrib and _xrpllumoslinks once did:
  // a `rebuild.js --base` would have silently put Pools back on 37 pages with no error anywhere.
  // _xrplnavlaunch re-pins the href on EVERY bar on every run, so inheriting Stellar's tab is
  // self-correcting; _xrpllaunchbar then gives the launchpad page its own bar, Launch lit.
  '_xrplnavlaunch',
  '_xrpllaunchbar',
  // Byte-identical to Stellar's _tools/_poolprefill.js, and that is deliberate: the deposit card is
  // the same markup on both chains, so the layer that fills it from a link is the same file. It is
  // matched to its row BY ASSET CODE rather than by reading the pair out of the path, because the two
  // chains do not share a pool url shape -- /pools/stellar/<a>/<b> against /pools/xrpl/id/<account>.
  //
  // REGISTERED THE DAY IT WAS WRITTEN, for the reason spelled out above _xrplattrib: a transform that
  // lives only in the containers is one a `rebuild.js --base` deletes with no error. It also has to
  // be here because mcp/xrpl.js now drops its NOFILL notice for add_liquidity -- the connector claims
  // the link prefills, so the page had better read it.
  '_poolprefill',
  // Byte-identical to Stellar's _tools/_bridgeprefill.js, same reasoning as _poolprefill above: the
  // bridge is the same three-step wizard on both chains, so one file serves both.
  //
  // It sets the destination network on step 1 and the receiving address on step 2, and deliberately
  // does NOT set the asset or the amount -- the asset picker lists a connected wallet's balances and
  // opens nothing until one is connected, and step 2's amount ships as a <div>, not a field. The
  // header of that file has the measurements. Registered the day it was written, same as the above,
  // and for the harder reason here: mcp/xrpl.js no longer sends NOFILL for bridge, so the connector
  // now tells people the link arrives set up. A `rebuild.js --base` that quietly dropped this layer
  // would turn that into a lie on the one page that moves funds between chains.
  '_bridgeprefill',
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
