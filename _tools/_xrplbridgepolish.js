// Cross-chain step 2 on the XRP Ledger build — RAZA's reference design, ported from Stellar.
//
// WHY THIS FILE EXISTS. The bridge page here was running the PRE-REDESIGN step 2: the wizard's own
// "Source address / Amount / Destination address / You get" boxes, which Stellar replaced on
// 2026-09-19 after four rounds of "too many boxes", "not neat, not symmetrical", and finally a mock.
// RAZA on 2026-09-29: "the step 2 is not following the new design updates that we did on Stellar".
//
// It was never ported because of HOW this fork inherits. rebuild.js copies Stellar's BUILT containers
// as its base, so every Stellar layer that had already run came across for free -- and the base here
// predates the redesign. Everything Stellar shipped before 19 Sep is in this container (the review
// legs, the explorer column, the fee row); everything after it is not. That is a silent cutoff: no
// error, no missing file, just an older design that looks deliberate.
//
// WHAT MAKES THE PORT POSSIBLE is that _bridgepolish.js is almost entirely CSS over the DESIGN'S OWN
// nodes -- .br-io, .br-side, .br-asset, .br-amt, .br-addr-in -- and this container has every one of
// them. Measured before writing a line: br-io 6, br-side 13, br-asset 16, br-amt 21, br-addr-in 5.
//
// WHAT IS DIFFERENT HERE, and it is one thing rather than many:
//
//   STELLAR HAS TWO ENGINES WRITING ONE SET OF NODES. CCTP puts USDC in the destination asset row and
//   LayerZero puts USDT0 over the top, so its polish layer carries a SECOND face
//   (.lx-s2ic2 / .lx-s2nm2 / .lx-s2recv) and swaps which is visible from an attribute on <html>.
//   Here ONE client owns those nodes and writes the delivered asset straight into them. The second
//   face is therefore cut, not ported: an empty element covering a correct one.
//
// The route panel's CARDS are not built here either. This file ships the panel's markup and its
// styles; the cards inside it are rendered by browser/nibridge.js, which is the only thing that knows
// which routes can carry a pair and what each of them quoted. Looks here, routes there.
//
// The CSS below is Stellar's, carried across with the LayerZero-only rules cut rather than rewritten
// -- it encodes a lot of measured fixes (the 220px amount column, the unpinned grid rows, the step's
// own stacking context) and retyping it would have quietly lost them.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const ID = 'lx-xbrpolish';
const SID = 'lx-xbrstep2';
const S2 = '.br-step[data-step="2"] ';
const SRC = S2 + '.br-io > .br-side:first-child ';
const DST = S2 + '.br-io > .br-side:last-child ';


// Stroke icons, drawn once and used as masks so they take the theme's colour rather than carrying their own.
function mask(svg) { return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'; }
const I = {
  link: mask('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>'),
  shield: mask('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'),
  alert: mask('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>'),
  caret: mask('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'),
  arrow: mask('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'),
};

const CSS = '<style id="' + ID + '">'

  // ================= the route panel, from _lzusdt0.js =================================================
  // MEASURED AGAINST THE PANELS IT SITS UNDER, not eyeballed. RAZA 2026-09-17: "this bridge route box looks shit.
  // its not symetrical or neat, neither suits our theme". It was inheriting .br-side's max-width of 640px while
  // .br-io above it is 860px, so the panel sat 220px narrower and 105px to the left of every other box on the step.
  // The card interior now uses the same values the .br-wallet boxes beside it compute to: var(--bg) on var(--border)
  // at 11px radius, 64px minimum, rather than a second set of numbers that merely looked close.
  // BESIDE THE FORM, NOT UNDER IT (RAZA 2026-09-17: "cant you place it on side in a neat way"). The step has 1230px
  // and .br-io caps at 860, so the 370px left over is a real column rather than a squeeze. The pair is centred as a
  // unit, which does shift the form ~185px left of where it sits today -- unavoidable once something stands beside
  // it, and the alternative (form centred, route hanging off the right) is worse.
  //
  // Below 1240px there is no longer room for two, so it falls back to exactly today's stacked layout.
  + '.lx-brwrap{display:grid;grid-template-columns:860px minmax(300px,1fr);justify-content:center;'
  + 'align-items:start;gap:18px;width:100%}'
  + '.lx-brwrap > .br-io{margin-left:0 !important;margin-right:0 !important;min-width:0}'
  + '.lx-brwrap > .lx-brroute{max-width:none !important;margin:0 !important;min-width:0}'
  // One card above the other in a narrow column reads better than two cramped ones side by side. grid-auto-rows:1fr
  // makes the two equal height: their notes differ in length ("you pay its gas" vs "nothing to claim"), so without
  // it one card stood 18px taller than the other and the stack read as lopsided.
  + '.lx-brwrap > .lx-brroute .lx-brr-opts{grid-template-columns:1fr;grid-auto-rows:1fr}'
  + '@media (max-width:1240px){'
  + '.lx-brwrap{display:block}'
  + '.lx-brwrap > .br-io{margin-left:auto !important;margin-right:auto !important}'
  + '.lx-brwrap > .lx-brroute{max-width:860px !important;margin:16px auto 0 !important}'
  + '.lx-brwrap > .lx-brroute .lx-brr-opts{grid-template-columns:1fr 1fr}'
  + '}'
  + '@media (max-width:720px){.lx-brwrap > .lx-brroute .lx-brr-opts{grid-template-columns:1fr}}'
  + '.lx-brroute{display:block !important;max-width:860px !important;margin-left:auto !important;margin-right:auto !important}'
  // paintRoutePanel() sets `hidden` when no destination is chosen, and the rule above overrode it: the old
  // route (wNEAR via NEAR Intents, fee, time) stayed on screen after the destination was cleared (2026-11-19).
  // More specific, so it wins over the !important above.
  + '.lx-brroute[hidden]{display:none !important}'
  + '.lx-brroute .hd{grid-column:auto;grid-row:auto;margin-bottom:12px}'
  // A lone route filled half the row and left the other half empty. :only-child makes it span instead, so the panel
  // is symmetrical whether a destination has one route or two -- no JS, no second layout to keep in step.
  + '.lx-brr-opts{display:grid;grid-template-columns:1fr 1fr;gap:13px;align-items:stretch}'
  + '.lx-brr-opts > .lx-brr:only-child{grid-column:1 / -1}'
  + '@media (max-width:720px){.lx-brr-opts{grid-template-columns:1fr}}'
  + '.lx-brr{text-align:left;width:100%;box-sizing:border-box;display:flex;flex-direction:column;'
  + 'min-height:64px;padding:13px 15px;border-radius:11px;'
  + 'border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;cursor:pointer;'
  + 'transition:border-color .14s ease,background .14s ease}'
  + '.lx-brr:hover{border-color:var(--border-strong,#34343c)}'
  + '.lx-brr[aria-pressed="true"]{border-color:var(--accent,#ea6a2c);background:var(--accent-pale,rgba(234,106,44,.10))}'
  + '.lx-brr[disabled],.lx-brr[data-lxnoquote]{cursor:pointer;opacity:.55}'
  // THE ROUTE IN USE STAYS LEGIBLE EVEN WHEN IT CANNOT PRICE THIS AMOUNT (RAZA 2026-10-04: "the bridge
  // looks unselected"). It IS selected -- orange border, "IN USE" -- but at 55% opacity that reads as
  // greyed out, which is the same complaint as the card unmarking itself, arriving by a different
  // route. Dim the ones that lost; never the one that is still the chosen route.
  + '.lx-brr[disabled][aria-pressed="true"],.lx-brr[data-lxnoquote][aria-pressed="true"]{opacity:1}'
  + '.lx-brr[disabled]:hover{border-color:var(--border)}'
  + '.lx-brr-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}'
  // ON THE SITE'S OWN SCALE (RAZA 2026-09-17: "the next inside bridge route doesn't match our font and font size").
  // Measured rather than guessed: the design's primary text computes to 16.5px/600 Hanken and its secondary to
  // 13.8px/400, because _typescale.js raised everything ~10% -- and injected CSS like this never went through that
  // pass, so every line here was a size or two small against its neighbours. These are now the design's numbers.
  + '.lx-brr-nm{font:600 16.5px/1.2 "Hanken Grotesk",system-ui,sans-serif;letter-spacing:-.1254px;color:var(--text)}'
  + '.lx-brr-as{font:700 12px/1.2 "Hanken Grotesk",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;'
  + 'color:var(--text-soft);white-space:nowrap}'
  // Rows share one baseline grid so the two cards line up with each other, which is what "symmetrical" means here:
  // the label column is fixed and the value column takes the rest, so Arrives sits under Bridge fee in both cards.
  // Capped, not full-bleed. When a destination has only one route the card spans the whole 860px panel, and an
  // uncapped row threw the label to the far left and its value ~800px away at the far right, which reads as two
  // unrelated things rather than a pair. The cap keeps them visually joined at any card width.
  + '.lx-brr-l{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:baseline;max-width:330px;'
  + 'font:400 13.8px/1.5 "Hanken Grotesk",system-ui,sans-serif;letter-spacing:-.1254px;color:var(--text-soft)}'
  + '.lx-brr-l + .lx-brr-l{margin-top:4px}'
  + '.lx-brr-l b{justify-self:end;text-align:right;color:var(--text);'
  + 'font:600 14px/1.5 "JetBrains Mono",monospace;letter-spacing:normal}'
  + '.lx-brr-note{margin-top:auto;padding-top:11px;font:400 12.5px/1.45 "Hanken Grotesk",system-ui,sans-serif;'
  + 'letter-spacing:-.1254px;color:var(--text-muted,#75757f)}'
  // The LayerZero-only destinations stay out of the dropdown until the route can actually carry a transfer. The
  // Sei rule needs the html prefix to outrank the CCTP layer's own .brd-opt[data-net="Sei"]{display:none!important}.
  // THE CARD IS THE DECISION, so it is built to be looked at: a brand mark, the name at a real size, what the
  // route is in one line, and a tag naming why you would pick it.
  + '.lx-brr-top{display:grid !important;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:11px;margin-bottom:13px}'
  + '.lx-brr-mark{width:30px;height:30px;flex:0 0 30px;border-radius:50%;overflow:hidden;display:block}'
  + '.lx-brr-mark svg,.lx-brr-mark img{width:100%;height:100%;display:block;object-fit:contain}'
  + '.lx-brr-hd{display:flex;flex-direction:column;gap:2px;min-width:0}'
  + '.lx-brr-sub{font:400 12px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft);'
  + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.lx-brr-tag{font:700 10px/1 "Hanken Grotesk",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.07em;'
  + 'color:var(--accent,#ea6a2c);background:var(--accent-pale,rgba(234,106,44,.10));'
  + 'border:1px solid var(--accent-soft,rgba(234,106,44,.22));border-radius:999px;padding:5px 9px;white-space:nowrap}'
  + '.lx-brr[aria-pressed="true"] .lx-brr-tag{background:var(--accent,#ea6a2c);color:#fff;border-color:transparent}'
  + '.lx-brr-soon{display:inline-block;margin-top:8px;font:700 10px/1 "Hanken Grotesk",system-ui,sans-serif;'
  + 'text-transform:uppercase;letter-spacing:.06em;color:var(--accent,#ea6a2c);border:1px solid var(--accent-soft,rgba(234,106,44,.34));'
  + 'border-radius:999px;padding:4px 8px}'

  // ================= step 2, from _bridgepolish.js =====================================================

  // ---- the two cards --------------------------------------------------------------------------------------
  + '.lx-brwrap{display:grid !important;grid-template-columns:minmax(0,1.9fr) minmax(290px,1fr) !important;'
  // Flush LEFT, under the heading, as in the mock. Centred, the cards started 60px right of the title and subtitle
  // above them, so the page had two left edges.
  + 'gap:24px !important;align-items:start !important;max-width:1240px;margin:0}'
  + S2 + '.br-io{max-width:none !important;margin:0 !important;background:var(--surface-2);'
  + 'border:1px solid var(--border);border-radius:18px;padding:22px 26px;gap:0;overflow:visible}'

  // ---- each half is a grid; the wrapping rows dissolve into it ----------------------------------------------
  + S2 + '.br-io > .br-side{background:transparent !important;border:0 !important;border-radius:0 !important;'
  // The second column is the amount box's, and it is FIXED: sized by content it took the text input's intrinsic
  // width and grew to ~400px. The mock's box is small and sits at the right edge.
  + 'padding:0 !important;display:grid !important;grid-template-columns:minmax(0,1fr) 220px !important;'
  + 'grid-template-rows:none !important;column-gap:18px !important;row-gap:16px !important;align-items:center !important;'
  + 'max-width:none !important;width:auto !important}'
  + S2 + '.br-io > .br-side > .br-assetrow,' + S2 + '.br-io > .br-side > .br-amtrow{display:contents !important}'
  // What the mock replaced: the section heading, the source wallet chip and the old "You swap / You get" line.
  // Hidden, never removed -- the engines still read and write them.
  + S2 + '.br-io > .br-side > .hd{display:none !important}'
  + SRC + '> .br-wallet{display:none !important}'
  + S2 + '.br-io > .br-side > .br-amtrow > *{display:none !important}'

  // ---- row order is set explicitly, never inherited ---------------------------------------------------------
  // The design pins .br-wallet to grid-row:2. Left alone, that dropped the address box ABOVE its own "Receiving
  // address" label and above the asset -- the opposite of the mock. Unpinning every item and giving each an order
  // makes the sequence independent of both the DOM order and whatever the design's grid rules say.
  + S2 + '.br-io > .br-side > *,' + S2 + '.br-asset,' + S2 + '.br-amt{grid-row:auto !important}'
  + '.lx-s2net{order:1}'
  + S2 + '.br-asset,' + S2 + '.br-amt{order:2}'
  + '.lx-s2albl{order:3}'
  + DST + '> .br-wallet.brw-in{order:4}'
  + '.lx-s2hint{order:5}'

  // ---- "From [XRP Ledger]" / "To [network v]" -----------------------------------------------------------------
  // The pill sits right after its label (RAZA 2026-09-19: "should be more closed"); no fixed label width, so "To"
  // does not get From's width and a gap of its own.
  + '.lx-s2net{grid-column:1 / -1;display:flex;align-items:center;gap:12px}'
  + '.lx-s2lbl{font:600 16px/1 "Hanken Grotesk",system-ui,sans-serif;color:var(--text)}'
  + '.lx-s2pill{display:inline-flex;align-items:center;gap:10px;height:42px;padding:0 14px 0 12px;border-radius:999px;'
  + 'border:1px solid var(--border);background:var(--surface);color:var(--text);'
  + 'font:600 15px/1 "Hanken Grotesk",system-ui,sans-serif;cursor:default}'
  + 'button.lx-s2pill{cursor:pointer;transition:border-color .15s ease}'
  + 'button.lx-s2pill:hover{border-color:var(--border-strong,#34343c)}'
  + '.lx-s2ic{width:22px;height:22px;border-radius:50%;overflow:hidden;flex:0 0 22px;display:block}'
  + '.lx-s2ic img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.lx-s2cv{width:14px;height:14px;background:currentColor;opacity:.6;-webkit-mask:' + I.caret + ' center/contain no-repeat;mask:' + I.caret + ' center/contain no-repeat}'

  // ---- the asset: logo, ticker, and what it actually is ----------------------------------------------------
  + S2 + '.br-asset{grid-column:1;display:grid !important;grid-template-columns:auto auto auto;'
  + 'grid-template-areas:"ic nm cv" "ic full full";column-gap:12px;row-gap:1px;align-items:center;justify-content:start}'
  // A DISC BEHIND THE MARK (RAZA 2026-10-05: "LUMOS logo is breaking in from section").
  //
  // Nothing was broken: measured on the live chip, the url is right, the image loads, 160x160, 34% of
  // its pixels opaque. What it does not have is a background -- most token logos are a solid coloured
  // circle, so they look like a disc whether or not anything is behind them, and LUMOS is a mark on
  // TRANSPARENCY. With the host transparent too it read as a stray glyph floating on the card. The
  // picker's rows already put the asset on `var(--surface)`; the chip simply never did.
  + S2 + '.br-asset > .br-ic{grid-area:ic;width:44px !important;height:44px !important;min-width:44px !important;'
  // !important, because the chip's icon also carries `.lx-assetic`, an inherited Stellar rule that
  // sets `background:transparent !important` -- so the first version of this landed in the stylesheet
  // and changed nothing on the page, which is the override trap this project keeps walking into.
  // Measured before and after: computed background rgba(0,0,0,0) -> the surface colour.
  + 'background:var(--surface,#15151a) !important;border-radius:50%;overflow:hidden}'
  + S2 + '.br-asset > .nm{grid-area:nm;font:700 18px/1.15 "Hanken Grotesk",system-ui,sans-serif;color:var(--text)}'
  + S2 + '.br-asset > .cv{grid-area:cv}'
  + '.lx-s2full{grid-area:full;font:400 13.5px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)}'

  // ---- source amount: the number sits in a box, "Available to send" to its left ----------------------------
  // Padding is !important on every side: a design rule zeroed padding-right, so the figure ran into the border.
  + SRC + '.br-amt{grid-column:2;position:relative;display:flex !important;flex-direction:column;align-items:flex-end;'
  + 'justify-content:center;box-sizing:border-box;width:220px !important;min-width:0 !important;min-height:0 !important;'
  + 'padding:10px 16px !important;border-radius:12px;'
  + 'border:1px solid var(--border-strong,#34343c);background:var(--surface)}'
  + SRC + '.br-amt:focus-within{border-color:var(--accent,#ea6a2c)}'
  + SRC + '.br-amt .v{width:100%;min-width:0}'
  + SRC + '.br-amt .v,' + SRC + '.br-amt .v input{font:600 24px/1.15 "Hanken Grotesk",system-ui,sans-serif !important;text-align:right}'
  + SRC + '.br-amt .v input{width:100% !important;min-width:0 !important;height:auto !important;padding:0 !important;margin:0 !important;'
  + 'border:0 !important;background:transparent !important;box-shadow:none !important}'
  + SRC + '.br-amt .usd{font:400 13px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft);margin-top:2px}'
  // Anchored to the LEFT of the box rather than placed on the grid, because it lives INSIDE the amount node and
  // must stay there for the engine that writes it. Its right edge is the box's left edge minus 26px -- the same
  // line "You will receive" is set against below, so the two read as one column, as in the mock.
  + SRC + '.lx-balrow{position:absolute !important;right:calc(100% + 26px);top:50%;transform:translateY(-50%);'
  + 'display:flex !important;flex-direction:column;align-items:flex-end;gap:4px;white-space:nowrap;margin:0 !important}'
  + SRC + '.lx-balrow::before{content:"Available to send";font:400 13px/1.2 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)}'
  + SRC + '.lx-balrow .bal{display:flex !important;align-items:center;gap:8px;font:500 15px/1.2 "Hanken Grotesk",system-ui,sans-serif !important;color:var(--text)}'

  // ---- destination amount: "You will receive", in the same column as "Available to send" --------------------
  // It sits in the box column (220px) and is moved left by the box width plus the 26px gap, so its right edge lands
  // on the line the source label and balance end on. A transform moves the drawing, not the grid, so nothing else
  // on the row shifts.
  + DST + '.br-amt{grid-column:2;display:flex !important;flex-direction:column;align-items:flex-end;justify-content:center;'
  + 'transform:translateX(-246px);white-space:nowrap}'
  + DST + '.br-amt::before{content:"You will receive";font:400 13px/1.2 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft);margin-bottom:4px}'
  + DST + '.br-amt .v{font:500 15px/1.2 "Hanken Grotesk",system-ui,sans-serif !important;color:var(--text)}'
  // HIDDEN IN EVERY STATE, including the one with no figure -- which is a reversal, and the reason is
  // worth keeping because it was argued both ways in one day.
  //
  // RAZA asked four times why "You will receive" was empty, so this line was lifted to show the reason
  // underneath the dash ("Minimum 2.004009 XRP"). That answered the question and broke the thing he was
  // actually comparing against: Stellar's column is TWO lines, the label and the figure, and this made
  // it three. Stellar's answer to the same question is the ROUTE CARD -- it prints "Quoting for this
  // pair is not available" there and leaves the figure as a bare dash -- and this build already prints
  // its own reason in the same place, so the extra line was a duplicate that only ever appeared on one
  // of the two chains. Two lines, and the reason lives where Stellar puts it.
  + DST + '.br-amt .usd{display:none !important}'

  // NEAR Intents: the delivered token is the user's pick -- a caret says the face is the control that changes it
  + DST + '.br-asset.lx-s2pick{cursor:pointer}'
  + DST + '.br-asset.lx-s2pick > .nm::after{content:"";display:inline-block;width:14px;height:14px;margin-left:6px;vertical-align:-1px;'
  + 'background:currentColor;opacity:.6;-webkit-mask:' + I.caret + ' center/contain no-repeat;mask:' + I.caret + ' center/contain no-repeat}'
  // AND THE DESIGN'S OWN CARET GOES, or the pill wears two (RAZA 2026-10-02: "In destination side why
  // are there 2 arrows for assets dropdown"). The row is cloned from the source, which brings `.cv`
  // with it — hidden over there, visible here — and the masked caret above is then a second one beside
  // it. Measured: `.nm::after` 14x14 and `.cv` 17px wide, both drawn, side by side.
  //
  // Scoped to `.lx-s2pick` on purpose, the same selector that adds the replacement: a destination row
  // without that class is not a control, gets no `::after`, and must keep `.cv` rather than end up with
  // no caret at all.
  + DST + '.br-asset.lx-s2pick > .cv{display:none !important}'
  // the full list: a search field pinned on top, the rows scrolling beneath it
  // ---- receiving address: a labelled input, with the hint beneath ------------------------------------------
  + '.lx-s2albl{grid-column:1 / -1;font:600 15px/1 "Hanken Grotesk",system-ui,sans-serif;color:var(--text);margin-top:4px}'
  + DST + '> .br-wallet.brw-in{grid-column:1 / -1;display:flex !important;align-items:center;gap:12px;'
  + 'min-height:56px !important;padding:0 8px 0 16px !important;border-radius:14px !important;'
  + 'border:1px solid var(--border-strong,#34343c) !important;background:var(--surface) !important}'
  + DST + '> .br-wallet.brw-in:focus-within{border-color:var(--accent,#ea6a2c) !important}'
  + DST + '> .br-wallet.brw-in > .br-ic{display:none !important}'
  + DST + '> .br-wallet.brw-in::before{content:"";flex:0 0 18px;width:18px;height:18px;background:var(--text-soft);'
  + '-webkit-mask:' + I.link + ' center/contain no-repeat;mask:' + I.link + ' center/contain no-repeat}'
  // 16px, not 15: iOS Safari zooms the page when a focused input is under 16px and never zooms back
  // out, and this is the field someone pastes a RECEIVING ADDRESS into -- the worst place in the
  // product to be dumped into a magnified, sideways-scrolling page. Raised here rather than overridden
  // in _xrplzoomfloor.js because DST makes this selector (0,6,0); the floor's `input.br-addr-in` is
  // (0,1,1) and lost the tie even with !important on both sides. One pixel, and the only one in this
  // declaration that may not be lowered again. Matches _bridgepolish.js in the Stellar repo.
  + DST + '.br-addr-in{flex:1;min-width:0;font:400 16px/1.2 "Hanken Grotesk",system-ui,sans-serif !important}'
  + '.lx-s2hint{grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin-top:-6px;'
  + 'font:400 13px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)}'
  + '.lx-s2hint::before{content:"";flex:0 0 14px;width:14px;height:14px;background:currentColor;'
  + '-webkit-mask:' + I.shield + ' center/contain no-repeat;mask:' + I.shield + ' center/contain no-repeat}'

  // ---- the divider, swap control on it ----------------------------------------------------------------------
  // THE HAIRLINE IS A PSEUDO-ELEMENT, AND THAT IS LOAD-BEARING. Painting it as .br-swapmid's own background made
  // the logo healer (the script that repaints any span/div whose text is 1-5 characters as a token badge) read the
  // container as an icon: its looksLikeIcon() returns true for ANY computed background colour, and the container's
  // only text is the button's single "⇄". So it stamped data-logo="APT" on it, set textContent='' -- and the swap
  // button vanished from the DOM. A ::before is invisible to getComputedStyle(el), so the container stays plain.
  + S2 + '.br-swapmid{position:relative !important;display:flex !important;align-items:center;justify-content:center;'
  + 'height:1px !important;margin:28px 0 !important;padding:0 !important;background:transparent !important;overflow:visible !important}'
  + S2 + '.br-swapmid::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--border)}'
  // Round and outlined in the accent, as in the mock, on the card's own colour so the hairline stops at its edge.
  + S2 + '.br-swapmid > *{position:relative;z-index:1;width:46px !important;height:46px !important;min-width:46px !important;'
  + 'border-radius:50% !important;background:var(--surface-2) !important;border:1px solid var(--accent,#ea6a2c) !important;'
  + 'color:var(--accent,#ea6a2c) !important;box-shadow:none !important;padding:0 !important}'

  // ---- the asset chip's hit area ----------------------------------------------------------------------------
  // The chip opens the asset dropdown, and it is a grid ITEM that its parent stretches: measured on the bridge at
  // tablet width its visible content (logo, code, caret) ends 128px in while the box runs 664px, so 536px of
  // apparently empty row still opened the menu -- "wherever i click in from box, it opens up the asset dropdown"
  // (RAZA 2026-09-21). Desktop had the same dead space, ~230px of it. A control's hit area should be the control:
  // hug the content and stop stretching. Nothing visible moves, because the pill's own background is drawn by the
  // chip's children, not by the stretched box.
  + S2 + '.br-asset{justify-self:start !important;align-self:center !important;width:max-content !important;'
  + 'max-width:100% !important;margin-right:auto !important}'

  // ---- the error banner -------------------------------------------------------------------------------------
  // Width and offset repeat the wrapper grid's arithmetic (max 1240px, columns 1.9fr/1fr, 24px gap) so the banner
  // sits under the LEFT card exactly, as in the mock, instead of running the full width under both. It is outside
  // the grid on purpose: the engines write to .br-errslot by querying the step, and moving it into the grid would
  // be moving a node they own.
  + S2 + '.br-errslot:not(:empty){display:flex !important;align-items:flex-start;gap:14px;max-width:none !important;'
  + 'box-sizing:border-box;width:calc((min(100%,1240px) - 24px) * 1.9 / 2.9) !important;'
  + 'margin:18px auto 0 0 !important;'
  + 'padding:16px 20px !important;border-radius:14px;justify-content:flex-start !important;'
  + 'text-align:left !important;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.35);'
  + 'font:500 14px/1.45 "Hanken Grotesk",system-ui,sans-serif !important;color:#f87171 !important}'
  + S2 + '.br-errslot:not(:empty)::before{content:"";flex:0 0 22px;width:22px;height:22px;margin-top:1px;background:currentColor;'
  + '-webkit-mask:' + I.alert + ' center/contain no-repeat;mask:' + I.alert + ' center/contain no-repeat}'

  // ---- "Review transfer ->" ---------------------------------------------------------------------------------
  // The row spans the LEFT card, Back on its left edge and Review on its right (RAZA 2026-09-19), using the same
  // width arithmetic as the error banner above it so all three share edges.
  + S2 + '.br-actions{display:flex !important;justify-content:space-between !important;align-items:center;box-sizing:border-box;'
  + 'width:calc((min(100%,1240px) - 24px) * 1.9 / 2.9) !important;max-width:none !important;margin-left:0 !important;margin-right:auto !important;'
  + 'padding-left:0 !important;padding-right:0 !important}'
  + S2 + '.br-actions .br-next{display:inline-flex !important;align-items:center;justify-content:center;gap:10px}'
  + S2 + '.br-actions .br-next::after{content:"";width:18px;height:18px;background:currentColor;'
  + '-webkit-mask:' + I.arrow + ' center/contain no-repeat;mask:' + I.arrow + ' center/contain no-repeat}'

  // ---- ROUTE: a card holding the route identities, then the chosen route's figures ------------------------
  + '.lx-brroute{background:var(--surface-2) !important;border:1px solid var(--border) !important;'
  + 'border-radius:18px !important;padding:20px !important;overflow:visible;max-width:none !important;margin:0 !important}'
  + '.lx-brroute > .hd{padding:0 !important;margin:0 0 14px !important;font:700 12.5px/1 "Hanken Grotesk",system-ui,sans-serif !important;'
  + 'letter-spacing:.1em !important;text-transform:uppercase;color:var(--text-soft) !important}'
  // The heading's text lives here rather than in the markup -- see _lzusdt0.js for why a real text node got the
  // whole panel erased by the logo healer.
  + '.lx-brroute > .hd::before{content:"Route"}'
  + '.lx-brr-opts{display:flex !important;flex-direction:column;gap:10px !important;padding:0 !important}'
  + '.lx-brr{background:var(--surface) !important;border:1px solid var(--border) !important;border-radius:14px !important;'
  + 'padding:14px 16px !important;min-height:0 !important;box-shadow:none !important;transform:none !important}'
  + '.lx-brr:hover:not([disabled]){border-color:var(--border-strong,#34343c) !important}'
  // Name and tag on one line, the description under both, as in the mock: the tag belongs to the name, not to the
  // card's far edge. The heading wrapper dissolves so its two lines can sit on the card's own grid.
  + '.lx-brr .lx-brr-top{margin-bottom:0 !important;display:grid !important;grid-template-columns:auto auto minmax(0,1fr) !important;'
  + 'grid-template-areas:"mk nm tg" "mk sb sb";column-gap:12px !important;row-gap:3px;align-items:center}'
  + '.lx-brr .lx-brr-mark{grid-area:mk}'
  + '.lx-brr .lx-brr-hd{display:contents !important}'
  + '.lx-brr .lx-brr-nm{grid-area:nm}'
  + '.lx-brr .lx-brr-sub{grid-area:sb}'
  + '.lx-brr .lx-brr-tag{grid-area:tg;justify-self:start;margin:0 !important}'
  + '.lx-brr .lx-brr-mark{width:40px !important;height:40px !important;flex:0 0 40px !important}'
  + '.lx-brr .lx-brr-nm{font:600 17px/1.2 "Hanken Grotesk",system-ui,sans-serif !important}'
  // Allowed to wrap: in the narrow route column "Tether's omnichain dollar" was ellipsised to "...omnichain dol",
  // which reads as a rendering fault rather than a design choice. Two lines is better than a clipped word.
  + '.lx-brr .lx-brr-sub{font:400 13.5px/1.3 "Hanken Grotesk",system-ui,sans-serif !important;'
  + 'white-space:normal !important;overflow:visible !important;text-overflow:clip !important}'
  // Chosen: the accent edge only. The mock's card is quiet; the earlier wash plus a doubled ring made the choice
  // shout louder than the transfer it belongs to.
  + '.lx-brr[aria-pressed="true"]{border-color:var(--accent,#ea6a2c) !important;'
  + 'background:var(--surface) !important;box-shadow:none !important}'
  + '.lx-brr[disabled],.lx-brr[data-lxnoquote]{opacity:.55 !important}'
  + '.lx-brr[disabled][aria-pressed="true"],.lx-brr[data-lxnoquote][aria-pressed="true"]{opacity:1 !important}'
  + '.lx-brr .lx-brr-soon{margin:10px 0 0 51px !important}'
  + '.lx-brr-stats{margin-top:18px;display:flex;flex-direction:column;gap:15px;padding:4px 4px 0}'
  + '.lx-brr-stats[hidden]{display:none}'
  + '.lx-brs-row{display:grid;grid-template-columns:20px auto minmax(0,1fr);align-items:center;gap:12px;'
  + 'font:400 15px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)}'
  + '.lx-brs-ic{width:19px;height:19px;color:var(--text-soft);display:block}'
  + '.lx-brs-ic svg{width:100%;height:100%;display:block}'
  // Solid glyphs, as in the mock: fill the outlines, and cut the tag's hole and the clock's hands in the card colour.
  + '.lx-brs-ic svg path,.lx-brs-ic svg circle{fill:currentColor}'
  + '.lx-brs-row:nth-child(2) .lx-brs-ic svg circle{fill:var(--surface-2);stroke:none}'
  + '.lx-brs-row:nth-child(3) .lx-brs-ic svg path{fill:none;stroke:var(--surface-2)}'
  + '.lx-brs-k{white-space:nowrap}'
  + '.lx-brs-v{font:600 16px/1.3 "Hanken Grotesk",system-ui,sans-serif;color:var(--text);text-align:right;white-space:normal}'
  // Swap price impact above 1%: amber, the one semantic colour on the card, so a costly swap is noticed.
  + '.lx-brs-warn,.lx-brs-warn .lx-brs-ic,.lx-brs-warn .lx-brs-v{color:#f5a524 !important}'
  + '.lx-brs-note{margin-top:2px;padding-top:14px;border-top:1px solid var(--border);'
  + 'font:400 13px/1.45 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)}'

  // ---- the destination picker's search bar -------------------------------------------------------------------
  // It is sticky at the top of a panel that has ~6.6px of padding, so rows scrolled up THROUGH that band and showed
  // above the search bar ("Arbitrum" peeking over it on RAZA's phone, 2026-09-19). No top padding, no gap.
  + '.brd-menu{padding-top:0 !important}.brd-menu .brd-search{margin-top:0 !important;top:0 !important}'
  // THE OPEN DROPDOWN MUST WIN AGAINST THE CARDS BELOW IT (RAZA 2026-09-20: two transaction icons floating over the
  // network list on a phone). Each .br-step carries a transform for its slide, which traps the menu's z-index INSIDE
  // the step -- so the step as a whole paints at its place in the page, and anything positioned further down (the
  // recent-transaction icons, which are positioned because the network badge sits in their corner) paints over it.
  // Giving the step its own layer restores the obvious order: the wizard, then the history beneath it. Modals are
  // children of <body> with their own far higher layers, so they are unaffected.
  + S2.replace('[data-step="2"] ', '') + '{position:relative;z-index:5}'

  // ---- scan a QR code for the receiving address (phones) ----------------------------------------------------
  + DST + '.lx-scan{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;'
  + 'padding:0;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);cursor:pointer}'
  + DST + '.lx-scan svg{width:19px;height:19px}'
  + DST + '.lx-scan:active{border-color:var(--accent,#ea6a2c);color:var(--accent,#ea6a2c)}'
  + '.lx-qr{position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;align-items:center;justify-content:center}'
  + '.lx-qr video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
  + '.lx-qr-frame{position:relative;width:66vw;max-width:300px;aspect-ratio:1;border:3px solid rgba(255,255,255,.92);border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)}'
  + '.lx-qr-hint{position:absolute;left:16px;right:16px;bottom:15vh;text-align:center;color:#fff;font:600 14px/1.4 "Hanken Grotesk",system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)}'
  + '.lx-qr-x{position:absolute;left:50%;transform:translateX(-50%);bottom:6vh;padding:11px 28px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.5);color:#fff;font:700 14px "Hanken Grotesk",system-ui,sans-serif;cursor:pointer}'
  + '.lx-s2toast{position:fixed;left:16px;right:16px;bottom:96px;z-index:2147483001;padding:12px 14px;border-radius:12px;background:#2a1414;border:1px solid rgba(239,68,68,.45);color:#fca5a5;font:500 13.5px/1.4 "Hanken Grotesk",system-ui,sans-serif;text-align:center}'

  // ---- narrow screens: stack the two cards, and stop anchoring "Available to send" beside the box ----------
  // One column: the banner goes full width with it.
  + '@media (max-width:1080px){.lx-brwrap{grid-template-columns:1fr !important}'
  + S2 + '.br-errslot:not(:empty){width:100% !important;margin-left:0 !important}'
  + S2 + '.br-actions{width:100% !important}}'
  // PHONES: the asset and the amount box cannot share a row. Side by side at 375px the box took 252px and left the
  // asset column ~37px, so the box sat on top of the destination asset logo and name. Stacked, each gets the full width, and
  // "Available to send" moves inside the box under the figure, where it still reads as belonging to it.
  + '@media (max-width:720px){'
  + S2 + '.br-io{padding:18px}'
  + SRC + '.br-asset{grid-column:1 / -1 !important}'
  + SRC + '.br-amt{grid-column:1 / -1 !important;min-width:0;width:100% !important;box-sizing:border-box;padding:12px 18px !important}'
  + DST + '.br-amt{transform:none}'
  + S2 + '.br-io > .br-side{grid-template-columns:minmax(0,1fr) auto !important}'
  + SRC + '.lx-balrow{position:static !important;transform:none;flex-direction:row !important;align-items:center;'
  + 'justify-content:space-between;width:100%;margin-top:12px !important;padding-top:12px;border-top:1px solid var(--border)}'
  + SRC + '.lx-balrow::before{margin-right:auto}'
  // A long balance ("134,341,480.97 LUMOS" + MAX) is wider than the box: it pushed MAX out past the edge (RAZA
  // 2026-09-19). The row may wrap now -- the balance and MAX drop to their own right-aligned line, inside the box.
  + SRC + '.lx-balrow{flex-wrap:wrap !important;row-gap:6px;column-gap:10px;box-sizing:border-box;max-width:100%}'
  + SRC + '.lx-balrow .bal{margin-left:auto;min-width:0;flex-wrap:wrap;justify-content:flex-end}'
  // The figure and its dollar value on ONE line -- figure left, value right -- then "Available to send" beneath.
  // Stacked, the box was three rows tall for two facts (RAZA 2026-09-19: "move 1000 to the left and the $value to the
  // right").
  + SRC + '.br-amt{display:grid !important;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:12px}'
  + SRC + '.br-amt .v{grid-column:1;min-width:0}'
  + SRC + '.br-amt .v,' + SRC + '.br-amt .v input{text-align:left !important}'
  + SRC + '.br-amt .usd{grid-column:2;margin-top:0 !important;white-space:nowrap;text-align:right}'
  + SRC + '.lx-balrow{grid-column:1 / -1}'
  // the label keeps one line; a long value ("~5 seconds to claimable") wraps instead of squeezing it
  + '.lx-brs-row{grid-template-columns:20px auto minmax(0,1fr)}'
  + '.lx-brs-k{white-space:nowrap}.lx-brs-v{white-space:normal;font-size:15px}'
  + '}'
  + '<' + '/style>';

// The panel itself is markup at BUILD time, not script-built: a script-built block escapes every copy
// and SEO pass this repo runs, which is exactly how the "How it works" dialog kept describing Circle
// CCTP long after every visible sentence had been corrected.
//
// THE HEADING IS CSS CONTENT, NOT A TEXT NODE, and that is load-bearing. With real text the panel's
// whole textContent is "Route" -- five characters -- until the first quote arrives, and this site's
// logo healer repaints any 1-5 character span/div with a radius as a token badge. On Stellar it
// stamped data-logo="APT" on the panel and cleared it, taking the cards and the stats with it.
const MARKUP = '<div class="br-side lx-brroute" data-lxroute hidden>'
  + '<div class="hd" aria-label="Route"></div>'
  + '<div class="lx-brr-opts" data-lxroute-opts></div>'
  + '<div class="lx-brr-stats" data-lxroute-stats></div>'
  + '</div>';

const js = fs.readFileSync(__dirname + '/browser/brpolish.js', 'utf8');
if (js.indexOf('</' + 'script') >= 0) {
  console.error('  browser/brpolish.js contains a closing script tag — aborting');
  process.exit(1);
}
const SCRIPT = '<script id="' + SID + '">' + js + '</' + 'script>';

let files = 0, seen = 0, changed = 0, wrapped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const k of Object.keys(json)) {
    if (typeof json[k] !== 'string') continue;
    let h = json[k];
    // GUARDED ON br-steps, the bridge's own step rail, for the reason the bridge client is: it
    // appears on exactly the three bridge page keys, while br-netbox is also on the account pages.
    if (h.indexOf('br-steps') < 0) continue;
    const before = h;
    seen++;

    // ALL THREE INJECTIONS STRIP THEIR OWN PREVIOUS COPY. Stripping only the <script> is how this
    // repo piles up duplicate <style> blocks, and then a stale rule wins on source order.
    h = h.replace(new RegExp('<style id="' + ID + '">[' + B + 's' + B + 'S]*?<' + B + '/style>', 'g'), '');
    h = h.replace(new RegExp('<script id="' + SID + '">[' + B + 's' + B + 'S]*?<' + B + '/script>', 'g'), '');
    h = h.replace(new RegExp('<div class="br-side lx-brroute"[' + B + 's' + B + 'S]*?<' + B + '/div><' + B + '/div>', 'g'), '');
    h = h.split('<div class="lx-brwrap">').join('').split('<!--/lx-brwrap--></div>').join('');

    // The panel goes after the assets block and before the error slot, which is the order the step
    // already reads in: what you are sending, then how it travels, then what is wrong, then the
    // buttons. It is wrapped WITH .br-io so the two can stand side by side.
    const s2 = h.indexOf('<div class="br-step" data-step="2"');
    if (s2 >= 0) {
      const ioAt = h.indexOf('<div class="br-io">', s2);
      const slot = h.indexOf('<div class="br-errslot"', s2);
      if (ioAt > s2 && slot > ioAt) {
        // The CLOSING tag first: inserting the opening one first shifts every index after it.
        h = h.slice(0, slot) + MARKUP + '<!--/lx-brwrap--></div>' + h.slice(slot);
        h = h.slice(0, ioAt) + '<div class="lx-brwrap">' + h.slice(ioAt);
        wrapped++;
      } else if (slot > s2) {
        h = h.slice(0, slot) + MARKUP + h.slice(slot);
        wrapped++;
      }
    }

    // LAST IN THE HEAD so these rules outrank the inherited Stellar bridge stylesheets for the same
    // nodes -- several of those are still in this container and still describe CCTP's layout.
    if (h.indexOf('</head>') >= 0) h = h.replace('</head>', CSS + '</head>');
    const bi = h.lastIndexOf('</' + 'body>');
    if (bi >= 0) h = h.slice(0, bi) + SCRIPT + h.slice(bi);

    if (h !== before) { json[k] = h; changed++; }
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl bridge step 2 (reference design): ' + seen + ' bridge page key(s), ' + changed
  + ' changed, ' + wrapped + ' route panel(s) placed, across ' + files + ' container(s)');
if (!seen) { console.error('  ! no page carried br-steps — nothing was wired'); process.exit(1); }
if (!wrapped) console.error('  ! the route panel found no slot — step 2 will have no Route card');
