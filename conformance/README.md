# x402 conformance suites

Two runnable suites for the open questions on
[x402#2887](https://github.com/x402-foundation/x402/issues/2887) (evidence record) and
[x402#3389](https://github.com/x402-foundation/x402/issues/3389) (digest triple).

**Zero dependencies. Node stdlib only. No network at run time. No account. No callback to us.**

```sh
node run-all.js                                        # both suites, bundled reference
node run-all.js --adapter ./mine.js                    # your file, both suites
node run-all.js --record-adapter ./stillos_adapter.js  # StillOS's real implementation
node run-record.js --adapter ./mine.js --verbose       # one suite, per-case output
```

Exit `0` iff every assertion behaved as specified. `2` = bad invocation. An adapter
that does not export what a suite needs is reported `NOT RUN` for that suite — never
silently replaced by the reference.

## The harness had the bug the harness tests for

Read this before trusting any score above, including ours.

Until 2026-09-13, `run-all.js` parsed only `--record-adapter` and `--triple-adapter`
and **silently ignored every other flag**. So `node run-all.js --adapter ./mine.js` —
the obvious spelling, and the one we had written down for other implementers to run —
loaded nothing, scored the **bundled reference**, printed `PASS 8/8` and `PASS 22/22`,
and exited `0`. A stranger following our instructions would have received a perfect
green scoreboard for code that was never opened.

That is precisely the defect class these suites exist to catch: a result that is green
for a reason unrelated to conformance, exactly like `triple-03` passing on an
implementation that ignores `enc`. We shipped it in the tool doing the catching. It
was found by running our own published instruction and noticing the adapter name never
appeared in the output.

The runner now fails closed: unknown flag → exit 2, missing adapter file → exit 2, a
flag where a path belongs → exit 2, adapter missing required exports → `NOT RUN` and a
non-zero exit. Eight invocations are checked. If you ran this suite before that date
and got a green, **the green was ours, not yours** — please re-run it.

## Scoreboard

| implementation | digest triple | evidence record | integrity | settlement |
|---|---|---|---|---|
| bundled reference | 8/8 | **22/22** | 14/14 | 8/8 |
| **StillOS notary (ours)** | **4/8** | **16/22** | 14/14 | **2/8** |
| integrity-only strawman | — | 15/22 | 14/14 | 1/8 |
| naive triple strawman | 5/8 | — | — | — |

### Correction, 2026-09-13: this table said StillOS scored 8/8 on the digest triple

It does not. It scores **4/8** — worse than the naive strawman we wrote to demonstrate
the suite catches something.

The 8/8 was published with **no StillOS triple adapter shipped to produce it**, the same
unreproducible-claim defect as the strawman row, found by grepping for siblings of that
defect instead of fixing the one instance. `stillos_triple_adapter.js` now ships and is
bound to real code (`vauban/encode-verify.js`).

What the honest measurement shows: StillOS has no `{alg, enc, hex}` implementation at
all. It emits bare 64-char hex, has no `enc` concept and no felt252 masking path. So it
fails `triple-02` — **it is the 31-in-32 false negative**, the exact bug this suite was
built to catch, sitting in the stack of the party that built the suite — plus
`triple-04`/`05`/`06`, accepting records with no `alg`, no `enc`, and an unknown `enc`.

`limbs()` is the one part backed by real shipped code, and it passes, including its own
division-vs-bitshift cross-check.

A default `node run-all.js` now always prints the StillOS rows underneath the reference
rows, because a green reference in a repository named after us reads as us being green
and says nothing of the kind.

The strawman row used to be quoted without shipping the adapter that produces it — an
unreproducible number in a document whose entire claim is *run it yourself*. It now
ships as `strawman_record_adapter.js`: complete, correct integrity, and `OK` returned
to every settlement question. It is not a bad implementation, it is the **shape most
evidence implementations have today** — and the one settlement assertion it passes,
`rec-01`, it passes by luck, because it answers `OK` to everything and `rec-01`
happens to be `OK`.

**We wrote the suite and we do not pass it.** `stillos_adapter.js` is our real
implementation, not a demo, and it returns `UNSUPPORTED` on six cases rather than
guessing a plausible answer. Reproduce with
`node run-record.js --adapter ./stillos_adapter.js`.

What we fail, and why, in our own words:

| case | we return | because |
|---|---|---|
| `rec-08` settled-not-delivered | `UNSUPPORTED` | no delivery primitive — nothing binds a delivered artifact to a settlement |
| `rec-09` delivered-not-settled | `UNSUPPORTED` | same gap, other direction |
| `rec-10` payee mismatch | `UNSUPPORTED` | the receipt does not carry the quote, so settled payee can't be compared to advertised payee |
| `rec-11` amount mismatch | `UNSUPPORTED` | same — underpayment is invisible to us |
| `rec-12` authority mismatch | `UNSUPPORTED` | our authority verifier is a separate kit; its digest isn't bound into the record |
| `rec-01` clean exchange | `UNSUPPORTED` | we cannot even confirm a *good* settlement, for the same reason as `rec-10` |

## Suite 1 — evidence record (`run-record.js`, x402#2887)

14 cases, 22 assertions, across **two independent axes**:

- **Integrity** — is this record intact and attributable? Answered by hashes and
  signatures alone. Needs no knowledge of what was bought.
- **Settlement** — does the money story match the delivery story? **Cannot be
  answered by cryptography at all.** It requires comparing two independently-sourced
  facts.

That split is the entire point. Implementations tend to be strong on one axis and
silently absent on the other, and the gap is invisible until both are written down
side by side. Every settlement case below is a record that is *cryptographically
perfect* — correctly hashed, correctly signed, correctly chained — and still wrong.

`rec-08`, `rec-09` and `rec-10` were named by **@StelarDigital on x402#2887**.
They are implemented here rather than waited for, and credited in the vector file.
`rec-11`–`rec-14` have not been raised by anyone on the thread yet:

- `rec-11` **amount mismatch** — money reaches the right party, but not the quoted
  amount. Amounts are integer minor units carried as **strings** so no implementation
  can paper over this with float comparison.
- `rec-12` **authority mismatch** — a valid receipt for an action the agent had no
  mandate to take. Relevant to the ERC-8004 direction.
- `rec-13` **source unavailable → `INDETERMINATE`, never false.** The most dangerous
  omission in the set. An implementation that collapses *unknown* into *false* will
  overturn correct records during someone else's outage, and because the failure is
  transient it never reproduces afterwards. The runner fails this case specially if
  you return a refutation.
- `rec-14` **overturned after a valid settlement** — can the format express a debt
  that arises *after* a transaction closed cleanly? A format that can't forces the
  obligation to live outside the evidence trail where nobody can audit it.

### This is not a specification

These are **test vectors, not a standard**, and nothing here is adopted by any body.
The record shape in `record-vectors.json` is deliberately the *intersection* of what
parties on 2887 can already emit — not a superset anyone must adopt. There is no bond
field, no verdict field, no resolver field. **We are explicitly not proposing the
StillOS schema as the common record.** Adjudication and bonding belong in a profile
*above* this record; that profile is at tag `foreseal-bilateral-v1.1` and is not part
of these vectors.

### Signatures are symbolic, deliberately

The signature field carries `SIG-VALID` / `SIG-CORRUPT` / `SIG-VALID-WRONGKEY` rather
than real bytes. Parties on 2887 sign with Ed25519, secp256k1 and STARK-native hashes;
shipping real signature bytes would mean shipping *our* curve and turning a neutral
suite into an adoption vehicle for one implementation. The suite tests verifier
**logic** — do you distinguish intact from corrupt, and right-key from wrong-key, and
do you recompute rather than trust the stated hash? Wiring your real crypto behind
those three tokens is a few lines in your adapter. The settlement axis needs no such
caveat: it is comparison over two facts and is identical for everyone.

### Writing an adapter

```js
module.exports = {
  NAME: 'my implementation',
  verifyRecord(record, ctx) { return { valid: true }; },              // ctx = { knownKeys, expectedPrevHash }
  settlementCheck(record)   { return { status: 'OK' }; },             // see settlement_status_values
};
```

Corrections to the vectors are more useful to us than agreement with them. If a case
encodes a wrong expectation, open an issue and we will change it.

---

## Suite 2 — digest triple (`run.js`, x402#3389)

Runnable vectors for the `{alg, enc, hex}` digest triple and the Starknet felt252
masking rule discussed in [x402-foundation/x402#3389](https://github.com/x402-foundation/x402/issues/3389).

Zero dependencies. Node stdlib only. No network at run time.

```sh
node run.js                        # check the bundled reference implementation
node run.js --adapter ./mine.js    # check yours
node run.js --verbose
```

Exit code `0` = every case behaved as specified, `1` = at least one did not.

## Why this exists

The felt252 rule is a false-negative generator, and the failure is invisible in a
normal test suite.

A 256-bit digest stored on Starknet becomes a 251-bit field element:
`stored = D & ((1 << 251) - 1)`. The top 5 bits are dropped. A verifier that compares
the **full** digest against the stored value is therefore wrong on **31 of every 32
digests** — and correct on the other 1, because the top 5 bits happen to be zero
1 time in 32.

That is the whole problem. Test one digest and you have a 1-in-32 chance of never
seeing the bug. seritalien described paying for exactly this in production
([#3389](https://github.com/x402-foundation/x402/issues/3389), 2026-09-08):

> *"a verifier that compares the full digest against the chain reports a false
> negative on thirty-one receipts in thirty-two"*

So the suite carries **both** digests deliberately:

| case | top 5 bits | masking | a broken verifier |
|---|---|---|---|
| `triple-02` | `0b01100` (12) | changes the value | **fails** |
| `triple-03` | `0b00000` (0) | is a no-op | **passes** |

Passing `triple-03` alone proves nothing. It is in the suite specifically so that
passing it cannot be mistaken for conformance.

## It catches real bugs, not just its own reference

A conformance suite that only passes the implementation it ships with is worthless.
`naive_adapter.js` in the repo history is written the way someone would write it
after reading the record shape but not the normative rules — it defaults a missing
`enc` to `none`, and ignores `enc` when computing the comparison value. Both are
plausible mistakes rather than strawmen.

Run against it, the suite reports **5/8**, failing exactly:

- `triple-02` — comparing the unmasked digest (the 31-in-32 false negative)
- `triple-04` — accepting a record with no `enc`
- `triple-06` — accepting an unrecognised `enc`

…while **passing `triple-03`**. That is the demonstration: an implementation that
looks correct on the digest you happened to test.

## The rules being checked

1. **The triple.** Every digest is `{alg, enc, hex}`. `alg` names the digest function,
   `enc` names the storage encoding a verifier must apply before comparing. A record
   that omits `enc` is **invalid rather than defaulted** — the normative rule from
   #3389. An unlabelled digest also invites fake cross-ledger agreement, since
   `sha-256` and `keccak-256` are indistinguishable by display; goun7/Tamga reported
   hitting this in practice.
2. **felt252 masking.** `enc: "felt252-masked-251"` means compare against
   `D & ((1 << 251) - 1)`, not `D`.
3. **Foreign-leaf limbs.** `digest_lo = D mod 2^128`, `digest_hi = D >> 128`,
   low-then-high, and the two together must reconstruct `D` losslessly.

## Writing an adapter

A CommonJS module exporting three functions:

```js
module.exports = {
  validate(record)    { /* -> { valid: boolean, error?: string } */ },
  storedValue(record) { /* -> BigInt: what a verifier compares against on chain */ },
  limbs(record)       { /* -> { lo: BigInt, hi: BigInt } */ },
};
```

Error strings the negative cases expect: `missing_alg`, `missing_enc`, `unknown_enc`,
`bad_hex_length`.

## Provenance of the vectors

- `triple-01` / `triple-02` use a **real StillOS Notary production receipt**
  (`resolved_verdict`, ledger line 2283, `2026-09-06T17:20:11.994Z`) — not a fixture.
- `triple-03` is `sha256('stillos-conformance-probe-15')`, found by search and
  independently reproducible in one line.
- `tamga-01` is **marked `synthetic: true`**. It matches the shape goun7 described —
  a plain SHA-256 over a deterministic JCS encoding, dropping into a batch leaf — but
  Tamga's own verified chain head does not exist yet, since it is gated behind their
  #3379 pilot. It is a shape check, and the file says so rather than implying a real
  cross-implementation match that has not happened.

## Scope

This checks digest encoding, not anchoring. Passing it does not mean a digest has
been included in any batch, that any receipt has been anchored on Starknet, or that
another implementation's encoder agrees with yours — only that yours follows the
published rules. Point it at a second encoder to check the last one.

Corrections welcome. If a rule here is wrong, the vector is wrong and should be fixed.

---

## Suite 3 — independent anchor replay (`replay-anchor.js`)

Vectors check encoders. This checks an **anchor someone else published**, with code
that shares nothing with theirs.

On [#3389](https://github.com/x402-foundation/x402/issues/3389), @seritalien (Vauban)
anchored a STARK fact on Ethereum Sepolia; @goun7 (Tamga) replayed it with an
independent pure-python keccak and published a verdict — `indeterminate` on 2026-09-09
because the epoch had not sealed, then `GREEN` on 2026-09-13 once it had. Two
implementations, one half each, verdict published either way. That practice is the
most valuable thing on the thread.

This is the third implementation. `keccak256.js` here is written out by hand — Node's
`crypto` ships `sha3-256`, which is **not** keccak256 (SHA-3 pads `0x06`, keccak pads
`0x01`) — and self-tested against three known-answer vectors. No dependency is taken,
because taking one would defeat the purpose of the cross-check.

```sh
curl -s https://explorer.testnet.apodix.vauban.tech/v1/anchors/proof/<fact> -o proof.json
node keccak256.js                              # 3 known-answer vectors first
node replay-anchor.js --proof ./proof.json     # recompute + read the chain
```

Result on fact `0x02362521…36e2`, reproduced in this repo as
`evidence-proof-epoch13.json`:

| step | result |
|---|---|
| keccak256 self-test, 3 KAT vectors | PASS |
| leaf = `keccak256(keccak256(bytes32(fact)))` | `0xc6c8e3b3…19dd` |
| 6-step sorted-pairs walk, position 55 of 60 | root `0xaaf21f36…c458e` |
| `eth_call epoch(uint64)` on `0x48421a2e…5cFB14`, chain 11155111 | `factsRoot` identical, `factsCount` 60 |

**GREEN.** The `epoch(uint64)` selector `0xe40fb3a8` is derived with our own keccak
rather than copied from a block explorer, so no step of the chain read is taken on
trust either.

**Scope of that green, stated so it cannot be over-read:** the fact is a leaf of a tree
whose root is anchored at that contract and epoch. It establishes **inclusion in a
sealed epoch** — not the soundness of the STARK proof the fact attests, and not the
truth of anything the batch describes. Inclusion is presentation, not truth.

The tool can return three verdicts, not two. If the RPC is unreachable or the contract
returns nothing decodable it prints `INDETERMINATE` and exits `3`; it never prints red.
An unreachable source is not evidence of absence — the same rule @goun7 stated, that
Vauban adopted as §4.4 of the profile, and that this repo enforces as `rec-13`. A tool
that collapses unknown into false manufactures refutations during someone else's
outage, and because the failure is transient it never reproduces afterwards.
