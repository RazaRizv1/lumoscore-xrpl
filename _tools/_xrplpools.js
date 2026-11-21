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

// RAZA 2026-11-13: the pools page showed its OLD two-tab bar for a moment on every refresh. addRwTabX()
// already runs at boot, but boot is inside this layer, which sits before </body> — hundreds of KB after
// the tab bar's markup. The browser paints the bar as soon as it has it and cannot know a script further
// down will add a button. So the button goes in the markup; addRwTabX() stays as the guard for any page
// this misses and returns early once it is there. Same cure as the landing-header flash.
//
// Count RW out of the browser source rather than restating it here, so rotating the reward cycle is still
// a one-place edit. Badge markup copied from addRwTabX, including data-logoed — the logo painter skips a
// cell that claims to be done, and this one holds a number, not a logo.
const RW_N = (function () {
  const d = page.indexOf('var RW = [');
  if (d < 0) { console.error('  var RW = [ not found in browser/pools.js — aborting'); process.exit(1); }
  const m = page.slice(d, page.indexOf('];', d)).match(/\{ code:/g);
  if (!m || !m.length) { console.error('  RW array empty — aborting'); process.exit(1); }
  return m.length;
})();

const RWTAB = '<button data-tab="rewarded"><span class="lx-tabic" aria-hidden="true">'
  + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"'
  + ' stroke-linejoin="round"><circle cx="12" cy="9.1" r="6.1"></circle>'
  + '<path d="M8.4 14.3 7 21.4l5-2.7 5 2.7-1.4-7.1"></path></svg></span>'
  + 'Rewarded Pools <span class="count" data-logoed="1">' + RW_N + '</span></button>';

// RAZA 2026-11-13: arriving at /pools/xrpl?tab=rewarded showed All Pools for a moment before the
// rewarded tab took over. Baking the markup cannot fix this one -- the page only learns WHICH tab to
// open by reading the URL at runtime, and the code that reads it lives in lx-xrplpools, hundreds of KB
// below the tab bar. So the decision moves into the HEAD, which the browser has before it paints a
// single row: set a class on <html>, hide the All Pools panel through it, and move the `active` class
// the instant #poolTabs is parsed. The observer disconnects BEFORE it mutates, or it observes itself.
// The 8s timeout is the safety: if lx-xrplpools never boots, the class clears and the page is a normal
// All Pools page rather than a blank one. lx-xrplpools clears it itself once applyRwX has really hidden
// the panel. Mirrors Stellar's lx-rwgate exactly, including the ids.
const RWGATE = '<' + 'script id="lx-rwgate">(function(){try{'
  + 'if(!/(^|[?&])tab=rewarded|#rewarded/.test((location.search||"")+" "+(location.hash||"")))return;'
  + 'var d=document.documentElement;d.className+=" lx-rwpending";'
  + 'var o=new MutationObserver(function(){var bar=document.getElementById("poolTabs");if(!bar)return;'
  + 'o.disconnect();'
  + 'var bs=bar.querySelectorAll("button[data-tab]");'
  + 'for(var i=0;i<bs.length;i++){var t=bs[i].getAttribute("data-tab");'
  + 'if(t==="rewarded")bs[i].classList.add("active");else bs[i].classList.remove("active");}});'
  + 'o.observe(d,{childList:true,subtree:true});'
  + 'setTimeout(function(){try{o.disconnect();}catch(e){}'
  + 'd.classList.remove("lx-rwpending");},8000);'
  + '}catch(e){}})();</' + 'script>'
  + '<style id="lx-rwgate-css">html.lx-rwpending #panelAllPools,html.lx-rwpending #panelAll'
  + '{display:none!important}</style>';

// Swapped in place like the main layer, for the same reason: a strip-and-re-append would move it.
//
// Scoped to pages that actually carry the tab bar. This layer also ships on the LUMOS token pages --
// they have no #poolTabs, so a gate there can only ever cost bytes, and on a stray ?tab=rewarded it
// would hide a panel nothing was going to unhide. Pages without the bar have any existing gate REMOVED,
// so narrowing the scope is not a one-way door.
function syncGate(h) {
  const open = '<' + 'script id="lx-rwgate">';
  const at = h.indexOf(open);
  const wants = h.indexOf('id="poolTabs"') >= 0;
  if (at >= 0) {
    const end = h.indexOf('</style>', at);                   // the gate's own closing style tag
    if (end < 0) return h;
    return h.slice(0, at) + (wants ? RWGATE : '') + h.slice(end + 8);
  }
  if (!wants) return h;
  const hc = h.indexOf('</head>');
  if (hc < 0) return h;                                      // no head: a gate in the body is no gate
  return h.slice(0, hc) + RWGATE + h.slice(hc);
}

function bakeTabs(h) {
  const bar = h.indexOf('id="poolTabs"');
  if (bar < 0) return h;
  const close = h.indexOf('</div>', bar);
  if (close < 0) return h;
  let bl = h.slice(bar, close);                              // the tab bar, and nothing past it
  if (bl.indexOf('data-tab="rewarded"') >= 0) return h;      // already baked — idempotent
  const m = bl.indexOf('<button data-tab="mine"');
  const me = m < 0 ? -1 : bl.indexOf('</button>', m);
  if (me < 0) return h;
  const mineBtn = bl.slice(m, me + 9).replace('My Positions', 'My Pools');   // scoped to this one button
  bl = bl.slice(0, m) + RWTAB + mineBtn + bl.slice(me + 9);
  return h.slice(0, bar) + bl + h.slice(close);
}

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

    // THE PHONE HAS NO TABLE, AND THAT IS WHY IT HAD NO DATA.
    //
    // This looked for `poolsBody` — the desktop table — and injected only there. The mobile pools
    // page renders a list of .pool-card anchors in `panelAll` and has no poolsBody at all, so it
    // never received this layer on any build: no script, no real rows, and the design's own mock
    // left standing. Eight fabricated pools in APT, visible at rest, on the page a phone opens.
    //
    // Matched on either container now. browser/pools.js picks whichever the page actually has.
    const hasList = (x) => x.indexOf('id="poolsBody"') >= 0 || x.indexOf('id="panelAll"') >= 0;

    // Strip everywhere it appears; it is the wrong chain on every one of them.
    const gone = stripById(h, 'lx-ammdata');
    if (!gone.removed && !hasList(h)) continue;
    h = gone.html;
    stripped += gone.removed;

    if (hasList(h)) {
      h = bakeTabs(h);
      h = syncGate(h);                                       // head: pre-paint tab gate
      // SWAP IN PLACE; DO NOT STRIP AND RE-APPEND.
      //
      // This used to do `h = stripById(h, ID).html` and then splice SCRIPT in before </body>. That
      // is only order-neutral while this layer happens to be the LAST one on the page. It is not --
      // later transforms append after it -- so a lone re-run of this file teleported lx-xrplpools to
      // the end of every pools page and every layer that had been sitting after it moved up one.
      // Those layers read and patch each other's output, so the page changed without a single byte
      // of intended change in it, and the only way to get the order back was to re-run the whole
      // chain in its original sequence.
      //
      // Replacing the block where it already sits removes that failure mode entirely: run this file
      // alone, run it twice, run it after anything, and the layer order is whatever it was.
      const open = '<' + 'script id="' + ID + '">';
      const at = h.indexOf(open);
      if (at >= 0) {
        const end = h.indexOf('</' + 'script>', at);
        if (end < 0) { console.error('  ' + key + ': unterminated ' + ID + ' — skipped'); continue; }
        h = h.slice(0, at) + SCRIPT + h.slice(end + ('</' + 'script>').length);
      } else {
        const bi = h.lastIndexOf('</' + 'body>');
        if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
        h = h.slice(0, bi) + SCRIPT + h.slice(bi);
      }
      injected++;
    } else {
      h = stripById(h, ID).html;
    }
    json[key] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl pools: injected on ' + injected + ' page key(s) across ' + files
  + ' container(s); stripped lx-ammdata from ' + stripped);
if (!injected) console.error('  ! no page carried id="poolsBody" — nothing was wired');
