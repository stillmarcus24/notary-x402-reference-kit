#!/usr/bin/env node
'use strict';
/*
 * Transition tests for implementation/bond/slash_obligations.cjs.
 *
 * Self-contained: the module under test has zero dependencies outside Node's
 * stdlib, and the ledger path is overridden to a temp file, so this runs anywhere
 * with `node tools/test-slash-obligations.cjs` — no StillOS box required. That is
 * deliberate: a counterparty auditing the payout-obligation behaviour should be
 * able to execute these, not just read them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEDGER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slashob-')), 'obligations.jsonl');
process.env.SLASH_OBLIGATIONS_LEDGER = LEDGER;
process.env.SLASH_OVERDUE_HOURS = '72';

const ob = require(path.join(__dirname, '..', 'implementation', 'bond', 'slash_obligations.cjs'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function throws(name, fn, match) {
  try { fn(); check(name, false, 'expected throw, none raised'); }
  catch (e) { check(name, !match || e.message.includes(match), `message was: ${e.message}`); }
}

const V = '0x' + 'a'.repeat(64).slice(2).padStart(64, 'a');
const D = '0x' + 'b'.repeat(64).slice(2).padStart(64, 'b');
const WALLET = '0x1111111111111111111111111111111111111111';
const TX = '0x' + 'c'.repeat(64);

console.log('\nslash_obligations — state machine');

// 1. Opening
const o1 = ob.openObligation({
  verdict_receipt_hash: V, dispute_receipt_hash: D, disputant: WALLET, amount_usd: 1.0,
  custody_type: 'gnosis-safe-2of2', bond_wallet: '0x6243E363a3047173346Fa49C947Db204D4445634',
  asset_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', network: 'base',
});
check('opens in SLASH_OWED', o1.state === 'SLASH_OWED', o1.state);
check('records custody_type', o1.custody_type === 'gnosis-safe-2of2');
check('records amount', o1.amount_usd === 1.0);
check('records owed_at', !!o1.owed_at);
check('encodes payout calldata', o1.payout_calldata === '0xa9059cbb' + '0'.repeat(24) + WALLET.slice(2) + (1000000).toString(16).padStart(64, '0'), o1.payout_calldata);

// 2. Idempotency — the same overturn cannot open a second debt
const o1b = ob.openObligation({ verdict_receipt_hash: V, dispute_receipt_hash: D, disputant: WALLET, amount_usd: 1.0, custody_type: 'gnosis-safe-2of2' });
check('reopening is idempotent', o1b.already_open === true && o1b.obligation_id === o1.obligation_id);
check('idempotent reopen adds no event', ob.verifyChain().count === 1, String(ob.verifyChain().count));

// 3. Durability — obligation survives a fresh read of the file (no in-memory state)
check('obligation is durable on disk', fs.readFileSync(LEDGER, 'utf8').includes(o1.obligation_id));

// 4. AWAITING_MULTISIG
const SAFETX = '0x' + 'd'.repeat(64);
const o2 = ob.markAwaitingMultisig(o1.obligation_id, SAFETX);
check('moves to AWAITING_MULTISIG', o2.state === 'AWAITING_MULTISIG', o2.state);
check('records safe_tx_hash', o2.safe_tx_hash === SAFETX);
throws('rejects malformed safe_tx_hash', () => ob.markAwaitingMultisig(o1.obligation_id, 'nope'), 'valid safe_tx_hash');
throws('rejects unknown obligation', () => ob.markAwaitingMultisig('deadbeef', SAFETX), 'unknown obligation');

// 5. Unpaid is visible in summary while awaiting the second signature
const s1 = ob.summary();
check('counts as unpaid while awaiting signature', s1.unpaid_slash_obligations === 1);
check('unpaid usd totalled', s1.unpaid_slash_obligations_usd === 1.0);
check('not overdue before threshold', s1.overdue_slash_obligations === 0);
check('all_slash_obligations_current true when merely pending', s1.all_slash_obligations_current === true);
check('summary states the threshold is not an SLA', s1.overdue_threshold_is_a_committed_sla === false);

// 6. OVERDUE is derived from elapsed time, needs no cron to fire
const future = Date.now() + 73 * 3600 * 1000;
const s2 = ob.summary(future);
check('derives OVERDUE past threshold', s2.overdue_slash_obligations === 1, JSON.stringify(s2.obligations.map(o => o.state)));
check('OVERDUE retains underlying pending state', s2.obligations[0].pending_state === 'AWAITING_MULTISIG');
check('all_slash_obligations_current false when overdue', s2.all_slash_obligations_current === false);

// 7. PAID discharges, and discharges permanently
const o3 = ob.markPaid(o1.obligation_id, TX);
check('moves to PAID', o3.state === 'PAID', o3.state);
check('records payout_tx', o3.payout_tx === TX);
const s3 = ob.summary(future);
check('PAID clears unpaid count', s3.unpaid_slash_obligations === 0);
check('PAID clears overdue even far in the future', s3.overdue_slash_obligations === 0);
throws('cannot re-await after PAID', () => ob.markAwaitingMultisig(o1.obligation_id, SAFETX), 'already PAID');
check('markPaid is idempotent', ob.markPaid(o1.obligation_id, TX).state === 'PAID');

// 8. Discharge by receipt hash (the path notary_bond_slash.cjs uses)
const V2 = '0x' + 'e'.repeat(64), D2 = '0x' + 'f'.repeat(64);
ob.openObligation({ verdict_receipt_hash: V2, dispute_receipt_hash: D2, disputant: WALLET, amount_usd: 1.0, custody_type: 'gnosis-safe-2of2' });
const o4 = ob.markPaidByReceipt(V2, TX);
check('markPaidByReceipt discharges', o4 && o4.state === 'PAID');
check('markPaidByReceipt returns null when nothing open', ob.markPaidByReceipt('0x' + '9'.repeat(64), TX) === null);

// 9. Validation
throws('rejects missing verdict hash', () => ob.openObligation({ dispute_receipt_hash: D2, amount_usd: 1 }), 'verdict_receipt_hash required');
throws('rejects missing dispute hash', () => ob.openObligation({ verdict_receipt_hash: V2, amount_usd: 1 }), 'dispute_receipt_hash required');
throws('rejects zero amount', () => ob.openObligation({ verdict_receipt_hash: '0x1', dispute_receipt_hash: '0x2', amount_usd: 0 }), 'amount_usd must be > 0');

// 10. Missing disputant wallet degrades honestly rather than inventing one
const o5 = ob.openObligation({ verdict_receipt_hash: '0x' + '7'.repeat(64), dispute_receipt_hash: '0x' + '8'.repeat(64), amount_usd: 1.0, custody_type: 'gnosis-safe-2of2' });
check('null disputant yields null calldata, not a fabricated address', o5.payout_calldata === null && o5.disputant === null);

// 11. Tamper-evidence
check('chain verifies before tampering', ob.verifyChain().ok);
const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n');
const tampered = JSON.parse(lines[0]); tampered.amount_usd = 999;
lines[0] = JSON.stringify(tampered);
fs.writeFileSync(LEDGER, lines.join('\n') + '\n');
const bad = ob.verifyChain();
check('detects a mutated amount', !bad.ok && bad.broken_at === 0, JSON.stringify(bad));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
