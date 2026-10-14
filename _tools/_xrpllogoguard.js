// The logo healer eats display numbers. One guard, added where the healer already has one.
//
// WHAT IT DOES. Inside nxnav-js there is a "healer" whose run() walks EVERY span/div/i/b on the page,
// takes any element whose trimmed text is 1-5 characters, resolves it as a ticker, and on a hit calls
// place() -- which wipes textContent and paints a logo as a background image. It re-runs on a timer,
// so cleaning up after it loses.
//
// WHAT IT ATE. The $LUMOS supply card's headline, "1B". Measured on staging 2026-10-14 by trapping
// the textContent setter: place() blanked `.supply-totem .big` 108 times in 13 seconds, about every
// 130ms. The div then had no text and no intrinsic height, so it collapsed to 0px -- the card read
// "TOTAL SUPPLY / (nothing) / LUMOS". Not a regression: the same blank is on the deployment before
// this work, so it has been shipping for as long as the card has.
//
// WHY THAT ELEMENT. The healer's isCandidate() already rejects pure digits -- "step dots / counters,
// never a token", in its own words -- but "1B" is not pure digits, and looksLikeIcon() returns true
// for any element with a gradient background. `.supply-totem .big` has one: that is how the design
// paints gradient TEXT (`background: linear-gradient(...)` + `background-clip: text`). So the very
// styling that makes the number look like a headline is what makes it look like an icon.
//
// WHY A GUARD AND NOT AN ESCAPE. The escapes we know work are narrow and awkward: an inert <img>
// child, or drawing the text with ::before. Both fix one element. This is a class of bug -- any
// "9.97B", "1.5M" or "$12K" sitting in a styled box is one re-render away from vanishing -- and the
// healer's own rule already says what it means to exclude. A number with a magnitude suffix is never
// a ticker, so it belongs beside the rule that says digits are never a ticker.
//
// `1INCH` DELIBERATELY STILL PASSES. The pattern anchors a magnitude suffix at the end, so "1B",
// "9.97B", "1,000" and "1.5M" are rejected while a real ticker that merely starts with a digit is
// not. That is the one case worth getting wrong in the safe direction: a missed logo is cosmetic, an
// erased number is a lie about supply.
//
// NOT DONE ON STELLAR. The same healer and the same gap exist there -- it is inherited design code,
// not fork drift -- but this repo does not write to C:/LumosCore. Logged for that side separately.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// The healer's existing rule, as it appears in the decoded page source.
const FIND = 'if(/^' + B + 'd+$/.test(t)) return false;';
// Ours, appended to it. Kept on the same line so no newline escaping is involved.
const ADD = ' if(/^' + B + 'd[' + B + 'd.,]*[KMBT]?$/i.test(t)) return false;';
// Anything already carrying this has been patched; the replacement contains its own search string,
// so without this check a second run would append the guard again, and a third would add a third.
const MARK = '[KMBT]?$/i.test(t)';

const problems = [];
const staged = [];
let found = 0, added = 0, already = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  if (!fs.existsSync(file)) { problems.push(file + ': missing'); continue; }
  const data = read(file);
  let json, s, e;
  try { ({ json, s, e } = getContents(data)); } catch (err) { problems.push(file + ': ' + err.message); continue; }

  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const h = json[key];
    const n = h.split(FIND).length - 1;
    if (!n) continue;
    found += n;
    if (h.indexOf(MARK) >= 0) { already += n; continue; }
    json[key] = h.split(FIND).join(FIND + ADD);
    added += n;
    touched += n;
  }
  staged.push({ file, data, s, e, json, touched });
}

// Silence is the failure mode. If the healer is ever re-minified or its comment re-indented this
// stops matching, and without this it would report success while shipping the bug.
if (!found) problems.push('the healer guard was not found in either container ' + B + 'u2014 has nxnav-js changed?');

if (problems.length) {
  console.error('xrpl logo guard: ABORT, nothing written.');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

console.log('xrpl logo guard: ' + added + ' copy(ies) guarded'
  + (already ? ', ' + already + ' already had it' : '')
  + ' (' + found + ' healer copies seen)');
