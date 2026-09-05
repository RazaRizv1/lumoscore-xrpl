// Pools page: XRP Ledger AMM pools.
//
// Replaces `lx-ammdata` (~286KB), which was walking STELLAR's Horizon on an XRP Ledger site. The
// page announced "Ranking the network's pools… 7,800 scanned so far" and then rendered TVL in XLM.
//
// Ranked by 24h VOLUME. Measured, not preferred: the upstream's own liquidity ranking returns five
// BITx pools each claiming 113,142,29x of liquidity with zero trade -- a worthless token paired
// with another worthless token inflates nominal value for free. Volume cannot be faked without
// paying fees.
//
// Icons are initials drawn as inline SVG. The page carries a logo healer that repaints any element
// with 1-5 characters of text as a ticker logo, and it does not look at classes -- an SVG child is
// the only thing it skips. See browser/trade.js for the full story.
(function () {
  if (window.__lxxPools) return;
  window.__lxxPools = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function initials(n) { return String(n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); }

  function icon(name, size) {
    var s = size || 22;
    var e = el('span', 'lxx-pic');
    e.style.cssText = 'display:inline-flex;width:' + s + 'px;height:' + s + 'px;flex:0 0 ' + s + 'px';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('width', String(s)); svg.setAttribute('height', String(s));
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', '16');
    c.setAttribute('fill', 'rgba(255,255,255,.12)');
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '16'); t.setAttribute('y', '17');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '800'); t.setAttribute('fill', '#fff');
    t.textContent = initials(name);
    svg.appendChild(c); svg.appendChild(t);
    e.appendChild(svg);
    return e;
  }

  function nameOf(s) {
    if (!s) return '?';
    if (!s.i || s.c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(s.c).display; } catch (e) { return s.c.slice(0, 6); }
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function count(v) {
    return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // Sixth gate of this shape in the project, and the first one on the ROOT element:
  //     html:not(.lx-ammready) #poolsBody, html:not(.lx-ammready) #poolTabs .count
  //         { visibility: hidden }
  // The class goes on <html>, not on <body> and not on the container -- guessing the target failed
  // twice before scanning the stylesheet for what actually matches. These gates have now been found
  // on all three: the root, the body and the container itself. Always look the rule up; never guess
  // where the class belongs.
  function lift() {
    try { document.documentElement.classList.add('lx-ammready'); } catch (e) {}
  }

  function row(p, rank) {
    var tr = document.createElement('tr');

    tr.appendChild(el('td', null, String(rank)));

    var pair = el('td');
    var wrap = el('div', 'pool-pair');
    wrap.style.cssText = 'display:flex;align-items:center;gap:7px';
    wrap.appendChild(icon(nameOf(p.a1)));
    wrap.appendChild(icon(nameOf(p.a2)));
    wrap.appendChild(el('span', null, nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    if (p.fee != null) {
      var f = el('span', null, p.fee + '%');
      f.style.cssText = 'font-size:11px;opacity:.6;margin-left:4px';
      wrap.appendChild(f);
    }
    pair.appendChild(wrap);
    tr.appendChild(pair);

    tr.appendChild(el('td', null, amount(p.liq) + ' XRP'));
    tr.appendChild(el('td', null, amount(p.vol) + ' XRP'));
    tr.appendChild(el('td', null, amount(p.fees) + ' XRP'));
    tr.appendChild(el('td', null, count(p.holders)));

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () {
      // The pool detail route takes the two assets; the AMM account is the stable identifier.
      window.location.href = '/xrpl/pools/id/' + encodeURIComponent(p.acct);
    });
    return tr;
  }

  function note(tb, text) {
    tb.innerHTML = '';
    var tr = document.createElement('tr');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td);
    tb.appendChild(tr);
  }

  // The overview cards above the table. Filled from the SAME response as the rows, so the totals
  // cannot disagree with what is listed under them.
  function paintSummary(s) {
    if (!s) return;
    var map = [
      ['liquidity', amount(s.liquidity) + ' XRP'],
      ['volume', amount(s.vol24) + ' XRP'],
      ['fees', amount(s.fees24) + ' XRP'],
      ['pools', null]
    ];
    var cells = document.querySelectorAll('.stat-cell, .pga-cell, [class*=pool-stat]');
    for (var i = 0; i < cells.length; i++) {
      var lbl = cells[i].querySelector('.lbl');
      if (!lbl) continue;
      var name = lbl.textContent.trim().toLowerCase();
      for (var j = 0; j < map.length; j++) {
        if (map[j][1] != null && name.indexOf(map[j][0]) >= 0) {
          var v = cells[i].querySelector('.val');
          if (v) v.textContent = map[j][1];
        }
      }
    }
  }

  function attribution(d) {
    if (!d || !d.attribution || document.getElementById('lxx-attr-pools')) return;
    var host = $('#panelAllPools') || $('#panelAll');
    if (!host) return;
    var p = el('p'); p.id = 'lxx-attr-pools';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Pool data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  function load() {
    var tb = $('#poolsBody');
    if (!tb) return;                                   // not the Pools page
    lift();
    note(tb, 'Reading the XRP Ledger…');

    fetch('/lxapi/xrplpools?n=50').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.rows.length) { note(tb, 'Pool data is unavailable right now.'); return; }
      window.__lxxPoolsData = d;
      tb.innerHTML = '';
      for (var i = 0; i < d.rows.length; i++) tb.appendChild(row(d.rows[i], i + 1));
      paintSummary(d.summary);
      attribution(d);
    }).catch(function () { note(tb, 'Pool data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolsReload = load;
})();
