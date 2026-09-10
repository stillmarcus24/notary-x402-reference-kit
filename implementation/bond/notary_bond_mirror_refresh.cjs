'use strict';
// Keeps sites/nolawealth-site/proof/bond.json (the public static mirror of
// the live /notary/bond status) honest. Found live 2026-08-02: this file had
// zero regeneration mechanism -- written once at bond launch (2026-07-12,
// active:true, $14.30) and never touched again, so it silently asserted an
// active bond for weeks after the shared wallet drained to $0. The real
// source of truth is core/notary_bond.cjs's live on-chain read via
// GET /notary/bond; this script just keeps the static fallback in sync with
// it instead of letting it drift into a standing false claim again.
const fs = require('fs');
const path = require('path');
const TARGET = '/home/marcus/sites/nolawealth-site/proof/bond.json';

require('/home/marcus/core/notary_bond.cjs').getSignedStatus()
  .then((status) => {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.writeFileSync(TARGET, JSON.stringify(status, null, 2));
    console.log(`[notary-bond-mirror] refreshed: active=${status.active} onchain_balance_usd=${status.onchain_balance_usd}`);
  })
  .catch((e) => { console.error('[notary-bond-mirror] refresh failed:', e.message); process.exit(1); });
