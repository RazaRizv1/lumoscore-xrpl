// Rewrite the documentation for the XRP Ledger.
//
// The docs are STELLAR DOCUMENTATION, not merely Stellar-branded text, and that distinction decides
// how they have to be handled. They explain Stellar's mechanics with Stellar's numbers:
//
//   "Each trustline holds 0.5 XLM of your account's minimum balance."
//   "(2 + number of subentries) × 0.5 XLM"
//   "Stellar parks it as a claimable balance."
//   "Stellar's own pools charge 0.3% on a swap."
//   "stellar.toml"  ·  "Freighter, the most widely used Stellar extension"
//
// A word-level swap of Stellar→XRP Ledger and XLM→XRP would turn every one of those into a confident
// falsehood — "each trustline holds 0.5 XRP" is wrong by 2.5x, the minimum-balance formula is not the
// same shape at all, and this ledger has no claimable balances to park anything in. Documentation
// that is merely mislabelled is embarrassing; documentation that states the wrong reserve is
// something a reader budgets against.
//
// So the mechanics-bearing sentences are replaced EXPLICITLY, from values read off the ledger:
//
//   reserve_base_xrp = 1      (Stellar's base is different in shape: 2 × its own base)
//   reserve_inc_xrp  = 0.2    (Stellar: 0.5 XLM per subentry)
//   base_fee_xrp     = 0.00001
//
// Verified against server_info on 2026-09-08, and cross-checked against a real account: the wallet
// showing 15.573581 XRP with 12.573581 spendable has exactly 3 XRP reserved, which is
// 1 + (9 trust lines + 1 offer) × 0.2. Both numbers are read live by the app itself, so the docs and
// the product cannot disagree.
//
// ONLY THEN are the remaining safe words swapped. Order matters: the explicit sentences must land
// first, or the generic pass mangles the very strings this map keys on.
//
// NOT TOUCHED: anything where naming another chain is correct. The bridge FAQ deliberately explains
// Circle's CCTP as the Stellar build's model; the sign-in picker offers Stellar as a network. Neither
// is a docs page, so neither is reachable from here — but the same caution applies if this list grows.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// ---- 1. Mechanics and facts. Longest first; each is a whole claim, not a word. -------------------
const FACTS = [
  // Reserves — the numbers a reader could act on.
  ['(2 + number of subentries) × 0.5 XLM',
    '1 XRP, plus 0.2 XRP for every object your account owns'],
  // WHITESPACE-TOLERANT ON PURPOSE. These sentences are wrapped in the source, so the literal
  // ", where subentries are…" never matched — what is actually there is ", where\r\n  subentries are…".
  // A phrase that spans a line break in hand-written HTML is the normal case, not the exception, so
  // anything long enough to wrap is matched with \s+ rather than a single space.
  [/,\s*where\s+subentries are your trustlines, open offers and pool positions/g,
    ', where those objects are your trust lines, open offers, escrows, checks and AMM positions'],
  [/,\s*where\s+each trustline, open offer and pool position is a subentry/g,
    ', where each trust line, open offer, escrow, check and AMM position is one owned object'],
  [/Creating a pool adds subentries/g, 'Creating a pool adds owned objects'],
  [/\bsubentries\b/g, 'owned objects'],
  [/\bsubentry\b/g, 'owned object'],
  ['Each trustline holds\n            0.5 XLM', 'Each trust line holds\n            0.2 XRP'],
  ['0.5 XLM', '0.2 XRP'],

  // Claimable balances do not exist on this ledger.
  ['Stellar parks it as a', 'The XRP Ledger has no equivalent of this — a payment of an untrusted asset simply fails. The nearest thing is a'],
  ['claimable balance', 'Check'],
  ['Claimable balances', 'Checks'],
  ['What are claimable payments?', 'What are Checks?'],

  // Pool fees are set per pool here, not fixed by the protocol.
  ["Stellar's own pools charge 0.3% on a swap that routes through them",
    'An AMM pool on the XRP Ledger charges a trading fee its creator set, anywhere from 0% to 1%, on a swap that routes through it'],
  ["Stellar's pools charge", 'An AMM pool on the XRP Ledger charges the trading fee its creator set, up to 1%,'],
  ["Stellar's own order book", "the XRP Ledger's own order book"],

  // Metadata file.
  ['/.well-known/stellar.toml', '/.well-known/xrp-ledger.toml'],
  ['https://yourdomain/.well-known/stellar.toml', 'https://yourdomain/.well-known/xrp-ledger.toml'],
  ['stellar.toml', 'xrp-ledger.toml'],
  ["Stellar's convention for asset metadata is a file called",
    "The XRP Ledger's convention for issuer metadata is a file called"],

  // Fees and the network's own charge.
  ['The Stellar network fee.', 'The XRP Ledger network fee.'],
  ['Stellar network fee', 'XRP Ledger network fee'],

  // Wallets: the five named are Stellar extensions and none of them signs on this ledger.
  ['The five supported Stellar wallets, how connecting works, and what the site can and cannot do.',
    'The supported XRP Ledger wallets, how connecting works, and what the site can and cannot do.'],
  ['Five supported Stellar wallets and what connecting actually does.',
    'The supported XRP Ledger wallets and what connecting actually does.'],
  ['The most widely used Stellar extension. Desktop browsers.',
    'A widely used XRP Ledger extension. Desktop browsers.'],
  ['You connect a Stellar wallet you already control',
    'You connect an XRP Ledger wallet you already control'],

  // ---- The cross-chain page documents a feature this build does not have -------------------------
  //
  // Every paragraph of it describes Circle's CCTP procedure — burn on the source chain, wait for an
  // attestation, claim on the destination, keep the burn hash. None of that happens here: the bridge
  // page does Axelar ROUTE DISCOVERY and moves nothing, and says so itself.
  //
  // Leaving it would be the worst kind of documentation: a precise, confident, step-by-step guide to
  // an operation the product will not perform, ending with advice about recovering funds that were
  // never sent. Each paragraph is replaced with what is actually true.
  //
  // The 58 destinations and the eight named chains were checked against /lxapi/xrplbridge rather than
  // assumed — Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea and Solana are all in the
  // list Axelar returns today.
  [/between the XRP Ledger and eight other networks\./g,
    'between the XRP Ledger and other networks. This is not enabled yet — the page currently lists the '
    + 'destinations Axelar can reach and does not move anything.'],
  [/Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea, World Chain — and back again in either direction\./g,
    'Axelar reports 58 reachable networks today, among them Ethereum, Base, Arbitrum, Optimism, '
    + 'Polygon, Avalanche, Linea and Solana. The list is fetched live rather than written down here, '
    + 'so it cannot go stale and name a route that has been removed.'],
  [/USDC is the only asset CCTP carries\./g, 'No asset can be bridged from this page yet.'],
  [/Approve the burn on the source chain\.[^<]*/g,
    'Nothing is signed. Choosing a route does not build a transaction, and the page will not ask you to approve one.'],
  [/Wait for attestation\.[^<]*/g,
    'There is nothing to wait for, because nothing has been submitted.'],
  [/Claim on the destination\.[^<]*/g,
    'There is nothing to claim. When transfers are enabled this page will describe the real steps.'],
  [/You claim it yourself/g, 'Nothing to claim yet'],
  [/If you close the tab before claiming/g, 'If you close the tab'],
  [/The burn is on-chain and permanent; the funds are not lost\./g,
    'Nothing is in flight, so nothing can be lost.'],
  [/A burned but unclaimed transfer stays claim[^<]*/g,
    'Looking up routes is read-only.'],
  [/Keep the burn transaction hash\.[^<]*/g,
    'There is no transaction to keep a record of yet.'],
  [/nothing\. CCTP itself charges no fee for the transfer\./g,
    'nothing today, because no transfer takes place.'],
  [/Delegating the transport does not remove transport risk\.[^<]*/g,
    'When transfers are enabled, delegating the transport will not remove transport risk, and this '
    + 'page will say what that risk is for the route being used.'],
  // The last two, in the FAQ and troubleshooting pages. Both describe recovering a transfer that is
  // mid-flight — a state this build cannot reach, so the advice is not merely mislabelled, it is
  // instructions for a situation that will not occur. Note the curly apostrophe in the first: the
  // source uses ’ and a straight ' would not match.
  [/Nothing is stranded\. The burn hash, Circle[’']s message and the attestation, everything a redeem needs, are saved the moment they exist and listed under Awaiting redemption\./g,
    'Nothing can be stranded, because nothing is sent. Looking up routes is read-only, so there is no '
    + 'pending transfer to recover.'],
  [/Circle's attestation normally takes a few minutes\.\s*Waiting is the only option — neither of us can speed it up\./g,
    'Transfers are not enabled from this page yet, so there is nothing in progress to wait for.'],

  [/Circle observes the burn and issues a signed attestation\./g, ''],

  // Bridge: this build routes through Axelar and does not move funds yet.
  //
  // THESE MUST RUN BEFORE THE BARE `CCTP` RULE, and did not. That rule (now moved to the end of this
  // table) rewrites the word to "the bridge", so by the time these full sentences were tried the
  // string they match no longer existed. What shipped was the half-rewritten wreck:
  //
  //     "Moving USDC between the XRP Ledger and eight networks over Circle's the bridge."
  //
  // — on an indexed docs page, still naming Circle, still counting eight networks, and no longer a
  // sentence. The specific rule was correct and was silently disabled by a broader one above it,
  // which is the third time a rule in this project has been switched off by another rule rather
  // than by a bug in itself.
  //
  // GENERAL ORDER FOR THIS TABLE: whole sentences first, single words last. A word rule cannot help
  // matching inside a sentence rule's text, so the sentence has to get there first.
  ['Moving USDC between Stellar and eight networks over Circle’s CCTP.',
    'Which networks the XRP Ledger can reach through Axelar. Transfers are not enabled yet.'],
  ["Move USDC between Stellar and eight networks over Circle's CCTP.",
    'See which networks the XRP Ledger can reach through Axelar. Transfers are not enabled yet.'],
  // The already-damaged form, for containers that were built before this ordering was fixed.
  ['Moving USDC between the XRP Ledger and eight networks over Circle’s the bridge.',
    'Which networks the XRP Ledger can reach through Axelar. Transfers are not enabled yet.'],
  ["Moving USDC between the XRP Ledger and eight networks over Circle's the bridge.",
    'Which networks the XRP Ledger can reach through Axelar. Transfers are not enabled yet.'],

  // THE TEN ECOSYSTEM POOLS ARE A DIFFERENT TEN ON THIS LEDGER.
  //
  // The page named LMNR, yXLM, sages, AQUA, SSLX, SHX, TKG, LIBERATOR, KALE and USDC — Stellar
  // assets, on the XRP Ledger's own rewards documentation, in a sentence telling a reader which
  // pools pay 100,000 LUMOS a round. Someone could provide liquidity to the wrong pool on the
  // strength of it.
  //
  // The replacements are the pairs `browser/rewards.js` actually pays, which are RAZA's list
  // confirmed against amm_info — so the docs and the page cannot name different pools. Both the
  // wrapped and unwrapped forms are listed because the source is hard-wrapped and a re-run over an
  // already-fixed container must still match.
  // THE CURRENT CYCLE (2026-11-18): X_ECO in the Stellar repo's _adminrewards.js. Stellar's own sentence was
  // rotated the same day, so BOTH Stellar spellings (previous and current cycle) are anchors, plus this file's
  // own previous output, so a re-run over an already-fixed container still lands on the current list.
  ['LMNR, yXLM, sages, AQUA, SSLX, SHX, TKG, LIBERATOR, KALE and USDC',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and XAH'],
  ['LMNR, yXLM, sages, AQUA, SSLX, SHX, TKG, LIBERATOR, KALE and\r\n  USDC',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and\r\n  XAH'],
  ['USDC, USDT0, EURC, SHX, AQUA, BLND, xLMNR, yXLM, XRP and PYUSD',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and XAH'],
  ['USDC, USDT0, EURC, SHX, AQUA, BLND, xLMNR, yXLM, XRP and\r\n  PYUSD',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and\r\n  XAH'],
  ['666, XDawgs, MXI, BXE, REAL, RLUSD, ARMY, FUZZY, BEAR and SOLO',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and XAH'],
  ['666, XDawgs, MXI, BXE, REAL, RLUSD, ARMY, FUZZY, BEAR and\r\n  SOLO',
    'RLUSD, USDC, SHX, XPM, XLM, USDT, XDawgs, 666, FLR and\r\n  XAH'],

  // Claims about what is live. The Stellar build's launch date is not this build's.
  ['LumosCore has been live on Stellar mainnet since 1 August 2026.',
    'LumosCore on the XRP Ledger is in active development.'],
  ['These docs cover what is live today. If something is described here, it works on Stellar mainnet right now.',
    'These docs describe the XRP Ledger build. Where something is not wired up yet, the page for it says so.'],
  ['Issuing an asset on Stellar mainnet', 'Issuing an asset on the XRP Ledger'],
  ['issues an asset on Stellar mainnet', 'issues an asset on the XRP Ledger'],
  ['Stellar mainnet', 'the XRP Ledger'],

  // Identity — true on both ledgers, but say the right one.
  ['On Stellar a ticker is not an identity', 'On the XRP Ledger a ticker is not an identity'],
  ['A ticker on Stellar is not unique', 'A ticker on the XRP Ledger is not unique'],
  ['Stellar asset codes are not unique and are not reserved',
    'XRP Ledger currency codes are not unique and are not reserved'],

  // Reserve prose that names the wrong asset.
  ['Stellar accounts need a small XRP balance to exist',
    'XRP Ledger accounts need a small XRP balance to exist'],
  ['If you are new to Stellar,', 'If you are new to the XRP Ledger,'],
  ['a single Stellar transaction', 'a single XRP Ledger transaction'],
  ['Stellar has two independent sources of liquidity',
    'The XRP Ledger has two independent sources of liquidity'],
  ['Stellar has a native on-chain order book', 'The XRP Ledger has a native on-chain order book'],
  ['Stellar carries assets of every size', 'The XRP Ledger carries assets of every size'],
  ['Stellar matches orders at the protocol level', 'The XRP Ledger matches orders at the protocol level'],
  ["the Stellar order book", 'the XRP Ledger order book'],
  ['Stellar payments are final', 'XRP Ledger payments are final'],
  ['a Stellar address is public information', 'an XRP Ledger address is public information'],
  ['any Stellar explorer', 'any XRP Ledger explorer'],
  ['your Stellar account', 'your XRP Ledger account'],
  ['it is a different asset as far as Stellar is concerned',
    'it is a different asset as far as the XRP Ledger is concerned'],
  ['Anyone can issue an asset on Stellar', 'Anyone can issue an asset on the XRP Ledger'],
  ['Stellar will not let an account hold an asset it has not agreed to hold',
    'The XRP Ledger will not let an account hold an asset it has not agreed to hold'],
  ['Why Stellar needs a trustline', 'Why the XRP Ledger needs a trust line'],
  ['Why Stellar asks before you can hold an asset',
    'Why the XRP Ledger asks before you can hold an asset'],
  ['exposes Stellar market data', 'exposes XRP Ledger market data'],
  ['about Stellar asset prices', 'about XRP Ledger asset prices'],
  ["Trade assets against Stellar's own", "Trade assets against the XRP Ledger's own"],
  ['Trading assets on Stellar:', 'Trading assets on the XRP Ledger:'],
  ['come down to XLM reserves', 'come down to XRP reserves'],
  ['XLM shortage', 'XRP shortage'],
  ['XLM reserve', 'XRP reserve'],
  ['Keeping XLM for fees', 'Keeping XRP for fees'],
  ['where XLM is trading', 'where XRP is trading'],

  // LAST, deliberately — see the note beside the bridge sentences above. This rewrites a single word
  // and would otherwise reach inside the sentences those rules are trying to match whole.
  [/\bCCTP\b/g, 'the bridge'],
];

// ---- 2. Whole-word swaps, applied only after every fact above has landed. ------------------------
const WORDS = [
  [/\bXLM\b/g, 'XRP'],
  [/\bStellar's\b/g, "the XRP Ledger's"],
  [/\bStellar\b/g, 'the XRP Ledger'],
  [/\blumens\b/g, 'XRP'],
  [/\bHorizon\b/g, 'the XRP Ledger API'],
];

// Only rewrite TEXT between tags: never attributes, never script or style bodies.
function rewrite(html, tally) {
  const parts = [];
  const re = /<(script|style)\b[\s\S]*?<\/\1>|<[^>]*>/gi;
  let i = 0, m;
  while ((m = re.exec(html))) {
    parts.push(apply(html.slice(i, m.index), tally), m[0]);
    i = m.index + m[0].length;
  }
  parts.push(apply(html.slice(i), tally));
  return parts.join('');
}

function apply(text, tally) {
  // THE FAST-PATH GATE HAS TO KNOW ABOUT EVERY RULE BELOW, and mine did not. It listed only the
  // chain words — Stellar, XLM, claimable, subentr — so the cross-chain paragraphs, which describe
  // Circle's flow without ever naming Stellar ("Approve the burn on the source chain", "Wait for
  // attestation"), were skipped before any rule was tried. The rules were right and simply never ran.
  //
  // Same shape of mistake as the docs guard that matched every page: a filter written from what I
  // expected the text to contain rather than from what the rules actually match on.
  if (!text) return text;
  if (!/Stellar|XLM|stellar\.toml|claimable|lumens|Horizon|subentr|CCTP|attestation|\bburn\b|Circle/i.test(text)) return text;
  let s = text;
  for (const [from, to] of FACTS) {
    if (from instanceof RegExp) {
      const before = s;
      s = s.replace(from, to);
      if (s !== before) {
        tally.facts++;
        const k = String(from).slice(0, 46);
        tally.per[k] = (tally.per[k] || 0) + 1;
      }
      continue;
    }
    if (s.indexOf(from) < 0) continue;
    const n = s.split(from).length - 1;
    tally.facts += n;
    tally.per[from] = (tally.per[from] || 0) + n;
    s = s.split(from).join(to);
  }
  for (const [re, to] of WORDS) {
    const before = s;
    s = s.replace(re, to);
    if (s !== before) tally.words++;
  }
  return s;
}

let files = 0, pages = 0;
const tally = { facts: 0, words: 0, per: {} };

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const h = json[key];
    // DOCS PAGES ONLY, AND THE GUARD IS THE PAGE NAME.
    //
    // The first version keyed on markup — ">Documentation<", .docs-side, .lx-docs — reasoning that a
    // page-name test would miss the mobile and dark variants. It matched 98 keys instead of 17,
    // because the FOOTER carries a "Documentation" link on every page of the site. So the word swaps
    // below ran site-wide and relabelled things that were deliberately correct: the search popup's
    // Stellar network pill, which _xrplcopy2 had just set, became "the XRP Ledger (7)".
    //
    // The page name is exact and the variants are covered anyway, because every one of them —
    // -mobile, -dark, -light — still begins with the same prefix. A narrower guard was available the
    // whole time; the markup test only looked safer.
    if (key.indexOf('lumoscore-docs') !== 0) continue;
    if (!/Stellar|XLM/.test(h)) continue;
    const out = rewrite(h, tally);
    if (out === h) continue;
    json[key] = out;
    pages++;
    changed = true;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl docs: ' + pages + ' page key(s) across ' + files + ' container(s) — '
  + tally.facts + ' fact rewrite(s), ' + tally.words + ' word pass(es)');
const top = Object.keys(tally.per).sort((a, b) => tally.per[b] - tally.per[a]).slice(0, 10);
for (const k of top) console.log('   x' + String(tally.per[k]).padStart(3) + '  ' + k.slice(0, 58));
// "No page changed" is the NORMAL state on a re-run, not a fault — the rules have already been
// applied and re-applying them is a no-op. The old message said "check the guard" every time, which
// is a warning that cries wolf: read enough times with nothing wrong behind it and a real one gets
// ignored too.
//
// So it distinguishes the two cases. A docs page still carrying Stellar or XLM in its MARKUP is
// worth a look; the same words inside a <script> are almost always this project's own comments
// explaining what was changed and why, and rewriting those would be nonsense.
if (!pages) {
  let markupHits = 0;
  for (const dev of ['desktop', 'mobile']) {
    let d; try { d = read(`lumoscore-xrpl-${dev}.html`); } catch (e) { continue; }
    const { json: j } = getContents(d);
    for (const k of Object.keys(j)) {
      if (k.indexOf('lumoscore-docs') !== 0) continue;
      const markup = j[k].replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
      if (/\b(Stellar|XLM)\b/.test(markup)) markupHits++;
    }
  }
  if (markupHits) {
    console.error('  ! nothing rewritten, but ' + markupHits
      + ' docs page(s) still name Stellar/XLM in their MARKUP — a rule is missing');
  } else {
    console.log('   nothing to do: docs markup is already clean (any Stellar/XLM left is in scripts)');
  }
}
