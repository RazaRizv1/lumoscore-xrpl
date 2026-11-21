// FAQ, XRPL fork — re-renders the questions this build already holds through the SHARED renderer.
//
// WHY IT READS ITS OWN PAGES INSTEAD OF A TABLE. Stellar authors its answers in _faq.js. This fork
// cannot use that table: the answers here were written for the XRP Ledger and say different things.
// The bridge page is the clearest case -- Stellar's answers describe CCTP and LayerZero, this build's
// describe NEAR Intents, Axelar and THORChain, and no amount of shared copy would make one correct
// on both. [[lumoscore-xrpl-wrong-chain-copy]]
//
// So the split is: the fork owns the WORDS, _faqview.js owns the LOOK. This file lifts each page's
// existing questions and answers out of its own markup and hands them straight back to the renderer.
// Nothing here decides what a question says, which is why a re-run cannot quietly rewrite the copy.
//
// IT REPLACES TWO TRANSFORMS. _xrplfaqcard.js existed only to backport Stellar's card stylesheet by
// hand (it had already fallen a revision behind), and _xrplfaqld.js rebuilt the FAQPage JSON-LD by
// regex over that markup. The renderer emits both, from the same items it rendered, so both are now
// redundant AND BOTH ARE REMOVED FROM rebuild.js -- left registered they would run after this pass
// and put the old card sheet back. Their stylesheet id is in the renderer's strip list for the same
// reason: a retired script leaves its stylesheet behind unless something names it.
//
// Idempotent, and in both directions: the extractor reads the NEW accordion markup as well as the
// OLD card markup, so running this twice is a no-op rather than a page that loses its questions.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const view = require(__dirname + '/_faqview.js');
const B = String.fromCharCode(92);

// This fork's pages link out with the full origin rather than a root-relative path, and /support is
// served from the Stellar tree -- /support/xrpl and /xrpl/support are both 404. Following what the
// XRPL landing page already does rather than inventing a third form.
const SUPPORT = 'https://lumoscore.com/support';

// esc() produces exactly these five. Decoding them in ONE pass is what keeps `&amp;lt;` reading back
// as `&lt;` instead of `<` -- a second pass over the result would double-decode it.
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function dec(s) {
  return String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, function (m) { return ENT[m]; });
}

// The old shape is <h3 class="lx-faq-q">Q</h3> ... <p class="lx-faq-a">A</p>; the new one puts the
// question inside a <button><span>. Try new first, fall back to old.
const NEW_RE = /<button[^>]*class="lx-faq-q"[^>]*>\s*<span>([\s\S]*?)<\/span>[\s\S]*?<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
const OLD_RE = /<h3[^>]*class="lx-faq-q"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<p[^>]*class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;

function pairs(frag) {
  for (const re of [NEW_RE, OLD_RE]) {
    const out = []; re.lastIndex = 0; let m;
    while ((m = re.exec(frag))) out.push([dec(m[1]).trim(), dec(m[2]).trim()]);
    if (out.length) return out;
  }
  return [];
}

// The landing page carries category panes. Read the labels off the pills and the items out of each
// pane, so the grouping this build already ships is preserved exactly rather than re-invented.
function groupsOf(sec) {
  const labels = {};
  const tr = /<button[^>]*class="lx-faqtab[^"]*"[^>]*data-lxfaq="([^"]+)"[^>]*>([\s\S]*?)<span>/g;
  let m;
  while ((m = tr.exec(sec))) labels[m[1]] = dec(m[2]).replace(/<[^>]*>/g, '').trim();

  // Pane boundaries: each pane runs from its own marker to the next one.
  const marks = [];
  const pr = /data-lxfaqpane="([^"]+)"/g;
  while ((m = pr.exec(sec))) marks.push({ id: m[1], at: m.index });
  if (!marks.length) return null;

  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const frag = sec.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : sec.length);
    const items = pairs(frag);
    if (items.length) out.push({ label: labels[marks[i].id] || marks[i].id, id: marks[i].id, items: items });
  }
  return out.length ? out : null;
}

const DRY = process.argv.indexOf('--dry') >= 0;
let touched = 0, skipped = 0, files = 0;
const LOST = [];
for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  files++;
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const key of Object.keys(json)) {
    const h = json[key];
    const i = h.indexOf('<section class="lx-faq"');
    if (i < 0) continue;
    const j = h.indexOf('</section>', i);
    if (j < 0) continue;
    const sec = h.slice(i, j);

    const groups = groupsOf(sec);
    const items = groups ? null : pairs(sec);

    // A page whose questions could not be read is LEFT ALONE and reported. Writing an empty FAQ
    // would delete real content and look like a successful run.
    if (!groups && (!items || !items.length)) { skipped++; LOST.push(key + ' (' + dev + ')'); continue; }

    if (DRY) {
      const n = groups ? groups.reduce(function (a, g) { return a + g.items.length; }, 0) : items.length;
      console.log('  ' + dev + '  ' + key + '  ' + n + (groups ? ' in ' + groups.length + ' groups' : '')
        + '   first Q: ' + ((groups ? groups[0].items[0] : items[0])[0] || '').slice(0, 64));
      touched++; continue;
    }

    const out = view.apply(h, groups
      ? { groups: groups, supportHref: SUPPORT }
      : { items: items, supportHref: SUPPORT });
    if (out === null) { skipped++; LOST.push(key + ' (' + dev + ', no anchor)'); continue; }

    json[key] = out; changed = true; touched++;
  }

  if (changed) {
    const ser = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + ser + data.slice(e), 'utf8');
  }
}
console.log('xrpl faq: re-rendered ' + touched + ' page keys across ' + files + ' container(s)'
  + (skipped ? '  -- SKIPPED ' + skipped + ': ' + LOST.join(', ') : ''));
if (!touched) { console.log('!! TOUCHED 0 PAGES -- this is NOT a pass'); process.exit(1); }
