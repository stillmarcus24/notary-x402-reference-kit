'use strict';
/*
 * StillOS notary adapter — our own real score on this suite.
 *
 * This file exists so the suite's author is the first implementation measured by
 * it, and so the score is not a marketing number. Where StillOS has no mechanism,
 * this returns UNSUPPORTED rather than guessing a plausible answer. UNSUPPORTED is
 * counted as a failure by the runner. That is correct: a verifier that cannot see a
 * failure mode does not get partial credit for being honest about it.
 *
 * Mapped from the live implementation published at tag foreseal-bilateral-v1.1
 * (implementation/bond/, verify-offline-pinned.js, docs/STILLOS_NOTARY_RECEIPT_V1.md).
 */

const NAME = 'StillOS notary';

// Historical keyring, not "the current key". Resolving the key a record NAMES
// rather than the key that is live at verification time is the difference between
// rec-07 passing and every pre-rotation record being retroactively invalidated --
// which is a real false-negative StillOS shipped and had to fix on 2026-09-10,
// after /verify called 175 valid receipts broken following a key rotation.
const KEYRING = new Set(['21de066900082465', '0e0e11945b1d0018']);

function verifyRecord(rec, ctx) {
  if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
  if (!KEYRING.has(rec.signer_key_id)) return { valid: false, error: 'unknown_key' };
  if (rec.signature === 'SIG-CORRUPT') return { valid: false, error: 'signature_invalid' };
  if (rec.signature === 'SIG-VALID-WRONGKEY') return { valid: false, error: 'wrong_key' };
  if (rec.signature !== 'SIG-VALID') return { valid: false, error: 'signature_invalid' };
  if (rec.record_hash !== rec.__true_record_hash) return { valid: false, error: 'digest_mismatch' };
  if (rec.request_digest !== rec.__true_request_digest) return { valid: false, error: 'content_mutated' };
  if (rec.prev_record_hash !== ctx.expectedPrevHash) return { valid: false, error: 'chain_link_mismatch' };
  return { valid: true };
}

function settlementCheck(rec) {
  // WHAT STILLOS ACTUALLY HAS.
  //
  // 1. Unreachable source -> INDETERMINATE, never a refutation.
  //    Real: verdict_dispute.cjs refuses to overturn when the resolver cannot
  //    reach its source, and reserves no dispute_id so a later retry is not
  //    blocked as a duplicate.
  if (rec.source_available === false) {
    return { status: 'INDETERMINATE', reason: 'resolver could not reach the source of record; retryable, not a refutation' };
  }

  // 2. Overturned after a clean settlement -> a durable, inspectable debt.
  //    Real: slash_obligations.cjs opens SLASH_OWED synchronously on an upheld
  //    dispute, before any alert and before any signature is sought.
  if (rec.overturned && rec.overturned.overturned) {
    return { status: 'OVERTURNED_AFTER_VALID_SETTLEMENT', reason: 'obligation opened in SLASH_OWED; payout is 2-of-2 governed with no committed SLA' };
  }

  // ---- WHAT STILLOS DOES NOT HAVE. Stated, not simulated. ----
  //
  // Checked most-specific first. An earlier revision tested the quote before the
  // mandate, which made the authority branch unreachable and reported the wrong
  // reason for rec-12 -- a record can carry both, and the narrower gap is the
  // honest one to name.
  //
  // 3. No authority binding in the record. StillOS ships an authority verifier
  //    (x402-authority-verifier-kit, 39/39 vectors) but it is a separate surface
  //    and its evidence digest is not carried in the notary record, so a mandate
  //    mismatch cannot be detected from the record alone.
  if (rec.authority) {
    return { status: 'UNSUPPORTED', reason: 'authority evidence is verified by a separate kit and is not bound into the notary record' };
  }

  // 4. No delivery primitive. StillOS notarises CLAIMS about external facts; it
  //    has no concept of a delivered artifact bound to a payment, so it cannot
  //    distinguish settled-not-delivered from delivered-not-settled from a clean
  //    exchange. Both @StelarDigital cases are genuinely outside what we can see.
  if (!(rec.delivery && rec.delivery.delivered) || !(rec.payment && rec.payment.reference)) {
    return { status: 'UNSUPPORTED', reason: 'no delivery primitive: nothing binds a delivered artifact to a settlement, so neither leg can be checked against the other' };
  }

  // 5. No quote binding. The x402 402-challenge advertises a price and the
  //    facilitator settles it, but the settled payee/asset/amount are never
  //    written into the receipt alongside the quoted ones, so nothing can
  //    compare them afterwards. Payee-redirect and underpayment are both
  //    invisible to us today.
  if (rec.quote) {
    return { status: 'UNSUPPORTED', reason: 'receipt does not carry the quote, so settled payee/asset/amount cannot be compared against what was advertised' };
  }

  return { status: 'OK' };
}

module.exports = { NAME, verifyRecord, settlementCheck };
