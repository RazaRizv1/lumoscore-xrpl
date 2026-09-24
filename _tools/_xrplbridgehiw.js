// Swap the inherited Circle-CCTP "How it works" dialog on the bridge pages for the XRP Ledger one.
//
// The why lives in browser/bridgehiw.js. In short: `<script id="lx-bhiw">` is Stellar-build output
// describing USDC being burned and re-minted between Stellar and eight chains, it captures every
// "How it works" click on both layouts, and copy passes never touch script bodies — so it kept
// explaining the wrong bridge to everyone who asked how this one works.
//
// Same rule as _xrplconnect.js: browser code is read from its own file and injected verbatim, never
// assembled inside a quoted string here.
//
// REPLACED IN PLACE, NOT APPENDED. The block keeps its exact position relative to lx-bhiw-css and to
// the page's other window-capture listeners, because capture listeners on the same target run in
// registration order and this one must keep winning over the design's own #hiwModal wiring.
//
// Idempotent: the output block has the same id as the input block, so a second run matches its own
// output, produces identical bytes, and writes nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-bhiw';
const src = fs.readFileSync(__dirname + '/browser/bridgehiw.js', 'utf8');
if (src.indexOf('</' + 'script') >= 0) {
  console.error('  browser/bridgehiw.js contains a closing script tag — aborting');
  process.exit(1);
}
const SCRIPT = '<script id="' + ID + '">' + src + '</' + 'script>';
const RE = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>');

let files = 0, pages = 0, current = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const h = json[key];
    if (!RE.test(h)) continue;                       // only pages that already carry the dialog
    // A function replacement, so nothing in the script source is read as a `$&`-style pattern.
    const next = h.replace(RE, function () { return SCRIPT; });
    if (next === h) { current++; continue; }
    json[key] = next;
    pages++;
    changed = true;
  }

  if (changed) {
    // </ inside a JSON string would close the container's own script tag when the file is parsed.
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl bridge how-it-works: ' + pages + ' page key(s) rewritten, ' + current
  + ' already current, across ' + files + ' container(s)');
