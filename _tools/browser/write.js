// Signed transactions: Receive QR, Send, and Cancel order.
//
// Everything else on this build READS the ledger. This is the first layer that asks the user's wallet
// to sign something, which changes what a bug costs: a read that goes wrong shows a wrong number, a
// write that goes wrong moves someone's money to the wrong place and cannot be undone.
//
// So the rules here are stricter than elsewhere in this project:
//
//   * NOTHING IS SUBMITTED THAT HAS NOT BEEN CHECKED AGAINST THE LEDGER FIRST. Every failure mode
//     below was chosen because the transaction would otherwise be signed by the user, succeed or fail
//     on-chain, and cost a real fee or real funds to learn what this code could have known for free.
//   * The design's own modals are used exactly as they ship. No new dialog, no new field, no new
//     page — the amount input, the recipient input, the asset button and the confirm button are all
//     the design's, and only their behaviour is added.
//   * Amounts are built from the ledger's own units (drops, issued-currency objects), never from the
//     formatted strings on screen.
//
// Signing goes through window.lxc.submit(tx), which refuses rather than guesses when the stored
// connection has no transport. That refusal is deliberate and is not worked around here.
(function () {
  if (window.__lxxWrite) return;
  window.__lxxWrite = 1;

  var RPC = 'https://xrplcluster.com/';
  var DROP = 1000000;
  // Substituted at build time by _tools/xrpladdr.js, which checksum-verifies it and refuses to build
  // if this placeholder is ever removed — shipping the literal string as a payment destination would
  // be a transaction that cannot be signed, or worse, one that can.
  var COLLECTOR = '__LX_XRPL_COLLECTOR__';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }

  function addr() {
    try { return localStorage.getItem('lumos.address') || ''; } catch (e) { return ''; }
  }

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = Number(n).toFixed(dp == null ? 6 : dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }

  function short(a) { return a && a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : (a || ''); }

  function rpc(method, params) {
    return fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, params: [params || {}] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var res = j && j.result;
      if (!res || res.error) throw new Error((res && (res.error_message || res.error)) || 'ledger unavailable');
      return res;
    });
  }

  // The logo layer claims any element holding one to five characters and empties it. data-logoed is
  // its own skip marker. Same helper as wallet.js, for the same reason.
  function plain(e, text) {
    try {
      e.removeAttribute('data-logo');
      e.style.background = '';
      e.style.backgroundImage = '';
      e.setAttribute('data-logoed', '1');
    } catch (_) {}
    e.textContent = text;
  }

  // ---- Receive QR ----------------------------------------------------------------------------------
  // The design ships a hand-drawn SVG under a comment that says "Faux QR pattern (decorative)". It is
  // a picture of a QR code: it encodes nothing, and it sits directly above the correct address on the
  // one screen whose entire purpose is telling somebody where to send money. A person who scans it
  // gets garbage, and the only reason that is not worse is that no wallet will parse it as an address.
  //
  // Replaced with a real one. The renderer is the Stellar build's, unchanged, because it is already
  // the corrected version — an earlier attempt there shipped unscannable and the two fixes are both
  // load-bearing and both invisible if you only look at it:
  //
  //   width/height 1.04 rather than 1 — at 1 the modules meet exactly on a pixel boundary and the
  //   renderer's antialiasing leaves a pale seam between every pair, which reads as noise to a decoder.
  //
  //   fill dark on an explicitly white background — QR polarity is not a style choice. Inverted, it is
  //   not a low-contrast QR code, it is not a QR code, and it fails silently on every scanner.
  //
  // The error-correction ladder tries the densest levels first so the code stays small; addData throws
  // when the data will not fit the requested version, hence the try/catch walk rather than a guess.
  function makeQR(txt) {
    var lv = [[0, 'H'], [0, 'Q'], [8, 'H'], [10, 'H'], [0, 'M'], [4, 'M']];
    for (var i = 0; i < lv.length; i++) {
      try {
        var q = window.qrcode(lv[i][0], lv[i][1]);
        q.addData(txt);
        q.make();
        return q;
      } catch (e) {}
    }
    return null;
  }

  // EVERY frame, not the first one. The page ships TWO complete sets of modals — the desktop set, and
  // a second set inside #lx-mobmodals that is the one a phone actually shows. querySelector returns
  // the desktop copy, so painting "the" QR left the phone's untouched. Same trap as the duplicated
  // .section-heading .meta, and the reason nothing below uses a singular lookup either.
  function paintQR() {
    try {
      if (!window.qrcode) return;
      var me = addr();
      if (!me) return;
      var q = null;
      $$('.qr-frame svg, .qr-display svg').forEach(function (fr) {
        if (fr.getAttribute('data-lxqr') === me) return;         // keyed on the address, so it
        q = q || makeQR(me);                                     // repaints if the wallet changes
        if (!q) return;
        var n = q.getModuleCount(), s = '';
        for (var r = 0; r < n; r++) {
          for (var c = 0; c < n; c++) {
            if (q.isDark(r, c)) s += '<rect x="' + c + '" y="' + r + '" width="1.04" height="1.04"></rect>';
          }
        }
        fr.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
        fr.setAttribute('fill', '#0d1117');
        fr.style.background = '#fff';
        fr.innerHTML = s;
        fr.setAttribute('data-lxqr', me);
        fr.classList.add('lx-qr-ready');
        // AND THEN IT WAS STILL INVISIBLE — a correct, decodable, 551-module QR rendering as a plain
        // white square. The orphaned Stellar stylesheet carries
        //     .qr-display .qr-frame svg, .qr-display canvas, .qr-display img { visibility:hidden!important }
        // which hides the design's faux QR until a data layer supplies a real one. Its companion rule,
        //     .lx-rc-qrwrap .qr-frame svg:not(.lx-qr-ready) { visibility:hidden }
        // shows that the intended escape was for Stellar's layer to REBUILD the receive body inside its
        // own .lx-rc-qrwrap — so within .qr-display there is no escape at all: the rule is unconditional
        // and !important, and adding .lx-qr-ready does nothing against it.
        //
        // Rebuilding the modal to dodge a stylesheet would be changing the design to work around a rule
        // belonging to a layer that is gone. Lifting the gate on the one element now holding real data
        // is smaller and says what it means. An inline !important is what outranks a sheet !important.
        fr.style.setProperty('visibility', 'visible', 'important');
      });
    } catch (e) {}
  }

  // THE RECEIVE SCREEN WAS TELLING PEOPLE THE WRONG ADDRESS, ON THE WRONG CHAIN.
  //
  // On a phone it read, in full: a QR, the label "Your Aptos address", the address
  // GA7K5N4M2X9P3R8Q1L6T2V8W4Y7Z3A5B8C2D6E1F4G7H9J2K5N4M2 — a Stellar-shaped string from the design
  // mock, belonging to nobody — and under it "Only send APT and Aptos-based assets to this address.
  // Sending assets from other networks will result in loss of funds."
  //
  // The data-copy attribute beside it held the RIGHT address the whole time, so the Copy button worked
  // and only the visible text was wrong. That is the worst possible split: anyone who copied was fine,
  // anyone who read the screen — or photographed it, or typed it out — sent funds into nothing. It is
  // also why no DOM check caught it; every probe I ran read data-copy and came back correct.
  //
  // Stellar's wallet layer used to rewrite this text (matching the same GA7K5N4M prefix). Stripping
  // that layer took the correction with it and left the mock, which is the general hazard recorded in
  // the stripped-layer notes: the CSS and the markup stay, only the fix leaves.
  function fixReceive() {
    var me = addr();
    if (!me) return;

    // The address line. Keyed on data-copy where the design provides it — that attribute is the
    // design's own statement of which element holds the address — and otherwise on the mock's shape.
    $$('.qr-addr, [data-copy]').forEach(function (e) {
      var t = (e.textContent || '').trim();
      if (!t || t === me) return;
      var looksLikeAddr = /^[Gr][A-Za-z0-9]{24,}$/.test(t);
      if (!looksLikeAddr) return;                                // never touch a button's label
      e.textContent = me;
      if (e.hasAttribute('data-copy')) e.setAttribute('data-copy', me);
    });

    $$('.qr-label').forEach(function (e) {
      if (/aptos|stellar/i.test(e.textContent || '')) e.textContent = 'Your XRP Ledger address';
    });

    // The warning is the most important sentence on the screen and it named the wrong chain twice.
    // Rewritten as text, on the element that holds it, so the design's box and accent styling stay.
    $$('.modal-body div, .lx-recv-note, .lt-hint').forEach(function (e) {
      if (e.__lxwarn) return;
      var t = e.textContent || '';
      if (!/Only send/i.test(t) || !/APT|Aptos/.test(t)) return;
      e.__lxwarn = 1;
      [].forEach.call(e.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/Only send APT and Aptos-based assets/i, 'Only send XRP and XRP Ledger assets')
          .replace(/\bAptos-based\b/gi, 'XRP Ledger')
          .replace(/\bAPT\b/g, 'XRP')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
    });
  }

  // ---- shared: the connected account's holdings ----------------------------------------------------
  // wallet.js publishes these. Reading its object rather than re-fetching keeps one answer about what
  // is held and what is spendable, so Send can never offer an amount the balance list disagrees with.
  function held() {
    var d = window.__lxxData;
    if (!d) return [];
    var out = [];
    if (d.xrp) {
      out.push({
        code: 'XRP', issuer: null, currency: null,
        balance: d.xrp.balance, spendable: d.xrp.spendable
      });
    }
    (d.held || []).forEach(function (t) {
      out.push({
        code: t.display, issuer: t.issuer, currency: t.currency,
        balance: t.balance, spendable: t.balance, frozen: t.frozen
      });
    });
    return out;
  }

  // ---- Send ----------------------------------------------------------------------------------------
  var sendPick = null;                                          // the asset currently selected

  function sendModal() { return $('#modalSend'); }

  function setSendAsset(a) {
    var m = sendModal();
    if (!m || !a) return;
    sendPick = a;

    var btn = $('.asset-pick', m);
    if (btn) {
      // The button holds an icon span, the ticker as a bare text node, and a chevron svg. Only the
      // text node is replaced: rewriting the button would take the design's icon and chevron with it.
      var ico = $('.a-ico', btn);
      if (ico) plain(ico, a.code.charAt(0).toUpperCase());
      [].forEach.call(btn.childNodes, function (nd) {
        if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
      });
    }

    var bal = $('.field-meta strong', m);
    // "Balance" here means what can actually be sent. For XRP that is the balance MINUS the reserve,
    // which is not a detail: the design shipped this row reading 25,420.18 APT, and a Max button that
    // offers the full balance of an XRP account builds a transaction the ledger always rejects.
    if (bal) bal.textContent = fmt(a.spendable, 6) + ' ' + a.code;

    var fee = $('.modal-body strong[style*="JetBrains"]', m);
    if (fee) fee.textContent = '~0.000012 XRP';
    say('');
  }

  // The asset menu. Built from the design's own field styling and anchored under the picker button,
  // because the design ships a button with a chevron and no menu behind it.
  function openAssetMenu(btn) {
    var m = sendModal();
    if (!m) return;
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }        // second click closes

    var list = held().filter(function (a) { return a.spendable > 0 && !a.frozen; });
    if (!list.length) return;

    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:210px;'
      + 'max-height:260px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'lxw-astrow';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      plain(ic, a.code.charAt(0).toUpperCase());
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      var bl = document.createElement('span');
      bl.style.cssText = 'opacity:.7;font-size:12px';
      bl.textContent = fmt(a.spendable, 4);
      row.appendChild(ic); row.appendChild(nm); row.appendChild(bl);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSendAsset(a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });

    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);

    // Closing on an outside click is registered on the NEXT frame. Binding it synchronously means the
    // very click that opened this menu is still propagating, reaches document, and closes it again —
    // which on a phone looks exactly like "the dropdown shuts the first time you tap it".
    requestAnimationFrame(function () {
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  // Status line. Reuses the modal's own body so nothing new is introduced; created once, then reused.
  function say(text, tone) {
    var m = sendModal();
    if (!m) return;
    var box = $('.lxw-say', m);
    if (!box) {
      var body = $('.modal-body', m);
      if (!body) return;
      box = document.createElement('div');
      box.className = 'lxw-say';
      box.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;font-weight:600';
      body.appendChild(box);
    }
    box.textContent = text || '';
    box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
    box.style.display = text ? '' : 'none';
  }

  // A DESTINATION TAG FIELD, because without one this wallet cannot pay an exchange at all.
  //
  // An exchange deposit address is shared by every customer; the tag is what says which account the
  // money belongs to. Send without it and the deposit is not credited — the classic way to lose funds
  // on this ledger, and the reason preflight() refuses outright when the destination demands one.
  //
  // This is NOT new UI. The Stellar build adds a "Memo (optional)" field to this very modal from its
  // own data layer, beside the network-fee row, for exactly the same purpose. This is that field, with
  // the XRP Ledger's equivalent in it, added the same way and in the same place.
  function tagInput() { return $('#lxwTag'); }

  function addTagField(m) {
    if ($('#lxwTag', m)) return;
    var feeRow = $('.modal-body > div[style*="justify-content"]', m);
    var body = $('.modal-body', m);
    if (!body) return;
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var lab = document.createElement('div');
    lab.className = 'field-label';
    lab.textContent = 'Destination tag ';
    var hint = document.createElement('span');
    hint.className = 'meta';
    hint.textContent = 'required by most exchanges';
    lab.appendChild(hint);
    var inp = document.createElement('input');
    inp.className = 'field-input mono';
    inp.id = 'lxwTag';
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('placeholder', 'Optional — digits only');
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    if (feeRow && feeRow.parentNode === body) body.insertBefore(wrap, feeRow);
    else body.appendChild(wrap);
  }

  function parseDest(raw) {
    var s = String(raw || '').trim();
    if (!s) return { err: 'Enter a recipient address.' };
    if (s.charAt(0) === 'X') {
      // X-addresses carry the tag inside the address. Decoding one needs a double-SHA256 checksum
      // verification, which is not built here — and silently dropping the tag it carries would be
      // the exact loss this field exists to prevent. So it is refused, clearly, rather than guessed.
      return { err: 'X-addresses are not supported yet. Use the classic r… address and put its tag in the Destination tag field.' };
    }
    if (!window.lxx || !window.lxx.isAddress(s)) {
      return { err: 'That is not a valid XRP Ledger address.' };
    }
    var t = tagInput();
    var raw2 = t ? String(t.value || '').trim().replace(/[ ,]/g, '') : '';
    if (!raw2) return { account: s, tag: null };
    if (!/^\d+$/.test(raw2)) return { err: 'A destination tag is digits only.' };
    var n = Number(raw2);
    // A tag is an unsigned 32-bit integer. Anything larger is not a tag the ledger can carry, and
    // submitting it produces a malformed transaction rather than a helpful error.
    if (!isFinite(n) || n > 4294967295) return { err: 'That destination tag is out of range.' };
    return { account: s, tag: n };
  }

  // Everything the ledger can tell us BEFORE the user signs. Each check here is a transaction that
  // would otherwise be signed, submitted, and fail — costing a fee and a lot of confusion.
  function preflight(dest, a, amount) {
    return rpc('account_info', { account: dest.account, ledger_index: 'validated' })
      .then(function (r) { return r.account_data; })
      .catch(function (e) {
        if (/actNotFound/i.test(e.message || '')) return null;   // unfunded, which is legal for XRP
        throw e;
      })
      .then(function (ad) {
        if (!ad) {
          // An account does not exist until it holds the base reserve. Sending less than that to an
          // unfunded address fails with tecNO_DST_INSUF_XRP, and sending a TOKEN to one cannot work
          // at all — there is no account to hold a trust line.
          if (a.code !== 'XRP') {
            return { err: 'That account is not activated yet. It must be funded with XRP before it can receive tokens.' };
          }
          return rpc('server_info', {}).then(function (si) {
            var base = ((si.info || {}).validated_ledger || {}).reserve_base_xrp;
            base = +base || 1;
            if (amount < base) {
              return { err: 'That account is not activated. A first payment must be at least ' + base + ' XRP.' };
            }
            return { warn: 'This activates a new account. ' + base + ' XRP of it becomes their reserve and cannot be spent.' };
          });
        }
        // DEPOSIT AUTHORISATION: the destination can refuse payments from accounts it has not
        // preauthorised. lsfDepositAuth is bit 0x01000000 in the account flags.
        if ((ad.Flags & 0x01000000) && dest.account !== addr()) {
          return { err: 'That account only accepts payments from pre-approved senders.' };
        }
        // DESTINATION TAG REQUIRED: lsfRequireDestTag, 0x00020000. Exchanges set this because a
        // payment without a tag cannot be credited to anyone — it is the classic way to lose a
        // deposit. Refusing here is the whole reason X-addresses are accepted above.
        if ((ad.Flags & 0x00020000) && dest.tag == null) {
          return { err: 'That account requires a destination tag — fill in the Destination tag field, or the payment will not be credited.' };
        }
        if (a.code === 'XRP') return {};
        // A token can only be received by an account that trusts it. Without this the payment fails
        // with tecPATH_DRY, whose wording tells the user nothing.
        return rpc('account_lines', { account: dest.account, peer: a.issuer, ledger_index: 'validated' })
          .then(function (r) {
            var ok = (r.lines || []).some(function (l) {
              return l.currency === a.currency && (+l.limit > 0 || +l.balance !== 0);
            });
            return ok ? {} : { err: 'That account has no trust line for ' + a.code + ', so it cannot receive it.' };
          });
      });
  }

  function doSend() {
    var m = sendModal();
    if (!m) return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !toIn || !go) return;

    var a = sendPick || held()[0];
    if (!a) { say('No balance to send.', 'bad'); return; }

    var amount = parseFloat(String(amtIn.value).replace(/,/g, ''));
    if (!(amount > 0)) { say('Enter an amount greater than zero.', 'bad'); return; }
    if (amount > a.spendable) {
      say('That is more than you can send. ' + fmt(a.spendable, 6) + ' ' + a.code + ' is available.', 'bad');
      return;
    }
    var dest = parseDest(toIn.value);
    if (dest.err) { say(dest.err, 'bad'); return; }
    if (dest.account === addr()) { say('That is your own address.', 'bad'); return; }

    var label = go.textContent;
    go.disabled = true;
    say('Checking the destination…');

    preflight(dest, a, amount).then(function (chk) {
      if (chk && chk.err) { go.disabled = false; say(chk.err, 'bad'); return; }
      say((chk && chk.warn ? chk.warn + ' ' : '') + 'Approve the payment in your wallet…');

      var tx = { TransactionType: 'Payment', Account: addr(), Destination: dest.account };
      if (dest.tag != null) tx.DestinationTag = dest.tag;
      if (a.code === 'XRP') {
        // Drops are integers. Rounding rather than truncating a float here is what stops
        // 0.1 + 0.2 arithmetic from silently shaving a drop off the amount the user typed.
        tx.Amount = window.lxx.toDrops(amount);
      } else {
        tx.Amount = { currency: a.currency, issuer: a.issuer, value: String(amount) };
      }

      return window.lxc.submit(tx).then(function (hash) {
        say('Sent. ' + short(hash), 'good');
        amtIn.value = '';
        toIn.value = '';
        var tg = tagInput();
        // Cleared with the rest of the form. A tag left behind belongs to the last recipient, and the
        // next payment would silently carry someone else's deposit reference.
        if (tg) tg.value = '';
        setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3500);
      });
    }).catch(function (e) {
      say((e && e.message) || 'The payment could not be sent.', 'bad');
    }).then(function () {
      go.disabled = false;
      go.textContent = label;
    });
  }

  function wireSend() {
    var m = sendModal();
    if (!m || m.getAttribute('data-lxw') === '1') return;
    var amtIn = $('.field-amt input', m);
    var toIn = $('.field-input.mono', m) || $('input.mono', m);
    var pick = $('.asset-pick', m);
    var max = $('.pill-btn', m);
    var go = $('.modal-foot .btn-primary', m);
    if (!amtIn || !go) return;                                   // markup not ready yet
    m.setAttribute('data-lxw', '1');

    // The recipient placeholder shipped as Stellar's: "G... or domain.com*username". On this ledger
    // that is an address format that cannot exist, telling the user to type something invalid.
    if (toIn) toIn.setAttribute('placeholder', 'r… XRP Ledger address');
    var lbl = $('.field-label .meta', m);
    if (lbl) lbl.textContent = 'XRP Ledger';
    addTagField(m);

    if (pick) {
      pick.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openAssetMenu(pick);
      });
    }
    if (max) {
      max.addEventListener('click', function (e) {
        e.preventDefault();
        var a = sendPick || held()[0];
        if (!a) return;
        // For XRP this is already balance minus reserve; a little is left for the network fee, or the
        // transaction cannot pay for itself and fails for an amount the button just offered.
        var v = a.code === 'XRP' ? Math.max(0, a.spendable - 0.0002) : a.spendable;
        amtIn.value = String(+v.toFixed(6));
        say('');
      });
    }
    go.addEventListener('click', function (e) { e.preventDefault(); doSend(); });
  }

  // SEPARATE FROM wireSend ON PURPOSE. Wiring happens once and then marks itself done — but the
  // balances it needs arrive from the ledger a second or two later, so the first pass had nothing to
  // select and the guard stopped it ever trying again. The listeners worked (a click read the right
  // balance), while the asset button still read "APT" and the balance row "25,420.18 APT" beside it:
  // correct behaviour under a label from another chain, which is the worst way for this to be wrong.
  //
  // So the display keeps trying until there is something real to show, independently of the wiring.
  function refreshSendAsset() {
    if (sendPick) return;
    var first = held()[0];
    if (first) setSendAsset(first);
  }

  // ---- Cancel order ---------------------------------------------------------------------------------
  // An offer is removed with OfferCancel referencing its sequence number — the same number wallet.js
  // stamps on each row as data-oid, so the row and the transaction cannot disagree about which offer
  // is being cancelled.
  function cancelOne(seq) {
    return window.lxc.submit({
      TransactionType: 'OfferCancel', Account: addr(), OfferSequence: +seq
    });
  }

  function confirmCancel(seqs, describe) {
    var m = $('#modalCancelOrder');
    if (!m) return;
    var title = $('#cancelOrderTitle', m);
    var text = $('#cancelOrderText', m);
    var det = $('#cancelOrderDetails', m);
    var go = $('#cancelOrderConfirm', m);
    if (!go) return;

    if (title) title.textContent = seqs.length > 1 ? ('Cancel ' + seqs.length + ' orders?') : 'Cancel order?';
    if (text) {
      text.textContent = seqs.length > 1
        ? 'Each order is cancelled by its own transaction, so you will be asked to approve ' + seqs.length + ' of them.'
        : 'This cannot be undone. Anything already filled stays in your wallet.';
    }
    if (det && describe) { det.textContent = describe; det.style.display = ''; }
    else if (det) det.style.display = 'none';

    // Replaced rather than added to: this modal is reused for every order, and a listener per opening
    // would cancel the same offer once more on each subsequent use.
    var fresh = go.cloneNode(true);
    go.parentNode.replaceChild(fresh, go);
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      fresh.disabled = true;
      var i = 0, done = 0;
      (function next() {
        if (i >= seqs.length) {
          fresh.textContent = done + ' cancelled';
          setTimeout(function () {
            closeModal(m);
            if (window.__lxxReload) window.__lxxReload();
          }, 900);
          return;
        }
        var s = seqs[i++];
        fresh.textContent = seqs.length > 1 ? ('Approve ' + i + ' of ' + seqs.length + '…') : 'Approve in wallet…';
        cancelOne(s).then(function () { done++; next(); })
          .catch(function (err) {
            fresh.disabled = false;
            fresh.textContent = (err && err.message) || 'Could not cancel';
          });
      })();
    });

    openModal(m);
  }

  // The design's modals are shown by a class its own script toggles. Both are set so this works
  // whether or not that script has run, and neither invents a new presentation.
  function openModal(m) { m.classList.add('open', 'show', 'active'); m.removeAttribute('hidden'); }
  function closeModal(m) { m.classList.remove('open', 'show', 'active'); }

  function wireCancels() {
    if (window.__lxwCancels) return;
    window.__lxwCancels = 1;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var one = t.closest('.order-cancel');
      if (one) {
        var row = one.closest('[data-oid]');
        if (!row) return;
        e.preventDefault(); e.stopPropagation();
        var pair = ($('.pair-text .name', row) || {}).textContent || '';
        confirmCancel([row.getAttribute('data-oid')], pair ? ('Order: ' + pair) : '');
        return;
      }

      var all = t.closest('button, a');
      if (all && /cancel all/i.test((all.textContent || '').trim())) {
        var rows = $$('[data-oid]');
        if (!rows.length) return;
        e.preventDefault(); e.stopPropagation();
        confirmCancel(rows.map(function (r) { return r.getAttribute('data-oid'); }),
          rows.length + ' open order' + (rows.length === 1 ? '' : 's'));
      }
    }, true);
  }

  // ---- Swap --------------------------------------------------------------------------------------
  // A swap on the XRP Ledger is a CROSS-CURRENCY PAYMENT TO YOURSELF: Account and Destination are the
  // same account, SendMax is what you are willing to give up, Amount is what must be delivered. The
  // ledger finds the route through order books and AMM pools itself, which is why there is no routing
  // engine here and no reason to build one.
  //
  // NO tfPartialPayment. Without that flag the ledger delivers Amount EXACTLY or the whole
  // transaction fails — so Amount is set to the quoted output minus the slippage tolerance, and the
  // trade either lands at a price you accepted or does not happen. A partial payment would let it
  // fill at any price down to zero, which is the same class of bug as a MAX button that offers more
  // than the balance: it makes the number on screen a suggestion rather than a commitment.
  //
  // The quote comes from ripple_path_find with destination_amount value "-1", the ledger's own way of
  // asking "how much of this can I get for that". Quoting from a book snapshot instead would be a
  // second opinion that disagrees with the router the transaction actually uses.
  var swapFrom = null, swapTo = null, swapQuote = null, swapSeq = 0;
  var SLIP = 0.005;                                          // 0.5%, the figure the design displays

  function swapModals() { return $$('#modalSwap'); }

  // Delegates to xrpl-core, which is the same file the node tests run against. This was written
  // locally three times over — twice in here and once in pooldetail.js — and three copies of the
  // arithmetic deciding how much money moves is three chances for one to drift. Now there is one,
  // and it is covered by fixed vectors including the float case (0.1 + 0.2 must round, not truncate)
  // and the safe-integer ceiling, where it refuses rather than returning a plausible wrong number.
  function amtObj(a, value) {
    return window.lxx.amountFor(a.code === 'XRP' ? 'XRP' : { currency: a.currency, issuer: a.issuer }, value);
  }

  function swapFields(m) {
    var fields = $$('.swap-pair .field', m);
    return { from: fields[0], to: fields[1] };
  }

  function setSwapAsset(which, a) {
    if (which === 'from') swapFrom = a; else swapTo = a;
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var fld = which === 'from' ? f.from : f.to;
      if (!fld) return;
      var btn = $('.asset-pick', fld);
      if (btn) {
        var ico = $('.a-ico', btn);
        if (ico) plain(ico, a.code.charAt(0).toUpperCase());
        [].forEach.call(btn.childNodes, function (nd) {
          if (nd.nodeType === 3 && nd.nodeValue.trim()) nd.nodeValue = ' ' + a.code + ' ';
        });
      }
      var meta = $('.field-label .meta', fld);
      if (meta && which === 'from') meta.textContent = 'Balance: ' + fmt(a.spendable, 6) + ' ' + a.code;
    });
    quoteSwap();
  }

  // You can only RECEIVE a token you already trust, so the destination list is the same list as the
  // source: XRP plus whatever this account has a trust line for. Offering the whole ledger here would
  // let someone build a swap that always fails with tecPATH_DRY.
  function swapMenu(btn, which) {
    var m = btn.closest('#modalSwap');
    var old = $('.lxw-astmenu', m);
    if (old) { old.parentNode.removeChild(old); return; }
    var list = held();
    if (!list.length) return;
    var menu = document.createElement('div');
    menu.className = 'lxw-astmenu';
    menu.style.cssText = 'position:absolute;z-index:40;right:0;top:calc(100% + 6px);min-width:200px;'
      + 'max-height:240px;overflow:auto;background:var(--surface,#14141b);border:1px solid var(--border,#2a2a35);'
      + 'border-radius:11px;padding:5px;box-shadow:0 12px 30px rgba(0,0,0,.45)';
    list.forEach(function (a) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;width:100%;gap:9px;align-items:center;padding:8px 9px;background:none;'
        + 'border:0;border-radius:8px;cursor:pointer;color:inherit;text-align:left;font:inherit';
      var ic = document.createElement('span');
      ic.style.cssText = 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;'
        + 'justify-content:center;font-size:10px;font-weight:800;background:linear-gradient(135deg,#2a2a35,#1a1a23)';
      plain(ic, a.code.charAt(0).toUpperCase());
      var nm = document.createElement('span');
      nm.style.cssText = 'flex:1;font-weight:700';
      plain(nm, a.code);
      row.appendChild(ic); row.appendChild(nm);
      row.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setSwapAsset(which, a);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      menu.appendChild(row);
    });
    var host = btn.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(menu);
    requestAnimationFrame(function () {                       // see openAssetMenu for why
      function away(e) {
        if (menu.contains(e.target) || btn.contains(e.target)) return;
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener('click', away, true);
      }
      document.addEventListener('click', away, true);
    });
  }

  function swapSay(text, tone) {
    swapModals().forEach(function (m) {
      var box = $('.lxw-swapsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-swapsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : (tone === 'good' ? 'var(--green,#22c55e)' : 'var(--text-muted,#9aa)');
      box.style.display = text ? '' : 'none';
    });
  }

  function swapInfoRow(m, label, value) {
    var rows = $$('.modal-body > div[style*="border-radius"] > div', m);
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('span');
      if (k && new RegExp(label, 'i').test(k.textContent || '')) {
        var v = rows[i].querySelector('strong');
        if (v) v.textContent = value;
        return;
      }
    }
  }

  function quoteSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    var seq = ++swapSeq;
    swapModals().forEach(function (m) {
      var f = swapFields(m);
      var inEl = $('.field-amt input', f.from);
      var outEl = $('.field-amt input', f.to);
      var amount = parseFloat(String(inEl && inEl.value).replace(/,/g, ''));
      // Emptying the amount must take the quote with it: a rate left standing from the previous
      // keystroke is a rate for a trade that is no longer on screen.
      if (!(amount > 0)) { if (outEl) outEl.value = ''; swapQuote = null; clearSwapQuote(m); swapSay(''); return; }
      if (swapFrom.code === swapTo.code && swapFrom.issuer === swapTo.issuer) {
        swapSay('Pick two different assets.', 'bad'); swapQuote = null; return;
      }
      swapSay('Finding a route…');
      rpc('ripple_path_find', {
        source_account: me,
        destination_account: me,
        destination_amount: swapTo.code === 'XRP' ? '-1'
          : { currency: swapTo.currency, issuer: swapTo.issuer, value: '-1' },
        send_max: amtObj(swapFrom, amount),
        ledger_index: 'validated'
      }).then(function (r) {
        if (seq !== swapSeq) return;                          // a newer keystroke superseded this one
        var alt = (r.alternatives || [])[0];
        if (!alt) {
          swapQuote = null;
          if (outEl) outEl.value = '';
          swapInfoRow(m, 'route', 'no route');
          swapSay('No route between those two assets right now.', 'bad');
          return;
        }
        var got = alt.destination_amount;
        var outVal = (typeof got === 'string') ? (+got / DROP) : +got.value;
        swapQuote = { alt: alt, out: outVal, inAmount: amount };
        if (outEl) outEl.value = String(+outVal.toFixed(6));
        var rate = outVal / amount;
        $$('.swap-rate span', m).forEach(function (sp, i) {
          if (i === 0) sp.innerHTML = '';
          if (i === 0) {
            sp.appendChild(document.createTextNode('1 ' + swapFrom.code + ' ≈ '));
            var st = document.createElement('strong');
            st.textContent = fmt(rate, 6) + ' ' + swapTo.code;
            sp.appendChild(st);
          }
          if (i === 1) {
            sp.innerHTML = '';
            sp.appendChild(document.createTextNode('Slippage: '));
            var s2 = document.createElement('strong');
            s2.textContent = (SLIP * 100).toFixed(1) + '%';
            sp.appendChild(s2);
          }
        });
        swapInfoRow(m, 'route', swapFrom.code + ' → ' + swapTo.code
          + ((alt.paths_computed && alt.paths_computed.length) ? ' (routed)' : ' (direct)'));
        swapInfoRow(m, 'network fee', '~0.000012 XRP');
        swapFeeRow(m, amount);
        swapSay('');
      }).catch(function (e) {
        if (seq !== swapSeq) return;
        swapQuote = null;
        swapSay((e && e.message) || 'Could not get a quote.', 'bad');
      });
    });
  }

  // The platform fee gets its own line in the design's existing details box, added the same way the
  // Send modal gets its destination-tag field. It is stated before the swap, not discovered after:
  // the Stellar Smart Swap was removed precisely because a route deducted a fee that was never
  // actually collected, and the fix for that starts with the number being visible and true.
  function swapFeeRow(m, amount) {
    var box = $('.modal-body > div[style*="border-radius"]', m);
    if (!box) return;
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    var row = $('.lxw-feerow', m);
    if (!row) {
      row = document.createElement('div');
      row.className = 'lxw-feerow';
      row.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px';
      var k = document.createElement('span');
      k.textContent = 'Platform fee';
      var v = document.createElement('strong');
      v.style.color = 'var(--text)';
      row.appendChild(k); row.appendChild(v);
      box.appendChild(row);
    }
    // SHOWN IN XRP, BECAUSE XRP IS WHAT IS CHARGED. The first version displayed the fee in the input
    // currency — "0.10% · 100 LUMOS" — while collectFee() converts and takes the XRP equivalent. A fee
    // line that names a different asset from the one leaving the account is how the Stellar Smart Swap
    // ended up deducting one thing and collecting another; the displayed number has to be the charged
    // number, so it is resolved through exactly the same call the charge uses.
    var v = row.querySelector('strong');
    v.textContent = (rate * 100).toFixed(2) + '% · …';
    var seq = swapSeq;
    feeInXrp(amount).then(function (x) {
      if (seq !== swapSeq) return;                            // a newer quote is already on screen
      v.textContent = (rate * 100).toFixed(2) + '% · '
        + (x > 0 ? (fmt(x, 6) + ' XRP') : 'not charged (no route)');
    });
  }

  function doSwap() {
    var me = addr();
    if (!me || !swapFrom || !swapTo) return;
    if (!swapQuote) { swapSay('Enter an amount first.', 'bad'); return; }
    var amount = swapQuote.inAmount;
    if (amount > swapFrom.spendable) {
      swapSay('That is more than you can swap. ' + fmt(swapFrom.spendable, 6) + ' ' + swapFrom.code + ' is available.', 'bad');
      return;
    }
    var minOut = swapQuote.out * (1 - SLIP);
    var tx = {
      TransactionType: 'Payment',
      Account: me,
      Destination: me,                                        // a conversion, not a transfer
      Amount: amtObj(swapTo, +minOut.toFixed(6)),
      SendMax: amtObj(swapFrom, amount)
    };
    if (swapQuote.alt.paths_computed && swapQuote.alt.paths_computed.length) {
      tx.Paths = swapQuote.alt.paths_computed;
    }

    swapSay('Approve the swap in your wallet…');
    window.lxc.submit(tx).then(function (hash) {
      swapSay('Swapped. ' + short(hash) + ' — approve the platform fee to finish.', 'good');
      return collectFee(amount);
    }).then(function () {
      setTimeout(function () { if (window.__lxxReload) window.__lxxReload(); }, 3000);
    }).catch(function (e) {
      swapSay((e && e.message) || 'The swap could not be completed.', 'bad');
    });
  }

  // THE FEE IS A SECOND TRANSACTION, and it has to be, which is worth stating plainly rather than
  // hiding. The collector holds no trust lines, so it can only receive XRP; and an XRPL transaction
  // carries exactly one operation, so the fee cannot ride along inside the swap. Two approvals is the
  // honest shape of this on this ledger.
  //
  // It runs AFTER the swap, not before. If it ran first and the swap were then rejected, the user
  // would have paid for nothing. This way the only failure mode is that LumosCore does not collect a
  // fee it is owed — which is a cost to us, not to them, and that is the right way round.
  function collectFee(amount) {
    return feeInXrp(amount).then(function (feeXrp) {
      if (!(feeXrp > 0)) return;
      return window.lxc.submit({
        TransactionType: 'Payment', Account: addr(),
        Destination: COLLECTOR,
        Amount: window.lxx.toDrops(feeXrp)
      }).then(function () { swapSay('Swap complete.', 'good'); })
        .catch(function () { swapSay('Swap completed; the platform fee was not paid.', 'bad'); });
    });
  }

  // The fee is a percentage of the trade, charged in XRP because the collector holds no trust lines
  // and so can receive nothing else.
  //
  // When one side of the swap IS XRP the value is already known. When neither side is, the fee is
  // worth asking the ledger about rather than inventing: a path_find for the fee slice of the input
  // returns exactly what it converts to, at the same prices the swap itself just used. Guessing from
  // a price feed would charge a number that disagrees with the trade it is a fee on.
  function feeInXrp(amount) {
    var rate = typeof window.__lxFeeRate === 'number' ? window.__lxFeeRate : 0.002;
    if (swapFrom.code === 'XRP') return Promise.resolve(amount * rate);
    if (swapTo.code === 'XRP') return Promise.resolve(swapQuote.out * rate);
    var slice = amount * rate;
    if (!(slice > 0)) return Promise.resolve(0);
    return rpc('ripple_path_find', {
      source_account: addr(), destination_account: addr(),
      destination_amount: '-1',
      send_max: amtObj(swapFrom, +slice.toFixed(6)),
      ledger_index: 'validated'
    }).then(function (r) {
      var alt = (r.alternatives || [])[0];
      if (!alt || typeof alt.destination_amount !== 'string') return 0;
      return (+alt.destination_amount) / DROP;
    }).catch(function () { return 0; });     // no route for the fee: never charge a made-up amount
  }

  // CLEAR THE MOCK QUOTE BEFORE ANYONE CAN READ IT.
  //
  // The summary rows are only written when a quote lands, and a quote needs an amount typed — so
  // until then the dialog stood with the design's Aptos mock in it: "1 APT = 0.4128 USDC", "Route
  // APT -> USDC (Direct)", "Network fee ~0.00001 APT". A fabricated exchange rate, in another
  // chain's asset, on the screen where someone decides whether to trade.
  //
  // Same reasoning as clearing the portfolio headline in wallet.js: an em dash reads as "not in
  // yet" and is self-evidently not a rate; a stale number reads as the price you will get.
  function clearSwapQuote(m) {
    $$('.swap-rate span', m).forEach(function (sp, i) {
      sp.innerHTML = '';
      sp.appendChild(document.createTextNode(i === 0 ? 'Rate ' : 'Slippage: '));
      var st = document.createElement('strong');
      st.textContent = i === 0 ? '—' : (SLIP * 100).toFixed(1) + '%';
      sp.appendChild(st);
    });
    swapInfoRow(m, 'route', '—');
    swapInfoRow(m, 'price impact', '—');
    swapInfoRow(m, 'network fee', '~0.000012 XRP');
  }

  function wireSwap() {
    swapModals().forEach(function (m) {
      if (m.getAttribute('data-lxw') === '1') return;
      var f = swapFields(m);
      if (!f.from || !f.to) return;
      m.setAttribute('data-lxw', '1');
      clearSwapQuote(m);

      var picks = $$('.asset-pick', m);
      if (picks[0]) picks[0].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[0], 'from'); });
      if (picks[1]) picks[1].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); swapMenu(picks[1], 'to'); });

      var inEl = $('.field-amt input', f.from);
      if (inEl) {
        var t = null;
        inEl.addEventListener('input', function () { clearTimeout(t); t = setTimeout(quoteSwap, 300); });
      }
      var flip = $('.swap-arrow', m);
      if (flip) {
        flip.addEventListener('click', function (e) {
          e.preventDefault();
          var a = swapFrom, b = swapTo;
          if (!a || !b) return;
          setSwapAsset('from', b);
          setSwapAsset('to', a);
        });
      }
      var go = $('.modal-foot .btn-primary', m);
      if (go) go.addEventListener('click', function (e) { e.preventDefault(); doSwap(); });
    });

    if (!swapFrom || !swapTo) {
      var list = held();
      if (list.length >= 2) { setSwapAsset('from', list[0]); setSwapAsset('to', list[1]); }
    }
  }

  // ---- Trustlines ------------------------------------------------------------------------------------
  // A trust line is what lets an account hold an issued token at all, so this is the gate in front of
  // every other token feature: without one, a payment of that token to you fails outright.
  //
  // The design's modal shipped describing the wrong ledger AND the wrong number — "hold non-native
  // assets on Aptos. Each trustline reserves 0.5 APT". On the XRP Ledger a trust line is an owner
  // object and reserves the owner increment, which is 0.2 XRP today. That figure is READ FROM THE
  // LEDGER rather than written here: both reserve numbers were ten times higher before 2024 and can
  // change again by amendment, so a hardcoded value would quietly misstate what an account is giving
  // up — the same reasoning xrpl-core gives for never hardcoding the reserve in spendable maths.
  var reserveInc = null;

  function loadReserve() {
    if (reserveInc != null) return Promise.resolve(reserveInc);
    return rpc('server_info', {}).then(function (si) {
      var v = ((si.info || {}).validated_ledger || {}).reserve_inc_xrp;
      reserveInc = +v > 0 ? +v : 0.2;
      return reserveInc;
    }).catch(function () { reserveInc = 0.2; return reserveInc; });
  }

  function tlModals() { return $$('#modalTrustlines'); }

  function tlFixCopy(inc) {
    tlModals().forEach(function (m) {
      var p = $('.modal-body > p', m);
      if (!p || p.__lxtl) return;
      p.__lxtl = 1;
      var strong = p.querySelector('strong');
      [].forEach.call(p.childNodes, function (nd) {
        if (nd.nodeType !== 3) return;
        nd.nodeValue = nd.nodeValue
          .replace(/non-native assets on Aptos/i, 'issued assets on the XRP Ledger')
          .replace(/\bAptos\b/g, 'the XRP Ledger');
      });
      if (strong) strong.textContent = inc + ' XRP';
    });
  }

  // What the account already trusts, straight from account_lines. LP tokens are excluded the same way
  // the balance list excludes them: they are pool shares, not assets somebody chose to trust.
  function tlPaintExisting() {
    var me = addr();
    if (!me) return;
    return rpc('account_lines', { account: me, ledger_index: 'validated', limit: 400 })
      .then(function (r) {
        var lines = (r.lines || []).filter(function (l) {
          return !(window.lxx && window.lxx.isLpToken && window.lxx.isLpToken(l.currency));
        });
        return loadReserve().then(function (inc) {
          tlFixCopy(inc);
          $$('#tlExistingCount').forEach(function (c) {
            c.textContent = lines.length + ' active · ' + fmt(lines.length * inc, 4) + ' XRP reserved';
          });
          $$('#tlExistingList').forEach(function (list) {
            list.innerHTML = '';
            if (!lines.length) {
              var e = document.createElement('div');
              e.className = 'tl-empty';
              e.textContent = 'No trustlines yet. Add one above to hold an issued token.';
              list.appendChild(e);
              return;
            }
            lines.forEach(function (l) { list.appendChild(tlRow(l, inc)); });
          });
        });
      }).catch(function () {});
  }

  function tlRow(l, inc) {
    var d = window.lxx.decodeCurrency(l.currency);
    var code = (d && d.display) || l.currency;
    var bal = +l.balance || 0;

    var row = document.createElement('div');
    row.className = 'tl-row';
    var ico = document.createElement('div');
    ico.className = 'tl-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-info';
    var nm = document.createElement('div');
    nm.className = 'tl-nm';
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-sub';
    sub.textContent = fmt(bal, 6) + ' · ' + short(l.account);
    info.appendChild(nm); info.appendChild(sub);

    var act = document.createElement('div');
    act.className = 'tl-action';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill-btn';
    if (bal !== 0) {
      // A line holding a balance cannot be removed, and the ledger will refuse it. Saying so is more
      // use than a button that fails; the reserve is only released once the balance is zero.
      btn.disabled = true;
      btn.textContent = 'Holding';
      btn.title = 'A trustline can only be removed once its balance is zero.';
      btn.style.opacity = '.55';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = 'Remove';
      btn.title = 'Removes the trustline and releases ' + inc + ' XRP of reserve.';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Approve…';
        // Limit 0 on a zero-balance line deletes it and returns the reserve.
        window.lxc.submit({
          TransactionType: 'TrustSet', Account: addr(),
          LimitAmount: { currency: l.currency, issuer: l.account, value: '0' }
        }).then(function () {
          btn.textContent = 'Removed';
          setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Remove';
          tlSay((err && err.message) || 'Could not remove that trustline.', 'bad');
        });
      });
    }
    act.appendChild(btn);
    row.appendChild(ico); row.appendChild(info); row.appendChild(act);
    return row;
  }

  function tlSay(text, tone) {
    tlModals().forEach(function (m) {
      var box = $('.lxw-tlsay', m);
      if (!box) {
        var body = $('.modal-body', m);
        if (!body) return;
        box = document.createElement('div');
        box.className = 'lxw-tlsay';
        box.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;line-height:1.5';
        body.appendChild(box);
      }
      box.textContent = text || '';
      box.style.color = tone === 'bad' ? '#e5484d' : 'var(--text-muted,#9aa)';
      box.style.display = text ? '' : 'none';
    });
  }

  function tlAdd(row) {
    var me = addr();
    if (!me) return;
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    return loadReserve().then(function (inc) {
      var x = (window.__lxxData || {}).xrp;
      // Adding a line raises the account's reserve. Without this check the transaction is signed and
      // then rejected with tecINSUFFICIENT_RESERVE, which costs a fee to discover.
      if (x && x.spendable != null && x.spendable < inc) {
        tlSay('Not enough spendable XRP — a new trustline reserves ' + inc + ' XRP.', 'bad');
        return;
      }
      tlSay('Approve the trustline for ' + code + ' in your wallet…');
      // A large but finite limit: the ledger requires one, and it caps how much of this issuer's token
      // the account can ever hold. Not unlimited, which would be a promise this UI never asked about.
      return window.lxc.submit({
        TransactionType: 'TrustSet', Account: me,
        LimitAmount: { currency: row.c, issuer: row.i, value: '1000000000' }
      }).then(function () {
        tlSay(code + ' trustline added.', 'good');
        $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; });
        $$('#tlSearchInput').forEach(function (s) { s.value = ''; });
        setTimeout(function () { tlPaintExisting(); if (window.__lxxReload) window.__lxxReload(); }, 2500);
      }).catch(function (e) {
        tlSay((e && e.message) || 'Could not add that trustline.', 'bad');
      });
    });
  }

  function tlSuggest(q) {
    if (!q || q.length < 2) { $$('#tlSuggestions').forEach(function (s) { s.innerHTML = ''; }); return; }
    fetch('/lxapi/xrplsearch?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        var held = {};
        ((window.__lxxData || {}).held || []).forEach(function (t) { held[t.issuer + '-' + t.currency] = 1; });
        // ANYONE CAN ISSUE A TOKEN CALLED ANYTHING. Searching "rlusd" returns eight tokens named
        // RLUSD from eight different issuers — one is Ripple's, two others call themselves "Ripple
        // USD", one is "RLUSD Silver", and several have no name at all. Trusting the wrong one is how
        // people end up holding a worthless token they believe is a stablecoin.
        //
        // The upstream marks the genuine article with vf, so verified issuers come first and holder
        // count breaks the rest — the two signals that actually separate them. The list is still shown
        // in full rather than filtered: hiding the impersonators would leave someone who really does
        // want an obscure token unable to find it, and would teach nobody that they exist.
        var rows = (j.rows || []).slice(0).sort(function (a, b) {
          if (!!b.vf !== !!a.vf) return b.vf ? 1 : -1;
          return (b.h || 0) - (a.h || 0);
        }).slice(0, 8);
        $$('#tlSuggestions').forEach(function (box) {
          box.innerHTML = '';
          rows.forEach(function (row) {
            box.appendChild(tlSuggestion(row, held[row.i + '-' + row.c]));
          });
        });
      }).catch(function () {});
  }

  function tlSuggestion(row, already) {
    var d = window.lxx.decodeCurrency(row.c);
    var code = (d && d.display) || row.n;
    var el2 = document.createElement('div');
    el2.className = 'tl-suggestion';
    var ico = document.createElement('div');
    ico.className = 'tl-s-ico';
    plain(ico, code.charAt(0).toUpperCase());
    var info = document.createElement('div');
    info.className = 'tl-s-info';
    var nm = document.createElement('div');
    nm.className = 'tl-s-nm';
    // The ISSUER is part of the identity, not decoration: a ticker is not unique on this ledger, and
    // "USDC" alone names several different tokens from different issuers. Showing who issues it is
    // what stops someone trusting the wrong one.
    plain(nm, code);
    var sub = document.createElement('div');
    sub.className = 'tl-s-sub';
    sub.textContent = (row.vf ? '✓ Verified · ' : '')
      + (row.u ? row.u + ' · ' : '')
      + short(row.i)
      + (row.h ? (' · ' + fmt(row.h, 0) + ' holders') : '');
    if (row.vf) sub.style.color = 'var(--green,#22c55e)';
    info.appendChild(nm); info.appendChild(sub);
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'tl-s-add';
    if (already) {
      add.textContent = 'Added';
      add.disabled = true;
      add.style.opacity = '.55';
    } else {
      add.textContent = 'Add';
      add.addEventListener('click', function (e) { e.preventDefault(); tlAdd(row); });
    }
    el2.appendChild(ico); el2.appendChild(info); el2.appendChild(add);
    return el2;
  }

  function wireTrustlines() {
    $$('#tlSearchInput').forEach(function (inp) {
      if (inp.__lxtl) return;
      inp.__lxtl = 1;
      inp.setAttribute('placeholder', 'Search by code or issuer (e.g. RLUSD, USDC…)');
      var t = null;
      inp.addEventListener('input', function () {
        clearTimeout(t);
        var v = inp.value.trim();
        // Debounced: one request per pause, not one per keystroke.
        t = setTimeout(function () { tlSuggest(v); }, 260);
      });
    });
    if (!window.__lxtlPainted && $('#tlExistingList') && window.__lxxData) {
      window.__lxtlPainted = 1;
      tlPaintExisting();
    }
  }

  // ---- boot ------------------------------------------------------------------------------------------
  // The modals are build-time markup but the balances they need arrive asynchronously, and the Receive
  // QR must repaint if the connected wallet changes. Polling briefly is simpler than subscribing to
  // three different layers, and it stops on its own.
  function tick() {
    paintQR();
    fixReceive();
    wireSend();
    refreshSendAsset();
    wireSwap();
    wireTrustlines();
  }

  function boot() {
    if (!$('#modalSend') && !$('.qr-display') && !$('#tlExistingList')) return;   // not a page with these
    wireCancels();
    tick();
    var n = 0;
    var t = setInterval(function () {
      tick();
      if (++n > 40) clearInterval(t);                             // ~20s
    }, 500);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button, a');
      // The phone's modal set can be inserted when it opens, so repaint a few times after the click
      // rather than once — the elements may not exist on the first frame.
      if (b && /receive/i.test(b.textContent || '')) {
        [60, 220, 600].forEach(function (ms) {
          setTimeout(function () { paintQR(); fixReceive(); }, ms);
        });
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
