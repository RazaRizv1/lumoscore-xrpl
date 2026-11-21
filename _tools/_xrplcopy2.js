// Correct wrong-chain COPY in the static markup, site-wide.
//
// The runtime layers fix the copy on the elements they own, but a lot of the design's prose lives in
// modals, popups and cards that no data layer touches — so it was only discovered by opening things:
// "Launch tokens on the Aptos DEX", "Assets on Aptos" in the search popup, "Initialize a new pool on
// Aptos AMM", "Connected · Aptos" in the wallet menu. A sweep of VISIBLE text misses all of it,
// because none of it is visible until you interact.
//
// WHY A BUILD-TIME PASS IS SAFE HERE, when a blanket find-and-replace over the rendered page would
// not be: live market data never appears in static markup. The XRP Ledger genuinely has a token coded
// XLM whose issuer is named "Stellar Lumens" — both arrive from the API at runtime, so neither can be
// reached from here. Nothing this file touches came from a ledger.
//
// AND WHY THE LIST IS EXPLICIT rather than a regex over every occurrence of "Aptos" or "Stellar":
//
//   * The sign-in network picker legitimately offers Stellar — RAZA asked for Stellar + XRP Ledger
//     as the two networks — so "Stellar" as a NETWORK NAME must survive.
//   * The bridge FAQ deliberately explains that the claim step belongs to Circle's CCTP on the
//     Stellar build; rewriting that sentence would make it nonsense.
//   * Docs and blog posts may discuss other chains on purpose.
//
// So this rewrites named sentences and nothing else. Anything not on the list is left alone, and a
// phrase that stops matching is REPORTED rather than silently skipped — if the design's wording
// changes, the build says so instead of quietly shipping the old chain's name.
//
// Mock NUMBERS ("18 APT", "0.00001 APT") are deliberately not here: those are values, the runtime
// layers overwrite them with real ones, and freezing a different number into the markup would just
// create a second thing to keep in sync.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// from -> to. Longest first so a phrase is never half-rewritten by a shorter one.
const PHRASES = [
  // THE ABOUT PAGE'S "WHAT WE RUN" LIST describes what is in production, and on this build every
  // card in it should describe what THIS site runs. Its Cross-chain card is corrected below; its
  // Trading card still named the other chain's venue -- "against Stellar's own order book and
  // pools" -- beside a Cross-chain card about XRP, which is a list arguing with itself.
  //
  // NOT TOUCHED, deliberately: "live on Stellar mainnet since 1 August 2026", which appears twice on
  // this page. That is a true statement about the company and rewriting it to say the XRP Ledger
  // would be false until launch day. It is RAZA's line to change when XRPL goes live, not a bug.
  ["Swaps and limit orders against Stellar's own order book and pools.",
    'Swaps and limit orders against the XRP Ledger’s own order book and AMM pools.'],

  // THE BLOG STANDFIRST AGAIN, this time as MARKUP. The same sentence exists twice in this build:
  // as a script literal on the blog-POST key (handled in SCRIPT_LITERALS) and as a plain
  // <p class="lx-bp-lede"> on the blog INDEX key. Fixing only the script left the index page --
  // the one a reader actually lands on -- still saying Stellar.
  ['Guides and explainers on trading, pools, bridging and issuing assets on Stellar.',
    'Guides and explainers on trading, pools, bridging and issuing assets on the XRP Ledger.'],

  // THE /mcp HERO EYEBROW, sitting directly above a paragraph that reads "Connect your AI agent to
  // LumosCore on the XRP Ledger". The page named a different chain than its own first sentence, in
  // the largest small-caps line on the screen.
  ['MCP Server for Aptos', 'MCP Server for the XRP Ledger'],

  // A FAQ ANSWER POINTING AT A CONTROL THAT DOES NOT EXIST. "In Wallet, use Add asset with the code
  // and issuer" — there is no Add asset on the Wallet page, and no trust-line control anywhere: the
  // button was removed on 2026-09-15 and the answer was not. Measured on the live page, every
  // visible control is Send / Receive / Swap / Trade / Cancel all.
  //
  // It matters more here than a wrong label usually would. You cannot receive an issued token on
  // this ledger without a trust line, so "how do I add one" is a question people genuinely arrive
  // with — and the answer sent them hunting for a button that is not there. It is also on the
  // LANDING page, which is the most public page on the site and the one search engines weight most.
  //
  // What actually happens: browser/dxaswap.js signs a TrustSet as step 1 of 3 when you swap into a
  // token you do not yet hold, and browser/wallet.js offers removal on an asset row once its balance
  // is zero. Both are real, both are described here, and neither needed building.
  ['In Wallet, use Add asset with the code and issuer, or add it from search. To remove one its balance must be zero, so send or swap the remainder first, and that releases the 0.2 XRP it was holding.',
    'You do not add one by hand. Buying an asset through Trade or Swap opens its trust line for you — it is the first of the signatures that swap asks for, and it reserves 0.2 XRP. To remove one its balance must be zero, so send or swap the remainder first; a Trustline button then appears on that row, and using it releases the 0.2 XRP.'],
  // NAMED AFTER THE BUTTON ON SCREEN. The first version of this fix said "the row then offers
  // Remove" — which is what the control DOES, not what it SAYS. browser/wallet.js labels it
  // "Trustline" with a trash glyph (the title attribute carries the verb). Replacing one wrong
  // instruction with a less wrong one is not the point of this entry.
  ['so send or swap the remainder first; the row then offers Remove, and that releases the 0.2 XRP it was holding.',
    'so send or swap the remainder first; a Trustline button then appears on that row, and using it releases the 0.2 XRP.'],

  ['Only send APT and Aptos-based assets to this address',
    'Only send XRP and XRP Ledger assets to this address'],
  ['Trustlines let you hold non-native assets on Aptos',
    'Trustlines let you hold issued assets on the XRP Ledger'],

  // THE TRUSTLINE COST, on the $LUMOS page's own trustline dialog — the one the "LUMOS Trustline
  // gate" opens. It read "Reserves 0.5 APT from your account": another chain's asset AND another
  // chain's number, in the sentence that tells someone what opening a trust line will cost them.
  //
  // 0.2 XRP is the owner-reserve increment, and a trust line is one owned object. Read off the
  // ledger, not from documentation: server_info reports base 1 / inc 0.2 today, and the wallet layer
  // takes the live value for anything it calculates. Only this piece of static prose states it as a
  // constant — if an amendment ever moves it, this line is what goes stale, and it is the reason the
  // figure appears exactly once rather than being repeated across the site.
  ['Reserves 0.5 APT from your account', 'Reserves 0.2 XRP from your account'],

  // A route label in the same dialog family, naming the pay side as Aptos.
  ['APT → LUMOS (Direct)', 'XRP → LUMOS (Direct)'],

  // The design's baked balance, sitting above a MAX button in a dialog that moves money. Blanked
  // rather than invented, exactly as the wallet's own field-label balances were.
  ['Balance: 25,420.18 APT', 'Balance: —'],
  ['Initialize a new pool on Aptos AMM', 'Initialize a new pool on the XRP Ledger AMM'],
  ['Launch tokens on the Aptos DEX', 'Launch tokens on the XRP Ledger DEX'],
  ['Trade pairs on Aptos DEX', 'Trade pairs on the XRP Ledger DEX'],
  ['Recipient address', 'Recipient address'],                 // untouched; kept as a no-op anchor
  ['Your Aptos address', 'Your XRP Ledger address'],
  ['Assets on Aptos', 'Assets on the XRP Ledger'],
  ['Connected · Aptos', 'Connected · XRP Ledger'],
  // THE NETWORK FEE LINE, on 100 blocks across the site. Only the UNIT is wrong: the XRP Ledger's
  // base fee genuinely is 10 drops, which is 0.00001 XRP, so the figure stands and the asset changes.
  //
  // Most of these sit in dialogs a live layer rewrites before anyone reads them — Send and Swap both
  // do. Create Pool does not, and that is where it was caught: "Network fee ~0.00001 APT" on an
  // otherwise clean XRP Ledger dialog. Fixing the literal covers the one that is read and is a no-op
  // wherever a layer would have overwritten it anyway.
  ['~0.00001 APT', '~0.00001 XRP'],
  // The search box's own example query, in its hint row.
  ['asset:APT', 'asset:XRP'],

  // ---- THE "HOW IT WORKS" DIALOGS ------------------------------------------------------------------
  //
  // Three of them, one per section, each reached from a visible (i) or "How it works?" control, and
  // each explaining the product in another chain's terms. Found by scanning every `id="*modal*"` block
  // in dist for wrong-chain words — these are prose, so no data layer was ever going to repaint them.
  //
  // THE BRIDGE ONE CONTRADICTED ITS OWN PAGE. The page routes through Axelar — its subtitle, its
  // destination list and its title all say so — while this dialog told the reader the transfer goes
  // "via Wormhole and LayerZero". Two different bridge providers named on one screen is worse than
  // either being wrong on its own.
  ['Cross-chain transfers via Wormhole and LayerZero.',
    'Cross-chain transfers via Axelar.'],
  ['Transfers route through Wormhole and LayerZero, so you receive the destination asset directly.',
    'Transfers route through Axelar, so you receive the destination asset directly.'],

  // The Trade dialog, on a page titled "How the XRP Ledger DEX works".
  ['Trade any Aptos-issued asset', 'Trade any XRP Ledger-issued asset'],
  ['swap with APT, or place limit orders', 'swap with XRP, or place limit orders'],
  ['Aptos automatically finds the cheapest route',
    'The XRP Ledger automatically finds the cheapest route'],
  // "Anchors" is Stellar's word for a gateway that issues a redeemable asset; the XRP Ledger calls
  // them issuers. Left as a separate rule from the sentence above so either can match on its own.
  ['across multiple pairs and Anchors', 'across multiple pairs and issuers'],

  // The AMM dialog's worked example, which paired LUMOS with the wrong native asset.
  ['(for example LUMOS and APT)', '(for example LUMOS and XRP)'],
  // THE LAUNCH SCREENS. "Once your token is minted on the Aptos network" on the review step, and
  // "Your token is now live on the Aptos network" on the confirmation — the two moments where
  // someone has just committed real money to issuing an asset and is being told which chain it
  // landed on. Naming the wrong one there is the worst placement of this mistake on the whole site.
  //
  // The "Aptos Coin ($APT)" placeholders on those same pages are NOT here: the launchpad passes the
  // real name and ticker through localStorage and fills them in, so they are template text, not copy.
  ['on the Aptos network', 'on the XRP Ledger'],
  // A row label on the review step's Additional Liquidity block. Only found by putting a draft in
  // localStorage and actually loading the page — it is not in the empty state.
  ['Extra APT', 'Extra XRP'],

  // The wallet FAQ, which appears on the landing page. Claimable payments are a Stellar feature; on
  // this ledger a payment of an asset you do not trust simply fails, and a Check is the nearest
  // thing — a promise of payment the sender writes, which you cash yourself.
  ['What are claimable payments?', 'What are Checks?'],
  ['A payment someone has sent that is waiting for you to accept, used when it cannot be delivered straight away, usually because you do not hold a trustline for that asset yet. Add the trustline and claim it.',
    'A Check is a promise of payment someone writes to you on the ledger, which you cash yourself when '
    + 'you are ready. It is not the same as a payment being held for you: on the XRP Ledger a payment '
    + 'of an asset you have no trust line for simply fails rather than waiting. Add the trust line '
    + 'first, then cash the Check.'],

  // FOUND BY SWEEPING THE FIVE PAGES NOBODY HAD LOOKED AT — bridge, launchpad, rewards, $LUMOS and
  // account. Not one of these is visible on load; every one lives in a dialog or a help panel, which
  // is why looking at the pages found nothing and a markup scan found all of it.

  // Bridge, the "how it works" step. Names the source chain as Aptos on an XRP Ledger bridge.
  ['(Aptos and your destination network)', '(the XRP Ledger and your destination network)'],

  // Launchpad, the additional-liquidity help. The page where someone commits real money to an
  // issuance, telling them to add another chain's asset to the pool.
  // BOTH PHRASINGS, because the phone's copy is not the desktop's: "to THE initial liquidity pool"
  // on desktop and "to YOUR initial liquidity pool" on mobile. Fixing one left the other shipping,
  // which is the same mobile-container trap that has caught this project before — the counts said
  // 2 pages fixed and 1 still matching, and that single leftover was the phone.
  ['Add extra APT to the initial liquidity pool', 'Add extra XRP to the initial liquidity pool'],
  ['Add extra APT to your initial liquidity pool', 'Add extra XRP to your initial liquidity pool'],

  // ---- "EIGHT NETWORKS" — A NUMBER NOTHING ON THIS BUILD SUPPORTS -------------------------------
  //
  // Inherited from the Stellar build, where the bridge was Circle CCTP to eight EVM chains. This
  // fork routes through AXELAR, and the real figure is 14: `/lxapi/xrplbridge` intersects the
  // design's destination dropdown (18 entries) with Axelar's live registry (58 chains) and returns
  // `supportedCount`. Measured 2026-09-11 — Arbitrum, Avalanche, Base, BNB Chain, Ethereum, Hedera,
  // Linea, Mantle, Optimism, Polygon, Scroll, Sei, Solana, Sui. The four in the dropdown that Axelar
  // does not currently reach (Near, Starknet, World Chain, zkSync Era) are excluded, so 14 is also
  // exactly how many destinations a visitor can pick on the bridge page.
  //
  // TO RE-CHECK: `curl https://lumoscore.com/lxapi/xrplbridge | jq .supportedCount`. If Axelar adds
  // those four back this becomes 18, and under-stating is the safe direction to be wrong in.
  //
  // Three sentences, three different wordings, and they are NOT interchangeable:
  //   * the landing/docs-FAQ one is product copy;
  //   * the docs-introduction one has ALREADY been through _xrpldocs, which rewrote CCTP to "the
  //     bridge" and left the ungrammatical "over Circle's the bridge" — matched here as it actually
  //     reads, not as it was authored ([[lumoscore-xrpl-wrong-chain-copy]]);
  //   * the ABOUT page is outside _xrpldocs's `lumoscore-docs*` gate, so it still says both
  //     "Stellar" and "CCTP" — the wrong source chain AND the wrong provider on one line.
  ['bridge USDC to and from eight other chains',
    'bridge USDC to and from 14 other networks'],
  ["Move USDC between the XRP Ledger and eight networks over Circle's the bridge.",
    'Move USDC between the XRP Ledger and 14 networks through Axelar.'],
  ["USDC between Stellar and eight networks over Circle's CCTP.",
    'USDC between the XRP Ledger and 14 networks through Axelar.'],

  // AND NOW THE SAME LINES AGAIN, because the three above were written when this build's bridge was
  // Axelar route-discovery and nothing else. It is three routes to thirty-nine destinations now, and
  // it carries XRP and the interchain tokens -- not USDC, which was Circle's asset on Stellar's CCTP
  // and never what Axelar moves off this ledger. So "USDC ... through Axelar" was a sentence with the
  // wrong asset, the wrong count and only a third of the right provider.
  //
  // The ABOUT page is where this hurt most: its "What we run" list is a statement of what is in
  // production, and it described a product that had been replaced.
  //
  // LONGEST FIRST, as the note at the top of this list says -- "USDC between the XRP Ledger and 14
  // networks through Axelar." is a SUFFIX of the "Move ..." line, and putting the short one first
  // would leave a stranded "Move " in front of the rewritten sentence.
  ['bridge USDC to and from 14 other networks',
    'bridge XRP to and from 39 other networks'],
  ['Move USDC between the XRP Ledger and 14 networks through Axelar.',
    'Move XRP to 39 networks through NEAR Intents, Axelar or THORChain.'],
  ['USDC between the XRP Ledger and 14 networks through Axelar.',
    'XRP to 39 networks through NEAR Intents, Axelar or THORChain.'],

  // ---- AND THE PAGE CONTRADICTED ITSELF ABOUT WHETHER THE BRIDGE WORKS ---------------------------
  //
  // Fixing the NUMBER above left the bigger problem: the general FAQ said you can bridge, in the
  // present tense, while `/lxapi/xrplbridge` returns `transfers: false` and the bridge page itself
  // says "Transfers are not enabled from this page yet."
  //
  // Worse, the contradiction was on ONE PAGE. The landing FAQ's cross-chain section — already
  // corrected by _xrplbridgecopy — answers "How do I bridge assets to or from the XRP Ledger?" with
  // "Not from this page yet", "None today, because no transfer takes place" and "Not while transfers
  // are off". Four questions earlier the same page promised the feature outright.
  //
  // Reworded, not deleted: the bridge page is real and its routes are real, so the honest statement
  // is that it is in development — the same line the cross-chain answers already take. RAZA's
  // standing rule for this whole build is "make it honest and disabled first, like create pool".
  //
  // ORDER IS LOAD-BEARING: these match the text the "eight other chains" rule above PRODUCES, and
  // applyPhrases walks PHRASES in array order, so they must stay below it. On a container that has
  // already been through a previous build the first rule is a no-op and these match directly; on a
  // fresh one the first rule runs and then these do.
  ['You can swap assets, provide liquidity to AMM pools, bridge USDC to and from 14 other networks '
    + 'and issue your own token, all without giving up custody of your funds.',
    'You can swap assets, provide liquidity to AMM pools and issue your own token, all without '
    + 'giving up custody of your funds. A cross-chain bridge to 14 other networks is in development; '
    + 'transfers are not enabled yet.'],
  ['Trading, pools, token issuance and USDC bridging in one place.',
    'Trading, pools and token issuance in one place, with cross-chain bridging in development.'],

  // ---- THE SAME CLAIM, THREE MORE TIMES, ABOVE THE FOLD ----------------------------------------
  //
  // The FAQ rewrite above left the landing page's marketing still listing "bridge" as something the
  // product does today. Three lines, all on the landing page:
  //
  //   1. the products section's sub-head  — "Trade, pool, bridge, deploy, and manage …"
  //   2. the Cross-Chain product card     — "LumosCore integrates the most trusted bridging
  //                                          solution for each chain."
  //   3. the "Everything in one place" card — "Trade, provide liquidity, bridge, launch a token …"
  //
  // (3) was not named in the request; it is included because it is the SAME sentence pattern as (1)
  // on the same screen, and correcting one while leaving the other would read as an oversight.
  //
  // MINIMAL EDITS, NOT REWRITES. In the two capability lists only the word "bridge" comes out — the
  // rhythm, the surrounding claims and the design's voice are untouched. The Cross-Chain card keeps
  // its own opening line ("without memorizing ten different bridges"); only the sentence asserting a
  // live integration is replaced, with the same fact the bridge page and the cross-chain FAQ already
  // state. Nothing is deleted: the card, the section and the link all stay.
  //
  // "One Interface. Multiple chains. Zero tab-switching." is deliberately untouched — LumosCore does
  // span two chains, so that one is positioning rather than a claim about this build.
  ['Trade, pool, bridge, deploy, and manage your entire multichain portfolio from a single interface.',
    'Trade, pool, deploy, and manage your entire multichain portfolio from a single interface.'],
  ['Move assets between networks without memorizing ten different bridges. LumosCore integrates the '
    + 'most trusted bridging solution for each chain.',
    'Move assets between networks without memorizing ten different bridges. Routing runs through '
    + 'Axelar; transfers are not enabled yet.'],
  ['Trade, provide liquidity, bridge, launch a token and manage your portfolio from a single interface.',
    'Trade, provide liquidity, launch a token and manage your portfolio from a single interface.'],

  // THE FOOTER TAGLINE — the last bridging claim, and the most widely published one: it sits in
  // `.ft-brand` on 74 page keys, so it is on essentially every page of the site rather than just the
  // landing page. Same minimal edit as the capability lists above: only the bridging claim comes
  // out. "Multichain … on multiple networks" stays, because LumosCore genuinely runs on two chains —
  // it is the one word describing a feature this build does not have that had to go.
  ['Multichain infrastructure for issuing, trading and bridging assets on multiple networks.',
    'Multichain infrastructure for issuing and trading assets on multiple networks.'],

  // THE MCP FAQ, ON THE SITE ROOT. `_xrpldocs.js` already carries both of these rules and they are
  // correct — but that transform gates on `key.indexOf('lumoscore-docs') !== 0`, so it only ever
  // reached the docs pages. The landing page and the MCP page describe the product with the same two
  // sentences and were never in its scope, which is how the highest-traffic page on the site ended
  // up telling readers the MCP server "exposes Stellar market data".
  //
  // Put here rather than by widening _xrpldocs's gate: that gate is deliberate (docs and blog posts
  // may discuss other chains on purpose) and these two sentences are product copy, which is exactly
  // what this file is for.
  ['exposes Stellar market data', 'exposes XRP Ledger market data'],
  ['about Stellar asset prices', 'about XRP Ledger asset prices'],

  ['Aptos wallet', 'XRP Ledger wallet'],
  ['Aptos DEX', 'XRP Ledger DEX'],
  ['Aptos AMM', 'XRP Ledger AMM'],
  ['on Aptos', 'on the XRP Ledger'],

  // THE MARKET OVERVIEW'S TOTAL LIQUIDITY CAPTION. Stellar reads "Across all Stellar pools"; this
  // build read "Across all pools", with the chain dropped (RAZA 2026-10-06: "Add XRPL"). It is not a
  // wrong-chain string, which is why no earlier sweep caught it — it is a MISSING one, and the only
  // caption in that card not naming its network while the row beneath it says "Liquidity pools on
  // XRP Ledger".
  //
  // Done here rather than in pools.js, where the other two captions are written, because this one is
  // static markup the data layer never touches: setting it at runtime would ship the page with the
  // short caption and rewrite it a moment later, and a one-word flash on a card RAZA reads side by
  // side with Stellar is exactly the class of bug this build keeps hitting. Six occurrences across
  // the amm page keys, all the same caption.
  ['Across all pools', 'Across all XRPL pools'],

  // THE RECEIVE DIALOG'S BAKED ADDRESS, which on this fork is a STELLAR one — a G-address sitting
  // under "Your XRP Ledger address" (the label two blocks up already corrects), with a data-copy
  // carrying a different fabricated address again, an Aptos 0x. 35 desktop + 3 mobile.
  //
  // Parity with the Stellar build, fixed there the same day (RAZA 2026-10-27, "use em-dash
  // placeholders"): a privacy- or honesty-shaped call is platform-wide, and leaving one fork
  // publishing what the other just stopped is how these diverge.
  //
  // NOT user-reachable, and that is checked rather than assumed: opening Receive on /wallet with
  // lx_chain=xrpl showed the real connected r-address in both the text and data-copy, so the layer
  // replaces this element wherever the dialog can actually be opened. Everywhere else the overlay is
  // an orphan with no trigger, which makes this markup read only by a crawler — this file's remit.
  //
  // BARE, NOT TAG-ANCHORED, which is the difference between this file and Stellar's _chaincopy.js and
  // cost a build to learn: rewriteText() below applies these to the TEXT BETWEEN TAGS only — "never
  // attributes, never script or style bodies" — so a '>GA7K…</div>' anchor, which is what the Stellar
  // pair uses and which works there because that file does a plain whole-document replacement, can
  // never match here. Written that way first; it reported no error and changed nothing, exactly the
  // silent no-op this file's own header warns a rule must not be.
  //
  // Safe as a bare string: 56 characters, one value, and it occurs only as this element's text. The
  // data-copy attribute keeps its fabricated 0x for now and rewriteText cannot reach it anyway —
  // blanking an attribute is a behaviour change, not a copy one, and is left with Stellar's.
  ['GA7K5N4M2X9P3R8Q1L6T2V8W4Y7Z3A5B8C2D6E1F4G7H9J2K5N4M2', '—'],
];

// Elements whose ENTIRE text is a bare network name. Handled separately because replacing the bare
// word everywhere would also hit prose the list above already covers, and network-name pills are the
// only place a lone "Aptos" is meant to be a label.
const BARE = ['sp-filter-pill', 'ad-nm', 'net-tag', 'nx-net', 'lxns-name'];

let files = 0, pages = 0, hits = 0;
const per = {};
const unseen = new Set(PHRASES.map(function (p) { return p[0]; }));

// COPY THAT LIVES INSIDE A SCRIPT, and the narrow exception it needs.
//
// The rule below is "never script bodies", and that is the right default: script text is logic and
// ledger data, and a blanket rewrite there is how a real token coded XLM or an issuer genuinely
// named "Stellar Lumens" would get mangled.
//
// But the $LUMOS trustline dialog is written by the design's OWN script:
//     if (sub) sub.textContent = 'Reserves 0.5 APT from your account';
// so fixing the markup achieved nothing — the script puts the Aptos wording back the moment the
// dialog opens, which is why the phrase survived a pass that reported 74 replacements.
//
// Handled as an explicit list of EXACT QUOTED LITERALS rather than by relaxing the rule: each entry
// includes the surrounding quote characters, so it can only ever match a complete string literal
// that the design authored, never a fragment of an identifier or a value read from an API.
const SCRIPT_LITERALS = [
  ["'Reserves 0.5 APT from your account'", "'Reserves 0.2 XRP from your account'"],
  ['"Reserves 0.5 APT from your account"', '"Reserves 0.2 XRP from your account"'],

  // THE /mcp HERO TERMINAL. It is a typewriter animation driven by a `steps` array inside a script,
  // so every copy pass this repo runs stepped straight over it -- and it is the single most watched
  // element on the page, replaying on a loop under a heading that says "on the XRP Ledger":
  //
  //   ✓ Connected to Aptos mainnet
  //   🤖 Swap 500 APT for USDC   ⚡ Calling swap_tool…   from: APT
  //   ✓ Swap complete!  500 APT → 1,247.82 USDC   View on AptosScan
  //
  // `swap_tool` is wrong on its own terms too: the command list further down the same page names the
  // tool `swap`, which is what the server actually exposes. The demo was inventing a tool.
  //
  // The figures are rewritten to an XRP Ledger pair at a plausible rate rather than kept: 500 XRP at
  // today's ~1.49 is about 744 RLUSD, and leaving "1,247.82" would state an exchange rate this page
  // has no business asserting.
  ["'✓ Connected to Aptos mainnet'", "'✓ Connected to XRP Ledger mainnet'"],
  ["'🤖 Swap 500 APT for USDC'", "'🤖 Swap 500 XRP for RLUSD'"],
  ["'⚡ Calling swap_tool…'", "'⚡ Calling swap…'"],
  ["'   from: APT · amount: 500 · to: USDC'", "'   from: XRP · amount: 500 · to: RLUSD'"],
  ["'500 APT → 1,247.82 USDC'", "'500 XRP → 744.10 RLUSD'"],
  ["'View on AptosScan'", "'View on Bithomp'"],

  // THE BLOG'S OWN STANDFIRST, set by script in two places on each of the two blog page keys --
  // once on the empty-state path and once after the grid renders. It is the only sentence on that
  // page that says anything about a chain, and it said Stellar.
  //
  // A SCRIPT LITERAL, not prose: `lede.textContent = "…"`. The markup pass cannot see it, which is
  // why it survived every sweep that fixed the pages around it.
  ['"Guides and explainers on trading, pools, bridging and issuing assets on Stellar."',
    '"Guides and explainers on trading, pools, bridging and issuing assets on the XRP Ledger."'],
];

// [regex with a leading capture group, replacement]. The capture is whatever preceded the match and
// is put back untouched — it exists only to prove the match was not part of a bigger number.
const GUARDED = [
  [/(^|[^0-9.])0\.5 APT/g, '0.2 XRP'],
];

// LITERALS THAT INCLUDE THEIR OWN TAG, because the text alone is too dangerous to match.
//
// The launchpad's amount field carries `<span class="input-suffix">APT</span>` — the UNIT beside a
// box someone types a number into. The text chunk is the three letters "APT", and a phrase rule for
// that would rewrite every APT on the site, including ones inside prose the list above handles
// deliberately. Anchoring to the class turns an unsafe rule into an exact one.
// The launchpad's two placeholders, shared by every rule below that touches them. Kept as constants
// because the same two strings are the target of NINE entries spanning three base generations, and a
// typo in one of them would silently leave one device or one base spelling behind. Identical to
// Stellar's _launchph.js -- the two forms must read the same.
const LAUNCH_NAME = 'placeholder="Your token' + String.fromCharCode(39) + 's name"';
const LAUNCH_TICK = 'placeholder="ASSET"';

const MARKUP_LITERALS = [
  ['class="input-suffix">APT<', 'class="input-suffix">XRP<'],

  // THE SWAP BUTTON IS CALLED "Swap" (RAZA 2026-10-08: "on Stellar we call it Swap, not Place buy
  // order, so fix it on XRPL"). lumoscore.com's Trade-Asset swap pane reads "Swap" on both sides of
  // the trade, and this one read "Place Buy Order" — which also stayed wrong after switching to
  // Sell, since the design ships one button for both.
  //
  // ONLY THE SWAP PANE. The page carries a second `.dxa-trade-cta`, "Place Limit Order", and that
  // one is right: a limit order IS placed, and rests. Matching the full button tag rather than the
  // words alone is what keeps this off it.
  // TWO ENTRIES, BECAUSE MOBILE IS A DIFFERENT CLASS. The phone container calls the same button
  // `mdxa-trade-cta`, so the desktop literal left the mobile page reading "Place Buy Order" — and
  // mobile is UA-served, so nothing on the desktop page shows it.
  ['<button class="dxa-trade-cta">Place Buy Order</button>',
    '<button class="dxa-trade-cta">Swap</button>'],
  ['<button class="mdxa-trade-cta">Place Buy Order</button>',
    '<button class="mdxa-trade-cta">Swap</button>'],

  // THE TRADE PAGE'S SUBHEADING SAID "DEX on Stellar." — on /trade/xrpl, in an <h2>, which is both the
  // first thing a reader sees under the title and a heading a crawler weighs (RAZA 2026-10-07).
  //
  // WHY EVERY COPY SWEEP MISSED IT: the sentence is split across two elements —
  //   <span class="lx-h1">The most advanced</span><span class="lx-h2"><em>DEX</em> on Stellar.</span>
  // so the page contains no text node reading "DEX on Stellar", and a phrase rule for that string
  // matches nothing. Its text nodes are "The most advanced", "DEX", and " on Stellar." — and a rule
  // for the last of those alone would rewrite that fragment anywhere on the site.
  //
  // Anchoring to the <em> turns an unsafe rule into an exact one, which is what this list is for.
  ['<em>DEX</em> on Stellar.', '<em>DEX</em> on the XRP Ledger.'],

  // THE CREATE POOL TRADING FEE (RAZA 2026-10-27, "fix the 0.5% pool fee" -- reported on Stellar,
  // found in both containers: 5 desktop + 3 mobile each, byte-identical rows).
  //
  // THE TEXT ALONE IS THE DANGEROUS KIND, which is why it is here. The row is
  //   <span>Trading fee</span><strong>0.5%</strong>
  // so its only text node is "0.5%" -- and 0.5% is also the swap panes' default SLIPPAGE, which is
  // correct and must not move. A PHRASES entry would have rewritten both. Anchoring the whole row is
  // what makes this exact, the same reason `class="input-suffix">APT<` sits in this list.
  //
  // 0.2%, NOT STELLAR'S 0.3%. On Stellar the pool fee is fixed by the protocol; here the creator
  // chooses it, and browser/createpool.js submits TradingFee 200 and writes (TRADING_FEE/1000)+'%'
  // into this very row at runtime. So 0.2% is not a copy decision -- it is what the ledger is asked
  // for, and the markup now agrees with the transaction.
  //
  // The row still renders display:none (createpool.js: "The row stays hidden because Stellar hides
  // it"). This changes the bytes a crawler reads, nothing a human sees.
  ['<div class="row"><span>Trading fee</span><strong>0.5%</strong></div>',
    '<div class="row"><span>Trading fee</span><strong>0.2%</strong></div>'],

  // THE SEND DIALOG'S RECIPIENT PLACEHOLDER, which ships as Stellar's: "G... or domain.com*username".
  // On this ledger that is an address format that cannot exist, telling the reader to type something
  // invalid -- and the federated `domain.com*username` form is a Stellar protocol feature with no XRPL
  // equivalent at all.
  //
  // browser/write.js ALREADY FIXES THIS, in wireSend(), and has done since it was written. But it
  // fixes it at RUNTIME, so the markup the parser draws is still Stellar's and the reader sees the
  // wrong placeholder until the layer runs -- exactly the flash GUARDRAILS section B forbids (RAZA
  // 2026-10-31, reported together with the XLM fee unit and the "Stellar Wallet" tab title; all three
  // turned out to be the Stellar page being served, but this one is real on the XRPL page too).
  //
  // THE TWO STRINGS MUST AGREE BYTE FOR BYTE with write.js's setAttribute, or fixing the flash just
  // replaces it with a different one: markup paints "r… XRP Ledger address", the layer then writes
  // its own wording, and the swap is visible. Same ellipsis character (U+2026), same spacing.
  // If you change one, change the other.
  //
  // A MARKUP LITERAL, not a PHRASES entry: applyPhrases() walks text chunks and never sees an
  // attribute value, which is why the label beside this field ("XRP Ledger wallet") was already
  // right while the placeholder inside it stayed wrong.
  ['placeholder="G... or domain.com*username"',
    'placeholder="r… XRP Ledger address"'],

  // THE SAME FIELD, SECOND BASE SPELLING. Stellar fixed its own flash on 2026-10-31 (_sendph.js)
  // by rewriting this attribute in the aptos containers to "G... Stellar address", so a base built
  // from that day on carries THAT string and the entry above no longer matches. Without this pair
  // the fork would paint Stellar's wording on a ledger that has no G addresses at all -- the fix
  // above would appear to have been reverted, with nothing in the build complaining.
  //
  // BOTH ARE KEPT because the fork is rebuilt from whatever base is on disk, and the frozen Stellar
  // build it inherits is not re-cut on our schedule; either spelling may be the one it sees. They
  // map to the identical target, so whichever matches gives the same page. Delete neither until a
  // base containing the old string is provably gone.
  ['placeholder="G... Stellar address"',
    'placeholder="r… XRP Ledger address"'],

  // THE LAUNCHPAD'S WORKED EXAMPLE NAMES A TOKEN THAT IS NOT ON THIS LEDGER (RAZA 2026-11-07:
  // "'e.g. Tether' despite Tether not being natively issued on the XRP Ledger"). The first field
  // anybody fills in on /launchpad/xrpl teaches the reader what an XRPL issuance looks like, and it
  // was teaching them an asset that has none here. Ripple USD is issued on this ledger by Ripple,
  // which is as native as an example gets.
  //
  // THE TWO FIELDS ARE ONE EXAMPLE and have to move together: the name box and the ticker box sit
  // side by side in the same row, so "Ripple USD" beside "e.g. USDT" would read as a worse mistake
  // than the one being fixed. The ticker input carries style="text-transform: uppercase" and a `$`
  // prefix span, so "e.g. RLUSD" renders as "$ E.G. RLUSD" -- which is the form RAZA quoted, and the
  // reason the literal here is lower case.
  //
  // DESKTOP ONLY, measured: 2 keys (launch-token and its -light twin), 1 each, and zero in the
  // mobile container. The pair below is the phone's -- it ships "e.g. Solar Flare" / "e.g. SLR", an
  // invented token, so it is not WRONG the way Tether is; it is changed so the same form does not
  // teach two different examples depending on which device opened it.
  //
  // A MARKUP LITERAL rather than a PHRASES entry for the same reason as the send placeholder above:
  // applyPhrases walks text chunks and never sees an attribute value.
  // 2026-11-13: NO WORKED EXAMPLE AT ALL, AND RIPPLE USD IS THE ONE BEING REMOVED. RAZA, of the
  // Stellar twin: "placing usdc in placeholder is not right." The same argument lands harder here --
  // RLUSD is Ripple's own stablecoin, and suggesting it on the form where you MINT YOUR OWN token
  // reads as though you could issue it. The Add-custom-asset modal naming a real asset is correct,
  // because there you are entering one that exists; this form creates one, so no real name belongs
  // in it and swapping in another invented token would only move the problem.
  //
  // Both boxes now describe what to type: "Your token's name" and "ASSET". Mirrors Stellar's
  // _launchph.js exactly -- same two strings, same reasoning, written down in both places because
  // the two forms must not drift. A STRAIGHT apostrophe, so the anchor stays ASCII across repos.
  ['placeholder="e.g. Tether"', LAUNCH_NAME],
  ['placeholder="e.g. USDT"', LAUNCH_TICK],
  ['placeholder="e.g. Solar Flare"', LAUNCH_NAME],
  ['placeholder="e.g. SLR"', LAUNCH_TICK],

  // THE SAME TWO FIELDS, SECOND BASE SPELLING -- the same trap the Send placeholder above is kept in
  // two spellings for, and the same day it was written down. Stellar fixed its own copy of this on
  // 2026-11-07 (_launchph.js) by rewriting these attributes in the aptos containers to
  // "e.g. USD Coin" / "e.g. USDC", so a base cut from that day on carries THOSE strings and the four
  // entries above match nothing. Without this pair a `rebuild.js --base` would leave the XRP
  // Ledger's launchpad suggesting a STELLAR asset -- the fix above would look reverted, and the
  // build would report success. Both spellings are kept; delete neither until a base carrying the
  // old ones is provably gone.
  //
  // ANCHORED BY id, NOT BY THE ATTRIBUTE ALONE, and that is the whole reason these two look
  // different from the four above. `placeholder="e.g. USDC"` is not unique in Stellar's base: it
  // appears 33 times on desktop and 27 on mobile inside a <script>, as the Asset code field of the
  // Add-custom-asset modal that lx-walletdata builds at runtime. rewriteMarkupLiterals is a plain
  // split/join over the whole page key, so a bare rule would rewrite that modal on every page of
  // this fork -- a different surface, not reported, not asked for. The input's id makes the rule
  // exact. (The old spellings need no such anchor: "e.g. Tether" and "e.g. USDT" occur only on the
  // two launch-token keys, measured.)
  //
  // THE DOUBLED FORM COMES FIRST because the phone's markup carries the attribute TWICE on the name
  // input -- `placeholder="e.g. USD Coin" placeholder="e.g. USD Coin"` -- which is the design's own
  // duplicate, present in Stellar's base and harmless (a parser keeps the first). Listed ahead of
  // the single form so it collapses rather than leaving a stale second copy behind.
  ['id="tokenName" placeholder="e.g. USD Coin" placeholder="e.g. USD Coin"',
    'id="tokenName" ' + LAUNCH_NAME],
  ['id="tokenName" placeholder="e.g. USD Coin"',
    'id="tokenName" ' + LAUNCH_NAME],
  ['id="tokenTicker" placeholder="e.g. USDC"',
    'id="tokenTicker" ' + LAUNCH_TICK],

  // THIRD SPELLING: THIS FORK'S OWN PREVIOUS ANSWER. The containers here do not hold a Stellar base
  // string at all -- they hold "e.g. Ripple USD" / "e.g. RLUSD", because the rules above already ran
  // and baked it. Without these three entries the retarget above matches nothing and the launchpad
  // keeps advertising RLUSD, while the build reports success. Same lesson as the LUMOS card link
  // renamed twice in one day: a transform anchored on one generation is blind to the one it created.
  ['id="tokenName" placeholder="e.g. Ripple USD" placeholder="e.g. Ripple USD"',
    'id="tokenName" ' + LAUNCH_NAME],
  ['id="tokenName" placeholder="e.g. Ripple USD"',
    'id="tokenName" ' + LAUNCH_NAME],
  ['id="tokenTicker" placeholder="e.g. RLUSD"',
    'id="tokenTicker" ' + LAUNCH_TICK],

  // THE SAME FIGURE ON THE POOL PAGE'S Deposit / Withdraw summary (2 desktop + 1 mobile), a different
  // class and label from the row above -- `.r` / "Trading fee tier" -- which is why one pair cannot
  // cover both.
  //
  // AN EM DASH HERE, NOT A NUMBER, and this is the one place XRPL must NOT copy Stellar. Stellar can
  // write 0.3% because the protocol fixes it for every pool. On the XRP Ledger the creator chooses
  // it, 0 to 1%, per pool -- wallet.js reads the real one from amm_info (`m.trading_fee / 1000`).
  // Any constant baked here would be right for our own pools and wrong for everyone else's, so the
  // honest markup is the placeholder this build already uses for a figure it does not know yet.
  //
  // RAZA has ruled on this row's VISIBLE form once already (pools.js: the "0.205% fee tier" chip,
  // "we dont have it on stellar so why did you"); this only settles what the bytes say while it stays
  // hidden.
  ['<div class="r"><span>Trading fee tier</span><strong>0.5%</strong></div>',
    '<div class="r"><span>Trading fee tier</span><strong>—</strong></div>'],

  // THE PROMO CAROUSEL'S "Low fees" SLIDE (RAZA 2026-10-27, "fix the promo slide copy too").
  //
  // The phone Trade page ships a 4-slide promo whose third slide invents a pricing model: "Pay just
  // 0.5% per trade", "Sign up free for the LumosCore rate. Guests pay 0.8%", CTA "Sign Up Free".
  // There is no account on this site and the real rate is 0.2%, or 0.1% holding 250,000 LUMOS --
  // the same figures browser/feerate.js puts in the fee banner.
  //
  // inject_livemarket.js replaces the banner with the Living Market hero, so the block is
  // display:none everywhere. This fixes what the bytes say, not what anyone sees.
  //
  // 1 occurrence each, on lumoscore-dex-mobile.html, MOBILE container only -- identical to Stellar's,
  // which is why the pairs are byte-for-byte the same as _chaincopy.js's. The chain's name does not
  // appear in this slide, so unlike slides 1, 2 and 4 there is nothing per-fork about it.
  //
  // THE SUB IS TAGLESS and would also work as a PHRASES entry; it sits here so all three pieces of
  // one slide stay together and cannot drift apart. rewriteMarkupLiterals is a plain split/join, so
  // a pair without tags is handled the same way.
  ['Pay just <span class="lumos-promo-hi">0.5%</span> per trade.',
    'Pay just <span class="lumos-promo-hi">0.2%</span> per trade.'],
  ['Sign up free for the LumosCore rate. Guests pay 0.8% — every other trader keeps more of every fill.',
    '0.1% if you hold 250,000 LUMOS. No sign-up and no account — your wallet is all you need.'],
  ['<a href="#" class="lumos-promo-cta">Sign Up Free',
    '<a href="#" class="lumos-promo-cta">Start Trading'],

  // SLIDE 2 (RAZA 2026-10-27, "yes fix that too") promised "fair-launch mechanics, transparent
  // vesting, and on-chain verification from day one". Vesting does not exist on either fork -- the
  // only occurrence of the word in this repo is this comment, and mint.js issues, mints and opens
  // the pool in one run with nothing that releases supply over time -- and issuing here grants no
  // verification mark. The Launchpad is also open to anyone, so "curated" belongs to the separate
  // paid listing, not to a launch.
  //
  // Same replacement as Stellar's: only what both launchpads actually do.
  ['Curated launches with fair-launch mechanics, transparent vesting, and on-chain verification from day one.',
    'Every launch has a fixed supply, a live pool from day one, and its own page here with price, pool and activity.'],

  // ---- The two network-fee rows PHRASES cannot reach (RAZA 2026-10-27).
  //
  // `['~0.00001 APT', '~0.00001 XRP']` up in PHRASES already fixes 155 of the 167 the fork
  // inherited. Both halves of what is left are here for a reason:
  //
  //   * 2 are REAL MARKUP, in the Trade-Asset trade summary, and they are the one shape written
  //     WITHOUT the leading "~": `<span class="mono">0.00001 APT</span>`. A tilde-anchored phrase
  //     slides straight past them, which is why they survived every earlier sweep. Anchoring on
  //     the wrapper instead of the value keeps this pair off the other 165 and off the 10 below.
  //   * 10 are inside LAYER COMMENTS in write.js and dexasset.js that quote this very bug while
  //     explaining it. They are not served to anyone as copy, and rewriting a comment's quoted
  //     symptom to the fixed value destroys the only record of what was wrong. Left alone on
  //     purpose -- so no bare `0.00001 APT` pair here, unlike Stellar, which has no such comments.
  //
  // XRPL's base fee is 10 drops = 0.00001 XRP, so the figure carries over and only the asset moves.
  ['<span class="mono">0.00001 APT</span>', '<span class="mono">0.00001 XRP</span>'],

  // THE LAUNCHPAD'S SOCIAL PLACEHOLDERS ASKED FOR A URL AND THE FIELD STORES A HANDLE.
  //
  // "t.me/yourproject" and "x.com/yourproject" are what the design asks for, while xrplmintmeta.js
  // clips the value into a field named LIMITS.handle. On Stellar that mismatch made a mint link to
  // "https://x.com/x.com/handle" (RAZA 2026-11-05,
  // [[social-links-stored-a-url-in-a-handle-field]]); on this chain the same value is DROPPED by
  // xrpltoml's safeUrl instead, so it failed silently and nobody reported it. The prefix beside each
  // box is only an icon, so the placeholder is the whole instruction. listyourtoken.html already
  // asks the right way -- "@yourproject" for both -- and that is the wording copied here.
  //
  // THE ATTRIBUTE IS THE POINT, NOT A DECORATION. `browser/launchpad.js` used to find these three
  // inputs by matching their placeholder text, so correcting the copy on its own would have left
  // every social read matching nothing -- and an unmatched read returns "", which downstream is
  // indistinguishable from a minter who left the field blank. Stamping `data-lxlpsoc` in the same
  // replacement is what makes the copy safe to change. `bySoc()` reads the attribute first and keeps
  // the old placeholder regex as a fallback.
  //
  // NOT `data-lxsoc`: that name is already the asset page's social-row paint guard
  // (`browser/dexasset.js:3150`). Different page and different element, so nothing clashed, but
  // grepping this repo's containers for it returned 12 hits from that guard.
  //
  // Idempotent by construction -- each `from` is the UN-stamped tag, so a re-run finds nothing. The
  // website box keeps its copy (a website really is a url) and is stamped only so all three are
  // found the same way.
  ['<input class="input with-prefix" placeholder="t.me/yourproject" />',
    '<input class="input with-prefix" data-lxlpsoc="tg" placeholder="@yourproject" />'],
  ['<input class="input with-prefix" placeholder="x.com/yourproject" />',
    '<input class="input with-prefix" data-lxlpsoc="x" placeholder="@yourproject" />'],
  ['<input class="input with-prefix" placeholder="https://yourproject.com" />',
    '<input class="input with-prefix" data-lxlpsoc="web" placeholder="https://yourproject.com" />'],
];

let markupFixes = 0;

function rewriteMarkupLiterals(html) {
  let h = html;
  for (const [from, to] of MARKUP_LITERALS) {
    if (h.indexOf(from) < 0) continue;
    const parts = h.split(from);
    markupFixes += parts.length - 1;
    h = parts.join(to);
  }
  return h;
}

let scriptFixes = 0;

// Every rule's search string, so the page-level gate above can never skip a page a rule would have
// matched. Built from the rule tables rather than typed out.
const TRIGGERS = PHRASES.map(function (p) { return p[0]; })
  .concat(SCRIPT_LITERALS.map(function (p) { return p[0]; }))
  .concat(MARKUP_LITERALS.map(function (p) { return p[0]; }))
  .concat(['Aptos']);                       // rewriteBare works on the bare word

function rewriteScriptLiterals(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, function (block) {
    let b = block;
    for (const [from, to] of SCRIPT_LITERALS) {
      if (b.indexOf(from) < 0) continue;
      b = b.split(from).join(to);
      scriptFixes++;
    }
    return b;
  });
}

// Rewrite only TEXT between tags: never attributes, never script or style bodies.
function rewriteText(html) {
  let out = '', i = 0, changed = 0;
  const re = /<(script|style)\b[\s\S]*?<\/\1>|<[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(i, m.index);
    const done = applyPhrases(text);
    changed += done.n;
    out += done.s + m[0];
    i = m.index + m[0].length;
  }
  const tail = applyPhrases(html.slice(i));
  changed += tail.n;
  out += tail.s;
  return { html: out, n: changed };
}

// THE GATE IS DERIVED FROM THE RULES, not written by hand.
//
// It was `text.indexOf('Aptos') < 0 -> skip`, which was right until a phrase was added that does not
// contain the word: "Extra APT". The rule was correct, the gate silently skipped every chunk it
// applied to, and the label survived three deploys. That is the THIRD time in this project a
// hand-written fast-path filter has quietly disabled a rule that was right — the docs transform did
// it twice — so this one is computed from PHRASES and cannot drift from them.
//
// Each phrase contributes its first word; a chunk is examined if it contains any of them.
const GATE = (function () {
  const words = new Set();
  for (const [from] of PHRASES) {
    const w = String(from).split(/[^A-Za-z]+/).filter(Boolean)[0];
    if (w) words.add(w);
  }
  // The GUARDED rules have to feed the gate as well, or a chunk that only one of them matches is
  // skipped before it is ever tested. "0.5 APT" happens to survive today because another phrase
  // contributes the word APT — that is luck, not derivation, and this file's whole point is that a
  // gate which does not come from the rules eventually disagrees with them.
  for (const [re] of GUARDED) {
    const w = String(re.source).split(/[^A-Za-z]+/).filter(Boolean)[0];
    if (w) words.add(w);
  }
  return new RegExp([...words].join('|'));
})();

function applyPhrases(text) {
  if (!text || !GATE.test(text)) return { s: text, n: 0 };
  let n = 0, s = text;
  for (const [from, to] of PHRASES) {
    if (from === to) continue;
    if (s.indexOf(from) < 0) continue;
    const parts = s.split(from);
    n += parts.length - 1;
    per[from] = (per[from] || 0) + (parts.length - 1);
    unseen.delete(from);
    s = parts.join(to);
  }

  // GUARDED RULES, for a phrase that is a SUBSTRING OF A LARGER NUMBER.
  //
  // "Each trustline reserves <strong>0.5 APT</strong> from your account" is real prose on 30 pages,
  // and the figure sits alone inside its own tag — so the text chunk here is exactly "0.5 APT" and
  // a plain rule would fix it. But the same eight characters also occur inside "−340.5 APT", a mock
  // activity amount, three times in MARKUP where a plain rule would reach it and quietly produce
  // "−340.2 XRP" — a corrupted number rather than a corrected one.
  //
  // Measured before writing the rule: 30 standalone, 3 digit-prefixed. Hence the lookbehind-by-hand.
  for (const [re, to] of GUARDED) {
    s = s.replace(re, function (m0, pre) {
      n++;
      per[String(re)] = (per[String(re)] || 0) + 1;
      return pre + to;
    });
  }

  return { s: s, n: n };
}

// A bare network-name label: <span class="ad-nm">Aptos</span>
function rewriteBare(html) {
  let n = 0, s = html;
  for (const cls of BARE) {
    const re = new RegExp('(<[a-z]+[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>)\\s*Aptos\\s*(<)', 'gi');
    s = s.replace(re, function (m0, open, close) { n++; per['<.' + cls + '>Aptos'] = (per['<.' + cls + '>Aptos'] || 0) + 1; return open + 'XRP Ledger' + close; });
  }

  // THE LABEL IS NOT ALWAYS THE FIRST THING INSIDE THE TAG. The search popup's chain filter is
  //     <button class="sp-filter-pill" data-chain="xrpl"><span class="ch-ico xrpl" …></span> Aptos </button>
  // so the word sits after a nested icon and the rule above — which expects the text immediately
  // after the opening tag — never saw it. The element was already marked data-chain="xrpl"; only its
  // wording disagreed, which is the tell: keying on that marker is exact, because an element the
  // design itself labels as XRPL cannot legitimately be called Aptos.
  // The same trick names the OTHER network correctly too. The multi-chain design used "Aptos" as its
  // placeholder for what is really Stellar, so the sibling pill reads data-chain="stellar" with the
  // label "Aptos" — and Stellar is a network LumosCore genuinely offers, so the fix is to call it
  // Stellar rather than to remove it.
  [['xrpl', 'XRP Ledger'], ['stellar', 'Stellar']].forEach(function (pair) {
    const chain = pair[0], label = pair[1];
    const re = new RegExp('(<button[^>]*data-chain="' + chain + // The window has to clear the icon, which is an inline base64 SVG and can run to a few KB.
      '"[^>]*>)([\\s\\S]{0,6000}?)(<\\/button>)', 'gi');
    s = s.replace(re, function (m0, open, body, close) {
      if (body.indexOf('Aptos') < 0) return m0;
      const fixed = body.replace(/(^|>)([^<]*)\bAptos\b/g, function (x, pre, mid) { return pre + mid + label; });
      if (fixed === body) return m0;
      n++;
      per['data-chain="' + chain + '" label'] = (per['data-chain="' + chain + '" label'] || 0) + 1;
      return open + fixed + close;
    });
  });

  // THE TRADE PAGE'S CHAIN PILL WAS THREE DIFFERENT CHAINS AT ONCE.
  //
  // Every other page ships two search-filter pills, data-chain="xrpl" and data-chain="stellar",
  // which the loop above relabels. The dex (Trade) page ships ONE, and it is a different variant the
  // loop never matched:
  //
  //     <button class="sp-filter-pill" data-chain="hedera">   <- marker says Hedera
  //       <span class="ch-ico" …><img src="data:image/webp;…"> <- icon is STELLAR's mark
  //       Aptos <span …>(9)</span>                             <- label says Aptos
  //
  // Marker, icon and label each name a different chain, and none of the three is the XRP Ledger.
  //
  // It is NOT visible: `lx-searchfix` hides `#spFilters` with `display:none !important` on all 95
  // pages, because a chain filter is meaningless on a single-chain build — verified on the live page
  // (computed display none, zero width, no offsetParent). So this is shipped-but-invisible markup,
  // the same category as the Stellar wallet list in the dead connect modal, and it is fixed for the
  // same reason: a crawler reads the HTML, not the CSS.
  //
  // Relabelled rather than deleted. The design's own handler only ever does `filterBtns.forEach`,
  // so removing it would be safe — but the other 94 pages keep their pills in that same hidden row,
  // and making this one match them leaves every page the same shape. The icon becomes the design's
  // own `ch-ico xrpl` span, copied from those pages rather than invented, and the count span is
  // carried through untouched.
  {
    const re = /<button([^>]*)data-chain="hedera"([^>]*)>([\s\S]{0,8000}?)<\/button>/gi;
    s = s.replace(re, function (m0, pre, post, body) {
      if (m0.indexOf('sp-filter-pill') < 0 || body.indexOf('Aptos') < 0) return m0;
      let b = body
        .replace(/<span class="ch-ico"[^>]*>[\s\S]*?<\/span>/i, '<span class="ch-ico xrpl">X</span>')
        .replace(/\bAptos\b/, 'XRP Ledger');
      if (b === body) return m0;
      n++;
      per['data-chain="hedera" pill'] = (per['data-chain="hedera" pill'] || 0) + 1;
      return '<button' + pre + 'data-chain="xrpl"' + post + '>' + b + '</button>';
    });
  }

  return { html: s, n: n };
}

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const before = json[key];

    // THE OUTER GATE IS DERIVED TOO, and it was not.
    //
    // It read `before.indexOf('Aptos') < 0 -> continue`, which is the exact hand-written gate this
    // file already warns about thirty lines up — the note about "Extra APT" being silently skipped.
    // The warning was written for the INNER gate and the outer one was left as it was, so it stayed
    // a live example of the thing it cautions against: the trustline literal says
    // "Reserves 0.5 APT", with no "Aptos" anywhere in it, so any page carrying that string and not
    // the word would have been skipped without a sound.
    //
    // Now the trigger list comes from the rules themselves and cannot fall out of step with them.
    if (!TRIGGERS.some(function (t) { return before.indexOf(t) >= 0; })) continue;

    // The script-literal count has to travel INTO `total`, not just into the summary line. It did
    // not at first, and `if (!total) continue` then threw the rewritten page away: the build
    // cheerfully reported "+3 in script literals" while writing none of them to disk, because the
    // markup half of that page had nothing left to change.
    const sBefore = scriptFixes, mBefore = markupFixes;
    const withScripts = rewriteMarkupLiterals(rewriteScriptLiterals(before));
    const sDone = (scriptFixes - sBefore) + (markupFixes - mBefore);

    const a = rewriteText(withScripts);
    const b = rewriteBare(a.html);
    const total = a.n + b.n + sDone;
    if (!total) continue;
    json[key] = b.html;
    hits += total;
    pages++;
    changed = true;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl copy pass: ' + hits + ' replacement(s) (+' + scriptFixes + ' script, +' + markupFixes + ' tag-bound) on ' + pages + ' page key(s) across '
  + files + ' container(s)');
for (const k of Object.keys(per).sort((a, b) => per[b] - per[a])) {
  console.log('   x' + String(per[k]).padStart(4) + '  ' + k.slice(0, 62));
}
// Idempotent, so "unseen" on a second run is expected. It only means something on the FIRST run
// after a base re-copy, which is when a reworded design would show up.
const left = [...unseen].filter(function (p) { return PHRASES.find(function (x) { return x[0] === p; })[1] !== p; });
if (left.length && hits) {
  console.error('  note: these phrases matched nothing this run (already applied, or reworded upstream):');
  for (const p of left) console.error('     ' + p);
}
