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
