
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

// Trade page: the XRP Ledger's most-traded tokens.
//
// THIS REPLACES A LAYER THAT WAS ACTIVELY WRONG, not one that was merely missing. Before this, the
// inherited `lx-dexmain` was still running on /trade/xrpl and filling the market table from Horizon:
// 36 rows of real STELLAR assets -- USDC/circle.com, SHX/stronghold.co, yXLM, AQUA -- priced in XLM,
// under a page titled "Trade on the XRP Ledger DEX". Live, plausible and entirely the wrong chain.
// That is worse than the blank wallet page, which at least showed nothing.
//
// Data comes from /lxapi/xrpltokens, never the upstream directly: the anonymous tier there is 333
// requests per DAY per IP, so a browser-side fetch would exhaust it and take out everyone behind a
// shared mobile IP at once.
//
// LOGOS are real now: each row carries the token md5 and the image is proxied through
// /lxapi/xrplthumb, because xrpl.to's thumbnail endpoint needs the API key and that key must never
// reach the browser. Initials remain the fallback for tokens with no logo.
//
// NO SPARKLINES, still deliberately: the feed gives a 7d PERCENTAGE, not a 7d series, and drawing a
// curve from a single number would be inventing the shape of the week.
(function () {
  if (window.__lxxTrade) return;
  window.__lxxTrade = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  // PLAIN DECIMALS, as lumoscore.com's price columns print them (RAZA 2026-09-15: "in Last Price column, we're not using
  // this notation") — "0.00000000000764", never "7.64e-12". Four significant digits, like the rest of the column.
  // SUBSCRIPT ZEROS for the very small (RAZA 2026-09-15: "instead of 0.00000000000000000070 just use subscript notation"):
  // 0.0₁₈70 — the subscript counts the zeros after the decimal point, then four significant digits.
  function subZero(v) {
    var ex = v.toExponential(3).split('e');
    var zeros = -parseInt(ex[1], 10) - 1;
    var m = ex[0].replace('.', '').replace(/0+$/, '');
    if (m.length < 2) m += '0';
    var SUB = '₀₁₂₃₄₅₆₇₈₉';
    return '0.0' + String(zeros).split('').map(function (ch) { return SUB.charAt(+ch); }).join('') + m;
  }
  function tiny(v) { return v < 1e-8 ? subZero(v) : v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 3)); }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.000001) return '$' + tiny(v);
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + (v / 1e6).toFixed(1) + 'M';
  }

  function xrp(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v > 0 && v < 0.000001) return tiny(v);
    if (v < 1) return v.toPrecision(4);
    if (v < 1e6) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return (v / 1e6).toFixed(2) + 'M';
  }

  function count(v) {
    if (v == null || !isFinite(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }

  // A VOLUME IS NOT A PRICE (RAZA 2026-10-06: "Instead of showing the whole number along with decimals
  // on XRPL, USE K,M,B same as it shown on Stellar").
  //
  // The volume cell was calling xrp(), which is the PRICE formatter: it keeps four decimals under a
  // million because a price of 0.0001189 has to survive, and that is exactly wrong for a figure whose
  // magnitude is the whole point. "26,430.7313 XRP" against Stellar's "370.7K XLM".
  //
  // lumoscore.com's own fmtAmt, read verbatim off its live lx-eac0bfff0cf7.js, so the two tables round
  // identically rather than merely similarly:
  //
  //     n>=1e6 -> (n/1e6).toFixed(2)+"M"   n>=1e3 -> (n/1e3).toFixed(1)+"K"   else n.toFixed(0)
  //
  // NO "B". RAZA asked for "K, M, B same as it shown on Stellar", and Stellar has no B — a billion
  // renders there as "1234.56M". Matching its output is the instruction that keeps being repeated, so
  // the thousands step is not invented here for XRPL alone; adding B is a change to BOTH tables.
  //
  // Only the volume cells call this. xrp() still formats prices and the day's high/low, where the
  // decimals are the information.
  function vol0(v) {
    if (v == null || !isFinite(v)) return '—';
    v = +v || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  }

  function pct(v) { return (v == null || !isFinite(v)) ? null : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

  // ICONS: the design's icon classes (.mdx-mk-ic, .dex-mk-pair-ic, .dex-mover-ico) and the
  // data-lxic attribute are all hooks for inherited Stellar icon painters that resolve logos BY
  // TICKER -- they stamped a Stellar mark onto RLUSD, USDC and ARMY and cleared the text. A ticker
  // is not an identity on either ledger. So icons carry a class of our own and, now that the API
  // key exists, a REAL logo proxied through /lxapi/xrplthumb.
  // Real logo when we have one, initials when we do not.
  //
  // The <img> is wrapped in the SAME inline-SVG-bearing span used for initials, because the page
  // carries a logo healer that repaints any element with 1-5 characters of text -- an element
  // holding an img or svg is the only thing it skips. See browser/trade.js.
  //
  // The image goes through /lxapi/xrplthumb, never xrpl.to directly: that endpoint needs the API
  // key and the key must not reach the browser.
  function logoEl(name, md5, size) {
    var s = size || 32;
    var NS = 'http://www.w3.org/2000/svg';
    var e = document.createElement('span');
    e.className = 'lxx-ic';
    e.style.cssText = 'display:inline-flex;width:'+s+'px;height:'+s+'px;flex:0 0 '+s+'px;'
      + 'border-radius:50%;overflow:hidden;align-items:center;justify-content:center';

    function initials() {
      e.innerHTML = '';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('width', String(s)); svg.setAttribute('height', String(s));
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', '16');
      c.setAttribute('fill', 'rgba(255,255,255,.12)');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '16'); t.setAttribute('y', '17');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('font-size', '11'); t.setAttribute('font-weight', '800');
      t.setAttribute('fill', '#fff');
      t.textContent = String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      svg.appendChild(c); svg.appendChild(t);
      e.appendChild(svg);
    }

    if (/^[0-9a-f]{32}$/i.test(md5 || '')) {
      // A REFUSAL IS NOT "THIS TOKEN HAS NO LOGO" (RAZA 2026-10-06: "whre are the asset logos?", a
      // whole table of initials where eight rows had marks a minute earlier).
      //
      // This drew the initials on the FIRST error and never asked again, so one bad moment lettered a
      // row for the life of the page. xrpl.to answers 429 under its per-second burst cap, and this
      // table asks for a hundred marks at once — the window is small and it is hit often. Asked by
      // hand a few seconds later every one of those urls is 200, which is what a transient looks like
      // from the outside.
      //
      // Measured on the deployed build: all eight of the lettered rows returned 200 image/webp with
      // the breaker closed, which means the marks were there and the page had simply stopped asking.
      //
      // The same shape the wallet got, minus the status reading — an <img> cannot see a 429, and
      // switching this to fetch() would cost a second request per row on a hundred-row table for
      // information two retries already supply. Three attempts, spaced past the edge breaker's window,
      // then the initials stand.
      var src = '/lxapi/xrplthumb?id=' + md5 + '&w=' + (s > 48 ? 64 : 48);
      var tries = 0;
      var img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.width = s; img.height = s;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      img.onerror = function () {
        if (++tries > 2) { initials(); return; }
        // Spaced so the second attempt lands after the edge breaker reopens, and carrying a
        // cache-buster because a browser that has just taken an error for this url would otherwise
        // serve it straight back.
        setTimeout(function () { img.src = src + '&lxr=' + tries; }, tries === 1 ? 2500 : 9000);
      };
      img.src = src;
      e.appendChild(img);
    } else {
      initials();
    }
    return e;
  }


  (function () {
    if (document.getElementById('lxx-ic-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-ic-css';
    st.textContent = '.lxx-ic{width:32px;height:32px;flex:0 0 32px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;font-size:11px;'
      + 'font-weight:800;letter-spacing:.2px;color:#fff;background:rgba(255,255,255,.10)}';
    document.head.appendChild(st);
  })();

  // The table is keyed by ticker+issuer, the same identity the rest of the site uses. The ticker
  // alone is NOT an identity on this ledger any more than it is on Stellar -- several unrelated
  // tokens call themselves USDC -- so the issuer travels with it on the row.
  // CLICKING A TRADING PAIR DID NOTHING, for the same reason pool rows went to /pools/stellar.
  //
  // The design ships window.__lumosNav, a blanket row-navigation layer configured with a LISTTARGET
  // and CONTAINERNAV, which claims clicks on any row of a list page and routes them through its own
  // candidate resolver. On this fork that resolver produces Stellar-shaped destinations, so the row
  // either went somewhere that does not exist or — here — was swallowed and went nowhere at all.
  //
  // Ordinary click handlers on the row lose: capture descends from the top, so a document-level
  // listener always runs first, and an <a href> is simply preventDefaulted. WINDOW capture is the one
  // phase that runs before any of it. Scoped to the two market containers so nothing else changes.
  //
  // The destination is read from data-lxgo on the row rather than from a closure, which is what lets
  // one handler serve both the desktop table and the phone's card list.
  function claimRowClicks() {
    if (window.__lxxTradeNav) return;
    window.__lxxTradeNav = 1;
    function wantsTab(e) { return !!(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)); }
    function nav(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (e.button != null && e.button !== 0 && e.button !== 1) return;   // right-click: leave it alone

      // SORTING HAS TO BE HANDLED HERE, not on the header itself. A listener bound to the `th` never
      // gets the chance: the design claims clicks anywhere in a list page on WINDOW CAPTURE and
      // routes them through its own resolver, so the first click on "Last Price" reloaded the page
      // instead of sorting it. Window capture is the only phase early enough — the same reason the
      // row navigation below lives here rather than on the rows.
      var th = t.closest('th.lx-sortable');
      if (th) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onSortClick(th);
        return;
      }

      // A REAL LINK IS LET THROUGH, BUT THE DESIGN'S ROUTER IS NOT. Returning here is not enough on
      // its own: this listener getting out of the way just hands the click to the design's own
      // window-capture router, which cancels it and resolves its own route — which is why a plain
      // <a href> did nothing on this build before. stopImmediatePropagation removes that router from
      // the picture while leaving the DEFAULT intact, so the browser follows the href itself and
      // ctrl/cmd/middle-click behave the way they should. Same fix, same reasoning, as lumoscore.com.
      //
      // ON A MODIFIER CLICK THE DEFAULT IS NOT ENOUGH EVEN HERE. lumoscore.com measured the anchor
      // losing that race anyway ("the anchor was there, underlined on hover, and still refused to
      // open a tab"), because whether stopImmediatePropagation reaches the router depends on which
      // of the two window-capture listeners registered first — a race this code does not control.
      // Opening it ourselves does not depend on that ordering.
      var la = t.closest('a[href]');
      if (la) {
        e.stopImmediatePropagation();
        if (wantsTab(e)) {
          var lh = la.getAttribute('href');
          if (lh && lh.charAt(0) !== '#') {
            e.preventDefault();
            try { window.open(la.href, '_blank', 'noopener'); } catch (_) { window.location.href = lh; }
          }
        }
        return;
      }

      // The row's own Trade button and any other real control keep their behaviour.
      if (t.closest('button, input, select, [data-copy]')) return;
      var el2 = t.closest('[data-lxgo]');
      if (!el2) return;
      // THE ROWS ARE NOT LINKS (RAZA 2026-10-08: "many of the assets on trade main page not open in
      // new tab when i try to by ctrl+click"). Measured on the deployed list: 60 rows carry data-lxgo
      // and NOT ONE of them contains an <a href>, so there was no default for the browser to act on —
      // returning here on a modifier click simply surrendered it to the design's router, which
      // navigated in the same tab. Every one of the 60 behaved that way, which is the report.
      e.preventDefault();
      e.stopImmediatePropagation();
      var go = el2.getAttribute('data-lxgo');
      if (wantsTab(e)) {
        try { window.open(go, '_blank', 'noopener'); return; } catch (_) {}
      }
      window.location.href = go;
    }
    // auxclick as well as click: the middle button fires no click event at all in Chrome.
    window.addEventListener('click', nav, true);
    window.addEventListener('auxclick', nav, true);
  }

  // THE VERIFIED TICK lumoscore.com draws beside a trusted issuer (RAZA 2026-09-15: "add verified tick on trusted
  // XRPL assets"): its own span and glyph, styled by the inherited .lx-vtick rule. xrpl.to's verified flag decides,
  // the same flag the search rows already use.
  function vtick() {
    var s = document.createElement('span');
    s.className = 'lx-vtick';
    s.title = 'Verified issuer';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }

  function row(t, rank, usd) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-tkr', t.n);
    tr.setAttribute('data-iss', t.i);

    // 0: asset
    var c0 = el('td');
    var cell = el('div', 'dex-mk-pair-cell');
    cell.appendChild(el('span', 'dex-mk-rank', '#' + rank));
    var ic = logoEl(t.n, t.m, 32);
    cell.appendChild(ic);
    var nm = el('div', 'dex-mk-pair-name');
    // A REAL LINK, so a crawler can reach the asset page and a person can open it in a new tab
    // (RAZA 2026-10-07). Measured on the live build first: `a[href*="/trade/xrpl/"]` found ZERO links
    // on this page — every row navigated by script, which Google cannot click. lumoscore.com puts a
    // real <a> in this same cell for exactly this reason.
    //
    // The href is the one the row already navigates to, built from the same code+issuer pair, so the
    // link and the click can never disagree about where the row goes. An <a> also gives the browser
    // back ctrl/cmd/middle-click, which script navigation had taken away.
    //
    // It needs claimRowClicks() to stand aside — see the note there; a plain href alone is not enough
    // on this build, because the design's own router claims the click first and cancels it.
    var head = el('a', 'dex-mk-pair-head');
    head.href = '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i);
    head.textContent = t.n;
    // Colour and underline set explicitly rather than left to the cascade. `.dex-mk-pair-head` only
    // carries layout (display:flex), and every anchor rule in this build is scoped to some other
    // component — so what a bare <a> would inherit here is not knowable from the stylesheet. Stating
    // it means this cell looks exactly as it did when it was a <div>, which is the point: this change
    // is about what a crawler can follow, not about how the row reads.
    head.style.color = 'inherit';
    head.style.textDecoration = 'none';
    // EVERY ROW IN THIS TABLE IS TICKED (RAZA 2026-10-02: "Lets add verification tick to all XRPL assets
    // that we're showing on Trade page as curated assets", reaffirmed after I flagged what follows).
    //
    // ON THE RECORD, because the next person reading this will assume the tick means what it says: this
    // table is the top of the XRP Ledger market BY VOLUME, fetched live — not an allowlist anyone
    // maintains. So the tick now means "we list it", not "we checked it", and a token that trades its
    // way into the top hundred gets one. A search for "atom" on this build returns four different
    // tokens called ATOM, two of which claim a home domain the ledger disagrees with.
    //
    // If this is ever to mean verification again it needs a real curated list — issuer+currency, owned
    // by someone — and this line gated back on membership of it.
    head.appendChild(vtick());
    nm.appendChild(head);
    if (t.u) nm.appendChild(el('div', 'sub', t.u));
    cell.appendChild(nm);
    c0.appendChild(cell);
    tr.appendChild(c0);

    // 1: last price. The denomination toggle SWAPS the headline and the sub-line rather than hiding
    //    one of them — the same thing lumoscore.com does, checked by clicking it: XLM mode reads
    //    "5.6406 / $1.0000" and $ mode reads "$1.0000 / 5.6406 XLM".
    var c1 = el('td');
    var pr;
    if (DEN === 'usd' && usd != null) {
      pr = el('div', 'dex-mk-price');
      pr.appendChild(el('span', 'lc-money', money(t.p * usd)));
      var subx = el('span', 'sub', xrp(t.p) + ' XRP');
      pr.appendChild(subx);
    } else {
      pr = el('div', 'dex-mk-price', xrp(t.p));
      if (usd != null) {
        var sub = el('span', 'sub');
        sub.appendChild(el('span', 'lc-money', money(t.p * usd)));
        pr.appendChild(sub);
      }
    }
    c1.appendChild(pr);
    tr.appendChild(c1);

    // 2: 24h change, IN THE CHOSEN DENOMINATION — a different number, not a relabel.
    //    A token priced in XRP can be flat in dollars while XRP itself moves, and Stellar shows
    //    exactly that: USDC reads +6.59% against XLM and +0.00% against the dollar on the same row.
    var c2 = el('td');
    var dv = changeIn(t.d);
    var ch = el('div', 'dex-mk-change', pct(dv) || '—');
    if (dv != null) ch.style.color = dv >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    c2.appendChild(ch);
    tr.appendChild(c2);

    // 3: 24h volume
    var c3 = el('td');
    var vol = el('div', 'dex-mk-vol', vol0(t.v) + ' XRP');
    if (usd != null && t.v != null) {
      var vs = el('span', 'sub');
      vs.appendChild(el('span', 'lc-money', money(t.v * usd)));
      vol.appendChild(vs);
    }
    c3.appendChild(vol);
    tr.appendChild(c3);

    // 4: trades
    var c4 = el('td', 'dex-mk-trades-td');
    c4.appendChild(el('div', 'dex-mk-trades', count(t.x)));
    tr.appendChild(c4);

    // 5: liquidity
    var c5 = el('td');
    var tv = el('div', 'dex-mk-tvl');
    tv.appendChild(el('span', 'lc-money', usd != null && t.t != null ? money(t.t * usd) : '—'));
    c5.appendChild(tv);
    tr.appendChild(c5);

    // 6: day high / low
    var c6 = el('td');
    var hl = el('div', 'dex-mk-hl');
    var r1 = el('div', 'row');
    r1.appendChild(el('span', 'lab', 'H'));
    r1.appendChild(el('span', 'v-h', xrp(t.hi)));
    var r2 = el('div', 'row');
    r2.appendChild(el('span', 'lab', 'L'));
    r2.appendChild(el('span', 'v-l', xrp(t.lo)));
    hl.appendChild(r1); hl.appendChild(r2);
    c6.appendChild(hl);
    tr.appendChild(c6);

    // 7: 7d trend -- the percentage, not a drawn curve. See the note at the top of this file.
    var c7 = el('td');
    // EMPTY UNTIL THE CURVE ARRIVES (RAZA 2026-09-15: "In 7D Trend, it shows percentage for split second then fixes to the
    // graph"). The percentage waits on the cell and is written only if no series comes back for this row.
    var w = el('div', 'dex-mk-change', '');
    w.setAttribute('data-lxpct', pct(t.w) || '—');
    if (t.w != null) w.style.color = t.w >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    c7.appendChild(w);
    tr.appendChild(c7);

    // 8: action
    var c8 = el('td', 'td-action');
    var b = el('button', 'dex-mk-action-btn', 'Trade');
    b.type = 'button';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      window.location.href = '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i);
    });
    c8.appendChild(b);
    tr.appendChild(c8);

    // The destination is stamped on the row rather than closed over, so the window-capture claim
    // below can read it. See claimRowClicks() for why a plain click handler here does nothing.
    tr.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return tr;
  }

  // The MOBILE market list is a different structure entirely -- .mdx-mk-row cards in #mdxMkList,
  // not table rows in #dexMkTbody -- and the mobile page carries none of the dex* ids. Writing only
  // the desktop renderer is the most repeated bug in this project, and it bit again here: the first
  // pass guarded on id="dexMkTbody", so the phone was skipped entirely and kept showing the Stellar
  // market list, complete with /trade/stellar/ links.
  function mkCard(t, rank, usd) {
    var card = el('div', 'mdx-mk-row');
    card.appendChild(el('span', 'mdx-mk-rank', '#' + rank));

    var top = el('div', 'mdx-mk-top');
        // NOT 'lxmd-ic': that class is lx-mobdex's hook, and it decorates whatever carries it --
    // stamping a Stellar mark and clearing the initials. Layout class only.
    var ic = logoEl(t.n, t.m, 32);
    top.appendChild(ic);

    var meta = el('div', 'mdx-mk-meta');
    var nameRow = el('div', 'mdx-mk-name-row');
    nameRow.appendChild(el('span', 'mdx-mk-name', t.n));
    // The phone card lists the same rows, so it ticks on the same rule — see the desktop note above.
    nameRow.appendChild(vtick());
    if (t.u) nameRow.appendChild(el('span', 'mdx-mk-domain', t.u));
    meta.appendChild(nameRow);
    // THE PHONE IGNORED THE DENOMINATION AND DISAGREED WITH THE DESKTOP. This card hard-coded the
    // XRP price and the XRP-denominated change while the table honoured DEN, so at the same moment
    // RLUSD read "-0.09%" on a desktop and "+4.56%" on a phone — the same token, the same second,
    // two different 24h figures, because one was measured against the dollar and the other against
    // an XRP that had moved 4.6%.
    //
    // USD is what lumoscore.com's phone build shows — read off it directly: "Vol $964.04K",
    // "$1.0000 +0.11%", and no denomination toggle on that breakpoint either. So the card follows
    // DEN like the table does, which makes the two devices agree and matches main.
    //
    // `usd` was already a parameter here and was simply never used.
    var usdOn = (DEN === 'usd' && usd != null);

    var vol = el('div', 'mdx-mk-vol', 'Vol ' + (usdOn ? money(t.v * usd) : (vol0(t.v) + ' XRP')));
    if (t.x != null) vol.appendChild(el('span', 'mdx-mk-trades', count(t.x) + ' trades'));
    meta.appendChild(vol);
    top.appendChild(meta);

    var right = el('div', 'mdx-mk-right');
    right.appendChild(el('div', 'mdx-mk-price', usdOn ? money(t.p * usd) : (xrp(t.p) + ' XRP')));
    var dv = changeIn(t.d);
    var p = el('div', 'mdx-mk-pct ' + (dv != null && dv < 0 ? 'down' : 'up'), pct(dv) || '—');
    right.appendChild(p);
    top.appendChild(right);

    card.appendChild(top);
    card.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return card;
  }

  function mover(t, usd) {
    var card = el('div', 'dex-mover-card');
    card.setAttribute('data-tkr', t.n);
    var head = el('div', 'dex-mover-head');
    var ic = logoEl(t.n, t.m, 32);
    head.appendChild(ic);
    var pair = el('div', 'dex-mover-pair', t.n);
    if (t.u) pair.appendChild(el('span', 'sub', ' ' + t.u));
    head.appendChild(pair);
    var p = el('span', 'dex-mover-pct', pct(t.d) || '—');
    if (t.d != null) p.style.color = t.d >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    head.appendChild(p);
    card.appendChild(head);
    var body = el('div', 'dex-mover-body', xrp(t.p) + ' XRP'
      + (usd != null ? ('  ·  ' + money(t.p * usd)) : ''));
    card.appendChild(body);
    card.setAttribute('data-lxgo', '/trade/xrpl/' + encodeURIComponent(t.n + '-' + t.i));
    return card;
  }

  // The design's column headers name the quote asset, and the page composes them from a variable
  // that still said XLM. Set explicitly here: this layer decides what the numbers are quoted in, so
  // it is the thing that should label them.
  // ---- pagination --------------------------------------------------------------------------------
  //
  // THE PAGER WAS THE DESIGN'S, AND IT WAS FURNITURE. Clicking "2" did nothing at all: this layer
  // fetched 50 rows, rendered all of them, and never touched the buttons. The numbers under them
  // were the template's own and did not even agree with each other — "Showing 1–50 of 142 pairs"
  // beside eight page buttons, which would be 400 rows.
  //
  // Rebuilt from the real row count. The design's markup is reused exactly as it ships — First,
  // Prev, numbers, an ellipsis, Next, Last — so nothing new is introduced; only how many buttons
  // there are and what they do.
  var PER = 50;
  var pageNo = 1;

  function setPageInfo(from, to, total) {
    var shown = $('#dexMkShown');
    if (shown) shown.textContent = from + '–' + to;
    // The total is the SECOND <strong> in the line and carries no id of its own:
    //   Showing <strong id="dexMkShown">1–50</strong> of <strong>142</strong> pairs
    // querySelectorAll, not `$$` — this file defines `$` only. Written as `$$` first, exactly as in
    // wallet.js an hour earlier; `node -c` passes it both times because it is a runtime reference.
    var strongs = document.querySelectorAll('.dex-mk-page-info strong');
    if (strongs.length > 1) strongs[strongs.length - 1].textContent = String(total);
  }

  function buildPager(h, d, pages) {
    var pager = $('.dex-mk-pager');
    if (!pager) return;

    // Keep the design's own First/Prev/Next/Last buttons — they carry its icons — and rebuild only
    // the numbers between them.
    var kids = [].slice.call(pager.children);
    var first = kids[0], prev = kids[1];
    var next = kids[kids.length - 2], last = kids[kids.length - 1];
    kids.forEach(function (k) { if (k !== first && k !== prev && k !== next && k !== last) k.remove(); });

    function numBtn(n) {
      var b = document.createElement('button');
      b.className = 'dex-mk-pgbtn' + (n === pageNo ? ' active' : '');
      b.textContent = String(n);
      b.addEventListener('click', function () { renderPage(h, d, n); });
      return b;
    }
    // ASCENDING. Each insert lands immediately before `next`, so a descending loop stacks the
    // numbers backwards — it shipped once reading "2 1", which the page-2 check caught.
    for (var n = 1; n <= pages; n++) pager.insertBefore(numBtn(n), next);

    function nav(btn, target, disabled) {
      if (!btn) return;
      var clone = btn.cloneNode(true);            // drops any listener a previous render attached
      btn.parentNode.replaceChild(clone, btn);
      clone.disabled = !!disabled;
      clone.style.opacity = disabled ? '.4' : '';
      if (!disabled) clone.addEventListener('click', function () { renderPage(h, d, target); });
    }
    nav(first, 1, pageNo === 1);
    nav(prev, pageNo - 1, pageNo === 1);
    nav(next, pageNo + 1, pageNo === pages);
    nav(last, pages, pageNo === pages);

    // The whole pager is pointless with one page, and the design has no state for that.
    pager.style.display = pages > 1 ? '' : 'none';
  }

  // ---- the filter box ------------------------------------------------------------------------------
  //
  // THIS BOX HAD NEVER BEEN WIRED TO XRP LEDGER DATA. Its only handler was the design's, which
  // filtered the Aptos sample array — so typing in it did not "break" the table, it REPLACED the
  // table with twelve EVM-issued mock rows. Both halves of that were RAZA's report, filed as two
  // separate complaints ("search broken", "these aren't xrpl assets"), and they were one bug.
  //
  // Disabling the mock renderer removes the wrong rows and leaves the box inert, so the handler has
  // to exist here. Matched to Stellar's scope: ticker, issuer name, and issuer address.
  var QUERY = '';

  // ---- sortable columns ----------------------------------------------------------------------------
  //
  // lumoscore.com/trade/stellar sorts on five headers and this build sorted on none — the last thing
  // left in "still not fully like on Stellar" for this table. The STYLING was already here: an
  // inherited stylesheet carries `.dex-mk-table thead th.lx-sortable{cursor:pointer…}`, `.lx-son`
  // for the active column and `.lx-sarrow` for the glyph, complete with a comment explaining which
  // five columns take a click. Only the script that applied those classes was stripped, so the fork
  // had the affordance's CSS and none of its behaviour — the stripped-layer pattern once more.
  //
  // Behaviour read off the live control rather than guessed: the first click on a column sorts
  // DESCENDING, Volume is the default and opens showing ▼, and the rank column RENUMBERS to the
  // current view (sorting Stellar by price gives #1 yBTC, #2 ETH, #3 yETH). I had numbered the
  // filtered view by absolute volume rank on the reasoning that a rank which renumbers is worse than
  // none; Stellar does the opposite, and Stellar is the spec here.
  var SORT = { key: 'v', dir: -1 };

  // Columns in DOM order, so the header wiring and the sort key cannot drift apart.
  var COLS = [
    null,                       // 0 Asset
    { th: 'th-price', key: 'p' },
    { th: 'th-change', key: 'd' },   // ordering by the XRP change matches ordering by the $ change:
    { th: 'th-vol', key: 'v' },      // changeIn() is monotonic in d for a fixed XRP24
    { th: 'th-trades', key: 'x' },
    { th: 'th-tvl', key: 't' },
  ];

  // ======================================================= THE CURATED DROPDOWN (RAZA 2026-10-07)
  //
  // "lets make it a drop down with 3 options (Curated - All, Curated - Stables, LumosCore Mints). By
  // default it lands on Curated - All everytime the page is refreshed."
  //
  // MODE is a plain variable and is deliberately NOT persisted — a page load starts at 'all' because
  // that is what he asked for, and because a filter remembered across visits is how someone ends up
  // staring at an almost-empty table wondering where the market went.
  //
  // "Also know that LumosCore mints doesn't necessarily mean its curated." Kept apart: the mints view
  // replaces the row set rather than filtering it, and its label says LumosCore Mints with no mention
  // of curation. Nothing here marks a mint as verified.
  var MODE = 'all';
  var MODES = [
    ['all', 'Curated — All'],
    ['stables', 'Curated — Stables'],
    ['mints', 'LumosCore Mints']
  ];

  // KEYED ON ISSUER, NOT ON TICKER, for the reason the whole site keys on issuer: this ledger carries
  // several "USD"s and three "RLUSD"s, and a ticker match would list impostors beside Ripple's.
  // Every pair below was read off the live roster with its domain — Ripple, Circle, GateHub, Bitstamp
  // and RippleFox — rather than typed from memory. Fiat-backed gateway issuances count; an unknown
  // gateway on the same ticker does not.
  var STABLES = {};
  [
    ['rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', 'RLUSD'],   // Ripple
    ['rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE', 'USDC'],    // Circle
    ['rcEGREd8NmkKRE8GE424sksyt1tJVFZwu', 'USDC'],     // GateHub
    ['rcvxE9PS9YBwxtGg1qNeewV6ZB3wGubZq', 'USDT'],     // GateHub
    ['rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', 'USD'],      // Bitstamp
    ['rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq', 'USD'],     // GateHub
    ['rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq', 'EUR'],     // GateHub
    ['rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y', 'USD'],     // RippleFox
    ['rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y', 'CNY']      // RippleFox
  ].forEach(function (p) { STABLES[p[0] + '|' + p[1]] = 1; });

  function rowKey(t) { return String((t && t.i) || '') + '|' + String((t && t.n) || '').toUpperCase(); }

  // The chip keeps the design's own class, border and icon — it gains a caret and a menu, nothing
  // more. Styled from the theme's tokens (--surface, --border, --text, --accent) so it inherits light
  // and dark without a second palette, and injected once by id so a re-run cannot stack copies.
  function modeCss() {
    if (document.getElementById('lx-modemenu-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-modemenu-css';
    st.textContent = ''
      + '.lx-modewrap{position:relative;display:inline-flex}'
      + '.lx-modecaret{margin-left:6px;opacity:.75;font-size:10px;line-height:1}'
      + '.lx-modemenu{position:absolute;top:calc(100% + 6px);left:0;z-index:60;min-width:196px;'
      + 'padding:6px;border:1px solid var(--border,#26262c);border-radius:12px;'
      + 'background:var(--surface,#131317);box-shadow:0 18px 40px -22px rgba(0,0,0,.8)}'
      + '.lx-modemenu button{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;'
      + 'border:0;border-radius:8px;background:transparent;color:var(--text,#f6f5f3);'
      + 'font:inherit;font-size:13.5px;font-weight:600;text-align:left;cursor:pointer}'
      + '.lx-modemenu button:hover{background:var(--surface-2,#1a1a1f)}'
      + '.lx-modemenu button[aria-checked="true"]{color:var(--accent,#ea6a2c)}'
      + '.lx-modetick{width:12px;flex:0 0 12px;opacity:0}'
      + '.lx-modemenu button[aria-checked="true"] .lx-modetick{opacity:1}';
    (document.head || document.documentElement).appendChild(st);
  }

  function closeModeMenu() {
    var m = document.querySelector('.lx-modemenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  // The label lives in the chip's own text node, beside the icon the design put there — rewriting the
  // whole chip would throw that icon away.
  function paintModeLabel() {
    var label = (MODES.filter(function (p) { return p[0] === MODE; })[0] || MODES[0])[1];
    [].slice.call(document.querySelectorAll('.dex-mk-filter[data-filter="all"], .mdx-mk-filter[data-filter="all"]'))
      .forEach(function (chip) {
        [].forEach.call(chip.childNodes, function (n) {
          if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim() && !/^\s*$/.test(n.nodeValue)) {
            n.nodeValue = label;
          }
        });
      });
  }

  function applyMode(next) {
    if (MODE === next) return;
    MODE = next;
    paintModeLabel();
    var h = host(), d = window.__lxxTradeData;
    if (!h || !d) return;
    if (MODE === 'mints' && MINTS.state !== 'done') {
      renderPage(h, d, 1);                               // paints "Loading LumosCore mints…"
      loadMints(function () {
        if (MODE !== 'mints') return;                    // moved on while it was in flight
        var hh = host(), dd = window.__lxxTradeData;
        if (hh && dd) renderPage(hh, dd, 1);
      });
      return;
    }
    renderPage(h, d, 1);                                 // page 1: page 3 of a 1-page view is nothing
  }

  function makeModeChip(chip) {
    if (chip.__lxMode) return;
    chip.__lxMode = 1;
    modeCss();
    if (!chip.parentNode) return;
    var wrap = document.createElement('span');
    wrap.className = 'lx-modewrap';
    chip.parentNode.insertBefore(wrap, chip);
    wrap.appendChild(chip);

    var caret = document.createElement('span');
    caret.className = 'lx-modecaret';
    caret.setAttribute('data-logoed', '1');              // the ticker-logo healer repaints short text
    caret.textContent = '▾';
    chip.appendChild(caret);
    chip.setAttribute('aria-haspopup', 'listbox');

    chip.addEventListener('click', function (e) {
      // This chip was a filter button; the design may still have its own handler bound. Taking the
      // click outright is what stops a stale "all" filter racing the dropdown.
      e.preventDefault(); e.stopImmediatePropagation();
      if (document.querySelector('.lx-modemenu')) { closeModeMenu(); return; }
      var menu = document.createElement('div');
      menu.className = 'lx-modemenu';
      menu.setAttribute('role', 'listbox');
      MODES.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-checked', p[0] === MODE ? 'true' : 'false');
        var tick = document.createElement('span');
        tick.className = 'lx-modetick';
        tick.setAttribute('data-logoed', '1');
        tick.textContent = '✓';
        var txt = document.createElement('span');
        txt.setAttribute('data-logoed', '1');
        txt.textContent = p[1];
        b.appendChild(tick); b.appendChild(txt);
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          closeModeMenu();
          applyMode(p[0]);
        });
        menu.appendChild(b);
      });
      wrap.appendChild(menu);
    }, true);

    if (!window.__lxModeDocClose) {
      window.__lxModeDocClose = 1;
      document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && (e.target.closest('.lx-modemenu') || e.target.closest('.lx-modewrap'))) return;
        closeModeMenu();
      }, true);
    }
  }

  // THE MINTS COME FROM OUR OWN PUBLISHED TOML (RAZA: "we're supposed to maintain toml for all
  // lumoscore minted assets on XRPL ... hosted and maintained here: lumoscore.com/.well-known/
  // xrp-ledger.toml"). That file is the record, so this reads it rather than inventing a registry:
  // six tokens today, and a seventh appears here the moment it is added there, with no deploy.
  //
  // None of them are in the top-100-by-volume roster the table otherwise draws — they are new and thin
  // — so this view REPLACES the rows rather than filtering them, fetching each token's figures from
  // the same endpoint the LUMOS row already uses, in the same shape, so they sort and price like any
  // other row.
  var MINTS = { state: 'idle', rows: [] };

  // A currency is its own code up to three characters and 40 hex characters beyond that. The toml
  // writes the human code; the ledger and the endpoint want the encoded one.
  function curHex(code) {
    var s = String(code || '');
    if (s.length <= 3) return s;
    var h = '';
    for (var i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0');
    return (h + '0000000000000000000000000000000000000000').slice(0, 40).toUpperCase();
  }

  // Enough TOML for this file's shape: [[TOKENS]] blocks with issuer and currency. Not a general
  // parser, and it does not pretend to be — anything outside a [[TOKENS]] block is skipped, and a
  // malformed entry is dropped rather than guessed at.
  function parseTomlTokens(text) {
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (s === '[[TOKENS]]') { cur = {}; out.push(cur); return; }
      if (s.charAt(0) === '[') { cur = null; return; }
      if (!cur) return;
      var m = s.match(/^([A-Za-z_]+)\s*=\s*"([^"]*)"/);
      if (m) cur[m[1]] = m[2];
    });
    return out.filter(function (t) { return t.issuer && t.currency; });
  }

  function loadMints(after) {
    if (MINTS.state === 'loading' || MINTS.state === 'done') { after && after(); return; }
    MINTS.state = 'loading';
    fetch('/.well-known/xrp-ledger.toml')
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var toks = parseTomlTokens(txt);
        if (!toks.length) { MINTS.state = 'done'; after && after(); return; }
        return Promise.all(toks.map(function (t) {
          return fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(t.issuer + '-' + curHex(t.currency)))
            .then(function (r) { return r.json(); })
            .then(function (lt) {
              if (!lt || !lt.ok) return null;
              // The LUMOS row's shape, field for field, so every column and the sorter work unchanged.
              return {
                c: lt.currency, i: lt.issuer, n: lt.name || t.currency, u: lt.user || '',
                p: lt.price, d: lt.p24, w: lt.p7, v: lt.vol24, t: lt.tvl, x: lt.trades24,
                hi: lt.hi, lo: lt.lo, m: lt.md5 || '', h: lt.holders,
                vf: 0,                       // a mint is NOT curated — RAZA was explicit about this
                o: lt.origin || ''
              };
            })
            .catch(function () { return null; });
        })).then(function (rows) {
          MINTS.rows = rows.filter(Boolean);
          MINTS.state = 'done';
          after && after();
        });
      })
      .catch(function () { MINTS.state = 'done'; after && after(); });
  }

  function modeRows(d) {
    if (MODE === 'mints') return MINTS.rows;
    if (MODE === 'stables') return d.rows.filter(function (t) { return STABLES[rowKey(t)]; });
    return d.rows;
  }

  function visible(d) {
    var rows = modeRows(d);

    if (QUERY) {
      var q = QUERY.toLowerCase();
      rows = rows.filter(function (t) {
        return String(t.n || '').toLowerCase().indexOf(q) >= 0
          || String(t.u || '').toLowerCase().indexOf(q) >= 0
          || String(t.i || '').toLowerCase().indexOf(q) >= 0;
      });
    } else {
      rows = rows.slice();                       // never sort the source array in place
    }

    var k = SORT.key, dir = SORT.dir;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      // A missing figure is not a zero. Nulls sink to the bottom in BOTH directions, so ascending by
      // volume opens on the smallest real number rather than on a wall of em dashes.
      var xn = (x == null || !isFinite(x)), yn = (y == null || !isFinite(y));
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      return x < y ? -dir : (x > y ? dir : 0);
    });
    return rows;
  }

  function paintSortHeads() {
    var tbl = $('.dex-mk-table');
    if (!tbl) return;
    COLS.forEach(function (c) {
      if (!c) return;
      var th = tbl.querySelector('thead th.' + c.th);
      if (!th) return;
      var on = SORT.key === c.key;
      th.classList.toggle('lx-son', on);
      var ar = th.querySelector('.lx-sarrow');
      if (ar) ar.textContent = on ? (SORT.dir < 0 ? '▼' : '▲') : '⇅';
    });
  }

  // Marks the columns and draws their arrows. The CLICK is claimed in claimRowClicks() — see the note
  // there for why a listener on the header cannot work on this page.
  function wireSort() {
    var tbl = $('.dex-mk-table');
    if (!tbl) return;
    COLS.forEach(function (c) {
      if (!c) return;
      var th = tbl.querySelector('thead th.' + c.th);
      if (!th) return;
      th.classList.add('lx-sortable');
      if (!th.querySelector('.lx-sarrow')) th.appendChild(el('span', 'lx-sarrow', '⇅'));
    });
    paintSortHeads();
  }

  function onSortClick(th) {
    var c = null;
    for (var i = 0; i < COLS.length; i++) {
      if (COLS[i] && th.classList.contains(COLS[i].th)) { c = COLS[i]; break; }
    }
    if (!c) return;
    // Same column flips direction; a new column starts descending, which is what the live one does.
    if (SORT.key === c.key) SORT.dir = -SORT.dir;
    else { SORT.key = c.key; SORT.dir = -1; }

    var h = host(), d = window.__lxxTradeData;
    if (h && d && d.rows) renderPage(h, d, 1);
  }

  function wireSearch(h, d) {
    var input = $('#dexMkSearch') || $('#mdxMkSearch');
    if (!input || input.getAttribute('data-lxq') === '1') return;
    input.setAttribute('data-lxq', '1');
    input.addEventListener('input', function () {
      QUERY = String(input.value || '').trim();
      renderPage(h, d, 1);                 // back to page 1: page 4 of a 2-page result is nothing
    });
  }

  function renderPage(h, d, n) {
    var rows = visible(d);
    var total = rows.length;
    paintSortHeads();

    // A filter that matches nothing is a real answer and needs to say so, rather than leaving the
    // last result on screen looking like a match.
    if (!total) {
      // Mode-aware, because "No pair matches" is wrong for an empty view that has no query in it —
      // and wrong again while the mints are still being fetched, which reads as "there are none".
      note(h, MODE === 'mints' && MINTS.state !== 'done' ? 'Loading LumosCore mints…'
        : MODE === 'mints' ? 'No LumosCore mints are listed yet.'
        : QUERY ? ('No pair matches “' + QUERY + '”.')
        : MODE === 'stables' ? 'No stablecoins in the current market data.'
        : 'No pairs to show.');
      setPageInfo(0, 0, 0);
      buildPager(h, d, 1);
      return;
    }

    // NO PAGER, NO PAGING. The phone build has no .dex-mk-pager at all — checked on the served
    // page at 375px: pagerPresent false, a card list and no table. Paging a list with no controls
    // would have hidden rows 51-100 behind a button that does not exist, which is worse than what
    // was there before this change (it fetched 50 and showed all 50). So the phone shows the whole
    // hundred and the desktop pages them.
    var paged = !!$('.dex-mk-pager');
    var per = paged ? PER : total;
    var pages = Math.max(1, Math.ceil(total / per));
    pageNo = Math.min(Math.max(1, n), pages);

    var from = (pageNo - 1) * per;
    var to = Math.min(from + per, total);

    h.node.innerHTML = '';
    var make = h.kind === 'table' ? row : mkCard;
    // The rank passed through is the ABSOLUTE position, so page 2 starts at #51 rather than
    // restarting at #1 — the number means "51st by volume", not "first row I drew".
    // Rank is the position in the CURRENT view, renumbering on sort and on filter, because that is
    // what the live Stellar table does — checked by clicking its Last Price header.
    for (var i = from; i < to; i++) h.node.appendChild(make(rows[i], i + 1, d.usd));

    setPageInfo(from + 1, to, total);
    buildPager(h, d, pages);

    // Only the rows actually on screen. Asking for all hundred when fifty are shown would double
    // the upstream cost of a page nobody is looking at yet; page 2 fetches its own when opened, and
    // the edge cache makes the second visit free.
    if (h.kind === 'table') loadSparks(rows.slice(from, to));
  }

  // THE CONTROLS ROW, AGAINST lumoscore.com AS THE REFERENCE.
  //
  // Three separate faults, all visible in the strip beside "All Trading Pairs".
  //
  // 1. LAUNCH TOKEN WAS IN THE PAGE AND UNREACHABLE. The `.lx-dctas` block — "How it works?" and
  //    "Launch Token" — exists here with a correct /launchpad href, but it is nested inside
  //    `.dex-overview`, and an inherited script unconditionally stamps `lx-dexhero-off` on that
  //    element, which is `display:none`. On Stellar the same script runs and the block is still
  //    visible, because Stellar's markup has it in `.dex-mk-controls` instead. This is the stale
  //    container again: the fork carries the OLD design, where these buttons lived in the hero.
  //    Moved to where the reference has them. Not new UI — the same nodes, re-parented.
  //
  // 2. THE FILTER CHIP WORE STELLAR'S LOGO. It ships `<img src="/assets/tokens/xlm.png">`, and
  //    /assets/tokens holds Stellar assets only — there is no xrp.png to point at. The XRP mark
  //    comes from the thumb endpoint under xrpl.to's fixed id for XRP, the same source bridge.js
  //    already uses for it.
  //
  // 3. THE SEARCH PLACEHOLDER RAN LONG AND TRUNCATED. Stellar reads "Filter curated pairs" and
  //    fits; this read "Filter pairs · ticker or address" and was cut off mid-word in the same
  //    width. Shortened to match. The wording is a judgement call — say the word and it changes.
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  // This project's own token, which the market's top hundred does not carry yet.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var LUMOS_CUR = '4C554D4F53000000000000000000000000000000';

  // ---- the $ / XRP denomination toggle -------------------------------------------------------------
  //
  // Stellar's markup ships this control; ours does not. `.lx-dnsw` exists in this build as CSS ONLY,
  // because Stellar's own dex layer BUILDS the element at runtime and that layer is stripped here —
  // so the styling was inherited and the thing it styles never existed. Built here to match, which
  // is why it needs no CSS of its own.
  //
  // What it actually does, established by clicking the real one rather than guessing from the
  // aria-label: the price cell swaps its headline and sub-line, the 24h change becomes a DIFFERENT
  // NUMBER computed in the chosen denomination, and the two column headers relabel. Nothing else in
  // the table moves — volume, liquidity and high/low stay as they are on Stellar too.
  // Dollars first, because that is what lumoscore.com/trade/stellar does: read off the live control
  // there, the `$` button carries `.on` and `XLM` does not. This build had it the other way round.
  //
  // The cost is a visible one and worth stating: a token's change IN DOLLARS needs XRP's own 24h move,
  // which arrives on a second request, so the 24h column reads em dashes until it lands (and keeps
  // reading them if it never does). The alternative — printing the XRP-denominated change under a $
  // heading — is a wrong number rather than a missing one, so the gap stays.
  //
  // CORRECTED 2026-09-15: that reading was wrong. Stellar's default is XLM — `denom()` in its dex layer
  // returns "xlm" unless `lumos.dexDenom` says otherwise — and the "$ on" observation above was a
  // remembered choice in that browser's storage. So XRP leads here, and the choice is remembered under
  // the same key, exactly as there. RAZA saw the mismatch as "a font color and size difference".
  var DEN = 'xrp';
  try { var _dn = localStorage.getItem('lumos.dexDenom'); if (_dn === 'usd' || _dn === 'xrp') DEN = _dn; } catch (e) {}

  // XRP's own 24h move, needed to express a token's change in dollars. Without it the $ column
  // would silently show the XRP-denominated number under a $ heading, which is worse than not
  // having the toggle at all — so `changeIn` returns null and the cell reads an em dash instead.
  var XRP24 = null;

  function changeIn(d) {
    if (DEN !== 'usd') return d;
    if (d == null || XRP24 == null) return null;
    // Composed, not added: a token up 10% against an XRP that is down 5% is not up 5% in dollars.
    return ((1 + d / 100) * (1 + XRP24 / 100) - 1) * 100;
  }

  function denomLabel() { return DEN === 'usd' ? '($)' : '(XRP)'; }

  function buildDenToggle(h, d) {
    var controls = $('.dex-mk-controls');
    if (!controls || $('.lx-dnsw')) return;

    var wrap = el('div', 'lx-dnsw');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Show price change in');

    function mk(mode, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dn', mode);
      b.textContent = label;
      b.addEventListener('click', function () {
        if (DEN === mode) return;
        DEN = mode;
        paintDenToggle();
        headers();
        renderPage(h, d, pageNo);              // same page, re-denominated
      });
      return b;
    }
    wrap.appendChild(mk('usd', '$'));
    wrap.appendChild(mk('xrp', 'XRP'));

    // After the filter chips and before the search box, which is where Stellar has it. The previous
    // version looked up `#dexMkSearch` — the INPUT, whose parent is `.dex-mk-search` and never
    // `.dex-mk-controls` — so the ownership test failed every time and the toggle silently fell
    // through to appendChild, landing after the search box instead of before it. The wrapper is what
    // sits in the controls row, so that is what to measure against.
    var search = $('.dex-mk-search');
    if (search && search.parentNode === controls) controls.insertBefore(wrap, search);
    else controls.appendChild(wrap);

    paintDenToggle();
  }

  function paintDenToggle() {
    var btns = document.querySelectorAll('.lx-dnsw button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-dn') === DEN;
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      btns[i].classList.toggle('on', on);      // `.lx-dnsw button.on` is already styled here
    }
  }

  function fixControls() {
    var ctas = $('.lx-dctas');
    var controls = $('.dex-mk-controls');
    if (ctas && controls && !controls.contains(ctas)) {
      // First child, which is where Stellar has it: ahead of the chips and the search box.
      controls.insertBefore(ctas, controls.firstChild);
    }

    // FOUR DEAD CHIPS. Stables / Memes / Utility filter on `p.cat`, a field that exists only on the
    // design's Aptos sample rows — no XRP Ledger token carries it, so each of these can only ever
    // produce an empty table. "LumosCore native" has no meaning here either. lumoscore.com/trade/stellar
    // removes exactly these four and leaves one chip standing; read off the live control, its filter
    // row holds a single button. Matched here, same kill list.
    //
    // The label stays "All" rather than Stellar's "Curated": that row is Stellar's curated list, and
    // this one is the top of the XRP Ledger market by volume. Copying the word would be copying a
    // claim, not a layout.
    var kill = { native: 1, stables: 1, memes: 1, utility: 1 };
    var chips = document.querySelectorAll('.dex-mk-filter, .mdx-mk-filter');
    for (var c = 0; c < chips.length; c++) {
      var f = (chips[c].getAttribute('data-filter') || '').toLowerCase();
      if (kill[f] && chips[c].parentNode) chips[c].parentNode.removeChild(chips[c]);
    }
    // If the chip that was active happened to be one of the four, nothing is selected and the row
    // reads as having no state at all. Stellar guards the same way.
    if (!$('.dex-mk-filter.active, .mdx-mk-filter.active')) {
      var first = $('.dex-mk-filter, .mdx-mk-filter');
      if (first) first.classList.add('active');
    }

    // Hidden on Stellar — `getComputedStyle(#dexHiwBtn).display` is "none" there, so the row opens
    // with Launch Token and nothing else. Here it was showing the full "How it works?" anchor, which
    // is the extra element in RAZA's "Launch Token All Filter pairs $ XRP". Hidden rather than
    // removed, and given a title, so whatever is bound to it survives.
    var hiw = $('#dexHiwBtn');
    if (hiw) {
      hiw.style.display = 'none';
      if (!hiw.getAttribute('title')) {
        hiw.setAttribute('title', 'How it works');
        hiw.setAttribute('aria-label', 'How it works');
      }
    }

    var chipImg = $('.dex-mk-filter img');
    if (chipImg && /xlm\.png/i.test(chipImg.getAttribute('src') || '')) {
      chipImg.setAttribute('src', XRP_LOGO);
      chipImg.setAttribute('alt', '');
    }
    // SAME BOX, SMALLER MARK. Both builds draw this image at 22px, but Stellar's xlm.png is a thin glyph
    // with room around it while xrpl.to's XRP thumb is a solid disc edge to edge — so at the same size the
    // XRP mark reads visibly bigger (RAZA 2026-09-15). Inset to 16px inside the unchanged 22px slot.
    if (chipImg && chipImg.getAttribute('src') === XRP_LOGO) {
      chipImg.style.cssText = 'width:16px!important;height:16px!important;margin:3px;border-radius:50%';
    }

    // "CURATED", AS ON STELLAR — RAZA 2026-09-15, reversing the earlier "All". The chip's text is the
    // text node after its icon, so only that node is rewritten and the icon stays.
    // (No $$ helper in this file — an undefined one threw here and stopped the whole table rendering.)
    //
    // Since 2026-10-07 that text is the dropdown's label rather than a fixed word, so it is written
    // from MODES and kept in sync by paintModeLabel().
    [].slice.call(document.querySelectorAll('.dex-mk-filter, .mdx-mk-filter')).forEach(function (chip) {
      if ((chip.getAttribute('data-filter') || '').toLowerCase() !== 'all') return;
      makeModeChip(chip);
    });
    paintModeLabel();

    var search = $('#dexMkSearch input') || $('#dexMkSearch');
    if (search && 'placeholder' in search) search.placeholder = 'Filter curated pairs';
  }

  // ---- 7d sparklines ------------------------------------------------------------------------------
  //
  // This column showed a bare percentage where lumoscore.com draws a curve. The comment at the top
  // of this file used to say sparklines were omitted deliberately because the feed gives a 7d
  // PERCENTAGE and not a series — true of the bulk response, and I checked every one of its ~150
  // fields again before building this. The series exists, just on a different upstream route, and
  // /lxapi/xrplspark batches it: one browser request for the whole page instead of fifty.
  //
  // Drawn with the design's own markup, copied from a real Stellar row:
  //     <svg class="dex-mk-spark" viewBox="0 0 88 28" preserveAspectRatio="none"><path d="…"></svg>
  // so it inherits the column's sizing and needs no CSS of its own.
  //
  // A row whose series does not arrive KEEPS ITS PERCENTAGE. Nothing is blanked on the way to being
  // drawn, and a token too thin to have a week of history simply stays as it was.
  function sparkPath(vals, w, h) {
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min;
    // A perfectly flat series has no range to scale into; draw it down the middle rather than
    // dividing by zero and sending NaN into the path.
    var mid = h / 2;
    var d = '';
    for (var i = 0; i < vals.length; i++) {
      var x = (i / (vals.length - 1)) * w;
      var y = span > 0 ? h - ((vals[i] - min) / span) * h : mid;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  function drawSpark(cell, vals, up) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'dex-mk-spark');
    svg.setAttribute('viewBox', '0 0 88 28');
    svg.setAttribute('preserveAspectRatio', 'none');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', sparkPath(vals, 88, 28));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-width', '1.5');
    // Coloured by the week's direction, which is what the number beside it used to say.
    p.setAttribute('stroke', up ? 'var(--green,#22c55e)' : '#e5484d');
    svg.appendChild(p);
    cell.innerHTML = '';
    cell.appendChild(svg);
  }

  // Series already fetched this page-load, keyed by token id. Without it every keystroke in the
  // filter box and every page-button click re-requested the same curves — cheap at the edge, but the
  // edge is not the budget that matters: xrpl.to allows 333 requests a DAY per IP and this layer is
  // the one thing on the site that can spend them in bursts.
  var SPARKS = {};

  function fillPct() {
    [].forEach.call(document.querySelectorAll('.dex-mk-change[data-lxpct]'), function (w) {
      if (!w.textContent) w.textContent = w.getAttribute('data-lxpct');
    });
  }

  function loadSparks(rows) {
    setTimeout(fillPct, 9000);                                   // a request that never answers still ends in a figure
    var byId = {};
    for (var i = 0; i < rows.length; i++) {
      if (/^[0-9a-f]{32}$/i.test(rows[i].m || '')) byId[rows[i].m.toLowerCase()] = rows[i];
    }
    var ids = Object.keys(byId).filter(function (id) { return !SPARKS[id]; });

    // Whatever is already known is drawn immediately, so a re-render does not blank curves it has.
    paintSparks(SPARKS, byId);
    if (!ids.length) { fillPct(); return; }

    fetch('/lxapi/xrplspark?ids=' + ids.join(','))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.series) return;
        for (var id in d.series) SPARKS[id] = d.series[id];
        paintSparks(d.series, byId);
      })
      .catch(function () {})
      .then(fillPct);                                            // rows with no series get their percentage
  }

  function paintSparks(series, byId) {
    for (var id in series) {
      var t = byId[id];
      if (!t) continue;
      // The row is found by the ticker+issuer stamped on it when it was built, so this cannot
      // paint a curve into the wrong row after a re-sort or a page change.
      var tr = $('tr[data-tkr="' + (window.CSS && CSS.escape ? CSS.escape(t.n) : t.n)
        + '"][data-iss="' + t.i + '"]');
      if (!tr || tr.children.length < 8) continue;
      var vals = series[id];
      if (!vals || vals.length < 2) continue;
      drawSpark(tr.children[7], vals, vals[vals.length - 1] >= vals[0]);
    }
  }

  function headers() {
    // THE TRADES COLUMN HAD A CELL IN EVERY ROW AND NO HEADER.
    //
    // The design's static markup ships eight th's and no Trades column; on Stellar a layer inserts
    // it at runtime, which is why lumoscore.com/trade/stellar shows nine headers over nine cells.
    // This layer emits a trades cell (c4, between volume and liquidity) and never added the header,
    // so the table ran 8 headers over 9 cells and every label from Liquidity rightward sat one
    // column left of its data — "Liquidity" over the trade count, "7d Trend" over the high/low, and
    // the 7d percentage under no header at all. That is the messed-up right-hand side.
    //
    // The class already carries `th-trades{text-align:right!important}` in the design stylesheet,
    // so this is restoring a column the design accounted for, not adding one.
    var tbl = $('.dex-mk-table');
    if (tbl && !tbl.querySelector('th.th-trades')) {
      var volTh = tbl.querySelector('th.th-vol');
      if (volTh && volTh.parentNode) {
        var tth = document.createElement('th');
        tth.className = 'th-trades';
        tth.textContent = 'Trades (24h)';
        volTh.parentNode.insertBefore(tth, volTh.nextSibling);
      }
    }

    // Price and change follow the denomination toggle; high/low does NOT, because it does not on
    // Stellar either — its header still reads (XLM) in $ mode.
    var map = { 'th-price': 'Last Price ' + denomLabel(), 'th-change': '24h Change ' + denomLabel(),
      'th-hl': 'Day High / Low (XRP)' };
    for (var k in map) {
      var th = $('.dex-mk-table th.' + k);
      if (!th) continue;
      // keep any sort-arrow element the page appended; replace only the label text node
      var replaced = false;
      for (var i = 0; i < th.childNodes.length; i++) {
        if (th.childNodes[i].nodeType === 3 && th.childNodes[i].textContent.trim()) {
          th.childNodes[i].textContent = map[k]; replaced = true; break;
        }
      }
      if (!replaced) th.textContent = map[k];
    }
  }

  // ATTRIBUTION. Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10.
  //
  // What changed in between was the evidence, not the opinion. The first removal was decided against
  // a note of mine saying attribution was "contractually required". The next day, building the
  // sparklines, xrpl.to's own API returned this in its response body, verbatim:
  //
  //     Required: display a visible link to https://xrpl.to on any surface showing this data —
  //     [an anchor to https://xrpl.to reading "Data by xrpl.to"]. Terms: https://xrpl.to/docs
  //
  // The anchor is DESCRIBED rather than quoted on purpose: written out as a real tag, this comment
  // shipped inside the page's inline script and the predeploy gate counted it as an outgoing link
  // with no rel="nofollow" — on three dex pages, blocking a deploy for a link that does not exist.
  // The gate is right to scan the served HTML and was left strict; the comment is what moved.
  //
  // That is the provider stating the condition itself, and by then this page was showing MORE of
  // their data than when it came out — the whole 7d sparkline column arrives from them.
  //
  // So it is back, and the endpoints were left returning `attribution` / `attributionUrl` through
  // the removal, which is why restoring it is this one function rather than an archaeology exercise.
  function attribution(d) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var host = $('.dex-mk-foot') || $('.dex-mk-table-wrap');
    if (!host) return;
    var p = el('p'); p.id = 'lxx-attr-dex';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Market data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // The design carries an anti-flash gate from the Stellar build:
  //     #dexMkTbody:not(.lxd) tr { visibility: hidden }
  // and the class was added by `lx-dexmain` once it had painted. That script is stripped now, but
  // its STYLE block (lx-dexmain-css) is a separate element and survives -- so without this, every
  // row is laid out at the right size with the right text and simply never appears. Same failure the
  // wallet page had. Called before the first note(), so the loading row is visible too.
  function lift() {
    var tb = $('#dexMkTbody');
    if (tb) tb.classList.add('lxd');
  }

  // The MOBILE page hides the real list and shows a skeleton instead, switched by a body class:
  //     body:not(.lxmd-ready) .mdx-mk-list { display: none !important }
  //     body:not(.lxmd-ready) .lxmd-skel   { display: block }
  // `lx-dexmain` set that class once it had data. Stripping it left the skeleton on screen forever
  // with 50 correct, invisible cards behind it -- the third gate of this shape in this project, and
  // the second that survives as CSS after its script is gone.
  //
  // Called when the fetch SETTLES rather than at start, so the skeleton keeps doing its job during
  // the load instead of flashing an empty list, and an error still ends up visible.
  function reveal() {
    try { document.body.classList.add('lxmd-ready'); } catch (e) {}
    faqRelease();
  }

  // THE TRADE PAGE'S FAQ WAS INVISIBLE, NOT MISSING (RAZA 2026-10-06: "XRPL is missing out FAQs on
  // many pages like trade main page").
  //
  // The inherited stylesheet carries `html:not(.lx-dexlate) .lx-faq{visibility:hidden}` — Stellar's
  // anti-flash gate, which stops the FAQ painting at the top of a page whose table has not arrived.
  // Stellar's `_dexdata.js` opens it from its own render; this build's trade layer is ours and never
  // added the class, so the gate stayed shut forever. `visibility`, not `display`, so the section
  // kept its full 2252px of height: a tall band of nothing below the pager, which reads as a missing
  // FAQ rather than a hidden one. Measured, not guessed — it is three page keys (dex, -dark,
  // -mobile) and no others. [[lumoscore-stripped-layer-css]], [[lumoscore-xrpl-inherited-gates]]
  //
  // Released on reveal() so it follows the content, and unconditionally after two seconds so a page
  // whose data never arrives still shows its FAQ — the same two triggers Stellar uses. Idempotent:
  // the class is only ever added.
  function faqRelease() {
    try { document.documentElement.classList.add('lx-dexlate'); } catch (e) {}
  }
  try { setTimeout(faqRelease, 2000); } catch (e) {}

  // Whichever list this page has. Both are never present at once: they are different page builds,
  // not a media-query pair, so there is no hidden-container problem here the way there was on the
  // wallet page.
  function host() {
    var t = $('#dexMkTbody');
    if (t) return { node: t, kind: 'table' };
    var l = $('#mdxMkList');
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 9;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function load() {
    var h = host();
    if (!h) return;                                    // not the Trade page
    headers();
    fixControls();
    lift();
    claimRowClicks();
    note(h, 'Reading the XRP Ledger…');

    // n=100, which is the endpoint's own ceiling — the worker takes one upstream page of 100 and
    // clamps with Math.min(100, ...). It is also parity with Stellar: lumoscore.com/trade/stellar
    // shows exactly two pages of 50, so matching it costs no extra upstream request. Asking for
    // more would mean additional pages against xrpl.to's 333-a-day budget, which is a bigger
    // decision than a pager.
    // ASKED AGAIN BEFORE GIVING UP (RAZA 2026-09-17: "sometimes i get this error when i open trade main page"). One refused
    // read emptied the whole market table; the upstream's daily cap makes that a matter of when, not if. The endpoint also
    // serves its last good answer when the live one fails, so this usually gets rows either way.
    (function ask(tries) {
      return fetch('/lxapi/xrpltokens?n=100').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok && d.rows && d.rows.length) return d;
        if (tries > 0) {
          return new Promise(function (res) { setTimeout(res, 1200 * (4 - tries)); }).then(function () { return ask(tries - 1); });
        }
        return d;
      }, function () {
        return tries > 0
          ? new Promise(function (res) { setTimeout(res, 1200 * (4 - tries)); }).then(function () { return ask(tries - 1); })
          : null;
      });
    })(3).then(function (d) {
      reveal();
      if (!d || !d.ok || !d.rows.length) { note(h, 'Market data is unavailable right now.'); return; }
      window.__lxxTradeData = d;

      // LUMOS IS ALWAYS IN THIS TABLE (RAZA 2026-09-17: "Add LUMOS to the curated assets on Trade main page"). The rows are
      // the market's top hundred by volume and LUMOS does not trade its way in yet, so it was simply absent from the page
      // that lists what this platform trades. Its row is fetched on its own and folded in — the same fields, from the same
      // upstream, so it sorts and prices exactly like every other row rather than being pinned on top as a special case.
      if (!d.rows.some(function (t) { return t.i === LUMOS_ISS; })) {
        // The endpoint keys on the upstream's own id form, "issuer-currencyHex" — it takes no iss/cur pair.
        fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(LUMOS_ISS + '-' + LUMOS_CUR))
          .then(function (r) { return r.json(); })
          .then(function (lt) {
            if (!lt || !lt.ok || !(lt.price > 0)) return;
            d.rows.push({
              c: lt.currency, i: lt.issuer, n: lt.name || 'LUMOS', u: lt.user || '',
              p: lt.price, d: lt.p24, w: lt.p7, v: lt.vol24, t: lt.tvl, x: lt.trades24,
              hi: lt.hi, lo: lt.lo,
              m: lt.md5 || '', h: lt.holders, vf: 1, o: lt.origin || ''
            });
            renderPage(h, d, pageNo);
          })
          .catch(function () {});
      }

      // XRP's own 24h move, for the dollar-denominated change column. Fire-and-forget: the toggle
      // is usable immediately in XRP mode, and if this never lands the $ column shows em dashes
      // rather than the XRP number wearing a $ heading.
      fetch('/lxapi/xrplprices?codes=XRP')
        .then(function (r) { return r.json(); })
        .then(function (pj) {
          var e = pj && pj.t && pj.t.XRP;
          if (e && isFinite(e[1])) XRP24 = Number(e[1]);
          if (DEN === 'usd') renderPage(h, d, pageNo);
        })
        .catch(function () {});

      buildDenToggle(h, d);
      wireSearch(h, d);
      wireSort();
      renderPage(h, d, 1);

      var grid = $('#dexMoverGrid') || $('#mdxMoverList');
      if (grid) {
        // Ranked by absolute 24h move among tokens that actually trade. The floor is doing real
        // work: measured on live data, a 500 XRP floor put "EATASS +361%" at the top of the page on
        // 1,693 XRP of volume -- about $2.4K, one fill moving a dust token. At 5,000 the list is
        // XRPH +33% and GATOR +18%, which are real moves; at 20,000 it flattens to +/-2% and stops
        // being a movers list at all.
        var top = d.rows.filter(function (t) { return t.d != null && t.v != null && t.v >= 5000; })
          .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); })
          .slice(0, 10);
        grid.innerHTML = '';
        for (var j = 0; j < top.length; j++) grid.appendChild(mover(top[j], d.usd));
      }

      attribution(d);
    }).catch(function () { reveal(); note(h, 'Market data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxTradeReload = load;
})();

