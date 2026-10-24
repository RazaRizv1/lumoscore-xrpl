// A way BACK to Stellar, from every XRPL page.
//
// Once both builds share lumoscore.com the door was ONE-WAY. Stellar's pages carry lx-mc, the
// multichain engine, whose chainHref navigates to /<section>/xrpl. This build strips lx-mc —
// _xrplaccount does it, and correctly, it is what generated the seven-network picker with XRP Ledger
// listed twice — and nothing replaced the switcher it also provided. Measured on the deployed build:
//     { "path": "/trade/xrpl", "lxSetChain": "undefined", "linksBackToStellar": [], "chainControls": [] }
// Zero. A reader who chose XRP Ledger was stranded on it unless they edited the address bar.
//
// So this injects the small part that was actually missing: the switcher, and nothing else.
//
// NOT the engine ported across. lx-mc also re-skins the page into the other chain's branding via
// walkSwap, which is exactly wrong here — the two chains are separate BUILDS, so repainting XRPL's
// trade page in Stellar's livery would leave every figure on it still coming from the XRP Ledger.
// Navigation is the whole behaviour; there is nothing to swap.
//
// SAME CLASS NAMES AND CSS as Stellar's switcher (_multichain.js), copied rather than reinvented, so
// the control looks identical on both sides of the trip. It also takes the id #lxmc and bails if that
// already exists, which means if lx-mc is ever reintroduced here the two cannot both build a chip —
// whichever runs first wins and the other no-ops.
//
// THE MAP IS A MIRROR of chainHref in Stellar's _mc_engine.js and the two have to agree. Stellar serves
// trade, pools, bridge, rewards, lumos, account and launchpad /stellar-suffixed, and dashboard, wallet,
// mcp and list-your-token BARE — asking it for /dashboard/stellar is a 404.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// The two chains' names and logos, baked at build time. The logos are inline SVG data URIs, so the
// switcher needs no asset file and cannot 404 — which matters because the combined deployment serves
// XRPL's pages against STELLAR's /assets tree.
//
// A local copy of the two entries Stellar keeps in _tools/_chains.json, rather than a require() across
// into C:/LumosCore: the XRPL build chain must not stop working because the other repo moved.
const CH = require(__dirname + '/_xrplchains.json');

// Every destination the switcher can navigate to. In a JSON file of its own, not inline, because
// combine_with_stellar.js checks these against Stellar's _redirects and must be able to read them
// WITHOUT requiring this module — requiring a transform runs it.
const SMAP = require(__dirname + '/_xrplchainswitch_map.json');

// ASSERT THE TARGETS EXIST, against Stellar's published _redirects rather than against memory of it.
// A route renamed on that side would otherwise turn every switch into a 404, and a 404 reached by
// clicking a working-looking control is the kind of bug nobody reports as a routing problem.
//
// Conditional because the XRPL build chain must not stop working when the other repo is absent; loud,
// because a silent skip is how an unchecked map ships. combine_with_stellar.js checks it again, there
// unconditionally, since that script cannot run without both repos anyway.
const SREDIR = 'C:/LumosCore/dist/_redirects';
if (fs.existsSync(SREDIR)) {
  const have = new Set(fs.readFileSync(SREDIR, 'utf8').split('\n')
    .map((l) => l.trim().split(/\s+/)[0]).filter((p) => p && p.startsWith('/')));
  const bad = Object.keys(SMAP).filter((k) => !have.has(SMAP[k]));
  if (bad.length) {
    console.error('  ABORT: these chain-switch targets are not routes in Stellar\'s _redirects: '
      + bad.map((k) => k + ' -> ' + SMAP[k]).join(', '));
    process.exit(1);
  }
} else {
  console.log('  note: Stellar dist not present — chain-switch targets NOT verified against its routes');
}

const CSS = '<style id="lxmc-css">'
  // The desktop chip's rules are gone with the chip itself — .lxmc, .lxmc-trig, .lxmc-logo, .lxmc-name,
  // .lxmc-menu, .lxmc-opt and .lxmc-ol styled a control nothing builds any more, and a stylesheet that
  // still describes a removed element is how the next person concludes it should be there.
  // THE MOBILE ROW, which is a different control and not the chip at a smaller size. The phone build has
  // no .lx-topwallet to sit beside — nor does Stellar's, which is why neither had a switcher on mobile —
  // and the appbar it does have holds a logo, a wallet pill, a search field and a hamburger in about
  // 120px of slack, with a comment in the design saying the address already truncates. So the switcher
  // goes where the phone already keeps its global controls: the slide menu's footer, beside Theme.
  //
  // Shaped to match .menu-theme-row deliberately — same padding, radius, surface and weight — so it
  // reads as another setting rather than as something bolted on.
  //
  // It is a DIRECT ACTION, "Switch to Stellar", not a dropdown. With exactly two chains a picker would
  // ask the reader to choose between where they are and the one other place; and an absolutely
  // positioned menu inside a slide-out panel is a clipping bug waiting for a narrow screen.
  // ABOVE THE THEME TOGGLE, and the margin-top:auto moves with it. The design pins .menu-theme-row to
  // the bottom of the footer that way; appending after it put this row at y=782 in an 812-tall phone
  // viewport, i.e. below the fold, reachable only by scrolling the menu — while the theme toggle sat
  // comfortably at 704. Both cannot fit, so the question is only which one costs a scroll, and changing
  // network is worth more than changing theme. Taking the auto margin here pins THIS row to the bottom
  // block and the rule below puts the theme row directly under it, instead of leaving a gap between two
  // auto-margined siblings.
  + '.lxmc-row{display:flex;align-items:center;gap:11px;width:100%;margin-top:auto;padding:13.2px;'
  + 'background:var(--surface-2);border:0;border-radius:10px;color:var(--text);cursor:pointer;'
  + 'font:600 14.3px/1.2 "Hanken Grotesk",system-ui,sans-serif;text-align:left}'
  // Two classes beats the design's one, so this wins on specificity and does not depend on which
  // stylesheet lands later in <head>.
  + '.lxmc-row+.menu-theme-row{margin-top:8px}'
  + '.lxmc-row .lxmc-rl{width:24px;height:24px;border-radius:50%;overflow:hidden;display:inline-flex;flex-shrink:0;background:var(--surface-3,#eee)}'
  + '.lxmc-row .lxmc-rl img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.lxmc-row .lxmc-rt{flex:1 1 auto}'
  + '.lxmc-row svg{width:16px;height:16px;flex-shrink:0;color:var(--text-soft)}'
  + '</style>';

// Everything below ships to the browser. No backticks and no ${ } in it: this is assembled with + on
// purpose, because an interpolation here would be evaluated at BUILD time and never reach the page.
const SCRIPT = '<script id="lx-xrplchainswitch">(function(){'
  + 'if(window.__lxxcs)return;window.__lxxcs=1;'
  + 'var SL=' + JSON.stringify(CH.stellar.logo) + ',XL=' + JSON.stringify(CH.xrpl.logo) + ';'
  + 'var SN=' + JSON.stringify(CH.stellar.name) + ',XN=' + JSON.stringify(CH.xrpl.name) + ';'
  // SECTION IN, WHOLE PATH OUT. Every value on the right is a literal route out of Stellar's published
  // _redirects, asserted against it at build time below — so this cannot drift into a 404 unnoticed.
  //
  // THE PATH TAIL IS DROPPED ON PURPOSE, and getting this wrong is how the first version of this map
  // failed its own test. /trade/xrpl/SOLO-rsoLo2S... carries an XRPL issuer address; pasting that tail
  // onto /trade/stellar asks Stellar for an asset that does not exist on it, and the reader gets an
  // empty page that looks like the switch broke. The same is true of a pool id, an account address, and
  // a launchpad draft mid-flow. An identifier is chain-specific; the SECTION is the part both chains
  // share, so the section is the only part that travels.
  //
  // account has no row because Stellar serves only /account/stellar/:address — there is no chain-level
  // account page to land on without an address, and an XRPL address is not one. It falls through.
  //
  // dashboard, wallet and launchpad have no row either, for a different reason: they are ONE url for
  // both chains now, so there is no other path to send anyone to. They show the connected wallet's own
  // data, and nobody is on the other chain's dashboard without a wallet there — so they fall through to
  // Stellar's trade page, which is public and is where connecting actually happens.
  // THE LEADING SLASH IS ADDED AT RUNTIME, and that is not a style choice. _xrplroutes rewrites any
  // route that sits immediately after a quote — "/dashboard" becomes "/dashboard/xrpl", "/trade/stellar"
  // becomes "/trade/xrpl" — and it runs earlier in the chain than this transform. The containers persist
  // between builds, so the copy injected last build is sitting there when _xrplroutes runs next build
  // and gets mangled: measured, 94 hits on /mcp, 94 on /list-your-token and 94 of the 444 on /dashboard,
  // every one of them this layer's own strings.
  //
  // The end result was still correct, because this transform strips its previous copy before writing a
  // new one. What it was not is quiet — and a chain run that reports several hundred phantom rewrites
  // every time is how a real drift goes unnoticed, which is the exact failure _xrplchoosenet.js was
  // rewritten to avoid. Storing the paths without their leading slash means no quote is ever followed by
  // a route, so none of those rules can match, and the log goes back to telling the truth.
  + 'var SMAP=' + JSON.stringify(
    Object.fromEntries(Object.entries(SMAP).map(([k, v]) => [k, v.replace(/^\//, '')]))) + ';'
  + 'function stellarHref(){'
  + 'var p=(location.pathname||"/").replace(/' + B + '/+$/,"");'
  + 'var m=p.match(/^' + B + '/([a-z-]+)/);'
  // Anything with no Stellar counterpart lands on its TRADE page — public, so it cannot bounce. The
  // dashboard would be the obvious choice and is the wrong one: it carries lx-authgate, which sends a
  // visitor with no wallet straight back to "/", so the switch would look dead to exactly the people
  // most likely to use it. Stellar's chainHref had the same fallback and the same defect.
  // Written slash-less for the same reason as the map.
  + 'return "/"+((m&&SMAP[m[1]])||"trade/stellar");'
  + '}'
  + 'function go(){'
  // Written BEFORE leaving, so the Stellar page that loads already knows which chain it is on instead
  // of reading the stale value and visibly correcting itself. Same key lx-mc uses.
  + 'try{localStorage.setItem("lumos.chain","stellar");}catch(_){}'
  + 'var h=stellarHref();try{location.assign(h);}catch(_){location.href=h;}'
  + '}'
  + 'var CHEV=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>\';'
  + 'var CHEVR=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>\';'
  // THE PHONE: one row in the slide menu's footer, beside Theme. Returns false if this page has no such
  // menu, so the desktop path is still tried and a page with neither simply gets nothing.
  // REMOVED 2026-10-20 — RAZA: "On mobile menu, why do we have network switching. We dont have that
  // on desktop. Remove it."
  //
  // He is right, and the note at the top of this file already said so without drawing the conclusion:
  // the desktop chip was taken out, and "nor does Stellar's, which is why neither had a switcher on
  // mobile". This row was then added to the phone to make up for the chip — so the phone ended up
  // with a control neither desktop nor Stellar has, which is the opposite of the parity rule.
  //
  // AND THE PREMISE THIS ROW WAS BUILT ON IS WRONG. RAZA, same day, correcting my first answer:
  // "chain switching doesn't exist. its just that the other chain pages are viewable in read only."
  //
  // So there is no feature here to preserve or relocate. A reader on an XRPL page can open a Stellar
  // page and look at it; that is not a mode the product switches between, and a button offering to
  // "Switch to Stellar" described something the site does not do. The hub pages are not a switcher
  // either — they are how someone picks which chain's page to VIEW. Nothing is lost by removing this
  // because there was never a state to leave.
  //
  // The builder is kept and disabled at its first line rather than deleted, because everything below
  // it — the section map asserted against Stellar's own _redirects at build time, and the
  // window-capture note explaining why a normal listener cannot work here — is the expensive part and
  // would have to be rediscovered if the row is ever wanted again.
  + 'function buildRow(){'
  + 'return false;'
  + 'if(document.getElementById("lxmcrow"))return true;'
  + 'var foot=document.querySelector(".menu-foot");'
  + 'if(!foot)return false;'
  + 'var b=document.createElement("button");b.id="lxmcrow";b.className="lxmc-row";b.type="button";'
  + 'b.setAttribute("data-lx-noswap","");b.setAttribute("data-logoed","1");'
  + 'b.innerHTML=\'<span class="lxmc-rl"><img src="\'+SL+\'" alt=""></span>\''
  + '+\'<span class="lxmc-rt">Switch to \'+SN+\'</span>\'+CHEVR;'
  + 'var th=foot.querySelector(".menu-theme-row");'
  + 'if(th)foot.insertBefore(b,th);else foot.appendChild(b);'
  // WINDOW CAPTURE, OR THIS BUTTON DOES NOTHING.
  //
  // A listener on the button never fired — not the one this layer attached, and not one attached by
  // hand afterwards to the very same node. Measured on the deployed page with three listeners armed at
  // once: window-capture fired, document-capture did not, the target did not. So a window-level capture
  // listener registered before ours calls stopPropagation on clicks in this subtree, and the event never
  // reaches the element at all. It is the same inherited hijack the dashboard list rows hit, where the
  // only thing that beats it is also a window capture listener.
  //
  // The guard flag matters because build() is retried by the MutationObserver: without it, a menu that
  // is rebuilt would stack a second delegate and fire go() twice.
  //
  // Delegated rather than bound to the node, which also makes it survive any later layer re-rendering
  // the menu footer — the node can be replaced and the control still works.
  //
  // Enter does NOT reach it either, and that one IS the page rather than this button: something global
  // swallows the key — the menu carries a search field — and reloads the current url instead. Measured,
  // with beforeunload firing and no click event on the button at all. Pointer and touch are unaffected.
  + 'if(!window.__lxxcsTap){window.__lxxcsTap=1;'
  + 'window.addEventListener("click",function(e){'
  + 'var t=e.target;var hit=(t&&t.closest)?t.closest("#lxmcrow"):null;'
  + 'if(!hit)return;'
  + 'e.preventDefault();e.stopPropagation();go();'
  + '},true);}'
  + 'return true;'
  + '}'
  // THE DESKTOP CHIP IS GONE (RAZA 2026-10-02: "On XRPL, why are we showing this. On Stellar we're not
  // showing any such thing"). Stellar's header carries no chain switcher — its buildSwitcher() exists but
  // boot() never calls it, disabled back when XRPL was not a live build — so a chip here and nothing
  // there is the two headers disagreeing, which is what he saw.
  //
  // The way back survives on the phone, where the menu row lives: that row has no Stellar counterpart to
  // disagree with, and on desktop the /trade and /pools hubs still carry both chains. So build() is now
  // just the mobile row.
  + 'function build(){return buildRow();}'
  // The top bar is script-built on most of these pages, so one pass at DOMContentLoaded finds no host.
  // Observed until it appears, then the observer is dropped; the timeout is the backstop for a page
  // that genuinely has no top bar, so nothing is left watching the document forever.
  + 'function start(){'
  + 'if(build())return;'
  + 'var mo=null,done=false;'
  + 'function stop(){if(done)return;done=true;try{if(mo)mo.disconnect();}catch(_){}}'
  + 'try{mo=new MutationObserver(function(){if(build())stop();});'
  + 'mo.observe(document.documentElement,{childList:true,subtree:true});}catch(_){}'
  + 'setTimeout(stop,15000);'
  + '}'
  // ARRIVING FROM THE OTHER CHAIN'S NETWORK CHOOSER.
  //
  // "Choose a network" on the Stellar landing page says "Connect on XRP Ledger", so the reader asked to
  // connect, not merely to travel. That build cannot honour it — it has no XRPL connect layer at all
  // (window.lxc undefined, no lx-xrplconnect script), and the wallet list it used to flash was
  // decorative. It now records the intent and hands off; this is the half that honours it.
  //
  // The marker is consumed BEFORE anything can fail, so a connect layer that never loads costs the
  // reader one missed dialog rather than a modal that reopens on every page they visit afterwards.
  //
  // lxc arrives with its own script, which may not have run yet, so this polls briefly rather than
  // assuming. It gives up silently: the page is perfectly usable with the Connect button sitting there.
  + 'function connectOnArrive(){'
  + 'var want=null;'
  + 'try{want=sessionStorage.getItem("lumos.connectOnArrive");'
  + 'if(want)sessionStorage.removeItem("lumos.connectOnArrive");}catch(_){return;}'
  + 'if(want!=="xrpl")return;'
  + 'var n=0,t=setInterval(function(){'
  + 'n++;'
  + 'var lxc=window.lxc;'
  + 'if(lxc&&lxc.open){'
  + 'clearInterval(t);'
  // Already connected -> they asked to connect and they are; opening the picker would be noise.
  + 'var addr=null;try{addr=lxc.address&&lxc.address();}catch(_){}'
  + 'if(!addr){try{lxc.open();}catch(_){}}'
  + 'return;'
  + '}'
  + 'if(n>50)clearInterval(t);'
  + '},120);'
  + '}'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){start();connectOnArrive();});'
  + 'else {start();connectOnArrive();}'
  + '})();</' + 'script>';

// Only the app surfaces. The marketing and docs pages have no top bar and no wallet chip, so there is
// nothing to anchor to and no reason to add one — gating on the host element rather than on a page list
// means a new app page picks this up for free and a new docs page does not.
let pages = 0, containers = 0, skipped = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let h = json[k];
    const before = h;
    // Self-strip first, so a re-run replaces rather than stacks. Both the style and the script.
    h = h.replace(/<style id="lxmc-css">[\s\S]*?<\/style>/g, '')
         .replace(/<script id="lx-xrplchainswitch">[\s\S]*?<\/script>/g, '');

    // THE GATE TESTS FOR AN ELEMENT, NOT FOR THE NAME. The first version of this matched
    // /lx-topwallet|topbar-right|ah-right/ anywhere in the page and reported "0 without a top bar" on
    // all 128 keys — because those class NAMES appear in a stylesheet every page carries, including the
    // docs and the admin set. It was a gate that could not say no.
    //
    // Matching a class ATTRIBUTE instead gives the real split: 53 desktop keys carry .lx-topwallet, 41
    // mobile keys carry the slide menu, and the 34 left out are the admin pages, signin, and the landing
    // page — exactly the three sets that must not grow a chain switcher. The landing page especially:
    // it is the one surface that stays as it is.
    if (!/class="[^"]*lx-topwallet/.test(h) && !/class="menu-foot"/.test(h)) {
      if (h !== before) { json[k] = h; changed = true; }
      skipped++;
      continue;
    }

    const hi = h.indexOf('</head>');
    h = hi >= 0 ? h.slice(0, hi) + CSS + h.slice(hi) : CSS + h;
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

console.log('xrpl chain switcher: ' + pages + ' page key(s) across ' + containers
  + ' container(s), ' + skipped + ' without a top bar');
