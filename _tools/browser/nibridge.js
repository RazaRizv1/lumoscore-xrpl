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
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
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
  var DEST = null;                  // {chain, token}
  var QUOTE = null;                 // the last live dry quote
  var LAST_NOTE = '';               // why there is no quote, in words the user can act on
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

  // The chain's mark is its NATIVE token's logo, fetched through our own proxy on the coingecko id
  // 1Click gives that token. No second registry of chain logos to go stale, and no direct CoinGecko
  // call from the page (their free tier 429s on bursts; the proxy caches for a week).
  function chainLogo(chain) {
    var list = BY_CHAIN[chain] || [];
    var nat = list.filter(function (t) { return !t.contractAddress; })[0] || list[0];
    return nat && nat.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(nat.coingeckoId)) : '';
  }
  function tokenLogo(t) {
    return t && t.coingeckoId ? (API + '?op=logo&id=' + encodeURIComponent(t.coingeckoId)) : '';
  }

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
      var img = o.querySelector('.brd-ic img');
      if (img) setIcon(ic, img.getAttribute('src'), name);
      else markLetters(ic, name);
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

  // ---- destinations --------------------------------------------------------------------------------
  function wireDestinations() {
    var opts = $$('.brd-opt');
    if (!opts.length) return 0;
    var menu = opts[0].parentNode;
    var wanted = {};                         // normalised display name -> chain key
    Object.keys(NI_CHAIN).forEach(function (k) { if (BY_CHAIN[k]) wanted[norm(NI_CHAIN[k])] = k; });

    var have = {};
    opts.forEach(function (o) {
      var key = norm(o.getAttribute('data-net'));
      have[key] = 1;
      var chain = wanted[key];
      if (chain) {
        // Revealed with an INLINE important declaration. The inherited Stellar stylesheet hides eleven
        // of these with `!important` because Circle CCTP could not reach them, and that CSS came across
        // with the fork — a stylesheet outliving the layer whose decision it encoded. An inline
        // important is the one thing that reliably outranks it regardless of which <style> lands last.
        o.style.setProperty('display', 'flex', 'important');
        o.setAttribute('data-lxchain', chain);
      } else {
        o.style.setProperty('display', 'none', 'important');
        o.removeAttribute('data-lxchain');
      }
    });

    Object.keys(NI_CHAIN).forEach(function (k) {
      if (!BY_CHAIN[k]) return;
      var nm = NI_CHAIN[k];
      if (have[norm(nm)]) return;
      have[norm(nm)] = 1;
      menu.appendChild(extraOption(opts[0], k, nm));
    });

    $$('.brd-opt', menu).sort(function (a, b) {
      return String(a.getAttribute('data-net')).localeCompare(String(b.getAttribute('data-net')));
    }).forEach(function (o) { menu.appendChild(o); });

    var shown = $$('.brd-opt', menu).filter(function (o) { return o.getAttribute('data-lxchain'); });
    window.__lxxBridgeNets = shown.map(function (o) { return o.getAttribute('data-net'); });
    return shown.length;
  }

  function extraOption(tpl, chain, name) {
    var o = tpl.cloneNode(true);                       // a clone carries no listeners
    o.setAttribute('data-net', name);
    o.setAttribute('data-lxchain', chain);
    o.setAttribute('data-lxadded', '1');
    o.removeAttribute('style');
    o.style.setProperty('display', 'flex', 'important');
    var ic = o.querySelector('.brd-ic');
    if (ic) { ic.removeAttribute('style'); ic.textContent = ''; setIcon(ic, chainLogo(chain), name); }
    var nm = o.querySelector('.brd-nm');
    if (nm) { nm.setAttribute('data-logoed', '1'); nm.textContent = name; }
    return o;
  }

  // Which chain the design's trigger is currently showing.
  function destChain() {
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    if (!trg || trg.classList.contains('is-empty') || !tn) return null;
    var k = norm(tn.textContent);
    var found = null;
    Object.keys(NI_CHAIN).forEach(function (c) { if (norm(NI_CHAIN[c]) === k && BY_CHAIN[c]) found = c; });
    return found;
  }

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
    var chain = destChain(), as = ensureDestRow(dst);
    if (!as || !chain) return;
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
    var chain = destChain();
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
    var v = side && side.querySelector('.br-amt .v');
    if (!v) return null;
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
    [['fee', 'LumosCore fee'], ['eta', 'Estimated time']].forEach(function (p) {
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
    var amt = amountXrp(), chain = destChain(), me = addr();
    QUOTE = null;
    if (!amt || !DEST || !chain) { paintQuote(null, ''); return; }
    var n = netDrops(amt);
    if (n.net < MIN_DROPS) {
      paintQuote(null, 'Minimum ' + (MIN_DROPS / 1e6) + ' XRP');
      return;
    }
    var to = recipient();
    if (!to) { paintQuote(null, 'Enter a destination address'); return; }
    var seq = ++qSeq;
    paintQuote(null, 'Quoting…');
    fetch(API + '?op=quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dry: true, originAsset: ORIGIN.assetId, destinationAsset: DEST.token.assetId,
        amount: String(n.net), refundTo: me || undefined, recipient: to
      })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (seq !== qSeq) return;                       // a newer keystroke won
        if (res.s === 201 && res.j && res.j.quote) { QUOTE = res.j.quote; paintQuote(res.j.quote, ''); }
        else paintQuote(null, String((res.j && (res.j.error || res.j.message)) || 'No route for this amount'));
      })
      .catch(function () { if (seq === qSeq) paintQuote(null, 'Quote unavailable'); });
  }

  function paintQuote(q, note) {
    LAST_NOTE = q ? "" : String(note || "");
    var s2 = $('.br-step[data-step="2"]');
    var dst = s2 && s2.querySelectorAll('.br-side')[1];
    var am = dst && dst.querySelector('.br-amt');
    if (am) {
      var v = am.querySelector('.v'), u = am.querySelector('.usd');
      if (v) v.textContent = q ? fmt(q.amountOutFormatted, 6) : '—';
      if (u) u.textContent = q ? ('~ $' + fmt(q.amountOutUsd, 2)) : (note || '');
    }
    paintReview(q, note);
    setCta();
  }

  function paintReview(q, note) {
    var amt = amountXrp(), n = netDrops(amt);
    var set = function (sel, txt) { var e = $(sel); if (e && e.textContent !== txt) e.textContent = txt; };
    set('[data-rv="send"]', amt ? (fmt(amt, 6) + ' XRP') : '0 XRP');
    set('[data-rv="recv"]', q ? (fmt(q.amountOutFormatted, 6) + ' ' + DEST.token.symbol)
      : ('— ' + (DEST ? DEST.token.symbol : '')));
    set('[data-rv="sendnet"]', 'XRP Ledger');
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    set('[data-rv="recvnet"]', (trg && !trg.classList.contains('is-empty') && tn) ? tn.textContent : '—');
    set('[data-rv="src"]', addr() ? short(addr()) : '—');
    set('[data-rv="dst"]', recipient() ? short(recipient()) : '—');
    var f = $('[data-rv="fee"]');
    if (f) f.textContent = amt ? (fmt(n.fee / 1e6, 6) + ' XRP (' + (feeRate() * 100).toFixed(1) + '%)') : '—';
    var t = $('[data-rv="eta"]');
    if (t) t.textContent = q && q.timeEstimate ? ('~' + q.timeEstimate + 's') : '—';
  }

  function paintSteps() {
    var s2 = $('.br-step[data-step="2"]');
    if (s2) {
      var sides = s2.querySelectorAll('.br-side'), src = sides[0], dst = sides[1];
      if (src) {
        var bal = src.querySelector('.br-amtrow .bal');
        if (bal) {
          var mx = bal.querySelector('.max');
          var have = XRP_SPEND != null && XRP_SPEND >= 0;
          var txt = 'Balance: ' + (have ? fmt(XRP_SPEND, 2) + ' XRP' : '—') + ' ';
          [].slice.call(bal.childNodes).forEach(function (nd) { if (nd.nodeType === 3) bal.removeChild(nd); });
          bal.insertBefore(document.createTextNode(txt), bal.firstChild);
          if (mx) {
            mx.removeAttribute('data-logo'); mx.removeAttribute('style');
            mx.setAttribute('data-logoed', '1');
            if (mx.textContent !== 'MAX') mx.textContent = 'MAX';
          }
        }
        var as = src.querySelector('.br-asset');
        if (as) {
          var nm = as.querySelector('.nm');
          if (nm && nm.textContent !== 'XRP') nm.textContent = 'XRP';
          setIcon(as.querySelector('.br-ic'), XRP_LOGO);
        }
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
    if (!DEST) return 'Choose a destination';
    var amt = amountXrp();
    if (!amt) return 'Enter an amount';
    var n = netDrops(amt);
    if (n.net < MIN_DROPS) return 'Minimum ' + (MIN_DROPS / 1e6) + ' XRP';
    if (XRP_SPEND != null && amt > XRP_SPEND) return 'More than your spendable balance';
    if (!recipient()) return 'Enter a destination address';
    // THE REAL REASON, not a generic wait. A recipient the destination chain would reject is refused
    // by the proxy with "recipient does not look like a base address" -- and the first version threw
    // that away and left the button reading "Waiting for a quote", which describes a network delay
    // rather than something the user can act on.
    if (!QUOTE) return LAST_NOTE || 'Waiting for a quote';
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

  function send() {
    if (busy) return;
    var why = blockReason();
    if (why) return;
    busy = true;
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
  function title(n) {
    try {
      document.title = 'Bridge from the XRP Ledger'
        + (n ? (' — ' + n + ' networks via NEAR Intents') : '') + ' | LumosCore';
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

    fetch(API + '?op=tokens')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !Array.isArray(d.tokens)) throw new Error('no tokens');
        TOKENS = d.tokens; NATIVES = d.natives || {}; KEYED = !!d.keyed;
        BY_CHAIN = {};
        TOKENS.forEach(function (t) { (BY_CHAIN[t.blockchain] = BY_CHAIN[t.blockchain] || []).push(t); });
        ORIGIN = (BY_CHAIN.xrp || [])[0] || null;
        delete BY_CHAIN.xrp;                      // never a destination
        if (!ORIGIN) throw new Error('no XRP origin');
        window.__lxxNiChains = Object.keys(BY_CHAIN).filter(function (c) { return NI_CHAIN[c]; });
        title(wireDestinations());
        paintSteps();
      })
      .catch(function () {
        // Nothing is claimed when the list cannot be had: the page keeps the destinations it shipped
        // with and the button says why it will not move.
        say('Routes unavailable — try again shortly');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxNiReload = load;
})();
