// One spelling: "trustline".
//
// Audit item 29. This build used both forms, measured on the built site: 637 one-word against 59
// spaced — "trust line" ×46, "trust lines" ×10, "Trust Lines" ×3. Stellar uses one-word 689 times
// and spaced ZERO times, so the split is this fork's alone, and it is the sort of thing that reads
// as carelessness rather than as a decision: the Trustlines dialog is titled one way and the
// sentence describing it is titled the other.
//
// WHICH WAY, AND WHY ONE-WORD. The XRP Ledger's own documentation writes "trust line", so the
// spaced form has a real claim — it lost on two grounds. It is the minority here by eleven to one,
// so normalising the other way would mean 637 edits instead of 59, across dialogs, docs, FAQ copy
// and structured data. And the whole point of this fork is to read as the same product as Stellar,
// which settled on one word. Reversible: swap the pairs below.
//
// SAFE BECAUSE OF THE SPACE. Every replacement here matches a string containing a space, so none of
// them can be a class name, an id, a data attribute or a url — "/docs/trustlines" and
// `lxw-trustline` cannot match. That is what makes a blind text pass acceptable where it would not
// be for the one-word form.
//
// LATE IN THE CHAIN, after the passes that write this copy. `_xrplseo.js` had "trust lines" in two
// of its descriptions, and its table is fixed at source as well — but a transform that writes prose
// could reintroduce the spaced form at any time, so this runs after all of them rather than trusting
// each one to stay correct.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// Longest first: "trust lines" must be matched before "trust line", or the shorter rule leaves a
// stray "s" behind and turns the plural into "trustlines" spelled "trustline s".
const PAIRS = [
  ['Trust Lines', 'Trustlines'],
  ['Trust Line', 'Trustline'],
  ['trust lines', 'trustlines'],
  ['trust line', 'trustline'],
  ['Trust lines', 'Trustlines'],
  ['Trust line', 'Trustline'],
];

const problems = [];
const staged = [];
const applied = {};

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  if (!fs.existsSync(file)) { problems.push(file + ': missing'); continue; }
  const data = read(file);
  let json, s, e;
  try { ({ json, s, e } = getContents(data)); } catch (err) { problems.push(file + ': ' + err.message); continue; }

  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const before = h;
    for (const [from, to] of PAIRS) {
      const n = h.split(from).length - 1;
      if (!n) continue;
      h = h.split(from).join(to);
      applied[from] = (applied[from] || 0) + n;
      touched += n;
    }
    if (h !== before) json[key] = h;
  }
  staged.push({ file, data, s, e, json, touched });
}

// Nothing left spelled with a space, anywhere. Zero replacements is the expected steady state once
// this has run, so silence is only a failure if a spaced form survives it.
if (!problems.length) {
  for (const st of staged) {
    for (const key of Object.keys(st.json)) {
      const h = st.json[key];
      if (typeof h !== 'string') continue;
      const left = h.match(/[Tt]rust [Ll]ines?/g);
      if (left) problems.push(key + ': ' + left.length + ' spaced form(s) survived — ' + [...new Set(left)].join(', '));
    }
  }
}

if (problems.length) {
  console.error('xrpl trustline: ABORT — nothing written.');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

const total = Object.keys(applied).reduce((n, k) => n + applied[k], 0);
console.log('xrpl trustline: ' + total + ' spaced form(s) normalised'
  + (total ? ' — ' + Object.keys(applied).map((k) => '"' + k + '":' + applied[k]).join(', ') : ' (already consistent)'));
