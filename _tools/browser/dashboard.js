// Dashboard: the XRP Ledger's real numbers, and real LUMOS activity.
//
// WHAT THIS PAGE WAS SHOWING. Every figure on it was the design's mock, and the mocks were not
// merely round -- they were wrong in ways a reader could act on:
//
//   * "XRP Ledger price $0.245". XRP trades at $1.42. The 0.245 is XLM's old price, relabelled by
//     the blind Stellar -> XRP Ledger replacement, so the page quoted one chain's price under
//     another chain's name.
//   * "Assets 4,234" against 20,362, "Pools 4,521" against 30,648, "Volume 12,532,325 XRP" against
//     1.91M.
//   * A "Platform Activity" feed with a LIVE PULSE animation listing invented transactions --
//     "MOD launched on XRP Ledger", "Swap $6,120 CELL", "Bridged 2,400 XRP", each with a seconds-ago
//     timestamp that ticked. Fabricated events presented as a live feed are the worst thing on the
//     page, because nothing about them looks like placeholder text.
//
// Everything here comes from /lxapi/xrpltokens (ledger totals and whole-market stats in ONE
// response), /lxapi/xrplpools for the pool count, and the public XRPL node for LUMOS activity.
// Anything without a source is an em dash. Nothing is invented.
//
// THE TRENDING CARD IS GONE. It was dropped from the Stellar dashboard and should not have been
// carried across; the markup is removed in _xrpldash.js rather than hidden here, and the code that
// painted it went with it.
(function () {
  if (window.__lxxDash) return;
  window.__lxxDash = 1;

  var RPC = 'https://xrplcluster.com/';
  // The LUMOS/XRP AMM account -- the Native LP pool, verified against the issuer-filtered pool list.
  // Its account_tx is every swap routed through the pool plus every deposit and withdrawal, which is
  // real LUMOS activity. The ISSUER's account_tx was tried first and is the wrong source: it also
  // returns payments that merely rippled past a LUMOS trust line, so the feed filled with MXI and
  // SHROOMIES transfers labelled as LUMOS payments.
  var LUMOS_POOL = 'rnPQqk3cfHyqSyvAGh3AfMtWiszK8zaF4U';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ---- formatting ------------------------------------------------------------------------------

  function compact(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function count(v) {
    return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // Ripple epoch is 2000-01-01, not 1970. Getting this wrong dates every event to 1970 or 2030,
  // which on a feed labelled "live" reads as broken rather than as an offset.
  var RIPPLE_EPOCH = 946684800;
  function ago(rippleSeconds) {
    if (!isFinite(rippleSeconds)) return '';
    var s = Math.max(0, Math.floor(Date.now() / 1000 - (rippleSeconds + RIPPLE_EPOCH)));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  // A 40-character hex currency is ASCII padded with NULs; 3-character codes stand as they are.
  function curName(c) {
    if (!c) return '';
    if (c.length !== 40) return c;
    var out = '';
    for (var i = 0; i < 40; i += 2) {
      var b = parseInt(c.substr(i, 2), 16);
      if (b) out += String.fromCharCode(b);
    }
    return out || c;
  }

  // ---- network stats ---------------------------------------------------------------------------

  // Match pills by their LABEL, never by position: the row's order is a layout decision.
  function setPill(match, value, newLabel) {
    var pills = $$('.status-row .status-pill');
    for (var i = 0; i < pills.length; i++) {
      var lbl = pills[i].querySelector('.lbl');
      var val = pills[i].querySelector('.val');
      if (!lbl || !val) continue;
      if ((lbl.textContent || '').toLowerCase().indexOf(match) < 0) continue;
      val.textContent = value;
      if (newLabel) lbl.textContent = newLabel;
      return true;
    }
    return false;
  }

  function paintStats(d, pools) {
    if (!$('.status-row')) return;
    var s = (d && d.stats) || {};

    setPill('asset', count(d && d.total));
    setPill('pool', count(pools));
    setPill('volume', s.dexVol24 == null ? '—' : (compact(s.dexVol24) + ' XRP'));

    // The label said "XRP Ledger price", which is the blind replacement of "Stellar price" and reads
    // as a price for the ledger itself. The asset is XRP.
    setPill('price', d && d.usd != null ? ('$' + Number(d.usd).toFixed(4)) : '—', 'XRP price');

    // AND THEN MAKE IT VISIBLE. The stripped Stellar layer left its stylesheet behind, and that
    // stylesheet contains, unconditionally:
    //     .status-row { opacity: 0 }
    // Its script used to raise that back to 1 once it had filled the row; the script is gone and the
    // rule is not. So the whole network-stats strip — Assets 20,367, Pools 30,662, XRP price, all of
    // it correct and freshly written — was painted into an invisible element on every dashboard load.
    //
    // Nothing revealed it either: this is NOT the scroll-reveal gate, which lifts by itself when a
    // section comes into view. Scrolling the entire page and re-measuring left it at zero.
    //
    // Set as an inline style so it beats the sheet, and only here — after the real numbers are in,
    // never before, so the row cannot flash the design's mock figures on its way to being right.
    var row = $('.status-row');
    if (row) row.style.setProperty('opacity', '1', 'important');
  }

  // ---- LUMOS activity --------------------------------------------------------------------------
  // The design's feed listed invented transactions. This lists real ones: account_tx on the
  // LUMOS/XRP AMM account returns every swap routed through the pool, plus deposits, withdrawals
  // and fee votes.
  //
  // The heading is rewritten to say so. "Platform Activity" would still be a claim this data does
  // not support: these are pool events on the ledger, not actions taken on LumosCore.

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
    }).then(function (r) { return r.json(); });
  }

  function amountOf(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { v: Number(a) / 1e6, c: 'XRP' };   // drops
    return { v: Number(a.value), c: curName(a.currency) };
  }

  // Token amounts are written with a decimal exponent, and 1000000000000000e65 -- 1e80, the largest
  // an XRPL token amount can be -- is what a client sends to mean "no limit". It is a sentinel, not
  // a quantity, and printing it yields the nonsense "1e+71B".
  function amtStr(a) {
    if (!a || !isFinite(a.v)) return '';
    if (a.v >= 1e17) return a.c;                     // the no-limit sentinel: name the asset only
    var n = a.v >= 1000 ? compact(a.v)
      : (a.v >= 1 ? a.v.toFixed(2) : Number(a.v.toPrecision(3)).toString());
    return n + ' ' + a.c;
  }

  // WHAT A PATH PAYMENT'S `Amount` ACTUALLY IS: the most the sender is willing to have delivered,
  // not what arrived. Measured on this very pool -- claimed 9,718.80 SHROOMIES against 6,479.10
  // delivered (33% less), and claimed 1e80 MXI against 4,102.42. The exact figure is in the
  // METADATA. Reading `Amount` would overstate every swap on the feed.
  function describe(tx, meta) {
    var type = tx.TransactionType;

    if (type === 'Payment') {
      var got = amountOf(meta && (meta.delivered_amount || meta.DeliveredAmount));
      var spent = amountOf(tx.SendMax);
      var text = '';
      if (got) {
        // SendMax is also a maximum, so it names the asset paid in without claiming a quantity.
        text = (spent && spent.c && spent.c !== got.c ? spent.c + ' → ' : '') + amtStr(got);
      }
      return { cls: 'swap', type: 'Swap through the LUMOS pool', meta: text };
    }

    if (type === 'AMMDeposit') return { cls: 'lp', type: 'Liquidity added', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMWithdraw') return { cls: 'lp', type: 'Liquidity withdrawn', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMCreate') return { cls: 'lp', type: 'Pool created', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMBid') return { cls: 'lp', type: 'Auction slot bid', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMVote') return { cls: 'lp', type: 'Trading-fee vote', meta: 'LUMOS/XRP pool' };
    if (type === 'OfferCreate') {
      var pays = amountOf(tx.TakerPays), gets = amountOf(tx.TakerGets);
      return {
        cls: 'swap', type: 'DEX offer',
        meta: (pays && gets) ? (amtStr(gets) + ' → ' + amtStr(pays)) : '',
      };
    }
    if (type === 'OfferCancel') return { cls: 'swap', type: 'DEX offer cancelled', meta: '' };
    if (type === 'TrustSet') return { cls: 'launch', type: 'Trust line set', meta: '' };
    return { cls: 'swap', type: type || 'Ledger transaction', meta: '' };
  }

  function activityRow(entry) {
    // rippled's v1 and v2 shapes differ: v1 nests the transaction under `tx`, v2 under `tx_json`
    // with the timestamp lifted to the envelope. Reading only one of them yields an empty feed
    // against a node that is answering perfectly.
    var tx = entry.tx || entry.tx_json || {};
    var date = entry.close_time_iso
      ? (Date.parse(entry.close_time_iso) / 1000 - RIPPLE_EPOCH)
      : (tx.date != null ? tx.date : entry.date);

    var d = describe(tx, entry.meta || entry.metaData);
    var row = document.createElement('div');
    row.className = 'activity-feed-row';

    var ic = document.createElement('div');
    ic.className = 'act-ic ' + d.cls;
    // The healer skips anything containing an svg; a dot is also all this slot ever showed.
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
    svg.setAttribute('viewBox', '0 0 24 24');
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '5');
    c.setAttribute('fill', 'currentColor');
    svg.appendChild(c); ic.appendChild(svg);
    row.appendChild(ic);

    var info = document.createElement('div');
    info.className = 'info';
    var t = document.createElement('div');
    t.className = 'type';
    t.textContent = d.type;
    info.appendChild(t);
    var m = document.createElement('div');
    m.className = 'meta';
    m.textContent = d.meta;
    info.appendChild(m);
    row.appendChild(info);

    var time = document.createElement('div');
    time.className = 'time';
    time.textContent = ago(date);
    row.appendChild(time);

    // The explorer mark, at the end of the row. The stylesheet for it came across with the design
    // (`.activity-feed-row .lx-actlink`, faded until the row is hovered) and had nothing to style,
    // because this feed stopped at the timestamp.
    try {
      var xl = window.lxxExplorer && window.lxxExplorer.link(
        window.lxxExplorer.txHash(entry), 'View this transaction on Bithomp');
      if (xl) row.appendChild(xl);
    } catch (e) {}

    return row;
  }

  function loadActivity() {
    var host = $('#activityList');
    if (!host) return;

    var head = host.closest('.activity-card');
    var h3 = head && head.querySelector('h3');
    if (h3) {
      // Keep the live-pulse dot the design ships, replace only the words after it.
      var pulse = h3.querySelector('.live-pulse');
      h3.textContent = '';
      if (pulse) h3.appendChild(pulse);
      h3.appendChild(document.createTextNode('LUMOS pool activity'));
    }

    var note = function (msg) {
      host.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'activity-feed-row';
      d.textContent = msg;
      d.style.cssText = 'opacity:.6;justify-content:center';
      host.appendChild(d);
    };
    note('Reading the ledger…');

    rpc('account_tx', {
      account: LUMOS_POOL, limit: 20, binary: false,
      ledger_index_min: -1, ledger_index_max: -1,
    }).then(function (j) {
      var res = j && j.result;
      var list = (res && res.transactions) || [];
      if (!list.length) { note('No recent LUMOS pool activity.'); return; }
      host.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        // A transaction that failed still enters a ledger. Showing one as activity would report a
        // rejected transfer as a completed one.
        var meta = list[i].meta || list[i].metaData;
        if (meta && meta.TransactionResult && meta.TransactionResult !== 'tesSUCCESS') continue;
        host.appendChild(activityRow(list[i]));
      }
      if (!host.children.length) note('No recent LUMOS pool activity.');
    }).catch(function () {
      note('Could not read the XRP Ledger.');
    });
  }

  // ---- boot ------------------------------------------------------------------------------------

  function load() {
    if (!$('.status-row') && !$('#activityList')) return;      // not the dashboard

    // One row is enough: `total` counts the ledger's pools regardless of how many are returned.
    // The token call is asked for n=1 for the same reason -- the figures the stats row needs are
    // whole-market totals that ride along in the response, not the token rows themselves.
    fetch('/lxapi/xrpltokens?n=1')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { paintStats(null, null); return; }
        window.__lxxDashData = d;
        // Announced so the price panel above can show the SAME rate this row is about to paint.
        // It reads the published payload rather than asking for its own: the endpoint is sampled,
        // so two calls a second apart return rates that differ in the last digit — and the panel's
        // headline sits directly above the "XRP price" pill, where that difference is visible.
        try { window.dispatchEvent(new CustomEvent('lxx:dashdata')); } catch (e) {}
        return fetch('/lxapi/xrplpools?n=1')
          .then(function (r) { return r.json(); })
          .then(function (p) { paintStats(d, p && p.ok ? p.total : null); })
          .catch(function () { paintStats(d, null); });
      })
      .catch(function () { paintStats(null, null); });

    loadActivity();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxDashReload = load;
})();
