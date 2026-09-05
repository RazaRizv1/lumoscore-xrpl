# Verified XRPL constants

Every figure here was read from XRPL **mainnet** (`xrplcluster.com`) and the published toml on
2026-09-06, not taken from memory or from a chat message. Re-verify before trusting an old copy.

## LUMOS

| | |
|---|---|
| issuer | `rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha` |
| currency | `LUMOS` → hex `4C554D4F53` + zero padding to 40 chars |
| total issued | **999,955,352.915** |
| toml | <https://lumosdao.com/.well-known/xrp-ledger.toml> |

**The issuer is BLACKHOLED, and this is load-bearing.**

```
DisableMaster = set
RegularKey    = rrrrrrrrrrrrrrrrrrrrBZbvji   (ACCOUNT_ZERO)
```

Both together mean nobody can ever sign for that account again, so **the supply is permanently fixed
and no further LUMOS can be minted**. Consequences to design around:

* Rewards must be **paid out of an existing treasury**, never minted. There is no mint path.
* A "top up the rewards pool" feature cannot exist. If the treasury empties, rewards stop.
* `DefaultRipple` is also set, which is what makes LUMOS transferable between third parties at all —
  without it holders could only trade back through the issuer. Do not treat it as decoration.

## The trap: the toml declares TWO issuers, and only one issues anything

```
rsPqeamjpr3Bxu4LhtCgvJEAQusYRRg6Ha   LumosCore                     issues LUMOS 999,955,352.915
rK58zTa7AzU9T4mMySJoT13KPDxLuMYLNw   LumosCore Secondary Address   issues NOTHING
```

The secondary has no domain, no flags, 4.99 XRP and has never issued a currency. **Anything that reads
"the issuers in our toml" and treats each as a token source will invent a second, empty LUMOS.** That is
the XRPL form of the ticker-is-not-identity problem that produced 403 USDC variants on Stellar: key
balances, the fee tier and rewards on `currency + issuer`, and hardcode the issuer above rather than
deriving it from the toml's ISSUERS list.

## Verification handshake — this is what "verified" means on XRPL

The issuer account's on-ledger `Domain` field says `lumosdao.com`, and the toml served at that exact
domain lists that exact account. Each confirms the other, so the pair cannot be forged by someone who
controls only one side. **A domain claim alone proves nothing** — the same rule as Stellar's
`home_domain`: anybody can put any address in their own toml.

## Logo, and the domain that will mislead you

The toml's icon is `https://lumosdao.io/public/images/Image.png` — note `lumosdao.io`, a THIRD domain
(the account says lumosdao.com, the site is lumoscore.com). Resolving the LUMOS mark by home domain
will therefore fetch someone else's branding, which is the exact bug the Stellar build hit and had to
special-case. Seed the LUMOS logo explicitly; do not derive it.

## Bridge

Not CCTP. XRPL uses **Wanchain and Axelar** (RAZA, 2026-09-06). Different contracts and a different
claim model from the Stellar bridge — research before assuming anything ports.

## LUMOS Ecosystem LP reward pools (verified 2026-09-06)

Ten AMM pools, each with LUMOS on one side. Supplied by RAZA as addresses only; every one was
resolved with `amm_info` on mainnet, which confirmed it is a real AMM account **and** that LUMOS is
genuinely one of its two sides. The pair names below are what the ledger reports — they were not
supplied and must not be guessed from the address.

| AMM account | pairs LUMOS with |
|---|---|
| `r27TeM8xMebVAMHt4aB3BMYw5MB5fULht` | 666 |
| `rM6HW3s4WUGuLYwKwRvZx2aai5wk5PR5fz` | XDawgs |
| `rhhBo4BXkrhvr17rLdtdwxMjEk1NnTvqUC` | MXI |
| `rJZftp95akgYuXXtb2yp23F1cGuHu34pMA` | BXE |
| `rEmgwNPCbq6ogmLKThxgee35uCSqfhB83M` | REAL |
| `rJnv9wSoSECHzWsNXR7E74hi8mbKX9ZnDM` | RLUSD |
| `rsKJxAyfL2AGdTMqz5ZMhBSyiSxqz97g3z` | ARMY |
| `rKsz9Dft5yYtbLS1SSG9L6u3LyhgwuWhew` | FUZZY |
| `rUHWxx4kodHx3P8WxtkdcjhwDXnr5p9txo` | BEAR |
| `rJfj7MXMt1VfBFF8mBta1CesMSzXYZELyZ` | SOLO |

An XRPL AMM is addressed by its **AMM account**, not by a pool id the way Stellar's are — so these
addresses are what a rewards data layer queries (`amm_info` with `amm_account`), and they are also
the accounts whose LP token holders are the reward recipients.

**Programme start dates are the SAME as Stellar** (RAZA, 2026-09-06): native LP rewards 15 December
2025, whale holder rewards 1 April 2026, Ecosystem LP rewards 15 April 2026. Rounds run from the 1st
and 15th of each month.

## Team-owned wallets — EXCLUDED from Native LP rewards (verified 2026-09-06)

RAZA supplied these truncated (`rHuF5…oQpN`). A truncation must never identify an account that gets
excluded from reward maths, so each was resolved against the live holder list and required to match
on **three** independent things: leading characters, trailing characters, and the stated balance.
All seven resolved to exactly one account each, with balances within 0.8% of the figures given.

| account | LUMOS | funded by | acquired |
|---|---|---|---|
| `rHuF5XcfA6izw3DhPuZZ5M2z1Vt5ozoQpN` | 320.8M | Binance | 100% transfer |
| `raieaf1UXyXgvptvSBZQ8Tojj3ztr77sdM` | 150.0M | `rHuF5…` ("LumosCore") | 100% transfer |
| `r42RLyT9Uz35joCo6thvknLJVBDeFqPhgN` | 144.7M | `rHuF5…` ("LumosCore") | — |
| `rL9d14LpUX39owdetCB1bV56UFcwAHTs2X` | 95.0M | `rKt1Dr…` ("@jrollnation") | — |
| `rEw27GSsFBmGYtkjTh2fYx8AMQY6id6jjx` | 49.0M | unlabelled | 100% transfer |
| `rNN7aocBTz4Ba27CnL1uR38EhCxYsoHqst` | 48.8M | `rHuF5…` ("LumosCore") | — |
| `rUdnkuyMpDoSfeSko4Y5Pg6Do9mUh8X1tY` | 41.7M | `rKt1Dr…` ("@jrollnation") | 100% transfer |

**Corroborated by the ledger, not just by the label:** three were funded directly by `rHuF5…`, which
xrpl.to names "LumosCore"; two more by `rKt1Dr…` ("@jrollnation"). Every one shows **0% DEX, 0% AMM,
0% LP and 100% transfer** — none of them bought on market, which is what a treasury allocation looks
like and an ordinary holder does not.

Together they hold **850M of the top-50's 978.7M (86.9%)**, so excluding them is not a rounding
adjustment — it changes the denominator of every holder-weighted reward.

**Open question for RAZA:** `rKt1DrESP2ssLM5CQpR4aBkvyg5v7WTijK` ("@jrollnation") funded two of the
seven and itself holds 13.45M LUMOS with 1,540 trades. It was **not** on the exclusion list. Left
counted, deliberately — that is a decision to confirm, not to make here.
