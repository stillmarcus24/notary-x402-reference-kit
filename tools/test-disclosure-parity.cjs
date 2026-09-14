#!/usr/bin/env node
'use strict';
/*
 * test-disclosure-parity.cjs — reinstate each historical disclosure defect verbatim and
 * assert that check-consistency.cjs goes red for it.
 *
 * Why this exists (2026-09-14). "The assertion is negative-tested" is exactly the kind of
 * claim this package exists to stop people from having to take on faith. An assertion that
 * has never been shown to fail is not an assertion; and an assertion whose failure you can
 * only observe by watching someone else run it is a promise, not evidence.
 *
 * Every case below is a REAL defect that was live in this repository, quoted verbatim from
 * the state it was in. Sources: @0rkz's 2026-09-13 review comment on x402-foundation/x402#2887
 * (case 1), and the sibling audit it prompted (cases 2 and 3). Case 3 is the one that
 * matters most: it was machine-readable and served to counterparties.
 *
 * Runs on a temp copy. Never mutates the working tree. No network, no box, no callback.
 *
 *   node tools/test-disclosure-parity.cjs     # exit 0 = every defect is still caught
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const CASES = [
  {
    id: 'orkz-readme-retired-wallet',
    provenance: '@0rkz, x402#2887 comment 5656791904, 2026-09-13 — "one stale bullet sitting above a current one, and it is the bullet a reader hits first"',
    file: 'README.md',
    find: '  bond: a real USDC bond on Base mainnet held in a 2-of-2 Gnosis Safe\n  (`0x6243E363a3047173346Fa49C947Db204D4445634`). If a disputed verdict is',
    replace: '  bond: a real, self-custodied USDC bond on Base mainnet\n  (`0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf`) that pays out on-chain if a\n  disputed verdict is overturned. If a disputed verdict is',
    expect: /bond paragraphs name only the current bond wallet/,
  },
  {
    id: 'readme-dispute-endpoint-unqualified',
    provenance: 'sibling audit, 2026-09-14 — third instance, in the same README a human had just read end to end',
    file: 'README.md',
    find: "  independent resolver re-run; an overturned verdict opens a durable payout\n  obligation against the bond at that moment, settled on-chain once the 2-of-2\n  Safe's second signature executes it — no committed payout SLA.",
    replace: '  independent resolver re-run; overturned verdicts pay out from the bond\n  on-chain.',
    expect: /every payout claim is qualified in its own paragraph/,
  },
  {
    id: 'machine-readable-slash-policy-unqualified',
    provenance: 'sibling audit, 2026-09-14 — MACHINE-READABLE and served to counterparties; the v1.1 root pattern (prose corrected, machine record not) recurring a third time',
    file: 'live-bond-status.json',
    jsonField: 'slash_policy',
    replace: "A signed StillOS verdict/receipt is SLASHABLE if its externally-anchored claim is proven false. If the re-run overturns the original verdict, the disputant is paid up to per_verdict_max_usd from the bond wallet, on-chain, and the payout is appended to the public slash log.",
    expect: /every payout claim is qualified in its own paragraph/,
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => !/[\\/](\.git|node_modules)$/.test(src),
});

let pass = 0, fail = 0;
console.log(`\ndisclosure-parity negative tests — ${CASES.length} real historical defects\n`);

for (const c of CASES) {
  const target = path.join(tmp, c.file);
  const original = fs.readFileSync(target, 'utf8');
  let mutated, applied = true;

  if (c.jsonField) {
    const j = JSON.parse(original);
    if (!(c.jsonField in j)) applied = false;
    j[c.jsonField] = c.replace;
    mutated = JSON.stringify(j, null, 2) + '\n';
  } else {
    if (!original.includes(c.find)) applied = false;
    mutated = original.replace(c.find, c.replace);
  }

  if (!applied) {
    fail++;
    console.log(`  ERROR ${c.id}`);
    console.log(`        anchor text not found in ${c.file} — this test has drifted from the file it guards`);
    fs.writeFileSync(target, original);
    continue;
  }

  fs.writeFileSync(target, mutated);
  let out = '', code = 0;
  try {
    execFileSync('node', [path.join(tmp, 'tools/check-consistency.cjs')], { cwd: tmp, stdio: 'pipe' });
  } catch (e) {
    code = e.status;
    out = ((e.stdout || '') + (e.stderr || '')).toString();
  }
  fs.writeFileSync(target, original);

  const caught = code !== 0 && c.expect.test(out);
  if (caught) { pass++; console.log(`  CAUGHT ${c.id}`); }
  else {
    fail++;
    console.log(`  MISSED ${c.id}  (exit ${code}) — the defect was reinstated and the checker stayed green`);
  }
  console.log(`         ${c.provenance}`);
}

// The suite must also be green when nothing is mutated, or "CAUGHT" means nothing.
let baselineOk = true;
try { execFileSync('node', [path.join(tmp, 'tools/check-consistency.cjs')], { cwd: tmp, stdio: 'pipe' }); }
catch (_) { baselineOk = false; }
console.log(`\n  baseline (unmutated copy) ${baselineOk ? 'passes' : 'FAILS — every result above is meaningless'}`);
if (!baselineOk) fail++;

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${pass} caught, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
