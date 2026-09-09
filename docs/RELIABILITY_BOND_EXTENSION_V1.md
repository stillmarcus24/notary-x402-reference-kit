# Bonded Reliability Attestation — a proposed optional extension to `io.glimind/reliability`

**Status:** proposal, with a live reference implementation. Not endorsed by Glimind.
**Target:** `io.glimind/reliability` v0.2 (`standards-track-draft`, CC-BY-4.0).
**Author:** StillOS Digital Holdings. **Date:** 2026-09-09.

This document proposes one optional object. It changes no existing field, breaks no
existing consumer, and is inert unless an emitter chooses to populate it.

## The gap

`io.glimind/reliability` v0.2 already solves *attribution*. Every rating carries an
Ed25519 compact-JWS verifiable against a published JWKS, so a consumer can prove **who
asserted a verdict** and that it has not been altered. That is the right foundation and
this proposal does not touch it.

What the schema does not model is *consequence*. Searching the published descriptor for
`bond`, `stake`, `slash`, `collateral`, `escrow`, `recourse`, and `penalty` returns
nothing (checked 2026-09-09 against `https://glimind.com/.well-known/reliability.json`).

A signature proves an assertion is authentic. It does not make the asserter **wrong at a
cost**. Today a rater whose verdict is confidently incorrect — `healthy` on a tool that is
down, `avoid` on a competitor that is fine — bears no mechanical penalty. The consumer's
only recourse is reputational, which is slow, contested, and unavailable to an autonomous
agent making a routing decision in one round-trip.

This matters most for the exact consumer the standard is written for. A human can
discount a source over months. An agent choosing between two tools in 40ms cannot. It
needs a machine-checkable answer to: *what does this rater lose if this rating is wrong?*

## The proposal: an optional `bond` object

```json
{
  "toolId": "io.github.stillmarcus24/stillos-notary-mcp",
  "verdict": "unknown",
  "recommendation": "unknown",

  "bond": {
    "posture": "self-bonded",
    "network": "base",
    "asset": "USDC",
    "assetContract": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "wallet": "0x6243E363a3047173346Fa49C947Db204D4445634",
    "custody": "gnosis-safe-2of2",
    "bondedAmount": "10.00",
    "maxPayoutPerClaim": "1.00",
    "currency": "USD",
    "policyHash": "2b6aed8c714420922af29b84e429c4d19006195ffb78700f84fe431025ef39d0",
    "disputeEndpoint": "https://nolawealthfinancial.com/notary/dispute",
    "statusEndpoint": "https://nolawealthfinancial.com/notary/bond",
    "slashCount": 0,
    "verify": "Call USDC.balanceOf(wallet) on Base mainnet at assetContract. The bond is live only while that balance >= bondedAmount. Do not trust this field; read the chain."
  }
}
```

### Field semantics

| field | meaning |
|---|---|
| `posture` | `self-bonded` (the emitter stakes its own capital on its own assertions), `third-party-bonded` (an independent underwriter stakes), or `unbonded` (explicit, honest null case) |
| `wallet` / `network` / `assetContract` | enough to independently read the balance without contacting the emitter |
| `custody` | how the collateral is held. Material to a consumer: single-key custody means the emitter can move the stake unilaterally and instantly; multisig means it cannot |
| `bondedAmount` | the committed ceiling — **not** the wallet balance. The balance is read from chain and may exceed or fall below it |
| `maxPayoutPerClaim` | per-claim cap, so a consumer can price its own exposure |
| `policyHash` | hash of the signed slash terms, so the terms cannot be quietly rewritten after a dispute is filed |
| `disputeEndpoint` | where a consumer actually files. A bond with no intake is decoration |
| `slashCount` | payouts made. **A non-zero value is a positive signal**: it proves the path is real and has executed |

### The rule that makes it non-decorative

**Every field must be verifiable without trusting the emitter.** The balance comes from
the chain. The terms are hash-committed and signed. The dispute path is a live endpoint a
consumer can exercise. An emitter that cannot satisfy that test should set
`posture: "unbonded"` rather than populate a bond it cannot back — an honest null is worth
more than an unverifiable claim, and the field exists partly so that "unbonded" becomes
sayable.

### What this does and does not prove

**Proves:** capital is committed, publicly readable, and governed by terms that cannot be
silently altered; a defined payout path exists and can be exercised.

**Does not prove:** that a rating is correct; that the emitter is solvent beyond the
bonded amount; that a dispute will be resolved in the claimant's favour; or that the
collateral cannot be withdrawn tomorrow. A consumer that needs those guarantees should
read `custody` and the chain directly and draw its own conclusion.

## Interaction with neutrality

Glimind's descriptor asserts `"neutral": true, "sellsTools": false`, and grounds the
value of its ratings in that unconflicted position. This extension is complementary,
not competing:

- A **neutral** rater is credible because it has no incentive to lie.
- A **bonded** rater is credible because lying costs it money.

They are strongest together and neither subsumes the other. Notably, a bond lets a
*conflicted* party — an operator rating its own service — say something meaningful, by
putting capital behind the claim rather than asking to be believed.

For that reason StillOS's own reliability report deliberately emits
`verdict: "unknown"`, `recommendation: "unknown"` and declines to self-rate: we are the
operator, so our verdict is worth nothing. What we can honestly offer is the bond.

## Reference implementation

Live, and the same bond that backs the notary's own verdicts:

- `https://stillos-notary-mcp-edge.stillos.workers.dev/.well-known/reliability.json`
- `https://stillos-kya-edge.stillos.workers.dev/.well-known/reliability.json`
- `https://stillos-edge-gate-edge.stillos.workers.dev/.well-known/reliability.json`

Independently checkable right now, without contacting StillOS:

```sh
# 1. the emitter's claim
curl https://stillos-notary-mcp-edge.stillos.workers.dev/.well-known/reliability.json

# 2. the collateral, read from chain, not from us
cast call 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 \
  "balanceOf(address)(uint256)" 0x6243E363a3047173346Fa49C947Db204D4445634 \
  --rpc-url https://mainnet.base.org

# 3. the signed terms and slash history
curl https://nolawealthfinancial.com/notary/bond
```

Prior art in the same lane, both independently reproduced by third parties:
`STILLOS_NOTARY_RECEIPT_V1` (frozen preimage spec, offline verifier, 1 positive + 6
negative vectors) and the x402 authority verifier kit, reproduced 39/39 in a
network-isolated container by an unaffiliated implementer.

## Licence

Offered under **CC-BY-4.0**, matching `io.glimind/reliability`, so it can be folded into
the standard directly with no licence friction. No attribution requirement beyond the
licence, and no endorsement of StillOS is sought or implied.
