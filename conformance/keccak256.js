'use strict';
/*
 * keccak256 — pure JavaScript, zero dependencies, Node stdlib not even required.
 *
 * Node's crypto ships 'sha3-256', which is NOT keccak256: SHA-3 pads with 0x06,
 * original Keccak pads with 0x01, and the two produce entirely different digests
 * for the same input. Anything that reads an Ethereum Merkle tree needs the
 * latter. Rather than take a dependency to cross-check someone else's arithmetic
 * — which would defeat the purpose of cross-checking it — this is written out.
 *
 * Reference-grade, not business-grade: BigInt lanes, optimised for being read and
 * trusted rather than for speed. Self-tested against three known-answer vectors
 * (see selftest() at the bottom, run it with `node keccak256.js`).
 *
 * Apache-2.0, matching the licence of the pure-python keccak that @goun7 published
 * on x402#3389 for the same reason. Two independent implementations agreeing on a
 * digest is worth more than either one of them being fast.
 */

const M = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & M;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    // rho + pi
    let x = 1, y = 0, current = A[1];
    for (let t = 0; t < 24; t++) {
      const nx = y, ny = (2 * x + 3 * y) % 5;
      const idx = nx + 5 * ny;
      const tmp = A[idx];
      A[idx] = rotl(current, BigInt((((t + 1) * (t + 2)) / 2) % 64));
      current = tmp;
      x = nx; y = ny;
    }
    // chi
    for (let yy = 0; yy < 5; yy++) {
      const row = new Array(5);
      for (let xx = 0; xx < 5; xx++) row[xx] = A[xx + 5 * yy];
      for (let xx = 0; xx < 5; xx++) A[xx + 5 * yy] = row[xx] ^ ((~row[(xx + 1) % 5] & M) & row[(xx + 2) % 5]);
    }
    // iota
    A[0] ^= RC[round];
  }
  return A;
}

const RATE = 136; // 1088 bits, the keccak256 rate

/** @param {Uint8Array} msg @returns {Uint8Array} 32 bytes */
function keccak256(msg) {
  // pad10*1 with the ORIGINAL keccak domain byte 0x01 (SHA-3 would use 0x06).
  const padLen = RATE - (msg.length % RATE);
  const buf = new Uint8Array(msg.length + padLen);
  buf.set(msg, 0);
  buf[msg.length] = 0x01;
  buf[buf.length - 1] |= 0x80;

  const A = new Array(25).fill(0n);
  for (let off = 0; off < buf.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(buf[off + i * 8 + b]); // little-endian lane
      A[i] ^= lane;
    }
    keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

const toHex = (u8) => '0x' + Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => {
  const s = h.replace(/^0x/, '');
  if (s.length % 2) throw new Error('odd-length hex');
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16);
  return u;
};
const keccak256Hex = (h) => toHex(keccak256(fromHex(h)));
const keccak256Utf8 = (s) => toHex(keccak256(new TextEncoder().encode(s)));

// ---- known-answer vectors ----
const KAT = [
  ['', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  ['The quick brown fox jumps over the lazy dog',
   '0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15'],
];

function selftest(log = false) {
  let ok = true;
  for (const [msg, want] of KAT) {
    const got = keccak256Utf8(msg);
    const pass = got === want;
    ok = ok && pass;
    if (log) console.log(`  ${pass ? 'PASS' : 'FAIL'}  keccak256(${JSON.stringify(msg).slice(0, 28)}) = ${got}`);
  }
  return ok;
}

module.exports = { keccak256, keccak256Hex, keccak256Utf8, toHex, fromHex, selftest, KAT };

if (require.main === module) {
  console.log('\n  keccak256.js — known-answer self-test\n');
  const ok = selftest(true);
  console.log(`\n  ${ok ? 'all vectors match' : 'MISMATCH'}\n`);
  process.exit(ok ? 0 : 1);
}
