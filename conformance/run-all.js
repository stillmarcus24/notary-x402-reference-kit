#!/usr/bin/env node
'use strict';
/*
 * One command, both suites, one scoreboard.
 *
 *   node run-all.js                                  # both suites, bundled reference
 *   node run-all.js --adapter ./mine.js              # your file for BOTH suites
 *   node run-all.js --record-adapter ./mine.js       # your file for one suite
 *   node run-all.js --triple-adapter ./mine-triple.js
 *
 * Exit 0 iff everything passed. Zero dependencies, no network.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE REFUSES UNKNOWN FLAGS
 *
 * The first version parsed only --record-adapter/--triple-adapter and silently
 * ignored anything else. `node run-all.js --adapter ./mine.js` — the obvious
 * spelling, and the one our own write-up told people to run — therefore scored
 * the BUNDLED REFERENCE, printed PASS 8/8 and 22/22, and exited 0. A stranger
 * following the instructions got a green scoreboard for code that was never
 * loaded.
 *
 * That is the same class of defect the suites themselves exist to catch: a
 * result that looks conformant for a reason unrelated to conformance. So this
 * runner now fails closed. An unrecognised flag is an error, an adapter path
 * that does not resolve is an error, and an adapter that does not export what a
 * suite requires is reported as NOT RUN for that suite — never silently
 * substituted with the reference.
 * ---------------------------------------------------------------------------
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const KNOWN_FLAGS = new Set([
  '--adapter', '--record-adapter', '--triple-adapter',
  '--verbose', '--json', '--help', '-h',
]);
const TAKES_VALUE = new Set(['--adapter', '--record-adapter', '--triple-adapter']);

const USAGE = `
  node run-all.js                              both suites, bundled reference
  node run-all.js --adapter ./mine.js          your file for both suites
  node run-all.js --record-adapter ./mine.js   evidence record (x402#2887) only
  node run-all.js --triple-adapter ./mine.js   digest triple  (x402#3389) only
  node run-all.js --verbose                    per-case lines, not just failures
`;

function die(msg) {
  console.error(`\n  run-all.js: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

// ---- argument parsing that fails closed ----
const argv = process.argv.slice(2);
const opts = {};
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('-')) die(`unexpected argument "${a}" (adapters are passed with a flag)`);
  if (!KNOWN_FLAGS.has(a)) die(`unknown flag "${a}"`);
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  if (TAKES_VALUE.has(a)) {
    const v = argv[i + 1];
    if (v === undefined) die(`${a} requires a path`);
    if (v.startsWith('-')) die(`${a} requires a path, got the flag "${v}"`);
    opts[a] = v;
    i++;
  } else {
    passthrough.push(a);
  }
}

// ---- adapter resolution: a named adapter must actually load and export ----
function resolveAdapter(flag, p, required) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) die(`${flag}: no such file: ${abs}`);
  let mod;
  try { mod = require(abs); }
  catch (e) { die(`${flag}: ${abs} failed to load: ${e.message}`); }
  const missing = required.filter(fn => typeof mod[fn] !== 'function');
  return { path: abs, name: mod.NAME || path.basename(abs), missing };
}

const runs = [
  {
    label: 'digest triple (x402#3389)',
    script: 'run.js',
    flag: opts['--triple-adapter'] ? '--triple-adapter' : (opts['--adapter'] ? '--adapter' : null),
    given: opts['--triple-adapter'] || opts['--adapter'] || null,
    explicit: !!opts['--triple-adapter'],
    required: ['validate', 'storedValue', 'limbs'],
  },
  {
    label: 'evidence record (x402#2887)',
    script: 'run-record.js',
    flag: opts['--record-adapter'] ? '--record-adapter' : (opts['--adapter'] ? '--adapter' : null),
    given: opts['--record-adapter'] || opts['--adapter'] || null,
    explicit: !!opts['--record-adapter'],
    required: ['verifyRecord', 'settlementCheck'],
  },
];

// StillOS's own adapters, so a default run can never report only the reference.
const STILLOS = {
  'run.js': './stillos_triple_adapter.js',
  'run-record.js': './stillos_adapter.js',
};
const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'stillos-baseline.json'), 'utf8'));

function score(script, adapterPath) {
  const args = [path.join(__dirname, script)];
  if (adapterPath) args.push('--adapter', adapterPath);
  const out = spawnSync(process.execPath, [...args, ...passthrough], { encoding: 'utf8' });
  const txt = (out.stdout || '') + (out.stderr || '');
  const m = txt.match(/(?:result\s+:|TOTAL\s+:)\s*(\d+)\/(\d+)/);
  return { score: m ? `${m[1]}/${m[2]}` : '?', ok: out.status === 0, body: txt };
}

let anyFail = false;
const lines = [];
const stillosLines = [];
for (const r of runs) {
  if (!r.given) {
    // No adapter named for this suite. Score the reference — AND score StillOS,
    // always.
    //
    // The previous default printed only the reference's PASS 8/8 / 22/22. Nothing
    // in that output was false, and it was still misleading: a plain `node
    // run-all.js` in a repository called "the StillOS reference kit" reads as
    // StillOS being green, when it says nothing whatsoever about StillOS. The
    // publish gate ran exactly that command. A scoreboard whose most likely
    // misreading is flattering to its author is a defect in the scoreboard.
    const ref = score(r.script, null);
    if (!ref.ok) anyFail = true;
    lines.push({ label: r.label, adapter: 'bundled reference', score: ref.score,
      state: ref.ok ? 'PASS' : 'FAIL', body: ref.body });

    const sPath = STILLOS[r.script];
    if (sPath && fs.existsSync(path.resolve(__dirname, sPath))) {
      const s = score(r.script, path.resolve(__dirname, sPath));
      const expected = BASELINE[r.label];
      const drifted = expected && s.score !== expected;
      if (drifted) anyFail = true;
      stillosLines.push({ label: r.label, score: s.score, expected, drifted });
    }
    continue;
  }

  const a = resolveAdapter(r.flag, r.given, r.required);
  if (a.missing.length) {
    // Named but incapable. Under --adapter (both suites) this is expected for a
    // single-suite implementation and is reported, not scored. Under an explicit
    // per-suite flag the caller asserted it implements that suite, so it is an error.
    anyFail = anyFail || r.explicit;
    lines.push({ label: r.label, adapter: `${a.name} — does not export ${a.missing.join('(), ')}()`,
      score: '—', state: 'NOT RUN', body: '' });
    continue;
  }

  const out = spawnSync(process.execPath, [path.join(__dirname, r.script), '--adapter', a.path, ...passthrough], { encoding: 'utf8' });
  const txt = (out.stdout || '') + (out.stderr || '');
  if (out.status !== 0) anyFail = true;
  const m = txt.match(/(?:result\s+:|TOTAL\s+:)\s*(\d+)\/(\d+)/);
  lines.push({ label: r.label, adapter: a.name, score: m ? `${m[1]}/${m[2]}` : '?',
    state: out.status === 0 ? 'PASS' : 'FAIL', body: txt });
}

console.log('');
console.log('  x402 conformance — scoreboard');
console.log('  ' + '-'.repeat(62));
for (const l of lines) {
  console.log(`  ${l.state.padEnd(7)} ${l.score.padStart(6)}  ${l.label}`);
  console.log(`                  ${l.adapter}`);
}
console.log('  ' + '-'.repeat(62));

if (stillosLines.length) {
  console.log('');
  console.log('  STILLOS — our own real implementation, measured, not asserted');
  console.log('  ' + '-'.repeat(62));
  for (const s of stillosLines) {
    const note = s.drifted ? `  <-- DRIFT, baseline says ${s.expected}` : (s.expected ? `  (baseline ${s.expected})` : '');
    console.log(`  ${s.score.padStart(13)}  ${s.label}${note}`);
  }
  console.log('  ' + '-'.repeat(62));
  console.log('  The reference passing says nothing about StillOS. These two rows are');
  console.log('  the only ones that do. Exit is non-zero if either drifts from the');
  console.log('  measured baseline in stillos-baseline.json — in either direction.');
}
console.log('');
for (const l of lines) {
  if (l.state === 'FAIL' && l.body) { console.log(`  --- ${l.label} ---`); console.log(l.body.replace(/^/gm, '  ')); }
}
process.exit(anyFail ? 1 : 0);
