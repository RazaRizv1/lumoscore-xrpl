// Pools page: XRP Ledger AMM pools.
//
// Replaces `lx-ammdata` (~286KB), which was walking STELLAR's Horizon on an XRP Ledger site. The
// page announced "Ranking the network's pools… 7,800 scanned so far" and then rendered TVL in XLM.
//
// Ranked by 24h VOLUME. Measured, not preferred: the upstream's own liquidity ranking returns five
// BITx pools each claiming 113,142,29x of liquidity with zero trade -- a worthless token paired
// with another worthless token inflates nominal value for free. Volume cannot be faked without
// paying fees.
//
// Icons are real token logos, proxied through /lxapi/xrplthumb so the xrpl.to API key stays
// server-side, falling back to initials drawn as inline SVG. The SVG matters beyond looks: the page
// carries a logo healer that repaints any element with 1-5 characters of text as a ticker logo and
// does not look at classes -- an img or svg child is the only thing it skips. See browser/trade.js.
(function () {
  if (window.__lxxPools) return;
  window.__lxxPools = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Real logo when we have one, initials when we do not.
  //
  // The <img> is wrapped in the SAME inline-SVG-bearing span used for initials, because the page
  // carries a logo healer that repaints any element with 1-5 characters of text -- an element
  // holding an img or svg is the only thing it skips. See browser/trade.js.
  //
  // The image goes through /lxapi/xrplthumb, never xrpl.to directly: that endpoint needs the API
  // key and the key must not reach the browser.
  function logoEl(name, md5, size) {
    var s = size || 32;
    var NS = 'http://www.w3.org/2000/svg';
    var e = document.createElement('span');
    e.className = 'lxx-ic';
    e.style.cssText = 'display:inline-flex;width:'+s+'px;height:'+s+'px;flex:0 0 '+s+'px;'
      + 'border-radius:50%;overflow:hidden;align-items:center;justify-content:center';

    function initials() {
      e.innerHTML = '';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('width', String(s)); svg.setAttribute('height', String(s));
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', '16');
      c.setAttribute('fill', 'rgba(255,255,255,.12)');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '16'); t.setAttribute('y', '17');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '800');
      t.setAttribute('fill', '#fff');
      t.textContent = String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      svg.appendChild(c); svg.appendChild(t);
      e.appendChild(svg);
    }

    if (/^[0-9a-f]{32}$/i.test(md5 || '')) {
      var img = document.createElement('img');
      img.src = '/lxapi/xrplthumb?id=' + md5 + '&w=' + (s > 48 ? 64 : 48);
      img.alt = ''; img.loading = 'lazy'; img.width = s; img.height = s;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      // A token with no logo upstream 404s. Fall back rather than leave a broken image.
      img.onerror = initials;
      e.appendChild(img);
    } else {
      initials();
    }
    return e;
  }

  function nameOf(s) {
    if (!s) return '?';
    if (!s.i || s.c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(s.c).display; } catch (e) { return s.c.slice(0, 6); }
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function count(v) {
    return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // A MONEY FIGURE, ABBREVIATED THE WAY STELLAR'S OVERVIEW ABBREVIATES ONE — "$5.32M", "$545.3K".
  // K is one decimal and M upward are two, which is the same ladder the Trade table and the asset
  // page use; the dollar sign is the caller's, because one of these is a headline and one a sub-line.
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // A Market Overview caption, coloured the way Stellar colours one — WITHOUT naming a colour.
  //
  // RAZA 2026-10-06, the two captions this file writes against the two it does not: "text colour on
  // difference on Stellar and XRPL". Measured in dark on both pages, the plain captions already
  // agree — `.amm-snapshot-sub` is rgb(110,109,120) on lumoscore.com and here — and only the two we
  // touch were off, at rgb(165,164,172).
  //
  // Both halves of that were mine. The Active Pools caption inherits `up`, the design's positive-delta
  // style, from a row that once carried a week-on-week change; it renders rgb(53,192,127), green, and
  // there is no delta here for green to mean. I covered it with an inline `var(--text-muted)` — which
  // is a DIFFERENT TOKEN from the one the caption class uses: #a5a4ac in dark, #5a5a66 in light. So the
  // override swapped a wrong colour for another wrong colour, and in opposite directions per theme.
  //
  // Removing the class and the inline both, instead, lands on rgb(110,109,120) — Stellar's exact
  // value — because the caption class then applies, which is all Stellar ever does. Measured all three
  // ways on the live page before writing this. Naming a literal here would have had to be re-picked
  // for light; inheriting cannot drift. [[lumoscore-css-override-traps]]
  function plainSub(el) {
    if (!el) return;
    el.classList.remove('up');
    el.classList.remove('down');
    el.style.color = '';          // clears an override an earlier build of this file may have set
  }

  // The XRP -> USD rate, read once per page from the tokens endpoint — the same source every other
  // USD figure on this site derives from, so the table cannot disagree with the overview or the
  // dashboard about what an XRP is worth. Null until it arrives, and null is rendered as an em dash
  // rather than as a converted number, so a missing rate never invents one.
  var USD = null;

  // ASKED AGAIN WHEN REFUSED (RAZA 2026-09-16: the list showing "—" for liquidity, volume and fees against live pools).
  // The rate endpoint answers 200 with {ok:false} when the upstream throttles it, and one refusal blanked every USD cell
  // in the table for the life of the page.
  // THE MOCK GOES AT ONCE (RAZA 2026-09-17: "On pools main page, theres a flash bug. While the page is refreshed, it show
  // these values for split seconds" — "12.7M APT", "100 active pools", "$21,483.83 · 51,250 APT swapped"). The design ships
  // those figures in the markup and this layer only replaced them once the ledger answered, so every refresh flashed another
  // chain's numbers.
  //
  // THE FIGURES ARE NOW BLANKED IN THE MARKUP ITSELF, by `_xrplpoolsmock` at build time (RAZA reported the flash a second
  // time after this ran here: a script at the end of the body cannot beat the paint of the document that carries it). What
  // is left here is a belt-and-braces pass for any container the transform has not reached.
  //
  // `amm-snapshot-sub` is BOTH a figure and a caption — "51,250 APT swapped" against "Across all pools" — and blanking it
  // wholesale erased the design's own captions, leaving the Total Liquidity row with nothing under its name. Only a sub
  // carrying a digit is mock.
  (function blankOverviewMock() {
    var seen = {};
    [].forEach.call(document.querySelectorAll('.amm-snapshot-value, .amm-snapshot-vsub, .amm-snapshot-sub'), function (n) {
      if (seen[n]) return;
      seen[n] = 1;
      if (n.classList.contains('amm-snapshot-value')) { n.textContent = '—'; return; }
      if (n.classList.contains('amm-snapshot-vsub')) { n.textContent = ''; return; }
      if (/\d/.test(n.textContent || '')) n.textContent = '';
    });
    [].forEach.call(document.querySelectorAll('.stat-cell .val, .pga-cell .val, [class*=pool-stat] .val'), function (n) {
      if (/APT|APTOS/i.test(n.textContent || '')) n.textContent = '—';
    });
  })();

  // THE CACHED RATE, from xrpl-core. This used to retry three times and then give up with null, and
  // null blanks every USD figure on the page -- all fifty rows' Liquidity, Volume and Fees at once,
  // with the numbers themselves present in the response the whole time. The rate comes from xrpl.to
  // at 333 requests a day per IP, so a refusal is ordinary rather than exceptional.
  function fetchUsd(tries) {
    return (window.lxx && window.lxx.fetchUsd) ? window.lxx.fetchUsd(tries) : Promise.resolve(null);
  }

  function usdText(xrpAmount) {
    if (USD == null || xrpAmount == null || !isFinite(xrpAmount)) return '—';
    var v = xrpAmount * USD;
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // The two sides of the pool, "3.40M XRP + 4.63M RLUSD", exactly as Stellar renders its liquidity
  // cell. Returns null when either amount is missing so the cell falls back to one line rather than
  // printing a half-composition.
  function composition(p) {
    var a = p && p.a1, b = p && p.a2;
    if (!a || !b || a.v == null || b.v == null || !isFinite(a.v) || !isFinite(b.v)) return null;
    return amount(a.v) + ' ' + nameOf(a) + ' + ' + amount(b.v) + ' ' + nameOf(b);
  }

  // `pair-sub` is the design's own class — the same one Stellar's liquidity cell uses for its
  // second line — so the sub-line inherits the design's muted size and colour rather than needing
  // any CSS of its own.
  //
  // `sub` is optional now: Stellar puts a second line under LIQUIDITY only, and volume and fees are
  // a single USD figure each.
  function usdCell(xrpAmount, sub) {
    var td = el('td');
    td.appendChild(el('div', null, usdText(xrpAmount)));
    if (sub) td.appendChild(el('div', 'pair-sub', sub));
    return td;
  }

  // Sixth gate of this shape in the project, and the first one on the ROOT element:
  //     html:not(.lx-ammready) #poolsBody, html:not(.lx-ammready) #poolTabs .count
  //         { visibility: hidden }
  // The class goes on <html>, not on <body> and not on the container -- guessing the target failed
  // twice before scanning the stylesheet for what actually matches. These gates have now been found
  // on all three: the root, the body and the container itself. Always look the rule up; never guess
  // where the class belongs.
  function lift() {
    try { document.documentElement.classList.add('lx-ammready'); } catch (e) {}
  }

  // EVERY POOL ROW 404'd, and the cause was a layer that was never ours.
  //
  // The design ships a blanket navigation helper, window.__lumosNav, configured with
  //     LISTTARGET = 'amm-pool'   // blanket row target for pure list pages
  //     CONTAINERNAV = true       // allow container-signal row nav
  // so it claims a click on ANY row of a list page and routes it through lxNavigate/lxClean, which
  // resolve to the Stellar route shape — /pools/<chain>, with the chain defaulting to "stellar"
  // because this build is not one they know. On the XRP Ledger fork that destination does not exist,
  // so every pool row landed on Page not found.
  //
  // Three things did NOT fix it, and each ruled something out: a plain click handler (it answers
  // later and wins), the same handler in capture on the row (capture descends from the top, so a
  // document-level listener still runs first), and a real <a href> (it preventDefaults the anchor).
  // The trace that settled it recorded the click reaching the anchor with the correct href, then an
  // unload, then arrival at /pools/stellar with the pools page as referrer — one navigation, decided
  // by a handler, not by the browser or the server.
  //
  // WINDOW capture is the earliest phase there is: it runs before any document-level listener, so
  // stopImmediatePropagation here settles the question before anything else is consulted. Scoped
  // strictly to clicks inside #poolsBody, so no other navigation on the page is affected.
  // A NEW TAB HAS TO BE OPENED BY US, NOT LEFT TO THE BROWSER (RAZA 2026-10-08: "Allow me to open
  // pools in new tabs. It doesn't let me"). This handler used to RETURN on a modifier click, meaning
  // to let the browser do what it always does with ctrl+click. That is precisely what cannot work
  // here: getting out of the way hands the click to the design's own window-capture router, which
  // calls preventDefault and navigates in the same tab. Measured on the deployed page — ctrl+click on
  // the pair anchor itself came back defaultPrevented with an unload following, so even the real
  // <a href> lost. lumoscore.com hit the same wall and records it in _ammdata.js: "the design's shim
  // runs on window capture and calls preventDefault, so 'let the browser handle it' loses that race".
  //
  // So the row is claimed in every case and the destination is opened explicitly: a modifier click
  // gets window.open, a plain one gets location.href. Right-click is excluded so the context menu
  // (and its own "Open link in new tab") still works. auxclick is bound as well as click because the
  // MIDDLE BUTTON FIRES NO CLICK EVENT AT ALL in Chrome — binding only click would leave middle-click
  // broken in exactly the way this fix is meant to address.
  function claimRowClicks() {
    if (window.__lxxPoolNav) return;
    window.__lxxPoolNav = 1;
    function wantsTab(e) { return !!(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)); }
    function nav(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // THE PHONE HAS NO #poolsBody (RAZA 2026-11-17, phone screenshots: "when im tapping on any pool, it
      // takes me to lumoscore.com/pools/stellar"). Its pools are a.pool-card anchors in #panelAll, and its
      // positions a.pool-card.my-pos in #panelMine (card() here, posCard() in mypositions.js). This handler
      // only knew the desktop table, so on a phone it returned and the design's router sent every tap to
      // the Stellar route shape -- exactly the September bug, still open on the layout nobody re-measured.
      // Only cards THIS layer built are claimed: the href must already be one of ours.
      var a = null;
      var tr = t.closest('#poolsBody tr');
      if (tr) a = tr.querySelector('a.pool-pair');
      if (!a) {
        var card = t.closest('a.pool-card');
        if (card && /^\/pools\/xrpl\/id\//.test(card.getAttribute('href') || '')) a = card;
      }
      if (!a) return;
      if (e.button != null && e.button !== 0 && e.button !== 1) return;   // right-click: leave it alone
      e.preventDefault();
      e.stopImmediatePropagation();
      var h = a.getAttribute('href');
      if (wantsTab(e)) {
        try { window.open(h, '_blank', 'noopener'); return; } catch (_) {}
      }
      window.location.href = h;
    }
    window.addEventListener('click', nav, true);
    window.addEventListener('auxclick', nav, true);
  }

  function row(p, rank) {
    var tr = document.createElement('tr');

    // ZERO-PADDED, as on lumoscore.com: "01", "02" … Stellar pads and this did not, which is the
    // "left side numbering is off" — the columns did not line up because the digits did not.
    // `idx`, as on lumoscore.com: that class is what greys the rank. Without it the numbers were drawn
    // in full text colour, which is the "counting column is whiter" RAZA compared (2026-09-15).
    tr.appendChild(el('td', 'idx', (rank < 10 ? '0' : '') + rank));

    var pair = el('td');
    // A REAL ANCHOR, not a scripted navigation. Setting window.location from a click handler here was
    // being overridden: every row click ended on /pools/stellar — the Stellar route shape
    // /pools/<chain>/id/<id> with the chain defaulting to "stellar" — even from a capture-phase
    // listener that stopped propagation, and even though assigning the same URL outside a click
    // navigates correctly. Something inherited answers the click later and wins.
    //
    // An anchor sidesteps the argument entirely: the browser navigates natively, and the site's own
    // link-cleaning handler only rewrites hrefs matching lumoscore-*.html, so it leaves this one
    // alone. It is also how the Stellar build links its pool rows, so this is the shape the rest of
    // the page already expects — and it gives the row middle-click and open-in-new-tab for free.
    // STELLAR'S CELL, NOT A LOOKALIKE (RAZA 2026-09-15: "the text size in rows seems smaller"). Read off
    // lumoscore.com's live row: `div.pair-cell > div.pair-icons > .pa/.pb` at 32px, then
    // `div > div.pair-name` — 15.5px/700 from the design's own stylesheet. This drew 22px discs beside a
    // bare span, so the name took the table's 15px/400 and every row sat 17px shorter.
    var wrap = el('a', 'pool-pair pair-cell');
    wrap.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none';
    var icons = el('div', 'pair-icons');
    // TWO GUARDS, BECAUSE THE HEALER HAS TWO ROUTINES AND THEY READ DIFFERENT ATTRIBUTES.
    //
    // RAZA 2026-10-18, user report: "the secondary asset logo is completely blank or missing, leaving
    // only a single icon visible" (LOL, GM, DMNDBR, AmericaFirst, AiCat, XIO, SOL, DIP).
    //
    // `data-paired` was already here and is correct — but it only stops the healer's pairs() pass,
    // which explicitly skips a guarded box. Its OTHER pass does not look at that attribute at all:
    //
    //     querySelectorAll('[class*="ico"],…,[class*="pair-ic"],…')   <- "pair-icons" matches BOTH
    //     if (!cand(el)) continue;        // cand() checks data-logoed, never data-paired
    //     el.innerHTML = L[tk];           // <- replaces the WHOLE box with ONE logo
    //
    // So it resolved a ticker from the row's text, wiped both of our real logos out of the container
    // and painted a single one in their place. That is the reported symptom exactly, and it explains
    // why only SOME rows broke: `if (!tk) continue;` leaves the box alone whenever the row's text
    // does not resolve, which is why RLUSD/XUSD, MILADY, LUMOS, FLR and CULT looked fine.
    //
    // data-logoed is the opt-out cand() honours. Both are set because each stops a different pass.
    icons.setAttribute('data-paired', '1');
    icons.setAttribute('data-logoed', '1');
    var la = logoEl(nameOf(p.a1), p.a1 && p.a1.m, 32); la.classList.add('pa');
    var lb = logoEl(nameOf(p.a2), p.a2 && p.a2.m, 32); lb.classList.add('pb');
    icons.appendChild(la); icons.appendChild(lb);
    wrap.appendChild(icons);
    var nm = el('div');
    nm.appendChild(el('div', 'pair-name', nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    wrap.appendChild(nm);
    // NO FEE BADGE. This layer used to append the pool's trading fee ("0.205%") beside the pair.
    // lumoscore.com does not, and it was an addition of mine rather than anything the design asked
    // for — removed on RAZA's instruction. The fee still reaches the pool's own page.
    pair.appendChild(wrap);
    tr.appendChild(pair);

    // TWO LINES, LIKE STELLAR — a USD headline over the ledger amount.
    //
    // These cells were one line of XRP each, which is why the rows read as cramped next to
    // lumoscore.com: measured at the same width and the same font size, Stellar's rows were 75px
    // and these were 58px. The height difference is not styling, it is the missing second line.
    // Stellar's cell is `<div>$4.56M</div><div class="pair-sub">12.39M XLM + 2.28M USDC</div>`,
    // and USD is its headline denomination on every one of these three columns.
    //
    // THE SUB-LINE IS THE XRP AMOUNT, NOT THE POOL COMPOSITION. Stellar can show "12.39M XLM +
    // 2.28M USDC" because it has both sides; /lxapi/xrplpools returns a1.v and a2.v as null on
    // every row, so this build does not know them. Getting them means an amm_info per pool — 100
    // round-trips to fill one column, the same cost trap as probing a logo per holding. The XRP
    // amount is the number we actually have, and it is the one the sub-line states.
    // MATCHED TO lumoscore.com, column by column, after RAZA compared them side by side:
    //   Liquidity  a USD headline with the two POOL SIDES beneath — "$4.64M" over
    //              "12.20M XLM + 2.32M USDC". This showed the XRP total instead, because the
    //              amounts were being dropped by the worker (now passed through).
    //   Volume     USD only. No second line.
    //   Fees       USD only. No second line.
    // The XRP sub-lines under volume and fees were mine, and Stellar has neither.
    tr.appendChild(usdCell(p.liq, composition(p)));
    tr.appendChild(usdCell(p.vol));
    tr.appendChild(usdCell(p.fees));
    var partTd = el('td', null, count(p.holders));
    // COUNTED HERE WHEN THE LIST DOES NOT CARRY ONE (RAZA 2026-09-17: "For ARMY / LUMOS pool, i see no participants on
    // Pools-Pool page, but when i open the page, it shows 1 participants"). The upstream leaves lpHolderCount null on some
    // pools; the pool page counts the LP token's own holders, which is why the two pages disagreed about the same pool.
    // `p.holders == null` FIRST, and that is the whole bug (RAZA reported this pool twice). The upstream sends null when
    // it has no count; `+null` is 0, which isFinite() happily accepts — so the one case this repair exists for was the one
    // case it skipped, and the cell kept the em dash `count(null)` had already written. Nothing else was wrong with it.
    //
    // AND NOW FOR EVERY ROW, NOT ONLY THE EMPTY ONES (RAZA 2026-10-08: "yes make it exact on the
    // visible rows"). The upstream's lpHolderCount is a real holder count but a stale snapshot:
    // measured against the ledger across six pools it was right on three and over by one or two on
    // the three busiest — 1206 against 1204, 455 against 454, 184 against 183. Small, but the pool
    // page now counts from the ledger exactly, so leaving the column on the upstream figure would
    // bring back the complaint that started this, just one digit at a time.
    //
    // The sweep below is already viewport-gated, queued and edge-cached, so asking for every visible
    // row costs the same per row as asking for the few that were null.
    if (p.acct) partTd.setAttribute('data-lxpart', p.acct);
    tr.appendChild(partTd);
    // WEIGHTS OFF THE LIVE STELLAR ROW: the liquidity headline and the participant count are 700 there,
    // the volume and fee figures 400. Set inline on those two cells only.
    tr.children[2].firstChild.style.fontWeight = '700';
    tr.children[5].style.fontWeight = '700';

    tr.style.cursor = 'pointer';
    return tr;
  }

  // THE PHONE HAS A DIFFERENT CONTAINER, AND IT WAS GETTING NOTHING.
  //
  // load() opened with `var tb = $('#poolsBody'); if (!tb) return;` — and the mobile page has no
  // #poolsBody. It has #panelAll, a list of .pool-card anchors. So on a phone this entire layer
  // returned on its first line: no real rows, no summary, no overview, no attribution, and the
  // design's own mock left standing — LUMOS / APT, USDC / APT, CELL / APT, "51,250 APT", eight
  // fabricated pools with liquidity and volume figures, visible at rest.
  //
  // Requiring the desktop container is called out in browser/wallet.js as the most repeated bug in
  // this project. It is the same one.
  function card(p, rank) {
    var a = el('a', 'pool-card');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);

    var head = el('div', 'pc-head');
    var icons = el('div', 'pair-icons');
    // THE PHONE'S CARD CARRIED NEITHER GUARD, so it was open to BOTH healer passes while the table
    // above was only open to one. Same class, same healer, same single-icon outcome — and the mobile
    // list is the one with no pager, so it renders every pool at once. See the long note in row().
    icons.setAttribute('data-paired', '1');
    icons.setAttribute('data-logoed', '1');
    // The design's two discs, replaced with the same real logos the table uses.
    var ia = logoEl(nameOf(p.a1), p.a1 && p.a1.m, 26); ia.classList.add('a');
    var ib = logoEl(nameOf(p.a2), p.a2 && p.a2.m, 26); ib.classList.add('b');
    icons.appendChild(ia); icons.appendChild(ib);
    head.appendChild(icons);

    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    // THE FEE BADGE WAS REMOVED FROM THE TABLE AND LEFT ON THE CARD, so the phone kept showing
    // "0.205% fee tier" after RAZA asked for it to go — "we dont have it on stellar so why did you
    // add it on XRPL". Checked against lumoscore.com's own phone build: its pool cards carry no fee
    // tier at all. The line stays empty, as it is there.
    info.appendChild(el('div', 'pc-sub', ''));
    head.appendChild(info);
    head.appendChild(el('div', 'pc-idx', '#' + (rank < 10 ? '0' : '') + rank));
    a.appendChild(head);

    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    // MATCHED TO THE TABLE AND TO MAIN'S PHONE BUILD, which read: "LIQUIDITY $4.48M / 12.60M XLM +
    // 2.25M USDC" and "VOL (TODAY) $219.3K". So liquidity names BOTH sides — the thing RAZA asked
    // for and which only the desktop table got — and volume is the dollar figure alone. The card
    // previously showed "$4.62M / 3.42M XRP", one side doubled, beside a volume carrying an XRP
    // sub-line the reference does not have.
    stats.appendChild(stat('Liquidity', usdText(p.liq), composition(p)));
    stats.appendChild(stat('Vol (today)', usdText(p.vol)));   // main's phone label, as the note above records
    stats.appendChild(stat('Members', count(p.holders)));
    a.appendChild(stats);
    return a;
  }

  // Whichever list this page actually has.
  function listHost() {
    var tb = $('#poolsBody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelAll');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  function noteHost(h, text) {
    if (h.kind === 'table') { note(h.node, text); return; }
    h.node.innerHTML = '';
    var d = el('div', null, text);
    d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
    h.node.appendChild(d);
  }

  function note(tb, text) {
    tb.innerHTML = '';
    var tr = document.createElement('tr');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td);
    tb.appendChild(tr);
  }

  // The overview cards above the table. Filled from the SAME response as the rows, so the totals
  // cannot disagree with what is listed under them.
  function paintSummary(s) {
    if (!s) return;
    var map = [
      ['liquidity', amount(s.liquidity) + ' XRP'],
      ['volume', amount(s.vol24) + ' XRP'],
      ['fees', amount(s.fees24) + ' XRP'],
      ['pools', null]
    ];
    var cells = document.querySelectorAll('.stat-cell, .pga-cell, [class*=pool-stat]');
    for (var i = 0; i < cells.length; i++) {
      var lbl = cells[i].querySelector('.lbl');
      if (!lbl) continue;
      var name = lbl.textContent.trim().toLowerCase();
      for (var j = 0; j < map.length; j++) {
        if (map[j][1] != null && name.indexOf(map[j][0]) >= 0) {
          var v = cells[i].querySelector('.val');
          if (v) v.textContent = map[j][1];
        }
      }
    }
  }

  // The "Market Overview" card, which the summary painter above never reached because it keys on
  // different classes. Every one of its four rows was the design's mock, in the wrong asset:
  //
  //   Total Liquidity  12.7M APT ≈ $5.32M   (really 28.6M XRP)
  //   Active Pools     100 · "+4 in past 7 days"   (really 30,663; the 7-day delta has no source)
  //   24h Volume       $21,483.83 · "51,250 APT swapped"   (really 470,740 XRP)
  //   Participants     11,274 · "Unique LP wallets"
  //
  // PARTICIPANTS IS SET TO A DASH, not a number. Who holds an LP token is not something a public node
  // will enumerate — the pool detail page already says so in as many words — so 11,274 is not a stale
  // figure, it is an invented one, and replacing it with a different invented one would be no better.
  // The same goes for "+4 in past 7 days": nothing here knows what the count was a week ago.
  // The page's own strapline read "Provide liquidity and earn fees on Stellar's on-chain AMM pools",
  // above a table of XRP Ledger AMMs. Rewritten by text node so the design's markup is untouched.
  // `.page-subtitle` IS THE PHONE'S, and it was missed because it is invisible: the mobile pools page
  // carries "Provide liquidity and earn fees on Stellar's on-chain AMM pools." in a `.lx-sronly`
  // block — clipped from view, but read aloud by screen readers and present in the served HTML. A
  // selector list that only named the desktop element left the wrong chain's name on the phone
  // build, in the one place nobody looks.
  function paintHeroCopy() {
    $$('.dex-hero-sub, .page-subtitle, .page-title').forEach(function (p) {
      if (!/Stellar|Aptos/i.test(p.textContent || '')) return;
      var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = w.nextNode())) {
        if (!n.nodeValue) continue;
        n.nodeValue = n.nodeValue.replace(/Stellar's/gi, 'the XRP Ledger’s')
          .replace(/\bStellar\b/gi, 'the XRP Ledger').replace(/\bAptos\b/gi, 'the XRP Ledger');
      }
    });
  }

  function paintOverview(d) {
    var s = d && d.summary;
    if (!s) return;
    var rows = $$('.amm-snapshot-row');
    if (!rows.length) return;

    // The USD rate lives on the tokens endpoint, the same one every other USD figure on this site is
    // derived from, so the overview cannot disagree with the rest of the page about what an XRP is.
    // Asked again when refused, like the table's rate — one {ok:false} left this card reading em dashes for the page's life.
    fetchUsd(3).then(function (usd) {
      rows.forEach(function (row) {
        var label = ((row.querySelector('.amm-snapshot-label') || {}).textContent || '').trim().toLowerCase();
        var val = row.querySelector('.amm-snapshot-value');
        var vsub = row.querySelector('.amm-snapshot-vsub');
        var sub = row.querySelector('.amm-snapshot-sub');

        function setVal(text, unit) {
          if (!val) return;
          val.textContent = text;
          if (unit) {
            var u = document.createElement('span');
            u.className = 'unit';
            // data-logoed: a three-letter ticker is exactly what the logo layer claims.
            try { u.setAttribute('data-logoed', '1'); } catch (e) {}
            u.textContent = unit;
            val.appendChild(u);
          }
        }

        // Matched anywhere in the label, not at position 0: the row reads "Total Liquidity", so an
        // indexOf(...) === 0 test silently skipped it and left 12.7M APT sitting beside three
        // corrected rows — the one wrong figure in a block that otherwise looked freshly filled.
        // STELLAR'S SHAPE, ROW BY ROW (RAZA 2026-10-06, six numbered differences on one screenshot).
        // Read off lumoscore.com/pools/stellar:
        //
        //   Total Liquidity   63,771,155 XLM        over  ≈ $5.32M
        //   Active Pools      39,253                over  "Liquidity pools on Stellar"
        //   24h Volume        $545.3K               over  "2,523,911 XLM (24h)"
        //
        // Two of them were INVERTED here. Total Liquidity showed the compacted native figure with the
        // exact dollar underneath ("27.24M XRP" over "≈ $41,363,917"); Stellar shows the exact native
        // figure with the compacted dollar underneath. And 24h Volume led with the native count where
        // Stellar leads with the money — the headline is the dollar, the native amount is the detail.
        if (label.indexOf('liquidity') >= 0) {
          // Grouped, not abbreviated: "63,771,155 XLM" is Stellar's headline, so "27,243,110 XRP" is ours.
          setVal(s.liquidity != null ? Math.round(s.liquidity).toLocaleString('en-US') : '—', 'XRP');
          if (vsub) vsub.textContent = usd ? ('≈ $' + money(s.liquidity * usd)) : '';
        } else if (label.indexOf('active pools') === 0) {
          setVal(d.total != null ? count(d.total) : '—');
          // Stellar's wording, and Stellar's colour by the same route Stellar gets it — see plainSub.
          if (sub) {
            sub.textContent = 'Liquidity pools on XRP Ledger';
            plainSub(sub);
          }
        } else if (label.indexOf('24h volume') === 0) {
          setVal(usd ? ('$' + money(s.vol24 * usd)) : (amount(s.vol24) + ' '), usd ? '' : 'XRP');
          if (sub) {
            sub.textContent = s.vol24 != null
              ? (Math.round(s.vol24).toLocaleString('en-US') + ' XRP (24h)')
              : 'past 24 hours';
            plainSub(sub);
          }
        } else if (label.indexOf('participant') === 0) {
          setVal('—');
          if (sub) sub.textContent = 'Not published by a public node';
        }
      });
    });
  }

  // Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10 once xrpl.to's own API
  // was found stating the requirement verbatim in its response body — see the fuller note in
  // browser/trade.js.
  function attribution(d) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var host = $('#panelAllPools') || $('#panelAll');
    if (!host) return;
    var p = el('p'); p.id = 'lxx-attr-pools';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Pool data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // CREATE POOL was disabled here (`markCreatePoolUnwired`) while nothing could sign an AMMCreate: the
  // button relabelled "Pool creation is not enabled yet", the pickers faded to .6 and the dropdowns
  // hidden. RAZA 2026-09-15 asked why; browser/createpool.js now drives the dialog. The design's mock
  // dropdown rows stay hidden by the inherited `.ad-item:not(.lx-cpitem)` rule, so no invented balance
  // can appear — only the account's real holdings are built as `.lx-cpitem`.

  // ---- pagination ----------------------------------------------------------------------------------
  //
  // "whys it only showing 100 pools on XRPL. On Stellar, we're showing all" — and the honest answer
  // has two halves.
  //
  // Stellar genuinely shows all of them: Horizon pages without limit, which is why that page costs
  // ~23s of sequential fetching. xrpl.to does not. `limit` is capped at 100 per request server-side
  // (asking for 200 returns 100), and the only offset parameter that changes the result, `start`,
  // ABANDONS THE SORT — `start=0` and `start=100` return the same first pool and volumes that no
  // longer descend. Measured, not assumed. Walking all 30,728 would be ~308 sequential requests
  // against a 333-a-DAY budget, and it could not be kept in volume order anyway.
  //
  // So the page serves the top 100 by volume, which is the ceiling, and now says so instead of
  // rendering fifty rows under a badge reading 30,728 with no way to reach the rest. The design
  // ships `#paginationAll` — "Showing 1–10 of 100 pools" plus First/Prev/numbers/Next/Last — and it
  // had never been wired to anything. Nothing new is introduced; only what the buttons do.
  var PER = 50;
  // The phone has no pager, so it grows by chunk as the reader scrolls instead of drawing the whole
  // dataset at once. 60 is two or three screens of cards -- enough that the first scroll is never a
  // wait, small enough that the first paint is 120 images rather than 20,000.
  var PHONE_CHUNK = 60, phoneShown = 0, phoneWired = 0, phoneData = null;
  var pageNo = 1;

  function setPageInfo(from, to, total) {
    var pg = $('#paginationAll');
    if (!pg) return;
    var strongs = pg.querySelectorAll('div:first-child strong');
    if (strongs.length > 1) {
      strongs[0].textContent = from + '–' + to;
      strongs[1].textContent = count(total);
    }
  }

  function buildPager(h, d, pages) {
    var pg = $('#paginationAll');
    if (!pg) return;
    var ctrls = pg.querySelector('.page-controls');
    if (!ctrls) return;

    // The design's own First/Prev/Next/Last are kept — they carry its labels — and only the numbers
    // between them are rebuilt. Found by text rather than by index, because the number of children
    // changes every time this runs.
    var kids = [].slice.call(ctrls.children);
    function find(re) {
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === 'BUTTON' && re.test(kids[i].textContent || '')) return kids[i];
      }
      return null;
    }
    var first = find(/first/i), prev = find(/prev/i), next = find(/next/i), last = find(/last/i);
    kids.forEach(function (k) {
      if (k !== first && k !== prev && k !== next && k !== last) k.remove();
    });

    // "PAGE 1 OF 442", NOT A ROW OF NUMBERED BUTTONS (RAZA 2026-10-06, difference 3). Stellar puts a
    // plain label between Prev and Next; this built one button per page, which is also why the two
    // pagers look nothing alike at a glance even before you read them.
    //
    // It is a span, not a disabled button: nothing here is clickable, and a button that cannot be
    // pressed invites the press.
    var lbl = document.createElement('span');
    lbl.className = 'lx-pageno';
    lbl.textContent = 'Page ' + pageNo + ' of ' + pages;
    ctrls.insertBefore(lbl, next);

    function nav(btn, target, disabled) {
      if (!btn) return;
      var clone = btn.cloneNode(true);              // drops the previous render's listener
      btn.parentNode.replaceChild(clone, btn);
      clone.disabled = !!disabled;
      if (!disabled) clone.addEventListener('click', function () { renderPage(h, d, target); });
    }
    nav(first, 1, pageNo === 1);
    nav(prev, pageNo - 1, pageNo === 1);
    nav(next, pageNo + 1, pageNo === pages);
    nav(last, pages, pageNo === pages);

    pg.style.display = pages > 1 ? '' : 'none';
    pagerStyle();
    pagerAboveOverview();
  }

  // Stellar's label is a muted 13.5px span (`.lx-netpag-m`); ours is a span of our own, so it needs the
  // same three declarations. Injected once, by id, so a re-render cannot stack copies.
  function pagerStyle() {
    if (document.getElementById('lx-pageno-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-pageno-css';
    st.textContent = '.lx-pageno{font-size:13.5px;font-weight:400;color:var(--text-muted,#6e6d78);'
      + 'display:inline-flex;align-items:center;padding:0 10px;white-space:nowrap}';
    (document.head || document.documentElement).appendChild(st);
  }

  // THE PAGER GOES ABOVE THE MARKET OVERVIEW (RAZA 2026-10-06, difference 6). On Stellar the order is
  // table → "Showing 1–25 of 11,029 pools" + controls → Market Overview; here the overview card sat
  // between the table and its own pager, so the count belonged to nothing you could see.
  //
  // Verified on lumoscore.com by document order rather than by eye: compareDocumentPosition puts
  // #paginationAll before .amm-snapshot-card.
  // IT IS THE CARD THAT MOVES, NOT THE PAGER — and it is `_sidecard.js` that moves it, on both builds.
  //
  // Three attempts failed before reading the layer that actually owns this, so the mechanism is worth
  // stating. `_sidecard.js` (inherited; `lx-sc` is on <html> here, so it RUNS on this build) relocates
  // `.amm-snapshot-card` out of the hero and down the page, placing it after an anchor:
  //
  //     .lx-netpag-host  ||  .lx-netpag  ||  #panelMine,#panelMyPositions   (whichever is LAST)
  //
  // On lumoscore.com the pools pager carries `lx-netpag`, so the anchor is the pager and the card
  // lands directly after it — which is the whole of the difference RAZA screenshotted. This build
  // inherited netpag's STYLESHEET but never the class on the element: measured, our pager's className
  // is just "pagination". So the anchor fell through to `#panelMyPositions`, which sits INSIDE the
  // list card above, and the overview was parked there — above the pager instead of below it.
  //
  // So the fix is one class, plus the same placement _sidecard would do, applied now rather than at
  // its next observer tick. `lx-netpag-host` and not `lx-netpag`: anchor() checks the host class
  // first, and it carries a single `margin-top:10px`, where `.lx-netpag` would restyle the whole
  // pager — border-top, padding, font, every button.
  //
  // WHAT NOT TO DO, all three measured on deploys:
  //   * Moving the PAGER up works and is undone seconds later — _sidecard puts the card back where
  //     its anchor says, and its anchor was wrong. The node that was fighting me was mine.
  //   * A MutationObserver re-asserting that move HUNG THE TAB (deploy 11dc2b93): move → childList
  //     mutation → _sidecard answers → forever. _sidecard's own observer is safe only because
  //     place() is a no-op once settled, which is why the guard below is the same shape.
  //   * `.page{display:flex}` + `order:1` on the card. This measured correct here at every width and
  //     theme and was still wrong on RAZA's screen — a declared order that only holds in one browser
  //     is not a fix, and it made the page's root a flex container for no reason.
  function pagerAboveOverview() {
    var pg = $('#paginationAll');
    if (!pg || !pg.parentNode) return;
    pg.classList.add('lx-netpag-host');                 // the anchor _sidecard.js looks for
    var card = document.querySelector('.amm-snapshot-card');
    if (!card) return;                                  // painted by a later layer; _sidecard places it
    if (card.parentNode === pg.parentNode && pg.nextElementSibling === card) return;   // settled
    pg.parentNode.insertBefore(card, pg.nextSibling);
  }

  // Which column the table is ordered by.
  //
  // The note here used to say the endpoint returns pools by liquidity descending, "so the default
  // has to describe that rather than impose a second ordering". That was not true: the endpoint asks
  // the upstream for a VOLUME ranking, and until 2026-10-07 it asked with a key the upstream does
  // not sort by, so the rows arrived in no order at all. This client-side sort was therefore not
  // describing the response — it was the only thing ordering the table.
  // It still is, and that is now correct by construction: the endpoint selects the top pools by 24h
  // volume across the whole ledger, and this orders that set by whichever column the reader picks.
  var SORT = { key: 'liq', dir: -1 };
  // THE DATASET CURRENTLY ON SCREEN, which is not always the full one. Set by renderPage, so every
  // path that draws rows records what it drew without having to remember to.
  var VIEW = null;
  function applySort(rows) {
    if (!SORT.key) return rows;
    var k = SORT.key, dir = SORT.dir;
    return rows.slice().sort(function (a, b) {
      var x = +a[k], y = +b[k];
      // A pool with no figure for this column sorts last in either direction rather than counting as zero.
      var xb = !isFinite(x), yb = !isFinite(y);
      if (xb && yb) return 0;
      if (xb) return 1;
      if (yb) return -1;
      // dir -1 is high-to-low, which is what the table opens on: the bigger value must come FIRST, so it returns dir.
      return x === y ? 0 : (x > y ? dir : -dir);
    });
  }
  if (!window.__lxxPoolSort) {
    window.__lxxPoolSort = 1;
    window.addEventListener('click', function (e) {
      var th = e.target && e.target.closest && e.target.closest('th[data-lxsort]');
      if (!th) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var key = th.getAttribute('data-lxsort');
      SORT = { key: key, dir: (SORT.key === key && SORT.dir === -1) ? 1 : -1 };
      paintHeadings();
      // SORT WHAT IS ON SCREEN, NOT THE WHOLE LEDGER.
      //
      // This read window.__lxxPoolsData, the full unfiltered dataset, so clicking a column header
      // while a search was active silently threw the search away: RAZA 2026-10-19 searched "rlusd",
      // sorted by Liquidity, and the table came back with 5,998 pools including XRP/CRYPTO and
      // CAVA/USDV. The header did not just reorder the list, it replaced it -- and the search box
      // still read "rlusd" above the wrong rows, so the page contradicted itself.
      //
      // VIEW is whatever renderPage last drew, so sorting a search reorders the search and sorting
      // the full list reorders the full list. The fallback keeps the old behaviour for the very
      // first click, before anything has been rendered.
      var d = VIEW || window.__lxxPoolsData, hh = listHost();
      if (d && hh) renderPage(hh, d, 1);
    }, true);
  }

  function renderPage(h, d, n) {
    VIEW = d;                                   // what a column-header sort must reorder
    var total = d.rows.length;

    // NO PAGER, NO PAGING. The phone build carries no #paginationAll at all, so paging there would
    // hide rows behind a control that does not exist — the mistake this made once already on the
    // trade page.
    var paged = !!$('#paginationAll');

    // ...BUT "THE WHOLE LOT" STOPPED MEANING A HUNDRED. This drew every row the dataset held, which
    // was right when the dataset WAS the first hundred. deepen() now walks it to 10,000 (RAZA
    // 2026-10-07, "its only considering 100 pools unlike Stellar"), and the phone was still drawing
    // all of them: 10,000 cards, each with two logo <img>, so ~20,000 images at once. Measured on
    // the deployed build — the phone fired roughly 7,000 requests, every /lxapi/xrplthumb came back
    // 429, and the renderer pinned hard enough that neither a script nor a screenshot could run.
    // The list ended up EMPTY, so the page that was supposed to show more pools showed none.
    // Desktop never had this: it pages at 50. Two reasonable decisions that only became lethal once
    // they met.
    //
    // loading="lazy" is not the answer and was already on every one of those images: the browser
    // still builds 20,000 elements, and it loads far more than a screenful. So the phone draws a
    // chunk and grows as the reader scrolls — the same rule fillParticipants() below already
    // follows for its own requests, and it keeps all 10,000 reachable rather than capping the list
    // and quietly throwing RAZA's ask away.
    // RESET ONLY ON A NEW DATASET, never on a repaint. deepen() calls back in here with the SAME
    // object every time a batch of a thousand lands, so keying the reset on n===1 would snap the
    // list back to 60 rows under a reader who had scrolled past them -- ten times over. A search
    // builds a fresh rows object and so does reset, which is what it should do.
    if (!paged) {
      if (phoneData !== d) { phoneData = d; phoneShown = 0; }
      phoneShown = phoneShown ? Math.min(phoneShown, total) : Math.min(PHONE_CHUNK, total);
    }
    var per = paged ? PER : phoneShown;
    var pages = Math.max(1, Math.ceil(total / per));
    pageNo = Math.min(Math.max(1, n), pages);

    var from = (pageNo - 1) * per;
    var to = Math.min(from + per, total);

    h.node.innerHTML = '';
    var make = h.kind === 'table' ? row : card;
    var rows = applySort(d.rows);
    // Absolute rank: page 2 opens at 51, because the number means "51st by volume", not "the first
    // row I happened to draw".
    for (var i = from; i < to; i++) h.node.appendChild(make(rows[i], i + 1));

    setPageInfo(from + 1, to, total);
    buildPager(h, d, pages);
    if (!paged) wirePhoneGrow(h);
    fillParticipants();
  }

  // Appends the next chunk when the reader nears the end of the list. APPENDS rather than re-renders:
  // redrawing would rebuild every card already on screen, and with it every <img> the reader has
  // already paid for -- which is the cost this whole change exists to avoid.
  //
  // Reads the live dataset off window.__lxxPoolsData rather than closing over `d`, because deepen()
  // keeps growing the same object underneath and a stale reference would stop the list at whatever
  // depth it had when the listener was bound.
  function wirePhoneGrow(h) {
    if (phoneWired) return;
    phoneWired = 1;
    var busy = 0;
    function grow() {
      if (busy) return;
      var d = window.__lxxPoolsData;
      if (!d || !d.rows) return;
      var total = d.rows.length;
      if (phoneShown >= total) return;
      // within one screen of the bottom
      var doc = document.documentElement;
      if ((window.innerHeight + window.scrollY) < (doc.scrollHeight - window.innerHeight)) return;
      busy = 1;
      var rows = applySort(d.rows);
      var make = h.kind === 'table' ? row : card;
      var from = phoneShown, to = Math.min(from + PHONE_CHUNK, total);
      for (var i = from; i < to; i++) h.node.appendChild(make(rows[i], i + 1));
      phoneShown = to;
      setPageInfo(1, to, total);
      try { fillParticipants(); } catch (e) {}
      busy = 0;
    }
    window.addEventListener('scroll', grow, { passive: true });
    window.addEventListener('resize', grow, { passive: true });
    // A short list on a tall screen never fires a scroll, so the first check is made directly.
    setTimeout(grow, 400);
  }

  // The same count the pool page shows: the LP token's holder list, which needs the token's currency from amm_info first.
  // Only for the rows on screen, three at a time, and capped — this is a repair for a missing field, not a column to build
  // out of a hundred round trips.
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

  function rpc(method, params) {
    return lxpost('https://xrplcluster.com/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  var PART_RUN = 0, PART_Q = [];
  // FILLED FOR WHATEVER IS ON SCREEN, not the first twelve rows (RAZA 2026-09-17: LUMOS/ARMY, rank 42, still reading "—"
  // while the pool page showed 1). Each missing cell costs two reads — amm_info for the LP token, then its holder count —
  // so doing all fifty upfront is a hundred requests for figures nobody has scrolled to. This fills a cell when it comes
  // within a screen of the viewport, three at a time, and each one only ever once.
  function fillParticipants() {
    sweepParticipants();
    if (window.__lxxPartScroll) return;
    window.__lxxPartScroll = 1;
    var t = null;
    var again = function () { clearTimeout(t); t = setTimeout(sweepParticipants, 120); };
    window.addEventListener('scroll', again, { passive: true });
    window.addEventListener('resize', again, { passive: true });
  }

  function sweepParticipants() {
    var h = window.innerHeight || 800;
    var cells = [].slice.call(document.querySelectorAll('td[data-lxpart]')).filter(function (td) {
      var r = td.getBoundingClientRect();
      return r.bottom > -h && r.top < h * 2;             // on screen, or within a screen of it
    });
    cells.forEach(function (td) {
      var acct = td.getAttribute('data-lxpart');
      td.removeAttribute('data-lxpart');
      PART_Q.push(function () {
        // ONE CALL, AT THE EDGE, CACHED (RAZA 2026-09-17, reporting the same pool a second time: "ARMY / LUMOS pool still
        // shows no participants on pools main page"). This used to be amm_info plus a holder count from the reader's own
        // IP — two public-cluster requests per row, and searching "army" fired fifty of them at once. What the cluster
        // refused came back here as a swallowed error and an em dash that nothing retried.
        return fetch('/lxapi/xrplparticipants?acct=' + encodeURIComponent(acct))
          .then(function (x) { return x.json(); })
          .then(function (d) {
            if (d && d.ok && d.total != null) {
              // A TRUNCATED COUNT MUST NOT REPLACE A WHOLE ONE. The endpoint stops after five pages
              // of four hundred lines and says so with `complete:false`; past that its total is a
              // floor, not a figure. Where the upstream already gave a number, that stays — it is
              // only one or two out — and the partial is used solely where the cell had nothing but
              // an em dash, which is the case this sweep was built for.
              if (d.complete !== false) { td.textContent = count(d.total); return; }
              if (!/[0-9]/.test(td.textContent || '')) td.textContent = count(d.total);
              return;
            }
            throw new Error('no count');
          })
          .catch(function () {
            // PUT IT BACK, so the next sweep tries again. A cell that loses its account has no second chance, and one
            // refused request then reads as "this pool has no liquidity providers" for the life of the page.
            var tries = +(td.getAttribute('data-lxparttry') || 0) + 1;
            if (tries > 3) return;
            td.setAttribute('data-lxparttry', tries);
            td.setAttribute('data-lxpart', acct);
            setTimeout(sweepParticipants, 1200 * tries);
          });
      });
    });
    pumpPart();
  }
  function pumpPart() {
    while (PART_RUN < 3 && PART_Q.length) {
      PART_RUN++;
      PART_Q.shift()().then(function () { PART_RUN--; pumpPart(); }, function () { PART_RUN--; pumpPart(); });
    }
  }

  // THE HEADINGS lumoscore.com USES, read off its live table (RAZA 2026-09-15):
  //     #   Pair   Liquidity ↓   VOL (TODAY)   FEES (TODAY)   Participants
  // Only Liquidity carries an arrow — the table is ordered by it and nothing re-sorts — and every
  // heading is `cursor: default`. This build showed "24h Volume ↕", "Fees (24h) ↕", "Participants ↕":
  // arrows promising a sort that does not exist.
  //
  // A NOTE ON "TODAY": xrpl.to reports a rolling 24 hours, not the UTC day Stellar's figures cover. The
  // label follows Stellar on RAZA's instruction; the tooltip says what the number actually is.
  //
  // And the tab: Stellar says "My Pools", this said "My Positions". Text node only, so the count badge
  // beside it stays live.
  function paintHeadings() {
    var head = $('#poolsBody') && $('#poolsBody').parentNode.querySelector('thead tr');
    if (head) {
      // SORTABLE, AS ON THE TRADE TABLE (RAZA 2026-09-17: "Let me short the pool columns (Liq, Vol, Fees, Participants) from
      // high to low just like im able to sort Trade main page columns"). The arrow marks the column in force and its
      // direction; the four figure columns take a click, and # and Pair stay inert as they are on lumoscore.com.
      var WANT = [['#', null, null], ['Pair', null, null], ['Liquidity ', '↓', 'liq'],
                  ['VOL (TODAY)', '', 'vol'], ['FEES (TODAY)', '', 'fees'], ['Participants ', '', 'holders']];
      var ths = head.querySelectorAll('th');
      for (var i = 0; i < ths.length && i < WANT.length; i++) {
        var th = ths[i];
        var key = WANT[i][2];
        th.textContent = WANT[i][0];
        if (WANT[i][1] != null) {
          var si = document.createElement('span');
          si.className = 'sort-i';
          si.textContent = key === SORT.key ? (SORT.dir < 0 ? '↓' : '↑') : '';
          th.appendChild(si);
        }
        if (key) {
          th.setAttribute('data-lxsort', key);
          th.style.cursor = 'pointer';
          th.title = (i === 3 || i === 4 ? 'Past 24 hours · ' : '') + 'Sort by this column';
        } else {
          th.style.cursor = 'default';
        }
      }
    }
    $$('#poolTabs button[data-tab="mine"], [data-tab="mine"]').forEach(function (b) {
      [].forEach.call(b.childNodes, function (n) {
        if (n.nodeType === 3 && /My Positions/i.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/My Positions/i, 'My Pools');
      });
    });
  }

  // POOL SEARCH ACROSS THE LEDGER (RAZA 2026-09-15: "Its not searching for all the pools of TOTO"). The design's
  // box filters the rows already drawn — fifty of thirty thousand — so a token outside the top hundred could never
  // match. Claimed at window capture (the design's own handler would hide rows), the text is resolved to issuers
  // through the token search, every pool of each issuer is fetched, and those are drawn with the same pager.
  var poolQ = 0;
  function wireSearch(h) {
    if (window.__lxxPoolSearch) return;
    window.__lxxPoolSearch = 1;

    // NO BROWSER FORM HISTORY OVER THIS FIELD. The design ships the input with no autocomplete
    // attribute, so Chrome treats it as an ordinary saved-value field and drops its own white
    // suggestion list over the results -- a second dropdown, in the browser's styling, listing
    // whatever the person last typed ("lumos", "LUMOS") on top of the pool table they are trying to
    // read. Nothing on this page put it there and nothing on this page can style it, so it is turned
    // off at the source instead.
    var box = document.getElementById('poolSearch');
    if (box) {
      box.setAttribute('autocomplete', 'off');
      box.setAttribute('autocorrect', 'off');
      box.setAttribute('autocapitalize', 'off');
      box.setAttribute('spellcheck', 'false');
      // Chrome ignores autocomplete="off" on a field it can NAME, and honours it on one it cannot.
      box.removeAttribute('name');
    }

    var t = null;
    window.addEventListener('input', function (e) {
      var inp = e.target;
      if (!inp || inp.id !== 'poolSearch') return;
      e.stopImmediatePropagation();
      clearTimeout(t);
      t = setTimeout(function () { searchPools(h, String(inp.value || '').trim()); }, 350);
    }, true);
  }

  function searchPools(h, q) {
    var my = ++poolQ;
    var all = window.__lxxPoolsData;
    // Clear any warning from the PREVIOUS search before this one starts. Without this, clearing the
    // box leaves "some pools may be missing" sitting over the full, complete list.
    searchNote(h, null);
    if (q.length < 2) { if (all) renderPage(h, all, 1); return; }
    var ql = q.toLowerCase();
    noteHost(h, 'Searching the XRP Ledger…');
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (my !== poolQ) return;
        // A REFUSED TOKEN SEARCH IS NOT AN EMPTY LEDGER. Pools are found by looking up the issuers behind the typed word,
        // so when that lookup fails there is nothing to look pools up BY — and this used to carry on and report "No pools
        // match that search", which is a claim about the ledger rather than about the request. (RAZA 2026-09-17, searching
        // "lumos" against pools that do exist.)
        // RATE LIMITED IS NOT UNAVAILABLE. This lookup resolves the typed word to ISSUERS, and it is
        // the first thing to go: xrpl.to's anonymous tier is 333 requests a day, and every DISTINCT
        // query is its own URL, so unlike the pool list — one URL, edge-cached, measured as a HIT —
        // searching cannot be amortised and a day of testing exhausts it. (RAZA 2026-10-01, searching
        // "lumen" against pools that plainly exist.)
        //
        // Losing it costs reach, not the feature: pools outside the loaded page become unreachable,
        // but the ones already in hand are still searchable, and a partial answer beats a dead end.
        if (!s || !s.ok) return localPools(h, ql, all, my);
        var seen = {}, issuers = [], vouched = {};
        ((s && s.rows) || []).forEach(function (t) {
          var code = nameOf({ c: t.c, i: t.i }).toLowerCase(), nm = String(t.n || '').toLowerCase();
          if ((code.indexOf(ql) < 0 && nm.indexOf(ql) < 0) || seen[t.i]) return;
          seen[t.i] = 1;
          if (t.vf) vouched[t.i] = 1;
          issuers.push(t.i);
        });
        // VERIFIED ISSUERS ARE ASKED FIRST, BECAUSE THE CAP BELOW DECIDES WHO IS ASKED AT ALL.
        //
        // RAZA 2026-10-19 searched "rlusd" and got ten XRP/RLUSD pools topping out at $2.0K, none of
        // them Ripple's. The real one exists and is the largest pool on the result set by three
        // orders of magnitude: 1.85M XRP + 2.40M RLUSD, $4.82M. It was not ranked badly — it was
        // never queried.
        //
        // Fifty issuers on this ledger use the ticker RLUSD. ISSUER_CAP asks 32 of them, and until
        // now "which 32" was whatever order the search happened to return — so the one issuer the
        // reader actually meant could fall off the end, and the page would then show a complete-
        // looking list built entirely from impostors. The ticker is not the identity; the issuer is.
        // See [[xrpl-verified-tick-rule]] and [[lumoscore-token-logos]].
        //
        // The answer was already in hand: /lxapi/xrplsearch returns vf per row, and for this query
        // exactly one row carries vf=1 with domain ripple.com. This sorts on it. Array sort is
        // stable, so everything else keeps the order it arrived in and nothing else changes.
        issuers.sort(function (a, b) { return (vouched[b] ? 1 : 0) - (vouched[a] ? 1 : 0); });
        // EVERY POOL FOR THE ASSET, which is the point of searching by issuer rather than filtering
        // the loaded page (RAZA 2026-10-07: "it must show all pools for any asset").
        //
        // Two caps used to stop that being true, and both were invisible in the result — a short
        // list reads exactly like a complete one:
        //   * `n=100` per issuer. The endpoint now pages behind a single call, so 1000 covers any
        //     issuer on the ledger; it costs ONE upstream request for a typical issuer because the
        //     paging loop stops the moment a page comes back short.
        //   * `slice(0, 8)` issuers. A ticker like USD is issued by dozens of accounts, so the 9th
        //     onwards contributed nothing and the search quietly understated the ledger. Raised to
        //     32, which covers every code measured here and still bounds a pathological query.
        var ISSUER_CAP = 32;
        window.__lxxPoolSearchTrunc = issuers.length > ISSUER_CAP;
        // A DROPPED ISSUER USED TO LEAVE NO TRACE. This was `.catch(function(){return null;})`, so a
        // single failed request removed every pool of that issuer from the answer and the page then
        // rendered what was left as though it were the whole ledger. For a search where ONE issuer is
        // the one that matters — RLUSD, USDC, anything with impostors — losing exactly that one is
        // indistinguishable from it not existing.
        //
        // Now: a non-200 is an error rather than something r.json() chokes on later, one retry covers
        // the ordinary blip, and anything still failing is COUNTED so the reader can be told the list
        // is partial instead of being shown a short list with a confident total.
        var failed = 0;
        function poolsFor(iss, tries) {
          return fetch('/lxapi/xrplpools?n=1000&issuer=' + encodeURIComponent(iss))
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .catch(function () {
              if (tries > 0) {
                return new Promise(function (go) { setTimeout(go, 600); })
                  .then(function () { return poolsFor(iss, tries - 1); });
              }
              failed++;
              return null;
            });
        }
        // EIGHT AT A TIME, NOT THIRTY-TWO AT ONCE.
        //
        // This was Promise.all over the whole capped list, so a single keystroke fired up to 32
        // concurrent requests of n=1000 at the same endpoint. HTTP/2 multiplexes them onto one
        // connection, so nothing in the browser throttles it and they genuinely all leave together.
        //
        // That is enough to hurt the thing it is asking: while testing this search on 2026-10-19 I
        // reproduced the fan-out and the pools endpoint started answering "Pool data is unavailable
        // right now" to ordinary page loads. A search that degrades the page for everyone else --
        // including the searcher's own next keystroke -- is too expensive however good the answer is.
        //
        // The work is unchanged: the same issuers, the same n=1000, the same completeness. Only the
        // burst is bounded, which also makes the retry above meaningful rather than 32 retries
        // landing on an endpoint that is already struggling.
        return mapLimit(issuers.slice(0, ISSUER_CAP), 8, function (iss) {
          return poolsFor(iss, 1);
        }).then(function (res) {
          if (my !== poolQ) return;
          var rows = [], got = {};
          function add(r) {
            if (!r || !r.acct || got[r.acct]) return;
            if (nameOf(r.a1).toLowerCase().indexOf(ql) < 0 && nameOf(r.a2).toLowerCase().indexOf(ql) < 0) return;
            got[r.acct] = 1;
            rows.push(r);
          }
          res.forEach(function (d) { ((d && d.rows) || []).forEach(add); });
          ((all && all.rows) || []).forEach(add);             // covers XRP, which has no issuer to search by
          rows.sort(function (x, y) { return (+y.liq || 0) - (+x.liq || 0); });
          if (!rows.length) {
            noteHost(h, 'No pools match that search.');
            var pg = $('#paginationAll');
            if (pg) pg.style.display = 'none';
            return;
          }
          renderPage(h, { ok: true, rows: rows, total: rows.length }, 1);
          // SAY SO WHEN THE ANSWER IS PARTIAL. __lxxPoolSearchTrunc has been set here since the cap
          // was introduced and NOTHING HAS EVER READ IT, so a truncated search has always been
          // presented as a complete one — the precise shape of bug this file keeps fixing elsewhere
          // ("a short list reads exactly like a complete one", a few lines above).
          searchNote(h, issuers.length, ISSUER_CAP, failed, q);
        });
      })
      .catch(function () { localPools(h, ql, all, my); });
  }

  // Promise.all with a ceiling on how many run at once. Resolves in the SAME ORDER as the input, so
  // callers that zip results back against their list are unaffected, and never rejects: a thrown
  // worker lands as null in its slot, which is what the per-issuer fetch already does for itself.
  function mapLimit(items, limit, fn) {
    return new Promise(function (done) {
      var out = new Array(items.length), next = 0, active = 0, finished = 0;
      if (!items.length) { done(out); return; }
      function pump() {
        while (active < limit && next < items.length) {
          var idx = next++;
          active++;
          (function (k) {
            var p;
            try { p = fn(items[k]); } catch (e) { p = Promise.resolve(null); }
            Promise.resolve(p).then(function (v) { out[k] = v; }, function () { out[k] = null; })
              .then(function () {
                active--; finished++;
                if (finished === items.length) done(out); else pump();
              });
          })(idx);
        }
      }
      pump();
    });
  }

  // The one line that admits a search did not see everything.
  //
  // Two separate reasons, stated separately because they mean different things to the reader:
  //   * capped   -- more issuers use this ticker than we ask about, so pools exist that are not here
  //   * failed   -- we asked and did not get an answer, so this is a fault rather than a limit
  //
  // Placed in the pager's own "Showing x-y of N" line when there is one, because that line is the
  // page's existing claim about completeness and this is a qualification of it. The phone has no
  // pager, so there it goes directly under the table.
  //
  // Cleared on every search, including the clean ones -- a stale warning is worse than none.
  function searchNote(h, matched, cap, failed, q) {
    var old = document.querySelector('.lxp-partial');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (matched == null) return;                       // called only to clear
    var capped = matched > cap;
    if (!capped && !failed) return;

    var bits = [];
    if (capped) {
      bits.push(cap + ' of ' + matched + ' issuers using "' + q + '" were searched');
    }
    if (failed) {
      bits.push(failed + ' issuer' + (failed === 1 ? '' : 's') + ' could not be read');
    }
    var msg = bits.join('; ') + ' — some pools may be missing.';

    var el = document.createElement('span');
    el.className = 'lxp-partial';
    el.textContent = ' ' + msg;
    el.style.cssText = 'color:var(--text-soft,#9aa0aa);font-size:12px;margin-left:8px';

    var pg = $('#paginationAll');
    var line = pg && pg.querySelector('div');
    if (line) { line.appendChild(el); return; }
    // No pager (the phone build): sit under the list the rows were just written into, rather than a
    // guessed id — h is the host renderPage filled, so it is the one that is certainly on the page.
    if (h && h.parentNode) {
      el.style.display = 'block';
      el.style.margin = '8px 0 0';
      h.parentNode.appendChild(el);
    }
  }

  // What can still be answered without the issuer lookup: the pools already loaded on this page.
  // Narrower than a ledger-wide search and said so rather than dressed up as one.
  function localPools(h, ql, all, my) {
    if (my !== poolQ) return;
    var rows = [];
    ((all && all.rows) || []).forEach(function (r) {
      if (!r || !r.acct) return;
      if (nameOf(r.a1).toLowerCase().indexOf(ql) < 0 && nameOf(r.a2).toLowerCase().indexOf(ql) < 0) return;
      rows.push(r);
    });
    var pg = $('#paginationAll');
    if (!rows.length) {
      noteHost(h, 'No match in the pools loaded here. The ledger-wide asset search is rate limited '
        + 'right now — try again in a minute.');
      if (pg) pg.style.display = 'none';
      return;
    }
    rows.sort(function (x, y) { return (+y.liq || 0) - (+x.liq || 0); });
    if (pg) pg.style.display = 'none';
    renderPage(h, { ok: true, rows: rows, total: rows.length }, 1);
  }

  // Walk the ranking out past the first batch, in the background (RAZA 2026-10-07: raise it to
  // 10,000). It has to be the client that accumulates depth: 10,000 rows is 100 upstream pages, and
  // a Worker on the free plan gets 50 subrequests and 10ms of CPU, so one request asking for all of
  // them fails at page 51. Ten calls of a thousand each stay inside the limits and cache separately.
  //
  // SEQUENTIAL, one batch in flight at a time. The upstream rate-limits readily — this
  // investigation tripped it — so a burst of ten parallel calls would be the thing that breaks it.
  // A failed or short batch simply stops the walk and keeps everything already in hand.
  var DEEP_TARGET = 10000;
  function deepen(h, d) {
    if (!d || !d.more) return;
    var next = d.nextP0 || 11;
    var qAtStart = poolQ;
    function step() {
      // Abandon if the dataset was replaced (reload) or the reader started searching — repainting
      // under a search is the second-writer repaint this project keeps getting bitten by.
      if (window.__lxxPoolsData !== d || poolQ !== qAtStart) return;
      if (d.rows.length >= DEEP_TARGET) return;
      fetch('/lxapi/xrplpools?n=1000&p0=' + next)
        .then(function (r) { return r.json(); })
        .then(function (b) {
          // WHY THE WALK STOPPED, recorded rather than swallowed. The first version of this ended in
          // an empty .catch(), and when the walk halted at 3,000 rows there was no way to tell a
          // rate-limited upstream from a bug in this function — the two look identical from outside.
          // Read window.__lxxPoolsDeep in the console to see where it got to and why.
          window.__lxxPoolsDeep = { rows: d.rows.length, lastP0: next, reason: 'running' };
          if (!b || !b.ok) { window.__lxxPoolsDeep.reason = 'upstream refused (' + ((b && b.error) || 'no body') + ')'; return; }
          if (!b.rows || !b.rows.length) { window.__lxxPoolsDeep.reason = 'empty batch'; return; }
          if (window.__lxxPoolsData !== d || poolQ !== qAtStart) { window.__lxxPoolsDeep.reason = 'superseded'; return; }
          // Dedupe on the AMM account. A repeated page would otherwise pad the count with rows the
          // table already holds, and a padded count is worse than a short one: it reads as coverage.
          var got = {};
          d.rows.forEach(function (r) { if (r && r.acct) got[r.acct] = 1; });
          var added = 0;
          b.rows.forEach(function (r) {
            if (!r || !r.acct || got[r.acct]) return;
            got[r.acct] = 1; d.rows.push(r); added++;
          });
          next = b.nextP0 || (next + 10);
          // Only while the reader is on the first page. Deeper batches can carry a pool whose
          // liquidity puts it near the top, so a repaint reorders the table — fine to watch fill in
          // from page one, not fine to have happen under someone reading page seven.
          window.__lxxPoolsDeep.rows = d.rows.length;
          if (added && pageNo === 1) renderPage(h, d, 1);
          if (!added) { window.__lxxPoolsDeep.reason = 'batch held nothing new'; return; }
          if (!b.more) { window.__lxxPoolsDeep.reason = 'ranking exhausted'; return; }
          if (d.rows.length >= DEEP_TARGET) { window.__lxxPoolsDeep.reason = 'target reached'; return; }
          step();
        })
        .catch(function (err) {
          window.__lxxPoolsDeep = { rows: d.rows.length, lastP0: next, reason: 'threw: ' + ((err && err.message) || err) };
        });
    }
    step();
  }

  function load() {
    var h = listHost();
    if (!h) return;                                    // not the Pools page
    // The LUMOS page's "All LUMOS pools" table is Stellar's own layout (Pool · TVL · 24h Volume · Incentives · View pool),
    // built by ltoken.js from the design's row; this file's Pools-page rows do not belong in it.
    if ($('.lumos-hero-row')) return;
    lift();
    claimRowClicks();
    wireSearch(h);
    // Create Pool is wired now (browser/createpool.js), so the dialog is no longer disabled here.
    paintHeadings();
    paintHeroCopy();
    noteHost(h, 'Reading the XRP Ledger…');

    // BOTH BEFORE RENDERING. The rows now carry a USD headline, and painting them before the rate
    // lands would draw a full table of em dashes that a later pass would have to rewrite — the
    // two-writers-on-one-element shape this project keeps getting bitten by. Promise.all costs
    // nothing here: the tokens response is edge-cached and the two requests overlap.
    Promise.all([
      // n=1000, raised from 100 (RAZA 2026-10-07: "its only considering 100 pools unlike Stellar
      // where it considers all network pools"). 100 was the UPSTREAM's per-request limit, mistaken
      // for a limit on what could be ranked; the endpoint now pages up to ten times behind this
      // single call. The endpoint also had the wrong sort key, so the old hundred were not even the
      // top hundred — see the note there, which is the half of this that actually changes the table.
      // On the LUMOS page the table is "All LUMOS pools", not the site's top ranks (RAZA 2026-09-15),
      // and the issuer filter narrows the upstream to ~22 rows, so it costs one request either way.
      fetch('/lxapi/xrplpools?n=1000' + ($('.lumos-hero-row') ? '&issuer=rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha' : ''))
        .then(function (r) { return r.json(); }),
      fetchUsd(3),
    ]).then(function (both) {
      var d = both[0];
      USD = both[1];
      if (!d || !d.ok || !d.rows.length) { noteHost(h, 'Pool data is unavailable right now.'); return; }
      window.__lxxPoolsData = d;
      renderPage(h, d, 1);
      // The LUMOS page's copy of this table is gated by #poolsBody:not(.lxlt) tr{visibility:hidden}.
      if ($('#poolsBody')) $('#poolsBody').classList.add('lxlt');
      // THE TAB SAID "All Pools 100", which is how many rows we fetched, not how many exist.
      // lumoscore.com shows the real figure there (10,986 on Stellar), and the upstream reports
      // 30,729 active pools for this ledger — so the badge was understating the ledger by three
      // orders of magnitude and reading as "this is all there is".
      //
      // The COUNT is now the truth even though the table still lists a page of them; that is the
      // same thing Stellar does. How many rows to serve is a separate question and a real cost
      // decision — see the note in load().
      var tabCount = $('#poolTabs .count');
      if (tabCount && d.total != null) tabCount.textContent = count(d.total);

      paintSummary(d.summary);
      paintOverview(d);
      attribution(d);
      deepen(h, d);
      // A table of em dashes is repainted the moment a rate does arrive, rather than waiting for the next visit.
      if (USD == null) {
        fetchUsd(4).then(function (u) {
          if (!(u > 0)) return;
          USD = u;
          renderPage(h, d, 1);
          paintSummary(d.summary);
          paintOverview(d);
        });
      }
    }).catch(function () { noteHost(h, 'Pool data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolsReload = load;
})();
