// Trade-Asset → Limit: real limit orders on the XRP Ledger.
//
// WHAT A LIMIT ORDER IS HERE. One OfferCreate against the XRP order book for this token — the same
// book the Orderbook tab reads. The creator SELLS TakerGets and BUYS TakerPays (xrpl.org, OfferCreate):
//   Buy  CODE  →  TakerPays = the token amount, TakerGets = amount × price in XRP drops, no flags.
//   Sell CODE  →  TakerGets = the token amount, TakerPays = amount × price in drops, tfSell, so the
//                 whole amount sells even when better bids would reach the XRP total sooner.
// That is Stellar's manageBuyOffer / manageSellOffer. The amounts come from lxx.offerFor in
// xrpl-core, where they are under test.
//
// NO PLATFORM FEE. RAZA, 2026-08-19: no fee on limit orders — a resting order may never fill, and the
// Stellar build places the offer on its own. So this is exactly one transaction. The "Trading fee
// 0.2%" row that the inherited lx-feemodal appends to every trade summary is hidden in this pane,
// because it describes a charge this order does not make.
//
// WHAT THE LEDGER CHECKS, AND WHAT IS CHECKED HERE FIRST (xrpl.org, Offers):
//   * an offer cannot be placed for something you do not hold (tecUNFUNDED_OFFER) — the token's own
//     issuer is the documented exception, and is treated as one;
//   * every offer that stays on the book takes one owner-reserve increment (tecINSUF_RESERVE_OFFER);
//   * buying a token with no trust line is allowed — the ledger creates the line when the offer
//     fills — but that line needs its own increment, so a buy without one is checked for both.
// Reserves come from server_info, never a constant. The ledger stays the authority: a pre-check that
// passes can still be refused, and the result code is translated below rather than shown raw.
//
// NO REVIEW POPUP. RAZA's rule is no new popups; lx-feemodal already lets limit clicks through; and
// the wallet's own approval screen is the confirmation — the same call mint.js made. Progress and
// results go in one status line under the button.
//
// BOTH LAYOUTS FROM ONE CODE PATH. lx-mobtrade (inherited) copies the desktop class names onto the
// phone's elements, but only on its own 900ms cadence, so selectors here are substring matches
// (`[class*="dxa-…"]`) that find either spelling whether or not that copy has happened yet.
//
// THE PHONE'S CHIPS ARE DRAWN BY CSS. lx-mobtrade labels them `data-lxmt-code="XLM"` and paints an
// XLM logo through ::after / ::before, rewriting both every 900ms — text that no text scan sees.
// Rewriting that attribute would be a two-timer race, so the right label goes in an attribute
// lx-mobtrade never touches (`data-lxxc`) and a more specific rule prefers it.
//
// SIGNING goes through window.lxc.submit, which today means GemWallet and refuses clearly otherwise.
(function () {
  if (window.__lxxLimit) return;
  window.__lxxLimit = 1;

  var RPC = 'https://xrplcluster.com/';
  // xrpl.to's fixed id for XRP — the one token whose logo id is not derived from an issuer.
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function lxx() { return window.lxx; }

  // LumosCore's mark on a limit order. Orders are free — no platform fee — so like the pool
  // operations this is the only thing tying one to this site. See the note in createpool.js.
  function lxMemo(text) {
    var hex = function (s) { var h = ''; for (var i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0'); return h.toUpperCase(); };
    return { Memo: { MemoType: hex('LumosCore'), MemoFormat: hex('text/plain'), MemoData: hex(text) } };
  }
  function asset() { return window.__lxxAssetRef || null; }
  function addr() {
    try { return window.lxc && window.lxc.address ? window.lxc.address() : null; } catch (e) { return null; }
  }
  function currencyOf(code) { try { return lxx().encodeCurrency(code); } catch (e) { return code; } }

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
    }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  // ---- the pane ----------------------------------------------------------------------------------
  function pane() { return $('[class*="dxa-pane-limit"]'); }
  function isPhone(p) { return /(^|\s)mdxa-pane-limit(\s|$)/.test(p.className); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  function side(p) {
    var b = $('[class*="dxa-side-btn"].active', p);
    return b && b.classList.contains('sell') ? 'sell' : 'buy';
  }

  // The leading number and nothing after it. Deleting invalid characters wherever they appear turns a
  // mis-aimed paste into a different, plausible price — Stellar's limit field did exactly that
  // ("0.001 GBNZ…" became 0.00147). Stopping at the first stray character keeps what was typed.
  function numOnly(v) {
    v = String(v == null ? '' : v).split(',').join('.');
    var out = '', dot = false;
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c >= '0' && c <= '9') { out += c; continue; }
      if (c === '.' && !dot) { dot = true; out += c; continue; }
      if (out === '' && (c === ' ' || c === '\t')) continue;
      break;
    }
    return out;
  }
  function num(v) { var s = numOnly(v); return (s === '' || s === '.') ? NaN : Number(s); }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a > 0 && a < 1e-6) return Number(n).toPrecision(3);
    var d = dp != null ? dp : (a >= 1000 ? 2 : a >= 1 ? 4 : 7);
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  // THE SITE'S OWN QUANTITY FORMATTER, ported from Stellar's _dexassetdata.js so the two builds print
  // the same figure the same way (RAZA 2026-10-08: "yes make them identical"). It abbreviates above a
  // thousand (258800 -> 258.8K) and compresses the leading-zero run below a thousandth into a
  // subscript count (0.0000253 -> 0.0₄253), which shortens without dropping a digit — the convention
  // every exchange uses. Between those it spells the number out, cutting at three decimals and marking
  // the cut with two dots so a truncated figure cannot be read as an exact one; an exact 0.5 stays
  // "0.5". The threshold for the subscript form is FIVE zeros, not four: 0.000324 already fits, and
  // compressing something readable only makes it harder to read.
  //
  // Kept byte-for-byte equivalent to Stellar's chain (SUBD/zsub/trimZ/smallNum/abbrNum/qtyTxt) rather
  // than re-derived, because "identical" is the whole requirement. SUBD is built with fromCharCode for
  // the same reason the rest of this file avoids exotic literals — it is injected verbatim at build.
  var SUBD = String.fromCharCode(8320, 8321, 8322, 8323, 8324, 8325, 8326, 8327, 8328, 8329);
  function zsub(n) { var s = String(n), o = ''; for (var i = 0; i < s.length; i++) o += SUBD.charAt(+s.charAt(i)); return o; }
  function trimZ(t) {
    while (t.length > 1 && t.charAt(t.length - 1) === '0') t = t.slice(0, -1);
    if (t.charAt(t.length - 1) === '.') t = t.slice(0, -1);
    return t;
  }
  function smallNum(x, sig) {
    x = +x || 0; if (!(x > 0)) return '0';
    var e = x.toExponential((sig || 4) - 1), i = e.indexOf('e');
    if (i < 0) return String(x);
    var mant = trimZ(e.slice(0, i)).split('.').join(''), exp = -parseInt(e.slice(i + 1), 10);
    if (exp >= 5) return '0.0' + zsub(exp - 1) + mant;
    if (x >= 1e-8) return trimZ(x.toFixed(8));
    if (!(exp > 1)) return trimZ(x.toFixed(8));
    return '0.0' + zsub(exp - 1) + mant;
  }
  function abbrNum(n) {
    n = +n || 0; var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function qtyTxt(n) {
    n = +n || 0; var a = Math.abs(n);
    if (a >= 1000) return abbrNum(n);
    if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (a === 0) return '0';
    if (a >= 0.001) { var t = n.toFixed(3); return (Math.abs((+t) - n) < 1e-12) ? String(+t) : (t + '..'); }
    return (n < 0 ? '-' : '') + smallNum(Math.abs(n), 4);
  }

  // An input value: plain digits with no grouping commas, so it parses back to the same number.
  function plainNum(n) {
    if (!isFinite(n) || n <= 0) return '';
    return (lxx() && lxx().iouValue && lxx().iouValue(Number(Number(n).toPrecision(12)))) || '';
  }
  // Floored when offering "all of it": a MAX that rounds up asks for more than the account holds.
  function floorTo(n, dp) { var m = Math.pow(10, dp); return Math.floor(n * m) / m; }

  // ---- painting ----------------------------------------------------------------------------------
  // Text for the desktop chip; attribute and logo for the phone's CSS-drawn one (see header).
  // data-logoed keeps the logo healer — which repaints any small element holding 1–5 characters — off
  // a three-letter ticker.
  function chip(f, code, logo) {
    var c = f && $('[class*="dxa-trade-asset"]', f);
    if (!c) return;
    try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); } catch (e) {}
    if (c.getAttribute('data-lxxc') !== code) c.setAttribute('data-lxxc', code);
    var v = logo ? 'url("' + logo + '")' : 'none';
    if (c.style.getPropertyValue('--lxx-logo') !== v) c.style.setProperty('--lxx-logo', v);
    if (/(^|\s)mdxa-/.test(c.className)) {
      c.style.background = '';
      if (c.textContent !== code) c.textContent = code;
      return;
    }
    // DESKTOP: THE MARK ALONE, as lumoscore.com's Limit tab draws it — a logo disc with no ticker beside
    // it (RAZA 2026-09-15: "the assets logos and other details are missing"). The ticker stays on the
    // element as its title and data-lxic, which is where Stellar keeps it.
    if (c.textContent !== '') c.textContent = '';
    c.setAttribute('data-lxic', code);
    c.title = code;
    // THE MARK GOES IN --lxtic, NOT background (RAZA 2026-09-15: "still not showing the logos"). The
    // inherited sheet — Stellar's own limit-chip rules — sets background-image:none!important on this chip
    // and paints the logo from a ::before reading var(--lxtic). An inline background drew nothing, which
    // is why the chips were empty rings.
    var tic = logo ? ('url("' + logo + '")') : '';
    if (c.getAttribute('data-lxtic') !== tic) {
      if (tic) c.style.setProperty('--lxtic', tic); else c.style.removeProperty('--lxtic');
      c.setAttribute('data-lxtic', tic);
    }
    if (c.hasAttribute('data-lxbg')) { c.style.background = ''; c.style.boxShadow = ''; c.removeAttribute('data-lxbg'); }
  }

  function mono(f, text) {
    var row = f && $('[class*="dxa-trade-frow"]', f);
    var m = row && $('.mono', row);
    if (m && m.textContent !== text) m.textContent = text;
    // `.dxa-trade-frow .mono:not(.lxp)` is hidden by the inherited sheet until a data layer claims it.
    if (m) m.classList.add('lxp');
  }

  // Stellar's MAX, on whichever field holds the asset being SPENT. Its CSS (.lxlim-max) is already in
  // the inherited stylesheet, so this adds no styling of its own.
  function maxButton(f, on) {
    var row = f && $('[class*="dxa-trade-frow"]', f);
    if (!row) return;
    var b = $('.lxlim-max', row);
    if (!on) { if (b && b.parentNode) b.parentNode.removeChild(b); return; }
    if (b) return;
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'lxlim-max';
    b.textContent = 'MAX';
    row.insertBefore(b, $('.lx-ltusd', row));               // MAX, then the dollar figure, as on Stellar
  }

  function sumRow(p, label, value) {
    $$('[class*="tsum"]', p).forEach(function (r) {
      var k = r.children;
      if (k.length < 2) return;
      if ((k[0].textContent || '').trim().toLowerCase() !== label) return;
      var v = k[k.length - 1];
      if (v.textContent !== value) v.textContent = value;
      v.classList.add('lxp');                              // same value gate as the field rows
    });
  }

  function say(p, text, tone) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxx-limit-note', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxx-limit-note';
      n.setAttribute('role', 'status');
      b.parentNode.insertBefore(n, b.nextSibling);
    }
    n.textContent = text || '';
    n.setAttribute('data-tone', tone || '');
    n.style.display = text ? '' : 'none';
  }

  function css() {
    if (document.getElementById('lxx-limit-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-limit-css';
    st.textContent =
      // The inherited fee row describes a charge a limit order does not make.
      '[class*="dxa-pane-limit"] .lx-feerow{display:none!important}'
      // AND NEITHER DOES THE DISCOUNT BANNER OR THE TIER PROMPT (RAZA 2026-11-06: "an extra LUMOS
      // fee discount banner is rendered above the submit button ... no promo banner is present" on
      // Stellar). lx-feemodal appends "50% off trading fees - hold 250,000 LUMOS" (.lx-feebanner-wrap)
      // and lx-feetier appends "Hold 250,000 LUMOS to lower your fee to 0.1%" to every trade
      // summary. The fee row above was hidden here for exactly this reason and these two were
      // missed -- a discount off a fee of zero is not a smaller number, it is a sentence about a
      // charge this pane does not make. Stellar removed all three at once in _limitfree.js; this is
      // the same removal, one layer later.
      //
      // SCOPED TO THE LIMIT PANE, like the row above. The SWAP pane on this same page does charge,
      // so its banner and tier prompt are correct and must stay -- an unscoped rule would strip the
      // discount offer off the one pane where it is true.
      + '[class*="dxa-pane-limit"] .lx-feebanner-wrap{display:none!important}'
      + '[class*="dxa-pane-limit"] .lx-feetier{display:none!important}'
      // THE DIMMED CTA, DRAWN THE WAY THE SWAP PANE LEARNED TO DRAW IT. Copied deliberately from
      // dxaswap.js's disStyle(): the design's widget writes `opacity:1!important; cursor:pointer
      // !important` INLINE on this button, and an inline important declaration outranks every
      // stylesheet -- so a rule naming opacity or cursor can never apply. `filter` is the one
      // channel the widget leaves alone, and filter's opacity() function reproduces Stellar's .55
      // dimmed ORANGE rather than a flat grey.
      //
      // Written into this layer rather than reusing dxaswap's #lx-dxadis sheet, because that sheet
      // is injected lazily by its setDis() -- it may not exist yet when someone opens the Limit tab
      // first. Scoped to the limit pane so it is strictly additive to the swap pane's own rule.
      + '[class*="dxa-pane-limit"][data-lxunfill="1"] [class*="dxa-trade-cta"]{filter:grayscale(.25) opacity(.55)!important}'
      // The phone's chips: prefer our label and logo over lx-mobtrade's XLM.
      + '.mdxa-trade-asset.lxmt-chip[data-lxxc]::after{content:attr(data-lxxc)!important}'
      + '.mdxa-trade-asset.lxmt-chip[data-lxxc]::before{background-image:var(--lxx-logo,none)!important}'
      + '.lxx-limit-note{margin:8px 2px 0;font-size:13px;line-height:1.5;text-align:center;opacity:.85}'
      + '.lxx-limit-note[data-tone="bad"]{color:var(--down,#ef4444);opacity:1}'
      + '.lxx-limit-note[data-tone="good"]{color:var(--up,#16a34a);opacity:1}'
      // A third tone, for a caution that is NOT a refusal: a swap that would leave an open order
      // short of what it promised still goes ahead, because this ledger reserves nothing behind an
      // offer (xrpl-core.js, offerCommitments). The rule lives here because this is the stylesheet
      // behind the shared note class, which dxaswap.js writes into as well as this file.
      //
      // TWO RULES, BECAUSE --yellow IS NOT DEFINED ON THIS PAGE. The design's caution colour is
      // #d97706 light / #ffb547 dark, but measured on the built trade-asset page the variable
      // resolves to nothing at all — so a single `var(--yellow,#d97706)` painted the LIGHT amber on
      // a #0a0a0b ground. The dark rule gives that theme its own fallback; where --yellow does exist
      // it still wins in both, so this costs nothing on the pages that define it.
      + '.lxx-limit-note[data-tone="warn"]{color:var(--yellow,#d97706);opacity:1}'
      + 'html[data-theme="dark"] .lxx-limit-note[data-tone="warn"]{color:var(--yellow,#ffb547)}';
    document.head.appendChild(st);
  }

  // ---- the connected account ---------------------------------------------------------------------
  var acct = { key: null };

  function load(force) {
    var a = asset(), who = addr();
    if (!a || !who) { acct = { key: null }; paint(); return Promise.resolve(acct); }
    var key = who + '|' + a.issuer + '|' + a.code;
    if (!force && acct.key === key && (acct.loading || Date.now() - (acct.at || 0) < 20000)) {
      return acct.loading || Promise.resolve(acct);
    }
    var cur = currencyOf(a.code);
    var job = Promise.all([
      rpc('account_info', { account: who, ledger_index: 'validated' }).catch(function (e) {
        // An account that has never received XRP does not exist yet. An answer, not an outage.
        if (/actNotFound|not found/i.test(String(e && e.message))) return null;
        throw e;
      }),
      rpc('server_info', {}),
      lxx().allLines(rpc, who, { peer: a.issuer })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var vl = ((r[1] || {}).info || {}).validated_ledger || {};
      var reserve = { base: Number(vl.reserve_base_xrp), inc: Number(vl.reserve_inc_xrp) };
      var s = info ? lxx().spendableXrp(info.Balance, info.OwnerCount, reserve) : null;
      var line = ((r[2] && r[2].lines) || []).filter(function (l) {
        return l.currency === cur && l.account === a.issuer;
      })[0];
      acct = {
        key: key, at: Date.now(), found: !!info,
        spend: s ? s.spendable : null,
        inc: isFinite(reserve.inc) ? reserve.inc : null,
        line: !!line, bal: line ? Math.max(0, Number(line.balance)) : 0,
        issuer: who === a.issuer
      };
      paint();
      return acct;
    }).catch(function () {
      acct = { key: key, at: 0, failed: true };
      paint();
      return acct;
    });
    acct = { key: key, loading: job };
    return job;
  }

  function paint() {
    var p = pane(), a = asset();
    if (!p || !a) return;
    var f = fields(p);
    if (f.length < 2) return;
    var s = side(p);
    var tokLogo = '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(a.code)) + '&w=48';

    chip(f[0], 'XRP', XRP_LOGO);
    chip(f[1], a.code, tokLogo);
    if (f[2]) chip(f[2], 'XRP', XRP_LOGO);

    // Stellar parity: the price field carries no "Market:" label. The design's was "Market: 4.22711".
    mono(f[0], '');

    // "Avail" and MAX sit on the asset being SPENT: the token when selling, XRP (the Total) when buying.
    var spendF = s === 'sell' ? f[1] : (f[2] || f[1]);
    var otherF = s === 'sell' ? f[2] : f[1];
    if (otherF && otherF !== spendF) { mono(otherF, ''); maxButton(otherF, false); }

    var who = addr(), text = '', canMax = false;
    if (who) {
      if (acct.loading || acct.key == null || acct.failed) text = 'Avail: —';
      else if (s === 'sell') {
        if (acct.issuer) text = '';
        else { text = 'Avail: ' + fmt(floorTo(acct.bal, 6)) + ' ' + a.code; canMax = acct.bal > 0; }
      } else if (acct.spend != null) {
        text = 'Avail: ' + fmt(floorTo(Math.max(0, acct.spend), 2), 2) + ' XRP';
        canMax = acct.spend > 0;
      } else text = 'Avail: —';
    }
    mono(spendF, text);
    maxButton(spendF, canMax);

    // Total is editable on desktop, as on Stellar; lx-mobtrade keeps the phone's read-only and that is
    // left alone rather than fought.
    var tot = input(f[2]);
    if (tot && !isPhone(p) && tot.hasAttribute('readonly')) tot.removeAttribute('readonly');
    recalc(p);
  }

  // THE BUTTON SAYS WHICH ORDER IT WILL PLACE, AND GOES DIM UNTIL IT CAN PLACE ONE.
  //
  // RAZA 2026-11-06: on XRPL "the bottom CTA button displays static text ('Place Limit Order') with
  // active orange styling when form fields are empty", where on Stellar "the CTA dynamically
  // reflects the action ('Place Buy Order' / 'Place Sell Order') with a disabled dark background
  // when empty". Both halves were absent rather than broken -- this pane never wrote its CTA at
  // all. The swap pane beside it has had both since 2026-10-09 (dxaswap.js swapLabel + setDis); the
  // limit pane was passed over because its inherited label, "Place Limit Order", was not WRONG, and
  // a label that is merely less specific than its neighbour's is easy to keep walking past.
  //
  // MATCHED ON THE ORDER LABELS ONLY, never on a prefix -- the same rule dxaswap.js states for this
  // same element, and for the same reason. The connect gate writes "Connect wallet" here and
  // place() writes a pending label while an offer is in flight; rewriting either would be a worse
  // bug than the one being fixed. Anything that is not one of the three order labels is left alone.
  var ORDER_LABEL = /^Place (Buy|Sell|Limit) Order$/i;
  function ctaState(p, price, amount) {
    var b = cta(p);
    if (!b) return;
    var want = side(p) === 'sell' ? 'Place Sell Order' : 'Place Buy Order';
    var now = (b.textContent || '').trim();
    if (ORDER_LABEL.test(now) && now !== want) b.textContent = want;
    // An order needs BOTH a price and a size; either one missing is nothing to place. place() still
    // answers "Enter a limit price." / "Enter an amount." for anyone who gets past the dimming, so
    // this only withdraws the invitation -- it never becomes the only guard.
    if (price > 0 && amount > 0) p.removeAttribute('data-lxunfill');
    else p.setAttribute('data-lxunfill', '1');
  }

  function recalc(p) {
    var f = fields(p);
    if (f.length < 2) return;
    var price = num(input(f[0]) && input(f[0]).value);
    var amount = num(input(f[1]) && input(f[1]).value);
    var tot = input(f[2]);
    if (tot && document.activeElement !== tot) {
      var v = (price > 0 && amount > 0) ? plainNum(price * amount) : '';
      if (tot.value !== v) tot.value = v;
    }
    var a = asset(), op = side(p) === 'sell' ? '≥' : '≤';
    sumRow(p, 'filled when', price > 0
      ? (isPhone(p) ? (op + ' ' + fmt(price, 8) + ' XRP') : (a.code + '/XRP ' + op + ' ' + fmt(price, 8)))
      : '—');
    // Here rather than in paint(): recalc is the one function every path funnels through -- paint()
    // ends with it, the side-flip handler calls paint() in a setTimeout(0) so this lands AFTER the
    // design's own widget has relabelled the button, and the input listener calls it on every
    // keystroke. One call site therefore covers first render, side flips and typing.
    ctaState(p, price, amount);
    totalUsd(p);
    orderContext(p);
  }

  // "≈ $x USD" after MAX on the Total row, as on lumoscore.com: the total priced at the page's own XRP/USD.
  function totalUsd(p) {
    var f = fields(p);
    if (f.length < 3 || isPhone(p)) return;
    var row = $('[class*="dxa-trade-frow"]', f[2]);
    if (!row) return;
    var el = $('.lx-ltusd', row);
    if (!el) { el = document.createElement('span'); el.className = 'lx-ltusd'; row.appendChild(el); }
    var t = num(input(f[2]) && input(f[2]).value);
    var d = window.__lxxAssetData, u = (d && d.price && d.usd) ? d.usd / d.price : 0;
    var v = (t > 0 && u > 0) ? t * u : 0;
    var txt = v > 0 ? ('≈ $' + (v >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4)) + ' USD') : '';
    if (el.textContent !== txt) el.textContent = txt;
  }

  // ORDER CONTEXT — Stellar's block above Expiry, rebuilt for this book. Everything comes from the live
  // book dexasset.js already reads (window.__lxxBook: price in XRP per token, amount in the token) and the
  // price being typed:
  //   Best bid / ask   the top of each side
  //   Spread           ask minus bid, over the midpoint
  //   Your price       how far from the price that would fill immediately (the ask to buy, the bid to sell)
  //   Ahead of you     what already rests at your price or better on your side — or, if your price crosses,
  //   / Execution      how much of this order the other side can fill right now
  // Stellar's classes (.lx-oc, .lx-oc-t, .lx-oc-r, .lx-oc-ok, .lx-oc-hi) are in the inherited sheet.
  // THE PHONE GETS THIS BLOCK TOO (RAZA 2026-10-08, "fix both"). It used to return early on mobile,
  // which cost phone users the only answer to "will this actually fill?" — the one question a limit
  // order raises. Measured on lumoscore.com at 375px: Stellar renders it inside its mdxa-pane-limit
  // container, so skipping it here was a gap, not a deliberate narrowing. The anchor it inserts
  // before exists in both containers (mdxa-trade-summary / dxa-trade-summary, matched by substring)
  // and the .lx-oc rules are in the mobile build's inherited sheet, both checked before this ran.
  function orderContext(p) {
    var bk = window.__lxxBook;
    var sum = $('[class*="dxa-trade-summary"]', p);
    if (!bk || !sum || !sum.parentNode) return;
    var asks = bk.asks || [], bids = bk.bids || [];
    var host = $('.lx-oc', p);
    if (!asks.length && !bids.length) { if (host) host.style.display = 'none'; return; }
    if (!host) { host = document.createElement('div'); host.className = 'lx-oc'; sum.parentNode.insertBefore(host, sum); }
    host.style.display = '';
    var f = fields(p), a = asset();
    var pr = num(input(f[0]) && input(f[0]).value);
    var want = num(input(f[1]) && input(f[1]).value);
    var bb = bids.length ? bids[0].px : 0, ba = asks.length ? asks[0].px : 0;
    var mid = (bb && ba) ? (bb + ba) / 2 : (bb || ba);
    var spread = (bb && ba && mid) ? ((ba - bb) / mid * 100) : null;
    var s = side(p), ref = s === 'buy' ? ba : bb;
    var away = (pr > 0 && ref) ? ((pr - ref) / ref * 100) : null;
    var awayTxt = away == null ? '—' : (Math.abs(away) < 0.01 ? ('at the ' + (s === 'buy' ? 'ask' : 'bid'))
      : (Math.abs(away).toFixed(2) + '% ' + (away < 0 ? 'below ' : 'above ') + (s === 'buy' ? 'the ask' : 'the bid')));
    var fills = !!(pr > 0 && ref && (s === 'buy' ? pr >= ba : pr <= bb));
    var lbl, val, cls;
    if (!(pr > 0)) { lbl = 'Ahead of you'; val = '—'; cls = ''; }
    else if (fills) {
      var have = 0, src = s === 'buy' ? asks : bids;
      for (var k = 0; k < src.length; k++) {
        if (!(s === 'buy' ? src[k].px <= pr : src[k].px >= pr)) break;
        have += src[k].amt;
      }
      var pf = want > 0 ? Math.min(100, have / want * 100) : 100;
      lbl = 'Execution';
      if (pf >= 99.5) { val = 'fills now'; cls = 'lx-oc-ok'; }
      else { val = (pf < 0.5 ? '<1%' : Math.round(pf) + '%') + ' fills now | ' + Math.max(0, 100 - Math.round(pf)) + '% open order'; cls = 'lx-oc-hi'; }
    } else {
      var list = s === 'buy' ? bids : asks, q = 0, n = 0;
      for (var i = 0; i < list.length; i++) {
        if (!(s === 'buy' ? list[i].px >= pr : list[i].px <= pr)) break;
        q += list[i].amt; n++;
      }
      // A FULL LIST IS A FLOOR, NOT A COUNT. When the queue reaches the end of the depth the ledger
      // returned, everything past it is invisible — so the honest reading is "over X · N+ orders",
      // which is how lumoscore.com words it (measured: "over 258.8K USDC · 200+ orders"). Printing
      // the bare figures states a truncated count as the exact one, understating what is ahead of you.
      var capped = n > 0 && n >= list.length;
      lbl = 'Ahead of you'; cls = n ? 'lx-oc-hi' : 'lx-oc-ok';
      val = n
        ? ((capped ? 'over ' : '') + qtyTxt(q) + ' ' + a.code + ' · ' + n
          + (capped ? '+ orders' : (n === 1 ? ' order' : ' orders')))
        : 'nothing — first in line';
    }
    var P6 = function (v) { return v ? String(+Number(v).toPrecision(6)) : '—'; };
    host.textContent = '';
    var t = document.createElement('div'); t.className = 'lx-oc-t'; t.textContent = 'Order context'; host.appendChild(t);
    function row(k2, v2, c2) {
      var r = document.createElement('div'); r.className = 'lx-oc-r';
      var sp = document.createElement('span'); sp.textContent = k2;
      var b = document.createElement('b'); b.textContent = v2; if (c2) b.className = c2;
      b.setAttribute('data-logoed', '1');
      r.appendChild(sp); r.appendChild(b); host.appendChild(r);
    }
    row('Best bid / ask (XRP)', P6(bb) + ' / ' + P6(ba));
    row('Spread', spread == null ? '—' : spread.toFixed(2) + '%');
    row('Your price', awayTxt, fills ? 'lx-oc-ok' : '');
    row(lbl, val, cls);
  }

  function fromTotal(p) {
    var f = fields(p);
    var price = num(input(f[0]) && input(f[0]).value), total = num(input(f[2]) && input(f[2]).value);
    var ai = input(f[1]);
    if (ai) ai.value = (price > 0 && total > 0) ? plainNum(total / price) : '';
    recalc(p);
  }

  function fillMax(p) {
    var f = fields(p), ai = input(f[1]);
    if (!ai) return;
    var price = num(input(f[0]) && input(f[0]).value), amt = NaN;
    if (side(p) === 'sell') amt = acct.bal;
    else if (price > 0 && acct.spend != null) {
      // Leave room for the reserve the new order takes, and a trust line's too if there is none yet.
      var inc = acct.inc || 0;
      var room = acct.spend - inc - ((acct.line || acct.issuer) ? 0 : inc);
      amt = room > 0 ? room / price : 0;
    }
    ai.value = amt > 0 ? plainNum(floorTo(amt, 6)) : '';
    recalc(p);
  }

  // Once per side, the page's live price — the design ships "4.18" in the phone's box, another chain's
  // price typed in for you. Emptied rather than guessed when there is no price yet.
  function prefill(p) {
    // THE AMOUNT CARRIES A MOCK AS WELL, and nothing was clearing it (RAZA 2026-11-04, reported on
    // Stellar; this pane has it identically). The design ships `value="100"` in the Amount box beside
    // "Available: 1,250 APT", so a fresh Buy opened with a hundred of the token already ordered and a
    // Total computed from it. Sell only looked right because reaching it goes through the side button,
    // which clears the field on the way.
    //
    // ONCE, and before anything can have been typed -- 100 is an ordinary thing to type, so this can
    // never be matched on the value itself. recalc() empties Total, which is computed from it.
    if (!p.__lxxAmtMock) {
      p.__lxxAmtMock = 1;
      var ain = input(fields(p)[1]);
      if (ain) ain.value = '';
    }
    var pin = input(fields(p)[0]);
    if (!pin) return;
    var d = window.__lxxAssetData, px = d && Number(d.price), s = side(p);
    if (p.__lxxPrefilled === s) return;
    if (px > 0 && isFinite(px)) { pin.value = plainNum(Number(px.toPrecision(6))); p.__lxxPrefilled = s; }
    else if (!p.__lxxCleared) { pin.value = ''; p.__lxxCleared = 1; }
  }

  // ---- placing the order -------------------------------------------------------------------------
  var CODES = {
    tecUNFUNDED_OFFER: function (s, a) {
      return s === 'sell' ? ('You do not hold enough ' + a.code + ' for this order.') : 'You do not hold enough XRP for this order.';
    },
    tecINSUF_RESERVE_OFFER: function () { return 'Not enough XRP to cover the reserve a new order needs.'; },
    tecNO_LINE: function (s, a) { return a.code + ' needs its issuer to authorise your trust line before you can trade it.'; },
    tecNO_AUTH: function (s, a) { return a.code + ' needs its issuer to authorise your trust line before you can trade it.'; },
    tecFROZEN: function (s, a) { return a.code + ' is frozen by its issuer, so it cannot be traded.'; },
    tecNO_ISSUER: function (s, a) { return 'The issuer of ' + a.code + ' is not an active account.'; },
    tecDIR_FULL: function () { return 'Your account holds too many ledger objects to add another order.'; },
    tecEXPIRED: function () { return 'The order expired before it reached the ledger.'; },
    tecKILLED: function () { return 'The order could not be filled and was cancelled.'; }
  };
  function explain(code, s, a) {
    var f = CODES[code];
    return f ? f(s, a) : ('The ledger did not accept the order (' + code + ').');
  }

  // `validated: false`, and txnNotFound straight after submitting, both mean "not in a ledger yet".
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    function again() {
      if (n <= 0) return { ok: false, code: 'timeout' };
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return waitValidated(hash, n - 1); });
    }
    return rpc('tx', { transaction: hash, binary: false }).then(function (r) {
      if (r && r.validated) {
        var meta = r.meta || r.metaData || {};
        return { ok: meta.TransactionResult === 'tesSUCCESS', code: meta.TransactionResult, meta: meta };
      }
      return again();
    }, again);
  }

  // Did any of the order stay on the book? A created Offer entry says it did; none means it filled.
  function rested(meta) {
    return ((meta && meta.AffectedNodes) || []).some(function (x) {
      return x.CreatedNode && x.CreatedNode.LedgerEntryType === 'Offer';
    });
  }

  var busy = false;

  function place(p) {
    if (busy) return;
    var a = asset(), who = addr(), b = cta(p);
    if (!a || !who || !b) return;
    var f = fields(p), s = side(p);
    var price = num(input(f[0]) && input(f[0]).value);
    var amount = num(input(f[1]) && input(f[1]).value);
    if (!(price > 0)) { say(p, 'Enter a limit price.', 'bad'); return; }
    if (!(amount > 0)) { say(p, 'Enter an amount.', 'bad'); return; }
    var built = lxx().offerFor(s, { currency: currencyOf(a.code), issuer: a.issuer }, amount, price);
    if (!built) { say(p, 'That order is worth less than one drop of XRP.', 'bad'); return; }

    busy = true;
    var label = b.textContent;
    function stop(text, tone) { busy = false; b.textContent = label; if (text != null) say(p, text, tone); }
    b.textContent = 'Checking balance…';
    say(p, '');

    load(true).then(function (ac) {
      if (ac.failed) return stop('Could not read your balance from the ledger. Try again in a moment.', 'bad');
      if (!ac.found) return stop('This account is not activated yet — it needs some XRP first.', 'bad');
      var inc = ac.inc || 0;
      if (s === 'sell') {
        if (!ac.issuer && amount > ac.bal + 1e-12) {
          return stop(ac.bal > 0
            ? ('Insufficient ' + a.code + ' balance — you have ' + fmt(ac.bal) + '.')
            : ('You do not hold any ' + a.code + ' to sell.'), 'bad');
        }
        if (ac.spend != null && ac.spend < inc) {
          return stop('Not enough XRP for the reserve a new order needs (' + fmt(inc) + ' XRP).', 'bad');
        }
      } else {
        var need = amount * price + inc + ((ac.line || ac.issuer) ? 0 : inc);
        if (ac.spend != null && need > ac.spend + 1e-9) {
          return stop('Not enough XRP for this order — it needs about ' + fmt(need, 4)
            + ' XRP including reserve, and ' + fmt(Math.max(0, ac.spend), 4) + ' is available.', 'bad');
        }
      }

      var tx = { TransactionType: 'OfferCreate', Account: who, TakerGets: built.TakerGets, TakerPays: built.TakerPays,
        Memos: [lxMemo('LumosCore: limit order')] };
      if (built.Flags) tx.Flags = built.Flags;

      b.textContent = 'Confirm in wallet…';
      return window.lxc.submit(tx).then(function (hash) {
        b.textContent = 'Confirming…';
        return waitValidated(hash);
      }).then(function (r) {
        if (!r.ok) {
          return stop(r.code === 'timeout'
            ? 'Submitted, but not confirmed yet — check Open orders in your Wallet before trying again.'
            : explain(r.code, s, a), 'bad');
        }
        var what = fmt(amount) + ' ' + a.code, at = fmt(price, 8) + ' XRP';
        var onBook = rested(r.meta);
        var ai = input(f[1]);
        if (ai) ai.value = '';
        recalc(p);
        b.textContent = onBook ? 'Order placed ✓' : 'Filled ✓';
        say(p, onBook
          ? ((s === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + what + ' at ' + at + '.')
          : ('Filled straight away — ' + what + ' at ' + at + ' or better.'), 'good');
        // The same bottom-centre confirmation the swap pane now draws, for the same reason: it is where
        // the eye goes once the wallet's own sheet closes. An order that RESTED and one that FILLED are
        // different outcomes, so they do not share a sentence — "placed" would be wrong about a fill,
        // and "filled" would be a claim about something that has not happened yet.
        try {
          if (typeof window.lxToast === 'function') {
            window.lxToast(onBook
              ? ((s === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + what)
              : ('Filled ' + what));
          }
        } catch (e) {}
        setTimeout(function () { busy = false; b.textContent = label; }, 1800);
        load(true);
        try { if (window.__lxxBookReload) window.__lxxBookReload(); } catch (e) {}
      });
    }).catch(function (err) {
      stop((err && err.message) || 'The order was not placed.', 'bad');
    });
  }

  // ---- wiring ------------------------------------------------------------------------------------
  function wire() {
    if (window.__lxxLimitWired) return;
    window.__lxxLimitWired = 1;
    css();

    // WINDOW capture, so this runs ahead of the design's own handlers. A disconnected click is left
    // alone: lx-gate and connect.js open the wallet picker for it, and without an account there is
    // nothing to sign with anyway.
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('[class*="dxa-pane-limit"]');
      if (!p) return;

      if (t.closest('.lxlim-max')) { e.preventDefault(); e.stopPropagation(); fillMax(p); return; }

      if (t.closest('[class*="dxa-side-btn"]')) {
        // After the design has flipped .active: start the new side clean, as Stellar does.
        setTimeout(function () {
          p.__lxxPrefilled = null;
          var ai = input(fields(p)[1]);
          if (ai) ai.value = '';
          say(p, '');
          prefill(p);
          paint();
        }, 0);
        return;
      }

      var b = t.closest('[class*="dxa-trade-cta"]');
      if (!b) return;
      if (b.getAttribute('data-lxgate') === '1' || !addr()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      place(p);
    }, true);

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'INPUT' || !t.closest) return;
      var p = t.closest('[class*="dxa-pane-limit"]');
      if (!p) return;
      var clean = numOnly(t.value);
      if (clean !== t.value) {
        var pos = (t.selectionStart || 0) - (t.value.length - clean.length);
        t.value = clean;
        try { t.setSelectionRange(Math.max(0, pos), Math.max(0, pos)); } catch (x) {}
      }
      if (t === input(fields(p)[2])) fromTotal(p); else recalc(p);
      if (!busy) say(p, '');
    }, true);

    try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { load(true); }); } catch (e) {}
    window.addEventListener('storage', function (e) { if (e && /^lumos\./.test(e.key || '')) load(true); });
  }

  // The book reloads after an order is placed and on its own schedule; the context follows it.
  window.addEventListener('lxx:book', function () { var p = pane(); if (p && asset()) recalc(p); });

  function boot() {
    if (!$('#dxaObAsks') && !$('#mdxaObAsks')) return;           // not a Trade-Asset page
    wire();
    var tries = 0;
    (function start() {
      var p = pane();
      if (!p || !asset()) { if (tries++ < 40) setTimeout(start, 250); return; }
      prefill(p);
      paint();
      load(false);
      // The price feed lands after load, so prefill again once it has.
      var n = 0;
      (function waitPrice() {
        if (window.__lxxAssetData) { prefill(p); paint(); return; }
        if (n++ < 40) setTimeout(waitPrice, 300);
      })();
      // lx-mobtrade inserts the phone's Total field on its own cadence. Paint when the pane's direct
      // children change — childList only, never subtree: an observer that reacts to the text it writes
      // is how Stellar's watchLimitModal froze the renderer.
      try { new MutationObserver(function () { paint(); }).observe(p, { childList: true }); } catch (e) {}
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
