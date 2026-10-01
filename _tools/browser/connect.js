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
    chain: 'lumos.chain', network: 'lumos.network',
    // Which wallet was last connected. Same key the Stellar build uses, and deliberately NOT cleared
    // by forget(): which wallet you last used is the thing worth remembering once you sign out.
    lastWallet: 'lumos.lastWallet'
  };

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function noop() {}

  // THE FADE-IN GATE THAT NEVER OPENED (RAZA 2026-09-16: "[Still not showing - WTF, this has been going on since yesterday]" —
  // My Pools; and "Sometimes Pools-pool page is taking forever to load"). The design fades sections in with
  //     html.lcm-ready <section>:not([data-lcm-done]) { opacity:0 }   and   [data-lcmu]:not(.lcmu-in) { opacity:0 }
  // released by a scroll observer. A section that was display:none when that observer looked (a tab panel), or one it
  // simply missed, stayed at opacity 0 with its content correctly loaded inside — My Pools held the position the whole time.
  // Every check read visibility, which was "visible". Any gated section still transparent a moment after load, or after a
  // click, is released here.
  (function () {
    function release() {
      try {
        var sels = [];
        [].forEach.call(document.querySelectorAll('style'), function (st) {
          String(st.textContent || '').replace(/html\.lcm-ready\s+([^{},]+?):not\(\[data-lcm-done\]\)/g, function (m, s) {
            if (sels.indexOf(s.trim()) < 0) sels.push(s.trim());
            return m;
          });
        });
        sels.forEach(function (s) {
          [].forEach.call(document.querySelectorAll(s), function (n) {
            if (n.getBoundingClientRect().height > 0 && getComputedStyle(n).opacity === '0') {
              n.setAttribute('data-lcm-done', '1');
              n.classList.add('lcm-on');
            }
          });
        });
        [].forEach.call(document.querySelectorAll('[data-lcmu]:not(.lcmu-in)'), function (n) {
          if (n.getBoundingClientRect().height > 0 && getComputedStyle(n).opacity === '0') n.classList.add('lcmu-in');
        });
      } catch (e) {}
    }
    function later(ms) { setTimeout(release, ms); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { later(1500); later(4000); });
    else { later(1500); later(4000); }
    window.addEventListener('click', function () { later(700); later(1800); }, true);
  })();

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
    // Recorded as the wallet ID, not the display name, because that is what the picker compares
    // against — taking both from the same place is what stops them drifting apart.
    try {
      for (var i = 0; i < WALLETS.length; i++) {
        if (WALLETS[i].name === walletName || WALLETS[i].id === walletName) {
          set(K.lastWallet, WALLETS[i].id); break;
        }
      }
    } catch (e) {}
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
      // A REFUSAL IS ANNOUNCED AT WHICHEVER LEVEL THE EXTENSION PUTS IT (RAZA 2026-09-17: "if i initiate the send but i
      // cancel the wallet confirmation. on Stellar it shows an error, on XRP it doesnt"). @gemwallet/api answers a
      // declined request with `type: 'reject'` on the RESPONSE, not inside `result`, so a check of `result.type` alone
      // fell through to the missing-hash error — and worse, said nothing at all when the popup was dismissed without
      // answering. All three nestings are read here.
      var r = (d && d.result) || {};
      if (d && d.type === 'reject') throw new Error('Rejected in GemWallet.');
      if (r.type === 'reject' || (r.result && r.result.type === 'reject')) throw new Error('Rejected in GemWallet.');
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
      if (d && d.type === 'reject') throw new Error('Request rejected in GemWallet.');
      if (r.type === 'reject') throw new Error('Request rejected in GemWallet.');
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
      // One fixed return address, the site's root, whichever page sign-in starts from — the address that must be listed in the Xaman app.
      var x = new window.XummPkce(XAMAN_KEY, { rememberJwt: true, redirectUrl: window.location.origin + '/' });

      // THE MOBILE PATH DEPENDS ON THIS. Signing in on a phone leaves the browser for the Xaman app
      // and comes back as a FRESH PAGE LOAD via redirect -- the promise from authorize() died with
      // the old page. 'retrieved' is how the session is picked back up. The Stellar side shipped
      // without the equivalent WalletConnect resume and the symptom was exactly what you would
      // expect and nobody diagnoses quickly: approving in the app, returning to the site, and
      // being signed out.
      x.on('retrieved', function () { adoptXumm(x); });
      x.on('success', function () { adoptXumm(x); });

      // A REFUSAL FROM XAMAN'S GATEWAY NEVER REACHED authorize(). The popup renders their error page
      // and simply never posts a result back, so the promise stays pending and the dialog behind it
      // spins on "Waiting for Xaman" with nothing but a Cancel button -- which is what RAZA hit on
      // 2026-10-01: "Error: access_denied / Invalid client/redirect URL" in the popup, and a spinner
      // underneath it that would have spun all day. The SDK does emit 'error'; nothing was listening.
      x.on('error', function (e) { failXaman(e); });
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

  // Set while an authorize() is in flight, so the SDK's 'error' event can settle it.
  var xamanPending = null;
  function failXaman(e) {
    var r = xamanPending; xamanPending = null;
    if (r) r(xamanAuthError(e));
  }

  // Xaman's gateway refuses BEFORE the user is ever shown a prompt when the address this page was
  // served from is not on the application's redirect list. The trap is that every Cloudflare Pages
  // deployment has its OWN origin -- a preview hash fails while the alias works, with no hint which
  // of the two is wrong -- so the address is named here rather than left for someone to guess.
  function xamanAuthError(e) {
    var m = String((e && (e.message || e.error || e.reason)) || e || '');
    // The window went away without an answer. Almost always the gateway refusal below, because that
    // page is a dead end the user has to close by hand -- but it is also what cancelling looks like,
    // so the wording has to carry both without asserting either.
    if (/popup-closed/.test(m)) {
      return new Error('The Xaman sign-in window closed before it finished. If it showed "Invalid '
        + 'client/redirect URL", then ' + window.location.origin + ' is not a registered redirect '
        + 'address for this Xaman app — add it at apps.xaman.dev and try again.');
    }
    if (/invalid client|redirect|access_denied/i.test(m)) {
      return new Error('Xaman would not accept a sign-in from ' + window.location.origin
        + ' — that address is not registered for this Xaman app. If this is your site, add it as a '
        + 'redirect URL at apps.xaman.dev; otherwise open LumosCore from its main address.');
    }
    return new Error(m || 'Xaman sign-in failed.');
  }

  function xamanConnect() {
    return xumm().then(function (x) {
      // Race the SDK's own 'error' against authorize(), because a refused sign-in only ever arrives
      // on the event -- authorize() itself stays pending forever.
      var refused = new Promise(function (_res, rej) { xamanPending = rej; });
      var p = x.authorize();
      if (!p || !p.then) { xamanPending = null; return Promise.reject(new Error('Xaman sign-in could not start.')); }

      // WATCH THE WINDOW, because the SDK's events do not cover this. It settles only when the popup
      // POSTS a message back -- 'xumm_sign_request_rejected' or 'xumm_sign_request_popup_closed' --
      // and Xaman's own gateway error page ("Invalid client/redirect URL") posts nothing at all. It
      // just renders. So authorize() stays pending, 'error' never fires, and even closing the window
      // by hand leaves this dialog spinning; RAZA hit that twice on 2026-10-01. The SDK does keep the
      // handle on x.popup, so the window going away is a signal we can read ourselves.
      // Null on mobile, where the flow is a full-page redirect rather than a popup — the timer simply
      // never fires there, which is correct.
      var watch = setInterval(function () {
        var w = x && x.popup;
        if (w && w.closed) { clearInterval(watch); failXaman(new Error('popup-closed')); }
      }, 800);

      // Clear the rejector however this settles. Left dangling, a later unrelated 'error' event would
      // fire it at a sign-in that already finished.
      return Promise.race([p, refused]).then(
        function (v) { clearInterval(watch); xamanPending = null; return v; },
        function (e) { clearInterval(watch); xamanPending = null; throw e; });
    }).then(function (state) {
      xamanPending = null;
      if (!state || !state.me || !state.me.account) throw new Error('Sign-in was cancelled.');
      if (!netOk(state.me)) {
        throw new Error('That Xaman account is on ' + state.me.networkType + '. LumosCore is on Mainnet.');
      }
      return accept(state.me.account, 'Xaman', 'xaman');
    });
  }

  // ---- Xaman SIGNING ---------------------------------------------------------------------------
  // Until this existed, connecting on a PHONE bought a read-only site. Both other transports are
  // desktop browser extensions, so `lxc.submit` refused every Xaman session by name and no send, swap,
  // trade, liquidity move or token launch could be signed from a phone at all.
  //
  // NO API SECRET IS INVOLVED, and none may be. xamanConnect already opens an OAuth2 PKCE session, and
  // what x.state() hands back is an authorised XummSdkJwt bound to that session's 24h JWT -- it is in
  // the vendored bundle already (XummSdkJwt and createAndSubscribe are both present in
  // xumm-oauth2-pkce-2.8.7.min.js). Xaman's own documentation: "Never use an API Secret obtained from
  // the Developer Dashboard in a frontend environment!" The api key above is a public app identifier
  // and nothing more, which is why it can sit in this file.
  function xamanSdk() {
    return xumm().then(function (x) {
      return x.state().then(function (st) {
        if (st && st.sdk) return st.sdk;
        // The 24h JWT has expired, or this tab never had one. Re-authorising re-opens Xaman, which is
        // the honest move: firing a sign request at a dead token fails with nothing on screen to say
        // why, and the user is left watching a button that never resolves.
        return x.authorize().then(function (s) {
          if (!s || !s.sdk) throw new Error('Sign in with Xaman again to approve this.');
          return s.sdk;
        });
      });
    });
  }

  // Resolves with the transaction HASH, the same contract gemSubmit satisfies, so every caller in
  // write.js / pooldetail.js / mint.js works unchanged.
  function xamanSubmit(tx) {
    return xamanSdk().then(function (sdk) {
      return sdk.payload.createAndSubscribe({
        txjson: tx,
        // submit:true lets Xaman relay it to the ledger, which is what the extensions do too, so the
        // hash coming back means submitted and not merely signed. Five minutes is long enough to pick
        // the phone up and short enough that an abandoned request does not linger as a live signable.
        options: { submit: true, expire: 5 }
      }, function (ev) {
        // The socket narrates the payload's whole life -- opened, expired, signed. Returning undefined
        // keeps the subscription open; returning a value is what resolves it, so only a verdict does.
        if (ev && ev.data && typeof ev.data.signed !== 'undefined') return ev.data;
      }).then(function (sub) {
        var created = sub && sub.created;
        // create() answers with the uuid at the top level; a FETCHED payload nests it under meta, and
        // the websocket url inside the SDK is built from the latter. Taking either means a shape change
        // cannot quietly turn the recovery poll into a no-op.
        var uuid = created && (created.uuid || (created.meta && created.meta.uuid));
        var link = created && created.next && created.next.always;
        var png = created && created.refs && created.refs.qr_png;
        var abort = null;
        var close = ui.signing(link, isHandheld() ? '' : png, function () {
          if (abort) abort(new Error('Cancelled.'));
        });

        // BEST EFFORT, not the mechanism. On a phone this usually walks straight into Xaman; on iOS the
        // activation that started the transaction is already spent by the time the payload exists, so
        // the hand-off can be dropped silently. That is survivable here in a way it was not for LOBSTR:
        // the user is signed in, so Xaman PUSHES the request to their device regardless, and the dialog
        // behind this carries an Open button that is a fresh tap.
        if (isHandheld() && link) { try { window.location.href = link; } catch (e) {} }

        var v = xamanVerdict(sdk, sub, uuid);
        abort = v.abort;
        return v.promise.then(function (d) {
          close();
          if (!d || !d.signed) throw new Error('Rejected in Xaman.');
          return d.txid ? String(d.txid) : xamanHash(sdk, uuid);
        }, function (e) { close(); throw e; });
      });
    });
  }

  // TWO WAYS TO LEARN THE ANSWER, because on a phone the first one dies.
  //
  // Signing leaves the browser. The OS suspends this tab and the subscription socket goes with it, so
  // the user approves in Xaman, comes back, and the socket that was meant to report it is gone --
  // leaving a transaction that really was signed and submitted, and a page waiting for it forever.
  // That is the Stellar WalletConnect "mobile resume" bug in a different coat, and it was in the first
  // cut of this signing path.
  //
  // So the socket is the FAST path, not the only one. The payload is ALSO polled: immediately on every
  // return to this page, and slowly in the background as a backstop. Whichever learns the verdict
  // first wins, and a failed poll is not an answer -- only meta.resolved is.
  function xamanVerdict(sdk, sub, uuid) {
    var done = false, timer = null, offs = [];
    var resolveIt, rejectIt;
    var promise = new Promise(function (res, rej) { resolveIt = res; rejectIt = rej; });

    function stop() {
      done = true;
      if (timer) clearInterval(timer);
      offs.forEach(function (f) { try { f(); } catch (e) {} });
      offs = [];
    }
    function win(v) { if (!done) { stop(); resolveIt(v); } }
    function lose(e) { if (!done) { stop(); rejectIt(e); } }

    function poll() {
      if (done || !uuid) return;
      sdk.payload.get(uuid).then(function (p) {
        var m = p && p.meta;
        if (!m || !m.resolved) return;                       // the user has not answered yet
        if (m.expired && !m.signed) return lose(new Error('The request expired before it was approved in Xaman.'));
        win({ signed: !!m.signed, txid: p.response && p.response.txid });
      }, function () {});                                     // a failed poll is not a verdict
    }

    timer = setInterval(poll, 4000);
    ['visibilitychange', 'pageshow', 'focus'].forEach(function (name) {
      var target = name === 'visibilitychange' ? document : window;
      var fn = function () {
        if (name === 'visibilitychange' && document.visibilityState !== 'visible') return;
        poll();
      };
      target.addEventListener(name, fn);
      offs.push(function () { target.removeEventListener(name, fn); });
    });

    sub.resolved.then(function (d) {
      if (d && typeof d.signed !== 'undefined') win({ signed: !!d.signed, txid: d.txid });
    }, function () { /* the socket gave up; the poll is still running */ });

    return { promise: promise, abort: lose };
  }

  // The socket's verdict does not always carry the hash; the payload always does.
  function xamanHash(sdk, uuid) {
    if (!uuid) throw new Error('Xaman signed the request but did not return a transaction hash.');
    return sdk.payload.get(uuid).then(function (p) {
      var h = p && p.response && p.response.txid;
      if (!h) throw new Error('Xaman signed the request but did not return a transaction hash.');
      return String(h);
    });
  }

  function isHandheld() {
    try { if (window.matchMedia('(pointer:coarse)').matches) return true; } catch (e) {}
    try { if ((navigator.maxTouchPoints || 0) > 0) return true; } catch (e) {}
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }

  // ---- Crossmark -------------------------------------------------------------------------------
  // RAZA 2026-09-16: "On landing page → XRPL → Wallet connection popup, also add: Cross mark, Joey, Wallet connect".
  //
  // Crossmark is an extension that injects `window.crossmark`, with everything under `.async` returning a promise that
  // resolves once the user has answered the popup. Its logo already ships at assets/wallets/crossmark.webp.
  //
  // UNTESTED AGAINST THE EXTENSION, exactly as GemWallet's path was when it was written: there is no Crossmark in the
  // browser this was built in. Both response shapes the SDK has used are read, and anything else is reported as a refusal
  // rather than treated as a success — a wallet layer must never claim a signature it cannot show a hash for.
  function crossApi() { return (typeof window !== 'undefined' && window.crossmark) || null; }
  function crossInstalled() { return !!crossApi(); }
  function crossCall(name, arg) {
    var api = crossApi();
    if (!api) return Promise.reject(new Error('Crossmark is not installed in this browser.'));
    var fn = (api.async && api.async[name]) || api[name];
    if (typeof fn !== 'function') return Promise.reject(new Error('This version of Crossmark cannot ' + name + '.'));
    try { return Promise.resolve(fn.call(api.async || api, arg)); } catch (e) { return Promise.reject(e); }
  }
  // The SDK wraps its answer as { response: { data: … } }; older builds answered with the data itself.
  function crossData(r) { return (r && r.response && r.response.data) || (r && r.data) || r || {}; }
  function crossConnect() {
    return crossCall('signInAndWait').then(function (r) {
      var d = crossData(r);
      var a = d.address || (d.account && d.account.address) || d.classicAddress || '';
      if (!a) throw new Error('Crossmark did not return an address.');
      return accept(a, 'Crossmark', 'cross');
    }, function (e) {
      var m = (e && e.message) || '';
      throw new Error(/reject|denied|cancel/i.test(m) ? 'Request rejected in Crossmark.' : (m || 'Crossmark did not respond.'));
    });
  }
  function crossSubmit(tx) {
    return crossCall('signAndSubmitAndWait', tx).then(function (r) {
      var d = crossData(r);
      var res = (d.resp && d.resp.result) || d.result || d;
      var hash = res.hash || d.hash || '';
      if (!hash) throw new Error('Crossmark did not return a transaction hash.');
      return hash;
    }, function (e) {
      var m = (e && e.message) || '';
      throw new Error(/reject|denied|cancel/i.test(m) ? 'Rejected in Crossmark.' : (m || 'Crossmark could not sign this transaction.'));
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
    },
    {
      id: 'cross', name: 'Crossmark', sub: 'Browser extension',
      ico: 'linear-gradient(135deg,#6b57ff 0%,#3a2bb5 100%)', glyph: 'C',
      logo: '/assets/wallets/crossmark.webp',
      connect: crossConnect,
      status: function () { return Promise.resolve(crossInstalled() ? 'Installed' : ''); }
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

        // ONE TAG PER ROW, AND "Last used" WINS. The Stellar build settled this in _lastusedbadge:
        // a row that is both installed and last-used showed "Installed", so the recency tag never
        // appeared for the wallet you actually use. The row has space for one tag, and "Last used"
        // is the more useful of the two — it already implies the wallet is installed.
        var wasLast = false;
        try { wasLast = !!get(K.lastWallet) && get(K.lastWallet) === w.id; } catch (e) {}
        if (wasLast) {
          badge.textContent = 'Last used';
          badge.hidden = false;
        } else {
          // Detection is async and must never hold up the list being usable.
          w.status().then(function (s) {
            if (!s) return;
            badge.textContent = s;
            badge.hidden = false;
          }).catch(noop);
        }

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

    // The sign request, waiting on the user's phone.
    //
    // Xaman is a PHONE app with no browser extension, so a desktop signer has to be handed the request
    // to scan -- there is nothing on their machine to prompt them. The QR is the PNG Xaman hosts on the
    // created payload, deliberately not drawn locally: window.qrcode is the design's own generator and
    // is NOT loaded on Trade or Pools, where signing also happens, so a locally drawn QR would be blank
    // on exactly the pages that need it most.
    //
    // Returns its own closer so the caller can take the dialog down the moment the socket reports a
    // verdict, whichever way it went.
    function signing(link, png, onCancel) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Approve in Xaman', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';

      if (png) {
        var img = document.createElement('img');
        img.src = png;
        img.alt = 'Scan this with Xaman';
        // White plate behind it: a QR rendered onto this dark modal with no backing is unreadable to
        // every scanner, the same trap makeQR() carries a comment about in write.js.
        img.style.cssText = 'width:212px;height:212px;border-radius:14px;background:#fff;padding:8px;box-sizing:border-box';
        s.appendChild(img);
      } else {
        var sp2 = document.createElement('div'); sp2.className = 'lxx-spin';
        s.appendChild(sp2);
      }

      var h4b = document.createElement('h4');
      h4b.textContent = 'Waiting for your approval';
      var p2 = document.createElement('p');
      p2.textContent = png
        ? 'Scan this with the Xaman app to review and sign. Xaman has also pushed it to your device.'
        : 'Approve the request in Xaman, then come back here.';
      s.appendChild(h4b); s.appendChild(p2);

      if (link) {
        var go = document.createElement('button');
        go.className = 'lxx-btn'; go.type = 'button'; go.textContent = 'Open in Xaman';
        // A FRESH TAP, and that is the whole point of this button. The payload must be created before
        // there is anything to open, which is a network round trip, so the tap that started the
        // transaction is already spent -- and iOS hands a link to an app only while the activation that
        // caused it is still live. The automatic hand-off below is therefore best-effort; this is not.
        go.addEventListener('click', function () { try { window.location.href = link; } catch (e) {} });
        s.appendChild(go);
      }

      var c2 = document.createElement('button');
      c2.className = 'lxx-btn ghost'; c2.type = 'button'; c2.textContent = 'Cancel';
      c2.addEventListener('click', function () { close(); if (onCancel) onCancel(); });
      s.appendChild(c2);

      body.appendChild(s);
      open();
      return close;
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

    // THE DESIGN ALREADY HAS THIS SCREEN — drive it, do not draw another one.
    //
    // This used to hand-build a plain panel: the word "Connected", the FULL raw address, a Continue
    // button. The design ships `.lxw-screen[data-screen="connected"]` with the pulsing green check
    // (.lxw-cpulse), a wallet icon, a TRUNCATED address, a "network · wallet" meta line and a copy
    // button — and Stellar's _wallet_realconnect drives exactly that: fill .lxw-acct-ico /
    // .lxw-acct-addr / .lxw-chipname / .lxw-wnamedone, then flip .lxw-screen to "connected".
    // Same thing here, so XRPL looks identical to Stellar without a second implementation existing.
    //
    // The home target is passed to lxwOpenWallet so the design's own Continue button navigates
    // through its goHome(); we do not wire that button ourselves either.
    function designConnected(addr) {
      // The DESIGN's opener, captured before we replaced window.lxwOpenWallet with our own picker.
      var mount = window.__lxwDesignOpen;
      if (typeof mount !== 'function') return false;
      try { mount('xrpl', '/dashboard'); } catch (e) { return false; }
      var scr = document.querySelectorAll('.lxw-screen');
      if (!scr.length) return false;

      var w = null, nm = String(get(K.wallet) || '').toLowerCase();
      for (var j = 0; j < WALLETS.length; j++) {
        if (nm === WALLETS[j].name.toLowerCase() || nm === WALLETS[j].id) { w = WALLETS[j]; break; }
      }
      var ic = document.querySelector('.lxw-acct-ico');
      if (ic && w) {
        ic.style.background = w.ico;
        ic.innerHTML = w.logo
          ? '<img src="' + w.logo + '" alt="" style="width:100%;height:100%;object-fit:cover;'
            + 'border-radius:50%;display:block" onerror="this.remove()">'
          : '';
      }
      var aa = document.querySelector('.lxw-acct-addr'); if (aa) aa.textContent = short(addr);
      var cn = document.querySelector('.lxw-chipname'); if (cn) cn.textContent = 'XRP Ledger';
      var wd = document.querySelector('.lxw-wnamedone'); if (wd) wd.textContent = (w && w.name) || get(K.wallet) || '';

      for (var i = 0; i < scr.length; i++) {
        scr[i].toggleAttribute('hidden', scr[i].getAttribute('data-screen') !== 'connected');
      }
      return true;
    }

    function done(addr, note) {
      if (designConnected(addr)) return;
      // Fallback only for a page that does not ship the design's wallet modal at all.
      build();
      body.innerHTML = '';
      body.appendChild(head('Connected', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var h4 = document.createElement('h4'); h4.textContent = "You're connected";
      var a = document.createElement('div'); a.className = 'lxx-addr'; a.textContent = short(addr);
      s.appendChild(h4); s.appendChild(a);
      if (note) { var p = document.createElement('p'); p.textContent = note; s.appendChild(p); }
      var b = document.createElement('button');
      b.className = 'lxx-btn'; b.type = 'button'; b.textContent = 'Continue';
      b.addEventListener('click', function () { close(); window.location.reload(); });
      s.appendChild(b);
      body.appendChild(s);
      open();
    }

    return { pick: pick, waiting: waiting, signing: signing, fail: fail, done: done, close: close, open: open };
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
  // Both takeovers below are grouped so dormant mode can skip them together. On an XRPL page claiming
  // every connect control is exactly right; on a Stellar page it is exactly wrong, because there the
  // design's own flow is the real one and this would answer for it. See __lxcNoBoot at the end.
  function takeOverConnectUi() {
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
  // Keep a handle on the DESIGN's opener before replacing it. designConnected() needs it to mount the
  // design's own modal shell, and calling the replacement instead is infinite recursion:
  // lxwOpenWallet -> openPicker -> ui.done -> designConnected -> lxwOpenWallet. (Measured: a real
  // "Maximum call stack size exceeded" on the live page.)
    try {
      if (!window.__lxwDesignOpen && typeof window.lxwOpenWallet === 'function') {
        window.__lxwDesignOpen = window.lxwOpenWallet;
      }
      window.lxwOpenWallet = function () { openPicker(); };
    } catch (e) {}
  }

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
      if (t === 'cross') return crossSubmit(tx);
      if (t === 'xaman') return xamanSubmit(tx);
      return Promise.reject(new Error(
        'This wallet connection cannot sign. Disconnect and connect again.'));
    },
    canSign: function () { var t = get(K.transport); return t === 'gem' || t === 'cross' || t === 'xaman'; },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    wallets: WALLETS.map(function (w) { return w.name; }),
    configured: function () { return { xaman: !!XAMAN_KEY }; }
  };

  function boot() { resume(); watchWalletChip(); }

  // DORMANT MODE, for pages that are not XRPL pages.
  //
  // The combined site serves Stellar's landing page, and that page offers "Choose a network" with an
  // XRP Ledger row. Picking it has to open THIS picker in place, which means this module has to be
  // present there -- but it must not come alive on its own, because on a Stellar page the two builds
  // collide on the same storage: lumos.address / lumos.wallet are shared keys (the header of this file
  // makes the same point in the other direction). resume() would read a Stellar G-address out of
  // lumos.address and adopt it as an XRPL session, and watchWalletChip() would fight Stellar's own
  // connect layer over the top-bar chip.
  //
  // It must also not CLAIM THE PAGE'S CONNECT UI, and that half was missed first time round. Two
  // takeovers run at module level on an XRPL page: a window capture listener that answers every connect
  // button, and an outright replacement of window.lxwOpenWallet. Both are correct where this module is
  // the only connect flow. On Stellar's landing page they hijack the real one — measured, the override
  // alone meant "Choose a network" built no modal at all and picking Stellar would have opened the XRPL
  // picker. They are now in takeOverConnectUi() and skipped with the rest.
  //
  // So when the host page sets window.__lxcNoBoot before this script runs, window.lxc is defined and
  // nothing else happens: no resume, no chip watcher, no takeover. lxc.open() still works, which is all
  // the chooser needs. XRPL's own pages never set the flag, so their behaviour is unchanged.
  if (!window.__lxcNoBoot) {
    takeOverConnectUi();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
