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

  var API = '/lxapi/xrploneclick';
  var API_AX = '/lxapi/xrplaxelar';
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
  // MUST MATCH the CHAINS map in functions/lxapi/xrploneclick.js. _xrplnearintents.js fails the build when
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
  // WHICH THORCHAIN CHAINS ARE PAUSED, or null when the endpoint could not tell us (RAZA 2026-10-23:
  // "As soon as i pasted in the solana address, thorchain automatically got deselected and Near
  // intents got selected").
  //
  // It had not deselected anything. THORChain's SOL pool is `Available` with real depth, so the route
  // was offered -- and SOL trading is HALTED, which only the quote could reveal. This route's quote
  // needs a destination address, because THORChain builds the memo itself; so the refusal could not
  // arrive until the address did, and the page withdrew an offer it should never have made. Measured
  // the same day: SOL, GAIA and ZEC all halted, BTC quoting fine.
  //
  // null is "we do not know", never "nothing is halted" -- see the note on the endpoint. A route is
  // refused only when the list exists and names its chain.
  var TH_HALT = null;
  var THQ = null;                   // the THORChain quote for the current pair
  var BEST = '';                    // which route the page is currently showing: ni | th | ax
  var QUOTING = false;              // a quote is in flight -- distinct from having been refused one
  var PICKED = '';                  // a route the reader chose by hand, overriding the better price
  var PICKED_FOR = '';              // the destination it was chosen ON; it means nothing anywhere else

  var AX = null;                    // {gateway, assets[], destinations[]}
  var AX_BY_SYM = {};
  var HOLD = {};                    // currency|issuer -> balance the wallet actually holds
  var LINES = [];                   // every funded trust line, so the picker can name what it cannot carry
  var SRC = null;                   // the chosen source asset (XRP or an ITS IOU)
  var DEST = null;                  // {chain, token}  (token is the NI token, or null on Axelar)
  var AXQ = null;                   // the Axelar gas estimate for the current pair
  var QUOTE = null;                 // the last live dry quote
  var LAST_NOTE = '';               // why there is no quote, in words the user can act on

  // WITHDRAWING A REFUSING ROUTE'S CARD WAS TRIED HERE, AND REVERTED 2026-10-19, the same day and for
  // the same reason as the Stellar half in _lzusdt0.js. RAZA asked why a route that cannot serve a pair
  // is offered at all; a learned, TTL'd suppression answered that literally, and on the page it read as
  // the route having been removed from the product ("you've entirely removed NEAR Intents"). Telling
  // someone a route is gone is worse than telling them one pair cannot be priced today. This file
  // already had the better answer -- data-lxnoquote keeps the card visible, selectable and explaining
  // itself -- and it stays.
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
    if (/internal server error|bad gateway|service unavailable|gateway time|^\s*5\d\d\s*$/i.test(msg)) {
      return 'Not answering right now — another route may still carry this.';
    }
    // THORChain appends its API's own verdict to a refusal that already said everything: "amount less
    // than dust threshold: invalid request". The first half is the reason and belongs on the card; the
    // second is machine talk that reads as a fault in this page rather than a refusal from theirs.
    // Only that exact tail is cut, and the sentence is left otherwise in their words.
    var s = String(msg || '').replace(/\s*:\s*invalid request\s*$/i, '');
    // RAW BACKEND TEXT IS NOT A MESSAGE (bug X12, 2026-11-19): THORChain's refusal reached the card as "Failed to simulate
    // swap: failed to validate message: swap destination address is not the same chain as the target asset: unknown
    // request [LGox6RdvqniK/errors.go:151]". The refusal a reader can act on is said plainly; the plumbing is cut.
    if (/not the same chain as the target asset/i.test(s)) return 'The receiving address isn’t on the destination network.';
    s = s.replace(/^\s*failed to simulate swap:\s*/i, '').replace(/^\s*failed to validate message:\s*/i, '').replace(/\s*\[[^\]]*\.go:\d+\]\s*$/, '').replace(/:\s*unknown request\s*$/i, '');
    return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s;
  }
  var XRP_SPEND = null;
  // '' while the figure is simply not in yet; a short sentence once a read has actually FAILED. The
  // two are different states and a bare dash was being used for both.
  var XRP_SPEND_ERR = '';
  var busy = false;

  function addr() { try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; } }
  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function feeRate() { return typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002; }
  // THE FIGURE SOMEONE HAS TO TYPE, which is not the floor itself.
  //
  // 1Click's floor applies to what REACHES 1Click, and what reaches them is the amount minus
  // LumosCore's fee -- netDrops() takes the cut first and the check is made on `net`. So "Minimum
  // 2 XRP" was advice that does not work: enter exactly 2 and net is 1.996, which is refused, with the
  // page still insisting 2 is the minimum. Verified against the upstream rather than reasoned about:
  // a dry quote at 2,000,000 drops is accepted ("3.7339522 APT") and anything below is refused with
  // "Amount is too low for bridge, try at least 2000000" -- their words and their number, so the floor
  // is theirs and this is purely about stating it in the units the input is in.
  function minSendXrp() {
    var r = feeRate();
    if (!(r >= 0 && r < 1)) r = 0;
    return Math.ceil(MIN_DROPS / (1 - r)) / 1e6;
  }
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
  // This resolved every mark at runtime through `/lxapi/xrploneclick?op=logo` -> CoinGecko, which is the
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
    'XRPL EVM': 'xrpl', 'XRP Ledger': 'xrpl',
    // THE ARTWORK WAS ALREADY SHIPPED FOR THESE; only the mapping was missing, so they fell through
    // to letter discs in the list AND on the chip. (RAZA 2026-10-01: "some logos on cross chain step 1
    // are still breaking like Linea and world chain".) Checked against the live dropdown rather than
    // guessed: of the 28 destinations offered, exactly these had no network image resolving, and a
    // file for each was already sitting in assets/networks.
    // zkSync Era is the one genuine gap — there is no zksync file shipped, so it keeps its letters
    // until artwork exists. Mapping it to a name with no file would emit a rule pointing at a 404.
    Linea: 'linea', Mantle: 'mantle', Sei: 'sei', 'World Chain': 'worldchain',
    // The one network that had no artwork in the build at all. Fetched from CoinGecko's own record for
    // ZKsync (coins/zksync -> ZKTokenBlack.png, 250x246) and placed in BOTH assets/networks and
    // dist/assets/networks — the build does not copy new files into dist, so one placed only in the
    // source tree passes build and predeploy and still 404s on the page.
    // It is a filled black disc with white arrows, not a transparent black glyph, so it reads on the
    // dark surface the same way the XRP Ledger's own near-black mark already does.
    'zkSync Era': 'zksync'
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
        // AND THE CLOSED CHIP, by the same rule. Painting the option was never the hard half: the
        // artwork lives in THIS stylesheet, so the moment a network is chosen, every path that builds
        // the chip by copying the option's inline style or its <img> finds nothing and falls through
        // to a letter disc -- the design's own dropdown handler rebuilds the chip that way, and it
        // runs whether or not selectChain does. RAZA 2026-10-01: "logos is breaking after selecting,
        // appears fine in the dropdown."
        // Keyed on an attribute and marked !important so it survives the innerHTML being rebuilt by
        // code this layer does not own; the child rule blanks whatever letter mark was put inside.
        css += '.brd-trigger[data-net="' + n + '"] .br-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}'
          + '.brd-trigger[data-net="' + n + '"] .br-ic>*{display:none !important}';
        // AND THE RECEIVING ADDRESS ROW on step 2. That row is the design's own markup and this layer
        // never builds it, so it keeps the hardcoded XRP mark it shipped with — the SOURCE network's
        // logo sitting beside the DESTINATION address. (RAZA 2026-10-01: "network logo in TO is
        // missing".) Keyed on the root element so it holds regardless of when that row is rendered or
        // rebuilt, and the child rule blanks the inline SVG underneath.
        css += '[data-destnet="' + n + '"] .br-wallet.brw-in .br-ic{background:url(' + u + ') center/cover no-repeat !important;'
          + 'color:transparent !important}'
          + '[data-destnet="' + n + '"] .br-wallet.brw-in .br-ic>*{display:none !important}';
        // AND THE "To" PILL, which is a different node again — I fixed the receiving-address row first
        // and RAZA came straight back with "TO Network logo is still missing on Cross-chain step 2. in
        // this case, BASE logo", because the pill beside the word To is .lx-s2pill > .lx-s2ic and had
        // been left empty. The FROM pill shares the class, so the button is the discriminator: the
        // destination pill is a <button> (it opens the chooser), the source one is a plain <span>.
        css += '[data-destnet="' + n + '"] button.lx-s2pill .lx-s2ic{background:url(' + u + ') center/cover no-repeat !important}'
          + '[data-destnet="' + n + '"] button.lx-s2pill .lx-s2ic>*{display:none !important}';
      });
      if (NET_HAVE.xrpl) {
        css += '.br-netbox .br-net[data-lxsrc] .br-ic,.br-step[data-step="1"] .br-side:first-child .br-ic'
          + '{background:url(/assets/networks/xrpl.png?v=' + ICONV + ') center/cover no-repeat !important;'
          + 'color:transparent !important}';
      }
      // EVERY option, not just the ones this layer added. selectChain() is reached only from the
      // handler for added options, so the design's own eighteen -- Base and Avalanche among them --
      // never passed through it and never got stamped. Bound on window in the CAPTURE phase so the
      // stamp lands before the design's own handler rebuilds the chip, and left deliberately dumb: it
      // sets an attribute and nothing else, so it cannot interfere with whatever handles the click.
      // Typing the address has to re-open the gate. paintSteps() runs on the things this layer drives
      // — asset, amount, destination — but the address field is the design's own input and nothing
      // here was listening to it, so the button would have stayed dead after the last box was filled.
      // THE PASTE BUTTON IS THE DESIGN'S, AND NOTHING IS BEHIND IT (RAZA 2026-10-02: "Not being able to
      // paste in the address. Neither manually nor through the paste button.")
      //
      // Measured on the deployed page: .br-paste exists, clicking it throws nothing, shows nothing and
      // leaves the field empty, and no layer in this repo binds it — the only clipboard code here is the
      // wallet's Send row in browser/write.js. It is the design's own control with a mock behind it,
      // like the rest of this page's furniture.
      //
      // Wired the same way Send already is, including the fallback line: readText() is permissioned, and
      // a browser that refuses must say so rather than leave a button that looks broken. Bound on window
      // in the capture phase for the reason every control on these pages is — the inherited layer claims
      // clicks first otherwise.
      if (!window.__lxxBrPaste) {
        window.__lxxBrPaste = 1;
        window.addEventListener('click', function (e) {
          var t = e.target;
          var b = t && t.closest ? t.closest('.br-paste') : null;
          if (!b) return;
          e.preventDefault();
          e.stopPropagation();
          var inp = document.querySelector('.br-addr-in');
          if (!inp) return;
          function put(v) {
            v = String(v || '').trim();
            if (!v) return;
            inp.value = v;
            // The gate watches input events, not the value, so this has to announce itself or the
            // Review button stays dead after a successful paste.
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (!navigator.clipboard || !navigator.clipboard.readText) {
            inp.focus();
            return;
          }
          navigator.clipboard.readText().then(put).catch(function () {
            // Denied or empty: focus the field so Ctrl+V still gets them there in one step.
            inp.focus();
          });
        }, true);
      }

      if (!window.__lxxAddrWatch) {
        window.__lxxAddrWatch = 1;
        ['input', 'change', 'paste'].forEach(function (ev) {
          document.addEventListener(ev, function (e) {
            var t = e.target;
            if (!t || !t.classList || !t.classList.contains('br-addr-in')) return;
            // paste fires BEFORE the value lands, so re-read on the next turn rather than this one.
            setTimeout(function () { try { gateReview(); } catch (_) {} }, 0);
          }, true);
        });
      }

      if (!window.__lxxNetStamp) {
        window.__lxxNetStamp = 1;
        window.addEventListener('click', function (e) {
          var o = e.target && e.target.closest ? e.target.closest('.brd-opt') : null;
          if (!o) return;
          var n = o.getAttribute('data-net');
          var trg = document.querySelector('.brd-trigger');
          if (n && trg) trg.setAttribute('data-net', n);
          if (n) document.documentElement.setAttribute('data-destnet', n);
        }, true);
      }

      // NOTHING IS OFFERED UNTIL IT HAS BEEN CHECKED FOR A ROUTE.
      //
      // The design ships its own eighteen destination options and shows eight of them immediately. The
      // real list — which chains this source can actually reach — only replaces it once the token list
      // has loaded, and that measured at ~3.0s on staging. For those three seconds the picker offered
      // the design's placeholders, LINEA AMONG THEM, and Linea has no route from the XRP Ledger at all.
      //
      // RAZA picked one inside that window and got "Linea / LTC": no place mapping, so the asset slot
      // kept the design's own default, which is Litecoin. The destination filter was never broken —
      // measured after load it hides Linea correctly and shows 39 of 44 — it just had not run yet.
      //
      // So the options stay hidden until refreshDestinations() has completed once and set the flag. A
      // picker that is briefly empty is honest; one that briefly lists routes we do not have is not,
      // and this page's own comments already say that is the worst kind of wrong here.
      css += '.brd-opt[data-lxunreach]{display:none !important}'
        + 'html:not([data-lxbrdready]) .brd-opt{display:none !important}'
        + 'html:not([data-lxbrdready]) .brd-menu .lxx-brdwait{display:block}'
        + '.lxx-brdwait{display:none;padding:14px 16px;color:var(--text-soft);'
        + 'font:600 13px/1.4 "Hanken Grotesk",system-ui,sans-serif}';

      var st = document.createElement('style');
      st.id = 'lx-xnetbg';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);

      // The waiting line goes in NOW, while the gate is still shut — putting it in alongside the flag
      // would mean it only ever existed after it had stopped being needed. The menu is the design's own
      // and is already in the markup, so this does not wait for anything of ours to build it.
      try {
        var mn0 = document.querySelector('.brd-menu');
        if (mn0 && !mn0.querySelector('.lxx-brdwait')) {
          var w0 = document.createElement('div');
          w0.className = 'lxx-brdwait';
          w0.textContent = 'Loading networks…';
          mn0.insertBefore(w0, mn0.firstChild);
        }
      } catch (_) {}
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
  // A WRAPPER WEARS THE FACE OF WHAT IT WRAPS, and this is the right level to say so (RAZA
  // 2026-10-24: "In recent trxs, where's wXRP logo? its the same as XRP").
  //
  // I first patched txChip(), which looked like the function that draws those rows and is not —
  // txAmt() below builds them and calls symLogo() in two more places, and paintReviewLegs() in a
  // third. Patching call sites meant finding all of them, and I did not. There is exactly one
  // question being asked — "what picture goes with this ticker" — so it is answered once, here, and
  // every caller present and future gets it.
  //
  // Only where Axelar says the ticker CHANGES across the bridge: wXRP resolves to XRP's mark, while
  // USDC and WETH keep their own because they keep their names. Nothing is invented — if the registry
  // has not loaded, or the ticker is unknown, this returns '' exactly as it always did.
  function symLogo(sym) {
    var s = String(sym || '').replace(/[^A-Za-z0-9._-]/g, '');
    if (s && NI_TOKEN[s]) return '/assets/tokens/ni/' + s + '.png?v=' + ICONV;
    var o = s ? String(axOriginSym(s)).replace(/[^A-Za-z0-9._-]/g, '') : '';
    if (o && o !== s && NI_TOKEN[o]) return '/assets/tokens/ni/' + o + '.png?v=' + ICONV;
    return '';
  }
  // `placeKey` lets a NATIVE asset fall back to its own chain's mark (RAZA 2026-10-04: "for aptos, its
  // asset logo on destination is missing"). APT has no file under /assets/tokens/ni and its CoinGecko
  // fetch 404s from the edge, so the slot was simply empty — and a chain's native coin and the chain
  // itself are the same thing to a reader, so the network mark is the right answer rather than a
  // stand-in. Issued tokens are NOT given this fallback: USDC on Aptos is not Aptos.
  function tokenLogo(t, placeKey) {
    if (!t) return '';
    var s = symLogo(t.symbol);
    if (s) return s;
    if (!t.contractAddress && placeKey) {
      var cl = chainLogo(placeLabel(placeKey));
      if (cl) return cl;
    }
    return t.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(t.coingeckoId)) : '';
  }

  // A SOURCE ROW'S LOGO IS KEYED ON THE ISSUER, NEVER ON THE TICKER (RAZA 2026-10-04: "On XRPL asset
  // logos are not showing up in the assets dropdown on Source side like it does on Stellar").
  //
  // They were not showing because symLogo() only knows NEAR Intents' bundled artwork -- a few dozen
  // files under /assets/tokens/ni keyed by SYMBOL -- and an XRP Ledger wallet holds things like DOZZY,
  // BCHAMP and Xmen, none of which are in it. Every one of those fell through to the letter disc.
  //
  // The rest of this build already solves it: /lxapi/xrplthumb derives xrpl.to's token id from
  // issuer + currency on the edge, where the API key lives, and caches the image for a week.
  //
  // Resolved by LEDGER IDENTITY rather than by symbol, and that is the point rather than a detail.
  // Anyone can issue a token called USDC on this ledger; looking a logo up by ticker would hand an
  // impostor Circle's artwork on a screen that is about to move money. So the bundled art is used only
  // for native XRP, which has no issuer and cannot be impersonated, and everything else is asked for by
  // the pair that actually identifies it. A token the upstream does not know 404s and setIcon falls
  // back to the letter disc -- the same initials as before, now only where there is genuinely no logo.
  function rowLogo(a) {
    if (!a) return '';
    if (a.native) return symLogo('XRP') || XRP_LOGO;
    if (a.issuer && a.currency) {
      return '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer)
        + '&cur=' + encodeURIComponent(a.currency) + '&w=48';
    }
    return '';
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
      + 'border-radius:50%;background:#5b6170;color:#fff;font-weight:700';
    // font-size WITH PRIORITY. The asset chip's icon host also carries `.lx-assetic`, inherited from
    // Stellar, whose rule is `font-size:0 !important` -- and an important declaration in a stylesheet
    // beats a normal inline one, so initials written here rendered at zero height inside an otherwise
    // correct disc. Invisible letters look exactly like a logo that failed to appear.
    s.style.setProperty('font-size', '9px', 'important');
    s.textContent = String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    host.appendChild(s);
    host.setAttribute('data-logo', '');
    host.setAttribute('data-logoed', '1');
  }

  // `lazy` is for lists, and it is set BEFORE the src or it does nothing: the fetch starts the moment
  // src is assigned, so loading="lazy" applied afterwards is too late to hold anything back. The source
  // picker is the caller that needs it -- eighty rows, each wanting a logo, is the exact fan-out
  // /lxapi/xrplthumb's own notes call out as what used to get a key pulled.
  function setIcon(host, src, fallbackName, lazy) {
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
      if (lazy) { img.loading = 'lazy'; img.decoding = 'async'; }
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
      host.appendChild(img);
    }
    // THE HANDLER IS ATTACHED EVERY TIME, not only to an img this function created (RAZA 2026-10-05,
    // twice: "LUMOS logo is still breaking").
    //
    // The served file is fine -- fetched and looked at: the orange flame, 160x160, loads here. But when
    // the host ALREADY holds an <img>, which it does whenever another layer wrote one first (brpolish
    // builds the From pill that way), this branch was skipped and only `src` was replaced. An image
    // that then failed had NO onerror, so the browser's own broken-image glyph sat in the circle
    // permanently instead of falling back to the letters -- which is what a broken logo on this chip
    // looks like, and why it survived a logo fix that was otherwise correct.
    //
    // `onerror` rather than addEventListener: assigning replaces any handler from a previous call, so
    // repainting the same chip cannot stack them.
    img.onerror = function () {
      // ONE RETRY PAST THE CACHE BEFORE GIVING UP. /lxapi/xrplthumb answers a miss with max-age 600 and
      // a malformed id with 3600, so a single bad moment -- an upstream blip, a request that went out
      // before a fix -- is remembered by the BROWSER for up to an hour and a reload will not shift it.
      // Measured from here the LUMOS thumbnail is 200 on six of six tries, 23,747 bytes each, which is
      // what makes a stale cached failure the likely difference between this machine and his. The
      // retry is one extra request only on a path that has already failed.
      if (!img.__lxRetried && /^\/lxapi\//.test(String(img.getAttribute('src') || ''))) {
        img.__lxRetried = 1;
        img.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
        return;
      }
      if (img.parentNode) img.parentNode.removeChild(img);
      if (fallbackName) markLetters(host, fallbackName);
    };
    if (img.getAttribute('src') !== src) img.src = src;
    // A src assigned BEFORE this handler existed may already have failed, and a failed image fires
    // nothing more. complete && naturalWidth === 0 is that state.
    if (img.complete && !img.naturalWidth && img.getAttribute('src')) { img.onerror(); return; }
    // AND A CHECK THAT DOES NOT DEPEND ON THE EVENT ARRIVING. `alt` is empty on these, so an image that
    // fails renders as NOTHING -- not a broken glyph -- and the only thing standing between that and
    // the initials is an onerror that has to fire. Two rounds of this chip have now shown an empty
    // circle, which is precisely what a missed event looks like. So the state is read instead: if the
    // image has not produced pixels by the time it should have, take the fallback. Cheap, and it cannot
    // misfire on a working logo because naturalWidth is non-zero the moment one decodes.
    if (host.__lxIconT) clearTimeout(host.__lxIconT);
    host.__lxIconT = setTimeout(function () {
      host.__lxIconT = 0;
      var cur = host.querySelector('img');
      if (!cur || cur.naturalWidth) return;             // gone, or decoded fine
      if (cur.parentNode) cur.parentNode.removeChild(cur);
      if (fallbackName) markLetters(host, fallbackName);
    }, 6000);
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
    // What the stylesheet above keys the chip's artwork on. Set on the trigger itself rather than on
    // anything inside it, so a rebuild of the chip's contents cannot take it away.
    trg.setAttribute('data-net', name);
    document.documentElement.setAttribute('data-destnet', name);
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
      // setIcon, NOT a bare img.src (RAZA 2026-10-09: "on XRPL, source network logo is not there").
      // On the combined build the source chip ships as `<span class="br-ic"></span>` with nothing in
      // it, so `if (img)` was false and the chip kept a 26px hole. setIcon creates the img when the
      // host has none. The 'XRP' third argument matters: symLogo() returns '' when it cannot build a
      // url, and without a fallback name that would leave the same empty circle this is fixing --
      // with it, the letters are drawn instead.
      setIcon(c.querySelector('.br-ic'), XRP_LOGO, 'XRP');
    });
    $$('.br-wallet').forEach(function (w) {
      var a = w.querySelector('.addr');
      if (a) a.textContent = me ? short(me) : 'Not connected';
      var img = w.querySelector('img');
      if (img) { img.src = XRP_LOGO; img.alt = ''; }
    });
  }

  // THE LEDGER, THE WAY EVERY OTHER CLIENT ON THIS BUILD READS IT.
  //
  // This used to GET /lxapi/xrplhistory?method=account_info&params=… -- and that endpoint is not an
  // RPC proxy at all. It is "recent exchanges for one token", an xrpl.to trades feed that takes a
  // token id, so every call answered HTTP 200 with {ok:true, error:"unknown token", rows:[]}.
  //
  // A 200 WITH AN ERROR INSIDE IT IS WHY THIS SURVIVED. `.catch()` never fired, `d.result` was simply
  // undefined, and both callers treat that as "no data": XRP_SPEND became null and HOLD stayed empty.
  // So the balance read "—" and the source picker offered XRP and nothing else -- on a wallet holding
  // plenty of both. Two of the four things RAZA reported, from one wrong URL, with no error anywhere.
  //
  // xrplcluster.com is what account.js, wallet.js and createpool.js all use, and the shape they use:
  // POST, params wrapped in an array, result unwrapped by the caller.
  var RPC = 'https://xrplcluster.com/';
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

  function rpcB(method, params) {
    return lxpost(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
    });
  }
  function loadSpendable() {
    var me = addr();
    if (!me) { XRP_SPEND = null; return Promise.resolve(); }
    // THE RESERVE IS READ FROM THE LEDGER, NOT ASSUMED. It was hardcoded at 1 XRP base + 0.2 per
    // owned object -- today's schedule, and today's only: both figures were TEN TIMES higher before
    // 2024 and are governance-settable by amendment. An understated reserve makes MAX offer more
    // than the account can actually send, which is the same class of bug as Stellar's MAX button
    // overstating a balance. server_info is one extra request on a page that already makes several.
    return Promise.all([
      rpcB('account_info', { account: me, ledger_index: 'validated' }),
      rpcB('server_info', {}).catch(function () { return null; }),
    ])
      .then(function (r) {
        var acc = r[0] && r[0].result && r[0].result.account_data;
        // WHY there is no figure, not just that there is none (RAZA 2026-10-24: "why my xrp balance
        // not showing up", minutes after the ledger throttled him). A failed read and a read that
        // has not happened yet both left XRP_SPEND null and both drew a bare dash, so the row could
        // not tell him the difference — the same conflation that made the Custom Swap list say
        // "Loading your assets…" for ever. See [[absent-has-many-causes]].
        //
        // A throttle is not an answer about this account, so it is recorded and RETRIED once the
        // quota the ledger quoted has cleared. Nothing else re-reads this on its own, so without
        // that the dash stays until the page is reloaded — and a reload inside the throttle window
        // fails again, which is exactly how it looks broken rather than busy.
        if (!acc) {
          XRP_SPEND = null;
          var em = (r[0] && r[0].result && (r[0].result.error_message || r[0].result.error)) || '';
          XRP_SPEND_ERR = busyNote(em);
          if (XRP_SPEND_ERR) retrySpendable(em);
          return;
        }
        XRP_SPEND_ERR = '';
        var v = r[1] && r[1].result && r[1].result.info && r[1].result.info.validated_ledger;
        var base = Number(v && v.reserve_base_xrp);
        var inc = Number(v && v.reserve_inc_xrp);
        if (!(base > 0)) base = 1;                       // the schedule as measured 2026-09-08
        if (!(inc > 0)) inc = 0.2;
        var bal = fromDrops(acc.Balance);
        var reserve = base + inc * Number(acc.OwnerCount || 0);
        XRP_SPEND = Math.max(0, bal - reserve);
      })
      .catch(function (e) {
        XRP_SPEND = null;
        XRP_SPEND_ERR = busyNote(e);
        if (XRP_SPEND_ERR) retrySpendable(e);
      });
  }

  // The throttle in a sentence, borrowed from xrpl-core so the bridge and the transport cannot word
  // it differently. Empty for anything that is not one.
  function busyNote(e) {
    try {
      var s = String((e && e.message) || e || '');
      return (window.lxx && window.lxx.ledgerBusyNote && window.lxx.ledgerBusyNote(s)) || '';
    } catch (_) { return ''; }
  }

  // ONE re-read, after the interval the ledger itself named. Not a loop: if the second attempt is
  // throttled too, its own handler schedules the next, so the backoff always comes from the ledger
  // rather than from a timer we invented. Guarded so several failing calls cannot stack timers.
  var SPEND_RETRY = 0;
  function retrySpendable(e) {
    if (SPEND_RETRY) return;
    var m = /retry in ~?(\d+)\s*ms/i.exec(String((e && e.message) || e || ''));
    var wait = Math.min(Math.max(m ? Number(m[1]) + 500 : 5000, 2000), 45000);
    SPEND_RETRY = setTimeout(function () {
      SPEND_RETRY = 0;
      loadSpendable().then(function () { try { paintSteps(); } catch (_) {} });
    }, wait);
  }

  // ---- what the wallet is actually holding ---------------------------------------------------------
  // The source list is the user's own balances INTERSECTED with Axelar's registry, not the registry on
  // its own. You can only send what you hold, so offering seventeen assets to someone who holds one is
  // seventeen ways to reach an error. It also bounds the picker without a rule having to.
  function holdKey(cur, iss) { return String(cur) + '|' + String(iss || ''); }
  function loadHoldings() {
    var me = addr();
    HOLD = {};
    LINES = [];
    // NOT GATED ON THE AXELAR REGISTRY ANY MORE. This read serves two things: HOLD, which matches
    // balances against Axelar's interchain assets, and LINES, which is every funded trust line and
    // is what the swap-first source list is built from. Only the first needs Axelar -- but the whole
    // function returned early without it, so an Axelar outage silently removed every swappable asset
    // from the picker and left a wallet holding tokens looking like a wallet holding only XRP.
    if (!me) return Promise.resolve();
    return rpcB('account_lines', { account: me, ledger_index: 'validated', limit: 400 })
      .then(function (d) {
        // A THROTTLE ARRIVES RESOLVED, NOT REJECTED (2026-11-18). Once ledgerPost's own retries are spent,
        // or the ledger quotes a wait over its cap, it hands back the envelope -- result.error "rate limit:
        // units quota ... exhausted" -- as the answer. Read as `lines || []` that was a wallet holding
        // nothing, so the catch below never ran and USDC stayed out of the picker for the whole visit
        // (1 load in 3 on staging). No `lines` is a failed read and goes to the retry; only an
        // unfunded account genuinely holds nothing.
        var res = d && d.result;
        if (!res || !Array.isArray(res.lines)) {
          if (res && res.error === 'actNotFound') return;
          throw new Error(String((res && (res.error_message || res.error)) || 'account_lines: no answer'));
        }
        var lines = res.lines;
        LINES = [];
        lines.forEach(function (l) {
          var bal = parseFloat(l.balance);
          if (!(bal > 0)) return;                        // a zero or negative line is not a holding
          HOLD[holdKey(l.currency, l.account)] = bal;
          LINES.push({ currency: l.currency, issuer: l.account, balance: bal });
        });
        HOLD_RETRY = 0;
      })
      // RETRIED, NOT SWALLOWED (2026-11-18). The ledger client's own rate limiter refuses a read with
      // "units quota exhausted, retry in ~16469ms", and this catch used to drop it: HOLD stayed empty
      // for the life of the page, every token the wallet held vanished from the picker, and the
      // source chip stopped being clickable -- measured twice in four staging loads. It now waits the
      // time the limiter names (or a growing default) and reads again, up to four times, then
      // repaints what depends on the holdings.
      .catch(function (e) {
        if (HOLD_RETRY >= 4) return;
        HOLD_RETRY++;
        var m = /retry in ~(\d+)ms/.exec(String((e && e.message) || e || ''));
        var wait = Math.min(30000, m ? (+m[1] + 250) : 2500 * HOLD_RETRY);
        setTimeout(function () {
          loadHoldings().then(function () {
            try { paintSourceAsset(); refreshDestinations(); paintSteps(); setCta(); } catch (_) {}
          });
        }, wait);
      });
  }
  var HOLD_RETRY = 0;

  // XRP first, then every registered asset the wallet holds.
  // What a route can be handed AS IT STANDS: XRP, and the interchain assets the wallet holds.
  function directAssets() {
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

  // Everything the picker offers: the above, plus every other funded trust line, which reaches a
  // route by being swapped into XRP first. Those route exactly as XRP does, because by the time any
  // route sees the transfer that is what the wallet will be holding.
  function sourceAssets() {
    var out = directAssets();
    otherHoldings().forEach(function (o) {
      if (o.lp) return;                                  // a pool share is not a sendable asset
      out.push({ symbol: o.symbol, native: false, viaSwap: true, decimals: 15,
        currency: o.currency, issuer: o.issuer, balance: o.balance, ax: null });
    });
    return out;
  }

  // ---- the swap-first leg ---------------------------------------------------------------------------
  //
  // Only XRP and Axelar's interchain registry can leave this ledger. Everything else a wallet holds --
  // LUMOS, RLUSD, any issued token -- has to become XRP first, and the XRP Ledger does that with a
  // CROSS-CURRENCY PAYMENT TO YOURSELF: SendMax in what you hold, Amount in what you want, routed
  // through the order books and AMMs the ledger finds. The Stellar build does the same thing with a
  // path payment into USDC before handing anything to a route.
  //
  // THIS IS browser/dxaswap.js's SWAP, not a second one. Same ripple_path_find call, same
  // tfPartialPayment + DeliverMin floor, same simulate dry run. That file earned each of those the
  // hard way -- tecPATH_PARTIAL on thin books, a MAX sell leaving dust behind, a public node that
  // accepts a request and never answers -- and a fresh implementation here would relearn all of it.
  //
  // THE PLATFORM FEE IS CHARGED ONCE, on the bridge leg, where it already is. The swap is plumbing to
  // get to a bridgeable asset, not a trade the user asked for, and charging both legs would take
  // 0.4% while the page says 0.2%.
  var SWAP_SLIP = 0.005;
  var SWAPQ = null;                 // {from, amt, out, paths} — the live IOU -> XRP quote
  // WHAT THE READER PICKED, taken before the swap replaces it (RAZA 2026-10-23: "i used near intents
  // from LUMOS (XRPL) to USDC (Avalanche) ... i wanna show what a user actually selected as source
  // token. In my case it was LUMOS, not XRP").
  //
  // srcLeg() was written to answer exactly this and could not, because of the order things happen in:
  // swapThenBridge() sets `SRC = directAssets()[0]` the moment the swap lands, and rewrites the amount
  // field with the XRP that arrived. By the time record() runs, both of its inputs describe the XRP
  // leg -- SRC.native is true, so srcLeg() returned null and the row fell back to "2.012872 XRP". The
  // fix was in place and the evidence had already been overwritten.
  //
  // Captured once, before the first signature, and cleared when the transfer finishes or the source
  // changes -- so a later plain-XRP bridge cannot inherit the name of a token it never touched.
  var SWAP_LEG = null;              // {srcSym, srcAmt} — the issued token sold to XRP for this transfer

  function xrpAmountObj(v) { return window.lxx.toDrops(v); }
  function iouAmountObj(a, v) {
    var s = window.lxx.iouValue(v);
    return s ? { currency: a.currency, issuer: a.issuer, value: s } : null;
  }

  // A deadline on every read. A public node can accept a request and never answer, and fetch has no
  // timeout of its own -- that is what froze dxaswap on "Finding the best route…" with a complete
  // quote already on screen.
  function rpcT(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined,
    }).then(function (j) {
      clearTimeout(timer);
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw new Error((e && e.name === 'AbortError') ? (method + ' timed out') : ((e && e.message) || 'ledger unavailable'));
    });
  }

  // How much XRP `amt` of this asset buys, right now. `destination_amount: '-1'` is the ledger's way
  // of asking "as much as you can" for a given send_max.
  function quoteSwap(a, amt) {
    var me = addr();
    var pay = iouAmountObj(a, amt);
    if (!me || !pay || !(amt > 0)) return Promise.resolve(null);
    return rpcT('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: '-1', send_max: pay, ledger_index: 'validated',
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      if (!alt) return null;
      var out = Number(alt.destination_amount) / 1e6;     // XRP destination comes back as drops
      if (!(out > 0)) return null;
      return { from: a, amt: amt, out: out,
        paths: (alt.paths_computed && alt.paths_computed.length) ? alt.paths_computed : null };
    }).catch(function () { return null; });
  }

  // The transaction, built exactly as dxaswap builds it.
  //
  // tfPartialPayment WITH A DeliverMin FLOOR, which is not the same as an unprotected partial payment.
  // An exact-delivery Payment has to land its Amount to the last drop through whatever book the path
  // runs over, and on a thin one that fails as tecPATH_PARTIAL even when the quote was honest.
  // Partial delivers what SendMax buys; DeliverMin refuses anything under the quote less 0.5%. It pays
  // the user themselves, so "partial" can only ever mean fewer of their own tokens spent.
  function swapTx(q) {
    var me = addr();
    var amount = xrpAmountObj(q.out);
    var floor = xrpAmountObj(window.lxx.minAfterSlippage(q.out, SWAP_SLIP));
    var sendMax = iouAmountObj(q.from, q.amt);
    if (!amount || !floor || !sendMax) return null;
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: me,
      Amount: amount, DeliverMin: floor, SendMax: sendMax,
      Flags: 131072,                                       // tfPartialPayment
      Memos: [{ Memo: { MemoData: hex('LumosCore: swap to XRP before bridging') } }],
    };
    if (q.paths) tx.Paths = q.paths;
    return tx;
  }

  // EVERYTHING ELSE THE WALLET HOLDS, named rather than hidden.
  //
  // Only XRP and the assets on Axelar's interchain registry can leave this ledger -- NEAR Intents and
  // THORChain both carry XRP alone. So a wallet holding LUMOS and RLUSD saw a source picker with one
  // entry, no caret and no explanation, and no way to tell whether the page had failed to load its
  // balances or simply could not carry them. (It had ALSO failed to load them, which is the RPC bug
  // fixed above, and from the outside the two were indistinguishable.)
  //
  // These are listed and disabled, each saying why. That is not the same as being able to bridge them
  // -- doing that needs a DEX swap into XRP first, the way the Stellar build swaps a non-XLM source
  // into USDC before handing it to a route -- but it replaces a silent limit with a stated one.
  function otherHoldings() {
    var known = {};
    // directAssets, NOT sourceAssets -- sourceAssets now calls THIS, and the pair would recurse.
    directAssets().forEach(function (a) { known[holdKey(a.currency, a.issuer)] = 1; });
    // decodeCurrency returns { code, display, kind } -- NOT a string. Using its return value directly
    // rendered "[object Object]" as the ticker and, via the letter fallback, a disc reading "OBJ" on
    // every row. `kind` also answers the LP question without a second call: 'lp' is a pool share.
    var dec = (window.lxx && window.lxx.decodeCurrency) || null;
    return LINES.filter(function (l) { return !known[holdKey(l.currency, l.issuer)]; })
      .map(function (l) {
        var d = null;
        try { d = dec ? dec(l.currency) : null; } catch (e) { d = null; }
        var lp = !!(d && d.kind === 'lp');
        var sym = (d && d.display) || String(l.currency).slice(0, 6);
        return { symbol: lp ? 'Pool share' : sym, balance: l.balance, lp: lp,
          currency: l.currency, issuer: l.issuer };
      })
      .sort(function (a, b) { return b.balance - a.balance; });
  }

  // A TICKER IS NOT AN IDENTITY ON THIS LEDGER. Anyone can issue a token called LUMOS, and the test
  // wallet holds two: 320,804,914 from rsPqeam… (the real issuer) and 10,000,000,000 from rQGwqyp…,
  // which has no market at all. In a picker that shows only the symbol those are the same row twice,
  // and the larger — the impostor — sorts to the top.
  //
  // So a symbol held from more than one issuer carries its issuer. Nothing is judged here: the page
  // does not decide which LUMOS is "real", it just stops pretending there is only one.
  function labelHoldings(list) {
    var seen = {};
    list.forEach(function (o) { seen[o.symbol] = (seen[o.symbol] || 0) + 1; });
    return list.map(function (o) {
      if (seen[o.symbol] < 2 || !o.issuer) return o;
      return { symbol: o.symbol, balance: o.balance, lp: o.lp,
        currency: o.currency, issuer: o.issuer,
        label: o.symbol + ' · ' + String(o.issuer).slice(0, 5) + '…' + String(o.issuer).slice(-4) };
    });
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

  // WHAT AXELAR IS ACTUALLY HANDED (RAZA 2026-10-24: "Trying to swap on XRPL, from LUMOS (XRPL) to
  // Hedera using Axelar. But why in the world its showing LUMOS as destination asset. LUMOS doesn't
  // even exist on Hedera").
  //
  // It does not, and Axelar has never heard of it either: its ITS list is 18 assets -- XRP, WETH,
  // USDC.axl, WBTC, the Midas set, SHX, SOIL, PAXG -- and LUMOS is not one of them. Measured against
  // the live endpoint the same day; that is why the form carried a red "unknown asset", which is this
  // page asking for a relay price on a symbol Axelar cannot name.
  //
  // The ROUTE is sound. An issued token reaches an Axelar-only destination by being sold to XRP on the
  // XRP Ledger first -- routesFor() checks AX_BY_SYM.XRP's chains, not the token's, precisely because
  // XRP is what the bridge receives. What was wrong is everything that DESCRIBED that leg: it read
  // SRC, which is still the pre-swap token, so the page named LUMOS as the asset arriving on Hedera
  // and asked Axelar to price a LUMOS relay.
  //
  // The same mistake the comment in paintDestAsset already warns about -- "the first version assumed
  // [the asset that arrives] was always the one being sent" -- fixed there for THORChain and left
  // standing for a swapped source. One function now answers it, so the seven places that describe this
  // leg cannot drift apart again.
  function axLeg() {
    if (SRC && SRC.viaSwap) return { sym: 'XRP', dp: 6 };
    return { sym: (SRC && SRC.symbol) || '', dp: SRC ? SRC.decimals : 6 };
  }

  // ...AND WHAT IT IS CALLED WHERE IT LANDS, which is a different question again (RAZA 2026-10-24:
  // "you should show wXRP as the destination asset because its wrapped XRP and not actual XRP").
  //
  // Axelar is an ITS bridge: it burns on one chain and mints the registered representation on the
  // other, so what arrives is usually a wrapped token with its own ticker. Not always, though, and
  // that is why this is a lookup and not a "w" prefix -- from the registry the same day:
  //     XRP   xrpl-evm → XRP (the native gas token there)   hedera → wXRP ("Wrapped XRP")
  // Prefixing everything would have been wrong on XRPL EVM, which is the destination this route
  // exists for in the first place.
  //
  // Falls back to the sent symbol whenever the registry has nothing to say, so a chain Axelar adds
  // tomorrow reads as it does today rather than as a blank.
  // Split in two so the HISTORY can ask the same question. A stored row has no SRC and no place key —
  // only the symbol that was sent and Axelar's own chain id — and it is the rows written before any
  // of this existed that most need answering: they carry the sent symbol and nothing else, so the
  // table went on saying "1.948635 XRP" for a transfer that delivered wXRP on Hedera. Resolving at
  // paint time rather than only at write time fixes those too, without rewriting anybody's storage.
  function axRecvSym(sentSym, axChainId) {
    var a = AX_BY_SYM[sentSym];
    var r = a && a.recv && axChainId ? a.recv[axChainId] : null;
    return (r && r.sym) || sentSym || '';
  }
  function axRecv(key) {
    return axRecvSym(axLeg().sym, axId(key));
  }

  // WHAT A WRAPPER IS A WRAPPER OF (RAZA 2026-10-24: "In recent trxs, where's wXRP logo? its the same
  // as XRP").
  //
  // symLogo() answers from NI_TOKEN, the 96 marks this build actually ships, and "wXRP" is not one of
  // them — so the history chip rendered an empty disc next to a real figure. The asset is XRP, and the
  // registry is the only thing that knows that: it is the same ITS token, listed under XRP on the
  // XRPL side and wXRP on Hedera.
  //
  // Derived rather than written down, so a ticker Axelar adds tomorrow is covered without an edit, and
  // ONLY where the name actually changes — a chain that keeps the ticker needs no mapping, and
  // recording one would let an unrelated asset win a collision on a common symbol like USDC.
  // Rebuilt whenever AX_BY_SYM is, because it is a view of it and nothing else.
  var AX_ORIGIN = null;
  function axOriginSym(sym) {
    if (!sym) return '';
    if (!AX_ORIGIN) {
      AX_ORIGIN = {};
      Object.keys(AX_BY_SYM).forEach(function (x) {
        var a = AX_BY_SYM[x];
        if (!a || !a.recv) return;
        Object.keys(a.recv).forEach(function (c) {
          var d = a.recv[c] && a.recv[c].sym;
          if (d && d !== x && !AX_ORIGIN[d]) AX_ORIGIN[d] = x;
        });
      });
    }
    return AX_ORIGIN[sym] || '';
  }

  // Is THORChain's leg to this place paused right now? Asked of the PLACE, so the caller never has to
  // know THORChain's own chain names. False whenever we have no halt list at all, because a route that
  // might work must not be refused on a read that failed.
  function thHalted(key) {
    var p = PLACES[key];
    return !!(TH_HALT && p && p.th && TH_HALT[p.th]);
  }

  // EVERY route that can carry this pair, not one. Where more than one can, the price decides -- see
  // settle(). An IOU is Axelar's alone; XRP can go by any of the three depending on where.
  function routesFor(src, key) {
    var p = PLACES[key], out = [];
    if (!src || !p) return out;
    var axOk = p.ax && src.ax && src.ax.chains.indexOf(p.ax) >= 0;
    // A SWAPPED SOURCE ROUTES AS XRP, because that is what the wallet holds by the time any route is
    // handed anything. Axelar is excluded on purpose: it carries the asset it is given, and after the
    // swap that is plain XRP -- so the only Axelar pairs it could serve are the ones XRP already
    // reaches, and routing an LUMOS transfer "via Axelar" would name a route that never saw LUMOS.
    if (src.viaSwap) {
      if (p.ni && BY_CHAIN[p.ni]) out.push('ni');
      if (p.th && TH && TH.xrpTradeable) out.push('th');
      if (p.ax && AX_BY_SYM.XRP && AX_BY_SYM.XRP.chains.indexOf(p.ax) >= 0) out.push('ax');
      return out;
    }
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

    // Started here rather than at boot: the trigger exists from the first paint, but the options it
    // has to be judged against do not, and a watcher armed before them would clear a perfectly good
    // destination for the few hundred milliseconds in between.
    watchDest();
    return refreshDestinations();
  }

  // Shown or hidden per the CURRENT source asset.
  //
  // Revealed with an INLINE important declaration. The inherited Stellar stylesheet hides eleven of
  // these with `!important` because Circle CCTP could not reach them, and that CSS came across with
  // the fork -- a stylesheet outliving the layer whose decision it encoded. An inline important is the
  // one thing that reliably outranks it regardless of which <style> the build emits last.
  // DELETE THE DEAD RULE INSTEAD OF SHOUTING OVER IT.
  //
  // RAZA 2026-10-12, repeatedly: "hedera still not appearing in cross chain destination dropdown",
  // "not just search, but its also not in the list". Measured on staging with the menu OPEN: 44
  // options, 32 drawn, the list running Gnosis -> Hyperliquid with Hedera between them and computing
  // to display:none. Twelve are hidden and all twelve are hidden the same way.
  //
  // The option carried our inline reveal the whole time -- style="display: flex !important" was right
  // there on the element. What beat it was not specificity, it was erasure: the design's own filter
  // runs on OPEN as well as on typing, and does
  //
  //     o.style.display = ok ? "" : "none";
  //
  // The "" branch REPLACES the inline declaration and takes our !important with it, leaving the
  // element with no inline display at all. Then lx-cctp-css, inherited whole from the Stellar fork,
  // applies: `.brd-opt[data-net="Hedera"]{display:none !important}` -- one of eleven chains Circle
  // CCTP could not reach, a stylesheet outliving the layer whose decision it encoded. Circle does not
  // route anything on this page; Axelar does, and Axelar reaches Hedera.
  //
  // The block below already learned half of this lesson: it hides via data-lxunreach + a stylesheet
  // rule BECAUSE the design wipes inline styles. The showing side kept trusting inline and had the
  // same hole.
  //
  // Out-shouting it was the obvious fix and the wrong one. A more specific `!important` of our own
  // would also outrank the design's plain `display:none`, so typing in the search box would stop
  // filtering -- trading a chain that will not show for a search that will not hide. The rule has no
  // business existing on this page at all, so it goes, and the reachable set computed below is left as
  // the only thing deciding what the picker offers.
  //
  // Scoped to lx-cctp-css and to `.brd-opt[data-net=...]` so it cannot reach a rule that is still
  // load-bearing, and run on every refresh because it is cheap and a late-arriving stylesheet would
  // otherwise reinstate the bug silently.
  function dropStaleChainHides() {
    var killed = 0;
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sh = document.styleSheets[i];
        if (!sh.ownerNode || sh.ownerNode.id !== 'lx-cctp-css') continue;
        var rs; try { rs = sh.cssRules; } catch (_) { continue; }   // a sheet we may not read
        for (var j = rs.length - 1; j >= 0; j--) {
          var r = rs[j];
          if (!r.selectorText) continue;
          if (!/^\s*\.brd-opt\[data-net=/.test(r.selectorText)) continue;
          if (!/display\s*:\s*none/i.test(r.cssText)) continue;
          try { sh.deleteRule(j); killed++; } catch (_) {}
        }
      }
    } catch (_) {}
    return killed;
  }

  function refreshDestinations() {
    dropStaleChainHides();
    var reach = reachablePlaces();
    var shown = [];
    $$('.brd-opt').forEach(function (o) {
      var c = o.getAttribute('data-lxplace');
      if (c && reach[c]) {
        o.style.setProperty('display', 'flex', 'important');
        o.setAttribute('data-lxroute', reach[c]);
        o.removeAttribute('data-lxunreach');
        shown.push(o.getAttribute('data-net'));
      } else {
        o.style.setProperty('display', 'none', 'important');
        o.removeAttribute('data-lxroute');
        // THE ATTRIBUTE IS WHAT ACTUALLY HIDES IT; the inline rule above is now only a first coat.
        //
        // RAZA 2026-10-04 typed "li" into the network search and got Hyperliquid, LINEA, Litecoin. The
        // design's own search filter walks the options and assigns `o.style.display = 'flex'` — a plain
        // assignment, which REPLACES the whole inline declaration and takes our !important with it. So
        // an option we had hidden came back the moment anyone typed, and only the capture-phase click
        // blocker stopped it being chosen (which is exactly what "now nothing happens when I click"
        // was). A rule in a stylesheet marked !important outranks the design's inline write, because
        // inline only wins when it is not competing with an important author declaration.
        o.setAttribute('data-lxunreach', '1');
      }
    });
    window.__lxxBridgeNets = shown;
    // The gate lifts here and only here: from this point the list is the one this source can actually
    // reach. Not lifted on an empty result, because "nothing reachable" is also what a half-loaded page
    // looks like, and revealing an empty picker then would be the same mistake in the other direction.
    try {
      if (shown.length) document.documentElement.setAttribute('data-lxbrdready', '1');
    } catch (_) {}
    // A destination already chosen that the new source cannot reach is CLEARED rather than left
    // standing: leaving it would show a pair that no route serves while the trigger insists it is set.
    //
    // KEYED ON THE TRIGGER, NOT ON destChain(), AND THAT IS THE WHOLE FIX (RAZA 2026-10-04: "why is
    // linea on destination showing ETH as the asset", with the route card reading NEAR Intents and no
    // quote ever arriving).
    //
    // destChain() resolves the trigger's label through the option's `data-lxplace`, and an option we
    // cannot route to never gets one — so for Linea it returns NULL, not "unreachable". The old guard
    // was `if (cur && !reach[cur])`, so the one case it had to catch was the one case it skipped: a
    // mapped-but-unreachable destination was cleared, while a destination with no mapping at all sailed
    // through and stayed selected. Every downstream reader then disagreed about what was going on —
    // the trigger said Linea, the asset slot kept the design's default, the route card still named
    // NEAR Intents, and blockReason() said "Choose a destination" about a destination plainly on
    // screen. No quote is possible for any of it, which is the blank "You will receive".
    //
    // Only when the reachable set is actually KNOWN. shown.length is 0 both when nothing is reachable
    // and when the token list has not landed yet, and clearing a good destination during the second
    // would be this same bug pointed the other way.
    if (shown.length) enforceDest(reach);
    return shown.length;
  }

  // THE TRIGGER IS WATCHED, NOT JUST CHECKED ONCE (RAZA 2026-10-04, third time on this: "Still not
  // working. In linea, now its shows XRP").
  //
  // The previous attempt put this check inside refreshDestinations(), which runs when the SOURCE asset
  // changes and at init -- and never again after a destination is picked. So a Linea already standing
  // in the trigger was simply never looked at, and the step-2 pill beside the word "To" mirrors that
  // trigger, which is why it kept saying Linea. Clearing DEST without clearing the trigger is also why
  // the delivered asset fell back from ETH to XRP: half the state was reset and the visible half
  // was not.
  //
  // So the rule is enforced wherever the name can arrive: on every refresh, whenever anything writes
  // to the trigger (the design ships its own handler for its own eighteen options, and that writer is
  // not ours to call), and when step 2 is opened. An unreachable destination cannot survive any of
  // those, however it got in.
  function enforceDest(reach) {
    reach = reach || reachablePlaces();
    var trg = $('.brd-trigger'), nm = trg && trg.querySelector('.nm');
    if (!trg || !nm) return;
    var label = norm(nm.textContent || '');
    // Nothing chosen: 'Select Network' is the placeholder, not a destination.
    if (!label || trg.classList.contains('is-empty') || /select/i.test(nm.textContent || '')) return;
    var cur = destChain();
    if (cur && reach[cur]) return;                    // chosen, mapped, reachable — leave it alone
    nm.textContent = 'Select Network';
    // THE BADGE GOES WITH THE NAME (2026-11-19): the chip kept the cleared network's mark -- a green
    // "NEAR" disc beside "Select Network". The page's own empty chip has an empty .br-ic.
    var tic = trg.querySelector('.br-ic');
    if (tic && tic.innerHTML) tic.innerHTML = '';
    trg.classList.add('is-empty');
    trg.removeAttribute('data-net');
    document.documentElement.removeAttribute('data-destnet');
    DEST = null; QUOTE = null; AXQ = null; THQ = null; SWAPQ = null;
    try { paintSteps(); } catch (_) {}
  }

  // AND THE SELECTION IS REFUSED AT THE SOURCE, not only repaired afterwards.
  //
  // The served page carries exactly one other writer of the trigger's label — `lx-bridge2js`, the
  // inherited Stellar layer, which binds a click listener to EVERY .brd-opt present when it runs and
  // writes `data-net` straight onto the trigger with no notion of whether a route exists. It also calls
  // stopPropagation(), so a bubbling listener of ours never sees that click. A capture listener on
  // window does, and runs first.
  //
  // Only once the reachable set is known (data-lxbrdready): before that NOTHING carries data-lxroute
  // and this would swallow every click, including the good ones.
  function blockUnreachableClicks() {
    if (window.__lxxDestBlock) return;
    window.__lxxDestBlock = 1;
    window.addEventListener('click', function (e) {
      if (!document.documentElement.getAttribute('data-lxbrdready')) return;
      var t = e.target;
      var opt = (t && t.closest) ? t.closest('.brd-opt') : null;
      if (!opt) return;
      if (opt.getAttribute('data-lxroute')) return;          // reachable: let it through untouched
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
  }

  // One observer, on the trigger's own subtree. characterData because the design's handler writes the
  // label as a text node rather than replacing the element.
  // A NEW DESTINATION IS A NEW TRANSFER (RAZA 2026-10-05: "If i select any network but then change to
  // another network, the fields should be refreshed. It still shows 1000000 LUMOS").
  //
  // The address is the sharp end of this: it is chain-specific, and an Aptos address left sitting in a
  // field relabelled "Enter Avalanche address" is a transfer to a string that means nothing on the
  // chain it would be sent to. The amount goes with it because the two were entered together, and the
  // quote figures go because they belonged to the old pair.
  //
  // Watched here rather than in selectChain(), because selectChain only runs for the chains this build
  // APPENDS -- the design ships eighteen of its own with their own handler, and clearing in one place
  // would have worked for some networks and not others.
  var lastDest = null;
  function destChanged() {
    var trg = $('.brd-trigger'), nm = trg && trg.querySelector('.nm');
    var now = (trg && !trg.classList.contains('is-empty') && nm) ? norm(nm.textContent) : '';
    if (now === lastDest) return;
    var had = lastDest;
    lastDest = now;
    if (!had || !now) return;                         // first pick, or a clear — nothing to carry over
    var ai = amtInput(); if (ai && ai.value) { ai.value = ''; }
    var ad = $('.br-addr-in'); if (ad && ad.value) { ad.value = ''; }
    SWAPQ = null; SIMQ = null; QUOTE = null; THQ = null; AXQ = null; BEST = '';
    NOTE = { ni: '', th: '', ax: '' };
    try { paintSourceUsd(); } catch (_) {}
    try { paintSteps(); setCta(); } catch (_) {}
    requote();
  }

  function watchDest() {
    blockUnreachableClicks();
    if (window.__lxxDestWatch) return;
    var trg = $('.brd-trigger');
    if (!trg || typeof MutationObserver !== 'function') return;
    window.__lxxDestWatch = 1;
    var pending = 0;
    var mo = new MutationObserver(function () {
      // Deferred by a frame: the design's handler sets the name and the class in separate statements,
      // and reading between the two sees a half-written state that looks unreachable when it is not.
      if (pending) return;
      pending = 1;
      setTimeout(function () {
        pending = 0;
        try { enforceDest(); } catch (_) {}
        try { destChanged(); } catch (_) {}
      }, 0);
    });
    mo.observe(trg, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-net'] });
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
  // NATIVE, USDC AND USDT. NOTHING ELSE (RAZA 2026-10-04: "lets just keep it native or USDC and USDT
  // on destination assets for all networks").
  //
  // 1Click lists everything it can deliver on a chain, which on Aptos meant APT beside BTC, ETH, ZEC,
  // AAVE and SOL — all real entries, but all BRIDGED representations of coins that live somewhere else.
  // Six rows of wrapped assets read as placeholder filler, and on a page bridging OUT of XRP a row
  // saying "ETH" that is not Ethereum's ether is the kind of wrong this file keeps warning about.
  //
  // So: the chain's own coin, plus the two stablecoins anyone actually wants on the other side. A
  // token with no contract address is the native one — that is how 1Click marks it, and it is the same
  // test the sort below already used to put it first.
  function destTokens(chain) {
    var all = (BY_CHAIN[chain] || []);
    var list = all.filter(function (t) {
      if (!t || !t.contractAddress) return true;
      var s = String(t.symbol || '').toUpperCase();
      return s === 'USDC' || s === 'USDT';
    });
    // A CHAIN WITH NO NATIVE ENTRY KEEPS ITS WRAPPED ONE. Checked across all 36 chains 1Click serves
    // rather than assumed: every one lists its own coin with no contract address EXCEPT near, whose
    // coin appears only as wNEAR at wrap.near. Filtering on "no contract" alone therefore left NEAR
    // offering USDC and USDT and no way to receive NEAR at all. It keeps the name wNEAR rather than
    // being relabelled, because a wrapped token is not the coin it is named after and this file has
    // said so about every other chain. (hypercore also lists no native; 1Click has no HYPE entry at
    // all, so there is nothing to recover there and it keeps its stablecoins.)
    //
    // NAMED, NOT PATTERN-MATCHED. The first version of this looked for any symbol shaped like a
    // wrapped ticker and took the first one — which on hypercore picked up wNEAR, a wrapped NEAR
    // sitting on Hyperliquid and emphatically not Hyperliquid's own coin. That is the precise mistake
    // this file warns about everywhere else, committed by the code meant to prevent it. One chain
    // needs this and it is named.
    var W = { near: 'wNEAR' };
    if (W[chain] && !list.some(function (t) { return !t.contractAddress; })) {
      var w = all.filter(function (t) { return String(t.symbol || '') === W[chain]; })[0];
      if (w) list.unshift(w);
    }
    // Native first, then by descending USD price as a rough proxy for prominence, then alphabetical.
    list.sort(function (a, b) {
      var an = a.contractAddress ? 1 : 0, bn = b.contractAddress ? 1 : 0;
      if (an !== bn) return an - bn;
      var ap = Number(a.price) || 0, bp = Number(b.price) || 0;
      if (ap !== bp) return bp - ap;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
    // ONE ROW PER TICKER, and only after the sort so the survivor is the higher-priced — the liquid
    // one — rather than whichever came back first. hypercore lists USDC twice under two contracts,
    // which rendered as two identical-looking rows with nothing to choose between them.
    var seen = {};
    list = list.filter(function (t) {
      var k = String(t.symbol || '').toUpperCase();
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
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

  // A CARET IS A PROMISE THAT THERE IS SOMETHING TO PICK. The design ships `.cv` -- the little ▾ --
  // inside every asset row and nothing ever removed it, so a destination that carries exactly one
  // asset still advertised a menu. Dogecoin, Litecoin, Zcash, Dash and the rest of the single-asset
  // chains all showed one, and clicking did nothing at all: the row's own handler bails when there
  // are fewer than two options. Setting the cursor was never enough on its own.
  function setPickable(as, on) {
    if (!as) return;
    as.style.cursor = on ? 'pointer' : '';
    var cv = as.querySelector('.cv');
    if (cv) cv.style.display = on ? '' : 'none';
  }

  function paintDestAsset(dst) {
    var key = destChain(), as = ensureDestRow(dst);
    if (!as) return;
    // NO DESTINATION, NO DELIVERED ASSET (2026-11-19). This returned early and left the last one
    // painted: pick NEAR, then a source that cannot reach it (held USDC), and "To" said "Choose
    // network" over a wNEAR with its logo and picker caret. Every write is guarded, because a
    // MutationObserver (lx-xbrstep2) watches this card.
    if (!key) {
      var nm0 = as.querySelector('.nm');
      if (nm0 && nm0.textContent !== '—') nm0.textContent = '—';
      var ic0 = as.querySelector('.br-ic');
      if (ic0 && ic0.innerHTML) ic0.innerHTML = '';
      if (as.style.cursor) as.style.cursor = '';
      if (as.getAttribute('data-lxfull') !== '') as.setAttribute('data-lxfull', '');
      return;
    }
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
      // axRecv(), not SRC and not axLeg(): two corrections in one line. A swapped source arrives as
      // XRP, not as the token sold on the ledger (this said LUMOS over Hedera); and on a chain that
      // wraps, what arrives carries the wrapped ticker (XRP over Hedera is really wXRP).
      var label = thSym || (routes.indexOf('ax') >= 0 ? axRecv(key) : (SRC ? SRC.symbol : '—')) || '—';
      var nmAx = as.querySelector('.nm');
      if (nmAx) nmAx.textContent = label;
      // THE ARRIVING ASSET'S OWN MARK. This only ever offered XRP_LOGO, and only when the route was
      // NOT THORChain -- so every THORChain destination showed a grey letter disc beside a real
      // figure (ATOM on Cosmos Hub, measured 2026-09-29). The shipped file is asked for by symbol,
      // which covers the natives THORChain swaps into, and letters remain the fallback.
      // WRAPPED XRP STILL WEARS THE XRP MARK. The fallback asked whether the SOURCE was native XRP,
      // which is the wrong question twice over now: a swapped source is not native yet still arrives
      // as XRP, and "wXRP" has no shipped logo of its own, so both cases fell through to a grey
      // letter disc. Asked of the Axelar leg instead, which is what the mark is actually depicting.
      // symLogo() now resolves a wrapper to the mark of what it wraps, so "wXRP" finds XRP's art
      // without a special case here. The XRP_LOGO fallback stays for the case symLogo cannot answer
      // at all — the registry not having loaded yet.
      var axXrp = routes.indexOf('ax') >= 0 && axLeg().sym === 'XRP';
      setIcon(as.querySelector('.br-ic'),
        symLogo(label) || ((!thSym && ((SRC && SRC.native) || axXrp)) ? XRP_LOGO : ''), label);
      setPickable(as, false);
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
    // THE SYMBOL IS PASSED AS THE FALLBACK, and its absence is what RAZA saw as "logo of destination
    // network on step 2 is missing". setIcon draws letters only when it is GIVEN a name; called with
    // one argument it returns having drawn nothing at all, so an asset with no shipped logo and a
    // CoinGecko id that 404s from the edge left the slot completely empty -- not a grey disc, not a
    // broken image, just a hole beside the ticker. XLM was exactly that case.
    setIcon(as.querySelector('.br-ic'), tokenLogo(DEST.token, key), DEST.token.symbol);
    setPickable(as, opts.length > 1);
    if (!as.__lxxMenu) {
      as.__lxxMenu = 1;
      as.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleDestMenu(as); });
    }
  }

  // THE SAME CONTROL AS THE SOURCE PICKER (RAZA 2026-10-04: "Destination assets dropdown is still
  // broken. Fix it like you fixed source assets dropdown").
  //
  // What was here was the thing the source picker used to be: the destination NETWORK dropdown's
  // classes (.brd / .brd-menu / .brd-opt) wrapped in inline styles, anchored inside the step — which
  // is why it rendered full-bleed across the card instead of hanging off the chip. It is now
  // #lx-br-amenu, the control Stellar's own source picker is built from and the one the source side
  // on this page already uses: same stylesheet, same 26px round icon, same ticker-over-subtitle row,
  // appended to <body> and positioned from the chip's rect so the step's slide transform cannot trap
  // it. One control, two uses, nothing left to drift apart.
  function toggleDestMenu(as) {
    if (document.getElementById('lx-br-amenu')) { closeSrcMenu(); return; }
    var key = destChain();
    var chain = key && routeFor(SRC, key) === 'ni' ? niId(key) : null;
    if (!chain) return;
    var opts = destTokens(chain);
    if (opts.length < 2) return;

    amenuCss();
    var m = document.createElement('div');
    m.id = 'lx-br-amenu';
    m.className = 'lx-br-amenu';
    m.style.cssText = 'position:absolute;z-index:99999;min-width:236px;display:block';
    m.innerHTML = '<div class="lx-amlist"></div>';
    document.body.appendChild(m);
    var listHost = m.querySelector('.lx-amlist');

    opts.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-q', String(t.symbol || '').toLowerCase());

      var ic = document.createElement('span');
      ic.className = 'aic';
      setIcon(ic, tokenLogo(t, key), t.symbol, true);

      var tx = document.createElement('span');
      tx.className = 'atx';
      tx.setAttribute('data-logo', ''); tx.setAttribute('data-logoed', '1');

      var nm = document.createElement('span');
      nm.className = 'anm';
      nm.setAttribute('data-logo', ''); nm.setAttribute('data-logoed', '1');
      nm.textContent = t.symbol;

      // The native asset is marked on its own line now rather than inside the ticker, because 1Click
      // lists wrapped copies beside the real thing and "XRP" on Starknet beside "XRP" is a trap on a
      // page bridging OUT of XRP. An issued token names its contract, the way the source side names
      // its issuer: on this page, what a token IS is never the ticker alone.
      var sub = document.createElement('span');
      sub.className = 'aiss';
      sub.setAttribute('data-logoed', '1');
      sub.textContent = t.contractAddress
        ? (String(t.contractAddress).length > 14
            ? String(t.contractAddress).slice(0, 6) + '…' + String(t.contractAddress).slice(-4)
            : String(t.contractAddress))
        : 'Native';

      tx.appendChild(nm); tx.appendChild(sub);
      b.appendChild(ic); b.appendChild(tx);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        DEST = { chain: chain, token: t };
        closeSrcMenu();
        QUOTE = null;
        paintSteps(); requote();
      });
      listHost.appendChild(b);
    });

    var r = as.getBoundingClientRect();
    var maxL = window.scrollX + document.documentElement.clientWidth - m.offsetWidth - 8;
    m.style.left = Math.max(window.scrollX + 8, Math.min(maxL, r.left + window.scrollX)) + 'px';
    m.style.top = (r.bottom + window.scrollY + 6) + 'px';

    setTimeout(function () {
      document.addEventListener('click', function away(e) {
        if (e.target && e.target.closest && e.target.closest('#lx-br-amenu')) return;
        closeSrcMenu();
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
    // REBOUND TO THE FRESH ENTRY EVERY TIME, keeping the user's CHOICE but never their stale COPY of
    // it. The first version kept the existing object whenever its symbol was still in the list -- and
    // SRC is first set by the early paint, before the Axelar registry has arrived, so it held
    // `ax: null` forever. Every Axelar destination then evaluated as unreachable and the route was
    // invisible while both registries reported loaded.
    //
    // MATCHED ON IDENTITY, NOT SYMBOL, and on this ledger that distinction is not academic. The test
    // wallet holds two tokens called LUMOS from two different issuers -- one real, one with no market
    // at all -- and a symbol match rebound every pick to whichever came first in the list. Choosing
    // the real one silently selected the impostor, whose swap then found no path: a correct refusal
    // about an asset the user had not chosen.
    var list = sourceAssets();
    var same = function (a, b) {
      return a.symbol === b.symbol
        && String(a.currency || '') === String(b.currency || '')
        && String(a.issuer || '') === String(b.issuer || '');
    };
    var keep = SRC && list.filter(function (a) { return same(a, SRC); })[0];
    // ...AND THE PICKER OFFERS MORE THAN sourceAssets() CONTAINS, which is what silently undid the
    // user's choice. RAZA 2026-10-19: "In cross-chain, From asset dropdown, i selected usdc. but
    // after i selected it, it changed to XRP (native asset)."
    //
    // sourceAssets() is built from what the wallet HOLDS. The menu deliberately lists two kinds of
    // asset beyond that: swap-first holdings, and the CURATED majors "held or not" — whose balance is
    // 0 and which exist precisely so someone can pick a token before they own any. His screenshot
    // shows the split second of state this produced: the chip had snapped back to XRP while the line
    // beside it already read "0 USDC", because the balance writer honoured the pick and this did not.
    //
    // Picking one of those meant `keep` was undefined, and `|| list[0]` is XRP — so the selection was
    // thrown away a frame after it was made, with no error and no way to tell why.
    //
    // The rebind above still runs FIRST and still wins, so the reason it exists is untouched: a direct
    // asset is always re-bound to the fresh entry carrying its `ax` registry data. This only catches
    // the case where the chosen asset is real and offered but simply not held.
    if (!keep && SRC) {
      var offered = (labelHoldings(otherHoldings()) || []).concat(CURATED || []);
      keep = offered.filter(function (a) { return same(a, SRC); })[0];
    }
    SRC = keep || list[0];
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== SRC.symbol) {
      nm.textContent = SRC.symbol;
      nm.setAttribute('data-logo', '');
      nm.setAttribute('data-logoed', '1');
    }
    // THE SAME LOGO THE PICKER DREW (RAZA 2026-10-04: "I selected PHNIX from the source dropdown and in
    // that dropdown its logo was showing but after selction, its logo is not there"). The picker asks
    // /lxapi/xrplthumb by issuer and currency; this asked symLogo(), which only knows NEAR Intents'
    // bundled artwork, so every issued token lost its logo at the moment it was chosen. rowLogo() is
    // the picker's own resolver, so the chip and the row cannot disagree again.
    setIcon(as.querySelector('.br-ic'), rowLogo(SRC) || (SRC.native ? XRP_LOGO : ''), SRC.symbol, false);
    // THE NAME UNDER THE TICKER IS THIS LEDGER'S, NOT A CROSS-CHAIN DICTIONARY'S (RAZA 2026-10-04:
    // "ATOM is just an asset on XRPL, its not cosmos which is entirely different").
    //
    // brpolish fills that line from FULL[ticker] -- a map of well-known coin names -- so an issued XRPL
    // token called ATOM was labelled "Cosmos Hub", a chain this bridge also lists as a DESTINATION.
    // Anyone can issue a token called ATOM here; the ticker is not the identity, which is the same rule
    // the logo and the picker's subtitle already follow. The attribute is always set on this chip, even
    // when empty, so the dictionary is never consulted for a source asset: better to say nothing than
    // to name the wrong asset.
    as.setAttribute('data-lxfull', SRC.native ? 'XRP' : (SRC.issuerName || ''));
    // OPENS WHENEVER THERE IS ANYTHING TO SAY, not only when there is a second thing to choose. A
    // wallet holding LUMOS and RLUSD has one bridgeable asset and two that need explaining, and
    // gating the caret on `list.length > 1` is what made that limit invisible.
    var more = list.length > 1 || otherHoldings().length > 0;
    setPickable(as, more);
    if (!as.__lxxSrcMenu) {
      as.__lxxSrcMenu = 1;
      as.addEventListener('click', function (e) {
        if (sourceAssets().length < 2 && !otherHoldings().length) return;
        e.preventDefault(); e.stopPropagation(); toggleSrcMenu(as);
      });
    }
  }

  // THE CURATED ROSTER — the major XRP Ledger tokens, whether or not this wallet holds them.
  //
  // FETCHED, NOT HARDCODED, and that is the whole point. A ticker is not an identity on this ledger:
  // anyone can issue a token called LUMOS, and an issuer address typed into this file by hand is a
  // different asset wearing the same name. /lxapi/xrpltokens is the live roster this site already
  // serves, so every issuer here is sourced rather than asserted — and it stays right when a token
  // migrates issuers, which a baked list would not.
  //
  // Checked against it before relying on it: of the tokens RAZA named, USDC, RLUSD, ARMY, FUZZY,
  // PHNIX, 666 and SHX are all in the top 40 with their real issuers. ATOM and LUMOS are not, and
  // both are already in his holdings, so they arrive through the section above.
  // THE VERIFIED TICK (RAZA 2026-10-07: "Also add verified icons in Cross-chain, step 2, From network
  // assets dropdown").
  //
  // Same rule as Trade, search, the wallet and the Custom Swap pickers — membership of
  // /lxapi/xrpltokens keyed `issuer|CURRENCY`, LUMOS pinned — and deliberately NOT the `CURATED` list
  // below it. That one is fetched at n=40 because it exists to populate a picker; ticking from it
  // would make this dropdown disagree with every other surface on the site about the same asset.
  // One question, one answer. [[xrpl-verified-tick-rule]]
  //
  // The set lives on `window` and is shared with qorders.js, which asks for the same hundred: whichever
  // layer opens first pays for the fetch and both read it. That is also the bug qorders hit — two
  // copies of a layer, each with its own closure, one holding the roster and the other drawing the
  // rows ([[lumoscore-externalize-scope]]).
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  function vset() { try { return window.__lxxVSET || null; } catch (e) { return null; } }
  function vKey(a) {
    if (!a) return '';
    return (a.issuer || '') + '|' + String(a.currency || '').toUpperCase();
  }
  function isVerified(a) {
    if (!a) return false;
    if (a.native || a.currency === 'XRP') return true;
    if (a.issuer === LUMOS_ISS) return true;
    var s = vset();
    return !!(s && s[vKey(a)]);
  }
  function vApplyRows() {
    var s = vset();
    if (!s) return;
    [].forEach.call(document.querySelectorAll('.lx-amlist [data-vk]'), function (el) {
      if (s[el.getAttribute('data-vk') || ''] && !el.querySelector('.lx-nivf')) el.appendChild(vBadge());
    });
  }
  function vLoad() {
    if (vset()) { vApplyRows(); return; }
    try { if (window.__lxxVAsked) return; window.__lxxVAsked = 1; } catch (e) {}
    fetch('/lxapi/xrpltokens?n=100').then(function (r) { return r.json(); }).then(function (d) {
      var s = {};
      [].forEach.call((d && d.rows) || [], function (x) {
        if (x && x.i && x.c) s[x.i + '|' + String(x.c).toUpperCase()] = 1;
      });
      try { window.__lxxVSET = s; } catch (e) {}
      vApplyRows();
    }).catch(function () { try { window.__lxxVAsked = 0; } catch (e) {} });
  }

  // A WHITE CHECK INSIDE A FILLED GREEN CIRCLE — the site's badge, not a green tick (RAZA 2026-10-07:
  // "this is not how we show verified tick. its green circle").
  //
  // The first version drew a bare stroked check because this menu is appended to <body>, outside any
  // stylesheet this layer owns, and I did not want a badge that depends on CSS arriving from
  // elsewhere. Right instinct, wrong conclusion: inline styles can carry the real design just as well
  // as an improvised one. These values are `.lx-seavfd` from the search panel, copied exactly — 14px
  // circle, `--green` fill, white 9px glyph — so the two cannot drift.
  function vBadge() {
    var NSV = 'http://www.w3.org/2000/svg';
    var s = document.createElement('span');
    s.className = 'lx-nivf';
    s.setAttribute('data-logoed', '1');
    s.setAttribute('title', 'Verified issuer');
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;'
      + 'height:14px;margin-left:5px;flex:0 0 auto;border-radius:50%;'
      + 'background:var(--green,#35c07f);color:#fff;vertical-align:-2px';
    var svg = document.createElementNS(NSV, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '3.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('width', '9');
    svg.setAttribute('height', '9');
    svg.style.cssText = 'width:9px;height:9px;display:block';
    var p = document.createElementNS(NSV, 'path');
    p.setAttribute('d', 'M20 6L9 17l-5-5');
    svg.appendChild(p);
    s.appendChild(svg);
    return s;
  }

  var CURATED = null;
  function curatedTokens() {
    if (CURATED) return Promise.resolve(CURATED);
    return fetch('/lxapi/xrpltokens?n=40')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var rows = (d && (d.rows || d.tokens || d.list)) || [];
        CURATED = rows
          .filter(function (t) { return t && t.n && t.i && t.c; })
          .map(function (t) {
            // balance 0, not null: these are real tokens this wallet does not hold, and 0 is what it
            // holds. null would print an empty space where a number belongs.
            return {
              symbol: String(t.n), balance: 0, lp: false, viaSwap: true, decimals: 15,
              currency: t.c, issuer: t.i, issuerName: t.u || '', ax: null
            };
          });
        return CURATED;
      })
      // The roster is a nicety; the wallet's own holdings are the thing that must work. An empty list
      // is cached so a dead endpoint is asked once per page rather than on every open.
      .catch(function () { CURATED = []; return CURATED; });
  }

  // THE SOURCE ASSET PICKER IS STELLAR'S CONTROL, NOT A LOOKALIKE OF IT.
  //
  // RAZA 2026-10-04: "the token dropdown list menu is not the same as stellar. I need it to be
  // identical." Said once before, on 2026-10-02, and answered then by widening this menu — which was
  // the wrong move in the wrong direction, because the two were never the same control to begin with.
  //
  // What was here reused the DESTINATION NETWORK dropdown's classes (.brd / .brd-menu / .brd-opt) and
  // then fought them with inline styles: a fixed 300px wrapper, a balance column down the right, and
  // two section headings. Stellar's picker is none of those things, so no amount of adjustment was
  // going to converge — each pass moved one thing closer and another thing further away. The same trap
  // as the launchpad placeholder, and the same fix: take the real thing rather than redraw it.
  //
  // Stellar's is `#lx-br-amenu`, built in C:\LumosCore\_tools\_cctp.js. Its markup, its class names and
  // its stylesheet are reproduced below EXACTLY as that file writes them — min-width:236px and no fixed
  // width, a 26px round icon, a 14px/600 ticker over an 11px monospace issuer line, rows that are flex
  // buttons padded 8px/10px, a search field on top and a 264px scroll area. Anchored the same way too:
  // appended to <body> and positioned from getBoundingClientRect, which is what keeps it clear of the
  // transform each .br-step carries for its slide.
  //
  // THREE THINGS STELLAR'S MENU DOES NOT HAVE, now gone from this one:
  //   * the per-row balance. The figure is still on the row above the menu ("Available to send"), which
  //     is where Stellar shows it too, so nothing is lost by dropping the column.
  //   * the "Swapped to XRP first" / "Major XRP Ledger assets" headings. The swap they announce is real,
  //     but the menu is not the only place it is said: picking one of these assets puts an explicit note
  //     in the Review step, before anything is signed, and every such row still carries the tooltip. A
  //     heading that exists on one chain and not the other is exactly the difference being reported.
  //   * pool shares. They were listed greyed-out and unpickable; an LP share cannot be the source of a
  //     bridge, so it is not an option, and Stellar's list has no disabled rows in it.
  var AMENU_CSS = '.lx-br-amenu{background:var(--surface-2,#fff);border:1px solid var(--border,#ececef);border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,.28);padding:6px;font:inherit;color:var(--text,#0e0e10)}'
    + '.lx-amsearch{padding:4px 4px 6px}'
    + '.lx-amq{width:100%;box-sizing:border-box;background:var(--surface,#f6f7f9);border:1px solid var(--border,#ececef);border-radius:9px;color:var(--text,#0e0e10);font:inherit;font-size:13px;padding:8px 10px;outline:none}'
    + '.lx-amq::placeholder{color:var(--text-soft,#8a90a2)}'
    + '.lx-amq:focus{border-color:rgba(234,106,44,.55);box-shadow:0 0 0 3px rgba(234,106,44,.1)}'
    + '.lx-amlist{max-height:264px;overflow:auto}'
    + '.lx-br-amenu button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}'
    + '.lx-br-amenu button:hover{background:var(--surface,#f4f5f7)}'
    + '.lx-br-amenu .aic{width:26px;height:26px;border-radius:50%;overflow:hidden;display:inline-flex;flex:0 0 26px;background:var(--surface,#f0f1f4)}'
    + '.lx-br-amenu .aic img{width:100%;height:100%;object-fit:cover;display:block}'
    + '.lx-br-amenu .atx{display:flex;flex-direction:column;line-height:1.25;min-width:0}'
    + '.lx-br-amenu .anm{font-size:14px;font-weight:600}'
    + '.lx-br-amenu .aiss{font-size:11px;color:var(--text-soft,#8a90a2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}';

  function amenuCss() {
    if (document.getElementById('lx-br-amenu-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-br-amenu-css';
    st.textContent = AMENU_CSS;
    document.head.appendChild(st);
  }

  function closeSrcMenu() {
    var m = document.getElementById('lx-br-amenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function toggleSrcMenu(as) {
    if (document.getElementById('lx-br-amenu')) { closeSrcMenu(); return; }
    vLoad();            // the verified roster, in time for the rows below or applied when it lands
    // directAssets, not sourceAssets: sourceAssets now CONTAINS the swap entries, and the swap
    // section below adds them again -- which listed every token twice.
    var list = directAssets().filter(function (a) { return !a.lp; });
    var other = labelHoldings(otherHoldings()).filter(function (a) { return !a.lp; });
    if (list.length < 2 && !other.length) return;

    amenuCss();
    var m = document.createElement('div');
    m.id = 'lx-br-amenu';
    m.className = 'lx-br-amenu';
    m.style.cssText = 'position:absolute;z-index:99999;min-width:236px;display:block';
    m.innerHTML = '<div class="lx-amsearch"><input class="lx-amq" type="text" placeholder="Search asset or issuer" spellcheck="false" autocomplete="off" aria-label="Search assets"></div>'
      + '<div class="lx-amlist"></div>';
    document.body.appendChild(m);

    var listHost = m.querySelector('.lx-amlist');
    var q = m.querySelector('.lx-amq');

    // The second line. Stellar's shows the issuer's address; this shows the issuer's NAME when the
    // roster knows it and falls back to the same shortened address when it does not -- a ticker is not
    // an identity on this ledger, and the name is the part that settles which LUMOS this is.
    function subOf(a) {
      if (a.native) return 'Native asset';
      if (a.issuerName) return a.issuerName;
      if (a.issuer) return String(a.issuer).slice(0, 6) + '\u2026' + String(a.issuer).slice(-4);
      return '';
    }

    // ONE BUILDER FOR EVERY ROW, so the held assets and the curated roster cannot drift apart. The row
    // is a <button>, which is also what keeps the logo healer off the ticker: it repaints short text
    // wherever it finds it, and data-logoed alone does not stop its second pass.
    function optRow(a, onPick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-q', (String(a.symbol || '') + ' ' + String(a.issuerName || '') + ' ' + String(a.issuer || '')).toLowerCase());

      var ic = document.createElement('span');
      ic.className = 'aic';
      setIcon(ic, rowLogo(a), a.symbol, true);

      var tx = document.createElement('span');
      tx.className = 'atx';
      tx.setAttribute('data-logo', '');
      tx.setAttribute('data-logoed', '1');

      var nm = document.createElement('span');
      nm.className = 'anm';
      nm.setAttribute('data-logo', ''); nm.setAttribute('data-logoed', '1');
      nm.setAttribute('data-vk', vKey(a));          // so a late roster can tick this row afterwards
      nm.textContent = a.symbol;
      if (isVerified(a)) nm.appendChild(vBadge());

      var iss = document.createElement('span');
      iss.className = 'aiss';
      iss.setAttribute('data-logoed', '1');
      iss.textContent = subOf(a);

      tx.appendChild(nm);
      if (iss.textContent) tx.appendChild(iss);
      b.appendChild(ic); b.appendChild(tx);

      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        // THE MENU CLOSES EVEN IF THE PICK THROWS.
        //
        // RAZA 2026-10-18, from a user report: "UI hangs when selecting assets other than XRP (e.g.
        // USDC, SHX, LUMOS) ... The asset dropdown remains stuck open, and the interface becomes
        // completely unresponsive."
        //
        // NOT REPRODUCED, and this is a guard rather than a fix — said plainly so nobody later reads
        // it as the cure. Tried on production against a 60-line account: Base and Ethereum
        // destinations, with and without an amount typed, picking USDC, SHX, RLUSD and LUMOS. Every
        // pick returned in 107-386ms, closed the menu and raised no error.
        //
        // What IS true without needing a repro: onPick runs before closeSrcMenu, so anything it
        // throws leaves the dropdown open over a page that cannot be dismissed — which is precisely
        // the reported shape. `finally` makes that state unreachable. The error is deliberately NOT
        // caught: it still reaches window.onerror, because a swallowed exception here would be the
        // next silent failure ([[lumoscore-silent-failures]]).
        //
        // If the hang is instead a synchronous loop further down (refreshDestinations/paintSteps/
        // requote), this changes nothing and the report stands open — a frozen page cannot repaint,
        // so a closed menu would still LOOK open. Needs the reporter's exact steps.
        try { onPick(a); } finally { closeSrcMenu(); }
        refreshDestinations();
        paintSteps(); requote();
      });
      return b;
    }

    function render() {
      listHost.innerHTML = '';
      var shown = 0;

      list.forEach(function (a) {
        shown++;
        listHost.appendChild(optRow(a, function (picked) {
          SRC = picked; QUOTE = null; AXQ = null;
          // Choosing a source is choosing what the history will name, so a capture left over from a
          // transfer that did not complete is discarded here rather than carried into this one.
          SWAP_LEG = null;
        }));
      });

      // Everything else the wallet holds. Picking one puts a swap to XRP in front of the transfer --
      // said in the Review step and in this row's tooltip, no longer in a heading Stellar does not have.
      other.forEach(function (o) {
        shown++;
        var row = optRow(o, function () {
          SRC = sourceAssets().filter(function (x) {
            return x.viaSwap && x.currency === o.currency && x.issuer === o.issuer;
          })[0] || SRC;
          QUOTE = null; AXQ = null; THQ = null; SWAPQ = null; SWAP_LEG = null;
        });
        row.title = o.symbol + ' is swapped to XRP on the XRP Ledger, then bridged';
        listHost.appendChild(row);
      });

      // THE MAJOR TOKENS, HELD OR NOT (RAZA 2026-10-01: "its not showing the assets (10 assets) that I
      // asked for"). The balance on these is 0 and that is the honest number -- the Review gate refuses
      // to go anywhere without an amount, so nothing can be sent that is not there. Anything the wallet
      // actually holds is already above and is filtered out here, so no token appears twice.
      var held = {};
      list.concat(other).forEach(function (a) { held[String(a.currency) + '|' + String(a.issuer)] = 1; });
      (CURATED || []).forEach(function (t) {
        if (held[String(t.currency) + '|' + String(t.issuer)]) return;
        shown++;
        var row = optRow(t, function (picked) {
          SRC = picked; QUOTE = null; AXQ = null; THQ = null; SWAPQ = null; SWAP_LEG = null;
        });
        row.title = t.symbol + ' is swapped to XRP on the XRP Ledger, then bridged';
        listHost.appendChild(row);
      });

      var em = document.createElement('div');
      em.className = 'lx-amempty';
      em.setAttribute('data-logoed', '1');
      em.hidden = true;
      em.style.cssText = 'padding:14px 12px;font-size:13px;color:var(--text-soft)';
      em.textContent = 'No asset matches that.';
      listHost.appendChild(em);
      if (!shown) em.hidden = false;
      filter();
    }

    // Show/hide rather than rebuild, the way Stellar's filters: the rows keep their listeners and the
    // list does not flicker under the cursor.
    function filter() {
      var v = (q.value || '').trim().toLowerCase(), shown = 0;
      [].slice.call(listHost.querySelectorAll('button[data-q]')).forEach(function (b) {
        var ok = !v || (b.getAttribute('data-q') || '').indexOf(v) >= 0;
        b.style.display = ok ? 'flex' : 'none';
        if (ok) shown++;
      });
      var em = listHost.querySelector('.lx-amempty');
      if (em) em.hidden = shown > 0;
    }

    q.addEventListener('input', filter);
    q.addEventListener('click', function (e) { e.stopPropagation(); });
    q.addEventListener('keydown', function (e) { e.stopPropagation(); });

    render();
    // The roster is a network read, so the menu opens on what is already known and fills in when it
    // lands. Re-rendered through the current filter so a search typed in the meantime is not undone.
    curatedTokens().then(function () {
      if (!document.getElementById('lx-br-amenu')) return;   // closed while it was in flight
      // NAME THE ISSUERS THE WALLET ALREADY HOLDS. otherHoldings() reads trust lines, which carry an
      // address and nothing else, so a held USDC had no "Circle" on it and the field's own promise --
      // "Search asset or issuer" -- was only half true: typing an issuer found the curated rows and
      // silently missed every row above them. The roster knows the names, so they are borrowed here.
      var byKey = {};
      (CURATED || []).forEach(function (t) { byKey[String(t.currency) + '|' + String(t.issuer)] = t.issuerName; });
      list.concat(other).forEach(function (a) {
        if (a.issuerName) return;
        var n = byKey[String(a.currency) + '|' + String(a.issuer)];
        if (n) a.issuerName = n;
      });
      render();
    });

    // Positioned from the chip's rect against the document, the way Stellar's is. The menu lives in
    // <body> rather than inside the step: each .br-step carries a transform for its slide, and a
    // positioned child of a transformed element is trapped inside it.
    var r = as.getBoundingClientRect();
    var left = r.left + window.scrollX;
    var maxL = window.scrollX + document.documentElement.clientWidth - m.offsetWidth - 8;
    m.style.left = Math.max(window.scrollX + 8, Math.min(maxL, left)) + 'px';
    m.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setTimeout(function () { try { q.focus(); } catch (_) {} }, 20);

    setTimeout(function () {
      document.addEventListener('click', function away(e) {
        if (e.target && e.target.closest && e.target.closest('#lx-br-amenu')) return;
        closeSrcMenu();
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
  // THE SOURCE TOKEN'S OWN PRICE, ASKED FOR (RAZA 2026-10-09: "it doesn't show $value when i input in
  // Available to send like it does on Stellar. it does show if i select XRP as the source asset, but
  // when i select any asset, it disappears").
  //
  // The blank this replaces was the right answer to an earlier bug and the wrong answer to the
  // question. This line used to multiply the typed amount by ORIGIN.price — 1Click's XRP entry —
  // whatever was selected, so 0.1 ATOM read "~ $0.15" and 72.58 PHNIX read "~ $109.59": the XRP price
  // wearing another ticker. Blanking it stopped the lie, and the note said an issued token's USD value
  // "is not something this page knows". It is, through the same endpoint the rest of this build prices
  // tokens with; it just had not been asked.
  //
  // /lxapi/xrplprices with a single `<issuer>-<currency>` slug, exactly as account.js asks for a pool's
  // two sides, and the same reading of the answer: row[0] is the token's price IN XRP and j.usd is
  // XRP in dollars, so the dollar value is amount x row[0] x usdPerXrp. ORIGIN.price supplies the last
  // term, which is what the native branch has always used.
  //
  // CACHED PER SLUG AND ASKED ONCE, including the failures. This runs on every keystroke through
  // requote(), and an uncached lookup would be a request per character against an upstream that
  // rate-limits. A slug that comes back unpriced is remembered as 0 and renders blank — the old
  // behaviour, for the tokens where it was the honest one.
  var TOKEN_XRP = {};
  // A currency over three characters lives on the ledger as forty hex digits, and the price endpoint
  // is keyed on the LEDGER form: measured against it, `<issuer>-4C554D4F5300…` returns LUMOS at
  // 0.0000245 XRP while `<issuer>-LUMOS` returns nothing at all. Which of the two SRC carries is not
  // worth asserting from here, so both are asked for in the one request — the endpoint takes a comma
  // list — and whichever answers is used. One request either way.
  function hexCurrency(c) {
    var s = String(c || '');
    if (s.length <= 3 || /^[0-9A-Fa-f]{40}$/.test(s)) return '';
    var h = '';
    for (var i = 0; i < s.length && i < 20; i++) {
      var x = s.charCodeAt(i).toString(16).toUpperCase();
      h += x.length < 2 ? ('0' + x) : x;
    }
    while (h.length < 40) h += '0';
    return h;
  }
  function srcSlugs() {
    if (!SRC || SRC.native || !SRC.issuer || !SRC.currency) return [];
    var out = [SRC.issuer + '-' + SRC.currency];
    var hx = hexCurrency(SRC.currency);
    if (hx) out.push(SRC.issuer + '-' + hx);
    return out;
  }
  function fetchSrcPrice(key, slugs) {
    if (!key || TOKEN_XRP[key] !== undefined) return;
    TOKEN_XRP[key] = null;                     // in flight: never asked twice
    fetch('/lxapi/xrplprices?t=' + encodeURIComponent(slugs.join(',')))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var px = 0;
        if (j && j.ok && j.t) {
          for (var i = 0; i < slugs.length; i++) {
            var row = j.t[slugs[i]];
            if (row && Number(row[0]) > 0) { px = Number(row[0]); break; }
          }
        }
        TOKEN_XRP[key] = px;
        try { paintSourceUsd(); } catch (_) {}
      })
      .catch(function () { TOKEN_XRP[key] = 0; });
  }

  function paintSourceUsd() {
    var s2 = $('.br-step[data-step="2"]');
    var side = s2 && s2.querySelectorAll('.br-side')[0];
    var u = side && side.querySelector('.br-amt .usd');
    if (!u) return;
    var amt = amountXrp(), px = ORIGIN && Number(ORIGIN.price);
    var native = !SRC || SRC.native;
    var usd = null;
    if (native) {
      if (amt && px) usd = amt * px;
    } else {
      var slugs = srcSlugs(), k = slugs[0] || '';
      if (k && TOKEN_XRP[k] === undefined) fetchSrcPrice(k, slugs);
      var tp = k ? TOKEN_XRP[k] : 0;
      if (amt && px && tp > 0) usd = amt * tp * px;
    }
    u.textContent = usd != null ? ('~ $' + fmt(usd, 2)) : '';
  }

  // Fee and time, in the review list's OWN row markup (`.r` > `.k` + `.v`) rather than a panel of our
  // own. The design ships four such rows and no slot for either number, and a bridge that does not
  // state its fee before the irreversible step is not one worth shipping.
  function ensureReviewRows() {
    var dst = $('[data-rv="dst"]');
    var host = dst && dst.parentElement && dst.parentElement.parentElement;
    if (!host || host.querySelector('[data-rv="fee"]')) return;
    // A ROW OF ITS OWN FOR AXELAR'S RELAY FEE (RAZA 2026-10-19: "why is it costing over 6%"). Sending
    // 1 XRP to Hedera delivered 0.938823, and nothing on this screen accounted for the missing
    // 0.060177 -- the fee row showed LumosCore's 0.001 and the relay fee was simply not printed, so
    // three fee-ish rows were on screen and none of them was the number that explained the total.
    //
    // It is not our charge and it is not a percentage: Axelar's validators split the payment,
    // transfer_amount = Amount - gas_fee_amount, to pay for execution on the destination chain. Flat,
    // so it is 6% of 1 XRP and 0.06% of 100. That is exactly why it has to be stated rather than
    // folded into a rate -- a reader cannot infer a fixed cost from a percentage.
    //
    // Hidden on the other two routes, where there is no such fee to name.
    [['route', 'Route'], ['fee', 'LumosCore fee'], ['relay', 'Axelar relay fee'], ['eta', 'Estimated time']].forEach(function (p) {
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

  // THE XRP A ROUTE WILL ACTUALLY BE HANDED.
  //
  // For a direct source that is what was typed. For a swapped one the typed figure is in the SOURCE
  // asset -- 1,000 LUMOS -- and what reaches the route is whatever the ledger pays for it, so every
  // downstream quote has to read this rather than the input. Zero until the swap has been priced,
  // which is correct: there is nothing to quote a bridge on until then.
  function bridgeXrp() {
    if (SRC && SRC.viaSwap) {
      // THE SWAP QUOTE MUST BELONG TO WHAT IS TYPED NOW (RAZA 2026-10-05: "obviously the 'You will
      // Receive' is not correct" -- ~1.536709 POL shown for 0.1, 0.2 AND 0.01 ATOM, a figure that never
      // moved).
      //
      // This returned SWAPQ.out whenever one existed, with no check of WHAT it had priced. SWAPQ is
      // only replaced when a new path-find comes back, so between keystrokes -- and for good after any
      // attempt that fails, which over-balance amounts on a thin book do -- the last successful figure
      // kept driving the receive line, the minimum check, netDrops() and the review. A number that does
      // not move when the amount does is worse than no number: it is a quote for a transfer nobody
      // asked for.
      //
      // Matched on amount AND identity. The identity test is the same one doQuote uses to decide
      // whether to re-price, and for the same reason: two tokens called LUMOS from different issuers
      // are different assets, and paintSourceAsset rebuilds SRC into a new object on every repaint, so
      // comparing the objects proves nothing.
      // AND NOT AT ALL ABOVE THE BALANCE, because the ledger cannot price that.
      //
      // ripple_path_find answers "what can THIS ACCOUNT send", not "what is this amount worth", so it
      // caps at the holding. Measured on a wallet with 21,038 PHNIX: send_max 1,000 -> 0.007008 XRP,
      // 21,000 -> 0.147164, and both 100,000 AND 500,000 -> 0.147434. Past the balance the answer stops
      // moving, which is why 0.01, 0.1, 0.2 and 0.5 ATOM -- every one of them above RAZA's 0.000154 --
      // all produced the same receive figure. Matching the quote to the typed amount was necessary but
      // not sufficient: the quote genuinely IS for that amount, it is just capped.
      //
      // So there is no honest figure to show, and showing the capped one presents a quote for what the
      // wallet holds as a quote for what was typed. The red banner already says the amount exceeds the
      // balance; the receive line says nothing rather than something wrong. (The Trade page answers a
      // DIFFERENT question -- what 0.5 ATOM is worth in the pool, balance or no balance -- which is why
      // it can quote 158 XRP where this cannot.)
      var held = (SRC.balance != null) ? SRC.balance : null;
      if (held != null && amountXrp() > held) return 0;
      if (!SWAPQ || !(SWAPQ.out > 0)) return 0;
      if (SWAPQ.amt !== amountXrp()) return 0;
      var f = SWAPQ.from;
      if (!f || String(f.currency) !== String(SRC.currency) || String(f.issuer) !== String(SRC.issuer)) return 0;
      return SWAPQ.out;
    }
    return amountXrp();
  }

  var qSeq = 0, qTimer = null;
  function requote() {
    clearTimeout(qTimer);
    qTimer = setTimeout(doQuote, 350);
  }
  // THE SWAP IS PRICED BEFORE ANY ROUTE IS ASKED, because until it is there is no XRP figure to ask
  // a route about. One extra ripple_path_find, and only for a swapped source.
  // The pool's answer for a swapped source, kept apart from SWAPQ so it can never reach a transaction.
  // Keyed by issuer/currency/amount, for the same reason SWAPQ is: SRC is a new object every repaint.
  var SIMQ = null, simSeq = 0;
  function simulateSwapLeg(src, amt) {
    if (SIMQ && SIMQ.amt === amt
      && String(SIMQ.currency) === String(src.currency) && String(SIMQ.issuer) === String(src.issuer)) return;
    if (!window.lxx || !window.lxx.simulateSwap) { SIMQ = null; return; }
    var my = ++simSeq;
    SIMQ = null;
    window.lxx.simulateSwap(rpcT, {
      buying: false, amount: amt, token: { currency: src.currency, issuer: src.issuer },
    }).then(function (r) {
      if (my !== simSeq) return;                         // a newer amount won
      SIMQ = (r && r.out > 0)
        ? { currency: src.currency, issuer: src.issuer, amt: amt, out: r.out, impact: r.impact }
        : null;
      try { paintQuote(QUOTE, ''); } catch (_) {}
    }, function () { if (my === simSeq) SIMQ = null; });
  }
  // The XRP a swapped source would fetch for display: the router's answer when it has one, the pool's
  // when it does not. Never used to build a transaction -- see bridgeXrp(), which stays strict.
  function displayXrp() {
    var real = bridgeXrp();
    if (real > 0) return real;
    if (!SRC || !SRC.viaSwap || !SIMQ) return 0;
    if (SIMQ.amt !== amountXrp()) return 0;
    if (String(SIMQ.currency) !== String(SRC.currency) || String(SIMQ.issuer) !== String(SRC.issuer)) return 0;
    return SIMQ.out;
  }

  function doQuote() {
    if (SRC && SRC.viaSwap) {
      var typed = amountXrp();
      if (!(typed > 0)) { SWAPQ = null; return runQuote(); }
      // BY IDENTITY, NOT BY OBJECT. paintSourceAsset rebuilds SRC into a NEW object on every repaint,
      // so `SWAPQ.from === SRC` was never true after the first paint -- the swap was re-priced on
      // every keystroke and, worse, SWAPQ went null for the round trip. Arriving at the review, which
      // re-quotes, that made it read "0 LUMOS" and "for about 0 XRP" until the path-find came back.
      var sameSrc = SWAPQ && SWAPQ.from
        && String(SWAPQ.from.currency) === String(SRC.currency)
        && String(SWAPQ.from.issuer) === String(SRC.issuer);
      if (sameSrc && SWAPQ.amt === typed) return runQuote();
      // MORE THAN THE WALLET HOLDS: ASK THE POOL, NOT THE ROUTER (RAZA 2026-10-05: "WHy its not
      // calculating 'You will receive'", 0.25 ATOM against a 0.000154 balance).
      //
      // ripple_path_find caps at the holding, so it cannot answer this and the figure was blanked --
      // honest, but it left the reader with nothing where the Trade page, on the same token, happily
      // quotes 158.07 XRP for 0.5 ATOM. That page reads the pair's AMM pool and order book directly,
      // which does not care what anyone holds, and that function now lives in xrpl-core.js so this can
      // ask the same question and get the same number.
      //
      // DISPLAY ONLY, and the separation is deliberate: SIMQ never becomes SWAPQ, bridgeXrp() never
      // reads it, and nothing signable is built from it. The transfer stays refused by the balance
      // banner. It answers "what would this be worth", which is what someone typing an amount they do
      // not yet hold is asking.
      SWAPQ = null;
      var held = (SRC.balance != null) ? SRC.balance : null;
      if (held != null && typed > held) { simulateSwapLeg(SRC, typed); return runQuote(); }
      SIMQ = null;
      QUOTING = true;
      paintQuote(null, 'Pricing the swap to XRP…');
      var mySeq = ++qSeq;
      return quoteSwap(SRC, typed).then(function (q) {
        if (mySeq !== qSeq) return;                      // a newer keystroke won
        SWAPQ = q;
        if (!q) { QUOTING = false; paintQuote(null, 'No route from ' + SRC.symbol + ' to XRP for that amount.'); return; }
        runQuote();
      });
    }
    SWAPQ = null;
    return runQuote();
  }

  function runQuote() {
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
    // THORCHAIN DELIVERS THE CHAIN'S NATIVE COIN AND NOTHING ELSE, so it cannot be the route for a
    // destination asset that is not that coin (RAZA 2026-10-04: "Why cant i select thorchain", which
    // led here). Measured on 7b9d85a0 before this: XRP -> Avalanche with USDC chosen, NEAR Intents
    // refusing the pair and THORChain quoting, left the asset chip reading "USDC / USD Coin" above a
    // figure of "~ 6.73031335 AVAX". The number was right and the label was a different asset -- which
    // this file's own notes call the most dangerous way for a bridge to be wrong, about the Cosmos Hub
    // case, in a guard that only covered chains where NEAR Intents is not offered at all.
    var wantsNative = !DEST || !DEST.token || !DEST.token.contractAddress;
    var thOk = THQ && wantsNative;
    var sameAsset = QUOTE && thOk;
    if (sameAsset) BEST = (thOut > niOut) ? 'th' : 'ni';
    else if (QUOTE) BEST = 'ni';
    else if (thOk) BEST = 'th';
    else BEST = '';
    // A HAND-PICKED ROUTE WINS, but only if it actually answered. Honouring a choice whose quote came
    // back empty would leave the page showing a route it cannot send by, with no figures and a live
    // Bridge button -- worse than quietly falling back to the one that did answer.
    if (PICKED && PICKED_FOR === destChain()) {
      // `thOk`, not THQ: a hand-picked THORChain must clear the same asset test, or choosing it by hand
      // would walk straight back into delivering AVAX under a label reading USDC.
      if ((PICKED === 'ni' && QUOTE) || (PICKED === 'th' && thOk) || (PICKED === 'ax' && AXQ)) BEST = PICKED;
    }
    // FROM THE ROUTES' OWN NOTES, NOT FROM LAST_NOTE (RAZA 2026-10-04: "nothing in You will receive",
    // and once the note was made visible it read "Comparing routes…" and stayed there).
    //
    // LAST_NOTE cannot be trusted here, because the placeholder overwrites it. quoteNi() checks the
    // 2 XRP floor SYNCHRONOUSLY -- before its first await -- so by the time runQuote() reaches
    // `paintQuote(null, 'Comparing routes…')` one line later, LAST_NOTE already held "Minimum 2 XRP"
    // and the placeholder clobbered it. Nothing wrote it again, because that route never made a
    // request, so settle() read the placeholder back and published it as the final answer. The page
    // sat on "Comparing routes…" forever while the route panel beside it correctly said why.
    //
    // NOTE.* is per route and is only ever written by a route about itself. NEAR Intents first: when
    // both decline it is the one carrying a number the reader can act on ("Minimum 2 XRP") while
    // THORChain's is a flat refusal.
    paintQuote(BEST === 'ni' ? QUOTE : null, BEST ? '' : quoteReason());
  }

  // WHY THERE IS NO FIGURE, in the words of whichever route declined. Extracted because settle() was
  // not the only place that needed it and the other place passed '' instead — see the route-pick
  // handler, which wiped LAST_NOTE on every click and left the button reading "Waiting for a quote"
  // for good. A reason computed in one place cannot drift from a reason computed in another.
  function quoteReason() {
    return NOTE.ni || NOTE.th || NOTE.ax
      || (LAST_NOTE && LAST_NOTE.indexOf('…') < 0 ? LAST_NOTE : '')
      || 'No route for this amount';
  }

  // Axelar prices the RELAY, not the trade: there is no exchange here, the same asset comes out the
  // other side. So the only unknown is the gas, and what arrives is simply the amount minus it.
  function quoteAx(key) {
    var amt = bridgeXrp();
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
    // THE SWAPPED LEG, NOT THE TOKEN. Asking for a LUMOS relay price returned the endpoint's own
    // "unknown asset" and put it in the red banner under the form — correct of Axelar, and a question
    // this page should never have asked.
    var leg = axLeg();
    fetch(API_AX + '?op=gas&symbol=' + encodeURIComponent(leg.sym) + '&dest=' + encodeURIComponent(chain))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (seq !== qSeq) return;
        if (!j || !j.ok) { done(String((j && j.error) || 'No relay price for this pair')); return; }
        var dp = leg.dp;
        var sent = axUnits(amt, dp);
        if (sent == null) { done('Amount is out of range'); return; }
        var gas = j.gas;
        if (!(Number(gas) < Number(sent))) {
          // Stated as the real reason, with the real number, because "try a larger amount" without one
          // is a guessing game -- the relay fee to Ethereum is over a whole XRP.
          done('Relay fee is ' + fmt(axFromUnits(gas, dp), 6) + ' ' + leg.sym + ' — send more');
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
    var amt = bridgeXrp(), to = recipient();
    var p = PLACES[key];
    var asset = p && p.th && TH_NATIVE[p.th];
    // AHEAD OF THE AMOUNT AND ADDRESS CHECKS, because the halt does not depend on either and the
    // reader is owed the reason whether or not they have finished filling the form. Below them it
    // would have gone unsaid on Cosmos Hub -- served by THORChain alone, so there is no second route
    // whose note the banner could fall back to.
    //
    // Not asked at all while the chain is paused -- the answer is already known, and the round trip
    // only exists to be refused.
    //
    // NOTE.th IS STILL WRITTEN, and skipping that was a bug in the first draft of this. On Cosmos Hub,
    // which THORChain serves alone, a halt means NOTHING can carry the transfer -- and formBanner()
    // builds the red bar under the form out of exactly these notes. Returning early without one left
    // the Review button dead and the bar empty, which this file elsewhere calls out as its own bug: a
    // disabled button with no reason is how somebody concludes the site is broken.
    //
    // Our own sentence rather than THORChain's ("trading is halted, can't process swap"), because it
    // names the chain the reader chose.
    if (thHalted(key)) {
      NOTE.th = 'THORChain has paused ' + (p ? p.label : 'this chain') + ' transfers.';
      return Promise.resolve();
    }
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
    var amt = bridgeXrp(), me = addr();
    if (!amt || !DEST || !chain) return Promise.resolve();
    var n = netDrops(amt);
    if (n.net < MIN_DROPS) { NOTE.ni = LAST_NOTE = 'Minimum ' + fmt(minSendXrp(), 6) + ' XRP'; return Promise.resolve(); }
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
      // THE UNIT TRAVELS WITH THE FIGURE (RAZA 2026-10-04: "why's it showing the receiving amount like
      // this instead of how its being shown on stellar").
      //
      // Stellar renders "~ 1.05 USDC" and gets the ticker from CSS -- `.br-amt .v::after{content:"
      // USDC"}` -- which it can do because CCTP always delivers USDC, so the unit is a constant there.
      // It is not a constant here: this bridge delivers APT, ETH, USDC, USDT, BTC, whatever the
      // destination chain's own token is. Copying the CSS trick would have printed " USDC" after an
      // APT figure, which is worse than no unit at all. So the ticker is written into the text, and the
      // line reads the same as Stellar's by the time it reaches the screen.
      var recvUnit = function (n, dp, sym) { return '~ ' + fmt(n, dp) + (sym ? ' ' + sym : ''); };
      // AN INDICATIVE FIGURE WHILE THERE IS NO QUOTE, because that is what Stellar shows and I was
      // wrong about why (RAZA: "you're not showing You will receive like you do on Stellar").
      //
      // I had argued the two could not match because every route here is solver-priced and needs a
      // recipient. Look at his screenshot again: Stellar prints "~ 11.03 USDC" with the address field
      // EMPTY and an amount larger than the balance. It is not quoting either -- it is arithmetic,
      // amount minus the 0.2% fee, which CCTP can do because it delivers the same asset it took.
      //
      // The same arithmetic works here, it just needs one more step, because the asset changes: the
      // XRP that reaches the route, converted at the two prices 1Click already publishes in its token
      // list. It is an estimate and it says so with the same tilde Stellar uses, and the moment a real
      // quote lands it is replaced by the solver's own number.
      var estimate = function () {
        if (!DEST || !DEST.token) return null;
        var px = ORIGIN && Number(ORIGIN.price), dpx = Number(DEST.token.price);
        if (!(px > 0) || !(dpx > 0)) return null;
        // displayXrp(), not bridgeXrp(): this line is an estimate and may use the pool's answer for an
        // amount the wallet does not hold. What can be SENT is a different question and bridgeXrp()
        // still answers it strictly.
        var xrp = displayXrp();
        if (!(xrp > 0)) return null;
        return { amt: (netDrops(xrp).net / 1e6) * px / dpx, sym: DEST.token.symbol };
      };
      if (AXQ) {
        // The RECEIVE line names what arrives; the relay fee below it stays in the sent asset,
        // because that is the denomination it is actually deducted in before the bridge mints.
        if (v) v.textContent = recvUnit(AXQ.delivered, 6, axRecv(destChain()));
        if (u) u.textContent = 'after ' + fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + axLeg().sym + ' relay fee';
      } else if (BEST === 'th' && THQ) {
        // NAMED, because the page has just chosen on the reader's behalf. When both routes answered,
        // saying which one won and that it was the better price is the difference between a decision
        // and a black box.
        if (v) v.textContent = recvUnit(Number(THQ.expected) / (THQ.e8 || 1e8), 8, THQ.symbol);
        if (u) u.textContent = 'via THORChain' + (QUOTE ? ' — better price' : '')
          + (THQ.seconds != null ? (' · ~' + THQ.seconds + 's') : '');
      } else {
        var est = q ? null : estimate();
        if (v) v.textContent = q
          ? recvUnit(q.amountOutFormatted, 6, (DEST && DEST.token) ? DEST.token.symbol : '')
          : (est ? recvUnit(est.amt, 6, est.sym) : '—');
        if (u) u.textContent = q ? ('~ $' + fmt(q.amountOutUsd, 2)) : (note || '');
      }
      // The note stays in the node for the route panel's sake and is NOT revealed here: the column is
      // two lines on Stellar and has to be two lines here. See _xrplbridgepolish.js for the full
      // reasoning -- the reason for a missing figure belongs on the route card, which already carries
      // it, and lifting it here made the same information appear twice on one chain and once on the
      // other. Cleared rather than left set, so a stale class cannot survive a rebuild of this node.
      if (u) u.classList.remove('lx-amtnote');
    }
    paintReview(q, note);
    paintRoutePanel();
    setCta();
  }

  function paintReview(q, note) {
    var amt = bridgeXrp(), n = netDrops(amt);
    var sym = SRC ? SRC.symbol : 'XRP';
    var set = function (sel, txt) { var e = $(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    // A FIGURE IS NOT ERASED WHILE ITS REPLACEMENT IS BEING FETCHED.
    //
    // Advancing to review re-quotes -- correctly, because a quote goes stale and the freshest number
    // belongs on the screen where someone commits. But the re-quote nulls QUOTE/THQ/AXQ first, so the
    // review painted "You receive —", "Route —", "Estimated time —" for about a second and a half
    // before the new answer landed. Dashes on a confirmation screen read as "this transfer has no
    // value and no route", which is the wrong thing to show someone a moment before they sign.
    //
    // While a quote is in flight the last figures stay put. That is safe because the CTA is on
    // "Quoting…" and cannot be pressed, and because a refusal still clears them: `keep` only defers
    // the placeholder, it never suppresses a real answer.
    var keep = function (sel, txt) {
      if (QUOTING && !QUOTE && !THQ && !AXQ) {
        var e0 = $(sel);
        if (e0 && e0.textContent && e0.textContent !== '—' && e0.textContent.indexOf('—') !== 0) return;
      }
      set(sel, txt);
    };
    set('[data-rv="send"]', amt ? (fmt(amt, 6) + ' ' + sym) : ('0 ' + sym));
    if (AXQ) {
      // Same asset in and out; what changes is the amount.
      // axLeg(), not `sym`: `sym` is the SOURCE, which is what the send row above wants and what the
      // receive row wants only when Axelar was handed the token itself. A swapped source arrives as
      // XRP. (The send row for that case is rewritten with the typed token lower down, so it keeps
      // naming what the reader actually chose.)
      set('[data-rv="recv"]', fmt(AXQ.delivered, 6) + ' ' + axRecv(destChain()));
    } else if (BEST === 'th' && THQ) {
      set('[data-rv="recv"]', fmt(Number(THQ.expected) / (THQ.e8 || 1e8), 8) + ' ' + THQ.symbol);
    } else {
      keep('[data-rv="recv"]', q ? (fmt(q.amountOutFormatted, 6) + ' ' + DEST.token.symbol)
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
        // An XRP source now pays the normal platform fee, so the row says so -- it is labelled
        // "LumosCore fee" and printing Axelar's relay fee under that label was always a little wrong.
        // Token sources still pay us nothing, so for those it keeps naming the relay fee instead of
        // showing a zero that looks like an error.
        // OUR CUT ONLY, now that the relay fee has a row of its own below. A token source pays us
        // nothing -- the collector holds no trust lines, so a percentage of a WETH transfer could only
        // be taken at a rate nobody quoted -- and that is said in words rather than as a zero, which
        // reads as a figure that failed to load.
        // A SWAPPED SOURCE PAYS IT TOO. The "None on this route" case is for an ISSUED TOKEN handed
        // straight to Axelar; a token sold to XRP first reaches sendAx as plain XRP and is charged
        // like any other XRP transfer, so saying "None" here understated the cost on the last screen
        // before a signature.
        if (SRC && (SRC.native || SRC.viaSwap) && amt) {
          f.textContent = fmt(n.fee / 1e6, 6) + ' XRP (' + (feeRate() * 100).toFixed(1) + '%)';
        } else {
          f.textContent = 'None on this route';
        }
      } else {
        f.textContent = amt ? (fmt(n.fee / 1e6, 6) + ' XRP (' + (feeRate() * 100).toFixed(1) + '%)') : '—';
      }
    }
    // The relay row: shown with its real figure on Axelar, removed from the list entirely on the other
    // routes rather than left saying "—", which would imply a charge that was not quoted yet.
    var rl = $('[data-rv="relay"]');
    if (rl) {
      var rlRow = rl.closest ? rl.closest('.r') : null;
      if (AXQ) {
        rl.textContent = fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + axLeg().sym;
        if (rlRow) rlRow.style.display = '';
      } else if (rlRow) {
        rlRow.style.display = 'none';
      }
    }
    keep('[data-rv="eta"]', AXQ ? 'a few minutes'
      : (BEST === 'th' && THQ && THQ.seconds != null) ? ('~' + THQ.seconds + 's')
      : (q && q.timeEstimate) ? ('~' + q.timeEstimate + 's') : '—');
    // Which route is carrying this, said plainly. Three routes behind one wizard means the page is
    // making a choice, and a reader is entitled to know which.
    keep('[data-rv="route"]', AXQ ? 'Axelar' : BEST === 'th' ? 'THORChain'
      : BEST === 'ni' ? 'NEAR Intents' : '—');
    // A SWAPPED SOURCE SENDS TWO SIGNATURES, and the review is where that is said -- with what the
    // swap is expected to fetch, and what happens if the second half does not go through. Someone
    // who signs once and stops should not be surprised by what they are holding.
    if (SRC && SRC.viaSwap) {
      // The typed figure, unconditionally. `amt` is the XRP the swap will fetch, and gating on it
      // printed "0 LUMOS" for the second the review spends re-pricing.
      var typedSrc = amountXrp();
      set('[data-rv="send"]', (typedSrc > 0 ? fmt(typedSrc, 6) : '0') + ' ' + SRC.symbol);
      var host = $('[data-rv="route"]');
      host = host && host.closest('.br-rv-row, .br-rv-leg, div');
      var note = $('.lx-swapnote');
      if (!note && host && host.parentNode) {
        note = document.createElement('div');
        note.className = 'lx-swapnote';
        note.style.cssText = 'margin-top:12px;padding:11px 13px;border-radius:11px;'
          + 'border:1px solid var(--border);background:var(--surface-2);'
          + 'font:400 12.5px/1.45 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
        host.parentNode.appendChild(note);
      }
      if (note) {
        var got = SWAPQ && SWAPQ.out > 0 ? (fmt(SWAPQ.out, 6) + ' XRP') : 'the XRP it fetches';
        note.textContent = 'Two signatures: first ' + fmt(typedSrc, 6) + ' ' + SRC.symbol
          + ' is swapped on the XRP Ledger for about ' + got
          + ', then that is bridged. If the second one does not go through you keep the XRP.';
      }
    } else {
      var old = $('.lx-swapnote');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    paintReviewLegs();
  }

  // THE REVIEW'S LOGOS, BOTH SLOTS ON BOTH LEGS.
  //
  // Each .br-rv-leg has two icon slots: .ic.lx-rvnet for the NETWORK and a bare .ic for the ASSET.
  // Nothing in this build was filling the asset slots, so they still held what the design baked in --
  // and on the receive leg that is a hardcoded XRP mark. Bridging to Cosmos Hub showed an XRP logo
  // beside the words "4.157246 ATOM", on the last screen before a signature. Same failure as the
  // step-2 label bug, one screen later and with the money committed.
  //
  // The network slots were being filled, by an INHERITED Stellar script (lx-bridge3js) that copies
  // innerHTML out of the source wallet chip and the destination trigger. On the send leg that chip
  // holds the XRP TOKEN logo here, so it was putting a token mark in a network slot. That script is
  // stripped at build now: it was a second writer for nodes this file has to own anyway, and two
  // layers painting one wizard is how this page came to offer routes it did not have.
  function paintReviewLegs() {
    var s3 = $('.br-step[data-step="3"]');
    if (!s3) return;
    var legs = s3.querySelectorAll('.br-rv-leg');
    if (legs.length < 2) return;
    var key = destChain();
    var place = key && PLACES[key] ? PLACES[key].label : '';
    // What ARRIVES, by the same rule paintDestAsset uses -- never assumed to be what was sent.
    var recvSym = '';
    if (AXQ) recvSym = axRecv(key);
    else if (BEST === 'th' && THQ) recvSym = THQ.symbol;
    else if (DEST && DEST.token) recvSym = DEST.token.symbol;

    var put = function (host, src, fallback) {
      if (!host) return;
      host.setAttribute('data-logo', '');
      host.setAttribute('data-logoed', '1');
      if (!src) { if (fallback) markLetters(host, fallback); return; }
      var img = host.querySelector('img.lx-rvimg');
      if (!img) {
        host.textContent = '';
        img = document.createElement('img');
        img.className = 'lx-rvimg';
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block';
        host.appendChild(img);
      }
      if (img.getAttribute('src') !== src) img.src = src;
    };
    var slots = function (leg) {
      var all = leg.querySelectorAll('.v .ic');
      var net = leg.querySelector('.v .ic.lx-rvnet');
      var asset = null;
      for (var i = 0; i < all.length; i++) if (all[i] !== net) { asset = all[i]; break; }
      return { net: net, asset: asset };
    };

    var a = slots(legs[0]), b = slots(legs[1]);
    put(a.net, netFile('XRP Ledger'), 'XRP');
    put(a.asset, SRC ? symLogo(SRC.symbol) : '', SRC ? SRC.symbol : '');
    put(b.net, netFile(place), place);
    put(b.asset, symLogo(recvSym), recvSym);
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
  // 1Click's own cut, in basis points. Stellar's niFeeBps() returns 20 on its keyed path and 25
  // unkeyed; this build sends ONECLICK_JWT, so 20 is the rate that applies and the figure Stellar
  // prints beside the same route.
  var NI_FEE_BPS = 20;
  // Stellar's own ~30 seconds for this route, from _nearintents.js (`etaSeconds: 30, etaText:
  // '~30 seconds'`). It is a property of the route rather than of a quote, which is why Stellar can
  // print it before anything has been priced and this build was showing a dash.
  var NI_ETA = '~30 seconds';
  // THE OTHER TWO ROUTES HAVE A TIME TOO (RAZA 2026-10-23: "Why doesnt thor chian mention the estimated
  // time", and "Why doesn't Axelar bridge on the right shide showing bridge fees and estimated time").
  //
  // Both printed a dash until a quote landed, and on THORChain a quote cannot land until an address has
  // been pasted -- so the row was empty for the whole time anybody was reading it. The dash was a
  // deliberate refusal to invent a figure, and that part was right: neither route publishes a single
  // number the way NEAR Intents publishes ~30 seconds.
  //
  // What they do have is a range, and the page already says it for Axelar once it is quoting -- "a few
  // minutes" is this file's own existing wording for that row. Said before the quote as well as after
  // it, so the row answers the question whenever it is asked, and the real figure still replaces it the
  // moment one arrives. THORChain's inbound confirmation plus its outbound delay puts it in the same
  // bracket: measured to BTC the same day, its own quote came back with 6 seconds, and the slow chains
  // run to several minutes, so the range is the honest form and a single number would not be.
  var ROUTE_ETA = { th: 'a few minutes', ax: 'a few minutes' };
  // Seconds, as a reader would say them. THORChain returns `total_swap_seconds` and it is a real spread
  // -- 6 on one pair, several hundred on another -- so "~420s" would be arithmetic shown to someone who
  // wanted a sentence. Under 90 stays in seconds, which is how NEAR Intents' ~30s already reads.
  function etaWords(s) {
    var n = Number(s);
    if (!(n > 0)) return '';
    if (n < 90) return '~' + Math.round(n) + 's';
    return '~' + Math.round(n / 60) + ' min';
  }
  var ROUTE_META = {
    // THE GREEN NEAR MARK, which is the one Stellar draws (RAZA 2026-10-04: "On Stellar the near
    // intents logo color is green"). Stellar's LZ_MARK points at /assets/tokens/ni/NEAR.png -- NEAR's
    // own icon -- while this used /assets/networks/nearintents.png, a different, light rendition. Both
    // files ship in this build, so it was only ever naming the wrong one.
    ni: { name: 'NEAR Intents', img: '/assets/tokens/ni/NEAR.png', mark: 'nearintents',
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
  // SPENDING MORE THAN THERE IS, as one answer both the button and the route cards can give.
  //
  // RAZA 2026-10-04: 123,194 XRP typed against a 0.4 XRP balance, and the page asked for a destination
  // address. Two faults in one line.
  //
  // The guard read `SRC && SRC.balance != null && ...`, so it did NOTHING whenever either was falsy --
  // and that is exactly when it matters. SRC holds a COPY of the balance from the last repaint, and
  // XRP_SPEND is set to null by the catch on the account read, so one failed refresh leaves the figure
  // unknown with no other symptom: "Available to send" goes on showing whatever it last painted while
  // the only guard against overspending quietly switches itself off. A check that vanishes when its
  // input is missing is worse than no check, because the screen still looks guarded. For a native
  // source the live XRP_SPEND is the better number anyway -- it is what loadHoldings last read.
  //
  // And it lived only in blockReason(), so the route card went on showing the route's own note -- "Enter
  // a destination address" -- while the button said something else. No route can fix a balance, so this
  // outranks whatever a route has to say about the same amount, and both now say it.
  function srcBalance() {
    return {
      // THE LIVE FIGURE FOR XRP, NEVER THE SNAPSHOT (RAZA 2026-10-24: "still not showing my
      // available to send XRP balance", with the account reading perfectly well — 9.599567 XRP,
      // OwnerCount 20, so 4.599567 spendable — at the same moment the row showed a dash).
      //
      // directAssets() builds the XRP entry with `balance: XRP_SPEND`, which is a COPY taken when
      // the object is made. SRC is normally built before the account read lands, so that copy is
      // null — and nothing ever rebuilds SRC, so it stays null for the life of the page while
      // XRP_SPEND goes on to hold the right number. Preferring the copy therefore meant preferring
      // the one value guaranteed to be stale.
      //
      // Native asks XRP_SPEND directly; an issued token still uses its own balance, which is read
      // in the same pass that builds it and has no such gap.
      bal: (!SRC || SRC.native) ? XRP_SPEND : (SRC.balance != null ? SRC.balance : null),
      sym: (SRC && SRC.symbol) || 'XRP',
    };
  }
  function overBalance() {
    var b = srcBalance();
    if (b.bal == null) return '';
    var spend = (SRC && SRC.viaSwap) ? amountXrp() : bridgeXrp();
    if (!(spend > b.bal)) return '';
    return 'More than your ' + b.sym + ' balance';
  }

  // THE BANNER STELLAR SHOWS, in the slot this build already styles for it (RAZA 2026-10-04: "Still no
  // error of insufficient amount. Please check how it works on Stellar" -- with a screenshot of
  // Stellar's red bar reading "Amount exceeds your balance (1.0543 USDC).").
  //
  // `.br-errslot` is the design's own node and sits in both builds; _xrplbridgepolish already carries
  // the same rules Stellar's does for it, down to the alert glyph and the width arithmetic that lines
  // it up under the left card. The only thing missing on this chain was a writer: Stellar's engine
  // calls lxBrStep2Err() and this one never wrote anything there at all, so the message existed only
  // on the Review button -- which is below the fold at the moment someone is typing an amount.
  //
  // Same wording and the same rounding as Stellar's: floored, 4 decimals, 2 once the figure is in the
  // thousands.
  function balFigure(bal, sym) {
    var dp = Number(bal) >= 1000 ? 2 : 4;
    var p = Math.pow(10, dp);
    return fmt(Math.floor(Number(bal) * p) / p, dp) + ' ' + sym;
  }
  // WHAT THE RED BANNER IS SAYING, as one function, because the route cards now have to know it in
  // order not to repeat it. Stellar's order for this slot is the balance, then the route's message,
  // then a malformed address.
  //
  // The route message only once quoting has settled and only when NOTHING can carry the transfer: a
  // route that declined while another is working is the page choosing, not an error, and printing that
  // in red would make every successful two-route transfer look broken. NEAR Intents first, because it
  // is the one that answers with a number you can act on.
  function formBanner() {
    // AN AMOUNT OF 0 GETS A REASON (bugs X25 / N17, 2026-11-19): it only dimmed Review transfer, with no message.
    var zs = $('.br-step[data-step="2"]'), zi = zs && [].filter.call(zs.querySelectorAll('input'), function (i) { return !i.classList.contains('br-addr-in') && i.offsetParent; })[0];
    var zv = zi ? String(zi.value || '').replace(/,/g, '').trim() : '';
    if (zv !== '' && /^[0-9.]+$/.test(zv) && !(parseFloat(zv) > 0)) return 'Enter an amount greater than 0.';
    var ob = overBalance();
    if (ob) { var sb = srcBalance(); return 'Amount exceeds your balance (' + balFigure(sb.bal, sb.sym) + ').'; }
    // A DISABLED BUTTON WITH NO REASON IS ITS OWN BUG. destAddrError() refuses the transfer, and the
    // Review button label stays "Review transfer" -- so without this the reader sees a dead button and
    // no explanation, which is how somebody concludes the site is broken and tries again elsewhere.
    // Said here because this banner is rewritten on every repaint, so it clears itself the moment the
    // address becomes valid.
    var dc = destChain();
    if (dc) { var ae = destAddrError(dc, recipient()); if (ae) return ae; }
    if (!QUOTING && !BEST && bridgeXrp() > 0 && destChain()) return NOTE.ni || NOTE.th || NOTE.ax || '';
    return '';
  }

  function step2Err(msg) {
    var s2 = $('.br-step[data-step="2"]');
    var e = s2 && s2.querySelector('.br-errslot');
    if (!e) return;
    if ((e.textContent || '') === (msg || '')) return;      // never rewrite the node it is being read in
    e.textContent = msg || '';
    if (msg) e.setAttribute('data-err', msg); else e.removeAttribute('data-err');
  }

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
        // SAID ON THE CARD, so "why can't I select THORChain" has an answer on the card itself rather
        // than only in what the page declines to do. It swaps into the destination chain's native coin,
        // so a non-native destination asset puts it out of the running however good its quote is.
        var thNat = (function () {
          var p = PLACES[key];
          return (p && p.th && TH_NATIVE[p.th]) ? (String(TH_NATIVE[p.th]).split('.')[1] || '') : '';
        })();
        // THE PAUSE IS SAID BEFORE ANYTHING IS TYPED, which is the whole point of knowing it. Same
        // shape as the line below it: a standing fact about the route on this pair, stated on the
        // card, in a state the panel will not mark as the default. Checked FIRST, because a halted
        // chain cannot deliver its native coin either and naming the asset would be beside the point.
        if (thHalted(key)) {
          o.state = 'none';
          o.error = 'THORChain has paused ' + (PLACES[key] ? PLACES[key].label : 'this chain')
            + ' transfers.';
          o.halted = 1;
          return o;
        }
        if (DEST && DEST.token && DEST.token.contractAddress) {
          o.state = 'none';
          o.error = 'Delivers ' + (thNat || 'the native coin') + ', not ' + DEST.token.symbol + '.';
          return o;
        }
        if (THQ) {
          o.recv = fmt(Number(THQ.expected) / (THQ.e8 || 1e8), 8) + ' ' + THQ.symbol;
          if (THQ.seconds != null) o.eta = etaWords(THQ.seconds);
        } else o.state = QUOTING ? 'wait' : 'none';
      } else {
        if (AXQ) { o.recv = fmt(AXQ.delivered, 6) + ' ' + axRecv(key); o.eta = 'a few minutes'; }
        else o.state = QUOTING ? 'wait' : 'none';
      }
      // ITS OWN ANSWER, never the last one anybody gave.
      // NOTHING TYPED YET IS NOT A REFUSAL. Landing on step 2 with an empty amount used to mark every
      // route disabled and print "No quote for this amount." under it -- so the first thing the page
      // said about its routes was that none of them worked, before being asked anything. Stellar
      // shows the route selected and waiting. `idle` is that state: enabled, chosen, no figures yet.
      if (o.state === 'none' && !amountXrp()) o.state = 'idle';
      if (o.state === 'none') o.error = overBalance() || NOTE[r] || 'No quote for this amount.';
      return o;
    });
  }

  // The fee line, stated per route because the three charge differently and a single figure would be
  // wrong for two of them. LumosCore's own rate is read live so the 250K-LUMOS tier shows 0.1%.
  function routeFee(r) {
    var pct = +(feeRate() * 100).toFixed(2) + '%';
    if (r === 'ax') {
      // THE PLATFORM FEE BELONGS ON THIS ROW TOO WHEN WE ACTUALLY CHARGE IT (RAZA 2026-10-23, on an
      // XRP -> Hedera transfer: "Why doesn't Axelar bridge on the right shide showing bridge fees").
      //
      // The old line was written when Axelar charged nothing at all, and that stopped being true on
      // 2026-10-12: an XRP source now pays the same percentage as the other two routes, because the
      // collector receives XRP perfectly well. sendAx() takes it, paintReview prints it on step 3 --
      // and this card, on step 2, still said the only cost was gas. Two screens of the same wizard
      // disagreeing about what a transfer costs, with step 2 being the one you read first.
      //
      // Token sources are untouched and still pay us nothing -- the collector holds no trust lines, so
      // a cut of a WETH transfer could only be taken at a rate nobody quoted -- so for those the row
      // goes on naming the relay fee alone, exactly as it did.
      // ...AND ON A SWAPPED SOURCE TOO, which the first version of this line missed. The exemption is
      // for ISSUED TOKENS -- the collector holds no trust lines, so a cut of a WETH transfer could
      // only be taken at a rate nobody quoted. A swapped source is not that case: by the time sendAx
      // runs, the swap has already made SRC plain XRP and the fee IS charged, so the card was quoting
      // "Destination gas only" on a transfer that costs 0.2% more than it said.
      var ours = (SRC && (SRC.native || SRC.viaSwap)) ? (pct + ' + ') : '';
      // "Destination gas" rather than "destination gas": it is the whole of the row on a token source,
      // and a sentence fragment in lower case reads like a label that failed to load.
      return AXQ ? (ours + fmt(axFromUnits(AXQ.gas, AXQ.dp), 6) + ' ' + axLeg().sym + ' relay fee')
        : (ours ? (ours + 'destination gas') : 'Destination gas only');
    }
    if (r === 'th') return pct + ' + THORChain’s swap rate';
    // NAMED AND NUMBERED, as Stellar states it (RAZA 2026-10-04: "The bridge fees and estimated time
    // also are not same"). Stellar composes this as `pct + " + " + (niFeeBps/100) + "% NEAR"`, which
    // reads "0.2% + 0.2% NEAR"; this said "+ solver fee", which names no number at all on the one line
    // a reader checks before signing. 20 bps is the keyed rate -- this build sends ONECLICK_JWT, the
    // same as Stellar's keyed path, and Stellar's own niFeeBps() returns 20 for it.
    return pct + ' + ' + (+(NI_FEE_BPS / 100).toFixed(2)) + '% NEAR';
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

    // WHICH CARD IS MARKED, which is a DISPLAY question and not the same as which route will carry
    // the transfer. BEST is the executable choice and stays empty until something has been quoted;
    // using it here left the panel with nothing selected on arrival. The first candidate is shown
    // instead, so the page always says what it intends to use -- and because this is display only,
    // it cannot make the page send by a route that was never priced.
    var usable = rows.filter(function (x) { return x.state !== 'none'; });
    // A HAND-PICKED ROUTE OUTRANKS THE DEFAULT, and it has to be checked BEFORE `BEST`. With no
    // amount typed nothing has been quoted, so BEST is empty and settle() -- which is where PICKED is
    // normally honoured -- never runs. The fallback then handed the card back to the first route in
    // the list: clicking THORChain visibly reverted to NEAR Intents, which is the page overruling a
    // choice the reader just made.
    // A HAND-PICKED ROUTE STAYS MARKED EVEN WHEN IT CANNOT QUOTE THIS AMOUNT (RAZA 2026-10-04: "I
    // selected thorchain but as soon as im entering any value ... it automatically selects near intents
    // and i cant select thorchain").
    //
    // This required the pick to be in `usable`, which is the set of routes that answered. Type an
    // amount THORChain calls dust and it drops out of that set, so the pick was discarded and the
    // marker fell through to the first row -- NEAR Intents -- which then read "IN USE" on a route the
    // reader had just moved away from. The page overruling a choice the reader made, which is the exact
    // thing the comment on the old line said it existed to prevent, undone by the condition next to it.
    //
    // Display only, and the distinction matters here: BEST still governs what is actually sent and
    // settle() still refuses to honour a pick that did not answer, so this cannot send by a route with
    // no quote. What it fixes is the panel claiming the reader chose something they did not.
    var picked = (PICKED && PICKED_FOR === destChain()
      && rows.some(function (x) { return x.route === PICKED; })) ? PICKED : '';
    // ...AND IT STAYS MARKED EVEN WHEN IT CANNOT PRICE THIS AMOUNT (RAZA 2026-10-04, repeatedly: "when
    // i enter any amount in available to send, the bridge automatically gets deselected").
    //
    // The card was marked with no amount typed (state 'idle') and UNMARKED the moment one was, because
    // a route that declines goes to state 'none' and drops out of `usable`. So typing a figure made the
    // panel look like it had lost its route — when all that happened is the route said why it could not
    // carry that amount, on the card, in its own words. Reading "deselected" from that is the only
    // sensible reading, and it was the page's fault for saying it.
    //
    // Display only, exactly as the note above says: the button is still disabled, blockReason() still
    // refuses, and nothing here can make the page send by a route that was never priced. What it fixes
    // is the page appearing to forget which route it intends to use.
    // BEST FIRST, AND THAT ORDER IS THE CORRECTION. Marking `picked` ahead of it meant a preference
    // for a route that cannot carry this pair outranked the route actually carrying it: measured with
    // XRP -> Avalanche at 50 XRP, NEAR Intents (which refuses that pair) sat marked "IN USE" above
    // THORChain's figure, on a transfer THORChain was going to make. Naming one route and using
    // another is the same fault as naming one asset and sending another, one level up.
    //
    // So the marker follows what will be used whenever something will be. The hand-pick only decides
    // the display when NOTHING can quote -- which is the case this started from, and where it is the
    // only answer the reader has given.
    var shown = BEST || picked || (usable[0] && usable[0].route) || (rows[0] && rows[0].route) || '';

    var h = '';
    rows.forEach(function (o) {
      var sel = o.route === shown;
      var dis = o.state === 'none';
      h += '<button type="button" class="lx-brr" data-lxroutepick="' + o.route + '"'
        // NOT `disabled` (RAZA 2026-10-04: "Now after selecting Thorchain, i cant switch to Near
        // Intents"). A disabled button fires no click, so once an amount was unquotable BOTH cards
        // went dead and whichever route was picked became the one you were stuck with -- the trap this
        // page kept springing, first by discarding the choice and now by freezing it. A route that
        // cannot price THIS amount is still a route the reader is allowed to choose; the page says why
        // on the card and refuses to send, which it already did through BEST and blockReason().
        // The attribute carries the same styling the disabled one did.
        + (dis ? ' data-lxnoquote="1" aria-disabled="true"' : '')
        + ' aria-pressed="' + (sel ? 'true' : 'false') + '">'
        + '<div class="lx-brr-top">'
        + '<span class="lx-brr-mark" data-logo="" data-logoed="1">'
        + '<img src="' + (o.meta.img || ('/assets/networks/' + o.meta.mark + '.png?v=' + ICONV)) + '" alt=""></span>'
        + '<span class="lx-brr-hd"><span class="lx-brr-nm" data-logoed="1">' + esc2(o.meta.name) + '</span>'
        // NO SUBTITLE (RAZA 2026-10-05, marking it on the card: "Please remove this unnecessary text
        // ... from all bridges").
        //
        // A DELIBERATE STEP AWAY FROM STELLAR, which does carry this line -- I added it one commit ago
        // precisely because Stellar has it. On that card it is the only place the delivered asset is
        // named; here the Receive row sits three lines below saying "xDAI", so the sentence repeated
        // what the reader had already been told. Kept in ROUTE_META, because the review step and the
        // route docs still use it.
        + '</span>';
      // The tag names WHY this one, and only where that is a fact rather than a slogan: it appears on
      // the chosen route when a rival actually answered too, so "BEST PRICE" always means it beat
      // something. A badge on a route that was the only option would be marketing.
      // "Best price" only once it has actually beaten something; "In use" once a quote exists;
      // "Ready" before an amount is typed, because nothing is in use yet and saying so would be a
      // claim about a transfer that has not been priced.
      // "Best price" ONLY WHEN THE PAGE CHOSE IT. Picking THORChain by hand on a pair where NEAR
      // Intents quoted better (0.02762472 ETH against 0.027665, measured) still badged it "BEST
      // PRICE" -- the page congratulating a choice it had just been overruled on, and claiming
      // something untrue about the number beside it. A hand-picked route is "In use": accurate, and it
      // still says the choice was honoured.
      if (sel && !(picked && picked === o.route)
          && rows.length > 1 && rows.filter(function (x) { return x.state === 'ok'; }).length > 1) {
        h += '<span class="lx-brr-tag">Best price</span>';
      // NO "READY" BADGE (RAZA 2026-10-05: "Also remove this Ready tag"). It said only that an amount
      // had not been typed yet, which the empty amount field already says, and it was the last thing
      // left on a card he has now twice asked to quieten. "Best price" and "In use" stay: those are
      // about a transfer that has actually been priced, and which route carries it is the question the
      // last several rounds were spent making answerable.
      } else if (sel && o.state === 'ok') {
        h += '<span class="lx-brr-tag">In use</span>';
      }
      // ...AND NO BADGE AT ALL ON A MARKED ROUTE THAT REFUSED (RAZA 2026-10-04: "Are you sure im
      // reciving the same amount on destination from both bridges?").
      //
      // He is right to doubt it. At an amount neither route can price, the figure is this page's own
      // estimate -- market rates, the fee taken off -- and it is the SAME number whichever card is
      // marked, because no bridge produced it. "IN USE" beside it claimed the opposite: that the
      // marked route had priced the transfer and this was its answer. A route that has just said
      // "Minimum 2.004009 XRP" is not in use. The card keeps its border so the choice is still
      // visible, keeps its reason, and no longer claims a quote it did not give.
      h += '</div>';
      // NOT WHEN THE RED BANNER IS ALREADY SAYING IT. "Minimum 2.004009 XRP" sat on the card AND in
      // the banner under the form -- the same sentence twice on one screen, which is the half of his
      // mark that was a genuine duplication rather than a preference.
      //
      // Kept when the banner is NOT carrying it, because then this is the only place it is said: a
      // route that refuses while another one works ("Delivers AVAX, not USDC", a dust threshold on one
      // of two) never reaches the banner by design, and dropping it here would make that card go quiet
      // about why it cannot be chosen.
      // ONE MISTAKE, ONE MESSAGE (bugs X13 / X14 / N5, 2026-11-19): the exact-text check let "More than your XRP balance"
      // sit under "Amount exceeds your balance (…)", and a route's note about a bad address sit under the banner's own.
      // When the banner is about the balance or the address, the card stays quiet on that subject.
      var _fb = formBanner(), _dc = destChain(), _same = !!_fb && (o.error === overBalance() || !!(_dc && destAddrError(_dc, recipient())));
      if (o.state === 'none' && o.error && o.error !== _fb && !_same) {
        h += '<div class="lx-brs-note" style="margin-top:0;padding-top:0">' + esc2(o.error) + '</div>';
      }
      // NOTHING WHILE IT WAITS, because Stellar shows nothing (RAZA 2026-10-04: "this orange text on
      // the bridge side 'Pricing PHNIX INTO XRP' is not there on Stellar").
      //
      // This pill is `.lx-brr-soon`, and on Stellar it carries exactly one message -- "Not yet
      // available" -- which is a PERMANENT fact about a route. This build borrowed it for a transient
      // one. First as "Quoting…", which read as stuck because bridging an issued token waits on a
      // ripple_path_find that takes 6 to 14 seconds; then I made it name the leg, which was a better
      // sentence in a place Stellar has no sentence at all. The honest fix is the one he asked for
      // twice: say nothing, as Stellar does, and let the dash in the receive line stand until there is
      // a figure or a reason to put there.
      else if (o.state === 'wait') { /* deliberately silent — see above */ }
      // "Enter an amount to price this route." goes with it: it occupies the same line he marked, and
      // the amount field is the thing it points at, three inches to the left and already empty.
      h += '<' + '/button>';
    });
    // SAY SO WHEN THE PAGE OVERRULES A HAND-PICK (RAZA 2026-10-19: "as soon as i enter any value, it
    // automatically changes to Thorchain instead of Near Intents").
    //
    // It is not a bug -- BEST is the route that will actually carry the transfer, and settle() honours
    // PICKED only while that route has a quote, precisely so the page can never name one route and send
    // by another (his own 2026-10-04 report: NEAR Intents badged "IN USE" above THORChain's figure).
    // What was wrong is that the border moved in silence, so the only way to learn why was to ask.
    //
    // Display only. Nothing here changes which route is chosen or when.
    if (PICKED && BEST && BEST !== PICKED && ROUTE_META[PICKED] && ROUTE_META[BEST]) {
      h += '<div class="lx-brs-note" style="padding:9px 2px 0">'
        + esc2(ROUTE_META[PICKED].name) + ' can’t price this transfer, so '
        + esc2(ROUTE_META[BEST].name) + ' is being used.</div>';
    }
    if (host.innerHTML !== h) host.innerHTML = h;

    // SHOWN FOR THE MARKED ROUTE, QUOTED OR NOT (RAZA 2026-10-04: "receive, bridge fee, Estimated time
    // section is missing. Make sure its identical to that on Stellar").
    //
    // This was gated on `cur.state === 'ok'`, so the block existed only once a quote had landed -- and
    // vanished for exactly the states he kept screenshotting. Stellar's does not: his own screenshot
    // has NEAR Intents marked, reading "Quoting for this pair is not available", with Receive / Bridge
    // fee / Estimated time printed underneath it anyway. Nothing in those three rows needs a quote.
    // What is delivered and what the fee is are facts about the ROUTE; only the time comes from a
    // quote, and a dash is what every other unknown figure on this page already looks like.
    //
    // Keyed on `shown` rather than BEST, so it follows the card that is actually marked -- including a
    // hand-pick at an amount nothing can price, which is the case that had nothing underneath it.
    var cur = rows.filter(function (x) { return x.route === shown; })[0];
    var sh = '';
    if (cur) {
      var row = function (ic, k, v) {
        return '<div class="lx-brs-row"><span class="lx-brs-ic">' + SICON[ic] + '</span>'
          + '<span class="lx-brs-k">' + k + '</span><span class="lx-brs-v">' + esc2(v) + '</span></div>';
      };
      // The ASSET, as Stellar's row shows ("Receive  ETH"), not the amount -- the amount already has
      // its own line on the left, under "You will receive".
      var recvAsset = '—';
      if (cur.route === 'ni') recvAsset = (DEST && DEST.token) ? DEST.token.symbol : '—';
      else if (cur.route === 'th') {
        // destChain(), NOT a bare `key`: routeRows() has one, this function does not, and the
        // ReferenceError that followed was thrown inside paintQuote -- so settle() stopped before
        // setCta(), leaving the button frozen on "Comparing routes…" with a perfectly good quote
        // already painted beside it. Caught by re-running the same transfer against the previous
        // deployment, which settled, and this one, which did not.
        var p = PLACES[destChain()];
        recvAsset = (p && p.th && TH_NATIVE[p.th]) ? (String(TH_NATIVE[p.th]).split('.')[1] || '—') : '—';
      // THE AXELAR BRANCH, and the one site the helper did not reach on the first pass: this panel
      // computes its own Receive symbol rather than reading routeRows()' `o.recv`, so fixing that
      // left the card saying "Receive XRP" beside a destination chip reading "wXRP" — the two halves
      // of one answer disagreeing on screen. Caught on the deploy, not in the source.
      } else recvAsset = axRecv(destChain()) || '—';
      // THE ROUTE'S OWN TIME when no quote has given one. Stellar prints "~30 seconds" for NEAR
      // Intents before anything is priced, because that is a property of the route; this printed a
      // dash. THORChain's figure comes from its quote and has no published default, so it keeps the
      // dash until the quote arrives rather than being given an invented one.
      // The quote's own figure first, then the route's published one, and only then a dash -- which is
      // now reached solely by NEAR Intents' siblings having no range at all, i.e. never.
      // NOT ON A PAUSED ROUTE, which is the one case where the range would be a claim rather than a
      // fact: Cosmos Hub is served by THORChain alone, so a halted leg can still be the marked card,
      // and "a few minutes" above "THORChain has paused Cosmos Hub transfers" is the panel arguing
      // with itself. The dash is the honest figure for a transfer that cannot start.
      var eta = cur.halted ? '—'
        : (cur.eta || (cur.route === 'ni' ? NI_ETA : (ROUTE_ETA[cur.route] || '—')));
      // Stellar's wording, with the asset and the chain filled in: "Delivered as ETH to your address
      // automatically — no claim, and no gas needed on Arbitrum."
      var place = placeLabel(destChain());
      var note = (cur.route === 'ni' && recvAsset !== '—')
        ? ('Delivered as ' + recvAsset + ' to your address automatically — no claim, and no gas needed on '
           + place + '.')
        : 'Delivered straight to the address you gave — there is nothing to claim on the other side.';
      sh = row('recv', 'Receive', recvAsset)
        + row('fee', 'Bridge fee', routeFee(cur.route))
        + row('time', 'Estimated time', eta)
        + '<div class="lx-brs-note">' + esc2(note) + '</div>';
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
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var r = b.getAttribute('data-lxroutepick');
    var key = destChain();
    if (!r || !key || routesFor(SRC, key).indexOf(r) < 0) return;
    // A PAUSED ROUTE IS NOT A PREFERENCE THE PAGE CAN HONOUR. The no-disabling rule above exists for a
    // route that cannot price THIS AMOUNT -- type a smaller figure and it works again, so freezing the
    // choice there was the trap. A halted chain is not that: nothing the reader types makes it
    // quotable, so recording the pick would only guarantee the silent swap this whole change exists to
    // stop. The card stays visible, clickable and explaining itself; the click just does not take.
    if (r === 'th' && thHalted(key)) return;
    PICKED_FOR = key; PICKED = r;
    // BEST ONLY WHEN THAT ROUTE ACTUALLY ANSWERED. The card can now be chosen while it is refusing
    // this amount, and BEST is what the page sends by -- so setting it from a click alone would hand
    // the Bridge button a route with no quote behind it. settle() applies the same rule; this is the
    // same rule at the moment of the click.
    // A pick that cannot answer is recorded as a PREFERENCE and changes nothing about what is sent:
    // BEST is left exactly as it was, so choosing a route that is refusing this amount cannot take a
    // working one away. It is remembered, so the moment the amount makes it quotable, settle() honours
    // it.
    var answered = (r === 'ni' && QUOTE) || (r === 'th' && THQ) || (r === 'ax' && AXQ);
    if (answered) BEST = r;
    // THE EMPTY NOTE HERE WAS THE BUG, and it was a one-character kind of wrong.
    //
    // paintQuote sets LAST_NOTE to whatever note it is given whenever there is no quote — so picking
    // a route that has not answered passed '', erased the real reason, and left blockReason() with
    // nothing to say but its generic fallback. The button then read "Waiting for a quote" with no
    // quote coming, because nothing on this page re-quotes until an input changes. Permanent, and
    // worded as if it were temporary.
    //
    // Found by the daily bot (XRP → XLM, "Failing since 2026-10-15") and missed by hand twice,
    // because reproducing it needs the route CARD to be clicked after the quotes have settled — a
    // step a person testing the form does not naturally take.
    //
    // Same expression settle() uses, so the click and the quote cycle cannot disagree about why.
    paintQuote(BEST === 'ni' ? QUOTE : null, BEST ? '' : quoteReason());
  }, true);

  // ---- recent transactions -------------------------------------------------------------------------
  //
  // THREE WRITERS AND NO READER. Every send already recorded itself into localStorage --
  // lumos.ni.txs, lumos.ax.txs, lumos.th.txs -- and nothing ever read them back. The table under the
  // wizard was inherited markup with an empty <tbody>: a heading, a header row, and permanent
  // silence. A user could bridge, see "Sent", scroll down, and find no trace of it.
  //
  // It also had the wrong COLUMNS for a page with three routes. The inherited header is
  // Time / Source address / Destination address / From / To / Explorer -- no "Bridge used", which is
  // the one column this build needs more than Stellar's does, because here the route is chosen for
  // you and the record is the only place that says which one carried it.
  //
  // The chip classes below are the design's own (.br-asschip, .am, .nt, .lx-buse, .br-xplink, and the
  // .brm-txc card on phones). Measured before using them: the container already ships 21 rules for
  // them, inherited with the base -- so these rows are styled by the same stylesheet Stellar's are,
  // including in dark mode and on mobile, with nothing new to maintain.
  var TX_PER = 25, TX_PAGE = 1;
  var TX_META = { ni: 'NEAR Intents', ax: 'Axelar', th: 'THORChain' };
  var TX_MARK = { ni: 'nearintents', ax: 'axelar', th: 'thorchain' };

  // ONE SHAPE OUT OF THREE. The stores grew separately and none of them agrees with another: Axelar
  // writes {sym, sent, delivered, chain}, THORChain {asset:"GAIA.ATOM", sent, expected}, NEAR Intents
  // {inAmt, out, sym, chain, status}. Normalising here rather than branching in the renderer is what
  // keeps "what arrived" from being read off the wrong field for one route -- the same mistake that
  // put "4.137837 XRP" under a figure that was ATOM.
  // HISTORY FOLLOWS THE WALLET, NOT THE BROWSER (RAZA 2026-10-17: "Why isnt XRPL showing recent
  // bridge trxs. We've made some during testing. Please show those.").
  //
  // Every row here came from localStorage, written by the tab that sent the transfer -- which is
  // exactly what the empty state said, "No transfers from this browser yet", and exactly why his
  // table was blank. localStorage is per ORIGIN as well as per browser, so transfers made while
  // testing on lumoscore-staging.pages.dev cannot be seen from lumoscore.com at all. Nothing was
  // broken; the history was simply keyed on the wrong thing. A bridge transfer belongs to the
  // WALLET, and the wallet's transfers are on the ledger.
  //
  // RECOVERABLE BECAUSE WE MARK OUR OWN. Each route stamps a marker memo on the payment it submits
  // -- lx:ax, lx:th, lx:ni, written at the three send sites in this file -- so a payment of ours is
  // identifiable on the ledger without guessing from destination addresses, which rotate per quote
  // and per vault and would be wrong within a day.
  //
  // THE LEDGER KNOWS LESS THAN THE SENDER DID, and the row says so rather than inventing it: it has
  // the time, the hash, what left this account and where it went, but the destination chain and the
  // amount delivered there live in the quote, not in the transaction. Those read "—" on a recovered
  // row. A local row carries all of it, so when both exist the local one wins the dedupe below.
  var LEDGER_TXS = [];
  var ROUTE_MEMO = { 'lx:ax': 'ax', 'lx:th': 'th', 'lx:ni': 'ni' };

  function memoAscii(hx) {
    var s = '';
    try {
      var h = String(hx || '');
      for (var k = 0; k + 1 < h.length; k += 2) {
        var b = parseInt(h.slice(k, k + 2), 16);
        if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
      }
    } catch (e) {}
    return s;
  }

  function memoTexts(tx) {
    var ms = (tx && tx.Memos) || [], out = [];
    for (var i = 0; i < ms.length; i++) {
      var d = ((ms[i] && ms[i].Memo) || {}).MemoData;
      if (!d) continue;
      var s = memoAscii(d);
      if (s) out.push(s);
    }
    return out;
  }

  // Ripple epoch (2000-01-01) to ms, the same conversion the dashboard feed uses.
  function rippleMs(sec) { return (Number(sec) + 946684800) * 1000; }

  // THE MARKER IS ON THE FEE, NOT ON THE TRANSFER, and getting that wrong would have put the fee in
  // the amount column. The three send sites each submit TWO payments: the bridge itself, to a
  // gateway / vault / deposit address, and a separate platform fee to COLLECTOR -- and it is the FEE
  // that carries lx:ax, lx:th or lx:ni. Reading the marked payment as the transfer would have shown
  // every bridge as a few drops sent to our own fee account. Caught by scanning the Axelar gateway
  // for marked payments and finding none: the mark was never there to find.
  //
  // So two ways in, both from one account_tx:
  //   DIRECTLY -- an Axelar transfer carries MemoType "type" = interchain_transfer, and a THORChain
  //     transfer's memo starts "=:". Those identify the transfer itself, no pairing needed.
  //   BY ITS FEE -- NEAR Intents sends a plain payment to a per-quote deposit address with no memo
  //     of ours at all, so the only evidence is the lx:ni fee beside it. The transfer is the other
  //     payment from this account in the same handful of ledgers, to someone who is neither us nor
  //     the collector.
  function amtOf(a) {
    if (typeof a === 'string') return { v: Number(a) / 1e6, sym: 'XRP' };
    if (a && a.value != null) {
      // decodeCurrency returns { code, display, kind }, never a string -- using it directly is what
      // once rendered "[object Object]" as a ticker in this very file.
      var dc = null;
      try { dc = (window.lxx && window.lxx.decodeCurrency) ? window.lxx.decodeCurrency(a.currency) : null; } catch (e) {}
      return { v: Number(a.value), sym: (dc && dc.display) || String(a.currency).slice(0, 6) };
    }
    return { v: null, sym: '' };
  }

  // THORChain shortens the chain in its memo -- an Avalanche transfer reads '=:a:0x…'. The single
  // letters are from THORChain's own memo-length-reduction table, not inferred. Same table the
  // dashboard feed uses; anything not in it stays unnamed, because a row naming the wrong
  // destination is worse than one naming none.
  var TH_ABBR = { a: 'AVAX', b: 'BTC', c: 'BCH', e: 'ETH', g: 'GAIA', s: 'BSC', d: 'DOGE', r: 'THOR' };

  // THE TRANSFER NAMES ITS OWN DESTINATION, and it was being thrown away. The Platform Activity feed
  // reads these same memos and renders "4 XRP → Hedera · VIA AXELAR", while this page showed the row
  // with an em dash (RAZA 2026-10-17: "as you can now see in platform activity on XRPL, there have
  // been some cross chain trxs here. show them on XRPL bridge recent transaction since you can now
  // identify those"). Everything needed is in the transaction:
  //
  //   Axelar      MemoType 'type' = 'interchain_transfer', and MemoType 'destination_chain' = the
  //               chain, e.g. 'hedera'. Measured on a real transfer: memo data was
  //               ["interchain_transfer", "0.0.10229748", "hedera", "57310"].
  //   THORChain   '=:CHAIN.ASSET:address' -- the chain is the first segment, abbreviated.
  //
  // Returns the route AND the place, so a recovered row reads like a locally recorded one.
  function routeInfo(tx) {
    var ms = (tx && tx.Memos) || [], byType = {};
    for (var i = 0; i < ms.length; i++) {
      var m = (ms[i] && ms[i].Memo) || {};
      if (m.MemoType) byType[memoAscii(m.MemoType)] = memoAscii(m.MemoData || '');
    }
    if (byType.type === 'interchain_transfer') {
      var dc = byType.destination_chain || '';
      // `asset` left empty: Axelar hands out the SAME asset it took, so the caller fills this from
      // what was sent -- the one place that knows it. Same fact the local-row mapping relies on.
      //
      // THE RAW CHAIN ID TRAVELS WITH IT NOW. "Axelar hands out the same asset it took" is true of the
      // TOKEN and not of its NAME: the same ITS token is XRP on the XRP Ledger and wXRP on Hedera. The
      // caller needs Axelar's own id ("hedera"), not the display label ("Hedera"), to ask the registry
      // which -- so it is carried rather than re-derived from a name that has already been localised.
      return { route: 'ax', place: AX_NAME[dc] || NI_CHAIN[dc] || dc || '', asset: '', axChain: dc };
    }
    var ds = memoTexts(tx);
    for (var k = 0; k < ds.length; k++) {
      if (ds[k].indexOf('=:') !== 0) continue;
      var seg = (ds[k].split(':')[1] || '').split('.')[0] || '';
      var code = TH_ABBR[seg.toLowerCase()] || seg.toUpperCase();
      // The short memo form names a chain, and on THORChain that means its NATIVE asset: '=:a:' is
      // AVAX on Avalanche. So the delivered asset is known even though the amount is not.
      return { route: 'th', place: TH_NAME[code] || '', asset: code || '' };
    }
    return null;
  }

  // ASKED AGAIN WHEN THE LEDGER DOES NOT ANSWER, and this caught me out in my own new code. Testing
  // one of the wallets that has demonstrably bridged, `account_tx` returned ZERO transactions, and
  // the obvious reading -- "this wallet has never bridged" -- was wrong: the very next call returned
  // 71, including an Axelar transfer to Hedera. An empty list and a failed read look identical from
  // here, and the silent `.catch` below turned the second into the first. Exactly the mistake fixed
  // in the dashboard feed and in the health bot earlier today, made a third time.
  //
  // Three tries with a short gap. The guard is only set on SUCCESS, so a run that never gets an
  // answer is retried by the next paint rather than being remembered as "this wallet has nothing".
  function askLedger(me, tries) {
    return rpcB('account_tx', { account: me, limit: 200, binary: false, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (j) {
        var l = (j && j.result && j.result.transactions) || [];
        if (l.length || tries <= 1) return j;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return askLedger(me, tries - 1); });
      }, function (e) {
        if (tries <= 1) throw e;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return askLedger(me, tries - 1); });
      });
  }

  // Every LumosCore bridge in one account's transaction list. Pulled out of the loader because the
  // loader now runs it over several accounts, not just the connected one.
  function extractBridges(acct, list) {
    var outs = [], fees = [];
    (list || []).forEach(function (e) {
      var tx = e.tx || e.tx_json || {}, mm = e.meta || e.metaData || {};
      if (tx.TransactionType !== 'Payment') return;
      if (mm.TransactionResult !== 'tesSUCCESS') return;
      if (tx.Account !== acct) return;
      if (!tx.Destination) return;
      var L = e.ledger_index || tx.ledger_index || 0;
      var rec = { tx: tx, L: L, at: rippleMs(tx.date != null ? tx.date : e.date), hash: tx.hash || e.hash || '' };
      var mark = null;
      memoTexts(tx).forEach(function (s) { if (ROUTE_MEMO[s]) mark = ROUTE_MEMO[s]; });
      // THE MARKER IS CHECKED BEFORE THE SELF-PAYMENT RULE, and that order is load-bearing when the
      // account being scanned IS the fee collector -- which is how RAZA tests. Its fee payments go
      // from rBDV4n…Fr94 to rBDV4n…Fr94, so a "self-payment is a swap" test placed first silently
      // threw away every marker on the one account that collects them.
      if (mark && tx.Destination === COLLECTOR) { rec.route = mark; fees.push(rec); return; }
      if (tx.Destination === acct) return;                        // a self-payment is a swap
      outs.push(rec);
    });

    var rows = [], used = {};
    var push = function (rec, route, place, asset, axChain) {
      if (!rec || !rec.hash || used[rec.hash]) return;
      used[rec.hash] = 1;
      var a = amtOf(rec.tx.Amount);
      rows.push({
        at: rec.at, hash: rec.hash, route: route,
        sent: a.v, sentSym: a.sym,
        // THE DELIVERED ASSET IS KNOWN EVEN WHEN THE AMOUNT IS NOT, and carrying it is what gives
        // these rows the asset-in-front, chain-in-corner mark the NEAR rows already had (RAZA
        // 2026-10-17: "why doesn't it show that smaller asset icon in To column for Axelar and
        // ThorChain trxs"). Axelar returns no asset of its own because it delivers what it was
        // given, so the sent symbol is it.
        //
        // ...UNDER THE NAME THE FAR CHAIN USES FOR IT (RAZA 2026-10-24, on these rows reading only
        // "Hedera"). Same token, different ticker: XRP leaves the ledger and lands as wXRP. This is a
        // registry lookup, not an inference -- Axelar publishes the symbol per chain, and where it
        // publishes no change (XRPL EVM, USDC, WETH) the sent symbol stands exactly as before. With no
        // registry loaded it also falls back to the sent symbol, so a cold page is no worse than it
        // was. The AMOUNT stays unknown and stays unshown: the relay fee comes out of it and the
        // ledger cannot say how much, which is a different question from what the asset is called.
        recv: null,
        recvSym: (route === 'ax' ? axRecvSym(a.sym, axChain) : (asset || '')),
        place: place || '',
        from: acct, to: rec.tx.Destination || '', status: '',
      });
    };

    // 1. Transfers that name their own route, and their destination chain with it.
    outs.forEach(function (rec) {
      var r = routeInfo(rec.tx);
      if (r) push(rec, r.route, r.place, r.asset, r.axChain);
    });

    // 2. Whatever a marked fee points at. Nearest unclaimed payment within five ledgers either way --
    //    the two are submitted back to back, so anything further apart is a different action that
    //    happened to be nearby.
    fees.forEach(function (f) {
      var best = null, gap = 1e9;
      outs.forEach(function (rec) {
        if (used[rec.hash] || rec.tx.Destination === COLLECTOR) return;
        var d = Math.abs((rec.L || 0) - (f.L || 0));
        if (d <= 5 && d < gap) { gap = d; best = rec; }
      });
      if (best) push(best, f.route);
    });
    return rows;
  }

  // A NEAR INTENTS ROW CAN BE ASKED ABOUT (RAZA 2026-10-17: "why some trxs have their TO column
  // still empty. fix it").
  //
  // Axelar and THORChain stamp their destination into the XRPL transaction, so those rows resolve
  // from the ledger alone. NEAR Intents does not: the transfer is a plain payment to a per-quote
  // deposit address with no marker on it, which is why those three rows read "—" and why I said the
  // ledger could not know. The ledger cannot -- but 1Click can, and this page already talks to it:
  // `?op=status&depositAddress=` is the same endpoint the post-send poll uses, and it returns the
  // whole quote back. Measured on all three of the real transfers, every one answered SUCCESS with
  // its destination asset, its recipient and the exact amount delivered.
  //
  // So these rows end up carrying MORE than the Axelar and THORChain ones: the delivered figure as
  // well as the chain. The destination column becomes the recipient on the far chain rather than
  // the XRPL deposit address, which is what Stellar's table shows and what the reader means by
  // "where did it go".
  //
  // The chain name comes from the SAME token list the destination picker is built from, looked up
  // by assetId -- not by parsing '43114' out of a NEP-245 id. One request per unresolved row, and
  // only for rows that have no chain yet, so a locally recorded transfer costs nothing.
  function enrichNi(rows, done) {
    var pend = (rows || []).filter(function (r) { return r.route === 'ni' && !r.place && r.to; });
    if (!pend.length) { done(); return; }
    var left = pend.length;
    var finish = function () { if (--left <= 0) done(); };
    pend.forEach(function (r) {
      fetch(API + '?op=status&depositAddress=' + encodeURIComponent(r.to))
        .then(function (x) { return x.json(); })
        .then(function (j) {
          var qr = j && j.quoteResponse && j.quoteResponse.quoteRequest;
          var q = j && j.quoteResponse && j.quoteResponse.quote;
          if (!qr || !qr.destinationAsset) return;
          var tok = null, L = TOKENS || [];
          for (var i = 0; i < L.length; i++) {
            if (L[i] && L[i].assetId === qr.destinationAsset) { tok = L[i]; break; }
          }
          if (tok) {
            r.place = NI_CHAIN[tok.blockchain] || tok.blockchain || '';
            if (q && q.amountOutFormatted != null && isFinite(Number(q.amountOutFormatted))) {
              r.recv = Number(q.amountOutFormatted);
              r.recvSym = tok.symbol || '';
            }
          }
          if (qr.recipient) r.to = String(qr.recipient);
        })
        .then(finish, finish);
    });
  }

  // IS THE LEDGER READ STILL IN FLIGHT? Read by paintTxs to choose between "reading" and "none".
  //
  // `_busy` is set for the duration of the read and cleared when it lands or fails, so it answers
  // exactly the question asked. The address test matters as much: with no wallet connected nothing is
  // ever fetched, so an empty table there genuinely means none and must not sit on "Reading…" for
  // ever. The _for check keeps a finished read from reporting itself as pending on a later repaint.
  function loadingTxs() {
    var me = addr() || '(public)';   // signed out reads the platform list too (2026-11-19)
    return loadLedgerTxs._busy === me && loadLedgerTxs._for !== me;
  }

  function loadLedgerTxs() {
    var me = addr();
    // TWO guards, not one. `_for` says "this address is done" and is set only when an answer lands;
    // `_busy` says "an answer is on its way". Without the second, every repaint between the request
    // and its reply would start another one -- and paintTxs() calls this on every paint.
    // SIGNED OUT STILL READS THE PLATFORM'S TRANSFERS (2026-11-19). This returned at once with no wallet, so the table
    // said "No bridge transfers yet" over a list that is not about the reader at all -- Stellar and NEAR show it
    // signed out. Keyed '(public)' then; connecting changes the key and re-reads with the wallet's own rows.
    var key = me || '(public)';
    if (loadLedgerTxs._for === key || loadLedgerTxs._busy === key) return;
    loadLedgerTxs._busy = key;
    // TWO HUNDRED, NOT EIGHTY. Measured against the three wallets that have actually bridged: at 80
    // every one of them returned zero marked fees, because a bridge is a handful of transactions in
    // an account that also swaps and adds liquidity, and the history RAZA wanted to see was already
    // outside the window. At 200 the same replay recovers 1 transfer from one wallet and 3 from
    // another. One request either way.
    // PLATFORM-WIDE, NOT JUST THIS WALLET (RAZA 2026-10-17: "as you can now see in platform
    // activity on XRPL, there have been some cross chain trxs here. show them on XRPL bridge recent
    // transaction since you can now identify those").
    //
    // Keyed on the wallet, this table was correctly empty for him and would stay that way: he tests
    // connected as the fee COLLECTOR, which receives every bridge fee and has never sent a bridge --
    // verified against its complete 57-transaction history, twice. The transfers he can see on the
    // dashboard were made from three other wallets.
    //
    // So this reads what the Platform Activity feed reads: the collector names every account that
    // has paid a bridge fee, and each of those accounts is scanned for its transfers. Same data,
    // same page, now agreeing with each other. The SOURCE ADDRESS column carries the real sender
    // rather than "me" -- these are other people's transfers and the row must not imply otherwise.
    //
    // EIGHT ACCOUNTS. One request each on top of the collector's, which is the same budget the
    // dashboard feed already spends on this page's sibling.
    askLedger(COLLECTOR, 3)
      .then(function (cj) {
        var cl = (cj && cj.result && cj.result.transactions) || [];
        var accts = [];
        cl.forEach(function (e) {
          var tx = e.tx || e.tx_json || {};
          if (tx.TransactionType !== "Payment" || tx.Destination !== COLLECTOR) return;
          var marked = memoTexts(tx).some(function (s2) { return ROUTE_MEMO[s2]; });
          if (!marked) return;
          if (tx.Account && accts.indexOf(tx.Account) < 0) accts.push(tx.Account);
        });
        // The connected wallet is always scanned, even if it has never paid a bridge fee -- a
        // transfer of its own must never be missing from its own screen.
        if (me && accts.indexOf(me) < 0) accts.unshift(me);
        accts = accts.slice(0, 8);
        // PAINTED AS THEY LAND, NOT WHEN THE SLOWEST DOES (RAZA 2026-10-20, same report as the
        // message above). These eight requests already run in parallel, but Promise.all held every
        // row behind the last of them. Measured on production: eight `account_tx limit:200` calls
        // returning between ~0.3s and ~1.4s each, in two waves -- so the table sat empty for 8.1s
        // cold while the first account's rows had been in hand almost from the start.
        //
        // Each scan now appends its own rows and repaints. Promise.all still gates the FINAL state
        // below, because `_for` must not be set -- and the read must not be declared done -- until
        // every account has reported.
        //
        // Accumulated into one array that is reassigned rather than pushed into, so txRecords() never
        // sees a half-built list: LEDGER_TXS is replaced by a new array each time, and its dedupe by
        // hash makes a row arriving twice harmless.
        var partial = [];
        return Promise.all(accts.map(function (a) {
          return askLedger(a, 2).then(function (j) {
            var got = extractBridges(a, (j && j.result && j.result.transactions) || []);
            if (got && got.length) {
              partial = partial.concat(got);
              LEDGER_TXS = partial.slice();
              try { paintTxs(); } catch (_) {}
            }
            return got;
          }, function () { return []; });
        })).then(function (lists) {
          var rows = [];
          lists.forEach(function (l) { rows = rows.concat(l); });
          LEDGER_TXS = rows;
          loadLedgerTxs._for = key;
          loadLedgerTxs._busy = null;
          // Painted twice on purpose: once with what the ledger gave us, so the table is not held
          // behind a second round trip, and again when the NEAR rows have been resolved.
          //
          // UNCONDITIONAL NOW, and that is load-bearing rather than tidying. `if (rows.length)` was
          // safe while an empty result left the table showing the same empty state it already had.
          // With the loading message above, a wallet that genuinely has no transfers gets no repaint
          // after `_busy` clears -- so it would sit on "Reading the XRP Ledger…" for ever, which is
          // the original bug with a nicer wording. The last word has to be painted either way.
          paintTxs();
          enrichNi(rows, function () { if (rows.length) paintTxs(); });
        });
      })
      // AND ON FAILURE TOO. Same reason: clearing _busy without repainting strands the table on the
      // loading message. A failed read falls back to the empty state, which is the honest answer the
      // page can give -- it has nothing, and it is no longer waiting.
      .catch(function () { loadLedgerTxs._busy = null; try { paintTxs(); } catch (_) {} });
  }

  function txRecords() {
    var read = function (k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
    var out = [];
    // THE SOURCE SIDE NAMES WHAT THE READER SENT, not the XRP leg the bridge saw. srcAmt/srcSym are
    // written only when the two differ — an issued token sold to XRP first — so an XRP transfer, and
    // every row recorded before this existed, falls back to exactly what it showed before.
    read('lumos.ni.txs').forEach(function (r) {
      out.push({ at: r.at, hash: r.hash, route: 'ni',
        sent: (r.srcAmt > 0 ? r.srcAmt : r.inAmt), sentSym: (r.srcSym || 'XRP'),
        recv: r.out, recvSym: r.sym, place: NI_CHAIN[r.chain] || r.chain || '',
        to: r.to || '', status: r.status || '' });
    });
    read('lumos.ax.txs').forEach(function (r) {
      // Axelar hands the same asset out the other side, so sent and received share a symbol — unless
      // the source was sold to XRP first, in which case srcSym/srcAmt name what the reader chose and
      // `sym` is still right for what arrived. Rows written before this carry neither and fall back
      // to exactly what they showed before.
      out.push({ at: r.at, hash: r.hash, route: 'ax',
        sent: (r.srcAmt > 0 ? r.srcAmt : r.sent), sentSym: (r.srcSym || r.sym),
        // The stored symbol first (written since 2026-10-24 and fixed at the moment of the transfer,
        // so a later re-registration cannot rewrite history); otherwise resolved from the registry
        // now, which is what repairs every row written before that.
        recv: r.delivered, recvSym: (r.recvSym || axRecvSym(r.sym, r.chain)),
        place: AX_NAME[r.chain] || r.chain || '',
        to: r.to || '', status: '' });
    });
    read('lumos.th.txs').forEach(function (r) {
      var p = String(r.asset || '').split('.');
      out.push({ at: r.at, hash: r.hash, route: 'th',
        sent: (r.srcAmt > 0 ? r.srcAmt : r.sent), sentSym: (r.srcSym || 'XRP'),
        recv: r.expected, recvSym: p[1] || '', place: TH_NAME[p[0]] || p[0] || '',
        to: r.to || '', status: '' });
    });
    // LOCAL FIRST, THEN THE LEDGER, deduped by hash. The order matters: a locally recorded row knows
    // the destination chain and the amount delivered, which the ledger cannot tell us, so when the
    // same transfer appears in both the richer copy is the one kept.
    var seen = {};
    out.forEach(function (r) { if (r && r.hash) seen[r.hash] = 1; });
    LEDGER_TXS.forEach(function (r) { if (r && r.hash && !seen[r.hash]) { seen[r.hash] = 1; out.push(r); } });

    return out.filter(function (r) { return r && r.hash; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  function txWhen(ts) {
    var s = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000));
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    var d = Math.floor(s / 86400);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  // The asset's logo with its network's mark in the corner, the way the design draws it everywhere
  // else. `data-logo=""`/`data-logoed="1"` on the wrapper because these ARE short-text elements on a
  // rounded chip, which is exactly what the logo healer hunts.
  function txChip(sym, place) {
    var a = symLogo(sym);
    var n = netFile(place);
    return '<span class="br-asschip">'
      + '<span class="br-ic lx-netic" data-logo="" data-logoed="1">'
      + (a ? ('<img loading="lazy" decoding="async" src="' + esc2(a) + '" alt="">') : '')
      + '</span><span><span class="am">' + esc2(sym || '') + '</span>'
      + '<span class="nt">' + esc2(place || '') + '</span></span></span>';
  }
  // THE CHAIN IS BADGED ONTO THE ASSET DISC, as lumoscore.com does it (RAZA 2026-10-09: "in from
  // column, network logo is missing ... To column is bit different than stellar (networks logo
  // missing)"). The cell used to draw the asset mark alone, so a row said "2.0958 XRP / XRP Ledger"
  // and "2.884955 USDT / Avalanche" with no way to tell the two chains apart at a glance.
  //
  // INLINE STYLES, NOT STELLAR'S CLASSES. lumoscore.com builds this with .lx-tic/.lx-tnet, and
  // copying that markup here would have produced an unstyled badge: measured on the deployed XRPL
  // bridge page, neither .lx-tnet nor .lx-tl has a single rule in this build. txRoute() beside this
  // already inlines its logo styles for the same reason, so this matches the file it lives in.
  //
  // The badge is omitted rather than faked when netFile() has no artwork for a chain — NET_HAVE is
  // the build's own list of files that exist, so a missing one would be a broken-image cross in a
  // 12px circle.
  function txAmt(v, sym, place) {
    // UNKNOWN IS NOT ZERO. Number(null) is 0 and isFinite(0) is true, so a row recovered from the
    // ledger -- which cannot know what was delivered on the far chain -- printed a confident "0" in
    // the received column. Only an actual number is formatted; absence reads as a dash.
    var n = (v === null || v === undefined || v === '') ? NaN : Number(v);
    var shown = isFinite(n) ? fmt(n, (n > 0 && n < 1) ? 8 : 6) : '—';
    var nu = netFile(place);

    // NO AMOUNT? THEN THE CHAIN IS THE ANSWER (RAZA 2026-10-17: "TO column is broken on XRPL bridge
    // recent transactions"). A row recovered from the ledger cannot know what was delivered on the
    // far side -- that figure lives in the quote, not in the XRPL transaction -- so this rendered a
    // dash on the amount line with the chain name underneath it, which reads as an empty cell with
    // a stray caption. Stellar's column leads with the delivered amount because Stellar's rows were
    // all recorded locally and have one.
    //
    // So when the amount is unknown the chain moves up into the primary line and takes the network
    // mark as its own icon rather than a corner badge on an empty disc. The column asks "to where",
    // and "Hedera" answers it; the dash answered nothing. With neither amount nor chain -- a NEAR
    // Intents deposit address carries no destination -- a single dash is all there is to say.
    if (!isFinite(n)) {
      if (!place && !sym) return '<span class="br-asschip"><span><span class="am">—</span></span></span>';
      // THE ASSET LEADS, THE CHAIN SITS IN THE CORNER -- the same mark the NEAR rows carry, now that
      // the delivered asset is known for Axelar and THORChain too. When we have no asset the chain
      // takes the main circle instead, which is better than an empty disc with a badge stuck to it.
      var main = symLogo(sym) || (sym ? '' : nu);
      var corner = (main && main !== nu) ? nu : '';
      return '<span class="br-asschip">'
        + '<span class="br-ic lx-netic" data-logo="" data-logoed="1" style="position:relative;overflow:visible">'
        + (main ? ('<img loading="lazy" decoding="async" src="' + esc2(main) + '" alt=""'
          + ' style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">') : '')
        + (corner ? ('<img loading="lazy" decoding="async" src="' + esc2(corner) + '" alt="" style="position:absolute;'
          + 'right:-2px;bottom:-2px;width:14px!important;height:14px!important;min-width:0!important;'
          + 'border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 2px var(--surface)">') : '')
        // NAME THE ASSET WHEN THERE IS ONE, with the chain under it — the same two-line shape every
        // other row in this table uses. This printed `place || sym`, so a known asset was replaced by
        // its chain: an Axelar row to Hedera read "Hedera" and nothing else, with XRP's mark beside
        // it and no word for what had arrived. The chain still stands alone when the asset genuinely
        // is unknown, which is the case the fallback was written for.
        + '</span><span><span class="am">' + esc2(sym || place) + '</span>'
        + (sym && place ? ('<span class="nt">' + esc2(place) + '</span>') : '')
        + '</span></span>';
    }

    // FOURTEEN PIXELS, BECAUSE THAT IS WHAT STELLAR'S TABLE USES (RAZA 2026-10-17: "why do i feel
    // like XRPL bridge recent transactions is kinda smaller... something feels off"). Measured both
    // tables at the same 1400px viewport rather than trusting two screenshots taken at different
    // widths: font 16.5px, header 14.3px, chain note 13.8px, row height 84px, table width 1069px and
    // every padding were IDENTICAL on the two chains. The one real difference was this badge --
    // Stellar's `.lx-tnet` renders 14x14, this rendered 12x12 -- so the instinct was right even
    // though almost everything it was attributed to was not.
    //
    // !important ON THE BADGE'S OWN SIZE, and it is not belt-and-braces. The inherited stylesheet
    // carries `.br-txwrap .br-table .br-asschip .br-ic img{width:100%!important;height:100%!important}`
    // — written for the single asset mark that used to be the only image in here. A second <img> in
    // the same wrapper is caught by it too, so the first version of this badge rendered at the full
    // 26px squarely on top of the asset logo instead of 12px in its corner. Measured on the deployed
    // page: width 26, not 12. An inline !important is the only thing that outranks it.
    var badge = nu
      ? ('<img loading="lazy" decoding="async" src="' + esc2(nu) + '" alt="" style="position:absolute;'
        + 'right:-2px;bottom:-2px;width:14px!important;height:14px!important;min-width:0!important;'
        + 'border-radius:50%;object-fit:cover;display:block;box-shadow:0 0 0 2px var(--surface)">')
      : '';
    return '<span class="br-asschip">'
      + '<span class="br-ic lx-netic" data-logo="" data-logoed="1" style="position:relative;overflow:visible">'
      + (symLogo(sym) ? ('<img loading="lazy" decoding="async" src="' + esc2(symLogo(sym)) + '" alt=""'
        + ' style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">') : '')
      + badge
      + '</span><span><span class="am">' + shown + ' ' + esc2(sym || '') + '</span>'
      + '<span class="nt">' + esc2(place || '') + '</span></span></span>';
  }
  var XP_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path>'
    + '<path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6">'
    + '</path></svg>';
  // BITHOMP, ON THE HASH WE ACTUALLY HAVE. The link goes to the XRP Ledger payment the user signed --
  // the one transaction this page knows the hash of and can be sure exists. The routes have their own
  // trackers, and they are deliberately NOT linked here: none of them was tested against a real
  // transfer, and a confident link to a 404 is worse on a money page than no link at all.
  function txExplorer(hash) {
    return 'https://bithomp.com/explorer/' + encodeURIComponent(hash);
  }
  function txRoute(r) {
    var m = TX_MARK[r.route], n = TX_META[r.route] || r.route;
    return '<span class="lx-buse-r">'
      + (NET_HAVE[m] ? ('<img src="/assets/networks/' + m + '.png?v=' + ICONV + '" alt="" '
        + 'style="width:18px;height:18px;border-radius:50%;object-fit:cover;display:inline-block;vertical-align:-4px;margin-right:6px">') : '')
      + '<span>' + esc2(n) + '</span></span>';
  }
  // THE PER-ROW STATUS BADGE IS GONE (RAZA 2026-10-13: "whats up with this green text 'Delivered' in
  // cross-chain trx history? we dont have that on stellar" -> "bro you gotta remove from XRPL").
  //
  // It rendered Delivered / Processing / Failed / Refunded in the To cell, and only ever on NEAR
  // Intents rows, because only that route polls a status endpoint -- THORChain and Axelar tell us
  // nothing once their payment is on the ledger. Correct in the code and ambiguous on the screen: a
  // green "Delivered" beside a blank cell reads as "that one did not arrive" rather than "we cannot
  // tell about that one", which is the opposite of what the blank means.
  //
  // lumoscore.com has no such column, and the fork follows Stellar. Worth recording that Stellar is
  // not missing the DATA -- _nearintents.js already polls /lxapi/oneclick?op=status and handles
  // SUCCESS -- it simply does not draw it. So this comes back by adding it to BOTH, with something
  // for the untrackable routes too, and not by reinstating it here alone.
  //
  // The status itself is untouched: it still drives the wizard's own "Delivered" line and the
  // post-send poll. This removes one badge from one table, nothing else.

  var TX_HEAD = '<tr><th>Time</th><th>From</th><th>Source address</th><th>To</th>'
    + '<th>Destination address</th><th>Bridge used</th>'
    // NAMED, NOT JUST aria-labelled (RAZA 2026-10-09: "Explorer column heading is missing"). This
    // shipped as an empty <th> carrying only an aria-label, so a screen reader heard "Explorer" and
    // everyone else saw a blank above the link icons — the one column heading on the table that was
    // not written down. lumoscore.com names it. The aria-label stays: it is harmless beside real text
    // and keeps the accessible name stable if the visible wording is ever shortened.
    + '<th class="br-xph" aria-label="Explorer">Explorer</th></tr>';

  function paintTxs() {
    // At boot there is usually no wallet yet, so the ledger pass above finds no address and does
    // nothing. Re-asking from here picks it up the moment a connect repaints this table, and the
    // `_for` guard means it costs one request per address rather than one per paint. The call it
    // makes back into paintTxs cannot loop: by then `_for` already matches.
    try { loadLedgerTxs(); } catch (_) {}
    var all = txRecords();
    var pages = Math.max(1, Math.ceil(all.length / TX_PER));
    if (TX_PAGE > pages) TX_PAGE = pages;
    var slice = all.slice((TX_PAGE - 1) * TX_PER, TX_PAGE * TX_PER);
    var me = addr();

    // ---- desktop table ----
    var tbl = $('.br-table');
    if (tbl) {
      var thead = tbl.querySelector('thead');
      if (thead && thead.innerHTML !== TX_HEAD) thead.innerHTML = TX_HEAD;
      var tb = tbl.querySelector('tbody');
      if (tb) {
        var h = '';
        if (!all.length) {
          // AN EMPTY TABLE IS NOT AN EMPTY STATE. It was a header row over nothing, which reads as a
          // page that failed to load rather than one with no history yet.
          //
          // AND "NOTHING YET" IS NOT "NOTHING" (RAZA 2026-10-20: "its taking too long for the trxs to
          // appear on bridge"). Measured on production with a wallet that has nine transfers: this
          // table said "No bridge transfers yet. Bridge something and it will be listed here." for
          // 8.1 seconds on a cold load, then filled. The wait was real, but what made it a bug rather
          // than slowness is that the page ANSWERED while it was still asking -- and the answer told
          // the reader to go and bridge something they had already bridged.
          //
          // One display meaning both "none" and "don't know yet" is the same fault as the pending
          // claims that reset a connection, so the two states are now separate strings.
          h = loadingTxs()
            ? ('<tr><td colspan="7" style="padding:26px 12px;text-align:center;color:var(--text-soft)">'
               + 'Reading the XRP Ledger…</td></tr>')
            : ('<tr><td colspan="7" style="padding:26px 12px;text-align:center;color:var(--text-soft)">'
               + 'No bridge transfers yet. Bridge something and it will be listed here.</td></tr>');
        } else {
          slice.forEach(function (r) {
            h += '<tr>'
              + '<td>' + esc2(txWhen(r.at)) + '</td>'
              + '<td>' + txAmt(r.sent, r.sentSym, 'XRP Ledger') + '</td>'
              // THE ROW'S OWN SENDER. This printed the connected wallet on every row, which was
              // harmless while the table only ever held this browser's transfers and is a false
              // statement now that it holds the platform's: it would have put your address on
              // somebody else's transfer. Falls back to `me` for a locally recorded row, which has
              // no `from` because it was by definition sent from here.
              + (function () {
                var src = r.from || me;
                return '<td class="mono">' + (src ? ('<a class="lx-txaddr" href="https://bithomp.com/explorer/'
                  + encodeURIComponent(src) + '" target="_blank" rel="noopener">' + esc2(short(src)) + '</a>') : '—') + '</td>';
              })()
              + '<td>' + txAmt(r.recv, r.recvSym, r.place) + '</td>'
              + '<td class="mono">' + (r.to ? esc2(short(r.to)) : '—') + '</td>'
              + '<td class="lx-buse">' + txRoute(r) + '</td>'
              + '<td class="br-xp"><a class="br-xplink" href="' + esc2(txExplorer(r.hash))
              + '" target="_blank" rel="noopener" aria-label="View on Bithomp" '
              + 'title="View this payment on Bithomp">' + XP_ICON + '</a></td>'
              + '</tr>';
          });
        }
        if (tb.innerHTML !== h) tb.innerHTML = h;
      }
      // ---- pager, only when there is a second page to go to ----
      var wrap = tbl.parentNode;
      var pg = wrap && wrap.querySelector('.lx-txpager');
      if (pages > 1) {
        if (!pg) {
          pg = document.createElement('div');
          pg.className = 'lx-txpager';
          pg.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:flex-end;'
            + 'padding:12px 4px 0;font:400 13px/1 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
          wrap.appendChild(pg);
          pg.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-txpage]');
            if (!b) return;
            e.preventDefault();
            TX_PAGE = Number(b.getAttribute('data-txpage')) || 1;
            paintTxs();
          });
        }
        var ph = '<span style="margin-right:auto">Showing ' + (((TX_PAGE - 1) * TX_PER) + 1) + '–'
          + Math.min(TX_PAGE * TX_PER, all.length) + ' of ' + all.length + '</span>';
        for (var i = 1; i <= pages; i++) {
          ph += '<button type="button" data-txpage="' + i + '" style="min-width:28px;height:28px;'
            + 'border-radius:8px;border:1px solid var(--border);cursor:pointer;font:inherit;'
            + 'background:' + (i === TX_PAGE ? 'var(--accent,#ea6a2c)' : 'transparent') + ';'
            + 'color:' + (i === TX_PAGE ? '#fff' : 'var(--text)') + '">' + i + '</button>';
        }
        if (pg.innerHTML !== ph) pg.innerHTML = ph;
      } else if (pg) pg.remove();
    }

    // ---- phones: the design has no table, it has cards ----
    var host = $('.lx-brmhost');
    if (host) {
      var mh = '';
      if (!all.length) {
        // The phone gets the same distinction as the table above -- the layout differs, the honesty
        // of the message must not.
        mh = '<div style="padding:22px 12px;text-align:center;color:var(--text-soft);font-size:13.5px">'
          + (loadingTxs() ? 'Reading the XRP Ledger…' : 'No bridge transfers yet.') + '</div>';
      } else {
        slice.forEach(function (r) {
          mh += '<div class="brm-txc lx-brmtx">'
            + '<div class="brm-tr1"><span class="brm-tm">' + esc2(txWhen(r.at)) + '</span>'
            + '<a class="br-xplink" style="margin-left:auto" href="' + esc2(txExplorer(r.hash))
            + '" target="_blank" rel="noopener" title="View this payment on Bithomp">' + XP_ICON + '</a></div>'
            + '<div class="brm-flow">' + txAmt(r.sent, r.sentSym, 'XRP Ledger')
            + '<span class="br-ar">→</span>' + txAmt(r.recv, r.recvSym, r.place) + '</div>'
            + (r.to ? ('<div class="brm-recv">To ' + esc2(short(r.to)) + ' · via ' + txRoute(r) + '</div>')
              : ('<div class="brm-recv">via ' + txRoute(r) + '</div>'))
            + '</div>';
        });
      }
      if (host.innerHTML !== mh) host.innerHTML = mh;
    }
  }
  window.__lxxPaintTxs = paintTxs;

  function paintSteps() {
    // Step 1's gate rides the general repaint, which is the only thing that runs on every route into
    // this page — first paint, a destination pick, a chain switch, a reset after delivery. Hanging it
    // off the picker alone would have missed the ones that do not go through a click.
    try { gateNetwork(); } catch (_) {}
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
          // srcBalance(), not SRC.balance: the two had different answers for XRP and this row was
          // reading the stale one. One definition now serves the row, the overspend guard and the
          // red banner, so they cannot disagree about what the wallet holds.
          var sbb = srcBalance();
          var sb = sbb.bal;
          var ssym = sbb.sym;
          var have = sb != null && sb >= 0;
          // NO "Balance:" PREFIX. The row already carries its own label — _xrplbridgepolish.js sets
          // .lx-balrow::before to "Available to send", exactly as the Stellar build does — so writing
          // "Balance:" in here as well printed the figure under a heading that already named it, and
          // read nothing like Stellar's. (RAZA 2026-10-01: "Balance is written incorrectly, please
          // check how it looks on Stellar.") The value alone is what the CSS expects in .bal.
          // A dash still means "not in yet". Once the read has failed we say so instead, and the
          // retry above puts the real figure back without the reader doing anything.
          var txt = (have ? fmt(sb, 6) + ' ' + ssym
            : ((!SRC || SRC.native) && XRP_SPEND_ERR ? XRP_SPEND_ERR : '—')) + ' ';
          [].slice.call(bal.childNodes).forEach(function (nd) { if (nd.nodeType === 3) bal.removeChild(nd); });
          bal.insertBefore(document.createTextNode(txt), bal.firstChild);
          if (mx) {
            mx.removeAttribute('data-logo'); mx.removeAttribute('style');
            mx.setAttribute('data-logoed', '1');
            // THE PILL IS A CLASS THIS BUILD NEVER ADDED. The inherited sheet styles
            //   .br-side .lx-balrow .max.lx-maxbtn
            // — accent-pale fill, rounded, 11px bold — and supplies the word itself through an
            // ::after{content:"MAX"}. Our span carried only .max, so NOTHING matched it: checked on
            // the live page, the only rules reaching it were the universal * resets, which is why it
            // rendered as plain text next to Stellar's orange pill (RAZA 2026-10-01, "Max button on
            // crosschian step 2").
            // The label therefore comes from the stylesheet, and leaving our own "MAX" in the node
            // would print it twice.
            mx.classList.add('lx-maxbtn');
            if (mx.textContent) mx.textContent = '';
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
    gateReview();
    gateNetwork();
  }

  // "Review transfer" must not look ready while the form is not. Stellar disables the same control —
  // disabled + .lx-disabled + aria-disabled — and the rule for it came across with the fork
  // (.br-actions .br-next.lx-disabled{opacity:.45;cursor:not-allowed;pointer-events:none}), so only the
  // toggling was ever missing here. (RAZA 2026-10-01: "Review transfer button should be inactive until
  // the details are fill.")
  //
  // ctaButton() could never have done this: it finds its target by TEXT, matching confirm/bridge/swap,
  // and this button says "Review transfer" — so step 2's control sat outside every gate in this file
  // while step 3's sat inside them.
  function gateReview() {
    var s2 = $('.br-step[data-step="2"]');
    var b = s2 && s2.querySelector('.br-next');
    if (!b) return;
    var why = '';
    try { why = blockReason() || ''; } catch (e) {}
    var a = s2.querySelector('.br-addr-in');
    var typed = a ? String(a.value || '').trim() : '';
    // PRESENCE, NOT FORMAT. There are 28 destinations here with different address shapes, and a format
    // check that is wrong about one of them blocks a transfer that would have worked. "Filled in" is
    // what this button reports; whether the address is right for that chain is the preflight's job,
    // where being wrong is recoverable.
    if (!why && !typed) why = 'Enter the receiving address';
    var ok = !why;
    b.disabled = !ok;
    b.classList.toggle('lx-disabled', !ok);
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
    if (ok) b.removeAttribute('title'); else b.title = why;
  }

  // STEP 1's "Next" HAS THE SAME JOB AS STEP 2's "Review transfer" (RAZA 2026-10-24: "Please disable
  // the next button untill the destination network is selected").
  //
  // It was the only control in the wizard with no gate: pressing it with "Select Network" still showing
  // moved the reader to a step whose every figure depends on a destination, so the assets screen opened
  // with no route, no quote and no receive asset — a dead end reached by pressing the one button the
  // page was offering. destChain() already answers the question (null until a real option is picked),
  // so this is the toggling, not a new rule.
  //
  // Same three marks as gateReview(), because the inherited stylesheet styles all three and using fewer
  // leaves a control that looks live and is not: `disabled` stops the click, `.lx-disabled` is what
  // `.br-actions .br-next.lx-disabled` dims, and aria-disabled is what a screen reader reads.
  function gateNetwork() {
    var s1 = $('.br-step[data-step="1"]');
    var b = s1 && s1.querySelector('.br-next');
    if (!b) return;
    var ok = !!destChain();
    b.disabled = !ok;
    b.classList.toggle('lx-disabled', !ok);
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
    if (ok) b.removeAttribute('title'); else b.title = 'Choose a destination network first';
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
  // THE DESTINATION ADDRESS, CHECKED BEFORE A SIGNATURE RATHER THAN AFTER THE MONEY HAS GONE.
  //
  // RAZA bridged 4 XRP to Hedera on 2026-10-12 and it never arrived. He had entered a Hedera ACCOUNT
  // ID (0.0.10229748); Axelar addresses Hedera by its EVM address (0x2482e1ba...). We accepted the
  // account id, hex-encoded it into the interchain_transfer memo and submitted. Axelar could not
  // resolve the destination, so the message NEVER INDEXED -- Axelarscan returns 404 rather than a
  // failed transfer, and an unindexed GMP message cannot be replayed. The XRP sits at the gateway.
  //
  // axCheck() did not catch it. It verifies every memo is well-formed hex and matches the inputs it
  // was given -- so a destination that is wrong for the chain passes, because the encoding of a wrong
  // address is still valid encoding. Checking the output against the same bad input proves nothing.
  //
  // SCOPE IS DELIBERATELY NARROW, and gateReview() above explains why: there are 28 destinations here
  // and "a format check that is wrong about one of them blocks a transfer that would have worked".
  // That reasoning held while being wrong was recoverable. On Axelar it is not, so the chains below
  // are only those whose address shape is a property of the CHAIN and not of the route -- an EVM
  // address, a Stellar G-address, a Solana base58 key. Everything else keeps presence-only checking.
  var EVM_DEST = { hedera:1, xrplevm:1, ethereum:1, polygon:1, monad:1, arbitrum:1, base:1, optimism:1,
    avalanche:1, bnbchain:1, linea:1, mantle:1, scroll:1, sei:1, gnosis:1, berachain:1 };
  function destAddrError(chainKey, value) {
    var k = norm(chainKey), v = String(value || "").trim();
    if (!v) return "";                                  // the empty case is handled by its own message

    if (EVM_DEST[k]) {
      if (/^0x[0-9a-fA-F]{40}$/.test(v)) return "";
      // The single most likely mistake on Hedera, answered with the thing to do rather than a refusal.
      if (k === "hedera" && /^\d+\.\d+\.\d+$/.test(v)) {
        return "Hedera needs the EVM address (0x...), not " + v;
      }
      return "Enter a valid 0x address for " + placeLabel(chainKey);
    }
    if (k === "stellar") {
      if (/^G[A-Z2-7]{55}$/.test(v)) return "";
      return "Enter a valid Stellar address (G...)";
    }
    if (k === "solana") {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return "";
      return "Enter a valid Solana address";
    }
    if (k === "xrpl" || k === "xrplevm") { /* handled above for evm */ }
    return "";                                          // unknown shape: presence-only, as before
  }
  function blockReason() {
    if (!addr()) return 'Connect a wallet';
    if (window.lxc && !window.lxc.canSign()) return 'This wallet cannot sign';
    var chain = destChain();
    if (!chain) return 'Choose a destination';
    var routes = routesFor(SRC, chain);
    if (!routes.length) return (SRC ? SRC.symbol : 'This asset') + ' cannot reach ' + placeLabel(chain);
    var route = routes[0];
    if (routes.indexOf('ni') >= 0 && !DEST && routes.length === 1) return 'Choose a destination asset';
    var amt = bridgeXrp();
    // A SWAPPED SOURCE HAS TWO AMOUNTS and they fail differently. bridgeXrp() is 0 both when nothing
    // has been typed AND while the swap is still being priced -- and "Enter an amount" is only true
    // of the first. Saying it of the second tells someone to do a thing they have already done.
    if (SRC && SRC.viaSwap) {
      if (!amountXrp()) return 'Enter an amount';
    } else if (!amt) return 'Enter an amount';
    // THE BALANCE OUTRANKS "Pricing the swap…", because over the balance there is nothing to price and
    // the wait never ends. bridgeXrp() is 0 for an over-balance swapped source by design, so the branch
    // below read that as "still working" and the button sat on "Pricing the swap…" for good while the
    // banner underneath already said what was wrong. Measured on cad35bf8 before this.
    var overEarly = overBalance();
    if (overEarly) return overEarly;
    if (SRC && SRC.viaSwap && !amt) return 'Pricing the swap…';
    // The 2 XRP floor is 1Click's, so it applies only when NEAR Intents is the ONLY route. THORChain
    // has its own dust threshold and reports it in words, and Axelar's floor is simply covering the
    // relay fee -- so a pair another route could carry must not be blocked by a minimum that is not
    // its own.
    if (routes.length === 1 && route === 'ni' && netDrops(amt).net < MIN_DROPS) {
      return 'Minimum ' + fmt(minSendXrp(), 6) + ' XRP';
    }
    // AGAINST THE ASSET THE BALANCE IS IN. For a swapped source `amt` is the XRP the swap will fetch
    // and SRC.balance is the token being spent, so comparing them is comparing two different assets
    // -- it would pass 1,000,000 LUMOS worth 12 XRP and refuse 20 LUMOS worth 0.2.
    var spend = (SRC && SRC.viaSwap) ? amountXrp() : amt;
    // (the balance was already checked above, before the swap-pricing wait)
    if (!recipient()) return 'Enter a destination address';
    // Refuses here, which disables the button AND names the problem, instead of letting a transfer
    // leave for an address the destination chain cannot resolve.
    var addrBad = destAddrError(chain, recipient());
    if (addrBad) return addrBad;
    // THE REAL REASON, not a generic wait. A recipient the destination chain would reject is refused
    // by the proxy with "recipient does not look like a base address" -- and the first version threw
    // that away and left the button reading "Waiting for a quote", which describes a network delay
    // rather than something the user can act on.
    if (!(AXQ || QUOTE || THQ)) return LAST_NOTE || 'Waiting for a quote';
    // A QUOTE IS NOT A ROUTE. This gate asked whether ANY quote object existed, which stopped being
    // the same question the moment a quote could be disqualified: with USDC chosen on Avalanche,
    // NEAR Intents refuses the pair and THORChain answers but can only deliver AVAX, so settle()
    // correctly leaves BEST empty -- and the button still read "Bridge 50 XRP", enabled, with nothing
    // behind it. Found while verifying the fix above, which is the only reason it was found at all.
    if (!BEST) {
      return 'No route can deliver ' + ((DEST && DEST.token) ? DEST.token.symbol : 'this asset')
        + ' to ' + placeLabel(chain) + '.';
    }
    return '';
  }
  // DO NOT CALL paintQuote() FROM HERE. It ends by calling setCta(), so this function and that one
  // are a cycle: a guard added here on 2026-10-16 ("a figure on screen must have a quote behind it")
  // recursed until the stack blew, and because the call was wrapped in try/catch the RangeError was
  // swallowed and the page went on looking fine. It reached production before the cycle was spotted.
  //
  // The guard was also answering a question that was not being asked. The daily bot reported step 2
  // disabled with "~ 72.99645 XLM" on screen and read that as a stale quote. It is not: when there is
  // no quote this page deliberately shows an INDICATIVE estimate — `est = q ? null : estimate()`
  // below — priced from 1Click's own token list, exactly as Stellar does. A figure here does not mean
  // a quote exists, and the button refusing beside it is the two halves agreeing, not disagreeing.
  function setCta() {
    // The banner is written here because this runs on every repaint and every quote, so it appears and
    // clears with the state rather than on a timer. Only the balance goes in it: a route's own note
    // already has a home on its card, and two places saying the same thing is the mistake that put an
    // extra line under "You will receive".
    step2Err(formBanner());
    // STEP 2's "Review transfer" is gated here too, and BEFORE the early return below. gateReview()
    // used to run only on an address keystroke -- at which moment the quote has just been cleared, so
    // blockReason() answers with LAST_NOTE, still "Enter a destination address" from the amount-only
    // quote a moment earlier. When the real quote then landed, only this function ran, and it gates
    // step 3's button alone (ctaButton() matches confirm/bridge/swap, never "Review transfer"), so step
    // 2 stayed disabled for good with a quote on screen. Found by the daily bot 2026-10-09; reproduced
    // in a plain browser on Bitcoin and Stellar destinations.
    gateReview();
    gateNetwork();
    var b = ctaButton();
    if (!b || busy) return;
    var why = blockReason();
    // The button names what LEAVES the wallet, which for a swapped source is the asset the user
    // typed, not the XRP it becomes on the way.
    b.textContent = why || ('Bridge ' + fmt(amountXrp(), 6) + ' ' + ((SRC && SRC.symbol) || 'XRP'));
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

  // THE CTA'S LABEL IS NOT AN ERROR LOG (RAZA 2026-10-24, with the whole of it on the button:
  // "rate limit: units quota (10000 per 60s) exhausted, retry in ~28792ms").
  //
  // Every send path reports through say(), and say() writes the BUTTON. So any upstream string that
  // reaches a catch becomes the button's text — a paragraph of infrastructure jargon where the verb
  // used to be, on the screen where someone is trying to send money.
  //
  // A ledger throttle is the common one and it is translated by xrpl-core, which owns the transport
  // that produced it; the seconds survive because they are the part a reader can act on. Anything
  // else long enough to wrap is clipped rather than left to reflow the control.
  function say(msg) {
    var b = ctaButton();
    if (!b) return;
    var s = String(msg == null ? '' : msg);
    try {
      var busy = window.lxx && window.lxx.ledgerBusyNote && window.lxx.ledgerBusyNote(s);
      if (busy) s = busy;
    } catch (e) {}
    if (s.length > 64) s = s.slice(0, 61).replace(/[\s,;:.—-]+$/, '') + '…';
    b.textContent = s;
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
    // THE PLATFORM FEE, ON XRP ONLY (RAZA 2026-10-12). This route charged nothing at all, which was
    // never a pricing decision -- it was a consequence of the collector holding no trust lines, so a
    // cut of a WETH transfer could only be taken by converting it at a rate nobody quoted. That
    // reasoning covers the ITS TOKENS and nothing else: when the source is native XRP the collector
    // receives it perfectly well, exactly as it already does on THORChain and NEAR Intents.
    //
    // Same feeRate() as every other route, so the 0.1% tier for 250K+ LUMOS holders applies here
    // without a second rule to keep in step. Token sources are untouched and still free.
    //
    // TAKEN OFF THE TOP, not added on: Axelar splits the Amount it receives into
    // transfer + gas_fee_amount, so the fee has to leave before the gateway ever sees it.
    var axFee = 0, axSend = null;
    if (SRC.native) {
      var nd = netDrops(Number(typedRaw()));
      axFee = nd.fee;
      axSend = nd.net;
    }
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: AX.gateway,
      Amount: SRC.native ? String(axSend)
        : { currency: SRC.currency, issuer: SRC.issuer, value: typedRaw() },
      Memos: axMemos(chain, to, SRC.native ? gasUnits : unitsToDecimal(gasUnits, dp)),
    };
    // A SMALLER AMOUNT MAKES THE RELAY FLOOR TIGHTER. axCheck already refuses gas >= amount, and
    // taking the fee off the top moves that line -- so a transfer that only just covered the relay
    // now will not. Said in words here rather than letting axCheck report it as a malformed build.
    if (SRC.native && !(Number(gasUnits) < Number(axSend))) {
      busy = false; say('Too small — the relay fee would take all of it'); setTimeout(setCta, 5000); return;
    }

    // READ BACK BEFORE SIGNING. A malformed memo here is not a failed transfer, it is a lost one --
    // Axelar's own docs say such a message never indexes and cannot be recovered, unlike an
    // underfunded one which lands as INSUFFICIENT_GAS and can be topped up. So the built transaction
    // is re-parsed and every invariant re-checked against what was intended, and anything short of
    // agreement stops here rather than at the ledger.
    var bad = axCheck(tx, { chain: chain, addr: to, gateway: AX.gateway, dp: dp,
      gas: SRC.native ? gasUnits : unitsToDecimal(gasUnits, dp) });
    if (bad) { busy = false; say('Not sent — ' + bad); setTimeout(setCta, 5000); return; }

    // One signature where Batch is available, same as the other two routes. tfAllOrNothing also means
    // the fee cannot be taken for a transfer that then fails to leave.
    var axFeeTx = (axFee > 0) ? {
      TransactionType: 'Payment', Account: me, Destination: COLLECTOR, Amount: String(axFee),
      Memos: [{ Memo: { MemoData: hex('lx:ax') } }],
    } : null;
    var axBatched = !!(axFeeTx && window.lxb && window.lxb.capable());
    say('Confirm the transfer in your wallet…');
    (axBatched ? window.lxb.submit(me, [tx, axFeeTx]) : window.lxc.submit(tx))
      .then(function (hash) {
        try {
          var k = 'lumos.ax.txs';
          var list = JSON.parse(localStorage.getItem(k) || '[]');
          // THE LEG IS RECORDED HERE TOO. srcLeg()'s note says Axelar "moves the ITS token itself, so
          // its record already names the asset that was sent" — true of a direct transfer, and not of
          // a token sold to XRP first, which this route now carries to Axelar-only destinations like
          // Hedera. Without it that row reads "2.01 XRP" for a 10,000 LUMOS transfer, which is the
          // same complaint the other two stores were fixed for.
          var axLegRec = srcLeg();
          list.unshift({ at: Date.now(), hash: hash, route: 'axelar', chain: chain,
            sym: SRC.symbol, sent: typedRaw(), delivered: AXQ.delivered, to: to,
            // Recorded at write time, because the registry lookup needs AX_BY_SYM and the history
            // table is painted from storage alone -- and because what a row says arrived should not
            // change if Axelar re-registers the token later.
            recvSym: axRecv(destChain()),
            srcSym: axLegRec && axLegRec.srcSym, srcAmt: axLegRec && axLegRec.srcAmt });
          localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
          try { paintTxs(); } catch (_) {}
        } catch (e) {}
        say('Sent — Axelar is relaying it');
        busy = false;
        setTimeout(setCta, 8000);
        // Only when it did not already travel inside the Batch above.
        if (!axBatched && axFeeTx) { window.lxc.submit(axFeeTx).catch(function () {}); }
        // Same as the THORChain route above, and for the same reason: no delivery polling here, so
        // nothing else would ever take the reader off a review screen whose transfer has already left.
        setTimeout(function () { try { resetAfterDelivery(); } catch (_) {} }, 8000);
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
    var me = addr(), amt = bridgeXrp(), n = netDrops(amt);
    if (!THQ || !THQ.inbound || !THQ.memo) { busy = false; setCta(); return; }
    // THE FEE AND THE TRANSFER AS ONE SIGNATURE, where the wallet can carry it. Two things wrong with
    // sending them separately, and Batch fixes both: it was a second wallet prompt, and the fee was
    // submitted AFTER the transfer with its failure swallowed (`.catch(function(){})`), so a bridge
    // could complete having paid us nothing. tfAllOrNothing makes that impossible -- either both
    // apply or neither does.
    //
    // Xaman only, measured: GemWallet renders a Batch and then refuses it on submit. Everything not
    // proven falls through to the two-transaction path below, unchanged.
    var transferTx = {
      TransactionType: 'Payment', Account: me, Destination: THQ.inbound,
      Amount: String(n.net),
      Memos: [{ Memo: { MemoData: hex(THQ.memo) } }],
    };
    var feeTx = (n.fee > 0) ? {
      TransactionType: 'Payment', Account: me, Destination: COLLECTOR, Amount: String(n.fee),
      Memos: [{ Memo: { MemoData: hex('lx:th') } }],
    } : null;
    var batched = !!(feeTx && window.lxb && window.lxb.capable());
    say('Confirm the transfer in your wallet…');
    (batched ? window.lxb.submit(me, [transferTx, feeTx]) : window.lxc.submit(transferTx)).then(function (hash) {
      try {
        var k = 'lumos.th.txs';
        var leg = srcLeg();                        // the token the reader picked, if it was not XRP
        var list = JSON.parse(localStorage.getItem(k) || '[]');
        list.unshift({ at: Date.now(), hash: hash, route: 'thorchain', asset: THQ.asset,
          sent: amt, srcSym: leg && leg.srcSym, srcAmt: leg && leg.srcAmt,
          expected: Number(THQ.expected) / (THQ.e8 || 1e8), to: recipient() });
        localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
          try { paintTxs(); } catch (_) {}
      } catch (e) {}
      say('Sent — THORChain is swapping it');
      busy = false;
      setTimeout(setCta, 8000);
      // LEAVE THE REVIEW SCREEN once the transfer has gone (RAZA 2026-10-12: "The swap has already
      // happened successfully. Why's this still here"). Only the NEAR Intents route ever cleared
      // itself, and it does it from poll() when DELIVERY is observed — THORChain and Axelar have no
      // polling, so they sat on the review screen with the money already sent, which is exactly how
      // somebody sends twice.
      //
      // The same reset the NEAR route uses, so all three end up in one state rather than two. It
      // deliberately does not reload: the Recent transactions row for this very transfer is painted
      // from localStorage and a reload would throw away the thing the reader wants to see. The 8s
      // matches setCta above, so the "Sent" message is readable before the form clears.
      setTimeout(function () { try { resetAfterDelivery(); } catch (_) {} }, 8000);
      // The fee is second here too, and its failure is ours. Skipped when it already travelled inside
      // the Batch above -- submitting it again would charge the fee twice.
      if (!batched && feeTx) {
        window.lxc.submit(feeTx).catch(function () {});
      }
    }).catch(function (e) {
      busy = false;
      say(String((e && e.message) || 'Transfer failed'));
      setTimeout(function () { busy = false; setCta(); }, 4000);
    });
  }

  // ---- swap, then bridge ----------------------------------------------------------------------------
  //
  // Two signatures, in an order that cannot be reversed: the asset has to BE XRP before a route will
  // take it. What that costs the user if the second half fails is stated on the review and again
  // here -- they end up holding XRP rather than the token they started with. That is a real outcome
  // and the page says so rather than discovering it for them.
  //
  // THE SECOND LEG IS QUOTED AGAINST WHAT ACTUALLY ARRIVED, never against the swap's estimate. A
  // partial payment delivers what SendMax buys, so the XRP in hand can be anything from the 0.5%
  // floor upwards, and bridging the estimate would either leave dust behind or ask for XRP that is
  // not there. `delivered_amount` in the swap's own metadata is the exact figure.
  function swapThenBridge() {
    var q = SWAPQ;
    if (!q || !(q.out > 0)) { busy = false; say('The swap is not priced yet'); setCta(); return; }
    var tx = swapTx(q);
    if (!tx) { busy = false; say('That amount is too small for the ledger'); setCta(); return; }

    // BEFORE THE FIRST SIGNATURE, because nothing after it still knows. See SWAP_LEG's own note: the
    // swap reassigns SRC to XRP and rewrites the amount field, so this is the last moment at which the
    // page can say what the reader actually chose.
    SWAP_LEG = (SRC && !SRC.native && amountXrp() > 0)
      ? { srcSym: SRC.symbol || '', srcAmt: amountXrp() } : null;

    say('Step 1 of 2 — approve the swap to XRP…');
    // A DRY RUN BEFORE THE WALLET IS ASKED. On a thin book the price can move past the 0.5% floor in
    // the seconds between quote and signature, and the ledger will say so without a fee or a
    // signature. dxaswap added this after two live tecPATH_PARTIAL failures.
    rpcT('simulate', { tx_json: tx }).then(function (r) { return r && r.engine_result; }, function () { return null; })
      .then(function (er) {
        if (er === 'tecPATH_PARTIAL' || er === 'tecPATH_DRY') {
          throw new Error('The price moved while this was being prepared. Nothing was signed — check the new quote and try again.');
        }
        return window.lxc.submit(tx);
      })
      .then(function (hash) {
        say('Swapping to XRP…');
        return waitSwap(hash);
      })
      .then(function (got) {
        if (!(got > 0)) throw new Error('The swap did not complete. Nothing was bridged.');
        // The swap has landed. From here the wallet holds XRP and the transfer is an ordinary one.
        SRC = directAssets()[0];                          // XRP, with its own balance
        SWAPQ = null;
        say('Swapped — pricing the transfer…');
        return refreshAfterSwap(got);
      })
      .then(function () {
        busy = false;
        send();                                           // now a plain XRP bridge, fully re-quoted
      })
      .catch(function (e) {
        busy = false;
        // Nothing was bridged, so nothing will be recorded -- and leaving the capture set would hand
        // the token's name to whatever transfer is attempted next.
        SWAP_LEG = null;
        say(String((e && e.message) || 'The swap could not be completed.'));
        setTimeout(function () { busy = false; setCta(); }, 5000);
      });
  }

  // What the swap actually delivered, from its own metadata. delivered_amount is the authoritative
  // figure for a partial payment; `Amount` is only what was asked for.
  function waitSwap(hash) {
    var n = 40;
    function look() {
      return rpcT('tx', { transaction: hash, binary: false }, 8000).then(function (r) {
        if (!(r && r.validated)) return again();
        var m = r.meta || {};
        if (m.TransactionResult !== 'tesSUCCESS') {
          throw new Error('The swap failed on the ledger (' + m.TransactionResult + '). Nothing was bridged.');
        }
        var d = m.delivered_amount;
        return (typeof d === 'string') ? Number(d) / 1e6 : 0;
      }, again);
    }
    function again() {
      if (--n <= 0) throw new Error('The swap is taking longer than expected. Check your wallet before trying again.');
      return new Promise(function (res) { setTimeout(res, 1500); }).then(look);
    }
    return look();
  }

  // Put the freshly received XRP into the amount field and re-price everything against it, so the
  // second signature is for a transfer the user can see in full before approving it.
  function refreshAfterSwap(got) {
    return loadSpendable().then(function () {
      var inp = amtInput();
      // A drop of headroom for the ledger's own transaction cost on the bridge payment.
      var usable = Math.max(0, Math.min(got, XRP_SPEND == null ? got : XRP_SPEND) - 0.001);
      if (inp) { inp.value = String(Math.floor(usable * 1e6) / 1e6); }
      paintSteps();
      return new Promise(function (res) {
        doQuote();
        // doQuote debounces through requote() elsewhere; here it runs immediately and we wait for a
        // settled answer rather than racing the button back on.
        var tries = 0;
        (function wait() {
          if (!QUOTING && (QUOTE || THQ || AXQ)) return res();
          if (++tries > 40) return res();
          setTimeout(wait, 300);
        })();
      });
    });
  }

  function send() {
    if (busy) return;
    var why = blockReason();
    if (why) return;
    busy = true;
    var b0 = ctaButton();
    if (b0) { b0.style.pointerEvents = 'none'; b0.style.opacity = '.7'; }
    // THE SWAP COMES FIRST AND IS ITS OWN SIGNATURE. Nothing below this line can run on a source no
    // route carries, so it is checked before the route dispatch rather than inside it.
    if (SRC && SRC.viaSwap) return swapThenBridge();
    // Whichever route the page SHOWED is the one it sends by. Re-deriving it here could send by a
    // route the user was never quoted.
    if (AXQ) return sendAx();
    if (BEST === 'th') return sendTh();
    var amt = bridgeXrp(), n = netDrops(amt), me = addr();
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
        // Same one-signature treatment as the THORChain route: the deposit and our fee are two writes
        // from one account, so a capable wallet carries them together under tfAllOrNothing and the
        // fee stops being a best-effort afterthought that a decline silently loses.
        var depositTx = {
          TransactionType: 'Payment', Account: me,
          Destination: q.depositAddress, Amount: String(n.net)
        };
        var feeTx = (n.fee > 0) ? {
          TransactionType: 'Payment', Account: me, Destination: COLLECTOR, Amount: String(n.fee),
          Memos: [{ Memo: { MemoData: hex('lx:ni') } }]
        } : null;
        var batched = !!(feeTx && window.lxb && window.lxb.capable());
        return (batched ? window.lxb.submit(me, [depositTx, feeTx]) : window.lxc.submit(depositTx))
          .then(function (hash) { return { q: q, hash: hash, batched: batched, feeTx: feeTx }; });
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
        // Skipped when it already travelled inside the Batch — sending it again would charge twice.
        if (!r.batched && r.feeTx) {
          window.lxc.submit(r.feeTx).catch(function () {});
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
  // WHAT THE READER ACTUALLY CHOSE, when that is not what reaches the bridge (RAZA 2026-10-09: "I
  // swapped 100,000 LUMOS to AVAX using Thorchain so why its saying XRPL. its supposed to show the
  // same source asset that was used").
  //
  // Neither NEAR Intents nor THORChain takes an issued token, so picking one means this page sells it
  // to XRP first — that is what SWAPQ is — and only the XRP leg reaches the bridge. Both stores then
  // recorded that leg and nothing else, so a 100,000 LUMOS transfer was filed, truthfully but
  // uselessly, as "2.45828 XRP". The row answered a question the reader had not asked.
  //
  // Axelar is deliberately not touched: it moves the ITS token itself, so its record already names the
  // asset that was sent.
  function srcLeg() {
    // The captured leg first: on a swapped transfer it is the only surviving record of what was
    // chosen, and by the time this is called SRC and the amount field both describe the XRP leg.
    if (SWAP_LEG) return SWAP_LEG;
    if (!SRC || SRC.native) return null;          // XRP in, XRP to the bridge: nothing to remember
    var a = amountXrp();
    return a > 0 ? { srcSym: SRC.symbol || '', srcAmt: a } : null;
  }

  function record(r) {
    try {
      var k = 'lumos.ni.txs';
      var leg = srcLeg();
      var list = JSON.parse(localStorage.getItem(k) || '[]');
      // `to` was missing here and present in the other two stores, so a NEAR Intents row in the
      // history had no destination address to show -- on the widest of the three routes.
      list.unshift({ at: Date.now(), hash: r.hash, dep: r.q.depositAddress,
        inAmt: r.q.amountInFormatted, out: r.q.amountOutFormatted, to: recipient(),
        srcSym: leg && leg.srcSym, srcAmt: leg && leg.srcAmt,
        sym: DEST.token.symbol, chain: DEST.chain, status: 'PENDING_DEPOSIT' });
      localStorage.setItem(k, JSON.stringify(list.slice(0, 50)));
          try { paintTxs(); } catch (_) {}
    } catch (e) {}
  }

  // The post-delivery clear. Deliberately NOT a page reload: the Recent transactions table below is
  // painted from localStorage and a reload would throw away the "Delivered" row the reader is looking
  // at, which is the opposite of what was asked for.
  function resetAfterDelivery() {
    try {
      var ai = amtInput(); if (ai) ai.value = '';
      SWAPQ = null; SIMQ = null; QUOTE = null; THQ = null; AXQ = null; BEST = '';
      // The hand-pick belonged to the transfer that just finished. Left standing it would silently
      // steer the next one, on a route the reader chose for a pair they may not be sending again.
      PICKED = ''; PICKED_FOR = '';
      SWAP_LEG = null;
      NOTE = { ni: '', th: '', ax: '' };
      try { paintSourceUsd(); } catch (_) {}
      try { paintSteps(); setCta(); } catch (_) {}
      var back = $('.br-step[data-step="3"] .br-back[data-go="2"]') || $('.br-back[data-go="2"]');
      if (back) back.click();
      // ...AND ON TO STEP 1, which is where Stellar lands (RAZA 2026-10-23: "This swap is already done
      // successfully, so why didn't it take to cross-chain step 1 and refreshed everything").
      //
      // _cctp.js's lxBrResetWizard clicks step 3 -> 2, then step 2 -> 1 on a 140ms timer, and clears
      // the amount AND the address. This stopped at step 2 and deliberately kept the address, on the
      // reasoning that re-pasting it is friction rather than safety. That reasoning was mine, it is not
      // what the other chain does, and a finished transfer leaving the form half-populated is exactly
      // the state he is pointing at. Same two clicks, same 140ms, same fields cleared.
      //
      // The step move goes through the design's own .br-back buttons rather than a transform written
      // here -- each .br-step carries its own slide and driving it by hand is how this layer has broken
      // the wizard before.
      setTimeout(function () {
        try {
          var s2 = $('.br-step[data-step="2"]');
          var b1 = s2 && s2.querySelector('.br-back[data-go="1"]');
          if (!b1) b1 = $('.br-back[data-go="1"]');
          if (b1) b1.click();
          var ad = $('.br-addr-in'); if (ad) ad.value = '';
          step2Err('');
          // THE BALANCE IS PART OF "refreshed everything", and it is the one figure that is certainly
          // now wrong: the money has left. Without this, "Available to send" goes on showing the
          // pre-transfer number until something else happens to re-read the account.
          try { loadSpendable(); } catch (_) {}
          try { loadHoldings(); } catch (_) {}
          try { paintSteps(); setCta(); } catch (_) {}
        } catch (_) {}
      }, 140);
    } catch (e) {}
  }

  function poll(dep, tries) {
    if (tries > 40) { busy = false; setCta(); return; }
    fetch(API + '?op=status&depositAddress=' + encodeURIComponent(dep))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var st = j && j.status;
        // A DELIVERED TRANSFER MUST NOT LEAVE THE FORM STANDING (RAZA 2026-10-09: "after the swap is
        // done, why is this stuck here. please make it like it refreshes on Stellar"). This used to
        // say "Delivered", re-arm the button five seconds later and stop — leaving the review step on
        // screen with the amount that had just been sent still in it and a live "Bridge 2.1 XRP"
        // button under it. The next press would have sent the same amount again.
        //
        // The clear is the one destChanged() already performs when the destination changes, for the
        // same reason: the amount and every quote belonged to a transfer that is now finished. The
        // ADDRESS is deliberately left — it is the reader's own wallet on the far chain, and making
        // them paste it again to send a second time is friction, not safety.
        //
        // The step move goes through the design's own `.br-back[data-go="2"]`, not a transform written
        // here: each .br-step carries its own slide transform and driving that by hand is how this
        // layer has broken the wizard before. Five seconds, so "Delivered" is read before it moves,
        // and the transfer stays visible in Recent transactions afterwards either way.
        if (st === 'SUCCESS') {
          say('Delivered'); mark(dep, st); busy = false;
          setTimeout(function () { setCta(); resetAfterDelivery(); }, 5000);
          return;
        }
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
    // The row already on screen says "Processing"; this is the moment it becomes Delivered, Refunded
    // or Failed, and it is the only status any of the three routes reports back.
    try { paintTxs(); } catch (_) {}
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
        // NOT WHEN THE CLICK WAS A ROUTE CARD. This is a catch-all that re-quotes after anything that
        // might have changed the form, and a route card is inside .br-step so it matched -- nulling
        // QUOTE and starting a fresh round trip every time someone chose between two routes that had
        // ALREADY answered. The figures vanished for the ten seconds that took, and both cards lost
        // their badge, which is what made two routes look like they delivered the same amount: the
        // number on screen in between is this page's own estimate, the same for either card because no
        // bridge produced it. The pick handler does its own repaint; it does not need a new quote.
        //
        // It runs on WINDOW capture, before the pick handler on document, so the pick's
        // stopPropagation() cannot prevent this -- it has to check for itself.
        if (!t.closest('[data-lxroutepick]') && t.closest('.brd-opt, .br-step, .brd, .br-back')) {
          setTimeout(function () { QUOTE = null; paintSteps(); requote(); }, 30);
          setTimeout(paintSteps, 250);
        }
        // MAX fills the field with what is actually spendable, less a small buffer: this route signs
        // TWO transactions and each burns a network fee, so an amount equal to the whole spendable
        // balance leaves nothing to pay for the second one.
        if (t.closest('.max')) {
          e.preventDefault(); e.stopPropagation();
          // MAX FILLS THE SELECTED ASSET'S BALANCE, not always XRP's (RAZA 2026-10-04: "I'm clicking
          // MAX but its not updating the value to 72.56... PHNIX").
          //
          // It did update -- to 0.023194, the spendable XRP less the buffer -- which with PHNIX
          // selected is both wrong and almost invisible, because it looks like nothing happened unless
          // you read the figure. That is also where the 0.023194 in every screenshot since came from.
          //
          // The buffer is XRP-only and stays that way: it exists because this route signs TWO
          // transactions and each burns a network fee, and that fee is paid in XRP whatever is being
          // bridged. Taking it off a token balance would leave dust in the wallet for no reason.
          var inp = amtInput();
          var v = null;
          if (!SRC || SRC.native) {
            if (XRP_SPEND != null) v = Math.max(0, Math.floor((XRP_SPEND - 0.001) * 1e6) / 1e6);
          } else if (SRC.balance != null) {
            v = SRC.balance;
          }
          if (inp && v != null) {
            // Plain decimal, never exponent notation: String(1e-7) is "1e-7", which this field's own
            // cleaner strips to "17".
            var s = String(v);
            if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) s = Number(v).toFixed(6);
            inp.value = s;
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
    // paint rather than after two registries have answered. The local history can be drawn now too --
    // it does not depend on a single registry answering.
    paintOptionCss();
    try { paintTxs(); } catch (_) {}
    // ...and then the wallet's own transfers are recovered from the ledger and merged in. Separate
    // and later on purpose: it needs a connected address and a round trip, and the rows already in
    // localStorage should not wait behind either.
    try { loadLedgerTxs(); } catch (_) {}

    // BOTH REGISTRIES, and the page waits for both before deciding what it offers. Settling them
    // separately would paint a destination list from one route and then rebuild it when the other
    // arrived, which is a visible flicker and, worse, a window in which a user can pick a chain that
    // is about to disappear.
    // A REGISTRY THAT FAILS ONCE USED TO TAKE ITS CHAINS WITH IT, SILENTLY.
    //
    // RAZA 2026-10-12: "Hedera again disappeared from cross chain destination dropdown". Each of
    // these was fetched exactly once, and a failure became `null` with no retry. The guard below only
    // speaks up when ALL THREE are down -- so one route failing left the page looking perfectly
    // healthy while quietly offering fewer destinations. Axelar is the one that shows: it is the only
    // route to Hedera and XRPL EVM, so losing it deletes exactly those two from the list and says
    // nothing. A reader cannot tell that from "we do not support Hedera".
    //
    // Three attempts with a short backoff, because the failure this is for is transient -- the
    // upstream registry answers in ~0.1s when it answers at all. A route that is genuinely down then
    // records a note instead of vanishing.
    function regFetch(url, tries) {
      return fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok) return j; throw new Error("registry not ok"); })
        .catch(function () {
          if (tries > 1) {
            return new Promise(function (go) { setTimeout(go, 700); })
              .then(function () { return regFetch(url, tries - 1); });
          }
          return null;
        });
    }
    // THE LIST DOES NOT WAIT FOR ALL THREE (RAZA 2026-10-19: "its taking too long to load destination
    // networks dropdown"). Measured on the live page, from the moment the three registry reads started:
    //
    //     /lxapi/xrploneclick?op=tokens     3,771 ms     ~30 destinations
    //     /lxapi/xrplaxelar?op=assets      11,345 ms     Hedera and XRPL EVM, and nothing else
    //     /lxapi/thorchain?op=pools         4,608 ms
    //
    // Promise.all waits for the slowest, so eleven seconds bought two chains, and the menu sat on
    // "Loading networks…" the whole time. The code below already treats a missing registry as a normal
    // state -- "ANY ONE route alone is a usable page", and NOTE.ax names what is absent when Axelar
    // fails -- so there was never a reason to hold the other thirty back.
    //
    // NEAR Intents' registry paints on its own the moment it lands; the full pass still runs when all
    // three are in and rebuilds the list with whatever else arrived. applyNi is shared so the early
    // paint and the authoritative one cannot drift apart.
    function applyNi(d) {
      if (!(d && d.ok && Array.isArray(d.tokens))) return false;
      TOKENS = d.tokens; NATIVES = d.natives || {}; KEYED = !!d.keyed;
      BY_CHAIN = {};
      TOKENS.forEach(function (t) { (BY_CHAIN[t.blockchain] = BY_CHAIN[t.blockchain] || []).push(t); });
      ORIGIN = (BY_CHAIN.xrp || [])[0] || null;
      delete BY_CHAIN.xrp;                        // never a destination
      return true;
    }
    function repaintAll() {
      try { paintSourceAsset(); title(wireDestinations()); paintSteps(); setCta(); } catch (_) {}
    }
    var pNi = regFetch(API + '?op=tokens', 3),
        pAx = regFetch(API_AX + '?op=assets', 3),
        pTh = regFetch(API_TH + '?op=pools', 3);
    pNi.then(function (d) { if (applyNi(d)) repaintAll(); }, function () {});
    Promise.all([pNi, pAx, pTh]).then(function (res) {
      var d = res[0], a = res[1], t = res[2];
      applyNi(d);
      if (a && a.ok && Array.isArray(a.assets)) {
        AX = a;
        AX_BY_SYM = {};
        AX_ORIGIN = null;                       // a view of AX_BY_SYM; rebuilt on first use
        a.assets.forEach(function (x) { AX_BY_SYM[x.symbol] = x; });
        // THE HISTORY TABLE READS THIS REGISTRY NOW, and it is painted from localStorage the moment
        // the page loads — well before this fetch returns. Without a repaint here, a row resolved
        // against an empty AX_BY_SYM keeps the sent symbol forever and the fix silently does nothing
        // on exactly the reload where it matters. Cheap: it is a re-render of rows already in hand.
        try { paintTxs(); } catch (_) {}
      }
      if (t && t.ok && Array.isArray(t.pools) && t.xrpTradeable) {
        TH = t; buildThNative();
        // Kept null when the endpoint omitted the key, which it does when that read failed. Mapped so
        // the lookup is a property test rather than an indexOf on every repaint.
        if (Array.isArray(t.halted)) {
          TH_HALT = {};
          t.halted.forEach(function (c) { TH_HALT[c] = 1; });
        }
      }
      // ANY ONE route alone is a usable page. All three down is not.
      if (!ORIGIN && !AX && !TH) { say('Routes unavailable — try again shortly'); return; }
      // NAMED, not silent. Axelar is the only way to Hedera and XRPL EVM, so when it is the one that
      // failed the list is short by exactly those two and nothing else would ever mention it.
      if (!AX) {
        NOTE.ax = 'Axelar is unavailable right now, so Hedera and XRPL EVM are not listed. Reload to retry.';
        try { console.warn("[bridge] Axelar registry unavailable after 3 attempts - Hedera and XRPL EVM hidden"); } catch (e) {}
      }
      window.__lxxNiChains = Object.keys(BY_CHAIN).filter(function (c) { return NI_CHAIN[c]; });
      window.__lxxAxAssets = AX ? AX.assets.map(function (x) { return x.symbol; }) : [];
      window.__lxxThChains = Object.keys(TH_NATIVE);
      // AND IT DOES NOT WAIT FOR THE WALLET EITHER. loadHoldings reads the ledger for this account's
      // balances and took a further nine seconds on the same measurement -- but which CHAINS exist is a
      // property of the registries, not of what the reader happens to hold. Paint now, then paint again
      // when the holdings land and the source asset can be rebound properly.
      repaintAll();
      return loadHoldings().then(function () {
        // SOURCE FIRST, THEN DESTINATIONS. The destination list is a function of the chosen source, so
        // building it before SRC has been rebound against the freshly-loaded registries shows the list
        // for whatever SRC was left holding -- which, on first load, is a source that knew nothing
        // about Axelar.
        repaintAll();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxNiReload = load;
})();
