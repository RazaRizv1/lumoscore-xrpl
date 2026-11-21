// Create Pool: an XRP Ledger AMMCreate, driven from the design's own #createPoolModal.
//
// RAZA 2026-09-15, comparing with lumoscore.com: "why it says the pool creation is not enabled", the
// "Trading fee 0.5%" row that Stellar does not show, and a "Select asset" that read dimmer than Stellar's.
// All three came from the same place: this dialog was deliberately disabled while nothing on the build
// could sign, and the disabling faded the pickers, relabelled the button and left the design's fee row up.
// Every other write path (send, swap, trust lines, LP deposit, limit orders) signs through window.lxc now,
// so this one does too.
//
// NO NEW UI. The asset pickers, dropdowns, balance lines, MAX, summary rows and buttons are the design's.
// The dropdown items use `.ad-item.lx-cpitem` — the class Stellar's layer gives its real items, and the
// only one the inherited stylesheet lets through (`.ad-item:not(.lx-cpitem){display:none!important}` hides
// the design's mock rows). One status line is added under the summary, the same pattern every other XRPL
// dialog on this build uses to say what happened.
//
// WHAT THE LEDGER NEEDS, and what is checked before anything is signed:
//   * AMMCreate takes Amount + Amount2 (the two deposits, which set the opening price) and TradingFee in
//     1/100,000 units. 200 = 0.2% — the platform's own rate, matching the launchpad's pools, and the way
//     LumosCore earns on the assets it mints (the fee accrues to LP holders on every swap through the pool,
//     wherever that swap was started). The row stays hidden because Stellar hides it.
//   * Its transaction cost is SPECIAL: it destroys one owner-reserve increment (0.2 XRP today), not the
//     usual ~0.00001. The Network fee row states that figure, read from the ledger, and Fee is set to it
//     explicitly so no wallet autofill can under-pay and have the transaction rejected.
//   * The creator receives LP tokens on a new trust line, which reserves one more increment.
//   * One pool per pair: if amm_info finds one, the same two amounts are DEPOSITED into it (AMMDeposit,
//     tfTwoAsset) rather than refused — RAZA 2026-09-15.
//   * An issued token can only enter a pool if its issuer has Default Ripple enabled (else terNO_RIPPLE).
(function () {
  if (window.__lxxCreatePool) return;
  window.__lxxCreatePool = 1;

  // THE AMOUNT SPILLS OUT OF THE DIALOG WITHOUT THIS (RAZA 2026-09-17, the $LUMOS page's Add Liquidity dialog: "its still
  // breaking. the value is going out of the place"). `.asset-amt` is an <input> in a flex row with `flex:1 1 0`, and an
  // input's default `min-width:auto` resolves to its intrinsic ~20-character width — 241px here — so it refuses to shrink
  // and pushes 21px of itself past the panel, taking a horizontal scrollbar with it. The row is 360px wide on this page
  // and wider on the Pools page, which is why only this one showed it. Nothing about the design changes: the field simply
  // becomes able to do what `flex:1 1 0` already asked of it.
  (function amtFits() {
    if (document.getElementById('lx-cpfit')) return;
    var st = document.createElement('style');
    st.id = 'lx-cpfit';
    st.textContent = '#createPoolModal .asset-amt{min-width:0}';
    (document.head || document.documentElement).appendChild(st);
  })();

  var RPC = 'https://xrplcluster.com/';
  var XRP_THUMB = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  // 0.2%, in units of 1/1000 of a percent. RAZA 2026-09-17: LumosCore earns on its own pools as a liquidity provider —
  // "0.2% pool fee for lumoscore minted. we'll keep doing that" — so a pool created here charges what the platform charges,
  // and that fee accrues to whoever holds the LP tokens, on every swap through it, from anywhere on the ledger.
  // The fee on an existing pool can only be changed afterwards by an LP vote (AMMVote), weighted by LP share.
  var TRADING_FEE = 200;
  var LSF_DEFAULT_RIPPLE = 0x00800000;
  // This project's own token: the default first asset when the dialog is opened from the $LUMOS page.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var LUMOS_CUR = '4C554D4F53000000000000000000000000000000';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function modal() { return document.getElementById('createPoolModal'); }
  function lxx() { return window.lxx; }

  // LUMOSCORE'S OWN MARK ON A POOL TRANSACTION (RAZA 2026-10-07: "on XRPL i cant see all types of
  // activities. I mean, ive been doing so many things like creating pools, withdrawing, swapping").
  //
  // A swap is attributable because it pays a platform fee, and the dashboard feed finds swaps by
  // pairing each fee with the self-payment beside it. **Pool operations pay no fee**, so until now
  // nothing on the ledger distinguished an AMMCreate made here from one made on xrpl.to, Sologenic or
  // First Ledger — and the feed cannot honestly list what it cannot attribute. That is the same
  // objection RAZA raised on 2026-09-17 about rows that were not his.
  //
  // This memo is the attribution. It costs a few bytes, it is visible to anyone reading the ledger,
  // and it says only what is true: this transaction was built by LumosCore.
  //
  // Only transactions signed from today forward carry it, so pool actions taken before this ships
  // stay unattributable and will not appear.
  function lxMemo(text) {
    var hex = function (s) {
      var h = '';
      for (var i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0');
      return h.toUpperCase();
    };
    return { Memo: { MemoType: hex('LumosCore'), MemoFormat: hex('text/plain'), MemoData: hex(text) } };
  }

  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }

  // Every ledger read here goes through the shared retrying transport (xrpl-core: ledgerPost), so a
  // throttle is waited out instead of reported as a dead ledger. xrplcluster meters by units, not
  // requests, and one busy page can spend the quota on its own.
  //
  // It resolves with the same parsed envelope fetch().json() did, errors included, so the handling
  // below is unchanged. The fallback keeps the old behaviour exactly if lxx has not loaded.
  function lxpost(u, o) {
    try { return window.lxx.ledgerPost(u, o); }
    catch (e) { return fetch(u, o).then(function (r) { return r.json(); }); }
  }

  function rpc(method, params) {
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (j) { return (j && j.result) || {}; });
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

  // The bottom-centre confirmation, the same one the rest of this build uses. window.lxToast when the
  // page provides it; otherwise the .lx-ctoast stack, whose stylesheet is shared by id with the other
  // layers that draw it — so if one of them is already on the page this adds no second copy.
  function poolToast(msg) {
    if (typeof window.lxToast === 'function') { try { window.lxToast(msg, false); return; } catch (e) {} }
    try {
      if (!document.getElementById('lx-copytoast-css')) {
        var st = document.createElement('style');
        st.id = 'lx-copytoast-css';
        st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
          + 'z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
          + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;'
          + 'border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;'
          + 'font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;'
          + 'box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
          + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);'
          + 'color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;'
          + 'font-size:12px}';
        (document.head || document.documentElement).appendChild(st);
      }
      var stack = document.querySelector('.lx-ctoast-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'lx-ctoast-stack';
        document.body.appendChild(stack);
      }
      var t = document.createElement('div');
      t.className = 'lx-ctoast';
      // data-logoed so the logo healer leaves the tick alone — it repaints short-text elements.
      t.innerHTML = '<span class="ci" data-logoed="1">✓</span>';
      t.appendChild(document.createTextNode(msg));
      stack.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    } catch (e) {}
  }
  function floorTo(n, dp) { var k = Math.pow(10, dp); return Math.floor(n * k) / k; }
  function plainNum(n) {
    if (!(n > 0)) return '';
    return lxx().iouValue(n) || '';
  }

  // ---- state ---------------------------------------------------------------------------------------
  var S = { hold: null, who: '', reserve: null, pick: [null, null], busy: false, loading: null };

  function logoFor(a) {
    return a.currency === 'XRP' ? XRP_THUMB
      : '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(a.currency) + '&w=48';
  }
  function same(a, b) { return !!a && !!b && a.currency === b.currency && (a.issuer || '') === (b.issuer || ''); }
  function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }

  function load(force) {
    var who = addr();
    if (!who) { S.hold = []; S.who = ''; return Promise.resolve(); }
    if (!force && S.who === who && S.hold) return Promise.resolve();
    if (S.loading && !force) return S.loading;
    S.failed = false;                         // describes the most recent attempt only (bug X23)
    S.loading = Promise.all([
      rpc('account_info', { account: who, ledger_index: 'validated' }),
      rpc('server_info', {}),
      lxx().allLines(rpc, who).catch(function () { return { lines: [], incomplete: true }; })
    ]).then(function (r) {
      var si = ((r[1] && r[1].info) || {}).validated_ledger || {};
      S.reserve = { base: +si.reserve_base_xrp > 0 ? +si.reserve_base_xrp : 1, inc: +si.reserve_inc_xrp > 0 ? +si.reserve_inc_xrp : 0.2 };
      var info = r[0] && r[0].account_data;
      // actNotFound is an ANSWER (the account is not on the ledger yet); no account_data for any other reason is a
      // failed read and must not be reported as an empty wallet (bug X23, as qorders.js).
      S.unfunded = !!(r[0] && r[0].error === 'actNotFound');
      S.failed = (!info && !S.unfunded) || (!S.unfunded && !!(r[2] && r[2].incomplete));   // 2026-11-21: incomplete lines = failed read
      var list = [];
      if (info) {
        var sp = lxx().spendableXrp(info.Balance, info.OwnerCount, S.reserve);
        list.push({ code: 'XRP', currency: 'XRP', issuer: null, balance: sp.balance, spendable: sp.spendable });
      }
      var rl = lxx().readLines((r[2] && r[2].lines) || []);
      rl.held.forEach(function (t) {
        // Frozen lines cannot move and opaque codes have no name to show; neither can seed a pool.
        if (!(t.balance > 0) || t.frozen || t.kind === 'opaque') return;
        list.push({ code: t.display, currency: t.currency, issuer: t.issuer, balance: t.balance, spendable: t.balance });
      });
      S.hold = list;
      S.who = S.failed ? '' : who;              // a failed read is not cached: the next open reads again
      S.loading = null;
    }).catch(function () { S.loading = null; S.failed = true; S.who = ''; S.hold = S.hold || []; });
    return S.loading;
  }

  // ---- the design's two asset fields --------------------------------------------------------------
  function fields() { var m = modal(); return m ? $$('.asset-field', m) : []; }
  function balEl(f) { return $('.field-foot .balance strong', f) || $('.field-foot > span:first-child', f); }

  function paintField(i) {
    var f = fields()[i];
    if (!f) return;
    var a = S.pick[i];
    var pk = $('.asset-picker', f);
    if (pk) {
      pk.removeAttribute('aria-disabled');
      pk.style.pointerEvents = '';
      pk.style.opacity = '';
      var ico = $('.ap-ico', pk), nm = $('.ap-name', pk);
      if (a) {
        pk.classList.remove('placeholder');
        if (ico) {
          ico.textContent = '';
          ico.setAttribute('data-logoed', '1');
          ico.style.background = 'center / cover no-repeat url("' + logoFor(a) + '")';
        }
        if (nm) { nm.textContent = a.code; nm.setAttribute('data-logoed', '1'); }
        if (nm) nm.style.color = '';
      } else {
        pk.classList.add('placeholder');
        if (ico) { ico.removeAttribute('style'); ico.textContent = '?'; ico.setAttribute('data-logoed', '1'); }
        // INHERITED, as on lumoscore.com: its label takes .asset-picker.placeholder's var(--text-muted) —
        // measured 165,164,172 in dark and 90,90,102 in light, identical CSS on both builds. The --text-soft
        // override set here earlier matched light and made dark a step DIMMER (RAZA: "still brighter on Stellar").
        if (nm) { nm.textContent = 'Select asset'; nm.style.color = ''; }
      }
    }
    var b = balEl(f);
    if (b) {
      // NO TICKER AFTER THE FIGURE (RAZA 2026-10-02: "It shows the asset code again along with the
      // balance. Its unnecessary"). The code is already on the picker directly above this line, so
      // repeating it says the same thing twice — Stellar's reads "Balance: 51,572" and stops there.
      var txt = a ? fmt(a.spendable, 6) : '—';
      if (b.tagName === 'STRONG') b.textContent = txt;
      else b.textContent = 'Balance: ' + txt;
    }
  }

  function closeLists(except) {
    fields().forEach(function (f) {
      var dd = $('.asset-dropdown', f);
      if (dd && dd !== except) { dd.classList.remove('open'); dd.style.display = ''; }
    });
  }

  function renderList(i, ddIn) {
    var f = fields()[i];
    var dd = ddIn || (f && $('.asset-dropdown', f)), list = dd && $('.ad-list', dd);
    if (!list) return;
    var q = (($('.ad-search-input', dd) || {}).value || '').trim().toLowerCase();
    $$('.lx-cpitem', list).forEach(function (n) { n.parentNode.removeChild(n); });
    var rows = (S.hold || []).filter(function (a) {
      if (!q) return true;
      return a.code.toLowerCase().indexOf(q) >= 0 || (a.issuer || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      var none = document.createElement('div');
      none.className = 'ad-item lx-cpitem';
      none.style.cssText = 'cursor:default;opacity:.7;justify-content:center';
      none.textContent = S.hold && S.hold.length ? 'No matching assets'
        : (S.loading || S.hold === null) ? 'Loading your assets…'
        : S.failed ? 'Could not read this wallet — close and reopen to try again'
        : S.unfunded ? 'This wallet is not funded yet' : 'No assets in this wallet yet';
      list.appendChild(none);
      return;
    }
    if (S.failed) {   // XRP was read, the tokens were not (2026-11-21): say so, rather than offer XRP as the whole wallet
      var warn = document.createElement('div');
      warn.className = 'ad-item lx-cpitem';
      warn.style.cssText = 'cursor:default;opacity:.7;justify-content:center';
      warn.textContent = "Couldn't read your tokens — close and reopen to try again";
      list.appendChild(warn);
    }
    rows.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-item lx-cpitem';
      b.__lxxAsset = a;
      var ic = document.createElement('span');
      ic.className = 'ad-ico';
      ic.setAttribute('data-logoed', '1');
      ic.style.background = 'center / cover no-repeat url("' + logoFor(a) + '")';
      var meta = document.createElement('span');
      meta.className = 'ad-meta';
      var tk = document.createElement('span'); tk.className = 'ad-tk'; tk.setAttribute('data-logoed', '1'); tk.textContent = a.code;
      var nm = document.createElement('span'); nm.className = 'ad-nm'; nm.textContent = a.issuer ? shortAddr(a.issuer) : 'XRP Ledger';
      meta.appendChild(tk); meta.appendChild(nm);
      var bal = document.createElement('span'); bal.className = 'ad-bal'; bal.textContent = fmt(a.spendable, 4);
      b.appendChild(ic); b.appendChild(meta); b.appendChild(bal);
      list.appendChild(b);
    });
  }

  function openList(i) {
    S.openIdx = i;
    var f = fields()[i];
    var dd = f && $('.asset-dropdown', f);
    if (!dd) return;
    var wasOpen = dd.classList.contains('open');
    closeLists(dd);
    if (wasOpen) { dd.classList.remove('open'); return; }
    dd.style.display = '';
    dd.classList.add('open');
    renderList(i);
    load().then(function () { renderList(i); });
    var si = $('.ad-search-input', dd);
    if (si) { try { si.focus(); } catch (e) {} }
  }

  // ---- the other amount, at the market rate ---------------------------------------------------------
  //
  // RAZA 2026-09-15: "Its not auto calculating Asset 2 when im inputting asset 1 amount. It should also
  // work if i input Asset 2 amount." Stellar's dialog fills the other side from the pair's fair rate as
  // you type either one, so the pool opens at the market price rather than at whatever two numbers were
  // typed — which is exactly what the note under the summary warns about.
  //
  // The rate is each asset's price in XRP from /lxapi/xrplprices, the same feed the wallet prices its
  // holdings with, so the two pages agree about what a token is worth. XRP is 1 by definition. A token
  // with no price has no fair rate, and then nothing is filled in rather than something guessed.
  // RAZA 2026-09-16: "I entered asset 2 but Asset 1 is not calculating" (RIPPLEDICK / ATOM). A failed or empty price lookup was
  // remembered as "no price" for the rest of the visit. Only real prices are remembered now, and a token the price service does
  // not list is priced off its XRP pool on the ledger.
  var PX = {};
  // ONE BULK READ INSTEAD OF A CALL PER ASSET (RAZA 2026-09-16: "Its taking too long to calculate the other asset when one
  // asset is entered"). The ranked list carries about six hundred tokens' prices in a single cached response and is asked
  // for as soon as the dialog opens, so by the time an amount is typed the rate is usually already here. The per-asset
  // lookup and the pool fallback stay for what the list does not carry.
  var BULK = null, BULK_OK = false;
  function bulk() {
    if (!BULK) {
      BULK = fetch('/lxapi/xrplprices').then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && j.t) {
          BULK_OK = true;
          Object.keys(j.t).forEach(function (kk) {
            var v = +((j.t[kk] || [])[0]);
            if (v > 0 && !(PX[kk] > 0)) PX[kk] = v;
          });
        }
      }, function () {});
    }
    return BULK;
  }

  function priceXrp(a) {
    if (!a) return Promise.resolve(null);
    if (a.currency === 'XRP') return Promise.resolve(1);
    var k = a.issuer + '-' + a.currency;
    if (PX[k] > 0) return Promise.resolve(PX[k]);
    return bulk().then(function () {
      if (PX[k] > 0) return PX[k];
      // STRAIGHT TO THE LEDGER FOR WHAT THE LIST DOES NOT CARRY (RAZA 2026-09-17: "[Still taking too long]", measured on
      // FUZZY + XYIELD). The bulk list holds every token the price service knows, so when it has answered and this token is
      // not in it — XYIELD is the standing example — asking the service again for that one token cannot succeed either. It
      // cost a whole round trip before the pool lookup that was always going to be the answer: 3.0s, against 0.1s for a
      // listed token. Now the pool is asked first in that case.
      return BULK_OK ? ammPrice(a, k) : priceOne(a, k);
    });
  }

  function priceOne(a, k) {
    return fetch('/lxapi/xrplprices?t=' + encodeURIComponent(k))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var row = j && j.ok && j.t && j.t[k];
        if (row && +row[0] > 0) { PX[k] = +row[0]; return PX[k]; }
        throw new Error('no price');
      })
      .catch(function () { return ammPrice(a, k); });
  }

  // The pool's own reserves are a rate: XRP per token, straight from the ledger.
  function ammPrice(a, k) {
    return rpc('amm_info', { asset: { currency: 'XRP' }, asset2: { currency: a.currency, issuer: a.issuer }, ledger_index: 'validated' })
      .then(function (r) {
        var amm = r && r.amm;
        if (!amm) return null;
        var xr = typeof amm.amount === 'string' ? Number(amm.amount) / 1e6 : Number(amm.amount2) / 1e6;
        var tr = typeof amm.amount === 'string' ? Number(amm.amount2 && amm.amount2.value) : Number(amm.amount && amm.amount.value);
        if (!(xr > 0) || !(tr > 0)) return null;
        PX[k] = xr / tr;
        return PX[k];
      }, function () { return null; });
  }

  function autofill(i) {
    var a = S.pick[i], b = S.pick[1 - i];
    var f = fields();
    if (i < 0 || !a || !b || !f[i] || !f[1 - i]) return;
    var src = $('.asset-amt', f[i]), dst = $('.asset-amt', f[1 - i]);
    if (!src || !dst) return;
    var v = num(src.value);
    if (!(v > 0)) { if (document.activeElement !== dst) dst.value = ''; recalc(); return; }
    Promise.all([priceXrp(a), priceXrp(b)]).then(function (px) {
      if (!(px[0] > 0) || !(px[1] > 0)) return;
      if (num(src.value) !== v || document.activeElement === dst) return;   // typed on, or typing there
      dst.value = plainNum(floorTo(v * px[0] / px[1], 6));
      recalc();
    });
  }

  // ---- summary + status ----------------------------------------------------------------------------
  function summaryRow(label) {
    var m = modal();
    var rows = m ? $$('.pool-summary .row', m) : [];
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp('^\\s*' + label, 'i').test(k.textContent || '')) return rows[i];
    }
    return null;
  }

  function say(text, tone) {
    var m = modal();
    if (!m) return;
    var box = $('.lxx-cp-say', m);
    if (!box) {
      var sum = $('.pool-summary', m);
      if (!sum) return;
      box = document.createElement('div');
      box.className = 'lxx-cp-say';
      box.style.cssText = 'margin:10px 2px 0;font-size:13px;font-weight:600;line-height:1.5';
      sum.parentNode.insertBefore(box, sum.nextSibling);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? 'var(--red,#e5484d)' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  function amounts() {
    return fields().map(function (f) { var i = $('.asset-amt', f); return num(i && i.value); });
  }

  function recalc() {
    var m = modal();
    if (!m) return;
    // "MAX" is three letters in a rounded box, which the logo healer repaints as a token mark (RAZA 2026-09-16: "Instead on max button,
    // its showin tiny ATOM logo"). Its stamp is removed, its label restored, and an empty svg keeps the healer off it.
    $$('.max-btn', m).forEach(function (b) {
      if (b.getAttribute('data-logo')) { b.removeAttribute('data-logo'); b.style.background = ''; b.style.backgroundImage = ''; }
      b.setAttribute('data-logoed', '1');
      if (!(b.textContent || '').trim()) b.insertBefore(document.createTextNode('MAX'), b.firstChild);
      if (!b.querySelector('svg')) {
        var s0 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s0.setAttribute('width', '0'); s0.setAttribute('height', '0');
        s0.style.cssText = 'position:absolute;width:0;height:0';
        b.appendChild(s0);
      }
    });
    var fee = summaryRow('Trading fee');
    if (fee) {
      // The row stays hidden, as on lumoscore.com — but the design ships it reading "0.5%", so the figure is corrected
      // rather than left as a wrong number waiting for someone to unhide it.
      var fv = fee.querySelector('strong');
      if (fv) fv.textContent = (TRADING_FEE / 1000) + '%';
      fee.style.display = 'none';
    }
    var net = summaryRow('Network fee');
    if (net) {
      var v = net.querySelector('strong');
      if (v) v.textContent = '≈ ' + fmt(S.reserve ? S.reserve.inc : 0.2, 6) + ' XRP';
      net.title = 'Creating a pool destroys one owner reserve increment instead of the usual network fee';
    }
    var px = summaryRow('Initial pool price');
    if (px) {
      var pv = px.querySelector('strong');
      var am = amounts(), a = S.pick[0], b = S.pick[1];
      // STELLAR'S SHAPE, AND STELLAR'S PRECISION (RAZA 2026-10-02: "Initial pool price and network fee
      // section isn't the same as on Stellar. Also, lets keep the decimal places to 2 places").
      //
      // It read "1 ATOM = 108,523,501.69230771 PHNIX" — a sentence, at eight decimals, wrapping onto a
      // second line. Stellar states the same fact as a rate: "0.002081 HOLA/CANNACOIN".
      //
      // Two decimals, EXCEPT where two decimals would destroy the number. A pool of a cheap token
      // against an expensive one has a ratio well under 0.01, and rounding that to "0.00" would print a
      // price of zero for a pool that has one — the figure people are told to match against the market
      // rate. Below that threshold it keeps enough places to stay a number.
      if (pv) {
        if (!(a && b && am[0] > 0 && am[1] > 0)) pv.textContent = '—';
        else {
          var rate = am[1] / am[0];
          pv.textContent = fmt(rate, rate < 0.01 ? 6 : 2) + ' ' + b.code + '/' + a.code;
        }
      }
    }
    var go = primary();
    if (go) {
      go.removeAttribute('disabled');
      go.removeAttribute('aria-disabled');
      go.style.opacity = '';
      go.style.pointerEvents = '';
      if (!go.__lxxLabelled) {
        go.__lxxLabelled = 1;
        [].forEach.call(go.childNodes, function (n) {
          if (n.nodeType === 3 && n.nodeValue.trim()) n.nodeValue = ' Create pool ';
        });
      }
    }
  }

  function primary() { var m = modal(); return m ? $('.modal-foot .btn-primary', m) : null; }
  function setLabel(btn, text) {
    var done = false;
    [].forEach.call(btn.childNodes, function (n) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = ' ' + text + ' '; done = true; }
    });
    if (!done) btn.appendChild(document.createTextNode(' ' + text + ' '));
  }

  function amountObj(a, value) {
    if (a.currency === 'XRP') return lxx().toDrops(value);
    var v = lxx().iouValue(value);
    return v ? { currency: a.currency, issuer: a.issuer, value: v } : null;
  }
  function specOf(a) { return a.currency === 'XRP' ? { currency: 'XRP' } : { currency: a.currency, issuer: a.issuer }; }

  var CODES = {
    tecDUPLICATE: 'A pool for this pair already exists — add liquidity to it from its page instead.',
    tecAMM_UNFUNDED: 'You do not hold enough of one of the assets for this deposit.',
    tecUNFUNDED_AMM: 'You do not hold enough of one of the assets for this deposit.',
    tecAMM_EMPTY: 'That pool has been emptied and has to be refilled from its own page.',
    tecAMM_FAILED: 'The pool could not take those amounts at its current ratio. Try smaller amounts.',
    tecINSUF_RESERVE_LINE: 'Not enough XRP to cover the reserve for the pool’s LP token line.',
    tecFROZEN: 'One of these assets is frozen by its issuer, so it cannot enter a pool.',
    tecNO_AUTH: 'One of these assets needs its issuer to authorise your trust line first.',
    tecNO_LINE: 'You do not have a trust line for one of these assets.',
    tecAMM_INVALID_TOKENS: 'One of these assets cannot be used in a pool.',
    terNO_RIPPLE: 'An issuer of one of these assets has not enabled rippling, so the XRP Ledger will not accept it in a pool.',
    temBAD_AMM_TOKENS: 'Pick two different assets.',
    telINSUF_FEE_P: 'The network is busy and the fee was too low. Try again shortly.'
  };

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

  function create() {
    if (S.busy) return;
    var who = addr();
    if (!who) { if (window.lxc && window.lxc.open) window.lxc.open(); return; }
    var a = S.pick[0], b = S.pick[1], am = amounts();
    if (!a || !b) { say('Choose both assets.', 'bad'); return; }
    if (same(a, b)) { say('Pick two different assets.', 'bad'); return; }
    if (!(am[0] > 0) || !(am[1] > 0)) { say('Enter an amount for both assets.', 'bad'); return; }

    var go = primary();
    var label = 'Create pool';
    S.busy = true;
    function stop(text, tone) { S.busy = false; if (go) setLabel(go, label); if (text != null) say(text, tone); }
    if (go) setLabel(go, 'Checking…');
    say('');

    load(true).then(function () {
      var inc = S.reserve.inc;
      var xrp = (S.hold || []).filter(function (h) { return h.currency === 'XRP'; })[0];
      if (!xrp) return stop('This account is not active on the XRP Ledger yet.', 'bad');
      function held(p) { return (S.hold || []).filter(function (h) { return same(h, p); })[0]; }
      var ha = held(a), hb = held(b);
      if (!ha || !hb) return stop('One of those assets is no longer in this wallet.', 'bad');
      if (a.currency !== 'XRP' && am[0] > ha.spendable + 1e-12) return stop('You only hold ' + fmt(ha.spendable, 6) + ' ' + a.code + '.', 'bad');
      if (b.currency !== 'XRP' && am[1] > hb.spendable + 1e-12) return stop('You only hold ' + fmt(hb.spendable, 6) + ' ' + b.code + '.', 'bad');

      var A = amountObj(a, am[0]), B = amountObj(b, am[1]);
      if (!A || !B || A === '0' || B === '0') return stop('One of those amounts is too small for the ledger.', 'bad');

      // THE PAIR ALREADY HAS A POOL (RAZA 2026-09-15: "Even if the pool exists, it should just deposit it in
      // that pool instead"). The ledger allows one AMM per pair, so the same two amounts go into that one as a
      // two-asset AMMDeposit. tfTwoAsset takes up to both amounts at the pool's current ratio and leaves any
      // excess in the wallet, so nothing beyond what was typed can be spent.
      function deposit(pool) {
        var tx = {
          TransactionType: 'AMMDeposit', Account: who,
          Asset: specOf(a), Asset2: specOf(b),
          Amount: A, Amount2: B,
          Flags: 0x00100000,                                   // tfTwoAsset
          Memos: [lxMemo('LumosCore: add liquidity to the ' + (a.code || '?') + '/' + (b.code || '?') + ' pool')]
        };
        say('This pair already has a pool, so your liquidity goes into it.');
        if (go) setLabel(go, 'Confirm in wallet…');
        return window.lxc.submit(tx).then(function (hash) {
          if (go) setLabel(go, 'Confirming…');
          return waitValidated(hash);
        }).then(function (res) {
          if (!res.ok) {
            return stop(res.code === 'timeout'
              ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
              : (CODES[res.code] || ('The ledger did not accept the deposit (' + res.code + ').')), 'bad');
          }
          stop('Liquidity added ✓ Opening the pool…', 'good');
          setTimeout(function () { window.location.href = '/pools/xrpl/id/' + encodeURIComponent(pool.account); }, 1200);
        });
      }

      var checks = [rpc('amm_info', { asset: specOf(a), asset2: specOf(b), ledger_index: 'validated' })];
      [a, b].forEach(function (p) {
        if (p.currency !== 'XRP') checks.push(rpc('account_info', { account: p.issuer, ledger_index: 'validated' }));
      });
      return Promise.all(checks).then(function (r) {
        var pool = r[0] && r[0].amm;
        // A new pool costs two increments (one destroyed, one for the LP token line it hands back); adding to
        // an existing pool costs at most the LP token line.
        var xrpIn = (a.currency === 'XRP' ? am[0] : 0) + (b.currency === 'XRP' ? am[1] : 0);
        var xrpNeeded = (pool ? inc : 2 * inc) + 0.00002 + xrpIn;
        if (xrpNeeded > xrp.spendable + 1e-9) {
          return stop(pool
            ? ('Not enough XRP: this deposit needs about ' + fmt(xrpNeeded, 6) + ' XRP including the reserve for the LP token, and '
              + fmt(xrp.spendable, 6) + ' is available.')
            : ('Not enough XRP: creating a pool needs about ' + fmt(xrpNeeded, 6) + ' XRP including the '
              + fmt(2 * inc, 2) + ' XRP it reserves and destroys, and ' + fmt(xrp.spendable, 6) + ' is available.'), 'bad');
        }
        if (pool) return deposit(pool);
        var issuers = r.slice(1), toks = [a, b].filter(function (p) { return p.currency !== 'XRP'; });
        for (var i = 0; i < issuers.length; i++) {
          var d = issuers[i] && issuers[i].account_data;
          if (d && !(d.Flags & LSF_DEFAULT_RIPPLE)) {
            return stop(toks[i].code + '’s issuer has not enabled rippling, so the XRP Ledger will not let it into a pool.', 'bad');
          }
        }

        var tx = {
          TransactionType: 'AMMCreate', Account: who,
          Amount: A, Amount2: B,
          TradingFee: TRADING_FEE,
          // The special cost, set rather than left to autofill: under-paying it is a rejection.
          Fee: lxx().toDrops(inc),
          Memos: [lxMemo('LumosCore: create the ' + (a.code || '?') + '/' + (b.code || '?') + ' pool')]
        };
        if (go) setLabel(go, 'Confirm in wallet…');
        return window.lxc.submit(tx).then(function (hash) {
          if (go) setLabel(go, 'Confirming…');
          return waitValidated(hash);
        }).then(function (res) {
          if (!res.ok) {
            return stop(res.code === 'timeout'
              ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
              : (CODES[res.code] || ('The ledger did not create the pool (' + res.code + ').')), 'bad');
          }
          stop('Pool created ✓ Opening it…', 'good');
          // AND THE TOAST (RAZA 2026-10-02: "It didn't show pool creation message at the bottom-center
          // like it does on Stellar"). The button label alone is easy to miss — it is the thing the
          // reader has just stopped looking at, and a second later the page navigates to the new pool.
          // Stellar ends this the same way, with the same words.
          poolToast('Pool created & liquidity added');
          return rpc('amm_info', { asset: specOf(a), asset2: specOf(b), ledger_index: 'validated' }).then(function (r2) {
            var acct = r2 && r2.amm && r2.amm.account;
            setTimeout(function () { window.location.href = acct ? ('/pools/xrpl/id/' + acct) : '/pools/xrpl'; }, 1200);
          });
        });
      });
    }).catch(function (e) {
      stop((e && e.message) || 'The pool could not be created.', 'bad');
    });
  }

  // ---- wiring --------------------------------------------------------------------------------------
  function fieldIndex(node) {
    var f = node.closest && node.closest('.asset-field');
    return f ? fields().indexOf(f) : -1;
  }

  function closeModal() {
    var m = modal();
    if (!m) return;
    m.classList.remove('open');
    if (m.style.display === 'flex') m.style.display = '';
    try { document.body.style.overflow = ''; } catch (e) {}
    closeLists();
  }

  function wire() {
    if (window.__lxxCpWired) return;
    window.__lxxCpWired = 1;

    // WINDOW CAPTURE: the design routes clicks inside dialogs and rows through handlers of its own, and
    // one of them reads mock data-asset-bal attributes off .ad-item. Stopped here, before any of them.
    window.addEventListener('click', function (e) {
      var m = modal();
      var t = e.target;
      if (!m || !t || !t.closest || !m.contains(t)) {
        // A click anywhere else closes an open list.
        if (m && m.classList.contains('open')) closeLists();
        return;
      }
      var item = t.closest('.lx-cpitem');
      if (item && item.__lxxAsset) {
        e.preventDefault(); e.stopImmediatePropagation();
        var i = fieldIndex(item);
        if (i < 0) return;
        S.pick[i] = item.__lxxAsset;
        // A new asset makes the old amount meaningless (RAZA 2026-09-16: "It just stucks even if im changing the assets"): this side
        // is cleared and filled again from the other side at the new pair's rate.
        var ampI = $('.asset-amt', fields()[i]);
        if (ampI) ampI.value = '';
        if (S.pick[1 - i] && same(S.pick[1 - i], S.pick[i])) S.pick[1 - i] = null;
        closeLists();
        paintField(0); paintField(1); recalc(); say('');
        // A pair just became complete: fill whichever side is empty from the side that has an amount.
        var am0 = amounts();
        if (am0[i] > 0) autofill(i); else if (am0[1 - i] > 0) autofill(1 - i);
        return;
      }
      if (t.closest('.lx-cpitem') || t.closest('.ad-search')) { e.stopImmediatePropagation(); return; }
      var pk = t.closest('.asset-picker');
      if (pk) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!addr()) { if (window.lxc && window.lxc.open) window.lxc.open(); return; }
        openList(fieldIndex(pk));
        return;
      }
      var mx = t.closest('.max-btn');
      if (mx) {
        e.preventDefault(); e.stopImmediatePropagation();
        var j = fieldIndex(mx), a = S.pick[j];
        if (!a) { say('Choose an asset first.', 'bad'); return; }
        var inc = S.reserve ? S.reserve.inc : 0.2;
        // XRP leaves room for what creating the pool itself costs: one increment destroyed, one reserved.
        var roomOf = function (x) { return x.currency === 'XRP' ? Math.max(0, x.spendable - 2 * inc - 0.00002) : x.spendable; };
        var room = roomOf(a), ob = S.pick[1 - j];
        var inp = $('.asset-amt', fields()[j]);
        // MAX IS WHAT THE OTHER SIDE CAN MATCH (RAZA 2026-09-16: "I only got 1 XRP worth of … ATOM, while 5 XRP worth of RIPPLEDICK. So when
        // i select MAX for asset 1, i should only have been able to select 1 XRP worth"): capped at the other asset's balance, at the rate.
        Promise.all([priceXrp(a), priceXrp(ob)]).then(function (px) {
          if (ob && px[0] > 0 && px[1] > 0) room = Math.min(room, roomOf(ob) * px[1] / px[0]);
          if (inp) inp.value = plainNum(floorTo(room, 6));
          recalc();
          autofill(j);
        });
        return;
      }
      if (t.closest('.modal-foot .btn-primary')) {
        e.preventDefault(); e.stopImmediatePropagation();
        create();
        return;
      }
      if (t === m || t.closest('[data-close]')) { closeModal(); return; }
      if (!t.closest('.asset-dropdown')) closeLists();
    }, true);

    window.addEventListener('input', function (e) {
      var m = modal(), t = e.target;
      if (!m || !t || !m.contains(t)) return;
      if (t.classList && t.classList.contains('asset-amt')) {
        var clean = String(t.value).replace(/[^0-9.]/g, '');
        var dot = clean.indexOf('.');
        if (dot >= 0) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
        if (clean !== t.value) t.value = clean;
        recalc();
        say('');
        autofill(fieldIndex(t));
      } else if (t.classList && t.classList.contains('ad-search-input')) {
        // RAZA 2026-09-16: "When im trying to search for the asset that im holding, its not working" — the design's own filter ran
        // after this and hid every row it did not recognise. This one owns the box.
        e.stopImmediatePropagation();
        var fi = fieldIndex(t);
        renderList(fi >= 0 ? fi : S.openIdx, t.closest && t.closest('.asset-dropdown'));
      }
    }, true);

    document.addEventListener('keydown', function (e) {
      var m = modal();
      if (e.key === 'Escape' && m && m.classList.contains('open')) closeModal();
    });

    // The dialog opens from the Pools page's own button, the dashboard card, or the design's script —
    // so its OPENING is what is watched, not any one opener.
    var m = modal();
    if (m && window.MutationObserver) {
      new MutationObserver(function () {
        if (m.classList.contains('open') || m.style.display === 'flex') {
          bulk();                                            // prices warm before the first amount is typed
          // NO TRUST-LINE BANNER (RAZA 2026-09-17, the $LUMOS page's dialog): depositing into a pool creates the line the
          // deposit needs, so a button demanding it first is a step that does not belong to this dialog.
          [].forEach.call(m.querySelectorAll('.trustline-gate, [data-trustline-gate]'), function (g) { g.style.display = 'none'; });
          recalc();
          load().then(function () {
            // A wallet switch empties choices that belonged to the previous account.
            S.pick = S.pick.map(function (p) {
              return p && (S.hold || []).filter(function (h) { return same(h, p); })[0] || null;
            });
            // ON THE $LUMOS PAGE, ASSET 1 IS LUMOS (RAZA 2026-09-17: "make sure in this popup, LUMOS token is selected as
            // Asset 1 by default"). Opening a pool dialog from a page about LUMOS with nothing chosen made the reader pick
            // the token the page is already about.
            if (!S.pick[0] && (document.querySelector('.lumos-hero-row') || /\/lumos(\/|$)/.test(window.location.pathname))) {
              S.pick[0] = (S.hold || []).filter(function (h) {
                return h.issuer === LUMOS_ISS && h.code === 'LUMOS';
              })[0] || { code: 'LUMOS', currency: LUMOS_CUR, issuer: LUMOS_ISS, balance: 0, spendable: 0 };
            }
            paintField(0); paintField(1); recalc();
          });
        }
      }).observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { S.who = ''; S.hold = null; });
  }

  function boot() {
    var m = modal();
    if (!m || !window.lxx) return;
    paintField(0); paintField(1);
    recalc();
    wire();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
