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

let files = 0, pages = 0, stripped = 0, ann = 0;
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

    // THE "Read the announcement" LINKS, the XRPL half of a fix Stellar got in _rewardslinks.js on
    // 2026-10-09. Three faults in one href, found in a mobile audit:
    //
    //   https://lumoscore.com/blogs/introducing-native-lp-rewards-for-lumos  target="_blank"
    //
    // ABSOLUTE, so on staging it leaves for production -- which is what makes a staging check
    // meaningless; "/blogs/" 301s to "/blog/", a redirect hop paid on a phone; and target="_blank"
    // opens a new tab for an internal link, without rel=noopener. Dropping the target settles the
    // last two at once. The DESTINATION is unchanged: only the form of the url.
    // `blogs?`, NOT `blogs`, AND THAT IS WHAT MAKES THIS RE-RUNNABLE. The original pattern matched
    // only the absolute `/blogs/` spelling. Something downstream re-absolutises these hrefs, so by the
    // second chain run they read `https://lumoscore.com/blog/…` — path already corrected, still
    // absolute. The regex then matched nothing, annRel counted 0 against annBefore 3, and the guard
    // below aborted the whole chain on a build that was otherwise fine (2026-10-09: a second
    // rebuild.js in a row failed where the first had passed).
    //
    // Matching either spelling fixes both halves: the link ends up relative whichever form it arrives
    // in, and a run where they are ALREADY relative counts 3 and 3 and passes. The guard keeps its
    // teeth for the case it was written for — an href shape nobody anticipated — without firing on
    // the one it creates itself.
    const annBefore = (h.match(/<a class="blog"/g) || []).length;
    h = h.replace(/<a class="blog" href="https:\/\/lumoscore\.com\/blogs?\/([A-Za-z0-9-]+)"[^>]*>/g,
      '<a class="blog" href="/blog/$1">');
    const annRel = (h.match(/<a class="blog" href="\/blog\//g) || []).length;
    if (annBefore && annRel !== annBefore) {
      console.error('  ! ' + key + ': ' + annBefore + ' announcement link(s), only ' + annRel
        + ' relative afterwards — the href shape changed');
      process.exit(1);
    }
    ann += annRel;

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
  + ' container(s); stripped the Stellar layer from ' + stripped + '; ' + ann + ' announcement link(s) made relative');
if (!pages) console.error('  ! no page carried id="eligBox" — nothing was wired');
