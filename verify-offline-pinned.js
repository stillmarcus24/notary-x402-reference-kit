#!/usr/bin/env node
// TRUE OFFLINE verifier for the ForeSeal/StillOS interop test manifest.
// Zero network calls at verification time -- the only inputs are (1) a
// receipt JSON (however it reached you: HTTP response, file, pasted text)
// and (2) the manifest's PINNED signing-key material, embedded below,
// frozen in still-os-consciousness/docs/x402-2887/manifest/manifest.json
// BEFORE any funds moved. Does not require, and must not require, that
// /notary/health currently returns this same key.
//
// Usage:
//   node verify-offline-pinned.js <receipt.json>
//   node verify-offline-pinned.js <receipt.json> --prev <prior_receipt_hash>   (chain check)
//   node verify-offline-pinned.js <receipt.json> --payment-hash <x_payment_hash> --expect-join <receipt_hash>  (payment-join check)
'use strict';
const fs = require('fs');
const crypto = require('crypto');

// ---- Pinned at manifest creation (2026-09-06). Copy these two constants from
// manifest.json's signing_identity block if you re-derive this script independently. ----
const PINNED_KEYRING = [
  { fingerprint: '921e3af51250a1f5', public_key_pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsFIB67A7w7j7oLHjuJeErxMpq2VTZyUXD2785nbgqMM=\n-----END PUBLIC KEY-----\n', status: 'retired' },
  { fingerprint: '21de066900082465', public_key_pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEARz4QMQCVd+ImBqd3YmkIA3NYd857O+5dAWNhY7V2ryk=\n-----END PUBLIC KEY-----\n', status: 'active' },
];

function resolveKey(fingerprint) {
  const entry = PINNED_KEYRING.find(k => k.fingerprint === fingerprint);
  return entry ? entry.public_key_pem : null; // unknown fingerprint -> fail closed, never trust
}

// ---- preimage reconstruction -------------------------------------------------
//
// This MUST stay byte-identical to core/notary_service_marcus.cjs::receiptPreimage().
// It did not, and the divergence was invisible for exactly the reason divergences
// always are: each implementation was only ever run against receipts it happened to
// handle. Measured 2026-09-13 over the real 2,892-receipt book, this file said
// `hash_intact: false` on 177 receipts (6.1%) that the live service says are intact
// and whose Ed25519 signature verifies against the pinned key. They were the
// 2026-07-03 drand-randomness receipts, whose preimage carries two extra fields this
// file did not know about. The notary demonstrably signed them; only the
// reconstruction disagreed. Same family as the key-rotation false negative that
// called 175 valid receipts broken.
//
// Field order is normative and is insertion order, not sorted order.
// ---- PROFILE v1, FROZEN 2026-09-13. Never edit. --------------------------------
//
// v1 receipts carry no version field, so "is this v1?" is decided by the field set
// alone. That makes the set normative and closed: v1 can never grow another field,
// because a verifier could not tell a legitimately-grown v1 from a tampered one.
// Future shapes MUST declare `receipt_schema_version`; see PROFILE_REGISTRY below.
const V1_PREIMAGE_BASE = ['agent', 'claim_sha256', 'ts', 'prev_hash', 'notary_fp'];
const V1_PREIMAGE_OPTIONAL = [
  ['resolver_hash'],
  ['reasoning_trace_hash'],
  ['drand_round', 'drand_randomness'],
];
// Carried alongside the receipt and NOT covered by the hash or the signature.
// Enumerated from the real 2,895-receipt book, not guessed.
const V1_UNCOMMITTED = [
  'receipt_hash', 'signature', 'verify',
  'actor_class', 'classification_reason', 'confidence', 'source_ip_hash',
  'attestation_type', 'authoritative', 'proves',
  'user_agent_hash', 'api_key_hash', 'auth_account_id', 'stripe_customer_id',
  'internal_match_rule', 'resolver_id',
];
const V1_CLOSED = new Set([...V1_PREIMAGE_BASE, ...V1_PREIMAGE_OPTIONAL.flat(), ...V1_UNCOMMITTED]);

const PROFILE_REGISTRY = { 1: 'v1-frozen' }; // v2+ profiles get added here, never inferred

function preimage(r) {
  const core = {};
  for (const f of V1_PREIMAGE_BASE) core[f] = r[f];
  for (const group of V1_PREIMAGE_OPTIONAL) {
    if (r[group[0]]) for (const f of group) core[f] = r[f];
  }
  return JSON.stringify(core);
}

/*
 * ---------------------------------------------------------------------------
 * WHY THE CLASSIFICATION IS SHAPED LIKE THIS
 *
 * "Unknown is not a refutation" is right, and the first implementation of it here
 * was a forgery laundromat. It read: if the hash mismatches AND any unrecognized
 * field is present, return null (unsupported schema). Measured by
 * conformance/schema-downgrade-attack.js on 2026-09-13, that failed four ways:
 *
 *   A2  mutate claim_sha256              -> UNSUPPORTED_SCHEMA, should be INVALID
 *   A3  mutate claim_sha256 + add field  -> UNSUPPORTED_SCHEMA, should be INVALID
 *   A4  add a field, mutate nothing      -> INTACT, should not be "fully verified"
 *   A5  legacy shape + extra field       -> INTACT, same
 *
 * A2 is the worst: real receipts carry ~20 envelope fields, the original
 * NON_PREIMAGE list named 7, so unknownFields() was non-empty for essentially every
 * real receipt — every tampered receipt in the book laundered itself to
 * "indeterminate" with no attacker effort at all.
 *
 * The fix is not a longer list of known fields. It is refusing to INFER a profile:
 *
 *   declared version, unknown to us  -> UNSUPPORTED_SCHEMA (a real unknown)
 *   no declared version              -> it is claiming to be v1, and v1 is FROZEN
 *       preimage mismatch            -> INVALID       (v1 cannot have grown)
 *       preimage match + extra field -> UNSUPPORTED_SCHEMA (core is right, but the
 *                                       object is not a pure v1 receipt, so it must
 *                                       not be reported as fully verified)
 *       preimage match, no extras    -> INTACT
 *
 * This is why explicit versioning is a security control and not housekeeping: it is
 * the only thing that lets a verifier tell "newer than me" from "tampered", without
 * which one of the two answers is always wrong.
 * ---------------------------------------------------------------------------
 */
function verifyReceipt(r) {
  const result = { checks: {} };

  const declared = r.receipt_schema_version;
  if (declared !== undefined && !PROFILE_REGISTRY[declared]) {
    result.checks.hash_intact = null;
    result.checks.schema = 'unsupported_version';
    result.declared_version = declared;
  } else {
    const recomputed = crypto.createHash('sha256').update(preimage(r)).digest('hex');
    const extras = Object.keys(r).filter(k => !V1_CLOSED.has(k) && k !== 'receipt_schema_version');
    if (recomputed !== r.receipt_hash) {
      // v1 is frozen: a mismatch is a mismatch. Extra fields cannot excuse it.
      result.checks.hash_intact = false;
    } else if (extras.length) {
      result.checks.hash_intact = null;
      result.checks.schema = 'unrecognized_fields_outside_frozen_v1';
      result.unrecognized_fields = extras;
    } else {
      result.checks.hash_intact = true;
    }
  }

  // Surfaced on every result, intact or not. 2,789 receipts in the real book carry
  // actor_class/classification_reason/confidence and 379 carry
  // stripe_customer_id/auth_account_id — none of it covered by the hash or the
  // signature. A consumer reading those off a receipt this tool called "verified"
  // is trusting uncommitted data. Saying so is the verifier's job.
  result.uncommitted_fields_present = Object.keys(r)
    .filter(k => V1_UNCOMMITTED.includes(k) && !['receipt_hash', 'signature', 'verify'].includes(k));

  const pubKeyPem = resolveKey(r.notary_fp);
  result.checks.key_known = pubKeyPem !== null;
  if (pubKeyPem) {
    try {
      result.checks.signature_valid = crypto.verify(null, Buffer.from(r.receipt_hash), crypto.createPublicKey(pubKeyPem), Buffer.from(r.signature, 'base64'));
    } catch (e) { result.checks.signature_valid = false; result.sig_error = e.message; }
  } else {
    result.checks.signature_valid = false; // fail closed on unknown key
  }
  result.checks.all_pass = result.checks.hash_intact && result.checks.key_known && result.checks.signature_valid;
  return result;
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node verify-offline-pinned.js <receipt.json> [--prev <hash>] [--payment-hash <h> --expect-join <receipt_hash>]'); process.exit(2); }
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = verifyReceipt(r);

  const prevIdx = process.argv.indexOf('--prev');
  if (prevIdx > -1) {
    const expectedPrev = process.argv[prevIdx + 1];
    out.checks.chain_intact = r.prev_hash === expectedPrev;
    out.checks.all_pass = out.checks.all_pass && out.checks.chain_intact;
  }

  const payIdx = process.argv.indexOf('--payment-hash');
  const joinIdx = process.argv.indexOf('--expect-join');
  if (payIdx > -1 && joinIdx > -1) {
    const paymentHash = process.argv[payIdx + 1];
    const expectJoin = process.argv[joinIdx + 1];
    // Payment<->receipt join: the payment record must reference the SAME
    // receipt_hash this receipt actually has, not just any hash.
    out.checks.payment_receipt_join_ok = paymentHash === expectJoin && expectJoin === r.receipt_hash;
    out.checks.all_pass = out.checks.all_pass && out.checks.payment_receipt_join_ok;
  }

  console.log(JSON.stringify({ receipt_hash: r.receipt_hash, notary_fp: r.notary_fp, ...out, network_calls_made: 0 }, null, 2));
  process.exitCode = out.checks.all_pass ? 0 : 1;
}

module.exports = { verifyReceipt, resolveKey, PINNED_KEYRING };
if (require.main === module) main();
