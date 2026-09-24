// Replace the Trade page's inherited Stellar market layer with an XRP Ledger one.
//
// `lx-dexmain` was not dead here, which makes it the worst thing found in this fork so far. It was
// still running on /trade/xrpl and filling the market table from Horizon: 36 rows of real STELLAR
// assets -- USDC/circle.com, SHX/stronghold.co, yXLM, AQUA -- priced in XLM, under a page titled
// "Trade on the XRP Ledger DEX". A blank page tells you it is broken; this told you it was fine.
//
// It is stripped rather than left to lose a race with the new layer. Two writers on one element is
// exactly the failure this codebase has hit before, and "whichever finishes last wins" is not a
// design -- especially when one of the two writes the wrong chain's data.
//
// Browser code is read from files and injected verbatim, same rule as the other layers: no browser
// code inside quoted strings in a transform, because that is where every escaping accident came from.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrpltrade';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = fs.readFileSync(__dirname + '/browser/trade.js', 'utf8');

for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}

const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

let files = 0, pages = 0, stripped = 0, mocked = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    // Only the Trade market pages. BOTH ids, because desktop and mobile are different page builds
    // with no markup in common here: desktop has a table (#dexMkTbody), mobile has a card list
    // (#mdxMkList) and carries none of the dex* ids at all. Guarding on the table alone skipped
    // every phone, which left `lx-dexmain` running there and the mobile Trade page still listing
    // Stellar assets with /trade/stellar/ links.
    if (h.indexOf('id="dexMkTbody"') < 0 && h.indexOf('id="mdxMkList"') < 0) continue;

    const old = new RegExp('<script id="lx-dexmain">[\\s\\S]*?<\\/script>', 'g');
    if (old.test(h)) { h = h.replace(old, ''); stripped++; }

    // A SECOND WRITER ON THE SAME TABLE, and the reason RAZA saw a full Aptos market list on the
    // XRP Ledger Trade page: USDC issued at 0xbae2…6f3b, APT from aptosfoundation.org, prices
    // labelled APT. Twelve EVM-shaped addresses on a page titled "Trade on the XRP Ledger DEX".
    //
    // #dexMkTbody ships EMPTY ("populated by JS"), so those rows are not stale markup. A SECOND
    // inherited inline script -- unnamed, so stripById cannot reach it -- holds `var pairs = [ … ]`,
    // the design's Aptos sample data, and renders it into the same tbody and the same movers grid
    // this layer fills.
    //
    // AND THE LOAD RACE IS NOT THE PART THAT MATTERS. Their ready() runs first and ours overwrites
    // it, which is why the page looked right every time I checked it. What survives is their
    // LISTENERS: `search.addEventListener('input', renderTable)` and a click handler on every
    // .dex-mk-filter chip. Type one character in the search box and their renderer repaints the
    // whole table from the Aptos array. That is RAZA's "search broken" and RAZA's "these aren't
    // XRPL assets" -- one bug, and it needs user input to show, which is exactly why my checks
    // never caught it. Emptying the array would not fix it either: their renderer would then blank
    // the table on every keystroke instead.
    //
    // So the section is made to bail through ITS OWN GUARD. Both blocks open with a lookup and an
    // early return -- `var tbody = getElementById('dexMkTbody'); ... if (!tbody) return;` -- so
    // pointing the lookup at an id no page has kills the renderer, the row clicks, the search
    // listener and the filter chips together, without deleting a shared <script> the way this
    // project once killed seven unrelated features at once. Everything else in the block (the
    // price chart, the mints list, the formatters) is untouched.
    //
    // Scoped to that script block by index rather than replaced globally, because #dexMkTbody is
    // also named by our own layer.
    const ps = h.indexOf('var pairs = [');
    if (ps >= 0) {
      const bs = h.lastIndexOf('<script', ps);
      const be = h.indexOf('</' + 'script>', ps);
      if (bs >= 0 && be > bs) {
        let block = h.slice(bs, be);
        let hit = 0;
        // Desktop and mobile are different page builds with no ids in common here — the same reason
        // this transform guards on both #dexMkTbody and #mdxMkList. Naming only the desktop pair left
        // the phone's copy of the mock fully live, which is the exact shape of the bug that had the
        // mobile Pools page going without its data layer on every build.
        for (const id of ['dexMkTbody', 'dexMoverGrid', 'mdxMkList', 'mdxMoverList']) {
          const find = "getElementById('" + id + "')";
          if (block.indexOf(find) >= 0) {
            block = block.split(find).join("getElementById('lx-design-mock-disabled')");
            hit++;
          }
        }
        if (hit) { h = h.slice(0, bs) + block + h.slice(be); mocked++; }
      }
    }

    const mine = new RegExp('<script id="' + ID + '">[\\s\\S]*?<\\/script>', 'g');
    h = h.replace(mine, '');

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl trade: injected on ' + pages + ' page key(s) across ' + files + ' container(s); '
  + 'stripped the Stellar market layer from ' + stripped + '; disabled the Aptos mock renderer on ' + mocked);
if (!pages) console.error('  ! no page carried id="dexMkTbody" — nothing was wired');
