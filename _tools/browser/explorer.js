// Explorer links, in one place.
//
// RAZA, 2026-09-08: "in recent activity, no explorer link icon on right... use bithomp for explorer
// links on XRPL just like we have stellar.expert on Stellar."
//
// The Stellar build puts an external-link mark at the end of every activity row, pointing at
// stellar.expert. The fork inherited the STYLING for that — `.activity-feed-row .lx-actlink` is in
// the dashboard's stylesheet, faded to 45% and lifting on row hover — and none of the markup, so
// every feed here ends at the timestamp.
//
// WHY THIS IS A FILE AND NOT THREE LINES IN EACH FEED. The dashboard and the wallet paint separate
// feeds from separate modules, and the thing they would each have to hold is a base URL. This
// project has been bitten by exactly that: the fee collector's address is injected and
// checksum-verified at build time rather than written into browser sources, because two copies of a
// constant are two chances to be wrong and only one of them gets updated. An explorer base is not
// as costly to get wrong as a payout address, but it is the same shape of mistake — and if Bithomp
// ever changes its paths, this is the only line that moves.
//
// The URL is /explorer/<value>, which is Bithomp's universal resolver: it takes a transaction hash,
// an r-address or a username. NOTE: bithomp.com sits behind a bot challenge that does not clear for
// an automated browser, so the rendered page could not be checked from here — the path survives the
// challenge without being rewritten or 404'd, and it is Bithomp's documented shape, but the first
// real click is the confirmation.
(function () {
  if (window.lxxExplorer) return;

  var BASE = 'https://bithomp.com/explorer/';
  var NS = 'http://www.w3.org/2000/svg';

  function url(v) { return v ? BASE + encodeURIComponent(String(v)) : ''; }

  // The design's own external-link mark, the same one the Stellar feed uses.
  function icon(size) {
    var s = String(size || 13);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', s); svg.setAttribute('height', s);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
    var pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', '15 3 21 3 21 9');
    var ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', '10'); ln.setAttribute('y1', '14');
    ln.setAttribute('x2', '21'); ln.setAttribute('y2', '3');
    svg.appendChild(p); svg.appendChild(pl); svg.appendChild(ln);
    return svg;
  }

  // The wallet's feed rows are `.activity-row`, which the inherited stylesheet says nothing about —
  // it only styles the dashboard's `.activity-feed-row`. Same declarations, so the mark reads the
  // same in both feeds rather than being a slightly different grey in one of them. Injected once.
  function styleOnce() {
    if (document.getElementById('lxx-explorer-css')) return;
    var st = document.createElement('style');
    st.id = 'lxx-explorer-css';
    st.textContent = '.activity-row .lx-actlink{margin-left:12px;flex:0 0 auto;display:inline-flex;'
      + 'align-items:center;color:var(--text-muted);text-decoration:none;opacity:.45;'
      + 'transition:opacity .14s ease,color .14s ease}'
      + '.activity-row:hover .lx-actlink{opacity:1}'
      + '.activity-row .lx-actlink:hover{color:var(--accent)}';
    (document.head || document.documentElement).appendChild(st);
  }

  // An <a> for a hash or address, or null when there is nothing to link to — a mark that opens the
  // explorer's "not found" page is worse than no mark.
  function link(value, title) {
    if (!value) return null;
    styleOnce();
    var a = document.createElement('a');
    a.className = 'lx-actlink';
    a.href = url(value);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = title || 'View on Bithomp';
    a.setAttribute('aria-label', a.title);
    // These rows are clickable themselves; without this the row's own handler runs too.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    a.appendChild(icon(13));
    return a;
  }

  // A transaction's hash is `hash` on the v1 envelope and on the tx itself, and moves to the
  // envelope in v2 — the same split that left the feed empty once already, so both are read.
  function txHash(entry) {
    if (!entry) return '';
    var tx = entry.tx || entry.tx_json || {};
    return entry.hash || tx.hash || (entry.tx && entry.tx.hash) || '';
  }

  window.lxxExplorer = { url: url, icon: icon, link: link, txHash: txHash, BASE: BASE };
})();
