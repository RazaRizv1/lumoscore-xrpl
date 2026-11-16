// Phone bottom bar: Launch instead of Pools (RAZA, 2026-11-16: "add launchpad icon on mobile below (Stellar and XRPL)
// instead of pools. I have already done that on near. so you need to do the exact same tihng on Stellar and XRPL as
// well."). XRPL twin of Stellar's _mobnavlaunch.js and of NEAR's _nearnavlaunch.js, which shipped the same swap on
// 2026-11-14 for the reason RAZA gave then: the launchpad "is a more important feature than pools and pools is already
// accessible in the side menu".
//
// The bar (`nav.nb-bar`) is inherited design markup on 37 pages of the mobile container, five `a.nb-tab`s. Only the
// Pools tab is replaced, in place, so the bar keeps its order, its size and the script-positioned rail under the active
// tab. The pool pages lose their highlighted tab (as every page outside the bar already does); the launchpad page gets
// its own bar from _xrpllaunchbar.js, with Launch lit. Desktop has no bottom bar and is untouched.
//
// THE ROCKET IS LIFTED, THE HREF IS NOT. The icon comes from the page's OWN side-menu launchpad link, so it cannot
// drift from the design's icon set. The link does NOT: this fork's side menu points at `/launchpad`, which is the HUB
// -- the page that asks whether you want Stellar, the XRP Ledger or NEAR. Going through it costs a tap that NEAR's bar
// does not, since NEAR's Launch goes straight to `/launchpad/near`. RAZA, 2026-11-16, on seeing the three disagree:
// "yes make stellar and xrpl go straight to their own launchpad". So the tab is pinned to this fork's own launchpad.
//
// Hard-coding it is safe here precisely because it is this fork's route and not Stellar's: this container already holds
// rewritten routes (`/pools/xrpl` where Stellar has `lumoscore-amm-mobile.html`), so an absolute route is the native
// form and survives the build unrewritten.
//
// Idempotent, and self-repairing: the swap runs only where a Pools tab is left, while the href is re-pinned on EVERY
// bar every run. That second pass is what lets this file correct bars an earlier version of it already wrote.
const LAUNCH_HREF = '/launchpad/xrpl';
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const CONTAINER = 'lumoscore-xrpl-mobile.html';
const POOLS = /<a class="nb-tab(?: active)?" data-id="pools" href="[^"]*">[\s\S]*?<\/a>/g;
const MENU_LINK = /<a href="([^"]*)" data-lxnav="1">(<svg\b[\s\S]*?<\/svg>)/g;
const ROCKET_PATH = 'M4.5 16.5';

function launchFromMenu(h) {
  MENU_LINK.lastIndex = 0;
  let m;
  while ((m = MENU_LINK.exec(h))) {
    if (m[2].indexOf(ROCKET_PATH) >= 0) return { href: m[1], svg: m[2] };
  }
  return null;
}

const data = read(CONTAINER);
const { json, s, e } = getContents(data);

// The Launch tab's href, wherever it already sits in a bar. Scoped to the bar by the class+data-id, so the side-menu
// launchpad row -- which keeps pointing at the hub, as the design intends -- is not touched.
const LAUNCH_HREF_RE = /(<a class="nb-tab(?: active)?" data-id="launch" href=")([^"]*)(")/g;

let bars = 0, swapped = 0, repinned = 0;
for (const k of Object.keys(json)) {
  let h = json[k];
  if (typeof h !== 'string' || h.indexOf('class="nb-bar"') < 0) continue;
  bars++;
  const before = h;

  const c = (h.match(POOLS) || []).length;
  if (c > 1) { console.error('xrpl nav ABORT: ' + k + ' has ' + c + ' Pools tabs'); process.exit(1); }
  if (c === 1) {
    const L = launchFromMenu(h);
    if (!L) { console.error('xrpl nav ABORT: ' + k + ' has no side-menu launchpad link to copy the rocket from'); process.exit(1); }
    const LAUNCH = '<a class="nb-tab" data-id="launch" href="' + LAUNCH_HREF + '"><span class="nb-ico">'
      + L.svg + '</span><span class="nb-lbl">Launch</span></a>';
    h = h.replace(POOLS, () => LAUNCH);
    swapped++;
  } else if (h.indexOf('data-id="launch"') < 0) {
    console.error('xrpl nav ABORT: ' + k + ' has a bar with neither Pools nor Launch'); process.exit(1);
  }

  // Re-pin every run, so a bar written by an earlier version of this file is corrected rather than left behind.
  const n = (h.match(LAUNCH_HREF_RE) || []).length;
  if (!n) { console.error('xrpl nav ABORT: ' + k + ' ended with no Launch tab to pin'); process.exit(1); }
  const fixed = h.replace(LAUNCH_HREF_RE, (_m, a, _old, z) => a + LAUNCH_HREF + z);
  if (fixed !== h) repinned++;
  h = fixed;

  if (h !== before) json[k] = h;
}

if (!bars) { console.error('xrpl nav ABORT: no page carried the bottom bar'); process.exit(1); }

if (swapped || repinned) {
  fs.writeFileSync(CONTAINER, data.slice(0, s) + JSON.stringify(json).split('</').join('<' + B + '/') + data.slice(e), 'utf8');
}
console.log('xrpl nav: Launch tab on ' + bars + ' bar(s), ' + swapped + ' swapped this run, '
  + repinned + ' href(s) re-pinned to ' + LAUNCH_HREF);
