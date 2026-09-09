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
// Icons are real token logos, proxied through /lxapi/xrplthumb so the xrpl.to API key stays
// server-side, falling back to initials drawn as inline SVG. The SVG matters beyond looks: the page
// carries a logo healer that repaints any element with 1-5 characters of text as a ticker logo and
// does not look at classes -- an img or svg child is the only thing it skips. See browser/trade.js.
(function () {
  if (window.__lxxPools) return;
  window.__lxxPools = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Real logo when we have one, initials when we do not.
  //
  // The <img> is wrapped in the SAME inline-SVG-bearing span used for initials, because the page
  // carries a logo healer that repaints any element with 1-5 characters of text -- an element
  // holding an img or svg is the only thing it skips. See browser/trade.js.
  //
  // The image goes through /lxapi/xrplthumb, never xrpl.to directly: that endpoint needs the API
  // key and the key must not reach the browser.
  function logoEl(name, md5, size) {
    var s = size || 32;
    var NS = 'http://www.w3.org/2000/svg';
    var e = document.createElement('span');
    e.className = 'lxx-ic';
    e.style.cssText = 'display:inline-flex;width:'+s+'px;height:'+s+'px;flex:0 0 '+s+'px;'
      + 'border-radius:50%;overflow:hidden;align-items:center;justify-content:center';

    function initials() {
      e.innerHTML = '';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('width', String(s)); svg.setAttribute('height', String(s));
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', '16');
      c.setAttribute('fill', 'rgba(255,255,255,.12)');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '16'); t.setAttribute('y', '17');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '800');
      t.setAttribute('fill', '#fff');
      t.textContent = String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      svg.appendChild(c); svg.appendChild(t);
      e.appendChild(svg);
    }

    if (/^[0-9a-f]{32}$/i.test(md5 || '')) {
      var img = document.createElement('img');
      img.src = '/lxapi/xrplthumb?id=' + md5 + '&w=' + (s > 48 ? 64 : 48);
      img.alt = ''; img.loading = 'lazy'; img.width = s; img.height = s;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      // A token with no logo upstream 404s. Fall back rather than leave a broken image.
      img.onerror = initials;
      e.appendChild(img);
    } else {
      initials();
    }
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

  // EVERY POOL ROW 404'd, and the cause was a layer that was never ours.
  //
  // The design ships a blanket navigation helper, window.__lumosNav, configured with
  //     LISTTARGET = 'amm-pool'   // blanket row target for pure list pages
  //     CONTAINERNAV = true       // allow container-signal row nav
  // so it claims a click on ANY row of a list page and routes it through lxNavigate/lxClean, which
  // resolve to the Stellar route shape — /pools/<chain>, with the chain defaulting to "stellar"
  // because this build is not one they know. On the XRP Ledger fork that destination does not exist,
  // so every pool row landed on Page not found.
  //
  // Three things did NOT fix it, and each ruled something out: a plain click handler (it answers
  // later and wins), the same handler in capture on the row (capture descends from the top, so a
  // document-level listener still runs first), and a real <a href> (it preventDefaults the anchor).
  // The trace that settled it recorded the click reaching the anchor with the correct href, then an
  // unload, then arrival at /pools/stellar with the pools page as referrer — one navigation, decided
  // by a handler, not by the browser or the server.
  //
  // WINDOW capture is the earliest phase there is: it runs before any document-level listener, so
  // stopImmediatePropagation here settles the question before anything else is consulted. Scoped
  // strictly to clicks inside #poolsBody, so no other navigation on the page is affected.
  function claimRowClicks() {
    if (window.__lxxPoolNav) return;
    window.__lxxPoolNav = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tr = t.closest('#poolsBody tr');
      if (!tr) return;
      var a = tr.querySelector('a.pool-pair');
      if (!a) return;
      // Let a genuine modifier-click (new tab, new window) behave normally.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }

  function row(p, rank) {
    var tr = document.createElement('tr');

    tr.appendChild(el('td', null, String(rank)));

    var pair = el('td');
    // A REAL ANCHOR, not a scripted navigation. Setting window.location from a click handler here was
    // being overridden: every row click ended on /pools/stellar — the Stellar route shape
    // /pools/<chain>/id/<id> with the chain defaulting to "stellar" — even from a capture-phase
    // listener that stopped propagation, and even though assigning the same URL outside a click
    // navigates correctly. Something inherited answers the click later and wins.
    //
    // An anchor sidesteps the argument entirely: the browser navigates natively, and the site's own
    // link-cleaning handler only rewrites hrefs matching lumoscore-*.html, so it leaves this one
    // alone. It is also how the Stellar build links its pool rows, so this is the shape the rest of
    // the page already expects — and it gives the row middle-click and open-in-new-tab for free.
    var wrap = el('a', 'pool-pair');
    wrap.href = '/xrpl/pools/id/' + encodeURIComponent(p.acct);
    wrap.style.cssText = 'display:flex;align-items:center;gap:7px;color:inherit;text-decoration:none';
    wrap.appendChild(logoEl(nameOf(p.a1), p.a1 && p.a1.m, 22));
    wrap.appendChild(logoEl(nameOf(p.a2), p.a2 && p.a2.m, 22));
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
    return tr;
  }

  // THE PHONE HAS A DIFFERENT CONTAINER, AND IT WAS GETTING NOTHING.
  //
  // load() opened with `var tb = $('#poolsBody'); if (!tb) return;` — and the mobile page has no
  // #poolsBody. It has #panelAll, a list of .pool-card anchors. So on a phone this entire layer
  // returned on its first line: no real rows, no summary, no overview, no attribution, and the
  // design's own mock left standing — LUMOS / APT, USDC / APT, CELL / APT, "51,250 APT", eight
  // fabricated pools with liquidity and volume figures, visible at rest.
  //
  // Requiring the desktop container is called out in browser/wallet.js as the most repeated bug in
  // this project. It is the same one.
  function card(p, rank) {
    var a = el('a', 'pool-card');
    a.href = '/xrpl/pools/id/' + encodeURIComponent(p.acct);

    var head = el('div', 'pc-head');
    var icons = el('div', 'pair-icons');
    // The design's two discs, replaced with the same real logos the table uses.
    var ia = logoEl(nameOf(p.a1), p.a1 && p.a1.m, 26); ia.classList.add('a');
    var ib = logoEl(nameOf(p.a2), p.a2 && p.a2.m, 26); ib.classList.add('b');
    icons.appendChild(ia); icons.appendChild(ib);
    head.appendChild(icons);

    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    // The design's second line is a hand-written category ("Native · Utility"). There is no such
    // classification on this ledger, so it carries the pool's fee — a fact, and the thing a
    // liquidity provider actually wants beside the pair.
    info.appendChild(el('div', 'pc-sub', p.fee != null ? (p.fee + '% fee tier') : ''));
    head.appendChild(info);
    head.appendChild(el('div', 'pc-idx', '#' + (rank < 10 ? '0' : '') + rank));
    a.appendChild(head);

    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    stats.appendChild(stat('Liquidity', amount(p.liq) + ' XRP'));
    stats.appendChild(stat('24h Vol', amount(p.vol) + ' XRP'));
    stats.appendChild(stat('Members', count(p.holders)));
    a.appendChild(stats);
    return a;
  }

  // Whichever list this page actually has.
  function listHost() {
    var tb = $('#poolsBody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelAll');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  function noteHost(h, text) {
    if (h.kind === 'table') { note(h.node, text); return; }
    h.node.innerHTML = '';
    var d = el('div', null, text);
    d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
    h.node.appendChild(d);
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

  // The "Market Overview" card, which the summary painter above never reached because it keys on
  // different classes. Every one of its four rows was the design's mock, in the wrong asset:
  //
  //   Total Liquidity  12.7M APT ≈ $5.32M   (really 28.6M XRP)
  //   Active Pools     100 · "+4 in past 7 days"   (really 30,663; the 7-day delta has no source)
  //   24h Volume       $21,483.83 · "51,250 APT swapped"   (really 470,740 XRP)
  //   Participants     11,274 · "Unique LP wallets"
  //
  // PARTICIPANTS IS SET TO A DASH, not a number. Who holds an LP token is not something a public node
  // will enumerate — the pool detail page already says so in as many words — so 11,274 is not a stale
  // figure, it is an invented one, and replacing it with a different invented one would be no better.
  // The same goes for "+4 in past 7 days": nothing here knows what the count was a week ago.
  // The page's own strapline read "Provide liquidity and earn fees on Stellar's on-chain AMM pools",
  // above a table of XRP Ledger AMMs. Rewritten by text node so the design's markup is untouched.
  function paintHeroCopy() {
    $$('.dex-hero-sub').forEach(function (p) {
      if (!/Stellar|Aptos/i.test(p.textContent || '')) return;
      var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = w.nextNode())) {
        if (!n.nodeValue) continue;
        n.nodeValue = n.nodeValue.replace(/Stellar's/gi, 'the XRP Ledger’s')
          .replace(/\bStellar\b/gi, 'the XRP Ledger').replace(/\bAptos\b/gi, 'the XRP Ledger');
      }
    });
  }

  function paintOverview(d) {
    var s = d && d.summary;
    if (!s) return;
    var rows = $$('.amm-snapshot-row');
    if (!rows.length) return;

    // The USD rate lives on the tokens endpoint, the same one every other USD figure on this site is
    // derived from, so the overview cannot disagree with the rest of the page about what an XRP is.
    fetch('/lxapi/xrpltokens').then(function (r) { return r.json(); }).then(function (t) {
      return (t && t.ok && +t.usd > 0) ? +t.usd : null;
    }).catch(function () { return null; }).then(function (usd) {
      rows.forEach(function (row) {
        var label = ((row.querySelector('.amm-snapshot-label') || {}).textContent || '').trim().toLowerCase();
        var val = row.querySelector('.amm-snapshot-value');
        var vsub = row.querySelector('.amm-snapshot-vsub');
        var sub = row.querySelector('.amm-snapshot-sub');

        function setVal(text, unit) {
          if (!val) return;
          val.textContent = text;
          if (unit) {
            var u = document.createElement('span');
            u.className = 'unit';
            // data-logoed: a three-letter ticker is exactly what the logo layer claims.
            try { u.setAttribute('data-logoed', '1'); } catch (e) {}
            u.textContent = unit;
            val.appendChild(u);
          }
        }

        // Matched anywhere in the label, not at position 0: the row reads "Total Liquidity", so an
        // indexOf(...) === 0 test silently skipped it and left 12.7M APT sitting beside three
        // corrected rows — the one wrong figure in a block that otherwise looked freshly filled.
        if (label.indexOf('liquidity') >= 0) {
          setVal(amount(s.liquidity), 'XRP');
          if (vsub) vsub.textContent = usd ? ('≈ $' + Math.round(s.liquidity * usd).toLocaleString('en-US')) : '';
        } else if (label.indexOf('active pools') === 0) {
          setVal(d.total != null ? count(d.total) : '—');
          if (sub) sub.textContent = 'Across the XRP Ledger';   // no week-ago figure to compare with
        } else if (label.indexOf('24h volume') === 0) {
          setVal(amount(s.vol24), 'XRP');
          if (sub) sub.textContent = usd ? ('≈ $' + Math.round(s.vol24 * usd).toLocaleString('en-US') + ' swapped') : 'past 24 hours';
        } else if (label.indexOf('participant') === 0) {
          setVal('—');
          if (sub) sub.textContent = 'Not published by a public node';
        }
      });
    });
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
    var h = listHost();
    if (!h) return;                                    // not the Pools page
    lift();
    claimRowClicks();
    paintHeroCopy();
    noteHost(h, 'Reading the XRP Ledger…');

    fetch('/lxapi/xrplpools?n=50').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok || !d.rows.length) { noteHost(h, 'Pool data is unavailable right now.'); return; }
      window.__lxxPoolsData = d;
      h.node.innerHTML = '';
      var make = h.kind === 'table' ? row : card;
      for (var i = 0; i < d.rows.length; i++) h.node.appendChild(make(d.rows[i], i + 1));
      paintSummary(d.summary);
      paintOverview(d);
      attribution(d);
    }).catch(function () { noteHost(h, 'Pool data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolsReload = load;
})();
