# StillOS × ForeSeal Interoperability Test — Manifest
**Status: DRAFT, PRE-TEST, NOT YET EXECUTED. Bond currently UNFUNDED (see below) — nothing sends until Marcus approves funding and this manifest is re-hashed post-funding.**

- Manifest version: `foreseal-stillos-interop-v1`
- Date created: 2026-09-06
- Canonical JSON: `manifest.json` in this directory
- SHA-256 of canonical JSON: `163dcbcc48be37cfa37466eff990d9ebcb313e26a573b25a054ad6ef1fa14bde`
- Re-pinned 2026-09-07: StillOS commit updated to `b2efdea` (was `15d033c`) after a 39h auto-commit gate stall was found and fixed — no code content changed, checksums identical, only the commit hash moved forward.

## Parties
| | Implementation | Commit / identity |
|---|---|---|
| StillOS | Notary (`core/notary_service_marcus.cjs`) | `15d033c40b1c6a1407cd5350b6a1aa19084e20a2` |
| ForeSeal | as identified publicly by @0rkz, `x402-foundation/x402#2887` | `github.com/0rkz/foreseal-x402-conformance` — commit not yet supplied |

## Reference source (frozen before any funds move)
**python/cpython pull request #154769** — merged, deterministic, keyless, re-runnable by anyone, controlled by neither party.
- URL: https://github.com/python/cpython/pull/154769
- `merged: true`, `merged_at: 2026-07-27T14:00:20Z`
- `merge_commit_sha: c7b9a13a7528342fdac47a2121248f0b989131e5`
- Independently confirmed live against `api.github.com` on 2026-09-06 (see report).

## Claim & resolver
- Claim: "python/cpython pull request #154769 is merged."
- Resolver: `{type:'github_pr', owner:'python', repo:'cpython', number:154769}` — `core/general_resolvers.cjs :: resolveGithubPR()`, queries `api.github.com` keyless.
- Expected verdict: **CONFIRMED**. This fact is permanent (once merged, never changes).

## Lifecycle
1. ForeSeal → `POST /claim-verdict` (paid — see fees below; the free tier does **not** return a usable receipt, confirmed live).
2. StillOS returns a signed, hash-chained claim receipt + verdict receipt bound to the resolver above.
3. StillOS resolves against `api.github.com` in real time, verdict posted inline.
4. ForeSeal verifies **offline** — signature, hash, chain — against the pinned key below, zero callbacks to StillOS.
5. ForeSeal → `POST /dispute` ($1.00, no free tier) with `receipt_hash` + the exact `verdict_object` returned + the same resolver spec.
6. StillOS re-runs the same resolver fresh. **Expected: REJECTED** (the claim can't have changed) — this is a valid, successful exercise of the adjudication path, not a failed test.
7. If (unexpectedly) UPHELD: a slash directive is queued and a founder alert fires. It is **never auto-paid** — Marcus must separately review and run `notary_bond_slash.cjs --execute`.

**Explicit disclosure:** this dispute is a **scripted exercise of the adjudication path** against an objectively-true, unchangeable reference fact — not an attempt to manufacture a false original verdict. A REJECTED terminal state carries the same evidentiary value as UPHELD: both prove the real mechanism ran against a real external counterparty.

## Signing identity (offline-verifiable, pinned before funds move)
- Algorithm: Ed25519
- Current key ID (fingerprint): `21de066900082465`
- Current public key:
  ```
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEARz4QMQCVd+ImBqd3YmkIA3NYd857O+5dAWNhY7V2ryk=
  -----END PUBLIC KEY-----
  ```
- Historical registry: `GET https://stillosdigitalholdings.com/notary/keyring` (added 2026-09-06, this pass). The key has already rotated once (2026-06-27 → 2026-07-31); this endpoint lets any receipt, old or future, verify by its own `notary_fp` without ever trusting `/notary/health`'s current contents.
- Offline verifier (zero network calls at verify time): `notary-x402-reference-kit/verify-offline-pinned.js`.
- ForeSeal signing key: not yet supplied.

## Wallets
| Wallet | Address | Purpose |
|---|---|---|
| StillOS payTo (settlement/dispute fees) | `0xfAB07d26F7627fc4cE459ecf90d7E015F7eEcE71` | Receives x402 payments |
| StillOS bond (collateral/slash source) | `0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf` | Independently verifiable via `USDC.balanceOf` on Base |
| ForeSeal | not yet supplied | — |

## Fees (Base mainnet, USDC — `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals, chain id 8453)
| Step | Fee | Note |
|---|---|---|
| Settlement (`POST /claim-verdict`) | **$0.05** now, **$0.25** if run after 2026-10-13T00:00:00Z | Time-bound launch pricing, disclosed up front |
| Dispute (`POST /dispute`) | **$1.00** flat | No free tier, non-refundable either way |
| Gas | **$0 for ForeSeal** | x402 = EIP-3009 `transferWithAuthorization`, ForeSeal signs off-chain, StillOS's facilitator pays on-chain gas |
| Other | none | The $2.00 `/self-audit/dispute-entry` fee is a separate, unrelated product — out of scope |

**ForeSeal max outlay: $1.05 typical, $1.25 worst case. StillOS max outlay: ≤$1.00 bond slash (only if upheld, never automatic) + trivial gas. Combined hard stop: $2.00 — abort above that.**

## Bond status (the real, current gap)
- Publicly committed target: **$10.00 USDC**
- Per-verdict slash ceiling: **$1.00**
- **On-chain balance at manifest creation: $0.00 — `active: false`.** Independently confirmed via direct Base RPC call, not StillOS's own reporting.
- Funding proposal is pending Marcus's approval (see accompanying report). This manifest will be **re-hashed and re-published** the moment the bond is funded, before ForeSeal is asked to send anything.

## Expected terminal states
- Settlement settles on Base; payer wallet ≠ any StillOS-controlled address.
- Verdict: CONFIRMED.
- Offline verification: signature + hash + chain all valid, zero network calls.
- Dispute: REJECTED (expected) or UPHELD (queues a non-automatic slash directive).

## What this is not
This is **not** a partnership, endorsement, customer relationship, or commercial integration. Both parties publish results independently; divergences are published, not hidden; neither party represents the outcome before both reports exist. This is an **n=1** controlled test — neither party may cite it as statistical validation or general production reliability.

## Hard stops
Abort immediately if: the resolver isn't frozen in writing before step 1; any exposure exceeds $2.00 combined; the payer wallet is StillOS-controlled; the settlement amount or resolver target don't match this manifest; or any money movement beyond what's explicitly authorized here is attempted.
