// Carry Stellar's wallet-chip fixes into this fork's INHERITED lx-walletlogo script.
//
// RAZA 2026-10-17: "there's still a flash on some pages that shows Stellar logo for split seconds."
// Two separate bugs live on the same node, the little mark beside the connected address:
//
//   1. THE MARK FOLLOWS THE PAGE, NOT THE WALLET. mc-engine's walkSwap() rewrites every chain mark
//      to whatever chain the URL adopted, and the chip's fallback mark is just another <img> to it.
//      So a Stellar wallet reading an XRPL page gets the XRPL mark beside its G-address, which is
//      the exact claim the wrong-chain banner on that page exists to deny. data-lx-noswap is
//      walkSwap's own documented opt-out (it checks closest()), so marking the img stops the
//      rewrite outright instead of racing it.
//   2. THE MARK IS WRONG-BY-DEFAULT UNTIL SOMETHING PAINTS IT. The chip ships with whatever the
//      markup carried; walkSwap gets there first; we correct it a few hundred ms later. That gap is
//      the flash. So the mark is HIDDEN from the stylesheet until this script says it is right.
//
// WHY A PATCH AND NOT A REBUILD. Same reason as [[_xrplfeebanner.js]]: this script is inherited
// markup, so fixing _walletlogo.js in the Stellar repo does not reach these containers, and
// `rebuild.js --base` would re-import every other Stellar change since the last copy for the sake
// of one edit.
//
// WHY IT IS NOT OWNED BY THE WRONG-CHAIN LAYER. It was, for about an hour. That layer returns early
// whenever the page's chain and the wallet's agree -- which is most pages -- while the mark is
// wrong-by-default on all of them. Worse, two writers on one node is what produced the flash in the
// first place. _xrplwrongchain.js no longer touches the chip; this is the only writer.
//
// IDEMPOTENCE: both edits are keyed on text that DISAPPEARS when applied (the bare `if(!url)return;`
// and the absence of lx-wlready), so a second run finds nothing to do -- see
// [[lumoscore-transform-idempotence]], which is the trap the fee-banner patch nearly fell into.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// The chain marks, copied from the Stellar repo's _tools/_chains.json (this fork has no copy of that
// file). They must stay identical to the switcher's, or the chip and the switcher disagree about
// what a chain looks like on the same screen.
const LOGO = {
  stellar: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzAwMCIvPjxwYXRoIGQ9Ik0yMy4xMyA5LjI5MmwtMi40IDEuMjI0LTExLjU5OCA1LjkwN0E2LjkwOSA2LjkwOSAwIDAxMTkuMzUgOS40OThsMS4zNzQtLjcuMjA1LS4xMDVhOC40MzkgOC40MzkgMCAwMC0xMy4zNzEgNy40NzIgMS41MzUgMS41MzUgMCAwMS0uODM0IDEuNDg0bC0uNzI1LjM3djEuNzI0bDIuMTM0LTEuMDg4LjY5MS0uMzUzLjY4MS0uMzQ3IDEyLjIyNi02LjIzIDEuMzc0LS42OTkgMi44NC0xLjQ0N1Y3Ljg1NkwyMy4xMyA5LjI5MnptMi44MTYgMi4wMTJMMTAuMjAxIDE5LjMybC0xLjM3NC43TDYgMjEuNDYzdjEuNzIzbDIuODA4LTEuNDMgMi40MDEtMS4yMjQgMTEuNjEtNS45MTZhNi45MDkgNi45MDkgMCAwMS0xMC4yMjkgNi45M2wtLjA4NS4wNDUtMS40OS43NmE4LjQzOSA4LjQzOSAwIDAwMTMuMzcyLTcuNDc1IDEuNTM2IDEuNTM2IDAgMDEuODMzLTEuNDgzbC43MjYtLjM3di0xLjcxOHoiIGZpbGw9IiNGRkYiLz48L2c+PC9zdmc+',
  xrpl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzIzMjkyRiIvPjxwYXRoIGQ9Ik0yMy4wNyA4aDIuODlsLTYuMDE1IDUuOTU3YTUuNjIxIDUuNjIxIDAgMDEtNy44OSAwTDYuMDM1IDhIOC45M2w0LjU3IDQuNTIzYTMuNTU2IDMuNTU2IDAgMDA0Ljk5NiAwTDIzLjA3IDh6TTguODk1IDI0LjU2M0g2bDYuMDU1LTUuOTkzYTUuNjIxIDUuNjIxIDAgMDE3Ljg5IDBMMjYgMjQuNTYyaC0yLjg5NUwxOC41IDIwYTMuNTU2IDMuNTU2IDAgMDAtNC45OTYgMGwtNC42MSA0LjU2M3oiIGZpbGw9IiNGRkYiLz48L2c+PC9zdmc+',
};

// ---- the script edit -------------------------------------------------------------------------
// paint() becomes a wrapper so ready() runs on EVERY path, including one that throws: the gate is a
// stylesheet rule and does not care whether this script survived, so a swallowed error would hide
// the mark permanently rather than for a frame. Same reason for the 2s failsafe -- ready is a
// hoisted declaration, so calling it from the top of the IIFE is legal and happens before anything
// that could fail. No regex literals below: this is plain string surgery on inherited text.
const OLD_PAINT = 'function paint(){\n    try{ nameIt(); }catch(_){}\n    var url=logo(); if(!url)return;';
const NEW_PAINT = [
  'var LXCHLOGO=' + JSON.stringify(LOGO) + ';',
  // The wallet's own chain, read from lumos.network and from the address shape when that is missing:
  // an r-address is the XRP Ledger, a G-address is Stellar.
  'function lxWchain(){',
  '  var n="",a="";',
  '  try{ n=(localStorage.getItem("lumos.network")||"").toLowerCase();',
  '       a=localStorage.getItem("lumos.address")||""; }catch(_){}',
  '  if(n==="xrpl"||n==="stellar")return n;',
  '  if(a.charAt(0)==="r")return "xrpl";',
  '  if(a.charAt(0)==="G")return "stellar";',
  '  return "";',
  '}',
  'function lxWlReady(){ try{ document.documentElement.classList.add("lx-wlready"); }catch(_){} }',
  'try{ setTimeout(lxWlReady,2000); }catch(_){}',
  'function paint(){ try{ lxPaint(); }catch(_){} lxWlReady(); }',
  // The phone header disc. Desktop's chip is an img inside .lx-tw-av; the phone's is an
  // a.avatar-sm.lx-mav painted through the --lx-netlogo custom property by the inherited
  // _wallet_header layer, which sets it to the BUILD's chain mark and nothing else -- so it showed
  // the XRP mark for every wallet, and Stellar's mark to an XRPL wallet reading a Stellar page.
  // Our own property and attribute, so a later repaint by that layer cannot overwrite us.
  'function lxPaintMobile(url){ try{',
  '  var c=lxWchain();',
  '  var want=url||(c?LXCHLOGO[c]:"");',
  '  if(!want)return;',
  '  var els=document.querySelectorAll(".lx-mav,.avatar-sm.lx-mav,.mu-av.lx-mav-net");',
  '  for(var mi=0;mi<els.length;mi++){',
  '    els[mi].style.setProperty("--lxwav",\'url("\'+want+\'")\');',
  '    els[mi].setAttribute("data-lxwav","");',
  '  }',
  '}catch(_){} }',
  'function lxPaint(){',
  '    try{ nameIt(); }catch(_){}',
  '    var url=logo();',
  '    lxPaintMobile(url);',
  '    if(!url){',
  // No artwork for this wallet, so the chain mark stands in -- and it must be the WALLET'S chain.
  // ...but "no artwork" means MAP found none, NOT that the chip is unpainted. lx-xrplconnect's
  // paintWalletChip() resolves the wallet by DISPLAY NAME and writes /assets/wallets/*.png into this
  // very img on a poll. Overwriting that is what cost RAZA his wallet logo on every XRPL page.
  '      try{',
  '        var c=lxWchain(), want=c?LXCHLOGO[c]:"";',
  '        if(want){',
  '          var ims=document.querySelectorAll(".mu-av img,.lx-tw-av img");',
  '          for(var q=0;q<ims.length;q++){',
  '            ims[q].setAttribute("data-lx-noswap","");',
  '            var cur=ims[q].getAttribute("src")||"";'
    + ' if(cur.indexOf("/assets/wallets/")>=0)continue;'
    + ' if(cur!==want)ims[q].setAttribute("src",want);',
  '          }',
  '        }',
  '      }catch(_){}',
  '      return;',
  '    }',
].join('\n  ');

// ---- upgrading a container that already carries the FIRST version of the branch above -----------
// The first version shipped to staging without the "/assets/wallets/" guard and wiped the wallet
// logo on every XRPL page. Those containers are patched already, so OLD_PAINT no longer matches
// them and a plain re-run would leave the bug in place. `rebuild.js --base` would fix it by
// re-copying Stellar's containers, but that re-imports every other Stellar change at the same time;
// this upgrades the two lines in place instead. The replacement drops the search string entirely
// (getAttribute("src")!==want becomes cur!==want), so it cannot re-match itself.
//
// ONE LINE, NO LEADING INDENTATION. The first attempt matched two lines indented as they appear in
// the array above -- and matched nothing, because `.join('\n  ')` adds two more spaces to every line
// it emits, so the container holds 14 where the source reads 12. Anchoring inside a single emitted
// statement sidesteps the question entirely. Setting data-lx-noswap on a wallet logo is deliberate:
// walkSwap should not touch that img either.
const OLD_GUARD = 'if(ims[q].getAttribute("src")!==want)ims[q].setAttribute("src",want);';
const NEW_GUARD = 'var cur=ims[q].getAttribute("src")||"";'
  + ' if(cur.indexOf("/assets/wallets/")>=0)continue;'
  + ' if(cur!==want)ims[q].setAttribute("src",want);';

// ---- upgrading a container that was patched before the phone disc was handled -------------------
// Containers already carrying the earlier patch no longer match OLD_PAINT, so the mobile code would
// never reach them -- the same migration problem the wallet-art guard had, and the reason that one
// exists a few lines above. Both replacements are keyed on text that gains lxPaintMobile, so the
// presence of that name is the marker and a second run is a no-op.
const OLD_MOB = 'function paint(){ try{ lxPaint(); }catch(_){} lxWlReady(); }\n  function lxPaint(){';
const NEW_MOB = 'function paint(){ try{ lxPaint(); }catch(_){} lxWlReady(); }\n'
  + '  function lxPaintMobile(url){ try{\n'
  + '    var c=lxWchain();\n'
  + '    var want=url||(c?LXCHLOGO[c]:"");\n'
  + '    if(!want)return;\n'
  + '    var els=document.querySelectorAll(".lx-mav,.avatar-sm.lx-mav,.mu-av.lx-mav-net");\n'
  + '    for(var mi=0;mi<els.length;mi++){\n'
  + '      els[mi].style.setProperty("--lxwav",\'url("\'+want+\'")\');\n'
  + '      els[mi].setAttribute("data-lxwav","");\n'
  + '    }\n'
  + '  }catch(_){} }\n'
  + '  function lxPaint(){';
const OLD_MOBCALL = '      try{ nameIt(); }catch(_){}\n      var url=logo();';
const NEW_MOBCALL = '      try{ nameIt(); }catch(_){}\n      var url=logo();\n      lxPaintMobile(url);';

// ---- the id-resolution edit --------------------------------------------------------------------
// MAP is keyed on SHORT ids (gem, xaman) while `lumos.wallet` holds the wallet's DISPLAY NAME on
// this chain -- lx-xrplconnect's own walletLogo() says so in as many words ("lumos.wallet stores the
// display name"), and matches on it. So "GemWallet" normalises to "gemwallet", misses MAP["gem"],
// and this script concludes the wallet has no artwork when it plainly does.
//
// Stellar's _walletlogo.js grew this longest-prefix fallback earlier today for exactly that case.
// This fork never got it, because it carries a frozen copy of that script -- which is how the same
// wallet resolved on a Stellar page and not on an XRPL one, the asymmetry that made the regression
// look chain-specific when the cause was a stale copy.
const OLD_LOGO = 'return MAP[id]||"";';
const NEW_LOGO = [
  'if(MAP[id])return MAP[id];',
  // Longest key first, so "gem" never shadows a longer id that also starts with it. Keys of 1-2
  // characters are excluded: they would match almost anything.
  'var lxk=Object.keys(MAP).sort(function(a,b){return b.length-a.length;});',
  'for(var lxi=0;lxi<lxk.length;lxi++){',
  '  if(lxk[lxi].length>2&&id.indexOf(lxk[lxi])===0)return MAP[lxk[lxi]];',
  '}',
  'return "";',
].join('\n    ');

// ---- the stylesheet edit ---------------------------------------------------------------------
// visibility, not display, so the chip does not change width when it reveals.
const OLD_CSS = '.mu-av.lx-haswl>img,.lx-tw-av.lx-haswl>img{display:none!important}';
const NEW_CSS = OLD_CSS + '\n'
  + '/* Hidden until this script has decided what the mark should be -- see _xrplwalletlogo.js.\n'
  + '   Gated on OUR work being done, not on "the chain is decided": paint() lifts it on both of its\n'
  + '   paths, so it clears whether a wallet logo was found or the chain mark stood in. A gate keyed\n'
  + '   on the earlier event is what let the Aptos flash through for months. */\n'
  + 'html:not(.lx-wlready) .mu-av>img,html:not(.lx-wlready) .lx-tw-av>img{visibility:hidden!important}';

// THE PHONE RULE IS APPENDED TO THE GATE, not shipped inside NEW_CSS. Bundling it there meant a
// container that already carried the gate still matched OLD_CSS -- it remains a substring of what
// the page now holds -- so the WHOLE block went in again, gate included. Measured immediately after:
// the gate rule appeared TWICE on all 128 pages. Identical copies, so nothing rendered wrong and
// nothing but waste, which is precisely the shape that shipped six times before anyone looked the
// last time this happened.
const GATE_RULE = 'html:not(.lx-wlready) .mu-av>img,html:not(.lx-wlready) .lx-tw-av>img{visibility:hidden!important}';
const OLD_SEL = '.lx-mav[data-lxwav],.avatar-sm[data-lxwav],.mu-av[data-lxwav]{background-image:var(--lxwav)!important}';
const PHONE_SEL = '.lx-mav[data-lxwav]::before,.avatar-sm[data-lxwav]::before{background-image:var(--lxwav)!important}'
  + '.mu-av[data-lxwav]{background-image:var(--lxwav)!important}';
const PHONE_RULE = '/* The phone header disc, keyed on an attribute only the script above sets -- see the note there. */\n'
  + '.lx-mav[data-lxwav]::before,.avatar-sm[data-lxwav]::before{background-image:var(--lxwav)!important}.mu-av[data-lxwav]{background-image:var(--lxwav)!important}';
// Collapses the duplicate the first version left behind. The duplicate carries the gate's COMMENT
// as well as its rule, and anchoring on the rule alone matched nothing -- the comment sits between
// the two copies, so the search string has to span it.
const GATE_BLOCK = '/* Hidden until this script has decided what the mark should be -- see _xrplwalletlogo.js.\n'
  + '   Gated on OUR work being done, not on "the chain is decided": paint() lifts it on both of its\n'
  + '   paths, so it clears whether a wallet logo was found or the chain mark stood in. A gate keyed\n'
  + '   on the earlier event is what let the Aptos flash through for months. */\n'
  + GATE_RULE;
const DUP = PHONE_RULE + '\n' + GATE_BLOCK;

let files = 0, pages = 0, already = 0, cssPages = 0, guarded = 0, logos = 0, mobiles = 0, dedup = 0, resel = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    let h = json[k];
    if (typeof h !== 'string') continue;
    if (h.indexOf('lx-walletlogo') < 0) continue;
    let touched = false;

    if (h.indexOf(OLD_PAINT) >= 0) {
      h = h.split(OLD_PAINT).join(NEW_PAINT);
      pages++; touched = true;
    } else if (h.indexOf('function lxPaint()') >= 0) {
      already++;
    }

    // Each of the three remaining edits is independent and keyed on text only it produces, so the
    // order of the four does not matter and any one of them can be the only thing a run does.
    if (h.indexOf(OLD_GUARD) >= 0) { h = h.split(OLD_GUARD).join(NEW_GUARD); guarded++; touched = true; }
    // The phone disc. Guarded on the function NAME, which only this edit introduces -- not on a
    // bare class name that a sibling edit also writes, which is the mistake that silently skipped
    // the stylesheet on all 128 pages earlier today.
    if (h.indexOf('function lxPaintMobile') < 0 && h.indexOf(OLD_MOB) >= 0) {
      h = h.split(OLD_MOB).join(NEW_MOB).split(OLD_MOBCALL).join(NEW_MOBCALL);
      mobiles++; touched = true;
    }
    // THE MARK IS A PSEUDO-ELEMENT, not the disc itself. .avatar-sm.lx-mav is a flex row whose
    // ::before carries the image and whose ::after carries the address, so a rule on the element set
    // a background nothing could see -- the attribute and the variable were both right and
    // background-image still computed to none. Upgrades containers that took the first selector.
    if (h.indexOf(OLD_SEL) >= 0) { h = h.split(OLD_SEL).join(PHONE_SEL); resel++; touched = true; }
    if (h.indexOf(DUP) >= 0) { h = h.split(DUP).join(PHONE_RULE); dedup++; touched = true; }
    if (h.indexOf('.lx-mav[data-lxwav]') < 0 && h.indexOf(GATE_RULE) >= 0) {
      h = h.split(GATE_RULE).join(GATE_RULE + '\n' + PHONE_RULE); touched = true;
    }
    if (h.indexOf(OLD_LOGO) >= 0) { h = h.split(OLD_LOGO).join(NEW_LOGO); logos++; touched = true; }

    // The gate is counted separately: a page could in principle carry one block and not the other,
    // and silently half-patching is how the chip ends up hidden with nothing to reveal it.
    //
    // The marker is the SELECTOR, not the bare class name. A bare "lx-wlready" test matched the
    // classList.add() string the edit above had just written into the same page, so the gate was
    // skipped on all 128 of them while the run reported success -- a marker has to be unique to the
    // edit it guards, not merely present somewhere in the file.
    if (h.indexOf('html:not(.lx-wlready)') < 0 && h.indexOf(OLD_CSS) >= 0) {
      h = h.split(OLD_CSS).join(NEW_CSS);
      cssPages++; touched = true;
    }

    if (touched) json[k] = h;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

// Per-edit counters, not one total. A zero beside a non-zero is the only thing that surfaced the
// guard bug that skipped the stylesheet on all 128 pages while the run still read like a success.
console.log('xrpl wallet logo: writer ' + pages + ', wallet-art guard ' + guarded + ', id fallback '
  + logos + ', gate ' + cssPages + ', phone disc ' + mobiles + ', de-duplicated ' + dedup + ', selector ' + resel + ' page key(s) across ' + files + ' container(s)'
  + (already ? ('; ' + already + ' writer already patched') : ''));
if (!files) { console.error('  ! no container was read'); process.exit(1); }
if (files && !pages && !already) { console.error('  ! nothing matched — the inherited script has changed shape'); process.exit(1); }
