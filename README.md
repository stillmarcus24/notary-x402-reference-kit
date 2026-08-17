# StillOS Notary — Evidence Record Reference Kit

**[stillosdigitalholdings.com](https://stillosdigitalholdings.com)** — the company running the live notary this kit verifies.

Companion to [x402-foundation/x402#2887](https://github.com/x402-foundation/x402/issues/2887).
Everything here is independently runnable and independently verifiable — no
account, no API key, no trust required.

## What this answers

Two gaps that keep surfacing in public commentary on x402 as it scales into
agent commerce, both structural to the protocol by design, neither solved by
the spec itself:

1. **No sanctions/counterparty screening at the payment layer.** The protocol
   verifies payment mechanics (signature, settlement) but not who is on the
   other end of `payTo`. An agent can encounter dozens of new counterparties
   per workflow with no procurement team in the loop to catch a sanctioned or
   fraudulent one.
2. **No dispute mechanism.** x402 settlement is final by design — there is no
   chargeback, no reversal window, no built-in way to contest a paid claim
   that turns out false. That gap is why this GitHub thread exists in the
   first place.

The notary is a live, capitalized, running answer to both — not a proposal.
This kit lets you check that claim yourself instead of taking our word for it.

## What's in here

- **`https://nolawealthfinancial.com/notary/verify-live`** — the primary
  evidence, and it's not a file in this repo at all: it's a standing public
  page on the live notary itself. It re-reads the ENTIRE real receipt book
  (958 receipts as of 2026-07-20, not a sample) and re-verifies every
  signature and every chain link fresh, server-side, on every single page
  load — nothing cached, nothing pre-computed for this post. Machine-readable
  at `?format=json` for agents. It reports honestly, not just green-washed:
  of 958, all 958 are authentically signed and correctly chained (0 real
  failures); 129 early attestations (drand-randomness beacon receipts from
  2026-07-03) are separately flagged as signed under an extended schema the
  generic hash formula doesn't byte-for-byte reconstruct — real signed
  history, correctly labeled as a schema variant rather than hidden or
  miscounted as a failure. Refresh the page any time; the number re-verifies
  itself in real time against whatever's on disk at that moment.
- **`real-live-receipt-chain-preview.json` + `verify-live.js`** — an offline,
  point-in-time companion to the same evidence: the actual live notary's
  10-record free preview
  (`https://nolawealthfinancial.com/notary/export?preview=true`), fetched
  live, verified against the actual production public key served live at
  `https://nolawealthfinancial.com/notary/health`. Run `node verify-live.js`
  — zero dependencies, hardcodes nothing but the fetched data and the
  publicly-served key. Useful if you want a static artifact to check offline;
  the live page above is the standing, always-current version of the same
  check.
- **`example-receipt-chain.json` + `verify.js`** — a synthetic companion
  example (fresh, disposable keypair, not the production key) built with the
  *exact* schema the live notary uses (`core/notary_recovery_signer.cjs`'s
  `commit()`), included to show the claim→resolved-verdict shape in isolation
  without needing to parse a real multi-agent history. The real chain above
  is the one that actually matters.
- **`live-bond-status.json`** — a live snapshot of the actual correctness
  bond: a real, self-custodied USDC bond on Base mainnet
  (`0xA3a05818d4051BFa759Fb7D936b57C072e4E0Caf`) that pays out on-chain if a
  disputed verdict is overturned on re-run against its named source-of-record.
  Independently checkable via `USDC.balanceOf(wallet)` on Base — don't trust
  the file, check the chain.
- **`sanctioned-wallet-scenario.md`** — walks the exact "agent about to pay a
  sanctioned wallet" scenario end to end against the live, already-deployed
  screening endpoints.

## Why this is a different layer than dispute-resolution-by-LLM-jury

Other efforts in this space (e.g. GenLayer's Internet Court) resolve
*subjective* disagreements — "did I get what I paid for" — via a panel of
LLMs voting on evidence. That's a real and complementary tool. The notary
targets the *objective* layer underneath it: is this counterparty sanctioned,
is this content a scam, and — for claims with a genuine external
source-of-record — was the paid claim actually true, backed by a real
economic bond, not a quorum vote. Different failure mode, different
mechanism, same evidence-record substrate this thread is discussing.

## Live endpoints referenced (already deployed, not roadmap)

- `POST /notary/screen-url` — real-time URL safety scan (malicious/phishing
  verdict + page metadata), signed receipt.
- `POST /notary/screen-text` — real-time scam/phishing/harmful-content text
  classifier, signed receipt.
- `POST /notary/un-sanctions`, `/eu-sanctions`, `/colombia-siri`,
  `/mexico-sanctioned-officials` — real government/international sanctions
  registry checks.
- `POST /notary/dispute` — files a claim against a receipt_hash; triggers
  independent resolver re-run; overturned verdicts pay out from the bond
  on-chain.

Full route list: `https://nolawealthfinancial.com/notary/.well-known/x402.json`
