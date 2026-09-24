// Blank the Market Overview's inherited figures IN THE MARKUP.
//
// RAZA 2026-09-17, reporting it for the second time: "On pools main page, theres a flash bug. While the page is
// refreshed, it show these values for split seconds" — 12.7M APT, 100 active pools, $21,483.83, "51,250 APT swapped".
//
// The first attempt cleared them from pools.js at script time, which is too late by definition: the browser can paint
// the parsed document before a script at the end of the body runs, and on a reload with warm CSS it usually does. A
// value that must never be seen cannot be removed by a script — it has to not be in the file. This empties them here,
// so the page ships with placeholders and the layer fills them in as it always did.
//
// WHICH ONES. Every `amm-snapshot-value` and `amm-snapshot-vsub` is a figure. `amm-snapshot-sub` is BOTH: "51,250 APT
// swapped" is mock data, "Across all pools" and "Unique LP wallets" are captions that belong to the design and must
// survive — so only the ones carrying a digit are cleared.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

function blank(html) {
  let n = 0;
  let out = html.replace(/(<div class="amm-snapshot-value">)([\s\S]*?)(<\/div>)/g, (m, a, inner, c) => {
    if (inner === '&mdash;' || inner === '—') return m;
    n++;
    return a + '—' + c;
  });
  out = out.replace(/(<div class="amm-snapshot-vsub">)([\s\S]*?)(<\/div>)/g, (m, a, inner, c) => {
    if (!inner) return m;
    n++;
    return a + c;
  });
  out = out.replace(/(<div class="amm-snapshot-sub([^"]*)">)([\s\S]*?)(<\/div>)/g, (m, a, extra, inner, c) => {
    if (!inner || !/\d/.test(inner)) return m;            // a caption, not a figure
    n++;
    return a + c;
  });
  return { html: out, n };
}

let pages = 0, cleared = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    if (json[key].indexOf('amm-snapshot-row') < 0) continue;
    const r = blank(json[key]);
    if (!r.n) continue;
    json[key] = r.html;
    pages++;
    cleared += r.n;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('xrpl pools overview mock: ' + cleared + ' figure(s) blanked on ' + pages + ' page key(s)');
