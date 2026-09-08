# STILLOS_NOTARY_RECEIPT_V1 — Frozen Digest Contract

This document freezes the existing `receipt_hash` as the durable, versioned interoperability digest for StillOS Notary receipts — the same tag proposed to Vauban (`x402-foundation/x402#3389`) as a foreign-leaf origin. Nothing in this document changes production behavior; it documents, precisely, what `core/notary_recovery_signer.cjs::commit()` has been doing in live production since 2026-07-04 (verified unchanged as of this writing — see `CURRENT_STATE_2026-09-08.md`'s file-checksum table).

## Why `receipt_hash` and not a new digest

Per Gate F5's evaluation criteria: the existing `receipt_hash` is deterministic, fully reconstructable from public fields, exactly 32 bytes, and already independently re-verified on every production request (`verifyEntireBook()`). It does not need to be replaced — only frozen and documented precisely enough that an external implementation can reproduce it byte-for-byte without reading our source.

## PREIMAGE

A plain object with exactly these fields, in exactly this order:

| # | Field | Type | Source |
|---|---|---|---|
| 1 | `agent` | string, ≤120 chars | caller-supplied agent id, truncated |
| 2 | `claim_sha256` | string, 64 hex chars | `SHA256(String(claim))` — the claim text's own digest |
| 3 | `ts` | string, ISO 8601 | `new Date().toISOString()` at commit time |
| 4 | `prev_hash` | string, 64 hex chars, or the literal string `"GENESIS"` | the immediately-prior receipt's `receipt_hash` in the single global chain, or `"GENESIS"` for the first-ever receipt |
| 5 | `notary_fp` | string, 16 hex chars | `SHA256(publicKeyPem).slice(0, 16)` — fingerprint of the key that will sign this receipt |
| 6 | `resolver_hash` | string, 64 hex chars — **OMITTED entirely, not null, on a plain `/commit` claim receipt** | `SHA256(JSON.stringify(resolver))`, present only on a `/claim-verdict` verdict receipt |

## CANONICALIZATION

`JSON.stringify(core)` — plain V8/Node.js `JSON.stringify` on the object above, no `space` argument (compact, no whitespace between tokens: `,` and `:` separators only, no spaces).

This is **not** RFC 8785 (JCS) canonicalization. It is a fixed, documented field order plus standard compact JSON serialization. Any language can reproduce it exactly by:
1. Building an object/map with exactly the fields above, in exactly that order (5 fields for a claim receipt, 6 for a verdict receipt — `resolver_hash` is absent, not `null`, when there is no resolver).
2. Serializing to JSON with standard escaping (all field values here are plain ASCII: hex digests, ISO timestamps, and a length-capped agent string — no Unicode edge cases arise in practice), and no inserted whitespace.
3. The exact byte sequence must match what V8's `JSON.stringify` produces for the same object — verified reproducible by three independent scripts already in this repo (`verify.js`, `verify-live.js`, `verify-offline-pinned.js`) using only `crypto.createHash` and `JSON.stringify`, no StillOS-specific serialization library.

## DIGEST ALGORITHM

SHA-256 over the UTF-8 bytes of the canonical JSON string above. Output encoded as lowercase hex.

## 32-BYTE OUTPUT

SHA-256 always produces a 256-bit (32-byte) digest. `receipt_hash` is its 64-character lowercase-hex encoding. To obtain the raw 32 bytes (e.g. for the Vauban `digest_lo`/`digest_hi` limb encoding): `Buffer.from(receipt_hash, 'hex')`.

## Signature — a separate, related fact worth stating precisely

`signature = Ed25519_sign(Buffer.from(receipt_hash), privateKey)`, base64-encoded.

**The signature is computed over the UTF-8 bytes of the 64-character hex STRING `receipt_hash`, not over the raw 32 decoded digest bytes.** A re-implementation that signs/verifies against `Buffer.from(receipt_hash, 'hex')` (the raw bytes) instead of `Buffer.from(receipt_hash)` (the hex string's own UTF-8 bytes) will get a signature-verification mismatch even though the hash itself is correct. This is a real, easy-to-miss gotcha for any external verifier — called out explicitly here because it is exactly the class of thing this document exists to make executable rather than assumed.

## Versioning

This document freezes the CURRENT and ONLY schema in production; there is no prior version to distinguish it from. The tag `STILLOS_NOTARY_RECEIPT_V1` names it for external reference (e.g. as a Vauban v3 foreign-leaf origin tag) without implying a V2 exists yet. If the preimage ever changes, it gets a new version tag and this file is never silently edited to describe different bytes under the same name — a new `STILLOS_NOTARY_RECEIPT_V2.md` would be created instead.

## Domain separation / collision concerns

`receipt_hash` is not domain-separated from an arbitrary SHA-256 of some other 5-or-6-field JSON object elsewhere in the world — nothing prevents an unrelated system's digest from colliding in form (not in value; SHA-256 collision resistance holds). This is why the Vauban foreign-leaf discussion (`x402-foundation/x402#3389`) requires an explicit `origin_tag` inside the anchoring preimage: the tag, not the raw digest, is what tells a verifier which schema produced the bytes. `STILLOS_NOTARY_RECEIPT_V1` is exactly that tag.

## Worked example

See `vectors/positive-01.json` in this repository for one real, live-production receipt with its digest independently recomputed and verified offline by `verify-offline-pinned.js` — not a synthetic fixture.
