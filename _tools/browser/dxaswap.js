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

  function rpc(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (j) {
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
  // Decimals follow the magnitude — the same rule the order rows and the Send dialog use.
  function covDp(n) {
    n = Math.abs(Number(n) || 0);
    return n >= 1e4 ? 0 : n >= 1e2 ? 2 : n >= 1 ? 4 : 6;
  }
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
      // AND THE GAP HAS TO MOVE WITH IT. limit.js styles the shared class `margin:8px 2px 0` — a top
      // gap and no bottom one, which is correct for a note UNDER the button and wrong for one above:
      // it would sit tight against the button it is about and leave the space on the side away from
      // it. Stellar's .lxda-swaperr is `margin:0 0 9px` for exactly this position. This marker lets
      // disStyle() restate that without editing the shared rule, which the Limit pane's own note —
      // still below its button, and the only inline note on that pane — depends on.
      n.setAttribute('data-lxabove', '1');
      // AND MAKE SURE THE RULE EXISTS BY THE TIME THE NODE DOES. disStyle() is otherwise reached only
      // through setDis(), which runs on the quote path — so a note raised before any quote (a balance
      // warning on the first keystroke) would render with the below-the-button margin until a quote
      // happened to land. It is id-guarded and hoisted, so calling it here costs one lookup.
      disStyle();
      // ABOVE THE BUTTON, NOT BELOW IT. This inserted at b.nextSibling, so "You only have 0.063812
      // XRP available after the reserve." landed underneath the Swap button, past the fee notice and
      // off the bottom of the panel -- RAZA 2026-10-11: "You only have ... error is appearing way
      // below. See how it's done on Stellar mobile."
      //
      // Stellar does cta.parentNode.insertBefore(e, cta) (_dexassetdata.js, dxErr), putting the
      // message between the figures it is about and the button it is blocking, which is where a
      // reader looks when the button does not work. Same placement here.
      b.parentNode.insertBefore(n, b);
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

  // ---- open orders this swap would leave short -----------------------------------------------------
  //
  // THE XRP LEDGER RESERVES NOTHING BEHIND AN OFFER AND STELLAR DOES, which is the whole of it. On
  // Stellar the protocol holds the tokens and Horizon publishes `selling_liabilities`, so a balance
  // can never fall under what an open order promised. Here it can, and the order simply goes on
  // advertising a size it can no longer deliver.
  //
  // RAZA 2026-11-03: an open order for 20,000,000 LUMOS over a balance of 18,180,172 — covered when
  // placed, taken under by a later payment, with nothing anywhere saying so. See xrpl-core.js,
  // offerCommitments. This WARNS and does not refuse: spending below an open order is legal here and
  // is sometimes meant, so Stellar's hard stop is the protocol's behaviour and not ours to copy onto
  // a ledger that does not share it.
  var COMMIT = { who: '', map: null, loading: null };

  function loadCommitments() {
    var me = addr();
    if (!me) { COMMIT.who = ''; COMMIT.map = null; return Promise.resolve(null); }
    if (COMMIT.who === me && COMMIT.map) return Promise.resolve(COMMIT.map);
    if (COMMIT.loading) return COMMIT.loading;
    COMMIT.loading = lxx().allOffers(rpc, me).then(function (r) {
      COMMIT.map = lxx().offerCommitments(r.offers);
      COMMIT.who = me;                                    // set only on success, so a failure retries
      COMMIT.loading = null;
      return COMMIT.map;
    }).catch(function () {
      // Left null, never {}. An empty map reads as "nothing is committed", which is the one wrong
      // answer available here because it understates ([[never-cache-a-failure-as-an-answer]]).
      COMMIT.loading = null;
      return null;
    });
    return COMMIT.loading;
  }

  // The sentence, or '' when there is nothing true to say. Measured against the SAME balance the
  // panel already shows, so the two numbers on screen cannot disagree.
  function underfundNote(p, amt) {
    if (!COMMIT.map) return '';
    var pay = sides(p).pay;
    var bal = payBalance(p);
    if (bal == null) return '';
    var c = COMMIT.map[pay.currency === 'XRP' ? 'XRP' : (pay.currency + ':' + pay.issuer)];
    if (!c || !(c.amount > 0)) return '';
    var left = bal - (Number(amt) || 0);
    if (left >= c.amount) return '';
    // Worded and rounded exactly as the Send dialog and the order rows do — one shortfall, one voice.
    return 'This leaves ' + fmt(Math.max(0, left), covDp(left)) + ' ' + pay.code + '. Your '
      + (c.count > 1 ? (c.count + ' open ' + pay.code + ' orders need ') : 'open order needs ')
      + fmt(c.amount, covDp(c.amount)) + ', so ' + (c.count > 1 ? 'they' : 'it')
      + ' could not fill in full. You can still swap.';
  }

  // Said on the quote, not on the button. By the time the wallet is asking for a signature the reader
  // has already decided; the note belongs beside the figure while they are still choosing it.
  function sayCoverage(p, amt) {
    loadCommitments().then(function () {
      if (pane() !== p) return;                           // panel swapped out mid-read
      var note = underfundNote(p, amt);
      // Only ever writes into an EMPTY line. say(p,'') is what used to be at each of these call sites,
      // and a real error raised in the meantime — no route, too small — must outrank this caution.
      var n = $('.lxx-limit-note', p);
      if (n && n.textContent) return;
      if (note) say(p, note, 'warn');
    });
  }

  // THE TRADING FEE ROW'S FIGURE (RAZA 2026-09-15: "why's the trading fees not showing up"). lx-feemodal writes
  // "0.2%" into a .mono span, and the inherited sheet hides .dxa-tsum-row .mono until a data layer claims it with
  // .lxp — so the label showed and its value never did.
  function claimFeeRow(p) {
    $$('.lx-feerow .mono:not(.lxp), .lx-feerow .lx-feerate:not(.lxp)', p).forEach(function (m) { m.classList.add('lxp'); });
  }

  function paintStatic(p) {
    claimFeeRow(p);
    // Both of these ride paintStatic because it is already the one function that runs on init AND
    // 30ms after every side flip — the two moments the design relabels the button and the amount box
    // is emptied. Hooking the side button separately would be a second thing to keep in step.
    swapLabel(p);
    setDis(p, !hasAmt(p));
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

  // THE DESIGN'S ORDER WORDING, REPLACED WITH "Swap" (RAZA 2026-10-09: "on stellar the Trade-asset
  // page, the button says swap. but on XRPL it says place buy/sell order").
  //
  // _xrplcopy2.js already rewrites the SHIPPED markup, and that is still needed — it is what the page
  // reads before any script runs. What it cannot reach is the relabel the design's own widget does
  // when the side is flipped, which is why the button came back as "Place Sell Order" the moment Sell
  // was pressed.
  //
  // MATCHED ON THE TWO EXACT STRINGS, not on a prefix. The same pane shows "Connect wallet" when no
  // wallet is attached and a pending label while a swap is in flight, and the LIMIT pane's button
  // legitimately reads "Place Limit Order" — a limit order really is placed, and rests. Anything that
  // is not one of the two order labels is left exactly as it is.
  function swapLabel(p) {
    var b = cta(p);
    if (!b) return;
    if (/^Place (Buy|Sell) Order$/i.test((b.textContent || '').trim())) b.textContent = 'Swap';
  }

  // Is there an amount to act on? Shared by the two callers below so they cannot disagree.
  function hasAmt(p) {
    var i = input(fields(p)[0]);
    return num(i && i.value) > 0;
  }

  function clearQuote(p) {
    quote = null;
    // DIMMED UNTIL THERE IS AN AMOUNT (RAZA 2026-10-09: "the button should be disabled if nothing is
    // entered just like on stellar"). This read setDis(p, false) with the note "an empty box is not an
    // impossible order" — true of the order itself, but Stellar dims its CTA until a size is typed and
    // this pane now matches it. validate() still answers "Enter an amount." for anyone who gets past
    // the dimming, so nothing is lost if the gate is ever bypassed.
    setDis(p, !hasAmt(p));
    // A quote still in flight belongs to an amount that is gone. Without this, clearing the box (or
    // switching side) let a slow ripple_path_find land afterwards and write "You receive 17.84" under an
    // empty "You pay" (RAZA 2026-09-15).
    seq++;
    var f = fields(p);
    var recv = input(f[1]);
    // NOT WHILE IT IS BEING TYPED INTO. "0.01" is typed one character at a time, and the first of
    // those characters is "0" — which makes want 0, empties "You pay", and brings us here 300ms
    // later to blank the box the user is still typing in. The decimal could never be reached:
    // RAZA 2026-10-18, "Not able to put numbers in decimals like 0.01, 0.2 etc in you receive
    // section, it gets automatically removed immediately after putting 0".
    //
    // The same guard already protects the other writer of this box (`document.activeElement !==
    // recv` where the quote lands), for the same reason — this path simply never got it. Clearing
    // is still correct when the box is NOT focused, which is what the "slow ripple_path_find lands
    // under an empty You pay" note above is about.
    if (recv && document.activeElement !== recv) recv.value = '';
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

  // Stellar's wording, so the two chains answer this the same way.
  var SAT_MSG = 'Not enough liquidity to fill this size — try a smaller amount';

  // Saturated when doubling the money buys less than half as much again — or when nothing is
  // obtainable at all.
  //
  // STELLAR'S 1% BAND DOES NOT TRANSFER, and measuring is what showed it. On the reported ATOM (total
  // supply 1), 3600 XRP simulates to 0.4196 and 1800 XRP to 0.3736 — halving the spend still returns
  // 89% of the output, so "within 1%" calls that fillable. It is not. Horizon flatlines or even
  // reverses once it stops finding a path, which is what makes 1% the right test there; a
  // constant-product pool never flattens that far, because there is always fractionally more to buy.
  //
  // THE RATIO IS THE SIGNAL, and it has an exact meaning. For a pool, half-input ÷ full-input runs
  // from 0.5 (a small trade, nearly linear) toward 1.0 (saturated), and it passes 2/3 precisely when
  // the input equals the pool's whole opposite reserve. So `full <= half * 1.5` reads: you are
  // spending more than the entire reserve, and doubling your money buys under 50% more. The ATOM
  // case sits at 0.89 — about seven times the reserve.
  //
  // Only ever consulted once the impact is already past 100%, so an ordinary trade never reaches it.
  function satCheck(s, amt) {
    return Promise.all([simulate(s, amt), simulate(s, amt / 2)]).then(function (r) {
      var full = r[0] && r[0].out, half = r[1] && r[1].out;
      if (!(full > 0)) return true;
      return !!(half > 0 && full <= half * 1.5);
    }).catch(function () { return false; });   // unknown must not block a trade
  }

  // THE BUTTON LOOKS LIKE WHAT IT IS (RAZA 2026-10-08: "Please disable the orange button if the order
  // is not possible"). Stellar sets data-lxdis on its CTA and styles it; this build has no such rule,
  // so the look is set inline rather than by adding a stylesheet — a CSS edit here would be the ninth
  // way for a rule to land in the file and do nothing on the page.
  //
  // NOT pointer-events:none. The click still runs, validate() still returns the same sentence, and
  // the reader gets feedback instead of a button that silently ignores them.
  //
  // THE ATTRIBUTE IS OURS; THE INLINE STYLE IS NOT, and that is why this is a stylesheet rule rather
  // than b.style.opacity. The page already ships
  //   .dxa-trade-cta[data-lxdis="1"]{opacity:.55;cursor:not-allowed;filter:grayscale(.25)}
  // and it was having no effect, because the DESIGN'S OWN trade widget rewrites this button after we
  // touch it — measured: data-lxdis stayed "1" while style.opacity came back as an inline "1", which
  // beats any ordinary rule and beat the inline value this function used to set too. A second writer
  // on one node, the shape this project keeps meeting.
  //
  // An !important declaration in a stylesheet outranks a plain inline one, so the rule wins without
  // this having to race the other writer or watch the node. Injected at runtime rather than at build
  // time so it travels with the script that depends on it, and guarded by id so it lands once.
  function disStyle() {
    if (document.getElementById('lx-dxadis')) return;
    var st = document.createElement('style');
    st.id = 'lx-dxadis';
    // NOT opacity, AND NOT cursor. The design's widget writes them INLINE WITH !important —
    // measured on the live button: `opacity: 1 !important; cursor: pointer !important`. An inline
    // important declaration is the top of the cascade; no stylesheet can outrank it, so a rule
    // naming either property is a rule that will never apply, however it is written.
    //
    // It claims nothing else, which is why `filter` landed while those two did not. So the disabled
    // state is drawn with the properties left free: the orange fill dims, which is the cue a reader
    // actually reads, and the explanation sits directly above the button (see say()).
    //
    // FILTER DOES BOTH JOBS, AND NO PALETTE TOKENS. Stellar's own disabled CTA is
    //   opacity:.55; cursor:not-allowed; filter:grayscale(.25)
    // — a DIMMED ORANGE, not a grey one. `filter: opacity()` is a filter FUNCTION, not the opacity
    // property, so it rides in on the one channel the widget leaves alone and reproduces the .55
    // exactly (RAZA 2026-10-08: "the color of swap button when its inactive is different on XRPL" —
    // this rule used to be grayscale(1), a flat neutral grey nothing like lumoscore.com's).
    // No palette token either: an earlier version painted the button var(--surface-2), which measures
    // #fafbfc on this build — very nearly white, so on the dark card it would have been glaring.
    // Naming a token means guessing which theme the reader is in; a filter derives from whatever the
    // button already is, so it reads the same way in both. `cursor` stays unwinnable.
    //
    // MATCH THE BUTTON THE SAME WAY cta() DOES. Mobile's class is mdxa-trade-cta, a different class
    // name that merely contains the desktop one as a substring, so `.dxa-trade-cta` misses it entirely
    // — the first version of this rule greyed the desktop button and did nothing on the phone.
    st.textContent = '[data-lxunfill="1"] [class*="dxa-trade-cta"]{filter:grayscale(.25) opacity(.55)!important}'
      // The margin for a note ABOVE the button — see the note on data-lxabove in say(). Matches
      // Stellar's .lxda-swaperr{margin:0 0 9px}. Scoped to the attribute, so the Limit pane's note
      // keeps limit.js's below-the-button spacing.
      + '.lxx-limit-note[data-lxabove="1"]{margin:0 2px 9px!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // THE MARK GOES ON THE PANE, NOT THE BUTTON, and that is the whole trick.
  //
  // Two earlier attempts lost to the same second writer. Setting b.style.opacity lost because the
  // design's widget reassigns inline opacity afterwards. Setting data-lxdis="1" and styling it with
  // !important lost too — measured: the attribute itself came back as "0", so the widget rewrites
  // the button's attributes as well, and anything written ON that node is a race we do not control.
  //
  // The pane is not something it touches. A descendant selector reaches the button from there, so
  // the button keeps whatever the widget wants to put on it and still renders disabled.
  function setDis(p, on) {
    if (!p || !p.setAttribute) return;
    disStyle();
    if (on) p.setAttribute('data-lxunfill', '1');
    else p.removeAttribute('data-lxunfill');
  }

  function applyQuote(p, amt, out, paths, est, impactPct) {
    var f = fields(p), s = sides(p), d = window.__lxxAssetData;
    quote = { amt: amt, out: out, paths: paths || null, side: side(p), est: !!est, unfillable: 0 };
    // A FRESH QUOTE CLEARS A STALE "not enough liquidity", and only that one. Typing 5 ATOM and then
    // 0.01 left the warning standing over a perfectly ordinary 30% quote — the flag resets on every
    // quote but the sentence on screen did not, so the pane contradicted itself. Matched by text so
    // a balance warning, which is about the account rather than the size, is left alone.
    var staleNote = $('.lxx-limit-note', p);
    if (staleNote && staleNote.textContent === SAT_MSG) say(p, '');
    setDis(p, false);                 // a new size is innocent until the check says otherwise
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
      // THE SIGN ENCODES DIRECTION, AND THE COLOUR FOLLOWS THE SIGN. A buy reads "+x%" in green, a
      // sell reads "-x%" in red, whatever the magnitude. `|| buy` is what does that, and it is
      // DELIBERATE — do not "fix" it into a magnitude threshold.
      //
      // I did exactly that on 2026-10-07 and RAZA caught it the same day: "You've messed it up. When
      // buying ... the asset will always show positive impact (+ sign and green color). if sold ...
      // the impact will always be in negative (- and red color)." The reasoning that led there was
      // checking Stellar's BRIDGE card ("price impact above 1%: amber") and assuming it governed the
      // swap pane. It does not. The counterpart is Stellar's own swap, and lumoscore.com renders a
      // 1000 XLM buy of LUMOS at "+18.72%" in GREEN — so magnitude-colouring here was a divergence
      // from the one build this fork exists to match, not a correction of one.
      tone = (mag < 0.01 || buy) ? 'var(--green,#22c55e)' : 'var(--red,#ff5b5b)';
    }
    sumRow(p, 'price impact', impact);
    impactTone(p, tone);

    // PAST THE END OF THE BOOK, A PERCENTAGE STOPS MEANING ANYTHING.
    //
    // RAZA 2026-10-08: "ATOM has a total supply of 1, so buying 5 should be impossible. Check what
    // we're showing on Stellar in such situation." We were showing "+1098.9%" and a live Place Buy
    // Order, with "min received 0.417725" under a request for 5 — a figure that only counts how far
    // beyond the end of the book the amount was typed.
    //
    // Stellar already answers this, in _dexassetdata.js's dxSatCheck, and this is that behaviour on
    // this ledger: only test once the impact is already steep (a doubling of price is harsh but
    // real), then re-quote at HALF and see whether the output moves. If halving what you pay barely
    // changes what you get, the market cannot fill this size — on an AMM the output asymptotes to
    // the whole reserve, so beyond a point more money buys nothing more.
    //
    // BOTH SIDES OF THE COMPARISON COME FROM simulateSwap, deliberately. The displayed quote may
    // have come from ripple_path_find instead, and mixing the two would compare models rather than
    // sizes. Saturation is a property of the CURVE, so the two points only have to agree with each
    // other. It is also local arithmetic over the pool and book — no second network round trip,
    // which is what Stellar spends here.
    // THE THRESHOLD CANNOT BE ONE NUMBER, because the two directions are not measured on one scale.
    // A buy's impact is unbounded (paying 11x spot reads +1091%), while a sell's is bounded at −100%
    // by construction — you cannot receive less than nothing. So `mag > 100` can NEVER be true on a
    // sell, and the whole check was unreachable in that direction: selling 5 ATOM, five times the
    // entire supply, quoted at −92.75% with no warning at all (RAZA 2026-10-08, asking what the sell
    // side does).
    //
    // The matched condition is the same statement in both directions — "worse than 2:1 against the
    // page's spot price". For a buy that is paying over twice spot, mag > 100. For a sell it is
    // receiving under half of spot, mag > 50. Both mean rr < 0.5.
    //
    // It is only a cost gate, not the verdict: satCheck below is what decides, and it reads the same
    // either way (measured on this ATOM: sell 5 → ratio 0.932 blocked, sell 0.2 → 0.602 allowed).
    if (mag != null && mag > (buy ? 100 : 50)) {
      var myq = seq;
      satCheck(s, amt).then(function (sat) {
        if (!sat || myq !== seq || !quote || quote.amt !== amt) return;
        quote.unfillable = 1;
        // EVERY FIGURE DERIVED FROM THE REJECTED QUOTE GOES WITH IT (RAZA 2026-10-08: "When a swap is
        // not possible on Stellar, You pay is left blank on Stellar but on XRPL it shows the value").
        // lumoscore.com's own unfillable state leaves You pay empty and prints "—" for Rate and Min
        // received; this pane was still showing a pay amount, a rate and a min-received computed from
        // the very quote it had just declared untrustworthy, which reads as a priced, placeable order
        // sitting under a red refusal. Only price impact had been blanked.
        //
        // The pay box is written by the input handler when the typing happens in "You receive", so
        // clearing it here is the only place it comes out — and never while it has focus, since then
        // the figure is the user's own.
        var payI = input(f[0]);
        if (payI && document.activeElement !== payI) payI.value = '';
        payUsd(p, 0);
        sumRow(p, 'rate', '—');
        sumRow(p, 'min received', '—');
        sumRow(p, 'price impact', '—');     // a number here would be answering the wrong question
        impactTone(p, '');
        say(p, SAT_MSG, 'bad');
        setDis(p, true);
      });
    }
    payUsd(p, usdOf(amt, s.pay));
    sumRow(p, 'min received', fmt(out * (1 - SLIP), 6) + ' ' + s.get.code);
  }

  // ---- simulated quote -------------------------------------------------------------------------------
  // PRICE IMPACT WHERE THE LEDGER CANNOT ROUTE (RAZA 2026-09-15: "Price impact is not working"). ripple_path_find answers only
  // for an amount the account holds and a token it trusts, so an over-balance amount, a new token or a signed-out visitor
  // got "—". The pair's AMM pool (constant product, less its trading fee) and its order book are read directly and the
  // amount is filled in small steps from whichever pays more; impact is the fill against the best rate at the start.
  // ONE IMPLEMENTATION, IN xrpl-core.js. This arithmetic -- the pair's AMM pool and order book, filled
  // in small steps from whichever pays more -- is now window.lxx.simulateSwap, because the bridge needs
  // the same answer for the same reason and this file's own note already says a second copy would just
  // relearn everything. The behaviour here is unchanged; only its address is.
  function simulate(s, amt) {
    var buying = s.pay.currency === 'XRP';
    var t = buying ? s.get : s.pay;
    if (!window.lxx || !window.lxx.simulateSwap) return Promise.resolve(null);
    return window.lxx.simulateSwap(rpc, {
      buying: buying, amount: amt, token: { currency: t.currency, issuer: t.issuer },
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
      // This branch RETURNS, so without the call here a swap into a token the account does not yet
      // hold would never reach the coverage check below — and buying a new token is one of the
      // likelier ways to spend a balance an open order was counting on.
      sayCoverage(p, amt);
      return;
    }
    // AN ESTIMATE STRAIGHT AWAY (RAZA 2026-09-15: "Its taking forever to calculate you receive"). The ledger's route
    // lookup takes seconds on a public node; until it answers, the page's own price fills "You receive", and the
    // routed quote replaces it the moment it lands. Swapping waits for the route while one is still being found.
    if (d && d.price > 0 && !(quote && !quote.est && quote.amt === amt && quote.side === side(p))) {
      applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
    }
    inflight = my;
    // THE EDGE ANSWERS THIS IN ~1.6s; THE NODE THIS PAGE CAN REACH TAKES ~29s.
    //
    // RAZA 2026-10-18: "In Trade-asset swaps sometimes it takes too much time in finding the best
    // routes." The deadline on ripple_path_find here is 12s (see rpc's own limit), so against
    // xrplcluster the lookup could not finish even once — the button sat on "Finding the best
    // route…" and then fell through to the catch below, which prices the swap at the page's own rate
    // and simulates. A correct-looking panel, built from the fallback, every single time.
    //
    // lxx.pathFind sends it to /lxapi/xrplpath, which asks Ripple's own node from the edge. The
    // second argument is this exact call, unchanged, as the fallback — so if the endpoint is absent
    // or unhappy the behaviour is bit-for-bit what shipped before. See [[xrpl-pathfind-direction-asymmetry]].
    var PF = {
      source_account: me, destination_account: me,
      destination_amount: s.get.currency === 'XRP' ? '-1' : { currency: s.get.currency, issuer: s.get.issuer, value: '-1' },
      send_max: amountObj(s.pay, amt), ledger_index: 'validated'
    };
    window.lxx.pathFind(PF, function () { return rpc('ripple_path_find', PF); }).then(function (r) {
      if (my !== seq) return;
      inflight = 0;
      var alt = (r.alternatives || [])[0];
      if (!alt) { simQuote(p, s, amt, my); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      var g = alt.destination_amount;
      var out = typeof g === 'string' ? Number(g) / 1e6 : Number(g.value);
      if (!(out > 0)) { clearQuote(p); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      applyQuote(p, amt, out, alt.paths_computed && alt.paths_computed.length ? alt.paths_computed : null);
      say(p, '');
      sayCoverage(p, amt);
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
    // The button stays pressable, but the order is refused with the same sentence already on screen.
    // This pane has no disabled state of its own, so refusing here is its equivalent of the
    // data-lxdis Stellar sets on its CTA.
    if (quote.unfillable) return SAT_MSG;
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
  // THE COUNT IN HERE IS WRITTEN TO THE LEDGER, so it gets the real total rather than a fixed 3. It
  // said "transaction 1 of 3. The platform fee and the swap follow." on every trust line, including
  // the ones where neither was true: a Batch-capable wallet signs the fee and the swap together, and
  // a swap with no fee to charge never has a fee prompt at all. Both are 2, and this memo is permanent.
  function lineMemo(code, total, feeSeparate, oneSig) {
    var tail = feeSeparate ? 'The platform fee and the swap follow.'
      : (oneSig ? 'The swap and its platform fee follow as one transaction.' : 'The swap follows.');
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore: trust line for ' + code + ', required before this account can receive it '
          + '- transaction 1 of ' + total + '. ' + tail)
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
    // HOW MANY SIGNATURES THIS ACTUALLY TAKES. This used to be "3 if a trust line is needed, else 2",
    // which was true when the fee was always its own prompt. It is not true now, in two ways: a
    // Batch-capable wallet signs the fee and the swap as ONE transaction, and a swap with no fee to
    // charge has no fee prompt at all. Either way a trust-line swap is 2, not 3, and the button, the
    // memo and the later labels all read this one number so they cannot disagree.
    //
    // feeRate() rather than feeInXrp(), because the fee amount needs the post-trust-line quote, which
    // does not exist yet -- the line is signed and confirmed BEFORE the route is asked for again. What
    // is being decided here is only WHETHER there is a fee prompt, and that is the rate. sendSwap
    // recomputes the total exactly once the real figure is in hand, and corrects this if it has to.
    var willFee = feeRate() > 0;
    var oneSig = willFee && !!(window.lxb && window.lxb.capable());
    var steps = (needLine ? 1 : 0) + (oneSig ? 1 : (willFee ? 2 : 1));
    p.setAttribute('data-lxsteps', String(steps));
    p.setAttribute('data-lxline', needLine ? '1' : '0');

    var step = Promise.resolve();
    if (needLine) {
      step = rpc('server_info', {}).then(function (si) {
        var inc = Number((((si || {}).info || {}).validated_ledger || {}).reserve_inc_xrp) || 0.2;
        if (s.pay.currency === 'XRP' && amt * (1 + feeRate()) + inc + 0.0001 > acct.spend + 1e-9) {
          throw new Error('Not enough XRP — holding ' + s.get.code + ' reserves ' + inc + ' XRP on top of this swap.');
        }
        // THE TRUST LINE EXPLAINS ITSELF TOO (RAZA 2026-09-17, on the fee memo). This is the one prompt of the three with
        // nothing on it but "TrustSet, limit 1000000000" — the least recognisable transaction in the whole product.
        if (b) b.textContent = 'Approve the ' + s.get.code + ' trust line (1 of ' + steps + ')…';
        return window.lxc.submit({
          TransactionType: 'TrustSet', Account: me,
          LimitAmount: { currency: s.get.currency, issuer: s.get.issuer, value: '1000000000' },
          Memos: [lineMemo(s.get.code, steps, willFee && !oneSig, oneSig)]
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
    // A FEE THAT ROUNDS TO NOTHING IS NOT A FEE. NO BACKTICKS IN THIS COMMENT.
    //
    // Same defect the dashboard Custom Swap had (RAZA 2026-10-20, 0.976727 LUMOS for 0.00003 XRP):
    // feeXrp is XRP, the ledger is paid in DROPS, and toDrops ROUNDS. 0.2% of a dust output is well
    // under one drop, so toDrops returns "0" while feeXrp > 0 is still true -- and every test below
    // asked the XRP question, so the skip never fired and a zero-drop Payment went to the wallet.
    // Decide once, in drops, and let every branch read the same answer.
    var feeD = null;
    if (feeXrp > 0) { var _d = lxx().toDrops(feeXrp); if (_d && +_d > 0) feeD = _d; }
    // THE EXACT COUNT, now that the fee amount is a real number rather than a rate. doSwap had to
    // guess from feeRate() alone to label the trust line, which it signs before this quote exists; the
    // same arithmetic repeated here with feeXrp settles it, and the attribute is corrected so the fee
    // and swap labels below cannot inherit a stale guess. The conditions are deliberately the same
    // expressions the branches themselves use -- a count derived differently from the code it
    // describes is how the "(2 of 2)" on a single prompt survived in the first place.
    var willBatch = !!feeD && !!(window.lxb && window.lxb.capable());
    var steps = (p.getAttribute('data-lxline') === '1' ? 1 : 0)
      + (willBatch ? 1 : (feeD ? 2 : 1));
    p.setAttribute('data-lxsteps', String(steps));
    // One signature needs no counter: Stellar's button has said "Confirm in wallet…" all along, and
    // "(1 of 1)" counts to one, which makes a lone prompt look like the start of a sequence.
    function promptLabel() {
      return steps <= 1 ? 'Confirm in wallet…' : ('Approve the swap (' + steps + ' of ' + steps + ')…');
    }
    // Set when the fee and the swap go out as ONE signed Batch, because that changes what is true
    // after a failure: all-or-nothing means a failed swap cannot have left the fee paid.
    var batched = false;
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
      // ONE CONFIRMATION WHERE THE WALLET CAN CARRY IT. The fee and the swap are two writes from the
      // same account, so XLS-56 sends them as a single signature under tfAllOrNothing. That also
      // retires the risk the fee-first ordering knowingly took on (RAZA 2026-09-17): a fee can no
      // longer be paid for a swap that then fails, because either both apply or neither does.
      //
      // Xaman only, and that is measured rather than assumed. GemWallet RENDERS a Batch -- type,
      // flags and raw JSON all correct -- and then refuses it on submit with "Invalid field
      // TransactionType: Batch", so a wallet showing the dialog proves nothing. lxb.capable() is
      // false for everything that has not landed a Batch on-ledger, and those wallets fall through to
      // the two-signature flow below, unchanged.
      //
      // THE TRUST LINE IS DELIBERATELY NOT IN HERE. It is submitted and confirmed BEFORE the route is
      // refreshed, and both ripple_path_find and the simulate dry run above assume the line already
      // exists -- a delivery into a line the account does not yet hold has no route to quote and
      // nothing to dry-run. Batching it would mean skipping both checks on exactly the swaps that
      // most need them. So a swap needing a line goes 3 prompts -> 2, and one that does not goes
      // 2 -> 1. Folding the line in is possible later; it needs the quote and dry run solved first.
      if (feeD && window.lxb && window.lxb.capable()) {
        batched = true;
        // RAZA 2026-10-14: this said "Approve the swap (1 of 1)…". The counter earned its place when
        // the fee was its own prompt; the Batch on this very line is what retired it. With a trust
        // line signed first it is still honestly 2 of 2, which is why this asks promptLabel() rather
        // than hardcoding either wording.
        if (b) b.textContent = promptLabel();
        return window.lxb.submit(me, [
          { TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
            Amount: feeD,
            Memos: [feeMemo(s.pay.code, s.get.code, 1, 1)] },
          tx
        ]).then(function (h) { return { batchHash: h }; }, function (e) {
          var m = (e && e.message) || '';
          throw new Error(/reject|denied|cancel/i.test(m)
            ? 'The swap was not approved, so nothing was swapped.' : m);
        });
      }
      if (!feeD) return null;
      // Counted against the whole sequence, including the trust line when there was one — "1 of 2" on what is really the
      // second of three prompts is exactly the kind of small lie that makes someone abandon a signature.
      // The fee is always the prompt before the swap, and the swap is always last, so this is
      // steps-1 of steps whether or not a trust line came first.
      var of = steps;
      if (b) b.textContent = 'Approve the platform fee (' + (of - 1) + ' of ' + of + ')…';
      return window.lxc.submit({
        TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
        Amount: feeD,
        Memos: [feeMemo(s.pay.code, s.get.code, of - 1, of)]
      }).then(function (h) { return h; }, function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m) ? 'The platform fee was not approved, so nothing was swapped.' : m);
      });
    }).then(function (prev) {
      // The batched path already submitted BOTH writes in one transaction; asking for the swap again
      // here would sign and send it a second time.
      if (prev && prev.batchHash) return prev.batchHash;
      // The swap is always the last prompt, so it is steps of steps -- and when it is the only one,
      // promptLabel() drops the counter entirely. This used to read the old 3-or-2 attribute and so
      // announced "(2 of 2)" on a swap that was the single signature being asked for.
      if (b) b.textContent = promptLabel();
      return window.lxc.submit(tx);
    }).then(function (hash) {
      if (b) b.textContent = 'Confirming…';
      return waitValidated(hash);
    }).then(function (res) {
      if (!res.ok) {
        if (res.code === 'tecPATH_PARTIAL') setTimeout(requote, 50);
        var why = res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
          : (CODES[res.code] || ('The ledger did not accept the swap (' + res.code + ').'));
        // Said out loud, because the fee has already left the account by this point -- UNLESS the two
        // went out as one all-or-nothing Batch, where a failed swap means the fee was never taken.
        // Telling someone they have paid a fee they still hold is its own kind of wrong.
        stop((feeD && !batched) ? (why + ' The platform fee was already paid.') : why, 'bad');
        return;
      }
      stop('Swap complete ✓', 'good');
      // THE CONFIRMATION LANDS WHERE STELLAR'S DOES (RAZA 2026-10-06: "When buying / selling asset on
      // Trade-asset page, its not showing the message at the bottom like it does on Stellar").
      //
      // lumoscore.com's dxToast answers a filled swap with "✓ Sold 1.1541 XLM" bottom-centre, and its
      // wording is (side === "buy" ? "Bought " : "Sold ") + the amount RECEIVED + the asset received.
      // On this build `quote.out` is that amount and sides(p).get is that asset, so the same sentence
      // comes out of the same two facts.
      //
      // The inline line under the button stays as well. On this page it sits beside the CTA rather than
      // below the fold, so unlike the pool card there is nothing to move — this adds the half that was
      // missing, at the place the eye goes after a wallet sheet closes.
      try {
        if (typeof window.lxToast === 'function' && quote && quote.out > 0) {
          // THE VERB AND THE AMOUNT HAVE TO BE ABOUT THE SAME ASSET.
          //
          // RAZA 2026-10-19, from the Stellar side but the same line exists here: selling USDC for
          // XLM toasted "Sold 5.6089 XLM" — 5.6089 XLM is what was RECEIVED, so the toast said the
          // user sold the thing they just bought. `s.get` is literally "what you get"; pairing it
          // with "Sold" could only ever be wrong on a sell.
          //
          // Both branches now name the asset whose page this is, which is also what the button above
          // says ("Bought USDC ✓" / "Sold USDC ✓"): on a buy that is what arrived, on a sell it is
          // what went out. The two lines can no longer disagree about which side they describe.
          window.lxToast(side(p) === 'buy'
            ? ('Bought ' + fmt(quote.out, 6) + ' ' + s.get.code)
            : ('Sold ' + fmt(quote.amt, 6) + ' ' + s.pay.code));
        }
      } catch (e) {}
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
