// Bridge page: which chains the XRP Ledger can actually reach, through Axelar.
//
// Replaces `lx-cctp-js` (~123KB), which moved USDC between STELLAR and eight EVM chains via Circle
// CCTP. Wrong bridge and wrong source chain, on a page whose own heading already read "via Axelar"
// and whose runtime-set title said "Bridge USDC across 8 chains with Circle CCTP".
//
// THE DESTINATION LIST IS FETCHED FROM AXELAR, not hardcoded. A stale list on a bridge offers a
// route that no longer exists, which is worse than offering fewer.
//
// TRANSFERS ARE NOT WIRED, AND THE PAGE SAYS SO. Quoting and executing needs Squid's routing API
// (an x-integrator-id we do not have) plus a signed transaction moving real funds. A button that
// looks like it works, on a page about moving money, is the worst thing this file could ship.
(function () {
  if (window.__lxxBridge) return;
  window.__lxxBridge = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  (function () {
    if (document.getElementById('lxx-br-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-br-css';
    st.textContent = '.lxx-br-note{margin:12px 0;padding:11px 13px;border-radius:11px;'
      + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);'
      + 'font-size:13px;line-height:1.5;opacity:.9}'
      + '.lxx-br-grid{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}'
      + '.lxx-br-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;'
      + 'border-radius:999px;background:rgba(255,255,255,.06);'
      + 'border:1px solid rgba(255,255,255,.09);font-size:12.5px;font-weight:600}'
      + '.lxx-br-chip img{width:15px;height:15px;border-radius:50%}';
    document.head.appendChild(st);
  })();

  function chip(c) {
    var s = el('span', 'lxx-br-chip');
    if (c.img) {
      var i = document.createElement('img');
      i.src = c.img; i.alt = ''; i.loading = 'lazy';
      // Axelar's own icons; if one 404s drop it rather than leave a broken image.
      i.onerror = function () { i.remove(); };
      s.appendChild(i);
    }
    s.appendChild(document.createTextNode(c.name));
    return s;
  }

  function render(d) {
    // The step-1 panel is where a destination is chosen; put the truth there rather than in a
    // footnote nobody reads before clicking.
    var host = $('.br-netbox') ? $('.br-netbox').parentElement : ($('.br-panel') || $('main.page'));
    if (!host || document.getElementById('lxx-br')) return;

    var wrap = el('div');
    wrap.id = 'lxx-br';

    var note = el('div', 'lxx-br-note');
    if (!d || !d.ok) {
      note.textContent = 'Could not read the Axelar chain registry, so the reachable networks are '
        + 'unknown right now. Nothing is bridged from this page yet.';
      wrap.appendChild(note);
      host.appendChild(wrap);
      return;
    }

    note.appendChild(document.createTextNode(
      'Route discovery only — transfers are not enabled from this page yet. '
      + 'The XRP Ledger reaches ' + d.count + ' networks through Axelar:'));
    wrap.appendChild(note);

    var grid = el('div', 'lxx-br-grid');
    for (var i = 0; i < d.rows.length; i++) grid.appendChild(chip(d.rows[i]));
    wrap.appendChild(grid);

    var attr = el('div');
    attr.style.cssText = 'margin-top:10px;font-size:11.5px;opacity:.6';
    attr.appendChild(document.createTextNode('Network list from '));
    var a = el('a', null, d.src || 'Axelar');
    a.href = d.srcUrl || 'https://axelarscan.io';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    attr.appendChild(a);
    wrap.appendChild(attr);

    host.appendChild(wrap);
  }

  // The title is set at runtime and still named Circle CCTP. This layer decides what the page is.
  function title(d) {
    try {
      document.title = 'Bridge from the XRP Ledger'
        + (d && d.ok ? (' — ' + d.count + ' networks via Axelar') : '')
        + ' | LumosCore';
    } catch (e) {}
  }

  // Any step or control that would start a transfer is disabled, so the page cannot imply it moves
  // funds. Left visible rather than hidden: the flow is real, it just is not connected yet.
  function disableTransfer() {
    $$('.br-cta, .br-review-cta, [data-br-submit]').forEach(function (b) {
      try {
        b.setAttribute('disabled', 'disabled');
        b.setAttribute('aria-disabled', 'true');
        b.style.opacity = '.55';
        b.style.pointerEvents = 'none';
        if (/bridge|swap|continue|review/i.test(b.textContent || '')) b.textContent = 'Transfers not enabled yet';
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
    $$('.br-netchip').forEach(function (c) {
      var nm = c.querySelector('.nm');
      if (nm) nm.textContent = 'XRP Ledger';
      var img = c.querySelector('img');
      if (img) { img.src = XRP_LOGO; img.alt = ''; }
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

  function load() {
    if (!$('.br-netbox') && !document.getElementById('lxBrPending')) return;   // not this page
    paintSource();
    fetch('/lxapi/xrplbridge')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.__lxxBridgeData = d && d.ok ? d : null;
        title(d);
        render(d);
        disableTransfer();
      })
      .catch(function () { title(null); render(null); disableTransfer(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxBridgeReload = load;
})();
