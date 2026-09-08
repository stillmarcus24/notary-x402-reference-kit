# StillOS Notary — Interop Fee Schedule V1

Every paid step an external counterparty (ForeSeal or otherwise) would encounter running the full StillOS Notary correctness lifecycle. All figures confirmed live against production on 2026-09-08 — see `CURRENT_STATE_2026-09-08.md`. Machine-readable equivalent: live `GET https://nolawealthfinancial.com/notary/.well-known/x402.json` (standard x402 discovery format, covers every paid route on the service, not just the interop-relevant subset below).

## Network / token (applies to every fee below)

| | |
|---|---|
| Chain | Base mainnet (chain id `8453`) |
| Asset | USDC |
| Token contract | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Decimals | 6 |
| Payment mechanism | x402 `exact` scheme, EIP-3009 `transferWithAuthorization` — the payer signs an off-chain authorization and pays **zero gas**; StillOS's facilitator submits the on-chain transfer and pays Base gas on both settlement and dispute-fee collection. |
| `payTo` (settlement + dispute fees land here) | `0xfAB07d26F7627fc4cE459ecf90d7E015F7eEcE71` — StillOS's operational revenue wallet. **Not** the bond wallet. |

## Lifecycle steps and their fees

| Step | Endpoint | Fee | Free tier | Notes |
|---|---|---|---|---|
| Commit a claim hash | `POST /commit` | **$0.10** | none | Tamper-evident sealed-claim receipt only — `authoritative: false`. Not required for the ForeSeal correctness-lifecycle test (that uses `/claim-verdict` directly, which also produces a claim receipt as its first step). |
| Signed claim verdict (resolved against external ground truth) | `POST /claim-verdict` | **$0.05** until `2026-10-13T00:00:00Z`, **$0.25** after | 3/agent/day + reputation bonus | The step ForeSeal's bilateral test actually uses. Launch pricing is time-bound and disclosed here specifically so the number cannot surprise either party mid-test. **The free tier does not return a usable `verdict_receipt` hash/signature — confirmed live; a real interop test must use the paid path.** |
| File a bonded dispute | `POST /dispute` | **$1.00 flat** | **none** | Non-refundable either way (anti-spam design by construction, disclosed up front, not a hidden gotcha). Resolved by an independent re-run of the original resolver spec against the same cited source — never StillOS's own judgment call. |

## Maximum exposure, both sides

| Party | Max outlay | Composition |
|---|---|---|
| Counterparty (e.g. ForeSeal) | **$1.05 typical** (**$1.25** if run after 2026-10-13) | `/claim-verdict` ($0.05 or $0.25) + `/dispute` ($1.00) |
| StillOS | **≤ $1.00** (bond slash) | Only if the dispute is **UPHELD** on independent re-run. Requires a separate, explicit, human-run `notary_bond_slash.cjs --execute` — never automatic, never triggered by the dispute filing itself. Plus trivial Base gas, already covered by the bond wallet's existing ETH balance (see `notary_bond.cjs::GAS_FLOOR_ETH`). |
| **Combined hard stop** | **$2.00** | Abort the exercise if either side's real exposure would exceed this. |

## Explicitly out of scope for an interop test

`POST /self-audit/dispute-entry` ($2.00) is a separate, unrelated product surface (a self-audit correction bounty pool) and has nothing to do with the correctness-lifecycle test. Any other paid route on the service (`screen-entity`, `screen-url`, `grade-strategy`, etc. — see the live `/.well-known/x402.json` for the full 26-route list) is likewise unrelated to this specific bilateral test.

## What is NOT priced here

Base network gas paid by StillOS's facilitator on settlement/dispute-fee collection is a real StillOS operating cost but is not charged to the counterparty and has no fixed dollar figure — it floats with Base gas prices. Not part of either side's "exposure cap" above; disclosed here only so it isn't mistaken for a hidden fee charged to the counterparty (it is not — the counterparty pays zero gas by construction of the EIP-3009 flow).
