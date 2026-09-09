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

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); });
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
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
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6 };
    var d = window.lxx.decodeCurrency(a.currency);
    return { name: (d && d.display) || a.currency, amount: Number(a.value) };
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
    if (c) c.textContent = String(n);
  }

  function note(msg) {
    var h = host(); if (!h) return;
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
    a.href = '/xrpl/pools/id/' + encodeURIComponent(pos.account);

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

    tr.appendChild(el('td', 'idx', (i + 1 < 10 ? '0' : '') + (i + 1)));

    var pc = el('td');
    var cell = el('div', 'pair-cell');
    var icons = el('div', 'pair-icons');
    icons.appendChild(disc('pa', pos.a.name));
    icons.appendChild(disc('pb', pos.b.name));
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

    // Not on the ledger — see the note at the top of this file.
    var fees = el('td');
    fees.appendChild(el('div', 'num', '—'));
    fees.appendChild(el('div', 'num-sub', 'not on ledger'));
    tr.appendChild(fees);

    var dep = el('td');
    dep.appendChild(el('div', 'num', '—'));
    tr.appendChild(dep);

    var act = el('td', 'participants-cell');
    var a = document.createElement('a');
    a.href = '/xrpl/pools/id/' + encodeURIComponent(pos.account);
    a.textContent = 'VIEW POSITION →';
    a.style.cssText = 'color:var(--accent);font-size:14px;font-weight:700;letter-spacing:0.3px;text-decoration:none';
    act.appendChild(a);
    tr.appendChild(act);

    return tr;
  }

  function load() {
    if (!host()) return;                                 // not a page with a positions list
    var me = addr();
    if (!me) { note('Connect a wallet to see your liquidity positions.'); setCount(0); return; }

    note('Reading your positions…');

    rpc('account_lines', { account: me, limit: 400, ledger_index: 'validated' })
      .then(function (r) {
        var lines = (r.result && r.result.lines) || [];
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
          for (var i = 0; i < pos.length; i++) h.node.appendChild(make(i, pos[i]));
          setCount(pos.length);
        });
      })
      .catch(function () {
        // actNotFound means the account has never been funded — not an error worth shouting about.
        note('Could not read your positions from the XRP Ledger.');
        setCount(0);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxMyPosReload = load;
})();
