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

  function xrp(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v < 0.000001) return v.toExponential(2);
    if (v < 1) return v.toPrecision(dp || 5);
    return v.toLocaleString('en-US', { maximumFractionDigits: dp || 4 });
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // ---- the token in the URL --------------------------------------------------------------------
  // /xrpl/trade/<CODE>-<ISSUER>. The code may itself contain a dash, so split on the LAST one --
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
  function lift() {
    var sels = ['#dxaObAsks', '#dxaObBids', '#mdxaObAsks', '#mdxaObBids', '.stat-row',
      '.dxa-stat-row', '.mdxa-stat-row'];
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('lxda');
    }
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

  function cellByLabel(name) {
    var cells = document.querySelectorAll('.stat-cell');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.lbl');
      if (l && l.textContent.trim().toLowerCase() === name) return cells[i];
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

  function paintStats(d) {
    if (!d) {
      ['price', '24h change', '24h volume', 'market cap', 'liquidity', 'supply']
        .forEach(function (n) { setCell(n, null, '', ''); });
      return;
    }
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

  // ---- identity ---------------------------------------------------------------------------------
  function paintHeader(asset, d) {
    var h1 = $('h1.asset-name') || $('.asset-name');
    if (h1) h1.textContent = asset.code;

    // The title was being rewritten at runtime to the Stellar token's. Say what this page is.
    try {
      document.title = asset.code + (d && d.user ? ' by ' + d.user : '')
        + ' — price, order book and holders on the XRP Ledger | LumosCore';
    } catch (e) {}

    paintLabels(asset);
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

    // Buy / Sell buttons name the token being traded, not the quote asset.
    $$('.dxa-side-btn').forEach(function (b) {
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
    var cards = $$('.dxa-trade-card');
    if (!cards.length) cards = [document];
    cards.forEach(function (card) {
      var sellActive = !!card.querySelector('.dxa-side-btn.sell.active');
      var order = sellActive ? [code, 'XRP'] : ['XRP', code];
      $$('.dxa-trade-asset', card).forEach(function (c, i) {
        if (i > 1) return;
        // data-logoed keeps the logo layer from eating a 1-5 character ticker.
        try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); c.style.background = ''; } catch (e) {}
        c.textContent = order[i];
      });
    });

    $$('.lxad-pair').forEach(function (p) { p.textContent = code + ' / XRP'; });

    // Holder-size filters are denominated in the quote asset.
    $$('.chip').forEach(function (c) {
      var t = (c.textContent || '');
      if (/\bXLM\b/.test(t)) c.textContent = t.replace(/\bXLM\b/g, 'XRP');
    });
  }

  // The Buy/Sell toggle is the design's own, so the chips are re-labelled whenever it changes rather
  // than only on load — otherwise switching to Sell leaves the pay side still saying XRP.
  function watchSide(asset) {
    if (window.__lxxSideWatch) return;
    window.__lxxSideWatch = 1;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.dxa-side-btn');
      if (!b) return;
      setTimeout(function () { paintLabels(asset); }, 0);   // after the design flips .active
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

  function markSwapUnwired(asset, priceXrp) {
    if (window.__lxxSwapUnwired) return;
    window.__lxxSwapUnwired = 1;

    // The two facts we can state. The rate is the page's own live price, and 10 drops is the XRP
    // Ledger's base transaction fee — both real, neither computed from a quote.
    setSumRow('rate', (priceXrp != null && isFinite(priceXrp))
      ? ('1 ' + asset.code + ' = ' + xrp(priceXrp) + ' XRP') : '—');
    setSumRow('network fee', '0.00001 XRP');
    setSumRow('price impact', '—');
    setSumRow('min received', '—');
    // The LIMIT pane is the same panel's other tab and carries its own mock: "Filled when
    // APT/USDC ≤ 4.18". It is hidden until the tab is clicked, which is exactly why it survived the
    // first pass — a check that only reads what is on screen cannot see it.
    setSumRow('filled when', '—');

    // The invented amounts. Emptied rather than zeroed: a 0 reads as a computed quote.
    $$('.dxa-trade-card input').forEach(function (i) {
      try { i.value = ''; i.setAttribute('placeholder', '0.00'); } catch (e) {}
    });

    // NOT A TIMER FIGHT. The first version set `disabled` and relabelled the button, then re-applied
    // on an 800ms interval. It lost: the design owns this button and rewrites its text and its
    // disabled state from the connection state continuously, so the marker attribute was still on
    // the element while the text read "Connect wallet" and `disabled` was false. Two timers writing
    // one element is a race, and the one that ships last wins at random.
    //
    // So nothing here writes the button's own text or disabled flag. Three things that cannot be
    // undone by a re-render instead:
    //
    //   1. CSS, injected once. A stylesheet rule is not something their render loop touches, and
    //      pointer-events:none means the control cannot be operated however it is relabelled.
    //   2. A capture-phase listener on WINDOW, which beats any handler bound later or on document —
    //      the same reason the row-click hijack had to be caught there. This is what actually
    //      guarantees no order is ever submitted from this page.
    //   3. Our own note beside the button, saying why. The design does not know this element
    //      exists, so it survives — and a control that simply does nothing, with no explanation,
    //      is the failure mode this project has already been bitten by.
    if (!document.getElementById('lxx-dxa-off-css')) {
      var st = document.createElement('style');
      st.id = 'lxx-dxa-off-css';
      // `button.` prefix, not a bare class. pointer-events took effect at equal specificity but
      // opacity did not — the design carries its own !important opacity on this button, and among
      // !important declarations of equal specificity the later one wins. One extra element in the
      // selector settles it without touching the design's stylesheet.
      st.textContent = 'button.dxa-trade-cta{opacity:.55!important;pointer-events:none!important}'
        + '.lxx-dxa-offnote{margin:8px 2px 0;font-size:13px;line-height:1.5;opacity:.75;text-align:center}';
      document.head.appendChild(st);
    }

    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.dxa-trade-cta');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);

    $$('.dxa-trade-cta').forEach(function (b) {
      // `data-lxdis="1"` is the design's OWN disabled marker — the stylesheet already carries
      // `.dxa-trade-cta[data-lxdis="1"]{opacity:.55}` — so this is the hook it expects for this
      // state, and it is the right thing to set whatever else happens.
      //
      // MEASURED, AND HONEST ABOUT IT: the button still renders at full opacity. Another layer
      // writes `opacity:1!important;cursor:pointer!important` as an INLINE style and rewrites it
      // continuously, and inline !important outranks both the design's rule and ours. Chasing it
      // with our own timer is the race this code deliberately stepped out of.
      //
      // The dimming is the only thing lost. The control is genuinely inert — pointer-events:none
      // from the injected sheet, and the capture-phase listener above means no click reaches any
      // handler — and the note below says so in words, which is what a reader actually needs.
      try {
        b.setAttribute('data-lxdis', '1');
        b.style.setProperty('opacity', '.55', 'important');
        b.style.setProperty('cursor', 'not-allowed', 'important');
      } catch (e) {}

      if (b.parentNode && !b.parentNode.querySelector('.lxx-dxa-offnote')) {
        var n = el('div', 'lxx-dxa-offnote', 'Trading from this page is not enabled yet.');
        b.parentNode.insertBefore(n, b.nextSibling);
      }
    });
  }

  function load() {
    var asks = $('#dxaObAsks') || $('#mdxaObAsks');
    if (!asks) return;                                  // not this page

    var asset = fromUrl();
    if (!asset) { note('No token in this address.'); return; }

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
    markSwapUnwired(asset, null);

    // Details and book are independent: a token with no market still has an identity, and a book
    // is still a book if the stats feed is down. One failing must not blank the other.
    fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(asset.issuer + '-' + currencyOf(asset.code)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.__lxxAssetData = (d && d.ok) ? d : null;
        paintHeader(asset, window.__lxxAssetData);
        paintStats(window.__lxxAssetData);
        // The one quote figure that is real: the page's own live price, same source as the header.
        // `price`, not `p` — the payload names it in full, and reading the wrong key here would
        // have left the rate on an em dash while looking like it had been wired.
        var p = window.__lxxAssetData && window.__lxxAssetData.price;
        if (p != null && isFinite(p)) {
          setSumRow('rate', '1 ' + asset.code + ' = ' + xrp(p) + ' XRP');
        }
      })
      .catch(function () { paintHeader(asset, null); paintStats(null); });

    book(asset).then(function (b) {
      window.__lxxBook = b;
      paintBook($('#dxaObAsks') || $('#mdxaObAsks'), b.asks, 'ask');
      paintBook($('#dxaObBids') || $('#mdxaObBids'), b.bids, 'bid');
    }).catch(function () {
      note('Could not read the order book.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAssetReload = load;
})();
