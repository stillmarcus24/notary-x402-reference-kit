'use strict';
// The artifact we hand to strangers: verify-offline-pinned.js, zero network calls.
const V = require('../../verify-offline-pinned.js');
module.exports = {
  NAME: 'published verify-offline-pinned.js',
  verdict: (r) => V.verifyReceipt(r).checks.hash_intact,
};
