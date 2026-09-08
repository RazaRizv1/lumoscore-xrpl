// Sign-in network picker: two networks, and no Aptos wallets pretending to be XRPL ones.
//
// WHAT WAS THERE. The fork inherited the multichain sign-in sheet and renamed the Aptos slot to
// "XRP Ledger" wholesale. The result, measured on the built page:
//
//   network cards: stellar, xrpl, vechain, hedera, starknet, XRPL AGAIN, worldchain
//   wallet cards:  stellar x5 | xrpl x4 | vechain x3 | hedera x4 | starknet x4 | xrpl x4 | worldchain x3
//
// The sixth network card and the SECOND run of data-wnet="xrpl" wallets are the old Aptos ones:
// Petra, OKX Wallet, Nightly, Fox Wallet. Petra's subtitle had become "Official XRP Ledger wallet",
// which is simply false. And because they share data-wnet with the real XRPL wallets, choosing
// XRP Ledger revealed all eight — half of them unable to sign an XRPL transaction at all.
// They were also the only four cards NOT display:none, so they were what the page showed at rest.
//
// RAZA, 2026-09-08: "Just show Stellar and XRPL networks."
//
// WHY ORDER, NOT NAMES. data-wnet cannot separate the two xrpl runs, and matching wallet names means
// anchoring on design text. The wallet cards run in the same order as the network cards, one
// contiguous run each, so run N belongs to network card N. That mapping is what this uses — and it
// ASSERTS the inherited shape first and bails untouched if it ever differs, rather than guessing.
//
// display:none is left exactly as found: it is the design's own default, and its script reveals the
// group for the chosen network. Unhiding anything here would break that.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const B = String.fromCharCode(92);

const KEEP_NETS = ['stellar', 'xrpl'];

// <button class="opt-card" ...> ... </button>. Buttons cannot nest, so the next </button> closes it.
function cards(html) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = html.indexOf('<button class="opt-card"', i);
    if (open < 0) break;
    const close = html.indexOf('</button>', open);
    if (close < 0) break;
    const end = close + '</button>'.length;
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    out.push({
      start: open,
      end,
      net: (tag.match(/data-net-id="([^"]+)"/) || [])[1] || null,
      wnet: (tag.match(/data-wnet="([^"]+)"/) || [])[1] || null,
    });
    i = end;
  }
  return out;
}

// contiguous runs of the same data-wnet, in document order
function runs(list) {
  const r = [];
  for (const c of list) {
    if (r.length && r[r.length - 1].wnet === c.wnet) r[r.length - 1].cards.push(c);
    else r.push({ wnet: c.wnet, cards: [c] });
  }
  return r;
}

// The landing page carries the SAME list again as a scrolling marquee (.lx-mq-track), with the same
// duplicated "XRP Ledger". The track animates translateX(-50%), so its tiles are emitted twice and
// the second half must stay a copy of the first or the loop jumps.
const MQ_KEEP = ['Stellar', 'XRP Ledger'];
function trimMarquee(html) {
  const t = html.indexOf('<div class="lx-mq-track">');
  if (t < 0) return null;
  const openLen = '<div class="lx-mq-track">'.length;
  const items = [];
  let i = t + openLen;
  for (;;) {
    const open = html.indexOf('<div class="lx-mq-item"', i);
    if (open < 0) break;
    const nameAt = html.indexOf('<span class="lx-mq-name">', open);
    if (nameAt < 0) break;
    const nameEnd = html.indexOf('</span>', nameAt);
    const close = html.indexOf('</div>', nameEnd);
    if (close < 0) break;
    const end = close + '</div>'.length;
    items.push({ start: open, end, name: html.slice(nameAt + 25, nameEnd).trim(), html: html.slice(open, end) });
    i = end;
  }
  if (items.length < 3) return null;                       // already trimmed
  const uniq = [];
  for (const it of items) {
    if (MQ_KEEP.indexOf(it.name) < 0) continue;
    if (uniq.some(u => u.name === it.name)) continue;       // drops the duplicate XRP Ledger
    uniq.push(it);
  }
  if (uniq.length !== MQ_KEEP.length) return null;          // unexpected — leave it alone
  const body = uniq.map(u => u.html).join('') + uniq.map(u => u.html).join('');
  return html.slice(0, items[0].start) + body + html.slice(items[items.length - 1].end);
}

let pages = 0, netsDropped = 0, walletsDropped = 0, skipped = 0, marquees = 0;

for (const dev of ['desktop', 'mobile']) {
  const file = `lumoscore-xrpl-${dev}.html`;
  let data; try { data = read(file); } catch (e) { continue; }
  const { json, s, e } = getContents(data);
  let changed = false;

  for (const k of Object.keys(json)) {
    let html = json[k];

    const mq = trimMarquee(html);
    if (mq) { html = mq; json[k] = mq; changed = true; marquees++; }

    if (html.indexOf('data-net-id=') < 0) continue;      // sign-in sheet only

    const all = cards(html);
    const netCards = all.filter(c => c.net);
    const walletCards = all.filter(c => c.wnet);
    const walletRuns = runs(walletCards);

    // Only act on the shape this was written for. Anything else and the order mapping is a guess.
    if (netCards.length !== walletRuns.length) { skipped++; continue; }
    if (netCards.length < 3) continue;                    // already trimmed — idempotent

    const drop = [];
    const seen = {};
    netCards.forEach((c, idx) => {
      const first = KEEP_NETS.indexOf(c.net) >= 0 && !seen[c.net];
      if (first) { seen[c.net] = 1; return; }             // keep the FIRST stellar and FIRST xrpl
      drop.push(c);                                       // everything else, incl. the duplicate xrpl
      netsDropped++;
      for (const w of walletRuns[idx].cards) { drop.push(w); walletsDropped++; }
    });

    if (!drop.length) continue;
    // cut back-to-front so earlier offsets stay valid
    drop.sort((a, b) => b.start - a.start);
    let out = html;
    for (const d of drop) out = out.slice(0, d.start) + out.slice(d.end);
    json[k] = out;
    changed = true; pages++;
  }

  if (changed) {
    const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
    fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
  }
}

console.log('xrpl net picker: ' + pages + ' page key(s); dropped ' + netsDropped
  + ' network card(s) and ' + walletsDropped + ' wallet card(s)'
  + '; ' + marquees + ' marquee(s) trimmed' + (skipped ? '; SKIPPED ' + skipped + ' with an unexpected shape' : ''));
