// Document all fourteen MCP tools, not ten.
//
// Audit item 40. The page's heading read "Ten commands, one server" and the page was NOT lying about
// its own contents — it listed exactly ten. The defect is that the server exposes FOURTEEN, so four
// of its capabilities were undocumented anywhere a reader or an agent would look:
//
//   get_orderbook   list_curated_assets   list_blog_posts   get_blog_post
//
// Counted from the server's own source, `C:\LumosCore\mcp\tools.js` — 14 `name:` entries — and the
// server is SHARED: combine_with_stellar.js copies Stellar's `mcp/` directory into the deploy, so
// /mcp/xrpl and /mcp are backed by the same fourteen tools. Stellar's page says "Fourteen tools, one
// server" and lists all of them; this build's page is the one that was behind.
//
// After this the split matches Stellar's exactly: 9 read + 5 write = 14.
//
// THE COPY IS STELLAR'S, EXCEPT WHERE STELLAR'S WOULD BE FALSE HERE. Three of the four are lifted
// verbatim from Stellar's cards — they describe the same shared tool and there is no reason to write
// a second description of it. The fourth is `list_curated_assets`, where Stellar says "Every asset
// LumosCore curates, and why each one is ticked". That is true on Stellar and NOT true here: this
// build has no curated list at all — the tick is the top 100 by 24h volume with LUMOS pinned, RAZA's
// decision of 2026-10-07 — and the launchpad mints are explicitly not curated. So that one is
// reworded to describe what this chain actually does.
//
// NOTE FOR RAZA, and the reason this file does not go further: the four tools are documented here
// because the server exposes them, but their behaviour against XRPL data has not been exercised in
// this session. `get_orderbook` and the two blog tools are chain-neutral or plainly fine;
// `list_curated_assets` is the one worth a live check, since what it returns for this chain depends
// on a curated set that does not exist here.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');

const B = String.fromCharCode(92);

// get_market's own icon and markup, copied so a new card is indistinguishable from an original.
const ICON = '<span class="cic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'
  + '</svg></span>';

const card = (name, desc) => '<div class="cmd2 read">' + ICON + '<div class="cbody"><code>' + name
  + '</code><div class="cd">' + desc + '</div></div><span class="ctag"></span></div>';

const NEW = [
  ['get_orderbook', 'Bids, asks, spread and real depth against XRP.'],
  ['list_curated_assets', 'Which assets carry a tick, and the launchpad mints alongside them.'],
  ['list_blog_posts', 'Every LumosCore blog post, with tags and categories.'],
  ['get_blog_post', 'Read one post in full, as plain text.'],
];

// The last card on the page. Unique: no other card carries this description.
const AFTER = '<div class="cd">Live price, volume, and trend for any listed asset.</div></div>'
  + '<span class="ctag"></span></div>';

const HEAD_FROM = '<h2>Ten commands, <span class="g">one server</span></h2>';
const HEAD_TO = '<h2>Fourteen tools, <span class="g">one server</span></h2>';
const EYE_FROM = '<div class="k">Commands</div>';
const EYE_TO = '<div class="k">Tools</div>';

// ---- the hero's setup instruction, which pointed at a package that does not exist ---------------
//
// The page's one call to action was `npm i -g @lumoscore/mcp`, in a copy-to-clipboard pill. That
// package is NOT PUBLISHED — the npm registry returns 404 for it — so the only thing the page told
// anyone to do could not be done.
//
// The real integration is a remote url, and it is verified: POSTing tools/list to
// https://lumoscore.com/mcp answers with all fourteen tools. One server backs both chains (combine
// copies Stellar's `mcp/` directory into the deploy), so this is the same endpoint Stellar's page
// publishes — which is also where the replacement markup comes from, character for character: the
// same `lxh-install` pill, with a `›` instead of the shell `$`, because a url is not a command.
// MATCHED BY SHAPE, NOT BY ITS OLD CONTENTS, and that is not defensive programming — it is required.
//
// The first version of this looked for the literal npm command. It replaced it, and the next
// `rebuild.js` broke it again: `_xrplroutes` runs EARLY in the chain and its table maps
// "https://lumoscore.com/mcp" -> "/mcp", then its BARE list turns "/mcp" into "/mcp/xrpl". So the url
// this file had just written came back as a relative path, the literal no longer matched, and nothing
// restored it. The result was a pill whose visible text read https://lumoscore.com/mcp while the copy
// button put "/mcp/xrpl" on the clipboard — useless in an MCP client, and invisible on screen.
//
// Rewriting the whole pill by shape each run is self-healing: whatever `_xrplroutes` did to the
// attribute earlier in the chain, this puts it back, and it is a no-op once the values are right.
const PILL_RE = /<div class="lxh-install" data-copy="[^"]*"><span class="p">[^<]*<\/span><code>[^<]*<\/code>/g;
const PILL_TO = '<div class="lxh-install" data-copy="https://lumoscore.com/mcp">'
  + '<span class="p">&#8250;</span><code>https://lumoscore.com/mcp</code>';

// ---- the three questions this page was missing --------------------------------------------------
//
// Audit item 39: Stellar's MCP page answers six, this one answered three. The three absent topics
// are all about using the thing — how to connect, what it can see, what it costs — which is why
// they were parked until the connect instruction above was known to be wrong, rather than written
// against a dead npm command.
//
// Adapted from Stellar's wording, with every fact checked against this build: the endpoint is the
// one verified above, and the fee line is this platform's own rate (0.2%, 0.1% from 250,000 LUMOS,
// limit orders free).
const FAQ_ANCHOR = 'but cannot authorise one.</p></div>';
const NEW_FAQ = [
  ['How do I connect it?',
    'Point any MCP client at https://lumoscore.com/mcp. There is nothing to install and no API key: '
    + 'it is a remote server, so a paste is the whole setup. Claude, ChatGPT, Cursor and VS Code all '
    + 'speak it.'],
  ['What can it see?',
    'Only what is already public on the ledger. It reads balances, offers and pool positions for any '
    + 'address you name, the same way an explorer does. It never sees your keys, and it is not '
    + 'connected to your wallet.'],
  ['Does it cost anything?',
    'No. The connector is free and unauthenticated. Trades placed through the links it prepares pay '
    + 'the ordinary LumosCore fee of 0.2%, or 0.1% if you hold 250,000 LUMOS, and limit orders are '
    + 'free.'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const faqItem = (q, a) => '<div class="lx-faq-item"><h3 class="lx-faq-q">' + esc(q)
  + '</h3><p class="lx-faq-a">' + esc(a) + '</p></div>';

// The schema block is regenerated from what the page NOW SAYS, not from the list above.
//
// This file runs after _xrplfaqld in the chain — it has to, because _xrplchainswitch rebuilds page
// keys and would undo the cards — so nothing downstream will mirror these three into the structured
// data. Doing it here is what stops this page acquiring the exact fault the audit found on Stellar's
// account page: a FAQPage block that disagrees with the questions on screen.
function syncFaqLd(h) {
  const pairs = [];
  const re = /<h3 class="lx-faq-q"[^>]*>([\s\S]{0,300}?)<\/h3>[\s\S]{0,300}?<p class="lx-faq-a"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(h))) {
    pairs.push({
      q: m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      a: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    });
  }
  if (!pairs.length) return h;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question', name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a },
    })),
  };
  return h.replace(/(<script type="application\/ld\+json" id="lx-faq-ld">)([\s\S]*?)(<\/script>)/,
    (m0, open, body, close) => open + JSON.stringify(ld) + close);
}

const problems = [];
const staged = [];
let added = 0, heads = 0, eyes = 0, already = 0, pills = 0, faqs = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  if (!fs.existsSync(file)) { problems.push(file + ': missing'); continue; }
  const data = read(file);
  let json, s, e;
  try { ({ json, s, e } = getContents(data)); } catch (err) { problems.push(file + ': ' + err.message); continue; }

  let touched = 0;
  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (h.indexOf('id="mcp-tools"') < 0) continue;
    const before = h;

    // Idempotence: the first new tool's code element is the marker.
    if (h.indexOf('<code>get_orderbook</code>') >= 0) { already++; } else {
      if (h.indexOf(AFTER) < 0) { problems.push(key + ': the get_market card moved — cannot place the new cards'); continue; }
      h = h.replace(AFTER, AFTER + NEW.map((p) => card(p[0], p[1])).join(''));
      added += NEW.length;
    }
    if (h.indexOf(HEAD_FROM) >= 0) { h = h.split(HEAD_FROM).join(HEAD_TO); heads++; }
    if (h.indexOf(EYE_FROM) >= 0) { h = h.split(EYE_FROM).join(EYE_TO); eyes++; }

    // The dead install command, and whatever _xrplroutes made of it since.
    if (PILL_RE.test(h)) {
      PILL_RE.lastIndex = 0;
      const was = h;
      h = h.replace(PILL_RE, PILL_TO);
      if (h !== was) pills++;
    }
    PILL_RE.lastIndex = 0;

    // The three missing questions, then the schema brought back in line with the page.
    if (h.indexOf('lx-faq-q') >= 0 && h.indexOf('How do I connect it?') < 0) {
      if (h.indexOf(FAQ_ANCHOR) < 0) {
        problems.push(key + ': the last FAQ item moved — cannot place the three new questions');
      } else {
        h = h.split(FAQ_ANCHOR).join(FAQ_ANCHOR + NEW_FAQ.map((p) => faqItem(p[0], p[1])).join(''));
        faqs += NEW_FAQ.length;
      }
    }
    if (h.indexOf('id="lx-faq-ld"') >= 0) h = syncFaqLd(h);

    if (h !== before) { json[key] = h; touched++; }
  }
  staged.push({ file, data, s, e, json, touched });
}

// The page must end up claiming fourteen and listing fourteen. Checked rather than assumed, because
// the whole point of this file is that a heading and a card count had drifted apart unnoticed.
if (!problems.length) {
  for (const st of staged) {
    for (const key of Object.keys(st.json)) {
      const h = st.json[key];
      if (typeof h !== 'string' || h.indexOf('id="mcp-tools"') < 0) continue;
      const n = (h.match(/<div class="cmd2 (?:read|write)">/g) || []).length;
      if (n !== 14) problems.push(key + ': ' + n + ' command card(s) after the pass, expected 14');
      if (h.indexOf(HEAD_TO) < 0) problems.push(key + ': heading does not read "Fourteen tools"');
      if (h.indexOf('Ten commands') >= 0) problems.push(key + ': still says "Ten commands"');
    }
  }
}

if (problems.length) {
  console.error('xrpl mcp tools: ABORT — nothing written.');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

for (const st of staged) {
  if (!st.touched) continue;
  const ser = JSON.stringify(st.json).split('</').join('<' + B + '/');
  fs.writeFileSync(st.file, st.data.slice(0, st.s) + ser + st.data.slice(st.e), 'utf8');
}

console.log('xrpl mcp tools: ' + added + ' card(s) added, ' + heads + ' heading(s) and ' + eyes
  + ' label(s) corrected, ' + pills + ' install pill(s), ' + faqs + ' FAQ item(s) added' + (already ? ' (' + already + ' page(s) already had the four)' : ''));
