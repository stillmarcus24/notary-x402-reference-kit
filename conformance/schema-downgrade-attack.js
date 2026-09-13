#!/usr/bin/env node
'use strict';
/*
 * schema-downgrade-attack.js
 *
 * The attack: can the mere PRESENCE of an unrecognized field launder a definite
 * mutation of a known, committed field into a harmless-looking "this receipt is
 * newer than me" verdict?
 *
 * If yes, "unknown is not a refutation" — correct on its own — becomes a universal
 * forgery laundromat: append `{"x":1}` to any tampered receipt and every verifier
 * downgrades INVALID to INDETERMINATE.
 *
 *   A1  baseline               untouched receipt                  -> intact
 *   A2  known-field mutation   claim_sha256 changed               -> INVALID
 *   A3  THE ATTACK             claim_sha256 changed + unknown fld -> must stay INVALID
 *   A4  pure schema evolution  untouched + unknown field          -> UNSUPPORTED
 *   A5  frozen-profile probe   legacy shape + extra field, hash ok-> INVALID
 */
const fs = require('fs');
const V = require('../verify-offline-pinned.js');

const src = process.argv[2];
if (!src) { console.error('usage: node schema-downgrade-attack.js <real-receipt.json>'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(src, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(base));

function classify(r) {
  const c = V.verifyReceipt(r).checks;
  if (c.hash_intact === true) return 'INTACT';
  if (c.hash_intact === false) return 'INVALID';
  if (c.hash_intact === null) return 'UNSUPPORTED_SCHEMA';
  return 'UNDEFINED(' + String(c.hash_intact) + ')';
}

const A2 = clone(); A2.claim_sha256 = 'de'.repeat(32);
const A3 = clone(); A3.claim_sha256 = 'de'.repeat(32); A3.future_magic = 'foo';
const A4 = clone(); A4.future_magic = 'foo';
const A5 = clone(); A5.future_magic = 'foo'; // hash untouched, field appended

const CASES = [
  ['A1 baseline, untouched',                       base, 'INTACT'],
  ['A2 known committed field mutated',             A2,   'INVALID'],
  ['A3 ATTACK: mutation + unknown field',          A3,   'INVALID'],
  ['A4 unknown field only, nothing mutated',       A4,   'UNSUPPORTED_SCHEMA'],
  ['A5 legacy shape + extra field',                A5,   'UNSUPPORTED_SCHEMA'],
];

console.log('');
console.log('  schema downgrade attack');
console.log('  ' + '-'.repeat(70));
let fails = 0;
for (const [name, rec, want] of CASES) {
  const got = classify(rec);
  const ok = got === want;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} got=${got.padEnd(19)} want=${want}`);
}
console.log('  ' + '-'.repeat(70));
if (fails) {
  console.log(`\n  ${fails} FAILED. If A3 is the failure, an unknown field laundered a`);
  console.log('  definite known-field mutation into "newer schema". That is a forgery');
  console.log('  laundromat, not schema tolerance.\n');
  process.exit(1);
}
console.log('\n  Unknown-schema tolerance does not launder a known-field mutation.\n');
