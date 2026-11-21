// The XRP Ledger's "How it works" dialog for the Launchpad.
//
// Stellar's _launchhiw.js writes a layer under this same id into its own launch-token page, and the
// fork copies Stellar's BUILT output -- so the risk this file exists to remove is an XRP Ledger
// launcher being told about XLM, Stellar trustlines, a home domain set by setOptions, and a pool fee
// "fixed at the protocol level at 0.30%". None of that is true here. Copy passes never reach script
// bodies, which is exactly how the bridge dialog once explained Circle CCTP to XRPL users
// ([[lumoscore-xrpl-wrong-chain-copy]], _xrplbridgehiw.js).
//
// _xrplaunchhiw.js strips that id and injects this body, with a byte-identical stylesheet, on the
// fork's own launch-token pages. The id is never spelled out as a literal opening tag anywhere in
// this file: such a tag inside a script body is legal -- only a CLOSING one ends the element -- but
// it makes every byte-counting check report one more layer than the page actually has, which is what
// it did on this file's first run.
//
// SHORT, AND IN THE READER'S WORDS. The first version walked the whole plan -- twelve transactions,
// two generated throwaway accounts, DefaultRipple, AMMCreate's TradingFee, SetRegularKey then
// DisableMaster on both accounts, the per-account ledger reserves. RAZA 2026-11-01, reading Stellar's
// equivalent on staging: "too much info for the user. please keep it short and to the point. The user
// doesn't need to know that throughaway wallets are created bla bla bla, he wont even understand it."
// Cut on both chains the same day, because a copy rule is platform-wide the same way a privacy call is
// ([[lumoscore-prod-release-20261027]]).
//
// EVERY CLAIM LEFT IS STILL READ FROM THIS FORK'S LAUNCH CODE, and the figures are the fork's, not
// Stellar's -- that is why this file exists at all:
//   4 wallet prompts                      browser/mint.js buildLaunchPlan -- the user signs four of
//                                         the twelve; the rest are signed on the page. "Four" is the
//                                         only one of those two numbers a launcher experiences.
//   AMM pool, not a Stellar liquidity     step 9 AMMCreate
//   share cap 30%                         browser/launchpad.js:573
//   $5 / $10 / $10 = $25, paid in XRP     browser/launchpad.js USD, real pricing (test pricing is OFF)
//   liquidity can never be withdrawn      steps 10-13 blackhole BOTH accounts, the pool account among
//                                         them, so the pool's only LP can never pull out
//
// NO TIMING CLAIM anywhere, same rule as the bridge dialog.
//
// Typographic marks are HTML entities on purpose: this body is embedded in a JSON container and an
// entity survives the escaping layers untouched. See [[template-literal-eats-escapes]].
(function () {
  if (window.__lxLhiw) return; window.__lxLhiw = 1;

  var TITLE = 'How an XRP Ledger launch works';

  var LEDE = 'Issue your own token on the XRP Ledger and open its first AMM pool &#8212; no code, and '
    + 'no contract to deploy. Your wallet approves <b>four transactions</b>.';

  var STEPS = [
    ['Set it up',
     'Name, ticker, logo, and how much of the supply you keep &#8212; up to 30%. The rest goes into '
     + 'the pool.'],
    ['Pay $25',
     '$5 to create the token, $10 of liquidity, $10 for the pool and network. Paid in XRP at the '
     + 'current rate.'],
    ['Your token goes live',
     'The supply is created, your share lands in your wallet, and the rest opens an AMM pool so people '
     + 'can trade it straight away.'],
    ['It locks',
     'The supply is fixed forever &#8212; no more can ever be made.'],
  ];

  var NOTE = '<b>Your $10 of liquidity stays in the pool for good.</b> Nobody can take it out '
    + '&#8212; not you, and not us. That is what stops a token launched here being rugged.';

  var CLOSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>'
    + '<line x1="6" y1="6" x2="18" y2="18"/><' + '/svg>';

  var el = null, trigger = null;

  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'lx-lhiw'; el.setAttribute('hidden', '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', TITLE);
    var steps = '';
    for (var i = 0; i < STEPS.length; i++) {
      steps += '<li data-n="' + (i + 1) + '"><h4>' + STEPS[i][0] + '<' + '/h4><p>' + STEPS[i][1] + '<' + '/p><' + '/li>';
    }
    el.innerHTML = '<div class="lx-lhiw-bd" data-lxlhiw-close><' + '/div>'
      + '<div class="lx-lhiw-card">'
      + '<div class="lx-lhiw-head"><h3>' + TITLE + '<' + '/h3>'
      + '<button class="lx-lhiw-x" type="button" aria-label="Close" data-lxlhiw-close>' + CLOSE + '<' + '/button><' + '/div>'
      + '<div class="lx-lhiw-body">'
      + '<p class="lx-lhiw-lede">' + LEDE + '<' + '/p>'
      + '<ol class="lx-lhiw-steps">' + steps + '<' + '/ol>'
      + '<div class="lx-lhiw-note">' + NOTE + '<' + '/div>'
      + '<' + '/div><' + '/div>';
    document.body.appendChild(el);
    return el;
  }

  function open() {
    build(); el.removeAttribute('hidden');
    try { el.querySelector('.lx-lhiw-card').scrollTop = 0; } catch (_) {}
    try { el.__lxOvf = document.body.style.overflow; document.body.style.overflow = 'hidden'; } catch (_) {}
    try { el.querySelector('.lx-lhiw-x').focus(); } catch (_) {}
  }

  function close() {
    if (!el) return;
    el.setAttribute('hidden', '');
    try { document.body.style.overflow = el.__lxOvf || ''; } catch (_) {}
    try { if (trigger && trigger.focus) trigger.focus(); } catch (_) {}
  }

  // Matched by data attribute first, then by what the control says: the link is injected at request
  // time by Stellar's middleware, which is deployed from the same build but not necessarily at the
  // same moment as this page.
  window.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest('[data-lxlhiw-close]')) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    var hit = t.closest('[data-lxlhiw]');
    if (!hit) {
      var b = t.closest('a,button');
      if (b && /how it works/i.test(b.textContent || '')) hit = b;
    }
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); trigger = hit; open(); }
  }, true);

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.keyCode === 27) close(); });
})();
