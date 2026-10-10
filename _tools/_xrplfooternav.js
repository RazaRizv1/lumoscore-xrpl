// The product hubs in this build's site-wide footer menu — the XRPL half of Stellar's _footernav.js.
//
// Same reason as there (RAZA 2026-10-11, on the sitelinks under the brand result: "I need you to show
// these: Trade, Pools, Cross chain, Launchpad, Lumos Token, Blogs"), and the same honest limit:
// sitelinks cannot be set, only influenced, and the lever is a consistent site-wide internal link with
// a stable label.
//
// THIS BUILD'S FOOTER IS A THIRD SHAPE, not a copy of either Stellar one. Measured in the containers:
//
//   desktop  Menu: <a href="#">Home</a>
//                  <a href="https://lumoscore.com/blog">Blogs</a>
//                  <a href="https://lumoscore.com/about">About</a>
//   mobile   Menu: <a href="/dashboard">Home</a>
//                  <a href="/pools/xrpl">AMM Pools</a>
//                  <a href="/lumos/xrpl">LUMOS Token</a>
//
// Three separate faults in those six links, all fixed here:
//   * ABSOLUTE urls to lumoscore.com, which on staging leave for PRODUCTION — the exact trap that
//     makes a staging check meaningless, and the one _rewardslinks.js was written to undo.
//   * href="#" is not a link to anywhere, in the column whose job is to pass authority.
//   * /dashboard labelled "Home": every mobile page linked the gated, noindexed dashboard.
//
// LINKS ARE CHAIN-SPECIFIC, and that is the difference from the Stellar file. A reader on an XRP
// Ledger page clicking "Trade" wants /trade/xrpl, not the chooser at /trade that would ask them which
// chain they are on when the url already says. The mobile footer already used /pools/xrpl, so this
// follows the pattern this build set rather than importing Stellar's.
//
// /blog and /about have no chain form and stay shared.
//
// Idempotent: each column is rebuilt only while it still matches its original shape.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const FILES = ['lumoscore-xrpl-desktop.html', 'lumoscore-xrpl-mobile.html'];

const LINKS = [
  ['/', 'Home'],
  ['/trade/xrpl', 'Trade'],
  ['/pools/xrpl', 'Pools'],
  ['/bridge/xrpl', 'Cross-Chain'],
  ['/launchpad/xrpl', 'Launchpad'],
  ['/lumos/xrpl', 'LUMOS Token'],
  ['/blog', 'Blogs'],
  ['/about', 'About'],
];
const BLOCK = LINKS.map(([h, t]) => '<a href="' + h + '">' + t + '</a>').join('\n          ');

const VARIANTS = [
  /(<div class="ft-col">\s*<h4>Menu<\/h4>\s*)<a href="#">Home<\/a>\s*<a href="https:\/\/lumoscore\.com\/blog">Blogs<\/a>\s*<a href="https:\/\/lumoscore\.com\/about">About<\/a>/g,
  /(<div class="ft-col">\s*<h4>Menu<\/h4>\s*)<a href="\/dashboard">Home<\/a>\s*<a href="\/pools\/xrpl">AMM Pools<\/a>\s*<a href="\/lumos\/xrpl">LUMOS Token<\/a>/g,
  // REPAIR PASS -- MATCHES THIS TRANSFORM'S OWN EARLIER OUTPUT.
  //
  // The two variants above match the DESIGN's original columns, which is what makes this idempotent:
  // once a column has been rewritten neither matches it again. The cost is that the LINK LIST can
  // never be corrected afterwards. When LINKS gained /launchpad/xrpl in place of /launchpad, every
  // page already carried the old column, nothing matched, nothing was rewritten -- and the MUST check
  // below then failed the whole XRPL build. Measured 2026-10-11: 114 page keys (40 mobile + 74
  // desktop) still pointing Launchpad at the /launchpad chooser, and `node _tools/rebuild.js` exiting
  // "1 transform(s) did not complete -- NOT safe to build" on every run since.
  //
  // So match the stale shape exactly, and only that. It cannot re-match its own replacement: the
  // quote after /launchpad is required, and the new column reads /launchpad/xrpl.
  /(<div class="ft-col">\s*<h4>Menu<\/h4>\s*)<a href="\/">Home<\/a>\s*<a href="\/trade\/xrpl">Trade<\/a>\s*<a href="\/pools\/xrpl">Pools<\/a>\s*<a href="\/bridge\/xrpl">Cross-Chain<\/a>\s*<a href="\/launchpad">Launchpad<\/a>\s*<a href="\/lumos\/xrpl">LUMOS Token<\/a>\s*<a href="https:\/\/lumoscore\.com\/blog">Blogs<\/a>\s*<a href="https:\/\/lumoscore\.com\/about">About<\/a>/g,
];

// Every page with a footer must reach all six, or the signal is inconsistent — which is worse than not
// sending it, because a sitelink is chosen on consistency.
const MUST = ['/trade/xrpl', '/pools/xrpl', '/bridge/xrpl', '/launchpad/xrpl', '/lumos/xrpl', '/blog'];

let files = 0, pages = 0;
for (const file of FILES) {
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string') continue;
    let hit = false;
    for (const re of VARIANTS) {
      re.lastIndex = 0;
      if (!re.test(h)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      h = h.replace(re, '$1' + BLOCK);
      hit = true;
    }
    if (hit) { json[key] = h; pages++; }
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl footer nav: product hubs added to the Menu column on ' + pages
  + ' page key(s) across ' + files + ' container(s)');

let bad = 0;
for (const file of FILES) {
  let data; try { data = read(file); } catch (e) { continue; }
  const { json } = getContents(data);
  for (const key of Object.keys(json)) {
    const h = json[key];
    if (typeof h !== 'string' || h.indexOf('<h4>Menu</h4>') < 0) continue;
    // Admin is a separate build on its own origin, noindexed, with no public product nav.
    if (/^lumoscore-admin-/.test(key)) continue;
    // THE LANDING PAGE HAS ITS OWN MENU AND KEEPS IT: #products and #networks are in-page scroll
    // anchors, which is a landing-page nav rather than a site nav, and rewriting it would replace a
    // working scroll menu with links that leave the page. It is also DROPPED on the combined deploy --
    // "xrpl '/' dropped, the landing page stays Stellar's" -- so on lumoscore.com this file is never
    // served at all, and RAZA has asked for the landing to be left alone.
    if (/^lumoscore-landing/.test(key)) continue;
    for (const href of MUST) {
      if (h.indexOf('href="' + href + '"') < 0) {
        bad++; console.error('  ! ' + key + ': no footer link to ' + href);
        break;
      }
    }
  }
}
if (bad) process.exit(1);
