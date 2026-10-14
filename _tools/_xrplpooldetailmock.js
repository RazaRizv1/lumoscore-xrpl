// Blank the pool-detail page's inherited figures IN THE MARKUP.
//
// The health bot, 2026-10-14, on /pools/xrpl/id/<amm>:
//   desktop   "847" -> "19"                               (held 653ms, corrected at 1189ms)
//   phone     "ID: a468d4…0088" -> "Pool ID: rnPQqk…aF4U"  (held 375ms, corrected at 2904ms)
//   phone     "0.000713 APT" -> "0.0(4)2943 XRP"           (same window)
//
// Every one of those is the design's own sample data, shipped in the file: a pool that does not
// exist, priced in APT, with 847 participants. The page then replaces it with the real pool. For up
// to 2.5 seconds the page states something false and specific, which is worse than stating nothing.
//
// SAME REASONING AS _xrplpoolsmock, and the same conclusion. A value that must never be seen cannot
// be removed by a script: the browser paints the parsed document before a script at the end of the
// body runs, and on a reload with warm CSS it usually does. So it has to not be in the file.
//
// WHY NOT JUST EXTEND THE CSS MASK. There is one -- html:not(.lx-detpr) -- inherited from Stellar,
// and it already covers .ph-price .v, .ph-stat, .ph-name and my-position. Two of the three slots
// above are simply missing from it, and adding them would fix the phone price and the pool id,
// because paint() writes both and then lifts the gate itself.
//
// It would NOT fix the participant count. That pill is written by renderParticipants(), not by
// paint(), so the gate opens while the pill still reads 847 -- masking moves the flash later rather
// than removing it. A gate that opens before the value it guards is the exact shape of the bug this
// project keeps re-finding, so the count is emptied here instead and the mask is left alone.
//
// The copy button's data-copy is cleared with the id it belongs to. It carries the mock pool id,
// and a click landing in that window puts a fabricated id on the user's clipboard -- a wrong value
// that outlives the page.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// Targeted by the mock's own content rather than by structure: it names exactly what is being
// removed, and it cannot quietly take a real value with it if the design's markup is rearranged.
const RULES = [
  // The participants pill. Scoped to .side-head so the tab counters elsewhere are untouched.
  { id: 'count', find: /(<div class="side-head">[\s\S]{0,200}?<span class="count-pill">)\d[\d,]*(<\/span>)/g, repl: '$1$2' },
  // The pool id, desktop ("Pool ID: …") and phone ("ID: …") wording both.
  { id: 'poolid', find: /(<div class="ph-id">\s*<span>)(?:Pool )?ID: a468d4[^<]*(<\/span>)/g, repl: '$1$2' },
  // The clipboard target that goes with it.
  { id: 'copy', find: /data-copy="a468d4[^"]*"/g, repl: 'data-copy=""' },
  // The price, in both page builds: desktop .ph-price .v/.s, phone .ph-price-row .value/.vs.
  { id: 'price', find: /(<div class="(?:v|value)">)0\.000713 APT(<\/div>)/g, repl: '$1$2' },
  { id: 'pricesub', find: /(<div class="(?:s|vs)">)\$0\.000108[^<]*(<\/div>)/g, repl: '$1$2' },
];

let pages = 0;
const applied = {};
const staged = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);

  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (json[key].indexOf('class="ph-id"') < 0) continue;      // the pool detail pages, and only those
    let h = json[key];
    const before = h;
    for (const r of RULES) {
      const n = (h.match(r.find) || []).length;
      if (!n) continue;
      h = h.replace(r.find, r.repl);
      applied[r.id] = (applied[r.id] || 0) + n;
      touched += n;
    }
    if (h !== before) { json[key] = h; pages++; }
  }
  staged.push({ file, data, s, e, json, touched });
}

// Silence is the failure mode: a re-indented template or a changed sample value would leave this
// matching nothing, reporting success, and shipping the flash. Idempotent by nature -- once the
// mock is gone there is nothing to match -- so "already clean" is only legitimate on a re-run,
// which is what the second condition distinguishes.
const total = Object.keys(applied).reduce((n, k) => n + applied[k], 0);
const anyPage = staged.some((st) => Object.keys(st.json).some((k) => typeof st.json[k] === 'string'
  && st.json[k].indexOf('class="ph-id"') >= 0));
if (!anyPage) {
  console.error('xrpl pool detail mock: ABORT — no page carries class="ph-id"; has the detail page moved?');
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

console.log('xrpl pool detail mock: ' + total + ' figure(s) blanked on ' + pages + ' page key(s)'
  + (total ? ' — ' + Object.keys(applied).map((k) => k + ':' + applied[k]).join(', ') : ' (already clean)'));
