# StillOS × ForeSeal Interoperability Test — Bilateral Terms V1

**Status: FROZEN TERMS, BOND FUNDED. Re-published 2026-09-09 with a confirmed on-chain balance: `active: true`, `onchain_balance_usd: 10.789999` against `bonded_usd: 10`. Custody moved to a 2-of-2 Safe in the same pass — see Wallets and the custody note in Precondition 1 below. That change is material to condition 1 and is stated here rather than left to be discovered.**

This document restates, in full, the terms 0rkz/ForeSeal set on `x402-foundation/x402#2887` (2026-07-28) as preconditions to a bilateral test, and pins every value either side needs before funds move. It supersedes nothing informally agreed elsewhere — this file and the machine-readable `manifest/manifest.json` at `still-os-consciousness/docs/x402-2887/manifest/` (canonical JSON, SHA-256 `163dcbcc48be37cfa37466eff990d9ebcb313e26a573b25a054ad6ef1fa14bde` as of 2026-09-06) are the source of truth.

- Terms version: `foreseal-stillos-interop-v1`
- Originally drafted: 2026-09-06
- Re-verified against live production: **2026-09-08** (this pass) — zero drift found, see `CURRENT_STATE_2026-09-08.md`
- **StillOS implementation pin: tag `foreseal-bilateral-v1` in this repository.**
  A tag, not a branch head, so it cannot drift. The tag resolves to the commit that
  contains both the published implementation and this corrected document; resolve the
  tag rather than any SHA quoted in prose, which is how the previous four pins went stale.

  **Correction, 2026-09-10.** Every pin this document previously carried —
  `0ee96f44c758…`, `e63b3e97687d…`, `38ad5fee0ef3…` and the 2026-09-08 pin
  `10f2a2d99103…` — was a commit in a local repository with no remote configured
  (`/home/marcus/core`). **None of the four was ever publicly fetchable**, as ForeSeal
  established on 2026-09-10 by getting HTTP 422 "No commit found for SHA" from the
  commits endpoint while a control SHA from this repository resolved normally.
  Re-pointing the pin could never have fixed that, because the implementation itself
  was not published. It is now: see `implementation/bond/` in this repository, which
  carries the bond record, the slash path, the dispute resolver and the monitors —
  the code required to assess whether 2-of-2 custody is material to Condition 1.
  No key material is included; the signing key is read at runtime from
  `AGENT_WALLET_ENV` or `AGENT_WALLET_PRIVATE_KEY`.

  **This pin move is disclosed rather than made silently, and unlike the previous two it is NOT confined to the bond path — it changes notary response behaviour.** Two defects were found and fixed the same day, both in code ForeSeal would exercise during the bilateral test:

  1. **The 402 payment challenge was advertising this bond as unfunded.** `TRUST_SUFFIX` — the bond sentence appended to every paid route's `description`, and therefore carried inside the 402 body ForeSeal receives at lifecycle step 1 — was computed once at process boot from a status cache that is empty at boot by design. The cold read always answers `inactive`, so every paid endpoint asserted "Correctness bond currently INACTIVE (unfunded)" for the life of the process, regardless of the real on-chain balance. **Condition 1 above was in fact satisfied while this endpoint said otherwise.** Fixed in `core/notary_bond.cjs`: each successful refresh is persisted and a cold process seeds from the last real on-chain observation, trusted only while under 6h old. With no recent observation it still answers inactive — the conservative direction is preserved. Verified live: `POST /dispute` now returns `Backed by a $10 on-chain correctness bond, up to $1 slashable per proven-wrong verdict`.
  2. **An unpaid request for a paid resource returned 400 instead of 402.** A request with no `agent` field — including the bare `{}` probe an implementer or a directory crawler would send first — was rejected before reaching the payment challenge, so `accepts[]` was never served. Fixed at the single response chokepoint. Scope is deliberately narrow: only the missing-agent error converts, a caller who supplies `agent` and then sends a malformed body still receives an honest 400, and the two genuinely free endpoints (`/register-policy`, `/authorize`) still return 400 because a 402 there would be a new false claim. Verified live across all 27 paid endpoints.

  **What did not change:** signing, hash-chaining, the resolver set, `/dispute` adjudication semantics, the fee schedule, and the claim/verdict record format are untouched by this commit. The frozen digest contract in `STILLOS_NOTARY_RECEIPT_V1.md` is unaffected, and the 1 positive + 6 negative vectors in `vectors/` still pass against `verify-offline-pinned.js` on this commit. A third commit `0ee96f4...` followed, replacing 95 hardcoded references to the operator's previous domain (`nolawealthfinancial.com`) so the notary emits its canonical URL at the source rather than relying on a rewriting proxy to correct it in flight. Public responses were already correct before this change; it removes a single point of failure behind them, and does not alter any price, key, resolver or receipt field. ForeSeal should verify against tag `foreseal-bilateral-v1` before running the test; if ForeSeal considers a change to 402 emission material to terms already frozen, that is theirs to re-open.

## Parties

| | Implementation | Identity |
|---|---|---|
| StillOS | Notary (`core/notary_service_marcus.cjs`); bond path published at `implementation/bond/` | tag `foreseal-bilateral-v1` → `cd0c3f630f92…` |
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
