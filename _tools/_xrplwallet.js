// Inject the XRPL wallet data layer into the wallet pages.
//
// The browser code is READ FROM FILES and injected verbatim -- _tools/xrpl-core.js and
// _tools/browser/wallet.js. It is never assembled as a quoted string in here. Every escaping accident
// in the Stellar project came from browser code living inside string literals: a template literal ate
// the backslashes out of a regex and shipped it inert, and an SVG's quotes closed the string it sat in
// and crashed a whole transform. Files have no layers to survive, and the core file injected here is
// byte-for-byte the one the node tests run against, so the rules cannot drift between test and page.
//
// Idempotent: the existing block is stripped by id before the new one is appended, so re-running
// replaces rather than stacks.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplwallet';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
// Explorer links, shared with the dashboard so the Bithomp base URL exists once. Before wallet.js,
// which calls window.lxxExplorer while building each activity row.
const xp = fs.readFileSync(__dirname + '/browser/explorer.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/wallet.js', 'utf8');
// Prices fill columns the wallet layer paints, so they ship together and in this order.
const px = fs.readFileSync(__dirname + '/browser/prices.js', 'utf8');
// Signed transactions — Receive QR, Send, Cancel order. LAST, because it reads window.__lxxData for
// balances and calls window.__lxxReload after a submit; both are published by wallet.js above.
// The swap pays the platform fee to the collector, so this file carries its address — injected and
// checksum-verified by xrpladdr.js, never written literally in a browser source.
const { injectCollector } = require(__dirname + '/xrpladdr.js');
const wr = injectCollector(fs.readFileSync(__dirname + '/browser/write.js', 'utf8'), 'write.js');

for (const src of [core, xp, page, px, wr]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + xp + '\n' + page + '\n' + px + '\n' + wr + '\n</' + 'script>';

let files = 0, pages = 0, stellarLayers = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // Only the wallet pages: this layer paints #assetsTable and nothing else has one.
    if (!/^lumoscore-wallet(-(dark|light|mobile))?\.html$/.test(key)) continue;
    let h = json[key];
    // desktop has a table, mobile has a card list. Requiring the table would have silently
    // skipped every phone -- the most repeated bug class in the Stellar project.
    if (h.indexOf('id="assetsTable"') < 0 && h.indexOf('id="assetList"') < 0) continue;

    // THE STELLAR WALLET LAYER — 118KB of it — was still running here and calling
    // horizon.stellar.org. It writes .value-side, .value-side .value, .sub-value,
    // .activity-block and #assetsTable: every element this layer paints. The two fought over the
    // whole page and the mock won the headline, so "31,108.45 APT" sat above a correctly priced
    // list of real XRP Ledger holdings.
    //
    // Fully superseded by lx-xrplwallet + lx-xrplprices, so it goes rather than being raced.
    // NOT stripped: lx-swapcalc, lx-qorders and lx-wclaim also carry Stellar calls but own
    // controls the design expects to exist, so they need XRPL data rather than deletion.
    { const g = stripById(h, 'lx-walletdata'); h = g.html; stellarLayers += g.removed; }

    const re = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(re, '');
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  // </ inside a JSON string would close the container's own script tag when the file is parsed.
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl wallet: stripped '+stellarLayers+' Stellar layer(s); data layer on ' + pages + ' page key(s) across ' + files + ' container(s)');
