// The launch review page, and the transactions a launch is actually made of.
//
// TWO PROBLEMS ON THIS PAGE.
//
// 1. It showed the DESIGN'S MOCK regardless of what was typed: "XRP Ledger Coin", ticker "$XRP",
//    "t.me/solarflare", a supply of 1,000,000,000 -- and a description about "the chaotic energy of
//    solar storms". A review step whose whole purpose is "double-check everything below" was
//    showing somebody else's token.
//
// 2. "Confirm & Launch" was a plain <a href="/launchpad/confirm">. It navigated to the success
//    page -- confetti, share buttons, the lot -- having issued nothing at all. That is worse than a
//    broken button: it tells the user they own a token that does not exist.
//
// This file fixes (1) outright and makes (2) honest. It also builds the exact transaction sequence a
// launch consists of, so the plan can be inspected and tested before anything is signed.
//
// THE LAUNCH NOW RUNS, on GemWallet. lxc.submit() carries the user's four transactions to the
// extension; the issuer's four are signed locally with a key generated here and thrown away.
//
// TWO HONEST LIMITS, both deliberate:
//
//   * Xaman CAN sign everywhere else on the site now, but is refused HERE by name. This is eight
//     transactions in a fixed order whose last two are irreversible, and each Xaman approval leaves
//     the page — a reload on the way back would land mid-sequence with real XRP already spent.
//   * NONE OF THE GEMWALLET PATH HAS ROUND-TRIPPED AGAINST THE EXTENSION. It is written from the
//     documented protocol and there is no extension in the browser it was built in. What IS tested
//     is the ordering and the failure handling, by running this same orchestrator against a fake
//     ledger: the happy path completes eight steps in order, a ledger rejection stops immediately
//     rather than blackholing an issuer whose mint failed, and a refused prompt leaves nothing
//     done. The first real launch is still a test, and it costs real XRP.
(function () {
  if (window.__lxxMint) return;
  window.__lxxMint = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  var DRAFT = 'lumos.launch.draft';
  // THE BLACKHOLE REGULAR KEY, taken from the ledger rather than from memory. XRPL LUMOS's own
  // issuer (rsPqeam…Ha) carries RegularKey rrrrrrrrrrrrrrrrrrrrBZbvji -- ACCOUNT_ONE -- with
  // lsfDisableMaster set. A note here said ACCOUNT_ZERO (rrrrrrrrrrrrrrrrrrrrrhoLvTp), which is a
  // different address; using it would have produced a blackhole that does not match the one every
  // LumosCore token on this ledger already uses.
  var BLACKHOLE_KEY = 'rrrrrrrrrrrrrrrrrrrrBZbvji';

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { return null; }
  }

  function num(v) { return (v == null || !isFinite(v)) ? null : Number(v); }

  function group(v) {
    return v == null ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // ---- review painting -------------------------------------------------------------------------
  // Rows are matched by their LABEL, not their position, for the reason every other layer here does
  // it: the order of a design's rows is a layout decision that can change without anyone thinking
  // about this file.
  function setRow(label, text, whole) {
    var rows = $$('.detail-row');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.k');
      var v = rows[i].querySelector('.v');
      if (!k || !v) continue;
      if ((k.textContent || '').trim().toLowerCase() !== label) continue;

      // `whole` replaces the entire cell. The icon row needs it: its .v holds a preview tile, a
      // pill AND a filename span, so writing into the pill alone left the row reading
      // "XRP Not provided icon-slr.png · 142 KB" -- the replacement wedged inside the mock.
      if (whole) { v.textContent = text; v.classList.toggle('empty', true); return true; }

      // A row whose value is a link or a pill keeps its element; only the text changes.
      var inner = v.querySelector('a, .pill');
      if (inner) {
        inner.textContent = text;
        if (inner.tagName === 'A') inner.setAttribute('href', /^https?:/.test(text) ? text : ('https://' + text));
      } else {
        v.textContent = text;
      }
      v.classList.toggle('empty', text === 'Not provided' || text === '—');
      return true;
    }
    return false;
  }

  function paintReview() {
    var d = readDraft();
    if (!d) return false;

    var supply = num(d.supply);
    var share = num(d.share);
    var lpShare = (share == null) ? null : (100 - share);
    var yours = (supply != null && share != null) ? supply * share / 100 : null;
    var pool = (supply != null && lpShare != null) ? supply * lpShare / 100 : null;
    var ticker = d.ticker || '';

    // THE HERO ICON WAS DRAWING XRP'S OWN LOGO on every token, because it carries `lx-natico` -- a
    // painter for the network's NATIVE asset. Replaced with the uploaded icon, or initials drawn as
    // inline SVG. Either way the element ends up containing a real node, which is what stops both
    // that painter and the logo healer from claiming it back.
    var heroIcon = $('.hero-icon');
    if (heroIcon) {
      heroIcon.classList.remove('lx-natico');
      heroIcon.removeAttribute('data-logo');
      heroIcon.innerHTML = '';
      if (d.icon) {
        // The tile paints `linear-gradient(135deg, var(--accent), #ff9a3d)` as its own background,
        // which is right for a placeholder and wrong behind a real logo -- it rimmed the artwork in
        // orange. Cleared only when there IS an image; the initials still need it.
        heroIcon.style.background = 'none';
        var img = document.createElement('img');
        img.src = d.icon;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
        heroIcon.appendChild(img);
      } else {
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('width', '52'); svg.setAttribute('height', '52');
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', '32'); t.setAttribute('y', '34');
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
        t.setAttribute('font-size', '22'); t.setAttribute('font-weight', '800');
        t.setAttribute('fill', '#fff');
        t.textContent = String(d.ticker || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
        svg.appendChild(t);
        heroIcon.appendChild(svg);
      }
    }

    var name = $('.hero-name');
    if (name) name.textContent = d.name || '—';
    var desc = $('.hero-desc');
    if (desc) desc.textContent = d.desc || '';

    setRow('token name', d.name || '—');
    setRow('ticker', '$' + ticker);
    setRow('description', d.desc || 'Not provided');

    // The icon row shipped a mock filename -- "icon-slr.png · 142 KB" -- beside a preview of a token
    // nobody uploaded. It now reports whether one actually came through the draft.
    setRow('icon', d.icon ? 'Uploaded' : 'Not provided', true);

    setRow('total supply', group(supply) + ' ' + ticker);
    setRow('your share', share == null ? '—' : (share + '% (' + group(yours) + ' ' + ticker + ')'));
    setRow('liquidity pool share',
      lpShare == null ? '—' : (lpShare + '% (' + group(pool) + ' ' + ticker + ')'));

    // The issuer is blackholed at the end of the launch, so this row is a promise the flow keeps.
    setRow('issuer locked', 'Yes — supply is fixed');

    // NOT group(): that rounds to whole units, which is right for a token supply and wrong for an
    // XRP amount -- it turned 0.25 XRP into "0 XRP added to the pool", reporting the user's own
    // contribution as nothing.
    var extra = num(d.extra);
    setRow('extra xrp', (extra && extra > 0)
      ? ((extra % 1 === 0 ? extra.toLocaleString('en-US') : String(extra)) + ' XRP added to the pool')
      : 'None — using default liquidity only');

    // Socials: whatever was not filled in says so, rather than showing the design's accounts.
    setRow('telegram', d.telegram || 'Not provided');
    setRow('x / twitter', d.twitter || 'Not provided');
    setRow('website', d.website || 'Not provided');

    return true;
  }

  // ---- the launch, as a list of transactions ----------------------------------------------------
  //
  // Written out in full so the sequence can be read, ordered and tested before it is ever signed.
  // Each entry says WHO signs it, because that is the whole difficulty: the issuer's transactions
  // are signed locally with a key this page generates, and the user's are signed by their wallet.
  //
  // ORDER IS LOAD-BEARING IN TWO PLACES:
  //
  //   * DefaultRipple must be set on the issuer BEFORE the token can move between third parties.
  //     Set it after minting and the token is stuck in the holder's hands.
  //   * The blackhole is SetRegularKey FIRST, then DisableMaster. Disabling the master key first
  //     would leave no key able to sign the SetRegularKey, and the issuer would keep a live master
  //     key forever -- the exact opposite of what "supply is fixed" claims.
  function buildLaunchPlan(d, issuer, user, reserveXrp, opts) {
    var o = opts || {};
    var cur = d.currency;
    var supply = String(d.supply);
    var pool = o.pool;                                   // the throwaway that owns the pool; blackholed at the end

    // The issuer needs the base reserve to exist at all, plus its own transaction fees. Whatever is
    // sent here is locked forever once the account is blackholed, so it is funded to the minimum
    // rather than rounded up.
    //
    // MEASURED, NOT GUESSED (2026-09-17): the three live launchpad issuers were each funded with 1.02 XRP and each still
    // holds 1.019953 — so 0.02 covers every fee the issuer ever pays. The old `+0.5` locked an extra 0.48 XRP (~$0.62) in a
    // dead account on every launch, for nothing.
    var base = (reserveXrp == null ? 1 : reserveXrp);
    var fund = base + 0.02;

    // What the pool gets. The review page states a liquidity share -- 75% of supply against the XRP
    // side -- so the pool has to actually be created, or that row is a promise the launch breaks.
    var share = Number(d.share);
    var lpTokens = (isFinite(share) && d.supply) ? (Number(d.supply) * (100 - share) / 100) : 0;
    var lpXrp = Number(o.liquidityXrp || 0) + (Number(d.extra) || 0);

    var plan = [];

    // THE FEE GOES FIRST. It is the pattern this project already uses for paid flows -- the listing
    // request pays before it submits -- and it means a launch that fails later has not also left an
    // unpaid token on the ledger. The user is told the whole sequence before the first prompt.
    if (o.feeXrp > 0 && o.feeCollector) {
      plan.push({ by: 'user', what: 'Pay the launch fee',
        tx: { TransactionType: 'Payment', Account: user, Destination: o.feeCollector,
              Amount: String(Math.round(o.feeXrp * 1e6)) } });
    }

    plan.push(
      { by: 'user', what: 'Fund the issuing account',
        tx: { TransactionType: 'Payment', Account: user, Destination: issuer,
              Amount: String(Math.round(fund * 1e6)) } });

    // THE POOL ACCOUNT (RAZA 2026-09-17, matching the 2025 Stellar launches): a second throwaway, funded by the user, which
    // takes the whole supply, hands the launcher their share, creates the pool and then blackholes itself. The liquidity is
    // then provably un-ruggable — not by the launcher, not by LumosCore, not by anyone, because no key can sign for it.
    //
    // It needs, and this has to be counted exactly or the account ends up a fraction under its own reserve and the launch
    // dies on the last step:
    //   base reserve            1.00   to exist at all
    //   trust line (the token)  0.20   owner reserve, held for the life of the account
    //   trust line (LP token)   0.20   owner reserve, created by AMMCreate
    //   AMMCreate cost          0.20   destroyed, not a fee
    //   margin + fees           0.25   the reserve is a ledger parameter and can rise
    //   + lpXrp                        the XRP that becomes the pool's own side
    if (pool) {
      var poolFund = base + 0.85 + lpXrp;
      plan.push(
        { by: 'user', what: 'Fund the liquidity pool account',
          tx: { TransactionType: 'Payment', Account: user, Destination: pool,
                Amount: String(Math.round(poolFund * 1e6)) } });
    }

    return plan.concat(buildRest(cur, supply, issuer, user, lpTokens, lpXrp, pool, d.share));
  }

  // THE SUPPLY NEVER PASSES THROUGH THE LAUNCHER'S WALLET ANY MORE (RAZA 2026-09-17, matching the 2025 Stellar launches,
  // measured on mainnet: an operator-made throwaway took the whole supply, sent the launcher their share, deposited the rest
  // and then set its own master weight to 0).
  //
  // Why it matters: whoever holds the LP tokens can withdraw the pool. Leaving them with the launcher — which is what this
  // flow used to do, and what lumoscore.com still does — means the liquidity can be pulled the moment the token moves. Here
  // the pool account blackholes itself at the end, so the liquidity is locked for good and the launcher keeps exactly the
  // share they chose. Nobody collects the pool's 0.2% either; it compounds inside the pool, unclaimable, forever.
  function buildRest(cur, supply, issuer, user, lpTokens, lpXrp, pool, sharePct) {
    // What the launcher actually receives: their chosen share of the supply, sent on by the pool account.
    var userTokens = (isFinite(Number(sharePct)) && Number(supply))
      ? (Number(supply) * Number(sharePct) / 100) : 0;
    var holder = pool || user;                           // no pool account (nothing to seed) → the old behaviour

    return [

      { by: 'issuer', what: 'Enable rippling and set the domain',
        // 8 = asfDefaultRipple. Domain is hex of the ASCII host, which is what makes the token
        // verifiable against the xrp-ledger.toml served from that domain.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 8,
              Domain: hexAscii('lumoscore.com') } },

      // The pool account has to trust the token before the issuer can send it the supply.
      pool ? {
        by: 'pool', what: 'Prepare the liquidity pool account',
        tx: { TransactionType: 'TrustSet', Account: pool,
              LimitAmount: { currency: cur, issuer: issuer, value: supply } } } : null,

      { by: 'user', what: 'Trust the new token',
        tx: { TransactionType: 'TrustSet', Account: user,
              LimitAmount: { currency: cur, issuer: issuer, value: supply } } },

      { by: 'issuer', what: pool ? 'Mint the full supply' : 'Mint the full supply to you',
        tx: { TransactionType: 'Payment', Account: issuer, Destination: holder,
              Amount: { currency: cur, issuer: issuer, value: supply } } },

      // The launcher's own share, and only that. The rest stays with the pool account for the pool.
      (pool && userTokens > 0) ? {
        by: 'pool', what: 'Send you your share',
        tx: { TransactionType: 'Payment', Account: pool, Destination: user,
              Amount: { currency: cur, issuer: issuer, value: lxxAmt(userTokens) } } } : null,

      // THE POOL. Without this the review page's "Liquidity Pool Share" is a promise the launch never keeps.
      //
      // AMMCreate is skipped entirely when there is nothing to seed it with, rather than submitted
      // with a zero side, which the ledger rejects.
      (lpTokens > 0 && lpXrp > 0) ? {
        by: pool ? 'pool' : 'user', what: 'Create the liquidity pool',
        tx: { TransactionType: 'AMMCreate', Account: holder,
              Amount: { currency: cur, issuer: issuer, value: lxxAmt(lpTokens) },
              Amount2: String(Math.round(lpXrp * 1e6)),
              // Trading fee in units of 1/1000 of a percent, so 200 is 0.2% — the platform's own rate (RAZA 2026-09-17).
              // Fixed at creation; on an existing pool it can only be changed by an LP vote, and this pool's only LP is
              // about to be blackholed, so 0.2% is what it charges for as long as it exists.
              TradingFee: 200 } } : null,

      { by: 'issuer', what: 'Hand over the issuer key',
        tx: { TransactionType: 'SetRegularKey', Account: issuer, RegularKey: BLACKHOLE_KEY } },

      { by: 'issuer', what: 'Disable the issuer permanently',
        // 4 = asfDisableMaster. After this nothing can ever sign for the issuer again, so the
        // supply minted above is the supply forever.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 4 } },

      // …and the same two for the pool account, which is what locks the liquidity. SetRegularKey FIRST: disabling the
      // master key first would leave nothing able to sign the SetRegularKey.
      pool ? {
        by: 'pool', what: 'Hand over the pool account key',
        tx: { TransactionType: 'SetRegularKey', Account: pool, RegularKey: BLACKHOLE_KEY } } : null,

      pool ? {
        by: 'pool', what: 'Lock the liquidity permanently',
        tx: { TransactionType: 'AccountSet', Account: pool, SetFlag: 4 } } : null,
    ].filter(Boolean);
  }

  // Token amounts go on the ledger as strings, and an exponent or sixteen significant digits is a rejection. The vendored
  // core already does this for every other write on the site; the launch plan is built before that library is loaded, so it
  // gets the same treatment locally.
  function lxxAmt(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '0';
    var s = v.toPrecision(15).replace(/\.?0+$/, '');
    if (s.indexOf('e') < 0 && s.indexOf('E') < 0) return s;
    return v.toFixed(Math.max(0, 15 - Math.ceil(Math.log10(Math.abs(v) + 1)))).replace(/\.?0+$/, '');
  }

  // ---- running the launch -----------------------------------------------------------------------
  //
  // Every dependency is injected. That is not ceremony: a launch moves real money and cannot be
  // rehearsed against mainnet, so the only way to test the ORDERING and the FAILURE HANDLING is to
  // run the same orchestrator against a fake ledger. See the checks in the commit for this file.
  //
  // The contract it keeps: on failure it reports exactly how far it got. A launch that stops halfway
  // has left the user's XRP somewhere -- in a funded issuer, or in a token with no pool -- and the
  // one thing they must not be told is a generic "something went wrong".
  function runLaunch(env) {
    var plan = env.plan;
    var completed = [];
    var chain = Promise.resolve();

    plan.forEach(function (step, i) {
      chain = chain.then(function () {
        env.onStep(i, 'start', step);
        // Three signers: the user's wallet, the throwaway issuer, and the throwaway pool account. The last two are generated
        // in this browser for this launch and blackholed by the end, so signing for them locally is safe — the keys are
        // worthless the moment the plan finishes.
        var submit = step.by === 'user' ? env.submitUser
          : (step.by === 'pool' ? env.submitPool : env.submitIssuer);
        return submit(step.tx).then(function (hash) {
          // WAIT FOR VALIDATION, never just for submission. A submitted transaction has been
          // accepted by one server, not written to a ledger, and the next step depends on the
          // previous one having actually happened -- the issuer does not exist until its funding
          // validates, and the mint fails without the trust line.
          return env.waitValidated(hash).then(function (res) {
            if (!res || !res.ok) {
              throw new Error(step.what + ' was rejected by the ledger'
                + (res && res.code ? ' (' + res.code + ')' : '') + '.');
            }
            completed.push({ what: step.what, hash: hash });
            env.onStep(i, 'done', step);
          });
        });
      });
    });

    return chain
      .then(function () { return { ok: true, completed: completed }; })
      .catch(function (e) {
        return { ok: false, error: (e && e.message) || String(e), completed: completed,
                 stoppedAt: completed.length };
      });
  }

  function hexAscii(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += (c < 16 ? '0' : '') + c.toString(16).toUpperCase();
    }
    return out;
  }

  // ---- the launch control ----------------------------------------------------------------------

  // ---- the real ledger, behind the same interface the fake one implements --------------------

  var RPC = 'https://xrplcluster.com/';
  var LIB = '/assets/vendor/xrpl-5.1.0.min.js';

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
    }).then(function (r) { return r.json(); });
  }

  function loadLib() {
    if (window.xrpl) return Promise.resolve(window.xrpl);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = LIB;
      s.onload = function () { window.xrpl ? res(window.xrpl) : rej(new Error('Signing library failed to load.')); };
      s.onerror = function () { rej(new Error('Signing library failed to load.')); };
      document.head.appendChild(s);
    });
  }

  // Fill in the three fields the ledger requires and the wallet does not supply for us. Sequence is
  // re-read before every issuer transaction rather than incremented locally: a locally tracked
  // sequence drifts the moment anything else touches the account, and the failure is a silent
  // tefPAST_SEQ rather than an error anyone can read.
  function autofill(tx, xrpl) {
    return Promise.all([
      rpc('account_info', { account: tx.Account, ledger_index: 'current' }),
      rpc('server_info', {}),
    ]).then(function (r) {
      var acct = r[0] && r[0].result && r[0].result.account_data;
      if (!acct) throw new Error('That account is not on the ledger yet.');   // the issuer or the pool account
      var info = r[1] && r[1].result && r[1].result.info;
      var base = (info && info.validated_ledger && info.validated_ledger.base_fee_xrp) || 0.00001;
      var ledger = (info && info.validated_ledger && info.validated_ledger.seq) || 0;
      var out = Object.assign({}, tx);
      out.Sequence = acct.Sequence;
      out.Fee = String(Math.max(10, Math.round(base * 1e6 * 2)));
      if (ledger) out.LastLedgerSequence = ledger + 20;
      return out;
    });
  }

  function submitIssuerTx(tx, wallet, xrpl) {
    return autofill(tx, xrpl).then(function (full) {
      var signed = wallet.sign(full);
      return rpc('submit', { tx_blob: signed.tx_blob }).then(function (j) {
        var res = j && j.result;
        var code = res && res.engine_result;
        // tesSUCCESS means accepted for this ledger, and tec* means it WILL be recorded as a
        // failure. Anything else was not applied at all, so there is no hash worth waiting on.
        if (!code || (code !== 'tesSUCCESS' && code.slice(0, 3) !== 'tec')) {
          throw new Error('The ledger refused the transaction' + (code ? ' (' + code + ')' : '') + '.');
        }
        return signed.hash;
      });
    });
  }

  // Poll until the transaction is in a validated ledger. `validated: false` is not failure -- it is
  // "not yet" -- so only a definitive answer stops the wait.
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    return rpc('tx', { transaction: hash, binary: false }).then(function (j) {
      var r = j && j.result;
      if (r && r.validated) {
        var code = (r.meta && r.meta.TransactionResult) || (r.metaData && r.metaData.TransactionResult);
        return { ok: code === 'tesSUCCESS', code: code };
      }
      if (n <= 0) return { ok: false, code: 'timed out waiting for validation' };
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return waitValidated(hash, n - 1); });
    });
  }

  var running = false;

  // INLINE, IN THE WIDE COLUMN -- no popup.
  //
  // This went through two wrong shapes. First it was inserted next to the launch button, which sits
  // in a ~200px summary column, so eight progress lines wrapped into a tall ribbon that collided
  // with the button. Then it became a modal, which fixed the layout and added a second confirmation
  // step the Stellar site does not have -- and this page IS the confirmation: it is titled "Review
  // Your Token", it carries an "This action is irreversible" panel, and the button reads "Confirm &
  // Launch". Asking again after that is noise.
  //
  // So progress renders in the main content column, which is wide enough to read, and the launch
  // starts on the button the user already pressed.
  function status(_anchor, html) {
    var box = $('#lxxMintStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lxxMintStatus';
      box.setAttribute('role', 'status');
      box.style.cssText = 'margin:18px 0;padding:16px 18px;border-radius:14px;font-size:13.5px;'
        + 'line-height:1.7;background:var(--surface-2,rgba(127,127,127,.07));'
        + 'color:var(--text,inherit);border:1px solid var(--border,rgba(127,127,127,.22))';

      // PLACED BETWEEN THE HERO CARD AND THE FIRST DETAIL CARD, which are siblings in the same
      // column. Two earlier attempts got this wrong in opposite directions, and both because the
      // anchor was chosen by ancestry rather than by name: `hero.closest('.card,.panel,section,div')`
      // matched the hero's own immediate div and dropped the box INSIDE the hero, over the token
      // name; widening it to `closest('.card,.panel,section')` from the General Info heading matched
      // a section wrapping the whole page and put the box above the page title. `.detail-card` is
      // the actual sibling boundary.
      var main = $('main.page') || document.body;
      var detail = $('.detail-card');
      if (detail && detail.parentElement) {
        detail.parentElement.insertBefore(box, detail);
      } else {
        main.insertBefore(box, main.firstChild);
      }
    }
    box.innerHTML = html;
    box.scrollIntoView({ block: 'nearest' });
    return box;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wireLaunch() {
    var el = $$('a, button').filter(function (e) {
      return /confirm\s*&\s*launch/i.test(e.textContent || '');
    })[0];
    if (!el) return;

    // THE LINK IS NEUTRALISED, not merely intercepted. Leaving the href in place means a
    // middle-click, a right-click "open in new tab", or a keyboard activation still reaches the
    // success page behind the handler's back — a confetti page for a token that was never issued.
    if (el.tagName === 'A') { el.removeAttribute('href'); el.setAttribute('role', 'button'); }

    // `running` is the MODULE-level flag on purpose. A `var running` here would shadow it, leaving
    // the modal's "do not close mid-launch" guard reading a variable that is always false -- the
    // guard would look present and do nothing.
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (running) return;

      var d = readDraft();
      if (!d) { status(el, 'No token details found — start again from the form.'); return; }

      var lxc = window.lxc;
      if (!lxc || !lxc.address()) { status(el, 'Connect a wallet first.'); return; }
      // XAMAN CAN SIGN NOW, AND STILL MAY NOT LAUNCH A TOKEN. Every other write path is ONE
      // transaction: leaving for the wallet and coming back is safe, because the worst case is a
      // transaction that did not happen. This is eight in a fixed order, four of them signed by the
      // user's wallet, and the last two are irreversible. Each Xaman approval leaves the browser, and
      // a phone is free to reload this page rather than restore it on the way back -- which would land
      // mid-sequence, with an issuer part-configured and real XRP already spent. Until the sequence
      // can survive a reload, this stays on the transports that prompt without leaving the page.
      if (lxc.transport && lxc.transport() === 'xaman') {
        status(el, esc('Launching a token needs a desktop wallet — GemWallet or Crossmark. The launch '
          + 'is eight approvals in a fixed order and must not be interrupted, and approving each one in '
          + 'Xaman means leaving this page eight times. Everything else on LumosCore signs fine in Xaman.'));
        return;
      }
      if (!lxc.canSign || !lxc.canSign()) {
        status(el, esc('This wallet connection cannot sign. Disconnect and connect again.'));
        return;
      }

      // CONFIRM BEFORE THE FIRST PROMPT, with the whole sequence and the total shown. Eight wallet
      // prompts arriving unannounced is indistinguishable from something going wrong, and the last
      // two are irreversible.
      var cfg = window.__lxxLaunchConfig || {};

      running = true;
      status(el, 'Reading the ledger…');

      // The rate is fetched HERE rather than read from a global the form page sets. This page does
      // not run the form's layer, so that global is never set on the review step -- and a missing
      // rate would silently price the fee at zero.
      Promise.all([rpc('server_info', {}), fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })])
        .then(function (both) {
        var j = both[0], p = both[1];
        var rate = (p && p.ok && p.usd > 0) ? p.usd : null;
        if (!rate) throw new Error('Could not price the launch in XRP right now.');
        // THE POOL FEE IS COLLECTED (RAZA 2026-09-17). The page has always billed `create + liq + pool`, but only `create`
        // was ever sent anywhere — the $10 pool line was displayed and never charged. lumoscore.com charges
        // `createFee + poolFee` to its collector, and this now matches it.
        var feeXrp = cfg.usd ? ((cfg.usd.create + (cfg.usd.pool || 0)) / rate) : 0;
        var liqXrp = cfg.usd ? (cfg.usd.liq / rate) : 0;

        var v = j && j.result && j.result.info && j.result.info.validated_ledger;
        var reserve = v ? Number(v.reserve_base_xrp) : 1;

        return loadLib().then(function (xrpl) {
          var issuer = xrpl.Wallet.generate();
          // The pool account: generated here, used for this launch only, blackholed by the last step. Nobody keeps its key
          // because nobody can use it afterwards — which is exactly what makes the liquidity permanently locked.
          var pool = xrpl.Wallet.generate();
          var plan = buildLaunchPlan(d, issuer.classicAddress, lxc.address(), reserve, {
            feeXrp: feeXrp, feeCollector: cfg.feeCollector, liquidityXrp: liqXrp,
            pool: pool.classicAddress,
          });

          var userSteps = plan.filter(function (s) { return s.by === 'user'; }).length;

          // CHECKED BEFORE THE FIRST PROMPT, never discovered halfway (lumoscore.com does the same, for the same reason).
          // This launch spends the user's XRP across four separate transactions, and the ledger has no way to undo the ones
          // that already landed: stopping at step 7 leaves a minted token, a funded issuer and no pool. So the whole cost is
          // added up and compared with what the account can actually spend — its balance less the reserve it must keep —
          // before anything is signed.
          var needXrp = plan.reduce(function (sum, s) {
            return sum + ((s.by === 'user' && typeof s.tx.Amount === 'string') ? Number(s.tx.Amount) / 1e6 : 0);
          }, 0) + 0.2 + 0.01;                              // + the user's own trust line reserve, + fees
          return rpc('account_info', { account: lxc.address(), ledger_index: 'validated' }).then(function (ai) {
            var ad = ai && ai.result && ai.result.account_data;
            if (ad) {
              var inc = (v && Number(v.reserve_inc_xrp)) || 0.2;
              var locked = reserve + (Number(ad.OwnerCount) || 0) * inc;
              var spendable = (Number(ad.Balance) || 0) / 1e6 - locked;
              if (spendable < needXrp) {
                running = false;
                status(el, 'Not enough XRP to finish this launch. It needs about <strong>'
                  + needXrp.toFixed(2) + ' XRP</strong> and this account can spend '
                  + Math.max(0, spendable).toFixed(2) + ' (the rest is held as the ledger’s reserve). '
                  + 'Nothing has been sent.');
                throw new Error('__lxxHandled');
              }
            }
            return null;
          }).then(function () {

          // Straight into it. The page above already asked, so this says what is about to happen
          // and then does it -- the wallet's own prompts are the remaining chances to say no.
          var log = [];
          status(el, '<strong>Launching ' + esc(d.name || 'your token') + '</strong> — '
            + plan.length + ' transactions, ' + userSteps + ' of which your wallet will ask you '
            + 'to approve. Keep this tab open.');

          return runLaunch({
              plan: plan,
              onStep: function (i, phase, step) {
                if (phase === 'start') log.push('· ' + esc(step.what) + '…');
                else log[log.length - 1] = '✓ ' + esc(step.what);
                status(el, log.join('<br>'));
              },
              submitUser: function (tx) { return lxc.submit(tx); },
              submitIssuer: function (tx) { return submitIssuerTx(tx, issuer, xrpl); },
              submitPool: function (tx) { return submitIssuerTx(tx, pool, xrpl); },
              waitValidated: waitValidated,
            }).then(function (res) {
              running = false;
              if (res.ok) {
                try {
                  localStorage.setItem('lumos.launch.result', JSON.stringify({
                    ok: true, issuer: issuer.classicAddress, pool: pool.classicAddress,
                    currency: d.currency,
                    ticker: d.ticker, name: d.name, supply: d.supply,
                    hashes: res.completed,
                  }));
                } catch (e) { /* private mode: the page still shows the result below */ }

                // SEND WHAT THE MINTER TYPED TO US, which until now nothing did.
                //
                // The name, description, socials and uploaded logo lived only in this browser's
                // localStorage — the launch flow POSTs to xrplcluster.com and /lxapi/xrplprices and
                // nowhere else — so closing this tab destroyed the only copy of the artwork for a
                // token that now exists forever. Stellar hit this exact wall: "FRANK was minted, the
                // fee arrived, and the asset page showed nothing."
                //
                // AFTER the result is stored and the success message is about to render, and its
                // failure is deliberately silent. The mint is done and irreversible by this point;
                // a metadata POST that fails must never turn a successful launch into an error
                // message. What the user sees is unchanged either way.
                //
                // The endpoint verifies against the FEE payment, which is what ties this submission
                // to a mint that actually paid us. Found by the step's own label, not by index:
                // `completed` holds {what, hash} objects and the fee step is skipped entirely when
                // the fee is zero, so completed[0] is only sometimes the right one — and when it is
                // not, it is the issuer funding payment, which the endpoint would reject with a
                // message about the wrong destination.
                try {
                  var feeHash = '';
                  (res.completed || []).forEach(function (c) {
                    if (c && c.what === 'Pay the launch fee' && c.hash) feeHash = c.hash;
                  });
                  if (feeHash) {
                    fetch('/lxapi/xrplmintmeta', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        code: d.currency, issuer: issuer.classicAddress, txHash: feeHash,
                        name: d.name, description: d.desc || '',
                        website: d.website || '', twitter: d.twitter || '', telegram: d.telegram || '',
                        logo: d.icon || '',
                      }),
                    }).catch(function () {});
                  }
                } catch (e) { /* never block a completed launch */ }

                status(el, log.join('<br>') + '<br><br><strong>Launched.</strong> Issuer '
                  + esc(issuer.classicAddress) + ' is blackholed, so the supply is fixed — and the pool account '
                  + esc(pool.classicAddress) + ' is blackholed too, so the liquidity can never be withdrawn by anyone.');
                return;
              }
              // A PARTIAL LAUNCH IS REPORTED IN FULL. The user's money has gone somewhere and the
              // one thing they must not be told is "something went wrong".
              //
              // The issuer address is shown ONLY when something actually happened. Nothing was
              // funded if the first prompt failed, so handing over an address and calling it "the
              // only record" would be telling the user to safeguard an account that does not exist.
              var tail = res.completed.length
                ? ('<br>The issuing account is <code>' + esc(issuer.classicAddress)
                   + '</code> — keep this, it is the only record of a launch that did not finish.')
                : '<br>Nothing was sent, so nothing was spent.';
              status(el, log.join('<br>') + '<br><br><strong>Stopped: ' + esc(res.error)
                + '</strong><br>' + res.completed.length + ' of ' + plan.length
                + ' transactions completed.' + tail);
            });
          });                                              // ← the affordability gate's chain
        });
      }).catch(function (e) {
        running = false;
        // The gate above has already explained itself on screen; anything else is a genuine failure to start.
        if (e && e.message === '__lxxHandled') return;
        status(el, 'Could not start: ' + esc((e && e.message) || e));
      });
    });
  }

  // ---- who is paying ----------------------------------------------------------------------------
  //
  // The panel shipped the design's mock: "Paying from rrrhDE…EwUw / Balance 842.16 XRP". Both are
  // fiction. It named an account the user does not control and quoted a balance forty times what
  // they actually held, directly above the button that spends it -- so a wallet without enough XRP
  // would still have looked ready to launch.
  function paintWallet() {
    var panel = $('.wallet-info');
    if (!panel) return;
    var lxc = window.lxc;
    var addr = lxc && lxc.address ? lxc.address() : null;

    var addrEl = panel.querySelector('.addr');
    var avEl = panel.querySelector('.av');
    var balEl = panel.querySelector('.balance .val');

    if (!addr) {
      if (addrEl) addrEl.textContent = 'Not connected';
      if (avEl) avEl.textContent = '—';
      if (balEl) balEl.textContent = '—';
      return;
    }

    // Same shape the header uses: six characters, an ellipsis, then four.
    if (addrEl) addrEl.textContent = addr.slice(0, 6) + '…' + addr.slice(-4);
    if (avEl) avEl.textContent = addr.slice(0, 2).toUpperCase();
    if (balEl) balEl.textContent = '…';

    rpc('account_info', { account: addr, ledger_index: 'validated' }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error || !res.account_data) {
        // actNotFound means the account has never been funded, which is a real answer, not an error.
        if (balEl) balEl.textContent = (res && res.error === 'actNotFound') ? '0 XRP' : '—';
        return;
      }
      var drops = Number(res.account_data.Balance);
      var xrp = drops / 1e6;
      if (balEl) balEl.textContent = xrp.toFixed(2) + ' XRP';

      // A launch cannot be part-paid. Warn before the first prompt rather than after two
      // transactions have already gone through.
      var need = Number(window.__lxxLaunchTotalXrp || 0);
      if (need > 0 && xrp < need) {
        var warn = document.createElement('div');
        warn.style.cssText = 'margin-top:8px;font-size:12px;color:#e5484d';
        warn.textContent = 'This launch needs about ' + need.toFixed(2)
          + ' XRP and this wallet holds ' + xrp.toFixed(2) + '.';
        panel.appendChild(warn);
      }
    }).catch(function () { if (balEl) balEl.textContent = '—'; });
  }

  function load() {
    if (!$('.detail-row')) return;                   // not the review page
    paintReview();
    paintWallet();
    wireLaunch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed so the plan and the orchestrator can be inspected and tested without signing anything.
  window.__lxxLaunchPlan = buildLaunchPlan;
  window.__lxxRunLaunch = runLaunch;
  window.__lxxPaintReview = paintReview;
})();
