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

let files = 0, pages = 0, stellarLayers = 0, mockCharts = 0, mockHeadlines = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // The wallet pages, AND the dashboard — because the dashboard carries the same `#modalSwap`
    // dialog and `write.js` is what drives it. Without the layer there, "Custom Swap / Orders"
    // opened a dialog with nothing behind it, which is why that card had to route away to the trade
    // page instead. wallet.js paints nothing here (no `#assetsTable`, so its host check is null) and
    // prices.js returns at its own guard; what the dashboard gains is the balance read and write.js.
    // …and the $LUMOS token page, which reaches the same dialog from its own "Swap" button. Left out
    // of the first pass and caught by scanning every `id="*modal*"` block in dist for wrong-chain
    // words: one click there opened "FROM Balance: — APT / 1 APT ≈ 312.5 LUMOS" over an enabled
    // Confirm Swap, with no layer behind any of it. A fabricated rate on a live-looking money button
    // is the worst thing on this fork, so it gets the real machinery rather than a disable.
    if (!/^lumoscore-(wallet|home|lumos-token)(-(dark|light|mobile))?\.html$/.test(key)) continue;
    let h = json[key];
    // desktop has a table, mobile has a card list. Requiring the table would have silently
    // skipped every phone -- the most repeated bug class in the Stellar project.
    //
    // THE MOBILE DASHBOARD IS DELIBERATELY EXCLUDED by this same check: it ships `#swapModal` (the
    // unwired design mock) and NOT `#modalSwap`, so there is nothing here for write.js to drive and
    // injecting 100KB to drive nothing would be worse than the honest route the card already takes.
    // Checked rather than assumed — the phone build differing from the desktop one is the trap this
    // project keeps falling into.
    if (h.indexOf('id="assetsTable"') < 0 && h.indexOf('id="assetList"') < 0
      && h.indexOf('id="modalSwap"') < 0) continue;

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

    // THE HERO CHART HAS A SECOND WRITER, and it draws a RANDOM WALK.
    //
    //     let v = 50;
    //     for (let i = 0; i < c.points; i++) { v += (Math.random() - 0.45) * c.vol; … }
    //
    // — inside the design's 44KB inline block, wired to the 1D/1W/1M/1Y/ALL buttons, and it also
    // rewrites `.chart-axis` to a hardcoded "May 16 · May 18 · May 20 · May 22" and `.timeframe-mini`
    // to "past 7 days". It does not run on load, which is the only reason nobody had seen invented
    // price history on this page: it fires on the FIRST TAB CLICK. The same user-input-only trigger
    // as the Aptos market table, and just as invisible to any check that does not click.
    //
    // Made to bail through its own guard — the block opens `const chartEl =
    // getElementById('heroChart'); if (!tabs.length || !chartEl) return;` — rather than deleted,
    // because that one <script> also holds the modals, toasts, copy handling, the search popup, the
    // cancel-order flow, the row menus and the activity list. Deleting a shared block is how this
    // project once killed seven unrelated features at once.
    //
    // Scoped to that block by index: `heroChart` is also named by our own layer, which draws the
    // real series in its place.
    // THERE ARE TWO OF THEM, which is why this scans instead of anchoring on one function name.
    //
    // The first pass keyed on `function renderChart` and disabled exactly that block — and the axis
    // still came back reading "2023 2024 2025 2026" under a real price line. A SECOND, separate
    // 5.4KB IIFE also owns #heroChart: its own `config` (a seeded random walk, so it is deterministic
    // and looks plausible), its own `#chartHit` / `.chart-tooltip` hover, and its own
    // `axis.innerHTML = c.axis.map(...)` which REPLACES the design's five spans with four. Its
    // renderer is called `render`, so anchoring on the other name never touched it.
    //
    // Found by watching the axis with a MutationObserver rather than by reading more source: the
    // removed nodes came back as ["2023","2024","2025","2026"], which is in neither the design block
    // nor this layer.
    //
    // So: every script block that reaches for #heroChart is made to bail through its own guard —
    // both carry `if (!wrap) return;` / `if (!tabs.length || !chartEl) return;`. Our own layer is
    // skipped by id, since it names the same element and is what draws the real series.
    {
      const find = "getElementById('heroChart')";
      let from = 0;
      for (;;) {
        const at = h.indexOf(find, from);
        if (at < 0) break;
        const bs = h.lastIndexOf('<script', at);
        const be = h.indexOf('</' + 'script>', at);
        if (bs < 0 || be < at) break;
        const openTag = h.slice(bs, h.indexOf('>', bs) + 1);
        if (openTag.indexOf(ID) >= 0) { from = be; continue; }   // our own layer
        const block = h.slice(bs, be).split(find).join("getElementById('lx-design-mock-disabled')");
        h = h.slice(0, bs) + block + h.slice(be);
        mockCharts++;
        from = bs + block.length;
      }
    }

    // THE INSIGHT CARDS SHIP WITH APTOS NUMBERS IN THEM (RAZA 2026-10-02: "There's a flash bug on XRPL
    // wallet page. This shows up for split seconds when Wallet page is refreshed").
    //
    // The design's three cards carry mock headlines in the MARKUP — "+12.42%", "3 Active" and
    // "3,442 APT" — so the browser paints them the moment the HTML lands, and they stand until the data
    // layer replaces them a second or two later. The middle one is merely wrong; the third names the
    // wrong CHAIN on a wallet page, which is the kind of thing a reader screenshots.
    //
    // Blanked at BUILD time rather than hidden behind a CSS gate. A gate is a second thing that has to
    // lift, and this project has shipped gates that never did — leaving the card permanently empty,
    // which is worse than the flash. With no value in the markup there is nothing to flash and nothing
    // to lift: the dash is what an unloaded figure looks like everywhere else on this page.
    const CARD_MOCK = /(<div class="headline[^"]*">)([^<]{1,40})(<\/div>)/g;
    let blanked = 0;
    h = h.replace(CARD_MOCK, function (_, open, val, close) {
      if (!/\d/.test(val)) return _;           // a headline with no digits is a label, not a figure
      blanked++;
      return open + '—' + close;
    });
    // "Across 2 pools" counts too: the number is as invented as the ones above it. The count sits in a
    // nested span, so this cannot be a flat [^<]* match — that is why the first version silently did
    // nothing here while the headlines changed.
    h = h.replace(/(<div class="sub">\s*Across\s*<span class="nm">)[^<]*(<\/span>)/g,
      function (_, open, close) { blanked++; return open + 'your pools' + close; });

    // AND THE HEADLINE BALANCE, which is the biggest one on the page: "31,108.45 APT" over
    // "≈ $12,847.62 USD". This file's own notes already call that figure mock — it was what the stripped
    // Stellar layer used to win with — but the markup still carries it, so it is painted on every load
    // until the data arrives. Matched on the ticker rather than the digits, so it cannot blank a real
    // figure: by the time anything true is in there it is this build's own XRP, never APT.
    h = h.replace(/(<div class="value">)[^<]*<span[^>]*>\s*APT\s*<\/span>(<\/div>)/g,
      function (_, open, close) { blanked++; return open + '—' + close; });
    h = h.replace(/(<div class="sub-value">)\s*≈[^<]*(<\/div>)/g,
      function (_, open, close) { blanked++; return open + close; });
    if (blanked) mockHeadlines += blanked;

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

console.log('xrpl wallet: stripped '+stellarLayers+' Stellar layer(s); disabled '+mockCharts
  + ' random-walk chart(s); blanked ' + mockHeadlines + ' mock insight figure(s); data layer on '
  + pages + ' page key(s) across ' + files + ' container(s)');
