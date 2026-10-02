// Trade-Asset → Swap: the panel, wired to the XRP Ledger.
//
// RAZA 2026-09-15: "on Swap box, its not showing the details as it is showing on Stellar. Also the you pay
// and you receive asset logos are missing." The panel had been deliberately disabled ("Trading from this
// page is not enabled yet") while nothing on this build could sign. Every other trade path signs through
// window.lxc now, so this one does too.
//
// THE SAME SWAP AS THE WALLET AND THE DASHBOARD. A swap on this ledger is a cross-currency Payment to
// yourself, quoted by ripple_path_find, delivering at least the quote minus 0.5% or failing outright (no
// tfPartialPayment). The 0.2% / 0.1% platform fee is a second XRP payment after the swap lands, never
// before it. See browser/write.js for the reasoning; this is that logic on the design's Trade-Asset panel.
//
// THE REVIEW STEP IS STELLAR'S OWN. lx-feemodal (inherited) catches the first click on this button and
// shows "Review order" built from the summary rows below; its Confirm re-clicks the button
// programmatically. So a TRUSTED click is only validated here and allowed through to the review, and the
// UNTRUSTED click that comes back from Confirm is the one that submits. If the review layer is ever
// absent, a trusted click submits directly.
//
// Everything written into the panel carries `.lxp`, because the design hides `.dxa-trade-frow .mono` and
// `.dxa-tsum-row .mono` until a data layer claims them — which is why "Rate", "Min received" and the rest
// read as empty labels.
(function () {
  if (window.__lxxDxaSwap) return;
  window.__lxxDxaSwap = 1;

  var RPC = 'https://xrplcluster.com/';
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';
  var SLIP = 0.005;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function lxx() { return window.lxx; }
  function asset() { return window.__lxxAssetRef || null; }
  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }
  // NOTHING WAITS FOREVER (RAZA 2026-09-17: RLUSD → XRP "it just stucks there" — the button sat on "Finding the best route…"
  // with a complete quote beside it). A public node can accept a request and never answer, and `fetch` has no timeout of its
  // own, so one unanswered call froze the swap with no error and no way back. Every read now has a deadline; `ripple_path_find`
  // is the slow one and gets a longer one.
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
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw new Error((e && e.name === 'AbortError') ? (method + ' timed out') : ((e && e.message) || 'ledger unavailable'));
    });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/,/g, '').trim();
    var m = /^\d*\.?\d*/.exec(s);
    var t = m ? m[0] : '';
    return (t === '' || t === '.') ? NaN : Number(t);
  }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 6 : d });
  }
  function floorTo(n, dp) { var k = Math.pow(10, dp); return Math.floor(n * k) / k; }
  function plainNum(n) { return n > 0 ? (lxx().iouValue(Number(Number(n).toPrecision(12))) || '') : ''; }
  function currencyOf(code) { try { return lxx().encodeCurrency(code); } catch (e) { return code; } }
  function feeRate() { return typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002; }
  // XRP/USD from the price service as well, for a token xrpl.to does not list (XYIELD): its page has no asset data, and the
  // "≈ $ USD" lines stayed at $0.00 (RAZA 2026-09-16).
  var XU = 0;
  fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.usd > 0) XU = j.usd; }, function () {});
  function usdPerXrp() {
    var d = window.__lxxAssetData;
    return (d && d.price && d.usd) ? d.usd / d.price : XU;
  }

  function pane() { return $('.dxa-pane-swap') || $('.mdxa-pane-swap'); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  function side(p) { return $('[class*="dxa-side-btn"].sell.active', p) ? 'sell' : 'buy'; }

  function mark(node, text) {
    if (!node) return;
    try { node.removeAttribute('data-logo'); node.setAttribute('data-logoed', '1'); } catch (e) {}
    if (node.textContent !== text) node.textContent = text;
    node.classList.add('lxp');
  }
  // NOT the "≈ $X USD" span, which is also .mono and sits first in the row: writing the balance into it is how "Balance: —" came
  // back beside a connected wallet (RAZA 2026-09-16: "Why's my XRP balance not showin up in the swap box").
  function frowMono(f) { var row = f && $('[class*="dxa-trade-frow"]', f); return row && $('.mono:not(.lx-payusd)', row); }
  function sumRow(p, label, value) {
    $$('[class*="dxa-tsum-row"]', p).forEach(function (r) {
      if (r.classList.contains('lx-feerow')) return;              // the fee layer owns its row
      var k = r.children;
      if (k.length < 2) return;
      if ((k[0].textContent || '').trim().toLowerCase() !== label) return;
      mark(k[k.length - 1], value);
    });
  }
  function say(p, text, tone) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxx-limit-note', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxx-limit-note';                            // limit.js's status line style
      n.setAttribute('role', 'status');
      b.parentNode.insertBefore(n, b.nextSibling);
    }
    n.textContent = text || '';
    n.setAttribute('data-tone', tone || '');
    n.style.display = text ? '' : 'none';
    // SUCCESS CLEARS ITSELF (RAZA 2026-09-16: "Once the swap is completed, just hide the message 'Swap complete' in 2 seconds.
    // It just stays there"). Only the done-and-good lines go; an error stays until the next action.
    clearTimeout(say.t);
    if (text && /^swap complete/i.test(text)) say.t = setTimeout(function () { say(p, ''); }, 2000);
  }

  // ---- the account ---------------------------------------------------------------------------------
  var acct = { key: null };
  function loadAcct(force) {
    var a = asset(), who = addr();
    if (!a || !who) { acct = { key: null }; return Promise.resolve(acct); }
    var key = who + '|' + a.issuer + '|' + a.code;
    if (!force && acct.key === key && acct.at && Date.now() - acct.at < 20000) return Promise.resolve(acct);
    var cur = currencyOf(a.code);
    return Promise.all([
      // A dropped read is retried (below) rather than shown as a balance; only an unfunded account reads as none.
      rpc('account_info', { account: who, ledger_index: 'validated' }).catch(function (e) {
        if (/actNotFound|not found/i.test(String(e && e.message))) return null;
        throw e;
      }),
      // RAZA 2026-09-16: "Why's my XRP balance not showin up in the swap box" — server_info is only needed for the reserve,
      // and one failed call used to fail the whole read and leave "Balance: —" for good.
      rpc('server_info', {}).catch(function () { return null; }),
      lxx().allLines(rpc, who, { peer: a.issuer }).catch(function () { return { lines: [] }; })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var vl = ((r[1] || {}).info || {}).validated_ledger || {};
      var reserve = { base: Number(vl.reserve_base_xrp) || 1, inc: Number(vl.reserve_inc_xrp) || 0.2 };
      var s = info ? lxx().spendableXrp(info.Balance, info.OwnerCount, reserve) : null;
      var line = ((r[2] && r[2].lines) || []).filter(function (l) { return l.currency === cur && l.account === a.issuer; })[0];
      loadAcct.tries = 0;
      acct = {
        key: key, at: Date.now(), spend: s ? s.spendable : 0,
        line: !!line, bal: line ? Math.max(0, Number(line.balance)) : 0, frozen: !!(line && (line.freeze || line.freeze_peer))
      };
      return acct;
    }).catch(function () {
      acct = { key: key, at: 0 };
      if ((loadAcct.tries = (loadAcct.tries || 0) + 1) <= 5) {
        setTimeout(function () { loadAcct(true).then(function () { var pp = pane(); if (pp) paintStatic(pp); }); }, 2500);
      }
      return acct;
    });
  }

  // ---- quoting -------------------------------------------------------------------------------------
  var quote = null, seq = 0, inflight = 0;

  function sides(p) {
    var a = asset();
    var tok = { code: a.code, currency: currencyOf(a.code), issuer: a.issuer };
    var xrpA = { code: 'XRP', currency: 'XRP', issuer: null };
    return side(p) === 'sell' ? { pay: tok, get: xrpA } : { pay: xrpA, get: tok };
  }
  function amountObj(s, value) {
    if (s.currency === 'XRP') return lxx().toDrops(value);
    var v = lxx().iouValue(value);
    return v ? { currency: s.currency, issuer: s.issuer, value: v } : null;
  }
  function payBalance(p) {
    if (!addr() || acct.key == null) return null;
    return side(p) === 'sell' ? acct.bal : acct.spend;
  }

  // THE TRADING FEE ROW'S FIGURE (RAZA 2026-09-15: "why's the trading fees not showing up"). lx-feemodal writes
  // "0.2%" into a .mono span, and the inherited sheet hides .dxa-tsum-row .mono until a data layer claims it with
  // .lxp — so the label showed and its value never did.
  function claimFeeRow(p) {
    $$('.lx-feerow .mono:not(.lxp), .lx-feerow .lx-feerate:not(.lxp)', p).forEach(function (m) { m.classList.add('lxp'); });
  }

  function paintStatic(p) {
    claimFeeRow(p);
    var f = fields(p);
    var s = sides(p);
    var bal = payBalance(p);
    mark(frowMono(f[0]), addr() ? ('Balance: ' + (bal == null ? '—' : fmt(bal, 4) + ' ' + s.pay.code)) : 'Balance: —');
    sumRow(p, 'slippage tolerance', (SLIP * 100).toFixed(1) + '%');
    sumRow(p, 'network fee', '0.00001 XRP');
    // TYPEABLE, LIKE STELLAR (RAZA 2026-09-16: "I should also be able to type into You receive and You pay calculates auto").
    var recv = input(f[1]);
    if (recv) recv.removeAttribute('readonly');
  }

  function clearQuote(p) {
    quote = null;
    // A quote still in flight belongs to an amount that is gone. Without this, clearing the box (or
    // switching side) let a slow ripple_path_find land afterwards and write "You receive 17.84" under an
    // empty "You pay" (RAZA 2026-09-15).
    seq++;
    var f = fields(p);
    var recv = input(f[1]);
    if (recv) recv.value = '';
    mark(frowMono(f[1]), '≈ $0.00 USD');
    var d = window.__lxxAssetData, s = sides(p);
    // With no amount there is still a rate to state: the page's own live price.
    if (d && d.price > 0) {
      var r = s.pay.currency === 'XRP' ? (1 / d.price) : d.price;
      sumRow(p, 'rate', '1 ' + s.pay.code + ' = ' + fmt(r, 6) + ' ' + s.get.code);
    } else sumRow(p, 'rate', '—');
    sumRow(p, 'price impact', '—');
    impactTone(p, '');
    payUsd(p, 0);
    sumRow(p, 'min received', '—');
  }

  function usdOf(amount, s) {
    var u = usdPerXrp();
    if (!(u > 0) || !(amount > 0)) return 0;
    if (s.currency === 'XRP') return amount * u;
    var d = window.__lxxAssetData;
    var px = (d && d.price > 0) ? d.price
      : ((quote && quote.amt > 0 && quote.out > 0) ? (quote.side === 'sell' ? quote.out / quote.amt : quote.amt / quote.out) : 0);
    return px > 0 ? amount * px * u : 0;
  }
  function usdTxt(v) {
    if (!(v > 0)) return '≈ $0.00 USD';
    if (v >= 1e6) return '≈ $' + (v / 1e6).toFixed(2) + 'M USD';
    return '≈ $' + (v >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4)) + ' USD';
  }

  function impactTone(p, tone) {
    $$('[class*="dxa-tsum-row"]', p).forEach(function (r) {
      var k = r.children;
      if (k.length < 2 || (k[0].textContent || '').trim().toLowerCase() !== 'price impact') return;
      k[k.length - 1].style.color = tone;
    });
  }
  // "≈ $189.34 USD" beside the balance, as lumoscore.com's You pay line reads (RAZA 2026-09-15: "its not showing $value in You
  // Pay like it does on Stellar"). The .lx-payusd rule is inherited.
  function payUsd(p, v) {
    var f = fields(p), row = f[0] && $('[class*="dxa-trade-frow"]', f[0]);
    if (!row) return;
    var sp = $('.lx-payusd', row);
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'mono lxp lx-payusd';
      sp.setAttribute('data-logoed', '1');
      var balEl = $('.mono:not(.lx-payusd)', row);
      if (balEl) row.insertBefore(sp, balEl); else row.appendChild(sp);
    }
    var txt = v > 0 ? usdTxt(v) : '';
    if (sp.textContent !== txt) sp.textContent = txt;
  }

  function applyQuote(p, amt, out, paths, est, impactPct) {
    var f = fields(p), s = sides(p), d = window.__lxxAssetData;
    quote = { amt: amt, out: out, paths: paths || null, side: side(p), est: !!est };
    var recv = input(f[1]);
    // NOT OVER THE BOX BEING TYPED IN: the receive amount is the user's own figure while it has focus.
    if (recv && document.activeElement !== recv) recv.value = plainNum(floorTo(out, 6));
    mark(frowMono(f[1]), usdTxt(usdOf(out, s.get)));
    sumRow(p, 'rate', '1 ' + s.pay.code + ' = ' + fmt(out / amt, 6) + ' ' + s.get.code);
    // Against the page's own spot price: what this size costs beyond the best available rate.
    // STELLAR'S SIGN (RAZA 2026-09-15: "If im selling, the price impact should have been in negative"): the impact is the
    // move in THIS token's price — a buy pushes it up (+, green), a sell pushes it down (−, red). Buying at r times the
    // best rate means each token costs 1/r − 1 more, which has no ceiling; a sell is bounded at −100%.
    var buy = s.pay.currency === 'XRP', mag = null;
    if (impactPct != null && isFinite(impactPct)) {
      var rr = Math.max(0, 1 - Math.max(0, impactPct) / 100);
      mag = buy ? (rr > 0 ? (1 / rr - 1) * 100 : Infinity) : (1 - rr) * 100;
    } else if (!est && d && d.price > 0) {
      // An estimate at the page price has no impact to report — saying 0.00% would claim a measurement.
      var eff = buy ? (amt / out) : (out / amt);   // XRP per token either way
      mag = Math.max(0, buy ? (eff - d.price) / d.price : (d.price - eff) / d.price) * 100;
    }
    var impact = '—', tone = '';
    if (mag != null) {
      if (!isFinite(mag)) impact = buy ? '>+999,999%' : '-100%';
      else if (mag < 0.01) impact = '<0.01%';
      else impact = (buy ? '+' : '-') + (mag < 100 ? mag.toFixed(2) : (mag < 10000 ? mag.toFixed(1) : Math.round(mag).toLocaleString('en-US'))) + '%';
      tone = (mag < 0.01 || buy) ? 'var(--green,#22c55e)' : 'var(--red,#ff5b5b)';
    }
    sumRow(p, 'price impact', impact);
    impactTone(p, tone);
    payUsd(p, usdOf(amt, s.pay));
    sumRow(p, 'min received', fmt(out * (1 - SLIP), 6) + ' ' + s.get.code);
  }

  // ---- simulated quote -------------------------------------------------------------------------------
  // PRICE IMPACT WHERE THE LEDGER CANNOT ROUTE (RAZA 2026-09-15: "Price impact is not working"). ripple_path_find answers only
  // for an amount the account holds and a token it trusts, so an over-balance amount, a new token or a signed-out visitor
  // got "—". The pair's AMM pool (constant product, less its trading fee) and its order book are read directly and the
  // amount is filled in small steps from whichever pays more; impact is the fill against the best rate at the start.
  function simulate(s, amt) {
    var buying = s.pay.currency === 'XRP';
    var t = buying ? s.get : s.pay;
    var tok = { currency: t.currency, issuer: t.issuer };
    var val = function (a) { return typeof a === 'string' ? Number(a) / 1e6 : Number(a && a.value); };
    return Promise.all([
      rpc('amm_info', { asset: { currency: 'XRP' }, asset2: tok, ledger_index: 'validated' }).catch(function () { return null; }),
      rpc('book_offers', {
        taker_gets: buying ? tok : { currency: 'XRP' }, taker_pays: buying ? { currency: 'XRP' } : tok,
        limit: 200, ledger_index: 'validated'
      }).catch(function () { return null; })
    ]).then(function (r) {
      var pool = null, amm = r[0] && r[0].amm;
      if (amm) {
        var xr = typeof amm.amount === 'string' ? val(amm.amount) : val(amm.amount2);
        var tr = typeof amm.amount === 'string' ? val(amm.amount2) : val(amm.amount);
        if (xr > 0 && tr > 0) pool = { x: buying ? xr : tr, y: buying ? tr : xr, f: (Number(amm.trading_fee) || 0) / 100000 };
      }
      var offers = ((r[1] && r[1].offers) || []).map(function (o) {
        return {
          give: val(o.taker_gets_funded != null ? o.taker_gets_funded : o.TakerGets),
          want: val(o.taker_pays_funded != null ? o.taker_pays_funded : o.TakerPays)
        };
      }).filter(function (o) { return o.give > 0 && o.want > 0; });
      if (!pool && !offers.length) return null;
      var spot = 0;
      if (pool) spot = pool.y / pool.x * (1 - pool.f);
      if (offers.length) spot = Math.max(spot, offers[0].give / offers[0].want);
      var steps = 80, dx = amt / steps, out = 0, oi = 0, left = offers.length ? offers[0].want : 0;
      for (var k = 0; k < steps; k++) {
        var ammOut = pool ? pool.y * (1 - pool.x / (pool.x + dx * (1 - pool.f))) : 0;
        var need = dx, bookOut = 0, j = oi, l = left;
        while (need > 1e-18 && j < offers.length) {
          var take = Math.min(need, l);
          bookOut += take * offers[j].give / offers[j].want;
          need -= take; l -= take;
          if (l <= 1e-18) { j++; l = j < offers.length ? offers[j].want : 0; }
        }
        if (need > dx * 1e-9) bookOut = 0;                   // the book ran out inside this step
        if (!(ammOut > 0) && !(bookOut > 0)) break;
        if (ammOut >= bookOut) { out += ammOut; pool.x += dx; pool.y -= ammOut; }
        else { out += bookOut; oi = j; left = l; }
      }
      if (!(out > 0)) return null;
      return { out: out, impact: spot > 0 ? (1 - (out / amt) / spot) * 100 : null };
    });
  }
  function simQuote(p, s, amt, my) {
    simulate(s, amt).then(function (res) {
      if (my !== seq || !res) return;
      if (quote && !quote.est && quote.amt === amt) return;   // a routed quote already landed
      applyQuote(p, amt, res.out, null, true, res.impact);
    }, function () {});
  }

  function requote() {
    var p = pane();
    if (!p || !asset()) return;
    paintStatic(p);
    var amt = num(input(fields(p)[0]) && input(fields(p)[0]).value);
    if (!(amt > 0)) { clearQuote(p); say(p, ''); return; }
    var s = sides(p), me = addr(), my = ++seq;
    var d = window.__lxxAssetData;
    // MORE THAN THE ACCOUNT HOLDS. ripple_path_find answers with what the balance CAN buy, not what was
    // typed, so the rate collapsed and "price impact" read 695%. Estimate at the page price instead and
    // say why the swap cannot go ahead.
    var bal = payBalance(p);
    if (me && acct.at && bal != null && amt > bal + 1e-12) {
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      say(p, 'You only have ' + fmt(bal, 6) + ' ' + s.pay.code + (s.pay.currency === 'XRP' ? ' available after the reserve.' : '.'), 'bad');
      return;
    }
    if (!me) {
      // Signed out there is no account to route from, so the estimate is the live price — labelled as a
      // quote only once a wallet can ask the ledger for a real one.
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      return;
    }
    // NO TRUST LINE, NO ROUTE (RAZA 2026-09-15: "When trying to swap 1 XRP to ATOM. its not calculating. Its saying no route
    // which is nonsense"). The ledger will not deliver a token to an account that does not trust it, so path_find answers
    // with nothing for such an account; the actual reason is said, with the page-price estimate kept in view.
    // RAZA 2026-09-15: "No need to show this trustline error. we're not showing on Stellar" — the swap adds the trust line
    // itself (doSwap). Until then the quote is simulated on the pool and the book.
    if (me && acct.at && s.get.currency !== 'XRP' && !acct.line) {
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      say(p, '');
      return;
    }
    // AN ESTIMATE STRAIGHT AWAY (RAZA 2026-09-15: "Its taking forever to calculate you receive"). The ledger's route
    // lookup takes seconds on a public node; until it answers, the page's own price fills "You receive", and the
    // routed quote replaces it the moment it lands. Swapping waits for the route while one is still being found.
    if (d && d.price > 0 && !(quote && !quote.est && quote.amt === amt && quote.side === side(p))) {
      applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
    }
    inflight = my;
    rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: s.get.currency === 'XRP' ? '-1' : { currency: s.get.currency, issuer: s.get.issuer, value: '-1' },
      send_max: amountObj(s.pay, amt), ledger_index: 'validated'
    }).then(function (r) {
      if (my !== seq) return;
      inflight = 0;
      var alt = (r.alternatives || [])[0];
      if (!alt) { simQuote(p, s, amt, my); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      var g = alt.destination_amount;
      var out = typeof g === 'string' ? Number(g) / 1e6 : Number(g.value);
      if (!(out > 0)) { clearQuote(p); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      applyQuote(p, amt, out, alt.paths_computed && alt.paths_computed.length ? alt.paths_computed : null);
      say(p, '');
    }).catch(function () {
      if (my !== seq) return;
      inflight = 0;
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
    });
  }

  // ---- submitting ----------------------------------------------------------------------------------
  var busy = false;
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    function again() {
      if (n <= 0) return { ok: false, code: 'timeout' };
      return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return waitValidated(hash, n - 1); });
    }
    return rpc('tx', { transaction: hash, binary: false }).then(function (r) {
      if (r && r.validated) { var m = r.meta || {}; return { ok: m.TransactionResult === 'tesSUCCESS', code: m.TransactionResult }; }
      return again();
    }, again);
  }
  var CODES = {
    tecPATH_PARTIAL: 'The price moved past your 0.5% slippage before this went through. Nothing was swapped.',
    tecPATH_DRY: 'No route for that swap right now. Nothing was swapped.',
    tecUNFUNDED_PAYMENT: 'You do not hold enough for this swap.',
    tecNO_LINE: 'You need a trust line for this token before you can receive it.',
    tecNO_AUTH: 'The issuer has not authorised your account to hold this token.',
    tecFROZEN: 'This token is frozen by its issuer.'
  };

  function validate(p) {
    var a = asset();
    if (!a) return 'This page has no token.';
    var amt = num(input(fields(p)[0]) && input(fields(p)[0]).value);
    if (!(amt > 0)) return 'Enter an amount.';
    if (!quote || Math.abs(quote.amt - amt) > 1e-12 || quote.side !== side(p)) return 'Getting a quote — try again in a moment.';
    if (acct.key == null) return 'Reading your balance — try again in a moment.';
    var s = sides(p);
    if (s.pay.currency === 'XRP') {
      var fee = amt * feeRate();
      if (amt + fee + 0.0001 > acct.spend + 1e-9) return 'Not enough XRP — ' + fmt(acct.spend, 6) + ' is available after the reserve, and the 0.2% fee is paid on top.';
    } else if (amt > acct.bal + 1e-12) {
      return 'You only hold ' + fmt(acct.bal, 6) + ' ' + a.code + '.';
    }
    return '';
  }

  // "NO ROUTE" IS USUALLY TRUE AND ALMOST ALWAYS THE WRONG EXPLANATION (RAZA 2026-09-17: selling 0.000761 RIPPLEDICK,
  // "when there clearly is enough liq"). The pool was fine — that amount is worth 0.00000086 XRP, and the ledger cannot
  // pay less than one drop (0.000001), so no path can exist. The reader is told the real reason: the amount is too small,
  // and roughly what it would take. Returns '' when smallness is not the problem, so the generic message still stands.
  function tooSmallMsg(p, s, amt) {
    var d = window.__lxxAssetData;
    if (!(d && d.price > 0) || !(amt > 0)) return '';
    // Price is XRP per token, so a sell is amt × price and a buy is amt ÷ price.
    var out = s.pay.currency === 'XRP' ? (amt / d.price) : (amt * d.price);
    if (s.get.currency !== 'XRP' || out >= 0.000001) return '';
    var need = 0.000001 / d.price;                       // how much of this token makes one drop
    return 'That is too small to swap: ' + fmt(amt, 8) + ' ' + s.pay.code + ' is worth about '
      + out.toFixed(9) + ' XRP, and the ledger cannot pay less than 0.000001 XRP. You would need at least '
      + fmt(need, 6) + ' ' + s.pay.code + '.';
  }

  function feeInXrp(p, amt, out) {
    var s = sides(p);
    return s.pay.currency === 'XRP' ? amt * feeRate() : out * feeRate();
  }

  // THE FEE TRANSACTION SAYS WHAT IT IS (RAZA 2026-09-17: "make sure to mention in memo that the first trx is for fees").
  // Memo fields are hex bytes on this ledger, so the text is encoded here; Xaman and GemWallet both render it on the review
  // screen, which is the difference between "a payment to an address you don't recognise" and a named platform fee.
  function hexAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 127) continue;                             // plain ASCII only, so every wallet renders it the same
      out += ('0' + c.toString(16)).slice(-2).toUpperCase();
    }
    return out;
  }
  function feeMemo(payCode, getCode, n, of) {
    var pct = +(feeRate() * 100).toFixed(2);
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore platform fee ' + pct + '% - transaction ' + n + ' of ' + of + '. The '
          + payCode + ' to ' + getCode + ' swap is the next transaction.')
      }
    };
  }
  function lineMemo(code) {
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore: trust line for ' + code + ', required before this account can receive it '
          + '- transaction 1 of 3. The platform fee and the swap follow.')
      }
    };
  }

  // THE SWAP, AS ON STELLAR (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be automatically created
  // upon the swap", and "Finding the best route — try again in a moment" after clicking). A token the account does not
  // trust gets its TrustSet first (limit 1,000,000,000, the wallet's own add-line default), confirmed on the ledger; then
  // the route is asked for fresh and the payment is built from it. Nothing asks the user to click again.
  function doSwap(p) {
    if (busy) return;
    var msg = validate(p);
    if (msg) { say(p, msg, 'bad'); return; }
    var s = sides(p), me = addr(), amt = quote.amt;
    var b = cta(p), label = b ? b.textContent : '';
    busy = true;
    say(p, '');
    function fail(text) { busy = false; if (b) b.textContent = label; say(p, text, 'bad'); }
    // How many signatures this swap actually takes, so every label and memo counts the same way: a token this account
    // cannot yet receive needs its trust line first, and then it is three, not two.
    var needLine = s.get.currency !== 'XRP' && !acct.line;
    p.setAttribute('data-lxsteps', needLine ? '3' : '2');

    var step = Promise.resolve();
    if (needLine) {
      step = rpc('server_info', {}).then(function (si) {
        var inc = Number((((si || {}).info || {}).validated_ledger || {}).reserve_inc_xrp) || 0.2;
        if (s.pay.currency === 'XRP' && amt * (1 + feeRate()) + inc + 0.0001 > acct.spend + 1e-9) {
          throw new Error('Not enough XRP — holding ' + s.get.code + ' reserves ' + inc + ' XRP on top of this swap.');
        }
        // THE TRUST LINE EXPLAINS ITSELF TOO (RAZA 2026-09-17, on the fee memo). This is the one prompt of the three with
        // nothing on it but "TrustSet, limit 1000000000" — the least recognisable transaction in the whole product.
        if (b) b.textContent = 'Approve the ' + s.get.code + ' trust line (1 of 3)…';
        return window.lxc.submit({
          TransactionType: 'TrustSet', Account: me,
          LimitAmount: { currency: s.get.currency, issuer: s.get.issuer, value: '1000000000' },
          Memos: [lineMemo(s.get.code)]
        });
      }).then(function (hash) {
        if (b) b.textContent = 'Confirming…';
        return waitValidated(hash);
      }).then(function (res) {
        if (!res.ok) {
          throw new Error(res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
            : ('The ledger did not accept the swap (' + res.code + ').'));
        }
        acct.line = true;
      });
    }
    // The quote the pane is already showing, kept before the refresh can overwrite it.
    var shown = (quote && quote.amt === amt && quote.out > 0)
      ? { out: quote.out, paths: quote.paths || null } : null;

    step.then(function () {
      if (b) b.textContent = 'Finding the best route…';
      // This is a REFRESH of a quote that is already on screen, not the quote itself — so a slow or dead answer must not
      // take the swap down with it. A failure here falls through to the figures the user is looking at.
      // MEASURED 2026-09-17: this same call takes 0.4s buying RLUSD and 28.4s selling it. With the displayed quote as a
      // fallback there is no reason to wait that long — six seconds, then go with what the user is already looking at.
      return rpc('ripple_path_find', {
        source_account: me, destination_account: me,
        destination_amount: s.get.currency === 'XRP' ? '-1' : { currency: s.get.currency, issuer: s.get.issuer, value: '-1' },
        send_max: amountObj(s.pay, amt), ledger_index: 'validated'
      }, shown ? 6000 : 20000).catch(function () { return null; });
    }).then(function (r) {
      var alt = r && (r.alternatives || [])[0];
      var g = alt && alt.destination_amount;
      var out = g == null ? 0 : (typeof g === 'string' ? Number(g) / 1e6 : Number(g.value));
      var paths = (alt && alt.paths_computed && alt.paths_computed.length) ? alt.paths_computed : null;
      if (!(out > 0) && shown) { out = shown.out; paths = shown.paths; }
      if (!(out > 0)) throw new Error('No route for that swap right now. Nothing was swapped.');
      busy = false;
      if (b) b.textContent = label;
      applyQuote(p, amt, out, paths);
      sendSwap(p, quote);
    }).catch(function (e) { fail((e && e.message) || 'The swap could not be completed.'); });
  }

  function sendSwap(p, q) {
    if (busy) return;
    var s = sides(p), me = addr();
    // PARTIAL PAYMENT WITH A FLOOR (RAZA 2026-09-16, the ATOM buy "[Failed again]" — tecPATH_PARTIAL twice, while rippled's own
    // simulate of the identical transaction answered tesSUCCESS). An exact-delivery Payment must land its Amount to the last
    // unit through a pool of 0.38 ATOM; tfPartialPayment delivers what SendMax buys, and DeliverMin refuses anything below the
    // quote less the 0.5% slippage — the same protection, without the exact-amount edge. It pays yourself, so "partial" can
    // only ever mean fewer of your own tokens than quoted, and never fewer than the minimum shown.
    // SELLING THE LOT LEAVES NOTHING BEHIND (RAZA 2026-09-16: "I sold max amount of this asset but some is still left behind").
    // A partial payment stops as soon as it has delivered `Amount`, so a rate that moved in the seller's favour left a few
    // tokens unspent. On a MAX sell the ceiling is put out of reach (2% above the quote) and SendMax is the exact balance, so
    // the whole holding is what limits the payment — DeliverMin still refuses anything below the quote less slippage.
    var all = p.getAttribute('data-lxmax') === '1' && s.pay.currency !== 'XRP' && acct.bal > 0;
    var sendMax = all ? Math.max(q.amt, acct.bal) : q.amt;
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: me,
      Amount: amountObj(s.get, all ? q.out * 1.02 : q.out),
      DeliverMin: amountObj(s.get, lxx().minAfterSlippage(q.out, SLIP)),
      SendMax: amountObj(s.pay, sendMax),
      Flags: 131072
    };
    if (!tx.Amount || !tx.DeliverMin || !tx.SendMax) { say(p, 'That amount is too small for the ledger.', 'bad'); return; }
    if (q.paths) tx.Paths = q.paths;
    var feeXrp = feeInXrp(p, q.amt, q.out);
    var b = cta(p), label = b ? b.textContent : '';
    busy = true;
    function stop(text, tone) { busy = false; if (b) b.textContent = label; if (text != null) say(p, text, tone); }
    if (b) b.textContent = 'Confirm in wallet…';
    say(p, '');
    // A DRY RUN BEFORE THE WALLET IS ASKED (RAZA 2026-09-15: "The trx failed when im trying to buy ATOM" — tecPATH_PARTIAL).
    // On a thin market the price can move past the 0.5% slippage in the seconds between quote and signature; the ledger's
    // simulate call says so without a fee or a signature, and the quote is refreshed instead.
    rpc('simulate', { tx_json: tx }).then(function (r) { return r && r.engine_result; }, function () { return null; }).then(function (er) {
      if (er === 'tecPATH_PARTIAL' || er === 'tecPATH_DRY') {
        var err = new Error(er === 'tecPATH_DRY' ? CODES.tecPATH_DRY
          : 'The price moved past your 0.5% slippage while this was being prepared. Nothing was signed — check the new quote and try again.');
        err.requote = true;
        throw err;
      }
      // THE FEE IS SIGNED FIRST NOW (RAZA 2026-09-17: "lets do the fees signature instead of swap. the second signature will
      // be for swap. But make sure to mention in memo that the first trx is for fees"). It carries a memo saying what it is,
      // so the wallet's review screen names it rather than showing a bare payment.
      //
      // THE RISK THIS TAKES ON, stated plainly: the old order paid the fee only after the swap had landed, so a rejected or
      // failed swap cost the user nothing. First means a fee can be paid for a swap that then fails. The dry run above is
      // what keeps that rare — it has already told us the ledger accepts this exact swap — and the message below says so
      // plainly if it happens anyway.
      if (!(feeXrp > 0)) return null;
      // Counted against the whole sequence, including the trust line when there was one — "1 of 2" on what is really the
      // second of three prompts is exactly the kind of small lie that makes someone abandon a signature.
      var of = p.getAttribute('data-lxsteps') === '3' ? 3 : 2;
      if (b) b.textContent = 'Approve the platform fee (' + (of - 1) + ' of ' + of + ')…';
      return window.lxc.submit({
        TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
        Amount: lxx().toDrops(feeXrp),
        Memos: [feeMemo(s.pay.code, s.get.code, of - 1, of)]
      }).then(function (h) { return h; }, function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m) ? 'The platform fee was not approved, so nothing was swapped.' : m);
      });
    }).then(function () {
      var ofN = p.getAttribute('data-lxsteps') === '3' ? 3 : 2;
      if (b) b.textContent = 'Approve the swap (' + ofN + ' of ' + ofN + ')…';
      return window.lxc.submit(tx);
    }).then(function (hash) {
      if (b) b.textContent = 'Confirming…';
      return waitValidated(hash);
    }).then(function (res) {
      if (!res.ok) {
        if (res.code === 'tecPATH_PARTIAL') setTimeout(requote, 50);
        var why = res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
          : (CODES[res.code] || ('The ledger did not accept the swap (' + res.code + ').'));
        // Said out loud, because the fee has already left the account by this point.
        stop(feeXrp > 0 ? (why + ' The platform fee was already paid.') : why, 'bad');
        return;
      }
      stop('Swap complete ✓', 'good');
    }).then(function () {
      var i = input(fields(p)[0]);
      if (i) i.value = '';
      clearQuote(p);
      loadAcct(true).then(function () { paintStatic(p); });
      try { if (window.__lxxBookReload) window.__lxxBookReload(); } catch (e) {}
    }).catch(function (e) {
      var m = (e && e.message) || '';
      var code = (m.match(/\bte[cfm][A-Z_]+/) || [])[0];
      stop(code && CODES[code] ? CODES[code] : (m || 'The swap could not be completed.'), 'bad');
      if ((e && e.requote) || code === 'tecPATH_PARTIAL') setTimeout(requote, 50);
    });
  }

  // ---- wiring --------------------------------------------------------------------------------------
  var tmr = null;
  function wire() {
    if (window.__lxxDxaSwapWired) return;
    window.__lxxDxaSwapWired = 1;

    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p) return;

      var b = t.closest('[class*="dxa-trade-cta"]');
      if (b) {
        if (b.getAttribute('data-lxgate') === '1' || !addr()) return;   // lx-gate opens the wallet picker
        if (e.isTrusted && document.getElementById('lx-feemodal')) {
          var msg = validate(p);
          if (msg) { e.preventDefault(); e.stopImmediatePropagation(); say(p, msg, 'bad'); }
          return;                                                        // valid: the review step opens
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        doSwap(p);
        return;
      }

      var q = t.closest('.dxa-trade-quick button, .mdxa-trade-quick button');
      if (q) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var pct = /max/i.test(q.textContent) ? 1 : (parseFloat(q.textContent) / 100);
        var bal = payBalance(p);
        if (!(bal > 0) || !(pct > 0)) return;
        var room = side(p) === 'sell' ? bal : Math.max(0, bal / (1 + feeRate()) - 0.0001);
        var i = input(fields(p)[0]);
        if (i) i.value = plainNum(floorTo(room * pct, 6));
        // MAX MEANS ALL OF IT (RAZA 2026-09-16: "I sold max amount of this asset but some is still left behind"): remembered
        // here so the payment can be built to spend the whole balance rather than stopping at the quoted output.
        if (pct === 1 && side(p) === 'sell') p.setAttribute('data-lxmax', '1'); else p.removeAttribute('data-lxmax');
        requote();
        return;
      }

      if (t.closest('.dxa-trade-flip, .mdxa-trade-flip')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var other = $('[class*="dxa-side-btn"]:not(.active)', p);
        if (other) other.click();
        return;
      }

      if (t.closest('[class*="dxa-side-btn"]')) {
        // After the design flips .active and dexasset.js relabels the chips.
        setTimeout(function () { var i2 = input(fields(p)[0]); if (i2) i2.value = ''; clearQuote(p); paintStatic(p); say(p, ''); }, 30);
      }
    }, true);

    // Typing is claimed at the pane: the design's own input handler would otherwise write a mock receive
    // amount into the second box after ours.
    window.addEventListener('input', function (e) {
      var t = e.target;
      var p = t && t.closest && t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p || t.tagName !== 'INPUT') return;
      e.stopImmediatePropagation();
      var v = String(t.value).replace(/[^0-9.]/g, '');
      var dot = v.indexOf('.');
      if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      if (v !== t.value) t.value = v;
      // TYPING INTO "YOU RECEIVE" FILLS "YOU PAY" (RAZA 2026-09-16: "Thats how it is on stellar"). The pay amount is what the
      // ledger is then asked to route, so the quote that follows is a real one; the receive box keeps the typed figure while
      // it has focus. The rate is the live quote's when there is one, else the page's own price.
      var ff = fields(p), payI = input(ff[0]), recvI = input(ff[1]);
      if (t === recvI && payI) {
        var want = num(v), sd = sides(p), dd = window.__lxxAssetData;
        var rt = (quote && quote.amt > 0 && quote.out > 0 && quote.side === side(p)) ? (quote.out / quote.amt)
          : ((dd && dd.price > 0) ? (sd.pay.currency === 'XRP' ? 1 / dd.price : dd.price) : 0);
        payI.value = (want > 0 && rt > 0) ? plainNum(floorTo(want / rt, 6)) : '';
        p.removeAttribute('data-lxmax');
      } else if (t === payI) {
        p.removeAttribute('data-lxmax');
      }
      clearTimeout(tmr);
      tmr = setTimeout(requote, 300);
    }, true);

    window.addEventListener('lxx:assetdata', function () { requote(); });
    if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { acct = { key: null }; boot(); });
  }

  function boot() {
    var p = pane();
    if (!p || !asset() || !window.lxx) return;
    var i = input(fields(p)[0]);
    if (i && !p.__lxxCleared) { i.value = ''; p.__lxxCleared = 1; }
    // Leftover from the disabled era, in case an old copy of the page script ran first.
    $$('.lxx-dxa-offnote', p).forEach(function (n) { n.parentNode.removeChild(n); });
    // lx-feemodal can rebuild its row after this runs; claim whatever it writes, whenever it writes it.
    if (!p.__lxxFeeObs && window.MutationObserver) {
      p.__lxxFeeObs = new MutationObserver(function () { claimFeeRow(p); });
      p.__lxxFeeObs.observe(p, { childList: true, subtree: true });
    }
    paintStatic(p);
    clearQuote(p);
    loadAcct(true).then(function () { paintStatic(p); requote(); });
  }

  wire();
  var tries = 0;
  (function wait() {
    if (pane() && asset() && window.lxx) { boot(); return; }
    if (++tries < 40) setTimeout(wait, 250);
  })();
})();
