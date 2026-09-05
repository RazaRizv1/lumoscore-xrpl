// Populate dist/assets from the live site.
//
// The XRPL fork arrived with NO assets directory at all -- every font, the favicon, every token and
// wallet icon 404'd site-wide. The pages had been rendering in fallback system fonts the whole time,
// which is easy to miss when you are checking data rather than looking at the page.
//
// Sourced from https://lumoscore.com and deliberately NOT copied out of the Stellar working folder:
// that folder is off limits during XRPL work. The live site serves the identical files publicly, so
// this gets the same bytes without going near it.
//
// Only what the built pages actually reference is fetched (~4 MB), not the whole 141 MB design
// folder, most of which is screenshots that nothing links to.
//
// Idempotent: anything already present is left alone, so re-running is cheap and safe.
//
//   node _tools/fetch_assets.js            report what is missing
//   node _tools/fetch_assets.js --write    fetch it
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://lumoscore.com';
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WRITE = process.argv.includes('--write');

const refs = new Set();
for (const f of fs.readdirSync(DIST).filter((n) => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(DIST, f), 'utf8');
  for (const m of html.matchAll(/\/assets\/[A-Za-z0-9_\-\/.]+\.(?:png|jpg|jpeg|svg|webp|woff2?|mp4|ico|json)/g)) {
    refs.add(m[0]);
  }
}

// Never fetched: these are self-hosted libraries with pinned hashes (see PROVENANCE.md). Pulling
// them from a website instead of their package would defeat the point of pinning them.
const skip = (rel) => rel.indexOf('/assets/vendor/') === 0;

(async () => {
  const list = [...refs].filter((r) => !skip(r)).sort();
  const missing = list.filter((rel) => !fs.existsSync(path.join(DIST, rel.replace(/^\//, ''))));

  console.log('referenced: ' + list.length + '   already present: ' + (list.length - missing.length)
    + '   missing: ' + missing.length);
  if (!missing.length) return;
  if (!WRITE) {
    console.log('\n(dry run — pass --write to fetch)');
    missing.slice(0, 12).forEach((m) => console.log('  ' + m));
    if (missing.length > 12) console.log('  … and ' + (missing.length - 12) + ' more');
    return;
  }

  let ok = 0, bytes = 0;
  const gone = [];
  for (const rel of missing) {
    try {
      const r = await fetch(ORIGIN + rel, { headers: { 'user-agent': 'LumosCore-XRPL-build/1.0' } });
      if (!r.ok) { gone.push(rel + '  (' + r.status + ')'); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const dst = path.join(DIST, rel.replace(/^\//, ''));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, buf);
      ok++; bytes += buf.length;
    } catch (e) { gone.push(rel + '  (' + e.message + ')'); }
  }
  console.log('fetched ' + ok + '   ' + (bytes / 1048576).toFixed(2) + ' MB');

  if (gone.length) {
    // Expected, and not a failure of this script: these are dead references the design carries for
    // chains LumosCore does not ship (metamask, petra, starknet, vechain, worldchain...). They 404
    // on the live site too. They disappear when the body copy is rewritten, not before.
    console.log('\nnot on the live site either (' + gone.length + ') — dead design references:');
    gone.forEach((g) => console.log('  ' + g));
  }
})();
