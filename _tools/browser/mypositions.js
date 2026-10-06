// Pools -> My Positions: this account's real AMM positions.
//
// WHAT WAS THERE. The design's mock, presented as yours:
//
//   01  LUMOS / APT   Native - Utility      1,842 APT ~$772   0.054%   +12.40 APT ~$5.19   May 14, 2026
//   02  USDC / APT    Stablecoin - Circle   1,600 APT ~$670   0.059%   +8.92 APT  ~$3.74   May 09, 2026
//
// with the tab counting "2". Two invented liquidity positions, in APT, on an XRP Ledger site, with
// invented fee earnings and invented deposit dates, attributed to whoever is connected. That is the
// same class as the fabricated activity feed this project removed on day one, and worse in one
// respect: a feed is a claim about the network, this is a claim about *your money*.
//
// It survived every earlier sweep because the panel ships `display:none` and only appears when the
// tab is clicked — the known blind spot of any pass that reads the page at rest.
//
// WHERE THE REAL NUMBERS COME FROM. An LP token's ISSUER is the AMM account itself, so the account's
// own trust lines are the position list: every line whose currency is an LP token (40 hex starting
// 03) is a pool this account is in, and its balance is the LP tokens held. `amm_info` on that issuer
// returns the pool's two sides and the total LP supply, and share = held / total. Nothing here is
// derived from a price feed; the amounts are the pool's own reserves scaled by that share.
//
// TWO COLUMNS STAY EM DASHES, and that is the honest answer rather than a gap. "Fees Earned" and
// "Deposited" cannot be computed from ledger state: an AMM records no per-provider fee accrual and
// no deposit date. Recovering either means replaying this account's whole transaction history and
// valuing each entry at the time — a different feature, not a number to guess. Anything without a
// source is an em dash; that rule is why the rest of this page can be trusted.
(function () {
  if (window.__lxxMyPos) return;
  window.__lxxMyPos = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function rpc1(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); });
  }
  // One retry: a dropped request from the public node was enough to leave the list empty.
  function rpc(method, params) {
    return rpc1(method, params).catch(function () {
      return new Promise(function (res) { setTimeout(res, 800); }).then(function () { return rpc1(method, params); });
    });
  }

  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    var d = dp != null ? dp : (a >= 1000 ? 0 : a >= 1 ? 2 : 6);
    var s = Number(n).toFixed(d);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  // A side is a drops string (XRP) or { currency, issuer, value }.
  function side(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6, cur: 'XRP', iss: '' };
    var d = window.lxx.decodeCurrency(a.currency);
    return { name: (d && d.display) || a.currency, amount: Number(a.value), cur: a.currency, iss: a.issuer };
  }

  // A stable colour per ticker, matching how the wallet draws a mark it has no logo for.
  function hue(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The page's logo engine repaints any element holding 1-5 characters, and these discs hold exactly
  // one. data-logoed is its own skip marker.
  // THE POOL'S TWO LOGOS (RAZA 2026-09-16: "Where are the fucking logos for the pool"), in the Pools list's own .pa/.pb slots,
  // falling back to the lettered disc when a token has none.
  function logo(cls, sd) {
    var e = el('span', 'lxx-ic ' + cls);
    e.setAttribute('data-logoed', '1');
    e.style.cssText = 'display:inline-flex;width:32px;height:32px;flex:0 0 32px;border-radius:50%;overflow:hidden;align-items:center;justify-content:center';
    var im = document.createElement('img');
    im.alt = '';
    im.src = sd.cur === 'XRP' ? '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48'
      : ('/lxapi/xrplthumb?iss=' + encodeURIComponent(sd.iss) + '&cur=' + encodeURIComponent(sd.cur) + '&w=48');
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    im.onerror = function () {
      if (im.parentNode) im.parentNode.removeChild(im);
      e.style.background = hue(sd.name);
      e.style.color = '#fff'; e.style.fontSize = '12px'; e.style.fontWeight = '800';
      e.appendChild(document.createTextNode(String(sd.name || '?').charAt(0).toUpperCase()));
    };
    e.appendChild(im);
    return e;
  }

  function disc(cls, name) {
    var d = el('div', cls, String(name || '?').slice(0, 1).toUpperCase());
    try { d.setAttribute('data-logoed', '1'); } catch (e) {}
    d.style.background = hue(name);
    return d;
  }

  // Desktop is a table inside #panelMyPositions; the phone is a list of .pool-card anchors in
  // #panelMine. Targeting only the first left the phone showing the design's two invented positions
  // with the tab counting "2" — the same desktop-only assumption that had the whole pools layer
  // returning on its first line on mobile.
  function host() {
    var d = $('#panelMyPositions');
    var tb = d && d.querySelector('tbody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelMine');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  function tbody() {
    var h = host();
    return h && h.kind === 'table' ? h.node : null;
  }

  // The count on the My Positions tab, found by ITS OWN tab rather than by position. Taking
  // `#poolTabs .count` and indexing into it is how counts end up written into the wrong tab — that
  // exact bug is documented in browser/wallet.js.
  function setCount(n) {
    var btn = $$('#poolTabs button, #poolTabs [data-tab]').filter(function (b) {
      return /position/i.test(b.textContent || '') || b.getAttribute('data-tab') === 'mine';
    })[0];
    var c = btn && btn.querySelector('.count');
    // The tab's count badge (RAZA 2026-09-16: "Where's the fucking pool count on the tab"): created if the tab lost it.
    if (btn && !c) { c = el('span', 'count'); btn.appendChild(document.createTextNode(' ')); btn.appendChild(c); }
    if (c) { c.textContent = String(n); c.setAttribute('data-logoed', '1'); c.style.removeProperty('display'); c.style.visibility = 'visible'; }
  }

  // The panel sits behind the design's fade-in gate at opacity 0 (see connect.js); it is released whenever this writes to it.
  function reveal() {
    var pn = $('#panelMyPositions');
    if (!pn) return;
    pn.setAttribute('data-lcm-done', '1');
    pn.classList.add('lcm-on');
    pn.classList.add('lcmu-in');
    pn.style.setProperty('opacity', '1', 'important');
    pn.style.setProperty('transform', 'none', 'important');
  }

  function note(msg) {
    var h = host(); if (!h) return;
    reveal();
    h.node.innerHTML = '';
    if (h.kind === 'cards') {
      var d = el('div', null, msg);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
      return;
    }
    var tr = document.createElement('tr');
    var td = el('td', null, msg);
    td.colSpan = 7;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td); h.node.appendChild(tr);
  }

  // The phone's card for one position. Same three figures as the table, in the design's own shape.
  function posCard(i, pos) {
    var a = el('a', 'pool-card my-pos');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(pos.account);

    var head = el('div', 'pc-head');
    var icons = el('div', 'pair-icons');
    icons.appendChild(disc('a', pos.a.name));
    icons.appendChild(disc('b', pos.b.name));
    head.appendChild(icons);
    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', pos.a.name + ' / ' + pos.b.name));
    // The design's line here is a deposit date, which the ledger does not record for a position.
    info.appendChild(el('div', 'pc-sub', 'AMM ' + pos.account.slice(0, 5) + '…' + pos.account.slice(-4)));
    head.appendChild(info);
    a.appendChild(head);

    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    stats.appendChild(stat('Your liquidity', fmt(pos.a.amount * pos.share) + ' ' + pos.a.name,
      fmt(pos.b.amount * pos.share) + ' ' + pos.b.name));
    stats.appendChild(stat('Pool share', (pos.share * 100).toFixed(pos.share * 100 < 0.01 ? 4 : 3) + '%'));
    stats.appendChild(stat('Fees earned', '—', 'not on ledger'));
    a.appendChild(stats);

    var foot = el('div', 'pc-pos-row');
    var l = el('span', null, 'Tap to manage position');
    l.style.cssText = 'font-size:11.5px;color:var(--text-soft);font-weight:600';
    foot.appendChild(l);
    foot.appendChild(el('span', 'view-arrow', 'VIEW →'));
    a.appendChild(foot);
    return a;
  }

  function row(i, pos) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxmypool', pos.account);
    tr.style.cursor = 'pointer';

    tr.appendChild(el('td', 'idx', (i + 1 < 10 ? '0' : '') + (i + 1)));

    var pc = el('td');
    var cell = el('div', 'pair-cell');
    var icons = el('div', 'pair-icons');
    icons.appendChild(logo('pa', pos.a));
    icons.appendChild(logo('pb', pos.b));
    cell.appendChild(icons);
    var meta = el('div');
    meta.appendChild(el('div', 'pair-name', pos.a.name + ' / ' + pos.b.name));
    // The design's second line is a category ("Native - Utility"). There is no such classification
    // on this ledger, so it names the AMM account instead, which is a fact.
    meta.appendChild(el('div', 'pair-sub', 'AMM ' + pos.account.slice(0, 5) + '…' + pos.account.slice(-4)));
    cell.appendChild(meta);
    pc.appendChild(cell);
    tr.appendChild(pc);

    // Your liquidity: the pool's own reserves scaled by this account's share. Both sides, because a
    // position is two assets and naming one of them would be half the answer.
    var liq = el('td');
    liq.appendChild(el('div', 'num', fmt(pos.a.amount * pos.share) + ' ' + pos.a.name));
    liq.appendChild(el('div', 'num-sub', fmt(pos.b.amount * pos.share) + ' ' + pos.b.name));
    tr.appendChild(liq);

    var sh = el('td');
    sh.appendChild(el('div', 'num', (pos.share * 100).toFixed(pos.share * 100 < 0.01 ? 4 : 3) + '%'));
    tr.appendChild(sh);

    // STELLAR'S ROW (RAZA 2026-09-16, "here's how the row looks like on Stellar"): Pair · Your liquidity · Pool share · "View position →".
    // Stellar drops Fees Earned and Deposited — neither is kept by its ledger or this one.
    var act = el('td', 'participants-cell');
    var a = document.createElement('a');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(pos.account);
    a.className = 'lx-ammview';
    a.textContent = 'View position →';
    act.appendChild(a);
    tr.appendChild(act);

    return tr;
  }

  // AND THE COLUMNS ARE SIZED, NOT LEFT TO THE CONTENT ("Align it exactly like stellar").
  //
  // Removing the Actions header alone did not do it: measured at a 1540px viewport, this table put Your
  // Liquidity at 35.5% and Pool Share at 64.5%, against lumoscore.com's ~24% and ~38.5%. Nothing was
  // holding the first columns narrow, so the slack spread through them instead of collecting in the
  // unlabelled track on the right.
  //
  // Stellar pins them, and these are its own numbers, read off the live page's stylesheet:
  //
  //     th/td:nth-child(2) { white-space:nowrap; width:1px }   Pair, shrink-to-fit
  //     th/td:nth-child(3) { width:200px }                     Your Liquidity
  //     td:nth-child(4)    { width:130px }                     Pool Share
  //
  // THE FORK HAS NONE OF THEM, and the reason is worth recording: half of Stellar's rules are scoped
  // to `#lx-mypanel`, and this build's panel is `#panelMyPositions` — so even where the sheet came
  // across, the selector could never match. Scoped here to this build's id, which also keeps it off the
  // All Pools table that shares `table.pools`.
  function colWidths() {
    if (document.getElementById('lx-mypos-cols')) return;
    var st = document.createElement('style');
    st.id = 'lx-mypos-cols';
    st.textContent = '#panelMyPositions table.pools th:nth-child(2),#panelMyPositions table.pools td:nth-child(2)'
      + '{white-space:nowrap;width:1px}'
      + '#panelMyPositions table.pools th:nth-child(3),#panelMyPositions table.pools td:nth-child(3){width:200px}'
      + '#panelMyPositions table.pools th:nth-child(4),#panelMyPositions table.pools td:nth-child(4){width:130px}';
    (document.head || document.documentElement).appendChild(st);
  }

  function load() {
    if (!host()) return;                                 // not a page with a positions list
    var me = addr();
    // THE WALLET RESTORES A MOMENT AFTER THE PAGE DOES (RAZA 2026-09-16: "When i open My pool from pools main page and then open
    // any pool page, then i go back, then it stops showing the count of my pools. I have 2 pools otherwise"). Coming back from
    // a pool, this ran before the address was readable and wrote a zero that nothing revisited. It now waits ~5s for a wallet
    // before saying there is none.
    if (!me) {
      if ((load.waits = (load.waits || 0) + 1) < 12) { setTimeout(load, 400); return; }
      note('Connect a wallet to see your liquidity positions.');
      setCount(0);
      return;
    }
    load.waits = 0;

    note('Reading your positions…');

    // allLines() pages account_lines through the rpc it is given and reads r.lines — it expects the ledger's
    // \`result\`. This file's rpc resolves the whole JSON-RPC envelope, so every page read as empty and My Pools
    // said "No liquidity positions" for an account holding three. Unwrapped here rather than changing rpc, which
    // the amm_info calls below read as the envelope.
    window.lxx.allLines(function (m, q) { return rpc(m, q).then(function (j) { return (j && j.result) || j; }); }, me)
      .then(function (r) {
        // allLines() returns { lines } — the shape wallet.js reads. Reading r.result.lines found nothing on every
        // account, which is why My Pools said "No liquidity positions" beside a wallet listing three
        // (RAZA 2026-09-15: "I do have a pool. Its showing up on Wallet page but not on Pools main page").
        var lines = (r && (r.lines || (r.result && r.result.lines))) || [];
        var lp = lines.filter(function (l) {
          return window.lxx.isLpToken(l.currency) && Number(l.balance) > 0;
        });
        if (!lp.length) { note('No liquidity positions on this account.'); setCount(0); return; }

        // One amm_info per pool. An account is in a handful of pools, not hundreds, so these run
        // together rather than through a queue.
        return Promise.all(lp.map(function (l) {
          return rpc('amm_info', { amm_account: l.account })
            .then(function (res) {
              var amm = res && res.result && res.result.amm;
              if (!amm) return null;
              var total = Number(amm.lp_token && amm.lp_token.value);
              var held = Number(l.balance);
              if (!isFinite(total) || total <= 0) return null;
              var a = side(amm.amount), b = side(amm.amount2);
              if (!a || !b) return null;
              return { account: l.account, a: a, b: b, held: held, share: held / total };
            })
            .catch(function () { return null; });
        })).then(function (all) {
          var pos = all.filter(Boolean).sort(function (x, y) { return y.share - x.share; });
          if (!pos.length) { note('No liquidity positions on this account.'); setCount(0); return; }
          var h = host(); if (!h) return;
          h.node.innerHTML = '';
          var make = h.kind === 'table' ? row : posCard;
          if (h.kind === 'table') {
            var tbl = h.node.closest && h.node.closest('table');
            // AND "ACTIONS" GOES WITH THEM (RAZA 2026-10-06: "the header bar that says Pair, Your
            // liquidity, Pool share, & actions should exactly be like it's on Stellar. Align it exactly
            // like stellar and remove Action from the right").
            //
            // lumoscore.com's header is four cells — # / Pair / Your Liquidity / Pool Share — over rows
            // that still carry five, the fifth being the unlabelled "View position →". That is also what
            // pulls the columns left: with no header claiming the right-hand track, the three labelled
            // ones sit where the content puts them instead of being spread to the table's full width.
            // So removing the cell is both halves of the request, not just the word.
            if (tbl) [].forEach.call(tbl.querySelectorAll('thead th'), function (th) {
              if (/fees earned|deposited|actions/i.test(th.textContent || '') && th.parentNode) th.parentNode.removeChild(th);
            });
            colWidths();
          }
          for (var i = 0; i < pos.length; i++) h.node.appendChild(make(i, pos[i]));
          reveal();
          setCount(pos.length);
        });
      })
      .catch(function () {
        // actNotFound means the account has never been funded — not an error worth shouting about.
        note('Could not read your positions from the XRP Ledger.');
        setCount(0);
      });
  }

  // RAZA 2026-09-15, again: "[Still not showing] I do have a pool". The list was written once at page load; the design's tab
  // switch and a wallet that connects after load both left it holding nothing. It is re-read whenever My Pools is opened
  // without our rows in it, and when the wallet changes.
  // A position row opens its pool (RAZA 2026-09-16: "WHen clicking on my pool, it redirects to All pools tab"): the design's row
  // handler switched tabs; this is taken first.
  window.addEventListener('click', function (e) {
    var tr = e.target && e.target.closest && e.target.closest('#panelMyPositions tr[data-lxmypool], #panelMine [data-lxmypool]');
    if (!tr || (e.target.closest && e.target.closest('a[href]') && !e.target.closest('a.lx-ammview'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-lxmypool'));
  }, true);
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#poolTabs [data-tab="mine"], [data-tab="mine"]');
    if (!t) return;
    setTimeout(function () {
      reveal();
      var h = host();
      if (!h || !h.node.querySelector('a[href*="/pools/xrpl/id/"]')) load();
    }, 60);
  }, true);
  try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { setTimeout(load, 300); }); } catch (e) {}
  window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') load(); });

  // Back from a pool page the browser can restore this one from its cache, when no script runs again at all.
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) { load.waits = 0; load(); } });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxMyPosReload = load;
})();
