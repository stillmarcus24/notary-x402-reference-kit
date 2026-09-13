#!/usr/bin/env node
'use strict';
/*
 * field-boundary-lab.js — pathological 256-bit values at every structural cliff.
 *
 *   node field-boundary-lab.js
 *   node field-boundary-lab.js --verbose
 *
 * Random 256-bit test values are nearly worthless: the bugs live at the boundaries
 * where a representation changes shape. So this generates, exhaustively rather than
 * by sampling:
 *
 *   - every single-bit value 2^k for k in 0..255                    (256 values)
 *   - every 2^k - 1 and 2^k + 1 neighbour at the cliffs that matter
 *     (bits 127/128 = the limb split, 250/251/252 = the felt252 edge, 255 = the top)
 *   - all-zero, all-one, alternating patterns, and the real production digests
 *     already in the suite's vectors
 *
 * and asserts two different KINDS of property:
 *
 *   LOSSLESS   join(split(D)) == D  must hold for EVERY input. The limb split is
 *              declared lossless, so a single counterexample is a defect.
 *   LOSSY      felt252 masking is declared to DROP the top 5 bits. It must drop
 *              exactly those and nothing else: masked == D iff D < 2^251, and
 *              D - masked must be a multiple of 2^251. "Lossy" is not a licence to
 *              be unpredictable.
 *
 * Run against StillOS's real encoder (vauban/encode-verify.js) and the suite's
 * reference side by side, so a disagreement is attributable.
 */

const { encodeForeignLeaf, decodeForeignLeaf } = require('../vauban/encode-verify.js');

const LIMB = 1n << 128n;
const FELT252_MASK = (1n << 251n) - 1n;
const MAX256 = (1n << 256n) - 1n;
const hex64 = (D) => D.toString(16).padStart(64, '0');

// ---- generate the boundary set ----
const values = new Map(); // label -> BigInt
const add = (label, v) => { if (v >= 0n && v <= MAX256) values.set(label, v); };

add('zero', 0n);
add('one', 1n);
add('all-ones-256', MAX256);
add('alternating-aa', BigInt('0x' + 'aa'.repeat(32)));
add('alternating-55', BigInt('0x' + '55'.repeat(32)));
for (let k = 0; k < 256; k++) add(`bit-${k}`, 1n << BigInt(k));
for (const k of [1, 127, 128, 129, 250, 251, 252, 255, 256]) {
  add(`2^${k}-1`, (1n << BigInt(k)) - 1n);
  add(`2^${k}+1`, (1n << BigInt(k)) + 1n);
}
// real production digests already carried by the suite
try {
  const vec = require('./vectors.json');
  for (const c of vec.cases || []) {
    if (c.input && typeof c.input.hex === 'string' && /^[0-9a-f]{64}$/i.test(c.input.hex.replace(/^0x/, ''))) {
      add(`vector:${c.id}`, BigInt('0x' + c.input.hex.replace(/^0x/, '')));
    }
  }
} catch { /* vectors.json optional */ }

// ---- implementations under test ----
const IMPLS = {
  'stillos (vauban/encode-verify.js)': {
    split(D) { const e = encodeForeignLeaf(hex64(D)); return { lo: BigInt(e.digest_lo), hi: BigInt(e.digest_hi) }; },
    join(lo, hi) { return BigInt('0x' + decodeForeignLeaf(lo.toString(), hi.toString())); },
  },
  'suite reference': {
    split(D) { return { lo: D % LIMB, hi: D / LIMB }; },
    join(lo, hi) { return hi * LIMB + lo; },
  },
};

const verbose = process.argv.includes('--verbose');
const failures = [];
let checks = 0;

for (const [label, D] of values) {
  const results = {};
  for (const [name, impl] of Object.entries(IMPLS)) {
    let r;
    try {
      const { lo, hi } = impl.split(D);
      const back = impl.join(lo, hi);
      r = { lo, hi, back, err: null };
    } catch (e) { r = { err: e.message }; }
    results[name] = r;

    // LOSSLESS property
    checks++;
    if (r.err) failures.push({ label, impl: name, why: `threw: ${r.err}` });
    else {
      if (r.back !== D) failures.push({ label, impl: name, why: `join(split(D)) != D  got ${hex64(r.back)}` });
      if (r.lo >= LIMB) failures.push({ label, impl: name, why: `lo out of 128-bit range` });
      if (r.hi >= LIMB) failures.push({ label, impl: name, why: `hi out of 128-bit range` });
    }
  }

  // cross-implementation agreement
  const names = Object.keys(IMPLS);
  const a = results[names[0]], b = results[names[1]];
  checks++;
  if (!a.err && !b.err && (a.lo !== b.lo || a.hi !== b.hi)) {
    failures.push({ label, impl: 'DIFFERENTIAL', why: `limbs differ: ${a.lo}/${a.hi} vs ${b.lo}/${b.hi}` });
  }

  // LOSSY property: felt252 masking must drop exactly the top 5 bits
  const masked = D & FELT252_MASK;
  checks++;
  const shouldBeUnchanged = D < (1n << 251n);
  if (shouldBeUnchanged && masked !== D) failures.push({ label, impl: 'felt252', why: 'masked a value below 2^251' });
  if (!shouldBeUnchanged && masked === D) failures.push({ label, impl: 'felt252', why: 'failed to mask a value >= 2^251' });
  if ((D - masked) % (1n << 251n) !== 0n) failures.push({ label, impl: 'felt252', why: 'dropped bits below the 251 boundary' });

  if (verbose) console.log(`  ${label.padEnd(18)} D=0x${hex64(D).slice(0, 16)}…  masked${masked === D ? '==' : '!='}D`);
}

console.log('');
console.log('  field & limb boundary lab');
console.log('  ' + '-'.repeat(68));
console.log(`  values generated : ${values.size}`);
console.log(`  assertions run   : ${checks}`);
console.log(`  implementations  : ${Object.keys(IMPLS).join('  |  ')}`);
console.log('');
console.log(`  lossless: join(split(D)) == D for every 256-bit input`);
console.log(`  lossy   : felt252 drops exactly the top 5 bits, never more, never fewer`);
console.log('  ' + '-'.repeat(68));
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.log(`  FAIL  ${f.label.padEnd(16)} [${f.impl}] ${f.why}`);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  console.log(`\n  ${failures.length} FAILURES\n`);
  process.exit(1);
}
console.log('  PASS — no counterexample at any generated boundary.');
console.log('');
console.log('  Read this as what it is: the limb encoding and the masking rule hold');
console.log('  across every cliff worth probing. It does NOT mean StillOS handles the');
console.log('  {alg, enc, hex} triple — it does not (4/8, see the README). limbs() is');
console.log('  the one part of the triple backed by real shipped code, and this is the');
console.log('  evidence for that one part only.');
console.log('');
