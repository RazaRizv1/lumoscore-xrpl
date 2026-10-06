// The FAQ block, brought up to the one lumoscore.com ships.
//
// RAZA 2026-10-06: "Pools --> My pools page is not the same as Stellar. I can spot so many
// differences." The table itself was aligned in the previous pass; the FAQ below it is the largest
// remaining piece, and it is on thirty-four page keys rather than just this one.
//
// MEASURED ON BOTH, not guessed — lumoscore.com/pools/stellar against this build:
//
//                 Stellar                                this build
//   heading       36px / 800 / CENTRED / 26px margin     26px, left-aligned
//   each Q&A      a card: 0.8px border, 16px radius,     no card — the pair sits loose in the grid
//                 22px 22px 24px padding
//   question      16.5px / 700, 9px below                inherited
//   answer        14.5px, rgb(165,164,172), 1.7 line     inherited
//   grid gap      18px                                   22px 34px
//
// [[xrpl-inherits-a-frozen-stellar-build]] again: the fork copied Stellar's containers before the FAQ
// was made into cards, and nothing since carried it across.
//
// CSS ONLY, AND THAT IS THE POINT. The first version of this file wrapped each pair in a new
// `.lx-faq-item` and matched nothing, for two reasons worth writing down:
//
//   1. the container is JSON-ESCAPED — attributes read `class=\"lx-faq-q\"`, so a regex written
//      against raw markup never fires. The repo's own lib.js getContents()/re-serialise pattern is
//      how every other transform here avoids that, and this now uses it.
//   2. the pair is ALREADY wrapped: `<div><h3 class="lx-faq-q">…</h3><p class="lx-faq-a">…</p></div>`.
//      Stellar's wrapper simply carries a class. There was never an element to add — only rules to
//      write, against `.lx-faq-grid > div`.
//
// So nothing in the markup changes, which also makes this idempotent for free: the stylesheet is
// stripped by id and re-inserted, never appended to.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const ID = 'lx-faqcard';
const B = String.fromCharCode(92);

// SPECIFICITY, NOT ORDER. Measured after the first deploy: the card rules landed (nothing else claims
// `.lx-faq-grid>div`) while the heading stayed 26px and the gap stayed `22px 34px` — both tied with an
// inherited rule at `.lx-faq h2` / `.lx-faq-grid`, and `_externalize.js` hoists every `lx-*` sheet into
// <head>, so source order decides nothing. `section.lx-faq` and the doubled class break the tie.
const CSS = '<style id="' + ID + '">'
  + 'section.lx-faq h2{text-align:center;font-size:36px;font-weight:800;margin-bottom:26px}'
  + 'section.lx-faq .lx-faq-grid{gap:18px}'
  // `> div` rather than a class, because the wrapper this build ships has none — see the note above.
  + '.lx-faq-grid>div{border:1px solid var(--border,#26262c);border-radius:16px;padding:22px 22px 24px}'
  + '.lx-faq-grid>div>.lx-faq-q{font-size:16.5px;font-weight:700;margin:0 0 9px}'
  + '.lx-faq-grid>div>.lx-faq-a{font-size:14.5px;line-height:1.7;color:var(--text-muted,#a5a4ac);margin:0}'
  + '</' + 'style>';

let files = 0, pages = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    if (typeof json[k] !== 'string') continue;
    let h = json[k];
    if (h.indexOf('lx-faq-grid') < 0) continue;              // no FAQ on this page key
    const before = h;

    // Strip this file's own previous copy rather than adding a second — a stale rule otherwise wins
    // on source order. See the duplicate-stylesheet note in the chain.
    h = h.replace(new RegExp('<style id="' + ID + '">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g'), '');

    // Last in the head, so these outrank the inherited Stellar FAQ rules for the same nodes.
    if (h.indexOf('</head>') >= 0) h = h.replace('</head>', CSS + '</head>');
    else h = CSS + h;

    if (h !== before) { json[k] = h; pages++; }
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl faq cards: stylesheet on ' + pages + ' page key(s) across ' + files + ' container(s)');
