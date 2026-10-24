// Signed transactions: Receive QR, Send, and Cancel order.
//
// Everything else on this build READS the ledger. This is the first layer that asks the user's wallet
// to sign something, which changes what a bug costs: a read that goes wrong shows a wrong number, a
// write that goes wrong moves someone's money to the wrong place and cannot be undone.
//
// So the rules here are stricter than elsewhere in this project:
//
//   * NOTHING IS SUBMITTED THAT HAS NOT BEEN CHECKED AGAINST THE LEDGER FIRST. Every failure mode
//     below was chosen because the transaction would otherwise be signed by the user, succeed or fail
//     on-chain, and cost a real fee or real funds to learn what this code could have known for free.
//   * The design's own modals are used exactly as they ship. No new dialog, no new field, no new
//     page — the amount input, the recipient input, the asset button and the confirm button are all
//     the design's, and only their behaviour is added.
//   * Amounts are built from the ledger's own units (drops, issued-currency objects), never from the
//     formatted strings on screen.
//
// Signing goes through window.lxc.submit(tx), which refuses rather than guesses when the stored
// connection has no transport. That refusal is deliberate and is not worked around here.
(function () {
  if (window.__lxxWrite) return;
  window.__lxxWrite = 1;

  var RPC = 'https://xrplcluster.com/';
  var DROP = 1000000;
  // Substituted at build time by _tools/xrpladdr.js, which checksum-verifies it and refuses to build
  // if this placeholder is ever removed — shipping the literal string as a payment destination would
  // be a transaction that cannot be signed, or worse, one that can.
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  // MAX MUST NEVER ASK FOR MORE THAN THERE IS (RAZA 2026-10-24: "i selected MAX and its showing that i
  // dont have that much. but i selected max which is supposed to enter exactly how many i have").
  //
  // toFixed() ROUNDS, and rounding a balance can only ever round it UP past itself. Measured on his
  // own trust line the same day:
  //     ledger balance   19254190.1614216
  //     toFixed(6)       19254190.161422     <- larger than the balance
  // and doSwap() then refused with "19,254,190.161422 BRO is available" — quoting, as the amount
  // available, the very number it had just rejected. Two displays of one balance disagreeing by
  // 4e-7, which is invisible and completely blocking.
  //
  // Truncated as a STRING rather than by Math.floor(v*1e6)/1e6: these are issued-token balances with
  // up to 15 significant digits, and at nineteen million tokens the multiply is still exact but it is
  // not a property worth relying on — a holder with a larger balance would silently get a wrong
  // figure from the arithmetic and a correct one from the text. The exponential form cannot be sliced,
  // so it keeps the arithmetic path, which is only reachable at magnitudes where 6dp is already noise.
  //
  // Same family as the dust-fee bug: a rounding step between a checked value and the value actually
  // used is how a guard ends up refusing its own suggestion.
  function floorDp(v, dp) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 0;
    var s = String(n);
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
      var p = Math.pow(10, dp);
      return Math.floor(n * p) / p;
    }
    var dot = s.indexOf('.');
    if (dot < 0) return n;
    return Number(s.slice(0, dot + 1 + dp));
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // EVERY READ HAS A DEADLINE (RAZA 2026-09-17: a swap that "just stucks there"). Measured the same day: `ripple_path_find`
  // answers in 0.4s buying RLUSD and 28.4s selling it, and `fetch` will wait on a public node indefinitely — so one slow
  // answer left "Finding a route…" on screen with no error and no way forward.
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

  function rpc(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return lxpost(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (j) {
      clearTimeout(timer);
      var res = j && j.result;
      if (!res || res.error) {
        // THE LEDGER'S OWN ERROR CODE TRAVELS WITH THE ERROR, same contract as pooldetail.js.
        //
        // RAZA 2026-10-16, on the Send dialog refusing a good address: "Why is it not considering
        // this addres. Its correct". It was correct. The account simply did not exist yet, and
        // paying an unactivated account is how you create one on this ledger.
        //
        // This line threw `error_message` and nothing else, so preflight()'s guard —
        //     if (/actNotFound/i.test(e.message || '')) return null;   // unfunded, legal for XRP
        // — was testing a human sentence for a machine code. The ledger answers `actNotFound` with
        // the message "Account not found.", which does not contain the word it was looking for, so
        // the guard never once matched: the error rethrew and the dialog showed the raw sentence.
        //
        // EVERYTHING BELOW THAT GUARD WAS THEREFORE DEAD CODE. The reserve check, the "a first
        // payment must be at least N XRP" refusal and the "this activates a new account" warning
        // have never run, and no XRP has ever been sendable from this site to an address that was
        // not already funded. It looked like deliberate validation, which is why nobody doubted it.
        //
        // The message stays human because it is what gets displayed; the code is what gets matched.
        // Prose is the upstream's to reword, a code is a contract.
        var err = new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
        err.code = (res && res.error) || '';
        throw err;
      }
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw new Error((e && e.name === 'AbortError') ? 'The ledger did not answer in time — try again.'
        : ((e && e.message) || 'ledger unavailable'));
    });
  }

  // The logo layer claims any element holding one to five characters and empties it. data-logoed is
  // its own skip marker. Same helper as wallet.js, for the same reason.
  function plain(e, text) {
    try {
      e.removeAttribute('data-logo');
      e.style.background = '';
      e.style.backgroundImage = '';
      e.setAttribute('data-logoed', '1');
    } catch (_) {}
    e.textContent = text;
  }

  var XRP_THUMB = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  function thumbOf(a) {
    if (!a || !a.issuer) return XRP_THUMB;
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(a.currency || '') + '&w=48';
  }
  // Scanning is a phone action: on a desktop the camera points at the user. Same UA test the site already
  // uses to decide which page to serve.
  function isPhone() {
    try { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }

  // ---- Receive: Stellar's layout -------------------------------------------------------------------
  // RAZA 2026-09-15: "The receive popup is not same as on Stellar." lumoscore.com rebuilds this body as
  // .lx-rc — the QR on a white card with accent corners and the logo in its centre, a globe-marked
  // "Your … address" label, the address in a copyable box, and a one-line warning. The inherited sheet
  // carries every .lx-rc* rule; only the markup was missing, because the layer that wrote it was Stellar's.
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  // The Receive dialog's copy controls toast "Copied to clipboard", as lumoscore.com's do — see wallet.js setChip.
  function stripCopyLabels() {
    $$('#modalReceive [data-copy-label], .lx-rc [data-copy-label]').forEach(function (b) { b.removeAttribute('data-copy-label'); });
  }

  function enhanceReceive() {
    var me = addr();
    // The address is written into markup, so it must be a real r-address and nothing else.
    if (!me || !window.lxx || !window.lxx.isAddress(me)) return;
    $$('.qr-display').forEach(function (disp) {
      var body = disp.closest('.modal-body');
      if (!body || body.getAttribute('data-lxrc') === '1') return;
      body.setAttribute('data-lxrc', '1');
      var wrap = document.createElement('div');
      wrap.className = 'lx-rc';
      wrap.innerHTML = '<div class="lx-rc-qrwrap"><div class="qr-frame"><svg></svg></div>'
        + '<span class="lx-rc-corner tl"></span><span class="lx-rc-corner tr"></span>'
        + '<span class="lx-rc-corner bl"></span><span class="lx-rc-corner br"></span>'
        + '<div class="lx-rc-qrlogo"><img src="/assets/favicon.png" alt=""></div></div>'
        + '<div class="lx-rc-addrlabel">' + GLOBE + ' Your XRP Ledger address</div>'
        + '<div class="lx-rc-addr" data-copy="' + me + '">' + me + '</div>'
        + '<div class="lx-recv-note lx-rc-note">' + WARN
        + '<span><strong>XRP Ledger assets only.</strong> Other networks = lost funds.</span></div>';
      var ov = body.closest('.modal-overlay');
      if (ov) ov.classList.add('lx-recv-modal');
      body.innerHTML = '';
      body.appendChild(wrap);
      var ad = wrap.querySelector('.lx-rc-addr');
      ad.addEventListener('click', function () {
        try { if (navigator.clipboard) navigator.clipboard.writeText(ad.getAttribute('data-copy') || me); } catch (e) {}
        ad.classList.add('lx-copied');
        setTimeout(function () { ad.classList.remove('lx-copied'); }, 1400);
      });
    });
  }

  // ---- Send: recipient Paste and Scan ----------------------------------------------------------------
  // A scanned or pasted value may be a bare address or a wallet URI carrying one (and maybe a tag).
  // Returns true only when an XRP Ledger address was found and written.
  function fillRecipient(rec, raw) {
    var t = String(raw || '').trim();
    var am = t.match(/r[1-9A-HJ-NP-Za-km-z]{24,34}/);
    if (!am || !window.lxx || !window.lxx.isAddress(am[0])) return false;
    rec.value = am[0];
    try { rec.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    var tm = t.match(/[?&](?:dt|tag|destinationTag)=(\d{1,10})\b/i);
    var tg = document.getElementById('lxwTag');
    if (tm && tg) tg.value = tm[1];
    return true;
  }

  // jsQR, self-hosted beside xrpl.js and fetched only when someone taps Scan — Stellar's scanner.
  var qrLib = null;
  function loadQrLib() {
    if (qrLib) return qrLib;
    qrLib = new Promise(function (res, rej) {
      if (window.jsQR) return res(window.jsQR);
      var s = document.createElement('script');
      s.src = '/assets/vendor/jsqr-1.4.0.js';
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error('The scanner failed to load.')); };
      s.onerror = function () { qrLib = null; rej(new Error('The scanner failed to load.')); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  // The camera sheet. Everything that can end it goes through stop(), so the camera is never left running.
  function scanQr(onText) {
    if (!window.isSecureContext) { say('The camera needs a secure (https) connection.', 'bad'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser cannot open the camera.', 'bad'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
    var vid = document.createElement('video');
    vid.setAttribute('playsinline', ''); vid.muted = true; vid.autoplay = true;
    vid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
    var frame = document.createElement('div');
    frame.style.cssText = 'position:relative;width:66vw;max-width:300px;aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)';
    var hint = document.createElement('div');
    hint.textContent = 'Point at an XRP Ledger address QR code';
    hint.style.cssText = 'position:absolute;left:0;right:0;bottom:14vh;text-align:center;color:#fff;font:600 14px system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:6vh;padding:11px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.5);color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer';
    ov.appendChild(vid); ov.appendChild(frame); ov.appendChild(hint); ov.appendChild(cancel);
    document.body.appendChild(ov);
    var stream = null, raf = 0, dead = false;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); stop(); } }
    function stop() {
      if (dead) return;
      dead = true;
      try { cancelAnimationFrame(raf); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { vid.srcObject = null; } catch (e) {}
      document.removeEventListener('keydown', onKey, true);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stop(); });
    var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    loadQrLib().then(function (dec) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
        if (dead) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = st;
        vid.srcObject = st;
        return vid.play().catch(function () {}).then(function () {
          (function tickScan() {
            if (dead) return;
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
              var w = 480, h = Math.max(1, Math.round(vid.videoHeight * (w / (vid.videoWidth || w))));
              if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
              cx.drawImage(vid, 0, 0, w, h);
              var r = null;
              try { r = dec(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) {}
              if (r && r.data) { stop(); onText(r.data); return; }
            }
            raf = requestAnimationFrame(tickScan);
          })();
        });
      });
    }).catch(function (err) {
      stop();
      var n = (err && err.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') say('Camera permission was declined.', 'bad');
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') say('No camera found on this device.', 'bad');
      else say((err && err.message) || 'Could not open the camera.', 'bad');
    });
  }

  function addRecipientButtons(rec) {
    if (rec.__lxxRecBtns) return;
    rec.__lxxRecBtns = 1;
    var wrap = document.createElement('div');
    wrap.style.position = 'relative';
    rec.parentNode.insertBefore(wrap, rec);
    wrap.appendChild(rec);
    var bar = document.createElement('div');
    bar.className = 'lx-recbtns';
    if (isPhone()) {
      var sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'lx-paste-btn lx-scan-btn';
      sb.setAttribute('data-logoed', '1');
      sb.setAttribute('aria-label', 'Scan a QR code');
      sb.title = 'Scan a QR code';
      sb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M21 16v3a2 2 0 0 1-2 2h-3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M7 12h10"></path></svg>';
      sb.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        scanQr(function (txt) {
          if (fillRecipient(rec, txt)) say('Address scanned.', 'good');
          else say('That QR code has no XRP Ledger address in it.', 'bad');
        });
      });
      bar.appendChild(sb);
    }
    var pb = document.createElement('button');
    pb.type = 'button';
    pb.className = 'lx-paste-btn';
    pb.setAttribute('data-logoed', '1');                           // five letters: keep the logo healer off it
    pb.textContent = 'Paste';
    pb.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!navigator.clipboard || !navigator.clipboard.readText) { say('Clipboard unavailable — paste with Ctrl+V.', 'bad'); return; }
      navigator.clipboard.readText().then(function (x) {
        if (!fillRecipient(rec, x)) { rec.value = String(x || '').trim(); }
        say('');
        try { rec.focus(); } catch (e2) {}
      }, function () { say('Clipboard blocked — paste with Ctrl+V.', 'bad'); });
    });
    bar.appendChild(pb);
    wrap.appendChild(bar);
    function fit() {
      try { var bw = bar.getBoundingClientRect().width; if (bw > 0) rec.style.paddingRight = Math.round(bw + 14) + 'px'; } catch (e) {}
    }
    rec.style.paddingRight = isPhone() ? '118px' : '70px';
    fit(); setTimeout(fit, 60); setTimeout(fit, 400);
  }

  // ---- Receive QR ----------------------------------------------------------------------------------
  // The design ships a hand-drawn SVG under a comment that says "Faux QR pattern (decorative)". It is
  // a picture of a QR code: it encodes nothing, and it sits directly above the correct address on the
  // one screen whose entire purpose is telling somebody where to send money. A person who scans it
  // gets garbage, and the only reason that is not worse is that no wallet will parse it as an address.
  //
  // Replaced with a real one. The renderer is the Stellar build's, unchanged, because it is already
  // the corrected version — an earlier attempt there shipped unscannable and the two fixes are both
  // load-bearing and both invisible if you only look at it:
  //
  //   width/height 1.04 rather than 1 — at 1 the modules meet exactly on a pixel boundary and the
  //   renderer's antialiasing leaves a pale seam between every pair, which reads as noise to a decoder.
  //
  //   fill dark on an explicitly white background — QR polarity is not a style choice. Inverted, it is
  //   not a low-contrast QR code, it is not a QR code, and it fails silently on every scanner.
  //
  // The error-correction ladder tries the densest levels first so the code stays small; addData throws
  // when the data will not fit the requested version, hence the try/catch walk rather than a guess.
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

  // EVERY frame, not the first one. The page ships TWO complete sets of modals — the desktop set, and
  // a second set inside #lx-mobmodals that is the one a phone actually shows. querySelector returns
  // the desktop copy, so painting "the" QR left the phone's untouched. Same trap as the duplicated
  // .section-heading .meta, and the reason nothing below uses a singular lookup either.
  function paintQR() {
    try {
      if (!window.qrcode) return;
      var me = addr();
      if (!me) return;
      var q = null;
      $$('.qr-frame svg, .qr-display svg').forEach(function (fr) {
        if (fr.getAttribute('data-lxqr') === me) return;         // keyed on the address, so it
        q = q || makeQR(me);                                     // repaints if the wallet changes
        if (!q) return;
        var n = q.getModuleCount(), s = '';
        for (var r = 0; r < n; r++) {
          for (var c = 0; c < n; c++) {
            if (q.isDark(r, c)) s += '<rect x="' + c + '" y="' + r + '" width="1.04" height="1.04"></rect>';
          }
        }
        fr.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
        fr.setAttribute('fill', '#0d1117');
        fr.style.background = '#fff';
        fr.innerHTML = s;
        fr.setAttribute('data-lxqr', me);
        fr.classList.add('lx-qr-ready');
        // AND THEN IT WAS STILL INVISIBLE — a correct, decodable, 551-module QR rendering as a plain
        // white square. The orphaned Stellar stylesheet carries
        //     .qr-display .qr-frame svg, .qr-display canvas, .qr-display img { visibility:hidden!important }
        // which hides the design's faux QR until a data layer supplies a real one. Its companion rule,
        //     .lx-rc-qrwrap .qr-frame svg:not(.lx-qr-ready) { visibility:hidden }
        // shows that the intended escape was for Stellar's layer to REBUILD the receive body inside its
        // own .lx-rc-qrwrap — so within .qr-display there is no escape at all: the rule is unconditional
        // and !important, and adding .lx-qr-ready does nothing against it.
        //
        // Rebuilding the modal to dodge a stylesheet would be changing the design to work around a rule
        // belonging to a layer that is gone. Lifting the gate on the one element now holding real data
        // is smaller and says what it means. An inline !important is what outranks a sheet !important.
        fr.style.setProperty('visibility', 'visible', 'important');
      });
    } catch (e) {}
  }

  // THE RECEIVE SCREEN WAS TELLING PEOPLE THE WRONG ADDRESS, ON THE WRONG CHAIN.
  //
  // On a phone it read, in full: a QR, the label "Your Aptos address", the address
  // GA7K5N4M2X9P3R8Q1L6T2V8W4Y7Z3A5B8C2D6E1F4G7H9J2K5N4M2 — a Stellar-shaped string from the design
  // mock, belonging to nobody — and under it "Only send APT and Aptos-based assets to this address.
  // Sending assets from other networks will result in loss of funds."
  //
  // The data-copy attribute beside it held the RIGHT address the whole time, so the Copy button worked
  // and only the visible text was wrong. That is the worst possible split: anyone who copied was fine,
  // anyone who read the screen — or photographed it, or typed it out — sent funds into nothing. It is
  // also why no DOM check caught it; every probe I ran read data-copy and came back correct.
  //
  // Stellar's wallet layer used to rewrite this text (matching the same GA7K5N4M prefix). Stripping
  // that layer took the correction with it and left the mock, which is the general hazard recorded in
  // the stripped-layer notes: the CSS and the markup stay, only the fix leaves.
  function fixReceive() {
    var me = addr();
    if (!me) return;

    // The address line. Keyed on data-copy where the design provides it — that attribute is the
    // design's own statement of which element holds the address — and otherwise on the mock's shape.
    $$('.qr-addr, [data-copy]').forEach(function (e) {
      var t = (e.textContent || '').trim();
      if (!t || t === me) return;
      var looksLikeAddr = /^[Gr][A-Za-z0-9]{24,}$/.test(t);
      if (!looksLikeAddr) return;                                // never touch a button's label
      e.textContent = me;
      if (e.hasAttribute('data-copy')) e.setAttribute('data-copy', me);
    });

    $$('.qr-label').forEach(function (e) {
      if (/aptos|stellar/i.test(e.textContent || '')) e.textContent = 'Your XRP Ledger address';
    });

    // The warning is the most important sentence on the screen and it named the wrong chain twice.
    // Rewritten as text, on the element that holds it, so the design's box and accent styling stay.
    $$('.modal-body div, .lx-recv-note, .lt-hint').forEach(function (e) {
      if (e.__lxwarn) return;
      var t = e.textContent || '';
      if (!/Only send/i.test(t) || !/APT|Aptos/.test(t)) return;
      e.__lxwarn = 1;
      [].forEach.call(e.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/Only send APT and Aptos-based assets/i, 'Only send XRP and XRP Ledger assets')
          .replace(/\bAptos-based\b/gi, 'XRP Ledger')
          .replace(/\bAPT\b/g, 'XRP')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
    });
  }

  // ---- shared: the connected account's holdings ----------------------------------------------------
  // wallet.js publishes these. Reading its object rather than re-fetching keeps one answer about what
  // is held and what is spendable, so Send can never offer an amount the balance list disagrees with.
  function held() {
    var d = window.__lxxData;
    if (!d) return [];
    var out = [];
    if (d.xrp) {
      out.push({
        code: 'XRP', issuer: null, currency: null,
        balance: d.xrp.balance, spendable: d.xrp.spendable
      });
    }
    (d.held || []).forEach(function (t) {
      out.push({
        code: t.display, issuer: t.issuer, currency: t.currency,
        balance: t.balance, spendable: t.balance, frozen: t.frozen
      });
    });
    return out;
  }

  // ---- Send ----------------------------------------------------------------------------------------
  var sendPick = null;                                          // the asset currently selected

  function sendModal() { return $('#modalSend'); }

  // A REAL LOGO (RAZA 2026-09-15: "Wallet → Swap popup, most of the logos are incorrect"). The page's logo healer paints any
  // one-letter badge from a ticker lookup that knows nothing about XRP Ledger issuers — XYIELD came out as a letter, LUMOS
  // as a stock flame. An <img> child is the one thing the healer leaves alone, so the token's own thumbnail goes in one.
  function icoImg(host, a) {
    host.textContent = '';
    host.setAttribute('data-logoed', '1');
    host.style.background = 'transparent';
    host.style.overflow = 'hidden';
    host.style.padding = '0';
    var im = document.createElement('img');
    im.alt = '';
    im.src = thumbOf(a);
    // FEED THE CHANNEL THE SHARED CSS ACTUALLY READS.
    //
    // The swap modal's picker is .lx-ap-ico, and the wallet stylesheet -- authored on the Stellar
    // side, shared because /wallet serves both chains -- takes its logo from a custom property and
    // hides anything else:
    //     .lx-ap-ico{background-image:var(--lxlogo,none)!important}
    //     .lx-ap-ico img{display:none!important}
    // So the <img> below was inserted, loaded (48x48, confirmed), and rendered at 0x0 behind a
    // display:none that an inline style cannot outrank -- a stylesheet !important beats an inline
    // declaration. RAZA 2026-10-11: "No logos shown on swap popup on mobile."
    //
    // Nothing else is affected: .lx-ap-ico is the ONLY rule reading --lxlogo, so setting it on the
    // other hosts this function serves (.a-ico, .dxa-pl-ico) is inert, and their imgs keep showing
    // as they already do. Both channels carry the same url, so there is nothing to disagree about.
    //
    // The quote guard is the url(") trap this project has hit before: a quote inside the value would
    // close the CSS string early. Our own endpoint encodes its parameters, so this is belt only.
    try {
      var lu = thumbOf(a);
      if (lu && lu.indexOf('"') < 0 && lu.indexOf("'") < 0) {
        host.style.setProperty('--lxlogo', 'url("' + lu + '")');
      }
    } catch (e) {}
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); plain(host, a.code.charAt(0).toUpperCase()); };
    host.appendChild(im);
  }

  function setSendAsset(a) {
    var m = sendModal();
    if (!m || !a) return;
    sendPick = a;

    var btn = $('.asset-pick', m);
    if (btn) {
      // The button holds an icon span, the ticker as a bare text node, and a chevron svg. Only the
      // text node is replaced: rewriting the button would take the design's icon and chevron with it.
      var ico = $('.a-ico', btn);
      if (ico) plain(ico, a.code.charAt(0).toUpperCase());
      [].forEach.call(btn.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
      });
    }

    var lp = $('.lx-asset-pick', m);
    if (lp) {
      var lc = $('.lx-ap-code', lp);
      if (lc) plain(lc, a.code);
      var li = $('.lx-ap-ico', lp);
      if (li) { plain(li, ''); li.style.setProperty('--lxlogo', 'url("' + thumbOf(a) + '")'); }
    }

    var bal = $('.field-meta strong', m);
    // "Balance" here means what can actually be sent. For XRP that is the balance MINUS the reserve,
    // which is not a detail: the design shipped this row reading 25,420.18 APT, and a Max button that
    // offers the full balance of an XRP account builds a transaction the ledger always rejects.
    if (bal) bal.textContent = fmt(a.spendable, 6) + ' ' + a.code;

    var fee = $('.modal-body strong[style*="JetBrains"]', m);
    if (fee) fee.textContent = '~0.000012 XRP';
    say('');
  }

  // The asset menu. Built from the design's own field styling and anchored under the picker button,
  // because the design ships a button with a chevron and no menu behind it.
  function openAssetMenu(btn) {
    var m = sendModal();
    if (!m) return;
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }        // second click closes

    var list = held().filter(function (a) { return a.spendable > 0 && !a.frozen; });
    if (!list.length) return;

    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:210px;'
      + 'max-height:260px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'lxw-astrow';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      icoImg(ic, a);
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      var bl = document.createElement('span');
      bl.style.cssText = 'opacity:.7;font-size:12px';
      bl.textContent = fmt(a.spendable, 4);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(bl);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSendAsset(a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });

    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);

    // Closing on an outside click is registered on the NEXT frame. Binding it synchronously means the
    // very click that opened this menu is still propagating, reaches document, and closes it again —
    // which on a phone looks exactly like "the dropdown shuts the first time you tap it".
    requestAnimationFrame(function () {
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  // STELLAR'S FAILURE TOAST (RAZA 2026-09-17: "When Wallet → send trx is canceled, you need to show the same message that
  // you show on Stellar"). lumoscore.com ends a failed send with `lxToast(err.message || "Send failed", true)` — a toast at
  // the foot of the page with a red mark — and a wallet that refuses carries no message, which is why the Stellar screenshot
  // reads exactly "Send failed". Same element and classes the copy toast on the Wallet page already uses; only the mark
  // differs, so the two cannot drift apart visually.
  function toastBad(msg) {
    if (!document.getElementById('lx-toastbad-css')) {
      var st = document.createElement('style');
      st.id = 'lx-toastbad-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}'
        + '.lx-ctoast.bad .ci{background:#e5484d}';
      (document.head || document.documentElement).appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast bad';
    var ic = document.createElement('span'); ic.className = 'ci'; ic.textContent = '✕';
    var tx = document.createElement('span'); tx.textContent = msg || 'Send failed';
    t.appendChild(ic); t.appendChild(tx);
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  // Status line. Reuses the modal's own body so nothing new is introduced; created once, then reused.
  function say(text, tone) {
    var m = sendModal();
    if (!m) return;
    var box = $('.lxw-say', m);
    if (!box) {
      var body = $('.modal-body', m);
      if (!body) return;
      box = document.createElement('div');
      box.className = 'lxw-say';
      box.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;font-weight:600';
      body.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  // A DESTINATION TAG FIELD, because without one this wallet cannot pay an exchange at all.
  //
  // An exchange deposit address is shared by every customer; the tag is what says which account the
  // money belongs to. Send without it and the deposit is not credited — the classic way to lose funds
  // on this ledger, and the reason preflight() refuses outright when the destination demands one.
  //
  // This is NOT new UI. The Stellar build adds a "Memo (optional)" field to this very modal from its
  // own data layer, beside the network-fee row, for exactly the same purpose. This is that field, with
  // the XRP Ledger's equivalent in it, added the same way and in the same place.
  function tagInput() { return $('#lxwTag'); }

  function addTagField(m) {
    if ($('#lxwTag', m)) return;
    var feeRow = $('.modal-body > div[style*="justify-content"]', m);
    var body = $('.modal-body', m);
    if (!body) return;
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = 'Destination tag ';
    var hint = document.createElement('span');
    hint.className = 'meta';
    hint.textContent = 'required by most exchanges';
    lab.appendChild(hint);
    var inp = document.createElement('input');
    inp.className = 'field-input mono';
    inp.id = 'lxwTag';
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('placeholder', 'Optional — digits only');
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    if (feeRow && feeRow.parentNode === body) body.insertBefore(wrap, feeRow);
    else body.appendChild(wrap);
  }

  function parseDest(raw) {
    var s = String(raw || '').trim();
    if (!s) return { err: 'Enter a recipient address.' };
    if (s.charAt(0) === 'X') {
      // X-addresses carry the tag inside the address. Decoding one needs a double-SHA256 checksum
      // verification, which is not built here — and silently dropping the tag it carries would be
      // the exact loss this field exists to prevent. So it is refused, clearly, rather than guessed.
      return { err: 'X-addresses are not supported yet. Use the classic r… address and put its tag in the Destination tag field.' };
    }
    if (!window.lxx || !window.lxx.isAddress(s)) {
      return { err: 'That is not a valid XRP Ledger address.' };
    }
    var t = tagInput();
    var raw2 = t ? String(t.value || '').trim().replace(/[ ,]/g, '') : '';
    if (!raw2) return { account: s, tag: null };
    if (!/^\d+$/.test(raw2)) return { err: 'A destination tag is digits only.' };
    var n = Number(raw2);
    // A tag is an unsigned 32-bit integer. Anything larger is not a tag the ledger can carry, and
    // submitting it produces a malformed transaction rather than a helpful error.
    if (!isFinite(n) || n > 4294967295) return { err: 'That destination tag is out of range.' };
    return { account: s, tag: n };
  }

  // Everything the ledger can tell us BEFORE the user signs. Each check here is a transaction that
  // would otherwise be signed, submitted, and fail — costing a fee and a lot of confusion.
  function preflight(dest, a, amount) {
    return rpc('account_info', { account: dest.account, ledger_index: 'validated' })
      .then(function (r) { return r.account_data; })
      .catch(function (e) {
        // ON THE CODE, not the prose — see the note in rpc(). This read matched `e.message` against
        // "actNotFound" while the ledger's message for that code is "Account not found.", so it
        // never fired and an unfunded destination was reported as a failure instead of as the
        // ordinary thing it is. The message test is kept as a second chance in case a node answers
        // with a code and no message, but the code is what decides.
        if (e && (e.code === 'actNotFound' || /actNotFound/i.test(e.message || ''))) return null;
        throw e;                                                 // unfunded is legal for XRP; this is not
      })
      .then(function (ad) {
        if (!ad) {
          // An account does not exist until it holds the base reserve. Sending less than that to an
          // unfunded address fails with tecNO_DST_INSUF_XRP, and sending a TOKEN to one cannot work
          // at all — there is no account to hold a trust line.
          if (a.code !== 'XRP') {
            return { err: 'That account is not activated yet. It must be funded with XRP before it can receive tokens.' };
          }
          return rpc('server_info', {}).then(function (si) {
            var base = ((si.info || {}).validated_ledger || {}).reserve_base_xrp;
            base = +base || 1;
            if (amount < base) {
              return { err: 'That account is not activated. A first payment must be at least ' + base + ' XRP.' };
            }
            return { warn: 'This activates a new account. ' + base + ' XRP of it becomes their reserve and cannot be spent.' };
          });
        }
        // DEPOSIT AUTHORISATION: the destination can refuse payments from accounts it has not
        // preauthorised. lsfDepositAuth is bit 0x01000000 in the account flags.
        if ((ad.Flags & 0x01000000) && dest.account !== addr()) {
          return { err: 'That account only accepts payments from pre-approved senders.' };
        }
        // DESTINATION TAG REQUIRED: lsfRequireDestTag, 0x00020000. Exchanges set this because a
        // payment without a tag cannot be credited to anyone — it is the classic way to lose a
        // deposit. Refusing here is the whole reason X-addresses are accepted above.
        if ((ad.Flags & 0x00020000) && dest.tag == null) {
          return { err: 'That account requires a destination tag — fill in the Destination tag field, or the payment will not be credited.' };
        }
        if (a.code === 'XRP') return {};

        // PAYING A TOKEN BACK TO ITS OWN ISSUER IS A REDEMPTION, and it needs no trust line — the
        // issuer is not "holding" its own obligation, it is retiring it. The check below refused it
        // with "That account has no trust line for ARMY, so it cannot receive it", which is not just
        // unhelpful but false: that account is the one account that can always receive ARMY.
        //
        // Found by driving the real Send flow with the ARMY issuer as the destination. The refusal
        // is conservative rather than dangerous — it blocks a valid payment instead of allowing an
        // invalid one — but it blocks the standard way to redeem with a gateway.
        if (dest.account === a.issuer) return {};

        // A token can only be received by an account that trusts it. Without this the payment fails
        // with tecPATH_DRY, whose wording tells the user nothing.
        return rpc('account_lines', { account: dest.account, peer: a.issuer, ledger_index: 'validated' })
          .then(function (r) {
            var ok = (r.lines || []).some(function (l) {
              return l.currency === a.currency && (+l.limit > 0 || +l.balance !== 0);
            });
            return ok ? {} : { err: 'That account has no trust line for ' + a.code + ', so it cannot receive it.' };
          });
      });
  }

  function doSend() {
    var m = sendModal();
    if (!m) return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !toIn || !go) return;

    var a = sendPick || held()[0];
    if (!a) { say('No balance to send.', 'bad'); return; }

    var amount = parseFloat(String(amtIn.value).replace(/,/g, ''));
    if (!(amount > 0)) { say('Enter an amount greater than zero.', 'bad'); return; }
    if (amount > a.spendable) {
      say('That is more than you can send. ' + fmt(a.spendable, 6) + ' ' + a.code + ' is available.', 'bad');
      return;
    }
    var dest = parseDest(toIn.value);
    if (dest.err) { say(dest.err, 'bad'); return; }
    if (dest.account === addr()) { say('That is your own address.', 'bad'); return; }

    var label = go.textContent;
    go.disabled = true;
    say('Checking the destination…');

    preflight(dest, a, amount).then(function (chk) {
      if (chk && chk.err) { go.disabled = false; say(chk.err, 'bad'); return; }
      say((chk && chk.warn ? chk.warn + ' ' : '') + 'Approve the payment in your wallet…');

      // AND IF THE WALLET NEVER ANSWERS, SAY SO. A refusal that the extension reports lands in the catch below and is
      // shown; dismissing the popup WITHOUT answering reports nothing at all, and the dialog sat on "Approve the payment
      // in your wallet…" indefinitely (RAZA 2026-09-17: "on Stellar it shows an error, on XRP it doesnt"). This does not
      // claim the payment failed — it cannot know that — it says what is true and what to do.
      var nudge = setTimeout(function () {
        say('Still waiting for your wallet. If you closed or declined the request, nothing was sent — press Cancel and try again.');
      }, 20000);

      var tx = { TransactionType: 'Payment', Account: addr(), Destination: dest.account };
      if (dest.tag != null) tx.DestinationTag = dest.tag;
      if (a.code === 'XRP') {
        // Drops are integers. Rounding rather than truncating a float here is what stops
        // 0.1 + 0.2 arithmetic from silently shaving a drop off the amount the user typed.
        tx.Amount = window.lxx.toDrops(amount);
      } else {
        tx.Amount = { currency: a.currency, issuer: a.issuer, value: String(amount) };
      }

      return window.lxc.submit(tx).then(function (hash) {
        clearTimeout(nudge);
        say('Sent. ' + short(hash), 'good');
        amtIn.value = '';
        toIn.value = '';
        var tg = tagInput();
        // Cleared with the rest of the form. A tag left behind belongs to the last recipient, and the
        // next payment would silently carry someone else's deposit reference.
        if (tg) tg.value = '';
        // AND THE DIALOG CLOSES (RAZA 2026-09-17: "once the amount is sent, please close the popup"). Long enough to read
        // the hash, then out of the way — the balances behind it refresh a moment later.
        setTimeout(function () { closeSend(); }, 1800);
        setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3500);
      }, function (e) {
        clearTimeout(nudge);
        throw e;
      });
    }).catch(function (e) {
      // A wallet that refuses, does not answer, or hands back no hash tells us the same thing and nothing more: the payment
      // did not go. Stellar says "Send failed" for exactly that case, so this says it too, instead of naming the extension's
      // internals at someone who has just pressed Reject. A message the LEDGER gave — an unfunded account, a missing trust
      // line — is real information and still travels.
      var msg = String((e && e.message) || '');
      var plumbing = !msg || /did not return a transaction hash|did not respond|rejected in|could not sign|user (declined|rejected)/i.test(msg);
      say(plumbing ? '' : msg, 'bad');
      toastBad(plumbing ? 'Send failed' : msg);
    }).then(function () {
      go.disabled = false;
      go.textContent = label;
    });
  }

  function closeSend() {
    var m = sendModal();
    if (!m) return;
    var x = m.querySelector('.modal-close, [data-close]');
    if (x) x.click();
    else { m.classList.remove('open'); m.style.display = 'none'; }
  }

  // Blanks the form. Called when the dialog opens, so nothing survives from the last time it was used.
  function resetSend() {
    var m = sendModal();
    if (!m) return;
    var amt = $('.field-amt input', m);
    var to = $('.field-input.mono', m) || $('input.mono', m);
    var tg = tagInput();
    if (amt) amt.value = '';
    // …except the one case where an address was asked for deliberately: "Send to this wallet" arrives as /wallet?to=r…
    // and opens this dialog by clicking Send, so that address must survive the reset it triggers.
    if (to) { to.value = pendingTo || ''; }
    pendingTo = null;
    if (tg) tg.value = '';
    say('');
  }

  function wireSend() {
    var m = sendModal();
    if (!m || m.getAttribute('data-lxw') === '1') return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var pick = $('.asset-pick', m);
    var max = $('.pill-btn', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !go) return;                                   // markup not ready yet
    m.setAttribute('data-lxw', '1');

    // STELLAR'S SEND ROW (RAZA 2026-09-15: "Max button is different on XRPL. Paste button is missing. On
    // mobile … barcode scan icon is missing"). lumoscore.com hides the design's asset button behind its own
    // .lx-asset-pick, moves Max INTO the amount field as .lx-max-inline, and puts Paste (with Scan on a
    // phone) inside the recipient box. The inherited sheet carries every one of those rules.
    var famt = $('.field-amt', m);
    if (pick && famt && !$('.lx-asset-pick', m)) {
      pick.style.display = 'none';
      var np = document.createElement('button');
      np.type = 'button';
      np.className = 'lx-asset-pick';
      np.setAttribute('data-lx-noswap', '');
      np.innerHTML = '<span class="lx-ap-ico" data-logoed="1"></span><span class="lx-ap-code" data-logoed="1">XRP</span>'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      pick.parentNode.insertBefore(np, pick.nextSibling);
      pick = np;
    }
    if (max && famt && max.parentNode !== famt) {
      famt.classList.add('lx-send-amt');
      max.classList.add('lx-max-inline');
      famt.appendChild(max);
    }
    if (toIn) addRecipientButtons(toIn);
    if (sendPick) setSendAsset(sendPick);

    // The recipient placeholder shipped as Stellar's: "G... or domain.com*username". On this ledger
    // that is an address format that cannot exist, telling the user to type something invalid.
    if (toIn) toIn.setAttribute('placeholder', 'r… XRP Ledger address');
    var lbl = $('.field-label .meta', m);
    if (lbl) lbl.textContent = 'XRP Ledger';
    addTagField(m);

    if (pick) {
      // pick is Stellar's .lx-asset-pick by now (above); the design's own button is hidden.
      pick.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openAssetMenu(pick);
      });
    }
    if (max) {
      max.addEventListener('click', function (e) {
        e.preventDefault();
        var a = sendPick || held()[0];
        if (!a) return;
        // For XRP this is already balance minus reserve; a little is left for the network fee, or the
        // transaction cannot pay for itself and fails for an amount the button just offered.
        // Floored, not rounded — the same trap as the swap's Max above. XRP survived it only because
        // the 0.0002 fee headroom is a thousand times larger than the rounding error; an issued token
        // has no headroom and was offering a figure doSend() would refuse.
        var v = a.code === 'XRP' ? Math.max(0, a.spendable - 0.0002) : a.spendable;
        amtIn.value = String(floorDp(v, 6));
        say('');
      });
    }
    go.addEventListener('click', function (e) { e.preventDefault(); doSend(); });
  }

  // SEPARATE FROM wireSend ON PURPOSE. Wiring happens once and then marks itself done — but the
  // balances it needs arrive from the ledger a second or two later, so the first pass had nothing to
  // select and the guard stopped it ever trying again. The listeners worked (a click read the right
  // balance), while the asset button still read "APT" and the balance row "25,420.18 APT" beside it:
  // correct behaviour under a label from another chain, which is the worst way for this to be wrong.
  //
  // So the display keeps trying until there is something real to show, independently of the wiring.
  var sendPre = null, pendingTo = null;
  window.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b || !/^\s*send\s*$/i.test(b.textContent || '')) return;
    if (b.closest('.modal-overlay') || b.classList.contains('qa-row-btn')) return;
    // wallet.js leaves the row's asset here just before it clicks this button.
    sendPre = window.__lxxSendPre || 'XRP';
    window.__lxxSendPre = null;
    // EMPTY EVERY TIME IT OPENS (RAZA 2026-09-17: "there's already an address filled in which is not correct", and "if i
    // paste in the address but not click review & send and just close the popup, it should just refresh it"). The design
    // keeps this dialog in the DOM between openings, so a half-filled form came back with it — including a recipient
    // address from a payment the reader had decided not to make.
    setTimeout(function () { resetSend(); applySendPre(); }, 0);
  }, true);
  // "SEND TO THIS WALLET" hands the address over as /wallet?to=<r-address> (RAZA 2026-09-16); the Send dialog opens with it
  // filled in, as a click on Send would.
  (function () {
    var to = '';
    try { to = new URLSearchParams(window.location.search).get('to') || ''; } catch (e) {}
    if (!to || !window.lxx || !window.lxx.isAddress(to)) return;
    var tries = 0;
    (function openIt() {
      // Already open — a retry got there, or the page opened it itself. Skip straight to filling.
      var mOpen = sendModal();
      if (mOpen && mOpen.classList.contains('open')) {
        pendingTo = to;
      }
      var btn = (mOpen && mOpen.classList.contains('open')) ? null
        : [].slice.call(document.querySelectorAll('.quick-actions .qa-btn, button')).filter(function (b) {
          return /^\s*send\s*$/i.test(b.textContent || '') && !b.closest('.modal-overlay') && b.getBoundingClientRect().height > 0;
        })[0];
      if (!btn && !(mOpen && mOpen.classList.contains('open'))) {
        if (++tries < 40) setTimeout(openIt, 250);
        return;
      }
      // CLICKING IS NOT OPENING, AND THIS IS WHY IT FAILED ON PHONES. NO BACKTICKS IN THIS COMMENT.
      //
      // RAZA 2026-10-20: tapping Send on an account page "should take me to the wallet page (which it
      // does) but also open the send popup with the recipient wallet address entered in."
      //
      // Measured on the phone layout: the opener FOUND a perfectly good button — .action-btn, 94px
      // tall, outside any modal, passing its own filter — clicked it, and #modalSend stayed closed,
      // class "modal-overlay" with no "open". The button exists in the markup well before the page's
      // own script binds a handler to it, so on a slower layout the click lands on a button that does
      // nothing yet. Then this code moved straight on to filling a dialog that was never opened.
      //
      // Stellar hit exactly this and its note says so in as many words: "clicking is not the same as
      // having opened... fill() then returned true anyway (it only checked that a button was FOUND)".
      // Its fix is to click, CHECK, and let the poll come back — and that is what was missing here.
      // Same page, same handoff, same bug, fixed on one side a month ago.
      if (btn) {
        pendingTo = to;                                  // survives the open-time reset; see resetSend()
        try { btn.click(); } catch (e) {}
      }
      var mNow = sendModal();
      if (!mNow || !mNow.classList.contains('open')) {
        if (++tries < 40) setTimeout(openIt, 250);        // not open yet — come back and try again
        return;
      }
      var fill = 0;
      (function put() {
        var m = sendModal();
        var toIn = m && ($('.field-input.mono', m) || $('input.mono', m));
        if (!toIn) { if (++fill < 20) setTimeout(put, 150); return; }
        toIn.value = to;
        toIn.dispatchEvent(new Event('input', { bubbles: true }));
        toIn.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    })();
  })();

  function applySendPre() {
    if (!sendPre) return;
    var list = held();
    if (!list.length) return;                                   // balances still loading; the poll retries
    var pickA = null;
    if (sendPre !== 'XRP') {
      var p = sendPre.split('|');
      pickA = list.filter(function (h) { return h.issuer === p[1] && (h.currency === p[0] || h.code === p[2]); })[0] || null;
    }
    if (!pickA) pickA = list.filter(function (h) { return !h.issuer; })[0] || list[0];
    sendPre = null;
    setSendAsset(pickA);
  }

  function refreshSendAsset() {
    if (sendPre) { applySendPre(); return; }
    if (sendPick) return;
    var first = held()[0];
    if (first) setSendAsset(first);
  }

  // ---- Cancel order ---------------------------------------------------------------------------------
  // An offer is removed with OfferCancel referencing its sequence number — the same number wallet.js
  // stamps on each row as data-oid, so the row and the transaction cannot disagree about which offer
  // is being cancelled.
  function cancelOne(seq) {
    return window.lxc.submit({
      TransactionType: 'OfferCancel', Account: addr(), OfferSequence: +seq
    });
  }

  function confirmCancel(seqs, describe) {
    var m = $('#modalCancelOrder');
    if (!m) return;
    var title = $('#cancelOrderTitle', m);
    var text = $('#cancelOrderText', m);
    var det = $('#cancelOrderDetails', m);
    var go = $('#cancelOrderConfirm', m);
    if (!go) return;

    if (title) title.textContent = seqs.length > 1 ? ('Cancel ' + seqs.length + ' orders?') : 'Cancel order?';
    if (text) {
      text.textContent = seqs.length > 1
        ? 'Each order is cancelled by its own transaction, so you will be asked to approve ' + seqs.length + ' of them.'
        : 'This cannot be undone. Anything already filled stays in your wallet.';
    }
    // The else matters: this block ships as the design's mock ("921 APT", "+9.2 APT"), so leaving
    // it alone when there is nothing to describe shows another chain's order as the one about to be
    // cancelled. Emptied and hidden rather than left standing.
    if (det) {
      if (describe) { det.textContent = describe; det.style.display = ''; }
      else { det.textContent = ''; det.style.display = 'none'; }
    }
    else if (det) det.style.display = 'none';

    // Replaced rather than added to: this modal is reused for every order, and a listener per opening
    // would cancel the same offer once more on each subsequent use.
    var fresh = go.cloneNode(true);
    go.parentNode.replaceChild(fresh, go);
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      fresh.disabled = true;
      var i = 0, done = 0;
      (function next() {
        if (i >= seqs.length) {
          fresh.textContent = done + ' cancelled';
          setTimeout(function () {
            closeModal(m);
            if (window.__lxxReload) window.__lxxReload();
          }, 900);
          return;
        }
        var s = seqs[i++];
        fresh.textContent = seqs.length > 1 ? ('Confirm ' + i + ' of ' + seqs.length + '…') : 'Confirm in wallet…';
        cancelOne(s).then(function () { done++; next(); })
          .catch(function (err) {
            fresh.disabled = false;
            fresh.textContent = (err && err.message) || 'Could not cancel';
          });
      })();
    });

    openModal(m);
  }

  // The design's modals are shown by a class its own script toggles. Both are set so this works
  // whether or not that script has run, and neither invents a new presentation.
  function openModal(m) { m.classList.add('open', 'show', 'active'); m.removeAttribute('hidden'); }
  function closeModal(m) { m.classList.remove('open', 'show', 'active'); }

  function wireCancels() {
    if (window.__lxwCancels) return;
    window.__lxwCancels = 1;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var one = t.closest('.order-cancel');
      if (one) {
        var row = one.closest('[data-oid]');
        if (!row) return;
        e.preventDefault(); e.stopPropagation();
        var pair = ($('.pair-text .name', row) || {}).textContent || '';
        confirmCancel([row.getAttribute('data-oid')], pair ? ('Order: ' + pair) : '');
        return;
      }

      var all = t.closest('button, a');
      if (all && /cancel all/i.test((all.textContent || '').trim())) {
        var rows = $$('[data-oid]');
        if (!rows.length) return;
        e.preventDefault(); e.stopPropagation();
        confirmCancel(rows.map(function (r) { return r.getAttribute('data-oid'); }),
          rows.length + ' open order' + (rows.length === 1 ? '' : 's'));
      }
    }, true);
  }

  // ---- Swap --------------------------------------------------------------------------------------
  // A swap on the XRP Ledger is a CROSS-CURRENCY PAYMENT TO YOURSELF: Account and Destination are the
  // same account, SendMax is what you are willing to give up, Amount is what must be delivered. The
  // ledger finds the route through order books and AMM pools itself, which is why there is no routing
  // engine here and no reason to build one.
  //
  // NO tfPartialPayment. Without that flag the ledger delivers Amount EXACTLY or the whole
  // transaction fails — so Amount is set to the quoted output minus the slippage tolerance, and the
  // trade either lands at a price you accepted or does not happen. A partial payment would let it
  // fill at any price down to zero, which is the same class of bug as a MAX button that offers more
  // than the balance: it makes the number on screen a suggestion rather than a commitment.
  //
  // The quote comes from ripple_path_find with destination_amount value "-1", the ledger's own way of
  // asking "how much of this can I get for that". Quoting from a book snapshot instead would be a
  // second opinion that disagrees with the router the transaction actually uses.
  var swapFrom = null, swapTo = null, swapQuote = null, swapSeq = 0;
  var SLIP = 0.005;                                          // 0.5%, the figure the design displays

  function swapModals() { return $$('#modalSwap'); }

  // Delegates to xrpl-core, which is the same file the node tests run against. This was written
  // locally three times over — twice in here and once in pooldetail.js — and three copies of the
  // arithmetic deciding how much money moves is three chances for one to drift. Now there is one,
  // and it is covered by fixed vectors including the float case (0.1 + 0.2 must round, not truncate)
  // and the safe-integer ceiling, where it refuses rather than returning a plausible wrong number.
  function amtObj(a, value) {
    return window.lxx.amountFor(a.code === 'XRP' ? 'XRP' : { currency: a.currency, issuer: a.issuer }, value);
  }

  function swapFields(m) {
    var fields = $$('.swap-pair .field', m);
    return { from: fields[0], to: fields[1] };
  }

  // STELLAR'S TWO STEPS (RAZA 2026-09-17: "the swap popup is still not the same as stellar"). Its dialog opens clean —
  // FROM, TO, and "Review Swap" — and the rate, route, price impact and fees appear only once the reader has asked to
  // review. This build showed all of it immediately, under a button already reading "Confirm Swap", so the first screen
  // was busier than Stellar's and skipped the review entirely.
  //
  // Same markup, same dialog: the two summary boxes are hidden until Review is pressed, and the button then becomes
  // Confirm. Changing anything afterwards puts it back to Review, because a summary that outlives the amount it describes
  // is worse than no summary.
  function swapPanels(m) {
    var rate = $('.swap-rate', m);
    return [rate, rate && rate.nextElementSibling && rate.nextElementSibling.tagName === 'DIV' ? rate.nextElementSibling : null];
  }
  // ONE STATE NOW, and the parameter is kept only so the several call sites do not all have to change
  // in lockstep with this one. Every caller asks for the same thing: panels visible, button reading
  // "Confirm Swap". The dialog the design rebuilds on open is put back into that state by the observer
  // below, which is the job this function still does.
  function setReviewState(m, reviewing) {
    if (!m) return;
    reviewing = true;
    m.__lxReview = !!reviewing;
    swapPanels(m).forEach(function (el) { if (el) el.style.display = reviewing ? '' : 'none'; });
    var go = $('.modal-foot .btn-primary', m);
    if (!go) return;
    var wrote = false;
    [].forEach.call(go.childNodes, function (n) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = reviewing ? ' Confirm Swap ' : ' Review Swap '; wrote = true; }
    });
    if (!wrote) go.insertBefore(document.createTextNode(reviewing ? ' Confirm Swap ' : ' Review Swap '), go.firstChild);
  }
  // There is no first screen to go back to any more, so this no longer sends the dialog anywhere. Kept
  // because the quote path calls it on every edit, and it still does something worth doing: re-asserts
  // the one state against a dialog the design may have rebuilt underneath us.
  function resetReview() {
    swapModals().forEach(function (m) { setReviewState(m, true); });
  }

  // The design's in-field asset button, hidden and replaced by the chip Stellar uses — inserted right after it, exactly
  // where lumoscore.com puts it, so the inherited `#modalSwap .lx-swap-pick` rules lay it out. Built once per field.
  function swapPick(fld, which) {
    if (!fld) return null;
    var made = $('.lx-swap-pick', fld);
    if (made) return made;
    var orig = $('.asset-pick', fld);
    if (!orig || !orig.parentNode) return null;
    orig.style.display = 'none';
    var ap = document.createElement('button');
    ap.type = 'button';
    ap.className = 'lx-asset-pick lx-swap-pick';
    ap.setAttribute('data-lx-noswap', '');
    var ico = document.createElement('span');
    ico.className = 'lx-ap-ico';
    ico.setAttribute('data-lx-noswap', '');
    var code = document.createElement('span');
    code.className = 'lx-ap-code';
    code.setAttribute('data-lx-noswap', '');
    code.textContent = (which === 'from' ? (swapFrom && swapFrom.code) : (swapTo && swapTo.code)) || 'Select';
    ap.appendChild(ico);
    ap.appendChild(code);
    ap.insertAdjacentHTML('beforeend', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>');
    ap.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      swapMenu(ap, which);
    });
    orig.parentNode.insertBefore(ap, orig.nextSibling);
    return ap;
  }

  function setSwapAsset(which, a) {
    if (which === 'from') swapFrom = a; else swapTo = a;
    resetReview();                                       // the summary belonged to the old pair
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var fld = which === 'from' ? f.from : f.to;
      if (!fld) return;
      // STELLAR'S PICKER SITS BELOW THE AMOUNT, NOT INSIDE IT (RAZA 2026-09-17: "On LUMOS token page, Swap popup, XRP has
      // it different than Stellar"). Both builds ship the SAME markup — the design puts an `.asset-pick` button inside
      // `.field-amt` — and lumoscore.com hides it at runtime and inserts its own `.lx-asset-pick.lx-swap-pick` chip after
      // it. Every style that chip needs is already in this build; nothing here is new UI, it is the same move Stellar
      // makes on the same markup.
      var chip = swapPick(fld, which);
      if (chip) {
        var cIco = $('.lx-ap-ico', chip), cCode = $('.lx-ap-code', chip);
        if (cIco) icoImg(cIco, a);
        if (cCode) cCode.textContent = a.code;
      }
      var btn = $('.asset-pick', fld);
      if (btn) {
        var ico = $('.a-ico', btn);
        if (ico) icoImg(ico, a);
        [].forEach.call(btn.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
        });
      }
      var meta = $('.field-label .meta', fld);
      if (meta && which === 'from') {
        meta.textContent = 'Balance: ' + fmt(a.spendable, 6) + ' ' + a.code;
        // STELLAR'S MAX CHIP beside the balance (RAZA 2026-09-16: "On LUMOS token page, if we click swap, it needs to be like
        // it is on Stellar"), which this dialog shipped without — there was no way to swap a whole holding.
        var mx = $('.lx-maxchip', meta.parentNode);
        if (!mx) {
          mx = document.createElement('button');
          mx.type = 'button';
          mx.className = 'lx-maxchip';
          mx.textContent = 'Max';
          mx.style.cssText = 'margin-left:8px;padding:1px 7px;border:1px solid var(--border);border-radius:6px;background:none;'
            + 'font:inherit;font-size:11px;font-weight:700;color:var(--accent,#f0821e);cursor:pointer';
          mx.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var inp = $('.field-amt input', fld);
            if (!inp || !swapFrom) return;
            inp.value = String(floorDp(swapFrom.spendable, 6));
            quoteSwap();
          });
          meta.parentNode.appendChild(mx);
        }
      }
    });
    quoteSwap();
  }

  // You can only RECEIVE a token you already trust, so the destination list is the same list as the
  // source: XRP plus whatever this account has a trust line for. Offering the whole ledger here would
  // let someone build a swap that always fails with tecPATH_DRY.
  function swapMenu(btn, which) {
    var m = btn.closest('#modalSwap');
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }
    var list = held();
    if (!list.length) return;
    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:200px;'
      + 'max-height:240px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      icoImg(ic, a);
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      row.appendChild(ic); row.appendChild(nm);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSwapAsset(which, a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });
    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);
    requestAnimationFrame(function () {                       // see openAssetMenu for why
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  function swapSay(text, tone) {
    swapModals().forEach(function (m) {
      var box = $('.lxw-swapsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-swapsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
      box.style.display = text ? '' : 'none';
    });
    // A finished swap says so and then gets out of the way (RAZA 2026-09-16: "just hide the message 'Swap complete' in 2
    // seconds. It just stays there"). Errors stay put.
    clearTimeout(swapSay.t);
    if (text && /^swap complete/i.test(text)) swapSay.t = setTimeout(function () { swapSay(''); }, 2000);
  }

  // Take a row OUT of the summary. swapInfoRow() only ever writes into rows the design already ships,
  // so dropping a call to it leaves the label on screen with whatever the markup baked in — which is
  // the opposite of removing it.
  function swapDropRow(m, label) {
    var rows = $$('.modal-body > div[style*="border-radius"] > div', m);
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp(label, 'i').test(k.textContent || '')) {
        if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]);
        return true;
      }
    }
    return false;
  }

  function swapInfoRow(m, label, value) {
    var rows = $$('.modal-body > div[style*="border-radius"] > div', m);
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp(label, 'i').test(k.textContent || '')) {
        var v = rows[i].querySelector('strong');
        if (v) v.textContent = value;
        return;
      }
    }
  }

  // THE REVERSE QUOTE. `ripple_path_find` answers "what must I send to deliver exactly this?" in its `source_amount`, which
  // is the question a typed receive amount asks. The send amount it returns is written into FROM and the normal forward
  // quote then runs on it, so what is signed is still priced by the route the ledger actually found.
  function quoteFromReceive(m) {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    var f = swapFields(m);
    var inEl = $('.field-amt input', f.from), outEl = $('.field-amt input', f.to);
    var want = parseFloat(String(outEl && outEl.value).replace(/,/g, ''));
    if (!(want > 0)) {
      if (inEl) inEl.value = '';
      swapQuote = null;
      clearSwapQuote(m);
      swapSay('');
      return;
    }
    if (swapFrom.code === swapTo.code && swapFrom.issuer === swapTo.issuer) {
      swapSay('Pick two different assets.', 'bad');
      return;
    }
    var seq = ++swapSeq;
    swapSay('Finding a route…');
    rpc('ripple_path_find', {
      source_account: me,
      destination_account: me,
      destination_amount: amtObj(swapTo, want),
      source_currencies: [swapFrom.code === 'XRP' ? { currency: 'XRP' } : { currency: swapFrom.currency, issuer: swapFrom.issuer }],
      ledger_index: 'validated'
    }).then(function (r) {
      if (seq !== swapSeq) return;
      var alt = (r.alternatives || [])[0];
      var src = alt && alt.source_amount;
      if (!src) {
        swapInfoRow(m, 'route', 'no route');
        swapSay('No route between those two assets right now.', 'bad');
        return;
      }
      var need = (typeof src === 'string') ? (+src / DROP) : +src.value;
      if (!(need > 0)) return;
      if (inEl) inEl.value = String(+need.toFixed(6));
      quoteSwap();                                        // prices what will actually be signed
    }).catch(function () {
      if (seq !== swapSeq) return;
      swapSay('That route could not be priced right now.', 'bad');
    });
  }

  function quoteSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    var seq = ++swapSeq;
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var inEl = $('.field-amt input', f.from);
      var outEl = $('.field-amt input', f.to);
      var amount = parseFloat(String(inEl && inEl.value).replace(/,/g, ''));
      // Emptying the amount must take the quote with it: a rate left standing from the previous
      // keystroke is a rate for a trade that is no longer on screen.
      if (!(amount > 0)) { if (outEl) outEl.value = ''; swapQuote = null; clearSwapQuote(m); swapSay(''); return; }
      if (swapFrom.code === swapTo.code && swapFrom.issuer === swapTo.issuer) {
        swapSay('Pick two different assets.', 'bad'); swapQuote = null; return;
      }
      swapSay('Finding a route…');
      rpc('ripple_path_find', {
        source_account: me,
        destination_account: me,
        destination_amount: swapTo.code === 'XRP' ? '-1'
          : { currency: swapTo.currency, issuer: swapTo.issuer, value: '-1' },
        send_max: amtObj(swapFrom, amount),
        ledger_index: 'validated'
      }).then(function (r) {
        if (seq !== swapSeq) return;                          // a newer keystroke superseded this one
        var alt = (r.alternatives || [])[0];
        if (!alt) {
          swapQuote = null;
          if (outEl) outEl.value = '';
          swapInfoRow(m, 'route', 'no route');
          swapSay('No route between those two assets right now.', 'bad');
          return;
        }
        var got = alt.destination_amount;
        var outVal = (typeof got === 'string') ? (+got / DROP) : +got.value;
        swapQuote = { alt: alt, out: outVal, inAmount: amount };
        // Kept live: the design re-disables its own button whenever it rebuilds the dialog's footer.
        var goBtn = $('.modal-foot .btn-primary', m);
        if (goBtn) { goBtn.disabled = false; goBtn.removeAttribute('disabled'); }
        // Not over the box being typed in: while TO has focus the reader's own figure stays put.
        if (outEl && document.activeElement !== outEl) outEl.value = String(+outVal.toFixed(6));
        var rate = outVal / amount;
        $$('.swap-rate span', m).forEach(function (sp, i) {
          if (i === 0) sp.innerHTML = '';
          if (i === 0) {
            sp.appendChild(document.createTextNode('1 ' + swapFrom.code + ' ≈ '));
            var st = document.createElement('strong');
            st.textContent = fmt(rate, 6) + ' ' + swapTo.code;
            sp.appendChild(st);
          }
          if (i === 1) {
            sp.innerHTML = '';
            sp.appendChild(document.createTextNode('Slippage: '));
            var s2 = document.createElement('strong');
            s2.textContent = (SLIP * 100).toFixed(1) + '%';
            sp.appendChild(s2);
          }
        });
        swapInfoRow(m, 'route', swapFrom.code + ' → ' + swapTo.code
          + ((alt.paths_computed && alt.paths_computed.length) ? ' (routed)' : ' (direct)'));
        swapInfoRow(m, 'network fee', '~0.000012 XRP');
        swapFeeRow(m, amount);
        swapSay('');
      }).catch(function (e) {
        if (seq !== swapSeq) return;
        swapQuote = null;
        swapSay((e && e.message) || 'Could not get a quote.', 'bad');
      });
    });
  }

  // The platform fee gets its own line in the design's existing details box, added the same way the
  // Send modal gets its destination-tag field. It is stated before the swap, not discovered after:
  // the Stellar Smart Swap was removed precisely because a route deducted a fee that was never
  // actually collected, and the fix for that starts with the number being visible and true.
  function swapFeeRow(m, amount) {
    var box = $('.modal-body > div[style*="border-radius"]', m);
    if (!box) return;
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    var row = $('.lxw-feerow', m);
    if (!row) {
      row = document.createElement('div');
      row.className = 'lxw-feerow';
      row.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px';
      var k = document.createElement('span');
      k.textContent = 'Platform fee';
      var v = document.createElement('strong');
      v.style.color = 'var(--text)';
      row.appendChild(k); row.appendChild(v);
      box.appendChild(row);
    }
    // SHOWN IN XRP, BECAUSE XRP IS WHAT IS CHARGED. The first version displayed the fee in the input
    // currency — "0.10% · 100 LUMOS" — while collectFee() converts and takes the XRP equivalent. A fee
    // line that names a different asset from the one leaving the account is how the Stellar Smart Swap
    // ended up deducting one thing and collecting another; the displayed number has to be the charged
    // number, so it is resolved through exactly the same call the charge uses.
    var v = row.querySelector('strong');
    v.textContent = (rate * 100).toFixed(2) + '% · …';
    var seq = swapSeq;
    feeInXrp(amount).then(function (x) {
      if (seq !== swapSeq) return;                            // a newer quote is already on screen
      v.textContent = (rate * 100).toFixed(2) + '% · '
        + (x > 0 ? (fmt(x, 6) + ' XRP') : 'not charged (no route)');
    });
  }

  function doSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    if (!swapQuote) { swapSay('Enter an amount first.', 'bad'); return; }
    var amount = swapQuote.inAmount;
    if (amount > swapFrom.spendable) {
      // Floored here too. fmt() rounds, so this sentence could state a figure fractionally LARGER
      // than the balance — and then refuse it if the reader typed exactly what it had just named.
      swapSay('That is more than you can swap. ' + fmt(floorDp(swapFrom.spendable, 6), 6) + ' ' + swapFrom.code + ' is available.', 'bad');
      return;
    }
    var minOut = swapQuote.out * (1 - SLIP);
    var tx = {
      TransactionType: 'Payment',
      Account: me,
      Destination: me,                                        // a conversion, not a transfer
      Amount: amtObj(swapTo, +minOut.toFixed(6)),
      SendMax: amtObj(swapFrom, amount)
    };
    if (swapQuote.alt.paths_computed && swapQuote.alt.paths_computed.length) {
      tx.Paths = swapQuote.alt.paths_computed;
    }

    // THE TRUST LINE IS MADE ON THE WAY (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be
    // automatically created upon the swap"), which is why the dialog's "Add Trustline" banner is hidden. A token the account
    // does not trust cannot be delivered to it, so the line goes first and the payment follows once it is on the ledger.
    var needLine = !!swapTo.issuer && !held().some(function (h) {
      return h.issuer === swapTo.issuer && h.currency === swapTo.currency;
    });
    var first = Promise.resolve();
    swapSteps = needLine ? 3 : 2;                         // what every label and memo below counts against
    if (needLine) {
      swapSay('Approve the ' + swapTo.code + ' trust line (1 of 3) in your wallet…');
      first = window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: swapTo.currency, issuer: swapTo.issuer, value: '1000000000' },
        // The least recognisable prompt of the three, so it says what it is (RAZA 2026-09-17).
        Memos: [{ Memo: {
          MemoType: hexAscii('LumosCore'),
          MemoFormat: hexAscii('text/plain'),
          MemoData: hexAscii('LumosCore: trust line for ' + swapTo.code + ', required before this account can receive it '
            + '- transaction 1 of 3. The platform fee and the swap follow.')
        } }]
      }).then(function () {
        // Four seconds is a ledger close plus room; the payment fails harmlessly if it is not there yet.
        return new Promise(function (res) { setTimeout(res, 4500); });
      });
    }

    first.then(function () {
      return collectFee(amount);                          // the fee is transaction 1 of 2 now — see the note below
    }).then(function () {
      var ofN = swapSteps || 2;
      swapSay('Approve the swap (' + ofN + ' of ' + ofN + ') in your wallet…');
      return window.lxc.submit(tx);
    }).then(function (hash) {
      swapSay('Swap complete. ' + short(hash), 'good');
      setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3000);
    }).catch(function (e) {
      swapSay((e && e.message) || 'The swap could not be completed.', 'bad');
    });
  }

  // THE FEE IS A SECOND TRANSACTION, and it has to be, which is worth stating plainly rather than
  // hiding. The collector holds no trust lines, so it can only receive XRP; and an XRPL transaction
  // carries exactly one operation, so the fee cannot ride along inside the swap. Two approvals is the
  // honest shape of this on this ledger.
  //
  // IT RUNS FIRST NOW (RAZA 2026-09-17: "lets do the fees signature instead of swap. the second signature will be for swap.
  // But make sure to mention in memo that the first trx is for fees"). It used to run after the swap so that a rejected swap
  // could never cost anything; first means a fee can be paid for a swap that is then rejected, and the messages below say so
  // rather than leaving someone to work it out from their balance. The memo names the charge on the wallet's review screen.
  function collectFee(amount) {
    return feeInXrp(amount).then(function (feeXrp) {
      // ASKED IN DROPS, THE UNIT ACTUALLY SENT. NO BACKTICKS IN THIS COMMENT.
      //
      // feeXrp is XRP and toDrops ROUNDS, so a dust swap gives a fee under one drop: toDrops returns
      // "0" while feeXrp > 0 is still true, and this guard let a ZERO-DROP Payment through to the
      // wallet. Found 2026-10-20 on the dashboard Custom Swap and fixed in the same pass there and on
      // Trade-Asset. Nothing to charge is a legitimate outcome on a tiny swap, not a failure.
      var fd = (feeXrp > 0) ? window.lxx.toDrops(feeXrp) : null;
      if (!fd || !(+fd > 0)) return;
      var of = swapSteps || 2;
      swapSay('Approve the platform fee (' + (of - 1) + ' of ' + of + ') in your wallet…');
      return window.lxc.submit({
        TransactionType: 'Payment', Account: addr(),
        Destination: COLLECTOR,
        Amount: fd,
        Memos: [feeMemo(swapFrom.code, swapTo.code, of - 1, of)]
      }).catch(function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m)
          ? 'The platform fee was not approved, so nothing was swapped.'
          : (m || 'The platform fee could not be paid, so nothing was swapped.'));
      });
    });
  }

  // Memo bytes are hex on this ledger; Xaman and GemWallet both show the decoded text on the review screen.
  function hexAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 127) continue;
      out += ('0' + c.toString(16)).slice(-2).toUpperCase();
    }
    return out;
  }
  var swapSteps = 2;                                     // 3 when this swap also has to add a trust line
  function feeMemo(payCode, getCode, n, of) {
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore platform fee ' + (+(rate * 100).toFixed(2)) + '% - transaction '
          + (n || 1) + ' of ' + (of || 2) + '. The ' + payCode + ' to ' + getCode + ' swap is the next transaction.')
      }
    };
  }

  // The fee is a percentage of the trade, charged in XRP because the collector holds no trust lines
  // and so can receive nothing else.
  //
  // When one side of the swap IS XRP the value is already known. When neither side is, the fee is
  // worth asking the ledger about rather than inventing: a path_find for the fee slice of the input
  // returns exactly what it converts to, at the same prices the swap itself just used. Guessing from
  // a price feed would charge a number that disagrees with the trade it is a fee on.
  function feeInXrp(amount) {
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    if (swapFrom.code === 'XRP') return Promise.resolve(amount * rate);
    if (swapTo.code === 'XRP') return Promise.resolve(swapQuote.out * rate);
    var slice = amount * rate;
    if (!(slice > 0)) return Promise.resolve(0);
    return rpc('ripple_path_find', {
      source_account: addr(), destination_account: addr(),
      destination_amount: '-1',
      send_max: amtObj(swapFrom, +slice.toFixed(6)),
      ledger_index: 'validated'
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      if (!alt || typeof alt.destination_amount !== 'string') return 0;
      return (+alt.destination_amount) / DROP;
    }).catch(function () { return 0; });     // no route for the fee: never charge a made-up amount
  }

  // CLEAR THE MOCK QUOTE BEFORE ANYONE CAN READ IT.
  //
  // The summary rows are only written when a quote lands, and a quote needs an amount typed — so
  // until then the dialog stood with the design's Aptos mock in it: "1 APT = 0.4128 USDC", "Route
  // APT -> USDC (Direct)", "Network fee ~0.00001 APT". A fabricated exchange rate, in another
  // chain's asset, on the screen where someone decides whether to trade.
  //
  // Same reasoning as clearing the portfolio headline in wallet.js: an em dash reads as "not in
  // yet" and is self-evidently not a rate; a stale number reads as the price you will get.
  function clearSwapQuote(m) {
    $$('.swap-rate span', m).forEach(function (sp, i) {
      sp.innerHTML = '';
      sp.appendChild(document.createTextNode(i === 0 ? 'Rate ' : 'Slippage: '));
      var st = document.createElement('strong');
      st.textContent = i === 0 ? '—' : (SLIP * 100).toFixed(1) + '%';
      sp.appendChild(st);
    });
    swapInfoRow(m, 'route', '—');
    // NO PRICE IMPACT ROW (RAZA 2026-10-24: "Please remove this price impact from XRPL Swap box").
    //
    // It was never a parity question and never a real figure: this was the ONLY line in the file that
    // touched it, and it wrote a literal em dash. Nothing computed it, so the row has said exactly
    // nothing since the day it was added — a label with a permanent blank beside it on the screen
    // where somebody decides whether to sign.
    //
    // If it comes back it has to come back with an implementation: price impact is execution price
    // against spot, which this dialog could derive from the path quote, and a dash is worse than an
    // absence because it reads as a figure that failed to load. See [[price-impact-definition]].
    swapDropRow(m, 'price impact');
    swapInfoRow(m, 'network fee', '~0.000012 XRP');
  }

  // Ripple's RLUSD, by its issuer — several tokens share the ticker.
  var RLUSD = { currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De' };
  // This project's own token, whose page carries a copy of this dialog.
  var LUMOS = { currency: '4C554D4F53000000000000000000000000000000', issuer: 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha' };

  function wireSwap() {
    swapModals().forEach(function (m) {
      if (m.getAttribute('data-lxw') === '1') return;
      var f = swapFields(m);
      if (!f.from || !f.to) return;
      m.setAttribute('data-lxw', '1');
      clearSwapQuote(m);

      var picks = $$('.asset-pick', m);
      if (picks[0]) picks[0].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[0], 'from'); });
      if (picks[1]) picks[1].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[1], 'to'); });

      var inEl = $('.field-amt input', f.from);
      if (inEl) {
        var t = null;
        inEl.addEventListener('input', function () { resetReview(); clearTimeout(t); t = setTimeout(quoteSwap, 300); });
      }
      // TYPING INTO "TO" FILLS "FROM" (RAZA 2026-09-17: "if im entering value in TO field, FROM doesn't autocalculate").
      // The ledger routes a payment by what is SENT, so the typed receive amount is turned into a send amount at the
      // current rate and the real quote is then asked for on that — the same shape as the Trade-Asset swap box.
      var outEl0 = $('.field-amt input', f.to);
      if (outEl0) {
        var t2 = null;
        outEl0.addEventListener('input', function () {
          resetReview();
          clearTimeout(t2);
          t2 = setTimeout(function () { quoteFromReceive(m); }, 300);
        });
      }
      var flip = $('.swap-arrow', m);
      if (flip) {
        flip.addEventListener('click', function (e) {
          e.preventDefault();
          var a = swapFrom, b = swapTo;
          if (!a || !b) return;
          setSwapAsset('from', b);
          setSwapAsset('to', a);
        });
      }
      var go = $('.modal-foot .btn-primary', m);
      if (go) {
        // THE BUTTON SHIPS DISABLED (RAZA 2026-09-17: "Also the swapping doesnt work here"). The design's markup is
        // `<button class="btn-primary" disabled="">` — its own script would have enabled it once its own validation passed,
        // and that script is stripped here, so the swap could never be started at all. Everything behind it was correct:
        // with the attribute off, the same click builds Payment / SendMax 0.100255 XRP / Amount 4,975 LUMOS to self.
        // doSwap() does the validating now, so the control stays live and says why when something is missing.
        go.disabled = false;
        go.removeAttribute('disabled');
        go.addEventListener('click', function (e) {
          e.preventDefault();
          // ONE PRESS (RAZA 2026-10-24: "one-step on both"). This used to review first and sign second,
          // which was Stellar's wallet dialog copied faithfully — and Stellar's has now been collapsed
          // to one step too, so the pair still matches. doSwap() already refuses with a reason when
          // there is no quote, so nothing is lost by going straight there.
          doSwap();
        });
      }
      setReviewState(m, true);                           // one screen: figures visible from the start

      // …and again every time the dialog is OPENED. Wiring happens once, at load, but the design rebuilds this dialog when
      // it opens — which puts its own "Confirm Swap" label and both summary boxes back. Watched, the same way the fee row
      // on Trade-Asset has to be.
      if (window.MutationObserver && !m.__lxOpenObs) {
        m.__lxOpenObs = new MutationObserver(function () {
          var open = m.classList.contains('open') || m.style.display === 'flex';
          // Always re-applied on open: the design rebuilds this dialog each time, which puts its own
          // label and its own hidden panels back. `__lxReview` is no longer a meaningful test, so it
          // is not one.
          if (open) setReviewState(m, true);
        });
        m.__lxOpenObs.observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    });

    // XRP → RLUSD BY DEFAULT (RAZA 2026-09-15: "make XRP and RLUSD as the default choice instead of LUMOS"). RLUSD is
    // offered even without a trust line; the quote says so if this account cannot receive it yet.
    //
    // ON THE $LUMOS PAGE THE DEFAULT IS LUMOS (RAZA 2026-09-16: "On LUMOS token page, if we click swap, it needs to be like it
    // is on Stellar" — where that button opens XLM → LUMOS). Swapping to RLUSD from a page about LUMOS is not what the button
    // says it does; the earlier instruction was about the dashboard's Custom Swap, which still defaults to RLUSD.
    // A PLACEHOLDER MUST BE REPLACEABLE, AND THE FIRST VERSION OF THIS WAS NOT.
    //
    // Caught on production 2026-10-20 by seeding a real r-address and opening the dialog before the
    // wallet layer had finished reading the ledger. held() was still empty, the fallback below set a
    // zero-balance XRP object, and `if (!swapFrom || !swapTo)` then refused to touch the pair for the
    // life of the page -- so the row read "Balance: 0 XRP" while window.__lxxData said
    // {balance: 47.7189, reserved: 43, spendable: 4.7189}. Closing and reopening did not help.
    //
    // The old `if (list.length)` guard could not do this: it set nothing until data existed, so the
    // first open WITH data got real numbers. Adding the signed-out fallback is what made a stale
    // placeholder possible, so the fallback has to carry its own way out.
    //
    // Marked rather than inferred. "spendable === 0" is a real state -- an account can hold no XRP --
    // and re-seeding on it would fight a user who genuinely has none. lxPlaceholder is set ONLY by
    // the synthetic arms below, so a value the reader picked themselves is never overwritten.
    var stale = (swapFrom && swapFrom.lxPlaceholder) || (swapTo && swapTo.lxPlaceholder);
    if (!swapFrom || !swapTo || (stale && held().length)) {
      var list = held();
      // SIGNED OUT, THE DIALOG STILL HAS TO SAY WHAT IT WOULD SWAP (RAZA 2026-10-20: "On swap popup,
      // its showing aptos. also the popup itself is not like what we have on Stellar").
      //
      // `held()` is empty with no account, and this used to be guarded by `if (list.length)`, so a
      // signed-out visitor never reached setSwapAsset -- and setSwapAsset is what calls swapPick(),
      // which hides the design's in-field `.asset-pick` button and inserts the `.lx-asset-pick
      // .lx-swap-pick` chip Stellar uses. Nothing ran, so BOTH reported symptoms followed from the
      // one gate: the design's button stayed visible still carrying its Aptos mock ("APT"), and the
      // picker sat inside the amount row instead of below it.
      //
      // Measured signed out before this change: picks were ["APT", "L LUMOS"] and both `.field-amt`
      // were flex-direction:row. On lumoscore.com the same page signed out shows ["XLM", LUMOS] with
      // the chip below -- because Stellar builds its picker from a zero-balance fallback rather than
      // from holdings. This is that fallback.
      //
      // The zero-balance shapes are the ones this function already builds for a token the account
      // does not hold (the `||` arms below), so nothing new is invented: `spendable: 0` is what makes
      // the quote and the Max chip read as empty rather than as a balance we cannot know.
      var xrpA = list.filter(function (h) { return !h.issuer; })[0]
        || list[0]
        || { code: 'XRP', currency: 'XRP', issuer: '', balance: 0, spendable: 0, lxPlaceholder: 1 };
      var onLumosPage = !!document.querySelector('.lumos-hero-row') || /\/lumos(\/|$)/.test(window.location.pathname);
      var want = onLumosPage
        ? (list.filter(function (h) { return h.issuer === LUMOS.issuer && h.currency === LUMOS.currency; })[0]
           || { code: 'LUMOS', currency: LUMOS.currency, issuer: LUMOS.issuer, balance: 0, spendable: 0, lxPlaceholder: 1 })
        : (list.filter(function (h) { return h.issuer === RLUSD.issuer && h.currency === RLUSD.currency; })[0]
           || { code: 'RLUSD', currency: RLUSD.currency, issuer: RLUSD.issuer, balance: 0, spendable: 0, lxPlaceholder: 1 });
      // Re-seeded unconditionally when `stale` brought us here: the point is to REPLACE the
      // placeholder, so the `!swapFrom` test that guards the first fill must not also guard the
      // refresh. A real holding carries no lxPlaceholder, which is what stops this looping.
      if (!swapFrom || (stale && swapFrom.lxPlaceholder)) setSwapAsset('from', xrpA);
      if (!swapTo || (stale && swapTo.lxPlaceholder)) setSwapAsset('to', want);
    }

    // THE TRUST-LINE GATE GOES (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be automatically
    // created upon the swap", and 2026-09-16 asking for this dialog to match Stellar's, which has no such banner). The swap
    // below adds the line itself, so a button demanding it first is a step Stellar does not have.
    swapModals().forEach(function (m) {
      [].forEach.call(m.querySelectorAll('.trustline-gate, [data-trustline-gate]'), function (g) {
        g.style.display = 'none';
      });
    });

    // AND RUN AGAIN THE MOMENT BALANCES LAND.
    //
    // The placeholder swap above recovers on the next open, which still leaves the reader looking at
    // "Balance: 0 XRP" if they opened the dialog during the ledger read and simply waited -- the
    // wallet layer takes a while here (this test account has 98 trust lines). wallet.js already
    // announces that moment for exactly this purpose: "Announced so a dialog on a non-wallet page can
    // fill itself the moment balances land, rather than polling or racing this fetch." Nothing in this
    // file had ever listened.
    //
    // Bound once per page, not per call: wireSwap() runs on every open and a listener added each time
    // would stack. Re-entering wireSwap() is safe -- swapPick() returns the chip it already built and
    // the seeding block is a no-op once the pair holds real assets.
    if (!window.__lxxSwapDataHook) {
      window.__lxxSwapDataHook = 1;
      try {
        window.addEventListener('lxx:walletdata', function () {
          try { wireSwap(); } catch (_) {}
        });
      } catch (_) {}
    }
  }

  // ---- Trustlines ------------------------------------------------------------------------------------
  // A trust line is what lets an account hold an issued token at all, so this is the gate in front of
  // every other token feature: without one, a payment of that token to you fails outright.
  //
  // The design's modal shipped describing the wrong ledger AND the wrong number — "hold non-native
  // assets on Aptos. Each trustline reserves 0.5 APT". On the XRP Ledger a trust line is an owner
  // object and reserves the owner increment, which is 0.2 XRP today. That figure is READ FROM THE
  // LEDGER rather than written here: both reserve numbers were ten times higher before 2024 and can
  // change again by amendment, so a hardcoded value would quietly misstate what an account is giving
  // up — the same reasoning xrpl-core gives for never hardcoding the reserve in spendable maths.
  var reserveInc = null;

  function loadReserve() {
    if (reserveInc != null) return Promise.resolve(reserveInc);
    return rpc('server_info', {}).then(function (si) {
      var v = ((si.info || {}).validated_ledger || {}).reserve_inc_xrp;
      reserveInc = +v > 0 ? +v : 0.2;
      return reserveInc;
    }).catch(function () { reserveInc = 0.2; return reserveInc; });
  }

  function tlModals() { return $$('#modalTrustlines'); }

  function tlFixCopy(inc) {
    tlModals().forEach(function (m) {
      var p = $('.modal-body > p', m);
      if (!p || p.__lxtl) return;
      p.__lxtl = 1;
      var strong = p.querySelector('strong');
      [].forEach.call(p.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/non-native assets on Aptos/i, 'issued assets on the XRP Ledger')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
      if (strong) strong.textContent = inc + ' XRP';
    });
  }

  // What the account already trusts, straight from account_lines. LP tokens are excluded the same way
  // the balance list excludes them: they are pool shares, not assets somebody chose to trust.
  function tlPaintExisting() {
    var me = addr();
    if (!me) return;
    return window.lxx.allLines(rpc, me)
      .then(function (r) {
        var lines = (r.lines || []).filter(function (l) {
          return !(window.lxx && window.lxx.isLpToken && window.lxx.isLpToken(l.currency));
        });
        return loadReserve().then(function (inc) {
          tlFixCopy(inc);
          $$('#tlExistingCount').forEach(function (c) {
            c.textContent = lines.length + ' active · ' + fmt(lines.length * inc, 4) + ' XRP reserved';
          });
          $$('#tlExistingList').forEach(function (list) {
            list.innerHTML = '';
            if (!lines.length) {
              var e = document.createElement('div');
              e.className = 'tl-empty';
              e.textContent = 'No trustlines yet. Add one above to hold an issued token.';
              list.appendChild(e);
              return;
            }
            lines.forEach(function (l) { list.appendChild(tlRow(l, inc)); });
          });
        });
      }).catch(function () {});
  }

  function tlRow(l, inc) {
    var d = window.lxx.decodeCurrency(l.currency);
    var code = (d && d.display) || l.currency;
    var bal = +l.balance || 0;

    var row = document.createElement('div');
    row.className = 'tl-row';
    var ico = document.createElement('div');
    ico.className = 'tl-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-info';
    var nm = document.createElement('div');
    nm.className = 'tl-nm';
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-sub';
    sub.textContent = fmt(bal, 6) + ' · ' + short(l.account);
    info.appendChild(nm); info.appendChild(sub);

    var act = document.createElement('div');
    act.className = 'tl-action';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn';
    if (bal !== 0) {
      // A line holding a balance cannot be removed, and the ledger will refuse it. Saying so is more
      // use than a button that fails; the reserve is only released once the balance is zero.
      btn.disabled = true;
      btn.textContent = 'Holding';
      btn.title = 'A trustline can only be removed once its balance is zero.';
      btn.style.opacity = '.55';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = 'Remove';
      btn.title = 'Removes the trustline and releases ' + inc + ' XRP of reserve.';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Approve…';
        // Limit 0 on a zero-balance line deletes it and returns the reserve.
        window.lxc.submit({
          TransactionType: 'TrustSet', Account: addr(),
          LimitAmount: { currency: l.currency, issuer: l.account, value: '0' }
        }).then(function () {
          btn.textContent = 'Removed';
          setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Remove';
          tlSay((err && err.message) || 'Could not remove that trustline.', 'bad');
        });
      });
    }
    act.appendChild(btn);
    row.appendChild(ico); row.appendChild(info); row.appendChild(act);
    return row;
  }

  function tlSay(text, tone) {
    tlModals().forEach(function (m) {
      var box = $('.lxw-tlsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-tlsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : 'var(--text-muted,#9aa)';
      box.style.display = text ? '' : 'none';
    });
  }

  function tlAdd(row) {
    var me = addr();
    if (!me) return;
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    return loadReserve().then(function (inc) {
      var x = (window.__lxxData || {}).xrp;
      // Adding a line raises the account's reserve. Without this check the transaction is signed and
      // then rejected with tecINSUFFICIENT_RESERVE, which costs a fee to discover.
      if (x && x.spendable != null && x.spendable < inc) {
        tlSay('Not enough spendable XRP — a new trustline reserves ' + inc + ' XRP.', 'bad');
        return;
      }
      tlSay('Approve the trustline for ' + code + ' in your wallet…');
      // A large but finite limit: the ledger requires one, and it caps how much of this issuer's token
      // the account can ever hold. Not unlimited, which would be a promise this UI never asked about.
      return window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: row.c, issuer: row.i, value: '1000000000' }
      }).then(function () {
        tlSay(code + ' trustline added.', 'good');
        $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; });
        $$('#tlSearchInput').forEach(function (s) { s.value = ''; });
        setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
      }).catch(function (e) {
        tlSay((e && e.message) || 'Could not add that trustline.', 'bad');
      });
    });
  }

  function tlSuggest(q) {
    if (!q || q.length < 2) { $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; }); return; }
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        var held = {};
        ((window.__lxxData || {}).held || []).forEach(function (t) { held[t.issuer + '-' + t.currency] = 1; });
        // ANYONE CAN ISSUE A TOKEN CALLED ANYTHING. Searching "rlusd" returns eight tokens named
        // RLUSD from eight different issuers — one is Ripple's, two others call themselves "Ripple
        // USD", one is "RLUSD Silver", and several have no name at all. Trusting the wrong one is how
        // people end up holding a worthless token they believe is a stablecoin.
        //
        // The upstream marks the genuine article with vf, so verified issuers come first and holder
        // count breaks the rest — the two signals that actually separate them. The list is still shown
        // in full rather than filtered: hiding the impersonators would leave someone who really does
        // want an obscure token unable to find it, and would teach nobody that they exist.
        var rows = (j.rows || []).slice(0).sort(function (a, b) {
          if (!!b.vf !== !!a.vf) return b.vf ? 1 : -1;
          return (b.h || 0) - (a.h || 0);
        }).slice(0, 8);
        $$('#tlSuggestions').forEach(function (box) {
          box.innerHTML = '';
          rows.forEach(function (row) {
            box.appendChild(tlSuggestion(row, held[row.i + '-' + row.c]));
          });
        });
      }).catch(function () {});
  }

  function tlSuggestion(row, already) {
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    var el2 = document.createElement('div');
    el2.className = 'tl-suggestion';
    var ico = document.createElement('div');
    ico.className = 'tl-s-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-s-info';
    var nm = document.createElement('div');
    nm.className = 'tl-s-nm';
    // The ISSUER is part of the identity, not decoration: a ticker is not unique on this ledger, and
    // "USDC" alone names several different tokens from different issuers. Showing who issues it is
    // what stops someone trusting the wrong one.
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-s-sub';
    sub.textContent = (row.vf ? '✓ Verified · ' : '')
      + (row.u ? row.u + ' · ' : '')
      + short(row.i)
      + (row.h ? (' · ' + fmt(row.h, 0) + ' holders') : '');
    if (row.vf) sub.style.color = 'var(--green,#22c55e)';
    info.appendChild(nm); info.appendChild(sub);
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'tl-s-add';
    if (already) {
      add.textContent = 'Added';
      add.disabled = true;
      add.style.opacity = '.55';
    } else {
      add.textContent = 'Add';
      add.addEventListener('click', function (e) { e.preventDefault(); tlAdd(row); });
    }
    el2.appendChild(ico); el2.appendChild(info); el2.appendChild(add);
    return el2;
  }

  function wireTrustlines() {
    $$('#tlSearchInput').forEach(function (inp) {
      if (inp.__lxtl) return;
      inp.__lxtl = 1;
      inp.setAttribute('placeholder', 'Search by code or issuer (e.g. RLUSD, USDC…)');
      var t = null;
      inp.addEventListener('input', function () {
        clearTimeout(t);
        var v = inp.value.trim();
        // Debounced: one request per pause, not one per keystroke.
        t = setTimeout(function () { tlSuggest(v); }, 260);
      });
    });
    if (!window.__lxtlPainted && $('#tlExistingList') && window.__lxxData) {
      window.__lxtlPainted = 1;
      tlPaintExisting();
    }
  }

  // ---- boot ------------------------------------------------------------------------------------------
  // The modals are build-time markup but the balances they need arrive asynchronously, and the Receive
  // QR must repaint if the connected wallet changes. Polling briefly is simpler than subscribing to
  // three different layers, and it stops on its own.
  function tick() {
    enhanceReceive();
    stripCopyLabels();
    paintQR();
    fixReceive();
    wireSend();
    refreshSendAsset();
    wireSwap();
    wireTrustlines();
  }

  // Opens the swap dialog from somewhere other than the wallet's own Swap button — the dashboard's
  // "Custom Swap / Orders" card. Everything is wired first, because on that page the dialog is the
  // only thing from this file that is on screen and the poll may not have reached it yet.
  //
  // Published on `window` rather than exported to a second copy of this logic: this is the same
  // element, the same fields and the same signing path the wallet uses. There is no second swap
  // implementation anywhere, which is the point.
  // `sel` is optional: { code, issuer } naming the asset the caller wants in FROM.
  //
  // RAZA 2026-10-19: "from wallet page, my assets, i opened swap popup for XLM asset on XRPL ... it
  // should have shown XLM in from and XRP in TO. But it showing XRP is from and RLUSD in To."
  //
  // The row menu knew exactly which asset it was opened on -- it carries data-lxcode/data-lxiss and
  // uses them for every other item in that menu -- but called this with NO ARGUMENTS, so the dialog
  // fell back to its own defaults. Picking "Swap" on a row and getting a different pair is worse than
  // the button not being there: the amount you then type is against an asset you did not choose.
  //
  // Matched on code AND issuer, never code alone: this ledger has four tokens called ATOM and two
  // called LUMOS, so a ticker match would preselect an impostor on a row the user picked by sight.
  // See [[lumoscore-token-logos]].
  // A CLOSED DIALOG MUST NOT REOPEN ON THE LAST TRADE (RAZA 2026-10-24: "if the swap box is filled and
  // the popup is closed, and then opened again, the details are not refreshed").
  //
  // Nothing cleared it. The amounts, the quote, the rate line and the route row all survived the close,
  // so reopening showed a priced swap for an amount nobody had just typed — and the figures beside it
  // were as old as whenever the dialog was last used. On a box whose next button signs a payment, a
  // stale quote is the dangerous kind of leftover: it looks live.
  //
  // Cleared on OPEN rather than on close, deliberately. The design's own script closes this dialog
  // through routes this file does not own — the × , the backdrop, Escape — so a close handler would
  // have to catch all of them and would silently miss any added later. Opening is the one moment that
  // is always ours, and it is also the only moment the state actually matters.
  function resetSwapBox(m) {
    if (!m) return;
    var f = swapFields(m);
    [f.from, f.to].forEach(function (fld) {
      var inp = fld && $('.field-amt input', fld);
      if (inp) inp.value = '';
    });
    swapQuote = null;
    try { swapSay(''); } catch (_) {}
    setReviewState(m, false);
    // The same function the "no amount typed" path uses, so a reopened dialog reads exactly like a
    // fresh one rather than like a third state nobody designed.
    try { clearSwapQuote(m); } catch (_) {}
  }

  window.__lxxOpenSwap = function (sel) {
    tick();
    var m = $('#modalSwap');
    if (!m) return false;
    resetSwapBox(m);
    if (sel && sel.code) {
      var list = held();
      var want = list.filter(function (a) {
        return a.code === sel.code && String(a.issuer || '') === String(sel.issuer || '');
      })[0];
      if (want) {
        setSwapAsset('from', want);
        // THE COUNTER ASSET HAS TO MOVE TOO, or picking RLUSD would leave RLUSD on both sides. For an
        // issued token the natural other side is XRP, which is what every pool and path on this ledger
        // routes through. Only touched when it would otherwise collide or make no sense.
        var xrp = list.filter(function (a) { return !a.issuer; })[0];
        if (want.issuer) {
          if (xrp) setSwapAsset('to', xrp);
        } else if (swapTo && !swapTo.issuer) {
          // From is XRP and To is also XRP: pick the first issued asset instead of leaving a no-op pair.
          var other = list.filter(function (a) { return a.issuer; })[0];
          if (other) setSwapAsset('to', other);
        }
      }
    }
    openModal(m);
    // Balances can still be in flight on a cold load; the dialog is usable as soon as they land and
    // this repaint is what fills the From balance and the asset pickers when they do.
    [80, 300, 900, 2000].forEach(function (ms) { setTimeout(tick, ms); });
    return true;
  };

  function boot() {
    // `#modalSwap` joins the list because the dashboard carries that dialog and none of the other
    // three. Without it this returned immediately there, so wireSwap() never ran and the Custom Swap
    // card had nothing to open — the dialog was present, correct and completely inert.
    if (!$('#modalSend') && !$('.qr-display') && !$('#tlExistingList') && !$('#modalSwap')) return;
    wireCancels();
    tick();
    var n = 0;
    var t = setInterval(function () {
      tick();
      if (++n > 40) clearInterval(t);                             // ~20s
    }, 500);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button, a');
      // The phone's modal set can be inserted when it opens, so repaint a few times after the click
      // rather than once — the elements may not exist on the first frame.
      if (b && /receive/i.test(b.textContent || '')) {
        [60, 220, 600].forEach(function (ms) {
          setTimeout(function () { enhanceReceive(); paintQR(); fixReceive(); }, ms);
        });
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
