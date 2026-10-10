(function(){
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
      +'<div class="lx-xt-row"><span class="lx-xt-price">\u2014</span><span class="lx-xt-chg"></span></div>'
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
})();