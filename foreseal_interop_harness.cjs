#!/usr/bin/env node
// StillOS x ForeSeal interop test harness.
//
// SAFETY, by construction, not by convention:
//   - This tool NEVER holds or spends StillOS money on its own initiative.
//   - Every step that would move real money (--execute-settlement,
//     --exercise-dispute) PRINTS the exact action/recipient/network/token/
//     amount/max-exposure and then REFUSES to execute -- it has no wallet
//     wired to it and never will, specifically so it cannot become a
//     self-pay tool (see feedback-no-self-paid-settlements-2026-08-15).
//     ForeSeal's settlement and dispute must come from a ForeSeal-controlled
//     wallet using ForeSeal's own x402 client -- that is the entire point of
//     an externally-exercised test.
//   - Read-only / verification / inspection steps are the only things this
//     tool actually performs.
//
// Usage:
//   node foreseal_interop_harness.cjs --verify-preconditions
//   node foreseal_interop_harness.cjs --dry-run
//   node foreseal_interop_harness.cjs --resolve
//   node foreseal_interop_harness.cjs --verify-receipt <hash> [--verify-live]
//   node foreseal_interop_harness.cjs --execute-settlement   (prints instructions, refuses to spend)
//   node foreseal_interop_harness.cjs --exercise-dispute [--simulate]
//   node foreseal_interop_harness.cjs --reconcile
//   node foreseal_interop_harness.cjs --export-evidence <out-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const MANIFEST_PATH = path.join(__dirname, 'manifest', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const { verifyReceipt: offlineVerify } = require('./verify-offline-pinned.js');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000, headers: { 'User-Agent': 'stillos-foreseal-interop-harness' } }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, body: b }); } });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function rpcCall(rpc, method, params) {
  return new Promise((resolve, reject) => {
    const req = https.request(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 15000 }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    req.end();
  });
}

async function readOnchainUsdc(wallet, tokenContract, rpc) {
  const data = '0x70a08231000000000000000000000000' + wallet.slice(2).toLowerCase();
  const j = await rpcCall(rpc, 'eth_call', [{ to: tokenContract, data }, 'latest']);
  return parseInt(j.result, 16) / 1e6;
}

function printAction({ action, recipient, network, token, amount, maxExposure }) {
  console.log('\n=== ECONOMIC ACTION -- NOT EXECUTED, PRINT-ONLY ===');
  console.log(`action:        ${action}`);
  console.log(`recipient:     ${recipient}`);
  console.log(`network:       ${network}`);
  console.log(`token:         ${token}`);
  console.log(`exact amount:  ${amount}`);
  console.log(`max exposure:  ${maxExposure}`);
  console.log('This harness has no wallet wired to it and will never execute this. It must be performed by the counterparty (or, on the StillOS side, by a human running the already-existing governed commands named below) with explicit real payment credentials.');
}

async function verifyPreconditions() {
  console.log('# Precondition check -- read-only, zero money movement\n');
  const results = {};

  try {
    const rpc = manifest.bond.chain === 'Base mainnet' ? 'https://mainnet.base.org' : null;
    const bal = await readOnchainUsdc(manifest.wallets.stillos_bond_wallet.address, manifest.fees.token_contract, rpc);
    results.bond_onchain_balance_usd = bal;
    results.bond_active = bal >= manifest.bond.publicly_committed_target_usd;
    console.log(`[bond]      on-chain USDC balance: $${bal} (need >= $${manifest.bond.publicly_committed_target_usd}) -> active=${results.bond_active}`);
  } catch (e) { results.bond_check_error = e.message; console.log(`[bond]      FAILED to read chain: ${e.message}`); }

  try {
    const { status, body } = await getJSON(`${manifest.parties.stillos.public_base_url}/keyring`);
    results.keyring_reachable = status === 200 && Array.isArray(body.keys);
    results.keyring_key_count = body.keys ? body.keys.length : 0;
    console.log(`[keyring]   GET /keyring -> ${status}, ${results.keyring_key_count} key(s)`);
  } catch (e) { results.keyring_reachable = false; console.log(`[keyring]   FAILED: ${e.message}`); }

  try {
    const { status, body } = await getJSON(`${manifest.parties.stillos.public_base_url}/health`);
    results.health_ok = status === 200 && body.notary && body.notary.healthy === true;
    results.current_key_matches_manifest = body.notary && body.notary.publicKeyPem === manifest.signing_identity.current_public_key_pem;
    console.log(`[health]    GET /health -> ${status}, healthy=${body.notary && body.notary.healthy}, current_key_matches_manifest=${results.current_key_matches_manifest}`);
  } catch (e) { results.health_ok = false; console.log(`[health]    FAILED: ${e.message}`); }

  try {
    const r = manifest.resolver.spec;
    const { status, body } = await getJSON(`https://api.github.com/repos/${r.owner}/${r.repo}/pulls/${r.number}`);
    results.reference_still_merged = status === 200 && body.merged === true && body.merge_commit_sha === manifest.reference_source.merge_commit_sha;
    console.log(`[resolver]  live GitHub check -> merged=${body.merged}, merge_commit_sha matches manifest=${body.merge_commit_sha === manifest.reference_source.merge_commit_sha}`);
  } catch (e) { results.reference_still_merged = false; console.log(`[resolver]  FAILED: ${e.message}`); }

  results.all_ready = !!(results.bond_active && results.keyring_reachable && results.health_ok && results.current_key_matches_manifest && results.reference_still_merged);
  console.log(`\nALL_READY: ${results.all_ready}`);
  if (!results.all_ready) console.log('NOT ready for a real test yet -- see which check above is false.');
  return results;
}

async function resolveNow() {
  const r = manifest.resolver.spec;
  const { body } = await getJSON(`https://api.github.com/repos/${r.owner}/${r.repo}/pulls/${r.number}`);
  const out = { merged: body.merged, merge_commit_sha: body.merge_commit_sha, matches_manifest: body.merge_commit_sha === manifest.reference_source.merge_commit_sha };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function verifyReceiptCmd(hash, opts) {
  if (!hash) { console.error('usage: --verify-receipt <hash> [--verify-live]'); process.exit(2); }
  if (opts.verifyLive) {
    const { status, body } = await getJSON(`${manifest.parties.stillos.public_base_url}/verify?hash=${encodeURIComponent(hash)}&format=json`);
    console.log(`[server-side /verify, status ${status}]`, JSON.stringify(body, null, 2));
    if (!body.found) return;
    const offline = offlineVerify(body.receipt);
    console.log('[offline recompute against pinned manifest key]', JSON.stringify(offline, null, 2));
  } else {
    console.log('No --verify-live flag: pass the receipt JSON via a file and use verify-offline-pinned.js directly for a true zero-network check.');
  }
}

function dryRun() {
  console.log('# DRY RUN -- full lifecycle, simulated, zero HTTP writes, zero money\n');
  manifest.lifecycle_steps.forEach(s => console.log(`step ${s.step}: ${s.action}`));
  console.log('\nFees (see manifest.fees for exact figures):');
  console.log(`  settlement: $${manifest.fees.settlement_fee_usd.current} (until ${manifest.fees.settlement_fee_usd.current_valid_until}), then $${manifest.fees.settlement_fee_usd.after_current_valid_until}`);
  console.log(`  dispute:    $${manifest.fees.dispute_fee_usd.amount}`);
  console.log(`Combined hard stop: $${manifest.exposure_caps.hard_stop_combined_usd}`);
}

async function executeSettlement() {
  printAction({
    action: `POST ${manifest.parties.stillos.public_base_url}/claim-verdict with resolver=${JSON.stringify(manifest.resolver.spec)}`,
    recipient: manifest.wallets.stillos_payto_wallet.address,
    network: manifest.fees.chain,
    token: `USDC (${manifest.fees.token_contract})`,
    amount: `$${manifest.fees.settlement_fee_usd.current} (until ${manifest.fees.settlement_fee_usd.current_valid_until})`,
    maxExposure: `$${manifest.exposure_caps.foreseal_total_outlay_usd.typical} total for ForeSeal across this whole lifecycle`,
  });
  console.log('\nThis is ForeSeal\'s action, from a ForeSeal-controlled wallet, using their own x402 client. This harness cannot and will not perform it.');
}

async function exerciseDispute(opts) {
  if (opts.simulate) {
    console.log('# SIMULATED dispute -- exercises only the FREE, zero-write validation/rejection guards directly against the real production function, bypassing HTTP (so it costs nothing and writes nothing). Does NOT exercise the real paid path or reach an UPHELD/REJECTED terminal state -- that requires the real $1 x402 payment from the actual disputing party.\n');
    const dispute = require('/home/marcus/core/verdict_dispute.cjs');
    const r1 = await dispute.fileDispute({ verdict_receipt_hash: 'harness_nonexistent_' + crypto.randomBytes(4).toString('hex'), verdict_object: { foo: 1 }, original_resolver_spec: manifest.resolver.spec, agent: 'harness-simulate', reason: 'precondition smoke test' });
    console.log('unknown-receipt guard:', JSON.stringify(r1));
    return;
  }
  printAction({
    action: `POST ${manifest.parties.stillos.public_base_url}/dispute with the real receipt_hash + verdict_object + resolver spec`,
    recipient: manifest.wallets.stillos_payto_wallet.address,
    network: manifest.fees.chain,
    token: `USDC (${manifest.fees.token_contract})`,
    amount: `$${manifest.fees.dispute_fee_usd.amount}`,
    maxExposure: `StillOS side: up to $${manifest.exposure_caps.stillos_total_outlay_usd.max_bond_slash} bond slash, ONLY if upheld, ONLY via a separate Marcus-approved --execute (never automatic)`,
  });
  console.log('\nThis is the disputing party\'s action, from their own wallet. Pass --simulate to exercise only the free, zero-write guard paths for a smoke test.');
}

async function reconcile() {
  console.log('# Reconcile -- compare current live state against manifest-time snapshot\n');
  const rpc = 'https://mainnet.base.org';
  const bal = await readOnchainUsdc(manifest.wallets.stillos_bond_wallet.address, manifest.fees.token_contract, rpc);
  console.log(`bond balance now: $${bal} (manifest-time: $${manifest.bond.onchain_balance_usd_at_manifest_creation})`);
  console.log(bal === manifest.bond.onchain_balance_usd_at_manifest_creation ? 'UNCHANGED since manifest creation.' : 'CHANGED since manifest creation -- investigate before proceeding.');
}

async function exportEvidence(outDir) {
  if (!outDir) { console.error('usage: --export-evidence <out-dir>'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const bundle = {
    manifest_path: MANIFEST_PATH,
    manifest_sha256: fs.readFileSync(MANIFEST_PATH.replace(/\.json$/, '.sha256'), 'utf8').trim(),
    exported_at: new Date().toISOString(),
    preconditions: await verifyPreconditions(),
  };
  fs.writeFileSync(path.join(outDir, 'evidence.jsonl'), JSON.stringify(bundle) + '\n');
  const md = `# Evidence bundle\nExported: ${bundle.exported_at}\nManifest: ${bundle.manifest_path}\nManifest SHA-256: ${bundle.manifest_sha256}\n\n## Preconditions\n\`\`\`json\n${JSON.stringify(bundle.preconditions, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(path.join(outDir, 'evidence.md'), md);
  console.log(`Evidence written to ${outDir}/evidence.jsonl and evidence.md`);
}

async function main() {
  const argv = process.argv.slice(2);
  const has = f => argv.includes(f);
  const arg = f => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };

  if (has('--verify-preconditions')) return void await verifyPreconditions();
  if (has('--dry-run')) return void dryRun();
  if (has('--resolve')) return void await resolveNow();
  if (has('--verify-receipt')) return void await verifyReceiptCmd(arg('--verify-receipt'), { verifyLive: has('--verify-live') });
  if (has('--execute-settlement')) return void await executeSettlement();
  if (has('--exercise-dispute')) return void await exerciseDispute({ simulate: has('--simulate') });
  if (has('--reconcile')) return void await reconcile();
  if (has('--export-evidence')) return void await exportEvidence(arg('--export-evidence'));

  console.log(`Usage: node foreseal_interop_harness.cjs <flag>
  --verify-preconditions            read-only readiness check
  --dry-run                         print the full lifecycle + fees, no calls that spend money
  --resolve                         live-check the frozen reference against GitHub right now
  --verify-receipt <hash> [--verify-live]   fetch + verify a specific receipt
  --execute-settlement              print the exact action ForeSeal must take; never executes
  --exercise-dispute [--simulate]    print the exact action; --simulate runs only the free guard paths
  --reconcile                       compare live bond balance to manifest-time snapshot
  --export-evidence <dir>           write a JSONL+Markdown evidence bundle`);
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
