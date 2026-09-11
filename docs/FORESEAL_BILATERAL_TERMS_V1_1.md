# StillOS × ForeSeal Interoperability Test — Bilateral Terms V1.1

**Supersedes `FORESEAL_BILATERAL_TERMS_V1.md` (tag `foreseal-bilateral-v1`, commit `c68e06aa2d690c24f0e271d5b714aac25482cb11`), which remains published and fetchable for audit. It has not been moved, rewritten, or deleted.**

V1 was corrected on 2026-09-10 after ForeSeal established that all four of its prior implementation pins were unfetchable. That correction was real but incomplete: it fixed the prose and left the canonical machine-readable manifest — the file the terms themselves named as the source of truth — still asserting a retired bond wallet, a $0 unfunded bond, a local unfetchable commit, and a bilateral agreement that was never made. StillOS found those in a self-audit of its own frozen package on 2026-09-11. They are listed in full in [`SUPERSESSION.json`](../SUPERSESSION.json) and corrected here.

- Terms version: `foreseal-stillos-interop-v1.1`
- Canonical source of truth: [`manifest/manifest.json`](../manifest/manifest.json). **This document is checked against it** by `tools/check-consistency.cjs`. On any disagreement, the manifest wins and the disagreement is a defect.
- Originally drafted 2026-09-06 · corrected 2026-09-11

## How to pin this package

```
git rev-list -n1 foreseal-bilateral-v1.1
# or: GET https://api.github.com/repos/stillmarcus24/notary-x402-reference-kit/tags
```

**The versioned tag identifies the release; the resolved commit SHA is the immutable object being reviewed.**

This document does not quote its own commit SHA, deliberately. V1 did, in its Parties table — it claimed the tag resolved to `cd0c3f630f92…` when the tag actually resolved to `c68e06aa2d69…`. A document cannot contain its own hash, and pretending otherwise is how that pin went stale inside the very commit that was fixing stale pins. Resolve the tag yourself and record what you get. Verify content against the per-file `sha256` checksums in the manifest, which are self-verifying and independent of any commit hash.

**Retraction.** V1 said of the tag: *"A tag, not a branch head, so it cannot drift."* That was an overclaim and is withdrawn. This repository has **zero rulesets and no branch or tag protection** — verifiable with `GET /repos/stillmarcus24/notary-x402-reference-kit/rulesets`, which returns `[]`. A git tag is movable by anyone with write access. Nothing mechanically prevents `foreseal-bilateral-v1.1` from being repointed later. The commit SHA you resolve is the thing that cannot change; the tag is a convenience.

## Success criterion — corrected

**Withdrawn.** V1 stated, in both the prose and the manifest, that *"A REJECTED terminal state carries the same evidentiary value as UPHELD"* and that *"Neither party will characterize a REJECTED outcome as a failed test."* Presented as a bilateral term, that was false. **ForeSeal agreed to no such thing.** 0rkz agreed to exercise the adjudication path; he did not pre-agree a terminal state, and he corrected the attribution publicly. The attribution is withdrawn from this document and from the manifest.

**The bilateral criterion is procedural, not outcome-based:**

> Both parties execute the frozen lifecycle, independently verify the resulting artifacts, and publish their observations and any divergences — without pre-agreeing a terminal outcome.

**StillOS's local expectation, recorded separately and in advance so it can be checked against the result:** because the reference fact is permanently true, StillOS expects the dispute re-run to agree with the original verdict and therefore to terminate REJECTED. That is StillOS's own prediction. It is not binding on ForeSeal, and ForeSeal is free to characterize any outcome however its own review supports.

## Preconditions ForeSeal named (2026-07-28) — status of each

| # | ForeSeal's condition | Status |
|---|---|---|
| 1 | Bond funded and `/notary/bond` reports active | **Funded — materiality is ForeSeal's call.** `10.789999` USDC against a bonded `10.00`, observed 2026-09-11T16:30:21Z by direct `eth_call` to Base. Two disclosures below are material to this condition and StillOS does not assert the condition is satisfied on ForeSeal's behalf: custody is **single-person-multidevice**, and there is **no committed payout SLA**. See both sections. |
| 2 | Complete fee schedule for every lifecycle step, capped | **MET.** See `FEE_SCHEDULE_V1.md` and the manifest's `fees` block. |
| 3 | Signing keys pinned in public terms before funds move | **MET.** Fingerprint `21de066900082465`, key in `keys/`, historical registry at `GET https://stillosdigitalholdings.com/notary/keyring`. |
| 4 | Wallet addresses, claim text, dispute semantics, amounts, publication obligations fixed in writing | **MET** — manifest + below. |
| 5 | Both sides' maximum total outlay explicit | **MET.** ForeSeal ≤ $1.05 typical / $1.25 after 2026-10-13. StillOS ≤ $1.00. Combined hard stop $2.00. |

## Custody — stated precisely, because the imprecise version favoured us

Collateral is held in a **2-of-2 Gnosis Safe v1.4.1** at `0x6243E363a3047173346Fa49C947Db204D4445634` on Base. Read it yourself with `getOwners()` and `getThreshold()`.

| Owner | Attribution |
|---|---|
| `0x9061D5097C4c42D54693407Ce73923b76Df844F9` | Marcus Still — phone (MetaMask) |
| `0xe173379d7aAD714Ae1Db1041Fa6E5c0D6F613F83` | StillOS box signer — key file on the StillOS host |

**Classification: `SINGLE_PERSON_MULTIDEVICE`. Not `MULTIPARTY`.**

Both owners are attributable to the same person from StillOS's own published records. A different address is not an independent party, and this package does not claim otherwise. The two benefits are separate and only one of them is yours:

- **Security benefit — real.** Compromising the StillOS host, *including root on it*, cannot move the collateral: the box holds one of the two required signatures. This materially raises the cost of stealing the bond, and it is independently checkable.
- **Counterparty-governance benefit — none.** Both keys are held by one person. No independent party can compel, co-sign, or veto a payout. Multisig here protects the collateral **from theft**; it gives a counterparty **no additional assurance** that an adjudicated debt gets paid.

**Therefore:** this is a self-custodied bond with hardened custody, **not a trustless escrow contract**. "Slashable" in this package means *a bonded payout obligation subject to 2-of-2 governed execution*. It does not mean an instant or trustless slash, and no wording here should be read as claiming that.

## What happens between "owed" and "paid"

0rkz asked what happens to a claim while it waits for the second signature. At tag `foreseal-bilateral-v1` the honest answer was **nothing durable**: the slash directive was an in-memory object plus a best-effort alert inside a swallowed `try/catch`, never persisted — and the live `/dispute` handler did not even forward it to the caller. Under single-key custody that was survivable. Under 2-of-2 the interval is unbounded, so it is not.

An **UPHELD** dispute now opens a durable obligation **synchronously, inside the request, before the reputation write, before any alert, and before any signature is sought** (`implementation/bond/slash_obligations.cjs`). It is deliberately not wrapped in a `try/catch`: if the debt cannot be recorded, the request fails loudly rather than returning a successful-looking overturn with no record that money is owed.

```
SLASH_OWED ──▶ AWAITING_MULTISIG ──▶ PAID
     └──────────── OVERDUE ◀────────────┘  (derived from elapsed time, not a cron)
```

Recorded per obligation: `obligation_id`, `verdict_receipt_hash`, `dispute_receipt_hash`, `disputant`, `amount_usd`, `owed_at`, `custody_type`, `bond_wallet`, `asset_contract`, `network`, `payout_calldata`, `safe_tx_hash`, `payout_tx`, `state`.

The ledger is append-only and hash-chained; current state is a **fold over events**, never a mutable field, so a state cannot be silently rewritten. `OVERDUE` is **derived at read time** rather than written by a scheduled job — a stored flag is only as reliable as the cron that sets it.

`payout_calldata` records the exact ERC-20 transfer the Safe must execute, so you can verify what *should* be signed instead of trusting a later description of it. **Recording calldata is not proposing or signing it.** StillOS does not auto-propose Safe transactions.

`PAID` is only written after an on-chain payout is verified: `notary_bond_slash.cjs --record-external` re-reads the transaction receipt and requires a real USDC `Transfer` of the stated amount from the bond wallet to the disputant before it will record anything.

### Payout SLA: **NO FROZEN PAYOUT SLA**

StillOS does not commit to an end-to-end payout deadline.

Payment needs 2 of 2 signatures. One key sits on the box and could be signed programmatically. The other is on **one human's phone, with no backup signer, no second human, and no on-call rotation.** A deadline that depends on one person being awake is not one StillOS can mechanically honour, and publishing it would be exactly the kind of unbacked claim this bond exists to make expensive.

**What is committed instead:** the obligation is recorded durably and synchronously at adjudication, is independently inspectable from that moment, and reports `OVERDUE` after **72 hours**. That threshold is a **visibility guarantee — you will be able to see that we are late — not a payment guarantee, and not an SLA.** It is labelled as such in the manifest (`overdue_threshold_is_a_committed_sla: false`).

**Whether the absence of a payout SLA leaves Precondition 1 unsatisfied is ForeSeal's assessment, not StillOS's.**

## Bond health — funded is not the same as current

Enough USDC in the Safe no longer implies every economic obligation is current. Before this revision, health was computed from balance + gas floor + slash-log integrity, all of which stay green while an adjudicated unpaid debt sits outstanding. These are now four separately readable facts:

`collateral_funded` · `slash_log_intact` · `obligation_ledger_intact` · `unpaid_slash_obligations` / `overdue_slash_obligations` → `all_slash_obligations_current`

A funded Safe carrying an overdue unpaid slash **does not** report healthy.

These are exposed on `GET /bond` itself — the endpoint you would actually call — not only inside an internal health check. `active` keeps its original balance-only meaning (is collateral posted); `bond_current` is the one that also requires the obligation ledger intact and nothing overdue. `committed_payout_sla` is present and `null`, so the absence of an SLA is a field you can read rather than a silence you have to notice.

An upheld `POST /dispute` likewise returns a `payout_obligation` block — `obligation_id`, state, amount, payee, `owed_at`, custody type, and the exact payout calldata — so the disputant learns a debt exists from the same response that overturns the verdict.

## Reference source (frozen before any funds move)

**python/cpython pull request #154769** — merged, deterministic, keyless, re-runnable by anyone, controlled by neither party. Nominated by 0rkz on his own neutrality terms: *"from outside this foundation's org... a repository neither of us has any relationship with."*

- URL: https://github.com/python/cpython/pull/154769
- `merged: true`, `merged_at: 2026-07-27T14:00:20Z`
- `merge_commit_sha: c7b9a13a7528342fdac47a2121248f0b989131e5`

## Claim & resolver

- Exact claim text: **"python/cpython pull request #154769 is merged."**
- Resolver: `{type:'github_pr', owner:'python', repo:'cpython', number:154769}` — `core/general_resolvers.cjs :: resolveGithubPR()`, queries `api.github.com` keyless.
- StillOS's expected verdict: **CONFIRMED**. Permanent fact — once merged, cannot change.

## Lifecycle

1. ForeSeal → `POST /claim-verdict` from a ForeSeal-controlled wallet, paying the x402-quoted price. **The free tier does not return a usable receipt — must use the paid path.**
2. StillOS returns a signed, hash-chained claim receipt + verdict receipt, both bound to the resolver above.
3. StillOS resolves against `api.github.com` in real time; verdict posted inline in the same response.
4. ForeSeal verifies **entirely offline** — signature, hash, chain — against the pinned key(s) in `keys/`, zero callbacks to StillOS. Reference implementation: `verify-offline-pinned.js`.
5. ForeSeal → `POST /dispute` ($1.00, no free tier) with `verdict_receipt_hash` + the exact `verdict_object` returned + the same resolver spec + counter-evidence/reason. Optionally `disputant_wallet` — the 0x address a payout would go to.
6. StillOS re-runs the same resolver spec fresh and compares the fresh label to the original. **The terminal state is whatever that comparison produces.** No outcome is pre-agreed.
7. If **UPHELD**: a durable obligation opens in `SLASH_OWED` before anything else. Payment requires a human 2-of-2 signature, has no committed deadline, and is never automatic.

Dispute guards, unchanged from V1 and re-verified: the supplied `verdict_object` must hash to the receipt's committed `claim_sha256`; the fresh re-run's `settles_against` must equal the original's; an unreachable source returns INDETERMINATE and is retryable, never a refutation; duplicate disputes are deduped to a single receipt and a single obligation. Dispute window: **48 hours** from the original verdict receipt's timestamp.

## Wallets

| Wallet | Address | Purpose |
|---|---|---|
| StillOS payTo (settlement + dispute fees) | `0xfAB07d26F7627fc4cE459ecf90d7E015F7eEcE71` | Receives x402 payments. Not the bond wallet. |
| StillOS bond (collateral / slash source) | `0x6243E363a3047173346Fa49C947Db204D4445634` | 2-of-2 Gnosis Safe v1.4.1 on Base. Owners and threshold readable on-chain. |
| StillOS gas relayer | `0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf` | Formerly the single-key bond wallet; retired as collateral custody 2026-09-09. Lands payout transactions, pays Base gas, holds no collateral. |
| ForeSeal | not supplied | — |

## Fees, exposure caps, hard stops

Full breakdown in `FEE_SCHEDULE_V1.md` and the manifest's `fees` block.

| Step | Amount |
|---|---|
| `POST /claim-verdict` | **$0.05** until 2026-10-13, **$0.25** after (time-bound launch pricing, disclosed so the number cannot surprise either party mid-negotiation) |
| `POST /dispute` | **$1.00** — no free tier, non-refundable either way (anti-spam design) |
| Gas | ForeSeal pays **zero**. x402 uses EIP-3009 `transferWithAuthorization`: ForeSeal signs off-chain, StillOS's facilitator submits and pays Base gas on both settlement and dispute-fee collection. Payout gas is borne by the gas relayer, not the Safe. |

**ForeSeal max outlay $1.05 typical / $1.25 if run after 2026-10-13. StillOS max outlay ≤$1.00 bond slash, only if upheld, never automatic. Combined hard stop $2.00 — abort above that.**

Abort immediately if: the resolver isn't frozen in writing before step 1; any exposure exceeds $2.00 combined; the payer wallet turns out to be StillOS-controlled; the settlement amount or resolver target don't match the manifest; or any money movement beyond what's explicitly authorized is attempted.

## Publication terms

- Both parties publish independently and in full, divergences included.
- Neither writeup is subject to the other's review.
- Neither side cites the exercise anywhere — including to the x402 TSC — until both writeups are published.
- Not a partnership. Not an endorsement. Not a customer relationship. Not a commercial integration.
- **n=1 disclosure**: a single controlled test. Neither party may cite it as statistical validation, general production reliability, or as the other party endorsing the implementation.

## Verifying this package

```
node tools/check-consistency.cjs        # manifest ⇄ this document, on every field that has drifted before
node tools/test-slash-obligations.cjs   # obligation state machine, 34 transition tests, no StillOS box required
node verify-offline-pinned.js           # 1 positive + 6 negative receipt vectors, zero network calls
```
