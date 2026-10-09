// Bridge page: which chains the XRP Ledger can actually reach, through Axelar.
//
// Replaces `lx-cctp-js` (~123KB), which moved USDC between STELLAR and eight EVM chains via Circle
// CCTP. Wrong bridge and wrong source chain, on a page whose own heading already read "via Axelar"
// and whose runtime-set title said "Bridge USDC across 8 chains with Circle CCTP".
//
// THE DESTINATION LIST IS FILTERED BY AXELAR'S REGISTRY, not hardcoded. A stale list on a bridge
// offers a route that no longer exists, which is worse than offering fewer. The list itself is the
// design's own dropdown — this layer decides which of its entries are real, and builds nothing.
//
// TRANSFERS ARE NOT WIRED, AND THE PAGE SAYS SO. Quoting and executing needs Squid's routing API
// (an x-integrator-id we do not have) plus a signed transaction moving real funds. A button that
// looks like it works, on a page about moving money, is the worst thing this file could ship.
(function () {
  if (window.__lxxBridge) return;
  window.__lxxBridge = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // THIS LAYER USED TO BUILD ITS OWN PANEL, AND THAT WAS THE WHOLE PROBLEM.
  //
  // It appended a note plus a grid of fifty-eight name chips under the wizard — a wall of text
  // ("Agoric Arbitrum Archway Avalanche Axelar Babylon Base Blast BNB Chain Carbon Celestia …") on a
  // page that already ships a searchable destination dropdown two inches above it. That is the thing
  // RAZA called a mess, and it was invented UI on a page that had a control for exactly this. The
  // standing rule on this fork is to wire what the design already has, not to add to it.
  //
  // So nothing is built here any more. The design's `.brd-opt` list is filtered to the destinations
  // Axelar can actually reach from the XRP Ledger, and the wizard is left to be the wizard.
  //
  // TWO SETS OF WRONG ENTRIES HAD TO GO, IN OPPOSITE DIRECTIONS:
  //
  //   Offered but unreachable — Near, Starknet, World Chain, zkSync Era are in the design's list and
  //   are NOT in Axelar's XRPL registry. A bridge naming a route it does not have is the worst kind
  //   of wrong on this page.
  //
  //   Reachable but hidden — an inherited stylesheet carries
  //       .brd-opt[data-net="BNB Chain"]{display:none!important}
  //   and the same for Hedera, Mantle, Scroll, Sei, Solana and Sui. Those are Stellar's rules: Circle
  //   CCTP does not reach them, so Stellar's build hides them. Axelar does reach them from the XRP
  //   Ledger, and the CSS came across with the fork — the stripped-layer trap again, a stylesheet
  //   outliving the layer whose decision it encoded. Seven real routes were invisible.
  //
  // Set inline with priority rather than through a stylesheet of our own: the inherited rules are
  // `!important`, and an inline important declaration is the one thing that reliably outranks them
  // without depending on which <style> the build happens to emit last.
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function wireDestinations(d) {
    var opts = $$('.brd-opt');
    if (!opts.length) return 0;

    // Without a registry, nothing is claimed and nothing is re-hidden: the page keeps exactly the
    // destinations it shipped with. Guessing in either direction on a bridge is not on.
    if (!d || !d.ok || !d.rows || !d.rows.length) return 0;

    // `supported` is the endpoint's own intersection of Axelar's registry with the destinations this
    // design offers, and it is preferred so that this page and the dashboard's Cross-chain card
    // cannot report different totals. The full registry stays as the fallback, which is what this
    // filtered against before the field existed.
    var list = (d.supported && d.supported.length) ? d.supported : d.rows.map(function (r) { return r.name; });
    var reach = {};
    for (var i = 0; i < list.length; i++) reach[norm(list[i])] = 1;

    // EVERY OTHER NETWORK THE XRP LEDGER REACHES (RAZA 2026-09-15: "Axelar and Wanchain bridge have so many
    // more networks that should be added into the list"). The design ships eighteen options; Axelar's
    // registry lists every chain it connects to the XRP Ledger, and Wanchain adds its own chain. Each extra
    // entry is a clone of the design's own option carrying the chain's logo, sorted in with the rest.
    var menu = opts[0].parentNode;
    var have = {};
    opts.forEach(function (o) { have[norm(o.getAttribute('data-net'))] = 1; });
    d.rows.map(function (r) { return { name: r.name, img: r.img }; }).concat(WANCHAIN).forEach(function (r) {
      var k = norm(r.name);
      if (!k || have[k] || /^xrpledger$/.test(k)) return;
      have[k] = 1;
      reach[k] = 1;
      menu.appendChild(extraOption(opts[0], r));
    });
    // Alphabetical, as the design orders its own. Moving a node keeps the listeners on it.
    var all = $$('.brd-opt', menu).sort(function (a, b) {
      return String(a.getAttribute('data-net')).localeCompare(String(b.getAttribute('data-net')));
    });
    all.forEach(function (o) { menu.appendChild(o); });

    REACH = reach;
    // Published for the How-it-works dialog, so it lists what the picker lists.
    window.__lxxBridgeNets = $$('.brd-opt', menu).map(function (o) { return o.getAttribute('data-net'); })
      .filter(function (n) { return REACH[norm(n)]; });
    return reassert();
  }

  // Wanchain's bridge API lists one XRP route: XRP to its own chain (and on to Ethereum as wanXRP, already
  // offered). Its other chains carry no XRP Ledger route, so they are not claimed here.
  var WANCHAIN = [{ name: 'Wanchain', img: 'https://xflows.wanchain.org/Chain/Wanchain.png' }];
  var REACH = null;

  function extraOption(tpl, r) {
    var o = tpl.cloneNode(true);                                 // a clone carries no listeners
    o.setAttribute('data-net', r.name);
    o.setAttribute('data-lxadded', '1');
    o.removeAttribute('style');
    var ic = o.querySelector('.brd-ic');
    if (ic) {
      ic.removeAttribute('style');
      ic.setAttribute('data-logoed', '1');
      ic.textContent = '';
      var letters = function () {
        ic.textContent = r.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
        ic.style.background = '#5b6170';
      };
      if (r.img) {
        ic.classList.remove('lx-netlm');
        var im = document.createElement('img');
        im.className = 'lx-netimg';
        im.alt = '';
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); ic.classList.add('lx-netlm'); letters(); };
        im.src = r.img;
        ic.appendChild(im);
      } else {
        letters();
      }
    }
    var nm = o.querySelector('.brd-nm');
    if (nm) nm.textContent = r.name;
    // What the design's dropdown script does for its own options, which it bound once at load.
    o.addEventListener('click', function (e) {
      e.stopPropagation();
      var dd = o.closest('.brd'), t = dd && dd.querySelector('.brd-trigger');
      if (!t) return;
      var tn = t.querySelector('.nm');
      if (tn) tn.textContent = r.name;
      t.classList.remove('is-empty');
      var tic = t.querySelector('.br-ic'), src = o.querySelector('.brd-ic');
      if (tic && src) {
        tic.textContent = '';
        var wrap = document.createElement('span');
        wrap.className = 'lx-netlm2';
        if (src.querySelector('img')) wrap.appendChild(src.querySelector('img').cloneNode(true));
        else { wrap.style.background = src.style.background; wrap.textContent = src.textContent; }
        tic.appendChild(wrap);
      }
      dd.classList.remove('open');
    });
    return o;
  }

  // The design's search box writes style.display = "" / "none" on every option, which wipes the inline
  // !important this layer sets — and the inherited CCTP rules then hide BNB Chain, Solana, Sui and the rest
  // the moment a search is cleared. So after every search the decision is put back.
  function reassert() {
    if (!REACH) return 0;
    // The destination-token menu reuses .brd-opt for its styling; only the network picker's options are filtered.
    var q = $('.brd-q'), v = q ? q.value.trim().toLowerCase() : '', shown = 0;
    $$('.brd-opt').forEach(function (o) {
      var net = o.getAttribute('data-net') || '';
      var ok = !!REACH[norm(net)] && (!v || net.toLowerCase().indexOf(v) >= 0);
      o.style.setProperty('display', ok ? 'flex' : 'none', 'important');
      if (REACH[norm(net)]) shown++;
    });
    if (q && !q.__lxxReassert) {
      q.__lxxReassert = 1;
      q.addEventListener('input', function () { setTimeout(reassert, 0); });
    }
    return shown;
  }

  // The title is set at runtime and still named Circle CCTP. This layer decides what the page is.
  //
  // Counts the destinations the page actually OFFERS, not the 58 in Axelar's registry. The title said
  // "58 networks via Axelar" over a dropdown listing fourteen, which is a promise the page does not
  // keep — and it is the line that shows up in search results.
  function title(shown) {
    try {
      document.title = 'Bridge from the XRP Ledger'
        + (shown ? (' — ' + shown + ' networks via Axelar and Wanchain') : '')
        + ' | LumosCore';
    } catch (e) {}
  }

  // Any step or control that would start a transfer is disabled, so the page cannot imply it moves
  // funds. Left visible rather than hidden: the flow is real, it just is not connected yet.
  // THIS MATCHED NOTHING, ON A PAGE ABOUT MOVING MONEY.
  //
  // It looked for `.br-cta`, `.br-review-cta` and `[data-br-submit]`. None of those exist here — the
  // wizard's buttons are all `.br-next` — so every guard in this function was a no-op and the final
  // button sat there fully live, reading "Confirm swap", on a flow with nothing behind it. The
  // function existed, was called, threw nothing, and protected exactly zero buttons. Checked by
  // listing the page's actual buttons rather than by reading this selector list again.
  //
  // Only the TERMINAL action is disabled. Next and Review just walk the wizard and nothing is
  // dishonest about letting someone look at it — which is also what "honest and disabled, like
  // Create Pool" means: the flow stays visible, the irreversible step does not pretend.
  function disableTransfer() {
    $$('.br-next').forEach(function (b) {
      try {
        if (!/^\s*(confirm|bridge|swap)/i.test(b.textContent || '')) return;
        if (b.getAttribute('data-lxbr') === '1') return;      // already done; keeps the label stable
        b.setAttribute('data-lxbr', '1');
        b.setAttribute('disabled', 'disabled');
        b.setAttribute('aria-disabled', 'true');
        b.style.opacity = '.55';
        b.style.pointerEvents = 'none';
        b.textContent = 'Transfers not enabled yet';
      } catch (e) {}
    });
  }

  // THE SOURCE SIDE OF THIS PAGE STILL BELONGED TO ANOTHER CHAIN.
  //
  // The page's own first step reads "Your connected network is the source", and the source chip
  // said **Aptos**, beside a wallet reading **0x0167…7065 · Connected** — an EVM-shaped address,
  // invented by the design, presented as the address you are bridging out of. Both were visible at
  // rest, without opening anything. The review step then said "You send 100 BVET Aptos".
  //
  // The destination list has been real since this file replaced the CCTP layer; the source was
  // simply never claimed by anything.
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';

  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function paintSource() {
    var me = addr();

    // The chip naming the source network, and the mark beside it. The design embeds the old chain's
    // logo as a base64 webp; it is replaced rather than hidden, so the chip keeps its shape.
    //
    // `:not(.brd-trigger)` IS THE WHOLE FIX FOR "DESTINATION: XRP LEDGER". The destination dropdown's
    // closed state is also a `.br-netchip`, so this loop was stamping "XRP Ledger" over its
    // placeholder — the page opened asking you to bridge the XRP Ledger to the XRP Ledger. The
    // design ships that trigger reading "Select Network" and it is left to say so.
    $$('.br-netchip:not(.brd-trigger)').forEach(function (c) {
      var nm = c.querySelector('.nm');
      if (nm) nm.textContent = 'XRP Ledger';
      // setIcon, NOT a bare img.src (RAZA 2026-10-09: "on XRPL, source network logo is not there").
      // The comment above says the design embeds the old chain's logo as a base64 webp and that this
      // replaces it -- true on the build that comment was written against, and not true here: on the
      // combined build the source chip ships as `<span class="br-ic"></span>`, empty. `if (img)` was
      // then simply false and the chip kept a 26px hole where its mark belongs, reporting nothing.
      // setIcon creates the img when the host has none, which is the whole difference, and it is what
      // every other icon on this page already goes through.
      setIcon(c.querySelector('.br-ic'), XRP_LOGO);
    });

    // The source wallet. Never a fabricated address: either the one that is connected, or a plain
    // statement that none is.
    $$('.br-wallet').forEach(function (w) {
      var a = w.querySelector('.addr');
      if (a) a.textContent = me ? short(me) : 'Not connected';
      var img = w.querySelector('img');
      if (img) { img.src = XRP_LOGO; img.alt = ''; }
      // The status word sits beside it and shipped reading "Connected" unconditionally.
      [].forEach.call(w.children, function (ch) {
        if (ch.classList && ch.classList.contains('addr')) return;
        if (/^connected$/i.test((ch.textContent || '').trim())) ch.textContent = me ? 'Connected' : 'Not connected';
      });
    });

    // The review step names the two chains either side of the arrow. The second is already right.
    var s = $$('.br-step .s');
    if (s[0] && /aptos/i.test(s[0].textContent || '')) s[0].textContent = 'XRP Ledger';
  }

  // ---- steps 2 and 3 --------------------------------------------------------------------------------
  // RAZA 2026-09-15: "I selected Stellar as the destination network and then when i proceeded to the next step, its
  // showing placeholder values and asset (eg: MESO)." The design's wizard ships "Balance: 12.5K MESO", a MESO asset
  // chip, "100" and "~ 92.0 XRP", and its review repeats "100 BVET". Nothing here can be moved yet, so the source is
  // this account's spendable XRP, the amounts are zero, the estimate is a dash, and the review says only what the
  // form holds: the chosen network and the two addresses.
  var XRP_SPEND = null;
  function rpcB(method, params) {
    return fetch('https://xrplcluster.com/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) { return j && j.result; });
  }
  function loadSpendable() {
    var me = addr();
    if (!me || XRP_SPEND != null) return;
    XRP_SPEND = -1;
    Promise.all([rpcB('account_info', { account: me, ledger_index: 'validated' }), rpcB('server_info', {})]).then(function (r) {
      var ad = r[0] && r[0].account_data, vl = r[1] && r[1].info && r[1].info.validated_ledger;
      if (!ad || !vl) { XRP_SPEND = null; return; }
      XRP_SPEND = Math.max(0, Number(ad.Balance) / 1e6 - (Number(vl.reserve_base_xrp) + Number(vl.reserve_inc_xrp) * Number(ad.OwnerCount || 0)));
      paintSteps();
    }).catch(function () { XRP_SPEND = null; });
  }
  function setIcon(host, src) {
    if (!host) return;
    var img = host.querySelector('img');
    if (!img) {
      host.textContent = '';
      img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      host.appendChild(img);
    }
    if (img.getAttribute('src') !== src) img.src = src;
  }
  // THE DESTINATION'S OWN TOKEN (RAZA 2026-09-15: "in You Get, you need to show the native token of the network selected by
  // the user … and in dropdown CELO based assets"). The chosen network's native token is shown, and the chevron opens that
  // chain's assets from Axelar's registry, in the network picker's own .brd-menu / .brd-opt styling.
  var DEST_PICK = null;
  function destChain() {
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    if (!trg || trg.classList.contains('is-empty') || !tn) return null;
    var name = tn.textContent.trim();
    if (/^wanchain$/i.test(name)) {
      return { name: 'Wanchain', native: { symbol: 'WAN' }, img: WANCHAIN[0].img,
        assets: [{ s: 'WAN', img: WANCHAIN[0].img }, { s: 'wanXRP', img: XRP_LOGO }] };
    }
    var d = window.__lxxBridgeData;
    var row = d && (d.rows || []).filter(function (r) { return norm(r.name) === norm(name); })[0];
    return row || { name: name, native: null, img: '', assets: [] };
  }
  function destOptions(c) {
    var out = [], seen = {};
    var nat = c.native && c.native.symbol;
    if (nat) {
      var ni = (c.assets || []).filter(function (a) { return a.s === nat; })[0];
      out.push({ s: nat, img: (ni && ni.img) || c.img || '' });
      seen[nat] = 1;
    }
    (c.assets || []).forEach(function (a) { if (!seen[a.s]) { seen[a.s] = 1; out.push(a); } });
    return out;
  }
  function paintDestAsset(dst) {
    var c = destChain(), as = dst.querySelector('.br-asset');
    if (!as || !c) return;
    var opts = destOptions(c);
    if (!DEST_PICK || DEST_PICK.chain !== c.name) DEST_PICK = opts[0] ? { chain: c.name, s: opts[0].s, img: opts[0].img } : null;
    if (!DEST_PICK) return;
    var nm = as.querySelector('.nm');
    if (nm && nm.textContent !== DEST_PICK.s) { nm.textContent = DEST_PICK.s; nm.setAttribute('data-logoed', '1'); }
    if (DEST_PICK.img) setIcon(as.querySelector('.br-ic'), DEST_PICK.img);
    as.style.cursor = opts.length > 1 ? 'pointer' : '';
    if (!as.__lxxMenu) {
      as.__lxxMenu = 1;
      as.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleDestMenu(as); });
    }
  }
  function toggleDestMenu(as) {
    var old = document.querySelector('.lx-destmenu');
    if (old) { old.parentNode.removeChild(old); return; }
    var c = destChain();
    if (!c) return;
    var opts = destOptions(c);
    if (opts.length < 2) return;
    var wrap = document.createElement('div');
    wrap.className = 'brd open lx-destmenu';
    wrap.style.cssText = 'position:absolute;z-index:60;right:0;top:calc(100% + 6px);min-width:220px';
    var menu = document.createElement('div');
    menu.className = 'brd-menu';
    menu.style.cssText = 'display:block;position:static;max-height:280px;overflow:auto';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'brd-opt lx-destopt';
      b.style.setProperty('display', 'flex', 'important');
      var ic = document.createElement('span');
      ic.className = 'brd-ic';
      ic.setAttribute('data-logoed', '1');
      var letters = function () { ic.textContent = o.s.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); ic.style.background = '#5b6170'; };
      if (o.img) {
        var im = document.createElement('img');
        im.className = 'lx-netimg';
        im.alt = '';
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); letters(); };
        im.src = o.img;
        ic.appendChild(im);
      } else letters();
      var nmx = document.createElement('span');
      nmx.className = 'brd-nm';
      nmx.setAttribute('data-logoed', '1');
      nmx.textContent = o.s;
      b.appendChild(ic);
      b.appendChild(nmx);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        DEST_PICK = { chain: c.name, s: o.s, img: o.img };
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        paintSteps();
      });
      menu.appendChild(b);
    });
    wrap.appendChild(menu);
    var host = as.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
    requestAnimationFrame(function () {
      document.addEventListener('click', function away(e) {
        if (wrap.contains(e.target)) return;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.removeEventListener('click', away, true);
      }, true);
    });
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
          var txt = 'Balance: ' + (have ? XRP_SPEND.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' XRP' : '—') + ' ';
          [].slice.call(bal.childNodes).forEach(function (n) { if (n.nodeType === 3) bal.removeChild(n); });
          bal.insertBefore(document.createTextNode(txt), bal.firstChild);
          if (mx) {
            mx.removeAttribute('data-logo');
            mx.removeAttribute('style');
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
        var am = src.querySelector('.br-amt');
        if (am && !am.__lxxInit) {
          am.__lxxInit = 1;
          var v = am.querySelector('.v'), u = am.querySelector('.usd');
          if (v) v.textContent = '0';
          if (u) u.textContent = '~ $0.00';
        }
      }
      if (dst) paintDestAsset(dst);
      if (dst) {
        var am2 = dst.querySelector('.br-amt');
        if (am2) {
          var v2 = am2.querySelector('.v'), u2 = am2.querySelector('.usd');
          if (v2 && v2.textContent !== '—') v2.textContent = '—';
          if (u2 && u2.textContent) u2.textContent = '';
        }
      }
    }
    var send = $('[data-rv="send"]');
    if (send) {
      if (send.textContent !== '0 XRP') send.textContent = '0 XRP';
      var ics = send.parentNode ? send.parentNode.querySelectorAll('.ic') : [];
      if (ics[1]) setIcon(ics[1], XRP_LOGO);
    }
    var recv = $('[data-rv="recv"]');
    var rtx = DEST_PICK ? ('— ' + DEST_PICK.s) : '—';
    if (recv && recv.textContent !== rtx) recv.textContent = rtx;
    var trg = $('.brd-trigger'), tn = trg && trg.querySelector('.nm');
    var rn = $('[data-rv="recvnet"]');
    if (rn) rn.textContent = (trg && !trg.classList.contains('is-empty') && tn) ? tn.textContent : '—';
    var sn = $('[data-rv="sendnet"]');
    if (sn) sn.textContent = 'XRP Ledger';
    var rs = $('[data-rv="src"]');
    if (rs) rs.textContent = addr() ? short(addr()) : '—';
    var dIn = $('.br-addr-in'), rd = $('[data-rv="dst"]');
    if (rd) rd.textContent = (dIn && dIn.value.trim()) ? short(dIn.value.trim()) : '—';
  }

  function load() {
    if (!$('.br-netbox') && !document.getElementById('lxBrPending')) return;   // not this page
    paintSource();
    // THE NETWORK CHIPS WAITED THREE SECONDS (RAZA 2026-09-15: "this takes awkwardly long to load"). An inherited
    // stylesheet hides them until html.lx-chainready, and the only thing adding it was a fallback timer set to
    // 3000ms. The source is painted just above, so the gate comes down now.
    try { document.documentElement.classList.add('lx-chainready'); } catch (e) {}
    paintSteps();
    loadSpendable();
    if (!window.__lxxBridgeSteps) {
      window.__lxxBridgeSteps = 1;
      // After the wizard moves, and after the design has written its own review values.
      window.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest || !t.closest('.br-next, .br-back, .brd-opt, .br-step, .brd')) return;
        setTimeout(paintSteps, 30);
        setTimeout(paintSteps, 250);
      }, true);
      window.addEventListener('input', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('br-addr-in')) setTimeout(paintSteps, 0);
      }, true);
    }
    disableTransfer();
    fetch('/lxapi/xrplbridge')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.__lxxBridgeData = d && d.ok ? d : null;
        title(wireDestinations(d));
        disableTransfer();
      })
      .catch(function () { disableTransfer(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxBridgeReload = load;
})();
