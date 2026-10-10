// Search: XRP Ledger tokens.
//
// REPLACES A LIVE WRONG-CHAIN LAYER. `lx-searchassets` shipped a STELLAR asset index and ran on
// every page of this site: typing "USD" returned Stellar assets with G-issuers, and the page
// prefetched their logos from /lxapi/assetlogo. Like the Trade table, it was not broken-looking --
// it was confidently answering about the wrong ledger.
//
// A TICKER IS NOT AN IDENTITY. Searching "USD" here returns RLUSD (Ripple), USDC (Circle), USD
// (Bitstamp), USD (RippleFox), USDT (XRPS), USDC (GateHub) -- two different USDs and two different
// USDCs, all real. So every row shows the issuer's name AND its address, and results come back
// ordered by 24h volume rather than by name, because alphabetical ordering puts an impostor above
// the token someone actually meant.
//
// Icons are real token logos via /lxapi/xrplthumb (the key stays server-side), falling back to
// initials. They use a class of our own: the design's `.sp-ico` is a hook for the inherited Stellar
// icon painter, which resolves logos by TICKER and would put the wrong chain's mark on a match.
(function () {
  if (window.__lxxSearch) return;
  window.__lxxSearch = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var MIN = 2;
  var seq = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function initials(n) { return String(n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); }

  function short(a) { return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }

  function holders(v) {
    if (v == null || !isFinite(v)) return null;
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M holders';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K holders';
    return v + ' holder' + (v === 1 ? '' : 's');
  }

  (function () {
    if (document.getElementById('lxx-sea-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-sea-css';
    st.textContent = '.lxx-sea-ic{width:30px;height:30px;flex:0 0 30px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;'
      + 'font-weight:800;color:#fff;background:rgba(255,255,255,.10)}'
      + '.lxx-sea-note{padding:18px 14px;text-align:center;opacity:.65;font-size:13.5px}'
      // THE ROWS WERE RENDERING AS DEFAULT BROWSER LINKS — blue and underlined.
      //
      // The row is an <a>, and the design's `.sp-row` rule sets layout only: display, gap, padding,
      // cursor. Nothing in it resets link colour or underline, because on Stellar the row also
      // carries `lx-searow`, added by Stellar's own search layer — and that layer's stylesheet is
      // not in this build, so the class exists there and nowhere here. Measured on both:
      // lumoscore.com gives rgb(246,245,243)/none, this build gave rgb(0,0,238)/underline.
      //
      // Declared here rather than by adding the Stellar class, so it does not depend on a
      // stylesheet this build does not ship.
      + '.sp-row.sp-row--asset{color:inherit;text-decoration:none}';
    document.head.appendChild(st);
  })();

  // Real logo when we have one, initials when we do not.
  //
  // The <img> is wrapped in the SAME inline-SVG-bearing span used for initials, because the page
  // carries a logo healer that repaints any element with 1-5 characters of text -- an element
  // holding an img or svg is the only thing it skips. See browser/trade.js.
  //
  // The image goes through /lxapi/xrplthumb, never xrpl.to directly: that endpoint needs the API
  // key and the key must not reach the browser.
  // iss/cur are optional and only matter when md5 is missing: the endpoint derives the id itself from
  // an issuer and a currency, which is how the wallet draws logos for holdings no ranking covers.
  function logoEl(name, md5, size, iss, cur) {
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

    // THE ID IS NOT THE ONLY WAY IN. An md5 when we have one; otherwise ask the endpoint to derive it
    // from the issuer and currency, which it already does for the wallet's holdings.
    //
    // This is what the Recent list needs. Entries are stored as data, and the ones written before `m`
    // was among the kept fields have an issuer and a currency but no id — so every one of them drew
    // initials forever, while the same token searched live drew its logo. RAZA saw it as "LUMOS logo is
    // not showing on XRPL search"; reproduced by writing a pre-fix entry by hand and getting "LUM".
    // Deriving here fixes those entries in place, with no migration and nothing to clear.
    var q = '';
    if (/^[0-9a-f]{32}$/i.test(md5 || '')) q = 'id=' + md5;
    else if (iss && cur) q = 'iss=' + encodeURIComponent(iss) + '&cur=' + encodeURIComponent(cur);

    if (q) {
      var img = document.createElement('img');
      img.src = '/lxapi/xrplthumb?' + q + '&w=' + (s > 48 ? 64 : 48);
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

  // WHICH ISSUERS GET THE TICK (RAZA 2026-10-05: "On search, its not showing the verificatin tick" and
  // "Also in recent searches its no showing the verifiation icon").
  //
  // This read xrpl.to's own `vf` flag and nothing else. `vf` is 0 for ARMY, for PHNIX and for most of the
  // roster, so the badge appeared on LUMOS and almost nowhere else — while the Trade page ticks all one
  // hundred rows it lists. One site giving two answers to the same question is worse than either answer.
  //
  // The rule is now the Trade table's and the wallet's: membership of /lxapi/xrpltokens, with LUMOS
  // pinned. `vf` still counts on top, so an issuer the upstream does vouch for keeps its badge even when
  // it is outside the top hundred. The caveat recorded in trade.js — this roster is ranked by volume, not
  // vetted by anyone, so the tick means "we list it" — applies here too and is not re-argued.
  //
  // FETCHED LAZILY, on the first use of the panel. This layer loads on every page of the site; pulling a
  // 34 KB roster on every page load to decorate a popup most visits never open is not a trade worth
  // making.
  //
  // AND DECIDED AT RENDER, NEVER TAKEN FROM THE STORED ROW. A recent search keeps the payload it was
  // opened with, `vf` included, so an entry saved before today would have carried vf:0 for as long as that
  // localStorage key lived — which is exactly the second half of the report. Nothing stored decides this.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var VSET = null, vAsked = false;

  function vKey(t) {
    return (t && t.i ? t.i : '') + '|' + String((t && t.c) || '').toUpperCase();
  }

  function vBadge() {
    var vb = el('span', 'lx-seavfd');
    vb.setAttribute('title', 'Verified issuer');
    var NSV = 'http://www.w3.org/2000/svg';
    var vs = document.createElementNS(NSV, 'svg');
    vs.setAttribute('viewBox', '0 0 24 24');
    vs.setAttribute('fill', 'none');
    vs.setAttribute('stroke', 'currentColor');
    vs.setAttribute('stroke-width', '3');
    vs.setAttribute('stroke-linecap', 'round');
    vs.setAttribute('stroke-linejoin', 'round');
    var vp = document.createElementNS(NSV, 'path');
    vp.setAttribute('d', 'M20 6L9 17l-5-5');
    vs.appendChild(vp);
    vb.appendChild(vs);
    return vb;
  }

  // An empty slot is hidden rather than left as a zero-width span, so it can never add a stray gap to a
  // row that is not ticked.
  function vPaint(slot) {
    var ok = slot.getAttribute('data-lxvf') === '1'
      || !!(VSET && VSET[slot.getAttribute('data-lxvk') || '']);
    var has = slot.firstChild;
    if (ok && !has) slot.appendChild(vBadge());
    else if (!ok && has) slot.removeChild(has);
    slot.style.display = ok ? '' : 'none';
  }

  function vApply() {
    [].forEach.call(document.querySelectorAll('.lx-seavslot'), vPaint);
  }

  function vLoad() {
    if (vAsked) return;
    vAsked = true;
    fetch('/lxapi/xrpltokens?n=100')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var s = {};
        [].forEach.call((d && d.rows) || [], function (x) {
          if (x && x.i && x.c) s[x.i + '|' + String(x.c).toUpperCase()] = 1;
        });
        VSET = s;
        vApply();
      })
      .catch(function () { vAsked = false; });        // a dropped request must not settle the answer
  }

  function rowFor(t) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-sea';
    a.__lxxT = t;                                   // what a recent-search entry stores when this row is opened
    a.setAttribute('data-chain', 'xrpl');
    a.href = '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i);

    // 36px and the design's own icon classes, which is what Stellar's rows use — ours were 30px
    // with a class of our own, so the icon column did not line up with the design's spacing.
    var ic = logoEl(t.n, t.m, 36, t.i, t.c);
    ic.className = 'sp-ico lx-spico-on';
    a.appendChild(ic);

    var info = el('div', 'sp-info');
    var nameRow = el('div', 'sp-name-row', t.n);

    // The verified badge Stellar shows beside a verified issuer. It goes in a SLOT rather than being
    // appended conditionally, because the domain pill is added straight after it and a badge that
    // arrives later must land before that pill, not after it. The slot also means the answer can be
    // revised once the roster lands — see vPaint.
    var vslot = el('span', 'lx-seavslot');
    vslot.setAttribute('data-lxvk', vKey(t));
    if (t.vf || t.i === LUMOS_ISS) vslot.setAttribute('data-lxvf', '1');
    nameRow.appendChild(vslot);
    vPaint(vslot);

    // THE HOME DOMAIN, as lumoscore.com's rows show it (RAZA 2026-09-15: "Its not showing homedomains in search").
    // The issuer's display name stands in only where no domain is published; a FirstLedger toml host is where a
    // file is stored, not whose token it is.
    var dom = t.i === LUMOS_ISS ? 'lumoscore.com' : rootDomain(t.d);
    var pillTxt = dom || t.u;
    // A pill that only repeats the token's own name says nothing ("Atom" beside "Atom").
    if (pillTxt && pillTxt.toLowerCase() !== String(t.n || '').toLowerCase()) {
      nameRow.appendChild(document.createTextNode(' '));
      var pill = el('span', 'sp-domain', pillTxt);
      // SHORT PILLS WERE EMPTIED ("x.com"). The search icon painter stamps the row's ticker on any 1-5 character
      // element and ignores data-logoed; the one thing it skips is an element holding an svg, so the pill carries an
      // empty zero-size one.
      pill.setAttribute('data-logoed', '1');
      var nsv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      nsv.setAttribute('width', '0'); nsv.setAttribute('height', '0'); nsv.setAttribute('aria-hidden', 'true');
      nsv.style.cssText = 'width:0;height:0;display:inline;overflow:hidden';
      pill.appendChild(nsv);
      nameRow.appendChild(pill);
    }
    info.appendChild(nameRow);
    // The issuer is part of the answer, not decoration: it is the only thing separating two tokens
    // that share a ticker.
    // The issuer address shows once, on the right. It was appearing twice per row.
    // Stellar's second line: the code, then the holders.
    info.appendChild(el('div', 'sp-sub', [codeOf(t.c) || t.n, holders(t.h)].filter(Boolean).join(' · ')));
    a.appendChild(info);

    var right = el('div', 'sp-right');
    var mini = el('div', 'sp-addr-mini', short(t.i));
    mini.setAttribute('data-copy', t.i);
    mini.setAttribute('data-copy-label', t.n + ' issuer');
    right.appendChild(mini);
    a.appendChild(right);
    return a;
  }

  // THE ROOT DOMAIN ONLY (RAZA 2026-09-16: "Just show the root domain as homedomain" — firstledger.net, not
  // firstledger.net/token/rhc8…/5852…). Protocol, path, port and www. go; a two-letter country suffix keeps its label.
  function rootDomain(v) {
    var h = String(v || '').trim().replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0].split(':')[0].toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
    var p = h.split('.');
    if (p.length <= 2) return h;
    var keep = (/^(co|com|net|org|gov|edu|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) ? 3 : 2;
    return p.slice(-keep).join('.');
  }
  // A 5x5 mirrored identicon drawn from the address, so every wallet has its own mark (RAZA 2026-09-16: "Use a unique identicon").
  function identSvg(addr, size) {
    var pal = ['#6f5ded', '#ef4444', '#22c55e', '#a855f7', '#06b6d4', '#f59e0b', '#ec4899', '#84cc16', '#ff894c', '#0ea5e9', '#14b8a6', '#facc15'];
    var h = 2166136261, i;
    addr = String(addr || '');
    for (i = 0; i < addr.length; i++) { h ^= addr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var bg = pal[h % pal.length], fg = pal[(h >>> 7) % pal.length];
    if (fg === bg) fg = pal[(h % pal.length + 5) % pal.length];
    var c = size / 5, rects = '', bits = h;
    function rect(x, y) { return '<rect x="' + (x * c).toFixed(2) + '" y="' + (y * c).toFixed(2) + '" width="' + c.toFixed(2) + '" height="' + c.toFixed(2) + '" fill="' + fg + '"></rect>'; }
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        bits = Math.imul(bits ^ (x * 7 + y * 13 + 1), 2654435761) >>> 0;
        if ((bits >>> 13) & 1) { rects += rect(x, y); if (x < 2) rects += rect(4 - x, y); }
      }
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="border-radius:50%;background:' + bg
      + ';display:block" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }

  // THE DESIGN'S SAMPLE RESULTS (RAZA 2026-09-16: "There's a flash bug on search … APT aptosfoundation.org … This asset doesnt
  // exist"). Its own list writes a row per keystroke before this layer's answer lands; only XRP Ledger rows are shown.
  (function () {
    if (document.getElementById('lxx-sea-gate')) return;
    var st = document.createElement('style');
    st.id = 'lxx-sea-gate';
    // Every row this layer draws carries .lx-sea or .lx-searow; the design's sample rows carry neither, whatever chain they
    // claim ("LUMOS lumosdao.io 0.4128 aBTC", "aBTC echo-protocol.xyz", "MOD thala.fi" — RAZA 2026-09-16).
    st.textContent = '#spAssetList .sp-row:not(.lx-sea):not(.lx-searow){display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  // A refused or dropped search is asked again before "Search is unavailable" (RAZA 2026-09-16: "rpls" failed where "RPLS" worked —
  // the query is case-insensitive at the edge; the first request had simply been refused).
  // MORE PATIENCE BEFORE GIVING UP (RAZA 2026-09-17: "Sometimes i get this error when i search for any asset", showing
  // "Search is unavailable right now" on a plain "lumos"). Two quick tries inside 1.4s were not enough when the upstream
  // throttles a burst of keystrokes: four, with the wait growing each time, cover it without hammering a 333-a-day budget.
  function searchFetch(q, tries) {
    return fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) return d;
        // A RATE LIMIT IS NOT A WOBBLE. Retrying a 429 four times only makes the reader wait six seconds for the same
        // answer (RAZA 2026-09-17, "batman"). It is reported as-is so the message can say what actually happened.
        if (d && /429/.test(String(d.error || ''))) { d.__rate = 1; return d; }
        throw new Error('retry');
      })
      .catch(function () {
        if (!(tries > 0)) return null;
        var wait = 600 * (5 - tries);                     // 600ms, 1.2s, 1.8s, 2.4s
        return new Promise(function (res) { setTimeout(res, wait); }).then(function () { return searchFetch(q, tries - 1); });
      });
  }

  function codeOf(c) {
    c = String(c || '');
    if (!/^[0-9A-F]{40}$/i.test(c)) return c;
    var s = '';
    for (var i = 0; i < 40; i += 2) { var n = parseInt(c.substr(i, 2), 16); if (n) s += String.fromCharCode(n); }
    return /^[\x20-\x7e]+$/.test(s) ? s : '';
  }

  // ---- RECENT SEARCHES -------------------------------------------------------------------------------
  // RAZA 2026-09-15: "its not saving the search history like it does on Stellar." lumoscore.com keeps the last
  // five opened results under "Recent" with a Clear button, shown whenever the box is empty — the .lx-rechead /
  // .lx-recgrp / .lx-recrow classes are its own and the inherited sheet styles them. What is stored is the row's
  // data, never its HTML, and it is drawn back through the same row builder, which writes text only.
  var RKEY = 'lumos.search.recent', RMAX = 5;
  var ADDR = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  function recGet() {
    try {
      var a = JSON.parse(localStorage.getItem(RKEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.n === 'string' && ADDR.test(x.i || ''); }).slice(0, RMAX) : [];
    } catch (e) { return []; }
  }
  function recAdd(t) {
    try {
      var keep = t.k ? { k: t.k, n: t.n, i: t.i, a1: t.a1, a2: t.a2 } : { n: t.n, u: t.u, i: t.i, c: t.c, h: t.h, vf: t.vf, m: t.m, d: t.d };
      var a = recGet().filter(function (x) { return !(x.i === keep.i && x.n === keep.n); });
      a.unshift(keep);
      localStorage.setItem(RKEY, JSON.stringify(a.slice(0, RMAX)));
    } catch (e) {}
  }
  function recPaint(list) {
    var a = recGet();
    list.innerHTML = '';
    if (!a.length) return false;
    var head = el('div', 'lx-rechead');
    head.appendChild(el('span', null, 'Recent'));
    var clr = el('button', 'lx-recclear', 'Clear');
    clr.type = 'button';
    clr.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      try { localStorage.removeItem(RKEY); } catch (x) {}
      list.innerHTML = '';
    });
    head.appendChild(clr);
    list.appendChild(head);
    // Wallets and pools are remembered too (RAZA 2026-09-15: "Its not saving Pools or wallet addresses that i searched"),
    // each under its own heading, drawn by the same row builders the results use.
    [['', 'Assets'], ['w', 'Wallets'], ['p', 'Pools']].forEach(function (g) {
      var group = a.filter(function (t) { return (t.k || '') === g[0]; });
      if (!group.length) return;
      list.appendChild(el('div', 'lx-recgrp', g[1]));
      group.forEach(function (t) {
        var r = g[0] === 'w' ? accountRow(t.i) : (g[0] === 'p' ? poolRow({ acct: t.i, a1: t.a1, a2: t.a2 }) : rowFor(t));
        r.classList.add('lx-recrow');
        list.appendChild(r);
      });
    });
    setCount(null);
    return true;
  }
  function recShowIfEmpty() {
    var inp = $('#spSearchInput'), list = $('#spAssetList');
    if (inp && list && !String(inp.value || '').trim()) recPaint(list);
  }
  if (!window.__lxxRecWired) {
    window.__lxxRecWired = 1;
    // Capture, because the row is a link and the entry must be written before the navigation it starts.
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var row = t.closest('#spAssetList .sp-row--asset');
      if (row && row.__lxxT) { recAdd(row.__lxxT); return; }
      // Opening the popup: show the history once it has mounted.
      if (t.closest('input[data-sp-wired], .search-trigger, .topbar-search, [data-open-search]')) {
        setTimeout(recShowIfEmpty, 120);
      }
    }, true);
  }

  // ---- wallets, pools, and holdings the index does not know ------------------------------------------
  // Rows in lumoscore.com's own markup: an account row ("… account · wallet", "Balances, pools and activity") and a pool row
  // (two .lx-pi circles, "A / B", "XRPL AMM"), both styled by the inherited sheet.
  // RAZA 2026-09-15: "I searched pool id for LUMOS and BXE but its not showing me option in search. Upon my second try, it
  // shows" — one dropped amm_info read meant no pool row. Asked twice before answering "not a pool".
  function rpcS(method, params) {
    return rpcS1(method, params).then(function (r) {
      if (r && !r.error) return r;
      return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return rpcS1(method, params); });
    });
  }
  function rpcS1(method, params) {
    return fetch('https://xrplcluster.com/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) { return j && j.result; }).catch(function () { return null; });
  }
  function sideName(s) { if (!s || !s.i || s.c === 'XRP') return 'XRP'; return codeOf(s.c) || s.c; }
  function sideThumb(s) {
    return (!s || !s.i) ? '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48'
      : ('/lxapi/xrplthumb?iss=' + encodeURIComponent(s.i) + '&cur=' + encodeURIComponent(s.c) + '&w=48');
  }
  function tag(cls, text) { var e = el('span', cls, text); e.setAttribute('data-logoed', '1'); return e; }
  function poolRow(p) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-searow';
    a.setAttribute('data-chain', 'xrpl');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);
    a.__lxxT = { k: 'p', n: 'pool', i: p.acct, a1: p.a1 && { c: p.a1.c, i: p.a1.i }, a2: p.a2 && { c: p.a2.c, i: p.a2.i } };
    var ico = el('div', 'sp-ico lx-spico-on lx-poolico');
    [p.a1, p.a2].forEach(function (s, k) {
      var pi = el('span', 'lx-pi lx-pi-' + (k ? 'b' : 'a'));
      pi.style.backgroundImage = 'url("' + sideThumb(s) + '")';
      ico.appendChild(pi);
    });
    a.appendChild(ico);
    var info = el('div', 'sp-info');
    var nr = el('div', 'sp-name-row');
    nr.appendChild(tag('lx-pool-pair', sideName(p.a1) + ' / ' + sideName(p.a2)));
    nr.appendChild(document.createTextNode(' '));
    nr.appendChild(tag('sp-domain', 'XRPL AMM'));
    info.appendChild(nr);
    info.appendChild(el('div', 'sp-sub', 'Liquidity pool' + (p.holders ? (' · ' + Number(p.holders).toLocaleString('en-US') + ' providers') : '')));
    a.appendChild(info);
    var right = el('div', 'sp-right');
    right.appendChild(el('div', 'sp-addr-mini', short(p.acct)));
    a.appendChild(right);
    return a;
  }
  function accountRow(addr) {
    var a = document.createElement('a');
    a.className = 'sp-row sp-row--asset lx-searow';
    a.setAttribute('data-chain', 'xrpl');
    a.href = '/account/xrpl/' + encodeURIComponent(addr);
    a.__lxxT = { k: 'w', n: 'wallet', i: addr };
    var ico = el('div', 'sp-ico lx-spico-on');
    ico.style.cssText = 'position:relative;overflow:hidden';
    ico.innerHTML = identSvg(addr, 36);
    a.appendChild(ico);
    var info = el('div', 'sp-info');
    var nr = el('div', 'sp-name-row', 'XRP Ledger account ');
    nr.appendChild(tag('sp-domain', 'wallet'));
    info.appendChild(nr);
    info.appendChild(el('div', 'sp-sub', 'Balances, pools and activity'));
    a.appendChild(info);
    var right = el('div', 'sp-right');
    right.appendChild(el('div', 'sp-addr-mini', short(addr)));
    a.appendChild(right);
    return a;
  }
  function dropNote(list) {
    [].forEach.call(list.querySelectorAll('.lxx-sea-note'), function (n) { n.parentNode.removeChild(n); });
  }
  function addressResults(list, q, mine) {
    list.innerHTML = '';
    setCount(null);
    list.appendChild(el('div', 'lx-recgrp', 'Wallets'));
    list.appendChild(accountRow(q));
    rpcS('amm_info', { amm_account: q }).then(function (r) {
      if (mine !== seq || !r || !r.amm) return;
      var side = function (x) { return typeof x === 'string' ? { c: 'XRP', i: '' } : { c: x.currency, i: x.issuer }; };
      list.appendChild(el('div', 'lx-recgrp', 'Pools'));
      list.appendChild(poolRow({ acct: q, a1: side(r.amm.amount), a2: side(r.amm.amount2) }));
    });
  }
  // The connected wallet's own trust lines, read once per page: a token the index has never heard of is still one
  // the user holds (RAZA 2026-09-15: "WHy cant i search this asset. I even have this asset in my wallet" — XYIELD,
  // absent from xrpl.to's index entirely).
  var LINES = null;
  function myLines() {
    if (LINES) return LINES;
    var me = '';
    try { me = localStorage.getItem('lumos.address') || ''; } catch (e) {}
    if (!me || !window.lxx || !window.lxx.allLines) return Promise.resolve([]);
    LINES = window.lxx.allLines(rpcS, me).then(function (r) { return (r && r.lines) || []; }, function () { return []; });
    return LINES;
  }
  function extras(list, q, d, mine) {
    var ql = q.toLowerCase();
    myLines().then(function (lines) {
      if (mine !== seq) return;
      var known = {};
      (d.rows || []).forEach(function (t) { known[t.i + '|' + t.c] = 1; });
      var hits = lines.filter(function (l) {
        if (/^03/.test(l.currency) || known[l.account + '|' + l.currency]) return false;
        var code = codeOf(l.currency) || l.currency;
        return code.toLowerCase().indexOf(ql) >= 0;
      }).slice(0, 5);
      if (!hits.length) return;
      dropNote(list);
      // PRESENTED AS AN ORDINARY ASSET, not as a section of its own (RAZA 2026-10-08, comparing the
      // two chains: "it also shows 'in your wallet' ... we dont have that on Stellar. so please
      // remove it from xrpl as well").
      //
      // The LOOKUP stays — it is the only reason XYIELD is findable at all, since xrpl.to's index
      // has never heard of it, which is what the "(0)" in that screenshot is saying. Only the
      // labelling goes: no group heading, and no "· in your wallet" under the name. Stellar needs no
      // equivalent because its assets come back from its own index with a holder count, so a row
      // there already looks like this.
      var anchor = list.querySelector('.lx-recgrp');                // before any pool group
      hits.forEach(function (l) {
        var code = codeOf(l.currency) || l.currency;
        var r = rowFor({ n: code, u: '', i: l.account, c: l.currency, h: null, vf: 0, m: '', d: '' });
        var ico = r.querySelector('.sp-ico');
        if (ico) {
          ico.innerHTML = '';
          var im = document.createElement('img');
          im.alt = '';
          im.src = sideThumb({ c: l.currency, i: l.account });
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
          ico.appendChild(im);
        }
        // No subtitle override: rowFor already writes the code alone when there is no holder count,
        // which is exactly how an indexed row reads minus the figure we genuinely do not have.
        list.insertBefore(r, anchor);
      });
      // COUNTED, because these rows ARE assets on the ledger. render() set the heading from the
      // index alone, so a token only the wallet knows about left it reading "(0)" above a visible
      // result — the contradiction in the screenshot.
      setCount(((d && d.rows) ? d.rows.length : 0) + hits.length);
    });
    var issuers = [];
    (d.rows || []).forEach(function (t) { if (issuers.indexOf(t.i) < 0 && issuers.length < 2) issuers.push(t.i); });
    if (!issuers.length) return;
    Promise.all(issuers.map(function (iss) {
      return fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(iss))
        .then(function (r) { return r.json(); }).catch(function () { return null; });
    })).then(function (res) {
      if (mine !== seq) return;
      var rows = [], got = {};
      res.forEach(function (p) {
        ((p && p.rows) || []).forEach(function (r) { if (r.acct && !got[r.acct]) { got[r.acct] = 1; rows.push(r); } });
      });
      rows.sort(function (a, b) { return (+b.liq || 0) - (+a.liq || 0); });
      rows = rows.slice(0, 5);
      if (!rows.length) return;
      list.appendChild(el('div', 'lx-recgrp', 'Pools'));
      rows.forEach(function (p) { list.appendChild(poolRow(p)); });
    });
  }

  function note(list, text) {
    list.innerHTML = '';
    list.appendChild(el('div', 'lxx-sea-note', text));
  }

  // THE COUNT IS OURS ALONE (RAZA 2026-09-16: "THere's a flash bug on search. It shows a count for split seconds when i input
  // any character. Its on all letters"). The design counts its own sample rows the moment a key is pressed — "(1)", "(7)",
  // "(8)" — and those rows are hidden by the gate above, so the number described nothing on screen. It is held at whatever
  // this layer last set, and anything else written into it is taken straight back out.
  var ownCount = '';
  function setCount(n) {
    ownCount = n == null ? '' : '(' + n + ')';
    var c = $('#spAssetCount');
    if (!c) return;
    if (c.textContent !== ownCount) c.textContent = ownCount;
    watchCount(c);
  }
  function watchCount(c) {
    if (!c || c.__lxxCw || !window.MutationObserver) return;
    c.__lxxCw = new MutationObserver(function () {
      if (c.textContent !== ownCount) c.textContent = ownCount;
    });
    c.__lxxCw.observe(c, { childList: true, characterData: true, subtree: true });
  }
  // The element only exists once the panel has mounted, and the flash happens on the FIRST keystroke — so the watch is put
  // in place as soon as it appears, before any search of ours has run.
  (function findCount(tries) {
    var c = $('#spAssetCount');
    if (c) { watchCount(c); return; }
    if ((tries || 0) < 60) setTimeout(function () { findCount((tries || 0) + 1); }, 400);
  })(0);
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'spSearchInput') watchCount($('#spAssetCount'));
  }, true);

  // The design's search is multi-chain and groups its results behind per-chain filter pills. This
  // build searches ONE ledger, so the only pill that can mean anything is the XRP Ledger one — and
  // what actually shipped was a pill reading "Aptos (9)" carrying data-chain="hedera", from the
  // design's own scrambled chain-name map. Clicking it filtered to a chain with no results, and the
  // (9) was a count of rows that are not in the list.
  //
  // Removed rather than relabelled: renaming it would still leave a filter for something this build
  // does not search. Every row this layer creates is stamped data-chain="xrpl", so anything else is
  // by definition not ours.
  // CALLING THIS ONCE PER RENDER IS NOT ENOUGH: the design rebuilds its filter row after results
  // land, so the pill reappeared immediately after being removed. Watched instead, the same way the
  // launchpad watches its cost panel — the container is observed and any foreign pill is taken out
  // whenever it is put back.
  function dropForeignFilters() {
    [].forEach.call(document.querySelectorAll('.sp-filter-pill'), function (b) {
      var c = (b.getAttribute('data-chain') || '').toLowerCase();
      if (c && c !== 'xrpl' && b.parentNode) b.parentNode.removeChild(b);
    });
  }

  function watchFilters() {
    if (window.__lxxSeaFilterWatch || !window.MutationObserver) return;
    var host = $('.sp-filters');
    if (!host) return;
    window.__lxxSeaFilterWatch = 1;
    // Removing a child mutates the container, so the observer re-enters. It is self-limiting because
    // the second pass finds nothing foreign left and mutates nothing — the same reasoning the
    // launchpad's cost observer relies on.
    new MutationObserver(dropForeignFilters).observe(host, { childList: true, subtree: true });
    dropForeignFilters();
  }

  function render(list, d) {
    list.innerHTML = '';
    watchFilters();
    if (!d.rows.length) { note(list, 'No XRP Ledger token matches that.'); setCount(0); return; }
    for (var i = 0; i < d.rows.length; i++) list.appendChild(rowFor(d.rows[i]));
    setCount(d.rows.length);
  }

  function run(q) {
    var list = $('#spAssetList');
    if (!list) return;
    if (!q) { seq++; if (!recPaint(list)) list.innerHTML = ''; setCount(null); return; }
    if (q.length < MIN) { note(list, 'Type at least ' + MIN + ' characters.'); setCount(null); return; }

    var mine = ++seq;
    watchFilters();
    // AN ADDRESS IS A WALLET (and maybe a pool), not a token name (RAZA 2026-09-15: "Its not searching wallets and also pools").
    if (window.lxx && window.lxx.isAddress(q)) { addressResults(list, q, mine); return; }
    // The previous query's count must go with its results — your screenshot showed "ASSETS ON THE XRP LEDGER (2)" sitting
    // above "Searching the XRP Ledger…", which is a count of rows that are no longer on screen.
    setCount(null);
    note(list, 'Searching the XRP Ledger…');
    searchFetch(q, 4)
      .then(function (d) {
        // Keystrokes race. Only the newest query may paint, or a slow early request lands on top of
        // a fast later one and the box shows results for something the user has stopped typing.
        if (mine !== seq) return;
        if (!d || !d.ok) {
          note(list, (d && d.__rate)
            ? 'The market data provider is rate-limiting us. Searches for assets already looked at still work — try again in a minute.'
            : 'Search is unavailable right now.');
          setCount(null);
          return;
        }
        // ONE LUMOS (RAZA 2026-09-16: "Dont show up any other variants of LUMOS on XRP search") — tokens named after it by
        // other issuers ("LUMOS lumosdao.org", "DaoLumos") are left out.
        d.rows = (d.rows || []).filter(function (t) {
          return t.i === 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha' || !/lumos/i.test(String(t.n || '') + ' ' + String(codeOf(t.c) || ''));
        });
        render(list, d);
        extras(list, q, d, mine);
      })
      .catch(function () {
        if (mine !== seq) return;
        note(list, 'Search is unavailable right now.');
        setCount(null);
      });
  }

  var timer = null;
  function onInput(e) {
    var q = String(e.target.value || '').trim();
    vLoad();
    clearTimeout(timer);
    // Debounced: the upstream allows 333 requests a DAY per IP, and although this goes through our
    // own cached proxy, one request per keystroke would still be pointless load for no better answer.
    timer = setTimeout(function () { run(q); }, 260);
  }

  function wire() {
    var inp = $('#spSearchInput');
    if (!inp || inp.__lxx) return;
    inp.__lxx = 1;
    inp.addEventListener('input', onInput);
    // Opening the panel is the first moment the roster is worth fetching — and the recents it paints on
    // focus are the rows that most need it, since their stored `vf` is whatever it was months ago.
    inp.addEventListener('focus', function () { vLoad(); recShowIfEmpty(); });
    recShowIfEmpty();
    // The design's placeholder still offers Stellar; this layer decides what is searchable.
    try { inp.placeholder = 'Search assets, pools and wallets'; } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  // The popup is created/opened by lx-searchctl, which may mount the input after this runs.
  var tries = 0;
  var poll = setInterval(function () {
    wire();
    if (++tries > 40 || ($('#spSearchInput') && $('#spSearchInput').__lxx)) clearInterval(poll);
  }, 250);

  window.__lxxSearchRun = run;
})();
