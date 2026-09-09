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

  // A CLICK INSIDE A DIALOG IS NOT A ROW CLICK.
  //
  // The design's blanket navigation helper (window.__lumosNav) treats any click whose ancestry
  // includes a row-ish container as a request to open that row:
  //
  //     el.closest('tr,li,[class*="row"],[class*="pair"],[class*="item"],[class*="card"]')
  //
  // On the Pools page that is configured with LISTTARGET='amm-pool', and the Create Pool dialog is
  // full of elements matching it — its own "Network fee" line is <div class="row">. So clicking the
  // asset picker inside the dialog resolved to a pool row and navigated to /pools/stellar, the
  // Stellar route shape with the chain defaulting to "stellar" because this build is not one the
  // helper knows. Measured: the dialog opens, the first control you click sends you to Page not
  // found. Creating a pool was unreachable past its first interaction.
  //
  // browser/pools.js already fixed this for TABLE ROWS by giving them real anchors, and it notes
  // that only that worked — a capture listener on the row is not early enough. A dialog cannot use
  // that trick: its controls are buttons that must run their own handlers, so stopping propagation
  // to beat the helper would break the very controls it is protecting.
  //
  // So the helper itself is told what it should already know. One guard, at the top of the function
  // that makes the decision, matching the design's own modal markers.
  ["function rowTarget(el){\n    if(!CONTAINERNAV && !LISTTARGET) return null;",
   "function rowTarget(el){\n    if(el.closest('.modal-overlay,[data-modal],[role=\"dialog\"]')) return null;\n"
   + "    if(!CONTAINERNAV && !LISTTARGET) return null;"],
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
