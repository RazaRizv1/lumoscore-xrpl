// XLS-56 Batch — one wallet confirmation for what is currently several.
//
// The XRP Ledger has no multi-operation transaction the way Stellar does, so every LumosCore flow that
// needs more than one write has cost the user one signature per write: a swap is trust line + fee +
// swap, a bridge is transfer + fee, a launch is four prompts. BatchV1_1 activated on mainnet
// 2026-10-09 14:46 UTC (re-read off the Amendments object, not taken from an announcement) and lets a
// single signature carry up to eight inner transactions.
//
// WHAT THIS MODULE IS. A builder and a capability gate, nothing else. It does not decide that a flow
// should be batched -- each caller does that, because only the caller knows whether its steps can be
// built up front (see the data-dependency note below). It guarantees that IF a Batch is built, it is
// built to spec.
//
// THE CAPABILITY GATE IS THE WHOLE SAFETY STORY. Every wallet defaults to NOT capable, so the only
// thing that happens to an unproven wallet is nothing: the caller falls back to the multi-signature
// flow that works today. A wallet is switched on only after it has been shown to produce a Batch the
// ledger accepts -- not after it merely displayed a confirmation dialog, which proves only that it
// recognised the transaction type.
//
// WHY NOT try-and-fall-back: a wallet refusing an unknown transaction type and a user pressing reject
// are the same outcome through the same channel, and telling them apart means guessing. Guessing wrong
// means re-prompting somebody who just declined, three more times. A capability list is slower to roll
// out and never does that.
//
// WHAT CANNOT BE BATCHED, recorded here so it is not rediscovered: any sequence where a later step's
// CONTENTS depend on an earlier step's RESULT. The bridge's swap-then-bridge path is the live example
// -- its second leg is quoted against the first leg's `delivered_amount`, which a partial payment makes
// variable and which cannot be known before the swap executes. A Batch is signed up front, so batching
// that would mean guessing an amount, which is the bug the current code was written to avoid.
(function () {
  if (window.lxb) return;

  var INNER_FLAG = 0x40000000;        // tfInnerBatchTxn — mandatory on EVERY inner transaction
  var MIN_INNER = 2, MAX_INNER = 8;   // XLS-56; the ledger enforces both
  var RPC = 'https://xrplcluster.com/';
  var SDK = '/assets/vendor/xrpl-5.1.0.min.js';

  // Per-wallet, keyed on lxc.transport(). FALSE until proven against the ledger.
  //
  // `gem` is the admin payout signer and the one RAZA uses; `xaman` is what most holders use and is the
  // only wallet whose vendor has publicly claimed Batch support (4.5.0 release notes), which is a
  // reason to test it FIRST, not a reason to switch it on untested. Xaman also has an open bug where
  // signing as the OUTER account overwrites BatchSigners (XRPL-Labs/Xaman-Issue-Tracker#520, filed
  // 2026-10-06) — that is the multi-signer path and should not touch single-account batches like ours,
  // but it is exactly why "the vendor says it works" is not the bar here.
  // PROVEN 2026-10-12, by a Batch that landed rather than a dialog that appeared:
  //   xaman  TRUE  — Batch 0997E97A6D2F40B2301CD26254578C28325BFD665E3423F77859EE4AA7F4D88D,
  //                  ledger 107595056, tesSUCCESS, 2 inner AccountSets BOTH applied in that ledger.
  //   gem    FALSE — rendered the dialog correctly (type, Flags 65536, raw JSON, our manual fee) and
  //                  then refused it on submit: "Invalid field TransactionType: Batch". Its
  //                  serializer predates the amendment. THIS is why the bar is a landed transaction:
  //                  had the probe only been rejected at the dialog, GemWallet would have been
  //                  recorded as capable and every GemWallet swap would break at the last step.
  //   cross  FALSE — never probed. Nothing published either way.
  var CAPABLE = { gem: false, xaman: true, cross: false };

  function transport() {
    try { return (window.lxc && window.lxc.transport && window.lxc.transport()) || ''; } catch (e) { return ''; }
  }

  // A per-wallet override for testing, so a wallet can be exercised on a real device without shipping
  // it switched on for everyone. Deliberately not a single global flag: turning "batch" on everywhere
  // from one key is precisely the mistake this module exists to prevent.
  function override(t) {
    try {
      var v = localStorage.getItem('lumos.batch.' + t);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    return null;
  }

  function capable() {
    var t = transport();
    if (!t) return false;
    var o = override(t);
    if (o !== null) return o;
    return CAPABLE[t] === true;
  }

  // Why not, in words, for a console and for a bug report. A silent false is the hardest kind of
  // gate to debug six weeks later.
  function why() {
    var t = transport();
    if (!t) return 'no wallet connected';
    if (override(t) === true) return 'enabled for ' + t + ' by local override';
    if (override(t) === false) return 'disabled for ' + t + ' by local override';
    if (!(t in CAPABLE)) return 'unknown wallet "' + t + '" — never batched';
    return CAPABLE[t] ? 'enabled for ' + t : 'not yet proven for ' + t + ' — using the multi-signature flow';
  }

  // A LOADED xrpl IS NOT NECESSARILY ONE THAT KNOWS BATCH. Pages carry their own copy -- the Trade
  // page already had one when this was probed on staging 2026-10-12 -- and an older build has no
  // BatchFlags and no Batch in its validator. Taking `window.xrpl` on trust threw
  // "Cannot read properties of undefined (reading 'tfAllOrNothing')", which reads like a wallet
  // problem and is not one.
  //
  // So the capability is tested, not the presence: anything without BatchFlags is treated as absent
  // and our own vendored copy is loaded over it.
  function batchAware(x) { return !!(x && x.BatchFlags && x.BatchFlags.tfAllOrNothing && x.validate && x.encode); }
  function sdk() {
    if (batchAware(window.xrpl)) return Promise.resolve(window.xrpl);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = SDK;
      s.onload = function () {
        batchAware(window.xrpl)
          ? res(window.xrpl)
          : rej(new Error('the xrpl library on this page does not support Batch'));
      };
      s.onerror = function () { rej(new Error('xrpl library did not load')); };
      document.head.appendChild(s);
    });
  }

  // Every ledger read here goes through the shared retrying transport (xrpl-core: ledgerPost), so a
  // throttle is waited out instead of reported as a dead ledger. xrplcluster meters by units, not
  // requests, and one busy page can spend the quota on its own.
  //
  // It resolves with the same parsed envelope fetch().json() did, errors included, so the handling
  // below is unchanged. The fallback keeps the old behaviour exactly if lxx has not loaded.
  function lxpost(u, o) {
    try { return window.lxx.ledgerPost(u, o); }
    catch (e) { return fetch(u, o).then(function (r) { return r.json(); }); }
  }

  function rpc(method, params) {
    return lxpost(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (j) { return (j && j.result) || null; });
  }

  // WHAT THE LEDGER COSTS RIGHT NOW, not what it costs when it is quiet.
  //
  // This read `server_info.validated_ledger.base_fee_xrp` and called it "the network's base fee",
  // under a comment saying a hardcoded 10 drops would be wrong the moment the network escalates. The
  // value it read IS a hardcoded 10: `base_fee_xrp` is the REFERENCE fee and it does not move however
  // busy the ledger gets ([[reference-fee-is-not-the-fee]]). The load-scaled price lives in the `fee`
  // command — `drops.open_ledger_fee`, which sat at 5,020 on 2026-11-03, 502x the reference.
  //
  // And underpaying here is worse than being refused: a Batch below the open ledger fee is not
  // rejected, it is QUEUED, and it expires a minute or so later. It looks like it went through, and
  // every inner transaction it carried simply did not happen. mint.js was fixed for this on
  // 2026-11-03; this file was left because wallets still block Batch ([[xrpl-batch-wallet-support]]),
  // so it is the same arithmetic landing before the feature does, not a live failure.
  //
  // The floor, the budget and the refusal are mint.js's, deliberately — same ledger, same question,
  // and two different answers in one fork is how one of them silently rots.
  var FEE_FLOOR = 20;        // a quiet ledger
  var FEE_BUDGET = 12500;    // per unit of fee, as mint.js funds per transaction

  // NOTE the envelope: this file's rpc() already unwraps to `j.result`, so `drops` is one level up
  // from where mint.js reads it (`feeRes.result.drops` there, `feeRes.drops` here).
  function unitFee(feeRes) {
    var d = (feeRes && feeRes.drops) || {};
    var open = Number(d.open_ledger_fee);
    var min = Number(d.minimum_fee);
    var got = Math.max(isFinite(open) && open > 0 ? open : 0, isFinite(min) && min > 0 ? min : 0);
    // A FEE WE COULD NOT READ IS NOT A FEE OF 20. rpc() resolves null on a malformed answer rather
    // than throwing, so without this a failed read falls through to the floor and submits — which is
    // the queue-then-expire failure above, reached by a different door
    // ([[never-cache-a-failure-as-an-answer]]). FEE_FLOOR floors a reading, it does not replace one.
    if (!(got > 0)) throw new Error('Could not read the current XRP Ledger fee — nothing has been submitted.');
    var want = Math.max(got, FEE_FLOOR);
    if (want > FEE_BUDGET) {
      throw new Error('The XRP Ledger is unusually busy right now — ' + want + ' drops per transaction, '
        + 'against ' + FEE_FLOOR + ' normally. This has not been submitted; please try again in a few minutes.');
    }
    return want;
  }

  // The account's sequence, and what a transaction costs at this moment. Both are read rather than
  // assumed.
  function state(me) {
    return Promise.all([
      rpc('account_info', { account: me, ledger_index: 'validated' }),
      rpc('fee', {})
    ]).then(function (z) {
      var ai = z[0], fr = z[1];
      if (!ai || ai.error || !ai.account_data) {
        throw new Error('Could not read the account (' + ((ai && ai.error) || 'no answer') + ')');
      }
      return { seq: ai.account_data.Sequence, base: unitFee(fr) };
    });
  }

  // Build the outer Batch from plain inner transactions. Callers hand in ordinary transaction objects
  // -- {TransactionType, Account, ...} -- and everything XLS-56 requires is added here, because every
  // one of those requirements is a silent rejection if missed:
  //
  //   Fee "0"            the outer pays; a non-zero inner fee is invalid
  //   SigningPubKey ""   inner transactions are not independently signed
  //   TxnSignature       must be ABSENT, so it is deleted rather than left to the caller
  //   Sequence           explicit and consecutive; inner transactions consume sequence numbers
  //   Flags              tfInnerBatchTxn, without which the library itself refuses the Batch
  //
  // THE 2..8 RULE IS ENFORCED HERE BECAUSE NOTHING ELSE DOES IT FOR US. xrpl.validate() accepts both 1
  // and 9 inner transactions -- measured, not assumed -- so a round that batched nine recipients would
  // pass every local check and fail on-ledger.
  function build(me, inners, opts) {
    opts = opts || {};
    if (!me) return Promise.reject(new Error('no account'));
    if (!inners || inners.length < MIN_INNER) {
      return Promise.reject(new Error('a Batch needs at least ' + MIN_INNER + ' inner transactions'));
    }
    if (inners.length > MAX_INNER) {
      return Promise.reject(new Error('a Batch holds at most ' + MAX_INNER + ' inner transactions, got ' + inners.length));
    }
    return sdk().then(function (x) {
      return state(me).then(function (st) {
        var raws = inners.map(function (t, i) {
          var inner = {};
          for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) inner[k] = t[k];
          if (inner.Account && inner.Account !== me) {
            // Inner transactions from another account need BatchSigners, which needs
            // fixBatchInnerSigs — not enabled, and with no majority clock running. Refuse clearly
            // rather than build something the ledger will reject for a reason nobody will guess.
            throw new Error('every inner transaction must be signed by the connected account '
              + '(multi-account batches need fixBatchInnerSigs, which is not enabled)');
          }
          inner.Account = me;
          inner.Sequence = st.seq + 1 + i;
          inner.Fee = '0';
          inner.SigningPubKey = '';
          delete inner.TxnSignature;
          inner.Flags = (Number(inner.Flags) || 0) | INNER_FLAG;
          return { RawTransaction: inner };
        });

        // (signatures + 2) x the unit fee. For a single-signer Batch that is 2 x unit; the inner count
        // is added as headroom rather than as a requirement, which removes a whole class of
        // underpayment rejection.
        //
        // THE HEADROOM IS NO LONGER FREE, now that the unit is the live fee rather than a flat 10. On
        // a quiet ledger a full 8-inner Batch is 20 x 10 = 200 drops; at the FEE_BUDGET ceiling it is
        // 20 x 12,500 = 0.25 XRP, and unitFee() has already refused anything past that. Kept, because
        // a Batch is all-or-nothing and a queued one is the failure this whole file exists to avoid.
        var fee = String(st.base * (2 + raws.length));

        var tx = {
          TransactionType: 'Batch',
          Account: me,
          Flags: (opts.flags != null) ? opts.flags : x.BatchFlags.tfAllOrNothing,
          Sequence: st.seq,
          Fee: fee,
          RawTransactions: raws
        };
        if (opts.memos) tx.Memos = opts.memos;

        // Prove it is well-formed before a wallet ever sees it, so a wallet's refusal is a verdict on
        // Batch and not on something malformed we handed it.
        x.validate(tx);
        return tx;
      });
    });
  }

  function submit(me, inners, opts) {
    return build(me, inners, opts).then(function (tx) {
      if (!window.lxc || !window.lxc.submit) throw new Error('no wallet connected');
      return window.lxc.submit(tx);
    });
  }

  window.lxb = {
    capable: capable,
    why: why,
    max: function () { return MAX_INNER; },
    min: function () { return MIN_INNER; },
    build: build,
    submit: submit,
    INNER_FLAG: INNER_FLAG
  };
})();
