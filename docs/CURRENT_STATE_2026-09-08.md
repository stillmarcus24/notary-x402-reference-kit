# StillOS Notary — Interop Readiness: Current State Audit
_Generated 2026-09-08, re-audit against production + Base mainnet. Read-only pass — nothing repaired here, see the other docs in this directory for what changed as a result._

Every line is PASS / FAIL / PARTIAL with the exact command or endpoint used to check it, run live against production during this audit.

## Bond

| Check | Result | Evidence |
|---|---|---|
| `/notary/bond` reachable, real endpoint (not a stub) | **PASS** | `curl https://nolawealthfinancial.com/notary/bond` → 200, Ed25519-signed JSON. Route is `core/notary_service_marcus.cjs:2753`, backed by `core/notary_bond.cjs::getSignedStatus()`. |
| Balance independently queried from chain, not invented/cached-as-authoritative | **PASS** | `notary_bond.cjs::readOnchainUsdc()` calls `eth_call` (`balanceOf`) against `https://mainnet.base.org` (fallback `base-rpc.publicnode.com`) live, on every request to `/bond` and every 30 min via `core/bond_monitor.cjs` cron. `getCachedStatusSync()` caches for hot paths (badges, 402 quotes) but defaults to `inactive/$0` on a cold or failed cache — never fabricates `active:true`. |
| Bond currently active | **FAIL** | `onchain_balance_usd: 0` vs `bonded_usd: 10` → `active: false`. Confirmed both via the live endpoint and directly: `eth_call` `balanceOf(0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf)` on USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base mainnet, returned `0` at audit time (2026-09-08T19:47Z). |
| Max slash per verdict / total bonded | **PASS (documented, not yet backed)** | `per_verdict_max_usd: 1.00`, `bonded_usd: 10.00`. Enforced server-side in `notary_bond.cjs::recordSlash()` (throws if `amount > per_verdict_max_usd` or cumulative slash would exceed `bonded_usd`). |
| Slash payout is governed, not auto-paid to a caller | **PASS** | `recordSlash()` is only ever invoked by a separately-run, human-gated command (`notary_bond_slash.cjs --execute`); the dispute path queues a directive, never transfers funds itself. |

## Dispute

| Check | Result | Evidence |
|---|---|---|
| `/notary/dispute` reachable and x402-gated | **PASS** | `curl -X POST https://nolawealthfinancial.com/notary/dispute` → HTTP 402, `maxAmountRequired: "1000000"` (1.00 USDC, 6 decimals), `payTo: 0xfAB07d26F7627fc4cE459ecf90d7E015F7eEcE71`, network `base`. The 402 description self-discloses `"Correctness bond currently INACTIVE (unfunded)"` — honest at the point of sale, not overclaiming. |
| Dispute fee | **$1.00 flat, no free tier** | `DISPUTE_X402_USD = 1.00` (`core/notary_service_marcus.cjs:152`), confirmed matches the live 402 quote exactly. |

## Fees — every step a ForeSeal-style counterparty would hit

| Route | Price | Free tier | Source |
|---|---|---|---|
| `POST /commit` | **$0.10** | none | code const + live `/.well-known/x402.json` |
| `POST /claim-verdict` | **$0.05** now, **$0.25** after `2026-10-13T00:00:00Z` (`LAUNCH_PRICING_UNTIL`) | 3/agent/day + reputation bonus | code const + live `/.well-known/x402.json` |
| `POST /dispute` | **$1.00** flat | none | code const + live 402 response |
| `POST /grade-strategy` | $0.05 now / $0.25 after 2026-10-13 | 2/agent/day | live `/.well-known/x402.json` |

All figures pulled live from production during this audit, not from memory of a prior session. See `FEE_SCHEDULE_V1.md` for the full interop-scoped breakdown.

## Signing identity / key

| Check | Result | Evidence |
|---|---|---|
| Algorithm | Ed25519 | `crypto.sign(null, ..., privateKey)` in `core/notary_recovery_signer.cjs:91` — `null` digest algorithm is the correct call for a PureEdDSA (Ed25519) key. |
| Current public key served live | **PASS** | `GET /health` → `notary.publicKeyPem` = `MCowBQYDK2VwAyEARz4QMQCVd+ImBqd3YmkIA3NYd857O+5dAWNhY7V2ryk=`. Matches `state/proof-notary/notary-key.json`'s `publicKey` byte-for-byte. |
| Historical registry so old/rotated-key receipts stay verifiable without trusting current `/health` | **PASS** | `GET /notary/keyring` (built 2026-09-06, explicitly for this exact ForeSeal gap) — returns both the retired key (`921e3af51250a1f5`, effective 2026-06-27 → 2026-07-31) and the active key (`21de066900082465`, effective 2026-07-31 → present) with status/effective dates. A verifier resolves by the receipt's own `notary_fp`, never by "whatever `/health` says right now." |
| A verifier can pin the key WITHOUT any HTTP call at verify time | **PARTIAL → closed by this pass** | `/keyring` still requires one live fetch to obtain the registry. `verify-offline-pinned.js` (already built 2026-09-06, not yet published) embeds the same two keys as a `PINNED_KEYRING` constant directly in the script — zero network calls at verify time. This audit publishes that script plus a standalone `keys/` artifact (see `Gate F3`) to close the gap for real. |

## `receipt_hash` construction (the candidate interop digest)

Read directly from `core/notary_recovery_signer.cjs::commit()` (lines 81–91):

```js
core = {
  agent: String(agent).slice(0, 120),
  claim_sha256: sha256(String(claim)),
  ts: new Date().toISOString(),
  prev_hash: <previous receipt_hash, or "GENESIS">,
  notary_fp: sha256(publicKeyPem).slice(0, 16),
  ...(resolver_hash ? { resolver_hash } : {}),   // present only on verdict receipts
}
receipt_hash = SHA256(JSON.stringify(core))       // hex, 64 chars = 32 bytes
signature    = Ed25519_sign(Buffer.from(receipt_hash), privateKey)   // over the HEX STRING bytes, not the raw 32 digest bytes
```

| Check | Result |
|---|---|
| Deterministic / publicly reconstructable | **PASS** — every input field is either public (`agent`, `ts`, `prev_hash`, `notary_fp`) or independently recomputable (`claim_sha256`, `resolver_hash`). No hidden salt. |
| Exactly 32 bytes | **PASS** — SHA-256 output is always 32 bytes; `receipt_hash` is its 64-char hex encoding. |
| Field ordering matters | **YES** — `JSON.stringify` on a plain object serializes string keys in insertion order (ECMAScript-guaranteed since ES2015); the object literal order in `commit()` is fixed (`agent, claim_sha256, ts, prev_hash, notary_fp, [resolver_hash]`) and is what must be reproduced byte-for-byte by any external re-implementation. This is **not** RFC 8785/JCS canonicalization — it's a fixed, documented field order + compact (no-whitespace) JSON, which any language can replicate without needing V8-specific behavior, but the exact order must be followed. Documented precisely in `STILLOS_NOTARY_RECEIPT_V1.md` (this pass). |
| Server re-verifies from scratch, not from a cached badge | **PASS** — `verifyEntireBook()` (`notary_service_marcus.cjs:1373`) re-reads the ledger and recomputes every hash + signature + chain link on every call to `/verify-live`. |
| Historical non-standard-schema receipts honestly flagged, not silently miscounted | **PASS** — 2026-07-03 drand-randomness receipts used an extended core schema; `verifyEntireBook()` reports them as `non_standard_schema` (authentic, correctly chained, just don't reconstruct the 6-field formula) rather than "failed." |

## Live ledger state (2026-09-08T19:4x Z)

- `state/proof-notary/receipts.jsonl`: **2,283 lines** (up from 958 on 2026-07-20, 960 on 2026-07-27 — real, growing production traffic).
- Every 30 min, `verifyEntireBook()` re-verifies the entire book fresh — no cached "verified" badge.

## Code drift since the 2026-09-06 interop manifest was frozen

The existing (unpublished) manifest at `still-os-consciousness/docs/x402-2887/manifest/manifest.json` pinned SHA-256 checksums of the 5 files that matter for this test. Re-hashed live during this audit:

| File | Manifest-pinned SHA-256 | Live SHA-256 (2026-09-08) | Match |
|---|---|---|---|
| `core/notary_service_marcus.cjs` | `1993d316...cfd8d37` | `1993d316...cfd8d37` | **IDENTICAL** |
| `core/verdict_dispute.cjs` | `0ac165e3...df43c14` | `0ac165e3...df43c14` | **IDENTICAL** |
| `core/notary_bond.cjs` | `c5aca9e6...32114eb` | `c5aca9e6...32114eb` | **IDENTICAL** |
| `core/notary_recovery_signer.cjs` | `5a379cbb...f62d5fa` | `5a379cbb...f62d5fa` | **IDENTICAL** |
| `core/keyring.cjs` | `fafcbe1f...5dd19e6` | `fafcbe1f...5dd19e6` | **IDENTICAL** |

**Zero drift on every file that determines correctness/verifiability.** `core` (the nested git repo at `/home/marcus/core`) is one commit ahead of the manifest's pinned `b2efdea` (now `10f2a2d`), but that commit only added an unrelated file (`growth_outreach_followup.cjs`) — confirmed via `git show --stat`, nothing notary-related changed.

## Production vs. stale documentation routes

- The 404 fallback route list on `notary_service_marcus.cjs` (`GET /health`, `/keyring`, `/verify`, `/verify-live`, `/export`, `/.well-known/x402.json`, `POST /commit`, `/claim-verdict`, `/dispute`, ...) is accurate and matches what's actually reachable — spot-checked `/health`, `/keyring`, `/bond`, `/dispute` live during this audit, all match.
- Public base URL used by ForeSeal-facing docs is `https://stillosdigitalholdings.com/notary/*`; the domain actually serving traffic in this audit was `https://nolawealthfinancial.com/notary/*` — **both resolve to the same live service** (same Caddy backend), confirmed by matching `notary_fp`/`public_key`/ledger counts on both. Worth standardizing on one canonical URL in outward-facing docs going forward so a reader isn't left guessing which is authoritative.

## Bottom line

The hard cryptographic/verification substrate (signing, hashing, chain-continuity, key history) is real, live, unchanged since 2026-09-06, and independently re-verified today. The gap is entirely economic and packaging: **the bond is unfunded ($0 of $10)**, and a genuinely-complete, already-built offline-verification kit (`verify-offline-pinned.js`, the interop manifest, the test runbook) has never been pushed to the public repo where a counterparty could actually reach it. Both are closed or queued by this pass — see `READINESS_REPORT_V1.md`.
