// XRP Ledger wallet connect.
//
// This REPLACES the inherited Stellar block (lx-realconnect), which is dead in this project anyway:
// it wires `.lxw-row` elements built by `lx-mc`, and `lx-mc` was never carried into the XRPL
// containers. So on every XRPL page today the connect button does nothing at all. Worse, if it did
// run it would store a Stellar `G...` address under `lumos.address` -- the same key the XRPL wallet
// layer reads -- and every page would then query the XRP Ledger with an address that cannot exist on
// it. That is why this ships as a replacement rather than an addition.
//
// Two wallets, both verified against their own published source rather than from documentation:
//
//   Xaman (Xumm)  OAuth2 PKCE, browser-only: a PUBLIC api key (uuid), no secret and no backend.
//                 Works on mobile, which the two extensions do not. window.XummPkce, self-hosted.
//   GemWallet     a window.postMessage protocol to the extension's content script. The npm package
//                 is a thin wrapper over it, so the protocol is spoken directly here -- no bundler,
//                 no ESM, nothing to keep in sync but the message names.
//
// Storage contract is deliberately the SAME keys the Stellar build uses, so the layers already
// written against them keep working:
//   lumos.address    the r-address
//   lumos.wallet     display name  ('Xaman' | 'GemWallet')
//   lumos.transport  how to sign later ('xaman' | 'gem')
//   lumos.chain      'xrpl'
//   lumos.network    'mainnet'
(function () {
  if (window.__lxxConnect) return;
  window.__lxxConnect = 1;

  // ---------------------------------------------------------------------------------------------
  // PASTE THE XAMAN API KEY HERE.
  //
  // Get it free at https://apps.xaman.dev -> create an application -> copy the API KEY (a uuid).
  // The SECRET is NOT used here and must never be put in front-end code: this is the PKCE flow,
  // which is designed to run without one. In the Xaman console, set the application's redirect URI
  // to the site origin (https://lumoscore.com/) or sign-in will be refused by their server.
  //
  // Left blank, Xaman shows as "Setup needed" instead of failing silently mid-flow.
  var XAMAN_KEY = 'aa0d5f5f-c80c-4763-8bf6-1cb63cea7fbb';
  // ---------------------------------------------------------------------------------------------

  var XUMM_SRC = '/assets/vendor/xumm-oauth2-pkce-2.8.7.min.js';
  var RPC = 'https://xrplcluster.com/';

  var K = {
    addr: 'lumos.address', wallet: 'lumos.wallet', transport: 'lumos.transport',
    chain: 'lumos.chain', network: 'lumos.network'
  };

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function noop() {}

  // xrpl-core is injected immediately above this file and is the same bytes the node tests run.
  function validAddress(a) {
    try { return window.lxx.isAddress(a); } catch (e) { return false; }
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // ---- state -----------------------------------------------------------------------------------
  var listeners = [];
  function emit() {
    var a = get(K.addr);
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](a); } catch (e) {} }
  }

  function store(addr, walletName, transport) {
    set(K.addr, addr); set(K.wallet, walletName); set(K.transport, transport);
    set(K.chain, 'xrpl'); set(K.network, 'mainnet');
    emit();
  }

  function forget() {
    del(K.addr); del(K.wallet); del(K.transport); del(K.chain); del(K.network);
    emit();
  }

  // The address a wallet hands back is not taken on trust. Not because wallets lie, but because this
  // key is shared with the Stellar build and has held a `G...` address before -- and a bad value here
  // is not a visible error, it is every page quietly reporting an empty account.
  function accept(addr, walletName, transport) {
    if (!validAddress(addr)) {
      throw new Error(walletName + ' returned something that is not an XRP Ledger address.');
    }
    store(addr, walletName, transport);
    return addr;
  }

  // ---- ledger ----------------------------------------------------------------------------------
  // Confirms the account exists. An unfunded account is NOT an error: below the base reserve the
  // ledger simply has no record of it, which is the normal state of a brand-new wallet.
  function ledgerState(a) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'account_info', params: [{ account: a, ledger_index: 'validated' }] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = (j && j.result) || {};
      if (res.error === 'actNotFound') return 'unfunded';
      if (res.error) return 'unknown';
      return 'funded';
    }).catch(function () { return 'unknown'; });
  }

  // ---- GemWallet -------------------------------------------------------------------------------
  // Protocol copied from @gemwallet/api's own source (helpers/extensionMessaging.js, getAddress.js).
  function favicon() {
    try {
      var l = document.querySelector('link[rel*="icon"]');
      return l ? l.href : '';
    } catch (e) { return ''; }
  }

  function gemSend(type, payload, ms) {
    return new Promise(function (resolve, reject) {
      var id = Date.now() + Math.random();
      var timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        reject(new Error('GemWallet did not respond.'));
      }, ms || 90000);

      function onMsg(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.source !== 'GEM_WALLET_MSG_RESPONSE') return;
        // `messagedId`, not `messageId`. That spelling is a typo in GemWallet's own client, which
        // makes it the wire format: correcting it here would mean never resolving, on a path that
        // otherwise looks completely healthy.
        if (d.messagedId !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(d);
      }

      window.addEventListener('message', onMsg, false);
      var msg = { source: 'GEM_WALLET_MSG_REQUEST', messageId: id, app: 'gem-wallet', type: type };
      if (payload) msg.payload = payload;
      window.postMessage(msg, window.location.origin);
    });
  }

  // Submit a transaction through GemWallet. The user approves it in the extension; the extension
  // fills in Fee, Sequence and LastLedgerSequence, signs, and submits.
  //
  // UNTESTED AGAINST THE EXTENSION. There is no GemWallet in the browser this was written in, so
  // the happy path here is written from @gemwallet/api's documented protocol and has never actually
  // round-tripped. It is built to fail LOUDLY rather than silently: anything other than a result
  // carrying a hash throws, so a wrong guess about the response shape stops the launch instead of
  // letting it continue as though a transaction had been submitted.
  function gemSubmit(tx) {
    return gemInstalled().then(function (ok) {
      if (!ok) throw new Error('GemWallet is not installed in this browser.');
      return gemSend('REQUEST_SUBMIT_TRANSACTION/V3', {
        transaction: tx,
        url: window.location.origin, title: document.title, favicon: favicon()
      });
    }).then(function (d) {
      if (d && d.error) {
        var m = (d.error && (d.error.message || d.error.name)) || String(d.error);
        throw new Error(/reject|denied|cancel/i.test(m) ? 'Rejected in GemWallet.' : m);
      }
      var r = (d && d.result) || {};
      if (r.type === 'reject') throw new Error('Rejected in GemWallet.');
      var hash = r.hash || r.txHash || (r.result && r.result.hash);
      if (!hash) throw new Error('GemWallet did not return a transaction hash.');
      return String(hash);
    });
  }

  function gemInstalled() {
    if (window.gemWallet) return Promise.resolve(true);
    // The extension sets window.gemWallet late on some loads, so absence is not proof. Ask, and
    // treat silence within a second as "no" -- the same 1s the official client allows.
    return gemSend('REQUEST_IS_INSTALLED/V3', null, 1000)
      .then(function (d) { return !!(d && (d.isInstalled || (d.result && d.result.isInstalled))); })
      .catch(function () { return false; });
  }

  function gemConnect() {
    return gemInstalled().then(function (ok) {
      if (!ok) throw new Error('GemWallet is not installed in this browser.');
      return gemSend('REQUEST_GET_ADDRESS/V3', {
        url: window.location.origin, title: document.title, favicon: favicon()
      });
    }).then(function (d) {
      if (d && d.error) {
        var m = (d.error && (d.error.message || d.error.name)) || String(d.error);
        throw new Error(/reject|denied|cancel/i.test(m) ? 'Request rejected in GemWallet.' : m);
      }
      var r = (d && d.result) || {};
      if (!r.address) throw new Error('GemWallet did not return an address.');
      return accept(r.address, 'GemWallet', 'gem');
    });
  }

  // ---- Xaman -----------------------------------------------------------------------------------
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Could not load the Xaman library.')); };
      document.head.appendChild(s);
    });
  }

  var xummReady = null;
  function xumm() {
    if (!XAMAN_KEY) {
      return Promise.reject(new Error('Xaman is not set up yet — the site is missing its Xaman API key.'));
    }
    if (xummReady) return xummReady;
    xummReady = (window.XummPkce ? Promise.resolve() : loadScript(XUMM_SRC)).then(function () {
      if (!window.XummPkce) throw new Error('The Xaman library did not load.');
      var x = new window.XummPkce(XAMAN_KEY, { rememberJwt: true });

      // THE MOBILE PATH DEPENDS ON THIS. Signing in on a phone leaves the browser for the Xaman app
      // and comes back as a FRESH PAGE LOAD via redirect -- the promise from authorize() died with
      // the old page. 'retrieved' is how the session is picked back up. The Stellar side shipped
      // without the equivalent WalletConnect resume and the symptom was exactly what you would
      // expect and nobody diagnoses quickly: approving in the app, returning to the site, and
      // being signed out.
      x.on('retrieved', function () { adoptXumm(x); });
      x.on('success', function () { adoptXumm(x); });
      return x;
    });
    return xummReady;
  }

  function adoptXumm(x) {
    try {
      var p = x.state();
      if (!p || !p.then) return;
      p.then(function (state) {
        if (!state || !state.me || !state.me.account) return;
        if (!netOk(state.me)) return;
        try { accept(state.me.account, 'Xaman', 'xaman'); ui.done(get(K.addr)); } catch (e) {}
      }).catch(noop);
    } catch (e) {}
  }

  // Real funds. A session opened against Testnet or Devnet must not be presented as an account here.
  // networkType is absent on older sessions, and absence is not treated as wrong -- only an explicit
  // non-mainnet value is.
  function netOk(me) {
    var t = me && me.networkType;
    return !t || /main/i.test(String(t));
  }

  function xamanConnect() {
    return xumm().then(function (x) {
      var p = x.authorize();
      return p && p.then ? p : Promise.reject(new Error('Xaman sign-in could not start.'));
    }).then(function (state) {
      if (!state || !state.me || !state.me.account) throw new Error('Sign-in was cancelled.');
      if (!netOk(state.me)) {
        throw new Error('That Xaman account is on ' + state.me.networkType + '. LumosCore is on Mainnet.');
      }
      return accept(state.me.account, 'Xaman', 'xaman');
    });
  }

  // ---- registry --------------------------------------------------------------------------------
  // The logo files already ship in this build -- assets/wallets/{gem,xaman}.png -- so the picker and
  // the header chip use the real marks rather than a letter in a coloured square. The Stellar site
  // shows the connected wallet's own logo in the header, and this did not.
  var WALLETS = [
    {
      id: 'xaman', name: 'Xaman', sub: 'Mobile and desktop',
      ico: '#2d2d2d', glyph: 'X', logo: '/assets/wallets/xaman.png',
      connect: xamanConnect,
      status: function () { return Promise.resolve(XAMAN_KEY ? '' : 'Setup needed'); }
    },
    {
      id: 'gem', name: 'GemWallet', sub: 'Browser extension',
      ico: 'linear-gradient(135deg,#3f9c5a 0%,#1f6b3a 100%)', glyph: 'G',
      logo: '/assets/wallets/gem.png',
      connect: gemConnect,
      status: function () {
        return gemInstalled().then(function (ok) { return ok ? 'Installed' : ''; });
      }
    }
  ];

  // `lumos.wallet` stores the display name, which is what lx-whead reads too.
  function walletLogo() {
    var name = String(get(K.wallet) || '').toLowerCase();
    for (var i = 0; i < WALLETS.length; i++) {
      var w = WALLETS[i];
      if (name === w.name.toLowerCase() || name === w.id) return w.logo;
    }
    return null;
  }

  // Paint the header chip's avatar with the connected wallet's logo.
  //
  // The chip is built by `lx-whead`, which this project does not own, and it ships the XRP mark --
  // the NETWORK's logo, on every wallet. Re-applied on a short poll rather than once, because
  // lx-whead rebuilds the chip from a stored copy of its own original markup whenever the
  // connection state changes, which would put the XRP mark straight back.
  function paintWalletChip() {
    var src = walletLogo();
    if (!src) return;
    var av = document.querySelector('.lx-topwallet .lx-tw-av');
    if (!av) return;
    var img = av.querySelector('img');
    if (img && img.getAttribute('src') === src) return;      // already ours: leave it alone
    av.innerHTML = '';
    var el = document.createElement('img');
    el.src = src;
    el.alt = '';
    el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    av.appendChild(el);
  }

  function watchWalletChip() {
    paintWalletChip();
    // Cheap and bounded: the comparison above makes every pass after the first a no-op.
    setInterval(paintWalletChip, 1000);
  }

  // ---- UI --------------------------------------------------------------------------------------
  // Self-contained: the design's own connect modal is built by `lx-mc`, which this project does not
  // have. Styles are scoped under .lxx-* and take their colours from the site's variables, with
  // fallbacks so the modal is never invisible if a page is missing a token.
  var CSS = ''
    + '.lxx-bd{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);'
    + 'display:flex;align-items:center;justify-content:center;padding:18px}'
    + '.lxx-bd[hidden]{display:none}'
    + '.lxx-m{width:100%;max-width:392px;background:var(--card,var(--bg,#131317));color:var(--text,#f6f5f3);'
    + 'border:1px solid var(--line,rgba(255,255,255,.10));border-radius:18px;overflow:hidden;'
    + 'box-shadow:0 24px 70px rgba(0,0,0,.5);font-family:inherit}'
    + '.lxx-h{display:flex;align-items:center;justify-content:space-between;padding:18px 18px 12px}'
    + '.lxx-h h3{margin:0;font-size:18px;font-weight:800;letter-spacing:-.3px}'
    + '.lxx-h p{margin:3px 0 0;font-size:13.5px;color:var(--text-muted,#9b9ba4);font-weight:500}'
    + '.lxx-x{background:none;border:0;color:var(--text-muted,#9b9ba4);cursor:pointer;padding:6px;'
    + 'border-radius:8px;line-height:0}'
    + '.lxx-x:hover{color:var(--text,#f6f5f3);background:rgba(255,255,255,.06)}'
    + '.lxx-list{padding:6px 12px 16px;display:flex;flex-direction:column;gap:6px}'
    + '.lxx-row{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:13px;'
    + 'background:none;border:1px solid transparent;color:inherit;cursor:pointer;text-align:left;font-family:inherit}'
    + '.lxx-row:hover{background:rgba(255,255,255,.055);border-color:var(--line,rgba(255,255,255,.10))}'
    + '.lxx-ico{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;'
    + 'justify-content:center;font-weight:800;font-size:15px;color:#fff;flex:0 0 36px}'
    + '.lxx-nm{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}'
    + '.lxx-nm b{font-size:14.5px;font-weight:700}'
    + '.lxx-nm span{font-size:12.5px;color:var(--text-muted,#9b9ba4);font-weight:500}'
    + '.lxx-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;'
    + 'background:rgba(255,255,255,.08);color:var(--text-muted,#9b9ba4);white-space:nowrap}'
    + '.lxx-state{padding:26px 22px 24px;text-align:center;display:flex;flex-direction:column;'
    + 'align-items:center;gap:12px}'
    + '.lxx-state h4{margin:0;font-size:16.5px;font-weight:800}'
    + '.lxx-state p{margin:0;font-size:14px;line-height:1.55;color:var(--text-muted,#9b9ba4);'
    + 'font-weight:500;max-width:300px;word-break:break-word}'
    + '.lxx-spin{width:30px;height:30px;border-radius:50%;border:3px solid rgba(255,255,255,.14);'
    + 'border-top-color:var(--accent,#ff894c);animation:lxxSpin 1s linear infinite}'
    + '@keyframes lxxSpin{to{transform:rotate(360deg)}}'
    + '@media(prefers-reduced-motion:reduce){.lxx-spin{animation-duration:3s}}'
    + '.lxx-addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;'
    + 'background:rgba(255,255,255,.06);padding:9px 13px;border-radius:10px;word-break:break-all}'
    + '.lxx-btn{margin-top:4px;padding:11px 20px;border-radius:11px;border:0;cursor:pointer;'
    + 'font-family:inherit;font-size:14.5px;font-weight:700;background:var(--accent,#ff894c);color:#12100e}'
    + '.lxx-btn.ghost{background:none;border:1px solid var(--line,rgba(255,255,255,.14));'
    + 'color:var(--text-muted,#9b9ba4)}'
    + '.lxx-err{color:#e5484d}';

  var ui = (function () {
    var bd = null, body = null, built = false;

    function build() {
      if (built) return;
      built = true;
      var st = document.createElement('style');
      st.id = 'lxx-connect-css';
      st.textContent = CSS;
      document.head.appendChild(st);

      bd = document.createElement('div');
      bd.className = 'lxx-bd';
      bd.hidden = true;
      bd.setAttribute('role', 'dialog');
      bd.setAttribute('aria-modal', 'true');
      body = document.createElement('div');
      body.className = 'lxx-m';
      bd.appendChild(body);
      bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && bd && !bd.hidden) close();
      });
      document.body.appendChild(bd);
    }

    function head(title, sub) {
      var h = document.createElement('div');
      h.className = 'lxx-h';
      var t = document.createElement('div');
      var h3 = document.createElement('h3'); h3.textContent = title; t.appendChild(h3);
      if (sub) { var p = document.createElement('p'); p.textContent = sub; t.appendChild(p); }
      h.appendChild(t);
      var x = document.createElement('button');
      x.className = 'lxx-x'; x.type = 'button'; x.setAttribute('aria-label', 'Close');
      x.textContent = '✕';
      x.addEventListener('click', close);
      h.appendChild(x);
      return h;
    }

    function open() { build(); bd.hidden = false; }
    function close() { if (bd) bd.hidden = true; }

    function pick() {
      build();
      body.innerHTML = '';
      body.appendChild(head('Connect Wallet', 'Choose a wallet to continue'));
      var list = document.createElement('div');
      list.className = 'lxx-list';

      WALLETS.forEach(function (w) {
        var b = document.createElement('button');
        b.className = 'lxx-row'; b.type = 'button';
        var ic = document.createElement('span');
        ic.className = 'lxx-ico';
        if (w.logo) {
          // The real mark, since the files ship with the build. The coloured letter stays as the
          // fallback for a logo that fails to load, and an <img> also keeps the logo healer off the
          // element -- it repaints anything holding one to five characters, which "G" and "X" are.
          ic.style.background = w.ico;
          var wi = document.createElement('img');
          wi.src = w.logo; wi.alt = '';
          wi.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
          wi.onerror = function () { ic.textContent = w.glyph; };
          ic.appendChild(wi);
        } else {
          ic.style.background = w.ico; ic.textContent = w.glyph;
        }
        var nm = document.createElement('span');
        nm.className = 'lxx-nm';
        var nb = document.createElement('b'); nb.textContent = w.name;
        var ns = document.createElement('span'); ns.textContent = w.sub;
        nm.appendChild(nb); nm.appendChild(ns);
        b.appendChild(ic); b.appendChild(nm);

        var badge = document.createElement('span');
        badge.className = 'lxx-badge';
        badge.hidden = true;
        b.appendChild(badge);
        // Detection is async and must never hold up the list being usable.
        w.status().then(function (s) {
          if (!s) return;
          badge.textContent = s;
          badge.hidden = false;
        }).catch(noop);

        b.addEventListener('click', function () { run(w); });
        list.appendChild(b);
      });

      body.appendChild(list);
      open();
    }

    function waiting(w) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Connecting…', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var sp = document.createElement('div'); sp.className = 'lxx-spin';
      var h4 = document.createElement('h4'); h4.textContent = 'Waiting for ' + w.name;
      var p = document.createElement('p');
      p.textContent = w.id === 'xaman'
        ? 'Approve the sign-in request in Xaman. On a phone this opens the app — come back here when it is done.'
        : 'Approve the connection request in ' + w.name + ' to continue.';
      var c = document.createElement('button');
      c.className = 'lxx-btn ghost'; c.type = 'button'; c.textContent = 'Cancel';
      c.addEventListener('click', pick);
      s.appendChild(sp); s.appendChild(h4); s.appendChild(p); s.appendChild(c);
      body.appendChild(s);
      open();
    }

    function fail(w, msg) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Could not connect', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var h4 = document.createElement('h4'); h4.className = 'lxx-err'; h4.textContent = w.name;
      var p = document.createElement('p'); p.textContent = msg;
      var again = document.createElement('button');
      again.className = 'lxx-btn'; again.type = 'button'; again.textContent = 'Try another wallet';
      again.addEventListener('click', pick);
      s.appendChild(h4); s.appendChild(p); s.appendChild(again);
      body.appendChild(s);
      open();
    }

    function done(addr, note) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Connected', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var h4 = document.createElement('h4'); h4.textContent = "You're connected";
      var a = document.createElement('div'); a.className = 'lxx-addr'; a.textContent = addr;
      s.appendChild(h4); s.appendChild(a);
      if (note) { var p = document.createElement('p'); p.textContent = note; s.appendChild(p); }
      var b = document.createElement('button');
      b.className = 'lxx-btn'; b.type = 'button'; b.textContent = 'Continue';
      b.addEventListener('click', function () { close(); window.location.reload(); });
      s.appendChild(b);
      body.appendChild(s);
      open();
    }

    return { pick: pick, waiting: waiting, fail: fail, done: done, close: close, open: open };
  })();

  function run(w) {
    ui.waiting(w);
    w.connect().then(function (addr) {
      return ledgerState(addr).then(function (st) {
        ui.done(addr, st === 'unfunded'
          ? 'This account is not activated on the XRP Ledger yet — it needs a small XRP reserve before it can hold anything.'
          : '');
      });
    }).catch(function (e) {
      ui.fail(w, (e && e.message) || 'Something went wrong.');
    });
  }

  // ---- page wiring -----------------------------------------------------------------------------
  // Delegated and capture-phase, so it works on buttons rendered after load and beats any inherited
  // handler still bound to the old flow.
  function isConnectTrigger(el) {
    var n = el.closest('[data-lxx-connect],[data-connect],.lc-guest-cta,.lxw-open,#connectBtn');
    if (n) return n;
    var b = el.closest('button,a');
    if (!b) return null;
    var t = (b.textContent || '').trim().toLowerCase();
    if (t === 'connect wallet' || t === 'connect' || t === 'connect a wallet') return b;
    return null;
  }

  function openPicker() {
    if (get(K.addr)) ui.done(get(K.addr), '');
    else ui.pick();
  }

  // ON `window`, NOT `document`, and that is the whole point.
  //
  // The design ships its own 24KB connect modal, and under its `xrpl` entry it lists PETRA, MARTIAN
  // and PONTEM -- Aptos wallets, inherited from the multi-chain template this design came from.
  // Choosing one does not connect anything: it writes `lumos.wallet`, shows a hardcoded
  // `0x9c7d...a802` and switches to a "connected" screen. A user is then looking at a connected
  // header for a wallet they never authorised, with no way to reach GemWallet at all.
  //
  // Its handler is bound on `document` in the capture phase, and it is earlier in the page than this
  // file, so it registers first and wins. Capture runs window -> document, so listening on `window`
  // is what puts this ahead of it -- registration order only decides ties on the SAME target.
  window.addEventListener('click', function (e) {
    var t = isConnectTrigger(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  }, true);

  // The backstop for every other way in. A header network-chooser also calls this directly, so
  // intercepting clicks alone would still leave routes that open the Aptos list. Overriding it
  // costs nothing and cannot orphan anything: the markup and the script stay where they are, and
  // the function keeps its name and arity.
  try { window.lxwOpenWallet = function () { openPicker(); }; } catch (e) {}

  // A Xaman sign-in on a phone returns here as a brand-new page load. If a session is remembered,
  // the SDK has to be constructed for 'retrieved' to fire at all -- nothing resumes on its own.
  function resume() {
    if (!XAMAN_KEY) return;
    var remembered = false;
    try { remembered = !!localStorage.getItem('XummPkceJwt'); } catch (e) {}
    var returning = /xumm|xApp|access_token|authorization_code/i.test(window.location.href);
    if (!remembered && !returning) return;
    xumm().catch(noop);
  }

  window.lxc = {
    open: function () { get(K.addr) ? ui.done(get(K.addr), '') : ui.pick(); },
    address: function () { return get(K.addr); },
    wallet: function () { return get(K.wallet); },
    transport: function () { return get(K.transport); },
    disconnect: function () {
      var t = get(K.transport);
      forget();
      if (t === 'xaman' && xummReady) xummReady.then(function (x) { try { x.logout(); } catch (e) {} }).catch(noop);
      try { localStorage.removeItem('XummPkceJwt'); } catch (e) {}
    },
    // Ask the connected wallet to sign and submit one transaction, resolving with its hash.
    //
    // REFUSES RATHER THAN GUESSES. A stored address with an EMPTY transport is a real state -- it is
    // what this build currently leaves behind -- and it means the page knows who you are but has no
    // way to sign for you. Treating that as "probably GemWallet" would open an extension prompt that
    // may never come, or worse, succeed against the wrong wallet.
    submit: function (tx) {
      var t = get(K.transport);
      if (!get(K.addr)) return Promise.reject(new Error('Connect a wallet first.'));
      if (t === 'gem') return gemSubmit(tx);
      if (t === 'xaman') {
        return Promise.reject(new Error(
          'Signing with Xaman is not built yet — reconnect with GemWallet on desktop.'));
      }
      return Promise.reject(new Error(
        'This wallet connection cannot sign. Disconnect and connect again.'));
    },
    canSign: function () { return get(K.transport) === 'gem'; },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    wallets: WALLETS.map(function (w) { return w.name; }),
    configured: function () { return { xaman: !!XAMAN_KEY }; }
  };

  function boot() { resume(); watchWalletChip(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
