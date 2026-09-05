// Account page: any XRP Ledger account, by address in the URL.
//
// `lx-accdata` required a Stellar G-address, so on /xrpl/account/<r-address> it printed "No Stellar
// address in this link." and stopped. Inert rather than wrong, which is the better of the two
// failures, but the page never worked for a single real visitor.
//
// Everything here comes from the ledger directly -- account_info, account_lines, account_tx. There
// is no third party in this path and nothing to rate-limit, because an account lookup is exactly the
// thing a public node answers.
(function () {
  if (window.__lxxAccount) return;
  window.__lxxAccount = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res) throw new Error('ledger unavailable');
      return res;
    });
  }

  // /xrpl/account/<r-address>
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var last = decodeURIComponent(parts[parts.length - 1] || '');
    try { return window.lxx.isAddress(last) ? last : null; } catch (e) { return null; }
  }

  function setStat(match, value) {
    var host = $('#accStats');
    if (!host) return;
    var cells = host.children;
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || '').toLowerCase();
      if (txt.indexOf(match) < 0) continue;
      // The value node is whichever child is not the label.
      // The cell is <span class=l>label</span><b class=v>main</b><span class=s>sub</span>.
      // lastElementChild is the SUB, so writing there left the main value showing an em dash and
      // the cell read '—375.382388 XRP'. Write .v, and clear .s unless a sub is given.
      var v = cells[i].querySelector('.v') || cells[i].querySelector('.val');
      if (v) v.textContent = value;
      var sub = cells[i].querySelector('.s');
      if (sub) sub.textContent = '';
      return;
    }
  }

  function tableNote(tbl, text, cols) {
    if (!tbl) return;
    // Keep the header row; replace the body.
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

  function paintAssets(tbl, xrp, held) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);

    if (xrp) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, 'XRP'));
      tr.appendChild(el('td', 'num', fmt(xrp.balance, 6)));
      // Spendable is the number that actually matters: the reserve cannot be sent.
      tr.appendChild(el('td', 'num', fmt(xrp.spendable, 6) + ' spendable'));
      tbl.appendChild(tr);
    }

    held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < held.length; i++) {
      var t = held[i];
      var r = document.createElement('tr');
      var c0 = el('td');
      c0.appendChild(el('div', null, t.display + (t.frozen ? ' (frozen)' : '')));
      c0.appendChild(el('div', 'sub', short(t.issuer)));
      r.appendChild(c0);
      r.appendChild(el('td', 'num', fmt(t.balance, 6)));
      r.appendChild(el('td', 'num', ''));
      tbl.appendChild(r);
    }
    if (!held.length && !xrp) tableNote(tbl, 'Nothing held on this account.');
  }

  function paintPools(tbl, pools) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    if (!pools.length) { tableNote(tbl, 'No pool positions.'); return; }
    for (var i = 0; i < pools.length; i++) {
      var p = pools[i];
      var r = document.createElement('tr');
      var c0 = el('td');
      // An LP token is issued BY its AMM account, so the issuer IS the pool.
      c0.appendChild(el('div', null, 'AMM pool'));
      c0.appendChild(el('div', 'sub', short(p.issuer)));
      r.appendChild(c0);
      r.appendChild(el('td', 'num', fmt(p.balance, 6) + ' LP'));
      r.appendChild(el('td', 'num', ''));
      tbl.appendChild(r);
    }
  }

  function paintActivity(host, txs) {
    if (!host) return;
    host.innerHTML = '';
    if (!txs.length) {
      host.appendChild(el('div', 'acc-empty', 'No transactions on this account yet.'));
      return;
    }
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      var row = el('div', 'acc-act');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:9px 2px;'
        + 'border-bottom:1px solid rgba(255,255,255,.06);font-size:13.5px';
      row.appendChild(el('span', null, t.type));
      var right = el('span', 'mono', t.amount);
      right.style.cssText = 'opacity:.8';
      row.appendChild(right);
      host.appendChild(row);
    }
  }

  // A delivered amount is either a drops string (XRP) or an object (a token).
  function delivered(meta, tx) {
    var d = (meta && (meta.delivered_amount || meta.DeliveredAmount)) || (tx && tx.Amount);
    if (d == null) return '';
    if (typeof d === 'string') return fmt(Number(d) / 1e6, 6) + ' XRP';
    try {
      var name = window.lxx.decodeCurrency(d.currency).display;
      return fmt(Number(d.value), 6) + ' ' + name;
    } catch (e) { return ''; }
  }

  function load() {
    var tbl = $('#accAssetsTbl');
    if (!tbl && !$('#accStats')) return;                    // not this page

    var a = fromUrl();
    var addrEl = $('#accAddr');

    if (!a) {
      if (addrEl) addrEl.textContent = 'No account';
      tableNote($('#accAssetsTbl'), 'No XRP Ledger address in this link.');
      tableNote($('#accPoolsTbl'), 'No XRP Ledger address in this link.');
      paintActivity($('#accActs'), []);
      return;
    }

    if (addrEl) addrEl.textContent = short(a);
    var sub = $('#accSub');
    if (sub) sub.textContent = a;
    var net = $('#accNet');
    if (net) net.textContent = 'XRP Ledger';

    tableNote($('#accAssetsTbl'), 'Reading the XRP Ledger…');
    tableNote($('#accPoolsTbl'), 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      rpc('account_lines', { account: a, limit: 400, ledger_index: 'validated' })
    ]).then(function (r) {
      var acctErr = r[1] && r[1].error;
      if (acctErr === 'actNotFound') {
        tableNote($('#accAssetsTbl'), 'This account is not activated on the XRP Ledger yet.');
        tableNote($('#accPoolsTbl'), 'No pool positions.');
        paintActivity($('#accActs'), []);
        setStat('xrp balance', '0 XRP');
        return;
      }

      var v = (r[0].info && r[0].info.validated_ledger) || {};
      // Read the reserve every time; it has halved by amendment before and a stale constant would
      // overstate what this account can actually move.
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = (r[1] && r[1].account_data) || {};
      var xrp = window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve);
      var split = window.lxx.readLines((r[2] && r[2].lines) || []);

      window.__lxxAccountData = { xrp: xrp, held: split.held, pools: split.pools };

      paintAssets($('#accAssetsTbl'), xrp, split.held);
      paintPools($('#accPoolsTbl'), split.pools);

      var an = $('#accAssetsN');
      if (an) an.textContent = String(split.held.length + (xrp ? 1 : 0));
      var pn = $('#accPoolsN');
      if (pn) pn.textContent = String(split.pools.length);

      setStat('xrp balance', xrp ? fmt(xrp.balance, 6) + ' XRP' : '—');
      setStat('assets held', String(split.held.length));
      setStat('pool positions', String(split.pools.length));
      // Portfolio value needs prices for every held token; not sourced here, so it stays a dash
      // rather than showing the XRP balance dressed up as a total.
      setStat('portfolio value', '—');
    }).catch(function () {
      tableNote($('#accAssetsTbl'), 'Could not read the XRP Ledger.');
      tableNote($('#accPoolsTbl'), 'Could not read the XRP Ledger.');
    });

    // SEQUENCED, NOT PARALLEL, and retried once. Fired alongside the three balance calls it made
    // four simultaneous requests to one public node, and the node dropped one -- on a cold load the
    // activity list came back empty every time while a manual re-run always worked. An intermittent
    // failure that leaves a permanent empty state is worse than a slow one.
    function history(attempt) {
      return rpc('account_tx', { account: a, limit: 20, ledger_index_min: -1, ledger_index_max: -1 })
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
        for (var i = 0; i < rows.length && out.length < 12; i++) {
          var tx = rows[i].tx || rows[i].tx_json || {};
          var meta = rows[i].meta || {};
          if (!tx.TransactionType) continue;
          out.push({ type: tx.TransactionType, amount: delivered(meta, tx) });
        }
        paintActivity($('#accActs'), out);
        var n = $('#accActN');
        if (n) n.textContent = String(out.length);
      })
      .catch(function () { paintActivity($('#accActs'), []); });
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAccountReload = load;
})();
