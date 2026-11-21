// The XRP Ledger's "How it works" dialog on the Launchpad.
//
// RAZA 2026-11-01: "On launchpad page on both Stellar and XRPL, How it works isnt linking to
// anything." The link is injected at request time by Stellar's middleware NET_SEO table (it serves
// BOTH /launchpad/stellar and /launchpad/xrpl on the combined deploy) as
// <a class="ui-link" href="#" data-lxlhiw>How it works</a>. The dialog behind it is per-chain, and
// this is this chain's.
//
// INJECTED, NOT INHERITED, and that is a deliberate call. Stellar's _launchhiw.js writes the same
// script id into ITS containers, but this fork's containers are a copy of Stellar's taken at a frozen
// moment ([[xrpl-inherits-a-frozen-stellar-build]]) and that copy predates it -- measured: lx-lhiw is
// absent from all three launch-token keys here. Picking it up would mean `rebuild.js --base`, which
// re-imports everything else Stellar has changed since; that memory's own conclusion is that porting
// the one transform is the smaller move. So this file carries the whole layer.
//
// IT STILL STRIPS BY ID FIRST, which covers the other direction: if a later --base does bring
// Stellar's lx-lhiw across, the strip removes it before this one goes in, so the page can never end
// up with two dialogs fighting over the same click. The stylesheet is byte-identical to Stellar's on
// purpose -- the two chains render the same component.
//
// The copy itself, and the code behind it, lives in browser/launchhiw.js and is injected verbatim:
// same rule as _xrplconnect.js, browser code is never assembled inside a quoted string here. Every
// claim in it is cited to this fork's own launch code in that file's header.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-lhiw';

const src = fs.readFileSync(__dirname + '/browser/launchhiw.js', 'utf8');
if (src.indexOf('</' + 'script') >= 0) {
  console.error('  browser/launchhiw.js contains a closing script tag - aborting');
  process.exit(1);
}
const SCRIPT = '<script id="' + ID + '">' + src + '</' + 'script>';

const STYLE = '<style id="' + ID + '-css">\n'
  + '.lx-lhiw{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}\n'
  + '.lx-lhiw[hidden]{display:none}\n'
  + '.lx-lhiw-bd{position:absolute;inset:0;background:rgba(8,8,12,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}\n'
  + '.lx-lhiw-card{position:relative;z-index:1;width:100%;max-width:580px;max-height:86vh;max-height:86dvh;\n'
  + '  overflow:auto;-webkit-overflow-scrolling:touch;background:var(--surface,#fff);\n'
  + '  border:1px solid var(--border);border-radius:18px;box-shadow:0 30px 70px -20px rgba(0,0,0,.55)}\n'
  + '.lx-lhiw-head{position:sticky;top:0;display:flex;align-items:center;gap:12px;padding:17px 20px;\n'
  + '  background:var(--surface,#fff);border-bottom:1px solid var(--border);z-index:1}\n'
  + '.lx-lhiw-head h3{flex:1;margin:0;font-size:16.5px;font-weight:800;color:var(--text)}\n'
  + '.lx-lhiw-x{width:30px;height:30px;flex:0 0 30px;border-radius:9px;border:1px solid var(--border);\n'
  + '  background:transparent;color:var(--text-soft);cursor:pointer;display:grid;place-items:center}\n'
  + '.lx-lhiw-x:hover{color:var(--text);border-color:var(--border-strong)}\n'
  + '.lx-lhiw-body{padding:18px 20px 22px}\n'
  + '.lx-lhiw-lede{margin:0 0 18px;font-size:14px;line-height:1.6;color:var(--text-soft)}\n'
  + '.lx-lhiw-lede b{color:var(--text);font-weight:700}\n'
  + '.lx-lhiw-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}\n'
  + '.lx-lhiw-steps li{position:relative;padding:0 0 20px 40px}\n'
  + '.lx-lhiw-steps li:last-child{padding-bottom:4px}\n'
  + '.lx-lhiw-steps li::before{content:attr(data-n);position:absolute;left:0;top:0;width:26px;height:26px;\n'
  + "  border-radius:50%;display:grid;place-items:center;font:800 12px/1 'JetBrains Mono',monospace;\n"
  + '  background:var(--accent-pale,rgba(234,106,44,.13));color:var(--accent,#ea6a2c)}\n'
  + '.lx-lhiw-steps li:not(:last-child)::after{content:"";position:absolute;left:13px;top:30px;bottom:6px;\n'
  + '  width:1px;background:var(--border)}\n'
  + '.lx-lhiw-steps h4{margin:3px 0 4px;font-size:14px;font-weight:800;color:var(--text)}\n'
  + '.lx-lhiw-steps p{margin:0;font-size:13.5px;line-height:1.55;color:var(--text-soft)}\n'
  + '.lx-lhiw-note{margin-top:18px;padding:12px 14px;border-radius:12px;\n'
  + '  border:1px solid var(--border);background:var(--surface-2);\n'
  + '  font-size:13px;line-height:1.55;color:var(--text-soft)}\n'
  + '.lx-lhiw-note b{color:var(--text)}\n'
  + '@media(max-width:560px){\n'
  + '.lx-lhiw{padding:12px;align-items:flex-start}\n'
  + '.lx-lhiw-body{padding:16px 16px 20px}\n'
  + '}\n'
  + '</' + 'style>';

const RE_STYLE = new RegExp('<style id="' + ID + '-css">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g');
const RE_SCRIPT = new RegExp('<script id="' + ID + '">[' + B + 's' + B + 'S]*?<' + B + '/script>', 'g');

let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing - skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    // The form page only. /launchpad and /launchpad/xrpl both resolve to lumoscore-launch-token; the
    // review and confirm pages carry no such link.
    if (key.indexOf('launch-token') < 0) continue;

    let p = json[key];
    p = p.replace(RE_STYLE, '').replace(RE_SCRIPT, '');

    const hi = p.indexOf('</' + 'head>');
    if (hi < 0) { console.error('  ' + key + ': no closing head - aborting'); process.exit(1); }
    p = p.slice(0, hi) + STYLE + p.slice(hi);

    const bi = p.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body - aborting'); process.exit(1); }
    p = p.slice(0, bi) + SCRIPT + p.slice(bi);

    json[key] = p; pages++; changed = true;
  }

  if (!changed) continue;
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}
if (!pages) {
  console.error('  no launch-token page found - aborting');
  process.exit(1);
}
console.log('XRP Ledger launchpad "How it works" dialog on ' + pages + ' page(s) across ' + files + ' container(s)');
