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

    // THE SAME FOUR FIGURES AS lumoscore.com, WITH THE SAME MARKS. RAZA 2026-09-15: "It needs to show
    // the same stats as stellar, but for XRPL. Also should have the same icons." Stellar's strip is
    // Assets / Pools / Trades / Accounts, each `span.status-pill.lx-vpill` holding a coloured
    // `.lx-pico` glyph and a `.lx-vpt` label/value pair — markup copied from the live page, so the
    // stylesheet this build already carries (lx-dashtop-css) dresses it with nothing new.
    //
    // This row used to read Assets / Pools / Volume / XRP price. Volume and price are not what Stellar
    // shows, and both already appear elsewhere on the page.
    //
    // THE SOURCES, all in the one /lxapi/xrpltokens response the row already used:
    //   Trades   = H24.transactions24H — xrpl.to's 24h count of DEX trades. Verified to be exactly the
    //              sum of its AMM and order-book trade counts (67,325 + 54,120 = 121,445), so it is a
    //              trade count and not a count of every ledger transaction.
    //   Accounts = global.totalAddresses, a running total like Stellar's.
    // Stellar's Trades is "the last full UTC day"; this is a rolling 24 hours, and the tooltip says so.
    var ICON = {
      assets: ['#f7b733', '<ellipse cx="14.8" cy="8.6" rx="4.4" ry="2.1"></ellipse><path d="M10.4 8.6v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1V8.6"></path><ellipse cx="9.2" cy="14.4" rx="4.4" ry="2.1"></ellipse><path d="M4.8 14.4v3.4c0 1.16 1.97 2.1 4.4 2.1s4.4-.94 4.4-2.1v-3.4"></path>'],
      pools: ['#38bdf8', '<path d="M12 3.4l3.9 4.7a5.1 5.1 0 1 1-7.8 0z"></path><ellipse cx="12" cy="17.6" rx="7.4" ry="2.5"></ellipse><path d="M8.6 15.9c.9.5 2.1.8 3.4.8s2.5-.3 3.4-.8"></path>'],
      trades: ['#a855f7', '<path d="M4.8 9.2h13.6M15.4 6.2l3 3-3 3"></path><path d="M19.2 14.8H5.6M8.6 11.8l-3 3 3 3"></path>'],
      accounts: ['#2dd4bf', '<circle cx="12" cy="8.7" r="3.5"></circle><path d="M5.5 19.4a6.5 6.5 0 0 1 13 0"></path>'],
    };
    var FIG = [
      ['assets', 'Assets', count(d && d.total), 'Tokens issued on the XRP Ledger'],
      ['pools', 'Pools', count(pools), 'Liquidity pools on the XRP Ledger AMM'],
      ['trades', 'Trades', count(s.transactions24), 'DEX and AMM trades on the XRP Ledger in the past 24 hours'],
      ['accounts', 'Accounts', compact(s.addresses),
        (s.addresses != null ? count(s.addresses) + ' — ' : '') + 'accounts on the XRP Ledger, a running total rather than a daily figure'],
    ];
    var slots = $$('.status-row > .status-pill:not(.lx-netcard)');
    FIG.forEach(function (f, i) {
      var pill = slots[i];
      if (!pill) return;
      var ic = ICON[f[0]];
      pill.className = 'status-pill lx-vpill';
      pill.setAttribute('data-lx-noswap', '');
      pill.setAttribute('title', f[3]);
      pill.innerHTML = '<span class="lx-pico" style="color:' + ic[0] + '" aria-hidden="true">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
        + ic[1] + '</svg></span><span class="lx-vpt"><span class="lbl"></span><span class="val"></span></span>';
      pill.querySelector('.lbl').textContent = f[1];
      pill.querySelector('.val').textContent = f[2];
    });

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

  // The RAW currency and the issuer are kept, not just the display name. The logo lookup is keyed on
  // md5(issuer + "_" + currencyHex), so a decoded "LUMOS" cannot address it — dropping these two
  // fields is why the feed had no icons.
  function amountOf(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { v: Number(a) / 1e6, c: 'XRP', raw: 'XRP', i: '' };  // drops
    return { v: Number(a.value), c: curName(a.currency), raw: a.currency, i: a.issuer || '' };
  }

  // XRP is the one token whose id is not derived — xrpl.to gives it a fixed one.
  var XRP_ID = '84e5efeb89c4eae8f68188982dc290d8';

  // The inline asset chip Stellar's feed uses: span.act-inl.lx-actasset painted with a
  // background-image. Same classes on purpose, so it inherits the design's sizing and spacing
  // rather than needing any CSS of its own.
  function assetChip(a) {
    var s = document.createElement('span');
    s.className = 'act-inl lx-actasset';
    s.setAttribute('data-c', a.c || '');
    s.setAttribute('data-i', a.i || '');
    s.setAttribute('data-l', String(a.c || '?').slice(0, 1).toUpperCase());
    // The logo healer repaints any element holding one to five characters, which every ticker is.
    // data-lxpainted is its own skip marker — this slot is painted here.
    s.setAttribute('data-lxpainted', '1');
    var url = (a.raw === 'XRP' && !a.i)
      ? '/lxapi/xrplthumb?id=' + XRP_ID + '&w=48'
      : (a.i ? '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.i)
               + '&cur=' + encodeURIComponent(a.raw || a.c) + '&w=48' : '');
    if (url) s.style.backgroundImage = 'url("' + url + '")';
    return s;
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
      // WHAT WAS ACTUALLY SPENT, not the ceiling (Stellar's feed prints both sides — "5.80M LUMOS → 1.0K XLM"). SendMax is
      // a maximum, so it can only be named, never quoted; the real figure is the sender's own balance change in the
      // metadata, which is how the wallet's activity rows already do it. Falls back to naming the asset when the delta
      // cannot be read.
      if (spent) {
        var moved = sentByAccount(meta, tx, spent);
        if (moved > 0) spent = { v: moved, c: spent.c, raw: spent.raw, i: spent.i };
      }
      // A quantity is only printed where one is actually known: the measured spend above, never SendMax's ceiling.
      var spentKnown = !!(spent && spent.v > 0 && isFinite(spent.v));
      var text = '';
      if (got) {
        text = (spent && spent.c && spent.c !== got.c ? ((spentKnown ? amtStr(spent) : spent.c) + ' → ') : '') + amtStr(got);
      }
      // `parts` carries the assets so the row can draw a logo beside each one, the way Stellar's
      // feed does. `meta` stays as the plain-text fallback for anything that cannot render parts.
      var pp = [];
      if (got) {
        if (spent && spent.c && spent.c !== got.c) { pp.push({ a: spent, nameOnly: !spentKnown }, ' → '); }
        pp.push({ a: got });
      }
      // THE TAG IS THE KIND, IN ONE OR TWO WORDS (RAZA 2026-09-17: "fix the tags… text inside the tags as well").
      // lumoscore.com's read SWAP / TRANSFER / ORDER PLACED / CROSS-CHAIN — never a sentence. Mine carried "Swap through
      // the LUMOS pool" and "Swap on LumosCore" inside a pill built for one word, which is why they looked wrong beside
      // Stellar's. The row already says what happened; the tag only has to say what KIND it was.
      //
      // A payment into or out of a pool with two different assets is a swap; the same asset in and out is a transfer, and
      // it gets the green tag rather than the purple one.
      var isSwap = !!(got && spent && spent.c && spent.c !== got.c);
      return {
        cls: isSwap ? 'swap' : 'transfer', tag: isSwap ? 'Swap' : 'Transfer',
        type: 'Swap through the LUMOS pool', meta: text, parts: pp,
      };
    }

    if (type === 'AMMDeposit') return { cls: 'lp', tag: 'Liquidity', type: 'Liquidity added', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMWithdraw') return { cls: 'lp', tag: 'Liquidity', type: 'Liquidity withdrawn', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMCreate') return { cls: 'lp', tag: 'Pool created', type: 'Pool created', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMBid') return { cls: 'lp', tag: 'Auction bid', type: 'Auction slot bid', meta: 'LUMOS/XRP pool' };
    if (type === 'AMMVote') return { cls: 'lp', tag: 'Fee vote', type: 'Trading-fee vote', meta: 'LUMOS/XRP pool' };
    if (type === 'OfferCreate') {
      var pays = amountOf(tx.TakerPays), gets = amountOf(tx.TakerGets);
      return {
        cls: 'order', tag: 'Order placed', type: 'DEX offer',
        meta: (pays && gets) ? (amtStr(gets) + ' → ' + amtStr(pays)) : '',
        parts: (pays && gets) ? [{ a: gets }, ' → ', { a: pays }] : [],
      };
    }
    if (type === 'OfferCancel') return { cls: 'order', tag: 'Order cancelled', type: 'DEX offer cancelled', meta: '' };
    if (type === 'TrustSet') return { cls: '', tag: 'Trust line', type: 'Trust line set', meta: '' };
    return { cls: '', tag: (type || 'Ledger').replace(/([a-z])([A-Z])/g, '$1 $2'), type: type || 'Ledger transaction', meta: '' };
  }

  // How much the sender's own balance fell, read from the transaction's metadata: the XRP case nets off the network fee
  // (which is not part of the trade), the token case reads the trust line between the sender and that issuer. Same
  // derivation the wallet's activity list uses.
  function sentByAccount(meta, tx, give) {
    var me = tx.Account, nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i].ModifiedNode || nodes[i].DeletedNode;
      if (!n) continue;
      var f = n.FinalFields || {}, pv = n.PreviousFields || {};
      if (give.c === 'XRP' && n.LedgerEntryType === 'AccountRoot' && f.Account === me && pv.Balance != null) {
        return (Number(pv.Balance) - Number(f.Balance) - Number(tx.Fee || 0)) / 1e6;
      }
      if (give.c !== 'XRP' && n.LedgerEntryType === 'RippleState' && pv.Balance && f.Balance
        && f.Balance.currency === give.raw) {
        var lo = f.LowLimit && f.LowLimit.issuer, hi = f.HighLimit && f.HighLimit.issuer;
        if (lo !== me && hi !== me) continue;
        if ((lo === me ? hi : lo) !== give.i) continue;
        var sgn = lo === me ? 1 : -1;
        return sgn * (Number(pv.Balance.value) - Number(f.Balance.value));
      }
    }
    return 0;
  }

  // r-addresses are 25–35 characters; the row has a column, not a line, for one.
  function shortAddr(a) {
    a = String(a || '');
    return a.length > 12 ? (a.slice(0, 4) + '…' + a.slice(-4)) : a;
  }
  // The little colour dot beside the address, derived from the address itself so one account keeps one colour.
  function hueOf(a) {
    var h = 0, s = String(a || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',62%,58%)';
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
    row.setAttribute('data-t', String(date || 0));

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

    // STELLAR'S ROW SHAPE (RAZA 2026-09-17: "compare it with Stellar dashboard → Platform activity. XRP is designed
    // different"). lumoscore.com puts the AMOUNTS on the bold first line and, underneath, a verb chip plus the wallet that
    // did it — "5.80M LUMOS → 1.0K XLM" over "[SWAP] GCCD…BQCP". This build had it inverted: a sentence on top
    // ("Swap through the LUMOS pool") with the assets beneath, and it never named the wallet at all.
    //
    // Every class below is already in this container — `.lx-actverb`, `.lx-actwho`, `.lx-actdot`, `.lx-actmeta` all came
    // across with the design. They were simply never used here.
    var info = document.createElement('div');
    info.className = 'info';

    var t = document.createElement('div');
    t.className = 'type';
    if (d.parts && d.parts.length) {
      for (var pi = 0; pi < d.parts.length; pi++) {
        var p = d.parts[pi];
        if (typeof p === 'string') { t.appendChild(document.createTextNode(p)); continue; }
        var b = document.createElement('b');
        b.appendChild(assetChip(p.a));
        b.appendChild(document.createTextNode(p.nameOnly ? p.a.c : amtStr(p.a)));
        t.appendChild(b);
      }
    } else {
      t.textContent = d.meta || d.type;
    }
    info.appendChild(t);

    var m = document.createElement('div');
    m.className = 'meta lx-actmeta';
    var verb = document.createElement('span');
    verb.className = 'lx-actverb ' + (d.cls || '');
    verb.textContent = d.tag || d.type;                  // the KIND — "Swap", "Transfer", "Order placed"; the sheet uppercases it
    m.appendChild(verb);
    // Who did it. The feed is the platform's, so the account is the point — and it is a link, as on Stellar.
    var who = tx.Account || '';
    if (who) {
      var a = document.createElement('a');
      a.className = 'lx-actwho';
      a.href = '/account/xrpl/' + encodeURIComponent(who);
      a.title = who;
      var dot = document.createElement('span');
      dot.className = 'lx-actdot';
      dot.style.background = hueOf(who);
      a.appendChild(dot);
      a.appendChild(document.createTextNode(shortAddr(who)));
      m.appendChild(a);
    }
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

  // SWAPS MADE ON LUMOSCORE (RAZA 2026-09-16: "Platform activity is not showing the swaps that ive been doing on XRPL"). The feed
  // read only the LUMOS/XRP pool's own transactions, and a swap routed through an order book or another pool never touches it.
  // Every swap on this site is accompanied by its platform-fee payment to the collector, so the collector's incoming
  // payments name who swapped and when; the swap itself is that account's self-payment next to it. Merged into the feed
  // by time.
  //
  // THE FEE NOW COMES FIRST (RAZA 2026-09-17), and this pairing had not caught up: it searched BACKWARDS from each fee,
  // which was right when the fee followed the swap and is wrong now. Every label landed on the previous swap instead of
  // the one the fee belonged to — so the newest swap stayed unlabelled and older ones looked right only by accident.
  // The window now spans both sides of the fee and takes the nearest self-payment, which is correct for transactions
  // made before today as well as after.
  var COLLECTOR_ACCT = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';
  function platformSwaps() {
    return rpc('account_tx', { account: COLLECTOR_ACCT, limit: 20, binary: false, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (j) {
        var list = (j && j.result && j.result.transactions) || [];
        var fees = list.filter(function (e) {
          var t = e.tx || e.tx_json || {}, m = e.meta || e.metaData || {};
          return t.TransactionType === 'Payment' && t.Destination === COLLECTOR_ACCT && m.TransactionResult === 'tesSUCCESS';
        }).slice(0, 8);
        return Promise.all(fees.map(function (e) {
          var t = e.tx || e.tx_json || {};
          var L = e.ledger_index || t.ledger_index;
          if (!L) return null;
          return rpc('account_tx', {
            account: t.Account, ledger_index_min: L - 10, ledger_index_max: L + 30,
            limit: 20, binary: false, forward: true,
          })
            .then(function (j2) {
              var l2 = (j2 && j2.result && j2.result.transactions) || [];
              var best = null, bestGap = 1e9;
              for (var k = 0; k < l2.length; k++) {
                var x = l2[k].tx || l2[k].tx_json || {}, mm = l2[k].meta || l2[k].metaData || {};
                if (x.TransactionType !== 'Payment' || x.Account !== t.Account || x.Destination !== t.Account) continue;
                if (mm.TransactionResult !== 'tesSUCCESS') continue;
                var lg = l2[k].ledger_index || x.ledger_index || 0;
                // Ledgers after the fee are the current shape and win ties; before it covers swaps made before today.
                var gap = (lg >= L) ? (lg - L) : ((L - lg) + 0.5);
                if (gap < bestGap) { bestGap = gap; best = l2[k]; }
              }
              return best;
            }, function () { return null; });
        }));
      })
      // RETURNS the rows rather than inserting them. The feed is written once, by loadActivity, from both sources at
      // the same time — inserting here is what made the newest entries appear seconds after the rest.
      .then(function (swaps) {
        // These are swaps made on LumosCore, which is why the feed goes looking for them — but the TAG stays the kind,
        // "Swap", exactly as on Stellar. What matters is that the trade appears at all; the pill is not the place to
        // explain where it was made.
        return (swaps || []).filter(Boolean).map(function (s) {
          return { entry: s, label: null };
        });
      })
      .catch(function () { return []; });
  }

  // When the feed was written, in seconds since the Ripple epoch — the one field both sources always carry.
  function timeOf(entry) {
    if (!entry) return 0;
    var tx = entry.tx || entry.tx_json || {};
    if (entry.close_time_iso) return Date.parse(entry.close_time_iso) / 1000 - RIPPLE_EPOCH;
    return (tx.date != null ? tx.date : entry.date) || 0;
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
      // MATCHES STELLAR, which reads "Platform Activity — Stellar". This said "LUMOS pool activity"
      // because the feed is account_tx on the LUMOS/XRP AMM account, and I did not want a heading
      // claiming more than the data supports. RAZA's call is that it matches the Stellar heading,
      // and the chain suffix is the design's own pattern.
      h3.appendChild(document.createTextNode('Platform Activity — XRP Ledger'));
    }

    var note = function (msg) {
      host.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'activity-feed-row';
      d.textContent = msg;
      d.style.cssText = 'opacity:.6;justify-content:center';
      host.appendChild(d);
    };
    // EMPTY WHILE IT LOADS, NOT A MESSAGE (RAZA 2026-09-17: "on Stellar we're not showing anything like 'Reading the
    // ledger' so please dont show that on XRPL as well"). The design's mock rows still have to go — they are another
    // chain's transactions — but what replaces them is nothing at all until the real rows arrive. The failure and
    // empty-feed notes below stay: those are answers, not waiting.
    host.innerHTML = '';

    // BOTH SOURCES BEFORE ANYTHING IS DRAWN (RAZA 2026-09-17: "First it doesn't show new data then it suddently does").
    // The pool's own transactions answer in well under a second; the LumosCore swaps take a walk through the fee
    // collector's history and land a few seconds later. Painting the first and inserting the second is why the newest rows
    // appeared to arrive late — the feed visibly rearranged itself under the reader. They are gathered together and the
    // list is written once, newest first.
    // THE LUMOS POOL'S OWN TRANSACTIONS ARE NOT THIS PLATFORM'S (RAZA 2026-09-17: "are these trx really made on LumosCore
    // (XRPL). its not me and neither the XRPL is live for anyone else to use… This wallet addresses ending with: p5i9 and
    // kqv6 arent mine"). They were not his, and they were not made here: the feed also read `account_tx` on the LUMOS/XRP
    // AMM account, and ANY wallet on the ledger can swap against that pool from any app — xrpl.to, Sologenic, First Ledger,
    // an arbitrage bot. Real transactions, real strangers, filed under a heading that says this platform did them.
    //
    // lumoscore.com settled this exact question already, and its transform says so in as many words: the panel used to
    // stream Horizon's network-wide trades and "calling it 'platform' activity was a claim the data did not support". It
    // now reads `accounts/<fee account>/payments` — only transactions that paid LumosCore's fee. Nothing else.
    //
    // So this reads only the XRPL fee collector too. Before launch that means a nearly empty card, which is the honest
    // state of a platform nobody has used yet, rather than a busy one built out of other people's trades.
    Promise.all([
      Promise.resolve([]),
      platformSwaps(),
    ]).then(function (both) {
      var pool = both[0], mine = both[1] || [];
      if (pool === null && !mine.length) { note('Could not read the XRP Ledger.'); return; }
      var all = (pool || []).concat(mine);
      // One row per transaction: a LumosCore swap routed through the LUMOS pool arrives from both sources, and the copy
      // that knows it was made here is the one that keeps its name.
      var seen = {}, rows = [];
      all.forEach(function (r) {
        var h = (r.entry && (r.entry.hash || (r.entry.tx || r.entry.tx_json || {}).hash)) || '';
        if (h && seen[h]) {
          if (r.label && seen[h].label == null) seen[h].label = r.label;   // prefer "Swap on LumosCore"
          return;
        }
        if (h) seen[h] = r;
        rows.push(r);
      });
      rows.sort(function (a, b) { return timeOf(b.entry) - timeOf(a.entry); });
      if (!rows.length) { note('No recent activity.'); return; }
      host.innerHTML = '';
      rows.forEach(function (r) {
        var el = activityRow(r.entry);
        if (r.label) {
          var v = el.querySelector('.lx-actverb');
          if (v) v.textContent = r.label;
        }
        host.appendChild(el);
      });
    }).catch(function () {
      note('Could not read the XRP Ledger.');
    });
  }

  // ---- boot ------------------------------------------------------------------------------------

  // ---- the Quick actions row ------------------------------------------------------------------------
  //
  // THREE OF THE FOUR CARDS DID NOTHING. Only "Launch a token" is an <a href>; "Custom Swap / Orders",
  // "Add liquidity" and "My wallet" are bare <div>s. Stellar routes them from a layer of its own
  // (`lx-dashqa`) that this fork never received, so on XRPL they sat there with `cursor:pointer` and
  // no handler — the most prominent row on the page, and none of it worked.
  //
  // ROUTED TO PAGES, NOT TO THE DIALOGS, and that is deliberate. Stellar's router opens `#swapModal`
  // for Custom Swap and `#createPoolModal` for Add liquidity. Both ids exist here too — and both are
  // UNWIRED DESIGN MOCK on this build: `#swapModal` reads "You pay APT / You receive USDC / Rate
  // 1 APT ≈ 0.118 USDC" over a live-looking Swap button, and no write layer is injected on this page
  // to replace any of it. Opening those would be shipping a wrong-chain money dialog.
  //
  // The fallback is Stellar's OWN, not something invented here: its `target()` sends "custom swap" to
  // the trade page and "add liquidity" to the pools page whenever the matching dialog is unavailable.
  // That is exactly the case here, so the same rule applies with XRPL routes.
  //
  // Window capture, because the design claims clicks on cards and rows across these pages and routes
  // them through a Stellar-shaped resolver — a listener on the card is never early enough.
  //
  // SUPERSEDED 2026-09-15: both dialogs are wired now — browser/qorders.js drives `#swapModal` as
  // Stellar's "Custom Swap / Orders" (Swap, Limit, Orders) and browser/createpool.js drives
  // `#createPoolModal` — so the cards open them, exactly as Stellar's `lx-dashqa` does. RAZA: "On XRPL
  // it's a different popup from that we have on stellar" and "it redirects to Pools main page".
  // The routes below remain the fallback for a page that genuinely lacks the dialog, which is also
  // Stellar's rule.
  var QA_ROUTES = [
    [/^custom swap/i, '/trade/xrpl'],
    [/^add liquidity/i, '/pools/xrpl'],
    [/^my wallet/i, '/wallet'],
  ];

  // Stellar's opener, verbatim in behaviour: add `open`, and force display when the dialog is an
  // inline-styled panel (#swapModal is `display:none` in its style attribute, so a class alone cannot
  // show it).
  function openDialog(m) {
    try {
      m.classList.add('open');
      if (getComputedStyle(m).display === 'none') m.style.display = 'flex';
      return true;
    } catch (e) { return false; }
  }

  function wireQuickCards() {
    if (window.__lxxDashQA) return;
    window.__lxxDashQA = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var card = t.closest('.quick-actions .quick-card');
      if (!card) return;
      // "Launch a token" is a real anchor and already goes where it should.
      if (card.tagName === 'A' && card.getAttribute('href')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;

      var ttl = ((card.querySelector('.ttl') || {}).textContent || '').trim();

      // Custom Swap opens the REAL dialog when this page has one to open. `#modalSwap` is the
      // dialog write.js drives — the same element and the same code path the wallet's Swap button
      // uses — so it arrives with live XRP balances, a real rate and the real network fee.
      //
      // `#swapModal` is NOT that dialog. Both ids exist here: it is the design's unwired twin, still
      // reading "1 APT ≈ 0.118 USDC", and it is left shut. Stellar does the mirror image of this —
      // it opens its wired dialog and force-closes the twin.
      //
      // Where there is no wired dialog (the phone build ships only the twin), the card keeps routing
      // to the trade page, which is Stellar's own fallback for exactly this case.
      //
      // Since 2026-09-15 the card opens `#swapModal` — Stellar's own "Custom Swap / Orders" dialog, now
      // driven by browser/qorders.js — and NOT `#modalSwap`, which is the wallet page's plain FROM/TO box
      // that RAZA saw appearing here as "a different popup". Stellar's `lx-dashqa` makes exactly this
      // distinction in its notes. "Add liquidity" opens `#createPoolModal`, driven by createpool.js.
      var dlg = /^custom swap/i.test(ttl) ? document.getElementById('swapModal')
        : (/^add liquidity/i.test(ttl) ? document.getElementById('createPoolModal') : null);
      if (dlg && openDialog(dlg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (dlg.id === 'createPoolModal') { try { document.body.style.overflow = 'hidden'; } catch (x) {} }
        try { window.dispatchEvent(new CustomEvent('lxx:dialog', { detail: dlg.id })); } catch (x) {}
        return;
      }

      for (var i = 0; i < QA_ROUTES.length; i++) {
        if (QA_ROUTES[i][0].test(ttl)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.location.href = QA_ROUTES[i][1];
          return;
        }
      }
    }, true);
  }

  // `honestDashDialogs()` USED TO SIT HERE, disabling #swapModal's and #createPoolModal's buttons and
  // relabelling them "Not enabled here" while both were unwired mock. Removed 2026-09-15 when
  // browser/qorders.js and browser/createpool.js wired them: a guard that outlives the problem it guarded
  // against is its own bug — the same thing that happened to #modalSwap before it.

  function load() {
    if (!$('.status-row') && !$('#activityList')) return;      // not the dashboard

    wireQuickCards();

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
