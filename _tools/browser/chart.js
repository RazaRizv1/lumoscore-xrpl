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
    var stroke = up ? '#22c55e' : '#e5484d';

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

    // Hover readout, using the tooltip elements the design already ships.
    var tip = $('#chartTooltip'), tDate = $('#ctDate'), tPrice = $('#ctPriceXrpl2');
    if (tip) {
      host.onmousemove = function (ev) {
        var r = host.getBoundingClientRect();
        var frac = (ev.clientX - r.left) / Math.max(1, r.width);
        var idx = Math.max(0, Math.min(pts.length - 1, Math.round(frac * (pts.length - 1))));
        var p = pts[idx];
        if (tDate) tDate.textContent = new Date(p[0]).toLocaleDateString('en-GB',
          { day: 'numeric', month: 'short', year: 'numeric' });
        if (tPrice) tPrice.textContent = money(p[1]);
        tip.style.opacity = '1';
      };
      host.onmouseleave = function () { tip.style.opacity = ''; };
    }
  }

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
