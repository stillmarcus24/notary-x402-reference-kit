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
    active: bal.usd >= cfg.bonded_usd,
    slash_count: slashes.length,
    slashed_total_usd: Number(slashed_total.toFixed(6)),
    slash_history: slashes,
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
async function getSignedStatus() {
  const status = await getStatus();
  const signer = require('/home/marcus/core/notary_recovery_signer.cjs');
  const { privateKey, publicKeyPem, notary_fp } = signer.loadPrivateKey();
  const attestation_hash = sha256(JSON.stringify(status));
  const signature = crypto.sign(null, Buffer.from(attestation_hash), privateKey).toString('base64');
  return { ...status, notary_fp, public_key: publicKeyPem, attestation_hash, signature,
    verify: 'Recompute attestation_hash = SHA256(JSON.stringify(status-fields-in-order)); verify Ed25519 signature against public_key; independently confirm onchain_balance_usd via USDC.balanceOf on Base.' };
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
  return {
    bond_id: cfg.bond_id, wallet: cfg.wallet,
    custody_type: cfg.custody_type || 'single-key-eoa', gas_wallet: gasAddr,
    usdc_balance: usdc, eth_balance: eth,
    bonded_usd: cfg.bonded_usd, available_bond_usd: available, per_verdict_max_usd: cfg.per_verdict_max_usd,
    funded, payable, slash_chain_ok: chain.ok, slash_count: chain.count,
    healthy: funded && payable && chain.ok && available > 0,
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
