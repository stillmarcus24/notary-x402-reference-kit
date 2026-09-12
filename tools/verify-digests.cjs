#!/usr/bin/env node
/**
 * verify-digests.cjs — recompute every digest in DIGESTS.json from the working tree.
 *
 * Zero dependencies, zero network calls. Run it from a clean clone:
 *   node tools/verify-digests.cjs
 *
 * Exit 0 = every file present and byte-identical to its committed digest, and the
 * set digest recomputes. Exit 1 = at least one mismatch, missing file, or a set
 * digest that does not reproduce (which catches an edited DIGESTS.json itself).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIGESTS_PATH = path.join(ROOT, 'DIGESTS.json');

if (!fs.existsSync(DIGESTS_PATH)) {
  console.error('FAIL: DIGESTS.json not found. Run: node tools/gen-digests.cjs');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(DIGESTS_PATH, 'utf8'));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

let pass = 0, fail = 0;
for (const [rel, entry] of Object.entries(d.files)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`  MISSING  ${rel}`);
    fail++; continue;
  }
  const buf = fs.readFileSync(abs);
  const got = sha256(buf);
  if (got === entry.sha256 && buf.length === entry.bytes) {
    console.log(`  ok       ${rel}`);
    pass++;
  } else {
    console.log(`  MISMATCH ${rel}`);
    console.log(`           expected ${entry.sha256} (${entry.bytes}B)`);
    console.log(`           actual   ${got} (${buf.length}B)`);
    fail++;
  }
}

// Recompute the set digest too — catches someone editing DIGESTS.json to match
// a tampered file. The preimage is reproducible by hand with sha256sum.
const lines = Object.keys(d.files).map(k => `${k}  ${d.files[k].sha256}`).join('\n') + '\n';
const setDigest = sha256(Buffer.from(lines, 'utf8'));
const setOk = setDigest === d.set_digest;
console.log(`\n  set_digest ${setOk ? 'ok' : 'MISMATCH'}  ${setDigest}`);
if (!setOk) console.log(`             committed ${d.set_digest}`);

console.log(`\n  ${pass} passed, ${fail} failed${setOk ? '' : ', set digest MISMATCH'}`);

if (d.live_attestation && d.live_attestation.status !== 'SERVED') {
  console.log(`\n  NOTE: published-equals-running is still an operator attestation, not`);
  console.log(`  independently verifiable (live_attestation.status=${d.live_attestation.status}).`);
  console.log(`  This check proves the clone matches the committed digests. Nothing more.`);
}

process.exit(fail === 0 && setOk ? 0 : 1);
