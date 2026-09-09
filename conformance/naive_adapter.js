'use strict';
/*
 * A deliberately naive implementation, written the way it would be written by
 * someone who read the record shape but not the normative rules. Two bugs:
 *
 *   1. Treats a missing `enc` as "none" instead of rejecting the record.
 *   2. Ignores `enc` when computing the value a verifier compares against, so
 *      it never applies the felt252 mask.
 *
 * Both are the plausible mistakes, not strawmen. This exists to prove the
 * conformance suite actually catches something.
 */
const LIMB = 1n << 128n;
const clean = (h) => h.replace(/^0x/, '');

module.exports = {
  validate(rec) {
    if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
    if (!rec.alg) return { valid: false, error: 'missing_alg' };
    if (typeof rec.hex !== 'string') return { valid: false, error: 'missing_hex' };
    if (clean(rec.hex).length !== 64) return { valid: false, error: 'bad_hex_length' };
    // BUG 1: absent enc silently defaults to "none" rather than being rejected.
    return { valid: true };
  },
  storedValue(rec) {
    // BUG 2: enc ignored entirely; the full 256-bit digest is always returned.
    return BigInt('0x' + clean(rec.hex));
  },
  limbs(rec) {
    const D = BigInt('0x' + clean(rec.hex));
    return { lo: D % LIMB, hi: D / LIMB };
  },
};
