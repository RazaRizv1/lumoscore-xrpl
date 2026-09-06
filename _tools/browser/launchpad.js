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
  // ⚠ TEMPORARY TEST PRICING — RESTORE BEFORE THIS GOES ANYWHERE NEAR PRODUCTION.
  //
  // The real prices are { create: 5, liq: 10, pool: 10 }, which is $25 and about 17.6 XRP. That is
  // a lot to spend proving a GemWallet round-trip works, so the first live launch runs at a
  // fraction of it. Put the line below back to the real numbers once a test launch has succeeded.
  //
  // What this actually costs at ~$1.42/XRP: 0.35 fee + 1.06 into the pool + 1.5 funding the issuer
  // + 0.2 for the AMM's owner reserve = roughly 3.1 XRP. Of that only the issuer funding is truly
  // spent -- it is locked forever by the blackhole. The fee returns to LumosCore's own collector and
  // the pool side is withdrawable with the LP tokens.
  var USD_REAL = { create: 5, liq: 10, pool: 10 };
  var USD = { create: 0.50, liq: 1.50, pool: 0 };
  var TEST_PRICING = USD.create !== USD_REAL.create || USD.liq !== USD_REAL.liq;

  // THE REVIEW PAGE HAS ITS OWN COST PANEL, with no ids at all -- `.cost-row` blocks matched by
  // their label. It was never repainted, so after the form correctly showed 0.35 XRP the review step
  // still read "173.50 XRP ≈ $25": the design's original hardcoded figures, at XLM's rate, on the
  // very screen where the user commits. Both panels are painted from the same numbers now.
  var COST_ID = { create: 'costCreation', liq: 'costLiquidity', pool: 'costNetwork', total: 'costTotal' };
  var COST_LABEL = {
    create: 'token creation', liq: 'initial liquidity',
    pool: 'liq. pool & network', total: 'total cost',
  };

  function costCell(key) {
    var byId = document.getElementById(COST_ID[key]);
    if (byId) return byId;
    var want = COST_LABEL[key];
    var rows = $$('.cost-row, .cost-total');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.k'), v = rows[i].querySelector('.v');
      if (!k || !v) continue;
      if ((k.textContent || '').trim().toLowerCase() === want) return v;
    }
    return null;
  }

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
  function setCost(key, xrp, usdOverride) {
    var el = costCell(key);
    if (!el) return;
    var want = fmtXrp(xrp);
    var usdSpan = el.querySelector('.usd');
    // Sub-dollar amounts keep their cents. Rounding $0.50 to "$1" during test pricing would have
    // been a second wrong number sitting next to the first.
    // Cents whenever the amount is not whole. Rounding to the nearest dollar is right for the real
    // $5 / $10 prices and wrong for everything else -- $1.50 was displaying as "$2".
    var wantUsd = usdOverride == null ? null
      : ('≈ $' + (usdOverride % 1 === 0 ? Math.round(usdOverride).toLocaleString('en-US')
                                        : usdOverride.toFixed(2)));

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

    // The USD figure is written on EVERY row, not just the total. The design's static "$5" / "$10"
    // labels are only correct at the real prices, so under test pricing the panel read
    // "0.35 XRP ≈ $5" -- the right XRP beside the wrong dollars.
    // WHAT THE TOTAL HAS TO MEAN: every drop that leaves the wallet. It previously summed the three
    // priced rows and nothing else, so it under-reported by more than half — the ledger's own costs
    // were missing entirely, and the extra liquidity was missing on the review page.
    var createXrp = USD.create / xrpUsd;
    var liqXrp = USD.liq / xrpUsd + extraXrp();
    var netXrp = ledgerXrp();

    setCost('create', createXrp, createXrp * xrpUsd);
    setCost('liq', liqXrp, liqXrp * xrpUsd);

    // The row is literally called "Liq. pool & network", so the ledger's charges belong in it: the
    // base reserve that makes the issuing account exist (locked forever once it is blackholed) and
    // the owner reserve AMMCreate consumes. Neither is a LumosCore fee, and both are unavoidable.
    setCost('pool', netXrp, netXrp * xrpUsd);

    var totalXrp = createXrp + liqXrp + netXrp;
    setCost('total', totalXrp, totalXrp * xrpUsd);

    // Published so the review page can check it against the connected wallet's actual balance.
    // One number, computed once, so the quote and the sufficiency check can never disagree.
    window.__lxxLaunchTotalXrp = totalXrp;
  }

  // The extra liquidity is a FORM INPUT on one page and a DRAFT FIELD on the other. Reading only the
  // input meant the review step — the screen where the amount is actually committed — silently
  // dropped whatever the user had added.
  function extraXrp() {
    var el = document.getElementById('extraLiquidity');
    var raw = null;
    if (el) {
      raw = el.value;
    } else {
      try {
        var d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
        raw = d ? d.extra : null;
      } catch (e) { raw = null; }
    }
    var v = Number(String(raw == null ? '' : raw).replace(/[, ]/g, ''));
    return (isFinite(v) && v > 0) ? v : 0;
  }

  // Read from the ledger, with the same defaults the launch itself uses if server_info is
  // unreachable. `+ 0.5` matches the issuer funding in buildLaunchPlan — if one changes, so must
  // the other, or the quote stops matching the transaction.
  var ledger = { base: 1, owner: 0.2 };
  function ledgerXrp() { return (ledger.base + 0.5) + ledger.owner; }

  // The design's recalcCost() lives inside an IIFE, so it cannot be called or replaced -- and it
  // repaints these same elements whenever the liquidity or share inputs change. Duplicate listeners
  // would not cover it either: the share slider updates the value WITHOUT firing an input event.
  // So the container is watched and the correct figures re-applied.
  function watchCosts() {
    var first = costCell('create');
    var row = first && first.closest ? first.closest('.cost-row') : null;
    var host = row && row.parentElement;
    if (!host || !window.MutationObserver) return;
    new MutationObserver(paintCosts).observe(host, {
      childList: true, characterData: true, subtree: true,
    });
  }

  // ---- the token icon ---------------------------------------------------------------------------
  //
  // THREE THINGS WERE WRONG AND THEY HAVE THE SAME ROOT. The upload did nothing, the preview showed
  // a STELLAR mark, and the review step showed the XRP logo -- none of them the user's file.
  //
  //   * The code that read the chosen file lived inside the stripped Stellar layer, so choosing one
  //     changed nothing at all.
  //   * The design fills the preview with the first three letters of the ticker
  //     (`previewIcon.textContent = v.slice(0,3)`). That is 1-5 characters of text in a div, which
  //     is exactly what the site's LOGO HEALER hunts: it resolves the text as a ticker and stamps a
  //     logo over it. "XFR" resolved to something Stellar-shaped. There is no class opt-out; the
  //     only thing the healer skips is an element that already contains an <img> or <svg>.
  //   * The review hero carries `lx-natico`, a painter that draws the NETWORK's native asset -- so
  //     it drew XRP's logo on every token.
  //
  // So the icon is always rendered as a real <img>, or as an inline <svg> of initials. Both make the
  // element opaque to every painter on the page.
  var ICON_PX = 128;

  // Downscaled before it is stored. A full-size PNG as a data URL has already blown the localStorage
  // quota once in this project, and a quota error here would lose the whole draft, not just the
  // picture. 128px is ample for a 90px avatar and lands in tens of KB.
  function readIcon(file, cb) {
    if (!file || !/^image\//.test(file.type || '')) { cb(null); return; }
    var fr = new FileReader();
    fr.onerror = function () { cb(null); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = ICON_PX; c.height = ICON_PX;
          var g = c.getContext('2d');
          // Cover, not stretch: a non-square logo squashed into a circle looks broken.
          var s = Math.min(img.width, img.height);
          g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, ICON_PX, ICON_PX);
          cb(c.toDataURL('image/png'));
        } catch (e) { cb(null); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function initialsSvg(text, px) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', String(px)); svg.setAttribute('height', String(px));
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '32'); t.setAttribute('y', '34');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', '22'); t.setAttribute('font-weight', '800');
    t.setAttribute('fill', 'currentColor');
    t.textContent = String(text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    svg.appendChild(t);
    return svg;
  }

  // Paint `host` with the icon, or with initials. Always leaves an element node inside, which is
  // what keeps the logo healer and lx-natico off it.
  function paintIcon(host, dataUrl, fallbackText, px) {
    if (!host) return;
    host.innerHTML = '';
    host.classList.remove('empty');
    host.removeAttribute('data-logo');
    host.classList.remove('lx-natico');          // stop the native-asset painter claiming it
    if (dataUrl) {
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      host.appendChild(img);
    } else {
      host.appendChild(initialsSvg(fallbackText, px || 40));
    }
  }

  var iconData = null;

  function wireIcon() {
    var input = $('#iconFileInput');
    var host = $('#previewIcon');
    if (!input) return;

    var repaint = function () {
      paintIcon(host, iconData, ($('#tokenTicker') || {}).value || '', 44);
    };

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      readIcon(f, function (url) {
        iconData = url;
        repaint();
      });
    });

    // The design rewrites #previewIcon's text on every keystroke in the ticker field, which would
    // wipe the image and hand the element back to the healer. Re-applying on the same events keeps
    // it ours; the paint is a no-op when nothing changed.
    ['#tokenTicker', '#tokenName'].forEach(function (sel) {
      var f = $(sel);
      if (f) f.addEventListener('input', repaint);
    });
    repaint();
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
    d.icon = iconData || null;

    // THE ICON MUST NEVER COST THE USER THEIR DRAFT. A data URL is the largest thing in here by far,
    // and a quota error on setItem would throw away the name, ticker, supply and socials along with
    // it. So the write is attempted with the picture and retried without it.
    try {
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch (e) {
      try {
        var lean = {};
        for (var k in d) if (k !== 'icon') lean[k] = d[k];
        lean.icon = null;
        localStorage.setItem(DRAFT, JSON.stringify(lean));
      } catch (e2) { /* private mode: the review page will show what it can */ }
    }
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

  // The supply field is a plain TEXT input, so "1000000000jj" typed straight in. Number() then
  // returns NaN and validation rejects it, but only after the user has filled the rest of the form
  // and pressed Next -- the field should simply not accept letters.
  //
  // Digits and separators only, applied on input and on paste, with the caret preserved so typing
  // in the middle of a number does not jump to the end.
  function wireNumericFields() {
    ['#supply', '#shareNum', '#extraLiquidity'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      // Extra liquidity is an XRP amount, so it keeps a decimal point; the other two are whole units.
      var allow = sel === '#extraLiquidity' ? /[^0-9.]/g : /[^0-9,]/g;
      el.addEventListener('input', function () {
        var before = el.value;
        var cleaned = before.replace(allow, '');
        if (cleaned === before) return;
        var pos = el.selectionStart;
        el.value = cleaned;
        try { el.setSelectionRange(pos - (before.length - cleaned.length), pos - (before.length - cleaned.length)); }
        catch (e) { /* not all inputs support selection */ }
      });
      // inputmode gets a numeric keypad on phones without changing the input's type, which the
      // design's own styling depends on.
      el.setAttribute('inputmode', sel === '#extraLiquidity' ? 'decimal' : 'numeric');
    });
  }

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
    // The cost panel exists on BOTH the form and the review step, so the guard cannot be the form's
    // ticker field -- that is what left the review page quoting 173.50 XRP.
    var isForm = !!$('#tokenTicker');
    if (!isForm && !$('.cost-row')) return;                       // not a launchpad page

    if (isForm) { wireNext(); wireIcon(); wireNumericFields(); }

    // Loud on purpose. Reduced pricing that ships unnoticed is a launchpad that charges 50 cents
    // for a $5 service, and nothing else on the page would ever say so.
    if (TEST_PRICING && window.console && console.warn) {
      console.warn('LumosCore launchpad is running TEST PRICING ($'
        + USD.create + ' / $' + USD.liq + '), not the real $'
        + USD_REAL.create + ' / $' + USD_REAL.liq + '. Restore USD in browser/launchpad.js.');
    }

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
      .catch(function () { /* no rate: the design's own figures stand */ })
      // Reserves are governance-settable and have been lowered twice, so they are read rather than
      // assumed. A failure here leaves the defaults above, which are today's values.
      .then(function () {
        return fetch('https://xrplcluster.com/', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'server_info', params: [{}] }),
        }).then(function (r) { return r.json(); }).then(function (j) {
          var v = j && j.result && j.result.info && j.result.info.validated_ledger;
          if (!v) return;
          if (isFinite(Number(v.reserve_base_xrp))) ledger.base = Number(v.reserve_base_xrp);
          if (isFinite(Number(v.reserve_inc_xrp))) ledger.owner = Number(v.reserve_inc_xrp);
          paintCosts();
        });
      })
      .catch(function () { /* defaults stand */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed for the console and for the tests: the currency rule is the piece most worth checking
  // from outside, because getting it wrong mints a different asset than the one requested.
  window.__lxxToCurrency = toCurrency;
  window.__lxxLaunchConfig = { feeCollector: FEE_COLLECTOR, usd: USD };
})();
