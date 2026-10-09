// The top of the Dashboard: an XRP price chart, the way Stellar has an XLM one.
//
// WHAT WAS THERE. Nothing. RAZA, 2026-09-08: "the top section of Dashboard is from the old design
// that we've already changed. On main we're now showing a Stellar price chart with some stats.
// That's how it's supposed to be on XRPL with XRP price."
//
// This is NOT a missing design. Stellar's panel is already in the container — the fork is built from
// Stellar's pages, so `lx-dashtop-css` came across with everything else. What did not come across is
// the script that builds the panel the stylesheet is for: `_xrpldash` strips `lx-dashtop` along with
// the other Stellar data layers, because it reads /lxapi/xlm and horizon.stellar.org, neither of
// which exists here. So the dashboard shipped the full stylesheet for a panel nothing ever built —
// the same stripped-layer shape as the invisible `.status-row`, and the reason the top of the page
// looked like an older design: what RAZA was seeing is the page WITHOUT the panel, not an old panel.
//
// So this injects the behaviour and inherits the design, which is the whole build model of the fork.
// It deliberately does NOT re-emit `lx-dashtop-css`: that stylesheet is the design, it arrives with
// `--base`, and a second copy here is how the two drift apart. It is ASSERTED instead — if a future
// change ever strips it, this fails loudly at build time rather than shipping an unstyled panel.
//
// THE ONE VISUAL DELTA is the mark beside the label, which the inherited sheet hardcodes to
// /assets/tokens/xlm.png — Stellar's logo, on an XRP Ledger dashboard. It is re-pointed at XRP's own
// logo through the same /lxapi/xrplthumb proxy every other token logo on this site uses, at a
// specificity that beats the inherited rule (0,2,0 against 0,1,0) rather than with !important, so
// source order between the two sheets cannot decide it.
//
// DATA. Two edge-cached endpoints, no new ones:
//   /lxapi/xrplprices    ->  `usd` (USD per XRP) and `t.XRP[1]` (24h %). Deliberately the same
//                            source the wallet prices itself from, so the dashboard and the wallet
//                            cannot quote different prices for the same asset.
//   /lxapi/xrplohlc      ->  the series, as [timeMs, close] pairs.
//
// Because the series carries REAL timestamps — Stellar's does not — the hover readout names the
// actual time of the point rather than deriving "3 days ago" from its index. Same slot, same look,
// a date that is read rather than inferred.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

// XRP's own logo id on xrpl.to. Verified by fetching it through the proxy and looking at it: the
// white X on the dark disc. XRP is NOT in the token rankings (it is the native asset, not an issued
// one), so this id cannot be read out of /lxapi/xrpltokens the way an issued token's is.
const XRP_MD5 = '84e5efeb89c4eae8f68188982dc290d8';

const STYLE = `<style id="lx-xrpldashtop-css">
/* The mark beside the label. The inherited sheet points this at Stellar's xlm.png; two classes beat
   its one, so this wins on specificity and does not depend on which stylesheet came last. */
.lx-xlmpanel .lx-xt-mark{
  background:url('/lxapi/xrplthumb?id=${XRP_MD5}&w=64') center/cover no-repeat,var(--surface-2)}
/* THE RANGE BELONGS TO THE CHART. Stellar moved these controls on 2026-09-19 -- RAZA then: "place
   24H 7D 1M 1Y above the chart on right. this looks misplaced" -- and this fork copied Stellar's
   BUILT containers before that, so the inherited sheet still carries .lx-xt-tfs and has never heard
   of .lx-xt-r. Reported again here on 2026-10-01. Defined in this file rather than waited for,
   because the containers will not gain it on their own.
   Same values as Stellar's _dashtop.js, so the two dashboards stay one design. */
.lx-xt-r{display:flex;flex-direction:column;align-items:flex-end;gap:10px;align-self:center;min-width:0}
/* padding and gap at Stellar's 3px, not the inherited 3.3px. Those 0.3s made the control 35px tall
   against Stellar's 33, which set the RIGHT column to 149 against 147 -- and since the grid row takes
   the taller of the two, that alone was the last 2px of the card's height. */
.lx-xt-r .lx-xt-tfs{margin-top:0;align-self:flex-end;gap:3px;padding:3px}
/* and the buttons inside it: 5/11 as Stellar has them, not the inherited 5.5/12.1. */
.lx-xt-r .lx-xt-tfs>button{padding:5px 11px}
/* 860px, matching Stellar's own breakpoint for this panel. It said 760 and nothing else here does. */
@media (max-width:860px){.lx-xt-r{align-self:stretch;width:100%}}

/* ---- THE REST OF THE CARD, brought back level with Stellar's (RAZA 2026-10-01: "its still not the
   same") ----------------------------------------------------------------------------------------
   Measured side by side at 1440x900 before changing anything. The inherited sheet is a SNAPSHOT of
   how Stellar's panel looked when this fork copied its built containers, with the 1.1 typescale
   already baked in -- its price is 30*1.1=33px and its small variant 25*1.1=27.5px, against the 42px
   and 32px Stellar serves today. The containers will never gain the newer values on their own, so
   they are restated here, two classes to one, exactly as .lx-xt-r above already is.

   Each line is a measured difference, not a tidy-up:
     justify-content  the inherited rule has NONE, so the column sticks to the top of a 271px card and
                      leaves the empty band under the price that prompted this.
     gap 2.2 -> 14    logo, title, price and pill were packed together.
     align-items      baseline sat the pill low against a big number; Stellar centres it.
     font-size 17     the title was 18.7px -- LARGER than Stellar's while the price was smaller, which
                      inverts the hierarchy between a label and the number it labels.
     tabular-nums     absent here. On a price that ticks, proportional digits change width and the
                      whole line shifts; this is the one difference a screenshot will not show.

   font-variant-numeric comes AFTER the shorthand on purpose: the font shorthand resets it. */
.lx-xlmpanel .lx-xt-l{gap:14px;justify-content:center}
.lx-xlmpanel .lx-xt-row{align-items:center;gap:14px}
.lx-xlmpanel .lx-xt-lbl{font-size:17px}
.lx-xlmpanel .lx-xt-price{font:800 42px/1 'JetBrains Mono',monospace;letter-spacing:-1.5px;
  font-variant-numeric:tabular-nums}
.lx-xlmpanel .lx-xt-chg{font:800 14px/1 'JetBrains Mono',monospace;padding:7px 12px}
@media(max-width:860px){.lx-xlmpanel .lx-xt-price{font-size:32px}}

/* THE PANEL'S OWN BOX, which is the last thing still 1.1x Stellar's and is why the card measured 280px
   against 271px with every line sitting 2-3px low. Measured: padding 17.6/19.8 against 16/18, gap 19.8
   against 18, and the Network Stats strip 77px tall against 74px -- every one of them exactly 1.1x.
   The class is repeated to beat the inherited one-class rule on specificity rather than on which
   stylesheet happens to land later in <head>, which is not a tiebreaker worth relying on. */
.lx-xlmpanel.lx-xlmpanel{padding:16px 18px 0;gap:18px}
.lx-xlmpanel.lx-xlmpanel>.status-row{padding:13px 18px 14px}
@media(max-width:860px){
  .lx-xlmpanel.lx-xlmpanel{padding:14px 14px 0;gap:12px}
  .lx-xlmpanel.lx-xlmpanel>.status-row{margin:12px -14px 0}
}
/* THE ACTIVITY FLASH (RAZA 2026-10-07: "Flash bug on Dashboard platfrom activity for split seconds
   when i refresh the page"). What flashed was another chain's invented transactions -- "MOD launched
   on Aptos", "Bridged 2,400 APT" -- for a few hundred milliseconds before the real feed replaced
   them.

   NOT IN THE MARKUP, which is why there was nothing to strip at build time: #activityList ships EMPTY
   and the DESIGN'S OWN script fills it, so this is the second-writer shape rather than leftover mock
   HTML. The next remedy in order is a container gate, and this is it.

   Hiding the CHILDREN, not the panel: the card, its heading and its border stay on screen the whole
   time. dashboard.js sets data-lxact the moment it writes -- rows, "no activity", or an error -- and
   on a timer regardless, so a feed that never answers degrades to an empty card rather than a
   permanently blank one.

   VISIBILITY, NOT DISPLAY (changed 2026-10-09, when the same gate was ported to Stellar and the
   side effect was measured): "display:none" collapsed the card from 691px to 131px and let it snap
   back when the feed landed. The claim above that "the page does not change height" was simply
   wrong. A "min-height" would be the obvious patch and is the wrong one -- the winning rule is
   ".market-grid>.activity-card .activity-scroll{flex:1 1 0;min-height:0;max-height:none}", so the
   height is flex-driven, any number is a guess that a tablet breaks (it gets the MOBILE build at
   desktop widths), and over-reserving for an account with three transactions shrinks the card
   afterwards -- the same jump, backwards. Concealing in place needs no number: 691px shut, 691px
   open. Stellar's copy in _dashtop.js is the same rule; change one, change the other. */
#activityList:not([data-lxact]) > *{visibility:hidden!important}
</style>`;

// No `${` anywhere below this line: it is a template literal and an interpolation here would be
// evaluated at build time. The one above is deliberate and is a constant.
const SCRIPT = `<script id="lx-xrpldashtop">(function(){
  if(window.__lxxDashTop)return;window.__lxxDashTop=1;

  // Button label -> the range the OHLC endpoint understands. The four labels are the design's, and
  // they stay exactly as Stellar has them; only "1M" needs translating, because upstream calls that
  // window 30D.
  var UP={"24H":"24H","7D":"7D","1M":"30D","1Y":"1Y"};
  var tf="24H", cache={}, priceDone=false;

  function j(u){return fetch(u).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();});}

  // Stellar's version is 4dp under a dollar and 2dp above, which was written for XLM at $0.18. XRP
  // is $1.41, so that rule would print "$1.41" directly above a strip pill reading "$1.4135" — the
  // same number, twice, disagreeing. Matched to the pill (browser/dashboard.js writes toFixed(4))
  // up to $10, so the two figures on this card are always the same figure.
  function money(n){n=+n||0;return "$"+(n<10?n.toFixed(4):n.toFixed(2));}
  function fmtUsd(v){ v=+v||0;
    if(v>=1)return "$"+v.toLocaleString("en-US",{maximumFractionDigits:4});
    return "$"+(+v.toFixed(6)).toString(); }

  function build(){
    var row=document.querySelector(".status-row"); if(!row)return null;
    // Document-wide, never row.parentNode.querySelector: once the strip has moved inside the panel
    // the panel IS its parent, and an element is not its own descendant — that lookup builds a
    // SECOND panel inside the first and everything paints into the copy. (Stellar shipped that bug.)
    var p=document.querySelector(".lx-xlmpanel");
    if(p)return p;
    var host=row.parentNode; if(!host)return null;
    p=document.createElement("div"); p.className="lx-xlmpanel lx-loading"; p.setAttribute("data-lx-noswap","1");
    p.innerHTML='<div class="lx-xt-l">'
      +'<span class="lx-xt-head">'
      +'<span class="lx-xt-mark" aria-hidden="true"></span>'
      +'<span class="lx-xt-lbl">XRP Ledger (XRP)</span>'
      +'</span>'
      +'<div class="lx-xt-row"><span class="lx-xt-price">\\u2014</span><span class="lx-xt-chg"></span></div>'
      +'</div>'
      // Under the price these read as a setting for the PRICE; they set the chart's window, so they
      // sit on top of the chart and right-aligned to it, exactly as Stellar's _dashtop.js has it.
      // Both are still found by class inside the panel, so the wiring below is unchanged.
      +'<div class="lx-xt-r">'
      +'<div class="lx-xt-tfs">'
        +'<button type="button" data-lxnonav="1" data-tf="24H" class="active">24H</button>'
        +'<button type="button" data-lxnonav="1" data-tf="7D">7D</button>'
        +'<button type="button" data-lxnonav="1" data-tf="1M">1M</button>'
        +'<button type="button" data-lxnonav="1" data-tf="1Y">1Y</button>'
      +'</div>'
      +'<div class="lx-xt-chart lx-empty"></div>'
      +'</div>';
    host.insertBefore(p,row);
    p.appendChild(row);                       // the stats strip lives inside the card — see place()
    // The design maps clicked label text to a destination, so a control inside it needs the opt-out
    // or "1M" navigates the page away.
    [].slice.call(p.querySelectorAll(".lx-xt-tfs button")).forEach(function(b){
      b.addEventListener("click",function(e){
        try{e.preventDefault();e.stopPropagation();}catch(_){}
        var t=b.getAttribute("data-tf"); if(t===tf)return; tf=t;
        [].slice.call(p.querySelectorAll(".lx-xt-tfs button")).forEach(function(x){x.classList.toggle("active",x===b);});
        load();
      });
    });
    return p;
  }

  // pts are [timeMs, close] pairs.
  function draw(pts){
    var p=build(); if(!p)return;
    var box=p.querySelector(".lx-xt-chart"); if(!box)return;
    if(!pts||pts.length<2){ box.classList.add("lx-empty"); box.innerHTML=""; return; }
    box.classList.remove("lx-empty");
    var W=420,H=104,PAD=6,n=pts.length,i;
    var vals=[]; for(i=0;i<n;i++)vals.push(pts[i][1]);
    var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals),rg=(mx-mn)||Math.abs(mx)||1;
    var up=vals[n-1]>=vals[0], col=up?"#35c07f":"#ff5b5b";
    var d="";
    for(i=0;i<n;i++){
      var x=(i/(n-1))*W, y=H-PAD-((vals[i]-mn)/rg)*(H-PAD*2);
      d+=(i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
    }
    var gid="lxxt"+(up?"u":"d");
    box.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      +'<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'
      +'<stop offset="0" stop-color="'+col+'" stop-opacity=".26"/>'
      +'<stop offset="1" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'
      +'<path d="'+d+' L'+W+' '+H+' L0 '+H+' Z" fill="url(#'+gid+')" stroke="none"></path>'
      +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></path>'
      +'</svg>';
    box.__lxpts=pts;
    box.__lxcol=col;
    wireHover(box);
  }

  // Read the chart by pointing at it. The elements are re-created on every draw, the LISTENERS only
  // once — guarding both together is how the readout ends up existing after the first render and
  // silently wiped by the second.
  function wireHover(box){
    box.style.position=box.style.position||"relative";
    var tip=box.querySelector(".lx-xt-tip");
    if(!tip){ tip=document.createElement("div"); tip.className="lx-xt-tip"; box.appendChild(tip); }
    var vl=box.querySelector(".lx-xt-vl");
    if(!vl){ vl=document.createElement("div"); vl.className="lx-xt-vl"; box.appendChild(vl); }
    var dot=box.querySelector(".lx-xt-dot");
    if(!dot){ dot=document.createElement("div"); dot.className="lx-xt-dot"; box.appendChild(dot); }
    if(box.__lxhov)return; box.__lxhov=1;

    // The series carries real timestamps, so the label is READ, not derived from the index. Time of
    // day on the intraday range, a date on the rest.
    function stamp(ms){
      try{
        var dt=new Date(ms);
        if(tf==="24H")return dt.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
        return dt.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
      }catch(_){return "";}
    }
    function at(clientX){
      var tip=box.querySelector(".lx-xt-tip"), vl=box.querySelector(".lx-xt-vl");
      if(!tip||!vl)return;
      var pts=box.__lxpts; if(!pts||pts.length<2)return;
      var r=box.getBoundingClientRect(); if(!r.width)return;
      var f=Math.max(0,Math.min(1,(clientX-r.left)/r.width));
      var i=Math.round(f*(pts.length-1));
      var when=stamp(pts[i][0]);
      tip.innerHTML=(when?('<div class="d">'+when+'</div>'):'')
        +'<div class="lx-xt-tr"><span class="k">Price</span><span class="v">'+fmtUsd(pts[i][1])+'</span></div>';
      tip.classList.add("on");
      vl.style.left=Math.round(f*r.width)+"px"; vl.style.opacity="1";
      // Snapped to the point the tooltip quotes, not the raw pointer: same W/H/PAD and the same
      // min/max over the same array as draw(), so the marker cannot drift off the path.
      var _dot=box.querySelector(".lx-xt-dot");
      if(_dot){
        var _H=104,_PAD=6,k,vals=[];
        for(k=0;k<pts.length;k++)vals.push(pts[k][1]);
        var _mn=Math.min.apply(null,vals),_mx=Math.max.apply(null,vals),_rg=(_mx-_mn)||Math.abs(_mx)||1;
        var _yv=_H-_PAD-((vals[i]-_mn)/_rg)*(_H-_PAD*2);
        _dot.style.left=Math.round((i/(pts.length-1))*r.width)+"px";
        _dot.style.top=(_yv/_H*r.height).toFixed(1)+"px";
        _dot.style.color=box.__lxcol||"var(--accent,#ea6a2c)";
        _dot.style.opacity="1";
      }
    }
    function off(){ var t=box.querySelector(".lx-xt-tip"),v=box.querySelector(".lx-xt-vl"),d=box.querySelector(".lx-xt-dot");
      if(t)t.classList.remove("on"); if(v)v.style.opacity="0"; if(d)d.style.opacity="0"; }
    box.addEventListener("mousemove",function(e){ at(e.clientX); });
    box.addEventListener("mouseleave",off);
    // On a phone the finger IS the pointer, so the readout is NOT cleared on touchend — lifting the
    // finger would erase the value the tap was for. A tap elsewhere clears it.
    box.addEventListener("touchstart",function(e){ if(e.touches&&e.touches[0])at(e.touches[0].clientX); },{passive:true});
    box.addEventListener("touchmove",function(e){ if(e.touches&&e.touches[0])at(e.touches[0].clientX); },{passive:true});
    document.addEventListener("touchstart",function(e){
      var t=e.target; if(t&&t.closest&&t.closest(".lx-xt-chart"))return; off();
    },{passive:true});
  }

  function load(){
    if(cache[tf]){ draw(cache[tf]); return; }
    // A series from an earlier visit, drawn at once and replaced when the live one lands. Six hours,
    // because a stale SHAPE is worth far more than an empty box and the headline price is live.
    try{ var w=JSON.parse(localStorage.getItem("lumos.xrpSeries."+tf)||"null");
      if(w&&w.v&&w.v.length>1&&(Date.now()-w.ts<216e5)){ cache[tf]=w.v; draw(w.v); } }catch(_){}
    var r=UP[tf]||"24H";
    j("/lxapi/xrplohlc?id=XRP&r="+encodeURIComponent(r)+"&vs=USD")
      .then(function(d){
        if(!d||!d.ok)throw new Error("no series");
        var v=(d.pts||[]).filter(function(p){return p&&isFinite(p[0])&&isFinite(p[1])&&p[1]>0;});
        if(v.length<2)throw new Error("short series");
        // 1Y comes back daily and 24H every 15 minutes; thin the long ranges so the line stays
        // readable and the path stays small.
        if(v.length>180){ var step=Math.ceil(v.length/180),out=[],i;
          for(i=0;i<v.length;i+=step)out.push(v[i]);
          if(out[out.length-1]!==v[v.length-1])out.push(v[v.length-1]);
          v=out; }
        cache[tf]=v;
        try{ localStorage.setItem("lumos.xrpSeries."+tf,JSON.stringify({v:v,ts:Date.now()})); }catch(_){}
        draw(v);
      }).catch(function(){ if(!cache[tf])draw(null); });
  }

  // THE PRICE IS THE ONE THE PILL BELOW IT IS ABOUT TO PAINT, taken from the very same response.
  //
  // This headline sits about twenty pixels above the "XRP price" pill that browser/dashboard.js
  // writes from /lxapi/xrpltokens. Asking for that rate independently — even from the same URL —
  // does not agree with it: the endpoint is sampled, so two calls seconds apart differ in the last
  // digit, and the card showed "$1.4137" above "$1.4135". Fetching a SECOND source (xrplprices, also
  // a correct XRP->USD rate) was worse still, at four cents apart in one measurement.
  //
  // So there is one fetch and one writer: dashboard.js publishes its payload as __lxxDashData and
  // announces it, and this reads that. The two figures are then the same number by construction
  // rather than by luck, and the panel costs no request of its own.
  function paintPrice(d){
    if(!d||!d.ok)return;
    var p=build(); if(!p)return;
    var usd=+d.usd;
    var el=p.querySelector(".lx-xt-price");
    if(el&&isFinite(usd)&&usd>0){ el.textContent=money(usd); p.classList.remove("lx-loading"); priceDone=true; }
  }

  // The 24h change is not in that payload, so it does come from /lxapi/xrplprices, where t.XRP is
  // [priceInXrp, chg24, chg7d] (priceInXrp being 1 by definition). A 24h aggregate taken from a
  // slightly different snapshot is not a figure anyone can see contradicted on the card.
  function change(){
    j("/lxapi/xrplprices")
      .then(function(d){
        if(!d||!d.ok)return;
        var p=build(); if(!p)return;
        var ch=p.querySelector(".lx-xt-chg");
        var x=(d.t&&d.t.XRP)||null, c=x?+x[1]:null;
        if(ch&&c!=null&&isFinite(c)){
          ch.className="lx-xt-chg "+(c>=0?"up":"down");
          ch.textContent=Math.abs(c).toFixed(2)+"% (24h)";
        }
      }).catch(function(){});
  }

  // Registered ONCE. This used to be called on the 45s beat as well, which added a fresh
  // "lxx:dashdata" listener every time it ran — a listener leak that grows for as long as the tab
  // is open. The beat re-paints from the published payload instead.
  function price(){
    if(window.__lxxDashData)paintPrice(window.__lxxDashData);
    try{ window.addEventListener("lxx:dashdata",function(){ paintPrice(window.__lxxDashData); }); }catch(_){}
    // Only if that layer never answers — it is on every dashboard page, so this is a safety net,
    // not the normal path. Same URL it uses, so even the net lands on the same cache entry.
    setTimeout(function(){
      if(priceDone)return;
      j("/lxapi/xrpltokens?n=1").then(paintPrice).catch(function(){});
    },6000);
  }

  // Keep the strip inside the card. browser/dashboard.js rewrites the pills in place — it does not
  // move the row — but the design's own re-skin can re-parent it, and build() only runs once.
  function place(){
    var p=document.querySelector(".lx-xlmpanel"), row=document.querySelector(".status-row");
    if(!p||!row)return;
    if(row.parentNode!==p||p.lastElementChild!==row)p.appendChild(row);
  }

  function run(){ build(); place(); load(); price(); change(); }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);
  else run();
  setInterval(function(){ place(); paintPrice(window.__lxxDashData); change(); },45000);
  // Re-parented the moment the strip exists rather than only on the 45s beat: dashboard.js paints
  // the pills before this file's first run in some orders, and a strip that appears outside the card
  // and then jumps into it is a flash.
  try{ new MutationObserver(function(){ place(); })
    .observe(document.documentElement,{childList:true,subtree:true}); }catch(_){}
})();</script>`;

let containers = 0, pages = 0, missingSheet = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let p = json[k];
    const before = p;

    // Idempotent: drop any previous copy of BOTH halves before deciding whether this page gets one.
    p = p.replace(/<style id="lx-xrpldashtop-css">[\s\S]*?<\/style>/g, '');
    p = stripById(p, 'lx-xrpldashtop').html;

    // The dashboard, identified the way the Stellar transform identifies it: the stats strip plus
    // the activity feed. Every other page keeps the removal above and nothing else.
    if (p.indexOf('status-row') < 0 || p.indexOf('activityList') < 0) {
      if (p !== before) { json[k] = p; changed = true; }
      continue;
    }

    // The inherited stylesheet IS the design here. If it ever stops arriving, this must fail loudly
    // rather than ship a panel with no styles — an unstyled panel is worse than the missing one.
    if (p.indexOf('id="lx-dashtop-css"') < 0) { missingSheet++; continue; }

    if (p.indexOf('</head>') >= 0) p = p.replace('</head>', STYLE + '</head>');
    const bi = p.lastIndexOf('</body>');
    if (bi < 0) continue;
    p = p.slice(0, bi) + SCRIPT + p.slice(bi);

    if (p !== before) { json[k] = p; changed = true; pages++; }
  }

  if (changed) {
    containers++;
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

if (missingSheet) {
  console.error('xrpl dash top: ABORTED on ' + missingSheet + ' page key(s) — the inherited '
    + 'lx-dashtop-css is gone, so the panel would ship unstyled. Re-run with --base, or emit the '
    + 'stylesheet here if Stellar has genuinely dropped it.');
  process.exit(1);
}
console.log('xrpl dash top: XRP price chart on ' + pages + ' page key(s) across ' + containers + ' container(s)');
