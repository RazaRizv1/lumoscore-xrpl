// The bridge page's "How it works" dialog, rewritten for what THIS build actually does.
//
// WHAT IT REPLACES. `lx-bhiw` came into the fork as built output from the Stellar build's
// _bridgehiw.js, and every line of it described Circle CCTP on Stellar: "That signature burns your
// USDC", "Circle attests to the burn", "a second signature mints native USDC", "USDC can move between
// Stellar and Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea and World Chain". On an
// XRP Ledger bridge that routes through Axelar and cannot transfer anything yet, it was wrong about
// the chain, the provider, the mechanism, the destinations, and whether money moves at all.
//
// WHY THE EARLIER COPY FIX NEVER SHOWED. The design's own #hiwModal had already been corrected to
// Axelar by _xrplcopy2.js, and nobody could see it. This script listens on WINDOW in the capture
// phase, matches any "How it works" button inside header/main, and stopImmediatePropagation()s — so
// it opens first on both layouts and the corrected design modal never receives the click. Copy passes
// skip script bodies on purpose, which is how this survived every sweep: it was never markup.
// Measured live on 2026-09-15: desktop's #dexHiwBtn and mobile's #mdxHiwBtn both opened THIS dialog.
//
// WHAT CHANGES AND WHAT DOES NOT. The component is identical — same classes (so lx-bhiw-css styles it
// exactly as before), same triggers, same capture handler, same focus and scroll-lock save/restore,
// same Escape handling. Only the words change, and every claim below is one the bridge page already
// makes in its own FAQ (_xrplbridgecopy.js): routes are looked up through Axelar, looking them up is
// read-only, there is nothing to sign or claim, and fees apply only once transfers exist. That is the
// same rule the Stellar original followed — say nothing the page does not already assert.
//
// "WHERE IT GOES" IS READ LIVE, when the dialog opens, from window.__lxxBridgeData.supported — the
// /lxapi/xrplbridge payload the destination picker is built from. So the dialog and the picker cannot
// list different networks, and neither can go stale. Fee figures are deliberately NOT written here:
// the percentages already live in too many hardcoded places, and a ninth copy is how they drift.
(function(){
  if(window.__lxBhiw)return; window.__lxBhiw=1;
  var STEPS=[
    ["Pick a destination","Choose the network you want to reach. The list comes from Axelar and Wanchain and is fetched live, so it cannot offer a route that has since been removed."],
    ["Nothing is signed","Looking up routes is read-only. No funds move and no transaction is signed, so nothing is left pending if you close the tab."],
    ["Nothing to claim","There is no claim step, because no transfer happens yet. The claim step you may have seen belongs to Circle’s CCTP on the Stellar build, and Axelar and Wanchain routing do not work that way."],
    ["Fees once it is live","None today, because no transfer takes place. When bridging is enabled the platform fee is the same as everywhere else on LumosCore, and each chain’s own network fee is paid to that chain, never to us."]
  ];
  var el=null, trigger=null;

  // Plain text only — written with textContent below, never innerHTML.
  function where(){
    var d=window.__lxxBridgeData;
    // The full list the destination picker offers (bridge.js publishes it), not the old fourteen.
    var list=(window.__lxxBridgeNets&&window.__lxxBridgeNets.length)?window.__lxxBridgeNets.slice():((d&&d.supported&&d.supported.length)?d.supported.slice():null);
    if(!list)return "the networks in the destination picker on this page.";
    if(list.length===1)return String(list[0])+".";
    return list.slice(0,-1).join(", ")+" and "+list[list.length-1]+".";
  }

  function build(){
    if(el)return el;
    el=document.createElement("div");
    el.className="lx-bhiw"; el.setAttribute("hidden","");
    el.setAttribute("role","dialog"); el.setAttribute("aria-modal","true");
    el.setAttribute("aria-label","How the cross-chain bridge works");
    var steps="";
    for(var i=0;i<STEPS.length;i++){
      steps+='<li data-n="'+(i+1)+'"><h4>'+STEPS[i][0]+'</h4><p>'+STEPS[i][1]+'</p></li>';
    }
    el.innerHTML='<div class="lx-bhiw-bd" data-lxbhiw-close></div>'
      +'<div class="lx-bhiw-card">'
      +'<div class="lx-bhiw-head"><h3>How the bridge works</h3>'
      +'<button class="lx-bhiw-x" type="button" aria-label="Close" data-lxbhiw-close><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
      +'<div class="lx-bhiw-body">'
      +'<p class="lx-bhiw-lede">LumosCore shows which networks the XRP Ledger can reach through <b>Axelar</b> and <b>Wanchain</b>, '
      +'two interchain networks that connect blockchains to each other. <b>Transfers are not enabled yet</b>, '
      +'so picking a route does not move anything, and nothing here will ask you to approve a transaction.</p>'
      +'<ol class="lx-bhiw-steps">'+steps+'</ol>'
      +'<div class="lx-bhiw-note"><b>Still being built.</b> The page says so rather than offering a button '
      +'that looks like it works. These steps will describe the real transfer once a route can actually be '
      +'executed.</div>'
      +'<div class="lx-bhiw-chains"><b>Where it goes:</b> <span class="lx-bhiw-where"></span></div>'
      +'</div></div>';
    document.body.appendChild(el);
    return el;
  }
  function open(){
    build();
    try{ el.querySelector(".lx-bhiw-where").textContent=where(); }catch(_){}
    el.removeAttribute("hidden");
    try{ el.querySelector(".lx-bhiw-card").scrollTop=0; }catch(_){}
    try{ el.__lxOvf=document.body.style.overflow; document.body.style.overflow="hidden"; }catch(_){}
    try{ el.querySelector(".lx-bhiw-x").focus(); }catch(_){}
  }
  function close(){
    if(!el)return;
    el.setAttribute("hidden","");
    try{ document.body.style.overflow=el.__lxOvf||""; }catch(_){}
    try{ if(trigger&&trigger.focus)trigger.focus(); }catch(_){}
  }
  // Delegated, and capturing: the button lives inside a step card the page re-renders, so a listener
  // bound to the node itself would be orphaned the first time that happened.
  window.addEventListener("click",function(e){
    var t=e.target; if(!t||!t.closest)return;
    if(t.closest("[data-lxbhiw-close]")){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    var hit=t.closest("#mdxHiwBtn,#brHiwBtn");
    if(!hit){
      // the desktop build labels the same control differently; match on what it SAYS as a fallback
      var b=t.closest("button,a");
      if(b&&/how it works/i.test((b.textContent||""))&&b.closest(".br-step,.mdx-hero-ctas,.crumb-bar,header,main"))hit=b;
    }
    if(hit){ e.preventDefault(); e.stopImmediatePropagation(); trigger=hit; open(); }
  },true);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape"||e.keyCode===27)close(); });
})();
