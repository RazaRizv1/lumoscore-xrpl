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
// Idempotent: style, head script and body script are each swapped BY ID WHERE THEY SIT.
//
// IT NO LONGER REORDERS LAYERS, and that is a deliberate change (2026-11-14). The old injection
// stripped all three blocks and re-appended them at the end of <head> and </body>, which pushed this
// layer past every layer that had been sitting after it — _xrplwalletlogo among them, which
// rebuild.js runs immediately after this one. That is why the standing rule was never to run an
// _xrpl transform on its own. Swapping each block where it already sits keeps its position exactly,
// so this one is now order-neutral ([[a-transform-that-patches-in-place-cannot-reorder]]).
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// EVERY CHAIN THE COMBINED SITE SERVES AS A URL SEGMENT, not just the two this fork was written for.
//
// Measured on production and on staging 2026-11-14, by extracting this layer and asking which chain
// ids its code contains: Stellar's copy knew all five, this one knew `stellar` and `xrpl`. So a
// reader holding a NEAR, Arc or Hedera wallet who opened any XRPL page got no notice, no CTA lock
// and no way back — the head script quit on its second line, exactly the fault that was fixed on
// the Stellar side and left standing here ([[where-each-fork-gets-its-wrong-chain-layer]]).
//
// This repo has no _chains.json (the Stellar one reads the two names it does describe from there),
// so the table is stated in full here. The VALUES are copied from Stellar's _wrongchain.js
// deliberately: the sentence has to read identically whichever build serves the page, and two
// tables that drift are how one chain starts calling itself something the other does not.
//
// `the` and `art` are data, not rules. "connected to XRP Ledger" and "a XRP Ledger wallet" both read
// as broken English, and this sentence is the entire point of the notice; "the" belongs to the XRP
// Ledger alone, and the article follows the SOUND of the name (an Arc, a NEAR), which no amount of
// string logic gets right.
const CHAIN = {
  stellar: { name: 'Stellar', the: 'Stellar', art: 'a' },
  xrpl: { name: 'XRP Ledger', the: 'the XRP Ledger', art: 'an' },
  near: { name: 'NEAR', the: 'NEAR', art: 'a' },
  arc: { name: 'Arc', the: 'Arc', art: 'an' },
  hedera: { name: 'Hedera', the: 'Hedera', art: 'a' },
};
const NAME = {};
for (const k of Object.keys(CHAIN)) NAME[k] = CHAIN[k].name;

// THE SECTIONS THAT EXIST ON EVERY CHAIN. The notice ends with a way out — "Open pools on NEAR" —
// built from this page's own first path segment, and the menu rewrite below needs the same answer.
// With two chains the old form was safe by accident; with five it would ship 404s. Measured against
// the four-way staging build rather than assumed, /<section>/<chain> for each of the five:
//
//   trade pools bridge rewards launchpad lumos   200 on stellar, xrpl, near, arc and hedera
//   account                                      404 on all five — the route is /account/<chain>/<address>
//   blog                                         410 on stellar and xrpl, 200 on near, arc, hedera
//
// So the link is offered only for a section known to exist on the destination chain. Everywhere else
// the notice still appears in full and simply does not offer a shortcut.
const CROSSCHAIN = ['trade', 'pools', 'bridge', 'rewards', 'launchpad', 'lumos'];

// SECTIONS THAT NAME A CHAIN BUT OFFER NOTHING TO ACT ON. The notice exists to explain why buttons
// will not work; where there are no buttons it is just an alarm about nothing.
//
// The blog's categories ARE networks. /blog/xrpl answers 410 today, so this layer was never seen
// there — but teaching it the other chain ids is precisely what would surface it, and a reader
// browsing posts would be told to disconnect in order to read an article. RAZA, asked directly on
// 2026-11-14 about the Stellar copy: "yes keep it off blog pages". Same rule, same reason, here.
//
// Matched on the FIRST path segment, so /blog/near and /blog/near/<slug> are both covered.
// /account/<chain>/<address> stays IN: it is a wallet surface with its own actions, and a reader
// there has a real reason to know their wallet is on another chain.
const NOTICE_OFF = ['blog'];

// WHERE EACH SECTION LIVES ON STELLAR — the same file the chain switcher uses, required rather than
// restated. It is plain JSON, so reading it does not run a transform, and _xrplchainswitch.js already
// asserts every value in it against Stellar's published _redirects at build time (as does
// combine_with_stellar.js, unconditionally). Two copies of this map is how one of them becomes a 404
// nobody reports as a routing bug, so there is one.
const SMAP = require(__dirname + '/_xrplchainswitch_map.json');

// Matching the swap CTA with [class*=] rather than by exact class: mobile's is `mdxa-trade-cta`,
// which merely CONTAINS the desktop name. dxaswap.js hit this exact trap — "the first version of
// this rule greyed the desktop button and did nothing on the phone".
// THE BUY/SELL TOGGLE IS NOT A CTA, and listing it here was the bug (RAZA 2026-10-27, connected to
// Stellar on an XRPL Trade-Asset page: "i cant seem to be able to open sell section in swap ... we
// fixed this when connected to XRPL and when we visited Stellar trade-asset page in guest mode but
// not the other way around").
//
// `.dxa-side-btn` / `.mdxa-side-btn` are the "Buy DROP" / "Sell DROP" pair. They do not spend
// anything -- they choose which DIRECTION the panel is quoting, which is exactly what a view-only
// reader came to look at. Greying them froze the panel on Buy and made the Sell rate unreachable on
// a page whose entire purpose, in this mode, is reading rates.
//
// The Stellar mirror (_wrongchain.js) never listed them, which is why the other direction worked
// and this one did not. The two lists are now equivalent on this point. The thing that must stay
// blocked is the SUBMIT, and that is [class*="dxa-trade-cta"] below -- a separate element, still
// covered. Verified against the built markup: the toggles are <button class="dxa-side-btn buy/sell">
// and the submit is <button class="dxa-trade-cta">.
const CTA = [
  '.btn-primary', '.summary-cta', '.br-next',
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
  + 'var KNOWN=' + JSON.stringify(Object.keys(CHAIN)) + ';'
  // The url's own chain. Still matching a SEGMENT, not a substring, so an asset code that happens to
  // contain a chain id cannot be read as a chain -- but by splitting the path and looking each piece
  // up, rather than by one regex per chain. The FIRST matching segment wins, which is the chain that
  // qualifies the section: /trade/xrpl/DROP-r... is an XRPL page, not a DROP one.
  + 'var SEG=(location.pathname||"").toLowerCase().split("/").filter(Boolean);'
  + 'var pc=""; for(var i=0;i<SEG.length;i++){ if(KNOWN.indexOf(SEG[i])>=0){ pc=SEG[i]; break; } }'
  + 'if(!pc)return;'
  // Read-only sections keep quiet even when their url names a chain -- see NOTICE_OFF. Tested on the
  // FIRST segment, which is the section, not on pc, which is the chain.
  + 'if(' + JSON.stringify(NOTICE_OFF) + '.indexOf(SEG[0])>=0)return;'
  + 'var a="",n="";'
  + 'try{ a=localStorage.getItem("lumos.address")||"";'
  + 'n=(localStorage.getItem("lumos.network")||"").toLowerCase(); }catch(_){}'
  + 'if(!a)return;'
  // THE ADDRESS IS THE BACKSTOP, and it is deliberately not extended to every chain in the table.
  // lumos.network is read first and is written at connect on all of them; this only has to survive a
  // connect path that forgot to write it. A shape is safe to add here when it cannot be mistaken for
  // something else that may sit in lumos.address -- G/r prefixes, a .near or .tg suffix, a 64-char
  // hex implicit NEAR account, and Hedera's 0.0.N are each unambiguous.
  //
  // AN EVM 0x ADDRESS IS NOT, and Arc is therefore absent on purpose. lumos.address is ONE key shared
  // by every chain ([[lumos-address-is-a-shared-key-across-chains]]), and a 0x value in it is as
  // likely to be a bridge destination as a connected Arc wallet. Guessing "arc" from it would put a
  // confident wrong sentence at the top of an XRPL page -- strictly worse than the no-banner case
  // this is meant to fix. When Arc ships, lumos.network carries it.
  //
  // Kept byte-for-byte in step with the Stellar copy. The r- and G- tests were regexes here and are
  // now the same string tests used there: this script is emitted from a concatenated string, where a
  // backslash has to survive two levels of quoting, and the two builds must agree on what counts as
  // an address or one of them will show the banner where the other does not.
  + 'if(KNOWN.indexOf(n)<0){ n=""; var l=a.toLowerCase();'
  + 'if(a.charAt(0)==="G"&&a.length===56)n="stellar";'
  + 'else if(a.charAt(0)==="r"&&a.length>=25&&a.length<=35)n="xrpl";'
  + 'else if(l.indexOf("0.0.")===0)n="hedera";'
  + 'else if(l.length>5&&(l.slice(-5)===".near"||l.slice(-3)===".tg"))n="near";'
  + 'else if(l.length===64&&/^[0-9a-f]+$/.test(l))n="near"; }'
  + 'if(!n||n===pc)return;'
  + 'var d=document.documentElement;'
  + 'd.classList.add("lx-wrongchain");'
  + 'd.setAttribute("data-lx-wallet-chain",n);'
  + 'd.setAttribute("data-lx-page-chain",pc);'
  + '}catch(_){}})();</' + 'script>';

const BODY = '<script id="lx-xwrongchain-js">(function(){try{'
  + 'var d=document.documentElement;'
  + 'if(!d.classList.contains("lx-wrongchain"))return;'
  + 'var CH=' + JSON.stringify(CHAIN) + ';'
  + 'var XS=' + JSON.stringify(CROSSCHAIN) + ';'
  // Kept as NAME so the CTA title below reads unchanged; it is now derived from the one table.
  + 'var NAME={};for(var nk in CH){ if(CH.hasOwnProperty(nk))NAME[nk]=CH[nk].name; }'
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
  // THE LEFT MENU FOLLOWS THE WALLET, NOT THE PAGE (RAZA 2026-11-06: "Im currently connected with
  // Stellar but im on XRPL bridge page. Now, if i suppose click pools or trade or any other page from
  // the left side menu, it should redirect me back to Stellar version of that page because thats what
  // im connected to ... It works fine if im connected to XRPL but then view Stellar page").
  //
  // WHY THE OTHER DIRECTION ALREADY WORKS, which is the whole explanation. Stellar's sidebar ships
  // BARE hrefs — /trade, /pools, /bridge — and the edge picks the build from the lx_chain cookie,
  // which both connect layers write at connect and clear at disconnect. So a Stellar page's menu
  // already follows the wallet. This build's menu does not, because _xrplroutes rewrites those same
  // hrefs to /trade/xrpl, /pools/xrpl …, and a url that NAMES a chain beats the cookie at the edge by
  // design. The reader was pinned to XRPL by the markup.
  //
  // NOT FIXED BY MAKING THESE HREFS BARE TOO, which looks like the obvious parity move and is the
  // wrong one: with no cookie — nobody connected — bare resolves to Stellar, so an XRPL visitor with
  // no wallet would be walked off this chain by its own menu. Stellar's bare links fall back to
  // Stellar, i.e. to the build they are on; the equivalent here is falling back to XRPL, which is
  // what the markup already does. Only the connected case was wrong, so only it is changed.
  //
  // This runs inside the lx-wrongchain guard above, so the three conditions are already true and are
  // not re-derived: a wallet is connected, the url names a chain, and that chain is not the wallet's.
  // Same signal as the bar and the button lock, so a reader can never be told they are in view-only
  // mode by one layer while another still routes them deeper into it.
  //
  // THE SECTION TRAVELS, THE TAIL DOES NOT — and only for sections the map names. /account/xrpl has
  // no row (Stellar serves only /account/stellar/:address, and an r-address is not one), so it is
  // left alone rather than sent somewhere that cannot answer. /dashboard and /wallet are already bare
  // on both builds and the cookie has them right, so there is nothing here to match.
  //
  // Anchored to the two nav classes, not to "every link to /trade/xrpl": measured in the containers,
  // the chain-qualified anchors are 318 .nx-item (the desktop rail), 111 .nb-tab (the phone's bottom
  // bar) and ~950 that are something else — footer columns, hero CTAs, pool rows, crumb backs. The
  // menu is what was reported and the menu is what moves; a blanket rewrite would also turn the
  // footer of an XRPL page into a Stellar site map.
  + 'var NAV=' + JSON.stringify(SMAP) + ';'
  // WHERE A MENU LINK GOES NOW THAT THE WALLET MAY BE ON ANY OF FIVE CHAINS. The old form returned
  // early unless the wallet was Stellar, so a NEAR, Arc or Hedera reader stayed pinned to XRPL by
  // this build's own left menu -- the same complaint RAZA made about the Stellar direction on
  // 2026-11-06, one chain further along.
  //
  // NAV still decides WHICH links may move: it is the build-time-asserted list of sections, and
  // leaving that gate in place is what stops this turning into "rewrite every link on the page".
  // Only the DESTINATION is now derived from the wallet's chain. Three cases, in order:
  //
  //   * a NAV entry that does not name a chain (/mcp, /list-your-token) is chain-neutral and is
  //     already correct for every wallet, so it passes through untouched;
  //   * a Stellar wallet keeps the exact route from the map, which _xrplchainswitch.js and
  //     combine_with_stellar.js both assert against Stellar's published _redirects -- so the one
  //     case that was verified stays verified, byte for byte;
  //   * any other chain gets /<section>/<chain>, and ONLY for a section in CROSSCHAIN, measured 200
  //     on all five. Anything else returns "" and the link is left exactly as the markup had it,
  //     which is this build's own chain -- the safe fallback, for the reason in the note above.
  + 'function dest(sec){ var t=NAV[sec];'
  + 'if(!t)return "";'
  + 'if(t.indexOf("/stellar")<0)return t;'
  + 'if(mine==="stellar")return t;'
  + 'if(XS.indexOf(sec)>=0)return "/"+sec+"/"+mine;'
  + 'return ""; }'
  + 'function navback(){ try{'
  + '[].forEach.call(document.querySelectorAll("a.nx-item[href],a.nb-tab[href]"),function(a){'
  + 'if(a.getAttribute("data-lxnb")==="1")return;'
  + 'var m=(a.getAttribute("href")||"").match(/^\\/([a-z-]+)\\/xrpl$/);'
  + 'if(!m)return;'
  + 'var t=dest(m[1]); if(!t)return;'
  + 'a.setAttribute("data-lxnb","1");'
  + 'a.setAttribute("href",t);'
  + '}); }catch(_){} }'
  + 'function THE(c){ return (CH[c]&&CH[c].the)||c; }'
  + 'function AN(c){ return CH[c]?(CH[c].art+" "+CH[c].name):c; }'
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
  // A way out that is not "go and find the disconnect button": the same section on the chain they
  // ARE connected to. Built from this page's own path, so it cannot point at the wrong section, and
  // offered only for a section that EXISTS on the wallet's chain -- see CROSSCHAIN.
  //
  // The old form hard-coded the two ids ("/stellar" or else "/xrpl"), which on this build meant any
  // wallet that was not Stellar got sent to the XRPL page -- that is, to the page already on screen,
  // under a label promising NEAR. It also offered the link for any first segment at all, /account
  // among them, where the target is a 404.
  + 'var seg=(location.pathname||"/").toLowerCase().split("/").filter(Boolean)[0]||"";'
  + 'if(seg&&XS.indexOf(seg)>=0&&CH[mine]){ var go=document.createElement("a"); go.className="lx-wcbar-go";'
  + 'go.href="/"+seg+"/"+mine;'
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
  + 'function run(){ bar(); fit(); lock(document); navback(); }'
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

let files = 0, pages = 0, swapped = 0, appended = 0;
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

    // IN PLACE, NOT STRIP-AND-RE-APPEND. The old form removed all three blocks and put them back at
    // the end of <head> and just before </body>, which lands them LAST in the cascade however early
    // they used to sit -- the trap in [[running-one-stellar-transform-reorders-layers]], and the
    // reason this fork's transforms were never to be run singly. rebuild.js runs _xrplwalletlogo
    // immediately after this one, so re-appending here moved that layer's work behind this one's
    // every time. Swapping each block where it already sits keeps its position exactly.
    //
    // Nothing between the old strip and the old append read `h`, so collapsing the two is safe here
    // -- that is the first trap named in that note, and worth re-checking if code is ever added to
    // this loop.
    //
    // A container that never carried the layer still appends, and still lands last. That is correct,
    // and a layer-order gate should read it as a set difference rather than as a move.
    for (const [open, close, block, tail] of [
      ['<style id="lx-xwrongchain-css">', '</style>', STYLE, '</head>'],
      ['<script id="lx-xwrongchain">', '</script>', HEAD, '</head>'],
      ['<script id="lx-xwrongchain-js">', '</script>', BODY, '</body>'],
    ]) {
      const at = h.indexOf(open);
      const end = at < 0 ? -1 : h.indexOf(close, at);
      if (at >= 0 && end > at) { h = h.slice(0, at) + block + h.slice(end + close.length); swapped++; continue; }
      if (tail === '</head>') { h = h.replace('</head>', block + '</head>'); }
      else { const bi = h.lastIndexOf('</body>'); h = h.slice(0, bi) + block + h.slice(bi); }
      appended++;
    }
    json[k] = h;
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

// Swapped vs appended, not one total: on a tree that already carries the layer every block should
// SWAP. An `appended` above zero on a re-run means a block was not found where it was left, which is
// the only outward sign that a layer is about to change position.
console.log('xrpl wrong-chain notice: ' + pages + ' page key(s) across ' + files + ' container(s) — '
  + swapped + ' block(s) swapped in place, ' + appended + ' appended');
if (!files) { console.error('  ! no container was read'); process.exit(1); }
