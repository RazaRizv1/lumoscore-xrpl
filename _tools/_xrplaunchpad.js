// Strip the Stellar issuance layer from the Launchpad and wire the XRP Ledger one.
//
// THE LAYER THIS REMOVES IS THE MOST DANGEROUS THING FOUND IN THE FORK. `lx-lp-js` is 69KB of live
// STELLAR MAINNET issuance sitting on three pages titled "Launch a Token on the XRP Ledger":
//
//     horizon:    "https://horizon.stellar.org"
//     passphrase: "Public Global Stellar Network ; September 2015"
//     feeCollector: "GAMZFXIJD5E3PNRFCG6VPXCJNUOZAP5BY2P3MU3ZXXUSVM2UY5P6LJKD"
//
// It generates a Stellar issuer keypair, funds it from the connected wallet, builds
// changeTrust/setOptions, and sends a real fee to a Stellar address. A user filling in this form
// would have paid, in real money, to mint an asset on a ledger the page never mentions.
//
// It cannot be left in place while the XRPL replacement is finished, so it goes now even though the
// signing half of the replacement is still blocked. A launchpad that says it cannot launch yet is
// strictly better than one that launches on the wrong chain.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const crypto = require('crypto');
const path = require('path');

// THE VENDORED SIGNING LIBRARY, PINNED BY HASH.
//
// xrpl.js 5.1.0, ISC, self-hosted for the same reason the Stellar SDKs are: a signing library must
// not be fetched from a CDN at run time, where whoever controls that origin controls what signs the
// user's transactions.
//
// Provenance, checked rather than assumed:
//   * byte-identical from two independent mirrors (jsdelivr and unpkg), 554,433 bytes
//   * derives the DOCUMENTED genesis address from the published master seed
//     snoPBrXtMeMyMHUVTgbuqAfg1SUTb -> rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
//   * its isValidClassicAddress agrees with the hand-written checksum gate below on every case,
//     two independent implementations reaching the same answer
//   * decoded a REAL signed transaction off the ledger, re-encoded it BYTE-IDENTICALLY, and
//     recomputed its hash to match the ledger's own -- serialization proven against ledger truth,
//     which is the part that must be right for a signature to cover the transaction shown
//
// The hash is checked on every build because .gitattributes exists for a proven reason: autocrlf
// once rewrote a byte inside a vendored SDK on checkout, changing its sha256 and leaving nothing to
// report it. `-text` prevents that; this catches it if the guard is ever lost.
const XRPL_LIB = 'assets/vendor/xrpl-5.1.0.min.js';
const XRPL_SHA256 = '16b73706bf2006186b8cb09df5aa8e4a43414f3376e6ba0a52d252b2e2b69dc4';

const libPath = path.join(__dirname, '..', 'dist', XRPL_LIB);
let libBytes;
try { libBytes = fs.readFileSync(libPath); }
catch (e) { console.error('  vendored ' + XRPL_LIB + ' is missing — aborting'); process.exit(1); }
const libHash = crypto.createHash('sha256').update(libBytes).digest('hex');
if (libHash !== XRPL_SHA256) {
  console.error('  ' + XRPL_LIB + ' FAILED its integrity check');
  console.error('    expected ' + XRPL_SHA256);
  console.error('    found    ' + libHash + '  (' + libBytes.length + ' bytes)');
  process.exit(1);
}

// THE FEE COLLECTOR, CHECKSUM-VERIFIED AT BUILD TIME.
//
// browser/xrpl-core.js checks address SHAPE only, and says so: verifying the trailing 4 bytes needs
// double-SHA256, which is async in a browser and would make every caller async to catch a typo a
// wallet cannot make. That reasoning covers addresses a WALLET hands back. It does not cover this
// one, which a human typed into a config -- and a single wrong character here sends every fee
// LumosCore ever collects to an address nobody holds the key to, permanently and silently.
//
// Node has synchronous SHA-256, so the full check runs here and the build fails rather than ships.
//
// Verified against the ledger on 2026-09-06: the account exists with 2.000012 XRP, and carries
// neither RequireDestTag (which would reject a fee payment sent without a tag), DisallowXRP,
// DepositAuth (which would reject unsolicited payments), nor GlobalFreeze. It holds no trust lines,
// so it can receive XRP and nothing else -- collecting a fee in an issued token would need one.
const FEE_COLLECTOR = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';

const B58 = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function checkAddress(a) {
  if (typeof a !== 'string' || a[0] !== 'r') return 'does not start with r';
  const bytes = [0];
  for (const ch of a) {
    const v = B58.indexOf(ch);
    if (v < 0) return 'character ' + JSON.stringify(ch) + ' is not in the XRPL alphabet';
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 255;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (let i = 0; i < a.length && a[i] === B58[0]; i++) bytes.push(0);
  const buf = Buffer.from(bytes.reverse());
  if (buf.length !== 25) return 'decodes to ' + buf.length + ' bytes, not 25';
  if (buf[0] !== 0) return 'version byte is ' + buf[0] + ', not 0';

  const body = buf.subarray(0, 21);
  const want = buf.subarray(21);
  const sha = (b) => crypto.createHash('sha256').update(b).digest();
  const got = sha(sha(body)).subarray(0, 4);
  if (!got.equals(want)) return 'CHECKSUM MISMATCH — this address contains a typo';
  return null;
}

const bad = checkAddress(FEE_COLLECTOR);
if (bad) {
  console.error('  fee collector ' + FEE_COLLECTOR + ': ' + bad);
  process.exit(1);
}

// Remove the block that CONTAINS `needle`, starting from the nearest enclosing `openTag` before it
// and ending at its matching close, by counting tags. Used to drop whole fields and rows without
// writing a regex that tries to span nested markup.
function removeBlockContaining(html, needle, openTag, tagName) {
  const at = html.indexOf(needle);
  if (at < 0) return { html: html, removed: 0 };
  const start = html.lastIndexOf(openTag, at);
  if (start < 0) return { html: html, removed: 0 };

  const re = new RegExp('</?' + (tagName || 'div') + '\\b[^>]*>', 'gi');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += (m[0][1] === '/') ? -1 : 1;
    if (depth === 0) {
      const end = m.index + m[0].length;
      // Only accept a block that actually still contains the needle -- a mis-anchored start would
      // otherwise silently delete a neighbouring field.
      if (html.slice(start, end).indexOf(needle) < 0) return { html: html, removed: 0 };
      return { html: html.slice(0, start) + html.slice(end), removed: 1 };
    }
  }
  return { html: html, removed: 0 };
}

const ID = 'lx-xrplaunchpad';
// The form rules and the review/launch behaviour ship together: the review page reads the draft the
// form wrote, and a change to one without the other is how a review step ends up describing a
// different token than the one that was validated.
let page = fs.readFileSync(__dirname + '/browser/launchpad.js', 'utf8')
  + '\n' + fs.readFileSync(__dirname + '/browser/mint.js', 'utf8');

// Injected rather than written into the browser file, so the address exists in exactly one place and
// that place is the one the checksum gate above guards.
if (page.indexOf('__FEE_COLLECTOR__') < 0) {
  console.error('  browser/launchpad.js has no __FEE_COLLECTOR__ placeholder — aborting');
  process.exit(1);
}
page = page.split('__FEE_COLLECTOR__').join(FEE_COLLECTOR);

// TEST PRICING GUARD. The launchpad's prices live in one line of browser/launchpad.js, and a
// reduced one shipped by accident means charging 50 cents for a $5 service with nothing on the page
// or in the build to say so. This shouts on every build until the real numbers are restored.
const priced = page.match(/var USD = \{ create: ([\d.]+), liq: ([\d.]+)/);
if (priced && (priced[1] !== '5' || priced[2] !== '10')) {
  console.warn('  ⚠ TEST PRICING ACTIVE: create $' + priced[1] + ' / liquidity $' + priced[2]
    + ' — restore { create: 5, liq: 10, pool: 10 } in _tools/browser/launchpad.js before release');
}

if (page.indexOf('</' + 'script') >= 0) {
  console.error('  launchpad.js contains a closing script tag — aborting');
  process.exit(1);
}

const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

// A launchpad page is one that carries the Stellar layer or the form it drove. Matching on the
// script id alone would miss the page once the layer is stripped, making the transform non-idempotent.
function isLaunchpad(h) {
  return h.indexOf('id="lx-lp-js"') >= 0
    || h.indexOf('id="tokenTicker"') >= 0
    || h.indexOf('lumos.launch.draft') >= 0;
}

let files = 0, pages = 0, stripped = 0, typeRemoved = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (!isLaunchpad(h)) continue;

    const gone = stripById(h, 'lx-lp-js');
    h = gone.html;
    stripped += gone.removed;

    // `lx-lpticker` is the same layer's ticker-preview helper and reads its config from __lxLP,
    // which no longer exists once the block above is gone.
    h = stripById(h, 'lx-lpticker').html;

    h = stripById(h, ID).html;

    // STELLAR'S TICKER RULE, stated as fact under the ticker field. Stellar codes are 1-12
    // alphanumeric characters and the design narrowed that to "2-6 uppercase letters"; the XRP
    // Ledger's rule is different in both directions -- exactly 3 characters for a standard code, or
    // up to 20 carried as a 160-bit hex blob. A user following the old line would never learn why
    // a 2-character ticker is rejected, or that a 12-character one is fine.
    h = h.split('2-6 uppercase letters').join('3 characters, or up to 20');

    // PROJECT TYPE IS GONE. Removed from the Stellar site, so it should not exist here either --
    // taken out of the markup on both pages rather than hidden, so nothing writes `ptype` into the
    // draft and no review row is left to paint.
    //
    // Two different containers, because the two pages express it differently: the form wraps it in
    // a `.field`, the review page in a `.detail-row`. Anchoring both on the same tag would have
    // deleted the wrong block on one of them.
    // The type also appears as a BADGE in two more places -- the form's live preview card and the
    // review hero -- each with its own tag. The design's own updateBadge() already guards on a null
    // element and iterates `.type-card` with querySelectorAll, so removing these orphans nothing.
    for (const [needle, tag, tagName] of [
      ['Project Type', '<div class="field">', 'div'],
      ['Project Type', '<div class="detail-row">', 'div'],
      // Anchored on the OPEN TAG itself, and that detail matters twice over. Anchoring on the words
      // "Meme Project" missed the mobile review badge, which reads just "Meme". Anchoring on the
      // bare class name then failed differently and more quietly: the class appears FIRST in the
      // page's CSS, so indexOf landed in the stylesheet and the backward search for the element
      // found nothing above it -- reporting zero removals for a badge that was plainly still there.
      ['<div class="preview-type-badge"', '<div class="preview-type-badge"', 'div'],
      ['<span class="hero-type-badge"', '<span class="hero-type-badge"', 'span'],
    ]) {
      // Repeat until exhausted: a page can carry more than one copy, and indexOf only finds the
      // first. Bounded so a helper that stops matching cannot spin.
      for (let pass = 0; pass < 4; pass++) {
        const cut = removeBlockContaining(h, needle, tag, tagName);
        if (!cut.removed) break;
        h = cut.html;
        typeRemoved += cut.removed;
      }
    }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl launchpad: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar issuance layer from ' + stripped
  + '; removed the project-type block from ' + typeRemoved);
if (!pages) console.error('  ! no page carried the launchpad — nothing was wired');
