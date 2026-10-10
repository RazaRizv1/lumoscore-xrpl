
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
  var FEE_COLLECTOR = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';

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
  // WHERE THE MONEY GOES, as of 2026-09-17 (RAZA's locked-liquidity design):
  //   create + pool  -> LumosCore's collector. BOTH lines are charged now; `pool` used to be displayed and never sent.
  //   liq            -> the pool account, and from there into the AMM. NOT withdrawable by anyone, ever: that account
  //                     blackholes itself on the last step, which is the whole point of the design.
  //   issuer funding -> ~1.02 XRP, locked forever in the blackholed issuer (measured against three live launches).
  //   pool funding   -> ~1.85 XRP of reserves + the AMMCreate burn, likewise locked in a dead account.
  // So roughly 2.9 XRP per launch is permanently out of circulation, and the only recoverable part is nothing at all —
  // which is what "the liquidity cannot be rugged" costs.
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

  // THE MOCK COSTS WERE ON SCREEN FOR TEN SECONDS. Correcting these figures needs the live XRP price,
  // so until that lands the design's own numbers stand — and the design's numbers are
  // "Token creation 34.70 APT", "Total 173.50 APT". A launch page quoting a price in another chain's
  // asset, for long enough to read and act on, is the mock-value trap in its most expensive form:
  // someone budgets for it, or decides it is too expensive, before the real 3.13 XRP arrives.
  //
  // So the VALUES are hidden until they are true. Only the `.v` cells — the labels, the layout and
  // the panel all stay, so the row reads as loading rather than broken, and nothing moves when the
  // real figure lands. Injected as a stylesheet rather than per-element so it applies before the
  // first paint, and lifted by a class the moment paintCosts() has written real numbers.
  (function gateCosts() {
    if (document.getElementById('lxx-costgate')) return;
    var st = document.createElement('style');
    st.id = 'lxx-costgate';
    st.textContent = 'html:not(.lxx-costready) .cost-row .v,'
      + 'html:not(.lxx-costready) .cost-total .v{visibility:hidden}';
    (document.head || document.documentElement).appendChild(st);
    // A hard stop, so a failed price fetch cannot leave the panel blank forever.
    //
    // THE FIRST VERSION OF THIS JUST LIFTED THE GATE, which was a bad trade: when the price was slow
    // the timeout fired, the gate opened, and the mock everyone was being protected from — "Total
    // 173.50 APT" — appeared and stayed. That is worse than the flash it replaced, because it does
    // not correct itself. Caught by re-running the page sweep, which found the APT figures visible
    // again ten seconds in.
    //
    // So the timeout BLANKS the values first and only then reveals them. An em dash says the figure
    // is not available; the mock says a launch costs 173.50 of an asset this chain does not use.
    setTimeout(function () {
      if (document.documentElement.classList.contains('lxx-costready')) return;   // real ones landed
      ['create', 'liq', 'pool', 'total'].forEach(function (k) {
        var cell = costCell(k);
        if (cell) cell.textContent = '—';
      });
      liftCosts();
    }, 8000);
  })();

  function liftCosts() {
    try { document.documentElement.classList.add('lxx-costready'); } catch (e) {}
  }

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
    liftCosts();                       // real figures are in; show the panel
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
  // WHAT THE LEDGER ITSELF TAKES, counted the way browser/mint.js actually spends it.
  //
  // This was `(base + 0.5) + owner` = 1.70 XRP, which is not any figure the launch uses. The plan
  // funds TWO throwaway accounts, and both are funded to the drop because a pool account a fraction
  // under its own reserve dies on the last step:
  //
  //   issuer   base + 0.02          mint.js:196 — measured, three live issuers each took 1.02
  //   pool     base + 0.85          mint.js:233 — base 1.00 + two trustlines 0.40 + AMMCreate 0.20
  //                                 + 0.25 margin; the lpXrp on top of it is the liquidity row, so
  //                                 it is NOT counted here or it would be charged twice
  //   + owner                       the launcher's own trustline for the new token
  //   + 0.01                        transaction fees
  //
  // = 2 x base + 0.88 + owner, which is 3.08 against today's reserve schedule.
  //
  // THE QUOTE WAS UNDER-REPORTING BY 45%. The panel said "Total Cost 3.04 XRP" and the pre-flight
  // check in mint.js — which sums the REAL plan — refused the same launch saying it needs 4.42.
  // Someone reading the page would fund 3.5 XRP and be turned away by the product's own arithmetic.
  // Both numbers are now computed from the same constants, so they can only disagree if one of these
  // files changes without the other.
  function ledgerXrp() { return (2 * ledger.base) + 0.88 + ledger.owner; }

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

  // The design's own empty state: a photo placeholder on the light tile that `.empty` provides.
  // Drawn as SVG rather than left as text, which is also what keeps the logo healer off the
  // element -- it repaints anything holding 1-5 characters, and the tile's ticker initials were
  // exactly that.
  function placeholderSvg(px) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(Math.round(px * 0.5)));
    svg.setAttribute('height', String(Math.round(px * 0.5)));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#9ca3af');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var parts = [
      ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '3' }],
      ['circle', { cx: '8.5', cy: '8.5', r: '1.5' }],
      ['path', { d: 'M21 15l-5-5L5 21' }],
    ];
    parts.forEach(function (p) {
      var e = document.createElementNS(NS, p[0]);
      for (var k in p[1]) e.setAttribute(k, p[1][k]);
      svg.appendChild(e);
    });
    return svg;
  }

  // Paint `host` with the icon, or with the design's placeholder. Always leaves an element node
  // inside, which is what keeps the logo healer and lx-natico off it.
  //
  // `.empty` IS THE DESIGN'S OWN CLASS and carries the light tile the placeholder sits on. Removing
  // it unconditionally -- which the first version did -- left the placeholder on the filled-state
  // background, which is not what the tile looks like before an upload.
  // Byte-for-byte the placeholder lumoscore.com uses, lifted from its _launchpad.js.
  var PREVIEW_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDk2IDk2Ij48cmVjdCB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHJ4PSIyMiIgZmlsbD0iI2VjZWVmMyIvPjxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2FhYjFiZCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjI3IiB5PSIzMSIgd2lkdGg9IjQyIiBoZWlnaHQ9IjM0IiByeD0iNSIvPjxjaXJjbGUgY3g9IjM5IiBjeT0iNDMiIHI9IjQiLz48cGF0aCBkPSJNMzAgNTlsMTEtMTEgOSA4IDctNiA5IDkiLz48L2c+PC9zdmc+";

  function paintIcon(host, dataUrl, _fallbackText, px) {
    if (!host) return;
    host.innerHTML = '';
    host.removeAttribute('data-logo');
    host.classList.remove('lx-natico');          // stop the native-asset painter claiming it
    if (dataUrl) {
      host.classList.remove('empty');
      host.style.background = '';                // drop the placeholder tile the empty branch set
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      host.appendChild(img);
    } else {
      host.classList.add('empty');
      // STELLAR'S OWN PLACEHOLDER FILE, not a redraw of it (RAZA 2026-10-02: "the logo preview icon is
      // not the same as on Stellar. It needs to carry the same icon").
      //
      // The previous version drew the glyph here and tuned its size and tile colour by eye against
      // screenshots. That is why it kept not matching: the proportions, the corner radius, the two
      // greys and the stroke weight all had to be guessed, and each pass got one of them closer and
      // another one wrong.
      //
      // lumoscore.com ships this as a single 96x96 SVG data URI — rounded rect #eceef3 with an #aab1bd
      // picture glyph — so using that exact string makes the question of whether it matches not a
      // judgement. object-fit lets the one asset serve whatever size the tile happens to be.
      host.style.background = '';
      var ph = document.createElement('img');
      ph.src = PREVIEW_PLACEHOLDER;
      ph.alt = '';
      ph.setAttribute('data-lxlp', '1');
      ph.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
      host.appendChild(ph);
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

  // Paint the confirmation from what mint.js actually recorded.
  //
  // BY TEXT SUBSTITUTION, not by selector. The placeholders are scattered across .result-name, .sub,
  // .desc, .mono-mini and a couple of unclassed spans — "in APT / APT pool", "seeded with 900M APT
  // · 69.4 APT" — and targeting each one is a list that goes stale the moment the design moves a
  // node. Replacing the known placeholder STRINGS in the page's text nodes reaches all of them and
  // cannot miss one that moved.
  //
  // "Aptos Coin" is replaced BEFORE the bare ticker, or the word Aptos would be half-rewritten into
  // "XRP Coin" by the shorter rule.
  function paintConfirm() {
    var res = null;
    try { res = JSON.parse(localStorage.getItem('lumos.launch.result') || 'null'); } catch (e) {}

    var addr = '';
    try { addr = localStorage.getItem('lumos.address') || ''; } catch (e) {}
    var shortAddr = addr && addr.length > 12 ? (addr.slice(0, 6) + '…' + addr.slice(-4)) : addr;

    // NO RESULT MEANS NOBODY JUST LAUNCHED ANYTHING, and this page's headline is "Launched
    // Successfully! Your token is now live on the XRP Ledger". Em-dashing the fields is not enough:
    // the first version of this did exactly that and left a success announcement standing over
    // "— / XRP pool seeded with 900M —", which still tells a visitor something happened.
    //
    // Same call the review step already makes for a missing draft — there is nothing to confirm
    // without a result, so it goes back to the step that makes one.
    if (!res || !(res.name || res.ticker || res.currency)) {
      try { location.replace('/launchpad'); } catch (e) {}
      return;
    }

    var name = (res && res.name) || '—';
    var tick = (res && (res.ticker || res.currency)) || '—';
    var who = shortAddr || '—';

    var iss = (res && res.issuer) || '';
    var shortIss = iss && iss.length > 12 ? (iss.slice(0, 6) + '…' + iss.slice(-4)) : (iss || '—');
    var hash = (res && res.hashes && res.hashes[0]) || '';
    var shortHash = hash ? (hash.slice(0, 7) + '…' + hash.slice(-6)) : '—';

    // ORDER MATTERS, AND SO DOES NOT TREATING EVERY "APT" THE SAME.
    //
    // The first pass here replaced every APT with the new token's ticker and produced
    // "in SWEEP / SWEEP pool" and "seeded with 900M SWEEP · 69.4 SWEEP" — nonsense in the first
    // case and a WRONG STATEMENT in the second, because that 69.4 is the native amount, not the
    // token's. On the design the placeholder token IS the native asset, so the same three letters
    // mean two different things depending on where they sit. The composite phrases are therefore
    // rewritten before the bare ticker rule ever runs.
    var pairs = [
      ['Aptos Coin', name],
      ['0x0a72…c5e5', who],                        // the wallet that approved, not the issuer

      // The pool is the new token against the NATIVE asset. BOTH SPACINGS: desktop ships
      // "APT / APT pool" and the phone ships "APT/APT pool", and matching only the spaced form let
      // the bare-ticker rule turn the phone's into "SWEEP/SWEEP pool".
      ['APT / APT pool', tick + ' / XRP pool'],
      ['APT/APT pool', tick + ' / XRP pool'],
      // …and the second amount on the seeded line is the native side.
      [/·\s*([\d.,]+)\s*APT\b/g, '· $1 XRP'],

      [/\bAPT\b/g, tick],

      // Any remaining 0x placeholder on this page is an ISSUER field — there are two, under
      // "ISSUER" and "Asset issuer" — and the approving wallet was already handled above.
      [/0x[0-9a-fA-F]{2,}…[0-9a-fA-F]{2,}/g, shortIss],
      // The design's fake transaction hash.
      [/\ba8c3f2d…91bd2e\b/g, shortHash],
    ];

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    for (var n = walker.nextNode(); n; n = walker.nextNode()) {
      var p = n.parentNode;
      if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
      if (n.nodeValue && n.nodeValue.trim()) nodes.push(n);
    }
    for (var i = 0; i < nodes.length; i++) {
      var v = nodes[i].nodeValue, before = v;
      for (var j = 0; j < pairs.length; j++) {
        var from = pairs[j][0], to = pairs[j][1];
        v = (typeof from === 'string') ? v.split(from).join(to) : v.replace(from, to);
      }
      if (v !== before) nodes[i].nodeValue = v;
    }

    // A LINE THE PHONE'S MARKUP SHIPS EMPTY. Desktop has "in APT / APT pool" under the liquidity
    // figure; the phone's container has only "in  pool" — the pair was never in it, so there was
    // nothing for a substitution to replace and the page read "in pool" under a number. Not caused
    // by the rewriting above; it is the stale container, and it is only visible at 375px.
    var subs = document.querySelectorAll('.sub');
    for (var s = 0; s < subs.length; s++) {
      if (/^\s*in\s+pool\s*$/.test(subs[s].textContent || '')) {
        subs[s].textContent = 'in ' + tick + ' / XRP pool';
      }
    }

    // The issuer address, which is the one thing on this page a person must be able to keep. It is
    // recorded by mint.js and had nowhere to appear.
    if (res && res.issuer) {
      var host = $('.result-name');
      if (host && host.parentNode && !$('.lxx-issuer-line')) {
        var d = document.createElement('div');
        d.className = 'lxx-issuer-line';
        d.style.cssText = 'margin-top:6px;font-size:12.5px;opacity:.75;'
          + 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all';
        d.textContent = 'Issuer ' + res.issuer;
        host.parentNode.insertBefore(d, host.nextSibling);
      }
    }
  }

  function load() {
    // The cost panel exists on BOTH the form and the review step, so the guard cannot be the form's
    // ticker field -- that is what left the review page quoting 173.50 XRP.
    var isForm = !!$('#tokenTicker');

    // THE CONFIRMATION PAGE WAS EXCLUDED BY THIS GUARD, and the comment directly below has always
    // said the confirm page is filled from the draft. It never was: confirm has no #tokenTicker and
    // no .cost-row, so load() returned on the first line and nothing on that page was ever painted.
    //
    // What shipped instead, VISIBLY, on the screen shown immediately after someone has spent real
    // money issuing a token:
    //     Aptos Coin ·  APT  ·  in APT / APT pool
    //     Approved with XRP Ledger wallet 0x0a72…c5e5
    //     APT / APT pool seeded with 900M APT · 69.4 APT
    // Another chain's token name, another chain's ticker, and an EVM address for the wallet that
    // approved it. mint.js has been writing `lumos.launch.result` all along and nothing read it.
    if ($('.result-name')) { paintConfirm(); return; }

    if (!isForm && !$('.cost-row')) return;                       // not a launchpad page

    // A REVIEW STEP WITH NO DRAFT DESCRIBES A TOKEN NOBODY ASKED FOR.
    //
    // The review and confirm pages are filled from the draft the form hands over, so their markup
    // ships as the design's placeholder — "Aptos Coin", "$APT", "(900,000,000 APT)". Reached
    // normally that is invisible, because the draft overwrites all of it. Reached with no draft —
    // a direct link, a bookmark, a refresh after storage was cleared, a back-navigation from
    // confirm — the placeholder is what stands, and the page reads as a real review of an Aptos
    // token about to be minted, priced, with a Launch button under it.
    //
    // There is nothing to review without a draft, so it goes back to the step that makes one.
    if (!isForm) {
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { draft = null; }
      if (!draft || !draft.name || !draft.ticker) {
        try { location.replace('/launchpad'); } catch (e) {}
        return;
      }
    }

    if (isForm) { wireNext(); wireIcon(); wireNumericFields(); }

    // Loud on purpose. Reduced pricing that ships unnoticed is a launchpad that charges 50 cents
    // for a $5 service, and nothing else on the page would ever say so.
    if (TEST_PRICING && window.console && console.warn) {
      console.warn('LumosCore launchpad is running TEST PRICING ($'
        + USD.create + ' / $' + USD.liq + '), not the real $'
        + USD_REAL.create + ' / $' + USD_REAL.liq + '. Restore USD in browser/launchpad.js.');
    }

    // THE RATE, AND A CACHED ONE IF THIS CALL CANNOT GET IT.
    //
    // Without a rate the cost panel stays hidden for eight seconds and then shows four em dashes --
    // the timeout above, which exists so the design's mock ("173.50 APT ≈ $25") can never be mistaken
    // for a price. That is the right failure, but it is a bad experience for something as ordinary as
    // a rate limit: this endpoint fronts xrpl.to, which allows 333 requests a day per IP.
    //
    // A rate from the last six hours is used only to QUOTE a cost in XRP, and the USD side of every
    // row is recomputed from the same number, so the panel stays internally consistent whichever
    // rate it used. It never invents one: no live rate and no cache still means dashes.
    var useRate = function (v, cached) {
      xrpUsd = v;
      // The review page prices its fee and liquidity from the same rate this page quotes, so the
      // number a user agreed to on the form is the number they are asked to send.
      window.__lxxXrpUsd = v;
      window.__lxxXrpUsdCached = !!cached;
      paintCosts();
      watchCosts();
    };
    fetch('/lxapi/xrplprices')
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (p && p.ok && p.usd > 0) {
          if (window.lxx && window.lxx.usdSave) window.lxx.usdSave(p.usd);
          useRate(p.usd, false);
          return;
        }
        var c = (window.lxx && window.lxx.usdCached) ? window.lxx.usdCached() : null;
        if (c > 0) useRate(c, true);
      })
      .catch(function () {
        var c = (window.lxx && window.lxx.usdCached) ? window.lxx.usdCached() : null;
        if (c > 0) useRate(c, true);
      })
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

  // THE SHARE SLIDER IS NEVER INITIALISED (RAZA 2026-10-02: "the arrow is a bit ahead of 10%, it needs
  // to be place at exact 10%").
  //
  // The design's setShare() is bound to input, drag and click and is never called on load, so the first
  // paint uses the thumb's CSS default — measured at 35.0% of the track against the 33.33% that value 10
  // means, about 10px to the right of the "10%" label. Touch the slider once and it corrects itself,
  // which is why it looks like a rounding problem rather than an uninitialised one.
  //
  // Nothing here recomputes the position: dispatching `input` on the number box runs the design's own
  // handler with its own maths, so there is one implementation and it cannot drift from the drag path.
  // Verified afterwards: 0, 10, 15 and 30 land on 0, 0.3333, 0.5 and 1.0 of the track exactly.
  function initShareSlider() {
    try {
      var n = document.getElementById('shareNum');
      if (!n || !document.getElementById('sliderThumb')) return;
      n.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { load(); initShareSlider(); });
  } else { load(); initShareSlider(); }

  // Exposed for the console and for the tests: the currency rule is the piece most worth checking
  // from outside, because getting it wrong mints a different asset than the one requested.
  window.__lxxToCurrency = toCurrency;
  window.__lxxLaunchConfig = { feeCollector: FEE_COLLECTOR, usd: USD };
})();

// The launch review page, and the transactions a launch is actually made of.
//
// TWO PROBLEMS ON THIS PAGE.
//
// 1. It showed the DESIGN'S MOCK regardless of what was typed: "XRP Ledger Coin", ticker "$XRP",
//    "t.me/solarflare", a supply of 1,000,000,000 -- and a description about "the chaotic energy of
//    solar storms". A review step whose whole purpose is "double-check everything below" was
//    showing somebody else's token.
//
// 2. "Confirm & Launch" was a plain <a href="/launchpad/confirm">. It navigated to the success
//    page -- confetti, share buttons, the lot -- having issued nothing at all. That is worse than a
//    broken button: it tells the user they own a token that does not exist.
//
// This file fixes (1) outright and makes (2) honest. It also builds the exact transaction sequence a
// launch consists of, so the plan can be inspected and tested before anything is signed.
//
// THE LAUNCH NOW RUNS, on GemWallet. lxc.submit() carries the user's four transactions to the
// extension; the issuer's four are signed locally with a key generated here and thrown away.
//
// TWO HONEST LIMITS, both deliberate:
//
//   * Xaman CAN sign everywhere else on the site now, but is refused HERE by name. This is eight
//     transactions in a fixed order whose last two are irreversible, and each Xaman approval leaves
//     the page — a reload on the way back would land mid-sequence with real XRP already spent.
//   * NONE OF THE GEMWALLET PATH HAS ROUND-TRIPPED AGAINST THE EXTENSION. It is written from the
//     documented protocol and there is no extension in the browser it was built in. What IS tested
//     is the ordering and the failure handling, by running this same orchestrator against a fake
//     ledger: the happy path completes eight steps in order, a ledger rejection stops immediately
//     rather than blackholing an issuer whose mint failed, and a refused prompt leaves nothing
//     done. The first real launch is still a test, and it costs real XRP.
(function () {
  if (window.__lxxMint) return;
  window.__lxxMint = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  var DRAFT = 'lumos.launch.draft';
  // THE BLACKHOLE REGULAR KEY, taken from the ledger rather than from memory. XRPL LUMOS's own
  // issuer (rsPqeam…Ha) carries RegularKey rrrrrrrrrrrrrrrrrrrrBZbvji -- ACCOUNT_ONE -- with
  // lsfDisableMaster set. A note here said ACCOUNT_ZERO (rrrrrrrrrrrrrrrrrrrrrhoLvTp), which is a
  // different address; using it would have produced a blackhole that does not match the one every
  // LumosCore token on this ledger already uses.
  var BLACKHOLE_KEY = 'rrrrrrrrrrrrrrrrrrrrBZbvji';

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { return null; }
  }

  function num(v) { return (v == null || !isFinite(v)) ? null : Number(v); }

  function group(v) {
    return v == null ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // ---- review painting -------------------------------------------------------------------------
  // Rows are matched by their LABEL, not their position, for the reason every other layer here does
  // it: the order of a design's rows is a layout decision that can change without anyone thinking
  // about this file.
  function setRow(label, text, whole) {
    var rows = $$('.detail-row');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.k');
      var v = rows[i].querySelector('.v');
      if (!k || !v) continue;
      if ((k.textContent || '').trim().toLowerCase() !== label) continue;

      // `whole` replaces the entire cell. The icon row needs it: its .v holds a preview tile, a
      // pill AND a filename span, so writing into the pill alone left the row reading
      // "XRP Not provided icon-slr.png · 142 KB" -- the replacement wedged inside the mock.
      if (whole) { v.textContent = text; v.classList.toggle('empty', true); return true; }

      // A row whose value is a link or a pill keeps its element; only the text changes.
      var inner = v.querySelector('a, .pill');
      if (inner) {
        inner.textContent = text;
        if (inner.tagName === 'A') inner.setAttribute('href', /^https?:/.test(text) ? text : ('https://' + text));
      } else {
        v.textContent = text;
      }
      v.classList.toggle('empty', text === 'Not provided' || text === '—');
      return true;
    }
    return false;
  }

  function paintReview() {
    var d = readDraft();
    if (!d) return false;

    var supply = num(d.supply);
    var share = num(d.share);
    var lpShare = (share == null) ? null : (100 - share);
    var yours = (supply != null && share != null) ? supply * share / 100 : null;
    var pool = (supply != null && lpShare != null) ? supply * lpShare / 100 : null;
    var ticker = d.ticker || '';

    // THE HERO ICON WAS DRAWING XRP'S OWN LOGO on every token, because it carries `lx-natico` -- a
    // painter for the network's NATIVE asset. Replaced with the uploaded icon, or initials drawn as
    // inline SVG. Either way the element ends up containing a real node, which is what stops both
    // that painter and the logo healer from claiming it back.
    var heroIcon = $('.hero-icon');
    if (heroIcon) {
      heroIcon.classList.remove('lx-natico');
      heroIcon.removeAttribute('data-logo');
      heroIcon.innerHTML = '';
      if (d.icon) {
        // The tile paints `linear-gradient(135deg, var(--accent), #ff9a3d)` as its own background,
        // which is right for a placeholder and wrong behind a real logo -- it rimmed the artwork in
        // orange. Cleared only when there IS an image; the initials still need it.
        heroIcon.style.background = 'none';
        var img = document.createElement('img');
        img.src = d.icon;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
        heroIcon.appendChild(img);
      } else {
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('width', '52'); svg.setAttribute('height', '52');
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', '32'); t.setAttribute('y', '34');
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
        t.setAttribute('font-size', '22'); t.setAttribute('font-weight', '800');
        t.setAttribute('fill', '#fff');
        t.textContent = String(d.ticker || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
        svg.appendChild(t);
        heroIcon.appendChild(svg);
      }
    }

    var name = $('.hero-name');
    if (name) name.textContent = d.name || '—';
    var desc = $('.hero-desc');
    if (desc) desc.textContent = d.desc || '';

    setRow('token name', d.name || '—');
    setRow('ticker', '$' + ticker);
    setRow('description', d.desc || 'Not provided');

    // The icon row shipped a mock filename -- "icon-slr.png · 142 KB" -- beside a preview of a token
    // nobody uploaded. It now reports whether one actually came through the draft.
    setRow('icon', d.icon ? 'Uploaded' : 'Not provided', true);

    setRow('total supply', group(supply) + ' ' + ticker);
    setRow('your share', share == null ? '—' : (share + '% (' + group(yours) + ' ' + ticker + ')'));
    setRow('liquidity pool share',
      lpShare == null ? '—' : (lpShare + '% (' + group(pool) + ' ' + ticker + ')'));

    // The issuer is blackholed at the end of the launch, so this row is a promise the flow keeps.
    setRow('issuer locked', 'Yes — supply is fixed');

    // NOT group(): that rounds to whole units, which is right for a token supply and wrong for an
    // XRP amount -- it turned 0.25 XRP into "0 XRP added to the pool", reporting the user's own
    // contribution as nothing.
    var extra = num(d.extra);
    setRow('extra xrp', (extra && extra > 0)
      ? ((extra % 1 === 0 ? extra.toLocaleString('en-US') : String(extra)) + ' XRP added to the pool')
      : 'None — using default liquidity only');

    // Socials: whatever was not filled in says so, rather than showing the design's accounts.
    setRow('telegram', d.telegram || 'Not provided');
    setRow('x / twitter', d.twitter || 'Not provided');
    setRow('website', d.website || 'Not provided');

    return true;
  }

  // ---- the launch, as a list of transactions ----------------------------------------------------
  //
  // Written out in full so the sequence can be read, ordered and tested before it is ever signed.
  // Each entry says WHO signs it, because that is the whole difficulty: the issuer's transactions
  // are signed locally with a key this page generates, and the user's are signed by their wallet.
  //
  // ORDER IS LOAD-BEARING IN TWO PLACES:
  //
  //   * DefaultRipple must be set on the issuer BEFORE the token can move between third parties.
  //     Set it after minting and the token is stuck in the holder's hands.
  //   * The blackhole is SetRegularKey FIRST, then DisableMaster. Disabling the master key first
  //     would leave no key able to sign the SetRegularKey, and the issuer would keep a live master
  //     key forever -- the exact opposite of what "supply is fixed" claims.
  function buildLaunchPlan(d, issuer, user, reserveXrp, opts) {
    var o = opts || {};
    var cur = d.currency;
    var supply = String(d.supply);
    var pool = o.pool;                                   // the throwaway that owns the pool; blackholed at the end

    // The issuer needs the base reserve to exist at all, plus its own transaction fees. Whatever is
    // sent here is locked forever once the account is blackholed, so it is funded to the minimum
    // rather than rounded up.
    //
    // MEASURED, NOT GUESSED (2026-09-17): the three live launchpad issuers were each funded with 1.02 XRP and each still
    // holds 1.019953 — so 0.02 covers every fee the issuer ever pays. The old `+0.5` locked an extra 0.48 XRP (~$0.62) in a
    // dead account on every launch, for nothing.
    var base = (reserveXrp == null ? 1 : reserveXrp);
    var fund = base + 0.02;

    // What the pool gets. The review page states a liquidity share -- 75% of supply against the XRP
    // side -- so the pool has to actually be created, or that row is a promise the launch breaks.
    var share = Number(d.share);
    var lpTokens = (isFinite(share) && d.supply) ? (Number(d.supply) * (100 - share) / 100) : 0;
    var lpXrp = Number(o.liquidityXrp || 0) + (Number(d.extra) || 0);

    var plan = [];

    // THE FEE GOES FIRST. It is the pattern this project already uses for paid flows -- the listing
    // request pays before it submits -- and it means a launch that fails later has not also left an
    // unpaid token on the ledger. The user is told the whole sequence before the first prompt.
    if (o.feeXrp > 0 && o.feeCollector) {
      plan.push({ by: 'user', what: 'Pay the launch fee',
        tx: { TransactionType: 'Payment', Account: user, Destination: o.feeCollector,
              Amount: String(Math.round(o.feeXrp * 1e6)) } });
    }

    plan.push(
      { by: 'user', what: 'Fund the issuing account',
        tx: { TransactionType: 'Payment', Account: user, Destination: issuer,
              Amount: String(Math.round(fund * 1e6)) } });

    // THE POOL ACCOUNT (RAZA 2026-09-17, matching the 2025 Stellar launches): a second throwaway, funded by the user, which
    // takes the whole supply, hands the launcher their share, creates the pool and then blackholes itself. The liquidity is
    // then provably un-ruggable — not by the launcher, not by LumosCore, not by anyone, because no key can sign for it.
    //
    // It needs, and this has to be counted exactly or the account ends up a fraction under its own reserve and the launch
    // dies on the last step:
    //   base reserve            1.00   to exist at all
    //   trustline (the token)  0.20   owner reserve, held for the life of the account
    //   trustline (LP token)   0.20   owner reserve, created by AMMCreate
    //   AMMCreate cost          0.20   destroyed, not a fee
    //   margin + fees           0.25   the reserve is a ledger parameter and can rise
    //   + lpXrp                        the XRP that becomes the pool's own side
    if (pool) {
      var poolFund = base + 0.85 + lpXrp;
      plan.push(
        { by: 'user', what: 'Fund the liquidity pool account',
          tx: { TransactionType: 'Payment', Account: user, Destination: pool,
                Amount: String(Math.round(poolFund * 1e6)) } });
    }

    return plan.concat(buildRest(cur, supply, issuer, user, lpTokens, lpXrp, pool, d.share));
  }

  // THE SUPPLY NEVER PASSES THROUGH THE LAUNCHER'S WALLET ANY MORE (RAZA 2026-09-17, matching the 2025 Stellar launches,
  // measured on mainnet: an operator-made throwaway took the whole supply, sent the launcher their share, deposited the rest
  // and then set its own master weight to 0).
  //
  // Why it matters: whoever holds the LP tokens can withdraw the pool. Leaving them with the launcher — which is what this
  // flow used to do, and what lumoscore.com still does — means the liquidity can be pulled the moment the token moves. Here
  // the pool account blackholes itself at the end, so the liquidity is locked for good and the launcher keeps exactly the
  // share they chose. Nobody collects the pool's 0.2% either; it compounds inside the pool, unclaimable, forever.
  function buildRest(cur, supply, issuer, user, lpTokens, lpXrp, pool, sharePct) {
    // What the launcher actually receives: their chosen share of the supply, sent on by the pool account.
    var userTokens = (isFinite(Number(sharePct)) && Number(supply))
      ? (Number(supply) * Number(sharePct) / 100) : 0;
    var holder = pool || user;                           // no pool account (nothing to seed) → the old behaviour

    return [

      { by: 'issuer', what: 'Enable rippling and set the domain',
        // 8 = asfDefaultRipple. Domain is hex of the ASCII host, which is what makes the token
        // verifiable against the xrp-ledger.toml served from that domain.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 8,
              Domain: hexAscii('lumoscore.com') } },

      // The pool account has to trust the token before the issuer can send it the supply.
      pool ? {
        by: 'pool', what: 'Prepare the liquidity pool account',
        tx: { TransactionType: 'TrustSet', Account: pool,
              LimitAmount: { currency: cur, issuer: issuer, value: supply } } } : null,

      { by: 'user', what: 'Trust the new token',
        tx: { TransactionType: 'TrustSet', Account: user,
              LimitAmount: { currency: cur, issuer: issuer, value: supply } } },

      { by: 'issuer', what: pool ? 'Mint the full supply' : 'Mint the full supply to you',
        tx: { TransactionType: 'Payment', Account: issuer, Destination: holder,
              Amount: { currency: cur, issuer: issuer, value: supply } } },

      // The launcher's own share, and only that. The rest stays with the pool account for the pool.
      (pool && userTokens > 0) ? {
        by: 'pool', what: 'Send you your share',
        tx: { TransactionType: 'Payment', Account: pool, Destination: user,
              Amount: { currency: cur, issuer: issuer, value: lxxAmt(userTokens) } } } : null,

      // THE POOL. Without this the review page's "Liquidity Pool Share" is a promise the launch never keeps.
      //
      // AMMCreate is skipped entirely when there is nothing to seed it with, rather than submitted
      // with a zero side, which the ledger rejects.
      (lpTokens > 0 && lpXrp > 0) ? {
        by: pool ? 'pool' : 'user', what: 'Create the liquidity pool',
        tx: { TransactionType: 'AMMCreate', Account: holder,
              Amount: { currency: cur, issuer: issuer, value: lxxAmt(lpTokens) },
              Amount2: String(Math.round(lpXrp * 1e6)),
              // Trading fee in units of 1/1000 of a percent, so 200 is 0.2% — the platform's own rate (RAZA 2026-09-17).
              // Fixed at creation; on an existing pool it can only be changed by an LP vote, and this pool's only LP is
              // about to be blackholed, so 0.2% is what it charges for as long as it exists.
              TradingFee: 200 } } : null,

      { by: 'issuer', what: 'Hand over the issuer key',
        tx: { TransactionType: 'SetRegularKey', Account: issuer, RegularKey: BLACKHOLE_KEY } },

      { by: 'issuer', what: 'Disable the issuer permanently',
        // 4 = asfDisableMaster. After this nothing can ever sign for the issuer again, so the
        // supply minted above is the supply forever.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 4 } },

      // …and the same two for the pool account, which is what locks the liquidity. SetRegularKey FIRST: disabling the
      // master key first would leave nothing able to sign the SetRegularKey.
      pool ? {
        by: 'pool', what: 'Hand over the pool account key',
        tx: { TransactionType: 'SetRegularKey', Account: pool, RegularKey: BLACKHOLE_KEY } } : null,

      pool ? {
        by: 'pool', what: 'Lock the liquidity permanently',
        tx: { TransactionType: 'AccountSet', Account: pool, SetFlag: 4 } } : null,
    ].filter(Boolean);
  }

  // Token amounts go on the ledger as strings, and an exponent or sixteen significant digits is a rejection. The vendored
  // core already does this for every other write on the site; the launch plan is built before that library is loaded, so it
  // gets the same treatment locally.
  function lxxAmt(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '0';
    var s = v.toPrecision(15).replace(/\.?0+$/, '');
    if (s.indexOf('e') < 0 && s.indexOf('E') < 0) return s;
    return v.toFixed(Math.max(0, 15 - Math.ceil(Math.log10(Math.abs(v) + 1)))).replace(/\.?0+$/, '');
  }

  // ---- running the launch -----------------------------------------------------------------------
  //
  // Every dependency is injected. That is not ceremony: a launch moves real money and cannot be
  // rehearsed against mainnet, so the only way to test the ORDERING and the FAILURE HANDLING is to
  // run the same orchestrator against a fake ledger. See the checks in the commit for this file.
  //
  // The contract it keeps: on failure it reports exactly how far it got. A launch that stops halfway
  // has left the user's XRP somewhere -- in a funded issuer, or in a token with no pool -- and the
  // one thing they must not be told is a generic "something went wrong".
  function runLaunch(env) {
    var plan = env.plan;
    var completed = [];
    var chain = Promise.resolve();

    plan.forEach(function (step, i) {
      chain = chain.then(function () {
        env.onStep(i, 'start', step);
        // Three signers: the user's wallet, the throwaway issuer, and the throwaway pool account. The last two are generated
        // in this browser for this launch and blackholed by the end, so signing for them locally is safe — the keys are
        // worthless the moment the plan finishes.
        var submit = step.by === 'user' ? env.submitUser
          : (step.by === 'pool' ? env.submitPool : env.submitIssuer);
        return submit(step.tx).then(function (hash) {
          // WAIT FOR VALIDATION, never just for submission. A submitted transaction has been
          // accepted by one server, not written to a ledger, and the next step depends on the
          // previous one having actually happened -- the issuer does not exist until its funding
          // validates, and the mint fails without the trustline.
          return env.waitValidated(hash).then(function (res) {
            if (!res || !res.ok) {
              throw new Error(step.what + ' was rejected by the ledger'
                + (res && res.code ? ' (' + res.code + ')' : '') + '.');
            }
            completed.push({ what: step.what, hash: hash });
            env.onStep(i, 'done', step);
          });
        });
      });
    });

    return chain
      .then(function () { return { ok: true, completed: completed }; })
      .catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e), completed: completed,
                 stoppedAt: completed.length };
      });
  }

  function hexAscii(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += (c < 16 ? '0' : '') + c.toString(16).toUpperCase();
    }
    return out;
  }

  // ---- the launch control ----------------------------------------------------------------------

  // ---- the real ledger, behind the same interface the fake one implements --------------------

  var RPC = 'https://xrplcluster.com/';
  var LIB = '/assets/vendor/xrpl-5.1.0.min.js';

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
    }).then(function (r) { return r.json(); });
  }

  function loadLib() {
    if (window.xrpl) return Promise.resolve(window.xrpl);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = LIB;
      s.onload = function () { window.xrpl ? res(window.xrpl) : rej(new Error('Signing library failed to load.')); };
      s.onerror = function () { rej(new Error('Signing library failed to load.')); };
      document.head.appendChild(s);
    });
  }

  // Fill in the three fields the ledger requires and the wallet does not supply for us. Sequence is
  // re-read before every issuer transaction rather than incremented locally: a locally tracked
  // sequence drifts the moment anything else touches the account, and the failure is a silent
  // tefPAST_SEQ rather than an error anyone can read.
  function autofill(tx, xrpl) {
    return Promise.all([
      rpc('account_info', { account: tx.Account, ledger_index: 'current' }),
      rpc('server_info', {}),
    ]).then(function (r) {
      var acct = r[0] && r[0].result && r[0].result.account_data;
      if (!acct) throw new Error('That account is not on the ledger yet.');   // the issuer or the pool account
      var info = r[1] && r[1].result && r[1].result.info;
      var base = (info && info.validated_ledger && info.validated_ledger.base_fee_xrp) || 0.00001;
      var ledger = (info && info.validated_ledger && info.validated_ledger.seq) || 0;
      var out = Object.assign({}, tx);
      out.Sequence = acct.Sequence;
      out.Fee = String(Math.max(10, Math.round(base * 1e6 * 2)));
      if (ledger) out.LastLedgerSequence = ledger + 20;
      return out;
    });
  }

  function submitIssuerTx(tx, wallet, xrpl) {
    return autofill(tx, xrpl).then(function (full) {
      var signed = wallet.sign(full);
      return rpc('submit', { tx_blob: signed.tx_blob }).then(function (j) {
        var res = j && j.result;
        var code = res && res.engine_result;
        // tesSUCCESS means accepted for this ledger, and tec* means it WILL be recorded as a
        // failure. Anything else was not applied at all, so there is no hash worth waiting on.
        if (!code || (code !== 'tesSUCCESS' && code.slice(0, 3) !== 'tec')) {
          throw new Error('The ledger refused the transaction' + (code ? ' (' + code + ')' : '') + '.');
        }
        return signed.hash;
      });
    });
  }

  // Poll until the transaction is in a validated ledger. `validated: false` is not failure -- it is
  // "not yet" -- so only a definitive answer stops the wait.
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    return rpc('tx', { transaction: hash, binary: false }).then(function (j) {
      var r = j && j.result;
      if (r && r.validated) {
        var code = (r.meta && r.meta.TransactionResult) || (r.metaData && r.metaData.TransactionResult);
        return { ok: code === 'tesSUCCESS', code: code };
      }
      if (n <= 0) return { ok: false, code: 'timed out waiting for validation' };
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return waitValidated(hash, n - 1); });
    });
  }

  var running = false;

  // INLINE, IN THE WIDE COLUMN -- no popup.
  //
  // This went through two wrong shapes. First it was inserted next to the launch button, which sits
  // in a ~200px summary column, so eight progress lines wrapped into a tall ribbon that collided
  // with the button. Then it became a modal, which fixed the layout and added a second confirmation
  // step the Stellar site does not have -- and this page IS the confirmation: it is titled "Review
  // Your Token", it carries an "This action is irreversible" panel, and the button reads "Confirm &
  // Launch". Asking again after that is noise.
  //
  // So progress renders in the main content column, which is wide enough to read, and the launch
  // starts on the button the user already pressed.
  function status(_anchor, html) {
    var box = $('#lxxMintStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lxxMintStatus';
      box.setAttribute('role', 'status');
      box.style.cssText = 'margin:18px 0;padding:16px 18px;border-radius:14px;font-size:13.5px;'
        + 'line-height:1.7;background:var(--surface-2,rgba(127,127,127,.07));'
        + 'color:var(--text,inherit);border:1px solid var(--border,rgba(127,127,127,.22))';

      // PLACED BETWEEN THE HERO CARD AND THE FIRST DETAIL CARD, which are siblings in the same
      // column. Two earlier attempts got this wrong in opposite directions, and both because the
      // anchor was chosen by ancestry rather than by name: `hero.closest('.card,.panel,section,div')`
      // matched the hero's own immediate div and dropped the box INSIDE the hero, over the token
      // name; widening it to `closest('.card,.panel,section')` from the General Info heading matched
      // a section wrapping the whole page and put the box above the page title. `.detail-card` is
      // the actual sibling boundary.
      var main = $('main.page') || document.body;
      var detail = $('.detail-card');
      if (detail && detail.parentElement) {
        detail.parentElement.insertBefore(box, detail);
      } else {
        main.insertBefore(box, main.firstChild);
      }
    }
    box.innerHTML = html;
    box.scrollIntoView({ block: 'nearest' });
    return box;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wireLaunch() {
    var el = $$('a, button').filter(function (e) {
      return /confirm\s*&\s*launch/i.test(e.textContent || '');
    })[0];
    if (!el) return;

    // THE LINK IS NEUTRALISED, not merely intercepted. Leaving the href in place means a
    // middle-click, a right-click "open in new tab", or a keyboard activation still reaches the
    // success page behind the handler's back — a confetti page for a token that was never issued.
    if (el.tagName === 'A') { el.removeAttribute('href'); el.setAttribute('role', 'button'); }

    // `running` is the MODULE-level flag on purpose. A `var running` here would shadow it, leaving
    // the modal's "do not close mid-launch" guard reading a variable that is always false -- the
    // guard would look present and do nothing.
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (running) return;

      var d = readDraft();
      if (!d) { status(el, 'No token details found — start again from the form.'); return; }

      var lxc = window.lxc;
      if (!lxc || !lxc.address()) { status(el, 'Connect a wallet first.'); return; }
      // XAMAN CAN SIGN NOW, AND STILL MAY NOT LAUNCH A TOKEN. Every other write path is ONE
      // transaction: leaving for the wallet and coming back is safe, because the worst case is a
      // transaction that did not happen. This is eight in a fixed order, four of them signed by the
      // user's wallet, and the last two are irreversible. Each Xaman approval leaves the browser, and
      // a phone is free to reload this page rather than restore it on the way back -- which would land
      // mid-sequence, with an issuer part-configured and real XRP already spent. Until the sequence
      // can survive a reload, this stays on the transports that prompt without leaving the page.
      if (lxc.transport && lxc.transport() === 'xaman') {
        status(el, esc('Launching a token needs a desktop wallet — GemWallet or Crossmark. The launch '
          + 'is eight approvals in a fixed order and must not be interrupted, and approving each one in '
          + 'Xaman means leaving this page eight times. Everything else on LumosCore signs fine in Xaman.'));
        return;
      }
      if (!lxc.canSign || !lxc.canSign()) {
        status(el, esc('This wallet connection cannot sign. Disconnect and connect again.'));
        return;
      }

      // CONFIRM BEFORE THE FIRST PROMPT, with the whole sequence and the total shown. Eight wallet
      // prompts arriving unannounced is indistinguishable from something going wrong, and the last
      // two are irreversible.
      var cfg = window.__lxxLaunchConfig || {};

      running = true;
      status(el, 'Reading the ledger…');

      // The rate is fetched HERE rather than read from a global the form page sets. This page does
      // not run the form's layer, so that global is never set on the review step -- and a missing
      // rate would silently price the fee at zero.
      Promise.all([rpc('server_info', {}), fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })])
        .then(function (both) {
        var j = both[0], p = both[1];
        var rate = (p && p.ok && p.usd > 0) ? p.usd : null;
        if (!rate) throw new Error('Could not price the launch in XRP right now.');
        // THE POOL FEE IS COLLECTED (RAZA 2026-09-17). The page has always billed `create + liq + pool`, but only `create`
        // was ever sent anywhere — the $10 pool line was displayed and never charged. lumoscore.com charges
        // `createFee + poolFee` to its collector, and this now matches it.
        var feeXrp = cfg.usd ? ((cfg.usd.create + (cfg.usd.pool || 0)) / rate) : 0;
        var liqXrp = cfg.usd ? (cfg.usd.liq / rate) : 0;

        var v = j && j.result && j.result.info && j.result.info.validated_ledger;
        var reserve = v ? Number(v.reserve_base_xrp) : 1;

        return loadLib().then(function (xrpl) {
          var issuer = xrpl.Wallet.generate();
          // The pool account: generated here, used for this launch only, blackholed by the last step. Nobody keeps its key
          // because nobody can use it afterwards — which is exactly what makes the liquidity permanently locked.
          var pool = xrpl.Wallet.generate();
          var plan = buildLaunchPlan(d, issuer.classicAddress, lxc.address(), reserve, {
            feeXrp: feeXrp, feeCollector: cfg.feeCollector, liquidityXrp: liqXrp,
            pool: pool.classicAddress,
          });

          var userSteps = plan.filter(function (s) { return s.by === 'user'; }).length;

          // CHECKED BEFORE THE FIRST PROMPT, never discovered halfway (lumoscore.com does the same, for the same reason).
          // This launch spends the user's XRP across four separate transactions, and the ledger has no way to undo the ones
          // that already landed: stopping at step 7 leaves a minted token, a funded issuer and no pool. So the whole cost is
          // added up and compared with what the account can actually spend — its balance less the reserve it must keep —
          // before anything is signed.
          var needXrp = plan.reduce(function (sum, s) {
            return sum + ((s.by === 'user' && typeof s.tx.Amount === 'string') ? Number(s.tx.Amount) / 1e6 : 0);
          }, 0) + 0.2 + 0.01;                              // + the user's own trustline reserve, + fees
          return rpc('account_info', { account: lxc.address(), ledger_index: 'validated' }).then(function (ai) {
            var ad = ai && ai.result && ai.result.account_data;
            if (ad) {
              var inc = (v && Number(v.reserve_inc_xrp)) || 0.2;
              var locked = reserve + (Number(ad.OwnerCount) || 0) * inc;
              var spendable = (Number(ad.Balance) || 0) / 1e6 - locked;
              if (spendable < needXrp) {
                running = false;
                status(el, 'Not enough XRP to finish this launch. It needs about <strong>'
                  + needXrp.toFixed(2) + ' XRP</strong> and this account can spend '
                  + Math.max(0, spendable).toFixed(2) + ' (the rest is held as the ledger’s reserve). '
                  + 'Nothing has been sent.');
                throw new Error('__lxxHandled');
              }
            }
            return null;
          }).then(function () {

          // Straight into it. The page above already asked, so this says what is about to happen
          // and then does it -- the wallet's own prompts are the remaining chances to say no.
          var log = [];
          status(el, '<strong>Launching ' + esc(d.name || 'your token') + '</strong> — '
            + plan.length + ' transactions, ' + userSteps + ' of which your wallet will ask you '
            + 'to approve. Keep this tab open.');

          return runLaunch({
              plan: plan,
              onStep: function (i, phase, step) {
                if (phase === 'start') log.push('· ' + esc(step.what) + '…');
                else log[log.length - 1] = '✓ ' + esc(step.what);
                status(el, log.join('<br>'));
              },
              submitUser: function (tx) { return lxc.submit(tx); },
              submitIssuer: function (tx) { return submitIssuerTx(tx, issuer, xrpl); },
              submitPool: function (tx) { return submitIssuerTx(tx, pool, xrpl); },
              waitValidated: waitValidated,
            }).then(function (res) {
              running = false;
              if (res.ok) {
                try {
                  localStorage.setItem('lumos.launch.result', JSON.stringify({
                    ok: true, issuer: issuer.classicAddress, pool: pool.classicAddress,
                    currency: d.currency,
                    ticker: d.ticker, name: d.name, supply: d.supply,
                    hashes: res.completed,
                  }));
                } catch (e) { /* private mode: the page still shows the result below */ }

                // SEND WHAT THE MINTER TYPED TO US, which until now nothing did.
                //
                // The name, description, socials and uploaded logo lived only in this browser's
                // localStorage — the launch flow POSTs to xrplcluster.com and /lxapi/xrplprices and
                // nowhere else — so closing this tab destroyed the only copy of the artwork for a
                // token that now exists forever. Stellar hit this exact wall: "FRANK was minted, the
                // fee arrived, and the asset page showed nothing."
                //
                // AFTER the result is stored and the success message is about to render, and its
                // failure is deliberately silent. The mint is done and irreversible by this point;
                // a metadata POST that fails must never turn a successful launch into an error
                // message. What the user sees is unchanged either way.
                //
                // The endpoint verifies against the FEE payment, which is what ties this submission
                // to a mint that actually paid us. Found by the step's own label, not by index:
                // `completed` holds {what, hash} objects and the fee step is skipped entirely when
                // the fee is zero, so completed[0] is only sometimes the right one — and when it is
                // not, it is the issuer funding payment, which the endpoint would reject with a
                // message about the wrong destination.
                try {
                  var feeHash = '';
                  (res.completed || []).forEach(function (c) {
                    if (c && c.what === 'Pay the launch fee' && c.hash) feeHash = c.hash;
                  });
                  if (feeHash) {
                    fetch('/lxapi/xrplmintmeta', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        code: d.currency, issuer: issuer.classicAddress, txHash: feeHash,
                        name: d.name, description: d.desc || '',
                        website: d.website || '', twitter: d.twitter || '', telegram: d.telegram || '',
                        logo: d.icon || '',
                      }),
                    }).catch(function () {});
                  }
                } catch (e) { /* never block a completed launch */ }

                status(el, log.join('<br>') + '<br><br><strong>Launched.</strong> Issuer '
                  + esc(issuer.classicAddress) + ' is blackholed, so the supply is fixed — and the pool account '
                  + esc(pool.classicAddress) + ' is blackholed too, so the liquidity can never be withdrawn by anyone.');
                return;
              }
              // A PARTIAL LAUNCH IS REPORTED IN FULL. The user's money has gone somewhere and the
              // one thing they must not be told is "something went wrong".
              //
              // The issuer address is shown ONLY when something actually happened. Nothing was
              // funded if the first prompt failed, so handing over an address and calling it "the
              // only record" would be telling the user to safeguard an account that does not exist.
              var tail = res.completed.length
                ? ('<br>The issuing account is <code>' + esc(issuer.classicAddress)
                   + '</code> — keep this, it is the only record of a launch that did not finish.')
                : '<br>Nothing was sent, so nothing was spent.';
              status(el, log.join('<br>') + '<br><br><strong>Stopped: ' + esc(res.error)
                + '</strong><br>' + res.completed.length + ' of ' + plan.length
                + ' transactions completed.' + tail);
            });
          });                                              // ← the affordability gate's chain
        });
      }).catch(function (e) {
        running = false;
        // The gate above has already explained itself on screen; anything else is a genuine failure to start.
        if (e && e.message === '__lxxHandled') return;
        status(el, 'Could not start: ' + esc((e && e.message) || e));
      });
    });
  }

  // ---- who is paying ----------------------------------------------------------------------------
  //
  // The panel shipped the design's mock: "Paying from rrrhDE…EwUw / Balance 842.16 XRP". Both are
  // fiction. It named an account the user does not control and quoted a balance forty times what
  // they actually held, directly above the button that spends it -- so a wallet without enough XRP
  // would still have looked ready to launch.
  function paintWallet() {
    var panel = $('.wallet-info');
    if (!panel) return;
    var lxc = window.lxc;
    var addr = lxc && lxc.address ? lxc.address() : null;

    var addrEl = panel.querySelector('.addr');
    var avEl = panel.querySelector('.av');
    var balEl = panel.querySelector('.balance .val');

    if (!addr) {
      if (addrEl) addrEl.textContent = 'Not connected';
      if (avEl) avEl.textContent = '—';
      if (balEl) balEl.textContent = '—';
      return;
    }

    // Same shape the header uses: six characters, an ellipsis, then four.
    if (addrEl) addrEl.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);
    if (avEl) avEl.textContent = addr.slice(0, 2).toUpperCase();
    if (balEl) balEl.textContent = '…';

    rpc('account_info', { account: addr, ledger_index: 'validated' }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error || !res.account_data) {
        // actNotFound means the account has never been funded, which is a real answer, not an error.
        if (balEl) balEl.textContent = (res && res.error === 'actNotFound') ? '0 XRP' : '—';
        return;
      }
      var drops = Number(res.account_data.Balance);
      var xrp = drops / 1e6;
      if (balEl) balEl.textContent = xrp.toFixed(2) + ' XRP';

      // A launch cannot be part-paid. Warn before the first prompt rather than after two
      // transactions have already gone through.
      var need = Number(window.__lxxLaunchTotalXrp || 0);
      if (need > 0 && xrp < need) {
        var warn = document.createElement('div');
        warn.style.cssText = 'margin-top:8px;font-size:12px;color:#e5484d';
        warn.textContent = 'This launch needs about ' + need.toFixed(2)
          + ' XRP and this wallet holds ' + xrp.toFixed(2) + '.';
        panel.appendChild(warn);
      }
    }).catch(function () { if (balEl) balEl.textContent = '—'; });
  }

  function load() {
    if (!$('.detail-row')) return;                   // not the review page
    paintReview();
    paintWallet();
    wireLaunch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed so the plan and the orchestrator can be inspected and tested without signing anything.
  window.__lxxLaunchPlan = buildLaunchPlan;
  window.__lxxRunLaunch = runLaunch;
  window.__lxxPaintReview = paintReview;
})();

