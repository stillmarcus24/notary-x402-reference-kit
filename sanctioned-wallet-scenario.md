# Scenario: "Your x402 agent just paid a sanctioned wallet. Now what?"

(Title borrowed from the DEV.to piece flagging this exact gap — it's the
plainest public statement of the problem this kit answers.)

## The gap

x402's protocol layer checks payment mechanics: signature validity, correct
settlement, on-chain finality. It does not check who `payTo` actually is. An
agent resolving a `402` response and paying it has no built-in way to know if
that address belongs to a sanctioned entity, a scam operation, or a
legitimate seller — the same due-diligence step a human procurement team
would run, but agents transact at a volume (dozens of new counterparties per
workflow) where a human-speed check doesn't scale.

## The pre-payment check, live today

Before an agent settles an x402 payment, it can call the notary as a
pre-flight step:

```
POST /notary/screen-text
{ "agent": "buyer-agent-id", "text": "<the 402 response's offer/description text>" }
→ { "unsafe": true, "category_code": "S2", "category_label": "...", signed receipt }
```

```
POST /notary/un-sanctions   (or /eu-sanctions, /colombia-siri, /mexico-sanctioned-officials)
{ "agent": "buyer-agent-id", "entity": "<payTo address or associated name>" }
→ { match: bool, source: "UN Consolidated List" | ..., signed receipt }
```

Both return a signed, hash-chained receipt (see `example-receipt-chain.json`)
— the agent (or the marketplace/facilitator wrapping it) now has a portable,
independently-verifiable record of "this counterparty was screened, here's
the verdict, here's who signed it and against what source," attached to the
same payment before funds move.

## If it goes bad anyway

If a claim tied to a payment resolves false after the fact — a paid-for
deliverable turns out to be a different thing than what was represented, and
that thing has a real external source-of-record to check it against — the
counterparty (or a third-party auditor) can file:

```
POST /notary/dispute
{ "receipt_hash": "<the original verdict receipt's hash>", "counter_evidence": "..." }
```

This triggers an independent re-run of the original resolver against the
same named source. If the re-run overturns the original verdict, the bond
(`live-bond-status.json`, real USDC on Base, independently checkable on-chain)
pays out on-chain, and the payout is appended to a public slash log. This is
the "paid and false/slashed" state 0xbrainkid named in the original thread as
the trap that must not collapse into "payment failed" — it doesn't, here,
because it's tracked as its own terminal state end to end.

## What this is not

This is not a chargeback mechanism for "I don't like what I bought." It's
scoped to deterministic, externally-checkable claims — a sanctioned-entity
match against a named list, a scam-content classification against a stated
model/version, a claim with a real source-of-record. Subjective "was this
service good" disputes are a different problem (see GenLayer's Internet
Court) and out of scope here by design — see `live-bond-status.json`'s
`slash_policy` field for the exact boundary.
