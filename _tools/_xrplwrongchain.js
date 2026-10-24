// "You are connected to the other chain" — the XRP Ledger half.
//
// Mirror of _wrongchain.js in the Stellar repo (RAZA 2026-10-16: "This applies to all other pages if
// im not connected to that network", then "do the xrpl side too"). Same idea, same storage keys, same
// sentence: a reader with a STELLAR wallet connected who opens an XRPL page is told so, and the
// buttons that cannot work are turned off.
//
// The two facts this compares, which no part of either build compared before:
//
//   lumos.chain    the chain being VIEWED      — the switcher, and whatever the url adopted
//   lumos.network  the chain the WALLET is on  — written once, at connect, beside lumos.address
//
// THREE THINGS DIFFER FROM THE STELLAR COPY, and all three were measured rather than assumed.
//
// 1. THIS FORK HAS MORE WRITE SURFACES. Scanning the containers for buttons whose text is an action
//    verb returns trustline controls that Stellar's build has no equivalent of:
//
//       62  .btn-primary            Add Liquidity, Remove Liquidity
//       28  .tl-action              Remove          (trustline row)
//       28  .tl-s-add               Add             (trustline search result)
//        6  .tg-action              Add Trustline
//        4  .dxa-side-btn           Buy, Sell
//        3  .br-next                Next            (bridge)
//        2  .summary-cta            Next            (launchpad)
//        2  .dxa-trade-cta          Swap            (+ mdxa-trade-cta on mobile)
//
// 2. `.pg-btn` ("Next", 6 of them) IS NOT IN THE LIST, and checking that was the point of checking.
//    It is `.pagination .pg-ctrls .pg-btn` on the admin dashboard — a PAGER. Locking it would have
//    stopped someone turning a page, which is reading, not writing. `.active` (Deposit), `.on`
//    (Swap) and `.mdxa-trade-tab` (Swap) are out for the same class of reason: state classes and a
//    tab, not actions.
//
// 3. THE SWAP BUTTON HAS A SECOND WRITER, so opacity cannot disable it. The design's own trade
//    widget rewrites that node after anything else touches it, inline and important — measured in
//    dxaswap.js as `opacity: 1 !important; cursor: pointer !important`. An inline important
//    declaration is the top of the cascade, so a rule naming either property is a rule that will
//    never apply. dxaswap.js already solved this once: `filter` is the one channel the widget leaves
//    alone. So the rule below dims through `filter` AS WELL AS opacity — opacity for every ordinary
//    button, filter for the one that fights back — and the lock re-asserts `disabled` when that
//    widget rewrites the node, instead of setting it once and trusting it to stick.
//
// Scope is the same as Stellar's and narrow on purpose: only urls that NAME a chain, only when a
// wallet is actually connected, nothing hidden, nothing navigated. A reader may still read.
//
// Idempotent: style and both scripts are stripped by id before re-injection.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// This repo has no _chains.json (the Stellar one reads the names from there). Two chains, two names,
// stated here rather than invented at runtime so the sentence reads identically on both builds.
const NAME = { stellar: 'Stellar', xrpl: 'XRP Ledger' };

// Matching the swap CTA with [class*=] rather than by exact class: mobile's is `mdxa-trade-cta`,
// which merely CONTAINS the desktop name. dxaswap.js hit this exact trap — "the first version of
// this rule greyed the desktop button and did nothing on the phone".
const CTA = [
  '.btn-primary', '.summary-cta', '.br-next',
  '.dxa-side-btn', '.mdxa-side-btn',
  '.tl-action', '.tl-s-add', '.tg-action',
  '.lx-cplink',
  '[class*="dxa-trade-cta"]',
];

const SEL = CTA.join(',');

const STYLE = '<style id="lx-xwrongchain-css">'
  + CTA.map((s) => 'html.lx-wrongchain ' + s).join(',')
  + '{pointer-events:none!important;cursor:not-allowed!important;box-shadow:none!important;'
  // opacity for everything the design does not fight over; filter for the swap CTA, where an inline
  // important opacity outranks any stylesheet. Both are harmless on a button that only needs one.
  + 'opacity:.42!important;filter:grayscale(1) opacity(.55)!important}'
  // STICKY, so the warning is still on screen at the point the reader reaches a control it explains
  // (RAZA 2026-10-17: "make view only mode message as sticky upon scrolling so that its always there
  // right infront of the users"). Scrolled away, the disabled buttons further down the page have no
  // stated reason -- they just look broken.
  //
  // The offset is MEASURED, not written down: the two layouts pin different headers at top 0 --
  // .appbar at 65px on the phone, .topbar at 80px on desktop -- so a single hardcoded number tucks
  // the bar under one of them. --lxwc-top is set from the live header by fit() below; the fallback
  // only has to cover the moment before it runs.
  //
  // z-index sits BELOW the headers (.topbar 30, the desktop sidebar .nx-side 40) so it cannot ride
  // over them, and above ordinary content so the page scrolls underneath rather than through it.
  // An opaque background is load-bearing for that -- surface-2 already is one.
  + '.lx-wcbar{position:sticky;top:calc(var(--lxwc-top,66px) + 8px);z-index:25;'
  + 'display:flex;align-items:flex-start;gap:11px;margin:0 0 18px;padding:13px 15px;'
  + 'border:1px solid var(--border-strong,#34343c);border-left:3px solid var(--accent,#ea6a2c);'
  + 'border-radius:12px;background:var(--surface-2,#1a1a1f);color:var(--text,#f6f5f3);'
  + 'font:500 13.5px/1.55 "Hanken Grotesk",system-ui,sans-serif}'
  + '.lx-wcbar b{font-weight:700}'
  + '.lx-wcbar-ic{flex:0 0 17px;width:17px;height:17px;margin-top:1px;color:var(--accent,#ea6a2c)}'
  + '.lx-wcbar-ic svg{width:100%;height:100%;display:block}'
  + '.lx-wcbar-go{display:inline-block;margin-top:5px;color:var(--accent,#ea6a2c);font-weight:700;'
  + 'text-decoration:none;border-bottom:1px solid transparent}'
  + '.lx-wcbar-go:hover{border-bottom-color:currentColor}'
  + '</style>';

// In <head>, before the body exists, so the class is on <html> before anything paints.
const HEAD = '<script id="lx-xwrongchain">(function(){try{'
  + 'var p=(location.pathname||"").toLowerCase();'
  + 'var pc=/(^|\\/)xrpl(\\/|$)/.test(p)?"xrpl":(/(^|\\/)stellar(\\/|$)/.test(p)?"stellar":"");'
  + 'if(!pc)return;'
  + 'var a="",n="";'
  + 'try{ a=localStorage.getItem("lumos.address")||"";'
  + 'n=(localStorage.getItem("lumos.network")||"").toLowerCase(); }catch(_){}'
  + 'if(!a)return;'
  + 'if(n!=="xrpl"&&n!=="stellar"){ n=/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)?"xrpl":(/^G[A-Z2-7]{55}$/.test(a)?"stellar":""); }'
  + 'if(!n||n===pc)return;'
  + 'var d=document.documentElement;'
  + 'd.classList.add("lx-wrongchain");'
  + 'd.setAttribute("data-lx-wallet-chain",n);'
  + 'd.setAttribute("data-lx-page-chain",pc);'
  + '}catch(_){}})();</' + 'script>';

const BODY = '<script id="lx-xwrongchain-js">(function(){try{'
  + 'var d=document.documentElement;'
  + 'if(!d.classList.contains("lx-wrongchain"))return;'
  + 'var NAME=' + JSON.stringify(NAME) + ';'
  + 'var mine=d.getAttribute("data-lx-wallet-chain")||"";'
  + 'var here=d.getAttribute("data-lx-page-chain")||"";'
  + 'var SEL=' + JSON.stringify(SEL) + ';'
  // `disabled` is RE-ASSERTED, not set once. The trade widget rewrites its button after we touch it,
  // and a one-shot guard would hand it straight back. The attribute marker only guards the parts
  // that need doing once (the title), so re-running is cheap.
  + 'function lock(root){ try{'
  + '[].forEach.call((root||document).querySelectorAll(SEL),function(b){'
  + 'if(b.tagName==="BUTTON"||b.tagName==="INPUT"){ if(b.disabled!==true)b.disabled=true; }'
  + 'if(b.getAttribute("aria-disabled")!=="true")b.setAttribute("aria-disabled","true");'
  + 'if(b.getAttribute("data-lxwc")==="1")return;'
  + 'b.setAttribute("data-lxwc","1");'
  + 'b.setAttribute("title","Connected to "+(NAME[mine]||mine)+" \\u2014 switch wallets to use "+(NAME[here]||here)+".");'
  + '}); }catch(_){} }'
  + 'function THE(c){ return c==="xrpl"?"the XRP Ledger":(NAME[c]||c); }'
  + 'function AN(c){ return (c==="xrpl"?"an ":"a ")+(NAME[c]||c); }'
  + 'function bar(){'
  + 'if(document.querySelector(".lx-wcbar"))return;'
  + 'var host=document.querySelector(".page")||document.querySelector("main")||document.querySelector(".container");'
  + 'if(!host)return;'
  + 'var el=document.createElement("div");'
  + 'el.className="lx-wcbar"; el.setAttribute("role","status");'
  + 'var ic=document.createElement("span"); ic.className="lx-wcbar-ic";'
  + 'ic.innerHTML=\'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.2v.1"></path></svg>\';'
  + 'var tx=document.createElement("div");'
  + 'var b=document.createElement("b"); b.textContent="View only mode. ";'
  + 'tx.appendChild(b);'
  + 'tx.appendChild(document.createTextNode("You are currently connected to "+THE(mine)'
  + '+". To use "+THE(here)+", disconnect and connect "+AN(here)+" wallet."));'
  + 'var seg=(location.pathname||"/").split("/").filter(Boolean)[0]||"";'
  + 'if(seg){ var go=document.createElement("a"); go.className="lx-wcbar-go";'
  + 'go.href="/"+seg+(mine==="stellar"?"/stellar":"/xrpl");'
  + 'go.textContent="Open "+seg+" on "+THE(mine)+" \\u2192";'
  + 'tx.appendChild(document.createElement("br")); tx.appendChild(go); }'
  + 'el.appendChild(ic); el.appendChild(tx);'
  + 'var first=host.firstElementChild;'
  + 'if(first&&first.classList&&first.classList.contains("crumb"))host.insertBefore(el,first.nextSibling);'
  + 'else host.insertBefore(el,first);'
  + '}'
  // THE CHIP MARK IS NOT OWNED HERE ANY MORE — see the note in the Stellar copy (_wrongchain.js).
  // Short version: this layer only runs when the chains disagree, but the mark is wrong-by-default
  // on every page until something paints it. The inherited _walletlogo.js runs everywhere and now
  // owns that node, gate included. Two writers on one node is what made it flash.
  // What the sticky bar has to clear, read off the page instead of assumed. Only a header actually
  // PINNED at the top counts: the desktop sidebar (.nx-side) is sticky too and 900px tall, so a
  // naive "tallest sticky element" would push the bar off the bottom of the screen. Hence both
  // guards -- it must sit at the top, and it must be header-sized.
  + 'function fit(){ try{'
  + 'var best=0, c=document.querySelectorAll(".appbar,.topbar,header");'
  + 'for(var i=0;i<c.length;i++){ var e=c[i], s=getComputedStyle(e);'
  + 'if(s.position!=="sticky"&&s.position!=="fixed")continue;'
  + 'var r=e.getBoundingClientRect();'
  + 'if(r.top>2||r.height<24||r.height>160)continue;'
  + 'if(r.height>best)best=r.height; }'
  + 'if(best)document.documentElement.style.setProperty("--lxwc-top",Math.round(best)+"px");'
  + '}catch(_){} }'
  + 'function run(){ bar(); fit(); lock(document); }'
  // the phone and desktop headers are different elements AND different heights, so a rotation or a
  // resize across the breakpoint has to re-measure or the bar hides behind the new one
  + 'try{ addEventListener("resize",fit,{passive:true}); addEventListener("load",fit); }catch(_){}'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();'
  // childList for dialogs built later, attributes for the widget that re-enables its own button.
  // attributeFilter keeps this to the two attributes that matter rather than every style write.
  + 'try{ new MutationObserver(function(ms){ var re=false;'
  + 'for(var i=0;i<ms.length;i++){ var m=ms[i];'
  + 'if(m.type==="attributes"){ re=true; continue; }'
  + 'var ad=m.addedNodes; for(var j=0;j<ad.length;j++){ if(ad[j].nodeType===1)lock(ad[j]); } }'
  + 'if(re)lock(document); })'
  + '.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","class"]}); }catch(_){}'
  + '}catch(_){}})();</' + 'script>';

let files = 0, pages = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string') continue;
    if (h.indexOf('</head>') < 0 || h.indexOf('</body>') < 0) continue;

    h = h.replace(/<style id="lx-xwrongchain-css">[\s\S]*?<\/style>/g, '')
         .replace(/<script id="lx-xwrongchain">[\s\S]*?<\/script>/g, '')
         .replace(/<script id="lx-xwrongchain-js">[\s\S]*?<\/script>/g, '');

    h = h.replace('</head>', STYLE + HEAD + '</head>');
    const bi = h.lastIndexOf('</body>');
    h = h.slice(0, bi) + BODY + h.slice(bi);
    json[k] = h;
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl wrong-chain notice: injected on ' + pages + ' page key(s) across ' + files + ' container(s)');
if (!files) { console.error('  ! no container was read'); process.exit(1); }
