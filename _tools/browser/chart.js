// Price chart: a real line drawn from real candles.
//
// The design's chart SVG was built by `lx-ltdata`, so removing that Stellar layer left an empty
// 40x30 box where the chart had been. This draws its replacement from /lxapi/xrplohlc.
//
// WHAT IT WILL NOT DO. If the range comes back with fewer than two points there is no line to draw,
// and it says so rather than plotting a flat bar across the middle. A chart is a claim about how a
// price moved; a straight line through one point is a claim nobody made.
//
// Drawn as inline SVG rather than canvas so it scales with the container and inherits the page's
// colours, and because the logo healer on this page skips any element containing an svg.
(function () {
  if (window.__lxxChart) return;
  window.__lxxChart = 1;

  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // The one token this page is about. Other pages pass their own id via data-lxx-chart.
  var LUMOS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha-4C554D4F53000000000000000000000000000000';

  var state = { id: null, range: '7D', pts: [], vs: 'USD' };

  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v < 0.000001) return '$' + v.toExponential(2);
    if (v < 0.01) return '$' + v.toPrecision(4);
    if (v < 1000) return '$' + v.toFixed(4);
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function note(host, text) {
    host.innerHTML = '';
    var d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;'
      + 'min-height:140px;opacity:.6;font-size:13px';
    host.appendChild(d);
  }

  function draw(host, pts) {
    host.innerHTML = '';
    if (!pts || pts.length < 2) { note(host, 'No price history for this range.'); return; }

    var box = host.getBoundingClientRect();
    // The container can be collapsed at first paint; fall back to a sane aspect rather than
    // dividing by zero and emitting NaN path data, which renders as nothing at all.
    var W = Math.max(320, Math.round(box.width) || 640);
    var H = Math.max(150, Math.round(box.height) || 220);
    var padT = 10, padB = 10, padL = 2, padR = 2;

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    // A perfectly flat series would make the range zero and every y identical; give it a little
    // room so the line sits in the middle instead of on the floor.
    if (!(hi > lo)) { hi = lo * 1.0001 + 1e-12; lo = lo * 0.9999; }

    var x = function (i) { return padL + (i / (pts.length - 1)) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); };

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%',
      preserveAspectRatio: 'none', role: 'img',
      'aria-label': 'Price chart, ' + state.range,
    });
    svg.style.display = 'block';

    var up = pts[pts.length - 1][1] >= pts[0][1];
    // A LITERAL colour, not var(--green). CSS custom properties are NOT valid in SVG presentation
    // attributes -- only in CSS declarations -- so stroke='var(...)' leaves the path with no colour
    // and the chart renders as an invisible 180-segment line. Everything measured fine: correct
    // box, correct viewBox, hit-testable. Only the screenshot showed it.
    // The brand accent, as lumoscore.com's LUMOS chart draws it — not green-or-red by direction.
    var stroke = '#ea6a2c';

    var gradId = 'lxxChartGrad';
    var defs = svgEl('defs');
    var g = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    g.appendChild(svgEl('stop', { offset: '0%', 'stop-color': stroke, 'stop-opacity': '0.28' }));
    g.appendChild(svgEl('stop', { offset: '100%', 'stop-color': stroke, 'stop-opacity': '0' }));
    defs.appendChild(g);
    svg.appendChild(defs);

    var line = '', area = '';
    for (var j = 0; j < pts.length; j++) {
      var px = x(j).toFixed(2), py = y(pts[j][1]).toFixed(2);
      line += (j ? 'L' : 'M') + px + ',' + py;
    }
    area = line + 'L' + x(pts.length - 1).toFixed(2) + ',' + (H - padB)
      + 'L' + x(0).toFixed(2) + ',' + (H - padB) + 'Z';

    // THE CLASSES ARE LOAD-BEARING, not decoration. lx-lt-css carries
    //     #priceChart svg path:not(.lx-cline):not(.lx-carea), ... { display:none !important }
    // which is how the old layer suppressed the design's mock chart markup while still showing the
    // two paths it drew itself. Inherit that contract: an unclassed path is hidden, so it has a
    // valid `d`, a real stroke and getTotalLength() of 1559 while painting absolutely nothing.
    // getBBox() reading 0x0 is the tell -- it does not compute for a display:none element, whereas
    // getTotalLength() happily does.
    svg.appendChild(svgEl('path', { d: area, class: 'lx-carea', fill: 'url(#' + gradId + ')' }));
    svg.appendChild(svgEl('path', {
      d: line, class: 'lx-cline', fill: 'none', stroke: stroke, 'stroke-width': '2',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }));
    svg.appendChild(svgEl('circle', {
      cx: x(pts.length - 1), cy: y(pts[pts.length - 1][1]), r: '3', fill: stroke,
    }));

    host.appendChild(svg);

    // THE NINTH ANTI-FLASH GATE. `#priceChart:not(.lxlt) svg{visibility:hidden}` ships in lx-lt-css,
    // and the class was added by lx-ltdata -- the layer this file replaces. So a chart with correct
    // data, a valid path and a real stroke colour still paints nothing, and everything that reads
    // the DOM says it is fine: 168 segments, hit-testable box, computed stroke rgb(229,72,77).
    // getBBox() reading 0x0 while getBoundingClientRect() read 928x214 was the only tell, because
    // getBBox does not compute for an unpainted element. Lift it here, after the draw, so the gate
    // still does its job of hiding the design's mock until real data has landed.
    host.classList.add('lxlt');

    wireHover(host, pts, W, H, x, y);
  }

  // THE HOVER CARD lumoscore.com draws (RAZA 2026-09-15: "there's no hover on chart like on Stellar"): a dot on the line,
  // a guide, and a card with the date, the price, the volume in dollars and the trade count. Its .lx-chtip / .lx-chdot /
  // .lx-chvl rules are inherited. Trades come from /lxapi/xrpltrades, fetched for the whole range when it draws, so a
  // hovered point either shows its count or no Trades row — never a placeholder.
  var TR = {};
  function whenLabel(t) {
    var d = new Date(t);
    if (state.range === '1H' || state.range === '24H') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (state.range === '7D') return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function compact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function wireHover(host, pts, W, H, x, y) {
    host.__lxxHov = { pts: pts, W: W, H: H, x: x, y: y };
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) {
      if (host.querySelector('.' + c)) return;
      var n = document.createElement('div');
      n.className = c;
      n.setAttribute('data-logoed', '1');
      n.style.opacity = '0';
      host.appendChild(n);
    });
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    function line(cls, t) {
      var n = document.createElement('div');
      n.className = cls;
      if (t != null) n.textContent = t;
      n.setAttribute('data-logoed', '1');
      return n;
    }
    function hide() {
      ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) { var n = host.querySelector('.' + c); if (n) n.style.opacity = '0'; });
    }
    function move(cx) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      var tip = host.querySelector('.lx-chtip'), dot = host.querySelector('.lx-chdot'), vl = host.querySelector('.lx-chvl');
      if (!S || !svg || !tip || !dot || !vl || S.pts.length < 2) return;
      var r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (cx - r.left) / Math.max(1, r.width)));
      var idx = Math.round(frac * (S.pts.length - 1)), p = S.pts[idx];
      var lx = r.left - hr.left + S.x(idx) / S.W * r.width;
      var ly = r.top - hr.top + S.y(p[1]) / S.H * r.height;
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = '1';
      vl.style.left = lx + 'px'; vl.style.top = (r.top - hr.top) + 'px'; vl.style.bottom = 'auto';
      vl.style.height = r.height + 'px'; vl.style.opacity = '1';
      tip.textContent = '';
      tip.appendChild(line('d', whenLabel(p[0])));
      tip.appendChild(line('l', 'Price'));
      tip.appendChild(line('p', money(p[1])));
      var vol = (+p[5] || 0) * (XRP_USD || 0);               // volume is in XRP (see XRP_USD)
      var rv = line('lxrow');                                // shown for a quiet candle too, as "$0"
      rv.appendChild(line('l', 'Volume'));
      rv.appendChild(line('p', compact(vol)));
      tip.appendChild(rv);
      var step = S.pts[1][0] - S.pts[0][0];
      var te = idx < S.pts.length - 1 ? S.pts[idx + 1][0] : p[0] + step;
      var tkey = state.id + '|' + p[0] + '|' + te;
      tip.__lxxKey = tkey;
      var n = TR[tkey];
      var addTrades = function (cnt) {
        if (tip.querySelector('.lxx-trades-row')) return;
        var rt = line('lxrow lxx-trades-row');
        rt.appendChild(line('l', 'Trades'));
        rt.appendChild(line('p', cnt.toLocaleString('en-US')));
        tip.appendChild(rt);
      };
      if (n != null) addTrades(n);
      else {
        // A window the range fetch could not count (the upstream refuses bursts) is asked for on its own once the
        // pointer settles; the row is added when the number arrives, never as a placeholder.
        clearTimeout(host.__lxxTrT);
        host.__lxxTrT = setTimeout(function () {
          var parts = String(state.id || '').split('-');
          if (!parts[1] || TR[tkey] != null) return;
          fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(parts[0]) + '&cur=' + encodeURIComponent(parts[1])
            + '&s=' + p[0] + '&e=' + te)
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.ok || d.truncated || d.n == null) return;
              TR[tkey] = +d.n;
              if (tip.__lxxKey === tkey && tip.style.opacity === '1') addTrades(+d.n);
            }, function () {});
        }, 160);
      }
      if (XRP_USD == null && Date.now() - (host.__lxxRateAt || 0) > 15000) {
        host.__lxxRateAt = Date.now();
        fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
          .then(function (j) { if (j && j.ok && j.usd > 0) XRP_USD = j.usd; }, function () {});
      }
      tip.style.opacity = '1';
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = lx + 14;
      if (tx + tw > hr.width) tx = lx - tw - 14;
      if (tx < 2) tx = 2;
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(2, ly - th - 12) + 'px';
    }
    host.addEventListener('mousemove', function (e) { move(e.clientX); });
    host.addEventListener('mouseleave', hide);
    host.addEventListener('touchstart', function (e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX); }, { passive: true });
    host.addEventListener('touchmove', function (e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX); }, { passive: true });
  }
  function prefetchTrades(pts) {
    if (!pts || pts.length < 2 || pts.length > 400) return;
    var parts = String(state.id || '').split('-'), iss = parts[0], cur = parts[1];
    if (!iss || !cur) return;
    var step = pts[1][0] - pts[0][0];
    var b = pts.map(function (q) { return q[0]; });
    b.push(pts[pts.length - 1][0] + step);
    var id0 = state.id, range0 = state.range;
    // Twelve windows per request (the endpoint's cap), three requests at a time.
    var starts = [];
    for (var s0 = 0; s0 < b.length - 1; s0 += 12) starts.push(s0);
    function worker() {
      if (!starts.length || id0 !== state.id || range0 !== state.range) return null;
      var i = starts.shift();
      var ch = b.slice(i, Math.min(b.length, i + 13));
      return fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(iss) + '&cur=' + encodeURIComponent(cur) + '&b=' + ch.join(','))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.n) d.n.forEach(function (n, j) { if (n != null) TR[id0 + '|' + ch[j] + '|' + ch[j + 1]] = n; });
        }, function () {})
        .then(worker);
    }
    worker(); worker(); worker();
  }

  // XRP/USD for the Volume line: xrplohlc's volume column is in XRP (its last 24 hourly values × XRP/USD equal the
  // token's published 24h volume; read as LUMOS they came to $0.00007).
  var XRP_USD = null;
  fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.usd > 0) XRP_USD = j.usd; }, function () {});
  // Read-only view of the hover's inputs, for checking the live page.
  window.__lxxChartState = function () { return { id: state.id, range: state.range, trades: Object.keys(TR).length, xrpUsd: XRP_USD }; };

  function load(range) {
    var host = $('#priceChart');
    if (!host) return;
    state.range = range || state.range;
    note(host, 'Loading price history…');

    fetch('/lxapi/xrplohlc?id=' + encodeURIComponent(state.id)
      + '&r=' + encodeURIComponent(state.range) + '&vs=USD')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { note(host, 'Price history is unavailable right now.'); return; }
        state.pts = d.pts || [];
        window.__lxxChartData = d;
        draw(host, state.pts);
      })
      .catch(function () { note(host, 'Price history is unavailable right now.'); });
  }

  // The range buttons are the design's own; match them by their label rather than by an attribute
  // they do not carry.
  function wireRanges() {
    var labels = ['1H', '24H', '7D', '30D', '1Y', 'ALL'];
    $$('button, .tf, .range-btn, [class*=tf] > *').forEach(function (b) {
      var t = (b.textContent || '').trim().toUpperCase();
      if (labels.indexOf(t) < 0) return;
      if (b.__lxx) return;
      b.__lxx = 1;
      b.addEventListener('click', function () {
        // Move the design's own active class with the selection.
        var sibs = b.parentElement ? b.parentElement.children : [];
        for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove('active');
        b.classList.add('active');
        load(t);
      });
    });
  }

  function boot() {
    var host = $('#priceChart');
    if (!host) return;                                   // not a page with this chart
    state.id = host.getAttribute('data-lxx-chart') || LUMOS;
    wireRanges();
    load(state.range);

    // Redraw when the container's WIDTH changes, not just when the window resizes.
    //
    // The path is computed in pixels against the box measured at draw time, so a draw that lands
    // while the card is still collapsed bakes in that width and never recovers -- the window never
    // resizes, so the old listener alone never fired. A ResizeObserver catches the case that
    // actually happens here: layout settling, a font landing, a tab panel opening.
    //
    // Guarded on a real change of at least 8px so the observer cannot re-trigger itself through the
    // draw it just caused, and skipped entirely at width 0, where there is nothing to measure.
    var last = 0, t = null;
    var redraw = function (w) {
      if (!w || Math.abs(w - last) < 8 || !state.pts.length) return;
      last = w;
      clearTimeout(t);
      t = setTimeout(function () { draw(host, state.pts); }, 60);
    };
    if (window.ResizeObserver) {
      new ResizeObserver(function (entries) {
        redraw(Math.round(entries[0].contentRect.width));
      }).observe(host);
    }
    window.addEventListener('resize', function () {
      redraw(Math.round(host.getBoundingClientRect().width));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.__lxxChartReload = load;
})();
