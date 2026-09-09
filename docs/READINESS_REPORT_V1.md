# Interop Readiness Report V1 — StillOS Notary

Generated 2026-09-08. **Updated 2026-09-09** — Gate F1 and the Vauban tag question both resolved; see those rows. Every PASS below names the exact file, endpoint, or on-chain check that proves it — no evidence, no PASS.

## ForeSeal

| Gate | Status | Evidence |
|---|---|---|
| F1 — bond live | **PASS** | `GET https://nolawealthfinancial.com/notary/bond` → `onchain_balance_usd: 10.789999`, `active: true`, against `bonded_usd: 10`. Independently confirmed via direct `eth_call` to Base mainnet. Cleared 2026-09-09 **without new capital**: the bond was re-pointed to the 2-of-2 Safe `0x6243E363a3047173346Fa49C947Db204D4445634` that already held the collateral swept out of the prior single-key wallet on 2026-07-27. Consequence, disclosed rather than buried: a slash payout now requires a human 2-of-2 signature and is not instant. The obligation to pay an adjudicated overturn is unchanged. |
| F2 — complete fee disclosure | **PASS** | `docs/FEE_SCHEDULE_V1.md`, cross-checked against live `/.well-known/x402.json` and the live `/dispute` 402 response during this audit. |
| F3 — pinned key | **PASS** | `keys/stillos-notary-ed25519-v1.pub`, `keys/stillos-notary-ed25519-retired-2026-07-31.pub`, `keys/README.md`. Backed by the live `GET /notary/keyring` historical registry (built 2026-09-06). |
| F4 — offline verifier | **PASS** | `verify-offline-pinned.js` — zero network calls (`network_calls_made: 0` on every run, confirmed live against `vectors/positive-01.json`, a real production receipt), Node stdlib only (`crypto`, `fs`), deterministic exit code (0 = pass, 1 = fail). |
| F5 — frozen digest contract | **PASS** | `docs/STILLOS_NOTARY_RECEIPT_V1.md` — exact preimage, field order, canonicalization, algorithm, 32-byte output, and the hex-string-vs-raw-bytes signature gotcha, all documented against the real `commit()` source. |
| F6 — two-sided vectors | **PASS** | `vectors/` — 1 positive (real production receipt) + 6 negative vectors (content mutation, digest mutation, signature mutation, wrong signing key, chain-link mismatch, unknown key/version), `vectors/MANIFEST.json` with expected vs. observed outcomes for all 7, every one executed live against `verify-offline-pinned.js` during this pass with the real exit codes recorded. |
| Bilateral terms frozen | **PASS** | `docs/FORESEAL_BILATERAL_TERMS_V1.md` — restates 0rkz's 2026-07-28 conditions exactly, maps each to its current status. Backed by the machine-readable `still-os-consciousness/docs/x402-2887/manifest/manifest.json` (created 2026-09-06, re-verified zero-drift on 2026-09-08 — see `CURRENT_STATE_2026-09-08.md`'s checksum table). |
| **Ready to re-engage ForeSeal** | **YES** | All seven gates closed as of 2026-09-09. F1, the sole outstanding gate, cleared without moving capital. `FORESEAL_BILATERAL_TERMS_V1.md` has been republished with the confirmed on-chain balance, which that document itself required before anything is asked of ForeSeal. |

## Vauban

| Gate | Status | Evidence |
|---|---|---|
| 32-byte StillOS digest specification | **PASS** | `docs/STILLOS_NOTARY_RECEIPT_V1.md`. |
| Origin tag candidate | **PASS (accepted by Vauban 2026-09-09)** | `STILLOS_NOTARY_RECEIPT_V1` — 25 ASCII bytes, fits Vauban's 31-byte felt packing. Accepted by @seritalien on `stillmarcus24/stillos-notary#1` (2026-09-09T08:19:18Z): "the tag convention fits ... under the same rule needs nothing renegotiated on our side." |
| Foreign-leaf encoding | **PASS** | `vauban/encode-verify.js` + `vauban/STILLOS_FOREIGN_LEAF_VECTOR_V1.json`. Spec re-fetched live from `vauban-org/x402-starknet` during this pass and cross-checked byte-identical against the `x402-foundation/x402#3389` comment thread — zero drift. |
| Local compatibility vector | **PASS** | `vauban/STILLOS_FOREIGN_LEAF_VECTOR_V1.json` — real receipt digest, independently derived `digest_lo`/`digest_hi`, round-trip decode verified to reconstruct the original hash exactly. Explicitly labeled pre-interoperability; states plainly what it does and does not prove. |
| Real externally exercised receipt available | **FAIL** | No ForeSeal-exercised receipt exists yet. F1 is no longer the blocker — it cleared 2026-09-09; the remaining dependency is ForeSeal actually running the lifecycle on their side. The Vauban vector uses a real production receipt (not synthetic), but not one produced by an external counterparty's own paid call. |
| **Ready to ask Vauban for actual batch inclusion** | **DONE 2026-09-09** | Asked and delivered. The ForeSeal-first sequencing was the sprint's own strategy, not a Vauban requirement — issue #1 only ever required a real StillOS lifecycle event. Leg 1 artifact posted to `stillmarcus24/stillos-notary#1` with digest `636ec23cec4628502312ddde24bc620bee54bf83bd85759eadabf810230a4536` (a real production `resolved_verdict`, ledger line 2283), frozen preimage spec, independently derived limbs, pinned key and 1+6 vectors. Inclusion now sits on Vauban's nightly batch cadence. Nothing is anchored yet — that remains the open item. |

## What changed this pass

- Published, for the first time, a large body of interop-readiness work that already existed locally (built 2026-09-06/07) but had never been pushed to a public repo where ForeSeal or Vauban could reach it: the offline verifier, the pinned keyring, the bilateral-test manifest and runbook.
- Re-verified that body of work against live production on 2026-09-08 with zero drift found (file checksums identical, bond still exactly as documented: unfunded).
- Built what was genuinely missing: `docs/STILLOS_NOTARY_RECEIPT_V1.md` (the digest contract had never been written as a standalone frozen spec), `vectors/` (no adversarial/two-sided test suite existed before this pass), `vauban/` (the Vauban engagement didn't exist until today — this is the first StillOS-side technical artifact for it), `docs/FEE_SCHEDULE_V1.md`, `docs/CURRENT_STATE_2026-09-08.md`.
- Confirmed, via direct on-chain checks (not assumption), that the first candidate funding source could not actually cover the bond requirement — a real finding kept in internal planning rather than this public report, since it names specific internal wallet balances.

## Commit hashes / public artifacts

See the accompanying commit in `stillmarcus24/notary-x402-reference-kit` for the exact commit hash — this report is written before that commit, per the sprint's own instruction to push evidence, not just describe it. Files added this pass, all under `notary-x402-reference-kit/`:
- `docs/CURRENT_STATE_2026-09-08.md`
- `docs/FEE_SCHEDULE_V1.md`
- `docs/STILLOS_NOTARY_RECEIPT_V1.md`
- `docs/FORESEAL_BILATERAL_TERMS_V1.md`
- `docs/READINESS_REPORT_V1.md` (this file)
- `keys/stillos-notary-ed25519-v1.pub`, `keys/stillos-notary-ed25519-retired-2026-07-31.pub`, `keys/README.md`
- `vectors/positive-01.json`, `vectors/negative-01..06-*.json`, `vectors/MANIFEST.json`
- `vauban/STILLOS_FOREIGN_LEAF_VECTOR_V1.json`, `vauban/encode-verify.js`

Pre-existing, previously-unpublished files pushed for the first time in the same commit: `verify-offline-pinned.js`, `foreseal_interop_harness.cjs`.

## Remaining blockers

1. ~~**Bond funding**~~ — **RESOLVED 2026-09-09.** Cleared by re-pointing the bond to the Safe holding the collateral; no capital moved. See Gate F1.
2. **A real ForeSeal-exercised receipt** — depends on #1, then depends on ForeSeal actually running the test on their side.
3. ~~**Vauban's actual acceptance of the `STILLOS_NOTARY_RECEIPT_V1` tag**~~ — **RESOLVED 2026-09-09.** Accepted by @seritalien; Leg 1 artifact delivered the same day. Batch inclusion now sits on Vauban's nightly cadence. Nothing anchored yet.

## The single next external action

**A reply to `x402-foundation/x402#2887` addressed to @0rkz**, stating that Condition 1 is now satisfied, disclosing the move to multisig custody as material to that condition and explicitly leaving it open for ForeSeal to re-assess, confirming Conditions 2–5 unchanged, moving the implementation pin to `38ad5fee0ef3171b3559232da67c88c0d00a00e4`, and asking for the two items outstanding on their side: a ForeSeal-controlled wallet and their signing key. The prior bottleneck named here — bond funding — no longer exists.
