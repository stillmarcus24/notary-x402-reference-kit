'use strict';
/**
 * StillOS Correctness Bond — real, on-chain-verifiable skin-in-the-game.
 *
 * WHY THIS EXISTS: every prior notary artifact was self-attested — we sign our
 * own receipts and grade our own calibration. A self-signed "trust me" from a
 * $0-revenue agent gives no human and no agent a reason to route money or a
 * decision through us. The bond converts self-attestation into economic
 * confidence: real USDC held in a public Base wallet is committed as collateral
 * against our OWN correctness. A verdict proven wrong (via the /dispute
 * independent re-run) pays the disputant from the bond. The wallet balance is
 * independently verifiable on-chain, the slash terms are Ed25519-signed and
 * hash-chained (we cannot quietly rewrite them), and GET /bond lets any agent
 * check "is StillOS bonded, and has it ever been slashed?" BEFORE it transacts.
 *
 * SAFETY: self-custodied, publicly-committed bond — NOT a trustless escrow
 * contract. We deliberately did not deploy a novel fund-holding contract (a bug
 * there = total-loss blast radius). Slash payout is adjudicated by independent
 * re-run and executed by a governed command; it is never auto-paid to an
 * untrusted caller (that would be a drain/grief vector). Described exactly here,
 * not oversold — the confidence comes from real money publicly at stake plus a
 * commitment that is provable if we ever welch, which for a trust company is
 * reputational death.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const obligations = require('/home/marcus/core/slash_obligations.cjs');

const CONFIG = '/home/marcus/still-os-consciousness/state/proof-notary/bond.json';
const SLASH_LOG = '/home/marcus/still-os-consciousness/state/proof-notary/bond-slash-log.jsonl';
const RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'];
// The bond wallet must keep enough native ETH to actually PAY OUT slashes on-chain.
// Derivation (not arbitrary): worst case is paying out the ENTIRE bond at per-verdict
// granularity = bonded/per_verdict = 10 payouts. A Base USDC ERC-20 transfer is ~55k
// gas; even at a generous 0.1 gwei that's ~0.0000055 ETH/tx, so 10 payouts ~0.000055
// ETH. Floor set to 0.0002 ETH (~4x that worst case) so a fully-consumed bond stays
// payable with margin. Below this the bond is USDC-funded but unpayable — a real leak,
// so the monitor alerts and we top up gas.
const GAS_FLOOR_ETH = 0.0002;

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }

// Canonical hash of the slash terms — this is what the signature commits to, so
// the terms cannot be silently changed after the fact without breaking the sig.
function policyHash(cfg) {
  const terms = { bond_id: cfg.bond_id, wallet: cfg.wallet.toLowerCase(), network: cfg.network,
    asset: cfg.asset, asset_contract: cfg.asset_contract.toLowerCase(), bonded_usd: cfg.bonded_usd,
    per_verdict_max_usd: cfg.per_verdict_max_usd, slash_policy: cfg.slash_policy, mechanism: cfg.mechanism };
  return sha256(JSON.stringify(terms));
}

function loadSlashLog() {
  try { return fs.readFileSync(SLASH_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
}

// Live on-chain USDC balance of the bond wallet — the number that actually
// matters. Tries multiple public Base RPCs; throws only if all fail.
async function readOnchainUsdc(cfg) {
  const data = '0x70a08231000000000000000000000000' + cfg.wallet.slice(2).toLowerCase();
  let lastErr = null;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: cfg.asset_contract, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.result && j.result !== '0x') return { usd: parseInt(j.result, 16) / 1e6, rpc };
    } catch (e) { lastErr = e; }
  }
  throw new Error('all Base RPCs failed reading bond balance: ' + (lastErr && lastErr.message));
}

// Native ETH balance of the bond wallet (gas that pays out a slash).
async function readOnchainEth(cfg) {
  let lastErr = null;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [cfg.wallet, 'latest'] }),
        signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.result) return { eth: parseInt(j.result, 16) / 1e18, rpc };
    } catch (e) { lastErr = e; }
  }
  throw new Error('all Base RPCs failed reading bond ETH: ' + (lastErr && lastErr.message));
}

// How much bond coverage remains after prior slashes. A slash can never take the
// cumulative payout above bonded_usd — that's the ceiling of what we've committed.
function availableBondUsd(cfg) {
  cfg = cfg || loadConfig();
  const slashed = loadSlashLog().reduce((a, s) => a + Number(s.amount_usd || 0), 0);
  return Math.max(0, Number((cfg.bonded_usd - slashed).toFixed(6)));
}

// Tamper-evidence check on the slash log — every entry's hash must recompute and
// chain to the prior. A broken chain means the slash history was edited.
function verifySlashChain() {
  const log = loadSlashLog();
  let prev = null, ok = true;
  const results = [];
  for (const e of log) {
    const { entry_hash, ...core } = e;
    const recomputed = sha256(JSON.stringify(core));
    const hashOk = recomputed === entry_hash;
    const chainOk = core.prev_hash === prev;
    if (!hashOk || !chainOk) ok = false;
    results.push({ receipt_hash: e.receipt_hash, hashOk, chainOk });
    prev = entry_hash;
  }
  return { ok, count: log.length, results };
}

// Compact reference embedded in every issued receipt: pointer to the standing
// bond that backs it. Pure (no network, no signing) so the signing path can call
// it cheaply and without a dependency cycle.
function bondRef() {
  const cfg = loadConfig();
  return { bond_id: cfg.bond_id, wallet: cfg.wallet, network: cfg.network,
    per_verdict_max_usd: cfg.per_verdict_max_usd, policy_hash: policyHash(cfg),
    status: cfg.status_endpoint };
}

// --- Implementation digests: closes the published-equals-running gap ----------
//
// WHY (2026-09-12): the reference kit asserted, in manifest.parties.stillos
// .deployment_status, that "all 6 published bond files are byte-identical to
// /home/marcus/core". That claim was TRUE and entirely unverifiable by anyone
// but us — it named a private path and a timestamp, so an auditor could only
// trust it. Publishing DIGESTS.json in the kit closed half the gap (a cloner can
// prove clone == committed) and explicitly recorded the other half as open:
// nothing proved committed == RUNNING.
//
// This closes it. The live process hashes its OWN bond sources at request time
// and serves them, signed under the same Ed25519 attestation as the rest of the
// bond status. A third party compares these digests to implementation/bond/*
// in the published DIGESTS.json. Match => the code we publish is the code we
// run, established by recomputation rather than by our say-so.
//
// Honest boundary, kept in the payload: this proves the files on disk that this
// module hashes are those bytes. It does not prove the loaded process image was
// never patched in memory. That is a strictly weaker threat model than "the
// operator quietly published different code", which is the one that mattered.
const BOND_IMPL_FILES = [
  'bond_monitor.cjs',
  'notary_bond.cjs',
  'notary_bond_mirror_refresh.cjs',
  'notary_bond_slash.cjs',
  'slash_obligations.cjs',
  'verdict_dispute.cjs',
];
const BOND_IMPL_DIR = '/home/marcus/core';
let _implCache = null;

function implementationDigests() {
  // Cheap mtime+size key so a public endpoint is not re-hashing on every hit,
  // while an actual code change is picked up on the next request.
  const stamp = BOND_IMPL_FILES.map(f => {
    try { const s = fs.statSync(path.join(BOND_IMPL_DIR, f)); return `${f}:${s.mtimeMs}:${s.size}`; }
    catch { return `${f}:missing`; }
  }).join('|');
  if (_implCache && _implCache.stamp === stamp) return _implCache.value;

  const files = {};
  for (const f of BOND_IMPL_FILES) {
    try {
      const buf = fs.readFileSync(path.join(BOND_IMPL_DIR, f));
      files[f] = { sha256: sha256(buf), bytes: buf.length };
    } catch { files[f] = { sha256: null, bytes: null, error: 'unreadable' }; }
  }
  // Same preimage shape as the kit's gen-digests.cjs, so the two are directly
  // comparable and reproducible by hand with sha256sum.
  const lines = BOND_IMPL_FILES.map(f => `${f}  ${files[f].sha256}`).join('\n') + '\n';
  const value = {
    digests_version: 'STILLOS_NOTARY_BOND_IMPL_DIGESTS_V1',
    algorithm: 'sha256',
    computed_at_runtime: true,
    source_dir_is_private: true,
    files,
    bond_set_digest: sha256(Buffer.from(lines, 'utf8')),
    bond_set_digest_preimage: 'sha256 over "<basename>  <sha256>\\n" lines, files sorted by basename, UTF-8',
    published_counterpart: 'https://github.com/stillmarcus24/notary-x402-reference-kit/blob/main/DIGESTS.json',
    how_to_verify:
      'Clone the reference kit, run `node tools/verify-digests.cjs` (proves your clone matches what we committed), then compare bond_set_digest here to the bond_set_digest in that DIGESTS.json. Equal => the published bond implementation is the one this live service is running.',
    what_this_does_not_prove:
      'That the loaded process image matches these on-disk bytes. This closes the operator-published-different-code gap, not an in-memory tampering one.',
  };
  _implCache = { stamp, value };
  return value;
}

// The notary is fronted by more than one public domain. Domain-bearing fields
// used to be signed with the config's hardcoded origin and then string-rewritten
// downstream by notary_domain_rewrite_proxy.cjs -- AFTER signing. That left every
// caller on the rewritten domain holding a payload whose attestation_hash could
// not be recomputed (found 2026-09-12: signature valid, hash mismatch, so the
// bond's own `verify` instruction failed for every external auditor). Fix: the
// origin resolves the public origin from the request and signs THAT, so the
// served bytes are the signed bytes and no downstream mutation is needed.
const ALLOWED_PUBLIC_ORIGINS = [
  'https://stillosdigitalholdings.com',
  'https://nolawealthfinancial.com',
];
function resolvePublicOrigin(req) {
  const hdr = (h) => (req && req.headers && req.headers[h]) || '';
  const explicit = String(hdr('x-stillos-public-origin')).trim();
  if (ALLOWED_PUBLIC_ORIGINS.includes(explicit)) return explicit;
  const host = String(hdr('x-forwarded-host') || hdr('host')).split(',')[0].trim().toLowerCase();
  if (host) {
    const match = ALLOWED_PUBLIC_ORIGINS.find((o) => o === `https://${host}`);
    if (match) return match;
  }
  return null; // unknown/absent -> keep config values verbatim, sign those
}
// Re-point every domain-bearing string in the status onto the resolved public
// origin before hashing. Only rewrites origins we already serve; never invents one.
function applyPublicOrigin(obj, origin) {
  if (!origin) return obj;
  const others = ALLOWED_PUBLIC_ORIGINS.filter((o) => o !== origin);
  const walk = (v) => {
    if (typeof v === 'string') {
      let s = v;
      for (const o of others) {
        // Only plain https:// origins. did:web:<domain> has no https:// prefix and
        // is the notary's stable cryptographic identity -- it must never move.
        s = s.split(o).join(origin);
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(obj);
}

// Full live status: on-chain balance, active flag, terms, slash history.
async function getStatus() {
  const cfg = loadConfig();
  const bal = await readOnchainUsdc(cfg);
  const slashes = loadSlashLog();
  const slashed_total = slashes.reduce((a, s) => a + Number(s.amount_usd || 0), 0);
  return {
    bond_id: cfg.bond_id,
    established: cfg.established,
    wallet: cfg.wallet,
    network: cfg.network,
    asset: cfg.asset,
    asset_contract: cfg.asset_contract,
    bonded_usd: cfg.bonded_usd,
    per_verdict_max_usd: cfg.per_verdict_max_usd,
    onchain_balance_usd: Number(bal.usd.toFixed(6)),
    // `active` stays balance-only and unchanged: existing callers and the static
    // mirror depend on its meaning, and it is an honest answer to "is collateral
    // posted". It is NOT an answer to "is this bond current on what it owes" —
    // 2026-09-11 that distinction is made explicit on the public surface rather
    // than only inside healthCheck(), because /bond is the endpoint a counterparty
    // actually calls. A funded Safe sitting on an overdue adjudicated payout must
    // not be able to present as fine here.
    active: bal.usd >= cfg.bonded_usd,
    collateral_funded: bal.usd >= cfg.bonded_usd,
    custody_type: cfg.custody_type || 'single-key-eoa',
    slash_count: slashes.length,
    slashed_total_usd: Number(slashed_total.toFixed(6)),
    slash_history: slashes,
    ...(() => {
      const ob = obligations.summary();
      return {
        obligation_ledger_intact: ob.obligation_ledger_intact,
        unpaid_slash_obligations: ob.unpaid_slash_obligations,
        unpaid_slash_obligations_usd: ob.unpaid_slash_obligations_usd,
        overdue_slash_obligations: ob.overdue_slash_obligations,
        overdue_threshold_hours: ob.overdue_threshold_hours,
        overdue_threshold_is_a_committed_sla: false,
        committed_payout_sla: null,
        all_slash_obligations_current: ob.all_slash_obligations_current,
        bond_current: (bal.usd >= cfg.bonded_usd) && ob.obligation_ledger_intact && ob.overdue_slash_obligations === 0,
      };
    })(),
    implementation_digests: implementationDigests(),
    policy_hash: policyHash(cfg),
    slash_policy: cfg.slash_policy,
    mechanism: cfg.mechanism,
    claim_endpoint: cfg.claim_endpoint,
    verify_balance_instructions: cfg.verify_balance_instructions,
    balance_source_rpc: bal.rpc,
    ts: new Date().toISOString(),
  };
}

// Ed25519-signed status, using the same notary key that signs receipts, so an
// agent can verify the bond attestation against the same public key it already
// trusts for receipts. Signature is over sha256 of the canonical status.
// Envelope fields are added AFTER the hash is computed, so a verifier must strip
// exactly these to rebuild the preimage. Named explicitly (and published in the
// `verify` string below) because the old instruction said only
// "status-fields-in-order", which no outside auditor could reproduce without
// guessing. Keep this list and the returned envelope in sync.
const ATTESTATION_ENVELOPE_FIELDS = [
  'notary_fp', 'public_key', 'attestation_hash', 'signature',
  'verify', 'attestation_envelope_fields',
];
async function getSignedStatus(req) {
  const origin = resolvePublicOrigin(req);
  const status = applyPublicOrigin(await getStatus(), origin);
  const signer = require('/home/marcus/core/notary_recovery_signer.cjs');
  const { privateKey, publicKeyPem, notary_fp } = signer.loadPrivateKey();
  const attestation_hash = sha256(JSON.stringify(status));
  const signature = crypto.sign(null, Buffer.from(attestation_hash), privateKey).toString('base64');
  return { ...status, notary_fp, public_key: publicKeyPem, attestation_hash, signature,
    attestation_envelope_fields: ATTESTATION_ENVELOPE_FIELDS,
    verify: 'Recompute: take this JSON object, delete exactly the keys listed in '
      + 'attestation_envelope_fields, and preserve the order of every remaining key as '
      + 'served. attestation_hash = SHA256(UTF-8 of JSON.stringify(that object)). Then verify '
      + 'the Ed25519 signature: it is over the ASCII of the attestation_hash hex string (not '
      + 'over the raw bytes), against public_key. Then independently confirm onchain_balance_usd '
      + 'via USDC.balanceOf(wallet) on Base. Every URL in this payload is signed as served — if '
      + 'any intermediary rewrote a domain, the recomputed hash will not match, by design.' };
}

// Record a slash payout (called by the governed slash-execution command AFTER an
// independent re-run overturns a verdict and the on-chain payout is confirmed).
// Hardened against the two real leaks: (1) double-slash — the SAME receipt can
// never be paid twice; (2) over-slash — cumulative payouts can never exceed the
// bonded pool, and no single payout can exceed per_verdict_max_usd.
function recordSlash({ receipt_hash, disputant, amount_usd, payout_tx, reason }) {
  const cfg = loadConfig();
  const amt = Number(amount_usd);
  if (!receipt_hash) throw new Error('recordSlash: receipt_hash required');
  if (!(amt > 0)) throw new Error('recordSlash: amount_usd must be > 0');
  if (amt > cfg.per_verdict_max_usd) throw new Error(`recordSlash: amount $${amt} exceeds per_verdict_max_usd $${cfg.per_verdict_max_usd}`);
  const prev = loadSlashLog();
  if (prev.some(s => s.receipt_hash === receipt_hash)) throw new Error(`recordSlash: receipt ${receipt_hash} already slashed (idempotency)`);
  if (amt > availableBondUsd(cfg)) throw new Error(`recordSlash: amount $${amt} exceeds available bond $${availableBondUsd(cfg)} (bond exhausted)`);
  const prev_hash = prev.length ? prev[prev.length - 1].entry_hash : null;
  const core = { ts: new Date().toISOString(), receipt_hash, disputant, amount_usd: amt,
    payout_tx: payout_tx || null, reason: reason || null, prev_hash };
  const entry_hash = sha256(JSON.stringify(core));
  const entry = { ...core, entry_hash };
  fs.appendFileSync(SLASH_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

// One-call health of the bond: is it funded (USDC >= bonded), payable (ETH gas
// above floor), coverage-intact (slash chain valid), and how much remains.
// Returns warnings[] naming every leak found so the monitor can alert.
async function healthCheck() {
  const cfg = loadConfig();
  const warnings = [];
  let usdc = null, eth = null;
  try { usdc = (await readOnchainUsdc(cfg)).usd; } catch (e) { warnings.push('usdc_read_failed: ' + e.message); }
  // Gas is paid by whoever LANDS the payout tx, which is not always the wallet that
  // HOLDS the collateral. Under Safe custody the collateral sits in a multisig that
  // holds no ETH by design, and a signer/relayer EOA pays gas — so check the floor
  // against gas_relayer when one is declared, else the bond wallet itself.
  const gasAddr = cfg.gas_relayer || cfg.wallet;
  try { eth = (await readOnchainEth({ ...cfg, wallet: gasAddr })).eth; } catch (e) { warnings.push('eth_read_failed: ' + e.message); }
  const funded = usdc != null && usdc >= cfg.bonded_usd;
  const payable = eth != null && eth >= GAS_FLOOR_ETH;
  const chain = verifySlashChain();
  if (usdc != null && !funded) warnings.push(`BOND INACTIVE: USDC $${usdc} < bonded $${cfg.bonded_usd} — receipts are unbacked`);
  if (eth != null && !payable) warnings.push(`BOND UNPAYABLE: gas wallet ${gasAddr} has ETH ${eth} < floor ${GAS_FLOOR_ETH} — a slash could not be landed on-chain`);
  if (!chain.ok) warnings.push('SLASH LOG TAMPERED: hash chain does not verify');
  const available = availableBondUsd(cfg);
  if (available <= 0) warnings.push('BOND EXHAUSTED: cumulative slashes have consumed the full pool');

  // COLLATERAL FUNDED != OBLIGATIONS CURRENT (2026-09-11). Before this, `healthy`
  // was computed purely from the balance, the gas floor and the slash-log chain —
  // all of which stay green while an adjudicated, unpaid debt sits outstanding.
  // Under 2-of-2 custody a payout can be owed for an unbounded interval, so a Safe
  // holding plenty of USDC could report a fully healthy bond while being late on a
  // slash it had already lost. These are now reported as separate facts, and an
  // overdue obligation drops `healthy` on its own.
  const ob = obligations.summary();
  if (ob.unpaid_slash_obligations > 0) {
    warnings.push(`UNPAID SLASH OBLIGATIONS: ${ob.unpaid_slash_obligations} adjudicated payout(s) totalling $${ob.unpaid_slash_obligations_usd} not yet discharged`);
  }
  if (ob.overdue_slash_obligations > 0) {
    warnings.push(`OVERDUE SLASH OBLIGATIONS: ${ob.overdue_slash_obligations} unpaid past the ${ob.overdue_threshold_hours}h visibility threshold — the bond is late on a debt it has already lost`);
  }
  if (!ob.obligation_ledger_intact) warnings.push('OBLIGATION LEDGER TAMPERED: hash chain does not verify');

  return {
    bond_id: cfg.bond_id, wallet: cfg.wallet,
    custody_type: cfg.custody_type || 'single-key-eoa', gas_wallet: gasAddr,
    usdc_balance: usdc, eth_balance: eth,
    bonded_usd: cfg.bonded_usd, available_bond_usd: available, per_verdict_max_usd: cfg.per_verdict_max_usd,
    // Four independently-readable facts, deliberately not collapsed into one boolean.
    collateral_funded: funded,
    slash_log_intact: chain.ok,
    obligation_ledger_intact: ob.obligation_ledger_intact,
    unpaid_slash_obligations: ob.unpaid_slash_obligations,
    unpaid_slash_obligations_usd: ob.unpaid_slash_obligations_usd,
    overdue_slash_obligations: ob.overdue_slash_obligations,
    overdue_threshold_hours: ob.overdue_threshold_hours,
    overdue_threshold_is_a_committed_sla: false,
    all_slash_obligations_current: ob.all_slash_obligations_current,
    // Retained for callers that already read these names.
    funded, payable, slash_chain_ok: chain.ok, slash_count: chain.count,
    healthy: funded && payable && chain.ok && available > 0
      && ob.obligation_ledger_intact && ob.overdue_slash_obligations === 0,
    warnings, ts: new Date().toISOString(),
  };
}

// In-process cached status, added 2026-08-02. Hot public paths (badge SVG
// render, x402 402-response discovery text) used to hardcode `bond: 10` /
// "$10 slashable bond" unconditionally -- found live that the shared
// facilitator wallet had drained to $0 (active:false), so every badge and
// every 402 quote kept asserting a $10 bond that did not exist on-chain.
// Those paths can't afford a live RPC call per request (badge embeds get
// hit by arbitrary third-party traffic), so this caches the last known
// status in module scope (shared across requests within one process) and
// refreshes in the background. Never claim active on a cold cache or a
// failed refresh -- default to the honest/safe state (inactive, $0).
let _statusCache = { active: false, bonded_usd: 0, onchain_balance_usd: 0, ts: 0 };
let _refreshing = null;
const STATUS_CACHE_TTL_MS = 3 * 60 * 1000;

// The in-memory cache above is per-process and starts cold, which was fine for
// per-request readers but silently wrong for any caller that reads it ONCE at
// boot. Found live 2026-09-09: notary_service_marcus.cjs computes TRUST_SUFFIX
// (the bond sentence embedded in EVERY paid route's 402 body) as a boot-time
// const. The cold cache always answers inactive, so all ~38 paid endpoints
// advertised "Correctness bond currently INACTIVE (unfunded)" permanently --
// regardless of the real on-chain balance, and with no way to ever self-correct
// for the life of the process. That is the exact false-claim class the 2026-08-02
// fix was written to prevent, inverted: the safe default became a live lie in
// the other direction, published to every x402 directory that indexes us.
// Fix: persist each successful refresh to disk and seed module scope from it,
// so a cold process starts from the last REAL observation instead of a fiction.
const STATUS_CACHE_FILE = '/home/marcus/still-os-consciousness/state/proof-notary/bond-status-cache.json';
// Seeded state is only trusted while it is demonstrably recent. Live traffic
// refreshes this every 3 minutes, so a file older than this means the observing
// process was down and we have no current knowledge -- fall back to the honest
// inactive default rather than asserting a balance nobody has checked lately.
const STATUS_CACHE_MAX_SEED_AGE_MS = 6 * 60 * 60 * 1000;

function persistCachedStatus(status) {
  try { fs.writeFileSync(STATUS_CACHE_FILE, JSON.stringify(status)); }
  catch (e) { console.error('[notary_bond] status cache persist failed (non-fatal):', e.message); }
}

function seedCachedStatusFromDisk() {
  try {
    const seeded = JSON.parse(fs.readFileSync(STATUS_CACHE_FILE, 'utf8'));
    const age = Date.now() - (seeded.ts || 0);
    if (age >= 0 && age < STATUS_CACHE_MAX_SEED_AGE_MS) _statusCache = seeded;
  } catch { /* no usable seed -- keep the safe inactive default */ }
}
seedCachedStatusFromDisk();

function refreshCachedStatus() {
  if (_refreshing) return _refreshing;
  _refreshing = getStatus()
    .then((status) => { _statusCache = { ...status, ts: Date.now() }; persistCachedStatus(_statusCache); return _statusCache; })
    .catch((e) => { console.error('[notary_bond] cache refresh failed, keeping last known state:', e.message); return _statusCache; })
    .finally(() => { _refreshing = null; });
  return _refreshing;
}

// Synchronous read for hot paths. Kicks off a background refresh when stale
// but always returns immediately with the last known state -- callers never
// block on RPC. A fresh process is seeded from the on-disk cache above, so the
// first read reflects the last real on-chain observation rather than a cold
// default; if no recent seed exists it still answers inactive, never active.
function getCachedStatusSync() {
  if (Date.now() - _statusCache.ts > STATUS_CACHE_TTL_MS) refreshCachedStatus();
  return _statusCache;
}

module.exports = { loadConfig, policyHash, bondRef, getStatus, getSignedStatus, recordSlash,
  readOnchainUsdc, readOnchainEth, availableBondUsd, verifySlashChain, healthCheck, GAS_FLOOR_ETH,
  getCachedStatusSync, refreshCachedStatus };

// CLI: `node core/notary_bond.cjs` prints signed live status.
if (require.main === module) {
  getSignedStatus().then(s => console.log(JSON.stringify(s, null, 2))).catch(e => { console.error('ERR:', e.message); process.exit(1); });
}
