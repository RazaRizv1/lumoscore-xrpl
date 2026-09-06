// Strip the Stellar issuance layer from the Launchpad and wire the XRP Ledger one.
//
// THE LAYER THIS REMOVES IS THE MOST DANGEROUS THING FOUND IN THE FORK. `lx-lp-js` is 69KB of live
// STELLAR MAINNET issuance sitting on three pages titled "Launch a Token on the XRP Ledger":
//
//     horizon:    "https://horizon.stellar.org"
//     passphrase: "Public Global Stellar Network ; September 2015"
//     feeCollector: "GAMZFXIJD5E3PNRFCG6VPXCJNUOZAP5BY2P3MU3ZXXUSVM2UY5P6LJKD"
//
// It generates a Stellar issuer keypair, funds it from the connected wallet, builds
// changeTrust/setOptions, and sends a real fee to a Stellar address. A user filling in this form
// would have paid, in real money, to mint an asset on a ledger the page never mentions.
//
// It cannot be left in place while the XRPL replacement is finished, so it goes now even though the
// signing half of the replacement is still blocked. A launchpad that says it cannot launch yet is
// strictly better than one that launches on the wrong chain.
const fs = require('fs');
const { read, getContents } = require(__dirname + '/lib.js');
const { stripById } = require(__dirname + '/stripscript.js');
const B = String.fromCharCode(92);

const crypto = require('crypto');

// THE FEE COLLECTOR, CHECKSUM-VERIFIED AT BUILD TIME.
//
// browser/xrpl-core.js checks address SHAPE only, and says so: verifying the trailing 4 bytes needs
// double-SHA256, which is async in a browser and would make every caller async to catch a typo a
// wallet cannot make. That reasoning covers addresses a WALLET hands back. It does not cover this
// one, which a human typed into a config -- and a single wrong character here sends every fee
// LumosCore ever collects to an address nobody holds the key to, permanently and silently.
//
// Node has synchronous SHA-256, so the full check runs here and the build fails rather than ships.
//
// Verified against the ledger on 2026-09-06: the account exists with 2.000012 XRP, and carries
// neither RequireDestTag (which would reject a fee payment sent without a tag), DisallowXRP,
// DepositAuth (which would reject unsolicited payments), nor GlobalFreeze. It holds no trust lines,
// so it can receive XRP and nothing else -- collecting a fee in an issued token would need one.
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
  const want = buf.subarray(21);
  const sha = (b) => crypto.createHash('sha256').update(b).digest();
  const got = sha(sha(body)).subarray(0, 4);
  if (!got.equals(want)) return 'CHECKSUM MISMATCH — this address contains a typo';
  return null;
}

const bad = checkAddress(FEE_COLLECTOR);
if (bad) {
  console.error('  fee collector ' + FEE_COLLECTOR + ': ' + bad);
  process.exit(1);
}

const ID = 'lx-xrplaunchpad';
let page = fs.readFileSync(__dirname + '/browser/launchpad.js', 'utf8');

// Injected rather than written into the browser file, so the address exists in exactly one place and
// that place is the one the checksum gate above guards.
if (page.indexOf('__FEE_COLLECTOR__') < 0) {
  console.error('  browser/launchpad.js has no __FEE_COLLECTOR__ placeholder — aborting');
  process.exit(1);
}
page = page.split('__FEE_COLLECTOR__').join(FEE_COLLECTOR);

if (page.indexOf('</' + 'script') >= 0) {
  console.error('  launchpad.js contains a closing script tag — aborting');
  process.exit(1);
}

const SCRIPT = '<script id="' + ID + '">\n' + page + '\n</' + 'script>';

// A launchpad page is one that carries the Stellar layer or the form it drove. Matching on the
// script id alone would miss the page once the layer is stripped, making the transform non-idempotent.
function isLaunchpad(h) {
  return h.indexOf('id="lx-lp-js"') >= 0
    || h.indexOf('id="tokenTicker"') >= 0
    || h.indexOf('lumos.launch.draft') >= 0;
}

let files = 0, pages = 0, stripped = 0;
for (const dev of ['desktop', 'mobile']) {
  const file = 'lumoscore-xrpl-' + dev + '.html';
  let data;
  try { data = read(file); } catch (e) { console.error('  ' + file + ': missing — skipped'); continue; }
  const { json, s, e } = getContents(data);
  files++;

  for (const key of Object.keys(json)) {
    if (typeof json[key] !== 'string') continue;
    let h = json[key];
    if (!isLaunchpad(h)) continue;

    const gone = stripById(h, 'lx-lp-js');
    h = gone.html;
    stripped += gone.removed;

    // `lx-lpticker` is the same layer's ticker-preview helper and reads its config from __lxLP,
    // which no longer exists once the block above is gone.
    h = stripById(h, 'lx-lpticker').html;

    h = stripById(h, ID).html;

    // STELLAR'S TICKER RULE, stated as fact under the ticker field. Stellar codes are 1-12
    // alphanumeric characters and the design narrowed that to "2-6 uppercase letters"; the XRP
    // Ledger's rule is different in both directions -- exactly 3 characters for a standard code, or
    // up to 20 carried as a 160-bit hex blob. A user following the old line would never learn why
    // a 2-character ticker is rejected, or that a 12-character one is fine.
    h = h.split('2-6 uppercase letters').join('3 characters, or up to 20');

    const bi = h.lastIndexOf('</' + 'body>');
    if (bi < 0) { console.error('  ' + key + ': no closing body — skipped'); continue; }
    json[key] = h.slice(0, bi) + SCRIPT + h.slice(bi);
    pages++;
  }

  const serialized = JSON.stringify(json).split('</').join('<' + B + '/');
  fs.writeFileSync(file, data.slice(0, s) + serialized + data.slice(e), 'utf8');
}

console.log('xrpl launchpad: injected on ' + pages + ' page key(s) across ' + files
  + ' container(s); stripped the Stellar issuance layer from ' + stripped);
if (!pages) console.error('  ! no page carried the launchpad — nothing was wired');
