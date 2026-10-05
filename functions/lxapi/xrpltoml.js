// The links an issuer publishes in its own xrp-ledger.toml.
//
// RAZA 2026-10-06: "if toml on XRPL mentions socials, please add just like we do on Stellar".
// lumoscore.com's asset page renders an `a.lx-soc` beside the home domain — on AQUA that is
// https://x.com/aqua_token, taken from the SEP-1 toml. The XRP Ledger has the same convention under a
// different shape, and nothing here was reading it.
//
// WHERE THE LINKS LIVE. xrp-ledger.toml has no [DOCUMENTATION] block; a token's links are repeated
// `[[TOKENS.WEBLINKS]]` tables, each with a url, a type and usually a title. Measured against three
// real tomls:
//
//   7kt6u8….toml.firstledger.net   ATOM   x.com/AtomXRPL (socialmedia), t.me/atomXRPL (socialmedia)
//   93sa0gfz….toml.firstledger.net ARMY   none — the token block carries only name/desc/icon
//   lumosdao.com                   LUMOS  lumoscore.com (website), t.me/lumoscore, X.com/LumosCore
//
// So "no links" is an ordinary answer, not a failure, and the two shapes that exist — a token with
// WEBLINKS and one without — both have to be handled.
//
// WHERE THE DOMAIN COMES FROM. The issuer's AccountRoot, never the market data, for the reason set out
// at length in _issuerdomain.js: the ledger Domain is an assertion BY the account in a transaction it
// signed, while xrpl.to's `domain` is whatever the person who listed the token typed. An issuer that
// sets no Domain has no toml location, and this answers with no links rather than guessing one.
//
// COSTS NOTHING FROM THE xrpl.to BUDGET. Both halves — the ledger read and the toml fetch — go to the
// issuer's own infrastructure and a public rippled node. See the breaker note in xrplthumb.js for why
// that distinction now matters.
import { issuerDomains } from './_issuerdomain.js';

const TTL_OK = 21600;        // six hours; a project's links are not a live figure
const TTL_NONE = 900;        // fifteen minutes when there is nothing to show, so a new toml lands sooner
const TTL_UNREACHED = 30;    // the ledger did not answer — not a fact about the token, so barely cached
const MAX_BYTES = 200 * 1024;
const MAX_LINKS = 6;

const ADDR = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const CUR = /^([0-9A-Fa-f]{40}|[A-Za-z0-9]{3})$/;

const json = (body, secs) => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=' + secs,
    'access-control-allow-origin': '*',
  },
});

// A deliberately small TOML reader, and only for the shape this file needs: `[[TOKENS.WEBLINKS]]`
// tables and the `[[TOKENS]]` table each one belongs to. A general TOML parser is a lot of surface for
// three keys, and every value here is attacker-controlled text off someone else's web server.
//
// Scanned line by line in document order: a `[[TOKENS]]` header starts a new token, and the
// `[[TOKENS.WEBLINKS]]` tables that follow belong to it until the next `[[`-anything appears.
export function readTokenLinks(text, issuer, currency) {
  const want = String(currency || '').toUpperCase();
  const lines = String(text || '').split(/\r?\n/);
  let inToken = false, tokIss = '', tokCur = '', inLink = false;
  let link = null;
  const out = [];
  const flush = () => {
    if (link && link.url) out.push(link);
    link = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      flush();
      const head = line.replace(/\s+/g, '').toUpperCase();
      if (head === '[[TOKENS]]') { inToken = true; inLink = false; tokIss = ''; tokCur = ''; continue; }
      if (head === '[[TOKENS.WEBLINKS]]') {
        // Only collect for the token we were asked about.
        inLink = inToken && tokIss === issuer && (!tokCur || tokCur === want);
        if (inLink) link = { url: '', type: '', title: '' };
        continue;
      }
      inToken = false; inLink = false;
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase(), val = kv[2];
    if (inLink && link) {
      if (key === 'url' || key === 'type' || key === 'title') link[key] = val.slice(0, 200);
    } else if (inToken) {
      if (key === 'issuer') tokIss = val;
      // A toml may name the currency either way round — "LUMOS" or the 40-char hex — so both are
      // compared in the same form the ledger uses.
      else if (key === 'currency') tokCur = val.toUpperCase();
    }
  }
  flush();
  return out;
}

// https only, a real hostname, and no credentials in the url. These strings come off a third party's
// web server and end up in an href, so anything that is not plainly a web link is dropped rather than
// cleaned up: a half-repaired url is how a token page sends someone somewhere it did not mean to.
function safeUrl(u) {
  const s = String(u || '').trim();
  if (s.length > 300) return '';
  let url;
  try { url = new URL(s); } catch (e) { return ''; }
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return '';
  return url.href;
}

// The registrable-ish root of a hostname, reduced exactly the way the asset page's rootDomain() does
// — same two-part default, same three-part keep for co.uk-shaped suffixes. It has to be the same
// reduction, because what this is compared against is the string the page DISPLAYS.
function rootOf(v) {
  const h = String(v || '').trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].split(':')[0]
    .toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
  const p = h.split('.');
  if (p.length <= 2) return h;
  const keep = (/^(co|com|net|org|gov|edu|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) ? 3 : 2;
  return p.slice(-keep).join('.');
}

// What the link IS, so the page can pick an icon without re-parsing urls in the browser.
function kindOf(url, type, title) {
  const h = (() => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } })();
  if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(h)) return 'x';
  if (/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/.test(h)) return 'telegram';
  if (/(^|\.)discord\.(gg|com)$/.test(h)) return 'discord';
  if (/(^|\.)github\.com$/.test(h)) return 'github';
  if (/(^|\.)reddit\.com$/.test(h)) return 'reddit';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return 'youtube';
  const t = (String(type || '') + ' ' + String(title || '')).toLowerCase();
  if (/social/.test(t)) return 'social';
  return 'web';
}

// THE HOME DOMAIN IS ALREADY ON THE PAGE, SO IT IS NOT ALSO A BUTTON (RAZA 2026-10-06: "Why's there
// this extra website icon here. remove it", pointing at a globe sitting beside the words
// "xmagnetic.org").
//
// Most tomls list the project's own site among the WEBLINKS, which is reasonable in a toml and
// redundant next to a link that says the same thing in words. Compared on the ROOT domain, reduced the
// same way the page reduces the one it displays, because the toml's url is frequently a deep page
// while the header shows the bare host.
//
// Only that one is dropped. A project whose links point at a DIFFERENT site keeps its button —
// PHNIX's toml sits on firstledger.net and its web link is phnix.lol, which is a real second
// destination, not a repeat.
//
// Its own function so it can be tested; the handler around it needs a ledger and a web server.
export function cleanLinks(raw, domain) {
  const home = rootOf(domain);
  const seen = {};
  return (raw || [])
    .map((l) => ({ url: safeUrl(l.url), title: String(l.title || '').slice(0, 60), kind: kindOf(l.url, l.type, l.title) }))
    .filter((l) => {
      if (!l.url) return false;
      if (home && rootOf(l.url) === home) return false;
      // And a toml that lists the same destination twice gets one button, not two.
      if (seen[l.url]) return false;
      seen[l.url] = 1;
      return true;
    })
    .slice(0, MAX_LINKS);
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const iss = (url.searchParams.get('iss') || '').trim();
  const cur = (url.searchParams.get('cur') || '').trim();
  if (!ADDR.test(iss) || !CUR.test(cur)) return json({ ok: false, error: 'bad params', links: [] }, 3600);

  const cache = caches.default;
  const key = new Request(url.origin + url.pathname + '?iss=' + iss + '&cur=' + cur.toUpperCase(), request);
  const hit = await cache.match(key);
  if (hit) return hit;

  let domain = '', links = [], reached = true;
  try {
    const map = await issuerDomains([iss], url.origin, context, null);
    reached = Object.prototype.hasOwnProperty.call(map, iss);
    domain = map[iss] || '';
  } catch (e) { reached = false; }

  if (domain) {
    try {
      // The issuer's own host, so a slow or hostile one must not hold this request open.
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 6000);
      const r = await fetch('https://' + domain + '/.well-known/xrp-ledger.toml',
        { headers: { accept: 'text/plain' }, signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      if (r.ok) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength <= MAX_BYTES) {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
          // THE HOME DOMAIN IS ALREADY ON THE PAGE, SO IT IS NOT ALSO A BUTTON (RAZA 2026-10-06:
          // "Why's there this extra website icon here. remove it", pointing at a globe sitting beside
          // the words "xmagnetic.org").
          //
          // Most tomls list the project's own site among the WEBLINKS, which is reasonable in a toml
          // and redundant next to a link that says the same thing in words. Compared on the ROOT
          // domain, reduced the same way the page reduces the one it displays, so a link to any part
          // of that site is recognised as the site — the toml's url is frequently a deep page while
          // the header shows the bare host.
          //
          // Only that one is dropped. A project whose links point at a DIFFERENT site still gets its
          // button; this removes a duplicate, not a category.
          links = cleanLinks(readTokenLinks(text, iss, cur), domain);
        }
      }
    } catch (e) { /* no toml, or it did not answer: no links is the answer */ }
  }

  // THREE OUTCOMES, THREE TTLs, AND THE THIRD IS THE ONE THAT BIT.
  //
  // Lumping "the ledger did not answer" in with "this token has no links" cached a failure as an
  // answer for fifteen minutes: measured on the first deploy of this endpoint, ATOM came back with no
  // domain and no links while /lxapi/xrpltoken — the same resolver, one request earlier — had its
  // firstledger.net. One unlucky race, and the token's socials were gone from the page until the
  // entry expired, with nothing a reload could do about it.
  //
  //   reached, links found   six hours   a project's links are not a live figure
  //   reached, none          15 minutes  a real answer, but a toml can gain a WEBLINKS block
  //   not reached            30 seconds  not an answer at all; long enough only to stop a stampede
  //
  // The third matches _issuerdomain.js's own TTL_FAIL, and for the same reason it exists there.
  const ttl = !reached ? TTL_UNREACHED : (links.length ? TTL_OK : TTL_NONE);
  const res = json({ ok: true, domain, links, reached }, ttl);
  context.waitUntil(cache.put(key, res.clone()));
  return res;
}
