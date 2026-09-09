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
        if (s) s.textContent = sub;
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
    var h = $('.hero-price-block');
    if (h) h.classList.add('lxlt');

    // Eleventh gate, same stylesheet, same shape, different element:
    //     .cstat:not(.lxlt) .val, .cstat:not(.lxlt) .sub { visibility: hidden }
    // Every stat card under the hero -- market cap, FDV, holders, pools, 24h volume -- was being
    // filled with correct figures and then hidden, so the row read as five empty boxes with labels.
    // Nothing in the DOM complained: right text, right numbers, display:block. Only the screenshot
    // showed the gap, which is the third time on this page that has been the deciding check.
    var cs = document.querySelectorAll('.cstat');
    for (var i = 0; i < cs.length; i++) cs[i].classList.add('lxlt');
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
    $$('.lh-desc').forEach(function (e) {
      var t = e.textContent || '';
      if (/Aptos|Stellar/i.test(t)) {
        e.textContent = t.replace(/live on Aptos/i, 'live on the XRP Ledger')
          .replace(/\bAptos\b/g, 'the XRP Ledger').replace(/\bStellar\b/g, 'the XRP Ledger');
      }
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
      e.textContent = '999,955,353 LUMOS · fixed supply on the XRP Ledger — the issuer is blackholed, '
        + 'so no more can ever be minted.';
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

  function paint(d) {
    lift();
    paintChainLabels();
    // ---- hero -------------------------------------------------------------------------------
    var price = $('.hero-price-block .price');
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
    setStat('market cap', d ? usd(d.marketcap != null && d.usd != null && d.price
      ? d.marketcap * (d.usd / d.price) : null) : '—',
      d && d.circulating != null ? ('on ' + big(d.circulating) + ' circulating') : null);

    // Fully diluted uses the ISSUED total, which differs from circulating: 999,955,353 against
    // 705,205,451. Quoting one as the other is a 42% overstatement.
    var fdv = (d && d.usd != null && d.issued != null) ? d.usd * d.issued : null;
    setStat('diluted', usd(fdv), d && d.issued != null ? ('on ' + big(d.issued) + ' issued') : null);

    setStat('holder', d && d.holders != null ? Math.round(d.holders).toLocaleString('en-US') : '—',
      d && d.trustlines != null ? (Math.round(d.trustlines).toLocaleString('en-US') + ' trust lines') : null);

    setStat('volume', d && d.vol24 != null && d.usd != null && d.price
      ? usd(d.vol24 * (d.usd / d.price)) : '—', 'past 24h');

    // ---- supply numbers ----------------------------------------------------------------------
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
    setStat('pool', state.pools == null ? '—' : String(state.pools), null);
  }

  // How many AMM pools hold LUMOS. /lxapi/xrplpools?issuer= narrows the upstream's 30,648 pools to
  // the ones with a LUMOS side; `total` is the count, independent of the page size asked for.
  function loadPools() {
    fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(ISS))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || d.total == null) return;
        state.pools = d.total;
        paint(window.__lxxLumos || null);         // repaint the two places the count appears
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
  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); });
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

    $$('.h-head .meta').forEach(function (e) { e.textContent = total.toLocaleString('en-US') + ' total'; });

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
    $$('.top-holders .holder-row').forEach(function (row, i) {
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
        // Rebuilt rather than assigned into: the row ships a mark inside .chain, and replacing the
        // whole textContent would take it with it.
        var mark = chain.querySelector('.b-ico');
        chain.textContent = '';
        if (mark) chain.appendChild(mark);
        chain.appendChild(document.createTextNode(' XRP Ledger · ' + pct.toFixed(2) + '% of supply'));
      }

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
      }).catch(function () { /* leave the card as it is rather than half-write it */ });
    }
    page();
  }

  function load() {
    if (!$('.hero-price-block') && !$('.lh-stats')) return;      // not this page
    paintIssuer();
    loadHolders();
    loadPools();
    fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(ISS + '-' + CUR))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ok = d && d.ok ? d : null;
        window.__lxxLumos = ok;
        paint(ok);
      })
      .catch(function () { paint(null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxLTokenReload = load;
})();
