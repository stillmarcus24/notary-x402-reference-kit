#!/usr/bin/env node
'use strict';
/*
 * differential.js — disagreement as a bug oracle.
 *
 *   node differential.js --corpus <records.jsonl> --impl a=./a.js --impl b=./b.js
 *   node differential.js --corpus <records.jsonl> --impl ... --shape-by resolver_hash,drand_round
 *   node differential.js --selftest
 *
 * ---------------------------------------------------------------------------
 * THE IDEA
 *
 * Every other suite in this directory asks "does implementation X match the
 * expectation a human wrote down?" That only ever finds bugs a human already
 * suspected. This one asks a different question, and it needs no oracle at all:
 *
 *     given the same record, do two independent implementations disagree?
 *
 * A disagreement is a bug *somewhere* — in one of them, or in the spec that let
 * both be written — and it is detectable without anyone knowing in advance which
 * is right. That is the property that makes it worth building: it finds the bugs
 * nobody thought to write a vector for.
 *
 * The dangerous case is not a crash. It is two implementations that both return
 * VALID, both look correct, and describe different realities. Or, as measured
 * below, two implementations of one hash preimage that disagree about whether
 * 6.1% of a real production ledger is authentic.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT FOUND ON ITS FIRST RUN, 2026-09-13
 *
 * Corpus: the real StillOS notary book, 2,892 receipts, no synthetic data.
 * Implementations: the live service's receiptPreimage() (core/
 * notary_service_marcus.cjs:1671) and the published offline verifier
 * (verify-offline-pinned.js) — the zero-network artifact we hand to strangers.
 *
 *     receipts            : 2892
 *     both say intact     : 2715
 *     both say broken     : 0
 *     DISAGREE            : 177  (6.1%)
 *
 *     shape       n      live-ok  published-ok  DISAGREE
 *     base        2502   2502     2502          0
 *     resolver    213    213      213           0
 *     drand       177    177      0             177
 *
 * The published verifier reported `hash_intact: false` on 177 receipts whose
 * Ed25519 signature verifies against the pinned key — the notary demonstrably
 * signed them. Their preimage carries two fields the published script did not
 * know about. Neither implementation was "wrong" in isolation; each was only
 * ever run against receipts it happened to handle, which is precisely why the
 * divergence survived. Partitioning by shape is what turned 177 scattered
 * failures into one root cause, so `--shape-by` is not a convenience.
 *
 * Fixed the same session, and the fix is the doctrinally interesting part: the
 * published verifier now reconstructs every known shape AND returns
 * `hash_intact: null` (unrecognized schema) rather than `false` when it meets a
 * receipt newer than itself. Unknown is not a refutation. Same rule as rec-13
 * and as replay-anchor.js on an unreachable RPC.
 * ---------------------------------------------------------------------------
 *
 * An implementation module exports:
 *   NAME    : string
 *   verdict(record) -> any JSON-comparable value (true/false/null, or a status
 *                      string, or an object — compared by canonical JSON)
 * Throwing is itself a verdict: it is recorded as {threw: message} and an
 * implementation that throws where another returns cleanly IS a disagreement.
 */

const fs = require('fs');
const path = require('path');

// ---- args ----
const argv = process.argv.slice(2);
function opt(n, d = null) { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; }
function opts(n) { const out = []; argv.forEach((a, i) => { if (a === n) out.push(argv[i + 1]); }); return out; }

// Canonical comparison. Deliberately NOT JSON.stringify on the raw value: key
// order must not make two equal verdicts look different, which would turn this
// tool into a generator of false disagreements.
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

function shapeOf(rec, keys) {
  if (!keys.length) return 'all';
  const present = keys.filter(k => rec[k] !== undefined && rec[k] !== null && rec[k] !== false);
  return present.length ? present.join('+') : 'base';
}

function run({ corpus, impls, shapeKeys, limit }) {
  const rows = fs.readFileSync(corpus, 'utf8').split('\n').filter(Boolean);
  const stats = { records: 0, unanimous: 0, split: 0 };
  const byShape = new Map();
  const examples = new Map(); // signature of the split -> first record seen

  for (const line of rows) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (limit && stats.records >= limit) break;
    stats.records++;

    const verdicts = impls.map(im => {
      try { return canon(im.verdict(rec)); }
      catch (e) { return canon({ threw: String(e.message).slice(0, 120) }); }
    });

    const shape = shapeOf(rec, shapeKeys);
    if (!byShape.has(shape)) byShape.set(shape, { n: 0, split: 0, agree: new Array(impls.length).fill(0) });
    const s = byShape.get(shape);
    s.n++;

    const distinct = new Set(verdicts);
    if (distinct.size === 1) {
      stats.unanimous++;
    } else {
      stats.split++;
      s.split++;
      // Majority is a heuristic for "probably right", never a proof. It exists to
      // point a human at the odd one out, not to adjudicate.
      const tally = {};
      verdicts.forEach(v => { tally[v] = (tally[v] || 0) + 1; });
      const majority = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      verdicts.forEach((v, i) => { if (v === majority) s.agree[i]++; });
      const sig = shape + '|' + verdicts.join('||');
      if (!examples.has(sig)) {
        examples.set(sig, { shape, record: rec, verdicts });
      }
    }
  }
  return { stats, byShape, examples };
}

function report(r, impls) {
  const { stats, byShape, examples } = r;
  console.log('');
  console.log('  differential — disagreement as a bug oracle');
  console.log('  ' + '-'.repeat(68));
  impls.forEach((im, i) => console.log(`  [${i}] ${im.NAME}`));
  console.log('  ' + '-'.repeat(68));
  console.log(`  records        : ${stats.records}`);
  console.log(`  unanimous      : ${stats.unanimous}`);
  console.log(`  DISAGREE       : ${stats.split}` +
    (stats.records ? `  (${(100 * stats.split / stats.records).toFixed(1)}%)` : ''));
  console.log('');

  if (byShape.size > 1 || stats.split) {
    const w = Math.max(12, ...[...byShape.keys()].map(k => k.length + 2));
    console.log('  ' + 'shape'.padEnd(w) + 'n'.padEnd(8) + 'DISAGREE');
    for (const [k, v] of byShape) {
      const flag = v.split ? '  <-- partitions cleanly by shape' : '';
      console.log('  ' + k.padEnd(w) + String(v.n).padEnd(8) + String(v.split) + flag);
    }
    console.log('');
  }

  if (!stats.split) {
    console.log('  No disagreement. That is NOT proof of correctness: implementations that');
    console.log('  share an author, a library, or a misreading agree on being wrong. It means');
    console.log('  this corpus did not separate them — feed it a harsher one.');
    console.log('');
    return 0;
  }

  console.log(`  ${examples.size} distinct disagreement signature(s). First record of each:`);
  console.log('');
  let n = 0;
  for (const { shape, record, verdicts } of examples.values()) {
    console.log(`  --- signature ${++n}  [shape: ${shape}] ---`);
    const id = record.receipt_hash || record.id || record.record_hash || '(no id field)';
    console.log(`      record: ${String(id).slice(0, 66)}`);
    verdicts.forEach((v, i) => console.log(`      [${i}] ${impls[i].NAME.padEnd(34)} ${v.slice(0, 90)}`));
    console.log('');
  }
  console.log('  A disagreement is a bug in one of them, or in the spec that permitted');
  console.log('  both readings. It is detectable without knowing which is right — that');
  console.log('  is the whole reason to run this instead of writing more vectors.');
  console.log('');
  return 1;
}

// ---- self-test: prove the oracle detects a planted divergence ----
function selftest() {
  const corpus = path.join(require('os').tmpdir(), `diff-selftest-${process.pid}.jsonl`);
  const recs = [];
  for (let i = 0; i < 100; i++) recs.push({ id: 'r' + i, amount: '10', ...(i % 10 === 0 ? { legacy_flag: true } : {}) });
  fs.writeFileSync(corpus, recs.map(r => JSON.stringify(r)).join('\n'));

  const A = { NAME: 'impl A (handles legacy_flag)', verdict: (r) => ({ ok: true }) };
  const B = { NAME: 'impl B (chokes on legacy_flag)', verdict: (r) => (r.legacy_flag ? { ok: false } : { ok: true }) };
  const C = { NAME: 'impl C (agrees with A)', verdict: (r) => ({ ok: true }) };

  const r = run({ corpus, impls: [A, B, C], shapeKeys: ['legacy_flag'], limit: 0 });
  fs.unlinkSync(corpus);

  const ok = r.stats.records === 100 && r.stats.split === 10 && r.byShape.get('legacy_flag').split === 10
    && r.byShape.get('base').split === 0;
  console.log('');
  console.log('  differential.js self-test');
  console.log(`    100 records, 10 carrying a field one implementation mishandles`);
  console.log(`    records=${r.stats.records} disagree=${r.stats.split} (expected 10)`);
  console.log(`    isolated to shape "legacy_flag": ${r.byShape.get('legacy_flag').split}/10`);
  console.log(`    false positives on shape "base" : ${r.byShape.get('base').split} (expected 0)`);
  console.log(`\n  ${ok ? 'PASS — the oracle finds a planted divergence and does not invent one.' : 'FAIL'}\n`);
  return ok ? 0 : 1;
}

if (require.main === module) {
  if (argv.includes('--selftest')) process.exit(selftest());
  const corpus = opt('--corpus');
  const implArgs = opts('--impl');
  if (!corpus || implArgs.length < 2) {
    console.error('usage: node differential.js --corpus <records.jsonl> --impl name=./a.js --impl name=./b.js [--shape-by f1,f2] [--limit N]');
    console.error('       node differential.js --selftest');
    process.exit(2);
  }
  const impls = implArgs.map(spec => {
    const eq = spec.indexOf('=');
    const name = eq > -1 ? spec.slice(0, eq) : null;
    const p = path.resolve(eq > -1 ? spec.slice(eq + 1) : spec);
    if (!fs.existsSync(p)) { console.error(`no such implementation: ${p}`); process.exit(2); }
    const m = require(p);
    if (typeof m.verdict !== 'function') { console.error(`${p} must export verdict(record)`); process.exit(2); }
    return { NAME: name || m.NAME || path.basename(p), verdict: m.verdict };
  });
  const shapeKeys = (opt('--shape-by', '') || '').split(',').map(s => s.trim()).filter(Boolean);
  const limit = parseInt(opt('--limit', '0'), 10) || 0;
  process.exit(report(run({ corpus, impls, shapeKeys, limit }), impls));
}

module.exports = { run, report, canon, shapeOf };
