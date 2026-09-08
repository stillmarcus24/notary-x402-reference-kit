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

function verifyReceipt(r) {
  const result = { checks: {} };
  const core = { agent: r.agent, claim_sha256: r.claim_sha256, ts: r.ts, prev_hash: r.prev_hash, notary_fp: r.notary_fp };
  if (r.resolver_hash) core.resolver_hash = r.resolver_hash;
  const recomputed = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  result.checks.hash_intact = recomputed === r.receipt_hash;

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
