// Stellar clean routes, rewritten to their XRPL equivalents.
//
// The build starts from Stellar's containers, and those are full of Stellar's OWN clean routes:
// "/dashboard", "/trade/stellar", "/wallet". XRPL namespaces everything under /xrpl, so every one of
// them is a link or a redirect to a page that does not exist here.
//
// Found the hard way: seeding a connected state and reloading the landing page dropped me on a 404.
// lx-homegate does
//     if(localStorage.getItem("lumos.wallet")||localStorage.getItem("lumos.address"))
//       location.replace("/dashboard");
// which is right on Stellar and a dead end here — so the FIRST thing that happens after connecting a
// wallet on XRPL was a "Page not found". Scanning for the rest of the class found 1,662 references
// across 96 pages.
//
// This is a route rewrite, not a design change: the markup, the labels and the controls are the
// design's own. Only where they point changes.
//
// SAFETY. Each pattern requires a quote immediately before the route and a path/quote/query character
// immediately after, so:
//   - "/xrpl/trade" is never touched (the quote is followed by /xrpl, not by /trade)
//   - "/wallets/foo" is never mistaken for "/wallet" (the lookahead rejects 's')
//   - a full URL to the Stellar site ("https://lumoscore.com/trade/stellar") is left alone, because
//     the character before the route is 'm', not a quote. Those links are correct and must survive.
// Longer routes are listed first so /trade/stellar is consumed before any shorter prefix could be.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const MAP = [
  ['/trade/stellar', '/xrpl/trade'],
  ['/pools/stellar', '/xrpl/pools'],
  ['/account/stellar', '/xrpl/account'],
  ['/list-your-token', '/xrpl/list-your-token'],
  ['/launchpad', '/xrpl/launchpad'],
  ['/dashboard', '/xrpl/dashboard'],
  ['/rewards', '/xrpl/rewards'],
  ['/bridge', '/xrpl/bridge'],
  ['/wallet', '/xrpl/wallet'],
  ['/lumos', '/xrpl/lumos'],
];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

let pages = 0, total = 0;
const per = {};

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let h = json[k];
    const before = h;
    for (const [from, to] of MAP) {
      const re = new RegExp('(["\'`])' + esc(from) + '(?=["\'`/?#])', 'g');
      let n = 0;
      h = h.replace(re, function (_, q) { n++; return q + to; });
      if (n) { per[from] = (per[from] || 0) + n; total += n; }
    }
    if (h !== before) { json[k] = h; changed = true; pages++; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl routes: ' + total + ' reference(s) rewritten across ' + pages + ' page key(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) {
  console.log('   ' + k.padEnd(18) + ' -> ' + (MAP.find(m => m[0] === k)[1]).padEnd(22) + per[k]);
}
