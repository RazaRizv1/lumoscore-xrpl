// Drives the thumbnail endpoint with the edge globals stubbed. The breaker only shows itself while
// xrpl.to is refusing, which is not a state anyone can arrange on demand against the live upstream.
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); },
  },
};
// crypto.subtle.digest('MD5') is a Cloudflare EXTENSION — Node's WebCrypto has no MD5 at all, so the
// id derivation returns '' and every request is a 400 'bad id'. Supplied here from node:crypto so the
// harness exercises the same derivation the edge does.
import { createHash } from 'node:crypto';
const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = async (alg, data) => {
  const name = typeof alg === 'string' ? alg : alg && alg.name;
  if (String(name).toUpperCase() === 'MD5') {
    return new Uint8Array(createHash('md5').update(Buffer.from(data)).digest()).buffer;
  }
  return realDigest(alg, data);
};

let MODE = 'ok', upstreamCalls = 0;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(120).fill(7)]);
globalThis.fetch = async (u) => {
  const href = typeof u === 'string' ? u : u.url;
  if (href.includes('api.xrpl.to')) {
    upstreamCalls++;
    if (MODE === '429') return new Response('slow down', { status: 429 });
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/webp' } });
  }
  return new Response('nope', { status: 404 });                 // the origin fallback, unused here
};

const { onRequest } = await import('../functions/lxapi/xrplthumb.js');
const ORIGIN = 'https://x.test';
const ctx = (q) => ({ request: new Request(ORIGIN + '/lxapi/xrplthumb?' + q), env: {}, waitUntil: (p) => p });
const ask = (q) => onRequest(ctx(q));

let fail = 0;
const check = (n, c, got) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '   got: ' + JSON.stringify(got))); if (!c) fail++; };

const A = 'iss=rDFXbW2ZZCG5WgPtqwNiA2xZokLMm9ivmN&cur=50484E4958000000000000000000000000000000&w=48';
const B = 'iss=rGG3wQ4kUzd7Jnmk1n5NWPZjjut62kCBfC&cur=41524D5900000000000000000000000000000000&w=48';
const C = 'iss=rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz&cur=534F4C4F00000000000000000000000000000000&w=48';
const LUMOS = 'iss=rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha&cur=4C554D4F53000000000000000000000000000000&w=48';

MODE = 'ok';
let r = await ask(A);
check('a logo is served and cached', r.status === 200 && (r.headers.get('content-type') || '').startsWith('image/'), r.status);

MODE = '429';
upstreamCalls = 0;
r = await ask(B);
check('a refusal is passed through as 429', r.status === 429, r.status);
check('and is never cached as an answer', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));
const afterFirst = upstreamCalls;

r = await ask(C);
check('the breaker is open, so the next token does not reach upstream', upstreamCalls === afterFirst, upstreamCalls);
check('and it answers 429, never 404', r.status === 429 && r.headers.get('x-lxbrk') === '1', r.status);

r = await ask(A);
check('an already-cached logo serves straight through the breaker', r.status === 200, r.status);

r = await ask(LUMOS);
check('our own LUMOS mark is unaffected by the breaker', r.status === 200 || r.status === 404, r.status);

console.log(fail ? ('\n' + fail + ' FAILED') : '\nall checks passed');
process.exit(fail ? 1 : 0);
