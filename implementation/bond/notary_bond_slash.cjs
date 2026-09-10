#!/usr/bin/env node
'use strict';
/**
 * StillOS Correctness Bond — governed slash-payout executor.
 *
 * Closes the loop the bond opened: when a StillOS verdict is proven wrong via the
 * /dispute independent re-run, this pays the disputant on-chain from the bond
 * wallet, then records the slash to the public hash-chained log.
 *
 * SAFETY (this moves REAL money, so every rail is here):
 *  - DRY-RUN by default. Real payout requires --execute.
 *  - Requires --overturned proof: the dispute-resolution receipt hash whose re-run
 *    overturned the original verdict. No overturn ref → refuse.
 *  - Idempotent: a receipt already in the slash log is refused (no double-pay).
 *  - Capped: amount <= per_verdict_max_usd AND <= remaining bond. Enforced twice —
 *    here before sending, and again in recordSlash() after.
 *  - Gas floor: refuses if the wallet can't afford to actually land the tx.
 *  - Fires a founder alert on every real payout (money left custody).
 *
 * Usage:
 *   node core/notary_bond_slash.cjs --receipt <verdict_hash> --disputant 0x.. \
 *        --overturned <dispute_receipt_hash> --reason "..." [--amount 1.0] [--execute]
 */
const NM = '/home/marcus/still-os-consciousness/node_modules';
const fs = require('fs');
const { createWalletClient, http: viemHttp, publicActions, encodeFunctionData } = require(NM + '/viem');
const { privateKeyToAccount } = require(NM + '/viem/accounts');
const { base } = require(NM + '/viem/chains');
const bond = require('/home/marcus/core/notary_bond.cjs');

const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const ERC20_TRANSFER_ABI = [{ name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }];

function arg(name) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : null; }
function flag(name) { return process.argv.includes('--' + name); }

// Key source, 2026-09-09: the env-file path used to be hardcoded to
// /home/marcus/secrets/agent-wallet.env, which meant this file could not be read
// or run by a counterparty auditing the slash path. It is now overridable via
// AGENT_WALLET_ENV, and AGENT_WALLET_PRIVATE_KEY may be supplied directly in the
// process environment instead of any file. No key material lives in this repo.
function loadWallet() {
  const env = {};
  const envFile = process.env.AGENT_WALLET_ENV || '/home/marcus/secrets/agent-wallet.env';
  try {
    for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = l.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch (e) {
    if (!process.env.AGENT_WALLET_PRIVATE_KEY) {
      throw new Error(`no wallet key: ${envFile} unreadable (${e.code}) and AGENT_WALLET_PRIVATE_KEY unset`);
    }
  }
  let pk = process.env.AGENT_WALLET_PRIVATE_KEY || env.AGENT_WALLET_PRIVATE_KEY;
  if (pk && !pk.startsWith('0x')) pk = '0x' + pk;
  const account = privateKeyToAccount(pk);
  return { account, wallet: createWalletClient({ account, chain: base, transport: viemHttp(RPC) }).extend(publicActions) };
}

async function main() {
  const cfg = bond.loadConfig();
  const receipt_hash = arg('receipt');
  const disputant = arg('disputant');
  const overturned = arg('overturned');
  const reason = arg('reason') || null;
  const amount = arg('amount') ? Number(arg('amount')) : cfg.per_verdict_max_usd;
  const execute = flag('execute');
  const recordExternal = flag('record-external');

  // ---- validation (fail-closed, before touching a key) ----
  const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };

  // Under multisig custody the payout is signed by humans outside this process, so
  // the slash log would otherwise have no way to record a payment that really
  // happened. This path records it — but only after confirming on-chain that the
  // claimed tx exists, succeeded, and actually moved the stated USDC from the bond
  // wallet to the disputant. It never moves money; it only writes history.
  if (recordExternal) {
    const tx = arg('tx');
    if (!tx || !/^0x[a-fA-F0-9]{64}$/.test(tx)) fail('--tx <payout_tx_hash> required with --record-external');
    if (!receipt_hash) fail('--receipt <verdict_receipt_hash> required');
    if (!disputant || !/^0x[a-fA-F0-9]{40}$/.test(disputant)) fail('--disputant <valid 0x address> required');
    if (!(amount > 0)) fail('amount must be > 0');
    if (amount > cfg.per_verdict_max_usd) fail(`amount $${amount} exceeds per_verdict_max_usd $${cfg.per_verdict_max_usd}`);
    const chk = bond.verifySlashChain();
    if (!chk.ok) fail('slash log chain does not verify — refusing to write onto a tampered log');
    if (chk.results.some(r => r.receipt_hash === receipt_hash)) fail(`receipt ${receipt_hash} already slashed (idempotency)`);
    const avail = bond.availableBondUsd(cfg);
    if (amount > avail) fail(`amount $${amount} exceeds available bond $${avail}`);

    const rc = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx] }) })).json();
    const r = rc && rc.result;
    if (!r) fail(`tx ${tx} not found on ${cfg.network} — refusing to record an unverified payout`);
    if (BigInt(r.status) !== 1n) fail(`tx ${tx} did not succeed (status ${r.status})`);
    // ERC-20 Transfer(from,to,value): topic0 + indexed from/to, value in data.
    const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
    const moved = (r.logs || []).some(l =>
      l.address.toLowerCase() === cfg.asset_contract.toLowerCase() &&
      (l.topics || [])[0] === TRANSFER &&
      (l.topics || [])[1] === pad(cfg.wallet) &&
      (l.topics || [])[2] === pad(disputant) &&
      BigInt(l.data) === BigInt(Math.round(amount * 1e6)));
    if (!moved) fail(`tx ${tx} contains no USDC Transfer of ${amount} from bond wallet ${cfg.wallet} to ${disputant} — refusing to record`);

    const rec = bond.recordSlash({ receipt_hash, disputant, amount_usd: amount, payout_tx: tx, reason });
    console.log(JSON.stringify({ mode: 'RECORDED-EXTERNAL (multisig payout verified on-chain, no money moved by this command)', entry: rec }, null, 2));
    return;
  }
  if (!receipt_hash) fail('--receipt <verdict_receipt_hash> required');
  if (!disputant || !/^0x[a-fA-F0-9]{40}$/.test(disputant)) fail('--disputant <valid 0x address> required');
  if (!overturned) fail('--overturned <dispute_receipt_hash proving the re-run overturned the verdict> required — a slash without an adjudicated overturn is not authorized');
  if (!(amount > 0)) fail('amount must be > 0');
  if (amount > cfg.per_verdict_max_usd) fail(`amount $${amount} exceeds per_verdict_max_usd $${cfg.per_verdict_max_usd}`);

  const already = bond.verifySlashChain();
  if (!already.ok) fail('slash log chain does not verify — refusing to write onto a tampered log');
  if (already.results.some(r => r.receipt_hash === receipt_hash)) fail(`receipt ${receipt_hash} already slashed (idempotency)`);

  const available = bond.availableBondUsd(cfg);
  if (amount > available) fail(`amount $${amount} exceeds available bond $${available}`);

  const health = await bond.healthCheck();
  if (!health.funded) fail(`bond not funded: USDC $${health.usdc_balance} < bonded $${cfg.bonded_usd}`);
  if (!health.payable) fail(`bond wallet gas below floor (ETH ${health.eth_balance} < ${bond.GAS_FLOOR_ETH}) — cannot land payout tx`);

  const plan = { receipt_hash, disputant, amount_usd: amount, overturned, reason,
    bond_wallet: cfg.wallet, asset: cfg.asset, network: cfg.network,
    available_bond_before: available, available_bond_after: Number((available - amount).toFixed(6)) };

  if (!execute) {
    console.log(JSON.stringify({ mode: 'DRY-RUN (no money moved) — pass --execute to pay', would_pay: plan }, null, 2));
    return;
  }

  // Multisig custody: the collateral is NOT movable by any single key on this host.
  // Fail here with the real reason rather than falling through to the key-mismatch
  // check below, which would report a confusing "wrong key" error. The obligation to
  // pay an adjudicated overturn is unchanged — only the execution path is manual.
  if (cfg.custody_type && cfg.custody_type !== 'single-key-eoa') {
    fail(`bond collateral is held in ${cfg.custody_type} at ${cfg.wallet} — this command cannot pay it out.\n` +
         `An adjudicated overturn still obligates payment. Execute the payout manually:\n` +
         `  transfer ${amount} USDC (${cfg.asset_contract}) on ${cfg.network} to ${disputant}\n` +
         `  from Safe ${cfg.wallet}, signed 2-of-2 (phone + box).\n` +
         `Then record it: node core/notary_bond_slash.cjs --record-external --receipt ${receipt_hash} ` +
         `--disputant ${disputant} --amount ${amount} --tx <payout_tx_hash>`);
  }

  // ---- live on-chain USDC payout ----
  const { account, wallet } = loadWallet();
  if (account.address.toLowerCase() !== cfg.wallet.toLowerCase()) fail(`loaded key ${account.address} != bond wallet ${cfg.wallet}`);
  const units = BigInt(Math.round(amount * 1e6)); // USDC 6 decimals
  const data = encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [disputant, units] });
  const hash = await wallet.sendTransaction({ to: cfg.asset_contract, data });
  const rcpt = await wallet.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') fail(`payout tx reverted: ${hash}`);

  const entry = bond.recordSlash({ receipt_hash, disputant, amount_usd: amount, payout_tx: hash, reason });
  try {
    require('/home/marcus/core/notify.cjs').notify({
      type: 'BOND_SLASH_EXECUTED',
      subject: `⚖️ Correctness bond slashed — $${amount} paid to disputant`,
      lines: [`A StillOS verdict was proven wrong and the bond paid out.`,
        `Receipt: ${receipt_hash}`, `Disputant: ${disputant}`, `Amount: $${amount} USDC`,
        `Payout tx: ${hash}`, `Overturn ref: ${overturned}`, `Bond remaining: $${bond.availableBondUsd(cfg)}`],
    });
  } catch (e) { console.error('[slash] alert failed (payout still landed):', e.message); }
  console.log(JSON.stringify({ mode: 'EXECUTED', payout_tx: hash, slash_entry: entry, bond_remaining_usd: bond.availableBondUsd(cfg) }, null, 2));
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
