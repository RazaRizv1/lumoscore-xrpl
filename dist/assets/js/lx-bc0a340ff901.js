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
    ["Pick a destination and an amount","Choose where you want the money to arrive and how much to send. Each route publishes its own list of destinations and LumosCore fetches all three live, so the picker cannot offer a route that has since been withdrawn."],
    ["LumosCore picks the route","Where NEAR Intents and THORChain can both carry the transfer, both are asked for a live quote and the one that delivers MORE is used. An Axelar interchain token goes by Axelar, which is the only route that carries it. The route that will carry your transfer is named on the review before you sign."],
    ["One signature, nothing to claim","You sign a single XRP Ledger payment and the route delivers to the address you gave — no second transaction, and no gas needed on the destination. The claim step you may have seen belongs to Circle’s CCTP on the Stellar build; none of the routes here work that way."],
    ["Fees, all shown before you sign","LumosCore takes 0.2%, or 0.1% if you hold 250,000 LUMOS or more. Each route charges its own cost on top — a solver fee, destination gas, or a swap rate — and the amount you are quoted is what arrives after all of it."]
  ];
  var el=null, trigger=null;

  // Plain text only — written with textContent below, never innerHTML.
  // READ FROM THE PICKER, so the dialog and the list a user is looking at cannot disagree. The old
  // fallback to window.__lxxBridgeData.supported is gone: that object was published by the route-
  // DISCOVERY layer (lx-xrplbridge), which the bridge client now strips, so it has been permanently
  // undefined since the real routes shipped -- a fallback that could only ever produce the "no list"
  // sentence while looking like it had a second source.
  function where(){
    var list=(window.__lxxBridgeNets&&window.__lxxBridgeNets.length)?window.__lxxBridgeNets.slice():null;
    if(!list)return "the networks in the destination picker on this page.";
    if(list.length===1)return String(list[0])+".";
    // CAPPED. This wrote every destination into one sentence, which was fine at fourteen and is a
    // thirty-nine-item comma list now -- a paragraph nobody reads, in a dialog explaining the page.
    // The picker itself is the place to browse them; this says enough to show the range.
    var CAP=12;
    if(list.length>CAP){
      return list.slice(0,CAP).join(", ")+" and "+(list.length-CAP)+" more — the full list is in the destination picker.";
    }
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
      +'<p class="lx-bhiw-lede">LumosCore moves assets off the XRP Ledger through three independent networks — '
      +'<b>NEAR Intents</b>, <b>Axelar</b> and <b>THORChain</b>. They reach different places and price '
      +'differently, so the page asks every route that can carry your transfer and uses the one that pays out most.</p>'
      +'<ol class="lx-bhiw-steps">'+steps+'</ol>'
      +'<div class="lx-bhiw-note"><b>What each route is for.</b> NEAR Intents carries XRP to the most '
      +'destinations and delivers the chain’s own token rather than a wrapped copy. Axelar carries the '
      +'interchain tokens registered on this ledger, and is the only way to the XRPL EVM sidechain and to '
      +'Hedera. THORChain competes with the first on price and adds Cosmos Hub.</div>'
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
