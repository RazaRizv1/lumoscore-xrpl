// The way into the Trustlines dialog.
//
// RAZA, 2026-09-08: "Also the trustline option is not there."
//
// It is not. `#modalTrustlines` is in the markup, styled, and fully wired by browser/write.js —
// search, suggestions, the existing-lines list, add and remove. Nothing anywhere opens it. The
// wallet's action row has three buttons (Send, Receive, Swap) and there is no fourth.
//
// This is not a missing feature so much as a missing button, and the design already anticipates it:
// the container's own modal wiring reads
//
//     else if (label.indexOf('trustlines') >= 0) openModalById('modalTrustlines');
//
// so a `.qa-btn` whose label is "Trustlines" is exactly the control that code was written for. That
// is what this adds — the same component as its three siblings, the design's own shield icon taken
// from the dialog's heading, and no new markup patterns, styles, or dialogs of any kind. Nothing
// here is invented; it is the button the design is already listening for.
//
// ON A TRUSTLINE-BASED LEDGER THIS IS NOT OPTIONAL. An XRPL account cannot hold any issued token
// until it has a trust line for it, so "add a trustline" is the step before a first token ever
// arrives. Shipping the dialog with no way to reach it means the wallet cannot do the one thing the
// ledger requires first.
//
// WORTH RAISING SEPARATELY, and deliberately not touched here: Stellar has the same gap. Its wallet
// carries the same dialog, the same three buttons, and no opener either — and its FAQ, which is in
// the page's indexed JSON-LD, answers "How do I add or remove a trustline?" with "In Wallet, use Add
// asset with the code and issuer". There is no "Add asset" control in that build; the string appears
// only in the FAQ answer itself. That is a production page telling people to use something that does
// not exist, but production is not this project's to change.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// The design's own trustline mark, lifted from the dialog heading it opens, at the size its sibling
// buttons use.
const ICON = '<svg class="ic-mini" width="14" height="14" viewBox="0 0 24 24" fill="none" '
  + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

// THE TWO ACTION ROWS ARE DIFFERENT COMPONENTS, so each gets the button its own row is made of.
// Desktop is `.qa-btn` with the label as bare text, matched by the container's label sniffing.
// Mobile is `.action-btn` carrying `data-open-modal="modalX"`, which names its dialog outright — a
// better contract, and the one used here rather than relying on the label on that layout.
const DESKTOP_BTN = '<button class="qa-btn" data-lxtl>' + ICON
  + '\n              Trustlines\n            </button>';

const MOBILE_ICON = ICON.replace('class="ic-mini" width="14" height="14"', 'width="16" height="16"');
const MOBILE_BTN = '<button class="action-btn" data-open-modal="modalTrustlines" data-lxtl>'
  + '<div class="ic">' + MOBILE_ICON + '</div>'
  + '<span class="lbl">Trustlines</span></button>';

// Where this button goes: immediately after Swap, the last of the existing actions. Buttons cannot
// nest, so the next </button> closes the one that was opened.
function after(html, openTag, isSwap) {
  let i = 0;
  for (;;) {
    const open = html.indexOf(openTag, i);
    if (open < 0) return -1;
    const close = html.indexOf('</button>', open);
    if (close < 0) return -1;
    const end = close + '</button>'.length;
    if (isSwap(html.slice(open, end))) return end;
    i = end;
  }
}

// Returns { at, btn } for whichever action row this page has, or null.
function target(p) {
  if (p.indexOf('<button class="qa-btn"') >= 0) {
    const at = after(p, '<button class="qa-btn"', (s) => /\bSwap\b/.test(s.replace(/<[^>]*>/g, ' ')));
    return at < 0 ? null : { at: at, btn: '\n            ' + DESKTOP_BTN };
  }
  if (p.indexOf('<button class="action-btn"') >= 0) {
    const at = after(p, '<button class="action-btn"', (s) => s.indexOf('data-open-modal="modalSwap"') >= 0);
    return at < 0 ? null : { at: at, btn: MOBILE_BTN };
  }
  return null;
}

let containers = 0, pages = 0, already = 0, missed = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    const p = json[k];
    // Only pages that have BOTH the action row and the dialog it would open. A button that opens
    // nothing is worse than no button.
    //
    // Matched on the BUTTON, not the class name: `qa-btn` also appears in the stylesheet, which
    // every page carries, so testing for the bare string selected 40 page keys that have no action
    // row at all — landing, launch-confirm, asset-overview — and then failed the Swap assertion on
    // every one of them. The gate is the markup or it is nothing.
    const hasRow = p.indexOf('<button class="qa-btn"') >= 0
      || p.indexOf('<button class="action-btn"') >= 0;
    if (!hasRow || p.indexOf('modalTrustlines') < 0) continue;

    if (p.indexOf('data-lxtl') >= 0) { already++; continue; }        // idempotent re-run

    const t = target(p);
    if (!t) { missed++; continue; }

    json[k] = p.slice(0, t.at) + t.btn + p.slice(t.at);
    changed = true; pages++;
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

if (missed) {
  console.error('xrpl trustline button: ABORTED — ' + missed + ' page key(s) have the Trustlines '
    + 'dialog and an action row, but no Swap button to sit beside. The row changed shape; re-read '
    + 'it before guessing where this goes.');
  process.exit(1);
}

console.log('xrpl trustline button: added on ' + pages + ' page key(s) across ' + containers
  + ' container(s)' + (already ? '; ' + already + ' already had one' : ''));
