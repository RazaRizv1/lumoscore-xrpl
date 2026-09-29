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
    // Exact zero, spelled as one. Falling through to toPrecision(4) rendered a real "no fees were
    // collected" as "0.000 XRP", which reads like a truncated number rather than a plain nothing.
    if (v === 0) return '0';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 2 : dp });
    // SUBSCRIPT ZEROS, NOT EXPONENTS (RAZA 2026-09-17: "please change the price to subscript notation instead of 3.092e-7").
    // toPrecision hands back e-notation below 1e-6, which on a price line reads like a broken number rather than a small
    // one. Same form the Trade-Asset page uses: 0.0₆3092.
    if (v < 1e-4) return subZero(v);
    return v.toPrecision(4);
  }

  // 0.0₆3092 — the count of leading zeros written as a subscript, as lumoscore.com prints small prices.
  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    if (!(zeros > 0)) return v.toPrecision(4);
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }

  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // A reserve's logo: XRP has a fixed id at xrpl.to; a token's is derived at the edge from issuer and
  // currency. Painted as an <img>, which is the one child the logo healer leaves alone.
  function logoOf(s) {
    if (!s || s.name === 'XRP' || !s.issuer) return '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(s.issuer) + '&cur=' + encodeURIComponent(s.currency) + '&w=48';
  }
  function tokImg(host, s) {
    if (!host || !s) return;
    try {
      host.removeAttribute('data-logo');
      host.removeAttribute('style');
      host.setAttribute('data-logoed', '1');
      host.setAttribute('data-lxfixed', '1');
    } catch (e) {}
    host.textContent = '';
    var im = document.createElement('img');
    im.className = 'lx-tokimg';
    im.alt = '';
    im.src = logoOf(s);
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
    im.onerror = function () { im.remove(); host.textContent = s.name.charAt(0).toUpperCase(); };
    host.appendChild(im);
  }
  var USDP = null;
  function usdRate() {
    if (!USDP) {
      USDP = fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
        .then(function (t) { return (t && t.ok && +t.usd > 0) ? +t.usd : null; })
        .catch(function () { return null; });
    }
    return USDP;
  }
  function usdShort(v) {
    if (!(v > 0)) return '';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }
  // "6.479M SHX" with the unit in the design's own smaller `.lx-unit` span, as Stellar writes it.
  function unitVal(v, text, unit) {
    if (!v) return;
    v.textContent = text + (unit ? ' ' : '');
    if (unit) { var u = el('span', 'lx-unit', unit); u.setAttribute('data-logoed', '1'); v.appendChild(u); }
  }
  function statCell(match) {
    var cells = $$('.ph-stat');
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (l && l.textContent.trim().toLowerCase().indexOf(match) >= 0) return cells[i];
    }
    return null;
  }

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

  // /pools/xrpl/id/<ammAccount>  — the route the Pools table links to.
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

  // 24h volume and fees for THIS pool, from the same indexer the Pools list uses.
  //
  // MATCHED BY ACCOUNT, NEVER TAKEN ON TRUST. The obvious route — asking the upstream for one pool —
  // does not exist and fails dangerously: `api/amm/<account>` is a 404, and `api/amm?account=<account>`
  // returns HTTP 200 with a DIFFERENT POOL, because it ignores the parameter and hands back the first
  // row. Wiring that would have printed another pool's volume on this page under this pool's name.
  //
  // So the issuer filter is used instead — the one narrowing parameter the upstream does honour — and
  // the row is then found by `acct`. That covers every pool rather than the top 100, because it
  // narrows by the token, not by rank: 56 rows came back for ARMY, one of them this pool.
  //
  // If the pool is not in the response, the honest placeholder painted above simply stays.
  function loadStats(acct, a, b) {
    var issuer = (a && a.issuer) || (b && b.issuer) || '';
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(issuer)) return;   // XRP-only side has none

    fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(issuer))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.rows) return;
        var row = null;
        for (var i = 0; i < d.rows.length; i++) {
          if (d.rows[i].acct === acct) { row = d.rows[i]; break; }
        }
        if (!row) return;
        // Both figures are quoted in XRP by the upstream, the same unit the liquidity row above uses.
        // The sub-line is cleared rather than filled: the labels already read "24h Volume" and
        // "Fees Collected (24h)", so a "last 24 hours" underneath them said the same thing twice.
        // Stellar's two cells: the amount with its unit, and "≈ $x" beneath it.
        usdRate().then(function (usd) {
          [['vol', row.vol], ['fees', row.fees]].forEach(function (x) {
            var cell = statCell(x[0]);
            if (!cell || x[1] == null) return;
            unitVal(cell.querySelector('.v'), num(x[1], 2), 'XRP');
            var s = cell.querySelector('.s');
            if (s) s.textContent = (usd && x[1] > 0) ? ('≈ ' + usdShort(x[1] * usd)) : '';
          });
        });
        // A zero here is a real answer, not a missing one: this pool charges a 0% trading fee, so it
        // collects nothing. Only null means unknown.

        if (row.holders != null) {
          setStat('participant', num(row.holders, 0), 'liquidity providers');
        }
      })
      .catch(function () { /* the honest placeholders stand */ });
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

  // THE HOVER READOUT (RAZA 2026-09-15: "Pools-pool page, where's the hover on the chart"). lumoscore.com's
  // pool chart draws a crosshair, a dot on the line and a small card — the date, then each figure as a quiet
  // label over a tabular value. Same elements and styling; the series here is the pool token's price, so the
  // card says Price rather than TVL, and volume is converted to dollars as Stellar's is.
  function tipWhen(ms, spanMs) {
    try {
      var o = spanMs < 3 * 86400000
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(ms).toLocaleString('en-US', o);
    } catch (e) { return ''; }
  }
  function wirePoolHover(host) {
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    function mk(css) {
      var d = document.createElement('div');
      d.className = 'lx-chov';
      d.setAttribute('data-logoed', '1');
      d.style.cssText = 'position:absolute;pointer-events:none;opacity:0;transition:opacity .08s linear;' + css;
      host.appendChild(d);
      return d;
    }
    var vline = mk('top:0;bottom:0;width:1px;background:rgba(180,180,200,.55);z-index:4');
    var dot = mk('width:11px;height:11px;border-radius:50%;border:2px solid var(--surface);background:var(--accent,#ea6a2c);transform:translate(-50%,-50%);z-index:6');
    var box = mk("background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:7px 10px;font-size:14px;font-family:'Hanken Grotesk',system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.22);min-width:140px;z-index:8;color:var(--text)");
    function hide() { vline.style.opacity = '0'; dot.style.opacity = '0'; box.style.opacity = '0'; }
    function line(text, css) {
      var e = el('div', null, text);
      e.setAttribute('data-logoed', '1');
      e.style.cssText = css;
      return e;
    }
    function row(label, value) {
      var w = document.createElement('div');
      w.appendChild(line(label, 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600'));
      w.appendChild(line(value, 'color:var(--text);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:1px'));
      return w;
    }
    function at(cx, cy) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      if (!S || !svg || !S.pts || S.pts.length < 2) return hide();
      var hr = host.getBoundingClientRect();
      if (cx < hr.left || cx > hr.right || cy < hr.top || cy > hr.bottom) return hide();
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return hide();
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var n = S.pts.length, k = Math.max(0, Math.min(n - 1, Math.round(vx / S.PW * (n - 1))));
      var p = S.pts[k];
      var sp = svg.createSVGPoint();
      sp.x = (k / (n - 1)) * S.PW;
      sp.y = S.BOT - ((p[1] - S.mn) / S.rg) * (S.BOT - S.TOP);
      var scr = sp.matrixTransform(m), lx = scr.x - hr.left, ly = scr.y - hr.top;
      vline.style.left = lx + 'px'; vline.style.opacity = '1';
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = '1';
      // TVL mode: the line and the bars are both XRP and convert at the XRP rate. Price mode: volume is token units.
      var tvlMode = S.tok === 'TVL';
      var usdPer = tvlMode ? (S.usd || 0) : (S.unit === 'USD' ? p[1] : (S.usd ? p[1] * S.usd : 0));
      var volUsd = (+p[5] || 0) * usdPer;
      box.textContent = '';
      box.appendChild(line(tipWhen(p[0], S.span), 'color:var(--text-soft,#8a8fa3);font-size:11px;font-weight:600;margin-bottom:4px'));
      if (S.tok === 'VOL') box.appendChild(row('Volume', S.usd ? usdShort(p[1] * S.usd) : (axisNum(p[1]) + ' XRP')));
      else if (tvlMode) box.appendChild(row('TVL', S.usd ? usdShort(p[1] * S.usd) : (axisNum(p[1]) + ' XRP')));
      else box.appendChild(row(S.tok ? ('Price of ' + S.tok) : 'Price', S.unit === 'USD' ? ('$' + num(p[1], 6)) : (num(p[1], 6) + ' XRP')));
      if (volUsd > 0) { var r2 = row('Volume', usdShort(volUsd)); r2.style.marginTop = '8px'; box.appendChild(r2); }
      else if (tvlMode && +p[5] > 0) { var r3 = row('Volume', axisNum(+p[5]) + ' XRP'); r3.style.marginTop = '8px'; box.appendChild(r3); }
      box.style.opacity = '1';
      var bw = box.offsetWidth || 160, bh = box.offsetHeight || 74;
      var bx = lx + 14; if (bx + bw > hr.width) bx = lx - bw - 14; if (bx < 4) bx = 4;
      var by = ly - 24; if (by + bh > hr.height) by = hr.height - bh - 4; if (by < 4) by = 4;
      box.style.left = bx + 'px'; box.style.top = by + 'px';
    }
    host.addEventListener('mousemove', function (e) { at(e.clientX, e.clientY); });
    host.addEventListener('mouseleave', hide);
    // Touch reads on tap and follows a horizontal drag; lifting the finger keeps the reading, a tap
    // anywhere else clears it — Stellar's behaviour.
    var t0 = null;
    host.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      t0 = { x: t.clientX, y: t.clientY }; at(t.clientX, t.clientY);
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      if (t0 && Math.abs(t.clientX - t0.x) > Math.abs(t.clientY - t0.y)) e.preventDefault();
      at(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lx-chovhost')) return;
      hide();
    }, true);
    host.classList.add('lx-chovhost');
  }

  function drawChart(pts, unit, tokName) {
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
    // Anything the design's own chart script drew into this SVG (its candle mode) comes out before a real draw.
    [].slice.call(svg.querySelectorAll('rect:not(.lx-ch)')).forEach(function (n) { n.parentNode.removeChild(n); });
    [].slice.call(svg.querySelectorAll('line:not(.lx-ch)')).forEach(function (n) {
      if (n.getAttribute('x1') === n.getAttribute('x2') && n.parentNode) n.parentNode.removeChild(n);
    });
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

    // Volume along the floor, under the line (Stellar draws its bars first so the line paints over them).
    // Square-root scaled so an ordinary day still shows beside the outlier. `.lx-ch` keeps the inherited path
    // gate off them, and a redraw removes its own.
    [].slice.call(svg.querySelectorAll('.lx-chvol')).forEach(function (r) { r.parentNode.removeChild(r); });
    var vmax = 0;
    pts.forEach(function (p) { var v = +p[5] || 0; if (v > vmax) vmax = v; });
    if (vmax > 0) {
      var VH = (BOT - TOP) * 0.24, bwid = Math.max(1, Math.min(10, PW / pts.length * 0.6)), vroot = Math.sqrt(vmax);
      var firstPath = svg.querySelector('path');
      pts.forEach(function (p, k) {
        var v = +p[5] || 0;
        if (!(v > 0)) return;
        var bh = Math.max(2, (Math.sqrt(v) / vroot) * VH), bx = (k / (pts.length - 1)) * PW;
        var r = document.createElementNS(NSVG, 'rect');
        r.setAttribute('class', 'lx-ch lx-chvol');
        r.setAttribute('x', (bx - bwid / 2).toFixed(1));
        r.setAttribute('y', (BOT - bh).toFixed(1));
        r.setAttribute('width', bwid.toFixed(1));
        r.setAttribute('height', bh.toFixed(1));
        r.setAttribute('rx', '1');
        r.setAttribute('fill', '#8b7bf0');
        r.setAttribute('fill-opacity', '0.45');
        svg.insertBefore(r, firstPath);
      });
    }
    var hovHost = document.getElementById('tvlChart') || wrap;
    hovHost.__lxxHov = { pts: pts, PW: PW, TOP: TOP, BOT: BOT, mn: mn, rg: rg, unit: unit, tok: tokName || '', usd: null,
      span: pts[pts.length - 1][0] - pts[0][0] };
    if (unit !== 'USD') usdRate().then(function (u) { if (hovHost.__lxxHov) hovHost.__lxxHov.usd = u; });
    wirePoolHover(hovHost);

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
        var span = pts[pts.length - 1][0] - pts[0][0], dt = new Date(pts[idx][0]);
        t.textContent = span < 2 * 86400000 ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : (span < 90 * 86400000 ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
      } catch (e) {}
    });

    // THE CHART WAS DRAWN AND INVISIBLE (RAZA 2026-09-15: "Pools-Pool page is not displaying the chart").
    // The inherited sheet hides every path and label until a data layer says the chart is real:
    //     html:not(.lx-chartready) #tvlChart svg path:not(.lx-ch) { opacity: 0 !important }
    // Stellar's layer adds that class once it has drawn; this one never did.
    try { document.documentElement.classList.add('lx-chartready'); } catch (e) {}
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
    try { document.documentElement.classList.add('lx-chartready'); } catch (e) {}
  }

  function clearChart() {
    chartNote('');                                     // a stale note must not outlive a redraw
    var wrap = $('.chart-svg-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) { p.setAttribute('d', ''); });
    [].slice.call(svg.querySelectorAll('.lx-chvol')).forEach(function (r) { r.parentNode.removeChild(r); });
    var hh = document.getElementById('tvlChart') || wrap;
    if (hh) hh.__lxxHov = null;
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
          // Thinned to 180 buckets, each keeping its last close and the SUM of its volume — taking every
          // n-th candle would have thrown most of the volume away.
          var step = Math.ceil(v.length / 180), out = [];
          for (var i = 0; i < v.length; i += step) {
            var seg = v.slice(i, i + step), lastC = seg[seg.length - 1], volSum = 0;
            for (var si = 0; si < seg.length; si++) volSum += +seg[si][5] || 0;
            out.push([lastC[0], lastC[1], lastC[2], lastC[3], seg[0][4], volSum]);
          }
          v = out;
        }
        drawChart(v, vs, tok.name);
      })
      // Deliberately a DIFFERENT message from the empty case above. "No price history" is a fact
      // about the pair; this is our request failing, and telling someone their pool has no history
      // when the truth is we could not fetch it is a small lie the page has no need to tell.
      .catch(function () { chartNote('Could not load the price history.'); });
  }

  // ---- Pool Activity: the pool's TVL ------------------------------------------------------------------
  // RAZA 2026-09-15: "In Pools-Pool chart hover, its supposed to show TVL instead of price." lumoscore.com's chart
  // here is the pool's value over time with volume underneath. xrpl.to keeps exactly that per pool, in XRP, and
  // /lxapi/xrplammchart serves it — so the line, the bars and the hover card all read one series. The range
  // buttons are the design's own 1D…ALL, opening on 1M as the design does.
  var TVL_P = { '1D': '1d', '1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', 'ALL': 'all' };
  var tvlGen = 0, tvlRange = '1M';
  function loadTvl(acct, label) {
    if (!$('.chart-svg-wrap')) return;
    if (label) tvlRange = label;
    $$('.tf-mini button').forEach(function (b) {
      b.classList.toggle('active', (b.textContent || '').trim().toUpperCase() === tvlRange);
    });
    clearChart();
    var gen = ++tvlGen;
    fetch('/lxapi/xrplammchart?acct=' + encodeURIComponent(acct) + '&p=' + (TVL_P[tvlRange] || '1m'))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (gen !== tvlGen) return;
        if (!d || !d.ok || !d.pts || d.pts.length < 2) { chartNote('No liquidity history for this pool yet.'); return; }
        var v = d.pts.map(function (q) { return [q[0], q[1], 0, 0, 0, +q[2] || 0]; });
        if (v.length > 180) {
          // Thinned to 180 points: each keeps its last TVL and the SUM of its volume.
          var step = Math.ceil(v.length / 180), out = [];
          for (var i = 0; i < v.length; i += step) {
            var seg = v.slice(i, i + step), last = seg[seg.length - 1], vsum = 0;
            for (var k = 0; k < seg.length; k++) vsum += seg[k][5];
            out.push([last[0], last[1], 0, 0, 0, vsum]);
          }
          v = out;
        }
        TVL_LAST = v;
        renderTvl();
      })
      .catch(function () { if (gen === tvlGen) chartNote('Could not load the liquidity history.'); });
  }
  function wireTvlRanges(acct) {
    $$('.tf-mini button').forEach(function (b) {
      if (b.__lxxTvl) return;
      b.__lxxTvl = 1;
      b.addEventListener('click', function (e) {
        var l = (b.textContent || '').trim().toUpperCase();
        if (!TVL_P[l]) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        loadTvl(window.__lxxPool ? window.__lxxPool.account : acct, l);
      }, true);
    });
  }

  // ---- Line / Bar and Pool TVL / Volume ----------------------------------------------------------------
  // RAZA 2026-09-15: "if i switch the chart to candlestick, it messes up. After that, even line chart messes up until i
  // refresh." The design's own switch redrew its mock candles (in APT) over the real series and left them behind. Both
  // controls are claimed at window capture now and drive the real data: Line draws the TVL line, Bar draws it as
  // candles (each day opening at the previous close), and the Volume metric draws volume as bars — as on lumoscore.com.
  var CH_MODE = { type: 'line', metric: 'tvl' }, TVL_LAST = null;
  function renderTvl() {
    var v = TVL_LAST;
    var wrap = $('.chart-svg-wrap'), svg = wrap && wrap.querySelector('svg');
    if (!v || !svg) return;
    [].slice.call(svg.querySelectorAll('.lx-chcandle')).forEach(function (n) { n.parentNode.removeChild(n); });
    if (CH_MODE.metric === 'vol') {
      drawChart(v.map(function (q) { return [q[0], q[5], 0, 0, 0, 0]; }), 'XRP', 'VOL');
      chartBars(svg, 'vol');
    } else {
      drawChart(v, 'XRP', 'TVL');
      if (CH_MODE.type === 'bar') chartBars(svg, 'candle');
    }
  }
  function chartBars(svg, kind) {
    var host = document.getElementById('tvlChart') || $('.chart-svg-wrap');
    var S = host && host.__lxxHov;
    if (!S || !S.pts || S.pts.length < 2) return;
    [].forEach.call(svg.querySelectorAll('path'), function (p) {
      if (!/lx-ch/.test(p.getAttribute('class') || '')) p.setAttribute('d', '');
    });
    var dot = svg.querySelector('circle');
    if (dot) dot.setAttribute('r', '0');
    var n = S.pts.length, w = Math.max(1.5, Math.min(14, S.PW / n * 0.62));
    var Y = function (val) { return S.BOT - ((val - S.mn) / S.rg) * (S.BOT - S.TOP); };
    S.pts.forEach(function (p, k) {
      var x = (k / (n - 1)) * S.PW, y1, y2, col;
      if (kind === 'vol') {
        y1 = Y(p[1]); y2 = S.BOT; col = '#8b7bf0';
      } else {
        var o = k ? S.pts[k - 1][1] : p[1];
        y1 = Math.min(Y(o), Y(p[1])); y2 = Math.max(Y(o), Y(p[1]));
        col = p[1] >= o ? '#22c55e' : '#ff5b5b';
      }
      var r = document.createElementNS(NSVG, 'rect');
      r.setAttribute('class', 'lx-ch lx-chcandle');
      r.setAttribute('x', (x - w / 2).toFixed(1));
      r.setAttribute('y', y1.toFixed(1));
      r.setAttribute('width', w.toFixed(1));
      r.setAttribute('height', Math.max(1.5, y2 - y1).toFixed(1));
      r.setAttribute('rx', '1');
      r.setAttribute('fill', col);
      svg.appendChild(r);
    });
  }
  if (!window.__lxxChartModes) {
    window.__lxxChartModes = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest || !$('.pool-header')) return;
      var tb = t.closest('.chart-type button');
      var mb = t.closest('.chart-mode-menu button[data-metric]');
      if (!tb && !mb) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (tb) {
        var btns = [].slice.call(tb.parentNode.querySelectorAll('button'));
        btns.forEach(function (b) { b.classList.toggle('active', b === tb); });
        CH_MODE.type = btns.indexOf(tb) === 0 ? 'line' : 'bar';
      }
      if (mb) {
        CH_MODE.metric = mb.getAttribute('data-metric') === 'vol' ? 'vol' : 'tvl';
        [].forEach.call(mb.parentNode.querySelectorAll('button'), function (b) { b.classList.toggle('active', b === mb); });
        var sel = $('.chart-mode-select');
        if (sel) [].forEach.call(sel.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + (CH_MODE.metric === 'vol' ? 'Volume' : 'Pool TVL') + ' ';
        });
        mb.parentNode.classList.remove('open');
        if (mb.parentNode.style.display === 'block') mb.parentNode.style.display = 'none';
      }
      renderTvl();
    }, true);
  }

  // ---- Pool Transactions ------------------------------------------------------------------------------
  // RAZA 2026-09-15: "Pool transactions and Participants are not loading." The table held the design's nineteen
  // Aptos rows. On this ledger a pool IS an account, so its own account_tx is its activity: every swap routed
  // through it and every deposit and withdrawal changes its balances. Amount A / Amount B are how much of each
  // reserve moved, read from the transaction's metadata — the AMM's XRP balance and its trust line to each issuer.
  var TX = { rows: [], marker: null, done: false, filter: 'all', page: 1, loading: false, acct: null, ext: '' };
  var TX_PER = 15;
  var ADDR_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

  function txAmt(v) {
    if (!(v > 0)) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 6 : (v < 1000 ? 4 : 2) });
  }

  function txDeltas(meta, acct, lpCur) {
    var out = { xrp: 0, tok: {} };
    ((meta && meta.AffectedNodes) || []).forEach(function (n) {
      var node = n.ModifiedNode || n.CreatedNode || n.DeletedNode;
      if (!node) return;
      var f = node.FinalFields || node.NewFields || {}, pf = node.PreviousFields || {};
      if (node.LedgerEntryType === 'AccountRoot' && f.Account === acct) {
        if (n.CreatedNode) out.xrp += Number(f.Balance || 0) / 1e6;
        else if (pf.Balance != null) out.xrp += (Number(f.Balance) - Number(pf.Balance)) / 1e6;
        return;
      }
      if (node.LedgerEntryType !== 'RippleState') return;
      var lo = f.LowLimit && f.LowLimit.issuer, hi = f.HighLimit && f.HighLimit.issuer;
      if (lo !== acct && hi !== acct) return;
      var bal = f.Balance || {}, cur = bal.currency;
      if (!cur || cur === lpCur) return;                      // the LP token's own lines are not reserves
      var sign = lo === acct ? 1 : -1, other = lo === acct ? hi : lo;
      var now = sign * Number(bal.value || 0);
      var before = n.CreatedNode ? 0 : (pf.Balance ? sign * Number(pf.Balance.value || 0) : now);
      var key = cur + '|' + other;
      out.tok[key] = (out.tok[key] || 0) + (now - before);
    });
    return out;
  }
  function sideDelta(raw, d) {
    if (typeof raw === 'string') return d.xrp;
    return (raw && d.tok[raw.currency + '|' + raw.issuer]) || 0;
  }
  function txKind(t, dA, dB) {
    var ty = t.TransactionType;
    if (ty === 'AMMDeposit' || ty === 'AMMCreate') return 'deposit';
    if (ty === 'AMMWithdraw' || ty === 'AMMDelete') return 'withdraw';
    if (/^AMM/.test(ty)) return null;                          // votes, bids, clawbacks move no swap volume
    return (dA || dB) ? 'swap' : null;
  }

  function loadTx(more) {
    var p = window.__lxxPool;
    if (!p) return Promise.resolve();
    if (!more || TX.acct !== p.account) {
      TX.rows = []; TX.marker = null; TX.done = false; TX.page = 1; TX.acct = p.account;
    }
    if (TX.loading || (more && TX.done)) return Promise.resolve();
    TX.loading = true;
    var params = { account: p.account, limit: 100, ledger_index_min: -1, ledger_index_max: -1, forward: false };
    if (more && TX.marker) params.marker = TX.marker;
    return rpc('account_tx', params).then(function (r) {
      TX.marker = r.marker || null;
      TX.done = !r.marker;
      var lpCur = p.lpToken && p.lpToken.currency;
      (r.transactions || []).forEach(function (e) {
        var t = e.tx || e.tx_json || {}, meta = e.meta || e.metaData;
        if (!meta || meta.TransactionResult !== 'tesSUCCESS') return;
        var d = txDeltas(meta, p.account, lpCur);
        var dA = sideDelta(p.rawA, d), dB = sideDelta(p.rawB, d);
        if (Math.abs(dA) < 1e-12) dA = 0;
        if (Math.abs(dB) < 1e-12) dB = 0;
        var kind = txKind(t, dA, dB);
        if (!kind) return;
        TX.rows.push({
          kind: kind, a: Math.abs(dA), b: Math.abs(dB), who: t.Account,
          t: t.date != null ? (t.date + 946684800) * 1000 : null, hash: t.hash || e.hash || ''
        });
      });
    }).catch(function () { TX.done = true; }).then(function () { TX.loading = false; });
  }

  function txList() {
    return TX.rows.filter(function (r) { return TX.filter === 'all' || r.kind === TX.filter; });
  }

  function renderTx() {
    var card = $('.tx-card'), body = card && card.querySelector('table.tx tbody'), p = window.__lxxPool;
    if (!body || !p) return;
    var list = txList();
    var pages = Math.max(1, Math.ceil(list.length / TX_PER));
    if (TX.page > pages) TX.page = pages;
    var from = (TX.page - 1) * TX_PER, slice = list.slice(from, from + TX_PER);
    body.innerHTML = '';
    if (!slice.length) {
      var tr0 = document.createElement('tr');
      tr0.className = 'lx-txrow';
      var td0 = el('td', null, TX.loading ? 'Reading this pool’s transactions…' : 'No transactions of this kind in the pool’s recent activity.');
      td0.colSpan = 6;
      td0.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
    slice.forEach(function (r) {
      // THE ROWS WERE BUILT AND NEVER SHOWN (RAZA 2026-09-15: "Pool transactions and Participants are still not loading").
      // The inherited sheet carries table.tx tbody tr:not(.lx-txrow){display:none!important} and the same for
      // #partList > :not(.lx-partrow) — Stellar's marker classes. My own check read the rows' text, which a
      // display:none row still returns; the rows were there and invisible.
      var tr = document.createElement('tr');
      tr.className = 'lx-txrow';
      var c1 = document.createElement('td');
      c1.appendChild(el('span', 'type-pill ' + r.kind, r.kind === 'swap' ? 'Swap' : (r.kind === 'deposit' ? 'Deposit' : 'Withdraw')));
      tr.appendChild(c1);
      [[r.a, p.a.name], [r.b, p.b.name]].forEach(function (x) {
        var td = document.createElement('td');
        var s = el('span', 'num', x[0] > 0 ? (txAmt(x[0]) + ' ' + x[1]) : '—');
        s.setAttribute('data-logoed', '1');
        td.appendChild(s);
        tr.appendChild(td);
      });
      var cw = document.createElement('td');
      var wc = el('div', 'wallet-cell');
      var av = el('div', 'wallet-avatar');
      if (ADDR_RE.test(r.who || '') && window.lxIdent) { try { av.innerHTML = window.lxIdent(r.who, 22); } catch (e) {} }
      wc.appendChild(av);
      wc.appendChild(document.createTextNode(short(r.who)));
      // The wallet opens its public page (RAZA 2026-09-15: "in pool transactions, Wallet column is unclickable").
      if (ADDR_RE.test(r.who || '')) { wc.setAttribute('data-lxacct', r.who); wc.style.cursor = 'pointer'; wc.title = r.who; }
      cw.appendChild(wc);
      tr.appendChild(cw);
      tr.appendChild(el('td', 'time-cell', r.t ? new Date(r.t).toLocaleString('en-US') : '—'));
      var cl = document.createElement('td');
      if (/^[0-9A-F]{64}$/i.test(r.hash)) {
        var a = el('a', 'ext-link');
        a.href = 'https://bithomp.com/explorer/' + r.hash;
        a.target = '_blank';
        a.rel = 'noopener nofollow';
        a.setAttribute('aria-label', 'View this transaction on Bithomp');
        a.innerHTML = TX.ext;
        cl.appendChild(a);
      }
      tr.appendChild(cl);
      body.appendChild(tr);
    });
    var foot = card.querySelector('.tx-foot');
    if (foot) {
      var info = foot.firstElementChild;
      if (info) {
        info.textContent = list.length
          ? ('Showing ' + (from + 1) + '–' + (from + slice.length) + ' of ' + list.length.toLocaleString('en-US') + (TX.done ? '' : '+') + ' transactions')
          : 'Showing 0 transactions';
      }
      var nb = foot.querySelectorAll('.controls button');
      if (nb[0]) nb[0].disabled = TX.page <= 1;
      if (nb[1]) nb[1].disabled = TX.page >= pages && TX.done;
    }
  }

  function wireTx() {
    var card = $('.tx-card');
    if (!card || card.__lxxTx) return;
    card.__lxxTx = 1;
    var svg = card.querySelector('.ext-link svg');
    TX.ext = svg ? svg.outerHTML : '';
    $$('.tx-filter button', card).forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        $$('.tx-filter button', card).forEach(function (x) { x.classList.toggle('active', x === b); });
        var l = (b.textContent || '').trim().toLowerCase();
        TX.filter = /swap/.test(l) ? 'swap' : (/deposit/.test(l) ? 'deposit' : (/withdraw/.test(l) ? 'withdraw' : 'all'));
        TX.page = 1;
        renderTx();
      }, true);
    });
    var nb = card.querySelectorAll('.tx-foot .controls button');
    if (nb[0]) nb[0].addEventListener('click', function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (TX.page > 1) { TX.page--; renderTx(); }
    }, true);
    if (nb[1]) nb[1].addEventListener('click', function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var pages = Math.max(1, Math.ceil(txList().length / TX_PER));
      if (TX.page < pages) { TX.page++; renderTx(); return; }
      if (TX.done) return;
      loadTx(true).then(function () {
        if (Math.ceil(txList().length / TX_PER) > TX.page) TX.page++;
        renderTx();
      });
    }, true);
  }

  // ---- Participants -------------------------------------------------------------------------------------
  // The liquidity providers ARE the LP token's holders, and xrpl.to keeps that holder list with each one's share
  // of supply — /lxapi/xrplrichlist, asked with the pool's own LP token. Drawn in the design's .part-row shape.
  var PART = { rows: [], total: 0, page: 1, per: 17, loading: false };
  if (!window.__lxxPoolAcctNav) {
    window.__lxxPoolAcctNav = 1;
    window.addEventListener('click', function (e) {
      var n = e.target && e.target.closest && e.target.closest('[data-lxacct]');
      if (!n || (e.target.closest && e.target.closest('a[href]'))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = '/account/xrpl/' + encodeURIComponent(n.getAttribute('data-lxacct'));
    }, true);
  }
  function partUrl(start) {
    var p = window.__lxxPool;
    return '/lxapi/xrplrichlist?iss=' + encodeURIComponent(p.lpToken.issuer) + '&cur=' + encodeURIComponent(p.lpToken.currency)
      + '&n=100' + (start ? '&start=' + start : '');
  }
  function loadParticipants() {
    var p = window.__lxxPool;
    if (!p || !p.lpToken) { participants('This pool has no LP token.'); return; }
    PART = { rows: [], total: 0, page: 1, per: 17, loading: true };
    participants('Reading the liquidity providers…');
    fetch(partUrl(0)).then(function (r) { return r.json(); }).then(function (d) {
      PART.loading = false;
      if (!d || !d.ok) { participants('Could not load the liquidity providers.'); return; }
      PART.rows = d.rows || [];
      PART.total = d.total != null ? +d.total : PART.rows.length;
      renderParticipants();
      setStat('participant', PART.total.toLocaleString('en-US'), 'liquidity providers');
    }).catch(function () { PART.loading = false; participants('Could not load the liquidity providers.'); });
  }
  function renderParticipants() {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      var from = (PART.page - 1) * PART.per, slice = PART.rows.slice(from, from + PART.per);
      host.innerHTML = '';
      if (!slice.length) {
        var e0 = el('div', 'acc-empty lx-partrow', 'No liquidity providers found.');
        e0.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
        host.appendChild(e0);
      }
      slice.forEach(function (h) {
        var row = el('div', 'part-row lx-partrow');
        var av = el('div', 'part-avatar');
        if (ADDR_RE.test(h.account || '') && window.lxIdent) { try { av.innerHTML = window.lxIdent(h.account, 26); } catch (e) {} }
        row.appendChild(av);
        row.appendChild(el('div', 'wallet', short(h.account)));
        var share = h.holding != null ? +h.holding : 0;
        row.appendChild(el('div', 'share', (share < 0.01 && share > 0 ? '<0.01' : share.toFixed(2)) + '%'));
        var bar = el('div', 'share-bar'), fill = el('div', 'fill');
        fill.style.width = Math.max(2, Math.min(100, share)) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        row.title = h.account;
        // A provider opens their public wallet page (RAZA 2026-09-15: "participants are unclickable").
        if (ADDR_RE.test(h.account || '')) { row.setAttribute('data-lxacct', h.account); row.style.cursor = 'pointer'; }
        host.appendChild(row);
      });
      var card = host.closest('.side-card');
      if (!card) return;
      var pill = card.querySelector('.count-pill');
      if (pill) pill.textContent = PART.total.toLocaleString('en-US');
      var foot = card.querySelector('.part-foot');
      if (!foot) return;
      // The inherited sheet hides .part-foot:not(.lx-partfoot) until a data layer vouches for its figures.
      foot.classList.add('lx-partfoot');
      var info = foot.firstElementChild;
      if (info) info.textContent = slice.length
        ? ('Viewing ' + (from + 1) + ' – ' + (from + slice.length) + ' of ' + PART.total.toLocaleString('en-US'))
        : 'Viewing 0 of 0';
      var nb = foot.querySelectorAll('.nav button');
      if (nb[0] && !nb[0].__lxx) {
        nb[0].__lxx = 1;
        nb[0].addEventListener('click', function (e) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (PART.page > 1) { PART.page--; renderParticipants(); }
        }, true);
      }
      if (nb[1] && !nb[1].__lxx) {
        nb[1].__lxx = 1;
        nb[1].addEventListener('click', function (e) {
          e.preventDefault(); e.stopImmediatePropagation();
          if (PART.page * PART.per < PART.rows.length) { PART.page++; renderParticipants(); return; }
          if (PART.rows.length >= PART.total || PART.loading) return;
          PART.loading = true;
          fetch(partUrl(PART.rows.length)).then(function (r) { return r.json(); }).then(function (d) {
            PART.loading = false;
            if (d && d.ok && d.rows && d.rows.length) { PART.rows = PART.rows.concat(d.rows); PART.page++; }
            renderParticipants();
          }).catch(function () { PART.loading = false; });
        }, true);
      }
      if (nb[0]) nb[0].disabled = PART.page <= 1;
      if (nb[1]) nb[1].disabled = PART.page * PART.per >= PART.total;
    });
  }

  function paint(acct, amm) {
    var a = side(amm.amount), b = side(amm.amount2);
    if (!a || !b) return;

    // Quote the token against XRP where there is an XRP side, which is how the rest of the site
    // denominates a pair.
    var xrpSide = a.name === 'XRP' ? a : (b.name === 'XRP' ? b : null);
    var tok = a.name === 'XRP' ? b : a;

    wireTvlRanges(acct);
    loadTvl(acct);

    // STELLAR'S HEADER (RAZA 2026-09-15: "the top section is different on XRPL. Compare the text"):
    // the two token marks, each ticker a link to its Trade page, "Pool ID: …" with copy and explorer,
    // the price per the other side with no fee beside it, and each stat with its unit and a dollar line.
    $$('.ph-icons').forEach(function (icons) {
      tokImg(icons.querySelector('.pa'), a);
      tokImg(icons.querySelector('.pb'), b);
    });
    $$('.ph-name').forEach(function (nameEl) {
      nameEl.textContent = '';
      nameEl.setAttribute('data-lxpair', a.name + ' / ' + b.name);
      [a, b].forEach(function (s, k) {
        if (k) nameEl.appendChild(el('span', 'lx-phsep', ' / '));
        var lk = el('a', 'lx-phlink', s.name);
        lk.href = s.issuer ? ('/trade/xrpl/' + encodeURIComponent(s.name + '-' + s.issuer)) : '/trade/xrpl';
        nameEl.appendChild(lk);
      });
    });

    // On this ledger a pool IS an account, so that is its id; the copy button carries the whole of it.
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'Pool ID: ' + short(acct);
    var exp = $('.ph-id button[data-tooltip="View on Explorer"]');
    if (exp && exp.parentNode) {
      var ea = document.createElement('a');
      ea.href = 'https://bithomp.com/explorer/' + encodeURIComponent(acct);
      ea.target = '_blank';
      ea.rel = 'noopener nofollow';
      ea.title = 'View on Explorer';
      ea.setAttribute('aria-label', 'View pool on Bithomp');
      ea.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:inherit;text-decoration:none';
      while (exp.firstChild) ea.appendChild(exp.firstChild);
      exp.parentNode.replaceChild(ea, exp);
    }
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', acct);
      copyBtn.setAttribute('data-copy-label', 'AMM account');
    }

    // With an XRP side the token is priced in XRP. A token/token pool (FUZZY/TIME) is priced in its second
    // asset per its first — lumoscore.com's "12.3739 AQUA per VELO" — rather than left blank (RAZA 2026-09-15).
    var quoteSide = xrpSide || b, baseSide = xrpSide ? tok : a;
    var price = (quoteSide && baseSide && baseSide.amount > 0) ? (quoteSide.amount / baseSide.amount) : null;
    // The phone labels this block "Pool Price" and puts the figure in `.value` / `.sub`, not
    // `.ph-price .v` / `.s`. Without the fallback it kept the design's "0.000713 APT".
    var pv = $('.ph-price .v') || $('.ph-price .value');
    if (!pv) pv = priceBlock('value');
    if (pv) pv.textContent = price != null ? (num(price, 6) + ' ' + quoteSide.name) : '—';
    var feePct = amm.trading_fee != null ? (amm.trading_fee / 1000) : null;
    var ps = $('.ph-price .s') || $('.ph-price .sub');
    if (!ps) ps = priceBlock('sub');
    // The trading fee is a RATE, so it rides with the price rather than in a cell labelled
    // 'Fees Collected (24h)' -- which is an amount. Putting 0.625% there read as 0.625 XRP earned.
    // No fee here: Stellar's price block is the rate alone.
    if (ps) ps.textContent = price != null ? (' per ' + baseSide.name) : '';

    // Liquidity is stated as BOTH reserves. A single number here would be a choice of denominator,
    // and the mock's "~$1.43M" was exactly that kind of invented total.
    var liq = statCell('liquidity');
    if (liq && liq.querySelector('.v')) {
      unitVal(liq.querySelector('.v'), num(a.amount, 2), a.name);
      var ls = liq.querySelector('.s');
      if (ls) {
        // Stellar's second side, in the same weight as the first, then the pool's dollar value.
        ls.textContent = '';
        var big2 = el('span');
        big2.style.cssText = 'font-size:clamp(15px,1.35vw,18px);font-weight:800;letter-spacing:-.2px;color:var(--text);display:block';
        big2.appendChild(document.createTextNode(num(b.amount, 2) + ' '));
        var u2 = el('span', null, b.name);
        u2.setAttribute('data-logoed', '1');
        u2.style.cssText = 'font-size:.7em;font-weight:700;opacity:.6;margin-left:3px;letter-spacing:0';
        big2.appendChild(u2);
        ls.appendChild(big2);
        var usdLine = el('span');
        usdLine.style.cssText = 'font-size:11.5px;color:var(--text-muted);display:block;margin-top:2px';
        ls.appendChild(usdLine);
        // Both sides of a pool are worth the same, so the XRP side doubled is the whole pool.
        if (xrpSide) usdRate().then(function (usd) { if (usd) usdLine.textContent = usdShort(xrpSide.amount * 2 * usd); });
      }
    } else {
      setStat('liquidity', num(a.amount, 2) + ' ' + a.name, '+ ' + num(b.amount, 2) + ' ' + b.name);
    }

    var lp = amm.lp_token ? Number(amm.lp_token.value) : null;
    // Both of these are 24h AMOUNTS the ledger does not keep, so amm_info cannot supply them and the
    // honest placeholder goes in first. loadStats() replaces them when the indexer has the pool —
    // which it did, and that mattered: /pools/xrpl listed this very pool with a 24h volume while its
    // own detail page said the figure does not exist. One pool, two answers, on two pages of the
    // same site.
    setStat('vol', '—', 'not kept by the ledger');
    setStat('fees', '—', 'not kept by the ledger');
    loadStats(acct, a, b);
    setStat('participant', '—', 'liquidity providers');

    // The RAW ledger amounts ride along beside the display ones. side() turns them into names and
    // numbers for painting, which throws away the currency/issuer pair — and that pair is exactly
    // what an AMMDeposit needs to identify the pool. Keeping both means the form can never be built
    // from a formatted string.
    window.__lxxPool = {
      account: acct, a: a, b: b, fee: feePct, lpSupply: lp,
      rawA: amm.amount, rawB: amm.amount2, lpToken: amm.lp_token || null
    };
    paintDwStatic();
    paintPositionIdentity();
    liftPage();
    loadPosition();
    // The wallet's "Remove" on an LP position links here with ?act=withdraw — open on that tab.
    if (/[?&]act=withdraw\b/.test(location.search)) {
      var wb = $('.dw-tabs button[data-dw="withdraw"]');
      if (wb && !wb.classList.contains('active')) wb.click();
    }
  }

  // THE POSITION PANEL'S TWO ASSETS, WHATEVER THE CONNECTION. The design ships LUMOS and APT marks and
  // names there (RAZA 2026-09-15: "why's it showing APTOS logo"), and only a connected wallet's position
  // ever repainted the names — never the marks.
  function paintPositionIdentity() {
    var p = window.__lxxPool;
    if (!p) return;
    $$('.my-position .mp-asset, .my-position-m .mpm-asset').forEach(function (row, i) {
      var s = (i % 2 === 0) ? p.a : p.b;
      tokImg(row.querySelector('.mp-asset-ico, .mpm-asset-ico'), s);
      var nm = row.querySelector('.mp-asset-name, .mpm-asset-name');
      if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = s.name; }
      var amtEl = row.querySelector('.mp-asset-amt, .mpm-asset-amt');
      if (amtEl && !p.myLp) amtEl.textContent = '0';
    });
    if (!p.myLp) bothPos('fee-val').forEach(function (v, i) { v.textContent = (i % 2 === 0) ? '—' : '0'; });
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

  // The figure beside a "You receive" asset: the row's last child that is not the asset label itself.
  function recvOut(row) {
    var kids = [].filter.call(row.children, function (c) { return !(c.classList && c.classList.contains('asset')); });
    return kids.length ? kids[kids.length - 1] : null;
  }

  // Everything on this card that the design baked with Aptos values and does not depend on a balance.
  function paintDwStatic() {
    var p = window.__lxxPool;
    if (!p) return;

    // THE ASSET ROWS WERE HIDDEN, NOT MISSING (RAZA 2026-09-15: "Logos are missing"). The inherited sheet
    // hides `.dw-field .row .asset:not([data-lxpair])` until a data layer vouches for it; Stellar's sets
    // data-lxpair and puts the token's own image in `.ico`. Both are done here.
    var fields = $$('#dwDeposit .dw-field');
    [p.a, p.b].forEach(function (s, i) {
      var f = fields[i];
      if (!f) return;
      var asset = f.querySelector('.asset');
      if (asset) {
        asset.setAttribute('data-lxpair', '1');
        tokImg(asset.querySelector('.ico'), s);
        var wrote = false;
        [].forEach.call(asset.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) { nd.nodeValue = ' ' + s.name + ' '; wrote = true; }
        });
        if (!wrote) asset.appendChild(document.createTextNode(' ' + s.name + ' '));
      }
    });

    var wf = $('#dwWithdraw .dw-field .asset');
    if (wf) {
      wf.setAttribute('data-lxpair', '1');
      tokImg(wf.querySelector('.ico'), p.b.name === 'XRP' ? p.a : p.b);
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
        as.setAttribute('data-lxpair', '1');
        tokImg(as.querySelector('.ico'), s);
        [].forEach.call(as.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = s.name;
        });
        // The amount beside it shipped as the design's "620.30" / "1,860.90" (RAZA 2026-09-15: "I dont have any
        // liquidity in this pool … i think its a placeholder"). Nothing comes back until an LP amount is typed.
        var lpIn = dwInputs().lp, out = recvOut(rows[i]);
        if (out && !(lpIn && parseFloat(String(lpIn.value).replace(/,/g, '')) > 0)) out.textContent = '0';
      });
    }

    // Stellar's box states the pool share after and the network fee; its fee-tier row is hidden.
    $$('.dw-summary .r').forEach(function (r) {
      var k = r.querySelector('span');
      if (k && /trading fee/i.test(k.textContent || '')) r.style.display = 'none';
    });
    setSummary('network fee', '≈ 0.00001 XRP');
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
  // THE PHONE HAS ITS OWN POSITION PANEL, with its own class family, and it kept the whole mock.
  //
  // Desktop is `.my-position` / `.mp-*`; the phone is `.my-position-m` / `.mpm-*`. Every selector
  // here named only the first, so at 375px the panel still read:
  //     Position Value 0.18%  $1,247.50  ▲ $32.18 (2.65%) · all time
  //     LUMOS 874,521   APT 623.40   Earned fees +$8.92   LP tokens 23,415.82
  // on a pool where nothing is held, with another chain's asset in it.
  //
  // NOTE THIS IS NOT THE PREFIX RELATIONSHIP dexasset.js could exploit: "mpm-amount" does not
  // contain "mp-amount", so `[class*="mp-amount"]` would miss it entirely. Each family has to be
  // named, which is precisely why one of them was forgotten.
  function bothPos(desktopSuffix, phoneSuffix) {
    return $$('.my-position .mp-' + desktopSuffix + ', .my-position-m .mpm-' + (phoneSuffix || desktopSuffix));
  }

  function clearMockPosition() {
    var connected = addr();
    bothPos('amount').forEach(function (a) {
      a.textContent = connected ? 'No position' : 'Connect a wallet';
    });

    // Replaced wholesale: the "· all time" is a bare text node beside the span, so blanking only
    // the span would leave the page reading "— · all time".
    bothPos('pnl').forEach(function (p) { p.textContent = '—'; });
    // The phone puts the delta straight into .pnl-up/.pnl-down with no .mpm-pnl wrapper.
    $$('.my-position-m .pnl-up, .my-position-m .pnl-down').forEach(function (p) { p.textContent = '—'; });

    $$('.position-share-pill, .my-position-m .mpm-share').forEach(function (s) { s.textContent = '0%'; });

    // Amounts, fees and the asset tickers. The tickers matter as much as the numbers: leaving them
    // is how "APT" ends up labelling a row on an XRP Ledger pool.
    $$('.my-position-m .mpm-asset-amt, .my-position-m .mpm-fee-val').forEach(function (v) {
      v.textContent = '—';
    });
    $$('.my-position-m .mpm-asset-name').forEach(function (n) { n.textContent = '—'; });
    // THE DESKTOP CARD WAS MISSING FROM THIS LIST, and only the phone's tickers were being cleared — so a pool that failed to
    // load still showed "APT" against a position on an XRP Ledger pool. Found on the failure page 2026-09-16.
    $$('.mp-asset-amt, .mp-fee-val').forEach(function (v) { v.textContent = '—'; });
    $$('.mp-asset-name').forEach(function (n) { n.setAttribute('data-logoed', '1'); n.textContent = '—'; });
  }

  function loadPosition() {
    var me = addr(), p = window.__lxxPool;
    clearMockPosition();
    if (!me || !p) { paintPositionIdentity(); return; }
    Promise.all([
      rpc('account_info', { account: me, ledger_index: 'validated' }).catch(function () { return null; }),
      window.lxx.allLines(rpc, me).catch(function () { return null; }),
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
        if (bal) bal.textContent = 'Balance: ' + num(pair[0], 6);   // the asset is named in the row below, as on Stellar
      });
      var wbal = $('#dwWithdraw .balance');
      if (wbal) wbal.textContent = 'Your LP: ' + (myLp > 0 && myLp < 0.000001 ? myLp.toFixed(12).replace(/0+$/, '') : num(myLp, 6));

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

    // BOTH PANELS. Every selector below used to name the desktop family only, so a real position
    // painted on desktop and never reached the phone at all — the phone would have shown the
    // cleared placeholder no matter what the account actually held.
    var amts = bothPos('asset-amt');
    [[p.a, p.balAmt = p.a.amount * share], [p.b, p.b.amount * share]].forEach(function (x, i) {
      if (amts[i]) amts[i].textContent = num(x[1], 6);
    });
    bothPos('asset-name').forEach(function (n, i) {
      // Two panels means up to four elements, so the index is taken per pair rather than absolutely.
      n.textContent = (i % 2 === 0) ? p.a.name : p.b.name;
    });
    paintPositionIdentity();
    var fees = bothPos('fee-val');
    if (fees[0]) fees[0].textContent = '—';
    if (fees[1]) fees[1].textContent = num(p.myLp, 6);
    $$('.position-share-pill, .my-position-m .mpm-share').forEach(function (pill) {
      pill.textContent = share > 0 ? ((share * 100).toFixed(4) + '%') : '0%';
    });
    bothPos('amount').forEach(function (amt) {
      amt.textContent = share > 0 ? (num(p.myLp, 4) + ' LP') : 'No position';
    });
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
        var out = recvOut(rows[k]);
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
    var withdrawAll = !!(i.lp.__lxxAll && i.lp.value === i.lp.__lxxAllVal && p.myLp > 0);
    if (!(v > 0) && !withdrawAll) { dwSay('Enter how many LP tokens to withdraw.', 'bad'); return; }
    if (!withdrawAll && v > p.myLp) { dwSay('You hold ' + num(p.myLp, 6) + ' LP tokens.', 'bad'); return; }
    if (!p.lpToken) { dwSay('This pool has no LP token to withdraw.', 'bad'); return; }
    // TOO SMALL FOR THE LEDGER TO RETURN (RAZA 2026-09-16: "Its not letting me withdraw the liq because the liq is too small" —
    // tecAMM_FAILED on screen). A withdrawal whose share works out to less than one drop is refused on-chain, which costs a
    // signature and a network fee to find out. The arithmetic is the pool's own, so it is said here instead.
    var dust = tooSmall(p, withdrawAll ? p.myLp : v);
    if (dust) { dwSay(dust, 'bad'); return; }
    dwSay('Approve the withdrawal in your wallet…');
    if (cta) cta.disabled = true;
    window.lxc.submit({
      TransactionType: 'AMMWithdraw', Account: me,
      Asset: asset, Asset2: asset2,
      LPTokenIn: withdrawAll ? undefined : { currency: p.lpToken.currency, issuer: p.lpToken.issuer, value: String(v) },
      Flags: withdrawAll ? 0x00020000 : TF_LP_TOKEN                      // tfWithdrawAll : tfLPToken
    }).then(function () {
      dwSay('Liquidity withdrawn.', 'good');
      // A confirmation, not a state: it goes once the page has had time to reload the position.
      setTimeout(function () { dwSay(''); }, 5000);
      i.lp.__lxxAll = false;
      i.lp.value = '';
      setTimeout(function () { if (window.__lxxPoolDetailReload) window.__lxxPoolDetailReload(); }, 3000);
    }).catch(function (e) {
      dwSay((e && e.message) || 'The withdrawal could not be made.', 'bad');
    }).then(function () { if (cta) cta.disabled = false; });
  }

  // What a share of the pool actually returns. XRP cannot be paid in less than a drop (0.000001), so a position whose share
  // of either reserve falls under that is unwithdrawable — the ledger answers tecAMM_FAILED rather than rounding up.
  function rawVal(raw) { return typeof raw === 'string' ? Number(raw) / 1e6 : Number(raw && raw.value); }
  function tooSmall(p, lp) {
    if (!(p.lpSupply > 0) || !(lp > 0)) return '';
    var share = lp / p.lpSupply;
    var sides = [p.rawA, p.rawB];
    for (var i = 0; i < sides.length; i++) {
      var out = rawVal(sides[i]) * share;
      if (typeof sides[i] === 'string' ? out < 1e-6 : !(out > 0)) {
        return 'This position is too small to withdraw: its share of the pool comes to less than one drop of XRP, and the '
          + 'ledger cannot pay out zero. Adding liquidity first would make it withdrawable.';
      }
    }
    return '';
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
        // MAX MEANS EVERYTHING (RAZA 2026-09-16: "When i withdrew MAX liquidity … it left behind tiny amount"): the box shows six
        // decimals, so the withdrawal is tfWithdrawAll rather than the rounded number.
        ii.lp.__lxxAll = f === 1;
        ii.lp.__lxxAllVal = ii.lp.value;
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
      var d = el('div', 'acc-empty lx-partrow', text);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      host.appendChild(d);
    });
  }

  // THE LOADING STATE SHOWS DASHES, NOT ANOTHER CHAIN'S NUMBERS.
  //
  // releaseGates() is called FIRST in load(), deliberately — a page that waits behind its own
  // fade-in gate reads as broken, and that was fixed once already. But lifting the gate before the
  // ledger answers reveals whatever the design shipped underneath, and what it ships is Aptos sample
  // data: "0.000713 APT" as the price, "3,420,180 APT" liquidity, "8,420 APT" volume, "42.10 APT"
  // fees. RAZA on 2026-09-29: "There's a flash bug on XRPL - pools page, when refreshed it shows APT".
  //
  // So the trade was a blank page for a page confidently showing the wrong chain's figures, which is
  // worse. The stats are blanked at the same moment the name becomes "Reading the XRP Ledger…", so
  // the two agree: the page says it is reading, and shows nothing it has not read.
  function clearMockStats() {
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = '';
    setStat('liquidity', '—', '');
    setStat('vol', '—', '');
    setStat('fees', '—', '');
    setStat('participant', '—', '');
    clearChart();
  }

  function fail(msg) {
    // THE MESSAGE HAS TO BE VISIBLE (RAZA 2026-09-16: "[still happening. What the hell. FIX IT ALREADY] Sometimes Pools-pool
    // page is taking forever to load. But when i refresh, it loads up"). THIS IS THE CAUSE: liftPage() — which lifts the
    // design's `html:not(.lx-ammready) .pool-header{visibility:hidden}` gate — was only ever called from paint(), the success
    // path. One dropped read from the public node therefore left the ENTIRE page blank with no error on it, and a refresh
    // (a second, luckier read) "fixed" it. The gate is now lifted on the way out as well, so a failure says so.
    liftPage();
    releaseGates();
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
    // The design ships this page filled with another chain's sample data, and the success path is what normally overwrites
    // it. Without this, a pool that could not be read showed "3.19M APT" across the chart and a table of invented trades
    // under the words "Pool not found". Cleared HERE as well as in load(): the design paints its own card after that early
    // pass, so "LUMOS / APT" came back while the ledger read was still in flight.
    clearChart();
    clearMockPosition();
    var txBody = $('.tx-card') && $('.tx-card').querySelector('table.tx tbody');
    if (txBody) {
      txBody.innerHTML = '';
      var tr = document.createElement('tr');
      tr.className = 'lx-txrow';
      var td = el('td', null, 'No transactions to show.');
      td.colSpan = 6;
      td.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
      tr.appendChild(td);
      txBody.appendChild(tr);
    }
  }

  // The design's fade-in gate holds these at opacity 0 until something marks them done; nothing else ever does on this page.
  function releaseGates() {
    liftPage();                                          // the html-level gate, lifted whatever else happens
    [].forEach.call(document.querySelectorAll('.pool-layout, .pool-header, [data-lcmu]'), function (n) {
      n.setAttribute('data-lcm-done', '1'); n.classList.add('lcm-on'); n.classList.add('lcmu-in');
      n.style.setProperty('opacity', '1', 'important');
    });
  }

  function load() {
    // THE PAGE IS SOMETIMES STILL BEING BUILT WHEN THIS RUNS (RAZA 2026-09-16: "[still happening] Sometimes Pools-pool page is taking
    // forever to load. But when i refresh, it loads up"): on a pool URL it waits for the header rather than giving up for good.
    // AND IT KEEPS WAITING (RAZA 2026-09-16: "[still happening. What the hell. FIX IT ALREADY] Sometimes Pools-pool page is
    // taking forever to load. But when i refresh, it loads up"). Ten seconds of waiting was not always enough, and giving up
    // left the page blank behind its own fade-in gate with nothing to lift it. The gates are now released FIRST — so whatever
    // the design has built is visible while this waits — and the wait continues, more slowly, for a minute and a half.
    // CLEARED BEFORE THE GATES COME OFF, not after. On the success path the two are consecutive
    // synchronous statements, so no paint can land between them — but the RETRY path below returns
    // early with the gates already released, and then waits 250ms before trying again. That window
    // is a visible page showing "3,420,180 APT", and it is the one a slow first load hits.
    clearMockStats();
    releaseGates();
    if (!$('.pool-header')) {
      var n = (load.tries = (load.tries || 0) + 1);
      if (/\/pools\/xrpl\/id\//.test(window.location.pathname) && n < 120) setTimeout(load, n < 40 ? 250 : 1000);
      return;
    }

    var acct = fromUrl();
    if (!acct) { fail('No pool in this address.'); return; }

    var name = $('.ph-name');
    if (name) name.textContent = 'Reading the XRP Ledger…';
    clearMockStats();
    wireDw();

    // BEFORE the amm_info call, not inside paint(). paint() is the success path, so leaving the
    // clear there meant a pool that failed to load — a bad address, an RPC wobble — kept the
    // design's $1,247.50 position on screen under an error message.
    clearMockPosition();
    releaseGates();

    rpc('amm_info', { amm_account: acct }).catch(function (e) {
      // One dropped read from the public node is asked again before the page says it could not read the pool.
      if (/not found|actNotFound/i.test(String(e && e.message))) throw e;
      return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return rpc('amm_info', { amm_account: acct }); });
    }).then(function (r) {
      if (!r || !r.amm) { fail('That account is not an AMM.'); return; }
      paint(acct, r.amm);
      // The LP token's holder list is public after all — xrpl.to keeps it — so the list is real now.
      loadParticipants();
      wireTx();
      var txLoad = loadTx(false);
      renderTx();
      txLoad.then(renderTx);
    }).catch(function (e) {
      fail((e && e.message) === 'no pool' ? 'That account is not an AMM.' : 'Could not read the pool.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolDetailReload = load;
})();
