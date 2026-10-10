// The FAQ block, brought up to the one lumoscore.com ships — by PORTING ITS STYLESHEET, not by
// writing a lookalike.
//
// RAZA 2026-10-06: "FAQs are designed better on Stellar. XRPL is using outdated design for FAQs."
// He is right, and the first version of this file made it worse in an instructive way.
//
// WHAT IS ACTUALLY WRONG. This build already carries `<style id="lx-faq-css">` — but the FROZEN copy
// of it, from before Stellar turned each Q&A into a card. Measured against lumoscore.com's current
// block, the inherited one has no `.lx-faq-item` rule at all and no `?` badge: just
// `.lx-faq-q{font-size:16px…}` and `.lx-faq-a{…}`. [[xrpl-inherits-a-frozen-stellar-build]] — the
// fork copied the containers at a moment, and everything after it is silently absent.
//
// The markup half is the same story. Stellar emits
//     <div class="lx-faq-item"><h3 class="lx-faq-q">…</h3><p class="lx-faq-a">…</p></div>
// and this build emits the same thing WITHOUT the class — so even the rules it does have for the
// card land on nothing.
//
// WHY THE FIRST VERSION WAS WRONG. It left both of those alone and wrote fresh rules against
// `.lx-faq-grid>div`, approximating the card from a screenshot: border, radius, padding, and
// nothing else. That is how the badge went missing — nobody had decided to leave it out. A lookalike
// also has to be re-derived every time Stellar's FAQ changes, while a port is re-copyable.
//
// So this now does two things and keeps no CSS of its own:
//   1. replaces the `lx-faq-css` block with the current one, copied verbatim from Stellar's _faq.js
//   2. adds `lx-faq-item` to each wrapper, so that block applies
// and strips the old `lx-faqcard` stylesheet this file used to inject, which is otherwise a second
// set of rules fighting the first ([[lumoscore-duplicate-stylesheets]]).
//
// Both steps are idempotent: the stylesheet is replaced by id rather than appended, and the class is
// added by a search string the replacement no longer matches ([[lumoscore-transform-idempotence]]).
//
// The container is JSON-ESCAPED — attributes read `class=\"lx-faq-q\"` in the file — so this uses the
// repo's read()/getContents() pair and re-serialises, as every transform here must.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);
const OLD_ID = 'lx-faqcard';          // this file's own earlier stylesheet, now superseded
const ID = 'lx-faq-css';              // Stellar's, which this build already has an old copy of

// VERBATIM from C:\LumosCore\_tools\_faq.js. Kept byte-identical on purpose: the point of this file
// is that the two builds share one stylesheet, so the next time Stellar's FAQ is restyled this is a
// re-copy and not a redesign. The accent rgba()s are Stellar's literals there too.
const CSS_BODY = [
  '.lx-faq{max-width:1180px;margin:8px auto 0;padding:52px 24px 60px;border-top:1px solid var(--border)}',
  '.lx-faq h2{font-size:clamp(26px,3vw,36px);font-weight:800;letter-spacing:-.02em;color:var(--text);',
  ' text-align:center;text-wrap:balance;margin:0 0 26px}',
  '.lx-faq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}',
  '.lx-faq-item{position:relative;padding:22px 22px 24px;border-radius:16px;',
  ' border:1px solid var(--border);background:linear-gradient(180deg,var(--surface),var(--bg));',
  ' transform-origin:center bottom;',
  ' transition:border-color .2s ease,transform .2s ease,box-shadow .2s ease}',
  '.lx-faq-item:hover{transform:scale(1.012);border-color:rgba(234,106,44,.42);',
  ' box-shadow:0 16px 36px -26px rgba(234,106,44,.7)}',
  '.lx-faq-q{display:grid;grid-template-columns:auto 1fr;gap:11px;align-items:start;',
  ' font-size:16.5px;font-weight:700;line-height:1.38;color:var(--text);margin:0 0 9px}',
  // The badge RAZA's screenshots differ by: Stellar's questions carry a "?" chip, ours carried none.
  '.lx-faq-q::before{content:"?";display:flex;align-items:center;justify-content:center;',
  ' width:24px;height:24px;border-radius:8px;font-size:14px;font-weight:800;line-height:1;',
  ' color:var(--accent);background:rgba(234,106,44,.14);border:1px solid rgba(234,106,44,.26)}',
  '.lx-faq-a{font-size:14.5px;line-height:1.7;color:var(--text-muted);margin:0;padding-left:35px}',
  // The landing page's category pills. This build has them too (28 `lx-faqtab` on the landing key),
  // and Stellar's note on these is that the scoping is deliberate: `.lx-faq .lx-faqtab` is (0,2,0) so
  // it beats a bare `.lx-faqtab` injected later in the document.
  '.lx-faq .lx-faqtabs{gap:10px}',
  '.lx-faq .lx-faqtab{padding:13px 19px}',
  '@media(max-width:900px){.lx-faq .lx-faqtab{padding:11px 16px}}',
  '@media(max-width:640px){.lx-faq .lx-faqtab{padding:9px 14px}}',
  '@media(prefers-reduced-motion:reduce){.lx-faq-item,.lx-faq-item:hover{transition:none;transform:none}}',
  '@media(max-width:640px){.lx-faq{padding:34px 16px 40px}.lx-faq h2{font-size:22px;margin-bottom:20px}',
  '.lx-faq-grid{gap:14px}.lx-faq-item{padding:18px 17px 19px;border-radius:14px}',
  '.lx-faq-a{padding-left:0}}',
].join('\n');

const CSS = '<style id="' + ID + '">' + CSS_BODY + '</' + 'style>';

// The wrapper, measured in the container: every one of them is a bare `<div>` immediately followed by
// the question heading, on all 22 FAQ page keys. Matching that exact pair rather than `<div>` alone
// is what keeps this from classing unrelated divs.
const WRAP_FROM = '<div><h3 class="lx-faq-q"';
const WRAP_TO = '<div class="lx-faq-item"><h3 class="lx-faq-q"';

function stripById(h, id) {
  const re = new RegExp('<style id="' + id + '">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g');
  return h.replace(re, '');
}

let files = 0, styled = 0, classed = 0, items = 0;

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

    h = stripById(h, OLD_ID);                                 // the lookalike this file used to ship
    h = stripById(h, ID);                                     // the frozen copy, replaced below

    // Last in the head, which is also where the one it replaces sat.
    if (h.indexOf('</head>') >= 0) h = h.replace('</head>', CSS + '</head>');
    else h = CSS + h;
    styled++;

    const n = h.split(WRAP_FROM).length - 1;
    if (n) { h = h.split(WRAP_FROM).join(WRAP_TO); classed++; items += n; }

    if (h !== before) json[k] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl faq cards: stylesheet on ' + styled + ' page key(s), '
  + items + ' item(s) classed on ' + classed + ', across ' + files + ' container(s)');
