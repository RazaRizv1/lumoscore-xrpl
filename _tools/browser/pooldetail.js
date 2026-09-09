// Pool detail: one XRP Ledger AMM, read from the ledger.
//
// This page shipped MOCK DATA and, once lx-ammdata was stripped, nothing overwrote it any more. For
// the real LUMOS/XRP pool it claimed 3,420,180 XRP and 4,797,447 LUMOS against an actual 412.5 XRP
// and 17,075,469 LUMOS -- liquidity overstated by roughly 8,000x -- under a fabricated 64-hex
// "Pool ID" that is not even the right SHAPE for this ledger, where a pool is addressed by its AMM
// ACCOUNT. It is also reachable from every row of the Pools table, which this project wired.
//
// Everything here comes from amm_info. No third party: an AMM's reserves are ledger state, and a
// page about how deep a pool is should read the pool.
(function () {
  if (window.__lxxPoolDetail) return;
  window.__lxxPoolDetail = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 2 : dp });
    return v.toPrecision(4);
  }

  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'no pool');
      return res;
    });
  }

  // /xrpl/pools/id/<ammAccount>  — the route the Pools table links to.
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = decodeURIComponent(parts[i] || '');
      try { if (window.lxx.isAddress(p)) return p; } catch (e) {}
    }
    return null;
  }

  // A side is either a drops string (XRP) or { currency, issuer, value }.
  function side(a) {
    if (a == null) return null;
    // `currency` is the RAW code, kept alongside the display name: the chart derives the upstream's
    // token id from issuer + raw currency, and the decoded name would not hash to anything.
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6, issuer: null, currency: 'XRP' };
    var name = a.currency;
    try { name = window.lxx.decodeCurrency(a.currency).display; } catch (e) {}
    return { name: name, amount: Number(a.value), issuer: a.issuer, currency: a.currency };
  }

  // The phone has no `.ph-price` wrapper — the figure sits in a block whose heading reads "Pool
  // Price". Found by that heading rather than by a class, because the class is `.value`, which is
  // far too common to select on directly.
  function priceBlock(which) {
    var sel = which === 'value' ? '.value' : '.sub, .s';
    var labels = $$('div, span, h3, h4');
    for (var i = 0; i < labels.length; i++) {
      var t = (labels[i].textContent || '').trim();
      if (t.length > 40 || !/^pool price/i.test(t)) continue;
      // Climb from the label until an ancestor actually holds the figure. `closest('div')` was
      // wrong: on a label that is itself a div it returns that same element, which contains only
      // the words "Pool Price" — so the lookup found nothing and the mock stood.
      for (var n = labels[i]; n && n !== document.body; n = n.parentElement) {
        var found = n.querySelector(sel);
        if (found) return found;
      }
    }
    return null;
  }

  function setStat(match, value, sub) {
    var cells = $$('.ph-stat');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (!l || l.textContent.trim().toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.v');
      if (v) v.textContent = value;
      var s = cells[i].querySelector('.s');
      if (s) s.textContent = sub == null ? '' : sub;
      return true;
    }
    return false;
  }

  // ---- the Pool Activity chart --------------------------------------------------------------------
  //
  // It shipped as the design's mock and nothing ever replaced it: a y-axis reading 3.19M APT down to
  // 1.65M APT, an x-axis running Sep to Sep, and a 751-character path drawing a year of this pool's
  // liquidity that never happened. Visible on load, on the page for one specific pool, in another
  // chain's asset.
  //
  // A pool's TVL history is not something the ledger keeps, so that particular series cannot be made
  // real. Its EXCHANGE RATE can: the price of the pool's issued asset against the other side is the
  // pair's own history, it is what the chart's shape actually communicates, and /lxapi/xrplohlc
  // serves it — now keyed on issuer + currency, because a pool reserve has no ranking row to take an
  // id from. Quoted in XRP where there is an XRP side, matching how the rest of the page denominates
  // the pair, and in USD for a token/token pool.
  //
  // The design's own geometry is reused exactly — same viewBox, same two paths, same five labels
  // down the right and five months along the bottom — so this is the chart the design drew, with
  // numbers that are true.
  var NSVG = 'http://www.w3.org/2000/svg';

  function axisNum(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.0001) return v.toFixed(5);
    return v.toPrecision(3);
  }

  function drawChart(pts, unit) {
    var wrap = $('.chart-svg-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg || !pts || pts.length < 2) return;

    // THE GEOMETRY IS READ, NOT ASSUMED. This was written against a 400x220 viewBox measured on one
    // variant; the page actually serves 1000x280, so a hardcoded box drew the whole series into the
    // left 40% and hung the area fill above the floor. The tell was elementFromPoint returning a
    // DIV at the centre of the chart instead of the path.
    //
    // Everything comes off the design's own labels: the value labels sit at the right edge of the
    // plot and mark its top and bottom, the month row sits below the floor. So the same code fits
    // whatever box a variant ships, and there is nothing to keep in step by hand.
    var vb = (svg.getAttribute('viewBox') || '0 0 400 220').split(/[\s,]+/).map(Number);
    var W = vb[2] || 400, H = vb[3] || 220;

    // Split the two label sets by POSITION, not by guessing at the right-hand edge. The value
    // labels run down one column at varying y; the date row shares a single y at the foot. An
    // x-threshold gets the last date tick wrong the moment it sits far enough right — measured, the
    // one at x=936 in a 1000-wide box was being written a price.
    var allText = [].slice.call(svg.querySelectorAll('text'));
    var footY = Math.max.apply(null, allText.map(function (t) { return parseFloat(t.getAttribute('y')) || 0; }));
    var yLab = allText.filter(function (t) { return (parseFloat(t.getAttribute('y')) || 0) < footY; });
    if (!yLab.length) yLab = allText.slice(0, Math.max(1, allText.length - 5));

    var labX = Math.min.apply(null, yLab.map(function (t) { return parseFloat(t.getAttribute('x')) || W; }));
    var labYs = yLab.map(function (t) { return parseFloat(t.getAttribute('y')) || 0; }).sort(function (a, b) { return a - b; });

    var RIGHT = Math.max(0, W - labX) + 12;
    var TOP = labYs.length ? labYs[0] : 10;
    var BOT = labYs.length ? labYs[labYs.length - 1] : (H - 24);
    var PW = W - RIGHT;
    var vals = pts.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var rg = (mx - mn) || Math.abs(mx) || 1;

    var d = '', i;
    for (i = 0; i < pts.length; i++) {
      var x = (i / (pts.length - 1)) * PW;
      var y = BOT - ((vals[i] - mn) / rg) * (BOT - TOP);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }

    var line = svg.querySelectorAll('path')[1] || svg.querySelectorAll('path')[0];
    var area = svg.querySelectorAll('path')[0];
    if (area) area.setAttribute('d', d + ' L' + PW + ' ' + H + ' L0 ' + H + ' Z');
    if (line && line !== area) line.setAttribute('d', d);

    // The marker dot the design puts at the latest point.
    var dot = svg.querySelector('circle');
    if (dot) {
      dot.setAttribute('cx', String(PW));
      dot.setAttribute('cy', (BOT - ((vals[vals.length - 1] - mn) / rg) * (BOT - TOP)).toFixed(1));
    }

    // The value labels, top to bottom, however many the variant ships.
    yLab.slice().sort(function (p, q) {
      return (parseFloat(p.getAttribute('y')) || 0) - (parseFloat(q.getAttribute('y')) || 0);
    }).forEach(function (t, k, arr) {
      var frac = 1 - (k / Math.max(1, arr.length - 1));
      t.textContent = axisNum(mn + rg * frac) + (unit ? (' ' + unit) : '');
    });

    // And the dates along the foot, read off the real timestamps rather than invented.
    var months = allText.filter(function (t) { return yLab.indexOf(t) < 0; });
    months.sort(function (p, q) {
      return (parseFloat(p.getAttribute('x')) || 0) - (parseFloat(q.getAttribute('x')) || 0);
    }).forEach(function (t, k, arr) {
      var idx = Math.round((k / Math.max(1, arr.length - 1)) * (pts.length - 1));
      try {
        t.textContent = new Date(pts[idx][0]).toLocaleDateString('en-GB', { month: 'short' });
      } catch (e) {}
    });
  }

  // Emptied BEFORE the request goes out, never only on success. The mock is already on screen, so
  // "leave it alone if the fetch fails" leaves the invented year of history exactly where it was —
  // the failure path has to remove it, not decline to replace it.
  // SAY WHY THE CHART IS EMPTY.
  //
  // loadChart returns without drawing when the pair has fewer than two points — correct, half a
  // chart is worse than none — but clearChart has already blanked the paths and set every label to
  // an em dash, so the result was a blank rectangle with no explanation. On a big pair like
  // XRP/RLUSD the chart draws and nothing looks wrong; on a thin pool like XRP/Laugh there is no
  // history at all, and that is the page RAZA opened. An empty panel reads as broken.
  function chartNote(text) {
    var wrap = $('.chart-svg-wrap');
    if (!wrap) return;
    var n = wrap.querySelector('.lxx-chart-note');
    if (!text) { if (n) n.remove(); return; }
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    if (!n) {
      n = document.createElement('div');
      n.className = 'lxx-chart-note';
      n.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;'
        + 'justify-content:center;text-align:center;padding:0 18px;font-size:13.5px;opacity:.6;'
        + 'pointer-events:none';
      wrap.appendChild(n);
    }
    n.textContent = text;
  }

  function clearChart() {
    chartNote('');                                     // a stale note must not outlive a redraw
    var wrap = $('.chart-svg-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) { p.setAttribute('d', ''); });
    var dot = svg.querySelector('circle');
    if (dot) dot.setAttribute('r', '0');
    [].forEach.call(svg.querySelectorAll('text'), function (t) { t.textContent = '—'; });
  }

  function loadChart(tok, quoteInXrp) {
    if (!$('.chart-svg-wrap')) return;
    clearChart();
    if (!tok || !tok.issuer || !tok.currency) return;
    var vs = quoteInXrp ? 'XRP' : 'USD';
    fetch('/lxapi/xrplohlc?iss=' + encodeURIComponent(tok.issuer)
      + '&cur=' + encodeURIComponent(tok.currency) + '&r=1Y&vs=' + vs)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pts || d.pts.length < 2) {
          // Still no drawing — half a chart is worse than none — but say so instead of leaving a
          // blank rectangle. Thin pools genuinely have no traded history; that is a fact about the
          // pair, not a failure of the page, and the wording says which.
          chartNote('No price history for this pair yet.');
          return;
        }
        var v = d.pts;
        if (v.length > 180) {
          var step = Math.ceil(v.length / 180), out = [];
          for (var i = 0; i < v.length; i += step) out.push(v[i]);
          if (out[out.length - 1] !== v[v.length - 1]) out.push(v[v.length - 1]);
          v = out;
        }
        drawChart(v, vs);
      })
      // Deliberately a DIFFERENT message from the empty case above. "No price history" is a fact
      // about the pair; this is our request failing, and telling someone their pool has no history
      // when the truth is we could not fetch it is a small lie the page has no need to tell.
      .catch(function () { chartNote('Could not load the price history.'); });
  }

  function paint(acct, amm) {
    var a = side(amm.amount), b = side(amm.amount2);
    if (!a || !b) return;

    // Quote the token against XRP where there is an XRP side, which is how the rest of the site
    // denominates a pair.
    var xrpSide = a.name === 'XRP' ? a : (b.name === 'XRP' ? b : null);
    var tok = a.name === 'XRP' ? b : a;

    loadChart(tok, !!xrpSide);

    var name = $('.ph-name');
    if (name) name.textContent = a.name + ' / ' + b.name;

    // The mock carried a 64-hex "Pool ID". On this ledger a pool IS an account, so show the account
    // and let the copy button carry the full one.
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'AMM account: ' + short(acct);
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', acct);
      copyBtn.setAttribute('data-copy-label', 'AMM account');
    }

    var price = xrpSide && tok && tok.amount ? (xrpSide.amount / tok.amount) : null;
    // The phone labels this block "Pool Price" and puts the figure in `.value` / `.sub`, not
    // `.ph-price .v` / `.s`. Without the fallback it kept the design's "0.000713 APT".
    var pv = $('.ph-price .v') || $('.ph-price .value');
    if (!pv) pv = priceBlock('value');
    if (pv) pv.textContent = price != null ? (num(price, 6) + ' XRP') : '—';
    var feePct = amm.trading_fee != null ? (amm.trading_fee / 1000) : null;
    var ps = $('.ph-price .s') || $('.ph-price .sub');
    if (!ps) ps = priceBlock('sub');
    // The trading fee is a RATE, so it rides with the price rather than in a cell labelled
    // 'Fees Collected (24h)' -- which is an amount. Putting 0.625% there read as 0.625 XRP earned.
    if (ps) ps.textContent = (price != null ? ('per ' + tok.name) : '')
      + (feePct != null ? ((price != null ? '  ·  ' : '') + feePct + '% trading fee') : '');

    // Liquidity is stated as BOTH reserves. A single number here would be a choice of denominator,
    // and the mock's "~$1.43M" was exactly that kind of invented total.
    setStat('liquidity', num(a.amount, 2) + ' ' + a.name,
      '+ ' + num(b.amount, 2) + ' ' + b.name);

    var lp = amm.lp_token ? Number(amm.lp_token.value) : null;
    // Both of these are 24h AMOUNTS the ledger does not keep. Saying so beats filling them with a
    // rate or a supply figure that happens to be nearby.
    setStat('vol', '—', 'not kept by the ledger');
    setStat('fees', '—', 'not kept by the ledger');
    setStat('participant', '—', lp != null ? (num(lp, 2) + ' LP tokens outstanding') : '');

    // The RAW ledger amounts ride along beside the display ones. side() turns them into names and
    // numbers for painting, which throws away the currency/issuer pair — and that pair is exactly
    // what an AMMDeposit needs to identify the pool. Keeping both means the form can never be built
    // from a formatted string.
    window.__lxxPool = {
      account: acct, a: a, b: b, fee: feePct, lpSupply: lp,
      rawA: amm.amount, rawB: amm.amount2, lpToken: amm.lp_token || null
    };
    paintDwStatic();
    liftPage();
    loadPosition();
  }

  // THE WHOLE PAGE WAS INVISIBLE, and every DOM check said it was fine.
  //
  // The inherited lx-amm stylesheet gates the page on a class its own layer used to set:
  //     html:not(.lx-ammready) .pool-header, html:not(.lx-ammready) .pool-layout { visibility: hidden }
  // so the header, the stats, the chart, the deposit card — 948px of correct, real, freshly painted
  // content — sat at visibility:hidden. Reading .ph-name returned "XRP / RLUSD", every stat read
  // correctly, and the page was blank. I had already called this page "working" on the strength of
  // exactly those reads; only a screenshot showed the truth.
  //
  // Called from paint(), NOT from loadPosition(): the position load returns early when no wallet is
  // connected, so lifting there left the page permanently blank for anyone signed out — which is
  // most visitors, and the one case least likely to be noticed while testing signed in.
  function liftPage() {
    try {
      document.documentElement.classList.add('lx-ammready');   // header + layout
      document.documentElement.classList.add('lx-detpr');      // names, stats, price, my-position
    } catch (e) {}
  }

  // ---- Deposit and withdraw ------------------------------------------------------------------------
  // AMMDeposit and AMMWithdraw are the ledger's own operations; the amounts are ratio-locked to the
  // pool's current reserves, which is why typing one side fills the other rather than leaving someone
  // to guess a pair the ledger will silently rebalance.
  //
  // Flags are the whole API surface here. tfTwoAsset (0x00100000) deposits both sides at the amounts
  // given; tfLPToken (0x00010000) withdraws by burning a number of LP tokens and returns both sides.
  // The alternatives — single-asset deposits and withdrawals — move the price and charge for it, so
  // they are deliberately not offered from a form with one number in it.
  var TF_TWO_ASSET = 0x00100000;
  var TF_LP_TOKEN = 0x00010000;

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  // Both delegate to xrpl-core, which the node tests cover. These were a third local copy of the
  // amount arithmetic — write.js had the other two — and the drops conversion here used a bare 1e6
  // with Math.round written out again. One implementation, one set of tests.
  function assetDef(raw) { return window.lxx.assetOf(raw); }

  function amtOf(raw, value) { return window.lxx.amountFor(window.lxx.assetOf(raw), value); }

  function dwSay(text, tone) {
    var card = $('.dw-card');
    if (!card) return;
    var box = $('.lxx-dwsay', card);
    if (!box) {
      box = el('div', 'lxx-dwsay');
      box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
      card.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  // Everything on this card that the design baked with Aptos values and does not depend on a balance.
  function paintDwStatic() {
    var p = window.__lxxPool;
    if (!p) return;

    var fields = $$('#dwDeposit .dw-field');
    [p.a, p.b].forEach(function (s, i) {
      var f = fields[i];
      if (!f) return;
      var asset = f.querySelector('.asset');
      if (asset) {
        var ico = asset.querySelector('.ico');
        // The logo layer eats any element holding 1-5 characters; data-logoed is its skip marker.
        if (ico) {
          try { ico.setAttribute('data-logoed', '1'); ico.removeAttribute('data-logo'); ico.style.background = ''; } catch (e) {}
          ico.textContent = s.name.charAt(0).toUpperCase();
        }
        [].forEach.call(asset.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + s.name + ' ';
        });
      }
    });

    var wf = $('#dwWithdraw .dw-field .asset');
    if (wf) {
      var wico = wf.querySelector('.ico');
      if (wico) { try { wico.setAttribute('data-logoed', '1'); } catch (e) {} wico.textContent = 'LP'; }
      [].forEach.call(wf.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = p.a.name + ' / ' + p.b.name;
      });
    }
    // The two "You receive" rows on the withdraw side name the pool's assets.
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      [p.a, p.b].forEach(function (s, i) {
        if (!rows[i]) return;
        var as = rows[i].querySelector('.asset');
        if (!as) return;
        var ic = as.querySelector('.ico');
        if (ic) { try { ic.setAttribute('data-logoed', '1'); } catch (e) {} ic.textContent = s.name.charAt(0).toUpperCase(); }
        [].forEach.call(as.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = s.name;
        });
      });
    }

    setSummary('trading fee', (p.fee != null ? p.fee + '%' : '—'));
    setSummary('network fee', '~0.000012 XRP');
  }

  function setSummary(match, value) {
    $$('.dw-summary .r').forEach(function (r) {
      var k = r.querySelector('span');
      if (!k || (k.textContent || '').toLowerCase().indexOf(match) < 0) return;
      var v = r.querySelector('strong');
      if (v) v.textContent = value;
    });
  }

  // The connected account's balances of both pool assets and of the LP token itself. Without these
  // the MAX buttons and the position panel are guesses, and the design's baked "Balance: 25,420.18"
  // sits above a MAX button that would offer it.
  // THE DESIGN'S POSITION IS A FABRICATED ONE, AND IT WAS SHOWING TO SIGNED-OUT VISITORS.
  //
  // The panel ships baked values: "Position Value $1,247.50" in `.mp-amount` and
  // "▲ $32.18 (2.65%) · all time" in `.mp-pnl`. Two separate holes let them through:
  //
  //   1. loadPosition() returns early when there is no wallet, so on a signed-out page NOTHING ran
  //      and the whole invented position stayed on screen — a $1,247.50 holding shown to someone
  //      who is not even connected.
  //   2. paintMyPosition() overwrites `.mp-amount` but never touched `.mp-pnl`, so even connected
  //      with no position the page read "No position" beside "▲ $32.18 (2.65%) · all time" — which
  //      is how RAZA found it.
  //
  // Cleared UNCONDITIONALLY and BEFORE any wallet check or fetch, which is the only ordering that
  // closes both: the mock must not survive a missing wallet, a failed request, or an early return.
  // The same reason the pool chart is cleared before its fetch rather than on success.
  function clearMockPosition() {
    var amt = $('.my-position .mp-amount');
    if (amt) amt.textContent = addr() ? 'No position' : 'Connect a wallet';
    var pnl = $('.my-position .mp-pnl');
    // Replaced wholesale: the "· all time" is a bare text node beside the span, so blanking only
    // the span would leave the page reading "— · all time".
    if (pnl) pnl.textContent = '—';
    var pill = $('.position-share-pill');
    if (pill) pill.textContent = '0%';
  }

  function loadPosition() {
    var me = addr(), p = window.__lxxPool;
    clearMockPosition();
    if (!me || !p) return;
    Promise.all([
      rpc('account_info', { account: me, ledger_index: 'validated' }).catch(function () { return null; }),
      rpc('account_lines', { account: me, ledger_index: 'validated', limit: 400 }).catch(function () { return null; }),
      rpc('server_info', {}).catch(function () { return null; })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var lines = (r[1] && r[1].lines) || [];
      var si = r[2] && r[2].info && r[2].info.validated_ledger;
      var base = si ? +si.reserve_base_xrp : 1, inc = si ? +si.reserve_inc_xrp : 0.2;

      function balOf(raw) {
        if (typeof raw === 'string') {
          if (!info) return 0;
          var xrp = Number(info.Balance) / 1e6;
          var locked = base + inc * (Number(info.OwnerCount) || 0);
          return Math.max(0, xrp - locked);            // spendable, never the raw balance
        }
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].currency === raw.currency && lines[i].account === raw.issuer) return Number(lines[i].balance);
        }
        return 0;
      }

      var myLp = 0;
      if (p.lpToken) {
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].currency === p.lpToken.currency && lines[i].account === p.lpToken.issuer) {
            myLp = Number(lines[i].balance); break;
          }
        }
      }

      p.balA = balOf(p.rawA);
      p.balB = balOf(p.rawB);
      p.myLp = myLp;

      var fields = $$('#dwDeposit .dw-field');
      [[p.balA, p.a], [p.balB, p.b]].forEach(function (pair, i) {
        var f = fields[i];
        if (!f) return;
        var bal = f.querySelector('.balance');
        if (bal) bal.textContent = 'Balance: ' + num(pair[0], 6) + ' ' + pair[1].name;
      });
      var wbal = $('#dwWithdraw .balance');
      if (wbal) wbal.textContent = 'Your LP: ' + num(myLp, 6);

      paintMyPosition();
      liftDw();
    });
  }

  // The design gates the balance line until a data layer vouches for it:
  //     html:not(.lx-dwready) #dwDeposit .dw-field .balance, ... { visibility: hidden }
  // which is the same family of inherited gate found all over this fork. Lifted only once the real
  // balances are written, never before.
  function liftDw() {
    // Only the balance line, and only once real balances are written. The page-level gates are
    // lifted in liftPage() the moment the pool itself is painted, because those must not wait on a
    // wallet connection.
    try { document.documentElement.classList.add('lx-dwready'); } catch (e) {}
  }

  // "My position" — the share of the pool this account actually owns, derived from its LP balance
  // against total supply. The design baked 623.40 APT, +$8.92 earned fees and 23,415.82 LP tokens.
  //
  // EARNED FEES IS LEFT AS A DASH ON PURPOSE. Working it out needs the position's cost basis, which
  // means every deposit and withdrawal this account ever made into this pool; a public node will not
  // give that, and the number is the one people would act on. A dash is the honest answer.
  function paintMyPosition() {
    var p = window.__lxxPool;
    if (!p) return;
    var share = (p.lpSupply > 0 && p.myLp > 0) ? (p.myLp / p.lpSupply) : 0;

    var amts = $$('.my-position .mp-asset-amt');
    [[p.a, p.balAmt = p.a.amount * share], [p.b, p.b.amount * share]].forEach(function (x, i) {
      if (amts[i]) amts[i].textContent = num(x[1], 6);
    });
    $$('.my-position .mp-asset-name').forEach(function (n, i) {
      n.textContent = i === 0 ? p.a.name : p.b.name;
    });
    var fees = $$('.my-position .mp-fee-val');
    if (fees[0]) fees[0].textContent = '—';
    if (fees[1]) fees[1].textContent = num(p.myLp, 6);
    var pill = $('.position-share-pill');
    if (pill) pill.textContent = share > 0 ? ((share * 100).toFixed(4) + '%') : '0%';
    var amt = $('.my-position .mp-amount');
    if (amt) amt.textContent = share > 0 ? (num(p.myLp, 4) + ' LP') : 'No position';
  }

  function dwInputs() {
    return {
      a: $('#dwDeposit .dw-field:nth-of-type(1) input') || $$('#dwDeposit input')[0],
      b: $$('#dwDeposit input')[1],
      lp: $('#dwWithdraw input')
    };
  }

  // Typing one side fills the other at the pool's CURRENT ratio. A two-asset deposit off-ratio is
  // not rejected — the ledger takes what it can and returns the rest, which looks like the form
  // quietly changing your numbers. Better to show the pair that will actually be used.
  function syncRatio(from) {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.a || !i.b || !(p.a.amount > 0) || !(p.b.amount > 0)) return;
    var ratio = p.b.amount / p.a.amount;
    if (from === 'a') {
      var va = parseFloat(String(i.a.value).replace(/,/g, ''));
      i.b.value = va > 0 ? String(+(va * ratio).toFixed(6)) : '';
    } else {
      var vb = parseFloat(String(i.b.value).replace(/,/g, ''));
      i.a.value = vb > 0 ? String(+(vb / ratio).toFixed(6)) : '';
    }
    previewDeposit();
  }

  function previewDeposit() {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.a) return;
    var va = parseFloat(String(i.a.value).replace(/,/g, ''));
    if (!(va > 0) || !(p.a.amount > 0) || !(p.lpSupply > 0)) { setSummary('pool share', '—'); return; }
    // New LP tokens are minted in proportion to what the deposit adds to the reserves.
    var minted = p.lpSupply * (va / p.a.amount);
    var after = (p.myLp + minted) / (p.lpSupply + minted);
    setSummary('pool share', (after * 100).toFixed(4) + '%');
  }

  function previewWithdraw() {
    var p = window.__lxxPool, i = dwInputs();
    if (!p || !i.lp) return;
    var v = parseFloat(String(i.lp.value).replace(/,/g, ''));
    var share = (p.lpSupply > 0 && v > 0) ? (v / p.lpSupply) : 0;
    var recv = $$('#dwWithdraw .dw-field')[1];
    if (recv) {
      var rows = recv.querySelectorAll('.row');
      [p.a.amount * share, p.b.amount * share].forEach(function (x, k) {
        if (!rows[k]) return;
        var out = rows[k].querySelector('span[style]') || rows[k].lastElementChild;
        if (out) out.textContent = num(x, 6);
      });
    }
    var after = (p.lpSupply > 0) ? Math.max(0, (p.myLp - v)) / Math.max(1e-9, (p.lpSupply - v)) : 0;
    setSummary('pool share', (after * 100).toFixed(4) + '%');
  }

  function mode() {
    var t = $('.dw-tabs button.active');
    return (t && t.getAttribute('data-dw')) || 'deposit';
  }

  function submitDw() {
    var p = window.__lxxPool, i = dwInputs(), me = addr();
    if (!p || !me) { dwSay('Connect a wallet first.', 'bad'); return; }
    var cta = $('.dw-cta');
    var asset = assetDef(p.rawA), asset2 = assetDef(p.rawB);

    if (mode() === 'deposit') {
      var va = parseFloat(String(i.a.value).replace(/,/g, ''));
      var vb = parseFloat(String(i.b.value).replace(/,/g, ''));
      if (!(va > 0) || !(vb > 0)) { dwSay('Enter an amount to deposit.', 'bad'); return; }
      if (va > p.balA) { dwSay('You only have ' + num(p.balA, 6) + ' ' + p.a.name + ' available.', 'bad'); return; }
      if (vb > p.balB) { dwSay('You only have ' + num(p.balB, 6) + ' ' + p.b.name + ' available.', 'bad'); return; }
      dwSay('Approve the deposit in your wallet…');
      if (cta) cta.disabled = true;
      window.lxc.submit({
        TransactionType: 'AMMDeposit', Account: me,
        Asset: asset, Asset2: asset2,
        Amount: amtOf(p.rawA, va), Amount2: amtOf(p.rawB, vb),
        Flags: TF_TWO_ASSET
      }).then(function () {
        dwSay('Liquidity added.', 'good');
        i.a.value = ''; i.b.value = '';
        setTimeout(function () { if (window.__lxxPoolDetailReload) window.__lxxPoolDetailReload(); }, 3000);
      }).catch(function (e) {
        dwSay((e && e.message) || 'The deposit could not be made.', 'bad');
      }).then(function () { if (cta) cta.disabled = false; });
      return;
    }

    var v = parseFloat(String(i.lp.value).replace(/,/g, ''));
    if (!(v > 0)) { dwSay('Enter how many LP tokens to withdraw.', 'bad'); return; }
    if (v > p.myLp) { dwSay('You hold ' + num(p.myLp, 6) + ' LP tokens.', 'bad'); return; }
    if (!p.lpToken) { dwSay('This pool has no LP token to withdraw.', 'bad'); return; }
    dwSay('Approve the withdrawal in your wallet…');
    if (cta) cta.disabled = true;
    window.lxc.submit({
      TransactionType: 'AMMWithdraw', Account: me,
      Asset: asset, Asset2: asset2,
      LPTokenIn: { currency: p.lpToken.currency, issuer: p.lpToken.issuer, value: String(v) },
      Flags: TF_LP_TOKEN
    }).then(function () {
      dwSay('Liquidity withdrawn.', 'good');
      i.lp.value = '';
      setTimeout(function () { if (window.__lxxPoolDetailReload) window.__lxxPoolDetailReload(); }, 3000);
    }).catch(function (e) {
      dwSay((e && e.message) || 'The withdrawal could not be made.', 'bad');
    }).then(function () { if (cta) cta.disabled = false; });
  }

  function wireDw() {
    if (window.__lxxDwWired) return;
    var card = $('.dw-card');
    if (!card) return;
    window.__lxxDwWired = 1;

    $$('.dw-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.dw-tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
        var w = b.getAttribute('data-dw') === 'withdraw';
        var d = $('#dwDeposit'), wd = $('#dwWithdraw');
        if (d) d.style.display = w ? 'none' : '';
        if (wd) wd.style.display = w ? '' : 'none';
        var cta = $('.dw-cta');
        if (cta) {
          // The button label is the design's; only the word changes with the tab.
          [].forEach.call(cta.childNodes, function (nd) {
            if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = w ? ' Remove Liquidity ' : ' Add Liquidity ';
          });
        }
        dwSay('');
      });
    });

    var i = dwInputs();
    if (i.a) i.a.addEventListener('input', function () { syncRatio('a'); });
    if (i.b) i.b.addEventListener('input', function () { syncRatio('b'); });
    if (i.lp) i.lp.addEventListener('input', previewWithdraw);

    $$('#dwDeposit .max-btn').forEach(function (btn, k) {
      btn.addEventListener('click', function () {
        var p = window.__lxxPool;
        if (!p) return;
        var ii = dwInputs();
        var bal = k === 0 ? p.balA : p.balB;
        var side2 = k === 0 ? p.a : p.b;
        // XRP keeps a little back for the transaction cost; the balance shown is already
        // reserve-adjusted, so this is only the fee.
        var v = side2.name === 'XRP' ? Math.max(0, bal - 0.0002) : bal;
        (k === 0 ? ii.a : ii.b).value = String(+v.toFixed(6));
        syncRatio(k === 0 ? 'a' : 'b');
      });
    });

    $$('#dwWithdraw .dw-pct-b').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = window.__lxxPool, ii = dwInputs();
        if (!p || !ii.lp) return;
        var t = (btn.textContent || '').trim().toLowerCase();
        var f = t === 'max' ? 1 : (parseFloat(t) / 100);
        if (!(f > 0)) f = 1;
        ii.lp.value = String(+(p.myLp * f).toFixed(6));
        previewWithdraw();
      });
    });

    var cta = $('.dw-cta');
    if (cta) cta.addEventListener('click', function (e) { e.preventDefault(); submitDw(); });
  }

  // The participant list was 25 invented rows. Who holds an LP token is not something a public node
  // will enumerate, so the honest answer is the count and a note -- not 25 plausible addresses.
  function participants(text) {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      host.innerHTML = '';
      var d = el('div', 'acc-empty', text);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      host.appendChild(d);
    });
  }

  function fail(msg) {
    var name = $('.ph-name');
    if (name) name.textContent = 'Pool not found';
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = msg;
    setStat('liquidity', '—', '');
    setStat('vol', '—', '');
    setStat('fees', '—', '');
    setStat('participant', '—', '');
    participants(msg);
  }

  function load() {
    if (!$('.pool-header')) return;                      // not this page

    var acct = fromUrl();
    if (!acct) { fail('No pool in this address.'); return; }

    var name = $('.ph-name');
    if (name) name.textContent = 'Reading the XRP Ledger…';
    wireDw();

    // BEFORE the amm_info call, not inside paint(). paint() is the success path, so leaving the
    // clear there meant a pool that failed to load — a bad address, an RPC wobble — kept the
    // design's $1,247.50 position on screen under an error message.
    clearMockPosition();

    rpc('amm_info', { amm_account: acct }).then(function (r) {
      if (!r || !r.amm) { fail('That account is not an AMM.'); return; }
      paint(acct, r.amm);
      var holders = r.amm.lp_token ? '' : '';
      participants('LP holders are not enumerable from a public node. '
        + 'The pool holds ' + (r.amm.lp_token ? num(Number(r.amm.lp_token.value), 2) : '—')
        + ' LP tokens in total.');
    }).catch(function (e) {
      fail((e && e.message) === 'no pool' ? 'That account is not an AMM.' : 'Could not read the pool.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolDetailReload = load;
})();
