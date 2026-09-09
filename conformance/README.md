# x402 digest-triple conformance suite

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
