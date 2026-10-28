// Dashboard → Quick actions → "Custom Swap / Orders": Stellar's three-tab dialog (Swap, Limit, Orders),
// driven by the XRP Ledger. RAZA 2026-09-15: "On XRPL it's a different popup from that we have on stellar."
//
// Injected wherever `#swapModal` exists — the dashboard, desktop and phone. Carries xrpl-core (the phone
// dashboard has no other layer that injects it) and gets the fee collector through the same
// checksum-gated injection write.js uses, so a mistyped collector fails the build instead of shipping.
//
// Idempotent: the existing block is stripped by id before the new one is appended.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const { injectCollector } = require(__dirname + '/xrpladdr.js');
const B = String.fromCharCode(92);

const ID = 'lx-xrplqorders';
const core = fs.readFileSync(__dirname + '/xrpl-core.js', 'utf8');
const page = injectCollector(fs.readFileSync(__dirname + '/browser/qorders.js', 'utf8'), 'qorders.js');
for (const src of [core, page]) {
  if (src.indexOf('</' + 'script') >= 0) { console.error('  a source file contains a closing script tag — aborting'); process.exit(1); }
}
const SCRIPT = '<script id="' + ID + '">\n' + core + '\n' + page + '\n</' + 'script>';

// The dialog otherwise wears Stellar's `lx-qorders-css` entirely -- this file injects no style of its
// own, and stripById takes <script id> only, so that sheet rides along in the inherited build. Which
// means it is FROZEN at whatever Stellar looked like when the base was copied: the retry button added to
// Stellar's sheet on 2026-10-28 is not in it, and the button would render as a bare browser control.
// Carrying the one rule here makes this fix complete on its own, instead of waiting on a full re-inherit
// of a Stellar base that three other sessions are also writing to. Same selector and same declarations
// as Stellar's, so if that sheet does arrive later the duplicate is a no-op rather than a fight.
const STYLE_ID = ID + '-css';
const STYLE = '<style id="' + STYLE_ID + '">'
  + '.lxo-retry{margin-top:12px;height:30px;padding:0 15px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}'
  + '.lxo-retry:hover{color:var(--accent,#7c8cff);border-color:var(--accent,#7c8cff);background:rgba(124,140,255,.08)}'
  + '</' + 'style>';
const STYLE_RE = new RegExp('<style id="' + STYLE_ID + '">[\\s\\S]*?<\\/style>', 'g');

let pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // Stripped on EVERY key, before deciding whether to inject, so a page that once qualified and no
    // longer does cannot keep a stale copy -- the containers are gitignored and outlive a rebuild.
    let h = stripById(json[key], ID).html.replace(STYLE_RE, '');
    if (h.indexOf('id="swapModal"') < 0) { json[key] = h; continue; }
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + STYLE + SCRIPT + h.slice(bi);
    pages++;
  }
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
console.log('xrpl custom swap / orders: wired on ' + pages + ' page key(s)');
if (!pages) { console.error('  ! no page carried #swapModal — nothing was wired'); process.exit(1); }
