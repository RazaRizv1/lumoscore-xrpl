// Remove inherited Stellar layers that cannot work on this build.
//
// The fork is built from Stellar's containers, so it inherits every Stellar data layer along with the
// design. Each one either calls horizon.stellar.org or a /lxapi endpoint this project does not serve,
// so at best it is dead weight and at worst it fights an XRPL layer for the same element and wins.
//
// Measured before writing this: 96 pages carried horizon.stellar.org, and the wallet page's headline
// read "31,108.45 APT" above a correctly priced list of real XRP Ledger holdings, because two layers
// were writing the same node.
//
// WHAT IS SAFE TO STRIP, and why each of these is:
//
//   lx-swapcalc   Stellar swap quoting, 288 horizon refs. The Custom Swap dialog's MARKUP is
//                 build-time and survives; only the Stellar logic behind it goes. There is no XRPL
//                 swap yet, so nothing working is lost — an XRPL implementation is a feature to
//                 build (quote + OfferCreate + lxc.submit), not a port.
//   lx-qorders    Stellar open orders. Replaced by paintOrders() in browser/wallet.js, which reads
//                 account_offers.
//   lx-wclaim     Stellar claimable balances — a feature this ledger does not have. Replaced by
//                 paintClaimable(), which reads Checks, the nearest real equivalent.
//   lx-poolwarm   A prefetch for Stellar pool endpoints. Pure dead requests, owns no UI.
//   lx-actbeacon  Posts to /lxapi/act, which only the Stellar project serves. Owns no UI.
//   lx-walletdata Stellar's wallet layer, replaced by browser/wallet.js. _xrplwallet already strips it
//                 on the 3 wallet page keys it injects into; it was still live on 28 CONTENT pages
//                 (docs, blog, terms, whitepaper) that carry no wallet markup at all, firing Horizon
//                 requests on every page view for a list nothing renders.
//   lx-lumosparent  Stellar's multi-network LUMOS router. On /lumos it either redirects to a
//                 per-chain child route or reveals a "Choose a network" picker that ships `hidden`.
//                 This fork has ONE network and no child routes, so it always took the second branch:
//                 the $LUMOS nav item led to a picker offering "Stellar — LUMOS · 1B supply" (the
//                 wrong chain's token, linking to /lumos/stellar, which 404s) beside "XRP Ledger
//                 — Planned · Upcoming", which is simply false — LUMOS is live here, blackholed, with
//                 999,955,353 issued. Meanwhile the REAL token page was in the same markup all along,
//                 suppressed. Removing the router leaves the picker hidden as it ships and lets
//                 browser/ltoken.js paint the page, which is what the route should have been.
//   lx-mobwallet  Stellar's MOBILE wallet layer, on lumoscore-wallet-mobile. Two reasons, and the
//                 second is the one that matters: it writes #assetList, which browser/wallet.js also
//                 paints, so the phone showed whichever finished last; and it wires the Send and Swap
//                 modals to build a STELLAR asset list and submit a STELLAR transaction. On an XRP
//                 Ledger wallet a Send button that does that is worse than one that does nothing, so
//                 it goes, and mobile Send now matches desktop: awaiting an XRPL write path.
//
// NOT IN THIS LIST, BUT GONE — and the note that used to be here was out of date:
//
//   lx-listtoken  the paid curated-listing flow on lumoscore-list-token{,-mobile}, which took a
//                 payment on STELLAR MAINNET from an XRP Ledger page. It used to be described here as
//                 "deliberately left in place, raised with RAZA". It is now stripped by
//                 _xrpllisting.js, in the same step that injects the XRPL listing layer, so the page
//                 is never left with neither. Verified 2026-09-15: no lx-listtoken and no Stellar
//                 network passphrase on either page; the one horizon.stellar.org string still there
//                 is an explanatory comment inside lx-xrplfeerate, not a request.
//
// NOT stripped anywhere: anything that draws UI the design expects and has no XRPL replacement yet.
// Removing markup to silence a failing script would change the design, which is not this project's
// job — see the note in _xrpldashboxes about the product cards.
//
// Idempotent, and safe to run before or after the injecting transforms: it only removes by id.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const DEAD = ['lx-swapcalc', 'lx-qorders', 'lx-wclaim', 'lx-poolwarm', 'lx-actbeacon',
  'lx-walletdata', 'lx-mobwallet', 'lx-lumosparent'];

let files = 0, pages = 0;
const per = {};

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    let touched = 0;
    for (const id of DEAD) {
      const r = stripById(h, id);
      h = r.html;
      if (r.removed) { per[id] = (per[id] || 0) + r.removed; touched += r.removed; }
    }
    if (touched) { json[key] = h; changed = true; pages++; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

const total = Object.values(per).reduce((a, b) => a + b, 0);
console.log('xrpl strip stellar: ' + total + ' block(s) from ' + pages + ' page key(s) across ' + files + ' container(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) console.log('   ' + k.padEnd(16) + per[k]);
