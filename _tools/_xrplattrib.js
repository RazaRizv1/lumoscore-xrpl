// "Data by xrpl.to" — the attribution xrpl.to's API policy requires, in the footer of every page.
//
// THIS WAS MISSING ENTIRELY. The market data on the Trade, Trade-asset, Pools, Wallet and LUMOS pages
// all comes from xrpl.to through /lxapi/xrpl*, and rule one of the API usage policy is:
//
//     "Show a visible, clickable `Data by xrpl.to` on every screen that displays our data."
//
// Checked on the live site before writing this (2026-09-24): the Trade page rendered 50 rows of their
// data with ZERO anchors to xrpl.to. The only occurrence of the phrase anywhere in the 97-page build was
// inside a CODE COMMENT next to the endpoint — a note recording the requirement, written when the
// endpoint was built and never acted on. So the site was using the data outside the terms it was
// obtained under, which is how a key gets revoked.
//
// IN THE FOOTER, ON EVERY PAGE, rather than next to each table. "Every screen that displays our data"
// is the minimum; the footer is on every screen, so it cannot be missed by a page that starts showing
// their data later. It is one line of markup and carries no per-page bookkeeping to get wrong.
//
// The anchor text is the WHOLE PHRASE, matching the markup xrpl.to's own docs give:
//     <a rel="nofollow noopener" href="https://xrpl.to">Data by xrpl.to</a>
// Splitting it so only "xrpl.to" is clickable would technically satisfy "clickable" while making the
// attribution read as ours, which is the opposite of the point.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// nofollow because it is an attribution credit, not an endorsement we are passing ranking signal to --
// consistent with _nofollow.js, which marks every other outgoing link on the site.
const BLOCK = '<div class="lx-xrplto">'
  + '<a rel="nofollow noopener" target="_blank" href="https://xrpl.to">Data by xrpl.to</a>'
  + '</div>';

// Muted and small: it belongs to the footer's small print, not to the brand. Explicit colour and size
// rather than inheriting, because the footer's own styles differ between the light and dark builds.
const CSS = '<style id="lx-xrplto-css">'
  + '.lx-xrplto{margin-top:10px;font:400 12px/1.5 "Hanken Grotesk",system-ui,sans-serif}'
  + '.lx-xrplto a{color:var(--text-muted,#8a8a93);text-decoration:none;border-bottom:1px solid transparent}'
  + '.lx-xrplto a:hover{color:var(--text,#f6f5f3);border-bottom-color:currentColor}'
  // MOBILE: the block goes in by the other branch below -- straight before </footer>, because the
  // phone footer has no brand paragraph to anchor to. That leaves it a bare last child of
  // <footer class="site-footer">, inheriting start alignment while the copyright block above it
  // centres its own text, so it read as a stray line stuck to the bottom of the page rather than
  // part of the footer. RAZA, 2026-10-28, sent a screenshot of exactly that.
  //
  // Centred and 11px, which is the footer's own small print scale -- NOT smaller. The xrpl.to API
  // policy asks for a "visible, clickable" credit, so a size chosen to stop it being read would
  // defeat the condition while appearing to meet it. Unobtrusive is allowed; invisible is not.
  + '@media(max-width:768px){.lx-xrplto{margin-top:4px;text-align:center;font-size:11px}}'
  + '<' + '/style>';

// The footer's brand column, which every page carries: the description paragraph sits there and this
// reads as the same kind of small print. Anchored on the closing tag of that paragraph so the block
// lands after the text and before the socials.
const ANCHOR = 'on multiple networks.</p>';

let containers = 0, pages = 0, skipped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let p = json[k];
    const before = p;
    // idempotent: strip our own previous output before adding it again
    p = p.replace(/<div class="lx-xrplto">[\s\S]*?<\/div>/g, '')
         .replace(/<style id="lx-xrplto-css">[\s\S]*?<\/style>/g, '');

    // The MOBILE footer is a different component -- <footer class="site-footer"> with link columns and no
    // brand paragraph -- so the desktop anchor misses all 52 mobile pages. Mobile shows exactly the same
    // xrpl.to data, so it needs the credit just as much; there the block goes at the end of the footer.
    if (p.indexOf(ANCHOR) >= 0) {
      p = p.replace(ANCHOR, ANCHOR + BLOCK);
    } else {
      const fi = p.lastIndexOf('</footer>');
      if (fi < 0) { if (p !== before) { json[k] = p; changed = true; } skipped++; continue; }
      p = p.slice(0, fi) + BLOCK + p.slice(fi);
    }
    if (p.indexOf('</head>') >= 0) p = p.replace('</head>', CSS + '</head>');

    if (p !== before) { json[k] = p; changed = true; pages++; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}
console.log('xrpl.to attribution: ' + pages + ' page(s) across ' + containers + ' container(s)'
  + (skipped ? (' | ' + skipped + ' page(s) have no footer brand column') : ''));
if (!pages) { console.error('  ! nothing matched — the footer anchor has changed'); process.exit(1); }
