// Does running the build chain twice produce the same site twice?
//
// It is supposed to, and for a long time it did not. Two separate transforms were rewriting their
// own output on every build:
//
//   * _xrplchoosenet emitted the design filename "lumoscore-home.html" and _xrplroutes rewrote it to
//     /dashboard immediately after — 128 of them, which was the ENTIRE "route references
//     rewritten" figure on a chain re-run. Permanent noise in a run report destroys the zero: nobody
//     can spot a real drift in a number that is never zero.
//
//   * _xrpldash guarded an orphaned lookup by rewriting "function renderTrending(period) {" to itself
//     plus a null guard — a replacement CONTAINING its own search string, so it matched again next
//     build and appended another copy. Six shipped. A duplicated guard is harmless, which is exactly
//     why nothing surfaced it in six builds.
//
// Neither produced a console error, a failing test, or a predeploy warning. The site worked. The only
// thing that finds this class is diffing two consecutive runs, so that check lives here rather than
// in someone's memory of having once done it by hand.
//
// SAFETY: this runs the chain and the build, both of which rewrite the gitignored containers and
// dist — exactly what a normal build does, and nothing else. It does NOT deploy. It is for
// C:\LumosCore-XRPL only; main is production and is never rebuilt to satisfy a check.
//
// Usage: npm run idem
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function run(label) {
  process.stdout.write('  ' + label + ' ... ');
  execFileSync(process.execPath, [path.join(ROOT, '_tools', 'rebuild.js')], { cwd: ROOT, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(ROOT, '_tools', 'extract_site.js'), 'xrpl', '--root'],
    { cwd: ROOT, stdio: 'pipe' });
  console.log('done');
}

// A map of every built file to its hash. Comparing hashes rather than copying the tree keeps this
// cheap on a 93MB dist, and names the exact files that moved rather than just saying "they differ".
function snapshot() {
  const out = new Map();
  for (const f of fs.readdirSync(DIST)) {
    const p = path.join(DIST, f);
    if (!fs.statSync(p).isFile()) continue;
    out.set(f, crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'));
  }
  return out;
}

console.log('\n  Chain idempotence — two full runs must produce the same site\n');

run('run 1');
const a = snapshot();
run('run 2');
const b = snapshot();

const changed = [];
for (const [f, h] of a) {
  if (!b.has(f)) changed.push([f, 'disappeared on the second run']);
  else if (b.get(f) !== h) changed.push([f, 'differs between runs']);
}
for (const f of b.keys()) if (!a.has(f)) changed.push([f, 'appeared only on the second run']);

console.log('\n  files compared: ' + a.size);

if (!changed.length) {
  console.log('\n  PASS — two consecutive chain runs produced byte-identical output.\n');
  process.exit(0);
}

console.log('\n  FAIL — the chain is not idempotent. ' + changed.length + ' file(s) moved:\n');
for (const [f, why] of changed.slice(0, 20)) console.log('    ' + f.padEnd(46) + why);
if (changed.length > 20) console.log('    ... and ' + (changed.length - 20) + ' more');
console.log('\n  A transform is rewriting its own output. The usual cause is a replacement that');
console.log('  CONTAINS its search string, which re-matches and appends a copy every build.');
console.log('  Diff a changed file against git to see what was added:');
console.log('      git diff --word-diff=porcelain -U0 -- dist/' + changed[0][0] + '\n');
process.exit(1);
