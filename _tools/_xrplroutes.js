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

  // THE SHARED PAGES POINT AT THE MAIN SITE, ABSOLUTELY.
  //
  // Docs, blog, about, whitepaper and the legal pages exist once for the company and are live on
  // lumoscore.com; this build deliberately does not route them (see ROUTES in extract_site.js). The
  // links were left as bare "/docs", "/blog", and that only resolves to the main site when this
  // build is served under lumoscore.com/xrpl/. On any other host — every preview deploy, which is
  // where the fork is actually being tested — all eight of them 404, including Documentation in the
  // sidebar and the entire footer.
  //
  // An absolute URL is correct on BOTH hosts, so this is not a staging workaround: it says the thing
  // the routing decision already assumed. Each target was checked against the live site (all 200)
  // before being written here — a link that trades a 404 for a different 404 is not a fix.
  ['/whitepaper', 'https://lumoscore.com/whitepaper'],
  ['/privacy', 'https://lumoscore.com/privacy'],
  ['/support', 'https://lumoscore.com/support'],
  ['/about', 'https://lumoscore.com/about'],
  ['/terms', 'https://lumoscore.com/terms'],
  ['/docs', 'https://lumoscore.com/docs'],
  ['/blog', 'https://lumoscore.com/blog'],
  ['/faq', 'https://lumoscore.com/faq'],
  ['/mcp', 'https://lumoscore.com/mcp'],
];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

// The SAME shared pages, linked by their design FILENAME rather than by a clean route — 41 distinct
// ones, "lumoscore-mcp.html" alone appearing 53 times. The MAP above cannot see these: it matches a
// route after a quote, and these are filenames.
//
// DERIVED, not listed. The docs are `lumoscore-docs-<topic>.html` on this side and `/docs/<topic>`
// on the main site, so one rule covers all 34 of them and cannot fall out of step with the set the
// way a hand-written list of 41 would.
const SHARED_FILE = /(["'])lumoscore-(mcp|about|blog|blog-post|whitepaper|privacy|terms|support|docs-[a-z0-9-]+?)(-mobile|-dark|-light)?\.html\1/g;

function sharedFileUrl(name) {
  // A blog POST filename carries no slug — there is one design page for every post — so the index
  // is the only honest target. Linking to a guessed slug would be a 404 dressed as a fix.
  if (name === 'blog-post') return 'https://lumoscore.com/blog';
  if (name.indexOf('docs-') === 0) return 'https://lumoscore.com/docs/' + name.slice(5);
  return 'https://lumoscore.com/' + name;
}

let pages = 0, total = 0, files_rewritten = 0;
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
    h = h.replace(SHARED_FILE, function (_, q, name) {
      files_rewritten++;
      return q + sharedFileUrl(name) + q;
    });

    if (h !== before) { json[k] = h; changed = true; pages++; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl routes: ' + total + ' route reference(s) and ' + files_rewritten + ' shared-page filename(s) rewritten across ' + pages + ' page key(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) {
  console.log('   ' + k.padEnd(18) + ' -> ' + (MAP.find(m => m[0] === k)[1]).padEnd(22) + per[k]);
}
