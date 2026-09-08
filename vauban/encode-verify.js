#!/usr/bin/env node
// Independent encoder + verifier for the Vauban v3 foreign-leaf digest limb
// encoding (x402-foundation/x402#3389, §4.1-4.2, vauban-org/x402-starknet
// docs/stark-receipt-profile-v0.1.md as of 2026-09-08). Zero StillOS-specific
// dependencies -- takes any 32-byte hex digest and independently derives
// digest_lo/digest_hi the way §4.2 specifies:
//   D = the 32 bytes read as one big-endian unsigned integer
//   digest_lo = D mod 2^128
//   digest_hi = D >> 128    (i.e. D div 2^128)
// This mirrors Cairo's u256 { low, high } struct per the spec.
'use strict';

function encodeForeignLeaf(receiptHashHex) {
  if (!/^[0-9a-f]{64}$/i.test(receiptHashHex)) {
    throw new Error('expected a 64-char hex string (32 bytes), got: ' + receiptHashHex);
  }
  const D = BigInt('0x' + receiptHashHex);
  const TWO_128 = 1n << 128n;
  const digest_lo = D % TWO_128;
  const digest_hi = D / TWO_128; // BigInt division truncates toward zero == floor for non-negatives, equivalent to D >> 128n
  // Cross-check against the bitwise form to prove the two are equivalent, not just "probably right":
  const digest_hi_bitwise = D >> 128n;
  if (digest_hi !== digest_hi_bitwise) throw new Error('digest_hi derivation mismatch -- division and bit-shift forms disagree');
  return {
    receipt_hash_hex: receiptHashHex,
    digest_D_decimal: D.toString(10),
    digest_lo: digest_lo.toString(10),
    digest_hi: digest_hi.toString(10),
    digest_lo_hex: '0x' + digest_lo.toString(16),
    digest_hi_hex: '0x' + digest_hi.toString(16),
  };
}

function decodeForeignLeaf(digest_lo_str, digest_hi_str) {
  const TWO_128 = 1n << 128n;
  const lo = BigInt(digest_lo_str);
  const hi = BigInt(digest_hi_str);
  if (lo < 0n || lo >= TWO_128) throw new Error('digest_lo out of 128-bit range');
  const D = hi * TWO_128 + lo;
  return D.toString(16).padStart(64, '0');
}

if (require.main === module) {
  const hash = process.argv[2];
  if (!hash) { console.error('usage: node encode-verify.js <64-char-hex-receipt_hash>'); process.exit(2); }
  const encoded = encodeForeignLeaf(hash);
  const roundTrip = decodeForeignLeaf(encoded.digest_lo, encoded.digest_hi);
  const roundTripOk = roundTrip === hash.toLowerCase();
  console.log(JSON.stringify({ ...encoded, round_trip_decode_matches_input: roundTripOk }, null, 2));
  process.exitCode = roundTripOk ? 0 : 1;
}

module.exports = { encodeForeignLeaf, decodeForeignLeaf };
