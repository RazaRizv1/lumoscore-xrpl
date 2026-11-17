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

  // ---- Cross-chain -------------------------------------------------------------------------------
  // THIS CARD HAS BEEN WRONG THREE TIMES, each time by naming a bridge from the outside rather than
  // asking the page it links to. It arrived from Stellar as "10 networks · USDC · via Circle CCTP";
  // it became "14 · — · Axelar"; then "59 networks · XRP · via Axelar · Wanchain", beside a bridge
  // page offering 39 through NEAR Intents, Axelar and THORChain -- and Wanchain was never built at
  // all, only investigated and dropped.
  //
  // The lesson each time was the same and is now built in rather than written down: the card asks
  // THE SAME THREE REGISTRIES THE BRIDGE ASKS, and the chain names it needs to dedupe them are
  // stamped in from browser/nibridge.js at build time. There is no list here to go stale.
  // EACH CARD OPENS ITS OWN PAGE (RAZA 2026-09-16: "when im tapping on Cross-chain Explore bridge, it takes me to pools main page").
  // The cards are anchors with the right href, but an inherited row-click layer answered first and sent the tap elsewhere
  // (measured: /trade/xrpl from the bridge card). Taken at window capture, so the card's own href is the one followed.
  if (!window.__lxxDbxNav) {
    window.__lxxDbxNav = 1;
    window.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.lx-dbx-card[href]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }
  // THREE ROUTES, AND THE COUNT THE BRIDGE PAGE ACTUALLY OFFERS.
  //
  // This card read "59 networks · XRP · via Axelar · Wanchain" while the bridge page offered 39
  // through NEAR Intents, Axelar and THORChain. Both halves were wrong, and for the same reason the
  // bridge page's own copy was: WANCHAIN WAS NEVER BUILT -- investigated, then dropped -- and the
  // count came from /lxapi/xrplbridge, the endpoint belonging to the route-DISCOVERY layer the real
  // bridge replaced. It counted Axelar's registry plus one for Wanchain.
  //
  // THE CHAIN NAMES ARE STAMPED IN FROM browser/nibridge.js AT BUILD TIME (__LX_BRIDGE_PLACES__), not
  // copied. A second hand-maintained list is exactly how this card came to disagree with the page it
  // links to, and a comment asking the next person to remember would not have helped. The registries
  // are still asked live -- a chain the routes drop should vanish from the count without a build --
  // and the names only decide which answers are the SAME PLACE.
  set('cvia', 'NEAR Intents · Axelar · THORChain');
  set('casset', 'XRP');
  (function () {
    var NAMES = __LX_BRIDGE_PLACES__;          // {ni:{id:label}, ax:{id:label}, th:{id:label}}
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var seen = {};
    var add = function (label) { var k = norm(label); if (k && k !== 'xrpledger' && k !== 'xrp') seen[k] = 1; };
    Promise.all([
      j('/lxapi/xrploneclick?op=tokens').catch(function () { return null; }),
      j('/lxapi/xrplaxelar?op=assets').catch(function () { return null; }),
      j('/lxapi/thorchain?op=pools').catch(function () { return null; }),
    ]).then(function (r) {
      var ni = r[0], ax = r[1], th = r[2];
      if (ni && ni.ok && ni.tokens) ni.tokens.forEach(function (t) { if (NAMES.ni[t.blockchain]) add(NAMES.ni[t.blockchain]); });
      if (ax && ax.ok && ax.destinations) ax.destinations.forEach(function (c) { add(NAMES.ax[c] || c); });
      if (th && th.ok && th.pools && th.xrpTradeable) {
        th.pools.forEach(function (p) { if (p.symbol.indexOf('-') < 0 && NAMES.th[p.chain]) add(NAMES.th[p.chain]); });
      }
      var n = Object.keys(seen).length;
      // A COUNT OF ZERO IS NOT A COUNT. All three registries down is the only way to get here, and an
      // em dash says "unknown" where a bold 0 would say "this bridge reaches nowhere".
      set('cnet', n > 0 ? num(n) : '—');
    }).catch(function () { set('cnet', '—'); });
  })();

  // ---- Pools + Trade -----------------------------------------------------------------------------
  // FIFTEEN-MINUTE FIGURES (RAZA 2026-09-16: "load the details for pools every 15 mins so that for the user it doesn't load in
  // real time"). The last figures are kept in this browser and shown at once; they are asked for again only once they are
  // fifteen minutes old.
  //
  // THE TRADE CARD NOW KEEPS THE SAME FIFTEEN MINUTES (RAZA 2026-11-17, phone screenshot of both cards
  // still grey: "why it's taking so long for these seconds to load"). Only Pools had the rule; Trade
  // asked live on EVERY visit. And the Pools card waited for its two requests ONE AFTER THE OTHER
  // (xrplpools, then xrpltokens for the rate) while Trade asked xrpltokens a second time on its own.
  // Measured on lumoscore.com: xrpltokens is ~0.1s warm, 0.5-0.7s when its 2-minute edge cache is
  // cold, and ~1.6s per request -- uncached -- while xrpl.to answers 429; on a busy phone page the same
  // call took 1.1s. So: both endpoints are asked AT ONCE, xrpltokens ONCE, and each card shows its last
  // figures immediately and does not ask again inside fifteen minutes. Inside the window nothing is
  // re-fetched, so a figure never visibly swaps to a newer one (the guardrails' flash rule); a card is
  // only cached when ALL of its figures arrived, so an unknown is never restored as an answer.
  function cached(k) {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
    return (c && c.v) ? c : null;
  }
  function fresh(c) { return !!(c && Date.now() - c.t < 15 * 60000); }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {} }

  var PK = 'lumos.dash.pools', pc = cached(PK);
  var TK = 'lumos.dash.trade', tc = cached(TK);
  if (pc) { set('ppool', pc.v.ppool); set('ptvl', pc.v.ptvl); set('pvol', pc.v.pvol); }
  if (tc) { set('tvol', tc.v.tvol); set('tliq', tc.v.tliq); set('tmkt', tc.v.tmkt); }
  var needPools = !fresh(pc), needTrade = !fresh(tc);

  if (needPools || needTrade) {
    // One request each, both in flight together. The tokens answer carries the XRP->USD rate that
    // the pool figures (in XRP) also need, so both cards are served from it.
    var tokens = j('/lxapi/xrpltokens').catch(function () { return null; });
    var pools = needPools ? j('/lxapi/xrplpools').catch(function () { return null; }) : null;

    if (needTrade) {
      tokens.then(function (t) {
        if (!t || t.ok !== true) return;
        var st = t.stats || {}, r = rate(t), tv = {};
        // MARKETS is the count of tokens actually traded in the last 24h, not the 20k that merely exist.
        // A card headed "Markets" beside a 24h volume should be counting live ones.
        if (st.tradedTokens24 != null) { tv.tmkt = num(st.tradedTokens24); set('tmkt', tv.tmkt); }
        if (!r) return;
        if (st.dexVol24 > 0) { tv.tvol = usd(st.dexVol24 * r); set('tvol', tv.tvol); }
        if (st.tvl > 0) { tv.tliq = usd(st.tvl * r); set('tliq', tv.tliq); }
        if (tv.tmkt && tv.tvol && tv.tliq) keep(TK, tv);
      });
    }

    if (needPools) {
      var pv = {};
      // The count needs nothing else, so it is painted the moment the pools answer lands.
      pools.then(function (p) {
        if (p && p.ok === true && p.total != null) { pv.ppool = num(p.total); set('ppool', pv.ppool); }
      });
      Promise.all([pools, tokens]).then(function (x) {
        var p = x[0], r = rate(x[1]);
        if (!p || p.ok !== true || !r) return;
        // The pool figures are in XRP and need the rate, which lives on the tokens endpoint.
        var s = p.summary || {};
        if (s.liquidity > 0) { pv.ptvl = usd(s.liquidity * r); set('ptvl', pv.ptvl); }
        if (s.vol24 > 0) { pv.pvol = usd(s.vol24 * r); set('pvol', pv.pvol); }
        if (pv.ppool && pv.ptvl && pv.pvol) keep(PK, pv);
      });
    }
  }

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

  function firstSeen(addr) {
    return lxpost(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'account_tx',
        params: [{ account: addr, limit: 1, forward: true, ledger_index_min: -1, ledger_index_max: -1 }]
      })
    }).then(function (d) {
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
