// Replace the Trade-Asset page's Stellar layer with an XRP Ledger one.
//
// `lx-dxadata` (~293KB) did not read the token in the URL at all: every /trade/xrpl/<token> address
// rendered Stellar LUMOS, with 105 mentions of XLM and 124 Stellar addresses, under a runtime-set
// title reading "LUMOS price, pools and holders on Stellar". Wiring the market table made this page
// reachable from every row, so it had to go with it rather than after it.
//
// Both layouts are matched. Desktop uses #dxaObAsks, mobile #mdxaObAsks, and the mobile page shares
// none of the desktop ids -- the same split that silently skipped every phone on the Trade page.
//
// Stripping goes through stripById rather than a regex. Not because regex cannot do it, but because
// the first version of THIS FILE was written through a shell heredoc, which ate the backslashes out
// of `[\\s\\S]` and left the character class [sS]. It matched nothing, reported "stripped 0", and
// left the whole Stellar layer in place. indexOf has no escapes to lose.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpldexasset';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/dexasset.js', 'utf8');
// Limit orders, in their own file and AFTER dexasset.js in the same block: they read the asset and
// price it publishes (window.__lxxAssetRef / __lxxAssetData) and call its order-book refresh.
const limit = fs.readFileSync(__dirname + '/browser/limit.js', 'utf8');
// The Swap tab, last: it reads the same asset and price, and it signs a fee payment, so the collector goes
// in through the same checksum-gated injection write.js uses.
const { injectCollector } = require(__dirname + '/xrpladdr.js');
const swap = injectCollector(fs.readFileSync(__dirname + '/browser/dxaswap.js', 'utf8'), 'dxaswap.js');

for (const src of [core, page, limit, swap]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n' + limit + '\n' + swap + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0, swapped = 0, appended = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('id="dxaObAsks"') < 0 && h.indexOf('id="mdxaObAsks"') < 0) continue;

    const gone = stripById(h, 'lx-dxadata');
    h = gone.html;
    stripped += gone.removed;

    // IN PLACE, NOT STRIP-AND-RE-APPEND. Stripping this block by id and appending it before </body>
    // lands it LAST however early it used to sit, which moves every layer that followed it -- the
    // trap in [[running-one-stellar-transform-reorders-layers]], and the reason this repo carried a
    // blanket "never run an XRPL transform on its own" rule. Swapping where it already sits keeps
    // its position ([[a-transform-that-patches-in-place-cannot-reorder]]).
    //
    // The strip above (lx-dxadata, the Stellar layer) is unchanged: that one is REMOVING a foreign
    // block, not moving our own.
    const open = '<script id="' + ID + '">';
    const at = h.indexOf(open);
    const close = '</' + 'script>';
    const end = at < 0 ? -1 : h.indexOf(close, at);
    if (at >= 0 && end > at) {
      json[key] = h.slice(0, at) + SCRIPT + h.slice(end + close.length);
      swapped++;
    } else {
      // Never carried it: append, which correctly lands last on a page seeing this for the first time.
      h = stripById(h, ID).html;
      const bi = h.lastIndexOf('</' + 'body>');
      if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
      json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
      appended++;
    }
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl dex-asset: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar layer from ' + stripped
  // Swapped vs appended, not one total: on a tree that already carries the layer every page should
  // SWAP. An `appended` above zero is the one outward sign a layer is about to change position.
  + '; ' + swapped + ' swapped in place, ' + appended + ' appended');
if (!pages) console.error('  ! no page carried the order-book ids — nothing was wired');
