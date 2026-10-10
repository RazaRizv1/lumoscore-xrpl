// XRPL titles and meta descriptions.
//
// The containers arrived carrying Stellar's copy -- /wallet was telling search engines it was a
// "Stellar Wallet". Titles and descriptions are what gets indexed, so they are the one thing that has
// to be right before any of this is public.
//
// WRITTEN OUT, NOT FIND-AND-REPLACED. A regex over "Stellar" would produce sentences that are false
// rather than merely renamed:
//   * XLM is not a rename of XRP; the reserve model, the fee model and the amounts all differ
//   * "manage trustlines" happens to survive, because the XRP Ledger genuinely calls them trustlines
//   * "Stellar DEX" -> "XRP Ledger DEX" is fine, both are native on-ledger order books
//   * the AMM copy survives because the XRP Ledger has had AMMs since XLS-30
// So each string below is a decision, and anything not in the table is left ALONE rather than guessed
// at -- an untouched Stellar string is visible and fixable; a confidently wrong one is not.
//
// Idempotent: it writes exact values, so re-running changes nothing.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

// base page name (without -dark/-light/-mobile) -> [title, description]
const SEO = {
  'lumoscore-landing': [
    'LumosCore — Trade, Pool and Bridge on the XRP Ledger',
    'Trade tokens, provide liquidity and bridge assets on the XRP Ledger. Non-custodial: every transaction is signed in your own wallet.',
  ],
  'lumoscore-home': [
    'Dashboard — Your XRP Ledger Portfolio | LumosCore',
    // NAMES THE WALLETS, as Stellar's does ("Connect Freighter, Rabet, Albedo, xBull or
    // WalletConnect"). Somebody searching for "Xaman portfolio" should be able to match this. The
    // four are this build's own transports, read off the signin wallet grid.
    'Your XRP Ledger balances, trustlines, pools and recent activity in one place, priced live from '
      + 'the ledger. Connect Xaman, GemWallet, Crossmark or WalletConnect.',
  ],
  'lumoscore-wallet': [
    'XRP Ledger Wallet — Balances, Send and Receive | LumosCore',
    'View your XRP and token balances, send and receive, manage trustlines and swap on the XRP Ledger. Non-custodial — you sign every transaction yourself.',
  ],
  'lumoscore-dex': [
    'Trade on XRP Ledger DEX — Swap and Limit Orders | LumosCore',
    'Swap tokens and place limit orders on the XRP Ledger’s native order book, with live prices read straight from the ledger.',
  ],
  'lumoscore-dex-asset': [
    'XRP Ledger Token — Price, Order Book, Holders | LumosCore',
    'Live price, order book, holders and pools for any XRP Ledger token, with swap and limit orders on the same page.',
  ],
  'lumoscore-amm': [
    'XRP Ledger Liquidity Pools — TVL, Volume, Fees | LumosCore',
    'Browse every XRP Ledger AMM pool with live total value locked, 24h volume and fees earned. Add or withdraw liquidity, create a pool, and track your positions.',
  ],
  'lumoscore-amm-pool': [
    'XRP Ledger Pool — Liquidity, Volume and Fees | LumosCore',
    'Pool composition, TVL, volume and fees for an XRP Ledger AMM pool, with add and withdraw on the same page.',
  ],
  'lumoscore-account': [
    'XRP Ledger Account — Balances, Trust Lines and Activity | LumosCore',
    'Look up any XRP Ledger account: balances, trustlines, pool positions and transaction history, read live from the ledger.',
  ],
  'lumoscore-launch-token': [
    'Launch a Token on XRP Ledger — No Code Required | LumosCore',
    'Issue your own token on the XRP Ledger in minutes. Set the name, supply and metadata from the browser — no code and no contract to deploy.',
  ],
  'lumoscore-launch-review': [
    // "Launchpad" restored to both launch steps' titles, the way Stellar names them. These two are in
    // SITEMAP_SKIP so this is the browser tab rather than a search result, but a mid-flow tab that
    // does not name the product it is mid-flow in is the one a user loses among twenty others.
    'Review Your Token — XRP Ledger Launchpad | LumosCore',
    'Check the name, supply and metadata of your token before it is issued on the XRP Ledger.',
  ],
  'lumoscore-launch-confirm': [
    'Token Launched — XRP Ledger Launchpad | LumosCore',
    'Your token is live on the XRP Ledger. Share it, add liquidity, or trade it straight away.',
  ],
  'lumoscore-bridge': [
    // THE DIRECTION AND THE COUNT, both of which this title used to lose. It read "Bridge Assets to
    // the XRP Ledger", which is backwards: this page sends FROM this ledger to the 39 networks its
    // own description names, and it is the description a search result shows underneath. Shaped like
    // Stellar's ("Bridge Assets to 52 Chains from Stellar") so the two read as one product.
    'Bridge Assets to 39 Networks from the XRP Ledger | LumosCore',
    // Wanchain was never built -- investigated and dropped -- and this description was the LAST place
    // still naming it, after the subtitle, the FAQ, the JSON-LD and the "How it works" dialog were all
    // corrected. It is also the one a search result shows, so it was the copy most people would read.
    'Bridge XRP and issued tokens to 39 networks through NEAR Intents, Axelar or THORChain. One signature on the XRP Ledger, and nothing to claim at the far end.',
  ],
  'lumoscore-rewards': [
    'LUMOS Rewards on XRP Ledger — LP and Holders | LumosCore',
    'Earn LUMOS for providing liquidity and for holding on the XRP Ledger. Rewards are paid from the treasury on a fixed schedule.',
  ],
  'lumoscore-lumos-token': [
    'LUMOS on XRP Ledger — Price, Pools and Holders | LumosCore',
    // THE FEE DISCOUNT BELONGS HERE. The old line listed the page's fields and left out the only
    // reason to hold the token; Stellar's equivalent states it and this build dropped it. The figure
    // is this platform's own: 0.2% normally, 0.1% from 250,000 LUMOS, so "halves" is exact.
    'LUMOS is the LumosCore platform token on the XRP Ledger. See price, supply, holders and '
      + 'liquidity, and how holding 250,000+ LUMOS halves your trading fee.',
  ],
  'lumoscore-signin': [
    'Connect a Wallet | LumosCore',
    'Connect an XRP Ledger wallet to trade, pool and bridge. LumosCore never holds your keys.',
  ],

  // ---- THE DOCS, THE BLOG AND THE TWO REMAINING PAGES -------------------------------------------
  //
  // Ten base pages were still telling search engines this was a Stellar site — "The five supported
  // Stellar wallets", "Resting orders on the Stellar order book", "Issuing an asset on Stellar
  // mainnet", "$250, paid in XLM" — on pages marked index,follow. They were not wrong so much as
  // absent: this table only rewrites what it names, which is the right default, and nobody had
  // named them.
  //
  // The wording is taken from what each page's BODY now says, not invented here, so the description
  // and the page cannot describe different products. Where the body was already correct (connect a
  // wallet reads "The supported XRP Ledger wallets") the description simply matches it.
  //
  // TWO FIGURES ARE DELIBERATELY NOT REPEATED. The launch page's "flat $25 cost" is Stellar's price
  // and this build's is still test pricing, so the description says what it costs rather than a
  // number that is wrong today and wrong again after the next change. The wallet count is not
  // repeated either — this build supports two, the old copy claimed five, and a count in a meta
  // description is a hostage to the next wallet added.
  'lumoscore-blog': [
    'Blog — Guides and explainers | LumosCore',
    'Guides and explainers on trading, liquidity pools, cross-chain transfers and token issuance on the XRP Ledger, from the LumosCore team.',
  ],
  'lumoscore-blog-post': [
    'LumosCore Blog',
    'How a constant-product liquidity pool prices a trade on the XRP Ledger, what pool shares represent, and what to look at before depositing.',
  ],
  'lumoscore-docs-connect-a-wallet': [
    'Connect a wallet | LumosCore Docs',
    'The supported XRP Ledger wallets, how connecting works, and what the site can and cannot do.',
  ],
  'lumoscore-docs-cross-chain': [
    'Cross-chain | LumosCore Docs',
    'How LumosCore moves assets off the XRP Ledger through NEAR Intents, Axelar and THORChain — what each route carries, and what it costs.',
  ],
  'lumoscore-docs-launch-a-token': [
    'Launch a token | LumosCore Docs',
    'Issuing an asset on the XRP Ledger: the flow, what it costs and what you receive.',
  ],
  'lumoscore-docs-limit-orders': [
    'Limit orders | LumosCore Docs',
    'Resting orders on the XRP Ledger’s own order book, why they are free, and how to manage them.',
  ],
  'lumoscore-docs-swaps': [
    'Swaps | LumosCore Docs',
    'Trading assets on the XRP Ledger: routing, price, slippage and what you approve before signing.',
  ],
  'lumoscore-docs-trustlines': [
    'Trustlines | LumosCore Docs',
    'Why the XRP Ledger needs a trustline before you can hold an asset, and what it reserves.',
  ],
  'lumoscore-list-token': [
    'List Your Token — Curated XRP Ledger Listings | LumosCore',
    'Apply for a curated listing on LumosCore. $250, paid in XRP, refunded in full if the listing is declined. Reviewed by a person, not a script.',
  ],
  'lumoscore-mcp': [
    'LumosCore MCP — XRP Ledger DeFi for AI Agents | LumosCore',
    'Connect Claude and other AI assistants to the XRP Ledger via the Model Context Protocol. Query prices, pools and balances in natural language.',
  ],
};

const BASE = (k) => k.replace(/-(dark|light|mobile)\.html$/, '').replace(/\.html$/, '');

function setTitle(html, title) {
  const m = /<title>[\s\S]*?<\/title>/.exec(html);
  if (!m) return { html, ok: false };
  return { html: html.replace(m[0], '<title>' + title + '</title>'), ok: true };
}

function setDesc(html, desc) {
  // name="description" only. og: and twitter: descriptions are injected at the edge from this one.
  const re = /<meta[^>]*name=["']description["'][^>]*>/i;
  const m = re.exec(html);
  if (!m) return { html, ok: false };
  return { html: html.replace(m[0], '<meta name="description" content="' + desc.replace(/"/g, '&quot;') + '">'), ok: true };
}

// THE WALLET-GATED PAGES, which the fork inherited stamped "index, follow" and which nothing on this
// side was correcting. The containers are a copy of Stellar's BUILT output taken at one moment, so
// they carry whatever robots meta Stellar had then -- and Stellar only fixed this on 2026-10-10,
// after the copy. _xrplseo.js rewrote the TITLE of /dashboard and /wallet without touching the one
// tag that decides whether they are indexed at all.
//
// Both are gated by lx-authgate, which is CLIENT-SIDE: it reads localStorage and calls
// location.replace("/"). A crawler has neither, so it gets HTTP 200 and the whole app shell.
//
// On the combined deploy these two urls are SHARED -- /dashboard and /wallet serve the Stellar or the
// XRPL file depending on the lx_chain cookie. A crawler carries no cookie, so Stellar's (now
// noindexed) file is what it normally receives, and the middleware's X-Robots-Tag covers the path
// whichever file answers. This closes the markup anyway rather than leaving two of the three defences
// resting on "a crawler will not have the cookie".
// THIS SET MUST MIRROR SITEMAP_SKIP in extract_site.js -- the same five urls, by page name instead of
// by path. It is not just the two gated app pages, and getting that wrong is not theoretical: the
// first version of this listed only home and wallet, and because setRobots writes the correct value in
// BOTH directions it then stamped "index, follow" over the noindex that signin, launch-review and
// launch-confirm had correctly inherited from Stellar. Nine pages flipped the wrong way to fix five.
// Caught by the change COUNT not matching the number of gated pages (14, not 5) before any deploy.
//
//   lumoscore-home          /dashboard          wallet-gated
//   lumoscore-wallet        /wallet             wallet-gated
//   lumoscore-signin        /signin             nothing to rank for
//   lumoscore-launch-review /launchpad/review   mid-flow wizard state
//   lumoscore-launch-confirm /launchpad/confirm mid-flow wizard state
const NOINDEX = new Set([
  'lumoscore-home', 'lumoscore-wallet',
  'lumoscore-signin', 'lumoscore-launch-review', 'lumoscore-launch-confirm',
]);

function setRobots(html, noindex) {
  const re = /<meta[^>]*name=["']robots["'][^>]*>/i;
  const want = noindex
    ? '<meta name="robots" content="noindex, nofollow">'
    : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">';
  const m = re.exec(html);
  // Writes an exact value over whatever is there, so re-running is a no-op and a page that moves in or
  // out of NOINDEX is corrected in BOTH directions rather than only on the way in.
  if (!m) return { html, ok: false };
  if (m[0] === want) return { html, ok: false };
  return { html: html.replace(m[0], want), ok: true };
}

let files = 0, pages = 0, titles = 0, descs = 0, skipped = 0, robots = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data; try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    const seo = SEO[BASE(key)];
    if (!seo) { skipped++; continue; }          // admin pages, and anything not yet decided
    let html = json[key];
    const t = setTitle(html, seo[0]); html = t.html; if (t.ok) titles++;
    const d = setDesc(html, seo[1]); html = d.html; if (d.ok) descs++;
    const r = setRobots(html, NOINDEX.has(BASE(key))); html = r.html; if (r.ok) robots++;
    json[key] = html;
    pages++;
  }

  // Same re-serialisation every transform in this codebase uses: </ inside a JSON string would close
  // the surrounding <script> tag when the container is parsed, so it is escaped on the way back in.
  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl seo: ' + titles + ' title(s) and ' + descs + ' description(s) rewritten across '
  + pages + ' page key(s) in ' + files + ' container(s); ' + skipped + ' key(s) left alone');
console.log('xrpl seo: ' + robots + ' robots tag(s) changed (gated pages -> noindex)');
