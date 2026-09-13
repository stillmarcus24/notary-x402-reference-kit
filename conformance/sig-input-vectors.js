#!/usr/bin/env node
'use strict';
/*
 * sig-input-vectors.js — which bytes does the signature actually cover?
 *
 * StillOS signs Ed25519 over the ASCII bytes of the lowercase, unprefixed hex
 * receipt_hash. That sentence is the entire interop surface, and every one of
 * these is a different byte string a competent developer could reasonably choose:
 *
 *     "636e..."         lowercase ASCII hex, no prefix
 *     "636E..."         uppercase
 *     "0x636e..."       0x-prefixed
 *     <raw 32 bytes>    the digest itself
 *     "636e...\n"       newline-terminated (shell pipelines do this for free)
 *     UTF-16LE          the same characters, wrong encoding
 *
 * Exactly ONE must verify. If more than one does, the signature does not pin a
 * single meaning. If the wrong one does, every other language's implementation is
 * silently incompatible with ours.
 *
 * This is checked against a REAL production receipt and the REAL pinned public
 * key, not a fixture. No private key is needed: verifying which candidate input
 * the existing signature accepts IS the proof.
 */
const fs = require('crypto') && require('fs');
const crypto = require('crypto');
const { PINNED_KEYRING, resolveKey } = require('../verify-offline-pinned.js');

const file = process.argv[2];
if (!file) { console.error('usage: node sig-input-vectors.js <real-receipt.json>'); process.exit(2); }
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const pem = resolveKey(r.notary_fp);
if (!pem) { console.error(`no pinned key for notary_fp ${r.notary_fp}`); process.exit(2); }
const key = crypto.createPublicKey(pem);
const sig = Buffer.from(r.signature, 'base64');
const h = r.receipt_hash;

const CANDIDATES = [
  ['ascii-lowercase-hex-no-prefix', Buffer.from(h), true],
  ['ascii-uppercase-hex',           Buffer.from(h.toUpperCase()), false],
  ['ascii-0x-prefixed',             Buffer.from('0x' + h), false],
  ['raw-32-bytes',                  Buffer.from(h, 'hex'), false],
  ['ascii-hex-newline-appended',    Buffer.from(h + '\n'), false],
  ['utf16le-hex',                   Buffer.from(h, 'utf16le'), false],
];

console.log('');
console.log('  signature input encoding — which bytes are actually signed');
console.log('  ' + '-'.repeat(66));
console.log(`  receipt : ${h}`);
console.log(`  key     : ${r.notary_fp} (pinned, ${PINNED_KEYRING.find(k => k.fingerprint === r.notary_fp).status})`);
console.log('');

let accepted = [], fails = 0;
for (const [name, buf, want] of CANDIDATES) {
  let ok = false;
  try { ok = crypto.verify(null, buf, key, sig); } catch { ok = false; }
  if (ok) accepted.push(name);
  const correct = ok === want;
  if (!correct) fails++;
  console.log(`  ${correct ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} verifies=${String(ok).padEnd(5)} expected=${want}`);
}

console.log('');
console.log(`  accepted by exactly: ${accepted.length === 1 ? accepted[0] : JSON.stringify(accepted)}`);
if (accepted.length !== 1) { console.log('\n  AMBIGUOUS — the signature does not pin a single input encoding.\n'); process.exit(1); }
if (fails) { console.log('\n  MISMATCH against the documented rule.\n'); process.exit(1); }
console.log('  Unambiguous. signature_input_encoding = "ascii-lowercase-hex-no-prefix".');
console.log('  Any reimplementation signing raw bytes, uppercase, 0x-prefixed or a');
console.log('  newline-terminated string produces receipts this verifier rejects —');
console.log('  and gets no hint as to why, which is how cross-language interop dies.');
console.log('');
