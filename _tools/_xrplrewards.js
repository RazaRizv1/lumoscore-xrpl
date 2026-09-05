// Replace the Rewards page's Stellar layer with an XRP Ledger one.
//
// `lx-rewardsdata` asked people to "Connect your Stellar wallet" and listed recipients as Stellar
// G-addresses. It labelled its table "Illustrative preview — sample data", so it was not claiming
// those payouts had happened; it was the wrong ledger's fiction rather than a lie.
//
// The replacement makes eligibility REAL (read off the ledger for the connected account) and leaves
// the distribution report empty, because there is no source for past XRPL payouts. On a page about
// who got paid, invented recipients are the worst possible filler.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplrewards';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/rewards.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) {
    console.error('  a source file contains a closing script tag — aborting');
    process.exit(1);
  }
}

// The team exclusion is the whole point of this layer being careful, so assert the list actually
// travelled with it rather than discovering later that the page shipped without one.
if (page.indexOf('isTeamWallet') < 0 || core.indexOf('TEAM_WALLETS') < 0) {
  console.error('  ! team wallet exclusion missing from the injected sources — aborting');
  process.exit(1);
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('id="eligBox"') < 0) continue;

    const gone = stripById(h, 'lx-rewardsdata');
    h = gone.html;
    stripped += gone.removed;

    h = stripById(h, ID).html;

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl rewards: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar layer from ' + stripped);
if (!pages) console.error('  ! no page carried id="eligBox" — nothing was wired');
