#!/usr/bin/env node
'use strict';
/*
 * Seals the canonical manifest: fills the per-file checksums, records whether the
 * published implementation matches what the box is running, rewrites
 * manifest/manifest.sha256, and regenerates manifest/manifest.md FROM the JSON.
 *
 * The human-readable manifest is GENERATED, never hand-edited — that is half of
 * why the v1 package drifted. The other half (the bilateral terms document, which
 * is genuinely prose and cannot be generated) is covered by check-consistency.cjs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MJ = path.join(ROOT, 'manifest', 'manifest.json');
const m = JSON.parse(fs.readFileSync(MJ, 'utf8'));

const sums = m.parties.stillos.file_checksums_sha256;
const LIVE_DIR = '/home/marcus/core';
let compared = 0, identical = 0, missing = [];

for (const rel of Object.keys(sums)) {
  if (rel.startsWith('_')) continue;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`manifest names a file that is not in this repository: ${rel}`);
  const buf = fs.readFileSync(abs);
  sums[rel] = crypto.createHash('sha256').update(buf).digest('hex');

  // Deployment truth: compare each published bond file against the copy the live
  // notary loads from /home/marcus/core. Reported, never assumed.
  if (rel.startsWith('implementation/bond/')) {
    const live = path.join(LIVE_DIR, path.basename(rel));
    compared++;
    if (fs.existsSync(live)) {
      if (crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex') === sums[rel]) identical++;
      else missing.push(`${path.basename(rel)}: DIFFERS from ${live}`);
    } else missing.push(`${path.basename(rel)}: NOT PRESENT at ${live}`);
  }
}

m.parties.stillos.deployment_status.published_matches_running =
  missing.length === 0
    ? `YES — all ${compared} published bond files are byte-identical to ${LIVE_DIR} (verified ${new Date().toISOString()})`
    : `NO — ${identical}/${compared} match. Divergences: ${missing.join('; ')}`;

const json = JSON.stringify(m, null, 2) + '\n';
fs.writeFileSync(MJ, json);
const digest = crypto.createHash('sha256').update(fs.readFileSync(MJ)).digest('hex');
fs.writeFileSync(path.join(ROOT, 'manifest', 'manifest.sha256'), `${digest}  manifest.json\n`);

// ---- generate manifest.md from the JSON ----
const md = [];
md.push('# ForeSeal × StillOS Interop Manifest — human-readable rendering');
md.push('');
md.push('**GENERATED FILE — do not edit.** Produced from `manifest.json` by `tools/seal-manifest.cjs`.');
md.push('`manifest.json` is canonical; this file exists only to be readable.');
md.push('');
md.push(`- Version: \`${m.manifest_version}\` (supersedes \`${m.supersedes}\`)`);
md.push(`- Status: **${m.status}**`);
md.push(`- Release tag: \`${m.identification.release_tag}\` — resolve with \`${m.identification.how_to_resolve}\``);
md.push(`- Canonical manifest SHA-256: \`${digest}\``);
md.push('');
md.push('## Tag immutability');
md.push('');
md.push(`${m.identification.immutability.claim}`);
md.push('');
md.push(`Tag mechanically protected: **${m.identification.immutability.tag_is_mechanically_protected ? 'yes' : 'no'}**. ${m.identification.immutability.disclosure}`);
md.push('');
md.push('## Success criterion');
md.push('');
md.push(`**Bilateral:** ${m.success_criterion.bilateral}`);
md.push('');
md.push(`**No terminal state is pre-agreed:** ${m.success_criterion.no_terminal_state_is_pre_agreed}`);
md.push('');
md.push(`**StillOS local expectation (not a bilateral agreement):** ${m.success_criterion.stillos_local_expectation.expectation} ${m.success_criterion.stillos_local_expectation.status}`);
md.push('');
md.push('## Custody');
md.push('');
md.push(`| Field | Value |`);
md.push(`|---|---|`);
md.push(`| Safe | \`${m.custody.safe_address}\` (${m.custody.safe_version}, ${m.custody.chain}) |`);
md.push(`| Threshold | ${m.custody.threshold} of ${m.custody.owner_count} |`);
for (const o of m.custody.owners) md.push(`| Owner | \`${o.address}\` — ${o.attribution} |`);
md.push(`| Classification | **${m.custody.classification}** |`);
md.push('');
md.push(`**Security benefit:** ${m.custody.security_benefit}`);
md.push('');
md.push(`**Counterparty-governance benefit:** ${m.custody.counterparty_governance_benefit}`);
md.push('');
md.push(`${m.custody.honest_summary}`);
md.push('');
md.push('## Bond');
md.push('');
const b = m.bond, obs = b.onchain_balance_observation;
md.push(`| Field | Value |`);
md.push(`|---|---|`);
md.push(`| Wallet | \`${b.wallet}\` (${b.custody_type}) |`);
md.push(`| Gas relayer | \`${m.wallets.stillos_gas_relayer.address}\` |`);
md.push(`| Bonded | $${b.publicly_committed_target_usd} · per-verdict max $${b.per_verdict_max_usd} |`);
md.push(`| Observed balance | ${obs.balance_usdc} USDC at ${obs.observed_at} |`);
md.push(`| Active | ${b.active} |`);
md.push('');
md.push(`Health is reported as separate facts, not one boolean: ${b.health_semantics.reported_separately.map(s => '`' + s + '`').join(' · ')}.`);
md.push('');
md.push('## Payout obligation');
md.push('');
md.push(`States: ${m.payout_obligation.states.map(s => '`' + s + '`').join(' → ')} (OVERDUE derived).`);
md.push('');
md.push(`Opened: ${m.payout_obligation.opened_when}`);
md.push('');
md.push(`**Payout SLA: ${m.payout_obligation.payout_sla.status}.** ${m.payout_obligation.payout_sla.reason}`);
md.push('');
md.push(`${m.payout_obligation.payout_sla.what_is_committed_instead} Threshold: ${m.payout_obligation.payout_sla.overdue_threshold_hours}h, \`overdue_threshold_is_a_committed_sla: ${m.payout_obligation.payout_sla.overdue_threshold_is_a_committed_sla}\`.`);
md.push('');
md.push(`${m.payout_obligation.payout_sla.materiality}`);
md.push('');
md.push('## Fees');
md.push('');
md.push(`| Step | Amount |`);
md.push(`|---|---|`);
md.push(`| \`POST /claim-verdict\` | $${m.fees.settlement_fee_usd.current} until ${m.fees.settlement_fee_usd.current_valid_until}, then $${m.fees.settlement_fee_usd.after_current_valid_until} |`);
md.push(`| \`POST /dispute\` | $${m.fees.dispute_fee_usd.amount} (no free tier, non-refundable) |`);
md.push(`| ForeSeal max outlay | $${m.exposure_caps.foreseal_total_outlay_usd.typical} typical / $${m.exposure_caps.foreseal_total_outlay_usd['worst_case_if_run_after_2026-10-13']} |`);
md.push(`| StillOS max outlay | $${m.exposure_caps.stillos_total_outlay_usd.max_bond_slash} |`);
md.push(`| Combined hard stop | $${m.exposure_caps.hard_stop_combined_usd} |`);
md.push('');
md.push('## Signing identity');
md.push('');
md.push(`- Algorithm: ${m.signing_identity.algorithm}`);
md.push(`- Fingerprint: \`${m.signing_identity.current_key_id_fingerprint}\`, effective ${m.signing_identity.key_effective_from}`);
md.push(`- Keyring: ${m.signing_identity.keyring_endpoint}`);
md.push(`- Offline verifier: \`${m.signing_identity.offline_verifier_script}\``);
md.push('');
md.push('## Published implementation');
md.push('');
md.push(`Deployment status: ${m.parties.stillos.deployment_status.published_matches_running}`);
md.push('');
md.push('| File | SHA-256 |');
md.push('|---|---|');
for (const [k, v] of Object.entries(sums)) { if (!k.startsWith('_')) md.push(`| \`${k}\` | \`${v}\` |`); }
md.push('');

fs.writeFileSync(path.join(ROOT, 'manifest', 'manifest.md'), md.join('\n'));

console.log('sealed.');
console.log('  manifest.json sha256 :', digest);
console.log('  files checksummed    :', Object.keys(sums).filter(k => !k.startsWith('_')).length);
console.log('  deployment_status    :', m.parties.stillos.deployment_status.published_matches_running);
