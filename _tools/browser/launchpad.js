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

  // ---- costs: NOT painted, on purpose ----------------------------------------------------------
  // The design states the price in USD -- "≈ $5" mint, "≈ $10" liquidity, "≈ $10" pool -- and those
  // figures are unchanged by the move to this ledger, so they are left alone. What is missing is the
  // XRP a payer would actually send, and that is deliberately NOT shown yet: quoting an amount
  // implies there is somewhere to send it, and this ledger has no fee-collector address yet. A
  // priced button that cannot take payment is worse than an unpriced one.
  //
  // The markup also carries no anchor to write into: the amounts are bare text nodes. When the
  // collector exists, the transform should stamp the slots and this can fill them from
  // /lxapi/xrplprices, which is already the source for XRP/USD elsewhere.

  // ---- validation ------------------------------------------------------------------------------

  function readForm() {
    var num = function (s) { return Number(String(s || '').replace(/[, ]/g, '')); };
    return {
      name: ($('#tokenName') || {}).value || '',
      ticker: ($('#tokenTicker') || {}).value || '',
      type: (($$('input[name=ptype]').filter(function (r) { return r.checked; })[0]) || {}).value || '',
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
    if (!(d.supply > 0)) errs.push('Enter a total supply greater than zero.');
    else if (d.supply > 1e15) errs.push('Total supply is too large.');

    if (!(d.share >= 0 && d.share <= 100)) errs.push('Liquidity share must be between 0 and 100%.');
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed for the console and for the tests: the currency rule is the piece most worth checking
  // from outside, because getting it wrong mints a different asset than the one requested.
  window.__lxxToCurrency = toCurrency;
})();
