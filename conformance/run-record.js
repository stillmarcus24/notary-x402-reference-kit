#!/usr/bin/env node
'use strict';
/*
 * x402 evidence-record conformance runner — issue 2887.
 *
 * Sibling of run.js (which covers the #3389 digest triple). Same contract: zero
 * dependencies, Node stdlib only, no network at run time, exit 0 iff every case
 * behaved as specified.
 *
 *   node run-record.js                          # score the bundled reference
 *   node run-record.js --adapter ./mine.js      # score yours
 *   node run-record.js --adapter ./stillos_adapter.js
 *   node run-record.js --verbose
 *
 * An adapter exports two functions, one per axis:
 *
 *   verifyRecord(record, ctx) -> { valid: boolean, error?: string }
 *   settlementCheck(record)   -> { status: string, reason?: string }
 *
 * ctx = { knownKeys: Set<string>, expectedPrevHash: string|null }
 *
 * ---------------------------------------------------------------------------
 * WHY SIGNATURES ARE SYMBOLIC, AND WHY THAT IS THE POINT
 *
 * The signature field carries the literal tokens SIG-VALID, SIG-CORRUPT and
 * SIG-VALID-WRONGKEY rather than real bytes. This is deliberate and it is the only
 * way a suite like this can be portable.
 *
 * Parties on 2887 sign with different primitives — Ed25519, secp256k1, STARK-native
 * hashes. Shipping real signature bytes would mean shipping OUR curve, which would
 * make this suite an instrument for adopting StillOS's crypto and nobody else's.
 * That is exactly the outcome the suite is designed NOT to produce.
 *
 * So the suite tests verifier LOGIC, not any specific cipher: does your
 * implementation distinguish intact from corrupt, and right-key from wrong-key, and
 * does it recompute rather than trust? Substituting your real crypto behind these
 * three tokens is a few lines in your adapter. What the suite refuses to do is
 * pretend that agreeing on a curve is the same as agreeing on semantics.
 *
 * The settlement axis needs no such caveat: it is arithmetic and comparison over
 * two independently-sourced facts, and it is identical for everyone.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const KNOWN_KEYS = new Set(['21de066900082465', '0e0e11945b1d0018']);

// ---- reference implementation: what a complete verifier does on both axes ----
const reference = {
  verifyRecord(rec, ctx) {
    if (!rec || typeof rec !== 'object') return { valid: false, error: 'not_an_object' };
    if (!ctx.knownKeys.has(rec.signer_key_id)) return { valid: false, error: 'unknown_key' };
    if (rec.signature === 'SIG-CORRUPT') return { valid: false, error: 'signature_invalid' };
    if (rec.signature === 'SIG-VALID-WRONGKEY') return { valid: false, error: 'wrong_key' };
    if (rec.signature !== 'SIG-VALID') return { valid: false, error: 'signature_invalid' };
    // Recompute, never trust the stated hash.
    if (rec.record_hash !== rec.__true_record_hash) return { valid: false, error: 'digest_mismatch' };
    if (rec.request_digest !== rec.__true_request_digest) return { valid: false, error: 'content_mutated' };
    if (rec.prev_record_hash !== ctx.expectedPrevHash) return { valid: false, error: 'chain_link_mismatch' };
    return { valid: true };
  },
  settlementCheck(rec) {
    // Order matters. Unknown must be resolved before anything is called a breach:
    // an unreachable source is not evidence of non-delivery.
    if (rec.source_available === false) return { status: 'INDETERMINATE', reason: 'source_of_record_unreachable' };
    if (rec.overturned && rec.overturned.overturned) {
      return { status: 'OVERTURNED_AFTER_VALID_SETTLEMENT', reason: 'claim disproven after a clean settlement' };
    }
    if (rec.authority) {
      if (rec.authority.subject !== (rec.payment && rec.payment.payer)) {
        return { status: 'AUTHORITY_MISMATCH', reason: 'mandate subject is not the acting party' };
      }
    }
    const paid = !!(rec.payment && rec.payment.reference);
    const delivered = !!(rec.delivery && rec.delivery.delivered);
    if (paid && !delivered) return { status: 'SETTLED_NOT_DELIVERED', reason: 'payment landed, nothing delivered' };
    if (delivered && !paid) return { status: 'DELIVERED_NOT_SETTLED', reason: 'delivered with no settlement reference' };
    if (paid && rec.quote) {
      if (rec.payment.payee !== rec.quote.payee) return { status: 'PAYEE_MISMATCH', reason: `paid ${rec.payment.payee}, quoted ${rec.quote.payee}` };
      if (rec.payment.asset !== rec.quote.asset) return { status: 'AMOUNT_MISMATCH', reason: 'asset differs from quote' };
      // Integer minor units compared as BigInt. Never floats.
      if (BigInt(rec.payment.amount) !== BigInt(rec.quote.amount)) {
        return { status: 'AMOUNT_MISMATCH', reason: `settled ${rec.payment.amount}, quoted ${rec.quote.amount}` };
      }
    }
    return { status: 'OK' };
  },
};

// ---- harness ----
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const json = argv.includes('--json');
const ai = argv.indexOf('--adapter');
let impl = reference, implName = 'reference (bundled, complete on both axes)';
if (ai > -1) {
  const p = path.resolve(argv[ai + 1]);
  impl = require(p);
  implName = (impl.NAME ? impl.NAME + ' — ' : '') + p;
  for (const fn of ['verifyRecord', 'settlementCheck']) {
    if (typeof impl[fn] !== 'function') { console.error(`adapter is missing required export: ${fn}()`); process.exit(2); }
  }
}

const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'record-vectors.json'), 'utf8'));
const base = suite.cases.find(c => c.id === 'rec-01').input;

function setPath(obj, dotted, val) {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}

function buildInput(c) {
  const rec = JSON.parse(JSON.stringify(c.input || base));
  if (c.mutate) setPath(rec, c.mutate.field, c.mutate.to);
  // Truth fields the reference recomputes against. A real adapter recomputes from
  // its own canonicalisation instead; these exist so the suite can express
  // "content was altered after signing" without shipping a canonicalisation format.
  rec.__true_record_hash = c.mutate && c.mutate.field === 'record_hash' ? base.record_hash : rec.record_hash;
  rec.__true_request_digest = c.mutate && c.mutate.field === 'request_digest' ? base.request_digest : rec.request_digest;
  return rec;
}

const ctx = { knownKeys: KNOWN_KEYS, expectedPrevHash: base.prev_record_hash };
const results = [];
let pass = 0, total = 0;
const byAxis = { integrity: { pass: 0, total: 0 }, settlement: { pass: 0, total: 0 } };

// Scored per ASSERTION, not per case. rec-01 asserts on both axes: it is the
// positive control for integrity AND the clean-exchange control for settlement.
// Charging its settlement miss to the integrity column (the first version of this
// runner did) understates integrity and hides which axis is actually weak, which
// is the one thing this suite exists to show.
for (const c of suite.cases) {
  const rec = buildInput(c);
  const problems = [];

  if (c.expect.integrity_valid !== undefined) {
    const p = [];
    let got;
    try { got = impl.verifyRecord(rec, ctx); }
    catch (e) { p.push(`verifyRecord() threw: ${e.message}`); got = null; }
    if (got) {
      if (got.valid !== c.expect.integrity_valid) p.push(`integrity_valid: expected ${c.expect.integrity_valid}, got ${got.valid}`);
      if (c.expect.integrity_error && got.error !== c.expect.integrity_error) {
        p.push(`integrity_error: expected "${c.expect.integrity_error}", got "${got.error}"`);
      }
    }
    byAxis.integrity.total++; total++;
    if (p.length === 0) { byAxis.integrity.pass++; pass++; } else problems.push(...p);
  }

  if (c.expect.settlement_status !== undefined) {
    const p = [];
    let got;
    try { got = impl.settlementCheck(rec); }
    catch (e) { p.push(`settlementCheck() threw: ${e.message}`); got = null; }
    if (got) {
      if (got.status !== c.expect.settlement_status) {
        p.push(`settlement_status: expected ${c.expect.settlement_status}, got ${got.status}` +
          (got.status === 'UNSUPPORTED' && got.reason ? ` — ${got.reason}` : ''));
      }
      // Some wrong answers are categorically worse than others.
      if (c.expect.must_not_be && got.status === c.expect.must_not_be) {
        p.push(`returned ${got.status} — treating an unreachable source as a refutation overturns correct records during someone else's outage`);
      }
    }
    byAxis.settlement.total++; total++;
    if (p.length === 0) { byAxis.settlement.pass++; pass++; } else problems.push(...p);
  }

  const ok = problems.length === 0;
  results.push({ id: c.id, axis: c.axis, ok, description: c.description, problems });
  if (!ok) { console.log(`  FAIL  ${c.id}  [${c.axis}]  ${c.description}`); problems.forEach(x => console.log(`          ${x}`)); }
  else if (verbose) console.log(`  PASS  ${c.id}  [${c.axis}]`);
}

if (json) {
  console.log(JSON.stringify({ suite: suite.suite, version: suite.version, implementation: implName, pass, total, by_axis: byAxis, results }, null, 2));
} else {
  console.log('');
  console.log(`  suite         : ${suite.suite} v${suite.version}  (${suite.status.split('—')[0].trim()})`);
  console.log(`  implementation: ${implName}`);
  for (const [axis, v] of Object.entries(byAxis)) {
    console.log(`  ${axis.padEnd(14)}: ${v.pass}/${v.total}`);
  }
  console.log(`  TOTAL         : ${pass}/${total} assertions across ${suite.cases.length} cases`);
  if (pass < total) {
    console.log('');
    console.log('  An implementation can score full marks on integrity and near-zero on');
    console.log('  settlement. That is not a bug in the implementation — it is the shape of');
    console.log('  the gap, and it is invisible until both axes are written down side by side.');
  }
}
process.exit(pass === total ? 0 : 1);
