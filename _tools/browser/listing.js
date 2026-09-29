// Curated listing request, on the XRP Ledger.
//
// WHAT THIS REPLACES, and why it could not be left alone for one more day. The inherited Stellar
// layer (lx-listtoken) was still live on this page, and on THIS host it did the following:
//
//   1. asked /lxapi/listingquote for a price          -> 404, this project does not serve it
//   2. built a payment to the STELLAR fee collector    -> GAMZFXIJ…, real money, real mainnet
//   3. POSTed the resulting hash to /lxapi/listing     -> 404, this project does not serve it either
//
// So a user who got past step 1 would have paid a genuine Stellar mainnet fee from an XRP Ledger
// page, and the record of what they paid for would have gone nowhere. Taking money and losing the
// reason for it is the worst outcome available here, which is why the Stellar layer is stripped
// rather than left running while this is finished.
//
// WHAT THIS DOES. It states the real terms — the fee in XRP at the live rate, paid to the XRP Ledger
// collector this project actually uses — and it does NOT take payment, because there is nowhere on
// this project to record a listing request yet. That is a provisioning decision (a KV or D1 binding
// on lumoscore-xrpl), not something to invent. The button says so plainly instead of looking ready.
//
// The moment a store exists this file needs only its submit half: the quote, the collector, the
// validation and the copy are all here and all correct.
(function () {
  if (window.__lxxListing) return;
  window.__lxxListing = 1;

  // The same account the launchpad pays, and it is checksum-verified at BUILD time in
  // _tools/_xrplaunchpad.js rather than trusted here: a single wrong character in a collector address
  // sends every fee LumosCore ever takes to an account nobody holds the key to. Verified on-ledger to
  // hold no trust lines and to carry neither RequireDestTag, DisallowXRP, DepositAuth nor GlobalFreeze
  // — so it can receive XRP, and only XRP.
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';

  function $(s) { return document.querySelector(s); }

  function money(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // The fee in USD is whatever the page already declares. Read from the markup rather than repeated
  // here, so the number beside the button and the number charged cannot drift apart — the Stellar
  // build has a comment about exactly that ("250 beside a button charging something else").
  function usdFee() {
    var el = $('#ltFee2') || $('#ltFee');
    var m = el && (el.textContent || '').match(/([\d,.]+)/);
    var v = m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
    return isFinite(v) && v > 0 ? v : null;
  }

  function fixCopy() {
    // The design's own words, with the chain corrected. "charged in XLM at the rate below" and
    // "paid separately to Stellar" are both simply false on this build.
    //
    // THE SELECTOR STARTED TOO NARROW. Only .lt-help and .lt-hint were swept, which left the fee
    // facts — "Paid in XLM at the live rate", "In full, in XLM, to the account that paid" — and the
    // stranded-payment note still quoting the wrong asset, on the page where someone decides how much
    // to send. Found by re-sweeping the page rather than by re-reading this function.
    //
    // Walked as text nodes across every prose block on the page, so a sentence the design split
    // across <strong> or <a> is corrected without touching its markup.
    var BLOCKS = '.lt-help, .lt-hint, .lt-fact-d, .lt-stranded p, .lt-note, .lt-faq-a';
    [].forEach.call(document.querySelectorAll(BLOCKS), function (p) {
      if (p.__lxdone || !/XLM|Stellar/.test(p.textContent || '')) return;
      p.__lxdone = 1;
      var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var nd;
      while ((nd = w.nextNode())) {
        if (!nd.nodeValue) continue;
        nd.nodeValue = nd.nodeValue
          .replace(/\bXLM\b/g, 'XRP')
          .replace(/\bon Stellar\b/g, 'on the XRP Ledger')
          .replace(/\bStellar\b/g, 'the XRP Ledger');
      }
    });
    var to = $('#ltTo');
    if (to) { to.textContent = COLLECTOR; to.setAttribute('title', COLLECTOR); }

    // THE FORM CONTROLS ARE NOT PROSE, and the walk above only reaches text nodes inside the blocks
    // listed in BLOCKS. So the two fields a person actually fills in were still Stellar's:
    //
    //   <select id="ltNet"> carried exactly ONE option, `stellar | Stellar` — the network picker on
    //   an XRP Ledger site offering only the other chain, above a sentence saying LumosCore curates
    //   on the XRP Ledger today.
    //
    //   <input id="ltIssuer" placeholder="G…"> — G is STELLAR's address prefix. XRPL issuers start
    //   with r, so the field was prompting for an address of the wrong shape entirely, on the one
    //   input where a wrong value cannot be recovered from later.
    //
    // Nothing is submitted from this page yet (see the header), so neither had reached a record --
    // but both are read by anyone filling the form in, and the placeholder is the kind of hint people
    // copy the shape of.
    var net = $('#ltNet');
    if (net && net.tagName === 'SELECT') {
      var opts = net.options || [];
      var hasXrpl = false;
      for (var i = 0; i < opts.length; i++) {
        if (String(opts[i].value).toLowerCase() === 'xrpl') { hasXrpl = true; break; }
      }
      if (!hasXrpl) {
        // Rewritten in place rather than replaced: the design owns this control, and a fresh <select>
        // would lose whatever styling and listeners it ships with.
        for (var j = opts.length - 1; j >= 0; j--) net.remove(j);
        var o = document.createElement('option');
        o.value = 'xrpl';
        o.textContent = 'XRP Ledger';
        net.appendChild(o);
      }
      net.value = 'xrpl';
    }
    var iss = $('#ltIssuer');
    if (iss && /^G/.test(iss.getAttribute('placeholder') || '')) {
      iss.setAttribute('placeholder', 'r…');
    }
  }

  // The live rate, from the same endpoint the rest of the build prices against, so the listing fee
  // and every other USD figure on this site agree about what an XRP is worth.
  function quote() {
    var usd = usdFee();
    var amtEl = $('#ltAmt'), rateEl = $('#ltRate');
    if (!amtEl || usd == null) return;
    fetch('/lxapi/xrplprices')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var px = j && j.ok && +j.usd;
        if (!(px > 0)) throw new Error('no rate');
        var xrp = usd / px;
        // Rounded UP to whole drops so the collector is never a fraction short of the stated fee.
        xrp = Math.ceil(xrp * 1e6) / 1e6;
        amtEl.textContent = money(xrp) + ' XRP';
        if (rateEl) rateEl.textContent = '1 XRP = $' + px.toFixed(4);
      })
      .catch(function () {
        // Never a guessed rate: an invented number here is a price someone would be charged.
        amtEl.textContent = '—';
        if (rateEl) rateEl.textContent = 'rate unavailable';
      });
  }

  // The button is left in place and disabled, wearing the design's own disabled treatment, with the
  // reason on it. An enabled button that silently does nothing is the thing this avoids.
  function holdButton() {
    var go = $('#ltGo');
    if (!go || go.__lxheld) return;
    go.__lxheld = 1;
    go.disabled = true;
    go.style.opacity = '.6';
    go.style.cursor = 'not-allowed';
    var t = $('#ltGoT') || go;
    t.textContent = 'Listing requests open with the XRP Ledger launch';
    go.setAttribute('title',
      'The fee and the collector are live; requests need somewhere to be recorded before payment can be taken.');
    go.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  }

  function boot() {
    if (!$('#ltGo') && !$('#ltAmt')) return;               // not the listing page
    fixCopy();
    quote();
    holdButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
