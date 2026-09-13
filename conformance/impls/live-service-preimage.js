'use strict';
// The LIVE notary service's preimage rule, transcribed verbatim from
// core/notary_service_marcus.cjs::receiptPreimage() (line 1671). Kept as a
// standalone transcription on purpose: importing the service would make this a
// test of one implementation against itself, which proves nothing.
const crypto = require('crypto');
function receiptPreimage(r) {
  return JSON.stringify({
    agent: r.agent, claim_sha256: r.claim_sha256, ts: r.ts,
    prev_hash: r.prev_hash, notary_fp: r.notary_fp,
    ...(r.resolver_hash ? { resolver_hash: r.resolver_hash } : {}),
    ...(r.reasoning_trace_hash ? { reasoning_trace_hash: r.reasoning_trace_hash } : {}),
    ...(r.drand_round ? { drand_round: r.drand_round, drand_randomness: r.drand_randomness } : {}),
  });
}
module.exports = {
  NAME: 'live service receiptPreimage()',
  verdict: (r) => crypto.createHash('sha256').update(receiptPreimage(r)).digest('hex') === r.receipt_hash,
};
