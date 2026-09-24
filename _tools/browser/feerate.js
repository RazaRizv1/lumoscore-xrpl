// Fee tier: 0.2% per trade, 0.1% for holders of 250,000+ LUMOS.
//
// THE INHERITED VERSION COULD NEVER GRANT THE DISCOUNT. It looked up the connected address at
// https://horizon.stellar.org/accounts/<addr> with the STELLAR LUMOS issuer (GB5T2EQC…). On this
// site `lumos.address` is an r-address, so Horizon answered 404, the layer swallowed it, and the
// rate stayed at 0.2% for everyone -- forever, silently, with no error anywhere. A holder with a
// million LUMOS would simply have been charged double.
//
// The numbers are unchanged and deliberately so: 0.2% / 0.1% at 250,000 LUMOS, and LUMOS sitting
// inside a pool still counts toward the threshold. Only the ledger changed.
//
// The public surface is kept byte-for-byte compatible with the Stellar layer -- __lxFeeRate,
// __lxLumosBal, __lxLumosThresh, __lxLumosIssuer, __lxFeeTier(), __lxFeeTierSet, __lxFeeTierRefresh
// and the 'lx:feetier' event -- because other code on these pages reads all of them.
(function () {
  if (window.__lxFrBooted) return;
  window.__lxFrBooted = 1;

  // Verified on mainnet: this issuer is blackholed (DisableMaster + RegularKey = ACCOUNT_ZERO),
  // so the supply is fixed and no further LUMOS can ever be issued.
  var ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CUR = '4C554D4F53000000000000000000000000000000';       // 'LUMOS' as a 40-char hex currency
  var THRESH = 250000;
  var RPC = 'https://xrplcluster.com/';

  if (typeof window.__lxFeeRate !== 'number') window.__lxFeeRate = 0.002;
  if (!('__lxLumosBal' in window)) window.__lxLumosBal = null;
  window.__lxLumosThresh = THRESH;
  window.__lxLumosIssuer = ISS;

  function pub(bal) {
    window.__lxLumosBal = bal;
    window.__lxFeeRate = (bal >= THRESH) ? 0.001 : 0.002;
    try {
      window.dispatchEvent(new CustomEvent('lx:feetier',
        { detail: { bal: bal, rate: window.__lxFeeRate, thresh: THRESH } }));
    } catch (e) {}
  }

  window.__lxFeeTier = function () {
    return { bal: window.__lxLumosBal, rate: window.__lxFeeRate, thresh: THRESH };
  };
  window.__lxFeeTierSet = pub;

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) return null;
      return res;
    }).catch(function () { return null; });
  }

  var linesP = {};
  function lines(addr) {
    if (!linesP[addr]) {
      linesP[addr] = window.lxx.allLines(rpc, addr);
    }
    return linesP[addr];
  }

  var ammP = {};
  function amm(account) {
    if (!ammP[account]) ammP[account] = rpc('amm_info', { amm_account: account });
    return ammP[account];
  }

  function amountOf(side) {
    // amm_info returns a string of drops for XRP, or {currency, issuer, value} for a token.
    if (!side || typeof side === 'string') return null;
    if (side.currency !== CUR || side.issuer !== ISS) return null;
    var v = Number(side.value);
    return isFinite(v) ? v : null;
  }

  // LUMOS held INSIDE pools counts toward the threshold, same rule as the Stellar build. On the XRP
  // Ledger a pool position is an LP token -- a trust line whose 40-char currency starts with 03 --
  // so the account's share of the pool's LUMOS is (my LP balance / total LP supply) * pool LUMOS.
  function poolLumos(rows, cb) {
    var lps = [];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].currency;
      var bal = Number(rows[i].balance);
      if (typeof c === 'string' && c.length === 40 && /^03/i.test(c) && bal > 0) lps.push(rows[i]);
    }
    lps = lps.slice(0, 25);                       // same cap the Stellar layer used
    if (!lps.length) { cb(0); return; }

    var left = lps.length, total = 0;
    lps.forEach(function (lp) {
      // The LP token's ISSUER is the AMM account itself, which is what amm_info is keyed on.
      amm(lp.account).then(function (info) {
        try {
          var a = info && info.amm;
          if (a) {
            var lum = amountOf(a.amount);
            if (lum == null) lum = amountOf(a.amount2);
            var supply = a.lp_token ? Number(a.lp_token.value) : 0;
            var mine = Number(lp.balance);
            if (lum != null && supply > 0 && isFinite(mine)) total += lum * (mine / supply);
          }
        } catch (e) {}
        if (--left === 0) cb(total);
      });
    });
  }

  function resolve(force) {
    var me = '';
    try { me = localStorage.getItem('lumos.address') || ''; } catch (e) {}

    if (!me) {
      if (window.__lxLumosBal !== null) pub(null);
      else { window.__lxLumosBal = null; window.__lxFeeRate = 0.002; }
      return;
    }
    if (!force && window.__lxFrFor === me) return;
    window.__lxFrFor = me;
    if (force) { try { delete linesP[me]; } catch (e) {} }

    lines(me).then(function (res) {
      if (!res || !res.lines) { window.__lxFrFor = ''; return; }
      var rows = res.lines;

      var held = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].currency === CUR && rows[i].account === ISS) {
          var v = Number(rows[i].balance);
          // A NEGATIVE balance means this account ISSUES LUMOS; it is an obligation, not a holding.
          if (isFinite(v) && v > 0) held += v;
        }
      }
      pub(held);
      if (held >= THRESH) return;                 // already qualified; no need to price the pools

      poolLumos(rows, function (extra) {
        if (extra > 0 && window.__lxFrFor === me) pub(held + extra);
      });
    });
  }

  window.__lxFeeTierRefresh = function () {
    var me = '';
    try { me = localStorage.getItem('lumos.address') || ''; } catch (e) {}
    if (me) { try { delete linesP[me]; } catch (e) {} }
    window.__lxFrFor = '';
    resolve(true);
  };

  resolve();
  window.addEventListener('storage', function (e) {
    if (e && e.key === 'lumos.address') { window.__lxFrFor = ''; resolve(); }
  });
  // The address can be written after this runs (connect finishes late, or a redirect returns).
  setTimeout(resolve, 1200);
  setTimeout(resolve, 4000);
})();
