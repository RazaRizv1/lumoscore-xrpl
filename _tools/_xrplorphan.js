// Guard element lookups whose element does not exist on the page.
//
// The design's inline scripts are written against the full multi-chain page set, so some of them
// reach for controls this fork does not have. An unguarded
//
//     document.getElementById('soroBtn').addEventListener('click', openSoro);
//
// throws TypeError on null the moment it runs — and because it is a bare statement in a long inline
// script, EVERY LINE AFTER IT IN THAT BLOCK IS NEVER REACHED. On the rewards page that took the CSV
// download, the modal's close button, the overlay's click-outside handler, the next-distribution date
// and the countdown timer with it. One missing button, seven dead features, and the only visible
// symptom is a single line in a console nobody has open.
//
// (`soroBtn` is a SOROBAN button — Stellar smart contracts. There is no equivalent here, so the right
// outcome is that the listener is simply not attached, which is what the guard produces.)
//
// WHAT THIS DOES NOT DO: invent the element, or delete the line. Both would change behaviour beyond
// the failure. It makes the lookup null-safe so the statement is a no-op and the rest of the block
// runs, which is exactly what would have happened had the design guarded it itself.
//
// The scan is general — it finds any id referenced with `.addEventListener` that is absent from that
// page's markup — and it REPORTS any other property it sees on a missing id rather than guessing a
// stub for it, so a new case surfaces as a build message instead of being silently skipped.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const RE_ANY = /document\.getElementById\('([^']+)'\)\.([A-Za-z]+)/g;

let files = 0, pages = 0, guarded = 0;
const fixed = {};
const unhandled = {};

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const h = json[key];

    // Which referenced ids are actually absent from THIS page.
    const missing = new Set();
    RE_ANY.lastIndex = 0;
    let m;
    while ((m = RE_ANY.exec(h))) {
      const id = m[1];
      if (h.indexOf('id="' + id + '"') >= 0) continue;         // the element is here; nothing to do
      if (m[2] === 'addEventListener') missing.add(id);
      else unhandled[id + '.' + m[2]] = (unhandled[id + '.' + m[2]] || 0) + 1;
    }
    if (!missing.size) continue;

    let out = h, touched = 0;
    for (const id of missing) {
      // Only the addEventListener form, and only for an id known absent. The stub swallows the call
      // so the statement completes and execution continues to the next line.
      const from = "document.getElementById('" + id + "').addEventListener(";
      const to = "(document.getElementById('" + id + "')||{addEventListener:function(){}}).addEventListener(";
      const parts = out.split(from);
      if (parts.length < 2) continue;
      touched += parts.length - 1;
      out = parts.join(to);
      fixed[id] = (fixed[id] || 0) + (parts.length - 1);
    }
    if (touched) { json[key] = out; guarded += touched; pages++; changed = true; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl orphan guards: ' + guarded + ' lookup(s) on ' + pages + ' page key(s) across '
  + files + ' container(s)');
for (const k of Object.keys(fixed)) console.log('   ' + k.padEnd(16) + fixed[k]);
const un = Object.keys(unhandled);
if (un.length) {
  console.error('  ! missing ids used with a property this transform does not stub:');
  for (const k of un) console.error('     ' + k + ' x' + unhandled[k]);
}
