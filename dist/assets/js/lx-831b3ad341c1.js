
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

// $LUMOS page: the real token on the XRP Ledger.
//
// This page was wrong TWICE OVER, in two different ways, which is worth spelling out because they
// need different fixes:
//
//   1. The markup ships MOCK values -- $0.00320, "+5.6% (24h)", "$3.20M on 1B circulating",
//      "3,208 holders". Against a real price of $0.0000344 that is 93x too high. It is what anyone
//      sees before the script runs, or forever if the script fails.
//   2. `lx-ltdata` then overwrote the mock with STELLAR LUMOS: $0.00005425, 936 holders, 996.57M
//      circulating, "LUMOS/XLM mark". Live, plausible, and the wrong ledger's token on a page
//      titled "LUMOS on the XRP Ledger".
//
// Real XRPL LUMOS, verified: $0.0000344, 1,200 holders, 705,205,451 circulating of 999,955,353
// issued. Every slot this file touches is set from that, and anything without a source is set to an
// em dash rather than left showing either fiction.
//
// The issuer is BLACKHOLED (DisableMaster + RegularKey = ACCOUNT_ZERO), so the supply is fixed and
// no more LUMOS can ever be minted. That is the single most important fact on this page and it is
// stated rather than implied by a number.
(function () {
  if (window.__lxxLToken) return;
  window.__lxxLToken = 1;

  var ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  var CUR = '4C554D4F53000000000000000000000000000000';

  // Anything that arrives on a second request and has to survive a repaint. `pools` starts null,
  // not 0: an unknown count must render as a dash, and 0 is a claim that LUMOS has no pools.
  var state = { pools: null };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // textContent for anything off the ledger: a currency name is arbitrary bytes from a public chain
  // and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function usd(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    if (v < 0.01) return '$' + v.toPrecision(4);
    if (v < 1000) return '$' + v.toFixed(2);
    if (v < 1e6) return '$' + (v / 1e3).toFixed(1) + 'K';
    if (v < 1e9) return '$' + (v / 1e6).toFixed(2) + 'M';
    return '$' + (v / 1e9).toFixed(2) + 'B';
  }

  function big(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return Math.round(v).toLocaleString('en-US');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  }

  // Match a stat cell by its LABEL rather than by position: the page has five of them and their
  // order is a layout decision that can change without anyone thinking about this file.
  function setStat(match, value, sub) {
    var cells = $$('.cstat');
    for (var i = 0; i < cells.length; i++) {
      var lbl = cells[i].querySelector('.lbl') || cells[i].firstElementChild;
      if (!lbl) continue;
      if (lbl.textContent.trim().toLowerCase().indexOf(match) < 0) continue;
      var v = cells[i].querySelector('.val');
      if (v) v.textContent = value;
      if (sub != null) {
        var s = cells[i].querySelector('.sub') || cells[i].querySelector('.lx-supnum');
        if (!s) { s = el('div', 'sub'); cells[i].appendChild(s); }     // the Pools cell ships without one
        if (s.textContent !== sub) s.textContent = sub;
      }
      return true;
    }
    return false;
  }

  // Eighth gate of this shape:
  //     .hero-price-block:not(.lxlt) .price, .change, .sub-v { visibility: hidden }
  // The old script added .lxlt once it had a price; its stylesheet outlived it. Without this the
  // hero shows the right price, invisibly.
  function lift() {
    var h = $('.hero-price-block');
    if (h) h.classList.add('lxlt');

    // Eleventh gate, same stylesheet, same shape, different element:
    //     .cstat:not(.lxlt) .val, .cstat:not(.lxlt) .sub { visibility: hidden }
    // Every stat card under the hero -- market cap, FDV, holders, pools, 24h volume -- was being
    // filled with correct figures and then hidden, so the row read as five empty boxes with labels.
    // Nothing in the DOM complained: right text, right numbers, display:block. Only the screenshot
    // showed the gap, which is the third time on this page that has been the deciding check.
    var cs = document.querySelectorAll('.cstat');
    for (var i = 0; i < cs.length; i++) cs[i].classList.add('lxlt');
  }

  // THE PAGE NAMED THREE DIFFERENT CHAINS, none of them this one. Beside a correct XRP Ledger price
  // and a correct 999.96M supply, the hero read "Native utility token · live on Aptos", the network
  // chip said "Aptos", the comparison block said "Aptos", and the supply line said "1 billion LUMOS ·
  // fixed supply on Stellar."
  //
  // Those are labels the numbers already contradict, which is the most confusing way for a page to be
  // wrong: everything measurable is right, and everything that says what you are looking at is not.
  //
  // The supply line is corrected to the real figure rather than the round one. 999,955,353 is what the
  // ledger reports, and the reason it can never change is worth saying outright: the issuer is
  // BLACKHOLED (DisableMaster + RegularKey = ACCOUNT_ONE), so no more can be minted by anyone, ever.
  // "1 billion" is a rounding of a number whose exactness is the entire point.
  function paintChainLabels() {
    // lumoscore.com's line, word for word (RAZA 2026-09-15: "LUMOS token page on XRPL has issues").
    $$('.lh-desc').forEach(function (e) {
      var want = 'LumosCore’s native utility token — powers platform fees and rewards';
      if (e.textContent !== want) e.textContent = want;
    });
    $$('.net-tag, .lt-cmp-chain').forEach(function (e) {
      if (/Aptos|Stellar/i.test(e.textContent || '')) {
        try { e.setAttribute('data-logoed', '1'); } catch (_) {}
        e.textContent = 'XRP Ledger';
      }
    });
    $$('.sub-h').forEach(function (e) {
      var t = e.textContent || '';
      if (!/fixed supply/i.test(t)) return;
      // "1 billion", as lumoscore.com states it (RAZA 2026-09-15: "make it 1 Billion LUMOS instead of 999,955,353").
      e.textContent = '1 billion LUMOS · fixed supply on the XRP Ledger.';
    });

    // THE SAME SENTENCE LIVES UNDER OTHER CLASSES, and the phone has none of them as `.sub-h`. Left
    // to the rule above, a phone opening the XRP Ledger's own token page read
    //     "Supply distribution — 1 billion LUMOS · fixed supply on Stellar."
    // and, below it, "Fixed supply of 1,000,000,000 LUMOS" against an issued 999,955,353.
    //
    // Rewritten by TEXT NODE and by substitution rather than by replacing each block's text: these
    // sentences continue past the part that is wrong ("...issuer key locked. Allocation is..."), and
    // assigning textContent would take the rest of the sentence with it.
    var SUPPLY_FIX = [
      [/\b999,955,353 LUMOS\b/g, '1,000,000,000 LUMOS'],
      [/\bon (Stellar|Aptos)\b/gi, 'on the XRP Ledger'],
    ];
    $$('.sect-head .sub, .supply-totem .note, .supply-note, .lt-supply').forEach(function (e) {
      var w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        var t = n.nodeValue;
        // NO KEYWORD GATE. It was `/supply|Stellar|Aptos/`, which skipped the one node that mattered:
        // the sentence is split as "Fixed supply of " + <strong>1,000,000,000 LUMOS</strong> + ",
        // issuer key locked", so the node holding the figure contains none of those words. The
        // replacements below are already specific enough to be their own filter.
        if (!t) continue;
        var out = t;
        for (var i = 0; i < SUPPLY_FIX.length; i++) out = out.replace(SUPPLY_FIX[i][0], SUPPLY_FIX[i][1]);
        if (out !== t) n.nodeValue = out;
      }
    });

    // The allocation note is PROSE, and it described the wrong ledger's market: "added, a little at a
    // time, to LUMOS liquidity on Stellar — the LUMOS/XLM pool and the other LUMOS pairs". The pair
    // it names does not exist here; the quote asset on this ledger is XRP.
    //
    // Rewritten by TEXT NODE so the sentence keeps whatever markup the design wrapped parts of it in
    // — replacing the block's innerHTML would flatten that and is not needed to change two words.
    $$('.alloc-note').forEach(function (block) {
      var w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      var nd;
      while ((nd = w.nextNode())) {
        var v = nd.nodeValue;
        if (!v || !/Stellar|XLM/.test(v)) continue;
        nd.nodeValue = v.replace(/LUMOS\/XLM/g, 'LUMOS/XRP')
          .replace(/\bon Stellar\b/g, 'on the XRP Ledger')
          .replace(/\bStellar\b/g, 'the XRP Ledger')
          .replace(/\bXLM\b/g, 'XRP');
      }
    });
  }

  var XRP_LOGO = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';

  // STELLAR'S HERO: the flame mark, the network chip with its logo, the issuer address (behind an inherited
  // .addr-row:not(.lxlt) gate, which is why it read blank), the explorer link and the home-domain link.
  function paintHeroExtras() {
    $$('.lumos-icon').forEach(function (ic) {
      ic.setAttribute('data-lxlogo', '1');
      [['background-image', 'url("/assets/favicon.png")'], ['background-color', 'transparent'], ['background-size', 'contain'],
        ['background-repeat', 'no-repeat'], ['background-position', 'center center'], ['box-shadow', 'none']]
        .forEach(function (kv) { ic.style.setProperty(kv[0], kv[1], 'important'); });
    });
    $$('.addr-row').forEach(function (row) {
      row.classList.add('lxlt');
      var tag = row.querySelector('.net-tag');
      if (tag && !tag.querySelector('.b-ico')) {
        tag.textContent = '';
        tag.setAttribute('data-logoed', '1');
        var bi = el('span', 'b-ico');
        var im = document.createElement('img');
        im.src = XRP_LOGO;
        im.alt = '';
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        bi.appendChild(im);
        tag.appendChild(bi);
        tag.appendChild(document.createTextNode(' XRP Ledger '));
      }
      var ex = row.querySelector('.addr-actions a.addr-btn');
      if (ex) {
        ex.href = 'https://bithomp.com/explorer/' + ISS;
        ex.target = '_blank';
        ex.rel = 'noopener nofollow';
        ex.setAttribute('data-tooltip', 'View on XRPL Explorer');
        ex.setAttribute('data-lxex', '1');
      }
      if (!row.querySelector('.lx-lt-dom')) {
        var dom = el('a', 'lx-lt-dom');
        dom.href = 'https://lumoscore.com';
        dom.target = '_blank';
        dom.rel = 'noopener';
        dom.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg><span>lumoscore.com</span>';
        row.appendChild(dom);
      }
    });
    // The XRP price and the 24h change share one line under the dollar price, as on lumoscore.com.
    $$('.hero-price-block').forEach(function (hb) {
      if (hb.querySelector('.lx-pricemeta')) return;
      var pn = hb.querySelector('.price-native'), ch = hb.querySelector('.change');
      if (!pn || !ch) return;
      var meta = el('div', 'lx-pricemeta');
      meta.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap';
      pn.parentNode.insertBefore(meta, pn);
      meta.appendChild(pn);
      meta.appendChild(ch);
    });
  }

  // Counts beside the Pools and Holders tabs, drawn by the inherited .lt-tab[data-count]::after rule, and the supply
  // card's link naming the real pool count (RAZA 2026-09-15: "Pools and holders count is not showing up here").
  function paintTabsAndLinks(d) {
    var pl = $('.lt-tab[data-t="pl"]'), hl = $('.lt-tab[data-t="hl"]');
    if (pl && state.pools != null) pl.setAttribute('data-count', '(' + state.pools + ')');
    var hc = (d && d.holders != null) ? Math.round(d.holders) : state.holders;   // the same figure as the Holders stat
    if (hl && hc != null) hl.setAttribute('data-count', '(' + hc.toLocaleString('en-US') + ')');
    if (state.pools != null) {
      $$('button[data-goto="pl"], .lt-cmp-foot button, .lt-cmp-foot a').forEach(function (b) {
        var want = 'View all ' + state.pools + ' pools →';
        if (/View all/.test(b.textContent || '') && b.textContent !== want) b.textContent = want;
      });
    }
  }

  // Stellar's allocation (RAZA 2026-09-15: "Token count and % is missing"): six rows summing to one billion — Market
  // Reserve 300M, Ecosystem LP 240M, Native LP 240M, Team 100M, Whale Holder 50M, Airdrops 70M. The design's extra
  // "Cross-Chain Reserve" row is not on lumoscore.com, and the figures sat behind .alloc-legend:not(.lxlt).
  function fixAllocation() {
    $$('.alloc-row').forEach(function (r) {
      var nm = ((r.querySelector('.name') || {}).textContent || '');
      if (/Cross-Chain Reserve/i.test(nm)) { if (r.parentNode) r.parentNode.removeChild(r); return; }
      if (/Airdrops/i.test(nm)) {
        var am = r.querySelector('.amount'), pc = r.querySelector('.pct');
        if (am && am.textContent !== '70M') am.textContent = '70M';
        if (pc && pc.textContent !== '7%') pc.textContent = '7%';
        r.style.gridColumn = 'auto';
        r.style.maxWidth = 'none';
      }
    });
    $$('.alloc-seg').forEach(function (s) {
      var st = s.getAttribute('style') || '';
      if (st.indexOf('--alloc-5)') >= 0) { if (s.parentNode) s.parentNode.removeChild(s); }
      else if (st.indexOf('--alloc-7)') >= 0 && s.style.width !== '7%') s.style.width = '7%';
    });
    $$('.alloc-legend').forEach(function (l) { l.classList.add('lxlt'); });
  }

  // "What you can do with LUMOS" sits ABOVE Supply distribution, as on lumoscore.com (RAZA 2026-09-15). Each is a
  // .section-head followed by its body in the page's own flow; the utility block is moved once, found by its heading.
  function reorderSections() {
    var main = $('main.page');
    if (!main || main.getAttribute('data-lxorder') === '1') return;
    var kids = [].slice.call(main.children);
    var headOf = function (re) {
      return kids.filter(function (k) { return k.classList.contains('section-head') && re.test(k.textContent || ''); })[0];
    };
    var sup = headOf(/Supply distribution/i), ut = headOf(/What you can do/i);
    if (!sup || !ut) return;
    var ui = kids.indexOf(ut), si = kids.indexOf(sup);
    main.setAttribute('data-lxorder', '1');
    if (ui < si) return;
    var block = [ut];
    for (var i = ui + 1; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList.contains('section-head') || k.tagName === 'SECTION' || k.querySelector('h2')) break;
      block.push(k);
    }
    block.forEach(function (n) { main.insertBefore(n, sup); });
  }

  // Stellar's medals for the top three holders.
  function medalSVG(i) {
    var c = [{ a: '#ffe487', b: '#e3a81a', s: '#b9860f', t: '#6d4a00' },
      { a: '#ffffff', b: '#b6bcc6', s: '#8b93a0', t: '#4c5661' },
      { a: '#f3c79a', b: '#c07a3c', s: '#97592a', t: '#5f3616' }][i];
    var id = 'lxmed' + i;
    return '<svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">'
      + '<defs><radialGradient id="' + id + '" cx="36%" cy="28%" r="78%"><stop offset="0%" stop-color="' + c.a + '"></stop><stop offset="100%" stop-color="' + c.b + '"></stop></radialGradient></defs>'
      + '<circle cx="20" cy="21" r="15.5" fill="url(#' + id + ')" stroke="' + c.s + '" stroke-width="2"></circle>'
      + '<circle cx="20" cy="21" r="12.3" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"></circle>'
      + '<path d="M12 3 L16 12 L12 11 L8 12 Z" fill="' + c.s + '"></path><path d="M28 3 L32 12 L28 11 L24 12 Z" fill="' + c.s + '"></path>'
      + '<text x="20" y="26.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="800" fill="' + c.t + '">' + (i + 1) + '</text>'
      + '</svg>';
  }

  // A small symmetric identicon for a holder's avatar, drawn from the address itself (the design's .av held another
  // chain's logo).
  function identUri(a) {
    var h = 0, i;
    for (i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
    var hue = h % 360, cells = '';
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < 3; x++) {
        h = (h * 1103515245 + 12345) >>> 0;
        if ((h >>> 16) & 1) {
          cells += '<rect x="' + (x * 8) + '" y="' + (y * 8) + '" width="8" height="8"/>';
          if (x < 2) cells += '<rect x="' + ((4 - x) * 8) + '" y="' + (y * 8) + '" width="8" height="8"/>';
        }
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(' + hue
      + ',58%,46%)"/><g fill="rgba(255,255,255,.92)">' + cells + '</g></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function paint(d) {
    lift();
    paintChainLabels();
    // ---- hero -------------------------------------------------------------------------------
    var price = $('.hero-price-block .price');
    if (price) price.textContent = d ? usd(d.usd) : '—';

    var native = $('.price-native');
    if (native) {
      native.textContent = (d && d.price != null)
        ? ('≈ ' + Number(d.price).toPrecision(3) + ' XRP')
        : '≈ — XRP';
    }

    var change = $('.hero-price-block .change');
    if (change) {
      var p = d ? pct(d.p24) : null;
      change.textContent = p == null ? '— (24h)' : (p + ' (24h)');
      change.className = 'change ' + (d && d.p24 != null && d.p24 < 0 ? 'down' : 'up');
    }

    // ---- stat cells --------------------------------------------------------------------------
    setStat('market cap', d ? usd(d.marketcap != null && d.usd != null && d.price
      ? d.marketcap * (d.usd / d.price) : null) : '—',
      d && d.circulating != null ? ('on ' + big(d.circulating) + ' circulating') : null);

    // Fully diluted uses the ISSUED total, which differs from circulating: 999,955,353 against
    // 705,205,451. Quoting one as the other is a 42% overstatement.
    // On the round billion, as lumoscore.com's card reads ("on 1.00B total supply").
    var fdv = (d && d.usd != null) ? d.usd * 1e9 : null;
    setStat('diluted', usd(fdv), 'on 1.00B total supply');

    setStat('holder', d && d.holders != null ? Math.round(d.holders).toLocaleString('en-US') : '—',
      d && d.trustlines != null ? (Math.round(d.trustlines).toLocaleString('en-US') + ' trustlines') : null);

    setStat('volume', d && d.vol24 != null && d.usd != null && d.price
      ? usd(d.vol24 * (d.usd / d.price)) : '—', 'past 24h');

    // ---- supply numbers ----------------------------------------------------------------------
    $$('.lx-supnum').forEach(function (e) {
      var t = e.textContent;
      if (/circulating/i.test(t)) e.textContent = d && d.circulating != null
        ? ('on ' + big(d.circulating) + ' circulating') : 'circulating —';
      else if (d && d.issued != null) e.textContent = Math.round(d.issued).toLocaleString('en-US') + ' LUMOS';
    });

    // ---- the comparison panel -----------------------------------------------------------------
    // EVERY row here shipped with the design's mock still in it, and the mock is not merely stale:
    // it quoted $0.00322 against a real price of $0.00003413 -- a hundredfold overstatement -- plus
    // a flat 1,000,000,000 circulating where 705.21M is issued-and-circulating, and a "LUMOS/XLM
    // mark" for a chain this page is not about. Only the holders row was being replaced, and the
    // whole panel happened to be sitting behind a visibility gate, which is the single reason a
    // hundredfold-wrong price was never on screen. Every row is now written from `d` or dashed.
    $$('.lt-cmp-row').forEach(function (row) {
      var v = row.querySelector('.lt-cmp-v');
      if (!v) return;
      var label = ((row.querySelector('.lt-cmp-l') || row).textContent || '').toLowerCase();

      // Each row carries its own trailing span and they are NOT interchangeable: `.chg` holds the
      // 24h change, `.sub` a secondary line, `.u` the unit. Setting textContent drops whichever one
      // the row had, so keep it and refill it -- otherwise the price row silently loses its change
      // figure and the supply row loses the word LUMOS.
      var tail = v.querySelector('.chg, .sub, .u');
      var setV = function (main, tailText) {
        v.textContent = main;
        if (tail && tailText != null) { tail.textContent = tailText; v.appendChild(tail); }
      };

      if (/price/.test(label)) {
        setV(d ? usd(d.usd) : '—', d && d.p24 != null ? pct(d.p24) : '—');
        if (tail) tail.className = 'chg ' + (d && d.p24 != null && d.p24 < 0 ? 'down' : 'up');
      } else if (/volume/.test(label)) {
        // The subline said "across 11 pools" -- a second stale count, in prose this time.
        setV(d && d.vol24 != null && d.usd != null && d.price
          ? usd(d.vol24 * (d.usd / d.price)) : '—',
          state.pools == null ? 'across — pools' : ('across ' + state.pools + ' pools'));
      } else if (/circulating|supply/.test(label)) {
        setV(d && d.circulating != null
          ? Math.round(d.circulating).toLocaleString('en-US') : '—', 'LUMOS');
      } else if (/holder/.test(label)) {
        // Both counts are named, as on lumoscore.com (RAZA 2026-09-15: "Trustlines (besides Holders) is missing").
        var labEl = row.querySelector('.lt-cmp-l');
        if (labEl && labEl.textContent !== 'Holders · Trustlines') labEl.textContent = 'Holders · Trustlines';
        setV(d && d.holders != null
          ? (Math.round(d.holders).toLocaleString('en-US')
            + (d.trustlines != null ? ('  ·  ' + Math.round(d.trustlines).toLocaleString('en-US')) : ''))
          : '—', null);
      } else if (/pool/.test(label)) {
        setV(state.pools == null ? '—' : String(state.pools), null);
      } else if (/xlm|stellar/.test(v.textContent.toLowerCase())) {
        v.textContent = '—';
      }

      // Twelfth gate: `.lt-cmp-row:not(.lxlt) .lt-cmp-v { visibility:hidden }`. Lifted PER ROW and
      // only after that row has been written, so the mock it shipped with can never be the thing
      // that becomes visible. Lifting the panel up front would have put $0.00322 on screen.
      row.classList.add('lxlt');
    });

    // The pools stat card is not in the payload at all, so it was showing the design's mock 14.
    setStat('pool', state.pools == null ? '—' : String(state.pools), 'LUMOS pairs');
    paintHeroExtras();
    paintTabsAndLinks(d);
    fixAllocation();
    reorderSections();
  }

  // How many AMM pools hold LUMOS. /lxapi/xrplpools?issuer= narrows the upstream's 30,648 pools to
  // the ones with a LUMOS side; `total` is the count, independent of the page size asked for.
  // THE PHONE'S "All LUMOS pools" LIST. The desktop page renders a table that browser/pools.js
  // fills; the phone renders `#poolList` of `.pool-item` anchors, which nothing filled — so it
  // showed ten invented pools, "LUMOS / APT", each pill reading "Aptos" and each anchor carrying
  // data-chain="stellar", on the XRP Ledger's own token page.
  //
  // Same data the count above already fetched, so this costs no extra request.
  function poolItem(p) {
    var a = el('a', 'pool-item');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);
    a.setAttribute('data-chain', 'xrpl');

    var icons = el('div', 'pair-icons');
    icons.style.cssText = 'width:36px;height:26px';
    function disc(cls, nm, left) {
      var d = el('div', cls, String(nm || '?').slice(0, 1).toUpperCase());
      try { d.setAttribute('data-logoed', '1'); } catch (e) {}
      d.style.cssText = 'width:26px;height:26px;border-color:var(--surface);'
        + 'background:' + hueOf(nm) + (left ? ';left:13px' : '');
      return d;
    }
    var n1 = poolName(p.a1), n2 = poolName(p.a2);
    icons.appendChild(disc('a', n1, false));
    icons.appendChild(disc('b', n2, true));
    a.appendChild(icons);

    var info = el('div', 'info');
    info.appendChild(el('div', 'pair-name', n1 + ' / ' + n2));
    var meta = el('div', 'meta-row');
    var pill = el('span', 'chain-pill', 'XRP Ledger');
    try { pill.setAttribute('data-logoed', '1'); } catch (e) {}
    meta.appendChild(pill);
    if (p.fee != null) meta.appendChild(el('span', 'incent-pill native', p.fee + '% fee'));
    info.appendChild(meta);
    var stats = el('div', 'stats-row');
    function st(label, v) {
      var d = document.createElement('div');
      d.appendChild(el('span', 'label', label));
      d.appendChild(el('span', 'v', v));
      return d;
    }
    stats.appendChild(st('TVL', amount(p.liq) + ' XRP'));
    stats.appendChild(st('24H', amount(p.vol) + ' XRP'));
    info.appendChild(stats);
    a.appendChild(info);

    var act = el('div', 'right-actions');
    act.appendChild(el('span', 'trade-btn', 'View pool'));
    a.appendChild(act);
    return a;
  }

  function poolName(x) {
    if (!x) return '?';
    if (x.c === 'XRP' || x.code === 'XRP') return 'XRP';
    var c = x.n || x.name || x.code || x.c || '';
    try { if (/^[0-9A-F]{40}$/i.test(c)) c = window.lxx.decodeCurrency(c).display; } catch (e) {}
    return c || '?';
  }

  function hueOf(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  // STELLAR'S "ALL LUMOS POOLS" (RAZA 2026-09-15: "LUMOS token page, in pools tab, its not the same as on Stellar"): the
  // design's own row — LUMOS mark and the paired token's, "LUMOS / X", TVL, 24h volume, an Incentives pill and "View pool" —
  // one per pool by TVL, with the Network column removed as lumoscore.com removes it, inside the page's scroll box.
  var NATIVE_LP = 'rnPQqk3cfHyqSyvAGh3AfMtWiszK8zaF4U';
  var ECO_LP = {
    r27TeM8xMebVAMHt4aB3BMYw5MB5fULht: 1, rM6HW3s4WUGuLYwKwRvZx2aai5wk5PR5fz: 1, rhhBo4BXkrhvr17rLdtdwxMjEk1NnTvqUC: 1,
    rJZftp95akgYuXXtb2yp23F1cGuHu34pMA: 1, rEmgwNPCbq6ogmLKThxgee35uCSqfhB83M: 1, rJnv9wSoSECHzWsNXR7E74hi8mbKX9ZnDM: 1,
    rsKJxAyfL2AGdTMqz5ZMhBSyiSxqz97g3z: 1, rKsz9Dft5yYtbLS1SSG9L6u3LyhgwuWhew: 1, rUHWxx4kodHx3P8WxtkdcjhwDXnr5p9txo: 1,
    rJfj7MXMt1VfBFF8mBta1CesMSzXYZELyZ: 1
  };
  var POOL_TPL = null;
  function usdAbbr(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
  }
  function sideThumb(s) {
    if (!s || s.c === 'XRP' || !s.i) return '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
    if (s.m) return '/lxapi/xrplthumb?id=' + encodeURIComponent(s.m) + '&w=48';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(s.i) + '&cur=' + encodeURIComponent(s.c) + '&w=48';
  }
  function buildPoolsTable(rows, usd) {
    var pb = $('#poolsBody');
    if (!pb || !rows.length) return;
    if (!POOL_TPL) {
      var t0 = pb.querySelector('tr:not([data-lxbuilt])') || pb.querySelector('tr');
      if (!t0) return;
      POOL_TPL = t0.cloneNode(true);
    }
    var tbl = pb.closest('table');
    if (tbl) {
      $$('thead th', tbl).forEach(function (th) {
        if (/^Network$/i.test((th.textContent || '').trim()) && th.parentNode) th.parentNode.removeChild(th);
      });
    }
    var arr = rows.slice().sort(function (a, b) { return (+b.liq || 0) - (+a.liq || 0); });
    pb.innerHTML = '';
    arr.forEach(function (p) {
      var other = (p.a1 && p.a1.i === ISS && p.a1.c === CUR) ? p.a2 : p.a1;
      var row = POOL_TPL.cloneNode(true);
      row.setAttribute('data-lxbuilt', '1');
      row.setAttribute('data-acct', p.acct);
      row.removeAttribute('data-chain');
      var nm = row.querySelector('.pair-name');
      if (nm) { nm.textContent = 'LUMOS / ' + poolName(other); nm.setAttribute('data-logoed', '1'); }
      [[row.querySelector('.pair-icons .a'), '/assets/favicon.png'], [row.querySelector('.pair-icons .b'), sideThumb(other)]].forEach(function (x) {
        var n = x[0];
        if (!n) return;
        n.removeAttribute('data-logo');
        n.setAttribute('data-logoed', '1');
        n.textContent = '';
        n.style.background = 'transparent';
        var im = document.createElement('img');
        im.alt = '';
        im.src = x[1];
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
        n.appendChild(im);
      });
      var chain = row.querySelector('.chain-pill');
      if (chain) { var ctd = chain.closest('td'); if (ctd && ctd.parentNode) ctd.parentNode.removeChild(ctd); }
      var nums = row.querySelectorAll('.num');
      if (nums[0]) nums[0].textContent = usd ? usdAbbr((+p.liq || 0) * usd) : (amount(p.liq) + ' XRP');
      if (nums[1]) nums[1].textContent = usd ? usdAbbr((+p.vol || 0) * usd) : (amount(p.vol) + ' XRP');
      var inc = row.querySelector('.incent-pill');
      if (inc) {
        inc.setAttribute('data-logoed', '1');
        if (p.acct === NATIVE_LP) { inc.textContent = 'Native LP'; inc.className = 'incent-pill native'; }
        else if (ECO_LP[p.acct]) { inc.textContent = 'Ecosystem'; inc.className = 'incent-pill eco'; }
        else inc.style.display = 'none';
      }
      var link = row.querySelector('a');
      if (link) link.setAttribute('href', '/pools/xrpl/id/' + encodeURIComponent(p.acct));
      pb.appendChild(row);
    });
    pb.classList.add('lxlt');
    if (tbl && tbl.parentNode && !tbl.parentNode.classList.contains('lx-poolscroll')) {
      var wrap = document.createElement('div');
      wrap.className = 'lx-poolscroll';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }
    if (!window.__lxxLtPoolNav) {
      window.__lxxLtPoolNav = 1;
      window.addEventListener('click', function (e) {
        var tr = e.target && e.target.closest && e.target.closest('#poolsBody tr[data-acct]');
        if (!tr) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-acct'));
      }, true);
    }
  }

  function paintPoolList(rows) {
    var host = $('#poolList');
    if (!host) return;                                  // desktop renders a table instead
    host.innerHTML = '';
    if (!rows.length) {
      var d = el('div', null, 'No LUMOS pools found on the XRP Ledger.');
      d.style.cssText = 'padding:20px 6px;text-align:center;opacity:.7';
      host.appendChild(d);
      return;
    }
    for (var i = 0; i < Math.min(rows.length, 10); i++) host.appendChild(poolItem(rows[i]));
  }

  // RETURNS ITS PROMISE so load() can wait for it. Without that the pool count and the token payload
  // were two races with one finish line: whichever settled last owned the final paint, and the
  // Pools stat card and the "View all N pools" link were left on the design's mock. Measured on the
  // live page: card "—", link "View all 14 pools", with the endpoint answering total 22 the whole
  // time -- and __lxxLTokenReload() fixing both, which is what named it as ordering rather than data.
  function loadPools() {
    return fetch('/lxapi/xrplpools?n=100&issuer=' + encodeURIComponent(ISS))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || d.total == null) return;
        state.pools = d.total;
        paint(window.__lxxLumos || null);         // repaint the two places the count appears
        paintPoolList(d.rows || []);
        fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
          .then(function (t) { return (t && t.ok && +t.usd > 0) ? +t.usd : null; }, function () { return null; })
          .then(function (usd) { buildPoolsTable(d.rows || [], usd); });
      })
      .catch(function () { /* the card stays dashed, which is the honest default */ });
  }

  // ---- the issuer address, and who holds the token ------------------------------------------------
  //
  // Three separate pieces of this page were still the design's mock, and one of them was visible
  // without opening anything:
  //
  //   * the address row read "XRP Ledger  0x0e5e…32bc" — an EVM-shaped address under an XRP Ledger
  //     label, with a full 66-character 0x value behind it;
  //   * "Holders breakdown — 3,208 total" with an invented distribution, on a page whose own stat
  //     card two panels up says 1,200;
  //   * five top holders, each an 0x address tagged "Aptos · 1.48% of supply".
  //
  // ALL OF IT IS COMPUTABLE, exactly, from one place: the issuer's own trustlines. A trustline to
  // the issuer IS a holding, so account_lines on ISS enumerates every holder with their balance —
  // seen from the issuer, which owes them, so the balances come back negative. Paged, because there
  // are more than one page of them.
  var RPC = 'https://xrplcluster.com/';
  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); });
  }

  function shortAddr(a) { return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

  // Token quantities, in the compact form the design uses beside each holder ("29.6M").
  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function paintIssuer() {
    $$('.addr-value').forEach(function (e) {
      e.textContent = shortAddr(ISS);
      e.setAttribute('data-full', ISS);
      e.setAttribute('title', ISS);
    });
    // The copy control beside it carried the mock value too, so it copied an address for another
    // chain to the clipboard.
    $$('.addr-row [data-copy]').forEach(function (b) { b.setAttribute('data-copy', ISS); });
  }

  // "1M+ LUMOS", "1M – 5M", "250K – 1M", "Under 250K" -> the range each row counts.
  //
  // The first two OVERLAP as the design ships them, so every holder over 5M would be counted twice
  // and the four rows would not sum to the total. Relabelled to "5M+ LUMOS", which is the only
  // reading that makes the set disjoint and matches the descending order of the rest.
  function bucketRange(label) {
    var s = String(label || '').replace(/\s+/g, ' ').trim();
    function num(t) {
      var m = /([\d.]+)\s*([KM])?/i.exec(t); if (!m) return null;
      var v = parseFloat(m[1]);
      if (/k/i.test(m[2] || '')) v *= 1e3;
      if (/m/i.test(m[2] || '')) v *= 1e6;
      return v;
    }
    if (/^under/i.test(s)) return { lo: 0, hi: num(s) };
    var parts = s.split(/[–-]/);
    if (parts.length === 2) return { lo: num(parts[0]), hi: num(parts[1]) };
    return { lo: num(s), hi: Infinity };
  }

  function paintHolders(list) {
    if (!list) return;
    var total = list.length;

    $$('.h-head .meta').forEach(function (e) { e.textContent = total.toLocaleString('en-US') + ' total'; });

    var rows = $$('.wsize-row');
    // Disjoint tiers, top row first — see bucketRange.
    if (rows[0]) {
      var l0 = rows[0].querySelector('.wsize-label');
      if (l0 && /^1M\+/i.test((l0.textContent || '').trim())) l0.textContent = '5M+ LUMOS';
    }
    rows.forEach(function (row) {
      var lab = row.querySelector('.wsize-label');
      var cnt = row.querySelector('.wsize-count');
      var fill = row.querySelector('.wsize-bar .fill');
      if (!lab || !cnt) return;
      var r = bucketRange(lab.textContent);
      if (!r || r.lo == null) { cnt.textContent = '—'; return; }
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var b = list[i].bal;
        if (b >= r.lo && (r.hi == null || b < r.hi)) n++;
      }
      cnt.textContent = n.toLocaleString('en-US');
      if (fill) fill.style.width = Math.max(1, Math.round(n / Math.max(1, total) * 100)) + '%';
    });

    // The top holders. Percentages are of the ISSUED supply — the sum of what every holder holds —
    // which is what "% of supply" means for a token whose issuer is blackholed and can mint no more.
    var issued = 0;
    for (var k = 0; k < list.length; k++) issued += list[k].bal;
    var top = list.slice().sort(function (a, b) { return b.bal - a.bal; });
    $$('.top-holders .holder-row').forEach(function (row, i) {
      var h = top[i];
      var info = row.querySelector('.info');
      var chain = row.querySelector('.chain');
      if (!h) { row.style.display = 'none'; return; }
      row.style.display = '';
      // The address sits in .info as its own text/element; the first non-.chain child holds it.
      var addrEl = info && [].slice.call(info.children).filter(function (c) {
        return !c.classList || !c.classList.contains('chain');
      })[0];
      if (addrEl) { addrEl.textContent = shortAddr(h.addr); addrEl.setAttribute('title', h.addr); }
      if (chain) {
        var pct = issued > 0 ? (h.bal / issued * 100) : 0;
        // Stellar's line: the share alone — the page is already about one network.
        chain.textContent = (pct >= 0.01 ? pct.toFixed(2) : '<0.01') + '% of supply';
      }
      // THE ROWS STAYED SKELETONS (RAZA 2026-09-15: "Pools and holders tabs are not loading"). The inherited sheet
      // animates .holder-row:not([data-lxbuilt]) as a loading shimmer and hides its rank; Stellar marks a row built once
      // it holds a real holder. Ranks get Stellar's medals, the avatar an identicon, and the row opens the account.
      row.setAttribute('data-lxbuilt', '1');
      row.classList.add('lxlt');
      var rk = row.querySelector('.rk');
      if (rk) {
        if (i < 3) { rk.className = 'rk medal'; rk.innerHTML = medalSVG(i); }
        else { rk.className = 'rk'; rk.textContent = String(i + 1); }
      }
      var av = row.querySelector('.av');
      if (av) {
        av.removeAttribute('data-logo');
        av.setAttribute('data-logoed', '1');
        av.style.cssText = 'background:url("' + identUri(h.addr) + '") center center / cover no-repeat;box-shadow:none';
      }
      row.style.cursor = 'pointer';
      row.onclick = (function (ad) { return function () { window.location.href = '/account/xrpl/' + encodeURIComponent(ad); }; })(h.addr);

      // AND THE BALANCE BESIDE IT. Filling the percentage alone left "32.08% of supply" against the
      // mock's "29.6M LUMOS" — two numbers about the same holder that cannot both be true, which is
      // a worse read than either mock alone. The USD figure uses the same price the hero shows, so
      // the page cannot value the same token two ways.
      var hold = row.querySelector('.holdings');
      var vEl = hold && hold.querySelector('.v');
      var pEl = hold && hold.querySelector('.pct');
      if (vEl) vEl.textContent = amount(h.bal) + ' LUMOS';
      if (pEl) {
        var px = window.__lxxLumos && window.__lxxLumos.usd;
        pEl.textContent = (px != null && isFinite(px)) ? usd(h.bal * px) : '—';
      }
    });
  }

  // Paged, with a hard stop: a marker loop that never terminates would hammer the node.
  function loadHolders() {
    if (!$('.h-card') && !$('.top-holders')) return;             // not a page with these
    var acc = [], marker = null, pages = 0;
    function page() {
      var p = { account: ISS, limit: 400, ledger_index: 'validated' };
      if (marker) p.marker = marker;
      rpc('account_lines', p).then(function (r) {
        var res = r && r.result;
        var lines = (res && res.lines) || [];
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (l.currency !== CUR) continue;
          var v = Math.abs(Number(l.balance));
          if (v > 0) acc.push({ addr: l.account, bal: v });
        }
        marker = res && res.marker;
        if (marker && ++pages < 15) return page();
        paintHolders(acc);
        state.holders = acc.length;
        paintTabsAndLinks(window.__lxxLumos || null);
      }).catch(function () { /* leave the card as it is rather than half-write it */ });
    }
    page();
  }

  function load() {
    if (!$('.hero-price-block') && !$('.lh-stats')) return;      // not this page
    paintIssuer();
    loadHolders();
    // BOTH, THEN ONE FINAL PAINT. Each still paints as soon as it lands, so nothing waits on the
    // slower of the two to show something -- but the last word belongs to a paint that has seen both,
    // which is the only way the count and the price cannot overwrite each other.
    var pools = loadPools();
    var token = fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(ISS + '-' + CUR))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ok = d && d.ok ? d : null;
        window.__lxxLumos = ok;
        paint(ok);
      })
      .catch(function () { paint(null); });
    Promise.all([
      pools && pools.catch ? pools.catch(function () { return null; }) : null,
      token.catch(function () { return null; }),
    ]).then(function () { paint(window.__lxxLumos || null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxLTokenReload = load;
})();

// Price chart: a real line drawn from real candles.
//
// The design's chart SVG was built by `lx-ltdata`, so removing that Stellar layer left an empty
// 40x30 box where the chart had been. This draws its replacement from /lxapi/xrplohlc.
//
// WHAT IT WILL NOT DO. If the range comes back with fewer than two points there is no line to draw,
// and it says so rather than plotting a flat bar across the middle. A chart is a claim about how a
// price moved; a straight line through one point is a claim nobody made.
//
// Drawn as inline SVG rather than canvas so it scales with the container and inherits the page's
// colours, and because the logo healer on this page skips any element containing an svg.
(function () {
  if (window.__lxxChart) return;
  window.__lxxChart = 1;

  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // The one token this page is about. Other pages pass their own id via data-lxx-chart.
  var LUMOS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha-4C554D4F53000000000000000000000000000000';

  var state = { id: null, range: '7D', pts: [], vs: 'USD' };

  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v < 0.000001) return '$' + v.toExponential(2);
    if (v < 0.01) return '$' + v.toPrecision(4);
    if (v < 1000) return '$' + v.toFixed(4);
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function note(host, text) {
    host.innerHTML = '';
    var d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;'
      + 'min-height:140px;opacity:.6;font-size:13px';
    host.appendChild(d);
  }

  function draw(host, pts) {
    host.innerHTML = '';
    if (!pts || pts.length < 2) { note(host, 'No price history for this range.'); return; }

    var box = host.getBoundingClientRect();
    // The container can be collapsed at first paint; fall back to a sane aspect rather than
    // dividing by zero and emitting NaN path data, which renders as nothing at all.
    var W = Math.max(320, Math.round(box.width) || 640);
    var H = Math.max(150, Math.round(box.height) || 220);
    var padT = 10, padB = 10, padL = 2, padR = 2;

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    // A perfectly flat series would make the range zero and every y identical; give it a little
    // room so the line sits in the middle instead of on the floor.
    if (!(hi > lo)) { hi = lo * 1.0001 + 1e-12; lo = lo * 0.9999; }

    var x = function (i) { return padL + (i / (pts.length - 1)) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); };

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: '100%',
      preserveAspectRatio: 'none', role: 'img',
      'aria-label': 'Price chart, ' + state.range,
    });
    svg.style.display = 'block';

    var up = pts[pts.length - 1][1] >= pts[0][1];
    // A LITERAL colour, not var(--green). CSS custom properties are NOT valid in SVG presentation
    // attributes -- only in CSS declarations -- so stroke='var(...)' leaves the path with no colour
    // and the chart renders as an invisible 180-segment line. Everything measured fine: correct
    // box, correct viewBox, hit-testable. Only the screenshot showed it.
    // The brand accent, as lumoscore.com's LUMOS chart draws it — not green-or-red by direction.
    var stroke = '#ea6a2c';

    var gradId = 'lxxChartGrad';
    var defs = svgEl('defs');
    var g = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    g.appendChild(svgEl('stop', { offset: '0%', 'stop-color': stroke, 'stop-opacity': '0.28' }));
    g.appendChild(svgEl('stop', { offset: '100%', 'stop-color': stroke, 'stop-opacity': '0' }));
    defs.appendChild(g);
    svg.appendChild(defs);

    var line = '', area = '';
    for (var j = 0; j < pts.length; j++) {
      var px = x(j).toFixed(2), py = y(pts[j][1]).toFixed(2);
      line += (j ? 'L' : 'M') + px + ',' + py;
    }
    area = line + 'L' + x(pts.length - 1).toFixed(2) + ',' + (H - padB)
      + 'L' + x(0).toFixed(2) + ',' + (H - padB) + 'Z';

    // THE CLASSES ARE LOAD-BEARING, not decoration. lx-lt-css carries
    //     #priceChart svg path:not(.lx-cline):not(.lx-carea), ... { display:none !important }
    // which is how the old layer suppressed the design's mock chart markup while still showing the
    // two paths it drew itself. Inherit that contract: an unclassed path is hidden, so it has a
    // valid `d`, a real stroke and getTotalLength() of 1559 while painting absolutely nothing.
    // getBBox() reading 0x0 is the tell -- it does not compute for a display:none element, whereas
    // getTotalLength() happily does.
    svg.appendChild(svgEl('path', { d: area, class: 'lx-carea', fill: 'url(#' + gradId + ')' }));
    svg.appendChild(svgEl('path', {
      d: line, class: 'lx-cline', fill: 'none', stroke: stroke, 'stroke-width': '2',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }));
    svg.appendChild(svgEl('circle', {
      cx: x(pts.length - 1), cy: y(pts[pts.length - 1][1]), r: '3', fill: stroke,
    }));

    host.appendChild(svg);

    // THE NINTH ANTI-FLASH GATE. `#priceChart:not(.lxlt) svg{visibility:hidden}` ships in lx-lt-css,
    // and the class was added by lx-ltdata -- the layer this file replaces. So a chart with correct
    // data, a valid path and a real stroke colour still paints nothing, and everything that reads
    // the DOM says it is fine: 168 segments, hit-testable box, computed stroke rgb(229,72,77).
    // getBBox() reading 0x0 while getBoundingClientRect() read 928x214 was the only tell, because
    // getBBox does not compute for an unpainted element. Lift it here, after the draw, so the gate
    // still does its job of hiding the design's mock until real data has landed.
    host.classList.add('lxlt');

    wireHover(host, pts, W, H, x, y);
  }

  // THE HOVER CARD lumoscore.com draws (RAZA 2026-09-15: "there's no hover on chart like on Stellar"): a dot on the line,
  // a guide, and a card with the date, the price, the volume in dollars and the trade count. Its .lx-chtip / .lx-chdot /
  // .lx-chvl rules are inherited. Trades come from /lxapi/xrpltrades, fetched for the whole range when it draws, so a
  // hovered point either shows its count or no Trades row — never a placeholder.
  var TR = {};
  function whenLabel(t) {
    var d = new Date(t);
    if (state.range === '1H' || state.range === '24H') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (state.range === '7D') return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function compact(v) {
    if (!(v > 0)) return '$0';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return v >= 0.01 ? ('$' + v.toFixed(2)) : '<$0.01';
  }
  function wireHover(host, pts, W, H, x, y) {
    host.__lxxHov = { pts: pts, W: W, H: H, x: x, y: y };
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) {
      if (host.querySelector('.' + c)) return;
      var n = document.createElement('div');
      n.className = c;
      n.setAttribute('data-logoed', '1');
      n.style.opacity = '0';
      host.appendChild(n);
    });
    if (host.__lxxHovWired) return;
    host.__lxxHovWired = 1;
    function line(cls, t) {
      var n = document.createElement('div');
      n.className = cls;
      if (t != null) n.textContent = t;
      n.setAttribute('data-logoed', '1');
      return n;
    }
    function hide() {
      ['lx-chtip', 'lx-chdot', 'lx-chvl'].forEach(function (c) { var n = host.querySelector('.' + c); if (n) n.style.opacity = '0'; });
    }
    function move(cx) {
      var S = host.__lxxHov, svg = host.querySelector('svg');
      var tip = host.querySelector('.lx-chtip'), dot = host.querySelector('.lx-chdot'), vl = host.querySelector('.lx-chvl');
      if (!S || !svg || !tip || !dot || !vl || S.pts.length < 2) return;
      var r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (cx - r.left) / Math.max(1, r.width)));
      var idx = Math.round(frac * (S.pts.length - 1)), p = S.pts[idx];
      var lx = r.left - hr.left + S.x(idx) / S.W * r.width;
      var ly = r.top - hr.top + S.y(p[1]) / S.H * r.height;
      dot.style.left = lx + 'px'; dot.style.top = ly + 'px'; dot.style.opacity = '1';
      vl.style.left = lx + 'px'; vl.style.top = (r.top - hr.top) + 'px'; vl.style.bottom = 'auto';
      vl.style.height = r.height + 'px'; vl.style.opacity = '1';
      tip.textContent = '';
      tip.appendChild(line('d', whenLabel(p[0])));
      tip.appendChild(line('l', 'Price'));
      tip.appendChild(line('p', money(p[1])));
      var vol = (+p[5] || 0) * (XRP_USD || 0);               // volume is in XRP (see XRP_USD)
      var rv = line('lxrow');                                // shown for a quiet candle too, as "$0"
      rv.appendChild(line('l', 'Volume'));
      rv.appendChild(line('p', compact(vol)));
      tip.appendChild(rv);
      var step = S.pts[1][0] - S.pts[0][0];
      var te = idx < S.pts.length - 1 ? S.pts[idx + 1][0] : p[0] + step;
      var tkey = state.id + '|' + p[0] + '|' + te;
      tip.__lxxKey = tkey;
      var n = TR[tkey];
      var addTrades = function (cnt) {
        if (tip.querySelector('.lxx-trades-row')) return;
        var rt = line('lxrow lxx-trades-row');
        rt.appendChild(line('l', 'Trades'));
        rt.appendChild(line('p', cnt.toLocaleString('en-US')));
        tip.appendChild(rt);
      };
      if (n != null) addTrades(n);
      else {
        // A window the range fetch could not count (the upstream refuses bursts) is asked for on its own once the
        // pointer settles; the row is added when the number arrives, never as a placeholder.
        clearTimeout(host.__lxxTrT);
        host.__lxxTrT = setTimeout(function () {
          var parts = String(state.id || '').split('-');
          if (!parts[1] || TR[tkey] != null) return;
          fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(parts[0]) + '&cur=' + encodeURIComponent(parts[1])
            + '&s=' + p[0] + '&e=' + te)
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d || !d.ok || d.truncated || d.n == null) return;
              TR[tkey] = +d.n;
              if (tip.__lxxKey === tkey && tip.style.opacity === '1') addTrades(+d.n);
            }, function () {});
        }, 160);
      }
      if (XRP_USD == null && Date.now() - (host.__lxxRateAt || 0) > 15000) {
        host.__lxxRateAt = Date.now();
        fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
          .then(function (j) { if (j && j.ok && j.usd > 0) XRP_USD = j.usd; }, function () {});
      }
      tip.style.opacity = '1';
      var tw = tip.offsetWidth, th = tip.offsetHeight, tx = lx + 14;
      if (tx + tw > hr.width) tx = lx - tw - 14;
      if (tx < 2) tx = 2;
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(2, ly - th - 12) + 'px';
    }
    host.addEventListener('mousemove', function (e) { move(e.clientX); });
    host.addEventListener('mouseleave', hide);
    host.addEventListener('touchstart', function (e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX); }, { passive: true });
    host.addEventListener('touchmove', function (e) { var t = e.touches && e.touches[0]; if (t) move(t.clientX); }, { passive: true });
  }
  function prefetchTrades(pts) {
    if (!pts || pts.length < 2 || pts.length > 400) return;
    var parts = String(state.id || '').split('-'), iss = parts[0], cur = parts[1];
    if (!iss || !cur) return;
    var step = pts[1][0] - pts[0][0];
    var b = pts.map(function (q) { return q[0]; });
    b.push(pts[pts.length - 1][0] + step);
    var id0 = state.id, range0 = state.range;
    // Twelve windows per request (the endpoint's cap), three requests at a time.
    var starts = [];
    for (var s0 = 0; s0 < b.length - 1; s0 += 12) starts.push(s0);
    function worker() {
      if (!starts.length || id0 !== state.id || range0 !== state.range) return null;
      var i = starts.shift();
      var ch = b.slice(i, Math.min(b.length, i + 13));
      return fetch('/lxapi/xrpltrades?iss=' + encodeURIComponent(iss) + '&cur=' + encodeURIComponent(cur) + '&b=' + ch.join(','))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.n) d.n.forEach(function (n, j) { if (n != null) TR[id0 + '|' + ch[j] + '|' + ch[j + 1]] = n; });
        }, function () {})
        .then(worker);
    }
    worker(); worker(); worker();
  }

  // XRP/USD for the Volume line: xrplohlc's volume column is in XRP (its last 24 hourly values × XRP/USD equal the
  // token's published 24h volume; read as LUMOS they came to $0.00007).
  var XRP_USD = null;
  fetch('/lxapi/xrplprices').then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.usd > 0) XRP_USD = j.usd; }, function () {});
  // Read-only view of the hover's inputs, for checking the live page.
  window.__lxxChartState = function () { return { id: state.id, range: state.range, trades: Object.keys(TR).length, xrpUsd: XRP_USD }; };

  function load(range) {
    var host = $('#priceChart');
    if (!host) return;
    state.range = range || state.range;
    note(host, 'Loading price history…');

    fetch('/lxapi/xrplohlc?id=' + encodeURIComponent(state.id)
      + '&r=' + encodeURIComponent(state.range) + '&vs=USD')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { note(host, 'Price history is unavailable right now.'); return; }
        state.pts = d.pts || [];
        window.__lxxChartData = d;
        draw(host, state.pts);
      })
      .catch(function () { note(host, 'Price history is unavailable right now.'); });
  }

  // The range buttons are the design's own; match them by their label rather than by an attribute
  // they do not carry.
  function wireRanges() {
    var labels = ['1H', '24H', '7D', '30D', '1Y', 'ALL'];
    $$('button, .tf, .range-btn, [class*=tf] > *').forEach(function (b) {
      var t = (b.textContent || '').trim().toUpperCase();
      if (labels.indexOf(t) < 0) return;
      if (b.__lxx) return;
      b.__lxx = 1;
      b.addEventListener('click', function () {
        // Move the design's own active class with the selection.
        var sibs = b.parentElement ? b.parentElement.children : [];
        for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove('active');
        b.classList.add('active');
        load(t);
      });
    });
  }

  function boot() {
    var host = $('#priceChart');
    if (!host) return;                                   // not a page with this chart
    state.id = host.getAttribute('data-lxx-chart') || LUMOS;
    wireRanges();
    load(state.range);

    // Redraw when the container's WIDTH changes, not just when the window resizes.
    //
    // The path is computed in pixels against the box measured at draw time, so a draw that lands
    // while the card is still collapsed bakes in that width and never recovers -- the window never
    // resizes, so the old listener alone never fired. A ResizeObserver catches the case that
    // actually happens here: layout settling, a font landing, a tab panel opening.
    //
    // Guarded on a real change of at least 8px so the observer cannot re-trigger itself through the
    // draw it just caused, and skipped entirely at width 0, where there is nothing to measure.
    var last = 0, t = null;
    var redraw = function (w) {
      if (!w || Math.abs(w - last) < 8 || !state.pts.length) return;
      last = w;
      clearTimeout(t);
      t = setTimeout(function () { draw(host, state.pts); }, 60);
    };
    if (window.ResizeObserver) {
      new ResizeObserver(function (entries) {
        redraw(Math.round(entries[0].contentRect.width));
      }).observe(host);
    }
    window.addEventListener('resize', function () {
      redraw(Math.round(host.getBoundingClientRect().width));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.__lxxChartReload = load;
})();

