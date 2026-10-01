// Assemble ONE deployable tree serving both networks: Stellar at its own urls, XRPL under /<x>/xrpl.
//
//   node _tools/combine_with_stellar.js            report what it would do
//   node _tools/combine_with_stellar.js --write    build dist-combined/ and functions-combined/
//
// WHY A SCRIPT AND NOT A MERGE. Both builds emit the same 97 filenames — each calls its trade page
// lumoscore-dex — so copying one dist over the other makes /trade/xrpl and /trade/stellar resolve to
// the same file and show the same network. This build is produced WITHOUT --root so its pages land in
// dist/xrpl/, and its routes point there; nothing is renamed and no page is edited.
//
// C:/LumosCore IS READ-ONLY HERE. That repo is git-connected to production — a write there is a
// deploy. Everything is copied out of it and nothing is copied into it.
//
// STELLAR IS ALL BUT UNMODIFIED. Every Stellar route keeps its target, every Stellar asset is left as
// it is, and the landing page's content and layout are untouched. The combined tree ADDS: the /xrpl
// page folder, XRPL's 16 page routes, three Functions that exist nowhere in Stellar, XRPL's route pairs
// appended to the middleware, and the twelve assets only XRPL uses.
//
// ONE EXCEPTION, and it is deliberate: a single <script defer> tag is appended to the Stellar pages
// that carry "Choose a network", loading XRPL's connect layer in dormant mode. That is what lets the
// chooser connect XRP Ledger in place rather than navigating away first. Nothing is removed, nothing
// else is rewritten, and C:/LumosCore's own build is not touched at all — the tag exists only in this
// combined output, because only here is there another chain to choose.
const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const STELLAR = 'C:/LumosCore';
const XRPL = path.resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_OUT = XRPL + '/.deploy';
const OUT = ROOT_OUT + '/dist';
const FN_OUT = ROOT_OUT + '/functions';

function die(m) { console.error('  ABORT: ' + m); process.exit(1); }
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d, skip);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

// ---- preconditions -------------------------------------------------------------------------------
// Each is something that, if wrong, produces a tree that looks right and serves the wrong network.
if (!fs.existsSync(STELLAR + '/dist/_redirects')) die('no Stellar build at ' + STELLAR + '/dist');
if (!fs.existsSync(XRPL + '/dist/xrpl/_redirects')) {
  die('no subfolder XRPL build. Run:  node _tools/extract_site.js xrpl   (WITHOUT --root)');
}

// The subfolder build is the one whose routes point into /xrpl. A --root build has the same filenames
// and would be silently wrong, so check a route rather than the directory's existence.
const xRed = fs.readFileSync(XRPL + '/dist/xrpl/_redirects', 'utf8');
if (!/^\/trade\/xrpl\s+\/xrpl\/lumoscore-dex\b/m.test(xRed)) {
  die('dist/xrpl/_redirects does not target /xrpl/* — that is a --root build in the wrong place');
}

// ---- static -------------------------------------------------------------------------------------
console.log('  assembling ' + (WRITE ? '' : '(dry run) ') + 'dist-combined/');
if (WRITE) { rm(ROOT_OUT); }

let sN = 0, xN = 0;
if (WRITE) {
  // Stellar first, whole and unmodified — including its _redirects, which is rewritten below.
  sN = copyDir(STELLAR + '/dist', OUT, (n) => n === 'xrpl');
  // then XRPL's pages into /xrpl. Its own _redirects/_headers/_routes.json are NOT carried: the
  // deployment reads those from the root only, and XRPL's would be ignored at best.
  xN = copyDir(XRPL + '/dist/xrpl', OUT + '/xrpl',
    (n) => n === '_redirects' || n === '_headers' || n === '_routes.json' || n === '404.html');
}
console.log('    stellar files : ' + (WRITE ? sN : 'n/a (dry run)'));
console.log('    xrpl files    : ' + (WRITE ? xN : 'n/a (dry run)') + '  -> /xrpl');

// ---- the assets XRPL has and Stellar does not ----------------------------------------------------
// XRPL's pages are served from /xrpl but reference assets ROOT-relative — "/assets/networks/axelar.png"
// — so in the combined tree every one of them resolves against STELLAR's asset directory. Most do
// resolve: the two builds share a base and 222 of 234 files are byte-for-byte the same. Twelve are not,
// and all twelve belong to features that exist only on this side: Axelar, NEAR Intents, Cosmos Hub,
// Abstract, Aleo, zkSync Era and Stellar's own mark (which XRPL needs and Stellar, being Stellar, does
// not ship), plus the five NEAR Intents token icons under tokens/ni.
//
// Found by diffing the two asset trees rather than by browsing the staging deploy, because a missing
// image is the failure mode a page does not report: the bridge network list renders, each row has its
// name, and six of fifty-nine simply have an empty circle where the logo goes.
//
// ADDITIVE ONLY. A file already present from Stellar is never replaced — that is what keeps "every
// Stellar file lands byte-identical" true — and the count of refused overwrites is printed, because a
// same-named file whose contents differ is a collision somebody should look at, not something to
// quietly resolve in favour of either side.
//
// THE FIVE COLLISIONS AS OF 2026-10-01, each checked rather than waved through, because a trade hero
// from the wrong chain would be exactly the kind of thing this script is supposed to catch:
//   hero/trade-hero-{dark,light}.svg   LINE ENDINGS ONLY. Byte-for-byte the same markup, the same
//                                      viewBox and the same gradient stops; the 14-byte delta is CRLF.
//   tokens/launchpad-icons.json        LINE ENDINGS ONLY. 27 keys on both sides, no key missing from
//                                      either, and no value differing.
//   networks/thorchain.png             Two renditions of THORChain's own logo at different sizes.
//   tokens/ni/WBTC.png                 Likewise, wrapped Bitcoin's.
// Keeping Stellar's is right for all five. For the last two it is also the only safe answer: Stellar's
// bridge renders thorchain.png too, so replacing it would change a Stellar page.
let aAdded = 0, aSame = 0, aClash = [];
if (WRITE) {
  const SA = XRPL + '/dist/assets';
  (function walk(rel) {
    const dir = rel ? SA + '/' + rel : SA;
    if (!fs.existsSync(dir)) return;
    for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + en.name : en.name;
      if (en.isDirectory()) { walk(r); continue; }
      const dst = OUT + '/assets/' + r;
      if (fs.existsSync(dst)) {
        if (fs.readFileSync(dst).equals(fs.readFileSync(SA + '/' + r))) aSame++;
        else aClash.push(r);
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(SA + '/' + r, dst);
      aAdded++;
    }
  })('');
}
console.log('    xrpl assets   : ' + (WRITE ? ('+' + aAdded + ' added, ' + aSame + ' already identical'
  + (aClash.length ? ', ' + aClash.length + ' SAME NAME DIFFERENT BYTES (kept Stellar\'s): '
    + aClash.join(', ') : '')) : 'n/a (dry run)'));

// ---- XRPL's connect layer, on Stellar's pages -----------------------------------------------------
// So that "Choose a network" can connect XRP Ledger IN PLACE, the way it already connects Stellar in
// place, instead of navigating to an XRPL page first and opening the picker there.
//
// This is the one thing in this script that edits a Stellar file, and it only makes sense here: the
// standalone Stellar site has no XRPL to offer, so the module would be dead weight in that repo. Doing
// it at the seam keeps C:/LumosCore's own build exactly as it was.
//
// INJECTED DORMANT. window.__lxcNoBoot is set before the module, so it defines window.lxc and stops.
// Without that it would run resume() and watchWalletChip() on load, and the two builds share their
// storage keys -- lumos.address / lumos.wallet -- so it would read a Stellar G-address as an XRPL
// session and fight Stellar's own connect layer over the top-bar chip.
//
// One hashed file for all of them rather than inline per page: Stellar's pages are externalised, so the
// browser fetches this once and reuses it across the site.
let xcFile = null, xcPages = 0;
if (WRITE) {
  const core = fs.readFileSync(XRPL + '/_tools/xrpl-core.js', 'utf8');
  const page = fs.readFileSync(XRPL + '/_tools/browser/connect.js', 'utf8');
  // Without the guard this module boots on every Stellar page. Checked rather than assumed, because
  // the failure is silent and looks like Stellar's own wallet state going strange.
  if (page.indexOf('__lxcNoBoot') < 0) {
    die('_tools/browser/connect.js has no __lxcNoBoot guard — injecting it would boot XRPL\'s connect '
      + 'layer on Stellar pages and let it adopt a Stellar address');
  }
  for (const s of [core, page]) {
    if (s.indexOf('</' + 'script') >= 0) die('the XRPL connect source contains a closing script tag');
  }
  const bundle = '/* XRPL connect, dormant — woken only by the network chooser. */\n'
    + 'window.__lxcNoBoot=1;\n' + core + '\n' + page + '\n';
  const hash = require('crypto').createHash('sha256').update(bundle).digest('hex').slice(0, 12);
  xcFile = 'lx-xrplconnect-' + hash + '.js';
  fs.mkdirSync(OUT + '/assets/js', { recursive: true });
  fs.writeFileSync(OUT + '/assets/js/' + xcFile, bundle);

  // Only Stellar's own pages, and only the ones that actually offer the chooser. readdirSync(OUT) lists
  // the top level, so /xrpl's pages are never touched — they carry their own copy already.
  const tag = '<script src="/assets/js/' + xcFile + '" defer></' + 'script>';
  for (const f of fs.readdirSync(OUT)) {
    if (!f.endsWith('.html')) continue;
    const p = OUT + '/' + f;
    let h = fs.readFileSync(p, 'utf8');
    if (h.indexOf('lxChooseNetwork') < 0 || h.indexOf(xcFile) >= 0) continue;
    const bi = h.lastIndexOf('</body>');
    fs.writeFileSync(p, bi >= 0 ? h.slice(0, bi) + tag + h.slice(bi) : h + tag);
    xcPages++;
  }
}
console.log('    xrpl connect  : ' + (WRITE ? (xcFile + ' on ' + xcPages + ' stellar page(s), dormant')
  : 'n/a (dry run)'));

// ---- routes ---------------------------------------------------------------------------------------
// Only XRPL's PAGE routes are taken. Its ALIASES and CASE_FIXES (/blogs, /Dashboard -> /dashboard,
// /lumoscore-landing -> /) are the same rules Stellar already publishes, and a second copy of a 301
// is at best noise and at worst an ordering surprise.
let xRoutes = xRed.split('\n')
  .filter((l) => /^\/\S+\s+\/xrpl\/\S+\s+200\s*$/.test(l.trim()));
if (!xRoutes.length) die('found no /xrpl page routes to merge');

const sRed = fs.readFileSync(STELLAR + '/dist/_redirects', 'utf8');

const sPaths = new Set(sRed.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((p) => p && p.startsWith('/')));

// A PATH BOTH BUILDS CLAIM IS A SHARED PAGE, not a collision.
//
// The authgated surfaces — /dashboard, /wallet, /launchpad and the two launchpad steps — are one url
// each, because the gate bounces anyone without a wallet: they are never indexed and never shared, so a
// per-chain url would only ever be a second private link to the same screen. Stellar's route stays and
// serves the url; the middleware swaps in this build's file when the lx_chain cookie says xrpl. So the
// XRPL line is dropped rather than appended, and the pair is recorded in CHAIN_ALT below.
//
// Anything else both builds claim IS a collision and still aborts: Pages applies the first match, so a
// genuine duplicate would silently serve Stellar's page under an XRPL url forever.
const sharedPaths = xRoutes.map((l) => l.trim().split(/\s+/)[0]).filter((p) => sPaths.has(p));
const GATED = new Set(['/dashboard', '/wallet', '/launchpad', '/launchpad/review', '/launchpad/confirm']);
const badShadow = sharedPaths.filter((p) => !GATED.has(p));
if (badShadow.length) die('these XRPL routes collide with Stellar: ' + badShadow.join(', '));
// Every gated path must actually be claimed by both, or one chain has silently lost its page.
const missingShared = [...GATED].filter((p) => !sharedPaths.includes(p));
if (missingShared.length) {
  die('these shared gated paths are not served by the XRPL build: ' + missingShared.join(', ')
    + ' — check ROUTES in the XRPL extract_site.js');
}
xRoutes = xRoutes.filter((l) => !GATED.has(l.trim().split(/\s+/)[0]));

// THE SWITCHER'S TARGETS MUST BE REAL ROUTES, in both directions. Each build ships a control pointing
// into the other build's url scheme — _xrplchainswitch.js here, chainHref in Stellar's _mc_engine.js —
// and neither scheme is derivable from the other: Stellar serves /trade/stellar but /dashboard bare.
// A section renamed on either side turns a working-looking chip into a 404, and a 404 reached by
// clicking a chip is not reported as a routing bug. Checked HERE because this is the only script that
// necessarily holds both route tables.
const xPagePaths = new Set(xRoutes.map((l) => l.trim().split(/\s+/)[0]));
const swBad = [];
for (const [k, v] of Object.entries(require(__dirname + '/_xrplchainswitch_map.json'))) {
  if (!sPaths.has(v)) swBad.push('xrpl ' + k + ' -> ' + v + ' (not a Stellar route)');
}
const sEng = fs.readFileSync(STELLAR + '/_tools/_mc_engine.js', 'utf8');
const toXrpl = sEng.match(/var TO_XRPL=\{[\s\S]*?\};/);
if (!toXrpl) die('could not read TO_XRPL out of Stellar\'s _mc_engine.js');
for (const [k, v] of Object.entries(new Function('return ' + toXrpl[0].replace(/^var TO_XRPL=/, '').replace(/;$/, ''))())) {
  if (!xPagePaths.has(v)) swBad.push('stellar ' + k + ' -> ' + v + ' (not an XRPL route)');
}
if (swBad.length) die('chain-switch targets that do not resolve:\n      ' + swBad.join('\n      '));
console.log('    chain switch  : both directions verified against the other build\'s routes');

const combinedRed = sRed.replace(/\s*$/, '\n')
  + '\n# ---- XRPL, served from /xrpl/ — appended by _tools/combine_with_stellar.js ----\n'
  + '# Stellar\'s rules above are untouched and match first.\n'
  + xRoutes.join('\n') + '\n';
console.log('    xrpl routes   : ' + xRoutes.length + ' appended, 0 shadowing Stellar');

// ---- functions ------------------------------------------------------------------------------------
// Only the ones that exist nowhere in Stellar. Every other Function this build uses is already there
// byte-identical; the two that were NOT were chain-specific and have been renamed in this repo, which
// is why nothing here has to choose a winner.
let fnAdded = [];
if (WRITE) {
  // WHAT THE FUNCTIONS IMPORT FROM OUTSIDE functions/, derived rather than listed.
  //
  // Stellar's Functions reach up into the REPO ROOT — '../../_lib/*' for rate limiting and admin auth,
  // '../mcp/tools.js' for the MCP tool table. Those directories sit beside functions/, not inside it,
  // so a deploy root holding only dist/ and functions/ fails to BUILD. That failure is at least loud;
  // the quiet version of the same mistake is the --cwd one below.
  //
  // Scanned instead of hardcoded, because the list is the Functions' business and not this script's:
  // a new import that escapes functions/ should be carried automatically rather than discovered as a
  // build error at the worst moment. Today it finds _lib and mcp.
  const extraRoots = new Set();
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const re = /from\s+['"]([^'"]+)['"]/g;
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = re.exec(src))) {
        if (m[1][0] !== '.') continue;
        const abs = path.resolve(path.dirname(p), m[1]).split(path.sep).join('/');
        if (abs.toLowerCase().startsWith((STELLAR + '/functions').toLowerCase())) continue;
        extraRoots.add(abs.slice(STELLAR.length + 1).split('/')[0]);
      }
    }
  })(STELLAR + '/functions');
  for (const r of extraRoots) {
    if (!fs.existsSync(STELLAR + '/' + r)) die('Functions import from ' + r + ', which is not in the Stellar repo');
    copyDir(STELLAR + '/' + r, ROOT_OUT + '/' + r);
  }
  console.log('    support dirs  : ' + (Array.from(extraRoots).join(', ') || 'none'));

  copyDir(STELLAR + '/functions', FN_OUT);
  const sFns = new Set(fs.readdirSync(STELLAR + '/functions/lxapi'));
  for (const f of fs.readdirSync(XRPL + '/functions/lxapi')) {
    if (sFns.has(f)) {
      // identical by construction — assert it rather than assume
      const a = fs.readFileSync(STELLAR + '/functions/lxapi/' + f, 'utf8');
      const b = fs.readFileSync(XRPL + '/functions/lxapi/' + f, 'utf8');
      if (a !== b) die('Function ' + f + ' differs between the repos — resolve it, do not pick one');
      continue;
    }
    fs.copyFileSync(XRPL + '/functions/lxapi/' + f, FN_OUT + '/lxapi/' + f);
    fnAdded.push(f);
  }
}
console.log('    functions     : ' + (WRITE ? ('+' + fnAdded.length + ' (' + fnAdded.join(', ') + ')') : 'n/a (dry run)'));

// ---- middleware -----------------------------------------------------------------------------------
// The one file both builds genuinely have to share. It resolves desktop vs mobile per route, so the
// combined deployment needs BOTH tables. Built here rather than committed, because each repo's own
// build regenerates this file and would wipe an edit.
//
// XRPL's "/" entry is dropped on purpose: that is its landing page, and the landing page on the main
// site stays Stellar's.
function tableOf(src, name) {
  const m = src.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\n\\]);'));
  if (!m) die('could not read ' + name + ' out of a _middleware.js');
  return JSON.parse(m[1]);
}
function setOf(src) {
  const m = src.match(/const HAS_MOBILE = new Set\((\[[\s\S]*?\])\);/);
  if (!m) die('could not read HAS_MOBILE out of a _middleware.js');
  return JSON.parse(m[1]);
}
// A PAGE TARGET IS WRITTEN WITHOUT A LEADING SLASH, and that is load-bearing rather than cosmetic.
//
// The middleware serves the phone build with
//     ASSETS.fetch(new Request(new URL('/' + hit.mobile, request.url)))
// and Stellar's targets are bare names ("lumoscore-dex"), so that composes to /lumoscore-dex-mobile.
// The subfolder build writes its targets WITH the prefix attached — "/xrpl/lumoscore-dex" — and
// '/' + '/xrpl/...' is '//xrpl/...', which a URL parses as a PROTOCOL-RELATIVE url: "xrpl" becomes the
// hostname and the path left over is "/lumoscore-dex-mobile". That is Stellar's file.
//
// So every XRPL route on a phone served Stellar's equivalent page. Not a 404 — a complete, working
// trade page reading from Horizon, under the url /trade/xrpl. Caught by fetching the deployed page with
// an iPhone user-agent and finding horizon.stellar.org in it; nothing about the build reported a problem,
// and the desktop path was correct throughout because desktop never takes this branch.
//
// Stripping the slash fixes it at the one place the two conventions meet, and the assertion below is
// what stops it coming back: the whole defect was one string concatenation away from looking fine.
function stripLead(s) { return typeof s === 'string' && s[0] === '/' ? s.slice(1) : s; }

if (WRITE) {
  const sMw = fs.readFileSync(STELLAR + '/functions/_middleware.js', 'utf8');
  const xMw = fs.readFileSync(XRPL + '/functions/_middleware.js', 'utf8');
  const sRoutes = tableOf(sMw, 'ROUTES');
  // The shared gated paths are dropped here too. Stellar's entry already matches the url — match()
  // returns the first hit — so an XRPL duplicate could only ever be dead weight, and a dead duplicate
  // in a route table is the kind of thing someone later reads as the one in use.
  const xMwRoutes = tableOf(xMw, 'ROUTES').filter((r) => r[0] !== '/' && !GATED.has(r[0]))
    // r[0] is the URL and keeps its slash; r[1] and r[2] are page targets and must lose theirs.
    .map((r) => [r[0], stripLead(r[1]), stripLead(r[2]), ...r.slice(3)]);
  const merged = sRoutes.concat(xMwRoutes);
  const mergedMobile = Array.from(new Set(setOf(sMw).concat(setOf(xMw).map(stripLead))));

  // Every target must be a bare page name. One slash here is the difference between /trade/xrpl showing
  // the XRP Ledger and showing Stellar, with nothing in between to notice.
  const slashed = merged.filter((r) => (r[1] && r[1][0] === '/') || (r[2] && r[2][0] === '/'));
  if (slashed.length) {
    die('these merged routes have a slash-prefixed page target, which would make the mobile fetch '
      + 'treat the prefix as a hostname:\n      ' + slashed.map((r) => JSON.stringify(r)).join('\n      '));
  }
  const mSlashed = mergedMobile.filter((m) => m && m[0] === '/');
  if (mSlashed.length) die('HAS_MOBILE entries are slash-prefixed: ' + mSlashed.join(', '));

  // AND THE MOBILE FILE MUST ACTUALLY EXIST. HAS_MOBILE is what decides whether to rewrite at all, so an
  // entry naming a file that is not in the tree turns into a fetch for something absent.
  const missing = mergedMobile.filter((m) => !fs.existsSync(OUT + '/' + m + '.html'));
  if (missing.length) die('HAS_MOBILE names files that are not in the combined tree: ' + missing.join(', '));

  // CHAIN_ALT: for each shared gated page, this build's file keyed by the Stellar file the route
  // resolves to. Derived by pairing the two route tables on the url rather than hardcoding filenames,
  // so renaming a page on either side cannot leave a stale mapping behind.
  const xByPath = new Map(tableOf(xMw, 'ROUTES').map((r) => [r[0], r]));
  const chainAlt = {};
  for (const sr of sRoutes) {
    if (!GATED.has(sr[0])) continue;
    const xr = xByPath.get(sr[0]);
    if (!xr) die('no XRPL route for the shared gated path ' + sr[0]);
    const pair = (sFile, xFile) => {
      if (!sFile || !xFile) return;
      const x = stripLead(xFile);
      if (!fs.existsSync(OUT + '/' + x + '.html')) {
        die('CHAIN_ALT would point ' + sr[0] + ' at ' + x + '.html, which is not in the combined tree');
      }
      chainAlt['xrpl ' + sFile] = x;
    };
    const sMob = sr[2] || (sr[1].replace(/-(dark|light)$/, '') + '-mobile');
    const xMob = xr[2] || (stripLead(xr[1]).replace(/-(dark|light)$/, '') + '-mobile');
    pair(sr[1], xr[1]);
    pair(sMob, xMob);
  }
  const altCount = Object.keys(chainAlt).length;
  if (!altCount) die('CHAIN_ALT came out empty — the gated pages would all serve Stellar');

  const out = sMw
    .replace(/const CHAIN_ALT = \{[^}]*\};/,
      '// Filled in by _tools/combine_with_stellar.js. Key is "<chain> <stellar file>".\n'
      + 'const CHAIN_ALT = ' + JSON.stringify(chainAlt, null, 2) + ';')
    .replace(/const ROUTES = \[[\s\S]*?\n\];/,
      '// Stellar\'s routes, then XRPL\'s appended by _tools/combine_with_stellar.js. First match wins,\n'
      + '// so Stellar\'s are reached first and none of them changes.\n'
      + 'const ROUTES = ' + JSON.stringify(merged, null, 2) + ';')
    .replace(/const HAS_MOBILE = new Set\(\[[\s\S]*?\]\);/,
      'const HAS_MOBILE = new Set(' + JSON.stringify(mergedMobile) + ');');
  fs.writeFileSync(FN_OUT + '/_middleware.js', out);
  console.log('    middleware    : ' + sRoutes.length + ' stellar + ' + xMwRoutes.length + ' xrpl routes'
    + ' (xrpl "/" dropped — the landing page stays Stellar\'s)');
  console.log('    shared pages  : ' + GATED.size + ' authgated url(s) serve either chain via the '
    + 'lx_chain cookie (' + altCount + ' file mappings)');
}

if (WRITE) {
  fs.writeFileSync(OUT + '/_redirects', combinedRed);
  console.log('');
  console.log('  built. deploy with:');
  // --cwd is NOT optional. wrangler takes its functions directory from the CWD, so deploying from
  // the repo root picks up THIS repo's 20 Functions and silently drops Stellar's 57 — every page
  // still renders and every Stellar backend call 404s. That is exactly what happened the first time.
  console.log('    npx wrangler pages deploy dist --cwd .deploy --project-name=lumoscore-staging --commit-dirty=true');
} else {
  console.log('');
  console.log('  dry run only — re-run with --write');
}
