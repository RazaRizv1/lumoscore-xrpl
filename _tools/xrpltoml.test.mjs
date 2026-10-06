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

// A site on a different host is dropped too, now that the rule is "platforms with a mark", not
// "hosts that differ" — PHNIX's toml is on firstledger.net and its site is phnix.lol, and Stellar
// shows no website button for it either.
const DIFF = OWN.replace('https://xmagnetic.org/tokens/ABC+rXYZ', 'https://phnix.lol/');
got = cleanLinks(readTokenLinks(DIFF, 'rXYZ', 'ABC'), 'oazp5ru2sk7adpiavthc.toml.firstledger.net');
check('a site on another host gets no button either', urls(got).join() === 'https://x.com/the_project', urls(got));

// The same destination twice is one button.
const TWICE = [
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://t.me/ours"', 'type = "socialmedia"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://t.me/ours"', 'type = "info"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://x.com/ours"', 'type = "socialmedia"',
].join('\n');
got = cleanLinks(readTokenLinks(TWICE, 'rXYZ', 'ABC'), 'toml.firstledger.net');
check('a repeated destination is listed once', urls(got).join() === 'https://t.me/ours,https://x.com/ours', urls(got));

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
  '[[TOKENS.WEBLINKS]]', 'url = "http://x.com/insecure"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://x.com/ok"',
].join('\n');
got = cleanLinks(readTokenLinks(UNSAFE, 'rXYZ', 'ABC'), '');
check('only https, no credentials, no javascript:', urls(got).join() === 'https://x.com/ok', urls(got));

// RAZA's second report: ATOM's toml lists the same X handle twice, in different case and under two
// different types, and both rendered as an X button.
const TWOX = [
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://x.com/AtomXRPL"', 'type = "socialmedia"', 'title = "X Social Media"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://t.me/atomXRPL"', 'type = "socialmedia"', 'title = "Telegram"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://x.com/atomXRPL"', 'type = "info"', 'title = "Official Website"',
].join('\n');
got = cleanLinks(readTokenLinks(TWOX, 'rXYZ', 'ABC'), 'toml.firstledger.net');
check('one button per glyph', got.map((l) => l.kind).join() === 'x,telegram', got.map((l) => l.kind));
check('and it is the first of each, in toml order', got[0].url === 'https://x.com/AtomXRPL', got[0] && got[0].url);

// ARMY: its toml host is firstledger.net and its web link is xrparmy-cto.com, so the hosts differ and
// the root filter kept the globe. Stellar renders no website button on any token, so neither do we.
const ARMY = [
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://x.com/ARMY_XRP589"', 'type = "socialmedia"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://t.me/XRP_Army_CTO"', 'type = "socialmedia"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://www.xrparmy-cto.com/"', 'type = "website"',
].join('\n');
got = cleanLinks(readTokenLinks(ARMY, 'rXYZ', 'ABC'), '93sa0gfzkpttzeeeq9ta.toml.firstledger.net');
check('a website on a DIFFERENT host still gets no button', got.map((l) => l.kind).join() === 'x,telegram', got.map((l) => l.kind));

// An unrecognised host typed "socialmedia" has no mark of its own, so it would render as a globe too.
const ODD = [
  '[[TOKENS]]', 'issuer = "rXYZ"', 'currency = "ABC"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://some-forum.example/c/token"', 'type = "socialmedia"',
  '[[TOKENS.WEBLINKS]]', 'url = "https://discord.gg/abc"', 'type = "socialmedia"',
].join('\n');
got = cleanLinks(readTokenLinks(ODD, 'rXYZ', 'ABC'), '');
check('only platforms with a mark of their own', got.map((l) => l.kind).join() === 'discord', got.map((l) => l.kind));

console.log(fail ? ('\n' + fail + ' FAILED') : '\nall checks passed');
process.exit(fail ? 1 : 0);
