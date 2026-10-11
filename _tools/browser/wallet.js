// Wallet page: real XRP Ledger balances, on desktop AND mobile.
//
// Written as a FILE and injected verbatim, never assembled as a string in the transform. Every
// escaping accident in the Stellar project came from browser code living inside quoted strings --
// a template literal ate the backslashes out of a regex and shipped it inert, an SVG's quotes closed
// the string it sat in and crashed the transform. A file has no layers to survive.
//
// TWO RENDERERS, because the two designs are not the same markup:
//   desktop  <tbody id="assetsTable">   table rows, 5 columns
//   mobile   <div  id="assetList">      .asset-row cards
// Writing only the desktop one is the single most repeated bug in the Stellar project -- a fix aimed
// at a desktop selector silently does nothing on the phone, and it caused at least five separate
// reports there. Whichever container exists is the one that gets filled.
//
// Depends on window.lxx (xrpl-core.js), injected immediately above and byte-identical to the file the
// node tests run against, so the currency and reserve rules cannot drift between test and page.
(function () {
  if (window.__lxxWallet) return;
  window.__lxxWallet = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // THE DESIGN'S NUMBERS GO BEFORE THEY CAN BE READ (RAZA 2026-09-17: "there's a flash bug when i refresh. It shows that i
  // have 5 assets and 2 pools for split seconds"). The markup ships "5 holdings · 31,108.45 APT total" with tab counts of 5
  // and 2, and this layer only overwrote them once the ledger answered — a second or two of someone else's portfolio on
  // every refresh. Cleared as this file runs, which is before anything is painted.
  (function blankHeaderMock() {
    [].forEach.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) { c.textContent = ''; });
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta, h3 .meta'), function (m) {
      if (/holding|APT|Aptos|active|total/i.test(m.textContent || '')) m.textContent = '';
    });
  })();

  // RETRIED ONCE, and that is not belt-and-braces. This page now runs four layers that each talk to
  // the ledger on load -- balances, the fee tier, connect, and prices -- and a public node drops one
  // of a simultaneous burst. The symptom is the whole asset list replaced by 'Could not read the XRP
  // Ledger' while the very same request succeeds by hand a second later. A transient failure that
  // leaves a permanent empty state is the worst kind, because it looks like a broken page.
  function rpc(method, params, attempt) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }).catch(function (e) {
      // actNotFound is a real answer about a real account, not a dropped request: do not retry it.
      if ((attempt || 0) > 0 || /actNotFound/i.test(e && e.message)) throw e;
      return new Promise(function (r) { setTimeout(r, 700); })
        .then(function () { return rpc(method, params, 1); });
    });
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
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

  // textContent everywhere for ledger-supplied values: a currency name is arbitrary bytes off a public
  // ledger and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- the asset mark ------------------------------------------------------------------------------
  //
  // RAZA, 2026-09-08: "in Wallet -> my assets -> the asset logos are missing."
  //
  // They were, and the design was never the problem. The container carries the styling for both
  // marks — the table's `.asset-id .ico.lx-aico`, which paints from a `--ic` custom property and
  // draws `data-l` in an ::after, and the card's 38px `.asset-ico` disc. This layer simply was not
  // building either of them: the table row had NO mark at all and used two classes of its own
  // invention (`.asset-nm`, `.asset-sb`) that the stylesheet has no rules for, which is also why
  // that column looked unstyled beside every other list on the site.
  //
  // Neither mark holds text of its own, and that is what keeps the page's logo engine off them: it
  // repaints any element carrying one to five characters, and a letter drawn by a pseudo-element is
  // not text it can see.
  var XRP_LOGO_ID = '84e5efeb89c4eae8f68188982dc290d8';

  // WHERE THE ID COMES FROM. Every other list on this site takes a logo id from an API row, because
  // it is listing tokens the API just ranked. This lists what an ACCOUNT holds, and a holding is
  // often nowhere near any ranking — so there is no row to read it from. The id turns out to be
  // md5(issuer + "_" + currency), verified against all 50 rows of /lxapi/xrpltokens with no
  // mismatches, and the edge derives it (JS has no MD5 and Web Crypto omits it). XRP is the native
  // asset and sits outside that scheme, so its id is the one that has to be written down.
  function thumb(tok, w) {
    if (!tok) return '/lxapi/xrplthumb?id=' + XRP_LOGO_ID + '&w=' + w;
    if (!tok.issuer || !tok.currency) return '';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(tok.issuer)
      + '&cur=' + encodeURIComponent(tok.currency) + '&w=' + w;
  }

  // A stable colour per ticker, so a mark waiting on its image is never a grey hole and two
  // different tokens never read as the same one.
  function hue(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  // ---- probing, deferred and throttled ------------------------------------------------------------
  //
  // 350 HOLDINGS IS A REAL WALLET, and one probe per row fired at once does not work. A browser
  // keeps about six connections to a host, so the rest queue — and a timeout meant to measure "is
  // there a logo?" ends up measuring "how long did this wait behind 300 other requests?".
  //
  // Measured on an account with 349 trust lines: 310 of 350 rows fell back to a letter. Four of
  // them were then requested directly — STX, LAWAS, PEPE, WIND — and all four answered 200. Every
  // one of those marks existed. Nothing was missing; they had simply timed out in the queue, which
  // would have shipped as "the logos are still missing".
  //
  // So a probe waits until its row is near the viewport, and then only a few run at a time. A
  // wallet shows about ten rows at once, so what you can see resolves immediately and the other
  // three hundred cost nothing until they are scrolled to.
  //
  // AND THE WHOLE QUEUE STOPS WHEN THE UPSTREAM SAYS SO. Measured on the deployed build, 2026-10-05: a
  // wallet holding 65 tokens asks for 65 marks, and xrpl.to answered 429 to roughly half of them — six
  // at a time is a burst it will not serve. A 429 is not a fact about a token, it is "ask me later", so
  // the answer is to ask later rather than to ask harder: the first one pauses every pending probe for
  // a few seconds and drops the width to two. Total requests go DOWN, not up, which is the point — a
  // per-row retry against a rate limit is just a second way to be refused.
  var Q = [], active = 0, MAXQ = 6, HOLD = 0, HOLDT = 0;
  function pump() {
    if (!Q.length) return;
    var wait = HOLD - Date.now();
    if (wait > 0) {
      if (!HOLDT) HOLDT = setTimeout(function () { HOLDT = 0; pump(); }, wait + 50);
      return;
    }
    while (active < MAXQ && Q.length) { active++; (Q.shift())(); }
  }
  function done1() { active--; pump(); }
  // TUNED AGAINST THE REAL LIST, not guessed. The first attempt — a five-second pause and two in flight
  // — was measured on a 65-holding wallet and left 62 rows still queued after half a minute, which is
  // the bug again wearing a different face: a mark nobody waits for is a mark nobody sees. 2.5s and
  // three in flight clears the same list while staying well inside what the upstream will serve.
  function backOff() { HOLD = Date.now() + 2500; MAXQ = 3; }

  // Runs cb once, when the element comes within a screen of the viewport.
  //
  // MEASURED, NOT OBSERVED, and deliberately so. IntersectionObserver is the obvious tool and was
  // the first implementation — but if it does not report, nothing is ever probed and EVERY mark
  // stays a letter, which is a worse version of the bug this is fixing. A feature whose failure
  // mode is "the thing you asked for never appears" should not be load-bearing, and this one does
  // not have to be: a rect check on scroll is a few hundred reads, it works in every browser, and
  // it is directly testable.
  //
  // The rows also live inside .assets-card, which is its OWN scroll container — 558px tall over
  // 28,000px of rows — so the listener is on document in the capture phase, where an inner
  // container's scroll is seen just as well as the window's.
  var WAIT = [], sweeping = false, wired = false;

  function sweep() {
    sweeping = false;
    if (!WAIT.length) return;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    var keep = [];
    for (var i = 0; i < WAIT.length; i++) {
      var w = WAIT[i];
      if (!document.contains(w.node)) continue;               // row replaced; drop it
      var r = w.node.getBoundingClientRect();
      // Within one screen above or below, and actually laid out.
      if (r.height > 0 && r.bottom > -400 && r.top < h + 400) w.run();
      else keep.push(w);
    }
    WAIT = keep;
  }

  // setTimeout, NOT requestAnimationFrame. rAF does not fire while the page is not being rendered,
  // and `sweeping` is cleared by the sweep itself — so a scheduled frame that never arrives latches
  // this permanently and no mark is ever probed again. Measured: every row stayed unprobed with the
  // rAF version. A timer owes nothing to the compositor.
  function schedule() {
    if (sweeping) return;
    sweeping = true;
    setTimeout(sweep, 16);
  }

  function near(node, cb) {
    WAIT.push({ node: node, run: cb });
    if (!wired) {
      wired = true;
      // Capture phase, so an inner container's scroll is seen as well as the window's.
      document.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      // AND a poll, because the scroll listener is an optimisation rather than the mechanism. Rows
      // are appended after this first runs, layout is not final on the first frame, and a row can
      // come into view without any scroll at all — a tab switching, a section expanding, the list
      // being filtered. The poll is what makes "it eventually resolves" true independently of any
      // event firing; it stops the moment nothing is waiting.
      var iv = setInterval(function () {
        if (!WAIT.length) { clearInterval(iv); return; }
        schedule();
      }, 400);
    }
    schedule();
  }

  // PROBE, THEN PAINT — never letter-then-logo.
  //
  // The obvious shape is to draw the initial at once and replace it when the image lands, and that
  // is what the Stellar wallet does. It is also precisely the bug just fixed on the Stellar
  // dashboard: a hundred marks each drawn twice, which reads as the section glitching for seconds
  // after every load. So a mark is painted once, when its fate is known. The disc keeps its colour
  // meanwhile, so nothing looks empty, and the initial is drawn if the image fails or is slow.
  // 429 IS NOT "THIS TOKEN HAS NO LOGO" (RAZA 2026-10-05: "On Wallet page --> My assets: why isn't
  // LUMOS logo shown"). Measured on the deployed build: half the thumbnail requests a 65-holding wallet
  // makes come back 429, every one of those rows drew a letter, and none of them ever asked again — the
  // marks were all there, the wallet simply took a refusal as an answer. Asked by hand a second later,
  // the same urls are 200.
  //
  // AN <img> CANNOT TELL A 429 FROM A 404. Both arrive as `onerror`, which is why this looked for a
  // year like missing artwork rather than a rate limit, and why the fix had to change the probe: a
  // fetch can read the status. The mark is still painted through the stylesheet, and that costs nothing
  // extra — the answer is immutable for a week, so the url() that follows is a browser-cache hit.
  //
  //   200        the mark exists; paint it
  //   400 / 404  a real answer about this token: it has none, draw the letter and stop asking
  //   anything else (429, 5xx, a dropped request) is about the MOMENT, so the row waits and asks again
  //
  // A 429 holds the whole queue rather than spinning this row alone (see pump()), and it is counted
  // separately from a dropped request: "ask me later" said six times is still a logo that exists, while
  // six silent failures in a row is a network that is not going to answer. Measured on a cold cache,
  // sixty-five holdings: three attempts left two rows lettered, both of them 429s that had simply not
  // got to the front of the line yet.
  function paintMark(node, setLogo, setLetter, url) {
    if (!url) { setLetter(); return; }
    var tries = 0, held = 0;
    function go() {
      Q.push(function () {
        var fired = false;
        // This times the REQUEST, not a wait behind three hundred of them.
        var t = setTimeout(function () { settle(0); }, 8000);
        function settle(status) {
          if (fired) return;
          fired = true;
          clearTimeout(t);
          done1();
          if (status === 200) { setLogo(url); return; }
          if (status === 400 || status === 404 || status === 415) { setLetter(); return; }
          if (status === 429 ? ++held > 6 : ++tries > 3) { setLetter(); return; }
          if (status === 429) backOff();
          setTimeout(go, status === 429 ? 1500 : 1200);
        }
        fetch(url).then(function (r) {
          var st = r.status;
          var img = /^image\//.test(r.headers.get('content-type') || '');
          // Drain the body, so the bytes land in the browser's own cache and the url() that follows is
          // a hit. A failed read is still an answer about the status, so it settles either way.
          return r.blob().then(function (b) {
            // A 200 THAT IS NOT AN IMAGE IS NOT A LOGO (RAZA 2026-10-05: "lumos logo in Wallet --> My
            // assets is not showing up at all"). The endpoint was handing back a Cloudflare Access login
            // page under content-type image/png: the status said success, so this painted url(…) over a
            // thing no browser can decode, and the row ended up with no mark AND no letter — the one
            // outcome worse than either. Checked here as well as at the edge, because a blank disc gives
            // the next person nothing to go on.
            return (st === 200 && (!img || !b || b.size < 64)) ? 415 : st;
          }, function () { return st; });
        }).then(settle, function () { settle(0); });
      });
      pump();
    }
    near(node, go);
  }

  // THE VERIFIED TICK (RAZA 2026-09-16: "Also add verification tick for LUMOS on all other places where it should be").
  // The same span, glyph and class the market table and the search rows use, so the inherited .lx-vtick rule styles it;
  // the sizing is inline as well because this page's sheet does not carry that rule.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  function vtick() {
    var s = el('span', 'lx-vtick');
    s.title = 'Verified issuer';
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;margin-left:5px;border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
    s.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }

  // WHICH HOLDINGS GET ONE (RAZA 2026-10-05: "verification ticks missing on most like Army and phnix.
  // they're already in our curated list"). They are: both sit in the roster the Trade page lists, and
  // this page was ticking exactly one issuer — LUMOS, hardcoded — so every other holding read as
  // unvetted beside it.
  //
  // THE RULE IS THE TRADE PAGE'S RULE, deliberately, because that table is what "our curated list"
  // means on this build: the live top of the XRP Ledger market from /lxapi/xrpltokens, with LUMOS
  // pinned into it. Two surfaces disagreeing about whether a token is verified is worse than either
  // answer on its own. The same caveat recorded in trade.js applies here and is not re-argued: the
  // roster is ranked by volume, not vetted by anyone, so the tick means "we list it". If it is ever to
  // mean verification again, a real issuer+currency allowlist replaces VSET and both surfaces follow.
  //
  // NOT xrpl.to's own `vf` flag, which the search rows use: it is 0 for both ARMY and PHNIX, so
  // reading it here would have answered RAZA's report with "working as intended" and no ticks.
  //
  // Rows are painted before this lands, so the tick is applied twice — inline when a row is built, and
  // again over the whole table once the roster arrives. The key lives on the name node in `data-lxvk`,
  // which is also what lets the second pass find rows without re-rendering them.
  var VSET = null;
  function isVerified(tok) {
    if (!tok || !tok.issuer) return false;              // XRP itself is the ledger, not an issuance
    if (tok.issuer === LUMOS_ISS) return true;          // pinned, exactly as in the Trade table
    return !!(VSET && VSET[tok.issuer + '|' + String(tok.currency || '').toUpperCase()]);
  }
  function markVerified(host, tok) {
    if (!host || !tok || !tok.issuer) return;
    host.setAttribute('data-lxvk', tok.issuer + '|' + String(tok.currency || '').toUpperCase());
    if (isVerified(tok) && !host.querySelector('.lx-vtick')) host.appendChild(vtick());
  }
  function applyTicks() {
    [].forEach.call(document.querySelectorAll('[data-lxvk]'), function (h) {
      var k = h.getAttribute('data-lxvk') || '';
      var ok = k.slice(0, k.indexOf('|')) === LUMOS_ISS || !!(VSET && VSET[k]);
      var has = h.querySelector('.lx-vtick');
      if (ok && !has) h.appendChild(vtick());
      else if (!ok && has && has.parentNode) has.parentNode.removeChild(has);
    });
  }
  fetch('/lxapi/xrpltokens?n=100')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var s = {};
      [].forEach.call((d && d.rows) || [], function (t) {
        if (t && t.i && t.c) s[t.i + '|' + String(t.c).toUpperCase()] = 1;
      });
      VSET = s;
      applyTicks();
    })
    .catch(function () {});

  // ---- rows, per design ---------------------------------------------------------------------------
  function tableRow(name, sub, right, rightSub, frozen, tok) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxkey', tok ? (name + '-' + tok.issuer) : 'XRP');
    var c1 = el('td');
    var aid = el('div', 'asset-id');
    var ico = el('div', 'ico lx-aico');
    ico.style.setProperty('--ic', hue(name));
    try { ico.setAttribute('data-logoed', '1'); } catch (e) {}
    paintMark(ico, function (u) {
      ico.style.setProperty('--ic', 'url("' + u + '")');
      ico.setAttribute('data-l', '');
      ico.classList.add('lx-din');
    }, function () {
      ico.setAttribute('data-l', (name || '?').slice(0, 1).toUpperCase());
    }, thumb(tok, 48));
    aid.appendChild(ico);
    var meta = el('div', 'meta');
    var nm = el('div', 'nm');
    plain(nm, name + (frozen ? ' (frozen)' : ''));
    markVerified(nm, tok);
    meta.appendChild(nm);

    // STELLAR'S ROW (RAZA 2026-09-15: "My assets section is different on Stellar"), read off lumoscore.com:
    // the native asset's sub-line is "Stellar · native"; a token's is its issuer, shortened, with a copy
    // button — `.lx-asb`, `.lx-iss`, `.lx-isscopy`, all styled by the inherited sheet. The price cell
    // is `.p1.lx-p1` plus the price in the native asset, the balance cell is `.b1` over "≈ $x" in
    // `.b2`, and the actions carry their icons and a third, icon-only button.
    var sb = el('div', 'sb');
    if (!tok) {
      sb.appendChild(el('span', 'lx-asb-t', 'XRP Ledger · native'));
    } else {
      var asb = el('span', 'lx-asb');
      asb.setAttribute('data-vk', name + '|' + tok.issuer);
      var iss = el('span', 'lx-iss', short(tok.issuer));
      iss.title = tok.issuer;
      asb.appendChild(iss);
      var cp = el('button', 'lx-isscopy');
      cp.type = 'button';
      cp.setAttribute('data-iss', tok.issuer);
      cp.setAttribute('aria-label', 'Copy issuer address');
      cp.title = 'Copy issuer address';
      cp.innerHTML = ICON_COPY;
      asb.appendChild(cp);
      sb.appendChild(asb);
    }
    meta.appendChild(sb);
    aid.appendChild(meta);
    c1.appendChild(aid);
    tr.appendChild(c1);
    tr.appendChild(el('td', 'price-cell', '—'));        // prices.js fills it
    // `spark-cell` IS THE CLASS THAT HIDES THIS COLUMN, as on Stellar — see the note in prices.js.
    tr.appendChild(el('td', 'spark-cell'));
    var c4 = el('td', 'right balance-cell');
    c4.appendChild(el('div', 'b1', right));
    c4.appendChild(el('div', 'b2', ''));
    // XRP's spendable/reserved split stays available on hover; Stellar's row has no line for it.
    if (rightSub) c4.title = rightSub;
    tr.appendChild(c4);
    var c5 = el('td', 'right');
    c5.appendChild(rowActions(name, tok));
    tr.appendChild(c5);
    return tr;
  }

  // COLUMN 5 WAS 260px OF NOTHING ON EVERY ROW. lumoscore.com fills it — read off the live table, it
  // holds `.row-quick-actions` with two `.qa-row-btn` buttons, Trade and Send. The design's own
  // classes and its own column; nothing is styled or invented here.
  function rowActions(name, tok) {
    var wrap = el('div', 'row-quick-actions');

    var trade = el('button', 'qa-row-btn');
    trade.innerHTML = ICON_TRADE + ' Trade';
    trade.type = 'button';
    // TRADE OPENS A CHOICE, IT DOES NOT NAVIGATE (RAZA 2026-10-02: "When im tapping on Trade button, it
    // should show me 'Swap, Trade on Dex' options like it does on Stellar. On XRPL, it just takes me to
    // the asset trade page").
    //
    // There are two different things someone means by "trade this holding" — the order book, and an
    // instant swap — and the button was silently picking one. The menu is the same .lx-rowmenu the
    // kebab opens, so there is one menu implementation on this page rather than two.
    //
    // XRP keeps an empty issuer here: it has no asset page of its own, and the DEX item falls back to
    // the market for it.
    trade.setAttribute('data-lxtrade', (name || 'XRP') + '|' + ((tok && tok.issuer) || ''));
    wrap.appendChild(trade);

    // A HOLDING OF NOTHING OFFERS THE TRUST LINE BACK (RAZA 2026-09-16: "If i have 0 of any asset, then there should be
    // remove trustline button just like on Stellar"). Stellar puts it where Send sits, and Send on an empty holding has
    // nothing to send anyway. Each trust line reserves 0.2 XRP, so removing one hands that back.
    if (tok && !(tok.balance > 0) && !tok.frozen) {
      // STELLAR'S EXACT BUTTON (RAZA 2026-09-17: "the remove trustline button is not the same as on Stellar"): class
      // `qa-row-btn lx-rmtrust` with a trash glyph — and this build already carries the rule that paints that icon red
      // (`#assetsTable .qa-row-btn.lx-rmtrust svg{stroke:var(--red)}`), which my own class and link icon never triggered.
      var tl = el('button', 'qa-row-btn lx-rmtrust');
      tl.innerHTML = ICON_TRUSTLINE + ' Trustline';
      tl.type = 'button';
      tl.title = 'Remove this trust line and free its 0.2 XRP reserve';
      tl.setAttribute('data-lxrmtl', (tok.currency || '') + '|' + tok.issuer + '|' + name);
      wrap.appendChild(tl);
    } else {
      // SEND WORKS ON EVERY ROW (RAZA 2026-09-15: "Why's send button inactive"). The Send dialog's picker
      // (write.js) holds tokens as well as XRP, so the row opens it on its own asset, as lumoscore.com does.
      var send = el('button', 'qa-row-btn');
      send.innerHTML = ICON_SEND + ' Send';
      send.type = 'button';
      send.setAttribute('data-lxsend', tok ? ((tok.currency || '') + '|' + tok.issuer + '|' + name) : 'XRP');
      wrap.appendChild(send);
    }

    // The third, icon-only button Stellar's row ends on. It opens Stellar's row menu — View asset, Pin to
    // top, Copy issuer address, View on Explorer (RAZA 2026-09-15: "instead of opening the dropdown, it
    // opens up bithomp").
    var more = el('button', 'qa-row-btn icon-only');
    more.type = 'button';
    more.innerHTML = ICON_MORE;
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('data-lxmenu', tok ? (name + '|' + tok.issuer) : 'XRP');
    wrap.appendChild(more);
    return wrap;
  }

  // Setting the limit to zero on a holding of nothing is what closes a trust line: the ledger deletes the line and gives
  // the 0.2 XRP reserve back. It is refused while any balance remains, which is why the button only appears on an empty
  // row. Signed with the same wallet path as every other write on this site.
  function removeTrustline(btn) {
    var parts = (btn.getAttribute('data-lxrmtl') || '').split('|');
    var cur = parts[0], iss = parts[1], code = parts[2] || 'the asset';
    var me = addr();
    if (btn.getAttribute('data-busy') === '1' || !cur || !iss || !me) return;
    if (!window.lxc || !window.lxc.submit) { toast('Connect a wallet first.'); return; }
    var label = btn.innerHTML;
    btn.setAttribute('data-busy', '1');
    btn.textContent = 'Approve…';
    window.lxc.submit({
      TransactionType: 'TrustSet', Account: me,
      LimitAmount: { currency: cur, issuer: iss, value: '0' }
    }).then(function () {
      btn.textContent = 'Removing…';
      toast(code + ' trust line removed');
      // The ledger validates in a few seconds; the list is read again rather than edited in place.
      setTimeout(function () { btn.removeAttribute('data-busy'); btn.innerHTML = label; load(); }, 5000);
    }, function (err) {
      btn.removeAttribute('data-busy');
      btn.innerHTML = label;
      var m = (err && err.message) || '';
      toast(/reject|denied|cancel/i.test(m) ? 'Cancelled' : 'The trust line could not be removed.');
    });
  }

  // Stellar hides this header at RUNTIME — its `th` carries an inline `display:none`, and there is no
  // stylesheet rule for it in either build, which is why grepping the CSS found nothing. Same thing
  // here, so the column disappears completely instead of standing empty over hidden cells.
  function hideSparkHead() {
    var body = document.getElementById('assetsTable');
    var tbl = body && body.closest ? body.closest('table') : null;
    if (!tbl) return;
    var ths = tbl.querySelectorAll('thead th');
    if (ths.length > 2) ths[2].style.display = 'none';
  }

  // The row buttons have to be claimed on WINDOW CAPTURE, for the same reason the trade and pools
  // rows are: the design claims clicks anywhere in a list page and routes them through its own
  // resolver, and a bubble-phase listener on the button never runs first.
  function claimRowActions() {
    if (window.__lxxWalletActs) return;
    window.__lxxWalletActs = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var go = t.closest('[data-lxgo]');
      if (go) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = go.getAttribute('data-lxgo');
        return;
      }

      var tb = t.closest('[data-lxtrade]');
      if (tb) { e.preventDefault(); e.stopImmediatePropagation(); openTradeMenu(tb); return; }
      var mb = t.closest('[data-lxmenu]');
      if (mb) { e.preventDefault(); e.stopImmediatePropagation(); openRowMenu(mb); return; }
      var pb = t.closest('[data-lxpmenu]');
      if (pb) { e.preventDefault(); e.stopImmediatePropagation(); openPoolMenu(pb); return; }
      var mi = t.closest('.lx-rowmenu [data-lxmi]');
      if (mi) { e.preventDefault(); e.stopImmediatePropagation(); rowMenuAct(mi); return; }
      var pi = t.closest('.lx-rowmenu [data-lxpi]');
      if (pi) { e.preventDefault(); e.stopImmediatePropagation(); poolMenuAct(pi); return; }
      if (!t.closest('.lx-rowmenu')) closeRowMenu();

      // THE WALLET CHIP'S LINK ICON opens this account on Bithomp (RAZA 2026-09-15), as Stellar's opens it on
      // stellar.expert. Found by its external-link glyph, the way Stellar's layer finds it.
      var xb = t.closest('.wallet-chip button, .wallet-chip a, .hero-id-row button, .hero-id-row a');
      var xpoly = xb && xb.querySelector('polyline');
      if (xb && ((xb.getAttribute('title') || '') === 'Explorer' || (xpoly && /^15\s+3\s+21\s+3\s+21\s+9$/.test((xpoly.getAttribute('points') || '').trim())))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (addr()) window.open('https://bithomp.com/explorer/' + encodeURIComponent(addr()), '_blank', 'noopener');
        return;
      }

      var ex = t.closest('[data-lxexp]');
      if (ex) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var xv = ex.getAttribute('data-lxexp');
        if (xv) window.open('https://bithomp.com/explorer/' + encodeURIComponent(xv), '_blank', 'noopener');
        return;
      }
      var cpb = t.closest('.lx-isscopy');
      if (cpb) {
        e.preventDefault();
        e.stopImmediatePropagation();
        copyText(cpb.getAttribute('data-iss') || '');
        return;
      }

      var tlb = t.closest('[data-lxrmtl]');
      if (tlb) { e.preventDefault(); e.stopImmediatePropagation(); removeTrustline(tlb); return; }

      var sd = t.closest('[data-lxsend]');
      if (sd) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Opens the page's OWN Send dialog by clicking the header button that already does it, so
        // whichever of the two modal sets is live (this page ships a desktop and a mobile copy) is
        // the one that opens, and nothing here duplicates that logic.
        // write.js reads this when the dialog opens and selects the row's asset.
        window.__lxxSendPre = sd.getAttribute('data-lxsend') || 'XRP';
        var btns = document.querySelectorAll('.quick-actions .qa-btn');
        for (var i = 0; i < btns.length; i++) {
          if (/^\s*send\s*$/i.test(btns[i].textContent || '')) { btns[i].click(); return; }
        }
      }
    }, true);
  }

  // Stellar's row icons, copied off lumoscore.com's live table (RAZA 2026-09-15: "the send and trade icon is
  // different on XRPL"): a candlestick chart for Trade, a paper plane for Send, at 11px; the kebab at 12px.
  var SVG_OPEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON_TRADE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M8 6v3"></path><rect x="6" y="9" width="4" height="6" rx="1"></rect><path d="M8 15v3"></path><path d="M16 4v2"></path><rect x="14" y="6" width="4" height="9" rx="1"></rect><path d="M16 15v3"></path></svg>';
  var ICON_SEND = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  // The trash glyph lumoscore.com uses on this button, copied from its own markup so the two builds draw the same row.
  var ICON_TRUSTLINE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
  var ICON_MORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

  // ---- the row menu ----------------------------------------------------------------------------------
  // Stellar's .row-menu, built the way lumoscore.com builds it: fixed-position under the kebab, a child of
  // body, four actions with a divider before the explorer link. The inherited sheet styles it.
  // Figures the way Stellar's pool rows print them: whole units past 100K, one decimal past 1K, two below.
  function lpAmt(v) {
    v = Number(v);
    if (!(v > 0)) return '0';
    var dp = v >= 100000 ? 0 : (v >= 1000 ? 1 : (v >= 1 ? 2 : 6));
    return v.toLocaleString('en-US', { maximumFractionDigits: dp });
  }

  var PIN_KEY = 'lumos.pinned';
  function pinnedList() {
    try { var v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function closeRowMenu() {
    [].forEach.call(document.querySelectorAll('.lx-rowmenu'), function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
  }
  function menuSvg(inner) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  function openRowMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;                                       // a second click on the same kebab closes it
    var key = btn.getAttribute('data-lxmenu') || 'XRP';
    var parts = key.split('|'), code = parts[0], iss = parts[1] || '';
    var pinKey = iss ? (code + '-' + iss) : 'XRP';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    var h = '<button type="button" data-lxmi="view">' + menuSvg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>') + ' View asset</button>'
      + '<button type="button" data-lxmi="pin">' + menuSvg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>')
      + (pinnedList().indexOf(pinKey) >= 0 ? ' Unpin' : ' Pin to top') + '</button>';
    if (iss) h += '<button type="button" data-lxmi="copy">' + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>') + ' Copy issuer address</button>';
    h += '<div class="divider"></div>'
      + '<button type="button" data-lxmi="explorer">' + menuSvg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>') + ' View on XRPL Explorer</button>';
    m.innerHTML = h;
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 170;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
    if (!window.__lxxRowMenuClose) {
      window.__lxxRowMenuClose = 1;
      window.addEventListener('scroll', closeRowMenu, true);
      window.addEventListener('resize', closeRowMenu);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRowMenu(); });
    }
  }
  // THE LIQ POOLS KEBAB IS A MENU, NOT A LINK (RAZA 2026-10-06: "clicking on 3 dots icon on the right is
  // taking me to bithomp when it should actually open the dropdown for 'View pool details' and 'Copy pool
  // address'. Please compare with Stellar").
  //
  // The asset rows got their menu and the pool rows did not: that third button was simply given
  // `data-lxexp` and a "View on Bithomp" tooltip, so the kebab beside a pool behaved differently from the
  // identical kebab one tab away.
  //
  // Two items, matching lumoscore.com. The design's own definition for an `lp` row carries THREE —
  // "View pool details", "View transaction history", "Copy pool address" — read out of the live
  // lx-aed79fbe3c71.js; Stellar ships the first and the last, which is also what RAZA's screenshot shows,
  // so the middle one is left out here too rather than invented for XRPL alone. The icons are the
  // design's: the info circle and the copy rectangles.
  //
  // The explorer is NOT kept as a third item. Nothing about the pool page is missing from it, and the
  // kebab's job here is the two actions Stellar offers.
  function openPoolMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var acct = btn.getAttribute('data-lxpmenu') || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxpool', acct);
    m.innerHTML =
      '<button type="button" data-lxpi="details">'
      + menuSvg('<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>')
      + ' View pool details</button>'
      + '<button type="button" data-lxpi="copy">'
      + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>')
      + ' Copy pool address</button>';
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
  }

  function poolMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var acct = (m && m.getAttribute('data-lxpool')) || '';
    var what = item.getAttribute('data-lxpi');
    closeRowMenu();
    if (!acct) return;
    if (what === 'details') window.location.href = '/pools/xrpl/id/' + encodeURIComponent(acct);
    else if (what === 'copy') copyText(acct);
  }

  // The Trade button's two-item menu, in the same shell the kebab uses so it inherits the design's
  // surface, placement and dismissal. Two lines per item, as Stellar's has: what it is, and what it is
  // for — "Order book & charts" against "Instant swap" is the whole distinction being offered.
  function openTradeMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var parts = (btn.getAttribute('data-lxtrade') || 'XRP|').split('|');
    var code = parts[0], iss = parts[1] || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu lx-trademenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    m.innerHTML =
      '<button type="button" data-lxmi="dex"><span class="lx-tmt">Trade on DEX</span>'
      + '<span class="lx-tms">Order book &amp; charts</span></button>'
      + '<button type="button" data-lxmi="swap"><span class="lx-tmt">Swap</span>'
      + '<span class="lx-tms">Instant swap</span></button>';
    if (!document.getElementById('lx-trademenu-css')) {
      var st = document.createElement('style');
      st.id = 'lx-trademenu-css';
      // STELLAR'S NUMBERS, READ OFF ITS OWN SOURCE (RAZA 2026-10-06: "On XRPL, the text is larger than
      // what we have on Stellar. please compare").
      //
      // The two menus were never the same object. lumoscore.com builds this one in its own shell,
      // `.lx-trmenu` (_walletdata.js), which sets `font:700 13px/1.25` on the button and 11.5px/600
      // muted on the sub-line. This build reuses the design's `.row-menu` — the shell the kebab beside
      // it uses — whose button is 18.7px/500, and only ever overrode the sub-line. So the title came out
      // at 18.7px against Stellar's 13px, which is the whole report.
      //
      // The SHELL is deliberately left as `.row-menu`: it is the design's own surface, placement and
      // dismissal, and it matches the kebab menu sitting next to it on the same row. Only the type is
      // brought into line.
      //
      // `.row-menu.lx-trademenu button` rather than `.lx-trademenu button`, because the latter ties
      // 0-1-1 with `.row-menu button` and would then be decided by source order — and `_externalize.js`
      // hoists every `lx-*` stylesheet into <head>, so source order is not something to rely on.
      st.textContent = '.row-menu.lx-trademenu button{display:flex;flex-direction:column;align-items:flex-start;'
        + 'gap:1px;font:700 13px/1.25 "Hanken Grotesk",system-ui,sans-serif}'
        + '.row-menu.lx-trademenu .lx-tmt{font-weight:700}'
        + '.row-menu.lx-trademenu .lx-tms{font-weight:600;font-size:11.5px;opacity:1;'
        + 'color:var(--text-muted,#8b90a0)}';
      (document.head || document.documentElement).appendChild(st);
    }
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.left))) + 'px';
    m.style.visibility = '';
  }

  function rowMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var code = m.getAttribute('data-lxcode'), iss = m.getAttribute('data-lxiss') || '';
    var what = item.getAttribute('data-lxmi');
    closeRowMenu();
    if (what === 'dex') {
      window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
      return;
    }
    if (what === 'swap') {
      // The one swap implementation on this page. If it is not wired yet — a cold load — the DEX page
      // is the honest fallback rather than a button that does nothing.
      var opened = false;
      try { opened = typeof window.__lxxOpenSwap === 'function' && window.__lxxOpenSwap(); } catch (e) {}
      if (!opened) window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
      return;
    }
    if (what === 'view') {
      window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
    } else if (what === 'copy') {
      copyText(iss);
    } else if (what === 'explorer') {
      var target = iss || addr();
      if (target) window.open('https://bithomp.com/explorer/' + encodeURIComponent(target), '_blank', 'noopener');
    } else if (what === 'pin') {
      var k = iss ? (code + '-' + iss) : 'XRP', list = pinnedList(), at = list.indexOf(k);
      if (at >= 0) list.splice(at, 1); else list.unshift(k);
      try { localStorage.setItem(PIN_KEY, JSON.stringify(list)); } catch (e) {}
      applyPins();
    }
  }
  // Pinned rows go to the top of My Assets, newest pin first, each with Stellar's star badge.
  function applyPins() {
    var tb = document.getElementById('assetsTable');
    if (!tb) return;
    var list = pinnedList();
    [].forEach.call(tb.querySelectorAll('tr[data-lxkey]'), function (tr) {
      var on = list.indexOf(tr.getAttribute('data-lxkey')) >= 0;
      tr.classList.toggle('lx-pinned', on);
      var nm = tr.querySelector('.nm'), bd = nm && nm.querySelector('.lx-pin-badge');
      if (on && nm && !bd) {
        bd = document.createElement('span');
        bd.className = 'lx-pin-badge';
        bd.title = 'Pinned';
        bd.setAttribute('data-logoed', '1');
        bd.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>';
        nm.appendChild(bd);
      } else if (!on && bd) {
        bd.parentNode.removeChild(bd);
      }
    });
    for (var i = list.length - 1; i >= 0; i--) {
      var row = tb.querySelector('tr[data-lxkey="' + String(list[i]).replace(/"/g, '') + '"]');
      if (row) tb.insertBefore(row, tb.firstChild);
    }
  }
  try { window.__lxxApplyPins = applyPins; } catch (e) {}
  var ICON_COPY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  // Balances the way Stellar prints them: whole units past a thousand, cents above one, and enough
  // precision below one that a small holding does not read as zero.
  function balTxt(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    if (v >= 1000) return fmt(v, 0);
    if (v >= 1) return fmt(v, 2);
    return fmt(v, 6);
  }

  function copyText(text) {
    if (!text) return;
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    } catch (e) { fallback(); }
    toast('Copied to clipboard');
  }

  // Stellar's bottom-centre toast, the same element the rest of the site uses.
  function toast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.appendChild(Object.assign(document.createElement('span'), { className: 'ci', textContent: '✓' }));
    t.appendChild(Object.assign(document.createElement('span'), { textContent: msg || 'Copied to clipboard' }));
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1800);
  }

  // A token mark inside an activity row's label: Stellar's `.lx-act-ilogo`, painted from a CSS variable.
  function actLogo(a) {
    var s = el('span', 'lx-act-ilogo');
    var u = (a && a.issuer) ? thumb({ issuer: a.issuer, currency: a.currency }, 32) : thumb(null, 32);
    ['--al', '--ic', '--lxlogo'].forEach(function (k) { s.style.setProperty(k, 'url("' + u + '")'); });
    s.setAttribute('data-l', '');
    s.setAttribute('data-logoed', '1');
    return s;
  }

  function card(name, sub, right, rightSub, frozen, tok) {
    var row = el('div', 'asset-row');
    var top = el('div', 'asset-top');
    // EVERY ROW'S BADGE READ "L". This builder wrote the token's first two letters, but the page's
    // logo layer repaints any short-text element from the surrounding words, and those words include
    // the site's own name — so XRP, LUMOS, XYIELD and SLT all ended up wearing the same LUMOS "L",
    // four different tokens rendered as one. plain() claims the element so what we draw stands.
    var ico = el('div', 'asset-ico');
    plain(ico, '');                                   // claim it first: plain() clears background
    ico.style.background = hue(name);
    paintMark(ico, function (u) {
      ico.style.backgroundImage = 'url("' + u + '")';
      ico.style.backgroundSize = 'cover';
      ico.style.backgroundPosition = 'center';
      ico.textContent = '';
    }, function () {
      ico.textContent = (name || '?').slice(0, 2).toUpperCase();
    }, thumb(tok, 48));
    top.appendChild(ico);
    var meta = el('div', 'asset-meta');
    var nr = el('div', 'asset-name-row');
    var anm = el('span', 'asset-name');
    plain(anm, name + (frozen ? ' (frozen)' : ''));
    nr.appendChild(anm);
    // The phone's card carried no tick at all — not LUMOS's either — so the two renderers disagreed
    // about every holding. Same rule, same node shape, so applyTicks() reaches both.
    markVerified(nr, tok);
    meta.appendChild(nr);
    meta.appendChild(el('div', 'asset-sub', sub || ''));
    top.appendChild(meta);
    var bal = el('div', 'asset-balance-block');
    bal.appendChild(el('div', 'v1', right));
    if (rightSub) bal.appendChild(el('div', 'v2', rightSub));
    top.appendChild(bal);
    row.appendChild(top);
    return row;
  }

  // BOTH containers exist on every wallet page -- the design keeps a table and a card list and shows
  // one by media query. Taking whichever is found first would fill the hidden one and leave the
  // visible one empty, which on a phone looks exactly like the page failing to load.
  // getClientRects() cannot be used to decide: both are EMPTY at this point and so have no rects.
  function hidden(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  function host() {
    var t = $('#assetsTable'), l = $('#assetList');
    if (t && !hidden(t)) return { node: t, kind: 'table' };
    if (l && !hidden(l)) return { node: l, kind: 'cards' };
    if (t) return { node: t, kind: 'table' };
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  // The mobile design ships an anti-flash gate inherited from the Stellar build:
  //     body:not(.lxmw-ready) #assetList { visibility: hidden }
  // and it lifts only when window.__lxWalletEarly / __lxWalletReady is set -- flags that belonged to
  // Stellar's wallet data layer, which does not exist here. Left alone the phone renders a page that
  // is fully populated and completely invisible: 65 correct cards, correct colours, opacity 1, and
  // nothing on screen. Nothing in the console, because nothing is wrong.
  //
  // This layer is now the thing that fills that list, so it is the thing that says it is ready. Set
  // BOTH: the flag, for the design's own pass() when it runs after us, and the class, for when it has
  // already run. Called before the first note(), so the loading and error messages are visible too --
  // they live inside the gated container.
  // THE SAME TRAP HAS A SECOND DOOR, and stripping the Stellar layer is what closed it. lx-walletdata
  // is gone but its STYLESHEET stays -- a stripped script takes its markup and its logic with it and
  // leaves every rule it relied on standing. Four of those rules wait on a class only that script ever
  // set:
  //     body:not(.lx-wd-ready) .value-side .sub-value          { visibility: hidden }
  //     body:not(.lx-wd-ready) .asset-tabs .cnt                { visibility: hidden }
  //     body:not(.lx-wd-ready) h2 .meta, h3 .meta              { visibility: hidden }
  //     body:not(.lx-wd-ready) .insight-card ... .headline,.sub{ visibility: hidden }
  //
  // So the USD sub-total, all four tab counts and the holdings summary were computed correctly, written
  // correctly, and invisible -- reading them back through the DOM returned the right strings the whole
  // time, which is exactly why this survived several rounds of checking. Only a screenshot showed the
  // tabs with no numbers on them.
  //
  // This layer fills those elements now, so it raises the flag for them, the same way it does the
  // mobile one directly above.
  function lift() {
    try {
      window.__lxWalletReady = 1;
      document.body.classList.add('lxmw-ready');
      document.body.classList.add('lx-wd-ready');
    } catch (e) {}
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 5;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function setMeta(held, pools, xrp) {
    var n = held + (xrp ? 1 : 0);
    // The summary line is NOT written here any more. This used to take $('.section-heading .meta') —
    // the first match — and the first .section-heading on this page is Open Orders, so the holdings
    // summary landed on the orders section while My Assets kept its mock. setChip() writes every
    // summary, scoped to the headings that are actually about holdings; doing it in one place is what
    // stops the two from disagreeing.
    // THE COUNTS WERE CROSS-WIRED. '.asset-tabs .cnt' also matches the two tabs buildTabs() inserts —
    // Open orders and Claimable payments — and they come FIRST in the DOM. So [0] and [1] were writing
    // the holdings count into "Open orders" and the pool count into "Claimable payments", which is why
    // this account showed "Open orders 10" (its 10 holdings) and "Claimable payments 0" (its 0 pools),
    // while Assets and Liq Pools kept the design's 5 and 2. Every number on that row was wrong and two
    // of them looked plausible.
    //
    // Excluded by .lx-wcgroup, the marker buildTabs() stamps on its own group. Stellar carries the
    // identical guard for the identical reason; matching its name keeps one contract across both
    // builds rather than two selectors that happen to agree today.
    var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
      return !(c.closest && c.closest('.lx-wcgroup'));
    });
    if (cnt[0]) cnt[0].textContent = String(n);
    if (cnt[1]) cnt[1].textContent = String(pools);
  }

  function paint(data) {
    var h = host();
    if (!h) return;
    h.node.innerHTML = '';
    var make = h.kind === 'table' ? tableRow : card;

    // XRP first, carrying the number people actually need: what is spendable once the reserve is out.
    if (data.xrp) {
      var rs = data.xrp.reserved != null
        ? (fmt(data.xrp.spendable, 6) + ' spendable · ' + fmt(data.xrp.reserved, 2) + ' reserved')
        : 'reserve unknown';
      // null marks the native asset: it has no issuer, so its logo id cannot be derived.
      h.node.appendChild(make('XRP', 'XRP Ledger', balTxt(data.xrp.balance) + ' XRP', rs, false, null));
    }

    data.held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < data.held.length; i++) {
      var t = data.held[i];
      h.node.appendChild(make(t.display, short(t.issuer), balTxt(t.balance) + ' ' + t.display, '', t.frozen, t));
    }

    if (!data.held.length && !data.xrp) note(h, 'Nothing held on this account yet.');
    hideSparkHead();
    claimRowActions();
    setMeta(data.held.length, data.pools.length, data.xrp);
    setChip();
    clearTotalMock();
    revealAll();
  }

  // Releases the page's card-reveal gate on the containers this layer fills.
  //
  // The design fades sections in on scroll. Its driver takes a snapshot of what to watch ONCE, at
  // DOMContentLoaded, and drops anything that is hidden at that instant — so an element the wallet
  // gates until its data lands is never observed, and when the gate finally lifts the reveal rule is
  // still holding it at opacity 0. Nothing re-runs. The section is then invisible for good.
  //
  // .assets-card is where that landed: the whole My Assets card, 560px of correct, priced, real
  // holdings, on a blank screen. It answers every DOM query — ten rows, right numbers, opacity 1 on
  // the rows themselves — because the zero is on the container. That is why this needed a screenshot
  // to find and could not have been caught by reading the page.
  //
  // Safe to call broadly: this only clears an opacity gate. An element hidden for a real reason —
  // display:none on the inactive Liq Pools panel — stays hidden, because that is a different rule.
  function revealAll() {
    var SEL = '.hero, .insight-card, .assets-card, .lp-card, .orders-block, .orders-stack';
    [].forEach.call(document.querySelectorAll(SEL), reveal);
  }

  // Blanks the Total Portfolio headline the moment real rows are painted.
  //
  // prices.js fills this block properly, but it needs a price fetch first, so for roughly two seconds
  // the largest number on the page read "31,108.45 APT" — a fabricated Aptos figure sitting above ten
  // real XRP Ledger holdings. Worse, when that fetch is slow or fails the mock never gets overwritten
  // at all: on one load it was still showing nine seconds in, which is indefinitely as far as anyone
  // reading the page is concerned.
  //
  // So the mock is cleared here rather than merely overwritten later. An em dash reads as "not in yet"
  // and is self-evidently not a balance; a stale number from another chain reads as your money. This
  // layer knows the holdings but not their prices, so it cannot fill the total itself — it can only
  // make sure nothing false occupies the slot while prices.js is on its way.
  // THE HERO'S TOTAL EXISTS IN TWO SHAPES, and only one was ever addressed.
  //
  // Desktop is `.value-side` wrapping `.value` / `.sub-value`. The PHONE has no `.value-side` at
  // all — it is `.portfolio-value` (with the unit in a `.unit` span) and `.portfolio-sub`. So both
  // the clear below and prices.js's paintTotal returned on their first line, and a phone showed the
  // design's mock permanently: "31,108.45 APT" as the largest number on the page, "≈ $12,847.62
  // USD" under it, "+11.08%" and "+3,114.20 APT" beside it. Four fabricated figures describing
  // someone's holdings, on the wallet page, in another chain's asset, and never replaced.
  //
  // Resolved in ONE place and published, because prices.js needs exactly the same four elements and
  // two copies of this lookup is two things to update when a variant changes.
  function totalBlock() {
    var vs = $('.value-side');
    if (vs && vs.querySelector('.value')) {
      return {
        root: vs, value: vs.querySelector('.value'), sub: vs.querySelector('.sub-value'),
        pill: vs.querySelector('.delta-pill'), secondary: vs.querySelector('.delta-secondary')
      };
    }
    var pv = $('.portfolio-value');
    if (!pv) return null;
    return {
      root: pv.parentElement || pv, value: pv, sub: $('.portfolio-sub'),
      pill: $('.delta-pill'), secondary: $('.delta-secondary')
    };
  }
  try { window.lxxTotals = totalBlock; } catch (e) {}

  function clearTotalMock() {
    var b = totalBlock();
    if (!b || b.root.getAttribute('data-lxxcleared')) return;
    var v = b.value;
    if (v) {
      var unit = v.querySelector('span');
      var first = v.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = '— ';
      else v.insertBefore(document.createTextNode('— '), v.firstChild);
      if (unit) unit.textContent = 'XRP';
    }
    if (b.sub) b.sub.textContent = '';
    if (b.pill) { b.pill.style.visibility = 'hidden'; }
    if (b.secondary) b.secondary.textContent = '';
    b.root.setAttribute('data-lxxcleared', '1');

    // prices.js may already have fetched and given up because this list was still empty when its
    // response landed. Nudging it here closes that race from the side that knows the rows now exist.
    try { if (window.__lxxPricesApply) window.__lxxPricesApply(); } catch (e) {}
  }

  // The header chip shipped showing the design's mock address, `0x09c7…a802` — an EVM-shaped string
  // on an XRP Ledger wallet page, sitting above this account's real balances. Whatever else is wrong
  // on a page, the address it claims to be showing must be the one that is connected.
  function setChip() {
    var a = addr();
    if (!a) return;
    var chip = $('.wallet-chip .text') || $('.wallet-chip .addr');
    if (chip && chip.textContent.trim() !== short(a)) chip.textContent = short(a);
    // `.hero-id-row .wallet-chip .text:not(.lxp)` is hidden by the inherited sheet — which is the
    // "wallet address is empty" top left (RAZA 2026-09-15). Written correctly, never released.
    if (chip) chip.classList.add('lxp');
    // "COPIED TO CLIPBOARD", as lumoscore.com says (RAZA 2026-09-15). The design's copy handler builds its toast from
    // data-copy-label — "Wallet address copied to clipboard" — so the label is removed from the address controls.
    [].forEach.call(document.querySelectorAll('.wallet-chip [data-copy-label], .hero-id-row [data-copy-label]'), function (b) {
      b.removeAttribute('data-copy-label');
    });

    // THE PAGE HAS MORE THAN ONE HOLDINGS SUMMARY. setMeta writes $('.section-heading .meta'), which
    // is the FIRST match — and a second one lives in another .section-heading further down, so it kept
    // the mock "5 holdings · 31,108.45 APT total" while the list beneath it was already correct.
    // querySelector returning the first of several is the quiet version of this bug; take them all.
    var d = window.__lxxData;
    if (!d) return;
    var n = d.held.length + (d.xrp ? 1 : 0);
    // Stellar's wording: "3 Holdings | Total worth: ~326 XLM". The worth arrives with prices (prices.js).
    var line = n + (n === 1 ? ' Holding' : ' Holdings')
      + (window.__lxxWorthXrp > 0 ? (' | Total worth: ~' + Math.round(window.__lxxWorthXrp).toLocaleString('en-US') + ' XRP') : '');
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta'), function (m) {
      // Only summaries, never an activity row's own .meta (which is "From r… · 06:16").
      if (!/holding|APT|Aptos/i.test(m.textContent || '')) return;
      // AND ONLY THE ONES ABOUT HOLDINGS. Matching on the mock's text alone was too loose: the Open
      // Orders heading shipped its own meta reading "3,442 APT", which matched, so that section
      // announced "10 holdings · 15.57 XRP" above a list of orders. The test has to be what the
      // section IS, not what its placeholder happened to say.
      var head = m.closest('.section-heading, h2, h3');
      // The heading's title WITHOUT its own .meta. Reading head.textContent whole was circular: the
      // meta is inside the heading, so once anything had written "10 holdings" into it, the heading
      // matched /holding/ and kept qualifying on every later pass — the guard authorised exactly the
      // write it was meant to prevent.
      var title = '';
      if (head) {
        [].forEach.call(head.childNodes, function (nd) {
          if (nd.nodeType === 1 && nd.classList && nd.classList.contains('meta')) return;
          title += (nd.textContent || '') + ' ';
        });
      }
      if (!/asset|holding|portfolio|balance/i.test(title)) {
        // Not a holdings summary — but it still held an Aptos figure ("3,442 APT") that nothing on
        // this build fills. Leaving it would trade one wrong number for another, so it is emptied.
        if (/APT|Aptos/i.test(m.textContent || '')) m.textContent = '';
        return;
      }
      m.textContent = line;
    });
  }
  try { window.__lxxSetChip = setChip; } catch (e) {}

  // ---- Open orders and Claimable -------------------------------------------------------------------
  // Both tabs were driven by Stellar layers (lx-qorders, lx-wclaim) that queried horizon.stellar.org
  // and could only ever come back empty here. Those are stripped; these read the XRP Ledger.
  //
  // THE TABS ARE NOT IN THE MARKUP, which cost a deploy to learn. Reading the built page for
  // ".lx-wctab" found it and I took that for design markup — but every hit was a CSS rule and this
  // file's own selector. On Stellar the bar is BUILT AT RUNTIME by _walletclaim.js, so stripping that
  // layer took the Open orders and Claimable tabs off the page entirely, and the painters below had
  // nothing to write into. The check that would have caught it is querySelector in a live page, not
  // grep in a built one: markup you can find in the HTML and markup a script creates look identical
  // in a text search and are opposites in the DOM.
  //
  // So the bar is rebuilt here, structurally identical to Stellar's — same classes, same copy, same
  // two insight cards folded away — which is why it inherits lx-qorders-css and lx-wclaim-css and
  // looks the same. This is a port of the same layer, not a new design.
  //
  // "Claimable payments" is Stellar's claimable-balance feature, which this ledger does not have, so the
  // tab is NOT built here (RAZA 2026-09-15: "remove the claimable tab on XRPL"). Open orders stands alone.
  function selectTab(which) {
    var tabs = document.querySelectorAll('.lx-wctab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-t') === which);
    }
    var o = $('.lx-wcpanel-orders'), c = $('.lx-wcpanel-claim');
    if (o) { if (which === 'orders') o.removeAttribute('hidden'); else o.setAttribute('hidden', ''); }
    if (c) { if (which === 'claim') c.removeAttribute('hidden'); else c.setAttribute('hidden', ''); }
  }

  function buildTabs() {
    // The desktop wraps these three cards in .insights-rail and the phone in .insights-stack. Both,
    // or the tabs appear on one device only.
    var stack = $('.insights-stack,.insights-rail');
    if (!stack || $('.lx-wctabs')) return;

    // Found by what they SAY, not by position: the stack's order is the design's to change.
    var cards = [].slice.call(stack.querySelectorAll('.insight-card'));
    var ordersCard = null, poolsCard = null;
    cards.forEach(function (c) {
      var t = ((c.querySelector('.ttl') || {}).textContent || '').trim();
      if (/open orders/i.test(t)) ordersCard = c;
      if (/liquidity pools/i.test(t)) poolsCard = c;
    });
    if (!ordersCard && !poolsCard) return;
    // These two shipped reading "3 Active" and "3,442 APT" — mock figures on an XRP Ledger account.
    // The tabs replace them and carry the real counts, so the mocks go with the cards.
    if (ordersCard) ordersCard.style.display = 'none';
    if (poolsCard) poolsCard.style.display = 'none';

    var bar = document.createElement('div');
    bar.className = 'asset-tabs-row lx-wctabs';
    // lx-wcgroup is load-bearing, and it is Stellar's own fix for the bug this file hit independently:
    // reusing .asset-tabs is what makes these tabs match the Assets / Liq Pools pair exactly, but it
    // puts a SECOND .asset-tabs group on the page, and setMeta addresses that class by index. The
    // marker lets it exclude this group by name instead of hoping about DOM order.
    bar.innerHTML = '<div class="asset-tabs lx-wcgroup">'
      + '<button class="lx-wctab active" type="button" data-t="orders">Open orders'
      + ' <span class="cnt">0</span></button>'
      + '</div>';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lx-wctab');
      if (b) selectTab(b.getAttribute('data-t'));
    });

    // The orders list the page already ships becomes the first panel; the second is ours. Desktop
    // ships .orders-block, the phone ships .orders-stack — take whichever is here.
    var orders = $('.orders-block') || $('.orders-stack');
    var host = orders ? orders.parentNode : stack.parentNode;
    var anchor = orders || stack.nextSibling;

    var pOrders = document.createElement('div'); pOrders.className = 'lx-wcpanel lx-wcpanel-orders';

    host.insertBefore(bar, anchor);
    host.insertBefore(pOrders, anchor);
    if (orders) {
      // The list's own heading comes with it where there is one, so the tab does not end up floating
      // above a section title that repeats what the tab already says. Only the duplicated title text
      // is hidden; anything else in that header (a Cancel all control) stays reachable.
      var head = orders.previousElementSibling;
      if (head && /open orders/i.test(head.textContent || '') && head.querySelector('h2,h3')) {
        var hh = head.querySelector('h2,h3');
        if (hh) hh.style.display = 'none';
        pOrders.appendChild(head);
      }
      pOrders.appendChild(orders);
    }

    // "CANCEL ALL" MOVES ONTO THE TAB ROW (RAZA 2026-09-17: "place the cancel all button aligning with Claimable payments
    // (but on right side)"). It belongs to the heading this layer hides, so it was left sitting on a line of its own above
    // the tabs. Re-parented, not restyled — the design's own button, at the end of the row the tabs are on.
    // Searched across the page, not inside the panel: the control lives in its own `.section-heading .right`, a sibling of
    // the orders list rather than a child of it, so looking only within the panel found nothing.
    var cancel = null;
    [].slice.call(document.querySelectorAll('.section-heading .ctrl-btn, .section-heading button, .section-heading a')).forEach(function (b) {
      if (!cancel && /cancel all/i.test(b.textContent || '')) cancel = b;
    });
    if (cancel) {
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '10px';
      cancel.style.marginLeft = 'auto';
      bar.appendChild(cancel);
    }

    // Always opens on Open orders: it is the list with money at stake and an action attached.
    selectTab('orders');
  }

  function setTab(which, n) {
    var t = document.querySelector('.lx-wctab[data-t="' + which + '"] .cnt');
    if (t) t.textContent = String(n);
  }

  // Fills one cloned .order-row from one account_offers entry.
  //
  // WRITTEN AFTER FLATTENING IT ONCE. The first version set .order-pair's textContent, which replaced
  // the two token circles, the pair name and the Buy/Sell pill with a single string — the row rendered
  // as "997,393.739396 XYIELD → 9,973.937392 XRP Price 0.0142 APT Amount 10,000 USDT" because the real
  // pair had eaten the design's structure while the three mock columns beside it were never touched.
  // Every field the design ships gets written or removed here; none is left holding another chain's
  // numbers, and none is written by destroying the element that held it.
  //
  // XRPL semantics: an offer says "I give taker_gets, I want taker_pays". From the owner's side that
  // is always a SELL of taker_gets, so the pill is fixed — there is no buy-side offer to mirror.
  // Sets short text on an element the LOGO ENGINE would otherwise claim.
  //
  // The page carries a 76KB unnamed layer (window.__lumosLogoEngine) that treats ANY element holding
  // one to five characters as a ticker badge: it paints a logo into the background and empties the
  // text. It re-runs a few seconds after load, so writing the text once is not enough.
  //
  // It cost a deploy to find, because the failure looks like nothing. The Buy/Sell pill came back
  // EMPTY with a Tether logo behind it — the mock row said "10,000 USDT", the engine had already
  // claimed that row's pill and stamped data-logo="USDT" on it, and cloning the row as a template
  // carried the stamp onto every real order. Setting .textContent afterwards was undone on the
  // engine's next pass, because its own test short-circuits on that attribute:
  //     if (el.getAttribute('data-logo')) return true;
  //
  // So the stamp is what has to go, not just the text. Once it is gone the element is judged on its
  // content, and neither "Sell" nor a single letter matches any symbol it knows, so it is left alone.
  function plain(el, text) {
    try {
      el.removeAttribute('data-logo');
      el.style.background = '';
      el.style.backgroundImage = '';
      // data-logoed is the engine's OWN "already handled, leave alone" marker — it skips such nodes
      // exactly as it skips an <svg> or an <img>. Claiming the element with its own contract is a far
      // better opt-out than smuggling an SVG in to look unappetising, and it survives its re-runs.
      el.setAttribute('data-logoed', '1');
    } catch (e) {}
    el.textContent = text;
  }

  var DOMS = {};
  function domainFor(t, cb) {
    var k = t.issuer + '-' + t.currency;
    if (!DOMS[k]) {
      DOMS[k] = fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(k))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var dm = (d && d.ok && d.domain) ? String(d.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
          if (t.issuer === 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha') return 'lumoscore.com';
          dm = dm.split(':')[0].toLowerCase().replace(/^www\./, '');
          var dp = dm.split('.');
          return dp.length > 2 ? dp.slice(-2).join('.') : dm;
        })
        .catch(function () { return ''; });
    }
    DOMS[k].then(cb);
  }
  if (!window.__lxxVasset) {
    window.__lxxVasset = 1;
    window.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.lx-vasset[href^="/trade/xrpl/"]');
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }

  function orderRow(tpl, o) {
    var row = tpl.cloneNode(true);

    // data-oid IS WHAT MAKES THE ROW VISIBLE, and its absence is invisible in every way that matters.
    // The design ships an anti-flash gate:
    //     .orders-block .order-row:not([data-oid]) { display: none }
    // whose job is to keep the mock rows hidden until a data layer vouches for one by stamping it. So
    // a row can be in the DOM, opacity 1, visibility visible, every field correct — and occupy zero
    // pixels. It read as a working desktop panel through the DOM and as an empty gap on screen, and
    // only measuring the rendered box found it. The offer sequence is the ledger's own id for the
    // offer, so it is what the row is stamped with.
    row.setAttribute('data-oid', String(o.seq));

    var gets = amt(o.taker_gets), pays = amt(o.taker_pays);
    var gc = gets ? gets.code : '?', pc = pays ? pays.code : '?';

    // STELLAR'S ROW (RAZA 2026-09-15: "View asset text link is not there like on Stellar"): the token's logo and code, then
    // its home domain and "View asset". The pair the design printed ("XYIELD / XRP", two lettered discs) is not it.
    var tok = (gets && gets.code !== 'XRP') ? gets : pays;
    var nm = row.querySelector('.pair-text .name');
    if (nm) nm.textContent = tok ? tok.code : (gc + ' / ' + pc);
    // Desktop puts the pill inside .pair-text as .side; the phone puts it beside .order-pair as
    // .order-side. Same two modifier classes, different element — so the class is rebuilt from
    // whichever base name this layout uses rather than hardcoding one of them.
    var side = row.querySelector('.pair-text .side, .order-side');
    if (side) {
      side.className = (side.classList.contains('order-side') ? 'order-side' : 'side') + ' sell';
      plain(side, 'Sell');
    }

    // The two circles ship carrying APT and USDT artwork. There is no logo source wired here yet, so
    // they fall back to the design's own lettered treatment rather than keep another chain's tokens.
    var ico = row.querySelectorAll('.pair-ico .b');
    for (var ik = 1; ik < ico.length; ik++) if (ico[ik].parentNode) ico[ik].parentNode.removeChild(ico[ik]);
    if (ico[0]) {
      plain(ico[0], '');
      ico[0].style.background = 'transparent';
      var oim = document.createElement('img');
      oim.alt = '';
      oim.src = (tok && tok.issuer)
        ? ('/lxapi/xrplthumb?iss=' + encodeURIComponent(tok.issuer) + '&cur=' + encodeURIComponent(tok.currency) + '&w=48')
        : '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
      oim.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
      ico[0].appendChild(oim);
    }
    var ptx = row.querySelector('.pair-text');
    if (ptx && tok && tok.issuer && !ptx.querySelector('.lx-ameta')) {
      var meta = el('span', 'lx-ameta');
      meta.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-left:8px;font-size:10.5px;font-weight:600;color:var(--text-soft,#8a8fa3)';
      var hd = el('span', 'lx-hd');
      hd.setAttribute('data-logoed', '1');
      meta.appendChild(hd);
      var va = el('a', 'lx-vasset', 'View asset');
      va.href = '/trade/xrpl/' + encodeURIComponent(tok.code + '-' + tok.issuer);
      va.style.cssText = 'color:var(--accent,#ea6a2c);text-decoration:none;font-weight:700';
      meta.appendChild(va);
      ptx.appendChild(meta);
      domainFor(tok, function (dom) {
        if (!dom || !hd.parentNode) return;
        hd.textContent = dom;
        hd.parentNode.insertBefore(el('span', null, '·'), va);
      });
    }

    var cols = row.querySelectorAll('.order-details .col');
    var price = (gets && pays && gets.value) ? (pays.value / gets.value) : null;
    var vals = [
      price != null ? fmt(price, 6) + ' ' + pc : '—',
      gets ? fmt(gets.value, 6) + ' ' + gc : '—',
      pays ? fmt(pays.value, 6) + ' ' + pc : '—'
    ];
    for (var i = 0; i < cols.length && i < 3; i++) {
      var v = cols[i].querySelector('.v');
      if (v) v.textContent = vals[i];
    }

    // The design shows "42% filled" over a progress bar. The XRP Ledger does not publish that: an
    // offer on the books reports only what REMAINS of it, so there is no original size to measure a
    // fill against. A bar with a number nobody can derive is worse than no bar, so it is removed.
    var prog = row.querySelector('.order-progress-wrap');
    if (prog && prog.parentNode) prog.parentNode.removeChild(prog);

    // Cancel is live now: browser/write.js picks the click up off this row and cancels by data-oid,
    // which is why that attribute is the offer's own sequence number rather than a display index.
    // It was disabled here while no signing path existed; re-enabled with that path, not before.
    return row;
  }

  // Releases an element from the page's card-reveal gate.
  //
  // The design fades sections in on scroll:
  //     html.lcm-ready .orders-block:not([data-lcm-done]) { opacity: 0; transform: translateY(8px) }
  // with a driver that adds .lcm-on when the element comes into view. buildTabs() moves .orders-block
  // into a new panel, and after that move the driver never released it — so the panel sat at opacity 0
  // holding a correctly built, correctly sized, fully painted order row that nobody could see. The row
  // even answered elementFromPoint, because a transparent element is still hit-testable; the only
  // measurement that showed the truth was its computed opacity.
  //
  // data-lcm-done is the gate's own "already handled" attribute, so setting it opts the element out
  // rather than fighting the rule, and .lcm-on covers the case where the driver has since run.
  function reveal(node) {
    if (!node) return;
    try {
      node.setAttribute('data-lcm-done', '1');
      node.classList.add('lcm-on');
    } catch (e) {}
  }

  function paintOrders(me) {
    rpc('account_offers', { account: me, ledger_index: 'validated', limit: 50 })
      .then(function (r) {
        var offers = r.offers || [];
        setTab('orders', offers.length);

        // The Open Orders heading ships its own summary reading "3 active". Nothing filled it, so it
        // sat directly above a tab correctly badged "Open orders 1" — two counts of the same thing,
        // side by side, disagreeing, with the invented one in the larger type.
        [].forEach.call(document.querySelectorAll('.section-heading'), function (sh) {
          var m = sh.querySelector('.meta');
          if (!m) return;
          var title = '';
          [].forEach.call(sh.childNodes, function (nd) {
            if (nd === m || (nd.contains && nd.contains(m))) {
              // walk into the wrapper but skip the meta itself
              [].forEach.call(nd.childNodes || [], function (k) { if (k !== m) title += (k.textContent || '') + ' '; });
              return;
            }
            title += (nd.textContent || '') + ' ';
          });
          if (/open orders/i.test(title)) {
            m.textContent = offers.length + ' active';
          }
        });

        // TWO LAYOUTS, AND ONLY ONE OF THEM WAS WIRED. Desktop lists orders as .order-row inside
        // .orders-block; the phone lists them as .order-card inside .orders-stack — different
        // container, different item, same fields. Keying on the desktop pair alone meant the phone
        // showed the tab correctly badged "Open orders 1" above a completely empty panel: the count
        // came from the ledger, the list came from markup that was never found, and nothing errored.
        var block = $('.lx-wcpanel-orders .orders-block') || $('.lx-wcpanel-orders .orders-stack')
          || $('.orders-block') || $('.orders-stack');
        if (!block) return;
        var rowT = block.querySelector('.order-row, .order-card');
        if (!rowT) return;
        rowT = rowT.cloneNode(true);
        block.innerHTML = '';

        // CANCEL ALL FOLLOWS THE ORDERS. It lives in the section header, outside this block, so
        // emptying the block left it sitting above "No open orders on this account." offering to
        // cancel nothing. RAZA 2026-10-11: "why's it even there when I don't have any open orders".
        // Stellar hides it in exactly this branch (_walletdata.js, twice -- on render and again in
        // orderCount), which is the behaviour being matched.
        //
        // It also ships as <a href="#" id="cancelAllBtn"> with NO CLASS, so it rendered in the
        // browser's default link blue, underlined, among styled controls -- "why cancel all shown in
        // blue". Styled here rather than in a stylesheet because the element is the design's and
        // carries an id, not a class, so there is nothing to hook a rule onto that would not be
        // inventing one.
        var cah = document.getElementById('cancelAllBtn')
          || document.querySelector('.order-cancel-all,[data-cancel-all]');
        if (cah) {
          cah.style.display = offers.length ? '' : 'none';
          // -webkit-text-fill-color AS WELL AS color, because that property wins over color for the
          // rendered text and the UA sets it on a link. Measured on a fresh load: font-weight and
          // text-decoration from this very same inline style applied, and color alone did not --
          // computed color stayed rgb(0,0,238) with -webkit-text-fill-color matching it. Setting one
          // without the other leaves the anchor default-blue however loudly the color is declared.
          cah.style.color = 'var(--accent, #ea6a2c)';
          cah.style.setProperty('-webkit-text-fill-color', 'var(--accent, #ea6a2c)');
          cah.style.textDecoration = 'none';
          cah.style.fontWeight = '600';
          cah.style.fontSize = '13px';
          cah.style.cursor = 'pointer';
        }

        if (!offers.length) {
          var d = el('div', 'lx-wcnote', 'No open orders on this account.');
          block.appendChild(d);
          reveal(block);
          return;
        }
        offers.forEach(function (o) {
          block.appendChild(orderRow(rowT, o));
        });
        reveal(block);
      }).catch(function () { /* leave the design's block rather than empty it on a dropped request */ });
  }

  // ---- Activity ------------------------------------------------------------------------------------
  // The design ships thirty rows of invented transactions — "Received USDT from 0x0222…02b2",
  // "Sell 500 APT @ 0.4128" — dated today and sitting under this account's real balances. That is the
  // most dangerous thing on the page: a blank section reads as unfinished, a fabricated one reads as
  // your history. The dashboard's own activity feed was replaced for exactly this reason.
  //
  // The design's markup is reused, not replaced: a real .activity-row and .day-divider are kept as
  // templates and cloned, so every class, icon and layout stays the design's.
  var TYPES = {
    Payment: 'Payment', OfferCreate: 'Order', OfferCancel: 'Cancelled order',
    TrustSet: 'Trustline',
    // AMMCreate and AMMDelete were missing entirely, so they fell through to the raw ledger name and a
    // row read "AMMCreate" (RAZA 2026-10-06). Stellar calls both halves of this by what they did.
    AMMDeposit: 'Added liquidity', AMMCreate: 'Added liquidity',
    AMMWithdraw: 'Removed liquidity', AMMDelete: 'Removed liquidity',
    AccountSet: 'Account update', NFTokenMint: 'NFT mint'
  };

  // ONE ICON PER KIND, WHICH IS WHAT MADE EVERY ROW LOOK THE SAME (RAZA 2026-10-06: "Swap icon is
  // different").
  //
  // The icon was only ever given a CLASS — `received` / `sent` / `swap` — and the glyph inside it stayed
  // whatever the cloned template held, a down arrow. So a Swap, an Order and an AMMCreate all showed the
  // same arrow in the same red disc, and the class did nothing visible for the kinds the sheet has no
  // colour for. Stellar swaps the SVG as well, and that is the difference you can actually see.
  //
  // These are lumoscore.com's own glyphs, read out of its live lx-56d7256e855a.js, so the two feeds draw
  // the same mark for the same thing. The colours need nothing added: `.activity-icon.received/.sent/
  // .swap/.order/.claim/.bridge/.contract` are all already in this build's inherited sheet, and `lp` has
  // no rule on EITHER side — its droplet sits on the base disc, which is how Stellar draws it too.
  var IC = {
    received: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    sent: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    swap: '<path d="M7 10l-3 3 3 3M4 13h11M17 14l3-3-3-3M20 11H9"/>',
    lp: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    order: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };
  function actIcon(kind) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[kind] || IC.swap) + '</svg>';
  }

  // An Asset / Asset2 on an AMM transaction is a SPEC, not an amount: {currency, issuer} with no value,
  // so amt() cannot read it. Same decoder as everywhere else, so a 40-char hex renders as its name.
  // The two reserves a pool action actually moved, as {value, code, currency, issuer}.
  //
  // Prefers the transaction's own Amount/Amount2 when it has them, because that is the exact request
  // and needs no interpretation. Falls back to the account's balance changes in the metadata, which is
  // the only place a tfWithdrawAll records what came back.
  //
  // The three traps in reading those changes, each checked against real transactions:
  //   * add the network Fee back to the AccountRoot delta, or a 1 XRP deposit reads as 1.000012
  //   * skip the pool's own LP token, whose currency code begins 03, or it appears as a third asset
  //   * a RippleState Balance is signed from the LOW account's side, so negate it when this account
  //     is the high one
  // Magnitudes only: the row's verb already says which direction it went.
  function lpMoved(tx, meta) {
    var a1 = amt(tx.Amount), a2 = amt(tx.Amount2);
    if (a1 && a2) return [a1, a2];
    if (a1) return [a1];

    var me = tx.Account, out = [];
    var nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length && out.length < 2; i++) {
      var w = nodes[i].ModifiedNode || nodes[i].DeletedNode || nodes[i].CreatedNode;
      if (!w) continue;
      var f = w.FinalFields || w.NewFields || {}, pv = w.PreviousFields || {};
      if (w.LedgerEntryType === 'AccountRoot') {
        if (f.Account !== me || pv.Balance === undefined) continue;
        var d = (Number(f.Balance) - Number(pv.Balance)) / 1e6 + (Number(tx.Fee || 0) / 1e6);
        if (Math.abs(d) > 1e-9) out.push({ value: Math.abs(d), code: 'XRP', currency: 'XRP' });
      } else if (w.LedgerEntryType === 'RippleState') {
        var bal = f.Balance || {}, pb = pv.Balance;
        if (pb === undefined || !bal.currency) continue;
        if (/^03/.test(String(bal.currency))) continue;              // the pool's own LP token
        var hi = (f.HighLimit || {}).issuer, lo = (f.LowLimit || {}).issuer;
        if (hi !== me && lo !== me) continue;
        var dv = (Number(bal.value) - Number(pb.value)) * (lo === me ? 1 : -1);
        if (Math.abs(dv) > 1e-12) {
          var dec = window.lxx.decodeCurrency(bal.currency);
          out.push({
            value: Math.abs(dv), code: (dec && dec.display) || bal.currency,
            currency: bal.currency, issuer: (lo === me ? hi : lo),
          });
        }
      }
    }
    return out;
  }

  function assetCode(spec) {
    if (!spec) return null;
    if (typeof spec === 'string' || spec.currency === 'XRP' || (!spec.currency && !spec.issuer)) {
      return { code: 'XRP', currency: 'XRP' };
    }
    var d = window.lxx.decodeCurrency(spec.currency);
    return { code: (d && d.display) || spec.currency, currency: spec.currency, issuer: spec.issuer };
  }

  // WHAT A SWAP ACTUALLY COST: SendMax is only a ceiling, so the spend is read from the ledger's own balance changes — the account's XRP
  // (less the network fee) or its trust line for the token given.
  function ownDelta(meta, me, give, tx) {
    var nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i].ModifiedNode || nodes[i].DeletedNode;
      if (!n) continue;
      var f = n.FinalFields || {}, pv = n.PreviousFields || {};
      if (give.code === 'XRP' && n.LedgerEntryType === 'AccountRoot' && f.Account === me && pv.Balance != null) {
        return (Number(pv.Balance) - Number(f.Balance) - Number(tx.Fee || 0)) / 1e6;
      }
      if (give.code !== 'XRP' && n.LedgerEntryType === 'RippleState' && pv.Balance && f.Balance
        && f.Balance.currency === give.currency) {
        var lo = f.LowLimit && f.LowLimit.issuer, hi = f.HighLimit && f.HighLimit.issuer;
        if (lo !== me && hi !== me) continue;
        if ((lo === me ? hi : lo) !== give.issuer) continue;
        var sgn = lo === me ? 1 : -1;
        return sgn * (Number(pv.Balance.value) - Number(f.Balance.value));
      }
    }
    return 0;
  }

  // An amount is either drops (a bare string) or an issued-currency object.
  function amt(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { value: +v / 1e6, code: 'XRP' };
    // Through lxx.decodeCurrency so a 40-char hex code renders as its name, exactly as the asset
    // list above renders it — one decoder, so the two cannot disagree about what a token is called.
    var d = window.lxx.decodeCurrency(v.currency);
    return { value: +v.value, code: (d && d.display) || v.currency, currency: v.currency, issuer: v.issuer };
  }

  // The design ships thirty invented rows in this block, so every exit from the activity path has to
  // say something rather than leave them. One helper, so a new exit cannot forget the clearing half.
  function activityNote(text) {
    var b = $('.activity-block');
    if (!b) return;
    b.innerHTML = '';
    var n = el('div', 'lxp');
    n.style.cssText = 'padding:22px;text-align:center;color:var(--text-muted);font-size:13px';
    n.textContent = text;
    b.appendChild(n);
  }

  function paintActivity(me) {
    var block = $('.activity-block');
    if (!block) return;
    var rowT = block.querySelector('.activity-row');
    var dayT = block.querySelector('.day-divider');
    if (!rowT) return;
    rowT = rowT.cloneNode(true);
    dayT = dayT ? dayT.cloneNode(true) : null;

    rpc('account_tx', { account: me, limit: 25, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (r) {
        var txs = r.transactions || [];
        // AN EMPTY HISTORY IS A RESULT, NOT A REASON TO SHOW SOMEONE ELSE'S. `return` here left the
        // design's thirty invented rows standing — "Received USDT from 0x0222…02b2", in APT, dated
        // today, under this account's real balances — which is the exact thing this function's header
        // calls the most dangerous content on the page. Measured: an account the ledger has no
        // transactions for rendered a full page of fabricated history.
        //
        // This is the commoner path of the two, not the rare one: every new wallet starts here.
        if (!txs.length) { activityNote('No activity on this account yet.'); return; }
        block.innerHTML = '';
        var lastDay = '';

        txs.forEach(function (t) {
          var tx = t.tx || t.tx_json || {};
          var meta = t.meta || t.metaData || {};
          if (typeof tx.date !== 'number') return;
          var when = new Date((tx.date + 946684800) * 1000);
          var day = when.toDateString();

          if (day !== lastDay && dayT) {
            lastDay = day;
            var dv = dayT.cloneNode(true);
            var today = new Date().toDateString();
            dv.textContent = (day === today ? 'Today · ' : '')
              + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            dv.classList.add('lxp');                           // gated like every other activity value
            block.appendChild(dv);
          }

          var row = rowT.cloneNode(true);
          var kind = TYPES[tx.TransactionType] || tx.TransactionType || 'Transaction';

          // A PAYMENT HAS THREE RELATIONSHIPS TO THIS ACCOUNT, NOT TWO.
          //
          // This read `incoming = Destination === me` and treated everything else as sent — so a
          // payment that merely RIPPLES THROUGH the account, where it is neither the sender nor the
          // recipient, landed in the "Sent" branch. Seen on the LUMOS pool account: the ledger says
          // the sender was rVVaR…, and the row said "Sent · To rVVaR…". It reported a payment the
          // account did not make, named the actual sender as the recipient, and signed the amount
          // as if it had left this wallet.
          //
          // An AMM or issuer account does this constantly, and any account whose trust line is used
          // as a path hop does it occasionally — so it is uncommon rather than rare, and "you sent
          // money" is not a thing to be casually wrong about on a wallet page.
          //
          // Pass-through is now its own case: the delivered amount belongs to the destination, not
          // to this account, so it carries no sign and no up/down colour, and both parties are
          // named rather than one of them being cast as the counterparty.
          // FOUR, in fact — the fourth being a payment from this account TO this account.
          //
          // That is not an oddity here, it is how a swap is expressed on this ledger, and it is
          // exactly what this project's own swap builds: a cross-currency Payment to self. Treating
          // "destination is me" as received labelled every one of them "Received · From <your own
          // address>" — measured, 14 rows of it on one account. A user swapping on LumosCore would
          // see their own swaps described as money arriving from themselves.
          //
          // The dashboard feed already calls these swaps and shows what was given beside what
          // arrived; this now matches it, so the same transaction reads the same way in both feeds.
          var isPayment = tx.TransactionType === 'Payment';
          var self = isPayment && tx.Account === me && tx.Destination === me;
          var incoming = isPayment && !self && tx.Destination === me;
          var outgoing = isPayment && !self && tx.Account === me;
          var through = isPayment && !self && !incoming && !outgoing;
          var other = incoming ? tx.Account : tx.Destination;

          // The AMM pair, and which way it went. AMMCreate and AMMDelete are the first and last
          // deposits into a pool, so they belong with their ordinary counterparts rather than under
          // their own raw names.
          var tt = tx.TransactionType;
          var isLp = tt === 'AMMDeposit' || tt === 'AMMCreate' || tt === 'AMMWithdraw' || tt === 'AMMDelete';
          var lpOut = tt === 'AMMWithdraw' || tt === 'AMMDelete';
          // BOTH HALVES OF AN LP ROW, WHICHEVER FIELDS THE TRANSACTION HAPPENS TO CARRY (RAZA
          // 2026-10-07: "now show the recent activity on wallet page like stellar").
          //
          // The two AMM shapes carry different fields, and this row was reading one of each, so every
          // pool action was missing half of what Stellar shows:
          //
          //   AMMCreate    Amount + Amount2, NO Asset/Asset2  -> amounts shown, pair missing from label
          //   AMMWithdraw  Asset + Asset2, NO Amount/Amount2  -> pair shown, amounts missing entirely
          //                (tfWithdrawAll, Flags 131072 — measured on RAZA's own withdrawals)
          //
          // lumoscore.com shows both on every pool row: the verb with both asset marks, over
          // "107.33 HOLA + 51,572 CANNACOIN". So the amounts come from the metadata when the request
          // does not carry them — which is also the figure that actually moved — and the pair falls
          // back to those amounts when Asset/Asset2 are absent.
          var lpAmts = isLp ? lpMoved(tx, meta) : null;
          var lpA = isLp ? (assetCode(tx.Asset) || (lpAmts && lpAmts[0])) : null;
          var lpB = isLp ? (assetCode(tx.Asset2) || (lpAmts && lpAmts[1])) : null;
          // The two lines of one row must name the pair in the SAME order. The label follows
          // Asset/Asset2 and the amounts come back in whatever order the metadata nodes appear, so a
          // row could read "ARMY + PHNIX" over "71.71 PHNIX + 0.09 ARMY" — both true, and
          // momentarily unreadable. The amounts are ordered to the label.
          if (lpAmts && lpAmts.length === 2 && lpA && lpB && lpAmts[0].code !== lpA.code
              && lpAmts[1].code === lpA.code) {
            lpAmts = [lpAmts[1], lpAmts[0]];
          }

          // The kind drives both the disc colour and the glyph, as it does on Stellar. A pass-through
          // is neither sent nor received, so it takes the neutral swap colour rather than the green of
          // money arriving or the red of money leaving.
          // NOT `kind` — that name is already the row's LABEL, a few lines up, and reusing it here
          // silently renamed every pool row "lp (failed)" instead of "Added liquidity". `var` is
          // function-scoped, so the second declaration is the same binding, and nothing warns.
          var icoKind = isLp ? 'lp'
            : (tt === 'OfferCreate' || tt === 'OfferCancel') ? 'order'
            : incoming ? 'received'
            : (isPayment && !through && !self) ? 'sent'
            : (isPayment || tt === 'TrustSet') ? 'swap'
            : 'contract';
          var ico = row.querySelector('.activity-icon');
          if (ico) {
            ico.className = 'activity-icon ' + icoKind;
            ico.innerHTML = actIcon(icoKind);
          }

          // Computed first now, because the label below names the assets.
          var dlv0 = meta.delivered_amount || meta.DeliveredAmount;
          if (dlv0 === 'unavailable') dlv0 = null;              // pre-2014 ledgers do not report it
          var got00 = amt(dlv0 || tx.Amount);
          var give00 = self ? amt(tx.SendMax) : null;

          // STELLAR'S ROW (RAZA 2026-09-15: "its different on Stellar. Also remove that confirmed tag for
          // literally every trx"): the kind, then each asset with its own mark — "Received ⊗ XRP",
          // "Swap ⊗ XRP → ⊗ FUZZY". No status pill: every row is a validated transaction, and the rare one
          // that failed says so in its label instead.
          var ty = row.querySelector('.type');
          if (ty) {
            var okTx = (meta.TransactionResult === 'tesSUCCESS');
            ty.textContent = (isPayment
              ? (self ? 'Swap' : incoming ? 'Received' : through ? 'Routed through' : 'Sent')
              : kind) + (okTx ? '' : ' (failed)');
            if (isLp && lpA && lpB) {
              // Stellar's shape exactly: the verb, then both sides of the pool with their own marks —
              // "Added liquidity ⊗ HOLA + ⊗ CANNACOIN". The row used to be the verb and nothing else.
              ty.appendChild(actLogo(lpA));
              ty.appendChild(document.createTextNode(lpA.code + ' +'));
              ty.appendChild(actLogo(lpB));
              ty.appendChild(document.createTextNode(lpB.code));
            } else if (isPayment && self && give00 && got00 && give00.code !== got00.code) {
              ty.appendChild(actLogo(give00));
              ty.appendChild(document.createTextNode(give00.code + ' →'));
              ty.appendChild(actLogo(got00));
              ty.appendChild(document.createTextNode(got00.code));
            } else if (isPayment && got00) {
              ty.appendChild(actLogo(got00));
              ty.appendChild(document.createTextNode(got00.code));
            }
          }

          // delivered_amount, never tx.Amount: on a path payment Amount is the MAXIMUM the sender
          // would allow, not what arrived — measured elsewhere in this project as a 33%
          // overstatement. Computed once here because both the meta line and the figure need it.
          var got0 = got00;

          var mt = row.querySelector('.meta');
          if (mt) {
            // A pass-through names BOTH ends: neither of them is this account's counterparty, and
            // picking one to show would be the same mistake in smaller print.
            // A swap names the two assets, not the two addresses — both of which are you. SendMax is
            // a maximum rather than a quantity, so only its CODE is used; the figure on the right is
            // the delivered amount, which is exact.
            // The counterparty, as Stellar's row has it; a swap's two assets are already in the label.
            var who = self ? ''
              : through ? ((tx.Account && tx.Destination) ? (short(tx.Account) + ' → ' + short(tx.Destination)) : '')
              : '';
            // THE COUNTERPARTY IS A LINK, AND THAT IS WHAT MAKES IT BOLD AND ORANGE (RAZA 2026-10-06:
            // "In sent transactions, To address is supposed to be bold and orange color").
            //
            // Stellar writes `metaPre + <a class="lx-addr-link">short</a>`, and this build's inherited
            // sheet ALREADY carries the rule — `.lx-addr-link{color:var(--accent,#ea6a2c);font-weight:600}`
            // — so nothing had to be styled here. The address was simply being written as plain text
            // into `.meta`, which is why it rendered grey beside Stellar's accent.
            //
            // Built as nodes rather than innerHTML: `other` is an address off a public ledger, and this
            // file's rule is that ledger-supplied values go in through textContent.
            var addrEl = null;
            if (!self && !through && other) {
              mt.textContent = incoming ? 'From ' : 'To ';
              addrEl = document.createElement('a');
              addrEl.className = 'lx-addr-link';
              addrEl.href = 'https://bithomp.com/explorer/' + encodeURIComponent(other);
              addrEl.target = '_blank';
              addrEl.rel = 'noopener';
              addrEl.textContent = short(other);
              addrEl.setAttribute('data-logoed', '1');     // the logo engine repaints short-text elements
            }
            // The two reserves that moved, as Stellar prints them: "107.33 HOLA + 51,572 CANNACOIN".
            // The note that used to sit here said a tfWithdrawAll "says nothing rather than inventing a
            // figure" — right not to invent one, wrong that there was none to find. The metadata has it;
            // lpMoved() reads it, so a withdrawal now prints the same line a deposit does.
            if (isLp && lpAmts && lpAmts.length) {
              who = lpAmts.map(function (x) { return fmt(x.value, 6) + ' ' + x.code; }).join(' + ');
            }
            // AN ORDER IS NOT A PAYMENT, AND HAD NOTHING TO SAY (RAZA 2026-10-02: "WTF is this blank trx").
            //
            // Every line on this row is built from a payment's shape: the counterparty comes from
            // Destination and the figure from delivered_amount. An OfferCreate has neither, so the row
            // came out as the word "Order" and three empty slots — a transaction the wallet admits
            // happened and then refuses to describe.
            //
            // What an order actually is, is a pair: TakerGets is what you put up, TakerPays what you
            // asked for. That is the line.
            var og = amt(tx.TakerGets), op = amt(tx.TakerPays);
            if (!who && og && op) who = fmt(og.value, 6) + ' ' + og.code + ' → ' + fmt(op.value, 6) + ' ' + op.code;
            // A cancellation names the order it withdrew, which is the only fact it carries.
            if (!who && tx.TransactionType === 'OfferCancel' && tx.OfferSequence) who = 'Offer #' + tx.OfferSequence;
            // The address branch already wrote the "To "/"From " prefix, so it only appends; every other
            // branch owns the whole line.
            if (addrEl) mt.appendChild(addrEl);
            else mt.textContent = who;
            mt.classList.add('lxp');
          }

          var a1 = row.querySelector('.a1');
          if (a1) {
            var got = got0;
            // A failed transaction moved nothing, so it shows no amount (its Amount is only what was asked for).
            if (isLp) {
              // Blank, as Stellar leaves it. A pool deposit moves TWO assets and the meta line above
              // already names both; printing one of them here, signed, said "−0.000013 ATOM" about a
              // transaction that also moved 1,410 PHNIX — half the story with a minus in front of it.
              a1.textContent = '';
              a1.classList.remove('up', 'down', 'swap');
            } else if (got && isFinite(got.value) && meta.TransactionResult === 'tesSUCCESS') {
              // No sign on a pass-through or a swap. On a pass-through the delivered amount is what
              // the DESTINATION received and this account's balance nets out across the hop; on a
              // swap one asset was given for another, so a lone "+" would report half of it. A "−"
              // in either case reads as money that left this wallet.
              // A swap reads "+1,018.8 TDT" over "−0.0998 XLM" on Stellar (RAZA 2026-09-16): what arrived, then what it cost.
              var sign = through ? '' : ((incoming || self) ? '+' : '−');
              a1.textContent = sign + fmt(got.value, 6) + ' ' + got.code;
              a1.classList.toggle('up', !!incoming);
              a1.classList.toggle('down', !incoming && !through && !self);
              a1.classList.toggle('swap', !!(through || self));
              // `.activity-amt .a1:not(.lxp)` is hidden by the inherited sheet — why rows showed no amount.
              a1.classList.add('lxp');
            } else if (tx.TransactionType === 'OfferCreate' && amt(tx.TakerGets)) {
              // The size of the order, unsigned: nothing has moved yet. A "−" here would report a spend
              // that has not happened, and an order can sit unfilled for as long as the book allows.
              var og1 = amt(tx.TakerGets);
              a1.textContent = fmt(og1.value, 6) + ' ' + og1.code;
              a1.classList.remove('up', 'down');
              a1.classList.add('swap', 'lxp');
            } else {
              a1.textContent = '';
            }
          }

          // The design's second line is a USD conversion, and it shipped as a fixed "≈ $7.42" on
          // every row. This layer has no price map — prices.js owns that — so the honest thing is to
          // clear it rather than repeat a number that was never about this transaction. An empty
          // slot says nothing; a stale one says something false on all 25 rows.
          var a2 = row.querySelector('.a2');
          if (a2) {
            a2.textContent = '';
            if (self && give00 && got00 && give00.code !== got00.code) {
              var spentV = ownDelta(meta, me, give00, tx);
              if (spentV > 0) { a2.textContent = '−' + fmt(spentV, 6) + ' ' + give00.code; a2.classList.add('lxp'); }
            }
          }

          // The explorer mark, at the end of the row — the same one the dashboard feed carries, so
          // both feeds on the site open the same explorer from the same place.
          try {
            var xl = window.lxxExplorer && window.lxxExplorer.link(
              window.lxxExplorer.txHash(t), 'View this transaction on Bithomp');
            if (xl) row.appendChild(xl);
          } catch (e) {}

          block.appendChild(row);
        });
      }).catch(function () {
        // A FAILED LOOKUP MUST NOT LEAVE THE DESIGN'S HISTORY ON SCREEN. "Leave the block alone" was
        // written to avoid blanking a section over a dropped request, but what it actually leaves is the
        // thirty invented rows this function's own header calls the most dangerous thing on the page —
        // "Received USDT from 0x0222…02b2", in APT, dated today, under a real account's balances.
        //
        // Found while verifying the icons: seeding an address that does not exist on the ledger produced
        // a full page of someone else's fabricated history rather than an error.
        //
        // An empty section reads as "nothing here"; this says which of the two it is.
        activityNote('Could not load activity for this account.');
      });
  }

  // ---- Liq Pools -----------------------------------------------------------------------------------
  //
  // RAZA 2026-09-15: "Whys it showing 2 pools when the count says 0. Also where did this APT come from."
  // The panel was the design's mock rows — APT / USDC, LUMOS / APT — and nothing ever replaced them.
  //
  // Each LP-token trust line IS a position, and its issuer is the pool's AMM account, so amm_info on it
  // gives the pair, the reserves and the LP supply; the account's share is its balance over that supply.
  // The design's own row is the template. APR and rewards have no ledger source and say so.
  function paintLpPositions(data) {
    var panel = document.getElementById('lpPanel');
    var body = panel && panel.querySelector('tbody');
    if (!body) return;
    var tpl = body.querySelector('tr');
    tpl = (tpl && tpl.children.length >= 6) ? tpl.cloneNode(true) : null;
    var pools = (data && data.pools) || [];
    function empty(text) {
      body.innerHTML = '';
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 6;
      td.style.cssText = 'padding:28px;text-align:center;color:var(--text-muted)';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    if (!pools.length || !tpl) { empty('No liquidity positions'); return; }
    empty('Reading your positions…');
    var usdP = fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
      .then(function (t) { return (t && t.ok && +t.usd > 0) ? +t.usd : null; }).catch(function () { return null; });
    Promise.all([usdP].concat(pools.map(function (lp) {
      return rpc('amm_info', { amm_account: lp.issuer, ledger_index: 'validated' })
        .then(function (r) { return { lp: lp, amm: r.amm }; }, function () { return { lp: lp, amm: null }; });
    }))).then(function (res) {
      var usd = res[0];
      var rows = res.slice(1).filter(function (x) {
        return x.amm && x.amm.lp_token && Number(x.amm.lp_token.value) > 0 && x.lp.balance > 0;
      });
      if (!rows.length) { empty('No liquidity positions'); return; }
      body.innerHTML = '';
      rows.forEach(function (x) {
        var m = x.amm, A = amt(m.amount), B = amt(m.amount2);
        var share = x.lp.balance / Number(m.lp_token.value);
        var tr = tpl.cloneNode(true), td = tr.children;

        var icos = tr.querySelectorAll('.lp-ico');
        [A, B].forEach(function (s, i) {
          var ic = icos[i];
          if (!ic) return;
          ic.innerHTML = '';
          var im = document.createElement('img');
          im.alt = '';
          im.src = s.issuer ? thumb({ issuer: s.issuer, currency: s.currency }, 48) : thumb(null, 48);
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
          ic.appendChild(im);
        });
        var nm = tr.querySelector('.lp-nm');
        if (nm) plain(nm, A.code + ' / ' + B.code);
        var sb = tr.querySelector('.lp-sb');
        // Stellar's wording and figures (RAZA 2026-09-15: "XRPL text on the row is different from Stellar"): "0.30% fee
        // tier · Stellar AMM" there, two decimals and the ledger's short name here.
        if (sb) sb.textContent = (m.trading_fee / 1000).toFixed(2) + '% fee tier · XRPL AMM';

        if (td[1]) {
          var s1 = td[1].querySelector('.p1'), s2 = td[1].querySelector('.p2');
          if (s1) s1.textContent = (share * 100).toFixed(share < 0.0001 ? 6 : 2) + '%';
          if (s2) s2.textContent = lpAmt(x.lp.balance) + ' LP tokens';
        }
        if (td[2]) { td[2].textContent = '—'; td[2].title = 'The XRP Ledger does not publish a pool APR'; }

        // STELLAR'S LIQUIDITY CELL: your share of each reserve — the first in the headline weight with its ticker small
        // beside it, the second underneath ("21.95 BOMB" over "938,225 FRANK"). It used to be an XRP value and a dollar
        // line for XRP pools and a "+"-joined pair otherwise.
        if (td[3]) {
          var q1 = td[3].querySelector('.p1'), q2 = td[3].querySelector('.p2');
          if (q1) {
            q1.textContent = lpAmt(A.value * share) + ' ';
            var un = el('span', null, A.code);
            un.style.cssText = 'color:var(--text-soft);font-size:14px';
            un.setAttribute('data-logoed', '1');
            q1.appendChild(un);
          }
          if (q2) q2.textContent = lpAmt(B.value * share) + ' ' + B.code;
        }
        if (td[4]) {
          var r1 = td[4].querySelector('.p1'), r2 = td[4].querySelector('.p2');
          if (r1) { r1.textContent = '—'; r1.style.color = ''; }
          if (r2) r2.textContent = 'fees accrue into the pool';
        }

        var btns = tr.querySelectorAll('.qa-row-btn');
        // Stellar's plus and minus (RAZA 2026-09-15: "Icon on Add and Remove is not that we have on Stellar").
        if (btns[0]) btns[0].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add';
        if (btns[1]) btns[1].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> Remove';
        var go = '/pools/xrpl/id/' + encodeURIComponent(x.lp.issuer);
        if (btns[0]) btns[0].setAttribute('data-lxgo', go);
        if (btns[1]) btns[1].setAttribute('data-lxgo', go + '?act=withdraw');
        // `x.lp.issuer` is the AMM account — the pool's own address, which is both what the detail url is
        // keyed on and what "Copy pool address" is expected to put on the clipboard.
        if (btns[2]) {
          btns[2].setAttribute('data-lxpmenu', x.lp.issuer);
          btns[2].removeAttribute('data-lxexp');
          btns[2].title = '';
          btns[2].setAttribute('aria-label', 'Pool actions');
        }
        body.appendChild(tr);
      });
      var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
        return !(c.closest && c.closest('.lx-wcgroup'));
      });
      if (cnt[1]) cnt[1].textContent = String(rows.length);
    });
  }

  // ---- the hero chart ------------------------------------------------------------------------------
  //
  // WHAT IT PLOTS: XRP/USD over the chosen timeframe. Not the account's portfolio value — and that is
  // not a shortcut, it is what lumoscore.com draws in the same box. Its wallet fetches CoinGecko's
  // `coins/stellar/market_chart` and plots XLM/USD; the comment beside its hidden 7-day delta says
  // why — "no portfolio history feed". Neither ledger publishes a balance series, so a true portfolio
  // curve would mean replaying every transaction on the account. This is the Stellar chart with
  // `stellar` swapped for `ripple`, served through /lxapi/xrplchart.
  //
  // This box previously carried my own note reading "Portfolio history is not available yet." That
  // was honest but it was not the page main ships, and it is now gone.
  //
  // EVERY CLASS BELOW IS INHERITED. `.lx-chartskel`, `.lx-carea`, `.lx-cbase`, `.lx-cline`,
  // `.lx-chart-none`, `.lx-cx`, `.lx-cd`, `.lx-ctip` and the two gates `#heroChart:not(.lx-chart-ready)
  // {visibility:hidden}` / `.chart-axis:not(.lx-axis-ready){visibility:hidden}` all came across with
  // the fork — the stylesheet survived and only the script that used it was stripped. So nothing here
  // adds CSS; it raises the gates the design already has and fills the shapes it already styles.
  // The SVG is built to match the live one exactly: viewBox 0 0 600 100, a `lxhc` gradient, an area
  // path and a 1.6px line.
  var CHART_TF = '1W';                       // the design ships 1W pre-selected
  var CHART_GEN = 0;                         // guards against a slow response for an abandoned tab

  function chartHost() { return document.getElementById('heroChart'); }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Matched to Stellar's tfLbl(), and the year format is the reason this is not just toLocaleDateString.
  // `{month:'short',year:'2-digit'}` renders August 2022 as "Aug 22", which on an axis sitting beside
  // "Aug 27" and "Sep 3" reads as the 22nd of August. The ALL axis came out "Jun 18 | Jul 20 | Aug 22 |
  // Aug 24 | Today" — five day-of-month labels spanning eight years. The apostrophe is what separates
  // a year from a date, and main already writes it that way.
  function tfLabel(t, tf) {
    var d = new Date(t);
    if (tf === '1D') return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    if (tf === '1Y' || tf === 'ALL') return MON[d.getMonth()] + ' ’' + String(d.getFullYear()).slice(2);
    return MON[d.getMonth()] + ' ' + d.getDate();
  }

  function chartSkeleton(host) {
    // The design's own loading shape, animated by `.lx-cline`'s inherited keyframes.
    host.innerHTML = '<div class="lx-chartskel"><svg viewBox="0 0 300 90" preserveAspectRatio="none">'
      + '<path class="lx-carea" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22 300,90 0,90Z"></path>'
      + '<path class="lx-cbase" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '<path class="lx-cline" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '</svg></div>';
    host.classList.add('lx-chart-ready', 'lx-chart-loading');
  }

  function chartNone(host, msg) {
    host.innerHTML = '';
    var d = el('div', 'lx-chart-none', msg);
    host.appendChild(d);
    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');
  }

  function drawChart(host, pts, tf) {
    var W = 600, H = 100;
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    // A perfectly flat series has no range to scale into; centre it rather than divide by zero.
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    var tspan = (t1 - t0) || 1;

    var line = '', xs = [], ys = [];
    for (var j = 0; j < pts.length; j++) {
      var x = ((pts[j][0] - t0) / tspan) * W;
      var y = span > 0 ? (H - 9) - ((pts[j][1] - lo) / span) * (H - 18) : H / 2;
      xs.push(x); ys.push(y);
      line += (j ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%"'
      + ' height="100%" style="display:block">'
      + '<defs><linearGradient id="lxhc" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="#ea6a2c" stop-opacity="0.28"></stop>'
      + '<stop offset="100%" stop-color="#ea6a2c" stop-opacity="0"></stop>'
      + '</linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#lxhc)"></path>'
      + '<path d="' + line + '" fill="none" stroke="#ea6a2c" stroke-width="1.6"'
      + ' stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';

    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');

    // The axis spans are the design's five; only their text changes. Last one reads "Today" as it
    // does on main.
    var axis = $('.chart-axis');
    if (axis) {
      var sp = axis.querySelectorAll('span');
      for (var k = 0; k < sp.length; k++) {
        var frac = sp.length > 1 ? k / (sp.length - 1) : 1;
        sp[k].textContent = (k === sp.length - 1) ? 'Today' : tfLabel(t0 + tspan * frac, tf);
      }
      axis.classList.add('lx-axis-ready');
    }

    var mini = $('.timeframe-mini');
    if (mini) {
      var map = { '1D': 'past 24 hours', '1W': 'past 7 days', '1M': 'past 30 days', '1Y': 'past year', 'ALL': 'all-time' };
      mini.textContent = map[tf] || '';
    }

    chartHover(host, pts, xs, ys, tf);
  }

  // Scrub-to-read, using the three elements the inherited stylesheet already dresses: a vertical
  // rule, a dot and a tooltip. Rebuilt with the chart so it can never point at a stale series.
  function chartHover(host, pts, xs, ys, tf) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var cx = el('div', 'lx-cx'), cd = el('div', 'lx-cd'), tip = el('div', 'lx-ctip');
    cd.style.background = '#ea6a2c';
    host.appendChild(cx); host.appendChild(cd); host.appendChild(tip);

    function show(e) {
      var r = host.getBoundingClientRect();
      if (!r.width) return;
      var px = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - r.left;
      var frac = Math.max(0, Math.min(1, px / r.width));
      // Nearest point by x, so the readout is a real sample and never an interpolation.
      var idx = 0, best = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var d = Math.abs(xs[i] / 600 - frac);
        if (d < best) { best = d; idx = i; }
      }
      var lx = (xs[idx] / 600) * r.width, ly = (ys[idx] / 100) * r.height;
      cx.style.left = lx + 'px';
      cd.style.left = lx + 'px'; cd.style.top = ly + 'px';
      tip.style.left = Math.max(38, Math.min(r.width - 38, lx)) + 'px';
      tip.style.top = ly + 'px';
      tip.innerHTML = '';
      tip.appendChild(document.createTextNode(usdPrice(pts[idx][1])));
      var sub = el('span', 'lx-ctd', fullWhen(pts[idx][0], tf));
      tip.appendChild(sub);
      cx.style.opacity = '1'; cd.style.opacity = '1'; tip.style.opacity = '1';
    }
    function hide() { cx.style.opacity = '0'; cd.style.opacity = '0'; tip.style.opacity = '0'; }

    host.addEventListener('mousemove', show);
    host.addEventListener('mouseleave', hide);
    host.addEventListener('touchstart', show, { passive: true });
    host.addEventListener('touchmove', show, { passive: true });
    host.addEventListener('touchend', hide);
  }

  // XRP has traded under a dollar for most of its life and is quoted to four decimals everywhere
  // that matters, so the wallet's own 2dp money format would flatten the whole series to "$0.74".
  function usdPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 1) return '$' + v.toFixed(3);
    return '$' + v.toFixed(4);
  }

  // The tooltip has room for the unabbreviated form, so it always carries the year — no reader should
  // have to work out which August a point belongs to.
  function fullWhen(t, tf) {
    var d = new Date(t);
    var day = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    if (tf !== '1D') return day;
    return day + ' · ' + (d.getHours() < 10 ? '0' : '') + d.getHours()
      + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function loadChart(tf) {
    var host = chartHost();
    if (!host) return;
    CHART_TF = tf;
    var gen = ++CHART_GEN;
    chartSkeleton(host);

    fetch('/lxapi/xrplchart?tf=' + encodeURIComponent(tf))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (gen !== CHART_GEN) return;                   // a later tab won the race
        if (!d || !d.ok || !d.pts || d.pts.length < 2) {
          chartNone(host, 'Price history unavailable right now');
          return;
        }
        drawChart(host, d.pts, tf);
      })
      .catch(function () {
        if (gen !== CHART_GEN) return;
        chartNone(host, 'Price history unavailable right now');
      });
  }

  // The design's own tab buttons. Its listeners are gone — the block they lived in is made to bail
  // at build time, because the same function drew a Math.random() series — so the active state is
  // driven here too.
  function wireChart() {
    var host = chartHost();
    if (!host || host.getAttribute('data-lxch') === '1') return;
    host.setAttribute('data-lxch', '1');

    var btns = document.querySelectorAll('.tf-row .tf-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          var tf = (b.textContent || '').trim().toUpperCase();
          for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('active', btns[j] === b);
          loadChart(tf);
        });
      })(btns[i]);
    }

    var active = document.querySelector('.tf-row .tf-btn.active');
    loadChart(active ? (active.textContent || '').trim().toUpperCase() : '1W');
  }

  // THE MONEY DIALOGS CARRY THE DESIGN'S BALANCES, AND ONLY ONE OF THEM GETS REWRITTEN.
  //
  // write.js sets `.field-label .meta` for the FROM field only — by design, it is the field a MAX
  // button reads. Every other one keeps what the template shipped, and the template's numbers are
  // another chain's: measured in the Send dialog, "Balance: 25,420.18 APT" and
  // "Balance: 4,200.00 USDC" sat beside the real "Balance: 0.923838 XRP".
  //
  // Hidden today, because the picker currently offers only XRP. That is not a reason to leave them:
  // a wrong balance inside a dialog that moves money is one selector change away from being read,
  // and this project has already shipped mock that was invisible right up until it was not.
  //
  // Blanked, not deleted, and blanked at LOAD so write.js still fills in the ones it owns whenever
  // a dialog opens — the design's element stays exactly where the layer expects to find it.
  function clearMockBalances() {
    // querySelectorAll directly: this file defines `$` and NOT `$$`. Written as `$$` first, which
    // `node -c` accepts happily — it is a runtime reference, not a syntax error — and it would have
    // thrown inside load() and taken the whole wallet page down with it.
    [].forEach.call(document.querySelectorAll('.field-label .meta'), function (m) {
      if (/Balance:/i.test(m.textContent || '')) m.textContent = 'Balance: —';
    });
  }

  // THE BALANCE READ IS NO LONGER GATED ON WALLET MARKUP, and that split is what lets the Custom
  // Swap dialog work off this page.
  //
  // `write.js` — Send, Swap, Trustlines, the signing paths — reads `window.__lxxData` for balances
  // and for the asset it is allowed to offer. That object was published inside a function which
  // returned immediately unless the page had `#assetsTable` / `#assetList`, so on any page that is
  // not the wallet, write.js loaded with no balances and every field it fills stayed empty. The
  // dashboard carries the same `#modalSwap` markup and could never have driven it.
  //
  // So the read runs whenever an address is connected, and only the PAINTING is gated on `h`. The
  // wallet page behaves exactly as before — same calls, same order — and any other page carrying a
  // dialog gets the data it needs without a second copy of this logic.
  function load() {
    var h = host();
    if (h) {
      lift();
      // The chart is XRP's price, not this account's, so it is valid with no wallet connected and
      // must not sit behind the address check — the same mistake that left the pool page empty for
      // every signed-out visitor.
      wireChart();
      clearMockBalances();
    }

    var a = addr();
    if (!a) { if (h) note(h, 'Connect a wallet to see your balances.'); return; }

    if (h) note(h, 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      window.lxx.allLines(rpc, a)
    ]).then(function (r) {
      var v = (r[0].info && r[0].info.validated_ledger) || {};
      // Read every time. These halved by amendment once already; a hardcoded pair would quietly
      // overstate what the user can send.
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = r[1].account_data || {};
      var data = {
        xrp: window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve),
        held: [], pools: [], obligations: []
      };
      var split = window.lxx.readLines(r[2].lines);
      data.held = split.held; data.pools = split.pools; data.obligations = split.obligations;
      window.__lxxData = data;

      // Announced so a dialog on a non-wallet page can fill itself the moment balances land, rather
      // than polling or racing this fetch.
      try { window.dispatchEvent(new CustomEvent('lxx:walletdata')); } catch (e2) {}

      if (!h) return;                                    // data only — nothing here to paint
      paint(data);
      // Before the painters and before setMeta's second pass: buildTabs moves .orders-block into a
      // panel and stamps .lx-wcgroup, and both of those are things the writers below look for.
      buildTabs();
      setMeta(data.held.length, data.pools.length, data.xrp);
      paintActivity(a);
      paintOrders(a);
      paintLpPositions(data);
      applyPins();
    }).catch(function (e) {
      // THE ACTIVITY BLOCK IS CLEARED HERE TOO, AND THIS IS THE PATH THAT ACTUALLY MATTERED.
      //
      // When the account read fails, paintActivity() is never reached — so the two guards inside it
      // cannot help, and the design's thirty invented rows stayed on screen under an "account not
      // activated" notice. Measured against an address that is not on the ledger: a full page of
      // "Received USDT from 0x0222…02b2" in APT, dated today.
      //
      // Done before the `!h` return, because the assets host being absent is no reason to leave
      // fabricated history standing.
      activityNote(/actNotFound/i.test(e.message || '')
        ? 'No activity on this account yet.'
        : 'Could not load activity for this account.');
      if (!h) return;
      // An account with no transactions simply does not exist on the ledger yet. Not an error.
      if (/actNotFound/i.test(e.message || '')) { note(h, 'This account is not activated on the XRP Ledger yet.'); return; }
      note(h, 'Could not read the XRP Ledger — ' + (e.message || 'try again'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxReload = load;
})();
