#!/usr/bin/env node
'use strict';
/*
 * test-observation-binding.cjs — every verdict must commit to WHAT was seen, not
 * only WHERE to look, and a source that moved between claim and dispute must not slash.
 *
 * Raised by @renezander030, erc-8004/erc-8004-contracts#90, 2026-08-08:
 *
 *   "a raw HTTP probe re-run at dispute time is a different observation than the one
 *    the claim was scored on, and a slash decided on the later read punishes the wrong
 *    party whenever the source moved in between... The receipt should commit to what
 *    was seen, not only where to look. A source that cannot be re-read deterministically
 *    cannot back a slash."
 *
 * He was right. This is the regression test for the fix.
 *
 * NOTE ON SCOPE: the resolver module (general_resolvers.cjs) is NOT part of this
 * published kit — it carries broker/exchange resolvers unrelated to the bond. So this
 * test SKIPS when that module is absent, and says so loudly. It does not print a pass.
 * A harness that reports green for code it never loaded is the exact failure this
 * package exists to catch (see conformance/README.md).
 *
 *   node tools/test-observation-binding.cjs
 *   RESOLVERS_PATH=/path/to/general_resolvers.cjs node tools/test-observation-binding.cjs
 */
const fs = require('fs');

const RESOLVERS_PATH = process.env.RESOLVERS_PATH
  || '/home/marcus/still-os-consciousness/core/general_resolvers.cjs';

if (!fs.existsSync(RESOLVERS_PATH)) {
  console.log('\n  SKIPPED — resolver module not present at:');
  console.log(`    ${RESOLVERS_PATH}`);
  console.log('  general_resolvers.cjs is not published in this kit. Point RESOLVERS_PATH at it to run.');
  console.log('  This is a SKIP, not a pass. 0 assertions were evaluated.\n');
  process.exit(0);
}

const r = require(RESOLVERS_PATH);
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? ' — ' + d : ''))); };

(async () => {
  console.log('\nobservation binding — a dispute must argue over a fixed artifact\n');

  const v = await r.resolveClaim({ type: 'github_pr', owner: 'python', repo: 'cpython', number: 154769 });
  ok('every verdict carries an observation binding', !!v.observation);
  ok('binding declares RFC8785-JCS', v.observation && v.observation.canonicalization === 'RFC8785-JCS');
  ok('binding is a sha256', v.observation && /^[0-9a-f]{64}$/.test(v.observation.observed_sha256));
  ok('binding carries observed_at', v.observation && !!Date.parse(v.observation.observed_at));
  ok('github_pr classed DETERMINISTIC', v.observation && v.observation.source_class === 'DETERMINISTIC');
  // The honest half: fixing WHICH observation is argued over does not make that
  // observation independently attested. Claiming otherwise would be the overclaim.
  ok('binding does not claim independent attestation', v.observation && v.observation.independently_attested === false);

  const a = await r.resolveClaim({ type: 'http_status', url: 'https://api.github.com', expect_code: 200 });
  const b = await r.resolveClaim({ type: 'http_status', url: 'https://api.github.com', expect_code: 404 });
  ok('http_status classed TIME_VARYING', a.observation && a.observation.source_class === 'TIME_VARYING');
  ok('a changed observation changes the digest', a.observation.observed_sha256 !== b.observation.observed_sha256);
  ok('the flip this guards is real (CONFIRMED -> REFUTED)', a.outcome === true && b.outcome === false);

  const again = await r.resolveClaim({ type: 'http_status', url: 'https://api.github.com', expect_code: 200 });
  ok('identical observation yields identical digest', a.observation.observed_sha256 === again.observation.observed_sha256);

  // JCS, not a sorted-keys stringify. Proven the same day against the RFC author's own
  // vectors (cyberphone/json-canonicalization @19d51d7f): json.dumps(sort_keys=True)
  // and JSON.stringify-with-sorted-keys both render 1.0 as "1.0" where RFC 8785
  // requires "1". A digest over a non-canonical encoding is one nobody can reproduce.
  const src = fs.readFileSync(RESOLVERS_PATH, 'utf8');
  ok('canonicalizer renders numbers via ECMA-262 Number::toString', /typeof v === 'number'[\s\S]{0,200}String\(v\)/.test(src));
  ok('canonicalizer sorts keys by UTF-16 code unit (plain .sort())', /Object\.keys\(v\)[\s\S]{0,80}\.sort\(\)/.test(src));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  harness error:', e.message); process.exit(2); });
