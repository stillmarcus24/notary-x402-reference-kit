#!/usr/bin/env node
// Verifies the REAL production receipt chain — not a synthetic example.
//
// FIXED 2026-09-06 (ForeSeal/0rkz interop-readiness pass): this script used to
// hardcode the notary's public key inline (a snapshot taken before the
// 2026-07-31 key rotation) and never re-fetch it. That made it silently
// WRONG the moment the key rotated — it kept claiming "verified against the
// real production key served live at /notary/health" while actually checking
// signatures against a RETIRED key, and would report false failures on any
// receipt signed after the rotation. Root cause: pinning a single key inline
// with no historical-key resolution is exactly the fragility 0rkz flagged.
//
// Fix: fetch the full historical KEYRING (GET /notary/keyring, added this same
// session) once, resolve each receipt's own `notary_fp` against it — the same
// resolution the live server itself uses (core/keyring.cjs) — instead of
// trusting one hardcoded or "whatever /health currently says" key. A receipt
// signed under ANY past or future key verifies correctly as long as its
// fingerprint is in the keyring. Unknown fingerprint -> fails closed.
//
// For a REAL offline test (zero network calls), see verify-offline-pinned.js
// in this same kit: fetch this data ONCE, save it, then verify with no
// network access at all using the exact same resolution logic.
'use strict';
const crypto = require('crypto');
const https = require('https');

const BASE = process.env.NOTARY_BASE || 'https://stillosdigitalholdings.com/notary';

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

// Same resolution rule as core/keyring.cjs: the live current key is trusted
// directly; any OTHER fingerprint must be found in the keyring or resolution
// fails closed (never silently trust an unknown signer).
function resolvePublicKey(fingerprint, currentFingerprint, currentPublicKeyPem, keys) {
  if (fingerprint === currentFingerprint) return currentPublicKeyPem;
  const entry = (keys || []).find(k => k.fingerprint === fingerprint);
  return entry ? entry.public_key_pem : null; // null = unknown fingerprint, fail closed
}

(async () => {
  const [health, keyring, preview] = await Promise.all([
    getJSON(`${BASE}/health`),
    getJSON(`${BASE}/keyring`),
    getJSON(`${BASE}/export?preview=true`),
  ]);
  const currentPublicKeyPem = health.notary.publicKeyPem;
  const currentFingerprint = crypto.createHash('sha256').update(currentPublicKeyPem).digest('hex').slice(0, 16);
  console.log(`Current active key fingerprint: ${currentFingerprint}`);
  console.log(`Keyring holds ${keyring.keys.length} key(s) (${keyring.keys.map(k => `${k.fingerprint}:${k.status}`).join(', ')})\n`);

  let prevExpected = null, allOk = true;
  preview.receipts.forEach((r, i) => {
    const core = { agent: r.agent, claim_sha256: r.claim_sha256, ts: r.ts, prev_hash: r.prev_hash, notary_fp: r.notary_fp };
    if (r.resolver_hash) core.resolver_hash = r.resolver_hash;
    const recomputed = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
    const hashOk = recomputed === r.receipt_hash;
    const resolvedKey = resolvePublicKey(r.notary_fp, currentFingerprint, currentPublicKeyPem, keyring.keys);
    const sigOk = resolvedKey ? crypto.verify(null, Buffer.from(r.receipt_hash), crypto.createPublicKey(resolvedKey), Buffer.from(r.signature, 'base64')) : false;
    const chainOk = i === 0 ? true : r.prev_hash === prevExpected;
    const ok = hashOk && sigOk && chainOk;
    allOk = allOk && ok;
    console.log(`[${i}] agent=${r.agent} ts=${r.ts} key_fp=${r.notary_fp}${resolvedKey ? '' : ' (UNKNOWN KEY -- fails closed)'} hash_ok=${hashOk} sig_ok=${sigOk} chain_ok=${chainOk}`);
    prevExpected = r.receipt_hash;
  });
  console.log(`\nAll ${preview.receipts.length} REAL production receipts verified: ${allOk}`);
  console.log('Verified using the full historical keyring (GET /notary/keyring), not just whatever /notary/health currently returns -- correct across past AND future key rotations.');
  process.exitCode = allOk ? 0 : 1;
})().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
