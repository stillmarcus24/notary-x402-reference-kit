#!/usr/bin/env node
'use strict';
/*
 * Deterministic consistency check: canonical manifest ⇄ human documents.
 *
 * Scope is deliberately narrow. This is NOT a general CI framework and is not
 * trying to validate the whole package. It covers exactly the fields that ACTUALLY
 * DRIFTED between manifest/manifest.json and docs/FORESEAL_BILATERAL_TERMS_V1.md at
 * tag foreseal-bilateral-v1, plus the specific overclaims that were retracted. Every
 * assertion below corresponds to a real reproduced defect listed in SUPERSESSION.json.
 *
 * Run: node tools/check-consistency.cjs   (exit 0 = consistent)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const m = JSON.parse(read('manifest/manifest.json'));
const terms = read('docs/FORESEAL_BILATERAL_TERMS_V1_1.md');
const bondStatus = JSON.parse(read('live-bond-status.json'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const inTerms = (name, needle) => ok(name, terms.includes(needle), `terms missing: ${needle}`);
const notInTerms = (name, needle) => ok(name, !terms.includes(needle), `terms still contain: ${needle}`);

console.log('\nmanifest ⇄ human terms — fields that have drifted before\n');

// --- 1. manifest self-seal ---
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'manifest/manifest.json'))).digest('hex');
ok('manifest.sha256 matches manifest.json', read('manifest/manifest.sha256').trim().split(/\s+/)[0] === digest, digest);

// --- 2. published files exist and checksums are accurate ---
for (const [rel, sum] of Object.entries(m.parties.stillos.file_checksums_sha256)) {
  if (rel.startsWith('_')) continue;
  const abs = path.join(ROOT, rel);
  const exists = fs.existsSync(abs);
  ok(`published file present: ${rel}`, exists);
  if (exists) ok(`checksum accurate: ${rel}`, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') === sum);
}
// Only the path KEYS are checked; the _note deliberately quotes the old local paths
// in order to describe the defect being corrected.
const escaping = Object.keys(m.parties.stillos.file_checksums_sha256).filter(k => !k.startsWith('_') && k.includes('/home/'));
ok('no manifest path escapes this repository', escaping.length === 0,
  `${escaping.join(', ')} points outside the published repo — the v1 unfetchable-pin defect`);

// --- 3. wallet + custody agreement ---
inTerms('bond wallet matches manifest', m.bond.wallet);
inTerms('gas relayer matches manifest', m.wallets.stillos_gas_relayer.address);
inTerms('payTo wallet matches manifest', m.wallets.stillos_payto_wallet.address);
ok('bond wallet == custody safe address', m.bond.wallet === m.custody.safe_address);
ok('bond custody_type == custody type', m.bond.custody_type === m.custody.type);
ok('live-bond-status wallet == manifest bond wallet', bondStatus.wallet === m.bond.wallet, bondStatus.wallet);
ok('live-bond-status custody == manifest custody', bondStatus.custody_type === m.custody.type, bondStatus.custody_type);
for (const o of m.custody.owners) inTerms(`safe owner disclosed: ${o.address.slice(0, 10)}…`, o.address);
inTerms('custody classification stated', m.custody.classification);
ok('classification is one of the three permitted values',
  ['SINGLE_PERSON_MULTIDEVICE', 'MULTIPARTY', 'UNKNOWN'].includes(m.custody.classification), m.custody.classification);
ok('no owner is claimed independent without evidence',
  m.custody.classification !== 'MULTIPARTY' || m.custody.owners.some(o => o.attributable_from_stillos_records === false),
  'MULTIPARTY claimed while every owner is attributable to StillOS records');
ok('security and governance benefits stated separately',
  typeof m.custody.security_benefit === 'string' && typeof m.custody.counterparty_governance_benefit === 'string');

// --- 4. bond funding agreement ---
inTerms('observed balance matches manifest', String(m.bond.onchain_balance_observation.balance_usdc));
ok('bond active flag consistent with observation',
  m.bond.active === (m.bond.onchain_balance_observation.balance_usdc >= m.bond.publicly_committed_target_usd));
ok('live-bond-status balance == manifest observation',
  bondStatus.onchain_balance_usd === m.bond.onchain_balance_observation.balance_usdc);
ok('manifest does not still say unfunded',
  !/NOT YET FUNDED/i.test(JSON.stringify(m).replace(/"_correction[^"]*":"[^"]*"/g, '')),
  'stale unfunded language outside a correction note');

// --- 5. fees + resolver + signing ---
inTerms('settlement fee matches', String(m.fees.settlement_fee_usd.current));
inTerms('dispute fee matches', String(m.fees.dispute_fee_usd.amount));
inTerms('combined hard stop matches', String(m.exposure_caps.hard_stop_combined_usd));
inTerms('resolver target matches', m.resolver.settles_against);
inTerms('signing fingerprint matches', m.signing_identity.current_key_id_fingerprint);
inTerms('keyring endpoint matches', m.signing_identity.keyring_endpoint);
inTerms('dispute window matches', '48 hours');

// --- 6. slash semantics + SLA ---
inTerms('payout SLA status stated verbatim', m.payout_obligation.payout_sla.status);
ok('SLA is explicitly null when status says none',
  m.payout_obligation.payout_sla.status !== 'NO FROZEN PAYOUT SLA' || m.payout_obligation.payout_sla.committed_sla === null);
ok('overdue threshold is not labelled an SLA', m.payout_obligation.payout_sla.overdue_threshold_is_a_committed_sla === false);
inTerms('overdue threshold matches', String(m.payout_obligation.payout_sla.overdue_threshold_hours));
for (const s of m.payout_obligation.states) inTerms(`obligation state documented: ${s}`, s);
ok('obligation implementation is published',
  fs.existsSync(path.join(ROOT, m.payout_obligation.implementation)), m.payout_obligation.implementation);

// --- 7. RETRACTED CLAIMS — these must not reappear anywhere in the package ---
console.log('\nretracted claims must not reappear\n');
const pkg = ['docs/FORESEAL_BILATERAL_TERMS_V1_1.md', 'manifest/manifest.json', 'manifest/manifest.md',
  'live-bond-status.json', 'README.md', 'SUPERSESSION.json']
  .filter(p => fs.existsSync(path.join(ROOT, p)))
  .map(p => ({ p, body: read(p) }));

// The V1 document is retained verbatim as a historical artifact and is exempt: it
// carries these strings because it IS the record of what was wrong.
const banned = [
  ['bilateral REJECTED agreement', /Neither party will characterize a REJECTED outcome as a failed test/i],
  ['REJECTED equal-evidentiary-value claim', /REJECTED terminal state (?:is|carries)[^.]{0,60}(?:successful|same evidentiary value)/i],
  ['tag cannot drift overclaim', /so it cannot drift/i],
  ['retired domain', /nolawealthfinancial\.com/i],
  ['retired bond wallet as current bond wallet', /"stillos_bond_wallet"\s*:\s*\{\s*"address"\s*:\s*"0xA3a05818/i],
];
for (const [label, re] of banned) {
  for (const { p, body } of pkg) {
    // Allow the string inside an explicit correction/retraction context. A
    // SUPERSESSION.json "was" field is by definition a quotation of the defective
    // text — the point of the record is to preserve what was wrong, verbatim. The
    // assertion being tested is that the claim is not MADE anywhere, not that the
    // characters never appear.
    const hits = body.split('\n').filter(l => re.test(l) &&
      !/^\s*"was"\s*:/.test(l) &&
      !/retract|withdraw|corrected|_correction|V1 said|V1 claimed|previously|superseded|formerly|no longer|must not|banned/i.test(l));
    ok(`${label} absent from ${p}`, hits.length === 0, hits[0] && hits[0].trim().slice(0, 120));
  }
}

// --- 8. supersession record ---
if (fs.existsSync(path.join(ROOT, 'SUPERSESSION.json'))) {
  const s = JSON.parse(read('SUPERSESSION.json'));
  ok('supersession names previous tag', s.previous.tag === 'foreseal-bilateral-v1');
  ok('supersession pins previous resolved sha', /^[0-9a-f]{40}$/.test(s.previous.resolved_commit_sha));
  ok('supersession names new tag', s.new.tag === m.identification.release_tag);
  ok('supersession does not fabricate its own sha', s.new.resolved_commit_sha === null);
  ok('supersession states v1 remains available', s.previous.remains_published === true);
  ok('supersession lists corrected fields', Array.isArray(s.corrected_fields) && s.corrected_fields.length > 0);
  ok('supersession carries a content digest', /^[0-9a-f]{64}$/.test(s.supersession_hash || ''));
} else { fail++; console.log('  FAIL  SUPERSESSION.json missing'); }

// --- 9. BOND DISCLOSURE PARITY ACROSS EVERY SURFACE THAT MAKES THE CLAIM ---
//
// Why this exists (2026-09-14). @0rkz found that README.md still opened with the
// RETIRED bond wallet `0xA3a05818…` and "pays out on-chain", nine lines above a
// current, correct paragraph naming the 2-of-2 Safe and the absence of a payout
// SLA. One stale bullet sitting above a current one — and it is the bullet a
// reader hits first. The sibling audit that followed found the same unqualified
// payout claim in TWO more places, including `live-bond-status.json`'s
// `slash_policy`, which is MACHINE-READABLE and served to counterparties.
//
// That is the v1.1 root pattern for the third time: the prose gets corrected and
// the other surfaces carrying the same claim do not. Sections 3-6 above assert
// manifest ⇄ terms. Nothing asserted manifest ⇄ README, ⇄ scenario doc, or
// ⇄ live-bond-status prose. This closes that, generically:
//
//   (a) inside a paragraph that talks about the bond, the ONLY wallet address
//       permitted is the manifest's current bond wallet — so a retired address
//       cannot silently reappear as the current one, and this stays true when
//       the wallet rotates again without editing a hardcoded address here;
//   (b) any paragraph asserting a payout MUST carry the custody qualifier in
//       that same paragraph — a correct disclosure 27 lines away does not count,
//       because that is precisely the defect being fixed;
//   (c) no surface may assert a committed payout SLA while the manifest says
//       there is none;
//   (d) no surface may describe the bond's custody as unilateral/single-key.
console.log('\nbond disclosure parity — every surface that makes the claim\n');

const BOND_SURFACES = ['README.md', 'live-bond-status.json', 'sanctioned-wallet-scenario.md',
  'docs/FORESEAL_BILATERAL_TERMS_V1_1.md', 'manifest/manifest.md', 'implementation/bond/README.md']
  .filter(p => fs.existsSync(path.join(ROOT, p)));

// A "correction context" is exempt everywhere below, on the same principle as
// section 7: preserving what was wrong, verbatim, IS the evidence. The test is
// that the defective claim is not MADE, not that the characters never appear.
const CORRECTION = /retract|withdraw|corrected|_correction|previously|superseded|formerly|no longer|must not|banned|swept|retired|moved here|prior revision|V1 said|V1 claimed|at tag foreseal-bilateral-v1|"was"\s*:|reverts to/i;

const BOND_CTX  = /\bbond\b|\bslash|\bcollateral\b|correctness bond/i;
// Promissory claims only. "`PAID` is written after an on-chain payout is verified"
// describes a state machine; it does not promise anyone a payment, and demanding a
// custody qualifier there would be noise that trains people to ignore this check.
const PAYS      = /pays? out\b|is paid\b|paid up to|disputant is paid|payout is (?:made|sent|executed|automatic)/i;
const QUALIFIER = /2-of-2|2of2|two human signatures|second human signature|second signature|multisig|not instant|no committed payout sla|NO COMMITTED PAYOUT SLA|governed execution|requires a human/i;
const UNILATERAL= /unilateral|single-key|single key|hot wallet/i;
const FAKE_SLA  = /committed payout sla of|payout sla:\s*\d|guaranteed (?:payout|to pay) within|will pay within \d/i;

const BOND_WALLET = m.bond.wallet.toLowerCase();
// Declared non-bond wallets, plus the word that must appear alongside the address
// for it to be legible as that role rather than as the bond.
const OTHER_WALLETS = [
  { address: m.wallets.stillos_payto_wallet.address,  keyword: 'payTo|settlement|revenue|fee' },
  { address: m.wallets.stillos_gas_relayer.address,   keyword: 'gas relayer|gas\\b|relayer' },
].filter(w => w.address && w.address.toLowerCase() !== BOND_WALLET);
// The unit of assertion is the unit a reader consumes: one bullet, one table row,
// one prose paragraph, one JSON value. The defect @0rkz found WAS a single bullet
// sitting above a correct one, so blank-line paragraphs are too coarse — they let a
// stale bullet inherit the qualifier from a sibling bullet six lines away.
const paragraphs = (p, body) => p.endsWith('.json')
  ? Object.entries(JSON.parse(body)).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  : body.split(/\n\s*\n/).flatMap(para =>
      /^\s*[-*|]/m.test(para) ? para.split(/\n(?=\s*(?:[-*]\s|\|))/) : [para]);

for (const p of BOND_SURFACES) {
  const body = read(p);
  const paras = paragraphs(p, body);

  // (a) no non-current wallet presented inside a bond paragraph
  const strayWallets = [];
  for (const para of paras) {
    if (!BOND_CTX.test(para) || CORRECTION.test(para)) continue;
    for (const addr of (para.match(/0x[0-9a-fA-F]{40}/g) || [])) {
      // the USDC token contract is not a wallet claim
      if (addr.toLowerCase() === m.bond.token_contract.toLowerCase()) continue;
      if (addr.toLowerCase() === BOND_WALLET) continue;
      // A non-bond wallet the manifest declares (gas relayer, payTo) may appear in
      // a bond paragraph ONLY where the unit says which one it is or disclaims the
      // bond role. Being registered in the manifest is not enough on its own —
      // `0xA3a05818…` is a registered gas relayer AND was the retired bond wallet,
      // and it was exactly that ambiguity the README bullet exploited.
      const role = OTHER_WALLETS.find(w => w.address.toLowerCase() === addr.toLowerCase());
      if (role && (new RegExp(role.keyword, 'i').test(para) || /not the bond wallet/i.test(para))) continue;
      strayWallets.push(addr);
    }
  }
  ok(`${p}: bond paragraphs name only the current bond wallet`, strayWallets.length === 0,
    `${[...new Set(strayWallets)].join(', ')} appears in a bond paragraph; manifest bond wallet is ${m.bond.wallet}`);

  // (b) every payout assertion carries the custody qualifier in its own paragraph
  const unqualified = paras.filter(para =>
    BOND_CTX.test(para) && PAYS.test(para) && !QUALIFIER.test(para) && !CORRECTION.test(para));
  ok(`${p}: every payout claim is qualified in its own paragraph`, unqualified.length === 0,
    unqualified[0] && unqualified[0].trim().replace(/\s+/g, ' ').slice(0, 140));

  // (c) no invented SLA while the manifest says there is none
  if (m.payout_obligation.payout_sla.committed_sla === null) {
    const invented = paras.filter(para => FAKE_SLA.test(para) && !CORRECTION.test(para));
    ok(`${p}: asserts no committed payout SLA`, invented.length === 0,
      invented[0] && invented[0].trim().replace(/\s+/g, ' ').slice(0, 140));
  }

  // (d) custody never described as unilateral. A unit that ALSO names the 2-of-2
  // is drawing a comparison ("under single-key custody that was survivable; under
  // 2-of-2 the interval is unbounded"), not asserting unilateral control today.
  const uni = paras.filter(para => BOND_CTX.test(para) && UNILATERAL.test(para)
    && !QUALIFIER.test(para) && !CORRECTION.test(para));
  ok(`${p}: bond custody not described as unilateral/single-key`, uni.length === 0,
    uni[0] && uni[0].trim().replace(/\s+/g, ' ').slice(0, 140));
}

// The README is the first thing a reader hits, so it must positively state the
// two facts a counterparty is most likely to get wrong — not merely avoid denying them.
const readme = read('README.md');
ok('README states the current bond wallet', readme.includes(m.bond.wallet), m.bond.wallet);
ok('README states custody is 2-of-2', /2-of-2/.test(readme));
ok('README states there is no committed payout SLA', /no committed payout SLA/i.test(readme));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
