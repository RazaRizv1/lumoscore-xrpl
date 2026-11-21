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
  // It is a PUBLIC client identifier and is served to every visitor in this file, which is why it can
  // live here. The SECRET is NOT used and must never be put in front-end code: this is the PKCE flow,
  // designed to run without one. Xaman's own docs: "Never use an API Secret obtained from the
  // Developer Dashboard in a frontend environment!"
  //
  // THE KEY AND THE REDIRECT LIST ARE ONE SETTING, NOT TWO. Xaman validates the pair, and refuses
  // with a single "Invalid client/redirect URL" that says which of the two is wrong -- it reads
  // identically for an unknown app and for an unregistered address (verified: a fabricated client_id
  // produces the same page). Until 2026-10-11 this held the key of an application that no longer
  // existed, so EVERY Xaman sign-in had been refused before the user was ever shown a prompt, on
  // every device, for as long as the integration has been here. Changing one without the other puts
  // it straight back.
  //
  // Registered for this app, and the only addresses sign-in can complete on:
  //   https://lumoscore.com  +  /trade/xrpl
  //   https://lumoscore-staging.pages.dev  +  /trade/xrpl
  // Per-deployment origins (<hash>.lumoscore-staging.pages.dev) change every deploy and can never be
  // registered, so Xaman must be tested on the alias or on production -- never on a deploy hash.
  // Both verified accepted 2026-10-11 by requesting the gateway directly: it answers with a real
  // "Sign in to lumoscore.com" sign request instead of access_denied.
  //
  // Left blank, Xaman shows as "Setup needed" instead of failing silently mid-flow.
  var XAMAN_KEY = '7b33acf2-5f6d-4e07-9e5a-d371235be903';
  // ---------------------------------------------------------------------------------------------

  var XUMM_SRC = '/assets/vendor/xumm-oauth2-pkce-2.8.7.min.js';

  // The beginner's guide behind "New to wallets?" in the connect sheet's footer. Stellar links the
  // same post from its own modal (see _walletdocslink.js there); the post is written to be
  // network-agnostic, so every chain points at this one URL rather than each keeping its own.
  var WALLET_GUIDE_URL = 'https://lumoscore.com/blog/new-to-wallets-a-beginner-s-guide-to-stellar-wallets';

  // WHERE XAMAN SENDS THE USER BACK. It must be a page that runs THIS file: the library finishes a
  // sign-in only on the page it returns to -- in the desktop popup it posts the result to the opener,
  // on a phone it picks the session up after the app hands back. It used to be origin + '/', which on
  // the combined site is STELLAR's landing page and carries no Xaman code at all, so the popup sat
  // there and a phone came back signed out. /trade/xrpl is an XRPL page on both the combined and the
  // standalone builds and is not behind the authgate. Every origin + this path must be listed as a
  // redirect URL at apps.xaman.dev, or the gateway answers "Invalid client/redirect URL".
  var XAMAN_RETURN = '/trade/xrpl';
  // The page the sign-in started from, so a phone returning to XAMAN_RETURN is taken back to it.
  var XAMAN_BACK = 'lumos.xamanBack';
  // "Show the Connected screen once this page has loaded." Survives exactly one navigation, which is
  // the hop from XAMAN_RETURN to the dashboard described at the adopt site.
  var XAMAN_SHOW = 'lumos.xamanShow';
  // Where a completed sign-in belongs. NOT XAMAN_RETURN: that one is a fixed address registered in
  // the Xaman app and cannot be changed from here without the app's settings changing to match.
  var HOME = '/dashboard';
  // Where the confirmation is SHOWN — the landing, matching Stellar: connect there and the popup sits
  // over the marketing page until Continue, which is the only thing that moves you to the dashboard.
  //
  // ?stay=1 is load-bearing, not decoration. _authgate.js puts a gate in <head> that replaces "/" with
  // "/dashboard" the moment a wallet is stored, so hopping to a bare "/" after adopting the session
  // would bounce straight past the landing (measured). That gate ships its own escape hatch for
  // exactly this — "A ?stay=1 escape hatch keeps the landing reachable while connected" — so this uses
  // the documented way out rather than fighting it.
  var LANDING = '/?stay=1';
  var RPC = 'https://xrplcluster.com/';

  var K = {
    addr: 'lumos.address', wallet: 'lumos.wallet', transport: 'lumos.transport',
    chain: 'lumos.chain', network: 'lumos.network',
    // Which wallet was last connected, PER CHAIN. It used to be `lumos.lastWallet`, the same key the
    // Stellar build writes — and one slot cannot hold two answers. The ids never overlap (rabet,
    // freighter, lobstr on one side; xaman, gem, cross on the other), so whichever chain you connected
    // on last won the slot and the other chain matched nothing and fell back to "Installed" for ever.
    //
    // RAZA 2026-10-17: "on XRPL it doesnt show last used. it keeps showing installed" — his Stellar
    // picker had Rabet tagged, so the shared key held "rabet". Reproduced by writing that value here:
    // all three XRPL rows lose the tag; write "gem" instead and GemWallet gets it back.
    //
    // It broke the other direction too, unreported: connecting on XRPL wrote "gem" into the shared
    // key and Stellar's picker then had nothing to match either.
    //
    // Deliberately NOT cleared by forget(): which wallet you last used is the thing worth remembering
    // once you sign out.
    lastWallet: 'lumos.lastWallet.xrpl',
    // Read-only, for the one-time migration below.
    lastWalletLegacy: 'lumos.lastWallet'
  };

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // The last XRPL wallet, honouring the old shared key ONCE so that someone whose most recent connect
  // was on this chain does not lose the tag the day this ships. The legacy value is only accepted if
  // it names a wallet THIS picker offers — that test is the whole point, since a Stellar id sitting in
  // the shared slot is exactly the bug being fixed and must not be migrated in.
  function lastWalletId() {
    var v = get(K.lastWallet);
    if (v) return v;
    var old = get(K.lastWalletLegacy);
    if (!old) return '';
    for (var i = 0; i < WALLETS.length; i++) {
      if (WALLETS[i].id === old) { set(K.lastWallet, old); return old; }
    }
    return '';
  }
  function noop() {}

  // Resolves TRUE only when the text really reached the clipboard.
  //
  // navigator.clipboard existing is not permission to use it: it is present and still throws on an
  // insecure origin, in a background tab, and wherever the permission is denied -- so the fallback
  // runs on a REJECTED promise, not merely on a missing API. Reporting a copy that did not happen
  // leaves someone pasting the last thing they copied into their wallet.
  function copyText(str) {
    return new Promise(function (res) {
      var done = false;
      function fallback() {
        if (done) { return; } done = true;
        var ok = false;
        try {
          var ta = document.createElement('textarea');
          ta.value = str;
          // Off-screen rather than hidden: display:none and visibility:hidden are both unselectable,
          // so execCommand would copy nothing and still report success in some browsers.
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, str.length);
          ok = !!document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) { ok = false; }
        res(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(str).then(function () {
            if (done) { return; } done = true; res(true);
          }, fallback);
          return;
        }
      } catch (e) {}
      fallback();
    });
  }

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

  // The chain, in a form the SERVER can read. On the combined deployment the authgated pages --
  // dashboard, wallet, launchpad -- are one url each and the middleware picks this chain's build from
  // this cookie. localStorage never leaves the browser, so it cannot answer that question.
  // Harmless on the standalone XRPL site, where nothing reads it.
  function cookieChain(v) {
    try {
      document.cookie = 'lx_chain=' + (v || '') + '; path=/; max-age=' + (v ? 31536000 : 0)
        + '; SameSite=Lax';
    } catch (e) {}
  }

  function store(addr, walletName, transport) {
    set(K.addr, addr); set(K.wallet, walletName); set(K.transport, transport);
    set(K.chain, 'xrpl'); set(K.network, 'mainnet');
    cookieChain('xrpl');
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
    // DISCONNECT HAS TO REACH THE SDK TOO. Clearing our own keys left `XummPkceJwt` behind, and
    // resume() rebuilds the SDK on the next page load whenever that key exists — which fires
    // 'retrieved', which calls accept(), and signs the reader straight back in. Silently, because
    // there is no XAMAN_BACK marker to announce it. Pressing Disconnect and then reloading would
    // simply undo the disconnect.
    xamanForget();
    // Same reasoning one line up, for the other transport that keeps state outside our own keys:
    // a WalletConnect session left live on the relay is re-adopted on the next connect.
    joeyForget();
    cookieChain('');
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

  function ledgerState(a) {
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'account_info', params: [{ account: a, ledger_index: 'validated' }] })
    }).then(function (j) {
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
      if (!ok) throw missingWallet('GemWallet');
      return gemSend('REQUEST_SUBMIT_TRANSACTION/V3', {
        transaction: tx,
        url: window.location.origin, title: document.title, favicon: favicon()
      });
    }).then(function (d) {
      if (d && d.error) {
        // String(d.error) WAS "[object Object]" WAITING TO HAPPEN -- the same defect RAZA hit on
        // Stellar/Rabet (2026-11-03). An Error crossing the extension boundary is structured-cloned and
        // Error.prototype.message is non-enumerable, so what arrives can be {}: no message, no name, and
        // String({}) is "[object Object]". Read every key it might use, accept a bare string, and treat
        // a silent failure IN THE SIGNING STEP as a refusal -- an extension that fails for a reason of
        // its own says so, and the only other thing that ends this step quietly is the person closing it.
        var m = (d.error && (d.error.message || d.error.name || d.error.description)) || (typeof d.error === 'string' ? d.error : '');
        throw new Error(!m || /reject|denied|cancel/i.test(m) ? 'Cancelled by the user.' : m);
      }
      // A REFUSAL IS ANNOUNCED AT WHICHEVER LEVEL THE EXTENSION PUTS IT (RAZA 2026-09-17: "if i initiate the send but i
      // cancel the wallet confirmation. on Stellar it shows an error, on XRP it doesnt"). @gemwallet/api answers a
      // declined request with `type: 'reject'` on the RESPONSE, not inside `result`, so a check of `result.type` alone
      // fell through to the missing-hash error — and worse, said nothing at all when the popup was dismissed without
      // answering. All three nestings are read here.
      var r = (d && d.result) || {};
      if (d && d.type === 'reject') throw new Error('Cancelled by the user.');
      if (r.type === 'reject' || (r.result && r.result.type === 'reject')) throw new Error('Cancelled by the user.');
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
      if (!ok) throw missingWallet('GemWallet');
      return gemSend('REQUEST_GET_ADDRESS/V3', {
        url: window.location.origin, title: document.title, favicon: favicon()
      });
    }).then(function (d) {
      if (d && d.error) {
        // Same structured-clone trap as gemSubmit above; this one is CONNECTING, not signing, so the
        // wording stays specific to the step the person is actually in.
        var m = (d.error && (d.error.message || d.error.name || d.error.description)) || (typeof d.error === 'string' ? d.error : '');
        throw new Error(!m || /reject|denied|cancel/i.test(m) ? 'Request rejected in GemWallet.' : m);
      }
      var r = (d && d.result) || {};
      if (d && d.type === 'reject') throw new Error('Request rejected in GemWallet.');
      if (r.type === 'reject') throw new Error('Request rejected in GemWallet.');
      if (!r.address) throw new Error('GemWallet did not return an address.');
      return accept(r.address, 'GemWallet', 'gem');
    });
  }

  // ---- Xaman -----------------------------------------------------------------------------------
  // `what` names the library in the failure message. Defaulted to Xaman because that is who the
  // only caller was when this was written -- a blank default would have put "Could not load the
  // library" in front of someone with no idea which one.
  function loadScript(src, what) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Could not load the ' + (what || 'Xaman') + ' library.')); };
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
      var x = new window.XummPkce(XAMAN_KEY, { rememberJwt: true, redirectUrl: xamanRedirect() });

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

  function xamanRedirect() { return window.location.origin + XAMAN_RETURN; }

  // localStorage, not sessionStorage: on a phone the return can arrive in a different tab than the
  // one that left for the app. Stamped, so a stale entry from an abandoned sign-in is ignored.
  function rememberBack() {
    try {
      localStorage.setItem(XAMAN_BACK, JSON.stringify({
        u: window.location.pathname + window.location.search + window.location.hash, t: Date.now() }));
    } catch (e) {}
  }
  // WHERE THE READER SHOULD END UP — returned, NOT navigated to.
  //
  // This used to be goBack(), which called location.replace() the instant the session was adopted.
  // On a phone that is the whole problem: the Xaman app sends you back as a fresh page load, the
  // confirmation is drawn, and the redirect fires in the same tick — so "You're connected" appears
  // for a split second and the reader is dumped on the dashboard having had no chance to read it,
  // let alone check the address (RAZA 2026-10-17: "it doesn't show this popup... It does show this
  // popup for split seconds but doesnt stop").
  //
  // Returning the target instead lets the Connected screen own the decision: it is handed to the
  // design's own Continue button, so the reader leaves when they press it and lands back where they
  // started sign-in rather than always on the dashboard.
  //
  // Still CONSUMED here, every time it is read. The marker doubles as the "this page view is
  // completing a sign-in" signal, and leaving it behind would make the next ordinary page load
  // announce a connection that did not happen.
  function backTarget() {
    var b = null;
    try { b = JSON.parse(localStorage.getItem(XAMAN_BACK) || 'null'); localStorage.removeItem(XAMAN_BACK); } catch (e) {}
    // Never inside the desktop popup -- the library closes that itself once it has posted.
    if (window.opener) return '';
    if (!b || typeof b.u !== 'string' || b.u.charAt(0) !== '/' || b.u.charAt(1) === '/') return '';
    if (Date.now() - (b.t || 0) > 15 * 60 * 1000) return '';
    if (b.u.split('#')[0] === window.location.pathname + window.location.search) return '';
    return b.u;
  }

  // ADOPTING A SESSION IS NOT THE SAME AS ANNOUNCING ONE, and conflating them produced both of the
  // things RAZA saw the first time Xaman ever connected (iPhone, 2026-10-11):
  //
  //   "it showed me the confirmation for connection twice"
  //        'retrieved' AND 'success' both fire for ONE sign-in, and both landed here, so the
  //        "You're connected" dialog was opened twice for a single approval.
  //
  //   "this popup keeps appearing and it reappears over and over"
  //        the SDK is constructed with rememberJwt, so it re-fires 'retrieved' on EVERY later page
  //        load to hand back the remembered session. That is the whole point of it -- it is how the
  //        phone stays signed in across the redirect -- but it meant every page load re-announced a
  //        connection the reader made once, and the redirect then moved them as well.
  //
  // So: adopt on every event (the session must be picked up, silently, as often as it is offered),
  // but ANNOUNCE only when this page view is actually completing a sign-in. rememberBack() writes
  // XAMAN_BACK before leaving for Xaman and backTarget() consumes it, so its presence IS that signal --
  // read before backTarget() can clear it, and false on an ordinary page load.
  var xamanAdopted = '';

  // Drop any remembered Xaman session so the next authorize() has to ask. `XummPkceJwt` is the SDK's
  // own storage key; logout() is what clears an instance that has already read it. xamanAdopted is
  // reset too — it is the "this address is already taken" guard, and leaving the old address in it
  // would make the picker ignore the new one as a duplicate.
  function xamanForget(x) {
    xamanAdopted = '';
    try { localStorage.removeItem('XummPkceJwt'); } catch (e) {}
    try { if (x && typeof x.logout === 'function') x.logout(); } catch (e) {}
  }
  // Says why, but only while someone is waiting on an answer. Set when run() shows the waiting
  // screen and cleared when anything resolves, so an ordinary page load that quietly restores a
  // remembered session draws nothing — which is the behaviour the `announce` flag already protected.
  var xamanWaiting = null;
  function xamanSay(msg) {
    if (!xamanWaiting) { try { console.warn('[lumoscore] Xaman connect:', msg); } catch (e) {} return; }
    var w = xamanWaiting; xamanWaiting = null;
    try { ui.fail(w, msg); } catch (e) {}
  }

  function adoptXumm(x) {
    try {
      var p = x.state();
      if (!p || !p.then) return;
      // Read now: both events may resolve before either reaches backTarget().
      var announce = false;
      try { announce = !!localStorage.getItem(XAMAN_BACK); } catch (e) {}
      p.then(function (state) {
        // EVERY EXIT HERE USED TO BE SILENT, AND THAT IS WHY THIS WAS UNDIAGNOSABLE.
        //
        // RAZA 2026-10-20, signed out on a phone: tapping Xaman "brings me to pools main page" and
        // "still not connecting". There was no error anywhere to go on — four separate returns in
        // this function each meant something different and all four looked identical from outside:
        // no session, wrong network, a malformed address, and a duplicate event. The one path that
        // DOES report (run's catch -> ui.fail) is not on this route at all.
        //
        // So each one now says what it was. xamanSay only draws when a connect is actually in flight,
        // so a remembered session restored quietly on an ordinary page load stays quiet — that was
        // the point of the `announce` flag and it is preserved.
        if (!state || !state.me || !state.me.account) {
          xamanSay('Xaman did not return an account. If you approved it in the app, try once more.');
          return;
        }
        if (!netOk(state.me)) {
          xamanSay('That Xaman account is on ' + String(state.me.networkType || 'another network')
            + '. Switch it to Mainnet in Xaman and connect again.');
          return;
        }
        var addr = state.me.account;
        // The second event of the pair, for a sign-in already taken. Not an error, just done.
        if (xamanAdopted === addr) return;

        // NOBODY GETS SIGNED IN WHO DID NOT ASK. NO BACKTICKS IN THIS COMMENT.
        //
        // RAZA 2026-10-20: "When I tap launch app, instead of showing me networks popup, and then
        // wallet selection, then wallet signing, it just bypasses all that and connects me to
        // Xaman." His header came back carrying an address after ONE tap, having been signed out.
        //
        // The cause is the side effect this file already documents from 2026-10-11 — constructing
        // XummPkce with rememberJwt restores a remembered session and fires 'retrieved'. That fix
        // stopped the warm-up from CONSTRUCTING the SDK. It did not gate what happens when the event
        // arrives anyway: accept() ran unconditionally, so a stale JWT left over in the browser
        // signed the reader straight in, skipping the network choice, the wallet choice and the
        // approval in the app.
        //
        // The `announce` flag below was only ever deciding whether to SHOW a confirmation. It was
        // never deciding whether to connect, which is the decision that actually mattered.
        //
        // Two things make an adoption legitimate, and nothing else does:
        //   * xamanWaiting — this page view asked: the reader tapped Xaman and is on the waiting
        //     screen right now;
        //   * announce — this page view is completing the app round trip, which rememberBack()
        //     marked before we left for Xaman.
        // A remembered SDK session with neither is just a leftover, and the app's own address key is
        // what restores a genuinely connected reader on an ordinary load — independently of this.
        if (!xamanWaiting && !announce) return;

        xamanAdopted = addr;
        try { accept(addr, 'Xaman', 'xaman'); }
        catch (e) { xamanSay((e && e.message) || 'Xaman returned an address this app could not read.'); return; }
        if (!announce) return;                       // a remembered session, quietly restored
        backTarget();                                // consume the marker; its job was the signal above

        // THE LANDING BELONGS BEHIND THIS SCREEN, AND THE DASHBOARD COMES AFTER CONTINUE — which is
        // what Stellar does, and the shape RAZA asked these to share: "please make sure it keeps the
        // background as the landing page until ive clicked continue button, after that it will take
        // me to dashboard page, not anywhere else".
        //
        // A phone always returns to XAMAN_RETURN ('/trade/xrpl') because that address is registered in
        // the Xaman app and cannot be changed from here. So the confirmation was drawn over the trade
        // page, and Continue then loaded a second page before the app settled on the dashboard — two
        // navigations the reader watches. An earlier pass moved the hop to the dashboard, which fixed
        // the double navigation but put the wrong page behind the screen.
        //
        // The hop happens BEFORE the screen is drawn, so the one navigation is over by the time there
        // is anything to read; it goes to the LANDING, and Continue carries on to the dashboard.
        //
        // Stellar needs none of this: connecting there never reloads the page, so its popup is simply
        // drawn where the reader already was. Only the phone's app round trip makes a fresh load.
        if (window.location.pathname !== '/') {
          try { localStorage.setItem(XAMAN_SHOW, '1'); } catch (e) {}
          try { window.location.replace(LANDING); return; } catch (e) {}
        }
        try { ui.done(get(K.addr), '', HOME); } catch (e) {}
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
    // The window went away without an answer. That is the gateway refusal below AND an ordinary
    // cancel, and nothing here can tell them apart.
    //
    // RAZA 2026-10-27, after closing the window himself: "i need you to keep this error short".
    // It used to append the whole redirect-URL diagnosis on the chance that this was the refusal,
    // which meant the common case -- someone changing their mind -- was answered with three lines
    // about apps.xaman.dev. The diagnosis is not lost: when Xaman actually reports the refusal it
    // comes back as invalid client / redirect / access_denied, and the branch below says all of it,
    // naming the exact address. Guessing it here only taxed the people who did nothing wrong.
    if (/popup-closed/.test(m)) {
      return new Error('The Xaman sign-in window closed before it finished.');
    }
    if (/invalid client|redirect|access_denied/i.test(m)) {
      return new Error('Xaman would not accept a sign-in returning to ' + xamanRedirect()
        + ' — that address is not registered for this Xaman app. If this is your site, add it as a '
        + 'redirect URL at apps.xaman.dev; otherwise open LumosCore from its main address.');
    }
    return new Error(m || 'Xaman sign-in failed.');
  }

  // THE SIGN-IN WINDOW HAS TO BE OPENED INSIDE THE TAP, AND THE SDK CANNOT DO THAT.
  //
  // This is why Xaman never worked on a phone. The SDK's authorize() is:
  //     yield this.ping ... window.open(authorizeUrl, "XummPkceLogin", ...)
  // so the open happens AFTER an await. Measured on the deployed XRPL build 2026-10-11: the tap lands,
  // and window.open is called 108ms later. Desktop browsers tolerate that; iOS Safari does not -- it
  // only allows a window to be created while a user gesture is active, so the call returns null.
  //
  // Nothing then reports it. The SDK stores the null on x.popup, so the watcher below (which asks
  // whether x.popup has CLOSED) never fires, authorize() stays pending forever, and the dialog sits on
  // "Waiting for Xaman" with a Cancel button. Reproduced exactly by stubbing window.open to return
  // null: that is the screen RAZA has been getting on iPhone Safari every time.
  //
  // A window opened in the gesture under the SDK's own window NAME fixes it: when authorize() later
  // calls window.open(url, "XummPkceLogin"), the browser retargets the window that already exists
  // rather than creating one, which is allowed after the gesture has expired. Same name, or this does
  // nothing. The SDK's feature string is copied so desktop keeps the sized popup it had.
  var xamanWin = null;
  function xamanPreopen() {
    try {
      xamanWin = window.open('about:blank', 'XummPkceLogin',
        'directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=600,height=790');
    } catch (e) { xamanWin = null; }
    return xamanWin;
  }
  function xamanDropWin() {
    try { if (xamanWin && !xamanWin.closed) xamanWin.close(); } catch (e) {}
    xamanWin = null;
  }

  function xamanConnect() {
    // SYNCHRONOUS, BEFORE ANY PROMISE. run() calls this straight out of the row's click handler, so the
    // gesture is still live here -- one await later it is not, which is the whole bug.
    var pre = xamanPreopen();
    if (!pre) {
      // Blocked even inside the gesture: pop-ups are switched off for this site. Say so, rather than
      // opening a dialog that waits for a window that will never exist.
      return Promise.reject(new Error('Your browser blocked the Xaman sign-in window. Allow pop-ups '
        + 'for this site, then try again.'));
    }
    // BEFORE xumm(), NOT AFTER IT. Constructing the SDK can restore a remembered session and fire
    // 'retrieved' immediately. adoptXumm() decides whether to announce by looking for this marker, so
    // if it is written after xumm() that restore is silent: the reader taps Xaman, is connected, and
    // is told nothing. Writing it here means a tap always counts as a sign-in, however fast it
    // resolves.
    rememberBack();

    // A TAP ON XAMAN MEANS "LET ME CHOOSE AN ACCOUNT", NOT "USE THE ONE FROM LAST TIME". The SDK is
    // built with rememberJwt, so a stored session used to be restored the instant it was constructed:
    // no QR, no approval, straight back to the previous address. That was deliberate and it was the
    // wrong call — it makes switching accounts impossible from inside the site. RAZA 2026-10-17, after
    // changing accounts in his Xaman app: "Instead of showing me barcode it automatically connect me
    // to the wallet that i last used... Dont autoconnect".
    //
    // Cleared TWICE on purpose, and both are load-bearing: once here, so a FIRST construction finds no
    // session to retrieve, and again once the SDK resolves, because xumm() is memoised — resume() may
    // already have built an instance at page load and that one holds its session in memory, where
    // removing the key cannot reach it.
    //
    // Safe for the phone round trip: this only drops a STALE session. Signing in writes a fresh JWT on
    // the way back, and resume() also accepts the return on the URL (`returning`) rather than relying
    // on the key being there beforehand.
    xamanForget();
    return xumm().then(function (x) {
      xamanForget(x);
      // Race the SDK's own 'error' against authorize(), because a refused sign-in only ever arrives
      // on the event -- authorize() itself stays pending forever.
      var refused = new Promise(function (_res, rej) { xamanPending = rej; });
      var p = x.authorize();
      if (!p || !p.then) { xamanPending = null; xamanDropWin(); return Promise.reject(new Error('Xaman sign-in could not start.')); }

      // WATCH THE WINDOW, because the SDK's events do not cover this. It settles only when the popup
      // POSTS a message back -- 'xumm_sign_request_rejected' or 'xumm_sign_request_popup_closed' --
      // and Xaman's own gateway error page ("Invalid client/redirect URL") posts nothing at all. It
      // just renders. So authorize() stays pending, 'error' never fires, and even closing the window
      // by hand leaves this dialog spinning; RAZA hit that twice on 2026-10-01. The SDK does keep the
      // handle on x.popup, so the window going away is a signal we can read ourselves.
      // FALL BACK TO OUR OWN HANDLE. x.popup is whatever the SDK's window.open returned, so when that
      // call was the one iOS refused it is null and this watcher watched nothing -- the silent half of
      // the bug above. The window we opened in the gesture is the same window once authorize()
      // retargets it, so it answers "did the user close it" just as well, and it answers even when the
      // SDK never got a handle at all.
      var watch = setInterval(function () {
        var w = (x && x.popup) || xamanWin;
        if (w && w.closed) { clearInterval(watch); failXaman(new Error('popup-closed')); }
      }, 800);

      // Clear the rejector however this settles. Left dangling, a later unrelated 'error' event would
      // fire it at a sign-in that already finished.
      return Promise.race([p, refused]).then(
        // CLOSE IT ON SUCCESS TOO. When the session is already live, authorize() resolves without
        // ever opening anything, so the blank window we pre-opened in the tap is never navigated and
        // would be left on screen for the reader to dismiss. Where the SDK did retarget it, Xaman's
        // own flow has closed it already and this is a no-op.
        function (v) { clearInterval(watch); xamanPending = null; xamanDropWin(); return v; },
        function (e) { clearInterval(watch); xamanPending = null; xamanDropWin(); throw e; });
    }).then(function (state) {
      xamanPending = null;
      if (!state || !state.me || !state.me.account) throw new Error('Sign-in was cancelled.');
      if (!netOk(state.me)) {
        throw new Error('That Xaman account is on ' + state.me.networkType + '. LumosCore is on Mainnet.');
      }
      return accept(state.me.account, 'Xaman', 'xaman');
    }).catch(function (e) {
      // Anything that fails BEFORE authorize() retargets it -- a missing key, the library not
      // loading, a refusal -- would otherwise leave the blank window we opened sitting there for the
      // user to close by hand.
      xamanDropWin();
      throw e;
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
        // isHandset, not isHandheld: on a touchscreen LAPTOP the loose test hid the QR Xaman had
        // already generated and left a desktop signer with no way to reach their phone. Xaman has
        // no desktop app, so the QR is the only path there. Same defect as the Joey one below, found
        // the same day -- see isHandset.
        var close = ui.signing(link, isHandset() ? '' : png, function () {
          if (abort) abort(new Error('Cancelled.'));
        });

        // BEST EFFORT, not the mechanism. On a phone this usually walks straight into Xaman; on iOS the
        // activation that started the transaction is already spent by the time the payload exists, so
        // the hand-off can be dropped silently. That is survivable here in a way it was not for LOBSTR:
        // the user is signed in, so Xaman PUSHES the request to their device regardless, and the dialog
        // behind this carries an Open button that is a fresh tap.
        if (isHandset() && link) { try { window.location.href = link; } catch (e) {} }

        var v = xamanVerdict(sdk, sub, uuid);
        abort = v.abort;
        return v.promise.then(function (d) {
          close();
          if (!d || !d.signed) throw new Error('Cancelled by the user.');
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

  // THERE USED TO BE AN isHandheld() HERE and it is deliberately gone. It answered "does this
  // device do taps" -- true on any touchscreen laptop -- and every caller actually wanted the
  // question below. Leaving an unused function with an authoritative name beside the right one is
  // how the next person reintroduces this bug, so it was removed rather than kept "just in case".
  // A genuine click handler that needs tap-capability can ask matchMedia directly in one line.

  // "IS THIS DEVICE ITSELF THE PHONE." The only question worth asking before handing someone a
  // deep link into a wallet app or deciding they do not need a QR.
  //
  // FOUND ON RAZA'S OWN LAPTOP, 2026-10-27, by opening the Joey dialog on production right after
  // adding the desktop QR he asked for -- and getting no QR. His machine reports
  // `maxTouchPoints: 10` with `any-pointer: fine` (a touchscreen laptop), so isHandheld() answered
  // TRUE, the Joey path took the handset branch, and it offered a joey:// link that Windows cannot
  // open while suppressing both the QR and the copy link. The dialog had no way through at all.
  //
  // The picker's filter has been getting this right since 2026-10-17 and says so in its own note
  // ("NOT isHandheld()"); the wallet-app paths simply never used that logic. It is named here so
  // there is one answer instead of two, and so the next caller inherits the right one.
  //
  // A touch laptop has a mouse as well and fails the second test. A phone or tablet does not.
  function isHandset() {
    try { if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return true; } catch (e) {}
    try {
      return window.matchMedia('(pointer:coarse)').matches
        && !window.matchMedia('(any-pointer:fine)').matches;
    } catch (e) {}
    return false;
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
  // A WALLET EXTENSION THAT IS NOT IN THIS BROWSER (RAZA 2026-11-19): tagged, so the connect flow can show the one
  // wording every network uses (window.lxWalletMissingText, identical in Stellar's _wallet_realconnect.js and NEAR's
  // nearconnect.js) instead of a bare "not installed". The message text itself is unchanged for every other reader.
  window.lxWalletMissingText=window.lxWalletMissingText||function(name,phoneAlt){var phone=/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent||'');return phone?{title:name+' is a desktop browser extension',text:'On a phone, connect with '+phoneAlt+' instead.'}:{title:name+' isn’t available here',text:'Opened from ChatGPT, another AI assistant, or an app like Telegram or X? Their built-in browsers can block wallet extensions, even ones you’ve installed. Open this link in your usual browser.'};};
  function missingWallet(name) {
    var e = new Error(name + ' is not installed in this browser.');
    e.code = 'NOT_INSTALLED';
    return e;
  }
  function crossApi() { return (typeof window !== 'undefined' && window.crossmark) || null; }
  function crossInstalled() { return !!crossApi(); }
  function crossCall(name, arg) {
    var api = crossApi();
    if (!api) return Promise.reject(missingWallet('Crossmark'));
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
      throw new Error(/reject|denied|cancel/i.test(m) ? 'Cancelled by the user.' : (m || 'Crossmark could not sign this transaction.'));
    });
  }

  // ---- Joey (WalletConnect) --------------------------------------------------------------------
  // RAZA 2026-10-27: "on XRPL mobile, we only have Xaman wallet. There's also Joey wallet app".
  // It is also the unfinished half of the list quoted at the head of the Crossmark section --
  // "add: Cross mark, Joey, Wallet connect" (2026-09-16). Crossmark shipped that day; this did not.
  //
  // WHY THERE IS NO GEM WALLET MOBILE ROW BESIDE IT. He asked for one in the same sentence, and it
  // cannot be built -- the limit is the wallet's, not ours. Two independent sources, both read on
  // 2026-10-27:
  //
  //   * Gem's own source. core/crates/primitives/src/wallet_connect_namespace.rs on main maps
  //     ChainType::Xrp to None for BOTH get_namespace and get_reference, and its WalletConnectCAIP2
  //     enum has no xrpl variant at all -- only eip155, solana, cosmos, algorand, sui, ton, tron.
  //   * The WalletConnect registry, which lists Gem Wallet on 19 chains, every one of them eip155.
  //
  // gemwallet.com's FAQ says you can connect XRP Ledger dApps. It is wrong, and a row built on it
  // would hand the app a session it can only refuse as an unsupported chain. This is the same wall
  // RAZA hit on his own phone on 2026-10-17; the scanner exists now, XRP still is not wired to it.
  // DO NOT re-add a Gem mobile row on the strength of their marketing copy -- check that one Rust
  // file, which is the thing that decides.
  //
  // Joey is registered for exactly this. The WalletConnect registry lists it on xrpl:0 / xrpl:1 /
  // xrpl:2, iOS and Android, native scheme joey://settings, and @joey-wallet/wc-core agrees on
  // every identifier below. We do NOT use their npm client: it is a thin wrapper over Reown, and we
  // already self-host the very SignClient it would pull in.
  var WC_PROJECT_ID = '8ef28ece795a0868371b0e5fd6cc76ad';
  var WC_CHAIN = 'xrpl:0';
  var WC_METHODS = ['xrpl_signTransaction', 'xrpl_signTransactionFor',
    'xrpl_signTransactionBatch', 'xrpl_signTransactionFee'];
  // The only method this build actually calls. See the note on client.connect for why asking for
  // the other three as REQUIRED made Joey unable to approve its own session.
  var WC_METHODS_MIN = ['xrpl_signTransaction'];
  // ASK FOR NO EVENTS. Joey's DEFAULT_EVENTS enum is empty -- it publishes none -- and a wallet that
  // validates a proposal strictly refuses a request for an event it never emits. The Stellar build
  // passes events:[] for the same reason.
  var WC_EVENTS = [];
  // THE PATH IS PART OF THE LINK, AND GUESSING IT COSTS A FAILED CONNECT. The obvious construction
  // -- scheme + 'wc?uri=' + encodeURIComponent(uri), which is what WalletConnect's own
  // formatNativeUrl would emit -- is what we shipped first, and Joey answered "Invalid Deep Link"
  // on RAZA's phone while this page sat spinning on an approval that could never arrive.
  //
  // Joey's own source settles it. @joey-wallet/wc-core carries the format as a constant beside the
  // wallet's project id:
  //     deeplinkFormat: 'joey://settings/wc?uri='
  //     deeplink = `${deeplinkFormat}${encodeURIComponent(uri)}`
  // and the WalletConnect registry agrees from the other side: Joey's mobile.native is
  // 'joey://settings', NOT 'joey://'. The pairing screen lives under settings in that app, so the
  // path is where the link has to land -- the bare scheme is not a shorter way to say the same
  // thing, it is a different link, and the app rejects it.
  //
  // Keep the whole prefix in one string. Split into a scheme plus a path assembled at the call
  // site, this is exactly the kind of value that gets half-corrected later.
  var JOEY_CONNECT_LINK = 'joey://settings/wc?uri=';
  // Where to send someone for a request on a session that ALREADY exists. Different question, and
  // the wallet answers it itself: WalletConnect carries the wallet's own
  // session.peer.metadata.redirect, which is the authoritative target for a follow-up request. Only
  // if a session arrives without one do we fall back to the bare scheme.
  var JOEY_APP = 'joey://';

  // OUR OWN TOPIC KEY, AND THE SUFFIX IS LOAD-BEARING. The Stellar build keeps its LOBSTR
  // WalletConnect session under lumos.wcTopic and routes on that key's mere presence. lumos.address
  // and friends are shared between the two builds on purpose; this one must NOT be, or a Joey
  // session and a LOBSTR session overwrite each other and each build then tries to sign on the
  // other's topic. Precisely the collision lumos.lastWallet.xrpl already exists to avoid -- see the
  // note on K near the top of this file, which is the same bug caught one key earlier.
  var K_WCTOPIC = 'lumos.wcTopic.xrpl';

  var _mods = {};
  function loadMod(u) { return _mods[u] || (_mods[u] = import(u)); }

  // Bounds the HANDSHAKE only, never the approval. SignClient.init sits pending for ever when the
  // relay is unreachable, and the picker would show "Waiting for Joey" with no error and no way out.
  // The user reading a prompt on their phone is not a thing to put a clock on.
  function wcTimeout(p, ms, msg) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(msg)); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  // ONE SignClient PER PAGE. _wallet_realconnect.js publishes the Stellar one as window.__lxWcClient
  // and warns there that two would fight over the relay socket. On an XRPL page lx-realconnect is
  // stripped and there is none, so we stand one up and publish it under the same name; on a Stellar
  // page -- where this module runs DORMANT but its picker can still be opened from the network
  // chooser -- theirs already exists and we borrow it instead of building a second.
  var _wcClient = null;
  function wcClient() {
    try {
      var shared = window.__lxWcClient;
      if (shared && shared !== wcClient) return Promise.resolve(shared());
    } catch (e) {}
    if (_wcClient) return _wcClient;
    // The -reqns build first, same as Stellar: it is our rebuild of 2.25.0 with the one statement
    // that wipes requiredNamespaces turned into a no-op, so BOTH requiredNamespaces and
    // optionalNamespaces reach the wallet. Stock 2.25.0 is the fallback, and either works for Joey.
    _wcClient = loadMod('/assets/vendor/wc-sign-client-2.25.0-reqns.min.js')
      .catch(function () { return loadMod('/assets/vendor/wc-sign-client-2.25.0.min.js'); })
      .then(function (m) {
        var SignClient = m.default || m.SignClient || m;
        return SignClient.init({
          projectId: WC_PROJECT_ID,
          metadata: {
            name: 'LumosCore',
            description: 'Multichain DeFi',
            url: location.origin,
            icons: [location.origin + '/assets/favicon.png']
          }
        });
      })
      .catch(function (e) {
        // Cleared so a retry rebuilds rather than handing back the same rejected promise for ever.
        _wcClient = null;
        throw new Error('Could not reach WalletConnect. Check your connection and try again.');
      });
    return _wcClient;
  }
  try { if (!window.__lxWcClient) window.__lxWcClient = wcClient; } catch (e) {}

  // ---- the desktop QR --------------------------------------------------------------------------
  // RAZA 2026-10-27: "yes add the QR for desktop". Until this, a desktop reader who picked Joey got
  // a link to copy and carry to their phone, because Xaman hands us a PNG it hosts on the payload
  // it created and WalletConnect has no equivalent -- the wc: URI is ours to render.
  //
  // THE LIBRARY IS NOT NEW CODE. /assets/vendor/qrcode-generator-arase.js is a byte-identical copy
  // of the build's own _tools/_qrlib.js, which _walletdata.js and _accountpage.js already inline as
  // lx-qrlib on 34 pages (sha256 recorded in the vendor PROVENANCE.md). Nothing entered the supply
  // chain; the same code is merely reachable as a file.
  //
  // IT IS LOADED LAZILY, and that is the whole reason it is a file. lx-qrlib is NOT on Trade, Pools
  // or the dashboard -- precisely where wallets get connected -- so the old comment on signing()
  // was right that a locally drawn QR would have been blank there. Inlining 57 KB into every one of
  // those pages to serve desktop Joey users would be the wrong trade, so it is fetched only when
  // someone actually picks Joey on a non-handset.
  var _qrlib = null;
  function qrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!_qrlib) {
      _qrlib = loadScript('/assets/vendor/qrcode-generator-arase.js', 'QR')
        .catch(function (e) { _qrlib = null; throw e; });
    }
    return _qrlib;
  }

  // The error-correction ladder from write.js, unchanged: densest levels first so the code stays
  // small, and addData THROWS when the data will not fit the requested version -- hence walking the
  // list rather than guessing one. typeNumber 0 lets the library size it.
  function makeQR(txt) {
    var lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
    for (var i = 0; i < lv.length; i++) {
      try {
        var q = window.qrcode(lv[i][0], lv[i][1]);
        q.addData(txt);
        q.make();
        return q;
      } catch (e) {}
    }
    return null;
  }

  // Paints into `host`, or leaves it empty and lets the copy-link below carry the connection. A QR
  // that cannot be drawn is not an error worth a dialog -- there is already a working way through.
  function drawQR(host, text) {
    return qrLib().then(function () {
      var q = makeQR(text);
      if (!q) throw new Error('QR too long');
      var n = q.getModuleCount();
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('shape-rendering', 'crispEdges');
      // POLARITY IS NOT A STYLE CHOICE. Dark modules on an explicitly white ground; inverted, it is
      // not a low-contrast QR, it is not a QR, and it fails silently on every scanner. The white
      // rect is drawn here rather than left to the host's background for the same reason.
      var bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('width', n); bg.setAttribute('height', n); bg.setAttribute('fill', '#ffffff');
      svg.appendChild(bg);
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (!q.isDark(r, c)) continue;
          var m = document.createElementNS(NS, 'rect');
          m.setAttribute('x', c); m.setAttribute('y', r);
          // 1.04 rather than 1, the constant write.js carries a note about: at exactly 1 the modules
          // meet on a pixel boundary and the renderer's antialiasing leaves a pale seam between every
          // pair, which a decoder reads as noise.
          m.setAttribute('width', '1.04'); m.setAttribute('height', '1.04');
          m.setAttribute('fill', '#15161c');
          svg.appendChild(m);
        }
      }
      host.innerHTML = '';
      host.appendChild(svg);
      return true;
    }).catch(function () { return false; });
  }

  // The pairing topic lives in the wc: URI as wc:<topic>@2?relay-protocol=...
  function uriTopic(uri) {
    try { return String(uri).split('?')[0].replace(/^wc:/, '').split('@')[0]; } catch (e) { return ''; }
  }

  // SignClient THROWS for an unknown topic rather than returning undefined, so this cannot be a
  // plain lookup. A stored topic that the SDK has since expired is a normal state, not an error.
  //
  // THE SECOND HALF IS THE PHONE CASE, and it is the same shape as the bug that cost Xaman a
  // session: approving leaves the browser, and iOS is free to discard this tab while the user is in
  // the wallet. If that happens between their approval and the line that stores the topic, the
  // session is live on both the relay and Joey's side while THIS build has no idea of it -- so the
  // next attempt would raise a second prompt for a connection the user already granted. SignClient
  // persists its sessions, so when our own key is missing we look for an xrpl one it still holds and
  // re-adopt it. Only sessions carrying the xrpl namespace qualify: the Stellar build shares this
  // SignClient, and adopting its LOBSTR session would hand lumos.address a G-address.
  function joeySession(client) {
    var topic = get(K_WCTOPIC);
    if (topic) {
      try {
        var s = client.session.get(topic);
        if (s && s.topic) return s;
      } catch (e) {}
    }
    var all = [];
    try { all = client.session.getAll() || []; } catch (e) { return null; }
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (!c || !c.topic) continue;
      if (!joeyAddress(c)) continue;
      set(K_WCTOPIC, c.topic);
      return c;
    }
    return null;
  }

  // CAIP-10 accounts arrive as "xrpl:0:rAddress". Everything after the SECOND colon is the address --
  // not accounts[i].split(':')[2], which silently truncates if a reference ever contains one. Every
  // candidate still goes through validAddress, because this value ends up in the shared lumos.address.
  function joeyAddress(session) {
    var accts = [];
    try {
      accts = (session && session.namespaces && session.namespaces.xrpl
        && session.namespaces.xrpl.accounts) || [];
    } catch (e) {}
    for (var i = 0; i < accts.length; i++) {
      var p = String(accts[i]).split(':');
      if (p.length < 3) continue;
      var a = p.slice(2).join(':');
      if (validAddress(a)) return a;
    }
    return '';
  }

  function joeyConnect() {
    return wcTimeout(wcClient(), 20000, 'Could not reach WalletConnect. Try again.')
      .then(function (client) {
        // TAPPING THE ROW ALWAYS ASKS THE WALLET. This used to reuse a session the browser already
        // held, on the reasoning that "asking again would be a prompt the user has already
        // answered". That reasoning was wrong, and RAZA hit it twice:
        //
        //   2026-10-28, still happening after the forget sweep shipped: "i tested on main, still no
        //   wallet confirmation on Joey, it just connected directly without me signing the
        //   connection to lumoscore"
        //
        // By the time this function runs the PICKER is open, which means the reader is signed out
        // and has just asked to connect. A silent reuse answers that request without the one thing
        // they came for: seeing, in their own wallet, which account they are handing over. Xaman
        // prompts every time and that is the behaviour being matched.
        //
        // Reuse also made correctness depend on the previous disconnect having worked. Sweeping in
        // forget() was necessary but it is not sufficient, because a session can outlive this
        // browser entirely -- cleared storage, another device, a disconnect that never reached the
        // relay. Consent cannot rest on "nothing went wrong last time".
        //
        // So: drop any xrpl session this client still holds, then propose a new one. The same
        // predicate as forget() and joeySession(), for the same reason -- a Stellar page shares its
        // SignClient and LOBSTR's session must survive.
        //
        // joeySession() stays, because joeySubmit() genuinely needs to find the live session when
        // signing. It is the CONNECT path that must not take that shortcut.
        // The old sessions are dropped AFTER the new one is approved, not here. Two reasons, and
        // the second is RAZA's:
        //
        //   1. Cancelling must cost nothing. Sweeping first meant opening the picker, tapping Joey
        //      and changing your mind left you disconnected from a session you never asked to end.
        //   2. 2026-10-28, scanning the desktop QR: "Failed to publish custom payload, please try
        //      again. id:1793128963153292800 tag:undefined" -- shown on the phone while the connect
        //      still succeeded. Sweeping first hands the wallet a session_delete at the same moment
        //      it is working through a fresh pairing, and a publish on a topic being torn down is
        //      exactly the shape of "tag:undefined".
        //
        // Nothing about the prompt depends on sweeping first: what guarantees the wallet asks is
        // that we no longer REUSE a session, not that we destroyed one.
        // REQUIRE ONLY WHAT WE CALL, OFFER THE REST. Listing all four signing methods as REQUIRED
        // made Joey refuse its own approval: "Non conforming namespaces. approve() namespaces
        // methods don't satisfy namespace methods for xrpl:0". That check runs inside the WALLET,
        // comparing what it is about to approve against the proposal's requiredNamespaces -- so a
        // method the wallet does not implement is not ignored, it makes the whole session
        // unapprovable. xrpl_signTransactionBatch is the obvious candidate: XRPL Batch is the
        // amendment no wallet has shipped support for yet ([[xrpl-batch-wallet-support]]).
        //
        // We only ever call xrpl_signTransaction -- joeySubmit has no other method in it -- so that
        // is the one thing this session cannot do without. The other three move to OPTIONAL, which
        // is what "approve these if you have them" means, and a wallet missing any of them still
        // produces a conforming session.
        //
        // This matters more here than on other builds because of the SignClient we load. Stock
        // 2.25.0 quietly folds requiredNamespaces into optional, which would have hidden this; our
        // -reqns rebuild deliberately keeps them required so LOBSTR sees them. We ask for less
        // instead of loading a laxer client, because the narrower ask is the honest one either way.
        return client.connect({
          requiredNamespaces: {
            xrpl: { methods: WC_METHODS_MIN, chains: [WC_CHAIN], events: WC_EVENTS }
          },
          optionalNamespaces: {
            xrpl: { methods: WC_METHODS, chains: [WC_CHAIN], events: WC_EVENTS }
          }
        }).then(function (res) {
          var uri = res && res.uri;
          var approval = res && res.approval;
          if (!uri || typeof approval !== 'function') {
            throw new Error('WalletConnect did not return a connection link.');
          }
          var deep = JOEY_CONNECT_LINK + encodeURIComponent(uri);
          var hand = isHandset();
          var close = ui.signing(hand ? deep : '', '', function () {
            // Cancelling must drop the PROPOSAL as well as the dialog. Left alive, the pairing sits
            // there and Joey can still approve a request this page stopped waiting for -- which
            // would store an address nobody is expecting on a screen that has moved on.
            var t = uriTopic(uri);
            if (!t) return;
            try { client.core.pairing.disconnect({ topic: t }); } catch (e) {}
            // On a handset neither is offered: the deep link above IS the path, and a QR you would
            // have to scan with the phone already holding the page is nonsense.
          }, { name: 'Joey', copy: hand ? '' : uri, qr: hand ? '' : uri, connect: true });

          // BEST EFFORT, exactly as in xamanSubmit. The URI has to exist before there is anything to
          // open, so on iOS the activation that started this is often already spent and the hand-off
          // is dropped with no error. The dialog behind it carries an Open button that IS a fresh
          // tap, which is the path that actually works -- see the note on that button.
          if (hand) { try { window.location.href = deep; } catch (e) {} }

          return approval().then(function (session) {
            close();
            var a = joeyAddress(session);
            if (!a) throw new Error('Joey did not return an XRP Ledger address.');
            // Stored BEFORE accept() so that a session which somehow fails validAddress still leaves
            // a topic we can disconnect, rather than an orphan on the relay.
            set(K_WCTOPIC, session.topic);
            // Now the earlier ones can go -- the new session is approved and recorded, so dropping
            // them cannot strand anyone. KEEPING the topic we just stored is the whole point: a
            // sweep without the exclusion would delete the session this call just established.
            joeyDropSessions(client, 'Replaced by a new session', session.topic);
            return accept(a, 'Joey', 'joey');
          }, function (e) {
            close();
            var m = (e && e.message) || '';
            throw new Error(/reject|denied|cancel/i.test(m)
              ? 'Rejected in Joey.' : (m || 'Joey did not approve the connection.'));
          });
        });
      });
  }

  // ---- Joey SIGNING ----------------------------------------------------------------------------
  // Resolves with the transaction HASH -- the same contract gemSubmit, crossSubmit and xamanSubmit
  // satisfy -- so every caller in write.js, pooldetail.js and mint.js works unchanged.
  function joeySubmit(tx) {
    return wcTimeout(wcClient(), 20000, 'Could not reach WalletConnect. Try again.')
      .then(function (client) {
        var session = joeySession(client);
        // A WalletConnect session can expire while the address stays in localStorage, which would
        // otherwise surface as a request that hangs. Say so instead, the way lxc.submit does for an
        // empty transport: a wallet layer must never leave someone watching a button that cannot
        // resolve.
        if (!session) {
          throw new Error('That Joey session has expired. Disconnect and connect again.');
        }
        var hand = isHandset();

        // CANCEL HAS TO STOP THE WAIT, not just hide the dialog. WalletConnect gives no way to
        // withdraw a request that is already on the wallet, so Cancel cannot un-ask it -- but a
        // dialog that closes while the promise stays pending leaves the caller's button spinning
        // for ever. So cancelling REJECTS, and says plainly that the request may still be sitting
        // in Joey, which is the honest version of a cancel we cannot actually perform.
        var cancelled = null;
        var cancel = new Promise(function (_res, rej) {
          cancelled = function () {
            rej(new Error('Stopped waiting. If you approve it in Joey it will still go through.'));
          };
        });
        // ASK THE SESSION WHERE TO SEND THEM. The request is already on the relay by the time this
        // link is tapped, so all it has to do is bring Joey forward -- a different job from the
        // connect link, which carries a pairing URI. WalletConnect has the wallet publish its own
        // target as session.peer.metadata.redirect, so use that rather than assume a second time
        // that the bare scheme opens this app; the connect link proved that assumption wrong.
        var back = '';
        try {
          var rd = session.peer && session.peer.metadata && session.peer.metadata.redirect;
          back = (rd && (rd.native || rd.universal)) || '';
        } catch (e) {}
        if (!back) back = JOEY_APP;
        var close = ui.signing(hand ? back : '', '', function () { cancelled(); },
          { name: 'Joey' });
        if (hand) { try { window.location.href = back; } catch (e) {} }
        return Promise.race([cancel, client.request({
          topic: session.topic,
          chainId: WC_CHAIN,
          request: {
            method: 'xrpl_signTransaction',
            // autofill lets Joey fill Fee and Sequence, which is what Xaman does for us too.
            // submit:true means the hash coming back is SUBMITTED and not merely signed -- the
            // assumption every caller already makes. LastLedgerSequence is stamped by lxc.submit
            // before we are reached, so autofill has nothing left to decide there.
            params: { tx_json: tx, options: { autofill: true, submit: true } }
          }
        })]).then(function (r) {
          close();
          // @joey-wallet/wc-core types the answer as { tx_json: TransactionAndMetadata }. The flatter
          // shapes are read too, because a wallet layer that claims a signature it cannot show a
          // hash for is worse than one that reports a failure.
          var j = (r && r.tx_json) || r || {};
          var hash = j.hash || j.tx_hash || (r && r.hash) || '';
          if (!hash) throw new Error('Joey did not return a transaction hash.');
          return String(hash);
        }, function (e) {
          close();
          var m = (e && e.message) || '';
          throw new Error(/reject|denied|cancel/i.test(m)
            ? 'Cancelled by the user.' : (m || 'Joey could not sign this transaction.'));
        });
      });
  }

  // Disconnect has to reach the RELAY too, not just our keys -- the same lesson xamanForget carries
  // one section up. Left alone, the session stays live on Joey's side and reconnecting silently
  // adopts it, so pressing Disconnect would not be a disconnect at all.
  //
  // Deliberately NOT awaited: the local keys are already gone by then, and a slow or unreachable
  // relay must not hold up something the user has already asked for.
  // DISCONNECT EVERY XRPL SESSION, NOT JUST THE ONE WE WROTE DOWN.
  //
  // RAZA 2026-10-28: "As soon as I tap joey wallet, it automatically connects to LumosCore without
  // giving me signing confirmation on joey wallet". He had connected and disconnected several times
  // while testing. Each approval creates its own session in the SDK's store, but K_WCTOPIC holds
  // ONE topic -- the newest. This function dropped that one and left the rest alive, and
  // joeySession() adopts ANY live session carrying an xrpl address, so the next tap found an
  // earlier one and signed him straight back in.
  //
  // The two halves disagreed about how many sessions there can be: the forget assumed one, the
  // lookup assumed many, and the lookup was right. Sweeping here is what makes the re-adoption in
  // joeySession() safe to keep -- after a real disconnect there is nothing left to re-adopt, so it
  // can only ever find the orphan it was written for (a tab killed between approval and the line
  // that stores the topic).
  //
  // ONLY xrpl SESSIONS. On a Stellar page wcClient() hands back THAT build's SignClient, where
  // LOBSTR's session lives. joeyAddress() reads namespaces.xrpl.accounts and nothing else, so a
  // Stellar session returns '' and is skipped; disconnecting by any looser test would sign the
  // reader out of the other chain.
  // ONE SWEEP, TWO CALLERS. Disconnect needs it and so does connect, and writing it twice is the
  // shape that produced three separate bugs in two days -- isHandset, and then this very session
  // count. Both callers pass the client they already hold; neither re-enters wcClient().
  // `keep` is a topic to spare -- the session a connect has just established. Without it the
  // post-approval sweep would delete the very session it was called to tidy up around.
  function joeyDropSessions(client, why, keep) {
    var all = [];
    try { all = client.session.getAll() || []; } catch (e) { return 0; }
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (!s || !s.topic || !joeyAddress(s)) continue;
      if (keep && s.topic === keep) continue;
      try {
        client.disconnect({ topic: s.topic, reason: { code: 6000, message: why } });
        n++;
      } catch (e) {}
    }
    return n;
  }

  function joeyForget() {
    del(K_WCTOPIC);
    try {
      wcClient().then(function (client) {
        joeyDropSessions(client, 'User disconnected');
      }).catch(noop);
    } catch (e) {}
  }

  // ---- registry --------------------------------------------------------------------------------
  // The logo files already ship in this build -- assets/wallets/{gem,xaman}.png -- so the picker and
  // the header chip use the real marks rather than a letter in a coloured square. The Stellar site
  // shows the connected wallet's own logo in the header, and this did not.
  var WALLETS = [
    {
      id: 'xaman', name: 'Xaman', sub: 'Mobile and desktop',
      // Has a real phone app, so it is reachable from a handset. See the note on the picker's filter.
      mobile: true,
      ico: '#2d2d2d', glyph: 'X', logo: '/assets/wallets/xaman.png',
      connect: xamanConnect,
      status: function () { return Promise.resolve(XAMAN_KEY ? '' : 'Setup needed'); }
    },
    {
      id: 'gem', name: 'GemWallet', sub: 'Browser extension',
      mobile: false,
      ico: 'linear-gradient(135deg,#3f9c5a 0%,#1f6b3a 100%)', glyph: 'G',
      logo: '/assets/wallets/gem.png',
      connect: gemConnect,
      status: function () {
        return gemInstalled().then(function (ok) { return ok ? 'Installed' : ''; });
      }
    },
    {
      id: 'cross', name: 'Crossmark', sub: 'Browser extension',
      mobile: false,
      ico: 'linear-gradient(135deg,#6b57ff 0%,#3a2bb5 100%)', glyph: 'C',
      logo: '/assets/wallets/crossmark.webp',
      connect: crossConnect,
      status: function () { return Promise.resolve(crossInstalled() ? 'Installed' : ''); }
    },
    {
      id: 'joey', name: 'Joey', sub: 'Mobile app',
      // A phone app reached over WalletConnect, so it survives the picker's handheld filter the same
      // way Xaman does. Before this row, that filter left a handset with exactly ONE wallet.
      mobile: true,
      ico: '#f47421', glyph: 'J', logo: '/assets/wallets/joey.png',
      connect: joeyConnect,
      // Nothing to detect: there is no extension to look for and no way to ask a phone from here
      // whether an app is installed. Claiming "Installed" on a guess would be a worse answer than
      // none, and the row's own copy already says it is a mobile app.
      status: function () { return Promise.resolve(''); }
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
    // THE SAME BACKDROP AS STELLAR'S .lxw-bd, to the byte. This was rgba(0,0,0,.62) -- the same
    // opacity but pure black, where the design's is a blue-tinted near-black -- so the page behind
    // changed tone at the moment the reader chose XRP Ledger, with the chooser still on screen.
    // RAZA 2026-11-14: "There's a subtle background color change when we select XRP Ledger. This
    // doesn't happen when we select stellar." Measured on staging 7024e104: .lxw-bd computes to
    // rgba(8, 8, 12, 0.62) and this computed to rgba(0, 0, 0, 0.62).
    + '.lxx-bd{position:fixed;inset:0;z-index:9999;background:rgba(8,8,12,.62);backdrop-filter:blur(4px);'
    + 'display:flex;align-items:center;justify-content:center;padding:18px}'
    + '.lxx-bd[hidden]{display:none}'
    // THE CARD READ AS THE PAGE BACKGROUND, NOT AS A SURFACE ABOVE IT.
    //
    // RAZA 2026-11-14: "XRPL popup is significantly darker while what we have on Stellar and Near is
    // kinda grey." He was right, and the cause is a fallback chain, not a colour choice. This was
    // `var(--card, var(--bg, #131317))`. Measured on staging af61e6c8, BOTH trees resolve:
    //
    //     --card    (unset)      --line    (unset)
    //     --bg      #0a0a0b      --surface #131317      --border #26262c
    //
    // `--card` and `--line` are set by NOBODY. So the chain fell through `--card` to `--bg` -- the
    // page's own background -- and the modal painted #0a0a0b, the exact colour of the page behind it.
    // The literal `#131317` at the end of the chain was never reached, so the fallback that looked
    // like the safety net was dead code. Stellar names `--surface` and `--border`, which ARE set, and
    // lands on #131317 / #26262c. Same two variables here now.
    //
    // A var() fallback only fires when the variable is UNSET; it cannot rescue a chain that reaches a
    // variable which IS set to the wrong thing. Read the resolved value, never the declaration.
    + '.lxx-m{width:100%;max-width:460px;max-height:88vh;display:flex;flex-direction:column;'
    + 'background:var(--surface,#131317);color:var(--text,#ECECF3);'
    + 'border:1px solid var(--border,rgba(255,255,255,.09));border-radius:18px;overflow:hidden;'
    + 'box-shadow:0 22px 60px -8px rgba(0,0,0,.5),0 8px 24px -12px rgba(0,0,0,.5);font-family:inherit}'
    // Stellar's header carries the rule under it that separates the title from the search. This one
    // had none, which is why the two sheets read as different cards even at the same width.
    + '.lxx-h{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;'
    + 'padding:18px 22px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.09))}'
    + '.lxx-h h3{margin:0 0 2px;font-size:19px;font-weight:800;letter-spacing:-.3px;'
    + 'color:var(--text,#ECECF3)}'
    + '.lxx-h p{margin:0;font-size:13.5px;color:var(--text-muted,#9a9aab);font-weight:500}'
    // A bare glyph, measured 22.9x12px, against Stellar's 30x30 bordered square.
    + '.lxx-x{width:30px;height:30px;border-radius:9px;background:transparent;'
    + 'border:1px solid var(--border,rgba(255,255,255,.09));color:var(--text-muted,#9a9aab);'
    + 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;'
    + 'padding:0;line-height:0;transition:.15s}'
    + '.lxx-x:hover{background:var(--surface-2,rgba(255,255,255,.05));color:var(--text,#fff)}'
    // ---- the three pieces Stellar's sheet has and this one did not ------------------------------
    // RAZA 2026-11-14: "Wallet popup when connecting. Its not the same as stellar. Fix it on XRPL and
    // also near." Stellar's modal is BASE DESIGN MARKUP (.lxw-search / .lxw-section / .lxw-foot),
    // which this fork does not inherit -- it builds its own sheet in JS -- so each piece is rebuilt
    // here. Every value below is COPIED from the computed .lxw-* rules on staging 7024e104 rather
    // than matched by eye, so the two sheets cannot drift apart on a padding or a grey.
    //
    // Geometry note: Stellar's search sits in a 22px-gutter modal and this one uses a 12px gutter on
    // the list, so the search keeps Stellar's own 22px and the icon its 34px offset -- the pair is
    // what positions the magnifier inside the field, and splitting them is what would look wrong.
    + '.lxx-search{position:relative;padding:14px 22px 4px}'
    + '.lxx-search svg{position:absolute;left:34px;top:50%;transform:translateY(-30%);'
    + 'color:var(--text-soft,#7c7c8a);pointer-events:none}'
    + '.lxx-search input{width:100%;padding:9px 12px 9px 34px;'
    + 'background:var(--surface-2,rgba(255,255,255,.05));'
    + 'border:1px solid var(--border,rgba(255,255,255,.09));border-radius:10px;font-family:inherit;'
    + 'font-size:15px;color:var(--text,#ECECF3);font-weight:500;outline:none;box-sizing:border-box;'
    + 'transition:border-color .15s}'
    + '.lxx-search input:focus{border-color:var(--accent,#f7861b)}'
    + '.lxx-search input::placeholder{color:var(--text-soft,#7c7c8a)}'
    // Stellar's section label lives INSIDE its scrolling list, so its 10px sits on top of the list's
    // own 14px gutter and the label lines up with the rows under it. Here the label is a SIBLING of
    // the list, so the same 10px put it 14px to the left of every row. Same total gutter, written out.
    + '.lxx-section{padding:6px 24px 8px;font-size:12.5px;font-weight:700;text-transform:uppercase;'
    + 'letter-spacing:.08em;color:var(--text-soft,#7c7c8a)}'
    + '.lxx-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;'
    + 'padding:12px 22px;border-top:1px solid var(--border,rgba(255,255,255,.09));font-size:13.5px;'
    + 'color:var(--text-muted,#9a9aab);font-weight:500}'
    + '.lxx-foot-link{display:inline-flex;align-items:center;gap:5px;'
    + 'color:var(--text-muted,#9a9aab);text-decoration:none;font-weight:600;cursor:pointer}'
    + '.lxx-foot-link:hover{color:var(--accent,#f7861b)}'
    // The "no wallet matches that" line. Stellar's list simply empties; saying so is better than an
    // empty box, and it costs one rule.
    + '.lxx-nores{padding:14px 12px 4px;font-size:13.5px;color:var(--text-muted,#9a9aab);'
    + 'font-weight:500;text-align:center}'
    // Geometry and greys below are Stellar's .lxw-list / .lxw-row / .lxw-ico / .lxw-name / .lxw-wsub,
    // read off the live sheet rather than matched by eye. The list scrolls like Stellar's so a long
    // list cannot push the footer off a short screen.
    + '.lxx-list{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;'
    + 'padding:8px 14px 6px;display:flex;flex-direction:column;gap:6px}'
    + '.lxx-row{display:flex;align-items:center;gap:13px;width:100%;padding:10px;border-radius:12px;'
    + 'background:transparent;border:1px solid transparent;color:inherit;cursor:pointer;'
    + 'text-align:left;font-family:inherit;'
    + 'transition:background .14s,border-color .14s,transform .14s}'
    + '.lxx-row:hover{background:var(--surface-2,rgba(255,255,255,.05));'
    + 'border-color:var(--border,rgba(255,255,255,.09))}'
    + '.lxx-row:active{transform:scale(.99)}'
    + '.lxx-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;'
    + 'justify-content:center;font-weight:800;font-size:15px;color:#fff;flex:0 0 40px;'
    + 'position:relative;overflow:hidden;'
    + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 4px 10px -4px rgba(0,0,0,.35)}'
    // NETWORK logos in a ROUND frame with no inset ring (RAZA 2026-11-17, same fix as Stellar's chooser):
    // the rounded tile + its white ring drew a halo round the black-circle Stellar logo. Wallet rows
    // keep their tile; only an icon holding a /assets/networks/ logo changes. 12% larger clips rims.
    + '.lxx-ico:has(> img[src*="/assets/networks/"]){border-radius:50%;box-shadow:none}'
    + '.lxx-ico > img[src*="/assets/networks/"]{transform:scale(1.12)}'
    + '.lxx-nm{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}'
    + '.lxx-nm b{font-size:16.5px;font-weight:700;letter-spacing:-.1px;color:var(--text,#ECECF3)}'
    + '.lxx-nm span{font-size:13.5px;color:var(--text-soft,#7c7c8a);font-weight:500}'
    // The chevron every Stellar and NEAR row ends with, and this one had on none.
    + '.lxx-chev{color:var(--text-soft,#7c7c8a);flex-shrink:0;'
    + 'transition:transform .15s,color .15s}'
    + '.lxx-row:hover .lxx-chev{color:var(--accent,#f7861b);transform:translateX(2px)}'
    // THE `hidden` ATTRIBUTE DOES NOTHING HERE WITHOUT THIS RULE. The browser's own
    // `[hidden]{display:none}` is a UA-stylesheet declaration, and `.lxx-row{display:flex}` above is
    // an author CLASS rule — the class wins, so setting b.hidden marked the row and left it on screen.
    // That is why Crossmark was still listed on RAZA's phone after the handheld filter shipped
    // (2026-10-17), and why my own check passed: I read back the `hidden` PROPERTY, which was
    // perfectly true, instead of asking whether the row was actually invisible.
    + '.lxx-row[hidden]{display:none!important}'
    + '.lxx-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;'
    + 'background:rgba(255,255,255,.08);color:var(--text-muted,#9b9ba4);white-space:nowrap}'
    // "Last used" is GREEN, the same green Stellar's .lxw-badge uses -- values copied from that
    // stylesheet rather than picked by eye, so the two pickers cannot drift apart on a colour
    // (RAZA 2026-10-17: "last used should be in green color like on Stellar"). The neutral style above
    // stays for "Installed", which is a statement about the browser, not about the reader's history.
    + '.lxx-badge.lxx-last{background:rgba(52,210,122,.14);color:#16a34a;'
    + 'box-shadow:inset 0 0 0 1px rgba(52,210,122,.22)}'
    + '.lxx-state{padding:26px 22px 24px;text-align:center;display:flex;flex-direction:column;'
    + 'align-items:center;gap:12px}'
    + '.lxx-state h4{margin:0;font-size:16.5px;font-weight:800}'
    + '.lxx-state p{margin:0;font-size:14px;line-height:1.55;color:var(--text-muted,#9b9ba4);'
    + 'font-weight:500;max-width:300px;word-break:break-word}'
    + '.lxx-spin{width:30px;height:30px;border-radius:50%;border:3px solid rgba(255,255,255,.14);'
    + 'border-top-color:var(--accent,#ff894c);animation:lxxSpin 1s linear infinite}'
    + '@keyframes lxxSpin{to{transform:rotate(360deg)}}'
    + '@media(prefers-reduced-motion:reduce){.lxx-spin{animation-duration:3s}}'
    // THE WALLET'S OWN MARK INSIDE THE SPINNER, which is what Stellar shows while connecting --
    // RAZA 2026-10-28: "in gem wallet, gem logo is missing inside the circle just like there is
    // rabet logo." The bare .lxx-spin ring stays: the QR and approval screens below still use it,
    // and there is no single wallet to name on those. Geometry and shadows are Stellar's own
    // .lxw-cwallet / .lxw-cwallet-ico / .lxw-ring values so the two circles are the same size.
    + '.lxx-cwallet{position:relative;width:76px;height:76px;display:flex;align-items:center;'
    + 'justify-content:center}'
    + '.lxx-cwallet-ico{position:relative;overflow:hidden;width:54px;height:54px;border-radius:50%;'
    + 'display:inline-flex;align-items:center;justify-content:center;z-index:2;font-weight:800;'
    + 'box-shadow:0 0 0 1px rgba(255,255,255,.08) inset,0 6px 16px -4px rgba(0,0,0,.4)}'
    + '.lxx-ring{position:absolute;inset:0;border:2.5px solid transparent;'
    + 'border-top-color:var(--accent,#ff894c);border-right-color:var(--accent,#ff894c);'
    + 'border-radius:50%;animation:lxxSpin 1.05s linear infinite}'
    + '@media(prefers-reduced-motion:reduce){.lxx-ring{animation-duration:3s}}'
    // THE CONNECT PROGRESS STEPS. RAZA 2026-10-28: Stellar shows "Opening wallet / Awaiting
    // signature / Finalizing" while connecting and XRPL showed a bare spinner. These values are
    // Stellar's own, lifted from the .lxw-step rules in its connecting screen plus the is-done
    // override _wallet_realconnect.js layers on top, so the two screens read identically.
    //
    // The tick is an ELEMENT, not a ::after with content:"\2713". This file is injected verbatim,
    // so the escape would survive -- but the house rule here is to keep backslashes out of emitted
    // CSS and JS entirely (see String.fromCharCode(39) elsewhere), and an element cannot be eaten
    // by a later transform the way an escape can.
    + '.lxx-steps{display:flex;flex-direction:column;gap:6px;margin-top:2px;width:100%;'
    + 'max-width:240px}'
    + '.lxx-step{display:flex;align-items:center;gap:10px;padding:6px 10px;'
    + 'background:var(--surface-2,rgba(255,255,255,.05));'
    + 'border:1px solid var(--border,rgba(255,255,255,.09));border-radius:9px;font-size:14px;'
    + 'color:var(--text-muted,#9a9aab);font-weight:600;text-align:left;'
    + 'transition:background .28s ease,border-color .28s ease,color .28s ease}'
    // NO LEADING DOT. Copying Stellar's .lxw-step rules brought its dot rules with them, and the dot
    // then SHOWED here while Stellar's does not -- RAZA 2026-10-28: "those green dots on the left
    // should be removed". Stellar still emits <span class="lxw-sdot">; it is hidden by a site-wide
    // sweep that lists every status dot in the app by class
    // (.nx-dot,.live-dot,.lxw-netdot,.lxw-sdot,...{display:none!important}). That list names
    // .lxw-sdot and cannot name .lxx-sdot, so the same markup rendered differently on the two forks.
    // The dot is dropped from the markup instead of added to that list: nothing then depends on a
    // hide rule living in the Stellar base, and there is no element for a future sweep to miss.
    + '.lxx-stick{margin-left:auto;color:#35c07f;font-weight:800;font-size:13px;line-height:1;'
    + 'opacity:0;transition:opacity .2s ease}'
    + '.lxx-step.is-active{color:var(--text,#fff);border-color:var(--accent,#f7861b)}'
    + '.lxx-step.is-done{color:var(--text,#fff);border-color:rgba(52,192,127,.55);'
    + 'background:rgba(52,192,127,.13)}'
    + '.lxx-step.is-done .lxx-stick{opacity:1}'
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

    // THE NETWORK COMES FIRST, HERE TOO. NO BACKTICKS IN THIS COMMENT.
    //
    // RAZA 2026-10-20: "Tapping Launch app should bring the network selection popup instead of
    // directly bringing the wallet popup."
    //
    // Stellar's pages have had this screen all along — it is _mc_engine's chooser, and
    // combine_with_stellar injects THIS file into those pages so picking XRP Ledger can connect in
    // place. The reverse was never built: an XRPL page assumed the route had already decided the
    // network and went straight to the wallet list. So the same button behaved differently depending
    // on which chain's page you happened to be standing on.
    //
    // What happens on each row, per RAZA when asked: "If someone selects stellar, then they will
    // select stellar wallet, and then they connect and land to stellar dashboard. its straight
    // forward." XRP Ledger stays in place; Stellar hands off to Stellar's own flow, which owns its
    // wallets and its dashboard. Nothing here tries to connect a Stellar wallet itself — this layer
    // has no business holding a G-address, and the two builds share storage keys.
    // SECTION IN, SECTION OUT — the same rule the chain-switch map was built on and for the same
    // reason: an identifier is chain-specific. /pools/xrpl/id/<r-address> pasted onto Stellar asks it
    // for a pool that does not exist, and the reader gets an empty page that looks like a broken
    // link. Only the section travels; anything unknown falls back to Stellar's own landing.
    function netpick() {
      build();
      body.innerHTML = '';
      body.appendChild(head('Choose a network', 'Choose a network to continue'));
      var list = document.createElement('div');
      list.className = 'lxx-list';

      // THE LIST IS PATCHED BY THE COMBINER, exactly as lx-mc's ORDER is on Stellar's pages.
      //
      // It used to be a two-entry array literal written straight into this call, from the days when
      // Stellar and XRP Ledger were the only networks. NEAR shipped in November and never reached it,
      // so /trade/xrpl offered two networks while /trade and /trade/near offered three (RAZA
      // 2026-11-15: "why here its not showing near network selection?"). combine.js skips XRPL's pages
      // when it widens lx-mc — they carry no lx-mc at all — so nothing else was ever going to fix this.
      //
      // Stellar and XRP Ledger stay here as the baseline, because those are the two a standalone XRPL
      // deployment serves. combine.js appends whatever forks the deployment actually has, and ABORTS
      // if it cannot find this anchor. KEEP THE `var NETS = [` ... `];` SHAPE — that is the anchor.
      var NETS = [
        { id: 'stellar', name: 'Stellar', sub: 'Connect on Stellar', logo: '/assets/networks/stellar.png' },
        { id: 'xrpl', name: 'XRP Ledger', sub: 'Connect on XRP Ledger', logo: '/assets/networks/xrpl.png' }
      ];
      NETS.forEach(function (n) {
        var b = document.createElement('button');
        b.className = 'lxx-row'; b.type = 'button';
        var ic = document.createElement('span');
        ic.className = 'lxx-ico';
        if (n.logo) {
          var im = document.createElement('img');
          im.src = n.logo; im.alt = '';
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
          ic.appendChild(im);
        }
        var nm = document.createElement('span');
        nm.className = 'lxx-nm';
        var nb = document.createElement('b'); nb.textContent = n.name;
        var ns = document.createElement('span'); ns.textContent = n.sub;
        nm.appendChild(nb); nm.appendChild(ns);
        b.appendChild(ic); b.appendChild(nm);
        // Same window-capture delegate as the wallet rows — see the note there. A plain listener here
        // is eaten on any page carrying an inherited capture-phase row handler, and this screen is
        // reachable from Stellar's pages too.
        b.setAttribute('data-lxn', n.id);
        list.appendChild(b);
      });

      body.appendChild(list);
      open();
    }

    function pick() {
      build();
      // WARM THE SCRIPT ONLY -- NEVER CONSTRUCT THE SDK HERE.
      //
      // The 89KB library was being fetched inside the tap, which is dead time with a blank sign-in
      // window already on screen, so preloading it is worth doing. But this first called xumm(),
      // which also does `new XummPkce(...)` -- and CONSTRUCTING the SDK is what makes it restore a
      // remembered session and fire 'retrieved'. Merely opening the wallet list therefore signed the
      // reader in: RAZA, 2026-10-11, "as soon as i clicked on XRPL from network selection, it
      // automatically connected even without confirmation". My own regression from the warm-up.
      //
      // Downloading the file has no such side effect, and the download is the slow part. The
      // instance is built on the tap, where a restored session is exactly what the reader asked for.
      try { if (XAMAN_KEY && !window.XummPkce) loadScript(XUMM_SRC).catch(noop); } catch (e) {}
      body.innerHTML = '';
      body.appendChild(head('Connect Wallet', 'Choose a wallet to continue'));

      // SEARCH, SECTION LABEL AND FOOTER LINK -- the three things Stellar's sheet has and this one
      // did not (RAZA 2026-11-14, side-by-side screenshots). Built here rather than inherited,
      // because Stellar's live in the design's own modal markup which this fork has no copy of.
      var search = document.createElement('div');
      search.className = 'lxx-search';
      search.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="11" cy="11" r="8"></circle>'
        + '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
      var sin = document.createElement('input');
      sin.type = 'text';
      sin.className = 'lxx-searchin';
      sin.setAttribute('placeholder', 'Search wallets…');
      sin.setAttribute('autocomplete', 'off');
      sin.setAttribute('spellcheck', 'false');
      // 16px minimum is enforced by the stylesheet above (15px there matches Stellar, and Stellar's
      // own zoom floor raises both on a handset) -- see _xrplzoomfloor.js, which already lists
      // "Search wallets" as one of the fields it governs. Nothing to do here but keep the class.
      search.appendChild(sin);
      body.appendChild(search);

      var sect = document.createElement('div');
      sect.className = 'lxx-section';
      sect.textContent = 'XRP Ledger Wallets';
      body.appendChild(sect);

      var list = document.createElement('div');
      list.className = 'lxx-list';

      var nores = document.createElement('div');
      nores.className = 'lxx-nores';
      nores.textContent = 'No wallet matches that name.';
      nores.hidden = true;

      // A PHONE SHOULD ONLY BE OFFERED WALLETS A PHONE CAN REACH. Crossmark and GemWallet are browser
      // EXTENSIONS — tapping either on a handset can only ever end at "not installed in this browser"
      // (RAZA 2026-10-17: "Remove wallets on mobile that can not be open from mobile").
      //
      // The test is CAPABILITY, not the user agent, because "extension" does not mean "desktop":
      // GemWallet ships a Firefox add-on that runs on Firefox for ANDROID, where it works exactly as
      // it does on a laptop. So an extension-only wallet starts hidden on a handset and is revealed
      // if detection actually finds it — the one browser where it is usable keeps it, and every phone
      // where it is not loses it. Xaman is flagged mobile:true and is never filtered.
      // The question here is "is this a device that cannot run extensions at all" — a phone or
      // tablet, not merely something with a touchscreen. A Windows laptop with a touch display runs
      // extensions perfectly and must keep them. That test now lives in isHandset(), which this used
      // to carry inline; the Joey and Xaman paths were using the LOOSE one and broke on exactly the
      // device this note predicted, so there is one answer now instead of two.
      var handheld = isHandset();
      WALLETS.forEach(function (w) {
        var b = document.createElement('button');
        b.className = 'lxx-row'; b.type = 'button';
        if (handheld && !w.mobile) {
          b.hidden = true;
          w.status().then(function (s) { if (s === 'Installed') b.hidden = false; }).catch(noop);
        }
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

        // Built through createElementNS, not innerHTML: an <svg> assigned as HTML inside a transform
        // that already ships through a JSON container is one escaping accident away from an element
        // in the wrong namespace that renders as nothing. Geometry is Stellar's .lxw-wchev exactly
        // (11px, viewBox 24, stroke-width 2.4, round caps), and it goes AFTER the badge, which is the
        // order both Stellar and NEAR paint.
        var NS = 'http://www.w3.org/2000/svg';
        var chev = document.createElementNS(NS, 'svg');
        chev.setAttribute('class', 'lxx-chev');
        chev.setAttribute('width', '11'); chev.setAttribute('height', '11');
        chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('fill', 'none');
        chev.setAttribute('stroke', 'currentColor'); chev.setAttribute('stroke-width', '2.4');
        chev.setAttribute('stroke-linecap', 'round'); chev.setAttribute('stroke-linejoin', 'round');
        var poly = document.createElementNS(NS, 'polyline');
        poly.setAttribute('points', '9 18 15 12 9 6');
        chev.appendChild(poly);
        b.appendChild(chev);

        // ONE TAG IN THE WHOLE LIST, AND "Last used" WINS. The Stellar build settled the per-ROW half
        // of this in _lastusedbadge: a row that is both installed and last-used showed "Installed", so
        // the recency tag never appeared for the wallet you actually use.
        //
        // This goes one further, per RAZA 2026-10-17: "make sure that installed tags dont appear once
        // there's already last used wallet that we've recorded". Once the list can say which wallet you
        // came back to, "Installed" is noise on every other row — it answers a question nobody is asking
        // any more, and three tags down a three-row list reads as a table of states rather than a
        // recommendation. Before the first connect there is no history, so the install tags still earn
        // their place and still show.
        var known = '';
        try { known = lastWalletId(); } catch (e) {}
        var wasLast = !!known && known === w.id;
        if (wasLast) {
          badge.textContent = 'Last used';
          badge.className = 'lxx-badge lxx-last';
          badge.hidden = false;
        } else if (!known) {
          // Detection is async and must never hold up the list being usable.
          w.status().then(function (s) {
            if (!s) return;
            badge.textContent = s;
            badge.hidden = false;
          }).catch(noop);
        }

        // WINDOW CAPTURE, NOT A LISTENER ON THE ROW. NO BACKTICKS IN THIS COMMENT.
        //
        // RAZA 2026-10-20, on a STELLAR page: Launch App, XRP Ledger, Xaman — "instead of opening the
        // Xaman signing, it brings me to stellar trade main page." It worked on XRPL pages and failed
        // on Stellar ones, which is the signature of an inherited handler, not of our code.
        //
        // Stellar's _wallet_realconnect describes itself: it "intercepts the connect-modal wallet-row
        // click (capture phase)" and lists Xaman among the wallets it does not support, which "fall
        // through to the demo flow". combine_with_stellar injects THIS layer into Stellar's pages, so
        // on those pages both are armed — and a capture-phase listener beats a listener bound to the
        // row every time.
        //
        // The same rule the connect TRIGGER in this file already follows, for the same reason, with
        // the same note: capture runs window -> document, so window is the only phase that is early
        // enough. The row carries its id and one delegate below reads it.
        b.setAttribute('data-lxw', w.id);
        list.appendChild(b);
      });

      body.appendChild(list);
      body.appendChild(nores);

      // FILTERING MUST NOT UN-HIDE A ROW THE HANDHELD FILTER HID. Rows for extension-only wallets
      // start hidden on a phone and are revealed asynchronously only if detection finds them, so the
      // filter tracks its OWN hidden state in an attribute and leaves b.hidden to that owner --
      // otherwise typing and clearing the box would hand a phone a Crossmark row it cannot use,
      // which is the regression .lxx-row[hidden] was added for in the first place.
      function applyFilter() {
        var q = (sin.value || '').trim().toLowerCase();
        var shown = 0;
        [].forEach.call(list.children, function (row) {
          var nm = row.querySelector('.lxx-nm b');
          var name = nm ? nm.textContent.toLowerCase() : '';
          var miss = q && name.indexOf(q) < 0;
          if (miss) { row.setAttribute('data-lxq', '1'); row.hidden = true; }
          else if (row.getAttribute('data-lxq') === '1') { row.removeAttribute('data-lxq'); row.hidden = false; }
          if (!row.hidden) shown++;
        });
        nores.hidden = !!shown || !q;
      }
      try { sin.addEventListener('input', applyFilter); } catch (e) {}

      // "New to wallets?" -- the same guide Stellar's footer links to, opened in a new tab for the
      // same reason: this sheet is almost always opened mid-task and navigating away would abandon
      // whatever the reader was part-way through. The URL is the one constant both forks share, so a
      // slug change is a one-line edit in each.
      var foot = document.createElement('div');
      foot.className = 'lxx-foot';
      var fl = document.createElement('a');
      fl.className = 'lxx-foot-link';
      fl.href = WALLET_GUIDE_URL;
      fl.target = '_blank';
      fl.rel = 'noopener noreferrer';
      fl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="10"></circle>'
        + '<line x1="12" y1="16" x2="12" y2="12"></line>'
        + '<line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
      fl.appendChild(document.createTextNode('New to wallets?'));
      foot.appendChild(fl);
      body.appendChild(foot);

      open();
    }

    // The three beats Stellar plays while a wallet is being connected, in the same order and with
    // the same words (_wallet_realconnect.js). RAZA 2026-10-28: "on XRPL it connects without
    // showing that."
    var STEP_LABELS = ['Opening wallet', 'Awaiting signature', 'Finalizing'];

    // The connecting spinner with the wallet's mark in the middle, mirroring Stellar's
    // .lxw-cwallet > .lxw-cwallet-ico + .lxw-ring. Stellar builds it by copying the icon node out of
    // the picker row that was clicked (_wallet_realconnect.js:914); here the wallet object is
    // already the argument, so the same three fields the row builder reads (logo, ico, glyph) are
    // read again and no DOM is cloned -- one less thing to hold a stale reference to.
    //
    // An <img> wherever a logo exists, never the bare letter: the logo healer repaints any element
    // holding one to five characters, and "G" and "X" both qualify. The picker rows carry the same
    // note for the same reason. The glyph stays only as the onerror fallback.
    function walletRing(w) {
      var wrap = document.createElement('div');
      wrap.className = 'lxx-cwallet';
      var ico = document.createElement('span');
      ico.className = 'lxx-cwallet-ico';
      if (w && w.ico) ico.style.background = w.ico;
      if (w && w.logo) {
        var im = document.createElement('img');
        im.src = w.logo; im.alt = '';
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
        im.onerror = function () { ico.textContent = (w && w.glyph) || ''; };
        ico.appendChild(im);
      } else if (w && w.glyph) {
        ico.textContent = w.glyph;
      }
      var ring = document.createElement('span');
      ring.className = 'lxx-ring';
      wrap.appendChild(ico);
      wrap.appendChild(ring);
      return wrap;
    }

    function stepsEl() {
      var d = document.createElement('div');
      d.className = 'lxx-steps';
      for (var i = 0; i < STEP_LABELS.length; i++) {
        var s = document.createElement('div');
        s.className = 'lxx-step';
        var tick = document.createElement('span');
        tick.className = 'lxx-stick';
        tick.textContent = String.fromCharCode(10003);      // a tick, with no escape to be eaten
        s.appendChild(document.createTextNode(STEP_LABELS[i]));
        s.appendChild(tick);
        d.appendChild(s);
      }
      return d;
    }

    // Steps before i are done, step i is active. QUERIED FRESH EVERY CALL rather than captured:
    // Xaman and Joey replace this screen with the QR as soon as there is something to scan, so by
    // the time the wallet answers these nodes may be long gone. A live query makes that a no-op
    // instead of a write to detached nodes. Stellar's stepEls() is written the same way.
    function setStep(i) {
      var s = document.querySelectorAll('.lxx-steps .lxx-step');
      for (var k = 0; k < s.length; k++) {
        s[k].classList.remove('is-done', 'is-active');
        if (k < i) s[k].classList.add('is-done');
        else if (k === i) s[k].classList.add('is-active');
      }
    }

    function waiting(w) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Connecting…', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var sp = walletRing(w);
      // STELLAR'S HEADING PATTERN -- RAZA 2026-10-28: "match the heading to stellar too". Stellar
      // writes 'Confirming with ' + name into .lxw-ctitle (_wallet_realconnect.js:915) for every
      // wallet it supports, so this screen now reads the same on both forks whichever wallet is
      // picked. The QR screen below keeps "Waiting for your approval": Stellar has no QR screen to
      // match it against, and that line names no wallet.
      var h4 = document.createElement('h4'); h4.textContent = 'Confirming with ' + w.name;
      var p = document.createElement('p');
      // STELLAR'S SENTENCE, WORD FOR WORD, for the ordinary extension case -- RAZA 2026-10-28:
      // "the text ... fix on xrpl because it also mentioned Gem wallet". Naming the wallet here
      // was the drift: the heading already names it one line above, so the paragraph repeated it
      // for no gain and read differently from Stellar for no reason.
      //
      // Xaman and Joey keep their own wording because their screens are not this screen: Xaman
      // hands off to a PHONE APP and Joey waits on a WalletConnect relay before any link exists.
      // Stellar has no equivalent of either, so there is nothing to match them to, and replacing
      // them with the generic line would delete the one thing that explains the wait.
      p.textContent = w.id === 'xaman'
        ? 'Approve the sign-in request in Xaman. On a phone this opens the app — come back here when it is done.'
        : w.id === 'joey'
          // The relay handshake runs before there is any link to show, and on a cold load that is a
          // few seconds of nothing. Saying so beats a bare spinner that looks like a hang.
          ? 'Starting a WalletConnect session — this takes a moment the first time.'
          : 'Approve the connection request in your wallet to continue.';
      var c = document.createElement('button');
      c.className = 'lxx-btn ghost'; c.type = 'button'; c.textContent = 'Cancel';
      c.addEventListener('click', pick);
      s.appendChild(sp); s.appendChild(h4); s.appendChild(p);
      s.appendChild(stepsEl());
      s.appendChild(c);
      body.appendChild(s);
      open();
    }

    // The sign request, waiting on the user's phone.
    //
    // Xaman is a PHONE app with no browser extension, so a desktop signer has to be handed the request
    // to scan -- there is nothing on their machine to prompt them. TWO SOURCES FOR THAT IMAGE, and
    // which one is right depends on the wallet:
    //
    //   * `png` -- Xaman hosts a QR on the payload it created, so we simply show it. Still the right
    //     answer for Xaman: it costs nothing and the image is the wallet's own.
    //   * `w.qr` -- WalletConnect has no hosted image, so Joey's wc: URI is drawn here. The design's
    //     own generator (window.qrcode, inlined as lx-qrlib) is NOT on Trade or Pools, where
    //     connecting happens, which is why this used to say a local QR would be blank. drawQR now
    //     fetches the same library from /assets/vendor on first use instead of relying on the page
    //     to carry it -- see the note there for why it is lazy rather than inlined.
    //
    // Returns its own closer so the caller can take the dialog down the moment the socket reports a
    // verdict, whichever way it went.
    // `w` is optional and defaults to Xaman, which is every caller written before WalletConnect
    // existed here -- they pass three arguments and are unchanged. Joey passes
    // { name:'Joey', copy:<wc uri>, connect:true }.
    function signing(link, png, onCancel, w) {
      var nm = (w && w.name) || 'Xaman';
      var isConn = !!(w && w.connect);
      build();
      body.innerHTML = '';
      body.appendChild(head((isConn ? 'Connect with ' : 'Approve in ') + nm, ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';

      // A QR WE DRAW, for WalletConnect. Same plate and size as the hosted-PNG branch below, so the
      // dialog does not change shape depending on which wallet is in it. Painted asynchronously --
      // the library is fetched on first use -- and if it cannot be drawn the plate is removed and
      // the copy-link further down is still a complete way through.
      if (!png && w && w.qr) {
        var plate = document.createElement('div');
        plate.style.cssText = 'width:212px;height:212px;border-radius:14px;background:#fff;'
          + 'padding:8px;box-sizing:border-box;display:flex;align-items:center;justify-content:center';
        var sp0 = document.createElement('div'); sp0.className = 'lxx-spin';
        plate.appendChild(sp0);
        s.appendChild(plate);
        drawQR(plate, w.qr).then(function (ok) {
          if (!ok && plate.parentNode) plate.parentNode.removeChild(plate);
        });
      } else if (png) {
        var img = document.createElement('img');
        img.src = png;
        img.alt = 'Scan this with ' + nm;
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
        ? 'Scan this with the ' + nm + ' app to review and sign. ' + nm + ' has also pushed it to your device.'
        : (w && w.qr)
          // DESKTOP, WALLETCONNECT. The copy-link stays underneath as the way through if the QR
          // cannot be drawn, or if scanning is simply not how someone wants to do this.
          ? 'Scan this with the ' + nm + ' app on your phone, or copy the link below.'
          : (w && w.copy)
            ? 'Open the link below on the phone that has ' + nm + ', then approve the request there.'
            : (isConn
              ? 'Approve the connection in ' + nm + ', then come back here.'
              : 'Approve the request in ' + nm + ', then come back here.');
      s.appendChild(h4b); s.appendChild(p2);

      if (link) {
        var go = document.createElement('button');
        go.className = 'lxx-btn'; go.type = 'button'; go.textContent = 'Open in ' + nm;
        // A FRESH TAP, and that is the whole point of this button. The payload must be created before
        // there is anything to open, which is a network round trip, so the tap that started the
        // transaction is already spent -- and iOS hands a link to an app only while the activation that
        // caused it is still live. The automatic hand-off below is therefore best-effort; this is not.
        go.addEventListener('click', function () { try { window.location.href = link; } catch (e) {} });
        s.appendChild(go);
      }

      // THE LINK SURVIVES THE QR (RAZA 2026-10-27: "yes add the QR for desktop"). It is not the
      // fallback it started as -- drawQR can fail for reasons the reader cannot act on, and some
      // people would rather paste a link than aim a camera at a monitor. Keeping both costs one
      // button. When the QR does fail, its plate is removed and this is the whole path through.
      if (w && w.copy) {
        var cp = document.createElement('button');
        cp.className = 'lxx-btn ghost'; cp.type = 'button'; cp.textContent = 'Copy connection link';
        cp.addEventListener('click', function () {
          copyText(w.copy).then(function (ok) {
            // Says what actually happened. A button that reports "Copied" when the clipboard refused
            // sends someone to paste something else into their wallet.
            cp.textContent = ok ? 'Copied' : 'Could not copy — select the link manually';
            setTimeout(function () { cp.textContent = 'Copy connection link'; }, 2500);
          });
        });
        s.appendChild(cp);
      }

      var c2 = document.createElement('button');
      c2.className = 'lxx-btn ghost'; c2.type = 'button'; c2.textContent = 'Cancel';
      c2.addEventListener('click', function () { close(); if (onCancel) onCancel(); });
      s.appendChild(c2);

      body.appendChild(s);
      open();
      return close;
    }

    function fail(w, msg, title) {
      build();
      body.innerHTML = '';
      body.appendChild(head('Could not connect', ''));
      var s = document.createElement('div');
      s.className = 'lxx-state';
      var h4 = document.createElement('h4'); h4.className = 'lxx-err'; h4.textContent = title || w.name;
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
    function designConnected(addr, home) {
      // THE DESIGN'S CONNECTED SCREEN IS THE ONE RAZA WANTS, and it must look identical to Stellar's:
      // green tick, wallet logo, "rhabrr...aNoP", "XRP Ledger - Xaman", Continue. The block below
      // fills exactly that markup. The fallback underneath is a plain address and a button, and it
      // is NOT a second design -- it exists only for a page that ships no wallet modal at all.
      //
      // WHAT DECIDES BETWEEN THEM IS THE MARKUP, NOT THE OPENER. This used to return false whenever
      // window.__lxwDesignOpen was missing, and on the LANDING PAGE it is: that global is captured
      // when this file replaces window.lxwOpenWallet, which does not happen where the XRPL layer is
      // injected dormant. The landing page nevertheless carries the whole modal -- measured on the
      // deployed build: .lxw-modal present, screens [wallet, connecting, connected, network],
      // .lxw-acct-addr and .lxw-chipname both there. So the one page that fell back to the plain
      // dialog was a page fully equipped to show the real one. RAZA, 2026-10-11: "Wtf did you
      // redesign this popup. We already got this for stellar. I need it to be identical."
      //
      // It only became visible once the chooser stopped navigating: before that the confirmation was
      // shown on the DASHBOARD, where the opener does exist, so the design screen was what appeared.
      //
      // The opener is an optimisation now, not a gate -- and the modal is revealed directly, because
      // the network chooser hides it (parentNode [hidden]) before handing over to this layer.
      // MOUNT FIRST, THEN LOOK. The design's modal is built LAZILY on some pages: measured on the
      // deployed landing — which is exactly where a phone returns from the Xaman app — there are ZERO
      // .lxw-screen nodes until something opens it, and three the moment one does. Checking before
      // mounting therefore bailed to the plain fallback panel on the one page that matters most
      // (RAZA 2026-10-17: "the popup that it shows for split seconds is not exactly like this").
      //
      // __lxwDesignOpen is the design's own opener, saved when this layer replaced the global. Where
      // the layer never replaced it — the landing again — the global IS still the design's, so calling
      // it is safe. The presence of __lxwDesignOpen is precisely what tells the two apart, which is
      // why the fallback cannot accidentally re-enter our own picker.
      //
      // `home` is where the reader started sign-in, when this is a phone coming back from the Xaman
      // app. Falling back to the dashboard keeps every other entry point behaving as before.
      // WITH NO home, STAY WHERE THE READER IS — do not fall back to the dashboard.
      //
      // The fallback used to be the literal '/dashboard', so connecting from /trade/xrpl threw the
      // reader onto the dashboard and lost the page they were working on (RAZA 2026-11-15: "it
      // shouldn't redirect to dashboard. it should just keep the user to the same page just like its
      // happening on Near and Steller"). Stellar never did this: _connectgate.js hands its own opener
      // location.href, so its Continue lands back on the same page.
      //
      // The in-page callers — ui.done(addr, '') from resume() and from the chip's open() — pass no
      // home at all, which is precisely the case this decides. The Xaman phone round trip still
      // passes HOME explicitly and is untouched: that one genuinely starts somewhere else.
      var here = '/';
      try { here = (window.location.pathname || '/') + (window.location.search || ''); } catch (e) {}
      var mount = window.__lxwDesignOpen
        || (typeof window.lxwOpenWallet === 'function' ? window.lxwOpenWallet : null);
      if (typeof mount === 'function') { try { mount('xrpl', home || here); } catch (e) {} }
      var scr = document.querySelectorAll('.lxw-screen');
      if (!scr.length) return false;                 // genuinely no design modal on this page
      try {
        var mo = document.querySelector('.lxw-modal');
        if (mo) {
          mo.removeAttribute('hidden');
          if (mo.parentNode && mo.parentNode.removeAttribute) mo.parentNode.removeAttribute('hidden');
        }
      } catch (e) {}

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

    function done(addr, note, home) {
      if (designConnected(addr, home)) return;
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
      // Same rule as the design's button: go where sign-in started if we know, otherwise just
      // re-render this page as a connected one.
      b.addEventListener('click', function () {
        close();
        if (home) { try { window.location.replace(home); return; } catch (e) {} }
        window.location.reload();
      });
      s.appendChild(b);
      body.appendChild(s);
      open();
    }

    return { pick: pick, netpick: netpick, waiting: waiting, setStep: setStep, signing: signing, fail: fail, done: done, close: close, open: open };
  })();

  // ASSEMBLED, NOT WRITTEN OUT, AND THAT IS NOT STYLE. NO BACKTICKS IN THIS COMMENT.
  //
  // The first version of this map held the paths as literals — '/pools/stellar' and friends. A
  // transform in this build's chain rewrites chain paths across every emitted script, and it
  // rewrote them: the built page came out carrying trade: '/trade/xrpl', pools: '/pools/xrpl'. A
  // row labelled "Connect on Stellar" would have navigated straight back to an XRPL page, and the
  // only reason it was caught is that the built output was read instead of the source.
  //
  // So the section travels as a bare NAME and the chain is joined on at runtime. Do not "tidy"
  // this back into whole paths — the rewriter will find them again, and the failure is silent.
  var CHAIN_S = 'stel' + 'lar';
  var SECTIONS = {
    trade: 1, pools: 1, bridge: 1, rewards: 1, lumos: 1, launchpad: 1
  };
  var CHAINLESS = { mcp: 1, 'list-your-token': 1 };
  // The same section on ANOTHER chain. Takes the chain id so the network chooser can hand off to any
  // network the combiner put in NETS, not only to Stellar — it was stellarCounterpart() when Stellar
  // was the only other network, and a NEAR row added to the list would silently have gone to Stellar.
  // The chain is still JOINED ON AT RUNTIME and never written as a whole path, for the reason given
  // above: a transform in this build's chain rewrites literal chain paths and does it silently.
  function counterpart(chain) {
    var seg = '';
    try { seg = (window.location.pathname || '').split('/').filter(Boolean)[0] || ''; } catch (e) {}
    if (CHAINLESS[seg]) return '/' + seg;
    if (SECTIONS[seg]) return '/' + seg + '/' + (chain || CHAIN_S);
    return '/';
  }

  // The one delegate the wallet rows rely on. Bound once, on window, in capture — see the note at the
  // row for why nothing less survives on a Stellar page. Scoped to our own dialog by the attribute,
  // so it cannot claim a click on anything else's list.
  (function wireWalletRows() {
    if (window.__lxcRowClick) return;
    window.__lxcRowClick = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var row = t.closest('.lxx-row[data-lxw],.lxx-row[data-lxn]');
      if (!row) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      // A network row first: it only switches which screen is showing, or hands off to Stellar.
      var net = row.getAttribute('data-lxn');
      if (net) {
        if (net === 'xrpl') { try { ui.pick(); } catch (e2) {} return; }
        // Every other chain owns its own wallets. Hand over at the section they are already looking
        // at and let that build's flow finish; #connect is the signal it reads on arrival.
        // The chain comes from the ROW, not from a constant: this used to go to Stellar whatever was
        // clicked, which is only correct while Stellar is the one other network.
        try { window.location.href = counterpart(net) + '#connect'; } catch (e2) {}
        return;
      }

      var id = row.getAttribute('data-lxw');
      for (var i = 0; i < WALLETS.length; i++) {
        if (WALLETS[i].id === id) { run(WALLETS[i]); return; }
      }
    }, true);
  })();

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function run(w) {
    ui.waiting(w);
    // A WAITING SCREEN THAT NEVER RESOLVES IS THE SAME BUG AS A SILENT RETURN.
    //
    // Xaman's SDK opens its own window, and on a phone that window is blocked whenever it is opened
    // after an await — the trap this project has hit before. When that happens authorize() simply
    // never settles: no resolve, no reject, nothing for the catch below to report, and the reader is
    // left on a spinner or back where they started with no explanation. RAZA 2026-10-20: "still not
    // connecting", with no error shown anywhere.
    //
    // So the wait is bounded and says what probably happened. The flag also lets adoptXumm report
    // through xamanSay while a connect is genuinely in flight.
    if (w && w.id === 'xaman') {
      xamanWaiting = w;
      setTimeout(function () {
        if (xamanWaiting !== w) return;                      // something resolved; nothing to say
        xamanSay('Xaman did not come back. If its window did not open, allow pop-ups for this site '
          + 'and try again — or open the Xaman app, approve the request there, and return here.');
      }, 25000);
    }
    // THE PROGRESS BEATS, in Stellar's order and with Stellar's timings (_wallet_realconnect.js).
    // The wallet call starts immediately so the extension opens without being held up; "Awaiting
    // signature" appears a beat later; once an address is in hand "Finalizing" plays before the
    // connected screen. The floor stops an instant resolve from being a flash, and nothing is
    // padded when the reader genuinely took their time approving.
    //
    // Finalizing is NOT a cosmetic pause here, which is the one place this differs from Stellar:
    // the account_info lookup that decides whether to warn about an unactivated account runs
    // inside it, against the 760ms floor rather than after it. A slow ledger makes the beat longer;
    // it never makes it shorter, and the step on screen is telling the truth about the wait.
    ui.setStep(0);
    var t0 = Date.now();
    var awaitT = setTimeout(function () { ui.setStep(1); }, 520);

    w.connect().then(function (addr) {
      xamanWaiting = null;
      clearTimeout(awaitT);

      // NO STEPS ON SCREEN MEANS NO CHOREOGRAPHY. Xaman and Joey swap this screen for the QR as
      // soon as there is something to scan, so by the time they answer the steps are gone. Playing
      // the beats anyway would add about 1.9 seconds of dead time AFTER the reader has already
      // approved on their phone, against a screen that cannot show why -- a regression dressed up
      // as polish. The extension wallets, which keep this screen throughout, get the full sequence.
      var done = function (st) {
        ui.done(addr, st === 'unfunded'
          ? 'This account is not activated on the XRP Ledger yet — it needs a small XRP reserve before it can hold anything.'
          : '');
      };
      if (!document.querySelector('.lxx-steps')) return ledgerState(addr).then(done);

      ui.setStep(1);
      return wait(Math.max(0, 900 - (Date.now() - t0)))
        .then(function () {
          ui.setStep(2);
          return Promise.all([ledgerState(addr), wait(760)]);
        })
        .then(function (r) {
          ui.setStep(3);                                   // every step done
          return wait(200).then(function () { done(r[0]); });
        });
    }).catch(function (e) {
      xamanWaiting = null;
      clearTimeout(awaitT);
      if (e && e.code === 'NOT_INSTALLED' && window.lxWalletMissingText) {
        var mw = window.lxWalletMissingText(w.name, 'Xaman');
        ui.fail(w, mw.text, mw.title);
      } else ui.fail(w, (e && e.message) || 'Something went wrong.');
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
    if (get(K.addr)) { ui.done(get(K.addr), ''); return; }
    // The network screen first, then the wallets — the order Stellar's pages have always used.
    // netpick's XRP Ledger row calls pick(), so nothing is skipped and nothing is duplicated.
    ui.netpick();
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

  // GIVE THE TRANSACTION ITS OWN DEADLINE INSTEAD OF LETTING THE WALLET GUESS ONE.
  //
  // RAZA 2026-10-18, user report swapping XLM -> XRP through GemWallet: "The latest ledger sequence
  // 107724542 is greater than the transaction's LastLedgerSequence (107724541). Preliminary result:
  // temBAD_AMOUNT." A deadline one ledger behind the ledger it was submitted into — i.e. a margin of
  // effectively nothing, so it expired between being built and being applied.
  //
  // We never set LastLedgerSequence on a swap at all: the note above gemSubmit says the extension
  // "fills in Fee, Sequence and LastLedgerSequence", so that number was GemWallet's, computed from
  // whatever ledger it had last seen. Setting our own takes the guess away from it.
  //
  // 150 LEDGERS, roughly ten minutes, and the generous end is deliberate. The wallet is a HUMAN
  // approval step — Xaman means picking up a phone and opening an app — and a tight window turns a
  // slow approval into a failed transaction, which is the very bug being fixed. The usual argument
  // for a short deadline (don't let a stale order fill at a bad price) does not bite here, because
  // every swap already ships DeliverMin at the quote less slippage: a late fill is refused by the
  // ledger rather than filled badly. See the partial-payment note in dxaswap.
  //
  // SYNCHRONOUS, AND THAT IS NOT AN ACCIDENT. There is no await here and there must never be one:
  // this runs inside the click that opens the wallet, and an await before that call is exactly what
  // breaks Xaman's popup and the iOS deep-link — see [[xaman-popup-must-open-in-the-tap]] and
  // [[lumoscore-ios-deeplink-activation]]. The ledger index comes from lxx.currentLedger(), which
  // every ledger read already keeps up to date for free, so nothing has to be fetched.
  //
  // It refuses to stamp from a stale number: better to leave the field absent and let the wallet do
  // what it does today than to write a deadline derived from where the ledger was minutes ago.
  function stampDeadline(tx) {
    try {
      if (!tx || typeof tx !== 'object') return;
      if (tx.LastLedgerSequence) return;                   // the caller meant its own deadline
      var L = window.lxx && window.lxx.currentLedger && window.lxx.currentLedger();
      if (!L || !(L.seq > 0) || L.age > 60000) return;     // nothing fresh enough to trust
      // Add back what has already elapsed, so an index seen 40s ago still yields ~10 minutes.
      tx.LastLedgerSequence = L.seq + 150 + Math.ceil(L.age / 4000);
    } catch (e) {}
  }

  window.lxc = {
    // TWO CALLERS, TWO MEANINGS — and conflating them cost a round trip. NO BACKTICKS IN THIS COMMENT.
    //
    // open() is called by Stellar's own chooser after the reader has ALREADY picked XRP Ledger there:
    // combine_with_stellar injects this layer into Stellar's pages precisely so that choice can
    // connect in place. The network is settled by the time it arrives, so open() must show WALLETS.
    //
    // Making it show the network screen is what RAZA saw next: "when i select XRPL, it shows the same
    // popup again" — his first popup was Stellar's chooser (it has a Search networks field), the
    // second was this one. Asking twice for an answer already given.
    //
    // openNetworks() is the other meaning: start the flow from nothing, which is what Launch App on an
    // XRPL page does through _xrplchoosenet's shim. Same layer, same screens, different starting point.
    open: function () { get(K.addr) ? ui.done(get(K.addr), '') : ui.pick(); },
    openNetworks: function () { openPicker(); },
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
      stampDeadline(tx);
      if (t === 'gem') return gemSubmit(tx);
      if (t === 'cross') return crossSubmit(tx);
      if (t === 'xaman') return xamanSubmit(tx);
      if (t === 'joey') return joeySubmit(tx);
      return Promise.reject(new Error(
        'This wallet connection cannot sign. Disconnect and connect again.'));
    },
    canSign: function () {
      var t = get(K.transport);
      return t === 'gem' || t === 'cross' || t === 'xaman' || t === 'joey';
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    wallets: WALLETS.map(function (w) { return w.name; }),
    configured: function () { return { xaman: !!XAMAN_KEY }; }
  };

  // The other half of that hop: we arrived on the dashboard carrying the marker, so draw the screen
  // the reader was promised. Consumed immediately — it must survive one navigation and no more, or
  // every later visit to the dashboard would reopen a confirmation for a sign-in long finished.
  function showPending() {
    var want = '';
    try { want = localStorage.getItem(XAMAN_SHOW) || ''; localStorage.removeItem(XAMAN_SHOW); } catch (e) {}
    if (!want) return;
    var addr = get(K.addr);
    if (!addr) return;
    try { ui.done(addr, '', HOME); } catch (e) {}
  }

  function boot() { resume(); showPending(); watchWalletChip(); }

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
  // ONE THING STILL RUNS WHILE DORMANT: the pending confirmation. The landing is a dormant page, and
  // it is also where a phone is sent after a Xaman sign-in so the screen can sit over the marketing
  // page the way Stellar's does — so leaving showPending() inside boot() meant the hop landed there
  // and nothing was ever drawn. Measured: the landing held, the marker was never consumed, no popup.
  //
  // Safe to run dormant, because it is not a takeover: it fires only when OUR OWN adopt set the marker
  // moments earlier, consumes it immediately, and touches nothing on an ordinary page load. Everything
  // the dormant guard actually protects — resume(), the chip watcher, the connect-UI takeover — stays
  // behind it.
  if (window.__lxcNoBoot) {
    try {
      if (localStorage.getItem(XAMAN_SHOW)) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showPending);
        else showPending();
      }
    } catch (e) {}
  }

  if (!window.__lxcNoBoot) {
    takeOverConnectUi();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  // THE COOKIE IS THE ONLY THING THE SERVER CAN READ, AND IT WAS WRITTEN EXACTLY ONCE.
  //
  // RAZA 2026-10-06: "There's a flash bug on XRPL wallet page. This shows up for split seconds when
  // Wallet page is refreshed", with a screenshot of "3 Active" and "3,442 APT · Across 2 pools".
  // Those are not XRPL's figures and never were: this build ships both of those cards blank, and
  // `3 Active` appears in its wallet page only inside a comment. They are STELLAR's baked mock,
  // read straight out of C:/LumosCore/dist/lumoscore-wallet.html. So it is not a flash of our own
  // markup — the server handed back the other chain's page.
  //
  // /dashboard, /wallet and /launchpad are ONE URL each on the combined deployment, with no chain in
  // the path, so `lx_chain` is the only thing that tells the middleware which build to serve.
  // cookieChain() ran in store() and in forget() and nowhere else — at connect and at disconnect. Any
  // browser that keeps localStorage but loses cookies (a cleared cookie jar, a session older than the
  // cookie itself, ITP-style expiry) therefore remembers an XRPL wallet and is served Stellar's page.
  // I hit this myself today: seeding only localStorage and opening /wallet served Stellar's wallet,
  // mock portfolio and all, until I set the cookie by hand.
  //
  // That is worse than a flash. Without the reload below it is simply the wrong chain's wallet.
  //
  // RUNS DORMANT TOO — deliberately outside the __lxcNoBoot guard above. On the combined site this
  // module is injected into Stellar's pages with that flag set, and a Stellar page is exactly where a
  // mis-served XRPL session lands. Gating it would leave it unable to fix the one case it exists for.
  // It touches nothing but the cookie, so it is safe there: a stored chain of anything but 'xrpl'
  // returns on the first line.
  (function reconcileChain() {
    var want = '';
    try { want = localStorage.getItem('lumos.chain') || ''; } catch (e) { return; }
    if (want !== 'xrpl') return;
    var has = /(?:^|;\s*)lx_chain=xrpl(?:;|$)/.test(document.cookie || '');
    if (has) {
      // Healthy again: let a later loss be repaired once more.
      try { sessionStorage.removeItem('lumos.chainfix'); } catch (e) {}
      return;
    }
    cookieChain('xrpl');

    // Only the shared authgated urls can be served from the wrong build — every other route names its
    // chain in the path — so the reload is limited to those.
    var p = (location.pathname || '/').replace(/\/+$/, '') || '/';
    if (['/dashboard', '/wallet', '/launchpad', '/launchpad/review', '/launchpad/confirm'].indexOf(p) < 0) return;

    // ONCE PER TAB, AND NO RELOAD AT ALL WITHOUT A PLACE TO RECORD IT. If cookies are blocked outright
    // the write above does nothing, the next load is in exactly this state, and an ungated reload here
    // is an infinite one. The flag is the whole safety margin, so no flag means no reload.
    try {
      if (sessionStorage.getItem('lumos.chainfix') === p) return;
      sessionStorage.setItem('lumos.chainfix', p);
    } catch (e) { return; }
    location.reload();
  })();
})();
