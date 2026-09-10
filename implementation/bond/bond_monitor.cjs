#!/usr/bin/env node
'use strict';
/**
 * StillOS Correctness Bond monitor. Closes the "bond silently goes inactive" leak:
 * the bond wallet is shared with the x402 facilitator + pay bridge, so its USDC or
 * gas can drain — at which point every receipt's bond_ref is a hollow promise and
 * nobody would know. This runs on cron, checks the live on-chain state, and fires a
 * founder alert the moment the bond stops being funded, payable, or coverage-intact.
 * Alerts are edge-triggered (only on a state change) so it doesn't spam.
 *
 * Cron: every 30 min. CLI prints current health.
 */
const fs = require('fs');
const bond = require('/home/marcus/core/notary_bond.cjs');
const STATE = '/home/marcus/still-os-consciousness/state/proof-notary/bond-monitor-state.json';

function lastState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { healthy: null }; } }

(async () => {
  const h = await bond.healthCheck();
  const prev = lastState();
  const changed = prev.healthy !== h.healthy;
  // Alert when we transition into an unhealthy state, or on the first observation of one.
  if (!h.healthy && changed) {
    try {
      require('/home/marcus/core/notify.cjs').notify({
        type: 'BOND_HEALTH_DEGRADED',
        subject: `🔴 Correctness bond DEGRADED — ${h.warnings[0] || 'see details'}`,
        lines: [
          `The StillOS correctness bond is no longer healthy. Receipts issued now may be under-backed.`,
          `USDC: $${h.usdc_balance} (needs >= $${h.bonded_usd})  ·  ETH gas: ${h.eth_balance} (floor ${bond.GAS_FLOOR_ETH})`,
          `Available bond: $${h.available_bond_usd}  ·  slash-chain ok: ${h.slash_chain_ok}`,
          ...h.warnings.map(w => '• ' + w),
          `Fund wallet ${h.wallet} or the bond stays inactive.`,
        ],
      });
    } catch (e) { console.error('[bond-monitor] alert failed:', e.message); }
  } else if (h.healthy && changed && prev.healthy === false) {
    try {
      require('/home/marcus/core/notify.cjs').notify({
        type: 'BOND_HEALTH_RESTORED',
        subject: `🟢 Correctness bond healthy again — $${h.usdc_balance} funded`,
        lines: [`Bond back to healthy: USDC $${h.usdc_balance}, ETH ${h.eth_balance}, available $${h.available_bond_usd}.`],
      });
    } catch (e) { console.error('[bond-monitor] alert failed:', e.message); }
  }
  try { fs.writeFileSync(STATE, JSON.stringify({ healthy: h.healthy, ts: h.ts, warnings: h.warnings })); } catch {}
  console.log(JSON.stringify(h, null, 2));
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
