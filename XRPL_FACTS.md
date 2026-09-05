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
