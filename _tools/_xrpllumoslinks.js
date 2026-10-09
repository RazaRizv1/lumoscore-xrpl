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
  ['eco',    '/pools/xrpl'],     // Ecosystem LP Rewards -- "View partner pools" means the pools list
  ['whale',  '/rewards/xrpl'],   // Whale Holder Rewards -- eligibility and schedule live on rewards
];
const DEAD = '<a class="u-link" href="#"';

let containers = 0, pages = 0, wired = 0;
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

    for (const [cls, href] of CARD_LINKS) {
      const at = p.indexOf('<div class="util-card ' + cls + '"');
      // A card that is not on this page key is not a fault -- the mobile build carries a subset --
      // but a card that IS here and keeps a dead link is, so only the second case is reported.
      if (at < 0) continue;
      const rel = p.indexOf(DEAD, at);
      if (rel > at && rel - at < 4000) {
        p = p.slice(0, rel) + '<a class="u-link" href="' + href + '"' + p.slice(rel + DEAD.length);
        wired++;
      } else if (p.indexOf('<a class="u-link" href="/', at) < 0) {
        missing.push(k + ':' + cls);
      }
    }

    if (p !== before) { json[k] = p; changed = true; pages++; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl LUMOS links: ' + wired + ' card link(s) wired across ' + pages
  + ' page key(s) in ' + containers + ' container(s)'
  + (missing.length ? ' | STILL DEAD: ' + missing.join(' ') : ''));
