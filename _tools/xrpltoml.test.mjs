// The toml reader and the link cleaner, run against the real shapes. Both are pure, so they are
// testable without a ledger or someone else's web server — which is the whole reason they are
// separate functions.
import { readTokenLinks, cleanLinks } from '../functions/lxapi/xrpltoml.js';

let fail = 0;
const check = (n, c, got) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '   got: ' + JSON.stringify(got))); if (!c) fail++; };
const urls = (ls) => ls.map((l) => l.url);

// The shape RAZA reported: the toml lists the project's own site, which the header already shows.
const OWN = [
  '[[TOKENS]]',
  'issuer = "rXYZ"',
  'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]',
  'url = "https://xmagnetic.org/tokens/ABC+rXYZ"',
  'type = "website"',
  '[[TOKENS.WEBLINKS]]',
  'url = "https://x.com/the_project"',
  'type = "socialmedia"',
].join('\n');

let got = cleanLinks(readTokenLinks(OWN, 'rXYZ', 'ABC'), 'xmagnetic.org');
check('the duplicate site button is dropped', urls(got).join() === 'https://x.com/the_project', urls(got));

// A deep toml host still recognises its own root.
got = cleanLinks(readTokenLinks(OWN.replace('xmagnetic.org/tokens/ABC+rXYZ', 'www.xmagnetic.org/a/b'), 'rXYZ', 'ABC'),
  'abc123.toml.xmagnetic.org');
check('matched on the root, not the exact host', urls(got).join() === 'https://x.com/the_project', urls(got));

// A genuinely different site is kept — PHNIX's toml is on firstledger.net and its site is phnix.lol.
const DIFF = OWN.replace('https://xmagnetic.org/tokens/ABC+rXYZ', 'https://phnix.lol/');
got = cleanLinks(readTokenLinks(DIFF, 'rXYZ', 'ABC'), 'oazp5ru2sk7adpiavthc.toml.firstledger.net');
check('a different site keeps its button', urls(got).length === 2 && urls(got)[0] === 'https://phnix.lol/', urls(got));

// The same destination twice is one button.
const TWICE = DIFF + '\n[[TOKENS.WEBLINKS]]\nurl = "https://phnix.lol/"\ntype = "info"';
got = cleanLinks(readTokenLinks(TWICE, 'rXYZ', 'ABC'), 'toml.firstledger.net');
check('a repeated destination is listed once', urls(got).length === 2, urls(got));

// Links belonging to ANOTHER token in the same toml are not collected.
const OTHER = [
  '[[TOKENS]]', 'issuer = "rOTHER"', 'currency = "ZZZ"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://not-ours.example/"', 'type = "website"',
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://t.me/ours"', 'type = "socialmedia"',
].join('\n');
got = cleanLinks(readTokenLinks(OTHER, 'rXYZ', 'ABC'), '');
check('another token’s links are not borrowed', urls(got).join() === 'https://t.me/ours', urls(got));

// http, credentials and junk never reach an href.
const UNSAFE = [
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "http://plain.example/"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://user:pw@evil.example/"',
  '[[TOKENS.WEBLINKS]]', 'url = "javascript:alert(1)"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://ok.example/"',
].join('\n');
got = cleanLinks(readTokenLinks(UNSAFE, 'rXYZ', 'ABC'), '');
check('only https, no credentials, no javascript:', urls(got).join() === 'https://ok.example/', urls(got));

console.log(fail ? ('\n' + fail + ' FAILED') : '\nall checks passed');
process.exit(fail ? 1 : 0);
