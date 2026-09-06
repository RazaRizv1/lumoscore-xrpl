// The launch review page, and the transactions a launch is actually made of.
//
// TWO PROBLEMS ON THIS PAGE.
//
// 1. It showed the DESIGN'S MOCK regardless of what was typed: "XRP Ledger Coin", ticker "$XRP",
//    "t.me/solarflare", a supply of 1,000,000,000 -- and a description about "the chaotic energy of
//    solar storms". A review step whose whole purpose is "double-check everything below" was
//    showing somebody else's token.
//
// 2. "Confirm & Launch" was a plain <a href="/xrpl/launchpad/confirm">. It navigated to the success
//    page -- confetti, share buttons, the lot -- having issued nothing at all. That is worse than a
//    broken button: it tells the user they own a token that does not exist.
//
// This file fixes (1) outright and makes (2) honest. It also builds the exact transaction sequence a
// launch consists of, so the plan can be inspected and tested before anything is signed.
//
// WHAT IS STILL MISSING, and it is not this file's to solve: nothing in this project can sign a
// transaction with the USER's wallet yet. connect.js reads an address from GemWallet or Xaman and
// stops there -- window.lxc has open/address/wallet/transport/disconnect and no sign(). A launch
// needs four user-signed transactions, so until that layer exists the button explains rather than
// pretends. See buildLaunchPlan() for the sequence it will drive.
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

    var name = $('.hero-name');
    if (name) name.textContent = d.name || '—';
    var desc = $('.hero-desc');
    if (desc) desc.textContent = d.desc || '';

    setRow('token name', d.name || '—');
    setRow('ticker', '$' + ticker);
    setRow('project type', d.type === 'utility' ? 'Utility Project' : 'Meme Project');
    setRow('description', d.desc || 'Not provided');

    // The icon row shipped a mock filename -- "icon-slr.png · 142 KB" -- next to a preview of a
    // token nobody uploaded. Nothing carries an icon through the draft yet, so it says so.
    setRow('icon', d.icon || 'Not provided', true);

    setRow('total supply', group(supply) + ' ' + ticker);
    setRow('your share', share == null ? '—' : (share + '% (' + group(yours) + ' ' + ticker + ')'));
    setRow('liquidity pool share',
      lpShare == null ? '—' : (lpShare + '% (' + group(pool) + ' ' + ticker + ')'));

    // The issuer is blackholed at the end of the launch, so this row is a promise the flow keeps.
    setRow('issuer locked', 'Yes — supply is fixed');

    var extra = num(d.extra);
    setRow('extra xrp', (extra && extra > 0)
      ? (group(extra) + ' XRP added to the pool')
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
  function buildLaunchPlan(d, issuer, user, reserveXrp) {
    var cur = d.currency;
    var supply = String(d.supply);

    // The issuer needs the base reserve to exist at all, plus its own transaction fees. Whatever is
    // sent here is locked forever once the account is blackholed, so it is funded to the minimum
    // rather than rounded up.
    var fund = (reserveXrp == null ? 1 : reserveXrp) + 0.5;

    return [
      { by: 'user', what: 'Fund the issuing account',
        tx: { TransactionType: 'Payment', Account: user, Destination: issuer,
              Amount: String(Math.round(fund * 1e6)) } },

      { by: 'issuer', what: 'Enable rippling and set the domain',
        // 8 = asfDefaultRipple. Domain is hex of the ASCII host, which is what makes the token
        // verifiable against the xrp-ledger.toml served from that domain.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 8,
              Domain: hexAscii('lumoscore.com') } },

      { by: 'user', what: 'Trust the new token',
        tx: { TransactionType: 'TrustSet', Account: user,
              LimitAmount: { currency: cur, issuer: issuer, value: supply } } },

      { by: 'issuer', what: 'Mint the full supply to you',
        tx: { TransactionType: 'Payment', Account: issuer, Destination: user,
              Amount: { currency: cur, issuer: issuer, value: supply } } },

      { by: 'issuer', what: 'Hand over the issuer key',
        tx: { TransactionType: 'SetRegularKey', Account: issuer, RegularKey: BLACKHOLE_KEY } },

      { by: 'issuer', what: 'Disable the issuer permanently',
        // 4 = asfDisableMaster. After this nothing can ever sign for the issuer again, so the
        // supply minted above is the supply forever.
        tx: { TransactionType: 'AccountSet', Account: issuer, SetFlag: 4 } },
    ];
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

  function explain(anchor) {
    var box = $('#lxxMintNote');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'lxxMintNote';
    box.style.cssText = 'margin:12px 0;padding:12px 14px;border-radius:12px;font-size:13px;'
      + 'line-height:1.55;color:var(--text-muted,#6b6b76);background:var(--surface-2,rgba(127,127,127,.07));'
      + 'border:1px solid var(--border,rgba(127,127,127,.22))';
    box.textContent = 'Launching is not live yet. Signing transactions with a connected wallet is '
      + 'still being built, and this button will not issue a token until it is — so it no longer '
      + 'takes you to a success page.';
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(box, anchor);
    return box;
  }

  function wireLaunch() {
    var el = $$('a, button').filter(function (e) {
      return /confirm\s*&\s*launch/i.test(e.textContent || '');
    })[0];
    if (!el) return;

    // THE LINK IS NEUTRALISED, not merely intercepted. Leaving the href in place means a
    // middle-click, a right-click "open in new tab", or a keyboard activation still reaches the
    // success page behind the handler's back.
    if (el.tagName === 'A') { el.removeAttribute('href'); el.setAttribute('role', 'button'); }
    el.setAttribute('aria-disabled', 'true');
    el.style.opacity = '.6';
    el.style.cursor = 'not-allowed';

    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      explain(el);
    });
  }

  function load() {
    if (!$('.detail-row')) return;                   // not the review page
    paintReview();
    wireLaunch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  // Exposed so the plan can be inspected and tested without signing anything.
  window.__lxxLaunchPlan = buildLaunchPlan;
  window.__lxxPaintReview = paintReview;
})();
