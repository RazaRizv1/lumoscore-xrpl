// Tests for xrpl-core, run against BOTH fixed vectors and a live mainnet account.
//
// The fixed vectors are the point: a self-consistent round trip would prove nothing, so the currency
// cases are real codes copied off the ledger, and the reserve case is arithmetic that can be checked
// by hand. The live section then confirms the same code survives real data, including the LP tokens
// and the issuer obligations that a naive reader gets wrong.
'use strict';
const C = require('./xrpl-core.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok ? '' : ('\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want))));
}

console.log('=== currency codes (real codes, taken off mainnet) ===');
eq('3-char standard',      C.decodeCurrency('CSC').display, 'CSC');
eq('XRP',                  C.decodeCurrency('XRP').display, 'XRP');
eq('hex ascii -> LUMOS',   C.decodeCurrency('4C554D4F53000000000000000000000000000000').display, 'LUMOS');
eq('hex ascii -> SCHWEPE', C.decodeCurrency('5343485745504500000000000000000000000000').display, 'SCHWEPE');
eq('AMM LP token',         C.decodeCurrency('0329E80F3800DA3C1A26528A2BB89F3FA1679417').kind, 'lp');
eq('LP is not rendered as text',
   /[^\x20-\x7E]/.test(C.decodeCurrency('03B7FD829F075C67B6C87A45FA0E67CF4E5A83A9').display), false);
eq('encode round trip',    C.encodeCurrency('LUMOS'), '4C554D4F53000000000000000000000000000000');
eq('encode leaves 3-char', C.encodeCurrency('CSC'), 'CSC');

console.log('');
console.log('=== limit orders (OfferCreate amounts, checkable by hand) ===');
// ARMY, as it appears on the ledger: 5-letter code in 40-hex form, and its real issuer.
const ARMY = { currency: '41524D5900000000000000000000000000000000', issuer: 'rGG3wQ4kUzd7Jnmk1n5NWPZjjut62kCBfC' };
// BUY 10 ARMY at 0.0052199 XRP each. 10 x 0.0052199 = 0.052199 XRP = 52,199 drops. The creator BUYS
// the token (TakerPays) and SELLS the XRP (TakerGets); no flags.
eq('buy: token is TakerPays, XRP drops are TakerGets', C.offerFor('buy', ARMY, 10, 0.0052199),
   { TakerGets: '52199', TakerPays: { currency: ARMY.currency, issuer: ARMY.issuer, value: '10' }, Flags: 0 });
// SELL 250 ARMY at 0.004. 250 x 0.004 = 1 XRP = 1,000,000 drops. tfSell so all 250 sell.
eq('sell: token is TakerGets, tfSell set', C.offerFor('sell', ARMY, 250, 0.004),
   { TakerGets: { currency: ARMY.currency, issuer: ARMY.issuer, value: '250' }, TakerPays: '1000000', Flags: 524288 });
eq('tfSell is the documented 0x00080000', C.TF_SELL, 524288);
// 3 x 0.1 is 0.30000000000000004 in floating point; truncating would place the order one drop short.
eq('XRP side rounded, not truncated', C.offerFor('buy', ARMY, 3, 0.1).TakerGets, '300000');
eq('refuses a zero price',            C.offerFor('buy', ARMY, 10, 0), null);
eq('refuses a negative amount',       C.offerFor('sell', ARMY, -1, 0.004), null);
eq('refuses a non-number',            C.offerFor('buy', ARMY, 'abc', 0.004), null);
eq('refuses an unknown side',         C.offerFor('short', ARMY, 10, 0.004), null);
eq('refuses a token with no issuer',  C.offerFor('buy', { currency: ARMY.currency }, 10, 0.004), null);
eq('refuses XRP on the token side',   C.offerFor('buy', { currency: 'XRP', issuer: ARMY.issuer }, 10, 0.004), null);
// 0.0001 x 0.001 = 0.0000001 XRP = a tenth of a drop, which rounds to 0 and the ledger rejects (temBAD_OFFER).
eq('refuses an order under half a drop', C.offerFor('buy', ARMY, 0.0001, 0.001), null);
eq('token value never in exponent form', C.iouValue(0.0000001), '0.0000001');
eq('token value capped at 15 significant digits', C.iouValue(123456789.123456789), '123456789.123457');
eq('token value drops float noise and trailing zeros', C.iouValue(0.1 + 0.2), '0.3');
eq('large token value stays plain digits', C.iouValue(1e21), '1000000000000000000000');
eq('token value refuses zero', C.iouValue(0), null);

console.log('');
console.log('=== reserves (arithmetic that can be checked by hand) ===');
// 375.382386 XRP, 104 owned objects, base 1 + 0.2 each = 21.8 reserved
eq('spendable', C.spendableXrp(375382386, 104, { base: 1, inc: 0.2 }),
   { balance: 375.382386, reserved: 21.8, spendable: 353.582386 });
eq('never negative', C.spendableXrp(1000000, 50, { base: 1, inc: 0.2 }).spendable, 0);
eq('unknown reserve says so, does not guess', C.spendableXrp(1000000, 5, {}), null);
eq('OLD reserves would have overstated by',
   +(C.spendableXrp(375382386, 104, { base: 1, inc: 0.2 }).spendable
     - C.spendableXrp(375382386, 104, { base: 10, inc: 2 }).spendable).toFixed(6), 196.2);

console.log('');
console.log('=== injected twice (this file ships in TWO script blocks) ===');
// _xrplconnect and _xrplwallet each inject this file, so a page can hold two copies in the same
// global scope. Top-level `const` made that a redeclaration error, which killed the entire second
// <script> -- the wallet layer with it -- and the page fell back to the design's mock table: five
// invented rows with believable prices and no visible fault. Shipped once. This is the guard.
{
  const src = require('fs').readFileSync(__dirname + '/xrpl-core.js', 'utf8');
  let err = null;
  try {
    // Exactly what the browser does: one scope, the source concatenated with itself.
    new Function('window', 'module', src + '\n' + src)({}, undefined);
  } catch (e) { err = e.message; }
  eq('two copies in one scope do not throw', err, null);
  eq('...and it is really the double that is tested', /XRP_DROPS/.test(src), true);
}

console.log('');
console.log('=== addresses (real accounts, and real values of the WRONG kind) ===');
// Accepts: every one of these is an account that exists on mainnet today.
eq('holder account',   C.isAddress('rhxjPUUPwxLJxT68bhS2GqPyPonFNNiymV'), true);
eq('LUMOS issuer',     C.isAddress('rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha'), true);
eq('second issuer',    C.isAddress('rK58zTa7AzU9T4mMySJoT13KPDxLuMYLNw'), true);
eq('ACCOUNT_ZERO',     C.isAddress('rrrrrrrrrrrrrrrrrrrrrhoLvTp'), true);

// Rejects. The first two are the ones that matter: the Stellar build shares the lumos.address key,
// so a leftover G-address is a value that really can arrive here.
eq('Stellar G-address', C.isAddress('GCKFBEIYTKP6RCZX6LRWLKCVMHVRYVNTQJRVHPHPYQPRRPBUFRPT7NNM'), false);
eq('EVM 0x address',    C.isAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F'), false);
eq('empty string',      C.isAddress(''), false);
eq('null',              C.isAddress(null), false);
eq('X-address (not classic)', C.isAddress('X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ'), false);
eq('truncated',         C.isAddress('rhxjPUUPwxLJxT68bhS2GqPyPonFNNiym'), false);
eq('one char too many', C.isAddress('rhxjPUUPwxLJxT68bhS2GqPyPonFNNiymVX'), false);
// Characters that exist in Bitcoin's base58 but NOT in the XRPL alphabet. If this ever passes, the
// decoder is using the wrong alphabet -- which would not throw, it would just produce other bytes.
eq('bitcoin-alphabet char rejected', C.isAddress('rhxjPUUPwxLJxT68bhS2GqPyPonFNNiym0'), false);

console.log('');
console.log('=== team wallets (excluded from reward maths) ===');
// A mistyped address here does not throw -- it silently stops excluding a treasury wallet, or
// excludes a real holder. Both are payout errors nobody would notice. So every entry must at least
// be a structurally valid address, and the live section below checks them against the ledger.
eq('all seven are valid addresses',
   C.TEAM_WALLETS.filter((a) => C.isAddress(a)).length, 7);
eq('no duplicates', new Set(C.TEAM_WALLETS).size, 7);
eq('recognises a team wallet', C.isTeamWallet('rHuF5XcfA6izw3DhPuZZ5M2z1Vt5ozoQpN'), true);
eq('does not recognise a holder', C.isTeamWallet('rhxjPUUPwxLJxT68bhS2GqPyPonFNNiymV'), false);
eq('does not recognise the issuer', C.isTeamWallet('rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha'), false);
{
  const split = C.excludeTeam([
    { account: 'rHuF5XcfA6izw3DhPuZZ5M2z1Vt5ozoQpN', balance: 320800000 },
    { account: 'rhxjPUUPwxLJxT68bhS2GqPyPonFNNiymV', balance: 389122 },
    { account: 'rUdnkuyMpDoSfeSko4Y5Pg6Do9mUh8X1tY', balance: 41700000 },
  ]);
  eq('excludeTeam keeps real holders', split.kept.length, 1);
  eq('excludeTeam removes team wallets', split.removed.length, 2);
}

console.log('');
console.log('=== balances ===');
const r = C.readLines([
  { currency: 'CSC', account: 'rCSC', balance: '809.42' },
  { currency: '4C554D4F53000000000000000000000000000000', account: 'rsPq', balance: '389122.54' },
  { currency: '0329E80F3800DA3C1A26528A2BB89F3FA1679417', account: 'rAMM', balance: '12.5' },
  { currency: '4C554D4F53000000000000000000000000000000', account: 'rIssuer', balance: '-999955352.9' },
]);
eq('held excludes LP and obligations', r.held.map(h => h.display), ['CSC', 'LUMOS']);
eq('pool shares separated', r.pools.length, 1);
eq('issuer obligation not a holding', r.obligations.length, 1);

// ---- amounts -------------------------------------------------------------------------------------
// The arithmetic that decides how much money a transaction moves. Every case here is one that would
// have shipped a wrong number, not a wrong type — a bad amount is accepted by the ledger.
console.log('');
console.log('=== amounts (what a transaction actually carries) ===');

eq('1 XRP is a drops STRING',        C.toDrops(1), '1000000');
eq('drops are integers',             C.toDrops(0.0000015), '2');
// The float case. 0.1 + 0.2 === 0.30000000000000004, and truncating shaves a drop off the amount the
// user typed — the difference between the number on screen and the number submitted.
eq('rounds rather than truncates',   C.toDrops(0.1 + 0.2), '300000');
eq('a whole balance survives',       C.toDrops(15.573581), '15573581');
eq('zero is legal',                  C.toDrops(0), '0');
eq('negative is refused',            C.toDrops(-1), null);
eq('NaN is refused',                 C.toDrops('abc'), null);
eq('Infinity is refused',            C.toDrops(Infinity), null);
// Never exponent notation: "1e+21" is not a drops string the ledger will take.
eq('no exponent form in output',     /e/i.test(C.toDrops(1e14) || ''), false);
// The safe-integer ceiling, and it is a REFUSAL rather than a wrong number. 9e9 XRP is 9e15 drops,
// just inside Number's exact-integer range; 1e13 XRP is 1e19 drops, past it, where arithmetic stops
// being exact. Returning null there is the right failure — the alternative is a plausible-looking
// amount that is quietly wrong, which is the one outcome this whole file exists to prevent.
//
// (Written the other way round at first, asserting a value for the unsafe case. The code was right
// and the expectation was nonsense.)
eq('at the safe ceiling',            C.toDrops(9e9), '9000000000000000');
eq('past it, refuses',               C.toDrops(1e13), null);

eq('XRP amount is a string',         C.amountFor('XRP', 2.5), '2500000');
eq('issued amount is an object',
   C.amountFor({ currency: 'USD', issuer: 'rIss' }, 10),
   { currency: 'USD', issuer: 'rIss', value: '10' });
eq('issued needs an issuer',         C.amountFor({ currency: 'USD' }, 10), null);
eq('issued refuses a bad value',     C.amountFor({ currency: 'USD', issuer: 'rIss' }, -3), null);

eq('assetOf on drops is native',     C.assetOf('1000000'), { currency: 'XRP' });
eq('assetOf keeps issuer, drops value',
   C.assetOf({ currency: 'USD', issuer: 'rIss', value: '5' }),
   { currency: 'USD', issuer: 'rIss' });

// Slippage floor: what a swap must deliver or fail. Checked by hand — 100 less 0.5% is 99.5.
eq('0.5% slippage floor',            C.minAfterSlippage(100, 0.005), 99.5);
eq('zero slippage is exact',         C.minAfterSlippage(100, 0), 100);
eq('slippage of 1 refused',          C.minAfterSlippage(100, 1), null);   // would accept nothing
eq('slippage cannot be negative',    C.minAfterSlippage(100, -0.1), null);

// The fee tiers from the fee memory: 0.2%, or 0.1% for holders of 250k LUMOS.
eq('0.2% of 5 XRP',                  C.feeOf(5, 0.002), 0.01);
eq('0.1% of 5 XRP',                  C.feeOf(5, 0.001), 0.005);
eq('no fee on a zero amount',        C.feeOf(0, 0.002), 0);
eq('no fee at a zero rate',          C.feeOf(5, 0), 0);

// ---- live ----------------------------------------------------------------------------------------
(async () => {
  console.log('');
  console.log('=== live mainnet ===');
  const rpc = (method, params) => fetch('https://xrplcluster.com/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  }).then((r) => r.json()).then((j) => j.result);

  try {
    const A = 'rhxjPUUPwxLJxT68bhS2GqPyPonFNNiymV';
    const info = await rpc('server_info', {});
    const v = info.info.validated_ledger;
    const reserve = { base: v.reserve_base_xrp, inc: v.reserve_inc_xrp };
    const acct = await rpc('account_info', { account: A, ledger_index: 'validated' });
    const lines = await rpc('account_lines', { account: A, limit: 400, ledger_index: 'validated' });

    const s = C.spendableXrp(acct.account_data.Balance, acct.account_data.OwnerCount, reserve);
    const b = C.readLines(lines.lines);

    console.log('  reserve from ledger .... base ' + reserve.base + ' / inc ' + reserve.inc);
    console.log('  XRP balance ............ ' + s.balance.toFixed(6));
    console.log('  reserved ............... ' + s.reserved.toFixed(2) + ' (OwnerCount ' + acct.account_data.OwnerCount + ')');
    console.log('  spendable .............. ' + s.spendable.toFixed(6));
    console.log('  tokens held ............ ' + b.held.length);
    console.log('  pool shares ............ ' + b.pools.length);
    const junk = b.held.filter((h) => /[^\x20-\x7E]/.test(h.display));
    console.log('  unreadable names ....... ' + junk.length + (junk.length ? '  <-- FAIL' : '  (none)'));
    if (junk.length) fail++; else pass++;
    console.log('  sample ................. ' + b.held.slice(0, 6).map((h) => h.display).join(', '));

    // The team wallets are checked against the LEDGER, not just against themselves. Every one must
    // still be a funded account holding LUMOS -- if one were mistyped it would resolve to nothing,
    // and the only symptom in production would be a treasury wallet quietly earning rewards.
    const LUMOS_ISS = 'rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha';
    const LUMOS_CUR = C.encodeCurrency('LUMOS');
    let holdsLumos = 0, notFound = 0;
    for (const w of C.TEAM_WALLETS) {
      const lines = await rpc('account_lines', { account: w, limit: 400, ledger_index: 'validated' });
      if (!lines || lines.error) { notFound++; continue; }
      const has = (lines.lines || []).some((l) =>
        l.currency === LUMOS_CUR && l.account === LUMOS_ISS && Number(l.balance) > 0);
      if (has) holdsLumos++;
    }
    console.log('');
    console.log('  team wallets on ledger . ' + holdsLumos + '/' + C.TEAM_WALLETS.length
      + ' hold LUMOS' + (notFound ? ('   ' + notFound + ' NOT FOUND') : ''));
    if (holdsLumos === C.TEAM_WALLETS.length) pass++; else fail++;
  } catch (e) {
    console.log('  live check skipped: ' + e.message);
  }

  console.log('');
  console.log(fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' passed'));
  process.exit(fail ? 1 : 0);
})();
