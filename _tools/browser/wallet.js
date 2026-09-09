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
  var Q = [], active = 0, MAXQ = 6;
  function pump() { while (active < MAXQ && Q.length) { active++; (Q.shift())(); } }
  function done1() { active--; pump(); }

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
  function paintMark(node, setLogo, setLetter, url) {
    if (!url) { setLetter(); return; }
    near(node, function () {
      Q.push(function () {
        var fired = false, img = new Image();
        // This now times the REQUEST, not a wait behind three hundred of them.
        var t = setTimeout(function () {
          if (fired) return; fired = true; done1(); setLetter();
        }, 8000);
        img.onload = function () { if (fired) return; fired = true; clearTimeout(t); done1(); setLogo(url); };
        img.onerror = function () { if (fired) return; fired = true; clearTimeout(t); done1(); setLetter(); };
        img.src = url;
      });
      pump();
    });
  }

  // ---- rows, per design ---------------------------------------------------------------------------
  function tableRow(name, sub, right, rightSub, frozen, tok) {
    var tr = document.createElement('tr');
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
    // A ticker is one to five characters, which is precisely what the logo layer hunts for, so the
    // name is claimed the same way the card badge is. "XRP" is not a slot to lose to a repaint.
    var nm = el('div', 'nm');
    plain(nm, name + (frozen ? ' (frozen)' : ''));
    meta.appendChild(nm);
    meta.appendChild(el('div', 'sb', sub || ''));
    aid.appendChild(meta);
    c1.appendChild(aid);
    tr.appendChild(c1);
    tr.appendChild(el('td', null, '—'));                 // price: needs a price source
    tr.appendChild(el('td', null, '—'));                 // 7d: later
    var c4 = el('td', 'right');
    c4.appendChild(el('div', 'asset-bal', right));
    if (rightSub) c4.appendChild(el('div', 'asset-sb', rightSub));
    tr.appendChild(c4);
    tr.appendChild(el('td', 'right'));
    return tr;
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
      h.node.appendChild(make('XRP', 'XRP Ledger', fmt(data.xrp.balance, 6) + ' XRP', rs, false, null));
    }

    data.held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < data.held.length; i++) {
      var t = data.held[i];
      h.node.appendChild(make(t.display, short(t.issuer), fmt(t.balance, 6) + ' ' + t.display, '', t.frozen, t));
    }

    if (!data.held.length && !data.xrp) note(h, 'Nothing held on this account yet.');
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
  function clearTotalMock() {
    var vs = $('.value-side');
    if (!vs || vs.getAttribute('data-lxxcleared')) return;
    var v = vs.querySelector('.value');
    if (v) {
      var unit = v.querySelector('span');
      var first = v.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = '— ';
      if (unit) unit.textContent = 'XRP';
    }
    var sub = vs.querySelector('.sub-value');
    if (sub) sub.textContent = '';
    var pill = vs.querySelector('.delta-pill');
    if (pill) { pill.style.visibility = 'hidden'; }
    var sec = vs.querySelector('.delta-secondary');
    if (sec) sec.textContent = '';
    vs.setAttribute('data-lxxcleared', '1');

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

    // THE PAGE HAS MORE THAN ONE HOLDINGS SUMMARY. setMeta writes $('.section-heading .meta'), which
    // is the FIRST match — and a second one lives in another .section-heading further down, so it kept
    // the mock "5 holdings · 31,108.45 APT total" while the list beneath it was already correct.
    // querySelector returning the first of several is the quiet version of this bug; take them all.
    var d = window.__lxxData;
    if (!d) return;
    var n = d.held.length + (d.xrp ? 1 : 0);
    var line = n + ' holding' + (n === 1 ? '' : 's')
      + (d.xrp ? (' · ' + fmt(d.xrp.balance, 2) + ' XRP') : '');
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
  // "Claimable payments" is Stellar's claimable-balance feature, which this ledger does not have. A
  // CHECK is the real equivalent: a payment addressed to you that you have to cash, which is what the
  // label already describes. So the tab keeps its name and counts checks.
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
      + '<button class="lx-wctab" type="button" data-t="claim">Claimable payments'
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
    var pClaim = document.createElement('div'); pClaim.className = 'lx-wcpanel lx-wcpanel-claim';
    pClaim.setAttribute('hidden', '');

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
    host.insertBefore(pClaim, pOrders.nextSibling);
    pClaim.innerHTML = '<div class="lx-wclist"><div class="lx-wcnote"></div></div>';

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

    var nm = row.querySelector('.pair-text .name');
    if (nm) nm.textContent = gc + ' / ' + pc;
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
    [gc, pc].forEach(function (code, i) {
      if (!ico[i]) return;
      plain(ico[i], code.charAt(0).toUpperCase());
      ico[i].style.fontSize = '11px';
    });

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

  function paintClaimable(me) {
    rpc('account_objects', { account: me, ledger_index: 'validated', type: 'check', limit: 50 })
      .then(function (r) {
        var checks = (r.account_objects || []).filter(function (c) {
          return c.Destination === me;                    // checks written TO you, not by you
        });
        setTab('claim', checks.length);

        var note = $('.lx-wcpanel-claim .lx-wcnote');
        if (!note) return;
        if (!checks.length) {
          // The inherited copy described Stellar claimable balances. Say what this ledger does.
          note.textContent = 'Nothing is waiting to be claimed. Checks written to you on the XRP Ledger will appear here.';
          return;
        }
        var list = note.parentElement;
        list.innerHTML = '';
        checks.forEach(function (c) {
          var got = amt(c.SendMax);
          list.appendChild(el('div', 'lx-wcnote',
            'Check from ' + short(c.Account) + (got ? (' — up to ' + fmt(got.value, 6) + ' ' + got.code) : '')));
        });
      }).catch(function () {});
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
    TrustSet: 'Trustline', AMMDeposit: 'Pool deposit', AMMWithdraw: 'Pool withdrawal',
    AccountSet: 'Account update', NFTokenMint: 'NFT mint'
  };

  // An amount is either drops (a bare string) or an issued-currency object.
  function amt(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { value: +v / 1e6, code: 'XRP' };
    // Through lxx.decodeCurrency so a 40-char hex code renders as its name, exactly as the asset
    // list above renders it — one decoder, so the two cannot disagree about what a token is called.
    var d = window.lxx.decodeCurrency(v.currency);
    return { value: +v.value, code: (d && d.display) || v.currency };
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
        if (!txs.length) return;
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
            dv.textContent = (day === today ? 'TODAY · ' : '')
              + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
            block.appendChild(dv);
          }

          var row = rowT.cloneNode(true);
          var kind = TYPES[tx.TransactionType] || tx.TransactionType || 'Transaction';
          var incoming = tx.TransactionType === 'Payment' && tx.Destination === me;
          var other = incoming ? tx.Account : tx.Destination;

          var ico = row.querySelector('.activity-icon');
          if (ico) { ico.classList.toggle('received', !!incoming); ico.classList.toggle('sent', !incoming); }

          var ty = row.querySelector('.type');
          if (ty) {
            var status = ty.querySelector('.status');
            ty.textContent = (tx.TransactionType === 'Payment' ? (incoming ? 'Received' : 'Sent') : kind) + ' ';
            if (status) {
              var ok = (meta.TransactionResult === 'tesSUCCESS');
              status.textContent = ok ? 'Confirmed' : (meta.TransactionResult || 'Failed');
              status.classList.toggle('success', ok);
              ty.appendChild(status);
            }
          }

          var mt = row.querySelector('.meta');
          if (mt) {
            mt.textContent = (other ? ((incoming ? 'From ' : 'To ') + short(other) + ' · ') : '')
              + when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          }

          var a1 = row.querySelector('.a1');
          if (a1) {
            // delivered_amount, never tx.Amount: on a path payment Amount is the MAXIMUM the sender
            // would allow, not what arrived. Measured elsewhere in this project as a 33% overstatement.
            var got = amt(meta.delivered_amount || meta.DeliveredAmount || tx.Amount);
            if (got && isFinite(got.value)) {
              a1.textContent = (incoming ? '+' : '−') + fmt(got.value, 6) + ' ' + got.code;
              a1.classList.toggle('up', !!incoming);
              a1.classList.toggle('down', !incoming);
            } else {
              a1.textContent = '';
            }
          }

          // The design's second line is a USD conversion, and it shipped as a fixed "≈ $7.42" on
          // every row. This layer has no price map — prices.js owns that — so the honest thing is to
          // clear it rather than repeat a number that was never about this transaction. An empty
          // slot says nothing; a stale one says something false on all 25 rows.
          var a2 = row.querySelector('.a2');
          if (a2) a2.textContent = '';

          block.appendChild(row);
        });
      }).catch(function () { /* leave the design's block alone rather than empty it on a failure */ });
  }

  function load() {
    var h = host();
    if (!h) return;                                      // not a wallet page
    lift();
    var a = addr();
    if (!a) { note(h, 'Connect a wallet to see your balances.'); return; }

    note(h, 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      rpc('account_lines', { account: a, limit: 400, ledger_index: 'validated' })
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
      paint(data);
      // Before the painters and before setMeta's second pass: buildTabs moves .orders-block into a
      // panel and stamps .lx-wcgroup, and both of those are things the writers below look for.
      buildTabs();
      setMeta(data.held.length, data.pools.length, data.xrp);
      paintActivity(a);
      paintOrders(a);
      paintClaimable(a);
    }).catch(function (e) {
      // An account with no transactions simply does not exist on the ledger yet. Not an error.
      if (/actNotFound/i.test(e.message || '')) { note(h, 'This account is not activated on the XRP Ledger yet.'); return; }
      note(h, 'Could not read the XRP Ledger — ' + (e.message || 'try again'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxReload = load;
})();
