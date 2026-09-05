// XRPL titles and meta descriptions.
//
// The containers arrived carrying Stellar's copy -- /xrpl/wallet was telling search engines it was a
// "Stellar Wallet". Titles and descriptions are what gets indexed, so they are the one thing that has
// to be right before any of this is public.
//
// WRITTEN OUT, NOT FIND-AND-REPLACED. A regex over "Stellar" would produce sentences that are false
// rather than merely renamed:
//   * XLM is not a rename of XRP; the reserve model, the fee model and the amounts all differ
//   * "manage trustlines" happens to survive, because the XRP Ledger genuinely calls them trust lines
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
    'Your XRP Ledger balances, trust lines, pools and recent activity in one place, priced live from the ledger.',
  ],
  'lumoscore-wallet': [
    'XRP Ledger Wallet — Balances, Send and Receive | LumosCore',
    'View your XRP and token balances, send and receive, manage trust lines and swap on the XRP Ledger. Non-custodial — you sign every transaction yourself.',
  ],
  'lumoscore-dex': [
    'Trade on the XRP Ledger DEX — Swap and Limit Orders | LumosCore',
    'Swap tokens and place limit orders on the XRP Ledger’s native order book, with live prices read straight from the ledger.',
  ],
  'lumoscore-dex-asset': [
    'Token Price, Order Book and Holders on the XRP Ledger | LumosCore',
    'Live price, order book, holders and pools for any XRP Ledger token, with swap and limit orders on the same page.',
  ],
  'lumoscore-amm': [
    'XRP Ledger Liquidity Pools — TVL, Volume and Fees | LumosCore',
    'Browse XRP Ledger AMM pools with live TVL, volume and fees. Add or withdraw liquidity, or create a new pool.',
  ],
  'lumoscore-amm-pool': [
    'XRP Ledger Pool — Liquidity, Volume and Fees | LumosCore',
    'Pool composition, TVL, volume and fees for an XRP Ledger AMM pool, with add and withdraw on the same page.',
  ],
  'lumoscore-account': [
    'XRP Ledger Account — Balances, Trust Lines and Activity | LumosCore',
    'Look up any XRP Ledger account: balances, trust lines, pool positions and transaction history, read live from the ledger.',
  ],
  'lumoscore-launch-token': [
    'Launch a Token on the XRP Ledger — No Code Required | LumosCore',
    'Issue your own token on the XRP Ledger in minutes. Set the name, supply and metadata from the browser — no code and no contract to deploy.',
  ],
  'lumoscore-launch-review': [
    'Review Your XRP Ledger Token | LumosCore',
    'Check the name, supply and metadata of your token before it is issued on the XRP Ledger.',
  ],
  'lumoscore-launch-confirm': [
    'Token Issued on the XRP Ledger | LumosCore',
    'Your token is live on the XRP Ledger. Share it, add liquidity, or trade it straight away.',
  ],
  'lumoscore-bridge': [
    'Bridge Assets to the XRP Ledger | LumosCore',
    'Move assets to and from the XRP Ledger through Wanchain and Axelar, without leaving your wallet.',
  ],
  'lumoscore-rewards': [
    'LUMOS Rewards on the XRP Ledger — LP and Holder Incentives | LumosCore',
    'Earn LUMOS for providing liquidity and for holding on the XRP Ledger. Rewards are paid from the treasury on a fixed schedule.',
  ],
  'lumoscore-lumos-token': [
    'LUMOS on the XRP Ledger — Price, Supply and Holders | LumosCore',
    'Live price, fixed supply, holders and pools for LUMOS on the XRP Ledger.',
  ],
  'lumoscore-signin': [
    'Connect a Wallet | LumosCore',
    'Connect an XRP Ledger wallet to trade, pool and bridge. LumosCore never holds your keys.',
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

let files = 0, pages = 0, titles = 0, descs = 0, skipped = 0;
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
