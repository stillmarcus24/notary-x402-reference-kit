#!/usr/bin/env node
/**
 * gen-digests.cjs — regenerate DIGESTS.json for the published kit.
 *
 * Why this exists (2026-09-12): manifest/manifest.json asserted
 * "published_matches_running: YES — all 6 published bond files are byte-identical
 * to /home/marcus/core". That claim is TRUE, and it was also unverifiable by
 * anybody except us: it named a path on a private host and a timestamp. An
 * outside auditor could only trust it.
 *
 * A digest is the difference between a recorded claim and a recomputable one.
 * With DIGESTS.json, a third party clones the kit, runs `verify-digests.cjs`,
 * and confirms the published bytes are exactly the bytes whose digests we
 * committed to — no call back to us, no account, no trust in this sentence.
 *
 * What it still does NOT prove, stated plainly: that the published bytes are the
 * bytes the live service executes. That is an operator attestation
 * (`published_matches_running`) and remains one. The digest closes the gap
 * between "our file" and "the file you cloned", not between "our file" and
 * "our server". Closing the second gap needs the live service to serve these
 * same digests; see the `live_attestation` block below for where that lands.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Everything a verifier could want pinned. Ordered, so the set digest is stable.
const TARGETS = [
  'implementation/bond/notary_bond.cjs',
  'implementation/bond/notary_bond_slash.cjs',
  'implementation/bond/notary_bond_mirror_refresh.cjs',
  'implementation/bond/bond_monitor.cjs',
  'implementation/bond/slash_obligations.cjs',
  'implementation/bond/verdict_dispute.cjs',
  'verify-offline-pinned.js',
  'verify-live.js',
  'vectors/positive-01.json',
  'vectors/negative-01-content-mutation.json',
  'vectors/negative-02-digest-mutation.json',
  'vectors/negative-03-signature-mutation.json',
  'vectors/negative-04-wrong-signing-key.json',
  'vectors/negative-05-chain-link-mismatch.json',
  'vectors/negative-06-unknown-key-version.json',
  'conformance/run-all.js',
  'conformance/run-record.js',
  'conformance/stillos_adapter.js',
  'conformance/record-vectors.json',
  'tools/check-consistency.cjs',
  'tools/test-slash-obligations.cjs',
  'tools/verify-digests.cjs',
  'tools/check-published-sync.cjs',
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const files = {};
const missing = [];
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { missing.push(rel); continue; }
  const buf = fs.readFileSync(abs);
  files[rel] = { sha256: sha256(buf), bytes: buf.length };
}

if (missing.length) {
  console.error('MISSING (not written to DIGESTS.json):');
  missing.forEach(m => console.error('  ' + m));
}

// Set digest: sha256 over "<path>  <sha256>\n" lines in TARGETS order.
// Deliberately the same shape `sha256sum` emits, so it is reproducible by hand.
const lines = Object.keys(files).map(k => `${k}  ${files[k].sha256}`).join('\n') + '\n';
const setDigest = sha256(Buffer.from(lines, 'utf8'));

// Bond-subset digest, computed over BASENAMES sorted, to be directly comparable
// with what the live notary serves at GET /notary/bond -> implementation_digests
// .bond_set_digest. Equal values there and here means the published bond
// implementation is the one the live service is actually running — the
// published-equals-running gap, closed by recomputation instead of by our word.
const bondFiles = Object.keys(files)
  .filter(k => k.startsWith('implementation/bond/') && k.endsWith('.cjs'))
  .map(k => [path.basename(k), files[k].sha256])
  .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const bondLines = bondFiles.map(([b, h]) => `${b}  ${h}`).join('\n') + '\n';
const bondSetDigest = sha256(Buffer.from(bondLines, 'utf8'));

const out = {
  digests_version: 'STILLOS_NOTARY_KIT_DIGESTS_V1',
  algorithm: 'sha256',
  set_digest: setDigest,
  bond_set_digest: bondSetDigest,
  bond_set_digest_preimage: 'sha256 over "<basename>  <sha256>\\n" lines for implementation/bond/*.cjs, sorted by basename, UTF-8 — compare to GET /notary/bond implementation_digests.bond_set_digest',
  set_digest_preimage: 'sha256 over the concatenation of "<path>  <sha256>\\n" lines, in the order listed under files, UTF-8',
  file_count: Object.keys(files).length,
  files,
  how_to_verify: [
    'git clone --branch <tag> --depth 1 https://github.com/stillmarcus24/notary-x402-reference-kit',
    'node tools/verify-digests.cjs      # recomputes every entry and the set digest',
    'or by hand: sha256sum implementation/bond/*.cjs  and compare',
  ],
  what_this_proves:
    'The files you cloned are byte-for-byte the files whose digests were committed under this tag. Tampering in transit, a rewritten tag, or an edited file all fail this check.',
  what_this_does_not_prove:
    'That these bytes are the bytes the live notary process executes. That remains an operator attestation (manifest.parties.stillos.deployment_status.published_matches_running) and is NOT independently verifiable from this file alone. It becomes verifiable only when the live service serves these same digests from its own process; see live_attestation.',
  live_attestation: {
    status: 'SERVED',
    endpoint: 'https://stillosdigitalholdings.com/notary/bond',
    field: 'implementation_digests.bond_set_digest',
    compare_to: 'bond_set_digest in this file',
    signed: 'Yes — implementation_digests is inside the bond status object covered by attestation_hash and its Ed25519 signature, verifiable against the same notary public key that signs receipts.',
    note: 'Served live 2026-09-12. Equal digests mean the published bond implementation is the one the live service runs, established by recomputation rather than by operator attestation. Does NOT prove the loaded process image matches the on-disk bytes.',
  },
};

fs.writeFileSync(path.join(ROOT, 'DIGESTS.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`DIGESTS.json written: ${out.file_count} files, set_digest ${setDigest}`);
if (missing.length) process.exitCode = 1;
