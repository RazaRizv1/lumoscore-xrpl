// Trade page: the XRP Ledger's most-traded tokens.
//
// THIS REPLACES A LAYER THAT WAS ACTIVELY WRONG, not one that was merely missing. Before this, the
// inherited `lx-dexmain` was still running on /trade/xrpl and filling the market table from Horizon:
// 36 rows of real STELLAR assets -- USDC/circle.com, SHX/stronghold.co, yXLM, AQUA -- priced in XLM,
// under a page titled "Trade on the XRP Ledger DEX". Live, plausible and entirely the wrong chain.
// That is worse than the blank wallet page, which at least showed nothing.
//
// Data comes from /lxapi/xrpltokens, never the upstream directly: the anonymous tier there is 333
// requests per DAY per IP, so a browser-side fetch would exhaust it and take out everyone behind a
// shared mobile IP at once.
//
// LOGOS are real now: each row carries the token md5 and the image is proxied through
// /lxapi/xrplthumb, because xrpl.to's thumbnail endpoint needs the API key and that key must never
// reach the browser. Initials remain the fallback for tokens with no logo.
//
// NO SPARKLINES, still deliberately: the feed gives a 7d PERCENTAGE, not a 7d series, and drawing a
// curve from a single number would be inventing the shape of the week.
(function () {
  if (window.__lxxTrade) return;
  window.__lxxTrade = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  // PLAIN DECIMALS, as lumoscore.com's price columns print them (RAZA 2026-09-15: "in Last Price column, we're not using
  // this notation") — "0.00000000000764", never "7.64e-12". Four significant digits, like the rest of the column.
  // SUBSCRIPT ZEROS for the very small (RAZA 2026-09-15: "instead of 0.00000000000000000070 just use subscript notation"):
  // 0.0₁₈70 — the subscript counts the zeros after the decimal point, then four significant digits.
  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }
  function tiny(v) { return v < 1e-8 ? subZero(v) : v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3)); }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.000001) return '$' + tiny(v);
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + (v / 1e6).toFixed(1) + 'M';
  }

  function xrp(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 0.000001) return tiny(v);
    if (v < 1) return v.toPrecision(4);
    if (v < 1e6) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return (v / 1e6).toFixed(2) + 'M';
  }

  function count(v) {
    if (v == null || !isFinite(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }

  function pct(v) { return (v == null || !isFinite(v)) ? null : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

  // ICONS: the design's icon classes (.mdx-mk-ic, .dex-mk-pair-ic, .dex-mover-ico) and the
  // data-lxic attribute are all hooks for inherited Stellar icon painters that resolve logos BY
  // TICKER -- they stamped a Stellar mark onto RLUSD, USDC and ARMY and cleared the text. A ticker
  // is not an identity on either ledger. So icons carry a class of our own and, now that the API
  // key exists, a REAL logo proxied through /lxapi/xrplthumb.
  // Real logo when we have one, initials when we do not.
  //
  // The <img> is wrapped in the SAME inline-SVG-bearing span used for initials, because the page
  // carries a logo healer that repaints any element with 1-5 characters of text -- an element
  // holding an img or svg is the only thing it skips. See browser/trade.js.
  //
  // The image goes through /lxapi/xrplthumb, never xrpl.to directly: that endpoint needs the API
  // key and the key must not reach the browser.
  function logoEl(name, md5, size) {
    var s = size || 32;
    var NS = 'http://www.w3.org/2000/svg';
    var e = document.createElement('span');
    e.className = 'lxx-ic';
    e.style.cssText = 'display:inline-flex;width:'+s+'px;height:'+s+'px;flex:0 0 '+s+'px;'
      + 'border-radius:50%;overflow:hidden;align-items:center;justify-content:center';

    function initials() {
      e.innerHTML = '';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('width', String(s)); svg.setAttribute('height', String(s));
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', '16');
      c.setAttribute('fill', 'rgba(255,255,255,.12)');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '16'); t.setAttribute('y', '17');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '800');
      t.setAttribute('fill', '#fff');
      t.textContent = String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      svg.appendChild(c); svg.appendChild(t);
      e.appendChild(svg);
    }

    if (/^[0-9a-f]{32}$/i.test(md5 || '')) {
      var img = document.createElement('img');
      img.src = '/lxapi/xrplthumb?id=' + md5 + '&w=' + (s > 48 ? 64 : 48);
      img.alt = ''; img.loading = 'lazy'; img.width = s; img.height = s;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      // A token with no logo upstream 404s. Fall back rather than leave a broken image.
      img.onerror = initials;
      e.appendChild(img);
    } else {
      initials();
    }
    return e;
  }


  (function () {
    if (document.getElementById('lxx-ic-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-ic-css';
    st.textContent = '.lxx-ic{width:32px;height:32px;flex:0 0 32px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-size:11px;'
      + 'font-weight:800;letter-spacing:.2px;color:#fff;background:rgba(255,255,255,.10)}';
    document.head.appendChild(st);
  })();

  // The table is keyed by ticker+issuer, the same identity the rest of the site uses. The ticker
  // alone is NOT an identity on this ledger any more than it is on Stellar -- several unrelated
  // tokens call themselves USDC -- so the issuer travels with it on the row.
  // CLICKING A TRADING PAIR DID NOTHING, for the same reason pool rows went to /pools/stellar.
  //
  // The design ships window.__lumosNav, a blanket row-navigation layer configured with a LISTTARGET
  // and CONTAINERNAV, which claims clicks on any row of a list page and routes them through its own
  // candidate resolver. On this fork that resolver produces Stellar-shaped destinations, so the row
  // either went somewhere that does not exist or — here — was swallowed and went nowhere at all.
  //
  // Ordinary click handlers on the row lose: capture descends from the top, so a document-level
  // listener always runs first, and an <a href> is simply preventDefaulted. WINDOW capture is the one
  // phase that runs before any of it. Scoped to the two market containers so nothing else changes.
  //
  // The destination is read from data-lxgo on the row rather than from a closure, which is what lets
  // one handler serve both the desktop table and the phone's card list.
  function claimRowClicks() {
    if (window.__lxxTradeNav) return;
    window.__lxxTradeNav = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // SORTING HAS TO BE HANDLED HERE, not on the header itself. A listener bound to the `th` never
      // gets the chance: the design claims clicks anywhere in a list page on WINDOW CAPTURE and
      // routes them through its own resolver, so the first click on "Last Price" reloaded the page
      // instead of sorting it. Window capture is the only phase early enough — the same reason the
      // row navigation below lives here rather than on the rows.
      var th = t.closest('th.lx-sortable');
      if (th) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onSortClick(th);
        return;
      }

      // The row's own Trade button and any real control keep their behaviour.
      if (t.closest('button, a, input, select, [data-copy]')) return;
      var el2 = t.closest('[data-lxgo]');
      if (!el2) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = el2.getAttribute('data-lxgo');
    }, true);
  }

  // THE VERIFIED TICK lumoscore.com draws beside a trusted issuer (RAZA 2026-09-15: "add verified tick on trusted
  // XRPL assets"): its own span and glyph, styled by the inherited .lx-vtick rule. xrpl.to's verified flag decides,
  // the same flag the search rows already use.
  function vtick() {
    var s = document.createElement('span');
    s.className = 'lx-vtick';
    s.title = 'Verified issuer';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }

  function row(t, rank, usd) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-tkr', t.n);
    tr.setAttribute('data-iss', t.i);

    // 0: asset
    var c0 = el('td');
    var cell = el('div', 'dex-mk-pair-cell');
    cell.appendChild(el('span', 'dex-mk-rank', '#' + rank));
    var ic = logoEl(t.n, t.m, 32);
    cell.appendChild(ic);
    var nm = el('div', 'dex-mk-pair-name');
    var head = el('div', 'dex-mk-pair-head', t.n);
    // EVERY ROW IN THIS TABLE IS TICKED (RAZA 2026-10-02: "Lets add verification tick to all XRPL assets
    // that we're showing on Trade page as curated assets", reaffirmed after I flagged what follows).
    //
    // ON THE RECORD, because the next person reading this will assume the tick means what it says: this
    // table is the top of the XRP Ledger market BY VOLUME, fetched live — not an allowlist anyone
    // maintains. So the tick now means "we list it", not "we checked it", and a token that trades its
    // way into the top hundred gets one. A search for "atom" on this build returns four different
    // tokens called ATOM, two of which claim a home domain the ledger disagrees with.
    //
    // If this is ever to mean verification again it needs a real curated list — issuer+currency, owned
    // by someone — and this line gated back on membership of it.
    head.appendChild(vtick());
    nm.appendChild(head);
    if (t.u) nm.appendChild(el('div', 'sub', t.u));
    cell.appendChild(nm);
    c0.appendChild(cell);
    tr.appendChild(c0);

    // 1: last price. The denomination toggle SWAPS the headline and the sub-line rather than hiding
    //    one of them — the same thing lumoscore.com does, checked by clicking it: XLM mode reads
    //    "5.6406 / $1.0000" and $ mode reads "$1.0000 / 5.6406 XLM".
    var c1 = el('td');
    var pr;
    if (DEN === 'usd' && usd != null) {
      pr = el('div', 'dex-mk-price');
      pr.appendChild(el('span', 'lc-money', money(t.p * usd)));
      var subx = el('span', 'sub', xrp(t.p) + ' XRP');
      pr.appendChild(subx);
    } else {
      pr = el('div', 'dex-mk-price', xrp(t.p));
      if (usd != null) {
        var sub = el('span', 'sub');
        sub.appendChild(el('span', 'lc-money', money(t.p * usd)));
        pr.appendChild(sub);
      }
    }
    c1.appendChild(pr);
    tr.appendChild(c1);

    // 2: 24h change, IN THE CHOSEN DENOMINATION — a different number, not a relabel.
    //    A token priced in XRP can be flat in dollars while XRP itself moves, and Stellar shows
    //    exactly that: USDC reads +6.59% against XLM and +0.00% against the dollar on the same row.
    var c2 = el('td');
    var dv = changeIn(t.d);
    var ch = el('div', 'dex-mk-change', pct(dv) || '—');
    if (dv != null) ch.style.color = dv >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    c2.appendChild(ch);
    tr.appendChild(c2);

    // 3: 24h volume
    var c3 = el('td');
    var vol = el('div', 'dex-mk-vol', xrp(t.v) + ' XRP');
    if (usd != null && t.v != null) {
      var vs = el('span', 'sub');
      vs.appendChild(el('span', 'lc-money', money(t.v * usd)));
      vol.appendChild(vs);
    }
    c3.appendChild(vol);
    tr.appendChild(c3);

    // 4: trades
    var c4 = el('td', 'dex-mk-trades-td');
    c4.appendChild(el('div', 'dex-mk-trades', count(t.x)));
    tr.appendChild(c4);

    // 5: liquidity
    var c5 = el('td');
    var tv = el('div', 'dex-mk-tvl');
    tv.appendChild(el('span', 'lc-money', usd != null && t.t != null ? money(t.t * usd) : '—'));
    c5.appendChild(tv);
    tr.appendChild(c5);

    // 6: day high / low
    var c6 = el('td');
    var hl = el('div', 'dex-mk-hl');
    var r1 = el('div', 'row');
    r1.appendChild(el('span', 'lab', 'H'));
    r1.appendChild(el('span', 'v-h', xrp(t.hi)));
    var r2 = el('div', 'row');
    r2.appendChild(el('span', 'lab', 'L'));
    r2.appendChild(el('span', 'v-l', xrp(t.lo)));
    hl.appendChild(r1); hl.appendChild(r2);
    c6.appendChild(hl);
    tr.appendChild(c6);

    // 7: 7d trend -- the percentage, not a drawn curve. See the note at the top of this file.
    var c7 = el('td');
    // EMPTY UNTIL THE CURVE ARRIVES (RAZA 2026-09-15: "In 7D Trend, it shows percentage for split second then fixes to the
    // graph"). The percentage waits on the cell and is written only if no series comes back for this row.
    var w = el('div', 'dex-mk-change', '');
    w.setAttribute('data-lxpct', pct(t.w) || '—');
    if (t.w != null) w.style.color = t.w >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    c7.appendChild(w);
    tr.appendChild(c7);

    // 8: action
    var c8 = el('td', 'td-action');
    var b = el('button', 'dex-mk-action-btn', 'Trade');
    b.type = 'button';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window.location.href = '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i);
    });
    c8.appendChild(b);
    tr.appendChild(c8);

    // The destination is stamped on the row rather than closed over, so the window-capture claim
    // below can read it. See claimRowClicks() for why a plain click handler here does nothing.
    tr.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return tr;
  }

  // The MOBILE market list is a different structure entirely -- .mdx-mk-row cards in #mdxMkList,
  // not table rows in #dexMkTbody -- and the mobile page carries none of the dex* ids. Writing only
  // the desktop renderer is the most repeated bug in this project, and it bit again here: the first
  // pass guarded on id="dexMkTbody", so the phone was skipped entirely and kept showing the Stellar
  // market list, complete with /trade/stellar/ links.
  function mkCard(t, rank, usd) {
    var card = el('div', 'mdx-mk-row');
    card.appendChild(el('span', 'mdx-mk-rank', '#' + rank));

    var top = el('div', 'mdx-mk-top');
        // NOT 'lxmd-ic': that class is lx-mobdex's hook, and it decorates whatever carries it --
    // stamping a Stellar mark and clearing the initials. Layout class only.
    var ic = logoEl(t.n, t.m, 32);
    top.appendChild(ic);

    var meta = el('div', 'mdx-mk-meta');
    var nameRow = el('div', 'mdx-mk-name-row');
    nameRow.appendChild(el('span', 'mdx-mk-name', t.n));
    // The phone card lists the same rows, so it ticks on the same rule — see the desktop note above.
    nameRow.appendChild(vtick());
    if (t.u) nameRow.appendChild(el('span', 'mdx-mk-domain', t.u));
    meta.appendChild(nameRow);
    // THE PHONE IGNORED THE DENOMINATION AND DISAGREED WITH THE DESKTOP. This card hard-coded the
    // XRP price and the XRP-denominated change while the table honoured DEN, so at the same moment
    // RLUSD read "-0.09%" on a desktop and "+4.56%" on a phone — the same token, the same second,
    // two different 24h figures, because one was measured against the dollar and the other against
    // an XRP that had moved 4.6%.
    //
    // USD is what lumoscore.com's phone build shows — read off it directly: "Vol $964.04K",
    // "$1.0000 +0.11%", and no denomination toggle on that breakpoint either. So the card follows
    // DEN like the table does, which makes the two devices agree and matches main.
    //
    // `usd` was already a parameter here and was simply never used.
    var usdOn = (DEN === 'usd' && usd != null);

    var vol = el('div', 'mdx-mk-vol', 'Vol ' + (usdOn ? money(t.v * usd) : (xrp(t.v) + ' XRP')));
    if (t.x != null) vol.appendChild(el('span', 'mdx-mk-trades', count(t.x) + ' trades'));
    meta.appendChild(vol);
    top.appendChild(meta);

    var right = el('div', 'mdx-mk-right');
    right.appendChild(el('div', 'mdx-mk-price', usdOn ? money(t.p * usd) : (xrp(t.p) + ' XRP')));
    var dv = changeIn(t.d);
    var p = el('div', 'mdx-mk-pct ' + (dv != null && dv < 0 ? 'down' : 'up'), pct(dv) || '—');
    right.appendChild(p);
    top.appendChild(right);

    card.appendChild(top);
    card.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return card;
  }

  function mover(t, usd) {
    var card = el('div', 'dex-mover-card');
    card.setAttribute('data-tkr', t.n);
    var head = el('div', 'dex-mover-head');
    var ic = logoEl(t.n, t.m, 32);
    head.appendChild(ic);
    var pair = el('div', 'dex-mover-pair', t.n);
    if (t.u) pair.appendChild(el('span', 'sub', ' ' + t.u));
    head.appendChild(pair);
    var p = el('span', 'dex-mover-pct', pct(t.d) || '—');
    if (t.d != null) p.style.color = t.d >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    head.appendChild(p);
    card.appendChild(head);
    var body = el('div', 'dex-mover-body', xrp(t.p) + ' XRP'
      + (usd != null ? ('  ·  ' + money(t.p * usd)) : ''));
    card.appendChild(body);
    card.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return card;
  }

  // The design's column headers name the quote asset, and the page composes them from a variable
  // that still said XLM. Set explicitly here: this layer decides what the numbers are quoted in, so
  // it is the thing that should label them.
  // ---- pagination --------------------------------------------------------------------------------
  //
  // THE PAGER WAS THE DESIGN'S, AND IT WAS FURNITURE. Clicking "2" did nothing at all: this layer
  // fetched 50 rows, rendered all of them, and never touched the buttons. The numbers under them
  // were the template's own and did not even agree with each other — "Showing 1–50 of 142 pairs"
  // beside eight page buttons, which would be 400 rows.
  //
  // Rebuilt from the real row count. The design's markup is reused exactly as it ships — First,
  // Prev, numbers, an ellipsis, Next, Last — so nothing new is introduced; only how many buttons
  // there are and what they do.
  var PER = 50;
  var pageNo = 1;

  function setPageInfo(from, to, total) {
    var shown = $('#dexMkShown');
    if (shown) shown.textContent = from + '–' + to;
    // The total is the SECOND <strong> in the line and carries no id of its own:
    //   Showing <strong id="dexMkShown">1–50</strong> of <strong>142</strong> pairs
    // querySelectorAll, not `$$` — this file defines `$` only. Written as `$$` first, exactly as in
    // wallet.js an hour earlier; `node -c` passes it both times because it is a runtime reference.
    var strongs = document.querySelectorAll('.dex-mk-page-info strong');
    if (strongs.length > 1) strongs[strongs.length - 1].textContent = String(total);
  }

  function buildPager(h, d, pages) {
    var pager = $('.dex-mk-pager');
    if (!pager) return;

    // Keep the design's own First/Prev/Next/Last buttons — they carry its icons — and rebuild only
    // the numbers between them.
    var kids = [].slice.call(pager.children);
    var first = kids[0], prev = kids[1];
    var next = kids[kids.length - 2], last = kids[kids.length - 1];
    kids.forEach(function (k) { if (k !== first && k !== prev && k !== next && k !== last) k.remove(); });

    function numBtn(n) {
      var b = document.createElement('button');
      b.className = 'dex-mk-pgbtn' + (n === pageNo ? ' active' : '');
      b.textContent = String(n);
      b.addEventListener('click', function () { renderPage(h, d, n); });
      return b;
    }
    // ASCENDING. Each insert lands immediately before `next`, so a descending loop stacks the
    // numbers backwards — it shipped once reading "2 1", which the page-2 check caught.
    for (var n = 1; n <= pages; n++) pager.insertBefore(numBtn(n), next);

    function nav(btn, target, disabled) {
      if (!btn) return;
      var clone = btn.cloneNode(true);            // drops any listener a previous render attached
      btn.parentNode.replaceChild(clone, btn);
      clone.disabled = !!disabled;
      clone.style.opacity = disabled ? '.4' : '';
      if (!disabled) clone.addEventListener('click', function () { renderPage(h, d, target); });
    }
    nav(first, 1, pageNo === 1);
    nav(prev, pageNo - 1, pageNo === 1);
    nav(next, pageNo + 1, pageNo === pages);
    nav(last, pages, pageNo === pages);

    // The whole pager is pointless with one page, and the design has no state for that.
    pager.style.display = pages > 1 ? '' : 'none';
  }

  // ---- the filter box ------------------------------------------------------------------------------
  //
  // THIS BOX HAD NEVER BEEN WIRED TO XRP LEDGER DATA. Its only handler was the design's, which
  // filtered the Aptos sample array — so typing in it did not "break" the table, it REPLACED the
  // table with twelve EVM-issued mock rows. Both halves of that were RAZA's report, filed as two
  // separate complaints ("search broken", "these aren't xrpl assets"), and they were one bug.
  //
  // Disabling the mock renderer removes the wrong rows and leaves the box inert, so the handler has
  // to exist here. Matched to Stellar's scope: ticker, issuer name, and issuer address.
  var QUERY = '';

  // ---- sortable columns ----------------------------------------------------------------------------
  //
  // lumoscore.com/trade/stellar sorts on five headers and this build sorted on none — the last thing
  // left in "still not fully like on Stellar" for this table. The STYLING was already here: an
  // inherited stylesheet carries `.dex-mk-table thead th.lx-sortable{cursor:pointer…}`, `.lx-son`
  // for the active column and `.lx-sarrow` for the glyph, complete with a comment explaining which
  // five columns take a click. Only the script that applied those classes was stripped, so the fork
  // had the affordance's CSS and none of its behaviour — the stripped-layer pattern once more.
  //
  // Behaviour read off the live control rather than guessed: the first click on a column sorts
  // DESCENDING, Volume is the default and opens showing ▼, and the rank column RENUMBERS to the
  // current view (sorting Stellar by price gives #1 yBTC, #2 ETH, #3 yETH). I had numbered the
  // filtered view by absolute volume rank on the reasoning that a rank which renumbers is worse than
  // none; Stellar does the opposite, and Stellar is the spec here.
  var SORT = { key: 'v', dir: -1 };

  // Columns in DOM order, so the header wiring and the sort key cannot drift apart.
  var COLS = [
    null,                       // 0 Asset
    { th: 'th-price', key: 'p' },
    { th: 'th-change', key: 'd' },   // ordering by the XRP change matches ordering by the $ change:
    { th: 'th-vol', key: 'v' },      // changeIn() is monotonic in d for a fixed XRP24
    { th: 'th-trades', key: 'x' },
    { th: 'th-tvl', key: 't' },
  ];

  function visible(d) {
    var rows = d.rows;

    if (QUERY) {
      var q = QUERY.toLowerCase();
      rows = rows.filter(function (t) {
        return String(t.n || '').toLowerCase().indexOf(q) >= 0
          || String(t.u || '').toLowerCase().indexOf(q) >= 0
          || String(t.i || '').toLowerCase().indexOf(q) >= 0;
      });
    } else {
      rows = rows.slice();                       // never sort the source array in place
    }

    var k = SORT.key, dir = SORT.dir;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      // A missing figure is not a zero. Nulls sink to the bottom in BOTH directions, so ascending by
      // volume opens on the smallest real number rather than on a wall of em dashes.
      var xn = (x == null || !isFinite(x)), yn = (y == null || !isFinite(y));
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      return x < y ? -dir : (x > y ? dir : 0);
    });
    return rows;
  }

  function paintSortHeads() {
    var tbl = $('.dex-mk-table');
    if (!tbl) return;
    COLS.forEach(function (c) {
      if (!c) return;
      var th = tbl.querySelector('thead th.' + c.th);
      if (!th) return;
      var on = SORT.key === c.key;
      th.classList.toggle('lx-son', on);
      var ar = th.querySelector('.lx-sarrow');
      if (ar) ar.textContent = on ? (SORT.dir < 0 ? '▼' : '▲') : '⇅';
    });
  }

  // Marks the columns and draws their arrows. The CLICK is claimed in claimRowClicks() — see the note
  // there for why a listener on the header cannot work on this page.
  function wireSort() {
    var tbl = $('.dex-mk-table');
    if (!tbl) return;
    COLS.forEach(function (c) {
      if (!c) return;
      var th = tbl.querySelector('thead th.' + c.th);
      if (!th) return;
      th.classList.add('lx-sortable');
      if (!th.querySelector('.lx-sarrow')) th.appendChild(el('span', 'lx-sarrow', '⇅'));
    });
    paintSortHeads();
  }

  function onSortClick(th) {
    var c = null;
    for (var i = 0; i < COLS.length; i++) {
      if (COLS[i] && th.classList.contains(COLS[i].th)) { c = COLS[i]; break; }
    }
    if (!c) return;
    // Same column flips direction; a new column starts descending, which is what the live one does.
    if (SORT.key === c.key) SORT.dir = -SORT.dir;
    else { SORT.key = c.key; SORT.dir = -1; }

    var h = host(), d = window.__lxxTradeData;
    if (h && d && d.rows) renderPage(h, d, 1);
  }

  function wireSearch(h, d) {
    var input = $('#dexMkSearch') || $('#mdxMkSearch');
    if (!input || input.getAttribute('data-lxq') === '1') return;
    input.setAttribute('data-lxq', '1');
    input.addEventListener('input', function () {
      QUERY = String(input.value || '').trim();
      renderPage(h, d, 1);                 // back to page 1: page 4 of a 2-page result is nothing
    });
  }

  function renderPage(h, d, n) {
    var rows = visible(d);
    var total = rows.length;
    paintSortHeads();

    // A filter that matches nothing is a real answer and needs to say so, rather than leaving the
    // last result on screen looking like a match.
    if (!total) {
      note(h, 'No pair matches “' + QUERY + '”.');
      setPageInfo(0, 0, 0);
      buildPager(h, d, 1);
      return;
    }

    // NO PAGER, NO PAGING. The phone build has no .dex-mk-pager at all — checked on the served
    // page at 375px: pagerPresent false, a card list and no table. Paging a list with no controls
    // would have hidden rows 51-100 behind a button that does not exist, which is worse than what
    // was there before this change (it fetched 50 and showed all 50). So the phone shows the whole
    // hundred and the desktop pages them.
    var paged = !!$('.dex-mk-pager');
    var per = paged ? PER : total;
    var pages = Math.max(1, Math.ceil(total / per));
    pageNo = Math.min(Math.max(1, n), pages);

    var from = (pageNo - 1) * per;
    var to = Math.min(from + per, total);

    h.node.innerHTML = '';
    var make = h.kind === 'table' ? row : mkCard;
    // The rank passed through is the ABSOLUTE position, so page 2 starts at #51 rather than
    // restarting at #1 — the number means "51st by volume", not "first row I drew".
    // Rank is the position in the CURRENT view, renumbering on sort and on filter, because that is
    // what the live Stellar table does — checked by clicking its Last Price header.
    for (var i = from; i < to; i++) h.node.appendChild(make(rows[i], i + 1, d.usd));

    setPageInfo(from + 1, to, total);
    buildPager(h, d, pages);

    // Only the rows actually on screen. Asking for all hundred when fifty are shown would double
    // the upstream cost of a page nobody is looking at yet; page 2 fetches its own when opened, and
    // the edge cache makes the second visit free.
    if (h.kind === 'table') loadSparks(rows.slice(from, to));
  }

  // THE CONTROLS ROW, AGAINST lumoscore.com AS THE REFERENCE.
  //
  // Three separate faults, all visible in the strip beside "All Trading Pairs".
  //
  // 1. LAUNCH TOKEN WAS IN THE PAGE AND UNREACHABLE. The `.lx-dctas` block — "How it works?" and
  //    "Launch Token" — exists here with a correct /launchpad href, but it is nested inside
  //    `.dex-overview`, and an inherited script unconditionally stamps `lx-dexhero-off` on that
  //    element, which is `display:none`. On Stellar the same script runs and the block is still
  //    visible, because Stellar's markup has it in `.dex-mk-controls` instead. This is the stale
  //    container again: the fork carries the OLD design, where these buttons lived in the hero.
  //    Moved to where the reference has them. Not new UI — the same nodes, re-parented.
  //
  // 2. THE FILTER CHIP WORE STELLAR'S LOGO. It ships `<img src="/assets/tokens/xlm.png">`, and
  //    /assets/tokens holds Stellar assets only — there is no xrp.png to point at. The XRP mark
  //    comes from the thumb endpoint under xrpl.to's fixed id for XRP, the same source bridge.js
  //    already uses for it.
  //
  // 3. THE SEARCH PLACEHOLDER RAN LONG AND TRUNCATED. Stellar reads "Filter curated pairs" and
  //    fits; this read "Filter pairs · ticker or address" and was cut off mid-word in the same
  //    width. Shortened to match. The wording is a judgement call — say the word and it changes.
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  // This project's own token, which the market's top hundred does not carry yet.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var LUMOS_CUR = '4C554D4F53000000000000000000000000000000';

  // ---- the $ / XRP denomination toggle -------------------------------------------------------------
  //
  // Stellar's markup ships this control; ours does not. `.lx-dnsw` exists in this build as CSS ONLY,
  // because Stellar's own dex layer BUILDS the element at runtime and that layer is stripped here —
  // so the styling was inherited and the thing it styles never existed. Built here to match, which
  // is why it needs no CSS of its own.
  //
  // What it actually does, established by clicking the real one rather than guessing from the
  // aria-label: the price cell swaps its headline and sub-line, the 24h change becomes a DIFFERENT
  // NUMBER computed in the chosen denomination, and the two column headers relabel. Nothing else in
  // the table moves — volume, liquidity and high/low stay as they are on Stellar too.
  // Dollars first, because that is what lumoscore.com/trade/stellar does: read off the live control
  // there, the `$` button carries `.on` and `XLM` does not. This build had it the other way round.
  //
  // The cost is a visible one and worth stating: a token's change IN DOLLARS needs XRP's own 24h move,
  // which arrives on a second request, so the 24h column reads em dashes until it lands (and keeps
  // reading them if it never does). The alternative — printing the XRP-denominated change under a $
  // heading — is a wrong number rather than a missing one, so the gap stays.
  //
  // CORRECTED 2026-09-15: that reading was wrong. Stellar's default is XLM — `denom()` in its dex layer
  // returns "xlm" unless `lumos.dexDenom` says otherwise — and the "$ on" observation above was a
  // remembered choice in that browser's storage. So XRP leads here, and the choice is remembered under
  // the same key, exactly as there. RAZA saw the mismatch as "a font color and size difference".
  var DEN = 'xrp';
  try { var _dn = localStorage.getItem('lumos.dexDenom'); if (_dn === 'usd' || _dn === 'xrp') DEN = _dn; } catch (e) {}

  // XRP's own 24h move, needed to express a token's change in dollars. Without it the $ column
  // would silently show the XRP-denominated number under a $ heading, which is worse than not
  // having the toggle at all — so `changeIn` returns null and the cell reads an em dash instead.
  var XRP24 = null;

  function changeIn(d) {
    if (DEN !== 'usd') return d;
    if (d == null || XRP24 == null) return null;
    // Composed, not added: a token up 10% against an XRP that is down 5% is not up 5% in dollars.
    return ((1 + d / 100) * (1 + XRP24 / 100) - 1) * 100;
  }

  function denomLabel() { return DEN === 'usd' ? '($)' : '(XRP)'; }

  function buildDenToggle(h, d) {
    var controls = $('.dex-mk-controls');
    if (!controls || $('.lx-dnsw')) return;

    var wrap = el('div', 'lx-dnsw');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Show price change in');

    function mk(mode, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dn', mode);
      b.textContent = label;
      b.addEventListener('click', function () {
        if (DEN === mode) return;
        DEN = mode;
        paintDenToggle();
        headers();
        renderPage(h, d, pageNo);              // same page, re-denominated
      });
      return b;
    }
    wrap.appendChild(mk('usd', '$'));
    wrap.appendChild(mk('xrp', 'XRP'));

    // After the filter chips and before the search box, which is where Stellar has it. The previous
    // version looked up `#dexMkSearch` — the INPUT, whose parent is `.dex-mk-search` and never
    // `.dex-mk-controls` — so the ownership test failed every time and the toggle silently fell
    // through to appendChild, landing after the search box instead of before it. The wrapper is what
    // sits in the controls row, so that is what to measure against.
    var search = $('.dex-mk-search');
    if (search && search.parentNode === controls) controls.insertBefore(wrap, search);
    else controls.appendChild(wrap);

    paintDenToggle();
  }

  function paintDenToggle() {
    var btns = document.querySelectorAll('.lx-dnsw button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-dn') === DEN;
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      btns[i].classList.toggle('on', on);      // `.lx-dnsw button.on` is already styled here
    }
  }

  function fixControls() {
    var ctas = $('.lx-dctas');
    var controls = $('.dex-mk-controls');
    if (ctas && controls && !controls.contains(ctas)) {
      // First child, which is where Stellar has it: ahead of the chips and the search box.
      controls.insertBefore(ctas, controls.firstChild);
    }

    // FOUR DEAD CHIPS. Stables / Memes / Utility filter on `p.cat`, a field that exists only on the
    // design's Aptos sample rows — no XRP Ledger token carries it, so each of these can only ever
    // produce an empty table. "LumosCore native" has no meaning here either. lumoscore.com/trade/stellar
    // removes exactly these four and leaves one chip standing; read off the live control, its filter
    // row holds a single button. Matched here, same kill list.
    //
    // The label stays "All" rather than Stellar's "Curated": that row is Stellar's curated list, and
    // this one is the top of the XRP Ledger market by volume. Copying the word would be copying a
    // claim, not a layout.
    var kill = { native: 1, stables: 1, memes: 1, utility: 1 };
    var chips = document.querySelectorAll('.dex-mk-filter, .mdx-mk-filter');
    for (var c = 0; c < chips.length; c++) {
      var f = (chips[c].getAttribute('data-filter') || '').toLowerCase();
      if (kill[f] && chips[c].parentNode) chips[c].parentNode.removeChild(chips[c]);
    }
    // If the chip that was active happened to be one of the four, nothing is selected and the row
    // reads as having no state at all. Stellar guards the same way.
    if (!$('.dex-mk-filter.active, .mdx-mk-filter.active')) {
      var first = $('.dex-mk-filter, .mdx-mk-filter');
      if (first) first.classList.add('active');
    }

    // Hidden on Stellar — `getComputedStyle(#dexHiwBtn).display` is "none" there, so the row opens
    // with Launch Token and nothing else. Here it was showing the full "How it works?" anchor, which
    // is the extra element in RAZA's "Launch Token All Filter pairs $ XRP". Hidden rather than
    // removed, and given a title, so whatever is bound to it survives.
    var hiw = $('#dexHiwBtn');
    if (hiw) {
      hiw.style.display = 'none';
      if (!hiw.getAttribute('title')) {
        hiw.setAttribute('title', 'How it works');
        hiw.setAttribute('aria-label', 'How it works');
      }
    }

    var chipImg = $('.dex-mk-filter img');
    if (chipImg && /xlm\.png/i.test(chipImg.getAttribute('src') || '')) {
      chipImg.setAttribute('src', XRP_LOGO);
      chipImg.setAttribute('alt', '');
    }
    // SAME BOX, SMALLER MARK. Both builds draw this image at 22px, but Stellar's xlm.png is a thin glyph
    // with room around it while xrpl.to's XRP thumb is a solid disc edge to edge — so at the same size the
    // XRP mark reads visibly bigger (RAZA 2026-09-15). Inset to 16px inside the unchanged 22px slot.
    if (chipImg && chipImg.getAttribute('src') === XRP_LOGO) {
      chipImg.style.cssText = 'width:16px!important;height:16px!important;margin:3px;border-radius:50%';
    }

    // "CURATED", AS ON STELLAR — RAZA 2026-09-15, reversing the earlier "All". The chip's text is the
    // text node after its icon, so only that node is rewritten and the icon stays.
    // (No $$ helper in this file — an undefined one threw here and stopped the whole table rendering.)
    [].slice.call(document.querySelectorAll('.dex-mk-filter, .mdx-mk-filter')).forEach(function (chip) {
      if ((chip.getAttribute('data-filter') || '').toLowerCase() !== 'all') return;
      [].forEach.call(chip.childNodes, function (n) {
        if (n.nodeType === 3 && /^\s*All\s*$/.test(n.nodeValue)) n.nodeValue = 'Curated';
      });
    });

    var search = $('#dexMkSearch input') || $('#dexMkSearch');
    if (search && 'placeholder' in search) search.placeholder = 'Filter curated pairs';
  }

  // ---- 7d sparklines ------------------------------------------------------------------------------
  //
  // This column showed a bare percentage where lumoscore.com draws a curve. The comment at the top
  // of this file used to say sparklines were omitted deliberately because the feed gives a 7d
  // PERCENTAGE and not a series — true of the bulk response, and I checked every one of its ~150
  // fields again before building this. The series exists, just on a different upstream route, and
  // /lxapi/xrplspark batches it: one browser request for the whole page instead of fifty.
  //
  // Drawn with the design's own markup, copied from a real Stellar row:
  //     <svg class="dex-mk-spark" viewBox="0 0 88 28" preserveAspectRatio="none"><path d="…"></svg>
  // so it inherits the column's sizing and needs no CSS of its own.
  //
  // A row whose series does not arrive KEEPS ITS PERCENTAGE. Nothing is blanked on the way to being
  // drawn, and a token too thin to have a week of history simply stays as it was.
  function sparkPath(vals, w, h) {
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min;
    // A perfectly flat series has no range to scale into; draw it down the middle rather than
    // dividing by zero and sending NaN into the path.
    var mid = h / 2;
    var d = '';
    for (var i = 0; i < vals.length; i++) {
      var x = (i / (vals.length - 1)) * w;
      var y = span > 0 ? h - ((vals[i] - min) / span) * h : mid;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  function drawSpark(cell, vals, up) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'dex-mk-spark');
    svg.setAttribute('viewBox', '0 0 88 28');
    svg.setAttribute('preserveAspectRatio', 'none');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', sparkPath(vals, 88, 28));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', '1.5');
    // Coloured by the week's direction, which is what the number beside it used to say.
    p.setAttribute('stroke', up ? 'var(--green,#22c55e)' : '#e5484d');
    svg.appendChild(p);
    cell.innerHTML = '';
    cell.appendChild(svg);
  }

  // Series already fetched this page-load, keyed by token id. Without it every keystroke in the
  // filter box and every page-button click re-requested the same curves — cheap at the edge, but the
  // edge is not the budget that matters: xrpl.to allows 333 requests a DAY per IP and this layer is
  // the one thing on the site that can spend them in bursts.
  var SPARKS = {};

  function fillPct() {
    [].forEach.call(document.querySelectorAll('.dex-mk-change[data-lxpct]'), function (w) {
      if (!w.textContent) w.textContent = w.getAttribute('data-lxpct');
    });
  }

  function loadSparks(rows) {
    setTimeout(fillPct, 9000);                                   // a request that never answers still ends in a figure
    var byId = {};
    for (var i = 0; i < rows.length; i++) {
      if (/^[0-9a-f]{32}$/i.test(rows[i].m || '')) byId[rows[i].m.toLowerCase()] = rows[i];
    }
    var ids = Object.keys(byId).filter(function (id) { return !SPARKS[id]; });

    // Whatever is already known is drawn immediately, so a re-render does not blank curves it has.
    paintSparks(SPARKS, byId);
    if (!ids.length) { fillPct(); return; }

    fetch('/lxapi/xrplspark?ids=' + ids.join(','))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.series) return;
        for (var id in d.series) SPARKS[id] = d.series[id];
        paintSparks(d.series, byId);
      })
      .catch(function () {})
      .then(fillPct);                                            // rows with no series get their percentage
  }

  function paintSparks(series, byId) {
    for (var id in series) {
      var t = byId[id];
      if (!t) continue;
      // The row is found by the ticker+issuer stamped on it when it was built, so this cannot
      // paint a curve into the wrong row after a re-sort or a page change.
      var tr = $('tr[data-tkr="' + (window.CSS && CSS.escape ? CSS.escape(t.n) : t.n)
        + '"][data-iss="' + t.i + '"]');
      if (!tr || tr.children.length < 8) continue;
      var vals = series[id];
      if (!vals || vals.length < 2) continue;
      drawSpark(tr.children[7], vals, vals[vals.length - 1] >= vals[0]);
    }
  }

  function headers() {
    // THE TRADES COLUMN HAD A CELL IN EVERY ROW AND NO HEADER.
    //
    // The design's static markup ships eight th's and no Trades column; on Stellar a layer inserts
    // it at runtime, which is why lumoscore.com/trade/stellar shows nine headers over nine cells.
    // This layer emits a trades cell (c4, between volume and liquidity) and never added the header,
    // so the table ran 8 headers over 9 cells and every label from Liquidity rightward sat one
    // column left of its data — "Liquidity" over the trade count, "7d Trend" over the high/low, and
    // the 7d percentage under no header at all. That is the messed-up right-hand side.
    //
    // The class already carries `th-trades{text-align:right!important}` in the design stylesheet,
    // so this is restoring a column the design accounted for, not adding one.
    var tbl = $('.dex-mk-table');
    if (tbl && !tbl.querySelector('th.th-trades')) {
      var volTh = tbl.querySelector('th.th-vol');
      if (volTh && volTh.parentNode) {
        var tth = document.createElement('th');
        tth.className = 'th-trades';
        tth.textContent = 'Trades (24h)';
        volTh.parentNode.insertBefore(tth, volTh.nextSibling);
      }
    }

    // Price and change follow the denomination toggle; high/low does NOT, because it does not on
    // Stellar either — its header still reads (XLM) in $ mode.
    var map = { 'th-price': 'Last Price ' + denomLabel(), 'th-change': '24h Change ' + denomLabel(),
      'th-hl': 'Day High / Low (XRP)' };
    for (var k in map) {
      var th = $('.dex-mk-table th.' + k);
      if (!th) continue;
      // keep any sort-arrow element the page appended; replace only the label text node
      var replaced = false;
      for (var i = 0; i < th.childNodes.length; i++) {
        if (th.childNodes[i].nodeType === 3 && th.childNodes[i].textContent.trim()) {
          th.childNodes[i].textContent = map[k]; replaced = true; break;
        }
      }
      if (!replaced) th.textContent = map[k];
    }
  }

  // ATTRIBUTION. Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10.
  //
  // What changed in between was the evidence, not the opinion. The first removal was decided against
  // a note of mine saying attribution was "contractually required". The next day, building the
  // sparklines, xrpl.to's own API returned this in its response body, verbatim:
  //
  //     Required: display a visible link to https://xrpl.to on any surface showing this data —
  //     <a href="https://xrpl.to">Data by xrpl.to</a>. Terms: https://xrpl.to/docs
  //
  // That is the provider stating the condition itself, and by then this page was showing MORE of
  // their data than when it came out — the whole 7d sparkline column arrives from them.
  //
  // So it is back, and the endpoints were left returning `attribution` / `attributionUrl` through
  // the removal, which is why restoring it is this one function rather than an archaeology exercise.
  function attribution(d) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var host = $('.dex-mk-foot') || $('.dex-mk-table-wrap');
    if (!host) return;
    var p = el('p'); p.id = 'lxx-attr-dex';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Market data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // The design carries an anti-flash gate from the Stellar build:
  //     #dexMkTbody:not(.lxd) tr { visibility: hidden }
  // and the class was added by `lx-dexmain` once it had painted. That script is stripped now, but
  // its STYLE block (lx-dexmain-css) is a separate element and survives -- so without this, every
  // row is laid out at the right size with the right text and simply never appears. Same failure the
  // wallet page had. Called before the first note(), so the loading row is visible too.
  function lift() {
    var tb = $('#dexMkTbody');
    if (tb) tb.classList.add('lxd');
  }

  // The MOBILE page hides the real list and shows a skeleton instead, switched by a body class:
  //     body:not(.lxmd-ready) .mdx-mk-list { display: none !important }
  //     body:not(.lxmd-ready) .lxmd-skel   { display: block }
  // `lx-dexmain` set that class once it had data. Stripping it left the skeleton on screen forever
  // with 50 correct, invisible cards behind it -- the third gate of this shape in this project, and
  // the second that survives as CSS after its script is gone.
  //
  // Called when the fetch SETTLES rather than at start, so the skeleton keeps doing its job during
  // the load instead of flashing an empty list, and an error still ends up visible.
  function reveal() {
    try { document.body.classList.add('lxmd-ready'); } catch (e) {}
  }

  // Whichever list this page has. Both are never present at once: they are different page builds,
  // not a media-query pair, so there is no hidden-container problem here the way there was on the
  // wallet page.
  function host() {
    var t = $('#dexMkTbody');
    if (t) return { node: t, kind: 'table' };
    var l = $('#mdxMkList');
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 9;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function load() {
    var h = host();
    if (!h) return;                                    // not the Trade page
    headers();
    fixControls();
    lift();
    claimRowClicks();
    note(h, 'Reading the XRP Ledger…');

    // n=100, which is the endpoint's own ceiling — the worker takes one upstream page of 100 and
    // clamps with Math.min(100, ...). It is also parity with Stellar: lumoscore.com/trade/stellar
    // shows exactly two pages of 50, so matching it costs no extra upstream request. Asking for
    // more would mean additional pages against xrpl.to's 333-a-day budget, which is a bigger
    // decision than a pager.
    // ASKED AGAIN BEFORE GIVING UP (RAZA 2026-09-17: "sometimes i get this error when i open trade main page"). One refused
    // read emptied the whole market table; the upstream's daily cap makes that a matter of when, not if. The endpoint also
    // serves its last good answer when the live one fails, so this usually gets rows either way.
    (function ask(tries) {
      return fetch('/lxapi/xrpltokens?n=100').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok && d.rows && d.rows.length) return d;
        if (tries > 0) {
          return new Promise(function (res) { setTimeout(res, 1200 * (4 - tries)); }).then(function () { return ask(tries - 1); });
        }
        return d;
      }, function () {
        return tries > 0
          ? new Promise(function (res) { setTimeout(res, 1200 * (4 - tries)); }).then(function () { return ask(tries - 1); })
          : null;
      });
    })(3).then(function (d) {
      reveal();
      if (!d || !d.ok || !d.rows.length) { note(h, 'Market data is unavailable right now.'); return; }
      window.__lxxTradeData = d;

      // LUMOS IS ALWAYS IN THIS TABLE (RAZA 2026-09-17: "Add LUMOS to the curated assets on Trade main page"). The rows are
      // the market's top hundred by volume and LUMOS does not trade its way in yet, so it was simply absent from the page
      // that lists what this platform trades. Its row is fetched on its own and folded in — the same fields, from the same
      // upstream, so it sorts and prices exactly like every other row rather than being pinned on top as a special case.
      if (!d.rows.some(function (t) { return t.i === LUMOS_ISS; })) {
        // The endpoint keys on the upstream's own id form, "issuer-currencyHex" — it takes no iss/cur pair.
        fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(LUMOS_ISS + '-' + LUMOS_CUR))
          .then(function (r) { return r.json(); })
          .then(function (lt) {
            if (!lt || !lt.ok || !(lt.price > 0)) return;
            d.rows.push({
              c: lt.currency, i: lt.issuer, n: lt.name || 'LUMOS', u: lt.user || '',
              p: lt.price, d: lt.p24, w: lt.p7, v: lt.vol24, t: lt.tvl, x: lt.trades24,
              hi: lt.hi, lo: lt.lo,
              m: lt.md5 || '', h: lt.holders, vf: 1, o: lt.origin || ''
            });
            renderPage(h, d, pageNo);
          })
          .catch(function () {});
      }

      // XRP's own 24h move, for the dollar-denominated change column. Fire-and-forget: the toggle
      // is usable immediately in XRP mode, and if this never lands the $ column shows em dashes
      // rather than the XRP number wearing a $ heading.
      fetch('/lxapi/xrplprices?codes=XRP')
        .then(function (r) { return r.json(); })
        .then(function (pj) {
          var e = pj && pj.t && pj.t.XRP;
          if (e && isFinite(e[1])) XRP24 = Number(e[1]);
          if (DEN === 'usd') renderPage(h, d, pageNo);
        })
        .catch(function () {});

      buildDenToggle(h, d);
      wireSearch(h, d);
      wireSort();
      renderPage(h, d, 1);

      var grid = $('#dexMoverGrid') || $('#mdxMoverList');
      if (grid) {
        // Ranked by absolute 24h move among tokens that actually trade. The floor is doing real
        // work: measured on live data, a 500 XRP floor put "EATASS +361%" at the top of the page on
        // 1,693 XRP of volume -- about $2.4K, one fill moving a dust token. At 5,000 the list is
        // XRPH +33% and GATOR +18%, which are real moves; at 20,000 it flattens to +/-2% and stops
        // being a movers list at all.
        var top = d.rows.filter(function (t) { return t.d != null && t.v != null && t.v >= 5000; })
          .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); })
          .slice(0, 10);
        grid.innerHTML = '';
        for (var j = 0; j < top.length; j++) grid.appendChild(mover(top[j], d.usd));
      }

      attribution(d);
    }).catch(function () { reveal(); note(h, 'Market data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxTradeReload = load;
})();
