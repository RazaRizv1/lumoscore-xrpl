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
    setChip();
  }

  // The header chip shipped showing the design's mock address, `0x09c7…a802` — an EVM-shaped string
  // on an XRP Ledger wallet page, sitting above this account's real balances. Whatever else is wrong
  // on a page, the address it claims to be showing must be the one that is connected.
  function setChip() {
    var a = addr();
    if (!a) return;
    var chip = $('.wallet-chip .text') || $('.wallet-chip .addr');
    if (chip && chip.textContent.trim() !== short(a)) chip.textContent = short(a);

    // THE PAGE HAS MORE THAN ONE HOLDINGS SUMMARY. setMeta writes $('.section-heading .meta'), which
    // is the FIRST match — and a second one lives in another .section-heading further down, so it kept
    // the mock "5 holdings · 31,108.45 APT total" while the list beneath it was already correct.
    // querySelector returning the first of several is the quiet version of this bug; take them all.
    var d = window.__lxxData;
    if (!d) return;
    var n = d.held.length + (d.xrp ? 1 : 0);
    var line = n + ' holding' + (n === 1 ? '' : 's')
      + (d.xrp ? (' · ' + fmt(d.xrp.balance, 2) + ' XRP') : '');
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta'), function (m) {
      // Only summaries, never an activity row's own .meta (which is "From r… · 06:16").
      if (/holding|APT|Aptos/i.test(m.textContent || '')) m.textContent = line;
    });
  }

  // ---- Activity ------------------------------------------------------------------------------------
  // The design ships thirty rows of invented transactions — "Received USDT from 0x0222…02b2",
  // "Sell 500 APT @ 0.4128" — dated today and sitting under this account's real balances. That is the
  // most dangerous thing on the page: a blank section reads as unfinished, a fabricated one reads as
  // your history. The dashboard's own activity feed was replaced for exactly this reason.
  //
  // The design's markup is reused, not replaced: a real .activity-row and .day-divider are kept as
  // templates and cloned, so every class, icon and layout stays the design's.
  var TYPES = {
    Payment: 'Payment', OfferCreate: 'Order', OfferCancel: 'Cancelled order',
    TrustSet: 'Trustline', AMMDeposit: 'Pool deposit', AMMWithdraw: 'Pool withdrawal',
    AccountSet: 'Account update', NFTokenMint: 'NFT mint'
  };

  // An amount is either drops (a bare string) or an issued-currency object.
  function amt(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { value: +v / 1e6, code: 'XRP' };
    // Through lxx.decodeCurrency so a 40-char hex code renders as its name, exactly as the asset
    // list above renders it — one decoder, so the two cannot disagree about what a token is called.
    var d = window.lxx.decodeCurrency(v.currency);
    return { value: +v.value, code: (d && d.display) || v.currency };
  }

  function paintActivity(me) {
    var block = $('.activity-block');
    if (!block) return;
    var rowT = block.querySelector('.activity-row');
    var dayT = block.querySelector('.day-divider');
    if (!rowT) return;
    rowT = rowT.cloneNode(true);
    dayT = dayT ? dayT.cloneNode(true) : null;

    rpc('account_tx', { account: me, limit: 25, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (r) {
        var txs = r.transactions || [];
        if (!txs.length) return;
        block.innerHTML = '';
        var lastDay = '';

        txs.forEach(function (t) {
          var tx = t.tx || t.tx_json || {};
          var meta = t.meta || t.metaData || {};
          if (typeof tx.date !== 'number') return;
          var when = new Date((tx.date + 946684800) * 1000);
          var day = when.toDateString();

          if (day !== lastDay && dayT) {
            lastDay = day;
            var dv = dayT.cloneNode(true);
            var today = new Date().toDateString();
            dv.textContent = (day === today ? 'TODAY · ' : '')
              + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
            block.appendChild(dv);
          }

          var row = rowT.cloneNode(true);
          var kind = TYPES[tx.TransactionType] || tx.TransactionType || 'Transaction';
          var incoming = tx.TransactionType === 'Payment' && tx.Destination === me;
          var other = incoming ? tx.Account : tx.Destination;

          var ico = row.querySelector('.activity-icon');
          if (ico) { ico.classList.toggle('received', !!incoming); ico.classList.toggle('sent', !incoming); }

          var ty = row.querySelector('.type');
          if (ty) {
            var status = ty.querySelector('.status');
            ty.textContent = (tx.TransactionType === 'Payment' ? (incoming ? 'Received' : 'Sent') : kind) + ' ';
            if (status) {
              var ok = (meta.TransactionResult === 'tesSUCCESS');
              status.textContent = ok ? 'Confirmed' : (meta.TransactionResult || 'Failed');
              status.classList.toggle('success', ok);
              ty.appendChild(status);
            }
          }

          var mt = row.querySelector('.meta');
          if (mt) {
            mt.textContent = (other ? ((incoming ? 'From ' : 'To ') + short(other) + ' · ') : '')
              + when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          }

          var a1 = row.querySelector('.a1');
          if (a1) {
            // delivered_amount, never tx.Amount: on a path payment Amount is the MAXIMUM the sender
            // would allow, not what arrived. Measured elsewhere in this project as a 33% overstatement.
            var got = amt(meta.delivered_amount || meta.DeliveredAmount || tx.Amount);
            if (got && isFinite(got.value)) {
              a1.textContent = (incoming ? '+' : '−') + fmt(got.value, 6) + ' ' + got.code;
              a1.classList.toggle('up', !!incoming);
              a1.classList.toggle('down', !incoming);
            } else {
              a1.textContent = '';
            }
          }

          // The design's second line is a USD conversion, and it shipped as a fixed "≈ $7.42" on
          // every row. This layer has no price map — prices.js owns that — so the honest thing is to
          // clear it rather than repeat a number that was never about this transaction. An empty
          // slot says nothing; a stale one says something false on all 25 rows.
          var a2 = row.querySelector('.a2');
          if (a2) a2.textContent = '';

          block.appendChild(row);
        });
      }).catch(function () { /* leave the design's block alone rather than empty it on a failure */ });
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
      paintActivity(a);
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
