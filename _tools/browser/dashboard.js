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

  // ---- the feed row's leading mark ---------------------------------------------------------------
  // One glyph per kind of action, keyed on the same class the verb chip already uses. Stroke-only and
  // currentColor so the single colour rule below tints the mark and its disc together.
  var KIND_SVG = (function () {
    function s(p) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
    }
    return {
      swap: s('<path d="M4.8 9.2h13.6M15.4 6.2l3 3-3 3"/><path d="M19.2 14.8H5.6M8.6 11.8l-3 3 3 3"/>'),
      transfer: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
      lp: s('<path d="M12 3.4l4.2 5a5.5 5.5 0 1 1-8.4 0z"/>'),
      order: s('<path d="M4 7h16M4 12h10M4 17h7"/>'),
      _: s('<circle cx="12" cy="12" r="7"/>')
    };
  })();

  // Ported from Stellar's _realdata.js, which is where this mark is defined — the fork copied the
  // containers BEFORE it existed, so the inherited sheet hides .act-ic without supplying the .lx-fg
  // that replaced it. Only the rules this feed actually uses are brought over; the asset-pair variants
  // are deliberately left out, because this row leads with the type rather than the assets.
  // "N in 24h" beside the heading, as Stellar has it. The .lx-act24 rule came across with the fork —
  // only the element creating it was missing — so this needs no CSS of its own.
  // Counted off the rows actually on screen, each of which carries its ledger time in data-t, so the
  // figure can never disagree with the list under it. data-t is a RIPPLE timestamp (seconds since
  // 2000-01-01), not unix — reading it as unix would put every row in 1970 and the count at zero.
  function paint24(host) {
    try {
      var card = host && host.closest('.activity-card');
      var head = card && (card.querySelector('.market-head') || card.querySelector('h3'));
      if (!head) return;
      var cut = Date.now() / 1000 - 86400, n = 0;
      [].slice.call(host.querySelectorAll('.activity-feed-row[data-t]')).forEach(function (r) {
        var t = +r.getAttribute('data-t');
        if (isFinite(t) && t > 0 && (t + RIPPLE_EPOCH) >= cut) n++;
      });
      var el = head.querySelector('.lx-act24');
      if (!n) { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
      if (!el) {
        el = document.createElement('span');
        el.className = 'lx-act24';
        el.setAttribute('data-lx-noswap', '1');
        el.setAttribute('data-logoed', '1');   // short text in a pill is exactly what the healer grabs
        head.appendChild(el);
      }
      el.textContent = n + ' in 24h';
      el.title = (n === 1 ? '1 transaction' : n + ' transactions') + ' through LumosCore in the last 24 hours';
    } catch (e) {}
  }

  var feedCssDone = false;
  function injectFeedCss() {
    if (feedCssDone) return;
    feedCssDone = true;
    try {
      if (document.getElementById('lx-xrplfeed-css')) return;
      var st = document.createElement('style');
      st.id = 'lx-xrplfeed-css';
      st.textContent =
        '.activity-feed-row .lx-fg{position:relative;flex:0 0 42px;width:42px;height:42px;display:block}'
        // The asset-pair variant, copied from Stellar's _realdata.js rather than re-derived — one mark
        // at 36px when a row has a single asset, 32 + 23 overlapped when it has two, the smaller one
        // ringed in the card's own surface colour so it reads as in front rather than merged.
        + '.activity-feed-row .lx-fg .act-inl.lx-fgi{position:absolute;margin:0!important;'
        + 'vertical-align:0!important;border-radius:50%}'
        + '.activity-feed-row .lx-fg:not(.lx-fg2) .lx-fgi{left:3px;top:3px;width:36px!important;height:36px!important}'
        + '.activity-feed-row .lx-fg2 .lx-fga .lx-fgi{left:0;top:0;width:32px!important;height:32px!important}'
        + '.activity-feed-row .lx-fg2 .lx-fgb .lx-fgi{right:-1px;bottom:-1px;width:23px!important;'
        + 'height:23px!important;box-shadow:0 0 0 2.5px var(--surface,var(--bg-2,#141419))}'
        + '.activity-feed-row .lx-fgt{display:flex!important;align-items:center;justify-content:center;'
        + 'border-radius:50%;color:#94a3b8;background:color-mix(in srgb,currentColor 15%,transparent)}'
        + '.activity-feed-row .lx-fgt svg{width:19px;height:19px;display:block}'
        + '.activity-feed-row .lx-fgt.swap{color:#8b7bff}'
        + '.activity-feed-row .lx-fgt.transfer{color:#22c55e}'
        + '.activity-feed-row .lx-fgt.lp{color:#2dd4bf}'
        + '.activity-feed-row .lx-fgt.order{color:#f472b6}'
        // The cross-chain badge had no colour of its own, so it fell back to the default grey while
        // every other kind had one. Blue, matching the CROSS-CHAIN chip on lumoscore.com.
        + '.activity-feed-row .lx-fgt.xchain{color:#38bdf8}'
        + '.activity-feed-row .lx-actvia{opacity:.78;margin-left:6px}'
        + '.activity-feed-row .lx-actvia{display:inline-flex;align-items:center;gap:5px}'
        + '.activity-feed-row .lx-actvialogo{width:13px;height:13px;border-radius:50%;display:block;flex:0 0 13px}'
        // color-mix is not everywhere yet, and without a disc the glyph floats against the row.
        + '@supports not (background:color-mix(in srgb,red 15%,transparent)){'
        + '.activity-feed-row .lx-fgt{background:rgba(127,127,140,.14)}}'
        + '@media(max-width:760px){.activity-feed-row .lx-fg{flex:0 0 34px;width:34px;height:34px}'
        + '.activity-feed-row .lx-fgt svg{width:16px;height:16px}}'
        // THE RIGHT-HAND COLUMN, and the reason this row was cramped on a phone.
        //
        // Stellar puts the timestamp and the explorer mark in ONE wrapper that stacks them
        // (_realdata.js: '<div class="lx-frr"><div class="time">…</div><a class="lx-actlink">…</a></div>').
        // This feed appended both straight onto the row, so on a flex row they sat SIDE BY SIDE and
        // each paid for its own gap. Measured at 375px, same 342px row: Stellar's .info got 245px,
        // this one got 177px -- 68px narrower -- and "100.0K LUMOS -> 2.46 XRP" wrapped onto three
        // lines against Stellar's two.
        //
        // The class was never in this build at all (0 occurrences against Stellar's 4): .lx-frr is
        // created by _realdata.js, a Stellar transform the fork does not run, so the markup had
        // nothing to stack it even if it had been nested. Declarations copied from there verbatim
        // rather than re-derived, for the same reason the glyph rules above were.
        + '.activity-feed-row .lx-frr{flex:0 0 auto;display:flex;flex-direction:column;'
        + 'align-items:flex-end;gap:8px}'
        + '.activity-feed-row .lx-frr .time{min-width:0;font-size:12.5px}'
        // The inherited sheet fades the mark until the row is hovered and gives it a left margin,
        // which is wrong once it is stacked under the time rather than beside it.
        + '.activity-feed-row .lx-frr .lx-actlink{margin-left:0}';
      document.head.appendChild(st);
    } catch (e) {}
  }
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

  // A CALL THAT NEVER ANSWERS USED TO WAIT FOREVER (RAZA 2026-10-17: "Platform activity on landing
  // page takes ages to appear and sometimes doesn't appear until i refresh the page"). This is a
  // direct browser call to xrplcluster.com -- not through our edge, so it is uncached, and the
  // dashboard makes two dozen of them on a cold load. With no timeout, one hung socket left the card
  // blank until the reader reloaded, which is precisely what he described.
  //
  // Eight seconds: longer than the slowest honest answer measured (833ms from here, and his round
  // trip is several times that), short enough that a stall becomes a message rather than a wait.
  // Every ledger read here goes through the shared retrying transport (xrpl-core: ledgerPost), so a
  // throttle is waited out instead of reported as a dead ledger. xrplcluster meters by units, not
  // requests, and the two dozen calls below can spend the quota on their own.
  //
  // It resolves with the same parsed envelope fetch().json() did, errors included, so the handling
  // below is unchanged. The fallback keeps the old behaviour exactly if lxx has not loaded.
  function lxpost(u, o) {
    try { return window.lxx.ledgerPost(u, o); }
    catch (e) { return fetch(u, o).then(function (r) { return r.json(); }); }
  }

  function rpc(method, params) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 8000);
    // The 8s ceiling stays whole-call on purpose and still outranks the retry: this card's bug was a
    // hung socket leaving it blank, so "give up and say so" beats "keep waiting" here. A short
    // throttle is now ridden out inside the budget; one quoting longer than 8s still aborts, which
    // is the deliberate trade rather than an oversight.
    return lxpost(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined,
    }).then(function (j) {
      clearTimeout(timer);
      return j;
    }, function (e) { clearTimeout(timer); throw e; });
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
    // A DESTINATION CHAIN IS NOT AN XRPL TOKEN, so its mark cannot come from the thumb proxy -- it is
    // a file we already ship. A caller hands one in as a.logo; every other path is unchanged.
    if (a.logo) { s.style.backgroundImage = 'url("' + a.logo + '")'; return s; }
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
  // THE WHOLE OF STELLAR'S `amt()`, PORTED (RAZA 2026-10-07: "we only show 3 digits on stellar after
  // decimal and then put .. which makes it much neater. also do this on XRPL. Use same logic").
  //
  // My first pass took only the subscript half of it and got even that wrong — it kept FOUR digits
  // where lumoscore.com keeps three. The rest of the rule was the part he is pointing at, so this is
  // the function from `_realdata.js` end to end rather than another partial copy:
  //
  //   >= 1e3   K / M / B
  //   >= 1     two decimals, trailing zeros dropped — "1", not "1.00"
  //   < 1      three leading zeros or more  -> subscript, three digits  (0.0000998 -> 0.0₃998)
  //            otherwise cut after three decimals with an ellipsis       (0.099123  -> 0.099…)
  //            unless those three decimals are all zero, in which case keep three SIGNIFICANT
  //            digits, because "0.000" says nothing                      (0.0000998 handled above)
  //
  // TRUNCATED, NEVER ROUNDED — Stellar's note, kept: 0.00998 reads 0.009, not 0.01. A feed row should
  // not report a number larger than the one on the ledger, however slightly.
  //
  // ONE DELIBERATE DIFFERENCE. Stellar builds its string with toFixed(7) and floors at
  // "<0.0000001", because a Stellar amount stops at seven decimals. An XRP Ledger token amount does
  // not — it carries fifteen significant digits and a real exponent — so flooring there would print
  // "<0.0000001" for figures this ledger represents exactly. The string is built deeper and the
  // subscript branch, which handles any run of zeros, takes it from there.
  function amtNum(n) {
    n = +n || 0;
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    if (a >= 1) return (Math.round(n * 100) / 100).toString();
    if (!(a > 0)) return '0';

    // FIFTEEN, NOT EIGHTEEN, and the difference is visible: a plain 0.1 XRP swap printed "0.100…".
    // `(0.1).toFixed(18)` is "0.100000000000000006" — binary floating point, not the ledger — so the
    // trim left a long string, the three-decimal cut fired, and an exact number grew an ellipsis
    // claiming there was more of it. Fifteen is where doubles stop lying AND what an XRPL token
    // amount carries (fifteen significant digits), so it is the right answer twice.
    var s = n.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
    if (!s || s === '0' || s === '-0') {
      // Below 1e-15. Expanded rather than floored, so the subscript branch can still describe it —
      // this ledger can represent amounts that far down even if doubles get vague about them.
      s = n.toFixed(30).replace(/0+$/, '').replace(/\.$/, '');
      if (!s || s === '0' || s === '-0') return '0';
    }

    var z = /^(-?)0\.(0+)([0-9]+)$/.exec(s);
    if (z && z[2].length >= 3) {
      var SUB = '₀₁₂₃₄₅₆₇₈₉';
      var tag = String(z[2].length - 1).split('').map(function (d) { return SUB.charAt(+d); }).join('');
      return z[1] + '0.0' + tag + z[3].slice(0, 3);
    }
    var dot = s.indexOf('.');
    if (dot < 0 || s.length <= dot + 4) return s;
    var head = s.slice(0, dot + 4);
    if (/[1-9]/.test(head.slice(dot + 1))) return head + '…';
    var m = /^(-?0\.0*)(\d+)$/.exec(s);
    if (m) return m[1] + m[2].slice(0, 3) + (m[2].length > 3 ? '…' : '');
    return s;
  }

  function amtStr(a) {
    if (!a || !isFinite(a.v)) return '';
    if (a.v >= 1e17) return a.c;                     // the no-limit sentinel: name the asset only
    return amtNum(a.v) + ' ' + a.c;
  }

  // WHAT A PATH PAYMENT'S `Amount` ACTUALLY IS: the most the sender is willing to have delivered,
  // not what arrived. Measured on this very pool -- claimed 9,718.80 SHROOMIES against 6,479.10
  // delivered (33% less), and claimed 1e80 MXI against 4,102.42. The exact figure is in the
  // METADATA. Reading `Amount` would overstate every swap on the feed.
  // What the two sides of a pool action actually moved, from the metadata rather than the request.
  //
  // Walks the account's own balance changes: its AccountRoot for XRP and its RippleState lines for
  // tokens. Three details that are easy to get wrong and were checked against real transactions:
  //
  //   * THE NETWORK FEE IS ADDED BACK. It comes out of the same AccountRoot, so without this a pool
  //     deposit of exactly 1 XRP reads as 1.000012 — the fee is not liquidity.
  //   * THE LP TOKEN IS SKIPPED. Every AMM action also moves the pool's own LP token, whose currency
  //     code begins with 03. Left in, it would appear as a third asset nobody deposited.
  //   * A RippleState Balance IS SIGNED FROM THE LOW ACCOUNT'S SIDE, so the delta is negated when
  //     this account is the high one. Getting that backwards turns every deposit into a withdrawal.
  function lpDeltas(meta, tx) {
    var me = tx.Account, out = [];
    var nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length && out.length < 2; i++) {
      var w = nodes[i].ModifiedNode || nodes[i].DeletedNode || nodes[i].CreatedNode;
      if (!w) continue;
      var f = w.FinalFields || w.NewFields || {}, pv = w.PreviousFields || {};
      if (w.LedgerEntryType === 'AccountRoot') {
        if (f.Account !== me || pv.Balance === undefined) continue;
        var d = (Number(f.Balance) - Number(pv.Balance)) / 1e6 + (Number(tx.Fee || 0) / 1e6);
        if (Math.abs(d) > 1e-9) out.push({ v: d, c: 'XRP', raw: 'XRP', i: '' });
      } else if (w.LedgerEntryType === 'RippleState') {
        var bal = f.Balance || {}, pb = pv.Balance;
        if (pb === undefined || !bal.currency) continue;
        if (/^03/.test(String(bal.currency))) continue;              // the pool's own LP token
        var hi = (f.HighLimit || {}).issuer, lo = (f.LowLimit || {}).issuer;
        if (hi !== me && lo !== me) continue;
        var dv = (Number(bal.value) - Number(pb.value)) * (lo === me ? 1 : -1);
        if (Math.abs(dv) > 1e-12) {
          out.push({ v: dv, c: curName(bal.currency), raw: bal.currency, i: (lo === me ? hi : lo) });
        }
      }
    }
    return out;
  }

  function describe(tx, meta) {
    var type = tx.TransactionType;

    // CROSS-CHAIN BEFORE SWAP/TRANSFER, because a bridge IS a Payment and would otherwise fall
    // through to the branch below and be labelled Transfer -- true but useless, and it would not say
    // where the money went.
    var br = bridgeOf(tx);
    if (br) {
      var sentAmt = amountOf(tx.Amount) || amountOf(tx.SendMax);
      var moved2 = sentAmt ? sentByAccount(meta, tx, sentAmt) : 0;
      if (moved2 > 0) sentAmt = { v: moved2, c: sentAmt.c, raw: sentAmt.raw, i: sentAmt.i };
      // NAMED ONLY WHEN THE NAME IS REAL. THORChain's memo abbreviates the chain to a letter or two
      // ("=:a:0x…" is Avalanche), and a row reading "2.0 XRP -> A" is worse than one that just says it
      // was bridged. Axelar states the chain in full, so that one always names it.
      var where = (br.chain && br.chain.length >= 3)
        ? (br.chain.charAt(0).toUpperCase() + br.chain.slice(1)) : '';
      var txt = (sentAmt ? amtStr(sentAmt) : '') + (where ? (' \u2192 ' + where) : '');
      return {
        cls: 'xchain', tag: 'Cross-chain', via: br.via,
        type: 'Bridged via ' + br.via, meta: txt,
        parts: sentAmt
          ? (where
              ? [{ a: sentAmt }, ' \u2192 ', { a: { c: where, logo: chainLogo(where) }, nameOnly: true }]
              : [{ a: sentAmt }])
          : null,
      };
    }
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
      // `skip` follows Stellar, which stopped publishing plain transfers on 2026-10-27 for privacy:
      // a wallet-to-wallet payment names both ends and the amount, and it is not a platform action.
      // Swaps and bridges are not transfers and are not touched. The shape is kept intact rather
      // than removed so the row can come back if transfers are ever shown differently.
      return {
        cls: isSwap ? 'swap' : 'transfer', tag: isSwap ? 'Swap' : 'Transfer',
        type: 'Swap through the LUMOS pool', meta: text, parts: pp,
        skip: isSwap ? 0 : 1,
      };
    }

    // THE TWO AMOUNTS, SIGNED, AS ON STELLAR (RAZA 2026-10-07: "Liquidity deposit and withdrawal is
    // showing differently on Platform activity on Stellar"). lumoscore.com renders
    // "+20.0K ⟡ TKG · +347.3K ⟡ LUMOS" over a LIQUIDITY ADDED pill — the amounts ARE the line. These
    // rows read "LUMOS/XRP pool", a hardcoded string that was also simply wrong once pools other than
    // that one could appear.
    //
    // THE AMOUNTS ARE NOT ALWAYS IN THE TRANSACTION, which is the part worth knowing: an AMMWithdraw
    // sent with tfWithdrawAll carries no Amount or Amount2 at all — measured on RAZA's own withdrawals,
    // Flags 131072 and both fields absent. Only the metadata says what came back, so both deposits and
    // withdrawals are read from the balance changes rather than from the request, which also makes the
    // figure the amount that actually moved rather than the one that was asked for.
    if (type === 'AMMDeposit' || type === 'AMMWithdraw' || type === 'AMMCreate') {
      var dep = type !== 'AMMWithdraw';
      var lpa = lpDeltas(meta, tx);
      var lpParts = [];
      for (var li = 0; li < lpa.length; li++) {
        if (li) lpParts.push(' · ');
        // THE SIGN IS THE POOL'S, NOT THE WALLET'S. Read off lumoscore.com: a deposit is "+20.0K TKG"
        // in green and a withdrawal is "-149.98 XLM" in red — it describes what happened to the POOL.
        // The wallet's balance moves the opposite way, so signing from the delta (which is what this
        // did at first) printed every deposit red with a minus and every withdrawal green with a plus:
        // correct arithmetic, backwards meaning, and the exact opposite of the feed beside it.
        lpParts.push({ a: { v: Math.abs(lpa[li].v), c: lpa[li].c, raw: lpa[li].raw, i: lpa[li].i }, lp: 1, pos: dep });
      }
      // TWO PILLS, NOT THREE (RAZA 2026-10-07: "on xrpl it says pool created while on stellar its
      // liquidity added and withdrawn"). Stellar has no "pool created" state because creating a pool
      // there IS a deposit — `liquidity_pool_deposit` — so its feed only ever reads LIQUIDITY ADDED or
      // LIQUIDITY WITHDRAWN. An AMMCreate is the same act on this ledger: liquidity going in, and the
      // first lot of it. It takes the deposit pill like any other.
      return {
        cls: 'lp',
        tag: dep ? 'Liquidity added' : 'Liquidity withdrawn',
        type: dep ? 'Liquidity added' : 'Liquidity withdrawn',
        meta: lpa.length ? '' : (dep ? 'Liquidity added' : 'Liquidity withdrawn'),
        parts: lpParts,
      };
    }
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
    // Both skipped, as on Stellar. Neither carries an amount or a trade: a cancellation is an offer
    // withdrawn and a trust line is an account declaring which asset it is willing to hold. They name
    // an account and nothing else, and one wallet opening five trust lines fills the card with five
    // identical rows. "Order placed" above keeps its row, because that one has a real size.
    if (type === 'OfferCancel') return { cls: 'order', tag: 'Order cancelled', type: 'DEX offer cancelled', meta: '', skip: 1 };
    if (type === 'TrustSet') return { cls: '', tag: 'Trust line', type: 'Trust line set', meta: '', skip: 1 };
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

  // The waiting row's own rule. Injected once by id so a re-render cannot stack copies, and it reuses
  // `lxdbxshim` — the shimmer keyframe the stat pills already define on this page, confirmed present
  // in the built output — rather than declaring a second animation that would drift from it.
  function skelCss() {
    if (document.getElementById('lx-actskel-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-actskel-css';
    st.textContent = '.lx-actskel{display:inline-block;height:15px;border-radius:6px;vertical-align:-2px;'
      + 'background-image:linear-gradient(90deg,rgba(140,140,150,.10),rgba(140,140,150,.22),rgba(140,140,150,.10));'
      + 'background-size:200% 100%;animation:lxdbxshim 1.2s ease-in-out infinite}'
      + '.lx-actskel-s{height:11px;border-radius:5px}'
      // The mark slot, so the row does not start with a hole where every real row has a logo.
      + '.lx-actwait .lx-fg{display:inline-block;width:28px;height:28px;border-radius:50%;'
      + 'background:rgba(127,127,140,.14)}'
      + '@media(prefers-reduced-motion:reduce){.lx-actskel{animation:none}}';
    (document.head || document.documentElement).appendChild(st);
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

    // .lx-fg, NOT .act-ic. The row used to lead with an .act-ic holding a plain dot — and the
    // stylesheet that came across with the fork carries
    //     .activity-feed-row .act-ic{display:none!important}
    // so that dot has never been visible here. Stellar hides the same slot and leads with .lx-fg
    // instead, which is why its rows open with a coloured mark and these opened straight into text.
    // (RAZA 2026-10-01: "Platform activity on Dashboard on XRPL is not like Stellar.")
    //
    // THE ASSET PAIR, NOT THE TYPE GLYPH, WHEN THE ROW HAS ASSETS (RAZA 2026-10-07, reporting the same
    // heading a second time). The first pass here chose the type variant on the argument that the
    // amounts beside it already carry their own chips, so a second copy of the logo adds nothing.
    // That reasoning is fine and it is not what lumoscore.com does: its rows open with the two token
    // marks stacked, and only fall back to a coloured glyph when a row HAS no asset pair — a
    // cancelled order, a trust line. Matching it is the whole point of the report, so the rule is
    // Stellar's: `r.pair.a` present → logos; otherwise the glyph.
    //
    // The pair is read off the parts this row already renders, in order, so it cannot disagree with
    // the line beside it: first asset large, second tucked bottom-right.
    injectFeedCss();
    // A POOL ROW KEEPS THE DROPLET. Stellar builds its pair badge only for rows that set one, and its
    // liquidity rows set `ic:DROP` instead — so a pool action there opens with the teal droplet even
    // though the line beside it names two assets. Now that these rows carry amounts, the pair logic
    // below would otherwise claim them.
    var pair = [];
    if (d.cls !== 'lp' && d.parts && d.parts.length) {
      for (var qi = 0; qi < d.parts.length && pair.length < 2; qi++) {
        var q = d.parts[qi];
        if (q && typeof q !== 'string' && q.a && q.a.c) pair.push(q.a);
      }
    }
    var ic = document.createElement('span');
    ic.setAttribute('aria-hidden', 'true');
    if (pair.length) {
      ic.className = 'lx-fg' + (pair.length > 1 ? ' lx-fg2' : '');
      var fga = document.createElement('span');
      fga.className = 'lx-fga';
      var ca = assetChip(pair[0]); ca.className += ' lx-fgi';
      fga.appendChild(ca);
      ic.appendChild(fga);
      if (pair.length > 1) {
        var fgb = document.createElement('span');
        fgb.className = 'lx-fgb';
        var cb = assetChip(pair[1]); cb.className += ' lx-fgi';
        fgb.appendChild(cb);
        ic.appendChild(fgb);
      }
    } else {
      ic.className = 'lx-fg lx-fgt ' + (d.cls || '');
      // Drawn rather than lettered: the logo healer repaints short text as a ticker mark and skips
      // anything containing an svg — the same reason the dot this replaces was one.
      ic.innerHTML = KIND_SVG[d.cls] || KIND_SVG._;
    }
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
        // A POOL AMOUNT LEADS WITH ITS SIGN, in Stellar's own shape and its own classes:
        // <b><span class="lx-lppos">+20.0K</span> ⟡ TKG</b>. `lx-lppos` / `lx-lpneg` came across with
        // the fork and had nothing using them. Everything else keeps the chip-first order this feed
        // already uses.
        if (p.lp) {
          var sg = document.createElement('span');
          sg.className = p.pos ? 'lx-lppos' : 'lx-lpneg';
          sg.setAttribute('data-logoed', '1');
          sg.textContent = (p.pos ? '+' : '-') + amtStr({ v: Math.abs(p.a.v), c: '' }).trim();
          b.appendChild(sg);
          b.appendChild(document.createTextNode(' '));
          b.appendChild(assetChip(p.a));
          b.appendChild(document.createTextNode(p.a.c));
        } else {
          b.appendChild(assetChip(p.a));
          b.appendChild(document.createTextNode(p.nameOnly ? p.a.c : amtStr(p.a)));
        }
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
    // WHICH BRIDGE, AS A SECOND CHIP (RAZA 2026-10-12: "Cross chain trxs are appearing differently on
    // XRPL on Dashboard platform activity if compared to stellar"). lumoscore.com reads
    // "CROSS-CHAIN | via NEAR Intents" and this row carried only the first, so the same transfer
    // looked like a different kind of event on the two chains. Reuses .lx-actverb so it inherits the
    // pill the design already styles, with .lx-actvia to sit a shade back from the kind chip.
    if (d.via) {
      var via = document.createElement('span');
      via.className = 'lx-actverb lx-actvia';
      via.setAttribute('data-logoed', '1');   // 'via Axelar' is short text in a pill — the logo healer's exact target
      var vsrc = VIA_LOGO[d.via];
      if (vsrc) {
        var vimg = document.createElement('img');
        vimg.className = 'lx-actvialogo';
        vimg.src = vsrc;
        vimg.alt = '';
        // NOT lazy. These are 13px brand marks inside a scrolling feed, so lazy-loading them means a
        // pill sits wordless-and-markless until the row is scrolled into view -- measured: the Axelar
        // logo reported naturalWidth 0 with inViewport false while the file served a perfectly good
        // 96x96 PNG. A few KB fetched eagerly is the right trade for an icon this small.
        // A broken file must not leave a torn icon in the pill; the words carry it on their own.
        vimg.onerror = function () { if (vimg.parentNode) vimg.parentNode.removeChild(vimg); };
        via.appendChild(vimg);
      }
      via.appendChild(document.createTextNode('via ' + d.via));
      m.appendChild(via);
    }
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

    // ONE COLUMN FOR BOTH, as on Stellar -- see the .lx-frr note in injectFeedCss(). These used to be
    // appended straight onto the row, which made them two flex siblings competing for width with .info.
    var frr = document.createElement('div');
    frr.className = 'lx-frr';

    var time = document.createElement('div');
    time.className = 'time';
    time.textContent = ago(date);
    frr.appendChild(time);

    // The explorer mark, under the timestamp. The stylesheet for it came across with the design
    // (`.activity-feed-row .lx-actlink`, faded until the row is hovered) and had nothing to style,
    // because this feed stopped at the timestamp.
    try {
      var xl = window.lxxExplorer && window.lxxExplorer.link(
        window.lxxExplorer.txHash(entry), 'View this transaction on Bithomp');
      if (xl) frr.appendChild(xl);
    } catch (e) {}

    row.appendChild(frr);

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
  // THIS CARD'S READS GO THROUGH THE EDGE, CACHED, because they are the same for every visitor.
  //
  // RAZA 2026-10-18, user report: "platform activity takes extremely long to appear. And sometimes it
  // doesnt even load", with the card showing "Could not read the XRP Ledger."
  //
  // The cost is the reason: one account_tx for the collector plus one AT limit 200 per fee-paying
  // account, up to twelve — thirteen of the heaviest read the ledger offers, from the reader's own
  // browser, against a node that meters by UNITS not requests. One dashboard load can spend that
  // budget alone, and whatever the node then refuses is the error on the card.
  //
  // None of it is personal data: every visitor was paying thirteen metered calls for an identical
  // list. /lxapi/xrpltx asks Ripple's node from the edge and caches for 60s, so the first reader pays
  // once and everyone behind them is served from cache, off their own IP.
  //
  // Falls back to the direct call, so a missing or unhappy endpoint behaves exactly as before.
  function txOf(account, limit) {
    var direct = function () {
      return rpc('account_tx', { account: account, limit: limit, binary: false, ledger_index_min: -1, ledger_index_max: -1 });
    };
    var ctl = null, timer = null, o = {};
    try {
      ctl = new AbortController(); o.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 9000);
    } catch (e) {}
    var done = function () { if (timer) { clearTimeout(timer); timer = null; } };
    return fetch('/lxapi/xrpltx?a=' + encodeURIComponent(account) + '&n=' + limit, o).then(function (r) {
      done();
      if (!r.ok) return direct();
      return r.json().then(function (j) {
        if (!j || !j.ok || !j.result) return direct();
        // The same envelope the node's rpc() returns, so every reader below is unchanged.
        return { result: j.result };
      }, direct);
    }, function () { done(); return direct(); });
  }

  function platformSwaps() {
    // Filled from the same per-account windows the swap pairing already reads — see the note there.
    var pools = [];
    return txOf(COLLECTOR_ACCT, 20)
      .then(function (j) {
        // A LEDGER THAT DID NOT ANSWER IS NOT A PLATFORM WITH NO ACTIVITY. Without this the card
        // read "No recent activity." whenever this first call failed -- the same sentence it shows
        // when the platform genuinely has none. Stating an unverified negative, which is the mistake
        // [[never-cache-a-failure-as-an-answer]] records in its other form.
        if (!j || !j.result || j.result.error) throw new Error('ledger unavailable');
        var list = (j.result.transactions) || [];
        // SIXTY, NOT EIGHT (RAZA 2026-10-17: "Platform activity on dashboard is showing less number
        // of recent transactions if compared to Stellar. Please make sure its showing the same number
        // of recent transactions on XRPL too"). Measured side by side on production: Stellar's feed
        // renders 50 rows, this one rendered 9. The cap was never a judgement about how much history
        // is worth showing -- it was protection against the request-per-fee pairing below, which is
        // gone. See the note there.
        var fees = list.filter(function (e) {
          var t = e.tx || e.tx_json || {}, m = e.meta || e.metaData || {};
          return t.TransactionType === 'Payment' && t.Destination === COLLECTOR_ACCT && m.TransactionResult === 'tesSUCCESS';
        }).slice(0, 60);

        // THE POOL ACTIONS NEED THEIR OWN PASS, and piggybacking on the fee windows was my mistake.
        // Those windows span L-10 to L+30 around a FEE PAYMENT, which is right for finding the swap a
        // fee belongs to and useless for anything free: a pool deposit pays no fee, so it is almost
        // never within thirty ledgers of one. RAZA created a pool and withdrew on 2026-10-07 at 12:20,
        // both correctly memo-marked, and neither appeared — they were simply outside every window
        // being read.
        //
        // One unbounded `account_tx` per account that has used LumosCore instead, which is where free
        // actions actually live. Capped at five accounts so the feed cannot grow a request per user,
        // and still gated on the memo: the account list says WHO has used this site, the memo says
        // WHICH of their transactions were made on it.
        var accts = [];
        fees.forEach(function (e) {
          var a = (e.tx || e.tx_json || {}).Account;
          if (a && accts.indexOf(a) < 0) accts.push(a);
        });
        // ONE REQUEST PER ACCOUNT, AND THE SWAP PAIRING NOW READS THE SAME LIST.
        //
        // The pairing below used to spend an `account_tx` PER FEE to find the swap each fee belonged
        // to -- so showing more history meant more requests, one per row, which is why the fee list
        // was capped at eight. But the account's own transaction list already contains that swap: it
        // is the same account, and we are already fetching it here for the free actions. Pairing in
        // memory makes the cost 1 + accounts instead of 1 + accounts + fees, and lets the caps rise.
        //
        // Measured before and after on the same dashboard: 14 ledger requests for 9 rows, against 13
        // for the full history. Fewer requests, five times the feed.
        var byAcct = {};
        var freeScan = Promise.all(accts.slice(0, 12).map(function (a) {
          // The twelve heavy ones. These are what actually exhausted the visitor's unit budget, and
          // they cache best: a fee-paying account's history is identical for every reader of this card.
          return txOf(a, 200)
            .then(function (jr) {
              var l = (jr && jr.result && jr.result.transactions) || [];
              byAcct[a] = l;
              for (var i = 0; i < l.length; i++) {
                var x = l[i].tx || l[i].tx_json || {}, mm = l[i].meta || l[i].metaData || {};
                if (mm.TransactionResult !== 'tesSUCCESS') continue;
                // A bridge carries its route's own memo rather than ours, so it is admitted on that
                // instead of on hasLumosMemo -- the Axelar transfer has no LumosCore memo at all and
                // pays us no fee, so this scan is the ONLY place it can be found.
                if (bridgeOf(x)) { pools.push(l[i]); continue; }
                if (!/^(AMM(Create|Deposit|Withdraw)|OfferCreate)$/.test(x.TransactionType || '')) continue;
                if (!hasLumosMemo(x)) continue;
                pools.push(l[i]);
              }
            }, function () { byAcct[a] = []; });
        }));

        // PAIRED IN MEMORY, from the lists freeScan already fetched. The matching rule is unchanged
        // -- a self-payment by the same account nearest the fee's ledger, those after it winning ties
        // -- only the source of the transactions is. The ±window stays: it is what makes the match a
        // match rather than "some swap this account once did".
        //
        // A fee whose account was not scanned (beyond the 12) simply finds nothing and is skipped,
        // which is the same outcome the old code had for a request that failed.
        return freeScan.then(function () {
          var used = {};
          return fees.map(function (e) {
            var t = e.tx || e.tx_json || {};
            var L = e.ledger_index || t.ledger_index;
            if (!L) return null;
            var l2 = byAcct[t.Account] || [];

            // A BRIDGE FEE IS NOT A SWAP FEE, and treating it as one was wrong twice over.
            //
            // RAZA 2026-10-20: "Why is this cross chain trx missing from dashboard. its showing up in
            // bridge recent activity but didnt appear in platform activity". Measured on his account:
            //
            //   fee       0.0021 XRP -> collector      memo "lx:ni"   (MemoType empty)
            //   transfer  2.0979 XRP -> rwJLZfPyVTry…  memos: []
            //
            // The transfer carries nothing, so bridgeOf() could not admit it in the freeScan above and
            // the loop below could not find it either -- that loop wants a SELF-payment, which is what
            // an XRPL swap is, and a bridge pays a third party. The row simply never existed.
            //
            // Worse, it did not fail silently: his account has a 0.00001 XRP self-payment twenty
            // seconds after that fee, well inside the L-10..L+30 window, so the lx:ni fee was free to
            // pair with it and publish a bridge as a dust swap.
            //
            // So a marked fee is handled by route and never falls through to the swap search:
            //   NEAR Intents -- find the partner HERE, as the payment to a third party, and stamp it.
            //   Axelar / THORChain -- the transfer states its own route, so the freeScan already has
            //     it; pairing again would only duplicate the row or mis-pair the fee.
            var route = feeRoute(t);
            if (route) {
              if (route !== 'NEAR Intents') return null;
              var bb = null, bbGap = 1e9;
              for (var q = 0; q < l2.length; q++) {
                var y = l2[q].tx || l2[q].tx_json || {}, ym = l2[q].meta || l2[q].metaData || {};
                if (y.TransactionType !== 'Payment' || y.Account !== t.Account) continue;
                if (ym.TransactionResult !== 'tesSUCCESS') continue;
                // Neither us nor the collector: the deposit address is a stranger, and that is the
                // whole test. An address list would be wrong within a day -- every 1Click deposit
                // address is per-quote -- which is the same reason the two routes above are read
                // from memos rather than from destinations.
                if (!y.Destination || y.Destination === t.Account || y.Destination === COLLECTOR_ACCT) continue;
                var yl = l2[q].ledger_index || y.ledger_index || 0;
                if (yl < L - 10 || yl > L + 30) continue;
                var yh = y.hash || l2[q].hash || '';
                if (yh && used[yh]) continue;
                var ygap = (yl >= L) ? (yl - L) : ((L - yl) + 0.5);
                if (ygap < bbGap) { bbGap = ygap; bb = l2[q]; }
              }
              if (!bb) return null;
              var bbh = (bb.tx || bb.tx_json || {}).hash || bb.hash || '';
              if (bbh) used[bbh] = 1;
              // The chain is deliberately left blank. The transfer names no destination and the
              // ledger holds nothing that does, so the row reads "2.0979 XRP · CROSS-CHAIN · via NEAR
              // Intents" and stops there -- the same rule the THORChain branch follows when its memo
              // abbreviates to a letter we cannot resolve. A row naming the wrong chain is worse than
              // one naming none.
              try { (bb.tx || bb.tx_json || {}).__lxRoute = { via: 'NEAR Intents', chain: '' }; } catch (_) {}
              return bb;
            }

            var best = null, bestGap = 1e9;
            for (var k = 0; k < l2.length; k++) {
              var x = l2[k].tx || l2[k].tx_json || {}, mm = l2[k].meta || l2[k].metaData || {};
              if (x.TransactionType !== 'Payment' || x.Account !== t.Account || x.Destination !== t.Account) continue;
              if (mm.TransactionResult !== 'tesSUCCESS') continue;
              var lg = l2[k].ledger_index || x.ledger_index || 0;
              if (lg < L - 10 || lg > L + 30) continue;
              var hs = x.hash || l2[k].hash || '';
              // ONE SWAP PER FEE. Reading whole account histories instead of a window per fee means
              // the same swap is now visible to every fee that account ever paid; without this the
              // feed would repeat one trade as many times as there are fees near it.
              if (hs && used[hs]) continue;
              // Ledgers after the fee are the current shape and win ties; before it covers swaps made before today.
              var gap = (lg >= L) ? (lg - L) : ((L - lg) + 0.5);
              if (gap < bestGap) { bestGap = gap; best = l2[k]; }
            }
            if (best) {
              var bh = (best.tx || best.tx_json || {}).hash || best.hash || '';
              if (bh) used[bh] = 1;
            }
            return best;
          });
        });
      })
      // RETURNS the rows rather than inserting them. The feed is written once, by loadActivity, from both sources at
      // the same time — inserting here is what made the newest entries appear seconds after the rest.
      .then(function (swaps) {
        // These are swaps made on LumosCore, which is why the feed goes looking for them — but the TAG stays the kind,
        // "Swap", exactly as on Stellar. What matters is that the trade appears at all; the pill is not the place to
        // explain where it was made.
        return (swaps || []).filter(Boolean).map(function (s) {
          return { entry: s, label: null };
        }).concat(pools.map(function (p) { return { entry: p, label: null }; }));
      })
      // NULL, NOT []. An empty array is an answer -- "nothing has happened here" -- and this catch
      // was handing that answer out for every network hiccup, so a reader who hit one was told the
      // platform was idle and only found out otherwise by reloading. The caller now tells the two
      // apart and says which it is.
      .catch(function () { return null; });
  }

  // Does this transaction carry LumosCore's own memo? The mark is written as hex, so the test is on the
  // hex of "LumosCore" rather than on decoded text — decoding every memo of every transaction to read
  // one field would be work for nothing.
  // A BRIDGE IS A PAYMENT TO SOMEONE ELSE, which is exactly why the feed never showed one.
  //
  // RAZA 2026-10-12: "why isnt my cross chain activity showing up on Platform activity on XRPL?" The
  // fee pairing below requires `x.Destination === x.Account` -- a payment to YOURSELF, which is what
  // an XRPL swap is. A bridge pays a third party (the Axelar gateway, a THORChain vault, a 1Click
  // deposit address), so every one was skipped and the fee that found it was thrown away with it.
  // Stellar has had a CROSS-CHAIN row the whole time -- see the tag note in the Payment branch.
  //
  // Identified from the memo the transfer already carries, not from a destination address: the
  // THORChain vault rotates and every 1Click deposit address is per-quote, so an address list would
  // be wrong within a day.
  var AX_GATEWAY = 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw';
  // THE BRIDGE'S OWN MARK, as Stellar draws beside 'via NEAR Intents'. All three files already ship
  // in this build -- NEAR's green token icon rather than /assets/networks/nearintents.png, which is a
  // lighter rendition and the wrong one (same choice ROUTE_META makes in nibridge).
  // Stellar carries a mark beside every asset AND the chain, which is what makes its rows look fuller.
  // Measured: both feeds use 42px badges, 36px inline icons and 10px chips, and XRPL letters are 16px
  // against 15px -- the difference was never size, only how many marks a row carries.
  //
  // Slugged from the display name, which matches the shipped filename for every chain these routes
  // reach except XRPL EVM, which has no file of its own and borrows the XRP Ledger mark.
  function chainLogo(name) {
    var slug = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!slug) return '';
    if (slug === 'xrplevm') slug = 'xrpl';
    return '/assets/networks/' + slug + '.png';
  }
  // WHERE A NEAR INTENTS TRANSFER WENT (X5, 2026-11-20). See bridgeOf() and loadActivity(): the deposit address is
  // per-quote, so 1Click's status for it names the destination asset, and the asset names the chain. Names are
  // nibridge.js's own (NI_CHAIN, HOT_CHAIN), so the feed and the bridge page say the same thing.
  var NI_PLACE = {
    eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', op: 'Optimism', pol: 'Polygon',
    avax: 'Avalanche', bsc: 'BNB Chain', scroll: 'Scroll', gnosis: 'Gnosis', bera: 'Berachain',
    monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer', abs: 'Abstract', hood: 'Robinhood',
    hypercore: 'Hyperliquid', sol: 'Solana', near: 'Near', sui: 'Sui', starknet: 'Starknet',
    aptos: 'Aptos', movement: 'Movement', ton: 'TON', tron: 'Tron', cardano: 'Cardano',
    btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin', bch: 'Bitcoin Cash', dash: 'Dash',
    zec: 'Zcash', aleo: 'Aleo', fogo: 'Fogo', adi: 'ADI', stellar: 'Stellar'
  };
  var NI_HOT = { '1': 'Ethereum', '10': 'Optimism', '56': 'BNB Chain', '137': 'Polygon', '8453': 'Base', '42161': 'Arbitrum', '43114': 'Avalanche' };
  var NI_KEY = 'lumos.niDest.xrpl';
  var NI_DEST = (function () { try { var o = JSON.parse(localStorage.getItem(NI_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } })();
  var NI_TOKS = null, NI_ASK = {};
  function niDest(dep) {
    if (NI_DEST[dep]) return Promise.resolve(NI_DEST[dep]);
    if (NI_ASK[dep]) return NI_ASK[dep];
    var api = '/lxapi/xrploneclick';
    NI_ASK[dep] = fetch(api + '?op=status&depositAddress=' + encodeURIComponent(dep))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var qr = j && j.quoteResponse && j.quoteResponse.quoteRequest, id = String((qr && qr.destinationAsset) || '');
        if (!id) return '';
        var h = /^nep245:v2_1\.omni\.hot\.tg:(\d+)_/.exec(id);   // a HOT id NEAR Intents no longer lists
        if (h) return NI_HOT[h[1]] || '';
        if (!NI_TOKS) NI_TOKS = fetch(api + '?op=tokens').then(function (r) { return r.ok ? r.json() : null; }).then(function (t) { if (!t || !t.tokens) NI_TOKS = null; return (t && t.tokens) || []; }, function () { NI_TOKS = null; return []; });
        return NI_TOKS.then(function (L) {
          for (var i = 0; i < L.length; i++) if (L[i] && L[i].assetId === id) return NI_PLACE[L[i].blockchain] || '';
          return '';
        });
      })
      .then(function (place) {
        delete NI_ASK[dep];
        if (!place) return '';                    // an unknown answer is not kept: the next visit asks again
        NI_DEST[dep] = place;
        try { var ks = Object.keys(NI_DEST); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(function (k) { delete NI_DEST[k]; }); localStorage.setItem(NI_KEY, JSON.stringify(NI_DEST)); } catch (_) {}
        return place;
      }, function () { delete NI_ASK[dep]; return ''; });
    return NI_ASK[dep];
  }
  var VIA_LOGO = {
    'Axelar': '/assets/networks/axelar.png',
    'THORChain': '/assets/networks/thorchain.png',
    'NEAR Intents': '/assets/tokens/ni/NEAR.png',
  };
  var TH_ABBR = { a: 'AVAX', b: 'BTC', c: 'BCH', e: 'ETH', g: 'GAIA', s: 'BSC', d: 'DOGE', r: 'THOR' };
  var TH_DISPLAY = { BTC: 'Bitcoin', ETH: 'Ethereum', BCH: 'Bitcoin Cash', LTC: 'Litecoin',
    DOGE: 'Dogecoin', AVAX: 'Avalanche', BSC: 'BNB Chain', BASE: 'Base', SOL: 'Solana',
    TRON: 'Tron', GAIA: 'Cosmos Hub', THOR: 'THORChain' };
  function memoText(m) { return m ? curNameAny(m) : ''; }
  function curNameAny(h) {
    var out = '';
    for (var i = 0; i + 1 < String(h).length; i += 2) {
      var b = parseInt(String(h).substr(i, 2), 16);
      if (b) out += String.fromCharCode(b);
    }
    return out;
  }
  // WHICH ROUTE A FEE PAYMENT IS FOR, read off the marker the three send sites write. The mark rides
  // the FEE, never the transfer (see the note in nibridge.js), and it is plain MemoData with no
  // MemoType -- unlike our swap fees, which carry MemoType "LumosCore".
  function feeRoute(tx) {
    var ms = (tx && tx.Memos) || [];
    for (var i = 0; i < ms.length; i++) {
      var d = memoText(((ms[i] || {}).Memo || {}).MemoData || '');
      if (d === 'lx:ni') return 'NEAR Intents';
      if (d === 'lx:ax') return 'Axelar';
      if (d === 'lx:th') return 'THORChain';
    }
    return null;
  }

  function bridgeOf(tx) {
    if (!tx || tx.TransactionType !== 'Payment') return null;
    // STAMPED BY THE FEE PAIRING, for the one route that cannot be recognised from the transfer.
    // NEAR Intents sends a plain payment to a per-quote deposit address with NO memo of ours on it,
    // so there is nothing here to test -- the evidence is the lx:ni fee beside it, and the pairing
    // below is what finds the pair. Checked first because the two tests underneath would both miss.
    if (tx.__lxRoute) {
      // ITS CHAIN, ONCE KNOWN (X5): niDest() found it from the deposit address; until then the row says only the route.
      var nd = (tx.__lxRoute.via === 'NEAR Intents' && !tx.__lxRoute.chain && tx.Destination) ? NI_DEST[tx.Destination] : '';
      return nd ? { via: 'NEAR Intents', chain: nd } : tx.__lxRoute;
    }
    if (!tx.Destination || tx.Destination === tx.Account) return null;   // a self-payment is a swap
    var ms = tx.Memos || [];
    var byType = {}, datas = [];
    for (var i = 0; i < ms.length; i++) {
      var m = (ms[i] && ms[i].Memo) || {};
      var d = m.MemoData ? memoText(m.MemoData) : '';
      if (m.MemoType) byType[memoText(m.MemoType)] = d;
      if (d) datas.push(d);
    }
    // Axelar: the gateway plus its own interchain_transfer marker, and the chain is stated outright.
    if (tx.Destination === AX_GATEWAY && byType.type === 'interchain_transfer') {
      return { via: 'Axelar', chain: byType.destination_chain || '' };
    }
    // THORChain: its memo is "=:CHAIN.ASSET:address", so the chain is the first segment.
    for (var k = 0; k < datas.length; k++) {
      if (datas[k].indexOf('=:') === 0) {
        // THORChain shortens the chain in its memo -- RAZA's Avalanche transfer reads '=:a:0x...'. The
        // single letters are from THORChain's own memo-length-reduction table, not inferred: a=AVAX,
        // b=BTC, c=BCH, e=ETH, g=GAIA, s=BSC, d=DOGE, r=THOR. A memo carrying the long form
        // ('AVAX.AVAX') resolves through the same display map.
        //
        // ANYTHING NOT IN BOTH TABLES STAYS UNNAMED. The docs also allow fuzzy abbreviations that
        // resolve against the deepest pool, so a letter we do not recognise could be more than one
        // chain -- and a row naming the wrong destination is worse than one naming none.
        var seg = (datas[k].split(':')[1] || '').split('.')[0] || '';
        var code = TH_ABBR[seg.toLowerCase()] || seg.toUpperCase();
        return { via: 'THORChain', chain: TH_DISPLAY[code] || '' };
      }
    }
    return null;
  }
  var LUMOS_MEMO_HEX = '4C756D6F73436F7265';          // "LumosCore"
  function hasLumosMemo(tx) {
    var ms = (tx && tx.Memos) || [];
    for (var i = 0; i < ms.length; i++) {
      var m = (ms[i] && ms[i].Memo) || {};
      if (String(m.MemoType || '').toUpperCase() === LUMOS_MEMO_HEX) return true;
    }
    return false;
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
      // THE CHAIN MARK, which this heading never had. lumoscore.com reads "Platform Activity — ⟡
      // Stellar" with the XLM token mark between the dash and the chain name; `.lx-chainmark` came
      // across with the fork and had nothing creating it, so the words sat alone.
      //
      // data-lxc is the logo healer's opt-out — Stellar's own note says the guard otherwise treats
      // this as an asset icon and swaps the source out from under it. Same marker here, plus
      // data-lxpainted, which is this build's equivalent for the background painter.
      h3.appendChild(document.createTextNode('Platform Activity — '));
      var cm = document.createElement('img');
      cm.className = 'lx-chainmark';
      cm.src = '/lxapi/xrplthumb?id=' + XRP_ID + '&w=48';
      cm.alt = '';
      cm.setAttribute('aria-hidden', 'true');
      cm.setAttribute('data-lxc', 'XRP');
      cm.setAttribute('data-lxpainted', '1');
      h3.appendChild(cm);
      // "XRPL", NOT "XRP Ledger" (RAZA 2026-10-07: "The top is breaking … you could have just written
      // Platform Activity -- XRPL"). Stellar's chain name is one short word and the heading was built
      // around that; ten characters plus a mark wrapped "Platform Activity —" onto its own line and
      // pushed the card's top out of shape. The short form is the fix he asked for and the one the
      // layout was designed for.
      h3.appendChild(document.createTextNode('XRPL'));
      // NOT A SIZE PROBLEM, and I nearly "fixed" one that did not exist. Both builds ship the same
      // rule — `.market-head h3{font-size:22.6px}`, byte-identical in each container — so forcing a
      // smaller size here would have made this heading differ from lumoscore.com in the other
      // direction. "XRPL" is shorter than "Stellar", so with the label changed the line fits
      // wherever Stellar's does and needs nothing else.
    }

    // Opens the gate `_xrpldashtop.js` holds shut — see the note on it there. Called from every path
    // that writes this list, and from a timer, so the rows can never stay hidden by a feed that never
    // answers.
    var ready = function () { try { host.setAttribute('data-lxact', '1'); } catch (e) {} };
    setTimeout(ready, 6000);

    var note = function (msg) {
      host.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'activity-feed-row';
      d.textContent = msg;
      d.style.cssText = 'opacity:.6;justify-content:center';
      host.appendChild(d);
      ready();
    };
    // EMPTY WHILE IT LOADS, NOT A MESSAGE (RAZA 2026-09-17: "on Stellar we're not showing anything like 'Reading the
    // ledger' so please dont show that on XRPL as well"). The design's mock rows still have to go — they are another
    // chain's transactions — but what replaces them is nothing at all until the real rows arrive. The failure and
    // empty-feed notes below stay: those are answers, not waiting.
    //
    // …AND "NOTHING AT ALL" IS WHAT RAZA REPORTED ON 2026-10-20: "Platform activity is taking too long
    // to show up." NO BACKTICKS IN THIS COMMENT.
    //
    // Measured on production first, because the obvious suspect was wrong. The ledger is fast: nine
    // account_tx calls, all started by 302ms and all finished by 632ms, none failed. The feed is not
    // stuck and the gate is not the problem — ready() runs on the success path. What he was looking at
    // is this line. The card renders its heading, then shows an empty box for as long as the slowest
    // of those calls takes, which on a warm desktop is half a second and on a phone against a metered
    // node is several times that, with retries.
    //
    // So: SKELETON ROWS, not a message and not partial data. Both of those were rejected before and
    // for good reasons — the message was noise Stellar does not show, and painting one source then
    // inserting the other made the feed rearrange itself under the reader (2026-09-17, "First it
    // doesn't show new data then it suddenly does"). A skeleton is neither: it claims nothing, it is
    // replaced wholesale by the real list, and it is exactly what Stellar's own feed grew today.
    //
    // It also overwrites the design's mock rows on the first tick, which is what the gate below was
    // protecting against — so the gate can open immediately and the card stops being a blank box.
    skelCss();
    var _sk = '';
    for (var _s = 0; _s < 8; _s++) {
      _sk += '<div class="activity-feed-row lx-actwait">'
        + '<span class="lx-fg" aria-hidden="true"></span>'
        + '<div class="info">'
        + '<div class="type"><span class="lx-actskel" style="width:62%"></span></div>'
        + '<div class="meta"><span class="lx-actskel lx-actskel-s" style="width:84px"></span></div>'
        + '</div></div>';
    }
    host.innerHTML = _sk;
    ready();

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
      var pool = both[0], mine = both[1];
      // THIS TEST USED TO BE UNREACHABLE. `pool` is `Promise.resolve([])` on this build -- never
      // null -- so `pool === null` was false on every load and the failure message could not be
      // shown at all. Every failure fell through to "No recent activity." below. The signal that
      // matters now is `mine`, which is null only when the ledger could not be read.
      if (mine === null) { note('Could not read the XRP Ledger.'); return; }
      var all = (pool || []).concat(mine || []);
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
      // FILTERED BEFORE THE CAP, not after, so the fifty rows that render are fifty rows that count.
      // Dropping them after the slice would leave a card that shows twenty rows and calls it fifty.
      //
      // A LABELLED ROW IS NEVER DROPPED. `r.label` is set by the fee-pairing pass, which only tags a
      // transaction once it has matched it to a LumosCore platform fee -- that is a swap on this site
      // whatever `describe` made of the payment on its own, and those are the rows the card exists for.
      rows = rows.filter(function (r) {
        if (r.label) return true;
        var e = r.entry || {};
        var d = describe(e.tx || e.tx_json || {}, e.meta || e.metaData);
        return !(d && d.skip);
      });
      rows.sort(function (a, b) { return timeOf(b.entry) - timeOf(a.entry); });
      // FIFTY, THE SAME NUMBER STELLAR'S FEED RENDERS -- counted on production rather than assumed.
      // There is no pager on this card and phones render every row, so an unbounded list is a DOM
      // that grows with the platform's whole history; the cap is what makes "the same as Stellar"
      // mean the same thing on both chains instead of "whatever the ledger returned".
      rows = rows.slice(0, 50);
      if (!rows.length) { note('No recent activity.'); return; }
      host.innerHTML = '';
      var mkRow = function (r) {
        var el = activityRow(r.entry);
        if (r.label) {
          var v = el.querySelector('.lx-actverb');
          if (v) v.textContent = r.label;
        }
        return el;
      };
      rows.forEach(function (r) {
        var el = mkRow(r);
        host.appendChild(el);
        // A NEAR INTENTS ROW WITH NO CHAIN YET (X5): look it up, and redraw only this row when the name lands.
        var t = (r.entry && (r.entry.tx || r.entry.tx_json)) || {}, b = bridgeOf(t);
        if (b && b.via === 'NEAR Intents' && !b.chain && t.Destination) {
          niDest(t.Destination).then(function (place) { if (place && el.parentNode === host) host.replaceChild(mkRow(r), el); });
        }
      });
      ready();
      paint24(host);
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
