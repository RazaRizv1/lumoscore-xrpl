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
// NO LOGOS AND NO SPARKLINES, deliberately. Token thumbnails need an API key (the endpoint answers
// 401 without one), so initials are drawn instead of shipping a broken image beside every row. And
// the feed gives a 7d PERCENTAGE, not a 7d series -- drawing a curve from a single number would be
// inventing the shape of the week, so that cell stays empty until there is real history behind it.
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

  // NO data-lxic ON ANYTHING THIS FILE CREATES. That attribute is the hook for the inherited
  // Stellar icon painter, which resolves logos BY TICKER -- and it was doing exactly that here,
  // stamping Stellar SVGs onto RLUSD, USDC and ARMY and wiping their initials. A ticker is not an
  // identity on either ledger; an XRPL ARMY is not the Stellar ARMY. Initials are correct-and-plain;
  // a confident wrong logo is not. Real logos need the xrpl.to API key.
  // The design's icon classes (.mdx-mk-ic, .dex-mk-pair-ic, .dex-mover-ico) are all hooks for the
  // inherited Stellar icon painters, which resolve logos BY TICKER: they stamped a Stellar mark onto
  // RLUSD, USDC and ARMY and cleared the initials. A ticker is not an identity on either ledger --
  // an XRPL ARMY is not the Stellar ARMY -- so a confident wrong logo is worse than a letter.
  // Removing data-lxic was not enough and neither was dropping lxmd-ic; the painters match the
  // layout classes themselves. So these icons carry a class of OUR own that nothing else knows,
  // with the design's dimensions copied from its computed style (32px, round, 13px/800).
  // Real logos need the xrpl.to API key; until then, initials.
  function icon(name) {
    var e = el('span', 'lxx-ic', initials(name));
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

  function initials(name) { return String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); }

  // The table is keyed by ticker+issuer, the same identity the rest of the site uses. The ticker
  // alone is NOT an identity on this ledger any more than it is on Stellar -- several unrelated
  // tokens call themselves USDC -- so the issuer travels with it on the row.
  function row(t, rank, usd) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-tkr', t.n);
    tr.setAttribute('data-iss', t.i);

    // 0: asset
    var c0 = el('td');
    var cell = el('div', 'dex-mk-pair-cell');
    cell.appendChild(el('span', 'dex-mk-rank', '#' + rank));
    var ic = icon(t.n);
    cell.appendChild(ic);
    var nm = el('div', 'dex-mk-pair-name');
    nm.appendChild(el('div', 'dex-mk-pair-head', t.n));
    if (t.u) nm.appendChild(el('div', 'sub', t.u));
    cell.appendChild(nm);
    c0.appendChild(cell);
    tr.appendChild(c0);

    // 1: last price, in XRP with the dollar value under it
    var c1 = el('td');
    var pr = el('div', 'dex-mk-price', xrp(t.p));
    if (usd != null) {
      var sub = el('span', 'sub');
      sub.appendChild(el('span', 'lc-money', money(t.p * usd)));
      pr.appendChild(sub);
    }
    c1.appendChild(pr);
    tr.appendChild(c1);

    // 2: 24h change
    var c2 = el('td');
    var ch = el('div', 'dex-mk-change', pct(t.d) || '—');
    if (t.d != null) ch.style.color = t.d >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
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

    tr.addEventListener('click', function () {
      window.location.href = '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i);
    });
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
    var ic = icon(t.n);
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
    card.addEventListener('click', function () {
      window.location.href = '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i);
    });
    return card;
  }

  function mover(t, usd) {
    var card = el('div', 'dex-mover-card');
    card.setAttribute('data-tkr', t.n);
    var head = el('div', 'dex-mover-head');
    var ic = icon(t.n);
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
    card.addEventListener('click', function () {
      window.location.href = '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i);
    });
    return card;
  }

  // The design's column headers name the quote asset, and the page composes them from a variable
  // that still said XLM. Set explicitly here: this layer decides what the numbers are quoted in, so
  // it is the thing that should label them.
  function headers() {
    var map = { 'th-price': 'Last Price (XRP)', 'th-change': '24h Change (XRP)',
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

  function attribution(d) {
    if (!d || !d.attribution || document.getElementById('lxx-attr-dex')) return;
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
    lift();
    note(h, 'Reading the XRP Ledger…');

    fetch('/lxapi/xrpltokens?n=50').then(function (r) { return r.json(); }).then(function (d) {
      reveal();
      if (!d || !d.ok || !d.rows.length) { note(h, 'Market data is unavailable right now.'); return; }
      window.__lxxTradeData = d;

      h.node.innerHTML = '';
      var make = h.kind === 'table' ? row : mkCard;
      for (var i = 0; i < d.rows.length; i++) h.node.appendChild(make(d.rows[i], i + 1, d.usd));

      var shown = $('#dexMkShown');
      if (shown) shown.textContent = '1–' + d.rows.length;

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
