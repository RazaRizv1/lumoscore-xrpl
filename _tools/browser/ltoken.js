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
    // Its rows were quoting a "LUMOS/XLM mark". There is no XLM here; rows that cannot be sourced
    // are dashed rather than left saying something about another chain.
    $$('.lt-cmp-row').forEach(function (row) {
      var v = row.querySelector('.lt-cmp-v');
      if (!v) return;
      var label = (row.textContent || '').toLowerCase();
      if (/xlm|stellar/.test(v.textContent.toLowerCase())) v.textContent = '—';
      if (/holder/.test(label) && d && d.holders != null) {
        v.textContent = Math.round(d.holders).toLocaleString('en-US')
          + (d.trustlines != null ? ('  ·  ' + Math.round(d.trustlines).toLocaleString('en-US')) : '');
      }
    });
  }

  function load() {
    if (!$('.hero-price-block') && !$('.lh-stats')) return;      // not this page
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
