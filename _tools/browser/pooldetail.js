// Pool detail: one XRP Ledger AMM, read from the ledger.
//
// This page shipped MOCK DATA and, once lx-ammdata was stripped, nothing overwrote it any more. For
// the real LUMOS/XRP pool it claimed 3,420,180 XRP and 4,797,447 LUMOS against an actual 412.5 XRP
// and 17,075,469 LUMOS -- liquidity overstated by roughly 8,000x -- under a fabricated 64-hex
// "Pool ID" that is not even the right SHAPE for this ledger, where a pool is addressed by its AMM
// ACCOUNT. It is also reachable from every row of the Pools table, which this project wired.
//
// Everything here comes from amm_info. No third party: an AMM's reserves are ledger state, and a
// page about how deep a pool is should read the pool.
(function () {
  if (window.__lxxPoolDetail) return;
  window.__lxxPoolDetail = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 2 : dp });
    return v.toPrecision(4);
  }

  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'no pool');
      return res;
    });
  }

  // /xrpl/pools/id/<ammAccount>  — the route the Pools table links to.
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = decodeURIComponent(parts[i] || '');
      try { if (window.lxx.isAddress(p)) return p; } catch (e) {}
    }
    return null;
  }

  // A side is either a drops string (XRP) or { currency, issuer, value }.
  function side(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6, issuer: null };
    var name = a.currency;
    try { name = window.lxx.decodeCurrency(a.currency).display; } catch (e) {}
    return { name: name, amount: Number(a.value), issuer: a.issuer };
  }

  function setStat(match, value, sub) {
    var cells = $$('.ph-stat');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (!l || l.textContent.trim().toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.v');
      if (v) v.textContent = value;
      var s = cells[i].querySelector('.s');
      if (s) s.textContent = sub == null ? '' : sub;
      return true;
    }
    return false;
  }

  function paint(acct, amm) {
    var a = side(amm.amount), b = side(amm.amount2);
    if (!a || !b) return;

    // Quote the token against XRP where there is an XRP side, which is how the rest of the site
    // denominates a pair.
    var xrpSide = a.name === 'XRP' ? a : (b.name === 'XRP' ? b : null);
    var tok = a.name === 'XRP' ? b : a;

    var name = $('.ph-name');
    if (name) name.textContent = a.name + ' / ' + b.name;

    // The mock carried a 64-hex "Pool ID". On this ledger a pool IS an account, so show the account
    // and let the copy button carry the full one.
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'AMM account: ' + short(acct);
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', acct);
      copyBtn.setAttribute('data-copy-label', 'AMM account');
    }

    var price = xrpSide && tok && tok.amount ? (xrpSide.amount / tok.amount) : null;
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = price != null ? (num(price, 6) + ' XRP') : '—';
    var feePct = amm.trading_fee != null ? (amm.trading_fee / 1000) : null;
    var ps = $('.ph-price .s');
    // The trading fee is a RATE, so it rides with the price rather than in a cell labelled
    // 'Fees Collected (24h)' -- which is an amount. Putting 0.625% there read as 0.625 XRP earned.
    if (ps) ps.textContent = (price != null ? ('per ' + tok.name) : '')
      + (feePct != null ? ((price != null ? '  ·  ' : '') + feePct + '% trading fee') : '');

    // Liquidity is stated as BOTH reserves. A single number here would be a choice of denominator,
    // and the mock's "~$1.43M" was exactly that kind of invented total.
    setStat('liquidity', num(a.amount, 2) + ' ' + a.name,
      '+ ' + num(b.amount, 2) + ' ' + b.name);

    var lp = amm.lp_token ? Number(amm.lp_token.value) : null;
    // Both of these are 24h AMOUNTS the ledger does not keep. Saying so beats filling them with a
    // rate or a supply figure that happens to be nearby.
    setStat('volume', '—', 'not kept by the ledger');
    setStat('fees collected', '—', 'not kept by the ledger');
    setStat('participant', '—', lp != null ? (num(lp, 2) + ' LP tokens outstanding') : '');

    // The RAW ledger amounts ride along beside the display ones. side() turns them into names and
    // numbers for painting, which throws away the currency/issuer pair — and that pair is exactly
    // what an AMMDeposit needs to identify the pool. Keeping both means the form can never be built
    // from a formatted string.
    window.__lxxPool = {
      account: acct, a: a, b: b, fee: feePct, lpSupply: lp,
      rawA: amm.amount, rawB: amm.amount2, lpToken: amm.lp_token || null
    };
    paintDwStatic();
    liftPage();
    loadPosition();
  }

  // THE WHOLE PAGE WAS INVISIBLE, and every DOM check said it was fine.
  //
  // The inherited lx-amm stylesheet gates the page on a class its own layer used to set:
  //     html:not(.lx-ammready) .pool-header, html:not(.lx-ammready) .pool-layout { visibility: hidden }
  // so the header, the stats, the chart, the deposit card — 948px of correct, real, freshly painted
  // content — sat at visibility:hidden. Reading .ph-name returned "XRP / RLUSD", every stat read
  // correctly, and the page was blank. I had already called this page "working" on the strength of
  // exactly those reads; only a screenshot showed the truth.
  //
  // Called from paint(), NOT from loadPosition(): the position load returns early when no wallet is
  // connected, so lifting there left the page permanently blank for anyone signed out — which is
  // most visitors, and the one case least likely to be noticed while testing signed in.
  function liftPage() {
    try {
      document.documentElement.classList.add('lx-ammready');   // header + layout
      document.documentElement.classList.add('lx-detpr');      // names, stats, price, my-position
    } catch (e) {}
  }

  // ---- Deposit and withdraw ------------------------------------------------------------------------
  // AMMDeposit and AMMWithdraw are the ledger's own operations; the amounts are ratio-locked to the
  // pool's current reserves, which is why typing one side fills the other rather than leaving someone
  // to guess a pair the ledger will silently rebalance.
  //
  // Flags are the whole API surface here. tfTwoAsset (0x00100000) deposits both sides at the amounts
  // given; tfLPToken (0x00010000) withdraws by burning a number of LP tokens and returns both sides.
  // The alternatives — single-asset deposits and withdrawals — move the price and charge for it, so
  // they are deliberately not offered from a form with one number in it.
  var TF_TWO_ASSET = 0x00100000;
  var TF_LP_TOKEN = 0x00010000;

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  // Both delegate to xrpl-core, which the node tests cover. These were a third local copy of the
  // amount arithmetic — write.js had the other two — and the drops conversion here used a bare 1e6
  // with Math.round written out again. One implementation, one set of tests.
  function assetDef(raw) { return window.lxx.assetOf(raw); }

  function amtOf(raw, value) { return window.lxx.amountFor(window.lxx.assetOf(raw), value); }

  function dwSay(text, tone) {
    var card = $('.dw-card');
    if (!card) return;
    var box = $('.lxx-dwsay', card);
    if (!box) {
      box = el('div', 'lxx-dwsay');
      box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
      card.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  // Everything on this card that the design baked with Aptos values and does not depend on a balance.
  function paintDwStatic() {
    var p = window.__lxxPool;
    if (!p) return;

    var fields = $$('#dwDeposit .dw-field');
    [p.a, p.b].forEach(function (s, i) {
      var f = fields[i];
      if (!f) return;
      var asset = f.querySelector('.asset');
      if (asset) {
        var ico = asset.querySelector('.ico');
        // The logo layer eats any element holding 1-5 characters; data-logoed is its skip marker.
        if (ico) {
          try { ico.setAttribute('data-logoed', '1'); ico.removeAttribute('data-logo'); ico.style.background = ''; } catch (e) {}
          ico.textContent = s.name.charAt(0).toUpperCase();
        }
        [].forEach.call(asset.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + s.name + ' ';
        });
      }
    });

    var wf = $('#dwWithdraw .dw-field .asset');
    if (wf) {
      var wico = wf.querySelector('.ico');
      if (wico) { try { wico.setAttribute('data-logoed', '1'); } catch (e) {} wico.textContent = 'LP'; }
      [].forEach.call(wf.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = p.a.name + ' / ' + p.b.name;
      });
    }
    // The two "You receive" rows on the withdraw side name the pool's assets.
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      [p.a, p.b].forEach(function (s, i) {
        if (!rows[i]) return;
        var as = rows[i].querySelector('.asset');
        if (!as) return;
        var ic = as.querySelector('.ico');
        if (ic) { try { ic.setAttribute('data-logoed', '1'); } catch (e) {} ic.textContent = s.name.charAt(0).toUpperCase(); }
        [].forEach.call(as.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = s.name;
        });
      });
    }

    setSummary('trading fee', (p.fee != null ? p.fee + '%' : '—'));
    setSummary('network fee', '~0.000012 XRP');
  }

  function setSummary(match, value) {
    $$('.dw-summary .r').forEach(function (r) {
      var k = r.querySelector('span');
      if (!k || (k.textContent || '').toLowerCase().indexOf(match) < 0) return;
      var v = r.querySelector('strong');
      if (v) v.textContent = value;
    });
  }

  // The connected account's balances of both pool assets and of the LP token itself. Without these
  // the MAX buttons and the position panel are guesses, and the design's baked "Balance: 25,420.18"
  // sits above a MAX button that would offer it.
  function loadPosition() {
    var me = addr(), p = window.__lxxPool;
    if (!me || !p) return;
    Promise.all([
      rpc('account_info', { account: me, ledger_index: 'validated' }).catch(function () { return null; }),
      rpc('account_lines', { account: me, ledger_index: 'validated', limit: 400 }).catch(function () { return null; }),
      rpc('server_info', {}).catch(function () { return null; })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var lines = (r[1] && r[1].lines) || [];
      var si = r[2] && r[2].info && r[2].info.validated_ledger;
      var base = si ? +si.reserve_base_xrp : 1, inc = si ? +si.reserve_inc_xrp : 0.2;

      function balOf(raw) {
        if (typeof raw === 'string') {
          if (!info) return 0;
          var xrp = Number(info.Balance) / 1e6;
          var locked = base + inc * (Number(info.OwnerCount) || 0);
          return Math.max(0, xrp - locked);            // spendable, never the raw balance
        }
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].currency === raw.currency && lines[i].account === raw.issuer) return Number(lines[i].balance);
        }
        return 0;
      }

      var myLp = 0;
      if (p.lpToken) {
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].currency === p.lpToken.currency && lines[i].account === p.lpToken.issuer) {
            myLp = Number(lines[i].balance); break;
          }
        }
      }

      p.balA = balOf(p.rawA);
      p.balB = balOf(p.rawB);
      p.myLp = myLp;

      var fields = $$('#dwDeposit .dw-field');
      [[p.balA, p.a], [p.balB, p.b]].forEach(function (pair, i) {
        var f = fields[i];
        if (!f) return;
        var bal = f.querySelector('.balance');
        if (bal) bal.textContent = 'Balance: ' + num(pair[0], 6) + ' ' + pair[1].name;
      });
      var wbal = $('#dwWithdraw .balance');
      if (wbal) wbal.textContent = 'Your LP: ' + num(myLp, 6);

      paintMyPosition();
      liftDw();
    });
  }

  // The design gates the balance line until a data layer vouches for it:
  //     html:not(.lx-dwready) #dwDeposit .dw-field .balance, ... { visibility: hidden }
  // which is the same family of inherited gate found all over this fork. Lifted only once the real
  // balances are written, never before.
  function liftDw() {
    // Only the balance line, and only once real balances are written. The page-level gates are
    // lifted in liftPage() the moment the pool itself is painted, because those must not wait on a
    // wallet connection.
    try { document.documentElement.classList.add('lx-dwready'); } catch (e) {}
  }

  // "My position" — the share of the pool this account actually owns, derived from its LP balance
  // against total supply. The design baked 623.40 APT, +$8.92 earned fees and 23,415.82 LP tokens.
  //
  // EARNED FEES IS LEFT AS A DASH ON PURPOSE. Working it out needs the position's cost basis, which
  // means every deposit and withdrawal this account ever made into this pool; a public node will not
  // give that, and the number is the one people would act on. A dash is the honest answer.
  function paintMyPosition() {
    var p = window.__lxxPool;
    if (!p) return;
    var share = (p.lpSupply > 0 && p.myLp > 0) ? (p.myLp / p.lpSupply) : 0;

    var amts = $$('.my-position .mp-asset-amt');
    [[p.a, p.balAmt = p.a.amount * share], [p.b, p.b.amount * share]].forEach(function (x, i) {
      if (amts[i]) amts[i].textContent = num(x[1], 6);
    });
    $$('.my-position .mp-asset-name').forEach(function (n, i) {
      n.textContent = i === 0 ? p.a.name : p.b.name;
    });
    var fees = $$('.my-position .mp-fee-val');
    if (fees[0]) fees[0].textContent = '—';
    if (fees[1]) fees[1].textContent = num(p.myLp, 6);
    var pill = $('.position-share-pill');
    if (pill) pill.textContent = share > 0 ? ((share * 100).toFixed(4) + '%') : '0%';
    var amt = $('.my-position .mp-amount');
    if (amt) amt.textContent = share > 0 ? (num(p.myLp, 4) + ' LP') : 'No position';
  }

  function dwInputs() {
    return {
      a: $('#dwDeposit .dw-field:nth-of-type(1) input') || $$('#dwDeposit input')[0],
      b: $$('#dwDeposit input')[1],
      lp: $('#dwWithdraw input')
    };
  }

  // Typing one side fills the other at the pool's CURRENT ratio. A two-asset deposit off-ratio is
  // not rejected — the ledger takes what it can and returns the rest, which looks like the form
  // quietly changing your numbers. Better to show the pair that will actually be used.
  function syncRatio(from) {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.a || !i.b || !(p.a.amount > 0) || !(p.b.amount > 0)) return;
    var ratio = p.b.amount / p.a.amount;
    if (from === 'a') {
      var va = parseFloat(String(i.a.value).replace(/,/g, ''));
      i.b.value = va > 0 ? String(+(va * ratio).toFixed(6)) : '';
    } else {
      var vb = parseFloat(String(i.b.value).replace(/,/g, ''));
      i.a.value = vb > 0 ? String(+(vb / ratio).toFixed(6)) : '';
    }
    previewDeposit();
  }

  function previewDeposit() {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.a) return;
    var va = parseFloat(String(i.a.value).replace(/,/g, ''));
    if (!(va > 0) || !(p.a.amount > 0) || !(p.lpSupply > 0)) { setSummary('pool share', '—'); return; }
    // New LP tokens are minted in proportion to what the deposit adds to the reserves.
    var minted = p.lpSupply * (va / p.a.amount);
    var after = (p.myLp + minted) / (p.lpSupply + minted);
    setSummary('pool share', (after * 100).toFixed(4) + '%');
  }

  function previewWithdraw() {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.lp) return;
    var v = parseFloat(String(i.lp.value).replace(/,/g, ''));
    var share = (p.lpSupply > 0 && v > 0) ? (v / p.lpSupply) : 0;
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      [p.a.amount * share, p.b.amount * share].forEach(function (x, k) {
        if (!rows[k]) return;
        var out = rows[k].querySelector('span[style]') || rows[k].lastElementChild;
        if (out) out.textContent = num(x, 6);
      });
    }
    var after = (p.lpSupply > 0) ? Math.max(0, (p.myLp - v)) / Math.max(1e-9, (p.lpSupply - v)) : 0;
    setSummary('pool share', (after * 100).toFixed(4) + '%');
  }

  function mode() {
    var t = $('.dw-tabs button.active');
    return (t && t.getAttribute('data-dw')) || 'deposit';
  }

  function submitDw() {
    var p = window.__lxxPool, i = dwInputs(), me = addr();
    if (!p || !me) { dwSay('Connect a wallet first.', 'bad'); return; }
    var cta = $('.dw-cta');
    var asset = assetDef(p.rawA), asset2 = assetDef(p.rawB);

    if (mode() === 'deposit') {
      var va = parseFloat(String(i.a.value).replace(/,/g, ''));
      var vb = parseFloat(String(i.b.value).replace(/,/g, ''));
      if (!(va > 0) || !(vb > 0)) { dwSay('Enter an amount to deposit.', 'bad'); return; }
      if (va > p.balA) { dwSay('You only have ' + num(p.balA, 6) + ' ' + p.a.name + ' available.', 'bad'); return; }
      if (vb > p.balB) { dwSay('You only have ' + num(p.balB, 6) + ' ' + p.b.name + ' available.', 'bad'); return; }
      dwSay('Approve the deposit in your wallet…');
      if (cta) cta.disabled = true;
      window.lxc.submit({
        TransactionType: 'AMMDeposit', Account: me,
        Asset: asset, Asset2: asset2,
        Amount: amtOf(p.rawA, va), Amount2: amtOf(p.rawB, vb),
        Flags: TF_TWO_ASSET
      }).then(function () {
        dwSay('Liquidity added.', 'good');
        i.a.value = ''; i.b.value = '';
        setTimeout(function () { if (window.__lxxPoolDetailReload) window.__lxxPoolDetailReload(); }, 3000);
      }).catch(function (e) {
        dwSay((e && e.message) || 'The deposit could not be made.', 'bad');
      }).then(function () { if (cta) cta.disabled = false; });
      return;
    }

    var v = parseFloat(String(i.lp.value).replace(/,/g, ''));
    if (!(v > 0)) { dwSay('Enter how many LP tokens to withdraw.', 'bad'); return; }
    if (v > p.myLp) { dwSay('You hold ' + num(p.myLp, 6) + ' LP tokens.', 'bad'); return; }
    if (!p.lpToken) { dwSay('This pool has no LP token to withdraw.', 'bad'); return; }
    dwSay('Approve the withdrawal in your wallet…');
    if (cta) cta.disabled = true;
    window.lxc.submit({
      TransactionType: 'AMMWithdraw', Account: me,
      Asset: asset, Asset2: asset2,
      LPTokenIn: { currency: p.lpToken.currency, issuer: p.lpToken.issuer, value: String(v) },
      Flags: TF_LP_TOKEN
    }).then(function () {
      dwSay('Liquidity withdrawn.', 'good');
      i.lp.value = '';
      setTimeout(function () { if (window.__lxxPoolDetailReload) window.__lxxPoolDetailReload(); }, 3000);
    }).catch(function (e) {
      dwSay((e && e.message) || 'The withdrawal could not be made.', 'bad');
    }).then(function () { if (cta) cta.disabled = false; });
  }

  function wireDw() {
    if (window.__lxxDwWired) return;
    var card = $('.dw-card');
    if (!card) return;
    window.__lxxDwWired = 1;

    $$('.dw-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.dw-tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
        var w = b.getAttribute('data-dw') === 'withdraw';
        var d = $('#dwDeposit'), wd = $('#dwWithdraw');
        if (d) d.style.display = w ? 'none' : '';
        if (wd) wd.style.display = w ? '' : 'none';
        var cta = $('.dw-cta');
        if (cta) {
          // The button label is the design's; only the word changes with the tab.
          [].forEach.call(cta.childNodes, function (nd) {
            if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = w ? ' Remove Liquidity ' : ' Add Liquidity ';
          });
        }
        dwSay('');
      });
    });

    var i = dwInputs();
    if (i.a) i.a.addEventListener('input', function () { syncRatio('a'); });
    if (i.b) i.b.addEventListener('input', function () { syncRatio('b'); });
    if (i.lp) i.lp.addEventListener('input', previewWithdraw);

    $$('#dwDeposit .max-btn').forEach(function (btn, k) {
      btn.addEventListener('click', function () {
        var p = window.__lxxPool;
        if (!p) return;
        var ii = dwInputs();
        var bal = k === 0 ? p.balA : p.balB;
        var side2 = k === 0 ? p.a : p.b;
        // XRP keeps a little back for the transaction cost; the balance shown is already
        // reserve-adjusted, so this is only the fee.
        var v = side2.name === 'XRP' ? Math.max(0, bal - 0.0002) : bal;
        (k === 0 ? ii.a : ii.b).value = String(+v.toFixed(6));
        syncRatio(k === 0 ? 'a' : 'b');
      });
    });

    $$('#dwWithdraw .dw-pct-b').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = window.__lxxPool, ii = dwInputs();
        if (!p || !ii.lp) return;
        var t = (btn.textContent || '').trim().toLowerCase();
        var f = t === 'max' ? 1 : (parseFloat(t) / 100);
        if (!(f > 0)) f = 1;
        ii.lp.value = String(+(p.myLp * f).toFixed(6));
        previewWithdraw();
      });
    });

    var cta = $('.dw-cta');
    if (cta) cta.addEventListener('click', function (e) { e.preventDefault(); submitDw(); });
  }

  // The participant list was 25 invented rows. Who holds an LP token is not something a public node
  // will enumerate, so the honest answer is the count and a note -- not 25 plausible addresses.
  function participants(text) {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      host.innerHTML = '';
      var d = el('div', 'acc-empty', text);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      host.appendChild(d);
    });
  }

  function fail(msg) {
    var name = $('.ph-name');
    if (name) name.textContent = 'Pool not found';
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = msg;
    setStat('liquidity', '—', '');
    setStat('volume', '—', '');
    setStat('fees collected', '—', '');
    setStat('participant', '—', '');
    participants(msg);
  }

  function load() {
    if (!$('.pool-header')) return;                      // not this page

    var acct = fromUrl();
    if (!acct) { fail('No pool in this address.'); return; }

    var name = $('.ph-name');
    if (name) name.textContent = 'Reading the XRP Ledger…';
    wireDw();

    rpc('amm_info', { amm_account: acct }).then(function (r) {
      if (!r || !r.amm) { fail('That account is not an AMM.'); return; }
      paint(acct, r.amm);
      var holders = r.amm.lp_token ? '' : '';
      participants('LP holders are not enumerable from a public node. '
        + 'The pool holds ' + (r.amm.lp_token ? num(Number(r.amm.lp_token.value), 2) : '—')
        + ' LP tokens in total.');
    }).catch(function (e) {
      fail((e && e.message) === 'no pool' ? 'That account is not an AMM.' : 'Could not read the pool.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolDetailReload = load;
})();
