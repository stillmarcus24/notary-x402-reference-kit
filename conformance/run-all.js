#!/usr/bin/env node
'use strict';
/*
 * One command, both suites, one scoreboard.
 *
 *   node run-all.js
 *   node run-all.js --record-adapter ./mine.js --triple-adapter ./mine-triple.js
 *
 * Exit 0 iff everything passed. Zero dependencies, no network.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const argv = process.argv.slice(2);
function opt(name) { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; }

const runs = [
  { label: 'digest triple (x402#3389)', script: 'run.js', adapter: opt('--triple-adapter') },
  { label: 'evidence record (x402#2887)', script: 'run-record.js', adapter: opt('--record-adapter') },
];

let anyFail = false;
const lines = [];
for (const r of runs) {
  const args = [path.join(__dirname, r.script)];
  if (r.adapter) args.push('--adapter', r.adapter);
  const out = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const txt = (out.stdout || '') + (out.stderr || '');
  if (out.status !== 0) anyFail = true;
  const m = txt.match(/(?:result\s+:|TOTAL\s+:)\s*(\d+)\/(\d+)/);
  lines.push({ label: r.label, adapter: r.adapter || 'bundled reference',
    score: m ? `${m[1]}/${m[2]}` : '?', ok: out.status === 0, body: txt });
}

console.log('');
console.log('  x402 conformance — scoreboard');
console.log('  ' + '-'.repeat(62));
for (const l of lines) {
  console.log(`  ${l.ok ? 'PASS' : 'FAIL'}  ${l.score.padStart(6)}  ${l.label}`);
  console.log(`                ${l.adapter}`);
}
console.log('  ' + '-'.repeat(62));
console.log('');
for (const l of lines) {
  if (!l.ok) { console.log(`  --- ${l.label} ---`); console.log(l.body.replace(/^/gm, '  ')); }
}
process.exit(anyFail ? 1 : 0);
