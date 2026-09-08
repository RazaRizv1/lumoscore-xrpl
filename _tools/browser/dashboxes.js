// The dashboard's four product cards, filled with real XRP Ledger figures.
//
// The CARDS THEMSELVES ARE NOT DRAWN HERE. They are build-time markup with twelve data-k slots, put
// there by the Stellar _dashboxes transform and inherited with the containers. This only fills them,
// which is the whole job: the design is the design.
//
// The Stellar filler that shipped alongside that markup asked /lxapi/poolstats, /lxapi/pools,
// /lxapi/dexassets and /lxapi/assetsearch — none of which this project serves — so all eight fetched
// slots rendered as an em dash. That script is stripped by _xrpldashboxes and this replaces it, so
// there is exactly ONE writer per slot and no race between a 404 handler and a real answer.
//
// EVERY NUMBER IS THE LEDGER'S, converted once. The two bulk endpoints already carry network-wide
// aggregates, so this needs two requests, not a request per asset:
//   /lxapi/xrplpools  -> total (pool count), summary.liquidity, summary.vol24     [XRP]
//   /lxapi/xrpltokens -> usd (XRP->USD), stats.dexVol24, stats.tvl, stats.tradedTokens24
// Amounts arrive in XRP and are multiplied by `usd` ONCE. Getting that the wrong way round does not
// throw, it produces a plausible wrong number — the 52x class of bug this codebase has shipped
// before — so a figure is only written when the rate is a positive finite number.
(function () {
  'use strict';

  var RPC = 'https://xrplcluster.com/';
  // The launchpad's own record of what it has minted. CORS-open, and served from the product domain
  // rather than this preview host, which is also where the toml a wallet would check lives.
  var TOML = 'https://lumoscore.com/.well-known/xrp-ledger.toml';
  var RIPPLE_EPOCH = 946684800;          // XRPL `date` is seconds since 2000-01-01, not 1970
  var MAX_ISSUERS = 24;                  // one ledger call each; the list is 6 today

  function slot(k) { return document.querySelector('[data-k="' + k + '"]'); }
  function set(k, v) {
    var el = slot(k);
    if (!el || v == null || v === '') return;
    el.textContent = v;
    el.classList.remove('wait');
  }
  function num(n) { return Math.round(+n || 0).toLocaleString('en-US'); }
  function usd(x) {
    x = +x || 0;
    var a = Math.abs(x);
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + x.toFixed(2);
  }
  function j(u) {
    return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function rate(d) { var r = d && +d.usd; return (isFinite(r) && r > 0) ? r : 0; }

  // ---- Cross-chain: design constants, identical to the Stellar build ------------------------------
  // The bridge is the same Circle CCTP bridge with the same destination set, so these are not figures
  // to look up. Written here only because this file is now the single writer for every slot.
  set('cnet', '10');
  set('casset', 'USDC');
  set('cvia', 'Circle CCTP');

  // ---- Pools + Trade -----------------------------------------------------------------------------
  j('/lxapi/xrplpools').then(function (p) {
    if (!p || p.ok !== true) return;
    if (p.total != null) set('ppool', num(p.total));
    var s = p.summary || {};
    // The pool figures are in XRP and need the rate, which lives on the tokens endpoint.
    return j('/lxapi/xrpltokens').then(function (t) {
      var r = rate(t);
      if (!r) return;
      if (s.liquidity > 0) set('ptvl', usd(s.liquidity * r));
      if (s.vol24 > 0) set('pvol', usd(s.vol24 * r));
    });
  }).catch(function () {});

  j('/lxapi/xrpltokens').then(function (t) {
    if (!t || t.ok !== true) return;
    var st = t.stats || {}, r = rate(t);
    // MARKETS is the count of tokens actually traded in the last 24h, not the 20k that merely exist.
    // A card headed "Markets" beside a 24h volume should be counting live ones.
    if (st.tradedTokens24 != null) set('tmkt', num(st.tradedTokens24));
    if (!r) return;
    if (st.dexVol24 > 0) set('tvol', usd(st.dexVol24 * r));
    if (st.tvl > 0) set('tliq', usd(st.tvl * r));
  }).catch(function () {});

  // ---- Launchpad ---------------------------------------------------------------------------------
  // The toml is the launchpad's own declaration of what it minted, so it answers "how many" exactly.
  // It carries NO per-token date, though, so "newest" and "24h" are read from the ledger instead:
  // each issuer's FIRST transaction is the payment that created the account, and that is the mint.
  // Reading the order of the toml would be a guess about how the file is appended; this is a fact.
  function parseToml(text) {
    var out = [], cur = null;
    text.split(/\r?\n/).forEach(function (line) {
      var l = line.trim();
      if (l === '[[TOKENS]]') { cur = {}; out.push(cur); return; }
      if (l.charAt(0) === '[') { cur = null; return; }
      if (!cur) return;
      var m = l.match(/^(currency|issuer)\s*=\s*"([^"]*)"/);
      if (m) cur[m[1]] = m[2];
    });
    return out.filter(function (t) { return t.currency && t.issuer; });
  }

  function firstSeen(addr) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'account_tx',
        params: [{ account: addr, limit: 1, forward: true, ledger_index_min: -1, ledger_index_max: -1 }]
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var tx = ((d.result || {}).transactions || [])[0] || {};
      var t = tx.tx || tx.tx_json || {};
      var date = t.date;
      return (typeof date === 'number') ? (date + RIPPLE_EPOCH) * 1000 : null;
    }).catch(function () { return null; });
  }

  fetch(TOML).then(function (r) { return r.text(); }).then(function (text) {
    var toks = parseToml(text);
    if (!toks.length) return;
    set('ltok', num(toks.length));

    var pick = toks.slice(0, MAX_ISSUERS);
    return Promise.all(pick.map(function (t) {
      return firstSeen(t.issuer).then(function (ms) { return { code: t.currency, ms: ms }; });
    })).then(function (rows) {
      var dated = rows.filter(function (x) { return x.ms; });
      if (!dated.length) return;
      dated.sort(function (a, b) { return b.ms - a.ms; });
      set('lnew', dated[0].code);
      var cut = Date.now() - 24 * 3600 * 1000;
      set('lmint', num(dated.filter(function (x) { return x.ms >= cut; }).length));
    });
  }).catch(function () {});
})();
