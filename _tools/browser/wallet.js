// Wallet page: real XRP Ledger balances, on desktop AND mobile.
//
// Written as a FILE and injected verbatim, never assembled as a string in the transform. Every
// escaping accident in the Stellar project came from browser code living inside quoted strings --
// a template literal ate the backslashes out of a regex and shipped it inert, an SVG's quotes closed
// the string it sat in and crashed the transform. A file has no layers to survive.
//
// TWO RENDERERS, because the two designs are not the same markup:
//   desktop  <tbody id="assetsTable">   table rows, 5 columns
//   mobile   <div  id="assetList">      .asset-row cards
// Writing only the desktop one is the single most repeated bug in the Stellar project -- a fix aimed
// at a desktop selector silently does nothing on the phone, and it caused at least five separate
// reports there. Whichever container exists is the one that gets filled.
//
// Depends on window.lxx (xrpl-core.js), injected immediately above and byte-identical to the file the
// node tests run against, so the currency and reserve rules cannot drift between test and page.
(function () {
  if (window.__lxxWallet) return;
  window.__lxxWallet = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // RETRIED ONCE, and that is not belt-and-braces. This page now runs four layers that each talk to
  // the ledger on load -- balances, the fee tier, connect, and prices -- and a public node drops one
  // of a simultaneous burst. The symptom is the whole asset list replaced by 'Could not read the XRP
  // Ledger' while the very same request succeeds by hand a second later. A transient failure that
  // leaves a permanent empty state is the worst kind, because it looks like a broken page.
  function rpc(method, params, attempt) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }).catch(function (e) {
      // actNotFound is a real answer about a real account, not a dropped request: do not retry it.
      if ((attempt || 0) > 0 || /actNotFound/i.test(e && e.message)) throw e;
      return new Promise(function (r) { setTimeout(r, 700); })
        .then(function () { return rpc(method, params, 1); });
    });
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // textContent everywhere for ledger-supplied values: a currency name is arbitrary bytes off a public
  // ledger and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- rows, per design ---------------------------------------------------------------------------
  function tableRow(name, sub, right, rightSub, frozen) {
    var tr = document.createElement('tr');
    var c1 = el('td');
    c1.appendChild(el('div', 'asset-nm', name + (frozen ? ' (frozen)' : '')));
    c1.appendChild(el('div', 'asset-sb', sub || ''));
    tr.appendChild(c1);
    tr.appendChild(el('td', null, '—'));                 // price: needs a price source
    tr.appendChild(el('td', null, '—'));                 // 7d: later
    var c4 = el('td', 'right');
    c4.appendChild(el('div', 'asset-bal', right));
    if (rightSub) c4.appendChild(el('div', 'asset-sb', rightSub));
    tr.appendChild(c4);
    tr.appendChild(el('td', 'right'));
    return tr;
  }

  function card(name, sub, right, rightSub, frozen) {
    var row = el('div', 'asset-row');
    var top = el('div', 'asset-top');
    top.appendChild(el('div', 'asset-ico', (name || '?').slice(0, 2).toUpperCase()));
    var meta = el('div', 'asset-meta');
    var nr = el('div', 'asset-name-row');
    nr.appendChild(el('span', 'asset-name', name + (frozen ? ' (frozen)' : '')));
    meta.appendChild(nr);
    meta.appendChild(el('div', 'asset-sub', sub || ''));
    top.appendChild(meta);
    var bal = el('div', 'asset-balance-block');
    bal.appendChild(el('div', 'v1', right));
    if (rightSub) bal.appendChild(el('div', 'v2', rightSub));
    top.appendChild(bal);
    row.appendChild(top);
    return row;
  }

  // BOTH containers exist on every wallet page -- the design keeps a table and a card list and shows
  // one by media query. Taking whichever is found first would fill the hidden one and leave the
  // visible one empty, which on a phone looks exactly like the page failing to load.
  // getClientRects() cannot be used to decide: both are EMPTY at this point and so have no rects.
  function hidden(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  function host() {
    var t = $('#assetsTable'), l = $('#assetList');
    if (t && !hidden(t)) return { node: t, kind: 'table' };
    if (l && !hidden(l)) return { node: l, kind: 'cards' };
    if (t) return { node: t, kind: 'table' };
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  // The mobile design ships an anti-flash gate inherited from the Stellar build:
  //     body:not(.lxmw-ready) #assetList { visibility: hidden }
  // and it lifts only when window.__lxWalletEarly / __lxWalletReady is set -- flags that belonged to
  // Stellar's wallet data layer, which does not exist here. Left alone the phone renders a page that
  // is fully populated and completely invisible: 65 correct cards, correct colours, opacity 1, and
  // nothing on screen. Nothing in the console, because nothing is wrong.
  //
  // This layer is now the thing that fills that list, so it is the thing that says it is ready. Set
  // BOTH: the flag, for the design's own pass() when it runs after us, and the class, for when it has
  // already run. Called before the first note(), so the loading and error messages are visible too --
  // they live inside the gated container.
  function lift() {
    try {
      window.__lxWalletReady = 1;
      document.body.classList.add('lxmw-ready');
    } catch (e) {}
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 5;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function setMeta(held, pools, xrp) {
    var m = $('.section-heading .meta');
    var n = held + (xrp ? 1 : 0);
    if (m) {
      m.textContent = n + ' holding' + (n === 1 ? '' : 's')
        + (xrp ? (' · ' + fmt(xrp.balance, 2) + ' XRP') : '');
    }
    var cnt = document.querySelectorAll('.asset-tabs .cnt');
    if (cnt[0]) cnt[0].textContent = String(n);
    if (cnt[1]) cnt[1].textContent = String(pools);
  }

  function paint(data) {
    var h = host();
    if (!h) return;
    h.node.innerHTML = '';
    var make = h.kind === 'table' ? tableRow : card;

    // XRP first, carrying the number people actually need: what is spendable once the reserve is out.
    if (data.xrp) {
      var rs = data.xrp.reserved != null
        ? (fmt(data.xrp.spendable, 6) + ' spendable · ' + fmt(data.xrp.reserved, 2) + ' reserved')
        : 'reserve unknown';
      h.node.appendChild(make('XRP', 'XRP Ledger', fmt(data.xrp.balance, 6) + ' XRP', rs, false));
    }

    data.held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < data.held.length; i++) {
      var t = data.held[i];
      h.node.appendChild(make(t.display, short(t.issuer), fmt(t.balance, 6) + ' ' + t.display, '', t.frozen));
    }

    if (!data.held.length && !data.xrp) note(h, 'Nothing held on this account yet.');
    setMeta(data.held.length, data.pools.length, data.xrp);
  }

  function load() {
    var h = host();
    if (!h) return;                                      // not a wallet page
    lift();
    var a = addr();
    if (!a) { note(h, 'Connect a wallet to see your balances.'); return; }

    note(h, 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      rpc('account_lines', { account: a, limit: 400, ledger_index: 'validated' })
    ]).then(function (r) {
      var v = (r[0].info && r[0].info.validated_ledger) || {};
      // Read every time. These halved by amendment once already; a hardcoded pair would quietly
      // overstate what the user can send.
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = r[1].account_data || {};
      var data = {
        xrp: window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve),
        held: [], pools: [], obligations: []
      };
      var split = window.lxx.readLines(r[2].lines);
      data.held = split.held; data.pools = split.pools; data.obligations = split.obligations;
      window.__lxxData = data;
      paint(data);
    }).catch(function (e) {
      // An account with no transactions simply does not exist on the ledger yet. Not an error.
      if (/actNotFound/i.test(e.message || '')) { note(h, 'This account is not activated on the XRP Ledger yet.'); return; }
      note(h, 'Could not read the XRP Ledger — ' + (e.message || 'try again'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxReload = load;
})();
