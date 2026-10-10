
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

// Rewards page: what the connected wallet is actually eligible for.
//
// The inherited `lx-rewardsdata` asked people to "Connect your Stellar wallet" and listed recipients
// as Stellar G-addresses. It did at least label its table "Illustrative preview — sample data", so
// it was not claiming those payouts happened; it was just the wrong ledger's fiction.
//
// WHAT THIS DOES AND DOES NOT DO. The eligibility box is real: it reads the connected account off
// the XRP Ledger and reports the LUMOS it holds, its position in the LUMOS/XRP native pool, and its
// positions across the ten Ecosystem pools. The distribution REPORT is not real and is not faked --
// there is no source for past XRPL payouts, so it says so instead of showing invented recipients.
// A page about who got paid is the last place to put plausible-looking numbers.
//
// Two kinds of account are excluded from the participant view, for different reasons:
//   TEAM WALLETS  treasury allocations, 850M LUMOS between them (86.9% of the top 50). RAZA's list,
//                 resolved and verified on-ledger -- see xrpl-core TEAM_WALLETS.
//   AMM ACCOUNTS  a pool is not a holder. The LUMOS/XRP AMM sits near the top of the holder list
//                 with 17.09M LUMOS, which is just its own reserve.
(function () {
  if (window.__lxxRewards) return;
  window.__lxxRewards = 1;

  var RPC = 'https://xrplcluster.com/';
  var ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CUR = '4C554D4F53000000000000000000000000000000';

  // Verified on mainnet: 412.5 XRP / 17,075,469 LUMOS, fee 0.625%.
  var NATIVE_POOL = 'rnPQqk3cfHyqSyvAGh3AfMtWiszK8zaF4U';

  // The ten Ecosystem pools RAZA supplied, each confirmed by amm_info to be a real AMM with LUMOS
  // on one side. Pair names are what the LEDGER reported, not what was typed.
  var ECO = {
    'r27TeM8xMebVAMHt4aB3BMYw5MB5fULht': '666',
    'rM6HW3s4WUGuLYwKwRvZx2aai5wk5PR5fz': 'XDawgs',
    'rhhBo4BXkrhvr17rLdtdwxMjEk1NnTvqUC': 'MXI',
    'rJZftp95akgYuXXtb2yp23F1cGuHu34pMA': 'BXE',
    'rEmgwNPCbq6ogmLKThxgee35uCSqfhB83M': 'REAL',
    'rJnv9wSoSECHzWsNXR7E74hi8mbKX9ZnDM': 'RLUSD',
    'rsKJxAyfL2AGdTMqz5ZMhBSyiSxqz97g3z': 'ARMY',
    'rKsz9Dft5yYtbLS1SSG9L6u3LyhgwuWhew': 'FUZZY',
    'rUHWxx4kodHx3P8WxtkdcjhwDXnr5p9txo': 'BEAR',
    'rJfj7MXMt1VfBFF8mBta1CesMSzXYZELyZ': 'SOLO'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return Math.round(v).toLocaleString('en-US');
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) return null;
      return res;
    }).catch(function () { return null; });
  }

  // ---- eligibility --------------------------------------------------------------------------------
  function box(title, sub, rows) {
    var b = $('#eligBox');
    if (!b) return;
    // Seventh gate of this shape: #eligBox:not(.lxrw) { visibility: hidden }. The class is NOT in
    // the base markup -- the old script added it once it had data, and its stylesheet outlived it.
    // Without this the box fills correctly and stays invisible, which is exactly how it looked.
    b.classList.add('lxrw');
    b.innerHTML = '';
    var wrap = el('div', 'lxrw-empty');
    wrap.appendChild(el('div', 't', title));
    if (sub) wrap.appendChild(el('div', 's', sub));
    b.appendChild(wrap);
    if (rows && rows.length) {
      var list = el('div');
      list.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:6px';
      for (var i = 0; i < rows.length; i++) {
        var r = el('div');
        r.style.cssText = 'display:flex;justify-content:space-between;gap:14px;font-size:13.5px';
        r.appendChild(el('span', null, rows[i][0]));
        var v = el('span', 'mono', rows[i][1]);
        v.style.cssText = 'font-weight:700';
        r.appendChild(v);
        list.appendChild(r);
      }
      b.appendChild(list);
    }
  }

  function erBox(rows) {
    var b = $('#eligBox');
    if (!b) return;
    b.classList.add('lxrw');
    b.innerHTML = '';
    rows.forEach(function (r) {
      var er = el('div', 'er' + (r[4] ? ' tot' : ''));
      var ek = el('div', 'ek');
      if (r[0]) { var dot = el('span', 'd'); dot.style.background = r[0]; ek.appendChild(dot); }
      var w = el('div');
      w.appendChild(el('div', 't', r[1]));
      if (r[2]) w.appendChild(el('div', 's', r[2]));
      ek.appendChild(w);
      er.appendChild(ek);
      er.appendChild(el('div', 'ev mono', r[3]));
      b.appendChild(er);
    });
  }

  function eligibility() {
    var me = addr();
    if (!me) {
      box('Connect your XRP Ledger wallet',
        'See your live LUMOS balance and pool positions, and what you would earn this round.');
      return;
    }

    box('Reading the XRP Ledger…', 'Checking your LUMOS balance and pool positions.');

    window.lxx.allLines(rpc, me).then(function (res) {
      if (!res || !res.lines) {
        box('Could not read that account',
          'The XRP Ledger did not return balances for ' + me.slice(0, 8) + '… — it may not be activated yet.');
        return;
      }
      var lines = res.lines;

      var lumos = 0;
      var nativeLp = 0;
      var ecoHits = [];

      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var bal = Number(l.balance);
        if (!isFinite(bal) || bal <= 0) continue;             // negatives are obligations, not holdings

        if (l.currency === CUR && l.account === ISS) { lumos += bal; continue; }

        // An LP token is issued BY the AMM account, so l.account identifies the pool directly.
        if (typeof l.currency === 'string' && l.currency.length === 40 && /^03/i.test(l.currency)) {
          if (l.account === NATIVE_POOL) nativeLp += bal;
          else if (ECO[l.account]) ecoHits.push({ name: ECO[l.account], lp: bal, acct: l.account });
        }
      }

      var rows = [];
      rows.push(['LUMOS held', amount(lumos) + ' LUMOS']);
      rows.push(['LUMOS/XRP pool (Native LP)', nativeLp > 0 ? amount(nativeLp) + ' LP' : 'no position']);
      rows.push(['Ecosystem pools', ecoHits.length
        ? (ecoHits.length + ' of 10 — ' + ecoHits.map(function (e) { return e.name; }).join(', '))
        : 'no position']);

      var isTeam = false;
      try { isTeam = window.lxx.isTeamWallet(me); } catch (e) {}

      if (isTeam) {
        // Say it plainly rather than showing a total this account will never receive.
        box('This is a team wallet',
          'Team and treasury wallets are excluded from reward distributions, so this account earns '
          + 'nothing regardless of its balance.', rows);
        return;
      }

      // HOLDING LUMOS IS NOT A REWARD PROGRAMME (RAZA 2026-09-15: "I dont think Rewards is working correctly on XRPL").
      // This said "You are eligible" for any balance — 1.05M LUMOS and no pool position. The three programmes on this
      // page are Native LP (a LUMOS/XRP position), Ecosystem LP (a position in one of the ten pools) and Whale Holder,
      // which starts at 5,000,000 LUMOS with one share per 5M. The 250K fee discount is a trading benefit, not a reward.
      // STELLAR'S BOX (RAZA 2026-09-15: "the design remains same and if the wallet is not qualifying for any reward. Just add -
      // like you're doing on Stellar"): one row per programme with its dot, what this account has, and its estimated share
      // of the round — Native LP 1,000,000 LUMOS by pool share, Ecosystem 100,000 LUMOS per pool by pool share, Whale Holder
      // 1,000,000 LUMOS by whale shares (one per 5M, team wallets and pools excluded) — then the total.
      var shares = Math.floor(lumos / 5e6);
      var lpTotal = function (r) { return Number(r && r.amm && r.amm.lp_token && r.amm.lp_token.value) || 0; };
      Promise.all([
        nativeLp > 0 ? rpc('amm_info', { amm_account: NATIVE_POOL }) : Promise.resolve(null),
        Promise.all(ecoHits.map(function (e) { return rpc('amm_info', { amm_account: e.acct }).then(function (r) { return { e: e, r: r }; }); })),
        shares > 0 ? fetch('/lxapi/xrplrichlist?iss=' + ISS + '&cur=' + CUR + '&n=50').then(function (x) { return x.json(); }).catch(function () { return null; }) : Promise.resolve(null)
      ]).then(function (res) {
        var nTot = lpTotal(res[0]), nShare = nTot > 0 ? nativeLp / nTot : 0, nRew = 1e6 * nShare;
        var eRew = 0, eCodes = [];
        res[1].forEach(function (x) { var t = lpTotal(x.r); if (t > 0) eRew += 1e5 * (x.e.lp / t); eCodes.push(x.e.name); });
        var wTS = 0;
        ((res[2] && res[2].rows) || []).forEach(function (h) {
          if (h.amm) return;
          var tm = false;
          try { tm = window.lxx.isTeamWallet(h.account); } catch (e) {}
          if (tm) return;
          var hb = Math.abs(Number(h.balance)) || 0;
          if (hb >= 5e6) wTS += Math.floor(hb / 5e6);
        });
        if (shares > wTS) wTS = shares;
        var wRew = (shares > 0 && wTS > 0) ? 1e6 * shares / wTS : 0;
        var whole = function (v) { return Math.round(+v || 0).toLocaleString('en-US'); };
        var pc = function (x) { var q = (+x || 0) * 100; return (q >= 1 ? q.toFixed(1) : (q >= 0.01 ? q.toFixed(2) : q.toFixed(3))) + '%'; };
        erBox([
          ['var(--accent)', 'Native LP Rewards', nativeLp > 0 ? ('LUMOS/XRP · ' + pc(nShare) + ' of the pool') : 'Add LUMOS/XRP liquidity to qualify', nativeLp > 0 ? '~' + whole(nRew) : '—'],
          ['var(--blue)', 'Ecosystem LP Rewards', eCodes.length ? (eCodes.length === 1 ? ('LUMOS/' + eCodes[0] + ' pool') : (eCodes.length + ' pools · ' + eCodes.slice(0, 3).join(', ') + (eCodes.length > 3 ? '…' : ''))) : 'Join an eligible LUMOS pool to qualify', eCodes.length ? '~' + whole(eRew) : '—'],
          ['var(--green)', 'Whale Holder Rewards', shares > 0 ? (whole(lumos) + ' LUMOS · ' + shares + ' share' + (shares > 1 ? 's' : '')) : (lumos > 0 ? whole(lumos) + ' LUMOS · below 5M' : 'Hold 5M+ LUMOS to qualify'), shares > 0 ? '~' + whole(wRew) : '—'],
          ['', 'Your estimated total this round', '', '~' + whole(nRew + eRew + wRew) + ' LUMOS', true]
        ]);
      });
    });
  }

  // ---- distribution report ------------------------------------------------------------------------
  // There is no source for past XRPL payouts, so this says so. The inherited version filled the same
  // table with invented Stellar recipients under an "illustrative" label; on a page about who got
  // paid, an empty state is the only honest option.
  function report() {
    var rows = $('#repRows');
    if (!rows) return;
    rows.innerHTML = '';
    var r = el('div', 'rr');
    r.style.cssText = 'justify-content:center;opacity:.7;padding:22px 8px;text-align:center';
    r.textContent = 'No distribution has run on the XRP Ledger yet. Recipients will be listed here once one has.';
    rows.appendChild(r);

    var c = $('#repCount');
    if (c) {
      c.textContent = '0';
      // The design's "Showing <b>6</b> of" kept its mock six beside a count of none.
      var shown = c.previousElementSibling;
      if (shown && shown.tagName === 'B' && shown.textContent !== '0') shown.textContent = '0';
    }
    var t = $('#repTitle');
    if (t) t.textContent = 'No rounds yet';
    var s = $('#repSub');
    if (s) s.textContent = 'This table lists real recipients once a distribution has run.';
    var p = $('#psum');
    if (p) p.textContent = 'Ten Ecosystem pools · LUMOS/XRP native pool · holder rewards';
  }

  // The page's prose still described the wrong chain throughout: "Based on your connected Aptos
  // wallet", "hold LUMOS on Aptos or provide liquidity ... on Aptos — to earn a share every round",
  // a pool named "LUMOS/APT", and a network selector whose only button said "Aptos".
  //
  // The figures beside all of that were already correct XRP Ledger ones, which is what makes this
  // kind of leftover worth chasing: a reader reconciles the words with the numbers, and the words
  // are the part that tells them which chain they need to be on to qualify.
  //
  // Rewritten by TEXT NODE, so any markup the design wrapped mid-sentence survives untouched.
  function paintChainCopy() {
    var sel = '.elig-note, .pdesc, .ns, .prog-desc, .rw-note';
    [].forEach.call(document.querySelectorAll(sel), function (host) {
      if (!/Aptos|\bAPT\b|Stellar|\bXLM\b/.test(host.textContent || '')) return;
      var w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = w.nextNode())) {
        var v = n.nodeValue;
        if (!v) continue;
        n.nodeValue = v
          .replace(/LUMOS\/APT/g, 'LUMOS/XRP')
          .replace(/\bon Aptos\b/g, 'on the XRP Ledger')
          .replace(/\bAptos wallet\b/g, 'XRP Ledger wallet')
          .replace(/\bAptos\b/g, 'XRP Ledger')
          .replace(/\bon Stellar\b/g, 'on the XRP Ledger')
          .replace(/\bStellar\b/g, 'XRP Ledger')
          .replace(/\bXLM\b/g, 'XRP')
          .replace(/\bAPT\b/g, 'XRP');
      }
      // The network button is a 1-5 character target for the logo layer once it says "XRP Ledger";
      // claiming it keeps the label from being repainted away.
      if (host.classList && host.classList.contains('ns')) {
        try { host.setAttribute('data-logoed', '1'); } catch (e) {}
      }
    });
  }

  // The programme descriptions still named another chain's pairs after the chain-name pass: "LUMOS/aBTC on the XRP
  // Ledger" (aBTC is an Aptos asset) and "e.g. LUMOS/MESO, LUMOS/CELL". Named from this ledger's own pools.
  function fixProgramCopy() {
    [].forEach.call(document.querySelectorAll('.pdesc'), function (p) {
      var h = p.innerHTML, o = h;
      h = h.replace(/\s*or\s*<b>LUMOS\/aBTC<\/b>\s*on the XRP Ledger/i, '');
      h = h.replace(/LUMOS\/MESO,\s*LUMOS\/CELL/, 'LUMOS/RLUSD, LUMOS/ARMY');
      if (h !== o) p.innerHTML = h;
    });
  }

  // THE ROUND PICKER AND THE NETWORK CHIP (RAZA 2026-09-16: "it shows APTOS logo and also says June 1. Fix it"). The chip keeps the
  // design's Aptos image; the picker stopped at the design's last sample round. Rounds close on the 1st and the 15th on the same
  // dates as Stellar (Round 23 = 1 June 2026), so the list runs to the most recent close.
  function fixRounds() {
    var img = document.querySelector('#netseg .ns img');
    if (img && img.getAttribute('data-lxx') !== '1') {
      img.setAttribute('data-lxx', '1');
      img.src = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    }
    var sel = $('#roundSel');
    if (!sel || sel.__lxx) return;
    sel.__lxx = 1;
    var rounds = [], n = 20, d = new Date(2026, 3, 15), now = new Date();
    while (d <= now) {
      rounds.push([n, new Date(d.getTime())]);
      n++;
      d = d.getDate() === 1 ? new Date(d.getFullYear(), d.getMonth(), 15) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    if (!rounds.length) return;
    sel.innerHTML = '';
    rounds.reverse().forEach(function (r) {
      var o = document.createElement('option');
      o.value = String(r[0]);
      o.textContent = 'Round ' + r[0] + ' · ' + r[1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      sel.appendChild(o);
    });
    sel.value = String(rounds[0][0]);
    sel.addEventListener('change', function () { setTimeout(report, 0); });
  }

  // ---- what each programme has actually paid out -----------------------------------------------------
  //
  // THE PAGE WAS CONTRADICTING ITS OWN FAQ. All three "Distributed" bars read 23M, and the hero read
  // 69,000,000 — which is 3 x 23M. Those are the design's placeholder figures, inherited in the
  // markup and never reconciled with anything. Three programmes that STARTED FOUR MONTHS APART
  // cannot have paid out identical amounts, and the page says so itself a few hundred pixels lower:
  // "Ecosystem LP began on 15 April 2026, making 1 October 2026 its twelfth and final round" — that
  // is eleven rounds paid, not twenty-three.
  //
  // So the figures are COUNTED from the schedule the page already publishes rather than written down
  // a second time: rounds close on the 1st and the 15th, each programme pays 1,000,000 LUMOS a round,
  // and each began on its own stated date. The count is the only input, so the bars and the FAQ
  // cannot drift apart again.
  //
  // Start dates are the ones in the FAQ above, which is the authored source for this schedule.
  var PROGRAMMES = [
    { key: 'native', start: [2025, 11, 15], perRound: 1e6, cap: 240e6 },   // 15 Dec 2025
    { key: 'eco', start: [2026, 3, 15], perRound: 1e6, cap: 240e6 },       // 15 Apr 2026
    { key: 'whale', start: [2026, 3, 1], perRound: 1e6, cap: 50e6 },       //  1 Apr 2026
  ];
  // Rounds CLOSE on the 1st and the 15th. A round dated today has not paid yet, so the count is of
  // closes strictly before now -- the same boundary the countdown above uses for "next distribution".
  function roundsPaid(start, now) {
    var d = new Date(start[0], start[1], start[2]);
    var n = 0;
    while (d < now) {
      n++;
      d = d.getDate() === 1 ? new Date(d.getFullYear(), d.getMonth(), 15)
        : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return n;
  }
  function shortM(v) {
    var m = v / 1e6;
    return (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1)) + 'M';
  }
  function paintDistributed() {
    var rows = [].slice.call(document.querySelectorAll('.palloc .pa-row')).filter(function (r) {
      var l = r.querySelector('.l');
      return l && /distributed/i.test(l.textContent || '');
    });
    if (!rows.length) return;
    var now = new Date(), total = 0;
    // The bars are in the order the programmes are laid out, which is the order of PROGRAMMES.
    PROGRAMMES.forEach(function (p, i) {
      var paid = Math.min(p.cap, roundsPaid(p.start, now) * p.perRound);
      total += paid;
      var r = rows[i];
      if (!r) return;
      var b = r.querySelector('.r b');
      if (b && b.textContent !== shortM(paid)) b.textContent = shortM(paid);
    });
    // "Distributed so far" is the sum of the three, not a fourth number to keep in step.
    [].forEach.call(document.querySelectorAll('.hstats .hstat'), function (h) {
      if (!/distributed so far/i.test(h.textContent || '')) return;
      var v = h.querySelector('.v');
      var want = total.toLocaleString('en-US');
      if (v) {
        // The unit sits in its own node beside the figure; only the figure is rewritten.
        var t = v.firstChild;
        if (t && t.nodeType === 3) { if (t.nodeValue !== want) t.nodeValue = want; }
        else if (v.textContent.indexOf(want) < 0) v.textContent = want;
      }
    });
  }

  function load() {
    if (!$('#eligBox') && !$('#repRows')) return;             // not the Rewards page
    setTimeout(fixRounds, 0);
    setTimeout(fixRounds, 1500);
    paintChainCopy();
    fixProgramCopy();
    paintDistributed();
    eligibility();
    report();
    // Connect finishes after this on a cold load, and the address can arrive from another tab.
    window.addEventListener('storage', function (e) {
      if (e && e.key === 'lumos.address') eligibility();
    });
    setTimeout(eligibility, 2500);
    // The eligibility box is rebuilt when an address arrives, and it carries the "connected … wallet"
    // sentence, so the copy pass runs again after each repaint rather than only once at load.
    setTimeout(paintChainCopy, 2600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxRewardsReload = load;
})();

