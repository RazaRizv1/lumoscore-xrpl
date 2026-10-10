# XRPL ↔ Stellar parity audit — 2026-10-07

Regenerated from scratch (the first run's list was chat-only and was lost to compaction).

**Method.** All 97 built HTML files in `dist/xrpl` paired against the 97 in `C:\LumosCore\dist`,
43 distinct page bases. Every string is passed through a normaliser that collapses the *intended*
chain vocabulary of both builds onto the same tokens (`Stellar`/`XRP Ledger` → `~CHAIN~`,
`XLM`/`XRP` → `~NATIVE~`, and so on) **before** comparing, so what remains is genuine drift rather
than the differences we want. 281 raw differences came out; curated below.

Scripts: `scratchpad/audit/{profile,probe,probe2,dir,view}.js`. Read-only — nothing in
`C:\LumosCore` was written (its containers still carry their 1 Oct mtime).

**Caveat on "visible".** Most leftovers below are replaced at runtime by our own renderers before
anyone opens the control. That does not make them harmless: crawlers, LLMs and our own MCP
connector read the served markup. This is exactly why Stellar has `_mockassets.js` — its header
records an assistant on LumosCore MCP answering that the Pools page "displays conflicting Stellar
and Aptos data, so neither gives me a reliable total."

---

## A. XRPL-only: Aptos design leftovers  (18 items) — **1–10 and 18 FIXED 2026-10-07**

Root cause for 1–10: **Stellar has a `_mockassets.js` transform for exactly this; XRPL has no
equivalent.**

**Fixed** by porting it as `_tools/_xrplmockassets.js` (last in the `rebuild.js` chain, idempotent
via a `data-lxreal="1"` marker, aborts rather than guessing on an unmapped code). 60 rows rewritten
across 5 page keys; all five invented balances and all four Aptos tickers are gone from the build.
The six replacements are assets this build already treats as real — XRP (native), RLUSD, USDC and
USDT (all three issuer-verified in `trade.js`'s `STABLES`), LUMOS (ours), and SOLO (in `rewards.js`'s
`ECO` map, a pair we already run a LUMOS pool against). No issuer is written: these buttons carry a
code and a name only, and a ticker alone is not an identity on this ledger.

Items **11–17 FIXED 2026-10-07** by `_tools/_xrplaptossweep.js` (also last in the chain, idempotent,
aborts rather than writing if an Aptos text node or visible attribute survives). **194 replacements.**
Files in `dist/xrpl` containing "Aptos": **35 → 14.**

**Two corrections to this section.** First, 11–17 were filed as XRPL-only: they are not. Every one
exists on Stellar in identical counts — inherited template leftovers both builds carry. Second, 11–17
was a *subset*. The sweep's own guard refused to write while `>Aptos` text nodes remained, and the
survivors were a further tier, including the worst item in the whole audit:

| extra | Finding |
|---|---|
| 18 | **The MOBILE Trade page's `<h1>` read "Explore the Aptos DEX".** The desktop hero was fixed earlier the same day and verified by fetching `/trade/xrpl` — which serves the *desktop* file, because mobile is UA-served. A phone on the XRPL Trade page was being handed an h1 naming another chain. |
| 19 | `asset-overview`'s tag row read "Aptos XRP Ledger DEX" — an earlier copy pass fixed "Aptos DEX" and left the leading word. |
| 20 | The Rewards network chip. |
| 21 | The asset-overview network badge, "Aptos · Mainnet". |
| 22 | The LUMOS comparison row. |
| 23 | 15 holder rows reading "Aptos · 1.12% of supply". |
| 24-25 | `aria-label="Aptos AMM"` and `aria-label="Aptos DEX"`. |
| 26 | 36 × `View on Aptos Explorer` → "View on Explorer" (the wording this build already ships; not "Bithomp", because every one of those anchors is `href="#"`). |
| 27 | `title="One-time Aptos asset issuance fee"`. |
| 28-29 | Visible asset-description prose: "trades natively on the Aptos Decentralized Exchange against APT". |
| 30 | The signin wallet-kit label `{hedera:"Aptos Wallet Standard", stellar:"Aptos Wallet Standard", xrpl:"Xaman · Aptos"}`. |
| 31 | 3 addr-row network labels. |
| 16 | Rule 16 was **undercounted in this audit**: 28 cells, not 22. Six close an inline `<svg>` rather than an `<img>`, and the narrower pattern walked past them. |

**NOT swept, deliberately — read before "finishing" these:**

* **`launch-confirm` / `launch-review` ("Aptos Coin", 9 occurrences).** These placeholders are
  **load-bearing**. `launchpad.js`'s `paintConfirm()` fills that page by replacing known placeholder
  *strings* in its text nodes rather than by selector — its own comment explains why — matching on
  `['Aptos Coin' → the token's name]`, `['APT / APT pool']`, `['APT/APT pool']`, `/· n APT/` and
  `/\bAPT\b/ → the ticker`. Sweeping "Aptos Coin" would leave that substitution matching nothing and
  the launch confirmation would stop naming the token the user just minted. Fixing it means editing
  the markup and that `pairs` list in one change, with the mint flow exercised afterwards.
* **The Rewards sentence** "…independently verifiable. Aptos distributions are anchored to this same
  contract." A name swap makes it *worse*: "XRP Ledger distributions … anchored to this same
  contract" asserts a contract on a ledger that has none. Needs a rewrite.
* **30 `lumoscore-admin-*` page keys.** `dist/xrpl` contains zero admin files — the admin panel builds
  from the Stellar containers and ships to its own project. Editing them changes nothing served.
* This repo's own source comments, which mention the mock they exist to describe.

**Two routing facts found while verifying, both worth a decision:**

* **`/signin` — WITHDRAWN 2026-10-07, this finding was wrong.** It is true that `/signin` has no
  `CHAIN_ALT` entry and always serves Stellar's build. It is NOT true that an XRPL user is offered
  Stellar's wallets. Checked on production: that page carries a network chooser and a wallet grid per
  network, and its XRPL grid is correct — Xaman, GemWallet, Crossmark, WalletConnect. I inferred the
  fault from the stale `walletKit` *label* without reading the grids underneath it.
  One shared `/signin` is therefore right, and that is why `extract_site.js` lists it with the other
  company pages. Adding a `CHAIN_ALT` entry would be a regression: it would serve two different
  signin pages at one url depending on a cookie, and the XRPL copy is a strict subset (2 networks
  against 7). Nothing in the XRPL build links to `/signin` either — 0 of 97 files; the live connect
  path is the `lxw-*` modal. The sweep's rule 30 edit to the XRPL copy is correct but inert.

  What IS wrong there is Stellar-side, and logged for RAZA. Measured by behaviour on production, not
  from the markup — the markup reading was wrong twice over, so this is what a visitor actually gets:
  the page opens on its network chooser, and **two of the seven buttons are labelled "Stellar"**. The
  second one is `data-net-id="aptos"`, and clicking it offers **Petra, OKX Wallet, Nightly and Fox
  Wallet** under "Connect a wallet" — four Aptos wallets, none of which can sign a Stellar
  transaction. It also offers VeChain, Hedera, Starknet and World Chain.
  Corrected from my first write-up: it does NOT default to Hedera (`sw("hedera")` runs but is inert),
  and the "Aptos Wallet Standard" label never renders (`_batch6.js` removed `#walletKit`; the script
  writing to it survives and is null-guarded). `sw()` itself is dead — its selector is
  `.step-wallet .opt[data-wnet]` and the shipped cards are `class="opt-card"`, 0 matches — but that
  is harmless, because a live layer handles the chooser correctly: clicking the real "Stellar" button
  reveals exactly Rabet, Freighter, Albedo, xBull and WalletConnect.
* **`lumoscore-asset-overview` is never emitted** (0 files in `dist/xrpl`), so items 19 and 21 are
  fixed in the container against the day that page is routed, and serve nothing today.

| # | Finding | Where |
|---|---------|-------|
| 1 | Asset picker row `data-asset="APT"` / name `Aptos` — should be XRP | amm, home (5 files) |
| 2 | Picker row `GUI` / `Kale` — code is the Aptos token's; Stellar ships `KALE` | amm, home |
| 3 | Picker row `AMI` / `Yieldblox APT` | amm, home |
| 4 | Picker row `CELL` / `Cellana` (an Aptos DEX token) | amm, home |
| 5 | All six picker rows appear twice per page (desktop + mobile containers) | 12 buttons/page |
| 6 | Invented balance `12,847.50` presented as holdings | 5 files, 0 on Stellar |
| 7 | Invented balance `3,420.18` | 5 files, 0 on Stellar |
| 8 | Invented balance `58,932.10` | 5 files, 0 on Stellar |
| 9 | Invented balance `124,500.00` | 5 files, 0 on Stellar |
| 10 | Invented balance `1,250.00` | 5 files, 0 on Stellar |
| 11 | `<span class="chain-pill stellar">Aptos</span>` — class, text and build all disagree | 7 files |
| 12 | `<span id="lcNetNameDone">Aptos</span>` — network name in a success state | 7 files |
| 13 | `Powered by <a href="#">Aptos Wallet Standard</a>` in a modal footer (also a dead `#` link) | 7 files |
| 14 | Wallet chip `<span class="nm">Aptos</span><span class="st">Connected</span>` | 3 files |
| 15 | Bridge review row `data-rv="sendnet">Aptos` | 3 files |
| 16 | `Aptos` rendered in table cells | 22 occurrences |
| 17 | HTML comments `<!-- Aptos — Trading Activity -->`, `<!-- New Mints on Aptos -->` | 6 files |
| 18 | **No `_mockassets.js` equivalent in this repo** — the reason 1–10 survive every rebuild | `_tools/` |

XRPL carries `Aptos` in **35 of 97** files across 47 distinct contexts. (Stellar carries it in 96 —
worse, but that is a Stellar-side problem, logged separately.)

## B. Shared — present on BOTH builds, so not XRPL drift  (7 items)

| # | Finding | Counts |
|---|---------|--------|
| 19 | Mock `100 BVET` in the bridge review | 3 files each |
| 20 | Mock `4.2271 APT` | 3 files each |
| 21 | `<h2 class="result-name">Aptos Coin</h2>` in search results | 6 files each |
| 22 | Duplicate `<style id="lx-tabs-css">` within one page (+ `lx-tabs-phone-css`) | 6 pages each |
| 23 | Link previews carry no image — see the corrected detail below | both builds |
| 24 | ~~No `og:url`, `og:site_name`, `og:locale`, `theme-color`~~ — **partly wrong, corrected below** | both builds |
| 25 | Inputs with neither `aria-label` nor `placeholder` | xrpl 52, stellar 58 |

### 23/24 corrected — PARKED 2026-10-07, RAZA: "this also involves designing, let's get to it in a day or 2"

Items 23 and 24 were measured against the BUILT FILES, and that was the wrong surface: `_xrplseo.js`
says it plainly — "og: and twitter: descriptions are injected at the edge". Checked against the live
response instead, on both chains:

| tag | live state |
|---|---|
| `og:url` | **present** — `https://lumoscore.com/trade/xrpl` (production host, correctly, not the staging one) |
| `og:type` | **present** — `website` |
| `og:site_name` | **present** — `LumosCore` |
| `twitter:card` | **present** — `summary` |
| `og:title`, `og:description` | missing |
| `og:image`, `twitter:image` | missing |
| `theme-color` | missing |

So the plumbing is half-built at the edge already, and the audit overstated it as nothing. What is
actually needed: the four missing tags, plus `twitter:card` changed from `summary` to
`summary_large_image` — with `summary` the preview stays a small square thumbnail even once an image
exists, which would make the image look like it had not worked.

**Blocked on an asset, which is why it is parked.** A social card wants 1200×630, and nothing in
either repo fits: `favicon.png` is 160×160 (under Facebook's 200×200 floor, so it would be rejected
outright), the four `products/*.png` are 256×256 squares, and `prod-texture.png` is 1376×768 but is a
wordless orange swirl — it would give every shared link a picture that says nothing about the product.
One purpose-made 1200×630 card with the wordmark, dropped into `assets/`, is the whole dependency;
the tag work is then one constant in each build's SEO transform.

Also worth knowing for that day: Stellar's pages are served from its prebuilt `dist`, which is
**git-tracked (640 files)**, so doing this "across both builds" means rebuilding that dist and seeing
640 files change. Its working branch is `testing-lumoscore`, not main, so nothing deploys from it.

## C. XRPL-only: copy introduced by the chain swap  (4 items) — **26-28 WITHDRAWN, 29 open**

**26, 27 and 28 were not bugs.** "an XRP Ledger wallet" / "an XRP Ledger AMM pool" is correct
English: X is pronounced "ex", a vowel sound, so it takes "an" exactly as "an FBI agent" does. I
filed them as chain-swap grammar damage without saying the string out loud.

**29 FIXED 2026-10-07** by `_tools/_xrpltrustline.js`, plus the five spaced forms in `_xrplseo.js`'s
table at source. Measured first: this build used both spellings, 637 one-word against 59 spaced
("trust line" ×46, "trust lines" ×10, "Trust Lines" ×3), while **Stellar uses one-word 689 times and
spaced zero** — so the split was this fork's alone. Normalised to one word: the minority by eleven to
one, and the form Stellar settled on. The XRP Ledger's own docs do write "trust line", so the other
direction had a real claim; it would have meant 637 edits instead of 59 and a deliberate divergence
from Stellar. Reversible by swapping the pairs in that file.
Safe as a blind text pass only because every rule matches a string containing a SPACE, so none can be
a class name, id or url — `/docs/trustlines` and `lxw-trustline` cannot match. Verified: the built
site went from 59 spaced to **0**, one-word 637 → 696 (every one converted), and `/docs/trustlines` is
still referenced. The transform aborts if a spaced form survives it.


| # | Finding | Where |
|---|---------|-------|
| 26 | "**an** XRP Ledger AMM pool" — article not updated when the chain name changed | amm-pool, 3 files |
| 27 | "**an** XRP Ledger wallet" | docs-connect-a-wallet, 2 files |
| 28 | "**an** XRP Ledger wallet" | signin, 3 files |
| 29 | Mixed terminology inside one build: `trustline` ×637 vs `trust line` ×59 | 69 / 15 files |

On 29: "trust line" (two words) is the XRP Ledger's own term and "trustline" is Stellar's; the fork
inherited Stellar's spelling and newer copy uses XRPL's. Needs one decision applied everywhere.

## D. XRPL-only: metadata, titles, headings  (16 items) — **mostly FIXED 2026-10-07**

Fixed in `_xrplseo.js` (30, 34, 35, 36, 44), `_xrplmcptools.js` (40) and `_xrplbridgecopy.js` (38).
Live and verified on the per-deployment url.

* **30** bridge title → "Bridge Assets to 39 Networks from the XRP Ledger" — it had lost the count
  *and* read backwards, since this page sends *from* this ledger.
* **36** the LUMOS description now states the fee discount (0.2% → 0.1% at 250,000 LUMOS, so
  "halves" is exact). **44** the dashboard description now names Xaman, GemWallet, Crossmark and
  WalletConnect, as Stellar's names its five. **34/35** "Launchpad" restored to both launch steps.
* **40** was not a wrong number: the page said "Ten commands" and listed exactly ten. The server
  exposes **fourteen** (counted in `C:\LumosCore\mcp\tools.js`, and it is shared — `/mcp` serves both
  chains), so four tools were undocumented: `get_orderbook`, `list_curated_assets`, `list_blog_posts`,
  `get_blog_post`. Added, heading corrected, and the split now matches Stellar's 9 read / 5 write.
  Three descriptions are Stellar's verbatim; `list_curated_assets` is reworded, because Stellar's
  "every asset LumosCore curates" is false here — this build has no curated list.
* **38** was narrower than recorded: six of XRPL's seven map onto Stellar's, and its "Which bridges
  does LumosCore use here?" deliberately consolidates Stellar's two route-specific entries. Exactly
  one topic was absent — "How long does a transfer take?" — now added, with no invented durations:
  every figure in the answer is one `nibridge.js` already displays. Visible FAQ and the FAQPage
  schema verified in sync at 8 each.

**WITHDRAWN:** **33** (a literal em dash is correct UTF-8 and XRPL is internally consistent;
Stellar's `&#8212;` is the odd one). **41** ("Six capabilities" is accurate for that page's own
six-item grid). **37** — and Stellar is the one at fault: its account page has **zero** visible FAQ
items but ships FAQPage structured data with three questions, and they are the *pool* page's
questions. Invisible FAQ schema from the wrong page; XRPL having none is strictly better.

**The MCP page's dead setup instruction — FIXED 2026-10-07**, together with **39**.

Its only call to action was `npm i -g @lumoscore/mcp`, in a copy-to-clipboard pill, and that package
**does not exist** — the npm registry returns 404. So the one thing the page told anyone to do could
not be done. The real integration is the remote endpoint `https://lumoscore.com/mcp`, verified live
(it answers `tools/list` with all fourteen tools), and one server backs both chains. The pill now
carries that url, ported character for character from Stellar's: the same `lxh-install` markup with a
`›` in place of the shell `$`, because a url is not a command.

**It broke once before it held, and the reason is worth keeping.** The first version matched the
literal npm string. It worked, and the next `rebuild.js` undid it: `_xrplroutes` runs early and maps
`https://lumoscore.com/mcp` → `/mcp` → `/mcp/xrpl`, so the url came back a relative path, the literal
no longer matched, and nothing restored it. The pill then *displayed* the right url while the copy
button put `/mcp/xrpl` on the clipboard — useless in an MCP client and invisible on screen. It is now
matched by SHAPE and rewritten every run, which is self-healing; the chain reports 2 pills repaired
on each build because `_xrplroutes` mangles them mid-chain every time.

**39**: the three absent questions ("How do I connect it?", "What can it see?", "Does it cost
anything?") are added, taking the page from 3 to 6 — Stellar's count. Written against the verified
endpoint rather than the dead command, which is why they were parked until it was fixed. The fee line
is this platform's own rate. `_xrplmcptools.js` regenerates the FAQPage block from the visible pairs
itself, because it runs after `_xrplfaqld` in the chain and nothing downstream would mirror them —
without that this page would have acquired the exact fault item 37 found on Stellar's account page.
Verified live: 6 visible / 6 in schema, 14 cards, copy target and visible text identical.


| # | Finding | XRPL | Stellar |
|---|---------|------|---------|
| 30 | Bridge `<title>` lost the destination count **and reads the wrong direction** | "Bridge Assets to the XRP Ledger" | "Bridge Assets to 52 Chains from Stellar" |
| 31 | Sign-in `<title>` | "Connect a Wallet" | "Sign In" |
| 32 | Whitepaper `<h1>` is just the brand name | "LumosCore" | "Multichain Web3 Infrastructure" |
| 33 | Account `<title>` em dash is a literal char; Stellar uses the entity | `—` | `&#8212;` |
| 34 | Launch-confirm `<title>` dropped "Launchpad" | "Token Issued on …" | "Token Launched — … Launchpad" |
| 35 | Launch-review `<title>` dropped "Launchpad" | "Review Your … Token" | "Review Your Token — … Launchpad" |
| 36 | LUMOS page omits the fee-discount fact (it applies on XRPL too) | — | "holding 250,000+ LUMOS halves your trading fee" |
| 37 | Account page has **no FAQPage schema at all** | 0 | 3 questions |
| 38 | Bridge FAQ count | 7 | 9 |
| 39 | MCP FAQ count | 3 | 6 |
| 40 | MCP tool-count claim — the connected server exposes **14** tools, so verify which is right | "Ten commands, one server" | "Fourteen tools, one server" |
| 41 | MCP second h2 | "Six capabilities, one agent" | "Connect your agent" |
| 42 | Connect-a-wallet description dropped the count | "The supported … wallets" | "The **five** supported … wallets" |
| 43 | Launch-a-token description dropped the price | "what it costs" | "the flat **$25** cost" |
| 44 | Dashboard description names no wallet | — | "Connect Freighter, Rabet, Albedo, xBull or WalletConnect" |
| 45 | LUMOS page now carries an extra `<h2>LUMOS</h2>` | consequence of today's h1 demotion — harmless, noted so it isn't re-reported |

MCP missing FAQ topics vs Stellar: "How do I connect it?", "What can it see?", "Does it cost
anything?", "Which networks does it cover?"

## E. XRPL-only: section structure  (6 items) — **MOOT: none of these pages is served**

Established 2026-10-07: the XRPL build routes **15** page bases. These six items all sit on pages in
the other **28**, which are built but never routed — `/about`, `/privacy`, `/terms`, `/docs/*` and
`/whitepaper` all serve **Stellar's** copy, by the deliberate decision in `extract_site.js` ("They
exist once for the company"). Fixing XRPL's unrouted copies would change nothing anyone can load.
The same applies to items **27, 28, 31, 32, 42 and 43**.

Worth knowing rather than fixing: the XRPL build ships 28 page bases nobody can reach. That is not a
bug — it is what makes a one-line route change enough to publish any of them — but it does mean an
audit that compares files rather than urls will keep producing findings that do not matter. Items 19
and 21 of section A are in the same position (`asset-overview` is never emitted).

**51 WITHDRAWN:** docs-cross-chain's `Route / Carries / Reaches` header is a deliberate improvement
over Stellar's `From / To` for three routes, not drift.


| # | Finding |
|---|---------|
| 46 | About page h2s lost Stellar's `01`–`06` numbering |
| 47 | Privacy page h2s lost the `01`–`09` numbering |
| 48 | Terms page h2s lost the `01`–`11` numbering |
| 49 | About page is missing the product grid entirely (Stellar has h3s Trade / Liquidity Pools / Cross-Chain / Rewards / Launchpad / LUMOS) |
| 50 | docs-cross-chain dropped the "# Supported networks" section |
| 51 | docs-cross-chain table header is `Route / Carries / Reaches` vs Stellar's `From / To` — probably a deliberate improvement for 3 bridge routes; confirm |

## F. XRPL-only: navigation and internal linking  (1 item, wide blast radius) — **FIXED 2026-10-07**

| # | Finding |
|---|---------|
| 52 | ~~The Trade page has 12 distinct internal hrefs; Stellar's has 22. XRPL ships no static link to `about`, `blog`, `docs`, `faq`, `privacy`, `support`, `terms` or `whitepaper`.~~ **That description was wrong.** The links are all present — written as `https://lumoscore.com/...` absolutes, which is why a root-relative probe counted none. `_xrplroutes.js` wrote them that way deliberately and correctly: the standalone `lumoscore-xrpl` deploy does not route those 8 pages, so a bare `/docs` 404s there. The real fault is that in the **combined** deploy they are served from the same origin, so every one of those links walked a staging tester out of the build under test and into production, and spent 8 would-be internal links per page as off-site ones. **Fixed in `combine_with_stellar.js`, not in the repo** — the standalone build keeps the absolutes it needs; the combined tree gets root-relative. 1557 links across 93 pages, anchors plus 3 `onclick="location.href=…"` buttons. Anchors only by design: canonical / og:url / JSON-LD must keep naming production. Verified: all 8 return 200 with 0 redirect hops on the staging host. |

## G. Verified correct — no action  (6 items)

| # | Checked |
|---|---------|
| 53 | Wallet FAQ adapts per chain: "What are Checks?" vs "What are claimable payments?" — right |
| 54 | docs-trustlines "# Checks" vs "# Claimable balances" — right |
| 55 | `rel="nofollow"` coverage is **100%** on both builds (xrpl 4 external links, stellar 3, all nofollowed) |
| 56 | `canonical`, `robots`, `og:title`, `og:type`, `twitter:card` — **zero** differences across all 43 bases |
| 57 | No XRPL page contains a static link to a `/…/stellar` route (switcher is script-built, as intended) |
| 58 | No `<img>` without `alt`, and no empty `<button>` without `aria-label`, on either build |

## H. Not XRPL's to fix / not served  (4 items)

| # | Note |
|---|------|
| 59 | `index` + `landing` differ heavily (hero, Partners, From-the-blog). XRPL's landing is the outdated one and `combine_with_stellar.js` drops XRPL's `/`, so none of it serves. Out of scope by your instruction. |
| 60 | Stellar's double `<h1>` on 6 routes / 18 files — prompt supplied for your Stellar bugs file |
| 61 | Stellar's `/trade` h1 reads "Explore the Aptos DEX" on live production — prompt supplied |
| 62 | Stellar's Rewards page has the **same** h1 text twice ("LUMOS Rewards") |

## I. Open decisions, not bugs  (2 items)

| # | Needs your call |
|---|-----------------|
| 63 | Thin-market caution on Trade — **RESOLVED 2026-10-07, and it was not the feature it sounded like.** See below. |
| 64 | Trade-Asset: prefer the toml `website` or the ledger `Domain` field? |

### 63 — REVERTED SAME DAY. I broke it; the original was right.

**Read this before touching price-impact colour again.** Everything below the line was my reasoning
for changing it, and the conclusion was wrong.

The sign encodes DIRECTION and the colour follows the sign: a buy reads `+x%` in green, a sell reads
`-x%` in red, whatever the magnitude. That is what `|| buy` does, and it is deliberate. RAZA, the
same day: *"You've messed it up. When buying ... the asset will always show positive impact (+ sign
and green color). if sold ... the impact will always be in negative (- and red color)."*

How I got it wrong: I checked Stellar's **bridge** card ("price impact above 1%: amber") and assumed
it governed the swap pane. It does not — the counterpart is Stellar's own **swap**, and
lumoscore.com renders a 1000 XLM buy of LUMOS at **+18.72% in GREEN**. So magnitude-colouring was a
divergence from the build this fork exists to match, not a correction of one. The check I skipped was
the only one that mattered: compare the same surface, not a similar-sounding one.

`dxaswap.js` is back to `tone = (mag < 0.01 || buy) ? green : red`, verified in the deployed bundle,
and now carries a comment saying not to "fix" it.

**Still true and still unaddressed:** neither build says anything in WORDS next to a costly swap —
both signal with colour alone, and under this convention a buy is never coloured as costly however
large the impact. A worded caution is a real improvement, but it is a change to BOTH builds and a
product decision, not a parity fix.

---

<details><summary>Superseded reasoning (kept so the mistake is legible)</summary>

Scoping this meant first asking whether a thin-market warning was missing at all. It was not: both
builds compute price impact and signal it with colour, and **neither says anything in words** — so
building a worded caution on XRPL alone would have been a divergence, against the standing rule.
`dxaswap.js` already simulates the pair's AMM pool and order book to get an impact figure even where
`ripple_path_find` cannot route.

What was actually broken is the signal itself:

```js
tone = (mag < 0.01 || buy) ? green : red;      // before
```

`|| buy` coloured **every buy green regardless of size**. The line directly above it can render
`">+999,999%"` for a buy, and that was shown in the colour meaning "this is fine". Impact on a buy is
positive because you pay more, so a large one is precisely the case needing a flag; the old rule only
flagged the half of the market where the sign happened to be negative.

```js
tone = mag < 1 ? green : red;                  // after
```

Coloured by size, not direction. **1% is Stellar's own line**, lifted rather than invented — its
bridge card uses "price impact above 1%: amber, the one semantic colour on the card, so a costly swap
is noticed". This also loosens sells, which used to turn red at 0.01%; a tenth of a percent is not a
costly swap, and colouring it red is how a warning colour stops being read.

Behaviour change, exercised against both rules: buys at 2%, 50% and ∞ go green → **red**; sells at
0.5% go red → green; everything else unchanged. Verified in the deployed bundle.

</details>

---

**64 items. 48 are XRPL-only and actionable** (A, C, D, E, F); 7 are shared with Stellar (B);
6 are verified-correct; 4 are out of scope; 2 are decisions.

Fixed earlier today and excluded from the list above: the LUMOS double h1, the Trade hero reading
"DEX on Stellar", the sitemap's missing XRPL asset urls, and the Trade row links. Live on
`https://0b613084.lumoscore-staging.pages.dev`.
