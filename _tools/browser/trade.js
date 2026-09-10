// Trade page: the XRP Ledger's most-traded tokens.
//
// THIS REPLACES A LAYER THAT WAS ACTIVELY WRONG, not one that was merely missing. Before this, the
// inherited `lx-dexmain` was still running on /xrpl/trade and filling the market table from Horizon:
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

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.000001) return '$' + v.toExponential(2);
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + (v / 1e6).toFixed(1) + 'M';
  }

  function xrp(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v < 0.000001) return v.toExponential(2);
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
    nm.appendChild(el('div', 'dex-mk-pair-head', t.n));
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
    var w = el('div', 'dex-mk-change', pct(t.w) || '—');
    if (t.w != null) w.style.color = t.w >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    c7.appendChild(w);
    tr.appendChild(c7);

    // 8: action
    var c8 = el('td', 'td-action');
    var b = el('button', 'dex-mk-action-btn', 'Trade');
    b.type = 'button';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window.location.href = '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i);
    });
    c8.appendChild(b);
    tr.appendChild(c8);

    // The destination is stamped on the row rather than closed over, so the window-capture claim
    // below can read it. See claimRowClicks() for why a plain click handler here does nothing.
    tr.setAttribute('data-lxgo', '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i));
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
    if (t.u) nameRow.appendChild(el('span', 'mdx-mk-domain', t.u));
    meta.appendChild(nameRow);
    var vol = el('div', 'mdx-mk-vol', 'Vol ' + xrp(t.v) + ' XRP');
    if (t.x != null) vol.appendChild(el('span', 'mdx-mk-trades', count(t.x) + ' trades'));
    meta.appendChild(vol);
    top.appendChild(meta);

    var right = el('div', 'mdx-mk-right');
    right.appendChild(el('div', 'mdx-mk-price', xrp(t.p) + ' XRP'));
    var p = el('div', 'mdx-mk-pct ' + (t.d != null && t.d < 0 ? 'down' : 'up'), pct(t.d) || '—');
    right.appendChild(p);
    top.appendChild(right);

    card.appendChild(top);
    card.setAttribute('data-lxgo', '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i));
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
    card.setAttribute('data-lxgo', '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i));
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

  function renderPage(h, d, n) {
    var total = d.rows.length;

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
    for (var i = from; i < to; i++) h.node.appendChild(make(d.rows[i], i + 1, d.usd));

    setPageInfo(from + 1, to, total);
    buildPager(h, d, pages);

    // Only the rows actually on screen. Asking for all hundred when fifty are shown would double
    // the upstream cost of a page nobody is looking at yet; page 2 fetches its own when opened, and
    // the edge cache makes the second visit free.
    if (h.kind === 'table') loadSparks(d.rows.slice(from, to));
  }

  // THE CONTROLS ROW, AGAINST lumoscore.com AS THE REFERENCE.
  //
  // Three separate faults, all visible in the strip beside "All Trading Pairs".
  //
  // 1. LAUNCH TOKEN WAS IN THE PAGE AND UNREACHABLE. The `.lx-dctas` block — "How it works?" and
  //    "Launch Token" — exists here with a correct /xrpl/launchpad href, but it is nested inside
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
  var DEN = 'xrp';

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

    // After the filter chips and before the search box, which is where Stellar has it.
    var search = $('#dexMkSearch');
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

    var chipImg = $('.dex-mk-filter img');
    if (chipImg && /xlm\.png/i.test(chipImg.getAttribute('src') || '')) {
      chipImg.setAttribute('src', XRP_LOGO);
      chipImg.setAttribute('alt', '');
    }

    var search = $('#dexMkSearch input') || $('#dexMkSearch');
    if (search && 'placeholder' in search) search.placeholder = 'Filter pairs';
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

  function loadSparks(rows) {
    var byId = {};
    for (var i = 0; i < rows.length; i++) {
      if (/^[0-9a-f]{32}$/i.test(rows[i].m || '')) byId[rows[i].m.toLowerCase()] = rows[i];
    }
    var ids = Object.keys(byId);
    if (!ids.length) return;

    fetch('/lxapi/xrplspark?ids=' + ids.join(','))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.series) return;
        for (var id in d.series) {
          var t = byId[id];
          if (!t) continue;
          // The row is found by the ticker+issuer stamped on it when it was built, so this cannot
          // paint a curve into the wrong row after a re-sort or a page change.
          var tr = $('tr[data-tkr="' + (window.CSS && CSS.escape ? CSS.escape(t.n) : t.n)
            + '"][data-iss="' + t.i + '"]');
          if (!tr || tr.children.length < 8) continue;
          var vals = d.series[id];
          if (!vals || vals.length < 2) continue;
          drawSpark(tr.children[7], vals, vals[vals.length - 1] >= vals[0]);
        }
      })
      .catch(function () { /* the percentages stay exactly as they are */ });
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

  // REMOVED ON RAZA'S EXPLICIT INSTRUCTION, 2026-09-09. This used to append
  // "Market data Data by xrpl.to" under the table.
  //
  // The concern was raised before removing it and RAZA confirmed: my notes record xrpl.to's
  // attribution as a condition of their API terms, which is why the line existed and why the
  // endpoint still returns `attribution` and `attributionUrl`. That is a commercial decision and
  // it is RAZA's to make, not mine — but the reason is written here so nobody later reads this as
  // an oversight and quietly re-adds it, or removes the server fields thinking they are unused.
  //
  // Kept as a no-op rather than deleted, so the call sites still read as a deliberate choice.
  function attribution() { /* attribution intentionally not rendered */ }

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
    fetch('/lxapi/xrpltokens?n=100').then(function (r) { return r.json(); }).then(function (d) {
      reveal();
      if (!d || !d.ok || !d.rows.length) { note(h, 'Market data is unavailable right now.'); return; }
      window.__lxxTradeData = d;

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
