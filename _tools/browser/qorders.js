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
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
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
    if (a.v) cd.setAttribute('data-v', '1');
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
    var m = document.createElement('div');
    m.className = 'lxq-menu';
    m.style.top = (anchor.offsetTop + anchor.offsetHeight + 6) + 'px';
    build(m);
    m.addEventListener('click', function (e) { e.stopPropagation(); });
    host.appendChild(m);
  }

  function searchInto(m, exclude, onPick) {
    menuHead(m, 'Search any asset');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Code or issuer address';
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
  var sw = { from: null, to: null, quote: null, seq: 0, busy: false, wired: false };

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
    if (out) out.textContent = '0.00';
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
          if (!list.length) menuHead(m, 'No assets in this wallet yet');
          list.forEach(function (a) {
            if (side === 'to' && same(a, other)) return;
            var h = heldOf(a);
            m.appendChild(menuRow(a, h ? fmt(h.spendable, 6) : '0', function (picked) {
              if (side === 'from') { sw.from = picked; if (same(sw.to, picked)) sw.to = null; }
              else { sw.to = picked; if (same(sw.from, picked)) sw.from = null; }
              paintSwap(); quoteSwap();
            }));
          });
          if (side === 'to') {
            var note = document.createElement('div');
            note.className = 'h';
            note.style.textTransform = 'none';
            note.style.letterSpacing = '0';
            note.textContent = 'You can receive XRP and any token you already have a trust line for.';
            m.appendChild(note);
          }
        });
        return;
      }
      if (t.closest('.lx-swapmax')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!sw.from) return;
        var room = sw.from.native ? Math.max(0, sw.from.spendable / (1 + feeRate()) - 0.00002) : sw.from.spendable;
        $('#swapAmtIn').value = plainNum(floorTo(room, 6));
        quoteSwap();
        return;
      }
      if (t.closest('#swapFlip')) {
        e.preventDefault(); e.stopImmediatePropagation();
        var a = sw.from, b = sw.to;
        sw.from = b && heldOf(b) ? heldOf(b) : b; sw.to = a;
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
      var v = String(e.target.value).replace(/[^0-9.]/g, '');
      var dot = v.indexOf('.');
      if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      if (v !== e.target.value) e.target.value = v;
      clearTimeout(tmr);
      tmr = setTimeout(quoteSwap, 300);
    }, true);
  }

  function swapSay(text) {
    var err = $('#swapModal .lx-swap-err');
    if (!err) return;
    err.textContent = text || '';
    err.style.display = text ? '' : 'none';
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
  }

  function defaults() {
    if (!sw.from || (addr() && !heldOf(sw.from))) sw.from = heldOf(XRP) || XRP;
    if (!sw.to) {
      var t = H.lines.filter(function (a) { return !a.frozen && !same(a, sw.from); })[0];
      sw.to = t || null;
    }
    paintSwap();
  }

  function clearQuote() {
    sw.quote = null;
    var out = $('#swapAmtOut'); if (out) out.textContent = '0.00';
    var rate = $('#swapRate'); if (rate) rate.textContent = '—';
    var det = $('#swapModal .lx-swapd'); if (det) det.style.display = 'none';
    setGo(false, 'Swap');
  }

  function quoteSwap() {
    var me = addr();
    var amt = num(($('#swapAmtIn') || {}).value);
    swapSay('');
    if (!(amt > 0) || !sw.from || !sw.to) { clearQuote(); return; }
    if (!me) { clearQuote(); setGo(true, 'Connect wallet'); return; }
    if (same(sw.from, sw.to)) { clearQuote(); swapSay('Pick two different assets.'); return; }
    var seq = ++sw.seq;
    setGo(false, 'Finding a route…');
    rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: sw.to.native ? '-1' : { currency: sw.to.currency, issuer: sw.to.issuer, value: '-1' },
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

  function doSwap() {
    if (sw.busy) return;
    var go = $('#swapGo');
    if (!addr()) { connect(); return; }
    if (!sw.quote || (go && go.getAttribute('data-lxdis') === '1')) return;
    var q = sw.quote, from = sw.from, to = sw.to, me = addr();
    var minOut = lxx().minAfterSlippage(q.out, SLIP);
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: me,
      Amount: amountObj(to, minOut), SendMax: amountObj(from, q.amt)
    };
    if (!tx.Amount || !tx.SendMax) { swapSay('That amount is too small for the ledger.'); return; }
    if (q.alt.paths_computed && q.alt.paths_computed.length) tx.Paths = q.alt.paths_computed;

    sw.busy = true;
    setGo(false, 'Approve in wallet…');

    // THE TRUST LINE THIS PATH NEVER HAD. Trade-Asset and the wallet dialog both add one automatically when the account
    // cannot yet receive the token being bought; this one did not, so a Custom Swap into anything new failed at the ledger
    // with a routing error that read like a missing market. Same three steps as everywhere else now.
    var needLine = !!to.issuer && !heldOf(to);
    var steps = needLine ? 3 : 2;
    var first = Promise.resolve();
    if (needLine) {
      setGo(false, 'Approve the ' + to.code + ' trust line (1 of ' + steps + ')…');
      first = window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: to.currency, issuer: to.issuer, value: '1000000000' },
        Memos: [{ Memo: {
          MemoType: hexAscii('LumosCore'),
          MemoFormat: hexAscii('text/plain'),
          MemoData: hexAscii('LumosCore: trust line for ' + to.code + ', required before this account can receive it '
            + '- transaction 1 of 3. The platform fee and the swap follow.')
        } }]
      }).then(function (h) {
        setGo(false, 'Confirming…');
        return waitValidated(h);
      }).then(function (res) {
        if (!res || !res.ok) throw new Error(explain(res && res.code, 'The trust line'));
      });
    }

    // THE FEE GOES FIRST (RAZA 2026-09-17), with a memo naming it, and the swap is the last signature. Same order and the
    // same wording as the other two swap paths, so a swap is the same steps wherever it is started from.
    first.then(function () { return feeInXrp(q.amt); }).then(function (feeXrp) {
      if (!(feeXrp > 0)) return null;
      setGo(false, 'Approve the platform fee (' + (steps - 1) + ' of ' + steps + ')…');
      return window.lxc.submit({
        TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
        Amount: lxx().toDrops(feeXrp),
        Memos: [feeMemo(from.code, to.code, steps - 1, steps)]
      }).catch(function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m) ? 'The platform fee was not approved, so nothing was swapped.' : m);
      });
    }).then(function () {
      setGo(false, 'Approve the swap (' + steps + ' of ' + steps + ')…');
      return window.lxc.submit(tx).then(function (hash) {
        setGo(false, 'Confirming…');
        return waitValidated(hash);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.' : explain(res.code, 'The swap'));
        return 'Swap complete.';
      });
    }).then(function (msg) {
      sw.busy = false;
      toast(msg, false);
      var inEl = $('#swapAmtIn'); if (inEl) inEl.value = '';
      clearQuote();
      return loadAccount(true).then(paintSwap);
    }).catch(function (e) {
      sw.busy = false;
      setGo(!!sw.quote, 'Swap');
      swapSay((e && e.message) || 'The swap could not be completed.');
    });
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
            if (!H.hold.length) menuHead(m, 'No assets in this wallet yet');
            H.hold.forEach(function (a) { if (!same(a, lim.b)) m.appendChild(menuRow(a, fmt(a.spendable, 7), pick)); });
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
        var h = heldOf(lim.s);
        var room = h ? h.spendable : 0;
        if (lim.s.native) room = Math.max(0, room - H.reserve.inc - 0.00002);
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
    var h = lim.s && heldOf(lim.s);
    var bl = lEl('.lxq-balv'); if (bl) bl.textContent = lim.s ? (fmt(h ? h.spendable : 0, 3) + ' ' + lim.s.code) : '—';
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
      var free = h ? h.spendable : 0;
      if (lim.s.native) free = Math.max(0, free - H.reserve.inc);
      if (amt > free + 1e-12) {
        msg = lim.s.native
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
    var tx = { TransactionType: 'OfferCreate', Account: me, TakerGets: gets, TakerPays: pays, Flags: TF_SELL };
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

  function onOpen() {
    var m = modal();
    if (!m) return;
    build();
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
