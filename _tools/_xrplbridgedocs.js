// Rewrite the DOCUMENTATION about the bridge.
//
// _xrplbridgecopy.js fixed the bridge page's own words, and a sweep of dist afterwards found the
// claim still standing in the place it does the most damage: the docs. Three pages, all indexed, all
// describing a product that does not exist here.
//
//   docs/cross-chain      "Cross-chain transfers move USDC between the XRP Ledger and other
//                          networks. This is not enabled yet... the transfer is carried by Circle's
//                          Cross-Chain Transfer Protocol, which burns USDC on the source chain and
//                          mints native USDC on the destination."
//   docs/faq              eleven questions that contradict each other -- one says 14 networks,
//                          another 58; one explains burn-and-mint as the mechanism, another says
//                          nothing is sent at all
//   docs/troubleshooting  a stuck-transfer section whose first state is "Burned, not yet attested"
//
// NONE OF IT IS TRUE OF THIS BUILD. There is no burn, no attestation, no claim and no USDC-only
// limit: NEAR Intents, Axelar and THORChain all deliver to the destination address in one step. The
// wording is Stellar's CCTP documentation, inherited with the containers and then half-corrected by
// a word-swap pass -- which is where "What is Circle the bridge?" comes from, a question that reads
// as a typo and is actually the fossil of "What is Circle CCTP?".
//
// WHY THESE ARE WORSE THAN THE PAGE ITSELF BEING WRONG. Someone reading the bridge can see what it
// does; someone reading the docs is being told, and will budget gas for a claim that never comes.
// The troubleshooting page is read by people who already have money in flight.
//
// HOW IT IS DONE. The cross-chain page is replaced wholesale between .dc-head and .dc-pager, because
// every claim on it is wrong and patching sentences would leave a page arguing with itself. The FAQ
// and troubleshooting pages are edited answer by answer, anchored on the question, because most of
// what is on them is about something else and correct.
//
// Idempotent: each replacement is skipped when the text is already what we want, so a re-run writes
// nothing and a settled container hashes the same.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const SUB = 'How LumosCore moves assets off the XRP Ledger, which route carries what, and what each one costs.';

function h2(id, text) {
  return '<h2 id="' + id + '"><a class="dc-anchor" href="#' + id + '" aria-label="Link to this section">#</a>'
    + text + '</h2>';
}

// The body of docs/cross-chain, rewritten for the three routes that exist.
//
// EVERY FIGURE HERE IS ONE THE PRODUCT ALSO STATES. The fee is the site's rate, the route split is
// the one routesFor() implements, and "thirty-nine" is what the destination picker offers. Nothing is
// claimed about speed that a quote does not say, because the quote is the thing that knows.
const CROSS = [
  '<p>Cross-chain transfers move assets <strong>off the XRP Ledger</strong> to another network. You',
  '  sign one XRP Ledger payment and the route delivers to the address you gave — there is no second',
  '  transaction, nothing to claim, and no gas needed on the destination.</p>',
  '',
  '<p>LumosCore does not run a bridge and never holds your funds in transit. The transfer is carried by',
  '  one of three independent networks, and which one is decided for you by what you are sending and',
  '  where it is going.</p>',
  '',
  h2('the-three-routes', 'The three routes'),
  '',
  '<div class="dc-tw">',
  '  <table>',
  '    <thead><tr><th>Route</th><th>Carries</th><th>Reaches</th></tr></thead>',
  '    <tbody>',
  '      <tr>',
  '        <td>NEAR Intents</td>',
  '        <td>XRP only</td>',
  '        <td>Thirty-five networks, including Bitcoin, Ethereum, Solana, Cardano, TON, Tron and',
  '          Stellar. Delivers the chain’s own token rather than a wrapped copy.</td>',
  '      </tr>',
  '      <tr>',
  '        <td>Axelar</td>',
  '        <td>The interchain tokens registered on the XRP Ledger — WETH, WBTC, USDC, SHX and others</td>',
  '        <td>Its own registry, and it is the only route to the XRPL EVM sidechain and to Hedera.</td>',
  '      </tr>',
  '      <tr>',
  '        <td>THORChain</td>',
  '        <td>XRP only</td>',
  '        <td>Overlaps NEAR Intents on ten chains and adds Cosmos Hub. Swaps into the destination',
  '          chain’s native coin.</td>',
  '      </tr>',
  '    </tbody>',
  '  </table>',
  '</div>',
  '',
  '<p>Thirty-nine destinations in total. Each route publishes its own list and LumosCore reads all three',
  '  live, so the picker cannot offer a route that has since been withdrawn.</p>',
  '',
  h2('how-a-route-is-chosen', 'How a route is chosen'),
  '',
  '<p>Where more than one route can carry a transfer, <strong>all of them are asked for a live quote and',
  '  the one that delivers more is used</strong>. Neither is reliably better — on the first pairs measured,',
  '  THORChain beat NEAR Intents to Bitcoin and lost to it on Ether and Dogecoin — so preferring one by',
  '  rule would mean choosing the worse answer about half the time.</p>',
  '',
  '<p>The comparison only runs when the two would deliver the <em>same thing</em>. NEAR Intents can be',
  '  asked for any token on a chain and THORChain quotes that chain’s native coin, and comparing',
  '  30 USDC against 0.0027 ETH is not a comparison.</p>',
  '',
  '<p>An asset only Axelar carries goes by Axelar, and the destination list narrows to Axelar’s the',
  '  moment you select one. The route that will carry your transfer is named on the review before you',
  '  sign, and you can choose a different one from the Route panel if you would rather.</p>',
  '',
  h2('making-a-transfer', 'Making a transfer'),
  '',
  '<ol class="dc-steps">',
  // CHAIN-QUALIFIED AT THE SOURCE, because _xrplroutes cannot reach it. That transform runs early in
  // the chain and this one runs near the end, so a bare route written here is injected after the
  // rewrite has already passed — it survived into the built pages as the only two bare /bridge links
  // left, each of which would land the reader on Stellar's bridge once both builds share a host.
  // Fixed here rather than by moving _xrplroutes later: the chain's order is load-bearing in three
  // places it documents, and reordering it to catch one link is the larger risk.
  '  <li>Open <a href="/bridge/xrpl">Cross-chain</a> and choose the destination network.</li>',
  '  <li>Pick the asset and amount, and enter the receiving address on that network.</li>',
  '  <li>Check the Route panel: it names the route, what will arrive, the fee and the estimated time.</li>',
  '  <li>Review and sign one XRP Ledger payment. That signature is the whole transfer.</li>',
  '</ol>',
  '',
  '<div class="dc-note">',
  '  <p class="dc-note-h">There is nothing to claim</p>',
  '  <p>All three routes deliver to the address you gave. You do not need the destination chain’s gas',
  '    token, and there is no second signature. If you have used a burn-and-mint bridge before, this',
  '    is not one.</p>',
  '</div>',
  '',
  h2('if-you-close-the-tab', 'If you close the tab'),
  '',
  '<p>Once the payment is signed and submitted, the route carries it whether or not the page is open —',
  '  it is the XRP Ledger transaction that commits you, not the tab. Close it before signing and',
  '  nothing has happened and nothing is owed.</p>',
  '',
  '<p>If a transfer cannot be completed, NEAR Intents refunds to the same wallet that paid.</p>',
  '',
  h2('what-it-costs', 'What it costs'),
  '',
  '<ul>',
  '  <li><strong>LumosCore:</strong> <span class="dc-num">0.2%</span> of the amount, or',
  '    <span class="dc-num">0.1%</span> if you hold 250,000 LUMOS or more. Not charged on the Axelar',
  '    route, where the fee collector cannot hold the asset being sent.</li>',
  '  <li><strong>The route:</strong> NEAR Intents takes a solver fee, Axelar charges destination gas',
  '    quoted in XRP, and THORChain prices its swap into the amount you are quoted. All three are',
  '    shown before you sign.</li>',
  '  <li><strong>The XRP Ledger:</strong> a fraction of a drop, paid to the ledger, never to us.</li>',
  '</ul>',
  '',
  '<p>The figure on the review is what arrives, after all of it.</p>',
  '',
  h2('what-can-still-go-wrong', 'What can still go wrong'),
  '',
  '<p>Delegating the transport does not remove transport risk. Each of these networks is independent',
  '  infrastructure with its own operators and its own failure modes, and a route can refuse or halt —',
  '  THORChain stops trading on a chain from time to time, and the page says so rather than queueing',
  '  behind it. See <a href="https://lumoscore.com/docs/security">Security</a>.</p>',
  '',
  '<div class="dc-note dc-warn">',
  '  <p class="dc-note-h">Check the destination address</p>',
  '  <p>The address must be on the network you selected, and in that network’s own format — an',
  '    Ethereum address is not a Cosmos Hub address, and the XRPL EVM sidechain takes a',
  '    <span class="dc-num">0x</span> address rather than an <span class="dc-num">r</span> one.',
  '    Sending to an address you do not control is not reversible by anyone.</p>',
  '</div>',
].join('\n');

// The FAQ page, answer by answer. Keyed on the QUESTION as it currently reads, so a question already
// corrected is not matched again. Where the question itself is wrong it is replaced too --
// "What is Circle the bridge?" is a word-swap fossil, not a question anyone asked.
const QA = [
  ['Which networks does LumosCore support?', null,
    'Trading, liquidity pools and the token launchpad run on XRP Ledger mainnet. Cross-chain transfers '
    + 'reach thirty-nine other networks through three routes: NEAR Intents, Axelar and THORChain.'],
  ['How do I bridge assets to or from the XRP Ledger?', null,
    'Choose the destination network and the amount, enter the receiving address, then review and sign '
    + 'one XRP Ledger payment. LumosCore picks the route — where two can carry the transfer, both are '
    + 'quoted and the one that delivers more is used — and names it on the review before you sign.'],
  ['Do I have to claim the USDC on the other side?', 'Do I have to claim anything on the other side?',
    'No. All three routes deliver to the address you gave, with no second signature and no gas needed '
    + 'on arrival. That is different from a burn-and-mint bridge, where you redeem on the destination '
    + 'chain yourself; nothing here works that way.'],
  ['What if I close the tab before claiming?', 'What if I close the tab?',
    'Once the payment is signed and submitted, the route carries it whether or not the page is open. '
    + 'Close it before signing and nothing has happened. If a transfer cannot be completed, NEAR '
    + 'Intents refunds to the same wallet that paid.'],
  ['What is Circle the bridge?', 'Which bridges does LumosCore use?',
    'Three. NEAR Intents moves XRP to thirty-five networks and delivers the chain’s own token rather '
    + 'than a wrapped copy. Axelar moves the interchain tokens registered on the XRP Ledger, and is '
    + 'the only route to the XRPL EVM sidechain and to Hedera. THORChain overlaps the first on ten '
    + 'chains and adds Cosmos Hub.'],
  ['Which chains are supported?', null,
    'Thirty-nine destinations, including Bitcoin, Ethereum, Solana, Cardano, TON, Tron, Cosmos Hub and '
    + 'Stellar. The lists come from each route’s own registry and are read live, so none of them can '
    + 'go stale.'],
  ['What are the cross-chain fees?', null,
    'LumosCore takes 0.2% of the amount you bridge, or 0.1% if you hold 250,000 LUMOS or more. Each '
    + 'route charges its own cost on top — a solver fee, destination gas, or a swap rate — and all of '
    + 'it is shown before you sign. The figure on the review is what arrives.'],
  ['Can I bridge my own XRP Ledger token?', null,
    'Only if Axelar has registered it as an interchain token; that route carries the assets on its own '
    + 'registry and nothing else. NEAR Intents and THORChain both take XRP alone. List your asset and '
    + 'give it a pool, and anyone bridging in can swap straight into it.'],
];

// Sentences that are wrong wherever they appear. Whole claims, not words.
const FACTS = [
  ['A cross-chain bridge to 14 other networks is',
    'A cross-chain bridge to thirty-nine other networks is'],
  ['Cross-chain routes run through Axelar, which connects the XRP Ledger to 58 other networks.',
    'Cross-chain routes run through NEAR Intents, Axelar and THORChain, which together reach '
    + 'thirty-nine other networks.'],
  ['<strong>Burned, not yet attested.</strong> Transfers are not enabled from this page yet, so there is nothing in progress to wait for.',
    '<strong>Signed, not yet delivered.</strong> The route is carrying it. Each one publishes its own '
    + 'estimate and the review showed it before you signed; NEAR Intents and THORChain are usually '
    + 'well under a minute, Axelar a few minutes.'],
  ['<strong>Attested, not claimed.</strong> The claim is a transaction on the destination chain and\r\n    you need that chain\'s gas token to pay for it.',
    '<strong>Delivered, but not where you expected.</strong> Check the receiving address you entered '
    + 'against the destination network. Nothing here is claimed, so an address is the only thing you '
    + 'supply that a route cannot check for you.'],
  ['<strong>Attested, not claimed.</strong> The claim is a transaction on the destination chain and\n    you need that chain\'s gas token to pay for it.',
    '<strong>Delivered, but not where you expected.</strong> Check the receiving address you entered '
    + 'against the destination network. Nothing here is claimed, so an address is the only thing you '
    + 'supply that a route cannot check for you.'],
];

let files = 0, pages = 0, cross = 0, qas = 0, facts = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;
  let changed = false;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    const before = h;

    // ---- docs/cross-chain: the whole article ---------------------------------------------------
    if (/docs-cross-chain/.test(key)) {
      h = h.replace(/(<p class="dc-sub">)([\s\S]*?)(<\/p>)/, function (m0, o, body, c) {
        return body === SUB ? m0 : (o + SUB + c);
      });
      // Between the end of .dc-head and the pager. Both anchors are the design's own and neither is
      // written by this file, so a re-run finds the same two points.
      const head = h.indexOf('<div class="dc-head">');
      const pager = h.indexOf('<div class="dc-pager">');
      if (head >= 0 && pager > head) {
        const headEnd = h.indexOf('</div>', h.indexOf('</p></div>', head)) + '</div>'.length;
        const cut = h.indexOf('</p></div>', head);
        if (cut > 0 && cut < pager) {
          const start = cut + '</p></div>'.length;
          if (h.slice(start, pager) !== CROSS) {
            h = h.slice(0, start) + CROSS + h.slice(pager);
            cross++;
          }
        }
      }
    }

    // ---- docs/faq: one answer at a time --------------------------------------------------------
    for (const [q, newQ, a] of QA) {
      const i = h.indexOf('<summary>' + q + '</summary>');
      if (i < 0) continue;
      const open = h.indexOf('<p>', i);
      const close = h.indexOf('</p>', open);
      if (open < 0 || close < 0 || open > i + 200) continue;
      const rebuilt = '<summary>' + (newQ || q) + '</summary>'
        + h.slice(i + ('<summary>' + q + '</summary>').length, open + 3) + a;
      const orig = h.slice(i, close);
      if (rebuilt === orig) continue;
      h = h.slice(0, i) + rebuilt + h.slice(close);
      qas++;
    }

    // ---- whole claims, wherever they sit -------------------------------------------------------
    for (const [from, to] of FACTS) {
      if (h.indexOf(from) < 0) continue;
      h = h.split(from).join(to);
      facts++;
    }

    if (h !== before) { json[key] = h; pages++; changed = true; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl bridge docs: ' + pages + ' page key(s) across ' + files + ' container(s) — '
  + cross + ' cross-chain article(s), ' + qas + ' FAQ answer(s), ' + facts + ' claim(s)');
