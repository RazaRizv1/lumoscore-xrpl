// Keep every page's FAQ structured data identical to the FAQ the page actually shows.
//
// WHY THIS EXISTS. Every page carries a schema.org FAQPage block in
// `<script type="application/ld+json" id="lx-faq-ld">`, duplicating its visible questions and
// answers. Search engines read that block DIRECTLY — it is published content, not a hint — and every
// copy pass in this project rewrites visible markup while deliberately refusing to touch script
// bodies (see the note at the top of _xrplcopy2.js: script text is logic and ledger data, and a
// blanket rewrite there is how a real token coded XLM gets mangled).
//
// The consequence is a class of bug, not one bug: correct a wrong-chain sentence on the page and the
// structured data keeps publishing the old one, and the two then DISAGREE — which is worse than
// either being wrong alone, because the version Google quotes is the one nobody can see.
//
// It was found on the site ROOT, whose FAQPage block was still telling search engines the LumosCore
// MCP server "exposes Stellar market data" and invited readers to "Ask an AI assistant about Stellar
// asset prices" — on an XRP Ledger site.
//
// _xrplbridgecopy.js already solved this for the five bridge pages by regenerating their block from
// the visible questions. This does the same thing for EVERY page, so no future copy fix can leave
// structured data behind.
//
// RUNS LAST, after every copy pass, because it copies whatever the page finally says. Its position
// in the chain is load-bearing: run before a copy pass and it would faithfully republish the text
// that pass is about to correct.
//
// It is a MIRROR, not an author: it never invents a question and never rewrites an answer. A page
// whose FAQ markup it cannot parse is reported and left EXACTLY as it was, because silently emptying
// real structured data is a worse failure than leaving it stale.
//
// The one thing it deletes is an ORPHAN — a FAQPage block on a page carrying no FAQ markup at all.
// The account pages had one, publishing three questions about adding liquidity to a pool. See the
// note at the `!pairs.length` branch for why that is a removal rather than a rewrite.
//
// Idempotent by construction: the output is a pure function of the visible markup, so a second run
// over unchanged input produces byte-identical JSON.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// Same extraction _xrplbridgecopy proved on the bridge pages. The bounded `{0,300}` gaps matter:
// an unbounded `[\s\S]*?` would happily pair question 1 with answer 7 on a page where one question
// has no answer paragraph, which is precisely the sort of quiet mismatch this file exists to stop.
const PAIR = /<h3 class="lx-faq-q"[^>]*>([\s\S]{0,300}?)<\/h3>[\s\S]{0,300}?<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
const BLOCK = /(<script type="application\/ld\+json" id="lx-faq-ld">)([\s\S]*?)(<\/script>)/;

const text = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

let files = 0, pages = 0, rebuilt = 0, unchanged = 0;
const skipped = [], orphans = [];

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
    if (!BLOCK.test(h)) continue;                    // no structured FAQ on this page
    pages++;

    const pairs = [];
    PAIR.lastIndex = 0;
    let m;
    while ((m = PAIR.exec(h))) {
      const q = text(m[1]), a = text(m[2]);
      if (q && a) pairs.push({ q, a });
    }

    // NOTHING PARSED. Two very different situations, and conflating them would be a bug either way:
    //
    //   * The page has FAQ markup this regex could not pair. That is a PARSER GAP — the page has a
    //     real FAQ, and rewriting or deleting its structured data on the strength of a failed match
    //     would destroy something correct. Left exactly as it was, and reported so it gets looked at.
    //
    //   * The page has NO FAQ markup at all, yet still ships a FAQPage block. That is an ORPHAN,
    //     inherited from whichever page the design copied: the account pages publish three questions
    //     about ADDING LIQUIDITY TO A POOL — "How do I add liquidity to this pool?" — which appear
    //     nowhere on an account page. Google requires FAQ structured data to be content the visitor
    //     can actually see, so this is not merely untidy, it is markup that should not be published.
    //     Removed, because there is nothing on the page to mirror and no honest version of it.
    if (!pairs.length) {
      if (/class="[^"]*faq[^"]*"/.test(h)) { skipped.push(key); continue; }
      const was = h;
      h = h.replace(BLOCK, '');
      if (h !== was) { json[key] = h; orphans.push(key); changed = true; }
      continue;
    }

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: pairs.map((p) => ({
        '@type': 'Question', name: p.q,
        acceptedAnswer: { '@type': 'Answer', text: p.a },
      })),
    };

    const before = h;
    h = h.replace(BLOCK, (m0, open, body, close) => open + JSON.stringify(ld) + close);
    if (h === before) { unchanged++; continue; }
    json[key] = h;
    rebuilt++;
    changed = true;
  }

  if (changed) {
    // </ inside a JSON string would close the container's own script tag when the file is parsed.
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl faq structured data: ' + pages + ' page key(s) with a block across ' + files
  + ' container(s) — ' + rebuilt + ' rebuilt, ' + unchanged + ' already in sync');
if (orphans.length) {
  console.log('   removed ' + orphans.length + ' ORPHAN block(s) — a FAQPage on a page with no FAQ: '
    + orphans.slice(0, 4).join(', '));
}
if (skipped.length) {
  console.log('   ! ' + skipped.length + ' page key(s) have a block but no parseable visible FAQ '
    + '— left untouched: ' + skipped.slice(0, 4).join(', '));
}
