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
    // The window went away without an answer. Almost always the gateway refusal below, because that
    // page is a dead end the user has to close by hand -- but it is also what cancelling looks like,
    // so the wording has to carry both without asserting either.
    if (/popup-closed/.test(m)) {
      return new Error('The Xaman sign-in window closed before it finished. If it showed "Invalid '
        + 'client/redirect URL", then ' + xamanRedirect() + ' is not a registered redirect '
        + 'address for this Xaman app — add it at apps.xaman.dev and try again.');
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

      [
        { id: 'stellar', name: 'Stellar', sub: 'Connect on Stellar', logo: '/assets/networks/stellar.png' },
        { id: 'xrpl', name: 'XRP Ledger', sub: 'Connect on XRP Ledger', logo: '/assets/networks/xrpl.png' }
      ].forEach(function (n) {
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
      var list = document.createElement('div');
      list.className = 'lxx-list';

      // A PHONE SHOULD ONLY BE OFFERED WALLETS A PHONE CAN REACH. Crossmark and GemWallet are browser
      // EXTENSIONS — tapping either on a handset can only ever end at "not installed in this browser"
      // (RAZA 2026-10-17: "Remove wallets on mobile that can not be open from mobile").
      //
      // The test is CAPABILITY, not the user agent, because "extension" does not mean "desktop":
      // GemWallet ships a Firefox add-on that runs on Firefox for ANDROID, where it works exactly as
      // it does on a laptop. So an extension-only wallet starts hidden on a handset and is revealed
      // if detection actually finds it — the one browser where it is usable keeps it, and every phone
      // where it is not loses it. Xaman is flagged mobile:true and is never filtered.
      // NOT isHandheld(). That one answers "does this device do taps", which is the right question
      // for a click handler and the wrong one here: it is true on any TOUCHSCREEN LAPTOP, and hiding
      // a browser extension from a Windows laptop with a touch display would remove a wallet that
      // works perfectly. Measured in the review pane, which reports coarse pointer at desktop size
      // and would have had it filtering the desktop list too.
      //
      // The question here is "is this a device that cannot run extensions at all", so: a phone or
      // tablet user agent, or a pointer that is coarse with no fine pointer anywhere. A touch laptop
      // has a mouse as well and fails the second test.
      var handheld = (function () {
        try { if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return true; } catch (e) {}
        try {
          return window.matchMedia('(pointer:coarse)').matches
            && !window.matchMedia('(any-pointer:fine)').matches;
        } catch (e) {}
        return false;
      })();
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
      var mount = window.__lxwDesignOpen
        || (typeof window.lxwOpenWallet === 'function' ? window.lxwOpenWallet : null);
      if (typeof mount === 'function') { try { mount('xrpl', home || '/dashboard'); } catch (e) {} }
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

    return { pick: pick, netpick: netpick, waiting: waiting, signing: signing, fail: fail, done: done, close: close, open: open };
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
  function stellarCounterpart() {
    var seg = '';
    try { seg = (window.location.pathname || '').split('/').filter(Boolean)[0] || ''; } catch (e) {}
    if (CHAINLESS[seg]) return '/' + seg;
    if (SECTIONS[seg]) return '/' + seg + '/' + CHAIN_S;
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
        // Stellar owns its own wallets. Hand over at the section they are already looking at and let
        // its flow finish on its dashboard; #connect is the signal its build reads on arrival.
        try { window.location.href = stellarCounterpart() + '#connect'; } catch (e2) {}
        return;
      }

      var id = row.getAttribute('data-lxw');
      for (var i = 0; i < WALLETS.length; i++) {
        if (WALLETS[i].id === id) { run(WALLETS[i]); return; }
      }
    }, true);
  })();

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
    w.connect().then(function (addr) {
      xamanWaiting = null;
      return ledgerState(addr).then(function (st) {
        ui.done(addr, st === 'unfunded'
          ? 'This account is not activated on the XRP Ledger yet — it needs a small XRP reserve before it can hold anything.'
          : '');
      });
    }).catch(function (e) {
      xamanWaiting = null;
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
      return Promise.reject(new Error(
        'This wallet connection cannot sign. Disconnect and connect again.'));
    },
    canSign: function () { var t = get(K.transport); return t === 'gem' || t === 'cross' || t === 'xaman'; },

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
