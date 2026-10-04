// Cross-chain step 2 — only the parts of RAZA's reference design that cannot be CSS.
//
// The layout is in _xrplbridgepolish.js's stylesheet. This file does the four things a stylesheet
// cannot: insert the "From / To" rows, keep the destination pill and the address hint in step with
// whatever was chosen on step 1, name each asset in full under its ticker, and re-run all of that
// whenever the bridge client repaints.
//
// NOTHING HERE MOVES AN EXISTING NODE. browser/nibridge.js finds things by querying WITHIN each
// .br-side -- sides[1].querySelector('.br-addr-in'), side.querySelector('.br-asset .br-ic') -- so
// relocating a node would break it silently. Rows are DISSOLVED by CSS (display:contents) instead,
// which removes their box while leaving them in the tree; everything added here is a new sibling.
//
// THE SCAN BUTTON IS DELIBERATELY NOT PORTED. Stellar's step 2 carries a QR scanner; this build
// already has a complete one in browser/write.js for the Wallet page, private to that file's IIFE. A
// second camera implementation is about 150 lines and its own permission edge cases -- this project
// has already lost a day to a Permissions-Policy header that blocked `camera=(self)` -- and it is not
// what the design pass is about. The design's own Paste button is untouched and still there.
(function () {
  if (window.__lxxBrPolish) return; window.__lxxBrPolish = 1;

  // The name under the ticker. XRP is the only asset this ledger has natively; the rest are issued,
  // and an issued token's own name is not something to invent -- when the client has published one it
  // wins, and when it has not the row simply shows the ticker, which is what the ledger calls it.
  var FULL = { XRP: 'XRP', LUMOS: 'LumosCore', USDC: 'USD Coin', WETH: 'Wrapped Ether',
    WBTC: 'Wrapped Bitcoin', SHX: 'Stronghold', RLUSD: 'Ripple USD', ATOM: 'Cosmos Hub',
    BTC: 'Bitcoin', ETH: 'Ether', SOL: 'Solana', DOGE: 'Dogecoin', LTC: 'Litecoin',
    BCH: 'Bitcoin Cash', AVAX: 'Avalanche', BNB: 'BNB', TRX: 'Tron', ADA: 'Cardano',
    XLM: 'Stellar Lumens', HBAR: 'Hedera', RUNE: 'THORChain' };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // What step 1 currently has chosen. Read off the trigger rather than from the client's own state,
  // because this layer must keep working if the client is still loading its registries.
  function destNet() {
    var t = document.querySelector('.br-step[data-step="1"] .brd-trigger');
    if (!t) return { name: '', icon: '' };
    var nm = t.querySelector('.nm');
    var img = t.querySelector('img');
    var name = nm ? (nm.textContent || '').trim() : '';
    return { name: /select/i.test(name) ? '' : name, icon: img ? img.getAttribute('src') : '' };
  }

  function build() {
    var step = document.querySelector('.br-step[data-step="2"]');
    if (!step) return false;
    var sides = step.querySelectorAll('.br-io > .br-side');
    if (sides.length < 2) return false;
    var src = sides[0], dst = sides[1];

    if (!src.querySelector('.lx-s2net')) {
      // The source is always the XRP Ledger -- this page bridges OUT of the connected wallet -- so its
      // pill is a label, not a control, and carries no caret that would promise a choice not on offer.
      //
      // THE MARK IS THE ONE THE REST OF THE SITE USES (RAZA 2026-10-02: "XRP logo is incorrect"). This
      // said /assets/networks/xrpl.png, which is a different rendition from the canonical XRP badge --
      // softer strokes inside a ringed circle, against the crisp rounded square the dashboard, trade
      // rows, wallet, account and create-pool all draw. Four other layers in this repo already name the
      // same id for it; this pill was simply the one that did not.
      //
      // Not a local file, because there isn't a correct one: /assets/networks/xrpl.png is the odd
      // rendition and /assets/tokens/ni/XRP.png is a dark glyph on transparency, which on this page's
      // dark surface is very nearly invisible.
      var row = el('div', 'lx-s2net',
        '<span class="lx-s2lbl">From</span>'
        + '<span class="lx-s2pill"><span class="lx-s2ic" data-logo="" data-logoed="1">'
        + '<img src="/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48" alt=""></span>'
        + '<span class="lx-s2nm" data-logoed="1">XRP Ledger</span></span>');
      src.insertBefore(row, src.firstChild);
    }

    if (!dst.querySelector('.lx-s2net')) {
      var drow = el('div', 'lx-s2net',
        '<span class="lx-s2lbl">To</span>'
        + '<button type="button" class="lx-s2pill" data-lxs2dest>'
        + '<span class="lx-s2ic" data-logo="" data-logoed="1"></span>'
        + '<span class="lx-s2nm" data-logoed="1"></span><span class="lx-s2cv"></span></button>');
      dst.insertBefore(drow, dst.firstChild);
      // The destination is chosen on step 1, so the pill goes back there and opens the picker.
      drow.querySelector('[data-lxs2dest]').addEventListener('click', function (e) {
        e.preventDefault();
        var back = step.querySelector('.br-back');
        if (back) back.click();
        setTimeout(function () {
          var t = document.querySelector('.br-step[data-step="1"] .brd-trigger');
          if (t) t.click();
        }, 120);
      });
    }

    var wallet = dst.querySelector('.br-wallet.brw-in');
    if (wallet && !dst.querySelector('.lx-s2albl')) {
      dst.insertBefore(el('div', 'lx-s2albl', 'Receiving address'), wallet);
      var hint = el('div', 'lx-s2hint', '');
      if (wallet.nextSibling) dst.insertBefore(hint, wallet.nextSibling); else dst.appendChild(hint);
    }

    // The full name sits under the ticker, on the asset's own grid.
    [src, dst].forEach(function (side) {
      var a = side.querySelector('.br-asset');
      if (a && !a.querySelector('.lx-s2full')) a.appendChild(el('span', 'lx-s2full', ''));
    });

    // THE BALANCE AND MAX MOVE INTO THE AMOUNT BOX. The design keeps them in .br-amtrow beside the
    // word "Amount"; the reference design puts "Available to send" and the figure to the LEFT of the
    // box, and the stylesheet positions .lx-balrow to do that.
    //
    // This is the one node this layer relocates, and it is relocated because the alternative was
    // worse. The stylesheet hides .br-amtrow's children -- that row is just a label in the new
    // design -- and on this build .bal lives INSIDE it, carrying the balance AND the MAX button. So
    // the straight port silently deleted both: no balance, no MAX, no error. Stellar has the same
    // rule and does not lose them because its own bridge layer already made this move (_cctp.js).
    // The client's lookup was loosened to find .bal wherever it is, so nothing is pinned to this.
    var amtBox = src.querySelector('.br-amt');
    var balEl = src.querySelector('.br-amtrow .bal');
    if (amtBox && balEl && !src.querySelector('.lx-balrow')) {
      var balrow = el('div', 'lx-balrow', '');
      balrow.appendChild(balEl);
      amtBox.appendChild(balrow);
    }

    var subs = step.querySelector('.br-sh p');
    if (subs && /Pick your assets/.test(subs.textContent)) {
      subs.textContent = 'Send your assets from one network to another. Choose the asset, amount and destination address.';
    }
    var next = step.querySelector('.br-actions .br-next');
    if (next && (next.textContent || '').trim() === 'Review') next.textContent = 'Review transfer';

    return true;
  }

  function sync() {
    var step = document.querySelector('.br-step[data-step="2"]');
    if (!step) return;
    var d = destNet();

    var pill = step.querySelector('[data-lxs2dest]');
    if (pill) {
      var ic = pill.querySelector('.lx-s2ic'), nm = pill.querySelector('.lx-s2nm');
      if (nm && nm.textContent !== d.name) nm.textContent = d.name || 'Choose network';
      var want = d.icon ? '<img src="' + esc(d.icon) + '" alt="">' : '';
      if (ic && ic.getAttribute('data-src') !== d.icon) {
        ic.innerHTML = want;
        ic.setAttribute('data-src', d.icon || '');
      }
    }

    var hint = step.querySelector('.lx-s2hint');
    if (hint) {
      var t = d.name ? 'Make sure the address is on ' + d.name
        : 'Make sure the address is on the destination network';
      if (hint.textContent !== t) hint.textContent = t;
    }
    var input = step.querySelector('.br-addr-in');
    if (input && d.name) {
      var ph = 'Enter ' + d.name + ' address';
      if (input.getAttribute('placeholder') !== ph) input.setAttribute('placeholder', ph);
    }

    // THE DELIVERED ASSET IS WHATEVER THE CLIENT PUT IN THE NODE. There is no second face here and
    // no attribute to read: nibridge.js owns the destination .br-asset and writes the arriving
    // asset's ticker and logo into it, including the route-dependent cases (THORChain swaps, so
    // Cosmos Hub arrives as ATOM rather than as the XRP that was sent).
    var sides = step.querySelectorAll('.br-io > .br-side');
    var dside = sides[1];
    if (dside) {
      // A caret only where there is something to pick. The client marks the row itself when the
      // chosen route offers more than one arriving asset; a caret on a chain that offers exactly one
      // is a control whose entire menu is the token already on screen.
      var da = dside.querySelector('.br-asset');
      if (da) da.classList.toggle('lx-s2pick', da.style.cursor === 'pointer');
    }

    step.querySelectorAll('.br-asset').forEach(function (a) {
      var code = ((a.querySelector('.nm') || {}).textContent || '').trim();
      var f = a.querySelector('.lx-s2full');
      // The client's own name for the asset wins where it has one -- for an issued token that is the
      // only real source. FULL covers the natives, which have names nobody needs to look up.
      // PRESENT BEATS NON-EMPTY. `||` fell through to the ticker dictionary whenever the attribute was
      // an empty string, which is precisely the case that means "this asset has no name we can stand
      // behind" -- and the dictionary then supplied one belonging to a different chain's coin. If the
      // writer set the attribute at all, its answer is the answer, blank included.
      var full = a.hasAttribute('data-lxfull') ? (a.getAttribute('data-lxfull') || '') : (FULL[code] || '');
      if (f && f.textContent !== full) f.textContent = full;
    });

    // "Balance: 0.030 XRP" sits under a label that already says "Available to send", so the prefix
    // goes. Done in the observer, before paint, because the client rewrites this on every refresh.
    step.querySelectorAll('.lx-bal-txt').forEach(function (b) {
      var s = b.textContent || '';
      if (/^\s*Balance:\s*/i.test(s)) b.textContent = s.replace(/^\s*Balance:\s*/i, '');
    });
  }

  function start() {
    if (!build()) return false;
    sync();
    var root = document.querySelector('.bridge-wizard, .br-wizard, .br-card') || document.body;
    new MutationObserver(function () { try { sync(); } catch (_) {} })
      .observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  // The wizard can be built after this script runs, so keep trying for about nine seconds and then
  // stop -- a page that never has a step 2 is not a bridge page and should not be polled forever.
  if (!start()) {
    var tries = 0;
    var iv = setInterval(function () { if (start() || ++tries > 60) clearInterval(iv); }, 150);
  }
})();
