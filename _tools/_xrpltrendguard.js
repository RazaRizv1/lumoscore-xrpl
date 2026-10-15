// The trending-tabs IIFE guards its RESULT but not its LOOKUP, and it crashes the dashboard.
//
// The health bot, two runs running, identical stack both times:
//   Uncaught TypeError: Cannot read properties of null (reading 'closest')
//     at /dashboard:2826:24
//     at /dashboard:2838:5
//
// Line 2826 of the XRPL dashboard is `const card = tList.closest('.market-card');` and 2838 is the
// `})();` that invokes it. `trendingList` does not exist on this page, so `.closest` runs on null.
// An uncaught throw stops the REST of that script block dead, which is how this codebase has lost
// whole features to one missing id before.
//
// THIS IS STELLAR'S BUG, INHERITED. _page_fixes.js fixed it there on 2026-10-13; the fork copies
// Stellar's BUILT containers, and this copy predates that fix. Measured: 0 occurrences of the guard
// in either XRPL container. Nothing here is new work -- it is the same three edits, ported.
//
// WHY IT TOOK TWO DAYS TO SEE. It did not reproduce in eight loads, because /dashboard is authgated:
// without a seeded lumos.address the page bounces to "/" and the trending IIFE never runs. The bot
// seeds it, so the bot saw it every time and a hand-run never did. And the line numbers pointed at
// innocent markup, because /dashboard is one of the shared pages the combine maps per lx_chain --
// without that cookie you are reading STELLAR's file (3,267 lines), while the error is in XRPL's
// (14,772). Both of those sent me to the wrong place first; they are written down so the next
// person skips it.
//
// THREE EDITS, because one is not enough:
//
//  1. The mobile form. `const card = tList.closest(...)` -> guard the captured variable.
//
//  2. renderTrending. GUARDING THE LOOKUP ONLY MOVES THE CRASH -- Stellar measured that exactly:
//     the throw became "Cannot set properties of null (setting 'innerHTML')" one line later, because
//     tList is captured at module scope and renderTrending opens with `tList.innerHTML = ''`. The
//     function returns when it has nothing to draw into; no call site uses its return value.
//
//  3. The desktop form, which INLINES the lookup instead of reusing the captured variable. It is
//     absent from this fork today (0 occurrences, both containers) and is applied anyway, so a
//     future re-seed from Stellar's containers cannot reintroduce it silently.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

const stats = { mobile: 0, draw: 0, desktop: 0 };

function fix(h) {
  // 1. mobile: naturally idempotent, the replacement does not contain the search string
  if (h.indexOf("const card = tList.closest('.market-card');") >= 0) {
    h = h.split("const card = tList.closest('.market-card');")
         .join("const card = tList && tList.closest('.market-card');");
    stats.mobile++;
  }

  // 2. renderTrending: NORMALISE, DO NOT WRAP. The replacement contains its own search string, so a
  //    plain split/join appends another "if (!tList) return;" on every build. Strip first, add once.
  if (h.indexOf('function renderTrending(period) {') >= 0) {
    while (h.indexOf('function renderTrending(period) { if (!tList) return;') >= 0) {
      h = h.split('function renderTrending(period) { if (!tList) return;')
           .join('function renderTrending(period) {');
    }
    h = h.split('function renderTrending(period) {')
         .join('function renderTrending(period) { if (!tList) return;');
    stats.draw++;
  }

  // 3. desktop
  if (h.indexOf("getElementById('trendingList').closest(") >= 0) {
    h = h.split("const card = document.getElementById('trendingList').closest('.market-card');")
         .join("const trEl = document.getElementById('trendingList');"
             + " const card = trEl && trEl.closest('.market-card');");
    stats.desktop++;
  }
  return h;
}

let pages = 0;
const staged = [];

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  if (!fs.existsSync(file)) { console.error('  ' + file + ': missing — skipped'); continue; }
  const data = read(file);
  const { json, s, e } = getContents(data);
  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const before = json[key];
    const after = fix(before);
    if (after !== before) { json[key] = after; touched++; pages++; }
  }
  staged.push({ file, data, s, e, json, touched });
}

// Silence is the failure mode. renderTrending exists in both containers today; if the design ever
// renames it this stops matching, and without this it would report success while shipping the crash.
if (!stats.draw) {
  console.error('xrpl trend guard: ABORT — renderTrending was not found in either container.');
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

console.log('xrpl trend guard: ' + pages + ' page key(s) — mobile lookup:' + stats.mobile
  + ', renderTrending:' + stats.draw + ', desktop lookup:' + stats.desktop);
