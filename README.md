# LumosCore — XRPL

The **XRP Ledger** build of LumosCore: trading, AMM pools, cross-chain transfers, a wallet view, a
token launchpad and rewards.

Live at **<https://lumoscore.com>** — one site serves every network, and the chain switcher moves
between them. There is no separate XRPL domain.

LumosCore is **non-custodial**. Transactions are built in the browser and signed in the user's own
wallet; no build ever receives a private key.

---

## How this repository relates to the others

| Repository | Holds |
|---|---|
| `lumoscore` (public) | The Stellar application, **and the source of truth for the shared edge Functions** |
| **`lumoscore-xrpl`** (this one, private) | The XRPL front-end |
| The deploy repository (private) | `combine.js`, which merges the built networks into the tree that ships |

**A push to this repository deploys nothing.** There is no Cloudflare Pages project attached to it.
XRPL reaches production only through the combined build, which is assembled and uploaded from the
deploy repository.

---

## What a fresh clone does not give you

Unlike the Stellar repository, **neither the design containers nor `dist/` are tracked here.**

```
lumoscore-xrpl-desktop.html   design containers — NOT in git (size)
lumoscore-xrpl-mobile.html
dist/                         build output — NOT in git
```

So a clone cannot be built, served or hosted on its own. This repository records *changes to the
build*, not a distributable copy of the site. To work on it you need the containers in place and the
Stellar repository checked out alongside it — see below.

### Hard dependency on the Stellar checkout

The npm scripts call the Stellar repository by **absolute path**:

```
node C:/LumosCore/_tools/shared_functions.js .
```

If `C:\LumosCore` is not present, `build`, `predeploy` and `sync:functions` all fail. This is a known
rough edge, not a design choice.

---

## Building

```bash
npm run build         # LOCAL build  -> dist/        (extract_site.js with --root)
npm run build:deploy  # SHIPPING build -> dist/xrpl/  (non-root; what the combine reads)
npm run serve         # local server on :8082
npm run check         # the predeploy gate
npm run idem          # idempotence check
npm test              # core unit tests
```

⚠️ **`npm run build` is not the build that ships.** It passes `--root`, which lays the site out at the
root for local browsing. The build that goes into the combined site is the non-root
`npm run build:deploy`, which writes `dist/xrpl/`.

A leftover `--root` build sitting in `dist/*.html` will be served in preference to `dist/xrpl/`, which
is a reliable way to spend an hour testing the wrong files.

### Transforms

`_tools/` holds 85 scripts; **64 are registered in `_tools/rebuild.js`**, which is the pipeline. A
script that is not registered does nothing on a rebuild no matter how correct it is — if a change
isn't appearing, check registration first.

**Never run an `_xrpl*` transform on its own.** Each one strips and re-inserts its own layer, so
running one in isolation moves it to the end of the cascade and silently reorders the stylesheets
relative to every layer the full pipeline would have placed after it. Run `rebuild.js`.

Transforms rewrite the **containers**, not `dist/`. Reading `dist/` straight after running one shows
the previous build — run the extract step first.

---

## Cloudflare Functions

30 Functions live here, but **27 of them are copies**. `shared-functions.json` lists the files that
are owned by the Stellar repository and synced in:

```bash
npm run sync:functions    # pull the shared Functions from C:\LumosCore
npm run check             # among other checks, verifies the copies are in sync
```

Edit a shared Function **in the Stellar repository** and sync it here. Editing the copy means the next
sync silently overwrites your change.

`npm run deploy` now **refuses and explains**. It used to run a wrangler deploy against a Pages
project named `lumoscore-xrpl` — a project that does not exist, and whose name wrangler would have
offered to *create*, producing a stray public site serving a half-built tree. XRPL has no standalone
deploy; `npm run build:deploy` then the combine is the whole release path.

---

## XRPL behaviour that differs from Stellar

The two builds look alike and the ledgers do not behave alike. The differences that have actually
caused bugs here:

- **An open offer reserves nothing.** On Stellar an open order locks reserve; on XRPL it does not.
  Anything that reasons about "spendable balance" must ask this per network rather than assume.
- **Trustlines cost reserve** — 0.2 XRP each — and a pool-share trustline costs **two** reserves, not
  one. A receiving account without the trustline cannot be paid.
- **`base_fee_xrp` is the reference fee, not the fee.** Submitting at the reference fee under load
  queues the transaction, which then expires. It does not fail loudly.
- **Asset codes can be non-ASCII**, and hex-coded currencies are normal. Anything that assumes an
  ASCII code will 404 its own links.
- **Asset codes, names and issuer domains are attacker-controlled input.** Anyone can issue a token
  and call it anything. They are escaped at every render site and never trusted for identity.

---

## Wallets

Xaman, GemWallet (its desktop extension, and the Joey app on mobile) and Crossmark.

Xaman's signing popup must be opened inside the user's own tap — opening it after an `await` is
blocked by the browser as an unrequested popup, which presents as "signing does nothing".

---

## Further reading

- [`XRPL_FACTS.md`](XRPL_FACTS.md) — verified on-chain constants: the LUMOS issuer, the verification
  handshake, reward pools and the excluded team wallets. Values here are checked against the ledger,
  not copied from the Stellar build.
- [`XRPL_PARITY_AUDIT.md`](XRPL_PARITY_AUDIT.md) — where this build does and does not match Stellar.

The parent repository's `LUMOSCORE_DEV.md` and `GUARDRAILS.md` apply to this build too; the container
pipeline, transform ordering rules and escaping traps are the same ones.
