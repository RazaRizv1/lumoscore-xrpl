// Account page: any XRP Ledger account, by address in the URL.
//
// `lx-accdata` required a Stellar G-address, so on /account/xrpl/<r-address> it printed "No Stellar address in this link."
// and stopped. This reads the XRP Ledger directly — account_info, account_lines, account_tx, amm_info — and writes into
// the page's own markup.
//
// STELLAR'S PUBLIC WALLET PAGE, ROW FOR ROW (RAZA 2026-09-15: "Too many issues on Public-wallet page. Compare it with Stellar
// public wallet page"). Read off lumoscore.com/account/stellar/…:
//   * the header shows the FULL address, an identicon avatar with the network's logo as a small badge (the badge used to
//     hold the words "XRP Ledger", which overflowed it), and "Active since <month> · Explorer" beneath;
//   * each stat carries its second line — "Estimated value", the native balance in dollars, "N trust lines held", "none";
//   * asset rows are `.acc-row` with a logo, the code over its issuer ("rDFX—ivmN", or "Native asset"), the balance and a
//     dollar value, and open the token's trade page;
//   * activity rows are `.activity-row`: an icon, what happened, how long ago, the amounts in and out, and an explorer link.
(function () {
  if (window.__lxxAccount) return;
  window.__lxxAccount = 1;

  var RPC = 'https://xrplcluster.com/';
  var RIPPLE_EPOCH = 946684800;
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  var EXT_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var ICONS = {
    receive: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>',
    swap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
    lp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
    settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    other: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>',
    order: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function bal(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : (v >= 1 ? 4 : 7) });
  }
  function money(v) {
    if (!(v > 0)) return '$0.00';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  // An ellipsis, as everywhere else on the site; the em dash read as a range (bug X29, 2026-11-19).
  function issShort(a) { return a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''); }
  function ago(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function curName(c) {
    if (!c || c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(c).display; } catch (e) { return String(c).slice(0, 6); }
  }
  function thumb(t) {
    return t ? ('/lxapi/xrplthumb?iss=' + encodeURIComponent(t.issuer) + '&cur=' + encodeURIComponent(t.currency) + '&w=48') : XRP_LOGO;
  }

  // Every ledger read here goes through the shared retrying transport (xrpl-core: ledgerPost), so a
  // throttle is waited out instead of reported as a dead ledger. xrplcluster meters by units, not
  // requests, and one busy page can spend the quota on its own.
  //
  // It resolves with the same parsed envelope fetch().json() did, errors included, so the handling
  // below is unchanged. The fallback keeps the old behaviour exactly if lxx has not loaded.
  function lxpost(u, o) {
    try { return window.lxx.ledgerPost(u, o); }
    catch (e) { return fetch(u, o).then(function (r) { return r.json(); }); }
  }

  function rpc(method, params) {
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (j) {
      var res = j && j.result;
      if (!res) throw new Error('ledger unavailable');
      return res;
    });
  }

  // /account/xrpl/<r-address>
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var last = decodeURIComponent(parts[parts.length - 1] || '');
    try { return window.lxx.isAddress(last) ? last : null; } catch (e) { return null; }
  }

  // The cell is <span class=l>label</span><b class=v>main</b><span class=s>sub</span>.
  function setStat(match, value, sub) {
    var host = $('#accStats');
    if (!host) return;
    var cells = host.children;
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (!l || (l.textContent || '').toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.v') || cells[i].querySelector('.val');
      if (v && value != null) v.textContent = value;
      var s = cells[i].querySelector('.s');
      if (s && sub != null) s.textContent = sub;
      return;
    }
  }

  function tableNote(tbl, text, cols) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    var tr = document.createElement('tr');
    var td = el('td', null, text);
    td.colSpan = cols || 3;
    td.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    tbl.appendChild(tr);
  }

  // ---- header ----------------------------------------------------------------------------------------
  function paintHeader(a) {
    var addrEl = $('#accAddr');
    if (addrEl) { addrEl.textContent = a; addrEl.setAttribute('title', a); }
    var av = $('#accAvatar');
    if (av && window.lxIdent) {
      try {
        var sv = String(window.lxIdent(a, 64));
        if (sv.indexOf('xmlns=') < 0) sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');   // required in a data URI
        av.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(sv) + '")';
        av.style.backgroundSize = 'cover';
      } catch (e) {}
    }
    var net = $('#accNet');
    if (net) {
      net.textContent = '';
      net.setAttribute('title', 'XRP Ledger');
      net.style.backgroundImage = 'url("' + XRP_LOGO + '")';
    }
    var sub = $('#accSub');
    if (sub) {
      sub.textContent = '';
      sub.appendChild(el('span', 'lx-accsince', ''));
      var ex = el('a', null, 'Explorer ');
      ex.href = 'https://bithomp.com/explorer/' + encodeURIComponent(a);
      ex.target = '_blank';
      ex.rel = 'noopener nofollow';
      ex.insertAdjacentHTML('beforeend', EXT_SVG);
      sub.appendChild(ex);
    }
  }

  // ---- assets ----------------------------------------------------------------------------------------
  // LOGOS, A FEW AT A TIME, WITH A PLACEHOLDER WHEN THERE IS NONE (RAZA 2026-09-16: "If there's no logo to show, then show a
  // placeholder logo like we're doing on Stellar. Also in public wallet page, some asset logos are not loading"). A wallet of
  // a hundred tokens asked for a hundred logos at once and the upstream answered most of them 429, leaving blank circles.
  var LOGO_Q = [], LOGO_RUN = 0, LOGO_OK = {};
  function placeholder(code) {
    var ch = String(code || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
    var hh = 0, s0 = String(code || '');
    for (var i = 0; i < s0.length; i++) hh = (hh * 31 + s0.charCodeAt(i)) % 360;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(' + hh + ',48%,40%)"/>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="800" fill="#fff">' + ch + '</text></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }
  // THREE LEDGER READS AT A TIME, EACH TRIED TWICE (RAZA 2026-09-16: "Still not fixed: On public wallet page, pools tab" — 19 positions
  // asked for 19 amm_info at once, the public node dropped most, and those rows stayed "AMM pool" with no figures).
  var RQ = [], RRUN = 0;
  function slowRpc(method, params) {
    return new Promise(function (resolve, reject) {
      RQ.push(function () {
        RRUN++;
        rpc(method, params).catch(function () {
          return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return rpc(method, params); });
        }).then(function (r) { RRUN--; pump(); resolve(r); }, function (e) { RRUN--; pump(); reject(e); });
      });
      pump();
    });
    function pump() { while (RRUN < 3 && RQ.length) RQ.shift()(); }
  }

  function queueLogo(node, url, code) {
    if (!node) return;
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center';
    if (LOGO_OK[url] === true) { node.style.backgroundImage = 'url("' + url + '")'; return; }
    if (LOGO_OK[url] === false) { node.style.backgroundImage = placeholder(code); return; }
    LOGO_Q.push([node, url, code]);
    pumpLogos();
  }
  function pumpLogos() {
    while (LOGO_RUN < 5 && LOGO_Q.length) {
      (function (job) {
        LOGO_RUN++;
        var im = new Image(), tries = 0;
        function done(ok) {
          LOGO_RUN--;
          LOGO_OK[job[1]] = ok;
          job[0].style.backgroundImage = ok ? 'url("' + job[1] + '")' : placeholder(job[2]);
          pumpLogos();
        }
        im.onload = function () { done(true); };
        im.onerror = function () {
          if (++tries < 2) { setTimeout(function () { im.src = job[1] + '&r=' + tries; }, 1500); return; }
          done(false);
        };
        im.src = job[1];
      })(LOGO_Q.shift());
    }
  }

  // COPY, QR AND "SEND TO THIS WALLET" (RAZA 2026-09-16: "copy icon, barcode, and send to this wallet on right is not working").
  // Stellar's own three: copy with the site's toast, the address as a QR in the design's .acc-qrpop, and the wallet page's
  // Send dialog opened with this address in it.
  function wireAccActions(a) {
    var qb = $('#accQr');
    if (qb && !qb.__lxx) {
      qb.__lxx = 1;
      var build = function () {
        if (qb.querySelector('.acc-qrpop') || !window.qrcode) return;
        var q2 = null, lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
        for (var i = 0; i < lv.length; i++) { try { var t = window.qrcode(lv[i][0], lv[i][1]); t.addData(a); t.make(); q2 = t; break; } catch (e) {} }
        if (!q2) return;
        var n = q2.getModuleCount(), pad = 2, size = n + pad * 2, sq = '';
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q2.isDark(y, x)) sq += '<rect x="' + (x + pad) + '" y="' + (y + pad) + '" width="1" height="1"></rect>';
        var pop = el('div', 'acc-qrpop');
        pop.innerHTML = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + size + '" height="' + size + '" fill="#fff"></rect><g fill="#000">' + sq + '</g></svg>';
        pop.appendChild(el('div', 'cap', short(a)));
        qb.appendChild(pop);
      };
      qb.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); build(); qb.classList.toggle('on'); });
      qb.addEventListener('mouseenter', build);
      document.addEventListener('click', function (ev) { if (!qb.contains(ev.target)) qb.classList.remove('on'); }, true);
    }
    var sb = $('#accSend');
    if (sb && !sb.__lxx) {
      sb.__lxx = 1;
      sb.setAttribute('href', '/wallet?to=' + encodeURIComponent(a));
      sb.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = '/wallet?to=' + encodeURIComponent(a);
      }, true);
    }
    var cp = $('#accCopy');
    if (cp && !cp.__lxx) {
      cp.__lxx = 1;
      cp.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { navigator.clipboard.writeText(a); } catch (x) {}
        try { if (typeof window.showToast === 'function') window.showToast('Wallet address copied'); } catch (x) {}
      }, true);
    }
  }

  function assetRow(code, issLabel, balance, logo, key, href) {
    var tr = document.createElement('tr');
    tr.className = 'acc-row';
    tr.setAttribute('data-lxkey', key);
    var c0 = el('td');
    var pair = el('span', 'acc-pair');
    var ico = el('span', 'acc-ico');
    ico.setAttribute('data-logoed', '1');
    queueLogo(ico, logo, code);
    pair.appendChild(ico);
    var txt = el('span');
    var cd = el('span', 'acc-code', code);
    cd.setAttribute('data-logoed', '1');
    txt.appendChild(cd);
    txt.appendChild(el('span', 'acc-iss', issLabel));
    pair.appendChild(txt);
    c0.appendChild(pair);
    tr.appendChild(c0);
    tr.appendChild(el('td', 'num', bal(balance)));
    tr.appendChild(el('td', 'num acc-val', ''));
    if (href) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { window.location.href = href; });
    } else {
      // NOTHING TO OPEN (RAZA 2026-09-16: "the native asset should be unclickable as its page doesnt exist. Currently its
      // redirecting to trade main page"). XRP has no issuer and so no asset page; the design's own row-click layer would
      // still route the tap, so the row is marked and the click stopped at window capture below.
      tr.setAttribute('data-lxnorow', '1');
      tr.style.cursor = 'default';
    }
    return tr;
  }

  function paintAssets(tbl, xrp, held) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    if (xrp) tbl.appendChild(assetRow('XRP', 'Native asset', xrp.balance, XRP_LOGO, 'XRP', null));
    held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < held.length; i++) {
      var t = held[i];
      tbl.appendChild(assetRow(t.display + (t.frozen ? ' (frozen)' : ''), issShort(t.issuer), t.balance, thumb(t),
        t.issuer + '-' + t.currency, '/trade/xrpl/' + encodeURIComponent(t.display + '-' + t.issuer)));
    }
    if (!held.length && !xrp) tableNote(tbl, 'Nothing held on this account.');
  }

  // The same sum as the wallet page, from the same endpoint, so the two pages cannot disagree. A missing price is skipped,
  // never counted as zero.
  // THE VALUE COLUMN, IN STAGES (RAZA 2026-09-16: "[still not working] On public wallet page, value column is not working").
  // One request asked the price service for two dozen unlisted tokens at once, each an upstream call, while the same page's
  // hundred logos were being fetched; the upstream refused and the whole column stayed empty. Now the ranked list comes first
  // (one cached call prices XRP and every well-known token), then this wallet's other holdings eight at a time, largest
  // balances first.
  function paintValues(xrp, held) {
    var total = { usd: 0, any: false, xrp: false }, seen = {};
    var slugOf = function (t) { return String(t.issuer || '') + '-' + String(t.currency || ''); };
    var setVal = function (key, v) {
      var cell = document.querySelector('#accAssetsTbl tr[data-lxkey="' + key + '"] .acc-val');
      if (cell) cell.textContent = money(v);
    };
    function apply(j) {
      if (!j || !j.ok || !(j.usd > 0)) return false;
      if (!total.xrp && xrp && xrp.balance > 0) {
        total.xrp = true; total.usd += xrp.balance * j.usd; total.any = true;
        setVal('XRP', xrp.balance * j.usd);
        setStat('xrp balance', null, money(xrp.balance * j.usd));
      }
      held.forEach(function (t) {
        var k = slugOf(t), row = j.t && j.t[k];
        if (seen[k] || !row || !(t.balance > 0)) return;
        var u = row[0] * j.usd;
        if (!isFinite(u) || u <= 0) return;
        seen[k] = 1; total.usd += t.balance * u; total.any = true;
        setVal(k, t.balance * u);
      });
      setStat('portfolio value', total.any ? money(total.usd) : '—', 'Estimated value');
      return true;
    }
    function get(q, tries) {
      return fetch('/lxapi/xrplprices' + q).then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !j.ok) throw new Error('retry'); return j; })
        .catch(function () {
          if (tries <= 0) return null;
          return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return get(q, tries - 1); });
        });
    }
    get('', 3).then(function (j) {
      if (!apply(j)) { setStat('portfolio value', '—', 'Estimated value'); return; }
      var missing = held.filter(function (t) { return t.balance > 0 && !(j.t && j.t[slugOf(t)]); }).slice(0, 48).map(slugOf);
      var groups = [];
      for (var g = 0; g < missing.length; g += 8) groups.push(missing.slice(g, g + 8));
      (function next(i) {
        if (i >= groups.length) return;
        get('?t=' + encodeURIComponent(groups[i].join(',')), 1).then(function (jj) { apply(jj); next(i + 1); });
      })(0);
    });
  }

  function paintValuesOld(xrp, held, attempt) {
    var slugs = held.map(function (h) { return String(h.issuer || '') + '-' + String(h.currency || ''); });
    var q = slugs.length ? ('?t=' + encodeURIComponent(slugs.slice(0, 24).join(','))) : '';
    fetch('/lxapi/xrplprices' + q)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !(j.usd > 0)) throw new Error('no rate');
        var usd = 0, any = false;
        var setVal = function (key, v) {
          var row = document.querySelector('#accAssetsTbl tr[data-lxkey="' + key + '"] .acc-val');
          if (row) row.textContent = money(v);
        };
        if (xrp && xrp.balance > 0) {
          usd += xrp.balance * j.usd; any = true;
          setVal('XRP', xrp.balance * j.usd);
          setStat('xrp balance', null, money(xrp.balance * j.usd));
        }
        held.forEach(function (t) {
          var k = String(t.issuer || '') + '-' + String(t.currency || '');
          var row = j.t[k];
          if (!row || !(t.balance > 0)) return;
          var u = row[0] * j.usd;
          if (!isFinite(u) || u <= 0) return;
          usd += t.balance * u; any = true;
          setVal(k, t.balance * u);
        });
        setStat('portfolio value', any ? money(usd) : '—', 'Estimated value');
      })
      .catch(function () {
        // Asked again before giving up (RAZA 2026-09-15: "On public wallet page, value column is not working"): pricing a
        // wallet's two dozen tokens can take the upstream several seconds, and one refused call blanked the column.
        if ((attempt || 0) < 2) { setTimeout(function () { paintValues(xrp, held, (attempt || 0) + 1); }, 1500); return; }
        setStat('portfolio value', '—', 'Estimated value');
      });
  }

  // ---- pools -----------------------------------------------------------------------------------------
  function paintPools(tbl, pools) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    if (!pools.length) { tableNote(tbl, 'No pool positions.'); return; }
    // The header is Stellar's four columns: Pool · Pool share · Position value · Pool TVL.
    // THE RANKED PRICE LIST, ASKED AGAIN IF REFUSED (RAZA 2026-09-16: "Still not fixed: … pools tab. The details are not showing"). All
    // nineteen rows shared one request; when it came back {ok:false} under load, every position value and TVL stayed blank.
    function getRates(tries) {
      return fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok && j.usd > 0) return j; throw new Error('retry'); })
        .catch(function () {
          if (!(tries > 0)) return null;
          return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return getRates(tries - 1); });
        });
    }
    var rates = getRates(3);
    pools.slice(0, 20).forEach(function (p) {
      var tr = assetRow('AMM pool', issShort(p.issuer), p.balance, XRP_LOGO, 'POOL-' + p.issuer, '/pools/xrpl/id/' + encodeURIComponent(p.issuer));
      tr.children[1].textContent = bal(p.balance) + ' LP';
      // STELLAR'S POOL ROW (RAZA 2026-09-15: "it should show both the asset logos of the pool just like on Stellar"): two marks
      // in .acc-icos, the pair, and its LP holder count beneath.
      var ico1 = tr.querySelector('.acc-ico');
      if (ico1 && ico1.parentNode) {
        var icos = el('span', 'acc-icos');
        ico1.parentNode.insertBefore(icos, ico1);
        icos.appendChild(ico1);
        var ico2 = el('span', 'acc-ico');
        ico2.setAttribute('data-logoed', '1');
        icos.appendChild(ico2);
      }
      var subEl = tr.querySelector('.acc-iss');
      if (subEl) { subEl.className = 'acc-dom'; subEl.textContent = ''; }
      var tvlTd = el('td', 'num', '');
      tr.appendChild(tvlTd);
      tbl.appendChild(tr);
      // An LP token is issued BY its AMM account, so the issuer IS the pool; amm_info names its two sides.
      slowRpc('amm_info', { amm_account: p.issuer }).then(function (r) {
        var amm = r && r.amm;
        if (!amm) return;
        var side = function (x) {
          return typeof x === 'string'
            ? { code: 'XRP', t: null, v: Number(x) / 1e6 }
            : { code: curName(x.currency), t: { issuer: x.issuer, currency: x.currency }, v: Number(x.value) };
        };
        var A = side(amm.amount), B2 = side(amm.amount2);
        var cd = tr.querySelector('.acc-code');
        if (cd) cd.textContent = A.code + ' / ' + B2.code;
        var icoEls = tr.querySelectorAll('.acc-ico');
        if (icoEls[0]) { LOGO_Q = LOGO_Q.filter(function (jb) { return jb[0] !== icoEls[0]; }); queueLogo(icoEls[0], thumb(A.t), A.code); }
        if (icoEls[1]) queueLogo(icoEls[1], thumb(B2.t), B2.code);
        if (amm.lp_token && amm.lp_token.currency) {
          fetch('/lxapi/xrplrichlist?iss=' + encodeURIComponent(p.issuer) + '&cur=' + encodeURIComponent(amm.lp_token.currency) + '&n=1')
            .then(function (x) { return x.json(); })
            .then(function (hd) {
              var dom = tr.querySelector('.acc-dom');
              if (dom && hd && hd.ok && hd.total != null) dom.textContent = Math.round(hd.total).toLocaleString('en-US') + (Math.round(hd.total) === 1 ? ' LP holder' : ' LP holders');
            }).catch(function () {});
        }
        var supply = Number(amm.lp_token && amm.lp_token.value);
        var share = supply > 0 ? p.balance / supply : 0;
        tr.children[1].textContent = share > 0 ? ((share * 100 < 0.01 ? '<0.01' : (share * 100).toFixed(2)) + '%') : '—';
        var slugs = [A, B2].filter(function (s) { return s.t; }).map(function (s) { return s.t.issuer + '-' + s.t.currency; });
        // ASKED AGAIN UNTIL PRICED (measured 2026-09-16: both price answers came back {ok:false} during the page's load burst, and
        // the row gave up for good). Each pass asks afresh, spaced out, until the two values are written or five passes are spent.
        var pass = 0;
        return (function priceRow() {
          var done = false;
          var rp = pass === 0 ? rates : getRates(1);
          return Promise.all([rp, slugs.length
          ? fetch('/lxapi/xrplprices?t=' + encodeURIComponent(slugs.join(',')) + (pass ? '&r=' + pass : '')).then(function (x) { return x.json(); }).catch(function () { return null; })
          : null]).then(function (res) {
          // RAZA 2026-09-16: "pools tab. The details are not showing" — a refused per-pool lookup (an {ok:false} body) was
          // taken over the ranked list that already priced XRP; either answer that is good is used.
          var j0 = res[0], j1 = res[1];
          var j = (j1 && j1.ok && j1.usd > 0) ? j1 : j0;
          if (!j || !j.ok || !(j.usd > 0)) return;
          var usdOf = function (s) {
            if (!s.t) return s.v * j.usd;
            var kk = s.t.issuer + '-' + s.t.currency;
            var row = (j1 && j1.ok && j1.t && j1.t[kk]) || (j0 && j0.ok && j0.t && j0.t[kk]);
            return row && row[0] > 0 ? s.v * row[0] * j.usd : null;
          };
          var ua = usdOf(A), ub = usdOf(B2);
          // One priced side stands for both: an AMM holds equal value on each side.
          var tvl = (ua != null && ub != null) ? ua + ub : (ua != null ? ua * 2 : (ub != null ? ub * 2 : null));
          if (tvl == null) return;
          tvlTd.textContent = money(tvl);
          tr.children[2].textContent = money(tvl * share);
          done = true;
        }).catch(function () {}).then(function () {
          if (done || ++pass > 4 || !tr.isConnected) return;
          return new Promise(function (res) { setTimeout(res, 2500 * pass + Math.random() * 1500); }).then(priceRow);
        });
        })();
      }).catch(function () {});
    });
  }

  // ---- activity --------------------------------------------------------------------------------------
  function amtTxt(a) {
    if (a == null) return '';
    if (typeof a === 'string') return bal(Number(a) / 1e6) + ' XRP';
    if (a.value == null) return '';
    return bal(Number(a.value)) + ' ' + curName(a.currency);
  }
  function describe(tx, meta, me) {
    var ty = tx.TransactionType || 'Transaction';
    var d = (meta && (meta.delivered_amount || meta.DeliveredAmount)) || tx.Amount;
    if (d === 'unavailable') d = tx.Amount;
    if (ty === 'Payment') {
      if (tx.Account === me && tx.Destination === me) {
        var cOf = function (a) { return a == null ? '' : (typeof a === 'string' ? 'XRP' : curName(a.currency)); };
        return { cls: 'swap', type: 'Swap ' + cOf(tx.SendMax || tx.Amount) + ' → ' + cOf(d), a1: d ? '+' + amtTxt(d) : '', a2: tx.SendMax ? '-' + amtTxt(tx.SendMax) : '' };
      }
      if (tx.Destination === me) return { cls: 'receive', type: 'Received', a1: d ? '+' + amtTxt(d) : '', a2: 'from ' + short(tx.Account) };
      return { cls: 'send', type: 'Sent', a1: d ? '-' + amtTxt(d) : '', a2: 'to ' + short(tx.Destination) };
    }
    if (ty === 'OfferCreate') return { cls: 'swap', type: 'Order', a1: tx.TakerPays ? '+' + amtTxt(tx.TakerPays) : '', a2: tx.TakerGets ? '-' + amtTxt(tx.TakerGets) : '' };
    if (ty === 'OfferCancel') return { cls: 'order', type: 'Order cancelled', a1: '', a2: '' };
    if (ty === 'TrustSet') return { cls: 'settings', type: 'Trust line', a1: tx.LimitAmount ? curName(tx.LimitAmount.currency) : '', a2: '' };
    if (ty === 'AMMDeposit') return { cls: 'lp', type: 'Add liquidity', a1: tx.Amount ? '-' + amtTxt(tx.Amount) : '', a2: tx.Amount2 ? '-' + amtTxt(tx.Amount2) : '' };
    if (ty === 'AMMWithdraw') return { cls: 'lp', type: 'Remove liquidity', a1: '', a2: '' };
    return { cls: 'other', type: ty.replace(/([a-z])([A-Z])/g, '$1 $2'), a1: d ? amtTxt(d) : '', a2: '' };
  }
  function paintActivity(host, rows) {
    if (!host) return;
    host.innerHTML = '';
    if (!rows.length) {
      host.appendChild(el('div', 'acc-empty', 'No transactions on this account yet.'));
      return;
    }
    rows.forEach(function (x) {
      var row = el('div', 'activity-row');
      // The inherited sheet colours .received / .sent / .swap / .order / .lp / .settings / .other — "receive" and "send"
      // matched nothing, so every icon sat bare (RAZA 2026-09-15: "Recent activity is not like stellar. Check the left side icons").
      var ic = el('div', 'activity-icon ' + (({ receive: 'received', send: 'sent' })[x.cls] || x.cls));
      ic.innerHTML = ICONS[x.cls] || ICONS.other;
      row.appendChild(ic);
      var info = el('div', 'activity-info');
      var ty = el('div', 'type', x.type);
      ty.setAttribute('data-logoed', '1');
      info.appendChild(ty);
      info.appendChild(el('div', 'meta', ago(x.t)));
      row.appendChild(info);
      var amt = el('div', 'activity-amt');
      amt.appendChild(el('div', 'a1 ' + x.cls, x.a1));
      amt.appendChild(el('div', 'a2', x.a2));
      row.appendChild(amt);
      if (/^[0-9A-F]{64}$/i.test(x.hash || '')) {
        var lk = el('a', 'lx-txlink');
        lk.href = 'https://bithomp.com/explorer/' + x.hash;
        lk.target = '_blank';
        lk.rel = 'noopener nofollow';
        lk.title = 'View on Bithomp';
        lk.innerHTML = EXT_SVG;
        row.appendChild(lk);
      }
      host.appendChild(row);
    });
  }

  // THE ASSETS / POOLS TABS (RAZA 2026-09-15: "Public wallet address page, cant open pools tab"). The panes ship with the
  // hidden attribute and nothing on this page toggled it.
  function wireAccTabs() {
    if (window.__lxxAccTabs) return;
    window.__lxxAccTabs = 1;
    // A row with nowhere to go swallows its own click before the design's resolver sees it.
    window.addEventListener('click', function (e) {
      var nr = e.target && e.target.closest && e.target.closest('[data-lxnorow]');
      if (nr) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.acc-tab[data-t]');
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var want = t.getAttribute('data-t');
      [].forEach.call(document.querySelectorAll('.acc-tab[data-t]'), function (bt) {
        bt.classList.toggle('active', bt === t);
        bt.setAttribute('aria-selected', bt === t ? 'true' : 'false');
      });
      [].forEach.call(document.querySelectorAll('.acc-pane[data-p]'), function (pn) { pn.hidden = pn.getAttribute('data-p') !== want; });
    }, true);
  }

  function load() {
    var tbl = $('#accAssetsTbl');
    if (!tbl && !$('#accStats')) return;
    wireAccTabs();                    // not this page

    var a = fromUrl();
    if (!a) {
      var addrEl = $('#accAddr');
      if (addrEl) addrEl.textContent = 'No account';
      tableNote($('#accAssetsTbl'), 'No XRP Ledger address in this link.');
      tableNote($('#accPoolsTbl'), 'No XRP Ledger address in this link.');
      paintActivity($('#accActs'), []);
      return;
    }

    paintHeader(a);
    wireAccActions(a);
    tableNote($('#accAssetsTbl'), 'Reading the XRP Ledger…');
    tableNote($('#accPoolsTbl'), 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      window.lxx.allLines(rpc, a)
    ]).then(function (r) {
      var acctErr = r[1] && r[1].error;
      if (acctErr === 'actNotFound') {
        tableNote($('#accAssetsTbl'), 'This account is not activated on the XRP Ledger yet.');
        tableNote($('#accPoolsTbl'), 'No pool positions.');
        paintActivity($('#accActs'), []);
        setStat('xrp balance', '0 XRP', '');
        return;
      }
      var v = (r[0].info && r[0].info.validated_ledger) || {};
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = (r[1] && r[1].account_data) || {};
      var xrp = window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve);
      var split = window.lxx.readLines((r[2] && r[2].lines) || []);
      // A position is LP tokens held. Lines left at zero after withdrawing (many, on an active account) are not
      // positions, and their AMMs are often deleted, so they showed as unnamed "AMM pool … 0 LP" rows.
      split.pools = split.pools.filter(function (pl) { return Number(pl.balance) > 0; });

      window.__lxxAccountData = { xrp: xrp, held: split.held, pools: split.pools };

      paintAssets($('#accAssetsTbl'), xrp, split.held);
      paintPools($('#accPoolsTbl'), split.pools);

      // One count, used twice, including XRP — the convention wallet.js uses.
      var assetsN = split.held.length + (xrp ? 1 : 0);
      var an = $('#accAssetsN');
      if (an) an.textContent = String(assetsN);
      var pn = $('#accPoolsN');
      if (pn) pn.textContent = String(split.pools.length);

      setStat('xrp balance', xrp ? bal(xrp.balance) + ' XRP' : '—', '');
      setStat('assets held', String(assetsN), split.held.length + (split.held.length === 1 ? ' trust line held' : ' trust lines held'));
      setStat('pool positions', String(split.pools.length), split.pools.length ? (split.pools.length === 1 ? '1 position' : split.pools.length + ' positions') : 'none');
      paintValues(xrp, split.held);
    }).catch(function () {
      tableNote($('#accAssetsTbl'), 'Could not read the XRP Ledger.');
      tableNote($('#accPoolsTbl'), 'Could not read the XRP Ledger.');
    });

    // SEQUENCED, NOT PARALLEL, and retried once: four simultaneous requests to one public node dropped one on a cold load.
    function history(attempt) {
      return rpc('account_tx', { account: a, limit: 50, ledger_index_min: -1, ledger_index_max: -1 })
        .catch(function (e) {
          if (attempt > 0) throw e;
          return new Promise(function (res) { setTimeout(res, 900); }).then(function () { return history(1); });
        });
    }
    setTimeout(function () {
      history(0)
        .then(function (r) {
          var out = [];
          var rows = (r && r.transactions) || [];
          for (var i = 0; i < rows.length && out.length < 50; i++) {
            var tx = rows[i].tx || rows[i].tx_json || {};
            var meta = rows[i].meta || {};
            if (!tx.TransactionType) continue;
            var x = describe(tx, meta, a);
            x.t = tx.date != null ? (tx.date + RIPPLE_EPOCH) * 1000 : null;
            x.hash = tx.hash || rows[i].hash || '';
            out.push(x);
          }
          paintActivity($('#accActs'), out);
          var n = $('#accActN');
          if (n) n.textContent = String(out.length);
        })
        .catch(function () { paintActivity($('#accActs'), []); })
        .then(function () {
          // "Active since": the account's first transaction is the payment that created it.
          return rpc('account_tx', { account: a, limit: 1, forward: true, ledger_index_min: -1, ledger_index_max: -1 });
        })
        .then(function (r) {
          var tx = r && r.transactions && r.transactions[0];
          var t = tx && (tx.tx || tx.tx_json);
          var since = $('#accSub .lx-accsince');
          if (t && t.date != null && since) {
            since.textContent = 'Active since ' + new Date((t.date + RIPPLE_EPOCH) * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          }
        })
        .catch(function () {});
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAccountReload = load;
})();
