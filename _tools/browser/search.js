// Search: XRP Ledger tokens.
//
// REPLACES A LIVE WRONG-CHAIN LAYER. `lx-searchassets` shipped a STELLAR asset index and ran on
// every page of this site: typing "USD" returned Stellar assets with G-issuers, and the page
// prefetched their logos from /lxapi/assetlogo. Like the Trade table, it was not broken-looking --
// it was confidently answering about the wrong ledger.
//
// A TICKER IS NOT AN IDENTITY. Searching "USD" here returns RLUSD (Ripple), USDC (Circle), USD
// (Bitstamp), USD (RippleFox), USDT (XRPS), USDC (GateHub) -- two different USDs and two different
// USDCs, all real. So every row shows the issuer's name AND its address, and results come back
// ordered by 24h volume rather than by name, because alphabetical ordering puts an impostor above
// the token someone actually meant.
//
// Icons are initials in a class of our own: the design's `.sp-ico` is a hook for the inherited
// Stellar icon painter, which resolves logos by ticker.
(function () {
  if (window.__lxxSearch) return;
  window.__lxxSearch = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var MIN = 2;
  var seq = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function initials(n) { return String(n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); }

  function short(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }

  function holders(v) {
    if (v == null || !isFinite(v)) return null;
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M holders';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K holders';
    return v + ' holder' + (v === 1 ? '' : 's');
  }

  (function () {
    if (document.getElementById('lxx-sea-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-sea-css';
    st.textContent = '.lxx-sea-ic{width:30px;height:30px;flex:0 0 30px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;'
      + 'font-weight:800;color:#fff;background:rgba(255,255,255,.10)}'
      + '.lxx-sea-note{padding:18px 14px;text-align:center;opacity:.65;font-size:13.5px}';
    document.head.appendChild(st);
  })();

  // Inline SVG, for the same reason as the Trade icons: the page carries a logo healer that scans
  // every span/div/i/b with 1-5 characters of text and stamps a ticker logo over it. It skips any
  // element that already contains a graphic, so initials drawn as an SVG are left alone.
  function seaIcon(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var e = el('div', 'lxx-sea-ic');
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 30 30');
    svg.setAttribute('width', '30'); svg.setAttribute('height', '30');
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '15'); c.setAttribute('cy', '15'); c.setAttribute('r', '15');
    c.setAttribute('fill', 'rgba(255,255,255,.10)');
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '15'); t.setAttribute('y', '16');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', '10'); t.setAttribute('font-weight', '800');
    t.setAttribute('fill', '#fff');
    t.textContent = initials(name);
    svg.appendChild(c); svg.appendChild(t);
    e.appendChild(svg);
    return e;
  }

  function rowFor(t) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset';
    a.setAttribute('data-chain', 'xrpl');
    a.href = '/xrpl/trade/' + encodeURIComponent(t.n + '-' + t.i);

    var ic = seaIcon(t.n);
    a.appendChild(ic);

    var info = el('div', 'sp-info');
    var nameRow = el('div', 'sp-name-row', t.n);
    if (t.u) nameRow.appendChild(el('span', 'sp-domain', ' ' + t.u));
    info.appendChild(nameRow);
    // The issuer is part of the answer, not decoration: it is the only thing separating two tokens
    // that share a ticker.
    // The issuer address shows once, on the right. It was appearing twice per row.
    info.appendChild(el('div', 'sp-sub', holders(t.h) || ''));
    a.appendChild(info);

    var right = el('div', 'sp-right');
    var mini = el('div', 'sp-addr-mini', short(t.i));
    mini.setAttribute('data-copy', t.i);
    mini.setAttribute('data-copy-label', t.n + ' issuer');
    right.appendChild(mini);
    a.appendChild(right);
    return a;
  }

  function note(list, text) {
    list.innerHTML = '';
    list.appendChild(el('div', 'lxx-sea-note', text));
  }

  function setCount(n) {
    var c = $('#spAssetCount');
    if (c) c.textContent = n == null ? '' : '(' + n + ')';
  }

  function render(list, d) {
    list.innerHTML = '';
    if (!d.rows.length) { note(list, 'No XRP Ledger token matches that.'); setCount(0); return; }
    for (var i = 0; i < d.rows.length; i++) list.appendChild(rowFor(d.rows[i]));
    setCount(d.rows.length);
  }

  function run(q) {
    var list = $('#spAssetList');
    if (!list) return;
    if (q.length < MIN) { note(list, 'Type at least ' + MIN + ' characters.'); setCount(null); return; }

    var mine = ++seq;
    note(list, 'Searching the XRP Ledger…');
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // Keystrokes race. Only the newest query may paint, or a slow early request lands on top of
        // a fast later one and the box shows results for something the user has stopped typing.
        if (mine !== seq) return;
        if (!d || !d.ok) { note(list, 'Search is unavailable right now.'); setCount(null); return; }
        render(list, d);
      })
      .catch(function () {
        if (mine !== seq) return;
        note(list, 'Search is unavailable right now.');
        setCount(null);
      });
  }

  var timer = null;
  function onInput(e) {
    var q = String(e.target.value || '').trim();
    clearTimeout(timer);
    // Debounced: the upstream allows 333 requests a DAY per IP, and although this goes through our
    // own cached proxy, one request per keystroke would still be pointless load for no better answer.
    timer = setTimeout(function () { run(q); }, 260);
  }

  function wire() {
    var inp = $('#spSearchInput');
    if (!inp || inp.__lxx) return;
    inp.__lxx = 1;
    inp.addEventListener('input', onInput);
    // The design's placeholder still offers Stellar; this layer decides what is searchable.
    try { inp.placeholder = 'Search XRP Ledger tokens'; } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  // The popup is created/opened by lx-searchctl, which may mount the input after this runs.
  var tries = 0;
  var poll = setInterval(function () {
    wire();
    if (++tries > 40 || ($('#spSearchInput') && $('#spSearchInput').__lxx)) clearInterval(poll);
  }, 250);

  window.__lxxSearchRun = run;
})();
