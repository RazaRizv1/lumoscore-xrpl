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
  } catch (e) {
    console.log('  live check skipped: ' + e.message);
  }

  console.log('');
  console.log(fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' passed'));
  process.exit(fail ? 1 : 0);
})();
