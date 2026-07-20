#!/usr/bin/env node
// Standalone verifier for a StillOS notary receipt. Zero dependencies on the
// notary itself — recomputes receipt_hash from the core fields and checks
// the Ed25519 signature against the embedded public key. Run:
//   node verify.js example-receipt-chain.json
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node verify.js <receipt-file.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const pubKey = crypto.createPublicKey(data.public_key_pem);

function verifyReceipt(name, r) {
  const core = { agent: r.agent, claim_sha256: r.claim_sha256, ts: r.ts, prev_hash: r.prev_hash, notary_fp: r.notary_fp };
  if (r.resolver_hash) core.resolver_hash = r.resolver_hash;
  const recomputed = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  const hashOk = recomputed === r.receipt_hash;
  const sigOk = crypto.verify(null, Buffer.from(r.receipt_hash), pubKey, Buffer.from(r.signature, 'base64'));
  console.log(`${name}:`);
  console.log(`  receipt_hash recomputed correctly: ${hashOk}`);
  console.log(`  signature valid:                   ${sigOk}`);
  console.log(`  chained to prev_hash:               ${r.prev_hash}`);
  if (!hashOk || !sigOk) process.exitCode = 1;
}

verifyReceipt('claim_receipt', data.claim_receipt);
verifyReceipt('verdict_receipt', data.verdict_receipt);
const chainOk = data.verdict_receipt.prev_hash === data.claim_receipt.receipt_hash;
console.log(`\nhash chain intact (verdict.prev_hash === claim.receipt_hash): ${chainOk}`);
if (!chainOk) process.exitCode = 1;
