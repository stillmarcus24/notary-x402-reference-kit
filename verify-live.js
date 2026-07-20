#!/usr/bin/env node
// Verifies the REAL production receipt chain — not a synthetic example.
// Data pulled live from https://nolawealthfinancial.com/notary/export?preview=true
// (free 10-record preview of the actual notary's real signed history) and the
// real production public key from https://nolawealthfinancial.com/notary/health.
// Run: node verify-live.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const PROD_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsFIB67A7w7j7oLHjuJeErxMpq2VTZyUXD2785nbgqMM=\n-----END PUBLIC KEY-----\n';
const pubKey = crypto.createPublicKey(PROD_PUBLIC_KEY_PEM);

const data = JSON.parse(fs.readFileSync(__dirname + '/real-live-receipt-chain-preview.json', 'utf8'));
if (data.public_key !== PROD_PUBLIC_KEY_PEM) throw new Error('public key mismatch vs /notary/health — do not trust this file');

let prevExpected = null;
let allOk = true;
data.receipts.forEach((r, i) => {
  const core = { agent: r.agent, claim_sha256: r.claim_sha256, ts: r.ts, prev_hash: r.prev_hash, notary_fp: r.notary_fp };
  if (r.resolver_hash) core.resolver_hash = r.resolver_hash;
  const recomputed = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  const hashOk = recomputed === r.receipt_hash;
  const sigOk = crypto.verify(null, Buffer.from(r.receipt_hash), pubKey, Buffer.from(r.signature, 'base64'));
  const chainOk = i === 0 ? true : r.prev_hash === prevExpected;
  const ok = hashOk && sigOk && chainOk;
  allOk = allOk && ok;
  console.log(`[${i}] agent=${r.agent} ts=${r.ts} hash_ok=${hashOk} sig_ok=${sigOk} chain_ok=${chainOk}`);
  prevExpected = r.receipt_hash;
});
console.log(`\nAll ${data.receipts.length} REAL production receipts verified: ${allOk}`);
console.log('Verified against the real production key served live at https://nolawealthfinancial.com/notary/health');
process.exitCode = allOk ? 0 : 1;
