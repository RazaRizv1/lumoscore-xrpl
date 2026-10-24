// Carry Stellar's fee-banner fix into this fork's inherited lx-feemodal.
//
// RAZA 2026-10-16: "I have more than 250K lumos in my wallet yet still im seeing Hold 250,000 for
// 50% off." Root-caused in lumoscore.com's _feemodal.js: addRows() RETURNED as soon as it found an
// existing .lx-feerow, after updating that row and nothing else, so the banner below it was written
// exactly once — on the first call, while __lxFeeRate was still its 0.002 default. disc() was false,
// the nudge went in, and every later call (the 300/1200/3000ms passes AND the lx:feetier listener
// that exists precisely for this) hit the early return and repainted only the fee ROW. Hence "0.1%"
// sitting directly above "hold 250,000 LUMOS" — one of them was never updated.
//
// WHY A PATCH AND NOT A REBUILD. This script is INHERITED markup: the fork copied Stellar's built
// containers, so fixing _feemodal.js over there does not reach these files. The documented way to
// inherit a Stellar fix is `node _tools/rebuild.js --base`, which re-copies the base and re-runs the
// whole chain — correct, but it also re-imports every other change Stellar has made since the last
// copy, which is a large surface to open for one structural edit. This rewrites the two statements
// that are wrong and touches nothing else.
//
// IDEMPOTENCE IS THE WHOLE RISK HERE, because the second replacement CONTAINS its own search string:
// 'sum.appendChild(row);' -> 'sum.appendChild(row);}'. Run twice unguarded and it appends a brace
// every build until the script stops parsing — the exact trap [[lumoscore-transform-idempotence]]
// records. So BOTH edits are gated on the UNPATCHED marker still being present, and a container that
// has already been fixed is skipped whole.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// The early return, as the inherited build emits it.
const OLD_RET = 'if(hint)hint.innerHTML=feeHTML();return;}';
const NEW_RET = 'if(hint)hint.innerHTML=feeHTML();}else{';
// ...and the end of the branch that creates the row, which now has to close the else.
const OLD_APP = 'sum.appendChild(row);';
const NEW_APP = 'sum.appendChild(row);}';

let files = 0, pages = 0, patched = 0, already = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    const h = json[k];
    if (typeof h !== 'string') continue;
    if (h.indexOf(OLD_RET) < 0) { if (h.indexOf(NEW_RET) >= 0) already++; continue; }

    // Both statements live inside addRows(); the counts must match or the structure is not what this
    // expects and it is safer to leave the page alone than to brace-mismatch a working script.
    const nRet = h.split(OLD_RET).length - 1;
    const nApp = h.split(OLD_APP).length - 1;
    if (nRet !== nApp) {
      console.error('  ' + k + ': ' + nRet + ' return(s) but ' + nApp + ' append(s) — skipped');
      continue;
    }
    json[k] = h.split(OLD_RET).join(NEW_RET).split(OLD_APP).join(NEW_APP);
    pages++; patched += nRet;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl fee banner: ' + patched + ' addRows early-return(s) rewritten on ' + pages
  + ' page key(s) across ' + files + ' container(s)'
  + (already ? ('; ' + already + ' already patched') : ''));
if (!files) { console.error('  ! no container was read'); process.exit(1); }
