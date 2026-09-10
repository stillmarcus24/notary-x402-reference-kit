# Bond path implementation

The code behind the on-chain correctness bond referenced in
`docs/FORESEAL_BILATERAL_TERMS_V1.md`: the bond record, the slash path, the
dispute resolver, and the monitors.

Published 2026-09-09 because every prior implementation pin in that document
(`38ad5fee`, `e63b3e9`, `0ee96f4`) resolved to a local repository with no
remote and therefore could not be fetched by a counterparty. A pin is only
meaningful if the object it names is public; those were not. This directory is
the correction.

## Files

| file | role |
|---|---|
| `notary_bond.cjs` | bond record, balance read, active/inactive state |
| `notary_bond_slash.cjs` | the slash path — adjudicated-overturn payout |
| `verdict_dispute.cjs` | dispute intake and independent re-run |
| `bond_monitor.cjs` | bond liveness monitor |
| `notary_bond_mirror_refresh.cjs` | mirror refresh for the published status file |

## Key material

None. `notary_bond_slash.cjs` reads a signing key at runtime from
`AGENT_WALLET_ENV` (default `/home/marcus/secrets/agent-wallet.env`) or from
`AGENT_WALLET_PRIVATE_KEY` in the process environment. No key, credential or
private endpoint appears in this repository.

## What this does not prove

Publishing the code shows what the slash path *does*. It does not by itself
demonstrate that the deployed service runs this exact revision. The pin in
`docs/FORESEAL_BILATERAL_TERMS_V1.md` names the tag these files were published
under; treat the tag as the frozen reference, not a branch head, which can move.

Custody note: collateral is held in a 2-of-2 Safe
(`0x6243E363a3047173346Fa49C947Db204D4445634`). A slash payout therefore
requires two human signatures and is not instant. The obligation to pay an
adjudicated overturn is unchanged; custody governs who may move collateral, not
whether it is owed.
