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

// ---- balances ------------------------------------------------------------------------------------
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

const LXX = { XRP_DROPS, decodeCurrency, encodeCurrency, isLpToken, spendableXrp, readLines, isAddress };

// Dual environment on purpose: required by the tests in node, and injected verbatim into the page.
if (typeof module !== 'undefined' && module.exports) module.exports = LXX;
if (typeof window !== 'undefined') window.lxx = LXX;

})();
