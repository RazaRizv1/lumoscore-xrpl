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
// EVERY CHAIN THE COMBINED SITE SERVES, not just the two this fork was written for. near and arc
// have no registry entry on either side; their marks ship as ordinary bridge-network artwork at the
// root of the combined site, so they are referenced by path. Mirrors the table in Stellar's
// _tools/_walletlogo.js, which is where the reasoning lives.
LOGO.hedera = 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzIgMzIiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0xMSA5djE0TTIxIDl2MTRNMTAgMTQuNWgxMk0xMCAxNy41aDEyIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMi40IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=';
LOGO.near = '/assets/networks/near.png';
LOGO.arc = '/assets/networks/arc.jpg';

// ---- the script edit -------------------------------------------------------------------------
// paint() becomes a wrapper so ready() runs on EVERY path, including one that throws: the gate is a
// stylesheet rule and does not care whether this script survived, so a swallowed error would hide
// the mark permanently rather than for a frame. Same reason for the 2s failsafe -- ready is a
// hoisted declaration, so calling it from the top of the IIFE is legal and happens before anything
// that could fail. No regex literals below: this is plain string surgery on inherited text.
const OLD_PAINT = 'function paint(){\n    try{ nameIt(); }catch(_){}\n    var url=logo(); if(!url)return;';
const NEW_PAINT = [
  'var LXCHLOGO=' + JSON.stringify(LOGO) + ';',
  // The wallet's own chain, read from lumos.network and from the address SHAPE when that is not a
  // chain we know.
  //
  // A FIRST LETTER IS NOT AN ADDRESS SHAPE. This used to be `if(a.charAt(0)==="r")return "xrpl"`
  // with no length test, so RAZA's NEAR account **razarizv1.near** was read as an XRP Ledger address
  // and the chip painted the XRP mark (2026-11-14). Stellar's _walletlogo.js carried the identical
  // bug; both now use the same tests _wrongchain.js uses as its backstop, so the chip and the
  // view-only notice cannot disagree about which chain the wallet is on.
  //
  // Known-chain test is membership of LXCHLOGO rather than a hardcoded pair: a chain is only named
  // here if there is a mark to paint for it, and the legacy lumos.network value "mainnet" falls
  // through to the shapes instead of being trusted. No regex: this is plain string surgery on
  // inherited text and a backslash would not survive.
  'function lxHexOnly(s){',
  '  for(var hi=0;hi<s.length;hi++){ if("0123456789abcdef".indexOf(s.charAt(hi))<0)return false; }',
  '  return true;',
  '}',
  'function lxWchain(){',
  '  var n="",a="";',
  '  try{ n=(localStorage.getItem("lumos.network")||"").toLowerCase();',
  '       a=localStorage.getItem("lumos.address")||""; }catch(_){}',
  '  if(n&&LXCHLOGO[n])return n;',
  '  var l=String(a).toLowerCase();',
  '  if(a.charAt(0)==="G"&&a.length===56)return "stellar";',
  '  if(a.charAt(0)==="r"&&a.length>=25&&a.length<=35)return "xrpl";',
  '  if(l.indexOf("0.0.")===0)return "hedera";',
  '  if(l.length>5&&(l.slice(-5)===".near"||l.slice(-3)===".tg"))return "near";',
  '  if(l.length===64&&lxHexOnly(l))return "near";',
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
// ---- upgrading a container patched while this file still knew only two chains -------------------
// RAZA 2026-11-14, connected as razarizv1.near: "when i view stellar or xrpl pages, on top right,
// instead of showing the same logo as its showing on dashboard, it starts showing XRPL logo."
//
// Two separate faults, and every container is already patched, so OLD_PAINT and OLD_LOGO no longer
// match and a plain re-run reports "128 writer already patched" while changing nothing. Both
// migrations below are keyed on text only the FIRST version produced, and both introduce a name
// (lxHexOnly, LXFORKW) that makes a second run a no-op.
//
//   1. lxWchain tested `a.charAt(0)==="r"` with NO length test, so a NEAR account id beginning with
//      r -- razarizv1.near -- resolved to "xrpl" and the chip painted the XRP mark. It never looked
//      at the page, which is why a Stellar page showed it too. Replaced with the same shapes
//      _wrongchain.js uses as its backstop, so the chip and the view-only notice cannot disagree.
//      The known-chain test becomes membership of LXCHLOGO, so a chain is named only when there is
//      a mark for it, and the legacy lumos.network value "mainnet" falls through to the shapes.
//   2. logo() knew only the wallets whose artwork ships in THIS fork, so a NEAR wallet resolved to
//      nothing and fell back to a chain mark. The five NEAR wallets ship at the root of the
//      combined site; LXFORKW adds them, keyed as logo() normalises a display name.
//
// The LXCHLOGO line is replaced whole, which both widens the table and gives lxHexOnly somewhere to
// live -- it is declared on the same emitted statement, so no second anchor is needed.
const OLD_CHLOGO = 'var LXCHLOGO=' + JSON.stringify({ stellar: LOGO.stellar, xrpl: LOGO.xrpl }) + ';';
const NEW_CHLOGO = 'var LXCHLOGO=' + JSON.stringify(LOGO) + ';'
  + 'function lxHexOnly(s){for(var hi=0;hi<s.length;hi++){'
  + 'if("0123456789abcdef".indexOf(s.charAt(hi))<0)return false;}return true;}';

// One emitted statement per anchor, no leading indentation — the lesson recorded on OLD_GUARD above.
const OLD_WCHAIN = [
  ['if(n==="xrpl"||n==="stellar")return n;', 'if(n&&LXCHLOGO[n])return n;'],
  ['if(a.charAt(0)==="r")return "xrpl";',
    'if(a.charAt(0)==="r"&&a.length>=25&&a.length<=35)return "xrpl";'],
  ['if(a.charAt(0)==="G")return "stellar";',
    'if(a.charAt(0)==="G"&&a.length===56)return "stellar";'
    + 'var lxl=String(a).toLowerCase();'
    + 'if(lxl.indexOf("0.0.")===0)return "hedera";'
    + 'if(lxl.length>5&&(lxl.slice(-5)===".near"||lxl.slice(-3)===".tg"))return "near";'
    + 'if(lxl.length===64&&lxHexOnly(lxl))return "near";'],
];

const OLD_FORKW = 'if(MAP[id])return MAP[id];';
const NEW_FORKW = 'var LXFORKW={"hotwallet":"/assets/wallets/near/hot-wallet.png",'
  + '"meteorwallet":"/assets/wallets/near/meteor-wallet.svg",'
  + '"nearmobile":"/assets/wallets/near/near-mobile.webp",'
  + '"mynearwallet":"/assets/wallets/near/mynearwallet.png",'
  + '"intearwallet":"/assets/wallets/near/intear-wallet.svg"};'
  + 'if(LXFORKW[id])return LXFORKW[id];'
  + 'if(MAP[id])return MAP[id];';

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
  // THE FORKS' WALLETS TOO. The chip is read on an XRPL page by someone connected on another chain,
  // and it should name the wallet they are actually holding keys in rather than falling back to a
  // chain mark. NEAR's five ship at /assets/wallets/near/* at the ROOT of the combined site, so an
  // XRPL page can reference them directly. Keyed the way logo() normalises lumos.wallet, which holds
  // a DISPLAY NAME: "HOT Wallet" lowercases and loses its space to become "hotwallet".
  //
  // Identical table to NEAR's own _nearwalletlogo.js and to Stellar's _walletlogo.js, so one wallet
  // cannot show different artwork on /dashboard and on /trade/xrpl -- which is the whole complaint.
  // Checked BEFORE MAP so a short inherited key can never shadow one of these by prefix.
  'var LXFORKW={"hotwallet":"/assets/wallets/near/hot-wallet.png",'
    + '"meteorwallet":"/assets/wallets/near/meteor-wallet.svg",'
    + '"nearmobile":"/assets/wallets/near/near-mobile.webp",'
    + '"mynearwallet":"/assets/wallets/near/mynearwallet.png",'
    + '"intearwallet":"/assets/wallets/near/intear-wallet.svg"};',
  'if(LXFORKW[id])return LXFORKW[id];',
  'if(MAP[id])return MAP[id];',
  // Longest key first, so "gem" never shadows a longer id that also starts with it. Keys of 1-2
  // characters are excluded: they would match almost anything.
  'var lxk=Object.keys(MAP).sort(function(a,b){return b.length-a.length;});',
  'for(var lxi=0;lxi<lxk.length;lxi++){',
  '  if(lxk[lxi].length>2&&id.indexOf(lxk[lxi])===0)return MAP[lxk[lxi]];',
  '}',
  'return "";',
].join('\n    ');

// ---- the missing Joey key ----------------------------------------------------------------------
// RAZA 2026-10-27, connected on his phone: "its supposed to show joey logo in header and in menu
// list like it does for xaman, instead of showing XRPL logo".
//
// It was not the chip code. logo() looks the wallet up in MAP and, finding nothing, deliberately
// falls back to the CHAIN mark -- which on an XRPL page is the XRP symbol. So a wallet missing from
// MAP does not render blank, it renders as the network, and the bug reads like a chain bug.
//
// MAP lives in the inherited container and already carries gem, crossmark, hashpack and kabila --
// none of them Stellar wallets. It is the platform's wallet-art registry, not Stellar's. The
// correct home for "joey" is therefore that same literal; we add it HERE rather than in Stellar's
// source because this fork carries a FROZEN copy of that build ([[xrpl-inherits-a-frozen-stellar-
// build]]), so editing Stellar would land only after a re-copy that drags in every other session's
// work. When Stellar next rebuilds, the key should be added there and this edit becomes a no-op.
//
// Anchored on the neighbouring pair rather than on "joey" alone, and self-gating: once applied,
// hashpack is no longer followed by kabila, so OLD_MAP cannot match a second time.
const OLD_MAP = '"hashpack":"/assets/wallets/hashpack.png","kabila"';
const NEW_MAP = '"hashpack":"/assets/wallets/hashpack.png",'
  + '"joey":"/assets/wallets/joey.png","kabila"';

// ---- the stale Rabet artwork -------------------------------------------------------------------
// RAZA 2026-11-14, connected with Rabet on Stellar: "when i visit xrpl network pages ... the rabet
// logo changes to a different logo (not the one that we're using), on that page. I mean, it
// shouldn't change at all."
//
// It is not a chain bug and nothing switches the logo. The chip renders a DIFFERENT FILE here,
// because this fork's inherited container predates Stellar's 2026-09-20 Rabet work and carries that
// build's three answers unchanged. Measured on production, same wallet, same session:
//
//                 Stellar (/dashboard)        XRPL (/trade/xrpl)
//   file          /assets/wallets/rabet.png   /assets/wallets/rabet.jpg   <- 6,574B white-tile source
//   ring          none (BARE)                 drawn (no BARE in this copy)
//   zoom          106%                        141%                        <- the pre-fix formula
//
// Both files are on disk; Stellar's _walletlogo.js picks between them with a format RANK (alpha
// beats no alpha) that this frozen copy was taken before. So the jpg is not a leftover to delete --
// it is the keyed-out png's source, and Stellar still wants it present. Only the MAP entry is wrong.
//
// The 141/160/122 zooms are the SAME staleness: that set came from the first pass's 100/inkFraction,
// which scaled a mark's ink to touch the tile edges with no margin left. Stellar re-measured to
// 75/inkPercent on 2026-09-20 -- 106 and 120, with albedo dropped because at 82% it is already
// above the target and takes plain cover. A mark cannot be right on one chain and wrong on the
// other, so all three move together rather than only the one RAZA happened to be looking at.
//
// WHY HERE AND NOT IN STELLAR. Same reason as every other edit in this file: the container is a
// frozen copy, so fixing Stellar's source reaches these pages only through `rebuild.js --base`,
// which re-imports every other session's work in the same motion ([[xrpl-inherits-a-frozen-
// stellar-build]]).
//
// All of these are self-gating -- each anchor is text that CEASES TO EXIST once applied, so a second
// run finds nothing ([[lumoscore-transform-idempotence]]). The artwork itself is handled by
// OLD_RABET_PATH further down, which covers every spelling of the file name in one edit.
const OLD_ZOOM = 'var ZOOM={rabet:141,ready:160,albedo:122};';
// BARE rides in on the same line: the marks whose artwork has no ground of its own, which therefore
// must not be given a ring. Rabet is the only one, and is the whole reason the png exists.
const NEW_ZOOM = 'var ZOOM={rabet:106,ready:120};var BARE={rabet:1};';

// ...and the place that reads it. Copied from Stellar's _walletlogo.js rather than rewritten, so
// the two cannot drift: walletId() is hoisted into _w because BARE needs the same answer ZOOM does,
// and calling it twice invites them to disagree. The `else remove` branch matters -- without it a
// chip that once showed Rabet keeps the bare class after switching to a wallet that needs its ring.
const OLD_BAREAPPLY = 'var _z=ZOOM[walletId()];';
const NEW_BAREAPPLY = 'var _w=walletId(), _z=ZOOM[_w];';
const OLD_BARETAIL = '      else e.style.removeProperty("background-size");';
const NEW_BARETAIL = '      else e.style.removeProperty("background-size");\n'
  + '      if(BARE[_w])e.classList.add("lx-wl-bare"); else e.classList.remove("lx-wl-bare");';

// THE SAME WALLET, A SECOND SURFACE. The chip is not the only place Rabet is drawn: the account
// page's wallet list renders its own <img class="lx-wimg">, from a map that lives in a different
// inherited layer and was copied at the same stale moment. Three page keys carry it (account,
// account-dark, account-mobile), and the first run of the edits above left the jpg standing on all
// three -- caught only because the verification counted stray ".jpg" rather than trusting that one
// map was the map. I diffed the whole icon table against Stellar's before touching it: 23 wallets,
// and rabet is the ONLY entry that differs, so this stays a one-string fix and does not quietly
// re-import a table.
//
// No crop or ring edit is needed here: .lx-wimg is uniform object-fit:cover with no per-wallet rule
// (checked in Stellar's built account page), so the file name is the whole of the difference.
//
// IT IS WRITTEN BOTH WAYS, AND THE FIRST VERSION OF THIS EDIT ONLY SAW ONE OF THEM. Anchoring on
// `src="/assets/wallets/rabet.jpg"` matched 3 page keys and reported success; a second sweep that
// counted OCCURRENCES rather than pages found 125. The other 122 carry the path RELATIVE --
// `src="assets/wallets/rabet.jpg"`, no leading slash -- which extract_site rewrites to absolute at
// build time, so the two forms are indistinguishable in dist/ and the shortfall is invisible there.
// That is the whole reason the verification counts occurrences: a per-page boolean said 3 of 3.
//
// So the anchor is the PATH FRAGMENT both forms share, with no leading slash and no `src=`. It also
// covers the chip's MAP entry above, which is why that edit is gone -- one string, every spelling,
// rather than one constant per place someone wrote it. Self-gating: the jpg is gone once applied.
const OLD_RABET_PATH = 'assets/wallets/rabet.jpg';
const NEW_RABET_PATH = 'assets/wallets/rabet.png';

// The class needs a rule, and this copy of the stylesheet has none -- the ring is drawn by the
// .lx-haswl rule directly below, so the class alone would change nothing and the ring would stay.
const OLD_RING = '.mu-av.lx-haswl,.lx-tw-av.lx-haswl{box-shadow:inset 0 0 0 1px rgba(127,127,140,.30)}';
const NEW_RING = OLD_RING + '\n'
  + '/* ...but a mark with a transparent ground has no tile for the ring to edge, so it would draw an\n'
  + '   empty box around the artwork. Those carry .lx-wl-bare instead -- see _xrplwalletlogo.js. */\n'
  + '.mu-av.lx-wl-bare,.lx-tw-av.lx-wl-bare{box-shadow:none!important}';
// THE MARKER IS THE SELECTOR, not the bare class name -- the script edit above writes
// `classList.add("lx-wl-bare")` into this same page key, so a test for "lx-wl-bare" would match its
// own sibling's work and skip the stylesheet on every page while the run still read as a success.
// That is the exact failure the gate edit below documents; it is not hypothetical here.
const BARE_MARK = '.mu-av.lx-wl-bare';

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

let files = 0, pages = 0, already = 0, cssPages = 0, guarded = 0, logos = 0, mobiles = 0, dedup = 0, resel = 0, joeys = 0, rabets = 0, bares = 0, chains = 0, forkw = 0;
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
    // The five-chain migrations. Guarded on names only they introduce, so a second run is a no-op
    // and a container that somehow took one but not the other still gets the missing half.
    if (h.indexOf('lxHexOnly') < 0 && h.indexOf(OLD_CHLOGO) >= 0) {
      h = h.split(OLD_CHLOGO).join(NEW_CHLOGO);
      for (const [from, to] of OLD_WCHAIN) h = h.split(from).join(to);
      chains++; touched = true;
    }
    if (h.indexOf('LXFORKW') < 0 && h.indexOf(OLD_FORKW) >= 0) {
      h = h.split(OLD_FORKW).join(NEW_FORKW); forkw++; touched = true;
    }
    if (h.indexOf('"joey":"/assets/wallets/joey.png"') < 0 && h.indexOf(OLD_MAP) >= 0) {
      h = h.split(OLD_MAP).join(NEW_MAP); joeys++; touched = true;
    }
    // Rabet's artwork, its crop and its ring. Counted as one edit because they are one regression --
    // a page with the png at 141% inside a ring is not half-fixed, it is differently broken -- but
    // each anchor is tested on its own so a container that drifted on one of them is not skipped
    // for the other two.
    if (h.indexOf(OLD_RABET_PATH) >= 0) {
      // Counted in OCCURRENCES, not pages -- see the note on OLD_RABET_PATH. A page can hold the
      // chip's map entry and the account list's img, and a per-page tally hides the one it misses.
      rabets += h.split(OLD_RABET_PATH).length - 1;
      h = h.split(OLD_RABET_PATH).join(NEW_RABET_PATH);
      touched = true;
    }
    if (h.indexOf(OLD_ZOOM) >= 0) { h = h.split(OLD_ZOOM).join(NEW_ZOOM); touched = true; }
    if (h.indexOf(OLD_BAREAPPLY) >= 0) {
      h = h.split(OLD_BAREAPPLY).join(NEW_BAREAPPLY).split(OLD_BARETAIL).join(NEW_BARETAIL);
      touched = true;
    }
    if (h.indexOf(BARE_MARK) < 0 && h.indexOf(OLD_RING) >= 0) {
      h = h.split(OLD_RING).join(NEW_RING); bares++; touched = true;
    }

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
  + logos + ', gate ' + cssPages + ', phone disc ' + mobiles + ', de-duplicated ' + dedup + ', selector ' + resel + ', joey key ' + joeys
  + ', no-ring rule ' + bares + ', five-chain resolver ' + chains + ', fork wallets ' + forkw
  + ' page key(s), rabet art ' + rabets + ' occurrence(s), across ' + files + ' container(s)'
  + (already ? ('; ' + already + ' writer already patched') : ''));
if (!files) { console.error('  ! no container was read'); process.exit(1); }
if (files && !pages && !already) { console.error('  ! nothing matched — the inherited script has changed shape'); process.exit(1); }
