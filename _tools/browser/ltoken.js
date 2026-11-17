// $LUMOS page: the real token on the XRP Ledger.
//
// This page was wrong TWICE OVER, in two different ways, which is worth spelling out because they
// need different fixes:
//
//   1. The markup ships MOCK values -- $0.00320, "+5.6% (24h)", "$3.20M on 1B circulating",
//      "3,208 holders". Against a real price of $0.0000344 that is 93x too high. It is what anyone
//      sees before the script runs, or forever if the script fails.
//   2. `lx-ltdata` then overwrote the mock with STELLAR LUMOS: $0.00005425, 936 holders, 996.57M
//      circulating, "LUMOS/XLM mark". Live, plausible, and the wrong ledger's token on a page
//      titled "LUMOS on the XRP Ledger".
//
// Real XRPL LUMOS, verified: $0.0000344, 1,200 holders, 705,205,451 circulating of 999,955,353
// issued. Every slot this file touches is set from that, and anything without a source is set to an
// em dash rather than left showing either fiction.
//
// The issuer is BLACKHOLED (DisableMaster + RegularKey = ACCOUNT_ZERO), so the supply is fixed and
// no more LUMOS can ever be minted. That is the single most important fact on this page and it is
// stated rather than implied by a number.
(function () {
  if (window.__lxxLToken) return;
  window.__lxxLToken = 1;

  var ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CUR = '4C554D4F53000000000000000000000000000000';

  // Anything that arrives on a second request and has to survive a repaint. `pools` starts null,
  // not 0: an unknown count must render as a dash, and 0 is a claim that LUMOS has no pools.
  var state = { pools: null };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // textContent for anything off the ledger: a currency name is arbitrary bytes from a public chain
  // and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function usd(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toPrecision(4);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + (v / 1e3).toFixed(1) + 'K';
    if (v < 1e9) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + (v / 1e9).toFixed(2) + 'B';
  }

  function big(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return Math.round(v).toLocaleString('en-US');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  }

  // Match a stat cell by its LABEL rather than by position: the page has five of them and their
  // order is a layout decision that can change without anyone thinking about this file.
  function setStat(match, value, sub) {
    var cells = $$('.cstat');
    for (var i = 0; i < cells.length; i++) {
      var lbl = cells[i].querySelector('.lbl') || cells[i].firstElementChild;
      if (!lbl) continue;
      if (lbl.textContent.trim().toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.val');
      if (v) v.textContent = value;
      if (sub != null) {
        var s = cells[i].querySelector('.sub') || cells[i].querySelector('.lx-supnum');
        if (!s) { s = el('div', 'sub'); cells[i].appendChild(s); }     // the Pools cell ships without one
        if (s.textContent !== sub) s.textContent = sub;
      }
      return true;
    }
    return false;
  }

  // Eighth gate of this shape:
  //     .hero-price-block:not(.lxlt) .price, .change, .sub-v { visibility: hidden }
  // The old script added .lxlt once it had a price; its stylesheet outlived it. Without this the
  // hero shows the right price, invisibly.
  function lift() {
    // TWELFTH GATE, AND THE PHONE'S CONTAINER HAS A DIFFERENT NAME. NO BACKTICKS IN THIS COMMENT.
    //
    // RAZA 2026-10-20: "Big font price is missing" on the XRPL phone page. It was not missing, it was
    // INVISIBLE — the stylesheet carries two gates of the same shape and this lifted only one:
    //     .hero-price-block:not(.lxlt) .price ...   desktop
    //     .hero-price:not(.lxlt) .price ...         phone
    // Measured on the page: no .hero-price-block at all on that layout, .price sitting inside
    // .price-row holding the design's mock $0.00320 at visibility:hidden. The painter below missed
    // it for the same reason, so even the right number would never have been written.
    //
    // Exactly the trap the notes on this file already describe twice — a gate whose element was
    // renamed between layouts stays shut for ever, and the DOM looks perfect while the screen is
    // blank. Both names are lifted now.
    $$('.hero-price-block, .hero-price').forEach(function (h) { h.classList.add('lxlt'); });

    // Eleventh gate, same stylesheet, same shape, different element:
    //     .cstat:not(.lxlt) .val, .cstat:not(.lxlt) .sub { visibility: hidden }
    // Every stat card under the hero -- market cap, FDV, holders, pools, 24h volume -- was being
    // filled with correct figures and then hidden, so the row read as five empty boxes with labels.
    // Nothing in the DOM complained: right text, right numbers, display:block. Only the screenshot
    // showed the gap, which is the third time on this page that has been the deciding check.
    var cs = document.querySelectorAll('.cstat');
    for (var i = 0; i < cs.length; i++) cs[i].classList.add('lxlt');

    // A GATE THAT NEVER OPENS IS WORSE THAN THE FLASH IT PREVENTS.
    //
    // The .lt-cmp-foot gate hides the "View all N pools" button until paintTabsAndLinks has written
    // a real count. If the pool lookup never answers, that button stays invisible for ever -- and a
    // missing link is a worse trade than a wrong number, because the page silently loses a way out
    // of itself. This codebase has shipped exactly that shape before: a mask whose reveal depended
    // on data that did not arrive.
    //
    // So after six seconds, drop the COUNT rather than the button. "View all pools" is true without
    // the figure and is the one wording that cannot be stale. Only fires if the real write never
    // happened -- once the count lands, .lxlt is already set and this finds nothing to do.
    try {
      setTimeout(function () {
        var fts = document.querySelectorAll('.lt-cmp-foot:not(.lxlt)');
        for (var k = 0; k < fts.length; k++) {
          var b = fts[k].querySelector('button,a');
          if (b) b.textContent = 'View all pools →';
          fts[k].classList.add('lxlt');
        }
      }, 6000);
    } catch (e) {}
  }

  // THE PAGE NAMED THREE DIFFERENT CHAINS, none of them this one. Beside a correct XRP Ledger price
  // and a correct 999.96M supply, the hero read "Native utility token · live on Aptos", the network
  // chip said "Aptos", the comparison block said "Aptos", and the supply line said "1 billion LUMOS ·
  // fixed supply on Stellar."
  //
  // Those are labels the numbers already contradict, which is the most confusing way for a page to be
  // wrong: everything measurable is right, and everything that says what you are looking at is not.
  //
  // The supply line is corrected to the real figure rather than the round one. 999,955,353 is what the
  // ledger reports, and the reason it can never change is worth saying outright: the issuer is
  // BLACKHOLED (DisableMaster + RegularKey = ACCOUNT_ONE), so no more can be minted by anyone, ever.
  // "1 billion" is a rounding of a number whose exactness is the entire point.
  function paintChainLabels() {
    // lumoscore.com's line, word for word (RAZA 2026-09-15: "LUMOS token page on XRPL has issues").
    $$('.lh-desc').forEach(function (e) {
      var want = 'LumosCore’s native utility token — powers platform fees and rewards';
      if (e.textContent !== want) e.textContent = want;
    });
    $$('.net-tag, .lt-cmp-chain').forEach(function (e) {
      if (/Aptos|Stellar/i.test(e.textContent || '')) {
        try { e.setAttribute('data-logoed', '1'); } catch (_) {}
        e.textContent = 'XRP Ledger';
      }
    });
    $$('.sub-h').forEach(function (e) {
      var t = e.textContent || '';
      if (!/fixed supply/i.test(t)) return;
      // "1 billion", as lumoscore.com states it (RAZA 2026-09-15: "make it 1 Billion LUMOS instead of 999,955,353").
      e.textContent = '1 billion LUMOS · fixed supply on the XRP Ledger.';
    });

    // THE SAME SENTENCE LIVES UNDER OTHER CLASSES, and the phone has none of them as `.sub-h`. Left
    // to the rule above, a phone opening the XRP Ledger's own token page read
    //     "Supply distribution — 1 billion LUMOS · fixed supply on Stellar."
    // and, below it, "Fixed supply of 1,000,000,000 LUMOS" against an issued 999,955,353.
    //
    // Rewritten by TEXT NODE and by substitution rather than by replacing each block's text: these
    // sentences continue past the part that is wrong ("...issuer key locked. Allocation is..."), and
    // assigning textContent would take the rest of the sentence with it.
    var SUPPLY_FIX = [
      [/\b999,955,353 LUMOS\b/g, '1,000,000,000 LUMOS'],
      [/\bon (Stellar|Aptos)\b/gi, 'on the XRP Ledger'],
    ];
    $$('.sect-head .sub, .supply-totem .note, .supply-note, .lt-supply').forEach(function (e) {
      var w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        var t = n.nodeValue;
        // NO KEYWORD GATE. It was `/supply|Stellar|Aptos/`, which skipped the one node that mattered:
        // the sentence is split as "Fixed supply of " + <strong>1,000,000,000 LUMOS</strong> + ",
        // issuer key locked", so the node holding the figure contains none of those words. The
        // replacements below are already specific enough to be their own filter.
        if (!t) continue;
        var out = t;
        for (var i = 0; i < SUPPLY_FIX.length; i++) out = out.replace(SUPPLY_FIX[i][0], SUPPLY_FIX[i][1]);
        if (out !== t) n.nodeValue = out;
      }
    });

    // The allocation note is PROSE, and it described the wrong ledger's market: "added, a little at a
    // time, to LUMOS liquidity on Stellar — the LUMOS/XLM pool and the other LUMOS pairs". The pair
    // it names does not exist here; the quote asset on this ledger is XRP.
    //
    // Rewritten by TEXT NODE so the sentence keeps whatever markup the design wrapped parts of it in
    // — replacing the block's innerHTML would flatten that and is not needed to change two words.
    $$('.alloc-note').forEach(function (block) {
      var w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      var nd;
      while ((nd = w.nextNode())) {
        var v = nd.nodeValue;
        if (!v || !/Stellar|XLM/.test(v)) continue;
        nd.nodeValue = v.replace(/LUMOS\/XLM/g, 'LUMOS/XRP')
          .replace(/\bon Stellar\b/g, 'on the XRP Ledger')
          .replace(/\bStellar\b/g, 'the XRP Ledger')
          .replace(/\bXLM\b/g, 'XRP');
      }
    });
  }

  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';

  // STELLAR'S HERO: the flame mark, the network chip with its logo, the issuer address (behind an inherited
  // .addr-row:not(.lxlt) gate, which is why it read blank), the explorer link and the home-domain link.
  // THE HEADER IS MISSING ONE EMPTY DIV. NO BACKTICKS IN THIS COMMENT.
  //
  // RAZA 2026-10-20: "Launch app, search, and menu in header is not alligned as on other mobile XRPL
  // pages." Measured against /pools/xrpl at the same width — same classes, same padding, same gap,
  // same heights, and the controls 94px to the left:
  //
  //     pools   Launch App x=144   search x=273   menu x=326
  //     lumos   Launch App x=50    search x=178   menu x=231
  //
  // The appbar is a flex row and every other page carries a <div class="grow"> between the logo and
  // the buttons, flex 1 1 0%, which eats the slack and pushes the group to the right edge. This page
  // does not have it, so the buttons sit immediately after the logo. Nothing is styled differently;
  // one element is absent.
  //
  // Added only when missing, and only here: this is a defect in one page's markup, not a rule about
  // appbars, and a blanket fix would push the group on any layout that leaves it out on purpose.
  function fixAppbar() {
    var bar = $('.appbar');
    if (!bar || bar.querySelector(':scope > .grow')) return;
    var logo = bar.querySelector(':scope > .logo');
    var sp = document.createElement('div');
    sp.className = 'grow';
    sp.setAttribute('aria-hidden', 'true');
    // THE CLASS IS INERT ON THIS PAGE, so the flex is set directly. Adding the element alone moved
    // the buttons by six pixels and no further: measured, there is no .grow rule in any stylesheet
    // this page loads — the appbar markup and the rule that makes it work were stripped together.
    // Relying on the class here would have been a fix that looks right in the DOM and does nothing,
    // which is the same stripped-layer trap the price gate above was.
    sp.style.flex = '1 1 0%';
    if (logo && logo.nextSibling) bar.insertBefore(sp, logo.nextSibling);
    else if (logo) bar.appendChild(sp);
    else bar.insertBefore(sp, bar.firstChild);
  }

  function paintHeroExtras() {
    fixAppbar();
    // BOTH LAYOUTS. NO BACKTICKS IN THIS COMMENT.
    //
    // RAZA 2026-10-20: "LUMOS logo is missing and instead there's this orange placeholder" — on the
    // PHONE only. This read .lumos-icon, which is the desktop mark; the phone's is .lumos-big-icon.
    // The selector matched nothing there, so the design's own letter avatar — an orange disc with an
    // L — was left exactly as shipped. The same one-layout habit as the Trade chip, the search
    // placeholder, the sort sheet and the exchange-row address.
    //
    // The phone mark also CONTAINS that letter, so a background alone would have sat behind it. The
    // contents are replaced with an img, which is both the fix and the escape the ticker-logo healer
    // honours — it repaints any one-to-five-character element that looks like an icon, and "L" in a
    // round box is exactly that.
    $$('.lumos-icon, .lumos-big-icon').forEach(function (ic) {
      ic.setAttribute('data-lxlogo', '1');
      ic.setAttribute('data-logoed', '1');
      if (!ic.querySelector('img[data-lxlogoimg]')) {
        ic.textContent = '';
        var fi = document.createElement('img');
        fi.src = '/assets/favicon.png';
        fi.alt = '';
        fi.setAttribute('data-lxlogoimg', '1');
        fi.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
        ic.appendChild(fi);
      }
      [['background-image', 'none'], ['background-color', 'transparent'],
        ['box-shadow', 'none'], ['overflow', 'hidden']]
        .forEach(function (kv) { ic.style.setProperty(kv[0], kv[1], 'important'); });
    });
    $$('.addr-row').forEach(function (row) {
      row.classList.add('lxlt');
      var tag = row.querySelector('.net-tag');
      // REBUILT EVEN WHEN A .b-ico IS ALREADY THERE (RAZA 2026-10-09: "Aptos logo showing up on Lumos
      // token page on XRPL"). The guard used to be `!tag.querySelector('.b-ico')` — build the mark
      // only if the tag has none — and the design ships one, holding APTOS's logo as a 96x96 base64
      // webp. So the condition was false, this block never ran, and the row read "XRP Ledger" beside
      // Aptos's mark. Confirmed by blowing the image up on the deployed page rather than inferring it
      // from the filename: there is no filename, which is also why every Aptos sweep misses it — they
      // match text, and this is pixels.
      //
      // The whole tag is rewritten rather than the nested <img> repointed, because the shipped
      // structure nests the image inside a 7px span and repointing it would leave an XRP mark at 7px
      // in a larger circle. data-lxnet marks it done, so a second call is a no-op instead of
      // rebuilding on every paint.
      if (tag && tag.getAttribute('data-lxnet') !== 'xrpl') {
        tag.textContent = '';
        tag.setAttribute('data-logoed', '1');
        tag.setAttribute('data-lxnet', 'xrpl');
        var bi = el('span', 'b-ico');
        var im = document.createElement('img');
        im.src = XRP_LOGO;
        im.alt = '';
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        bi.appendChild(im);
        tag.appendChild(bi);
        tag.appendChild(document.createTextNode(' XRP Ledger '));
      }
      var ex = row.querySelector('.addr-actions a.addr-btn');
      if (ex) {
        ex.href = 'https://bithomp.com/explorer/' + ISS;
        ex.target = '_blank';
        ex.rel = 'noopener nofollow';
        ex.setAttribute('data-tooltip', 'View on XRPL Explorer');
        ex.setAttribute('data-lxex', '1');
      }
      if (!row.querySelector('.lx-lt-dom')) {
        var dom = el('a', 'lx-lt-dom');
        dom.href = 'https://lumoscore.com';
        dom.target = '_blank';
        dom.rel = 'noopener';
        dom.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg><span>lumoscore.com</span>';
        row.appendChild(dom);
      }
    });
    // THE SECOND COPY OF THE SAME INHERITED MARK. The comparison row carries its own wrapper —
    // .lt-cmp-chain > .lt-cmp-ico — holding Aptos's base64 webp nested inside a 14px span, beside the
    // words "XRP Ledger". Found by sweeping the page for that image after fixing the .net-tag one and
    // discovering a second still rendering, which is the only reason it is here: the text pass in
    // paintChainLabels() cannot reach it (it matches text, and this is pixels) and the .addr-row
    // rebuild above is scoped to .net-tag.
    //
    // The ICON is emptied rather than the whole chain element, because .lt-cmp-chain also holds the
    // label and the row's own structure. data-lxnet makes a second call a no-op.
    $$('.lt-cmp-ico').forEach(function (ic) {
      if (ic.getAttribute('data-lxnet') === 'xrpl') return;
      ic.setAttribute('data-lxnet', 'xrpl');
      ic.textContent = '';
      var cim = document.createElement('img');
      cim.src = XRP_LOGO;
      cim.alt = '';
      cim.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
      ic.appendChild(cim);
    });
    // The XRP price and the 24h change share one line under the dollar price, as on lumoscore.com.
    $$('.hero-price-block').forEach(function (hb) {
      if (hb.querySelector('.lx-pricemeta')) return;
      var pn = hb.querySelector('.price-native'), ch = hb.querySelector('.change');
      if (!pn || !ch) return;
      var meta = el('div', 'lx-pricemeta');
      meta.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap';
      pn.parentNode.insertBefore(meta, pn);
      meta.appendChild(pn);
      meta.appendChild(ch);
    });
  }

  // Counts beside the Pools and Holders tabs, drawn by the inherited .lt-tab[data-count]::after rule, and the supply
  // card's link naming the real pool count (RAZA 2026-09-15: "Pools and holders count is not showing up here").
  function paintTabsAndLinks(d) {
    var pl = $('.lt-tab[data-t="pl"]'), hl = $('.lt-tab[data-t="hl"]');
    if (pl && state.pools != null) pl.setAttribute('data-count', '(' + state.pools + ')');
    var hc = (d && d.holders != null) ? Math.round(d.holders) : state.holders;   // the same figure as the Holders stat
    if (hl && hc != null) hl.setAttribute('data-count', '(' + hc.toLocaleString('en-US') + ')');
    if (state.pools != null) {
      $$('button[data-goto="pl"], .lt-cmp-foot button, .lt-cmp-foot a').forEach(function (b) {
        var want = 'View all ' + state.pools + ' pools →';
        if (/View all/.test(b.textContent || '') && b.textContent !== want) b.textContent = want;
        // REVEAL, NOW THAT THE COUNT IS OURS.
        //
        // The design ships "View all 14 pools" in the markup against a real 22, and the health bot
        // caught it flashing: 14 held from 563ms, corrected to 22 at 903ms. The row values beside
        // this button were gated all along and the button never was -- Stellar's note on the same
        // bug says why, and it is worth repeating: it reads as a link rather than as data. It is
        // both. The number in it is as wrong as any other stale figure on the page.
        //
        // Outside the text write on purpose: when the markup already happens to carry the right
        // count there is nothing to replace, and a reveal that only runs on a CHANGE would leave
        // the button hidden for ever on exactly those loads.
        var ft = b.closest ? b.closest('.lt-cmp-foot') : null;
        if (ft) ft.classList.add('lxlt');
      });
    }
  }

  // Stellar's allocation (RAZA 2026-09-15: "Token count and % is missing"): six rows summing to one billion — Market
  // Reserve 300M, Ecosystem LP 240M, Native LP 240M, Team 100M, Whale Holder 50M, Airdrops 70M. The design's extra
  // "Cross-Chain Reserve" row is not on lumoscore.com, and the figures sat behind .alloc-legend:not(.lxlt).
  function fixAllocation() {
    $$('.alloc-row').forEach(function (r) {
      var nm = ((r.querySelector('.name') || {}).textContent || '');
      if (/Cross-Chain Reserve/i.test(nm)) { if (r.parentNode) r.parentNode.removeChild(r); return; }
      if (/Airdrops/i.test(nm)) {
        var am = r.querySelector('.amount'), pc = r.querySelector('.pct');
        if (am && am.textContent !== '70M') am.textContent = '70M';
        if (pc && pc.textContent !== '7%') pc.textContent = '7%';
        r.style.gridColumn = 'auto';
        r.style.maxWidth = 'none';
      }
    });
    $$('.alloc-seg').forEach(function (s) {
      var st = s.getAttribute('style') || '';
      if (st.indexOf('--alloc-5)') >= 0) { if (s.parentNode) s.parentNode.removeChild(s); }
      else if (st.indexOf('--alloc-7)') >= 0 && s.style.width !== '7%') s.style.width = '7%';
    });
    $$('.alloc-legend').forEach(function (l) { l.classList.add('lxlt'); });
  }

  // "What you can do with LUMOS" sits ABOVE Supply distribution, as on lumoscore.com (RAZA 2026-09-15). Each is a
  // .section-head followed by its body in the page's own flow; the utility block is moved once, found by its heading.
  function reorderSections() {
    var main = $('main.page');
    if (!main || main.getAttribute('data-lxorder') === '1') return;
    var kids = [].slice.call(main.children);
    var headOf = function (re) {
      return kids.filter(function (k) { return k.classList.contains('section-head') && re.test(k.textContent || ''); })[0];
    };
    var sup = headOf(/Supply distribution/i), ut = headOf(/What you can do/i);
    if (!sup || !ut) return;
    var ui = kids.indexOf(ut), si = kids.indexOf(sup);
    main.setAttribute('data-lxorder', '1');
    if (ui < si) return;
    var block = [ut];
    for (var i = ui + 1; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList.contains('section-head') || k.tagName === 'SECTION' || k.querySelector('h2')) break;
      block.push(k);
    }
    block.forEach(function (n) { main.insertBefore(n, sup); });
  }

  // Stellar's medals for the top three holders.
  function medalSVG(i) {
    var c = [{ a: '#ffe487', b: '#e3a81a', s: '#b9860f', t: '#6d4a00' },
      { a: '#ffffff', b: '#b6bcc6', s: '#8b93a0', t: '#4c5661' },
      { a: '#f3c79a', b: '#c07a3c', s: '#97592a', t: '#5f3616' }][i];
    var id = 'lxmed' + i;
    return '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">'
      + '<defs><radialGradient id="' + id + '" cx="36%" cy="28%" r="78%"><stop offset="0%" stop-color="' + c.a + '"></stop><stop offset="100%" stop-color="' + c.b + '"></stop></radialGradient></defs>'
      + '<circle cx="20" cy="21" r="15.5" fill="url(#' + id + ')" stroke="' + c.s + '" stroke-width="2"></circle>'
      + '<circle cx="20" cy="21" r="12.3" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"></circle>'
      + '<path d="M12 3 L16 12 L12 11 L8 12 Z" fill="' + c.s + '"></path><path d="M28 3 L32 12 L28 11 L24 12 Z" fill="' + c.s + '"></path>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="' + c.t + '">' + (i + 1) + '</text>'
      + '</svg>';
  }

  // A small symmetric identicon for a holder's avatar, drawn from the address itself (the design's .av held another
  // chain's logo).
  function identUri(a) {
    var h = 0, i;
    for (i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
    var hue = h % 360, cells = '';
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        h = (h * 1103515245 + 12345) >>> 0;
        if ((h >>> 16) & 1) {
          cells += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8"/>';
          if (x < 2) cells += '<rect x="' + ((4 - x) * 8) + '" y="' + (y * 8) + '" width="8" height="8"/>';
        }
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(' + hue
      + ',58%,46%)"/><g fill="rgba(255,255,255,.92)">' + cells + '</g></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function paint(d) {
    lift();
    paintChainLabels();
    // ---- hero -------------------------------------------------------------------------------
    // Both layouts, for the reason spelled out in lift(): the phone's hero is .hero-price, not
    // .hero-price-block, so this wrote nothing there and the design's mock stayed under the gate.
    var price = $('.hero-price-block .price') || $('.hero-price .price') || $('.price-row .price');
    if (price) price.textContent = d ? usd(d.usd) : '—';

    var native = $('.price-native');
    if (native) {
      native.textContent = (d && d.price != null)
        ? ('≈ ' + Number(d.price).toPrecision(3) + ' XRP')
        : '≈ — XRP';
    }

    var change = $('.hero-price-block .change');
    if (change) {
      var p = d ? pct(d.p24) : null;
      change.textContent = p == null ? '— (24h)' : (p + ' (24h)');
      change.className = 'change ' + (d && d.p24 != null && d.p24 < 0 ? 'down' : 'up');
    }

    // ---- stat cells --------------------------------------------------------------------------
    // THE SAME RULE AS THE TRADE-ASSET PAGE: issued x price (RAZA 2026-10-17: "This is not the
    // correct marketcap of LUMOS that shows on lumos token page. It shows correctly on Trade-asset
    // page"). The two pages described the same token with figures three and a half times apart --
    // $12.8K here against $44,221 one click away -- because this one used the upstream `marketcap`,
    // which is price x CIRCULATING, while dexasset.js settled on issued x price back on 2026-10-12
    // ("just multiply the supply with price") so that a page cannot show its workings and then
    // contradict them.
    //
    // For LUMOS the gap is the whole question: xrpl.to treats 710.55M held across four wallets as
    // non-circulating, leaving 289.40M. The issuer is blackholed, so the issued figure is fixed and
    // is the one the ledger agrees with -- and it is what the supply box on both pages already shows.
    //
    // USD DIRECTLY from issued x the USD price, rather than computing an XRP market cap and then
    // converting it. One multiplication instead of three, and no division by `price` that could be
    // zero. The old expression is kept only as the fallback for a reply with no `issued`.
    var mcapUsd = (d && d.issued != null && d.usd != null)
      ? d.issued * d.usd
      : ((d && d.marketcap != null && d.usd != null && d.price) ? d.marketcap * (d.usd / d.price) : null);
    setStat('market cap', d ? usd(mcapUsd) : '—',
      d && d.issued != null ? ('on ' + big(d.issued) + ' issued')
        : (d && d.circulating != null ? ('on ' + big(d.circulating) + ' circulating') : null));

    // THE FULLY DILUTED CELL IS GONE (RAZA 2026-10-17: "We dont need fully diluted val. Remove that
    // box"), and he is right that it says nothing here. Dilution is a forecast about tokens that
    // might still be minted; this issuer is blackholed, so no more can ever exist and the issued
    // total can only FALL as tokens are burned back to it. A "fully diluted" figure for a fixed
    // supply is just the market cap with a different divisor, printed beside it.
    //
    // REMOVED FROM THE DOM, not blanked. setStat only rewrites text, so leaving it out would have
    // left the design's baked mock figure sitting in the cell -- the hidden-mock trap this codebase
    // has hit before. The cell itself has to go.
    (function () {
      var cells = $$('.cstat');
      for (var i = 0; i < cells.length; i++) {
        var lbl = cells[i].querySelector('.lbl') || cells[i].firstElementChild;
        if (!lbl) continue;
        // "FDV" AND "diluted" ARE THE SAME CARD WEARING TWO LABELS. NO BACKTICKS IN THIS COMMENT.
        //
        // This matched only "diluted", which is the DESKTOP wording. The phone card is labelled
        // "FDV", so the removal above has never fired there and RAZA still had the box on mobile
        // (2026-10-20, "Remove FDV box"). Matching both, and not breaking after the first hit, so a
        // layout carrying both spellings loses both.
        var lt = lbl.textContent.trim().toLowerCase();
        if (lt.indexOf('diluted') < 0 && lt.indexOf('fdv') < 0) continue;
        if (cells[i].parentNode) cells[i].parentNode.removeChild(cells[i]);
      }

      // AND THE LAST CARD STOPS SPANNING BOTH COLUMNS (RAZA 2026-10-20: "Pools and 24h volume section
      // should be right below Market cap and Holders boxs just like on Stellar").
      //
      // `.lh-stats` is a two-column grid and the design puts an INLINE style="grid-column: 1 / -1"
      // on its last card. With the five cards it shipped that is correct -- 2 + 2 + 1, and the odd
      // one out fills the row. Removing the FDV box above leaves four, so the span turns a clean
      // 2x2 into 2 + 1 + 1 with a hole beside Pools. Measured on the phone before this fix:
      //
      //     Market Cap 151 | Holders 151 | Pools 151 | 24h Volume 303   (grid 151.3px 151.3px)
      //
      // A STYLESHEET RULE WOULD HAVE DONE NOTHING -- the span is inline, so it outranks any selector
      // we could add short of !important, and nothing in the cascade matches these cards anyway.
      // The inline property has to be removed from the element.
      //
      // Keyed on the COUNT, not on which card it is: clear the span whenever an even number of cards
      // survives, leave it when an odd number does. So this stays right if the FDV removal above ever
      // stops matching, and right again if a card is added later. Same fix, same reasoning, as
      // Stellar's _lumostoken.js -- the two pages inherit the one design.
      var kept = $$('.cstat');
      if (kept.length % 2 === 0) {
        for (var j = 0; j < kept.length; j++) {
          try { kept[j].style.removeProperty('grid-column'); } catch (_) {}
        }
      }
    })();

    setStat('holder', d && d.holders != null ? Math.round(d.holders).toLocaleString('en-US') : '—',
      d && d.trustlines != null ? (Math.round(d.trustlines).toLocaleString('en-US') + ' trustlines') : null);

    setStat('volume', d && d.vol24 != null && d.usd != null && d.price
      ? usd(d.vol24 * (d.usd / d.price)) : '—', 'past 24h');

    // ---- supply numbers ----------------------------------------------------------------------
    // THE ELEMENT HAS TO EXIST BEFORE ANYTHING CAN FILL IT.
    //
    // This loop has always run over an empty list on every XRPL page -- there is no .lx-supnum in
    // the fork's markup and nothing here created one, so `issued` was fetched, had somewhere to go,
    // and was dropped on the floor. Stellar's _lumostoken.js BUILDS the span when it is missing, in
    // both places it writes one (`if(!ns){ ...innerHTML... }`); the fork inherited the reader and
    // not the writer, which is why the health bot saw "no .lx-supnum on the page" rather than a
    // wrong number. A selector that matches nothing fails silently and for ever.
    //
    // It belongs in the supply totem, between the round "1B" and the note, because that note's
    // "Fixed supply of 1,000,000,000 LUMOS" is DELIBERATE prose and stays. Both figures are true and
    // they are not the same fact: 1,000,000,000 was minted, the issuer is blackholed so that can
    // never change, and tokens sent back to it are burned -- so the ISSUED figure can only fall. It
    // is 999,952,640 today. Showing the minted number alone quietly rounds away every burn.
    //
    // Deliberately NOT given class "note": SUPPLY_FIX above rewrites text nodes inside
    // `.supply-totem .note`, so a live number parked there would be a rewrite target instead of a
    // reading. Styled inline rather than through a stylesheet, because a new `<style id="lx-...">`
    // on this page is one more layer for stripById to shut off and one more duplicate to pile up.
    var totem = $('.supply-totem');
    if (totem && !totem.querySelector('.lx-supnum')) {
      var issuedLine = el('div', 'lt-issued');
      issuedLine.style.cssText = 'font-size:14px;color:var(--text-soft);margin-top:10px;line-height:1.4';
      issuedLine.appendChild(document.createTextNode('Currently issued '));
      var issuedNum = el('span', 'lx-supnum');
      issuedNum.style.cssText = 'font-family:"JetBrains Mono",monospace;color:var(--text-muted)';
      issuedLine.appendChild(issuedNum);
      var totemNote = totem.querySelector('.note');
      if (totemNote) totem.insertBefore(issuedLine, totemNote); else totem.appendChild(issuedLine);
    }

    $$('.lx-supnum').forEach(function (e) {
      var t = e.textContent;
      if (/circulating/i.test(t)) e.textContent = d && d.circulating != null
        ? ('on ' + big(d.circulating) + ' circulating') : 'circulating —';
      else if (d && d.issued != null) e.textContent = Math.round(d.issued).toLocaleString('en-US') + ' LUMOS';
    });

    // ---- the comparison panel -----------------------------------------------------------------
    // EVERY row here shipped with the design's mock still in it, and the mock is not merely stale:
    // it quoted $0.00322 against a real price of $0.00003413 -- a hundredfold overstatement -- plus
    // a flat 1,000,000,000 circulating where 705.21M is issued-and-circulating, and a "LUMOS/XLM
    // mark" for a chain this page is not about. Only the holders row was being replaced, and the
    // whole panel happened to be sitting behind a visibility gate, which is the single reason a
    // hundredfold-wrong price was never on screen. Every row is now written from `d` or dashed.
    $$('.lt-cmp-row').forEach(function (row) {
      var v = row.querySelector('.lt-cmp-v');
      if (!v) return;
      var label = ((row.querySelector('.lt-cmp-l') || row).textContent || '').toLowerCase();

      // Each row carries its own trailing span and they are NOT interchangeable: `.chg` holds the
      // 24h change, `.sub` a secondary line, `.u` the unit. Setting textContent drops whichever one
      // the row had, so keep it and refill it -- otherwise the price row silently loses its change
      // figure and the supply row loses the word LUMOS.
      var tail = v.querySelector('.chg, .sub, .u');
      var setV = function (main, tailText) {
        v.textContent = main;
        if (tail && tailText != null) { tail.textContent = tailText; v.appendChild(tail); }
      };

      if (/price/.test(label)) {
        setV(d ? usd(d.usd) : '—', d && d.p24 != null ? pct(d.p24) : '—');
        if (tail) tail.className = 'chg ' + (d && d.p24 != null && d.p24 < 0 ? 'down' : 'up');
      } else if (/volume/.test(label)) {
        // The subline said "across 11 pools" -- a second stale count, in prose this time.
        setV(d && d.vol24 != null && d.usd != null && d.price
          ? usd(d.vol24 * (d.usd / d.price)) : '—',
          state.pools == null ? 'across — pools' : ('across ' + state.pools + ' pools'));
      } else if (/circulating|supply/.test(label)) {
        setV(d && d.circulating != null
          ? Math.round(d.circulating).toLocaleString('en-US') : '—', 'LUMOS');
      } else if (/holder/.test(label)) {
        // Both counts are named, as on lumoscore.com (RAZA 2026-09-15: "Trustlines (besides Holders) is missing").
        var labEl = row.querySelector('.lt-cmp-l');
        if (labEl && labEl.textContent !== 'Holders · Trustlines') labEl.textContent = 'Holders · Trustlines';
        setV(d && d.holders != null
          ? (Math.round(d.holders).toLocaleString('en-US')
            + (d.trustlines != null ? ('  ·  ' + Math.round(d.trustlines).toLocaleString('en-US')) : ''))
          : '—', null);
      } else if (/pool/.test(label)) {
        setV(state.pools == null ? '—' : String(state.pools), null);
      } else if (/xlm|stellar/.test(v.textContent.toLowerCase())) {
        v.textContent = '—';
      }

      // Twelfth gate: `.lt-cmp-row:not(.lxlt) .lt-cmp-v { visibility:hidden }`. Lifted PER ROW and
      // only after that row has been written, so the mock it shipped with can never be the thing
      // that becomes visible. Lifting the panel up front would have put $0.00322 on screen.
      row.classList.add('lxlt');
    });

    // The pools stat card is not in the payload at all, so it was showing the design's mock 14.
    setStat('pool', state.pools == null ? '—' : String(state.pools), 'LUMOS pairs');
    paintHeroExtras();
    paintTabsAndLinks(d);
    fixAllocation();
    reorderSections();
  }

  // How many AMM pools hold LUMOS. /lxapi/xrplpools?issuer= narrows the upstream's 30,648 pools to
  // the ones with a LUMOS side; `total` is the count, independent of the page size asked for.
  // THE PHONE'S "All LUMOS pools" LIST. The desktop page renders a table that browser/pools.js
  // fills; the phone renders `#poolList` of `.pool-item` anchors, which nothing filled — so it
  // showed ten invented pools, "LUMOS / APT", each pill reading "Aptos" and each anchor carrying
  // data-chain="stellar", on the XRP Ledger's own token page.
  //
  // Same data the count above already fetched, so this costs no extra request.
  // THE PHONE ROW NOW SAYS WHAT THE DESKTOP TABLE SAYS (RAZA 2026-11-18: "On XRPL LUMOS token page, pools tab.
  // Logos and details are incorrect"). It used to draw a coloured letter disc per side -- so every pool read
  // "$" + "L" or similar -- name the pair in API order, and tag every row "XRP Ledger" + "N% fee". Now: the
  // LUMOS mark and the paired token's real thumbnail, "LUMOS / X", the incentive pill only where there is one,
  // and TVL / 24h in dollars once the XRP price is in -- the same row Stellar's phone list shows.
  function poolItem(p, usd) {
    var a = el('a', 'pool-item');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);
    a.setAttribute('data-chain', 'xrpl');
    a.setAttribute('data-lxbuilt', '1');
    var other = (p.a1 && p.a1.i === ISS && p.a1.c === CUR) ? p.a2 : p.a1;

    var icons = el('div', 'pair-icons');
    icons.setAttribute('data-paired', '1');
    function disc(cls, src) {
      var d = el('div', cls);
      try { d.setAttribute('data-logoed', '1'); } catch (e) {}
      d.style.cssText = 'border-color:var(--surface);background:transparent;overflow:hidden';
      var im = document.createElement('img');
      im.alt = '';
      im.src = src;
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
      d.appendChild(im);
      return d;
    }
    icons.appendChild(disc('a', '/assets/favicon.png'));
    icons.appendChild(disc('b', sideThumb(other)));
    a.appendChild(icons);

    var info = el('div', 'info');
    info.appendChild(el('div', 'pair-name', 'LUMOS / ' + poolName(other)));
    var inc = incentOf(p);
    if (inc) {
      var meta = el('div', 'meta-row');
      var ip = el('span', 'incent-pill ' + inc[1], inc[0]);
      try { ip.setAttribute('data-logoed', '1'); } catch (e) {}
      meta.appendChild(ip);
      info.appendChild(meta);
    }
    var stats = el('div', 'stats-row');
    function st(label, v) {
      var d = document.createElement('div');
      d.appendChild(el('span', 'label', label));
      d.appendChild(el('span', 'v', v));
      return d;
    }
    stats.appendChild(st('TVL', usd ? usdAbbr((+p.liq || 0) * usd) : amount(p.liq) + ' XRP'));
    stats.appendChild(st('24H', usd ? usdAbbr((+p.vol || 0) * usd) : amount(p.vol) + ' XRP'));
    info.appendChild(stats);
    a.appendChild(info);

    var act = el('div', 'right-actions');
    act.appendChild(el('span', 'trade-btn', 'View pool'));
    a.appendChild(act);
    return a;
  }

  function poolName(x) {
    if (!x) return '?';
    if (x.c === 'XRP' || x.code === 'XRP') return 'XRP';
    var c = x.n || x.name || x.code || x.c || '';
    try { if (/^[0-9A-F]{40}$/i.test(c)) c = window.lxx.decodeCurrency(c).display; } catch (e) {}
    return c || '?';
  }

  function hueOf(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  // STELLAR'S "ALL LUMOS POOLS" (RAZA 2026-09-15: "LUMOS token page, in pools tab, its not the same as on Stellar"): the
  // design's own row — LUMOS mark and the paired token's, "LUMOS / X", TVL, 24h volume, an Incentives pill and "View pool" —
  // one per pool by TVL, with the Network column removed as lumoscore.com removes it, inside the page's scroll box.
  // INCENTIVE TAGS FOLLOW THE CURRENT CYCLE, BY PAIR (RAZA 2026-11-18: "you still havent updated the Incentives
  // tag"). This used to be ten hardcoded AMM accounts from the PREVIOUS cycle (666, XDawgs, MXI, BXE, REAL, RLUSD,
  // ARMY, FUZZY, BEAR, SOLO). The live programme is X_ECO in the Stellar repo's _adminrewards.js, named by
  // counter-asset rather than by AMM account -- the same list pools.js's Rewarded tab reads -- so a pool is
  // tagged by what it pairs LUMOS with, and a pool created later is tagged without a code change.
  var RW_ECO = [
    ['524C555344000000000000000000000000000000', 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'],   // RLUSD
    ['5553444300000000000000000000000000000000', 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'],   // USDC
    ['SHX', 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw'],
    ['XPM', 'rXPMxBeefHGxx2K7g5qmmWq3gFsgawkoa'],
    ['XLM', 'rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y'],
    ['5553445400000000000000000000000000000000', 'rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq'],   // USDT (GateHub)
    ['5844617767730000000000000000000000000000', 'raKhUVtNw6B892bKtATUT3frX35oawfsey'],   // XDawgs
    ['666', 'rhvf9fe6PP3GC8Bku2Ug7iQPjPDxYZfrxN'],
    ['FLR', 'rcxJwVnftZzXqyH9YheB8TgeiZUhNo1Eu'],
    ['XAH', 'rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv']
  ];
  function rwCur(c) {          // 'SHX' and its padded hex are the same currency
    c = String(c || '');
    if (!/^[0-9A-Fa-f]{40}$/.test(c)) return c;
    var s = '';
    for (var i = 0; i < 40; i += 2) { var b = parseInt(c.substr(i, 2), 16); if (b) s += String.fromCharCode(b); }
    return s;
  }
  function incentOf(p) {
    var other = (p.a1 && p.a1.i === ISS && p.a1.c === CUR) ? p.a2 : p.a1;
    if (!other) return null;
    if (other.c === 'XRP' && !other.i) return ['Native LP', 'native'];
    for (var k = 0; k < RW_ECO.length; k++) {
      if (rwCur(other.c) === rwCur(RW_ECO[k][0]) && (other.i || '') === RW_ECO[k][1]) return ['Ecosystem', 'eco'];
    }
    return null;
  }
  var POOL_TPL = null;
  function usdAbbr(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }
  function sideThumb(s) {
    if (!s || s.c === 'XRP' || !s.i) return '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    if (s.m) return '/lxapi/xrplthumb?id=' + encodeURIComponent(s.m) + '&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(s.i) + '&cur=' + encodeURIComponent(s.c) + '&w=48';
  }
  function buildPoolsTable(rows, usd) {
    var pb = $('#poolsBody');
    if (!pb || !rows.length) return;
    if (!POOL_TPL) {
      var t0 = pb.querySelector('tr:not([data-lxbuilt])') || pb.querySelector('tr');
      if (!t0) return;
      POOL_TPL = t0.cloneNode(true);
    }
    var tbl = pb.closest('table');
    if (tbl) {
      $$('thead th', tbl).forEach(function (th) {
        if (/^Network$/i.test((th.textContent || '').trim()) && th.parentNode) th.parentNode.removeChild(th);
      });
    }
    var arr = rows.slice().sort(function (a, b) { return (+b.liq || 0) - (+a.liq || 0); });
    pb.innerHTML = '';
    arr.forEach(function (p) {
      var other = (p.a1 && p.a1.i === ISS && p.a1.c === CUR) ? p.a2 : p.a1;
      var row = POOL_TPL.cloneNode(true);
      row.setAttribute('data-lxbuilt', '1');
      row.setAttribute('data-acct', p.acct);
      row.removeAttribute('data-chain');
      var nm = row.querySelector('.pair-name');
      if (nm) { nm.textContent = 'LUMOS / ' + poolName(other); nm.setAttribute('data-logoed', '1'); }
      [[row.querySelector('.pair-icons .a'), '/assets/favicon.png'], [row.querySelector('.pair-icons .b'), sideThumb(other)]].forEach(function (x) {
        var n = x[0];
        if (!n) return;
        n.removeAttribute('data-logo');
        n.setAttribute('data-logoed', '1');
        n.textContent = '';
        n.style.background = 'transparent';
        var im = document.createElement('img');
        im.alt = '';
        im.src = x[1];
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
        n.appendChild(im);
      });
      var chain = row.querySelector('.chain-pill');
      if (chain) { var ctd = chain.closest('td'); if (ctd && ctd.parentNode) ctd.parentNode.removeChild(ctd); }
      var nums = row.querySelectorAll('.num');
      if (nums[0]) nums[0].textContent = usd ? usdAbbr((+p.liq || 0) * usd) : (amount(p.liq) + ' XRP');
      if (nums[1]) nums[1].textContent = usd ? usdAbbr((+p.vol || 0) * usd) : (amount(p.vol) + ' XRP');
      var inc = row.querySelector('.incent-pill');
      if (inc) {
        inc.setAttribute('data-logoed', '1');
        var tg = incentOf(p);
        if (tg) { inc.textContent = tg[0]; inc.className = 'incent-pill ' + tg[1]; }
        else inc.style.display = 'none';
      }
      var link = row.querySelector('a');
      if (link) link.setAttribute('href', '/pools/xrpl/id/' + encodeURIComponent(p.acct));
      pb.appendChild(row);
    });
    pb.classList.add('lxlt');
    if (tbl && tbl.parentNode && !tbl.parentNode.classList.contains('lx-poolscroll')) {
      var wrap = document.createElement('div');
      wrap.className = 'lx-poolscroll';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }
    if (!window.__lxxLtPoolNav) {
      window.__lxxLtPoolNav = 1;
      window.addEventListener('click', function (e) {
        var tr = e.target && e.target.closest && e.target.closest('#poolsBody tr[data-acct]');
        if (!tr) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-acct'));
      }, true);
    }
  }

  function paintPoolList(rows, usd) {
    var host = $('#poolList');
    if (!host) return;                                  // desktop renders a table instead
    rows = rows.slice().sort(function (a, b) { return (+b.liq || 0) - (+a.liq || 0); });
    host.innerHTML = '';
    if (!rows.length) {
      var d = el('div', null, 'No LUMOS pools found on the XRP Ledger.');
      d.style.cssText = 'padding:20px 6px;text-align:center;opacity:.7';
      host.appendChild(d);
      return;
    }
    for (var i = 0; i < Math.min(rows.length, 10); i++) host.appendChild(poolItem(rows[i], usd));
  }

  // RETURNS ITS PROMISE so load() can wait for it. Without that the pool count and the token payload
  // were two races with one finish line: whichever settled last owned the final paint, and the
  // Pools stat card and the "View all N pools" link were left on the design's mock. Measured on the
  // live page: card "—", link "View all 14 pools", with the endpoint answering total 22 the whole
  // time -- and __lxxLTokenReload() fixing both, which is what named it as ordering rather than data.
  function loadPools() {
    return fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(ISS))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || d.total == null) return;
        state.pools = d.total;
        paint(window.__lxxLumos || null);         // repaint the two places the count appears
        paintPoolList(d.rows || []);
        fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
          .then(function (t) { return (t && t.ok && +t.usd > 0) ? +t.usd : null; }, function () { return null; })
          .then(function (usd) { if (usd) paintPoolList(d.rows || [], usd); buildPoolsTable(d.rows || [], usd); });
      })
      .catch(function () { /* the card stays dashed, which is the honest default */ });
  }

  // ---- the issuer address, and who holds the token ------------------------------------------------
  //
  // Three separate pieces of this page were still the design's mock, and one of them was visible
  // without opening anything:
  //
  //   * the address row read "XRP Ledger  0x0e5e…32bc" — an EVM-shaped address under an XRP Ledger
  //     label, with a full 66-character 0x value behind it;
  //   * "Holders breakdown — 3,208 total" with an invented distribution, on a page whose own stat
  //     card two panels up says 1,200;
  //   * five top holders, each an 0x address tagged "Aptos · 1.48% of supply".
  //
  // ALL OF IT IS COMPUTABLE, exactly, from one place: the issuer's own trust lines. A trust line to
  // the issuer IS a holding, so account_lines on ISS enumerates every holder with their balance —
  // seen from the issuer, which owes them, so the balances come back negative. Paged, because there
  // are more than one page of them.
  var RPC = 'https://xrplcluster.com/';
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
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    });
  }

  function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // Token quantities, in the compact form the design uses beside each holder ("29.6M").
  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function paintIssuer() {
    $$('.addr-value').forEach(function (e) {
      e.textContent = shortAddr(ISS);
      e.setAttribute('data-full', ISS);
      e.setAttribute('title', ISS);
    });
    // The copy control beside it carried the mock value too, so it copied an address for another
    // chain to the clipboard.
    $$('.addr-row [data-copy]').forEach(function (b) { b.setAttribute('data-copy', ISS); });
  }

  // "1M+ LUMOS", "1M – 5M", "250K – 1M", "Under 250K" -> the range each row counts.
  //
  // The first two OVERLAP as the design ships them, so every holder over 5M would be counted twice
  // and the four rows would not sum to the total. Relabelled to "5M+ LUMOS", which is the only
  // reading that makes the set disjoint and matches the descending order of the rest.
  function bucketRange(label) {
    var s = String(label || '').replace(/\s+/g, ' ').trim();
    function num(t) {
      var m = /([\d.]+)\s*([KM])?/i.exec(t); if (!m) return null;
      var v = parseFloat(m[1]);
      if (/k/i.test(m[2] || '')) v *= 1e3;
      if (/m/i.test(m[2] || '')) v *= 1e6;
      return v;
    }
    if (/^under/i.test(s)) return { lo: 0, hi: num(s) };
    var parts = s.split(/[–-]/);
    if (parts.length === 2) return { lo: num(parts[0]), hi: num(parts[1]) };
    return { lo: num(s), hi: Infinity };
  }

  function paintHolders(list) {
    if (!list) return;
    var total = list.length;

    // "N total" belongs to the BREAKDOWN card only. Written to every .h-head it also replaced the top-holders
    // subtitle ("both chains") with the holder count; that one now reads "Ranked by balance", as on Stellar.
    $$('.h-head').forEach(function (hd) {
      var m = hd.querySelector('.meta'), h3 = hd.querySelector('h3');
      if (!m) return;
      if (/breakdown/i.test((h3 && h3.textContent) || '')) m.textContent = total.toLocaleString('en-US') + ' total';
      else if (/both chains/i.test(m.textContent || '')) m.textContent = 'Ranked by balance';
    });

    var rows = $$('.wsize-row');
    // Disjoint tiers, top row first — see bucketRange.
    if (rows[0]) {
      var l0 = rows[0].querySelector('.wsize-label');
      if (l0 && /^1M\+/i.test((l0.textContent || '').trim())) l0.textContent = '5M+ LUMOS';
    }
    rows.forEach(function (row) {
      var lab = row.querySelector('.wsize-label');
      var cnt = row.querySelector('.wsize-count');
      var fill = row.querySelector('.wsize-bar .fill');
      if (!lab || !cnt) return;
      var r = bucketRange(lab.textContent);
      if (!r || r.lo == null) { cnt.textContent = '—'; return; }
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var b = list[i].bal;
        if (b >= r.lo && (r.hi == null || b < r.hi)) n++;
      }
      cnt.textContent = n.toLocaleString('en-US');
      if (fill) fill.style.width = Math.max(1, Math.round(n / Math.max(1, total) * 100)) + '%';
    });

    // The top holders. Percentages are of the ISSUED supply — the sum of what every holder holds —
    // which is what "% of supply" means for a token whose issuer is blackholed and can mint no more.
    var issued = 0;
    for (var k = 0; k < list.length; k++) issued += list[k].bal;
    var top = list.slice().sort(function (a, b) { return b.bal - a.bal; });
    // The PHONE's holder rows sit in a plain .h-card -- no .top-holders wrapper -- so asking for
    // '.top-holders .holder-row' found nothing there and every row stayed a skeleton over the mock's dollars.
    $$('.holder-row').forEach(function (row, i) {
      var h = top[i];
      var info = row.querySelector('.info');
      var chain = row.querySelector('.chain');
      if (!h) { row.style.display = 'none'; return; }
      row.style.display = '';
      // The address sits in .info as its own text/element; the first non-.chain child holds it.
      var addrEl = info && [].slice.call(info.children).filter(function (c) {
        return !c.classList || !c.classList.contains('chain');
      })[0];
      if (addrEl) { addrEl.textContent = shortAddr(h.addr); addrEl.setAttribute('title', h.addr); }
      if (chain) {
        var pct = issued > 0 ? (h.bal / issued * 100) : 0;
        // Stellar's line: the share alone — the page is already about one network.
        chain.textContent = (pct >= 0.01 ? pct.toFixed(2) : '<0.01') + '% of supply';
      }
      // THE ROWS STAYED SKELETONS (RAZA 2026-09-15: "Pools and holders tabs are not loading"). The inherited sheet
      // animates .holder-row:not([data-lxbuilt]) as a loading shimmer and hides its rank; Stellar marks a row built once
      // it holds a real holder. Ranks get Stellar's medals, the avatar an identicon, and the row opens the account.
      row.setAttribute('data-lxbuilt', '1');
      row.classList.add('lxlt');
      var rk = row.querySelector('.rk');
      if (rk) {
        if (i < 3) { rk.className = 'rk medal'; rk.innerHTML = medalSVG(i); }
        else { rk.className = 'rk'; rk.textContent = String(i + 1); }
      }
      var av = row.querySelector('.av');
      if (av) {
        av.removeAttribute('data-logo');
        av.setAttribute('data-logoed', '1');
        av.style.cssText = 'background:url("' + identUri(h.addr) + '") center center / cover no-repeat;box-shadow:none';
      }
      row.style.cursor = 'pointer';
      row.onclick = (function (ad) { return function () { window.location.href = '/account/xrpl/' + encodeURIComponent(ad); }; })(h.addr);

      // AND THE BALANCE BESIDE IT. Filling the percentage alone left "32.08% of supply" against the
      // mock's "29.6M LUMOS" — two numbers about the same holder that cannot both be true, which is
      // a worse read than either mock alone. The USD figure uses the same price the hero shows, so
      // the page cannot value the same token two ways.
      var hold = row.querySelector('.holdings');
      var vEl = hold && hold.querySelector('.v');
      var pEl = hold && hold.querySelector('.pct');
      if (vEl) vEl.textContent = amount(h.bal) + ' LUMOS';
      if (pEl) {
        var px = window.__lxxLumos && window.__lxxLumos.usd;
        pEl.textContent = (px != null && isFinite(px)) ? usd(h.bal * px) : '—';
      }
    });
  }

  // Paged, with a hard stop: a marker loop that never terminates would hammer the node.
  function loadHolders() {
    if (!$('.h-card') && !$('.top-holders')) return;             // not a page with these
    var acc = [], marker = null, pages = 0;
    function page() {
      var p = { account: ISS, limit: 400, ledger_index: 'validated' };
      if (marker) p.marker = marker;
      rpc('account_lines', p).then(function (r) {
        var res = r && r.result;
        var lines = (res && res.lines) || [];
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (l.currency !== CUR) continue;
          var v = Math.abs(Number(l.balance));
          if (v > 0) acc.push({ addr: l.account, bal: v });
        }
        marker = res && res.marker;
        if (marker && ++pages < 15) return page();
        paintHolders(acc);
        state.holders = acc.length;
        paintTabsAndLinks(window.__lxxLumos || null);
      }).catch(function () { /* leave the card as it is rather than half-write it */ });
    }
    page();
  }

  function load() {
    if (!$('.hero-price-block') && !$('.lh-stats')) return;      // not this page
    paintIssuer();
    loadHolders();
    // BOTH, THEN ONE FINAL PAINT. Each still paints as soon as it lands, so nothing waits on the
    // slower of the two to show something -- but the last word belongs to a paint that has seen both,
    // which is the only way the count and the price cannot overwrite each other.
    var pools = loadPools();
    var token = fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(ISS + '-' + CUR))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ok = d && d.ok ? d : null;
        window.__lxxLumos = ok;
        paint(ok);
      })
      .catch(function () { paint(null); });
    Promise.all([
      pools && pools.catch ? pools.catch(function () { return null; }) : null,
      token.catch(function () { return null; }),
    ]).then(function () { paint(window.__lxxLumos || null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxLTokenReload = load;
})();
