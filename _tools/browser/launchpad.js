// Launchpad: the XRP Ledger's rules, costs and currency codes.
//
// WHAT WAS HERE. `lx-lp-js`, 69KB of LIVE STELLAR MAINNET issuance, on a page titled "Launch a
// Token on the XRP Ledger". It pointed at horizon.stellar.org with the public network passphrase,
// generated a Stellar issuer keypair, built changeTrust/setOptions transactions and sent a fee to a
// Stellar G... address. Anyone completing the form would have been asked to fund a Stellar issuer
// and pay a Stellar fee, with real money, to mint an asset on the wrong ledger entirely.
//
// It is stripped. What replaces it here is the part that needs no signing library and no fee
// account: the XRP Ledger's currency-code rules, form validation, and the draft handoff the three
// pages share. The encoder is checked against three codes read off the ledger itself -- LUMOS,
// SHROOMIES and XDawgs -- rather than against its own output.
//
// WHAT THIS DELIBERATELY DOES NOT DO: sign anything. Issuing on the XRP Ledger needs an issuing
// account whose key the page holds at mint time -- the same shape the Stellar launchpad used, where
// the issuer keypair is generated in the browser and funded by the connected wallet. The user's
// wallet cannot sign for the issuer, so that step needs an XRPL signing library which this project
// does not vendor, and a fee-collector address on this ledger, which does not exist yet. Until both
// arrive the final button says so plainly instead of failing at the last step with the user's money
// already committed.
(function () {
  if (window.__lxxLaunch) return;
  window.__lxxLaunch = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // Where launch fees are paid. Substituted at build time from _xrplaunchpad.js, which verifies the
  // full base58 checksum before the build is allowed to proceed -- a typed address is the one case
  // the browser's shape-only check was never meant to cover.
  var FEE_COLLECTOR = '__FEE_COLLECTOR__';

  // ---- XRPL currency codes ---------------------------------------------------------------------
  // A ticker is not free text here. The ledger takes either a 3-character code or a 160-bit hex
  // blob, and the two are not interchangeable: "LUMOS" is not a 3-character code, so it travels as
  // 4C554D4F53 padded to 40 hex characters. Getting this wrong does not error -- it mints a
  // DIFFERENT asset from the one the user typed.
  var STD3 = /^[A-Za-z0-9?!@#$%^&*<>(){}\[\]|]{3}$/;

  function toCurrency(ticker) {
    var t = String(ticker || '').trim();
    if (!t) return { ok: false, why: 'Enter a ticker.' };

    // "XRP" is reserved for the native asset and can never name an issued token.
    if (t.toUpperCase() === 'XRP') {
      return { ok: false, why: 'XRP is the ledger’s own asset and cannot be used as a ticker.' };
    }
    if (STD3.test(t)) return { ok: true, code: t, kind: 'standard' };

    // Anything else becomes hex. The limit is 20 BYTES, not 20 characters: a ticker with an accent
    // or an emoji spends more than one byte per character.
    var bytes = [];
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c > 127) return { ok: false, why: 'Use letters, digits and basic punctuation only.' };
      bytes.push(c);
    }
    if (bytes.length > 20) return { ok: false, why: 'Ticker is longer than 20 characters.' };

    var hex = '';
    for (var j = 0; j < bytes.length; j++) {
      hex += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16).toUpperCase();
    }
    while (hex.length < 40) hex += '0';
    return { ok: true, code: hex, kind: 'hex' };
  }

  // ---- costs -----------------------------------------------------------------------------------
  // THE PAGE QUOTED THE COST IN THE WRONG CURRENCY, roughly tenfold. The design's own script says:
  //
  //     const BASE_CREATION_APT = 34.70;
  //     // USD/XRP rate derived from displayed defaults (173.50 XRP ≈ $25 → ~$0.1441 per XRP)
  //
  // $0.1441 is XLM's rate wearing XRP's name, so the page offered "34.70 XRP ≈ $5" when 34.70 XRP
  // is about $49. The USD figures are the real contract and are unchanged; what needed fixing is
  // the XRP a payer actually sends, which is now derived from the live rate.
  var USD = { create: 5, liq: 10, pool: 10 };
  var COST_EL = { costCreation: 'create', costLiquidity: 'liq', costNetwork: 'pool' };

  var xrpUsd = null;

  function fmtXrp(v) {
    return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' XRP';
  }

  // Write only when the value is actually wrong.
  //
  // A `writing = true` flag around the paint DOES NOT WORK here, and the first version of this
  // hung the page. MutationObserver delivers its callback asynchronously, as a microtask after the
  // synchronous block finishes -- by which time the flag has already been reset to false. So every
  // write re-entered the observer, which wrote again, forever.
  //
  // Comparing against the DOM instead is self-limiting: the second pass finds the text already
  // correct, writes nothing, and mutates nothing, so the loop cannot continue. It also means the
  // observer only ever undoes the design's repaint, never its own.
  function setCost(id, xrp, usdOverride) {
    var el = document.getElementById(id);
    if (!el) return;
    var want = fmtXrp(xrp);
    var usdSpan = el.querySelector('.usd');
    var wantUsd = usdOverride == null ? null : ('≈ $' + Math.round(usdOverride).toLocaleString('en-US'));

    var have = (el.textContent || '').replace(usdSpan ? (usdSpan.textContent || '') : '', '').trim();
    var haveUsd = usdSpan ? (usdSpan.textContent || '').trim() : null;
    // Already right: touching it would mutate, re-enter the observer, and loop.
    if (have === want && (wantUsd == null || haveUsd === wantUsd)) return;

    if (usdSpan && wantUsd != null) usdSpan.textContent = wantUsd;
    el.textContent = want + ' ';
    if (usdSpan) el.appendChild(usdSpan);
  }

  function paintCosts() {
    if (!xrpUsd || !(xrpUsd > 0)) return;     // no rate: leave the design's text rather than guess

    var baseUsd = 0;
    Object.keys(COST_EL).forEach(function (id) {
      var usd = USD[COST_EL[id]];
      baseUsd += usd;
      setCost(id, usd / xrpUsd);
    });

    // THE TOTAL ALSO CARRIES WHATEVER EXTRA LIQUIDITY THE USER ADDS, and that field is denominated
    // in XRP, not USD. The design added it at its own $0.1441 rate, so seeding 50 XRP -- about $71 --
    // moved the total by $7 and left the row reading "17.6 XRP ≈ $32", which is not even
    // self-consistent. Both halves of this row are written here for that reason.
    var extraEl = document.getElementById('extraLiquidity');
    var extra = extraEl ? Number(String(extraEl.value || '').replace(/[, ]/g, '')) : 0;
    if (!isFinite(extra) || extra < 0) extra = 0;

    var totalXrp = baseUsd / xrpUsd + extra;
    setCost('costTotal', totalXrp, totalXrp * xrpUsd);
  }

  // The design's recalcCost() lives inside an IIFE, so it cannot be called or replaced -- and it
  // repaints these same elements whenever the liquidity or share inputs change. Duplicate listeners
  // would not cover it either: the share slider updates the value WITHOUT firing an input event.
  // So the container is watched and the correct figures re-applied.
  function watchCosts() {
    var first = document.getElementById('costCreation');
    var row = first && first.closest ? first.closest('.cost-row') : null;
    var host = row && row.parentElement;
    if (!host || !window.MutationObserver) return;
    new MutationObserver(paintCosts).observe(host, {
      childList: true, characterData: true, subtree: true,
    });
  }

  // ---- validation ------------------------------------------------------------------------------

  // The three social inputs carry NO id and no name -- only a placeholder. Matching on that is
  // fragile-looking but it is the only handle the markup offers, and without it the review page
  // shows the design's own accounts (t.me/solarflare) beside the user's token.
  // Selected as `input` and filtered on the PROPERTY, not as `input[type=text]`: these fields carry
  // no type attribute at all, so the attribute selector matches none of them and every social link
  // came back empty while looking like it had been read.
  function byPlaceholder(re) {
    var f = $$('input').filter(function (i) {
      return i.type === 'text' && re.test(i.placeholder || '');
    })[0];
    return f ? String(f.value || '').trim() : '';
  }

  function readForm() {
    var num = function (s) { return Number(String(s || '').replace(/[, ]/g, '')); };
    return {
      telegram: byPlaceholder(/t\.me/i),
      twitter: byPlaceholder(/x\.com|twitter/i),
      website: byPlaceholder(/yourproject\.com|https?:\/\//i),
      name: ($('#tokenName') || {}).value || '',
      ticker: ($('#tokenTicker') || {}).value || '',
      // No project type. Meme/Utility was removed from the Stellar site, and the field is removed
      // from this markup too, so there is nothing to read and nothing to store.
      desc: ($('#desc') || {}).value || '',
      supply: num(($('#supply') || {}).value),
      share: num(($('#shareNum') || {}).value),
      extra: num(($('#extraLiquidity') || {}).value),
    };
  }

  function validate(d) {
    var errs = [];
    if (!d.name.trim()) errs.push('Enter a token name.');

    var cur = toCurrency(d.ticker);
    if (!cur.ok) errs.push(cur.why);

    // The ledger stores a token amount as a 54-bit mantissa with a decimal exponent, so the ceiling
    // is enormous, but a supply of zero or a fraction is a mistake worth catching here rather than
    // as a failed transaction the user has already paid a fee for.
    // The cap is the page's own stated rule -- "Maximum 10,000,000,000" sits under the field -- and
    // like the 30% share it was stated in copy and enforced nowhere. The ledger would happily accept
    // far more, which is exactly why the check has to be here.
    if (!(d.supply > 0)) errs.push('Enter a total supply greater than zero.');
    else if (d.supply > 1e10) errs.push('Total supply cannot exceed 10,000,000,000.');

    // THE CREATOR'S SHARE IS CAPPED AT 30%, so at least 70% of supply always reaches the pool.
    //
    // The slider only goes to 30 and the copy beside it reads "Recommended: 5-15%" with "The rest
    // goes to the liquidity pool" -- but the field itself is a plain TEXT input with no max
    // attribute, so the cap existed only as far as the widget. Typing 100 walked straight past it
    // and would have minted the entire supply to the creator with no liquidity behind it, which is
    // the shape of a rug rather than a launch.
    if (!(d.share >= 0 && d.share <= 30)) {
      errs.push('Your share cannot exceed 30% — the rest goes to the liquidity pool.');
    }
    if (d.extra && d.extra < 0) errs.push('Extra liquidity cannot be negative.');

    return { ok: !errs.length, errs: errs, currency: cur.ok ? cur : null };
  }

  // ---- draft handoff ---------------------------------------------------------------------------
  // The three pages talk through localStorage, exactly as before, so the review and confirm pages
  // keep working. The currency code is stored ALONGSIDE the ticker rather than recomputed on each
  // page: recomputing is how the review page ends up describing a different asset from the one the
  // form validated.
  var DRAFT = 'lumos.launch.draft';

  function saveDraft() {
    var d = readForm();
    var v = validate(d);
    if (!v.ok) return v;
    d.currency = v.currency.code;
    d.currencyKind = v.currency.kind;
    d.ledger = 'xrpl';
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch (e) { /* private mode */ }
    return v;
  }

  // The page ships no error slot, so one is built rather than falling back to alert(). It is
  // inserted next to the button that triggered the check, which is where the reader is looking.
  function showErrors(errs, near) {
    var box = $('#lxxLaunchErrors');
    if (!box) {
      if (!errs.length) return;
      box = document.createElement('div');
      box.id = 'lxxLaunchErrors';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:10px 0;padding:10px 12px;border-radius:10px;font-size:13px;'
        + 'line-height:1.5;color:#e5484d;background:rgba(229,72,77,.09);'
        + 'border:1px solid rgba(229,72,77,.28)';
      var anchor = near && near.parentElement ? near.parentElement : document.body;
      anchor.insertBefore(box, near || null);
    }
    box.textContent = errs.join(' ');
    box.style.display = errs.length ? '' : 'none';
  }

  // ---- boot ------------------------------------------------------------------------------------

  function wireNext() {
    $$('button').forEach(function (b) {
      if ((b.textContent || '').trim().toLowerCase() !== 'next') return;
      b.addEventListener('click', function (ev) {
        var v = saveDraft();
        if (!v.ok) { ev.preventDefault(); ev.stopPropagation(); showErrors(v.errs, b); }
        else showErrors([], b);
      }, true);
    });
  }

  function load() {
    if (!$('#tokenTicker')) return;                               // not the launchpad form
    wireNext();

    fetch('/lxapi/xrplprices')
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p || !p.ok || !(p.usd > 0)) return;
        xrpUsd = p.usd;
        // The review page prices its fee and liquidity from the same rate this page quotes, so the
        // number a user agreed to on the form is the number they are asked to send.
        window.__lxxXrpUsd = p.usd;
        paintCosts();
        watchCosts();
      })
      .catch(function () { /* no rate: the design's own figures stand */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed for the console and for the tests: the currency rule is the piece most worth checking
  // from outside, because getting it wrong mints a different asset than the one requested.
  window.__lxxToCurrency = toCurrency;
  window.__lxxLaunchConfig = { feeCollector: FEE_COLLECTOR, usd: USD };
})();
