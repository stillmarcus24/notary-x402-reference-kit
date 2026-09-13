#!/usr/bin/env node
'use strict';
/*
 * replay-anchor.js — a third independent replay of someone else's anchor.
 *
 *   node replay-anchor.js --proof ./proof13.json
 *   node replay-anchor.js --proof ./proof13.json --rpc https://ethereum-sepolia-rpc.publicnode.com
 *   node replay-anchor.js --proof ./proof13.json --offline      # skip the chain read
 *
 * Context. On x402-foundation/x402#3389, @seritalien (Vauban) published a STARK
 * fact anchored on Ethereum Sepolia, and @goun7 (Tamga) replayed it with an
 * independent pure-python keccak and published a verdict — first indeterminate
 * (the epoch had not sealed), then green once it had. Two implementations, one
 * half each, verdicts published either way.
 *
 * This is the third. It shares no code, no language and no library with either of
 * them: keccak256.js in this directory is written out by hand and self-tested
 * against three known-answer vectors. If three independent implementations
 * recompute the same root from the same proof, the root is not an artifact of
 * anybody's toolchain.
 *
 * WHAT A GREEN HERE MEANS, EXACTLY — and the limit is not decoration:
 *   established : this fact hash is a leaf of the Merkle tree whose root is
 *                 anchored on Ethereum at the stated contract and epoch.
 *   NOT established : that the STARK proof the fact attests is sound, that the
 *                 batch it commits to describes real settlements, or that any
 *                 underlying claim is true. Inclusion is presentation, not truth.
 *
 * And the third verdict is a real one. If the chain read cannot be completed, this
 * prints INDETERMINATE and exits 3 — it does not print red. An unreachable RPC is
 * not evidence that an anchor is absent, which is the same rule (@goun7's, adopted
 * into §4.4 of the Vauban profile) that the evidence-record suite enforces as
 * rec-13. A tool that collapses unknown into false manufactures false refutations
 * during someone else's outage.
 */

const fs = require('fs');
const path = require('path');
const { keccak256, keccak256Hex, keccak256Utf8, toHex, fromHex, selftest } = require('./keccak256.js');

// ---- args ----
const argv = process.argv.slice(2);
function opt(n, d = null) { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; }
const offline = argv.includes('--offline');
const proofPath = opt('--proof');
const RPC = opt('--rpc', 'https://ethereum-sepolia-rpc.publicnode.com');
if (!proofPath) { console.error('usage: node replay-anchor.js --proof <proof.json> [--rpc URL] [--offline]'); process.exit(2); }

const P = JSON.parse(fs.readFileSync(path.resolve(proofPath), 'utf8'));

const pad32 = (h) => h.replace(/^0x/, '').padStart(64, '0');
const cat = (a, b) => fromHex('0x' + pad32(a) + pad32(b));

console.log('');
console.log('  independent anchor replay');
console.log('  ' + '-'.repeat(66));
console.log(`  fact      : ${P.fact_hash}`);
console.log(`  epoch     : ${P.epoch_id}   position ${P.position} of ${P.leaf_count}   proof length ${P.proof.length}`);
console.log(`  contract  : ${P.l1 && P.l1.contract}  (chain_id ${P.l1 && P.l1.chain_id})`);
console.log('');

// ---- step 0: our hash function is not on trust ----
const katOk = selftest();
console.log(`  [0] keccak256 self-test (3 known-answer vectors) ......... ${katOk ? 'PASS' : 'FAIL'}`);
if (!katOk) { console.log('\n  our own hash is wrong; no verdict can be drawn.\n'); process.exit(2); }

// ---- step 1: recompute the leaf ----
// OpenZeppelin StandardMerkleTree: leaf = keccak256(keccak256(abi.encode(value))).
// The double hash is what stops an internal node from being presented as a leaf.
const leaf = keccak256Hex(keccak256Hex(P.fact_hash));
console.log(`  [1] leaf = keccak256(keccak256(bytes32(fact))) ........... ${leaf}`);

// ---- step 2: walk the proof, sorted pairs ----
let node = leaf;
P.proof.forEach((sib, i) => {
  const [lo, hi] = BigInt(node) <= BigInt(sib) ? [node, sib] : [sib, node];
  node = toHex(keccak256(cat(lo, hi)));
  console.log(`      step ${i + 1}/${P.proof.length} -> ${node}`);
});
const recomputed = node;
const rootMatchesProof = BigInt(recomputed) === BigInt(P.root);
console.log(`  [2] recomputed root ..................................... ${recomputed}`);
console.log(`      published root ...................................... ${P.root}`);
console.log(`      match ............................................... ${rootMatchesProof ? 'YES' : 'NO'}`);

if (!rootMatchesProof) {
  console.log('\n  VERDICT: REFUTED — the proof path does not produce the published root.\n');
  process.exit(1);
}

if (offline) {
  console.log('\n  VERDICT: INDETERMINATE (--offline) — path is internally consistent,');
  console.log('  but the root was not read from the chain, so inclusion in a sealed');
  console.log('  epoch is unverified. Not green.\n');
  process.exit(3);
}

// ---- step 3: read the anchor off the chain ourselves ----
// Selector derived with our own keccak rather than copied from a block explorer.
const SIG = 'epoch(uint64)';
const selector = keccak256Utf8(SIG).slice(0, 10);
const calldata = selector + BigInt(P.epoch_id).toString(16).padStart(64, '0');
console.log('');
console.log(`  [3] eth_call ${SIG} -> selector ${selector}`);
console.log(`      rpc: ${RPC}`);

(async () => {
  let res;
  try {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: P.l1.contract, data: calldata }, 'latest'] }),
      signal: AbortSignal.timeout(30000),
    });
    res = await r.json();
  } catch (e) {
    console.log(`      rpc unreachable: ${e.message}`);
    console.log('\n  VERDICT: INDETERMINATE — the chain read did not complete.');
    console.log('  An unreachable RPC is not evidence that the anchor is absent.\n');
    process.exit(3);
  }
  if (res.error || !res.result || res.result === '0x') {
    console.log(`      rpc returned: ${JSON.stringify(res.error || res.result)}`);
    console.log('\n  VERDICT: INDETERMINATE — the contract returned no decodable value.\n');
    process.exit(3);
  }

  const words = res.result.replace(/^0x/, '').match(/.{64}/g) || [];
  const onChainRoot = '0x' + words[0];
  const onChainCount = BigInt('0x' + (words[1] || '0'));
  console.log(`      factsRoot  (word 0) ................................. ${onChainRoot}`);
  console.log(`      factsCount (word 1) ................................. ${onChainCount}`);

  const rootMatchesChain = BigInt(onChainRoot) === BigInt(recomputed);
  const countMatches = onChainCount === BigInt(P.leaf_count);
  console.log(`      root matches our recomputation ...................... ${rootMatchesChain ? 'YES' : 'NO'}`);
  console.log(`      leaf count matches the proof ........................ ${countMatches ? 'YES' : 'NO'}`);

  console.log('');
  if (rootMatchesChain && countMatches) {
    console.log('  VERDICT: GREEN — established.');
    console.log(`  Fact ${P.fact_hash.slice(0, 12)}… is a leaf of the tree whose root is`);
    console.log(`  anchored at ${P.l1.contract} on chain ${P.l1.chain_id}, epoch ${P.epoch_id}.`);
    console.log('  Recomputed with a hand-written keccak256 sharing no code with the');
    console.log('  publisher\'s tooling or with the second implementation that replayed it.');
    console.log('');
    console.log('  Scope of this green, stated so it cannot be over-read: inclusion in a');
    console.log('  sealed epoch. NOT the soundness of the STARK proof the fact attests,');
    console.log('  and NOT the truth of anything the underlying batch describes.');
    console.log('');
    process.exit(0);
  }
  console.log('  VERDICT: REFUTED — the on-chain root does not match the recomputed root.\n');
  process.exit(1);
})();
