// Wire the design's Create Pool dialog to an XRP Ledger AMMCreate — on the Pools page and on the
// dashboard, which both carry #createPoolModal (desktop and phone).
//
// The dialog also appears inside other page containers (launch, wallet, asset-overview) as inherited
// markup nobody opens; only the two pages with a way to open it get the layer.
//
// Carries xrpl-core with it: the phone dashboard has no other layer that injects the core, and the
// arithmetic deciding how much moves must come from the one tested file.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplcreatepool';
const DD_ID = 'lx-cpdd';          // the carried-over dropdown's stylesheet, stripped by id so a rebuild replaces it
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/createpool.js', 'utf8');
for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

// ---- the asset dropdown, for the pages whose copy of the dialog does not ship it ------------------
//
// RAZA 2026-09-17, on the $LUMOS page: "Add liquidity popup: im unable to select the asset 2". Asset 1 is filled in for
// them there, so only the second picker showed it: clicking it did nothing at all. The reason is not in the driver —
// `openList()` looks for `.asset-dropdown` inside the field and returns when there is none — but in the markup. The
// design's Pools copy of `#createPoolModal` carries the dropdown; the $LUMOS copy carries the two pickers WITHOUT it,
// and without its stylesheet rules either.
//
// So the design's own dropdown is carried over, markup and CSS both, from the page that has it. Nothing is invented:
// the block is the design's, minus its mock asset rows (the inherited sheet hides any `.ad-item` that is not ours
// anyway), and the rules are lifted verbatim from the source page's stylesheet so the two copies cannot drift.
const DD_SELECTORS = /(^|,)\s*(\.asset-dropdown|\.ad-(search|search-input|list|item|ico|meta|tk|nm|bal))\b/;

// The dialog's extent, by counting <div>s from its own tag — so nothing outside it is ever touched.
function modalSlice(h) {
  const at = h.indexOf('id="createPoolModal"');
  if (at < 0) return null;
  let start = h.lastIndexOf('<div', at);
  if (start < 0) return null;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return null;
}

function dropdownFrom(h) {
  const sl = modalSlice(h);
  if (!sl) return null;
  const seg = h.slice(sl.start, sl.end);
  const at = seg.indexOf('<div class="asset-dropdown"');
  if (at < 0) return null;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = at;
  let depth = 0, m, end = -1;
  while ((m = re.exec(seg))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { end = m.index + m[0].length; break; }
  }
  if (end < 0) return null;
  // The mock rows go; the empty list stays, which is what the driver fills.
  return seg.slice(at, end).replace(/(<div class="ad-list">)[\s\S]*?(<\/div>\s*<\/div>)$/, '$1$2');
}

function dropdownCss(h) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(h))) {
    const sel = m[1].trim();
    const body = m[2];
    if (sel.length > 300 || sel.indexOf('function') >= 0 || sel.indexOf('var ') >= 0) continue;
    // THE ANCHOR COUNTS AS PART OF THE DROPDOWN (RAZA 2026-09-17, after the first attempt shipped: "i still cant select
    // asset 2 beause the dropdown just wont open"). It DID open — `position:absolute; left:0; right:0; top:calc(100% + 4px)`
    // with no positioned ancestor put it 1,440px wide at y=904, off the bottom of the page, which from the reader's side is
    // indistinguishable from a dead button. The design anchors it with a rule of its own, `.asset-field{position:relative}`,
    // filed under the same "Asset picker dropdown" heading — and that selector names none of the classes below, so the
    // first pass left it behind. Any `.asset-field` rule that sets `position` travels too, and nothing else does: the
    // field's own look already ships on these pages.
    const isAnchor = /\.asset-field\b/.test(sel) && /position\s*:/.test(body);
    if (!isAnchor && !DD_SELECTORS.test(sel)) continue;
    rules.push(sel.replace(/\s+/g, ' ') + '{' + body.replace(/\s+/g, ' ').trim() + '}');
  }
  return rules.join('\n');
}

// stripById only removes <script id>, so the carried-over stylesheet needs its own removal or every rebuild leaves
// another copy behind ([[lumoscore-duplicate-stylesheets]]: stale rules then win on source order).
function stripStyle(h, id) {
  const open = '<' + 'style id="' + id + '">', close = '<' + '/' + 'style>';
  for (;;) {
    const i = h.indexOf(open);
    if (i < 0) return h;
    const j = h.indexOf(close, i + open.length);
    if (j < 0) throw new Error('style id="' + id + '" has no closing tag');
    h = h.slice(0, i) + h.slice(j + close.length);
  }
}

// Insert the block at the end of every asset field that has no dropdown of its own. A field ends after its
// `.field-foot`, which holds only spans — so the first `</div>` after it is its own.
function addDropdowns(h, block) {
  const sl = modalSlice(h);
  if (!sl) return { html: h, n: 0 };
  let seg = h.slice(sl.start, sl.end);
  if (seg.indexOf('asset-dropdown') >= 0) return { html: h, n: 0 };
  let n = 0, from = 0;
  for (;;) {
    const f = seg.indexOf('<div class="field-foot">', from);
    if (f < 0) break;
    const close = seg.indexOf('</div>', seg.indexOf('max-btn', f));
    if (close < 0) break;
    const at = close + '</div>'.length;
    seg = seg.slice(0, at) + block + seg.slice(at);
    from = at + block.length;
    n++;
  }
  return { html: h.slice(0, sl.start) + seg + h.slice(sl.end), n };
}

let pages = 0, dds = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);

  // The donor: whichever key in this container ships the dialog WITH its dropdown.
  let donor = null;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (json[key].indexOf('id="createPoolModal"') < 0) continue;
    const block = dropdownFrom(json[key]);
    // Marked, so a later rebuild can tell that this page's dropdown was carried over and still needs the stylesheet.
    if (block) {
      donor = {
        block: block.replace('<div class="asset-dropdown"', '<div data-lxcpdd class="asset-dropdown"'),
        css: dropdownCss(json[key]),
      };
      break;
    }
  }

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // …AND THE $LUMOS PAGE (RAZA 2026-09-17: "Lumos token page, add liqudity popup is breaking"). It ships the same
    // `#createPoolModal` and its own "Add Liquidity" button, and this layer was never put there — so the dialog opened with
    // empty pickers, dead MAX buttons and a trust-line banner nothing could answer. Nothing was broken in it; there was
    // simply no driver behind it.
    if (!/^lumoscore-(amm|home|lumos-token)(-(dark|light|mobile))?\.html$/.test(key)) continue;
    let h = stripById(json[key], ID).html;
    if (h.indexOf('id="createPoolModal"') < 0) { json[key] = h; continue; }
    h = stripStyle(h, DD_ID);
    if (donor) {
      const r = addDropdowns(h, donor.block);
      // Carried over by an earlier run: the markup is already in the page, and the stylesheet that was just stripped
      // has to go back or the dropdown opens unstyled on the second build.
      const carried = r.n || h.indexOf('data-lxcpdd') >= 0;
      if (carried) {
        h = r.html;
        const hi = h.lastIndexOf('</' + 'head>');
        const style = '<style id="' + DD_ID + '">' + donor.css + '</' + 'style>';
        h = hi >= 0 ? h.slice(0, hi) + style + h.slice(hi) : style + h;
        dds += r.n;
      }
    }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('xrpl create pool: wired on ' + pages + ' page key(s), ' + dds + ' asset dropdown(s) carried over');
if (!pages) { console.error('  ! no page carried #createPoolModal — nothing was wired'); process.exit(1); }
