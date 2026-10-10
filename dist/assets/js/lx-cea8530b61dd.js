
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

// Explorer links, in one place.
//
// RAZA, 2026-09-08: "in recent activity, no explorer link icon on right... use bithomp for explorer
// links on XRPL just like we have stellar.expert on Stellar."
//
// The Stellar build puts an external-link mark at the end of every activity row, pointing at
// stellar.expert. The fork inherited the STYLING for that — `.activity-feed-row .lx-actlink` is in
// the dashboard's stylesheet, faded to 45% and lifting on row hover — and none of the markup, so
// every feed here ends at the timestamp.
//
// WHY THIS IS A FILE AND NOT THREE LINES IN EACH FEED. The dashboard and the wallet paint separate
// feeds from separate modules, and the thing they would each have to hold is a base URL. This
// project has been bitten by exactly that: the fee collector's address is injected and
// checksum-verified at build time rather than written into browser sources, because two copies of a
// constant are two chances to be wrong and only one of them gets updated. An explorer base is not
// as costly to get wrong as a payout address, but it is the same shape of mistake — and if Bithomp
// ever changes its paths, this is the only line that moves.
//
// The URL is /explorer/<value>, which is Bithomp's universal resolver: it takes a transaction hash,
// an r-address or a username. NOTE: bithomp.com sits behind a bot challenge that does not clear for
// an automated browser, so the rendered page could not be checked from here — the path survives the
// challenge without being rewritten or 404'd, and it is Bithomp's documented shape, but the first
// real click is the confirmation.
(function () {
  if (window.lxxExplorer) return;

  var BASE = 'https://bithomp.com/explorer/';
  var NS = 'http://www.w3.org/2000/svg';

  function url(v) { return v ? BASE + encodeURIComponent(String(v)) : ''; }

  // The design's own external-link mark, the same one the Stellar feed uses.
  function icon(size) {
    var s = String(size || 13);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', s); svg.setAttribute('height', s);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
    var pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', '15 3 21 3 21 9');
    var ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', '10'); ln.setAttribute('y1', '14');
    ln.setAttribute('x2', '21'); ln.setAttribute('y2', '3');
    svg.appendChild(p); svg.appendChild(pl); svg.appendChild(ln);
    return svg;
  }

  // The wallet's feed rows are `.activity-row`, which the inherited stylesheet says nothing about —
  // it only styles the dashboard's `.activity-feed-row`. Same declarations, so the mark reads the
  // same in both feeds rather than being a slightly different grey in one of them. Injected once.
  function styleOnce() {
    if (document.getElementById('lxx-explorer-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-explorer-css';
    st.textContent = '.activity-row .lx-actlink{margin-left:12px;flex:0 0 auto;display:inline-flex;'
      + 'align-items:center;color:var(--text-muted);text-decoration:none;opacity:.45;'
      + 'transition:opacity .14s ease,color .14s ease}'
      + '.activity-row:hover .lx-actlink{opacity:1}'
      + '.activity-row .lx-actlink:hover{color:var(--accent)}';
    (document.head || document.documentElement).appendChild(st);
  }

  // An <a> for a hash or address, or null when there is nothing to link to — a mark that opens the
  // explorer's "not found" page is worse than no mark.
  function link(value, title) {
    if (!value) return null;
    styleOnce();
    var a = document.createElement('a');
    a.className = 'lx-actlink';
    a.href = url(value);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = title || 'View on Bithomp';
    a.setAttribute('aria-label', a.title);
    // These rows are clickable themselves; without this the row's own handler runs too.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    a.appendChild(icon(13));
    return a;
  }

  // A transaction's hash is `hash` on the v1 envelope and on the tx itself, and moves to the
  // envelope in v2 — the same split that left the feed empty once already, so both are read.
  function txHash(entry) {
    if (!entry) return '';
    var tx = entry.tx || entry.tx_json || {};
    return entry.hash || tx.hash || (entry.tx && entry.tx.hash) || '';
  }

  window.lxxExplorer = { url: url, icon: icon, link: link, txHash: txHash, BASE: BASE };
})();

// Wallet page: real XRP Ledger balances, on desktop AND mobile.
//
// Written as a FILE and injected verbatim, never assembled as a string in the transform. Every
// escaping accident in the Stellar project came from browser code living inside quoted strings --
// a template literal ate the backslashes out of a regex and shipped it inert, an SVG's quotes closed
// the string it sat in and crashed the transform. A file has no layers to survive.
//
// TWO RENDERERS, because the two designs are not the same markup:
//   desktop  <tbody id="assetsTable">   table rows, 5 columns
//   mobile   <div  id="assetList">      .asset-row cards
// Writing only the desktop one is the single most repeated bug in the Stellar project -- a fix aimed
// at a desktop selector silently does nothing on the phone, and it caused at least five separate
// reports there. Whichever container exists is the one that gets filled.
//
// Depends on window.lxx (xrpl-core.js), injected immediately above and byte-identical to the file the
// node tests run against, so the currency and reserve rules cannot drift between test and page.
(function () {
  if (window.__lxxWallet) return;
  window.__lxxWallet = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // THE DESIGN'S NUMBERS GO BEFORE THEY CAN BE READ (RAZA 2026-09-17: "there's a flash bug when i refresh. It shows that i
  // have 5 assets and 2 pools for split seconds"). The markup ships "5 holdings · 31,108.45 APT total" with tab counts of 5
  // and 2, and this layer only overwrote them once the ledger answered — a second or two of someone else's portfolio on
  // every refresh. Cleared as this file runs, which is before anything is painted.
  (function blankHeaderMock() {
    [].forEach.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) { c.textContent = ''; });
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta, h3 .meta'), function (m) {
      if (/holding|APT|Aptos|active|total/i.test(m.textContent || '')) m.textContent = '';
    });
  })();

  // RETRIED ONCE, and that is not belt-and-braces. This page now runs four layers that each talk to
  // the ledger on load -- balances, the fee tier, connect, and prices -- and a public node drops one
  // of a simultaneous burst. The symptom is the whole asset list replaced by 'Could not read the XRP
  // Ledger' while the very same request succeeds by hand a second later. A transient failure that
  // leaves a permanent empty state is the worst kind, because it looks like a broken page.
  function rpc(method, params, attempt) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }).catch(function (e) {
      // actNotFound is a real answer about a real account, not a dropped request: do not retry it.
      if ((attempt || 0) > 0 || /actNotFound/i.test(e && e.message)) throw e;
      return new Promise(function (r) { setTimeout(r, 700); })
        .then(function () { return rpc(method, params, 1); });
    });
  }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // textContent everywhere for ledger-supplied values: a currency name is arbitrary bytes off a public
  // ledger and anyone can issue one containing markup.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- the asset mark ------------------------------------------------------------------------------
  //
  // RAZA, 2026-09-08: "in Wallet -> my assets -> the asset logos are missing."
  //
  // They were, and the design was never the problem. The container carries the styling for both
  // marks — the table's `.asset-id .ico.lx-aico`, which paints from a `--ic` custom property and
  // draws `data-l` in an ::after, and the card's 38px `.asset-ico` disc. This layer simply was not
  // building either of them: the table row had NO mark at all and used two classes of its own
  // invention (`.asset-nm`, `.asset-sb`) that the stylesheet has no rules for, which is also why
  // that column looked unstyled beside every other list on the site.
  //
  // Neither mark holds text of its own, and that is what keeps the page's logo engine off them: it
  // repaints any element carrying one to five characters, and a letter drawn by a pseudo-element is
  // not text it can see.
  var XRP_LOGO_ID = '84e5efeb89c4eae8f68188982dc290d8';

  // WHERE THE ID COMES FROM. Every other list on this site takes a logo id from an API row, because
  // it is listing tokens the API just ranked. This lists what an ACCOUNT holds, and a holding is
  // often nowhere near any ranking — so there is no row to read it from. The id turns out to be
  // md5(issuer + "_" + currency), verified against all 50 rows of /lxapi/xrpltokens with no
  // mismatches, and the edge derives it (JS has no MD5 and Web Crypto omits it). XRP is the native
  // asset and sits outside that scheme, so its id is the one that has to be written down.
  function thumb(tok, w) {
    if (!tok) return '/lxapi/xrplthumb?id=' + XRP_LOGO_ID + '&w=' + w;
    if (!tok.issuer || !tok.currency) return '';
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(tok.issuer)
      + '&cur=' + encodeURIComponent(tok.currency) + '&w=' + w;
  }

  // A stable colour per ticker, so a mark waiting on its image is never a grey hole and two
  // different tokens never read as the same one.
  function hue(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  // ---- probing, deferred and throttled ------------------------------------------------------------
  //
  // 350 HOLDINGS IS A REAL WALLET, and one probe per row fired at once does not work. A browser
  // keeps about six connections to a host, so the rest queue — and a timeout meant to measure "is
  // there a logo?" ends up measuring "how long did this wait behind 300 other requests?".
  //
  // Measured on an account with 349 trustlines: 310 of 350 rows fell back to a letter. Four of
  // them were then requested directly — STX, LAWAS, PEPE, WIND — and all four answered 200. Every
  // one of those marks existed. Nothing was missing; they had simply timed out in the queue, which
  // would have shipped as "the logos are still missing".
  //
  // So a probe waits until its row is near the viewport, and then only a few run at a time. A
  // wallet shows about ten rows at once, so what you can see resolves immediately and the other
  // three hundred cost nothing until they are scrolled to.
  //
  // AND THE WHOLE QUEUE STOPS WHEN THE UPSTREAM SAYS SO. Measured on the deployed build, 2026-10-05: a
  // wallet holding 65 tokens asks for 65 marks, and xrpl.to answered 429 to roughly half of them — six
  // at a time is a burst it will not serve. A 429 is not a fact about a token, it is "ask me later", so
  // the answer is to ask later rather than to ask harder: the first one pauses every pending probe for
  // a few seconds and drops the width to two. Total requests go DOWN, not up, which is the point — a
  // per-row retry against a rate limit is just a second way to be refused.
  var Q = [], active = 0, MAXQ = 6, HOLD = 0, HOLDT = 0;
  function pump() {
    if (!Q.length) return;
    var wait = HOLD - Date.now();
    if (wait > 0) {
      if (!HOLDT) HOLDT = setTimeout(function () { HOLDT = 0; pump(); }, wait + 50);
      return;
    }
    while (active < MAXQ && Q.length) { active++; (Q.shift())(); }
  }
  function done1() { active--; pump(); }
  // TUNED AGAINST THE REAL LIST, not guessed. The first attempt — a five-second pause and two in flight
  // — was measured on a 65-holding wallet and left 62 rows still queued after half a minute, which is
  // the bug again wearing a different face: a mark nobody waits for is a mark nobody sees. 2.5s and
  // three in flight clears the same list while staying well inside what the upstream will serve.
  function backOff() { HOLD = Date.now() + 2500; MAXQ = 3; }

  // Runs cb once, when the element comes within a screen of the viewport.
  //
  // MEASURED, NOT OBSERVED, and deliberately so. IntersectionObserver is the obvious tool and was
  // the first implementation — but if it does not report, nothing is ever probed and EVERY mark
  // stays a letter, which is a worse version of the bug this is fixing. A feature whose failure
  // mode is "the thing you asked for never appears" should not be load-bearing, and this one does
  // not have to be: a rect check on scroll is a few hundred reads, it works in every browser, and
  // it is directly testable.
  //
  // The rows also live inside .assets-card, which is its OWN scroll container — 558px tall over
  // 28,000px of rows — so the listener is on document in the capture phase, where an inner
  // container's scroll is seen just as well as the window's.
  var WAIT = [], sweeping = false, wired = false;

  function sweep() {
    sweeping = false;
    if (!WAIT.length) return;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    var keep = [];
    for (var i = 0; i < WAIT.length; i++) {
      var w = WAIT[i];
      if (!document.contains(w.node)) continue;               // row replaced; drop it
      var r = w.node.getBoundingClientRect();
      // Within one screen above or below, and actually laid out.
      if (r.height > 0 && r.bottom > -400 && r.top < h + 400) w.run();
      else keep.push(w);
    }
    WAIT = keep;
  }

  // setTimeout, NOT requestAnimationFrame. rAF does not fire while the page is not being rendered,
  // and `sweeping` is cleared by the sweep itself — so a scheduled frame that never arrives latches
  // this permanently and no mark is ever probed again. Measured: every row stayed unprobed with the
  // rAF version. A timer owes nothing to the compositor.
  function schedule() {
    if (sweeping) return;
    sweeping = true;
    setTimeout(sweep, 16);
  }

  function near(node, cb) {
    WAIT.push({ node: node, run: cb });
    if (!wired) {
      wired = true;
      // Capture phase, so an inner container's scroll is seen as well as the window's.
      document.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      // AND a poll, because the scroll listener is an optimisation rather than the mechanism. Rows
      // are appended after this first runs, layout is not final on the first frame, and a row can
      // come into view without any scroll at all — a tab switching, a section expanding, the list
      // being filtered. The poll is what makes "it eventually resolves" true independently of any
      // event firing; it stops the moment nothing is waiting.
      var iv = setInterval(function () {
        if (!WAIT.length) { clearInterval(iv); return; }
        schedule();
      }, 400);
    }
    schedule();
  }

  // PROBE, THEN PAINT — never letter-then-logo.
  //
  // The obvious shape is to draw the initial at once and replace it when the image lands, and that
  // is what the Stellar wallet does. It is also precisely the bug just fixed on the Stellar
  // dashboard: a hundred marks each drawn twice, which reads as the section glitching for seconds
  // after every load. So a mark is painted once, when its fate is known. The disc keeps its colour
  // meanwhile, so nothing looks empty, and the initial is drawn if the image fails or is slow.
  // 429 IS NOT "THIS TOKEN HAS NO LOGO" (RAZA 2026-10-05: "On Wallet page --> My assets: why isn't
  // LUMOS logo shown"). Measured on the deployed build: half the thumbnail requests a 65-holding wallet
  // makes come back 429, every one of those rows drew a letter, and none of them ever asked again — the
  // marks were all there, the wallet simply took a refusal as an answer. Asked by hand a second later,
  // the same urls are 200.
  //
  // AN <img> CANNOT TELL A 429 FROM A 404. Both arrive as `onerror`, which is why this looked for a
  // year like missing artwork rather than a rate limit, and why the fix had to change the probe: a
  // fetch can read the status. The mark is still painted through the stylesheet, and that costs nothing
  // extra — the answer is immutable for a week, so the url() that follows is a browser-cache hit.
  //
  //   200        the mark exists; paint it
  //   400 / 404  a real answer about this token: it has none, draw the letter and stop asking
  //   anything else (429, 5xx, a dropped request) is about the MOMENT, so the row waits and asks again
  //
  // A 429 holds the whole queue rather than spinning this row alone (see pump()), and it is counted
  // separately from a dropped request: "ask me later" said six times is still a logo that exists, while
  // six silent failures in a row is a network that is not going to answer. Measured on a cold cache,
  // sixty-five holdings: three attempts left two rows lettered, both of them 429s that had simply not
  // got to the front of the line yet.
  function paintMark(node, setLogo, setLetter, url) {
    if (!url) { setLetter(); return; }
    var tries = 0, held = 0;
    function go() {
      Q.push(function () {
        var fired = false;
        // This times the REQUEST, not a wait behind three hundred of them.
        var t = setTimeout(function () { settle(0); }, 8000);
        function settle(status) {
          if (fired) return;
          fired = true;
          clearTimeout(t);
          done1();
          if (status === 200) { setLogo(url); return; }
          if (status === 400 || status === 404 || status === 415) { setLetter(); return; }
          if (status === 429 ? ++held > 6 : ++tries > 3) { setLetter(); return; }
          if (status === 429) backOff();
          setTimeout(go, status === 429 ? 1500 : 1200);
        }
        fetch(url).then(function (r) {
          var st = r.status;
          var img = /^image\//.test(r.headers.get('content-type') || '');
          // Drain the body, so the bytes land in the browser's own cache and the url() that follows is
          // a hit. A failed read is still an answer about the status, so it settles either way.
          return r.blob().then(function (b) {
            // A 200 THAT IS NOT AN IMAGE IS NOT A LOGO (RAZA 2026-10-05: "lumos logo in Wallet --> My
            // assets is not showing up at all"). The endpoint was handing back a Cloudflare Access login
            // page under content-type image/png: the status said success, so this painted url(…) over a
            // thing no browser can decode, and the row ended up with no mark AND no letter — the one
            // outcome worse than either. Checked here as well as at the edge, because a blank disc gives
            // the next person nothing to go on.
            return (st === 200 && (!img || !b || b.size < 64)) ? 415 : st;
          }, function () { return st; });
        }).then(settle, function () { settle(0); });
      });
      pump();
    }
    near(node, go);
  }

  // THE VERIFIED TICK (RAZA 2026-09-16: "Also add verification tick for LUMOS on all other places where it should be").
  // The same span, glyph and class the market table and the search rows use, so the inherited .lx-vtick rule styles it;
  // the sizing is inline as well because this page's sheet does not carry that rule.
  var LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
  function vtick() {
    var s = el('span', 'lx-vtick');
    s.title = 'Verified issuer';
    s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;margin-left:5px;border-radius:50%;background:#2fb46a;color:#fff;vertical-align:middle;flex:none';
    s.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return s;
  }

  // WHICH HOLDINGS GET ONE (RAZA 2026-10-05: "verification ticks missing on most like Army and phnix.
  // they're already in our curated list"). They are: both sit in the roster the Trade page lists, and
  // this page was ticking exactly one issuer — LUMOS, hardcoded — so every other holding read as
  // unvetted beside it.
  //
  // THE RULE IS THE TRADE PAGE'S RULE, deliberately, because that table is what "our curated list"
  // means on this build: the live top of the XRP Ledger market from /lxapi/xrpltokens, with LUMOS
  // pinned into it. Two surfaces disagreeing about whether a token is verified is worse than either
  // answer on its own. The same caveat recorded in trade.js applies here and is not re-argued: the
  // roster is ranked by volume, not vetted by anyone, so the tick means "we list it". If it is ever to
  // mean verification again, a real issuer+currency allowlist replaces VSET and both surfaces follow.
  //
  // NOT xrpl.to's own `vf` flag, which the search rows use: it is 0 for both ARMY and PHNIX, so
  // reading it here would have answered RAZA's report with "working as intended" and no ticks.
  //
  // Rows are painted before this lands, so the tick is applied twice — inline when a row is built, and
  // again over the whole table once the roster arrives. The key lives on the name node in `data-lxvk`,
  // which is also what lets the second pass find rows without re-rendering them.
  var VSET = null;
  function isVerified(tok) {
    if (!tok || !tok.issuer) return false;              // XRP itself is the ledger, not an issuance
    if (tok.issuer === LUMOS_ISS) return true;          // pinned, exactly as in the Trade table
    return !!(VSET && VSET[tok.issuer + '|' + String(tok.currency || '').toUpperCase()]);
  }
  function markVerified(host, tok) {
    if (!host || !tok || !tok.issuer) return;
    host.setAttribute('data-lxvk', tok.issuer + '|' + String(tok.currency || '').toUpperCase());
    if (isVerified(tok) && !host.querySelector('.lx-vtick')) host.appendChild(vtick());
  }
  function applyTicks() {
    [].forEach.call(document.querySelectorAll('[data-lxvk]'), function (h) {
      var k = h.getAttribute('data-lxvk') || '';
      var ok = k.slice(0, k.indexOf('|')) === LUMOS_ISS || !!(VSET && VSET[k]);
      var has = h.querySelector('.lx-vtick');
      if (ok && !has) h.appendChild(vtick());
      else if (!ok && has && has.parentNode) has.parentNode.removeChild(has);
    });
  }
  fetch('/lxapi/xrpltokens?n=100')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var s = {};
      [].forEach.call((d && d.rows) || [], function (t) {
        if (t && t.i && t.c) s[t.i + '|' + String(t.c).toUpperCase()] = 1;
      });
      VSET = s;
      applyTicks();
    })
    .catch(function () {});

  // ---- rows, per design ---------------------------------------------------------------------------
  function tableRow(name, sub, right, rightSub, frozen, tok) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxkey', tok ? (name + '-' + tok.issuer) : 'XRP');
    var c1 = el('td');
    var aid = el('div', 'asset-id');
    var ico = el('div', 'ico lx-aico');
    ico.style.setProperty('--ic', hue(name));
    try { ico.setAttribute('data-logoed', '1'); } catch (e) {}
    paintMark(ico, function (u) {
      ico.style.setProperty('--ic', 'url("' + u + '")');
      ico.setAttribute('data-l', '');
      ico.classList.add('lx-din');
    }, function () {
      ico.setAttribute('data-l', (name || '?').slice(0, 1).toUpperCase());
    }, thumb(tok, 48));
    aid.appendChild(ico);
    var meta = el('div', 'meta');
    var nm = el('div', 'nm');
    plain(nm, name + (frozen ? ' (frozen)' : ''));
    markVerified(nm, tok);
    meta.appendChild(nm);

    // STELLAR'S ROW (RAZA 2026-09-15: "My assets section is different on Stellar"), read off lumoscore.com:
    // the native asset's sub-line is "Stellar · native"; a token's is its issuer, shortened, with a copy
    // button — `.lx-asb`, `.lx-iss`, `.lx-isscopy`, all styled by the inherited sheet. The price cell
    // is `.p1.lx-p1` plus the price in the native asset, the balance cell is `.b1` over "≈ $x" in
    // `.b2`, and the actions carry their icons and a third, icon-only button.
    var sb = el('div', 'sb');
    if (!tok) {
      sb.appendChild(el('span', 'lx-asb-t', 'XRP Ledger · native'));
    } else {
      var asb = el('span', 'lx-asb');
      asb.setAttribute('data-vk', name + '|' + tok.issuer);
      var iss = el('span', 'lx-iss', short(tok.issuer));
      iss.title = tok.issuer;
      asb.appendChild(iss);
      var cp = el('button', 'lx-isscopy');
      cp.type = 'button';
      cp.setAttribute('data-iss', tok.issuer);
      cp.setAttribute('aria-label', 'Copy issuer address');
      cp.title = 'Copy issuer address';
      cp.innerHTML = ICON_COPY;
      asb.appendChild(cp);
      sb.appendChild(asb);
    }
    meta.appendChild(sb);
    aid.appendChild(meta);
    c1.appendChild(aid);
    tr.appendChild(c1);
    tr.appendChild(el('td', 'price-cell', '—'));        // prices.js fills it
    // `spark-cell` IS THE CLASS THAT HIDES THIS COLUMN, as on Stellar — see the note in prices.js.
    tr.appendChild(el('td', 'spark-cell'));
    var c4 = el('td', 'right balance-cell');
    c4.appendChild(el('div', 'b1', right));
    c4.appendChild(el('div', 'b2', ''));
    // XRP's spendable/reserved split stays available on hover; Stellar's row has no line for it.
    if (rightSub) c4.title = rightSub;
    tr.appendChild(c4);
    var c5 = el('td', 'right');
    c5.appendChild(rowActions(name, tok));
    tr.appendChild(c5);
    return tr;
  }

  // COLUMN 5 WAS 260px OF NOTHING ON EVERY ROW. lumoscore.com fills it — read off the live table, it
  // holds `.row-quick-actions` with two `.qa-row-btn` buttons, Trade and Send. The design's own
  // classes and its own column; nothing is styled or invented here.
  function rowActions(name, tok) {
    var wrap = el('div', 'row-quick-actions');

    var trade = el('button', 'qa-row-btn');
    trade.innerHTML = ICON_TRADE + ' Trade';
    trade.type = 'button';
    // TRADE OPENS A CHOICE, IT DOES NOT NAVIGATE (RAZA 2026-10-02: "When im tapping on Trade button, it
    // should show me 'Swap, Trade on Dex' options like it does on Stellar. On XRPL, it just takes me to
    // the asset trade page").
    //
    // There are two different things someone means by "trade this holding" — the order book, and an
    // instant swap — and the button was silently picking one. The menu is the same .lx-rowmenu the
    // kebab opens, so there is one menu implementation on this page rather than two.
    //
    // XRP keeps an empty issuer here: it has no asset page of its own, and the DEX item falls back to
    // the market for it.
    trade.setAttribute('data-lxtrade', (name || 'XRP') + '|' + ((tok && tok.issuer) || ''));
    wrap.appendChild(trade);

    // A HOLDING OF NOTHING OFFERS THE TRUST LINE BACK (RAZA 2026-09-16: "If i have 0 of any asset, then there should be
    // remove trustline button just like on Stellar"). Stellar puts it where Send sits, and Send on an empty holding has
    // nothing to send anyway. Each trustline reserves 0.2 XRP, so removing one hands that back.
    if (tok && !(tok.balance > 0) && !tok.frozen) {
      // STELLAR'S EXACT BUTTON (RAZA 2026-09-17: "the remove trustline button is not the same as on Stellar"): class
      // `qa-row-btn lx-rmtrust` with a trash glyph — and this build already carries the rule that paints that icon red
      // (`#assetsTable .qa-row-btn.lx-rmtrust svg{stroke:var(--red)}`), which my own class and link icon never triggered.
      var tl = el('button', 'qa-row-btn lx-rmtrust');
      tl.innerHTML = ICON_TRUSTLINE + ' Trustline';
      tl.type = 'button';
      tl.title = 'Remove this trustline and free its 0.2 XRP reserve';
      tl.setAttribute('data-lxrmtl', (tok.currency || '') + '|' + tok.issuer + '|' + name);
      wrap.appendChild(tl);
    } else {
      // SEND WORKS ON EVERY ROW (RAZA 2026-09-15: "Why's send button inactive"). The Send dialog's picker
      // (write.js) holds tokens as well as XRP, so the row opens it on its own asset, as lumoscore.com does.
      var send = el('button', 'qa-row-btn');
      send.innerHTML = ICON_SEND + ' Send';
      send.type = 'button';
      send.setAttribute('data-lxsend', tok ? ((tok.currency || '') + '|' + tok.issuer + '|' + name) : 'XRP');
      wrap.appendChild(send);
    }

    // The third, icon-only button Stellar's row ends on. It opens Stellar's row menu — View asset, Pin to
    // top, Copy issuer address, View on Explorer (RAZA 2026-09-15: "instead of opening the dropdown, it
    // opens up bithomp").
    var more = el('button', 'qa-row-btn icon-only');
    more.type = 'button';
    more.innerHTML = ICON_MORE;
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('data-lxmenu', tok ? (name + '|' + tok.issuer) : 'XRP');
    wrap.appendChild(more);
    return wrap;
  }

  // Setting the limit to zero on a holding of nothing is what closes a trustline: the ledger deletes the line and gives
  // the 0.2 XRP reserve back. It is refused while any balance remains, which is why the button only appears on an empty
  // row. Signed with the same wallet path as every other write on this site.
  function removeTrustline(btn) {
    var parts = (btn.getAttribute('data-lxrmtl') || '').split('|');
    var cur = parts[0], iss = parts[1], code = parts[2] || 'the asset';
    var me = addr();
    if (btn.getAttribute('data-busy') === '1' || !cur || !iss || !me) return;
    if (!window.lxc || !window.lxc.submit) { toast('Connect a wallet first.'); return; }
    var label = btn.innerHTML;
    btn.setAttribute('data-busy', '1');
    btn.textContent = 'Approve…';
    window.lxc.submit({
      TransactionType: 'TrustSet', Account: me,
      LimitAmount: { currency: cur, issuer: iss, value: '0' }
    }).then(function () {
      btn.textContent = 'Removing…';
      toast(code + ' trustline removed');
      // The ledger validates in a few seconds; the list is read again rather than edited in place.
      setTimeout(function () { btn.removeAttribute('data-busy'); btn.innerHTML = label; load(); }, 5000);
    }, function (err) {
      btn.removeAttribute('data-busy');
      btn.innerHTML = label;
      var m = (err && err.message) || '';
      toast(/reject|denied|cancel/i.test(m) ? 'Cancelled' : 'The trustline could not be removed.');
    });
  }

  // Stellar hides this header at RUNTIME — its `th` carries an inline `display:none`, and there is no
  // stylesheet rule for it in either build, which is why grepping the CSS found nothing. Same thing
  // here, so the column disappears completely instead of standing empty over hidden cells.
  function hideSparkHead() {
    var body = document.getElementById('assetsTable');
    var tbl = body && body.closest ? body.closest('table') : null;
    if (!tbl) return;
    var ths = tbl.querySelectorAll('thead th');
    if (ths.length > 2) ths[2].style.display = 'none';
  }

  // The row buttons have to be claimed on WINDOW CAPTURE, for the same reason the trade and pools
  // rows are: the design claims clicks anywhere in a list page and routes them through its own
  // resolver, and a bubble-phase listener on the button never runs first.
  function claimRowActions() {
    if (window.__lxxWalletActs) return;
    window.__lxxWalletActs = 1;
    window.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var go = t.closest('[data-lxgo]');
      if (go) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = go.getAttribute('data-lxgo');
        return;
      }

      var tb = t.closest('[data-lxtrade]');
      if (tb) { e.preventDefault(); e.stopImmediatePropagation(); openTradeMenu(tb); return; }
      var mb = t.closest('[data-lxmenu]');
      if (mb) { e.preventDefault(); e.stopImmediatePropagation(); openRowMenu(mb); return; }
      var pb = t.closest('[data-lxpmenu]');
      if (pb) { e.preventDefault(); e.stopImmediatePropagation(); openPoolMenu(pb); return; }
      var mi = t.closest('.lx-rowmenu [data-lxmi]');
      if (mi) { e.preventDefault(); e.stopImmediatePropagation(); rowMenuAct(mi); return; }
      var pi = t.closest('.lx-rowmenu [data-lxpi]');
      if (pi) { e.preventDefault(); e.stopImmediatePropagation(); poolMenuAct(pi); return; }
      if (!t.closest('.lx-rowmenu')) closeRowMenu();

      // THE WALLET CHIP'S LINK ICON opens this account on Bithomp (RAZA 2026-09-15), as Stellar's opens it on
      // stellar.expert. Found by its external-link glyph, the way Stellar's layer finds it.
      var xb = t.closest('.wallet-chip button, .wallet-chip a, .hero-id-row button, .hero-id-row a');
      var xpoly = xb && xb.querySelector('polyline');
      if (xb && ((xb.getAttribute('title') || '') === 'Explorer' || (xpoly && /^15\s+3\s+21\s+3\s+21\s+9$/.test((xpoly.getAttribute('points') || '').trim())))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (addr()) window.open('https://bithomp.com/explorer/' + encodeURIComponent(addr()), '_blank', 'noopener');
        return;
      }

      var ex = t.closest('[data-lxexp]');
      if (ex) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var xv = ex.getAttribute('data-lxexp');
        if (xv) window.open('https://bithomp.com/explorer/' + encodeURIComponent(xv), '_blank', 'noopener');
        return;
      }
      var cpb = t.closest('.lx-isscopy');
      if (cpb) {
        e.preventDefault();
        e.stopImmediatePropagation();
        copyText(cpb.getAttribute('data-iss') || '');
        return;
      }

      var tlb = t.closest('[data-lxrmtl]');
      if (tlb) { e.preventDefault(); e.stopImmediatePropagation(); removeTrustline(tlb); return; }

      var sd = t.closest('[data-lxsend]');
      if (sd) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Opens the page's OWN Send dialog by clicking the header button that already does it, so
        // whichever of the two modal sets is live (this page ships a desktop and a mobile copy) is
        // the one that opens, and nothing here duplicates that logic.
        // write.js reads this when the dialog opens and selects the row's asset.
        window.__lxxSendPre = sd.getAttribute('data-lxsend') || 'XRP';
        var btns = document.querySelectorAll('.quick-actions .qa-btn');
        for (var i = 0; i < btns.length; i++) {
          if (/^\s*send\s*$/i.test(btns[i].textContent || '')) { btns[i].click(); return; }
        }
      }
    }, true);
  }

  // Stellar's row icons, copied off lumoscore.com's live table (RAZA 2026-09-15: "the send and trade icon is
  // different on XRPL"): a candlestick chart for Trade, a paper plane for Send, at 11px; the kebab at 12px.
  var SVG_OPEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON_TRADE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M8 6v3"></path><rect x="6" y="9" width="4" height="6" rx="1"></rect><path d="M8 15v3"></path><path d="M16 4v2"></path><rect x="14" y="6" width="4" height="9" rx="1"></rect><path d="M16 15v3"></path></svg>';
  var ICON_SEND = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  // The trash glyph lumoscore.com uses on this button, copied from its own markup so the two builds draw the same row.
  var ICON_TRUSTLINE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
  var ICON_MORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

  // ---- the row menu ----------------------------------------------------------------------------------
  // Stellar's .row-menu, built the way lumoscore.com builds it: fixed-position under the kebab, a child of
  // body, four actions with a divider before the explorer link. The inherited sheet styles it.
  // Figures the way Stellar's pool rows print them: whole units past 100K, one decimal past 1K, two below.
  function lpAmt(v) {
    v = Number(v);
    if (!(v > 0)) return '0';
    var dp = v >= 100000 ? 0 : (v >= 1000 ? 1 : (v >= 1 ? 2 : 6));
    return v.toLocaleString('en-US', { maximumFractionDigits: dp });
  }

  var PIN_KEY = 'lumos.pinned';
  function pinnedList() {
    try { var v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function closeRowMenu() {
    [].forEach.call(document.querySelectorAll('.lx-rowmenu'), function (m) { if (m.parentNode) m.parentNode.removeChild(m); });
  }
  function menuSvg(inner) {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  function openRowMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;                                       // a second click on the same kebab closes it
    var key = btn.getAttribute('data-lxmenu') || 'XRP';
    var parts = key.split('|'), code = parts[0], iss = parts[1] || '';
    var pinKey = iss ? (code + '-' + iss) : 'XRP';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    var h = '<button type="button" data-lxmi="view">' + menuSvg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>') + ' View asset</button>'
      + '<button type="button" data-lxmi="pin">' + menuSvg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>')
      + (pinnedList().indexOf(pinKey) >= 0 ? ' Unpin' : ' Pin to top') + '</button>';
    if (iss) h += '<button type="button" data-lxmi="copy">' + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>') + ' Copy issuer address</button>';
    h += '<div class="divider"></div>'
      + '<button type="button" data-lxmi="explorer">' + menuSvg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>') + ' View on XRPL Explorer</button>';
    m.innerHTML = h;
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 170;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
    if (!window.__lxxRowMenuClose) {
      window.__lxxRowMenuClose = 1;
      window.addEventListener('scroll', closeRowMenu, true);
      window.addEventListener('resize', closeRowMenu);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRowMenu(); });
    }
  }
  // THE LIQ POOLS KEBAB IS A MENU, NOT A LINK (RAZA 2026-10-06: "clicking on 3 dots icon on the right is
  // taking me to bithomp when it should actually open the dropdown for 'View pool details' and 'Copy pool
  // address'. Please compare with Stellar").
  //
  // The asset rows got their menu and the pool rows did not: that third button was simply given
  // `data-lxexp` and a "View on Bithomp" tooltip, so the kebab beside a pool behaved differently from the
  // identical kebab one tab away.
  //
  // Two items, matching lumoscore.com. The design's own definition for an `lp` row carries THREE —
  // "View pool details", "View transaction history", "Copy pool address" — read out of the live
  // lx-aed79fbe3c71.js; Stellar ships the first and the last, which is also what RAZA's screenshot shows,
  // so the middle one is left out here too rather than invented for XRPL alone. The icons are the
  // design's: the info circle and the copy rectangles.
  //
  // The explorer is NOT kept as a third item. Nothing about the pool page is missing from it, and the
  // kebab's job here is the two actions Stellar offers.
  function openPoolMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var acct = btn.getAttribute('data-lxpmenu') || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxpool', acct);
    m.innerHTML =
      '<button type="button" data-lxpi="details">'
      + menuSvg('<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>')
      + ' View pool details</button>'
      + '<button type="button" data-lxpi="copy">'
      + menuSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>')
      + ' Copy pool address</button>';
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))) + 'px';
    m.style.visibility = '';
  }

  function poolMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var acct = (m && m.getAttribute('data-lxpool')) || '';
    var what = item.getAttribute('data-lxpi');
    closeRowMenu();
    if (!acct) return;
    if (what === 'details') window.location.href = '/pools/xrpl/id/' + encodeURIComponent(acct);
    else if (what === 'copy') copyText(acct);
  }

  // The Trade button's two-item menu, in the same shell the kebab uses so it inherits the design's
  // surface, placement and dismissal. Two lines per item, as Stellar's has: what it is, and what it is
  // for — "Order book & charts" against "Instant swap" is the whole distinction being offered.
  function openTradeMenu(btn) {
    var open = document.querySelector('.lx-rowmenu');
    var again = open && open.__lxFor === btn;
    closeRowMenu();
    if (again) return;
    var parts = (btn.getAttribute('data-lxtrade') || 'XRP|').split('|');
    var code = parts[0], iss = parts[1] || '';
    var m = document.createElement('div');
    m.className = 'row-menu open lx-rowmenu lx-trademenu';
    m.__lxFor = btn;
    m.setAttribute('data-lxcode', code);
    m.setAttribute('data-lxiss', iss);
    m.innerHTML =
      '<button type="button" data-lxmi="dex"><span class="lx-tmt">Trade on DEX</span>'
      + '<span class="lx-tms">Order book &amp; charts</span></button>'
      + '<button type="button" data-lxmi="swap"><span class="lx-tmt">Swap</span>'
      + '<span class="lx-tms">Instant swap</span></button>';
    if (!document.getElementById('lx-trademenu-css')) {
      var st = document.createElement('style');
      st.id = 'lx-trademenu-css';
      // STELLAR'S NUMBERS, READ OFF ITS OWN SOURCE (RAZA 2026-10-06: "On XRPL, the text is larger than
      // what we have on Stellar. please compare").
      //
      // The two menus were never the same object. lumoscore.com builds this one in its own shell,
      // `.lx-trmenu` (_walletdata.js), which sets `font:700 13px/1.25` on the button and 11.5px/600
      // muted on the sub-line. This build reuses the design's `.row-menu` — the shell the kebab beside
      // it uses — whose button is 18.7px/500, and only ever overrode the sub-line. So the title came out
      // at 18.7px against Stellar's 13px, which is the whole report.
      //
      // The SHELL is deliberately left as `.row-menu`: it is the design's own surface, placement and
      // dismissal, and it matches the kebab menu sitting next to it on the same row. Only the type is
      // brought into line.
      //
      // `.row-menu.lx-trademenu button` rather than `.lx-trademenu button`, because the latter ties
      // 0-1-1 with `.row-menu button` and would then be decided by source order — and `_externalize.js`
      // hoists every `lx-*` stylesheet into <head>, so source order is not something to rely on.
      st.textContent = '.row-menu.lx-trademenu button{display:flex;flex-direction:column;align-items:flex-start;'
        + 'gap:1px;font:700 13px/1.25 "Hanken Grotesk",system-ui,sans-serif}'
        + '.row-menu.lx-trademenu .lx-tmt{font-weight:700}'
        + '.row-menu.lx-trademenu .lx-tms{font-weight:600;font-size:11.5px;opacity:1;'
        + 'color:var(--text-muted,#8b90a0)}';
      (document.head || document.documentElement).appendChild(st);
    }
    m.style.position = 'fixed';
    m.style.visibility = 'hidden';
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), mw = m.offsetWidth || 190, mh = m.offsetHeight || 96;
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.top = Math.round(top) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.left))) + 'px';
    m.style.visibility = '';
  }

  function rowMenuAct(item) {
    var m = item.closest('.lx-rowmenu');
    var code = m.getAttribute('data-lxcode'), iss = m.getAttribute('data-lxiss') || '';
    var what = item.getAttribute('data-lxmi');
    closeRowMenu();
    if (what === 'dex') {
      window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
      return;
    }
    if (what === 'swap') {
      // The one swap implementation on this page. If it is not wired yet — a cold load — the DEX page
      // is the honest fallback rather than a button that does nothing.
      var opened = false;
      try { opened = typeof window.__lxxOpenSwap === 'function' && window.__lxxOpenSwap(); } catch (e) {}
      if (!opened) window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
      return;
    }
    if (what === 'view') {
      window.location.href = iss ? ('/trade/xrpl/' + encodeURIComponent(code + '-' + iss)) : '/trade/xrpl';
    } else if (what === 'copy') {
      copyText(iss);
    } else if (what === 'explorer') {
      var target = iss || addr();
      if (target) window.open('https://bithomp.com/explorer/' + encodeURIComponent(target), '_blank', 'noopener');
    } else if (what === 'pin') {
      var k = iss ? (code + '-' + iss) : 'XRP', list = pinnedList(), at = list.indexOf(k);
      if (at >= 0) list.splice(at, 1); else list.unshift(k);
      try { localStorage.setItem(PIN_KEY, JSON.stringify(list)); } catch (e) {}
      applyPins();
    }
  }
  // Pinned rows go to the top of My Assets, newest pin first, each with Stellar's star badge.
  function applyPins() {
    var tb = document.getElementById('assetsTable');
    if (!tb) return;
    var list = pinnedList();
    [].forEach.call(tb.querySelectorAll('tr[data-lxkey]'), function (tr) {
      var on = list.indexOf(tr.getAttribute('data-lxkey')) >= 0;
      tr.classList.toggle('lx-pinned', on);
      var nm = tr.querySelector('.nm'), bd = nm && nm.querySelector('.lx-pin-badge');
      if (on && nm && !bd) {
        bd = document.createElement('span');
        bd.className = 'lx-pin-badge';
        bd.title = 'Pinned';
        bd.setAttribute('data-logoed', '1');
        bd.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>';
        nm.appendChild(bd);
      } else if (!on && bd) {
        bd.parentNode.removeChild(bd);
      }
    });
    for (var i = list.length - 1; i >= 0; i--) {
      var row = tb.querySelector('tr[data-lxkey="' + String(list[i]).replace(/"/g, '') + '"]');
      if (row) tb.insertBefore(row, tb.firstChild);
    }
  }
  try { window.__lxxApplyPins = applyPins; } catch (e) {}
  var ICON_COPY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  // Balances the way Stellar prints them: whole units past a thousand, cents above one, and enough
  // precision below one that a small holding does not read as zero.
  function balTxt(v) {
    v = Number(v);
    if (!isFinite(v)) return '—';
    if (v >= 1000) return fmt(v, 0);
    if (v >= 1) return fmt(v, 2);
    return fmt(v, 6);
  }

  function copyText(text) {
    if (!text) return;
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    } catch (e) { fallback(); }
    toast('Copied to clipboard');
  }

  // Stellar's bottom-centre toast, the same element the rest of the site uses.
  function toast(msg) {
    if (!document.getElementById('lx-copytoast-css')) {
      var st = document.createElement('style');
      st.id = 'lx-copytoast-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}';
      document.head.appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast';
    t.appendChild(Object.assign(document.createElement('span'), { className: 'ci', textContent: '✓' }));
    t.appendChild(Object.assign(document.createElement('span'), { textContent: msg || 'Copied to clipboard' }));
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1800);
  }

  // A token mark inside an activity row's label: Stellar's `.lx-act-ilogo`, painted from a CSS variable.
  function actLogo(a) {
    var s = el('span', 'lx-act-ilogo');
    var u = (a && a.issuer) ? thumb({ issuer: a.issuer, currency: a.currency }, 32) : thumb(null, 32);
    ['--al', '--ic', '--lxlogo'].forEach(function (k) { s.style.setProperty(k, 'url("' + u + '")'); });
    s.setAttribute('data-l', '');
    s.setAttribute('data-logoed', '1');
    return s;
  }

  function card(name, sub, right, rightSub, frozen, tok) {
    var row = el('div', 'asset-row');
    var top = el('div', 'asset-top');
    // EVERY ROW'S BADGE READ "L". This builder wrote the token's first two letters, but the page's
    // logo layer repaints any short-text element from the surrounding words, and those words include
    // the site's own name — so XRP, LUMOS, XYIELD and SLT all ended up wearing the same LUMOS "L",
    // four different tokens rendered as one. plain() claims the element so what we draw stands.
    var ico = el('div', 'asset-ico');
    plain(ico, '');                                   // claim it first: plain() clears background
    ico.style.background = hue(name);
    paintMark(ico, function (u) {
      ico.style.backgroundImage = 'url("' + u + '")';
      ico.style.backgroundSize = 'cover';
      ico.style.backgroundPosition = 'center';
      ico.textContent = '';
    }, function () {
      ico.textContent = (name || '?').slice(0, 2).toUpperCase();
    }, thumb(tok, 48));
    top.appendChild(ico);
    var meta = el('div', 'asset-meta');
    var nr = el('div', 'asset-name-row');
    var anm = el('span', 'asset-name');
    plain(anm, name + (frozen ? ' (frozen)' : ''));
    nr.appendChild(anm);
    // The phone's card carried no tick at all — not LUMOS's either — so the two renderers disagreed
    // about every holding. Same rule, same node shape, so applyTicks() reaches both.
    markVerified(nr, tok);
    meta.appendChild(nr);
    meta.appendChild(el('div', 'asset-sub', sub || ''));
    top.appendChild(meta);
    var bal = el('div', 'asset-balance-block');
    bal.appendChild(el('div', 'v1', right));
    if (rightSub) bal.appendChild(el('div', 'v2', rightSub));
    top.appendChild(bal);
    row.appendChild(top);
    return row;
  }

  // BOTH containers exist on every wallet page -- the design keeps a table and a card list and shows
  // one by media query. Taking whichever is found first would fill the hidden one and leave the
  // visible one empty, which on a phone looks exactly like the page failing to load.
  // getClientRects() cannot be used to decide: both are EMPTY at this point and so have no rects.
  function hidden(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  function host() {
    var t = $('#assetsTable'), l = $('#assetList');
    if (t && !hidden(t)) return { node: t, kind: 'table' };
    if (l && !hidden(l)) return { node: l, kind: 'cards' };
    if (t) return { node: t, kind: 'table' };
    if (l) return { node: l, kind: 'cards' };
    return null;
  }

  // The mobile design ships an anti-flash gate inherited from the Stellar build:
  //     body:not(.lxmw-ready) #assetList { visibility: hidden }
  // and it lifts only when window.__lxWalletEarly / __lxWalletReady is set -- flags that belonged to
  // Stellar's wallet data layer, which does not exist here. Left alone the phone renders a page that
  // is fully populated and completely invisible: 65 correct cards, correct colours, opacity 1, and
  // nothing on screen. Nothing in the console, because nothing is wrong.
  //
  // This layer is now the thing that fills that list, so it is the thing that says it is ready. Set
  // BOTH: the flag, for the design's own pass() when it runs after us, and the class, for when it has
  // already run. Called before the first note(), so the loading and error messages are visible too --
  // they live inside the gated container.
  // THE SAME TRAP HAS A SECOND DOOR, and stripping the Stellar layer is what closed it. lx-walletdata
  // is gone but its STYLESHEET stays -- a stripped script takes its markup and its logic with it and
  // leaves every rule it relied on standing. Four of those rules wait on a class only that script ever
  // set:
  //     body:not(.lx-wd-ready) .value-side .sub-value          { visibility: hidden }
  //     body:not(.lx-wd-ready) .asset-tabs .cnt                { visibility: hidden }
  //     body:not(.lx-wd-ready) h2 .meta, h3 .meta              { visibility: hidden }
  //     body:not(.lx-wd-ready) .insight-card ... .headline,.sub{ visibility: hidden }
  //
  // So the USD sub-total, all four tab counts and the holdings summary were computed correctly, written
  // correctly, and invisible -- reading them back through the DOM returned the right strings the whole
  // time, which is exactly why this survived several rounds of checking. Only a screenshot showed the
  // tabs with no numbers on them.
  //
  // This layer fills those elements now, so it raises the flag for them, the same way it does the
  // mobile one directly above.
  function lift() {
    try {
      window.__lxWalletReady = 1;
      document.body.classList.add('lxmw-ready');
      document.body.classList.add('lx-wd-ready');
    } catch (e) {}
  }

  function note(h, text) {
    h.node.innerHTML = '';
    if (h.kind === 'table') {
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 5;
      td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
      tr.appendChild(td);
      h.node.appendChild(tr);
    } else {
      var d = el('div', null, text);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
    }
  }

  function setMeta(held, pools, xrp) {
    var n = held + (xrp ? 1 : 0);
    // The summary line is NOT written here any more. This used to take $('.section-heading .meta') —
    // the first match — and the first .section-heading on this page is Open Orders, so the holdings
    // summary landed on the orders section while My Assets kept its mock. setChip() writes every
    // summary, scoped to the headings that are actually about holdings; doing it in one place is what
    // stops the two from disagreeing.
    // THE COUNTS WERE CROSS-WIRED. '.asset-tabs .cnt' also matches the two tabs buildTabs() inserts —
    // Open orders and Claimable payments — and they come FIRST in the DOM. So [0] and [1] were writing
    // the holdings count into "Open orders" and the pool count into "Claimable payments", which is why
    // this account showed "Open orders 10" (its 10 holdings) and "Claimable payments 0" (its 0 pools),
    // while Assets and Liq Pools kept the design's 5 and 2. Every number on that row was wrong and two
    // of them looked plausible.
    //
    // Excluded by .lx-wcgroup, the marker buildTabs() stamps on its own group. Stellar carries the
    // identical guard for the identical reason; matching its name keeps one contract across both
    // builds rather than two selectors that happen to agree today.
    var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
      return !(c.closest && c.closest('.lx-wcgroup'));
    });
    if (cnt[0]) cnt[0].textContent = String(n);
    if (cnt[1]) cnt[1].textContent = String(pools);
  }

  function paint(data) {
    var h = host();
    if (!h) return;
    h.node.innerHTML = '';
    var make = h.kind === 'table' ? tableRow : card;

    // XRP first, carrying the number people actually need: what is spendable once the reserve is out.
    if (data.xrp) {
      var rs = data.xrp.reserved != null
        ? (fmt(data.xrp.spendable, 6) + ' spendable · ' + fmt(data.xrp.reserved, 2) + ' reserved')
        : 'reserve unknown';
      // null marks the native asset: it has no issuer, so its logo id cannot be derived.
      h.node.appendChild(make('XRP', 'XRP Ledger', balTxt(data.xrp.balance) + ' XRP', rs, false, null));
    }

    data.held.sort(function (a, b) { return b.balance - a.balance; });
    for (var i = 0; i < data.held.length; i++) {
      var t = data.held[i];
      h.node.appendChild(make(t.display, short(t.issuer), balTxt(t.balance) + ' ' + t.display, '', t.frozen, t));
    }

    if (!data.held.length && !data.xrp) note(h, 'Nothing held on this account yet.');
    hideSparkHead();
    claimRowActions();
    setMeta(data.held.length, data.pools.length, data.xrp);
    setChip();
    clearTotalMock();
    revealAll();
  }

  // Releases the page's card-reveal gate on the containers this layer fills.
  //
  // The design fades sections in on scroll. Its driver takes a snapshot of what to watch ONCE, at
  // DOMContentLoaded, and drops anything that is hidden at that instant — so an element the wallet
  // gates until its data lands is never observed, and when the gate finally lifts the reveal rule is
  // still holding it at opacity 0. Nothing re-runs. The section is then invisible for good.
  //
  // .assets-card is where that landed: the whole My Assets card, 560px of correct, priced, real
  // holdings, on a blank screen. It answers every DOM query — ten rows, right numbers, opacity 1 on
  // the rows themselves — because the zero is on the container. That is why this needed a screenshot
  // to find and could not have been caught by reading the page.
  //
  // Safe to call broadly: this only clears an opacity gate. An element hidden for a real reason —
  // display:none on the inactive Liq Pools panel — stays hidden, because that is a different rule.
  function revealAll() {
    var SEL = '.hero, .insight-card, .assets-card, .lp-card, .orders-block, .orders-stack';
    [].forEach.call(document.querySelectorAll(SEL), reveal);
  }

  // Blanks the Total Portfolio headline the moment real rows are painted.
  //
  // prices.js fills this block properly, but it needs a price fetch first, so for roughly two seconds
  // the largest number on the page read "31,108.45 APT" — a fabricated Aptos figure sitting above ten
  // real XRP Ledger holdings. Worse, when that fetch is slow or fails the mock never gets overwritten
  // at all: on one load it was still showing nine seconds in, which is indefinitely as far as anyone
  // reading the page is concerned.
  //
  // So the mock is cleared here rather than merely overwritten later. An em dash reads as "not in yet"
  // and is self-evidently not a balance; a stale number from another chain reads as your money. This
  // layer knows the holdings but not their prices, so it cannot fill the total itself — it can only
  // make sure nothing false occupies the slot while prices.js is on its way.
  // THE HERO'S TOTAL EXISTS IN TWO SHAPES, and only one was ever addressed.
  //
  // Desktop is `.value-side` wrapping `.value` / `.sub-value`. The PHONE has no `.value-side` at
  // all — it is `.portfolio-value` (with the unit in a `.unit` span) and `.portfolio-sub`. So both
  // the clear below and prices.js's paintTotal returned on their first line, and a phone showed the
  // design's mock permanently: "31,108.45 APT" as the largest number on the page, "≈ $12,847.62
  // USD" under it, "+11.08%" and "+3,114.20 APT" beside it. Four fabricated figures describing
  // someone's holdings, on the wallet page, in another chain's asset, and never replaced.
  //
  // Resolved in ONE place and published, because prices.js needs exactly the same four elements and
  // two copies of this lookup is two things to update when a variant changes.
  function totalBlock() {
    var vs = $('.value-side');
    if (vs && vs.querySelector('.value')) {
      return {
        root: vs, value: vs.querySelector('.value'), sub: vs.querySelector('.sub-value'),
        pill: vs.querySelector('.delta-pill'), secondary: vs.querySelector('.delta-secondary')
      };
    }
    var pv = $('.portfolio-value');
    if (!pv) return null;
    return {
      root: pv.parentElement || pv, value: pv, sub: $('.portfolio-sub'),
      pill: $('.delta-pill'), secondary: $('.delta-secondary')
    };
  }
  try { window.lxxTotals = totalBlock; } catch (e) {}

  function clearTotalMock() {
    var b = totalBlock();
    if (!b || b.root.getAttribute('data-lxxcleared')) return;
    var v = b.value;
    if (v) {
      var unit = v.querySelector('span');
      var first = v.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = '— ';
      else v.insertBefore(document.createTextNode('— '), v.firstChild);
      if (unit) unit.textContent = 'XRP';
    }
    if (b.sub) b.sub.textContent = '';
    if (b.pill) { b.pill.style.visibility = 'hidden'; }
    if (b.secondary) b.secondary.textContent = '';
    b.root.setAttribute('data-lxxcleared', '1');

    // prices.js may already have fetched and given up because this list was still empty when its
    // response landed. Nudging it here closes that race from the side that knows the rows now exist.
    try { if (window.__lxxPricesApply) window.__lxxPricesApply(); } catch (e) {}
  }

  // The header chip shipped showing the design's mock address, `0x09c7…a802` — an EVM-shaped string
  // on an XRP Ledger wallet page, sitting above this account's real balances. Whatever else is wrong
  // on a page, the address it claims to be showing must be the one that is connected.
  function setChip() {
    var a = addr();
    if (!a) return;
    var chip = $('.wallet-chip .text') || $('.wallet-chip .addr');
    if (chip && chip.textContent.trim() !== short(a)) chip.textContent = short(a);
    // `.hero-id-row .wallet-chip .text:not(.lxp)` is hidden by the inherited sheet — which is the
    // "wallet address is empty" top left (RAZA 2026-09-15). Written correctly, never released.
    if (chip) chip.classList.add('lxp');
    // "COPIED TO CLIPBOARD", as lumoscore.com says (RAZA 2026-09-15). The design's copy handler builds its toast from
    // data-copy-label — "Wallet address copied to clipboard" — so the label is removed from the address controls.
    [].forEach.call(document.querySelectorAll('.wallet-chip [data-copy-label], .hero-id-row [data-copy-label]'), function (b) {
      b.removeAttribute('data-copy-label');
    });

    // THE PAGE HAS MORE THAN ONE HOLDINGS SUMMARY. setMeta writes $('.section-heading .meta'), which
    // is the FIRST match — and a second one lives in another .section-heading further down, so it kept
    // the mock "5 holdings · 31,108.45 APT total" while the list beneath it was already correct.
    // querySelector returning the first of several is the quiet version of this bug; take them all.
    var d = window.__lxxData;
    if (!d) return;
    var n = d.held.length + (d.xrp ? 1 : 0);
    // Stellar's wording: "3 Holdings | Total worth: ~326 XLM". The worth arrives with prices (prices.js).
    var line = n + (n === 1 ? ' Holding' : ' Holdings')
      + (window.__lxxWorthXrp > 0 ? (' | Total worth: ~' + Math.round(window.__lxxWorthXrp).toLocaleString('en-US') + ' XRP') : '');
    [].forEach.call(document.querySelectorAll('.section-heading .meta, h2 .meta'), function (m) {
      // Only summaries, never an activity row's own .meta (which is "From r… · 06:16").
      if (!/holding|APT|Aptos/i.test(m.textContent || '')) return;
      // AND ONLY THE ONES ABOUT HOLDINGS. Matching on the mock's text alone was too loose: the Open
      // Orders heading shipped its own meta reading "3,442 APT", which matched, so that section
      // announced "10 holdings · 15.57 XRP" above a list of orders. The test has to be what the
      // section IS, not what its placeholder happened to say.
      var head = m.closest('.section-heading, h2, h3');
      // The heading's title WITHOUT its own .meta. Reading head.textContent whole was circular: the
      // meta is inside the heading, so once anything had written "10 holdings" into it, the heading
      // matched /holding/ and kept qualifying on every later pass — the guard authorised exactly the
      // write it was meant to prevent.
      var title = '';
      if (head) {
        [].forEach.call(head.childNodes, function (nd) {
          if (nd.nodeType === 1 && nd.classList && nd.classList.contains('meta')) return;
          title += (nd.textContent || '') + ' ';
        });
      }
      if (!/asset|holding|portfolio|balance/i.test(title)) {
        // Not a holdings summary — but it still held an Aptos figure ("3,442 APT") that nothing on
        // this build fills. Leaving it would trade one wrong number for another, so it is emptied.
        if (/APT|Aptos/i.test(m.textContent || '')) m.textContent = '';
        return;
      }
      m.textContent = line;
    });
  }
  try { window.__lxxSetChip = setChip; } catch (e) {}

  // ---- Open orders and Claimable -------------------------------------------------------------------
  // Both tabs were driven by Stellar layers (lx-qorders, lx-wclaim) that queried horizon.stellar.org
  // and could only ever come back empty here. Those are stripped; these read the XRP Ledger.
  //
  // THE TABS ARE NOT IN THE MARKUP, which cost a deploy to learn. Reading the built page for
  // ".lx-wctab" found it and I took that for design markup — but every hit was a CSS rule and this
  // file's own selector. On Stellar the bar is BUILT AT RUNTIME by _walletclaim.js, so stripping that
  // layer took the Open orders and Claimable tabs off the page entirely, and the painters below had
  // nothing to write into. The check that would have caught it is querySelector in a live page, not
  // grep in a built one: markup you can find in the HTML and markup a script creates look identical
  // in a text search and are opposites in the DOM.
  //
  // So the bar is rebuilt here, structurally identical to Stellar's — same classes, same copy, same
  // two insight cards folded away — which is why it inherits lx-qorders-css and lx-wclaim-css and
  // looks the same. This is a port of the same layer, not a new design.
  //
  // "Claimable payments" is Stellar's claimable-balance feature, which this ledger does not have, so the
  // tab is NOT built here (RAZA 2026-09-15: "remove the claimable tab on XRPL"). Open orders stands alone.
  function selectTab(which) {
    var tabs = document.querySelectorAll('.lx-wctab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-t') === which);
    }
    var o = $('.lx-wcpanel-orders'), c = $('.lx-wcpanel-claim');
    if (o) { if (which === 'orders') o.removeAttribute('hidden'); else o.setAttribute('hidden', ''); }
    if (c) { if (which === 'claim') c.removeAttribute('hidden'); else c.setAttribute('hidden', ''); }
  }

  function buildTabs() {
    // The desktop wraps these three cards in .insights-rail and the phone in .insights-stack. Both,
    // or the tabs appear on one device only.
    var stack = $('.insights-stack,.insights-rail');
    if (!stack || $('.lx-wctabs')) return;

    // Found by what they SAY, not by position: the stack's order is the design's to change.
    var cards = [].slice.call(stack.querySelectorAll('.insight-card'));
    var ordersCard = null, poolsCard = null;
    cards.forEach(function (c) {
      var t = ((c.querySelector('.ttl') || {}).textContent || '').trim();
      if (/open orders/i.test(t)) ordersCard = c;
      if (/liquidity pools/i.test(t)) poolsCard = c;
    });
    if (!ordersCard && !poolsCard) return;
    // These two shipped reading "3 Active" and "3,442 APT" — mock figures on an XRP Ledger account.
    // The tabs replace them and carry the real counts, so the mocks go with the cards.
    if (ordersCard) ordersCard.style.display = 'none';
    if (poolsCard) poolsCard.style.display = 'none';

    var bar = document.createElement('div');
    bar.className = 'asset-tabs-row lx-wctabs';
    // lx-wcgroup is load-bearing, and it is Stellar's own fix for the bug this file hit independently:
    // reusing .asset-tabs is what makes these tabs match the Assets / Liq Pools pair exactly, but it
    // puts a SECOND .asset-tabs group on the page, and setMeta addresses that class by index. The
    // marker lets it exclude this group by name instead of hoping about DOM order.
    bar.innerHTML = '<div class="asset-tabs lx-wcgroup">'
      + '<button class="lx-wctab active" type="button" data-t="orders">Open orders'
      + ' <span class="cnt">0</span></button>'
      + '</div>';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.lx-wctab');
      if (b) selectTab(b.getAttribute('data-t'));
    });

    // The orders list the page already ships becomes the first panel; the second is ours. Desktop
    // ships .orders-block, the phone ships .orders-stack — take whichever is here.
    var orders = $('.orders-block') || $('.orders-stack');
    var host = orders ? orders.parentNode : stack.parentNode;
    var anchor = orders || stack.nextSibling;

    var pOrders = document.createElement('div'); pOrders.className = 'lx-wcpanel lx-wcpanel-orders';

    host.insertBefore(bar, anchor);
    host.insertBefore(pOrders, anchor);
    if (orders) {
      // The list's own heading comes with it where there is one, so the tab does not end up floating
      // above a section title that repeats what the tab already says. Only the duplicated title text
      // is hidden; anything else in that header (a Cancel all control) stays reachable.
      var head = orders.previousElementSibling;
      if (head && /open orders/i.test(head.textContent || '') && head.querySelector('h2,h3')) {
        var hh = head.querySelector('h2,h3');
        if (hh) hh.style.display = 'none';
        pOrders.appendChild(head);
      }
      pOrders.appendChild(orders);
    }

    // "CANCEL ALL" MOVES ONTO THE TAB ROW (RAZA 2026-09-17: "place the cancel all button aligning with Claimable payments
    // (but on right side)"). It belongs to the heading this layer hides, so it was left sitting on a line of its own above
    // the tabs. Re-parented, not restyled — the design's own button, at the end of the row the tabs are on.
    // Searched across the page, not inside the panel: the control lives in its own `.section-heading .right`, a sibling of
    // the orders list rather than a child of it, so looking only within the panel found nothing.
    var cancel = null;
    [].slice.call(document.querySelectorAll('.section-heading .ctrl-btn, .section-heading button, .section-heading a')).forEach(function (b) {
      if (!cancel && /cancel all/i.test(b.textContent || '')) cancel = b;
    });
    if (cancel) {
      bar.style.display = 'flex';
      bar.style.alignItems = 'center';
      bar.style.gap = '10px';
      cancel.style.marginLeft = 'auto';
      bar.appendChild(cancel);
    }

    // Always opens on Open orders: it is the list with money at stake and an action attached.
    selectTab('orders');
  }

  function setTab(which, n) {
    var t = document.querySelector('.lx-wctab[data-t="' + which + '"] .cnt');
    if (t) t.textContent = String(n);
  }

  // Fills one cloned .order-row from one account_offers entry.
  //
  // WRITTEN AFTER FLATTENING IT ONCE. The first version set .order-pair's textContent, which replaced
  // the two token circles, the pair name and the Buy/Sell pill with a single string — the row rendered
  // as "997,393.739396 XYIELD → 9,973.937392 XRP Price 0.0142 APT Amount 10,000 USDT" because the real
  // pair had eaten the design's structure while the three mock columns beside it were never touched.
  // Every field the design ships gets written or removed here; none is left holding another chain's
  // numbers, and none is written by destroying the element that held it.
  //
  // XRPL semantics: an offer says "I give taker_gets, I want taker_pays". From the owner's side that
  // is always a SELL of taker_gets, so the pill is fixed — there is no buy-side offer to mirror.
  // Sets short text on an element the LOGO ENGINE would otherwise claim.
  //
  // The page carries a 76KB unnamed layer (window.__lumosLogoEngine) that treats ANY element holding
  // one to five characters as a ticker badge: it paints a logo into the background and empties the
  // text. It re-runs a few seconds after load, so writing the text once is not enough.
  //
  // It cost a deploy to find, because the failure looks like nothing. The Buy/Sell pill came back
  // EMPTY with a Tether logo behind it — the mock row said "10,000 USDT", the engine had already
  // claimed that row's pill and stamped data-logo="USDT" on it, and cloning the row as a template
  // carried the stamp onto every real order. Setting .textContent afterwards was undone on the
  // engine's next pass, because its own test short-circuits on that attribute:
  //     if (el.getAttribute('data-logo')) return true;
  //
  // So the stamp is what has to go, not just the text. Once it is gone the element is judged on its
  // content, and neither "Sell" nor a single letter matches any symbol it knows, so it is left alone.
  function plain(el, text) {
    try {
      el.removeAttribute('data-logo');
      el.style.background = '';
      el.style.backgroundImage = '';
      // data-logoed is the engine's OWN "already handled, leave alone" marker — it skips such nodes
      // exactly as it skips an <svg> or an <img>. Claiming the element with its own contract is a far
      // better opt-out than smuggling an SVG in to look unappetising, and it survives its re-runs.
      el.setAttribute('data-logoed', '1');
    } catch (e) {}
    el.textContent = text;
  }

  var DOMS = {};
  function domainFor(t, cb) {
    var k = t.issuer + '-' + t.currency;
    if (!DOMS[k]) {
      DOMS[k] = fetch('/lxapi/xrpltoken?id=' + encodeURIComponent(k))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var dm = (d && d.ok && d.domain) ? String(d.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
          if (t.issuer === 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha') return 'lumoscore.com';
          dm = dm.split(':')[0].toLowerCase().replace(/^www\./, '');
          var dp = dm.split('.');
          return dp.length > 2 ? dp.slice(-2).join('.') : dm;
        })
        .catch(function () { return ''; });
    }
    DOMS[k].then(cb);
  }
  if (!window.__lxxVasset) {
    window.__lxxVasset = 1;
    window.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a.lx-vasset[href^="/trade/xrpl/"]');
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = a.getAttribute('href');
    }, true);
  }

  function orderRow(tpl, o) {
    var row = tpl.cloneNode(true);

    // data-oid IS WHAT MAKES THE ROW VISIBLE, and its absence is invisible in every way that matters.
    // The design ships an anti-flash gate:
    //     .orders-block .order-row:not([data-oid]) { display: none }
    // whose job is to keep the mock rows hidden until a data layer vouches for one by stamping it. So
    // a row can be in the DOM, opacity 1, visibility visible, every field correct — and occupy zero
    // pixels. It read as a working desktop panel through the DOM and as an empty gap on screen, and
    // only measuring the rendered box found it. The offer sequence is the ledger's own id for the
    // offer, so it is what the row is stamped with.
    row.setAttribute('data-oid', String(o.seq));

    var gets = amt(o.taker_gets), pays = amt(o.taker_pays);
    var gc = gets ? gets.code : '?', pc = pays ? pays.code : '?';

    // STELLAR'S ROW (RAZA 2026-09-15: "View asset text link is not there like on Stellar"): the token's logo and code, then
    // its home domain and "View asset". The pair the design printed ("XYIELD / XRP", two lettered discs) is not it.
    var tok = (gets && gets.code !== 'XRP') ? gets : pays;
    var nm = row.querySelector('.pair-text .name');
    if (nm) nm.textContent = tok ? tok.code : (gc + ' / ' + pc);
    // Desktop puts the pill inside .pair-text as .side; the phone puts it beside .order-pair as
    // .order-side. Same two modifier classes, different element — so the class is rebuilt from
    // whichever base name this layout uses rather than hardcoding one of them.
    var side = row.querySelector('.pair-text .side, .order-side');
    if (side) {
      side.className = (side.classList.contains('order-side') ? 'order-side' : 'side') + ' sell';
      plain(side, 'Sell');
    }

    // The two circles ship carrying APT and USDT artwork. There is no logo source wired here yet, so
    // they fall back to the design's own lettered treatment rather than keep another chain's tokens.
    var ico = row.querySelectorAll('.pair-ico .b');
    for (var ik = 1; ik < ico.length; ik++) if (ico[ik].parentNode) ico[ik].parentNode.removeChild(ico[ik]);
    if (ico[0]) {
      plain(ico[0], '');
      ico[0].style.background = 'transparent';
      var oim = document.createElement('img');
      oim.alt = '';
      oim.src = (tok && tok.issuer)
        ? ('/lxapi/xrplthumb?iss=' + encodeURIComponent(tok.issuer) + '&cur=' + encodeURIComponent(tok.currency) + '&w=48')
        : '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
      oim.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';
      ico[0].appendChild(oim);
    }
    var ptx = row.querySelector('.pair-text');
    if (ptx && tok && tok.issuer && !ptx.querySelector('.lx-ameta')) {
      var meta = el('span', 'lx-ameta');
      meta.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-left:8px;font-size:10.5px;font-weight:600;color:var(--text-soft,#8a8fa3)';
      var hd = el('span', 'lx-hd');
      hd.setAttribute('data-logoed', '1');
      meta.appendChild(hd);
      var va = el('a', 'lx-vasset', 'View asset');
      va.href = '/trade/xrpl/' + encodeURIComponent(tok.code + '-' + tok.issuer);
      va.style.cssText = 'color:var(--accent,#ea6a2c);text-decoration:none;font-weight:700';
      meta.appendChild(va);
      ptx.appendChild(meta);
      domainFor(tok, function (dom) {
        if (!dom || !hd.parentNode) return;
        hd.textContent = dom;
        hd.parentNode.insertBefore(el('span', null, '·'), va);
      });
    }

    var cols = row.querySelectorAll('.order-details .col');
    var price = (gets && pays && gets.value) ? (pays.value / gets.value) : null;
    var vals = [
      price != null ? fmt(price, 6) + ' ' + pc : '—',
      gets ? fmt(gets.value, 6) + ' ' + gc : '—',
      pays ? fmt(pays.value, 6) + ' ' + pc : '—'
    ];
    for (var i = 0; i < cols.length && i < 3; i++) {
      var v = cols[i].querySelector('.v');
      if (v) v.textContent = vals[i];
    }

    // The design shows "42% filled" over a progress bar. The XRP Ledger does not publish that: an
    // offer on the books reports only what REMAINS of it, so there is no original size to measure a
    // fill against. A bar with a number nobody can derive is worse than no bar, so it is removed.
    var prog = row.querySelector('.order-progress-wrap');
    if (prog && prog.parentNode) prog.parentNode.removeChild(prog);

    // Cancel is live now: browser/write.js picks the click up off this row and cancels by data-oid,
    // which is why that attribute is the offer's own sequence number rather than a display index.
    // It was disabled here while no signing path existed; re-enabled with that path, not before.
    return row;
  }

  // Releases an element from the page's card-reveal gate.
  //
  // The design fades sections in on scroll:
  //     html.lcm-ready .orders-block:not([data-lcm-done]) { opacity: 0; transform: translateY(8px) }
  // with a driver that adds .lcm-on when the element comes into view. buildTabs() moves .orders-block
  // into a new panel, and after that move the driver never released it — so the panel sat at opacity 0
  // holding a correctly built, correctly sized, fully painted order row that nobody could see. The row
  // even answered elementFromPoint, because a transparent element is still hit-testable; the only
  // measurement that showed the truth was its computed opacity.
  //
  // data-lcm-done is the gate's own "already handled" attribute, so setting it opts the element out
  // rather than fighting the rule, and .lcm-on covers the case where the driver has since run.
  function reveal(node) {
    if (!node) return;
    try {
      node.setAttribute('data-lcm-done', '1');
      node.classList.add('lcm-on');
    } catch (e) {}
  }

  function paintOrders(me) {
    rpc('account_offers', { account: me, ledger_index: 'validated', limit: 50 })
      .then(function (r) {
        var offers = r.offers || [];
        setTab('orders', offers.length);

        // The Open Orders heading ships its own summary reading "3 active". Nothing filled it, so it
        // sat directly above a tab correctly badged "Open orders 1" — two counts of the same thing,
        // side by side, disagreeing, with the invented one in the larger type.
        [].forEach.call(document.querySelectorAll('.section-heading'), function (sh) {
          var m = sh.querySelector('.meta');
          if (!m) return;
          var title = '';
          [].forEach.call(sh.childNodes, function (nd) {
            if (nd === m || (nd.contains && nd.contains(m))) {
              // walk into the wrapper but skip the meta itself
              [].forEach.call(nd.childNodes || [], function (k) { if (k !== m) title += (k.textContent || '') + ' '; });
              return;
            }
            title += (nd.textContent || '') + ' ';
          });
          if (/open orders/i.test(title)) {
            m.textContent = offers.length + ' active';
          }
        });

        // TWO LAYOUTS, AND ONLY ONE OF THEM WAS WIRED. Desktop lists orders as .order-row inside
        // .orders-block; the phone lists them as .order-card inside .orders-stack — different
        // container, different item, same fields. Keying on the desktop pair alone meant the phone
        // showed the tab correctly badged "Open orders 1" above a completely empty panel: the count
        // came from the ledger, the list came from markup that was never found, and nothing errored.
        var block = $('.lx-wcpanel-orders .orders-block') || $('.lx-wcpanel-orders .orders-stack')
          || $('.orders-block') || $('.orders-stack');
        if (!block) return;
        var rowT = block.querySelector('.order-row, .order-card');
        if (!rowT) return;
        rowT = rowT.cloneNode(true);
        block.innerHTML = '';

        if (!offers.length) {
          var d = el('div', 'lx-wcnote', 'No open orders on this account.');
          block.appendChild(d);
          reveal(block);
          return;
        }
        offers.forEach(function (o) {
          block.appendChild(orderRow(rowT, o));
        });
        reveal(block);
      }).catch(function () { /* leave the design's block rather than empty it on a dropped request */ });
  }

  // ---- Activity ------------------------------------------------------------------------------------
  // The design ships thirty rows of invented transactions — "Received USDT from 0x0222…02b2",
  // "Sell 500 APT @ 0.4128" — dated today and sitting under this account's real balances. That is the
  // most dangerous thing on the page: a blank section reads as unfinished, a fabricated one reads as
  // your history. The dashboard's own activity feed was replaced for exactly this reason.
  //
  // The design's markup is reused, not replaced: a real .activity-row and .day-divider are kept as
  // templates and cloned, so every class, icon and layout stays the design's.
  var TYPES = {
    Payment: 'Payment', OfferCreate: 'Order', OfferCancel: 'Cancelled order',
    TrustSet: 'Trustline',
    // AMMCreate and AMMDelete were missing entirely, so they fell through to the raw ledger name and a
    // row read "AMMCreate" (RAZA 2026-10-06). Stellar calls both halves of this by what they did.
    AMMDeposit: 'Added liquidity', AMMCreate: 'Added liquidity',
    AMMWithdraw: 'Removed liquidity', AMMDelete: 'Removed liquidity',
    AccountSet: 'Account update', NFTokenMint: 'NFT mint'
  };

  // ONE ICON PER KIND, WHICH IS WHAT MADE EVERY ROW LOOK THE SAME (RAZA 2026-10-06: "Swap icon is
  // different").
  //
  // The icon was only ever given a CLASS — `received` / `sent` / `swap` — and the glyph inside it stayed
  // whatever the cloned template held, a down arrow. So a Swap, an Order and an AMMCreate all showed the
  // same arrow in the same red disc, and the class did nothing visible for the kinds the sheet has no
  // colour for. Stellar swaps the SVG as well, and that is the difference you can actually see.
  //
  // These are lumoscore.com's own glyphs, read out of its live lx-56d7256e855a.js, so the two feeds draw
  // the same mark for the same thing. The colours need nothing added: `.activity-icon.received/.sent/
  // .swap/.order/.claim/.bridge/.contract` are all already in this build's inherited sheet, and `lp` has
  // no rule on EITHER side — its droplet sits on the base disc, which is how Stellar draws it too.
  var IC = {
    received: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    sent: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    swap: '<path d="M7 10l-3 3 3 3M4 13h11M17 14l3-3-3-3M20 11H9"/>',
    lp: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    order: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    contract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };
  function actIcon(kind) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[kind] || IC.swap) + '</svg>';
  }

  // An Asset / Asset2 on an AMM transaction is a SPEC, not an amount: {currency, issuer} with no value,
  // so amt() cannot read it. Same decoder as everywhere else, so a 40-char hex renders as its name.
  // The two reserves a pool action actually moved, as {value, code, currency, issuer}.
  //
  // Prefers the transaction's own Amount/Amount2 when it has them, because that is the exact request
  // and needs no interpretation. Falls back to the account's balance changes in the metadata, which is
  // the only place a tfWithdrawAll records what came back.
  //
  // The three traps in reading those changes, each checked against real transactions:
  //   * add the network Fee back to the AccountRoot delta, or a 1 XRP deposit reads as 1.000012
  //   * skip the pool's own LP token, whose currency code begins 03, or it appears as a third asset
  //   * a RippleState Balance is signed from the LOW account's side, so negate it when this account
  //     is the high one
  // Magnitudes only: the row's verb already says which direction it went.
  function lpMoved(tx, meta) {
    var a1 = amt(tx.Amount), a2 = amt(tx.Amount2);
    if (a1 && a2) return [a1, a2];
    if (a1) return [a1];

    var me = tx.Account, out = [];
    var nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length && out.length < 2; i++) {
      var w = nodes[i].ModifiedNode || nodes[i].DeletedNode || nodes[i].CreatedNode;
      if (!w) continue;
      var f = w.FinalFields || w.NewFields || {}, pv = w.PreviousFields || {};
      if (w.LedgerEntryType === 'AccountRoot') {
        if (f.Account !== me || pv.Balance === undefined) continue;
        var d = (Number(f.Balance) - Number(pv.Balance)) / 1e6 + (Number(tx.Fee || 0) / 1e6);
        if (Math.abs(d) > 1e-9) out.push({ value: Math.abs(d), code: 'XRP', currency: 'XRP' });
      } else if (w.LedgerEntryType === 'RippleState') {
        var bal = f.Balance || {}, pb = pv.Balance;
        if (pb === undefined || !bal.currency) continue;
        if (/^03/.test(String(bal.currency))) continue;              // the pool's own LP token
        var hi = (f.HighLimit || {}).issuer, lo = (f.LowLimit || {}).issuer;
        if (hi !== me && lo !== me) continue;
        var dv = (Number(bal.value) - Number(pb.value)) * (lo === me ? 1 : -1);
        if (Math.abs(dv) > 1e-12) {
          var dec = window.lxx.decodeCurrency(bal.currency);
          out.push({
            value: Math.abs(dv), code: (dec && dec.display) || bal.currency,
            currency: bal.currency, issuer: (lo === me ? hi : lo),
          });
        }
      }
    }
    return out;
  }

  function assetCode(spec) {
    if (!spec) return null;
    if (typeof spec === 'string' || spec.currency === 'XRP' || (!spec.currency && !spec.issuer)) {
      return { code: 'XRP', currency: 'XRP' };
    }
    var d = window.lxx.decodeCurrency(spec.currency);
    return { code: (d && d.display) || spec.currency, currency: spec.currency, issuer: spec.issuer };
  }

  // WHAT A SWAP ACTUALLY COST: SendMax is only a ceiling, so the spend is read from the ledger's own balance changes — the account's XRP
  // (less the network fee) or its trustline for the token given.
  function ownDelta(meta, me, give, tx) {
    var nodes = (meta && meta.AffectedNodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i].ModifiedNode || nodes[i].DeletedNode;
      if (!n) continue;
      var f = n.FinalFields || {}, pv = n.PreviousFields || {};
      if (give.code === 'XRP' && n.LedgerEntryType === 'AccountRoot' && f.Account === me && pv.Balance != null) {
        return (Number(pv.Balance) - Number(f.Balance) - Number(tx.Fee || 0)) / 1e6;
      }
      if (give.code !== 'XRP' && n.LedgerEntryType === 'RippleState' && pv.Balance && f.Balance
        && f.Balance.currency === give.currency) {
        var lo = f.LowLimit && f.LowLimit.issuer, hi = f.HighLimit && f.HighLimit.issuer;
        if (lo !== me && hi !== me) continue;
        if ((lo === me ? hi : lo) !== give.issuer) continue;
        var sgn = lo === me ? 1 : -1;
        return sgn * (Number(pv.Balance.value) - Number(f.Balance.value));
      }
    }
    return 0;
  }

  // An amount is either drops (a bare string) or an issued-currency object.
  function amt(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { value: +v / 1e6, code: 'XRP' };
    // Through lxx.decodeCurrency so a 40-char hex code renders as its name, exactly as the asset
    // list above renders it — one decoder, so the two cannot disagree about what a token is called.
    var d = window.lxx.decodeCurrency(v.currency);
    return { value: +v.value, code: (d && d.display) || v.currency, currency: v.currency, issuer: v.issuer };
  }

  // The design ships thirty invented rows in this block, so every exit from the activity path has to
  // say something rather than leave them. One helper, so a new exit cannot forget the clearing half.
  function activityNote(text) {
    var b = $('.activity-block');
    if (!b) return;
    b.innerHTML = '';
    var n = el('div', 'lxp');
    n.style.cssText = 'padding:22px;text-align:center;color:var(--text-muted);font-size:13px';
    n.textContent = text;
    b.appendChild(n);
  }

  function paintActivity(me) {
    var block = $('.activity-block');
    if (!block) return;
    var rowT = block.querySelector('.activity-row');
    var dayT = block.querySelector('.day-divider');
    if (!rowT) return;
    rowT = rowT.cloneNode(true);
    dayT = dayT ? dayT.cloneNode(true) : null;

    rpc('account_tx', { account: me, limit: 25, ledger_index_min: -1, ledger_index_max: -1 })
      .then(function (r) {
        var txs = r.transactions || [];
        // AN EMPTY HISTORY IS A RESULT, NOT A REASON TO SHOW SOMEONE ELSE'S. `return` here left the
        // design's thirty invented rows standing — "Received USDT from 0x0222…02b2", in APT, dated
        // today, under this account's real balances — which is the exact thing this function's header
        // calls the most dangerous content on the page. Measured: an account the ledger has no
        // transactions for rendered a full page of fabricated history.
        //
        // This is the commoner path of the two, not the rare one: every new wallet starts here.
        if (!txs.length) { activityNote('No activity on this account yet.'); return; }
        block.innerHTML = '';
        var lastDay = '';

        txs.forEach(function (t) {
          var tx = t.tx || t.tx_json || {};
          var meta = t.meta || t.metaData || {};
          if (typeof tx.date !== 'number') return;
          var when = new Date((tx.date + 946684800) * 1000);
          var day = when.toDateString();

          if (day !== lastDay && dayT) {
            lastDay = day;
            var dv = dayT.cloneNode(true);
            var today = new Date().toDateString();
            dv.textContent = (day === today ? 'Today · ' : '')
              + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            dv.classList.add('lxp');                           // gated like every other activity value
            block.appendChild(dv);
          }

          var row = rowT.cloneNode(true);
          var kind = TYPES[tx.TransactionType] || tx.TransactionType || 'Transaction';

          // A PAYMENT HAS THREE RELATIONSHIPS TO THIS ACCOUNT, NOT TWO.
          //
          // This read `incoming = Destination === me` and treated everything else as sent — so a
          // payment that merely RIPPLES THROUGH the account, where it is neither the sender nor the
          // recipient, landed in the "Sent" branch. Seen on the LUMOS pool account: the ledger says
          // the sender was rVVaR…, and the row said "Sent · To rVVaR…". It reported a payment the
          // account did not make, named the actual sender as the recipient, and signed the amount
          // as if it had left this wallet.
          //
          // An AMM or issuer account does this constantly, and any account whose trustline is used
          // as a path hop does it occasionally — so it is uncommon rather than rare, and "you sent
          // money" is not a thing to be casually wrong about on a wallet page.
          //
          // Pass-through is now its own case: the delivered amount belongs to the destination, not
          // to this account, so it carries no sign and no up/down colour, and both parties are
          // named rather than one of them being cast as the counterparty.
          // FOUR, in fact — the fourth being a payment from this account TO this account.
          //
          // That is not an oddity here, it is how a swap is expressed on this ledger, and it is
          // exactly what this project's own swap builds: a cross-currency Payment to self. Treating
          // "destination is me" as received labelled every one of them "Received · From <your own
          // address>" — measured, 14 rows of it on one account. A user swapping on LumosCore would
          // see their own swaps described as money arriving from themselves.
          //
          // The dashboard feed already calls these swaps and shows what was given beside what
          // arrived; this now matches it, so the same transaction reads the same way in both feeds.
          var isPayment = tx.TransactionType === 'Payment';
          var self = isPayment && tx.Account === me && tx.Destination === me;
          var incoming = isPayment && !self && tx.Destination === me;
          var outgoing = isPayment && !self && tx.Account === me;
          var through = isPayment && !self && !incoming && !outgoing;
          var other = incoming ? tx.Account : tx.Destination;

          // The AMM pair, and which way it went. AMMCreate and AMMDelete are the first and last
          // deposits into a pool, so they belong with their ordinary counterparts rather than under
          // their own raw names.
          var tt = tx.TransactionType;
          var isLp = tt === 'AMMDeposit' || tt === 'AMMCreate' || tt === 'AMMWithdraw' || tt === 'AMMDelete';
          var lpOut = tt === 'AMMWithdraw' || tt === 'AMMDelete';
          // BOTH HALVES OF AN LP ROW, WHICHEVER FIELDS THE TRANSACTION HAPPENS TO CARRY (RAZA
          // 2026-10-07: "now show the recent activity on wallet page like stellar").
          //
          // The two AMM shapes carry different fields, and this row was reading one of each, so every
          // pool action was missing half of what Stellar shows:
          //
          //   AMMCreate    Amount + Amount2, NO Asset/Asset2  -> amounts shown, pair missing from label
          //   AMMWithdraw  Asset + Asset2, NO Amount/Amount2  -> pair shown, amounts missing entirely
          //                (tfWithdrawAll, Flags 131072 — measured on RAZA's own withdrawals)
          //
          // lumoscore.com shows both on every pool row: the verb with both asset marks, over
          // "107.33 HOLA + 51,572 CANNACOIN". So the amounts come from the metadata when the request
          // does not carry them — which is also the figure that actually moved — and the pair falls
          // back to those amounts when Asset/Asset2 are absent.
          var lpAmts = isLp ? lpMoved(tx, meta) : null;
          var lpA = isLp ? (assetCode(tx.Asset) || (lpAmts && lpAmts[0])) : null;
          var lpB = isLp ? (assetCode(tx.Asset2) || (lpAmts && lpAmts[1])) : null;
          // The two lines of one row must name the pair in the SAME order. The label follows
          // Asset/Asset2 and the amounts come back in whatever order the metadata nodes appear, so a
          // row could read "ARMY + PHNIX" over "71.71 PHNIX + 0.09 ARMY" — both true, and
          // momentarily unreadable. The amounts are ordered to the label.
          if (lpAmts && lpAmts.length === 2 && lpA && lpB && lpAmts[0].code !== lpA.code
              && lpAmts[1].code === lpA.code) {
            lpAmts = [lpAmts[1], lpAmts[0]];
          }

          // The kind drives both the disc colour and the glyph, as it does on Stellar. A pass-through
          // is neither sent nor received, so it takes the neutral swap colour rather than the green of
          // money arriving or the red of money leaving.
          // NOT `kind` — that name is already the row's LABEL, a few lines up, and reusing it here
          // silently renamed every pool row "lp (failed)" instead of "Added liquidity". `var` is
          // function-scoped, so the second declaration is the same binding, and nothing warns.
          var icoKind = isLp ? 'lp'
            : (tt === 'OfferCreate' || tt === 'OfferCancel') ? 'order'
            : incoming ? 'received'
            : (isPayment && !through && !self) ? 'sent'
            : (isPayment || tt === 'TrustSet') ? 'swap'
            : 'contract';
          var ico = row.querySelector('.activity-icon');
          if (ico) {
            ico.className = 'activity-icon ' + icoKind;
            ico.innerHTML = actIcon(icoKind);
          }

          // Computed first now, because the label below names the assets.
          var dlv0 = meta.delivered_amount || meta.DeliveredAmount;
          if (dlv0 === 'unavailable') dlv0 = null;              // pre-2014 ledgers do not report it
          var got00 = amt(dlv0 || tx.Amount);
          var give00 = self ? amt(tx.SendMax) : null;

          // STELLAR'S ROW (RAZA 2026-09-15: "its different on Stellar. Also remove that confirmed tag for
          // literally every trx"): the kind, then each asset with its own mark — "Received ⊗ XRP",
          // "Swap ⊗ XRP → ⊗ FUZZY". No status pill: every row is a validated transaction, and the rare one
          // that failed says so in its label instead.
          var ty = row.querySelector('.type');
          if (ty) {
            var okTx = (meta.TransactionResult === 'tesSUCCESS');
            ty.textContent = (isPayment
              ? (self ? 'Swap' : incoming ? 'Received' : through ? 'Routed through' : 'Sent')
              : kind) + (okTx ? '' : ' (failed)');
            if (isLp && lpA && lpB) {
              // Stellar's shape exactly: the verb, then both sides of the pool with their own marks —
              // "Added liquidity ⊗ HOLA + ⊗ CANNACOIN". The row used to be the verb and nothing else.
              ty.appendChild(actLogo(lpA));
              ty.appendChild(document.createTextNode(lpA.code + ' +'));
              ty.appendChild(actLogo(lpB));
              ty.appendChild(document.createTextNode(lpB.code));
            } else if (isPayment && self && give00 && got00 && give00.code !== got00.code) {
              ty.appendChild(actLogo(give00));
              ty.appendChild(document.createTextNode(give00.code + ' →'));
              ty.appendChild(actLogo(got00));
              ty.appendChild(document.createTextNode(got00.code));
            } else if (isPayment && got00) {
              ty.appendChild(actLogo(got00));
              ty.appendChild(document.createTextNode(got00.code));
            }
          }

          // delivered_amount, never tx.Amount: on a path payment Amount is the MAXIMUM the sender
          // would allow, not what arrived — measured elsewhere in this project as a 33%
          // overstatement. Computed once here because both the meta line and the figure need it.
          var got0 = got00;

          var mt = row.querySelector('.meta');
          if (mt) {
            // A pass-through names BOTH ends: neither of them is this account's counterparty, and
            // picking one to show would be the same mistake in smaller print.
            // A swap names the two assets, not the two addresses — both of which are you. SendMax is
            // a maximum rather than a quantity, so only its CODE is used; the figure on the right is
            // the delivered amount, which is exact.
            // The counterparty, as Stellar's row has it; a swap's two assets are already in the label.
            var who = self ? ''
              : through ? ((tx.Account && tx.Destination) ? (short(tx.Account) + ' → ' + short(tx.Destination)) : '')
              : '';
            // THE COUNTERPARTY IS A LINK, AND THAT IS WHAT MAKES IT BOLD AND ORANGE (RAZA 2026-10-06:
            // "In sent transactions, To address is supposed to be bold and orange color").
            //
            // Stellar writes `metaPre + <a class="lx-addr-link">short</a>`, and this build's inherited
            // sheet ALREADY carries the rule — `.lx-addr-link{color:var(--accent,#ea6a2c);font-weight:600}`
            // — so nothing had to be styled here. The address was simply being written as plain text
            // into `.meta`, which is why it rendered grey beside Stellar's accent.
            //
            // Built as nodes rather than innerHTML: `other` is an address off a public ledger, and this
            // file's rule is that ledger-supplied values go in through textContent.
            var addrEl = null;
            if (!self && !through && other) {
              mt.textContent = incoming ? 'From ' : 'To ';
              addrEl = document.createElement('a');
              addrEl.className = 'lx-addr-link';
              addrEl.href = 'https://bithomp.com/explorer/' + encodeURIComponent(other);
              addrEl.target = '_blank';
              addrEl.rel = 'noopener';
              addrEl.textContent = short(other);
              addrEl.setAttribute('data-logoed', '1');     // the logo engine repaints short-text elements
            }
            // The two reserves that moved, as Stellar prints them: "107.33 HOLA + 51,572 CANNACOIN".
            // The note that used to sit here said a tfWithdrawAll "says nothing rather than inventing a
            // figure" — right not to invent one, wrong that there was none to find. The metadata has it;
            // lpMoved() reads it, so a withdrawal now prints the same line a deposit does.
            if (isLp && lpAmts && lpAmts.length) {
              who = lpAmts.map(function (x) { return fmt(x.value, 6) + ' ' + x.code; }).join(' + ');
            }
            // AN ORDER IS NOT A PAYMENT, AND HAD NOTHING TO SAY (RAZA 2026-10-02: "WTF is this blank trx").
            //
            // Every line on this row is built from a payment's shape: the counterparty comes from
            // Destination and the figure from delivered_amount. An OfferCreate has neither, so the row
            // came out as the word "Order" and three empty slots — a transaction the wallet admits
            // happened and then refuses to describe.
            //
            // What an order actually is, is a pair: TakerGets is what you put up, TakerPays what you
            // asked for. That is the line.
            var og = amt(tx.TakerGets), op = amt(tx.TakerPays);
            if (!who && og && op) who = fmt(og.value, 6) + ' ' + og.code + ' → ' + fmt(op.value, 6) + ' ' + op.code;
            // A cancellation names the order it withdrew, which is the only fact it carries.
            if (!who && tx.TransactionType === 'OfferCancel' && tx.OfferSequence) who = 'Offer #' + tx.OfferSequence;
            // The address branch already wrote the "To "/"From " prefix, so it only appends; every other
            // branch owns the whole line.
            if (addrEl) mt.appendChild(addrEl);
            else mt.textContent = who;
            mt.classList.add('lxp');
          }

          var a1 = row.querySelector('.a1');
          if (a1) {
            var got = got0;
            // A failed transaction moved nothing, so it shows no amount (its Amount is only what was asked for).
            if (isLp) {
              // Blank, as Stellar leaves it. A pool deposit moves TWO assets and the meta line above
              // already names both; printing one of them here, signed, said "−0.000013 ATOM" about a
              // transaction that also moved 1,410 PHNIX — half the story with a minus in front of it.
              a1.textContent = '';
              a1.classList.remove('up', 'down', 'swap');
            } else if (got && isFinite(got.value) && meta.TransactionResult === 'tesSUCCESS') {
              // No sign on a pass-through or a swap. On a pass-through the delivered amount is what
              // the DESTINATION received and this account's balance nets out across the hop; on a
              // swap one asset was given for another, so a lone "+" would report half of it. A "−"
              // in either case reads as money that left this wallet.
              // A swap reads "+1,018.8 TDT" over "−0.0998 XLM" on Stellar (RAZA 2026-09-16): what arrived, then what it cost.
              var sign = through ? '' : ((incoming || self) ? '+' : '−');
              a1.textContent = sign + fmt(got.value, 6) + ' ' + got.code;
              a1.classList.toggle('up', !!incoming);
              a1.classList.toggle('down', !incoming && !through && !self);
              a1.classList.toggle('swap', !!(through || self));
              // `.activity-amt .a1:not(.lxp)` is hidden by the inherited sheet — why rows showed no amount.
              a1.classList.add('lxp');
            } else if (tx.TransactionType === 'OfferCreate' && amt(tx.TakerGets)) {
              // The size of the order, unsigned: nothing has moved yet. A "−" here would report a spend
              // that has not happened, and an order can sit unfilled for as long as the book allows.
              var og1 = amt(tx.TakerGets);
              a1.textContent = fmt(og1.value, 6) + ' ' + og1.code;
              a1.classList.remove('up', 'down');
              a1.classList.add('swap', 'lxp');
            } else {
              a1.textContent = '';
            }
          }

          // The design's second line is a USD conversion, and it shipped as a fixed "≈ $7.42" on
          // every row. This layer has no price map — prices.js owns that — so the honest thing is to
          // clear it rather than repeat a number that was never about this transaction. An empty
          // slot says nothing; a stale one says something false on all 25 rows.
          var a2 = row.querySelector('.a2');
          if (a2) {
            a2.textContent = '';
            if (self && give00 && got00 && give00.code !== got00.code) {
              var spentV = ownDelta(meta, me, give00, tx);
              if (spentV > 0) { a2.textContent = '−' + fmt(spentV, 6) + ' ' + give00.code; a2.classList.add('lxp'); }
            }
          }

          // The explorer mark, at the end of the row — the same one the dashboard feed carries, so
          // both feeds on the site open the same explorer from the same place.
          try {
            var xl = window.lxxExplorer && window.lxxExplorer.link(
              window.lxxExplorer.txHash(t), 'View this transaction on Bithomp');
            if (xl) row.appendChild(xl);
          } catch (e) {}

          block.appendChild(row);
        });
      }).catch(function () {
        // A FAILED LOOKUP MUST NOT LEAVE THE DESIGN'S HISTORY ON SCREEN. "Leave the block alone" was
        // written to avoid blanking a section over a dropped request, but what it actually leaves is the
        // thirty invented rows this function's own header calls the most dangerous thing on the page —
        // "Received USDT from 0x0222…02b2", in APT, dated today, under a real account's balances.
        //
        // Found while verifying the icons: seeding an address that does not exist on the ledger produced
        // a full page of someone else's fabricated history rather than an error.
        //
        // An empty section reads as "nothing here"; this says which of the two it is.
        activityNote('Could not load activity for this account.');
      });
  }

  // ---- Liq Pools -----------------------------------------------------------------------------------
  //
  // RAZA 2026-09-15: "Whys it showing 2 pools when the count says 0. Also where did this APT come from."
  // The panel was the design's mock rows — APT / USDC, LUMOS / APT — and nothing ever replaced them.
  //
  // Each LP-token trustline IS a position, and its issuer is the pool's AMM account, so amm_info on it
  // gives the pair, the reserves and the LP supply; the account's share is its balance over that supply.
  // The design's own row is the template. APR and rewards have no ledger source and say so.
  function paintLpPositions(data) {
    var panel = document.getElementById('lpPanel');
    var body = panel && panel.querySelector('tbody');
    if (!body) return;
    var tpl = body.querySelector('tr');
    tpl = (tpl && tpl.children.length >= 6) ? tpl.cloneNode(true) : null;
    var pools = (data && data.pools) || [];
    function empty(text) {
      body.innerHTML = '';
      var tr = document.createElement('tr');
      var td = el('td', null, text);
      td.colSpan = 6;
      td.style.cssText = 'padding:28px;text-align:center;color:var(--text-muted)';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    if (!pools.length || !tpl) { empty('No liquidity positions'); return; }
    empty('Reading your positions…');
    var usdP = fetch('/lxapi/xrpltokens?n=1').then(function (r) { return r.json(); })
      .then(function (t) { return (t && t.ok && +t.usd > 0) ? +t.usd : null; }).catch(function () { return null; });
    Promise.all([usdP].concat(pools.map(function (lp) {
      return rpc('amm_info', { amm_account: lp.issuer, ledger_index: 'validated' })
        .then(function (r) { return { lp: lp, amm: r.amm }; }, function () { return { lp: lp, amm: null }; });
    }))).then(function (res) {
      var usd = res[0];
      var rows = res.slice(1).filter(function (x) {
        return x.amm && x.amm.lp_token && Number(x.amm.lp_token.value) > 0 && x.lp.balance > 0;
      });
      if (!rows.length) { empty('No liquidity positions'); return; }
      body.innerHTML = '';
      rows.forEach(function (x) {
        var m = x.amm, A = amt(m.amount), B = amt(m.amount2);
        var share = x.lp.balance / Number(m.lp_token.value);
        var tr = tpl.cloneNode(true), td = tr.children;

        var icos = tr.querySelectorAll('.lp-ico');
        [A, B].forEach(function (s, i) {
          var ic = icos[i];
          if (!ic) return;
          ic.innerHTML = '';
          var im = document.createElement('img');
          im.alt = '';
          im.src = s.issuer ? thumb({ issuer: s.issuer, currency: s.currency }, 48) : thumb(null, 48);
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
          ic.appendChild(im);
        });
        var nm = tr.querySelector('.lp-nm');
        if (nm) plain(nm, A.code + ' / ' + B.code);
        var sb = tr.querySelector('.lp-sb');
        // Stellar's wording and figures (RAZA 2026-09-15: "XRPL text on the row is different from Stellar"): "0.30% fee
        // tier · Stellar AMM" there, two decimals and the ledger's short name here.
        if (sb) sb.textContent = (m.trading_fee / 1000).toFixed(2) + '% fee tier · XRPL AMM';

        if (td[1]) {
          var s1 = td[1].querySelector('.p1'), s2 = td[1].querySelector('.p2');
          if (s1) s1.textContent = (share * 100).toFixed(share < 0.0001 ? 6 : 2) + '%';
          if (s2) s2.textContent = lpAmt(x.lp.balance) + ' LP tokens';
        }
        if (td[2]) { td[2].textContent = '—'; td[2].title = 'The XRP Ledger does not publish a pool APR'; }

        // STELLAR'S LIQUIDITY CELL: your share of each reserve — the first in the headline weight with its ticker small
        // beside it, the second underneath ("21.95 BOMB" over "938,225 FRANK"). It used to be an XRP value and a dollar
        // line for XRP pools and a "+"-joined pair otherwise.
        if (td[3]) {
          var q1 = td[3].querySelector('.p1'), q2 = td[3].querySelector('.p2');
          if (q1) {
            q1.textContent = lpAmt(A.value * share) + ' ';
            var un = el('span', null, A.code);
            un.style.cssText = 'color:var(--text-soft);font-size:14px';
            un.setAttribute('data-logoed', '1');
            q1.appendChild(un);
          }
          if (q2) q2.textContent = lpAmt(B.value * share) + ' ' + B.code;
        }
        if (td[4]) {
          var r1 = td[4].querySelector('.p1'), r2 = td[4].querySelector('.p2');
          if (r1) { r1.textContent = '—'; r1.style.color = ''; }
          if (r2) r2.textContent = 'fees accrue into the pool';
        }

        var btns = tr.querySelectorAll('.qa-row-btn');
        // Stellar's plus and minus (RAZA 2026-09-15: "Icon on Add and Remove is not that we have on Stellar").
        if (btns[0]) btns[0].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add';
        if (btns[1]) btns[1].innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> Remove';
        var go = '/pools/xrpl/id/' + encodeURIComponent(x.lp.issuer);
        if (btns[0]) btns[0].setAttribute('data-lxgo', go);
        if (btns[1]) btns[1].setAttribute('data-lxgo', go + '?act=withdraw');
        // `x.lp.issuer` is the AMM account — the pool's own address, which is both what the detail url is
        // keyed on and what "Copy pool address" is expected to put on the clipboard.
        if (btns[2]) {
          btns[2].setAttribute('data-lxpmenu', x.lp.issuer);
          btns[2].removeAttribute('data-lxexp');
          btns[2].title = '';
          btns[2].setAttribute('aria-label', 'Pool actions');
        }
        body.appendChild(tr);
      });
      var cnt = [].filter.call(document.querySelectorAll('.asset-tabs .cnt'), function (c) {
        return !(c.closest && c.closest('.lx-wcgroup'));
      });
      if (cnt[1]) cnt[1].textContent = String(rows.length);
    });
  }

  // ---- the hero chart ------------------------------------------------------------------------------
  //
  // WHAT IT PLOTS: XRP/USD over the chosen timeframe. Not the account's portfolio value — and that is
  // not a shortcut, it is what lumoscore.com draws in the same box. Its wallet fetches CoinGecko's
  // `coins/stellar/market_chart` and plots XLM/USD; the comment beside its hidden 7-day delta says
  // why — "no portfolio history feed". Neither ledger publishes a balance series, so a true portfolio
  // curve would mean replaying every transaction on the account. This is the Stellar chart with
  // `stellar` swapped for `ripple`, served through /lxapi/xrplchart.
  //
  // This box previously carried my own note reading "Portfolio history is not available yet." That
  // was honest but it was not the page main ships, and it is now gone.
  //
  // EVERY CLASS BELOW IS INHERITED. `.lx-chartskel`, `.lx-carea`, `.lx-cbase`, `.lx-cline`,
  // `.lx-chart-none`, `.lx-cx`, `.lx-cd`, `.lx-ctip` and the two gates `#heroChart:not(.lx-chart-ready)
  // {visibility:hidden}` / `.chart-axis:not(.lx-axis-ready){visibility:hidden}` all came across with
  // the fork — the stylesheet survived and only the script that used it was stripped. So nothing here
  // adds CSS; it raises the gates the design already has and fills the shapes it already styles.
  // The SVG is built to match the live one exactly: viewBox 0 0 600 100, a `lxhc` gradient, an area
  // path and a 1.6px line.
  var CHART_TF = '1W';                       // the design ships 1W pre-selected
  var CHART_GEN = 0;                         // guards against a slow response for an abandoned tab

  function chartHost() { return document.getElementById('heroChart'); }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Matched to Stellar's tfLbl(), and the year format is the reason this is not just toLocaleDateString.
  // `{month:'short',year:'2-digit'}` renders August 2022 as "Aug 22", which on an axis sitting beside
  // "Aug 27" and "Sep 3" reads as the 22nd of August. The ALL axis came out "Jun 18 | Jul 20 | Aug 22 |
  // Aug 24 | Today" — five day-of-month labels spanning eight years. The apostrophe is what separates
  // a year from a date, and main already writes it that way.
  function tfLabel(t, tf) {
    var d = new Date(t);
    if (tf === '1D') return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':00';
    if (tf === '1Y' || tf === 'ALL') return MON[d.getMonth()] + ' ’' + String(d.getFullYear()).slice(2);
    return MON[d.getMonth()] + ' ' + d.getDate();
  }

  function chartSkeleton(host) {
    // The design's own loading shape, animated by `.lx-cline`'s inherited keyframes.
    host.innerHTML = '<div class="lx-chartskel"><svg viewBox="0 0 300 90" preserveAspectRatio="none">'
      + '<path class="lx-carea" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22 300,90 0,90Z"></path>'
      + '<path class="lx-cbase" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '<path class="lx-cline" pathLength="100" d="M0,72 30,60 60,66 90,46 120,54 150,34 180,44 210,24 240,32 270,14 300,22"></path>'
      + '</svg></div>';
    host.classList.add('lx-chart-ready', 'lx-chart-loading');
  }

  function chartNone(host, msg) {
    host.innerHTML = '';
    var d = el('div', 'lx-chart-none', msg);
    host.appendChild(d);
    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');
  }

  function drawChart(host, pts, tf) {
    var W = 600, H = 100;
    var lo = pts[0][1], hi = pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < lo) lo = pts[i][1];
      if (pts[i][1] > hi) hi = pts[i][1];
    }
    // A perfectly flat series has no range to scale into; centre it rather than divide by zero.
    var span = hi - lo;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    var tspan = (t1 - t0) || 1;

    var line = '', xs = [], ys = [];
    for (var j = 0; j < pts.length; j++) {
      var x = ((pts[j][0] - t0) / tspan) * W;
      var y = span > 0 ? (H - 9) - ((pts[j][1] - lo) / span) * (H - 18) : H / 2;
      xs.push(x); ys.push(y);
      line += (j ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%"'
      + ' height="100%" style="display:block">'
      + '<defs><linearGradient id="lxhc" x1="0" x2="0" y1="0" y2="1">'
      + '<stop offset="0%" stop-color="#ea6a2c" stop-opacity="0.28"></stop>'
      + '<stop offset="100%" stop-color="#ea6a2c" stop-opacity="0"></stop>'
      + '</linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#lxhc)"></path>'
      + '<path d="' + line + '" fill="none" stroke="#ea6a2c" stroke-width="1.6"'
      + ' stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';

    host.classList.add('lx-chart-ready');
    host.classList.remove('lx-chart-loading');

    // The axis spans are the design's five; only their text changes. Last one reads "Today" as it
    // does on main.
    var axis = $('.chart-axis');
    if (axis) {
      var sp = axis.querySelectorAll('span');
      for (var k = 0; k < sp.length; k++) {
        var frac = sp.length > 1 ? k / (sp.length - 1) : 1;
        sp[k].textContent = (k === sp.length - 1) ? 'Today' : tfLabel(t0 + tspan * frac, tf);
      }
      axis.classList.add('lx-axis-ready');
    }

    var mini = $('.timeframe-mini');
    if (mini) {
      var map = { '1D': 'past 24 hours', '1W': 'past 7 days', '1M': 'past 30 days', '1Y': 'past year', 'ALL': 'all-time' };
      mini.textContent = map[tf] || '';
    }

    chartHover(host, pts, xs, ys, tf);
  }

  // Scrub-to-read, using the three elements the inherited stylesheet already dresses: a vertical
  // rule, a dot and a tooltip. Rebuilt with the chart so it can never point at a stale series.
  function chartHover(host, pts, xs, ys, tf) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var cx = el('div', 'lx-cx'), cd = el('div', 'lx-cd'), tip = el('div', 'lx-ctip');
    cd.style.background = '#ea6a2c';
    host.appendChild(cx); host.appendChild(cd); host.appendChild(tip);

    function show(e) {
      var r = host.getBoundingClientRect();
      if (!r.width) return;
      var px = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - r.left;
      var frac = Math.max(0, Math.min(1, px / r.width));
      // Nearest point by x, so the readout is a real sample and never an interpolation.
      var idx = 0, best = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var d = Math.abs(xs[i] / 600 - frac);
        if (d < best) { best = d; idx = i; }
      }
      var lx = (xs[idx] / 600) * r.width, ly = (ys[idx] / 100) * r.height;
      cx.style.left = lx + 'px';
      cd.style.left = lx + 'px'; cd.style.top = ly + 'px';
      tip.style.left = Math.max(38, Math.min(r.width - 38, lx)) + 'px';
      tip.style.top = ly + 'px';
      tip.innerHTML = '';
      tip.appendChild(document.createTextNode(usdPrice(pts[idx][1])));
      var sub = el('span', 'lx-ctd', fullWhen(pts[idx][0], tf));
      tip.appendChild(sub);
      cx.style.opacity = '1'; cd.style.opacity = '1'; tip.style.opacity = '1';
    }
    function hide() { cx.style.opacity = '0'; cd.style.opacity = '0'; tip.style.opacity = '0'; }

    host.addEventListener('mousemove', show);
    host.addEventListener('mouseleave', hide);
    host.addEventListener('touchstart', show, { passive: true });
    host.addEventListener('touchmove', show, { passive: true });
    host.addEventListener('touchend', hide);
  }

  // XRP has traded under a dollar for most of its life and is quoted to four decimals everywhere
  // that matters, so the wallet's own 2dp money format would flatten the whole series to "$0.74".
  function usdPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
    if (v >= 1) return '$' + v.toFixed(3);
    return '$' + v.toFixed(4);
  }

  // The tooltip has room for the unabbreviated form, so it always carries the year — no reader should
  // have to work out which August a point belongs to.
  function fullWhen(t, tf) {
    var d = new Date(t);
    var day = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    if (tf !== '1D') return day;
    return day + ' · ' + (d.getHours() < 10 ? '0' : '') + d.getHours()
      + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function loadChart(tf) {
    var host = chartHost();
    if (!host) return;
    CHART_TF = tf;
    var gen = ++CHART_GEN;
    chartSkeleton(host);

    fetch('/lxapi/xrplchart?tf=' + encodeURIComponent(tf))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (gen !== CHART_GEN) return;                   // a later tab won the race
        if (!d || !d.ok || !d.pts || d.pts.length < 2) {
          chartNone(host, 'Price history unavailable right now');
          return;
        }
        drawChart(host, d.pts, tf);
      })
      .catch(function () {
        if (gen !== CHART_GEN) return;
        chartNone(host, 'Price history unavailable right now');
      });
  }

  // The design's own tab buttons. Its listeners are gone — the block they lived in is made to bail
  // at build time, because the same function drew a Math.random() series — so the active state is
  // driven here too.
  function wireChart() {
    var host = chartHost();
    if (!host || host.getAttribute('data-lxch') === '1') return;
    host.setAttribute('data-lxch', '1');

    var btns = document.querySelectorAll('.tf-row .tf-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          var tf = (b.textContent || '').trim().toUpperCase();
          for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('active', btns[j] === b);
          loadChart(tf);
        });
      })(btns[i]);
    }

    var active = document.querySelector('.tf-row .tf-btn.active');
    loadChart(active ? (active.textContent || '').trim().toUpperCase() : '1W');
  }

  // THE MONEY DIALOGS CARRY THE DESIGN'S BALANCES, AND ONLY ONE OF THEM GETS REWRITTEN.
  //
  // write.js sets `.field-label .meta` for the FROM field only — by design, it is the field a MAX
  // button reads. Every other one keeps what the template shipped, and the template's numbers are
  // another chain's: measured in the Send dialog, "Balance: 25,420.18 APT" and
  // "Balance: 4,200.00 USDC" sat beside the real "Balance: 0.923838 XRP".
  //
  // Hidden today, because the picker currently offers only XRP. That is not a reason to leave them:
  // a wrong balance inside a dialog that moves money is one selector change away from being read,
  // and this project has already shipped mock that was invisible right up until it was not.
  //
  // Blanked, not deleted, and blanked at LOAD so write.js still fills in the ones it owns whenever
  // a dialog opens — the design's element stays exactly where the layer expects to find it.
  function clearMockBalances() {
    // querySelectorAll directly: this file defines `$` and NOT `$$`. Written as `$$` first, which
    // `node -c` accepts happily — it is a runtime reference, not a syntax error — and it would have
    // thrown inside load() and taken the whole wallet page down with it.
    [].forEach.call(document.querySelectorAll('.field-label .meta'), function (m) {
      if (/Balance:/i.test(m.textContent || '')) m.textContent = 'Balance: —';
    });
  }

  // THE BALANCE READ IS NO LONGER GATED ON WALLET MARKUP, and that split is what lets the Custom
  // Swap dialog work off this page.
  //
  // `write.js` — Send, Swap, Trustlines, the signing paths — reads `window.__lxxData` for balances
  // and for the asset it is allowed to offer. That object was published inside a function which
  // returned immediately unless the page had `#assetsTable` / `#assetList`, so on any page that is
  // not the wallet, write.js loaded with no balances and every field it fills stayed empty. The
  // dashboard carries the same `#modalSwap` markup and could never have driven it.
  //
  // So the read runs whenever an address is connected, and only the PAINTING is gated on `h`. The
  // wallet page behaves exactly as before — same calls, same order — and any other page carrying a
  // dialog gets the data it needs without a second copy of this logic.
  function load() {
    var h = host();
    if (h) {
      lift();
      // The chart is XRP's price, not this account's, so it is valid with no wallet connected and
      // must not sit behind the address check — the same mistake that left the pool page empty for
      // every signed-out visitor.
      wireChart();
      clearMockBalances();
    }

    var a = addr();
    if (!a) { if (h) note(h, 'Connect a wallet to see your balances.'); return; }

    if (h) note(h, 'Reading the XRP Ledger…');

    Promise.all([
      rpc('server_info', {}),
      rpc('account_info', { account: a, ledger_index: 'validated' }),
      window.lxx.allLines(rpc, a)
    ]).then(function (r) {
      var v = (r[0].info && r[0].info.validated_ledger) || {};
      // Read every time. These halved by amendment once already; a hardcoded pair would quietly
      // overstate what the user can send.
      var reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
      var ad = r[1].account_data || {};
      var data = {
        xrp: window.lxx.spendableXrp(ad.Balance, ad.OwnerCount, reserve),
        held: [], pools: [], obligations: []
      };
      var split = window.lxx.readLines(r[2].lines);
      data.held = split.held; data.pools = split.pools; data.obligations = split.obligations;
      window.__lxxData = data;

      // Announced so a dialog on a non-wallet page can fill itself the moment balances land, rather
      // than polling or racing this fetch.
      try { window.dispatchEvent(new CustomEvent('lxx:walletdata')); } catch (e2) {}

      if (!h) return;                                    // data only — nothing here to paint
      paint(data);
      // Before the painters and before setMeta's second pass: buildTabs moves .orders-block into a
      // panel and stamps .lx-wcgroup, and both of those are things the writers below look for.
      buildTabs();
      setMeta(data.held.length, data.pools.length, data.xrp);
      paintActivity(a);
      paintOrders(a);
      paintLpPositions(data);
      applyPins();
    }).catch(function (e) {
      // THE ACTIVITY BLOCK IS CLEARED HERE TOO, AND THIS IS THE PATH THAT ACTUALLY MATTERED.
      //
      // When the account read fails, paintActivity() is never reached — so the two guards inside it
      // cannot help, and the design's thirty invented rows stayed on screen under an "account not
      // activated" notice. Measured against an address that is not on the ledger: a full page of
      // "Received USDT from 0x0222…02b2" in APT, dated today.
      //
      // Done before the `!h` return, because the assets host being absent is no reason to leave
      // fabricated history standing.
      activityNote(/actNotFound/i.test(e.message || '')
        ? 'No activity on this account yet.'
        : 'Could not load activity for this account.');
      if (!h) return;
      // An account with no transactions simply does not exist on the ledger yet. Not an error.
      if (/actNotFound/i.test(e.message || '')) { note(h, 'This account is not activated on the XRP Ledger yet.'); return; }
      note(h, 'Could not read the XRP Ledger — ' + (e.message || 'try again'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxReload = load;
})();

// Fills the wallet's Price and 7d columns.
//
// Runs AFTER wallet.js has painted, and re-runs when it repaints, because the rows it writes into
// are created by that layer -- a one-shot pass at DOMContentLoaded would find an empty container and
// silently do nothing, which is the single most common way a "the data never showed up" bug happens
// in this codebase.
//
// Prices come from /lxapi/xrplprices, never straight from the upstream: the anonymous tier there is
// 333 requests per DAY per IP, so a browser-direct fetch would exhaust it in a few page views and
// take out an entire CGNAT'd mobile carrier at once. See functions/lxapi/xrplprices.js.
//
// A missing price renders as an em dash. It never renders as 0, and never as a stale figure from a
// previous token: on an asset list, a wrong number beside the right name is worse than no number,
// because there is nothing on screen to tell you it is wrong.
(function () {
  if (window.__lxxPrices) return;
  window.__lxxPrices = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var data = null;

  function slug(issuer, currency) { return String(issuer || '') + '-' + String(currency || ''); }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    // Sub-cent tokens are the norm on this ledger; 2dp would render most of a wallet as "$0.00".
    if (v < 0.000001) return '$' + v.toExponential(2);
    if (v < 0.01) return '$' + v.toPrecision(3);
    if (v < 1000) return '$' + v.toFixed(2);
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fetchPrices(slugs) {
    var q = slugs.length ? ('?t=' + encodeURIComponent(slugs.slice(0, 24).join(','))) : '';
    return fetch('/lxapi/xrplprices' + q)
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.ok) ? j : null; })
      .catch(function () { return null; });
  }

  // The two layouts the wallet paints into. Kept in one place so a change to either cannot leave the
  // other silently unfilled -- writing only the desktop one is the most repeated bug in this project.
  function targets() {
    var out = [];
    var tb = $('#assetsTable');
    if (tb) {
      [].forEach.call(tb.children, function (tr) {
        if (tr.children.length < 4) return;
        out.push({ row: tr, price: tr.children[1], chg: tr.children[2] });
      });
    }
    var cards = $('#assetList');
    if (cards) {
      [].forEach.call(cards.children, function (c) {
        if (!c.classList || !c.classList.contains('asset-row')) return;
        out.push({ row: c, price: null, chg: null, card: true });
      });
    }
    return out;
  }

  function apply() {
    if (!data) return;
    var held = (window.__lxxData && window.__lxxData.held) || [];
    var xrp = window.__lxxData && window.__lxxData.xrp;
    var t = targets();
    if (!t.length) return;

    // The wallet paints XRP first (when present), then held tokens in the same order as this array,
    // so index maps to row. Reading the name out of the DOM instead would tie this to display text.
    var seq = [];
    if (xrp) seq.push({ xrp: true });
    for (var i = 0; i < held.length; i++) seq.push(held[i]);

    for (var j = 0; j < t.length && j < seq.length; j++) {
      var item = seq[j], cell = t[j];
      var usd = null, ch7 = null;

      var ch24 = null, pxXrp = null;
      if (item.xrp) {
        usd = data.usd;                                   // 1 XRP, by definition
        var x = data.t['XRP'];
        ch24 = x ? x[1] : null;
        ch7 = x ? x[2] : null;
      } else {
        var row = data.t[slug(item.issuer, item.currency)];
        if (row) {
          usd = (data.usd != null) ? row[0] * data.usd : null;
          ch24 = row[1];
          ch7 = row[2];
          pxXrp = row[0];
        }
      }

      if (cell.card) {
        // THE 24h FIGURE, matching the desktop cell beside it. This passed `ch7` while the table's
        // price cell was changed to carry the 24h move, so the same holding reported two different
        // percentages depending on the device: XRP read "-4.26%" on a desktop and "-7.92%" on a
        // phone, one measured over a day and the other over a week, neither labelled. The phone's
        // card has one percentage slot, so it shows the same period the desktop's does.
        paintCard(cell.row, usd, ch24);
      } else {
        // THE HEADER OVER THIS CELL READS "PRICE · 24H" AND THE CELL HELD ONLY A PRICE. The 24h
        // change was in the payload the whole time — the entry is [price, change24h, change7d] and
        // only [2] was ever read. lumoscore.com puts both in this one cell ("$0.1759 -4.63%"), which
        // is what makes its header true, and the classes it uses are already styled in the inherited
        // sheet: `#assetsTable .price-cell .lx-p1{display:flex;…}` and `.lx-chg`. Building it any
        // other way would mean writing CSS for a cell the design already dressed.
        priceCell(cell.price, usd, ch24, pxXrp);
        // "≈ $x" under the balance, as Stellar's balance cell has it.
        var b2 = cell.row.querySelector('.b2');
        if (b2) {
          var bal0 = item.xrp ? ((xrp && xrp.balance) || 0) : (+item.balance || 0);
          b2.textContent = (usd != null && bal0 > 0) ? ('≈ ' + money(bal0 * usd)) : '';
        }
        // Still written, though the column is hidden to match Stellar — see the note in wallet.js.
        // Costs nothing and keeps the cell honest if that column is ever brought back.
        paintChange(cell.chg, ch7);
      }
    }

    // ---- Total Portfolio ---------------------------------------------------------------------------
    // The design ships this block as a mock — 31,108.45 APT, $12,847.62, +11.08% — and it stayed that
    // way above a correctly priced list. That is the worst combination: the headline contradicted the
    // rows beneath it, and only the headline was wrong, so the page looked authoritative while lying
    // about the number people read first.
    //
    // Summed from the SAME rows that were just priced, so the two cannot drift apart.
    var totUsd = 0, weighted = 0, pricedAny = false;
    for (var k = 0; k < seq.length; k++) {
      var it2 = seq[k], bal = 0, u2 = null, c2 = null;
      if (it2.xrp) {
        bal = (xrp && xrp.balance) || 0;
        u2 = data.usd;
        var xr = data.t['XRP'];
        c2 = xr ? xr[2] : null;
      } else {
        bal = +it2.balance || 0;
        var r2 = data.t[slug(it2.issuer, it2.currency)];
        if (r2) { u2 = (data.usd != null) ? r2[0] * data.usd : null; c2 = r2[2]; }
      }
      if (u2 == null || !isFinite(u2) || !(bal > 0)) continue;
      var v2 = bal * u2;
      totUsd += v2; pricedAny = true;
      if (c2 != null && isFinite(c2)) weighted += v2 * c2;
    }
    if (pricedAny) paintTotal(totUsd, totUsd > 0 ? (weighted / totUsd) : null);

    attribution();
  }

  // Fills the design's own Total Portfolio block. The elements are the design's and are reused in
  // place — only their text changes, so the type scale, the unit span and the up/down pill keep
  // whatever styling they shipped with.
  //
  // The 7-day figure is VALUE-WEIGHTED from each token's own 7d change, not invented: a holding worth
  // 90% of the wallet moves the number 90% as much. It assumes the balances were the same a week ago,
  // which is the same assumption any "portfolio change" makes without a balance history to read.
  function paintTotal(totUsd, ch7) {
    // Resolved by wallet.js, which is injected just above this file, because the phone's hero uses
    // different class names entirely — see the note on totalBlock() there. Keying on `.value-side`
    // meant this returned immediately on mobile and the design's fabricated total stood.
    var vs = (window.lxxTotals && window.lxxTotals()) || null;
    if (!vs || !data || !(data.usd > 0)) return;
    var xrpTot = totUsd / data.usd;
    // The "Total worth: ~X XRP" on the My Assets heading, written by wallet.js's summary.
    window.__lxxWorthXrp = xrpTot;
    try {
      var me0 = localStorage.getItem('lumos.address');
      if (me0 && totUsd > 0 && !window.__lxxPaintingCached) localStorage.setItem('lumos.xrpl.total.' + me0, JSON.stringify({ x: xrpTot, u: totUsd, c: ch7, t: Date.now() }));
    } catch (e) {}
    try { if (window.__lxxSetChip) window.__lxxSetChip(); } catch (e) {}

    var vEl = vs.value;
    if (vEl) {
      // The unit is the design's own span inside .value. NOT matched on .lxp: that class is added by
      // the Stellar wallet layer, which this build strips, so keying on it found nothing and left the
      // ticker reading "APT" beside a correct XRP total. The span is the only child here.
      var unit = vEl.querySelector('span');
      var first = vEl.firstChild;
      var txt = xrpTot.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ';
      if (first && first.nodeType === 3) first.nodeValue = txt;
      else vEl.insertBefore(document.createTextNode(txt), vEl.firstChild);
      if (unit) { unit.textContent = 'XRP'; unit.classList.add('lxp'); }   // gated until claimed
    }

    var sub = vs.sub;
    if (sub) sub.textContent = '≈ ' + money(totUsd) + ' USD';

    if (ch7 == null || !isFinite(ch7)) return;
    var pill = vs.pill;
    if (pill) {
      // wallet.js hides this while the mock is cleared, so it has to be un-hidden here rather than
      // left invisible with correct text inside it.
      pill.style.visibility = '';
      var pTxt = (ch7 >= 0 ? '+' : '') + ch7.toFixed(2) + '%';
      var last = pill.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = ' ' + pTxt;
      else pill.appendChild(document.createTextNode(' ' + pTxt));
      pill.classList.toggle('up', ch7 >= 0);
      pill.classList.toggle('down', ch7 < 0);
    }
    var sec = vs.secondary;
    if (sec) {
      // The XRP the change is worth: today's total minus what the same holdings were worth.
      var was = xrpTot / (1 + ch7 / 100);
      var d = xrpTot - was;
      sec.textContent = (d >= 0 ? '+' : '') + d.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' XRP';
    }
  }

  // Price and its 24h move in one cell, in the design's own wrappers. Rebuilt each pass rather than
  // appended to, because this layer retries until the rows exist and must not stack two changes.
  function priceCell(td, usd, ch, pxXrp) {
    if (!td) return;
    td.classList.add('price-cell');
    td.textContent = '';
    var p1 = document.createElement('div');
    p1.className = 'p1 lx-p1';
    var m = document.createElement('span');
    m.textContent = money(usd);
    p1.appendChild(m);
    var c = document.createElement('span');
    c.className = 'lx-chg';
    // Left EMPTY rather than em-dashed when there is no figure: the inherited sheet fades this in
    // with `.lx-chg:not(:empty){opacity:1}`, so an em dash would show as a permanent stray mark.
    if (ch != null && isFinite(ch)) {
      c.textContent = pct(ch);
      c.style.color = ch >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
    }
    p1.appendChild(c);
    td.appendChild(p1);
    // Stellar's second line: the price in the native asset ("5.1943 XLM"), for tokens only.
    if (pxXrp > 0) {
      var dp = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(pxXrp))));
      var px = document.createElement('div');
      px.className = 'lx-pxlm';
      px.textContent = pxXrp.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '') + ' XRP';
      td.appendChild(px);
    }
  }

  function paintChange(el, v) {
    var s = pct(v);
    // Empty, as Stellar's is: the column's header is hidden, so a figure here floated under no heading.
    el.textContent = '';
    el.style.color = '';
    el.title = s == null ? '' : ('7d ' + s);
  }

  // The card layout has no price column, so one is added under the balance rather than squeezed in
  // beside it. Idempotent: repainting replaces the node instead of stacking a second one.
  function paintCard(card, usd, ch7) {
    var block = card.querySelector('.asset-balance-block');
    if (!block) return;
    var old = block.querySelector('.lxx-px');
    if (old) old.parentNode.removeChild(old);
    if (usd == null && ch7 == null) return;
    var d = document.createElement('div');
    d.className = 'lxx-px';
    d.style.cssText = 'font-size:12px;font-weight:600;margin-top:2px;opacity:.85';
    d.textContent = money(usd);
    var s = pct(ch7);
    if (s != null) {
      var sp = document.createElement('span');
      sp.textContent = '  ' + s;
      sp.style.color = ch7 >= 0 ? 'var(--green,#22c55e)' : '#e5484d';
      d.appendChild(sp);
    }
    block.appendChild(d);
  }

  // xrpl.to's terms require a visible link wherever this data is shown. Rendered from the payload's
  // own fields so it cannot drift from what the source actually asks for, and inserted once.
  // Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10 once xrpl.to's own API
  // was found stating the requirement verbatim in its response body — see the fuller note in
  // browser/trade.js.
  function attribution() {
    return;                                              // removed: RAZA 2026-09-16, "I still see xrpl.to on wallet page. Remove it from here and all other pages"
    if (!data || !data.attribution) return;
    if (document.getElementById('lxx-attr')) return;
    var host = $('#assetsTable') || $('#assetList');
    if (!host) return;
    var anchor = host.closest('section, .card, main') || host.parentElement;
    if (!anchor) return;
    var p = document.createElement('p');
    p.id = 'lxx-attr';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Prices '));
    var a = document.createElement('a');
    a.href = data.attributionUrl || 'https://xrpl.to';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = data.attribution;
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    anchor.appendChild(p);
  }

  // THE TOP OF THE PAGE PAINTS FIRST (RAZA 2026-09-15: "this section takes forever to load, it should load the
  // quickest"). The total needs every holding priced, and pricing a long wallet costs the price feed two to three
  // seconds cold (measured 2.2s). So the last total this browser worked out for THIS address is shown at once and
  // replaced when the live one lands — the same trick Stellar's wallet uses for its headline. Only the connected
  // address's own figure, and nothing older than a week.
  function paintCachedTotal() {
    try {
      if (data) return;
      var me = localStorage.getItem('lumos.address');
      var c = me && JSON.parse(localStorage.getItem('lumos.xrpl.total.' + me) || 'null');
      if (!c || !(c.x > 0) || !(c.u > 0) || !(Date.now() - c.t < 7 * 86400000)) return;
      var vs = window.lxxTotals && window.lxxTotals();
      if (!vs) return;
      data = { usd: c.u / c.x };
      window.__lxxPaintingCached = true;                        // not written back: it is the old figure
      paintTotal(c.u, c.c);
      window.__lxxPaintingCached = false;
      data = null;
      if (c.c == null) {
        if (vs.pill) vs.pill.style.visibility = 'hidden';
        if (vs.secondary) vs.secondary.textContent = '';
      }
      // Tells wallet.js the design's mock is already gone, so its clearing pass does not blank this figure.
      if (vs.root) vs.root.setAttribute('data-lxxcleared', '1');
    } catch (e) { data = null; }
  }

  // A SINGLE ATTEMPT WAS NOT ENOUGH, and the way it failed is the reason this retries.
  //
  // The Total Portfolio headline ships as a mock: 31,108.45 APT. This layer is what replaces it, so
  // any path where this layer quietly stops leaves that fabricated Aptos figure standing as the
  // largest number on the page, above ten real XRP Ledger holdings. There were two such paths, and
  // both ended in `return` with nothing logged:
  //
  //   * the fetch fails or the upstream is briefly rate-limited -> data stays null, forever;
  //   * the fetch SUCCEEDS but resolves before wallet.js has painted its rows -> apply() finds no
  //     targets, returns, and is never called again.
  //
  // Measured: the page settled correctly at ~2.1s on one load and was still showing the mock nine
  // seconds into another. That is the signature of a race, not of a broken endpoint.
  //
  // So: retry the fetch a few times with a widening gap, and once data is in, keep re-applying until
  // the rows it needs actually exist. Both loops are bounded — a page that genuinely has no prices
  // ends up with em dashes and a blank total, which is the honest outcome, not a made-up one.
  function start(attempt) {
    if (!$('#assetsTable') && !$('#assetList')) return;      // not a wallet page
    attempt = attempt || 1;
    if (attempt === 1 && window.__lxxPricesStarted) return;     // the event and the poll both start it
    window.__lxxPricesStarted = 1;
    var held = (window.__lxxData && window.__lxxData.held) || [];
    var slugs = held.map(function (h) { return slug(h.issuer, h.currency); });
    fetchPrices(slugs).then(function (j) {
      if (!j) {
        if (attempt < 4) setTimeout(function () { start(attempt + 1); }, attempt * 1500);
        return;                                              // then leave the dashes; say nothing false
      }
      data = j;
      apply();

      // ATTRIBUTION IS CALLED HERE TOO, not only from the end of apply().
      //
      // BELT AND BRACES, NOT A PROVEN BUG — said plainly because the first version of this comment
      // claimed more than was measured. attribution() opens with `if (!data ...) return`, and its
      // only caller was apply(), which can run before this assignment. I saw the line missing once
      // and present once on an unchanged build, so the single call is TIMING-DEPENDENT rather than
      // reliably broken; the absence I first blamed on ordering turned out to be a deploy that had
      // not propagated.
      //
      // Calling it where `data` is known to exist makes it deterministic instead of a race, and it
      // is idempotent — the function returns early once #lxx-attr is on the page. For a line that
      // has to be there for licensing reasons, deterministic is worth one extra call.
      attribution();
      // apply() is a no-op until the rows are on the page. Watch for them rather than assume.
      var n = 0;
      var t = setInterval(function () {
        if (++n > 20) { clearInterval(t); return; }           // ~10s
        if (!targets().length) return;
        clearInterval(t);
        apply();
      }, 500);
    });
  }

  // wallet.js finishes asynchronously and can repaint. Waiting for its data rather than for the DOM
  // is what makes this reliable; the interval gives up rather than spinning forever.
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.__lxxData) { clearInterval(timer); start(); }
    else if (tries > 60) clearInterval(timer);               // ~30s, then stop
  }, 500);
  // Straight away when wallet.js announces its data, rather than on the next half-second poll.
  window.addEventListener('lxx:walletdata', function () { clearInterval(timer); start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintCachedTotal);
  else paintCachedTotal();

  window.__lxxPricesApply = apply;
})();

// Signed transactions: Receive QR, Send, and Cancel order.
//
// Everything else on this build READS the ledger. This is the first layer that asks the user's wallet
// to sign something, which changes what a bug costs: a read that goes wrong shows a wrong number, a
// write that goes wrong moves someone's money to the wrong place and cannot be undone.
//
// So the rules here are stricter than elsewhere in this project:
//
//   * NOTHING IS SUBMITTED THAT HAS NOT BEEN CHECKED AGAINST THE LEDGER FIRST. Every failure mode
//     below was chosen because the transaction would otherwise be signed by the user, succeed or fail
//     on-chain, and cost a real fee or real funds to learn what this code could have known for free.
//   * The design's own modals are used exactly as they ship. No new dialog, no new field, no new
//     page — the amount input, the recipient input, the asset button and the confirm button are all
//     the design's, and only their behaviour is added.
//   * Amounts are built from the ledger's own units (drops, issued-currency objects), never from the
//     formatted strings on screen.
//
// Signing goes through window.lxc.submit(tx), which refuses rather than guesses when the stored
// connection has no transport. That refusal is deliberate and is not worked around here.
(function () {
  if (window.__lxxWrite) return;
  window.__lxxWrite = 1;

  var RPC = 'https://xrplcluster.com/';
  var DROP = 1000000;
  // Substituted at build time by _tools/xrpladdr.js, which checksum-verifies it and refuses to build
  // if this placeholder is ever removed — shipping the literal string as a payment destination would
  // be a transaction that cannot be signed, or worse, one that can.
  var COLLECTOR = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  // EVERY READ HAS A DEADLINE (RAZA 2026-09-17: a swap that "just stucks there"). Measured the same day: `ripple_path_find`
  // answers in 0.4s buying RLUSD and 28.4s selling it, and `fetch` will wait on a public node indefinitely — so one slow
  // answer left "Finding a route…" on screen with no error and no way forward.
  function rpc(method, params, ms) {
    var ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    var limit = ms || (method === 'ripple_path_find' ? 12000 : 20000);
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, limit);
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw new Error((e && e.name === 'AbortError') ? 'The ledger did not answer in time — try again.'
        : ((e && e.message) || 'ledger unavailable'));
    });
  }

  // The logo layer claims any element holding one to five characters and empties it. data-logoed is
  // its own skip marker. Same helper as wallet.js, for the same reason.
  function plain(e, text) {
    try {
      e.removeAttribute('data-logo');
      e.style.background = '';
      e.style.backgroundImage = '';
      e.setAttribute('data-logoed', '1');
    } catch (_) {}
    e.textContent = text;
  }

  var XRP_THUMB = '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48';
  function thumbOf(a) {
    if (!a || !a.issuer) return XRP_THUMB;
    return '/lxapi/xrplthumb?iss=' + encodeURIComponent(a.issuer) + '&cur=' + encodeURIComponent(a.currency || '') + '&w=48';
  }
  // Scanning is a phone action: on a desktop the camera points at the user. Same UA test the site already
  // uses to decide which page to serve.
  function isPhone() {
    try { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }

  // ---- Receive: Stellar's layout -------------------------------------------------------------------
  // RAZA 2026-09-15: "The receive popup is not same as on Stellar." lumoscore.com rebuilds this body as
  // .lx-rc — the QR on a white card with accent corners and the logo in its centre, a globe-marked
  // "Your … address" label, the address in a copyable box, and a one-line warning. The inherited sheet
  // carries every .lx-rc* rule; only the markup was missing, because the layer that wrote it was Stellar's.
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  // The Receive dialog's copy controls toast "Copied to clipboard", as lumoscore.com's do — see wallet.js setChip.
  function stripCopyLabels() {
    $$('#modalReceive [data-copy-label], .lx-rc [data-copy-label]').forEach(function (b) { b.removeAttribute('data-copy-label'); });
  }

  function enhanceReceive() {
    var me = addr();
    // The address is written into markup, so it must be a real r-address and nothing else.
    if (!me || !window.lxx || !window.lxx.isAddress(me)) return;
    $$('.qr-display').forEach(function (disp) {
      var body = disp.closest('.modal-body');
      if (!body || body.getAttribute('data-lxrc') === '1') return;
      body.setAttribute('data-lxrc', '1');
      var wrap = document.createElement('div');
      wrap.className = 'lx-rc';
      wrap.innerHTML = '<div class="lx-rc-qrwrap"><div class="qr-frame"><svg></svg></div>'
        + '<span class="lx-rc-corner tl"></span><span class="lx-rc-corner tr"></span>'
        + '<span class="lx-rc-corner bl"></span><span class="lx-rc-corner br"></span>'
        + '<div class="lx-rc-qrlogo"><img src="/assets/favicon.png" alt=""></div></div>'
        + '<div class="lx-rc-addrlabel">' + GLOBE + ' Your XRP Ledger address</div>'
        + '<div class="lx-rc-addr" data-copy="' + me + '">' + me + '</div>'
        + '<div class="lx-recv-note lx-rc-note">' + WARN
        + '<span><strong>XRP Ledger assets only.</strong> Other networks = lost funds.</span></div>';
      var ov = body.closest('.modal-overlay');
      if (ov) ov.classList.add('lx-recv-modal');
      body.innerHTML = '';
      body.appendChild(wrap);
      var ad = wrap.querySelector('.lx-rc-addr');
      ad.addEventListener('click', function () {
        try { if (navigator.clipboard) navigator.clipboard.writeText(ad.getAttribute('data-copy') || me); } catch (e) {}
        ad.classList.add('lx-copied');
        setTimeout(function () { ad.classList.remove('lx-copied'); }, 1400);
      });
    });
  }

  // ---- Send: recipient Paste and Scan ----------------------------------------------------------------
  // A scanned or pasted value may be a bare address or a wallet URI carrying one (and maybe a tag).
  // Returns true only when an XRP Ledger address was found and written.
  function fillRecipient(rec, raw) {
    var t = String(raw || '').trim();
    var am = t.match(/r[1-9A-HJ-NP-Za-km-z]{24,34}/);
    if (!am || !window.lxx || !window.lxx.isAddress(am[0])) return false;
    rec.value = am[0];
    try { rec.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    var tm = t.match(/[?&](?:dt|tag|destinationTag)=(\d{1,10})\b/i);
    var tg = document.getElementById('lxwTag');
    if (tm && tg) tg.value = tm[1];
    return true;
  }

  // jsQR, self-hosted beside xrpl.js and fetched only when someone taps Scan — Stellar's scanner.
  var qrLib = null;
  function loadQrLib() {
    if (qrLib) return qrLib;
    qrLib = new Promise(function (res, rej) {
      if (window.jsQR) return res(window.jsQR);
      var s = document.createElement('script');
      s.src = '/assets/vendor/jsqr-1.4.0.js';
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error('The scanner failed to load.')); };
      s.onerror = function () { qrLib = null; rej(new Error('The scanner failed to load.')); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  // The camera sheet. Everything that can end it goes through stop(), so the camera is never left running.
  function scanQr(onText) {
    if (!window.isSecureContext) { say('The camera needs a secure (https) connection.', 'bad'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This browser cannot open the camera.', 'bad'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
    var vid = document.createElement('video');
    vid.setAttribute('playsinline', ''); vid.muted = true; vid.autoplay = true;
    vid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
    var frame = document.createElement('div');
    frame.style.cssText = 'position:relative;width:66vw;max-width:300px;aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:18px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)';
    var hint = document.createElement('div');
    hint.textContent = 'Point at an XRP Ledger address QR code';
    hint.style.cssText = 'position:absolute;left:0;right:0;bottom:14vh;text-align:center;color:#fff;font:600 14px system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:6vh;padding:11px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.5);color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer';
    ov.appendChild(vid); ov.appendChild(frame); ov.appendChild(hint); ov.appendChild(cancel);
    document.body.appendChild(ov);
    var stream = null, raf = 0, dead = false;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); stop(); } }
    function stop() {
      if (dead) return;
      dead = true;
      try { cancelAnimationFrame(raf); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { vid.srcObject = null; } catch (e) {}
      document.removeEventListener('keydown', onKey, true);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stop(); });
    var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    loadQrLib().then(function (dec) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
        if (dead) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = st;
        vid.srcObject = st;
        return vid.play().catch(function () {}).then(function () {
          (function tickScan() {
            if (dead) return;
            if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
              var w = 480, h = Math.max(1, Math.round(vid.videoHeight * (w / (vid.videoWidth || w))));
              if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
              cx.drawImage(vid, 0, 0, w, h);
              var r = null;
              try { r = dec(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }); } catch (e) {}
              if (r && r.data) { stop(); onText(r.data); return; }
            }
            raf = requestAnimationFrame(tickScan);
          })();
        });
      });
    }).catch(function (err) {
      stop();
      var n = (err && err.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') say('Camera permission was declined.', 'bad');
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') say('No camera found on this device.', 'bad');
      else say((err && err.message) || 'Could not open the camera.', 'bad');
    });
  }

  function addRecipientButtons(rec) {
    if (rec.__lxxRecBtns) return;
    rec.__lxxRecBtns = 1;
    var wrap = document.createElement('div');
    wrap.style.position = 'relative';
    rec.parentNode.insertBefore(wrap, rec);
    wrap.appendChild(rec);
    var bar = document.createElement('div');
    bar.className = 'lx-recbtns';
    if (isPhone()) {
      var sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'lx-paste-btn lx-scan-btn';
      sb.setAttribute('data-logoed', '1');
      sb.setAttribute('aria-label', 'Scan a QR code');
      sb.title = 'Scan a QR code';
      sb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M21 16v3a2 2 0 0 1-2 2h-3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M7 12h10"></path></svg>';
      sb.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        scanQr(function (txt) {
          if (fillRecipient(rec, txt)) say('Address scanned.', 'good');
          else say('That QR code has no XRP Ledger address in it.', 'bad');
        });
      });
      bar.appendChild(sb);
    }
    var pb = document.createElement('button');
    pb.type = 'button';
    pb.className = 'lx-paste-btn';
    pb.setAttribute('data-logoed', '1');                           // five letters: keep the logo healer off it
    pb.textContent = 'Paste';
    pb.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!navigator.clipboard || !navigator.clipboard.readText) { say('Clipboard unavailable — paste with Ctrl+V.', 'bad'); return; }
      navigator.clipboard.readText().then(function (x) {
        if (!fillRecipient(rec, x)) { rec.value = String(x || '').trim(); }
        say('');
        try { rec.focus(); } catch (e2) {}
      }, function () { say('Clipboard blocked — paste with Ctrl+V.', 'bad'); });
    });
    bar.appendChild(pb);
    wrap.appendChild(bar);
    function fit() {
      try { var bw = bar.getBoundingClientRect().width; if (bw > 0) rec.style.paddingRight = Math.round(bw + 14) + 'px'; } catch (e) {}
    }
    rec.style.paddingRight = isPhone() ? '118px' : '70px';
    fit(); setTimeout(fit, 60); setTimeout(fit, 400);
  }

  // ---- Receive QR ----------------------------------------------------------------------------------
  // The design ships a hand-drawn SVG under a comment that says "Faux QR pattern (decorative)". It is
  // a picture of a QR code: it encodes nothing, and it sits directly above the correct address on the
  // one screen whose entire purpose is telling somebody where to send money. A person who scans it
  // gets garbage, and the only reason that is not worse is that no wallet will parse it as an address.
  //
  // Replaced with a real one. The renderer is the Stellar build's, unchanged, because it is already
  // the corrected version — an earlier attempt there shipped unscannable and the two fixes are both
  // load-bearing and both invisible if you only look at it:
  //
  //   width/height 1.04 rather than 1 — at 1 the modules meet exactly on a pixel boundary and the
  //   renderer's antialiasing leaves a pale seam between every pair, which reads as noise to a decoder.
  //
  //   fill dark on an explicitly white background — QR polarity is not a style choice. Inverted, it is
  //   not a low-contrast QR code, it is not a QR code, and it fails silently on every scanner.
  //
  // The error-correction ladder tries the densest levels first so the code stays small; addData throws
  // when the data will not fit the requested version, hence the try/catch walk rather than a guess.
  function makeQR(txt) {
    var lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
    for (var i = 0; i < lv.length; i++) {
      try {
        var q = window.qrcode(lv[i][0], lv[i][1]);
        q.addData(txt);
        q.make();
        return q;
      } catch (e) {}
    }
    return null;
  }

  // EVERY frame, not the first one. The page ships TWO complete sets of modals — the desktop set, and
  // a second set inside #lx-mobmodals that is the one a phone actually shows. querySelector returns
  // the desktop copy, so painting "the" QR left the phone's untouched. Same trap as the duplicated
  // .section-heading .meta, and the reason nothing below uses a singular lookup either.
  function paintQR() {
    try {
      if (!window.qrcode) return;
      var me = addr();
      if (!me) return;
      var q = null;
      $$('.qr-frame svg, .qr-display svg').forEach(function (fr) {
        if (fr.getAttribute('data-lxqr') === me) return;         // keyed on the address, so it
        q = q || makeQR(me);                                     // repaints if the wallet changes
        if (!q) return;
        var n = q.getModuleCount(), s = '';
        for (var r = 0; r < n; r++) {
          for (var c = 0; c < n; c++) {
            if (q.isDark(r, c)) s += '<rect x="' + c + '" y="' + r + '" width="1.04" height="1.04"></rect>';
          }
        }
        fr.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
        fr.setAttribute('fill', '#0d1117');
        fr.style.background = '#fff';
        fr.innerHTML = s;
        fr.setAttribute('data-lxqr', me);
        fr.classList.add('lx-qr-ready');
        // AND THEN IT WAS STILL INVISIBLE — a correct, decodable, 551-module QR rendering as a plain
        // white square. The orphaned Stellar stylesheet carries
        //     .qr-display .qr-frame svg, .qr-display canvas, .qr-display img { visibility:hidden!important }
        // which hides the design's faux QR until a data layer supplies a real one. Its companion rule,
        //     .lx-rc-qrwrap .qr-frame svg:not(.lx-qr-ready) { visibility:hidden }
        // shows that the intended escape was for Stellar's layer to REBUILD the receive body inside its
        // own .lx-rc-qrwrap — so within .qr-display there is no escape at all: the rule is unconditional
        // and !important, and adding .lx-qr-ready does nothing against it.
        //
        // Rebuilding the modal to dodge a stylesheet would be changing the design to work around a rule
        // belonging to a layer that is gone. Lifting the gate on the one element now holding real data
        // is smaller and says what it means. An inline !important is what outranks a sheet !important.
        fr.style.setProperty('visibility', 'visible', 'important');
      });
    } catch (e) {}
  }

  // THE RECEIVE SCREEN WAS TELLING PEOPLE THE WRONG ADDRESS, ON THE WRONG CHAIN.
  //
  // On a phone it read, in full: a QR, the label "Your Aptos address", the address
  // GA7K5N4M2X9P3R8Q1L6T2V8W4Y7Z3A5B8C2D6E1F4G7H9J2K5N4M2 — a Stellar-shaped string from the design
  // mock, belonging to nobody — and under it "Only send APT and Aptos-based assets to this address.
  // Sending assets from other networks will result in loss of funds."
  //
  // The data-copy attribute beside it held the RIGHT address the whole time, so the Copy button worked
  // and only the visible text was wrong. That is the worst possible split: anyone who copied was fine,
  // anyone who read the screen — or photographed it, or typed it out — sent funds into nothing. It is
  // also why no DOM check caught it; every probe I ran read data-copy and came back correct.
  //
  // Stellar's wallet layer used to rewrite this text (matching the same GA7K5N4M prefix). Stripping
  // that layer took the correction with it and left the mock, which is the general hazard recorded in
  // the stripped-layer notes: the CSS and the markup stay, only the fix leaves.
  function fixReceive() {
    var me = addr();
    if (!me) return;

    // The address line. Keyed on data-copy where the design provides it — that attribute is the
    // design's own statement of which element holds the address — and otherwise on the mock's shape.
    $$('.qr-addr, [data-copy]').forEach(function (e) {
      var t = (e.textContent || '').trim();
      if (!t || t === me) return;
      var looksLikeAddr = /^[Gr][A-Za-z0-9]{24,}$/.test(t);
      if (!looksLikeAddr) return;                                // never touch a button's label
      e.textContent = me;
      if (e.hasAttribute('data-copy')) e.setAttribute('data-copy', me);
    });

    $$('.qr-label').forEach(function (e) {
      if (/aptos|stellar/i.test(e.textContent || '')) e.textContent = 'Your XRP Ledger address';
    });

    // The warning is the most important sentence on the screen and it named the wrong chain twice.
    // Rewritten as text, on the element that holds it, so the design's box and accent styling stay.
    $$('.modal-body div, .lx-recv-note, .lt-hint').forEach(function (e) {
      if (e.__lxwarn) return;
      var t = e.textContent || '';
      if (!/Only send/i.test(t) || !/APT|Aptos/.test(t)) return;
      e.__lxwarn = 1;
      [].forEach.call(e.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/Only send APT and Aptos-based assets/i, 'Only send XRP and XRP Ledger assets')
          .replace(/\bAptos-based\b/gi, 'XRP Ledger')
          .replace(/\bAPT\b/g, 'XRP')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
    });
  }

  // ---- shared: the connected account's holdings ----------------------------------------------------
  // wallet.js publishes these. Reading its object rather than re-fetching keeps one answer about what
  // is held and what is spendable, so Send can never offer an amount the balance list disagrees with.
  function held() {
    var d = window.__lxxData;
    if (!d) return [];
    var out = [];
    if (d.xrp) {
      out.push({
        code: 'XRP', issuer: null, currency: null,
        balance: d.xrp.balance, spendable: d.xrp.spendable
      });
    }
    (d.held || []).forEach(function (t) {
      out.push({
        code: t.display, issuer: t.issuer, currency: t.currency,
        balance: t.balance, spendable: t.balance, frozen: t.frozen
      });
    });
    return out;
  }

  // ---- Send ----------------------------------------------------------------------------------------
  var sendPick = null;                                          // the asset currently selected

  function sendModal() { return $('#modalSend'); }

  // A REAL LOGO (RAZA 2026-09-15: "Wallet → Swap popup, most of the logos are incorrect"). The page's logo healer paints any
  // one-letter badge from a ticker lookup that knows nothing about XRP Ledger issuers — XYIELD came out as a letter, LUMOS
  // as a stock flame. An <img> child is the one thing the healer leaves alone, so the token's own thumbnail goes in one.
  function icoImg(host, a) {
    host.textContent = '';
    host.setAttribute('data-logoed', '1');
    host.style.background = 'transparent';
    host.style.overflow = 'hidden';
    host.style.padding = '0';
    var im = document.createElement('img');
    im.alt = '';
    im.src = thumbOf(a);
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:50%';
    im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); plain(host, a.code.charAt(0).toUpperCase()); };
    host.appendChild(im);
  }

  function setSendAsset(a) {
    var m = sendModal();
    if (!m || !a) return;
    sendPick = a;

    var btn = $('.asset-pick', m);
    if (btn) {
      // The button holds an icon span, the ticker as a bare text node, and a chevron svg. Only the
      // text node is replaced: rewriting the button would take the design's icon and chevron with it.
      var ico = $('.a-ico', btn);
      if (ico) plain(ico, a.code.charAt(0).toUpperCase());
      [].forEach.call(btn.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
      });
    }

    var lp = $('.lx-asset-pick', m);
    if (lp) {
      var lc = $('.lx-ap-code', lp);
      if (lc) plain(lc, a.code);
      var li = $('.lx-ap-ico', lp);
      if (li) { plain(li, ''); li.style.setProperty('--lxlogo', 'url("' + thumbOf(a) + '")'); }
    }

    var bal = $('.field-meta strong', m);
    // "Balance" here means what can actually be sent. For XRP that is the balance MINUS the reserve,
    // which is not a detail: the design shipped this row reading 25,420.18 APT, and a Max button that
    // offers the full balance of an XRP account builds a transaction the ledger always rejects.
    if (bal) bal.textContent = fmt(a.spendable, 6) + ' ' + a.code;

    var fee = $('.modal-body strong[style*="JetBrains"]', m);
    if (fee) fee.textContent = '~0.000012 XRP';
    say('');
  }

  // The asset menu. Built from the design's own field styling and anchored under the picker button,
  // because the design ships a button with a chevron and no menu behind it.
  function openAssetMenu(btn) {
    var m = sendModal();
    if (!m) return;
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }        // second click closes

    var list = held().filter(function (a) { return a.spendable > 0 && !a.frozen; });
    if (!list.length) return;

    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:210px;'
      + 'max-height:260px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'lxw-astrow';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      icoImg(ic, a);
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      var bl = document.createElement('span');
      bl.style.cssText = 'opacity:.7;font-size:12px';
      bl.textContent = fmt(a.spendable, 4);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(bl);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSendAsset(a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });

    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);

    // Closing on an outside click is registered on the NEXT frame. Binding it synchronously means the
    // very click that opened this menu is still propagating, reaches document, and closes it again —
    // which on a phone looks exactly like "the dropdown shuts the first time you tap it".
    requestAnimationFrame(function () {
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  // STELLAR'S FAILURE TOAST (RAZA 2026-09-17: "When Wallet → send trx is canceled, you need to show the same message that
  // you show on Stellar"). lumoscore.com ends a failed send with `lxToast(err.message || "Send failed", true)` — a toast at
  // the foot of the page with a red mark — and a wallet that refuses carries no message, which is why the Stellar screenshot
  // reads exactly "Send failed". Same element and classes the copy toast on the Wallet page already uses; only the mark
  // differs, so the two cannot drift apart visually.
  function toastBad(msg) {
    if (!document.getElementById('lx-toastbad-css')) {
      var st = document.createElement('style');
      st.id = 'lx-toastbad-css';
      st.textContent = '.lx-ctoast-stack{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
        + '.lx-ctoast{background:var(--text,#16171b);color:var(--bg,#fff);padding:11px 18px 11px 14px;border-radius:10px;font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:9px;white-space:nowrap;box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.16)}'
        + '.lx-ctoast .ci{width:18px;height:18px;border-radius:50%;background:var(--green,#35c07f);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px}'
        + '.lx-ctoast.bad .ci{background:#e5484d}';
      (document.head || document.documentElement).appendChild(st);
    }
    var stack = document.querySelector('.lx-ctoast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'lx-ctoast-stack'; document.body.appendChild(stack); }
    var t = document.createElement('div');
    t.className = 'lx-ctoast bad';
    var ic = document.createElement('span'); ic.className = 'ci'; ic.textContent = '✕';
    var tx = document.createElement('span'); tx.textContent = msg || 'Send failed';
    t.appendChild(ic); t.appendChild(tx);
    stack.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }

  // Status line. Reuses the modal's own body so nothing new is introduced; created once, then reused.
  function say(text, tone) {
    var m = sendModal();
    if (!m) return;
    var box = $('.lxw-say', m);
    if (!box) {
      var body = $('.modal-body', m);
      if (!body) return;
      box = document.createElement('div');
      box.className = 'lxw-say';
      box.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;font-weight:600';
      body.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  // A DESTINATION TAG FIELD, because without one this wallet cannot pay an exchange at all.
  //
  // An exchange deposit address is shared by every customer; the tag is what says which account the
  // money belongs to. Send without it and the deposit is not credited — the classic way to lose funds
  // on this ledger, and the reason preflight() refuses outright when the destination demands one.
  //
  // This is NOT new UI. The Stellar build adds a "Memo (optional)" field to this very modal from its
  // own data layer, beside the network-fee row, for exactly the same purpose. This is that field, with
  // the XRP Ledger's equivalent in it, added the same way and in the same place.
  function tagInput() { return $('#lxwTag'); }

  function addTagField(m) {
    if ($('#lxwTag', m)) return;
    var feeRow = $('.modal-body > div[style*="justify-content"]', m);
    var body = $('.modal-body', m);
    if (!body) return;
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = 'Destination tag ';
    var hint = document.createElement('span');
    hint.className = 'meta';
    hint.textContent = 'required by most exchanges';
    lab.appendChild(hint);
    var inp = document.createElement('input');
    inp.className = 'field-input mono';
    inp.id = 'lxwTag';
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('placeholder', 'Optional — digits only');
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    if (feeRow && feeRow.parentNode === body) body.insertBefore(wrap, feeRow);
    else body.appendChild(wrap);
  }

  function parseDest(raw) {
    var s = String(raw || '').trim();
    if (!s) return { err: 'Enter a recipient address.' };
    if (s.charAt(0) === 'X') {
      // X-addresses carry the tag inside the address. Decoding one needs a double-SHA256 checksum
      // verification, which is not built here — and silently dropping the tag it carries would be
      // the exact loss this field exists to prevent. So it is refused, clearly, rather than guessed.
      return { err: 'X-addresses are not supported yet. Use the classic r… address and put its tag in the Destination tag field.' };
    }
    if (!window.lxx || !window.lxx.isAddress(s)) {
      return { err: 'That is not a valid XRP Ledger address.' };
    }
    var t = tagInput();
    var raw2 = t ? String(t.value || '').trim().replace(/[ ,]/g, '') : '';
    if (!raw2) return { account: s, tag: null };
    if (!/^\d+$/.test(raw2)) return { err: 'A destination tag is digits only.' };
    var n = Number(raw2);
    // A tag is an unsigned 32-bit integer. Anything larger is not a tag the ledger can carry, and
    // submitting it produces a malformed transaction rather than a helpful error.
    if (!isFinite(n) || n > 4294967295) return { err: 'That destination tag is out of range.' };
    return { account: s, tag: n };
  }

  // Everything the ledger can tell us BEFORE the user signs. Each check here is a transaction that
  // would otherwise be signed, submitted, and fail — costing a fee and a lot of confusion.
  function preflight(dest, a, amount) {
    return rpc('account_info', { account: dest.account, ledger_index: 'validated' })
      .then(function (r) { return r.account_data; })
      .catch(function (e) {
        if (/actNotFound/i.test(e.message || '')) return null;   // unfunded, which is legal for XRP
        throw e;
      })
      .then(function (ad) {
        if (!ad) {
          // An account does not exist until it holds the base reserve. Sending less than that to an
          // unfunded address fails with tecNO_DST_INSUF_XRP, and sending a TOKEN to one cannot work
          // at all — there is no account to hold a trustline.
          if (a.code !== 'XRP') {
            return { err: 'That account is not activated yet. It must be funded with XRP before it can receive tokens.' };
          }
          return rpc('server_info', {}).then(function (si) {
            var base = ((si.info || {}).validated_ledger || {}).reserve_base_xrp;
            base = +base || 1;
            if (amount < base) {
              return { err: 'That account is not activated. A first payment must be at least ' + base + ' XRP.' };
            }
            return { warn: 'This activates a new account. ' + base + ' XRP of it becomes their reserve and cannot be spent.' };
          });
        }
        // DEPOSIT AUTHORISATION: the destination can refuse payments from accounts it has not
        // preauthorised. lsfDepositAuth is bit 0x01000000 in the account flags.
        if ((ad.Flags & 0x01000000) && dest.account !== addr()) {
          return { err: 'That account only accepts payments from pre-approved senders.' };
        }
        // DESTINATION TAG REQUIRED: lsfRequireDestTag, 0x00020000. Exchanges set this because a
        // payment without a tag cannot be credited to anyone — it is the classic way to lose a
        // deposit. Refusing here is the whole reason X-addresses are accepted above.
        if ((ad.Flags & 0x00020000) && dest.tag == null) {
          return { err: 'That account requires a destination tag — fill in the Destination tag field, or the payment will not be credited.' };
        }
        if (a.code === 'XRP') return {};

        // PAYING A TOKEN BACK TO ITS OWN ISSUER IS A REDEMPTION, and it needs no trustline — the
        // issuer is not "holding" its own obligation, it is retiring it. The check below refused it
        // with "That account has no trustline for ARMY, so it cannot receive it", which is not just
        // unhelpful but false: that account is the one account that can always receive ARMY.
        //
        // Found by driving the real Send flow with the ARMY issuer as the destination. The refusal
        // is conservative rather than dangerous — it blocks a valid payment instead of allowing an
        // invalid one — but it blocks the standard way to redeem with a gateway.
        if (dest.account === a.issuer) return {};

        // A token can only be received by an account that trusts it. Without this the payment fails
        // with tecPATH_DRY, whose wording tells the user nothing.
        return rpc('account_lines', { account: dest.account, peer: a.issuer, ledger_index: 'validated' })
          .then(function (r) {
            var ok = (r.lines || []).some(function (l) {
              return l.currency === a.currency && (+l.limit > 0 || +l.balance !== 0);
            });
            return ok ? {} : { err: 'That account has no trustline for ' + a.code + ', so it cannot receive it.' };
          });
      });
  }

  function doSend() {
    var m = sendModal();
    if (!m) return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !toIn || !go) return;

    var a = sendPick || held()[0];
    if (!a) { say('No balance to send.', 'bad'); return; }

    var amount = parseFloat(String(amtIn.value).replace(/,/g, ''));
    if (!(amount > 0)) { say('Enter an amount greater than zero.', 'bad'); return; }
    if (amount > a.spendable) {
      say('That is more than you can send. ' + fmt(a.spendable, 6) + ' ' + a.code + ' is available.', 'bad');
      return;
    }
    var dest = parseDest(toIn.value);
    if (dest.err) { say(dest.err, 'bad'); return; }
    if (dest.account === addr()) { say('That is your own address.', 'bad'); return; }

    var label = go.textContent;
    go.disabled = true;
    say('Checking the destination…');

    preflight(dest, a, amount).then(function (chk) {
      if (chk && chk.err) { go.disabled = false; say(chk.err, 'bad'); return; }
      say((chk && chk.warn ? chk.warn + ' ' : '') + 'Approve the payment in your wallet…');

      // AND IF THE WALLET NEVER ANSWERS, SAY SO. A refusal that the extension reports lands in the catch below and is
      // shown; dismissing the popup WITHOUT answering reports nothing at all, and the dialog sat on "Approve the payment
      // in your wallet…" indefinitely (RAZA 2026-09-17: "on Stellar it shows an error, on XRP it doesnt"). This does not
      // claim the payment failed — it cannot know that — it says what is true and what to do.
      var nudge = setTimeout(function () {
        say('Still waiting for your wallet. If you closed or declined the request, nothing was sent — press Cancel and try again.');
      }, 20000);

      var tx = { TransactionType: 'Payment', Account: addr(), Destination: dest.account };
      if (dest.tag != null) tx.DestinationTag = dest.tag;
      if (a.code === 'XRP') {
        // Drops are integers. Rounding rather than truncating a float here is what stops
        // 0.1 + 0.2 arithmetic from silently shaving a drop off the amount the user typed.
        tx.Amount = window.lxx.toDrops(amount);
      } else {
        tx.Amount = { currency: a.currency, issuer: a.issuer, value: String(amount) };
      }

      return window.lxc.submit(tx).then(function (hash) {
        clearTimeout(nudge);
        say('Sent. ' + short(hash), 'good');
        amtIn.value = '';
        toIn.value = '';
        var tg = tagInput();
        // Cleared with the rest of the form. A tag left behind belongs to the last recipient, and the
        // next payment would silently carry someone else's deposit reference.
        if (tg) tg.value = '';
        // AND THE DIALOG CLOSES (RAZA 2026-09-17: "once the amount is sent, please close the popup"). Long enough to read
        // the hash, then out of the way — the balances behind it refresh a moment later.
        setTimeout(function () { closeSend(); }, 1800);
        setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3500);
      }, function (e) {
        clearTimeout(nudge);
        throw e;
      });
    }).catch(function (e) {
      // A wallet that refuses, does not answer, or hands back no hash tells us the same thing and nothing more: the payment
      // did not go. Stellar says "Send failed" for exactly that case, so this says it too, instead of naming the extension's
      // internals at someone who has just pressed Reject. A message the LEDGER gave — an unfunded account, a missing trust
      // line — is real information and still travels.
      var msg = String((e && e.message) || '');
      var plumbing = !msg || /did not return a transaction hash|did not respond|rejected in|could not sign|user (declined|rejected)/i.test(msg);
      say(plumbing ? '' : msg, 'bad');
      toastBad(plumbing ? 'Send failed' : msg);
    }).then(function () {
      go.disabled = false;
      go.textContent = label;
    });
  }

  function closeSend() {
    var m = sendModal();
    if (!m) return;
    var x = m.querySelector('.modal-close, [data-close]');
    if (x) x.click();
    else { m.classList.remove('open'); m.style.display = 'none'; }
  }

  // Blanks the form. Called when the dialog opens, so nothing survives from the last time it was used.
  function resetSend() {
    var m = sendModal();
    if (!m) return;
    var amt = $('.field-amt input', m);
    var to = $('.field-input.mono', m) || $('input.mono', m);
    var tg = tagInput();
    if (amt) amt.value = '';
    // …except the one case where an address was asked for deliberately: "Send to this wallet" arrives as /wallet?to=r…
    // and opens this dialog by clicking Send, so that address must survive the reset it triggers.
    if (to) { to.value = pendingTo || ''; }
    pendingTo = null;
    if (tg) tg.value = '';
    say('');
  }

  function wireSend() {
    var m = sendModal();
    if (!m || m.getAttribute('data-lxw') === '1') return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var pick = $('.asset-pick', m);
    var max = $('.pill-btn', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !go) return;                                   // markup not ready yet
    m.setAttribute('data-lxw', '1');

    // STELLAR'S SEND ROW (RAZA 2026-09-15: "Max button is different on XRPL. Paste button is missing. On
    // mobile … barcode scan icon is missing"). lumoscore.com hides the design's asset button behind its own
    // .lx-asset-pick, moves Max INTO the amount field as .lx-max-inline, and puts Paste (with Scan on a
    // phone) inside the recipient box. The inherited sheet carries every one of those rules.
    var famt = $('.field-amt', m);
    if (pick && famt && !$('.lx-asset-pick', m)) {
      pick.style.display = 'none';
      var np = document.createElement('button');
      np.type = 'button';
      np.className = 'lx-asset-pick';
      np.setAttribute('data-lx-noswap', '');
      np.innerHTML = '<span class="lx-ap-ico" data-logoed="1"></span><span class="lx-ap-code" data-logoed="1">XRP</span>'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      pick.parentNode.insertBefore(np, pick.nextSibling);
      pick = np;
    }
    if (max && famt && max.parentNode !== famt) {
      famt.classList.add('lx-send-amt');
      max.classList.add('lx-max-inline');
      famt.appendChild(max);
    }
    if (toIn) addRecipientButtons(toIn);
    if (sendPick) setSendAsset(sendPick);

    // The recipient placeholder shipped as Stellar's: "G... or domain.com*username". On this ledger
    // that is an address format that cannot exist, telling the user to type something invalid.
    if (toIn) toIn.setAttribute('placeholder', 'r… XRP Ledger address');
    var lbl = $('.field-label .meta', m);
    if (lbl) lbl.textContent = 'XRP Ledger';
    addTagField(m);

    if (pick) {
      // pick is Stellar's .lx-asset-pick by now (above); the design's own button is hidden.
      pick.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openAssetMenu(pick);
      });
    }
    if (max) {
      max.addEventListener('click', function (e) {
        e.preventDefault();
        var a = sendPick || held()[0];
        if (!a) return;
        // For XRP this is already balance minus reserve; a little is left for the network fee, or the
        // transaction cannot pay for itself and fails for an amount the button just offered.
        var v = a.code === 'XRP' ? Math.max(0, a.spendable - 0.0002) : a.spendable;
        amtIn.value = String(+v.toFixed(6));
        say('');
      });
    }
    go.addEventListener('click', function (e) { e.preventDefault(); doSend(); });
  }

  // SEPARATE FROM wireSend ON PURPOSE. Wiring happens once and then marks itself done — but the
  // balances it needs arrive from the ledger a second or two later, so the first pass had nothing to
  // select and the guard stopped it ever trying again. The listeners worked (a click read the right
  // balance), while the asset button still read "APT" and the balance row "25,420.18 APT" beside it:
  // correct behaviour under a label from another chain, which is the worst way for this to be wrong.
  //
  // So the display keeps trying until there is something real to show, independently of the wiring.
  var sendPre = null, pendingTo = null;
  window.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b || !/^\s*send\s*$/i.test(b.textContent || '')) return;
    if (b.closest('.modal-overlay') || b.classList.contains('qa-row-btn')) return;
    // wallet.js leaves the row's asset here just before it clicks this button.
    sendPre = window.__lxxSendPre || 'XRP';
    window.__lxxSendPre = null;
    // EMPTY EVERY TIME IT OPENS (RAZA 2026-09-17: "there's already an address filled in which is not correct", and "if i
    // paste in the address but not click review & send and just close the popup, it should just refresh it"). The design
    // keeps this dialog in the DOM between openings, so a half-filled form came back with it — including a recipient
    // address from a payment the reader had decided not to make.
    setTimeout(function () { resetSend(); applySendPre(); }, 0);
  }, true);
  // "SEND TO THIS WALLET" hands the address over as /wallet?to=<r-address> (RAZA 2026-09-16); the Send dialog opens with it
  // filled in, as a click on Send would.
  (function () {
    var to = '';
    try { to = new URLSearchParams(window.location.search).get('to') || ''; } catch (e) {}
    if (!to || !window.lxx || !window.lxx.isAddress(to)) return;
    var tries = 0;
    (function openIt() {
      var btn = [].slice.call(document.querySelectorAll('.quick-actions .qa-btn, button')).filter(function (b) {
        return /^\s*send\s*$/i.test(b.textContent || '') && !b.closest('.modal-overlay') && b.getBoundingClientRect().height > 0;
      })[0];
      if (!btn) { if (++tries < 40) setTimeout(openIt, 250); return; }
      pendingTo = to;                                    // survives the open-time reset; see resetSend()
      btn.click();
      var fill = 0;
      (function put() {
        var m = sendModal();
        var toIn = m && ($('.field-input.mono', m) || $('input.mono', m));
        if (!toIn) { if (++fill < 20) setTimeout(put, 150); return; }
        toIn.value = to;
        toIn.dispatchEvent(new Event('input', { bubbles: true }));
      })();
    })();
  })();

  function applySendPre() {
    if (!sendPre) return;
    var list = held();
    if (!list.length) return;                                   // balances still loading; the poll retries
    var pickA = null;
    if (sendPre !== 'XRP') {
      var p = sendPre.split('|');
      pickA = list.filter(function (h) { return h.issuer === p[1] && (h.currency === p[0] || h.code === p[2]); })[0] || null;
    }
    if (!pickA) pickA = list.filter(function (h) { return !h.issuer; })[0] || list[0];
    sendPre = null;
    setSendAsset(pickA);
  }

  function refreshSendAsset() {
    if (sendPre) { applySendPre(); return; }
    if (sendPick) return;
    var first = held()[0];
    if (first) setSendAsset(first);
  }

  // ---- Cancel order ---------------------------------------------------------------------------------
  // An offer is removed with OfferCancel referencing its sequence number — the same number wallet.js
  // stamps on each row as data-oid, so the row and the transaction cannot disagree about which offer
  // is being cancelled.
  function cancelOne(seq) {
    return window.lxc.submit({
      TransactionType: 'OfferCancel', Account: addr(), OfferSequence: +seq
    });
  }

  function confirmCancel(seqs, describe) {
    var m = $('#modalCancelOrder');
    if (!m) return;
    var title = $('#cancelOrderTitle', m);
    var text = $('#cancelOrderText', m);
    var det = $('#cancelOrderDetails', m);
    var go = $('#cancelOrderConfirm', m);
    if (!go) return;

    if (title) title.textContent = seqs.length > 1 ? ('Cancel ' + seqs.length + ' orders?') : 'Cancel order?';
    if (text) {
      text.textContent = seqs.length > 1
        ? 'Each order is cancelled by its own transaction, so you will be asked to approve ' + seqs.length + ' of them.'
        : 'This cannot be undone. Anything already filled stays in your wallet.';
    }
    // The else matters: this block ships as the design's mock ("921 APT", "+9.2 APT"), so leaving
    // it alone when there is nothing to describe shows another chain's order as the one about to be
    // cancelled. Emptied and hidden rather than left standing.
    if (det) {
      if (describe) { det.textContent = describe; det.style.display = ''; }
      else { det.textContent = ''; det.style.display = 'none'; }
    }
    else if (det) det.style.display = 'none';

    // Replaced rather than added to: this modal is reused for every order, and a listener per opening
    // would cancel the same offer once more on each subsequent use.
    var fresh = go.cloneNode(true);
    go.parentNode.replaceChild(fresh, go);
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      fresh.disabled = true;
      var i = 0, done = 0;
      (function next() {
        if (i >= seqs.length) {
          fresh.textContent = done + ' cancelled';
          setTimeout(function () {
            closeModal(m);
            if (window.__lxxReload) window.__lxxReload();
          }, 900);
          return;
        }
        var s = seqs[i++];
        fresh.textContent = seqs.length > 1 ? ('Confirm ' + i + ' of ' + seqs.length + '…') : 'Confirm in wallet…';
        cancelOne(s).then(function () { done++; next(); })
          .catch(function (err) {
            fresh.disabled = false;
            fresh.textContent = (err && err.message) || 'Could not cancel';
          });
      })();
    });

    openModal(m);
  }

  // The design's modals are shown by a class its own script toggles. Both are set so this works
  // whether or not that script has run, and neither invents a new presentation.
  function openModal(m) { m.classList.add('open', 'show', 'active'); m.removeAttribute('hidden'); }
  function closeModal(m) { m.classList.remove('open', 'show', 'active'); }

  function wireCancels() {
    if (window.__lxwCancels) return;
    window.__lxwCancels = 1;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var one = t.closest('.order-cancel');
      if (one) {
        var row = one.closest('[data-oid]');
        if (!row) return;
        e.preventDefault(); e.stopPropagation();
        var pair = ($('.pair-text .name', row) || {}).textContent || '';
        confirmCancel([row.getAttribute('data-oid')], pair ? ('Order: ' + pair) : '');
        return;
      }

      var all = t.closest('button, a');
      if (all && /cancel all/i.test((all.textContent || '').trim())) {
        var rows = $$('[data-oid]');
        if (!rows.length) return;
        e.preventDefault(); e.stopPropagation();
        confirmCancel(rows.map(function (r) { return r.getAttribute('data-oid'); }),
          rows.length + ' open order' + (rows.length === 1 ? '' : 's'));
      }
    }, true);
  }

  // ---- Swap --------------------------------------------------------------------------------------
  // A swap on the XRP Ledger is a CROSS-CURRENCY PAYMENT TO YOURSELF: Account and Destination are the
  // same account, SendMax is what you are willing to give up, Amount is what must be delivered. The
  // ledger finds the route through order books and AMM pools itself, which is why there is no routing
  // engine here and no reason to build one.
  //
  // NO tfPartialPayment. Without that flag the ledger delivers Amount EXACTLY or the whole
  // transaction fails — so Amount is set to the quoted output minus the slippage tolerance, and the
  // trade either lands at a price you accepted or does not happen. A partial payment would let it
  // fill at any price down to zero, which is the same class of bug as a MAX button that offers more
  // than the balance: it makes the number on screen a suggestion rather than a commitment.
  //
  // The quote comes from ripple_path_find with destination_amount value "-1", the ledger's own way of
  // asking "how much of this can I get for that". Quoting from a book snapshot instead would be a
  // second opinion that disagrees with the router the transaction actually uses.
  var swapFrom = null, swapTo = null, swapQuote = null, swapSeq = 0;
  var SLIP = 0.005;                                          // 0.5%, the figure the design displays

  function swapModals() { return $$('#modalSwap'); }

  // Delegates to xrpl-core, which is the same file the node tests run against. This was written
  // locally three times over — twice in here and once in pooldetail.js — and three copies of the
  // arithmetic deciding how much money moves is three chances for one to drift. Now there is one,
  // and it is covered by fixed vectors including the float case (0.1 + 0.2 must round, not truncate)
  // and the safe-integer ceiling, where it refuses rather than returning a plausible wrong number.
  function amtObj(a, value) {
    return window.lxx.amountFor(a.code === 'XRP' ? 'XRP' : { currency: a.currency, issuer: a.issuer }, value);
  }

  function swapFields(m) {
    var fields = $$('.swap-pair .field', m);
    return { from: fields[0], to: fields[1] };
  }

  // STELLAR'S TWO STEPS (RAZA 2026-09-17: "the swap popup is still not the same as stellar"). Its dialog opens clean —
  // FROM, TO, and "Review Swap" — and the rate, route, price impact and fees appear only once the reader has asked to
  // review. This build showed all of it immediately, under a button already reading "Confirm Swap", so the first screen
  // was busier than Stellar's and skipped the review entirely.
  //
  // Same markup, same dialog: the two summary boxes are hidden until Review is pressed, and the button then becomes
  // Confirm. Changing anything afterwards puts it back to Review, because a summary that outlives the amount it describes
  // is worse than no summary.
  function swapPanels(m) {
    var rate = $('.swap-rate', m);
    return [rate, rate && rate.nextElementSibling && rate.nextElementSibling.tagName === 'DIV' ? rate.nextElementSibling : null];
  }
  function setReviewState(m, reviewing) {
    if (!m) return;
    m.__lxReview = !!reviewing;
    swapPanels(m).forEach(function (el) { if (el) el.style.display = reviewing ? '' : 'none'; });
    var go = $('.modal-foot .btn-primary', m);
    if (!go) return;
    var wrote = false;
    [].forEach.call(go.childNodes, function (n) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = reviewing ? ' Confirm Swap ' : ' Review Swap '; wrote = true; }
    });
    if (!wrote) go.insertBefore(document.createTextNode(reviewing ? ' Confirm Swap ' : ' Review Swap '), go.firstChild);
  }
  // Any change to the trade sends the dialog back to its first screen.
  function resetReview() {
    swapModals().forEach(function (m) { if (m.__lxReview) setReviewState(m, false); });
  }

  // The design's in-field asset button, hidden and replaced by the chip Stellar uses — inserted right after it, exactly
  // where lumoscore.com puts it, so the inherited `#modalSwap .lx-swap-pick` rules lay it out. Built once per field.
  function swapPick(fld, which) {
    if (!fld) return null;
    var made = $('.lx-swap-pick', fld);
    if (made) return made;
    var orig = $('.asset-pick', fld);
    if (!orig || !orig.parentNode) return null;
    orig.style.display = 'none';
    var ap = document.createElement('button');
    ap.type = 'button';
    ap.className = 'lx-asset-pick lx-swap-pick';
    ap.setAttribute('data-lx-noswap', '');
    var ico = document.createElement('span');
    ico.className = 'lx-ap-ico';
    ico.setAttribute('data-lx-noswap', '');
    var code = document.createElement('span');
    code.className = 'lx-ap-code';
    code.setAttribute('data-lx-noswap', '');
    code.textContent = (which === 'from' ? (swapFrom && swapFrom.code) : (swapTo && swapTo.code)) || 'Select';
    ap.appendChild(ico);
    ap.appendChild(code);
    ap.insertAdjacentHTML('beforeend', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>');
    ap.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      swapMenu(ap, which);
    });
    orig.parentNode.insertBefore(ap, orig.nextSibling);
    return ap;
  }

  function setSwapAsset(which, a) {
    if (which === 'from') swapFrom = a; else swapTo = a;
    resetReview();                                       // the summary belonged to the old pair
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var fld = which === 'from' ? f.from : f.to;
      if (!fld) return;
      // STELLAR'S PICKER SITS BELOW THE AMOUNT, NOT INSIDE IT (RAZA 2026-09-17: "On LUMOS token page, Swap popup, XRP has
      // it different than Stellar"). Both builds ship the SAME markup — the design puts an `.asset-pick` button inside
      // `.field-amt` — and lumoscore.com hides it at runtime and inserts its own `.lx-asset-pick.lx-swap-pick` chip after
      // it. Every style that chip needs is already in this build; nothing here is new UI, it is the same move Stellar
      // makes on the same markup.
      var chip = swapPick(fld, which);
      if (chip) {
        var cIco = $('.lx-ap-ico', chip), cCode = $('.lx-ap-code', chip);
        if (cIco) icoImg(cIco, a);
        if (cCode) cCode.textContent = a.code;
      }
      var btn = $('.asset-pick', fld);
      if (btn) {
        var ico = $('.a-ico', btn);
        if (ico) icoImg(ico, a);
        [].forEach.call(btn.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
        });
      }
      var meta = $('.field-label .meta', fld);
      if (meta && which === 'from') {
        meta.textContent = 'Balance: ' + fmt(a.spendable, 6) + ' ' + a.code;
        // STELLAR'S MAX CHIP beside the balance (RAZA 2026-09-16: "On LUMOS token page, if we click swap, it needs to be like
        // it is on Stellar"), which this dialog shipped without — there was no way to swap a whole holding.
        var mx = $('.lx-maxchip', meta.parentNode);
        if (!mx) {
          mx = document.createElement('button');
          mx.type = 'button';
          mx.className = 'lx-maxchip';
          mx.textContent = 'Max';
          mx.style.cssText = 'margin-left:8px;padding:1px 7px;border:1px solid var(--border);border-radius:6px;background:none;'
            + 'font:inherit;font-size:11px;font-weight:700;color:var(--accent,#f0821e);cursor:pointer';
          mx.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var inp = $('.field-amt input', fld);
            if (!inp || !swapFrom) return;
            inp.value = String(+Number(swapFrom.spendable).toFixed(6));
            quoteSwap();
          });
          meta.parentNode.appendChild(mx);
        }
      }
    });
    quoteSwap();
  }

  // You can only RECEIVE a token you already trust, so the destination list is the same list as the
  // source: XRP plus whatever this account has a trustline for. Offering the whole ledger here would
  // let someone build a swap that always fails with tecPATH_DRY.
  function swapMenu(btn, which) {
    var m = btn.closest('#modalSwap');
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }
    var list = held();
    if (!list.length) return;
    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:200px;'
      + 'max-height:240px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      icoImg(ic, a);
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      row.appendChild(ic); row.appendChild(nm);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSwapAsset(which, a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });
    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);
    requestAnimationFrame(function () {                       // see openAssetMenu for why
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  function swapSay(text, tone) {
    swapModals().forEach(function (m) {
      var box = $('.lxw-swapsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-swapsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
      box.style.display = text ? '' : 'none';
    });
    // A finished swap says so and then gets out of the way (RAZA 2026-09-16: "just hide the message 'Swap complete' in 2
    // seconds. It just stays there"). Errors stay put.
    clearTimeout(swapSay.t);
    if (text && /^swap complete/i.test(text)) swapSay.t = setTimeout(function () { swapSay(''); }, 2000);
  }

  function swapInfoRow(m, label, value) {
    var rows = $$('.modal-body > div[style*="border-radius"] > div', m);
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp(label, 'i').test(k.textContent || '')) {
        var v = rows[i].querySelector('strong');
        if (v) v.textContent = value;
        return;
      }
    }
  }

  // THE REVERSE QUOTE. `ripple_path_find` answers "what must I send to deliver exactly this?" in its `source_amount`, which
  // is the question a typed receive amount asks. The send amount it returns is written into FROM and the normal forward
  // quote then runs on it, so what is signed is still priced by the route the ledger actually found.
  function quoteFromReceive(m) {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    var f = swapFields(m);
    var inEl = $('.field-amt input', f.from), outEl = $('.field-amt input', f.to);
    var want = parseFloat(String(outEl && outEl.value).replace(/,/g, ''));
    if (!(want > 0)) {
      if (inEl) inEl.value = '';
      swapQuote = null;
      clearSwapQuote(m);
      swapSay('');
      return;
    }
    if (swapFrom.code === swapTo.code && swapFrom.issuer === swapTo.issuer) {
      swapSay('Pick two different assets.', 'bad');
      return;
    }
    var seq = ++swapSeq;
    swapSay('Finding a route…');
    rpc('ripple_path_find', {
      source_account: me,
      destination_account: me,
      destination_amount: amtObj(swapTo, want),
      source_currencies: [swapFrom.code === 'XRP' ? { currency: 'XRP' } : { currency: swapFrom.currency, issuer: swapFrom.issuer }],
      ledger_index: 'validated'
    }).then(function (r) {
      if (seq !== swapSeq) return;
      var alt = (r.alternatives || [])[0];
      var src = alt && alt.source_amount;
      if (!src) {
        swapInfoRow(m, 'route', 'no route');
        swapSay('No route between those two assets right now.', 'bad');
        return;
      }
      var need = (typeof src === 'string') ? (+src / DROP) : +src.value;
      if (!(need > 0)) return;
      if (inEl) inEl.value = String(+need.toFixed(6));
      quoteSwap();                                        // prices what will actually be signed
    }).catch(function () {
      if (seq !== swapSeq) return;
      swapSay('That route could not be priced right now.', 'bad');
    });
  }

  function quoteSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    var seq = ++swapSeq;
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var inEl = $('.field-amt input', f.from);
      var outEl = $('.field-amt input', f.to);
      var amount = parseFloat(String(inEl && inEl.value).replace(/,/g, ''));
      // Emptying the amount must take the quote with it: a rate left standing from the previous
      // keystroke is a rate for a trade that is no longer on screen.
      if (!(amount > 0)) { if (outEl) outEl.value = ''; swapQuote = null; clearSwapQuote(m); swapSay(''); return; }
      if (swapFrom.code === swapTo.code && swapFrom.issuer === swapTo.issuer) {
        swapSay('Pick two different assets.', 'bad'); swapQuote = null; return;
      }
      swapSay('Finding a route…');
      rpc('ripple_path_find', {
        source_account: me,
        destination_account: me,
        destination_amount: swapTo.code === 'XRP' ? '-1'
          : { currency: swapTo.currency, issuer: swapTo.issuer, value: '-1' },
        send_max: amtObj(swapFrom, amount),
        ledger_index: 'validated'
      }).then(function (r) {
        if (seq !== swapSeq) return;                          // a newer keystroke superseded this one
        var alt = (r.alternatives || [])[0];
        if (!alt) {
          swapQuote = null;
          if (outEl) outEl.value = '';
          swapInfoRow(m, 'route', 'no route');
          swapSay('No route between those two assets right now.', 'bad');
          return;
        }
        var got = alt.destination_amount;
        var outVal = (typeof got === 'string') ? (+got / DROP) : +got.value;
        swapQuote = { alt: alt, out: outVal, inAmount: amount };
        // Kept live: the design re-disables its own button whenever it rebuilds the dialog's footer.
        var goBtn = $('.modal-foot .btn-primary', m);
        if (goBtn) { goBtn.disabled = false; goBtn.removeAttribute('disabled'); }
        // Not over the box being typed in: while TO has focus the reader's own figure stays put.
        if (outEl && document.activeElement !== outEl) outEl.value = String(+outVal.toFixed(6));
        var rate = outVal / amount;
        $$('.swap-rate span', m).forEach(function (sp, i) {
          if (i === 0) sp.innerHTML = '';
          if (i === 0) {
            sp.appendChild(document.createTextNode('1 ' + swapFrom.code + ' ≈ '));
            var st = document.createElement('strong');
            st.textContent = fmt(rate, 6) + ' ' + swapTo.code;
            sp.appendChild(st);
          }
          if (i === 1) {
            sp.innerHTML = '';
            sp.appendChild(document.createTextNode('Slippage: '));
            var s2 = document.createElement('strong');
            s2.textContent = (SLIP * 100).toFixed(1) + '%';
            sp.appendChild(s2);
          }
        });
        swapInfoRow(m, 'route', swapFrom.code + ' → ' + swapTo.code
          + ((alt.paths_computed && alt.paths_computed.length) ? ' (routed)' : ' (direct)'));
        swapInfoRow(m, 'network fee', '~0.000012 XRP');
        swapFeeRow(m, amount);
        swapSay('');
      }).catch(function (e) {
        if (seq !== swapSeq) return;
        swapQuote = null;
        swapSay((e && e.message) || 'Could not get a quote.', 'bad');
      });
    });
  }

  // The platform fee gets its own line in the design's existing details box, added the same way the
  // Send modal gets its destination-tag field. It is stated before the swap, not discovered after:
  // the Stellar Smart Swap was removed precisely because a route deducted a fee that was never
  // actually collected, and the fix for that starts with the number being visible and true.
  function swapFeeRow(m, amount) {
    var box = $('.modal-body > div[style*="border-radius"]', m);
    if (!box) return;
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    var row = $('.lxw-feerow', m);
    if (!row) {
      row = document.createElement('div');
      row.className = 'lxw-feerow';
      row.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px';
      var k = document.createElement('span');
      k.textContent = 'Platform fee';
      var v = document.createElement('strong');
      v.style.color = 'var(--text)';
      row.appendChild(k); row.appendChild(v);
      box.appendChild(row);
    }
    // SHOWN IN XRP, BECAUSE XRP IS WHAT IS CHARGED. The first version displayed the fee in the input
    // currency — "0.10% · 100 LUMOS" — while collectFee() converts and takes the XRP equivalent. A fee
    // line that names a different asset from the one leaving the account is how the Stellar Smart Swap
    // ended up deducting one thing and collecting another; the displayed number has to be the charged
    // number, so it is resolved through exactly the same call the charge uses.
    var v = row.querySelector('strong');
    v.textContent = (rate * 100).toFixed(2) + '% · …';
    var seq = swapSeq;
    feeInXrp(amount).then(function (x) {
      if (seq !== swapSeq) return;                            // a newer quote is already on screen
      v.textContent = (rate * 100).toFixed(2) + '% · '
        + (x > 0 ? (fmt(x, 6) + ' XRP') : 'not charged (no route)');
    });
  }

  function doSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    if (!swapQuote) { swapSay('Enter an amount first.', 'bad'); return; }
    var amount = swapQuote.inAmount;
    if (amount > swapFrom.spendable) {
      swapSay('That is more than you can swap. ' + fmt(swapFrom.spendable, 6) + ' ' + swapFrom.code + ' is available.', 'bad');
      return;
    }
    var minOut = swapQuote.out * (1 - SLIP);
    var tx = {
      TransactionType: 'Payment',
      Account: me,
      Destination: me,                                        // a conversion, not a transfer
      Amount: amtObj(swapTo, +minOut.toFixed(6)),
      SendMax: amtObj(swapFrom, amount)
    };
    if (swapQuote.alt.paths_computed && swapQuote.alt.paths_computed.length) {
      tx.Paths = swapQuote.alt.paths_computed;
    }

    // THE TRUST LINE IS MADE ON THE WAY (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be
    // automatically created upon the swap"), which is why the dialog's "Add Trustline" banner is hidden. A token the account
    // does not trust cannot be delivered to it, so the line goes first and the payment follows once it is on the ledger.
    var needLine = !!swapTo.issuer && !held().some(function (h) {
      return h.issuer === swapTo.issuer && h.currency === swapTo.currency;
    });
    var first = Promise.resolve();
    swapSteps = needLine ? 3 : 2;                         // what every label and memo below counts against
    if (needLine) {
      swapSay('Approve the ' + swapTo.code + ' trustline (1 of 3) in your wallet…');
      first = window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: swapTo.currency, issuer: swapTo.issuer, value: '1000000000' },
        // The least recognisable prompt of the three, so it says what it is (RAZA 2026-09-17).
        Memos: [{ Memo: {
          MemoType: hexAscii('LumosCore'),
          MemoFormat: hexAscii('text/plain'),
          MemoData: hexAscii('LumosCore: trustline for ' + swapTo.code + ', required before this account can receive it '
            + '- transaction 1 of 3. The platform fee and the swap follow.')
        } }]
      }).then(function () {
        // Four seconds is a ledger close plus room; the payment fails harmlessly if it is not there yet.
        return new Promise(function (res) { setTimeout(res, 4500); });
      });
    }

    first.then(function () {
      return collectFee(amount);                          // the fee is transaction 1 of 2 now — see the note below
    }).then(function () {
      var ofN = swapSteps || 2;
      swapSay('Approve the swap (' + ofN + ' of ' + ofN + ') in your wallet…');
      return window.lxc.submit(tx);
    }).then(function (hash) {
      swapSay('Swap complete. ' + short(hash), 'good');
      setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3000);
    }).catch(function (e) {
      swapSay((e && e.message) || 'The swap could not be completed.', 'bad');
    });
  }

  // THE FEE IS A SECOND TRANSACTION, and it has to be, which is worth stating plainly rather than
  // hiding. The collector holds no trustlines, so it can only receive XRP; and an XRPL transaction
  // carries exactly one operation, so the fee cannot ride along inside the swap. Two approvals is the
  // honest shape of this on this ledger.
  //
  // IT RUNS FIRST NOW (RAZA 2026-09-17: "lets do the fees signature instead of swap. the second signature will be for swap.
  // But make sure to mention in memo that the first trx is for fees"). It used to run after the swap so that a rejected swap
  // could never cost anything; first means a fee can be paid for a swap that is then rejected, and the messages below say so
  // rather than leaving someone to work it out from their balance. The memo names the charge on the wallet's review screen.
  function collectFee(amount) {
    return feeInXrp(amount).then(function (feeXrp) {
      if (!(feeXrp > 0)) return;
      var of = swapSteps || 2;
      swapSay('Approve the platform fee (' + (of - 1) + ' of ' + of + ') in your wallet…');
      return window.lxc.submit({
        TransactionType: 'Payment', Account: addr(),
        Destination: COLLECTOR,
        Amount: window.lxx.toDrops(feeXrp),
        Memos: [feeMemo(swapFrom.code, swapTo.code, of - 1, of)]
      }).catch(function (e) {
        var m = (e && e.message) || '';
        throw new Error(/reject|denied|cancel/i.test(m)
          ? 'The platform fee was not approved, so nothing was swapped.'
          : (m || 'The platform fee could not be paid, so nothing was swapped.'));
      });
    });
  }

  // Memo bytes are hex on this ledger; Xaman and GemWallet both show the decoded text on the review screen.
  function hexAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 127) continue;
      out += ('0' + c.toString(16)).slice(-2).toUpperCase();
    }
    return out;
  }
  var swapSteps = 2;                                     // 3 when this swap also has to add a trustline
  function feeMemo(payCode, getCode, n, of) {
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    return {
      Memo: {
        MemoType: hexAscii('LumosCore'),
        MemoFormat: hexAscii('text/plain'),
        MemoData: hexAscii('LumosCore platform fee ' + (+(rate * 100).toFixed(2)) + '% - transaction '
          + (n || 1) + ' of ' + (of || 2) + '. The ' + payCode + ' to ' + getCode + ' swap is the next transaction.')
      }
    };
  }

  // The fee is a percentage of the trade, charged in XRP because the collector holds no trustlines
  // and so can receive nothing else.
  //
  // When one side of the swap IS XRP the value is already known. When neither side is, the fee is
  // worth asking the ledger about rather than inventing: a path_find for the fee slice of the input
  // returns exactly what it converts to, at the same prices the swap itself just used. Guessing from
  // a price feed would charge a number that disagrees with the trade it is a fee on.
  function feeInXrp(amount) {
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    if (swapFrom.code === 'XRP') return Promise.resolve(amount * rate);
    if (swapTo.code === 'XRP') return Promise.resolve(swapQuote.out * rate);
    var slice = amount * rate;
    if (!(slice > 0)) return Promise.resolve(0);
    return rpc('ripple_path_find', {
      source_account: addr(), destination_account: addr(),
      destination_amount: '-1',
      send_max: amtObj(swapFrom, +slice.toFixed(6)),
      ledger_index: 'validated'
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      if (!alt || typeof alt.destination_amount !== 'string') return 0;
      return (+alt.destination_amount) / DROP;
    }).catch(function () { return 0; });     // no route for the fee: never charge a made-up amount
  }

  // CLEAR THE MOCK QUOTE BEFORE ANYONE CAN READ IT.
  //
  // The summary rows are only written when a quote lands, and a quote needs an amount typed — so
  // until then the dialog stood with the design's Aptos mock in it: "1 APT = 0.4128 USDC", "Route
  // APT -> USDC (Direct)", "Network fee ~0.00001 APT". A fabricated exchange rate, in another
  // chain's asset, on the screen where someone decides whether to trade.
  //
  // Same reasoning as clearing the portfolio headline in wallet.js: an em dash reads as "not in
  // yet" and is self-evidently not a rate; a stale number reads as the price you will get.
  function clearSwapQuote(m) {
    $$('.swap-rate span', m).forEach(function (sp, i) {
      sp.innerHTML = '';
      sp.appendChild(document.createTextNode(i === 0 ? 'Rate ' : 'Slippage: '));
      var st = document.createElement('strong');
      st.textContent = i === 0 ? '—' : (SLIP * 100).toFixed(1) + '%';
      sp.appendChild(st);
    });
    swapInfoRow(m, 'route', '—');
    swapInfoRow(m, 'price impact', '—');
    swapInfoRow(m, 'network fee', '~0.000012 XRP');
  }

  // Ripple's RLUSD, by its issuer — several tokens share the ticker.
  var RLUSD = { currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De' };
  // This project's own token, whose page carries a copy of this dialog.
  var LUMOS = { currency: '4C554D4F53000000000000000000000000000000', issuer: 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha' };

  function wireSwap() {
    swapModals().forEach(function (m) {
      if (m.getAttribute('data-lxw') === '1') return;
      var f = swapFields(m);
      if (!f.from || !f.to) return;
      m.setAttribute('data-lxw', '1');
      clearSwapQuote(m);

      var picks = $$('.asset-pick', m);
      if (picks[0]) picks[0].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[0], 'from'); });
      if (picks[1]) picks[1].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[1], 'to'); });

      var inEl = $('.field-amt input', f.from);
      if (inEl) {
        var t = null;
        inEl.addEventListener('input', function () { resetReview(); clearTimeout(t); t = setTimeout(quoteSwap, 300); });
      }
      // TYPING INTO "TO" FILLS "FROM" (RAZA 2026-09-17: "if im entering value in TO field, FROM doesn't autocalculate").
      // The ledger routes a payment by what is SENT, so the typed receive amount is turned into a send amount at the
      // current rate and the real quote is then asked for on that — the same shape as the Trade-Asset swap box.
      var outEl0 = $('.field-amt input', f.to);
      if (outEl0) {
        var t2 = null;
        outEl0.addEventListener('input', function () {
          resetReview();
          clearTimeout(t2);
          t2 = setTimeout(function () { quoteFromReceive(m); }, 300);
        });
      }
      var flip = $('.swap-arrow', m);
      if (flip) {
        flip.addEventListener('click', function (e) {
          e.preventDefault();
          var a = swapFrom, b = swapTo;
          if (!a || !b) return;
          setSwapAsset('from', b);
          setSwapAsset('to', a);
        });
      }
      var go = $('.modal-foot .btn-primary', m);
      if (go) {
        // THE BUTTON SHIPS DISABLED (RAZA 2026-09-17: "Also the swapping doesnt work here"). The design's markup is
        // `<button class="btn-primary" disabled="">` — its own script would have enabled it once its own validation passed,
        // and that script is stripped here, so the swap could never be started at all. Everything behind it was correct:
        // with the attribute off, the same click builds Payment / SendMax 0.100255 XRP / Amount 4,975 LUMOS to self.
        // doSwap() does the validating now, so the control stays live and says why when something is missing.
        go.disabled = false;
        go.removeAttribute('disabled');
        go.addEventListener('click', function (e) {
          e.preventDefault();
          // First press reviews, second press signs — Stellar's shape, in one dialog.
          if (!m.__lxReview) {
            if (!swapQuote) { swapSay('Enter an amount first.', 'bad'); return; }
            setReviewState(m, true);
            return;
          }
          doSwap();
        });
      }
      setReviewState(m, false);                          // opens on the clean first screen

      // …and again every time the dialog is OPENED. Wiring happens once, at load, but the design rebuilds this dialog when
      // it opens — which puts its own "Confirm Swap" label and both summary boxes back. Watched, the same way the fee row
      // on Trade-Asset has to be.
      if (window.MutationObserver && !m.__lxOpenObs) {
        m.__lxOpenObs = new MutationObserver(function () {
          var open = m.classList.contains('open') || m.style.display === 'flex';
          if (open && !m.__lxReview) setReviewState(m, false);
        });
        m.__lxOpenObs.observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    });

    // XRP → RLUSD BY DEFAULT (RAZA 2026-09-15: "make XRP and RLUSD as the default choice instead of LUMOS"). RLUSD is
    // offered even without a trustline; the quote says so if this account cannot receive it yet.
    //
    // ON THE $LUMOS PAGE THE DEFAULT IS LUMOS (RAZA 2026-09-16: "On LUMOS token page, if we click swap, it needs to be like it
    // is on Stellar" — where that button opens XLM → LUMOS). Swapping to RLUSD from a page about LUMOS is not what the button
    // says it does; the earlier instruction was about the dashboard's Custom Swap, which still defaults to RLUSD.
    if (!swapFrom || !swapTo) {
      var list = held();
      if (list.length) {
        var xrpA = list.filter(function (h) { return !h.issuer; })[0] || list[0];
        var onLumosPage = !!document.querySelector('.lumos-hero-row') || /\/lumos(\/|$)/.test(window.location.pathname);
        var want = onLumosPage
          ? (list.filter(function (h) { return h.issuer === LUMOS.issuer && h.currency === LUMOS.currency; })[0]
             || { code: 'LUMOS', currency: LUMOS.currency, issuer: LUMOS.issuer, balance: 0, spendable: 0 })
          : (list.filter(function (h) { return h.issuer === RLUSD.issuer && h.currency === RLUSD.currency; })[0]
             || { code: 'RLUSD', currency: RLUSD.currency, issuer: RLUSD.issuer, balance: 0, spendable: 0 });
        if (!swapFrom) setSwapAsset('from', xrpA);
        if (!swapTo) setSwapAsset('to', want);
      }
    }

    // THE TRUST-LINE GATE GOES (RAZA 2026-09-15: "If the user doesnt hold the asset, the trustline will be automatically
    // created upon the swap", and 2026-09-16 asking for this dialog to match Stellar's, which has no such banner). The swap
    // below adds the line itself, so a button demanding it first is a step Stellar does not have.
    swapModals().forEach(function (m) {
      [].forEach.call(m.querySelectorAll('.trustline-gate, [data-trustline-gate]'), function (g) {
        g.style.display = 'none';
      });
    });
  }

  // ---- Trustlines ------------------------------------------------------------------------------------
  // A trustline is what lets an account hold an issued token at all, so this is the gate in front of
  // every other token feature: without one, a payment of that token to you fails outright.
  //
  // The design's modal shipped describing the wrong ledger AND the wrong number — "hold non-native
  // assets on Aptos. Each trustline reserves 0.5 APT". On the XRP Ledger a trustline is an owner
  // object and reserves the owner increment, which is 0.2 XRP today. That figure is READ FROM THE
  // LEDGER rather than written here: both reserve numbers were ten times higher before 2024 and can
  // change again by amendment, so a hardcoded value would quietly misstate what an account is giving
  // up — the same reasoning xrpl-core gives for never hardcoding the reserve in spendable maths.
  var reserveInc = null;

  function loadReserve() {
    if (reserveInc != null) return Promise.resolve(reserveInc);
    return rpc('server_info', {}).then(function (si) {
      var v = ((si.info || {}).validated_ledger || {}).reserve_inc_xrp;
      reserveInc = +v > 0 ? +v : 0.2;
      return reserveInc;
    }).catch(function () { reserveInc = 0.2; return reserveInc; });
  }

  function tlModals() { return $$('#modalTrustlines'); }

  function tlFixCopy(inc) {
    tlModals().forEach(function (m) {
      var p = $('.modal-body > p', m);
      if (!p || p.__lxtl) return;
      p.__lxtl = 1;
      var strong = p.querySelector('strong');
      [].forEach.call(p.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/non-native assets on Aptos/i, 'issued assets on the XRP Ledger')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
      if (strong) strong.textContent = inc + ' XRP';
    });
  }

  // What the account already trusts, straight from account_lines. LP tokens are excluded the same way
  // the balance list excludes them: they are pool shares, not assets somebody chose to trust.
  function tlPaintExisting() {
    var me = addr();
    if (!me) return;
    return window.lxx.allLines(rpc, me)
      .then(function (r) {
        var lines = (r.lines || []).filter(function (l) {
          return !(window.lxx && window.lxx.isLpToken && window.lxx.isLpToken(l.currency));
        });
        return loadReserve().then(function (inc) {
          tlFixCopy(inc);
          $$('#tlExistingCount').forEach(function (c) {
            c.textContent = lines.length + ' active · ' + fmt(lines.length * inc, 4) + ' XRP reserved';
          });
          $$('#tlExistingList').forEach(function (list) {
            list.innerHTML = '';
            if (!lines.length) {
              var e = document.createElement('div');
              e.className = 'tl-empty';
              e.textContent = 'No trustlines yet. Add one above to hold an issued token.';
              list.appendChild(e);
              return;
            }
            lines.forEach(function (l) { list.appendChild(tlRow(l, inc)); });
          });
        });
      }).catch(function () {});
  }

  function tlRow(l, inc) {
    var d = window.lxx.decodeCurrency(l.currency);
    var code = (d && d.display) || l.currency;
    var bal = +l.balance || 0;

    var row = document.createElement('div');
    row.className = 'tl-row';
    var ico = document.createElement('div');
    ico.className = 'tl-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-info';
    var nm = document.createElement('div');
    nm.className = 'tl-nm';
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-sub';
    sub.textContent = fmt(bal, 6) + ' · ' + short(l.account);
    info.appendChild(nm); info.appendChild(sub);

    var act = document.createElement('div');
    act.className = 'tl-action';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn';
    if (bal !== 0) {
      // A line holding a balance cannot be removed, and the ledger will refuse it. Saying so is more
      // use than a button that fails; the reserve is only released once the balance is zero.
      btn.disabled = true;
      btn.textContent = 'Holding';
      btn.title = 'A trustline can only be removed once its balance is zero.';
      btn.style.opacity = '.55';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = 'Remove';
      btn.title = 'Removes the trustline and releases ' + inc + ' XRP of reserve.';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Approve…';
        // Limit 0 on a zero-balance line deletes it and returns the reserve.
        window.lxc.submit({
          TransactionType: 'TrustSet', Account: addr(),
          LimitAmount: { currency: l.currency, issuer: l.account, value: '0' }
        }).then(function () {
          btn.textContent = 'Removed';
          setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Remove';
          tlSay((err && err.message) || 'Could not remove that trustline.', 'bad');
        });
      });
    }
    act.appendChild(btn);
    row.appendChild(ico); row.appendChild(info); row.appendChild(act);
    return row;
  }

  function tlSay(text, tone) {
    tlModals().forEach(function (m) {
      var box = $('.lxw-tlsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-tlsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : 'var(--text-muted,#9aa)';
      box.style.display = text ? '' : 'none';
    });
  }

  function tlAdd(row) {
    var me = addr();
    if (!me) return;
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    return loadReserve().then(function (inc) {
      var x = (window.__lxxData || {}).xrp;
      // Adding a line raises the account's reserve. Without this check the transaction is signed and
      // then rejected with tecINSUFFICIENT_RESERVE, which costs a fee to discover.
      if (x && x.spendable != null && x.spendable < inc) {
        tlSay('Not enough spendable XRP — a new trustline reserves ' + inc + ' XRP.', 'bad');
        return;
      }
      tlSay('Approve the trustline for ' + code + ' in your wallet…');
      // A large but finite limit: the ledger requires one, and it caps how much of this issuer's token
      // the account can ever hold. Not unlimited, which would be a promise this UI never asked about.
      return window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: row.c, issuer: row.i, value: '1000000000' }
      }).then(function () {
        tlSay(code + ' trustline added.', 'good');
        $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; });
        $$('#tlSearchInput').forEach(function (s) { s.value = ''; });
        setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
      }).catch(function (e) {
        tlSay((e && e.message) || 'Could not add that trustline.', 'bad');
      });
    });
  }

  function tlSuggest(q) {
    if (!q || q.length < 2) { $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; }); return; }
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        var held = {};
        ((window.__lxxData || {}).held || []).forEach(function (t) { held[t.issuer + '-' + t.currency] = 1; });
        // ANYONE CAN ISSUE A TOKEN CALLED ANYTHING. Searching "rlusd" returns eight tokens named
        // RLUSD from eight different issuers — one is Ripple's, two others call themselves "Ripple
        // USD", one is "RLUSD Silver", and several have no name at all. Trusting the wrong one is how
        // people end up holding a worthless token they believe is a stablecoin.
        //
        // The upstream marks the genuine article with vf, so verified issuers come first and holder
        // count breaks the rest — the two signals that actually separate them. The list is still shown
        // in full rather than filtered: hiding the impersonators would leave someone who really does
        // want an obscure token unable to find it, and would teach nobody that they exist.
        var rows = (j.rows || []).slice(0).sort(function (a, b) {
          if (!!b.vf !== !!a.vf) return b.vf ? 1 : -1;
          return (b.h || 0) - (a.h || 0);
        }).slice(0, 8);
        $$('#tlSuggestions').forEach(function (box) {
          box.innerHTML = '';
          rows.forEach(function (row) {
            box.appendChild(tlSuggestion(row, held[row.i + '-' + row.c]));
          });
        });
      }).catch(function () {});
  }

  function tlSuggestion(row, already) {
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    var el2 = document.createElement('div');
    el2.className = 'tl-suggestion';
    var ico = document.createElement('div');
    ico.className = 'tl-s-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-s-info';
    var nm = document.createElement('div');
    nm.className = 'tl-s-nm';
    // The ISSUER is part of the identity, not decoration: a ticker is not unique on this ledger, and
    // "USDC" alone names several different tokens from different issuers. Showing who issues it is
    // what stops someone trusting the wrong one.
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-s-sub';
    sub.textContent = (row.vf ? '✓ Verified · ' : '')
      + (row.u ? row.u + ' · ' : '')
      + short(row.i)
      + (row.h ? (' · ' + fmt(row.h, 0) + ' holders') : '');
    if (row.vf) sub.style.color = 'var(--green,#22c55e)';
    info.appendChild(nm); info.appendChild(sub);
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'tl-s-add';
    if (already) {
      add.textContent = 'Added';
      add.disabled = true;
      add.style.opacity = '.55';
    } else {
      add.textContent = 'Add';
      add.addEventListener('click', function (e) { e.preventDefault(); tlAdd(row); });
    }
    el2.appendChild(ico); el2.appendChild(info); el2.appendChild(add);
    return el2;
  }

  function wireTrustlines() {
    $$('#tlSearchInput').forEach(function (inp) {
      if (inp.__lxtl) return;
      inp.__lxtl = 1;
      inp.setAttribute('placeholder', 'Search by code or issuer (e.g. RLUSD, USDC…)');
      var t = null;
      inp.addEventListener('input', function () {
        clearTimeout(t);
        var v = inp.value.trim();
        // Debounced: one request per pause, not one per keystroke.
        t = setTimeout(function () { tlSuggest(v); }, 260);
      });
    });
    if (!window.__lxtlPainted && $('#tlExistingList') && window.__lxxData) {
      window.__lxtlPainted = 1;
      tlPaintExisting();
    }
  }

  // ---- boot ------------------------------------------------------------------------------------------
  // The modals are build-time markup but the balances they need arrive asynchronously, and the Receive
  // QR must repaint if the connected wallet changes. Polling briefly is simpler than subscribing to
  // three different layers, and it stops on its own.
  function tick() {
    enhanceReceive();
    stripCopyLabels();
    paintQR();
    fixReceive();
    wireSend();
    refreshSendAsset();
    wireSwap();
    wireTrustlines();
  }

  // Opens the swap dialog from somewhere other than the wallet's own Swap button — the dashboard's
  // "Custom Swap / Orders" card. Everything is wired first, because on that page the dialog is the
  // only thing from this file that is on screen and the poll may not have reached it yet.
  //
  // Published on `window` rather than exported to a second copy of this logic: this is the same
  // element, the same fields and the same signing path the wallet uses. There is no second swap
  // implementation anywhere, which is the point.
  window.__lxxOpenSwap = function () {
    tick();
    var m = $('#modalSwap');
    if (!m) return false;
    openModal(m);
    // Balances can still be in flight on a cold load; the dialog is usable as soon as they land and
    // this repaint is what fills the From balance and the asset pickers when they do.
    [80, 300, 900, 2000].forEach(function (ms) { setTimeout(tick, ms); });
    return true;
  };

  function boot() {
    // `#modalSwap` joins the list because the dashboard carries that dialog and none of the other
    // three. Without it this returned immediately there, so wireSwap() never ran and the Custom Swap
    // card had nothing to open — the dialog was present, correct and completely inert.
    if (!$('#modalSend') && !$('.qr-display') && !$('#tlExistingList') && !$('#modalSwap')) return;
    wireCancels();
    tick();
    var n = 0;
    var t = setInterval(function () {
      tick();
      if (++n > 40) clearInterval(t);                             // ~20s
    }, 500);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button, a');
      // The phone's modal set can be inserted when it opens, so repaint a few times after the click
      // rather than once — the elements may not exist on the first frame.
      if (b && /receive/i.test(b.textContent || '')) {
        [60, 220, 600].forEach(function (ms) {
          setTimeout(function () { enhanceReceive(); paintQR(); fixReceive(); }, ms);
        });
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

