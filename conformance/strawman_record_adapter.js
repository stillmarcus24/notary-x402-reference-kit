'use strict';
/*
 * The integrity-only strawman.
 *
 * This is not a bad implementation. Its integrity axis is complete and correct —
 * it scores 14/14, the same as the reference and the same as StillOS. It is in
 * this repository because it is the SHAPE most evidence implementations actually
 * have today: cryptography done properly, and the commercial question answered
 * with a confident "OK" because nothing in the stack ever looked at it.
 *
 * Every record it green-lights on the settlement axis is cryptographically
 * perfect. Correctly hashed, correctly signed, correctly chained — and, in six of
 * eight cases, describing a transaction that did not happen the way the record
 * says it did. That is the entire argument for splitting the two axes: an
 * implementation like this one reads as conformant until someone writes the
 * second column down next to the first.
 *
 * It also ships for a duller reason. The README used to quote this row of the
 * scoreboard without shipping the adapter that produces it — an unreproducible
 * number in a document whose whole claim is "run it yourself." Now it is
 * reproducible:
 *
 *   node run-record.js --adapter ./strawman_record_adapter.js
 *   -> integrity 14/14, settlement 1/8, TOTAL 15/22
 *
 * The one settlement assertion it passes is rec-01, the clean exchange. It gets
 * that one right by accident: it answers OK to everything, and rec-01 happens to
 * be OK. Passing by luck is the failure mode this suite is built to expose, so
 * having a worked example of it in the tree is the point, not an embarrassment.
 */

const NAME = 'integrity-only strawman';

const KNOWN_KEYS = new Set(['21de066900082465', '0e0e11945b1d0018']);

// Complete. Recomputes rather than trusting the stated hash, resolves the key the
// record names, and checks the chain link.
function verifyRecord(rec, ctx) {
  if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
  if (!ctx.knownKeys.has(rec.signer_key_id)) return { valid: false, error: 'unknown_key' };
  if (rec.signature === 'SIG-CORRUPT') return { valid: false, error: 'signature_invalid' };
  if (rec.signature === 'SIG-VALID-WRONGKEY') return { valid: false, error: 'wrong_key' };
  if (rec.signature !== 'SIG-VALID') return { valid: false, error: 'signature_invalid' };
  if (rec.record_hash !== rec.__true_record_hash) return { valid: false, error: 'digest_mismatch' };
  if (rec.request_digest !== rec.__true_request_digest) return { valid: false, error: 'content_mutated' };
  if (rec.prev_record_hash !== ctx.expectedPrevHash) return { valid: false, error: 'chain_link_mismatch' };
  return { valid: true };
}

// Absent, wearing the costume of an answer. Note what is NOT here: no comparison
// of settled payee against quoted payee, no amount arithmetic, no delivery leg,
// no mandate check, and — worst of the set — no way to say INDETERMINATE when the
// source of record is unreachable. A verifier with this shape cannot report a
// commercial failure, so from the outside it never sees one.
function settlementCheck(_rec) {
  return { status: 'OK' };
}

module.exports = { NAME, verifyRecord, settlementCheck };
