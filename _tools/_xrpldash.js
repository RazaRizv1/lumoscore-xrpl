// Wire the dashboard to real XRP Ledger data.
//
// NOTE, 2026-09-08: this file used to say there was no inherited Stellar data layer to strip here.
// That was true of the OLD fork base. The build now starts from Stellar's current containers, which
// ship several, and the strip below is why. Keep it in step when Stellar adds another.
//
// When the fork was taken the dashboard shipped with NO data layer at all, so every figure on it
// was the design's static mock
// sitting in the markup: XRP at $0.245 (which is XLM's price, relabelled), 4,234 assets against
// 20,362, 4,521 pools against 30,648, and a "Platform Activity" feed of invented transactions
// animated with a live pulse.
//
// That last one is why this page could not be left for later. A blank section reads as unfinished;
// a feed of fabricated transactions with ticking timestamps reads as real.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpldash';
const page = fs.readFileSync(__dirname + '/browser/dashboard.js', 'utf8');

if (page.indexOf('</' + 'script') >= 0) {
  console.error('  dashboard.js contains a closing script tag — aborting');
  process.exit(1);
}

const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

// The dashboard is identified by markup it alone carries. `.status-row` also appears on other
// pages, so the activity feed is required as well -- guarding on one of them wired six pages the
// first time this shape of check was written.
function isDashboard(h) {
  return h.indexOf('id="activityList"') >= 0 && h.indexOf('status-row') >= 0;
}

// Remove the element that starts at `openMarker`, by COUNTING TAGS rather than by searching for a
// comment or a closing tag. Desktop and mobile label this block differently -- "<!-- Trending
// tokens -->" against "<!-- ===== Trending ===== -->" -- and the desktop copy is followed by a
// sibling while the mobile one is not, so no single textual anchor closes both. Depth counting is
// the only boundary that holds for both.
function removeElement(h, openMarker) {
  const start = h.indexOf(openMarker);
  if (start < 0) return { html: h, removed: 0 };

  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(h))) {
    depth += (m[0][1] === '/') ? -1 : 1;
    if (depth === 0) {
      const end = m.index + m[0].length;
      // Take an immediately preceding HTML comment with it, so no orphan label is left behind.
      let from = start;
      const before = h.slice(Math.max(0, start - 200), start);
      const cm = before.lastIndexOf('<!--');
      if (cm >= 0 && before.indexOf('-->', cm) >= 0 && !/<\/?div/i.test(before.slice(cm))) {
        from = Math.max(0, start - 200) + cm;
      }
      return { html: h.slice(0, from) + h.slice(end), removed: 1 };
    }
  }
  return { html: h, removed: 0 };                    // unbalanced: leave the markup alone
}

let files = 0, pages = 0, trendingDropped = 0, gridFixed = 0, orphansFixed = 0, stellarLayers = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (!isDashboard(h)) continue;

    h = stripById(h, ID).html;                      // idempotent: re-running replaces, never stacks

    // THE INHERITED STELLAR DATA LAYERS.
    //
    // The note at the top of this file used to say there was none to strip here. That was true of
    // the old fork base, which predated them. The build now starts from Stellar's CURRENT
    // containers, which ship several — and they call endpoints this project does not serve.
    // Measured on the deployed dashboard: /lxapi/netstats, /lxapi/xlm, /lxapi/poolstats,
    // /lxapi/pools and /lxapi/blog all 404, repeatedly, on every load.
    //
    // The dead requests are the smaller half of the problem. lx-realdata paints the SAME figures
    // lx-xrpldash paints, so leaving it in place puts two writers on one element and whichever
    // loses the race owns the screen — the class of bug that is impossible to reproduce on demand.
    //
    // Only layers with no UI of their own are listed. lx-dashboxes (the product cards),
    // lx-swapcalc and lx-qorders own controls the design expects to be there, so they are left
    // alone until XRPL data is wired into them; removing them would change the design.
    for (const sid of ['lx-realdata', 'lx-poolwarm', 'lx-dashtop', 'lx-dashblogdata']) {
      const r = stripById(h, sid);
      h = r.html;
      stellarLayers += r.removed;
    }

    // THE TRENDING CARD IS REMOVED, not hidden. It was dropped from the Stellar dashboard and
    // should never have been carried into this one. Taking it out of the markup rather than
    // hiding it with CSS or script means it costs nothing to load and cannot flash on the way to
    // being hidden.
    const gone = removeElement(h, '<div class="market-card"');
    h = gone.html;
    trendingDropped += gone.removed;

    // The desktop grid was drawn for two cards: `1fr 460px`. With trending gone the activity feed
    // would sit in the 1fr column and leave a 460px hole beside it, so the second column goes too.
    // Mobile stacks and carries no such rule, hence the count rather than an assumption.
    if (gone.removed && h.indexOf('grid-template-columns: 1fr 460px') >= 0) {
      h = h.split('grid-template-columns: 1fr 460px').join('grid-template-columns: 1fr');
      gridFixed++;
    }

    // THE DESIGN'S OWN TRENDING SCRIPT NOW LOOKS FOR AN ELEMENT THAT IS GONE, and it does so
    // without a null check:
    //     document.getElementById('trendingList').closest('.market-card')
    // That throws, and the throw kills the REST OF ITS SCRIPT BLOCK -- 20KB shared with the
    // time-of-day greeting and, after the trending code, the whole search-box wiring. Removing
    // markup silently broke search on this page.
    //
    // The block is not deleted, because it is shared. Only the two lookups are made safe, which
    // leaves the dead trending code inert. It deserves to be inert: renderTrending('7d') did not
    // read a 7-day figure at all, it MULTIPLIED the 24h change by 2.3 and added 4.2.
    for (const [bad, good] of [
      ["document.getElementById('trendingList').closest('.market-card')",
        "(document.getElementById('trendingList')||{closest:function(){return null;}}).closest('.market-card')"],
      ['function renderTrending(period) {',
        "function renderTrending(period) {\n    if (!document.getElementById('trendingList')) return;"],
    ]) {
      if (h.indexOf(bad) >= 0) { h = h.split(bad).join(good); orphansFixed++; }
    }

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl dashboard: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped ' + stellarLayers + ' Stellar data layer(s); removed the trending card from ' + trendingDropped
  + ', closed the grid gap on ' + gridFixed + ' and made ' + orphansFixed
  + ' orphaned lookup(s) safe');
if (!pages) console.error('  ! no page carried the dashboard markup — nothing was wired');
