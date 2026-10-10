
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

// Pools page: XRP Ledger AMM pools.
//
// Replaces `lx-ammdata` (~286KB), which was walking STELLAR's Horizon on an XRP Ledger site. The
// page announced "Ranking the network's pools… 7,800 scanned so far" and then rendered TVL in XLM.
//
// Ranked by 24h VOLUME. Measured, not preferred: the upstream's own liquidity ranking returns five
// BITx pools each claiming 113,142,29x of liquidity with zero trade -- a worthless token paired
// with another worthless token inflates nominal value for free. Volume cannot be faked without
// paying fees.
//
// Icons are real token logos, proxied through /lxapi/xrplthumb so the xrpl.to API key stays
// server-side, falling back to initials drawn as inline SVG. The SVG matters beyond looks: the page
// carries a logo healer that repaints any element with 1-5 characters of text as a ticker logo and
// does not look at classes -- an img or svg child is the only thing it skips. See browser/trade.js.
(function () {
  if (window.__lxxPools) return;
  window.__lxxPools = 1;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

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
      var img = document.createElement('img');
      img.src = '/lxapi/xrplthumb?id=' + md5 + '&w=' + (s > 48 ? 64 : 48);
      img.alt = ''; img.loading = 'lazy'; img.width = s; img.height = s;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      // A token with no logo upstream 404s. Fall back rather than leave a broken image.
      img.onerror = initials;
      e.appendChild(img);
    } else {
      initials();
    }
    return e;
  }

  function nameOf(s) {
    if (!s) return '?';
    if (!s.i || s.c === 'XRP') return 'XRP';
    try { return window.lxx.decodeCurrency(s.c).display; } catch (e) { return s.c.slice(0, 6); }
  }

  function amount(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1000) return Math.round(v).toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function count(v) {
    return (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('en-US');
  }

  // A MONEY FIGURE, ABBREVIATED THE WAY STELLAR'S OVERVIEW ABBREVIATES ONE — "$5.32M", "$545.3K".
  // K is one decimal and M upward are two, which is the same ladder the Trade table and the asset
  // page use; the dollar sign is the caller's, because one of these is a headline and one a sub-line.
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // A Market Overview caption, coloured the way Stellar colours one — WITHOUT naming a colour.
  //
  // RAZA 2026-10-06, the two captions this file writes against the two it does not: "text colour on
  // difference on Stellar and XRPL". Measured in dark on both pages, the plain captions already
  // agree — `.amm-snapshot-sub` is rgb(110,109,120) on lumoscore.com and here — and only the two we
  // touch were off, at rgb(165,164,172).
  //
  // Both halves of that were mine. The Active Pools caption inherits `up`, the design's positive-delta
  // style, from a row that once carried a week-on-week change; it renders rgb(53,192,127), green, and
  // there is no delta here for green to mean. I covered it with an inline `var(--text-muted)` — which
  // is a DIFFERENT TOKEN from the one the caption class uses: #a5a4ac in dark, #5a5a66 in light. So the
  // override swapped a wrong colour for another wrong colour, and in opposite directions per theme.
  //
  // Removing the class and the inline both, instead, lands on rgb(110,109,120) — Stellar's exact
  // value — because the caption class then applies, which is all Stellar ever does. Measured all three
  // ways on the live page before writing this. Naming a literal here would have had to be re-picked
  // for light; inheriting cannot drift. [[lumoscore-css-override-traps]]
  function plainSub(el) {
    if (!el) return;
    el.classList.remove('up');
    el.classList.remove('down');
    el.style.color = '';          // clears an override an earlier build of this file may have set
  }

  // The XRP -> USD rate, read once per page from the tokens endpoint — the same source every other
  // USD figure on this site derives from, so the table cannot disagree with the overview or the
  // dashboard about what an XRP is worth. Null until it arrives, and null is rendered as an em dash
  // rather than as a converted number, so a missing rate never invents one.
  var USD = null;

  // ASKED AGAIN WHEN REFUSED (RAZA 2026-09-16: the list showing "—" for liquidity, volume and fees against live pools).
  // The rate endpoint answers 200 with {ok:false} when the upstream throttles it, and one refusal blanked every USD cell
  // in the table for the life of the page.
  // THE MOCK GOES AT ONCE (RAZA 2026-09-17: "On pools main page, theres a flash bug. While the page is refreshed, it show
  // these values for split seconds" — "12.7M APT", "100 active pools", "$21,483.83 · 51,250 APT swapped"). The design ships
  // those figures in the markup and this layer only replaced them once the ledger answered, so every refresh flashed another
  // chain's numbers.
  //
  // THE FIGURES ARE NOW BLANKED IN THE MARKUP ITSELF, by `_xrplpoolsmock` at build time (RAZA reported the flash a second
  // time after this ran here: a script at the end of the body cannot beat the paint of the document that carries it). What
  // is left here is a belt-and-braces pass for any container the transform has not reached.
  //
  // `amm-snapshot-sub` is BOTH a figure and a caption — "51,250 APT swapped" against "Across all pools" — and blanking it
  // wholesale erased the design's own captions, leaving the Total Liquidity row with nothing under its name. Only a sub
  // carrying a digit is mock.
  (function blankOverviewMock() {
    var seen = {};
    [].forEach.call(document.querySelectorAll('.amm-snapshot-value, .amm-snapshot-vsub, .amm-snapshot-sub'), function (n) {
      if (seen[n]) return;
      seen[n] = 1;
      if (n.classList.contains('amm-snapshot-value')) { n.textContent = '—'; return; }
      if (n.classList.contains('amm-snapshot-vsub')) { n.textContent = ''; return; }
      if (/\d/.test(n.textContent || '')) n.textContent = '';
    });
    [].forEach.call(document.querySelectorAll('.stat-cell .val, .pga-cell .val, [class*=pool-stat] .val'), function (n) {
      if (/APT|APTOS/i.test(n.textContent || '')) n.textContent = '—';
    });
  })();

  // THE CACHED RATE, from xrpl-core. This used to retry three times and then give up with null, and
  // null blanks every USD figure on the page -- all fifty rows' Liquidity, Volume and Fees at once,
  // with the numbers themselves present in the response the whole time. The rate comes from xrpl.to
  // at 333 requests a day per IP, so a refusal is ordinary rather than exceptional.
  function fetchUsd(tries) {
    return (window.lxx && window.lxx.fetchUsd) ? window.lxx.fetchUsd(tries) : Promise.resolve(null);
  }

  function usdText(xrpAmount) {
    if (USD == null || xrpAmount == null || !isFinite(xrpAmount)) return '—';
    var v = xrpAmount * USD;
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // The two sides of the pool, "3.40M XRP + 4.63M RLUSD", exactly as Stellar renders its liquidity
  // cell. Returns null when either amount is missing so the cell falls back to one line rather than
  // printing a half-composition.
  function composition(p) {
    var a = p && p.a1, b = p && p.a2;
    if (!a || !b || a.v == null || b.v == null || !isFinite(a.v) || !isFinite(b.v)) return null;
    return amount(a.v) + ' ' + nameOf(a) + ' + ' + amount(b.v) + ' ' + nameOf(b);
  }

  // `pair-sub` is the design's own class — the same one Stellar's liquidity cell uses for its
  // second line — so the sub-line inherits the design's muted size and colour rather than needing
  // any CSS of its own.
  //
  // `sub` is optional now: Stellar puts a second line under LIQUIDITY only, and volume and fees are
  // a single USD figure each.
  function usdCell(xrpAmount, sub) {
    var td = el('td');
    td.appendChild(el('div', null, usdText(xrpAmount)));
    if (sub) td.appendChild(el('div', 'pair-sub', sub));
    return td;
  }

  // Sixth gate of this shape in the project, and the first one on the ROOT element:
  //     html:not(.lx-ammready) #poolsBody, html:not(.lx-ammready) #poolTabs .count
  //         { visibility: hidden }
  // The class goes on <html>, not on <body> and not on the container -- guessing the target failed
  // twice before scanning the stylesheet for what actually matches. These gates have now been found
  // on all three: the root, the body and the container itself. Always look the rule up; never guess
  // where the class belongs.
  function lift() {
    try { document.documentElement.classList.add('lx-ammready'); } catch (e) {}
  }

  // EVERY POOL ROW 404'd, and the cause was a layer that was never ours.
  //
  // The design ships a blanket navigation helper, window.__lumosNav, configured with
  //     LISTTARGET = 'amm-pool'   // blanket row target for pure list pages
  //     CONTAINERNAV = true       // allow container-signal row nav
  // so it claims a click on ANY row of a list page and routes it through lxNavigate/lxClean, which
  // resolve to the Stellar route shape — /pools/<chain>, with the chain defaulting to "stellar"
  // because this build is not one they know. On the XRP Ledger fork that destination does not exist,
  // so every pool row landed on Page not found.
  //
  // Three things did NOT fix it, and each ruled something out: a plain click handler (it answers
  // later and wins), the same handler in capture on the row (capture descends from the top, so a
  // document-level listener still runs first), and a real <a href> (it preventDefaults the anchor).
  // The trace that settled it recorded the click reaching the anchor with the correct href, then an
  // unload, then arrival at /pools/stellar with the pools page as referrer — one navigation, decided
  // by a handler, not by the browser or the server.
  //
  // WINDOW capture is the earliest phase there is: it runs before any document-level listener, so
  // stopImmediatePropagation here settles the question before anything else is consulted. Scoped
  // strictly to clicks inside #poolsBody, so no other navigation on the page is affected.
  // A NEW TAB HAS TO BE OPENED BY US, NOT LEFT TO THE BROWSER (RAZA 2026-10-08: "Allow me to open
  // pools in new tabs. It doesn't let me"). This handler used to RETURN on a modifier click, meaning
  // to let the browser do what it always does with ctrl+click. That is precisely what cannot work
  // here: getting out of the way hands the click to the design's own window-capture router, which
  // calls preventDefault and navigates in the same tab. Measured on the deployed page — ctrl+click on
  // the pair anchor itself came back defaultPrevented with an unload following, so even the real
  // <a href> lost. lumoscore.com hit the same wall and records it in _ammdata.js: "the design's shim
  // runs on window capture and calls preventDefault, so 'let the browser handle it' loses that race".
  //
  // So the row is claimed in every case and the destination is opened explicitly: a modifier click
  // gets window.open, a plain one gets location.href. Right-click is excluded so the context menu
  // (and its own "Open link in new tab") still works. auxclick is bound as well as click because the
  // MIDDLE BUTTON FIRES NO CLICK EVENT AT ALL in Chrome — binding only click would leave middle-click
  // broken in exactly the way this fix is meant to address.
  function claimRowClicks() {
    if (window.__lxxPoolNav) return;
    window.__lxxPoolNav = 1;
    function wantsTab(e) { return !!(e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)); }
    function nav(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tr = t.closest('#poolsBody tr');
      if (!tr) return;
      var a = tr.querySelector('a.pool-pair');
      if (!a) return;
      if (e.button != null && e.button !== 0 && e.button !== 1) return;   // right-click: leave it alone
      e.preventDefault();
      e.stopImmediatePropagation();
      var h = a.getAttribute('href');
      if (wantsTab(e)) {
        try { window.open(h, '_blank', 'noopener'); return; } catch (_) {}
      }
      window.location.href = h;
    }
    window.addEventListener('click', nav, true);
    window.addEventListener('auxclick', nav, true);
  }

  function row(p, rank) {
    var tr = document.createElement('tr');

    // ZERO-PADDED, as on lumoscore.com: "01", "02" … Stellar pads and this did not, which is the
    // "left side numbering is off" — the columns did not line up because the digits did not.
    // `idx`, as on lumoscore.com: that class is what greys the rank. Without it the numbers were drawn
    // in full text colour, which is the "counting column is whiter" RAZA compared (2026-09-15).
    tr.appendChild(el('td', 'idx', (rank < 10 ? '0' : '') + rank));

    var pair = el('td');
    // A REAL ANCHOR, not a scripted navigation. Setting window.location from a click handler here was
    // being overridden: every row click ended on /pools/stellar — the Stellar route shape
    // /pools/<chain>/id/<id> with the chain defaulting to "stellar" — even from a capture-phase
    // listener that stopped propagation, and even though assigning the same URL outside a click
    // navigates correctly. Something inherited answers the click later and wins.
    //
    // An anchor sidesteps the argument entirely: the browser navigates natively, and the site's own
    // link-cleaning handler only rewrites hrefs matching lumoscore-*.html, so it leaves this one
    // alone. It is also how the Stellar build links its pool rows, so this is the shape the rest of
    // the page already expects — and it gives the row middle-click and open-in-new-tab for free.
    // STELLAR'S CELL, NOT A LOOKALIKE (RAZA 2026-09-15: "the text size in rows seems smaller"). Read off
    // lumoscore.com's live row: `div.pair-cell > div.pair-icons > .pa/.pb` at 32px, then
    // `div > div.pair-name` — 15.5px/700 from the design's own stylesheet. This drew 22px discs beside a
    // bare span, so the name took the table's 15px/400 and every row sat 17px shorter.
    var wrap = el('a', 'pool-pair pair-cell');
    wrap.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none';
    var icons = el('div', 'pair-icons');
    icons.setAttribute('data-paired', '1');
    var la = logoEl(nameOf(p.a1), p.a1 && p.a1.m, 32); la.classList.add('pa');
    var lb = logoEl(nameOf(p.a2), p.a2 && p.a2.m, 32); lb.classList.add('pb');
    icons.appendChild(la); icons.appendChild(lb);
    wrap.appendChild(icons);
    var nm = el('div');
    nm.appendChild(el('div', 'pair-name', nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    wrap.appendChild(nm);
    // NO FEE BADGE. This layer used to append the pool's trading fee ("0.205%") beside the pair.
    // lumoscore.com does not, and it was an addition of mine rather than anything the design asked
    // for — removed on RAZA's instruction. The fee still reaches the pool's own page.
    pair.appendChild(wrap);
    tr.appendChild(pair);

    // TWO LINES, LIKE STELLAR — a USD headline over the ledger amount.
    //
    // These cells were one line of XRP each, which is why the rows read as cramped next to
    // lumoscore.com: measured at the same width and the same font size, Stellar's rows were 75px
    // and these were 58px. The height difference is not styling, it is the missing second line.
    // Stellar's cell is `<div>$4.56M</div><div class="pair-sub">12.39M XLM + 2.28M USDC</div>`,
    // and USD is its headline denomination on every one of these three columns.
    //
    // THE SUB-LINE IS THE XRP AMOUNT, NOT THE POOL COMPOSITION. Stellar can show "12.39M XLM +
    // 2.28M USDC" because it has both sides; /lxapi/xrplpools returns a1.v and a2.v as null on
    // every row, so this build does not know them. Getting them means an amm_info per pool — 100
    // round-trips to fill one column, the same cost trap as probing a logo per holding. The XRP
    // amount is the number we actually have, and it is the one the sub-line states.
    // MATCHED TO lumoscore.com, column by column, after RAZA compared them side by side:
    //   Liquidity  a USD headline with the two POOL SIDES beneath — "$4.64M" over
    //              "12.20M XLM + 2.32M USDC". This showed the XRP total instead, because the
    //              amounts were being dropped by the worker (now passed through).
    //   Volume     USD only. No second line.
    //   Fees       USD only. No second line.
    // The XRP sub-lines under volume and fees were mine, and Stellar has neither.
    tr.appendChild(usdCell(p.liq, composition(p)));
    tr.appendChild(usdCell(p.vol));
    tr.appendChild(usdCell(p.fees));
    var partTd = el('td', null, count(p.holders));
    // COUNTED HERE WHEN THE LIST DOES NOT CARRY ONE (RAZA 2026-09-17: "For ARMY / LUMOS pool, i see no participants on
    // Pools-Pool page, but when i open the page, it shows 1 participants"). The upstream leaves lpHolderCount null on some
    // pools; the pool page counts the LP token's own holders, which is why the two pages disagreed about the same pool.
    // `p.holders == null` FIRST, and that is the whole bug (RAZA reported this pool twice). The upstream sends null when
    // it has no count; `+null` is 0, which isFinite() happily accepts — so the one case this repair exists for was the one
    // case it skipped, and the cell kept the em dash `count(null)` had already written. Nothing else was wrong with it.
    //
    // AND NOW FOR EVERY ROW, NOT ONLY THE EMPTY ONES (RAZA 2026-10-08: "yes make it exact on the
    // visible rows"). The upstream's lpHolderCount is a real holder count but a stale snapshot:
    // measured against the ledger across six pools it was right on three and over by one or two on
    // the three busiest — 1206 against 1204, 455 against 454, 184 against 183. Small, but the pool
    // page now counts from the ledger exactly, so leaving the column on the upstream figure would
    // bring back the complaint that started this, just one digit at a time.
    //
    // The sweep below is already viewport-gated, queued and edge-cached, so asking for every visible
    // row costs the same per row as asking for the few that were null.
    if (p.acct) partTd.setAttribute('data-lxpart', p.acct);
    tr.appendChild(partTd);
    // WEIGHTS OFF THE LIVE STELLAR ROW: the liquidity headline and the participant count are 700 there,
    // the volume and fee figures 400. Set inline on those two cells only.
    tr.children[2].firstChild.style.fontWeight = '700';
    tr.children[5].style.fontWeight = '700';

    tr.style.cursor = 'pointer';
    return tr;
  }

  // THE PHONE HAS A DIFFERENT CONTAINER, AND IT WAS GETTING NOTHING.
  //
  // load() opened with `var tb = $('#poolsBody'); if (!tb) return;` — and the mobile page has no
  // #poolsBody. It has #panelAll, a list of .pool-card anchors. So on a phone this entire layer
  // returned on its first line: no real rows, no summary, no overview, no attribution, and the
  // design's own mock left standing — LUMOS / APT, USDC / APT, CELL / APT, "51,250 APT", eight
  // fabricated pools with liquidity and volume figures, visible at rest.
  //
  // Requiring the desktop container is called out in browser/wallet.js as the most repeated bug in
  // this project. It is the same one.
  function card(p, rank) {
    var a = el('a', 'pool-card');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(p.acct);

    var head = el('div', 'pc-head');
    var icons = el('div', 'pair-icons');
    // The design's two discs, replaced with the same real logos the table uses.
    var ia = logoEl(nameOf(p.a1), p.a1 && p.a1.m, 26); ia.classList.add('a');
    var ib = logoEl(nameOf(p.a2), p.a2 && p.a2.m, 26); ib.classList.add('b');
    icons.appendChild(ia); icons.appendChild(ib);
    head.appendChild(icons);

    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', nameOf(p.a1) + ' / ' + nameOf(p.a2)));
    // THE FEE BADGE WAS REMOVED FROM THE TABLE AND LEFT ON THE CARD, so the phone kept showing
    // "0.205% fee tier" after RAZA asked for it to go — "we dont have it on stellar so why did you
    // add it on XRPL". Checked against lumoscore.com's own phone build: its pool cards carry no fee
    // tier at all. The line stays empty, as it is there.
    info.appendChild(el('div', 'pc-sub', ''));
    head.appendChild(info);
    head.appendChild(el('div', 'pc-idx', '#' + (rank < 10 ? '0' : '') + rank));
    a.appendChild(head);

    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    // MATCHED TO THE TABLE AND TO MAIN'S PHONE BUILD, which read: "LIQUIDITY $4.48M / 12.60M XLM +
    // 2.25M USDC" and "VOL (TODAY) $219.3K". So liquidity names BOTH sides — the thing RAZA asked
    // for and which only the desktop table got — and volume is the dollar figure alone. The card
    // previously showed "$4.62M / 3.42M XRP", one side doubled, beside a volume carrying an XRP
    // sub-line the reference does not have.
    stats.appendChild(stat('Liquidity', usdText(p.liq), composition(p)));
    stats.appendChild(stat('Vol (today)', usdText(p.vol)));   // main's phone label, as the note above records
    stats.appendChild(stat('Members', count(p.holders)));
    a.appendChild(stats);
    return a;
  }

  // Whichever list this page actually has.
  function listHost() {
    var tb = $('#poolsBody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelAll');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  function noteHost(h, text) {
    if (h.kind === 'table') { note(h.node, text); return; }
    h.node.innerHTML = '';
    var d = el('div', null, text);
    d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
    h.node.appendChild(d);
  }

  function note(tb, text) {
    tb.innerHTML = '';
    var tr = document.createElement('tr');
    var td = el('td', null, text);
    td.colSpan = 6;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td);
    tb.appendChild(tr);
  }

  // The overview cards above the table. Filled from the SAME response as the rows, so the totals
  // cannot disagree with what is listed under them.
  function paintSummary(s) {
    if (!s) return;
    var map = [
      ['liquidity', amount(s.liquidity) + ' XRP'],
      ['volume', amount(s.vol24) + ' XRP'],
      ['fees', amount(s.fees24) + ' XRP'],
      ['pools', null]
    ];
    var cells = document.querySelectorAll('.stat-cell, .pga-cell, [class*=pool-stat]');
    for (var i = 0; i < cells.length; i++) {
      var lbl = cells[i].querySelector('.lbl');
      if (!lbl) continue;
      var name = lbl.textContent.trim().toLowerCase();
      for (var j = 0; j < map.length; j++) {
        if (map[j][1] != null && name.indexOf(map[j][0]) >= 0) {
          var v = cells[i].querySelector('.val');
          if (v) v.textContent = map[j][1];
        }
      }
    }
  }

  // The "Market Overview" card, which the summary painter above never reached because it keys on
  // different classes. Every one of its four rows was the design's mock, in the wrong asset:
  //
  //   Total Liquidity  12.7M APT ≈ $5.32M   (really 28.6M XRP)
  //   Active Pools     100 · "+4 in past 7 days"   (really 30,663; the 7-day delta has no source)
  //   24h Volume       $21,483.83 · "51,250 APT swapped"   (really 470,740 XRP)
  //   Participants     11,274 · "Unique LP wallets"
  //
  // PARTICIPANTS IS SET TO A DASH, not a number. Who holds an LP token is not something a public node
  // will enumerate — the pool detail page already says so in as many words — so 11,274 is not a stale
  // figure, it is an invented one, and replacing it with a different invented one would be no better.
  // The same goes for "+4 in past 7 days": nothing here knows what the count was a week ago.
  // The page's own strapline read "Provide liquidity and earn fees on Stellar's on-chain AMM pools",
  // above a table of XRP Ledger AMMs. Rewritten by text node so the design's markup is untouched.
  // `.page-subtitle` IS THE PHONE'S, and it was missed because it is invisible: the mobile pools page
  // carries "Provide liquidity and earn fees on Stellar's on-chain AMM pools." in a `.lx-sronly`
  // block — clipped from view, but read aloud by screen readers and present in the served HTML. A
  // selector list that only named the desktop element left the wrong chain's name on the phone
  // build, in the one place nobody looks.
  function paintHeroCopy() {
    $$('.dex-hero-sub, .page-subtitle, .page-title').forEach(function (p) {
      if (!/Stellar|Aptos/i.test(p.textContent || '')) return;
      var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = w.nextNode())) {
        if (!n.nodeValue) continue;
        n.nodeValue = n.nodeValue.replace(/Stellar's/gi, 'the XRP Ledger’s')
          .replace(/\bStellar\b/gi, 'the XRP Ledger').replace(/\bAptos\b/gi, 'the XRP Ledger');
      }
    });
  }

  function paintOverview(d) {
    var s = d && d.summary;
    if (!s) return;
    var rows = $$('.amm-snapshot-row');
    if (!rows.length) return;

    // The USD rate lives on the tokens endpoint, the same one every other USD figure on this site is
    // derived from, so the overview cannot disagree with the rest of the page about what an XRP is.
    // Asked again when refused, like the table's rate — one {ok:false} left this card reading em dashes for the page's life.
    fetchUsd(3).then(function (usd) {
      rows.forEach(function (row) {
        var label = ((row.querySelector('.amm-snapshot-label') || {}).textContent || '').trim().toLowerCase();
        var val = row.querySelector('.amm-snapshot-value');
        var vsub = row.querySelector('.amm-snapshot-vsub');
        var sub = row.querySelector('.amm-snapshot-sub');

        function setVal(text, unit) {
          if (!val) return;
          val.textContent = text;
          if (unit) {
            var u = document.createElement('span');
            u.className = 'unit';
            // data-logoed: a three-letter ticker is exactly what the logo layer claims.
            try { u.setAttribute('data-logoed', '1'); } catch (e) {}
            u.textContent = unit;
            val.appendChild(u);
          }
        }

        // Matched anywhere in the label, not at position 0: the row reads "Total Liquidity", so an
        // indexOf(...) === 0 test silently skipped it and left 12.7M APT sitting beside three
        // corrected rows — the one wrong figure in a block that otherwise looked freshly filled.
        // STELLAR'S SHAPE, ROW BY ROW (RAZA 2026-10-06, six numbered differences on one screenshot).
        // Read off lumoscore.com/pools/stellar:
        //
        //   Total Liquidity   63,771,155 XLM        over  ≈ $5.32M
        //   Active Pools      39,253                over  "Liquidity pools on Stellar"
        //   24h Volume        $545.3K               over  "2,523,911 XLM (24h)"
        //
        // Two of them were INVERTED here. Total Liquidity showed the compacted native figure with the
        // exact dollar underneath ("27.24M XRP" over "≈ $41,363,917"); Stellar shows the exact native
        // figure with the compacted dollar underneath. And 24h Volume led with the native count where
        // Stellar leads with the money — the headline is the dollar, the native amount is the detail.
        if (label.indexOf('liquidity') >= 0) {
          // Grouped, not abbreviated: "63,771,155 XLM" is Stellar's headline, so "27,243,110 XRP" is ours.
          setVal(s.liquidity != null ? Math.round(s.liquidity).toLocaleString('en-US') : '—', 'XRP');
          if (vsub) vsub.textContent = usd ? ('≈ $' + money(s.liquidity * usd)) : '';
        } else if (label.indexOf('active pools') === 0) {
          setVal(d.total != null ? count(d.total) : '—');
          // Stellar's wording, and Stellar's colour by the same route Stellar gets it — see plainSub.
          if (sub) {
            sub.textContent = 'Liquidity pools on XRP Ledger';
            plainSub(sub);
          }
        } else if (label.indexOf('24h volume') === 0) {
          setVal(usd ? ('$' + money(s.vol24 * usd)) : (amount(s.vol24) + ' '), usd ? '' : 'XRP');
          if (sub) {
            sub.textContent = s.vol24 != null
              ? (Math.round(s.vol24).toLocaleString('en-US') + ' XRP (24h)')
              : 'past 24 hours';
            plainSub(sub);
          }
        } else if (label.indexOf('participant') === 0) {
          setVal('—');
          if (sub) sub.textContent = 'Not published by a public node';
        }
      });
    });
  }

  // Removed on instruction 2026-09-09, RESTORED on instruction 2026-09-10 once xrpl.to's own API
  // was found stating the requirement verbatim in its response body — see the fuller note in
  // browser/trade.js.
  function attribution(d) {
    return;                                              // removed: RAZA 2026-09-15, "Please remove … on all places"
    var host = $('#panelAllPools') || $('#panelAll');
    if (!host) return;
    var p = el('p'); p.id = 'lxx-attr-pools';
    p.style.cssText = 'margin:10px 2px 0;font-size:11.5px;opacity:.6;font-weight:500';
    p.appendChild(document.createTextNode('Pool data '));
    var a = el('a', null, d.attribution);
    a.href = d.attributionUrl || 'https://xrpl.to';
    a.target = '_blank'; a.rel = 'noopener';
    a.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
    p.appendChild(a);
    host.appendChild(p);
  }

  // CREATE POOL was disabled here (`markCreatePoolUnwired`) while nothing could sign an AMMCreate: the
  // button relabelled "Pool creation is not enabled yet", the pickers faded to .6 and the dropdowns
  // hidden. RAZA 2026-09-15 asked why; browser/createpool.js now drives the dialog. The design's mock
  // dropdown rows stay hidden by the inherited `.ad-item:not(.lx-cpitem)` rule, so no invented balance
  // can appear — only the account's real holdings are built as `.lx-cpitem`.

  // ---- pagination ----------------------------------------------------------------------------------
  //
  // "whys it only showing 100 pools on XRPL. On Stellar, we're showing all" — and the honest answer
  // has two halves.
  //
  // Stellar genuinely shows all of them: Horizon pages without limit, which is why that page costs
  // ~23s of sequential fetching. xrpl.to does not. `limit` is capped at 100 per request server-side
  // (asking for 200 returns 100), and the only offset parameter that changes the result, `start`,
  // ABANDONS THE SORT — `start=0` and `start=100` return the same first pool and volumes that no
  // longer descend. Measured, not assumed. Walking all 30,728 would be ~308 sequential requests
  // against a 333-a-DAY budget, and it could not be kept in volume order anyway.
  //
  // So the page serves the top 100 by volume, which is the ceiling, and now says so instead of
  // rendering fifty rows under a badge reading 30,728 with no way to reach the rest. The design
  // ships `#paginationAll` — "Showing 1–10 of 100 pools" plus First/Prev/numbers/Next/Last — and it
  // had never been wired to anything. Nothing new is introduced; only what the buttons do.
  var PER = 50;
  var pageNo = 1;

  function setPageInfo(from, to, total) {
    var pg = $('#paginationAll');
    if (!pg) return;
    var strongs = pg.querySelectorAll('div:first-child strong');
    if (strongs.length > 1) {
      strongs[0].textContent = from + '–' + to;
      strongs[1].textContent = count(total);
    }
  }

  function buildPager(h, d, pages) {
    var pg = $('#paginationAll');
    if (!pg) return;
    var ctrls = pg.querySelector('.page-controls');
    if (!ctrls) return;

    // The design's own First/Prev/Next/Last are kept — they carry its labels — and only the numbers
    // between them are rebuilt. Found by text rather than by index, because the number of children
    // changes every time this runs.
    var kids = [].slice.call(ctrls.children);
    function find(re) {
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === 'BUTTON' && re.test(kids[i].textContent || '')) return kids[i];
      }
      return null;
    }
    var first = find(/first/i), prev = find(/prev/i), next = find(/next/i), last = find(/last/i);
    kids.forEach(function (k) {
      if (k !== first && k !== prev && k !== next && k !== last) k.remove();
    });

    // "PAGE 1 OF 442", NOT A ROW OF NUMBERED BUTTONS (RAZA 2026-10-06, difference 3). Stellar puts a
    // plain label between Prev and Next; this built one button per page, which is also why the two
    // pagers look nothing alike at a glance even before you read them.
    //
    // It is a span, not a disabled button: nothing here is clickable, and a button that cannot be
    // pressed invites the press.
    var lbl = document.createElement('span');
    lbl.className = 'lx-pageno';
    lbl.textContent = 'Page ' + pageNo + ' of ' + pages;
    ctrls.insertBefore(lbl, next);

    function nav(btn, target, disabled) {
      if (!btn) return;
      var clone = btn.cloneNode(true);              // drops the previous render's listener
      btn.parentNode.replaceChild(clone, btn);
      clone.disabled = !!disabled;
      if (!disabled) clone.addEventListener('click', function () { renderPage(h, d, target); });
    }
    nav(first, 1, pageNo === 1);
    nav(prev, pageNo - 1, pageNo === 1);
    nav(next, pageNo + 1, pageNo === pages);
    nav(last, pages, pageNo === pages);

    pg.style.display = pages > 1 ? '' : 'none';
    pagerStyle();
    pagerAboveOverview();
  }

  // Stellar's label is a muted 13.5px span (`.lx-netpag-m`); ours is a span of our own, so it needs the
  // same three declarations. Injected once, by id, so a re-render cannot stack copies.
  function pagerStyle() {
    if (document.getElementById('lx-pageno-css')) return;
    var st = document.createElement('style');
    st.id = 'lx-pageno-css';
    st.textContent = '.lx-pageno{font-size:13.5px;font-weight:400;color:var(--text-muted,#6e6d78);'
      + 'display:inline-flex;align-items:center;padding:0 10px;white-space:nowrap}';
    (document.head || document.documentElement).appendChild(st);
  }

  // THE PAGER GOES ABOVE THE MARKET OVERVIEW (RAZA 2026-10-06, difference 6). On Stellar the order is
  // table → "Showing 1–25 of 11,029 pools" + controls → Market Overview; here the overview card sat
  // between the table and its own pager, so the count belonged to nothing you could see.
  //
  // Verified on lumoscore.com by document order rather than by eye: compareDocumentPosition puts
  // #paginationAll before .amm-snapshot-card.
  // IT IS THE CARD THAT MOVES, NOT THE PAGER — and it is `_sidecard.js` that moves it, on both builds.
  //
  // Three attempts failed before reading the layer that actually owns this, so the mechanism is worth
  // stating. `_sidecard.js` (inherited; `lx-sc` is on <html> here, so it RUNS on this build) relocates
  // `.amm-snapshot-card` out of the hero and down the page, placing it after an anchor:
  //
  //     .lx-netpag-host  ||  .lx-netpag  ||  #panelMine,#panelMyPositions   (whichever is LAST)
  //
  // On lumoscore.com the pools pager carries `lx-netpag`, so the anchor is the pager and the card
  // lands directly after it — which is the whole of the difference RAZA screenshotted. This build
  // inherited netpag's STYLESHEET but never the class on the element: measured, our pager's className
  // is just "pagination". So the anchor fell through to `#panelMyPositions`, which sits INSIDE the
  // list card above, and the overview was parked there — above the pager instead of below it.
  //
  // So the fix is one class, plus the same placement _sidecard would do, applied now rather than at
  // its next observer tick. `lx-netpag-host` and not `lx-netpag`: anchor() checks the host class
  // first, and it carries a single `margin-top:10px`, where `.lx-netpag` would restyle the whole
  // pager — border-top, padding, font, every button.
  //
  // WHAT NOT TO DO, all three measured on deploys:
  //   * Moving the PAGER up works and is undone seconds later — _sidecard puts the card back where
  //     its anchor says, and its anchor was wrong. The node that was fighting me was mine.
  //   * A MutationObserver re-asserting that move HUNG THE TAB (deploy 11dc2b93): move → childList
  //     mutation → _sidecard answers → forever. _sidecard's own observer is safe only because
  //     place() is a no-op once settled, which is why the guard below is the same shape.
  //   * `.page{display:flex}` + `order:1` on the card. This measured correct here at every width and
  //     theme and was still wrong on RAZA's screen — a declared order that only holds in one browser
  //     is not a fix, and it made the page's root a flex container for no reason.
  function pagerAboveOverview() {
    var pg = $('#paginationAll');
    if (!pg || !pg.parentNode) return;
    pg.classList.add('lx-netpag-host');                 // the anchor _sidecard.js looks for
    var card = document.querySelector('.amm-snapshot-card');
    if (!card) return;                                  // painted by a later layer; _sidecard places it
    if (card.parentNode === pg.parentNode && pg.nextElementSibling === card) return;   // settled
    pg.parentNode.insertBefore(card, pg.nextSibling);
  }

  // Which column the table is ordered by.
  //
  // The note here used to say the endpoint returns pools by liquidity descending, "so the default
  // has to describe that rather than impose a second ordering". That was not true: the endpoint asks
  // the upstream for a VOLUME ranking, and until 2026-10-07 it asked with a key the upstream does
  // not sort by, so the rows arrived in no order at all. This client-side sort was therefore not
  // describing the response — it was the only thing ordering the table.
  // It still is, and that is now correct by construction: the endpoint selects the top pools by 24h
  // volume across the whole ledger, and this orders that set by whichever column the reader picks.
  var SORT = { key: 'liq', dir: -1 };
  function applySort(rows) {
    if (!SORT.key) return rows;
    var k = SORT.key, dir = SORT.dir;
    return rows.slice().sort(function (a, b) {
      var x = +a[k], y = +b[k];
      // A pool with no figure for this column sorts last in either direction rather than counting as zero.
      var xb = !isFinite(x), yb = !isFinite(y);
      if (xb && yb) return 0;
      if (xb) return 1;
      if (yb) return -1;
      // dir -1 is high-to-low, which is what the table opens on: the bigger value must come FIRST, so it returns dir.
      return x === y ? 0 : (x > y ? dir : -dir);
    });
  }
  if (!window.__lxxPoolSort) {
    window.__lxxPoolSort = 1;
    window.addEventListener('click', function (e) {
      var th = e.target && e.target.closest && e.target.closest('th[data-lxsort]');
      if (!th) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var key = th.getAttribute('data-lxsort');
      SORT = { key: key, dir: (SORT.key === key && SORT.dir === -1) ? 1 : -1 };
      paintHeadings();
      var d = window.__lxxPoolsData, hh = listHost();
      if (d && hh) renderPage(hh, d, 1);
    }, true);
  }

  function renderPage(h, d, n) {
    var total = d.rows.length;

    // NO PAGER, NO PAGING. The phone build carries no #paginationAll at all, so paging there would
    // hide rows behind a control that does not exist — the mistake this made once already on the
    // trade page. The phone gets the whole hundred; the desktop pages them.
    var paged = !!$('#paginationAll');
    var per = paged ? PER : total;
    var pages = Math.max(1, Math.ceil(total / per));
    pageNo = Math.min(Math.max(1, n), pages);

    var from = (pageNo - 1) * per;
    var to = Math.min(from + per, total);

    h.node.innerHTML = '';
    var make = h.kind === 'table' ? row : card;
    var rows = applySort(d.rows);
    // Absolute rank: page 2 opens at 51, because the number means "51st by volume", not "the first
    // row I happened to draw".
    for (var i = from; i < to; i++) h.node.appendChild(make(rows[i], i + 1));

    setPageInfo(from + 1, to, total);
    buildPager(h, d, pages);
    fillParticipants();
  }

  // The same count the pool page shows: the LP token's holder list, which needs the token's currency from amm_info first.
  // Only for the rows on screen, three at a time, and capped — this is a repair for a missing field, not a column to build
  // out of a hundred round trips.
  function rpc(method, params) {
    return fetch('https://xrplcluster.com/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  var PART_RUN = 0, PART_Q = [];
  // FILLED FOR WHATEVER IS ON SCREEN, not the first twelve rows (RAZA 2026-09-17: LUMOS/ARMY, rank 42, still reading "—"
  // while the pool page showed 1). Each missing cell costs two reads — amm_info for the LP token, then its holder count —
  // so doing all fifty upfront is a hundred requests for figures nobody has scrolled to. This fills a cell when it comes
  // within a screen of the viewport, three at a time, and each one only ever once.
  function fillParticipants() {
    sweepParticipants();
    if (window.__lxxPartScroll) return;
    window.__lxxPartScroll = 1;
    var t = null;
    var again = function () { clearTimeout(t); t = setTimeout(sweepParticipants, 120); };
    window.addEventListener('scroll', again, { passive: true });
    window.addEventListener('resize', again, { passive: true });
  }

  function sweepParticipants() {
    var h = window.innerHeight || 800;
    var cells = [].slice.call(document.querySelectorAll('td[data-lxpart]')).filter(function (td) {
      var r = td.getBoundingClientRect();
      return r.bottom > -h && r.top < h * 2;             // on screen, or within a screen of it
    });
    cells.forEach(function (td) {
      var acct = td.getAttribute('data-lxpart');
      td.removeAttribute('data-lxpart');
      PART_Q.push(function () {
        // ONE CALL, AT THE EDGE, CACHED (RAZA 2026-09-17, reporting the same pool a second time: "ARMY / LUMOS pool still
        // shows no participants on pools main page"). This used to be amm_info plus a holder count from the reader's own
        // IP — two public-cluster requests per row, and searching "army" fired fifty of them at once. What the cluster
        // refused came back here as a swallowed error and an em dash that nothing retried.
        return fetch('/lxapi/xrplparticipants?acct=' + encodeURIComponent(acct))
          .then(function (x) { return x.json(); })
          .then(function (d) {
            if (d && d.ok && d.total != null) {
              // A TRUNCATED COUNT MUST NOT REPLACE A WHOLE ONE. The endpoint stops after five pages
              // of four hundred lines and says so with `complete:false`; past that its total is a
              // floor, not a figure. Where the upstream already gave a number, that stays — it is
              // only one or two out — and the partial is used solely where the cell had nothing but
              // an em dash, which is the case this sweep was built for.
              if (d.complete !== false) { td.textContent = count(d.total); return; }
              if (!/[0-9]/.test(td.textContent || '')) td.textContent = count(d.total);
              return;
            }
            throw new Error('no count');
          })
          .catch(function () {
            // PUT IT BACK, so the next sweep tries again. A cell that loses its account has no second chance, and one
            // refused request then reads as "this pool has no liquidity providers" for the life of the page.
            var tries = +(td.getAttribute('data-lxparttry') || 0) + 1;
            if (tries > 3) return;
            td.setAttribute('data-lxparttry', tries);
            td.setAttribute('data-lxpart', acct);
            setTimeout(sweepParticipants, 1200 * tries);
          });
      });
    });
    pumpPart();
  }
  function pumpPart() {
    while (PART_RUN < 3 && PART_Q.length) {
      PART_RUN++;
      PART_Q.shift()().then(function () { PART_RUN--; pumpPart(); }, function () { PART_RUN--; pumpPart(); });
    }
  }

  // THE HEADINGS lumoscore.com USES, read off its live table (RAZA 2026-09-15):
  //     #   Pair   Liquidity ↓   VOL (TODAY)   FEES (TODAY)   Participants
  // Only Liquidity carries an arrow — the table is ordered by it and nothing re-sorts — and every
  // heading is `cursor: default`. This build showed "24h Volume ↕", "Fees (24h) ↕", "Participants ↕":
  // arrows promising a sort that does not exist.
  //
  // A NOTE ON "TODAY": xrpl.to reports a rolling 24 hours, not the UTC day Stellar's figures cover. The
  // label follows Stellar on RAZA's instruction; the tooltip says what the number actually is.
  //
  // And the tab: Stellar says "My Pools", this said "My Positions". Text node only, so the count badge
  // beside it stays live.
  function paintHeadings() {
    var head = $('#poolsBody') && $('#poolsBody').parentNode.querySelector('thead tr');
    if (head) {
      // SORTABLE, AS ON THE TRADE TABLE (RAZA 2026-09-17: "Let me short the pool columns (Liq, Vol, Fees, Participants) from
      // high to low just like im able to sort Trade main page columns"). The arrow marks the column in force and its
      // direction; the four figure columns take a click, and # and Pair stay inert as they are on lumoscore.com.
      var WANT = [['#', null, null], ['Pair', null, null], ['Liquidity ', '↓', 'liq'],
                  ['VOL (TODAY)', '', 'vol'], ['FEES (TODAY)', '', 'fees'], ['Participants ', '', 'holders']];
      var ths = head.querySelectorAll('th');
      for (var i = 0; i < ths.length && i < WANT.length; i++) {
        var th = ths[i];
        var key = WANT[i][2];
        th.textContent = WANT[i][0];
        if (WANT[i][1] != null) {
          var si = document.createElement('span');
          si.className = 'sort-i';
          si.textContent = key === SORT.key ? (SORT.dir < 0 ? '↓' : '↑') : '';
          th.appendChild(si);
        }
        if (key) {
          th.setAttribute('data-lxsort', key);
          th.style.cursor = 'pointer';
          th.title = (i === 3 || i === 4 ? 'Past 24 hours · ' : '') + 'Sort by this column';
        } else {
          th.style.cursor = 'default';
        }
      }
    }
    $$('#poolTabs button[data-tab="mine"], [data-tab="mine"]').forEach(function (b) {
      [].forEach.call(b.childNodes, function (n) {
        if (n.nodeType === 3 && /My Positions/i.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/My Positions/i, 'My Pools');
      });
    });
  }

  // POOL SEARCH ACROSS THE LEDGER (RAZA 2026-09-15: "Its not searching for all the pools of TOTO"). The design's
  // box filters the rows already drawn — fifty of thirty thousand — so a token outside the top hundred could never
  // match. Claimed at window capture (the design's own handler would hide rows), the text is resolved to issuers
  // through the token search, every pool of each issuer is fetched, and those are drawn with the same pager.
  var poolQ = 0;
  function wireSearch(h) {
    if (window.__lxxPoolSearch) return;
    window.__lxxPoolSearch = 1;

    // NO BROWSER FORM HISTORY OVER THIS FIELD. The design ships the input with no autocomplete
    // attribute, so Chrome treats it as an ordinary saved-value field and drops its own white
    // suggestion list over the results -- a second dropdown, in the browser's styling, listing
    // whatever the person last typed ("lumos", "LUMOS") on top of the pool table they are trying to
    // read. Nothing on this page put it there and nothing on this page can style it, so it is turned
    // off at the source instead.
    var box = document.getElementById('poolSearch');
    if (box) {
      box.setAttribute('autocomplete', 'off');
      box.setAttribute('autocorrect', 'off');
      box.setAttribute('autocapitalize', 'off');
      box.setAttribute('spellcheck', 'false');
      // Chrome ignores autocomplete="off" on a field it can NAME, and honours it on one it cannot.
      box.removeAttribute('name');
    }

    var t = null;
    window.addEventListener('input', function (e) {
      var inp = e.target;
      if (!inp || inp.id !== 'poolSearch') return;
      e.stopImmediatePropagation();
      clearTimeout(t);
      t = setTimeout(function () { searchPools(h, String(inp.value || '').trim()); }, 350);
    }, true);
  }

  function searchPools(h, q) {
    var my = ++poolQ;
    var all = window.__lxxPoolsData;
    if (q.length < 2) { if (all) renderPage(h, all, 1); return; }
    var ql = q.toLowerCase();
    noteHost(h, 'Searching the XRP Ledger…');
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (my !== poolQ) return;
        // A REFUSED TOKEN SEARCH IS NOT AN EMPTY LEDGER. Pools are found by looking up the issuers behind the typed word,
        // so when that lookup fails there is nothing to look pools up BY — and this used to carry on and report "No pools
        // match that search", which is a claim about the ledger rather than about the request. (RAZA 2026-09-17, searching
        // "lumos" against pools that do exist.)
        // RATE LIMITED IS NOT UNAVAILABLE. This lookup resolves the typed word to ISSUERS, and it is
        // the first thing to go: xrpl.to's anonymous tier is 333 requests a day, and every DISTINCT
        // query is its own URL, so unlike the pool list — one URL, edge-cached, measured as a HIT —
        // searching cannot be amortised and a day of testing exhausts it. (RAZA 2026-10-01, searching
        // "lumen" against pools that plainly exist.)
        //
        // Losing it costs reach, not the feature: pools outside the loaded page become unreachable,
        // but the ones already in hand are still searchable, and a partial answer beats a dead end.
        if (!s || !s.ok) return localPools(h, ql, all, my);
        var seen = {}, issuers = [];
        ((s && s.rows) || []).forEach(function (t) {
          var code = nameOf({ c: t.c, i: t.i }).toLowerCase(), nm = String(t.n || '').toLowerCase();
          if ((code.indexOf(ql) < 0 && nm.indexOf(ql) < 0) || seen[t.i]) return;
          seen[t.i] = 1;
          issuers.push(t.i);
        });
        // EVERY POOL FOR THE ASSET, which is the point of searching by issuer rather than filtering
        // the loaded page (RAZA 2026-10-07: "it must show all pools for any asset").
        //
        // Two caps used to stop that being true, and both were invisible in the result — a short
        // list reads exactly like a complete one:
        //   * `n=100` per issuer. The endpoint now pages behind a single call, so 1000 covers any
        //     issuer on the ledger; it costs ONE upstream request for a typical issuer because the
        //     paging loop stops the moment a page comes back short.
        //   * `slice(0, 8)` issuers. A ticker like USD is issued by dozens of accounts, so the 9th
        //     onwards contributed nothing and the search quietly understated the ledger. Raised to
        //     32, which covers every code measured here and still bounds a pathological query.
        var ISSUER_CAP = 32;
        window.__lxxPoolSearchTrunc = issuers.length > ISSUER_CAP;
        return Promise.all(issuers.slice(0, ISSUER_CAP).map(function (iss) {
          return fetch('/lxapi/xrplpools?n=1000&issuer=' + encodeURIComponent(iss))
            .then(function (r) { return r.json(); }).catch(function () { return null; });
        })).then(function (res) {
          if (my !== poolQ) return;
          var rows = [], got = {};
          function add(r) {
            if (!r || !r.acct || got[r.acct]) return;
            if (nameOf(r.a1).toLowerCase().indexOf(ql) < 0 && nameOf(r.a2).toLowerCase().indexOf(ql) < 0) return;
            got[r.acct] = 1;
            rows.push(r);
          }
          res.forEach(function (d) { ((d && d.rows) || []).forEach(add); });
          ((all && all.rows) || []).forEach(add);             // covers XRP, which has no issuer to search by
          rows.sort(function (x, y) { return (+y.liq || 0) - (+x.liq || 0); });
          if (!rows.length) {
            noteHost(h, 'No pools match that search.');
            var pg = $('#paginationAll');
            if (pg) pg.style.display = 'none';
            return;
          }
          renderPage(h, { ok: true, rows: rows, total: rows.length }, 1);
        });
      })
      .catch(function () { localPools(h, ql, all, my); });
  }

  // What can still be answered without the issuer lookup: the pools already loaded on this page.
  // Narrower than a ledger-wide search and said so rather than dressed up as one.
  function localPools(h, ql, all, my) {
    if (my !== poolQ) return;
    var rows = [];
    ((all && all.rows) || []).forEach(function (r) {
      if (!r || !r.acct) return;
      if (nameOf(r.a1).toLowerCase().indexOf(ql) < 0 && nameOf(r.a2).toLowerCase().indexOf(ql) < 0) return;
      rows.push(r);
    });
    var pg = $('#paginationAll');
    if (!rows.length) {
      noteHost(h, 'No match in the pools loaded here. The ledger-wide asset search is rate limited '
        + 'right now — try again in a minute.');
      if (pg) pg.style.display = 'none';
      return;
    }
    rows.sort(function (x, y) { return (+y.liq || 0) - (+x.liq || 0); });
    if (pg) pg.style.display = 'none';
    renderPage(h, { ok: true, rows: rows, total: rows.length }, 1);
  }

  // Walk the ranking out past the first batch, in the background (RAZA 2026-10-07: raise it to
  // 10,000). It has to be the client that accumulates depth: 10,000 rows is 100 upstream pages, and
  // a Worker on the free plan gets 50 subrequests and 10ms of CPU, so one request asking for all of
  // them fails at page 51. Ten calls of a thousand each stay inside the limits and cache separately.
  //
  // SEQUENTIAL, one batch in flight at a time. The upstream rate-limits readily — this
  // investigation tripped it — so a burst of ten parallel calls would be the thing that breaks it.
  // A failed or short batch simply stops the walk and keeps everything already in hand.
  var DEEP_TARGET = 10000;
  function deepen(h, d) {
    if (!d || !d.more) return;
    var next = d.nextP0 || 11;
    var qAtStart = poolQ;
    function step() {
      // Abandon if the dataset was replaced (reload) or the reader started searching — repainting
      // under a search is the second-writer repaint this project keeps getting bitten by.
      if (window.__lxxPoolsData !== d || poolQ !== qAtStart) return;
      if (d.rows.length >= DEEP_TARGET) return;
      fetch('/lxapi/xrplpools?n=1000&p0=' + next)
        .then(function (r) { return r.json(); })
        .then(function (b) {
          // WHY THE WALK STOPPED, recorded rather than swallowed. The first version of this ended in
          // an empty .catch(), and when the walk halted at 3,000 rows there was no way to tell a
          // rate-limited upstream from a bug in this function — the two look identical from outside.
          // Read window.__lxxPoolsDeep in the console to see where it got to and why.
          window.__lxxPoolsDeep = { rows: d.rows.length, lastP0: next, reason: 'running' };
          if (!b || !b.ok) { window.__lxxPoolsDeep.reason = 'upstream refused (' + ((b && b.error) || 'no body') + ')'; return; }
          if (!b.rows || !b.rows.length) { window.__lxxPoolsDeep.reason = 'empty batch'; return; }
          if (window.__lxxPoolsData !== d || poolQ !== qAtStart) { window.__lxxPoolsDeep.reason = 'superseded'; return; }
          // Dedupe on the AMM account. A repeated page would otherwise pad the count with rows the
          // table already holds, and a padded count is worse than a short one: it reads as coverage.
          var got = {};
          d.rows.forEach(function (r) { if (r && r.acct) got[r.acct] = 1; });
          var added = 0;
          b.rows.forEach(function (r) {
            if (!r || !r.acct || got[r.acct]) return;
            got[r.acct] = 1; d.rows.push(r); added++;
          });
          next = b.nextP0 || (next + 10);
          // Only while the reader is on the first page. Deeper batches can carry a pool whose
          // liquidity puts it near the top, so a repaint reorders the table — fine to watch fill in
          // from page one, not fine to have happen under someone reading page seven.
          window.__lxxPoolsDeep.rows = d.rows.length;
          if (added && pageNo === 1) renderPage(h, d, 1);
          if (!added) { window.__lxxPoolsDeep.reason = 'batch held nothing new'; return; }
          if (!b.more) { window.__lxxPoolsDeep.reason = 'ranking exhausted'; return; }
          if (d.rows.length >= DEEP_TARGET) { window.__lxxPoolsDeep.reason = 'target reached'; return; }
          step();
        })
        .catch(function (err) {
          window.__lxxPoolsDeep = { rows: d.rows.length, lastP0: next, reason: 'threw: ' + ((err && err.message) || err) };
        });
    }
    step();
  }

  function load() {
    var h = listHost();
    if (!h) return;                                    // not the Pools page
    // The LUMOS page's "All LUMOS pools" table is Stellar's own layout (Pool · TVL · 24h Volume · Incentives · View pool),
    // built by ltoken.js from the design's row; this file's Pools-page rows do not belong in it.
    if ($('.lumos-hero-row')) return;
    lift();
    claimRowClicks();
    wireSearch(h);
    // Create Pool is wired now (browser/createpool.js), so the dialog is no longer disabled here.
    paintHeadings();
    paintHeroCopy();
    noteHost(h, 'Reading the XRP Ledger…');

    // BOTH BEFORE RENDERING. The rows now carry a USD headline, and painting them before the rate
    // lands would draw a full table of em dashes that a later pass would have to rewrite — the
    // two-writers-on-one-element shape this project keeps getting bitten by. Promise.all costs
    // nothing here: the tokens response is edge-cached and the two requests overlap.
    Promise.all([
      // n=1000, raised from 100 (RAZA 2026-10-07: "its only considering 100 pools unlike Stellar
      // where it considers all network pools"). 100 was the UPSTREAM's per-request limit, mistaken
      // for a limit on what could be ranked; the endpoint now pages up to ten times behind this
      // single call. The endpoint also had the wrong sort key, so the old hundred were not even the
      // top hundred — see the note there, which is the half of this that actually changes the table.
      // On the LUMOS page the table is "All LUMOS pools", not the site's top ranks (RAZA 2026-09-15),
      // and the issuer filter narrows the upstream to ~22 rows, so it costs one request either way.
      fetch('/lxapi/xrplpools?n=1000' + ($('.lumos-hero-row') ? '&issuer=rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha' : ''))
        .then(function (r) { return r.json(); }),
      fetchUsd(3),
    ]).then(function (both) {
      var d = both[0];
      USD = both[1];
      if (!d || !d.ok || !d.rows.length) { noteHost(h, 'Pool data is unavailable right now.'); return; }
      window.__lxxPoolsData = d;
      renderPage(h, d, 1);
      // The LUMOS page's copy of this table is gated by #poolsBody:not(.lxlt) tr{visibility:hidden}.
      if ($('#poolsBody')) $('#poolsBody').classList.add('lxlt');
      // THE TAB SAID "All Pools 100", which is how many rows we fetched, not how many exist.
      // lumoscore.com shows the real figure there (10,986 on Stellar), and the upstream reports
      // 30,729 active pools for this ledger — so the badge was understating the ledger by three
      // orders of magnitude and reading as "this is all there is".
      //
      // The COUNT is now the truth even though the table still lists a page of them; that is the
      // same thing Stellar does. How many rows to serve is a separate question and a real cost
      // decision — see the note in load().
      var tabCount = $('#poolTabs .count');
      if (tabCount && d.total != null) tabCount.textContent = count(d.total);

      paintSummary(d.summary);
      paintOverview(d);
      attribution(d);
      deepen(h, d);
      // A table of em dashes is repainted the moment a rate does arrive, rather than waiting for the next visit.
      if (USD == null) {
        fetchUsd(4).then(function (u) {
          if (!(u > 0)) return;
          USD = u;
          renderPage(h, d, 1);
          paintSummary(d.summary);
          paintOverview(d);
        });
      }
    }).catch(function () { noteHost(h, 'Pool data is unavailable right now.'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxPoolsReload = load;
})();

// Pools -> My Positions: this account's real AMM positions.
//
// WHAT WAS THERE. The design's mock, presented as yours:
//
//   01  LUMOS / APT   Native - Utility      1,842 APT ~$772   0.054%   +12.40 APT ~$5.19   May 14, 2026
//   02  USDC / APT    Stablecoin - Circle   1,600 APT ~$670   0.059%   +8.92 APT  ~$3.74   May 09, 2026
//
// with the tab counting "2". Two invented liquidity positions, in APT, on an XRP Ledger site, with
// invented fee earnings and invented deposit dates, attributed to whoever is connected. That is the
// same class as the fabricated activity feed this project removed on day one, and worse in one
// respect: a feed is a claim about the network, this is a claim about *your money*.
//
// It survived every earlier sweep because the panel ships `display:none` and only appears when the
// tab is clicked — the known blind spot of any pass that reads the page at rest.
//
// WHERE THE REAL NUMBERS COME FROM. An LP token's ISSUER is the AMM account itself, so the account's
// own trustlines are the position list: every line whose currency is an LP token (40 hex starting
// 03) is a pool this account is in, and its balance is the LP tokens held. `amm_info` on that issuer
// returns the pool's two sides and the total LP supply, and share = held / total. Nothing here is
// derived from a price feed; the amounts are the pool's own reserves scaled by that share.
//
// TWO COLUMNS STAY EM DASHES, and that is the honest answer rather than a gap. "Fees Earned" and
// "Deposited" cannot be computed from ledger state: an AMM records no per-provider fee accrual and
// no deposit date. Recovering either means replaying this account's whole transaction history and
// valuing each entry at the time — a different feature, not a number to guess. Anything without a
// source is an em dash; that rule is why the rest of this page can be trusted.
(function () {
  if (window.__lxxMyPos) return;
  window.__lxxMyPos = 1;

  var RPC = 'https://xrplcluster.com/';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function rpc1(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); });
  }
  // One retry: a dropped request from the public node was enough to leave the list empty.
  function rpc(method, params) {
    return rpc1(method, params).catch(function () {
      return new Promise(function (res) { setTimeout(res, 800); }).then(function () { return rpc1(method, params); });
    });
  }

  function addr() {
    try { return (window.lxc && window.lxc.address && window.lxc.address()) || localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    var d = dp != null ? dp : (a >= 1000 ? 0 : a >= 1 ? 2 : 6);
    var s = Number(n).toFixed(d);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  // A side is a drops string (XRP) or { currency, issuer, value }.
  function side(a) {
    if (a == null) return null;
    if (typeof a === 'string') return { name: 'XRP', amount: Number(a) / 1e6, cur: 'XRP', iss: '' };
    var d = window.lxx.decodeCurrency(a.currency);
    return { name: (d && d.display) || a.currency, amount: Number(a.value), cur: a.currency, iss: a.issuer };
  }

  // A stable colour per ticker, matching how the wallet draws a mark it has no logo for.
  function hue(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',52%,42%)';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The page's logo engine repaints any element holding 1-5 characters, and these discs hold exactly
  // one. data-logoed is its own skip marker.
  // THE POOL'S TWO LOGOS (RAZA 2026-09-16: "Where are the fucking logos for the pool"), in the Pools list's own .pa/.pb slots,
  // falling back to the lettered disc when a token has none.
  function logo(cls, sd) {
    var e = el('span', 'lxx-ic ' + cls);
    e.setAttribute('data-logoed', '1');
    e.style.cssText = 'display:inline-flex;width:32px;height:32px;flex:0 0 32px;border-radius:50%;overflow:hidden;align-items:center;justify-content:center';
    var im = document.createElement('img');
    im.alt = '';
    im.src = sd.cur === 'XRP' ? '/lxapi/xrplthumb?id=84e5efeb89c4eae8f68188982dc290d8&w=48'
      : ('/lxapi/xrplthumb?iss=' + encodeURIComponent(sd.iss) + '&cur=' + encodeURIComponent(sd.cur) + '&w=48');
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    im.onerror = function () {
      if (im.parentNode) im.parentNode.removeChild(im);
      e.style.background = hue(sd.name);
      e.style.color = '#fff'; e.style.fontSize = '12px'; e.style.fontWeight = '800';
      e.appendChild(document.createTextNode(String(sd.name || '?').charAt(0).toUpperCase()));
    };
    e.appendChild(im);
    return e;
  }

  function disc(cls, name) {
    var d = el('div', cls, String(name || '?').slice(0, 1).toUpperCase());
    try { d.setAttribute('data-logoed', '1'); } catch (e) {}
    d.style.background = hue(name);
    return d;
  }

  // Desktop is a table inside #panelMyPositions; the phone is a list of .pool-card anchors in
  // #panelMine. Targeting only the first left the phone showing the design's two invented positions
  // with the tab counting "2" — the same desktop-only assumption that had the whole pools layer
  // returning on its first line on mobile.
  function host() {
    var d = $('#panelMyPositions');
    var tb = d && d.querySelector('tbody');
    if (tb) return { node: tb, kind: 'table' };
    var m = $('#panelMine');
    if (m) return { node: m, kind: 'cards' };
    return null;
  }

  function tbody() {
    var h = host();
    return h && h.kind === 'table' ? h.node : null;
  }

  // The count on the My Positions tab, found by ITS OWN tab rather than by position. Taking
  // `#poolTabs .count` and indexing into it is how counts end up written into the wrong tab — that
  // exact bug is documented in browser/wallet.js.
  function setCount(n) {
    var btn = $$('#poolTabs button, #poolTabs [data-tab]').filter(function (b) {
      return /position/i.test(b.textContent || '') || b.getAttribute('data-tab') === 'mine';
    })[0];
    var c = btn && btn.querySelector('.count');
    // The tab's count badge (RAZA 2026-09-16: "Where's the fucking pool count on the tab"): created if the tab lost it.
    if (btn && !c) { c = el('span', 'count'); btn.appendChild(document.createTextNode(' ')); btn.appendChild(c); }
    if (c) { c.textContent = String(n); c.setAttribute('data-logoed', '1'); c.style.removeProperty('display'); c.style.visibility = 'visible'; }
  }

  // The panel sits behind the design's fade-in gate at opacity 0 (see connect.js); it is released whenever this writes to it.
  function reveal() {
    var pn = $('#panelMyPositions');
    if (!pn) return;
    pn.setAttribute('data-lcm-done', '1');
    pn.classList.add('lcm-on');
    pn.classList.add('lcmu-in');
    pn.style.setProperty('opacity', '1', 'important');
    pn.style.setProperty('transform', 'none', 'important');
  }

  function note(msg) {
    var h = host(); if (!h) return;
    reveal();
    h.node.innerHTML = '';
    if (h.kind === 'cards') {
      var d = el('div', null, msg);
      d.style.cssText = 'padding:22px 6px;text-align:center;opacity:.7';
      h.node.appendChild(d);
      return;
    }
    var tr = document.createElement('tr');
    var td = el('td', null, msg);
    td.colSpan = 7;
    td.style.cssText = 'padding:26px 14px;text-align:center;opacity:.7';
    tr.appendChild(td); h.node.appendChild(tr);
  }

  // The phone's card for one position. Same three figures as the table, in the design's own shape.
  function posCard(i, pos) {
    var a = el('a', 'pool-card my-pos');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(pos.account);

    var head = el('div', 'pc-head');
    var icons = el('div', 'pair-icons');
    icons.appendChild(disc('a', pos.a.name));
    icons.appendChild(disc('b', pos.b.name));
    head.appendChild(icons);
    var info = el('div', 'pc-info');
    info.appendChild(el('div', 'pc-name', pos.a.name + ' / ' + pos.b.name));
    // The design's line here is a deposit date, which the ledger does not record for a position.
    info.appendChild(el('div', 'pc-sub', 'AMM ' + pos.account.slice(0, 5) + '…' + pos.account.slice(-4)));
    head.appendChild(info);
    a.appendChild(head);

    var stats = el('div', 'pc-stats');
    function stat(label, v, sub) {
      var s = el('div', 'pc-stat');
      s.appendChild(el('div', 'l', label));
      s.appendChild(el('div', 'v', v));
      if (sub != null) s.appendChild(el('div', 'vs', sub));
      return s;
    }
    stats.appendChild(stat('Your liquidity', fmt(pos.a.amount * pos.share) + ' ' + pos.a.name,
      fmt(pos.b.amount * pos.share) + ' ' + pos.b.name));
    stats.appendChild(stat('Pool share', (pos.share * 100).toFixed(pos.share * 100 < 0.01 ? 4 : 3) + '%'));
    stats.appendChild(stat('Fees earned', '—', 'not on ledger'));
    a.appendChild(stats);

    var foot = el('div', 'pc-pos-row');
    var l = el('span', null, 'Tap to manage position');
    l.style.cssText = 'font-size:11.5px;color:var(--text-soft);font-weight:600';
    foot.appendChild(l);
    foot.appendChild(el('span', 'view-arrow', 'VIEW →'));
    a.appendChild(foot);
    return a;
  }

  function row(i, pos) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-lxmypool', pos.account);
    tr.style.cursor = 'pointer';

    tr.appendChild(el('td', 'idx', (i + 1 < 10 ? '0' : '') + (i + 1)));

    var pc = el('td');
    var cell = el('div', 'pair-cell');
    var icons = el('div', 'pair-icons');
    icons.appendChild(logo('pa', pos.a));
    icons.appendChild(logo('pb', pos.b));
    cell.appendChild(icons);
    // STELLAR'S ROW, READ OFF ITS OWN DOM RATHER THAN ITS SCREENSHOT (RAZA 2026-10-06: "Pools --> My
    // pools page is not the same as Stellar. I can spot so many differences").
    //
    // Loading lumoscore.com/pools/stellar against a real account with eight positions
    // (GAFKBYED…744H, found through Horizon's /accounts?liquidity_pool=) gives the exact markup:
    //
    //   td.idx         01
    //   td             .pair-cell > .pair-icons + the pair name, AND NOTHING ELSE
    //   td             <div>17.8 AQUA</div><div class="pair-sub">70,931 META</div>
    //   td             100.00%                       — bare text, no wrapper
    //   td.lx-viewcell <a class="lx-ammview">View position →</a>
    //
    // Three of those were different here, and the classes are what carry the typography: `.num` and
    // `.num-sub` are the All Pools table's, not this one's, and `.participants-cell` is a numeric
    // column borrowed for a button.
    //
    // THE "AMM r…" SUB-LINE GOES. It was written here because the design's second line is a category
    // ("Native - Utility") that this ledger has no equivalent for, and naming the AMM account was at
    // least true. But Stellar prints no second line at all, the account is already in the link this
    // row opens, and "exactly like Stellar" is the instruction.
    var meta = el('div');
    meta.appendChild(el('div', 'pair-name', pos.a.name + ' / ' + pos.b.name));
    cell.appendChild(meta);
    pc.appendChild(cell);
    tr.appendChild(pc);

    // Your liquidity: the pool's own reserves scaled by this account's share. Both sides, because a
    // position is two assets and naming one of them would be half the answer.
    var liq = el('td');
    liq.appendChild(el('div', null, fmt(pos.a.amount * pos.share) + ' ' + pos.a.name));
    liq.appendChild(el('div', 'pair-sub', fmt(pos.b.amount * pos.share) + ' ' + pos.b.name));
    tr.appendChild(liq);

    // AND THE SHARE IS STELLAR'S TWO DECIMALS, with "<0.01%" below that rather than more digits.
    // lumoscore.com prints "100.00%" and "<0.01%"; this printed "100.000%" and "0.0004%". Four decimals
    // on a share that small is precision about a rounding error — the point of the cell is that the
    // position is negligible, which is what the "<" says.
    var pct = pos.share * 100;
    tr.appendChild(el('td', null, pct > 0 && pct < 0.01 ? '<0.01%' : pct.toFixed(2) + '%'));

    var act = el('td', 'lx-viewcell');
    var a = document.createElement('a');
    a.href = '/pools/xrpl/id/' + encodeURIComponent(pos.account);
    a.className = 'lx-ammview';
    a.textContent = 'View position →';
    act.appendChild(a);
    tr.appendChild(act);

    return tr;
  }

  // AND THE COLUMNS ARE SIZED, NOT LEFT TO THE CONTENT ("Align it exactly like stellar").
  //
  // Removing the Actions header alone did not do it: measured at a 1540px viewport, this table put Your
  // Liquidity at 35.5% and Pool Share at 64.5%, against lumoscore.com's ~24% and ~38.5%. Nothing was
  // holding the first columns narrow, so the slack spread through them instead of collecting in the
  // unlabelled track on the right.
  //
  // Stellar pins them, and these are its own numbers, read off the live page's stylesheet:
  //
  //     th/td:nth-child(2) { white-space:nowrap; width:1px }   Pair, shrink-to-fit
  //     th/td:nth-child(3) { width:200px }                     Your Liquidity
  //     td:nth-child(4)    { width:130px }                     Pool Share
  //
  // THE FORK HAS NONE OF THEM, and the reason is worth recording: half of Stellar's rules are scoped
  // to `#lx-mypanel`, and this build's panel is `#panelMyPositions` — so even where the sheet came
  // across, the selector could never match. Scoped here to this build's id, which also keeps it off the
  // All Pools table that shares `table.pools`.
  // TEN RULES WERE ORPHANED, NOT ONE (RAZA 2026-10-06: "My pools section on pools main page is still
  // different on XRPL. wth is wrong." — after three passes that each moved one thing).
  //
  // Stellar scopes its whole My Pools stylesheet to `#lx-mypanel`, the panel ITS layer builds. This
  // build fills the design's `#panelMyPositions` instead, so every one of those rules is present in the
  // inherited sheet and matches nothing. Found by listing them rather than chasing symptoms:
  //
  //   #lx-mypanel td                              font-size 15px, JetBrains Mono
  //   #lx-mypanel .pair-name                      15.5px / 700, Hanken Grotesk
  //   #lx-mypanel .pair-sub                       12.5px
  //   #lx-mypanel td div:not(.pair-name):not(.pair-sub)   15px
  //   #lx-mypanel table.pools th/td:nth-child(2)  white-space:nowrap; width:1px
  //   #lx-mypanel table.pools th/td:nth-child(3)  width:200px
  //   #lx-mypanel table.pools th/td:nth-child(4)  width:130px
  //   #lx-mypanel table.pools .lx-viewcell        text-align:right !important + padding
  //   #lx-mypanel                                 opacity/visibility/animation overrides
  //
  // That last-but-one is the one in the screenshot: the "View position →" button sat at the LEFT edge
  // of an 782px-wide cell because `text-align:right` never applied. Measured: computed textAlign
  // "start" on a cell whose stylesheet plainly says right.
  //
  // So instead of hand-porting ten rules — and missing the eleventh Stellar adds next — the panel is
  // given the ancestor those selectors are written against. Every rule is a DESCENDANT selector, so one
  // wrapper satisfies all of them at once, now and later.
  //
  // SAFE BECAUSE NOTHING READS THE ID: grepped the built page for getElementById/querySelector on
  // `lx-mypanel` and for an existing element carrying it — zero of each. It is a CSS hook only, and
  // the design's own tab script keeps toggling `#panelMyPositions` inside it exactly as before.
  function stellarPanelHook() {
    if (document.getElementById('lx-mypanel')) return;
    var p = document.getElementById('panelMyPositions');
    if (!p || !p.parentNode) return;
    var w = document.createElement('div');
    w.id = 'lx-mypanel';
    p.parentNode.insertBefore(w, p);
    w.appendChild(p);
  }

  function load() {
    if (!host()) return;                                 // not a page with a positions list
    var me = addr();
    // THE WALLET RESTORES A MOMENT AFTER THE PAGE DOES (RAZA 2026-09-16: "When i open My pool from pools main page and then open
    // any pool page, then i go back, then it stops showing the count of my pools. I have 2 pools otherwise"). Coming back from
    // a pool, this ran before the address was readable and wrote a zero that nothing revisited. It now waits ~5s for a wallet
    // before saying there is none.
    if (!me) {
      if ((load.waits = (load.waits || 0) + 1) < 12) { setTimeout(load, 400); return; }
      note('Connect a wallet to see your liquidity positions.');
      setCount(0);
      return;
    }
    load.waits = 0;

    note('Reading your positions…');

    // allLines() pages account_lines through the rpc it is given and reads r.lines — it expects the ledger's
    // \`result\`. This file's rpc resolves the whole JSON-RPC envelope, so every page read as empty and My Pools
    // said "No liquidity positions" for an account holding three. Unwrapped here rather than changing rpc, which
    // the amm_info calls below read as the envelope.
    window.lxx.allLines(function (m, q) { return rpc(m, q).then(function (j) { return (j && j.result) || j; }); }, me)
      .then(function (r) {
        // allLines() returns { lines } — the shape wallet.js reads. Reading r.result.lines found nothing on every
        // account, which is why My Pools said "No liquidity positions" beside a wallet listing three
        // (RAZA 2026-09-15: "I do have a pool. Its showing up on Wallet page but not on Pools main page").
        var lines = (r && (r.lines || (r.result && r.result.lines))) || [];
        var lp = lines.filter(function (l) {
          return window.lxx.isLpToken(l.currency) && Number(l.balance) > 0;
        });
        if (!lp.length) { note('No liquidity positions on this account.'); setCount(0); return; }

        // One amm_info per pool. An account is in a handful of pools, not hundreds, so these run
        // together rather than through a queue.
        return Promise.all(lp.map(function (l) {
          return rpc('amm_info', { amm_account: l.account })
            .then(function (res) {
              var amm = res && res.result && res.result.amm;
              if (!amm) return null;
              var total = Number(amm.lp_token && amm.lp_token.value);
              var held = Number(l.balance);
              if (!isFinite(total) || total <= 0) return null;
              var a = side(amm.amount), b = side(amm.amount2);
              if (!a || !b) return null;
              return { account: l.account, a: a, b: b, held: held, share: held / total };
            })
            .catch(function () { return null; });
        })).then(function (all) {
          var pos = all.filter(Boolean).sort(function (x, y) { return y.share - x.share; });
          if (!pos.length) { note('No liquidity positions on this account.'); setCount(0); return; }
          var h = host(); if (!h) return;
          h.node.innerHTML = '';
          var make = h.kind === 'table' ? row : posCard;
          if (h.kind === 'table') {
            var tbl = h.node.closest && h.node.closest('table');
            // AND "ACTIONS" IS EMPTIED, NOT REMOVED (RAZA 2026-10-06: "remove Action from the right").
            //
            // Both get the word off the screen; only one matches the markup. lumoscore.com's own header,
            // read off its DOM, is FIVE cells — # / Pair / Your Liquidity / Pool Share / "" — the last
            // present and blank, holding the track the "View position →" button sits in. Removing it
            // instead leaves four headers over five body cells, which the browser is entitled to lay out
            // differently from a table whose columns are declared.
            //
            // Fees Earned and Deposited still GO: Stellar has no such columns at all, because neither
            // ledger records them per provider.
            if (tbl) [].forEach.call(tbl.querySelectorAll('thead th'), function (th) {
              var t = th.textContent || '';
              if (/fees earned|deposited/i.test(t) && th.parentNode) { th.parentNode.removeChild(th); return; }
              if (/actions/i.test(t)) { th.textContent = ''; th.removeAttribute('style'); }
            });
            stellarPanelHook();
          }
          for (var i = 0; i < pos.length; i++) h.node.appendChild(make(i, pos[i]));
          reveal();
          setCount(pos.length);
        });
      })
      .catch(function () {
        // actNotFound means the account has never been funded — not an error worth shouting about.
        note('Could not read your positions from the XRP Ledger.');
        setCount(0);
      });
  }

  // RAZA 2026-09-15, again: "[Still not showing] I do have a pool". The list was written once at page load; the design's tab
  // switch and a wallet that connects after load both left it holding nothing. It is re-read whenever My Pools is opened
  // without our rows in it, and when the wallet changes.
  // A position row opens its pool (RAZA 2026-09-16: "WHen clicking on my pool, it redirects to All pools tab"): the design's row
  // handler switched tabs; this is taken first.
  window.addEventListener('click', function (e) {
    var tr = e.target && e.target.closest && e.target.closest('#panelMyPositions tr[data-lxmypool], #panelMine [data-lxmypool]');
    if (!tr || (e.target.closest && e.target.closest('a[href]') && !e.target.closest('a.lx-ammview'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.location.href = '/pools/xrpl/id/' + encodeURIComponent(tr.getAttribute('data-lxmypool'));
  }, true);
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#poolTabs [data-tab="mine"], [data-tab="mine"]');
    if (!t) return;
    setTimeout(function () {
      reveal();
      var h = host();
      if (!h || !h.node.querySelector('a[href*="/pools/xrpl/id/"]')) load();
    }, 60);
  }, true);
  try { if (window.lxc && window.lxc.onChange) window.lxc.onChange(function () { setTimeout(load, 300); }); } catch (e) {}
  window.addEventListener('storage', function (e) { if (e && e.key === 'lumos.address') load(); });

  // Back from a pool page the browser can restore this one from its cache, when no script runs again at all.
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) { load.waits = 0; load(); } });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  window.__lxxMyPosReload = load;
})();

