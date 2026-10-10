// Correct the inherited wallet gate's idea of which network it is on.
//
// THE FROZEN BASE AGAIN. These containers carry Stellar's `lx-gate` script (built by that repo's
// _tools/_wallet_gate.js), and it bakes a constant per DESIGN CONTAINER rather than per network:
//
//   var NET="aptos",SEL=".summary-cta";
//
// "aptos" is the multichain base the Stellar site is built from, not a chain LumosCore runs. Two
// things read it, both only when NO wallet is connected -- which is the entire reason this gate
// exists:
//
//   sessionStorage.setItem("lumos.connDest","stay:"+actNet())   -> "stay:aptos"
//   window.lxwOpenWallet(actNet(), location.href)               -> a wallet list for "aptos"
//
// Measured on the deployed build with a cleared session: clicking the launchpad's Connect button
// wrote lumos.connDest = "stay:aptos" on this chain and on Stellar (RAZA 2026-10-10, found while
// checking that button). Stellar is fixed at source; this build cannot be, because nothing here
// re-runs _wallet_gate.js -- the script arrives already baked.
//
// So it is patched in place, the same way _xrplconndest.js patches the header's own connDest write,
// and with the SAME path-derived expression so the two cannot drift:
//   * NET becomes "xrpl"
//   * actNet() prefers the chain named in the url (/launchpad/xrpl -> xrpl), then lumos.chain, then NET
//
// The url is preferred over the baked constant for the same reason it is on the Stellar side: it is
// the only source that is correct for a reader who has no wallet yet, and these pages are reachable
// under both /launchpad/xrpl and bare urls.
//
// STALE GATES ARE REMOVED TOO. Stellar's pass used to skip non-CTA pages BEFORE stripping, so a page
// that once carried a gate kept it forever; lumoscore-account and its dark variant still ship one here
// (NET="aptos", selector .summary-cta) although the account page has no such button. That is fixed at
// source on Stellar now, but this build's copies were frozen before the fix, so they are dropped here.
//
// Idempotent: patching an already-patched script finds no OLD string and reports it, and the stale
// sweep is keyed on the page name rather than on whether it ran before.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const OLD_NET = 'var NET="aptos"';
const NEW_NET = 'var NET="xrpl"';

const OLD_ACT = 'function actNet(){try{return localStorage.getItem("lumos.chain")||NET;}catch(_){return NET;}}';
const NEW_ACT = 'function pathNet(){try{var s=(location.pathname||"").split("/").filter(Boolean);'
  + 'return (s.length>1&&/^(stellar|xrpl)$/i.test(s[1]))?s[1].toLowerCase():"";}catch(_){return "";}}'
  + 'function actNet(){try{return pathNet()||localStorage.getItem("lumos.chain")||NET;}'
  + 'catch(_){return pathNet()||NET;}}';

// The account page has no .summary-cta; any gate on it is a leftover.
const STALE = /^lumoscore-account(-dark|-light|-mobile)?\.html$/;

const GATE = new RegExp('<script id="lx-gate">[' + B + 's' + B + 'S]*?<' + B + '/script>', 'g');
const GATECSS = new RegExp('<style id="lx-gate-css">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g');

let files = 0, netFixed = 0, actFixed = 0, stale = 0, seen = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    let h = json[key];
    if (typeof h !== 'string') continue;
    if (h.indexOf('<script id="lx-gate">') < 0) continue;
    seen++;

    if (STALE.test(key)) {
      h = h.replace(GATE, '').replace(GATECSS, '');
      json[key] = h;
      stale++;
      continue;
    }

    if (h.indexOf(OLD_NET) >= 0) { h = h.split(OLD_NET).join(NEW_NET); netFixed++; }
    if (h.indexOf(OLD_ACT) >= 0) { h = h.split(OLD_ACT).join(NEW_ACT); actFixed++; }
    json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl wallet gate: ' + seen + ' page(s) carried lx-gate — NET fixed on ' + netFixed
  + ', actNet fixed on ' + actFixed + ', stale gate removed from ' + stale
  + ' across ' + files + ' container(s)');

// A re-run legitimately finds nothing to change; a FIRST run that finds nothing means the inherited
// script changed shape and this patch silently stopped applying, which is the failure worth shouting
// about. Both look identical from here, so the check is on the end state instead.
let leftover = 0;
for (const dev of ['desktop', 'mobile']) {
  let data; try { data = read('lumoscore-xrpl-' + dev + '.html'); } catch (e) { continue; }
  const { json } = getContents(data);
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (/<script id="lx-gate">\(function\(\)\{var NET="aptos"/.test(json[key])) leftover++;
  }
}
if (leftover) {
  console.error('  ! ' + leftover + ' page(s) still bake NET="aptos" — the inherited script changed shape');
  process.exit(1);
}
