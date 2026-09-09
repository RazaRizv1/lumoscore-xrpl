// Rewards page: what the connected wallet is actually eligible for.
//
// The inherited `lx-rewardsdata` asked people to "Connect your Stellar wallet" and listed recipients
// as Stellar G-addresses. It did at least label its table "Illustrative preview — sample data", so
// it was not claiming those payouts happened; it was just the wrong ledger's fiction.
//
// WHAT THIS DOES AND DOES NOT DO. The eligibility box is real: it reads the connected account off
// the XRP Ledger and reports the LUMOS it holds, its position in the LUMOS/XRP native pool, and its
// positions across the ten Ecosystem pools. The distribution REPORT is not real and is not faked --
// there is no source for past XRPL payouts, so it says so instead of showing invented recipients.
// A page about who got paid is the last place to put plausible-looking numbers.
//
// Two kinds of account are excluded from the participant view, for different reasons:
//   TEAM WALLETS  treasury allocations, 850M LUMOS between them (86.9% of the top 50). RAZA's list,
//                 resolved and verified on-ledger -- see xrpl-core TEAM_WALLETS.
//   AMM ACCOUNTS  a pool is not a holder. The LUMOS/XRP AMM sits near the top of the holder list
//                 with 17.09M LUMOS, which is just its own reserve.
(function () {
  if (window.__lxxRewards) return;
  window.__lxxRewards = 1;

  var RPC = 'https://xrplcluster.com/';
  var ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CUR = '4C554D4F53000000000000000000000000000000';

  // Verified on mainnet: 412.5 XRP / 17,075,469 LUMOS, fee 0.625%.
  var NATIVE_POOL = 'rnPQqk3cfHyqSyvAGh3AfMtWiszK8zaF4U';

  // The ten Ecosystem pools RAZA supplied, each confirmed by amm_info to be a real AMM with LUMOS
  // on one side. Pair names are what the LEDGER reported, not what was typed.
  var ECO = {
    'r27TeM8xMebVAMHt4aB3BMYw5MB5fULht': '666',
    'rM6HW3s4WUGuLYwKwRvZx2aai5wk5PR5fz': 'XDawgs',
    'rhhBo4BXkrhvr17rLdtdwxMjEk1NnTvqUC': 'MXI',
    'rJZftp95akgYuXXtb2yp23F1cGuHu34pMA': 'BXE',
    'rEmgwNPCbq6ogmLKThxgee35uCSqfhB83M': 'REAL',
    'rJnv9wSoSECHzWsNXR7E74hi8mbKX9ZnDM': 'RLUSD',
    'rsKJxAyfL2AGdTMqz5ZMhBSyiSxqz97g3z': 'ARMY',
    'rKsz9Dft5yYtbLS1SSG9L6u3LyhgwuWhew': 'FUZZY',
    'rUHWxx4kodHx3P8WxtkdcjhwDXnr5p9txo': 'BEAR',
    'rJfj7MXMt1VfBFF8mBta1CesMSzXYZELyZ': 'SOLO'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return Math.round(v).toLocaleString('en-US');
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

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

  // ---- eligibility --------------------------------------------------------------------------------
  function box(title, sub, rows) {
    var b = $('#eligBox');
    if (!b) return;
    // Seventh gate of this shape: #eligBox:not(.lxrw) { visibility: hidden }. The class is NOT in
    // the base markup -- the old script added it once it had data, and its stylesheet outlived it.
    // Without this the box fills correctly and stays invisible, which is exactly how it looked.
    b.classList.add('lxrw');
    b.innerHTML = '';
    var wrap = el('div', 'lxrw-empty');
    wrap.appendChild(el('div', 't', title));
    if (sub) wrap.appendChild(el('div', 's', sub));
    b.appendChild(wrap);
    if (rows && rows.length) {
      var list = el('div');
      list.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:6px';
      for (var i = 0; i < rows.length; i++) {
        var r = el('div');
        r.style.cssText = 'display:flex;justify-content:space-between;gap:14px;font-size:13.5px';
        r.appendChild(el('span', null, rows[i][0]));
        var v = el('span', 'mono', rows[i][1]);
        v.style.cssText = 'font-weight:700';
        r.appendChild(v);
        list.appendChild(r);
      }
      b.appendChild(list);
    }
  }

  function eligibility() {
    var me = addr();
    if (!me) {
      box('Connect your XRP Ledger wallet',
        'See your live LUMOS balance and pool positions, and what you would earn this round.');
      return;
    }

    box('Reading the XRP Ledger…', 'Checking your LUMOS balance and pool positions.');

    rpc('account_lines', { account: me, limit: 400, ledger_index: 'validated' }).then(function (res) {
      if (!res || !res.lines) {
        box('Could not read that account',
          'The XRP Ledger did not return balances for ' + me.slice(0, 8) + '… — it may not be activated yet.');
        return;
      }
      var lines = res.lines;

      var lumos = 0;
      var nativeLp = 0;
      var ecoHits = [];

      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var bal = Number(l.balance);
        if (!isFinite(bal) || bal <= 0) continue;             // negatives are obligations, not holdings

        if (l.currency === CUR && l.account === ISS) { lumos += bal; continue; }

        // An LP token is issued BY the AMM account, so l.account identifies the pool directly.
        if (typeof l.currency === 'string' && l.currency.length === 40 && /^03/i.test(l.currency)) {
          if (l.account === NATIVE_POOL) nativeLp += bal;
          else if (ECO[l.account]) ecoHits.push({ name: ECO[l.account], lp: bal });
        }
      }

      var rows = [];
      rows.push(['LUMOS held', amount(lumos) + ' LUMOS']);
      rows.push(['LUMOS/XRP pool (Native LP)', nativeLp > 0 ? amount(nativeLp) + ' LP' : 'no position']);
      rows.push(['Ecosystem pools', ecoHits.length
        ? (ecoHits.length + ' of 10 — ' + ecoHits.map(function (e) { return e.name; }).join(', '))
        : 'no position']);

      var isTeam = false;
      try { isTeam = window.lxx.isTeamWallet(me); } catch (e) {}

      if (isTeam) {
        // Say it plainly rather than showing a total this account will never receive.
        box('This is a team wallet',
          'Team and treasury wallets are excluded from reward distributions, so this account earns '
          + 'nothing regardless of its balance.', rows);
        return;
      }

      var any = lumos > 0 || nativeLp > 0 || ecoHits.length > 0;
      box(any ? 'You are eligible' : 'Nothing eligible yet',
        any
          ? 'Rewards are paid per round from the treasury. Amounts are set when a round closes.'
          : 'Hold LUMOS, or add liquidity to the LUMOS/XRP pool or an Ecosystem pool, to take part.',
        rows);
    });
  }

  // ---- distribution report ------------------------------------------------------------------------
  // There is no source for past XRPL payouts, so this says so. The inherited version filled the same
  // table with invented Stellar recipients under an "illustrative" label; on a page about who got
  // paid, an empty state is the only honest option.
  function report() {
    var rows = $('#repRows');
    if (!rows) return;
    rows.innerHTML = '';
    var r = el('div', 'rr');
    r.style.cssText = 'justify-content:center;opacity:.7;padding:22px 8px;text-align:center';
    r.textContent = 'No distribution has run on the XRP Ledger yet. Recipients will be listed here once one has.';
    rows.appendChild(r);

    var c = $('#repCount');
    if (c) c.textContent = '0';
    var t = $('#repTitle');
    if (t) t.textContent = 'No rounds yet';
    var s = $('#repSub');
    if (s) s.textContent = 'This table lists real recipients once a distribution has run.';
    var p = $('#psum');
    if (p) p.textContent = 'Ten Ecosystem pools · LUMOS/XRP native pool · holder rewards';
  }

  // The page's prose still described the wrong chain throughout: "Based on your connected Aptos
  // wallet", "hold LUMOS on Aptos or provide liquidity ... on Aptos — to earn a share every round",
  // a pool named "LUMOS/APT", and a network selector whose only button said "Aptos".
  //
  // The figures beside all of that were already correct XRP Ledger ones, which is what makes this
  // kind of leftover worth chasing: a reader reconciles the words with the numbers, and the words
  // are the part that tells them which chain they need to be on to qualify.
  //
  // Rewritten by TEXT NODE, so any markup the design wrapped mid-sentence survives untouched.
  function paintChainCopy() {
    var sel = '.elig-note, .pdesc, .ns, .prog-desc, .rw-note';
    [].forEach.call(document.querySelectorAll(sel), function (host) {
      if (!/Aptos|\bAPT\b|Stellar|\bXLM\b/.test(host.textContent || '')) return;
      var w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = w.nextNode())) {
        var v = n.nodeValue;
        if (!v) continue;
        n.nodeValue = v
          .replace(/LUMOS\/APT/g, 'LUMOS/XRP')
          .replace(/\bon Aptos\b/g, 'on the XRP Ledger')
          .replace(/\bAptos wallet\b/g, 'XRP Ledger wallet')
          .replace(/\bAptos\b/g, 'XRP Ledger')
          .replace(/\bon Stellar\b/g, 'on the XRP Ledger')
          .replace(/\bStellar\b/g, 'XRP Ledger')
          .replace(/\bXLM\b/g, 'XRP')
          .replace(/\bAPT\b/g, 'XRP');
      }
      // The network button is a 1-5 character target for the logo layer once it says "XRP Ledger";
      // claiming it keeps the label from being repainted away.
      if (host.classList && host.classList.contains('ns')) {
        try { host.setAttribute('data-logoed', '1'); } catch (e) {}
      }
    });
  }

  function load() {
    if (!$('#eligBox') && !$('#repRows')) return;             // not the Rewards page
    paintChainCopy();
    eligibility();
    report();
    // Connect finishes after this on a cold load, and the address can arrive from another tab.
    window.addEventListener('storage', function (e) {
      if (e && e.key === 'lumos.address') eligibility();
    });
    setTimeout(eligibility, 2500);
    // The eligibility box is rebuilt when an address arrives, and it carries the "connected … wallet"
    // sentence, so the copy pass runs again after each repaint rather than only once at load.
    setTimeout(paintChainCopy, 2600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxRewardsReload = load;
})();
