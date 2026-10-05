// Trade-Asset page: one XRP Ledger token.
//
// REPLACES THE MOST VISIBLY WRONG PAGE ON THE SITE. `lx-dxadata` ignored the token in the URL
// entirely and rendered Stellar LUMOS: 105 mentions of XLM and 124 Stellar addresses, under a title
// reading "LUMOS price, pools and holders on Stellar". It was reached by clicking any row in the
// XRP Ledger market table, so the better the Trade page got, the more people it sent here.
//
// Two sources, on purpose:
//   token details  /lxapi/xrpltoken  -- proxied and cached (333 upstream requests per DAY per IP)
//   ORDER BOOK     the XRP Ledger itself, via book_offers, straight from the browser. No rate limit
//                  worth proxying for, no third party to trust, and a book should be as live as the
//                  ledger. It is also the one number here nobody has to take on faith.
(function () {
  if (window.__lxxDexAsset) return;
  window.__lxxDexAsset = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // SUBSCRIPT ZEROS for the very small (RAZA 2026-09-15: "instead of 0.00000000000000000070 just use subscript notation"):
  // 0.0₁₈70 — the subscript counts the zeros after the decimal point, then four significant digits.
  // THE ROOT DOMAIN ONLY (RAZA 2026-09-16: "Just show the root domain as homedomain" — firstledger.net, not
  // firstledger.net/token/rhc8…/5852…). Protocol, path, port and www. go; a two-letter country suffix keeps its label.
  function rootDomain(v) {
    var h = String(v || '').trim().replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0].split(':')[0].toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
    var p = h.split('.');
    if (p.length <= 2) return h;
    var keep = (/^(co|com|net|org|gov|edu|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) ? 3 : 2;
    return p.slice(-keep).join('.');
  }

  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }

  function xrp(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 1e-8) return subZero(v);
    // Plain decimals at any size, as lumoscore.com prints prices — never "7.64e-12" (RAZA 2026-09-15).
    if (v > 0 && v < 0.000001) return v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3));
    if (v < 1) return v.toPrecision(dp || 5);
    return v.toLocaleString('en-US', { maximumFractionDigits: dp || 4 });
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e18) return (v / 1e18).toFixed(2) + 'Qi';
    if (v >= 1e15) return (v / 1e15).toFixed(2) + 'Qa';
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    // A TRADE OF 0.00132 ATOM IS NOT "0" (seen on the exchanges rows 2026-09-16: "0 ATOM · 1 XRP"). Two decimal places
    // rounded every small holding to zero, so the AMOUNT column denied that the trade had a size at all.
    if (v > 0 && v < 0.01) return v < 1e-8 ? subZero(v) : String(Number(v.toPrecision(4)));
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // ---- the token in the URL --------------------------------------------------------------------
  // /trade/xrpl/<CODE>-<ISSUER>. The code may itself contain a dash, so split on the LAST one --
  // the issuer is a fixed-shape r-address and the code is whatever is left.
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var raw = decodeURIComponent(parts[parts.length - 1] || '');
    var cut = raw.lastIndexOf('-');
    if (cut < 1) return null;
    var code = raw.slice(0, cut), issuer = raw.slice(cut + 1);
    if (!window.lxx.isAddress(issuer)) return null;
    return { code: code, issuer: issuer };
  }

  // The ledger wants the 40-char hex form for anything longer than 3 characters.
  function currencyOf(code) {
    try { return window.lxx.encodeCurrency(code); } catch (e) { return code; }
  }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  // ---- order book -------------------------------------------------------------------------------
  // Direction verified against live data rather than reasoned about: for RLUSD the asks came back
  // at 0.706881 / 0.707012 and the bids at 0.706225 / 0.706175, bracketing the 0.7066 market price.
  // Backwards, bids would sit above asks -- which is exactly what a plausible-looking book of
  // nonsense would show, so it is worth checking rather than assuming.
  //
  //   ASK = an offer GIVING the token and WANTING XRP  (someone selling it)
  //   BID = an offer GIVING XRP and WANTING the token  (someone buying it)
  function book(asset) {
    var tok = { currency: currencyOf(asset.code), issuer: asset.issuer };
    var xrpSide = { currency: 'XRP' };
    return Promise.all([
      rpc('book_offers', { taker_gets: tok, taker_pays: xrpSide, limit: 60 }),
      rpc('book_offers', { taker_gets: xrpSide, taker_pays: tok, limit: 60 })
    ]).then(function (r) {
      return { asks: rows(r[0].offers, 'ask'), bids: rows(r[1].offers, 'bid') };
    });
  }

  function drops(v) { return Number(v) / 1e6; }

  function rows(offers, side) {
    var out = [];
    for (var i = 0; i < (offers || []).length; i++) {
      var o = offers[i], px = null, amt = null;
      try {
        if (side === 'ask') {
          amt = Number(o.TakerGets.value);           // tokens on offer
          px = drops(o.TakerPays) / amt;             // XRP wanted per token
        } else {
          amt = Number(o.TakerPays.value);           // tokens wanted
          px = drops(o.TakerGets) / amt;             // XRP offered per token
        }
      } catch (e) { continue; }
      if (!isFinite(px) || !isFinite(amt) || amt <= 0) continue;
      out.push({ px: px, amt: amt });
    }
    // The ledger returns each book already ordered by price quality, but the two books are quoted
    // in opposite directions, so sort explicitly rather than trust the arrival order.
    out.sort(function (a, b) { return side === 'ask' ? a.px - b.px : b.px - a.px; });
    var run = 0;
    for (var j = 0; j < out.length; j++) { run += out[j].amt; out[j].sum = run; }
    return out.slice(0, 16);
  }

  // The design gates the book behind a class its old script set once it had data:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row { visibility: hidden }
  // The style block (lx-dxa-css) is a separate element and survives stripping the script, so without
  // this the rows are laid out with correct prices and never appear. Fourth gate of this exact shape
  // in this project; assume every replaced section has one until checked.
  // There are TWO on this page, not one -- the stat row is gated separately from the book:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row            { visibility: hidden }
  //     .stat-row:not(.lxda) .val, ... .sub          { visibility: hidden }
  // The second was found only because a screenshot disagreed with the DOM: every stat cell read back
  // with the right text and computed visibility:hidden. Reading values out of the DOM would have
  // called this page finished while it showed six blank cards.
  // THE POOLS AND HOLDERS TABS SHOWED THE DESIGN'S MOCK FIRST (RAZA 2026-09-15: "There's a flash bug on Trade-Asset → Pools
  // tab. It shows this for split second" — USDC / APT, APR, "Add liquidity"). The design writes its sample table whenever a
  // tab opens; it stays hidden until this token's rows are in it, the same gate shape as the rest of this page.
  (function () {
    if (document.getElementById('lxx-dxa-tabgate')) return;
    var st = document.createElement('style');
    st.id = 'lxx-dxa-tabgate';
    st.textContent = '.dxa-tab-extra.dxa-pools:not(.lxda) .dxa-pl-head,.dxa-tab-extra.dxa-pools:not(.lxda) table,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) table,.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-stat .val,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-pgn{visibility:hidden}'
      // The snapshot camera is removed from the chart controls (RAZA 2026-09-16: "Remove the camera icon for screenshot").
      + '.lxda-snap{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  function liftIdentity() {
    ['.stat-row', '.dxa-stat-row', '.mdxa-stat-row', '.asset-header', '.asset-top'].forEach(function (s) {
      $$(s).forEach(function (n) { n.classList.add('lxda'); });
    });
  }

  function lift() {
    // `.asset-header` / `.asset-top` ARE THE REASON THE PAGE LOOKED EMPTY, and they were missing from
    // this list. They gate the token's own NAME:
    //     .asset-header:not(.lxda) .asset-name, .asset-top:not(.lxda) .asset-name { visibility:hidden }
    // paintHeader() writes `h1.asset-name` correctly on every load, and it has been invisible the
    // whole time — a page about ARMY that never said ARMY, with a blank where the heading belongs.
    // Found only by screenshotting; the DOM read back "ARMY" at opacity 1 with no console error, and
    // I called this page working three times on that evidence.
    //
    // NOT added here, deliberately: `#dxaChart`, `#dxaExTable`, `#mdxaExList` and `.dxa-hl-stat`.
    // Those gates hide the DESIGN'S MOCK — this layer does not paint any of them (there is no OHLC
    // source for the chart) — so lifting them would replace a blank with a fabricated price history
    // and invented trades. A blank is the honest state until they have real data.
    // THE HEADER AND STATS ARE LIFTED ONLY ONCE THEY HOLD THIS TOKEN (RAZA 2026-09-15: "Whenever i open any trade-asset
    // page, it shows this for split seconds then it fixes"). Lifting them here, before the token feed answered, put the
    // design's "USDC · 0x0409…f072 · circle.com · 4.2271 APT" on screen until paintHeader overwrote it. See liftIdentity().
    var sels = ['#dxaObAsks', '#dxaObBids', '#mdxaObAsks', '#mdxaObBids'];
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('lxda');
    }

    // THE SECOND GATE FAMILY, which nothing in this file ever satisfied. A separate stylesheet hides
    // individual VALUES until they carry `.lxp`:
    //     .ohlc-strip .pair .v:not(.lxp), .dxa-perf-grid .dxa-perf-cell .ch:not(.lxp),
    //     … { visibility:hidden !important }
    // It is `!important`, so the class is the only way past it — and this layer had never added it,
    // which is why the H/L strip and the performance row rendered as empty space even after being
    // filled with real figures.
    //
    // Only the ones this layer actually writes are released. `.dxa-hl-stat .val`,
    // `.tabs-bar .tab .count` and the trade-summary rows are left gated for the same reason as the
    // chart: nothing here fills them yet.
    var vals = ['.ohlc-strip .pair .v', '.dxa-perf-grid .dxa-perf-cell .ch',
      '.mdxa-perf-grid .mdxa-perf-cell .ch'];
    for (var k = 0; k < vals.length; k++) {
      var vn = document.querySelectorAll(vals[k]);
      for (var m = 0; m < vn.length; m++) vn[m].classList.add('lxp');
    }

    safetyNet();
  }

  // THE WHOLE PAGE IS REVEALED BY A TRANSITION, AND A TRANSITION CAN FAIL TO RUN.
  //
  // Measured on the served page: `.dxa-grid` — which contains the name, the issuer card, the chart
  // and the trade panel, i.e. everything — sits at computed opacity 0 with two CSSTransitions
  // (opacity and transform, 550ms) reported as `running` at currentTime 0. The tabs bar and the
  // Recent Exchanges panel are the same, via `[data-lcmu]{opacity:0}` lifted by `.lcmu-in`.
  //
  // So the page's VISIBILITY depends on an animation completing. That is fail-closed: when the
  // transition does not run, the markup is perfect, the data is correct, there is no console error,
  // and the reader sees nothing. This project has shipped that exact outage before —
  // prefers-reduced-motion masking a deleted card-reveal driver, 2026-08-14 — and the rule written
  // down afterwards was that a mechanism whose failure mode is "the feature never happens" must not
  // be load-bearing.
  //
  // ONLY A NET, NOT AN OVERRIDE. It runs once, late, and forces opacity only on elements STILL at
  // zero — so where the animation works it has already finished and this changes nothing, and the
  // design's fade is preserved. Content beats choreography when the two disagree.
  //
  // Deliberately a timer and not requestAnimationFrame: rAF is exactly the kind of frame-driven
  // mechanism that is not firing when this situation arises.
  function safetyNet() {
    if (window.__lxxDxaNet) return;
    window.__lxxDxaNet = 1;
    setTimeout(function () {
      var main = document.querySelector('main') || document.body;
      var nodes = main.querySelectorAll('.dxa-grid, [data-lcmu], .dxa-trade-card, .tabs-bar, .panel');
      for (var i = 0; i < nodes.length; i++) {
        try {
          var n = nodes[i];
          if (getComputedStyle(n).opacity !== '0') continue;          // the reveal did its job

          // SETTING opacity IS NOT ENOUGH, and the first version of this net proved it: the trade
          // card lifted and the grid did not. A CSS transition sits ABOVE !important in the cascade,
          // so a transition frozen at its from-value keeps winning however the inline style is
          // written. (Recorded in this project before as "a stuck transition outranking
          // !important".) The transition has to be ENDED, not out-shouted.
          n.style.setProperty('transition', 'none', 'important');
          if (n.getAnimations) {
            var as = n.getAnimations();
            for (var k = 0; k < as.length; k++) { try { as[k].finish(); } catch (_) {} }
          }
          n.style.setProperty('opacity', '1', 'important');
          n.style.setProperty('transform', 'none', 'important');
        } catch (e) {}
      }
    }, 1500);
  }

  function paintBook(node, list, side) {
    if (!node) return;
    node.innerHTML = '';
    if (!list.length) {
      var none = el('div', 'dxa-ob-row', 'No ' + (side === 'ask' ? 'asks' : 'bids') + ' on this book.');
      none.style.cssText = 'opacity:.6;justify-content:center';
      node.appendChild(none);
      return;
    }
    var max = list[list.length - 1].sum || 1;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var row = el('div', 'dxa-ob-row mdxa-ob-row ' + side);
      row.appendChild(el('span', 'px', xrp(r.px, 6)));
      row.appendChild(el('span', 'am', amount(r.amt)));
      row.appendChild(el('span', 'sm', amount(r.sum)));
      var bar = el('span', 'bar');
      // Depth bar, scaled to the deepest level shown so the shape means something.
      bar.style.width = Math.max(1, Math.round((r.sum / max) * 100)) + '%';
      row.appendChild(bar);
      node.appendChild(row);
    }
  }

  // ---- stats ------------------------------------------------------------------------------------
  // These six cells ship with MOCK values baked into the markup -- "4.2271 XRP / $0.916142",
  // "+2.66%", "4.14M XRP / $980,137" -- and they are not written by any data layer, so they survived
  // stripping the Stellar one. Whatever token you opened, the page quoted those numbers as if they
  // were its own. Invented figures on a price page are worse than blank ones, so anything without
  // real data behind it is set to an em dash rather than left as the mock.
  function money(v) {
    if (v == null || !isFinite(v)) return null;
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + Math.round(v).toLocaleString('en-US');
    if (v < 1e9) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + (v / 1e9).toFixed(2) + 'B';
  }

  // THE PHONE LABELS THESE CELLS DIFFERENTLY, and an exact match silently skipped one.
  //
  // Desktop reads "24h volume"; the phone reads just "Volume". The comparison was `=== name`, so on
  // mobile that cell was never found, never painted, and kept the design's mock — displaying
  // "4.14M APT" beside three cells that HAD been painted, which is the most convincing way for a
  // wrong number to appear: surrounded by right ones.
  //
  // Matched either way round now, so a shorter phone label finds a longer desktop key. Scoped to
  // .stat-cell, where the label set is small and unambiguous.
  function cellByLabel(name) {
    var cells = document.querySelectorAll('.stat-cell');
    var want = String(name).toLowerCase();
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.lbl');
      if (!l) continue;
      var got = l.textContent.trim().toLowerCase();
      if (got === want || got.indexOf(want) >= 0 || want.indexOf(got) >= 0) return cells[i];
    }
    return null;
  }

  function setCell(name, main, unit, sub, dir) {
    var c = cellByLabel(name);
    if (!c) return;
    var v = c.querySelector('.val'), s = c.querySelector('.sub');
    if (v) {
      v.textContent = main == null ? '—' : main;
      if (main != null && unit) {
        var u = el('span', 'u', unit);
        v.appendChild(u);
      }
      if (dir) v.className = 'val change ' + dir + ' mono';
    }
    if (s) s.textContent = sub == null ? '' : sub;
  }

  // THE PRICE-CHANGE ROW WAS THE DESIGN'S FICTION, ON A PAGE ABOUT ONE REAL TOKEN.
  //
  // Six cells — 1h, 24h, 7d, 1m, 3m, 6m — and every one of them shipped as static markup: "+0.42%",
  // "+2.66%", "-1.18%", "+12.34%", "+28.91%", "+47.62%". Nothing ever painted them, so ARMY showed
  // "24h +2.66%" while the header directly above it showed the real 24h move, which was NEGATIVE.
  // Two contradictory answers about the same token, on the same screen, and the invented one was in
  // the bigger type.
  //
  // Three of the six are real and were already in the payload this page fetches: /lxapi/xrpltoken
  // maps the upstream's pro1h / pro24h / pro7d to p1h / p24 / p7. They were simply never read.
  //
  // THE OTHER THREE DO NOT EXIST. The upstream carries no 1-month, 3-month or 6-month change — the
  // full field list was checked, not assumed — so they become em dashes rather than being computed
  // from a series this page does not have. A missing figure reads as missing; an invented one reads
  // as a 47% gain.
  //
  // Matched on each cell's own label rather than by index, so a change to the row's order cannot
  // silently put the 7-day number under the 1-hour heading.
  // THE LOGO HEALER EATS THIS ROW, which is why the labels have to be rebuilt rather than read.
  //
  // Measured on the live page: after the first paint, cells 4-6 were `innerHTML: ""` — not em-dashed,
  // EMPTY. That engine repaints any element holding one to five characters as a ticker logo and
  // clears its text, and "1m", "3m", "6m" are two characters each. The first three cells survive only
  // because this function repaints them afterwards; anything it skips stays wiped.
  //
  // So the labels come from this list, not from the DOM, and every cell is stamped `data-logoed="1"`
  // — the healer's own skip marker, and the documented escape.
  var PERF = ['1h', '24h', '7d', '1m', '3m', '6m'];

  // Same contract as wallet.js's plain(): undo whatever the logo engine did to this node, claim it
  // with the engine's OWN skip marker, then write the text. `null` leaves the text alone, for a
  // container that only needs releasing.
  function plain(node, text) {
    try {
      node.removeAttribute('data-logo');
      node.style.background = '';
      node.style.backgroundImage = '';
      node.style.boxShadow = '';
      node.setAttribute('data-logoed', '1');
    } catch (e) {}
    if (text != null) node.textContent = text;
  }

  // The upstream publishes 1h / 24h / 7d and nothing longer, so 1m, 3m and 6m read as em dashes on
  // arrival. They are filled in by loadLongPerf() from the token's own daily close series — a real
  // price history from the same source, not a series this page lacks. Kept here so a later
  // paintPerf() (the Buy/Sell toggle re-runs it) does not blank what has already been computed.
  var LONG = {}, LASTD = null;

  function paintPerf(d) {
    // `[class*="dxa-perf-cell"]` MATCHES BOTH LAYOUTS, and selecting only `.dxa-perf-cell` is why
    // the phone shipped fabricated performance figures for weeks. The mobile page has ZERO
    // `.dxa-perf-cell` and six `.mdxa-perf-cell` — the phone's class is the desktop's with a letter
    // in front — so this function found nothing there and returned, leaving the design's mock in
    // place: "1h +0.42%  24h +2.66%" against an API saying +0.003% and -0.347%. And lift() had
    // already released the `.lxp` gate on those cells, so the invented numbers were fully visible
    // and looked authoritative. Exactly the trap in [[lumoscore-hidden-mock-sweep]]: a layer that
    // names the desktop container does nothing on the phone.
    var cells = $$('[class*="dxa-perf-cell"]');
    if (!cells.length) return;
    if (d) LASTD = d;
    var have = {
      '1h': d ? d.p1h : null, '24h': d ? d.p24 : null, '7d': d ? d.p7 : null,
      '1m': LONG['1m'], '3m': LONG['3m'], '6m': LONG['6m'],
    };

    cells.forEach(function (c, i) {
      var label = PERF[i] || (((c.querySelector('.tf') || {}).textContent) || '').trim();
      var v = Object.prototype.hasOwnProperty.call(have, label) ? have[label] : null;
      var ok = (v != null && isFinite(v));

      // Rebuilt, because the healer may have emptied the cell entirely.
      var tf = c.querySelector('.tf') || c.appendChild(el('div', 'tf'));
      var ch = c.querySelector('.ch') || c.appendChild(el('div', 'ch'));

      // STAMPING data-logoed IS NOT ENOUGH ON ITS OWN. The first attempt set only that marker and
      // the cell came back carrying `data-logo="CELL"` and a base64 token-logo background, with its
      // children gone — the engine had already claimed it, and the leftover attribute and background
      // kept the logo painted over the row. The marker has to be set AND the engine's existing state
      // undone, which is exactly what wallet.js's plain() does and why it does all three things.
      plain(c, null);
      plain(tf, label);
      plain(ch, ok ? ((v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%') : '—');

      // AND THIS IS THE LINE THAT ACTUALLY SAVES THE CELL. There are two logo engines on this page
      // and they use different contracts: the second honours `data-logoed`, the FIRST does not look
      // at it at all. Its test is "no img/svg/[data-logo] descendant AND text of 1-5 characters",
      // so a cell reading "1h-0.06%" (8 chars) is safe while one reading "1m—" (3) is treated as a
      // ticker — which is why only the three em-dashed cells were being eaten. The symbol it settled
      // on was CELL, taken from this element's own class name, `dxa-perf-cell`.
      //
      // An empty `data-logo` on a CHILD is that engine's own escape: the parent then fails its
      // `querySelector('img,svg,[data-logo]')` check and is skipped, and the empty value matches no
      // logo so nothing is drawn. Same trick the snapshot button already uses a few lines below.
      try { tf.setAttribute('data-logo', ''); } catch (e) {}

      try { ch.classList.add('lxp'); } catch (e) {}
      c.classList.remove('up', 'down');
      if (ok) c.classList.add(v >= 0 ? 'up' : 'down');
    });
  }

  // 1m / 3m / 6m, computed from ONE year of daily closes rather than three separate calls — the
  // upstream budget is 333 requests a DAY, and a 1Y daily series already contains every window.
  //
  // A young token is the case that matters: if the series does not reach back far enough, the figure
  // stays an em dash instead of quietly measuring from the token's first ever candle and calling
  // that "6 months". The tolerance is three days, because daily candles do not land on exact
  // boundaries and an illiquid token can miss days entirely.
  function changeOver(pts, days) {
    if (!pts || pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var cut = last[0] - days * 86400000;
    if (pts[0][0] > cut + 3 * 86400000) return null;       // history is shorter than the window
    var base = null;
    for (var i = pts.length - 1; i >= 0; i--) { if (pts[i][0] <= cut) { base = pts[i]; break; } }
    if (!base || !(base[1] > 0)) return null;
    return (last[1] - base[1]) / base[1] * 100;
  }

  function loadLongPerf(asset) {
    if (!$$('[class*="dxa-perf-cell"]').length) return;   // both layouts — see paintPerf
    fetch('/lxapi/xrplohlc?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&r=1Y&vs=XRP')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pts || d.pts.length < 2) return;
        LONG['1m'] = changeOver(d.pts, 30);
        LONG['3m'] = changeOver(d.pts, 90);
        LONG['6m'] = changeOver(d.pts, 180);
        paintPerf(LASTD);
      })
      .catch(function () {});
  }

  // WHY THE FIGURES ARE MISSING, said once, instead of six dashes and an empty chart.
  //
  // RAZA on 2026-09-29: "Why's BCHAMP token not showing details". Because /lxapi/xrpltoken answers
  // {"ok":false,"error":"upstream 404"} for it — xrpl.to has no record of that token, which is what
  // happens to an asset with no market on the DEX. The page was right to show nothing, and wrong to
  // show nothing WITHOUT SAYING SO: four dashes, a blank chart and a dead swap panel are what a
  // broken page looks like, so a reader cannot tell a thin token from an outage.
  //
  // The description and issuer above still render, because those come from XRPLMeta rather than
  // xrpl.to — which is exactly why the page looked half-loaded rather than empty.
  // TWO DIFFERENT SILENCES, and they must not be told apart by guesswork.
  //
  // A token the feed has never heard of (upstream 404) has no market — that is a fact about the
  // token, and it is permanent until someone makes a market. A feed that refused THIS request is an
  // outage, and the same token will price fine on a reload. Both render as six dashes, which is why
  // RAZA asked "Why's BCHAMP token not showing details" — and BCHAMP turned out to have a perfectly
  // good market (0.00601582 XRP, $20,430 of 24h volume) that had simply failed to load that once.
  //
  // So the note says which one happened. Telling someone their token has no market when the feed
  // merely rate-limited us would be a confident falsehood about their asset, and xrpl.to's cap is
  // 333 requests a day per IP -- being refused is ordinary.
  function noMarketNote(kind) {
    var host = document.querySelector('.dxa-stats') || document.querySelector('[class*="dxa-stat"]');
    host = host && host.parentElement;
    var note = document.querySelector('.lx-nomarket');
    if (!kind) { if (note && note.parentNode) note.parentNode.removeChild(note); return; }
    if (!host) return;
    if (!note) {
      note = document.createElement('div');
      note.className = 'lx-nomarket';
      note.setAttribute('data-logoed', '1');
      note.style.cssText = 'margin:12px 0 0;padding:11px 14px;border-radius:12px;'
        + 'border:1px solid var(--border);background:var(--surface-2);'
        + 'font:400 12.5px/1.5 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
      host.appendChild(note);
    }
    note.textContent = kind === 'none'
      ? 'No market data for this token. It exists on the ledger, but no price feed tracks it — which '
        + 'usually means it has no order book or pool with meaningful depth. Its description and '
        + 'issuer above are read straight from the ledger.'
      : 'Market data could not be loaded just now — the price feed did not answer. The token and its '
        + 'issuer above are read from the ledger and are unaffected. Reloading usually fixes it.';
  }

  function paintStats(d) {
    if (!d) {
      ['price', '24h change', '24h volume', 'market cap', 'liquidity', 'supply']
        .forEach(function (n) { setCell(n, null, '', ''); });
      noMarketNote(window.__lxxAssetMiss === 'none' ? 'none' : 'down');
      return;
    }
    noMarketNote(null);
    var usd = (d.price && d.usd) ? (d.usd / d.price) : null;   // USD per XRP, from this token's pair

    setCell('price', d.price == null ? null : xrp(d.price, 6) + ' ', 'XRP',
      d.usd == null ? '' : money(d.usd));

    if (d.p24 == null) setCell('24h change', null, '', '');
    else setCell('24h change', (d.p24 >= 0 ? '+' : '') + d.p24.toFixed(2) + '%', '',
      d.price == null ? '' : ((d.p24 >= 0 ? '+' : '') + xrp(d.price * d.p24 / 100, 6) + ' XRP'),
      d.p24 >= 0 ? 'up' : 'down');

    setCell('24h volume', d.vol24 == null ? null : amount(d.vol24) + ' ', 'XRP',
      (d.vol24 != null && usd) ? money(d.vol24 * usd) : '');

    setCell('market cap', d.marketcap == null ? null : amount(d.marketcap) + ' ', 'XRP',
      (d.marketcap != null && usd) ? money(d.marketcap * usd) : '');

    setCell('liquidity', d.tvl == null ? null : amount(d.tvl) + ' ', 'XRP',
      (d.tvl != null && usd) ? money(d.tvl * usd) : '');

    // Issued and circulating differ for real tokens, so say which this is.
    setCell('supply', d.circulating == null ? null : amount(d.circulating) + ' ', d.name || '',
      d.holders == null ? '' : Math.round(d.holders).toLocaleString('en-US') + ' holders');
  }

  // ---- the price chart ----------------------------------------------------------------------------
  //
  // THE BIGGEST THING ON THE PAGE WAS AN EMPTY BOX, and that is what "the page doesn't load" looked
  // like. The design's own chart was gated shut by `#dxaChart:not(.lxda) svg{visibility:hidden}` —
  // correctly, because its contents are mock: gridlines labelled 4.61 / 4.56, which are Aptos prices.
  // Nothing here ever replaced them, so the gate stayed shut and the reader got 395px of nothing
  // above a real order book.
  //
  // The data existed the whole time. /lxapi/xrplohlc serves per-token history — the $LUMOS page's
  // chart is built on it — and it takes `iss` + `cur` and derives the upstream's token id at the
  // edge. For ARMY it returns 168 real points. It was simply never called from this page.
  //
  // Drawn into the design's own SVG at its own viewBox, with the same gridline/label structure it
  // ships, so nothing new is introduced: only the numbers become real.
  var CH_RANGE = { '1D': '24H', '1W': '7D', '1M': '30D', '1Y': '1Y', 'ALL': 'ALL' };
  var chGen = 0;
  // What the chart plots and in which unit: Stellar's Price/MCap and $/XLM controls, with XRP. Opens on
  // 1D, which is the range lumoscore.com has selected on arrival.
  var CH_VIEW = { metric: 'price', vs: 'XRP', supply: 0, label: '1D', type: 'area' };
  // THE LINE / CANDLE TOGGLE (RAZA 2026-09-15: "when i switch to candlestick, the charts just disappears"). The design's own
  // handler redrew its mock into the box; the click is taken first and this token's candles are drawn instead.
  if (!window.__lxxChartType) {
    window.__lxxChartType = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button[data-type="area"], button[data-type="candle"]');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(b.parentNode.querySelectorAll('button[data-type]'), function (x) { x.classList.toggle('active', x === b); });
      CH_VIEW.type = b.getAttribute('data-type') === 'candle' ? 'candle' : 'area';
      if (typeof lastRawPts !== 'undefined' && lastRawPts) drawChart(lastRawPts);
    }, true);
  }

  // THE CHART TAKES UP THE SLACK (RAZA 2026-09-15: "there's again a lot of empty space below the price change boxes").
  // The page's left card is stretched to the height of the trade panel beside it; when a token's header is short —
  // no description, as USDC's — the card ran ~140px past its last row. Measured at 1920px: card bottom 1126, the %
  // boxes' card 988. The chart grows by exactly the slack instead, and is REDRAWN in the taller box rather than
  // stretched (its SVG has preserveAspectRatio="none", so stretching would squash its labels). 28px is the card's
  // own bottom padding, measured where nothing is stretched.
  var NATURAL_H = 395, lastRawPts = null, fitWired = false, fitTimer = null;
  function chartH(svg) {
    var h = svg && parseFloat(svg.style.height);
    return h > NATURAL_H ? Math.round(380 * h / NATURAL_H) : 380;
  }
  function fitChartHeight() {
    // RETIRED (RAZA 2026-09-15: "This section is bigger than on Stellar. Due to which theres also blank space below promoted
    // box. Make it identical to Stellar chart size"). The chart keeps lumoscore.com's fixed height; any height an earlier
    // version set is taken back off. The code below stays unreachable rather than deleted, as the record of the attempt.
    var c0 = chartSvg();
    if (c0 && c0.host && c0.host.style.height) {
      c0.host.style.height = '';
      c0.svg.style.height = '';
      if (lastRawPts) drawChart(lastRawPts);
    }
    return;
    var c = chartSvg(), ah = $('.asset-header'), perf = $('.dxa-perf-card');
    if (!c || !c.svg || !ah || !perf || c.host.id !== 'dxaChart') return;
    if (!fitWired) {
      fitWired = true;
      var again = function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitChartHeight, 120); };
      window.addEventListener('resize', again);
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(again);
        [$('.dxa-trade-col'), $('.asset-header-top')].forEach(function (n) { if (n) ro.observe(n); });
      }
    }
    var grid = ah.parentElement;
    var twoCols = grid && getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    // THE BOX, NOT ONLY THE DRAWING. #dxaChart carries a fixed 395px height of its own, so growing the SVG alone
    // changed nothing in the layout — the slack stayed, and every resize grew the SVG again. Both move together
    // now, and the growth is capped so no measurement can run it away.
    var cur = parseFloat(c.host.style.height) || NATURAL_H;
    var want = NATURAL_H;
    if (twoCols) {
      var slack = ah.getBoundingClientRect().bottom - perf.getBoundingClientRect().bottom - 28;
      want = Math.min(NATURAL_H + 320, Math.max(NATURAL_H, Math.round(cur + slack)));
    }
    if (Math.abs(want - cur) < 4) return;
    var hv = want > NATURAL_H ? (want + 'px') : '';
    c.host.style.height = hv;
    c.svg.style.height = hv;
    if (lastRawPts) drawChart(lastRawPts);
  }

  function chartSvg() {
    var host = document.getElementById('dxaChart') || document.getElementById('mdxaChart');
    return host ? { host: host, svg: host.querySelector('svg') } : null;
  }

  function drawChart(pts) {
    var c = chartSvg();
    if (!c || !c.svg || !pts || pts.length < 2) return;
    lastRawPts = pts;

    // The price band stops above a volume band, as on lumoscore.com (RAZA 2026-09-15: "volume bars missing").
    var W = 900, H = chartH(c.svg), L = 18, R = 836, T = 16, VB = H - 30, VH = 64, B = VB - VH - 12;
    // MCap is the same series times circulating supply — the definition Stellar's tooltip states.
    var K = (CH_VIEW.metric === 'mcap' && CH_VIEW.supply > 0) ? CH_VIEW.supply : 1;
    if (K !== 1) pts = pts.map(function (p) { return [p[0], p[1] * K, p[2] * K, p[3] * K, p[4] * K, p[5]]; });
    var axisTxt = function (v) { return (CH_VIEW.vs === 'USD' ? '$' : '') + (K !== 1 ? amount(v) : xrp(v, 5)); };
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    if (CH_VIEW.type === 'candle') {
      pts.forEach(function (p) {
        if (isFinite(p[2]) && p[2] > 0 && p[2] > hi) hi = p[2];
        if (isFinite(p[3]) && p[3] > 0 && p[3] < lo) lo = p[3];
      });
    }
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0], tspan = (t1 - t0) || 1;
    var y = function (v) { return span > 0 ? B - ((v - lo) / span) * (B - T) : (T + B) / 2; };

    // THE BRAND ACCENT, NOT GREEN-OR-RED. This line was coloured by direction — green if the range
    // closed higher, red if lower — and lumoscore.com never does that: its chart is always
    // `var(--accent,#ea6a2c)` with the same accent fading out underneath (0.20 to 0), read off the live
    // Stellar page. RAZA 2026-09-15: "WTF does the chart have red line. We dont have that on Stellar."
    // The direction is still on the page, in the 24h change beside the price.
    var s = '<defs><linearGradient id="dxaAreaGrad" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="var(--accent,#ea6a2c)" stop-opacity="0.20"></stop>'
      + '<stop offset="100%" stop-color="var(--accent,#ea6a2c)" stop-opacity="0"></stop></linearGradient></defs>';

    // Five gridlines, labelled with REAL prices off this series rather than the design's constants.
    for (var g = 0; g < 5; g++) {
      var gv = hi - (span * g / 4), gy = y(gv);
      s += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + R + '" y2="' + gy.toFixed(1)
        + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,5" class="lxda-candle"></line>'
        + '<text x="842" y="' + (gy + 3).toFixed(1) + '" font-size="10" fill="var(--text-soft)"'
        + ' font-family="JetBrains Mono, monospace">' + axisTxt(gv) + '</text>';
    }

    // Volume, square-root scaled like Stellar's band so an ordinary session still shows beside the outlier,
    // green when that close is at or above the one before it. xrplohlc's volume is in TOKEN units whatever
    // the price unit (measured: identical sums for vs=XRP and vs=USD), so only its shape is drawn here.
    var vmax = 0;
    for (var vi = 0; vi < pts.length; vi++) { var vv0 = +pts[vi][5] || 0; if (vv0 > vmax) vmax = vv0; }
    if (vmax > 0) {
      var bw = Math.max(1, Math.min(14, (R - L) / pts.length * 0.62)), vroot = Math.sqrt(vmax);
      for (var bi = 0; bi < pts.length; bi++) {
        var bv = +pts[bi][5] || 0;
        if (!(bv > 0)) continue;
        var bx = L + ((pts[bi][0] - t0) / tspan) * (R - L);
        var bh = Math.max(3, (Math.sqrt(bv) / vroot) * VH);
        var upv = bi === 0 || pts[bi][1] >= pts[bi - 1][1];
        s += '<rect class="lxda-vol" x="' + (bx - bw / 2).toFixed(1) + '" y="' + (VB - bh).toFixed(1)
          + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (upv ? '#22c55e' : '#ff5b5b')
          + '" fill-opacity="0.5"></rect>';
      }
    }

    var line = '';
    for (var j = 0; j < pts.length; j++) {
      var px = L + ((pts[j][0] - t0) / tspan) * (R - L);
      line += (j ? ' L' : 'M') + px.toFixed(1) + ' ' + y(pts[j][1]).toFixed(1);
    }
    // The accent goes in a style declaration as well as the attribute: chart.js records that a var()
    // inside an SVG presentation attribute can leave a path uncoloured, so the attribute carries the
    // literal fallback and the style carries the theme token.
    if (CH_VIEW.type === 'candle') {
      // xrplohlc candles are [t, close, high, low, open, volume]; a candle missing its open opens at the close before it.
      var cdw = Math.max(1.5, Math.min(12, (R - L) / pts.length * 0.62));
      for (var cdi = 0; cdi < pts.length; cdi++) {
        var cdp = pts[cdi], cdx = L + ((cdp[0] - t0) / tspan) * (R - L);
        var cdc = cdp[1];
        var cdo = (isFinite(cdp[4]) && cdp[4] > 0) ? cdp[4] : (cdi ? pts[cdi - 1][1] : cdc);
        var cdh = (isFinite(cdp[2]) && cdp[2] > 0) ? cdp[2] : Math.max(cdo, cdc);
        var cdl = (isFinite(cdp[3]) && cdp[3] > 0) ? cdp[3] : Math.min(cdo, cdc);
        var cdcol = cdc >= cdo ? '#22c55e' : '#ff5b5b';
        var cdyt = y(Math.max(cdo, cdc)), cdyb = y(Math.min(cdo, cdc));
        s += '<line class="lxda-candle lxda-cwick" x1="' + cdx.toFixed(1) + '" x2="' + cdx.toFixed(1) + '" y1="' + y(cdh).toFixed(1) + '" y2="' + y(cdl).toFixed(1)
          + '" stroke="' + cdcol + '" stroke-width="1"></line>'
          + '<rect class="lxda-candle lxda-cbody" x="' + (cdx - cdw / 2).toFixed(1) + '" y="' + cdyt.toFixed(1) + '" width="' + cdw.toFixed(1)
          + '" height="' + Math.max(1, cdyb - cdyt).toFixed(1) + '" fill="' + cdcol + '"></rect>';
      }
    } else {
      s += '<path d="' + line + ' L' + R + ' ' + B + ' L' + L + ' ' + B + ' Z" fill="url(#dxaAreaGrad)" class="lxda-area"></path>'
        + '<path d="' + line + '" fill="none" stroke="#ea6a2c" style="stroke:var(--accent,#ea6a2c)" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round" class="lxda-line"></path>';
    }

    c.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    c.svg.innerHTML = s;
    // Only now is the gate lifted: the box stays hidden while it holds the design's Aptos prices,
    // and opens the moment it holds this token's own.
    c.host.classList.add('lxda');
    wireChartHover(c.host, { pts: pts, L: L, R: R, t0: t0, tspan: tspan, y: y, K: K });

    // THE SNAPSHOT CAMERA IS STELLAR'S OWN LAYER (lx-snap), inherited intact. It reads the plotted series
    // off the chart element in USD per unit, plus four page globals, and places its button beside the
    // $/XRP tray by itself — so publishing these is all it needs.
    try {
      var d0 = window.__lxxAssetData, a0 = window.__lxxAssetRef;
      var usdPerXrp = (d0 && d0.price && d0.usd) ? d0.usd / d0.price : 0;
      // THIS PAGE LEARNS THE XRP/USD RATE FOR FREE, from the asset payload it already has, so it
      // feeds the shared cache rather than keeping it. Every other page gates its USD figures on one
      // metered call to xrpl.to (333/day/IP), and a visit here warms that cache for all of them.
      if (usdPerXrp > 0 && window.lxx && window.lxx.usdSave) window.lxx.usdSave(usdPerXrp);
      c.host.__lxpts = pts.map(function (p) {
        return { t: p[0], v: CH_VIEW.vs === 'USD' ? p[1] : p[1] * usdPerXrp, vol: isFinite(p[5]) ? p[5] : 0 };
      });
      window.__lxDXAxlmUsd = usdPerXrp;
      window.__lxAsDenom = CH_VIEW.vs === 'USD' ? 'usd' : 'xlm';
      if (a0) { window.__lxDXAcode = a0.code; window.__lxDXAissuer = a0.issuer; }
    } catch (e) {}
  }

  // THE HOVER READOUT (RAZA 2026-09-15: "where's the chart hover that we also have on Stellar"). Stellar's own
  // elements — .lxda-chtip / .lxda-chdot / .lxda-chvl, styled by the inherited sheet — with the date, the
  // price in the chart's unit and dollars beneath it, and that bucket's volume in dollars.
  function tipDate(ms) {
    try {
      var o = (CH_VIEW.label === '1D' || CH_VIEW.label === '1W')
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(ms).toLocaleString('en-US', o);
    } catch (e) { return ''; }
  }
  function usdCompact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function tipEl(cls, text) {
    var e = el('div', cls, text);
    e.setAttribute('data-logoed', '1');                         // "Price" is five letters: keep the logo healer off
    return e;
  }
  // TRADES PER CANDLE (RAZA 2026-09-15: "Number of trades is missing in chart hover"). xrpl.to's candles carry
  // no count, so the hovered candle's is asked for when it is hovered: /lxapi/xrpltrades reads the trade history's
  // own total for that window and caches it. Debounced, so sweeping across the chart asks once, for where it stops.
  var TRADES = {}, tradeTimer = null, tradeWaiting = {}, prefetchGen = 0;
  // Every candle's count for the range just drawn, forty windows per request, in order. Ranges longer than a week of
  // hourly candles are left to the hover, to keep the upstream cost of one page view bounded.
  function prefetchTrades(pts) {
    var a = window.__lxxAssetRef;
    if (!a || !a.issuer || !pts || pts.length < 2 || pts.length > 170) return;
    var step = pts[1][0] - pts[0][0];
    var bounds = pts.map(function (q) { return q[0]; });
    bounds.push(pts[pts.length - 1][0] + step);
    var chunks = [];
    // Twelve windows per request, the endpoint's cap (a forty-window batch outran the free plan's fifty subrequests and
    // came back null after the eighteenth), three requests at a time.
    for (var i = 0; i < bounds.length - 1; i += 12) chunks.push(bounds.slice(i, Math.min(bounds.length, i + 13)));
    var gen = ++prefetchGen, nextK = 0;
    var worker = function () {
      if (nextK >= chunks.length || gen !== prefetchGen) return;
      var ch = chunks[nextK++];
      fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(currencyOf(a.code))
        + '&b=' + ch.join(','))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.n) return;
          d.n.forEach(function (n, j) { if (n != null) TRADES[a.issuer + '|' + a.code + '|' + ch[j] + '|' + ch[j + 1]] = n; });
        }, function () {})
        .then(worker);
    };
    worker(); worker(); worker();
  }
  // ONE WINDOW'S COUNT, ASKED AGAIN IF IT FAILS (RAZA 2026-09-15: "sometimes the number of trades appear in chart hover and
  // sometimes it doesnt"). Every candle of a range used to be fetched as the chart drew — up to 170 calls to an upstream
  // that allows two a second — so a burst came back empty, and the same burst starved the Exchanges tab beside it.
  function tradeCount(a, s, e, tries) {
    return fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(currencyOf(a.code))
      + '&s=' + Math.round(s) + '&e=' + Math.round(e))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && !d.truncated && d.n != null) return +d.n;
        if (d && d.ok && d.truncated) return null;
        throw new Error('retry');
      })
      .catch(function () {
        if (!(tries > 0)) return null;
        return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return tradeCount(a, s, e, tries - 1); });
      });
  }

  function tradesFor(key, a, s, e, cb) {
    clearTimeout(tradeTimer);
    tradeTimer = setTimeout(function () {
      if (tradeWaiting[key]) { tradeWaiting[key].push(cb); return; }
      tradeWaiting[key] = [cb];
      tradeCount(a, s, e, 2)
        .then(function (n) {
          if (n != null) TRADES[key] = n;
          var cbs = tradeWaiting[key] || [];
          delete tradeWaiting[key];
          cbs.forEach(function (f) { f(n); });
        });
    }, 140);
  }

  function wireChartHover(host, st) {
    host.__lxxHov = st;
    ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (cls) {
      if (!host.querySelector('.' + cls)) host.appendChild(el('div', cls));
    });
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    function hide() {
      ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (c2) { var n = host.querySelector('.' + c2); if (n) n.style.opacity = 0; });
    }
    function move(cx, cy) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      var tip = host.querySelector('.lxda-chtip'), dot = host.querySelector('.lxda-chdot'), vl = host.querySelector('.lxda-chvl');
      if (!S || !svg || !tip || !dot || !vl) return;
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return;
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var P = S.pts, best = 0, bd = Infinity;
      for (var i = 0; i < P.length; i++) {
        var dx = Math.abs(S.L + ((P[i][0] - S.t0) / S.tspan) * (S.R - S.L) - vx);
        if (dx < bd) { bd = dx; best = i; }
      }
      var p = P[best];
      var sp = svg.createSVGPoint();
      sp.x = S.L + ((p[0] - S.t0) / S.tspan) * (S.R - S.L);
      sp.y = S.y(p[1]);
      var scr = sp.matrixTransform(m), hr = host.getBoundingClientRect();
      var lx = scr.x - hr.left, ly = scr.y - hr.top;
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = 1;
      vl.style.left = lx + 'px'; vl.style.opacity = 1;

      var d = window.__lxxAssetData, usdPerXrp = (d && d.price && d.usd) ? d.usd / d.price : 0;
      var inUsd = CH_VIEW.vs === 'USD', mcap = S.K !== 1;
      var head = inUsd ? ('$' + (mcap ? amount(p[1]) : xrp(p[1], 6))) : ((mcap ? amount(p[1]) : xrp(p[1], 6)) + ' XRP');
      var sub = (!inUsd && usdPerXrp > 0) ? (mcap ? usdCompact(p[1] * usdPerXrp) : ('$' + xrp(p[1] * usdPerXrp, 6))) : '';
      var unitUsd = (inUsd ? p[1] : p[1] * usdPerXrp) / S.K;     // one token, in dollars, at this point
      // xrplohlc's volume column is in XRP, not token units: LUMOS's last 24 hourly values x XRP/USD equal its published
      // 24h volume ($4.64 vs $4.65); read as LUMOS they came to $0.00007.
      var volUsd = (+p[5] || 0) * usdPerXrp;
      tip.textContent = '';
      tip.appendChild(tipEl('d', tipDate(p[0])));
      tip.appendChild(tipEl('l', mcap ? 'Market cap' : 'Price'));
      tip.appendChild(tipEl('p', head));
      if (sub) tip.appendChild(tipEl('v', sub));
      if (volUsd > 0) {
        var row = el('div', 'lxrow');
        row.appendChild(tipEl('l', 'Volume'));
        row.appendChild(tipEl('p', usdCompact(volUsd)));
        tip.appendChild(row);
      }
      var step = P.length > 1 ? (P[1][0] - P[0][0]) : 0, a0 = window.__lxxAssetRef;
      if (step > 0 && a0 && a0.issuer) {
        var ts = p[0], te = best < P.length - 1 ? P[best + 1][0] : p[0] + step;
        var tkey = a0.issuer + '|' + a0.code + '|' + ts + '|' + te;
        tip.__lxxKey = tkey;
        // NO PLACEHOLDER (RAZA 2026-09-15: "for split seconds it shows 3 dots instead of trades count"). The row appears
        // with its number or not at all; the counts for the whole range are fetched as soon as the chart draws
        // (prefetchTrades), so a hovered candle's count is normally already here.
        if (TRADES[tkey] != null) {
          var trow = el('div', 'lxrow lxx-trades-row');
          trow.appendChild(tipEl('l', 'Trades'));
          trow.appendChild(tipEl('p', TRADES[tkey].toLocaleString('en-US')));
          tip.appendChild(trow);
        } else {
          tradesFor(tkey, a0, ts, te, function (n) {
            if (tip.__lxxKey !== tkey || n == null || tip.querySelector('.lxx-trades-row')) return;
            var trow2 = el('div', 'lxrow lxx-trades-row');
            trow2.appendChild(tipEl('l', 'Trades'));
            trow2.appendChild(tipEl('p', n.toLocaleString('en-US')));
            tip.appendChild(trow2);
          });
        }
      }
      tip.style.opacity = 1;
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = lx + 14;
      if (tx + tw > hr.width) tx = lx - tw - 14;
      if (tx < 2) tx = 2;
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(2, ly - th - 12) + 'px';
    }
    // A browser follows a touch with synthetic mouse events, so the mouseleave after a finger lifts would
    // erase the reading the tap was for; Stellar ignores it for 1.5s after a touch, and so does this.
    var touchAt = 0, tp0 = null;
    host.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    host.addEventListener('mouseleave', function () { if (Date.now() - touchAt < 1500) return; hide(); });
    host.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now(); tp0 = { x: t.clientX, y: t.clientY }; move(t.clientX, t.clientY);
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now();
      if (tp0 && Math.abs(t.clientX - tp0.x) > Math.abs(t.clientY - tp0.y)) { try { e.preventDefault(); } catch (x) {} }
      move(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('#dxaChart, #mdxaChart')) return;
      hide();
    }, true);
  }

  // THE PRICE LINE ABOVE THE CHART (RAZA 2026-09-15: "The section above the chart is different on
  // Stellar"). lumoscore.com leads the chart with the price in large type, a 24h change pill, and a meta
  // line — "0.0222866 XLM per VELO · 1D High 0.0239707 XLM · Low 0.021825 XLM". The design ships all three
  // (`.price-display .big`, `.change-pill`, `.meta`) holding Aptos mock behind `:not(.lxp)` gates, so
  // they were invisible here rather than wrong. Filled and released.
  function paintChartHead(pts) {
    var pd = $('.price-display');
    var d = window.__lxxAssetData, a = window.__lxxAssetRef;
    if (!pd || !d || !a || d.price == null) return;
    var usd = CH_VIEW.vs === 'USD';
    var priceTxt = usd ? (d.usd != null ? money(d.usd) : '—') : (xrp(d.price, 6) + ' XRP');

    var big = pd.querySelector('.big');
    if (big) { plain(big, priceTxt); big.classList.add('lxp'); }

    var pill = pd.querySelector('.change-pill');
    if (pill && d.p24 != null && isFinite(d.p24)) {
      plain(pill, (d.p24 >= 0 ? '▲ ' : '▼ ') + Math.abs(d.p24).toFixed(2) + '% (24h)');
      pill.className = 'change-pill lxp ' + (d.p24 >= 0 ? 'up' : 'down');
    }

    var meta = pd.querySelector('.meta');
    if (meta && pts && pts.length) {
      var hi = null, lo = null;
      for (var i = 0; i < pts.length; i++) {
        var h = (isFinite(pts[i][2]) && pts[i][2] > 0) ? pts[i][2] : pts[i][1];
        var l = (isFinite(pts[i][3]) && pts[i][3] > 0) ? pts[i][3] : pts[i][1];
        if (hi == null || h > hi) hi = h;
        if (lo == null || l < lo) lo = l;
      }
      var U = function (v) { return usd ? ('$' + xrp(v, 6)) : (xrp(v, 6) + ' XRP'); };
      meta.textContent = '';
      meta.appendChild(el('span', 'lx-pairpx', priceTxt + ' per ' + a.code + ' · '));
      meta.appendChild(document.createTextNode(CH_VIEW.label + ' High '));
      var bh = el('b', 'mono lxp', U(hi)); bh.style.color = 'var(--text)'; bh.setAttribute('data-logoed', '1');
      meta.appendChild(bh);
      meta.appendChild(document.createTextNode(' · Low '));
      var bl = el('b', 'mono lxp', U(lo)); bl.style.color = 'var(--text)'; bl.setAttribute('data-logoed', '1');
      meta.appendChild(bl);
    }
  }

  // Stellar's two trays, in the controls row ahead of the line/candle toggle — the same classes
  // (`.lxda-metric`, `.lxda-denom`) its stylesheet already dresses. data-logo on each keeps the logo
  // engine from emptying "$" and "XRP".
  function chartControls(asset) {
    var row = $('.chart-controls');
    if (!row) return;
    if (!$('.lxda-metric', row)) {
      var before = row.querySelector('.chart-tools:not(.lxda-metric):not(.lxda-denom):not(.lxda-snap)') || null;
      var g = el('div', 'chart-tools lxda-metric');
      g.setAttribute('data-logo', '');
      g.innerHTML = '<button type="button" data-metric="price" data-logo="">Price</button>'
        + '<button type="button" data-metric="mcap" data-logo="" title="Market cap = price x circulating supply">MCap</button>';
      var dn = el('div', 'chart-tools lxda-denom');
      dn.setAttribute('data-logo', '');
      dn.innerHTML = '<button type="button" data-cdn="usd" data-logo="">$</button>'
        + '<button type="button" data-cdn="xrp" data-logo="">XRP</button>';
      row.insertBefore(g, before);
      row.insertBefore(dn, before);
    }
    if (!window.__lxxChartCtl) {
      window.__lxxChartCtl = 1;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var m = t.closest('[data-metric]'), dv = t.closest('[data-cdn]');
        if (!m && !dv) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (m) {
          if (m.disabled) return;
          CH_VIEW.metric = m.getAttribute('data-metric') === 'mcap' ? 'mcap' : 'price';
        }
        if (dv) CH_VIEW.vs = dv.getAttribute('data-cdn') === 'usd' ? 'USD' : 'XRP';
        loadChart(asset, CH_VIEW.label);
      }, true);
    }
    syncChartControls();
  }

  function syncChartControls() {
    var d = window.__lxxAssetData;
    CH_VIEW.supply = (d && d.circulating > 0) ? +d.circulating : 0;
    $$('.lxda-metric button[data-metric]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-metric') === CH_VIEW.metric);
      if (b.getAttribute('data-metric') === 'mcap') {
        b.disabled = !(CH_VIEW.supply > 0);
        b.title = CH_VIEW.supply > 0 ? 'Market cap = price x circulating supply' : 'Supply not known yet';
      }
    });
    $$('.lxda-denom button[data-cdn]').forEach(function (b) {
      b.classList.toggle('active', (b.getAttribute('data-cdn') === 'usd') === (CH_VIEW.vs === 'USD'));
    });
    $$('.timeframes button[data-period]').forEach(function (b) {
      b.classList.toggle('active', String(b.getAttribute('data-period') || '').toUpperCase() === CH_VIEW.label);
    });
  }

  function loadChart(asset, label, attempt) {
    var c = chartSvg();
    if (!c) return;
    CH_VIEW.label = String(label || CH_VIEW.label || '1D').toUpperCase();
    syncChartControls();
    var r = CH_RANGE[CH_VIEW.label] || '24H';
    var gen = ++chGen;
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 10000);
    fetch('/lxapi/xrplohlc?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&r=' + r + '&vs=' + CH_VIEW.vs, ctl ? { signal: ctl.signal } : undefined)
      .then(function (res) { return res.json(); })
      .then(function (d) {
        if (gen !== chGen) return;                       // a later range or unit button won
        if (d && d.ok && d.pts && d.pts.length > 1) { drawChart(d.pts); paintOhlcStrip(d.pts); paintChartHead(d.pts); fitChartHeight(); }
        else if (!(d && d.ok)) throw new Error('upstream');
      })
      .catch(function () {
        // A FAILED OR STALLED ANSWER IS ASKED AGAIN (RAZA 2026-09-15: "its taking forever to load the chart when i switched
        // to 1M"). The request used to fail once and leave the design's placeholder axes up with nothing ever drawn.
        if (gen !== chGen || (attempt || 0) >= 3) return;
        setTimeout(function () {
          if (gen !== chGen) return;
          chGen--;                                         // the retry keeps this click's generation
          loadChart(asset, label, (attempt || 0) + 1);
        }, 900 * ((attempt || 0) + 1));
      });
  }

  // The O/H/L/C/Δ/Vol strip above the chart, for the range CURRENTLY PLOTTED — so it moves with the
  // 1D/1W/1M/1Y buttons instead of being a fixed 24h figure that contradicts the chart beside it.
  //
  // Only H and L are visible on desktop; O, C, Δ and Vol belong to the phone layout, which is
  // exactly why they went unnoticed. See [[lumoscore-hidden-mock-sweep]] — a desktop-only check
  // cannot see them.
  //
  // Each value falls back to the close when its index is missing (a cached short response, or a
  // candle the upstream returned with nulls), so the figures are always within the real range even
  // if a stale colo is still serving two-element points.
  function paintOhlcStrip(pts) {
    var hi = null, lo = null, vol = 0, haveVol = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var h = (isFinite(p[2]) && p[2] > 0) ? p[2] : p[1];
      var l = (isFinite(p[3]) && p[3] > 0) ? p[3] : p[1];
      if (hi == null || h > hi) hi = h;
      if (lo == null || l < lo) lo = l;
      if (isFinite(p[5]) && p[5] >= 0) { vol += p[5]; haveVol = true; }
    }
    if (hi == null || lo == null) return;

    var first = pts[0], last = pts[pts.length - 1];
    var open = (isFinite(first[4]) && first[4] > 0) ? first[4] : first[1];
    var close = last[1];
    var delta = (open > 0) ? ((close - open) / open * 100) : null;

    var inUsd = CH_VIEW.vs === 'USD';
    // BARE FIGURES, as lumoscore.com prints them — "H 0.001899", no "XLM" after (RAZA 2026-09-15). The unit
    // is already on the chart and in the price line above it; only the $ view keeps its sign.
    var P5 = function (v) { return (inUsd ? '$' : '') + xrp(v, 5); };
    var VAL = {
      'O': P5(open),
      'H': P5(hi),
      'L': P5(lo),
      'C': P5(close),
      'Δ': (delta == null) ? '—' : ((delta >= 0 ? '+' : '') + delta.toFixed(2) + '%'),
      'VOL': haveVol ? amount(vol) : '—',                     // token units, as xrplohlc returns it
    };

    // The value is the row's other child — the one that is not the `.k` label.
    $$('.pair').forEach(function (row) {
      var k = row.querySelector('.k');
      if (!k) return;
      var which = (k.textContent || '').trim().toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(VAL, which)) return;
      var v = null;
      [].forEach.call(row.children, function (ch) { if (ch !== k) v = ch; });
      if (!v) return;
      plain(v, VAL[which]);
      try { v.classList.add('lxp'); } catch (e) {}
      if (which === 'Δ' && delta != null) {
        row.classList.remove('up', 'down');
        row.classList.add(delta >= 0 ? 'up' : 'down');
      }
    });
  }

  function wireChartRanges(asset) {
    if (window.__lxxDxaRanges) return;
    window.__lxxDxaRanges = 1;
    var btns = $$('button, .tf-btn, .range-btn').filter(function (b) {
      return /^(1D|1W|1M|1Y|ALL)$/i.test((b.textContent || '').trim());
    });
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.classList.toggle('active', o === b); });
        loadChart(asset, (b.textContent || '').trim());
      });
    });
  }

  // ---- Exchanges ----------------------------------------------------------------------------------
  //
  // The tab shipped fifteen mock rows — "0x00…665c ▲ Buy 4.1820 APT 18 USDC just now" — EVM wallets
  // trading Aptos against USDC, on a page about one XRP Ledger token. It was gated shut by
  // `#dxaExTable:not(.lxda) tr{visibility:hidden}`, which is why it read as an empty panel rather
  // than as wrong data. Now filled from /lxapi/xrplhistory and the gate is lifted only once real
  // rows are in.
  //
  // THE DESIGN'S OWN ROW IS CLONED, not rebuilt. Taking the first row as a template keeps the
  // identicon, the badge, the mono spans and the explorer button exactly as they ship, and only the
  // text changes — no new markup, and nothing to drift from the design.
  //
  // BUY OR SELL IS RELATIVE TO THIS PAGE'S TOKEN, which is why the edge does not decide it: if the
  // taker RECEIVED this token it is a buy, if they paid it away it is a sell. The other side is the
  // quote, and its name is printed beside the price because these are not all XRP pairs — ARMY trades
  // against CRAP, PHNI and XUSD as well, and a CRAP-denominated price under a bare "Price" heading
  // would read as XRP.

  function ago(ms) {
    if (!ms || !isFinite(ms)) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function curName(c) {
    if (!c || c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(c).display; } catch (e) { return c.slice(0, 6); }
  }

  // THE PHONE HAS A COMPLETELY DIFFERENT EXCHANGES CONTAINER, and naming only the desktop one left
  // fifteen rows of another chain's mock live on every mobile token page:
  //
  //     0x0f…3ce6  ▲ Buy  4.1820 APT  18 USDC  just now
  //
  // EVM addresses, APT prices and USDC amounts on an XRP Ledger token page. Desktop is a `<table>`
  // with `#dxaExTable` as its tbody; mobile is `#mdxaExList`, a div of `.ex-row` cards with the same
  // facts in different elements. `paintExchanges` looked up the tbody, found nothing, and returned —
  // which is why the mobile tab also still read "Exchanges 2.1k" while desktop read "—".
  //
  // Same fetch, same buy/sell decision, same numbers: only the writing differs, so the two layouts
  // cannot drift apart. Third instance of this trap — see [[lumoscore-hidden-mock-sweep]].
  // PAGES OF A HUNDRED in the panel's own footer (RAZA 2026-09-15: "Recent transactions and Pools, pagination is not
  // working"; then 2026-09-17: "you can show up to 100 transaction on the same page. no need for page 2 just for 22
  // transactions"). The rows are all in the table; the pager shows one page of them and says which — at fifteen a rummage
  // that found twenty-two trades still made the reader click to a second page for the last seven.
  var PAGE_PER = 100;
  // THE DESIGN REWRITES ITS SAMPLE TRADES WHENEVER THE EXCHANGES TAB IS OPENED (RAZA 2026-09-16, the XAH page: "0x00…665c · BUY ·
  // 4.1820 APT"). Our rows are kept and put back, with the table hidden between the design's write and ours.
  var EX_ROWS = null, EX_MIN = 0;
  // Paging state for "Keep looking" (RAZA 2026-09-16, item 4) and for the My Trades filter (item 7).
  var EX_TPL = null, EX_PAGE = 0, EX_DONE = false, EX_ASSET = null, EX_MINE = false;

  function myAddr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }

  // "MY TRADES" AT THE RIGHT OF THE TAB BAR (RAZA 2026-09-16: "Add My trades on the right side of recent activity on Trade-Asset
  // page. This is not specific to LumosCore but if that particular wallet address has trades that particular asset, it will be
  // shown here"). It is a filter over the same rows, so it needs no second feed: every row carries both counterparties.
  function ensureMyTrades() {
    var bar = document.querySelector('.tabs-bar');
    if (!bar || bar.querySelector('.lx-mytrades')) return;
    var b = el('button', 'lx-mytrades');
    b.type = 'button';
    b.textContent = 'My Trades';
    b.style.cssText = 'margin-left:auto;background:none;border:0;padding:6px 2px;font:inherit;font-size:13.5px;font-weight:700;'
      + 'color:var(--text);opacity:.6;cursor:pointer';
    bar.appendChild(b);
  }
  if (!window.__lxxMyTrades) {
    window.__lxxMyTrades = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.lx-mytrades');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      EX_MINE = !EX_MINE;
      b.style.opacity = EX_MINE ? '1' : '.6';
      b.style.textDecoration = EX_MINE ? 'underline' : '';
      b.style.textUnderlineOffset = '5px';
      var bd = document.getElementById('dxaExTable');
      if (!bd) return;
      // Back to the Exchanges tab, where the rows are.
      var extab = document.querySelector('.tabs-bar .tab[data-tab="exchanges"]');
      if (extab && !extab.classList.contains('active')) extab.click();
      var mb = document.querySelector('.lx-exmore');
      if (mb) mb.style.display = EX_MINE ? 'none' : '';
      if (EX_MINE) {
        loadMyTrades(EX_ASSET);
      } else {
        bd.innerHTML = '';                                 // ours are gone; the token's feed comes back
        restoreEx();
        [].forEach.call(bd.children, function (r) { r.style.display = ''; });
        pageTable(bd, 'exchanges', 1);
      }
    }, true);
  }

  // MY TRADES COMES FROM THE WALLET'S OWN HISTORY, not from this token's feed. Measured on LUMOS: the feed fills about 150
  // legs a minute, so four pages of it reach back one minute — a trade made yesterday sits thousands of pages away and
  // filtering the feed would show "none" to someone who has traded this token all week. An account's own transactions are a
  // short list by comparison and contain every trade it ever made in this asset.
  function mtAmt(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { c: 'XRP', i: '', v: Number(a) / 1e6 };
    return { c: String(a.currency || ''), i: String(a.issuer || ''), v: Number(a.value) };
  }
  function mtNote(body, text) {
    body.innerHTML = '';
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxnote', '1');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    body.appendChild(tr);
    body.classList.add('lxda');
  }
  function loadMyTrades(asset) {
    var body = document.getElementById('dxaExTable');
    if (!body || !asset) return;
    var me = myAddr();
    if (!me) { mtNote(body, 'Connect a wallet to see your own trades in this asset.'); return; }
    mtNote(body, 'Reading your trades…');
    var ours = currencyOf(asset.code);
    rpc('account_tx', { account: me, limit: 200, binary: false, forward: false, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (res) {
        var out = [];
        (res.transactions || []).forEach(function (e) {
          var t = e.tx || e.tx_json || {}, m = e.meta || e.metaData || {};
          if ((m.TransactionResult || '') !== 'tesSUCCESS') return;    // a failed trade moved nothing
          var got = null, paid = null;
          if (t.TransactionType === 'Payment') {
            got = mtAmt(m.delivered_amount || m.DeliveredAmount);
            paid = mtAmt(t.SendMax);
            if (!paid) return;                                        // a plain transfer, not a conversion
          } else if (t.TransactionType === 'OfferCreate') {
            got = mtAmt(t.TakerPays); paid = mtAmt(t.TakerGets);
          } else return;
          if (!got || !paid || !(got.v > 0) || !(paid.v > 0)) return;
          var bought = got.c === ours && got.i === asset.issuer;
          var sold = paid.c === ours && paid.i === asset.issuer;
          if (!bought && !sold) return;
          out.push({
            bought: bought,
            mine: bought ? got : paid,
            other: bought ? paid : got,
            t: t.date != null ? (t.date + 946684800) * 1000 : 0,
            hash: t.hash || e.hash || ''
          });
        });
        if (!out.length) { mtNote(body, 'No trades in ' + asset.code + ' from this wallet.'); return; }
        body.innerHTML = '';
        out.forEach(function (h) {
          var row = EX_TPL ? EX_TPL.cloneNode(true) : null;
          if (!row) return;
          row.setAttribute('data-lxex', '1');
          row.setAttribute('data-lxwho', me + '|' + me);
          row.style.display = '';
          var otherXrp = h.other.c === 'XRP' ? h.other.v : null;
          if (otherXrp != null) row.setAttribute('data-lxxrp', String(otherXrp));
          var td = row.children;
          var wa = td[0] && td[0].querySelector('.wa');
          if (wa) wa.textContent = shortAddr(me);
          var wc = td[0] && td[0].querySelector('.wallet-cell');
          if (wc && wc.tagName === 'A') wc.href = '/account/xrpl/' + encodeURIComponent(me);
          var badge = td[1] && td[1].querySelector('.type-badge');
          if (badge) { badge.className = 'type-badge ' + (h.bought ? 'buy' : 'sell'); badge.textContent = h.bought ? '▲ Buy' : '▼ Sell'; }
          var pEl = td[2] && td[2].querySelector('.mono');
          if (pEl) pEl.textContent = otherXrp != null ? (xrp(otherXrp / h.mine.v, 5) + ' XRP')
            : (xrp(h.other.v / h.mine.v, 5) + ' ' + curName(h.other.c));
          var aEl = td[3] && td[3].querySelector('.mono');
          if (aEl) aEl.textContent = amount(h.mine.v) + ' ' + asset.code;
          if (td[3]) {
            var tot = td[3].querySelector('.lx-extot');
            if (!tot) { tot = el('span', 'lx-extot'); td[3].appendChild(tot); }
            plain(tot, (h.other.v >= 1000 ? amount(h.other.v) : xrp(h.other.v, 7)) + ' ' + curName(h.other.c));
          }
          var tEl = td[4] && td[4].querySelector('.time');
          if (tEl) tEl.textContent = ago(h.t);
          var lk = td[5] && td[5].querySelector('.row-link, a');
          if (lk && h.hash) {
            if (lk.tagName === 'A') lk.href = 'https://bithomp.com/explorer/' + encodeURIComponent(h.hash);
            else lk.setAttribute('data-lxtx', h.hash);
          }
          body.appendChild(row);
        });
        body.classList.add('lxda');
        pageTable(body, 'exchanges', 1);
      })
      .catch(function () { mtNote(body, 'Your trades could not be read right now.'); });
  }

  // STELLAR'S "KEEP LOOKING" (RAZA 2026-09-16: "it looks back to maybe hundreds or even thousands of transactions. And keeps
  // looking back couple thousands back if user keeps clicking keep looking. Its more better"). It sits at the right of the
  // panel foot, beside the pager, and each press walks one more page of the ledger's history into the same table.
  // PLACED AND STYLED AS ON STELLAR (RAZA 2026-09-17: "Keep looking button is not like Stellar"). lumoscore.com builds
  // `button.lx-exmore[data-lxc]` and inserts it immediately AFTER `#dxaPanelInfo` — the "Showing 1-4 of 4 recent trades"
  // line — and the inherited sheet already carries the pill styling for that exact class (bordered, surface-2, 12px/700).
  // Mine set its own inline styles, which overrode all of it and rendered as underlined text floated to the right.
  function exMore(host, state) {
    var foot = host && host.closest ? host.closest('.panel, section') : null;
    foot = foot ? foot.querySelector('.panel-foot') : null;
    if (!foot) return;
    var info = foot.querySelector('#dxaPanelInfo') || foot.querySelector('.info');
    var b = foot.querySelector('.lx-exmore');
    if (!b) {
      b = el('button', 'lx-exmore');
      b.type = 'button';
      b.setAttribute('data-lxc', '');
      if (info && info.parentNode) info.parentNode.insertBefore(b, info.nextSibling);
      else foot.appendChild(b);
    }
    // "Keep looking" walks the TOKEN's feed; with My Trades on the table is the wallet's own history, which is already whole.
    b.style.display = EX_MINE ? 'none' : '';
    b.disabled = state === 'busy' || state === 'end';
    b.textContent = state === 'busy' ? 'Looking…' : (state === 'end' ? 'No older trades' : 'Keep looking');
  }
  // ONE CLICK GOES DEEP, NOT ONE PAGE (RAZA 2026-09-17: "on XRPL you're checking very few transactions. i know that on
  // Stellar it goes back to hundreds or even thousands of transaction when i click keep looking").
  //
  // lumoscore.com does exactly this: its button adds three thousand trades to the scan budget and keeps scanning until the
  // size filter has enough. Mine fetched a single page of 40 legs per press, which against a "10+ XRP" filter on a busy
  // token is nearly nothing — your screenshot showed 5 matching rows after a press.
  //
  // So one press now walks up to TWELVE pages (480 legs) and stops early the moment the filter in force has 25 rows, the
  // ledger runs out of history, or the endpoint's 50-page ceiling is reached — 2,000 legs, which is as far back as this
  // feed goes. Sequential with a short gap between pages, because the upstream allows about two history calls a second.
  // FASTER, THE ONLY TWO WAYS THAT EXIST HERE (RAZA 2026-09-17: "for keep looking. XRP is taking too long. on Stellar its
  // way quicker"). A page is a round trip to a provider that allows about two calls a second, so depth-per-second is
  // page size × pages in flight. Both were as small as they could be: 40 legs, one at a time, with a 300ms pause between.
  //
  // Now 100 legs a page and THREE pages in flight per wave — 300 legs per round trip instead of 40, and no artificial
  // pause. Six waves per click is 1,800 legs, against 480 before, in roughly a third of the time.
  var EX_WAVES = 6, EX_PARALLEL = 3, EX_WANT = 25;
  var EX_WALKING = false;
  function keepLooking(body) {
    if (EX_WALKING) return;                              // a second click must not start a second walk over the same rows
    EX_WALKING = true;
    var wave = 0;
    // Done once, when the walk finishes — not per page. Paging the table and snapshotting it for the sample-row watcher
    // are both O(rows), and running them inside the loop is what made a deep walk lock the page up.
    var stop = function (state) {
      EX_WALKING = false;
      pageTable(body, 'exchanges', 1);
      EX_ROWS = [].slice.call(body.children).map(function (r) { return r.cloneNode(true); });
      watchEx();
      exMore(body, state);
    };
    (function next() {
      if (EX_DONE || wave >= EX_WAVES || EX_PAGE >= 50) {
        stop(EX_DONE || EX_PAGE >= 50 ? 'end' : 'idle');
        return;
      }
      wave++;
      // Re-asserted each wave: the table is rebuilt underneath this walk (the chip handler, the sample-row watcher), and a
      // button reading "Keep looking" while it is still working invites a second click on top of the first.
      exMore(body, 'busy');
      var base = EX_PAGE, jobs = [];
      for (var k = 1; k <= EX_PARALLEL && base + k <= 50; k++) {
        jobs.push(paintExchanges(EX_ASSET, 0, base + k, true));
      }
      Promise.all(jobs).then(function (counts) {
        var added = counts.reduce(function (a, b) { return a + (b || 0); }, 0);
        // The walker owns the page counter. paintExchanges sets EX_PAGE to whichever page it just drew, and with three in
        // flight the last one to land would win — which could hand the next wave a page it has already read.
        EX_PAGE = base + jobs.length;
        // Every page in the wave came back empty: that is the end of the feed, not a failure.
        if (!added) { EX_DONE = true; stop('end'); return; }
        // Once per wave, so the reader sees the table filling — but without the whole-table clone, which is the expensive
        // half and only has to happen when the walk is over.
        pageTable(body, 'exchanges', 1);
        var shown = [].slice.call(body.children).filter(function (r) {
          if (!r.hasAttribute || !r.hasAttribute('data-lxex')) return false;
          if (EX_MIN > 0 && +(r.getAttribute('data-lxxrp') || 0) < EX_MIN) return false;
          return true;
        }).length;
        if (shown >= EX_WANT) { stop('idle'); return; }
        next();
      }, function () { stop('idle'); });                 // a refused read is not the end of the history
    })();
  }

  if (!window.__lxxExMore) {
    window.__lxxExMore = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.lx-exmore');
      if (!b || b.disabled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var body = document.getElementById('dxaExTable');
      if (!body || !EX_ASSET || EX_DONE) return;
      keepLooking(body);
    }, true);
  }
  // THE SIZE FILTERS (All · 10+ · 100+ · 1000+ XRP) and anything else that rewrites the table (RAZA 2026-09-16, the LUMOS page with
  // "1000+ XRP" selected showing "0x0c…9fbc · 4.2240 APT"): the design redraws its sample trades on every chip click. The chip is
  // taken first and applied to this token's rows, and a watcher puts our rows back whenever sample rows appear.
  if (!window.__lxxExChips) {
    window.__lxxExChips = 1;
    window.addEventListener('click', function (e) {
      var c = e.target && e.target.closest && e.target.closest('button.chip[data-min-xlm]');
      if (!c) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(c.parentNode.querySelectorAll('button.chip[data-min-xlm]'), function (x) { x.classList.toggle('active', x === c); });
      var was = EX_MIN;
      EX_MIN = +c.getAttribute('data-min-xlm') || 0;
      var bd = document.getElementById('dxaExTable');
      if (!bd) return;
      // DROPPING THE FILTER AFTER A WALK STARTS OVER. A walk under '100+ XRP' never builds the small legs it reads, so
      // widening the filter afterwards has nothing to widen TO — the table would sit there showing the large ones and
      // look like the small trades had stopped happening. The recent page is drawn again instead, and the walk is armed
      // again from the start, so 'Keep looking' fetches those pages back (the edge already has them cached).
      if (was > 0 && EX_MIN < was && EX_PAGE > 0) {
        EX_PAGE = 0; EX_DONE = false; EX_ROWS = null;
        paintExchanges(EX_ASSET, 0, 0, false);
        return;
      }
      // A FAILED LOAD IS RETRIED HERE. The chips are the only thing on the panel a reader can press when the table came
      // back empty, so pressing one asks for the trades again rather than re-filtering a note.
      if (!bd.querySelector('[data-lxex]') && EX_ASSET) {
        EX_PAGE = 0; EX_DONE = false; EX_ROWS = null;
        paintExchanges(EX_ASSET, 0, 0, false);
        return;
      }
      restoreEx();
      pageTable(bd, 'exchanges', 1);
    }, true);
  }
  function watchEx() {
    var bd = document.getElementById('dxaExTable');
    if (!bd || bd.__lxxWatch || !window.MutationObserver) return;
    bd.__lxxWatch = new MutationObserver(function () {
      var f = bd.firstElementChild;
      if (EX_ROWS && f && !f.hasAttribute('data-lxex') && !f.hasAttribute('data-lxnote')) { bd.classList.remove('lxda'); restoreEx(); }
    });
    bd.__lxxWatch.observe(bd, { childList: true });
  }
  function restoreEx() {
    var bd = document.getElementById('dxaExTable');
    if (!bd || !EX_ROWS) return;
    var f = bd.firstElementChild;
    if (f && (f.hasAttribute('data-lxex') || f.hasAttribute('data-lxnote'))) { bd.classList.add('lxda'); return; }
    bd.innerHTML = '';
    EX_ROWS.forEach(function (r) { bd.appendChild(r.cloneNode(true)); });
    bd.classList.add('lxda');
    pageTable(bd, 'exchanges', 1);
  }
  if (!window.__lxxExRestore) {
    window.__lxxExRestore = 1;
    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.tabs-bar .tab');
      if (!t || (t.getAttribute('data-tab') || '') !== 'exchanges' || !EX_ROWS) return;
      var bd = document.getElementById('dxaExTable');
      if (bd) bd.classList.remove('lxda');
      [0, 60, 250, 700].forEach(function (ms) { setTimeout(restoreEx, ms); });
    }, true);
  }
  function pageTable(host, noun, page) {
    if (!host) return;
    var all = [].slice.call(host.children);
    var me = EX_MINE ? myAddr() : '';
    var rows = all.filter(function (r) {
      if (r.hasAttribute('data-lxnote')) return false;
      var keep = !(EX_MIN > 0) || !r.hasAttribute('data-lxex') || +(r.getAttribute('data-lxxrp') || 0) >= EX_MIN;
      // MY TRADES (RAZA 2026-09-16: "if that particular wallet address has trades that particular asset, it will be shown here").
      // Either side of the fill counts — the connected account can be the maker or the taker.
      if (keep && me && r.hasAttribute('data-lxex')) {
        keep = (r.getAttribute('data-lxwho') || '').split('|').indexOf(me) >= 0;
      }
      if (!keep) r.style.display = 'none';
      return keep;
    });
    var em = host.querySelector('tr.lx-exempty');
    if (em && em.parentNode) em.parentNode.removeChild(em);
    // ONLY WHEN THERE ARE ROWS TO FILTER (RAZA 2026-09-17, SOLO under 1000+ XRP showing "Recent exchanges are unavailable
    // right now." AND "No exchanges of 1000+ XRP among the latest trades." at once). exNote() ends by calling this
    // function, so a failed load with a size chip active stacked the filter note underneath the failure — two notes
    // contradicting each other, one of them a guess. Nothing was filtered out if nothing loaded.
    if (!rows.length && (EX_MIN > 0 || EX_MINE) && host.tagName === 'TBODY' && host.querySelector('[data-lxex]')) {
      var et = document.createElement('tr');
      et.className = 'lx-exempty';
      et.setAttribute('data-lxnote', '1');
      var emptyTxt = EX_MINE
        ? (me ? 'No trades from this wallet among the trades loaded — keep looking for older ones.'
              : 'Connect a wallet to see your own trades in this asset.')
        : ('No exchanges of ' + EX_MIN + '+ XRP among the latest trades.');
      var ed = el('td', null, emptyTxt);
      ed.colSpan = 6;
      ed.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
      et.appendChild(ed);
      host.appendChild(et);
    }
    var n = rows.length, pages = Math.max(1, Math.ceil(n / PAGE_PER));
    page = Math.max(1, Math.min(pages, page || 1));
    host.__lxxPage = page;
    host.__lxxNoun = noun;
    rows.forEach(function (r, i) { r.style.display = (i >= (page - 1) * PAGE_PER && i < page * PAGE_PER) ? '' : 'none'; });
    var foot = host.closest('.panel') ? host.closest('.panel').querySelector('.panel-foot') : document.querySelector('#dxaPanel .panel-foot, .panel-foot');
    if (!foot) return;
    var info = foot.querySelector('.info');
    // STELLAR'S WORDING, including the size filter it was read under: "Showing 1-4 of 4 recent trades · ≥ 100 XLM".
    if (info) {
      var what = noun === 'exchanges' ? 'recent trades' : noun;
      var suffix = (noun === 'exchanges' && EX_MIN > 0) ? (' · ≥ ' + EX_MIN + ' XRP') : '';
      info.textContent = n
        ? ('Showing ' + ((page - 1) * PAGE_PER + 1) + '–' + Math.min(n, page * PAGE_PER) + ' of ' + n + ' ' + what + suffix)
        : ('Showing 0 ' + what + suffix);
    }
    var pg = foot.querySelector('.pgn');
    if (!pg) return;
    pg.innerHTML = '';
    function btn(label, target, active, disabled) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('data-logoed', '1');
      b.setAttribute('data-lxpage', String(target));
      if (active) b.className = 'active';
      if (disabled) b.disabled = true;
      pg.appendChild(b);
    }
    btn('‹', page - 1, false, page <= 1);
    for (var k = 1; k <= pages; k++) btn(String(k), k, k === page, false);
    btn('›', page + 1, false, page >= pages);
    pg.style.display = pages > 1 ? '' : 'none';
  }
  function activeTabHost() {
    var t = document.querySelector('.tabs-bar .tab.active');
    var which = t ? (t.getAttribute('data-tab') || '') : 'exchanges';
    if (which === 'pools') { var pb = poolsTable(); return pb && pb.tagName === 'TBODY' ? pb : null; }
    if (which === 'exchanges' || !which) return document.getElementById('dxaExTable');
    return null;
  }
  if (!window.__lxxPager) {
    window.__lxxPager = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.panel-foot .pgn button');
      if (!b) return;
      var host = activeTabHost();
      if (!host || host.__lxxPage == null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.disabled) return;
      var to = parseInt(b.getAttribute('data-lxpage') || '', 10);
      if (!isFinite(to)) {
        var tx = (b.textContent || '').trim();
        to = tx === '‹' ? host.__lxxPage - 1 : (tx === '›' ? host.__lxxPage + 1 : parseInt(tx, 10));
      }
      if (isFinite(to)) pageTable(host, host.__lxxNoun, to);
    }, true);
  }
  function exNote(host, text) {
    if (!host || host.tagName !== 'TBODY') return;
    host.innerHTML = '';
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxnote', '1');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    host.appendChild(tr);
    host.classList.add('lxda');
    EX_ROWS = [tr.cloneNode(true)];
    pageTable(host, 'exchanges', 1);
  }

  // Resolves with the number of rows this call added, so "Keep looking" can walk page after page until it has found
  // enough for the size filter in force.
  function paintExchanges(asset, attempt, page, append) {
    var body = document.getElementById('dxaExTable');
    var mlist = document.getElementById('mdxaExList');
    var host = body || mlist;
    if (!host) return Promise.resolve(0);
    // The design's own row is the template, kept from the first paint: once this layer has filled the table, its rows are
    // the only ones left to clone, and a later page must not inherit the previous row's values.
    if (!EX_TPL) {
      var tpl = host.querySelector(body ? 'tr' : '.ex-row');
      if (!tpl) return Promise.resolve(0);
      EX_TPL = tpl.cloneNode(true);
    }
    var template = EX_TPL;

    return fetch('/lxapi/xrplhistory?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&n=100&p=' + (page || 0))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // A FAILED READ IS ASKED AGAIN (RAZA 2026-09-15: "For this Trade-Asset page, the recent transactions is not even
        // loading"). The upstream answers two history calls a second; one refused call left the table blank for good.
        if (!d || !d.ok || !d.rows) {
          if ((attempt || 0) < 3) {
            return new Promise(function (res) { setTimeout(res, 1500 * ((attempt || 0) + 1)); })
              .then(function () { return paintExchanges(asset, (attempt || 0) + 1, page, append); });
          }
          if (append) { exMore(host, 'idle'); return 0; }
          exNote(body, 'Recent exchanges are unavailable right now.');
          return 0;
        }
        if (!d.rows.length) {
          if (append) { EX_DONE = true; exMore(host, 'end'); return 0; }
          exNote(body, 'No recent exchanges for this token.');
          return;
        }
        var ours = currencyOf(asset.code);
        if (!append) host.innerHTML = '';

        // XRP PER TOKEN, from this feed's own XRP legs (the median, so one odd fill cannot skew it). lumoscore.com
        // prices every fill in the native asset; a token-to-token leg has no XRP side, so it is valued at this.
        var spots = [];
        d.rows.forEach(function (h0) {
          var b0 = h0.got.c === ours && h0.got.i === asset.issuer, s0 = h0.paid.c === ours && h0.paid.i === asset.issuer;
          if (!b0 && !s0) return;
          var mi = b0 ? h0.got : h0.paid, ot = b0 ? h0.paid : h0.got;
          if (ot.c === 'XRP' && mi.v > 0 && ot.v > 0) spots.push(ot.v / mi.v);
        });
        spots.sort(function (x, y) { return x - y; });
        var spot = spots.length ? spots[Math.floor(spots.length / 2)]
          : ((window.__lxxAssetData && window.__lxxAssetData.price > 0) ? +window.__lxxAssetData.price : 0);

        for (var i = 0; i < d.rows.length; i++) {
          var h = d.rows[i];
          // BUY AND SELL WERE THE WRONG WAY ROUND ON EVERY ROW. The feed's `paid` and `got` are the MAKER's two legs, while
          // the wallet this row NAMES is the taker — so a row read "▼ SELL" beside the address of an account that had just
          // bought. Checked against the ledger both ways before changing it: RAZA's own ATOM trades (SendMax 1 XRP,
          // delivered 0.00132 ATOM — a buy) arrive here as paid=ATOM/got=XRP, and a book leg behaves the same way. So the
          // maker paying this token is the displayed wallet BUYING it.
          var bought = (h.paid.c === ours && h.paid.i === asset.issuer);
          var sold = (h.got.c === ours && h.got.i === asset.issuer);
          if (!bought && !sold) continue;                       // a leg that never touched this token

          var mine = bought ? h.paid : h.got;                   // this token's leg
          var other = bought ? h.got : h.paid;                  // what it went against
          var px = other.v / mine.v;

          // PRICED IN WHATEVER THE OTHER SIDE WAS, and that is very often not XRP: 11 of RLUSD's
          // last 40 legs and 23 of ARMY's were token-to-token, so filtering them out would hide most
          // of some tokens' trading. They stay, named.
          //
          // What made them LOOK broken was the formatting, not the data — a cross-token rate can run
          // to seven digits, and `xrp(px, 5)` rendered one as "3,672,930.25281 AmericaFirst" beside
          // neighbours reading "0.72115 XRP". Large rates get the same compact form every other big
          // number on this page uses.
          // IN XRP (RAZA 2026-09-15: "it should also show RLUSD or XRP. whys it showing BITx, ETH, USDC").
          var otherXrp = other.c === 'XRP' ? other.v : (spot > 0 ? mine.v * spot : null);

          // A ROW THAT WOULD ONLY BE HIDDEN IS NEVER BUILT (RAZA 2026-09-17: "the page becomes very slow and laggy"). A deep
          // walk reads ~1,900 legs; with a "100+ XRP" filter in force, nearly all of them are hidden the moment they are
          // drawn. Building them anyway left two thousand table rows — each with a logo, a link and five cells — on the
          // page to display none of them. During a walk the filter is applied BEFORE the row is made; the first paint is
          // unchanged, so switching filters still has the full recent page to work with.
          if (append && EX_MIN > 0 && !(otherXrp >= EX_MIN)) continue;

          var priceTxt = otherXrp != null
            ? (xrp(otherXrp / mine.v, 5) + ' XRP')
            : ((px >= 1000 ? amount(px) : xrp(px, 5)) + ' ' + curName(other.c));
          var amtTxt = amount(mine.v) + ' ' + asset.code;
          var whoTxt = shortAddr(h.taker || h.maker);
          var sideCls = bought ? 'buy' : 'sell';
          var sideTxt = bought ? '▲ Buy' : '▼ Sell';

          var row = template.cloneNode(true);
          row.setAttribute('data-lxex', '1');
          if (otherXrp != null && isFinite(otherXrp)) row.setAttribute('data-lxxrp', String(otherXrp));
          // Both counterparties ride along so "My Trades" can pick this row out (RAZA 2026-09-16, item 7).
          row.setAttribute('data-lxwho', (h.maker || '') + '|' + (h.taker || ''));

          if (body) {
            var td = row.children;

            var wa = td[0] && td[0].querySelector('.wa');
            if (wa) wa.textContent = whoTxt;
            // THE WALLET IS A LINK on lumoscore.com — `a.lx-acct.wallet-cell` to that account's page.
            var wc = td[0] && td[0].querySelector('.wallet-cell');
            var whoAddr = h.taker || h.maker;
            if (wc && whoAddr && window.lxx.isAddress(whoAddr)) {
              if (wc.tagName !== 'A') {
                var an = document.createElement('a');
                an.className = 'lx-acct wallet-cell';
                while (wc.firstChild) an.appendChild(wc.firstChild);
                wc.parentNode.replaceChild(an, wc);
                wc = an;
              }
              wc.href = '/account/xrpl/' + encodeURIComponent(whoAddr);
            }

            var badge = td[1] && td[1].querySelector('.type-badge');
            if (badge) { badge.className = 'type-badge ' + sideCls; badge.textContent = sideTxt; }

            var pEl = td[2] && td[2].querySelector('.mono');
            if (pEl) pEl.textContent = priceTxt;

            var aEl = td[3] && td[3].querySelector('.mono');
            if (aEl) aEl.textContent = amtTxt;
            // Stellar's second line under the amount: what the other side of the fill came to.
            if (td[3]) {
              var tot = td[3].querySelector('.lx-extot');
              if (!tot) { tot = el('span', 'lx-extot'); td[3].appendChild(tot); }
              plain(tot, otherXrp != null
                ? ((otherXrp >= 1000 ? amount(otherXrp) : xrp(otherXrp, 7)) + ' XRP')
                : ((other.v >= 1000 ? amount(other.v) : xrp(other.v, 7)) + ' ' + curName(other.c)));
            }

            var tEl = td[4] && td[4].querySelector('.time');
            if (tEl) tEl.textContent = ago(h.t);

            // The design's explorer button, pointed at this fill rather than left inert.
            // A REAL LINK TO THE FILL ON BITHOMP (RAZA 2026-09-15: "the transactions are not linking to
            // bithomp explorer"). The button carried the hash and nothing opened it. Stellar's row-link is an
            // <a> to stellar.expert; this is the same element pointed at this ledger's explorer.
            var btn = td[5] && td[5].querySelector('.row-link');
            if (btn && h.hash) {
              var lk = document.createElement('a');
              lk.className = 'row-link';
              lk.href = 'https://bithomp.com/explorer/' + encodeURIComponent(h.hash);
              lk.target = '_blank';
              lk.rel = 'noopener nofollow';
              lk.setAttribute('aria-label', 'View this trade on Bithomp');
              while (btn.firstChild) lk.appendChild(btn.firstChild);
              btn.parentNode.replaceChild(lk, btn);
            }
          } else {
            // The phone's card: `.nm` is the wallet, `.ex-num` holds the price with the amount in a
            // nested `.sub`, and `.ex-time` is the age. The `.ex-ident` identicon is left alone — it
            // is decorative, and it doubles as the thing that keeps the logo healer off the row.
            var nm = row.querySelector('.nm');
            if (nm) nm.textContent = whoTxt;

            var mb = row.querySelector('.type-badge');
            if (mb) { mb.className = 'type-badge ' + sideCls; mb.textContent = sideTxt; }

            var num = row.querySelector('.ex-num');
            if (num) {
              var sub = num.querySelector('.sub');
              // Only the price text node is replaced, so the nested `.sub` keeps its place.
              var wrote = false;
              [].forEach.call(num.childNodes, function (n) {
                if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = priceTxt; wrote = true; }
              });
              if (!wrote) num.insertBefore(document.createTextNode(priceTxt), num.firstChild);
              if (sub) sub.textContent = amtTxt;
            }

            var mt = row.querySelector('.ex-time');
            if (mt) mt.textContent = ago(h.t);

            if (h.hash) row.setAttribute('data-lxtx', h.hash);
          }

          host.appendChild(row);
        }

        if (!host.children.length) { exNote(body, 'No recent exchanges for this token.'); return 0; }
        host.classList.add('lxda');
        EX_PAGE = page || 0;
        EX_ASSET = asset;
        ensureMyTrades();

        // THE COUNT AND THE FOOTER WERE BOTH INVENTED. The tab read "Exchanges 2,142" and the foot
        // "Showing 15 of 2,142 exchanges ‹ 1 2 3 ›" — a total this page has no way to know (the
        // history feed returns a page, not a count) over a pager that does nothing. The number of
        // rows actually shown is the only true statement available, so that is what is said, and the
        // dead pager goes with the sentence that justified it.
        setTabCount(/exchanges/i, '—');
        if (body) {
          // THE PER-PAGE WORK IS WHAT MADE THE PAGE CRAWL (RAZA 2026-09-17: "while its looking back into the transactions,
          // the page becomes very slow and laggy"). Two things ran on EVERY appended page: the pager walked every row in
          // the table, and `EX_ROWS` re-cloned the whole table — so by the eighteenth page each new page cloned ~1,800
          // rows, eighteen times over, on the main thread. Both belong at the END of a walk, not inside it, and
          // keepLooking() does them there.
          if (!append) {
            pageTable(body, 'exchanges', 1);
            EX_ROWS = [].slice.call(body.children).map(function (r) { return r.cloneNode(true); });
            watchEx();
            // While "Keep looking" is walking, IT owns the button — otherwise the label flipped back to "Keep looking"
            // after each page and the walk looked finished when it had eleven pages still to go.
            exMore(body, EX_DONE ? 'end' : 'idle');
          }
        }
        // `host`, not `body` — this used to read `body.children.length` and `body.closest(...)`,
        // which are a TypeError the moment the desktop table is absent.
        var shell = host.closest ? host.closest('#dxaExTable, table, .panel') : null;
        if (shell) shell.classList.add('lxda');
        exAttribution(d, host);
        // LEGS READ, not rows drawn. With the filter applied before a row is built, a page of a hundred legs that
        // match nothing would otherwise look identical to the end of the history and stop the walk dead.
        return d.rows.length;
      })
      .catch(function () {
        if ((attempt || 0) < 3) {
          return new Promise(function (res) { setTimeout(res, 1500 * ((attempt || 0) + 1)); })
            .then(function () { return paintExchanges(asset, (attempt || 0) + 1, page, append); });
        }
        if (!append) exNote(body, 'Recent exchanges are unavailable right now.');
        return 0;
      });
  }

  // xrpl.to's terms require a visible link wherever their data is shown, and this page had none at
  // all despite already rendering their prices. Same markup and same placement as the Trade page's.
  // Takes the container it should attach to, because the phone has no `#dxaExTable` — looking that
  // id up here meant the mobile panel rendered xrpl.to's data with NO attribution at all, which
  // their terms require wherever it is shown.
  function exAttribution(d, near) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var body = near || document.getElementById('dxaExTable');
    // FROM THE PARENT, not from the element itself. `closest` matches the node it starts on, and
    // the phone's container `#mdxaExList` IS a div — so searching from it returned the row list and
    // the attribution was appended as a 16th "row" inside the exchange feed.
    var from = (body && body.parentElement) || body;
    var host = from && from.closest ? from.closest('.panel, section, div') : null;
    if (!host) return;
    var p = el('p');
    p.id = 'lxx-attr-dxa';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Market data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // ---- Holders and Pools tabs ---------------------------------------------------------------------
  //
  // Both shipped as visible mock on a page about one XRP Ledger token:
  //   Holders — fifty rows of EVM wallets, "0x00…c3a1  3.14M  12.800%", with "Holders 12,408 /
  //             Top 10 hold 38.4% / Top 50 hold 67.2%" invented above them.
  //   Pools   — seven APTOS pools, "USDC / APT $4.85M 24.8%", "USDC / CELL", each with a live-looking
  //             "Add liquidity →", under four fabricated summary stats.
  // Neither was gated, so unlike the Exchanges tab these were not blank — they were wrong, and one
  // click away.
  //
  // Repainted on every tab click, not once: the design's own tab script rebuilds the holders table
  // when that tab is selected, so a single pass would be overwritten the moment someone switched away
  // and back. Same second-writer shape as the market table on /trade/xrpl.
  // `[class*="dxa-hl-stat"]` matches the phone's `.mdxa-hl-stat` too. The desktop-only selector is
  // why the mobile tabs kept "Holders 12,408 / Top 10 38.4%" against a real 22,008 / 20.8%.
  function statCells(root) { return $$('[class*="dxa-hl-stat"]', root || document); }

  function statByLabel(root, re) {
    var cells = statCells(root);
    for (var i = 0; i < cells.length; i++) {
      if (re.test((cells[i].textContent || '').trim())) return cells[i];
    }
    return null;
  }

  // ALL matching cells, not the first. Desktop and mobile each ship their own stat head and both are
  // in the DOM at once, so writing only the first left whichever layout came second on its mock.
  function setHlStat(re, value) {
    var cells = statCells(document);
    for (var i = 0; i < cells.length; i++) {
      if (!re.test((cells[i].textContent || '').trim())) continue;
      var v = cells[i].querySelector('.val') || cells[i].querySelector('.v') || cells[i].lastElementChild;
      if (!v || v === cells[i].firstElementChild) continue;
      v.textContent = value;
      v.classList.add('lxp');                            // the value gate, same family as the perf row
    }
  }

  function setTabCount(re, value) {
    var tabs = $$('.tabs-bar .tab');
    for (var i = 0; i < tabs.length; i++) {
      if (!re.test(tabs[i].textContent || '')) continue;
      var c = tabs[i].querySelector('.count') || tabs[i].querySelector('span:last-child');
      if (c) { c.textContent = value; c.classList.add('lxp'); }
      return;
    }
  }

  // Desktop builds a <table> inside #dxaPanel; the phone builds `.mdxa-hl-list`, a div of
  // `.mdxa-hl-row` cards. Returning either lets one painter fill both — without this the mobile
  // Holders tab kept FIFTY fabricated EVM wallets ("#1 0x0f…e007 3.14M 12.800%") one tap away.
  function holdersTable() {
    var tables = $$('#dxaPanel table');
    for (var i = 0; i < tables.length; i++) {
      if (/%\s*supply/i.test(tables[i].textContent) || /supply/i.test(
        ([].slice.call(tables[i].querySelectorAll('thead th')).map(function (t) { return t.textContent; }).join('|')))) {
        return tables[i].querySelector('tbody');
      }
    }
    return $('.mdxa-hl-list');
  }

  // The design builds each tab's table only when that tab is first ACTIVATED, so at page load the
  // Holders and Pools tables do not exist yet — but their tab counts do, hardcoded by the mock
  // ("Holders 12,408", "Pools 7"). Those two fabricated numbers are on screen before a visitor
  // clicks anything, so the counts have to load without the table. Each painter therefore runs in
  // two modes: count-only while the table is absent, then rows as well once the tab is opened.
  // These flags stop the count-only pass repeating on every tab click.
  var hlCounted = 0, plCounted = 0;

  // PAGES OF FIFTY (RAZA 2026-09-16: "On Trade-asset → Holders tab pagination not working"): the pager under the table asks
  // the rich list for the page it names.
  var HL_TPL = null, HL_PAGE = 1, HL_PER = 50;
  function holdersPager(d, body) {
    var ex = body.closest && body.closest('.dxa-tab-extra');
    var pg = ex && ex.querySelector('.dxa-hl-pgn');
    if (!pg) return;
    var total = d.total != null ? Math.round(d.total) : d.rows.length;
    var pages = Math.max(1, Math.ceil(total / HL_PER));
    var start = (HL_PAGE - 1) * HL_PER, cum = 0;
    d.rows.forEach(function (h) { if (h.holding != null) cum += +h.holding; });
    var info = pg.querySelector('.info');
    if (info) {
      info.textContent = 'Showing ' + (start + 1).toLocaleString('en-US') + '–' + (start + d.rows.length).toLocaleString('en-US')
        + ' of ' + total.toLocaleString('en-US') + ' holders' + (HL_PAGE === 1 ? (' · Cumulative ' + cum.toFixed(1) + '%') : '');
    }
    var box = pg.querySelector('.pgn');
    if (!box) return;
    box.innerHTML = '';
    function btn(label, to, active, disabled) {
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = label;
      x.setAttribute('data-logoed', '1');
      if (to) x.setAttribute('data-lxhpage', String(to));
      if (active) x.className = 'active';
      if (disabled) x.disabled = true;
      box.appendChild(x);
    }
    if (HL_PAGE > 1) btn('‹ Prev', HL_PAGE - 1);
    var nums = [1, 2, 3, HL_PAGE - 1, HL_PAGE, HL_PAGE + 1, pages]
      .filter(function (v, i, arr) { return v >= 1 && v <= pages && arr.indexOf(v) === i; })
      .sort(function (x, y) { return x - y; });
    var prev = 0;
    nums.forEach(function (v) {
      if (prev && v - prev > 1) btn('…', 0, false, true);
      btn(String(v), v, v === HL_PAGE);
      prev = v;
    });
    if (HL_PAGE < pages) btn('Next ›', HL_PAGE + 1);
    box.style.display = pages > 1 ? '' : 'none';
  }
  if (!window.__lxxHlPager) {
    window.__lxxHlPager = 1;
    window.addEventListener('click', function (e) {
      var bt = e.target && e.target.closest && e.target.closest('.dxa-hl-pgn .pgn button');
      if (!bt) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var to = parseInt(bt.getAttribute('data-lxhpage') || '', 10);
      if (!isFinite(to) || bt.disabled || !window.__lxxAssetRef) return;
      paintHolders(window.__lxxAssetRef, to);
    }, true);
  }

  function paintHolders(asset, page) {
    var body = holdersTable();
    if (!body && hlCounted && !page) return;                    // counts already in; nothing to paint
    if (body && body.getAttribute('data-lxh') === asset.code && !page) return;   // already ours for this token
    if (!HL_TPL && body && body.children.length && !body.getAttribute('data-lxh')) HL_TPL = body.children[0].cloneNode(true);
    var template = HL_TPL ? HL_TPL.cloneNode(true) : ((body && body.children.length) ? body.children[0].cloneNode(true) : null);
    hlCounted = 1;
    HL_PAGE = page || 1;
    var start = (HL_PAGE - 1) * HL_PER;

    fetch('/lxapi/xrplrichlist?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&n=50' + (start ? '&start=' + start : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.rows || !d.rows.length) { hlCounted = 0; return; }
        if (!template) return countsH(d);                       // table not built yet — counts only
        body.innerHTML = '';
        for (var i = 0; i < d.rows.length; i++) {
          var h = d.rows[i];
          var tr = template.cloneNode(true), td = tr.children;

          // `[class*=...]` throughout, so each lookup finds the desktop element or the phone's
          // `mdxa-` twin. An AMM pool holding the token is not a whale, and the upstream says which
          // is which.
          var who = h.amm ? 'AMM pool' : shortAddr(h.account);
          var bal = amount(h.balance);
          var pct = (h.holding == null ? '—' : h.holding.toFixed(3) + '%');

          var rank = tr.querySelector('[class*="dxa-hl-rank"]');
          // Desktop prints a bare number, the phone's mock prints "#1"; keep whichever shape the
          // template already had rather than restyling one of the two layouts.
          if (rank) {
            var n = String(h.rank || (start + i + 1));
            rank.textContent = /^\s*#/.test(rank.textContent || '') ? ('#' + n) : n;
          }

          var wa = tr.querySelector('.wa') || tr.querySelector('[class*="dxa-hl-addr"]');
          if (wa) wa.textContent = who;
          // EACH HOLDER'S OWN LINK AND MARK (RAZA 2026-09-15: "Cant click on holder list wallet address. Also all holders are
          // showing same identicon"). The row is a clone of the design's first mock row, so every copy kept that row's
          // href and identicon. A pool opens its pool page; everyone else opens their account.
          var accA = tr.querySelector('a.lx-acct') || tr.querySelector('.wallet-cell');
          if (accA) {
            // The desktop row's cell is a <div>; Stellar's is <a class="lx-acct wallet-cell">. Same children, made a link.
            if (accA.tagName !== 'A' && accA.parentNode) {
              var aa = document.createElement('a');
              aa.className = 'lx-acct wallet-cell';
              while (accA.firstChild) aa.appendChild(accA.firstChild);
              accA.parentNode.replaceChild(aa, accA);
              accA = aa;
            }
            accA.setAttribute('href', h.amm ? ('/pools/xrpl/id/' + encodeURIComponent(h.account)) : ('/account/xrpl/' + encodeURIComponent(h.account)));
            var mark0 = accA.querySelector('svg, img');
            var idc = document.createElement('span');
            idc.innerHTML = identSvg(h.account, 26);
            if (mark0 && mark0.parentNode) mark0.parentNode.replaceChild(idc.firstChild, mark0);
            else accA.insertBefore(idc.firstChild, accA.firstChild);
          }

          var balEl = tr.querySelector('[class*="dxa-hl-bal"]');
          var pctEl = tr.querySelector('[class*="dxa-hl-pct"]');
          if (balEl || pctEl) {
            if (balEl) balEl.textContent = bal;
            if (pctEl) pctEl.textContent = pct;
          } else {
            // Desktop's table row, where the two values are plain cells with no class of their own.
            if (td[2]) td[2].textContent = bal;
            if (td[3]) td[3].textContent = pct;
          }

          var link = tr.querySelector('[class*="dxa-hl-explorer"]');
          if (link) {
            link.setAttribute('href', 'https://bithomp.com/explorer/' + encodeURIComponent(h.account));
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener nofollow');
            link.setAttribute('aria-label', 'View on Explorer');
            link.setAttribute('title', 'View on Explorer');
            // Stellar's icon, not the words (RAZA 2026-09-15: "We are not using View on Explorer instead an icon").
            link.innerHTML = XPO;
          }

          body.appendChild(tr);
        }
        body.setAttribute('data-lxh', asset.code);
        var exHl = body.closest && body.closest('.dxa-tab-extra');
        if (exHl) exHl.classList.add('lxda');
        holdersPager(d, body);
        countsH(d);
      })
      .catch(function () { hlCounted = 0; });
  }

  var XPO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"></path><path d="M20 4l-8.5 8.5"></path><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path></svg>';

  // A 5x5 mirrored identicon drawn from the address, in the design's own palette and shape (a round svg).
  function identSvg(addr, size) {
    var pal = ['#6f5ded', '#ef4444', '#22c55e', '#a855f7', '#06b6d4', '#f59e0b', '#ec4899', '#84cc16', '#ff894c', '#0ea5e9', '#14b8a6', '#facc15'];
    var h = 2166136261, i;
    addr = String(addr || '');
    for (i = 0; i < addr.length; i++) { h ^= addr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var bg = pal[h % pal.length], fg = pal[(h >>> 7) % pal.length];
    if (fg === bg) fg = pal[(h % pal.length + 5) % pal.length];
    var c = size / 5, rects = '', bits = h;
    function rect(x, y) { return '<rect x="' + (x * c).toFixed(2) + '" y="' + (y * c).toFixed(2) + '" width="' + c.toFixed(2) + '" height="' + c.toFixed(2) + '" fill="' + fg + '"></rect>'; }
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        bits = Math.imul(bits ^ (x * 7 + y * 13 + 1), 2654435761) >>> 0;
        if ((bits >>> 13) & 1) { rects += rect(x, y); if (x < 2) rects += rect(4 - x, y); }
      }
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="border-radius:50%;background:' + bg
      + ';flex:0 0 ' + size + 'px" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }

  // The row-click layer inherited from Stellar takes clicks on list rows first; a holder's own link wins here.
  if (!window.__lxxHolderNav) {
    window.__lxxHolderNav = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#dxaPanel [class*="dxa-hl-explorer"]')) { e.stopImmediatePropagation(); return; }
      var a = t.closest('#dxaPanel a.lx-acct[href^="/"]');
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }

  function countsH(d) {
    if (d.total != null) setTabCount(/holders/i, Math.round(d.total).toLocaleString('en-US'));
    setHlStat(/^holders/i, d.total == null ? '—' : Math.round(d.total).toLocaleString('en-US'));
    setHlStat(/top\s*10/i, d.summary && d.summary.top10 != null ? d.summary.top10 + '%' : '—');
    setHlStat(/top\s*50/i, d.summary && d.summary.top50 != null ? d.summary.top50 + '%' : '—');
  }

  // A pool reserve's logo. XRP is the one token with no issuer, and xrpl.to gives it a fixed id
  // rather than a derived one — the same constant browser/trade.js uses. See
  // [[lumoscore-xrpl-wallet-logos]] for why the id is derived at the edge and not here.
  function thumbFor(s) {
    if (!s || !s.c || s.c === 'XRP') return '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(s.i || '')
      + '&cur=' + encodeURIComponent(s.c) + '&w=48';
  }

  function poolsTable() {
    var tables = $$('#dxaPanel table');
    for (var i = 0; i < tables.length; i++) {
      var head = [].slice.call(tables[i].querySelectorAll('thead th'))
        .map(function (t) { return t.textContent.trim().toLowerCase(); }).join('|');
      if (head.indexOf('tvl') >= 0 && (head.indexOf('apr') >= 0 || head.indexOf('lp holders') >= 0)) return tables[i].querySelector('tbody');
    }
    return $('.mdxa-pl-list');            // the phone's card list — see holdersTable()
  }

  // STELLAR'S POOLS TAB (RAZA 2026-09-15: remove "Add liquidity", "we dont have it on Stellar"). Read off
  // lumoscore.com: three stats — Active pools, Combined TVL, LP positions — over four columns — Pool, TVL,
  // LP holders, Pool share — with the whole row opening the pool. This tab had APR, 24h volume and an
  // "Add liquidity →" link per row, and its TVL / volume / share cells were never written at all: the
  // desktop row carries `.dxa-pl-apr`, which sent it down the phone branch, so every row kept the mock
  // "$4.85M · $980K · 62.4%".
  //
  // "Pool share" is each pool's share of this token's combined TVL, which is what Stellar's column adds up
  // to (65.1% + 16.4% + 7.3% …).
  function paintPools(asset) {
    var body = poolsTable();
    if (!body && plCounted) return;                             // see the note above paintHolders
    if (body && body.getAttribute('data-lxp') === asset.code) return;
    var template = (body && body.children.length) ? body.children[0].cloneNode(true) : null;
    var ours = currencyOf(asset.code);
    plCounted = 1;
    wirePoolRows();

    Promise.all([
      fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(asset.issuer)).then(function (r) { return r.json(); }),
      // Through the shared helper: it saves a good rate and falls back to the last one when the call
      // is refused. Without it a 429 dropped this tab's pool figures from dollars to raw XRP.
      (window.lxx && window.lxx.fetchUsd) ? window.lxx.fetchUsd(1).then(function (u) { return { ok: 1, usd: u }; })
        : fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (both) {
      var d = both[0], t = both[1];
      var usd = (t && t.ok && +t.usd > 0) ? +t.usd : null;
      if (!d || !d.ok || !d.rows) { plCounted = 0; return; }

      var mine = d.rows.filter(function (p) {
        return (p.a1 && p.a1.c === ours && p.a1.i === asset.issuer)
          || (p.a2 && p.a2.c === ours && p.a2.i === asset.issuer);
      }).sort(function (x, y) { return (y.liq || 0) - (x.liq || 0); });

      var tvl = 0, lps = 0;
      mine.forEach(function (p) { if (p.liq != null) tvl += p.liq; if (p.holders != null) lps += p.holders; });
      var money2 = function (x) { return (usd && x != null) ? ('$' + amount(x * usd)) : (amount(x) + ' XRP'); };

      if (template) {
        var table = body.closest ? body.closest('table') : null;
        if (table) {
          var ths = [].slice.call(table.querySelectorAll('thead th'));
          var WANT = ['Pool', 'TVL', 'LP holders', 'Pool share'];
          ths.forEach(function (th, k) {
            if (k < WANT.length) plain(th, WANT[k]);
            else if (th.parentNode) th.parentNode.removeChild(th);
          });
        }
        body.innerHTML = '';
      }

      for (var i = 0; template && i < mine.length; i++) {
        var p = mine[i];
        var tr = template.cloneNode(true), td = tr.children;
        var nameEl = tr.querySelector('[class*="dxa-pl-name"]') || tr.querySelector('[class*="dxa-pl-nm"]');
        var pair = curName(p.a1 && p.a1.c) + ' / ' + curName(p.a2 && p.a2.c);
        if (nameEl) nameEl.textContent = pair;
        else if (td[0]) td[0].textContent = pair;

        var slots = tr.querySelectorAll('.dxa-pl-ico, .mdxa-pl-ico');
        [p.a1, p.a2].forEach(function (side, si) {
          var slot = slots[si];
          if (!slot || !side) return;
          var im = slot.querySelector('img');
          if (!im) { im = document.createElement('img'); im.alt = ''; slot.appendChild(im); }
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
          im.src = thumbFor(side);
          im.onerror = function () { im.remove(); };
        });

        var share = tvl > 0 && p.liq != null ? ((p.liq / tvl) * 100).toFixed(1) + '%' : '—';
        var mTvl = tr.querySelector('.mdxa-pl-tvl');
        if (mTvl) {
          // The phone's card: TVL headline, and the pill that carried APR now carries the share.
          mTvl.textContent = money2(p.liq);
          var mApr = tr.querySelector('.mdxa-pl-apr');
          if (mApr) plain(mApr, share);
          var pill = tr.querySelector('.net-pill');
          if (pill) { pill.className = 'net-pill xrpl'; plain(pill, 'XRP Ledger'); }
        } else {
          if (td[1]) { td[1].className = 'mono'; td[1].textContent = money2(p.liq); }
          if (td[2]) { td[2].className = 'mono'; td[2].textContent = p.holders != null ? Math.round(p.holders).toLocaleString('en-US') : '—'; }
          if (td[3]) { td[3].className = 'mono'; td[3].textContent = share; }
          while (tr.children.length > 4) tr.removeChild(tr.lastElementChild);
          tr.className = 'dxa-pl-row';
        }
        tr.setAttribute('data-lxpool', p.acct);
        tr.style.cursor = 'pointer';
        body.appendChild(tr);
      }
      if (template) {
        body.setAttribute('data-lxp', asset.code);
        var exPl = body.closest && body.closest('.dxa-tab-extra');
        if (exPl) exPl.classList.add('lxda');
      }

      var capped = (d.count >= 100);
      var label = String(mine.length);
      if (capped) {
        label = (d.total != null && d.total >= mine.length && mine.length === d.count)
          ? String(d.total) : (mine.length + '+');
      }
      var more = capped ? '+' : '';
      setTabCount(/pools/i, label);
      setHlStat(/^(active\s+)?pools/i, label);
      setHlStat(/^(combined\s+)?tvl/i, money2(tvl) + more);
      // The design's third and fourth stats were 24h volume and average APR; Stellar's third is LP
      // positions and it has no fourth.
      statCells(document).forEach(function (cell) {
        var txt = (cell.textContent || '').trim();
        if (/^24h vol/i.test(txt) || /^lp positions/i.test(txt)) {
          var lb = cell.querySelector('.lbl') || cell.firstElementChild;
          var v = cell.querySelector('.val') || cell.querySelector('.v') || cell.lastElementChild;
          if (lb) plain(lb, 'LP positions');
          if (v && v !== lb) { plain(v, Math.round(lps).toLocaleString('en-US') + more); v.classList.add('lxp'); }
        } else if (/^avg apr/i.test(txt) && cell.parentNode) {
          cell.parentNode.removeChild(cell);
        }
      });
    }).catch(function () {});
  }

  // A pool row opens its pool, as Stellar's does. Window capture, like every row on these pages.
  function wirePoolRows() {
    if (window.__lxxDxaPoolRows) return;
    window.__lxxDxaPoolRows = 1;
    window.addEventListener('click', function (e) {
      var tr = e.target && e.target.closest ? e.target.closest('[data-lxpool]') : null;
      if (!tr) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-lxpool'));
    }, true);
  }

  function wireTabs(asset) {
    if (window.__lxxDxaTabs) return;
    window.__lxxDxaTabs = 1;
    $$('.tabs-bar .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        // After the design's own handler has swapped the panel.
        [80, 300, 900].forEach(function (ms) {
          setTimeout(function () { paintHolders(asset); paintPools(asset); }, ms);
        });
      });
    });
  }

  // ---- identity ---------------------------------------------------------------------------------
  // ---- copying the issuer ---------------------------------------------------------------------------
  //
  // THE CHIP HELD THE ADDRESS AND NOTHING COPIED IT. `data-copy` is filled in below, but the handler
  // that reads it lived in Stellar's `lx-dxadata`, which this build strips whole — so a click did
  // nothing and said nothing (RAZA 2026-09-15). lumoscore.com copies on a click anywhere on the chip
  // and shows its bottom-centre "Copied to clipboard" toast.
  //
  // The toast is Stellar's own `.lx-ctoast` — class names and styling taken from `lx-chipcopy`, which
  // produces the one in RAZA's screenshot — so it is the same element, not a lookalike. Window capture,
  // because the design routes clicks on this card through handlers of its own.
  function copyToast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16);animation:lxCtIn .25s ease}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}'
        + '@keyframes lxCtIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.innerHTML = '<span class="ci"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span></span>';
    t.lastChild.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s ease,transform .25s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 1800);
  }

  function wireIssuerCopy() {
    if (window.__lxxIssuerCopy) return;
    window.__lxxIssuerCopy = 1;
    window.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.addr[data-copy]') : null;
      if (!chip || !chip.closest('.item, .asset-meta, .asset-id')) return;
      var text = chip.getAttribute('data-copy') || '';
      if (!window.lxx.isAddress(text)) return;                // only ever an r-address, never mock
      e.preventDefault();
      e.stopImmediatePropagation();
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
        else fallback();
      } catch (err) { fallback(); }
      copyToast('Copied to clipboard');
    }, true);
  }

  // The curated roster, fetched once per page and shared by every caller. A rejected fetch does not
  // settle the answer — the promise is dropped so the next caller asks again rather than inheriting
  // "nothing is verified" from one lost request.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CURATED = null;
  function curatedSet() {
    if (CURATED) return CURATED;
    CURATED = fetch('/lxapi/xrpltokens?n=100')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var s = {};
        [].forEach.call((j && j.rows) || [], function (x) {
          if (x && x.i && x.c) s[x.i + '|' + String(x.c).toUpperCase()] = 1;
        });
        return s;
      })
      .catch(function () { CURATED = null; return {}; });
    return CURATED;
  }

  function paintHeader(asset, d) {
    var h1 = $('h1.asset-name') || $('.asset-name');
    if (h1) {
      h1.textContent = asset.code;
      // THE VERIFIED TICK (RAZA 2026-09-16: "Also add verification tick for LUMOS on all other places where it should be.
      // eg: Trade-Asset, Wallet, Search"; 2026-10-06: "Verification tick is also not showing on Trade-Asset page", with
      // PHNIX on screen).
      //
      // It decided on xrpl.to's `vf`, which is 0 for PHNIX, for ARMY and for most of the roster — so the tick appeared on
      // LUMOS and almost nowhere else, while the Trade table one click away ticks all hundred rows it lists. Now the same
      // rule as that table, the wallet and the search panel: membership of /lxapi/xrpltokens, LUMOS pinned, with `vf`
      // still counting on top. The caveat recorded in trade.js — the roster is ranked by volume, not vetted — holds here
      // too and is not re-argued.
      //
      // ASYNC, so the roster is awaited rather than raced: this header paints as soon as the asset is known, long before
      // a hundred-row list has been fetched. The tick is appended when the answer arrives.
      var vtick = function () {
        var vt = el('span', 'lx-vtick');
        vt.title = 'Verified issuer';
        vt.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:9px;'
          + 'border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
        vt.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        if (!h1.querySelector('.lx-vtick')) h1.appendChild(vt);
      };
      if (d && (d.verified || d.vf || asset.issuer === LUMOS_ISS)) vtick();
      else curatedSet().then(function (s) {
        var cur = '';
        try { cur = window.lxx.encodeCurrency(asset.code) || ''; } catch (e) {}
        if (s[asset.issuer + '|' + String(cur).toUpperCase()]) vtick();
      });
    }

    // The title was being rewritten at runtime to the Stellar token's. Say what this page is.
    try {
      document.title = asset.code + (d && d.user ? ' by ' + d.user : '')
        + ' — price, order book and holders on the XRP Ledger | LumosCore';
    } catch (e) {}

    // THE ISSUER CARD WAS A DIFFERENT CHAIN'S ACCOUNT ENTIRELY.
    //
    // The design ships it filled in, and nothing here ever overwrote it, so every token page showed
    //     Issuer  0x040…f072      website  circle.com
    // — an EVM-style address (the full 64-hex hash was sitting in data-copy, so the COPY BUTTON
    // handed you it) beside Circle's domain, on a page whose issuer is an r-address. That is what
    // "the page is not loading" looked like: the shell renders, and the identity panel is somebody
    // else's.
    // THE PHONE PUTS IT SOMEWHERE ELSE: `.asset-meta .addr`, not `.item .addr`. So everything the
    // comment above describes was still true on mobile long after desktop was fixed — "ISSUER
    // 0x0b59…1756" under the token's name, with the full 64-hex string in `data-copy` so the copy
    // button handed it over. Found in a SCREENSHOT; every DOM check I ran looked at the desktop
    // element and reported it correct.
    var addrEl = $('.item .addr') || $('.asset-meta .addr') || $('.asset-id .addr');
    if (addrEl) {
      addrEl.setAttribute('data-copy', asset.issuer);
      addrEl.setAttribute('data-copy-label', asset.code + ' issuer');
      // Only the text node is replaced, so the design's copy icon stays where it is.
      var wrote = false;
      [].forEach.call(addrEl.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) {
          n.nodeValue = ' ' + shortAddr(asset.issuer);
          wrote = true;
        }
      });
      if (!wrote) addrEl.appendChild(document.createTextNode(' ' + shortAddr(asset.issuer)));
      wireIssuerCopy();
    }

    // The website is the issuer's own domain when xrpl.to has one. It is NOT guessed from anything:
    // an unverified issuer with no domain gets the row removed rather than a plausible-looking
    // link, because a wrong domain on a token page is how someone ends up on a phishing site.
    var web = $('.website');
    if (web) {
      var dom = rootDomain(d && d.domain);
      // LUMOS's home is lumoscore.com (RAZA 2026-09-16), whatever its issuer's older Domain field says.
      if (asset.issuer === 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha') dom = 'lumoscore.com';
      var txt = false;
      [].forEach.call(web.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = dom ? (' ' + dom) : ''; txt = true; }
      });
      if (!txt && dom) web.appendChild(document.createTextNode(' ' + dom));
      web.style.display = dom ? '' : 'none';

      // AND IT IS A LINK (RAZA 2026-09-17: "Homedomain is unclickable"). The design ships `<a class="website" href="#">`
      // with a "Visit homedomain" tooltip, and only the TEXT was ever replaced — so the tooltip promised a visit and the
      // href went nowhere. `rootDomain()` above has already refused anything that is not a bare hostname (no scheme, no
      // path, no port), which is what makes it safe to build a URL from: every issuer domain on this ledger is a string an
      // anonymous account chose ([[lumoscore-xrpl-hostile-input]]). New tab, and no referrer or ranking passed to it.
      if (web.tagName === 'A') {
        if (dom) {
          web.setAttribute('href', 'https://' + dom);
          web.setAttribute('target', '_blank');
          web.setAttribute('rel', 'noopener noreferrer nofollow');
        } else {
          web.setAttribute('href', '#');
        }
      }
    }

    paintLogo(asset, d);
    paintLabels(asset);
  }

  // THE TOKEN'S LOGO WAS A BLANK GREY SQUARE ON EVERY PAGE.
  //
  // The design ships `<div class="asset-logo" data-lxc=""></div>` — an empty 64px box whose only
  // fill was a hardcoded USDC-blue gradient in CSS. `data-lxc` is the logo painter's OPT-OUT marker
  // (the same one `.lxad-logo` uses to defend itself), so the healer that fills every other icon on
  // the site skips this element BY DESIGN — and the design's own filler was never carried into the
  // fork. Nothing painted it, nothing errored, and the box measured a healthy 64x64 the whole time.
  //
  // The id is xrpl.to's md5, which /lxapi/xrpltoken already returns; `iss`+`cur` is the fallback for
  // the first paint, before that response lands (the endpoint derives the same md5 server-side).
  // Either way it goes through /lxapi/xrplthumb — the thumbnail endpoint needs the API key, and the
  // key must not reach the browser. See [[lumoscore-xrpl-wallet-logos]].
  function paintLogo(asset, d) {
    var box = $('.asset-logo');
    if (!box || box.getAttribute('data-lxlogo') === asset.code) return;

    var md5 = (d && /^[0-9a-f]{32}$/i.test(d.md5 || '')) ? d.md5 : '';
    var src = md5
      ? ('/lxapi/xrplthumb?id=' + md5 + '&w=64')
      : ('/lxapi/xrplthumb?iss=' + encodeURIComponent(asset.issuer)
         + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&w=64');

    var img = document.createElement('img');
    img.alt = ''; img.width = 64; img.height = 64;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';

    // A token with no logo upstream answers 404. Initials are the honest fallback; a broken-image
    // glyph is not, and neither is the USDC gradient sitting under a token that is not USDC.
    img.onerror = function () {
      box.innerHTML = '';
      box.textContent = String(asset.code || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      box.style.backgroundImage = 'none';
      box.style.backgroundColor = 'rgba(255,255,255,.10)';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.fontWeight = '800';
      box.style.fontSize = '18px';
      box.style.color = '#fff';
      // We just wrote 3 characters into a small empty box — the exact shape the logo healer hunts.
      // data-logoed is its own skip marker. See [[lumoscore-logo-healer]].
      box.setAttribute('data-logoed', '1');
    };

    box.setAttribute('data-lxlogo', asset.code);
    box.innerHTML = '';
    // The logo is also the box's background (under the img): the review dialog reads this page's own token mark off
    // .asset-logo's background-image, and "none" gave it an empty circle (RAZA 2026-09-16: "[Still not appearing] There's no
    // logo showing up for ATOM when im buying it (review step)").
    box.style.backgroundImage = 'url("' + src + '")';
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.appendChild(img);
    img.src = src;
  }

  function shortAddr(a) {
    return (a && a.length > 14) ? (a.slice(0, 6) + '…' + a.slice(-4)) : (a || '');
  }

  // THE TRADE PANEL WAS NAMING THE WRONG TOKEN ENTIRELY. On the RLUSD page it read "Buy USDC" /
  // "Sell USDC", with "APT" on the pay side and "USDC" on the receive side, beside a holder filter
  // offering "10+ XLM / 100+ XLM / 1000+ XLM" and a pair label reading "LUMOS / XLM".
  //
  // Every one of those is the design's mock, and every one is a different chain's asset. The left of
  // the page was correct — real price, real order book, real stats — which is what made this easy to
  // walk past: the panel people actually trade in was the part still describing Aptos and Stellar.
  //
  // These are LABELS, not data: the panel's behaviour is unchanged, it is told which token it is on.
  function paintLabels(asset) {
    var code = asset.code;

    // Buy / Sell buttons name the token being traded, not the quote asset. Substring selector for
    // the same reason as the chips below: the phone's are `.mdxa-side-btn`.
    $$('[class*="dxa-side-btn"]').forEach(function (b) {
      var sell = b.classList.contains('sell');
      // Written as a text node so the button keeps whatever the design put inside it.
      var t = (sell ? 'Sell ' : 'Buy ') + code;
      if (b.textContent.trim() !== t) b.textContent = t;
    });

    // The two asset chips are the pay side and the receive side, and which is which flips with
    // Buy/Sell: buying spends XRP to get the token, selling spends the token to get XRP.
    //
    // Scoped PER CARD rather than by a global index. The page carries more than one trade card (the
    // desktop panel and the phone's), so indexing every .dxa-trade-asset on the page would read the
    // Buy/Sell state of one card and apply it to the other — and with only one card visible at a
    // time, the wrong one is the one nobody would notice was wrong.
    // THE PHONE PREFIXES THESE CLASSES, so every desktop selector here matched nothing on mobile
    // and the pay-side chip kept reading "APT" under "You pay" — on the panel someone trades in.
    // Measured at 375px: `.dxa-trade-card` absent, `.dxa-trade-asset` count 0, and the real element
    // is `.mdxa-trade-asset` inside `.mdxa-pane-swap`.
    //
    // `[class*="dxa-trade-asset"]` matches BOTH, because "mdxa-trade-asset" contains the desktop
    // name as a substring — the phone's naming is the desktop's with a letter in front, so one
    // selector covers the pair instead of two lists that drift apart.
    var cards = $$('.dxa-trade-card');
    if (!cards.length) cards = $$('.mdxa-pane-swap');
    if (!cards.length) cards = [document];
    cards.forEach(function (card) {
      var sellActive = !!card.querySelector('[class*="dxa-side-btn"].sell.active');
      var order = sellActive ? [code, 'XRP'] : ['XRP', code];
      $$('[class*="dxa-trade-asset"]', card).forEach(function (c, i) {
        if (i > 1) return;
        // data-logoed keeps the logo layer from eating a 1-5 character ticker.
        try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); c.style.background = ''; } catch (e) {}
        // THE MARK BESIDE THE TICKER, as lumoscore.com draws it (RAZA 2026-09-15: "the you pay and you
        // receive asset logos are missing") — a `.dxa-trade-ic` inside the chip, painted from the token's
        // own logo. The phone's chips are drawn in CSS by lx-mobtrade, so they keep plain text.
        // The phone draws its chips in CSS: lx-mobtrade stamps `data-lxmt-code="XLM"` and an XLM mark on
        // every one, and its ::after label wins over the text. limit.js's stylesheet already lets
        // `[data-lxxc]` and `--lxx-logo` override that, so the swap chips carry the same two.
        if (/(^|\s)mdxa-/.test(c.className)) {
          c.textContent = order[i];
          c.setAttribute('data-lxxc', order[i]);
          c.style.setProperty('--lxx-logo', 'url("' + thumbFor(order[i] === 'XRP' ? null : { c: currencyOf(asset.code), i: asset.issuer }) + '")');
          return;
        }
        var logo = thumbFor(order[i] === 'XRP' ? null : { c: currencyOf(asset.code), i: asset.issuer });
        c.__lxxChip = { code: order[i], logo: logo };
        paintSwapChip(c);
        // THE RECEIVE CHIP WAS REPAINTED AFTER THIS (RAZA 2026-09-15: "the logo of atom in you receive is too tiny"):
        // another painter rewrote it to the bare ticker with a generic ATOM icon as an 18x13 background on the chip
        // itself. The chip is watched and rebuilt whenever it loses its mark, at most thirty times.
        if (!c.__lxxChipObs && window.MutationObserver) {
          var n = 0;
          c.__lxxChipObs = new MutationObserver(function () {
            if (n > 30) return;
            var ok = c.querySelector('.dxa-trade-ic') && !c.style.backgroundImage;
            if (!ok) { n++; paintSwapChip(c); }
          });
          c.__lxxChipObs.observe(c, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        }
      });
    });

    // THE PROMOTED CARD IS LUMOS'S AD ON EVERY PAGE (RAZA 2026-09-15: "its supposed to show LUMOS/XRP instead of SLT/XRP.
    // Also link View LUMOS button to LUMOS token page on XRPL"). It named the page's own token, and its link was the
    // Stellar LUMOS page, with data-adself set everywhere (the design reads "LUMOS" off a query string this site does not
    // use), so the button only scrolled.
    $$('.lxad-pair').forEach(function (p) {
      if (p.getAttribute('data-lxad') === '1') return;
      p.setAttribute('data-lxad', '1');
      p.textContent = 'LUMOS / XRP ';
      var vt = document.createElement('span');
      vt.className = 'lx-vtick';
      vt.title = 'Verified issuer';
      vt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      p.appendChild(vt);
    });
    $$('.lxad').forEach(function (ad) { ad.setAttribute('data-href', '/lumos/xrpl'); ad.removeAttribute('data-adself'); });

    // Holder-size filters are denominated in the quote asset.
    $$('.chip').forEach(function (c) {
      var t = (c.textContent || '');
      if (/\bXLM\b/.test(t)) c.textContent = t.replace(/\bXLM\b/g, 'XRP');
    });
  }

  function paintSwapChip(c) {
    var s = c.__lxxChip;
    if (!s) return;
    c.style.background = '';
    c.removeAttribute('data-logo');
    c.setAttribute('data-logoed', '1');
    c.textContent = '';
    var ic = el('span', 'dxa-trade-ic');
    ic.setAttribute('data-logoed', '1');
    ic.setAttribute('data-lxfixed', '1');
    // The container's logo engine skips an element that holds a [data-logo] child; with none, it took the chip's
    // " ATOM " for a ticker slot, stamped data-logo="ATOM" and redrew it forever as a generic 18x13 mark. An empty
    // value names no logo, so the engine never paints the mark itself (the snapshot button uses the same escape).
    ic.setAttribute('data-logo', '');
    ic.style.cssText = 'background:url("' + s.logo
      + '") center center / cover no-repeat transparent;box-shadow:none;border-radius:50%';   // cover: a padded logo read as a dot
    // The review dialog (lx-feemodal) reads a leg's mark from --lxtic first (RAZA 2026-09-15: "There's no logo showing up for
    // ATOM when im buying it (review step)").
    ic.style.setProperty('--lxtic', 'url("' + s.logo + '")');
    c.appendChild(ic);
    c.appendChild(document.createTextNode(' ' + s.code + ' '));
  }

  // The Buy/Sell toggle is the design's own, so the chips are re-labelled whenever it changes rather
  // than only on load — otherwise switching to Sell leaves the pay side still saying XRP.
  function watchSide(asset) {
    if (window.__lxxSideWatch) return;
    window.__lxxSideWatch = 1;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[class*="dxa-side-btn"]');
      if (!b) return;
      setTimeout(function () { paintLabels(asset); }, 0);   // after the design flips .active
    }, true);
  }

  // THE BOOK'S HEADINGS AND SPREAD STILL NAMED ANOTHER CHAIN (RAZA 2026-09-15: "its showing APT instead
  // of XRPL and USDC instead of RLUSD"). "Price (APT) · Amount (USDC)" and "Spread 0.0024 APT (0.06%)"
  // were the design's, over a real book. Depth is the running total of the TOKEN on this side, so it is
  // labelled in the token rather than copying Stellar's "Depth (XLM)".
  function paintBookHead(asset, b) {
    $$('.dxa-ob-head, .mdxa-ob-head').forEach(function (h) {
      var sp = h.querySelectorAll('span');
      if (sp[0]) plain(sp[0], 'Price (XRP)');
      if (sp[1]) plain(sp[1], 'Amount (' + asset.code + ')');
      if (sp[2]) plain(sp[2], 'Depth (' + asset.code + ')');
    });
    var ask = b && b.asks[0] ? b.asks[0].px : null, bid = b && b.bids[0] ? b.bids[0].px : null;
    $$('.dxa-ob-spread, .mdxa-ob-spread').forEach(function (s) {
      var sp = s.querySelectorAll('span');
      if (ask && bid) {
        var diff = ask - bid, mid = (ask + bid) / 2;
        if (sp[1]) plain(sp[1], xrp(diff, 4) + ' XRP');
        if (sp[2]) plain(sp[2], '(' + (diff / mid * 100).toFixed(2) + '%)');
      } else {
        if (sp[1]) plain(sp[1], '—');
        if (sp[2]) plain(sp[2], '');
      }
    });
  }

  // The phone's exchange rows are cards, not table rows, so they carry the hash instead of a link.
  function wireTxLinks() {
    if (window.__lxxTxLinks) return;
    window.__lxxTxLinks = 1;
    window.addEventListener('click', function (e) {
      var r = e.target && e.target.closest ? e.target.closest('[data-lxtx]') : null;
      if (!r || (e.target.closest && e.target.closest('a'))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.open('https://bithomp.com/explorer/' + encodeURIComponent(r.getAttribute('data-lxtx')), '_blank', 'noopener');
    }, true);
  }

  function note(text) {
    var a = $('#dxaObAsks') || $('#mdxaObAsks');
    var b = $('#dxaObBids') || $('#mdxaObBids');
    [a, b].forEach(function (n) {
      if (!n) return;
      n.innerHTML = '';
      var d = el('div', 'dxa-ob-row', text);
      d.style.cssText = 'opacity:.65;justify-content:center';
      n.appendChild(d);
    });
  }

  // THE SWAP PANEL IS THE DESIGN'S, AND NOTHING IN THIS LAYER EVER WIRED IT.
  //
  // What it was showing, live, under an XRP Ledger heading — every value the template's Aptos mock:
  //     Rate          1 APT = 0.23659 USDC
  //     Min received  23.541 USDC
  //     Network fee   0.00001 APT
  // with the pay and receive boxes pre-filled 100 and 23.659. A trading panel quoting a rate for
  // the wrong chain, from numbers nobody computed, is the worst thing that was left on this page:
  // it does not look like placeholder text.
  //
  // Treated the same way as Create Pool, on RAZA's call: state what we actually know, em-dash what
  // we do not, empty the invented amounts, and disable the action with a label that says why.
  // Building a real quote — pricing against the order book, slippage, price impact — is a feature,
  // and this build has never round-tripped a signature.
  //
  // Deliberately NOT touched: "Slippage tolerance" is a user setting rather than a quote, and the
  // trading-fee row is owned by the fee layer and already reads correctly.
  function setSumRow(label, value) {
    var rows = $$('.dxa-tsum-row');
    for (var i = 0; i < rows.length; i++) {
      var kids = rows[i].children;
      if (kids.length < 2) continue;
      if ((kids[0].textContent || '').trim().toLowerCase() !== label) continue;
      kids[kids.length - 1].textContent = value;
    }
  }

  // TWO BLOCKS THAT EXIST ONLY ON THE PHONE, and neither was ever painted.
  //
  // Found by re-checking today's trade-asset work at 375px rather than trusting the desktop pass:
  //
  //   * `.ohlc-strip` — "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT". Four fabricated prices in
  //     another chain's asset, across the top of the chart. There is no desktop equivalent, which is
  //     exactly why it survived.
  //   * `.asset-description` — 251 characters describing USD Coin and Circle, shown on the RLUSD
  //     page. Not merely the wrong chain: the wrong company's prose under someone else's token.
  //
  // Both are BLANKED rather than invented. /lxapi/xrpltoken carries no open/close and no description
  // — the fields simply are not in the payload — so there is nothing honest to put there. An em dash
  // says "not known"; leaving the design's text says something false and specific.
  function paintMobileOnly() {
    // The strip ships "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT" — another chain's asset,
    // four fabricated prices. Dashed here so that is never what a reader sees, then filled with the
    // real O/H/L/C/Δ/Vol by paintOhlcStrip() as soon as the chart's candles land. If the chart feed
    // fails, the dashes are the correct final state and stay.
    var strip = $('.ohlc-strip');
    if (strip) {
      $$('.v', strip).forEach(function (v) { v.textContent = '—'; });
    }

    paintDescription();
  }

  // THE DESCRIPTION SLOT, AND WHY IT IS USUALLY EMPTY.
  //
  // `.asset-description` ships with 251 characters about USD Coin and Circle — the wrong company's
  // prose under someone else's token — so it cannot simply be left alone. It used to be deleted
  // outright. It is now filled when, and only when, we actually know the token.
  //
  // TWO SOURCES, IN THIS ORDER:
  //
  //   1. `__lxTokenRegistry[CODE-ISSUER].desc` — our own launchpad's mints, where the creator wrote
  //      the text through our form. We control it, so it wins.
  //   2. /lxapi/xrplmeta — XRPLMeta, the XRP Ledger's metadata service, which aggregates the
  //      issuer-published metadata and has descriptions for blue-chips and meme tokens alike.
  //
  // This used to remove the paragraph outright, on the conclusion that no description source
  // existed. Two of the three facts behind that were right — /lxapi/xrpltoken carries no
  // description (130+ fields, none of them one), and ripple.com publishes no [[TOKENS]] block in
  // its `xrp-ledger.toml` — but the conclusion was wrong: XRPLMeta is exactly the service that
  // aggregates what those two checks were looking for. See [[lumoscore-asset-descriptions]].
  //
  // HIDDEN FIRST, NOT REMOVED. The paragraph ships with 251 characters about USD Coin and Circle,
  // so it cannot be left visible for the length of a fetch — but removing it means there is nothing
  // left to fill. So it is hidden immediately and then either filled or removed, which shows the
  // mock to nobody and still leaves no empty gap for a token that has no description.
  //
  // The text is ATTACKER-CONTROLLED — anyone can issue a token and publish metadata for it — so it
  // goes in through plain(), which is textContent, never innerHTML. The edge caps and normalises it.
  function paintDescription() {
    var desc = $('.asset-description');
    if (!desc) return;
    var a = window.__lxxAssetRef || null;

    var reg = window.__lxTokenRegistry || {};
    var row = a ? reg[a.code + '-' + a.issuer] : null;
    var own = row && typeof row.desc === 'string' ? row.desc.trim() : '';
    if (own) { show(desc, own); return; }

    desc.style.display = 'none';                       // the mock is never on screen
    if (!a) { drop(desc); return; }
    // RAZA 2026-09-16: "Its taking too long for the asset description to load. It appears after a couple seconds." XRPLMeta
    // can take seconds; a description read once is kept in this browser for a week, shown at once, and refreshed daily.
    var ck = 'lumos.xdesc.' + a.issuer + '-' + currencyOf(a.code), cached = null;
    try { cached = JSON.parse(localStorage.getItem(ck) || 'null'); } catch (e) {}
    if (cached && typeof cached.d === 'string' && Date.now() - cached.t < 7 * 864e5) {
      show(desc, cached.d || generic());
      if (Date.now() - cached.t < 864e5) return;
    }

    // STRAIGHT FROM XRPLMETA TOO (RAZA 2026-09-16: "[Still taking too long]"). Measured: the edge's request to XRPLMeta hangs
    // until its 12s abort while the same URL answers a browser in 0.8s, and XRPLMeta serves CORS to any origin. The browser asks it
    // directly as well; whichever answers first fills the paragraph. The text is still written as plain text only.
    fetch('https://s1.xrplmeta.org/token/' + encodeURIComponent(currencyOf(a.code) + ':' + a.issuer))
      .then(function (r) { return r.status === 404 ? { meta: { token: {} } } : r.json(); })
      .then(function (j) {
        var t = (j && j.meta && j.meta.token) || {};
        var txt = String(t.desc || '').replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (txt.length > 600) txt = txt.slice(0, 600).replace(/\s+\S*$/, '') + '…';
        try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: txt })); } catch (e) {}
        show(desc, txt || generic());
      }, function () {});
    fetch('/lxapi/xrplmeta?iss=' + encodeURIComponent(a.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(a.code)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: d.desc || '' })); } catch (e) {} }
        if (d && d.ok && d.desc) show(desc, d.desc);
        else show(desc, generic());
      })
      .catch(function () { show(desc, generic()); });

    // STELLAR'S LINE FOR A TOKEN WITH NO DESCRIPTION (RAZA 2026-09-15: "If the asset of trade-Asset page doesnt have
    // description, then just place a static description just like we did on Stellar. Otherwise ... it shows blank space").
    function generic() {
      return a.code + ' trades on the LumosCore DEX against XRP on the XRP Ledger. Live price, order book, trades and holders are pulled directly from the XRP Ledger.';
    }

    function show(el, text) { plain(el, text); el.style.display = ''; }
    function drop(el) { if (el.parentNode) el.parentNode.removeChild(el); }
  }


  function load() {
    var asks = $('#dxaObAsks') || $('#mdxaObAsks');
    if (!asks) return;                                  // not this page

    var asset = fromUrl();
    if (!asset) { note('No token in this address.'); return; }
    window.__lxxAssetRef = asset;              // paintDescription() reads the registry by CODE-ISSUER

    lift();
    note('Reading the XRP Ledger…');

    // The panel's labels do not depend on the stats feed, so they are set from the URL's asset right
    // away and re-set when the Buy/Sell toggle moves. A failing feed must not leave the trade panel
    // naming another chain's token.
    paintLabels(asset);
    watchSide(asset);

    // BEFORE the feeds, not after. These rows carry another chain's numbers until something
    // overwrites them, so the window between load and the first response is exactly when a reader
    // would see "1 APT = 0.23659 USDC". The rate is filled in below once a real price arrives.
    paintMobileOnly();
    wireTxLinks();

    // Details and book are independent: a token with no market still has an identity, and a book
    // is still a book if the stats feed is down. One failing must not blank the other.
    fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(asset.issuer + '-' + currencyOf(asset.code)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.__lxxAssetData = (d && d.ok) ? d : null;
        // WHY it is missing, recorded alongside the fact that it is. The endpoint says "upstream 404"
        // only when the feed has genuinely never heard of the token; anything else — a refusal, a
        // rate limit, a dropped connection — is an outage and must not be reported as the token
        // having no market. See noMarketNote.
        window.__lxxAssetMiss = (d && d.ok) ? null
          : (/404/.test(String((d && d.error) || '')) ? 'none' : 'down');
        try { window.dispatchEvent(new CustomEvent('lxx:assetdata')); } catch (e) {}
        paintHeader(asset, window.__lxxAssetData);
        paintStats(window.__lxxAssetData);
        liftIdentity();
        paintPerf(window.__lxxAssetData);
        loadLongPerf(asset);
        chartControls(asset);
        loadChart(asset, '1D');
        wireChartRanges(asset);
        paintExchanges(asset);
        paintHolders(asset);
        paintPools(asset);
        wireTabs(asset);
        // The one quote figure that is real: the page's own live price, same source as the header.
        // `price`, not `p` — the payload names it in full, and reading the wrong key here would
        // have left the rate on an em dash while looking like it had been wired.
        var p = window.__lxxAssetData && window.__lxxAssetData.price;
        if (p != null && isFinite(p)) {
          setSumRow('rate', '1 ' + asset.code + ' = ' + xrp(p) + ' XRP');
        }
      })
      .catch(function () { paintHeader(asset, null); paintStats(null); liftIdentity(); });

    // Named and exposed so the Limit tab (browser/limit.js) can show an order it has just placed
    // without reloading the page. Same read, same painters — one way the book gets drawn.
    window.__lxxBookReload = function () {
      return book(asset).then(function (b) {
        window.__lxxBook = b;
        paintBook($('#dxaObAsks') || $('#mdxaObAsks'), b.asks, 'ask');
        paintBook($('#dxaObBids') || $('#mdxaObBids'), b.bids, 'bid');
        paintBookHead(asset, b);
        try { window.dispatchEvent(new CustomEvent('lxx:book')); } catch (e) {}
      });
    };
    window.__lxxBookReload().catch(function () {
      note('Could not read the order book.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAssetReload = load;
})();
