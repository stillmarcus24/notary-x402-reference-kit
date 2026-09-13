#!/usr/bin/env node
'use strict';
/*
 * canonical-bytes-lab.js — where do two independent serializers disagree?
 *
 *   node canonical-bytes-lab.js
 *   node canonical-bytes-lab.js --verbose
 *
 * StillOS's receipt preimage is `JSON.stringify(core)`. Any reimplementation in
 * another language must produce byte-identical output or every digest diverges,
 * and nobody will have attacked SHA-256 to make that happen — the serialization
 * semantics are the vulnerability.
 *
 * So: take one JSON text, parse and re-serialize it compactly under two genuinely
 * independent implementations (V8's JSON, CPython's json), digest both, and report
 * every disagreement. No expected outputs are written by hand. The cases are chosen
 * to sit on structural cliffs — the IEEE-754 exact-integer boundary, exponent
 * formatting thresholds, signed zero, Unicode composition, duplicate keys — because
 * bugs cluster at discontinuities, not at random points.
 *
 * Read the results carefully in BOTH directions:
 *   - DISAGREE means at least one implementation is wrong for this protocol.
 *   - AGREE does NOT mean correct. Duplicate keys are the example: both keep the
 *     last occurrence, both are wrong under RFC 8785 (which requires rejection),
 *     and their agreement is precisely what makes it dangerous.
 */

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ---- the cases: raw JSON TEXT, not objects. The bytes are the input. ----
const CASES = [
  // key order — the thing StillOS's insertion-order preimage actually depends on
  ['key-order-a',            '{"agent":"a","ts":"t","amount":1}'],
  ['key-order-b',            '{"ts":"t","amount":1,"agent":"a"}'],

  // duplicate keys — RFC 8785 says REJECT. Watch them agree on not rejecting.
  ['duplicate-key',          '{"payee":"0xGOOD","payee":"0xEVIL"}'],
  ['duplicate-key-3x',       '{"n":1,"n":2,"n":3}'],

  // absence vs emptiness vs null
  ['missing-field',          '{"a":1}'],
  ['null-field',             '{"a":1,"b":null}'],
  ['empty-string-field',     '{"a":1,"b":""}'],

  // IEEE-754 exact-integer cliff
  ['int-2^53-1',             '{"n":9007199254740991}'],
  ['int-2^53',               '{"n":9007199254740992}'],
  ['int-2^53+1',             '{"n":9007199254740993}'],
  ['int-big-uint64',         '{"n":18446744073709551615}'],

  // exponent-notation thresholds
  ['num-1e20',               '{"n":1e20}'],
  ['num-1e21',               '{"n":1e21}'],
  ['num-999...9e5',          '{"n":999999999999999900000}'],
  ['num-1e-6',               '{"n":0.000001}'],
  ['num-1e-7',               '{"n":0.0000001}'],
  ['num-9.999999999999997e-7','{"n":9.999999999999997e-7}'],

  // signed zero and integer-valued floats
  ['num-neg-zero',           '{"n":-0}'],
  ['num-zero',               '{"n":0}'],
  ['num-one-int',            '{"amount":1}'],
  ['num-one-float',          '{"amount":1.0}'],

  // amounts as strings — the shape record-vectors.json mandates, and the control
  ['amount-string',          '{"amount":"1"}'],

  // Unicode: composed vs decomposed. JCS forbids normalizing these together.
  ['unicode-nfc-e-acute',    '{"name":"é"}'],
  ['unicode-nfd-e-acute',    '{"name":"é"}'],
  ['unicode-escaped',        '{"name":"\\u00e9"}'],
  ['unicode-astral',         '{"name":"😀"}'],
  ['unicode-lone-surrogate-escaped', '{"name":"\\ud800"}'],

  // control characters and whitespace
  ['ctrl-tab-escaped',       '{"s":"a\\tb"}'],
  ['ctrl-newline-escaped',   '{"s":"a\\nb"}'],
  ['solidus-escaped',        '{"s":"a\\/b"}'],
  ['solidus-literal',        '{"s":"a/b"}'],

  // textual integer forms
  ['leading-zero-string',    '{"n":"007"}'],
  ['hex-lower-string',       '{"h":"abcdef"}'],
  ['hex-upper-string',       '{"h":"ABCDEF"}'],
  ['hex-0x-string',          '{"h":"0xabcdef"}'],
  ['newline-contaminated',   '{"h":"abcdef\\n"}'],
];

// ---- implementation A: V8 ----
function nodeSerialize(text) {
  const o = JSON.parse(text);
  return JSON.stringify(o);
}

// ---- implementation B: CPython ----
// One subprocess for the whole batch: per-case spawning dominated runtime and
// added nothing.
function pythonSerializeAll(texts) {
  // Each result is emitted as an ASCII-safe JSON string literal, one per line, and
  // parsed back on this side. Writing the raw serialization to stdout crashed the
  // whole batch on the lone-surrogate case (UnicodeEncodeError: surrogates not
  // allowed) — which is a finding about the protocol, not a harness detail, so the
  // harness has to survive long enough to record it rather than die on it.
  const prog = `
import sys, json
out = []
for line in sys.stdin.read().split("\\u0000"):
    if line == "": continue
    try:
        o = json.loads(line)
        s = json.dumps(o, separators=(",", ":"), ensure_ascii=False)
        try:
            s.encode("utf-8")
        except UnicodeEncodeError as e:
            out.append(json.dumps("\\u0001ERROR:UnicodeEncodeError(unrepresentable-in-utf8)"))
            continue
        out.append(json.dumps(s))
    except Exception as e:
        out.append(json.dumps("\\u0001ERROR:" + type(e).__name__))
sys.stdout.write("\\n".join(out))
`;
  const res = execFileSync('python3', ['-c', prog], { input: texts.join('\u0000'), encoding: 'utf8', maxBuffer: 1 << 24 });
  return res.split('\n').map(l => JSON.parse(l));
}

const verbose = process.argv.includes('--verbose');

const texts = CASES.map(c => c[1]);
let pyOut;
try { pyOut = pythonSerializeAll(texts); }
catch (e) { console.error('python3 unavailable: ' + e.message); process.exit(2); }

const rows = [];
CASES.forEach(([name, text], i) => {
  let a, aErr = null;
  try { a = nodeSerialize(text); } catch (e) { aErr = e.constructor.name; }
  let b = pyOut[i];
  let bErr = null;
  if (typeof b === 'string' && b.startsWith('\u0001ERROR:')) { bErr = b.slice(7+1); b = undefined; }
  const agree = aErr === null && bErr === null ? a === b : (aErr !== null && bErr !== null);
  rows.push({ name, text, a, b, aErr, bErr, agree });
});

console.log('');
console.log('  canonical bytes lab — V8 JSON vs CPython json, compact re-serialization');
console.log('  ' + '-'.repeat(76));
const disagree = rows.filter(r => !r.agree);
for (const r of rows) {
  if (!r.agree || verbose) {
    console.log(`  ${r.agree ? 'agree   ' : 'DISAGREE'}  ${r.name}`);
    console.log(`             in   ${r.text}`);
    console.log(`             node ${r.aErr ? '<' + r.aErr + '>' : r.a}`);
    console.log(`             py   ${r.bErr ? '<' + r.bErr + '>' : r.b}`);
    if (!r.agree && !r.aErr && !r.bErr) {
      console.log(`             sha  node ${sha(r.a).slice(0, 16)}…  py ${sha(r.b).slice(0, 16)}…`);
    }
  }
}
console.log('  ' + '-'.repeat(76));
console.log(`  ${rows.length} cases · ${rows.length - disagree.length} agree · ${disagree.length} DISAGREE`);
console.log('');

// ---- the collisions that matter even when both implementations agree ----
const byDigestNode = new Map();
for (const r of rows) {
  if (r.aErr) continue;
  const d = sha(r.a);
  if (!byDigestNode.has(d)) byDigestNode.set(d, []);
  byDigestNode.get(d).push(r.name);
}
const collisions = [...byDigestNode.values()].filter(v => v.length > 1);
if (collisions.length) {
  console.log('  Distinct inputs that serialize to the SAME digest under V8:');
  for (const c of collisions) console.log('    ' + c.join('  ==  '));
  console.log('');
  console.log('  Each line is a pair of different JSON texts a signature cannot tell apart.');
  console.log('  Whether that is acceptable is a protocol decision, not a parser detail:');
  console.log('  if two texts mean different things to a human or a court, a commitment');
  console.log('  that maps them to one digest cannot be used to prove which was agreed.');
  console.log('');
}
process.exit(disagree.length ? 1 : 0);
