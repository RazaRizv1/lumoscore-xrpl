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

  function paint(d) {
    lift();
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

  function load() {
    if (!$('.hero-price-block') && !$('.lh-stats')) return;      // not this page
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
