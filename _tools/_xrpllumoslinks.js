// The four "What you can do with LUMOS" card links, which went nowhere.
//
// Each card on the LUMOS page ends in an <a class="u-link" href="#">: "Learn how it works", "View
// reward programs", "View partner pools", "Eligibility & schedule". A mobile audit on 2026-10-09
// found these are the ONLY dead links on this page that a phone user can actually see and tap --
// clicked on the deployed build first, and every one was inert: no navigation, no scroll, no
// overlay. The other dead links on trade and pools are hidden markup inside collapsed hero blocks,
// so they are left alone.
//
// Stellar's copy of this page is fixed in _lumosutility.js, which already owned that section. This
// repo has no equivalent -- _xrplseo.js and extract_site.js are the only tools that touch the page,
// and neither is a home for card links -- so the XRPL half lives here, deliberately as its own small
// transform rather than bolted onto something unrelated.
//
// DESTINATIONS confirmed by RAZA 2026-10-09, chosen per card rather than sent somewhere generic, and
// staying on the chain the reader is already on. /docs is shared between both builds, so the fee card
// points at the same page either way.
//
// href="#" is part of the match, so a second run is a no-op rather than a second rewrite.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const KEYS = ['lumoscore-lumos-token.html', 'lumoscore-lumos-token-dark.html', 'lumoscore-lumos-token-mobile.html'];
const CARD_LINKS = [
  ['fee',    '/docs/fees'],      // Trading fee waivers -- the fee schedule IS the documentation for it
  ['native', '/rewards/xrpl'],   // Native LP Rewards
  // RAZA 2026-11-13: 'instead of calling it "View partner pools", make it "View Ecosystem LP Pools"
  // and link it to pools main page -> Rewarded pools tab.' That tab IS this card's ten tokens, so the
  // link lands on it rather than on All Pools. ?tab=rewarded is read by lx-xrplpools on the pools
  // page, which also accepts #rewarded. Mirrors Stellar's _lumosutility.js exactly.
  //
  // RENAMED AGAIN the same day: 'instead call it "View Rewarded pools" because that's what it
  // redirects to. and that also contain Native LP pool at the top so we cant say that its Ecosystem
  // LP pools.' Correct -- the Rewarded tab leads with the native LUMOS pool and then the ten
  // ecosystem ones, so the old label mis-stated where the link lands. The LABEL names the
  // destination; the CARD still names the programme.
  //
  // THE OLD LABEL IS A LIST, NOT A STRING: the relabel matches exact old text, so one spelling is a
  // no-op against containers already carrying the previous rename. Both stay until a base holding
  // the oldest is provably gone -- _xrplcopy2.js keeps both spellings for the same reason.
  ['eco',    '/pools/xrpl?tab=rewarded',
             ['View partner pools', 'View Ecosystem LP Pools'], 'View Rewarded Pools'],
  ['whale',  '/rewards/xrpl'],   // Whale Holder Rewards -- eligibility and schedule live on rewards
];
const DEAD = '<a class="u-link" href="#"';

// ---- the Ecosystem LP Rewards list ------------------------------------------------------------
//
// RAZA 2026-11-13: "On both Stellar and XRPL LUMOS token page, make the Ecosystem LP rewards like
// its made on near", then "the asset and stuff will be from Stellar and XRPL obviously". NEAR grew
// this list first (its ticket 270); Stellar's half is in _lumosutility.js. Same card, same row,
// this ledger's own assets.
//
// THE LIST IS THE REWARDED POOLS' PARTNER ASSETS -- not a volume ranking. Corrected 2026-11-13
// after RAZA: "fix the eco card asset list on both chains". Stellar's half had the identical fault
// and is fixed the same way in _lumosutility.js.
//
// What was wrong, and it was worse here than on Stellar. The first version took the ten tickers
// /lxapi/xrpltokens publishes by 24h volume. The card says "Pair any partner token with LUMOS in a
// curated pool and earn boosted rewards" and links to /pools/xrpl?tab=rewarded -- and SEVEN of those
// ten (FUZZY, BCHAMP, Chubs, ARMY, Opulence, DROP, PHNIX) have no rewarded LUMOS pool at all. The
// card was advertising boosted rewards for pairs a reader cannot make, and omitting seven that exist.
//
// WHERE THESE TEN COME FROM. `var RW` in _tools/browser/pools.js is the rewarded tab's eleven pools.
// The first is the NATIVE pool (XRP on this ledger, XLM on Stellar), which sits at the top of that
// tab and is not an "ecosystem" pool -- the same distinction RAZA drew when renaming the link to
// "View Rewarded Pools". Eleven minus the native one is ten, the row count this card was built for,
// and the order below is RW's order so the card and its destination read the same way.
//
// Copied from RW, field for field -- ticker, currency, issuer -- NOT re-derived from a token search,
// because the pool's own entry is what the rewarded tab resolves against. The three tickers that
// survive from the old list (RLUSD, USDC, XAH) came back with byte-identical currency and issuer,
// which is the cross-check that the two sources agree.
//
// It moves when the rewarded set moves: if `var RW` in browser/pools.js changes, change this with
// it. Nothing computes one from the other.
//
// CURRENCY IS THE HEX where the token uses one, because that is what the ledger and the thumbnail
// endpoint key on; the ticker is only the display name, and [[lumoscore-xrpl-hostile-input]] is why
// it is escaped rather than trusted. On the tick each row paints, see the note under Stellar's ECO:
// it has no per-asset test behind it on either chain, which is RAZA's call, not this file's.
//   ticker, 40-char currency (or the 3-char code where the token uses one), issuer
const ECO = [
  ['RLUSD',  '524C555344000000000000000000000000000000', 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'],
  ['USDC',   '5553444300000000000000000000000000000000', 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'],
  ['SHX',    'SHX',                                      'rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw'],
  ['XPM',    'XPM',                                      'rXPMxBeefHGxx2K7g5qmmWq3gFsgawkoa'],
  ['XLM',    'XLM',                                      'rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y'],
  ['USDT',   '5553445400000000000000000000000000000000', 'rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq'],
  ['XDawgs', '5844617767730000000000000000000000000000', 'raKhUVtNw6B892bKtATUT3frX35oawfsey'],
  ['666',    '666',                                      'rhvf9fe6PP3GC8Bku2Ug7iQPjPDxYZfrxN'],
  ['FLR',    'FLR',                                      'rcxJwVnftZzXqyH9YheB8TgeiZUhNo1Eu'],
  ['XAH',    'XAH',                                      'rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv'],
];

// THE SAME LITERALS STELLAR USES, deliberately. This repo's containers are a copy of a BUILT
// Stellar page ([[xrpl-inherits-a-frozen-stellar-build]]), so the day that copy is refreshed it
// will arrive carrying STELLAR'S ten assets in this exact wrapper. Matching the literals means the
// strip below removes them and this transform writes XRPL's over the top, instead of the page
// quietly shipping the wrong chain's list.
const ECO_OPEN = '<div class="lxu-eco-list">';
const ECO_END = '<span class="lxu-eco-end"></span></div>';
const ECO_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" '
  + 'stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
// The logo-healer opt-out, and it has to be BOTH. Two healers ship on this page and they test
// different things: the first bails on data-logoed, the second only on a child img/svg/[data-logo].
// A rank reading "#1" and a ticker reading "ARMY" are both 1-5 characters, which is exactly what the
// second one eats -- it stamps a logo over the text and empties the cell for the life of the page.
// The 0x0 svg is the one that always works, because that test runs before the text test.
const NOLOGO = ' data-logoed="1"';
const NOLOGO_SVG = '<svg width="0" height="0" aria-hidden="true" focusable="false"></svg>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shortIss = (a) => (String(a).length > 24 ? String(a).slice(0, 8) + '…' + String(a).slice(-6) : String(a));

function ecoList() {
  let h = ECO_OPEN;
  ECO.forEach(([name, cur, iss], i) => {
    // /trade/xrpl/<TICKER>-<ISSUER>, as browser/trade.js and browser/search.js build it.
    const href = '/trade/xrpl/' + encodeURIComponent(name + '-' + iss);
    // Our own origin. xrplthumb holds the upstream key and its own corrections for tokens whose
    // upstream artwork is wrong, so this is the one URL on the page that cannot go stale on us.
    const logo = '/lxapi/xrplthumb?iss=' + encodeURIComponent(iss) + '&cur=' + encodeURIComponent(cur) + '&w=48';
    h += '<a class="lxu-eco-row" href="' + esc(href) + '">'
      + '<span class="lxu-eco-rk"' + NOLOGO + '>#' + (i + 1) + NOLOGO_SVG + '</span>'
      + '<span class="lxu-eco-ic" data-lxc="' + esc(name) + '"' + NOLOGO + '>'
      + '<img src="' + esc(logo) + '" alt="" loading="lazy" '
      + 'onerror="this.onerror=null;this.style.visibility=&quot;hidden&quot;">'
      + '</span>'
      + '<span class="lxu-eco-tx">'
      + '<span class="lxu-eco-tk"' + NOLOGO + '><span' + NOLOGO + '>' + esc(name) + NOLOGO_SVG + '</span>'
      + '<span class="lxu-eco-vt" title="Verified token" aria-label="Verified token">' + ECO_TICK + '</span></span>'
      + '<span class="lxu-eco-id" title="' + esc(iss) + '">' + esc(shortIss(iss)) + '</span>'
      + '</span></a>';
  });
  return h + ECO_END;
}

// ITS OWN SHEET, not Stellar's. The inherited lx-lumosutil-css in these containers was copied before
// this card existed, so nothing in it styles these rows; and when that copy is refreshed, the two
// sheets declare the same rules with the same values, so either order paints the same card.
const CSS_ID = 'lx-xrpllumoseco-css';
const STYLE = '<style id="' + CSS_ID + '">'
  // Ten rows in a three-across band would stretch Native and Whale for no reason, so the Ecosystem
  // card takes the two right columns with the other two stacked beside it. 861px is the inherited
  // grid's own breakpoint -- below it the grid is one column, so this must not apply there.
  + '@media(min-width:861px){.utility-grid .util-card.native,.utility-grid .util-card.whale{grid-column:1}'
  + '.utility-grid .util-card.eco{grid-column:2/-1;grid-row:span 2}}'
  // Down the columns, not across: 1-5 then 6-10, so the ranks read in order.
  + '.lxu-eco-list{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,auto);'
  + 'grid-auto-flow:column;column-gap:22px;margin:6px 0 14px}'
  + '.lxu-eco-row{display:flex;align-items:center;gap:12px;padding:10px 4px;min-width:0;'
  + 'border-top:1px solid var(--border);text-decoration:none;color:inherit}'
  + '.lxu-eco-row:nth-child(5n+1){border-top:0}'
  + '.lxu-eco-row:hover .lxu-eco-tk{color:var(--accent,#ea6a2c)}'
  + '.lxu-eco-rk{flex:0 0 30px;font:700 12.5px/1 \'JetBrains Mono\',monospace;color:var(--text-soft)}'
  + '.lxu-eco-ic{flex:0 0 30px;width:30px;height:30px;border-radius:50%;overflow:hidden;background:var(--bg)}'
  + '.lxu-eco-ic img{width:100%;height:100%;object-fit:cover;display:block;border-radius:50%}'
  + '.lxu-eco-tx{display:flex;flex-direction:column;gap:3px;min-width:0}'
  + '.lxu-eco-tk{display:flex;align-items:center;gap:6px;font-size:15.5px;font-weight:800;color:var(--text)}'
  + '.lxu-eco-vt{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;'
  + 'flex:0 0 15px;border-radius:50%;background:var(--accent,#ea6a2c);color:#fff}'
  + '.lxu-eco-vt svg{width:10px;height:10px}'
  + '.lxu-eco-id{font:500 12.5px/1.2 \'JetBrains Mono\',monospace;color:var(--text-soft);'
  + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.lxu-eco-end{display:none}'
  // One column once two would squeeze the issuer out of its own row.
  + '@media(max-width:980px){.lxu-eco-list{display:block}'
  + '.lxu-eco-row:nth-child(5n+1){border-top:1px solid var(--border)}'
  + '.lxu-eco-row:first-child{border-top:0}}'
  + '</style>';

// A CARD ENDS WHERE THE NEXT ONE BEGINS, and every search inside a card is bounded by that.
// "Within 4000 characters of the card's opening tag" is not the same thing: once a card's own link
// is already wired, a search for the next dead one simply walks into the following cards. The
// 4000 cap is kept as a backstop for the last card on the page, which has no successor.
function cardEnd(p, at) {
  const next = p.indexOf('<div class="util-card', at + 1);
  const cap = at + 4000;
  return next > at ? Math.min(next, cap) : cap;
}
// REPAIR. This file last ran on 2026-10-09 and wired its four cards; re-running it on 2026-11-13
// for the ecosystem list wired a FIFTH, because with all four already done each unbounded search
// walked past its own card to the first href="#" left on the page -- the Governance card's "Read
// the proposal", which stays dead until there is a proposal to read. The bound above stops it
// recurring; this undoes what is already in the containers. Keyed on the LABEL as well as the href,
// so the fee card's own "/docs/fees" is not matched. Stellar's _lumosutility.js carries the same
// pair of fixes: it is the same code and it shipped the same bug.
const MISWIRED = [['Read the proposal', '/docs/fees']];

let containers = 0, pages = 0, wired = 0, listed = 0, repaired = 0, relabelled = 0;
const missing = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of KEYS) {
    if (!json[k]) continue;
    let p = json[k];
    const before = p;

    // Idempotence: our own sheet by id, and any list in this wrapper -- ours from a previous run, or
    // Stellar's if these containers have since been refreshed from a newer Stellar build. Bounded by
    // a literal rather than a regex, because the regex that stripped the fee figure in Stellar's copy
    // of this page once ran forward and ate everything up to the next pair of closing divs.
    p = p.replace(new RegExp('<style id="' + CSS_ID + '">[\\s\\S]*?<\\/style>', 'g'), '');
    for (;;) {
      const a = p.indexOf(ECO_OPEN);
      if (a < 0) break;
      const z = p.indexOf(ECO_END, a);
      if (z < 0) break;
      p = p.slice(0, a) + p.slice(z + ECO_END.length);
    }

    for (const [label, href] of MISWIRED) {
      const bad = '<a class="u-link" href="' + href + '">' + label;
      if (p.indexOf(bad) >= 0) { p = p.split(bad).join('<a class="u-link" href="#">' + label); repaired++; }
    }

    // RE-POINTABLE, NOT ONE-SHOT. Matching only href="#" made this idempotent but un-editable: once a
    // card was wired, changing CARD_LINKS had no effect on an already-built container, because a
    // re-run found no dead link and did nothing. It now rewrites whatever href the card's own anchor
    // carries, which is idempotent in the stronger sense -- same result however often it runs.
    // Everything stays inside this card's bounds; a past re-run on this page wired the WRONG card by
    // searching past them.
    for (const [cls, href, oldLabel, newLabel] of CARD_LINKS) {
      const at = p.indexOf('<div class="util-card ' + cls + '"');
      // A card that is not on this page key is not a fault -- the mobile build carries a subset --
      // but a card that IS here and keeps a dead link is, so only the second case is reported.
      if (at < 0) continue;
      const end = cardEnd(p, at);
      const rel = p.indexOf('<a class="u-link" href="', at);
      if (rel < at || rel >= end) { missing.push(k + ':' + cls); continue; }
      const qs = rel + '<a class="u-link" href="'.length;
      const qe = p.indexOf('"', qs);
      if (qe < 0 || qe >= end) { missing.push(k + ':' + cls); continue; }
      if (p.slice(qs, qe) !== href) { p = p.slice(0, qs) + href + p.slice(qe); wired++; }
      // oldLabel may be a LIST -- every previous name this link has had. A card renamed twice has
      // containers in either state, and an anchor on one spelling silently misses the other.
      if (oldLabel && newLabel) {
        const e2 = cardEnd(p, at);
        for (const was of [].concat(oldLabel)) {
          if (was === newLabel) continue;
          const li = p.indexOf(was, rel);
          if (li > rel && li < e2) {
            p = p.slice(0, li) + newLabel + p.slice(li + was.length); relabelled++; break;
          }
        }
      }
    }

    // The ten curated tokens, inside the Ecosystem card, under its own heading and copy and above
    // "View partner pools" -- where NEAR and Stellar put them. Static markup, not a runtime build: a
    // fixed list has nothing to wait for, so there is no first-paint reshuffle and the rows are in
    // the page a crawler reads. Only the logos are fetched, by the browser, from our own origin.
    {
      const at = p.indexOf('<div class="util-card eco"');
      if (at < 0) missing.push(k + ':eco-list');
      else {
        const link = p.indexOf('<a class="u-link"', at);
        if (link > at && link < cardEnd(p, at)) { p = p.slice(0, link) + ecoList() + p.slice(link); listed++; }
        else missing.push(k + ':eco-list');
      }
    }

    if (p.indexOf('</head>') >= 0) p = p.replace('</head>', STYLE + '</head>');
    if (p !== before) { json[k] = p; changed = true; pages++; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl LUMOS links: ' + wired + ' card link(s) wired, ' + relabelled + ' relabelled, ' + repaired + ' mis-wired link(s) repaired, '
  + listed + ' ecosystem list(s) of '
  + ECO.length + ', across ' + pages
  + ' page key(s) in ' + containers + ' container(s)'
  + (missing.length ? ' | STILL DEAD: ' + missing.join(' ') : ''));
