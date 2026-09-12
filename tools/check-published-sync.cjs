#!/usr/bin/env node
/**
 * check-published-sync.cjs — does the working tree match what is PUBLISHED on GitHub?
 *
 * Why this exists (2026-09-12). This directory has no `.git` of its own and no
 * remote. Publishing has been a manual copy, so the working tree and the public
 * repo could diverge silently — and had:
 *
 *   - verify-live.js      published copy hardcoded the RETIRED signing key
 *                         (fp 921e3af51250a1f5) and printed "Verified against the
 *                         real production key served live at /notary/health"
 *                         while never fetching /health. Fixed locally 2026-09-06;
 *                         the fix was never published.
 *   - READINESS_REPORT_V1 local copy still said F1 FAIL / bond $0 six weeks after
 *                         the bond was funded. Published copy was the correct one.
 *
 * Drift in both directions at once is the signature of having no source of truth.
 * @0rkz caught the parent of this class (four successive "frozen" pins that were
 * local-only commits, fetchable by nobody). This is the detector for it.
 *
 * No auth, no dependencies. Compares git blob SHA-1 of each local file against
 * the blob SHA in the published tree — the same identity git itself uses.
 *
 *   node tools/check-published-sync.cjs [ref]      # ref defaults to main
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'stillmarcus24/notary-x402-reference-kit';
const REF = process.argv[2] || 'main';

// Local-only working files that are deliberately NOT published.
const NOT_PUBLISHED = [
  /^GITHUB-REPLY-/,
  /^TSC-BRIEF-/,
  /-HOLD-FOR-APPROVAL\.md$/,
  /^docs\/BOND_FUNDING_PROPOSAL\.md$/,
  /^node_modules\//,
  /^\.git/,
];

const gitBlobSha1 = buf =>
  crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'stillos-sync-check' }, timeout: 20000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (NOT_PUBLISHED.some(re => re.test(rel))) continue;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

(async () => {
  const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${REF}?recursive=1`);
  const published = new Map(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
  const local = walk(ROOT);

  const drift = [], onlyLocal = [], onlyPublished = [];
  let same = 0;

  for (const rel of local) {
    const sha = gitBlobSha1(fs.readFileSync(path.join(ROOT, rel)));
    if (!published.has(rel)) { onlyLocal.push(rel); continue; }
    if (published.get(rel) !== sha) drift.push(rel); else same++;
  }
  for (const rel of published.keys()) {
    if (!local.includes(rel) && !NOT_PUBLISHED.some(re => re.test(rel))) onlyPublished.push(rel);
  }

  console.log(`Comparing working tree <-> ${REPO}@${REF}\n`);
  console.log(`  in sync         ${same}`);
  drift.forEach(f => console.log(`  DRIFT           ${f}`));
  onlyLocal.forEach(f => console.log(`  LOCAL ONLY      ${f}  (never published)`));
  onlyPublished.forEach(f => console.log(`  PUBLISHED ONLY  ${f}  (missing locally)`));

  const bad = drift.length + onlyLocal.length + onlyPublished.length;
  console.log(`\n  ${bad === 0 ? 'CLEAN — working tree matches published' : `${bad} file(s) out of sync`}`);
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
