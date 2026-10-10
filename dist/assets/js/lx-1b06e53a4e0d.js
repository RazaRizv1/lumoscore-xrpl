
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

// Account page: any XRP Ledger account, by address in the URL.
//
// `lx-accdata` required a Stellar G-address, so on /account/xrpl/<r-address> it printed "No Stellar address in this link."
// and stopped. This reads the XRP Ledger directly — account_info, account_lines, account_tx, amm_info — and writes into
// the page's own markup.
//
// STELLAR'S PUBLIC WALLET PAGE, ROW FOR ROW (RAZA 2026-09-15: "Too many issues on Public-wallet page. Compare it with Stellar
// public wallet page"). Read off lumoscore.com/account/stellar/…:
//   * the header shows the FULL address, an identicon avatar with the network's logo as a small badge (the badge used to
//     hold the words "XRP Ledger", which overflowed it), and "Active since <month> · Explorer" beneath;
//   * each stat carries its second line — "Estimated value", the native balance in dollars, "N trustlines held", "none";
//   * asset rows are `.acc-row` with a logo, the code over its issuer ("rDFX—ivmN", or "Native asset"), the balance and a
//     dollar value, and open the token's trade page;
//   * activity rows are `.activity-row`: an icon, what happened, how long ago, the amounts in and out, and an explorer link.
(function () {
  if (window.__lxxAccount) return;
  window.__lxxAccount = 1;

  var RPC = 'https://xrplcluster.com/';
  var RIPPLE_EPOCH = 946684800;
  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  var EXT_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var ICONS = {
    receive: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>',
    swap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>',
    lp: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
    settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    other: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>',
    order: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;      // ledger-supplied names are arbitrary bytes
    return e;
  }

  function bal(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : (v >= 1 ? 4 : 7) });
  }
  function money(v) {
    if (!(v > 0)) return '$0.00';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function short(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
  function issShort(a) { return a && a.length > 10 ? a.slice(0, 4) + '—' + a.slice(-4) : (a || ''); }
  function ago(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function curName(c) {
    if (!c || c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(c).display; } catch (e) { return String(c).slice(0, 6); }
  }
  function thumb(t) {
    return t ? ('/lxapi/xrplthumb?iss=' + encodeURIComponent(t.issuer) + '&cur=' + encodeURIComponent(t.currency) + '&w=48') : XRP_LOGO;
  }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res) throw new Error('ledger unavailable');
      return res;
    });
  }

  // /account/xrpl/<r-address>
  function fromUrl() {
    var parts = window.location.pathname.replace(/\/+$/, '').split('/');
    var last = decodeURIComponent(parts[parts.length - 1] || '');
    try { return window.lxx.isAddress(last) ? last : null; } catch (e) { return null; }
  }

  // The cell is <span class=l>label</span><b class=v>main</b><span class=s>sub</span>.
  function setStat(match, value, sub) {
    var host = $('#accStats');
    if (!host) return;
    var cells = host.children;
    for (var i = 0; i < cells.length; i++) {
      var l = cells[i].querySelector('.l');
      if (!l || (l.textContent || '').toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.v') || cells[i].querySelector('.val');
      if (v && value != null) v.textContent = value;
      var s = cells[i].querySelector('.s');
      if (s && sub != null) s.textContent = sub;
      return;
    }
  }

  function tableNote(tbl, text, cols) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    var tr = document.createElement('tr');
    var td = el('td', null, text);
    td.colSpan = cols || 3;
    td.style.cssText = 'padding:22px 12px;text-align:center;opacity:.7';
    tr.appendChild(td);
    tbl.appendChild(tr);
  }

  // ---- header ----------------------------------------------------------------------------------------
  function paintHeader(a) {
    var addrEl = $('#accAddr');
    if (addrEl) { addrEl.textContent = a; addrEl.setAttribute('title', a); }
    var av = $('#accAvatar');
    if (av && window.lxIdent) {
      try {
        var sv = String(window.lxIdent(a, 64));
        if (sv.indexOf('xmlns=') < 0) sv = sv.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');   // required in a data URI
        av.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(sv) + '")';
        av.style.backgroundSize = 'cover';
      } catch (e) {}
    }
    var net = $('#accNet');
    if (net) {
      net.textContent = '';
      net.setAttribute('title', 'XRP Ledger');
      net.style.backgroundImage = 'url("' + XRP_LOGO + '")';
    }
    var sub = $('#accSub');
    if (sub) {
      sub.textContent = '';
      sub.appendChild(el('span', 'lx-accsince', ''));
      var ex = el('a', null, 'Explorer ');
      ex.href = 'https://bithomp.com/explorer/' + encodeURIComponent(a);
      ex.target = '_blank';
      ex.rel = 'noopener nofollow';
      ex.insertAdjacentHTML('beforeend', EXT_SVG);
      sub.appendChild(ex);
    }
  }

  // ---- assets ----------------------------------------------------------------------------------------
  // LOGOS, A FEW AT A TIME, WITH A PLACEHOLDER WHEN THERE IS NONE (RAZA 2026-09-16: "If there's no logo to show, then show a
  // placeholder logo like we're doing on Stellar. Also in public wallet page, some asset logos are not loading"). A wallet of
  // a hundred tokens asked for a hundred logos at once and the upstream answered most of them 429, leaving blank circles.
  var LOGO_Q = [], LOGO_RUN = 0, LOGO_OK = {};
  function placeholder(code) {
    var ch = String(code || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
    var hh = 0, s0 = String(code || '');
    for (var i = 0; i < s0.length; i++) hh = (hh * 31 + s0.charCodeAt(i)) % 360;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="hsl(' + hh + ',48%,40%)"/>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="800" fill="#fff">' + ch + '</text></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }
  // THREE LEDGER READS AT A TIME, EACH TRIED TWICE (RAZA 2026-09-16: "Still not fixed: On public wallet page, pools tab" — 19 positions
  // asked for 19 amm_info at once, the public node dropped most, and those rows stayed "AMM pool" with no figures).
  var RQ = [], RRUN = 0;
  function slowRpc(method, params) {
    return new Promise(function (resolve, reject) {
      RQ.push(function () {
        RRUN++;
        rpc(method, params).catch(function () {
          return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return rpc(method, params); });
        }).then(function (r) { RRUN--; pump(); resolve(r); }, function (e) { RRUN--; pump(); reject(e); });
      });
      pump();
    });
    function pump() { while (RRUN < 3 && RQ.length) RQ.shift()(); }
  }

  function queueLogo(node, url, code) {
    if (!node) return;
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center';
    if (LOGO_OK[url] === true) { node.style.backgroundImage = 'url("' + url + '")'; return; }
    if (LOGO_OK[url] === false) { node.style.backgroundImage = placeholder(code); return; }
    LOGO_Q.push([node, url, code]);
    pumpLogos();
  }
  function pumpLogos() {
    while (LOGO_RUN < 5 && LOGO_Q.length) {
      (function (job) {
        LOGO_RUN++;
        var im = new Image(), tries = 0;
        function done(ok) {
          LOGO_RUN--;
          LOGO_OK[job[1]] = ok;
          job[0].style.backgroundImage = ok ? 'url("' + job[1] + '")' : placeholder(job[2]);
          pumpLogos();
        }
        im.onload = function () { done(true); };
        im.onerror = function () {
          if (++tries < 2) { setTimeout(function () { im.src = job[1] + '&r=' + tries; }, 1500); return; }
          done(false);
        };
        im.src = job[1];
      })(LOGO_Q.shift());
    }
  }

  // COPY, QR AND "SEND TO THIS WALLET" (RAZA 2026-09-16: "copy icon, barcode, and send to this wallet on right is not working").
  // Stellar's own three: copy with the site's toast, the address as a QR in the design's .acc-qrpop, and the wallet page's
  // Send dialog opened with this address in it.
  function wireAccActions(a) {
    var qb = $('#accQr');
    if (qb && !qb.__lxx) {
      qb.__lxx = 1;
      var build = function () {
        if (qb.querySelector('.acc-qrpop') || !window.qrcode) return;
        var q2 = null, lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
        for (var i = 0; i < lv.length; i++) { try { var t = window.qrcode(lv[i][0], lv[i][1]); t.addData(a); t.make(); q2 = t; break; } catch (e) {} }
        if (!q2) return;
        var n = q2.getModuleCount(), pad = 2, size = n + pad * 2, sq = '';
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q2.isDark(y, x)) sq += '<rect x="' + (x + pad) + '" y="' + (y + pad) + '" width="1" height="1"></rect>';
        var pop = el('div', 'acc-qrpop');
        pop.innerHTML = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + size + '" height="' + size + '" fill="#fff"></rect><g fill="#000">' + sq + '</g></svg>';
        pop.appendChild(el('div', 'cap', short(a)));
        qb.appendChild(pop);
      };
      qb.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); build(); qb.classList.toggle('on'); });
      qb.addEventListener('mouseenter', build);
      document.addEventListener('click', function (ev) { if (!qb.contains(ev.target)) qb.classList.remove('on'); }, true);
    }
    var sb = $('#accSend');
    if (sb && !sb.__lxx) {
      sb.__lxx = 1;
      sb.setAttribute('href', '/wallet?to=' + encodeURIComponent(a));
      sb.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = '/wallet?to=' + encodeURIComponent(a);
      }, true);
    }
    var cp = $('#accCopy');
    if (cp && !cp.__lxx) {
      cp.__lxx = 1;
      cp.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        try { navigator.clipboard.writeText(a); } catch (x) {}
        try { if (typeof window.showToast === 'function') window.showToast('Wallet address copied'); } catch (x) {}
      }, true);
    }
  }

  function assetRow(code, issLabel, balance, logo, key, href) {
    var tr = document.createElement('tr');
    tr.className = 'acc-row';
    tr.setAttribute('data-lxkey', key);
    var c0 = el('td');
    var pair = el('span', 'acc-pair');
    var ico = el('span', 'acc-ico');
    ico.setAttribute('data-logoed', '1');
    queueLogo(ico, logo, code);
    pair.appendChild(ico);
    var txt = el('span');
    var cd = el('span', 'acc-code', code);
    cd.setAttribute('data-logoed', '1');
    txt.appendChild(cd);
    txt.appendChild(el('span', 'acc-iss', issLabel));
    pair.appendChild(txt);
    c0.appendChild(pair);
    tr.appendChild(c0);
    tr.appendChild(el('td', 'num', bal(balance)));
    tr.appendChild(el('td', 'num acc-val', ''));
    if (href) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { window.location.href = href; });
    } else {
      // NOTHING TO OPEN (RAZA 2026-09-16: "the native asset should be unclickable as its page doesnt exist. Currently its
      // redirecting to trade main page"). XRP has no issuer and so no asset page; the design's own row-click layer would
      // still route the tap, so the row is marked and the click stopped at window capture below.
      tr.setAttribute('data-lxnorow', '1');
      tr.style.cursor = 'default';
    }
    return tr;
  }

  function paintAssets(tbl, xrp, held) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    if (xrp) tbl.appendChild(assetRow('XRP', 'Native asset', xrp.balance, XRP_LOGO, 'XRP', null));
    held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < held.length; i++) {
      var t = held[i];
      tbl.appendChild(assetRow(t.display + (t.frozen ? ' (frozen)' : ''), issShort(t.issuer), t.balance, thumb(t),
        t.issuer + '-' + t.currency, '/trade/xrpl/' + encodeURIComponent(t.display + '-' + t.issuer)));
    }
    if (!held.length && !xrp) tableNote(tbl, 'Nothing held on this account.');
  }

  // The same sum as the wallet page, from the same endpoint, so the two pages cannot disagree. A missing price is skipped,
  // never counted as zero.
  // THE VALUE COLUMN, IN STAGES (RAZA 2026-09-16: "[still not working] On public wallet page, value column is not working").
  // One request asked the price service for two dozen unlisted tokens at once, each an upstream call, while the same page's
  // hundred logos were being fetched; the upstream refused and the whole column stayed empty. Now the ranked list comes first
  // (one cached call prices XRP and every well-known token), then this wallet's other holdings eight at a time, largest
  // balances first.
  function paintValues(xrp, held) {
    var total = { usd: 0, any: false, xrp: false }, seen = {};
    var slugOf = function (t) { return String(t.issuer || '') + '-' + String(t.currency || ''); };
    var setVal = function (key, v) {
      var cell = document.querySelector('#accAssetsTbl tr[data-lxkey="' + key + '"] .acc-val');
      if (cell) cell.textContent = money(v);
    };
    function apply(j) {
      if (!j || !j.ok || !(j.usd > 0)) return false;
      if (!total.xrp && xrp && xrp.balance > 0) {
        total.xrp = true; total.usd += xrp.balance * j.usd; total.any = true;
        setVal('XRP', xrp.balance * j.usd);
        setStat('xrp balance', null, money(xrp.balance * j.usd));
      }
      held.forEach(function (t) {
        var k = slugOf(t), row = j.t && j.t[k];
        if (seen[k] || !row || !(t.balance > 0)) return;
        var u = row[0] * j.usd;
        if (!isFinite(u) || u <= 0) return;
        seen[k] = 1; total.usd += t.balance * u; total.any = true;
        setVal(k, t.balance * u);
      });
      setStat('portfolio value', total.any ? money(total.usd) : '—', 'Estimated value');
      return true;
    }
    function get(q, tries) {
      return fetch('/lxapi/xrplprices' + q).then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !j.ok) throw new Error('retry'); return j; })
        .catch(function () {
          if (tries <= 0) return null;
          return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return get(q, tries - 1); });
        });
    }
    get('', 3).then(function (j) {
      if (!apply(j)) { setStat('portfolio value', '—', 'Estimated value'); return; }
      var missing = held.filter(function (t) { return t.balance > 0 && !(j.t && j.t[slugOf(t)]); }).slice(0, 48).map(slugOf);
      var groups = [];
      for (var g = 0; g < missing.length; g += 8) groups.push(missing.slice(g, g + 8));
      (function next(i) {
        if (i >= groups.length) return;
        get('?t=' + encodeURIComponent(groups[i].join(',')), 1).then(function (jj) { apply(jj); next(i + 1); });
      })(0);
    });
  }

  function paintValuesOld(xrp, held, attempt) {
    var slugs = held.map(function (h) { return String(h.issuer || '') + '-' + String(h.currency || ''); });
    var q = slugs.length ? ('?t=' + encodeURIComponent(slugs.slice(0, 24).join(','))) : '';
    fetch('/lxapi/xrplprices' + q)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !(j.usd > 0)) throw new Error('no rate');
        var usd = 0, any = false;
        var setVal = function (key, v) {
          var row = document.querySelector('#accAssetsTbl tr[data-lxkey="' + key + '"] .acc-val');
          if (row) row.textContent = money(v);
        };
        if (xrp && xrp.balance > 0) {
          usd += xrp.balance * j.usd; any = true;
          setVal('XRP', xrp.balance * j.usd);
          setStat('xrp balance', null, money(xrp.balance * j.usd));
        }
        held.forEach(function (t) {
          var k = String(t.issuer || '') + '-' + String(t.currency || '');
          var row = j.t[k];
          if (!row || !(t.balance > 0)) return;
          var u = row[0] * j.usd;
          if (!isFinite(u) || u <= 0) return;
          usd += t.balance * u; any = true;
          setVal(k, t.balance * u);
        });
        setStat('portfolio value', any ? money(usd) : '—', 'Estimated value');
      })
      .catch(function () {
        // Asked again before giving up (RAZA 2026-09-15: "On public wallet page, value column is not working"): pricing a
        // wallet's two dozen tokens can take the upstream several seconds, and one refused call blanked the column.
        if ((attempt || 0) < 2) { setTimeout(function () { paintValues(xrp, held, (attempt || 0) + 1); }, 1500); return; }
        setStat('portfolio value', '—', 'Estimated value');
      });
  }

  // ---- pools -----------------------------------------------------------------------------------------
  function paintPools(tbl, pools) {
    if (!tbl) return;
    var head = tbl.querySelector('tr');
    tbl.innerHTML = '';
    if (head) tbl.appendChild(head);
    if (!pools.length) { tableNote(tbl, 'No pool positions.'); return; }
    // The header is Stellar's four columns: Pool · Pool share · Position value · Pool TVL.
    // THE RANKED PRICE LIST, ASKED AGAIN IF REFUSED (RAZA 2026-09-16: "Still not fixed: … pools tab. The details are not showing"). All
    // nineteen rows shared one request; when it came back {ok:false} under load, every position value and TVL stayed blank.
    function getRates(tries) {
      return fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok && j.usd > 0) return j; throw new Error('retry'); })
        .catch(function () {
          if (!(tries > 0)) return null;
          return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return getRates(tries - 1); });
        });
    }
    var rates = getRates(3);
    pools.slice(0, 20).forEach(function (p) {
      var tr = assetRow('AMM pool', issShort(p.issuer), p.balance, XRP_LOGO, 'POOL-' + p.issuer, '/pools/xrpl/id/' + encodeURIComponent(p.issuer));
      tr.children[1].textContent = bal(p.balance) + ' LP';
      // STELLAR'S POOL ROW (RAZA 2026-09-15: "it should show both the asset logos of the pool just like on Stellar"): two marks
      // in .acc-icos, the pair, and its LP holder count beneath.
      var ico1 = tr.querySelector('.acc-ico');
      if (ico1 && ico1.parentNode) {
        var icos = el('span', 'acc-icos');
        ico1.parentNode.insertBefore(icos, ico1);
        icos.appendChild(ico1);
        var ico2 = el('span', 'acc-ico');
        ico2.setAttribute('data-logoed', '1');
        icos.appendChild(ico2);
      }
      var subEl = tr.querySelector('.acc-iss');
      if (subEl) { subEl.className = 'acc-dom'; subEl.textContent = ''; }
      var tvlTd = el('td', 'num', '');
      tr.appendChild(tvlTd);
      tbl.appendChild(tr);
      // An LP token is issued BY its AMM account, so the issuer IS the pool; amm_info names its two sides.
      slowRpc('amm_info', { amm_account: p.issuer }).then(function (r) {
        var amm = r && r.amm;
        if (!amm) return;
        var side = function (x) {
          return typeof x === 'string'
            ? { code: 'XRP', t: null, v: Number(x) / 1e6 }
            : { code: curName(x.currency), t: { issuer: x.issuer, currency: x.currency }, v: Number(x.value) };
        };
        var A = side(amm.amount), B2 = side(amm.amount2);
        var cd = tr.querySelector('.acc-code');
        if (cd) cd.textContent = A.code + ' / ' + B2.code;
        var icoEls = tr.querySelectorAll('.acc-ico');
        if (icoEls[0]) { LOGO_Q = LOGO_Q.filter(function (jb) { return jb[0] !== icoEls[0]; }); queueLogo(icoEls[0], thumb(A.t), A.code); }
        if (icoEls[1]) queueLogo(icoEls[1], thumb(B2.t), B2.code);
        if (amm.lp_token && amm.lp_token.currency) {
          fetch('/lxapi/xrplrichlist?iss=' + encodeURIComponent(p.issuer) + '&cur=' + encodeURIComponent(amm.lp_token.currency) + '&n=1')
            .then(function (x) { return x.json(); })
            .then(function (hd) {
              var dom = tr.querySelector('.acc-dom');
              if (dom && hd && hd.ok && hd.total != null) dom.textContent = Math.round(hd.total).toLocaleString('en-US') + (Math.round(hd.total) === 1 ? ' LP holder' : ' LP holders');
            }).catch(function () {});
        }
        var supply = Number(amm.lp_token && amm.lp_token.value);
        var share = supply > 0 ? p.balance / supply : 0;
        tr.children[1].textContent = share > 0 ? ((share * 100 < 0.01 ? '<0.01' : (share * 100).toFixed(2)) + '%') : '—';
        var slugs = [A, B2].filter(function (s) { return s.t; }).map(function (s) { return s.t.issuer + '-' + s.t.currency; });
        // ASKED AGAIN UNTIL PRICED (measured 2026-09-16: both price answers came back {ok:false} during the page's load burst, and
        // the row gave up for good). Each pass asks afresh, spaced out, until the two values are written or five passes are spent.
        var pass = 0;
        return (function priceRow() {
          var done = false;
          var rp = pass === 0 ? rates : getRates(1);
          return Promise.all([rp, slugs.length
          ? fetch('/lxapi/xrplprices?t=' + encodeURIComponent(slugs.join(',')) + (pass ? '&r=' + pass : '')).then(function (x) { return x.json(); }).catch(function () { return null; })
          : null]).then(function (res) {
          // RAZA 2026-09-16: "pools tab. The details are not showing" — a refused per-pool lookup (an {ok:false} body) was
          // taken over the ranked list that already priced XRP; either answer that is good is used.
          var j0 = res[0], j1 = res[1];
          var j = (j1 && j1.ok && j1.usd > 0) ? j1 : j0;
          if (!j || !j.ok || !(j.usd > 0)) return;
          var usdOf = function (s) {
            if (!s.t) return s.v * j.usd;
            var kk = s.t.issuer + '-' + s.t.currency;
            var row = (j1 && j1.ok && j1.t && j1.t[kk]) || (j0 && j0.ok && j0.t && j0.t[kk]);
            return row && row[0] > 0 ? s.v * row[0] * j.usd : null;
          };
          var ua = usdOf(A), ub = usdOf(B2);
          // One priced side stands for both: an AMM holds equal value on each side.
          var tvl = (ua != null && ub != null) ? ua + ub : (ua != null ? ua * 2 : (ub != null ? ub * 2 : null));
          if (tvl == null) return;
          tvlTd.textContent = money(tvl);
          tr.children[2].textContent = money(tvl * share);
          done = true;
        }).catch(function () {}).then(function () {
          if (done || ++pass > 4 || !tr.isConnected) return;
          return new Promise(function (res) { setTimeout(res, 2500 * pass + Math.random() * 1500); }).then(priceRow);
        });
        })();
      }).catch(function () {});
    });
  }

  // ---- activity --------------------------------------------------------------------------------------
  function amtTxt(a) {
    if (a == null) return '';
    if (typeof a === 'string') return bal(Number(a) / 1e6) + ' XRP';
    if (a.value == null) return '';
    return bal(Number(a.value)) + ' ' + curName(a.currency);
  }
  function describe(tx, meta, me) {
    var ty = tx.TransactionType || 'Transaction';
    var d = (meta && (meta.delivered_amount || meta.DeliveredAmount)) || tx.Amount;
    if (d === 'unavailable') d = tx.Amount;
    if (ty === 'Payment') {
      if (tx.Account === me && tx.Destination === me) {
        var cOf = function (a) { return a == null ? '' : (typeof a === 'string' ? 'XRP' : curName(a.currency)); };
        return { cls: 'swap', type: 'Swap ' + cOf(tx.SendMax || tx.Amount) + ' → ' + cOf(d), a1: d ? '+' + amtTxt(d) : '', a2: tx.SendMax ? '-' + amtTxt(tx.SendMax) : '' };
      }
      if (tx.Destination === me) return { cls: 'receive', type: 'Received', a1: d ? '+' + amtTxt(d) : '', a2: 'from ' + short(tx.Account) };
      return { cls: 'send', type: 'Sent', a1: d ? '-' + amtTxt(d) : '', a2: 'to ' + short(tx.Destination) };
    }
    if (ty === 'OfferCreate') return { cls: 'swap', type: 'Order', a1: tx.TakerPays ? '+' + amtTxt(tx.TakerPays) : '', a2: tx.TakerGets ? '-' + amtTxt(tx.TakerGets) : '' };
    if (ty === 'OfferCancel') return { cls: 'order', type: 'Order cancelled', a1: '', a2: '' };
    if (ty === 'TrustSet') return { cls: 'settings', type: 'Trustline', a1: tx.LimitAmount ? curName(tx.LimitAmount.currency) : '', a2: '' };
    if (ty === 'AMMDeposit') return { cls: 'lp', type: 'Add liquidity', a1: tx.Amount ? '-' + amtTxt(tx.Amount) : '', a2: tx.Amount2 ? '-' + amtTxt(tx.Amount2) : '' };
    if (ty === 'AMMWithdraw') return { cls: 'lp', type: 'Remove liquidity', a1: '', a2: '' };
    return { cls: 'other', type: ty.replace(/([a-z])([A-Z])/g, '$1 $2'), a1: d ? amtTxt(d) : '', a2: '' };
  }
  function paintActivity(host, rows) {
    if (!host) return;
    host.innerHTML = '';
    if (!rows.length) {
      host.appendChild(el('div', 'acc-empty', 'No transactions on this account yet.'));
      return;
    }
    rows.forEach(function (x) {
      var row = el('div', 'activity-row');
      // The inherited sheet colours .received / .sent / .swap / .order / .lp / .settings / .other — "receive" and "send"
      // matched nothing, so every icon sat bare (RAZA 2026-09-15: "Recent activity is not like stellar. Check the left side icons").
      var ic = el('div', 'activity-icon ' + (({ receive: 'received', send: 'sent' })[x.cls] || x.cls));
      ic.innerHTML = ICONS[x.cls] || ICONS.other;
      row.appendChild(ic);
      var info = el('div', 'activity-info');
      var ty = el('div', 'type', x.type);
      ty.setAttribute('data-logoed', '1');
      info.appendChild(ty);
      info.appendChild(el('div', 'meta', ago(x.t)));
      row.appendChild(info);
      var amt = el('div', 'activity-amt');
      amt.appendChild(el('div', 'a1 ' + x.cls, x.a1));
      amt.appendChild(el('div', 'a2', x.a2));
      row.appendChild(amt);
      if (/^[0-9A-F]{64}$/i.test(x.hash || '')) {
        var lk = el('a', 'lx-txlink');
        lk.href = 'https://bithomp.com/explorer/' + x.hash;
        lk.target = '_blank';
        lk.rel = 'noopener nofollow';
        lk.title = 'View on Bithomp';
        lk.innerHTML = EXT_SVG;
        row.appendChild(lk);
      }
      host.appendChild(row);
    });
  }

  // THE ASSETS / POOLS TABS (RAZA 2026-09-15: "Public wallet address page, cant open pools tab"). The panes ship with the
  // hidden attribute and nothing on this page toggled it.
  function wireAccTabs() {
    if (window.__lxxAccTabs) return;
    window.__lxxAccTabs = 1;
    // A row with nowhere to go swallows its own click before the design's resolver sees it.
    window.addEventListener('click', function (e) {
      var nr = e.target && e.target.closest && e.target.closest('[data-lxnorow]');
      if (nr) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    window.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.acc-tab[data-t]');
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var want = t.getAttribute('data-t');
      [].forEach.call(document.querySelectorAll('.acc-tab[data-t]'), function (bt) {
        bt.classList.toggle('active', bt === t);
        bt.setAttribute('aria-selected', bt === t ? 'true' : 'false');
      });
      [].forEach.call(document.querySelectorAll('.acc-pane[data-p]'), function (pn) { pn.hidden = pn.getAttribute('data-p') !== want; });
    }, true);
  }

  function load() {
    var tbl = $('#accAssetsTbl');
    if (!tbl && !$('#accStats')) return;
    wireAccTabs();                    // not this page

    var a = fromUrl();
    if (!a) {
      var addrEl = $('#accAddr');
      if (addrEl) addrEl.textContent = 'No account';
      tableNote($('#accAssetsTbl'), 'No XRP Ledger address in this link.');
      tableNote($('#accPoolsTbl'), 'No XRP Ledger address in this link.');
      paintActivity($('#accActs'), []);
      return;
    }

    paintHeader(a);
    wireAccActions(a);
    tableNote($('#accAssetsTbl'), 'Reading the XRP Ledger…');
    tableNote($('#accPoolsTbl'), 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      window.lxx.allLines(rpc, a)
    ]).then(function (r) {
      var acctErr = r[1] && r[1].error;
      if (acctErr === 'actNotFound') {
        tableNote($('#accAssetsTbl'), 'This account is not activated on the XRP Ledger yet.');
        tableNote($('#accPoolsTbl'), 'No pool positions.');
        paintActivity($('#accActs'), []);
        setStat('xrp balance', '0 XRP', '');
        return;
      }
      var v = (r[0].info && r[0].info.validated_ledger) || {};
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = (r[1] && r[1].account_data) || {};
      var xrp = window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve);
      var split = window.lxx.readLines((r[2] && r[2].lines) || []);
      // A position is LP tokens held. Lines left at zero after withdrawing (many, on an active account) are not
      // positions, and their AMMs are often deleted, so they showed as unnamed "AMM pool … 0 LP" rows.
      split.pools = split.pools.filter(function (pl) { return Number(pl.balance) > 0; });

      window.__lxxAccountData = { xrp: xrp, held: split.held, pools: split.pools };

      paintAssets($('#accAssetsTbl'), xrp, split.held);
      paintPools($('#accPoolsTbl'), split.pools);

      // One count, used twice, including XRP — the convention wallet.js uses.
      var assetsN = split.held.length + (xrp ? 1 : 0);
      var an = $('#accAssetsN');
      if (an) an.textContent = String(assetsN);
      var pn = $('#accPoolsN');
      if (pn) pn.textContent = String(split.pools.length);

      setStat('xrp balance', xrp ? bal(xrp.balance) + ' XRP' : '—', '');
      setStat('assets held', String(assetsN), split.held.length + (split.held.length === 1 ? ' trustline held' : ' trustlines held'));
      setStat('pool positions', String(split.pools.length), split.pools.length ? (split.pools.length === 1 ? '1 position' : split.pools.length + ' positions') : 'none');
      paintValues(xrp, split.held);
    }).catch(function () {
      tableNote($('#accAssetsTbl'), 'Could not read the XRP Ledger.');
      tableNote($('#accPoolsTbl'), 'Could not read the XRP Ledger.');
    });

    // SEQUENCED, NOT PARALLEL, and retried once: four simultaneous requests to one public node dropped one on a cold load.
    function history(attempt) {
      return rpc('account_tx', { account: a, limit: 50, ledger_index_min: -1, ledger_index_max: -1 })
        .catch(function (e) {
          if (attempt > 0) throw e;
          return new Promise(function (res) { setTimeout(res, 900); }).then(function () { return history(1); });
        });
    }
    setTimeout(function () {
      history(0)
        .then(function (r) {
          var out = [];
          var rows = (r && r.transactions) || [];
          for (var i = 0; i < rows.length && out.length < 50; i++) {
            var tx = rows[i].tx || rows[i].tx_json || {};
            var meta = rows[i].meta || {};
            if (!tx.TransactionType) continue;
            var x = describe(tx, meta, a);
            x.t = tx.date != null ? (tx.date + RIPPLE_EPOCH) * 1000 : null;
            x.hash = tx.hash || rows[i].hash || '';
            out.push(x);
          }
          paintActivity($('#accActs'), out);
          var n = $('#accActN');
          if (n) n.textContent = String(out.length);
        })
        .catch(function () { paintActivity($('#accActs'), []); })
        .then(function () {
          // "Active since": the account's first transaction is the payment that created it.
          return rpc('account_tx', { account: a, limit: 1, forward: true, ledger_index_min: -1, ledger_index_max: -1 });
        })
        .then(function (r) {
          var tx = r && r.transactions && r.transactions[0];
          var t = tx && (tx.tx || tx.tx_json);
          var since = $('#accSub .lx-accsince');
          if (t && t.date != null && since) {
            since.textContent = 'Active since ' + new Date((t.date + RIPPLE_EPOCH) * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          }
        })
        .catch(function () {});
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxAccountReload = load;
})();

