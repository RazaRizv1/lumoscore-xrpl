// Move the end-of-body inline scripts out of every built page and into cacheable files.
//
// PORTED FROM STELLAR, where it has been running since 2026-09-17. The XRPL fork never had it, and
// measured on the combined deploy 2026-10-07 that is the single largest difference between the two
// chains' pages:
//
//                     Stellar        XRPL
//   /trade            435 KB         967 KB
//   /pools            417 KB       1,107 KB
//   /bridge           461 KB       1,150 KB
//   /lumos            430 KB       1,413 KB
//   external scripts  25 (hashed)   0
//   inline script     42 KB         577 KB  (998 KB on /lumos)
//
// Every one of those bytes is re-downloaded and re-parsed on EVERY navigation, because a script
// inside an HTML document cannot be cached separately from it. Stellar's own note records what that
// cost there: DOMContentLoaded 2,380 ms, and RAZA describing it as "it just stays there for a couple
// of seconds and then it starts loading the new page".
//
// WHAT THIS DOES. Each end-of-body inline block over 2 KB is written to /assets/js/lx-<hash>.js and
// replaced by a deferred <script src>. `/assets/*` carries `Cache-Control: public, max-age=31536000,
// immutable` in this build's _headers (checked), and the name is a hash of the contents, so a file is
// downloaded once per visitor, ever, and shared by every page carrying that layer.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH:
//   * anything in <head>. Those gates run BEFORE first paint on purpose — the anti-flash rules, the
//     route gates, `html:not(.lx-dexlate)`. Deferring them would reintroduce exactly the flash bugs
//     this project keeps hitting.
//   * anything with a src already, a non-JS type (JSON-LD is data), or document.write, which defer
//     breaks.
//
// WHY `defer` IS SAFE. An inline script at the end of <body> executes during parsing, after all the
// markup above it exists, and before DOMContentLoaded. A deferred external script executes after
// parsing, in document order, and also before DOMContentLoaded. For a block at the end of the body
// those are the same guarantees: full DOM, same relative order, same event.
//
// ---------------------------------------------------------------------------------------------
// TWO OUTPUT TREES, WHICH IS THE ONE THING THAT DIFFERS FROM STELLAR'S COPY.
//
// This build emits the same pages twice: `dist/` for the standalone XRPL project, and `dist/xrpl/`
// for the combined deploy, which `combine_with_stellar.js` copies to /xrpl. Both reference assets
// ROOT-relative, and the combined step copies `dist/assets` into the combined `/assets` — so BOTH
// trees' scripts are written into the single `dist/assets/js`, and the same hash is shared between
// them rather than duplicated.
//
// The stale-file sweep therefore runs ONCE, before either tree, or the second pass would delete the
// files the first just wrote. `lx-xrplconnect-*.js`, which the combine step writes separately, does
// not match the generated-name pattern and is left alone.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUTDIR = path.join(DIST, 'assets', 'js');

if (!fs.existsSync(DIST)) { console.error('externalize: no dist/ — run the build first'); process.exit(1); }
fs.mkdirSync(OUTDIR, { recursive: true });

// Written fresh each build: a block whose contents changed gets a new hash and a new file, and last
// build's file would otherwise sit there forever. Only our own generated names are removed.
for (const f of fs.readdirSync(OUTDIR)) {
  if (/^lx-[0-9a-f]{12}\.js$/.test(f)) fs.unlinkSync(path.join(OUTDIR, f));
}

// SECOND PASS: LIFT THE BODY <style> BLOCKS INTO <head>.
//
// Almost every layer here injects its CSS immediately before </body>, so the browser paints the page
// before that CSS exists and repaints when the parser reaches it — a flash on every load.
//
// EVERY BODY <style> MOVES, NOT JUST THE lx-* ONES, and Stellar's note on why is worth keeping: an
// earlier version there hoisted only `<style id="lx-...">`, which on /bridge left the design's own
// `br-css` below them and handed it the win on every tie — a silent restyle that nearly shipped.
// Taking all of them in document order preserves every relationship among them exactly; they land at
// the end of <head>, after the design's head stylesheets, which is where they were already winning
// from. The cascade is unchanged; only the paint timing moves.
function hoistStyles(html) {
  const headEnd = html.indexOf('</head>');
  if (headEnd < 0) return html;
  // A <style> INSIDE AN <svg> IS NOT A PAGE STYLESHEET: it scopes to that fragment, and lifting it
  // into <head> both breaks the drawing and leaks its rules to the whole page.
  const svg = [];
  for (const s of html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) svg.push([s.index, s.index + s[0].length]);
  const inSvg = (i) => svg.some((r) => i >= r[0] && i < r[1]);

  const re = /<style\b[^>]*>[\s\S]*?<\/style>/g;
  const blocks = [];
  let out = '', last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index < headEnd) continue;            // already in head: leave it exactly where it is
    if (inSvg(m.index)) continue;               // belongs to the drawing, not the page
    blocks.push(m[0]);
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
  }
  if (!blocks.length) return html;
  out += html.slice(last);
  const hi = out.indexOf('</head>');            // every removal was after </head>, so this has not moved
  if (hi < 0) return html;
  return out.slice(0, hi) + blocks.join('') + out.slice(hi);
}

const written = new Map();          // hash -> bytes, so a layer shared by 90 pages is written once
let pages = 0, moved = 0, bytes = 0, hoistedPages = 0;

function run(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const file = path.join(dir, name);
    let html = fs.readFileSync(file, 'utf8');
    const headEnd = html.indexOf('</head>');
    if (headEnd < 0) continue;

    let changed = 0;
    // Rebuilt rather than replaced in place: every match shifts the offsets after it, and the head
    // boundary has to be judged against the ORIGINAL string, so the cursor walks forward.
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let out = '', last = 0, m;
    while ((m = re.exec(html))) {
      const [whole, attrs, body] = m;
      const at = m.index;
      if (at < headEnd) continue;                       // head gates stay exactly where they are
      if (/\bsrc\s*=/.test(attrs)) continue;            // already external
      if (/\btype\s*=\s*["'](?!text\/javascript)/i.test(attrs)) continue;   // JSON-LD is data, not code
      if (body.indexOf('document.write') >= 0) continue;
      if (body.trim().length < 2048) continue;          // a small block costs more as a request than it saves

      const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
      const jsName = 'lx-' + hash + '.js';
      if (!written.has(hash)) {
        fs.writeFileSync(path.join(OUTDIR, jsName), body, 'utf8');
        written.set(hash, Buffer.byteLength(body));
      }
      const id = (attrs.match(/id="([^"]+)"/) || [])[1];
      // The id travels with it: predeploy_check finds blocks by `<script id="lx-...">` and several
      // layers look themselves up by id to avoid double-injection. Losing it breaks both quietly.
      out += html.slice(last, at) + '<script' + (id ? ' id="' + id + '"' : '')
        + ' src="/assets/js/' + jsName + '" defer></' + 'script>';
      last = at + whole.length;
      changed++; moved++; bytes += Buffer.byteLength(body);
    }
    out = changed ? out + html.slice(last) : html;

    const hoisted = hoistStyles(out);
    if (hoisted !== out) { out = hoisted; hoistedPages++; }

    if (out === html) continue;
    fs.writeFileSync(file, out, 'utf8');
    pages++;
  }
}

run(DIST);                       // the standalone build
run(path.join(DIST, 'xrpl'));    // what combine_with_stellar.js copies to /xrpl

let total = 0;
for (const b of written.values()) total += b;
console.log('externalize: ' + moved + ' script block(s) moved off ' + pages + ' page(s) — '
  + (bytes / 1048576).toFixed(1) + ' MB of inline script now '
  + written.size + ' cacheable file(s) totalling ' + (total / 1024).toFixed(0) + ' KB'
  + '; styles hoisted on ' + hoistedPages + ' page(s)');
