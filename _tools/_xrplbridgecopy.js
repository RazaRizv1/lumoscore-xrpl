// Make the Bridge page's WORDS say what the page actually does.
//
// The data layer on this page was replaced weeks ago — it lists the networks Axelar can reach from
// the XRP Ledger, fetched live, and states plainly that transfers are not enabled. The COPY around
// it was never touched, so the page simultaneously said both of these things:
//
//   subtitle: "Bridge USDC natively across chains with Circle CCTP — burn on Stellar, mint on the
//             destination."
//   FAQ:      "Do I have to claim the USDC on the other side?" · "What is Circle CCTP?" ·
//             "LumosCore takes 0.2% ... Circle charges nothing for CCTP itself."
//
// That is the wrong bridge, the wrong protocol and the wrong source chain, on a page about moving
// money — and it promised a burn-and-redeem flow that does not exist here at all.
//
// IT IS ALSO INDEXED. The same seven questions are duplicated into a schema.org FAQPage block
// (lx-faq-ld) that search engines read directly, so the claim "LumosCore bridges USDC from Stellar
// via Circle CCTP" was being published as structured data about an XRP Ledger page. Rewriting the
// visible copy alone would have left that behind, and the two would then disagree — which is worse
// than either being wrong on its own.
//
// So both are written from ONE source: the table below. The JSON-LD is REGENERATED from the visible
// questions after the rewrite rather than edited in parallel, which is what makes them impossible to
// drift apart.
//
// Question 5 ("Which chains are supported?") is deliberately left alone — it was already correct.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// Shaped like Stellar's, which names the asset flow and the provider in one line.
//
// WHAT THIS REPLACED, AND WHY IT MATTERED (RAZA 2026-09-29, "its nothing like that we've updated on
// Stellar"). It read:
//
//   "Bridge assets from the XRP Ledger to other networks through Axelar and Wanchain.
//    Transfers are not enabled from this page yet."
//
// Both halves were false by the time he read them. WANCHAIN WAS NEVER BUILT — it was investigated and
// dropped (470 pairs, not one of them XRPL), so the page was naming a route that has never existed.
// And transfers ARE enabled: NEAR Intents, Axelar and THORChain all quote and all send. A bridge
// telling people it cannot move money, over three routes that move money, is the worst direction for
// this particular page to be wrong in — it costs a user nothing to believe and everything to act on.
//
// The copy lagged because it lives in a transform of its own, and the route work never came back to
// it. Nothing structural prevents that happening again; what helps is that all four places the claim
// appears (subtitle, FAQ, the indexed JSON-LD, and the "How it works" dialog in browser/bridgehiw.js)
// now say the same thing, so a future drift is visible on the page rather than only in a script body.
const SUB = 'Bridge XRP to thirty-nine networks with NEAR Intents or THORChain, or move an Axelar '
  + 'interchain token to where Axelar reaches — whichever route pays out more.';

// Keyed by the FIRST WORDS of the question as it currently reads, so a question that has already
// been corrected is not matched twice and nothing is rewritten by position.
const ROUTES_Q = 'Which bridges does LumosCore use here?';
const ROUTES_A = 'Three, and they are good at different things. NEAR Intents moves XRP to thirty-five '
  + 'networks and delivers the chain’s own token rather than a wrapped copy. Axelar moves the '
  + 'interchain tokens registered on the XRP Ledger, and is the only route to the XRPL EVM sidechain '
  + 'and to Hedera. THORChain overlaps the first on ten chains and adds Cosmos Hub, so where both can '
  + 'carry a transfer both are asked and the better price wins.';

// EVERY ANSWER BELOW STATES ONLY WHAT THE PAGE DOES. That is the same rule the earlier version
// followed and the reason it was honest while the routes were unbuilt; what changed is the page, not
// the rule. Where a route's behaviour differs from the others the answer says which one it is talking
// about, because "the bridge" now means three different mechanisms and a sentence true of one of them
// is not automatically true of the rest.
//
// SOME KEYS MATCH COPY THIS TRANSFORM ITSELF WROTE EARLIER. They are kept rather than replaced: a
// container rebuilt from the Stellar base carries the CCTP wording, a container rebuilt from here
// carries the Axelar/Wanchain wording, and both have to converge on the same end state. The entries
// run in order, so an early key can hand its output to a later one within a single pass.
const FAQ = [
  {
    match: 'How do I bridge assets',
    q: 'How do I bridge assets to or from the XRP Ledger?',
    a: 'Pick a destination and an amount, then review and sign one XRP Ledger payment. LumosCore '
      + 'chooses the route for you: NEAR Intents and THORChain both quote XRP to most destinations '
      + 'and whichever delivers more is the one used, while an Axelar interchain token you already '
      + 'hold goes by Axelar. The route that will carry it is named on the review before you sign.',
  },
  {
    match: 'Do I have to claim',
    q: 'Do I have to claim anything on the other side?',
    a: 'No. All three routes deliver to the address you give, with no second signature and no gas '
      + 'needed on arrival. That is different from Circle’s CCTP on the Stellar build, where an asset '
      + 'is burned on one chain and you redeem it on the other; nothing here works that way.',
  },
  {
    match: 'What if I close the tab',
    q: 'What if I close the tab?',
    a: 'Once the payment is signed and submitted, the route carries it whether or not the page is '
      + 'open — it is the XRP Ledger transaction that commits you, not the tab. If you close it '
      + 'before signing, nothing has happened and nothing is owed. NEAR Intents refunds to the same '
      + 'wallet that paid if a transfer cannot be completed.',
  },
  // THREE KEYS, ONE ANSWER. This question has been rewritten twice before, so three different
  // sentences can be sitting in a container depending on when it was last built — the inherited
  // "What is Circle CCTP?", this transform's "What are Axelar and Wanchain?", and the current one.
  // Each key writes the SAME final text rather than handing a placeholder to the next entry: a chain
  // of rewrites only converges if every link runs, and the first version of this shipped a literal
  // "placeholder" if the second key ever failed to match.
  { match: 'What is Circle CCTP', q: ROUTES_Q, a: ROUTES_A },
  { match: 'What are Axelar', q: ROUTES_Q, a: ROUTES_A },
  { match: 'Which bridges does LumosCore use', q: ROUTES_Q, a: ROUTES_A },
  {
    // LEFT ALONE UNTIL NOW BECAUSE IT WAS RIGHT. It no longer is: it said the XRP Ledger reaches "58
    // other networks through Axelar" and that transfers were off. Both numbers and the claim were
    // written for the route-discovery panel.
    match: 'Which chains are supported',
    q: 'Which chains are supported?',
    a: 'Thirty-nine destinations. NEAR Intents reaches thirty-five of them — including Bitcoin, '
      + 'Ethereum, Solana, Cardano, TON, Tron and Stellar — and carries XRP only. Axelar carries the '
      + 'interchain tokens registered here, and reaches the XRPL EVM sidechain and Hedera, which '
      + 'nothing else on this page does. THORChain adds Cosmos Hub. The lists are fetched live from '
      + 'each network rather than written into the page, so none of them can go stale.',
  },
  {
    match: 'What are the cross-chain fees',
    q: 'What are the cross-chain fees?',
    a: 'LumosCore takes 0.2% of the amount, or 0.1% if you hold 250,000 LUMOS or more — the same rate '
      + 'as everywhere else on the site. Each route charges its own cost on top and each is shown '
      + 'before you sign: NEAR Intents takes a solver fee, Axelar charges destination gas quoted in '
      + 'XRP, and THORChain prices its swap into the amount you are quoted. The XRP Ledger’s own '
      + 'transaction fee is a fraction of a drop and is paid to the ledger, never to us.',
  },
  {
    match: 'Can I bridge my own',
    q: 'Can I bridge my own XRP Ledger token?',
    a: 'Only if Axelar has registered it as an interchain token — that route carries the assets on '
      + 'its own registry, such as WETH, WBTC, USDC and SHX, and nothing else. NEAR Intents and '
      + 'THORChain both take XRP alone. So an arbitrary issued token cannot be bridged from this '
      + 'page, and the destination list narrows to Axelar’s the moment you select one that can.',
  },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// `seen` is page keys this transform RECOGNISED; `pages` is the ones it had to change. They differ on
// every re-run of a settled container, and telling them apart is what stops the warning below from
// crying wolf once the copy is correct.
let files = 0, pages = 0, seen = 0, subs = 0, qas = 0, lds = 0;

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
    // THE SAME FAQ IS ON MORE THAN THE BRIDGE PAGE. Guarding on the bridge hero left the identical
    // seven questions — "What is Circle CCTP?", the burn-and-redeem answers — on the LANDING page,
    // which is the most public page there is and the one search engines weight most, and on the
    // -dark variants. So the subtitle is still keyed to the hero, but the FAQ rewrite runs anywhere
    // those questions appear.
    const hasHero = h.indexOf('br-hero') >= 0 || h.indexOf('Cross-Chain Bridge') >= 0;
    const hasFaq = h.indexOf('lx-faq-q') >= 0 && /CCTP|claimable|burn/i.test(h);
    if (!hasHero && !hasFaq) continue;
    seen++;
    let touched = 0;

    // ---- subtitle ------------------------------------------------------------------------------
    h = h.replace(/(<div class="sub">)([\s\S]*?)(<\/div>)/, function (m0, open, body, close) {
      // ALREADY-APPLIED IS THE ONLY THING THIS SHOULD SKIP, and the gate has to say so directly.
      // It used to test only for the words it was replacing (CCTP / "USDC natively"), which made it
      // a one-way door: once this transform had run, its own output no longer matched, so changing
      // SUB later silently did nothing and the build cheerfully reported "0 subtitle(s)". Same shape
      // as the hand-written skip-gates that quietly disabled correct rules three times on this fork.
      //
      // Now: skip only when the text is already exactly what we want, and otherwise recognise both
      // the inherited Stellar copy and anything this transform wrote before.
      if (body === esc(SUB)) return m0;
      if (!/CCTP|USDC natively|Axelar/i.test(body)) return m0;
      subs++; touched++;
      return open + esc(SUB) + close;
    });

    // ---- the FAQ pairs -------------------------------------------------------------------------
    for (const item of FAQ) {
      const re = new RegExp(
        '(<h3 class="lx-faq-q"[^>]*>)([\\s\\S]{0,200}?)(<\\/h3>)([\\s\\S]{0,300}?)(<p class="lx-faq-a"[^>]*>)([\\s\\S]*?)(<\\/p>)');
      // Scan pair by pair so the match is anchored to the RIGHT question, not the first one.
      let idx = 0, out = '', rest = h, done = false;
      while (!done) {
        const m = re.exec(rest);
        if (!m) break;
        const qText = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const at = m.index;
        if (qText.indexOf(item.match) === 0) {
          const rebuilt = m[1] + esc(item.q) + m[3] + m[4] + m[5] + esc(item.a) + m[7];
          out += rest.slice(0, at) + rebuilt;
          rest = rest.slice(at + m[0].length);
          // COUNT CHANGES, NOT MATCHES. Several keys deliberately match the text this transform
          // itself wrote, so a settled container still matches most of them — and the count then
          // reported "35 FAQ answer(s)" on a run that produced byte-identical output. A re-run that
          // looks like it rewrote the page is how a real idempotence bug gets waved through.
          if (rebuilt !== m[0]) { qas++; touched++; }
          done = true;
        } else {
          out += rest.slice(0, at + m[0].length);
          rest = rest.slice(at + m[0].length);
        }
        re.lastIndex = 0;
        idx++;
        if (idx > 40) break;                       // never loop on a page that does not match
      }
      if (done) h = out + rest;
    }

    // ---- the structured data, regenerated from what the page now SAYS --------------------------
    const pairs = [];
    const pre = /<h3 class="lx-faq-q"[^>]*>([\s\S]{0,300}?)<\/h3>[\s\S]{0,300}?<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
    let pm;
    while ((pm = pre.exec(h))) {
      pairs.push({
        q: pm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
        a: pm[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      });
    }
    if (pairs.length) {
      const ld = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: pairs.map(function (p) {
          return {
            '@type': 'Question', name: p.q,
            acceptedAnswer: { '@type': 'Answer', text: p.a },
          };
        }),
      };
      const before = h;
      h = h.replace(/(<script type="application\/ld\+json" id="lx-faq-ld">)([\s\S]*?)(<\/script>)/,
        function (m0, open, body, close) { return open + JSON.stringify(ld) + close; });
      if (h !== before) { lds++; touched++; }
    }

    if (touched) { json[key] = h; pages++; changed = true; }
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl bridge copy: ' + pages + ' of ' + seen + ' recognised page key(s) changed across '
  + files + ' container(s) — ' + subs + ' subtitle(s), ' + qas + ' FAQ answer(s), '
  + lds + ' structured-data block(s)');
if (!seen) console.error('  ! no bridge or FAQ page matched at all — nothing was rewritten');
