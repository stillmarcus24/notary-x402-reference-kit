# StillOS × ForeSeal Interoperability Test — Bilateral Terms V1

**Status: FROZEN TERMS, BOND FUNDED. Re-published 2026-09-09 with a confirmed on-chain balance: `active: true`, `onchain_balance_usd: 10.789999` against `bonded_usd: 10`. Custody moved to a 2-of-2 Safe in the same pass — see Wallets and the custody note in Precondition 1 below. That change is material to condition 1 and is stated here rather than left to be discovered.**

This document restates, in full, the terms 0rkz/ForeSeal set on `x402-foundation/x402#2887` (2026-07-28) as preconditions to a bilateral test, and pins every value either side needs before funds move. It supersedes nothing informally agreed elsewhere — this file and the machine-readable `manifest/manifest.json` at `still-os-consciousness/docs/x402-2887/manifest/` (canonical JSON, SHA-256 `163dcbcc48be37cfa37466eff990d9ebcb313e26a573b25a054ad6ef1fa14bde` as of 2026-09-06) are the source of truth.

- Terms version: `foreseal-stillos-interop-v1`
- Originally drafted: 2026-09-06
- Re-verified against live production: **2026-09-08** (this pass) — zero drift found, see `CURRENT_STATE_2026-09-08.md`
- StillOS implementation commit (as of this re-publication): `38ad5fee0ef3171b3559232da67c88c0d00a00e4` (nested repo at `/home/marcus/core`) — two commits ahead of the 2026-09-08 pin (`10f2a2d9910338bd178c51d0063b34c0cdd1b198`). Both are confined to the bond path: the gas-floor check was relocated to the declared gas relayer (a Safe holds no ETH by design), and a `--record-external` path was added so a multisig payout can be verified on-chain and written into the hash-chained slash log. Zero change to notary, dispute, resolver or signing code.

## Parties

| | Implementation | Identity |
|---|---|---|
| StillOS | Notary (`core/notary_service_marcus.cjs`) | commit `38ad5fee...` |
| ForeSeal | as identified publicly by @0rkz, `x402-foundation/x402#2887` | `github.com/0rkz/foreseal-x402-conformance` — commit not yet supplied by ForeSeal |

## Preconditions ForeSeal named (2026-07-28) — status of each

| # | ForeSeal's condition | Status |
|---|---|---|
| 1 | Bond funded and `/notary/bond` reports active | **MET (2026-09-09).** `active: true`, `onchain_balance_usd: 10.789999` vs `bonded_usd: 10`, verified by direct `eth_call` to Base mainnet. **Material change disclosed with it:** collateral is held in a 2-of-2 Gnosis Safe, not the single-key EOA pinned in the prior revision. A slash payout therefore requires a human 2-of-2 signature and is not instant. The obligation to pay an adjudicated overturn is unchanged — custody governs who may move the collateral, not whether it is owed. If ForeSeal assesses multisig custody as material to this condition, it is theirs to re-open and this row reverts to NOT MET. |
| 2 | Complete fee schedule for every lifecycle step, capped | **MET.** See `FEE_SCHEDULE_V1.md`. |
| 3 | Signing keys pinned in public terms before funds move | **MET.** See `signing_identity` below and `keys/README.md`. |
| 4 | Wallet addresses, claim text, dispute semantics, amounts, publication obligations fixed in writing | **MET** — all below. |
| 5 | Both sides' maximum total outlay explicit | **MET** — see `exposure_caps` below. |

## Reference source (frozen before any funds move)

**python/cpython pull request #154769** — merged, deterministic, keyless, re-runnable by anyone, controlled by neither party.
- URL: https://github.com/python/cpython/pull/154769
- `merged: true`, `merged_at: 2026-07-27T14:00:20Z`
- `merge_commit_sha: c7b9a13a7528342fdac47a2121248f0b989131e5`
- Nominated by 0rkz on the same neutrality terms he specified: "from outside this foundation's org... a repository neither of us has any relationship with."

## Claim & resolver

- Exact claim text: **"python/cpython pull request #154769 is merged."**
- Resolver: `{type:'github_pr', owner:'python', repo:'cpython', number:154769}` — `core/general_resolvers.cjs :: resolveGithubPR()`, queries `api.github.com` keyless.
- Expected verdict: **CONFIRMED**. Permanent fact — once merged, cannot change.

## Lifecycle

1. ForeSeal → `POST /claim-verdict` from a ForeSeal-controlled wallet, paying the x402-quoted price (see `FEE_SCHEDULE_V1.md`). **The free tier does not return a usable receipt — confirmed live; must use the paid path.**
2. StillOS returns a signed, hash-chained claim receipt + verdict receipt, both bound to the resolver above.
3. StillOS resolves against `api.github.com` in real time; verdict posted inline in the same response.
4. ForeSeal verifies **entirely offline** — signature, hash, chain — against the pinned key(s) in `keys/`, zero callbacks to StillOS. Reference implementation: `verify-offline-pinned.js` (this repo).
5. ForeSeal → `POST /dispute` ($1.00, no free tier) with `receipt_hash` + the exact `verdict_object` returned + the same resolver spec + counter-evidence/reason.
6. StillOS re-runs the same resolver spec fresh, right now, and compares the fresh result to the original verdict.
7. **Expected: REJECTED** (the claim cannot have changed — this is a valid, successful exercise of the adjudication path, not a failed test). If UPHELD (unexpected): a slash directive is queued and a founder alert fires; **never auto-paid** — requires a separate, explicit, human-run `notary_bond_slash.cjs --execute`.

**Explicit disclosure, stated plainly so it cannot be mischaracterized after the fact:** this dispute is a **scripted exercise** of the intake → re-run → terminal-state path against an objectively-true, unchangeable reference fact — not an attempt to manufacture a false original verdict. A REJECTED terminal state carries the same evidentiary value as UPHELD: both prove the real mechanism ran against a real external counterparty. Neither party will characterize a REJECTED outcome as a failed test.

## Signing identity

- Algorithm: Ed25519
- Current key fingerprint: `21de066900082465`, active since `2026-07-31T00:09:13.684Z`
- Public key: see `keys/stillos-notary-ed25519-v1.pub`
- Historical registry (live): `GET https://nolawealthfinancial.com/notary/keyring`
- Offline verifier (zero network calls at verify time): `verify-offline-pinned.js`, this repo
- ForeSeal signing key: not yet supplied

## Wallets

| Wallet | Address | Purpose |
|---|---|---|
| StillOS payTo (settlement + dispute fees) | `0xfAB07d26F7627fc4cE459ecf90d7E015F7eEcE71` | Receives x402 payments. Not the bond wallet. |
| StillOS bond (collateral / slash source) | `0x6243E363a3047173346Fa49C947Db204D4445634` | 2-of-2 Gnosis Safe on Base. Independently verifiable via `USDC.balanceOf`; owners and threshold are readable on-chain. Prior address `0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf` retired as collateral custody 2026-09-09 and now serves only as the gas relayer that lands payout transactions. |
| ForeSeal | not yet supplied | — |

## Fees, exposure caps, hard stops

See `FEE_SCHEDULE_V1.md` for the full breakdown. Summary: **ForeSeal max outlay $1.05 typical / $1.25 if run after 2026-10-13. StillOS max outlay ≤$1.00 bond slash, only if upheld, never automatic. Combined hard stop $2.00 — abort above that.**

Abort immediately if: the resolver isn't frozen in writing before step 1; any exposure exceeds $2.00 combined; the payer wallet turns out to be StillOS-controlled; the settlement amount or resolver target don't match this document; or any money movement beyond what's explicitly authorized here is attempted.

## Publication terms

- Both parties publish independently and in full, divergences included.
- Neither writeup is subject to the other's review.
- Neither side cites the exercise anywhere — including to the x402 TSC — until both writeups are published.
- Not a partnership. Not an endorsement. Not a customer relationship. Not a commercial integration.
- **n=1 disclosure**: this is a single controlled test. Neither party may cite it as statistical validation, general production reliability, or that the other party endorses the implementation.

## What happens next

This document, `keys/`, `vectors/`, `verify-offline-pinned.js`, and `docs/STILLOS_NOTARY_RECEIPT_V1.md` are being published to this public repository so ForeSeal (or anyone else) can independently verify every claim above without asking StillOS for anything. The one remaining precondition (#1, bond funding) is a Marcus-approval-gated action, prepared but not yet executed — see `READINESS_REPORT_V1.md`. Once funded, this document is re-published noting the new on-chain balance, and StillOS will reply on `x402-foundation/x402#2887` with evidence, not another description.
