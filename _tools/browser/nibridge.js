// Bridge page: NEAR Intents (1Click) out of the XRP Ledger — destinations, quotes and the send.
//
// Replaces the Axelar route-discovery layer that shipped here. That layer listed the chains Axelar
// reaches from XRPL and said plainly that transfers were not wired, which was honest and also the
// whole of what it did. Axelar is coming back as a SECOND route (it turns out to need no Squid and no
// integrator id — an outbound ITS transfer is a Payment to the gateway with four memos) but NEAR
// Intents is first because it is the one with the reach: 35 destination chains against Axelar's
// handful, and it delivers NATIVE gas rather than a wrapped asset.
//
// WHY THIS IS SIMPLER THAN THE STELLAR BUILD'S EQUIVALENT. 1Click deposits from Stellar share one
// account and are told apart by MEMO; from the XRP Ledger each quote gets its OWN r-address and no
// memo at all (depositMode SIMPLE, measured 2026-09-28). So a transfer is one ordinary Payment with
// nothing a user can leave out. There is no memo to forget and therefore no way to lose funds by
// forgetting it — which on Stellar is the single most dangerous field on the page.
//
// THE FEE IS THE SECOND TRANSACTION, NOT THE FIRST, and that is deliberate. Stellar takes both in one
// transaction because Stellar transactions carry several operations; an XRPL transaction carries one,
// so this is necessarily two signatures and their ORDER is a decision about who absorbs a failure.
// Deposit first means the only thing that can fail after the user's money has moved is LumosCore
// collecting its fee, which is our cost. Fee first would mean charging for a transfer that then did
// not happen. Same reasoning as the swap in browser/write.js.
//
// NOTHING HERE FABRICATES A NUMBER. Every figure on the page comes from a live 1Click quote; when a
// quote cannot be had the fields read "—" and the button says why. The one number this file computes
// itself is the LumosCore fee, from window.__lxFeeRate.
(function () {
  if (window.__lxxNiBridge) return;
  window.__lxxNiBridge = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  var API = '/lxapi/oneclick';
  var API_AX = '/lxapi/axelar';
  var API_TH = '/lxapi/thorchain';
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';
  // THE SHIPPED FILE, NOT THE THUMBNAIL PROXY. This was
  // '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48', which fetches through xrpl.to -- and
  // xrpl.to allows 333 requests per day per IP. Measured on the live page 2026-09-29: the XRP mark
  // came back `complete=true naturalWidth=0` with a 429 in the console, so the asset row on the one
  // asset this ledger always has rendered as a broken image. A logo is not worth a metered request.
  var XRP_LOGO = '';                 // set once ICONV is known, just below
  var MIN_DROPS = 2000000;          // 1Click's own floor, surfaced before it has to refuse a quote

  // THE DESTINATION CHAINS, and the names the page shows for them.
  //
  // Keyed by 1Click's chain id. The name is what the design's dropdown already calls the chain where it
  // has an entry, so twelve of these match an existing `.brd-opt` and are simply revealed rather than
  // duplicated; the rest are appended as clones. Six of the design's eighteen options — Hedera, Linea,
  // Mantle, Sei, World Chain and zkSync Era — are NOT reachable through this route and are hidden. A
  // bridge naming a route it does not have is the worst kind of wrong on this page.
  //
  // MUST MATCH the CHAINS map in functions/lxapi/oneclick.js. _xrplnearintents.js fails the build when
  // the two disagree, because on the Stellar build the same two lists drifting apart did not raise an
  // error — the picker just showed "0 ASSETS" for the missing chains and every quote to them failed.
  var NI_CHAIN = {
    eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', op: 'Optimism', pol: 'Polygon',
    avax: 'Avalanche', bsc: 'BNB Chain', scroll: 'Scroll', gnosis: 'Gnosis', bera: 'Berachain',
    monad: 'Monad', plasma: 'Plasma', xlayer: 'X Layer', abs: 'Abstract', hood: 'Robinhood',
    hypercore: 'Hyperliquid', sol: 'Solana', near: 'Near', sui: 'Sui', starknet: 'Starknet',
    aptos: 'Aptos', movement: 'Movement', ton: 'TON', tron: 'Tron', cardano: 'Cardano',
    btc: 'Bitcoin', ltc: 'Litecoin', doge: 'Dogecoin', bch: 'Bitcoin Cash', dash: 'Dash',
    zec: 'Zcash', aleo: 'Aleo', fogo: 'Fogo', adi: 'ADI', stellar: 'Stellar'
  };

  var TOKENS = null, NATIVES = {}, KEYED = false;
  var BY_CHAIN = {};                // chain -> [token]
  var ORIGIN = null;                // the XRP token

  // ---- the Axelar route ----------------------------------------------------------------------------
  // THE TWO ROUTES DO NOT OVERLAP, which is what makes choosing between them a lookup rather than a
  // judgement. NEAR Intents moves XRP and only XRP, to 35 chains. Axelar moves the 17 ITS assets
  // registered on this ledger, to 7 chains -- and of those, XRP reaches only xrpl-evm and hedera,
  // neither of which NEAR Intents serves. So:
  //
  //   source is an IOU              -> Axelar (NEAR Intents cannot carry it at all)
  //   source is XRP, dest on NI     -> NEAR Intents (wider, cheaper, delivers native gas)
  //   source is XRP, dest elsewhere -> Axelar (xrpl-evm, hedera)
  //
  // There is no pair both can serve, so nothing has to be preferred and no rule can go stale in a way
  // that silently picks the worse one.
  // ---- the THORChain route -------------------------------------------------------------------------
  // The only one of the three that competes rather than covering new ground: it overlaps NEAR Intents
  // on ten chains and adds one nobody else serves. So where both can carry a pair, BOTH ARE ASKED and
  // the better price wins -- which is the whole reason it earns a place. On the first pairs measured
  // THORChain beat NEAR Intents to Bitcoin by about 11% and lost to it on Ether and Dogecoin; neither
  // is reliably better, so preferring one by rule would be choosing the worse answer roughly half the
  // time.
  var TH = null;                    // {pools[], e8, xrpTradeable}
  var TH_NATIVE = {};               // THORChain chain id -> its native pool asset, e.g. BTC -> BTC.BTC
  var THQ = null;                   // the THORChain quote for the current pair
  var BEST = '';                    // which route the page is currently showing: ni | th | ax
  var QUOTING = false;              // a quote is in flight -- distinct from having been refused one
  var PICKED = '';                  // a route the reader chose by hand, overriding the better price
  var PICKED_FOR = '';              // the destination it was chosen ON; it means nothing anywhere else

  var AX = null;                    // {gateway, assets[], destinations[]}
  var AX_BY_SYM = {};
  var HOLD = {};                    // currency|issuer -> balance the wallet actually holds
  var SRC = null;                   // the chosen source asset (XRP or an ITS IOU)
  var DEST = null;                  // {chain, token}  (token is the NI token, or null on Axelar)
  var AXQ = null;                   // the Axelar gas estimate for the current pair
  var QUOTE = null;                 // the last live dry quote
  var LAST_NOTE = '';               // why there is no quote, in words the user can act on
  // ONE NOTE PER ROUTE, because a shared one gets ATTRIBUTED TO THE WRONG ROUTE. Measured on the
  // live page: THORChain answered "trading is halted, can't process swap" and NEAR Intents answered
  // something else entirely, and because both wrote LAST_NOTE the route panel printed THORChain's
  // halt under BOTH cards. A bridge telling someone NEAR Intents has halted trading -- when it has
  // not, and when the real reason was different and fixable -- is worse than saying nothing.
  var NOTE = { ni: '', th: '', ax: '' };

  // A ROUTE'S OWN INTERNAL FAULT IS NOT A MESSAGE FOR A READER. Measured live 2026-09-29: every
  // XRP-origin quote to 1Click came back with their `{"message":"Internal server error",
  // "correlationId":...,"path":"/v0/quote"}` -- their fault, their wording, and printed verbatim on
  // the route card it tells the reader nothing they can act on and reads like a fault in this page.
  // Anything a user CAN act on (a dust minimum, a bad address, a halted chain) is passed through
  // unchanged, because those are the messages worth having.
  function upstreamNote(msg) {
    return /internal server error|bad gateway|service unavailable|gateway time|^\s*5\d\d\s*$/i.test(msg)
      ? 'Not answering right now — another route may still carry this.'
      : msg;
  }
  var XRP_SPEND = null;
  var busy = false;

  function addr() { try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; } }
  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function feeRate() { return typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002; }
  function drops(xrp) { return String(Math.round(Number(xrp) * 1e6)); }
  function fromDrops(d) { return Number(d) / 1e6; }
  function fmt(n, dp) {
    var x = Number(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 6 : dp });
  }

  // ---- chain and token artwork ---------------------------------------------------------------------
  //
  // SHIPPED FILES FIRST, THE PROXY ONLY AS A FALLBACK, and that order is the whole point.
  //
  // This resolved every mark at runtime through `/lxapi/oneclick?op=logo` -> CoinGecko, which is the
  // EXACT fallback the Stellar build already measured as 404ing from Cloudflare's edge (CoinGecko
  // refuses those requests; _nilogos.js exists because of it). The result here was five chains with
  // artwork and thirty-four grey letter discs -- reported by RAZA 2026-09-29, "many network logos
  // dont show up in the destination networks dropdown".
  //
  // The files are the same ones the Stellar build fetched, checked and self-hosted: 96x96 PNGs under
  // assets/networks/, never hotlinked. The proxy stays for the handful with no file, because a chain
  // added to 1Click tomorrow should still get a mark without a build.
  //
  // KEYED ON THE PLACE LABEL, NOT THE NEAR INTENTS CHAIN ID. Four destinations -- XRPL EVM, Hedera,
  // Cosmos Hub, THORChain -- are reached by Axelar or THORChain and have no NI id at all, so a map
  // keyed on that id could never give them a logo however complete it was.
  var ICONV = '__LX_ICONV__';        // stamped by _xrplnearintents.js from the logo bytes
  var NI_TOKEN = __LX_NI_TOKENS__;   // which assets/tokens/ni/*.png actually shipped, read at build
  // WHICH NETWORK FILES ACTUALLY SHIPPED, also read at build. NET_FILE below names the slug a chain
  // WOULD use; this says whether that file is there. The two are separate because five of the thirty-
  // nine destinations have no artwork yet, and naming a file that does not exist is not harmless: an
  // <img> can fall back to letters on error, but the stylesheet in paintOptionCss() cannot, so a
  // missing file would paint an EMPTY disc -- a worse answer than the letters it replaced.
  var NET_HAVE = __LX_NET_FILES__;
  var NET_FILE = {
    Ethereum: 'ethereum', Arbitrum: 'arbitrum', Base: 'base', Optimism: 'optimism',
    Polygon: 'polygon', Avalanche: 'avalanche', 'BNB Chain': 'bnbchain', Scroll: 'scroll',
    Gnosis: 'gnosis', Berachain: 'berachain', Monad: 'monad', Plasma: 'plasma',
    'X Layer': 'xlayer', Robinhood: 'hood', Hyperliquid: 'hyperliquid', Solana: 'solana',
    Near: 'near', Sui: 'sui', Starknet: 'starknet', Aptos: 'aptos', Movement: 'movement',
    TON: 'ton', Tron: 'tron', Cardano: 'cardano', Bitcoin: 'bitcoin', Litecoin: 'litecoin',
    Dogecoin: 'dogecoin', 'Bitcoin Cash': 'bitcoincash', Dash: 'dash', Zcash: 'zcash',
    Fogo: 'fogo', ADI: 'adi', Hedera: 'hedera', Stellar: 'stellar', Abstract: 'abstract',
    Aleo: 'aleo', 'Cosmos Hub': 'cosmoshub', THORChain: 'thorchain',
    // The EVM sidechain carries the XRP Ledger's own mark, which is whose chain it is. There is no
    // separate brand for it and inventing one would be worse than sharing the real one.
    'XRPL EVM': 'xrpl', 'XRP Ledger': 'xrpl'
  };
  function netFile(label) {
    var f = NET_FILE[label];
    return f && NET_HAVE[f] ? ('/assets/networks/' + f + '.png?v=' + ICONV) : '';
  }

  // THE DESIGN'S OWN OPTIONS ARE PAINTED BY STYLESHEET, not by touching the nodes.
  //
  // Eighteen options ship in the container and the design re-renders that list; setting a background
  // on the node itself is a fight with its render loop, and the Stellar build lost it visibly (the
  // list showing the design's ETH-token diamond while the selected field showed the network mark).
  // An `!important` background outranks the inline one without touching the node, so there is nothing
  // to fight and nothing to flash.
  //
  // This covers the SOURCE chip too. "XRP Ledger" had no artwork anywhere in this build -- there was
  // no assets/networks/ folder at all -- so the source side of both steps rendered a broken-image
  // cross next to the wallet that is connected.
  function paintOptionCss() {
    try {
      if (document.getElementById('lx-xnetbg')) return;
      var css = '';
      Object.keys(NET_FILE).forEach(function (n) {
        var u = netFile(n);
        if (!u) return;                            // no file shipped -- leave the letters alone
        css += '.brd-opt[data-net="' + n + '"] .brd-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}';
      });
      if (NET_HAVE.xrpl) {
        css += '.br-netbox .br-net[data-lxsrc] .br-ic,.br-step[data-step="1"] .br-side:first-child .br-ic'
          + '{background:url(/assets/networks/xrpl.png?v=' + ICONV + ') center/cover no-repeat !important;'
          + 'color:transparent !important}';
      }
      var st = document.createElement('style');
      st.id = 'lx-xnetbg';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    } catch (_) {}
  }
  // `label` is what the page CALLS the place. The NI chain id is still accepted, because two callers
  // hold one and the lookup is cheap.
  function chainLogo(label) {
    var direct = netFile(label) || netFile(NI_CHAIN[label] || '');
    if (direct) return direct;
    var list = BY_CHAIN[label] || [];
    var nat = list.filter(function (t) { return !t.contractAddress; })[0] || list[0];
    return nat && nat.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(nat.coingeckoId)) : '';
  }
  // Destination TOKEN logos ship too (assets/tokens/ni/SYMBOL.png, the same files the Stellar build
  // fetched from the coingeckoId 1Click itself gives each asset -- so the art is keyed on the identity
  // being delivered, not on a ticker guess).
  function symLogo(sym) {
    var s = String(sym || '').replace(/[^A-Za-z0-9._-]/g, '');
    return s && NI_TOKEN[s] ? ('/assets/tokens/ni/' + s + '.png?v=' + ICONV) : '';
  }
  function tokenLogo(t) {
    if (!t) return '';
    return symLogo(t.symbol) || (t.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(t.coingeckoId)) : '');
  }
  XRP_LOGO = symLogo('XRP');

  // Letters in a disc, the way the design marks a network it has no artwork for. Needed as a real
  // fallback rather than a nicety: plenty of these chains have no CoinGecko logo and the request 404s,
  // and an icon slot left empty reads as a broken image.
  function markLetters(host, name) {
    if (!host) return;
    host.textContent = '';
    var s = document.createElement('span');
    s.className = 'lx-netlm2';
    s.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;'
      + 'border-radius:50%;background:#5b6170;color:#fff;font-size:9px;font-weight:700';
    s.textContent = String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    host.appendChild(s);
    host.setAttribute('data-logo', '');
    host.setAttribute('data-logoed', '1');
  }

  function setIcon(host, src, fallbackName) {
    if (!host) return;
    host.setAttribute('data-logo', '');
    host.setAttribute('data-logoed', '1');
    if (!src) { if (fallbackName) markLetters(host, fallbackName); return; }
    var img = host.querySelector('img');
    if (!img) {
      host.textContent = '';
      img = document.createElement('img');
      img.className = 'lx-netimg';
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
      img.onerror = function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        if (fallbackName) markLetters(host, fallbackName);
      };
      host.appendChild(img);
    }
    if (img.getAttribute('src') !== src) img.src = src;
  }

  // SELECTING AN APPENDED DESTINATION, because the design's own handler never sees one.
  //
  // Twenty-three of the thirty-five chains are clones appended to the design's list, and "a clone
  // carries no listeners" -- so clicking Bitcoin, Solana, Cardano or any of the other twenty left the
  // trigger reading "Select Network" and nothing downstream ran. The twelve chains the design happens
  // to ship worked, which is exactly the shape of bug that passes a quick test: the first thing anyone
  // clicks is near the top of an alphabetical list, and Arbitrum, Avalanche and Base are all originals.
  //
  // This does what the design's handler was observed to do, no more: set the name, drop `is-empty`,
  // paint the mark, close the dropdown.
  function selectChain(o) {
    var trg = $('.brd-trigger');
    if (!trg) return;
    var name = o.getAttribute('data-net');
    var nm = trg.querySelector('.nm');
    if (nm) nm.textContent = name;
    trg.classList.remove('is-empty');
    var ic = trg.querySelector('.br-ic');
    if (ic) {
      // THE SHIPPED FILE IS ASKED FOR FIRST, and that is the fix for "no logos shown after the
      // network is selected" (RAZA 2026-09-29). This used to copy the src off the option's <img> --
      // but the design's own eighteen options carry their mark as a CSS BACKGROUND, not an img, so
      // for every one of those the lookup found nothing and fell through to grey letters. The option
      // that had a logo in the list lost it the moment it was chosen.
      var img = o.querySelector('.brd-ic img');
      setIcon(ic, chainLogo(name) || (img ? img.getAttribute('src') : ''), name);
    }
    var dd = o.closest('.brd');
    if (dd) dd.classList.remove('open');
    DEST = null; QUOTE = null;
    paintSteps(); requote();
  }

  // ---- source side ---------------------------------------------------------------------------------
  // Kept from the layer this replaces, including the two fixes that were expensive to find.
  function paintSource() {
    var me = addr();
    // `:not(.brd-trigger)` IS the fix for "destination: XRP Ledger". The destination dropdown's closed
    // state is also a `.br-netchip`, so a bare selector stamped "XRP Ledger" over its placeholder and
    // the page opened asking you to bridge the XRP Ledger to the XRP Ledger.
    $$('.br-netchip:not(.brd-trigger)').forEach(function (c) {
      var nm = c.querySelector('.nm');
      if (nm) nm.textContent = 'XRP Ledger';
      var img = c.querySelector('img');
      if (img) { img.src = XRP_LOGO; img.alt = ''; }
    });
    $$('.br-wallet').forEach(function (w) {
      var a = w.querySelector('.addr');
      if (a) a.textContent = me ? short(me) : 'Not connected';
      var img = w.querySelector('img');
      if (img) { img.src = XRP_LOGO; img.alt = ''; }
    });
  }

  function rpcB(method, params) {
    return fetch('/lxapi/xrplhistory?method=' + encodeURIComponent(method)
      + '&params=' + encodeURIComponent(JSON.stringify(params || {})))
      .then(function (r) { return r.json(); });
  }
  function loadSpendable() {
    var me = addr();
    if (!me) { XRP_SPEND = null; return Promise.resolve(); }
    return rpcB('account_info', { account: me, ledger_index: 'validated' })
      .then(function (d) {
        var acc = d && d.result && d.result.account_data;
        if (!acc) { XRP_SPEND = null; return; }
        // The reserve is not spendable. 1 XRP base + 0.2 per owned object, which is the current
        // mainnet schedule; xrpl-core owns this arithmetic elsewhere and this mirrors it.
        var bal = fromDrops(acc.Balance);
        var reserve = 1 + 0.2 * Number(acc.OwnerCount || 0);
        XRP_SPEND = Math.max(0, bal - reserve);
      })
      .catch(function () { XRP_SPEND = null; });
  }

  // ---- what the wallet is actually holding ---------------------------------------------------------
  // The source list is the user's own balances INTERSECTED with Axelar's registry, not the registry on
  // its own. You can only send what you hold, so offering seventeen assets to someone who holds one is
  // seventeen ways to reach an error. It also bounds the picker without a rule having to.
  function holdKey(cur, iss) { return String(cur) + '|' + String(iss || ''); }
  function loadHoldings() {
    var me = addr();
    HOLD = {};
    if (!me || !AX) return Promise.resolve();
    return rpcB('account_lines', { account: me, ledger_index: 'validated', limit: 400 })
      .then(function (d) {
        var lines = (d && d.result && d.result.lines) || [];
        lines.forEach(function (l) {
          var bal = parseFloat(l.balance);
          if (!(bal > 0)) return;                        // a zero or negative line is not a holding
          HOLD[holdKey(l.currency, l.account)] = bal;
        });
      })
      .catch(function () {});
  }

  // XRP first, then every registered asset the wallet holds.
  function sourceAssets() {
    var out = [];
    var xrp = AX && AX_BY_SYM.XRP;
    out.push({ symbol: 'XRP', native: true, decimals: 6, currency: 'XRP', issuer: null,
      balance: XRP_SPEND, ax: xrp || null });
    if (!AX) return out;
    AX.assets.forEach(function (a) {
      if (a.native) return;
      var bal = HOLD[holdKey(a.currency, a.issuer)];
      if (!(bal > 0)) return;
      out.push({ symbol: a.symbol, native: false, decimals: a.decimals,
        currency: a.currency, issuer: a.issuer, balance: bal, ax: a });
    });
    return out;
  }

  // A DESTINATION IS A PLACE; THE ROUTE IS HOW YOU GET THERE. The two registries use different ids for
  // the same chain -- NEAR Intents says `eth`, `sol`, `pol`; Axelar says `ethereum`, `solana`,
  // `polygon` -- and keying the list on the id produced two options called "Ethereum" that collided on
  // their display name. Five destinations vanished (35 offered, 32 shown) and every Axelar route with
  // them, because whichever id was written second won and the other was simply gone.
  //
  // So the list is keyed on the PLACE, and each place remembers the id each route calls it by. The
  // same option then serves "XRP to Ethereum" (NEAR Intents) and "WETH to Ethereum" (Axelar) without
  // appearing twice, which is also what a reader expects: they are choosing where the money goes, not
  // which registry names it.
  // THORChain names chains its own way again -- a third naming of the same places. Mapped to the same
  // labels so Bitcoin is ONE option served by two routes, not two options that look identical.
  var TH_NAME = { BTC: 'Bitcoin', ETH: 'Ethereum', BCH: 'Bitcoin Cash', LTC: 'Litecoin',
    DOGE: 'Dogecoin', AVAX: 'Avalanche', BSC: 'BNB Chain', BASE: 'Base', SOL: 'Solana',
    TRON: 'Tron', GAIA: 'Cosmos Hub', THOR: 'THORChain' };

  var PLACES = {};                  // normalised label -> {label, ni?, ax?, th?}
  function buildPlaces() {
    PLACES = {};
    var put = function (label) {
      var k = norm(label);
      if (!PLACES[k]) PLACES[k] = { label: label };
      return PLACES[k];
    };
    Object.keys(BY_CHAIN).forEach(function (c) { if (NI_CHAIN[c]) put(NI_CHAIN[c]).ni = c; });
    if (AX) AX.destinations.forEach(function (c) { put(AX_NAME[c] || c).ax = c; });
    Object.keys(TH_NATIVE).forEach(function (c) {
      if (c === 'XRP' || !TH_NAME[c]) return;          // XRP is the origin, not a destination
      put(TH_NAME[c]).th = c;
    });
    return PLACES;
  }

  // The chain's NATIVE pool, which is the only thing this route is offered for. THORChain also pools
  // tokens (ETH.USDC-0X…), and a symbol carrying a dash is one of those -- comparing a token quote
  // against a native one would be comparing two different deliveries.
  function buildThNative() {
    TH_NATIVE = {};
    if (!TH) return;
    TH.pools.forEach(function (p) {
      if (p.symbol.indexOf('-') >= 0) return;
      if (!TH_NATIVE[p.chain]) TH_NATIVE[p.chain] = p.asset;
    });
  }

  // EVERY route that can carry this pair, not one. Where more than one can, the price decides -- see
  // settle(). An IOU is Axelar's alone; XRP can go by any of the three depending on where.
  function routesFor(src, key) {
    var p = PLACES[key], out = [];
    if (!src || !p) return out;
    var axOk = p.ax && src.ax && src.ax.chains.indexOf(p.ax) >= 0;
    if (!src.native) return axOk ? ['ax'] : [];
    if (p.ni && BY_CHAIN[p.ni]) out.push('ni');
    if (p.th && TH && TH.xrpTradeable) out.push('th');
    if (axOk) out.push('ax');
    return out;
  }
  // Kept for the callers that only need to know WHETHER something serves the pair, and which one when
  // there is exactly one.
  function routeFor(src, key) {
    var r = routesFor(src, key);
    return r.length ? r[0] : '';
  }

  // Everywhere the CURRENT source asset can go, which is what the destination list must show.
  // Changing the source changes it: an IOU collapses the list from 37 places to a handful.
  function reachablePlaces() {
    var set = {};
    if (!SRC) return set;
    Object.keys(PLACES).forEach(function (k) {
      var r = routeFor(SRC, k);
      if (r) set[k] = r;
    });
    return set;
  }

  // Axelar's chain ids are not all the names the page shows, and CASE MATTERS UPSTREAM -- the Stellar
  // ITS contract refuses 'ethereum' while accepting 'Ethereum'. These are the ids the registry itself
  // returns, so they go on the wire exactly as received; this map only decides what to CALL them.
  var AX_NAME = { 'xrpl-evm': 'XRPL EVM', hedera: 'Hedera', ethereum: 'Ethereum',
    stellar: 'Stellar', monad: 'Monad', solana: 'Solana', polygon: 'Polygon' };
  // Kept for the two places that still name a raw route id. placeLabel() is what the UI uses.
  function chainLabel(c) { return NI_CHAIN[c] || AX_NAME[c] || c; }

  // ---- destinations --------------------------------------------------------------------------------
  function wireDestinations() {
    var opts = $$('.brd-opt');
    if (!opts.length) return 0;
    var menu = opts[0].parentNode;
    // EVERY chain EITHER route can serve gets an option node, built once. Which of them is VISIBLE is
    // a separate question answered by refreshDestinations(), because it changes with the source asset
    // and the nodes must not be rebuilt each time -- rebuilding is what loses listeners and what made
    // twenty-three destinations unclickable the first time round.
    buildPlaces();

    var have = {};
    opts.forEach(function (o) {
      var key = norm(o.getAttribute('data-net'));
      have[key] = 1;
      if (PLACES[key]) o.setAttribute('data-lxplace', key);
      else o.removeAttribute('data-lxplace');
    });

    Object.keys(PLACES).forEach(function (k) {
      if (have[k]) return;
      have[k] = 1;
      menu.appendChild(extraOption(opts[0], k, PLACES[k].label));
    });

    $$('.brd-opt', menu).sort(function (a, b) {
      return String(a.getAttribute('data-net')).localeCompare(String(b.getAttribute('data-net')));
    }).forEach(function (o) { menu.appendChild(o); });

    return refreshDestinations();
  }

  // Shown or hidden per the CURRENT source asset.
  //
  // Revealed with an INLINE important declaration. The inherited Stellar stylesheet hides eleven of
  // these with `!important` because Circle CCTP could not reach them, and that CSS came across with
  // the fork -- a stylesheet outliving the layer whose decision it encoded. An inline important is the
  // one thing that reliably outranks it regardless of which <style> the build emits last.
  function refreshDestinations() {
    var reach = reachablePlaces();
    var shown = [];
    $$('.brd-opt').forEach(function (o) {
      var c = o.getAttribute('data-lxplace');
      if (c && reach[c]) {
        o.style.setProperty('display', 'flex', 'important');
        o.setAttribute('data-lxroute', reach[c]);
        shown.push(o.getAttribute('data-net'));
      } else {
        o.style.setProperty('display', 'none', 'important');
        o.removeAttribute('data-lxroute');
      }
    });
    window.__lxxBridgeNets = shown;
    // A destination already chosen that the new source cannot reach is CLEARED rather than left
    // standing: leaving it would show a pair that no route serves while the trigger insists it is set.
    var cur = destChain();
    if (cur && !reach[cur]) {
      var trg = $('.brd-trigger'), nm = trg && trg.querySelector('.nm');
      if (nm) nm.textContent = 'Select Network';
      if (trg) trg.classList.add('is-empty');
      DEST = null; QUOTE = null; AXQ = null;
    }
    return shown.length;
  }

  function extraOption(tpl, chain, name) {
    var o = tpl.cloneNode(true);                       // a clone carries no listeners
    o.setAttribute('data-net', name);
    o.setAttribute('data-lxplace', chain);
    o.setAttribute('data-lxadded', '1');
    o.removeAttribute('style');
    o.style.setProperty('display', 'flex', 'important');
    var ic = o.querySelector('.brd-ic');
    // ON THE LABEL, not on niId(chain). That read the artwork off the NEAR Intents side only, so the
    // four places NI does not serve -- XRPL EVM, Hedera, Cosmos Hub, THORChain -- could never have a
    // mark, and every chain whose CoinGecko fetch 404d fell to letters as well.
    if (ic) { ic.removeAttribute('style'); ic.textContent = ''; setIcon(ic, chainLogo(name), name); }
    var nm = o.querySelector('.brd-nm');
    if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = name; }
    return o;
  }

  // Which chain the design's trigger is currently showing.
  // Resolved off the OPTION NODE rather than by matching the label against a map. Two maps now supply
  // display names (NEAR Intents' chains and Axelar's), and matching against one of them would have
  // quietly failed for every chain that came from the other -- the exact shape of the bug where a
  // destination is pickable and then dead. The option carries the id it was built with.
  function destChain() {
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    if (!trg || trg.classList.contains('is-empty') || !tn) return null;
    var k = norm(tn.textContent), found = null;
    $$('.brd-opt').forEach(function (o) {
      if (found) return;
      if (norm(o.getAttribute('data-net')) === k) found = o.getAttribute('data-lxplace') || null;
    });
    return found;
  }
  // The id the chosen route calls this place by. Everything on the wire uses one of these two, never
  // the place key, which exists only to hold them together.
  function niId(key) { var p = PLACES[key]; return (p && p.ni) || null; }
  function axId(key) { var p = PLACES[key]; return (p && p.ax) || null; }
  function placeLabel(key) { var p = PLACES[key]; return (p && p.label) || key; }

  // ---- the destination asset picker ----------------------------------------------------------------
  function destTokens(chain) {
    var list = (BY_CHAIN[chain] || []).slice();
    // Native first, then by descending USD price as a rough proxy for prominence, then alphabetical.
    list.sort(function (a, b) {
      var an = a.contractAddress ? 1 : 0, bn = b.contractAddress ? 1 : 0;
      if (an !== bn) return an - bn;
      var ap = Number(a.price) || 0, bp = Number(b.price) || 0;
      if (ap !== bp) return bp - ap;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
    return list;
  }

  // THE DESTINATION SIDE HAS NO ASSET ROW IN THE DESIGN. Its whole column is a heading and an address
  // input -- there is no `.br-asset` and no `.br-amt` to paint, which is why the layer this replaces
  // never rendered a "You get" figure either and why DEST stayed null however many chains were picked.
  //
  // Built by CLONING THE SOURCE SIDE'S OWN ROWS rather than authoring new markup: the clone carries
  // the design's classes, spacing and icon shapes exactly, so the two columns cannot drift apart, and
  // anything the stylesheet does to one it does to the other.
  function ensureDestRow(dst) {
    var have = dst.querySelector('.br-assetrow');
    if (have) return have.querySelector('.br-asset');
    var s2 = $('.br-step[data-step="2"]');
    var src = s2 && s2.querySelectorAll('.br-side')[0];
    var srcRow = src && src.querySelector('.br-assetrow');
    if (!srcRow) return null;

    var srcLbl = src.querySelector('.br-amtrow');
    if (srcLbl) {
      var lbl = srcLbl.cloneNode(true);
      var bal = lbl.querySelector('.bal');          // no balance on the far side, and no MAX
      if (bal && bal.parentNode) bal.parentNode.removeChild(bal);
      var first = lbl.querySelector('span');
      if (first) first.textContent = 'You get';
      dst.appendChild(lbl);
    }
    var row = srcRow.cloneNode(true);
    var amt = row.querySelector('.br-amt');
    if (amt) {
      // THE CLONE MUST NOT CARRY THE SOURCE'S BALANCE FURNITURE. The step-2 layer moves the balance
      // and MAX into the source amount box (as Stellar's does), and both are meaningless on the
      // receiving side -- the balrow's ::before would print "Available to send" over the figure the
      // destination is quoting, and a MAX button there would do nothing at all.
      var bx = amt.querySelector('.lx-balrow');
      if (bx && bx.parentNode) bx.parentNode.removeChild(bx);
      var kp = amt.querySelector('img.lx-amt-keep');
      if (kp && kp.parentNode) kp.parentNode.removeChild(kp);
      var ai = amt.querySelector('.lx-amt-in');
      if (ai && ai.parentNode) ai.parentNode.removeChild(ai);
      // The clone arrives holding the SOURCE's values -- and on first paint that is the amount the
      // user just typed. Shown on the receiving side it would read as a quote nobody asked for and
      // that nothing had priced, which is the one thing this file must never do.
      var v = amt.querySelector('.v'), u = amt.querySelector('.usd');
      if (v) { v.textContent = '—'; }
      if (u) u.textContent = '';
    }
    var as = row.querySelector('.br-asset');
    if (as) {
      var nm = as.querySelector('.nm');
      // "Select", not "—". THE LOGO HEALER EATS THIS ROW OTHERWISE, and it does not throw when it
      // does: it repaints any short-text element into a ticker badge, and the first version of this
      // clone came back carrying data-logo="ETH", a base64 SVG background and NO .br-asset or .nm at
      // all -- the children were replaced. DEST could then never be set, so the button sat on "Choose
      // a destination" however many chains were picked, with nothing in the console.
      if (nm) nm.textContent = 'Select';
    }
    // THE THREE ESCAPES, TOGETHER, because each covers a different painter:
    //   - an <img> child is left in place (never cleared) -- the healer skips an element that already
    //     has one, which is why the SOURCE row, whose img the design ships, was never touched;
    //   - data-logo="" makes the logo ENGINE skip it;
    //   - data-logoed="1" marks it done for the engine's second pass.
    // data-logoed alone is NOT enough. That is the trap: it looks like the right attribute, it is the
    // one used everywhere else in this file, and it does not stop the healer.
    [row, as, as && as.querySelector('.nm'), as && as.querySelector('.br-ic')].forEach(function (el) {
      if (!el) return;
      el.setAttribute('data-logo', '');
      el.setAttribute('data-logoed', '1');
    });
    dst.appendChild(row);
    return as;
  }

  function paintDestAsset(dst) {
    var key = destChain(), as = ensureDestRow(dst);
    if (!as || !key) return;
    // CHOOSING A DESTINATION ASSET IS A NEAR INTENTS IDEA. Only that route swaps, so only it has a
    // list of things you could come out as. Axelar delivers the SAME asset it was handed, so the
    // picker stands down and names that asset instead of offering choices that cannot apply.
    var routes = routesFor(SRC, key);
    var chain = routes.indexOf('ni') >= 0 ? niId(key) : null;
    if (!chain) {
      // WHICH ASSET ARRIVES DEPENDS ON THE ROUTE, and the first version assumed it was always the one
      // being sent. That is true of Axelar, which hands the same asset out the other side -- and
      // wrong of THORChain, which SWAPS. Cosmos Hub then read "4.137837 XRP" when the figure was
      // 4.137837 ATOM: the number was right and the label was a different asset entirely, which is
      // the most dangerous way for a bridge to be wrong.
      var p = PLACES[key];
      var thSym = (routes.indexOf('th') >= 0 && p && p.th && TH_NATIVE[p.th])
        ? (String(TH_NATIVE[p.th]).split('.')[1] || '') : '';
      var label = thSym || (SRC ? SRC.symbol : '—');
      var nmAx = as.querySelector('.nm');
      if (nmAx) nmAx.textContent = label;
      // THE ARRIVING ASSET'S OWN MARK. This only ever offered XRP_LOGO, and only when the route was
      // NOT THORChain -- so every THORChain destination showed a grey letter disc beside a real
      // figure (ATOM on Cosmos Hub, measured 2026-09-29). The shipped file is asked for by symbol,
      // which covers the natives THORChain swaps into, and letters remain the fallback.
      setIcon(as.querySelector('.br-ic'),
        symLogo(label) || ((!thSym && SRC && SRC.native) ? XRP_LOGO : ''), label);
      as.style.cursor = '';
      DEST = null;
      return;
    }
    var opts = destTokens(chain);
    if (!DEST || DEST.chain !== chain) DEST = opts[0] ? { chain: chain, token: opts[0] } : null;
    if (!DEST) return;
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== DEST.token.symbol) {
      nm.textContent = DEST.token.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    setIcon(as.querySelector('.br-ic'), tokenLogo(DEST.token));
    as.style.cursor = opts.length > 1 ? 'pointer' : '';
    if (!as.__lxxMenu) {
      as.__lxxMenu = 1;
      as.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleDestMenu(as); });
    }
  }

  function toggleDestMenu(as) {
    var old = document.querySelector('.lx-destmenu');
    if (old) { old.parentNode.removeChild(old); return; }
    var key = destChain();
    var chain = key && routeFor(SRC, key) === 'ni' ? niId(key) : null;
    if (!chain) return;
    var opts = destTokens(chain);
    if (opts.length < 2) return;
    var wrap = document.createElement('div');
    wrap.className = 'brd open lx-destmenu';
    wrap.style.cssText = 'position:absolute;z-index:60;right:0;top:calc(100% + 6px);min-width:240px';
    var menu = document.createElement('div');
    menu.className = 'brd-menu';
    menu.style.cssText = 'display:block;position:static;max-height:300px;overflow:auto';
    opts.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'brd-opt lx-destopt';
      b.style.setProperty('display', 'flex', 'important');
      var ic = document.createElement('span');
      ic.className = 'brd-ic';
      setIcon(ic, tokenLogo(t));
      var nmx = document.createElement('span');
      nmx.className = 'brd-nm';
      nmx.setAttribute('data-logoed', '1');
      // The native asset is marked, because 1Click lists wrapped copies of coins next to the real
      // thing and "XRP" on Starknet beside "XRP" is a trap on a page bridging OUT of XRP.
      nmx.textContent = t.symbol + (t.contractAddress ? '' : '  · native');
      b.appendChild(ic); b.appendChild(nmx);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        DEST = { chain: chain, token: t };
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        QUOTE = null;
        paintSteps(); requote();
      });
      menu.appendChild(b);
    });
    wrap.appendChild(menu);
    var host = as.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
    setTimeout(function () {
      document.addEventListener('click', function away() {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.removeEventListener('click', away, true);
      }, true);
    });
  }

  // ---- the source asset ----------------------------------------------------------------------------
  // The design's source chip is fixed text reading "XRP". It becomes a picker as soon as the wallet
  // holds something else Axelar can carry -- and stays inert when it does not, so a wallet with only
  // XRP sees exactly what it saw before.
  function paintSourceAsset() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var as = side && side.querySelector('.br-asset');
    if (!as) return;
    // REBOUND TO THE FRESH ENTRY EVERY TIME, keeping the user's CHOICE (which is the symbol) but never
    // their stale COPY of it. The first version kept the existing object whenever its symbol was still
    // in the list -- and SRC is first set by the early paint, before the Axelar registry has arrived,
    // so it held `ax: null` forever. Every Axelar destination then evaluated as unreachable and the
    // route was invisible while both registries reported loaded.
    var list = sourceAssets();
    var keep = SRC && list.filter(function (a) { return a.symbol === SRC.symbol; })[0];
    SRC = keep || list[0];
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== SRC.symbol) {
      nm.textContent = SRC.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    setIcon(as.querySelector('.br-ic'), SRC.native ? XRP_LOGO : '', SRC.symbol);
    as.style.cursor = list.length > 1 ? 'pointer' : '';
    if (!as.__lxxSrcMenu) {
      as.__lxxSrcMenu = 1;
      as.addEventListener('click', function (e) {
        if (sourceAssets().length < 2) return;
        e.preventDefault(); e.stopPropagation(); toggleSrcMenu(as);
      });
    }
  }

  function toggleSrcMenu(as) {
    var old = document.querySelector('.lx-srcmenu');
    if (old) { old.parentNode.removeChild(old); return; }
    var list = sourceAssets();
    if (list.length < 2) return;
    var wrap = document.createElement('div');
    wrap.className = 'brd open lx-srcmenu';
    wrap.style.cssText = 'position:absolute;z-index:60;left:0;top:calc(100% + 6px);min-width:250px';
    var menu = document.createElement('div');
    menu.className = 'brd-menu';
    menu.style.cssText = 'display:block;position:static;max-height:300px;overflow:auto';
    list.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'brd-opt lx-srcopt';
      b.style.setProperty('display', 'flex', 'important');
      var ic = document.createElement('span');
      ic.className = 'brd-ic';
      setIcon(ic, a.native ? XRP_LOGO : '', a.symbol);
      var nmx = document.createElement('span');
      nmx.className = 'brd-nm';
      nmx.setAttribute('data-logo', '');
      nmx.setAttribute('data-logoed', '1');
      nmx.textContent = a.symbol + (a.balance != null ? ('  ' + fmt(a.balance, 6)) : '');
      b.appendChild(ic); b.appendChild(nmx);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        SRC = a; QUOTE = null; AXQ = null;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        refreshDestinations();
        paintSteps(); requote();
      });
      menu.appendChild(b);
    });
    wrap.appendChild(menu);
    var host = as.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
    setTimeout(function () {
      document.addEventListener('click', function away() {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.removeEventListener('click', away, true);
      }, true);
    });
  }

  // ---- Axelar: the arithmetic and the memos --------------------------------------------------------
  // A single XRPL Payment carries one Amount, and the validators read it as BOTH the amount to bridge
  // and the source of the relay gas: transfer_amount = Amount - gas_fee_amount. So the figure the user
  // types is what LEAVES, and what arrives is that minus gas -- stated on the page rather than
  // discovered afterwards.
  function axUnits(v, dp) {
    // The asset's smallest unit as an integer string. Rounded, never truncated: truncation shaves a
    // unit off what the user typed, which for a 6dp asset is a drop and for an 18dp one is nothing,
    // but the same mistake in the other direction overdraws.
    var n = Math.round(Number(v) * Math.pow(10, dp));
    if (!isFinite(n) || n < 0) return null;
    if (n > Number.MAX_SAFE_INTEGER) return null;      // refuse rather than return a plausible wrong number
    return String(n);
  }
  function axFromUnits(u, dp) { return Number(u) / Math.pow(10, dp); }

  // MemoType is the field NAME, MemoData the value, both hex-encoded ASCII. Four memos, and the order
  // does not matter to the validators -- their presence and their exact spelling does.
  //
  // A MALFORMED MEMO IS NOT RECOVERABLE. Axelar's own documentation is explicit: a message with
  // malformed memos never indexes on the GMP API and cannot be retried or refunded, unlike an
  // underfunded one which at least lands as INSUFFICIENT_GAS and can be topped up. That is why this
  // builds the memos in one place and why axCheck() below re-reads them before anything is signed.
  function axMemos(destChainId, destAddr, gasFeeStr) {
    return [
      { Memo: { MemoType: hex('type'), MemoData: hex('interchain_transfer') } },
      { Memo: { MemoType: hex('destination_address'), MemoData: hex(String(destAddr).replace(/^0x/i, '')) } },
      { Memo: { MemoType: hex('destination_chain'), MemoData: hex(destChainId) } },
      { Memo: { MemoType: hex('gas_fee_amount'), MemoData: hex(String(gasFeeStr)) } },
    ];
  }

  // Reads the built transaction back and refuses unless every invariant holds. Deliberately checks the
  // OUTPUT rather than the inputs: the bug worth catching is one where the arithmetic was right and the
  // encoding was not.
  function axCheck(tx, want) {
    var m = tx.Memos || [];
    if (m.length !== 4) return 'expected four memos, built ' + m.length;
    var got = {};
    for (var i = 0; i < m.length; i++) {
      var mm = m[i] && m[i].Memo;
      if (!mm || !/^[0-9A-F]*$/.test(mm.MemoType || '') || !/^[0-9A-F]*$/.test(mm.MemoData || '')) {
        return 'a memo is not upper-case hex';
      }
      got[unhex(mm.MemoType)] = unhex(mm.MemoData);
    }
    if (got.type !== 'interchain_transfer') return 'wrong memo type';
    if (got.destination_chain !== want.chain) return 'destination chain does not match';
    if (got.destination_address !== String(want.addr).replace(/^0x/i, '')) return 'destination address does not match';
    if (got.gas_fee_amount !== String(want.gas)) return 'gas amount does not match';
    // gas_fee_amount must be STRICTLY less than Amount, or nothing is left to deliver.
    var amt = tx.Amount, sent, gas = Number(want.gas);
    if (typeof amt === 'string') { if (!/^[0-9]+$/.test(amt)) return 'XRP amount is not drops'; sent = Number(amt); }
    else if (amt && amt.value) { sent = Number(amt.value) * Math.pow(10, want.dp); gas = Number(want.gas) * Math.pow(10, want.dp); }
    else return 'amount has no recognisable form';
    if (!(gas < sent)) return 'the relay fee is not less than the amount';
    if (tx.Destination !== want.gateway) return 'destination is not the Axelar gateway';
    return '';
  }
  function unhex(h) {
    var s = '';
    for (var i = 0; i + 1 < String(h).length; i += 2) s += String.fromCharCode(parseInt(String(h).substr(i, 2), 16));
    return s;
  }

  // ---- quoting -------------------------------------------------------------------------------------
  // THE DESIGN SHIPS NO AMOUNT FIELD. `.br-amt .v` on the source side is a static <div> reading "100"
  // with "~ $100.00" beneath it -- a mockup number, not a control. There is nothing to wire, and a
  // bridge you cannot type an amount into is not a bridge, so this is one of the few places on this
  // fork where a control has to be ADDED rather than claimed.
  //
  // Added in place, inside the design's own `.v` box and inheriting its font and colour, so the panel
  // keeps its exact shape: an <input> rather than contenteditable, because contenteditable accepts
  // pasted markup, has no inputmode, and gives phones a QWERTY keyboard for a number.
  function amtInput() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var box = side && side.querySelector('.br-amt');
    if (!box) return null;

    // THE LOGO HEALER EATS THE AMOUNT BOX, and this is the one place that can stop it.
    //
    // Measured on the live page 2026-09-29. Type a digit; within half a second the source .br-amt
    // comes back as `data-logo="XRP"` with a base64 XRP mark as its background and ZERO children --
    // the .v, the .usd and the input inside them all replaced. amtInput() then returns null forever,
    // amountXrp() reads 0, and no quote is ever requested: the page sits on "Comparing routes…" with
    // both route cards disabled and nothing in the console. It is a silent, total failure of the
    // send path, and it only appeared once the step-2 redesign gave this box a 12px radius -- the
    // healer repaints any short-text element that looks like a badge.
    //
    // FOUR ESCAPES WERE TESTED AGAINST THE REAL TRIGGER, not reasoned about:
    //     control, nothing                 eaten, input destroyed
    //     data-logo="" + data-logoed="1"   eaten, input destroyed
    //     an inert <img> child             SURVIVES
    // The attribute pair is the obvious fix and it does not work -- it stops the logo ENGINE, not the
    // healer. Only a child the healer refuses to paint over does, which is what ensureDestRow already
    // relies on for the destination row.
    if (!box.querySelector('img.lx-amt-keep')) {
      var keep = document.createElement('img');
      keep.className = 'lx-amt-keep';
      keep.alt = '';
      keep.setAttribute('aria-hidden', 'true');
      keep.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
      box.insertBefore(keep, box.firstChild);
    }
    // SELF-HEALING, because the escape cannot help a box that was eaten before it was applied -- an
    // older cached page, or any future painter that gets there first. Rebuilding is safe: .v and .usd
    // carry no state this file does not rewrite on the next paint anyway.
    var v = box.querySelector('.v');
    if (!v) {
      box.removeAttribute('data-logo');
      box.style.background = '';
      box.style.boxShadow = '';
      v = document.createElement('div'); v.className = 'v';
      var u = document.createElement('div'); u.className = 'usd';
      box.appendChild(v); box.appendChild(u);
    }
    var inp = v.querySelector('.lx-amt-in');
    if (inp) return inp;
    v.textContent = '';                                  // the mocked "100" goes
    inp = document.createElement('input');
    inp.className = 'lx-amt-in';
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.placeholder = '0';
    inp.setAttribute('aria-label', 'Amount of XRP to bridge');
    inp.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;outline:none;'
      + 'padding:0;margin:0;width:100%;min-width:0;appearance:none';
    v.appendChild(inp);
    return inp;
  }
  function amountXrp() {
    var inp = amtInput();
    if (!inp) return 0;
    var n = parseFloat(String(inp.value || '').replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
  }
  // One dot, digits only, and the caret left where the typist put it.
  function cleanAmount(inp) {
    var raw = String(inp.value || '');
    var out = raw.replace(/[^0-9.]/g, '');
    var i = out.indexOf('.');
    if (i >= 0) out = out.slice(0, i + 1) + out.slice(i + 1).replace(/\./g, '');
    if (out !== raw) {
      var at = inp.selectionStart == null ? out.length : inp.selectionStart - (raw.length - out.length);
      inp.value = out;
      try { inp.setSelectionRange(Math.max(0, at), Math.max(0, at)); } catch (e) {}
    }
  }
  // The source USD line, from the price 1Click gives XRP in its own token list -- not a second feed
  // that could disagree with the quote sitting beside it.
  function paintSourceUsd() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var u = side && side.querySelector('.br-amt .usd');
    if (!u) return;
    var amt = amountXrp(), px = ORIGIN && Number(ORIGIN.price);
    u.textContent = (amt && px) ? ('~ $' + fmt(amt * px, 2)) : '';
  }

  // Fee and time, in the review list's OWN row markup (`.r` > `.k` + `.v`) rather than a panel of our
  // own. The design ships four such rows and no slot for either number, and a bridge that does not
  // state its fee before the irreversible step is not one worth shipping.
  function ensureReviewRows() {
    var dst = $('[data-rv="dst"]');
    var host = dst && dst.parentElement && dst.parentElement.parentElement;
    if (!host || host.querySelector('[data-rv="fee"]')) return;
    [['route', 'Route'], ['fee', 'LumosCore fee'], ['eta', 'Estimated time']].forEach(function (p) {
      var r = document.createElement('div');
      r.className = 'r';
      var k = document.createElement('span');
      k.className = 'k';
      k.textContent = p[1];
      var v = document.createElement('span');
      v.className = 'v mono';
      v.setAttribute('data-rv', p[0]);
      v.textContent = '—';
      r.appendChild(k); r.appendChild(v);
      host.appendChild(r);
    });
  }
  function recipient() {
    var i = $('.br-addr-in');
    return i ? String(i.value || '').trim() : '';
  }

  // What actually reaches the deposit address: the amount minus LumosCore's fee. The quote is taken on
  // that figure, so the "You get" number is what the user will really receive rather than a gross
  // amount they then miss the fee out of.
  function netDrops(xrp) {
    var gross = Math.round(Number(xrp) * 1e6);
    var fee = Math.floor(gross * feeRate());
    return { gross: gross, fee: fee, net: gross - fee };
  }

  var qSeq = 0, qTimer = null;
  function requote() {
    clearTimeout(qTimer);
    qTimer = setTimeout(doQuote, 350);
  }
  function doQuote() {
    var key = destChain();
    var routes = routesFor(SRC, key);
    QUOTE = null; THQ = null; AXQ = null; BEST = ''; QUOTING = false;
    NOTE = { ni: '', th: '', ax: '' };
    // A hand-picked route belongs to the destination it was picked on. Moving to another one drops it
    // rather than carrying it somewhere it may not even be offered.
    if (PICKED_FOR !== key) { PICKED = ''; PICKED_FOR = ''; }
    if (!routes.length) { paintQuote(null, ''); return; }
    // Axelar never shares a pair with the others, so when it is the route there is nothing to race.
    if (routes.length === 1 && routes[0] === 'ax') { QUOTING = true; return quoteAx(key); }

    var seq = ++qSeq;
    var jobs = [];
    if (routes.indexOf('ni') >= 0) jobs.push(quoteNi(key, seq));
    if (routes.indexOf('th') >= 0) jobs.push(quoteTh(key, seq));
    if (!jobs.length) { QUOTING = true; return quoteAx(key); }
    QUOTING = true;
    paintQuote(null, jobs.length > 1 ? 'Comparing routes…' : 'Quoting…');
    // allSettled, not all: one route refusing is ordinary -- a dust minimum here, an unsupported
    // recipient there -- and must not cost the user the other route's answer.
    Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); }))
      .then(function () { if (seq === qSeq) settle(); });
  }

  // WHICH ANSWER THE PAGE SHOWS. Compared on the delivered amount, and only when the two are
  // delivering THE SAME THING: NEAR Intents can be asked for any token on a chain, THORChain quotes
  // that chain's native coin, and comparing 30 USDC against 0.0027 ETH is not a comparison. So when
  // the chosen destination asset is not the native one, NEAR Intents is simply the route -- it is the
  // only one that can deliver what was asked for.
  function settle() {
    QUOTING = false;
    var niOut = QUOTE ? Number(QUOTE.amountOutFormatted) : null;
    var thOut = THQ ? (Number(THQ.expected) / (THQ.e8 || 1e8)) : null;
    var sameAsset = QUOTE && THQ && DEST && DEST.token && !DEST.token.contractAddress;
    if (sameAsset) BEST = (thOut > niOut) ? 'th' : 'ni';
    else if (QUOTE) BEST = 'ni';
    else if (THQ) BEST = 'th';
    else BEST = '';
    // A HAND-PICKED ROUTE WINS, but only if it actually answered. Honouring a choice whose quote came
    // back empty would leave the page showing a route it cannot send by, with no figures and a live
    // Bridge button -- worse than quietly falling back to the one that did answer.
    if (PICKED && PICKED_FOR === destChain()) {
      if ((PICKED === 'ni' && QUOTE) || (PICKED === 'th' && THQ) || (PICKED === 'ax' && AXQ)) BEST = PICKED;
    }
    paintQuote(BEST === 'ni' ? QUOTE : null, BEST ? '' : (LAST_NOTE || 'No route for this amount'));
  }

  // Axelar prices the RELAY, not the trade: there is no exchange here, the same asset comes out the
  // other side. So the only unknown is the gas, and what arrives is simply the amount minus it.
  function quoteAx(key) {
    var amt = amountXrp();
    QUOTE = null; AXQ = null;
    // EVERY WAY OUT OF THIS FUNCTION CLEARS `QUOTING`. It has seven of them, and a route left marked
    // as still quoting shows "Quoting…" on its card forever -- which looks like a hung request rather
    // than the refusal it actually is.
    var done = function (note) { QUOTING = false; NOTE.ax = note || ''; paintQuote(null, note || ''); };
    // The id Axelar knows this place by. Everything upstream and every memo uses THIS, never the
    // place key, which exists only to let one option serve both routes.
    var chain = axId(key);
    if (!amt || !SRC || !chain) { done(); return; }
    var to = recipient();
    if (!to) { done('Enter a destination address'); return; }
    var seq = ++qSeq;
    QUOTING = true;
    paintQuote(null, 'Pricing the relay…');
    fetch(API_AX + '?op=gas&symbol=' + encodeURIComponent(SRC.symbol) + '&dest=' + encodeURIComponent(chain))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (seq !== qSeq) return;
        if (!j || !j.ok) { done(String((j && j.error) || 'No relay price for this pair')); return; }
        var dp = SRC.decimals;
        var sent = axUnits(amt, dp);
        if (sent == null) { done('Amount is out of range'); return; }
        var gas = j.gas;
        if (!(Number(gas) < Number(sent))) {
          // Stated as the real reason, with the real number, because "try a larger amount" without one
          // is a guessing game -- the relay fee to Ethereum is over a whole XRP.
          done('Relay fee is ' + fmt(axFromUnits(gas, dp), 6) + ' ' + SRC.symbol + ' — send more');
          return;
        }
        AXQ = { chain: chain, gas: gas, dp: dp, sent: sent,
          delivered: axFromUnits(Number(sent) - Number(gas), dp) };
        // NAMED AS THE ROUTE IN USE. Everything else reads AXQ directly, so BEST was left empty on this
        // path -- which the route panel reads as "no route chosen", leaving the Axelar card unmarked
        // and its figures unrendered on the one route where it is the only option there is.
        BEST = 'ax';
        done('');
      })
      .catch(function () { if (seq === qSeq) done('Relay price unavailable'); });
  }

  // THORChain prices its own swap and, unlike Axelar, BUILDS THE MEMO ITSELF -- the quote carries the
  // exact memo and the inbound address to send to, so this page forwards one rather than composing
  // one. The inbound address rotates as vaults churn, which is why it is taken from the quote every
  // time and never remembered.
  function quoteTh(key, seq) {
    var amt = amountXrp(), to = recipient();
    var p = PLACES[key];
    var asset = p && p.th && TH_NATIVE[p.th];
    if (!amt || !asset || !to) return Promise.resolve();
    var n = netDrops(amt);                       // LumosCore's cut comes off first, as on NEAR Intents
    // THORChain denominates everything in 1e8 regardless of the asset's own precision, so XRP's six
    // decimals still go on the wire as eight. Converted through integers, not a float.
    var e8 = String(Math.round(n.net * 100));    // drops (1e6) -> 1e8
    return fetch(API_TH + '?op=quote&to=' + encodeURIComponent(asset)
      + '&amount=' + e8 + '&destination=' + encodeURIComponent(to))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (seq !== qSeq) return;
        if (j && j.ok) { THQ = j; THQ.asset = asset; THQ.symbol = String(asset).split('.')[1] || asset; }
        else if (j && j.error) { NOTE.th = upstreamNote(String(j.error)); LAST_NOTE = NOTE.th; }
      })
      .catch(function () {});
  }

  function quoteNi(chain, seq) {
    var amt = amountXrp(), me = addr();
    if (!amt || !DEST || !chain) return Promise.resolve();
    var n = netDrops(amt);
    if (n.net < MIN_DROPS) { NOTE.ni = LAST_NOTE = 'Minimum ' + (MIN_DROPS / 1e6) + ' XRP'; return Promise.resolve(); }
    var to = recipient();
    if (!to) { NOTE.ni = LAST_NOTE = 'Enter a destination address'; return Promise.resolve(); }
    return fetch(API + '?op=quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dry: true, originAsset: ORIGIN.assetId, destinationAsset: DEST.token.assetId,
        amount: String(n.net), refundTo: me || undefined, recipient: to
      })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (seq !== qSeq) return;                       // a newer keystroke won
        if (res.s === 201 && res.j && res.j.quote) QUOTE = res.j.quote;
        else {
          NOTE.ni = upstreamNote(String((res.j && (res.j.error || res.j.message)) || 'No route for this amount'));
          LAST_NOTE = NOTE.ni;
        }
      })
      .catch(function () {});
  }

  function paintQuote(q, note) {
    LAST_NOTE = (q || AXQ) ? '' : String(note || '');
    var s2 = $('.br-step[data-step="2"]');
    var dst = s2 && s2.querySelectorAll('.br-side')[1];
    var am = dst && dst.querySelector('.br-amt');
    if (am) {
      var v = am.querySelector('.v'), u = am.querySelector('.usd');
      // On Axelar the same asset comes out the other side, so there is no USD line to show that the
      // quote did not give us -- and inventing one from a price feed is how a page ends up disagreeing
      // with itself. It states the relay fee instead, which is the number that actually changed.
      if (AXQ) {
        if (v) v.textContent = fmt(AXQ.delivered, 6);
        if (u) u.textContent = 'after ' + fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + SRC.symbol + ' relay fee';
      } else if (BEST === 'th' && THQ) {
        // NAMED, because the page has just chosen on the reader's behalf. When both routes answered,
        // saying which one won and that it was the better price is the difference between a decision
        // and a black box.
        if (v) v.textContent = fmt(Number(THQ.expected) / (THQ.e8 || 1e8), 8);
        if (u) u.textContent = 'via THORChain' + (QUOTE ? ' — better price' : '')
          + (THQ.seconds != null ? (' · ~' + THQ.seconds + 's') : '');
      } else {
        if (v) v.textContent = q ? fmt(q.amountOutFormatted, 6) : '—';
        if (u) u.textContent = q ? ('~ $' + fmt(q.amountOutUsd, 2)) : (note || '');
      }
    }
    paintReview(q, note);
    paintRoutePanel();
    setCta();
  }

  function paintReview(q, note) {
    var amt = amountXrp(), n = netDrops(amt);
    var sym = SRC ? SRC.symbol : 'XRP';
    var set = function (sel, txt) { var e = $(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    set('[data-rv="send"]', amt ? (fmt(amt, 6) + ' ' + sym) : ('0 ' + sym));
    if (AXQ) {
      // Same asset in and out; what changes is the amount.
      set('[data-rv="recv"]', fmt(AXQ.delivered, 6) + ' ' + sym);
    } else if (BEST === 'th' && THQ) {
      set('[data-rv="recv"]', fmt(Number(THQ.expected) / (THQ.e8 || 1e8), 8) + ' ' + THQ.symbol);
    } else {
      set('[data-rv="recv"]', q ? (fmt(q.amountOutFormatted, 6) + ' ' + DEST.token.symbol)
        : ('— ' + (DEST && DEST.token ? DEST.token.symbol : '')));
    }
    set('[data-rv="sendnet"]', 'XRP Ledger');
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    set('[data-rv="recvnet"]', (trg && !trg.classList.contains('is-empty') && tn) ? tn.textContent : '—');
    set('[data-rv="src"]', addr() ? short(addr()) : '—');
    set('[data-rv="dst"]', recipient() ? short(recipient()) : '—');
    var f = $('[data-rv="fee"]');
    if (f) {
      if (AXQ) {
        // AXELAR'S RELAY FEE, AND ONLY THAT. LumosCore takes no cut on this route, which is a
        // consequence rather than a gift: the collector holds no trust lines, so it can receive XRP
        // and nothing else, and charging a percentage of a WETH transfer would mean converting it to
        // XRP through a price nobody quoted. Undercharging is our cost; a fabricated conversion rate
        // on a page moving money is not acceptable at any price. Revisit if it ever matters.
        f.textContent = fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + sym + ' relay fee';
      } else {
        f.textContent = amt ? (fmt(n.fee / 1e6, 6) + ' XRP (' + (feeRate() * 100).toFixed(1) + '%)') : '—';
      }
    }
    var t = $('[data-rv="eta"]');
    if (t) {
      t.textContent = AXQ ? 'a few minutes'
        : (BEST === 'th' && THQ && THQ.seconds != null) ? ('~' + THQ.seconds + 's')
        : (q && q.timeEstimate) ? ('~' + q.timeEstimate + 's') : '—';
    }
    // Which route is carrying this, said plainly. Three routes behind one wizard means the page is
    // making a choice, and a reader is entitled to know which.
    var rv = $('[data-rv="route"]');
    if (rv) {
      rv.textContent = AXQ ? 'Axelar' : BEST === 'th' ? 'THORChain'
        : BEST === 'ni' ? 'NEAR Intents' : '—';
    }
  }

  // ---- the ROUTE panel -----------------------------------------------------------------------------
  //
  // The card on the right of step 2: which routes can carry this pair, which one is being used, and
  // what it delivers. _xrplbridgepolish.js ships the panel's markup and styles; the cards are rendered
  // here because this is the only place that knows which routes serve a pair and what each quoted.
  //
  // THE PANEL IS WHERE THE PAGE SHOWS ITS WORKING. Three routes behind one wizard means the page keeps
  // choosing on the reader's behalf, and a chosen route that is never named is a black box asking to
  // be trusted with money. Every candidate is listed, each with its own answer, and the one being
  // used is marked -- so "THORChain, and it pays more" is visible rather than implied.
  var ROUTE_META = {
    ni: { name: 'NEAR Intents', mark: 'nearintents',
      sub: 'Delivers the destination chain’s own token, not a wrapped copy' },
    ax: { name: 'Axelar', mark: 'axelar',
      sub: 'Carries interchain tokens, and is the only way to XRPL EVM' },
    th: { name: 'THORChain', mark: 'thorchain',
      sub: 'Swaps into the destination chain’s native coin' },
  };
  var SICON = {
    recv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    fee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  };
  function esc2(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // What each candidate route currently has to say. Pending is its own state: before the quotes come
  // back every route would otherwise read "no quote for this amount", which is an answer none of them
  // has given yet and reads as a refusal.
  function routeRows() {
    var key = destChain();
    if (!SRC || !key) return [];
    return routesFor(SRC, key).map(function (r) {
      var o = { route: r, meta: ROUTE_META[r], state: 'ok', recv: '', eta: '', error: '' };
      if (r === 'ni') {
        if (QUOTE) {
          o.recv = fmt(QUOTE.amountOutFormatted, 6) + ' ' + ((DEST && DEST.token) ? DEST.token.symbol : '');
          if (QUOTE.timeEstimate != null) o.eta = '~' + QUOTE.timeEstimate + 's';
        } else o.state = QUOTING ? 'wait' : 'none';
      } else if (r === 'th') {
        if (THQ) {
          o.recv = fmt(Number(THQ.expected) / (THQ.e8 || 1e8), 8) + ' ' + THQ.symbol;
          if (THQ.seconds != null) o.eta = '~' + THQ.seconds + 's';
        } else o.state = QUOTING ? 'wait' : 'none';
      } else {
        if (AXQ) { o.recv = fmt(AXQ.delivered, 6) + ' ' + SRC.symbol; o.eta = 'a few minutes'; }
        else o.state = QUOTING ? 'wait' : 'none';
      }
      // ITS OWN ANSWER, never the last one anybody gave.
      if (o.state === 'none') o.error = NOTE[r] || 'No quote for this amount.';
      return o;
    });
  }

  // The fee line, stated per route because the three charge differently and a single figure would be
  // wrong for two of them. LumosCore's own rate is read live so the 250K-LUMOS tier shows 0.1%.
  function routeFee(r) {
    var pct = +(feeRate() * 100).toFixed(2) + '%';
    if (r === 'ax') {
      // No LumosCore cut on this route -- the collector holds no trust lines, so it cannot take a
      // percentage of an issued token. See the note in paintReview.
      return AXQ ? (fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + SRC.symbol + ' relay fee') : 'destination gas';
    }
    if (r === 'th') return pct + ' + THORChain’s swap rate';
    return pct + ' + solver fee';
  }

  function paintRoutePanel() {
    var panel = $('.lx-brroute[data-lxroute]');
    if (!panel) return;
    var host = panel.querySelector('[data-lxroute-opts]');
    var stats = panel.querySelector('[data-lxroute-stats]');
    if (!host || !stats) return;
    var rows = routeRows();
    if (!rows.length) { panel.hidden = true; return; }
    panel.hidden = false;

    var h = '';
    rows.forEach(function (o) {
      var sel = o.route === BEST;
      var dis = o.state === 'none';
      h += '<button type="button" class="lx-brr" data-lxroutepick="' + o.route + '"'
        + (dis ? ' disabled' : '') + ' aria-pressed="' + (sel ? 'true' : 'false') + '">'
        + '<div class="lx-brr-top">'
        + '<span class="lx-brr-mark" data-logo="" data-logoed="1">'
        + '<img src="/assets/networks/' + o.meta.mark + '.png?v=' + ICONV + '" alt=""></span>'
        + '<span class="lx-brr-hd"><span class="lx-brr-nm" data-logoed="1">' + esc2(o.meta.name) + '</span>'
        + '<span class="lx-brr-sub">' + esc2(o.meta.sub) + '</span></span>';
      // The tag names WHY this one, and only where that is a fact rather than a slogan: it appears on
      // the chosen route when a rival actually answered too, so "BEST PRICE" always means it beat
      // something. A badge on a route that was the only option would be marketing.
      if (sel && rows.length > 1 && rows.filter(function (x) { return x.state === 'ok'; }).length > 1) {
        h += '<span class="lx-brr-tag">Best price</span>';
      } else if (sel) {
        h += '<span class="lx-brr-tag">In use</span>';
      }
      h += '</div>';
      if (o.state === 'none') h += '<div class="lx-brs-note" style="margin-top:0;padding-top:0">' + esc2(o.error) + '</div>';
      else if (o.state === 'wait') h += '<span class="lx-brr-soon">Quoting…</span>';
      h += '<' + '/button>';
    });
    if (host.innerHTML !== h) host.innerHTML = h;

    var cur = rows.filter(function (x) { return x.route === BEST; })[0];
    var sh = '';
    if (cur && cur.state === 'ok') {
      var row = function (ic, k, v) {
        return '<div class="lx-brs-row"><span class="lx-brs-ic">' + SICON[ic] + '</span>'
          + '<span class="lx-brs-k">' + k + '</span><span class="lx-brs-v">' + esc2(v) + '</span></div>';
      };
      sh = row('recv', 'Receive', cur.recv || '—')
        + row('fee', 'Bridge fee', routeFee(cur.route))
        + row('time', 'Estimated time', cur.eta || '—')
        + '<div class="lx-brs-note">Delivered straight to the address you gave — there is nothing to '
        + 'claim on the other side.</div>';
    }
    if (stats.innerHTML !== sh) stats.innerHTML = sh;
    stats.hidden = !sh;
  }

  // CHOOSING A ROUTE BY HAND. The page picks the better price, and the reader is allowed to disagree
  // -- speed, a wallet that already knows one bridge, or simple preference. The choice is remembered
  // only for the destination it was made on, because "I want THORChain" cannot mean anything on a
  // chain THORChain does not serve, and a preference that silently survives a change of destination
  // is how a page ends up using a route the reader never chose for a pair they never saw.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-lxroutepick]');
    if (!b || b.disabled) return;
    e.preventDefault(); e.stopPropagation();
    var r = b.getAttribute('data-lxroutepick');
    var key = destChain();
    if (!r || !key || routesFor(SRC, key).indexOf(r) < 0) return;
    PICKED_FOR = key; PICKED = r;
    BEST = r;
    paintQuote(BEST === 'ni' ? QUOTE : null, '');
  }, true);

  function paintSteps() {
    var s2 = $('.br-step[data-step="2"]');
    if (s2) {
      var sides = s2.querySelectorAll('.br-side'), src = sides[0], dst = sides[1];
      if (src) {
        // NOT '.br-amtrow .bal'. The step-2 layer moves this node into the amount box, where the
        // reference design puts it, and a selector pinned to where it used to live simply stopped
        // finding it -- balance and MAX both gone, with no error.
        var bal = src.querySelector('.bal');
        if (bal) {
          var mx = bal.querySelector('.max');
          // The balance of whatever is SELECTED, not always XRP -- the source can now be any ITS
          // asset the wallet holds.
          var sb = SRC ? SRC.balance : XRP_SPEND;
          var ssym = SRC ? SRC.symbol : 'XRP';
          var have = sb != null && sb >= 0;
          var txt = 'Balance: ' + (have ? fmt(sb, 6) + ' ' + ssym : '—') + ' ';
          [].slice.call(bal.childNodes).forEach(function (nd) { if (nd.nodeType === 3) bal.removeChild(nd); });
          bal.insertBefore(document.createTextNode(txt), bal.firstChild);
          if (mx) {
            mx.removeAttribute('data-logo'); mx.removeAttribute('style');
            mx.setAttribute('data-logoed', '1');
            if (mx.textContent !== 'MAX') mx.textContent = 'MAX';
          }
        }
        paintSourceAsset();
        amtInput();
        paintSourceUsd();
      }
      if (dst) paintDestAsset(dst);
    }
    ensureReviewRows();
    paintReview(QUOTE, '');
    setCta();
  }

  // ---- the terminal action -------------------------------------------------------------------------
  // The layer this replaces disabled this button permanently and said "Transfers not enabled yet". It
  // now does the thing, and refuses for a STATED reason when it cannot.
  // MARKED ON FIRST SIGHT, then found by the mark. It used to be found by its TEXT -- and setCta
  // rewrites that text, so the moment the label became "Choose a destination" the selector matched
  // nothing, ctaButton() returned null, and the button was never updated again. Everything behind it
  // worked: the quote landed, the fee and the time were right, and the button sat on the first reason
  // it had ever had. A lookup keyed on a value you then mutate finds its target exactly once.
  function ctaButton() {
    var marked = $('[data-lxni-cta]');
    if (marked) return marked;
    var b = $$('.br-next').filter(function (x) {
      return /^\s*(confirm|bridge|swap|transfers not)/i.test(x.textContent || '');
    })[0];
    if (b) b.setAttribute('data-lxni-cta', '1');
    return b || null;
  }
  // Ordered the way the form is filled, not the way the checks happen to be written: the amount is the
  // first thing touched, so "Minimum 2 XRP" has to be reachable while the address is still empty. The
  // first version asked for the address first and the minimum could never be seen at all.
  function blockReason() {
    if (!addr()) return 'Connect a wallet';
    if (window.lxc && !window.lxc.canSign()) return 'This wallet cannot sign';
    var chain = destChain();
    if (!chain) return 'Choose a destination';
    var routes = routesFor(SRC, chain);
    if (!routes.length) return (SRC ? SRC.symbol : 'This asset') + ' cannot reach ' + placeLabel(chain);
    var route = routes[0];
    if (routes.indexOf('ni') >= 0 && !DEST && routes.length === 1) return 'Choose a destination asset';
    var amt = amountXrp();
    if (!amt) return 'Enter an amount';
    // The 2 XRP floor is 1Click's, so it applies only when NEAR Intents is the ONLY route. THORChain
    // has its own dust threshold and reports it in words, and Axelar's floor is simply covering the
    // relay fee -- so a pair another route could carry must not be blocked by a minimum that is not
    // its own.
    if (routes.length === 1 && route === 'ni' && netDrops(amt).net < MIN_DROPS) {
      return 'Minimum ' + (MIN_DROPS / 1e6) + ' XRP';
    }
    if (SRC && SRC.balance != null && amt > SRC.balance) return 'More than your ' + SRC.symbol + ' balance';
    if (!recipient()) return 'Enter a destination address';
    // THE REAL REASON, not a generic wait. A recipient the destination chain would reject is refused
    // by the proxy with "recipient does not look like a base address" -- and the first version threw
    // that away and left the button reading "Waiting for a quote", which describes a network delay
    // rather than something the user can act on.
    if (!(AXQ || QUOTE || THQ)) return LAST_NOTE || 'Waiting for a quote';
    return '';
  }
  function setCta() {
    var b = ctaButton();
    if (!b || busy) return;
    var why = blockReason();
    b.textContent = why || ('Bridge ' + fmt(amountXrp(), 6) + ' XRP');
    if (why) {
      b.setAttribute('disabled', 'disabled');
      b.setAttribute('aria-disabled', 'true');
      b.style.opacity = '.55';
      b.style.pointerEvents = 'none';
    } else {
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.opacity = '';
      b.style.pointerEvents = '';
    }
  }

  function say(msg) {
    var b = ctaButton();
    if (b) b.textContent = msg;
  }

  // An integer of smallest units back to an exact decimal string, WITHOUT going through a float.
  // 813066381885034 units of an 18-decimal token is 0.000813066381885034, and dividing by 1e18 to get
  // there is how a value picks up a rounding error on the way into a transaction. String arithmetic
  // cannot do that.
  function unitsToDecimal(u, dp) {
    var s = String(u).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!dp) return s || '0';
    while (s.length <= dp) s = '0' + s;
    var whole = s.slice(0, s.length - dp);
    var frac = s.slice(s.length - dp).replace(/0+$/, '');
    return frac ? (whole + '.' + frac) : whole;
  }
  // The raw text the user typed, not a float round-trip, for the same reason.
  function typedRaw() {
    var inp = amtInput();
    return inp ? String(inp.value || '').replace(/[^0-9.]/g, '') : '';
  }

  function sendAx() {
    var me = addr(), to = recipient();
    if (!AXQ || !SRC || !AX) { busy = false; setCta(); return; }
    // Taken from the QUOTE, not re-derived from the page. The quote is what priced this exact pair,
    // and re-reading the dropdown here would let a destination changed mid-flight be signed against a
    // relay fee quoted for somewhere else.
    var chain = AXQ.chain;
    var dp = SRC.decimals, gasUnits = AXQ.gas;

    // THE AMOUNT IS THE TOTAL THAT LEAVES. The validators split it: transfer_amount = Amount -
    // gas_fee_amount. So the user's figure goes in whole and the relay takes its share out of it,
    // which is what the page has been showing them.
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: AX.gateway,
      Amount: SRC.native ? axUnits(typedRaw(), 6)
        : { currency: SRC.currency, issuer: SRC.issuer, value: typedRaw() },
      Memos: axMemos(chain, to, SRC.native ? gasUnits : unitsToDecimal(gasUnits, dp)),
    };

    // READ BACK BEFORE SIGNING. A malformed memo here is not a failed transfer, it is a lost one --
    // Axelar's own docs say such a message never indexes and cannot be recovered, unlike an
    // underfunded one which lands as INSUFFICIENT_GAS and can be topped up. So the built transaction
    // is re-parsed and every invariant re-checked against what was intended, and anything short of
    // agreement stops here rather than at the ledger.
    var bad = axCheck(tx, { chain: chain, addr: to, gateway: AX.gateway, dp: dp,
      gas: SRC.native ? gasUnits : unitsToDecimal(gasUnits, dp) });
    if (bad) { busy = false; say('Not sent — ' + bad); setTimeout(setCta, 5000); return; }

    say('Confirm the transfer in your wallet…');
    window.lxc.submit(tx)
      .then(function (hash) {
        try {
          var k = 'lumos.ax.txs';
          var list = JSON.parse(localStorage.getItem(k) || '[]');
          list.unshift({ at: Date.now(), hash: hash, route: 'axelar', chain: chain,
            sym: SRC.symbol, sent: typedRaw(), delivered: AXQ.delivered, to: to });
          localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
        } catch (e) {}
        say('Sent — Axelar is relaying it');
        busy = false;
        setTimeout(setCta, 8000);
      })
      .catch(function (e) {
        busy = false;
        say(String((e && e.message) || 'Transfer failed'));
        setTimeout(function () { busy = false; setCta(); }, 4000);
      });
  }

  // THORChain: one Payment to the vault the quote named, carrying the memo the quote built.
  //
  // NOTHING IS COMPOSED HERE. Axelar's route hand-builds four memos and has to check them because a
  // malformed one loses the transfer; THORChain hands back the exact memo string and the inbound
  // address, so the only job is to carry them across unchanged. The address is taken from THQ and
  // never from anything remembered -- THORChain rotates vaults, and sending to yesterday's is sending
  // to nobody.
  function sendTh() {
    var me = addr(), amt = amountXrp(), n = netDrops(amt);
    if (!THQ || !THQ.inbound || !THQ.memo) { busy = false; setCta(); return; }
    say('Confirm the transfer in your wallet…');
    window.lxc.submit({
      TransactionType: 'Payment', Account: me, Destination: THQ.inbound,
      Amount: String(n.net),
      Memos: [{ Memo: { MemoData: hex(THQ.memo) } }],
    }).then(function (hash) {
      try {
        var k = 'lumos.th.txs';
        var list = JSON.parse(localStorage.getItem(k) || '[]');
        list.unshift({ at: Date.now(), hash: hash, route: 'thorchain', asset: THQ.asset,
          sent: amt, expected: Number(THQ.expected) / (THQ.e8 || 1e8), to: recipient() });
        localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
      } catch (e) {}
      say('Sent — THORChain is swapping it');
      busy = false;
      setTimeout(setCta, 8000);
      // The fee is second here too, and its failure is ours.
      if (n.fee > 0) {
        window.lxc.submit({
          TransactionType: 'Payment', Account: me, Destination: COLLECTOR, Amount: String(n.fee),
          Memos: [{ Memo: { MemoData: hex('lx:th') } }],
        }).catch(function () {});
      }
    }).catch(function (e) {
      busy = false;
      say(String((e && e.message) || 'Transfer failed'));
      setTimeout(function () { busy = false; setCta(); }, 4000);
    });
  }

  function send() {
    if (busy) return;
    var why = blockReason();
    if (why) return;
    busy = true;
    var b0 = ctaButton();
    if (b0) { b0.style.pointerEvents = 'none'; b0.style.opacity = '.7'; }
    // Whichever route the page SHOWED is the one it sends by. Re-deriving it here could send by a
    // route the user was never quoted.
    if (AXQ) return sendAx();
    if (BEST === 'th') return sendTh();
    var amt = amountXrp(), n = netDrops(amt), me = addr();
    var b = ctaButton();
    if (b) { b.style.pointerEvents = 'none'; b.style.opacity = '.7'; }
    say('Getting a firm quote…');

    // A LIVE quote, not the dry one on screen. The dry quote has no deposit address — it exists to
    // price the trade — and prices move, so the address and the amount must come from the same call.
    fetch(API + '?op=quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dry: false, originAsset: ORIGIN.assetId, destinationAsset: DEST.token.assetId,
        amount: String(n.net), refundTo: me, recipient: recipient()
      })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        var q = res.j && res.j.quote;
        if (res.s !== 201 || !q || !q.depositAddress) {
          throw new Error(String((res.j && (res.j.error || res.j.message)) || 'Could not get a quote'));
        }
        say('Confirm the transfer in your wallet…');
        // ONE ordinary Payment. No memo, no destination tag: SIMPLE deposit mode gives this quote its
        // own address, which is what identifies it.
        return window.lxc.submit({
          TransactionType: 'Payment', Account: me,
          Destination: q.depositAddress, Amount: String(n.net)
        }).then(function (hash) { return { q: q, hash: hash }; });
      })
      .then(function (r) {
        // Tell 1Click the deposit exists rather than waiting for them to notice it. Best effort: the
        // transfer proceeds either way, this only shortens the wait.
        fetch(API + '?op=submit', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txHash: r.hash, depositAddress: r.q.depositAddress })
        }).catch(function () {});
        record(r);
        say('Sent — confirming…');
        poll(r.q.depositAddress, 0);
        // THE FEE IS SECOND, AND ITS FAILURE IS OURS. If this is declined the user's transfer has
        // already gone; nothing is retried and nothing is said, because from their side the thing
        // they asked for happened.
        var fee = n.fee;
        if (fee > 0) {
          window.lxc.submit({
            TransactionType: 'Payment', Account: me, Destination: COLLECTOR, Amount: String(fee),
            Memos: [{ Memo: { MemoData: hex('lx:ni') } }]
          }).catch(function () {});
        }
      })
      .catch(function (e) {
        busy = false;
        say(String((e && e.message) || 'Transfer failed'));
        setTimeout(function () { busy = false; setCta(); }, 4000);
      });
  }

  function hex(s) {
    var o = '';
    for (var i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).padStart(2, '0');
    return o.toUpperCase();
  }

  // Per-browser record of what this device sent, so a refresh does not lose the transfer. The shared
  // cross-device history the Stellar build has lives in /lxapi/bridgetx and needs a KV binding this
  // project does not have yet; until then this is honest about being local.
  function record(r) {
    try {
      var k = 'lumos.ni.txs';
      var list = JSON.parse(localStorage.getItem(k) || '[]');
      list.unshift({ at: Date.now(), hash: r.hash, dep: r.q.depositAddress,
        inAmt: r.q.amountInFormatted, out: r.q.amountOutFormatted,
        sym: DEST.token.symbol, chain: DEST.chain, status: 'PENDING_DEPOSIT' });
      localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
  }

  function poll(dep, tries) {
    if (tries > 40) { busy = false; setCta(); return; }
    fetch(API + '?op=status&depositAddress=' + encodeURIComponent(dep))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var st = j && j.status;
        if (st === 'SUCCESS') { say('Delivered'); mark(dep, st); busy = false; setTimeout(setCta, 5000); return; }
        if (st === 'REFUNDED' || st === 'FAILED') { say(st === 'REFUNDED' ? 'Refunded' : 'Failed'); mark(dep, st); busy = false; setTimeout(setCta, 5000); return; }
        say(st === 'PROCESSING' ? 'Processing…' : 'Confirming…');
        setTimeout(function () { poll(dep, tries + 1); }, 4000);
      })
      .catch(function () { setTimeout(function () { poll(dep, tries + 1); }, 6000); });
  }
  function mark(dep, st) {
    try {
      var k = 'lumos.ni.txs';
      var list = JSON.parse(localStorage.getItem(k) || '[]');
      for (var i = 0; i < list.length; i++) if (list[i].dep === dep) list[i].status = st;
      localStorage.setItem(k, JSON.stringify(list));
    } catch (e) {}
  }

  // ---- boot ----------------------------------------------------------------------------------------
  // Names the routes the page can actually serve right now, not the two it was built for -- if one
  // registry is down the title should not promise it.
  function title(n) {
    try {
      var via = [];
      if (ORIGIN) via.push('NEAR Intents');
      if (AX) via.push('Axelar');
      if (TH) via.push('THORChain');
      var list = via.length > 1
        ? via.slice(0, -1).join(', ') + ' and ' + via[via.length - 1]
        : via.join('');
      document.title = 'Bridge from the XRP Ledger'
        + (n ? (' — ' + n + ' networks via ' + list) : '') + ' | LumosCore';
    } catch (e) {}
  }

  function load() {
    if (!$('.br-netbox') && !document.getElementById('lxBrPending')) return;   // not this page
    paintSource();
    // The network chips are hidden until html.lx-chainready and the only thing adding it was a 3s
    // fallback timer. The source is painted, so the gate comes down now.
    try { document.documentElement.classList.add('lx-chainready'); } catch (e) {}
    loadSpendable().then(paintSteps);

    if (!window.__lxxNiWired) {
      window.__lxxNiWired = 1;
      window.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        // The terminal button is identified by its MARK, not its label, for the same reason
        // ctaButton() is: the label is ours to rewrite and changes several times per session.
        var hit = t.closest('[data-lxni-cta]');
        if (hit && !blockReason()) { e.preventDefault(); e.stopPropagation(); send(); return; }

        // An appended destination. Handled here because the design's own listener is bound to the
        // options it shipped and a clone inherits none of it.
        var added = t.closest('.brd-opt[data-lxadded]');
        if (added) { e.preventDefault(); e.stopPropagation(); selectChain(added); return; }
        if (t.closest('.brd-opt, .br-step, .brd, .br-back')) {
          setTimeout(function () { QUOTE = null; paintSteps(); requote(); }, 30);
          setTimeout(paintSteps, 250);
        }
        // MAX fills the field with what is actually spendable, less a small buffer: this route signs
        // TWO transactions and each burns a network fee, so an amount equal to the whole spendable
        // balance leaves nothing to pay for the second one.
        if (t.closest('.max')) {
          e.preventDefault(); e.stopPropagation();
          var inp = amtInput();
          if (inp && XRP_SPEND != null) {
            inp.value = String(Math.max(0, Math.floor((XRP_SPEND - 0.001) * 1e6) / 1e6));
            QUOTE = null; paintSourceUsd(); paintReview(null, ''); setCta(); requote();
          }
          return;
        }
      }, true);
      window.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('lx-amt-in')) {
          cleanAmount(t);
          QUOTE = null; paintSourceUsd(); paintReview(null, ''); setCta(); requote();
          return;
        }
        if (t.classList.contains('br-addr-in')) {
          QUOTE = null; paintReview(null, ''); setCta(); requote();
        }
      }, true);
    }

    // Before anything is fetched: the artwork is shipped, so the marks can be right on the first
    // paint rather than after two registries have answered.
    paintOptionCss();

    // BOTH REGISTRIES, and the page waits for both before deciding what it offers. Settling them
    // separately would paint a destination list from one route and then rebuild it when the other
    // arrived, which is a visible flicker and, worse, a window in which a user can pick a chain that
    // is about to disappear.
    Promise.all([
      fetch(API + '?op=tokens').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch(API_AX + '?op=assets').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch(API_TH + '?op=pools').then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (res) {
      var d = res[0], a = res[1], t = res[2];
      if (d && d.ok && Array.isArray(d.tokens)) {
        TOKENS = d.tokens; NATIVES = d.natives || {}; KEYED = !!d.keyed;
        BY_CHAIN = {};
        TOKENS.forEach(function (t) { (BY_CHAIN[t.blockchain] = BY_CHAIN[t.blockchain] || []).push(t); });
        ORIGIN = (BY_CHAIN.xrp || [])[0] || null;
        delete BY_CHAIN.xrp;                      // never a destination
      }
      if (a && a.ok && Array.isArray(a.assets)) {
        AX = a;
        AX_BY_SYM = {};
        a.assets.forEach(function (x) { AX_BY_SYM[x.symbol] = x; });
      }
      if (t && t.ok && Array.isArray(t.pools) && t.xrpTradeable) { TH = t; buildThNative(); }
      // ANY ONE route alone is a usable page. All three down is not.
      if (!ORIGIN && !AX && !TH) { say('Routes unavailable — try again shortly'); return; }
      window.__lxxNiChains = Object.keys(BY_CHAIN).filter(function (c) { return NI_CHAIN[c]; });
      window.__lxxAxAssets = AX ? AX.assets.map(function (x) { return x.symbol; }) : [];
      window.__lxxThChains = Object.keys(TH_NATIVE);
      return loadHoldings().then(function () {
        // SOURCE FIRST, THEN DESTINATIONS. The destination list is a function of the chosen source, so
        // building it before SRC has been rebound against the freshly-loaded registries shows the list
        // for whatever SRC was left holding -- which, on first load, is a source that knew nothing
        // about Axelar.
        paintSourceAsset();
        title(wireDestinations());
        paintSteps();
        setCta();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxNiReload = load;
})();
