// The four sign-in icons that 404, on this build's copy of the page.
//
// Mirrors the ICON_FIX / ICON_DROP block in Stellar's _tools/_signinnets.js. Same inherited markup,
// same four missing files, and /signin is one of the urls the combined deploy serves from EITHER
// build depending on the lx_chain cookie -- so fixing only Stellar's copy leaves the bug for anyone
// who has picked XRPL.
//
// WHAT IS WRONG. The mobile sign-in page asks for assets/wallets/{stellar,xrpledger,xbull,
// walletconnect}.png and none of the four exists. Nothing LOOKS broken, which is why it survived:
// each <img> sits behind a lettermark span and carries onerror="this.remove()", so the image deletes
// itself and the letter shows. Verified in a browser at 375px on the Stellar copy -- document.images
// reported zero broken while four requests were failing. Only a crawl with a MOBILE user agent finds
// it, because the desktop page references four wallet images and all four exist.
//
// Two are answerable, because the mark exists under another name:
//   stellar.png   -> /assets/networks/stellar.png
//   xrpledger.png -> /assets/networks/xrpl.png     (named for the chain id, not the brand)
// Those are NETWORK marks, ours to show, and a real logo beats a grey letter tile on a chooser.
//
// The other two stay lettermarks by design, not by omission: _wallet_icons.js states the rule for the
// connect popup -- "Official wallet logos are trademarks and should come from each wallet's own brand
// assets/SDK — not hand-reproduced." So the dead <img> is removed and the lx-wl span behind it, which
// was already what the reader saw, is left to do the job.
//
// Root-relative paths on the way out. The inherited ones are "assets/..." with no leading slash, which
// resolves only because /signin is one segment deep (lumoscore-runtime-relative-assets).
//
// Idempotent: the replacements are exact strings that do not reappear once applied.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ICON_FIX = [
  ['assets/wallets/stellar.png', '/assets/networks/stellar.png'],
  ['assets/wallets/xrpledger.png', '/assets/networks/xrpl.png'],
];
const ICON_DROP = ['assets/wallets/xbull.png', 'assets/wallets/walletconnect.png'];

let files = 0, pages = 0, fixed = 0, dropped = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string') continue;
    const before = h;
    for (const [from, to] of ICON_FIX) {
      const n = h.split('src="' + from + '"').length - 1;
      if (n) { h = h.split('src="' + from + '"').join('src="' + to + '"'); fixed += n; }
    }
    for (const dead of ICON_DROP) {
      const re = new RegExp('<img[^>]*src="' + dead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 'g');
      const n = (h.match(re) || []).length;
      if (n) { h = h.replace(re, ''); dropped += n; }
    }
    if (h !== before) { json[key] = h; pages++; }
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl signin icons: ' + fixed + ' repointed, ' + dropped + ' dead <img> removed, across '
  + pages + ' page key(s) in ' + files + ' container(s)');

// Nothing may still ask for a file that does not exist.
let left = 0;
for (const dev of ['desktop', 'mobile']) {
  let data; try { data = read('lumoscore-xrpl-' + dev + '.html'); } catch (e) { continue; }
  const { json } = getContents(data);
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    for (const dead of ICON_DROP.concat(ICON_FIX.map((x) => x[0]))) {
      if (json[key].indexOf('src="' + dead + '"') >= 0) { left++; console.error('  ! ' + key + ' still asks for ' + dead); }
    }
  }
}
if (left) process.exit(1);
