#!/usr/bin/env node
'use strict';
/**
 * StillOS Correctness Bond — slash OBLIGATION ledger.
 *
 * WHY THIS EXISTS (2026-09-11). Before this file, an upheld dispute produced:
 *   - a signed dispute receipt (durable), and
 *   - an in-memory `slash_directive` object returned in the HTTP response, plus a
 *     best-effort founder alert wrapped in a swallowed try/catch.
 * The directive itself was never persisted. Under single-key custody that was
 * survivable: the founder ran `--execute` and the slash log recorded the payout.
 * Under the 2-of-2 Safe custody adopted 2026-09-09 the payout requires a second
 * human signature, so there is now a real interval between "the bond is owed" and
 * "the bond is paid" — and during that interval NOTHING inspectable existed. If the
 * alert failed and the disputant discarded the response, the obligation left no
 * trace. That is the gap @0rkz named on x402-foundation/x402#2887 when he asked what
 * happens to a claim while it waits for the second signature.
 *
 * WHAT THIS IS. An append-only, hash-chained event log. An obligation is opened
 * SYNCHRONOUSLY at adjudication time, before any signature is sought and before any
 * notification is attempted. Current state is a fold over the events, never a
 * mutable field, so state cannot be silently rewritten and a partial write cannot
 * strand an obligation in a wrong state.
 *
 * WHAT THIS IS NOT. It moves no money, signs nothing, and proposes nothing. It
 * records that a debt exists and whether it has been discharged. Payment remains
 * governed by notary_bond_slash.cjs (single-key) or a manual 2-of-2 Safe signature
 * followed by `--record-external` (multisig).
 *
 * STATES (4, derived by fold):
 *   SLASH_OWED        adjudicated overturn recorded; no payout path started yet
 *   AWAITING_MULTISIG a Safe transaction has been prepared/proposed for the payout
 *   PAID              payout verified on-chain and recorded in the slash log
 *   OVERDUE           derived, not stored: not PAID and older than OVERDUE_HOURS
 *
 * OVERDUE is deliberately DERIVED rather than written by a cron. A stored overdue
 * flag is only as reliable as the job that sets it; a derived one cannot fail to
 * fire. See OVERDUE_HOURS below for what that threshold does and does not promise.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER = process.env.SLASH_OBLIGATIONS_LEDGER
  || '/home/marcus/still-os-consciousness/state/proof-notary/slash-obligations.jsonl';

/**
 * Observability threshold — NOT a committed payout SLA.
 *
 * StillOS does not commit to an end-to-end payout deadline, because the second of
 * the two required Safe signatures is held on a single human's phone with no backup
 * signer and no on-call rotation (see custody classification in the bilateral
 * terms). Committing to a deadline we cannot mechanically honour would be exactly
 * the kind of unbacked claim this bond exists to make expensive.
 *
 * What this constant does: after this many hours an unpaid obligation reports
 * state OVERDUE and drops the bond out of `healthy`. It is a visibility guarantee
 * ("you will be able to see that we are late"), not a payment guarantee.
 */
const OVERDUE_HOURS = Number(process.env.SLASH_OVERDUE_HOURS || 72);

const EVENTS = ['OPENED', 'AWAITING_MULTISIG', 'PAID'];

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function readEvents() {
  try {
    return fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function appendEvent(ev) {
  const prior = readEvents();
  const prev_hash = prior.length ? prior[prior.length - 1].event_hash : null;
  const body = { ...ev, seq: prior.length, prev_hash, ts: new Date().toISOString() };
  body.event_hash = sha256(JSON.stringify(body));
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, JSON.stringify(body) + '\n');
  return body;
}

/** Tamper-evidence: recompute every link. Mirrors bond.verifySlashChain(). */
function verifyChain() {
  const evs = readEvents();
  let prev = null;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const { event_hash, ...body } = e;
    if (e.seq !== i) return { ok: false, count: evs.length, broken_at: i, reason: `seq ${e.seq} != ${i}` };
    if (e.prev_hash !== prev) return { ok: false, count: evs.length, broken_at: i, reason: 'prev_hash mismatch' };
    if (sha256(JSON.stringify(body)) !== event_hash) return { ok: false, count: evs.length, broken_at: i, reason: 'event_hash mismatch' };
    prev = event_hash;
  }
  return { ok: true, count: evs.length };
}

/** Deterministic id — the same overturn can never open two obligations. */
function obligationId({ verdict_receipt_hash, dispute_receipt_hash }) {
  return sha256(`slash-obligation|${verdict_receipt_hash}|${dispute_receipt_hash}`).slice(0, 32);
}

/** Fold the event log into current obligation state. */
function foldObligations(nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const byId = new Map();
  for (const e of readEvents()) {
    if (e.event === 'OPENED') {
      byId.set(e.obligation_id, {
        obligation_id: e.obligation_id,
        verdict_receipt_hash: e.verdict_receipt_hash,
        dispute_receipt_hash: e.dispute_receipt_hash,
        disputant: e.disputant,
        amount_usd: e.amount_usd,
        owed_at: e.ts,
        custody_type: e.custody_type,
        bond_wallet: e.bond_wallet,
        asset_contract: e.asset_contract,
        network: e.network,
        payout_calldata: e.payout_calldata || null,
        reason: e.reason || null,
        safe_tx_hash: null,
        payout_tx: null,
        state: 'SLASH_OWED',
      });
    } else if (byId.has(e.obligation_id)) {
      const o = byId.get(e.obligation_id);
      if (e.event === 'AWAITING_MULTISIG') { o.safe_tx_hash = e.safe_tx_hash; o.state = 'AWAITING_MULTISIG'; }
      if (e.event === 'PAID') { o.payout_tx = e.payout_tx; o.paid_at = e.ts; o.state = 'PAID'; }
    }
  }
  // Derive OVERDUE last so it cannot be missed by a job that failed to run.
  for (const o of byId.values()) {
    if (o.state !== 'PAID') {
      const ageH = (now - new Date(o.owed_at).getTime()) / 3600000;
      o.age_hours = Number(ageH.toFixed(2));
      o.overdue_threshold_hours = OVERDUE_HOURS;
      if (ageH > OVERDUE_HOURS) { o.pending_state = o.state; o.state = 'OVERDUE'; }
    }
  }
  return [...byId.values()];
}

/**
 * Open an obligation. Called at adjudication time, before any signature is sought.
 * Idempotent on (verdict_receipt_hash, dispute_receipt_hash).
 *
 * `payout_calldata` is the exact ERC-20 transfer the Safe must execute. It is
 * recorded so a counterparty can verify what should be signed without trusting a
 * later description of it. Recording calldata is not proposing or signing it.
 */
function openObligation({ verdict_receipt_hash, dispute_receipt_hash, disputant, amount_usd, custody_type, bond_wallet, asset_contract, network, reason }) {
  if (!verdict_receipt_hash) throw new Error('openObligation: verdict_receipt_hash required');
  if (!dispute_receipt_hash) throw new Error('openObligation: dispute_receipt_hash required');
  if (!(Number(amount_usd) > 0)) throw new Error('openObligation: amount_usd must be > 0');

  const obligation_id = obligationId({ verdict_receipt_hash, dispute_receipt_hash });
  const existing = foldObligations().find(o => o.obligation_id === obligation_id);
  if (existing) return { ...existing, already_open: true };

  // ERC-20 transfer(address,uint256) — USDC has 6 decimals.
  let payout_calldata = null;
  if (disputant && /^0x[a-fA-F0-9]{40}$/.test(disputant)) {
    const units = BigInt(Math.round(Number(amount_usd) * 1e6)).toString(16).padStart(64, '0');
    payout_calldata = '0xa9059cbb' + '0'.repeat(24) + disputant.slice(2).toLowerCase() + units;
  }

  appendEvent({
    event: 'OPENED', obligation_id, verdict_receipt_hash, dispute_receipt_hash,
    disputant: disputant || null, amount_usd: Number(amount_usd),
    custody_type: custody_type || 'single-key-eoa',
    bond_wallet: bond_wallet || null, asset_contract: asset_contract || null, network: network || null,
    payout_calldata, reason: reason || null,
  });
  return foldObligations().find(o => o.obligation_id === obligation_id);
}

/** Record that a Safe transaction has been prepared/proposed for this payout. */
function markAwaitingMultisig(obligation_id, safe_tx_hash) {
  const o = foldObligations().find(x => x.obligation_id === obligation_id);
  if (!o) throw new Error(`markAwaitingMultisig: unknown obligation ${obligation_id}`);
  if (o.state === 'PAID') throw new Error(`markAwaitingMultisig: obligation ${obligation_id} already PAID`);
  if (!safe_tx_hash || !/^0x[a-fA-F0-9]{64}$/.test(safe_tx_hash)) throw new Error('markAwaitingMultisig: valid safe_tx_hash required');
  appendEvent({ event: 'AWAITING_MULTISIG', obligation_id, safe_tx_hash });
  return foldObligations().find(x => x.obligation_id === obligation_id);
}

/**
 * Discharge. Called by notary_bond_slash.cjs AFTER the payout has been verified
 * on-chain (both the single-key path and the multisig --record-external path
 * verify a real USDC Transfer before recording).
 */
function markPaid(obligation_id, payout_tx) {
  const o = foldObligations().find(x => x.obligation_id === obligation_id);
  if (!o) throw new Error(`markPaid: unknown obligation ${obligation_id}`);
  if (o.state === 'PAID') return o;
  if (!payout_tx || !/^0x[a-fA-F0-9]{64}$/.test(payout_tx)) throw new Error('markPaid: valid payout_tx required');
  appendEvent({ event: 'PAID', obligation_id, payout_tx });
  return foldObligations().find(x => x.obligation_id === obligation_id);
}

/** Discharge by verdict receipt, for callers that only hold the receipt hash. */
function markPaidByReceipt(verdict_receipt_hash, payout_tx) {
  const o = foldObligations().find(x => x.verdict_receipt_hash === verdict_receipt_hash && x.state !== 'PAID');
  if (!o) return null;
  return markPaid(o.obligation_id, payout_tx);
}

function summary(nowMs) {
  const all = foldObligations(nowMs);
  const unpaid = all.filter(o => o.state !== 'PAID');
  const overdue = all.filter(o => o.state === 'OVERDUE');
  const chain = verifyChain();
  return {
    ledger: LEDGER,
    obligation_ledger_intact: chain.ok,
    total_obligations: all.length,
    unpaid_slash_obligations: unpaid.length,
    unpaid_slash_obligations_usd: Number(unpaid.reduce((s, o) => s + o.amount_usd, 0).toFixed(6)),
    overdue_slash_obligations: overdue.length,
    overdue_threshold_hours: OVERDUE_HOURS,
    overdue_threshold_is_a_committed_sla: false,
    all_slash_obligations_current: chain.ok && overdue.length === 0,
    obligations: all,
  };
}

module.exports = {
  LEDGER, OVERDUE_HOURS, EVENTS,
  openObligation, markAwaitingMultisig, markPaid, markPaidByReceipt,
  foldObligations, verifyChain, obligationId, summary,
};

if (require.main === module) {
  console.log(JSON.stringify(summary(), null, 2));
}
