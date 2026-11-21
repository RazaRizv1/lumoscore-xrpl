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

  // One formatter for both cells printed "$3.00e-7" for a dust value and rounded SOLO's $0.011744 to
  // "$0.01". A value that small is nothing; a price that small is the whole figure. Both rules below
  // are Stellar's usd() and pStr from _walletdata.js, thresholds included.

  // A value: to the cent under a thousand, then whole dollars, then M/B.
  function usdVal(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return '$' + (a >= 1e9 ? (v / 1e9).toFixed(2) + 'B'
      : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
      : a >= 1e3 ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : v.toFixed(2));
  }

  // A price: 2dp at a dollar and up, 4dp down to a cent, and below a cent written out far enough to
  // show the figure with trailing zeros trimmed. Never exponential, however small it gets.
  function usdPx(v) {
    if (v == null || !isFinite(v) || !(v > 0)) return '—';
    if (v >= 1) return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    var d = Math.min(18, Math.max(4, 2 - Math.floor(Math.log(v) / Math.LN10)));
    return '$' + v.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
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

      var ch24 = null, pxXrp = null;
      if (item.xrp) {
        usd = data.usd;                                   // 1 XRP, by definition
        var x = data.t['XRP'];
        ch24 = x ? x[1] : null;
        ch7 = x ? x[2] : null;
      } else {
        var row = data.t[slug(item.issuer, item.currency)];
        if (row) {
          usd = (data.usd != null) ? row[0] * data.usd : null;
          ch24 = row[1];
          ch7 = row[2];
          pxXrp = row[0];
        }
      }

      if (cell.card) {
        // THE 24h FIGURE, matching the desktop cell beside it. This passed `ch7` while the table's
        // price cell was changed to carry the 24h move, so the same holding reported two different
        // percentages depending on the device: XRP read "-4.26%" on a desktop and "-7.92%" on a
        // phone, one measured over a day and the other over a week, neither labelled. The phone's
        // card has one percentage slot, so it shows the same period the desktop's does.
        paintCard(cell.row, usd, ch24);
      } else {
        // THE HEADER OVER THIS CELL READS "PRICE · 24H" AND THE CELL HELD ONLY A PRICE. The 24h
        // change was in the payload the whole time — the entry is [price, change24h, change7d] and
        // only [2] was ever read. lumoscore.com puts both in this one cell ("$0.1759 -4.63%"), which
        // is what makes its header true, and the classes it uses are already styled in the inherited
        // sheet: `#assetsTable .price-cell .lx-p1{display:flex;…}` and `.lx-chg`. Building it any
        // other way would mean writing CSS for a cell the design already dressed.
        priceCell(cell.price, usd, ch24, pxXrp);
        // "≈ $x" under the balance, as Stellar's balance cell has it.
        var b2 = cell.row.querySelector('.b2');
        if (b2) {
          var bal0 = item.xrp ? ((xrp && xrp.balance) || 0) : (+item.balance || 0);
          b2.textContent = (usd != null && bal0 > 0) ? ('≈ ' + usdVal(bal0 * usd)) : '';
        }
        // Still written, though the column is hidden to match Stellar — see the note in wallet.js.
        // Costs nothing and keeps the cell honest if that column is ever brought back.
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
    // The "Total worth: ~X XRP" on the My Assets heading, written by wallet.js's summary.
    window.__lxxWorthXrp = xrpTot;
    try {
      var me0 = localStorage.getItem('lumos.address');
      if (me0 && totUsd > 0 && !window.__lxxPaintingCached) localStorage.setItem('lumos.xrpl.total.' + me0, JSON.stringify({ x: xrpTot, u: totUsd, c: ch7, t: Date.now() }));
    } catch (e) {}
    try { if (window.__lxxSetChip) window.__lxxSetChip(); } catch (e) {}

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
      if (unit) { unit.textContent = 'XRP'; unit.classList.add('lxp'); }   // gated until claimed
    }

    var sub = vs.sub;
    if (sub) sub.textContent = '≈ ' + usdVal(totUsd) + ' USD';

    // OPEN THE PHONE'S PORTFOLIO GATE. `html:not(.lx-pvdone)` paints .portfolio-value, .portfolio-sub
    // and .portfolio-usd in transparent ink until this class exists, and the Stellar layer that used
    // to add it is not in this fork — so on mobile the total was written correctly and shown as a grey
    // bar, every time, for every XRPL wallet. See the long note in wallet.js's liftGate.
    //
    // Set here rather than borrowing window.__lxxLiftGate so this does not depend on wallet.js having
    // run first; both are idempotent and adding a class twice costs nothing.
    try { document.documentElement.classList.add('lx-pvdone'); } catch (e) {}

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

  // Price and its 24h move in one cell, in the design's own wrappers. Rebuilt each pass rather than
  // appended to, because this layer retries until the rows exist and must not stack two changes.
  function priceCell(td, usd, ch, pxXrp) {
    if (!td) return;
    td.classList.add('price-cell');
    td.textContent = '';
    var p1 = document.createElement('div');
    p1.className = 'p1 lx-p1';
    var m = document.createElement('span');
    m.textContent = usdPx(usd);
    p1.appendChild(m);
    var c = document.createElement('span');
    c.className = 'lx-chg';
    // Left EMPTY rather than em-dashed when there is no figure: the inherited sheet fades this in
    // with `.lx-chg:not(:empty){opacity:1}`, so an em dash would show as a permanent stray mark.
    if (ch != null && isFinite(ch)) {
      c.textContent = pct(ch);
      c.style.color = ch >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    }
    p1.appendChild(c);
    td.appendChild(p1);
    // Stellar's second line: the price in the native asset ("5.1943 XLM"), for tokens only.
    if (pxXrp > 0) {
      var dp = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(pxXrp))));
      var px = document.createElement('div');
      px.className = 'lx-pxlm';
      px.textContent = pxXrp.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '') + ' XRP';
      td.appendChild(px);
    }
  }

  function paintChange(el, v) {
    var s = pct(v);
    // Empty, as Stellar's is: the column's header is hidden, so a figure here floated under no heading.
    el.textContent = '';
    el.style.color = '';
    el.title = s == null ? '' : ('7d ' + s);
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
    d.textContent = usdPx(usd);
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
    return;                                              // removed: RAZA 2026-09-16, "I still see xrpl.to on wallet page. Remove it from here and all other pages"
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

  // THE TOP OF THE PAGE PAINTS FIRST (RAZA 2026-09-15: "this section takes forever to load, it should load the
  // quickest"). The total needs every holding priced, and pricing a long wallet costs the price feed two to three
  // seconds cold (measured 2.2s). So the last total this browser worked out for THIS address is shown at once and
  // replaced when the live one lands — the same trick Stellar's wallet uses for its headline. Only the connected
  // address's own figure, and nothing older than a week.
  function paintCachedTotal() {
    try {
      if (data) return;
      var me = localStorage.getItem('lumos.address');
      var c = me && JSON.parse(localStorage.getItem('lumos.xrpl.total.' + me) || 'null');
      if (!c || !(c.x > 0) || !(c.u > 0) || !(Date.now() - c.t < 7 * 86400000)) return;
      var vs = window.lxxTotals && window.lxxTotals();
      if (!vs) return;
      data = { usd: c.u / c.x };
      window.__lxxPaintingCached = true;                        // not written back: it is the old figure
      paintTotal(c.u, c.c);
      window.__lxxPaintingCached = false;
      data = null;
      if (c.c == null) {
        if (vs.pill) vs.pill.style.visibility = 'hidden';
        if (vs.secondary) vs.secondary.textContent = '';
      }
      // Tells wallet.js the design's mock is already gone, so its clearing pass does not blank this figure.
      if (vs.root) vs.root.setAttribute('data-lxxcleared', '1');
    } catch (e) { data = null; }
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
    if (attempt === 1 && window.__lxxPricesStarted) return;     // the event and the poll both start it
    window.__lxxPricesStarted = 1;
    var held = (window.__lxxData && window.__lxxData.held) || [];
    var slugs = held.map(function (h) { return slug(h.issuer, h.currency); });
    fetchPrices(slugs).then(function (j) {
      if (!j) {
        // FOUR TRIES IN NINE SECONDS WAS NOT A RETRY BUDGET, IT WAS A COIN FLIP.
        //
        // RAZA 2026-10-17: "wallet portfolio is not loading at all". Reproduced on production with a
        // 55-asset account: the first COLD load left the headline blank permanently, and the next
        // three reloads were all correct at 1,465.91 XRP. The tell was the attribution line — it is
        // written the instant `data` lands, and it was absent, so no response had ever arrived.
        //
        // Measured cold vs warm, same account, same colo:
        //
        //   /lxapi/xrplprices   cold 2.26s   warm 0.10s
        //   account_lines       cold 2.15s   warm 0.33s
        //
        // Prices only start once wallet.js has published __lxxData, so on a cold phone the old
        // schedule (1.5s + 3s + 4.5s) could spend its whole budget while the edge was still warming
        // — and then stop forever, with no later recovery on that page view. The page was one
        // reload away from correct and had no way to get there on its own. This is the same shape as
        // [[never-cache-a-failure-as-an-answer]]: a transient miss became the permanent answer.
        //
        // So the gap widens to a ceiling instead of ending: ~70s of attempts, the last ones 8s apart.
        // Bounded, still silent, and cheap — every attempt after the first is a conditional GET
        // against an edge that is warm by then. A wallet that genuinely has no prices still ends with
        // dashes and a blank total, which remains the honest outcome.
        if (attempt < 12) setTimeout(function () { start(attempt + 1); }, Math.min(attempt * 1500, 8000));
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
  // Straight away when wallet.js announces its data, rather than on the next half-second poll.
  window.addEventListener('lxx:walletdata', function () { clearInterval(timer); start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintCachedTotal);
  else paintCachedTotal();

  window.__lxxPricesApply = apply;
})();
