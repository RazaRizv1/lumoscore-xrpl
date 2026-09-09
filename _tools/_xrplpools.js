// Replace the Pools page's Stellar layer with an XRP Ledger one.
//
// `lx-ammdata` is ~286KB and ships on FOUR pages -- dashboard, pools, pool detail and account. It
// was walking Stellar's Horizon on an XRP Ledger site: the Pools page announced "Ranking the
// network's pools… 7,800 scanned so far" and then rendered TVL in XLM.
//
// It is stripped from every page that carries it, but this layer is only INJECTED where the pools
// table actually lives. Removing a wrong-chain data layer is always right; adding a pools renderer
// to the dashboard is not, and those two pages need their own work.
//
// Stripping goes through stripById rather than a regex -- see _tools/stripscript.js for why -- and
// at 286KB this is exactly the size where a mangled pattern fails silently and reports success.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplpools';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/pools.js', 'utf8');
// My Positions. Separate from pools.js because it answers a different question — that file lists
// the network's pools, this one lists the connected account's own. It needs xrpl-core's LP-token
// and currency decoders, which are injected above it.
const mine = fs.readFileSync(__dirname + '/browser/mypositions.js', 'utf8');

for (const src of [core, page, mine]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n' + mine + '\n</' + 'script>';

let files = 0, injected = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];

    // Strip everywhere it appears; it is the wrong chain on every one of them.
    const gone = stripById(h, 'lx-ammdata');
    if (!gone.removed && h.indexOf('id="poolsBody"') < 0) continue;
    h = gone.html;
    stripped += gone.removed;

    h = stripById(h, ID).html;

    // Inject only where the table is.
    if (h.indexOf('id="poolsBody"') >= 0) {
      const bi = h.lastIndexOf('</' + 'body>');
      if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
      h = h.slice(0, bi) + SCRIPT + h.slice(bi);
      injected++;
    }
    json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl pools: injected on ' + injected + ' page key(s) across ' + files
  + ' container(s); stripped lx-ammdata from ' + stripped);
if (!injected) console.error('  ! no page carried id="poolsBody" — nothing was wired');
