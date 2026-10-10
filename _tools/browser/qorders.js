// Dashboard → "Custom Swap / Orders": Stellar's three-tab dialog, on the XRP Ledger.
//
// RAZA 2026-09-15: "On XRPL it's a different popup from that we have on stellar." The card had been
// opening `#modalSwap` — the wallet page's plain FROM/TO box — while `#swapModal`, the dialog the card is
// named after, sat unwired beside it with the design's mock ("You pay APT", a fixed 0.118 rate, and a Swap
// button that printed "Swapped ✓" without doing anything).
//
// THE SAME DIALOG AS lumoscore.com, BUILT THE SAME WAY. Stellar's `lx-qorders` renames the title, moves the
// existing swap form into a Swap pane, and adds Limit and Orders panes; its stylesheet (`lx-qorders-css`)
// and the swap pane's (`lx-swapcalc-css`) are already in this build, left behind when those Stellar scripts
// were stripped. So every class below — lxo-tabs, lxo-pane, lxq-fld, lxq-pick, lxq-menu, lxo-o, lx-dchip,
// lx-dbal, lx-swapmax, lx-swapd, lx-swap-err — is the one the live Stellar dialog uses (read off its DOM),
// and nothing here brings CSS of its own.
//
// WHAT EACH TAB DOES ON THIS LEDGER:
//   Swap    a cross-currency Payment to yourself, quoted by ripple_path_find, delivering at least the quote
//           minus 0.5% or failing — no tfPartialPayment, the rule write.js established. The platform fee is
//           a second XRP payment after the swap lands, exactly as on the wallet page.
//   Limit   an OfferCreate between ANY two assets, with tfSell so the whole amount entered is what is sold.
//           No platform fee on limit orders (RAZA 2026-08-19).
//   Orders  every open offer on the account (account_offers), each cancellable with OfferCancel.
//
// The design's own #swapModal script binds mock listeners to #swapAmtIn, #swapFlip and #swapGo (a fixed rate,
// and a Swap button that fakes success). Those three nodes are replaced with clean clones before anything is
// wired — the second-writer shape this project has been bitten by before.
(function () {
  if (window.__lxxQOrders) return;
  window.__lxxQOrders = 1;

  var RPC = 'https://xrplcluster.com/';
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';
  var XRP_ID = '84e5efeb89c4eae8f68188982dc290d8';
  var SLIP = 0.005;
  var TF_SELL = 0x00080000;
  var CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function lxx() { return window.lxx; }
  function modal() { return document.getElementById('swapModal'); }

  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }
  function connect() { if (window.lxc && window.lxc.open) window.lxc.open(); }

  // Deadlines, for the reason written up in write.js: a public node can hold `ripple_path_find` for half a minute (measured
  // 28.4s selling RLUSD), and an unanswered fetch leaves the quote spinning with nothing on screen to explain it.
  function rpc(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    // 12s HERE USED TO BE SHORTER THAN THE DEFAULT, AND PATH FINDING IS THE SLOW CALL, NOT THE FAST
    // ONE. Measured against xrplcluster from the live dialog, the same pair in the two directions:
    //
    //   XRP  -> RLUSD    0.4s
    //   RLUSD -> XRP    13.9s, 15.1s
    //
    // Searching for routes INTO XRP has to consider every source path the account could take, and the
    // node takes its time; the reverse is one book lookup. So the deadline landed between the two and
    // cut off one whole direction of the dialog: every token→XRP swap aborted at 12s, which is why the
    // quote sat on "Finding a route…" with no error — an abort is not a failure anyone reports.
    //
    // 25s is chosen against those measurements with headroom, and is still a bound: this file's own
    // note records a public node holding this call for half a minute, so no deadline at all is not the
    // alternative. The button says "Finding a route…" while it waits, which is true.
    var limit = ms || (method === 'ripple_path_find' ? 25000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      return (j && j.result) || {};
    }, function () { clearTimeout(timer); return {}; });   // this caller already treats {} as "no answer"
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: dp == null ? 6 : dp });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/,/g, '').trim();
    var m = /^\d*\.?\d*/.exec(s);
    var t = m ? m[0] : '';
    return (t === '' || t === '.') ? NaN : Number(t);
  }
  function floorTo(n, dp) { var k = Math.pow(10, dp); return Math.floor(n * k) / k; }
  function plainNum(n) { return n > 0 ? (lxx().iouValue(n) || '') : ''; }
  function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }
  function same(a, b) { return !!a && !!b && a.currency === b.currency && (a.issuer || '') === (b.issuer || ''); }
  function feeRate() { return typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002; }

  // The fee transaction names itself on the wallet's review screen. Memo bytes are hex on this ledger.
  function hexAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 127) continue;
      out += ('0' + c.toString(16)).slice(-2).toUpperCase();
    }
    return out;
  }
  function feeMemo(payCode, getCode) {
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore platform fee ' + (+(feeRate() * 100).toFixed(2)) + '% - transaction 1 of 2. The '
          + payCode + ' to ' + getCode + ' swap is the second transaction.')
      }
    };
  }

  var XRP = { code: 'XRP', currency: 'XRP', issuer: null, native: true, dom: 'XRP Ledger', v: 1 };
  function curated() {
    return [
      { code: 'RLUSD', currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', dom: 'Ripple', v: 1 },
      { code: 'LUMOS', currency: lxx().encodeCurrency('LUMOS'), issuer: 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha', dom: 'lumoscore.com', v: 1 }
    ];
  }

  // WHICH ROWS GET THE TICK (RAZA 2026-10-07: "Assets that are curated by lumoscore are not containing
  // verified ticks in all of these dropdowns").
  //
  // These menus ticked `a.v`, and `a.v` is only ever set by two things in this file: the XRP constant
  // and the two-entry `curated()` list. The wallet's own trust lines come from `account_lines`, which
  // carries no such flag, so PHNIX, ARMY, ATOM and XYIELD arrived unticked while the Trade table, the
  // search panel and the wallet all tick them. Three places agreeing and one disagreeing is worse than
  // any single answer.
  //
  // The rule is search.js's, verbatim, so the site gives one answer: membership of /lxapi/xrpltokens
  // keyed `issuer|CURRENCY`, with LUMOS pinned and the upstream `vf` still counting on top. The caveat
  // recorded in trade.js — that roster is ranked by volume, not vetted, so the tick means "we list it"
  // — carries over and is not re-argued here.
  //
  // Fetched once per page, lazily, when the dialog opens: this layer is on every page and the roster is
  // 34 KB. Rows render immediately and are re-ticked when it lands, so a slow fetch costs a late badge
  // rather than a missing one — which is why menuRow stores the key on the node.
  // ON `window`, NOT IN THIS CLOSURE, and that is the whole bug the first version had.
  //
  // This page ships TWO copies of this layer — `isVerified` appears in two separate <script> blocks of
  // the built file — and each gets its own scope ([[lumoscore-externalize-scope]]). Measured: the
  // roster request never left the copy that renders the pickers. One copy ran `onOpen()` and filled
  // ITS `VSET`; the other wired the chips first and rendered every row against a null one, so only XRP
  // kept a tick and the fix looked like it had simply not worked. The only request on the wire during
  // a reopen was another layer's `?n=1`.
  //
  // Shared through `window` the two copies cannot disagree, and `vApplyMenus` queries the whole
  // document, so whichever copy loads the roster ticks whichever copy drew the menu.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';

  function vset() { try { return window.__lxxVSET || null; } catch (e) { return null; } }

  function vKey(a) {
    if (!a) return '';
    return (a.issuer || '') + '|' + String(a.currency || '').toUpperCase();
  }
  function isVerified(a) {
    if (!a) return false;
    if (a.v || isXrp(a)) return true;
    if (a.issuer === LUMOS_ISS) return true;
    var s = vset();
    return !!(s && s[vKey(a)]);
  }
  function vApplyMenus() {
    var s = vset();
    if (!s) return;
    [].forEach.call(document.querySelectorAll('.lxq-menu .cd[data-vk]'), function (cd) {
      if (s[cd.getAttribute('data-vk') || '']) cd.setAttribute('data-v', '1');
    });
  }
  function vLoad() {
    if (vset()) { vApplyMenus(); return; }             // another copy already has it
    try { if (window.__lxxVAsked) return; window.__lxxVAsked = 1; } catch (e) {}
    fetch('/lxapi/xrpltokens?n=100').then(function (r) { return r.json(); }).then(function (d) {
      var s = {};
      [].forEach.call((d && d.rows) || [], function (x) {
        if (x && x.i && x.c) s[x.i + '|' + String(x.c).toUpperCase()] = 1;
      });
      try { window.__lxxVSET = s; } catch (e) {}
      vApplyMenus();
    }).catch(function () {
      try { window.__lxxVAsked = 0; } catch (e) {}      // a dropped request must not settle the answer
    });
  }

  function logoOf(a) {
    if (!a) return '';
    if (a.native || a.currency === 'XRP') return '/lxapi/xrplthumb?id=' + XRP_ID + '&w=48';
    if (/^[0-9a-f]{32}$/i.test(a.md5 || '')) return '/lxapi/xrplthumb?id=' + a.md5 + '&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(a.currency) + '&w=48';
  }
  // The healer repaints 1-5 character nodes as ticker logos; data-logoed is its skip marker.
  function paintIco(el, a) {
    if (!el) return;
    el.setAttribute('data-logoed', '1');
    el.setAttribute('data-lxc', (a && a.code) || '');
    if (!a) { el.removeAttribute('data-art'); el.style.removeProperty('--lxa'); el.textContent = '?'; return; }
    el.textContent = '';
    el.style.setProperty('--lxa', 'url("' + logoOf(a) + '")');
    el.setAttribute('data-art', '1');
  }

  function amountObj(a, value) {
    if (a.native || a.currency === 'XRP') return lxx().toDrops(value);
    var v = lxx().iouValue(value);
    return v ? { currency: a.currency, issuer: a.issuer, value: v } : null;
  }
  function specOf(a) { return (a.native || a.currency === 'XRP') ? { currency: 'XRP' } : { currency: a.currency, issuer: a.issuer }; }
  // XRP IS NOT ALWAYS FLAGGED `native`, AND ASKING ONLY THAT IS A BUG THIS FILE ALREADY AVOIDS
  // ELSEWHERE. The XRP constant carries native:true, but the holdings list does not: `sw.from` and
  // `sw.to` are usually `heldOf(XRP)` — an entry built from the account's balances — so the flag is
  // whatever that builder set. amountObj(), specOf() and hasLine() all test the code as well, and the
  // two path-find callers tested only the flag.
  //
  // Measured on the live dialog: with XRP on the RECEIVE side, `to.native` was falsy, so
  // destination_amount went out as {currency:"XRP",issuer:null,value:"-1"} instead of the string
  // "-1". No alternatives come back for that, which is why the rate read "—" and why the quote under
  // it sat on "Finding a route…" forever — every token→XRP swap in this dialog, not just the rate.
  // The same request built with "-1" returns a path immediately (verified against xrplcluster).
  function isXrp(a) { return !!a && (a.native || a.currency === 'XRP'); }
  function fromRaw(x) {
    if (typeof x === 'string') return { asset: XRP, value: Number(x) / 1e6 };
    var d = lxx().decodeCurrency(x.currency);
    return { asset: { code: d.display, currency: x.currency, issuer: x.issuer }, value: Number(x.value) };
  }

  function toast(msg, isError) {
    if (typeof window.lxToast === 'function') { try { window.lxToast(msg, !!isError); return; } catch (e) {} }
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
    t.innerHTML = '<span class="ci"></span><span></span>';
    if (isError) t.firstChild.style.background = 'var(--red,#e5484d)';
    t.firstChild.textContent = isError ? '!' : '✓';
    t.lastChild.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s ease,transform .25s ease';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 2400);
  }

  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    function again() {
      if (n <= 0) return { ok: false, code: 'timeout' };
      return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return waitValidated(hash, n - 1); });
    }
    return rpc('tx', { transaction: hash, binary: false }).then(function (r) {
      if (r && r.validated) {
        var meta = r.meta || {};
        return { ok: meta.TransactionResult === 'tesSUCCESS', code: meta.TransactionResult, meta: meta };
      }
      return again();
    }, again);
  }
  function rested(meta) {
    return ((meta && meta.AffectedNodes) || []).some(function (x) {
      return x.CreatedNode && x.CreatedNode.LedgerEntryType === 'Offer';
    });
  }

  var CODES = {
    tecPATH_PARTIAL: 'The price moved past your 0.5% slippage before this went through. Nothing was swapped.',
    tecPATH_DRY: 'No route between those two assets right now.',
    tecUNFUNDED_PAYMENT: 'You do not hold enough for this.',
    tecUNFUNDED_OFFER: 'You do not hold enough of that asset for this order.',
    tecINSUF_RESERVE_OFFER: 'Not enough XRP to cover the reserve a new order needs.',
    tecINSUF_RESERVE_LINE: 'Not enough XRP to cover the reserve for a new trust line.',
    tecNO_LINE: 'You need a trust line for that asset first.',
    tecNO_LINE_INSUF_RESERVE: 'Not enough XRP to open the trust line this needs.',
    tecNO_AUTH: 'The issuer has not authorised your account to hold that asset.',
    tecFROZEN: 'That asset is frozen by its issuer.',
    tecNO_ISSUER: 'The issuer of that asset is not an active account.',
    tecDIR_FULL: 'Your account holds too many ledger objects to add another.',
    tecKILLED: 'The order could not be filled and was cancelled.',
    tecNO_ENTRY: 'That order is no longer open.'
  };
  function explain(code, what) { return CODES[code] || ((what || 'That') + ' did not go through (' + code + ').'); }

  // ---- the account ---------------------------------------------------------------------------------
  var H = { who: '', hold: [], lines: [], reserve: { base: 1, inc: 0.2 }, loading: null, usd: null };

  function loadAccount(force) {
    var who = addr();
    if (!who) { H.who = ''; H.hold = []; H.lines = []; return Promise.resolve(); }
    if (H.loading && !force) return H.loading;
    if (!force && H.who === who) return Promise.resolve();
    H.loading = Promise.all([
      rpc('account_info', { account: who, ledger_index: 'validated' }),
      rpc('server_info', {}),
      lxx().allLines(rpc, who).catch(function () { return { lines: [] }; })
    ]).then(function (r) {
      var si = ((r[1] && r[1].info) || {}).validated_ledger || {};
      H.reserve = { base: +si.reserve_base_xrp > 0 ? +si.reserve_base_xrp : 1, inc: +si.reserve_inc_xrp > 0 ? +si.reserve_inc_xrp : 0.2 };
      var info = r[0] && r[0].account_data;
      var hold = [], lines = [];
      if (info) {
        var sp = lxx().spendableXrp(info.Balance, info.OwnerCount, H.reserve);
        hold.push({ code: 'XRP', currency: 'XRP', issuer: null, native: true, dom: 'XRP Ledger', v: 1, bal: sp.balance, spendable: sp.spendable });
      }
      lxx().readLines((r[2] && r[2].lines) || []).held.forEach(function (t) {
        if (t.kind === 'opaque') return;
        var a = { code: t.display, currency: t.currency, issuer: t.issuer, bal: t.balance, spendable: t.frozen ? 0 : t.balance, frozen: t.frozen };
        lines.push(a);
        if (t.balance > 0 && !t.frozen) hold.push(a);
      });
      H.who = who; H.hold = hold; H.lines = lines; H.loading = null;
    }).catch(function () { H.loading = null; });
    return H.loading;
  }
  function heldOf(a) { for (var i = 0; i < H.hold.length; i++) if (same(H.hold[i], a)) return H.hold[i]; return null; }
  // How much of `a` this account can actually put into a NEW limit order — the one figure the Limit
  // tab's "Available", its MAX button and its validation all read.
  //
  // For XRP that is the spendable balance minus the owner reserve a new order itself takes (0.2 XRP
  // on mainnet, read from server_info rather than assumed) and a hair for the network fee. Those are
  // not spendable the moment the order exists, so counting them as available states a number the
  // ledger will refuse.
  //
  // Returns 0 rather than a negative, so "available" never reads as a debt.
  function sellable(a) {
    if (!a) return 0;
    var h = heldOf(a);
    var v = h ? h.spendable : 0;
    if (isXrp(a)) v = v - H.reserve.inc - 0.00002;
    return v > 0 ? v : 0;
  }
  function hasLine(a) {
    if (!a || a.native || a.currency === 'XRP') return true;
    for (var i = 0; i < H.lines.length; i++) if (same(H.lines[i], a)) return true;
    return false;
  }
  function loadUsd() {
    if (H.usd != null) return Promise.resolve(H.usd);
    var d = window.__lxxDashData;
    if (d && +d.usd > 0) { H.usd = +d.usd; return Promise.resolve(H.usd); }
    return fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
      .then(function (t) { H.usd = (t && +t.usd > 0) ? +t.usd : null; return H.usd; })
      .catch(function () { return null; });
  }
  function usdText(amount, a) {
    if (!(amount > 0) || !a || !(H.usd > 0)) return '';
    var px = (a.native || a.currency === 'XRP') ? 1 : (a.pxXrp > 0 ? a.pxXrp : 0);
    if (!px) return '';
    var v = amount * px * H.usd;
    return '≈ $' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 6 : 2 });
  }

  // ---- the asset list (shared by Swap and Limit) -----------------------------------------------------
  function closeMenus() { $$('#swapModal .lxq-menu').forEach(function (m) { m.parentNode.removeChild(m); }); }

  function menuRow(a, right, onPick) {
    var b = document.createElement('button');
    b.type = 'button';
    var ic = document.createElement('span'); ic.className = 'lxq-ic'; paintIco(ic, a);
    var tx = document.createElement('span'); tx.className = 'tx';
    var cd = document.createElement('span'); cd.className = 'cd'; cd.setAttribute('data-logoed', '1'); cd.textContent = a.code;
    cd.setAttribute('data-vk', vKey(a));              // so a late roster can tick this row afterwards
    if (isVerified(a)) cd.setAttribute('data-v', '1');
    var sb = document.createElement('span'); sb.className = 's';
    sb.textContent = a.native ? 'XRP Ledger' : ((a.dom ? a.dom + ' · ' : '') + shortAddr(a.issuer));
    tx.appendChild(cd); tx.appendChild(sb);
    b.appendChild(ic); b.appendChild(tx);
    if (right) { var rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = right; b.appendChild(rt); }
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopImmediatePropagation(); closeMenus(); onPick(a); }, true);
    return b;
  }
  function menuHead(m, text) { var h = document.createElement('div'); h.className = 'h'; h.textContent = text; m.appendChild(h); }

  function openMenu(host, anchor, build) {
    closeMenus();
    vLoad();            // whichever copy of this layer draws the menu also asks for the roster
    var m = document.createElement('div');
    m.className = 'lxq-menu';
    m.style.top = (anchor.offsetTop + anchor.offsetHeight + 6) + 'px';
    build(m);
    m.addEventListener('click', function (e) { e.stopPropagation(); });
    host.appendChild(m);
  }

  // Opt an input out of the browser's own autofill history (RAZA 2026-10-07: "please remove this
  // suggestion that opens up when i try to input. its so annoying").
  //
  // The white list of past amounts — 1, 139000000, 0.1, 4, 0.01 — is Chrome's, not ours: nothing in
  // this file renders it, which is why it looks like a bug with no code behind it. The browser offers
  // previously typed values for any field that has not opted out, and here it covers the dialog while
  // you are typing into it.
  //
  // `autocomplete="off"` is the part that matters; the rest stops the mobile keyboard capitalising and
  // red-underlining a number. Applied to every input this dialog owns rather than just the one in the
  // screenshot — the limit amount, the limit price and the two asset filters have the same problem.
  function noAuto(el) {
    if (!el) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    // A field with no name has nothing for the browser to key its history on. Only dropped when the
    // page itself does not rely on it — these inputs are read by id and by class, never by name.
    if (el.hasAttribute('name')) el.removeAttribute('name');
  }

  // The SPEND side's filter (RAZA 2026-10-07: "also add search in you pay dropdown").
  //
  // Deliberately NOT searchInto(). You can only pay with what you hold, so offering the ledger's
  // twenty thousand assets here would offer things that cannot be selected — this filters the wallet's
  // own list instead, which is what lumoscore.com does on its pay side too ("Search your assets"
  // against "Search any Stellar asset" on the other). The heading says which it is, because the box
  // looks identical to the one above it on the receive side and means something different.
  //
  // Matches on code OR issuer, like the ledger-wide box, so the two behave the same way to type into.
  // A wallet with sixty-odd trust lines is the case this exists for.
  function filterInto(m, list, onPick) {
    menuHead(m, 'Your assets');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Code or issuer address';
    noAuto(inp);
    m.appendChild(inp);
    var res = document.createElement('div');
    m.appendChild(res);
    function draw() {
      var q = (inp.value || '').trim().toLowerCase();
      res.innerHTML = '';
      var rows = !q ? list : list.filter(function (a) {
        return ((a.code || '').toLowerCase().indexOf(q) >= 0)
          || ((a.issuer || '').toLowerCase().indexOf(q) >= 0);
      });
      if (!rows.length) { menuHead(res, 'No matches'); return; }
      rows.forEach(function (a) {
        var h = heldOf(a);
        res.appendChild(menuRow(a, h ? fmt(h.spendable, 6) : '0', onPick));
      });
    }
    inp.addEventListener('input', draw);
    draw();
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
  }

  function searchInto(m, exclude, onPick) {
    menuHead(m, 'Search any asset');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Code or issuer address';
    noAuto(inp);
    m.appendChild(inp);
    var res = document.createElement('div');
    m.appendChild(res);
    var tmr = null;
    inp.addEventListener('input', function () {
      var v = (inp.value || '').trim();
      clearTimeout(tmr);
      if (v.length < 2) { res.innerHTML = ''; return; }
      tmr = setTimeout(function () {
        fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (d) {
          res.innerHTML = '';
          var rows = ((d && d.rows) || []).filter(function (x) { return x && x.n && x.i && x.c && lxx().isAddress(x.i); })
            .map(function (x) { return { code: x.n, currency: x.c, issuer: x.i, dom: x.u || '', v: x.vf ? 1 : 0, md5: x.m, pxXrp: +x.p || 0, holders: +x.h || 0 }; })
            .filter(function (a) { return !same(a, exclude); })
            .sort(function (x, y) { return (y.v - x.v) || (y.holders - x.holders); })
            .slice(0, 12);
          if (/^xrp$/i.test(v) && !same(XRP, exclude)) rows.unshift(XRP);
          if (!rows.length) { menuHead(res, 'No matches'); return; }
          rows.forEach(function (a) { res.appendChild(menuRow(a, '', onPick)); });
        }).catch(function () { res.innerHTML = ''; menuHead(res, 'Search unavailable'); });
      }, 260);
    });
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
  }

  // ======================================================================================== SWAP
  // `rev` marks the receive amount as the USER'S OWN figure, typed into "You receive", rather than
  // something the engine computed. It is what stops clearQuote() wiping it out from under them when
  // no wallet is connected — see the note there.
  var sw = { from: null, to: null, quote: null, seq: 0, busy: false, wired: false, rev: 0 };
  // The indicative rate for the current pair, independent of whatever is typed in the amount field.
  // `key` is the pair it was fetched for, so a repaint cannot re-ask. See quoteRate().
  var spot = { key: '', txt: '', val: 0, seq: 0 };

  // ---- "You receive" is typeable, and works backwards ------------------------------------------
  // RAZA 2026-10-08: "Dashboard -> Custom swap popup : cant enter anything in You receive. Stellar
  // lets me enter". The design ships #swapAmtOut as a plain <div> with "0.00" baked into it — in BOTH
  // builds, identically. lumoscore.com makes it editable at runtime in _swapcalc.js and asks the
  // ledger what must be SENT to land exactly the figure typed; this build never got that layer, so
  // the field was a read-only display of the forward quote. Ported here, with one deliberate change
  // to the arithmetic, noted at revQuote().
  //
  // THE EMPTY STATE IS GENUINELY EMPTY. Stellar's own fix (RAZA 2026-09-17: "why does it come
  // prefilled with 0.00 value. everytime i wanna enter, i first need to remove 0.00") draws the 0.00
  // in CSS instead, so typing never starts with a deletion. The ghost is never in the DOM, so every
  // read of this field still sees only what was typed. user-select:none keeps Select-All off it.
  function recvCss() {
    if (document.getElementById('lxq-recv-css')) return;
    var st = document.createElement('style');
    st.id = 'lxq-recv-css';
    st.textContent = '#swapAmtOut:empty::before{content:"0.00";opacity:.5;pointer-events:none;'
      + 'user-select:none;-webkit-user-select:none}'
      // NO FOCUS RING (RAZA 2026-10-08: "Remove that box around the value when i input"). This line
      // used to draw an accent outline to show the field was editable — my addition, and the wrong
      // call: the real <input> beside it shows nothing on focus, so one boxed figure and one bare one
      // in the same row reads as a rendering fault rather than a hint. The browser draws its own ring
      // on a focused contenteditable too, which is what has to be turned off here; the caret is the
      // focus indicator, exactly as it is for "You pay". Stellar carries the same rule.
      + '#swapAmtOut:focus,#swapAmtOut:focus-visible{outline:none!important;box-shadow:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  function makeRecvEditable(out) {
    if (!out || out.__lxrev) return;
    out.__lxrev = 1;
    recvCss();
    out.setAttribute('contenteditable', 'true');
    out.setAttribute('inputmode', 'decimal');
    out.setAttribute('spellcheck', 'false');
    out.setAttribute('title', 'Type an amount to work backwards');
    if (!/[1-9]/.test(out.textContent || '')) out.innerHTML = '';

    // THE QUOTE ENGINE MUST NOT TYPE OVER THE PERSON. Every forward quote writes this field, and a
    // quote lands while the field still has focus — so without this the figure being typed is
    // replaced mid-keystroke by the engine's own number. Writes are dropped for exactly the window
    // in which the field has focus and resume on blur, when the true quoted figure takes over.
    try {
      var tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(out, 'textContent', {
        configurable: true,
        get: function () { return tc.get.call(this); },
        set: function (v) { if (document.activeElement === this) return; tc.set.call(this, v); }
      });
    } catch (_) {}

    var t = null;
    out.addEventListener('input', function () {
      // A contenteditable that has been emptied keeps a stray <br>, which defeats :empty and leaves
      // the placeholder hidden behind nothing.
      if (!(out.textContent || '').trim() && out.innerHTML !== '') out.innerHTML = '';
      // Emptied by hand means they have given the field back to the engine.
      if (!(out.textContent || '').trim()) sw.rev = 0;
      clearTimeout(t);
      t = setTimeout(function () { try { revQuote(); } catch (_) {} }, 380);
    });
    // Enter commits; without this it inserts a newline into a number.
    out.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); out.blur(); } });
  }

  // Ask the ledger what must be SENT to land exactly the amount typed, then put that in "You pay"
  // and let the ordinary forward path re-quote it — so what is finally executed is always a real
  // forward quote, never this estimate.
  //
  // NO GROSSING UP, UNLIKE STELLAR. lumoscore.com divides by (1 - feeRate) because its platform fee
  // comes OFF the amount being sent. On the XRP Ledger the fee is a SEPARATE Payment in XRP
  // (doSwap sends feeInXrp(amt) as its own transaction, and the Max button reserves room for it with
  // bal / (1 + feeRate)), so the swap sends exactly the path's source_amount. Dividing here would
  // overstate "You pay" by the fee and quote the wrong number.
  function revQuote() {
    var out = $('#swapAmtOut'), inp = $('#swapAmtIn');
    if (!out || !inp) return;
    var want = parseFloat(String(out.textContent || '').replace(/[^0-9.]/g, ''));
    if (!(want > 0)) return;
    if (!sw.from || !sw.to || sw.from.code === sw.to.code) return;

    // Whatever the figure comes from, it lands in "You pay" and is re-quoted forward from there, so
    // the number finally signed is always a real forward quote. Rounded UP: rounding down would ask
    // the ledger for less than the amount typed and under-deliver it.
    function land(pay) {
      if (!(pay > 0)) return;
      sw.rev = 1;                       // the figure in "You receive" is theirs, not the engine's
      inp.value = plainNum(Math.ceil(pay * 1e6) / 1e6);
      try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { quoteSwap(); }
    }

    // THE ORDER BOOK ANSWERS WHEN THE LEDGER WILL NOT. Horizon's path query ignores who is asking;
    // the XRP Ledger's ripple_path_find does not — it needs a source_account, and it has nothing to
    // say about a destination the account cannot yet hold. The forward direction already falls back
    // to the order-book rate in both cases (see the trust-line branch in quoteSwap), and the reverse
    // has to match it: without this, typing into "You receive" did nothing at all for a signed-out
    // visitor, or for anyone who has not opened the trust line yet. Measured — revQuote returned at
    // the addr() check and the field just sat there. It is an estimate, and the forward re-quote it
    // triggers is what labels it as one.
    var me = addr();
    if (!me || !hasLine(sw.to)) {
      if (spot.val > 0 && spot.key === pairKey()) land(want / spot.val);
      return;
    }
    var seq = ++sw.seq;
    setGo(false, 'Finding a route…');
    rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: amountObj(sw.to, want),
      source_currencies: [isXrp(sw.from) ? { currency: 'XRP' }
        : { currency: sw.from.currency, issuer: sw.from.issuer }],
      ledger_index: 'validated'
    }).then(function (r) {
      if (seq !== sw.seq) return;                     // a newer edit has superseded this one
      var best = null;
      (r.alternatives || []).forEach(function (a) {
        var s = a.source_amount;
        var v = (typeof s === 'string') ? (+s / 1e6) : +(s && s.value);
        if (v > 0 && (best === null || v < best)) best = v;
      });
      if (!(best > 0)) { swapSay('No route for that amount right now.'); setGo(false, 'Swap'); return; }
      swapSay('');
      land(best);
    }).catch(function () {
      if (seq !== sw.seq) return;
      swapSay('Could not reach the ledger for that amount.');
      setGo(false, 'Swap');
    });
  }

  function swapPane() { return $('#swapModal .lxo-pane[data-pane="swap"]'); }
  function blockOf(node) {
    var pane = swapPane();
    while (node && node.parentNode && node.parentNode !== pane) node = node.parentNode;
    return node && node.parentNode === pane ? node : null;
  }

  function swapUi() {
    var pane = swapPane();
    if (!pane || sw.wired) return;
    var fromEl = $('#swapFrom'), toEl = $('#swapTo'), inEl = $('#swapAmtIn'), goEl = $('#swapGo');
    if (!fromEl || !toEl || !inEl || !goEl) return;
    sw.wired = true;
    noAuto(inEl);                       // the amount field in RAZA's screenshot
    pane.style.position = 'relative';

    [[fromEl, true], [toEl, false]].forEach(function (pair) {
      var block = blockOf(pair[0]);
      if (!block) return;
      var label = block.firstElementChild;
      if (label && !$('.lx-dbal', label)) {
        label.style.cssText += ';display:flex;justify-content:flex-start;align-items:center;gap:8px';
        var bal = document.createElement('span');
        bal.className = 'lx-dbal';
        bal.style.cssText = 'font-size:12px;color:var(--text-muted,#8b90a0);font-weight:600;margin-left:auto';
        label.appendChild(bal);
        if (pair[1]) {
          var mx = document.createElement('button');
          mx.type = 'button'; mx.className = 'lx-swapmax'; mx.textContent = 'Max';
          label.appendChild(mx);
        }
      }
      var chipEl = pair[0].parentNode;
      chipEl.classList.add('lx-dchip');
      chipEl.setAttribute('data-lx-noswap', '');
      chipEl.setAttribute('data-side', pair[1] ? 'from' : 'to');
      if (!$('.lx-dcaret', chipEl)) {
        var car = document.createElement('span'); car.className = 'lx-dcaret'; car.innerHTML = CHEVRON;
        chipEl.appendChild(car);
      }
    });

    var out = $('#swapAmtOut');
    if (out) { makeRecvEditable(out); out.textContent = ''; }
    var rate = $('#swapRate');
    if (rate) rate.textContent = '—';

    if (!$('.lx-swapd', pane)) {
      var det = document.createElement('div');
      det.className = 'lx-swapd';
      det.style.display = 'none';
      det.innerHTML = '<div class="r"><span>Rate</span><strong data-k="rate">—</strong></div>'
        + '<div class="r"><span>Slippage tolerance</span><strong data-k="slip">—</strong></div>'
        + '<div class="r"><span data-k="feelbl">Swap fee</span><strong data-k="fee">—</strong></div>'
        + '<div class="r"><span>Network fee</span><strong data-k="net">—</strong></div>'
        + '<div class="r rtot"><span>Minimum received</span><strong data-k="min">—</strong></div>';
      var err = document.createElement('div');
      err.className = 'lx-swap-err';
      err.style.display = 'none';
      goEl.parentNode.insertBefore(det, goEl);
      goEl.parentNode.insertBefore(err, goEl);
    }

    pane.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chipEl = t.closest('.lx-dchip');
      if (chipEl) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!addr()) { connect(); return; }
        var side = chipEl.getAttribute('data-side');
        openMenu(pane, blockOf(chipEl), function (m) {
          var list = side === 'from'
            ? H.hold.filter(function (a) { return a.spendable > 0; })
            : [XRP].concat(H.lines.filter(function (a) { return !a.frozen; }));
          var other = side === 'from' ? sw.to : sw.from;
          var pick = function (picked) {
            if (side === 'from') { sw.from = picked; if (same(sw.to, picked)) sw.to = null; }
            else { sw.to = picked; if (same(sw.from, picked)) sw.from = null; }
            sw.rev = 0;                 // an amount typed for one token does not carry to another
            paintSwap(); quoteSwap();
          };

          // SEARCH ON THE RECEIVE SIDE, the way the Limit tab and lumoscore.com both do it (RAZA
          // 2026-10-07, against Stellar's "Code or issuer address" box). `searchInto` already existed
          // and was wired into the Limit tab only; this side listed the wallet's own trust lines and
          // nothing else, so the twenty thousand assets on the ledger were unreachable from here.
          //
          // IT WAS ALSO HONEST UNTIL AN HOUR AGO. A swap could only deliver a token the account could
          // already receive, so offering a search would have offered things that could not be bought.
          // The three-step flow opens the trust line now, which is what makes a ledger-wide search
          // meaningful — and what makes the old note below it wrong, so it is rewritten rather than
          // kept. Search first, then the wallet's own assets, matching the Limit tab's order.
          if (side === 'to') searchInto(m, other, pick);

          var rows = list.filter(function (a) { return !(side === 'to' && same(a, other)); });
          if (!rows.length) menuHead(m, 'No assets in this wallet yet');
          else if (side === 'from') filterInto(m, rows, pick);
          else {
            menuHead(m, 'In this wallet');
            rows.forEach(function (a) {
              var h = heldOf(a);
              m.appendChild(menuRow(a, h ? fmt(h.spendable, 6) : '0', pick));
            });
          }
          if (side === 'to') {
            var note = document.createElement('div');
            note.className = 'h';
            note.style.textTransform = 'none';
            note.style.letterSpacing = '0';
            note.textContent = 'Any XRP Ledger asset. Without a trust line the swap opens one for you, '
              + 'as a second confirmation.';
            m.appendChild(note);
          }
        });
        return;
      }
      if (t.closest('.lx-swapmax')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!sw.from) return;
        // READ THE BALANCE OFF THE HOLDING, NOT OFF THE ASSET (RAZA 2026-10-07: "Max button is not
        // working" on the Swap tab). `sw.from` is `heldOf(XRP) || XRP`, and that fallback — the XRP
        // constant at the top of this file — carries no `spendable`. When the holdings list has not
        // produced an XRP entry, `sw.from.spendable` is undefined, the arithmetic is NaN, and MAX
        // writes NaN into the field: a button that visibly does nothing. The Limit tab's MAX reads
        // `heldOf()` and was never affected, which is why only this one looked broken.
        var h = heldOf(sw.from);
        var bal = h ? h.spendable : 0;
        // No owner reserve here: a swap is a Payment and creates no ledger object. Only the platform
        // fee, which comes off the top, and a hair for the network fee.
        var room = isXrp(sw.from) ? Math.max(0, bal / (1 + feeRate()) - 0.00002) : bal;
        if (!(room > 0)) { toast('Nothing to swap: this account has no spendable ' + sw.from.code + '.', true); return; }
        $('#swapAmtIn').value = plainNum(floorTo(room, 6));
        quoteSwap();
        return;
      }
      // FLIPPING RESETS BOTH AMOUNTS, as on lumoscore.com (RAZA 2026-10-08: "yes match the flip to
      // stellar"). Stellar's flip clears the pay field, the receive field and the error, then re-asks
      // for the rate. This one swapped the assets and left the pay amount sitting there — so 1.41 XRP
      // quoted for RLUSD became a request to spend 1.41 RLUSD the moment the arrow was pressed, an
      // amount nobody typed for that side of the market.
      //
      // The receive field, the details panel, the rate line and the button are all handled by
      // clearQuote, which quoteSwap reaches on its own once the pay field is empty; and paintSwap
      // calls quoteRate first, which drops the old pair's rate rather than showing it against the new
      // one. So only the pay amount and the error line need clearing here.
      if (t.closest('#swapFlip')) {
        e.preventDefault(); e.stopImmediatePropagation();
        var a = sw.from, b = sw.to;
        sw.from = b && heldOf(b) ? heldOf(b) : b; sw.to = a;
        sw.rev = 0;                     // the amount they typed was for the other side of this pair
        var fi = $('#swapAmtIn'); if (fi) fi.value = '';
        swapSay('');
        paintSwap(); quoteSwap();
        return;
      }
      if (t.closest('#swapGo')) {
        e.preventDefault(); e.stopImmediatePropagation();
        doSwap();
        return;
      }
      if (!t.closest('.lxq-menu')) closeMenus();
    }, true);

    var tmr = null;
    pane.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'swapAmtIn') return;
      e.stopImmediatePropagation();
      // TYPING IN "YOU PAY" IS FORWARD MODE, so the receive amount goes back to being the engine's to
      // compute and clear. Gated on isTrusted because revQuote's own land() dispatches this very
      // event to drive the forward re-quote — an untrusted one is our write, not theirs, and must
      // not cancel the thing that just set it.
      if (e.isTrusted) sw.rev = 0;
      var v = String(e.target.value).replace(/[^0-9.]/g, '');
      var dot = v.indexOf('.');
      if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      if (v !== e.target.value) e.target.value = v;
      clearTimeout(tmr);
      tmr = setTimeout(quoteSwap, 300);
    }, true);
  }

  // `note` says this is information, not a refusal: same slot, muted instead of red. The trust-line
  // line below is the reason it exists — it tells the user what the swap is about to do, and painting
  // that red made a normal, supported flow look like a failure.
  function swapSay(text, note) {
    var err = $('#swapModal .lx-swap-err');
    if (!err) return;
    err.textContent = text || '';
    err.style.display = text ? '' : 'none';
    err.style.color = (text && note) ? 'var(--text-muted)' : '';
  }
  function setGo(enabled, label) {
    var go = $('#swapGo');
    if (!go) return;
    if (label) go.textContent = label;
    if (enabled) { go.removeAttribute('data-lxdis'); go.style.opacity = ''; go.style.cursor = 'pointer'; }
    else { go.setAttribute('data-lxdis', '1'); go.style.opacity = '0.55'; go.style.cursor = 'not-allowed'; }
  }
  function detail(k, v) { var s = $('#swapModal .lx-swapd [data-k="' + k + '"]'); if (s) s.textContent = v; }

  function paintChip(which, a) {
    var id = which === 'from' ? 'swapFrom' : 'swapTo';
    var nameEl = document.getElementById(id);
    if (!nameEl) return;
    nameEl.textContent = a ? a.code : 'Select';
    nameEl.setAttribute('data-logoed', '1');
    var ic = nameEl.parentNode.firstElementChild;
    if (ic && ic !== nameEl) {
      ic.setAttribute('data-logoed', '1');
      if (a) {
        ic.textContent = '';
        ic.style.setProperty('background', 'center / contain no-repeat url("' + logoOf(a) + '")', 'important');
      } else {
        ic.style.removeProperty('background');
        ic.textContent = '?';
      }
    }
    var block = blockOf(nameEl);
    var bal = block && $('.lx-dbal', block);
    if (bal) {
      var h = a && heldOf(a);
      bal.textContent = (a && addr()) ? ('Balance: ' + fmt(h ? h.spendable : 0, 7) + ' ' + a.code) : '';
    }
  }
  function paintSwap() {
    paintChip('from', sw.from);
    paintChip('to', sw.to);
    quoteRate();          // no-op unless the pair actually changed
  }

  function defaults() {
    if (!sw.from || (addr() && !heldOf(sw.from))) sw.from = heldOf(XRP) || XRP;
    if (!sw.to) {
      // RLUSD, NOT WHATEVER HAPPENS TO BE FIRST (RAZA 2026-10-02: "Why's it selecting Phnix token by
      // default. Make it XRP (you pay) and RLUSD (you receive) as default").
      //
      // This took the first unfrozen holding, so the pair the dialog opened on was an accident of trust
      // line order — PHNIX on his account, something else on the next. XRP → RLUSD is the pair most
      // people actually want, and it is the one this build curates.
      //
      // The held copy is preferred when there is one, so the balance line has something to show;
      // otherwise the curated entry, which is a valid destination whether or not a trust line exists yet.
      var rl = curated().filter(function (c) { return c.code === 'RLUSD'; })[0];
      var heldRl = rl ? heldOf(rl) : null;
      sw.to = heldRl || rl
        || H.lines.filter(function (a) { return !a.frozen && !same(a, sw.from); })[0]
        || null;
      // Never the same asset on both sides: if RLUSD is somehow what is being paid, fall back.
      if (sw.to && sw.from && same(sw.to, sw.from)) {
        sw.to = H.lines.filter(function (a) { return !a.frozen && !same(a, sw.from); })[0] || null;
      }
    }
    paintSwap();
  }

  function clearQuote() {
    sw.quote = null;
    // Empty, not "0.00" — the placeholder is drawn in CSS now, so the next person to type here does
    // not have to delete a number first. The setter installed in makeRecvEditable drops this write
    // while the field has focus, which is what stops a clear landing mid-keystroke.
    //
    // BUT NOT WHEN THE FIGURE IS THEIRS (RAZA 2026-10-08: "yes change it for signed out too").
    // quoteSwap clears and gives up the moment there is no connected account, so a signed-out
    // visitor who typed into "You receive" watched their own number vanish a second later while
    // "You pay" kept the amount worked back from it — a pane contradicting itself. The focus guard
    // hid this while they were still typing and let it land the instant they stopped. There is
    // nothing to clear here anyway: the engine never computed this number, so it has none to
    // withdraw. Any path that genuinely hands the field back to the engine resets `rev` itself.
    var out = $('#swapAmtOut'); if (out && !sw.rev) out.textContent = '';
    // The indicative rate, not an em dash. Clearing the amount is not the same as not knowing the
    // price, and this ran on every keystroke back to empty.
    showRate(spot.txt);
    var det = $('#swapModal .lx-swapd'); if (det) det.style.display = 'none';
    setGo(false, 'Swap');
  }

  // THE RATE LINE WHEN NO AMOUNT HAS BEEN TYPED (RAZA 2026-10-06: "The rate of XRP should be shown
  // like rate of XLM is shown on stellar at the bottom").
  //
  // This dialog only ever learned a price as a side effect of quoting a specific amount, so with the
  // field at its default 0.00 — which is how it opens, every time — Rate read "—" while Stellar's
  // read "1 XLM ≈ 0.2127379 USDC". Stellar gets that from `_swapcalc.js` quoteRate(), a Horizon
  // strict-send for source_amount=1 fired whenever the pair changes, independent of the input.
  //
  // ASKED OF THE MARKET, NOT OF THE ACCOUNT, and that is the whole lesson of the first attempt.
  // Horizon's path query ignores who is asking. The XRP Ledger's `ripple_path_find` does not: it
  // routes TO a destination account, so it answers only if that account can RECEIVE the asset. My
  // first version used it and tested fine — because the test account happened to hold RLUSD. RAZA's
  // does not: his screenshot reads "Balance: 0 RLUSD", there is no trust line, the ledger correctly
  // reported no route to him, and the rate stayed "—" on the exact pair the dialog opens on. A rate
  // is a property of the market; asking a question scoped to one account was the bug.
  //
  // `book_offers` is the market question: no account, no trust line, no balance, and measured at
  // ~400ms in BOTH directions where path finding into XRP takes fifteen seconds. Cross-checked
  // against the path quote on the same pair — 1.4968 against 1.4970 — so it is the same number, got
  // honestly and quickly.
  //
  // Keyed on the pair, so switching assets re-asks and a repaint does not: paintSwap() runs on every
  // chip redraw and this would otherwise be an RPC per repaint. Sequence-guarded like quoteSwap, so a
  // slow answer for an abandoned pair cannot overwrite a newer one.
  function showRate(txt) {
    var r = $('#swapRate');
    if (r) r.textContent = txt || '—';
  }

  // Top of book, one direction. `taker_gets` is what an offer HANDS OVER, so asking for offers that
  // give TO and want FROM and dividing one by the other is "how much TO per 1 FROM" — the same thing
  // Stellar's strict-send-for-1 answers.
  function bookRate(gets, pays) {
    return rpc('book_offers', { taker_gets: gets, taker_pays: pays, limit: 5, ledger_index: 'validated' })
      .then(function (r) {
        var o = (r.offers || [])[0];
        if (!o) return null;
        var g = typeof o.TakerGets === 'string' ? (+o.TakerGets / 1e6) : +o.TakerGets.value;
        var p = typeof o.TakerPays === 'string' ? (+o.TakerPays / 1e6) : +o.TakerPays.value;
        return (g > 0 && p > 0) ? (g / p) : null;
      }, function () { return null; });
  }

  function quoteRate() {
    var key = pairKey();
    if (key === spot.key) { if (!sw.quote) showRate(spot.txt); return; }
    spot.key = key;
    spot.txt = '';
    spot.val = 0;
    if (!sw.quote) showRate('');
    if (!sw.from || !sw.to || same(sw.from, sw.to)) return;
    var from = sw.from, to = sw.to;
    var seq = ++spot.seq;

    // The direct book, plus the XRP-bridged route when neither side is XRP, and the better of the two
    // wins. Not belt and braces: measured on 589/RLUSD, the direct book answers 537.92 while routing
    // through XRP answers 4,449.74 — the direct book exists but is one stale offer, and the real
    // liquidity is in the two XRP books. Showing the direct number there would have been a figure
    // eight times worse than the swap underneath it would actually fill at. The XRP Ledger's own path
    // finder picks the better route, so the rate line has to as well.
    var legs = [bookRate(specOf(to), specOf(from))];
    if (!isXrp(from) && !isXrp(to)) {
      legs.push(Promise.all([
        bookRate({ currency: 'XRP' }, specOf(from)),      // XRP per 1 FROM
        bookRate(specOf(to), { currency: 'XRP' })         // TO per 1 XRP
      ]).then(function (p) {
        return (p[0] != null && p[1] != null) ? (p[0] * p[1]) : null;
      }));
    }

    Promise.all(legs).then(function (rs) {
      if (seq !== spot.seq || pairKey() !== key) return;
      var best = rs.filter(function (v) { return v != null && isFinite(v) && v > 0; })
        .sort(function (a, b) { return b - a; })[0];
      if (best == null) return;                           // no book either way: leave the dash
      spot.val = best;
      spot.txt = '1 ' + from.code + ' ≈ ' + fmt(best, 7) + ' ' + to.code;
      if (!sw.quote) showRate(spot.txt);                  // a real quote, if one arrived meanwhile, wins
      if (!hasLine(to)) quoteSwap();                      // the estimate path below waits on this number
    }).catch(function () {});
  }

  function pairKey() {
    var id = function (a) { return !a ? '' : (a.native ? 'XRP' : (a.currency + '.' + a.issuer)); };
    return id(sw.from) + '>' + id(sw.to);
  }

  function quoteSwap() {
    var me = addr();
    var amt = num(($('#swapAmtIn') || {}).value);
    swapSay('');
    if (!(amt > 0) || !sw.from || !sw.to) { clearQuote(); return; }
    if (!me) { clearQuote(); setGo(true, 'Connect wallet'); return; }
    if (same(sw.from, sw.to)) { clearQuote(); swapSay('Pick two different assets.'); return; }
    // "No route between those two assets right now" WAS THE WRONG DIAGNOSIS (RAZA 2026-10-07, swapping
    // 0.01 XRP → RLUSD while the Rate line above it read 1 XRP ≈ 1.5012187 RLUSD — there is obviously
    // a market, and the message contradicted the number directly above it).
    //
    // A swap here is a Payment to yourself, and the XRP Ledger will not deliver an issued token to an
    // account that has no trust line for it. His screenshot says so: "Balance: 0 RLUSD", no line. So
    // ripple_path_find correctly returns no alternatives — not because the market is missing but
    // because the DESTINATION cannot hold what the market would deliver. Asked before the call rather
    // than guessed from an empty answer, because "no path" has two very different causes and only one
    // of them is about liquidity.
    //
    // Offers are the exception: a crossed OfferCreate opens the trust line itself, a Payment does not.
    //
    // SO THE DIALOG OPENS THE LINE RATHER THAN REFUSING (RAZA 2026-10-07: "Whys it showing error if
    // the user doesn't have trustline, just make it like it this: 3 steps"). doSwap() has always been
    // able to do that — TrustSet, fee, swap — and the reason nobody could reach it is upstream, here:
    // without a trust line ripple_path_find has nothing to answer, so `sw.quote` was never set and the
    // Swap button never enabled. The error I put here made that dead end explicit; it did not create it.
    //
    // QUOTED FROM THE ORDER BOOK INSTEAD, which is the same market question the Rate line already
    // asks and needs no account at all. It is an ESTIMATE and is labelled as one: the real path, with
    // its computed Paths and slippage floor, is fetched inside doSwap() once the line exists and the
    // ledger can finally answer. Nothing is signed against this number.
    if (!hasLine(sw.to)) {
      if (!(spot.val > 0) || spot.key !== pairKey()) {    // the book answer is still in flight
        setGo(false, 'Finding a route…');
        return;
      }
      var est = amt * spot.val;
      sw.quote = { est: true, amt: amt, out: est };
      var oEl = $('#swapAmtOut'); if (oEl) oEl.textContent = fmt(est, 6);
      showRate(spot.txt);
      var dEl = $('#swapModal .lx-swapd'); if (dEl) dEl.style.display = '';
      detail('rate', spot.txt);
      detail('slip', (SLIP * 100).toFixed(1) + '%');
      detail('feelbl', 'Swap fee (' + (feeRate() * 100).toFixed(1) + '%)');
      detail('fee', '…');
      detail('net', '~0.000012 XRP');
      detail('min', 'quoted after the trust line opens');
      feeInXrp(amt).then(function (x) {
        detail('fee', x > 0 ? (fmt(x, 6) + ' XRP') : 'not charged (no XRP route)');
      });
      var hNew = heldOf(sw.from);
      if (!hNew || amt > hNew.spendable + 1e-12) {
        swapSay('You only have ' + fmt(hNew ? hNew.spendable : 0, 6) + ' ' + sw.from.code + ' available.');
        setGo(false, 'Swap');
        return;
      }
      swapSay('First time swapping into ' + sw.to.code + ': three wallet confirmations — the platform fee, '
        + 'a trust line for ' + sw.to.code + ' (' + fmt(H.reserve.inc, 2) + ' XRP reserve, refundable if you remove it), '
        + 'then the swap. The amount above is the market rate; the exact figure is quoted before the last one.', true);
      setGo(true, 'Swap');
      return;
    }
    var seq = ++sw.seq;
    setGo(false, 'Finding a route…');
    rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: isXrp(sw.to) ? '-1' : { currency: sw.to.currency, issuer: sw.to.issuer, value: '-1' },
      send_max: amountObj(sw.from, amt),
      ledger_index: 'validated'
    }).then(function (r) {
      if (seq !== sw.seq) return;
      var alt = (r.alternatives || [])[0];
      if (!alt) { clearQuote(); swapSay('No route between those two assets right now.'); return; }
      var got = alt.destination_amount;
      var outVal = typeof got === 'string' ? (+got / 1e6) : +got.value;
      if (!(outVal > 0)) { clearQuote(); swapSay('No route between those two assets right now.'); return; }
      sw.quote = { alt: alt, out: outVal, amt: amt };
      var out = $('#swapAmtOut'); if (out) out.textContent = fmt(outVal, 6);
      var rateTxt = '1 ' + sw.from.code + ' ≈ ' + fmt(outVal / amt, 7) + ' ' + sw.to.code;
      var rate = $('#swapRate'); if (rate) rate.textContent = rateTxt;
      var det = $('#swapModal .lx-swapd'); if (det) det.style.display = '';
      detail('rate', rateTxt);
      detail('slip', (SLIP * 100).toFixed(1) + '%');
      detail('feelbl', 'Swap fee (' + (feeRate() * 100).toFixed(1) + '%)');
      detail('fee', '…');
      detail('net', '~0.000012 XRP');
      detail('min', fmt(outVal * (1 - SLIP), 6) + ' ' + sw.to.code);
      feeInXrp(amt).then(function (x) {
        if (seq !== sw.seq) return;
        detail('fee', x > 0 ? (fmt(x, 6) + ' XRP') : 'not charged (no XRP route)');
      });
      var h = heldOf(sw.from);
      if (!h || amt > h.spendable + 1e-12) {
        swapSay('You only have ' + fmt(h ? h.spendable : 0, 6) + ' ' + sw.from.code + ' available.');
        setGo(false, 'Swap');
        return;
      }
      setGo(true, 'Swap');
    }).catch(function () {
      if (seq !== sw.seq) return;
      clearQuote();
      swapSay('Could not get a quote from the XRP Ledger.');
    });
  }

  function feeInXrp(amount) {
    var rate = feeRate();
    if (!sw.from || !sw.to) return Promise.resolve(0);
    if (sw.from.native) return Promise.resolve(amount * rate);
    if (sw.to.native) return Promise.resolve(sw.quote ? sw.quote.out * rate : 0);
    var slice = amount * rate;
    if (!(slice > 0)) return Promise.resolve(0);
    return rpc('ripple_path_find', {
      source_account: addr(), destination_account: addr(), destination_amount: '-1',
      send_max: amountObj(sw.from, slice), ledger_index: 'validated'
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      return (alt && typeof alt.destination_amount === 'string') ? (+alt.destination_amount / 1e6) : 0;
    }).catch(function () { return 0; });
  }

  // The Payment a swap actually is: pay myself `to`, spending at most `amt` of `from`, with the
  // slippage floor as the delivered Amount and the ledger's own computed path attached. Factored out
  // because it is now built in two places — up front for a real quote, and after the trust line for an
  // estimated one — and those two must not drift apart.
  function buildSwapTx(q, from, to, me) {
    var minOut = lxx().minAfterSlippage(q.out, SLIP);
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: me,
      Amount: amountObj(to, minOut), SendMax: amountObj(from, q.amt)
    };
    if (!tx.Amount || !tx.SendMax) return null;
    if (q.alt && q.alt.paths_computed && q.alt.paths_computed.length) tx.Paths = q.alt.paths_computed;
    return tx;
  }

  // One path query, returning the best alternative or null. Used by quoteSwap for the live quote and
  // by doSwap to re-quote once a trust line exists.
  function pathQuote(from, to, amt) {
    var me = addr();
    if (!me) return Promise.resolve(null);
    return rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: isXrp(to) ? '-1' : { currency: to.currency, issuer: to.issuer, value: '-1' },
      send_max: amountObj(from, amt),
      ledger_index: 'validated'
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      if (!alt) return null;
      var got = alt.destination_amount;
      var v = typeof got === 'string' ? (+got / 1e6) : +got.value;
      return v > 0 ? alt : null;
    }, function () { return null; });
  }

  // ---- XLS-56 Batch: the fee and the swap in one signature ----------------------------------------
  //
  // Three wallet prompts is what this flow costs today, and the ordering (fee first) exists purely so
  // nobody can take the swap and then refuse the fee. Batch removes the need for that argument: the
  // inner transactions are atomic, so either the fee AND the swap apply or neither does.
  //
  // ONLY WHERE IT IS PROVABLY SAFE, which is narrower than it first looks:
  //
  //   * ONLY WHEN THE TRUST LINE ALREADY EXISTS. A Batch has to carry every inner transaction up
  //     front, and when the line is missing the swap transaction CANNOT BE BUILT yet — without a
  //     trust line ripple_path_find has nothing to answer, which is why the real quote is fetched
  //     between step 2 and step 3 today. So the three-prompt path stays exactly as it is for a first
  //     swap into a new asset, and Batch is used for the two-transaction case.
  //   * ONLY ON XAMAN. It is the one wallet confirmed to sign Batch (4.5.0, with inner signers).
  //     GemWallet and Crossmark are unknown, and unknown has to mean no on a money path.
  //   * ONLY ONCE THE AMENDMENT IS LIVE, checked against the ledger rather than a date. BatchV1_1
  //     activates 2026-10-09 ~14:46 UTC and its clock has already reset once, so a date in code
  //     would be a guess; the Amendments object is the fact.
  //
  // Values are the spec's, not inferred from the bundle: the library's enum index for
  // tfInnerBatchTxn is 1, which is its position, NOT the wire value.
  var BATCH_ALL_OR_NOTHING = 0x00010000;      // outer: every inner applies, or none does
  var INNER_BATCH_TXN = 0x40000000;           // inner: marks a transaction as batched
  var BATCH_V1_1 = '9F287AED3CDB50A7BD1ACEC24296A30C9B5230CCD136219317AC790E3B884377';
  var AMENDMENTS_INDEX = '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4';

  // Asked once per page load. A false answer is cached too — before activation that is the whole
  // point, and it keeps a dead path from costing a request per swap.
  var batchOk = null;
  function batchLive() {
    if (batchOk !== null) return Promise.resolve(batchOk);
    return rpc('ledger_entry', { index: AMENDMENTS_INDEX, ledger_index: 'validated' }, 4000)
      .then(function (r) {
        var list = (r && r.node && r.node.Amendments) || [];
        batchOk = list.indexOf(BATCH_V1_1) >= 0;
        return batchOk;
      })
      .catch(function () { batchOk = false; return false; });   // unknown means no
  }

  function innerTx(tx, seq) {
    var t = {};
    for (var k in tx) if (Object.prototype.hasOwnProperty.call(tx, k)) t[k] = tx[k];
    t.Flags = (Number(t.Flags) || 0) | INNER_BATCH_TXN;
    t.Fee = '0';                 // the outer transaction pays for all of them
    t.Sequence = seq;
    t.SigningPubKey = '';        // inner transactions are not signed on their own
    delete t.TxnSignature;
    return { RawTransaction: t };
  }

  // Returns a message on success, or null to mean "not attempted — use the normal flow".
  //
  // THE FALLBACK IS ONLY SAFE BEFORE SIGNING. Once the Batch has been submitted, a failure is
  // ambiguous — it may have applied — and retrying sequentially could charge the fee twice. So
  // anything that goes wrong from submit() onwards is reported, never retried.
  function swapViaBatch(q, from, to, me, swapTx) {
    var submitted = false;
    return feeInXrp(q.amt).then(function (feeXrp) {
      return rpc('account_info', { account: me, ledger_index: 'validated' }, 6000).then(function (ai) {
        var seq = ai && ai.account_data && Number(ai.account_data.Sequence);
        if (!(seq > 0)) return null;                     // cannot number the inners; fall back
        var raw = [];
        // The outer Batch consumes this account's next sequence, so the inners start one later.
        var s = seq + 1;
        if (feeXrp > 0) {
          raw.push(innerTx({
            TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
            Amount: lxx().toDrops(feeXrp),
            Memos: [feeMemo(from.code, to.code, 1, 1)]
          }, s++));
        }
        raw.push(innerTx(swapTx, s++));
        if (raw.length < 2) return null;                 // a Batch needs at least two inners

        setGo(false, 'Approve the swap (one signature)…');
        submitted = true;
        return window.lxc.submit({
          TransactionType: 'Batch', Account: me, Sequence: seq,
          Flags: BATCH_ALL_OR_NOTHING, RawTransactions: raw
        }).then(function (hash) {
          setGo(false, 'Confirming…');
          return waitValidated(hash);
        }).then(function (res) {
          if (!res || !res.ok) {
            throw new Error(res && res.code === 'timeout'
              ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
              : explain(res && res.code, 'The swap'));
          }
          // All-or-nothing: a validated outer success means every inner applied. The other Batch
          // modes can report success over a failed inner, which is why this one is used.
          return 'Swap complete.';
        });
      });
    }).catch(function (e) {
      if (submitted) throw e;                            // never retry something that may have landed
      return null;                                       // not attempted: the caller runs the normal flow
    });
  }

  function doSwap() {
    if (sw.busy) return;
    var go = $('#swapGo');
    if (!addr()) { connect(); return; }
    if (!sw.quote || (go && go.getAttribute('data-lxdis') === '1')) return;
    var q = sw.quote, from = sw.from, to = sw.to, me = addr();

    // THREE STEPS, IN RAZA'S ORDER (2026-10-07): the platform fee, the trust line, then the swap.
    // The trust line used to be signed first; "Deduct fees / Set trustline / Swap" puts it second,
    // which also matches the fee-first rule from 2026-09-17 that the rest of this file follows.
    var needLine = !!to.issuer && !hasLine(to);
    var steps = needLine ? 3 : 2;

    // WHEN THE QUOTE IS AN ESTIMATE THE TRANSACTION CANNOT BE BUILT YET, and that is the whole reason
    // the order matters. Without a trust line `ripple_path_find` has nothing to answer, so the figure
    // on screen came from the order book and carries no Paths and no agreed minimum. The real quote is
    // fetched between step 2 and step 3, once the line exists — so what gets signed is always a path
    // the ledger just confirmed, never the estimate the button was enabled with.
    var pre = null;
    if (!q.est) {
      pre = buildSwapTx(q, from, to, me);
      if (!pre) { swapSay('That amount is too small for the ledger.'); return; }
    }

    sw.busy = true;
    setGo(false, 'Confirm in wallet…');

    function finish(msg) {
      sw.busy = false;
      toast(msg, false);
      var inEl = $('#swapAmtIn'); if (inEl) inEl.value = '';
      clearQuote();
      return loadAccount(true).then(paintSwap);
    }
    function fail(e) {
      sw.busy = false;
      setGo(!!sw.quote, 'Swap');
      swapSay((e && e.message) || 'The swap could not be completed.');
    }

    // 1. THE FEE (RAZA 2026-09-17), with a memo naming it.
    function runSequential() {
      return feeInXrp(q.amt).then(function (feeXrp) {
      if (!(feeXrp > 0)) return null;
      setGo(false, 'Approve the platform fee (1 of ' + steps + ')…');
      return window.lxc.submit({
        TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
        Amount: lxx().toDrops(feeXrp),
        Memos: [feeMemo(from.code, to.code, 1, steps)]
      }).catch(function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m) ? 'The platform fee was not approved, so nothing was swapped.' : m);
      });
    // 2. THE TRUST LINE, waited on to validation: step 3 asks the ledger for a path INTO this asset,
    //    and it cannot answer until the line is actually on the account.
    }).then(function () {
      if (!needLine) return null;
      setGo(false, 'Approve the ' + to.code + ' trust line (2 of ' + steps + ')…');
      return window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: to.currency, issuer: to.issuer, value: '1000000000' },
        Memos: [{ Memo: {
          MemoType: hexAscii('LumosCore'),
          MemoFormat: hexAscii('text/plain'),
          MemoData: hexAscii('LumosCore: trust line for ' + to.code + ', required before this account can receive it '
            + '- transaction 2 of 3. The swap follows.')
        } }]
      }).then(function (h) {
        setGo(false, 'Confirming…');
        return waitValidated(h);
      }).then(function (res) {
        if (!res || !res.ok) throw new Error(explain(res && res.code, 'The trust line'));
      });
    // 3. THE SWAP, quoted for real first when the button was enabled on an estimate.
    }).then(function () {
      if (!q.est) return pre;
      setGo(false, 'Quoting the swap…');
      return pathQuote(from, to, q.amt).then(function (alt) {
        if (!alt) {
          throw new Error('The ' + to.code + ' trust line is open, but no route is available right now. '
            + 'Nothing further was signed — try the swap again in a moment.');
        }
        var got = alt.destination_amount;
        var outVal = typeof got === 'string' ? (+got / 1e6) : +got.value;
        var tx2 = buildSwapTx({ alt: alt, out: outVal, amt: q.amt }, from, to, me);
        if (!tx2) throw new Error('That amount is too small for the ledger.');
        return tx2;
      });
    }).then(function (tx) {
      setGo(false, 'Approve the swap (' + steps + ' of ' + steps + ')…');
      return window.lxc.submit(tx).then(function (hash) {
        setGo(false, 'Confirming…');
        return waitValidated(hash);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.' : explain(res.code, 'The swap'));
        return 'Swap complete.';
      });
      }).then(finish).catch(fail);
    }

    // ONE SIGNATURE WHERE IT APPLIES, the three-prompt flow everywhere else.
    //
    // swapViaBatch resolves with a message when it ran, or null when it declined to start — and a
    // decline is the only case that falls through to runSequential(), because by then nothing has
    // been signed. Once it has submitted it throws instead, so a swap that may already be on the
    // ledger is never quietly attempted a second time.
    if (!needLine && pre && window.lxc && window.lxc.transport && window.lxc.transport() === 'xaman') {
      batchLive().then(function (ok) {
        return ok ? swapViaBatch(q, from, to, me, pre) : null;
      }).then(function (msg) {
        if (msg) return finish(msg);
        return runSequential();
      }).catch(fail);
      return;
    }
    runSequential();
  }

  // ======================================================================================== LIMIT
  var lim = { s: null, b: null, auto: true, mktMsg: '', busy: false };
  function lEl(s) { return $('#swapModal .lxo-pane[data-pane="limit"] ' + s); }

  function limitUi() {
    var pane = $('#swapModal .lxo-pane[data-pane="limit"]');
    if (!pane || pane.__b) return;
    pane.__b = 1;
    pane.innerHTML = '<div class="lxq-f">'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>You sell</span>'
      + '<span><span class="bal">Available: <span class="lxq-balv">—</span></span> <button type="button" class="lxq-max">MAX</button></span></div>'
      + '<div class="lxq-lin"><div class="lxq-pick" data-side="sell"></div>'
      + '<input class="lxq-in lxq-amt" type="text" inputmode="decimal" placeholder="0.00"></div>'
      + '<div class="lxq-usd lxq-usds"></div></div>'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>You buy</span></div>'
      + '<div class="lxq-lin"><div class="lxq-pick" data-side="buy"></div>'
      + '<span class="lxq-in lxq-recv">—</span></div>'
      + '<div class="lxq-usd lxq-usdb"></div></div>'
      + '<div class="lxq-fld"><div class="lxq-lab"><span>Price</span>'
      + '<span><span class="lxq-unit"></span> <button type="button" class="lxq-mkt">MARKET</button></span></div>'
      + '<div class="lxq-lin"><input class="lxq-in lxq-price" type="text" inputmode="decimal" placeholder="0.00"></div></div>'
      + '<div class="lxq-note"></div><div class="lxq-err"></div>'
      + '<button type="button" class="lxq-go" disabled>Place limit order</button></div>';
    noAuto(lEl('.lxq-amt'));
    noAuto(lEl('.lxq-price'));

    pane.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('.lxq-pick');
      if (p) {
        e.preventDefault(); e.stopImmediatePropagation();
        var side = p.getAttribute('data-side');
        if (side === 'sell' && !addr()) { connect(); return; }
        openMenu(lEl('.lxq-f'), p.closest('.lxq-fld'), function (m) {
          function pick(a) {
            if (side === 'sell') { lim.s = heldOf(a) || a; if (same(lim.b, a)) lim.b = null; }
            else { lim.b = a; if (same(lim.s, a)) lim.s = null; }
            lim.auto = true;
            var pe = lEl('.lxq-price'); if (pe) pe.value = '';
            limitSync(); limitQuote();
          }
          if (side === 'sell') {
            // Same control, same filter as the Swap tab's pay side — this list is the wallet's
            // holdings too, and leaving one of the two unfiltered is the kind of difference that comes
            // back as its own bug report.
            var mine = H.hold.filter(function (a) { return !same(a, lim.b); });
            if (!mine.length) menuHead(m, 'No assets in this wallet yet');
            else filterInto(m, mine, pick);
          } else {
            searchInto(m, lim.s, pick);
            [XRP].concat(curated()).forEach(function (a) { if (!same(a, lim.s)) m.appendChild(menuRow(a, '', pick)); });
          }
        });
        return;
      }
      if (t.closest('.lxq-max')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!lim.s) { toast('Choose an asset to sell first.', true); return; }
        var room = sellable(lim.s);
        // "MAX is not working" (RAZA 2026-10-07) — it was working, and filling in the only honest
        // answer: zero. With 0.023 XRP against a 0.2 XRP order reserve there is nothing to sell, so
        // MAX wrote 0, which is indistinguishable from a dead button. Say so instead.
        if (!(room > 0)) {
          toast(isXrp(lim.s)
            ? ('Nothing to sell: a new order reserves ' + fmt(H.reserve.inc, 2) + ' XRP, which is more than this account has free.')
            : ('You hold no ' + lim.s.code + ' to sell.'), true);
          return;
        }
        var i = lEl('.lxq-amt'); if (i) i.value = plainNum(floorTo(room, 6));
        limitSync();
        return;
      }
      if (t.closest('.lxq-mkt')) {
        e.preventDefault(); e.stopImmediatePropagation();
        lim.auto = true;
        var pe = lEl('.lxq-price'); if (pe) pe.value = '';
        limitSync(); limitQuote();
        return;
      }
      if (t.closest('.lxq-go')) { e.preventDefault(); e.stopImmediatePropagation(); placeLimit(); return; }
      if (!t.closest('.lxq-menu')) closeMenus();
    }, true);

    pane.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('lxq-amt') || t.classList.contains('lxq-price')) {
        var v = String(t.value).replace(/[^0-9.]/g, '');
        var dot = v.indexOf('.');
        if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
        if (v !== t.value) t.value = v;
        if (t.classList.contains('lxq-price')) lim.auto = false;
        limitSync();
      }
    }, true);
    limitSync();
  }

  function pill(el, a) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    if (a) {
      var ic = document.createElement('span'); ic.className = 'lxq-ic'; paintIco(ic, a);
      var cd = document.createElement('span'); cd.setAttribute('data-logoed', '1'); cd.textContent = a.code;
      el.appendChild(ic); el.appendChild(cd);
    } else {
      var cv = document.createElement('span'); cv.className = 'cv'; cv.textContent = 'Select asset';
      el.appendChild(cv);
    }
    var car = document.createElement('span'); car.className = 'car'; car.textContent = '▾';
    el.appendChild(car);
  }

  function limitSync() {
    var ps = lEl('.lxq-pick[data-side="sell"]'), pb = lEl('.lxq-pick[data-side="buy"]');
    if (!ps || !pb) return;
    pill(ps, lim.s); pill(pb, lim.b);
    var u = lEl('.lxq-unit'); if (u) u.textContent = (lim.s && lim.b) ? (lim.b.code + ' per ' + lim.s.code) : '';
    // AVAILABLE MEANS AVAILABLE TO SELL (RAZA 2026-10-07: "if its not available so whys it showing as
    // available"). This read the raw spendable balance — 0.023 XRP — directly above a red line saying
    // "You can sell up to 0 XRP", because placing an order reserves 0.2 XRP that this header did not
    // know about. Two numbers for one quantity, and the reassuring one was wrong. One figure now,
    // shared with MAX and with the validation below, so they cannot disagree again.
    var bl = lEl('.lxq-balv'); if (bl) bl.textContent = lim.s ? (fmt(sellable(lim.s), 3) + ' ' + lim.s.code) : '—';
    var amt = num((lEl('.lxq-amt') || {}).value), pr = num((lEl('.lxq-price') || {}).value);
    var recv = (lim.s && lim.b && amt > 0 && pr > 0) ? amt * pr : 0;
    var tot = lEl('.lxq-recv'); if (tot) tot.textContent = recv > 0 ? fmt(recv, 7) : '—';
    var us = lEl('.lxq-usds'); if (us) us.textContent = usdText(amt, lim.s);
    var ub = lEl('.lxq-usdb'); if (ub) ub.textContent = usdText(recv, lim.b);

    var notes = [];
    if (lim.mktMsg) notes.push(lim.mktMsg);
    if (lim.b && addr() && !hasLine(lim.b)) {
      notes.push('You have no trust line for ' + lim.b.code + ' yet. The XRP Ledger opens one when the order fills, which reserves '
        + fmt(H.reserve.inc, 2) + ' XRP for as long as you hold it.');
    }
    var nt = lEl('.lxq-note'); if (nt) nt.textContent = notes.join(' ');

    var msg = '';
    if (lim.s && lim.b && same(lim.s, lim.b)) msg = 'Pick two different assets.';
    else if (amt > 0 && lim.s && addr()) {
      var free = sellable(lim.s);
      if (amt > free + 1e-12) {
        msg = isXrp(lim.s)
          ? ('You can sell up to ' + fmt(free, 6) + ' XRP — the rest is the reserve your account and a new order need.')
          : ('You only hold ' + fmt(free, 7) + ' ' + lim.s.code + '.');
      }
    }
    var err = lEl('.lxq-err'); if (err) err.textContent = msg;
    var go = lEl('.lxq-go');
    if (go) go.disabled = !(lim.s && lim.b && amt > 0 && pr > 0 && !msg && addr());
  }

  function bookTop(gets, pays) {
    return rpc('book_offers', { taker_gets: specOf(gets), taker_pays: specOf(pays), limit: 1, ledger_index: 'validated' })
      .then(function (r) {
        var o = ((r && r.offers) || [])[0];
        if (!o) return 0;
        var g = fromRaw(o.TakerGets).value, p = fromRaw(o.TakerPays).value;
        return (g > 0 && p > 0) ? { g: g, p: p } : 0;
      }).catch(function () { return 0; });
  }

  // The price field means BUY units per 1 SELL unit. Two books bracket it: offers that give the buy asset
  // for the sell asset (what selling fetches now) and offers that give the sell asset for the buy asset
  // (what buyers are asking). The midpoint seeds the field, as Stellar seeds its own from both sides.
  function limitQuote() {
    if (!lim.s || !lim.b || !lim.auto) return;
    var s = lim.s, b = lim.b, mark = s.code + '|' + (s.issuer || '') + '|' + b.code + '|' + (b.issuer || '');
    limitQuote.k = mark;
    lim.mktMsg = '';
    Promise.all([bookTop(b, s), bookTop(s, b)]).then(function (res) {
      if (limitQuote.k !== mark || !lim.auto) return;
      var bid = res[0] ? res[0].g / res[0].p : 0;          // buy per sell, selling into the best bid
      var ask = res[1] ? res[1].p / res[1].g : 0;          // buy per sell, at the best ask
      var px = (bid > 0 && ask > 0) ? (bid + ask) / 2 : 0;
      var el = lEl('.lxq-price');
      if (!el) return;
      if (px > 0) { el.value = plainNum(Number(px.toPrecision(8))); }
      else {
        el.value = '';
        var lone = bid || ask;
        lim.mktMsg = lone > 0
          ? ('The only quote on ' + s.code + '/' + b.code + ' is a single resting offer at ' + fmt(lone, 8) + ' ' + b.code + ' per ' + s.code + '. One offer is not a market price, so set your own.')
          : ('Nothing is trading ' + s.code + '/' + b.code + ' yet, so there is no market price to fill in — set your own.');
      }
      limitSync();
    });
  }

  function placeLimit() {
    var go = lEl('.lxq-go');
    if (!go || go.disabled || lim.busy) return;
    var me = addr();
    if (!me) { connect(); return; }
    var amt = num((lEl('.lxq-amt') || {}).value), pr = num((lEl('.lxq-price') || {}).value);
    if (!(amt > 0 && pr > 0 && lim.s && lim.b)) return;
    var gets = amountObj(lim.s, amt), pays = amountObj(lim.b, amt * pr);
    if (!gets || !pays || gets === '0' || pays === '0') { var er = lEl('.lxq-err'); if (er) er.textContent = 'That order is too small for the ledger.'; return; }
    var tx = { TransactionType: 'OfferCreate', Account: me, TakerGets: gets, TakerPays: pays, Flags: TF_SELL,
      Memos: [{ Memo: { MemoType: hexAscii('LumosCore'), MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore: limit order ' + (lim.s && lim.s.code) + ' -> ' + (lim.b && lim.b.code)) } }] };
    var label = go.textContent;
    lim.busy = true; go.disabled = true; go.textContent = 'Confirm in wallet…';
    window.lxc.submit(tx).then(function (hash) {
      go.textContent = 'Placing order…';
      return waitValidated(hash);
    }).then(function (res) {
      lim.busy = false; go.textContent = label;
      if (!res.ok) {
        var er2 = lEl('.lxq-err');
        if (er2) er2.textContent = res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check Orders before trying again.' : explain(res.code, 'The order');
        limitSync();
        return;
      }
      toast(rested(res.meta) ? 'Limit order placed.' : 'Order filled.', false);
      var i = lEl('.lxq-amt'); if (i) i.value = '';
      var p2 = lEl('.lxq-price'); if (p2) p2.value = '';
      lim.auto = true;
      return loadAccount(true).then(function () { limitSync(); show('orders'); });
    }).catch(function (e) {
      lim.busy = false; go.textContent = label;
      var er3 = lEl('.lxq-err'); if (er3) er3.textContent = (e && e.message) || 'Could not place the order.';
      limitSync();
    });
  }

  // ======================================================================================== ORDERS
  var cancelled = {};
  function oEl(s) { return $('#swapModal .lxo-pane[data-pane="orders"] ' + s); }
  function emptyState(title, sub) {
    return '<div class="lxo-empty">' + title + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>';
  }

  function ordersUi() {
    var pane = $('#swapModal .lxo-pane[data-pane="orders"]');
    if (!pane || pane.__b) return;
    pane.__b = 1;
    pane.innerHTML = '<div class="lxo-list">' + emptyState('Loading…') + '</div>';
    pane.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-off]') : null;
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      cancelOrder(b);
    }, true);
  }

  function leg(cap, a, amount) {
    var col = document.createElement('div'); col.className = 'lxo-col';
    var cp = document.createElement('div'); cp.className = 'lxo-cap'; cp.textContent = cap;
    var w = document.createElement('div'); w.className = 'lxo-side';
    var ic = document.createElement('span'); ic.className = 'lxq-ic'; paintIco(ic, a);
    var tx = document.createElement('div'); tx.className = 'lxo-tx';
    var q = document.createElement('div'); q.className = 'q'; q.textContent = fmt(amount, 7); q.title = fmt(amount, 7) + ' ' + a.code;
    var c = document.createElement('div'); c.className = 'c'; c.setAttribute('data-logoed', '1'); c.textContent = a.code;
    tx.appendChild(q); tx.appendChild(c); w.appendChild(ic); w.appendChild(tx);
    col.appendChild(cp); col.appendChild(w);
    return col;
  }

  function loadOrders() {
    var list = oEl('.lxo-list');
    if (!list) return;
    var me = addr();
    if (!me) { list.innerHTML = emptyState('Connect a wallet', 'Your open orders across every pair will show here.'); return; }
    rpc('account_offers', { account: me, limit: 200, ledger_index: 'validated' }).then(function (r) {
      var offers = ((r && r.offers) || []).filter(function (o) { return !cancelled[String(o.seq)]; });
      if (!offers.length) { list.innerHTML = emptyState('No open orders', 'A limit order stays here until it fills or you cancel it.'); return; }
      list.innerHTML = '';
      offers.forEach(function (o) {
        var s = fromRaw(o.taker_gets), b = fromRaw(o.taker_pays);
        var row = document.createElement('div'); row.className = 'lxo-o';
        var top = document.createElement('div'); top.className = 'lxo-top';
        top.appendChild(leg('Selling', s.asset, s.value));
        top.appendChild(leg('Receive', b.asset, b.value));
        var ft = document.createElement('div'); ft.className = 'lxo-ft';
        var pw = document.createElement('div'); pw.className = 'lxo-pw';
        var pk = document.createElement('span'); pk.className = 'lxo-k'; pk.textContent = 'Price';
        var pn = document.createElement('span'); pn.className = 'lxo-px';
        pn.textContent = (s.value > 0 ? fmt(b.value / s.value, 8) : '—') + ' ' + b.asset.code + ' per ' + s.asset.code;
        pn.title = pn.textContent;
        pw.appendChild(pk); pw.appendChild(pn); ft.appendChild(pw);
        var cb = document.createElement('button');
        cb.type = 'button';
        cb.setAttribute('data-off', String(o.seq));
        cb.textContent = 'Cancel';
        ft.appendChild(cb);
        row.appendChild(top); row.appendChild(ft);
        list.appendChild(row);
      });
    }).catch(function () { list.innerHTML = emptyState('Could not load your orders.'); });
  }

  function cancelOrder(btn) {
    if (btn.__busy) return;
    var me = addr();
    if (!me) return;
    var seq = +btn.getAttribute('data-off');
    btn.__busy = 1; btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Confirm…';
    window.lxc.submit({ TransactionType: 'OfferCancel', Account: me, OfferSequence: seq }).then(function (hash) {
      btn.textContent = 'Cancelling…';
      return waitValidated(hash);
    }).then(function (res) {
      btn.__busy = 0; btn.disabled = false; btn.textContent = label;
      if (!res.ok) { toast(res.code === 'timeout' ? 'Submitted, but not confirmed yet.' : explain(res.code, 'The cancel'), true); return; }
      toast('Order cancelled.', false);
      cancelled[String(seq)] = 1;
      var row = btn.closest('.lxo-o');
      if (row && row.parentNode) row.parentNode.removeChild(row);
      var list = oEl('.lxo-list');
      if (list && !list.querySelector('.lxo-o')) list.innerHTML = emptyState('No open orders', 'A limit order stays here until it fills or you cancel it.');
      loadAccount(true);
    }).catch(function (e) {
      btn.__busy = 0; btn.disabled = false; btn.textContent = label;
      toast((e && e.message) || 'Could not cancel the order.', true);
    });
  }

  // ======================================================================================== SHELL
  function show(name) {
    var m = modal();
    if (!m) return;
    closeMenus();
    $$('.lxo-pane', m).forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
    $$('.lxo-tabs button', m).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pane') === name); });
    if (name === 'limit') { limitUi(); limitSync(); loadUsd().then(limitSync); loadAccount().then(limitSync); }
    if (name === 'orders') { ordersUi(); loadOrders(); }
  }

  function build() {
    var m = modal();
    if (!m) return false;
    var card = m.firstElementChild;
    if (!card) return false;
    if (card.__lxqo) return true;
    var head = card.firstElementChild;
    if (!head || !document.getElementById('swapAmtIn')) return false;
    card.__lxqo = 1;

    // The design's mock listeners go with the nodes they were bound to.
    ['swapAmtIn', 'swapFlip', 'swapGo'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n && n.parentNode) n.parentNode.replaceChild(n.cloneNode(true), n);
    });

    var ttl = head.firstElementChild;
    if (ttl) ttl.textContent = 'Custom Swap / Orders';
    var swap = document.createElement('div');
    swap.className = 'lxo-pane';
    swap.setAttribute('data-pane', 'swap');
    while (head.nextSibling) swap.appendChild(head.nextSibling);
    var tabs = document.createElement('div');
    tabs.className = 'lxo-tabs';
    tabs.innerHTML = '<button type="button" data-pane="swap" class="on">Swap</button>'
      + '<button type="button" data-pane="limit">Limit</button>'
      + '<button type="button" data-pane="orders">Orders</button>';
    var limit = document.createElement('div');
    limit.className = 'lxo-pane'; limit.setAttribute('data-pane', 'limit'); limit.hidden = true;
    var orders = document.createElement('div');
    orders.className = 'lxo-pane'; orders.setAttribute('data-pane', 'orders'); orders.hidden = true;
    card.appendChild(tabs); card.appendChild(swap); card.appendChild(limit); card.appendChild(orders);
    tabs.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-pane]') : null;
      if (!b) return;
      e.preventDefault(); e.stopImmediatePropagation();
      show(b.getAttribute('data-pane'));
    }, true);

    swapUi();
    clearQuote();
    defaults();
    return true;
  }

  function isOpen(m) { return !!m && (m.style.display === 'flex' || m.classList.contains('open')) && getComputedStyle(m).display !== 'none'; }

  // A REOPENED DIALOG IS A FRESH ONE (RAZA 2026-10-07: "if i enter in the value and then close the
  // popup, if i open it again, it shows the previously input values instead of showing me the
  // refreshed popup").
  //
  // Closing only hides the node — nothing was ever cleared — so a half-typed amount, its converted
  // output, a stale error and whichever tab was last open all survived until the page was reloaded.
  // Worse than untidy: the figures beside them (the quote, the USD line, the rate) are recomputed on
  // open, so the dialog could show an old amount against a new price.
  //
  // The asset PAIR is deliberately not reset here; defaults() re-picks it from the account on every
  // open anyway, and it is the typed numbers that go stale, not the choice of market.
  function resetForms() {
    sw.rev = 0;                         // before the blanking below, or clearQuote would protect it
    var i = $('#swapAmtIn'); if (i) i.value = '';
    var o = $('#swapAmtOut'); if (o) { o.blur(); o.textContent = ''; }
    swapSay('');
    clearQuote();
    var la = lEl('.lxq-amt'); if (la) la.value = '';
    var lp = lEl('.lxq-price'); if (lp) lp.value = '';
    var le = lEl('.lxq-err'); if (le) le.textContent = '';
    lim.auto = true; lim.mktMsg = '';
    show('swap');                       // the dialog's own default, so it opens where it is documented to
  }

  function onOpen() {
    var m = modal();
    if (!m) return;
    build();
    vLoad();                            // the verified roster, in time for the first picker opened
    resetForms();
    Promise.all([loadAccount(true), loadUsd()]).then(function () {
      defaults();
      quoteSwap();
      var lp = $('#swapModal .lxo-pane[data-pane="limit"]');
      if (lp && !lp.hidden) limitSync();
      var op = $('#swapModal .lxo-pane[data-pane="orders"]');
      if (op && !op.hidden) loadOrders();
    });
  }

  function boot() {
    var m = modal();
    if (!m || !window.lxx) return;
    build();
    var was = false;
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var now = isOpen(m);
        if (now && !was) onOpen();
        if (!now) closeMenus();
        was = now;
      }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen(m)) { m.style.display = 'none'; m.classList.remove('open'); }
    });
    // A tap outside the dialog card closes it; the design does this too, and `open` is cleared here so
    // the dashboard's opener shows it again next time.
    m.addEventListener('click', function (e) {
      if (e.target === m || (e.target.closest && e.target.closest('[data-swapclose]'))) {
        m.style.display = 'none';
        m.classList.remove('open');
      }
    });
    if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { H.who = ''; if (isOpen(m)) onOpen(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
