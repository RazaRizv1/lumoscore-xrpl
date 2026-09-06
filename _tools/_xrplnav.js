// Sidebar fixes for the XRPL build.
//
// COLLAPSED SIDEBAR LOSES THE LOGO. The design ships
//
//     .nx-collapsed .nx-brand .logo{display:none!important}
//
// which hides the whole brand block -- mark AND wordmark -- the moment the rail is collapsed, so the
// top of the sidebar is simply empty. The Stellar site keeps the mark and drops only the wordmark,
// which is what a collapsed rail is supposed to look like: the icon still identifies the product.
//
// Rewritten rather than overridden with a later rule, because the original carries `!important` and
// beating it would mean another `!important` in a stylesheet that already has too many.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const PATCHES = [
  // Keep the mark, hide only the wordmark.
  ['.nx-collapsed .nx-brand .logo{display:none!important}',
   '.nx-collapsed .nx-brand .logo-text{display:none!important}'],
];

let files = 0, hits = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    let changed = false;
    for (const [bad, good] of PATCHES) {
      if (h.indexOf(bad) < 0) continue;
      const n = h.split(bad).length - 1;
      h = h.split(bad).join(good);
      hits += n;
      changed = true;
    }
    if (changed) json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl nav: patched ' + hits + ' rule(s) across ' + files + ' container(s)');
if (!hits) console.error('  ! nothing matched — the rule may already be patched, or its text changed');
