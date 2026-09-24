// The Trustlines button on the wallet's action row — REMOVED.
//
// History: 2026-09-08 RAZA reported "the trustline option is not there", and this transform ADDED a
// fourth `.qa-btn` ("Trustlines") beside Send / Receive / Swap, opening the design's #modalTrustlines,
// which browser/write.js wires. 2026-09-15 RAZA, comparing with lumoscore.com: "THere's an extra Trustline
// button on the right side that we dont have on Stellar." Stellar's row is three buttons, so this one goes.
//
// WHAT THAT COSTS, stated plainly: the Trustlines dialog has no other opener on this build, so adding or
// removing a trust line from the wallet page is not reachable any more — the same state as Stellar's
// production wallet. Trust lines are still created where they are needed: a limit order that fills opens
// one, and the ledger requires one before a token can be received. Raised with RAZA.
//
// The containers are gitignored and persist, so they already carry the button; this strips it by its
// `data-lxtl` marker (desktop `.qa-btn`, phone `.action-btn`). Idempotent: a second run finds nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

let removed = 0, containers = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let p = json[k];
    if (typeof p !== 'string' || p.indexOf('data-lxtl') < 0) continue;
    // THIS LOOP USED TO HANG THE WHOLE BUILD, silently and forever (hit 2026-09-16: two rebuilds sat at this transform for
    // hours). A mention of `data-lxtl` outside a button's own opening tag — a script that sets the attribute, say — was
    // renamed to `data-lxtl-seen` to skip it, but `indexOf('data-lxtl')` matches that rename's own prefix, so the next pass
    // found the same spot, renamed it again, and grew the string without end. Skipping past the mention by INDEX cannot do
    // that, and it needs no rename, so the restore below is gone too.
    let from = 0;
    for (;;) {
      const at = p.indexOf('data-lxtl', from);
      if (at < 0) break;
      const open = p.lastIndexOf('<button', at);
      const close = p.indexOf('</button>', at);
      if (open < 0 || close < 0) break;
      // Only a button whose own opening tag carries the marker; anything else would be a CSS/JS mention.
      if (p.slice(open, p.indexOf('>', open)).indexOf('data-lxtl') < 0) {
        from = at + 'data-lxtl'.length;
        continue;
      }
      let start = open;
      while (start > 0 && (p[start - 1] === ' ' || p[start - 1] === '\n')) start--;   // its indentation
      p = p.slice(0, start) + p.slice(close + '</button>'.length);
      removed++;
    }
    if (p !== json[k]) { json[k] = p; changed = true; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}
console.log('xrpl trustline button: removed ' + removed + ' across ' + containers + ' container(s)');
