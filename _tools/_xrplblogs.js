// Gives the XRPL dashboard a WORKING blog card, showing only posts tagged for XRPL (or for every
// network), by importing the painter from Stellar rather than writing a second one.
//
// WHAT WAS WRONG. The dashboard card's markup and stylesheet arrive with the Stellar base, but the
// script that fills them does not: measured 2026-10-28, both fork containers carry 4 lx-blogs-card
// references and an lx-dashblogs-css block, and ZERO lx-dashblogdata. _xrpldash.js lists
// lx-dashblogdata among the inherited Stellar layers it strips -- correct when the endpoints 404'd
// on the fork's own deploy, and a no-op now because the layer is not in the base any more. Either
// way the card had a writer nowhere and showed its "Coming soon" placeholder for good. That is the
// orphaned-lookup shape: markup with nobody to fill it.
//
// THE 404 REASON IS GONE. /lxapi/blog is Stellar's function and the COMBINED deploy serves it at the
// root for every path, /xrpl included. Measured 2026-10-28: GET https://lumoscore.com/lxapi/blog ->
// 200 with 14 posts. It only ever 404'd on the fork deployed by itself.
//
// WHY IMPORT INSTEAD OF COPY. The painter is ~90 lines of row building, overflow arrows and paging
// maths. Copied here it becomes a second implementation that drifts, and this codebase has already
// paid for that ("a bug on one fork is usually in all of them"). So the script is LIFTED from
// Stellar's _tools/_dashblogs.js at build time and exactly one token is retargeted: LXNET, the
// constant naming which network this build is. One painter, two builds, one word different.
// `rebuild.js --base` already reads the Stellar tree, so reading one more file from it is the same
// trust boundary, and nothing is ever written there.
//
// IT USES ITS OWN ID, lx-xrplblogdata, NOT Stellar's. _xrpldash.js strips lx-dashblogdata, and this
// layer must survive that regardless of which order the two run in. It keeps Stellar's
// window.__lxDashBlog guard, so if a future --base ever does bring the Stellar writer back, the
// first to run wins and the card never gets two painters -- the race that causes flashes here.
//
// EVERY LIFT IS ASSERTED. If Stellar's script is reshaped so an anchor stops matching, this aborts
// and writes nothing, rather than shipping an XRPL dashboard quietly listing Stellar's posts.
const fs = require('fs');
const path = require('path');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplblogdata';
const SRC = path.join('C:' + path.sep + 'LumosCore', '_tools', '_dashblogs.js');

function die(msg) { console.error('xrpl blogs: ABORT - ' + msg + ' (nothing written)'); process.exit(1); }

// ---- lift the painter out of Stellar's transform --------------------------------------------
if (!fs.existsSync(SRC)) die('cannot read the Stellar painter at ' + SRC);
const srcText = fs.readFileSync(SRC, 'utf8');

const DECL = 'const DATA_SCRIPT = ';
const di = srcText.indexOf(DECL);
if (di < 0) die('_dashblogs.js no longer declares DATA_SCRIPT');
const lineEnd = srcText.indexOf('\n', di);
let literal = srcText.slice(di + DECL.length, lineEnd < 0 ? srcText.length : lineEnd).trim();
if (literal.endsWith(';')) literal = literal.slice(0, -1);
if (literal.charAt(0) !== '"' || literal.charAt(literal.length - 1) !== '"') {
  die('DATA_SCRIPT is no longer a single double-quoted literal on one line');
}
// A double-quoted JS string using only \" and \n is also a valid JSON string. Parsing rather than
// eval'ing keeps this a data read: nothing from the Stellar tree is executed here.
let script;
try { script = JSON.parse(literal); }
catch (e) { die('DATA_SCRIPT uses escapes JSON cannot parse (' + e.message + ')'); }

function swapOnce(hay, from, to, what) {
  const n = hay.split(from).length - 1;
  if (n !== 1) die(what + ': expected exactly 1 occurrence, found ' + n);
  return hay.split(from).join(to);
}

// The one token that differs between the two builds.
script = swapOnce(script, 'var LXNET="stellar";', 'var LXNET="xrpl";', 'the LXNET constant');
// Our own id, so _xrpldash.js's strip of the Stellar layer cannot take this one with it.
script = swapOnce(script, '<script id="lx-dashblogdata">', '<script id="' + ID + '">', 'the script id');

// Sanity: the thing we lifted must actually be the painter, and must no longer claim to be Stellar.
for (const needle of ['.lx-blogs-card', 'lxapi/blog', 'function paint(']) {
  if (script.indexOf(needle) < 0) die('the lifted script does not contain ' + needle);
}
// NOT "no 'stellar' anywhere": the filter names both networks to decide whether a tag IS a network
// at all, so the word legitimately survives. What must not survive is the DECLARATION.
if (script.indexOf('var LXNET="stellar"') >= 0) die('the Stellar LXNET declaration survived');
if (script.indexOf('var LXNET="xrpl";') < 0) die('the retargeted LXNET declaration is missing');

// PARSE WHAT WE LIFTED. A textual swap can produce text that is no longer JavaScript, and that
// would otherwise show up only as a silent dead card in a browser. new Function compiles without
// running, so this costs nothing and never executes a line of the painter.
{
  const open = script.indexOf('>') + 1;
  const close = script.lastIndexOf('</' + 'script>');
  if (open <= 0 || close < 0) die('the lifted script has no recognisable body');
  try { new Function(script.slice(open, close)); }
  catch (err) { die('the lifted script does not parse as JavaScript: ' + err.message); }
}

// The lift is the part that can break without anyone noticing, because it depends on a file in
// another repo. --check runs everything above and stops before a single container is opened, so the
// import can be validated without committing to a full rebuild. It writes nothing either way.
if (process.argv.indexOf('--check') >= 0) {
  console.log('xrpl blogs --check: lifted ' + script.length + ' bytes, LXNET=xrpl, id=' + ID);
  console.log('  first 120: ' + script.slice(0, 120).replace(/\n/g, ' '));
  process.exit(0);
}

// ---- inject it on the dashboard pages --------------------------------------------------------
// Same gate _xrpldash.js uses, so the two cannot disagree about which page is the dashboard.
function isDashboard(h) {
  return h.indexOf('id="activityList"') >= 0 && h.indexOf('status-row') >= 0;
}

let files = 0, pages = 0, noCard = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing - skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  let changed = false;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (!isDashboard(h)) continue;

    h = stripById(h, ID).html;                    // idempotent: a re-run replaces, never stacks

    // The painter fills markup it does not create. Without the card there is nothing to fill, and
    // injecting anyway would leave a script hunting an element that is not there.
    if (h.indexOf('lx-blogs-card') < 0) { noCard++; json[key] = h; changed = true; continue; }

    const bi = h.lastIndexOf('</body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body - skipped'); continue; }
    json[key] = h.slice(0, bi) + script + h.slice(bi);
    changed = true;
    pages++;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

if (!pages) die('no dashboard page carried an lx-blogs-card - the base may have changed');
console.log('xrpl blogs: painter imported from Stellar, LXNET=xrpl, on ' + pages
  + ' page key(s) across ' + files + ' container(s)'
  + (noCard ? '; ' + noCard + ' dashboard page(s) had no blog card' : ''));
