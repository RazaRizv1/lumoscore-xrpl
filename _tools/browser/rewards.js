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

  // THE CURRENT CYCLE, BY PAIR (RAZA 2026-11-18: update the Rewards pages to the current Ecosystem LP pools).
  // This was ten AMM accounts of the PREVIOUS cycle (666, XDawgs, MXI, BXE, REAL, RLUSD, ARMY, FUZZY, BEAR,
  // SOLO). The live programme is X_ECO in the Stellar repo's _adminrewards.js, named by counter-asset -- the
  // same list pools.js's Rewarded tab and ltoken.js read. A wallet's LP token is issued BY the AMM account,
  // so the check needs accounts: ecoAccounts() asks amm_info for LUMOS + each pair once, when the check runs,
  // and a pair with no pool yet simply is not in the map.
  var ECO_PAIRS = [
    ['RLUSD',  '524C555344000000000000000000000000000000', 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'],
    ['USDC',   '5553444300000000000000000000000000000000', 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'],
    ['SHX',    'SHX', 'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw'],
    ['XPM',    'XPM', 'rXPMxBeefHGxx2K7g5qmmWq3gFsgawkoa'],
    ['XLM',    'XLM', 'rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y'],
    ['USDT',   '5553445400000000000000000000000000000000', 'rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq'],
    ['XDawgs', '5844617767730000000000000000000000000000', 'raKhUVtNw6B892bKtATUT3frX35oawfsey'],
    ['666',    '666', 'rhvf9fe6PP3GC8Bku2Ug7iQPjPDxYZfrxN'],
    ['FLR',    'FLR', 'rcxJwVnftZzXqyH9YheB8TgeiZUhNo1Eu'],
    ['XAH',    'XAH', 'rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv']
  ];
  var ECO = {}, ecoReady = null;
  function ecoAccounts() {
    if (ecoReady) return ecoReady;
    ecoReady = Promise.all(ECO_PAIRS.map(function (e) {
      return rpc('amm_info', { asset: { currency: CUR, issuer: ISS }, asset2: { currency: e[1], issuer: e[2] }, ledger_index: 'validated' })
        .then(function (r) { var a = r && r.amm && r.amm.account; if (a) ECO[a] = e[0]; }, function () {});
    })).then(function () { return ECO; });
    return ecoReady;
  }

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
    }).then(function (j) {
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

  function erBox(rows) {
    var b = $('#eligBox');
    if (!b) return;
    b.classList.add('lxrw');
    b.innerHTML = '';
    rows.forEach(function (r) {
      var er = el('div', 'er' + (r[4] ? ' tot' : ''));
      var ek = el('div', 'ek');
      if (r[0]) { var dot = el('span', 'd'); dot.style.background = r[0]; ek.appendChild(dot); }
      var w = el('div');
      w.appendChild(el('div', 't', r[1]));
      if (r[2]) w.appendChild(el('div', 's', r[2]));
      ek.appendChild(w);
      er.appendChild(ek);
      er.appendChild(el('div', 'ev mono', r[3]));
      b.appendChild(er);
    });
  }

  // B09 (2026-11-21): the LP tokens team wallets hold in a pool, left out of the denominator as the admin round does.
  // The holders of an AMM's LP token are the trust lines on the AMM account in that token's currency.
  var TEAMLP = {};
  function teamLp(amm, lpcur) {
    if (TEAMLP[amm]) return TEAMLP[amm];
    var sum = 0, n = 0;
    function page(marker) {
      var q = { account: amm, ledger_index: 'validated', limit: 400 };
      if (marker) q.marker = marker;
      return rpc('account_lines', q).then(function (r) {
        if (!r || !r.lines) throw new Error('unread');
        r.lines.forEach(function (l) {
          if (lpcur && l.currency !== lpcur) return;
          var tm = false; try { tm = window.lxx.isTeamWallet(l.account); } catch (e) {}
          if (tm) sum += Math.abs(Number(l.balance)) || 0;
        });
        if (r.marker && ++n < 20) return page(r.marker);
      });
    }
    var p = page(null).then(function () { return sum; }, function () { delete TEAMLP[amm]; return 0; });
    TEAMLP[amm] = p;
    return p;
  }

  function eligibility() {
    var me = addr();
    if (!me) {
      box('Connect your XRP Ledger wallet',
        'See your live LUMOS balance and pool positions, and what you would earn this round.');
      return;
    }

    box('Reading the XRP Ledger…', 'Checking your LUMOS balance and pool positions.');

    ecoAccounts().then(function () {
      // actNotFound = a new account that genuinely holds nothing; any other failure stays a failure (incomplete).
      return window.lxx.allLines(function (m, q) {
        return lxpost(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: m, params: [q || {}] }) })
          .then(function (j) { var x = j && j.result; return x && x.error === 'actNotFound' ? { lines: [] } : x; })
          .catch(function () { return null; });
      }, me);
    }).then(function (res) {
      // A FAILED read is not "0 LUMOS, no position" (2026-11-21).
      if (res && res.incomplete) {
        box("Couldn't read your balances",
          "The XRP Ledger didn't answer for your LUMOS balance and pool positions. Reload to try again.");
        return;
      }
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
          else if (ECO[l.account]) ecoHits.push({ name: ECO[l.account], lp: bal, acct: l.account });
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

      // HOLDING LUMOS IS NOT A REWARD PROGRAMME (RAZA 2026-09-15: "I dont think Rewards is working correctly on XRPL").
      // This said "You are eligible" for any balance — 1.05M LUMOS and no pool position. The three programmes on this
      // page are Native LP (a LUMOS/XRP position), Ecosystem LP (a position in one of the ten pools) and Whale Holder,
      // which starts at 5,000,000 LUMOS with one share per 5M. The 250K fee discount is a trading benefit, not a reward.
      // STELLAR'S BOX (RAZA 2026-09-15: "the design remains same and if the wallet is not qualifying for any reward. Just add -
      // like you're doing on Stellar"): one row per programme with its dot, what this account has, and its estimated share
      // of the round — Native LP 1,000,000 LUMOS by pool share, Ecosystem 100,000 LUMOS per pool by pool share, Whale Holder
      // 1,000,000 LUMOS by whale shares (one per 5M, team wallets and pools excluded) — then the total.
      var shares = Math.floor(lumos / 5e6);
      // B09: a pool's total less the team wallets' LP tokens (0 when that read fails).
      var lpTotal = function (r) { return Number(r && r.amm && r.amm.lp_token && r.amm.lp_token.value) || 0; };
      var lpReal = function (acct) { return rpc('amm_info', { amm_account: acct }).then(function (r) {
        var t = lpTotal(r); if (!(t > 0)) return r;
        return teamLp(acct, r.amm.lp_token.currency).then(function (ex) { r.amm.lp_token.value = String(Math.max(0, t - ex)); return r; }); }); };
      Promise.all([
        nativeLp > 0 ? lpReal(NATIVE_POOL) : Promise.resolve(null),
        Promise.all(ecoHits.map(function (e) { return lpReal(e.acct).then(function (r) { return { e: e, r: r }; }); })),
        shares > 0 ? fetch('/lxapi/xrplrichlist?iss=' + ISS + '&cur=' + CUR + '&n=50').then(function (x) { return x.json(); }).catch(function () { return null; }) : Promise.resolve(null)
      ]).then(function (res) {
        var nTot = lpTotal(res[0]), nShare = nTot > 0 ? nativeLp / nTot : 0, nRew = 1e6 * nShare;
        var eRew = 0, eCodes = [];
        res[1].forEach(function (x) { var t = lpTotal(x.r); if (t > 0) eRew += 1e5 * (x.e.lp / t); eCodes.push(x.e.name); });
        var wTS = 0;
        ((res[2] && res[2].rows) || []).forEach(function (h) {
          if (h.amm) return;
          var tm = false;
          try { tm = window.lxx.isTeamWallet(h.account); } catch (e) {}
          if (tm) return;
          var hb = Math.abs(Number(h.balance)) || 0;
          if (hb >= 5e6) wTS += Math.floor(hb / 5e6);
        });
        if (shares > wTS) wTS = shares;
        var wRew = (shares > 0 && wTS > 0) ? 1e6 * shares / wTS : 0;
        var whole = function (v) { return Math.round(+v || 0).toLocaleString('en-US'); };
        var pc = function (x) { var q = (+x || 0) * 100; return (q >= 1 ? q.toFixed(1) : (q >= 0.01 ? q.toFixed(2) : q.toFixed(3))) + '%'; };
        erBox([
          ['var(--accent)', 'Native LP Rewards', nativeLp > 0 ? ('LUMOS/XRP · ' + pc(nShare) + ' of the pool') : 'Add LUMOS/XRP liquidity to qualify', nativeLp > 0 ? '~' + whole(nRew) : '—'],
          ['var(--blue)', 'Ecosystem LP Rewards', eCodes.length ? (eCodes.length === 1 ? ('LUMOS/' + eCodes[0] + ' pool') : (eCodes.length + ' pools · ' + eCodes.slice(0, 3).join(', ') + (eCodes.length > 3 ? '…' : ''))) : 'Join an eligible LUMOS pool to qualify', eCodes.length ? '~' + whole(eRew) : '—'],
          ['var(--green)', 'Whale Holder Rewards', shares > 0 ? (whole(lumos) + ' LUMOS · ' + shares + ' share' + (shares > 1 ? 's' : '')) : (lumos > 0 ? whole(lumos) + ' LUMOS · below 5M' : 'Hold 5M+ LUMOS to qualify'), shares > 0 ? '~' + whole(wRew) : '—'],
          ['', 'Your estimated total this round', '', '~' + whole(nRew + eRew + wRew) + ' LUMOS', true]
        ]);
      });
    });
  }

  // ---- distribution report ------------------------------------------------------------------------
  // There is no source for past XRPL payouts, so this says so. The inherited version filled the same
  // table with invented Stellar recipients under an "illustrative" label; on a page about who got
  // paid, an empty state is the only honest option.
  // RE-ASSERTED, AND SAFE TO RE-ASSERT (2026-11-21). The design redraws this card -- its invented Round 23 rows --
  // on every tab click and round change. Those redraws only failed to show because the design threw ("reading
  // 'nets'") on any round past its sample data, which was a console error on every click. So: the design's round
  // change never runs (nothing to show for any round; a capture listener stops it before it reaches the select),
  // and this re-applies from an observer on the card. Every write is guarded, so a pass that changes nothing ends
  // the loop.
  var RT = 'Round report not published yet',
      RS = 'Rewards on the XRP Ledger have been paid every round since 15 December 2025.',
      RR = 'Recipient lists for XRP Ledger rounds will appear here once they are published.',
      RP = 'Ten Ecosystem pools · LUMOS/XRP native pool · holder rewards';
  var repObs = 0;
  function report() {
    var rows = $('#repRows');
    if (!rows) return;
    var f = rows.firstElementChild;
    if (!(rows.children.length === 1 && f && f.getAttribute('data-lxrep') === '1')) {
      rows.innerHTML = '';
      var r = el('div', 'rr');
      r.setAttribute('data-lxrep', '1');
      r.style.cssText = 'justify-content:center;opacity:.7;padding:22px 8px;text-align:center';
      r.textContent = RR;
      rows.appendChild(r);
    }

    var c = $('#repCount');
    if (c) {
      if (c.textContent !== '0') c.textContent = '0';
      // The design's "Showing <b>6</b> of" kept its mock six beside a count of none.
      var shown = c.previousElementSibling;
      if (shown && shown.tagName === 'B' && shown.textContent !== '0') shown.textContent = '0';
    }
    var t = $('#repTitle');
    if (t && t.textContent !== RT) t.textContent = RT;
    var s = $('#repSub');
    if (s && s.textContent !== RS) s.textContent = RS;
    var p = $('#psum');
    if (p && p.textContent !== RP) p.textContent = RP;
    fixRounds();
    if (!repObs) {
      repObs = 1;
      document.addEventListener('change', function (e) { if (e.target && e.target.id === 'roundSel') e.stopPropagation(); }, true);
      try { new MutationObserver(function () { report(); }).observe(rows.closest('.rep') || rows.parentElement, { childList: true, subtree: true, characterData: true }); } catch (e) {}
    }
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

  // The programme descriptions still named another chain's pairs after the chain-name pass: "LUMOS/aBTC on the XRP
  // Ledger" (aBTC is an Aptos asset) and "e.g. LUMOS/MESO, LUMOS/CELL". Named from this ledger's own pools.
  function fixProgramCopy() {
    [].forEach.call(document.querySelectorAll('.pdesc'), function (p) {
      var h = p.innerHTML, o = h;
      h = h.replace(/\s*or\s*<b>LUMOS\/aBTC<\/b>\s*on the XRP Ledger/i, '');
      h = h.replace(/LUMOS\/MESO,\s*LUMOS\/CELL/, 'LUMOS/RLUSD, LUMOS/USDC');   // both in the current cycle (ARMY was the previous one's)
      if (h !== o) p.innerHTML = h;
    });
  }

  // THE ROUND PICKER AND THE NETWORK CHIP (RAZA 2026-09-16: "it shows APTOS logo and also says June 1. Fix it"). The chip keeps the
  // design's Aptos image; the picker stopped at the design's last sample round. Rounds close on the 1st and the 15th on the same
  // dates as Stellar (Round 23 = 1 June 2026), so the list runs to the most recent close.
  function fixRounds() {
    // The slot (span.cc) arrives empty in the XRPL build, so the <img> is created when it is missing (2026-11-21).
    var cc = document.querySelector('#netseg .ns .cc');
    var img = document.querySelector('#netseg .ns img');
    if (!img && cc) { img = document.createElement('img'); img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'; cc.appendChild(img); }
    if (img && img.getAttribute('data-lxx') !== '1') {
      img.setAttribute('data-lxx', '1');
      img.src = '/assets/networks/xrpl.png';
    }
    var sel = $('#roundSel');
    if (!sel) return;
    // EACH PROGRAMME COUNTS ITS OWN ROUNDS (RAZA 2026-11-21): Native LP's first round was 15 Dec 2025, whale holder's
    // 1 Apr 2026, Ecosystem LP's 15 Apr 2026. The list follows the selected programme tab and is rebuilt when it changes
    // (report() calls this from its observer). It used to start at the design's 'Round 20 = 15 Apr 2026' for all three.
    var a = document.querySelector('.ptabs button.pt.active'), lab = a ? (a.textContent || '') : '';
    var st = /whale/i.test(lab) ? [2026, 3, 1] : /eco/i.test(lab) ? [2026, 3, 15] : [2025, 11, 15];
    var key = st.join('-');
    if (sel.__lxx === key) return;
    sel.__lxx = key;
    var rounds = [], n = 1, d = new Date(st[0], st[1], st[2]), now = new Date();
    while (d <= now) {
      rounds.push([n, new Date(d.getTime())]);
      n++;
      d = d.getDate() === 1 ? new Date(d.getFullYear(), d.getMonth(), 15) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    if (!rounds.length) return;
    sel.innerHTML = '';
    rounds.reverse().forEach(function (r) {
      var o = document.createElement('option');
      o.value = String(r[0]);
      o.textContent = 'Round ' + r[0] + ' · ' + r[1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      sel.appendChild(o);
    });
    sel.value = String(rounds[0][0]);
  }

  // ---- what each programme has actually paid out -----------------------------------------------------
  //
  // THE PAGE WAS CONTRADICTING ITS OWN FAQ. All three "Distributed" bars read 23M, and the hero read
  // 69,000,000 — which is 3 x 23M. Those are the design's placeholder figures, inherited in the
  // markup and never reconciled with anything. Three programmes that STARTED FOUR MONTHS APART
  // cannot have paid out identical amounts, and the page says so itself a few hundred pixels lower:
  // "Ecosystem LP began on 15 April 2026, making 1 October 2026 its twelfth and final round" — that
  // is eleven rounds paid, not twenty-three.
  //
  // So the figures are COUNTED from the schedule the page already publishes rather than written down
  // a second time: rounds close on the 1st and the 15th, each programme pays 1,000,000 LUMOS a round,
  // and each began on its own stated date. The count is the only input, so the bars and the FAQ
  // cannot drift apart again.
  //
  // Start dates are the ones in the FAQ above, which is the authored source for this schedule.
  var PROGRAMMES = [
    { key: 'native', start: [2025, 11, 15], perRound: 1e6, cap: 240e6 },   // 15 Dec 2025
    { key: 'eco', start: [2026, 3, 15], perRound: 1e6, cap: 240e6 },       // 15 Apr 2026
    { key: 'whale', start: [2026, 3, 1], perRound: 1e6, cap: 50e6 },       //  1 Apr 2026
  ];
  // Rounds CLOSE on the 1st and the 15th. A round dated today has not paid yet, so the count is of
  // closes strictly before now -- the same boundary the countdown above uses for "next distribution".
  function roundsPaid(start, now) {
    var d = new Date(start[0], start[1], start[2]);
    var n = 0;
    while (d < now) {
      n++;
      d = d.getDate() === 1 ? new Date(d.getFullYear(), d.getMonth(), 15)
        : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return n;
  }
  function shortM(v) {
    var m = v / 1e6;
    return (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1)) + 'M';
  }
  function paintDistributed() {
    var rows = [].slice.call(document.querySelectorAll('.palloc .pa-row')).filter(function (r) {
      var l = r.querySelector('.l');
      return l && /distributed/i.test(l.textContent || '');
    });
    if (!rows.length) return;
    var now = new Date(), total = 0;
    // The bars are in the order the programmes are laid out, which is the order of PROGRAMMES.
    PROGRAMMES.forEach(function (p, i) {
      var paid = Math.min(p.cap, roundsPaid(p.start, now) * p.perRound);
      total += paid;
      var r = rows[i];
      if (!r) return;
      var b = r.querySelector('.r b');
      if (b && b.textContent !== shortM(paid)) b.textContent = shortM(paid);
    });
    // "Distributed so far" is the sum of the three, not a fourth number to keep in step.
    [].forEach.call(document.querySelectorAll('.hstats .hstat'), function (h) {
      if (!/distributed so far/i.test(h.textContent || '')) return;
      var v = h.querySelector('.v');
      var want = total.toLocaleString('en-US');
      if (v) {
        // The unit sits in its own node beside the figure; only the figure is rewritten.
        var t = v.firstChild;
        if (t && t.nodeType === 3) { if (t.nodeValue !== want) t.nodeValue = want; }
        else if (v.textContent.indexOf(want) < 0) v.textContent = want;
      }
    });
  }

  function load() {
    if (!$('#eligBox') && !$('#repRows')) return;             // not the Rewards page
    setTimeout(fixRounds, 0);
    setTimeout(fixRounds, 1500);
    paintChainCopy();
    fixProgramCopy();
    paintDistributed();
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
