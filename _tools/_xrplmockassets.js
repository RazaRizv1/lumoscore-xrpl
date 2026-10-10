// Rewrite the Aptos asset-picker mock in the SERVED HTML.
//
// A port of Stellar's `_mockassets.js`, which this fork never got. The fork copies Stellar's BUILT
// containers, and it copied them from a moment before that transform had run — so the mock Stellar
// swept months ago is still here, in `dist/xrpl`, on the Pools page and the Dashboard:
//
//   data-asset="APT"   data-asset-name="Aptos"         data-asset-bal="12,847.50"
//   data-asset="GUI"   data-asset-name="Kale"          data-asset-bal="124,500.00"
//   data-asset="LUMOS" data-asset-name="Lumos"         data-asset-bal="58,932.10"
//   data-asset="AMI"   data-asset-name="Yieldblox APT" data-asset-bal="0.00"
//   data-asset="CELL"  data-asset-name="Cellana"       data-asset-bal="1,250.00"
//   data-asset="USDC"  data-asset-name="USD Coin"      data-asset-bal="3,420.18"
//
// Leftovers from the Aptos design template: four tickers from a chain this build has nothing to do
// with, and five INVENTED BALANCES presented as somebody's holdings. Measured 2026-10-07 — 12
// buttons per page over 5 files; the same markup on Stellar carries real codes and empty balances.
//
// NOBODY HAS EVER SEEN IT, and that is why it survived. createpool.js's filler does
// list.innerHTML = ... and replaces the whole dropdown with real XRPL assets before anyone can open
// it, so every check any of us ran — on the rendered page — came back clean. Crawlers, LLMs and our
// own MCP connector read the markup. Stellar's note records where that leads: an assistant on
// LumosCore MCP, asked how many pools LumosCore has, answered that the Pools page "displays
// conflicting Stellar and Aptos data, so neither gives me a reliable total". It was reading this.
//
// THE SIX REPLACEMENTS ARE NOT INVENTED. Every one is an asset this build already treats as real,
// so nothing here asserts a token exists on the strength of this file alone:
//   XRP    — the native asset.
//   RLUSD  — issuer rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De, in trade.js's STABLES (Ripple).
//   USDC   — issuer rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE, in trade.js's STABLES (Circle).
//   USDT   — issuer rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq, in trade.js's STABLES (GateHub).
//   LUMOS  — ours, issuer rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha.
//   SOLO   — in rewards.js's ECO map, an AMM pair this platform already has a LUMOS pool against.
// No issuer is written: these buttons carry only a code and a name, and the runtime resolver
// supplies identity. A ticker alone is not an identity on this ledger, so the picker must never be
// the thing that claims one.
//
// THE BUTTONS ARE REWRITTEN, NOT DELETED, which is Stellar's call and its reasoning holds here: the
// filler rebuilds the list and binds its own handlers, so removing them would be safe today — but an
// empty picker on a page where that builder has not run yet is a worse failure than a correct
// static one, and keeping the node count and structure identical means nothing downstream notices.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const FILES = ['lumoscore-xrpl-desktop.html', 'lumoscore-xrpl-mobile.html'];

// The mock roster in the order the template lists it, mapped to real XRP Ledger assets. Codes and
// names only — no balances, because this file is in no position to know anyone's balance, which was
// the entire problem.
const MAP = {
  APT: { code: 'XRP', name: 'XRP' },
  USDC: { code: 'USDC', name: 'USD Coin' },
  LUMOS: { code: 'LUMOS', name: 'Lumos' },
  GUI: { code: 'RLUSD', name: 'Ripple USD' },
  AMI: { code: 'USDT', name: 'Tether USD' },
  CELL: { code: 'SOLO', name: 'Sologenic' },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One static mock button, identified by data-asset-bal — only the baked markup carries that
// attribute. The runtime rows use data-code/data-issuer and do not exist at build time.
const BUTTON = /<button\b[^>]*class="ad-item"[^>]*data-asset-bal="[^"]*"[^>]*>[\s\S]*?<\/button>/g;

const problems = [];
const staged = [];
let already = 0;

for (const file of FILES) {
  if (!fs.existsSync(file)) { problems.push(file + ': missing'); continue; }
  const data = read(file);
  let json, s, e;
  try { ({ json, s, e } = getContents(data)); } catch (err) { problems.push(file + ': ' + err.message); continue; }
  let touched = 0, pages = 0;

  for (const key of Object.keys(json)) {
    const html = String(json[key] || '');
    if (html.indexOf('data-asset-bal="') < 0) continue;
    let n = 0;
    const out = html.replace(BUTTON, (block) => {
      // IDEMPOTENCE. A rewritten row still carries data-asset-bal (now empty), so it still matches
      // the pattern; on the second run its code is XRP, which is not in MAP, and an unmapped code
      // aborts the whole chain. The marker is what tells the two apart — without it this transform
      // would break the build the moment anyone ran it twice, which is every build after this one.
      // An emptied balance is the other half of the signature, and the half that survives a run
      // made before the marker existed. Either one means this row has been through here already.
      if (block.indexOf('data-lxreal=') >= 0 || /data-asset-bal=""/.test(block)) { already++; return block; }
      const code = (/data-asset="([^"]*)"/.exec(block) || [])[1] || '';
      const to = MAP[code];
      // An unknown code means the template changed under us: leave it alone and say so, rather than
      // inventing a mapping for it.
      if (!to) { problems.push(key + ': unmapped mock asset "' + code + '"'); return block; }
      n++;
      let b = block;
      b = b.replace(/class="ad-item"/, 'class="ad-item" data-lxreal="1"');
      b = b.replace(/data-asset="[^"]*"/, 'data-asset="' + esc(to.code) + '"');
      b = b.replace(/data-asset-name="[^"]*"/, 'data-asset-name="' + esc(to.name) + '"');
      b = b.replace(/data-asset-bal="[^"]*"/, 'data-asset-bal=""');
      // The Aptos mark, inlined as base64. The runtime resolver fetches the real token art; the
      // coloured letter underneath is the correct fallback until it does.
      b = b.replace(/<img\s+src="data:image[^"]*"[^>]*>/g, '');
      b = b.replace(/(<span class="ad-tk">)[^<]*(<\/span>)/, '$1' + esc(to.code) + '$2');
      b = b.replace(/(<span class="ad-nm">)[^<]*(<\/span>)/, '$1' + esc(to.name) + '$2');
      b = b.replace(/(<span class="ad-bal">)[^<]*(<\/span>)/, '$1$2');
      return b;
    });
    if (n) { json[key] = out; touched += n; pages++; }
  }

  // Zero is acceptable only when the rows are already marked done. Zero with nothing marked means
  // the markup moved and this transform is now silently doing nothing.
  if (!touched && !already) { problems.push(file + ': no static asset-picker mock found'); continue; }
  staged.push({ file, data, s, e, json, touched, pages });
}

if (problems.length) {
  console.error('xrpl mock assets: ABORT — nothing written.');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

for (const st of staged) {
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
  console.log('  ' + st.file + ': ' + st.touched + ' mock row(s) rewritten across ' + st.pages + ' page(s)');
}
console.log('xrpl mock assets: done' + (already ? ' (' + already + ' row(s) already clean)' : ''));
