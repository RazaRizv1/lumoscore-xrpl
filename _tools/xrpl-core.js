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

// SHA-256, synchronously, in about forty lines.
//
// WHY NOT crypto.subtle: it is async, and isAddress() is called synchronously from twelve places —
// search-as-you-type, a paste handler, a row filter. Making it async would mean making those async
// too, which is a large change to hot paths for the sake of four bytes. WHY NOT the vendored
// xrpl.js: it is 1.1MB and only loaded on the pages that sign, while addresses are validated
// everywhere.
//
// Verified in xrpl-core.test.js against node's own crypto over random inputs of every length that
// crosses a block boundary, plus the two standard vectors. A hash that is subtly wrong here would
// reject every valid address and make the site unable to send at all, so it is tested against an
// implementation nobody doubts rather than against itself.
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

// Takes a byte array (b58decode returns a plain Array), returns a 32-byte Uint8Array.
function sha256(input) {
  const len = input.length;
  // Pad to a multiple of 64 with room for the 0x80 marker and an 8-byte length.
  const padded = new Uint8Array(((((len + 8) >> 6) + 1) << 6));
  padded.set(input);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bits = len * 8;
  dv.setUint32(padded.length - 8, Math.floor(bits / 4294967296));
  dv.setUint32(padded.length - 4, bits >>> 0);

  const H = [0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
             0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0];
  const w = new Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (((w[i - 16] + s0) | 0) + ((w[i - 7] + s1) | 0)) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (((((h + S1) | 0) + ch) | 0) + ((K256[i] + w[i]) | 0)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setInt32(i * 4, H[i]);
  return out;
}

// A CLASSIC XRPL ACCOUNT ADDRESS, shape AND checksum.
//
// IT USED TO BE SHAPE ONLY, and the reasoning written here was sound for the case it was written
// for: a wallet does not hand back a one-character typo of its own address, so checking the version
// byte was enough to reject a value of the wrong KIND — a Stellar 'G...' left in shared storage, an
// EVM '0x...', an X-address.
//
// That stopped being the whole story once this same function became the gate on a RECIPIENT that a
// human types or pastes (write.js parseDest). There, one wrong character is the common case and the
// consequence is a payment, so the threat model is not the same one the old comment described.
// RAZA 2026-10-16, after the send bug: "add the checksum".
//
// A bad checksum was never going to move funds — the ledger rejects it with actMalformed and the
// send is blocked either way. What it bought was a WRONG REASON: "Account malformed." from the node,
// several seconds and a round trip later, for what is a typo. Now it is caught in this browser,
// instantly, and parseDest's own sentence is the one the reader gets.
//
// The last four bytes are the first four of sha256(sha256(version + accountID)).
function isAddress(a) {
  if (typeof a !== 'string' || a.length < 25 || a.length > 35 || a[0] !== 'r') return false;
  const b = b58decode(a);
  if (!b || b.length !== 25 || b[0] !== 0) return false;   // 0x00 = the classic account-ID version
  const sum = sha256(sha256(b.slice(0, 21)));
  return sum[0] === b[21] && sum[1] === b[22] && sum[2] === b[23] && sum[3] === b[24];
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
  // `reserve && reserve.base` yields null for a null reserve, and Number(null) is 0 -- which is
  // FINITE, so the guard below waved it through and the function returned the whole balance as
  // spendable. The exact opposite of what the next line promises, and in the dangerous direction: it
  // offers money that is locked, so Max builds a transaction the ledger rejects for insufficient
  // reserve and the sender still pays the fee.
  //
  // Latent rather than live when found (2026-10-20): all three callers construct the object, and a
  // failed server_info leaves base/inc undefined, which is NaN and does trip the guard. Closed anyway
  // -- the contract is stated right here, and a future caller reading it would be entitled to rely on
  // it. Cannot affect a caller passing a valid reserve.
  if (!reserve || typeof reserve !== 'object') return null;
  const base = Number(reserve.base);
  const inc = Number(reserve.inc);
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

// EVERY trust line, following the ledger's `marker`. `account_lines` is PAGED, and every caller in
// this project asked for `limit: 400` and read page one as if it were the whole account.
//
// That is not a theoretical limit. Measured on a real mainnet LP provider
// (rhy6P75G3LA6FmPq2kNsiVkGCXsyKppk4h): **1,360 trust lines across 4 pages**, with its AMM LP token
// sitting on page TWO. The pool page therefore read `myLp: 0` and refused a withdrawal — "You hold 0
// LP tokens" — to an account that genuinely holds 75,141 of them. XRP Ledger accounts accumulate
// trust lines from airdrops and spam, so hundreds is ordinary and 400 is not a safe ceiling.
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

// THE LEDGER NAMES ITS OWN RETRY DELAY AND EVERY CALLER USED TO THROW IT AWAY.
//
// xrplcluster meters by UNITS, not requests -- "rate limit: units quota (2000 per 10s) exhausted,
// retry in ~8591ms" -- and one trade-asset page load spends 24 calls on it, so a reload or a second
// tab lands on the ceiling. Twenty-three browser scripts each grew their own rpc() and every one of
// them read that reply as a dead ledger. The visible result was the Orderbook panel keeping the
// design's Aptos mock under "Could not read the order book." for as long as the page stayed open
// (RAZA 2026-10-17). It looked token-specific and was not: LUMOS reproduces it once the quota is
// spent, which is why a single cold load never showed it.
//
// This owns the TRANSPORT and nothing else. It resolves with the parsed envelope exactly as
// fetch().then(r => r.json()) did -- error results included -- so the callers that map result.error
// ("actNotFound" -> unfunded), return null, return {}, or throw all keep their contracts untouched.
// The one difference: a throttle is waited out instead of reported as an answer.
//
// Deliberately narrow. Only an explicit throttle is retried; a network failure still rejects on the
// first attempt, because making genuine offline take three seconds to say so is its own bug.
const THROTTLED = /rate limit|too many|quota|slow down|try again|overloaded/i;

const WAIT_CAP = 10000;

// How long the ledger says to wait, or 0 when it did not say.
function quotedWait(msg) {
  const m = /retry in ~?(\d+)\s*ms/i.exec(String(msg || ''));
  return m ? Number(m[1]) + 250 : 0;
}

function retryAfter(msg) {
  // honour the interval the ledger quotes, capped so one long one cannot stall a page
  const w = quotedWait(msg);
  return w ? Math.min(w, WAIT_CAP) : 1500;
}

// ...AND DO NOT RETRY INTO A WAIT WE HAVE ALREADY DECIDED NOT TO HONOUR (RAZA 2026-10-24, on a
// THORChain send: "rate limit: units quota (10000 per 60s) exhausted, retry in ~28792ms").
//
// The cap above exists so one long throttle cannot stall a page, and that is right. What was wrong is
// what happened next: the wait was clamped from 28.8s to 10s and the call was retried ANYWAY — at a
// moment the ledger had just said would still be inside the quota. Every such retry is guaranteed to
// fail, and on a meter that counts UNITS rather than requests it spends more of the budget that is
// already exhausted, pushing the recovery further away.
//
// So a quote longer than the cap means stop, not hurry. The envelope is returned as the final answer
// and the caller reports it, which is both faster and cheaper than three doomed attempts.
function worthRetrying(msg) {
  return quotedWait(msg) <= WAIT_CAP;
}

// The same throttle in a sentence a reader can act on. Returns '' for anything that is not one, so a
// caller can use it as a test as well as a translation.
//
// This exists because the raw text reached a BUTTON. nibridge's say() writes the CTA's label, so
// "rate limit: units quota (10000 per 60s) exhausted, retry in ~28792ms" became the button — a
// paragraph of infrastructure jargon where the verb used to be, on the screen where someone is trying
// to send money. The seconds are kept because they are the one part the reader can use.
function ledgerBusyNote(msg) {
  const s = String((msg && msg.message) || msg || '');
  if (!THROTTLED.test(s)) return '';
  const w = quotedWait(s);
  return w ? ('Ledger busy — try again in ~' + Math.ceil(w / 1000) + 's')
    : 'Ledger busy — try again in a moment';
}

// ONE THROTTLE SILENCES EVERY CALLER UNTIL IT CLEARS (RAZA 2026-10-24: "why the hell does it say
// ledger busy try again in 42s").
//
// Because it was 42 seconds, and it was partly our own doing. xrplcluster meters by UNITS and the
// quota is per IP, so every tab and every layer draws on one budget. When it runs out, each caller
// discovers that SEPARATELY — and this transport retries twice — so a page that is already over
// quota immediately spends three times as much finding out, which pushes the recovery further away.
// A dozen components doing that in parallel is how a brief throttle turns into most of a minute.
//
// So the deadline the ledger names is remembered ONCE, here, and every call made before it passes is
// refused locally without touching the network. Nothing is retried into a closed window and nothing
// new is spent while it is shut. The ledger's own interval decides when it reopens; we never invent
// one, and a successful reply clears it immediately.
//
// This is the whole point of having a single transport. See [[xrplcluster-meters-units]].
let QUOTA_UNTIL = 0;

function quotaShut() { return QUOTA_UNTIL > Date.now(); }
function quotaLeft() { return Math.max(0, QUOTA_UNTIL - Date.now()); }
function noteQuota(msg) {
  const w = quotedWait(msg);
  if (w > 0) QUOTA_UNTIL = Math.max(QUOTA_UNTIL, Date.now() + w);
}

function ledgerPost(url, opts, tries) {
  tries = (tries == null) ? 2 : tries;

  // Refused before the fetch, not after it: a call made inside the window cannot succeed and would
  // only deepen the hole. The message carries the remaining seconds so the caller can say something
  // true, and ledgerBusyNote() turns it into the same sentence a real throttle reply produces.
  if (quotaShut()) {
    return Promise.reject(new Error('rate limit: units quota exhausted, retry in ~' + quotaLeft() + 'ms'));
  }
  const again = (wait) => new Promise((go) => setTimeout(go, wait))
    .then(() => ledgerPost(url, opts, tries - 1));

  // A timeout PER ATTEMPT, not for the whole call -- a caller who wrapped the lot in one budget
  // would have it eaten by the deliberate waiting between retries and abort a retry that was about
  // to succeed. A caller that brought its own signal keeps it (dashboard.js wants a whole-call
  // ceiling on purpose); otherwise a stalled socket is cut loose here so it cannot hang forever.
  let ctl = null, timer = null;
  const o = Object.assign({}, opts);
  if (!o.signal) {
    try {
      ctl = new AbortController();
      o.signal = ctl.signal;
      timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 12000);
    } catch (e) {}
  }
  const done = () => { if (timer) { clearTimeout(timer); timer = null; } };

  return fetch(url, o).then((r) => {
    done();
    // A throttle can arrive as a STATUS carrying a non-JSON body, where r.json() rejects with a
    // parse error that says nothing about why.
    if (tries && (r.status === 429 || r.status === 503)) return again(1500);
    return r.json().then((j) => {
      const res = j && j.result;
      const msg = res && (res.error_message || res.error);
      if (msg && THROTTLED.test(String(msg))) {
        // Recorded BEFORE deciding whether to retry, so even the attempt we are about to make shuts
        // the window for everybody else rather than racing them into it.
        noteQuota(msg);
        if (tries && worthRetrying(msg)) return again(retryAfter(msg));
      } else if (res) {
        QUOTA_UNTIL = 0;                 // a real answer means the budget is open again
      }
      noteLedger(res);
      return j;
    });
  }, (e) => { done(); throw e; });   // clear the timer on a rejected fetch too, or it leaks an abort
}

// WHERE THE LEDGER IS, LEARNED FOR FREE FROM READS WE ALREADY MAKE.
//
// Needed so a transaction can carry a LastLedgerSequence without the page first going and asking for
// one — see the stamp in connect.js's submit(). Almost every rippled response carries its ledger
// index, so this costs nothing: no extra call, no poll, no quota.
//
// Two names because rippled is not consistent about which it sends: `ledger_current_index` on reads
// against the open ledger, `ledger_index` on validated ones.
let LEDGER_SEQ = 0, LEDGER_AT = 0;
function noteLedger(res) {
  if (!res) return;
  const n = Number(res.ledger_current_index || res.ledger_index || 0);
  // Monotonic: a validated read is a few ledgers behind an open one, and taking the smaller of the
  // two would walk this backwards.
  if (n > LEDGER_SEQ) { LEDGER_SEQ = n; LEDGER_AT = Date.now(); }
}
// { seq, age } — age in ms since it was last seen, so a caller can refuse a stale one rather than
// stamping a deadline computed from a number nobody has checked in minutes.
function currentLedger() {
  return { seq: LEDGER_SEQ, age: LEDGER_SEQ ? (Date.now() - LEDGER_AT) : Infinity };
}

// ROUTE A PATH-FIND THROUGH OUR OWN EDGE, because the node this page can reach is 18x slower at it.
//
// Measured 2026-10-18 on the identical request (RLUSD -> XRP, an amount the account can fund):
// xrplcluster.com 29.1s, s2.ripple.com:51234 1.6s, both returning the same single alternative. Every
// caller's deadline is shorter than 29s, so the lookup always expired — which is what produced both
// "Finding the best route..." forever and the Custom Swap popup's "No route between those two assets
// right now". There IS a route; nobody waited long enough to see it.
//
// The fast node cannot be called from here (s2 answers `Failed to fetch` cross-origin), and
// xrplcluster cannot be called from a Worker (418). /lxapi/xrplpath is the only bridge between those
// two facts; see the long note in that file.
//
// FALLBACK IS THE OLD BEHAVIOUR, EXACTLY. `direct` is the caller's own rpc('ripple_path_find', …)
// thunk, so if the endpoint is missing, slow or refuses, this degrades to precisely what shipped
// before rather than to an error. Nothing here can make a swap quote worse than it already was.
//
// Returns the `result` object, the same thing a node's rpc() hands back, so callers read
// `.alternatives` without knowing which road it came by.
function pathFind(params, direct) {
  const fall = () => (typeof direct === 'function' ? direct() : Promise.reject(new Error('no route source')));
  let ctl = null, timer = null;
  const o = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params }) };
  try {
    ctl = new AbortController();
    o.signal = ctl.signal;
    // Comfortably past the 1.6s the fast node takes, far short of the 29s that caused this.
    timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 9000);
  } catch (e) {}
  const done = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return fetch('/lxapi/xrplpath', o).then((r) => {
    done();
    if (!r.ok) return fall();
    return r.json().then((j) => {
      if (!j || !j.ok || !j.result) return fall();
      return j.result;
    }, fall);
  }, () => { done(); return fall(); });
}

const LXX = { XRP_DROPS, decodeCurrency, encodeCurrency, isLpToken, spendableXrp, readLines, allLines, isAddress,
  ledgerPost, retryAfter, ledgerBusyNote,   // the retrying transport every browser rpc() now routes through
  pathFind,                                 // ripple_path_find via our edge; falls back to the caller's own rpc
  currentLedger,                            // where the ledger is, free, for stamping LastLedgerSequence
  sha256,                                   // exported so the tests can hold it against node's crypto
  simulateSwap,
  TEAM_WALLETS, isTeamWallet, excludeTeam,
  toDrops, amountFor, assetOf, minAfterSlippage, feeOf,
  iouValue, TF_SELL, offerFor,
  usdCached, usdSave, fetchUsd };

// Dual environment on purpose: required by the tests in node, and injected verbatim into the page.
if (typeof module !== 'undefined' && module.exports) module.exports = LXX;
if (typeof window !== 'undefined') window.lxx = LXX;

})();
