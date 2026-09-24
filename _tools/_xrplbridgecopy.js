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

// Shaped like Stellar's, which names the asset flow and the provider in one line. The previous
// version ("See which networks the XRP Ledger can reach through Axelar. Route discovery only…")
// described a chain-list panel this page no longer has — that panel was invented UI and has been
// removed in favour of the design's own destination dropdown, so the subtitle describing it went
// with it. The second sentence stays: the wizard is real and the transfer is not wired.
// Both bridges are named (RAZA 2026-09-15: "If we're also using Wanchain bridge, so you should mention that as well").
const SUB = 'Bridge assets from the XRP Ledger to other networks through Axelar and Wanchain. '
  + 'Transfers are not enabled from this page yet.';

// Keyed by the FIRST WORDS of the question as it currently reads, so a question that has already
// been corrected is not matched twice and nothing is rewritten by position.
const FAQ = [
  {
    match: 'How do I bridge assets',
    q: 'How do I bridge assets to or from the XRP Ledger?',
    a: 'Not from this page yet. LumosCore currently shows which networks the XRP Ledger can reach '
      + 'through Axelar and Wanchain; picking a route does not move anything, and nothing here will ask you to '
      + 'approve a transaction. Bridging is still being built, and the page says so rather than '
      + 'offering a button that looks like it works.',
  },
  {
    match: 'Do I have to claim',
    q: 'Do I have to claim anything on the other side?',
    a: 'There is nothing to claim, because no transfer happens yet. The claim step you may have seen '
      + 'belongs to Circle’s CCTP on the Stellar build, where an asset is burned on one chain and '
      + 'redeemed on the other. Axelar and Wanchain routing do not work that way, and this answer will describe '
      + 'the real steps once a route can actually be executed.',
  },
  {
    match: 'What if I close the tab',
    q: 'What if I close the tab?',
    a: 'Nothing is stranded, because nothing is in flight. Looking up routes is read-only — no funds '
      + 'move and no transaction is signed, so there is no pending state to come back to.',
  },
  {
    match: 'What is Circle CCTP',
    q: 'What is Axelar?',
    a: 'An interchain network that connects blockchains to each other. LumosCore asks it which '
      + 'destinations are reachable from the XRP Ledger and lists them here. The list is fetched live '
      + 'rather than written into the page, so it cannot go stale and offer a route that has since '
      + 'been removed.',
  },
  {
    // The question this transform wrote earlier. Rewritten again so it names both bridges; once it reads
    // "What are Axelar and Wanchain?" neither this key nor the CCTP one matches, so a second run changes nothing.
    match: 'What is Axelar',
    q: 'What are Axelar and Wanchain?',
    a: 'Two interchain networks that connect blockchains to each other. LumosCore lists every destination '
      + 'Axelar reaches from the XRP Ledger, fetched live from its registry so it cannot go stale, together '
      + 'with Wanchain, whose bridge carries XRP to its own chain.',
  },
  {
    match: 'What are the cross-chain fees',
    q: 'What are the cross-chain fees?',
    a: 'None today, because no transfer takes place. When bridging is enabled the platform fee is the '
      + 'same as everywhere else on LumosCore: 0.2% of the amount, or 0.1% if you hold 250,000 LUMOS '
      + 'or more. Each chain’s own network fee is separate and is paid to that chain, never to us.',
  },
  {
    match: 'Can I bridge my own',
    q: 'Can I bridge my own XRP Ledger token?',
    a: 'Not while transfers are off — no asset can be bridged from this page yet. Which assets a '
      + 'route carries is decided by Axelar or Wanchain, so the honest answer for any particular token has to '
      + 'wait until that route can be quoted.',
  },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let files = 0, pages = 0, subs = 0, qas = 0, lds = 0;

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
          out += rest.slice(0, at) + m[1] + esc(item.q) + m[3] + m[4] + m[5] + esc(item.a) + m[7];
          rest = rest.slice(at + m[0].length);
          qas++; touched++;
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

console.log('xrpl bridge copy: ' + pages + ' page key(s) across ' + files + ' container(s) — '
  + subs + ' subtitle(s), ' + qas + ' FAQ answer(s), ' + lds + ' structured-data block(s)');
if (!pages) console.error('  ! no bridge page matched — nothing was rewritten');
