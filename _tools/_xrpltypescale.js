// Scale the design's px CSS by +10%, so the XRPL build reads at the same size as the Stellar site.
//
// WHY THIS EXISTS. The Stellar project runs a typescale over its containers; this fork never had one
// — 0 stamped style blocks across 47 pages — so every page rendered at the design's base sizes and
// looked about a tenth smaller than the live site. RAZA spotted it comparing the two token previews
// side by side: same component, visibly different size.
//
// THE STAMP IS THE WHOLE SAFETY MECHANISM. This rewrites numbers in place, so running it twice
// without a marker gives 1.21x, three times 1.33x, and nothing in the output says it happened. Every
// block it touches gets `data-lxts`, and a stamped block is skipped forever after.
//
// WHAT IT DOES NOT TOUCH, each for a reason that bites otherwise:
//
//   * AT-RULE PRELUDES. `@media (max-width: 768px)` is a breakpoint, not a size. Scaling it to 844px
//     moves where the layout changes shape, so a phone starts getting the tablet rules. Preludes are
//     masked out before any number is rewritten.
//   * ANYTHING UNDER 2px. A 1px border scaled to 1.1px is rendered as a smudge on some displays and
//     as nothing on others, and hairlines are not part of a type scale.
//   * 0px, which has no size to scale.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const SCALE = 1.1;
const STAMP = 'data-lxts';

// Mask at-rule preludes so their numbers survive untouched, scale what is left, then restore.
function scaleCss(css) {
  const masked = [];
  // THE PLACEHOLDER MUST NOT BE VALID CSS. It used to be a bare integer between spaces, and the
  // restore below then replaced EVERY space-separated integer in the stylesheet, not just the ones
  // this function wrote. CSS shorthands are full of them, so real declarations were eaten and an
  // at-rule was spliced into their middle:
  //     flex:0 0 auto      ->  flex:0@keyframes lxmq auto
  //     flex:1 1 275px     ->  flex:1@media(max-width:900px)275px
  //     margin:0 0 33px    ->  margin:0@media (max-width:640px)33px
  // Nine of those shipped to the XRPL landing page and broke its layout. A __LXMASK_n__ token
  // cannot occur in a stylesheet, carries no bare integer and no "@", so neither the px scaler nor
  // the at-rule matcher below can touch it, and the restore is anchored to exactly that token.
  const keep = function (m) {
    masked.push(m);
    return '__LXMASK_' + (masked.length - 1) + '__';
  };

  // url(...) IS MASKED FIRST, and this mask exists because its absence CORRUPTED EVERY EMBEDDED
  // IMAGE. Base64 uses [A-Za-z0-9+/=], so a run like "48px" occurs inside image data all the time;
  // scaling it to "52.8px" inserts a '.', which is not in the alphabet, and the PNG stops decoding.
  // The sidebar logo simply vanished, and nothing announced it: the element was still 42x42, still
  // hit-testable, still carrying a background-image. atob() was what finally said
  // "not correctly encoded".
  let safe = css.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/g, keep);

  // At-rule preludes second: a scaled `@media (max-width: 768px)` moves where the layout changes
  // shape, so a phone starts getting the tablet rules.
  safe = safe.replace(/@[a-zA-Z-]+[^{;]*/g, keep);

  const scaled = safe.replace(/(-?\d*\.?\d+)px/g, function (whole, num) {
    const v = parseFloat(num);
    if (!isFinite(v) || Math.abs(v) < 2) return whole;       // hairlines and 0 stay put
    const out = Math.round(v * SCALE * 100) / 100;
    return out + 'px';
  });

  return scaled.replace(/__LXMASK_(\d+)__/g, function (_, i) { return masked[Number(i)]; });
}

// Rewrite every unstamped <style> block in one page's HTML.
function scalePage(html) {
  let out = '';
  let i = 0;
  let touched = 0, skipped = 0;

  for (;;) {
    const open = html.indexOf('<style', i);
    if (open < 0) { out += html.slice(i); break; }

    const tagEnd = html.indexOf('>', open);
    if (tagEnd < 0) { out += html.slice(i); break; }

    const close = html.indexOf('</' + 'style>', tagEnd);
    if (close < 0) { out += html.slice(i); break; }

    const tag = html.slice(open, tagEnd + 1);
    const body = html.slice(tagEnd + 1, close);

    out += html.slice(i, open);

    if (tag.indexOf(STAMP) >= 0) {
      out += tag + body;                                      // already scaled: leave it exactly
      skipped++;
    } else {
      out += tag.slice(0, -1) + ' ' + STAMP + '="' + SCALE + '">' + scaleCss(body);
      touched++;
    }
    out += '</' + 'style>';
    i = close + ('</' + 'style>').length;
  }

  return { html: out, touched, skipped };
}

let files = 0, pages = 0, blocks = 0, already = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const r = scalePage(json[key]);
    if (!r.touched && !r.skipped) continue;
    json[key] = r.html;
    if (r.touched) pages++;
    blocks += r.touched;
    already += r.skipped;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl typescale: scaled ' + blocks + ' style block(s) by ' + SCALE + ' across '
  + pages + ' page key(s) in ' + files + ' container(s); ' + already + ' already stamped');
