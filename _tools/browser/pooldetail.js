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
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 2 : dp });
    return v.toPrecision(4);
  }

  function short(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

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

  // /xrpl/pools/id/<ammAccount>  — the route the Pools table links to.
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
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6, issuer: null };
    var name = a.currency;
    try { name = window.lxx.decodeCurrency(a.currency).display; } catch (e) {}
    return { name: name, amount: Number(a.value), issuer: a.issuer };
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

  function paint(acct, amm) {
    var a = side(amm.amount), b = side(amm.amount2);
    if (!a || !b) return;

    // Quote the token against XRP where there is an XRP side, which is how the rest of the site
    // denominates a pair.
    var xrpSide = a.name === 'XRP' ? a : (b.name === 'XRP' ? b : null);
    var tok = a.name === 'XRP' ? b : a;

    var name = $('.ph-name');
    if (name) name.textContent = a.name + ' / ' + b.name;

    // The mock carried a 64-hex "Pool ID". On this ledger a pool IS an account, so show the account
    // and let the copy button carry the full one.
    var idSpan = $('.ph-id span');
    if (idSpan) idSpan.textContent = 'AMM account: ' + short(acct);
    var copyBtn = $('.ph-id button[data-copy]');
    if (copyBtn) {
      copyBtn.setAttribute('data-copy', acct);
      copyBtn.setAttribute('data-copy-label', 'AMM account');
    }

    var price = xrpSide && tok && tok.amount ? (xrpSide.amount / tok.amount) : null;
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = price != null ? (num(price, 6) + ' XRP') : '—';
    var feePct = amm.trading_fee != null ? (amm.trading_fee / 1000) : null;
    var ps = $('.ph-price .s');
    // The trading fee is a RATE, so it rides with the price rather than in a cell labelled
    // 'Fees Collected (24h)' -- which is an amount. Putting 0.625% there read as 0.625 XRP earned.
    if (ps) ps.textContent = (price != null ? ('per ' + tok.name) : '')
      + (feePct != null ? ((price != null ? '  ·  ' : '') + feePct + '% trading fee') : '');

    // Liquidity is stated as BOTH reserves. A single number here would be a choice of denominator,
    // and the mock's "~$1.43M" was exactly that kind of invented total.
    setStat('liquidity', num(a.amount, 2) + ' ' + a.name,
      '+ ' + num(b.amount, 2) + ' ' + b.name);

    var lp = amm.lp_token ? Number(amm.lp_token.value) : null;
    // Both of these are 24h AMOUNTS the ledger does not keep. Saying so beats filling them with a
    // rate or a supply figure that happens to be nearby.
    setStat('volume', '—', 'not kept by the ledger');
    setStat('fees collected', '—', 'not kept by the ledger');
    setStat('participant', '—', lp != null ? (num(lp, 2) + ' LP tokens outstanding') : '');

    window.__lxxPool = { account: acct, a: a, b: b, fee: feePct, lpSupply: lp };
  }

  // The participant list was 25 invented rows. Who holds an LP token is not something a public node
  // will enumerate, so the honest answer is the count and a note -- not 25 plausible addresses.
  function participants(text) {
    ['#partList', '#participantsList'].forEach(function (sel) {
      var host = $(sel);
      if (!host) return;
      host.innerHTML = '';
      var d = el('div', 'acc-empty', text);
      d.style.cssText = 'padding:20px 8px;text-align:center;opacity:.7;font-size:13.5px';
      host.appendChild(d);
    });
  }

  function fail(msg) {
    var name = $('.ph-name');
    if (name) name.textContent = 'Pool not found';
    var pv = $('.ph-price .v');
    if (pv) pv.textContent = '—';
    var ps = $('.ph-price .s');
    if (ps) ps.textContent = msg;
    setStat('liquidity', '—', '');
    setStat('volume', '—', '');
    setStat('fees collected', '—', '');
    setStat('participant', '—', '');
    participants(msg);
  }

  function load() {
    if (!$('.pool-header')) return;                      // not this page

    var acct = fromUrl();
    if (!acct) { fail('No pool in this address.'); return; }

    var name = $('.ph-name');
    if (name) name.textContent = 'Reading the XRP Ledger…';

    rpc('amm_info', { amm_account: acct }).then(function (r) {
      if (!r || !r.amm) { fail('That account is not an AMM.'); return; }
      paint(acct, r.amm);
      var holders = r.amm.lp_token ? '' : '';
      participants('LP holders are not enumerable from a public node. '
        + 'The pool holds ' + (r.amm.lp_token ? num(Number(r.amm.lp_token.value), 2) : '—')
        + ' LP tokens in total.');
    }).catch(function (e) {
      fail((e && e.message) === 'no pool' ? 'That account is not an AMM.' : 'Could not read the pool.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolDetailReload = load;
})();
