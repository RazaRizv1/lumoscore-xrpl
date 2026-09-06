// Restore the card-reveal driver on every page that lost it.
//
// The motion layer hides cards at opacity:0 until a script marks them done. Stripping the Stellar
// data bundles took that script with it on some pages, leaving them permanently blank below the
// fold -- with a perfectly correct DOM. See browser/reveal.js for the full description.
//
// WIRED BY MEASUREMENT, NOT BY GUESSWORK. A page is repaired only if it both (a) carries the CSS
// that hides cards, and (b) lacks a driver that adds `lcm-on`. Injecting where a driver already
// exists would run two staggered animations over the same cards.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplreveal';
const page = fs.readFileSync(__dirname + '/browser/reveal.js', 'utf8');

if (page.indexOf('</' + 'script') >= 0) {
  console.error('  reveal.js contains a closing script tag — aborting');
  process.exit(1);
}

const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

// The hiding rule, and the driver that answers it. Both are matched on text that appears in the
// page verbatim.
const HIDES = 'lcm-ready';
const HAS_DRIVER = /classList\.add\(['"]lcm-on['"]\)/;

let files = 0, pages = 0, skipped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    if (h.indexOf(HIDES) < 0) continue;                 // no motion layer: nothing to reveal

    // Ignore this file's own previous injection when deciding whether a driver is present,
    // otherwise a second run would see itself and skip.
    const without = stripById(h, ID).html;
    if (HAS_DRIVER.test(without)) { skipped++; json[key] = without; continue; }

    h = without;
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl card reveal: restored on ' + pages + ' page key(s) across ' + files
  + ' container(s); ' + skipped + ' already had a driver');
if (!pages) console.error('  ! no page needed the reveal driver — check the detection');
