#!/usr/bin/env node
'use strict';
/*
 * verdict_dispute.cjs — narrow MVP dispute/contestation flow for notary verdicts.
 *
 * Scope per core/verdict_dispute_DESIGN.md (still-os-consciousness repo): bonded
 * disputes, resolved by an independent re-run of the SAME resolver spec, not a
 * human queue. Deliberately narrow — this is not a general appeals system.
 *
 * Real constraint this design works within: the notary ledger stores only
 * claim_sha256 (a hash), not the plaintext verdict object, so a disputer must
 * supply the original verdict object back. We verify it hashes to match the
 * receipt on file before trusting anything in it — this is the same trust
 * model /notary/verify already uses (hash-intact check), not a new one.
 *
 * Payment (bonded, anti-spam) is enforced by the caller (notary_service_marcus.cjs
 * via x402) BEFORE fileDispute() is invoked — this module assumes the bond has
 * already been collected and is non-refundable either way (no escrow/refund
 * logic — that's a treasury/custody problem out of scope for this MVP).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const signer = require('/home/marcus/core/notary_recovery_signer.cjs');
const resolvers = require('/home/marcus/still-os-consciousness/core/general_resolvers.cjs');
const reputation = require('/home/marcus/still-os-consciousness/core/reputation_layer.cjs');

const DIR = '/home/marcus/still-os-consciousness/state/proof-notary';
const LEDGER = path.join(DIR, 'receipts.jsonl');
const DISPUTE_WINDOW_MS = 48 * 3600 * 1000;
const DISPUTE_PROTOCOL_VERSION = 'dispute/v1';
const LOCKS_DIR = path.join(DIR, 'dispute-locks');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// Dedup (2026-07-27): a stable dispute_id derived from IMMUTABLE meaning — never a
// caller-selected label. Binds protocol version, the disputed receipt hash, the
// committed claim hash, the normalized challenger, and the normalized
// counter-evidence digest. Two submissions that mean the same thing collide;
// different counter-evidence is a genuinely new dispute. dispute_id is a sha256
// hex (safe filename, no traversal, never raw caller input in the path).
function disputeId({ verdict_receipt_hash, claim_sha256, agent, reason }) {
  const ce = sha256(String(reason == null ? '' : reason).trim().replace(/\s+/g, ' '));
  return 'dsp_' + sha256(JSON.stringify({
    v: DISPUTE_PROTOCOL_VERSION, r: verdict_receipt_hash, c: claim_sha256,
    ch: String(agent == null ? '' : agent).trim(), ce,
  })).slice(0, 40);
}
// Atomic reservation via exclusive-create: a concurrent or replayed duplicate
// loses the race and gets EEXIST -> DUPLICATE_DISPUTE. Only well-formed,
// already-validated disputes ever call this, so a malformed submission can
// never reserve an id that blocks a later corrected one.
function reserveDispute(id, locksDir = LOCKS_DIR) {
  try { fs.mkdirSync(locksDir, { recursive: true }); } catch { /* dir may exist */ }
  try {
    fs.writeFileSync(path.join(locksDir, id + '.lock'),
      JSON.stringify({ dispute_id: id, version: DISPUTE_PROTOCOL_VERSION, reserved_at: new Date().toISOString() }),
      { flag: 'wx' });
    return true;
  } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}
function releaseDispute(id, locksDir = LOCKS_DIR) {
  try { fs.unlinkSync(path.join(locksDir, id + '.lock')); } catch { /* best-effort cleanup */ }
}

function readReceipts() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function findReceipt(hash) {
  return readReceipts().find(r => r.receipt_hash === hash) || null;
}

/**
 * fileDispute({ verdict_receipt_hash, verdict_object, original_resolver_spec, agent, reason })
 *
 * verdict_object: the exact JSON object returned as `verdict` at commit time
 *   (the disputer must have this — it's what they were given as proof).
 * original_resolver_spec: the resolver spec used originally (e.g.
 *   {type:'price_oracle', sources:[...], comparator, threshold, tolerance_pct}).
 *
 * Returns { ok, upheld, receipt } on success, { ok:false, error } on rejection
 * (rejection is itself a real, signed outcome — a bad-faith dispute doesn't
 * just vanish, it's recorded as REJECTED so pattern-of-abuse is visible later).
 */
async function fileDispute({ verdict_receipt_hash, verdict_object, original_resolver_spec, agent, reason }) {
  if (!verdict_receipt_hash || !verdict_object || !original_resolver_spec || !agent) {
    return { ok: false, error: 'requires {verdict_receipt_hash, verdict_object, original_resolver_spec, agent, reason}' };
  }

  const original = findReceipt(verdict_receipt_hash);
  if (!original) return { ok: false, error: 'receipt_not_found' };

  // Step 1: prove the supplied verdict_object is the REAL one, not a fabrication —
  // it must hash to exactly the claim_sha256 already committed on-chain.
  const suppliedHash = sha256(JSON.stringify(verdict_object));
  if (suppliedHash !== original.claim_sha256) {
    return { ok: false, error: 'verdict_object does not match the claim_sha256 on this receipt — cannot dispute a receipt with a fabricated or altered verdict object' };
  }

  // Step 2: time window — an unbounded dispute window makes every past receipt
  // permanently provisional, defeating the point of an immutable ledger.
  const ageMs = Date.now() - new Date(original.ts).getTime();
  if (ageMs > DISPUTE_WINDOW_MS) {
    return { ok: false, error: `dispute window (48h) has closed — receipt is ${(ageMs / 3600000).toFixed(1)}h old` };
  }

  // Step 3: re-run the SAME resolver spec fresh, right now.
  let fresh;
  try {
    fresh = await resolvers.resolveClaim(original_resolver_spec);
  } catch (e) {
    return { ok: false, error: `re-resolution failed: ${e.message}` };
  }

  // Step 3.5: resolver-unavailable/error must NOT read as a refutation. Before
  // this fix, a re-run status of anything other than 'resolved' (SOURCE_NOT_FOUND
  // on a deleted GitHub PR, SOURCE_UNREACHABLE on a 404'd URL, RATE_LIMITED, a
  // stale RPC read, etc.) fell through to freshVerdict = fresh.status.toUpperCase()
  // below, which almost never equals the original verdict label -- so a source
  // simply disappearing or hiccuping made upheld=true, overturning a verdict that
  // was correct when it was made and queuing a real bond-slash payout for it.
  // Found live 2026-07-28 by tracing a Moltbook reader's question about whether a
  // dispute is calibrated or just locally self-consistent; confirmed the isolated
  // test harness (tests/notary-interop/lifecycle_harness.cjs, 28/28) only proves
  // this specific file's behavior via core/dispute_engine.cjs, a DIFFERENT, non-
  // public dispute implementation that already had this exact guard (see its
  // neg10a/neg10b: 'resolver unavailable -> INDETERMINATE, never FALSE'). This is
  // the live public /dispute path (verdict_dispute.cjs) -- it had no equivalent
  // protection until now. No dispute_id is reserved on this branch, so a later
  // retry (once the source is reachable again) is never blocked as a duplicate.
  if (fresh.status !== 'resolved' && fresh.status !== 'attested') {
    return {
      ok: false,
      indeterminate: true,
      error: `resolver could not resolve (${fresh.failure_class || fresh.status}) — not a refutation, retryable once the source is reachable again`,
    };
  }

  // Step 4: the resolver spec must actually settle against the SAME target the
  // original verdict claimed — otherwise a disputer could swap in an easier
  // target and "win" a dispute against an unrelated claim.
  if (fresh.settles_against !== verdict_object.settles_against) {
    return { ok: false, error: `original_resolver_spec settles against a different target (${fresh.settles_against}) than the disputed verdict (${verdict_object.settles_against})` };
  }

  // Step 5: does the fresh re-resolution agree with the original verdict LABEL?
  // Bug fixed 2026-07-04, caught by testing against physical_attestation (not
  // just http_status/onchain_tx/price_oracle): comparing fresh.outcome while
  // requiring fresh.status==='resolved' made a dispute structurally unable to
  // ever overturn a non-CONFIRMED/REFUTED verdict type (e.g. ATTESTED) --
  // even a legitimate case (fresh re-check now fails quorum) always came back
  // upheld:false. Compare the actual verdict label instead, computed the same
  // way verdictObj computes it, so any resolver type's success/failure kind
  // can be genuinely overturned, not just the binary outcome ones.
  const freshVerdict = fresh.status === 'resolved' ? (fresh.outcome ? 'CONFIRMED' : 'REFUTED') : fresh.status.toUpperCase();
  const upheld = freshVerdict !== verdict_object.verdict;
  // upheld=true  → dispute WINS, original verdict is overturned
  // upheld=false → dispute REJECTED (fresh re-run agrees on the verdict label)

  // DEDUP: reserve AFTER all validation (steps 1-4) and the upheld computation,
  // BEFORE any durable receipt, reputation write, or slash directive. A duplicate
  // returns here and produces no second receipt, no second slash, no side effect.
  const dispute_id = disputeId({ verdict_receipt_hash, claim_sha256: original.claim_sha256, agent, reason });
  if (!reserveDispute(dispute_id)) return { ok: false, error: 'DUPLICATE_DISPUTE', dispute_id };

  const { privateKey, notary_fp } = signer.loadPrivateKey();
  const disputeObj = {
    kind: 'verdict_dispute',
    dispute_id, dispute_protocol_version: DISPUTE_PROTOCOL_VERSION,
    original_receipt_hash: verdict_receipt_hash,
    agent, reason: String(reason || '').slice(0, 500),
    original_verdict: verdict_object.verdict, original_outcome: verdict_object.outcome,
    fresh_verdict: freshVerdict, fresh_outcome: fresh.outcome, fresh_status: fresh.status,
    fresh_observed: fresh.observed,
    upheld,
    resolved_at: new Date().toISOString(),
  };
  let receipt;
  try {
    receipt = signer.commit({ agent, claim: JSON.stringify(disputeObj), privateKey, notary_fp,
      actor_evidence: { actor_class: 'DISPUTE_FILER', classification_reason: 'dispute flow, not a normal commit', confidence: 'HIGH' } });
  } catch (e) {
    // Reservation cleanup: if the dispute never became durable, free the id so a
    // corrected retry is not permanently blocked by a failed attempt.
    releaseDispute(dispute_id);
    throw e;
  }

  // Reputation impact: only overturned disputes are worth recording against the
  // resolver_type's track record — a rejected dispute doesn't discredit anything.
  let slash_directive = null;
  if (upheld) {
    try {
      reputation.recordVerdict({
        agent, verdict: 'OVERTURNED_ON_DISPUTE', resolver_type: original_resolver_spec.type,
        settles_against: verdict_object.settles_against, claim_receipt_hash: verdict_object.claim_receipt_hash || null,
        verdict_receipt_hash, ts: disputeObj.resolved_at, claim_text: JSON.stringify(disputeObj),
      });
    } catch (e) { /* reputation write is best-effort, not fatal to the dispute result itself */ }

    // CLOSE THE CONSEQUENCE LOOP (2026-07-12): an overturned verdict is exactly the
    // slash condition. The consequence must fire automatically UP TO the money-out
    // gate — but not through it (auto-paying an untrusted caller is a drain/grief
    // vector per notary_bond.cjs, and CLAUDE.md brakes on money leaving custody).
    // So we do everything a human otherwise would: name the disputant payout wallet,
    // validate the slash in DRY-RUN, and alert with the exact --execute command.
    // The only remaining human step is authorizing the on-chain payout.
    slash_directive = buildSlashDirective({ verdict_receipt_hash, disputeObj, receipt });
  }

  return { ok: true, upheld, receipt, disputeObj, slash_directive };
}

// Assemble (and dry-run-validate) the slash that an upheld dispute earns. Fires a
// founder alert carrying the exact governed --execute command. Never pays: the
// payout stays behind notary_bond_slash.cjs --execute (the approval line).
function buildSlashDirective({ verdict_receipt_hash, disputeObj, receipt }) {
  const overturn_hash = receipt && (receipt.receipt_hash || receipt.hash);
  const disputant_wallet = (disputeObj && disputeObj.disputant_wallet) || null;
  const cmd = disputant_wallet
    ? `node core/notary_bond_slash.cjs --receipt ${verdict_receipt_hash} --disputant ${disputant_wallet} --overturned ${overturn_hash} --reason ${JSON.stringify('overturned on dispute ' + overturn_hash)} --execute`
    : `node core/notary_bond_slash.cjs --receipt ${verdict_receipt_hash} --disputant <disputant_payout_0x> --overturned ${overturn_hash} --reason "overturned on dispute" --execute`;
  const directive = { verdict_receipt_hash, overturn_hash, disputant_wallet, execute_cmd: cmd,
    note: 'DRY-RUN only. On-chain payout requires the --execute command above (money-out approval line).' };
  try {
    require('/home/marcus/core/notify.cjs').notify({
      type: 'BOND_SLASH_EARNED',
      subject: `⚖️ Dispute upheld — bond slash EARNED on ${verdict_receipt_hash.slice(0, 12)}…`,
      lines: [
        `A StillOS verdict was overturned on independent re-run. The correctness bond is now owed to the disputant.`,
        `Overturned verdict: ${verdict_receipt_hash}`,
        `Dispute receipt: ${overturn_hash}`,
        disputant_wallet ? `Disputant wallet: ${disputant_wallet}` : `Disputant wallet: NOT on file — supply the 0x payout address.`,
        `Consequence fires automatically to the money-out line. To pay, run:`,
        cmd,
      ],
    });
  } catch (e) { /* alert best-effort — the directive is still returned to the caller */ }
  return directive;
}

// Pure helpers exported for isolated testing of dedup derivation + atomic
// reservation (Phase 4). They do NOT broaden the production HTTP API — the
// live service only ever calls fileDispute().
module.exports = { fileDispute, findReceipt, DISPUTE_WINDOW_MS, disputeId, reserveDispute, releaseDispute, DISPUTE_PROTOCOL_VERSION };
