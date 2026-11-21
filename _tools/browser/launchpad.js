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
  // WHERE THE MONEY GOES, as of 2026-09-17 (RAZA's locked-liquidity design):
  //   create + pool  -> LumosCore's collector. BOTH lines are charged now; `pool` used to be displayed and never sent.
  //   liq            -> the pool account, and from there into the AMM. NOT withdrawable by anyone, ever: that account
  //                     blackholes itself on the last step, which is the whole point of the design.
  //   issuer funding -> ~1.02 XRP, locked forever in the blackholed issuer (measured against three live launches).
  //   pool funding   -> ~1.85 XRP of reserves + the AMMCreate burn, likewise locked in a dead account.
  // So roughly 2.9 XRP per launch is permanently out of circulation, and the only recoverable part is nothing at all —
  // which is what "the liquidity cannot be rugged" costs.
  var USD_REAL = { create: 5, liq: 10, pool: 10 };
  // LIVE PRICING, from 2026-10-15. RAZA, asked directly whether to flip before the push to main:
  // "yes flip the pricing to the real $5/$10/$10".
  //
  // Recorded because the line above says to restore these "once a test launch has succeeded", and
  // that has NOT happened -- the ~3.4 XRP GemWallet round-trip is still the open item, and it needs
  // a real device. The flip was his call with that stated; it is not an inference from a green run.
  //
  // What changes for a launcher the moment this ships: $25 instead of $2, of which $10 goes into the
  // AMM and is unrecoverable by design, plus ~2.9 XRP permanently out of circulation in the
  // blackholed issuer and pool accounts. Nothing here is refundable, so if the launch slips, put
  // this back to { create: 0.50, liq: 1.50, pool: 0 } rather than leaving it live.
  // WRITTEN AS A LITERAL, NOT `= USD_REAL`. _xrplaunchpad.js parses this exact line --
  //     /var\s+USD\s*=\s*\{\s*create:\s*([\d.]+)\s*,\s*liq:\s*([\d.]+)/
  // -- to bake the price into the page copy AND into lx-faq-ld, the FAQPage structured data search
  // engines read. Its own note records why: the page once quoted one price and charged another.
  // An alias defeats that parser, and it aborted the build rather than shipping prose that disagreed
  // with the charge. Keep both numbers here in literal form so the copy follows the money.
  var USD = { create: 5, liq: 10, pool: 10 };
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
    // A JS-INJECTED GATE CANNOT FIX A FLASH IN MARKUP THAT PRECEDES IT, and widening this selector to
    // cover the phone's sticky bar was my first answer to RAZA's 2026-10-23 report ("It shows apt for
    // split seconds when the page is refreshed"). It did not work, and could not have: measured in the
    // built page, the mock sits at byte 183,670 and this stylesheet is appended at byte 676,296. The
    // browser parses, lays out and paints that bar nearly half a megabyte before it reaches the script
    // that would hide it. On a phone, on a ~1.2MB page, that window is long enough to read.
    //
    // I had "verified" the widened selector by stripping .lxx-costready after load and watching the
    // cell go hidden. That proves the SELECTOR MATCHES. It says nothing about whether the rule exists
    // at first paint, which was the entire question.
    //
    // The mock is gone from the shipped markup instead -- see _xrplaunchpad.js -- so there is nothing
    // left to flash whenever this runs. These selectors are back to what they were.
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

    // THE $10 POOL FEE WAS QUOTED NOWHERE AND CHARGED ANYWAY. NO BACKTICKS IN THIS COMMENT.
    //
    // RAZA 2026-10-20: "Why is the launch cost $19 instead of $25." Because this row carried only
    // the LEDGER's costs. The row is literally called "Liq. pool & network" and it was showing the
    // network half alone — the base reserve that makes the issuing account exist, plus the owner
    // reserve AMMCreate consumes — while USD.pool, the ten dollars named in the very same label,
    // was left out of both the row and the total.
    //
    // It is not left out of the CHARGE. mint.js builds the collector payment as
    //     (cfg.usd.create + cfg.usd.pool) / rate
    // — fifteen dollars — against a panel promising five. So the quote under-reported by exactly the
    // pool fee, and the gap was invisible precisely because the panel is internally consistent: the
    // dollars beside each row are computed from the same rate as its XRP, so "14.6 XRP ≈ $19.02" is
    // arithmetically perfect and still the wrong number.
    //
    // That is the dangerous shape of this bug. A stale rate would have made the two halves disagree
    // and shown itself. A missing TERM keeps them in step and simply quotes less than it takes.
    //
    // Both costs now sit in the row that names them. The ledger's reserves stay — they are real, they
    // are unavoidable, and the total has to mean every drop that leaves the wallet.
    // AND THE TOTAL IS THE $25, NOT $29 (RAZA 2026-10-20, on the fix above: "This is supposed to be
    // $25 total. Why's it now $29 in $ value").
    //
    // The first pass put the ledger's reserve in this row too, on the earlier principle that the total
    // "has to mean every drop that leaves the wallet". RAZA's contract is simpler and it is his to
    // set: the launch costs $25 — five to create, ten for the pool, ten of liquidity — and the XRP
    // Ledger's reserve is not something LumosCore charges. Most of it is not even spent: a reserve is
    // locked, and the owner reserve comes back if the object is ever removed.
    //
    // So the three priced rows sum to exactly $25 and the reserve moves OUT of the total — but NOT out
    // of sight, which was the other half of the old reasoning and the half worth keeping. It gets its
    // own line under the total, because a wallet still needs that XRP on hand and discovering it at
    // the signing step is the surprise this panel exists to prevent.
    var poolXrp = (USD.pool || 0) / xrpUsd;

    setCost('create', createXrp, createXrp * xrpUsd);
    setCost('liq', liqXrp, liqXrp * xrpUsd);
    setCost('pool', poolXrp, poolXrp * xrpUsd);

    var totalXrp = createXrp + liqXrp + poolXrp;
    reserveNote(ledgerXrp(), xrpUsd);
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
  // unreachable. The per-account figures below match the issuer and pool funding in buildLaunchPlan —
  // if one changes, so must the other, or the quote stops matching the transaction.
  var ledger = { base: 1, owner: 0.2 };
  // WHAT THE LEDGER ITSELF TAKES, counted the way browser/mint.js actually spends it.
  //
  // This was `(base + 0.5) + owner` = 1.70 XRP, which is not any figure the launch uses. The plan
  // funds TWO throwaway accounts, and both are funded to the drop because a pool account a fraction
  // under its own reserve dies on the last step:
  //
  //   issuer   base + 0.05          mint.js — 0.02 until 2026-11-03, when the open ledger fee hit 5,020
  //                                 drops and 0.02 stopped covering the issuer's four transactions
  //   pool     base + 0.85          mint.js:233 — base 1.00 + two trust lines 0.40 + AMMCreate 0.20
  //                                 + 0.25 margin; the lpXrp on top of it is the liquidity row, so
  //                                 it is NOT counted here or it would be charged twice
  //   + owner                       the launcher's own trust line for the new token
  //   + 0.05                        transaction fees — 0.01 until 2026-11-03; see mint.js FEE_BUDGET
  //
  // = 2 x base + 0.95 + owner, which is 3.15 against today's reserve schedule.
  //
  // THE QUOTE WAS UNDER-REPORTING BY 45%. The panel said "Total Cost 3.04 XRP" and the pre-flight
  // check in mint.js — which sums the REAL plan — refused the same launch saying it needs 4.42.
  // Someone reading the page would fund 3.5 XRP and be turned away by the product's own arithmetic.
  // Both numbers are now computed from the same constants, so they can only disagree if one of these
  // files changes without the other.
  function ledgerXrp() { return (2 * ledger.base) + 0.95 + ledger.owner; }

  // The reserve, said out loud and kept out of the total. It is the XRP Ledger's charge, not ours, so
  // it does not belong in a figure labelled "total launch cost" — but the wallet still has to hold it,
  // and the review step checks the FULL amount before the first signature. A reader who budgets for
  // the total alone and is then refused at review would have been told the truth and still misled.
  //
  // Written once under the total row and updated in place afterwards, so a repaint cannot stack it.
  function reserveNote(xrp, rate) {
    if (!(xrp > 0) || !(rate > 0)) return;
    var totalCell = costCell('total');
    var row = totalCell && totalCell.closest ? totalCell.closest('.cost-total, .cost-row') : null;
    if (!row || !row.parentNode) return;
    var note = document.getElementById('lxx-reserve-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'lxx-reserve-note';
      note.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.35;opacity:.7';
      row.parentNode.insertBefore(note, row.nextSibling);
    }
    var usd = xrp * rate;
    // WRITE ONLY WHEN THE VALUE IS ACTUALLY WRONG — the same rule setCost() states above, and for the
    // same reason, which this function was simply not following.
    //
    // THIS FROZE THE PAGE. watchCosts() observes this element's container with
    // {childList, characterData, subtree} and calls paintCosts on every mutation; paintCosts calls
    // reserveNote; and `note.textContent = …` replaces the text node whether or not the string
    // changed, so it mutates every time. Observer -> paint -> mutate -> observer, as microtasks, which
    // never yield to the event loop. Measured on the deployed build and on a local one: the XRPL
    // launchpad stops responding to anything about four seconds after load — the moment
    // /lxapi/xrplprices answers and the first paint runs — and stays dead. Stellar's launchpad is
    // unaffected; it has no reserve line.
    //
    // RAZA 2026-11-07 reported this as "'How it works' isn't linked to anything". The link is wired
    // (a window-capture listener in launchhiw.js) and the dialog is on the page. Nothing is unbound:
    // by the time anyone reaches that link the renderer has been spinning for seconds, so every
    // click on the page is dropped, not just that one.
    //
    // setCost's note explains why a `writing = true` flag cannot fix this and comparing against the
    // DOM can. One sentence covers the whole element here, so one comparison is enough.
    var txt = '+ ' + xrp.toFixed(2) + ' XRP reserve on the XRP Ledger (≈ $'
      + (usd % 1 === 0 ? Math.round(usd).toLocaleString('en-US') : usd.toFixed(2))
      + '), held by the network — not a LumosCore fee.';
    // "XRP XRP Ledger reserve" while I was here: the unit and the ledger's name ran together, and the
    // line is read by someone deciding how much to fund.
    if (note.textContent !== txt) note.textContent = txt;
  }

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

  // The three social inputs used to carry NO id and no name -- only a placeholder, and matching on
  // that was the only handle the markup offered. Without it the review page shows the design's own
  // accounts (t.me/solarflare) beside the user's token.
  //
  // `_xrplcopy2.js` now stamps `data-lxlpsoc="tg|x|web"` on each of them, for two reasons. The
  // placeholder copy changed -- it asked for "x.com/yourproject", which is the input that made a
  // Stellar mint link to a doubled host on 2026-11-05
  // ([[social-links-stored-a-url-in-a-handle-field]]) -- and a placeholder that is BOTH the copy and
  // the selector cannot be corrected without breaking the read. The two social boxes now share the
  // placeholder "@yourproject" and no longer identify themselves at all.
  //
  // The regex is kept as a FALLBACK for a container the stamp has not reached. Do not drop it on the
  // strength of "the attribute is there now": an unmatched read returns "" and an empty social link
  // is indistinguishable from a minter who left the field blank.
  //
  // Selected as `input` and filtered on the PROPERTY, not as `input[type=text]`: these fields carry
  // no type attribute at all, so the attribute selector matches none of them and every social link
  // came back empty while looking like it had been read.
  function bySoc(key, re) {
    var f = $$('input').filter(function (i) { return i.getAttribute('data-lxlpsoc') === key; })[0];
    if (!f) {
      f = $$('input').filter(function (i) {
        return i.type === 'text' && re.test(i.placeholder || '');
      })[0];
    }
    return f ? String(f.value || '').trim() : '';
  }

  function readForm() {
    var num = function (s) { return Number(String(s || '').replace(/[, ]/g, '')); };
    return {
      telegram: bySoc('tg', /t\.me/i),
      twitter: bySoc('x', /x\.com|twitter/i),
      website: bySoc('web', /yourproject\.com|https?:\/\//i),
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
    // `rate=1`, because the two fields read below are the only ones this page wants and the full
    // answer is ~77KB of 601 token prices. RAZA, 2026-11-16, of this page on a phone: "why isn't it
    // showing the cost" — the rate lost the eight-second race above and every cost cell became an
    // em dash. Same numbers, same cache, a fraction of the bytes. See functions/lxapi/xrplprices.js.
    fetch('/lxapi/xrplprices?rate=1')
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
        return lxpost('https://xrplcluster.com/', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'server_info', params: [{}] }),
        }).then(function (j) {
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
