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

// THE OPEN ORDERS PANEL SHIPS THREE APTOS ORDERS BAKED INTO THE MARKUP — "APT / USDT, 10K USDT,
// 42% filled", a red Cancel Order under each — and they are on screen from the first frame until
// wallet.js clears the block and rebuilds it from the ledger (RAZA 2026-10-17: "Wallet page, there's
// a flash bug when the page is refreshed. It's showing APT").
//
// IN <head>, because the fix has to beat the first paint and the script that fills the panel rides at
// the end of <body> — a <style> the script creates arrives far too late to stop what the parser has
// already drawn. Same shape as the other gates on this site: hide the contents until the layer that
// owns them marks the container, and nothing else.
//
// Gated on an attribute WE set, never on a class the design also uses, so a redraw by the design
// cannot accidentally satisfy it.
//
// Visibility, not display: the cards keep their box, so the panel does not collapse and re-expand as
// the real orders arrive.
//
// If the render bails — markup missing, ledger unreachable — the panel stays empty rather than
// lifting back to the mock. Empty is a poor answer; three invented Aptos orders on a wallet page is a
// wrong one, and the reader cannot tell it is wrong.
// IT KEYS ON THE ATTRIBUTE THE PAINTER ALREADY SETS, not a new one of its own.
//
// paintOrders() ends every successful path — the rendered rows AND the "no open orders" note — with
// reveal(block), and reveal() stamps data-lcm-done. So the release signal already exists and is
// already written in both places; inventing a second attribute would have meant editing wallet.js to
// set it, and two attributes that must agree is how one of them ends up forgotten.
//
// AND IT CANNOT STICK. reveal.js sweeps every card it owns after 2.6s precisely so a reveal that
// never fires leaves things VISIBLE rather than invisible — but its selector list is
// .kpi-card/.quick-card/.product-card/.market-card/.activity-card, which does not include these
// blocks. Nothing would ever lift this gate if the ledger read failed, and a permanently blank panel
// is a worse bug than the flash it replaces. So the gate ships with its own copy of that safety net:
// after 3s the blocks are released whatever happened, which is the failure mode worth having.
const GATE_ID = 'lx-xordgate';
const GATE_JS = 'lx-xordgate-js';
// "CANCEL ALL" IS GATED SEPARATELY, BECAUSE IT IS NOT IN THE PANEL.
//
// It lives in the section header, OUTSIDE .orders-block, so the `>*` rule above never covered it —
// which is why it kept flashing after the APT cards stopped (RAZA 2026-10-17: "cancel all text link
// in blue color is still appearing as flash bug").
//
// It flashes BLUE because the design ships it as `<a href="#" id="cancelAllBtn">` with no class, so
// until a painter touches it the browser renders a bare anchor: default blue, underlined. Both the
// de-bluing and the hiding currently happen inside paintOrders()'s .then, i.e. only once the ledger
// has answered — seconds on a cold phone, and never at all if that read fails.
//
// So the rule does both jobs up front, in <head>, before the first frame:
//   * hidden until paintOrders stamps data-lxca, which it does in the same breath as deciding whether
//     there is anything to cancel;
//   * styled in the accent colour regardless, so it cannot render blue even in the frame it appears.
//
// NO SAFETY TIMER ON THIS ONE, deliberately. For the orders panel, stuck-hidden would be a bug worth
// guarding against; here hidden IS the correct resting state — with no orders loaded there is nothing
// to cancel, and the design already hides it in that branch. A failed ledger read leaves no button
// rather than a live "Cancel all" above an empty list.
//
// -webkit-text-fill-color as well as color: the UA sets it on a link and it WINS over color, which is
// the measured reason an earlier colour-only fix left the anchor blue. Same lesson as the inline
// styles in paintOrders.
// TWO LAYOUTS, AND ONLY THE PHONE'S WAS EVER WIRED (RAZA 2026-11-03: "why is it showing cancell all
// button on open orders when there's no open order", with no orders on the account).
//
// The phone ships `<a href="#" id="cancelAllBtn">Cancel all</a>` — matched by every selector here,
// which is the layout this gate was tested on. The DESKTOP ships
// `<button class="ctrl-btn"> ✕ Cancel all </button>`: no id, no class to hook, nothing in common with
// any of the three selectors. So this rule and paintOrders' hide branch had both been matching
// NOTHING on desktop since the day they were written (2026-10-11), and nobody could see it because
// the phone did the right thing. The same two-layouts trap the orders list itself hit.
//
// The fix is a build-time `data-cancel-all` stamp (stampCancelAll, below) giving the desktop control
// the hook the rest of this layer already expects — not a second mechanism beside the one that was
// supposed to do the job.
//
// THE COLOUR RULE IS DELIBERATELY NOT EXTENDED TO IT. De-bluing exists for the bare anchor, which the
// browser paints link-blue because it carries no class at all. The desktop control is an already
// styled .ctrl-btn pill; repainting it accent-orange would be a change nobody asked for.
const CA_HIDE = '#cancelAllBtn:not([data-lxca]),.order-cancel-all:not([data-lxca]),[data-cancel-all]:not([data-lxca])';
const CA_BLUE = '#cancelAllBtn,.order-cancel-all';
const GATE = '<style id="' + GATE_ID + '">'
  + '.orders-block:not([data-lcm-done])>*,.orders-stack:not([data-lcm-done])>*{visibility:hidden}'
  + CA_HIDE + '{visibility:hidden!important}'
  + CA_BLUE + '{color:var(--accent,#ea6a2c)!important;-webkit-text-fill-color:var(--accent,#ea6a2c)!important;'
  + 'text-decoration:none!important;font-weight:600}'
  + '</' + 'style>'
  // THE SAFETY NET MUST NOT BE A SLOW RELEASE OF THE MOCK.
  //
  // The first version of this timer simply stamped data-lcm-done after 3s, which lifts the gate over
  // WHATEVER is in the panel — and at 3s on a cold phone that is still the three Aptos cards, because
  // paintOrders has not come back yet. So the net did not protect against the flash, it produced one:
  // RAZA 2026-10-17, with the gate already shipped, "APT flash bug in open orders still appear on
  // staging when wallet page is refreshed".
  //
  // It now EMPTIES the panel instead of revealing it. The mock never becomes visible on any timeline.
  //
  // THE TEMPLATE IS RESCUED FIRST, and that is the whole reason this cannot just delete the markup at
  // build time. paintOrders() builds every real row by cloning a mock card out of the panel
  // (`block.querySelector('.order-row, .order-card')`) — the mock is not only scenery, it is the row
  // template. Clearing the panel without keeping a copy would leave paintOrders with nothing to clone
  // and it would bail at `if (!rowT) return;`, trading a flash for a permanently empty Open Orders.
  // So one card is stashed on window first, and paintOrders falls back to it.
  //
  // Only untouched panels are cleared: reveal() stamps data-lcm-done the moment paintOrders finishes,
  // so a panel that already holds REAL orders is skipped and never wiped.
  + '<script id="' + GATE_JS + '">setTimeout(function(){try{'
  + 'var n=document.querySelectorAll(".orders-block,.orders-stack");'
  + 'for(var i=0;i<n.length;i++){var b=n[i];'
  + 'if(!b.getAttribute("data-lcm-done")){'
  + 'var t=b.querySelector(".order-row,.order-card");'
  + 'if(t&&!window.__lxOrdTpl)window.__lxOrdTpl=t.cloneNode(true);'
  + 'b.innerHTML="";}'
  + 'b.setAttribute("data-lcm-done","1");}'
  + '}catch(e){}},3000);</' + 'script>';

// Gives the desktop "Cancel all" the hook every selector above already looks for.
//
// SCRIPTS ARE CUT OUT BEFORE THE SCAN, and that is not caution — the first version matched `<button`
// anywhere and hit the word "<button>" inside this project's OWN javascript comment ("…the <button>,
// its .active state and its .cnt badge…"), pairing it with a `</button>` hundreds of lines further
// down and claiming a hit on 55 pages. A comment is not markup, the same way a comment is not copy.
//
// Bounded by `(?!<\/button>)` so the content cannot run past the element it belongs to, and skipped
// where the attribute is already present, so a second pass over a built container adds nothing.
const CA_STAMP = /<button(?![^>]*data-cancel-all)([^>]*)>((?:(?!<\/button>)[\s\S])*?Cancel all(?:(?!<\/button>)[\s\S])*?)<\/button>/gi;
function stampCancelAll(html) {
  let hits = 0;
  const out = html.split(/(<script[\s\S]*?<\/script>)/i).map(function (part) {
    if (/^<script/i.test(part)) return part;
    return part.replace(CA_STAMP, function (m, attrs, inner) {
      hits++;
      return '<button data-cancel-all' + attrs + '>' + inner + '</button>';
    });
  }).join('');
  return { html: out, hits };
}

let files = 0, pages = 0, stellarLayers = 0, mockCharts = 0, mockHeadlines = 0, mockCards = 0, gated = 0, stamped = 0;
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

    // AND THEN THE TWO CARDS THEMSELVES GO (RAZA 2026-10-06: "This flash bug is still there when wallet
    // page is refreshed", circling Open Orders and Liquidity Pools — now reading "—" and "Across your
    // pools" rather than Aptos figures, so the blanking above did land; the CARDS are what flashes).
    //
    // Blanking was the wrong depth for these two. browser/wallet.js hides both in buildTabs(), because
    // the Assets / Open Orders / Liq Pools tabs replace them and carry the real counts — so they are not
    // cards waiting for data, they are cards with no future at all. Anything whose final state is
    // display:none should start there, and a value-blanking pass can only ever shorten the flash, never
    // end it.
    //
    // Inline style rather than a CSS gate, for the reason the note above gives: a gate is a second thing
    // that has to lift. This is the same markup-level fix, taken one level out from the value to the box
    // that holds it. buildTabs() still finds them by their .ttl and still hides them, which costs
    // nothing and means nothing here depends on the other.
    //
    // The window is bounded and refuses to span two cards, so a card can never be hidden by the NEXT
    // card's title; and a tag that already carries the style is left alone, so a second build is a
    // no-op (see the idempotence note in the chain).
    const CARD_OPEN = /<div class="insight-card([^"]*)"([^>]*)>([\s\S]{0,900}?<div class="ttl">\s*(?:Open Orders|Liquidity Pools)\s*<\/div>)/g;
    let hidden = 0;
    h = h.replace(CARD_OPEN, function (_, cls, rest, body) {
      if (/display\s*:\s*none/.test(rest)) return _;        // already hidden; second build
      if (/insight-card/.test(body)) return _;              // the title belongs to a later card
      hidden++;
      return '<div class="insight-card' + cls + '" style="display:none"' + rest + '>' + body;
    });
    if (hidden) mockCards += hidden;
    if (blanked) mockHeadlines += blanked;

    const re = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(re, '');
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    h = h.slice(0, bi) + SCRIPT + h.slice(bi);

    // Stripped first and /g, as everywhere else here: one strip against two stale copies leaves a
    // duplicate competing at equal specificity for ever.
    const gre = new RegExp('<style id="' + GATE_ID + '">[\\s\\S]*?<\\/style>', 'g');
    h = h.replace(gre, '');
    const gjs = new RegExp('<script id="' + GATE_JS + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(gjs, '');
    // Before the gate is written, so the attribute the gate's selector needs is already on the
    // element in the same build rather than one release later.
    { const st = stampCancelAll(h); h = st.html; stamped += st.hits; }

    if (h.indexOf('</head>') >= 0 && /orders-block|orders-stack/.test(h)) {
      h = h.replace('</head>', GATE + '</head>');
      gated++;
    }

    json[key] = h;
    pages++;
  }

  // </ inside a JSON string would close the container's own script tag when the file is parsed.
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl wallet: stripped '+stellarLayers+' Stellar layer(s); disabled '+mockCharts
  + ' random-walk chart(s); blanked ' + mockHeadlines + ' mock insight figure(s); hid '
  + mockCards + ' tab-replaced card(s); open-orders flash gate on ' + gated + ' page key(s); '
  + 'desktop Cancel all stamped on ' + stamped + '; data layer on '
  + pages + ' page key(s) across ' + files + ' container(s)');
