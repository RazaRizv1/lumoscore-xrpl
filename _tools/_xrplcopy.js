// Rewrite the body copy from Stellar to the XRP Ledger.
//
// SCOPE, measured first. Of ~23,000 Stellar references in the built pages, only ~950 are in markup
// at all -- the other 22,000 sit inside inherited script blocks, which is dead code to be stripped,
// not prose to be translated. Those ~950 reduce to just 43 DISTINCT visible strings. So this is a
// hand-written table, not a regex sweep.
//
// WHY NOT FIND-AND-REPLACE. "XLM -> XRP" produces sentences that are false rather than renamed:
//
//   "each trustline locks 0.5 XLM of your reserve"   the XRP Ledger locks 0.2 XRP, not 0.5
//   "a network fee of a fraction of a cent"          true, but the real figure is 0.00001 XRP
//   "Freighter, Rabet, Albedo, xBull"                none of these exist on the XRP Ledger
//   "publishing a stellar.toml"                      the XRP Ledger file is xrp-ledger.toml
//
// Every number below was read from mainnet on 2026-09-06, not from documentation:
//   account base reserve 1 XRP, owner reserve 0.2 XRP per object, base fee 0.00001 XRP.
// The reserve figure matters most: it is the one a user can check against their own wallet.
//
// WHAT IS DELIBERATELY LEFT ALONE. Copy asserting product facts that are not decided for the XRP
// Ledger yet -- the rewards pool list, the bridge destinations, launchpad and listing prices and the
// currency they are paid in, the MCP server's capabilities. Those need answers, not guesses. An
// untouched Stellar string is visibly wrong and someone will fix it; a confidently wrong XRPL string
// reads as fact and nobody will. Same rule as _xrplseo.js.
//
// Idempotent: it writes exact values, so re-running changes nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// Fragments rather than whole paragraphs: each is unambiguous, and a fragment cannot be broken by a
// typographic apostrophe transcribed wrongly. Order matters only where one is a prefix of another.
const COPY = [
  // --- the ledger, by name ---------------------------------------------------------------------
  ['Search assets, pools and wallets on Stellar.', 'Search assets, pools and wallets on the XRP Ledger.'],
  ['non-custodial DeFi platform on Stellar', 'non-custodial DeFi platform on the XRP Ledger'],
  ['run on Stellar mainnet', 'run on XRP Ledger mainnet'],
  ['the Stellar DEX', 'the XRP Ledger DEX'],
  ['any ticker on Stellar', 'any ticker on the XRP Ledger'],
  ['Platform Activity — Stellar', 'Platform Activity — XRP Ledger'],
  ['STELLAR NATIVE', 'XRP LEDGER NATIVE'],

  // --- network fees: the real figure, not just a renamed chain ----------------------------------
  ['Stellar itself charges a network fee of a small fraction of a cent',
   'the XRP Ledger itself charges a network fee of about 0.00001 XRP, a small fraction of a cent'],
  ['the Stellar network fee, a fraction of a cent',
   'the XRP Ledger network fee, about 0.00001 XRP'],

  // --- reserves: 0.5 XLM is simply not the number here ------------------------------------------
  // Every one of these is checkable by the reader against their own wallet, which is exactly why a
  // blind XLM->XRP rename would have been worse than leaving it saying Stellar.
  ['Each one locks 0.5 XLM of your reserve, released when you remove it.',
   'Each one locks 0.2 XRP of your reserve, released when you remove it.'],
  ['Keep spare XLM: a new pool position is a trustline and locks 0.5 XLM of reserve.',
   'Keep spare XRP: a new pool position holds an LP token, which locks 0.2 XRP of reserve.'],
  ['A first position also opens a trustline, which locks 0.5 XLM, so keep a little spare.',
   'A first position also holds an LP token, which locks 0.2 XRP, so keep a little spare.'],
  ['that releases the 0.5 XLM it was holding', 'that releases the 0.2 XRP it was holding'],

  // --- issuers and identity: true on both ledgers, but named differently -------------------------
  ['Every Stellar asset except XLM is created by an account',
   'Every XRP Ledger token except XRP is issued by an account'],
  ['Stellar will not deliver a token you have not opted into',
   'the XRP Ledger will not deliver a token you have not opted into'],
  ['Stellar lets anyone issue an asset with any code',
   'The XRP Ledger lets anyone issue a token with any code'],
  ['linked to their Stellar account, publishing a stellar.toml file',
   'linked to their XRP Ledger account, publishing an xrp-ledger.toml file'],

  // --- prices are quoted against the native asset ------------------------------------------------
  ['what the asset last traded at against XLM', 'what the token last traded at against XRP'],
  ['converts that at the live XLM rate', 'converts that at the live XRP rate'],

  // --- LUMOS -------------------------------------------------------------------------------------
  ['issued on Stellar', 'issued on the XRP Ledger'],
  ['LUMOS trades on the Stellar network.', 'LUMOS trades on the XRP Ledger.'],
  ['from XLM or another asset on the Trade page', 'from XRP or another token on the Trade page'],
  ['using the same routing as any other Stellar asset', 'using the same routing as any other XRP Ledger token'],

  // --- wallets: none of the Stellar ones exist here ----------------------------------------------
  ['Freighter, Rabet, Albedo, xBull and WalletConnect.', 'Xaman and GemWallet.'],

  // --- launchpad and listing ---------------------------------------------------------------------
  // RAZA confirmed 2026-09-06: the prices carry over unchanged, only the currency changes.
  // The dollar figures are therefore left exactly as they are -- $25, $250, $15/1,000, $75 minimum.
  ['pay $250 in XLM from your own wallet', 'pay $250 in XRP from your own wallet'],
  ['pay $250 in XLM, refunded in full', 'pay $250 in XRP, refunded in full'],
  ['the same amount of XLM, sent back to the account that paid it',
   'the same amount of XRP, sent back to the account that paid it'],
  ['paid in XLM or LUMOS.', 'paid in XRP or LUMOS.'],
  ['Pay in XLM or LUMOS.', 'Pay in XRP or LUMOS.'],
  ['You pay in XLM at the live rate', 'You pay in XRP at the live rate'],
  ['shown to people already trading Stellar assets', 'shown to people already trading XRP Ledger tokens'],

  // --- Ecosystem LP rewards ----------------------------------------------------------------------
  // RAZA supplied ten pool addresses on 2026-09-06. They were NOT taken on trust: each was resolved
  // with amm_info on mainnet, which confirmed all ten are real AMM accounts and that LUMOS is one
  // side of every one. The pair names below are what the ledger reports, not what was typed to me --
  // the addresses arrived without names, so reading them off the ledger is the only way to get this
  // list right, and it is also what proves the list is the LUMOS set at all.
  ['currently LMNR, yXLM, sages, AQUA, SSLX, SHX, TKG, LIBERATOR, KALE and USDC',
   'currently 666, XDawgs, MXI, BXE, REAL, RLUSD, ARMY, FUZZY, BEAR and SOLO'],
  ['each pairing LUMOS with one other asset', 'each pairing LUMOS with one other token'],
  // RAZA confirmed 2026-09-06 that the XRP Ledger programmes started on the same dates as the
  // Stellar ones, so the answer's dates stay exactly as they are and only the question is renamed.
  ['When did rewards start on Stellar?', 'When did rewards start on the XRP Ledger?'],

  // --- bridge -------------------------------------------------------------------------------------
  // Settled 2026-09-06: Axelar, whose live registry reports 58 networks reachable from the XRP
  // Ledger. The copy says route discovery rather than claiming you can bridge today, because
  // transfers are not wired -- that needs Squid routing plus a signed transaction.
  ['How do I bridge USDC to or from Stellar?',
   'How do I bridge assets to or from the XRP Ledger?'],
  ['USDC moves between Stellar and Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea and World Chain: eight destinations, nine chains in all.',
   'The XRP Ledger connects to 58 other networks through Axelar, including Ethereum, Base, Arbitrum, Avalanche, Polygon and Solana. Transfers are not enabled from this page yet — it currently shows which routes exist.'],
  ['Can I bridge my own Stellar asset?', 'Can I bridge my own XRP Ledger token?'],
  ['USDC can be bridged between Stellar and Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Linea and World Chain using Circle CCTP.',
   'Cross-chain routes run through Axelar, which connects the XRP Ledger to 58 other networks.'],

  // --- misc labels --------------------------------------------------------------------------------
  ['XLM balance', 'XRP balance'],
];

// NOT in the table, and each for a stated reason. Listed here so the gap is a decision on the record
// rather than something that was missed:
//
//   bridge      "USDC moves between Stellar and Ethereum, Base, ..." via Circle CCTP. The XRP Ledger
//               uses Wanchain and Axelar, but the destinations and assets are not settled. RAZA:
//               leave it (2026-09-06). Writing a chain list we have not committed to would be the
//               most quotable false sentence on the site.
//   rewards     DONE. Pool list resolved from the ledger, and RAZA confirmed the XRP Ledger
//               programmes began on the same dates as the Stellar ones, so those dates are correct
//               as they stand and only the question needed renaming.
//   MCP         "Stellar DeFi for AI Agents", "Stellar asset prices". The MCP server is Stellar-only.
//               Renaming it would claim a capability that has not been built.
//   Soroban     a "Soroban record" label on the asset page. Soroban has no XRP Ledger equivalent, so
//               this is a field to remove, not to rename.
//   .lc-* modal the unused connect modal's wallet rows (Freighter, xBull, Rabet, Albedo, LOBSTR).
//               Hidden markup, superseded by the JS flow, and 61 of the remaining occurrences. It
//               goes when that dead modal is removed, which is a markup change, not a copy one.

let files = 0, pages = 0;
const applied = new Map(COPY.map(([a]) => [a, 0]));

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let html = json[key], touched = false;

    for (const [from, to] of COPY) {
      if (html.indexOf(from) < 0) continue;
      // Count occurrences before replacing, so the report reflects real work done.
      applied.set(from, applied.get(from) + html.split(from).length - 1);
      html = html.split(from).join(to);
      touched = true;
    }
    if (touched) { json[key] = html; pages++; }
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

const total = [...applied.values()].reduce((a, b) => a + b, 0);
console.log('xrpl copy: ' + total + ' replacement(s) across ' + pages + ' page key(s) in ' + files + ' container(s)');

// A table entry that matches nothing is the silent failure mode here: the build reports success, the
// copy still says Stellar, and nobody looks again. On a RE-RUN everything is already replaced and
// zero matches is correct, so this only means something on a first pass -- hence naming them rather
// than failing.
const dead = [...applied.entries()].filter(([, n]) => n === 0).map(([a]) => a);
if (dead.length) {
  console.log('  ' + dead.length + ' table entr(ies) matched nothing (expected on a re-run):');
  for (const d of dead.slice(0, 6)) console.log('    ' + JSON.stringify(d.slice(0, 62)));
}
