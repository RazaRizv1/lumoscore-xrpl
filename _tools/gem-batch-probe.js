(async () => {
  // GemWallet XLS-56 Batch probe. Paste into the console on lumoscore.com with GemWallet connected.
  //
  // THE BAR IS A LANDED TRANSACTION, NOT A DIALOG. On 2026-10-12 GemWallet rendered the Batch
  // correctly and then refused it at submit ("Invalid field TransactionType: Batch"). Had the probe
  // stopped at the dialog it would have been recorded capable, and every GemWallet swap would break
  // at the last step -- after the platform fee was already paid. So this checks the ledger.
  const log = (...a) => console.log('%c[gem-probe]', 'color:#e06c25;font-weight:700', ...a);

  const t = window.lxc && window.lxc.transport && window.lxc.transport();
  const me = window.lxc && window.lxc.address && window.lxc.address();
  if (t !== 'gem') return log('STOP: connected transport is "' + t + '", not "gem". Connect GemWallet first.');
  if (!me) return log('STOP: no address connected.');
  if (!window.lxb) return log('STOP: window.lxb missing — open a Trade page so the batch layer loads.');

  // Allow the batch path for THIS wallet only, and remember what it was so it can be put back.
  const KEY = 'lumos.batch.gem';
  const prev = localStorage.getItem(KEY);
  localStorage.setItem(KEY, '1');
  log('override set; lxb.capable() =', window.lxb.capable(), '|', window.lxb.why());

  const restore = () => {
    if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev);
    log('override restored to', prev === null ? '(unset)' : prev);
  };

  try {
    // Two no-ops. AccountSet with no fields changes nothing; the cost is the outer Batch fee.
    const inners = [
      { TransactionType: 'AccountSet', Account: me },
      { TransactionType: 'AccountSet', Account: me },
    ];
    log('submitting a 2-inner Batch — approve it in GemWallet…');
    const hash = await window.lxb.submit(me, inners);
    log('wallet returned hash:', hash);
    if (!hash) { restore(); return log('RESULT: FAIL — no hash returned (the wallet refused it).'); }

    // Now the only question that matters: did it land, and did BOTH inners apply?
    const rpc = async (body) => (await fetch('https://xrplcluster.com', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).json();

    let r = null;
    for (let i = 0; i < 12; i++) {
      await new Promise((s) => setTimeout(s, 2500));
      r = await rpc({ method: 'tx', params: [{ transaction: hash }] }).catch(() => null);
      const d = r && r.result;
      if (d && d.validated) break;
      log('…waiting for validation (' + (i + 1) + '/12)');
    }
    const d = r && r.result;
    if (!d || !d.validated) { restore(); return log('RESULT: INCONCLUSIVE — never saw it validated. Hash:', hash); }

    const code = d.meta && d.meta.TransactionResult;
    const type = d.tx_json ? d.tx_json.TransactionType : d.TransactionType;
    // XLS-56 records each inner's own result in the metadata.
    const inner = (d.meta && d.meta.BatchExecutions) || (d.meta && d.meta.InnerResults) || null;
    log('on-ledger:', { TransactionType: type, result: code, ledger: d.ledger_index, inner });

    if (type === 'Batch' && code === 'tesSUCCESS') {
      log('RESULT: PASS — a Batch landed from GemWallet.');
      log('Set CAPABLE.gem = true in _tools/browser/batch.js and record this hash:', hash);
    } else {
      log('RESULT: FAIL — landed as', type, code, '— not a successful Batch.');
    }
  } catch (e) {
    log('RESULT: FAIL —', (e && e.message) || e);
    log('If that reads "Invalid field TransactionType: Batch", GemWallet still has not shipped XLS-56.');
  } finally {
    restore();
  }
})();
