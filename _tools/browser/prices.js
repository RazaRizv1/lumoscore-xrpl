// Fills the wallet's Price and 7d columns.
//
// Runs AFTER wallet.js has painted, and re-runs when it repaints, because the rows it writes into
// are created by that layer -- a one-shot pass at DOMContentLoaded would find an empty container and
// silently do nothing, which is the single most common way a "the data never showed up" bug happens
// in this codebase.
//
// Prices come from /lxapi/xrplprices, never straight from the upstream: the anonymous tier there is
// 333 requests per DAY per IP, so a browser-direct fetch would exhaust it in a few page views and
// take out an entire CGNAT'd mobile carrier at once. See functions/lxapi/xrplprices.js.
//
// A missing price renders as an em dash. It never renders as 0, and never as a stale figure from a
// previous token: on an asset list, a wrong number beside the right name is worse than no number,
// because there is nothing on screen to tell you it is wrong.
(function () {
  if (window.__lxxPrices) return;
  window.__lxxPrices = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var data = null;

  function slug(issuer, currency) { return String(issuer || '') + '-' + String(currency || ''); }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    // Sub-cent tokens are the norm on this ledger; 2dp would render most of a wallet as "$0.00".
    if (v < 0.000001) return '$' + v.toExponential(2);
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fetchPrices(slugs) {
    var q = slugs.length ? ('?t=' + encodeURIComponent(slugs.slice(0, 24).join(','))) : '';
    return fetch('/lxapi/xrplprices' + q)
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.ok) ? j : null; })
      .catch(function () { return null; });
  }

  // The two layouts the wallet paints into. Kept in one place so a change to either cannot leave the
  // other silently unfilled -- writing only the desktop one is the most repeated bug in this project.
  function targets() {
    var out = [];
    var tb = $('#assetsTable');
    if (tb) {
      [].forEach.call(tb.children, function (tr) {
        if (tr.children.length < 4) return;
        out.push({ row: tr, price: tr.children[1], chg: tr.children[2] });
      });
    }
    var cards = $('#assetList');
    if (cards) {
      [].forEach.call(cards.children, function (c) {
        if (!c.classList || !c.classList.contains('asset-row')) return;
        out.push({ row: c, price: null, chg: null, card: true });
      });
    }
    return out;
  }

  function apply() {
    if (!data) return;
    var held = (window.__lxxData && window.__lxxData.held) || [];
    var xrp = window.__lxxData && window.__lxxData.xrp;
    var t = targets();
    if (!t.length) return;

    // The wallet paints XRP first (when present), then held tokens in the same order as this array,
    // so index maps to row. Reading the name out of the DOM instead would tie this to display text.
    var seq = [];
    if (xrp) seq.push({ xrp: true });
    for (var i = 0; i < held.length; i++) seq.push(held[i]);

    for (var j = 0; j < t.length && j < seq.length; j++) {
      var item = seq[j], cell = t[j];
      var usd = null, ch7 = null;

      if (item.xrp) {
        usd = data.usd;                                   // 1 XRP, by definition
        var x = data.t['XRP'];
        ch7 = x ? x[2] : null;
      } else {
        var row = data.t[slug(item.issuer, item.currency)];
        if (row) {
          usd = (data.usd != null) ? row[0] * data.usd : null;
          ch7 = row[2];
        }
      }

      if (cell.card) {
        paintCard(cell.row, usd, ch7);
      } else {
        cell.price.textContent = money(usd);
        paintChange(cell.chg, ch7);
      }
    }

    // ---- Total Portfolio ---------------------------------------------------------------------------
    // The design ships this block as a mock — 31,108.45 APT, $12,847.62, +11.08% — and it stayed that
    // way above a correctly priced list. That is the worst combination: the headline contradicted the
    // rows beneath it, and only the headline was wrong, so the page looked authoritative while lying
    // about the number people read first.
    //
    // Summed from the SAME rows that were just priced, so the two cannot drift apart.
    var totUsd = 0, weighted = 0, pricedAny = false;
    for (var k = 0; k < seq.length; k++) {
      var it2 = seq[k], bal = 0, u2 = null, c2 = null;
      if (it2.xrp) {
        bal = (xrp && xrp.balance) || 0;
        u2 = data.usd;
        var xr = data.t['XRP'];
        c2 = xr ? xr[2] : null;
      } else {
        bal = +it2.balance || 0;
        var r2 = data.t[slug(it2.issuer, it2.currency)];
        if (r2) { u2 = (data.usd != null) ? r2[0] * data.usd : null; c2 = r2[2]; }
      }
      if (u2 == null || !isFinite(u2) || !(bal > 0)) continue;
      var v2 = bal * u2;
      totUsd += v2; pricedAny = true;
      if (c2 != null && isFinite(c2)) weighted += v2 * c2;
    }
    if (pricedAny) paintTotal(totUsd, totUsd > 0 ? (weighted / totUsd) : null);

    attribution();
  }

  // Fills the design's own Total Portfolio block. The elements are the design's and are reused in
  // place — only their text changes, so the type scale, the unit span and the up/down pill keep
  // whatever styling they shipped with.
  //
  // The 7-day figure is VALUE-WEIGHTED from each token's own 7d change, not invented: a holding worth
  // 90% of the wallet moves the number 90% as much. It assumes the balances were the same a week ago,
  // which is the same assumption any "portfolio change" makes without a balance history to read.
  function paintTotal(totUsd, ch7) {
    // Resolved by wallet.js, which is injected just above this file, because the phone's hero uses
    // different class names entirely — see the note on totalBlock() there. Keying on `.value-side`
    // meant this returned immediately on mobile and the design's fabricated total stood.
    var vs = (window.lxxTotals && window.lxxTotals()) || null;
    if (!vs || !data || !(data.usd > 0)) return;
    var xrpTot = totUsd / data.usd;

    var vEl = vs.value;
    if (vEl) {
      // The unit is the design's own span inside .value. NOT matched on .lxp: that class is added by
      // the Stellar wallet layer, which this build strips, so keying on it found nothing and left the
      // ticker reading "APT" beside a correct XRP total. The span is the only child here.
      var unit = vEl.querySelector('span');
      var first = vEl.firstChild;
      var txt = xrpTot.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ';
      if (first && first.nodeType === 3) first.nodeValue = txt;
      else vEl.insertBefore(document.createTextNode(txt), vEl.firstChild);
      if (unit) unit.textContent = 'XRP';
    }

    var sub = vs.sub;
    if (sub) sub.textContent = '≈ ' + money(totUsd) + ' USD';

    if (ch7 == null || !isFinite(ch7)) return;
    var pill = vs.pill;
    if (pill) {
      // wallet.js hides this while the mock is cleared, so it has to be un-hidden here rather than
      // left invisible with correct text inside it.
      pill.style.visibility = '';
      var pTxt = (ch7 >= 0 ? '+' : '') + ch7.toFixed(2) + '%';
      var last = pill.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = ' ' + pTxt;
      else pill.appendChild(document.createTextNode(' ' + pTxt));
      pill.classList.toggle('up', ch7 >= 0);
      pill.classList.toggle('down', ch7 < 0);
    }
    var sec = vs.secondary;
    if (sec) {
      // The XRP the change is worth: today's total minus what the same holdings were worth.
      var was = xrpTot / (1 + ch7 / 100);
      var d = xrpTot - was;
      sec.textContent = (d >= 0 ? '+' : '') + d.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' XRP';
    }
  }

  function paintChange(el, v) {
    var s = pct(v);
    el.textContent = s == null ? '—' : s;
    el.style.color = s == null ? '' : (v >= 0 ? 'var(--green,#22c55e)' : '#e5484d');
  }

  // The card layout has no price column, so one is added under the balance rather than squeezed in
  // beside it. Idempotent: repainting replaces the node instead of stacking a second one.
  function paintCard(card, usd, ch7) {
    var block = card.querySelector('.asset-balance-block');
    if (!block) return;
    var old = block.querySelector('.lxx-px');
    if (old) old.parentNode.removeChild(old);
    if (usd == null && ch7 == null) return;
    var d = document.createElement('div');
    d.className = 'lxx-px';
    d.style.cssText = 'font-size:12px;font-weight:600;margin-top:2px;opacity:.85';
    d.textContent = money(usd);
    var s = pct(ch7);
    if (s != null) {
      var sp = document.createElement('span');
      sp.textContent = '  ' + s;
      sp.style.color = ch7 >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
      d.appendChild(sp);
    }
    block.appendChild(d);
  }

  // xrpl.to's terms require a visible link wherever this data is shown. Rendered from the payload's
  // own fields so it cannot drift from what the source actually asks for, and inserted once.
  // Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10 once xrpl.to's own API
  // was found stating the requirement verbatim in its response body — see the fuller note in
  // browser/trade.js.
  function attribution() {
    if (!data || !data.attribution) return;
    if (document.getElementById('lxx-attr')) return;
    var host = $('#assetsTable') || $('#assetList');
    if (!host) return;
    var anchor = host.closest('section, .card, main') || host.parentElement;
    if (!anchor) return;
    var p = document.createElement('p');
    p.id = 'lxx-attr';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Prices '));
    var a = document.createElement('a');
    a.href = data.attributionUrl || 'https://xrpl.to';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = data.attribution;
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    anchor.appendChild(p);
  }

  // A SINGLE ATTEMPT WAS NOT ENOUGH, and the way it failed is the reason this retries.
  //
  // The Total Portfolio headline ships as a mock: 31,108.45 APT. This layer is what replaces it, so
  // any path where this layer quietly stops leaves that fabricated Aptos figure standing as the
  // largest number on the page, above ten real XRP Ledger holdings. There were two such paths, and
  // both ended in `return` with nothing logged:
  //
  //   * the fetch fails or the upstream is briefly rate-limited -> data stays null, forever;
  //   * the fetch SUCCEEDS but resolves before wallet.js has painted its rows -> apply() finds no
  //     targets, returns, and is never called again.
  //
  // Measured: the page settled correctly at ~2.1s on one load and was still showing the mock nine
  // seconds into another. That is the signature of a race, not of a broken endpoint.
  //
  // So: retry the fetch a few times with a widening gap, and once data is in, keep re-applying until
  // the rows it needs actually exist. Both loops are bounded — a page that genuinely has no prices
  // ends up with em dashes and a blank total, which is the honest outcome, not a made-up one.
  function start(attempt) {
    if (!$('#assetsTable') && !$('#assetList')) return;      // not a wallet page
    attempt = attempt || 1;
    var held = (window.__lxxData && window.__lxxData.held) || [];
    var slugs = held.map(function (h) { return slug(h.issuer, h.currency); });
    fetchPrices(slugs).then(function (j) {
      if (!j) {
        if (attempt < 4) setTimeout(function () { start(attempt + 1); }, attempt * 1500);
        return;                                              // then leave the dashes; say nothing false
      }
      data = j;
      apply();

      // ATTRIBUTION IS CALLED HERE TOO, not only from the end of apply().
      //
      // BELT AND BRACES, NOT A PROVEN BUG — said plainly because the first version of this comment
      // claimed more than was measured. attribution() opens with `if (!data ...) return`, and its
      // only caller was apply(), which can run before this assignment. I saw the line missing once
      // and present once on an unchanged build, so the single call is TIMING-DEPENDENT rather than
      // reliably broken; the absence I first blamed on ordering turned out to be a deploy that had
      // not propagated.
      //
      // Calling it where `data` is known to exist makes it deterministic instead of a race, and it
      // is idempotent — the function returns early once #lxx-attr is on the page. For a line that
      // has to be there for licensing reasons, deterministic is worth one extra call.
      attribution();
      // apply() is a no-op until the rows are on the page. Watch for them rather than assume.
      var n = 0;
      var t = setInterval(function () {
        if (++n > 20) { clearInterval(t); return; }           // ~10s
        if (!targets().length) return;
        clearInterval(t);
        apply();
      }, 500);
    });
  }

  // wallet.js finishes asynchronously and can repaint. Waiting for its data rather than for the DOM
  // is what makes this reliable; the interval gives up rather than spinning forever.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.__lxxData) { clearInterval(timer); start(); }
    else if (tries > 60) clearInterval(timer);               // ~30s, then stop
  }, 500);

  window.__lxxPricesApply = apply;
})();
