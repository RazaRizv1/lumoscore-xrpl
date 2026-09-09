// The fee collector, and the only place its address is written down.
//
// It was duplicated across _xrplaunchpad.js and _xrpllisting.js, and the swap layer needed it too.
// Three copies of an address is three chances for one of them to be edited and the others not, and
// the failure is silent: fees go to an account nobody holds the key to and nothing reports it. One
// copy, verified once, imported everywhere.
//
// THE CHECK IS A FULL CHECKSUM, not a shape test. browser/xrpl-core.js deliberately checks shape only
// and explains why: verifying the trailing 4 bytes needs double-SHA256, which is async in a browser
// and would make every caller async to catch a typo a wallet cannot make. That reasoning covers
// addresses a WALLET hands back. It does not cover this one, which a human typed into a config, where
// a single wrong character permanently misdirects every fee LumosCore ever collects.
//
// Node has synchronous SHA-256, so the full check runs at build time and the build fails rather than
// ships. Verified against mainnet on 2026-09-06: the account exists, holds no trust lines (so it can
// receive XRP and nothing else), and carries neither RequireDestTag, DisallowXRP, DepositAuth nor
// GlobalFreeze — each of which would make it reject an unsolicited fee payment.
const crypto = require('crypto');

const FEE_COLLECTOR = 'rBDV4nwHzg5ByAYJtPWrbBZnuUXSUtFr94';
const B58 = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function checkAddress(a) {
  if (typeof a !== 'string' || a[0] !== 'r') return 'does not start with r';
  const bytes = [0];
  for (const ch of a) {
    const v = B58.indexOf(ch);
    if (v < 0) return 'character ' + JSON.stringify(ch) + ' is not in the XRPL alphabet';
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 255;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (let i = 0; i < a.length && a[i] === B58[0]; i++) bytes.push(0);
  const buf = Buffer.from(bytes.reverse());
  if (buf.length !== 25) return 'decodes to ' + buf.length + ' bytes, not 25';
  if (buf[0] !== 0) return 'version byte is ' + buf[0] + ', not 0';
  const body = buf.subarray(0, 21);
  const want = crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!want.equals(buf.subarray(21))) return 'checksum does not match — this address has a typo';
  return null;
}

// Substitutes the collector into a browser file and refuses if anything is off: a bad address, or a
// file that no longer carries the placeholder (which would ship a literal __LX_XRPL_COLLECTOR__ as a
// payment destination). Every caller goes through here so no caller can skip the check.
function injectCollector(src, whoami) {
  const bad = checkAddress(FEE_COLLECTOR);
  if (bad) {
    console.error('  FEE COLLECTOR REJECTED: ' + bad);
    console.error('  ' + FEE_COLLECTOR);
    process.exit(1);
  }
  if (src.indexOf('__LX_XRPL_COLLECTOR__') < 0) {
    console.error('  ' + (whoami || 'source') + ' no longer carries the collector placeholder — aborting');
    process.exit(1);
  }
  return src.split('__LX_XRPL_COLLECTOR__').join(FEE_COLLECTOR);
}

module.exports = { FEE_COLLECTOR, checkAddress, injectCollector };
