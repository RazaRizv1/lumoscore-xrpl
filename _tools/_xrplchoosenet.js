// Launch App, and 101 other dead controls.
//
// The design wires every "Launch App" / "Open app" control as
//     onclick="try{window.lxChooseNetwork&&window.lxChooseNetwork('lumoscore-home.html')}catch(e){}"
// and window.lxChooseNetwork is defined by lx-mc, the multichain engine. On an XRPL-only build
// _xrplaccount strips lx-mc — correctly, it is what generated the seven-network picker with XRP
// Ledger listed twice — and nothing replaced the function it also provided.
//
// Because the call site is guarded by `window.lxChooseNetwork &&` inside a try/catch, the button did
// not throw, log, or navigate. It just silently did nothing, which is exactly how RAZA found it.
// Measured on the built site: 102 call sites across 96 pages, and the function defined on none of them.
//
// There is no network to choose here — the site IS the XRP Ledger — so the shim navigates straight to
// the target. It goes through __lxNav so the clean-URL map applies and the address bar shows
// /xrpl/dashboard rather than a design filename, and it only defines the function if something else
// has not already, so re-introducing lx-mc later would win rather than collide.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// lxCleanUrl maps the design filename to the real route ('lumoscore-home.html' -> '/xrpl'), then we
// navigate ourselves. It deliberately does NOT go through __lxNav: that is a wrapper
// `function(u){return o.call(this,lxClean(u));}` whose inner o did not navigate when called on the
// live page, and a control this central should not depend on another layer's side effect. Cleaning
// the url is a pure function; assigning location.href is the navigation.
// WHY IT STILL DID NOTHING after the first version of this shim. The target is 'lumoscore-home.html'
// = /xrpl = the DASHBOARD, and the dashboard carries lx-authgate: with no wallet in localStorage it
// does location.replace("/") immediately. So the click navigated, the gate bounced it straight back
// to the landing page, and the screen never changed. Indistinguishable from a dead button.
//
// On Stellar that control opens the network chooser, which leads into connect. Here there is exactly
// one network, so the equivalent is to open the WALLET PICKER — window.lxc.open(), the XRPL connect
// layer's own entry point. Once connected, the same control goes where it was pointed.
const SCRIPT = '<script id="lx-xrplchoosenet">(function(){'
  + 'if(window.lxChooseNetwork)return;'
  + 'function go(target){'
  + 'var t=target||"lumoscore-home.html";'
  + 'try{ if(window.lxCleanUrl){ var c=window.lxCleanUrl(t); if(c) t=c; } }catch(_){}'
  + 'try{ location.href=t; }catch(_){}'
  + '}'
  + 'window.lxChooseNetwork=function(target){'
  + 'var addr=null; try{ addr=window.lxc&&window.lxc.address&&window.lxc.address(); }catch(_){}'
  + 'if(addr){ go(target); return; }'                     // connected: the gate will let them through
  + 'try{ if(window.lxc&&window.lxc.open){ window.lxc.open(); return; } }catch(_){}'
  + 'go(target);'                                          // no connect layer on this page — try anyway
  + '};'
  + '})();</'+'script>';

let pages = 0, containers = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let h = json[k];
    const before = h;
    h = h.replace(/<script id="lx-xrplchoosenet">[\s\S]*?<\/script>/g, '');
    if (h.indexOf('lxChooseNetwork') < 0) {            // nothing on this page calls it
      if (h !== before) { json[k] = h; changed = true; }
      continue;
    }
    const bi = h.lastIndexOf('</body>');
    h = bi >= 0 ? h.slice(0, bi) + SCRIPT + h.slice(bi) : h + SCRIPT;
    json[k] = h; changed = true; pages++;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
    containers++;
  }
}

console.log('xrpl choose-network shim: defined on ' + pages + ' page key(s) across ' + containers + ' container(s)');
