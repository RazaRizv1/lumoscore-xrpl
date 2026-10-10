
// XRPL primitives, kept in one place and testable in node.
//
// Every rule here was checked against mainnet on 2026-09-06, not taken from documentation, because
// three of them are the kind that ship visible garbage if guessed:
//
// 1. A CURRENCY CODE IS NOT ALWAYS TEXT. Three forms exist and a real wallet holds all three:
//      "CSC"                                       standard 3-character code, use as-is
//      4C554D4F5300...00  -> "LUMOS"               40-char hex whose bytes are printable ASCII
//      0329E80F3800DA3C...                         first byte 0x03 = an AMM LP token (XLS-30)
//    Decoding the third as UTF-8 produces mojibake -- exactly what a naive hex-decode renders. Worse,
//    LP tokens are POOL SHARES, not assets: listing them beside XRP and LUMOS would tell someone they
//    hold a token that does not exist. They are separated, the same way Stellar's
//    liquidity_pool_shares are kept out of the balance list.
//
// 2. RESERVES ARE READ FROM THE LEDGER, NEVER HARDCODED. Spendable XRP is
//      balance - (reserve_base + reserve_inc * OwnerCount)
//    Measured today: base 1 XRP, increment 0.2 XRP per owned object. Both were TEN TIMES higher before
//    2024 and can change again by amendment, so a hardcoded 10/2 would quietly overstate what a user
//    can send -- the same class of bug as the Stellar MAX button offering more than the balance.
//
// 3. A TRUST LINE BALANCE IS SIGNED, and negative means the account is the ISSUER of that token --
//    it is an obligation, not a holding. Showing it as a balance would tell an issuer it owns its own
//    entire supply.
'use strict';

// WRAPPED IN AN IIFE ON PURPOSE, and it must stay that way.
//
// This file is injected into pages by more than one transform (_xrplconnect and _xrplwallet). At
// top level, `const XRP_DROPS` is a GLOBAL binding in a classic script, so a second copy throws
// "Identifier 'XRP_DROPS' has already been declared" -- and that error kills the ENTIRE second
// <script> block, taking the wallet layer down with it. The page then renders the design's mock
// table: five invented rows with plausible-looking prices, no missing data, nothing obviously
// broken. It shipped exactly once that way.
//
// Nothing here may be declared outside this wrapper. The only exports are window.lxx and
// module.exports, both assigned at the end.
(function () {

const XRP_DROPS = 1e6;

// Hand-rolled rather than Buffer: this file is injected into the page verbatim, so the code the tests
// run IS the code that ships. Two copies of these rules would drift, which is how a duplicated esc()
// caused trouble in the Stellar project.
function hexBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}

// ---- currency codes ------------------------------------------------------------------------------
const CUR_XRP = 'XRP';

function isLpToken(code) {
  return typeof code === 'string' && code.length === 40 && /^03/i.test(code);
}

// Returns { code, display, kind } — kind is 'std' | 'hex' | 'lp' | 'opaque'
function decodeCurrency(code) {
  if (!code) return { code: '', display: '', kind: 'opaque' };
  if (code === CUR_XRP) return { code, display: 'XRP', kind: 'std' };
  if (code.length <= 3) return { code, display: code, kind: 'std' };
  if (!/^[0-9A-Fa-f]{40}$/.test(code)) return { code, display: code, kind: 'opaque' };
  if (isLpToken(code)) return { code, display: 'LP', kind: 'lp' };

  const bytes = hexBytes(code);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;          // strip the zero padding
  let text = ''; for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i]);
  // Printable ASCII only. Anything else is an arbitrary 160-bit code and must NOT be rendered as text.
  if (end > 0 && /^[\x20-\x7E]+$/.test(text)) return { code, display: text, kind: 'hex' };
  return { code, display: code.slice(0, 8) + '…', kind: 'opaque' };
}

// The inverse, for building requests: 'LUMOS' -> 4C554D4F53 padded to 40.
function encodeCurrency(name) {
  if (!name || name === 'XRP') return 'XRP';
  if (name.length <= 3) return name;
  let hex = ''; for (let i = 0; i < name.length; i++) hex += (name.charCodeAt(i) & 255).toString(16).padStart(2, '0');
  hex = hex.toUpperCase();
  return (hex + '0'.repeat(40)).slice(0, 40);
}

// ---- addresses -----------------------------------------------------------------------------------
// XRPL uses its OWN base58 alphabet -- not Bitcoin's, not Flickr's. Decoding with the wrong one
// silently produces different bytes rather than an error.
const B58 = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

// Decode to bytes. Long division in base 58, because these are 25-byte values and Number would lose
// precision well before the end.
function b58decode(str) {
  if (typeof str !== 'string' || !str.length) return null;
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const v = B58.indexOf(str[i]);
    if (v < 0) return null;                                // not in the XRPL alphabet at all
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 255;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (let i = 0; i < str.length && str[i] === B58[0]; i++) bytes.push(0);   // leading zeros
  return bytes.reverse();
}

// A CLASSIC XRPL ACCOUNT ADDRESS, by shape. Deliberately NOT a checksum check: verifying the trailing
// 4 bytes needs double-SHA256, which is async in a browser (crypto.subtle) and would make every caller
// async for a case that barely happens -- a wallet does not hand back a one-character typo of its own
// address. What DOES happen, and what this catches, is a value of the wrong KIND: a Stellar 'G...'
// address left in shared storage by the Stellar build, an EVM '0x...', an empty string, an X-address.
// Connect confirms the account against the ledger separately, which is the real check.
function isAddress(a) {
  if (typeof a !== 'string' || a.length < 25 || a.length > 35 || a[0] !== 'r') return false;
  const b = b58decode(a);
  return !!b && b.length === 25 && b[0] === 0;             // 0x00 = the classic account-ID version
}

// ---- team wallets --------------------------------------------------------------------------------
// EXCLUDED from Native LP reward maths. These are treasury/team allocations, not holders, and
// counting them would dilute every real participant's share -- they are 850M LUMOS, 86.9% of the
// top-50 holder total, so this is the denominator of the whole calculation rather than a rounding.
//
// Supplied truncated ("rHuF5...oQpN") and resolved against the live holder list, requiring a match on
// the leading characters, the trailing characters AND the stated balance before being written down.
// A truncation alone must never identify an account that gets excluded from a payout.
//
// Corroborated from the ledger rather than from the label: three were funded directly by rHuF5,
// which xrpl.to names "LumosCore", two more by rKt1Dr ("@jrollnation"), and every one of them shows
// 0% DEX / 0% AMM / 0% LP and 100% transfer -- none bought on market.
//
// Full provenance table in XRPL_FACTS.md. Kept HERE so that every layer which touches reward
// eligibility reads one list; a second copy somewhere would silently drift.
const TEAM_WALLETS = [
  'rHuF5XcfA6izw3DhPuZZ5M2z1Vt5ozoQpN',   // 320.8M
  'raieaf1UXyXgvptvSBZQ8Tojj3ztr77sdM',   // 150.0M
  'r42RLyT9Uz35joCo6thvknLJVBDeFqPhgN',   // 144.7M
  'rL9d14LpUX39owdetCB1bV56UFcwAHTs2X',   //  95.0M
  'rEw27GSsFBmGYtkjTh2fYx8AMQY6id6jjx',   //  49.0M
  'rNN7aocBTz4Ba27CnL1uR38EhCxYsoHqst',   //  48.8M
  'rUdnkuyMpDoSfeSko4Y5Pg6Do9mUh8X1tY',   //  41.7M
];

function isTeamWallet(a) {
  return typeof a === 'string' && TEAM_WALLETS.indexOf(a) >= 0;
}

// Drops team wallets from a list of { account, balance }-shaped rows and reports what it removed,
// so a caller can show "excluding team wallets" honestly rather than quietly shrinking a total.
function excludeTeam(rows, accountKey) {
  const key = accountKey || 'account';
  const kept = [], removed = [];
  for (const r of (rows || [])) {
    (isTeamWallet(r && r[key]) ? removed : kept).push(r);
  }
  return { kept, removed };
}

// ---- reserves ------------------------------------------------------------------------------------
// reserves come from server_info; never assume them.
function spendableXrp(balanceDrops, ownerCount, reserve) {
  const bal = Number(balanceDrops) / XRP_DROPS;
  const base = Number(reserve && reserve.base);
  const inc = Number(reserve && reserve.inc);
  if (!isFinite(bal)) return null;
  if (!isFinite(base) || !isFinite(inc)) return null;      // unknown reserve: say so, do not guess
  const locked = base + inc * (Number(ownerCount) || 0);
  return { balance: bal, reserved: locked, spendable: Math.max(0, bal - locked) };
}

// ---- amounts -------------------------------------------------------------------------------------
// Building the Amount field of a transaction. This lives here, beside the reserve maths and under the
// same tests, because it was written three separate times in the browser layers — write.js had two
// copies and pooldetail.js a third — and three copies of the arithmetic that decides how much money
// moves is three chances for one of them to be wrong on its own.
//
// AN XRPL AMOUNT IS ONE OF TWO THINGS and they are not interchangeable:
//   XRP     a STRING of drops, integer, 1 XRP = 1,000,000 drops
//   issued  { currency, issuer, value }, value a decimal string
// Passing a plain number where drops are expected is not a formatting slip: it is off by a factor of
// a million, and the ledger will happily accept it.
function toDrops(xrp) {
  const n = Number(xrp);
  if (!isFinite(n) || n < 0) return null;
  // ROUNDED, NEVER TRUNCATED. 0.1 + 0.2 is 0.30000000000000004, and Math.trunc on that class of value
  // silently shaves a drop off the amount the user typed. Rounding is also what makes the displayed
  // number and the submitted number agree.
  const drops = Math.round(n * XRP_DROPS);
  if (!Number.isSafeInteger(drops)) return null;
  // String() would render a large enough number in exponent form ("1e+21"), which is not a valid
  // drops string. The ledger's own maximum is 1e17 drops, so this cannot trigger today — it is here
  // so that it still cannot if the caller is ever handed a bad number.
  return String(drops);
}

// spec is either the string 'XRP', or { currency, issuer } for an issued token.
function amountFor(spec, value) {
  if (spec === 'XRP' || (spec && spec.currency === 'XRP' && !spec.issuer)) return toDrops(value);
  if (!spec || !spec.currency || !spec.issuer) return null;
  const n = Number(value);
  if (!isFinite(n) || n < 0) return null;
  return { currency: spec.currency, issuer: spec.issuer, value: String(n) };
}

// The pool/asset side of a ledger response, as it comes back from amm_info or an offer: a drops
// string for XRP, or an object. Returns the { currency, issuer } identity with no value attached,
// which is the shape Asset/Asset2 take on an AMM transaction.
function assetOf(raw) {
  if (typeof raw === 'string') return { currency: 'XRP' };
  if (!raw || !raw.currency) return null;
  return { currency: raw.currency, issuer: raw.issuer };
}

// The least a swap may deliver and still be acceptable. Used as the Amount of a cross-currency
// payment WITHOUT tfPartialPayment, so the ledger delivers at least this or the whole thing fails.
function minAfterSlippage(quoted, slippage) {
  const q = Number(quoted), s = Number(slippage);
  if (!isFinite(q) || q <= 0) return null;
  if (!isFinite(s) || s < 0 || s >= 1) return null;        // 1.0 would accept delivering nothing
  return q * (1 - s);
}

// The platform fee on an amount. Separate from the display so the number shown and the number taken
// come from one place — the Stellar Smart Swap was removed because those two disagreed.
function feeOf(value, rate) {
  const v = Number(value), r = Number(rate);
  if (!isFinite(v) || v <= 0) return 0;
  if (!isFinite(r) || r <= 0) return 0;
  return v * r;
}

// ---- balances ------------------------------------------------------------------------------------

// EVERY trustline, following the ledger's `marker`. `account_lines` is PAGED, and every caller in
// this project asked for `limit: 400` and read page one as if it were the whole account.
//
// That is not a theoretical limit. Measured on a real mainnet LP provider
// (rhy6P75G3LA6FmPq2kNsiVkGCXsyKppk4h): **1,360 trustlines across 4 pages**, with its AMM LP token
// sitting on page TWO. The pool page therefore read `myLp: 0` and refused a withdrawal — "You hold 0
// LP tokens" — to an account that genuinely holds 75,141 of them. XRP Ledger accounts accumulate
// trustlines from airdrops and spam, so hundreds is ordinary and 400 is not a safe ceiling.
//
// The same read decides money elsewhere: the fee tier checks for 250,000 LUMOS to charge 0.1%
// instead of 0.2%, and rewards eligibility looks for LUMOS and LP positions. A holding on page two
// meant the higher fee and no rewards.
//
// `rpc` is injected rather than imported because each browser layer owns its own transport, and this
// file is also the one the node tests run against. Capped at 20 pages (8,000 lines) so a pathological
// account cannot spin here forever; the cap is far above anything observed.
// Resolves `{ lines }` — the SAME shape a single account_lines call returns — so it is a drop-in at
// every call site and no consumer has to change how it reads the result. That matters here: seven
// layers read these lines in seven slightly different ways, and a reshaped return is how one of them
// would quietly start seeing `undefined`.
function allLines(rpc, account, opts) {
  const base = Object.assign({ account: account, limit: 400, ledger_index: 'validated' }, opts || {});
  const out = [];
  let pages = 0;

  function next(marker) {
    const q = Object.assign({}, base);
    if (marker) q.marker = marker;
    return rpc('account_lines', q).then(function (r) {
      const lines = (r && r.lines) || [];
      for (let i = 0; i < lines.length; i++) out.push(lines[i]);
      pages++;
      if (r && r.marker && pages < 20) return next(r.marker);
      return { lines: out, pages: pages };
    });
  }
  return next(null);
}

// Splits account_lines into things the holder OWNS and pool shares, and drops issuer obligations.
function readLines(lines) {
  const held = [], pools = [], obligations = [];
  for (const l of (lines || [])) {
    const amt = Number(l.balance);
    const cur = decodeCurrency(l.currency);
    const row = {
      currency: l.currency, display: cur.display, kind: cur.kind,
      issuer: l.account, balance: amt,
      frozen: !!(l.freeze || l.freeze_peer),
      noRipple: !!l.no_ripple,
      limit: Number(l.limit),
    };
    if (amt < 0) { obligations.push(row); continue; }      // this account issues it; not a holding
    if (cur.kind === 'lp') { pools.push(row); continue; }  // pool share, not an asset
    held.push(row);
  }
  return { held, pools, obligations };
}

// ---- limit orders --------------------------------------------------------------------------------
// An issued-token value exactly as the ledger wants it: a plain decimal string with at most 15
// significant digits. toPrecision caps the digits but answers in EXPONENT form below 1e-6 or at
// 1e21 and above ("1.00000000000000e-7"), so that form is expanded back into digits here rather than
// passed through — one serialiser disagreeing with another about "1e-7" is not a risk worth taking
// for an amount that moves money.
function iouValue(n) {
  const x = Number(n);
  if (!isFinite(x) || x <= 0) return null;
  const p = x.toPrecision(15);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(p);
  let s = p;
  if (m) {
    const digits = m[1] + (m[2] || ''), exp = Number(m[3]);
    if (exp < 0) s = '0.' + '0'.repeat(-exp - 1) + digits;
    else if (digits.length > exp + 1) s = digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
    else s = digits + '0'.repeat(exp + 1 - digits.length);
  }
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// OfferCreate's tfSell, 0x00080000 (xrpl.org, OfferCreate flags).
const TF_SELL = 0x00080000;

// The TakerGets / TakerPays / Flags of a limit order for `token` against XRP, at `price` XRP per token.
//
// The creator SELLS TakerGets and BUYS TakerPays — verified against xrpl.org, not reasoned about,
// because the names read naturally from the TAKER's side and backwards is the mistake to expect.
//
//   buy   TakerPays = the token amount       TakerGets = amount × price, in drops    no flags
//         The ledger treats a plain offer as done once TakerPays has arrived: exactly "buy N tokens
//         at up to this price". Stellar's manageBuyOffer.
//   sell  TakerGets = the token amount       TakerPays = amount × price, in drops    tfSell
//         Without tfSell a sell that crosses better bids stops as soon as the XRP total is reached
//         and leaves tokens unsold. With it the whole amount sells, the extra XRP going to the seller.
//         Stellar's manageSellOffer.
//
// The XRP side goes through toDrops, so it is ROUNDED to the nearest drop — never more than half a
// drop from price × amount. Refuses (null) rather than building something the ledger would reject:
// a non-positive number, an unknown side, a token without an issuer, XRP on the token side, or a
// total under half a drop, which rounds to "0" and is temBAD_OFFER.
function offerFor(side, token, amount, price) {
  if (side !== 'buy' && side !== 'sell') return null;
  if (!token || !token.currency || !token.issuer || token.currency === CUR_XRP) return null;
  const a = Number(amount), p = Number(price);
  if (!isFinite(a) || a <= 0 || !isFinite(p) || p <= 0) return null;
  const value = iouValue(a);
  const drops = toDrops(a * p);
  if (!value || drops === null || drops === '0') return null;
  const tok = { currency: token.currency, issuer: token.issuer, value: value };
  if (side === 'buy') return { TakerGets: drops, TakerPays: tok, Flags: 0 };
  return { TakerGets: tok, TakerPays: drops, Flags: TF_SELL };
}

// ---- the XRP/USD rate, with a cache -----------------------------------------------------------
//
// ONE FAILED CALL MUST NOT BLANK A PAGE OF MONEY. Eight browser files on this build ask
// /lxapi/xrpltokens?n=1 for the rate, and not one of them remembered the answer. Every USD figure is
// gated on it, so a single refusal takes the lot: measured on the live pools table 2026-09-29, all
// fifty rows showed "—" for Liquidity, Volume and Fees while the endpoint's own data was sitting in
// the response beside them, complete. A reload fixed it, which is exactly what makes it easy to miss.
//
// It is not a rare failure either. The rate comes from xrpl.to, which allows 333 requests per day per
// IP -- a cap this session reached by itself -- and a 429 looks identical to an outage from here.
//
// Stellar hit this in the same shape and answered it the same way: lumos.xlmUsd, a last-good rate in
// localStorage, read when the live call fails. This is that, for XRP. Six hours matches Stellar's
// window (216e5): long enough to cover an outage, short enough that a stale rate cannot drift far
// enough to matter for a headline figure -- and every page that can show a PRICE still quotes it
// live rather than from here.
const USD_KEY = 'lumos.xrpUsd';
const USD_TTL = 216e5;

function usdCached() {
  try {
    const c = JSON.parse(localStorage.getItem(USD_KEY) || 'null');
    if (c && +c.v > 0 && (Date.now() - c.ts) < USD_TTL) return +c.v;
  } catch (e) {}
  return null;
}
function usdSave(v) {
  if (+v > 0) { try { localStorage.setItem(USD_KEY, JSON.stringify({ v: +v, ts: Date.now() })); } catch (e) {} }
  return +v || null;
}
// Retries, then the cache, then null. Callers keep their own "null means show a dash" behaviour --
// this only makes null much rarer, and never invents a rate.
function fetchUsd(tries) {
  return fetch('/lxapi/xrpltokens?n=1')
    .then(function (r) { return r.json(); })
    .then(function (t) {
      if (t && t.ok && +t.usd > 0) return usdSave(+t.usd);
      throw new Error('retry');
    })
    .catch(function () {
      if (tries > 0) {
        return new Promise(function (res) { setTimeout(res, 2000); })
          .then(function () { return fetchUsd(tries - 1); });
      }
      return usdCached();
    });
}

// WHAT A SWAP WOULD FETCH, WITHOUT ASKING THE ROUTER.
//
// ripple_path_find answers "what can THIS ACCOUNT send", so it caps at the holding and goes silent for
// an account that does not hold the token at all. Measured on a wallet with 21,038 PHNIX: send_max
// 100,000 and send_max 500,000 both came back 0.147434 XRP, the same figure as its whole balance. The
// Trade page already worked around this -- the pair's AMM pool and order book are read directly and the
// amount is filled in small steps from whichever pays more.
//
// IT LIVES HERE SO THERE IS ONE OF IT. dxaswap.js's own note says "THIS IS browser/dxaswap.js's SWAP,
// not a second one... a fresh implementation here would relearn all of it", and the bridge needed the
// same answer. Two copies of this arithmetic would be two things to get wrong. Both pages inject this
// file, so both get the same function and the same numbers.
//
// `rpc` is passed in rather than imported: each page has its own, with its own node list and deadline.
function simulateSwap(rpc, opts) {
  const buying = !!(opts && opts.buying);          // true: paying XRP for the token
  const tok = opts && opts.token;
  const amt = Number(opts && opts.amount);
  if (!rpc || !tok || !(amt > 0)) return Promise.resolve(null);
  const val = function (a) { return typeof a === 'string' ? Number(a) / 1e6 : Number(a && a.value); };
  return Promise.all([
    rpc('amm_info', { asset: { currency: 'XRP' }, asset2: tok, ledger_index: 'validated' }).catch(function () { return null; }),
    rpc('book_offers', {
      taker_gets: buying ? tok : { currency: 'XRP' }, taker_pays: buying ? { currency: 'XRP' } : tok,
      limit: 200, ledger_index: 'validated',
    }).catch(function () { return null; }),
  ]).then(function (r) {
    let pool = null;
    const amm = r[0] && r[0].amm;
    if (amm) {
      const xr = typeof amm.amount === 'string' ? val(amm.amount) : val(amm.amount2);
      const tr = typeof amm.amount === 'string' ? val(amm.amount2) : val(amm.amount);
      if (xr > 0 && tr > 0) pool = { x: buying ? xr : tr, y: buying ? tr : xr, f: (Number(amm.trading_fee) || 0) / 100000 };
    }
    const offers = ((r[1] && r[1].offers) || []).map(function (o) {
      return {
        give: val(o.taker_gets_funded != null ? o.taker_gets_funded : o.TakerGets),
        want: val(o.taker_pays_funded != null ? o.taker_pays_funded : o.TakerPays),
      };
    }).filter(function (o) { return o.give > 0 && o.want > 0; });
    if (!pool && !offers.length) return null;
    let spot = 0;
    if (pool) spot = pool.y / pool.x * (1 - pool.f);
    if (offers.length) spot = Math.max(spot, offers[0].give / offers[0].want);
    const steps = 80, dx = amt / steps;
    let out = 0, oi = 0, left = offers.length ? offers[0].want : 0;
    for (let k = 0; k < steps; k++) {
      const ammOut = pool ? pool.y * (1 - pool.x / (pool.x + dx * (1 - pool.f))) : 0;
      let need = dx, bookOut = 0, j = oi, l = left;
      while (need > 1e-18 && j < offers.length) {
        const take = Math.min(need, l);
        bookOut += take * offers[j].give / offers[j].want;
        need -= take; l -= take;
        if (l <= 1e-18) { j++; l = j < offers.length ? offers[j].want : 0; }
      }
      if (need > dx * 1e-9) bookOut = 0;                 // the book ran out inside this step
      if (!(ammOut > 0) && !(bookOut > 0)) break;
      if (ammOut >= bookOut) { out += ammOut; pool.x += dx; pool.y -= ammOut; }
      else { out += bookOut; oi = j; left = l; }
    }
    if (!(out > 0)) return null;
    return { out: out, impact: spot > 0 ? (1 - (out / amt) / spot) * 100 : null };
  });
}

const LXX = { XRP_DROPS, decodeCurrency, encodeCurrency, isLpToken, spendableXrp, readLines, allLines, isAddress,
  simulateSwap,
  TEAM_WALLETS, isTeamWallet, excludeTeam,
  toDrops, amountFor, assetOf, minAfterSlippage, feeOf,
  iouValue, TF_SELL, offerFor,
  usdCached, usdSave, fetchUsd };

// Dual environment on purpose: required by the tests in node, and injected verbatim into the page.
if (typeof module !== 'undefined' && module.exports) module.exports = LXX;
if (typeof window !== 'undefined') window.lxx = LXX;

})();

// Trade-Asset page: one XRP Ledger token.
//
// REPLACES THE MOST VISIBLY WRONG PAGE ON THE SITE. `lx-dxadata` ignored the token in the URL
// entirely and rendered Stellar LUMOS: 105 mentions of XLM and 124 Stellar addresses, under a title
// reading "LUMOS price, pools and holders on Stellar". It was reached by clicking any row in the
// XRP Ledger market table, so the better the Trade page got, the more people it sent here.
//
// Two sources, on purpose:
//   token details  /lxapi/xrpltoken  -- proxied and cached (333 upstream requests per DAY per IP)
//   ORDER BOOK     the XRP Ledger itself, via book_offers, straight from the browser. No rate limit
//                  worth proxying for, no third party to trust, and a book should be as live as the
//                  ledger. It is also the one number here nobody has to take on faith.
(function () {
  if (window.__lxxDexAsset) return;
  window.__lxxDexAsset = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // SUBSCRIPT ZEROS for the very small (RAZA 2026-09-15: "instead of 0.00000000000000000070 just use subscript notation"):
  // 0.0₁₈70 — the subscript counts the zeros after the decimal point, then four significant digits.
  // THE ROOT DOMAIN ONLY (RAZA 2026-09-16: "Just show the root domain as homedomain" — firstledger.net, not
  // firstledger.net/token/rhc8…/5852…). Protocol, path, port and www. go; a two-letter country suffix keeps its label.
  function rootDomain(v) {
    var h = String(v || '').trim().replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0].split(':')[0].toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
    var p = h.split('.');
    if (p.length <= 2) return h;
    var keep = (/^(co|com|net|org|gov|edu|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) ? 3 : 2;
    return p.slice(-keep).join('.');
  }

  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }

  function xrp(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 1e-8) return subZero(v);
    // Plain decimals at any size, as lumoscore.com prints prices — never "7.64e-12" (RAZA 2026-09-15).
    if (v > 0 && v < 0.000001) return v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3));
    if (v < 1) return v.toPrecision(dp || 5);
    return v.toLocaleString('en-US', { maximumFractionDigits: dp || 4 });
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e18) return (v / 1e18).toFixed(2) + 'Qi';
    if (v >= 1e15) return (v / 1e15).toFixed(2) + 'Qa';
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    // A TRADE OF 0.00132 ATOM IS NOT "0" (seen on the exchanges rows 2026-09-16: "0 ATOM · 1 XRP"). Two decimal places
    // rounded every small holding to zero, so the AMOUNT column denied that the trade had a size at all.
    if (v > 0 && v < 0.01) return v < 1e-8 ? subZero(v) : String(Number(v.toPrecision(4)));
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // THE HEADLINE STATS COMPACT FROM A THOUSAND, NOT FROM A MILLION (RAZA 2026-10-06: "Now on
  // Trade-Asset page, in Volume and Market cap, please use K,M,B etc, just like on Stellar").
  //
  // amount() already had M, B, T, Qa and Qi, all at two decimals — the ladder simply had no K, so
  // anything between a thousand and a million printed in full: "26,422.66 XRP" and "633,891.84 XRP"
  // beside a supply reading "5.33B". One box switching conventions.
  //
  // The K step is ONE DECIMAL, which is not a guess: lumoscore.com's AQUA page reads "129.8K XLM" for
  // 24h Volume and "80.05B AQUA" for supply, so its ladder is K→1dp, M→2dp, B→2dp. amount() already
  // matches above a million; this completes it below.
  //
  // SEPARATE FROM amount(), because amount() also formats the trades table, where a fill of 1,234 ATOM
  // should stay 1,234 rather than become "1.2K" — the AMOUNT column there is a quantity to read, not a
  // magnitude to skim. Only the four headline cells call this.
  function statAmt(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e3 && v < 1e6) return (v / 1e3).toFixed(1) + 'K';
    return amount(v);
  }

  // ---- the token in the URL --------------------------------------------------------------------
  // /trade/xrpl/<CODE>-<ISSUER>. The code may itself contain a dash, so split on the LAST one --
  // the issuer is a fixed-shape r-address and the code is whatever is left.
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var raw = decodeURIComponent(parts[parts.length - 1] || '');
    var cut = raw.lastIndexOf('-');
    if (cut < 1) return null;
    var code = raw.slice(0, cut), issuer = raw.slice(cut + 1);
    if (!window.lxx.isAddress(issuer)) return null;
    return { code: code, issuer: issuer };
  }

  // The ledger wants the 40-char hex form for anything longer than 3 characters.
  function currencyOf(code) {
    try { return window.lxx.encodeCurrency(code); } catch (e) { return code; }
  }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  // ---- order book -------------------------------------------------------------------------------
  // Direction verified against live data rather than reasoned about: for RLUSD the asks came back
  // at 0.706881 / 0.707012 and the bids at 0.706225 / 0.706175, bracketing the 0.7066 market price.
  // Backwards, bids would sit above asks -- which is exactly what a plausible-looking book of
  // nonsense would show, so it is worth checking rather than assuming.
  //
  //   ASK = an offer GIVING the token and WANTING XRP  (someone selling it)
  //   BID = an offer GIVING XRP and WANTING the token  (someone buying it)
  function book(asset) {
    var tok = { currency: currencyOf(asset.code), issuer: asset.issuer };
    var xrpSide = { currency: 'XRP' };
    return Promise.all([
      rpc('book_offers', { taker_gets: tok, taker_pays: xrpSide, limit: 60 }),
      rpc('book_offers', { taker_gets: xrpSide, taker_pays: tok, limit: 60 })
    ]).then(function (r) {
      return { asks: rows(r[0].offers, 'ask'), bids: rows(r[1].offers, 'bid') };
    });
  }

  function drops(v) { return Number(v) / 1e6; }

  function rows(offers, side) {
    var out = [];
    for (var i = 0; i < (offers || []).length; i++) {
      var o = offers[i], px = null, amt = null;
      try {
        if (side === 'ask') {
          amt = Number(o.TakerGets.value);           // tokens on offer
          px = drops(o.TakerPays) / amt;             // XRP wanted per token
        } else {
          amt = Number(o.TakerPays.value);           // tokens wanted
          px = drops(o.TakerGets) / amt;             // XRP offered per token
        }
      } catch (e) { continue; }
      if (!isFinite(px) || !isFinite(amt) || amt <= 0) continue;
      out.push({ px: px, amt: amt });
    }
    // The ledger returns each book already ordered by price quality, but the two books are quoted
    // in opposite directions, so sort explicitly rather than trust the arrival order.
    out.sort(function (a, b) { return side === 'ask' ? a.px - b.px : b.px - a.px; });
    var run = 0;
    for (var j = 0; j < out.length; j++) { run += out[j].amt; out[j].sum = run; }
    return out.slice(0, 16);
  }

  // The design gates the book behind a class its old script set once it had data:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row { visibility: hidden }
  // The style block (lx-dxa-css) is a separate element and survives stripping the script, so without
  // this the rows are laid out with correct prices and never appear. Fourth gate of this exact shape
  // in this project; assume every replaced section has one until checked.
  // There are TWO on this page, not one -- the stat row is gated separately from the book:
  //     #dxaObAsks:not(.lxda) .dxa-ob-row            { visibility: hidden }
  //     .stat-row:not(.lxda) .val, ... .sub          { visibility: hidden }
  // The second was found only because a screenshot disagreed with the DOM: every stat cell read back
  // with the right text and computed visibility:hidden. Reading values out of the DOM would have
  // called this page finished while it showed six blank cards.
  // THE POOLS AND HOLDERS TABS SHOWED THE DESIGN'S MOCK FIRST (RAZA 2026-09-15: "There's a flash bug on Trade-Asset → Pools
  // tab. It shows this for split second" — USDC / APT, APR, "Add liquidity"). The design writes its sample table whenever a
  // tab opens; it stays hidden until this token's rows are in it, the same gate shape as the rest of this page.
  (function () {
    if (document.getElementById('lxx-dxa-tabgate')) return;
    var st = document.createElement('style');
    st.id = 'lxx-dxa-tabgate';
    st.textContent = '.dxa-tab-extra.dxa-pools:not(.lxda) .dxa-pl-head,.dxa-tab-extra.dxa-pools:not(.lxda) table,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) table,.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-stat .val,'
      + '.dxa-tab-extra.dxa-holders:not(.lxda) .dxa-hl-pgn{visibility:hidden}'
      // The snapshot camera is removed from the chart controls (RAZA 2026-09-16: "Remove the camera icon for screenshot").
      + '.lxda-snap{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  function liftIdentity() {
    ['.stat-row', '.dxa-stat-row', '.mdxa-stat-row', '.asset-header', '.asset-top'].forEach(function (s) {
      $$(s).forEach(function (n) { n.classList.add('lxda'); });
    });
  }

  function lift() {
    // `.asset-header` / `.asset-top` ARE THE REASON THE PAGE LOOKED EMPTY, and they were missing from
    // this list. They gate the token's own NAME:
    //     .asset-header:not(.lxda) .asset-name, .asset-top:not(.lxda) .asset-name { visibility:hidden }
    // paintHeader() writes `h1.asset-name` correctly on every load, and it has been invisible the
    // whole time — a page about ARMY that never said ARMY, with a blank where the heading belongs.
    // Found only by screenshotting; the DOM read back "ARMY" at opacity 1 with no console error, and
    // I called this page working three times on that evidence.
    //
    // NOT added here, deliberately: `#dxaChart`, `#dxaExTable`, `#mdxaExList` and `.dxa-hl-stat`.
    // Those gates hide the DESIGN'S MOCK — this layer does not paint any of them (there is no OHLC
    // source for the chart) — so lifting them would replace a blank with a fabricated price history
    // and invented trades. A blank is the honest state until they have real data.
    // THE HEADER AND STATS ARE LIFTED ONLY ONCE THEY HOLD THIS TOKEN (RAZA 2026-09-15: "Whenever i open any trade-asset
    // page, it shows this for split seconds then it fixes"). Lifting them here, before the token feed answered, put the
    // design's "USDC · 0x0409…f072 · circle.com · 4.2271 APT" on screen until paintHeader overwrote it. See liftIdentity().
    var sels = ['#dxaObAsks', '#dxaObBids', '#mdxaObAsks', '#mdxaObBids'];
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('lxda');
    }

    // THE SECOND GATE FAMILY, which nothing in this file ever satisfied. A separate stylesheet hides
    // individual VALUES until they carry `.lxp`:
    //     .ohlc-strip .pair .v:not(.lxp), .dxa-perf-grid .dxa-perf-cell .ch:not(.lxp),
    //     … { visibility:hidden !important }
    // It is `!important`, so the class is the only way past it — and this layer had never added it,
    // which is why the H/L strip and the performance row rendered as empty space even after being
    // filled with real figures.
    //
    // Only the ones this layer actually writes are released. `.dxa-hl-stat .val`,
    // `.tabs-bar .tab .count` and the trade-summary rows are left gated for the same reason as the
    // chart: nothing here fills them yet.
    var vals = ['.ohlc-strip .pair .v', '.dxa-perf-grid .dxa-perf-cell .ch',
      '.mdxa-perf-grid .mdxa-perf-cell .ch'];
    for (var k = 0; k < vals.length; k++) {
      var vn = document.querySelectorAll(vals[k]);
      for (var m = 0; m < vn.length; m++) vn[m].classList.add('lxp');
    }

    safetyNet();
  }

  // THE WHOLE PAGE IS REVEALED BY A TRANSITION, AND A TRANSITION CAN FAIL TO RUN.
  //
  // Measured on the served page: `.dxa-grid` — which contains the name, the issuer card, the chart
  // and the trade panel, i.e. everything — sits at computed opacity 0 with two CSSTransitions
  // (opacity and transform, 550ms) reported as `running` at currentTime 0. The tabs bar and the
  // Recent Exchanges panel are the same, via `[data-lcmu]{opacity:0}` lifted by `.lcmu-in`.
  //
  // So the page's VISIBILITY depends on an animation completing. That is fail-closed: when the
  // transition does not run, the markup is perfect, the data is correct, there is no console error,
  // and the reader sees nothing. This project has shipped that exact outage before —
  // prefers-reduced-motion masking a deleted card-reveal driver, 2026-08-14 — and the rule written
  // down afterwards was that a mechanism whose failure mode is "the feature never happens" must not
  // be load-bearing.
  //
  // ONLY A NET, NOT AN OVERRIDE. It runs once, late, and forces opacity only on elements STILL at
  // zero — so where the animation works it has already finished and this changes nothing, and the
  // design's fade is preserved. Content beats choreography when the two disagree.
  //
  // Deliberately a timer and not requestAnimationFrame: rAF is exactly the kind of frame-driven
  // mechanism that is not firing when this situation arises.
  function safetyNet() {
    if (window.__lxxDxaNet) return;
    window.__lxxDxaNet = 1;
    setTimeout(function () {
      var main = document.querySelector('main') || document.body;
      var nodes = main.querySelectorAll('.dxa-grid, [data-lcmu], .dxa-trade-card, .tabs-bar, .panel');
      for (var i = 0; i < nodes.length; i++) {
        try {
          var n = nodes[i];
          if (getComputedStyle(n).opacity !== '0') continue;          // the reveal did its job

          // SETTING opacity IS NOT ENOUGH, and the first version of this net proved it: the trade
          // card lifted and the grid did not. A CSS transition sits ABOVE !important in the cascade,
          // so a transition frozen at its from-value keeps winning however the inline style is
          // written. (Recorded in this project before as "a stuck transition outranking
          // !important".) The transition has to be ENDED, not out-shouted.
          n.style.setProperty('transition', 'none', 'important');
          if (n.getAnimations) {
            var as = n.getAnimations();
            for (var k = 0; k < as.length; k++) { try { as[k].finish(); } catch (_) {} }
          }
          n.style.setProperty('opacity', '1', 'important');
          n.style.setProperty('transform', 'none', 'important');
        } catch (e) {}
      }
    }, 1500);
  }

  function paintBook(node, list, side) {
    if (!node) return;
    node.innerHTML = '';
    if (!list.length) {
      var none = el('div', 'dxa-ob-row', 'No ' + (side === 'ask' ? 'asks' : 'bids') + ' on this book.');
      none.style.cssText = 'opacity:.6;justify-content:center';
      node.appendChild(none);
      return;
    }
    var max = list[list.length - 1].sum || 1;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var row = el('div', 'dxa-ob-row mdxa-ob-row ' + side);
      row.appendChild(el('span', 'px', xrp(r.px, 6)));
      row.appendChild(el('span', 'am', amount(r.amt)));
      row.appendChild(el('span', 'sm', amount(r.sum)));
      var bar = el('span', 'bar');
      // Depth bar, scaled to the deepest level shown so the shape means something.
      bar.style.width = Math.max(1, Math.round((r.sum / max) * 100)) + '%';
      row.appendChild(bar);
      node.appendChild(row);
    }
  }

  // ---- stats ------------------------------------------------------------------------------------
  // These six cells ship with MOCK values baked into the markup -- "4.2271 XRP / $0.916142",
  // "+2.66%", "4.14M XRP / $980,137" -- and they are not written by any data layer, so they survived
  // stripping the Stellar one. Whatever token you opened, the page quoted those numbers as if they
  // were its own. Invented figures on a price page are worse than blank ones, so anything without
  // real data behind it is set to an em dash rather than left as the mock.
  function money(v) {
    if (v == null || !isFinite(v)) return null;
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + Math.round(v).toLocaleString('en-US');
    if (v < 1e9) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + (v / 1e9).toFixed(2) + 'B';
  }

  // THE PHONE LABELS THESE CELLS DIFFERENTLY, and an exact match silently skipped one.
  //
  // Desktop reads "24h volume"; the phone reads just "Volume". The comparison was `=== name`, so on
  // mobile that cell was never found, never painted, and kept the design's mock — displaying
  // "4.14M APT" beside three cells that HAD been painted, which is the most convincing way for a
  // wrong number to appear: surrounded by right ones.
  //
  // Matched either way round now, so a shorter phone label finds a longer desktop key. Scoped to
  // .stat-cell, where the label set is small and unambiguous.
  function cellByLabel(name) {
    var cells = document.querySelectorAll('.stat-cell');
    var want = String(name).toLowerCase();
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.lbl');
      if (!l) continue;
      var got = l.textContent.trim().toLowerCase();
      if (got === want || got.indexOf(want) >= 0 || want.indexOf(got) >= 0) return cells[i];
    }
    return null;
  }

  function setCell(name, main, unit, sub, dir) {
    var c = cellByLabel(name);
    if (!c) return;
    var v = c.querySelector('.val'), s = c.querySelector('.sub');
    if (v) {
      v.textContent = main == null ? '—' : main;
      if (main != null && unit) {
        var u = el('span', 'u', unit);
        v.appendChild(u);
      }
      if (dir) v.className = 'val change ' + dir + ' mono';
    }
    if (s) s.textContent = sub == null ? '' : sub;
  }

  // THE PRICE-CHANGE ROW WAS THE DESIGN'S FICTION, ON A PAGE ABOUT ONE REAL TOKEN.
  //
  // Six cells — 1h, 24h, 7d, 1m, 3m, 6m — and every one of them shipped as static markup: "+0.42%",
  // "+2.66%", "-1.18%", "+12.34%", "+28.91%", "+47.62%". Nothing ever painted them, so ARMY showed
  // "24h +2.66%" while the header directly above it showed the real 24h move, which was NEGATIVE.
  // Two contradictory answers about the same token, on the same screen, and the invented one was in
  // the bigger type.
  //
  // Three of the six are real and were already in the payload this page fetches: /lxapi/xrpltoken
  // maps the upstream's pro1h / pro24h / pro7d to p1h / p24 / p7. They were simply never read.
  //
  // THE OTHER THREE DO NOT EXIST. The upstream carries no 1-month, 3-month or 6-month change — the
  // full field list was checked, not assumed — so they become em dashes rather than being computed
  // from a series this page does not have. A missing figure reads as missing; an invented one reads
  // as a 47% gain.
  //
  // Matched on each cell's own label rather than by index, so a change to the row's order cannot
  // silently put the 7-day number under the 1-hour heading.
  // THE LOGO HEALER EATS THIS ROW, which is why the labels have to be rebuilt rather than read.
  //
  // Measured on the live page: after the first paint, cells 4-6 were `innerHTML: ""` — not em-dashed,
  // EMPTY. That engine repaints any element holding one to five characters as a ticker logo and
  // clears its text, and "1m", "3m", "6m" are two characters each. The first three cells survive only
  // because this function repaints them afterwards; anything it skips stays wiped.
  //
  // So the labels come from this list, not from the DOM, and every cell is stamped `data-logoed="1"`
  // — the healer's own skip marker, and the documented escape.
  var PERF = ['1h', '24h', '7d', '1m', '3m', '6m'];

  // Same contract as wallet.js's plain(): undo whatever the logo engine did to this node, claim it
  // with the engine's OWN skip marker, then write the text. `null` leaves the text alone, for a
  // container that only needs releasing.
  function plain(node, text) {
    try {
      node.removeAttribute('data-logo');
      node.style.background = '';
      node.style.backgroundImage = '';
      node.style.boxShadow = '';
      node.setAttribute('data-logoed', '1');
    } catch (e) {}
    if (text != null) node.textContent = text;
  }

  // The upstream publishes 1h / 24h / 7d and nothing longer, so 1m, 3m and 6m read as em dashes on
  // arrival. They are filled in by loadLongPerf() from the token's own daily close series — a real
  // price history from the same source, not a series this page lacks. Kept here so a later
  // paintPerf() (the Buy/Sell toggle re-runs it) does not blank what has already been computed.
  var LONG = {}, LASTD = null;

  function paintPerf(d) {
    // `[class*="dxa-perf-cell"]` MATCHES BOTH LAYOUTS, and selecting only `.dxa-perf-cell` is why
    // the phone shipped fabricated performance figures for weeks. The mobile page has ZERO
    // `.dxa-perf-cell` and six `.mdxa-perf-cell` — the phone's class is the desktop's with a letter
    // in front — so this function found nothing there and returned, leaving the design's mock in
    // place: "1h +0.42%  24h +2.66%" against an API saying +0.003% and -0.347%. And lift() had
    // already released the `.lxp` gate on those cells, so the invented numbers were fully visible
    // and looked authoritative. Exactly the trap in [[lumoscore-hidden-mock-sweep]]: a layer that
    // names the desktop container does nothing on the phone.
    var cells = $$('[class*="dxa-perf-cell"]');
    if (!cells.length) return;
    if (d) LASTD = d;
    var have = {
      '1h': d ? d.p1h : null, '24h': d ? d.p24 : null, '7d': d ? d.p7 : null,
      '1m': LONG['1m'], '3m': LONG['3m'], '6m': LONG['6m'],
    };

    cells.forEach(function (c, i) {
      var label = PERF[i] || (((c.querySelector('.tf') || {}).textContent) || '').trim();
      var v = Object.prototype.hasOwnProperty.call(have, label) ? have[label] : null;
      var ok = (v != null && isFinite(v));

      // Rebuilt, because the healer may have emptied the cell entirely.
      var tf = c.querySelector('.tf') || c.appendChild(el('div', 'tf'));
      var ch = c.querySelector('.ch') || c.appendChild(el('div', 'ch'));

      // STAMPING data-logoed IS NOT ENOUGH ON ITS OWN. The first attempt set only that marker and
      // the cell came back carrying `data-logo="CELL"` and a base64 token-logo background, with its
      // children gone — the engine had already claimed it, and the leftover attribute and background
      // kept the logo painted over the row. The marker has to be set AND the engine's existing state
      // undone, which is exactly what wallet.js's plain() does and why it does all three things.
      plain(c, null);
      plain(tf, label);
      plain(ch, ok ? ((v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%') : '—');

      // AND THIS IS THE LINE THAT ACTUALLY SAVES THE CELL. There are two logo engines on this page
      // and they use different contracts: the second honours `data-logoed`, the FIRST does not look
      // at it at all. Its test is "no img/svg/[data-logo] descendant AND text of 1-5 characters",
      // so a cell reading "1h-0.06%" (8 chars) is safe while one reading "1m—" (3) is treated as a
      // ticker — which is why only the three em-dashed cells were being eaten. The symbol it settled
      // on was CELL, taken from this element's own class name, `dxa-perf-cell`.
      //
      // An empty `data-logo` on a CHILD is that engine's own escape: the parent then fails its
      // `querySelector('img,svg,[data-logo]')` check and is skipped, and the empty value matches no
      // logo so nothing is drawn. Same trick the snapshot button already uses a few lines below.
      try { tf.setAttribute('data-logo', ''); } catch (e) {}

      try { ch.classList.add('lxp'); } catch (e) {}
      c.classList.remove('up', 'down');
      if (ok) c.classList.add(v >= 0 ? 'up' : 'down');
    });
  }

  // 1m / 3m / 6m, computed from ONE year of daily closes rather than three separate calls — the
  // upstream budget is 333 requests a DAY, and a 1Y daily series already contains every window.
  //
  // A young token is the case that matters: if the series does not reach back far enough, the figure
  // stays an em dash instead of quietly measuring from the token's first ever candle and calling
  // that "6 months". The tolerance is three days, because daily candles do not land on exact
  // boundaries and an illiquid token can miss days entirely.
  function changeOver(pts, days) {
    if (!pts || pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var cut = last[0] - days * 86400000;
    if (pts[0][0] > cut + 3 * 86400000) return null;       // history is shorter than the window
    var base = null;
    for (var i = pts.length - 1; i >= 0; i--) { if (pts[i][0] <= cut) { base = pts[i]; break; } }
    if (!base || !(base[1] > 0)) return null;
    return (last[1] - base[1]) / base[1] * 100;
  }

  function loadLongPerf(asset) {
    if (!$$('[class*="dxa-perf-cell"]').length) return;   // both layouts — see paintPerf
    fetch('/lxapi/xrplohlc?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&r=1Y&vs=XRP')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.pts || d.pts.length < 2) return;
        LONG['1m'] = changeOver(d.pts, 30);
        LONG['3m'] = changeOver(d.pts, 90);
        LONG['6m'] = changeOver(d.pts, 180);
        paintPerf(LASTD);
      })
      .catch(function () {});
  }

  // WHY THE FIGURES ARE MISSING, said once, instead of six dashes and an empty chart.
  //
  // RAZA on 2026-09-29: "Why's BCHAMP token not showing details". Because /lxapi/xrpltoken answers
  // {"ok":false,"error":"upstream 404"} for it — xrpl.to has no record of that token, which is what
  // happens to an asset with no market on the DEX. The page was right to show nothing, and wrong to
  // show nothing WITHOUT SAYING SO: four dashes, a blank chart and a dead swap panel are what a
  // broken page looks like, so a reader cannot tell a thin token from an outage.
  //
  // The description and issuer above still render, because those come from XRPLMeta rather than
  // xrpl.to — which is exactly why the page looked half-loaded rather than empty.
  // TWO DIFFERENT SILENCES, and they must not be told apart by guesswork.
  //
  // A token the feed has never heard of (upstream 404) has no market — that is a fact about the
  // token, and it is permanent until someone makes a market. A feed that refused THIS request is an
  // outage, and the same token will price fine on a reload. Both render as six dashes, which is why
  // RAZA asked "Why's BCHAMP token not showing details" — and BCHAMP turned out to have a perfectly
  // good market (0.00601582 XRP, $20,430 of 24h volume) that had simply failed to load that once.
  //
  // So the note says which one happened. Telling someone their token has no market when the feed
  // merely rate-limited us would be a confident falsehood about their asset, and xrpl.to's cap is
  // 333 requests a day per IP -- being refused is ordinary.
  function noMarketNote(kind) {
    var host = document.querySelector('.dxa-stats') || document.querySelector('[class*="dxa-stat"]');
    host = host && host.parentElement;
    var note = document.querySelector('.lx-nomarket');
    if (!kind) { if (note && note.parentNode) note.parentNode.removeChild(note); return; }
    if (!host) return;
    if (!note) {
      note = document.createElement('div');
      note.className = 'lx-nomarket';
      note.setAttribute('data-logoed', '1');
      note.style.cssText = 'margin:12px 0 0;padding:11px 14px;border-radius:12px;'
        + 'border:1px solid var(--border);background:var(--surface-2);'
        + 'font:400 12.5px/1.5 "Hanken Grotesk",system-ui,sans-serif;color:var(--text-soft)';
      host.appendChild(note);
    }
    note.textContent = kind === 'none'
      ? 'No market data for this token. It exists on the ledger, but no price feed tracks it — which '
        + 'usually means it has no order book or pool with meaningful depth. Its description and '
        + 'issuer above are read straight from the ledger.'
      : 'Market data could not be loaded just now — the price feed did not answer. The token and its '
        + 'issuer above are read from the ledger and are unaffected. Reloading usually fixes it.';
  }

  function paintStats(d) {
    if (!d) {
      ['price', '24h change', '24h volume', 'market cap', 'liquidity', 'supply']
        .forEach(function (n) { setCell(n, null, '', ''); });
      noMarketNote(window.__lxxAssetMiss === 'none' ? 'none' : 'down');
      return;
    }
    noMarketNote(null);
    var usd = (d.price && d.usd) ? (d.usd / d.price) : null;   // USD per XRP, from this token's pair

    setCell('price', d.price == null ? null : xrp(d.price, 6) + ' ', 'XRP',
      d.usd == null ? '' : money(d.usd));

    if (d.p24 == null) setCell('24h change', null, '', '');
    else setCell('24h change', (d.p24 >= 0 ? '+' : '') + d.p24.toFixed(2) + '%', '',
      d.price == null ? '' : ((d.p24 >= 0 ? '+' : '') + xrp(d.price * d.p24 / 100, 6) + ' XRP'),
      d.p24 >= 0 ? 'up' : 'down');

    setCell('24h volume', d.vol24 == null ? null : statAmt(d.vol24) + ' ', 'XRP',
      (d.vol24 != null && usd) ? money(d.vol24 * usd) : '');

    setCell('market cap', d.marketcap == null ? null : statAmt(d.marketcap) + ' ', 'XRP',
      (d.marketcap != null && usd) ? money(d.marketcap * usd) : '');

    setCell('liquidity', d.tvl == null ? null : statAmt(d.tvl) + ' ', 'XRP',
      (d.tvl != null && usd) ? money(d.tvl * usd) : '');

    // THE SUB-LINE SAYS WHICH SUPPLY THIS IS, NOT HOW MANY HOLD IT (RAZA 2026-10-06: "In supply box on
    // the right end, on Stellar we're not showing number of holders ... we've already got that covered
    // below on the page").
    //
    // Read off lumoscore.com's AQUA page: "80.05B" over "AQUA issued". Ours said "8,733 holders", which
    // is both a different fact from the one above it and the same fact as the holders section further
    // down — the box was answering a question the page answers twice already.
    setCell('supply', d.circulating == null ? null : statAmt(d.circulating) + ' ', d.name || '',
      d.name ? (d.name + ' issued') : '');
  }

  // ---- the price chart ----------------------------------------------------------------------------
  //
  // THE BIGGEST THING ON THE PAGE WAS AN EMPTY BOX, and that is what "the page doesn't load" looked
  // like. The design's own chart was gated shut by `#dxaChart:not(.lxda) svg{visibility:hidden}` —
  // correctly, because its contents are mock: gridlines labelled 4.61 / 4.56, which are Aptos prices.
  // Nothing here ever replaced them, so the gate stayed shut and the reader got 395px of nothing
  // above a real order book.
  //
  // The data existed the whole time. /lxapi/xrplohlc serves per-token history — the $LUMOS page's
  // chart is built on it — and it takes `iss` + `cur` and derives the upstream's token id at the
  // edge. For ARMY it returns 168 real points. It was simply never called from this page.
  //
  // Drawn into the design's own SVG at its own viewBox, with the same gridline/label structure it
  // ships, so nothing new is introduced: only the numbers become real.
  var CH_RANGE = { '1D': '24H', '1W': '7D', '1M': '30D', '1Y': '1Y', 'ALL': 'ALL' };
  var chGen = 0;
  // What the chart plots and in which unit: Stellar's Price/MCap and $/XLM controls, with XRP. Opens on
  // 1D, which is the range lumoscore.com has selected on arrival.
  var CH_VIEW = { metric: 'price', vs: 'XRP', supply: 0, label: '1D', type: 'area' };
  // THE LINE / CANDLE TOGGLE (RAZA 2026-09-15: "when i switch to candlestick, the charts just disappears"). The design's own
  // handler redrew its mock into the box; the click is taken first and this token's candles are drawn instead.
  if (!window.__lxxChartType) {
    window.__lxxChartType = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button[data-type="area"], button[data-type="candle"]');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(b.parentNode.querySelectorAll('button[data-type]'), function (x) { x.classList.toggle('active', x === b); });
      CH_VIEW.type = b.getAttribute('data-type') === 'candle' ? 'candle' : 'area';
      if (typeof lastRawPts !== 'undefined' && lastRawPts) drawChart(lastRawPts);
    }, true);
  }

  // THE CHART TAKES UP THE SLACK (RAZA 2026-09-15: "there's again a lot of empty space below the price change boxes").
  // The page's left card is stretched to the height of the trade panel beside it; when a token's header is short —
  // no description, as USDC's — the card ran ~140px past its last row. Measured at 1920px: card bottom 1126, the %
  // boxes' card 988. The chart grows by exactly the slack instead, and is REDRAWN in the taller box rather than
  // stretched (its SVG has preserveAspectRatio="none", so stretching would squash its labels). 28px is the card's
  // own bottom padding, measured where nothing is stretched.
  var NATURAL_H = 395, lastRawPts = null, fitWired = false, fitTimer = null;
  function chartH(svg) {
    var h = svg && parseFloat(svg.style.height);
    return h > NATURAL_H ? Math.round(380 * h / NATURAL_H) : 380;
  }
  function fitChartHeight() {
    // RETIRED (RAZA 2026-09-15: "This section is bigger than on Stellar. Due to which theres also blank space below promoted
    // box. Make it identical to Stellar chart size"). The chart keeps lumoscore.com's fixed height; any height an earlier
    // version set is taken back off. The code below stays unreachable rather than deleted, as the record of the attempt.
    var c0 = chartSvg();
    if (c0 && c0.host && c0.host.style.height) {
      c0.host.style.height = '';
      c0.svg.style.height = '';
      if (lastRawPts) drawChart(lastRawPts);
    }
    return;
    var c = chartSvg(), ah = $('.asset-header'), perf = $('.dxa-perf-card');
    if (!c || !c.svg || !ah || !perf || c.host.id !== 'dxaChart') return;
    if (!fitWired) {
      fitWired = true;
      var again = function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitChartHeight, 120); };
      window.addEventListener('resize', again);
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(again);
        [$('.dxa-trade-col'), $('.asset-header-top')].forEach(function (n) { if (n) ro.observe(n); });
      }
    }
    var grid = ah.parentElement;
    var twoCols = grid && getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    // THE BOX, NOT ONLY THE DRAWING. #dxaChart carries a fixed 395px height of its own, so growing the SVG alone
    // changed nothing in the layout — the slack stayed, and every resize grew the SVG again. Both move together
    // now, and the growth is capped so no measurement can run it away.
    var cur = parseFloat(c.host.style.height) || NATURAL_H;
    var want = NATURAL_H;
    if (twoCols) {
      var slack = ah.getBoundingClientRect().bottom - perf.getBoundingClientRect().bottom - 28;
      want = Math.min(NATURAL_H + 320, Math.max(NATURAL_H, Math.round(cur + slack)));
    }
    if (Math.abs(want - cur) < 4) return;
    var hv = want > NATURAL_H ? (want + 'px') : '';
    c.host.style.height = hv;
    c.svg.style.height = hv;
    if (lastRawPts) drawChart(lastRawPts);
  }

  function chartSvg() {
    var host = document.getElementById('dxaChart') || document.getElementById('mdxaChart');
    return host ? { host: host, svg: host.querySelector('svg') } : null;
  }

  function drawChart(pts) {
    var c = chartSvg();
    if (!c || !c.svg || !pts || pts.length < 2) return;
    lastRawPts = pts;

    // The price band stops above a volume band, as on lumoscore.com (RAZA 2026-09-15: "volume bars missing").
    var W = 900, H = chartH(c.svg), L = 18, R = 836, T = 16, VB = H - 30, VH = 64, B = VB - VH - 12;
    // MCap is the same series times circulating supply — the definition Stellar's tooltip states.
    var K = (CH_VIEW.metric === 'mcap' && CH_VIEW.supply > 0) ? CH_VIEW.supply : 1;
    if (K !== 1) pts = pts.map(function (p) { return [p[0], p[1] * K, p[2] * K, p[3] * K, p[4] * K, p[5]]; });
    var axisTxt = function (v) { return (CH_VIEW.vs === 'USD' ? '$' : '') + (K !== 1 ? amount(v) : xrp(v, 5)); };
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    if (CH_VIEW.type === 'candle') {
      pts.forEach(function (p) {
        if (isFinite(p[2]) && p[2] > 0 && p[2] > hi) hi = p[2];
        if (isFinite(p[3]) && p[3] > 0 && p[3] < lo) lo = p[3];
      });
    }
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0], tspan = (t1 - t0) || 1;
    var y = function (v) { return span > 0 ? B - ((v - lo) / span) * (B - T) : (T + B) / 2; };

    // THE BRAND ACCENT, NOT GREEN-OR-RED. This line was coloured by direction — green if the range
    // closed higher, red if lower — and lumoscore.com never does that: its chart is always
    // `var(--accent,#ea6a2c)` with the same accent fading out underneath (0.20 to 0), read off the live
    // Stellar page. RAZA 2026-09-15: "WTF does the chart have red line. We dont have that on Stellar."
    // The direction is still on the page, in the 24h change beside the price.
    var s = '<defs><linearGradient id="dxaAreaGrad" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="var(--accent,#ea6a2c)" stop-opacity="0.20"></stop>'
      + '<stop offset="100%" stop-color="var(--accent,#ea6a2c)" stop-opacity="0"></stop></linearGradient></defs>';

    // Five gridlines, labelled with REAL prices off this series rather than the design's constants.
    for (var g = 0; g < 5; g++) {
      var gv = hi - (span * g / 4), gy = y(gv);
      s += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + R + '" y2="' + gy.toFixed(1)
        + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,5" class="lxda-candle"></line>'
        + '<text x="842" y="' + (gy + 3).toFixed(1) + '" font-size="10" fill="var(--text-soft)"'
        + ' font-family="JetBrains Mono, monospace">' + axisTxt(gv) + '</text>';
    }

    // Volume, square-root scaled like Stellar's band so an ordinary session still shows beside the outlier,
    // green when that close is at or above the one before it. xrplohlc's volume is in TOKEN units whatever
    // the price unit (measured: identical sums for vs=XRP and vs=USD), so only its shape is drawn here.
    var vmax = 0;
    for (var vi = 0; vi < pts.length; vi++) { var vv0 = +pts[vi][5] || 0; if (vv0 > vmax) vmax = vv0; }
    if (vmax > 0) {
      var bw = Math.max(1, Math.min(14, (R - L) / pts.length * 0.62)), vroot = Math.sqrt(vmax);
      for (var bi = 0; bi < pts.length; bi++) {
        var bv = +pts[bi][5] || 0;
        if (!(bv > 0)) continue;
        var bx = L + ((pts[bi][0] - t0) / tspan) * (R - L);
        var bh = Math.max(3, (Math.sqrt(bv) / vroot) * VH);
        var upv = bi === 0 || pts[bi][1] >= pts[bi - 1][1];
        s += '<rect class="lxda-vol" x="' + (bx - bw / 2).toFixed(1) + '" y="' + (VB - bh).toFixed(1)
          + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (upv ? '#22c55e' : '#ff5b5b')
          + '" fill-opacity="0.5"></rect>';
      }
    }

    var line = '';
    for (var j = 0; j < pts.length; j++) {
      var px = L + ((pts[j][0] - t0) / tspan) * (R - L);
      line += (j ? ' L' : 'M') + px.toFixed(1) + ' ' + y(pts[j][1]).toFixed(1);
    }
    // The accent goes in a style declaration as well as the attribute: chart.js records that a var()
    // inside an SVG presentation attribute can leave a path uncoloured, so the attribute carries the
    // literal fallback and the style carries the theme token.
    if (CH_VIEW.type === 'candle') {
      // xrplohlc candles are [t, close, high, low, open, volume]; a candle missing its open opens at the close before it.
      var cdw = Math.max(1.5, Math.min(12, (R - L) / pts.length * 0.62));
      for (var cdi = 0; cdi < pts.length; cdi++) {
        var cdp = pts[cdi], cdx = L + ((cdp[0] - t0) / tspan) * (R - L);
        var cdc = cdp[1];
        var cdo = (isFinite(cdp[4]) && cdp[4] > 0) ? cdp[4] : (cdi ? pts[cdi - 1][1] : cdc);
        var cdh = (isFinite(cdp[2]) && cdp[2] > 0) ? cdp[2] : Math.max(cdo, cdc);
        var cdl = (isFinite(cdp[3]) && cdp[3] > 0) ? cdp[3] : Math.min(cdo, cdc);
        var cdcol = cdc >= cdo ? '#22c55e' : '#ff5b5b';
        var cdyt = y(Math.max(cdo, cdc)), cdyb = y(Math.min(cdo, cdc));
        s += '<line class="lxda-candle lxda-cwick" x1="' + cdx.toFixed(1) + '" x2="' + cdx.toFixed(1) + '" y1="' + y(cdh).toFixed(1) + '" y2="' + y(cdl).toFixed(1)
          + '" stroke="' + cdcol + '" stroke-width="1"></line>'
          + '<rect class="lxda-candle lxda-cbody" x="' + (cdx - cdw / 2).toFixed(1) + '" y="' + cdyt.toFixed(1) + '" width="' + cdw.toFixed(1)
          + '" height="' + Math.max(1, cdyb - cdyt).toFixed(1) + '" fill="' + cdcol + '"></rect>';
      }
    } else {
      s += '<path d="' + line + ' L' + R + ' ' + B + ' L' + L + ' ' + B + ' Z" fill="url(#dxaAreaGrad)" class="lxda-area"></path>'
        + '<path d="' + line + '" fill="none" stroke="#ea6a2c" style="stroke:var(--accent,#ea6a2c)" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round" class="lxda-line"></path>';
    }

    c.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    c.svg.innerHTML = s;
    // Only now is the gate lifted: the box stays hidden while it holds the design's Aptos prices,
    // and opens the moment it holds this token's own.
    c.host.classList.add('lxda');
    wireChartHover(c.host, { pts: pts, L: L, R: R, t0: t0, tspan: tspan, y: y, K: K });

    // THE SNAPSHOT CAMERA IS STELLAR'S OWN LAYER (lx-snap), inherited intact. It reads the plotted series
    // off the chart element in USD per unit, plus four page globals, and places its button beside the
    // $/XRP tray by itself — so publishing these is all it needs.
    try {
      var d0 = window.__lxxAssetData, a0 = window.__lxxAssetRef;
      var usdPerXrp = (d0 && d0.price && d0.usd) ? d0.usd / d0.price : 0;
      // THIS PAGE LEARNS THE XRP/USD RATE FOR FREE, from the asset payload it already has, so it
      // feeds the shared cache rather than keeping it. Every other page gates its USD figures on one
      // metered call to xrpl.to (333/day/IP), and a visit here warms that cache for all of them.
      if (usdPerXrp > 0 && window.lxx && window.lxx.usdSave) window.lxx.usdSave(usdPerXrp);
      c.host.__lxpts = pts.map(function (p) {
        return { t: p[0], v: CH_VIEW.vs === 'USD' ? p[1] : p[1] * usdPerXrp, vol: isFinite(p[5]) ? p[5] : 0 };
      });
      window.__lxDXAxlmUsd = usdPerXrp;
      window.__lxAsDenom = CH_VIEW.vs === 'USD' ? 'usd' : 'xlm';
      if (a0) { window.__lxDXAcode = a0.code; window.__lxDXAissuer = a0.issuer; }
    } catch (e) {}
  }

  // THE HOVER READOUT (RAZA 2026-09-15: "where's the chart hover that we also have on Stellar"). Stellar's own
  // elements — .lxda-chtip / .lxda-chdot / .lxda-chvl, styled by the inherited sheet — with the date, the
  // price in the chart's unit and dollars beneath it, and that bucket's volume in dollars.
  function tipDate(ms) {
    try {
      var o = (CH_VIEW.label === '1D' || CH_VIEW.label === '1W')
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(ms).toLocaleString('en-US', o);
    } catch (e) { return ''; }
  }
  function usdCompact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function tipEl(cls, text) {
    var e = el('div', cls, text);
    e.setAttribute('data-logoed', '1');                         // "Price" is five letters: keep the logo healer off
    return e;
  }
  // TRADES PER CANDLE (RAZA 2026-09-15: "Number of trades is missing in chart hover"). xrpl.to's candles carry
  // no count, so the hovered candle's is asked for when it is hovered: /lxapi/xrpltrades reads the trade history's
  // own total for that window and caches it. Debounced, so sweeping across the chart asks once, for where it stops.
  var TRADES = {}, tradeTimer = null, tradeWaiting = {}, prefetchGen = 0;
  // Every candle's count for the range just drawn, forty windows per request, in order. Ranges longer than a week of
  // hourly candles are left to the hover, to keep the upstream cost of one page view bounded.
  function prefetchTrades(pts) {
    var a = window.__lxxAssetRef;
    if (!a || !a.issuer || !pts || pts.length < 2 || pts.length > 170) return;
    var step = pts[1][0] - pts[0][0];
    var bounds = pts.map(function (q) { return q[0]; });
    bounds.push(pts[pts.length - 1][0] + step);
    var chunks = [];
    // Twelve windows per request, the endpoint's cap (a forty-window batch outran the free plan's fifty subrequests and
    // came back null after the eighteenth), three requests at a time.
    for (var i = 0; i < bounds.length - 1; i += 12) chunks.push(bounds.slice(i, Math.min(bounds.length, i + 13)));
    var gen = ++prefetchGen, nextK = 0;
    var worker = function () {
      if (nextK >= chunks.length || gen !== prefetchGen) return;
      var ch = chunks[nextK++];
      fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(currencyOf(a.code))
        + '&b=' + ch.join(','))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.n) return;
          d.n.forEach(function (n, j) { if (n != null) TRADES[a.issuer + '|' + a.code + '|' + ch[j] + '|' + ch[j + 1]] = n; });
        }, function () {})
        .then(worker);
    };
    worker(); worker(); worker();
  }
  // ONE WINDOW'S COUNT, ASKED AGAIN IF IT FAILS (RAZA 2026-09-15: "sometimes the number of trades appear in chart hover and
  // sometimes it doesnt"). Every candle of a range used to be fetched as the chart drew — up to 170 calls to an upstream
  // that allows two a second — so a burst came back empty, and the same burst starved the Exchanges tab beside it.
  function tradeCount(a, s, e, tries) {
    return fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(currencyOf(a.code))
      + '&s=' + Math.round(s) + '&e=' + Math.round(e))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && !d.truncated && d.n != null) return +d.n;
        if (d && d.ok && d.truncated) return null;
        throw new Error('retry');
      })
      .catch(function () {
        if (!(tries > 0)) return null;
        return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return tradeCount(a, s, e, tries - 1); });
      });
  }

  function tradesFor(key, a, s, e, cb) {
    clearTimeout(tradeTimer);
    tradeTimer = setTimeout(function () {
      if (tradeWaiting[key]) { tradeWaiting[key].push(cb); return; }
      tradeWaiting[key] = [cb];
      tradeCount(a, s, e, 2)
        .then(function (n) {
          if (n != null) TRADES[key] = n;
          var cbs = tradeWaiting[key] || [];
          delete tradeWaiting[key];
          cbs.forEach(function (f) { f(n); });
        });
    }, 140);
  }

  function wireChartHover(host, st) {
    host.__lxxHov = st;
    ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (cls) {
      if (!host.querySelector('.' + cls)) host.appendChild(el('div', cls));
    });
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
    function hide() {
      ['lxda-chtip', 'lxda-chdot', 'lxda-chvl'].forEach(function (c2) { var n = host.querySelector('.' + c2); if (n) n.style.opacity = 0; });
    }
    function move(cx, cy) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      var tip = host.querySelector('.lxda-chtip'), dot = host.querySelector('.lxda-chdot'), vl = host.querySelector('.lxda-chvl');
      if (!S || !svg || !tip || !dot || !vl) return;
      var m = null;
      try { m = svg.getScreenCTM(); } catch (e) {}
      if (!m) return;
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      var vx = pt.matrixTransform(m.inverse()).x;
      var P = S.pts, best = 0, bd = Infinity;
      for (var i = 0; i < P.length; i++) {
        var dx = Math.abs(S.L + ((P[i][0] - S.t0) / S.tspan) * (S.R - S.L) - vx);
        if (dx < bd) { bd = dx; best = i; }
      }
      var p = P[best];
      var sp = svg.createSVGPoint();
      sp.x = S.L + ((p[0] - S.t0) / S.tspan) * (S.R - S.L);
      sp.y = S.y(p[1]);
      var scr = sp.matrixTransform(m), hr = host.getBoundingClientRect();
      var lx = scr.x - hr.left, ly = scr.y - hr.top;
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = 1;
      vl.style.left = lx + 'px'; vl.style.opacity = 1;

      var d = window.__lxxAssetData, usdPerXrp = (d && d.price && d.usd) ? d.usd / d.price : 0;
      var inUsd = CH_VIEW.vs === 'USD', mcap = S.K !== 1;
      var head = inUsd ? ('$' + (mcap ? amount(p[1]) : xrp(p[1], 6))) : ((mcap ? amount(p[1]) : xrp(p[1], 6)) + ' XRP');
      var sub = (!inUsd && usdPerXrp > 0) ? (mcap ? usdCompact(p[1] * usdPerXrp) : ('$' + xrp(p[1] * usdPerXrp, 6))) : '';
      var unitUsd = (inUsd ? p[1] : p[1] * usdPerXrp) / S.K;     // one token, in dollars, at this point
      // xrplohlc's volume column is in XRP, not token units: LUMOS's last 24 hourly values x XRP/USD equal its published
      // 24h volume ($4.64 vs $4.65); read as LUMOS they came to $0.00007.
      var volUsd = (+p[5] || 0) * usdPerXrp;
      tip.textContent = '';
      tip.appendChild(tipEl('d', tipDate(p[0])));
      tip.appendChild(tipEl('l', mcap ? 'Market cap' : 'Price'));
      tip.appendChild(tipEl('p', head));
      if (sub) tip.appendChild(tipEl('v', sub));
      if (volUsd > 0) {
        var row = el('div', 'lxrow');
        row.appendChild(tipEl('l', 'Volume'));
        row.appendChild(tipEl('p', usdCompact(volUsd)));
        tip.appendChild(row);
      }
      var step = P.length > 1 ? (P[1][0] - P[0][0]) : 0, a0 = window.__lxxAssetRef;
      if (step > 0 && a0 && a0.issuer) {
        var ts = p[0], te = best < P.length - 1 ? P[best + 1][0] : p[0] + step;
        var tkey = a0.issuer + '|' + a0.code + '|' + ts + '|' + te;
        tip.__lxxKey = tkey;
        // NO PLACEHOLDER (RAZA 2026-09-15: "for split seconds it shows 3 dots instead of trades count"). The row appears
        // with its number or not at all; the counts for the whole range are fetched as soon as the chart draws
        // (prefetchTrades), so a hovered candle's count is normally already here.
        if (TRADES[tkey] != null) {
          var trow = el('div', 'lxrow lxx-trades-row');
          trow.appendChild(tipEl('l', 'Trades'));
          trow.appendChild(tipEl('p', TRADES[tkey].toLocaleString('en-US')));
          tip.appendChild(trow);
        } else {
          tradesFor(tkey, a0, ts, te, function (n) {
            if (tip.__lxxKey !== tkey || n == null || tip.querySelector('.lxx-trades-row')) return;
            var trow2 = el('div', 'lxrow lxx-trades-row');
            trow2.appendChild(tipEl('l', 'Trades'));
            trow2.appendChild(tipEl('p', n.toLocaleString('en-US')));
            tip.appendChild(trow2);
          });
        }
      }
      tip.style.opacity = 1;
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = lx + 14;
      if (tx + tw > hr.width) tx = lx - tw - 14;
      if (tx < 2) tx = 2;
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(2, ly - th - 12) + 'px';
    }
    // A browser follows a touch with synthetic mouse events, so the mouseleave after a finger lifts would
    // erase the reading the tap was for; Stellar ignores it for 1.5s after a touch, and so does this.
    var touchAt = 0, tp0 = null;
    host.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    host.addEventListener('mouseleave', function () { if (Date.now() - touchAt < 1500) return; hide(); });
    host.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now(); tp0 = { x: t.clientX, y: t.clientY }; move(t.clientX, t.clientY);
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0]; if (!t) return;
      touchAt = Date.now();
      if (tp0 && Math.abs(t.clientX - tp0.x) > Math.abs(t.clientY - tp0.y)) { try { e.preventDefault(); } catch (x) {} }
      move(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('#dxaChart, #mdxaChart')) return;
      hide();
    }, true);
  }

  // THE PRICE LINE ABOVE THE CHART (RAZA 2026-09-15: "The section above the chart is different on
  // Stellar"). lumoscore.com leads the chart with the price in large type, a 24h change pill, and a meta
  // line — "0.0222866 XLM per VELO · 1D High 0.0239707 XLM · Low 0.021825 XLM". The design ships all three
  // (`.price-display .big`, `.change-pill`, `.meta`) holding Aptos mock behind `:not(.lxp)` gates, so
  // they were invisible here rather than wrong. Filled and released.
  function paintChartHead(pts) {
    var pd = $('.price-display');
    var d = window.__lxxAssetData, a = window.__lxxAssetRef;
    if (!pd || !d || !a || d.price == null) return;
    var usd = CH_VIEW.vs === 'USD';
    var priceTxt = usd ? (d.usd != null ? money(d.usd) : '—') : (xrp(d.price, 6) + ' XRP');

    var big = pd.querySelector('.big');
    if (big) { plain(big, priceTxt); big.classList.add('lxp'); }

    var pill = pd.querySelector('.change-pill');
    if (pill && d.p24 != null && isFinite(d.p24)) {
      plain(pill, (d.p24 >= 0 ? '▲ ' : '▼ ') + Math.abs(d.p24).toFixed(2) + '% (24h)');
      pill.className = 'change-pill lxp ' + (d.p24 >= 0 ? 'up' : 'down');
    }

    var meta = pd.querySelector('.meta');
    if (meta && pts && pts.length) {
      var hi = null, lo = null;
      for (var i = 0; i < pts.length; i++) {
        var h = (isFinite(pts[i][2]) && pts[i][2] > 0) ? pts[i][2] : pts[i][1];
        var l = (isFinite(pts[i][3]) && pts[i][3] > 0) ? pts[i][3] : pts[i][1];
        if (hi == null || h > hi) hi = h;
        if (lo == null || l < lo) lo = l;
      }
      var U = function (v) { return usd ? ('$' + xrp(v, 6)) : (xrp(v, 6) + ' XRP'); };
      meta.textContent = '';
      meta.appendChild(el('span', 'lx-pairpx', priceTxt + ' per ' + a.code + ' · '));
      meta.appendChild(document.createTextNode(CH_VIEW.label + ' High '));
      var bh = el('b', 'mono lxp', U(hi)); bh.style.color = 'var(--text)'; bh.setAttribute('data-logoed', '1');
      meta.appendChild(bh);
      meta.appendChild(document.createTextNode(' · Low '));
      var bl = el('b', 'mono lxp', U(lo)); bl.style.color = 'var(--text)'; bl.setAttribute('data-logoed', '1');
      meta.appendChild(bl);
    }
  }

  // Stellar's two trays, in the controls row ahead of the line/candle toggle — the same classes
  // (`.lxda-metric`, `.lxda-denom`) its stylesheet already dresses. data-logo on each keeps the logo
  // engine from emptying "$" and "XRP".
  function chartControls(asset) {
    var row = $('.chart-controls');
    if (!row) return;
    if (!$('.lxda-metric', row)) {
      var before = row.querySelector('.chart-tools:not(.lxda-metric):not(.lxda-denom):not(.lxda-snap)') || null;
      var g = el('div', 'chart-tools lxda-metric');
      g.setAttribute('data-logo', '');
      g.innerHTML = '<button type="button" data-metric="price" data-logo="">Price</button>'
        + '<button type="button" data-metric="mcap" data-logo="" title="Market cap = price x circulating supply">MCap</button>';
      var dn = el('div', 'chart-tools lxda-denom');
      dn.setAttribute('data-logo', '');
      dn.innerHTML = '<button type="button" data-cdn="usd" data-logo="">$</button>'
        + '<button type="button" data-cdn="xrp" data-logo="">XRP</button>';
      row.insertBefore(g, before);
      row.insertBefore(dn, before);
    }
    if (!window.__lxxChartCtl) {
      window.__lxxChartCtl = 1;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var m = t.closest('[data-metric]'), dv = t.closest('[data-cdn]');
        if (!m && !dv) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (m) {
          if (m.disabled) return;
          CH_VIEW.metric = m.getAttribute('data-metric') === 'mcap' ? 'mcap' : 'price';
        }
        if (dv) CH_VIEW.vs = dv.getAttribute('data-cdn') === 'usd' ? 'USD' : 'XRP';
        loadChart(asset, CH_VIEW.label);
      }, true);
    }
    syncChartControls();
  }

  function syncChartControls() {
    var d = window.__lxxAssetData;
    CH_VIEW.supply = (d && d.circulating > 0) ? +d.circulating : 0;
    $$('.lxda-metric button[data-metric]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-metric') === CH_VIEW.metric);
      if (b.getAttribute('data-metric') === 'mcap') {
        b.disabled = !(CH_VIEW.supply > 0);
        b.title = CH_VIEW.supply > 0 ? 'Market cap = price x circulating supply' : 'Supply not known yet';
      }
    });
    $$('.lxda-denom button[data-cdn]').forEach(function (b) {
      b.classList.toggle('active', (b.getAttribute('data-cdn') === 'usd') === (CH_VIEW.vs === 'USD'));
    });
    $$('.timeframes button[data-period]').forEach(function (b) {
      b.classList.toggle('active', String(b.getAttribute('data-period') || '').toUpperCase() === CH_VIEW.label);
    });
  }

  function loadChart(asset, label, attempt) {
    var c = chartSvg();
    if (!c) return;
    CH_VIEW.label = String(label || CH_VIEW.label || '1D').toUpperCase();
    syncChartControls();
    var r = CH_RANGE[CH_VIEW.label] || '24H';
    var gen = ++chGen;
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 10000);
    fetch('/lxapi/xrplohlc?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&r=' + r + '&vs=' + CH_VIEW.vs, ctl ? { signal: ctl.signal } : undefined)
      .then(function (res) { return res.json(); })
      .then(function (d) {
        if (gen !== chGen) return;                       // a later range or unit button won
        if (d && d.ok && d.pts && d.pts.length > 1) { drawChart(d.pts); paintOhlcStrip(d.pts); paintChartHead(d.pts); fitChartHeight(); }
        else if (!(d && d.ok)) throw new Error('upstream');
      })
      .catch(function () {
        // A FAILED OR STALLED ANSWER IS ASKED AGAIN (RAZA 2026-09-15: "its taking forever to load the chart when i switched
        // to 1M"). The request used to fail once and leave the design's placeholder axes up with nothing ever drawn.
        if (gen !== chGen || (attempt || 0) >= 3) return;
        setTimeout(function () {
          if (gen !== chGen) return;
          chGen--;                                         // the retry keeps this click's generation
          loadChart(asset, label, (attempt || 0) + 1);
        }, 900 * ((attempt || 0) + 1));
      });
  }

  // The O/H/L/C/Δ/Vol strip above the chart, for the range CURRENTLY PLOTTED — so it moves with the
  // 1D/1W/1M/1Y buttons instead of being a fixed 24h figure that contradicts the chart beside it.
  //
  // Only H and L are visible on desktop; O, C, Δ and Vol belong to the phone layout, which is
  // exactly why they went unnoticed. See [[lumoscore-hidden-mock-sweep]] — a desktop-only check
  // cannot see them.
  //
  // Each value falls back to the close when its index is missing (a cached short response, or a
  // candle the upstream returned with nulls), so the figures are always within the real range even
  // if a stale colo is still serving two-element points.
  function paintOhlcStrip(pts) {
    var hi = null, lo = null, vol = 0, haveVol = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var h = (isFinite(p[2]) && p[2] > 0) ? p[2] : p[1];
      var l = (isFinite(p[3]) && p[3] > 0) ? p[3] : p[1];
      if (hi == null || h > hi) hi = h;
      if (lo == null || l < lo) lo = l;
      if (isFinite(p[5]) && p[5] >= 0) { vol += p[5]; haveVol = true; }
    }
    if (hi == null || lo == null) return;

    var first = pts[0], last = pts[pts.length - 1];
    var open = (isFinite(first[4]) && first[4] > 0) ? first[4] : first[1];
    var close = last[1];
    var delta = (open > 0) ? ((close - open) / open * 100) : null;

    var inUsd = CH_VIEW.vs === 'USD';
    // BARE FIGURES, as lumoscore.com prints them — "H 0.001899", no "XLM" after (RAZA 2026-09-15). The unit
    // is already on the chart and in the price line above it; only the $ view keeps its sign.
    var P5 = function (v) { return (inUsd ? '$' : '') + xrp(v, 5); };
    var VAL = {
      'O': P5(open),
      'H': P5(hi),
      'L': P5(lo),
      'C': P5(close),
      'Δ': (delta == null) ? '—' : ((delta >= 0 ? '+' : '') + delta.toFixed(2) + '%'),
      'VOL': haveVol ? amount(vol) : '—',                     // token units, as xrplohlc returns it
    };

    // The value is the row's other child — the one that is not the `.k` label.
    $$('.pair').forEach(function (row) {
      var k = row.querySelector('.k');
      if (!k) return;
      var which = (k.textContent || '').trim().toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(VAL, which)) return;
      var v = null;
      [].forEach.call(row.children, function (ch) { if (ch !== k) v = ch; });
      if (!v) return;
      plain(v, VAL[which]);
      try { v.classList.add('lxp'); } catch (e) {}
      if (which === 'Δ' && delta != null) {
        row.classList.remove('up', 'down');
        row.classList.add(delta >= 0 ? 'up' : 'down');
      }
    });
  }

  function wireChartRanges(asset) {
    if (window.__lxxDxaRanges) return;
    window.__lxxDxaRanges = 1;
    var btns = $$('button, .tf-btn, .range-btn').filter(function (b) {
      return /^(1D|1W|1M|1Y|ALL)$/i.test((b.textContent || '').trim());
    });
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.classList.toggle('active', o === b); });
        loadChart(asset, (b.textContent || '').trim());
      });
    });
  }

  // ---- Exchanges ----------------------------------------------------------------------------------
  //
  // The tab shipped fifteen mock rows — "0x00…665c ▲ Buy 4.1820 APT 18 USDC just now" — EVM wallets
  // trading Aptos against USDC, on a page about one XRP Ledger token. It was gated shut by
  // `#dxaExTable:not(.lxda) tr{visibility:hidden}`, which is why it read as an empty panel rather
  // than as wrong data. Now filled from /lxapi/xrplhistory and the gate is lifted only once real
  // rows are in.
  //
  // THE DESIGN'S OWN ROW IS CLONED, not rebuilt. Taking the first row as a template keeps the
  // identicon, the badge, the mono spans and the explorer button exactly as they ship, and only the
  // text changes — no new markup, and nothing to drift from the design.
  //
  // BUY OR SELL IS RELATIVE TO THIS PAGE'S TOKEN, which is why the edge does not decide it: if the
  // taker RECEIVED this token it is a buy, if they paid it away it is a sell. The other side is the
  // quote, and its name is printed beside the price because these are not all XRP pairs — ARMY trades
  // against CRAP, PHNI and XUSD as well, and a CRAP-denominated price under a bare "Price" heading
  // would read as XRP.

  function ago(ms) {
    if (!ms || !isFinite(ms)) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function curName(c) {
    if (!c || c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(c).display; } catch (e) { return c.slice(0, 6); }
  }

  // THE PHONE HAS A COMPLETELY DIFFERENT EXCHANGES CONTAINER, and naming only the desktop one left
  // fifteen rows of another chain's mock live on every mobile token page:
  //
  //     0x0f…3ce6  ▲ Buy  4.1820 APT  18 USDC  just now
  //
  // EVM addresses, APT prices and USDC amounts on an XRP Ledger token page. Desktop is a `<table>`
  // with `#dxaExTable` as its tbody; mobile is `#mdxaExList`, a div of `.ex-row` cards with the same
  // facts in different elements. `paintExchanges` looked up the tbody, found nothing, and returned —
  // which is why the mobile tab also still read "Exchanges 2.1k" while desktop read "—".
  //
  // Same fetch, same buy/sell decision, same numbers: only the writing differs, so the two layouts
  // cannot drift apart. Third instance of this trap — see [[lumoscore-hidden-mock-sweep]].
  // PAGES OF A HUNDRED in the panel's own footer (RAZA 2026-09-15: "Recent transactions and Pools, pagination is not
  // working"; then 2026-09-17: "you can show up to 100 transaction on the same page. no need for page 2 just for 22
  // transactions"). The rows are all in the table; the pager shows one page of them and says which — at fifteen a rummage
  // that found twenty-two trades still made the reader click to a second page for the last seven.
  var PAGE_PER = 100;
  // THE DESIGN REWRITES ITS SAMPLE TRADES WHENEVER THE EXCHANGES TAB IS OPENED (RAZA 2026-09-16, the XAH page: "0x00…665c · BUY ·
  // 4.1820 APT"). Our rows are kept and put back, with the table hidden between the design's write and ours.
  var EX_ROWS = null, EX_MIN = 0;
  // Paging state for "Keep looking" (RAZA 2026-09-16, item 4) and for the My Trades filter (item 7).
  var EX_TPL = null, EX_PAGE = 0, EX_DONE = false, EX_ASSET = null, EX_MINE = false;

  function myAddr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }

  // "MY TRADES" AT THE RIGHT OF THE TAB BAR (RAZA 2026-09-16: "Add My trades on the right side of recent activity on Trade-Asset
  // page. This is not specific to LumosCore but if that particular wallet address has trades that particular asset, it will be
  // shown here"). It is a filter over the same rows, so it needs no second feed: every row carries both counterparties.
  function ensureMyTrades() {
    var bar = document.querySelector('.tabs-bar');
    if (!bar || bar.querySelector('.lx-mytrades')) return;
    var b = el('button', 'lx-mytrades');
    b.type = 'button';
    b.textContent = 'My Trades';
    b.style.cssText = 'margin-left:auto;background:none;border:0;padding:6px 2px;font:inherit;font-size:13.5px;font-weight:700;'
      + 'color:var(--text);opacity:.6;cursor:pointer';
    bar.appendChild(b);
  }
  if (!window.__lxxMyTrades) {
    window.__lxxMyTrades = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.lx-mytrades');
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      EX_MINE = !EX_MINE;
      b.style.opacity = EX_MINE ? '1' : '.6';
      b.style.textDecoration = EX_MINE ? 'underline' : '';
      b.style.textUnderlineOffset = '5px';
      var bd = document.getElementById('dxaExTable');
      if (!bd) return;
      // Back to the Exchanges tab, where the rows are.
      var extab = document.querySelector('.tabs-bar .tab[data-tab="exchanges"]');
      if (extab && !extab.classList.contains('active')) extab.click();
      var mb = document.querySelector('.lx-exmore');
      if (mb) mb.style.display = EX_MINE ? 'none' : '';
      if (EX_MINE) {
        loadMyTrades(EX_ASSET);
      } else {
        bd.innerHTML = '';                                 // ours are gone; the token's feed comes back
        restoreEx();
        [].forEach.call(bd.children, function (r) { r.style.display = ''; });
        pageTable(bd, 'exchanges', 1);
      }
    }, true);
  }

  // MY TRADES COMES FROM THE WALLET'S OWN HISTORY, not from this token's feed. Measured on LUMOS: the feed fills about 150
  // legs a minute, so four pages of it reach back one minute — a trade made yesterday sits thousands of pages away and
  // filtering the feed would show "none" to someone who has traded this token all week. An account's own transactions are a
  // short list by comparison and contain every trade it ever made in this asset.
  function mtAmt(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { c: 'XRP', i: '', v: Number(a) / 1e6 };
    return { c: String(a.currency || ''), i: String(a.issuer || ''), v: Number(a.value) };
  }
  function mtNote(body, text) {
    body.innerHTML = '';
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxnote', '1');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    body.appendChild(tr);
    body.classList.add('lxda');
  }
  function loadMyTrades(asset) {
    var body = document.getElementById('dxaExTable');
    if (!body || !asset) return;
    var me = myAddr();
    if (!me) { mtNote(body, 'Connect a wallet to see your own trades in this asset.'); return; }
    mtNote(body, 'Reading your trades…');
    var ours = currencyOf(asset.code);
    rpc('account_tx', { account: me, limit: 200, binary: false, forward: false, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (res) {
        var out = [];
        (res.transactions || []).forEach(function (e) {
          var t = e.tx || e.tx_json || {}, m = e.meta || e.metaData || {};
          if ((m.TransactionResult || '') !== 'tesSUCCESS') return;    // a failed trade moved nothing
          var got = null, paid = null;
          if (t.TransactionType === 'Payment') {
            got = mtAmt(m.delivered_amount || m.DeliveredAmount);
            paid = mtAmt(t.SendMax);
            if (!paid) return;                                        // a plain transfer, not a conversion
          } else if (t.TransactionType === 'OfferCreate') {
            got = mtAmt(t.TakerPays); paid = mtAmt(t.TakerGets);
          } else return;
          if (!got || !paid || !(got.v > 0) || !(paid.v > 0)) return;
          var bought = got.c === ours && got.i === asset.issuer;
          var sold = paid.c === ours && paid.i === asset.issuer;
          if (!bought && !sold) return;
          out.push({
            bought: bought,
            mine: bought ? got : paid,
            other: bought ? paid : got,
            t: t.date != null ? (t.date + 946684800) * 1000 : 0,
            hash: t.hash || e.hash || ''
          });
        });
        if (!out.length) { mtNote(body, 'No trades in ' + asset.code + ' from this wallet.'); return; }
        body.innerHTML = '';
        out.forEach(function (h) {
          var row = EX_TPL ? EX_TPL.cloneNode(true) : null;
          if (!row) return;
          row.setAttribute('data-lxex', '1');
          row.setAttribute('data-lxwho', me + '|' + me);
          row.style.display = '';
          var otherXrp = h.other.c === 'XRP' ? h.other.v : null;
          if (otherXrp != null) row.setAttribute('data-lxxrp', String(otherXrp));
          var td = row.children;
          var wa = td[0] && td[0].querySelector('.wa');
          if (wa) wa.textContent = shortAddr(me);
          var wc = td[0] && td[0].querySelector('.wallet-cell');
          if (wc && wc.tagName === 'A') wc.href = '/account/xrpl/' + encodeURIComponent(me);
          var badge = td[1] && td[1].querySelector('.type-badge');
          if (badge) { badge.className = 'type-badge ' + (h.bought ? 'buy' : 'sell'); badge.textContent = h.bought ? '▲ Buy' : '▼ Sell'; }
          var pEl = td[2] && td[2].querySelector('.mono');
          if (pEl) pEl.textContent = otherXrp != null ? (xrp(otherXrp / h.mine.v, 5) + ' XRP')
            : (xrp(h.other.v / h.mine.v, 5) + ' ' + curName(h.other.c));
          var aEl = td[3] && td[3].querySelector('.mono');
          if (aEl) aEl.textContent = amount(h.mine.v) + ' ' + asset.code;
          if (td[3]) {
            var tot = td[3].querySelector('.lx-extot');
            if (!tot) { tot = el('span', 'lx-extot'); td[3].appendChild(tot); }
            plain(tot, (h.other.v >= 1000 ? amount(h.other.v) : xrp(h.other.v, 7)) + ' ' + curName(h.other.c));
          }
          var tEl = td[4] && td[4].querySelector('.time');
          if (tEl) tEl.textContent = ago(h.t);
          var lk = td[5] && td[5].querySelector('.row-link, a');
          if (lk && h.hash) {
            if (lk.tagName === 'A') lk.href = 'https://bithomp.com/explorer/' + encodeURIComponent(h.hash);
            else lk.setAttribute('data-lxtx', h.hash);
          }
          body.appendChild(row);
        });
        body.classList.add('lxda');
        pageTable(body, 'exchanges', 1);
      })
      .catch(function () { mtNote(body, 'Your trades could not be read right now.'); });
  }

  // STELLAR'S "KEEP LOOKING" (RAZA 2026-09-16: "it looks back to maybe hundreds or even thousands of transactions. And keeps
  // looking back couple thousands back if user keeps clicking keep looking. Its more better"). It sits at the right of the
  // panel foot, beside the pager, and each press walks one more page of the ledger's history into the same table.
  // PLACED AND STYLED AS ON STELLAR (RAZA 2026-09-17: "Keep looking button is not like Stellar"). lumoscore.com builds
  // `button.lx-exmore[data-lxc]` and inserts it immediately AFTER `#dxaPanelInfo` — the "Showing 1-4 of 4 recent trades"
  // line — and the inherited sheet already carries the pill styling for that exact class (bordered, surface-2, 12px/700).
  // Mine set its own inline styles, which overrode all of it and rendered as underlined text floated to the right.
  function exMore(host, state) {
    var foot = host && host.closest ? host.closest('.panel, section') : null;
    foot = foot ? foot.querySelector('.panel-foot') : null;
    if (!foot) return;
    var info = foot.querySelector('#dxaPanelInfo') || foot.querySelector('.info');
    var b = foot.querySelector('.lx-exmore');
    if (!b) {
      b = el('button', 'lx-exmore');
      b.type = 'button';
      b.setAttribute('data-lxc', '');
      if (info && info.parentNode) info.parentNode.insertBefore(b, info.nextSibling);
      else foot.appendChild(b);
    }
    // "Keep looking" walks the TOKEN's feed; with My Trades on the table is the wallet's own history, which is already whole.
    b.style.display = EX_MINE ? 'none' : '';
    b.disabled = state === 'busy' || state === 'end';
    b.textContent = state === 'busy' ? 'Looking…' : (state === 'end' ? 'No older trades' : 'Keep looking');
  }
  // ONE CLICK GOES DEEP, NOT ONE PAGE (RAZA 2026-09-17: "on XRPL you're checking very few transactions. i know that on
  // Stellar it goes back to hundreds or even thousands of transaction when i click keep looking").
  //
  // lumoscore.com does exactly this: its button adds three thousand trades to the scan budget and keeps scanning until the
  // size filter has enough. Mine fetched a single page of 40 legs per press, which against a "10+ XRP" filter on a busy
  // token is nearly nothing — your screenshot showed 5 matching rows after a press.
  //
  // So one press now walks up to TWELVE pages (480 legs) and stops early the moment the filter in force has 25 rows, the
  // ledger runs out of history, or the endpoint's 50-page ceiling is reached — 2,000 legs, which is as far back as this
  // feed goes. Sequential with a short gap between pages, because the upstream allows about two history calls a second.
  // FASTER, THE ONLY TWO WAYS THAT EXIST HERE (RAZA 2026-09-17: "for keep looking. XRP is taking too long. on Stellar its
  // way quicker"). A page is a round trip to a provider that allows about two calls a second, so depth-per-second is
  // page size × pages in flight. Both were as small as they could be: 40 legs, one at a time, with a 300ms pause between.
  //
  // Now 100 legs a page and THREE pages in flight per wave — 300 legs per round trip instead of 40, and no artificial
  // pause. Six waves per click is 1,800 legs, against 480 before, in roughly a third of the time.
  var EX_WAVES = 6, EX_PARALLEL = 3, EX_WANT = 25;
  var EX_WALKING = false;
  function keepLooking(body) {
    if (EX_WALKING) return;                              // a second click must not start a second walk over the same rows
    EX_WALKING = true;
    var wave = 0;
    // Done once, when the walk finishes — not per page. Paging the table and snapshotting it for the sample-row watcher
    // are both O(rows), and running them inside the loop is what made a deep walk lock the page up.
    var stop = function (state) {
      EX_WALKING = false;
      pageTable(body, 'exchanges', 1);
      EX_ROWS = [].slice.call(body.children).map(function (r) { return r.cloneNode(true); });
      watchEx();
      exMore(body, state);
    };
    (function next() {
      if (EX_DONE || wave >= EX_WAVES || EX_PAGE >= 50) {
        stop(EX_DONE || EX_PAGE >= 50 ? 'end' : 'idle');
        return;
      }
      wave++;
      // Re-asserted each wave: the table is rebuilt underneath this walk (the chip handler, the sample-row watcher), and a
      // button reading "Keep looking" while it is still working invites a second click on top of the first.
      exMore(body, 'busy');
      var base = EX_PAGE, jobs = [];
      for (var k = 1; k <= EX_PARALLEL && base + k <= 50; k++) {
        jobs.push(paintExchanges(EX_ASSET, 0, base + k, true));
      }
      Promise.all(jobs).then(function (counts) {
        var added = counts.reduce(function (a, b) { return a + (b || 0); }, 0);
        // The walker owns the page counter. paintExchanges sets EX_PAGE to whichever page it just drew, and with three in
        // flight the last one to land would win — which could hand the next wave a page it has already read.
        EX_PAGE = base + jobs.length;
        // Every page in the wave came back empty: that is the end of the feed, not a failure.
        if (!added) { EX_DONE = true; stop('end'); return; }
        // Once per wave, so the reader sees the table filling — but without the whole-table clone, which is the expensive
        // half and only has to happen when the walk is over.
        pageTable(body, 'exchanges', 1);
        var shown = [].slice.call(body.children).filter(function (r) {
          if (!r.hasAttribute || !r.hasAttribute('data-lxex')) return false;
          if (EX_MIN > 0 && +(r.getAttribute('data-lxxrp') || 0) < EX_MIN) return false;
          return true;
        }).length;
        if (shown >= EX_WANT) { stop('idle'); return; }
        next();
      }, function () { stop('idle'); });                 // a refused read is not the end of the history
    })();
  }

  if (!window.__lxxExMore) {
    window.__lxxExMore = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.lx-exmore');
      if (!b || b.disabled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var body = document.getElementById('dxaExTable');
      if (!body || !EX_ASSET || EX_DONE) return;
      keepLooking(body);
    }, true);
  }
  // THE SIZE FILTERS (All · 10+ · 100+ · 1000+ XRP) and anything else that rewrites the table (RAZA 2026-09-16, the LUMOS page with
  // "1000+ XRP" selected showing "0x0c…9fbc · 4.2240 APT"): the design redraws its sample trades on every chip click. The chip is
  // taken first and applied to this token's rows, and a watcher puts our rows back whenever sample rows appear.
  if (!window.__lxxExChips) {
    window.__lxxExChips = 1;
    window.addEventListener('click', function (e) {
      var c = e.target && e.target.closest && e.target.closest('button.chip[data-min-xlm]');
      if (!c) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      [].forEach.call(c.parentNode.querySelectorAll('button.chip[data-min-xlm]'), function (x) { x.classList.toggle('active', x === c); });
      var was = EX_MIN;
      EX_MIN = +c.getAttribute('data-min-xlm') || 0;
      var bd = document.getElementById('dxaExTable');
      if (!bd) return;
      // DROPPING THE FILTER AFTER A WALK STARTS OVER. A walk under '100+ XRP' never builds the small legs it reads, so
      // widening the filter afterwards has nothing to widen TO — the table would sit there showing the large ones and
      // look like the small trades had stopped happening. The recent page is drawn again instead, and the walk is armed
      // again from the start, so 'Keep looking' fetches those pages back (the edge already has them cached).
      if (was > 0 && EX_MIN < was && EX_PAGE > 0) {
        EX_PAGE = 0; EX_DONE = false; EX_ROWS = null;
        paintExchanges(EX_ASSET, 0, 0, false);
        return;
      }
      // A FAILED LOAD IS RETRIED HERE. The chips are the only thing on the panel a reader can press when the table came
      // back empty, so pressing one asks for the trades again rather than re-filtering a note.
      if (!bd.querySelector('[data-lxex]') && EX_ASSET) {
        EX_PAGE = 0; EX_DONE = false; EX_ROWS = null;
        paintExchanges(EX_ASSET, 0, 0, false);
        return;
      }
      restoreEx();
      pageTable(bd, 'exchanges', 1);
    }, true);
  }
  function watchEx() {
    var bd = document.getElementById('dxaExTable');
    if (!bd || bd.__lxxWatch || !window.MutationObserver) return;
    bd.__lxxWatch = new MutationObserver(function () {
      var f = bd.firstElementChild;
      if (EX_ROWS && f && !f.hasAttribute('data-lxex') && !f.hasAttribute('data-lxnote')) { bd.classList.remove('lxda'); restoreEx(); }
    });
    bd.__lxxWatch.observe(bd, { childList: true });
  }
  function restoreEx() {
    var bd = document.getElementById('dxaExTable');
    if (!bd || !EX_ROWS) return;
    var f = bd.firstElementChild;
    if (f && (f.hasAttribute('data-lxex') || f.hasAttribute('data-lxnote'))) { bd.classList.add('lxda'); return; }
    bd.innerHTML = '';
    EX_ROWS.forEach(function (r) { bd.appendChild(r.cloneNode(true)); });
    bd.classList.add('lxda');
    pageTable(bd, 'exchanges', 1);
  }
  if (!window.__lxxExRestore) {
    window.__lxxExRestore = 1;
    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.tabs-bar .tab');
      if (!t || (t.getAttribute('data-tab') || '') !== 'exchanges' || !EX_ROWS) return;
      var bd = document.getElementById('dxaExTable');
      if (bd) bd.classList.remove('lxda');
      [0, 60, 250, 700].forEach(function (ms) { setTimeout(restoreEx, ms); });
    }, true);
  }
  function pageTable(host, noun, page) {
    if (!host) return;
    var all = [].slice.call(host.children);
    var me = EX_MINE ? myAddr() : '';
    var rows = all.filter(function (r) {
      if (r.hasAttribute('data-lxnote')) return false;
      var keep = !(EX_MIN > 0) || !r.hasAttribute('data-lxex') || +(r.getAttribute('data-lxxrp') || 0) >= EX_MIN;
      // MY TRADES (RAZA 2026-09-16: "if that particular wallet address has trades that particular asset, it will be shown here").
      // Either side of the fill counts — the connected account can be the maker or the taker.
      if (keep && me && r.hasAttribute('data-lxex')) {
        keep = (r.getAttribute('data-lxwho') || '').split('|').indexOf(me) >= 0;
      }
      if (!keep) r.style.display = 'none';
      return keep;
    });
    var em = host.querySelector('tr.lx-exempty');
    if (em && em.parentNode) em.parentNode.removeChild(em);
    // ONLY WHEN THERE ARE ROWS TO FILTER (RAZA 2026-09-17, SOLO under 1000+ XRP showing "Recent exchanges are unavailable
    // right now." AND "No exchanges of 1000+ XRP among the latest trades." at once). exNote() ends by calling this
    // function, so a failed load with a size chip active stacked the filter note underneath the failure — two notes
    // contradicting each other, one of them a guess. Nothing was filtered out if nothing loaded.
    if (!rows.length && (EX_MIN > 0 || EX_MINE) && host.tagName === 'TBODY' && host.querySelector('[data-lxex]')) {
      var et = document.createElement('tr');
      et.className = 'lx-exempty';
      et.setAttribute('data-lxnote', '1');
      var emptyTxt = EX_MINE
        ? (me ? 'No trades from this wallet among the trades loaded — keep looking for older ones.'
              : 'Connect a wallet to see your own trades in this asset.')
        : ('No exchanges of ' + EX_MIN + '+ XRP among the latest trades.');
      var ed = el('td', null, emptyTxt);
      ed.colSpan = 6;
      ed.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
      et.appendChild(ed);
      host.appendChild(et);
    }
    var n = rows.length, pages = Math.max(1, Math.ceil(n / PAGE_PER));
    page = Math.max(1, Math.min(pages, page || 1));
    host.__lxxPage = page;
    host.__lxxNoun = noun;
    rows.forEach(function (r, i) { r.style.display = (i >= (page - 1) * PAGE_PER && i < page * PAGE_PER) ? '' : 'none'; });
    var foot = host.closest('.panel') ? host.closest('.panel').querySelector('.panel-foot') : document.querySelector('#dxaPanel .panel-foot, .panel-foot');
    if (!foot) return;
    var info = foot.querySelector('.info');
    // STELLAR'S WORDING, including the size filter it was read under: "Showing 1-4 of 4 recent trades · ≥ 100 XLM".
    if (info) {
      var what = noun === 'exchanges' ? 'recent trades' : noun;
      var suffix = (noun === 'exchanges' && EX_MIN > 0) ? (' · ≥ ' + EX_MIN + ' XRP') : '';
      info.textContent = n
        ? ('Showing ' + ((page - 1) * PAGE_PER + 1) + '–' + Math.min(n, page * PAGE_PER) + ' of ' + n + ' ' + what + suffix)
        : ('Showing 0 ' + what + suffix);
    }
    var pg = foot.querySelector('.pgn');
    if (!pg) return;
    pg.innerHTML = '';
    function btn(label, target, active, disabled) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('data-logoed', '1');
      b.setAttribute('data-lxpage', String(target));
      if (active) b.className = 'active';
      if (disabled) b.disabled = true;
      pg.appendChild(b);
    }
    btn('‹', page - 1, false, page <= 1);
    for (var k = 1; k <= pages; k++) btn(String(k), k, k === page, false);
    btn('›', page + 1, false, page >= pages);
    pg.style.display = pages > 1 ? '' : 'none';
  }
  function activeTabHost() {
    var t = document.querySelector('.tabs-bar .tab.active');
    var which = t ? (t.getAttribute('data-tab') || '') : 'exchanges';
    if (which === 'pools') { var pb = poolsTable(); return pb && pb.tagName === 'TBODY' ? pb : null; }
    if (which === 'exchanges' || !which) return document.getElementById('dxaExTable');
    return null;
  }
  if (!window.__lxxPager) {
    window.__lxxPager = 1;
    window.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.panel-foot .pgn button');
      if (!b) return;
      var host = activeTabHost();
      if (!host || host.__lxxPage == null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.disabled) return;
      var to = parseInt(b.getAttribute('data-lxpage') || '', 10);
      if (!isFinite(to)) {
        var tx = (b.textContent || '').trim();
        to = tx === '‹' ? host.__lxxPage - 1 : (tx === '›' ? host.__lxxPage + 1 : parseInt(tx, 10));
      }
      if (isFinite(to)) pageTable(host, host.__lxxNoun, to);
    }, true);
  }
  function exNote(host, text) {
    if (!host || host.tagName !== 'TBODY') return;
    host.innerHTML = '';
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxnote', '1');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    host.appendChild(tr);
    host.classList.add('lxda');
    EX_ROWS = [tr.cloneNode(true)];
    pageTable(host, 'exchanges', 1);
  }

  // Resolves with the number of rows this call added, so "Keep looking" can walk page after page until it has found
  // enough for the size filter in force.
  function paintExchanges(asset, attempt, page, append) {
    var body = document.getElementById('dxaExTable');
    var mlist = document.getElementById('mdxaExList');
    var host = body || mlist;
    if (!host) return Promise.resolve(0);
    // The design's own row is the template, kept from the first paint: once this layer has filled the table, its rows are
    // the only ones left to clone, and a later page must not inherit the previous row's values.
    if (!EX_TPL) {
      var tpl = host.querySelector(body ? 'tr' : '.ex-row');
      if (!tpl) return Promise.resolve(0);
      EX_TPL = tpl.cloneNode(true);
    }
    var template = EX_TPL;

    return fetch('/lxapi/xrplhistory?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&n=100&p=' + (page || 0))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // A FAILED READ IS ASKED AGAIN (RAZA 2026-09-15: "For this Trade-Asset page, the recent transactions is not even
        // loading"). The upstream answers two history calls a second; one refused call left the table blank for good.
        if (!d || !d.ok || !d.rows) {
          if ((attempt || 0) < 3) {
            return new Promise(function (res) { setTimeout(res, 1500 * ((attempt || 0) + 1)); })
              .then(function () { return paintExchanges(asset, (attempt || 0) + 1, page, append); });
          }
          if (append) { exMore(host, 'idle'); return 0; }
          exNote(body, 'Recent exchanges are unavailable right now.');
          return 0;
        }
        if (!d.rows.length) {
          if (append) { EX_DONE = true; exMore(host, 'end'); return 0; }
          exNote(body, 'No recent exchanges for this token.');
          return;
        }
        var ours = currencyOf(asset.code);
        if (!append) host.innerHTML = '';

        // XRP PER TOKEN, from this feed's own XRP legs (the median, so one odd fill cannot skew it). lumoscore.com
        // prices every fill in the native asset; a token-to-token leg has no XRP side, so it is valued at this.
        var spots = [];
        d.rows.forEach(function (h0) {
          var b0 = h0.got.c === ours && h0.got.i === asset.issuer, s0 = h0.paid.c === ours && h0.paid.i === asset.issuer;
          if (!b0 && !s0) return;
          var mi = b0 ? h0.got : h0.paid, ot = b0 ? h0.paid : h0.got;
          if (ot.c === 'XRP' && mi.v > 0 && ot.v > 0) spots.push(ot.v / mi.v);
        });
        spots.sort(function (x, y) { return x - y; });
        var spot = spots.length ? spots[Math.floor(spots.length / 2)]
          : ((window.__lxxAssetData && window.__lxxAssetData.price > 0) ? +window.__lxxAssetData.price : 0);

        for (var i = 0; i < d.rows.length; i++) {
          var h = d.rows[i];
          // BUY AND SELL WERE THE WRONG WAY ROUND ON EVERY ROW. The feed's `paid` and `got` are the MAKER's two legs, while
          // the wallet this row NAMES is the taker — so a row read "▼ SELL" beside the address of an account that had just
          // bought. Checked against the ledger both ways before changing it: RAZA's own ATOM trades (SendMax 1 XRP,
          // delivered 0.00132 ATOM — a buy) arrive here as paid=ATOM/got=XRP, and a book leg behaves the same way. So the
          // maker paying this token is the displayed wallet BUYING it.
          var bought = (h.paid.c === ours && h.paid.i === asset.issuer);
          var sold = (h.got.c === ours && h.got.i === asset.issuer);
          if (!bought && !sold) continue;                       // a leg that never touched this token

          var mine = bought ? h.paid : h.got;                   // this token's leg
          var other = bought ? h.got : h.paid;                  // what it went against
          var px = other.v / mine.v;

          // PRICED IN WHATEVER THE OTHER SIDE WAS, and that is very often not XRP: 11 of RLUSD's
          // last 40 legs and 23 of ARMY's were token-to-token, so filtering them out would hide most
          // of some tokens' trading. They stay, named.
          //
          // What made them LOOK broken was the formatting, not the data — a cross-token rate can run
          // to seven digits, and `xrp(px, 5)` rendered one as "3,672,930.25281 AmericaFirst" beside
          // neighbours reading "0.72115 XRP". Large rates get the same compact form every other big
          // number on this page uses.
          // IN XRP (RAZA 2026-09-15: "it should also show RLUSD or XRP. whys it showing BITx, ETH, USDC").
          var otherXrp = other.c === 'XRP' ? other.v : (spot > 0 ? mine.v * spot : null);

          // A ROW THAT WOULD ONLY BE HIDDEN IS NEVER BUILT (RAZA 2026-09-17: "the page becomes very slow and laggy"). A deep
          // walk reads ~1,900 legs; with a "100+ XRP" filter in force, nearly all of them are hidden the moment they are
          // drawn. Building them anyway left two thousand table rows — each with a logo, a link and five cells — on the
          // page to display none of them. During a walk the filter is applied BEFORE the row is made; the first paint is
          // unchanged, so switching filters still has the full recent page to work with.
          if (append && EX_MIN > 0 && !(otherXrp >= EX_MIN)) continue;

          var priceTxt = otherXrp != null
            ? (xrp(otherXrp / mine.v, 5) + ' XRP')
            : ((px >= 1000 ? amount(px) : xrp(px, 5)) + ' ' + curName(other.c));
          var amtTxt = amount(mine.v) + ' ' + asset.code;
          var whoTxt = shortAddr(h.taker || h.maker);
          var sideCls = bought ? 'buy' : 'sell';
          var sideTxt = bought ? '▲ Buy' : '▼ Sell';

          var row = template.cloneNode(true);
          row.setAttribute('data-lxex', '1');
          if (otherXrp != null && isFinite(otherXrp)) row.setAttribute('data-lxxrp', String(otherXrp));
          // Both counterparties ride along so "My Trades" can pick this row out (RAZA 2026-09-16, item 7).
          row.setAttribute('data-lxwho', (h.maker || '') + '|' + (h.taker || ''));

          if (body) {
            var td = row.children;

            var wa = td[0] && td[0].querySelector('.wa');
            if (wa) wa.textContent = whoTxt;
            // THE WALLET IS A LINK on lumoscore.com — `a.lx-acct.wallet-cell` to that account's page.
            var wc = td[0] && td[0].querySelector('.wallet-cell');
            var whoAddr = h.taker || h.maker;
            if (wc && whoAddr && window.lxx.isAddress(whoAddr)) {
              if (wc.tagName !== 'A') {
                var an = document.createElement('a');
                an.className = 'lx-acct wallet-cell';
                while (wc.firstChild) an.appendChild(wc.firstChild);
                wc.parentNode.replaceChild(an, wc);
                wc = an;
              }
              wc.href = '/account/xrpl/' + encodeURIComponent(whoAddr);
            }

            var badge = td[1] && td[1].querySelector('.type-badge');
            if (badge) { badge.className = 'type-badge ' + sideCls; badge.textContent = sideTxt; }

            var pEl = td[2] && td[2].querySelector('.mono');
            if (pEl) pEl.textContent = priceTxt;

            var aEl = td[3] && td[3].querySelector('.mono');
            if (aEl) aEl.textContent = amtTxt;
            // Stellar's second line under the amount: what the other side of the fill came to.
            if (td[3]) {
              var tot = td[3].querySelector('.lx-extot');
              if (!tot) { tot = el('span', 'lx-extot'); td[3].appendChild(tot); }
              plain(tot, otherXrp != null
                ? ((otherXrp >= 1000 ? amount(otherXrp) : xrp(otherXrp, 7)) + ' XRP')
                : ((other.v >= 1000 ? amount(other.v) : xrp(other.v, 7)) + ' ' + curName(other.c)));
            }

            var tEl = td[4] && td[4].querySelector('.time');
            if (tEl) tEl.textContent = ago(h.t);

            // The design's explorer button, pointed at this fill rather than left inert.
            // A REAL LINK TO THE FILL ON BITHOMP (RAZA 2026-09-15: "the transactions are not linking to
            // bithomp explorer"). The button carried the hash and nothing opened it. Stellar's row-link is an
            // <a> to stellar.expert; this is the same element pointed at this ledger's explorer.
            var btn = td[5] && td[5].querySelector('.row-link');
            if (btn && h.hash) {
              var lk = document.createElement('a');
              lk.className = 'row-link';
              lk.href = 'https://bithomp.com/explorer/' + encodeURIComponent(h.hash);
              lk.target = '_blank';
              lk.rel = 'noopener nofollow';
              lk.setAttribute('aria-label', 'View this trade on Bithomp');
              while (btn.firstChild) lk.appendChild(btn.firstChild);
              btn.parentNode.replaceChild(lk, btn);
            }
          } else {
            // The phone's card: `.nm` is the wallet, `.ex-num` holds the price with the amount in a
            // nested `.sub`, and `.ex-time` is the age. The `.ex-ident` identicon is left alone — it
            // is decorative, and it doubles as the thing that keeps the logo healer off the row.
            var nm = row.querySelector('.nm');
            if (nm) nm.textContent = whoTxt;

            var mb = row.querySelector('.type-badge');
            if (mb) { mb.className = 'type-badge ' + sideCls; mb.textContent = sideTxt; }

            var num = row.querySelector('.ex-num');
            if (num) {
              var sub = num.querySelector('.sub');
              // Only the price text node is replaced, so the nested `.sub` keeps its place.
              var wrote = false;
              [].forEach.call(num.childNodes, function (n) {
                if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = priceTxt; wrote = true; }
              });
              if (!wrote) num.insertBefore(document.createTextNode(priceTxt), num.firstChild);
              if (sub) sub.textContent = amtTxt;
            }

            var mt = row.querySelector('.ex-time');
            if (mt) mt.textContent = ago(h.t);

            if (h.hash) row.setAttribute('data-lxtx', h.hash);
          }

          host.appendChild(row);
        }

        if (!host.children.length) { exNote(body, 'No recent exchanges for this token.'); return 0; }
        host.classList.add('lxda');
        EX_PAGE = page || 0;
        EX_ASSET = asset;
        ensureMyTrades();

        // THE COUNT AND THE FOOTER WERE BOTH INVENTED. The tab read "Exchanges 2,142" and the foot
        // "Showing 15 of 2,142 exchanges ‹ 1 2 3 ›" — a total this page has no way to know (the
        // history feed returns a page, not a count) over a pager that does nothing. The number of
        // rows actually shown is the only true statement available, so that is what is said, and the
        // dead pager goes with the sentence that justified it.
        setTabCount(/exchanges/i, '—');
        if (body) {
          // THE PER-PAGE WORK IS WHAT MADE THE PAGE CRAWL (RAZA 2026-09-17: "while its looking back into the transactions,
          // the page becomes very slow and laggy"). Two things ran on EVERY appended page: the pager walked every row in
          // the table, and `EX_ROWS` re-cloned the whole table — so by the eighteenth page each new page cloned ~1,800
          // rows, eighteen times over, on the main thread. Both belong at the END of a walk, not inside it, and
          // keepLooking() does them there.
          if (!append) {
            pageTable(body, 'exchanges', 1);
            EX_ROWS = [].slice.call(body.children).map(function (r) { return r.cloneNode(true); });
            watchEx();
            // While "Keep looking" is walking, IT owns the button — otherwise the label flipped back to "Keep looking"
            // after each page and the walk looked finished when it had eleven pages still to go.
            exMore(body, EX_DONE ? 'end' : 'idle');
          }
        }
        // `host`, not `body` — this used to read `body.children.length` and `body.closest(...)`,
        // which are a TypeError the moment the desktop table is absent.
        var shell = host.closest ? host.closest('#dxaExTable, table, .panel') : null;
        if (shell) shell.classList.add('lxda');
        exAttribution(d, host);
        // LEGS READ, not rows drawn. With the filter applied before a row is built, a page of a hundred legs that
        // match nothing would otherwise look identical to the end of the history and stop the walk dead.
        return d.rows.length;
      })
      .catch(function () {
        if ((attempt || 0) < 3) {
          return new Promise(function (res) { setTimeout(res, 1500 * ((attempt || 0) + 1)); })
            .then(function () { return paintExchanges(asset, (attempt || 0) + 1, page, append); });
        }
        if (!append) exNote(body, 'Recent exchanges are unavailable right now.');
        return 0;
      });
  }

  // xrpl.to's terms require a visible link wherever their data is shown, and this page had none at
  // all despite already rendering their prices. Same markup and same placement as the Trade page's.
  // Takes the container it should attach to, because the phone has no `#dxaExTable` — looking that
  // id up here meant the mobile panel rendered xrpl.to's data with NO attribution at all, which
  // their terms require wherever it is shown.
  function exAttribution(d, near) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var body = near || document.getElementById('dxaExTable');
    // FROM THE PARENT, not from the element itself. `closest` matches the node it starts on, and
    // the phone's container `#mdxaExList` IS a div — so searching from it returned the row list and
    // the attribution was appended as a 16th "row" inside the exchange feed.
    var from = (body && body.parentElement) || body;
    var host = from && from.closest ? from.closest('.panel, section, div') : null;
    if (!host) return;
    var p = el('p');
    p.id = 'lxx-attr-dxa';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Market data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // ---- Holders and Pools tabs ---------------------------------------------------------------------
  //
  // Both shipped as visible mock on a page about one XRP Ledger token:
  //   Holders — fifty rows of EVM wallets, "0x00…c3a1  3.14M  12.800%", with "Holders 12,408 /
  //             Top 10 hold 38.4% / Top 50 hold 67.2%" invented above them.
  //   Pools   — seven APTOS pools, "USDC / APT $4.85M 24.8%", "USDC / CELL", each with a live-looking
  //             "Add liquidity →", under four fabricated summary stats.
  // Neither was gated, so unlike the Exchanges tab these were not blank — they were wrong, and one
  // click away.
  //
  // Repainted on every tab click, not once: the design's own tab script rebuilds the holders table
  // when that tab is selected, so a single pass would be overwritten the moment someone switched away
  // and back. Same second-writer shape as the market table on /trade/xrpl.
  // `[class*="dxa-hl-stat"]` matches the phone's `.mdxa-hl-stat` too. The desktop-only selector is
  // why the mobile tabs kept "Holders 12,408 / Top 10 38.4%" against a real 22,008 / 20.8%.
  function statCells(root) { return $$('[class*="dxa-hl-stat"]', root || document); }

  function statByLabel(root, re) {
    var cells = statCells(root);
    for (var i = 0; i < cells.length; i++) {
      if (re.test((cells[i].textContent || '').trim())) return cells[i];
    }
    return null;
  }

  // ALL matching cells, not the first. Desktop and mobile each ship their own stat head and both are
  // in the DOM at once, so writing only the first left whichever layout came second on its mock.
  function setHlStat(re, value) {
    var cells = statCells(document);
    for (var i = 0; i < cells.length; i++) {
      if (!re.test((cells[i].textContent || '').trim())) continue;
      var v = cells[i].querySelector('.val') || cells[i].querySelector('.v') || cells[i].lastElementChild;
      if (!v || v === cells[i].firstElementChild) continue;
      v.textContent = value;
      v.classList.add('lxp');                            // the value gate, same family as the perf row
    }
  }

  function setTabCount(re, value) {
    var tabs = $$('.tabs-bar .tab');
    for (var i = 0; i < tabs.length; i++) {
      if (!re.test(tabs[i].textContent || '')) continue;
      var c = tabs[i].querySelector('.count') || tabs[i].querySelector('span:last-child');
      if (c) { c.textContent = value; c.classList.add('lxp'); }
      return;
    }
  }

  // Desktop builds a <table> inside #dxaPanel; the phone builds `.mdxa-hl-list`, a div of
  // `.mdxa-hl-row` cards. Returning either lets one painter fill both — without this the mobile
  // Holders tab kept FIFTY fabricated EVM wallets ("#1 0x0f…e007 3.14M 12.800%") one tap away.
  function holdersTable() {
    var tables = $$('#dxaPanel table');
    for (var i = 0; i < tables.length; i++) {
      if (/%\s*supply/i.test(tables[i].textContent) || /supply/i.test(
        ([].slice.call(tables[i].querySelectorAll('thead th')).map(function (t) { return t.textContent; }).join('|')))) {
        return tables[i].querySelector('tbody');
      }
    }
    return $('.mdxa-hl-list');
  }

  // The design builds each tab's table only when that tab is first ACTIVATED, so at page load the
  // Holders and Pools tables do not exist yet — but their tab counts do, hardcoded by the mock
  // ("Holders 12,408", "Pools 7"). Those two fabricated numbers are on screen before a visitor
  // clicks anything, so the counts have to load without the table. Each painter therefore runs in
  // two modes: count-only while the table is absent, then rows as well once the tab is opened.
  // These flags stop the count-only pass repeating on every tab click.
  var hlCounted = 0, plCounted = 0;

  // PAGES OF FIFTY (RAZA 2026-09-16: "On Trade-asset → Holders tab pagination not working"): the pager under the table asks
  // the rich list for the page it names.
  var HL_TPL = null, HL_PAGE = 1, HL_PER = 50;
  function holdersPager(d, body) {
    var ex = body.closest && body.closest('.dxa-tab-extra');
    var pg = ex && ex.querySelector('.dxa-hl-pgn');
    if (!pg) return;
    var total = d.total != null ? Math.round(d.total) : d.rows.length;
    var pages = Math.max(1, Math.ceil(total / HL_PER));
    var start = (HL_PAGE - 1) * HL_PER, cum = 0;
    d.rows.forEach(function (h) { if (h.holding != null) cum += +h.holding; });
    var info = pg.querySelector('.info');
    if (info) {
      info.textContent = 'Showing ' + (start + 1).toLocaleString('en-US') + '–' + (start + d.rows.length).toLocaleString('en-US')
        + ' of ' + total.toLocaleString('en-US') + ' holders' + (HL_PAGE === 1 ? (' · Cumulative ' + cum.toFixed(1) + '%') : '');
    }
    var box = pg.querySelector('.pgn');
    if (!box) return;
    box.innerHTML = '';
    function btn(label, to, active, disabled) {
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = label;
      x.setAttribute('data-logoed', '1');
      if (to) x.setAttribute('data-lxhpage', String(to));
      if (active) x.className = 'active';
      if (disabled) x.disabled = true;
      box.appendChild(x);
    }
    if (HL_PAGE > 1) btn('‹ Prev', HL_PAGE - 1);
    var nums = [1, 2, 3, HL_PAGE - 1, HL_PAGE, HL_PAGE + 1, pages]
      .filter(function (v, i, arr) { return v >= 1 && v <= pages && arr.indexOf(v) === i; })
      .sort(function (x, y) { return x - y; });
    var prev = 0;
    nums.forEach(function (v) {
      if (prev && v - prev > 1) btn('…', 0, false, true);
      btn(String(v), v, v === HL_PAGE);
      prev = v;
    });
    if (HL_PAGE < pages) btn('Next ›', HL_PAGE + 1);
    box.style.display = pages > 1 ? '' : 'none';
  }
  if (!window.__lxxHlPager) {
    window.__lxxHlPager = 1;
    window.addEventListener('click', function (e) {
      var bt = e.target && e.target.closest && e.target.closest('.dxa-hl-pgn .pgn button');
      if (!bt) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var to = parseInt(bt.getAttribute('data-lxhpage') || '', 10);
      if (!isFinite(to) || bt.disabled || !window.__lxxAssetRef) return;
      paintHolders(window.__lxxAssetRef, to);
    }, true);
  }

  function paintHolders(asset, page) {
    var body = holdersTable();
    if (!body && hlCounted && !page) return;                    // counts already in; nothing to paint
    if (body && body.getAttribute('data-lxh') === asset.code && !page) return;   // already ours for this token
    if (!HL_TPL && body && body.children.length && !body.getAttribute('data-lxh')) HL_TPL = body.children[0].cloneNode(true);
    var template = HL_TPL ? HL_TPL.cloneNode(true) : ((body && body.children.length) ? body.children[0].cloneNode(true) : null);
    hlCounted = 1;
    HL_PAGE = page || 1;
    var start = (HL_PAGE - 1) * HL_PER;

    fetch('/lxapi/xrplrichlist?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&n=50' + (start ? '&start=' + start : ''))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.rows || !d.rows.length) { hlCounted = 0; return; }
        if (!template) return countsH(d);                       // table not built yet — counts only
        body.innerHTML = '';
        for (var i = 0; i < d.rows.length; i++) {
          var h = d.rows[i];
          var tr = template.cloneNode(true), td = tr.children;

          // `[class*=...]` throughout, so each lookup finds the desktop element or the phone's
          // `mdxa-` twin. An AMM pool holding the token is not a whale, and the upstream says which
          // is which.
          var who = h.amm ? 'AMM pool' : shortAddr(h.account);
          var bal = amount(h.balance);
          var pct = (h.holding == null ? '—' : h.holding.toFixed(3) + '%');

          var rank = tr.querySelector('[class*="dxa-hl-rank"]');
          // Desktop prints a bare number, the phone's mock prints "#1"; keep whichever shape the
          // template already had rather than restyling one of the two layouts.
          if (rank) {
            var n = String(h.rank || (start + i + 1));
            rank.textContent = /^\s*#/.test(rank.textContent || '') ? ('#' + n) : n;
          }

          var wa = tr.querySelector('.wa') || tr.querySelector('[class*="dxa-hl-addr"]');
          if (wa) wa.textContent = who;
          // EACH HOLDER'S OWN LINK AND MARK (RAZA 2026-09-15: "Cant click on holder list wallet address. Also all holders are
          // showing same identicon"). The row is a clone of the design's first mock row, so every copy kept that row's
          // href and identicon. A pool opens its pool page; everyone else opens their account.
          var accA = tr.querySelector('a.lx-acct') || tr.querySelector('.wallet-cell');
          if (accA) {
            // The desktop row's cell is a <div>; Stellar's is <a class="lx-acct wallet-cell">. Same children, made a link.
            if (accA.tagName !== 'A' && accA.parentNode) {
              var aa = document.createElement('a');
              aa.className = 'lx-acct wallet-cell';
              while (accA.firstChild) aa.appendChild(accA.firstChild);
              accA.parentNode.replaceChild(aa, accA);
              accA = aa;
            }
            accA.setAttribute('href', h.amm ? ('/pools/xrpl/id/' + encodeURIComponent(h.account)) : ('/account/xrpl/' + encodeURIComponent(h.account)));
            var mark0 = accA.querySelector('svg, img');
            var idc = document.createElement('span');
            idc.innerHTML = identSvg(h.account, 26);
            if (mark0 && mark0.parentNode) mark0.parentNode.replaceChild(idc.firstChild, mark0);
            else accA.insertBefore(idc.firstChild, accA.firstChild);
          }

          var balEl = tr.querySelector('[class*="dxa-hl-bal"]');
          var pctEl = tr.querySelector('[class*="dxa-hl-pct"]');
          if (balEl || pctEl) {
            if (balEl) balEl.textContent = bal;
            if (pctEl) pctEl.textContent = pct;
          } else {
            // Desktop's table row, where the two values are plain cells with no class of their own.
            if (td[2]) td[2].textContent = bal;
            if (td[3]) td[3].textContent = pct;
          }

          var link = tr.querySelector('[class*="dxa-hl-explorer"]');
          if (link) {
            link.setAttribute('href', 'https://bithomp.com/explorer/' + encodeURIComponent(h.account));
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener nofollow');
            link.setAttribute('aria-label', 'View on Explorer');
            link.setAttribute('title', 'View on Explorer');
            // Stellar's icon, not the words (RAZA 2026-09-15: "We are not using View on Explorer instead an icon").
            link.innerHTML = XPO;
          }

          body.appendChild(tr);
        }
        body.setAttribute('data-lxh', asset.code);
        var exHl = body.closest && body.closest('.dxa-tab-extra');
        if (exHl) exHl.classList.add('lxda');
        holdersPager(d, body);
        countsH(d);
      })
      .catch(function () { hlCounted = 0; });
  }

  var XPO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"></path><path d="M20 4l-8.5 8.5"></path><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path></svg>';

  // A 5x5 mirrored identicon drawn from the address, in the design's own palette and shape (a round svg).
  function identSvg(addr, size) {
    var pal = ['#6f5ded', '#ef4444', '#22c55e', '#a855f7', '#06b6d4', '#f59e0b', '#ec4899', '#84cc16', '#ff894c', '#0ea5e9', '#14b8a6', '#facc15'];
    var h = 2166136261, i;
    addr = String(addr || '');
    for (i = 0; i < addr.length; i++) { h ^= addr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var bg = pal[h % pal.length], fg = pal[(h >>> 7) % pal.length];
    if (fg === bg) fg = pal[(h % pal.length + 5) % pal.length];
    var c = size / 5, rects = '', bits = h;
    function rect(x, y) { return '<rect x="' + (x * c).toFixed(2) + '" y="' + (y * c).toFixed(2) + '" width="' + c.toFixed(2) + '" height="' + c.toFixed(2) + '" fill="' + fg + '"></rect>'; }
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        bits = Math.imul(bits ^ (x * 7 + y * 13 + 1), 2654435761) >>> 0;
        if ((bits >>> 13) & 1) { rects += rect(x, y); if (x < 2) rects += rect(4 - x, y); }
      }
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="border-radius:50%;background:' + bg
      + ';flex:0 0 ' + size + 'px" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }

  // The row-click layer inherited from Stellar takes clicks on list rows first; a holder's own link wins here.
  if (!window.__lxxHolderNav) {
    window.__lxxHolderNav = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#dxaPanel [class*="dxa-hl-explorer"]')) { e.stopImmediatePropagation(); return; }
      var a = t.closest('#dxaPanel a.lx-acct[href^="/"]');
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }

  function countsH(d) {
    if (d.total != null) setTabCount(/holders/i, Math.round(d.total).toLocaleString('en-US'));
    setHlStat(/^holders/i, d.total == null ? '—' : Math.round(d.total).toLocaleString('en-US'));
    setHlStat(/top\s*10/i, d.summary && d.summary.top10 != null ? d.summary.top10 + '%' : '—');
    setHlStat(/top\s*50/i, d.summary && d.summary.top50 != null ? d.summary.top50 + '%' : '—');
  }

  // A pool reserve's logo. XRP is the one token with no issuer, and xrpl.to gives it a fixed id
  // rather than a derived one — the same constant browser/trade.js uses. See
  // [[lumoscore-xrpl-wallet-logos]] for why the id is derived at the edge and not here.
  function thumbFor(s) {
    if (!s || !s.c || s.c === 'XRP') return '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(s.i || '')
      + '&cur=' + encodeURIComponent(s.c) + '&w=48';
  }

  function poolsTable() {
    var tables = $$('#dxaPanel table');
    for (var i = 0; i < tables.length; i++) {
      var head = [].slice.call(tables[i].querySelectorAll('thead th'))
        .map(function (t) { return t.textContent.trim().toLowerCase(); }).join('|');
      if (head.indexOf('tvl') >= 0 && (head.indexOf('apr') >= 0 || head.indexOf('lp holders') >= 0)) return tables[i].querySelector('tbody');
    }
    return $('.mdxa-pl-list');            // the phone's card list — see holdersTable()
  }

  // STELLAR'S POOLS TAB (RAZA 2026-09-15: remove "Add liquidity", "we dont have it on Stellar"). Read off
  // lumoscore.com: three stats — Active pools, Combined TVL, LP positions — over four columns — Pool, TVL,
  // LP holders, Pool share — with the whole row opening the pool. This tab had APR, 24h volume and an
  // "Add liquidity →" link per row, and its TVL / volume / share cells were never written at all: the
  // desktop row carries `.dxa-pl-apr`, which sent it down the phone branch, so every row kept the mock
  // "$4.85M · $980K · 62.4%".
  //
  // "Pool share" is each pool's share of this token's combined TVL, which is what Stellar's column adds up
  // to (65.1% + 16.4% + 7.3% …).
  function paintPools(asset) {
    var body = poolsTable();
    if (!body && plCounted) return;                             // see the note above paintHolders
    if (body && body.getAttribute('data-lxp') === asset.code) return;
    var template = (body && body.children.length) ? body.children[0].cloneNode(true) : null;
    var ours = currencyOf(asset.code);
    plCounted = 1;
    wirePoolRows();

    Promise.all([
      fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(asset.issuer)).then(function (r) { return r.json(); }),
      // Through the shared helper: it saves a good rate and falls back to the last one when the call
      // is refused. Without it a 429 dropped this tab's pool figures from dollars to raw XRP.
      (window.lxx && window.lxx.fetchUsd) ? window.lxx.fetchUsd(1).then(function (u) { return { ok: 1, usd: u }; })
        : fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (both) {
      var d = both[0], t = both[1];
      var usd = (t && t.ok && +t.usd > 0) ? +t.usd : null;
      if (!d || !d.ok || !d.rows) { plCounted = 0; return; }

      var mine = d.rows.filter(function (p) {
        return (p.a1 && p.a1.c === ours && p.a1.i === asset.issuer)
          || (p.a2 && p.a2.c === ours && p.a2.i === asset.issuer);
      }).sort(function (x, y) { return (y.liq || 0) - (x.liq || 0); });

      var tvl = 0, lps = 0;
      mine.forEach(function (p) { if (p.liq != null) tvl += p.liq; if (p.holders != null) lps += p.holders; });
      var money2 = function (x) { return (usd && x != null) ? ('$' + amount(x * usd)) : (amount(x) + ' XRP'); };

      if (template) {
        var table = body.closest ? body.closest('table') : null;
        if (table) {
          var ths = [].slice.call(table.querySelectorAll('thead th'));
          var WANT = ['Pool', 'TVL', 'LP holders', 'Pool share'];
          ths.forEach(function (th, k) {
            if (k < WANT.length) plain(th, WANT[k]);
            else if (th.parentNode) th.parentNode.removeChild(th);
          });
        }
        body.innerHTML = '';
      }

      for (var i = 0; template && i < mine.length; i++) {
        var p = mine[i];
        var tr = template.cloneNode(true), td = tr.children;
        var nameEl = tr.querySelector('[class*="dxa-pl-name"]') || tr.querySelector('[class*="dxa-pl-nm"]');
        var pair = curName(p.a1 && p.a1.c) + ' / ' + curName(p.a2 && p.a2.c);
        if (nameEl) nameEl.textContent = pair;
        else if (td[0]) td[0].textContent = pair;

        var slots = tr.querySelectorAll('.dxa-pl-ico, .mdxa-pl-ico');
        [p.a1, p.a2].forEach(function (side, si) {
          var slot = slots[si];
          if (!slot || !side) return;
          var im = slot.querySelector('img');
          if (!im) { im = document.createElement('img'); im.alt = ''; slot.appendChild(im); }
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';
          im.src = thumbFor(side);
          im.onerror = function () { im.remove(); };
        });

        var share = tvl > 0 && p.liq != null ? ((p.liq / tvl) * 100).toFixed(1) + '%' : '—';
        var mTvl = tr.querySelector('.mdxa-pl-tvl');
        if (mTvl) {
          // The phone's card: TVL headline, and the pill that carried APR now carries the share.
          mTvl.textContent = money2(p.liq);
          var mApr = tr.querySelector('.mdxa-pl-apr');
          if (mApr) plain(mApr, share);
          var pill = tr.querySelector('.net-pill');
          if (pill) { pill.className = 'net-pill xrpl'; plain(pill, 'XRP Ledger'); }
        } else {
          if (td[1]) { td[1].className = 'mono'; td[1].textContent = money2(p.liq); }
          if (td[2]) { td[2].className = 'mono'; td[2].textContent = p.holders != null ? Math.round(p.holders).toLocaleString('en-US') : '—'; }
          if (td[3]) { td[3].className = 'mono'; td[3].textContent = share; }
          while (tr.children.length > 4) tr.removeChild(tr.lastElementChild);
          tr.className = 'dxa-pl-row';
        }
        tr.setAttribute('data-lxpool', p.acct);
        tr.style.cursor = 'pointer';
        body.appendChild(tr);
      }
      if (template) {
        body.setAttribute('data-lxp', asset.code);
        var exPl = body.closest && body.closest('.dxa-tab-extra');
        if (exPl) exPl.classList.add('lxda');
      }

      var capped = (d.count >= 100);
      var label = String(mine.length);
      if (capped) {
        label = (d.total != null && d.total >= mine.length && mine.length === d.count)
          ? String(d.total) : (mine.length + '+');
      }
      var more = capped ? '+' : '';
      setTabCount(/pools/i, label);
      setHlStat(/^(active\s+)?pools/i, label);
      setHlStat(/^(combined\s+)?tvl/i, money2(tvl) + more);
      // The design's third and fourth stats were 24h volume and average APR; Stellar's third is LP
      // positions and it has no fourth.
      statCells(document).forEach(function (cell) {
        var txt = (cell.textContent || '').trim();
        if (/^24h vol/i.test(txt) || /^lp positions/i.test(txt)) {
          var lb = cell.querySelector('.lbl') || cell.firstElementChild;
          var v = cell.querySelector('.val') || cell.querySelector('.v') || cell.lastElementChild;
          if (lb) plain(lb, 'LP positions');
          if (v && v !== lb) { plain(v, Math.round(lps).toLocaleString('en-US') + more); v.classList.add('lxp'); }
        } else if (/^avg apr/i.test(txt) && cell.parentNode) {
          cell.parentNode.removeChild(cell);
        }
      });
    }).catch(function () {});
  }

  // A pool row opens its pool, as Stellar's does. Window capture, like every row on these pages.
  function wirePoolRows() {
    if (window.__lxxDxaPoolRows) return;
    window.__lxxDxaPoolRows = 1;
    window.addEventListener('click', function (e) {
      var tr = e.target && e.target.closest ? e.target.closest('[data-lxpool]') : null;
      if (!tr) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-lxpool'));
    }, true);
  }

  function wireTabs(asset) {
    if (window.__lxxDxaTabs) return;
    window.__lxxDxaTabs = 1;
    $$('.tabs-bar .tab').forEach(function (t) {
      t.addEventListener('click', function () {
        // After the design's own handler has swapped the panel.
        [80, 300, 900].forEach(function (ms) {
          setTimeout(function () { paintHolders(asset); paintPools(asset); }, ms);
        });
      });
    });
  }

  // ---- identity ---------------------------------------------------------------------------------
  // ---- copying the issuer ---------------------------------------------------------------------------
  //
  // THE CHIP HELD THE ADDRESS AND NOTHING COPIED IT. `data-copy` is filled in below, but the handler
  // that reads it lived in Stellar's `lx-dxadata`, which this build strips whole — so a click did
  // nothing and said nothing (RAZA 2026-09-15). lumoscore.com copies on a click anywhere on the chip
  // and shows its bottom-centre "Copied to clipboard" toast.
  //
  // The toast is Stellar's own `.lx-ctoast` — class names and styling taken from `lx-chipcopy`, which
  // produces the one in RAZA's screenshot — so it is the same element, not a lookalike. Window capture,
  // because the design routes clicks on this card through handlers of its own.
  function copyToast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16);animation:lxCtIn .25s ease}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}'
        + '@keyframes lxCtIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.innerHTML = '<span class="ci"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span></span>';
    t.lastChild.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s ease,transform .25s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 1800);
  }

  // PUBLISHED, so the swap and limit-order layers can use the same one (RAZA 2026-10-06: "When buying
  // / selling asset on Trade-asset page, its not showing the message at the bottom like it does on
  // Stellar" — lumoscore.com answers a filled swap with "✓ Sold 1.1541 XLM" bottom-centre).
  //
  // Those layers are separate emitted scripts with their own scopes, so the only way to share this is
  // through window — and sharing it is better than a third and fourth copy of the same twenty lines,
  // which is how four of them already exist elsewhere in this build. createpool.js and pooldetail.js
  // already look for `window.lxToast` first and fall back to their own; this is what they were looking
  // for. Assigned rather than defined here, so there is still exactly one implementation.
  if (!window.lxToast) window.lxToast = function (msg) { try { copyToast(msg); } catch (e) {} };

  function wireIssuerCopy() {
    if (window.__lxxIssuerCopy) return;
    window.__lxxIssuerCopy = 1;
    window.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.addr[data-copy]') : null;
      if (!chip || !chip.closest('.item, .asset-meta, .asset-id')) return;
      var text = chip.getAttribute('data-copy') || '';
      if (!window.lxx.isAddress(text)) return;                // only ever an r-address, never mock
      e.preventDefault();
      e.stopImmediatePropagation();
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
        else fallback();
      } catch (err) { fallback(); }
      copyToast('Copied to clipboard');
    }, true);
  }

  // The curated roster, fetched once per page and shared by every caller. A rejected fetch does not
  // settle the answer — the promise is dropped so the next caller asks again rather than inheriting
  // "nothing is verified" from one lost request.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CURATED = null;
  function curatedSet() {
    if (CURATED) return CURATED;
    CURATED = fetch('/lxapi/xrpltokens?n=100')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var s = {};
        [].forEach.call((j && j.rows) || [], function (x) {
          if (x && x.i && x.c) s[x.i + '|' + String(x.c).toUpperCase()] = 1;
        });
        return s;
      })
      .catch(function () { CURATED = null; return {}; });
    return CURATED;
  }

  function paintHeader(asset, d) {
    var h1 = $('h1.asset-name') || $('.asset-name');
    if (h1) {
      h1.textContent = asset.code;
      // THE VERIFIED TICK (RAZA 2026-09-16: "Also add verification tick for LUMOS on all other places where it should be.
      // eg: Trade-Asset, Wallet, Search"; 2026-10-06: "Verification tick is also not showing on Trade-Asset page", with
      // PHNIX on screen).
      //
      // It decided on xrpl.to's `vf`, which is 0 for PHNIX, for ARMY and for most of the roster — so the tick appeared on
      // LUMOS and almost nowhere else, while the Trade table one click away ticks all hundred rows it lists. Now the same
      // rule as that table, the wallet and the search panel: membership of /lxapi/xrpltokens, LUMOS pinned, with `vf`
      // still counting on top. The caveat recorded in trade.js — the roster is ranked by volume, not vetted — holds here
      // too and is not re-argued.
      //
      // ASYNC, so the roster is awaited rather than raced: this header paints as soon as the asset is known, long before
      // a hundred-row list has been fetched. The tick is appended when the answer arrives.
      var vtick = function () {
        var vt = el('span', 'lx-vtick');
        vt.title = 'Verified issuer';
        vt.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:9px;'
          + 'border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
        vt.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        if (!h1.querySelector('.lx-vtick')) h1.appendChild(vt);
      };
      if (d && (d.verified || d.vf || asset.issuer === LUMOS_ISS)) vtick();
      else curatedSet().then(function (s) {
        var cur = '';
        try { cur = window.lxx.encodeCurrency(asset.code) || ''; } catch (e) {}
        if (s[asset.issuer + '|' + String(cur).toUpperCase()]) vtick();
      });
    }

    // The title was being rewritten at runtime to the Stellar token's. Say what this page is.
    try {
      document.title = asset.code + (d && d.user ? ' by ' + d.user : '')
        + ' — price, order book and holders on the XRP Ledger | LumosCore';
    } catch (e) {}

    // THE ISSUER CARD WAS A DIFFERENT CHAIN'S ACCOUNT ENTIRELY.
    //
    // The design ships it filled in, and nothing here ever overwrote it, so every token page showed
    //     Issuer  0x040…f072      website  circle.com
    // — an EVM-style address (the full 64-hex hash was sitting in data-copy, so the COPY BUTTON
    // handed you it) beside Circle's domain, on a page whose issuer is an r-address. That is what
    // "the page is not loading" looked like: the shell renders, and the identity panel is somebody
    // else's.
    // THE PHONE PUTS IT SOMEWHERE ELSE: `.asset-meta .addr`, not `.item .addr`. So everything the
    // comment above describes was still true on mobile long after desktop was fixed — "ISSUER
    // 0x0b59…1756" under the token's name, with the full 64-hex string in `data-copy` so the copy
    // button handed it over. Found in a SCREENSHOT; every DOM check I ran looked at the desktop
    // element and reported it correct.
    var addrEl = $('.item .addr') || $('.asset-meta .addr') || $('.asset-id .addr');
    if (addrEl) {
      addrEl.setAttribute('data-copy', asset.issuer);
      addrEl.setAttribute('data-copy-label', asset.code + ' issuer');
      // Only the text node is replaced, so the design's copy icon stays where it is.
      var wrote = false;
      [].forEach.call(addrEl.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) {
          n.nodeValue = ' ' + shortAddr(asset.issuer);
          wrote = true;
        }
      });
      if (!wrote) addrEl.appendChild(document.createTextNode(' ' + shortAddr(asset.issuer)));
      wireIssuerCopy();
    }

    // The website is the issuer's own domain when xrpl.to has one. It is NOT guessed from anything:
    // an unverified issuer with no domain gets the row removed rather than a plausible-looking
    // link, because a wrong domain on a token page is how someone ends up on a phishing site.
    var web = $('.website');
    if (web) {
      var dom = rootDomain(d && d.domain);
      // LUMOS's home is lumoscore.com (RAZA 2026-09-16), whatever its issuer's older Domain field says.
      if (asset.issuer === 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha') dom = 'lumoscore.com';
      var txt = false;
      [].forEach.call(web.childNodes, function (n) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = dom ? (' ' + dom) : ''; txt = true; }
      });
      if (!txt && dom) web.appendChild(document.createTextNode(' ' + dom));
      web.style.display = dom ? '' : 'none';

      // AND IT IS A LINK (RAZA 2026-09-17: "Homedomain is unclickable"). The design ships `<a class="website" href="#">`
      // with a "Visit homedomain" tooltip, and only the TEXT was ever replaced — so the tooltip promised a visit and the
      // href went nowhere. `rootDomain()` above has already refused anything that is not a bare hostname (no scheme, no
      // path, no port), which is what makes it safe to build a URL from: every issuer domain on this ledger is a string an
      // anonymous account chose ([[lumoscore-xrpl-hostile-input]]). New tab, and no referrer or ranking passed to it.
      if (web.tagName === 'A') {
        if (dom) {
          web.setAttribute('href', 'https://' + dom);
          web.setAttribute('target', '_blank');
          web.setAttribute('rel', 'noopener noreferrer nofollow');
        } else {
          web.setAttribute('href', '#');
        }
      }
    }

    paintLogo(asset, d);
    paintLabels(asset);
    paintSocials(asset);
  }

  // THE LINKS THE ISSUER PUBLISHES IN ITS OWN TOML (RAZA 2026-10-06: "if toml on XRPL mentions socials,
  // please add just like we do on Stellar").
  //
  // lumoscore.com puts an `a.lx-soc` beside the home domain — on AQUA that is x.com/aqua_token, out of
  // the SEP-1 toml. The XRP Ledger keeps the same information under `[[TOKENS.WEBLINKS]]`, and nothing
  // here was reading it. The styling needed nothing: `.lx-soc` is already in this build's inherited
  // sheet, 28px, accent-coloured, with the hover.
  //
  // /lxapi/xrpltoml does the reading, because the toml lives at the issuer's LEDGER domain and that has
  // to be resolved first — the same resolver the search rows and the header domain use, so all three
  // agree about where a token's home is. It costs nothing from the xrpl.to budget.
  //
  // ICONS, NOT TITLES. A row of word-links would not be Stellar's shape; the endpoint classifies each
  // url so the glyph is picked here without re-parsing it, and anything unrecognised gets the globe.
  var SOC = {
    x: { t: 'X', d: 'M18.9 2H22l-7.1 8.1L23.2 22h-6.5l-5.1-6.7L5.8 22H2.7l7.6-8.7L1.2 2h6.7l4.6 6.1L18.9 2Zm-1.1 18h1.7L7.4 3.8H5.6L17.8 20Z' },
    telegram: { t: 'Telegram', d: 'M21.9 3.3 2.9 10.6c-1.1.4-1.1 1.1-.2 1.4l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.8-1.3-1.5zM7.9 13.2 18.3 6.6c.5-.3 1-.1.6.2l-8.9 8-.3 3.6-1.8-5.2z' },
    discord: { t: 'Discord', d: 'M19.3 5.3A16.9 16.9 0 0 0 15.1 4l-.2.4a15.7 15.7 0 0 1 3.7 1.2 12.8 12.8 0 0 0-11.2 0A15.7 15.7 0 0 1 11.1 4.4L10.9 4a16.9 16.9 0 0 0-4.2 1.3C4.1 9.1 3.4 12.8 3.7 16.4a17 17 0 0 0 5.2 2.6l.4-.6a11 11 0 0 1-1.6-.8l.3-.3a12.1 12.1 0 0 0 10 0l.3.3a11 11 0 0 1-1.6.8l.4.6a17 17 0 0 0 5.2-2.6c.4-4.2-.6-7.8-3-11.1zM9.7 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2zm4.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2z' },
    github: { t: 'GitHub', d: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z' },
    reddit: { t: 'Reddit', d: 'M22 12.1a2.1 2.1 0 0 0-3.6-1.5 10.4 10.4 0 0 0-5.5-1.7l.9-4.3 3 .6a1.6 1.6 0 1 0 .2-1l-3.5-.7a.5.5 0 0 0-.6.4l-1.1 5A10.4 10.4 0 0 0 5.6 10.6a2.1 2.1 0 1 0-2.3 3.4 4 4 0 0 0 0 .6c0 3.1 3.9 5.6 8.7 5.6s8.7-2.5 8.7-5.6a4 4 0 0 0 0-.6 2.1 2.1 0 0 0 1.3-1.9zM7.5 13.6a1.6 1.6 0 1 1 1.6 1.6 1.6 1.6 0 0 1-1.6-1.6zm8.9 4.2a5.9 5.9 0 0 1-4.4 1.4 5.9 5.9 0 0 1-4.4-1.4.5.5 0 0 1 .7-.7 5 5 0 0 0 3.7 1.1 5 5 0 0 0 3.7-1.1.5.5 0 1 1 .7.7zm-.5-2.6a1.6 1.6 0 1 1 1.6-1.6 1.6 1.6 0 0 1-1.6 1.6z' },
    youtube: { t: 'YouTube', d: 'M23 7.5a2.9 2.9 0 0 0-2-2C19.2 5 12 5 12 5s-7.2 0-9 .5a2.9 2.9 0 0 0-2 2A30.4 30.4 0 0 0 .5 12 30.4 30.4 0 0 0 1 16.5a2.9 2.9 0 0 0 2 2c1.8.5 9 .5 9 .5s7.2 0 9-.5a2.9 2.9 0 0 0 2-2 30.4 30.4 0 0 0 .5-4.5 30.4 30.4 0 0 0-.5-4.5zM9.8 15.3V8.7l6 3.3z' },
    web: { t: 'Website', d: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm6.9 6h-2.6a13.6 13.6 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8ZM12 4.1a12 12 0 0 1 1.6 3.9h-3.2A12 12 0 0 1 12 4.1ZM4.3 14a7.9 7.9 0 0 1 0-4h3a16.6 16.6 0 0 0 0 4Zm.8 2h2.6a13.6 13.6 0 0 0 1.3 3.4A8 8 0 0 1 5.1 16Zm2.6-8H5.1a8 8 0 0 1 3.9-3.4A13.6 13.6 0 0 0 7.7 8ZM12 19.9A12 12 0 0 1 10.4 16h3.2A12 12 0 0 1 12 19.9ZM14 14h-4a14.8 14.8 0 0 1 0-4h4a14.8 14.8 0 0 1 0 4Zm1 5.4a13.6 13.6 0 0 0 1.3-3.4h2.6a8 8 0 0 1-3.9 3.4Zm1.7-5.4a16.6 16.6 0 0 0 0-4h3a7.9 7.9 0 0 1 0 4Z' }
  };
  SOC.social = SOC.web;

  function paintSocials(asset) {
    var row = $('.asset-meta-row') || ($('.website') && $('.website').parentElement);
    if (!row) return;
    var key = asset.code + '-' + asset.issuer;
    if (row.getAttribute('data-lxsoc') === key) return;      // already painted for this token
    row.setAttribute('data-lxsoc', key);
    [].forEach.call(row.querySelectorAll('a.lx-soc'), function (a) { a.parentNode.removeChild(a); });

    fetch('/lxapi/xrpltoml?iss=' + encodeURIComponent(asset.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(asset.code)))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (row.getAttribute('data-lxsoc') !== key) return;   // navigated to another token meanwhile
        // "NOT REACHED" IS NOT "NO LINKS". The endpoint resolves the issuer's domain against a 1200ms
        // deadline and finishes the lookup under waitUntil, so the FIRST ask for a cold issuer
        // legitimately comes back empty while warming the cache for the next one. This painted once
        // per token and never again, so that first empty answer was the row's answer until the reader
        // navigated away — measured: ATOM showed no buttons while the endpoint, asked by hand a
        // moment later, returned both of them.
        //
        // `reached` is the endpoint saying which of the two it was, so this asks again rather than
        // guessing — once, three seconds later, by which time the per-issuer lookup that was still
        // running under waitUntil has landed in the cache the second call reads.
        if (j && j.reached === false && !row.__lxSocRetry) {
          row.__lxSocRetry = 1;
          row.removeAttribute('data-lxsoc');
          setTimeout(function () { paintSocials(asset); }, 3000);
          return;
        }
        // AND AGAIN AGAINST WHAT THE PAGE ACTUALLY SHOWS. The endpoint already drops a link to the
        // issuer's own site, but it compares against the domain it RESOLVED, and this page does not
        // always display that one: LUMOS's header is pinned to lumoscore.com while its issuer's ledger
        // Domain is lumosdao.com. The duplicate globe RAZA reported is "a button repeating the words
        // beside it", so the thing to compare against is the words beside it.
        var shown = rootDomain((($('.website') || {}).textContent || '').trim());
        var links = ((j && j.links) || []).filter(function (l) {
          return !shown || rootDomain(l.url) !== shown;
        });
        var NS = 'http://www.w3.org/2000/svg';
        links.forEach(function (l) {
          var g = SOC[l.kind] || SOC.web;
          var a = document.createElement('a');
          a.className = 'lx-soc';
          a.href = l.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer nofollow';
          a.title = l.title || g.t;
          a.setAttribute('aria-label', l.title || g.t);
          // data-lxc opts out of the logo painter and data-logoed out of the healer: both repaint
          // short or empty elements, and this one is an icon.
          a.setAttribute('data-lxc', '');
          a.setAttribute('data-logoed', '1');
          var svg = document.createElementNS(NS, 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('fill', 'currentColor');
          svg.setAttribute('aria-hidden', 'true');
          var p = document.createElementNS(NS, 'path');
          p.setAttribute('d', g.d);
          svg.appendChild(p);
          a.appendChild(svg);
          row.appendChild(a);
        });
      })
      .catch(function () { /* no toml, no links — the row simply stays as it was */ });
  }

  // THE TOKEN'S LOGO WAS A BLANK GREY SQUARE ON EVERY PAGE.
  //
  // The design ships `<div class="asset-logo" data-lxc=""></div>` — an empty 64px box whose only
  // fill was a hardcoded USDC-blue gradient in CSS. `data-lxc` is the logo painter's OPT-OUT marker
  // (the same one `.lxad-logo` uses to defend itself), so the healer that fills every other icon on
  // the site skips this element BY DESIGN — and the design's own filler was never carried into the
  // fork. Nothing painted it, nothing errored, and the box measured a healthy 64x64 the whole time.
  //
  // The id is xrpl.to's md5, which /lxapi/xrpltoken already returns; `iss`+`cur` is the fallback for
  // the first paint, before that response lands (the endpoint derives the same md5 server-side).
  // Either way it goes through /lxapi/xrplthumb — the thumbnail endpoint needs the API key, and the
  // key must not reach the browser. See [[lumoscore-xrpl-wallet-logos]].
  function paintLogo(asset, d) {
    var box = $('.asset-logo');
    if (!box || box.getAttribute('data-lxlogo') === asset.code) return;

    var md5 = (d && /^[0-9a-f]{32}$/i.test(d.md5 || '')) ? d.md5 : '';
    var src = md5
      ? ('/lxapi/xrplthumb?id=' + md5 + '&w=64')
      : ('/lxapi/xrplthumb?iss=' + encodeURIComponent(asset.issuer)
         + '&cur=' + encodeURIComponent(currencyOf(asset.code)) + '&w=64');

    var img = document.createElement('img');
    img.alt = ''; img.width = 64; img.height = 64;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';

    // A token with no logo upstream answers 404. Initials are the honest fallback; a broken-image
    // glyph is not, and neither is the USDC gradient sitting under a token that is not USDC.
    img.onerror = function () {
      box.innerHTML = '';
      box.textContent = String(asset.code || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      box.style.backgroundImage = 'none';
      box.style.backgroundColor = 'rgba(255,255,255,.10)';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.fontWeight = '800';
      box.style.fontSize = '18px';
      box.style.color = '#fff';
      // We just wrote 3 characters into a small empty box — the exact shape the logo healer hunts.
      // data-logoed is its own skip marker. See [[lumoscore-logo-healer]].
      box.setAttribute('data-logoed', '1');
    };

    box.setAttribute('data-lxlogo', asset.code);
    box.innerHTML = '';
    // The logo is also the box's background (under the img): the review dialog reads this page's own token mark off
    // .asset-logo's background-image, and "none" gave it an empty circle (RAZA 2026-09-16: "[Still not appearing] There's no
    // logo showing up for ATOM when im buying it (review step)").
    box.style.backgroundImage = 'url("' + src + '")';
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.appendChild(img);
    img.src = src;
  }

  function shortAddr(a) {
    return (a && a.length > 14) ? (a.slice(0, 6) + '…' + a.slice(-4)) : (a || '');
  }

  // THE TRADE PANEL WAS NAMING THE WRONG TOKEN ENTIRELY. On the RLUSD page it read "Buy USDC" /
  // "Sell USDC", with "APT" on the pay side and "USDC" on the receive side, beside a holder filter
  // offering "10+ XLM / 100+ XLM / 1000+ XLM" and a pair label reading "LUMOS / XLM".
  //
  // Every one of those is the design's mock, and every one is a different chain's asset. The left of
  // the page was correct — real price, real order book, real stats — which is what made this easy to
  // walk past: the panel people actually trade in was the part still describing Aptos and Stellar.
  //
  // These are LABELS, not data: the panel's behaviour is unchanged, it is told which token it is on.
  function paintLabels(asset) {
    var code = asset.code;

    // Buy / Sell buttons name the token being traded, not the quote asset. Substring selector for
    // the same reason as the chips below: the phone's are `.mdxa-side-btn`.
    $$('[class*="dxa-side-btn"]').forEach(function (b) {
      var sell = b.classList.contains('sell');
      // Written as a text node so the button keeps whatever the design put inside it.
      var t = (sell ? 'Sell ' : 'Buy ') + code;
      if (b.textContent.trim() !== t) b.textContent = t;
    });

    // The two asset chips are the pay side and the receive side, and which is which flips with
    // Buy/Sell: buying spends XRP to get the token, selling spends the token to get XRP.
    //
    // Scoped PER CARD rather than by a global index. The page carries more than one trade card (the
    // desktop panel and the phone's), so indexing every .dxa-trade-asset on the page would read the
    // Buy/Sell state of one card and apply it to the other — and with only one card visible at a
    // time, the wrong one is the one nobody would notice was wrong.
    // THE PHONE PREFIXES THESE CLASSES, so every desktop selector here matched nothing on mobile
    // and the pay-side chip kept reading "APT" under "You pay" — on the panel someone trades in.
    // Measured at 375px: `.dxa-trade-card` absent, `.dxa-trade-asset` count 0, and the real element
    // is `.mdxa-trade-asset` inside `.mdxa-pane-swap`.
    //
    // `[class*="dxa-trade-asset"]` matches BOTH, because "mdxa-trade-asset" contains the desktop
    // name as a substring — the phone's naming is the desktop's with a letter in front, so one
    // selector covers the pair instead of two lists that drift apart.
    var cards = $$('.dxa-trade-card');
    if (!cards.length) cards = $$('.mdxa-pane-swap');
    if (!cards.length) cards = [document];
    cards.forEach(function (card) {
      var sellActive = !!card.querySelector('[class*="dxa-side-btn"].sell.active');
      var order = sellActive ? [code, 'XRP'] : ['XRP', code];
      $$('[class*="dxa-trade-asset"]', card).forEach(function (c, i) {
        if (i > 1) return;
        // data-logoed keeps the logo layer from eating a 1-5 character ticker.
        try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); c.style.background = ''; } catch (e) {}
        // THE MARK BESIDE THE TICKER, as lumoscore.com draws it (RAZA 2026-09-15: "the you pay and you
        // receive asset logos are missing") — a `.dxa-trade-ic` inside the chip, painted from the token's
        // own logo. The phone's chips are drawn in CSS by lx-mobtrade, so they keep plain text.
        // The phone draws its chips in CSS: lx-mobtrade stamps `data-lxmt-code="XLM"` and an XLM mark on
        // every one, and its ::after label wins over the text. limit.js's stylesheet already lets
        // `[data-lxxc]` and `--lxx-logo` override that, so the swap chips carry the same two.
        if (/(^|\s)mdxa-/.test(c.className)) {
          c.textContent = order[i];
          c.setAttribute('data-lxxc', order[i]);
          c.style.setProperty('--lxx-logo', 'url("' + thumbFor(order[i] === 'XRP' ? null : { c: currencyOf(asset.code), i: asset.issuer }) + '")');
          return;
        }
        var logo = thumbFor(order[i] === 'XRP' ? null : { c: currencyOf(asset.code), i: asset.issuer });
        c.__lxxChip = { code: order[i], logo: logo };
        paintSwapChip(c);
        // THE RECEIVE CHIP WAS REPAINTED AFTER THIS (RAZA 2026-09-15: "the logo of atom in you receive is too tiny"):
        // another painter rewrote it to the bare ticker with a generic ATOM icon as an 18x13 background on the chip
        // itself. The chip is watched and rebuilt whenever it loses its mark, at most thirty times.
        if (!c.__lxxChipObs && window.MutationObserver) {
          var n = 0;
          c.__lxxChipObs = new MutationObserver(function () {
            if (n > 30) return;
            var ok = c.querySelector('.dxa-trade-ic') && !c.style.backgroundImage;
            if (!ok) { n++; paintSwapChip(c); }
          });
          c.__lxxChipObs.observe(c, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        }
      });
    });

    // THE PROMOTED CARD IS LUMOS'S AD ON EVERY PAGE (RAZA 2026-09-15: "its supposed to show LUMOS/XRP instead of SLT/XRP.
    // Also link View LUMOS button to LUMOS token page on XRPL"). It named the page's own token, and its link was the
    // Stellar LUMOS page, with data-adself set everywhere (the design reads "LUMOS" off a query string this site does not
    // use), so the button only scrolled.
    $$('.lxad-pair').forEach(function (p) {
      if (p.getAttribute('data-lxad') === '1') return;
      p.setAttribute('data-lxad', '1');
      p.textContent = 'LUMOS / XRP ';
      var vt = document.createElement('span');
      vt.className = 'lx-vtick';
      vt.title = 'Verified issuer';
      vt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      p.appendChild(vt);
    });
    $$('.lxad').forEach(function (ad) { ad.setAttribute('data-href', '/lumos/xrpl'); ad.removeAttribute('data-adself'); });

    // Holder-size filters are denominated in the quote asset.
    $$('.chip').forEach(function (c) {
      var t = (c.textContent || '');
      if (/\bXLM\b/.test(t)) c.textContent = t.replace(/\bXLM\b/g, 'XRP');
    });
  }

  function paintSwapChip(c) {
    var s = c.__lxxChip;
    if (!s) return;
    c.style.background = '';
    c.removeAttribute('data-logo');
    c.setAttribute('data-logoed', '1');
    c.textContent = '';
    var ic = el('span', 'dxa-trade-ic');
    ic.setAttribute('data-logoed', '1');
    ic.setAttribute('data-lxfixed', '1');
    // The container's logo engine skips an element that holds a [data-logo] child; with none, it took the chip's
    // " ATOM " for a ticker slot, stamped data-logo="ATOM" and redrew it forever as a generic 18x13 mark. An empty
    // value names no logo, so the engine never paints the mark itself (the snapshot button uses the same escape).
    ic.setAttribute('data-logo', '');
    ic.style.cssText = 'background:url("' + s.logo
      + '") center center / cover no-repeat transparent;box-shadow:none;border-radius:50%';   // cover: a padded logo read as a dot
    // The review dialog (lx-feemodal) reads a leg's mark from --lxtic first (RAZA 2026-09-15: "There's no logo showing up for
    // ATOM when im buying it (review step)").
    ic.style.setProperty('--lxtic', 'url("' + s.logo + '")');
    c.appendChild(ic);
    c.appendChild(document.createTextNode(' ' + s.code + ' '));
  }

  // The Buy/Sell toggle is the design's own, so the chips are re-labelled whenever it changes rather
  // than only on load — otherwise switching to Sell leaves the pay side still saying XRP.
  function watchSide(asset) {
    if (window.__lxxSideWatch) return;
    window.__lxxSideWatch = 1;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[class*="dxa-side-btn"]');
      if (!b) return;
      setTimeout(function () { paintLabels(asset); }, 0);   // after the design flips .active
    }, true);
  }

  // THE BOOK'S HEADINGS AND SPREAD STILL NAMED ANOTHER CHAIN (RAZA 2026-09-15: "its showing APT instead
  // of XRPL and USDC instead of RLUSD"). "Price (APT) · Amount (USDC)" and "Spread 0.0024 APT (0.06%)"
  // were the design's, over a real book. Depth is the running total of the TOKEN on this side, so it is
  // labelled in the token rather than copying Stellar's "Depth (XLM)".
  function paintBookHead(asset, b) {
    $$('.dxa-ob-head, .mdxa-ob-head').forEach(function (h) {
      var sp = h.querySelectorAll('span');
      if (sp[0]) plain(sp[0], 'Price (XRP)');
      if (sp[1]) plain(sp[1], 'Amount (' + asset.code + ')');
      if (sp[2]) plain(sp[2], 'Depth (' + asset.code + ')');
    });
    var ask = b && b.asks[0] ? b.asks[0].px : null, bid = b && b.bids[0] ? b.bids[0].px : null;
    $$('.dxa-ob-spread, .mdxa-ob-spread').forEach(function (s) {
      var sp = s.querySelectorAll('span');
      if (ask && bid) {
        var diff = ask - bid, mid = (ask + bid) / 2;
        if (sp[1]) plain(sp[1], xrp(diff, 4) + ' XRP');
        if (sp[2]) plain(sp[2], '(' + (diff / mid * 100).toFixed(2) + '%)');
      } else {
        if (sp[1]) plain(sp[1], '—');
        if (sp[2]) plain(sp[2], '');
      }
    });
  }

  // The phone's exchange rows are cards, not table rows, so they carry the hash instead of a link.
  function wireTxLinks() {
    if (window.__lxxTxLinks) return;
    window.__lxxTxLinks = 1;
    window.addEventListener('click', function (e) {
      var r = e.target && e.target.closest ? e.target.closest('[data-lxtx]') : null;
      if (!r || (e.target.closest && e.target.closest('a'))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.open('https://bithomp.com/explorer/' + encodeURIComponent(r.getAttribute('data-lxtx')), '_blank', 'noopener');
    }, true);
  }

  function note(text) {
    var a = $('#dxaObAsks') || $('#mdxaObAsks');
    var b = $('#dxaObBids') || $('#mdxaObBids');
    [a, b].forEach(function (n) {
      if (!n) return;
      n.innerHTML = '';
      var d = el('div', 'dxa-ob-row', text);
      d.style.cssText = 'opacity:.65;justify-content:center';
      n.appendChild(d);
    });
  }

  // THE SWAP PANEL IS THE DESIGN'S, AND NOTHING IN THIS LAYER EVER WIRED IT.
  //
  // What it was showing, live, under an XRP Ledger heading — every value the template's Aptos mock:
  //     Rate          1 APT = 0.23659 USDC
  //     Min received  23.541 USDC
  //     Network fee   0.00001 APT
  // with the pay and receive boxes pre-filled 100 and 23.659. A trading panel quoting a rate for
  // the wrong chain, from numbers nobody computed, is the worst thing that was left on this page:
  // it does not look like placeholder text.
  //
  // Treated the same way as Create Pool, on RAZA's call: state what we actually know, em-dash what
  // we do not, empty the invented amounts, and disable the action with a label that says why.
  // Building a real quote — pricing against the order book, slippage, price impact — is a feature,
  // and this build has never round-tripped a signature.
  //
  // Deliberately NOT touched: "Slippage tolerance" is a user setting rather than a quote, and the
  // trading-fee row is owned by the fee layer and already reads correctly.
  function setSumRow(label, value) {
    var rows = $$('.dxa-tsum-row');
    for (var i = 0; i < rows.length; i++) {
      var kids = rows[i].children;
      if (kids.length < 2) continue;
      if ((kids[0].textContent || '').trim().toLowerCase() !== label) continue;
      kids[kids.length - 1].textContent = value;
    }
  }

  // TWO BLOCKS THAT EXIST ONLY ON THE PHONE, and neither was ever painted.
  //
  // Found by re-checking today's trade-asset work at 375px rather than trusting the desktop pass:
  //
  //   * `.ohlc-strip` — "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT". Four fabricated prices in
  //     another chain's asset, across the top of the chart. There is no desktop equivalent, which is
  //     exactly why it survived.
  //   * `.asset-description` — 251 characters describing USD Coin and Circle, shown on the RLUSD
  //     page. Not merely the wrong chain: the wrong company's prose under someone else's token.
  //
  // Both are BLANKED rather than invented. /lxapi/xrpltoken carries no open/close and no description
  // — the fields simply are not in the payload — so there is nothing honest to put there. An em dash
  // says "not known"; leaving the design's text says something false and specific.
  function paintMobileOnly() {
    // The strip ships "O 4.55 APT  H 4.62 APT  L 4.54 APT  C 4.60 APT" — another chain's asset,
    // four fabricated prices. Dashed here so that is never what a reader sees, then filled with the
    // real O/H/L/C/Δ/Vol by paintOhlcStrip() as soon as the chart's candles land. If the chart feed
    // fails, the dashes are the correct final state and stay.
    var strip = $('.ohlc-strip');
    if (strip) {
      $$('.v', strip).forEach(function (v) { v.textContent = '—'; });
    }

    paintDescription();
  }

  // THE DESCRIPTION SLOT, AND WHY IT IS USUALLY EMPTY.
  //
  // `.asset-description` ships with 251 characters about USD Coin and Circle — the wrong company's
  // prose under someone else's token — so it cannot simply be left alone. It used to be deleted
  // outright. It is now filled when, and only when, we actually know the token.
  //
  // TWO SOURCES, IN THIS ORDER:
  //
  //   1. `__lxTokenRegistry[CODE-ISSUER].desc` — our own launchpad's mints, where the creator wrote
  //      the text through our form. We control it, so it wins.
  //   2. /lxapi/xrplmeta — XRPLMeta, the XRP Ledger's metadata service, which aggregates the
  //      issuer-published metadata and has descriptions for blue-chips and meme tokens alike.
  //
  // This used to remove the paragraph outright, on the conclusion that no description source
  // existed. Two of the three facts behind that were right — /lxapi/xrpltoken carries no
  // description (130+ fields, none of them one), and ripple.com publishes no [[TOKENS]] block in
  // its `xrp-ledger.toml` — but the conclusion was wrong: XRPLMeta is exactly the service that
  // aggregates what those two checks were looking for. See [[lumoscore-asset-descriptions]].
  //
  // HIDDEN FIRST, NOT REMOVED. The paragraph ships with 251 characters about USD Coin and Circle,
  // so it cannot be left visible for the length of a fetch — but removing it means there is nothing
  // left to fill. So it is hidden immediately and then either filled or removed, which shows the
  // mock to nobody and still leaves no empty gap for a token that has no description.
  //
  // The text is ATTACKER-CONTROLLED — anyone can issue a token and publish metadata for it — so it
  // goes in through plain(), which is textContent, never innerHTML. The edge caps and normalises it.
  function paintDescription() {
    var desc = $('.asset-description');
    if (!desc) return;
    var a = window.__lxxAssetRef || null;

    var reg = window.__lxTokenRegistry || {};
    var row = a ? reg[a.code + '-' + a.issuer] : null;
    var own = row && typeof row.desc === 'string' ? row.desc.trim() : '';
    if (own) { show(desc, own); return; }

    desc.style.display = 'none';                       // the mock is never on screen
    if (!a) { drop(desc); return; }
    // RAZA 2026-09-16: "Its taking too long for the asset description to load. It appears after a couple seconds." XRPLMeta
    // can take seconds; a description read once is kept in this browser for a week, shown at once, and refreshed daily.
    var ck = 'lumos.xdesc.' + a.issuer + '-' + currencyOf(a.code), cached = null;
    try { cached = JSON.parse(localStorage.getItem(ck) || 'null'); } catch (e) {}
    if (cached && typeof cached.d === 'string' && Date.now() - cached.t < 7 * 864e5) {
      show(desc, cached.d || generic());
      if (Date.now() - cached.t < 864e5) return;
    }

    // STRAIGHT FROM XRPLMETA TOO (RAZA 2026-09-16: "[Still taking too long]"). Measured: the edge's request to XRPLMeta hangs
    // until its 12s abort while the same URL answers a browser in 0.8s, and XRPLMeta serves CORS to any origin. The browser asks it
    // directly as well; whichever answers first fills the paragraph. The text is still written as plain text only.
    fetch('https://s1.xrplmeta.org/token/' + encodeURIComponent(currencyOf(a.code) + ':' + a.issuer))
      .then(function (r) { return r.status === 404 ? { meta: { token: {} } } : r.json(); })
      .then(function (j) {
        var t = (j && j.meta && j.meta.token) || {};
        var txt = String(t.desc || '').replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (txt.length > 600) txt = txt.slice(0, 600).replace(/\s+\S*$/, '') + '…';
        try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: txt })); } catch (e) {}
        show(desc, txt || generic());
      }, function () {});
    fetch('/lxapi/xrplmeta?iss=' + encodeURIComponent(a.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(a.code)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: d.desc || '' })); } catch (e) {} }
        if (d && d.ok && d.desc) show(desc, d.desc);
        else show(desc, generic());
      })
      .catch(function () { show(desc, generic()); });

    // STELLAR'S LINE FOR A TOKEN WITH NO DESCRIPTION (RAZA 2026-09-15: "If the asset of trade-Asset page doesnt have
    // description, then just place a static description just like we did on Stellar. Otherwise ... it shows blank space").
    function generic() {
      return a.code + ' trades on the LumosCore DEX against XRP on the XRP Ledger. Live price, order book, trades and holders are pulled directly from the XRP Ledger.';
    }

    function show(el, text) { plain(el, text); el.style.display = ''; }
    function drop(el) { if (el.parentNode) el.parentNode.removeChild(el); }
  }


  function load() {
    var asks = $('#dxaObAsks') || $('#mdxaObAsks');
    if (!asks) return;                                  // not this page

    var asset = fromUrl();
    if (!asset) { note('No token in this address.'); return; }
    window.__lxxAssetRef = asset;              // paintDescription() reads the registry by CODE-ISSUER

    lift();
    note('Reading the XRP Ledger…');

    // The panel's labels do not depend on the stats feed, so they are set from the URL's asset right
    // away and re-set when the Buy/Sell toggle moves. A failing feed must not leave the trade panel
    // naming another chain's token.
    paintLabels(asset);
    watchSide(asset);

    // BEFORE the feeds, not after. These rows carry another chain's numbers until something
    // overwrites them, so the window between load and the first response is exactly when a reader
    // would see "1 APT = 0.23659 USDC". The rate is filled in below once a real price arrives.
    paintMobileOnly();
    wireTxLinks();

    // Details and book are independent: a token with no market still has an identity, and a book
    // is still a book if the stats feed is down. One failing must not blank the other.
    fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(asset.issuer + '-' + currencyOf(asset.code)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.__lxxAssetData = (d && d.ok) ? d : null;
        // WHY it is missing, recorded alongside the fact that it is. The endpoint says "upstream 404"
        // only when the feed has genuinely never heard of the token; anything else — a refusal, a
        // rate limit, a dropped connection — is an outage and must not be reported as the token
        // having no market. See noMarketNote.
        window.__lxxAssetMiss = (d && d.ok) ? null
          : (/404/.test(String((d && d.error) || '')) ? 'none' : 'down');
        try { window.dispatchEvent(new CustomEvent('lxx:assetdata')); } catch (e) {}
        paintHeader(asset, window.__lxxAssetData);
        paintStats(window.__lxxAssetData);
        liftIdentity();
        paintPerf(window.__lxxAssetData);
        loadLongPerf(asset);
        chartControls(asset);
        loadChart(asset, '1D');
        wireChartRanges(asset);
        paintExchanges(asset);
        paintHolders(asset);
        paintPools(asset);
        wireTabs(asset);
        // The one quote figure that is real: the page's own live price, same source as the header.
        // `price`, not `p` — the payload names it in full, and reading the wrong key here would
        // have left the rate on an em dash while looking like it had been wired.
        var p = window.__lxxAssetData && window.__lxxAssetData.price;
        if (p != null && isFinite(p)) {
          setSumRow('rate', '1 ' + asset.code + ' = ' + xrp(p) + ' XRP');
        }
      })
      .catch(function () { paintHeader(asset, null); paintStats(null); liftIdentity(); });

    // Named and exposed so the Limit tab (browser/limit.js) can show an order it has just placed
    // without reloading the page. Same read, same painters — one way the book gets drawn.
    window.__lxxBookReload = function () {
      return book(asset).then(function (b) {
        window.__lxxBook = b;
        paintBook($('#dxaObAsks') || $('#mdxaObAsks'), b.asks, 'ask');
        paintBook($('#dxaObBids') || $('#mdxaObBids'), b.bids, 'bid');
        paintBookHead(asset, b);
        try { window.dispatchEvent(new CustomEvent('lxx:book')); } catch (e) {}
      });
    };
    window.__lxxBookReload().catch(function () {
      note('Could not read the order book.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAssetReload = load;
})();

// Trade-Asset → Limit: real limit orders on the XRP Ledger.
//
// WHAT A LIMIT ORDER IS HERE. One OfferCreate against the XRP order book for this token — the same
// book the Orderbook tab reads. The creator SELLS TakerGets and BUYS TakerPays (xrpl.org, OfferCreate):
//   Buy  CODE  →  TakerPays = the token amount, TakerGets = amount × price in XRP drops, no flags.
//   Sell CODE  →  TakerGets = the token amount, TakerPays = amount × price in drops, tfSell, so the
//                 whole amount sells even when better bids would reach the XRP total sooner.
// That is Stellar's manageBuyOffer / manageSellOffer. The amounts come from lxx.offerFor in
// xrpl-core, where they are under test.
//
// NO PLATFORM FEE. RAZA, 2026-08-19: no fee on limit orders — a resting order may never fill, and the
// Stellar build places the offer on its own. So this is exactly one transaction. The "Trading fee
// 0.2%" row that the inherited lx-feemodal appends to every trade summary is hidden in this pane,
// because it describes a charge this order does not make.
//
// WHAT THE LEDGER CHECKS, AND WHAT IS CHECKED HERE FIRST (xrpl.org, Offers):
//   * an offer cannot be placed for something you do not hold (tecUNFUNDED_OFFER) — the token's own
//     issuer is the documented exception, and is treated as one;
//   * every offer that stays on the book takes one owner-reserve increment (tecINSUF_RESERVE_OFFER);
//   * buying a token with no trustline is allowed — the ledger creates the line when the offer
//     fills — but that line needs its own increment, so a buy without one is checked for both.
// Reserves come from server_info, never a constant. The ledger stays the authority: a pre-check that
// passes can still be refused, and the result code is translated below rather than shown raw.
//
// NO REVIEW POPUP. RAZA's rule is no new popups; lx-feemodal already lets limit clicks through; and
// the wallet's own approval screen is the confirmation — the same call mint.js made. Progress and
// results go in one status line under the button.
//
// BOTH LAYOUTS FROM ONE CODE PATH. lx-mobtrade (inherited) copies the desktop class names onto the
// phone's elements, but only on its own 900ms cadence, so selectors here are substring matches
// (`[class*="dxa-…"]`) that find either spelling whether or not that copy has happened yet.
//
// THE PHONE'S CHIPS ARE DRAWN BY CSS. lx-mobtrade labels them `data-lxmt-code="XLM"` and paints an
// XLM logo through ::after / ::before, rewriting both every 900ms — text that no text scan sees.
// Rewriting that attribute would be a two-timer race, so the right label goes in an attribute
// lx-mobtrade never touches (`data-lxxc`) and a more specific rule prefers it.
//
// SIGNING goes through window.lxc.submit, which today means GemWallet and refuses clearly otherwise.
(function () {
  if (window.__lxxLimit) return;
  window.__lxxLimit = 1;

  var RPC = 'https://xrplcluster.com/';
  // xrpl.to's fixed id for XRP — the one token whose logo id is not derived from an issuer.
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function lxx() { return window.lxx; }

  // LumosCore's mark on a limit order. Orders are free — no platform fee — so like the pool
  // operations this is the only thing tying one to this site. See the note in createpool.js.
  function lxMemo(text) {
    var hex = function (s) { var h = ''; for (var i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0'); return h.toUpperCase(); };
    return { Memo: { MemoType: hex('LumosCore'), MemoFormat: hex('text/plain'), MemoData: hex(text) } };
  }
  function asset() { return window.__lxxAssetRef || null; }
  function addr() {
    try { return window.lxc && window.lxc.address ? window.lxc.address() : null; } catch (e) { return null; }
  }
  function currencyOf(code) { try { return lxx().encodeCurrency(code); } catch (e) { return code; } }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  // ---- the pane ----------------------------------------------------------------------------------
  function pane() { return $('[class*="dxa-pane-limit"]'); }
  function isPhone(p) { return /(^|\s)mdxa-pane-limit(\s|$)/.test(p.className); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  function side(p) {
    var b = $('[class*="dxa-side-btn"].active', p);
    return b && b.classList.contains('sell') ? 'sell' : 'buy';
  }

  // The leading number and nothing after it. Deleting invalid characters wherever they appear turns a
  // mis-aimed paste into a different, plausible price — Stellar's limit field did exactly that
  // ("0.001 GBNZ…" became 0.00147). Stopping at the first stray character keeps what was typed.
  function numOnly(v) {
    v = String(v == null ? '' : v).split(',').join('.');
    var out = '', dot = false;
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c >= '0' && c <= '9') { out += c; continue; }
      if (c === '.' && !dot) { dot = true; out += c; continue; }
      if (out === '' && (c === ' ' || c === '\t')) continue;
      break;
    }
    return out;
  }
  function num(v) { var s = numOnly(v); return (s === '' || s === '.') ? NaN : Number(s); }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a > 0 && a < 1e-6) return Number(n).toPrecision(3);
    var d = dp != null ? dp : (a >= 1000 ? 2 : a >= 1 ? 4 : 7);
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  // THE SITE'S OWN QUANTITY FORMATTER, ported from Stellar's _dexassetdata.js so the two builds print
  // the same figure the same way (RAZA 2026-10-08: "yes make them identical"). It abbreviates above a
  // thousand (258800 -> 258.8K) and compresses the leading-zero run below a thousandth into a
  // subscript count (0.0000253 -> 0.0₄253), which shortens without dropping a digit — the convention
  // every exchange uses. Between those it spells the number out, cutting at three decimals and marking
  // the cut with two dots so a truncated figure cannot be read as an exact one; an exact 0.5 stays
  // "0.5". The threshold for the subscript form is FIVE zeros, not four: 0.000324 already fits, and
  // compressing something readable only makes it harder to read.
  //
  // Kept byte-for-byte equivalent to Stellar's chain (SUBD/zsub/trimZ/smallNum/abbrNum/qtyTxt) rather
  // than re-derived, because "identical" is the whole requirement. SUBD is built with fromCharCode for
  // the same reason the rest of this file avoids exotic literals — it is injected verbatim at build.
  var SUBD = String.fromCharCode(8320, 8321, 8322, 8323, 8324, 8325, 8326, 8327, 8328, 8329);
  function zsub(n) { var s = String(n), o = ''; for (var i = 0; i < s.length; i++) o += SUBD.charAt(+s.charAt(i)); return o; }
  function trimZ(t) {
    while (t.length > 1 && t.charAt(t.length - 1) === '0') t = t.slice(0, -1);
    if (t.charAt(t.length - 1) === '.') t = t.slice(0, -1);
    return t;
  }
  function smallNum(x, sig) {
    x = +x || 0; if (!(x > 0)) return '0';
    var e = x.toExponential((sig || 4) - 1), i = e.indexOf('e');
    if (i < 0) return String(x);
    var mant = trimZ(e.slice(0, i)).split('.').join(''), exp = -parseInt(e.slice(i + 1), 10);
    if (exp >= 5) return '0.0' + zsub(exp - 1) + mant;
    if (x >= 1e-8) return trimZ(x.toFixed(8));
    if (!(exp > 1)) return trimZ(x.toFixed(8));
    return '0.0' + zsub(exp - 1) + mant;
  }
  function abbrNum(n) {
    n = +n || 0; var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function qtyTxt(n) {
    n = +n || 0; var a = Math.abs(n);
    if (a >= 1000) return abbrNum(n);
    if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (a === 0) return '0';
    if (a >= 0.001) { var t = n.toFixed(3); return (Math.abs((+t) - n) < 1e-12) ? String(+t) : (t + '..'); }
    return (n < 0 ? '-' : '') + smallNum(Math.abs(n), 4);
  }

  // An input value: plain digits with no grouping commas, so it parses back to the same number.
  function plainNum(n) {
    if (!isFinite(n) || n <= 0) return '';
    return (lxx() && lxx().iouValue && lxx().iouValue(Number(Number(n).toPrecision(12)))) || '';
  }
  // Floored when offering "all of it": a MAX that rounds up asks for more than the account holds.
  function floorTo(n, dp) { var m = Math.pow(10, dp); return Math.floor(n * m) / m; }

  // ---- painting ----------------------------------------------------------------------------------
  // Text for the desktop chip; attribute and logo for the phone's CSS-drawn one (see header).
  // data-logoed keeps the logo healer — which repaints any small element holding 1–5 characters — off
  // a three-letter ticker.
  function chip(f, code, logo) {
    var c = f && $('[class*="dxa-trade-asset"]', f);
    if (!c) return;
    try { c.setAttribute('data-logoed', '1'); c.removeAttribute('data-logo'); } catch (e) {}
    if (c.getAttribute('data-lxxc') !== code) c.setAttribute('data-lxxc', code);
    var v = logo ? 'url("' + logo + '")' : 'none';
    if (c.style.getPropertyValue('--lxx-logo') !== v) c.style.setProperty('--lxx-logo', v);
    if (/(^|\s)mdxa-/.test(c.className)) {
      c.style.background = '';
      if (c.textContent !== code) c.textContent = code;
      return;
    }
    // DESKTOP: THE MARK ALONE, as lumoscore.com's Limit tab draws it — a logo disc with no ticker beside
    // it (RAZA 2026-09-15: "the assets logos and other details are missing"). The ticker stays on the
    // element as its title and data-lxic, which is where Stellar keeps it.
    if (c.textContent !== '') c.textContent = '';
    c.setAttribute('data-lxic', code);
    c.title = code;
    // THE MARK GOES IN --lxtic, NOT background (RAZA 2026-09-15: "still not showing the logos"). The
    // inherited sheet — Stellar's own limit-chip rules — sets background-image:none!important on this chip
    // and paints the logo from a ::before reading var(--lxtic). An inline background drew nothing, which
    // is why the chips were empty rings.
    var tic = logo ? ('url("' + logo + '")') : '';
    if (c.getAttribute('data-lxtic') !== tic) {
      if (tic) c.style.setProperty('--lxtic', tic); else c.style.removeProperty('--lxtic');
      c.setAttribute('data-lxtic', tic);
    }
    if (c.hasAttribute('data-lxbg')) { c.style.background = ''; c.style.boxShadow = ''; c.removeAttribute('data-lxbg'); }
  }

  function mono(f, text) {
    var row = f && $('[class*="dxa-trade-frow"]', f);
    var m = row && $('.mono', row);
    if (m && m.textContent !== text) m.textContent = text;
    // `.dxa-trade-frow .mono:not(.lxp)` is hidden by the inherited sheet until a data layer claims it.
    if (m) m.classList.add('lxp');
  }

  // Stellar's MAX, on whichever field holds the asset being SPENT. Its CSS (.lxlim-max) is already in
  // the inherited stylesheet, so this adds no styling of its own.
  function maxButton(f, on) {
    var row = f && $('[class*="dxa-trade-frow"]', f);
    if (!row) return;
    var b = $('.lxlim-max', row);
    if (!on) { if (b && b.parentNode) b.parentNode.removeChild(b); return; }
    if (b) return;
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'lxlim-max';
    b.textContent = 'MAX';
    row.insertBefore(b, $('.lx-ltusd', row));               // MAX, then the dollar figure, as on Stellar
  }

  function sumRow(p, label, value) {
    $$('[class*="tsum"]', p).forEach(function (r) {
      var k = r.children;
      if (k.length < 2) return;
      if ((k[0].textContent || '').trim().toLowerCase() !== label) return;
      var v = k[k.length - 1];
      if (v.textContent !== value) v.textContent = value;
      v.classList.add('lxp');                              // same value gate as the field rows
    });
  }

  function say(p, text, tone) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxx-limit-note', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxx-limit-note';
      n.setAttribute('role', 'status');
      b.parentNode.insertBefore(n, b.nextSibling);
    }
    n.textContent = text || '';
    n.setAttribute('data-tone', tone || '');
    n.style.display = text ? '' : 'none';
  }

  function css() {
    if (document.getElementById('lxx-limit-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-limit-css';
    st.textContent =
      // The inherited fee row describes a charge a limit order does not make.
      '[class*="dxa-pane-limit"] .lx-feerow{display:none!important}'
      // The phone's chips: prefer our label and logo over lx-mobtrade's XLM.
      + '.mdxa-trade-asset.lxmt-chip[data-lxxc]::after{content:attr(data-lxxc)!important}'
      + '.mdxa-trade-asset.lxmt-chip[data-lxxc]::before{background-image:var(--lxx-logo,none)!important}'
      + '.lxx-limit-note{margin:8px 2px 0;font-size:13px;line-height:1.5;text-align:center;opacity:.85}'
      + '.lxx-limit-note[data-tone="bad"]{color:var(--down,#ef4444);opacity:1}'
      + '.lxx-limit-note[data-tone="good"]{color:var(--up,#16a34a);opacity:1}';
    document.head.appendChild(st);
  }

  // ---- the connected account ---------------------------------------------------------------------
  var acct = { key: null };

  function load(force) {
    var a = asset(), who = addr();
    if (!a || !who) { acct = { key: null }; paint(); return Promise.resolve(acct); }
    var key = who + '|' + a.issuer + '|' + a.code;
    if (!force && acct.key === key && (acct.loading || Date.now() - (acct.at || 0) < 20000)) {
      return acct.loading || Promise.resolve(acct);
    }
    var cur = currencyOf(a.code);
    var job = Promise.all([
      rpc('account_info', { account: who, ledger_index: 'validated' }).catch(function (e) {
        // An account that has never received XRP does not exist yet. An answer, not an outage.
        if (/actNotFound|not found/i.test(String(e && e.message))) return null;
        throw e;
      }),
      rpc('server_info', {}),
      lxx().allLines(rpc, who, { peer: a.issuer })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var vl = ((r[1] || {}).info || {}).validated_ledger || {};
      var reserve = { base: Number(vl.reserve_base_xrp), inc: Number(vl.reserve_inc_xrp) };
      var s = info ? lxx().spendableXrp(info.Balance, info.OwnerCount, reserve) : null;
      var line = ((r[2] && r[2].lines) || []).filter(function (l) {
        return l.currency === cur && l.account === a.issuer;
      })[0];
      acct = {
        key: key, at: Date.now(), found: !!info,
        spend: s ? s.spendable : null,
        inc: isFinite(reserve.inc) ? reserve.inc : null,
        line: !!line, bal: line ? Math.max(0, Number(line.balance)) : 0,
        issuer: who === a.issuer
      };
      paint();
      return acct;
    }).catch(function () {
      acct = { key: key, at: 0, failed: true };
      paint();
      return acct;
    });
    acct = { key: key, loading: job };
    return job;
  }

  function paint() {
    var p = pane(), a = asset();
    if (!p || !a) return;
    var f = fields(p);
    if (f.length < 2) return;
    var s = side(p);
    var tokLogo = '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer)
      + '&cur=' + encodeURIComponent(currencyOf(a.code)) + '&w=48';

    chip(f[0], 'XRP', XRP_LOGO);
    chip(f[1], a.code, tokLogo);
    if (f[2]) chip(f[2], 'XRP', XRP_LOGO);

    // Stellar parity: the price field carries no "Market:" label. The design's was "Market: 4.22711".
    mono(f[0], '');

    // "Avail" and MAX sit on the asset being SPENT: the token when selling, XRP (the Total) when buying.
    var spendF = s === 'sell' ? f[1] : (f[2] || f[1]);
    var otherF = s === 'sell' ? f[2] : f[1];
    if (otherF && otherF !== spendF) { mono(otherF, ''); maxButton(otherF, false); }

    var who = addr(), text = '', canMax = false;
    if (who) {
      if (acct.loading || acct.key == null || acct.failed) text = 'Avail: —';
      else if (s === 'sell') {
        if (acct.issuer) text = '';
        else { text = 'Avail: ' + fmt(floorTo(acct.bal, 6)) + ' ' + a.code; canMax = acct.bal > 0; }
      } else if (acct.spend != null) {
        text = 'Avail: ' + fmt(floorTo(Math.max(0, acct.spend), 2), 2) + ' XRP';
        canMax = acct.spend > 0;
      } else text = 'Avail: —';
    }
    mono(spendF, text);
    maxButton(spendF, canMax);

    // Total is editable on desktop, as on Stellar; lx-mobtrade keeps the phone's read-only and that is
    // left alone rather than fought.
    var tot = input(f[2]);
    if (tot && !isPhone(p) && tot.hasAttribute('readonly')) tot.removeAttribute('readonly');
    recalc(p);
  }

  function recalc(p) {
    var f = fields(p);
    if (f.length < 2) return;
    var price = num(input(f[0]) && input(f[0]).value);
    var amount = num(input(f[1]) && input(f[1]).value);
    var tot = input(f[2]);
    if (tot && document.activeElement !== tot) {
      var v = (price > 0 && amount > 0) ? plainNum(price * amount) : '';
      if (tot.value !== v) tot.value = v;
    }
    var a = asset(), op = side(p) === 'sell' ? '≥' : '≤';
    sumRow(p, 'filled when', price > 0
      ? (isPhone(p) ? (op + ' ' + fmt(price, 8) + ' XRP') : (a.code + '/XRP ' + op + ' ' + fmt(price, 8)))
      : '—');
    totalUsd(p);
    orderContext(p);
  }

  // "≈ $x USD" after MAX on the Total row, as on lumoscore.com: the total priced at the page's own XRP/USD.
  function totalUsd(p) {
    var f = fields(p);
    if (f.length < 3 || isPhone(p)) return;
    var row = $('[class*="dxa-trade-frow"]', f[2]);
    if (!row) return;
    var el = $('.lx-ltusd', row);
    if (!el) { el = document.createElement('span'); el.className = 'lx-ltusd'; row.appendChild(el); }
    var t = num(input(f[2]) && input(f[2]).value);
    var d = window.__lxxAssetData, u = (d && d.price && d.usd) ? d.usd / d.price : 0;
    var v = (t > 0 && u > 0) ? t * u : 0;
    var txt = v > 0 ? ('≈ $' + (v >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4)) + ' USD') : '';
    if (el.textContent !== txt) el.textContent = txt;
  }

  // ORDER CONTEXT — Stellar's block above Expiry, rebuilt for this book. Everything comes from the live
  // book dexasset.js already reads (window.__lxxBook: price in XRP per token, amount in the token) and the
  // price being typed:
  //   Best bid / ask   the top of each side
  //   Spread           ask minus bid, over the midpoint
  //   Your price       how far from the price that would fill immediately (the ask to buy, the bid to sell)
  //   Ahead of you     what already rests at your price or better on your side — or, if your price crosses,
  //   / Execution      how much of this order the other side can fill right now
  // Stellar's classes (.lx-oc, .lx-oc-t, .lx-oc-r, .lx-oc-ok, .lx-oc-hi) are in the inherited sheet.
  // THE PHONE GETS THIS BLOCK TOO (RAZA 2026-10-08, "fix both"). It used to return early on mobile,
  // which cost phone users the only answer to "will this actually fill?" — the one question a limit
  // order raises. Measured on lumoscore.com at 375px: Stellar renders it inside its mdxa-pane-limit
  // container, so skipping it here was a gap, not a deliberate narrowing. The anchor it inserts
  // before exists in both containers (mdxa-trade-summary / dxa-trade-summary, matched by substring)
  // and the .lx-oc rules are in the mobile build's inherited sheet, both checked before this ran.
  function orderContext(p) {
    var bk = window.__lxxBook;
    var sum = $('[class*="dxa-trade-summary"]', p);
    if (!bk || !sum || !sum.parentNode) return;
    var asks = bk.asks || [], bids = bk.bids || [];
    var host = $('.lx-oc', p);
    if (!asks.length && !bids.length) { if (host) host.style.display = 'none'; return; }
    if (!host) { host = document.createElement('div'); host.className = 'lx-oc'; sum.parentNode.insertBefore(host, sum); }
    host.style.display = '';
    var f = fields(p), a = asset();
    var pr = num(input(f[0]) && input(f[0]).value);
    var want = num(input(f[1]) && input(f[1]).value);
    var bb = bids.length ? bids[0].px : 0, ba = asks.length ? asks[0].px : 0;
    var mid = (bb && ba) ? (bb + ba) / 2 : (bb || ba);
    var spread = (bb && ba && mid) ? ((ba - bb) / mid * 100) : null;
    var s = side(p), ref = s === 'buy' ? ba : bb;
    var away = (pr > 0 && ref) ? ((pr - ref) / ref * 100) : null;
    var awayTxt = away == null ? '—' : (Math.abs(away) < 0.01 ? ('at the ' + (s === 'buy' ? 'ask' : 'bid'))
      : (Math.abs(away).toFixed(2) + '% ' + (away < 0 ? 'below ' : 'above ') + (s === 'buy' ? 'the ask' : 'the bid')));
    var fills = !!(pr > 0 && ref && (s === 'buy' ? pr >= ba : pr <= bb));
    var lbl, val, cls;
    if (!(pr > 0)) { lbl = 'Ahead of you'; val = '—'; cls = ''; }
    else if (fills) {
      var have = 0, src = s === 'buy' ? asks : bids;
      for (var k = 0; k < src.length; k++) {
        if (!(s === 'buy' ? src[k].px <= pr : src[k].px >= pr)) break;
        have += src[k].amt;
      }
      var pf = want > 0 ? Math.min(100, have / want * 100) : 100;
      lbl = 'Execution';
      if (pf >= 99.5) { val = 'fills now'; cls = 'lx-oc-ok'; }
      else { val = (pf < 0.5 ? '<1%' : Math.round(pf) + '%') + ' fills now | ' + Math.max(0, 100 - Math.round(pf)) + '% open order'; cls = 'lx-oc-hi'; }
    } else {
      var list = s === 'buy' ? bids : asks, q = 0, n = 0;
      for (var i = 0; i < list.length; i++) {
        if (!(s === 'buy' ? list[i].px >= pr : list[i].px <= pr)) break;
        q += list[i].amt; n++;
      }
      // A FULL LIST IS A FLOOR, NOT A COUNT. When the queue reaches the end of the depth the ledger
      // returned, everything past it is invisible — so the honest reading is "over X · N+ orders",
      // which is how lumoscore.com words it (measured: "over 258.8K USDC · 200+ orders"). Printing
      // the bare figures states a truncated count as the exact one, understating what is ahead of you.
      var capped = n > 0 && n >= list.length;
      lbl = 'Ahead of you'; cls = n ? 'lx-oc-hi' : 'lx-oc-ok';
      val = n
        ? ((capped ? 'over ' : '') + qtyTxt(q) + ' ' + a.code + ' · ' + n
          + (capped ? '+ orders' : (n === 1 ? ' order' : ' orders')))
        : 'nothing — first in line';
    }
    var P6 = function (v) { return v ? String(+Number(v).toPrecision(6)) : '—'; };
    host.textContent = '';
    var t = document.createElement('div'); t.className = 'lx-oc-t'; t.textContent = 'Order context'; host.appendChild(t);
    function row(k2, v2, c2) {
      var r = document.createElement('div'); r.className = 'lx-oc-r';
      var sp = document.createElement('span'); sp.textContent = k2;
      var b = document.createElement('b'); b.textContent = v2; if (c2) b.className = c2;
      b.setAttribute('data-logoed', '1');
      r.appendChild(sp); r.appendChild(b); host.appendChild(r);
    }
    row('Best bid / ask (XRP)', P6(bb) + ' / ' + P6(ba));
    row('Spread', spread == null ? '—' : spread.toFixed(2) + '%');
    row('Your price', awayTxt, fills ? 'lx-oc-ok' : '');
    row(lbl, val, cls);
  }

  function fromTotal(p) {
    var f = fields(p);
    var price = num(input(f[0]) && input(f[0]).value), total = num(input(f[2]) && input(f[2]).value);
    var ai = input(f[1]);
    if (ai) ai.value = (price > 0 && total > 0) ? plainNum(total / price) : '';
    recalc(p);
  }

  function fillMax(p) {
    var f = fields(p), ai = input(f[1]);
    if (!ai) return;
    var price = num(input(f[0]) && input(f[0]).value), amt = NaN;
    if (side(p) === 'sell') amt = acct.bal;
    else if (price > 0 && acct.spend != null) {
      // Leave room for the reserve the new order takes, and a trustline's too if there is none yet.
      var inc = acct.inc || 0;
      var room = acct.spend - inc - ((acct.line || acct.issuer) ? 0 : inc);
      amt = room > 0 ? room / price : 0;
    }
    ai.value = amt > 0 ? plainNum(floorTo(amt, 6)) : '';
    recalc(p);
  }

  // Once per side, the page's live price — the design ships "4.18" in the phone's box, another chain's
  // price typed in for you. Emptied rather than guessed when there is no price yet.
  function prefill(p) {
    var pin = input(fields(p)[0]);
    if (!pin) return;
    var d = window.__lxxAssetData, px = d && Number(d.price), s = side(p);
    if (p.__lxxPrefilled === s) return;
    if (px > 0 && isFinite(px)) { pin.value = plainNum(Number(px.toPrecision(6))); p.__lxxPrefilled = s; }
    else if (!p.__lxxCleared) { pin.value = ''; p.__lxxCleared = 1; }
  }

  // ---- placing the order -------------------------------------------------------------------------
  var CODES = {
    tecUNFUNDED_OFFER: function (s, a) {
      return s === 'sell' ? ('You do not hold enough ' + a.code + ' for this order.') : 'You do not hold enough XRP for this order.';
    },
    tecINSUF_RESERVE_OFFER: function () { return 'Not enough XRP to cover the reserve a new order needs.'; },
    tecNO_LINE: function (s, a) { return a.code + ' needs its issuer to authorise your trustline before you can trade it.'; },
    tecNO_AUTH: function (s, a) { return a.code + ' needs its issuer to authorise your trustline before you can trade it.'; },
    tecFROZEN: function (s, a) { return a.code + ' is frozen by its issuer, so it cannot be traded.'; },
    tecNO_ISSUER: function (s, a) { return 'The issuer of ' + a.code + ' is not an active account.'; },
    tecDIR_FULL: function () { return 'Your account holds too many ledger objects to add another order.'; },
    tecEXPIRED: function () { return 'The order expired before it reached the ledger.'; },
    tecKILLED: function () { return 'The order could not be filled and was cancelled.'; }
  };
  function explain(code, s, a) {
    var f = CODES[code];
    return f ? f(s, a) : ('The ledger did not accept the order (' + code + ').');
  }

  // `validated: false`, and txnNotFound straight after submitting, both mean "not in a ledger yet".
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    function again() {
      if (n <= 0) return { ok: false, code: 'timeout' };
      return new Promise(function (res) { setTimeout(res, 1500); })
        .then(function () { return waitValidated(hash, n - 1); });
    }
    return rpc('tx', { transaction: hash, binary: false }).then(function (r) {
      if (r && r.validated) {
        var meta = r.meta || r.metaData || {};
        return { ok: meta.TransactionResult === 'tesSUCCESS', code: meta.TransactionResult, meta: meta };
      }
      return again();
    }, again);
  }

  // Did any of the order stay on the book? A created Offer entry says it did; none means it filled.
  function rested(meta) {
    return ((meta && meta.AffectedNodes) || []).some(function (x) {
      return x.CreatedNode && x.CreatedNode.LedgerEntryType === 'Offer';
    });
  }

  var busy = false;

  function place(p) {
    if (busy) return;
    var a = asset(), who = addr(), b = cta(p);
    if (!a || !who || !b) return;
    var f = fields(p), s = side(p);
    var price = num(input(f[0]) && input(f[0]).value);
    var amount = num(input(f[1]) && input(f[1]).value);
    if (!(price > 0)) { say(p, 'Enter a limit price.', 'bad'); return; }
    if (!(amount > 0)) { say(p, 'Enter an amount.', 'bad'); return; }
    var built = lxx().offerFor(s, { currency: currencyOf(a.code), issuer: a.issuer }, amount, price);
    if (!built) { say(p, 'That order is worth less than one drop of XRP.', 'bad'); return; }

    busy = true;
    var label = b.textContent;
    function stop(text, tone) { busy = false; b.textContent = label; if (text != null) say(p, text, tone); }
    b.textContent = 'Checking balance…';
    say(p, '');

    load(true).then(function (ac) {
      if (ac.failed) return stop('Could not read your balance from the ledger. Try again in a moment.', 'bad');
      if (!ac.found) return stop('This account is not activated yet — it needs some XRP first.', 'bad');
      var inc = ac.inc || 0;
      if (s === 'sell') {
        if (!ac.issuer && amount > ac.bal + 1e-12) {
          return stop(ac.bal > 0
            ? ('Insufficient ' + a.code + ' balance — you have ' + fmt(ac.bal) + '.')
            : ('You do not hold any ' + a.code + ' to sell.'), 'bad');
        }
        if (ac.spend != null && ac.spend < inc) {
          return stop('Not enough XRP for the reserve a new order needs (' + fmt(inc) + ' XRP).', 'bad');
        }
      } else {
        var need = amount * price + inc + ((ac.line || ac.issuer) ? 0 : inc);
        if (ac.spend != null && need > ac.spend + 1e-9) {
          return stop('Not enough XRP for this order — it needs about ' + fmt(need, 4)
            + ' XRP including reserve, and ' + fmt(Math.max(0, ac.spend), 4) + ' is available.', 'bad');
        }
      }

      var tx = { TransactionType: 'OfferCreate', Account: who, TakerGets: built.TakerGets, TakerPays: built.TakerPays,
        Memos: [lxMemo('LumosCore: limit order')] };
      if (built.Flags) tx.Flags = built.Flags;

      b.textContent = 'Confirm in wallet…';
      return window.lxc.submit(tx).then(function (hash) {
        b.textContent = 'Confirming…';
        return waitValidated(hash);
      }).then(function (r) {
        if (!r.ok) {
          return stop(r.code === 'timeout'
            ? 'Submitted, but not confirmed yet — check Open orders in your Wallet before trying again.'
            : explain(r.code, s, a), 'bad');
        }
        var what = fmt(amount) + ' ' + a.code, at = fmt(price, 8) + ' XRP';
        var onBook = rested(r.meta);
        var ai = input(f[1]);
        if (ai) ai.value = '';
        recalc(p);
        b.textContent = onBook ? 'Order placed ✓' : 'Filled ✓';
        say(p, onBook
          ? ((s === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + what + ' at ' + at + '.')
          : ('Filled straight away — ' + what + ' at ' + at + ' or better.'), 'good');
        // The same bottom-centre confirmation the swap pane now draws, for the same reason: it is where
        // the eye goes once the wallet's own sheet closes. An order that RESTED and one that FILLED are
        // different outcomes, so they do not share a sentence — "placed" would be wrong about a fill,
        // and "filled" would be a claim about something that has not happened yet.
        try {
          if (typeof window.lxToast === 'function') {
            window.lxToast(onBook
              ? ((s === 'sell' ? 'Sell' : 'Buy') + ' order placed — ' + what)
              : ('Filled ' + what));
          }
        } catch (e) {}
        setTimeout(function () { busy = false; b.textContent = label; }, 1800);
        load(true);
        try { if (window.__lxxBookReload) window.__lxxBookReload(); } catch (e) {}
      });
    }).catch(function (err) {
      stop((err && err.message) || 'The order was not placed.', 'bad');
    });
  }

  // ---- wiring ------------------------------------------------------------------------------------
  function wire() {
    if (window.__lxxLimitWired) return;
    window.__lxxLimitWired = 1;
    css();

    // WINDOW capture, so this runs ahead of the design's own handlers. A disconnected click is left
    // alone: lx-gate and connect.js open the wallet picker for it, and without an account there is
    // nothing to sign with anyway.
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('[class*="dxa-pane-limit"]');
      if (!p) return;

      if (t.closest('.lxlim-max')) { e.preventDefault(); e.stopPropagation(); fillMax(p); return; }

      if (t.closest('[class*="dxa-side-btn"]')) {
        // After the design has flipped .active: start the new side clean, as Stellar does.
        setTimeout(function () {
          p.__lxxPrefilled = null;
          var ai = input(fields(p)[1]);
          if (ai) ai.value = '';
          say(p, '');
          prefill(p);
          paint();
        }, 0);
        return;
      }

      var b = t.closest('[class*="dxa-trade-cta"]');
      if (!b) return;
      if (b.getAttribute('data-lxgate') === '1' || !addr()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      place(p);
    }, true);

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'INPUT' || !t.closest) return;
      var p = t.closest('[class*="dxa-pane-limit"]');
      if (!p) return;
      var clean = numOnly(t.value);
      if (clean !== t.value) {
        var pos = (t.selectionStart || 0) - (t.value.length - clean.length);
        t.value = clean;
        try { t.setSelectionRange(Math.max(0, pos), Math.max(0, pos)); } catch (x) {}
      }
      if (t === input(fields(p)[2])) fromTotal(p); else recalc(p);
      if (!busy) say(p, '');
    }, true);

    try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { load(true); }); } catch (e) {}
    window.addEventListener('storage', function (e) { if (e && /^lumos\./.test(e.key || '')) load(true); });
  }

  // The book reloads after an order is placed and on its own schedule; the context follows it.
  window.addEventListener('lxx:book', function () { var p = pane(); if (p && asset()) recalc(p); });

  function boot() {
    if (!$('#dxaObAsks') && !$('#mdxaObAsks')) return;           // not a Trade-Asset page
    wire();
    var tries = 0;
    (function start() {
      var p = pane();
      if (!p || !asset()) { if (tries++ < 40) setTimeout(start, 250); return; }
      prefill(p);
      paint();
      load(false);
      // The price feed lands after load, so prefill again once it has.
      var n = 0;
      (function waitPrice() {
        if (window.__lxxAssetData) { prefill(p); paint(); return; }
        if (n++ < 40) setTimeout(waitPrice, 300);
      })();
      // lx-mobtrade inserts the phone's Total field on its own cadence. Paint when the pane's direct
      // children change — childList only, never subtree: an observer that reacts to the text it writes
      // is how Stellar's watchLimitModal froze the renderer.
      try { new MutationObserver(function () { paint(); }).observe(p, { childList: true }); } catch (e) {}
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

// Trade-Asset → Swap: the panel, wired to the XRP Ledger.
//
// RAZA 2026-09-15: "on Swap box, its not showing the details as it is showing on Stellar. Also the you pay
// and you receive asset logos are missing." The panel had been deliberately disabled ("Trading from this
// page is not enabled yet") while nothing on this build could sign. Every other trade path signs through
// window.lxc now, so this one does too.
//
// THE SAME SWAP AS THE WALLET AND THE DASHBOARD. A swap on this ledger is a cross-currency Payment to
// yourself, quoted by ripple_path_find, delivering at least the quote minus 0.5% or failing outright (no
// tfPartialPayment). The 0.2% / 0.1% platform fee is a second XRP payment after the swap lands, never
// before it. See browser/write.js for the reasoning; this is that logic on the design's Trade-Asset panel.
//
// THE REVIEW STEP IS STELLAR'S OWN. lx-feemodal (inherited) catches the first click on this button and
// shows "Review order" built from the summary rows below; its Confirm re-clicks the button
// programmatically. So a TRUSTED click is only validated here and allowed through to the review, and the
// UNTRUSTED click that comes back from Confirm is the one that submits. If the review layer is ever
// absent, a trusted click submits directly.
//
// Everything written into the panel carries `.lxp`, because the design hides `.dxa-trade-frow .mono` and
// `.dxa-tsum-row .mono` until a data layer claims them — which is why "Rate", "Min received" and the rest
// read as empty labels.
(function () {
  if (window.__lxxDxaSwap) return;
  window.__lxxDxaSwap = 1;

  var RPC = 'https://xrplcluster.com/';
  var COLLECTOR = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';
  var SLIP = 0.005;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function lxx() { return window.lxx; }
  function asset() { return window.__lxxAssetRef || null; }
  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; }
    catch (e) { return ''; }
  }
  // NOTHING WAITS FOREVER (RAZA 2026-09-17: RLUSD → XRP "it just stucks there" — the button sat on "Finding the best route…"
  // with a complete quote beside it). A public node can accept a request and never answer, and `fetch` has no timeout of its
  // own, so one unanswered call froze the swap with no error and no way back. Every read now has a deadline; `ripple_path_find`
  // is the slow one and gets a longer one.
  function rpc(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw new Error((e && e.name === 'AbortError') ? (method + ' timed out') : ((e && e.message) || 'ledger unavailable'));
    });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/,/g, '').trim();
    var m = /^\d*\.?\d*/.exec(s);
    var t = m ? m[0] : '';
    return (t === '' || t === '.') ? NaN : Number(t);
  }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 6 : d });
  }
  function floorTo(n, dp) { var k = Math.pow(10, dp); return Math.floor(n * k) / k; }
  function plainNum(n) { return n > 0 ? (lxx().iouValue(Number(Number(n).toPrecision(12))) || '') : ''; }
  function currencyOf(code) { try { return lxx().encodeCurrency(code); } catch (e) { return code; } }
  function feeRate() { return typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002; }
  // XRP/USD from the price service as well, for a token xrpl.to does not list (XYIELD): its page has no asset data, and the
  // "≈ $ USD" lines stayed at $0.00 (RAZA 2026-09-16).
  var XU = 0;
  fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.usd > 0) XU = j.usd; }, function () {});
  function usdPerXrp() {
    var d = window.__lxxAssetData;
    return (d && d.price && d.usd) ? d.usd / d.price : XU;
  }

  function pane() { return $('.dxa-pane-swap') || $('.mdxa-pane-swap'); }
  function fields(p) { return $$('[class*="dxa-trade-field"]', p); }
  function input(f) { return f ? $('input', f) : null; }
  function cta(p) { return $('[class*="dxa-trade-cta"]', p); }
  function side(p) { return $('[class*="dxa-side-btn"].sell.active', p) ? 'sell' : 'buy'; }

  function mark(node, text) {
    if (!node) return;
    try { node.removeAttribute('data-logo'); node.setAttribute('data-logoed', '1'); } catch (e) {}
    if (node.textContent !== text) node.textContent = text;
    node.classList.add('lxp');
  }
  // NOT the "≈ $X USD" span, which is also .mono and sits first in the row: writing the balance into it is how "Balance: —" came
  // back beside a connected wallet (RAZA 2026-09-16: "Why's my XRP balance not showin up in the swap box").
  function frowMono(f) { var row = f && $('[class*="dxa-trade-frow"]', f); return row && $('.mono:not(.lx-payusd)', row); }
  function sumRow(p, label, value) {
    $$('[class*="dxa-tsum-row"]', p).forEach(function (r) {
      if (r.classList.contains('lx-feerow')) return;              // the fee layer owns its row
      var k = r.children;
      if (k.length < 2) return;
      if ((k[0].textContent || '').trim().toLowerCase() !== label) return;
      mark(k[k.length - 1], value);
    });
  }
  function say(p, text, tone) {
    var b = cta(p);
    if (!b || !b.parentNode) return;
    var n = $('.lxx-limit-note', p);
    if (!n) {
      if (!text) return;
      n = document.createElement('div');
      n.className = 'lxx-limit-note';                            // limit.js's status line style
      n.setAttribute('role', 'status');
      b.parentNode.insertBefore(n, b.nextSibling);
    }
    n.textContent = text || '';
    n.setAttribute('data-tone', tone || '');
    n.style.display = text ? '' : 'none';
    // SUCCESS CLEARS ITSELF (RAZA 2026-09-16: "Once the swap is completed, just hide the message 'Swap complete' in 2 seconds.
    // It just stays there"). Only the done-and-good lines go; an error stays until the next action.
    clearTimeout(say.t);
    if (text && /^swap complete/i.test(text)) say.t = setTimeout(function () { say(p, ''); }, 2000);
  }

  // ---- the account ---------------------------------------------------------------------------------
  var acct = { key: null };
  function loadAcct(force) {
    var a = asset(), who = addr();
    if (!a || !who) { acct = { key: null }; return Promise.resolve(acct); }
    var key = who + '|' + a.issuer + '|' + a.code;
    if (!force && acct.key === key && acct.at && Date.now() - acct.at < 20000) return Promise.resolve(acct);
    var cur = currencyOf(a.code);
    return Promise.all([
      // A dropped read is retried (below) rather than shown as a balance; only an unfunded account reads as none.
      rpc('account_info', { account: who, ledger_index: 'validated' }).catch(function (e) {
        if (/actNotFound|not found/i.test(String(e && e.message))) return null;
        throw e;
      }),
      // RAZA 2026-09-16: "Why's my XRP balance not showin up in the swap box" — server_info is only needed for the reserve,
      // and one failed call used to fail the whole read and leave "Balance: —" for good.
      rpc('server_info', {}).catch(function () { return null; }),
      lxx().allLines(rpc, who, { peer: a.issuer }).catch(function () { return { lines: [] }; })
    ]).then(function (r) {
      var info = r[0] && r[0].account_data;
      var vl = ((r[1] || {}).info || {}).validated_ledger || {};
      var reserve = { base: Number(vl.reserve_base_xrp) || 1, inc: Number(vl.reserve_inc_xrp) || 0.2 };
      var s = info ? lxx().spendableXrp(info.Balance, info.OwnerCount, reserve) : null;
      var line = ((r[2] && r[2].lines) || []).filter(function (l) { return l.currency === cur && l.account === a.issuer; })[0];
      loadAcct.tries = 0;
      acct = {
        key: key, at: Date.now(), spend: s ? s.spendable : 0,
        line: !!line, bal: line ? Math.max(0, Number(line.balance)) : 0, frozen: !!(line && (line.freeze || line.freeze_peer))
      };
      return acct;
    }).catch(function () {
      acct = { key: key, at: 0 };
      if ((loadAcct.tries = (loadAcct.tries || 0) + 1) <= 5) {
        setTimeout(function () { loadAcct(true).then(function () { var pp = pane(); if (pp) paintStatic(pp); }); }, 2500);
      }
      return acct;
    });
  }

  // ---- quoting -------------------------------------------------------------------------------------
  var quote = null, seq = 0, inflight = 0;

  function sides(p) {
    var a = asset();
    var tok = { code: a.code, currency: currencyOf(a.code), issuer: a.issuer };
    var xrpA = { code: 'XRP', currency: 'XRP', issuer: null };
    return side(p) === 'sell' ? { pay: tok, get: xrpA } : { pay: xrpA, get: tok };
  }
  function amountObj(s, value) {
    if (s.currency === 'XRP') return lxx().toDrops(value);
    var v = lxx().iouValue(value);
    return v ? { currency: s.currency, issuer: s.issuer, value: v } : null;
  }
  function payBalance(p) {
    if (!addr() || acct.key == null) return null;
    return side(p) === 'sell' ? acct.bal : acct.spend;
  }

  // THE TRADING FEE ROW'S FIGURE (RAZA 2026-09-15: "why's the trading fees not showing up"). lx-feemodal writes
  // "0.2%" into a .mono span, and the inherited sheet hides .dxa-tsum-row .mono until a data layer claims it with
  // .lxp — so the label showed and its value never did.
  function claimFeeRow(p) {
    $$('.lx-feerow .mono:not(.lxp), .lx-feerow .lx-feerate:not(.lxp)', p).forEach(function (m) { m.classList.add('lxp'); });
  }

  function paintStatic(p) {
    claimFeeRow(p);
    var f = fields(p);
    var s = sides(p);
    var bal = payBalance(p);
    mark(frowMono(f[0]), addr() ? ('Balance: ' + (bal == null ? '—' : fmt(bal, 4) + ' ' + s.pay.code)) : 'Balance: —');
    sumRow(p, 'slippage tolerance', (SLIP * 100).toFixed(1) + '%');
    sumRow(p, 'network fee', '0.00001 XRP');
    // TYPEABLE, LIKE STELLAR (RAZA 2026-09-16: "I should also be able to type into You receive and You pay calculates auto").
    var recv = input(f[1]);
    if (recv) recv.removeAttribute('readonly');
  }

  function clearQuote(p) {
    quote = null;
    setDis(p, false);                 // an empty box is not an impossible order
    // A quote still in flight belongs to an amount that is gone. Without this, clearing the box (or
    // switching side) let a slow ripple_path_find land afterwards and write "You receive 17.84" under an
    // empty "You pay" (RAZA 2026-09-15).
    seq++;
    var f = fields(p);
    var recv = input(f[1]);
    if (recv) recv.value = '';
    mark(frowMono(f[1]), '≈ $0.00 USD');
    var d = window.__lxxAssetData, s = sides(p);
    // With no amount there is still a rate to state: the page's own live price.
    if (d && d.price > 0) {
      var r = s.pay.currency === 'XRP' ? (1 / d.price) : d.price;
      sumRow(p, 'rate', '1 ' + s.pay.code + ' = ' + fmt(r, 6) + ' ' + s.get.code);
    } else sumRow(p, 'rate', '—');
    sumRow(p, 'price impact', '—');
    impactTone(p, '');
    payUsd(p, 0);
    sumRow(p, 'min received', '—');
  }

  function usdOf(amount, s) {
    var u = usdPerXrp();
    if (!(u > 0) || !(amount > 0)) return 0;
    if (s.currency === 'XRP') return amount * u;
    var d = window.__lxxAssetData;
    var px = (d && d.price > 0) ? d.price
      : ((quote && quote.amt > 0 && quote.out > 0) ? (quote.side === 'sell' ? quote.out / quote.amt : quote.amt / quote.out) : 0);
    return px > 0 ? amount * px * u : 0;
  }
  function usdTxt(v) {
    if (!(v > 0)) return '≈ $0.00 USD';
    if (v >= 1e6) return '≈ $' + (v / 1e6).toFixed(2) + 'M USD';
    return '≈ $' + (v >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4)) + ' USD';
  }

  function impactTone(p, tone) {
    $$('[class*="dxa-tsum-row"]', p).forEach(function (r) {
      var k = r.children;
      if (k.length < 2 || (k[0].textContent || '').trim().toLowerCase() !== 'price impact') return;
      k[k.length - 1].style.color = tone;
    });
  }
  // "≈ $189.34 USD" beside the balance, as lumoscore.com's You pay line reads (RAZA 2026-09-15: "its not showing $value in You
  // Pay like it does on Stellar"). The .lx-payusd rule is inherited.
  function payUsd(p, v) {
    var f = fields(p), row = f[0] && $('[class*="dxa-trade-frow"]', f[0]);
    if (!row) return;
    var sp = $('.lx-payusd', row);
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'mono lxp lx-payusd';
      sp.setAttribute('data-logoed', '1');
      var balEl = $('.mono:not(.lx-payusd)', row);
      if (balEl) row.insertBefore(sp, balEl); else row.appendChild(sp);
    }
    var txt = v > 0 ? usdTxt(v) : '';
    if (sp.textContent !== txt) sp.textContent = txt;
  }

  // Stellar's wording, so the two chains answer this the same way.
  var SAT_MSG = 'Not enough liquidity to fill this size — try a smaller amount';

  // Saturated when doubling the money buys less than half as much again — or when nothing is
  // obtainable at all.
  //
  // STELLAR'S 1% BAND DOES NOT TRANSFER, and measuring is what showed it. On the reported ATOM (total
  // supply 1), 3600 XRP simulates to 0.4196 and 1800 XRP to 0.3736 — halving the spend still returns
  // 89% of the output, so "within 1%" calls that fillable. It is not. Horizon flatlines or even
  // reverses once it stops finding a path, which is what makes 1% the right test there; a
  // constant-product pool never flattens that far, because there is always fractionally more to buy.
  //
  // THE RATIO IS THE SIGNAL, and it has an exact meaning. For a pool, half-input ÷ full-input runs
  // from 0.5 (a small trade, nearly linear) toward 1.0 (saturated), and it passes 2/3 precisely when
  // the input equals the pool's whole opposite reserve. So `full <= half * 1.5` reads: you are
  // spending more than the entire reserve, and doubling your money buys under 50% more. The ATOM
  // case sits at 0.89 — about seven times the reserve.
  //
  // Only ever consulted once the impact is already past 100%, so an ordinary trade never reaches it.
  function satCheck(s, amt) {
    return Promise.all([simulate(s, amt), simulate(s, amt / 2)]).then(function (r) {
      var full = r[0] && r[0].out, half = r[1] && r[1].out;
      if (!(full > 0)) return true;
      return !!(half > 0 && full <= half * 1.5);
    }).catch(function () { return false; });   // unknown must not block a trade
  }

  // THE BUTTON LOOKS LIKE WHAT IT IS (RAZA 2026-10-08: "Please disable the orange button if the order
  // is not possible"). Stellar sets data-lxdis on its CTA and styles it; this build has no such rule,
  // so the look is set inline rather than by adding a stylesheet — a CSS edit here would be the ninth
  // way for a rule to land in the file and do nothing on the page.
  //
  // NOT pointer-events:none. The click still runs, validate() still returns the same sentence, and
  // the reader gets feedback instead of a button that silently ignores them.
  //
  // THE ATTRIBUTE IS OURS; THE INLINE STYLE IS NOT, and that is why this is a stylesheet rule rather
  // than b.style.opacity. The page already ships
  //   .dxa-trade-cta[data-lxdis="1"]{opacity:.55;cursor:not-allowed;filter:grayscale(.25)}
  // and it was having no effect, because the DESIGN'S OWN trade widget rewrites this button after we
  // touch it — measured: data-lxdis stayed "1" while style.opacity came back as an inline "1", which
  // beats any ordinary rule and beat the inline value this function used to set too. A second writer
  // on one node, the shape this project keeps meeting.
  //
  // An !important declaration in a stylesheet outranks a plain inline one, so the rule wins without
  // this having to race the other writer or watch the node. Injected at runtime rather than at build
  // time so it travels with the script that depends on it, and guarded by id so it lands once.
  function disStyle() {
    if (document.getElementById('lx-dxadis')) return;
    var st = document.createElement('style');
    st.id = 'lx-dxadis';
    // NOT opacity, AND NOT cursor. The design's widget writes them INLINE WITH !important —
    // measured on the live button: `opacity: 1 !important; cursor: pointer !important`. An inline
    // important declaration is the top of the cascade; no stylesheet can outrank it, so a rule
    // naming either property is a rule that will never apply, however it is written.
    //
    // It claims nothing else, which is why `filter` landed while those two did not. So the disabled
    // state is drawn with the properties left free: the orange fill dims, which is the cue a reader
    // actually reads, and the explanation already sits underneath the button.
    //
    // FILTER DOES BOTH JOBS, AND NO PALETTE TOKENS. Stellar's own disabled CTA is
    //   opacity:.55; cursor:not-allowed; filter:grayscale(.25)
    // — a DIMMED ORANGE, not a grey one. `filter: opacity()` is a filter FUNCTION, not the opacity
    // property, so it rides in on the one channel the widget leaves alone and reproduces the .55
    // exactly (RAZA 2026-10-08: "the color of swap button when its inactive is different on XRPL" —
    // this rule used to be grayscale(1), a flat neutral grey nothing like lumoscore.com's).
    // No palette token either: an earlier version painted the button var(--surface-2), which measures
    // #fafbfc on this build — very nearly white, so on the dark card it would have been glaring.
    // Naming a token means guessing which theme the reader is in; a filter derives from whatever the
    // button already is, so it reads the same way in both. `cursor` stays unwinnable.
    //
    // MATCH THE BUTTON THE SAME WAY cta() DOES. Mobile's class is mdxa-trade-cta, a different class
    // name that merely contains the desktop one as a substring, so `.dxa-trade-cta` misses it entirely
    // — the first version of this rule greyed the desktop button and did nothing on the phone.
    st.textContent = '[data-lxunfill="1"] [class*="dxa-trade-cta"]{filter:grayscale(.25) opacity(.55)!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // THE MARK GOES ON THE PANE, NOT THE BUTTON, and that is the whole trick.
  //
  // Two earlier attempts lost to the same second writer. Setting b.style.opacity lost because the
  // design's widget reassigns inline opacity afterwards. Setting data-lxdis="1" and styling it with
  // !important lost too — measured: the attribute itself came back as "0", so the widget rewrites
  // the button's attributes as well, and anything written ON that node is a race we do not control.
  //
  // The pane is not something it touches. A descendant selector reaches the button from there, so
  // the button keeps whatever the widget wants to put on it and still renders disabled.
  function setDis(p, on) {
    if (!p || !p.setAttribute) return;
    disStyle();
    if (on) p.setAttribute('data-lxunfill', '1');
    else p.removeAttribute('data-lxunfill');
  }

  function applyQuote(p, amt, out, paths, est, impactPct) {
    var f = fields(p), s = sides(p), d = window.__lxxAssetData;
    quote = { amt: amt, out: out, paths: paths || null, side: side(p), est: !!est, unfillable: 0 };
    // A FRESH QUOTE CLEARS A STALE "not enough liquidity", and only that one. Typing 5 ATOM and then
    // 0.01 left the warning standing over a perfectly ordinary 30% quote — the flag resets on every
    // quote but the sentence on screen did not, so the pane contradicted itself. Matched by text so
    // a balance warning, which is about the account rather than the size, is left alone.
    var staleNote = $('.lxx-limit-note', p);
    if (staleNote && staleNote.textContent === SAT_MSG) say(p, '');
    setDis(p, false);                 // a new size is innocent until the check says otherwise
    var recv = input(f[1]);
    // NOT OVER THE BOX BEING TYPED IN: the receive amount is the user's own figure while it has focus.
    if (recv && document.activeElement !== recv) recv.value = plainNum(floorTo(out, 6));
    mark(frowMono(f[1]), usdTxt(usdOf(out, s.get)));
    sumRow(p, 'rate', '1 ' + s.pay.code + ' = ' + fmt(out / amt, 6) + ' ' + s.get.code);
    // Against the page's own spot price: what this size costs beyond the best available rate.
    // STELLAR'S SIGN (RAZA 2026-09-15: "If im selling, the price impact should have been in negative"): the impact is the
    // move in THIS token's price — a buy pushes it up (+, green), a sell pushes it down (−, red). Buying at r times the
    // best rate means each token costs 1/r − 1 more, which has no ceiling; a sell is bounded at −100%.
    var buy = s.pay.currency === 'XRP', mag = null;
    if (impactPct != null && isFinite(impactPct)) {
      var rr = Math.max(0, 1 - Math.max(0, impactPct) / 100);
      mag = buy ? (rr > 0 ? (1 / rr - 1) * 100 : Infinity) : (1 - rr) * 100;
    } else if (!est && d && d.price > 0) {
      // An estimate at the page price has no impact to report — saying 0.00% would claim a measurement.
      var eff = buy ? (amt / out) : (out / amt);   // XRP per token either way
      mag = Math.max(0, buy ? (eff - d.price) / d.price : (d.price - eff) / d.price) * 100;
    }
    var impact = '—', tone = '';
    if (mag != null) {
      if (!isFinite(mag)) impact = buy ? '>+999,999%' : '-100%';
      else if (mag < 0.01) impact = '<0.01%';
      else impact = (buy ? '+' : '-') + (mag < 100 ? mag.toFixed(2) : (mag < 10000 ? mag.toFixed(1) : Math.round(mag).toLocaleString('en-US'))) + '%';
      // THE SIGN ENCODES DIRECTION, AND THE COLOUR FOLLOWS THE SIGN. A buy reads "+x%" in green, a
      // sell reads "-x%" in red, whatever the magnitude. `|| buy` is what does that, and it is
      // DELIBERATE — do not "fix" it into a magnitude threshold.
      //
      // I did exactly that on 2026-10-07 and RAZA caught it the same day: "You've messed it up. When
      // buying ... the asset will always show positive impact (+ sign and green color). if sold ...
      // the impact will always be in negative (- and red color)." The reasoning that led there was
      // checking Stellar's BRIDGE card ("price impact above 1%: amber") and assuming it governed the
      // swap pane. It does not. The counterpart is Stellar's own swap, and lumoscore.com renders a
      // 1000 XLM buy of LUMOS at "+18.72%" in GREEN — so magnitude-colouring here was a divergence
      // from the one build this fork exists to match, not a correction of one.
      tone = (mag < 0.01 || buy) ? 'var(--green,#22c55e)' : 'var(--red,#ff5b5b)';
    }
    sumRow(p, 'price impact', impact);
    impactTone(p, tone);

    // PAST THE END OF THE BOOK, A PERCENTAGE STOPS MEANING ANYTHING.
    //
    // RAZA 2026-10-08: "ATOM has a total supply of 1, so buying 5 should be impossible. Check what
    // we're showing on Stellar in such situation." We were showing "+1098.9%" and a live Place Buy
    // Order, with "min received 0.417725" under a request for 5 — a figure that only counts how far
    // beyond the end of the book the amount was typed.
    //
    // Stellar already answers this, in _dexassetdata.js's dxSatCheck, and this is that behaviour on
    // this ledger: only test once the impact is already steep (a doubling of price is harsh but
    // real), then re-quote at HALF and see whether the output moves. If halving what you pay barely
    // changes what you get, the market cannot fill this size — on an AMM the output asymptotes to
    // the whole reserve, so beyond a point more money buys nothing more.
    //
    // BOTH SIDES OF THE COMPARISON COME FROM simulateSwap, deliberately. The displayed quote may
    // have come from ripple_path_find instead, and mixing the two would compare models rather than
    // sizes. Saturation is a property of the CURVE, so the two points only have to agree with each
    // other. It is also local arithmetic over the pool and book — no second network round trip,
    // which is what Stellar spends here.
    // THE THRESHOLD CANNOT BE ONE NUMBER, because the two directions are not measured on one scale.
    // A buy's impact is unbounded (paying 11x spot reads +1091%), while a sell's is bounded at −100%
    // by construction — you cannot receive less than nothing. So `mag > 100` can NEVER be true on a
    // sell, and the whole check was unreachable in that direction: selling 5 ATOM, five times the
    // entire supply, quoted at −92.75% with no warning at all (RAZA 2026-10-08, asking what the sell
    // side does).
    //
    // The matched condition is the same statement in both directions — "worse than 2:1 against the
    // page's spot price". For a buy that is paying over twice spot, mag > 100. For a sell it is
    // receiving under half of spot, mag > 50. Both mean rr < 0.5.
    //
    // It is only a cost gate, not the verdict: satCheck below is what decides, and it reads the same
    // either way (measured on this ATOM: sell 5 → ratio 0.932 blocked, sell 0.2 → 0.602 allowed).
    if (mag != null && mag > (buy ? 100 : 50)) {
      var myq = seq;
      satCheck(s, amt).then(function (sat) {
        if (!sat || myq !== seq || !quote || quote.amt !== amt) return;
        quote.unfillable = 1;
        // EVERY FIGURE DERIVED FROM THE REJECTED QUOTE GOES WITH IT (RAZA 2026-10-08: "When a swap is
        // not possible on Stellar, You pay is left blank on Stellar but on XRPL it shows the value").
        // lumoscore.com's own unfillable state leaves You pay empty and prints "—" for Rate and Min
        // received; this pane was still showing a pay amount, a rate and a min-received computed from
        // the very quote it had just declared untrustworthy, which reads as a priced, placeable order
        // sitting under a red refusal. Only price impact had been blanked.
        //
        // The pay box is written by the input handler when the typing happens in "You receive", so
        // clearing it here is the only place it comes out — and never while it has focus, since then
        // the figure is the user's own.
        var payI = input(f[0]);
        if (payI && document.activeElement !== payI) payI.value = '';
        payUsd(p, 0);
        sumRow(p, 'rate', '—');
        sumRow(p, 'min received', '—');
        sumRow(p, 'price impact', '—');     // a number here would be answering the wrong question
        impactTone(p, '');
        say(p, SAT_MSG, 'bad');
        setDis(p, true);
      });
    }
    payUsd(p, usdOf(amt, s.pay));
    sumRow(p, 'min received', fmt(out * (1 - SLIP), 6) + ' ' + s.get.code);
  }

  // ---- simulated quote -------------------------------------------------------------------------------
  // PRICE IMPACT WHERE THE LEDGER CANNOT ROUTE (RAZA 2026-09-15: "Price impact is not working"). ripple_path_find answers only
  // for an amount the account holds and a token it trusts, so an over-balance amount, a new token or a signed-out visitor
  // got "—". The pair's AMM pool (constant product, less its trading fee) and its order book are read directly and the
  // amount is filled in small steps from whichever pays more; impact is the fill against the best rate at the start.
  // ONE IMPLEMENTATION, IN xrpl-core.js. This arithmetic -- the pair's AMM pool and order book, filled
  // in small steps from whichever pays more -- is now window.lxx.simulateSwap, because the bridge needs
  // the same answer for the same reason and this file's own note already says a second copy would just
  // relearn everything. The behaviour here is unchanged; only its address is.
  function simulate(s, amt) {
    var buying = s.pay.currency === 'XRP';
    var t = buying ? s.get : s.pay;
    if (!window.lxx || !window.lxx.simulateSwap) return Promise.resolve(null);
    return window.lxx.simulateSwap(rpc, {
      buying: buying, amount: amt, token: { currency: t.currency, issuer: t.issuer },
    });
  }
  function simQuote(p, s, amt, my) {
    simulate(s, amt).then(function (res) {
      if (my !== seq || !res) return;
      if (quote && !quote.est && quote.amt === amt) return;   // a routed quote already landed
      applyQuote(p, amt, res.out, null, true, res.impact);
    }, function () {});
  }

  function requote() {
    var p = pane();
    if (!p || !asset()) return;
    paintStatic(p);
    var amt = num(input(fields(p)[0]) && input(fields(p)[0]).value);
    if (!(amt > 0)) { clearQuote(p); say(p, ''); return; }
    var s = sides(p), me = addr(), my = ++seq;
    var d = window.__lxxAssetData;
    // MORE THAN THE ACCOUNT HOLDS. ripple_path_find answers with what the balance CAN buy, not what was
    // typed, so the rate collapsed and "price impact" read 695%. Estimate at the page price instead and
    // say why the swap cannot go ahead.
    var bal = payBalance(p);
    if (me && acct.at && bal != null && amt > bal + 1e-12) {
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      say(p, 'You only have ' + fmt(bal, 6) + ' ' + s.pay.code + (s.pay.currency === 'XRP' ? ' available after the reserve.' : '.'), 'bad');
      return;
    }
    if (!me) {
      // Signed out there is no account to route from, so the estimate is the live price — labelled as a
      // quote only once a wallet can ask the ledger for a real one.
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      return;
    }
    // NO TRUST LINE, NO ROUTE (RAZA 2026-09-15: "When trying to swap 1 XRP to ATOM. its not calculating. Its saying no route
    // which is nonsense"). The ledger will not deliver a token to an account that does not trust it, so path_find answers
    // with nothing for such an account; the actual reason is said, with the page-price estimate kept in view.
    // RAZA 2026-09-15: "No need to show this trustline error. we're not showing on Stellar" — the swap adds the trustline
    // itself (doSwap). Until then the quote is simulated on the pool and the book.
    if (me && acct.at && s.get.currency !== 'XRP' && !acct.line) {
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
      say(p, '');
      return;
    }
    // AN ESTIMATE STRAIGHT AWAY (RAZA 2026-09-15: "Its taking forever to calculate you receive"). The ledger's route
    // lookup takes seconds on a public node; until it answers, the page's own price fills "You receive", and the
    // routed quote replaces it the moment it lands. Swapping waits for the route while one is still being found.
    if (d && d.price > 0 && !(quote && !quote.est && quote.amt === amt && quote.side === side(p))) {
      applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
    }
    inflight = my;
    rpc('ripple_path_find', {
      source_account: me, destination_account: me,
      destination_amount: s.get.currency === 'XRP' ? '-1' : { currency: s.get.currency, issuer: s.get.issuer, value: '-1' },
      send_max: amountObj(s.pay, amt), ledger_index: 'validated'
    }).then(function (r) {
      if (my !== seq) return;
      inflight = 0;
      var alt = (r.alternatives || [])[0];
      if (!alt) { simQuote(p, s, amt, my); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      var g = alt.destination_amount;
      var out = typeof g === 'string' ? Number(g) / 1e6 : Number(g.value);
      if (!(out > 0)) { clearQuote(p); say(p, tooSmallMsg(p, s, amt) || 'No route for that amount right now.', 'bad'); return; }
      applyQuote(p, amt, out, alt.paths_computed && alt.paths_computed.length ? alt.paths_computed : null);
      say(p, '');
    }).catch(function () {
      if (my !== seq) return;
      inflight = 0;
      if (d && d.price > 0) applyQuote(p, amt, s.pay.currency === 'XRP' ? amt / d.price : amt * d.price, null, true);
      simQuote(p, s, amt, my);
    });
  }

  // ---- submitting ----------------------------------------------------------------------------------
  var busy = false;
  function waitValidated(hash, tries) {
    var n = tries == null ? 30 : tries;
    function again() {
      if (n <= 0) return { ok: false, code: 'timeout' };
      return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return waitValidated(hash, n - 1); });
    }
    return rpc('tx', { transaction: hash, binary: false }).then(function (r) {
      if (r && r.validated) { var m = r.meta || {}; return { ok: m.TransactionResult === 'tesSUCCESS', code: m.TransactionResult }; }
      return again();
    }, again);
  }
  var CODES = {
    tecPATH_PARTIAL: 'The price moved past your 0.5% slippage before this went through. Nothing was swapped.',
    tecPATH_DRY: 'No route for that swap right now. Nothing was swapped.',
    tecUNFUNDED_PAYMENT: 'You do not hold enough for this swap.',
    tecNO_LINE: 'You need a trustline for this token before you can receive it.',
    tecNO_AUTH: 'The issuer has not authorised your account to hold this token.',
    tecFROZEN: 'This token is frozen by its issuer.'
  };

  function validate(p) {
    var a = asset();
    if (!a) return 'This page has no token.';
    var amt = num(input(fields(p)[0]) && input(fields(p)[0]).value);
    if (!(amt > 0)) return 'Enter an amount.';
    if (!quote || Math.abs(quote.amt - amt) > 1e-12 || quote.side !== side(p)) return 'Getting a quote — try again in a moment.';
    // The button stays pressable, but the order is refused with the same sentence already on screen.
    // This pane has no disabled state of its own, so refusing here is its equivalent of the
    // data-lxdis Stellar sets on its CTA.
    if (quote.unfillable) return SAT_MSG;
    if (acct.key == null) return 'Reading your balance — try again in a moment.';
    var s = sides(p);
    if (s.pay.currency === 'XRP') {
      var fee = amt * feeRate();
      if (amt + fee + 0.0001 > acct.spend + 1e-9) return 'Not enough XRP — ' + fmt(acct.spend, 6) + ' is available after the reserve, and the 0.2% fee is paid on top.';
    } else if (amt > acct.bal + 1e-12) {
      return 'You only hold ' + fmt(acct.bal, 6) + ' ' + a.code + '.';
    }
    return '';
  }

  // "NO ROUTE" IS USUALLY TRUE AND ALMOST ALWAYS THE WRONG EXPLANATION (RAZA 2026-09-17: selling 0.000761 RIPPLEDICK,
  // "when there clearly is enough liq"). The pool was fine — that amount is worth 0.00000086 XRP, and the ledger cannot
  // pay less than one drop (0.000001), so no path can exist. The reader is told the real reason: the amount is too small,
  // and roughly what it would take. Returns '' when smallness is not the problem, so the generic message still stands.
  function tooSmallMsg(p, s, amt) {
    var d = window.__lxxAssetData;
    if (!(d && d.price > 0) || !(amt > 0)) return '';
    // Price is XRP per token, so a sell is amt × price and a buy is amt ÷ price.
    var out = s.pay.currency === 'XRP' ? (amt / d.price) : (amt * d.price);
    if (s.get.currency !== 'XRP' || out >= 0.000001) return '';
    var need = 0.000001 / d.price;                       // how much of this token makes one drop
    return 'That is too small to swap: ' + fmt(amt, 8) + ' ' + s.pay.code + ' is worth about '
      + out.toFixed(9) + ' XRP, and the ledger cannot pay less than 0.000001 XRP. You would need at least '
      + fmt(need, 6) + ' ' + s.pay.code + '.';
  }

  function feeInXrp(p, amt, out) {
    var s = sides(p);
    return s.pay.currency === 'XRP' ? amt * feeRate() : out * feeRate();
  }

  // THE FEE TRANSACTION SAYS WHAT IT IS (RAZA 2026-09-17: "make sure to mention in memo that the first trx is for fees").
  // Memo fields are hex bytes on this ledger, so the text is encoded here; Xaman and GemWallet both render it on the review
  // screen, which is the difference between "a payment to an address you don't recognise" and a named platform fee.
  function hexAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 127) continue;                             // plain ASCII only, so every wallet renders it the same
      out += ('0' + c.toString(16)).slice(-2).toUpperCase();
    }
    return out;
  }
  function feeMemo(payCode, getCode, n, of) {
    var pct = +(feeRate() * 100).toFixed(2);
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore platform fee ' + pct + '% - transaction ' + n + ' of ' + of + '. The '
          + payCode + ' to ' + getCode + ' swap is the next transaction.')
      }
    };
  }
  function lineMemo(code) {
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore: trustline for ' + code + ', required before this account can receive it '
          + '- transaction 1 of 3. The platform fee and the swap follow.')
      }
    };
  }

  // THE SWAP, AS ON STELLAR (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be automatically created
  // upon the swap", and "Finding the best route — try again in a moment" after clicking). A token the account does not
  // trust gets its TrustSet first (limit 1,000,000,000, the wallet's own add-line default), confirmed on the ledger; then
  // the route is asked for fresh and the payment is built from it. Nothing asks the user to click again.
  function doSwap(p) {
    if (busy) return;
    var msg = validate(p);
    if (msg) { say(p, msg, 'bad'); return; }
    var s = sides(p), me = addr(), amt = quote.amt;
    var b = cta(p), label = b ? b.textContent : '';
    busy = true;
    say(p, '');
    function fail(text) { busy = false; if (b) b.textContent = label; say(p, text, 'bad'); }
    // How many signatures this swap actually takes, so every label and memo counts the same way: a token this account
    // cannot yet receive needs its trustline first, and then it is three, not two.
    var needLine = s.get.currency !== 'XRP' && !acct.line;
    p.setAttribute('data-lxsteps', needLine ? '3' : '2');

    var step = Promise.resolve();
    if (needLine) {
      step = rpc('server_info', {}).then(function (si) {
        var inc = Number((((si || {}).info || {}).validated_ledger || {}).reserve_inc_xrp) || 0.2;
        if (s.pay.currency === 'XRP' && amt * (1 + feeRate()) + inc + 0.0001 > acct.spend + 1e-9) {
          throw new Error('Not enough XRP — holding ' + s.get.code + ' reserves ' + inc + ' XRP on top of this swap.');
        }
        // THE TRUST LINE EXPLAINS ITSELF TOO (RAZA 2026-09-17, on the fee memo). This is the one prompt of the three with
        // nothing on it but "TrustSet, limit 1000000000" — the least recognisable transaction in the whole product.
        if (b) b.textContent = 'Approve the ' + s.get.code + ' trustline (1 of 3)…';
        return window.lxc.submit({
          TransactionType: 'TrustSet', Account: me,
          LimitAmount: { currency: s.get.currency, issuer: s.get.issuer, value: '1000000000' },
          Memos: [lineMemo(s.get.code)]
        });
      }).then(function (hash) {
        if (b) b.textContent = 'Confirming…';
        return waitValidated(hash);
      }).then(function (res) {
        if (!res.ok) {
          throw new Error(res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
            : ('The ledger did not accept the swap (' + res.code + ').'));
        }
        acct.line = true;
      });
    }
    // The quote the pane is already showing, kept before the refresh can overwrite it.
    var shown = (quote && quote.amt === amt && quote.out > 0)
      ? { out: quote.out, paths: quote.paths || null } : null;

    step.then(function () {
      if (b) b.textContent = 'Finding the best route…';
      // This is a REFRESH of a quote that is already on screen, not the quote itself — so a slow or dead answer must not
      // take the swap down with it. A failure here falls through to the figures the user is looking at.
      // MEASURED 2026-09-17: this same call takes 0.4s buying RLUSD and 28.4s selling it. With the displayed quote as a
      // fallback there is no reason to wait that long — six seconds, then go with what the user is already looking at.
      return rpc('ripple_path_find', {
        source_account: me, destination_account: me,
        destination_amount: s.get.currency === 'XRP' ? '-1' : { currency: s.get.currency, issuer: s.get.issuer, value: '-1' },
        send_max: amountObj(s.pay, amt), ledger_index: 'validated'
      }, shown ? 6000 : 20000).catch(function () { return null; });
    }).then(function (r) {
      var alt = r && (r.alternatives || [])[0];
      var g = alt && alt.destination_amount;
      var out = g == null ? 0 : (typeof g === 'string' ? Number(g) / 1e6 : Number(g.value));
      var paths = (alt && alt.paths_computed && alt.paths_computed.length) ? alt.paths_computed : null;
      if (!(out > 0) && shown) { out = shown.out; paths = shown.paths; }
      if (!(out > 0)) throw new Error('No route for that swap right now. Nothing was swapped.');
      busy = false;
      if (b) b.textContent = label;
      applyQuote(p, amt, out, paths);
      sendSwap(p, quote);
    }).catch(function (e) { fail((e && e.message) || 'The swap could not be completed.'); });
  }

  function sendSwap(p, q) {
    if (busy) return;
    var s = sides(p), me = addr();
    // PARTIAL PAYMENT WITH A FLOOR (RAZA 2026-09-16, the ATOM buy "[Failed again]" — tecPATH_PARTIAL twice, while rippled's own
    // simulate of the identical transaction answered tesSUCCESS). An exact-delivery Payment must land its Amount to the last
    // unit through a pool of 0.38 ATOM; tfPartialPayment delivers what SendMax buys, and DeliverMin refuses anything below the
    // quote less the 0.5% slippage — the same protection, without the exact-amount edge. It pays yourself, so "partial" can
    // only ever mean fewer of your own tokens than quoted, and never fewer than the minimum shown.
    // SELLING THE LOT LEAVES NOTHING BEHIND (RAZA 2026-09-16: "I sold max amount of this asset but some is still left behind").
    // A partial payment stops as soon as it has delivered `Amount`, so a rate that moved in the seller's favour left a few
    // tokens unspent. On a MAX sell the ceiling is put out of reach (2% above the quote) and SendMax is the exact balance, so
    // the whole holding is what limits the payment — DeliverMin still refuses anything below the quote less slippage.
    var all = p.getAttribute('data-lxmax') === '1' && s.pay.currency !== 'XRP' && acct.bal > 0;
    var sendMax = all ? Math.max(q.amt, acct.bal) : q.amt;
    var tx = {
      TransactionType: 'Payment', Account: me, Destination: me,
      Amount: amountObj(s.get, all ? q.out * 1.02 : q.out),
      DeliverMin: amountObj(s.get, lxx().minAfterSlippage(q.out, SLIP)),
      SendMax: amountObj(s.pay, sendMax),
      Flags: 131072
    };
    if (!tx.Amount || !tx.DeliverMin || !tx.SendMax) { say(p, 'That amount is too small for the ledger.', 'bad'); return; }
    if (q.paths) tx.Paths = q.paths;
    var feeXrp = feeInXrp(p, q.amt, q.out);
    var b = cta(p), label = b ? b.textContent : '';
    busy = true;
    function stop(text, tone) { busy = false; if (b) b.textContent = label; if (text != null) say(p, text, tone); }
    if (b) b.textContent = 'Confirm in wallet…';
    say(p, '');
    // A DRY RUN BEFORE THE WALLET IS ASKED (RAZA 2026-09-15: "The trx failed when im trying to buy ATOM" — tecPATH_PARTIAL).
    // On a thin market the price can move past the 0.5% slippage in the seconds between quote and signature; the ledger's
    // simulate call says so without a fee or a signature, and the quote is refreshed instead.
    rpc('simulate', { tx_json: tx }).then(function (r) { return r && r.engine_result; }, function () { return null; }).then(function (er) {
      if (er === 'tecPATH_PARTIAL' || er === 'tecPATH_DRY') {
        var err = new Error(er === 'tecPATH_DRY' ? CODES.tecPATH_DRY
          : 'The price moved past your 0.5% slippage while this was being prepared. Nothing was signed — check the new quote and try again.');
        err.requote = true;
        throw err;
      }
      // THE FEE IS SIGNED FIRST NOW (RAZA 2026-09-17: "lets do the fees signature instead of swap. the second signature will
      // be for swap. But make sure to mention in memo that the first trx is for fees"). It carries a memo saying what it is,
      // so the wallet's review screen names it rather than showing a bare payment.
      //
      // THE RISK THIS TAKES ON, stated plainly: the old order paid the fee only after the swap had landed, so a rejected or
      // failed swap cost the user nothing. First means a fee can be paid for a swap that then fails. The dry run above is
      // what keeps that rare — it has already told us the ledger accepts this exact swap — and the message below says so
      // plainly if it happens anyway.
      if (!(feeXrp > 0)) return null;
      // Counted against the whole sequence, including the trustline when there was one — "1 of 2" on what is really the
      // second of three prompts is exactly the kind of small lie that makes someone abandon a signature.
      var of = p.getAttribute('data-lxsteps') === '3' ? 3 : 2;
      if (b) b.textContent = 'Approve the platform fee (' + (of - 1) + ' of ' + of + ')…';
      return window.lxc.submit({
        TransactionType: 'Payment', Account: me, Destination: COLLECTOR,
        Amount: lxx().toDrops(feeXrp),
        Memos: [feeMemo(s.pay.code, s.get.code, of - 1, of)]
      }).then(function (h) { return h; }, function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m) ? 'The platform fee was not approved, so nothing was swapped.' : m);
      });
    }).then(function () {
      var ofN = p.getAttribute('data-lxsteps') === '3' ? 3 : 2;
      if (b) b.textContent = 'Approve the swap (' + ofN + ' of ' + ofN + ')…';
      return window.lxc.submit(tx);
    }).then(function (hash) {
      if (b) b.textContent = 'Confirming…';
      return waitValidated(hash);
    }).then(function (res) {
      if (!res.ok) {
        if (res.code === 'tecPATH_PARTIAL') setTimeout(requote, 50);
        var why = res.code === 'timeout' ? 'Submitted, but not confirmed yet. Check your wallet activity before trying again.'
          : (CODES[res.code] || ('The ledger did not accept the swap (' + res.code + ').'));
        // Said out loud, because the fee has already left the account by this point.
        stop(feeXrp > 0 ? (why + ' The platform fee was already paid.') : why, 'bad');
        return;
      }
      stop('Swap complete ✓', 'good');
      // THE CONFIRMATION LANDS WHERE STELLAR'S DOES (RAZA 2026-10-06: "When buying / selling asset on
      // Trade-asset page, its not showing the message at the bottom like it does on Stellar").
      //
      // lumoscore.com's dxToast answers a filled swap with "✓ Sold 1.1541 XLM" bottom-centre, and its
      // wording is (side === "buy" ? "Bought " : "Sold ") + the amount RECEIVED + the asset received.
      // On this build `quote.out` is that amount and sides(p).get is that asset, so the same sentence
      // comes out of the same two facts.
      //
      // The inline line under the button stays as well. On this page it sits beside the CTA rather than
      // below the fold, so unlike the pool card there is nothing to move — this adds the half that was
      // missing, at the place the eye goes after a wallet sheet closes.
      try {
        if (typeof window.lxToast === 'function' && quote && quote.out > 0) {
          window.lxToast((side(p) === 'buy' ? 'Bought ' : 'Sold ') + fmt(quote.out, 6) + ' ' + s.get.code);
        }
      } catch (e) {}
    }).then(function () {
      var i = input(fields(p)[0]);
      if (i) i.value = '';
      clearQuote(p);
      loadAcct(true).then(function () { paintStatic(p); });
      try { if (window.__lxxBookReload) window.__lxxBookReload(); } catch (e) {}
    }).catch(function (e) {
      var m = (e && e.message) || '';
      var code = (m.match(/\bte[cfm][A-Z_]+/) || [])[0];
      stop(code && CODES[code] ? CODES[code] : (m || 'The swap could not be completed.'), 'bad');
      if ((e && e.requote) || code === 'tecPATH_PARTIAL') setTimeout(requote, 50);
    });
  }

  // ---- wiring --------------------------------------------------------------------------------------
  var tmr = null;
  function wire() {
    if (window.__lxxDxaSwapWired) return;
    window.__lxxDxaSwapWired = 1;

    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var p = t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p) return;

      var b = t.closest('[class*="dxa-trade-cta"]');
      if (b) {
        if (b.getAttribute('data-lxgate') === '1' || !addr()) return;   // lx-gate opens the wallet picker
        if (e.isTrusted && document.getElementById('lx-feemodal')) {
          var msg = validate(p);
          if (msg) { e.preventDefault(); e.stopImmediatePropagation(); say(p, msg, 'bad'); }
          return;                                                        // valid: the review step opens
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        doSwap(p);
        return;
      }

      var q = t.closest('.dxa-trade-quick button, .mdxa-trade-quick button');
      if (q) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var pct = /max/i.test(q.textContent) ? 1 : (parseFloat(q.textContent) / 100);
        var bal = payBalance(p);
        if (!(bal > 0) || !(pct > 0)) return;
        var room = side(p) === 'sell' ? bal : Math.max(0, bal / (1 + feeRate()) - 0.0001);
        var i = input(fields(p)[0]);
        if (i) i.value = plainNum(floorTo(room * pct, 6));
        // MAX MEANS ALL OF IT (RAZA 2026-09-16: "I sold max amount of this asset but some is still left behind"): remembered
        // here so the payment can be built to spend the whole balance rather than stopping at the quoted output.
        if (pct === 1 && side(p) === 'sell') p.setAttribute('data-lxmax', '1'); else p.removeAttribute('data-lxmax');
        requote();
        return;
      }

      if (t.closest('.dxa-trade-flip, .mdxa-trade-flip')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var other = $('[class*="dxa-side-btn"]:not(.active)', p);
        if (other) other.click();
        return;
      }

      if (t.closest('[class*="dxa-side-btn"]')) {
        // After the design flips .active and dexasset.js relabels the chips.
        setTimeout(function () { var i2 = input(fields(p)[0]); if (i2) i2.value = ''; clearQuote(p); paintStatic(p); say(p, ''); }, 30);
      }
    }, true);

    // Typing is claimed at the pane: the design's own input handler would otherwise write a mock receive
    // amount into the second box after ours.
    window.addEventListener('input', function (e) {
      var t = e.target;
      var p = t && t.closest && t.closest('.dxa-pane-swap, .mdxa-pane-swap');
      if (!p || t.tagName !== 'INPUT') return;
      e.stopImmediatePropagation();
      var v = String(t.value).replace(/[^0-9.]/g, '');
      var dot = v.indexOf('.');
      if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      if (v !== t.value) t.value = v;
      // TYPING INTO "YOU RECEIVE" FILLS "YOU PAY" (RAZA 2026-09-16: "Thats how it is on stellar"). The pay amount is what the
      // ledger is then asked to route, so the quote that follows is a real one; the receive box keeps the typed figure while
      // it has focus. The rate is the live quote's when there is one, else the page's own price.
      var ff = fields(p), payI = input(ff[0]), recvI = input(ff[1]);
      if (t === recvI && payI) {
        var want = num(v), sd = sides(p), dd = window.__lxxAssetData;
        var rt = (quote && quote.amt > 0 && quote.out > 0 && quote.side === side(p)) ? (quote.out / quote.amt)
          : ((dd && dd.price > 0) ? (sd.pay.currency === 'XRP' ? 1 / dd.price : dd.price) : 0);
        payI.value = (want > 0 && rt > 0) ? plainNum(floorTo(want / rt, 6)) : '';
        p.removeAttribute('data-lxmax');
      } else if (t === payI) {
        p.removeAttribute('data-lxmax');
      }
      clearTimeout(tmr);
      tmr = setTimeout(requote, 300);
    }, true);

    window.addEventListener('lxx:assetdata', function () { requote(); });
    if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { acct = { key: null }; boot(); });
  }

  function boot() {
    var p = pane();
    if (!p || !asset() || !window.lxx) return;
    var i = input(fields(p)[0]);
    if (i && !p.__lxxCleared) { i.value = ''; p.__lxxCleared = 1; }
    // Leftover from the disabled era, in case an old copy of the page script ran first.
    $$('.lxx-dxa-offnote', p).forEach(function (n) { n.parentNode.removeChild(n); });
    // lx-feemodal can rebuild its row after this runs; claim whatever it writes, whenever it writes it.
    if (!p.__lxxFeeObs && window.MutationObserver) {
      p.__lxxFeeObs = new MutationObserver(function () { claimFeeRow(p); });
      p.__lxxFeeObs.observe(p, { childList: true, subtree: true });
    }
    paintStatic(p);
    clearQuote(p);
    loadAcct(true).then(function () { paintStatic(p); requote(); });
  }

  wire();
  var tries = 0;
  (function wait() {
    if (pane() && asset() && window.lxx) { boot(); return; }
    if (++tries < 40) setTimeout(wait, 250);
  })();
})();

