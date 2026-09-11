# ForeSeal × StillOS Interop Manifest — human-readable rendering

**GENERATED FILE — do not edit.** Produced from `manifest.json` by `tools/seal-manifest.cjs`.
`manifest.json` is canonical; this file exists only to be readable.

- Version: `foreseal-stillos-interop-v1.1` (supersedes `foreseal-stillos-interop-v1`)
- Status: **TERMS_FROZEN — TEST NOT YET EXECUTED**
- Release tag: `foreseal-bilateral-v1.1` — resolve with `git rev-list -n1 foreseal-bilateral-v1.1  — or GET https://api.github.com/repos/stillmarcus24/notary-x402-reference-kit/tags`
- Canonical manifest SHA-256: `f2eec1be7cd3dff1bc76937c56b7d639d05a1f149dd479c2157d634ef091bae0`

## Tag immutability

The versioned tag identifies the release; the resolved commit SHA is the immutable object being reviewed.

Tag mechanically protected: **no**. This repository has zero rulesets and no branch/tag protection (verifiable: GET /repos/stillmarcus24/notary-x402-reference-kit/rulesets returns []). A git tag is therefore movable by anyone with write access. Tag foreseal-bilateral-v1 said 'A tag, not a branch head, so it cannot drift' — that was an overclaim and is retracted. The durable identifier is the commit SHA you resolve, plus the checksums below. Record the SHA when you resolve it; do not rely on the tag alone.

## Success criterion

**Bilateral:** Both parties execute the frozen lifecycle below, independently verify the resulting artifacts, and publish their observations and any divergences. No terminal outcome is pre-agreed by either party.

**No terminal state is pre-agreed:** true

**StillOS local expectation (not a bilateral agreement):** Because the reference fact is permanently true, StillOS expects the dispute re-run to agree with the original verdict and therefore to terminate REJECTED. This is StillOS's own prediction, recorded in advance so it can be checked against the result. It is not a bilateral agreement, it is not binding on ForeSeal, and ForeSeal is free to characterize any outcome however its own review supports.

## Custody

| Field | Value |
|---|---|
| Safe | `0x6243E363a3047173346Fa49C947Db204D4445634` (1.4.1, Base mainnet) |
| Threshold | 2 of 2 |
| Owner | `0x9061D5097C4c42D54693407Ce73923b76Df844F9` — Marcus Still — phone (MetaMask) |
| Owner | `0xe173379d7aAD714Ae1Db1041Fa6E5c0D6F613F83` — StillOS box signer — key file held on the StillOS host |
| Classification | **SINGLE_PERSON_MULTIDEVICE** |

**Security benefit:** Real and independently checkable. Compromise of the StillOS host alone — including root on that host — cannot move the collateral, because the box holds only one of the two required signatures. This materially raises the cost of stealing the bond.

**Counterparty-governance benefit:** None. Both keys are controlled by the same person. No independent party can compel, co-sign, or veto a payout. Multisig custody here protects the collateral from theft; it does not give a counterparty any additional assurance that an adjudicated debt will actually be paid. Those are different properties and are stated separately on purpose.

This is a self-custodied bond with hardened custody, not a trustless escrow contract. 'Slashable' here means a bonded payout obligation subject to 2-of-2 governed execution. It does not mean an instant or trustless slash, and no wording in this package should be read as claiming that.

## Bond

| Field | Value |
|---|---|
| Wallet | `0x6243E363a3047173346Fa49C947Db204D4445634` (gnosis-safe-2of2) |
| Gas relayer | `0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf` |
| Bonded | $10 · per-verdict max $1 |
| Observed balance | 10.789999 USDC at 2026-09-11T16:30:21Z |
| Active | true |

Health is reported as separate facts, not one boolean: `collateral_funded` · `slash_log_intact` · `obligation_ledger_intact` · `unpaid_slash_obligations` · `overdue_slash_obligations` · `all_slash_obligations_current`.

## Payout obligation

States: `SLASH_OWED` → `AWAITING_MULTISIG` → `PAID` → `OVERDUE` (OVERDUE derived).

Opened: Synchronously inside the dispute request, immediately on an UPHELD adjudication — before the reputation write, before the founder alert, before any signature is sought. Deliberately not wrapped in a try/catch: if the obligation cannot be recorded, the request fails loudly rather than returning a successful-looking overturn with no record of the debt.

**Payout SLA: NO FROZEN PAYOUT SLA.** Payment requires 2 of 2 Safe signatures. One key is held on the box and could be signed programmatically; the other is on a single human's phone, with no backup signer, no second human, and no on-call rotation. StillOS cannot mechanically honour a deadline that depends on one person being awake, and will not publish one it cannot honour.

The obligation is recorded durably and synchronously at adjudication time, is independently inspectable from that moment, and reports OVERDUE after the visibility threshold below. This is a guarantee that lateness is visible, not a guarantee of promptness. Threshold: 72h, `overdue_threshold_is_a_committed_sla: false`.

Whether the absence of a payout SLA makes ForeSeal's Precondition 1 unsatisfied is ForeSeal's assessment to make, not StillOS's.

## Fees

| Step | Amount |
|---|---|
| `POST /claim-verdict` | $0.05 until 2026-10-13T00:00:00Z, then $0.25 |
| `POST /dispute` | $1 (no free tier, non-refundable) |
| ForeSeal max outlay | $1.05 typical / $1.25 |
| StillOS max outlay | $1 |
| Combined hard stop | $2 |

## Signing identity

- Algorithm: Ed25519
- Fingerprint: `21de066900082465`, effective 2026-07-31T00:09:13.684Z
- Keyring: https://stillosdigitalholdings.com/notary/keyring
- Offline verifier: `verify-offline-pinned.js (this repository)`

## Published implementation

Deployment status: YES — all 6 published bond files are byte-identical to /home/marcus/core (verified 2026-09-11T17:04:59.168Z)

| File | SHA-256 |
|---|---|
| `implementation/bond/notary_bond.cjs` | `15b1727ff82b1c3614de5d26d096b0623b889d9a631b5f8de2f14a836f2d69c9` |
| `implementation/bond/notary_bond_slash.cjs` | `fc7d1c6d078aae894623a6569632c2256cce5a7828460353e9c20179f4198279` |
| `implementation/bond/verdict_dispute.cjs` | `1cd638de82ff166bbde4b838ee55acae5c4c6d07aecf90394c93f4ea01559057` |
| `implementation/bond/slash_obligations.cjs` | `b91bf15812f8532dcd72325de4ae0cdcf8b2260c7875e6cba052ee9cb97087cd` |
| `implementation/bond/bond_monitor.cjs` | `aa40dfde548187d24869355366301dd0e3e772f12afd1799667cdd423104e7bd` |
| `implementation/bond/notary_bond_mirror_refresh.cjs` | `219278cdcd3679b5a55638199fd5858aa82c32511bb7539f962098eef132f728` |
| `verify-offline-pinned.js` | `dcfb3d03d9190eacc5475f94334cc37aaca7972e2a35e34a0d98dd5300870ff6` |
