// Stellar clean routes, rewritten to their XRPL equivalents.
//
// The build starts from Stellar's containers, and those are full of Stellar's OWN clean routes:
// "/dashboard", "/trade/stellar", "/wallet". Since 2026-09-15 this build uses the SAME scheme with the chain
// swapped (/trade/xrpl, /pools/xrpl), so only the chain-suffixed routes need rewriting.
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
  // THE ONE CHAIN-SUFFIXED ROUTE THAT IS NOT OURS TO KEEP.
  //
  // The $LUMOS page carries a network chooser — "Choose a network to see its price, pools and
  // holders there" — whose single card reads "Stellar · LUMOS · 1B supply". Without this entry the
  // shorter '/lumos' rule below matched its href and produced "/xrpl/lumos/stellar", which is a
  // 404: six of them, on the SERVED /xrpl/lumos page for both desktop and mobile, and on the three
  // dex-asset pages. A markup link check found it; nothing else could, because the other four
  // chain-suffixed routes are listed here and this one was not.
  //
  // It resolves to the MAIN SITE rather than to /xrpl/lumos. The card names the Stellar token and
  // describes its supply, so sending it to the XRPL page would trade a 404 for a wrong page, which
  // is worse — the reader would have no way to tell they had been redirected. Checked: that URL
  // answers 200. Same reasoning as the shared-page block below.
  // The DAMAGED form has to be listed too, and it is the only form present today. The containers
  // are gitignored and persist between builds, so the shorter '/lumos' rule has already rewritten
  // every one of these in place: what is on disk is "/xrpl/lumos/stellar" (4 desktop, 2 mobile) and
  // the pristine "/lumos/stellar" appears zero times. The rule above cannot match it — the
  // character before "/lumos" is now the 'l' of xrpl, not a quote — so without this line the fix
  // would be a no-op that looked applied. Both are kept: the pristine rule is what a rebuild from
  // clean containers needs, this one is what today's disk needs.
  ['/xrpl/lumos/stellar', 'https://lumoscore.com/lumos/stellar'],
  ['/lumos/stellar', 'https://lumoscore.com/lumos/stellar'],

  // STELLAR'S OWN SCHEME, WITH THE CHAIN SWAPPED (RAZA 2026-09-15). Only the three chain-suffixed
  // routes change; /dashboard, /wallet, /bridge, /launchpad, /rewards, /lumos and /list-your-token are
  // the same paths on both builds and are left exactly as the design wrote them.
  ['/trade/stellar', '/trade/xrpl'],
  ['/pools/stellar', '/pools/xrpl'],
  ['/account/stellar', '/account/xrpl'],

  // The two launchpad sub-pages, which must be consumed BEFORE the bare "/launchpad" in BARE below —
  // longest-first, the rule this table already states. Safe in MAP rather than BARE because neither
  // search string survives inside its own replacement: "/launchpad/review" is not a substring of
  // "/launchpad/xrpl/review", so a second build finds nothing left to rewrite.
  ['/launchpad/review', '/launchpad/xrpl/review'],
  ['/launchpad/confirm', '/launchpad/xrpl/confirm'],

  // THE PREVIOUS SCHEME, /xrpl/<section>, which this table itself used to write. The containers are
  // gitignored and persist between builds, so what is on disk today is that shape, not Stellar's --
  // without these the move would be a no-op on every page. None of the targets contains its source,
  // so a second run finds nothing to do.
  ['/xrpl/list-your-token', '/list-your-token'],
  ['/xrpl/launchpad', '/launchpad'],
  ['/xrpl/dashboard', '/dashboard'],
  ['/xrpl/account', '/account/xrpl'],
  ['/xrpl/rewards', '/rewards'],
  ['/xrpl/bridge', '/bridge'],
  ['/xrpl/wallet', '/wallet'],
  ['/xrpl/trade', '/trade/xrpl'],
  ['/xrpl/pools', '/pools/xrpl'],
  ['/xrpl/lumos', '/lumos/xrpl'],

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
  // MCP is served by this build now (2026-09-15), so its links stay local — including the absolute ones
  // an earlier version of this table wrote into the persisted containers.
  ['https://lumoscore.com/mcp', '/mcp'],
];

// The bare routes this build used to share with Stellar, now chain-qualified. Applied separately from
// MAP with a lookahead that rejects "/" — see the loop below for why that is not optional.
//
// "/lumos" was already handled this way and simply joins the list. The other seven are the surfaces
// that collided with Stellar's: measured before any change, 20 of this build's 27 routes did.
//
// ORDER IS IRRELEVANT HERE, unlike MAP: each is anchored by a quote before and a non-slash after, so
// no entry can match inside another. "/list-your-token" cannot be read as "/list" plus a path, and
// "/launchpad" cannot swallow "/launchpad/review" — the "/" after it is rejected.
//
// NOT HERE: /trade, /pools and /account. MAP already turns Stellar's chain-suffixed forms into XRPL's,
// and the design never writes those bare.
const BARE = [
  '/lumos',
  '/dashboard',
  '/wallet',
  '/bridge',
  '/rewards',
  '/mcp',
  '/list-your-token',
  '/launchpad',
];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

// The SAME shared pages, linked by their design FILENAME rather than by a clean route — 41 distinct
// ones, "lumoscore-mcp.html" alone appearing 53 times. The MAP above cannot see these: it matches a
// route after a quote, and these are filenames.
//
// DERIVED, not listed. The docs are `lumoscore-docs-<topic>.html` on this side and `/docs/<topic>`
// on the main site, so one rule covers all 34 of them and cannot fall out of step with the set the
// way a hand-written list of 41 would.
const SHARED_FILE = /(["'])lumoscore-(about|blog|blog-post|whitepaper|privacy|terms|support|docs-[a-z0-9-]+?)(-mobile|-dark|-light)?\.html\1/g;

// APP pages linked by design filename, which resolve to nothing.
//
// Found by reading every <a href> out of the build and asking the server about each: the $LUMOS page
// carries a visible "Home" link with href="lumoscore-home.html", which from /xrpl/lumos resolves to
// /xrpl/lumoscore-home.html — Page not found. Most filename anchors sit in design templates our
// layers replace before anyone sees them, but "most" is not "all", and the ones that survive are
// invisible to a reader until they click.
//
// Mapped to the same routes the route table serves, so this cannot point somewhere that does not
// exist. A filename that carries no parameter — an asset page, a pool page, an account page — maps
// to its LIST, which is what that filename means without one. Pages with no route at all (signin,
// asset-overview, and the admin set, which is not in the public build) are left alone rather than
// guessed at.
const APP_FILE = {
  'home': '/dashboard',
  'landing': '/',
  'dex': '/trade/xrpl',
  'dex-asset': '/trade/xrpl',
  'amm': '/pools/xrpl',
  'amm-pool': '/pools/xrpl',
  'bridge': '/bridge',
  'wallet': '/wallet',
  'rewards': '/rewards',
  'lumos-token': '/lumos/xrpl',
  'mcp': '/mcp',
  'launch-token': '/launchpad',
  'launch-review': '/launchpad/review',
  'launch-confirm': '/launchpad/confirm',
  'list-token': '/list-your-token',
};

const APP_FILE_RE = new RegExp(
  '(["\'])lumoscore-(' + Object.keys(APP_FILE).join('|') + ')(-mobile|-dark|-light)?\\.html\\1', 'g');

function sharedFileUrl(name) {
  // A blog POST filename carries no slug — there is one design page for every post — so the index
  // is the only honest target. Linking to a guessed slug would be a 404 dressed as a fix.
  if (name === 'blog-post') return 'https://lumoscore.com/blog';
  if (name.indexOf('docs-') === 0) return 'https://lumoscore.com/docs/' + name.slice(5);
  return 'https://lumoscore.com/' + name;
}

let pages = 0, total = 0, files_rewritten = 0, app_rewritten = 0;
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
    // BARE ROUTES BECOME CHAIN-QUALIFIED. "/lumos" was the first of these and is now one of eight.
    //
    // THE LOOKAHEAD MUST NOT ACCEPT "/", and that exclusion is the entire reason these are separate
    // from MAP. The table's rules do accept it, which is right when a replacement cannot contain the
    // thing it matched. Every rule here writes its search string back ("/wallet" -> "/wallet/xrpl"),
    // so under MAP's lookahead a second build would read the already-written "/wallet/xrpl" as
    // "/wallet" followed by a path and append the chain again: "/wallet/xrpl/xrpl". The containers are
    // gitignored and persist between builds, so every transform here runs over its own previous
    // output — a rule that is not idempotent does not fail once, it drifts further on every build.
    //
    // WHY THE SEVEN NEW ONES. This file's header still says these routes "are the same paths on both
    // builds and are left exactly as the design wrote them". That was true while this was a site of
    // its own, and it is exactly what breaks on lumoscore.com: Stellar owns /dashboard, /wallet,
    // /bridge, /launchpad and /rewards there, so an XRPL page linking to a bare route does not so much
    // collide as silently lose — the reader lands on Stellar's page with no sign anything went wrong.
    //
    // /launchpad/review and /launchpad/confirm live in MAP instead, and must: they have to be consumed
    // before the bare "/launchpad" is considered. They are naturally idempotent, because
    // "/launchpad/review" is not a substring of "/launchpad/xrpl/review" — and the no-slash lookahead
    // here means this loop cannot touch them either way.
    for (const bare of BARE) {
      const bre = new RegExp('(["\'`])' + esc(bare) + '(?=["\'`?#])', 'g');
      h = h.replace(bre, function (_, q) {
        per[bare] = (per[bare] || 0) + 1; total++;
        return q + bare + '/xrpl';
      });
    }
    h = h.replace(SHARED_FILE, function (_, q, name) {
      files_rewritten++;
      return q + sharedFileUrl(name) + q;
    });

    // Longest-first is not needed here: the alternation is anchored by a quote on both sides, so
    // "lumoscore-launch-token.html" cannot be read as "lumoscore-launch" plus stray text.
    h = h.replace(APP_FILE_RE, function (_, q, name) {
      app_rewritten++;
      return q + APP_FILE[name] + q;
    });

    if (h !== before) { json[k] = h; changed = true; pages++; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl routes: ' + total + ' route reference(s) and ' + files_rewritten + ' shared-page and ' + app_rewritten + ' app filename(s) rewritten across ' + pages + ' page key(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) {
  // Wide enough for the absolute targets: at 22 the lumoscore.com URLs ran straight into the count
  // and printed "…/lumos/stellar6".
  console.log('   ' + k.padEnd(21) + ' -> ' + ((MAP.find(m => m[0] === k) || [0, '/lumos/xrpl'])[1]).padEnd(38) + per[k]);
}
