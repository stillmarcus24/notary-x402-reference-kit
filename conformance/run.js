#!/usr/bin/env node
'use strict';
/*
 * x402 digest-triple conformance runner.
 *
 * Zero dependencies, Node stdlib only, no network at run time. Point it at YOUR
 * encoder and it tells you whether you handle the {alg, enc, hex} triple and the
 * felt252 masking rule correctly.
 *
 *   node run.js                        # check the reference implementation below
 *   node run.js --adapter ./mine.js    # check yours
 *   node run.js --verbose
 *
 * An adapter is a CommonJS module exporting:
 *   validate(record) -> { valid: boolean, error?: string }
 *   storedValue(record) -> BigInt      // the value a verifier compares against on chain
 *   limbs(record) -> { lo: BigInt, hi: BigInt }
 *
 * Exit code 0 = every case behaved as specified. 1 = at least one did not.
 *
 * WHY THIS EXISTS: the felt252 rule is a false-negative generator. Storing a
 * 256-bit digest in a 251-bit field element silently drops the top 5 bits, so a
 * verifier that compares the full digest is wrong on 31 of every 32 receipts --
 * and right on the other 1, which is exactly why the bug survives a test suite
 * that only ever tries one digest. Case triple-03 is that 1-in-32 digest, and it
 * is in here so passing it alone cannot be mistaken for passing.
 */

const fs = require('fs');
const path = require('path');

const FELT252_MASK = (1n << 251n) - 1n;
const LIMB = 1n << 128n;
const KNOWN_ALGS = new Set(['sha-256', 'keccak-256', 'poseidon-252']);
const KNOWN_ENCS = new Set(['none', 'felt252-masked-251']);

// ---- reference implementation (the thing your adapter replaces) ----
const reference = {
  validate(rec) {
    if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
    if (!rec.alg) return { valid: false, error: 'missing_alg' };
    if (!KNOWN_ALGS.has(rec.alg)) return { valid: false, error: 'unknown_alg' };
    // Normative: absent enc is INVALID, never defaulted. x402#3389.
    if (rec.enc === undefined || rec.enc === null) return { valid: false, error: 'missing_enc' };
    if (!KNOWN_ENCS.has(rec.enc)) return { valid: false, error: 'unknown_enc' };
    if (typeof rec.hex !== 'string') return { valid: false, error: 'missing_hex' };
    const hex = rec.hex.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) return { valid: false, error: 'bad_hex_chars' };
    if (hex.length !== 64) return { valid: false, error: 'bad_hex_length' };
    return { valid: true };
  },
  storedValue(rec) {
    const D = BigInt('0x' + rec.hex.replace(/^0x/, ''));
    return rec.enc === 'felt252-masked-251' ? (D & FELT252_MASK) : D;
  },
  limbs(rec) {
    const D = BigInt('0x' + rec.hex.replace(/^0x/, ''));
    return { lo: D % LIMB, hi: D / LIMB };
  },
};

// ---- harness ----
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const ai = argv.indexOf('--adapter');
let impl = reference, implName = 'reference (bundled)';
if (ai > -1) {
  const p = path.resolve(argv[ai + 1]);
  impl = require(p);
  implName = p;
  for (const fn of ['validate', 'storedValue', 'limbs']) {
    if (typeof impl[fn] !== 'function') {
      console.error(`adapter is missing required export: ${fn}()`);
      process.exit(2);
    }
  }
}

const hx = (v) => '0x' + v.toString(16);
const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors.json'), 'utf8'));
const fails = [];
let pass = 0;

for (const c of suite.cases) {
  const problems = [];
  let got;
  try {
    got = impl.validate(c.input);
  } catch (e) {
    problems.push(`validate() threw: ${e.message}`);
    got = null;
  }

  if (got) {
    if (got.valid !== c.expect.valid) {
      problems.push(`valid: expected ${c.expect.valid}, got ${got.valid}`);
    }
    if (c.expect.valid === false && c.expect.error && got.error !== c.expect.error) {
      problems.push(`error: expected "${c.expect.error}", got "${got.error}"`);
    }
  }

  if (got && got.valid && c.expect.valid) {
    try {
      if (c.expect.stored !== undefined) {
        const stored = impl.storedValue(c.input);
        if (hx(stored) !== c.expect.stored) {
          problems.push(`stored: expected ${c.expect.stored}, got ${hx(stored)}`);
        }
        const full = BigInt('0x' + c.input.hex.replace(/^0x/, ''));
        const eq = full === stored;
        if (c.expect.full_equals_stored !== undefined && eq !== c.expect.full_equals_stored) {
          problems.push(
            `full_equals_stored: expected ${c.expect.full_equals_stored}, got ${eq}` +
            (c.expect.full_equals_stored === false
              ? ' -- this is the 31-in-32 false negative; your verifier is comparing the unmasked digest'
              : '')
          );
        }
        if (c.expect.top5bits !== undefined) {
          const t = Number(full >> 251n);
          if (t !== c.expect.top5bits) problems.push(`top5bits: expected ${c.expect.top5bits}, got ${t}`);
        }
      }
      if (c.expect.digest_lo !== undefined) {
        const { lo, hi } = impl.limbs(c.input);
        if (hx(lo) !== c.expect.digest_lo) problems.push(`digest_lo: expected ${c.expect.digest_lo}, got ${hx(lo)}`);
        if (hx(hi) !== c.expect.digest_hi) problems.push(`digest_hi: expected ${c.expect.digest_hi}, got ${hx(hi)}`);
        const rebuilt = (hi * LIMB + lo).toString(16).padStart(64, '0');
        if (c.expect.roundtrip !== undefined && rebuilt !== c.expect.roundtrip) {
          problems.push(`roundtrip: limbs do not reconstruct the digest (got ${rebuilt})`);
        }
      }
    } catch (e) {
      problems.push(`encoding threw: ${e.message}`);
    }
  }

  if (problems.length === 0) {
    pass++;
    if (verbose) console.log(`  PASS  ${c.id}${c.synthetic ? '  [synthetic]' : ''}`);
  } else {
    fails.push({ id: c.id, description: c.description, problems });
    console.log(`  FAIL  ${c.id}`);
    problems.forEach((p) => console.log(`          ${p}`));
  }
}

console.log('');
console.log(`  suite      : ${suite.suite} v${suite.version}`);
console.log(`  implementation: ${implName}`);
console.log(`  result     : ${pass}/${suite.cases.length} cases behaved as specified`);
if (fails.length) {
  console.log('');
  console.log('  The felt252 cases (triple-02 / triple-03) are the ones worth reading twice:');
  console.log('  a verifier can pass triple-03 and fail triple-02 while looking correct in');
  console.log('  production 1 run in 32. That is the failure this suite exists to catch.');
}
process.exit(fails.length ? 1 : 0);
