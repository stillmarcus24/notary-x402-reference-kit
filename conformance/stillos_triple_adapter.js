'use strict';
/*
 * StillOS's REAL digest-triple implementation, mapped from shipped code.
 *
 * The README claimed StillOS scores 8/8 on this suite while shipping no adapter to
 * produce that number — the same unreproducible-claim defect as the strawman row,
 * found 2026-09-13 by auditing for siblings of that defect rather than fixing the
 * one instance. This file is the honest measurement.
 *
 * `limbs()` is a direct binding to vauban/encode-verify.js — real shipped code,
 * used for the Vauban v3 foreign-leaf encoding, with its own division-vs-bitshift
 * cross-check.
 *
 * `validate()` and `storedValue()` have NO shipped counterpart. StillOS does not
 * implement the {alg, enc, hex} triple anywhere: it emits bare 64-char hex digests
 * and has no felt252 masking path and no `enc` concept at all. Rather than write a
 * conformant implementation here and score it — which would measure this file, not
 * StillOS — these return what StillOS's actual behaviour amounts to: accept any
 * well-formed 32-byte hex, compare the digest unmasked.
 *
 * That is the 31-in-32 false negative, in our own stack, stated rather than hidden.
 */
const { encodeForeignLeaf } = require('../vauban/encode-verify.js');

const clean = (h) => String(h).replace(/^0x/, '');

module.exports = {
  NAME: 'StillOS real (vauban/encode-verify.js + notary digest emission)',

  // StillOS emits and consumes bare hex. There is no enc/alg validation in the
  // shipped code, so the honest mapping accepts anything shaped like a digest.
  validate(rec) {
    if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
    if (typeof rec.hex !== 'string') return { valid: false, error: 'missing_hex' };
    if (!/^[0-9a-fA-F]{64}$/.test(clean(rec.hex))) return { valid: false, error: 'bad_hex_length' };
    return { valid: true };
  },

  // No masking path exists in StillOS. The full 256-bit digest is what we compare.
  storedValue(rec) {
    return BigInt('0x' + clean(rec.hex));
  },

  // Real shipped code, unmodified.
  limbs(rec) {
    const e = encodeForeignLeaf(clean(rec.hex));
    return { lo: BigInt(e.digest_lo), hi: BigInt(e.digest_hi) };
  },
};
