# Self-hosted libraries

Not loaded from a CDN. A third party who can change a script on this origin can change what a signing
page does, so the bytes are pinned here and checked in.

`.gitattributes` marks this directory `-text`. That is load-bearing, not tidiness: in the Stellar
project autocrlf provably rewrote a byte inside a vendored SDK on checkout, changing its hash after
its provenance had been verified.

| file | version | sha256 | verified |
|---|---|---|---|
| `xumm-oauth2-pkce-2.8.7.min.js` | 2.8.7 | `f16d921a9d1ab9245e20b3aedd5883fd0dca601049c4ff00162f0073720ff707` | 2026-09-06 |

Verified by fetching the same version from **two independent CDNs** (unpkg and jsdelivr) and
confirming they agree byte for byte — 89,559 bytes, identical sha256. One CDN agreeing with itself
proves nothing.

To re-check:

```bash
curl -sL https://cdn.jsdelivr.net/npm/xumm-oauth2-pkce@2.8.7/dist/browser.min.js | sha256sum
```

`xumm-oauth2-pkce` is the browser-only OAuth2 PKCE client for Xaman sign-in. It exposes the global
`XummPkce` and takes a **public** API key only — the API secret is never used in front-end code.
