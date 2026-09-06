// The card-reveal driver, restored.
//
// THE BUG THIS FIXES. Every page carries a "subtle motion layer":
//
//     @media (prefers-reduced-motion: no-preference) {
//       html.lcm-ready .quick-card:not([data-lcm-done]) { opacity:0; transform:translateY(8px) }
//       html.lcm-ready .quick-card.lcm-on              { opacity:1; transform:none }
//     }
//
// Cards start INVISIBLE and are revealed by a script that adds .lcm-on and then stamps
// data-lcm-done, which permanently exempts the card from the hiding rule. On nine pages of this
// fork -- Dashboard, Trade, Pools, Bridge and Rewards, in both themes -- the `lcm-ready` class is
// still set and the CSS is still there, but the driver is gone. It lived inside the big Stellar
// data bundles that were stripped out.
//
// The result is a page that is perfect in the DOM and blank on screen: correct text, correct
// numbers, correct colours, no console error, `display:block`, `visibility:visible` -- and
// `opacity:0`. On the dashboard that hid the trending list, the activity feed and all four quick
// actions at once, while every DOM assertion passed. This is the same failure that caused the
// 2026-08-14 outage; see [[verify-on-production]].
//
// This is the design's own driver, restored in the same shape rather than reinvented, so the
// staggered entrance still looks the way it was drawn.
(function () {
  if (window.__lxxReveal) return;
  window.__lxxReveal = 1;

  // Not a page with the motion layer, or the reader asked for reduced motion -- in which case the
  // CSS never hides anything and there is nothing to reveal.
  if (!document.documentElement.classList.contains('lcm-ready')) return;

  var SEL = '.kpi-card, .quick-card, .product-card, .market-card, .activity-card';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var all = [].slice.call(document.querySelectorAll(SEL));
    if (!all.length) return;

    function done(el) { el.setAttribute('data-lcm-done', '1'); }

    // THE SAFETY NET, and the reason this file cannot make things worse: whatever happens above,
    // every card is marked done after 2.6s. A reveal that never fires leaves cards visible rather
    // than invisible, which is the failure mode worth having.
    setTimeout(function () {
      all.forEach(function (el) { if (!el.hasAttribute('data-lcm-done')) done(el); });
    }, 2600);

    if (!window.IntersectionObserver) { all.forEach(done); return; }

    // A card that is hidden for its own reasons (a closed tab panel) must not be animated -- it
    // would burn its reveal while off screen and appear without one later.
    var targets = all.filter(function (el) {
      if (el.hasAttribute('hidden')) return false;
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    all.forEach(function (el) { if (targets.indexOf(el) < 0) done(el); });

    function reveal(el, delay) {
      setTimeout(function () {
        el.classList.add('lcm-on');
        // Stamp done once the transition has run, then drop the class: from here the card is
        // exempt from the hiding rule outright, so nothing can hide it again.
        setTimeout(function () { done(el); el.classList.remove('lcm-on'); }, 720);
      }, delay);
    }

    function inViewport(el) {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      return r.top < vh && r.bottom > 0;
    }

    var idx = 0, deferred = [];
    targets.forEach(function (el) {
      if (inViewport(el)) { reveal(el, idx * 55 + 40); idx++; } else { deferred.push(el); }
    });
    if (!deferred.length) return;

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { reveal(e.target, 0); obs.unobserve(e.target); }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
    deferred.forEach(function (el) { obs.observe(el); });
  });
})();
