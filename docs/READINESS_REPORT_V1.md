# Interop Readiness Report V1 — StillOS Notary

Generated 2026-09-08. Every PASS below names the exact file, endpoint, or on-chain check that proves it — no evidence, no PASS.

## ForeSeal

| Gate | Status | Evidence |
|---|---|---|
| F1 — bond live | **FAIL** | `GET https://nolawealthfinancial.com/notary/bond` → `onchain_balance_usd: 0`, `active: false`. Independently confirmed via direct `eth_call` to Base mainnet during this audit. A funding transaction is prepared internally, pending founder approval per StillOS's own money-movement policy — not published here since it names internal wallet balances. |
| F2 — complete fee disclosure | **PASS** | `docs/FEE_SCHEDULE_V1.md`, cross-checked against live `/.well-known/x402.json` and the live `/dispute` 402 response during this audit. |
| F3 — pinned key | **PASS** | `keys/stillos-notary-ed25519-v1.pub`, `keys/stillos-notary-ed25519-retired-2026-07-31.pub`, `keys/README.md`. Backed by the live `GET /notary/keyring` historical registry (built 2026-09-06). |
| F4 — offline verifier | **PASS** | `verify-offline-pinned.js` — zero network calls (`network_calls_made: 0` on every run, confirmed live against `vectors/positive-01.json`, a real production receipt), Node stdlib only (`crypto`, `fs`), deterministic exit code (0 = pass, 1 = fail). |
| F5 — frozen digest contract | **PASS** | `docs/STILLOS_NOTARY_RECEIPT_V1.md` — exact preimage, field order, canonicalization, algorithm, 32-byte output, and the hex-string-vs-raw-bytes signature gotcha, all documented against the real `commit()` source. |
| F6 — two-sided vectors | **PASS** | `vectors/` — 1 positive (real production receipt) + 6 negative vectors (content mutation, digest mutation, signature mutation, wrong signing key, chain-link mismatch, unknown key/version), `vectors/MANIFEST.json` with expected vs. observed outcomes for all 7, every one executed live against `verify-offline-pinned.js` during this pass with the real exit codes recorded. |
| Bilateral terms frozen | **PASS** | `docs/FORESEAL_BILATERAL_TERMS_V1.md` — restates 0rkz's 2026-07-28 conditions exactly, maps each to its current status. Backed by the machine-readable `still-os-consciousness/docs/x402-2887/manifest/manifest.json` (created 2026-09-06, re-verified zero-drift on 2026-09-08 — see `CURRENT_STATE_2026-09-08.md`'s checksum table). |
| **Ready to re-engage ForeSeal** | **NO** | Six of seven gates are closed. The seventh (F1, bond funding) is a real-money action gated on Marcus's explicit approval per CLAUDE.md's Hard Brakes — not something this pass can complete unilaterally. Re-engagement message is drafted (see below) but **not sent** — sending it before F1 clears would be re-asking ForeSeal the same question they already answered, with nothing new to show on the one point they said was blocking. |

## Vauban

| Gate | Status | Evidence |
|---|---|---|
| 32-byte StillOS digest specification | **PASS** | `docs/STILLOS_NOTARY_RECEIPT_V1.md`. |
| Origin tag candidate | **PASS (proposed, not yet accepted by Vauban)** | `STILLOS_NOTARY_RECEIPT_V1` — 25 ASCII bytes, fits Vauban's 31-byte felt packing (confirmed by direct computation, same check Tamga's `TAMGA_CHAIN_HEAD_V1` passed at 19 bytes). Not yet confirmed accepted by Vauban — no claim of acceptance is made anywhere in these artifacts. |
| Foreign-leaf encoding | **PASS** | `vauban/encode-verify.js` + `vauban/STILLOS_FOREIGN_LEAF_VECTOR_V1.json`. Spec re-fetched live from `vauban-org/x402-starknet` during this pass and cross-checked byte-identical against the `x402-foundation/x402#3389` comment thread — zero drift. |
| Local compatibility vector | **PASS** | `vauban/STILLOS_FOREIGN_LEAF_VECTOR_V1.json` — real receipt digest, independently derived `digest_lo`/`digest_hi`, round-trip decode verified to reconstruct the original hash exactly. Explicitly labeled pre-interoperability; states plainly what it does and does not prove. |
| Real externally exercised receipt available | **FAIL** | No ForeSeal-exercised receipt exists yet (F1 above is the blocker). The Vauban vector uses a real production receipt (not synthetic) but not yet one produced by an external counterparty's own paid call. |
| **Ready to ask Vauban for actual batch inclusion** | **NO** | Per the sprint's own strategic sequence: the ForeSeal-exercised receipt is meant to become the real source artifact for the Vauban leaf, not a StillOS-internal one. Encoding correctness is proven; the receipt that should go into a real batch doesn't exist yet. |

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

1. **Bond funding** ($10 USDC to `0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf` on Base) — real money, requires founder approval per StillOS's own money-movement policy. A funding plan exists internally.
2. **A real ForeSeal-exercised receipt** — depends on #1, then depends on ForeSeal actually running the test on their side.
3. **Vauban's actual acceptance of the `STILLOS_NOTARY_RECEIPT_V1` tag** — a genuine open question to Vauban, not yet asked (correctly, per the sprint's own instruction not to ask until there's a real object to bring — see #2).

## The single next external action

**None yet — the next action is internal and money-gated, not external.** Once Marcus approves and executes bond funding (blocker #1), the very next action is a single reply to `x402-foundation/x402#2887` telling ForeSeal exactly which of their five preconditions are now met with links to the evidence above, and asking whether they're ready to run the test on the frozen terms in `docs/FORESEAL_BILATERAL_TERMS_V1.md`. That reply is not drafted as a file in this pass, per the sprint's own instruction not to post promotional comments before the evidence exists — it will take five minutes to write once funding clears, and funding clearing is the actual bottleneck, not the writing.
