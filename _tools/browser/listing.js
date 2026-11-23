// Curated listing request, on the XRP Ledger -- paid in XRP (RAZA 2026-11-17: "In their own coin").
//
// HISTORY. This layer first replaced the inherited Stellar one (which, on this host, would have taken a
// real Stellar mainnet fee and posted the record nowhere) and deliberately took NO payment, because
// there was nowhere to record a request. The combined site now serves /lxapi/xrpllisting, which writes
// into the same listing_request queue as Stellar and Hedera, so this takes the payment.
//
// THE SEQUENCE, and why each step is where it is:
//   1. quote   GET /lxapi/xrpllisting -> the fee in XRP, the collector, the memo. The page never prices
//              on its own: the number charged and the number the server checks against are one number.
//   2. check   the form (code, r-address, description, logo) BEFORE any wallet prompt -- a refused form
//              after a payment is the outcome this whole flow exists to avoid.
//   3. pending the form is saved locally BEFORE signing, so a reload (Xaman round trip, a crash) can
//              still attach the payment.
//   4. pay     window.lxc.submit({Payment ... Memos:["LumosCore listing"]}) -> the hash.
//   5. record  POST /lxapi/xrpllisting, retried while the ledger validates. A payment that cannot be
//              recorded shows the hash and a way to support -- never a silent loss.
(function () {
  if (window.__lxxListing) return;
  window.__lxxListing = 1;

  // Checksum-gated at BUILD time (_tools/xrpladdr.js). Must equal the server's COLLECTOR.
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';
  var API = '/lxapi/xrpllisting';
  var PENDING_KEY = 'lumos.listing.xrpl';
  var PENDING_MAX_AGE = 24 * 3600 * 1000;
  var LOGO_MAX = 512 * 1024;
  var LOGO_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
  var CODE_RE = /^[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3,20}$/;
  var ADDR_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function show(el, yes) { if (el) { if (yes) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); } }
  function money(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d || 2 }); }
  function hexAscii(s) { var h = ''; for (var i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0'); return h.toUpperCase(); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var quote = null;            // { amount, xrpUsd, memo, at, valid }
  var logoData = '', logoName = '';
  var busy = false;

  function status(t) { var e = $('ltStatus'); if (e) e.textContent = t || ''; }
  function formErr(t) { var e = $('ltFormErr'); if (e) { e.textContent = t || ''; show(e, !!t); } }
  function fieldErr(id, t) {
    var e = $(id + 'Err'), i = $(id);
    if (e) { e.textContent = t || ''; show(e, !!t); }
    if (i) i.classList.toggle('lt-wrong', !!t);
  }
  function clearErrors() { ['ltCode', 'ltIssuer', 'ltDescr', 'ltSite', 'ltLogo'].forEach(function (i) { fieldErr(i, ''); }); formErr(''); }
  // A FIXED FIELD LOSES ITS ERROR AS YOU TYPE (bugs S81 / X28, 2026-11-19). The red line used to stay until the next
  // Pay, so a corrected code or issuer still read as wrong. Editing a field clears its own message, and the form-level
  // line goes once no field is marked. The full check still runs on Pay.
  ['ltCode', 'ltIssuer', 'ltDescr', 'ltSite'].forEach(function (id) {
    var inp = $(id);
    if (!inp) return;
    inp.addEventListener('input', function () {
      var e = $(id + 'Err');
      if (!e || !e.textContent) return;
      fieldErr(id, '');
      var left = ['ltCode', 'ltIssuer', 'ltDescr', 'ltSite', 'ltLogo'].some(function (k) { var x = $(k + 'Err'); return !!(x && x.textContent); });
      if (!left) formErr('');
    });
  });

  // ---- quote ----------------------------------------------------------------------------------
  function paintQuote() {
    var amt = $('ltAmt'), rate = $('ltRate'), to = $('ltTo');
    if (to) { to.textContent = COLLECTOR; to.title = COLLECTOR; }
    if (!quote) { if (amt) amt.textContent = '—'; if (rate) rate.textContent = 'rate unavailable'; return; }
    if (amt) amt.textContent = money(quote.amount, 6) + ' XRP';
    if (rate) rate.textContent = quote.test ? 'Test price for this wallet' : ('1 XRP = $' + Number(quote.xrpUsd).toFixed(4));
    // The headline price is the design's own "$250" text; a test wallet's quote replaces it, and it comes back on a
    // switch to a normal wallet.
    ['ltFee', 'ltFee2', 'ltFee3'].forEach(function (id) { var e = $(id); if (!e) return; if (e.__lxOrig == null) e.__lxOrig = e.textContent;
      e.textContent = quote.test ? (money(quote.amount, 6) + ' XRP') : e.__lxOrig; });
  }
  // TEST WALLETS (RAZA 2026-11-23): the quote is asked WITH the connected wallet, so an approved test wallet sees its
  // minimum (0.5 of the coin, labelled as a test price); the server re-checks the paying address on submit. Asked again
  // when the wallet changes, so connecting after the page loaded is not stuck on the normal price.
  var quoteFor = null;
  setInterval(function () { if (quoteFor !== null && me() !== quoteFor) loadQuote(); }, 3000);
  function loadQuote() {
    var qa = me(); quoteFor = qa;
    return fetch(API + (qa ? ('?a=' + encodeURIComponent(qa)) : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var o = d && d.ok && d.options && d.options[0];
      if (!o || d.collector !== COLLECTOR) throw new Error('bad quote');
      quote = { amount: o.amount, xrpUsd: d.xrpUsd, memo: d.memo, test: !!d.test, at: Date.now(), valid: (d.validForSeconds || 900) * 1000 };
      paintQuote();
    }).catch(function () { quote = null; paintQuote(); });   // never a guessed price
  }

  // ---- wallet / button ------------------------------------------------------------------------
  function me() { try { return (window.lxc && window.lxc.address && window.lxc.address()) || ''; } catch (e) { return ''; } }
  function paintButton() {
    var t = $('ltGoT'); if (!t || busy) return;
    t.textContent = me() ? 'Pay ' + (quote ? money(quote.amount, 6) + ' XRP ' : '') + 'and submit' : 'Connect wallet to pay';
  }
  function setBusy(yes) { busy = yes; var g = $('ltGo'); if (g) { g.disabled = yes; g.style.opacity = yes ? '.7' : ''; } if (!yes) paintButton(); }
  var lastMe = null;
  setInterval(function () { var a = me(); if (a !== lastMe) { lastMe = a; paintButton(); } }, 600);

  // ---- logo -----------------------------------------------------------------------------------
  function paintLogo() {
    var box = $('ltDropIn'); if (!box) return;
    if (!logoData) {
      box.className = 'lt-drop-in';
      box.innerHTML = '<span class="lt-drop-t">Choose a logo</span><span class="lt-drop-d">Square PNG, JPEG, WebP or GIF · 256 × 256px or larger · up to 512KB</span>';
      return;
    }
    box.className = 'lt-picked';
    box.innerHTML = '';
    var img = document.createElement('img'); img.src = logoData; img.alt = '';
    var txt = document.createElement('div');
    txt.innerHTML = '<div class="lt-picked-ok"><span>Logo ready</span></div><div class="lt-picked-n"></div>';
    txt.querySelector('.lt-picked-n').textContent = (logoName ? logoName + ' · ' : '') + 'Click to change';
    box.appendChild(img); box.appendChild(txt);
  }
  function takeFile(file) {
    fieldErr('ltLogo', '');
    if (!file) return;
    if (!LOGO_OK[String(file.type).toLowerCase()]) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'The logo must be a PNG, JPEG, WebP or GIF.'); }
    if (file.size > LOGO_MAX) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That file is ' + Math.round(file.size / 1024) + 'KB, over the 512KB limit.'); }
    var fr = new FileReader();
    fr.onload = function () {
      var data = String(fr.result || ''), probe = new Image();
      probe.onload = function () {
        var w = probe.naturalWidth || 0, h = probe.naturalHeight || 0;
        if (w < 256 || h < 256) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That logo is ' + w + ' × ' + h + 'px. It needs to be 256 × 256px or larger.'); }
        if (Math.abs(w - h) > Math.max(w, h) * 0.01) { logoData = ''; paintLogo(); return fieldErr('ltLogo', 'That logo is ' + w + ' × ' + h + 'px. It needs to be square.'); }
        logoData = data; logoName = file.name || ''; paintLogo();
      };
      probe.onerror = function () { logoData = ''; paintLogo(); fieldErr('ltLogo', 'That image could not be read.'); };
      probe.src = data;
    };
    fr.readAsDataURL(file);
  }

  // ---- form -----------------------------------------------------------------------------------
  function val(id) { var e = $(id); return e ? (e.value || '').trim() : ''; }
  function readForm() {
    return { network: 'xrpl', code: val('ltCode'), issuer: val('ltIssuer'), descr: val('ltDescr'),
      website: val('ltSite'), twitter: val('ltX'), telegram: val('ltTg'), discord: val('ltDs'), logo: logoData };
  }
  function validate(f) {
    var ok = true;
    if (!CODE_RE.test(f.code) || f.code.toUpperCase() === 'XRP') { fieldErr('ltCode', 'The currency code, 3 to 20 characters.'); ok = false; }
    if (!ADDR_RE.test(f.issuer)) { fieldErr('ltIssuer', 'An XRP Ledger address: r, then 24 to 34 characters.'); ok = false; }
    if (f.descr.length < 20) { fieldErr('ltDescr', 'Say what the project is, in at least a sentence.'); ok = false; }
    if (f.website && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(f.website)) { fieldErr('ltSite', 'That does not look like a web address.'); ok = false; }
    if (!f.logo) { fieldErr('ltLogo', 'A logo is required: a square image, 256 × 256px or larger.'); ok = false; }
    if (!ok) formErr('Fix the fields marked above, then try again.');
    return ok;
  }

  // ---- pending (survives a reload or a wallet round trip) --------------------------------------
  function savePending(rec) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); }
    catch (e) { try { rec.f = Object.assign({}, rec.f, { logo: '' }); localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); } catch (e2) {} }
  }
  function readPending() {
    try {
      var p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (!p || !p.f) return null;
      if (Date.now() - (+p.ts || 0) > PENDING_MAX_AGE) { localStorage.removeItem(PENDING_KEY); return null; }
      return p;
    } catch (e) { return null; }
  }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }

  // ---- record ---------------------------------------------------------------------------------
  function post(f, hash) {
    return fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network: 'xrpl', code: f.code, issuer: f.issuer, descr: f.descr, logo: f.logo || '',
        txHash: hash, website: f.website || '', twitter: f.twitter || '', telegram: f.telegram || '', discord: f.discord || '' }) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); });
  }
  // "not validated yet" / "not found yet" are the ledger catching up: keep asking for ~40s.
  function record(f, hash, attempt) {
    attempt = attempt || 1;
    return post(f, hash).then(function (r) {
      if (r.d && r.d.ok) return r.d;
      var msg = (r.d && r.d.error) || 'Server error';
      var retry = r.status >= 500 || /yet|validated/i.test(msg);
      var e = new Error(msg); e.final = !retry; throw e;
    }).catch(function (err) {
      if (err.final || attempt >= 10) throw err;
      return wait(Math.min(2000 + attempt * 1500, 6000)).then(function () { return record(f, hash, attempt + 1); });
    });
  }
  function showDone(f, paid, hash, id) {
    clearPending();
    show($('ltForm'), false); show($('ltStranded'), false); show($('ltDone'), true);
    var set = function (i, v) { var e = $(i); if (e) { e.textContent = v; e.title = v; } };
    set('ltDoneAsset', f.code + ' · ' + f.issuer);
    set('ltDonePaid', paid ? money(paid, 6) + ' XRP' : '—');
    set('ltDoneTx', hash); set('ltDoneId', id || '—');
    try { $('ltDone').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
  }
  function showStranded(hash) {
    show($('ltStranded'), true);
    var e = $('ltStrandedTx'); if (e) e.textContent = hash;
    try { $('ltStranded').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e2) {}
  }

  // ---- pay ------------------------------------------------------------------------------------
  function run(f) {
    var addr = me();
    if (!quote || Date.now() - quote.at > quote.valid) {
      status('Refreshing the price…');
      return loadQuote().then(function () { if (!quote) throw new Error('The XRP price is unavailable right now. Try again in a minute.'); return run(f); });
    }
    var drops = String(Math.ceil(Number(quote.amount) * 1e6));
    savePending({ f: f, ts: Date.now(), paid: quote.amount });
    status('Approve the payment of ' + money(quote.amount, 6) + ' XRP in your wallet…');
    return window.lxc.submit({
      TransactionType: 'Payment', Account: addr, Destination: COLLECTOR, Amount: drops,
      Memos: [{ Memo: { MemoType: hexAscii('LumosCore'), MemoFormat: hexAscii('text/plain'), MemoData: hexAscii(quote.memo || 'LumosCore listing') } }]
    }).then(function (hash) {
      hash = String(hash || '').toUpperCase();
      if (!/^[0-9A-F]{64}$/.test(hash)) throw new Error('The wallet did not return a transaction hash.');
      savePending({ f: f, ts: Date.now(), paid: quote.amount, hash: hash });
      status('Payment sent. Recording your application…');
      return record(f, hash).then(function (d) { showDone(f, quote.amount, hash, d.id); }, function (err) {
        formErr(err.message || 'The application could not be recorded.');
        showStranded(hash);
      });
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    clearErrors();
    if (!window.lxc) { formErr('The wallet layer did not load. Reload the page and try again.'); return; }
    if (!me()) { try { window.lxc.open(); } catch (e2) {} return; }
    var f = readForm();
    if (!validate(f)) return;
    setBusy(true);
    run(f).catch(function (err) { formErr(err && err.message ? err.message : 'The payment did not go through.'); })
      .then(function () { status(''); setBusy(false); });
  }

  // A payment that went out but never got recorded (reload, crash, wallet round trip): finish it.
  function resume() {
    var p = readPending();
    if (!p || !p.hash) return;
    status('Finishing your earlier application…');
    record(p.f, p.hash).then(function (d) { showDone(p.f, p.paid, p.hash, d.id); },
      function (err) { status(''); formErr(err.message); showStranded(p.hash); });
  }

  function boot() {
    if (!$('ltForm') || !$('ltGo')) return;                // not the listing page
    on($('ltForm'), 'submit', onSubmit);
    on($('ltLogo'), 'change', function () { takeFile(this.files && this.files[0]); });
    var drop = $('ltDrop');
    ['dragenter', 'dragover'].forEach(function (ev) { on(drop, ev, function (e) { e.preventDefault(); drop.classList.add('lt-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { on(drop, ev, function () { drop.classList.remove('lt-over'); }); });
    on(drop, 'keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && $('ltLogo')) { e.preventDefault(); $('ltLogo').click(); } });
    on($('ltDescr'), 'input', function () { var c = $('ltCount'); if (c) c.textContent = String(this.value.length); });
    var to = $('ltTo'); if (to) { to.textContent = COLLECTOR; to.title = COLLECTOR; }   // the price stays 'loading…' until it arrives
    paintLogo(); loadQuote().then(paintButton); paintButton();
    resume();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
