// The connect destination this build WRITES but does not read — corrected before it can matter.
//
// The header's "Launch App" / "Connect wallet" handler is baked into these containers from the fork,
// and it records sessionStorage "lumos.connDest" = "home", meaning "after connecting, go to the
// dashboard". On the Stellar side that value is CONSUMED by lxPostConnectHome in
// _wallet_realconnect.js, and an unconditional "home" is what threw people to the dashboard after
// they connected on a page they had deliberately opened (RAZA 2026-09-24). That was fixed there by
// deriving the chain from the url.
//
// ON THIS BUILD IT IS CURRENTLY DEAD: measured, not assumed -- the string "lumos.connDest" appears
// once in the built page (this write) and "lxPostConnectHome" appears zero times, so nothing reads
// it and connecting here already leaves you where you were. There is no user-visible bug to fix.
//
// It is patched anyway because it is a LANDMINE, not because it is broken. The value is wrong, it is
// stored under a shared key, and the only thing keeping it harmless is the absence of one function
// from the other repo. Any future change that brings the Stellar connect layer to these pages -- a
// wider merge, a shared wallet layer -- would make every XRPL page start redirecting to the dashboard
// on connect, with the cause sitting in a container nobody would think to look in.
//
// Same expression as the Stellar fix, deliberately: one rule across both chains beats two that agree
// today and drift later.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const OLD = 'sessionStorage.setItem("lumos.connDest","home")';
const NEW = 'var _sg=(location.pathname||"").split("/").filter(Boolean);'
  + 'var _pc=(_sg.length>1&&/^(stellar|xrpl)$/i.test(_sg[1]))?_sg[1].toLowerCase():"";'
  + 'sessionStorage.setItem("lumos.connDest",_pc?("stay:"+_pc):"home")';

let pages = 0, containers = 0, already = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    const p = json[k];
    if (p.indexOf('lumos.connDest') < 0) continue;
    if (p.indexOf('"lumos.connDest",_pc?') >= 0) { already++; continue; }   // idempotent
    if (p.indexOf(OLD) < 0) continue;
    json[k] = p.split(OLD).join(NEW);
    changed = true; pages++;
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}
console.log('xrpl connect destination: ' + pages + ' page key(s) across ' + containers + ' container(s)'
  + (already ? (' | ' + already + ' already patched') : ''));
// The write exists in these containers; if it stops matching, the baked handler has changed shape and
// this transform is silently doing nothing -- which is exactly the failure it was written to prevent.
if (!pages && !already) { console.error('  ! nothing matched — the baked connDest write has changed'); process.exit(1); }
