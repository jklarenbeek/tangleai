# @tangleai/evolve

Contracts, records and pure policy for running an **experiment** over a
repository: propose a change, isolate it, apply it, gate it by exit code,
measure it, decide, and record the outcome — without ever holding the authority
to merge.

The root import performs no I/O and reaches for no Node builtin, so it loads in
a browser. Everything that touches a process, a worktree or a clock is injected
by the host.

## What a record is

Every record is a closed shape with `schemaVersion`, a `kind`, and an `id` that
is the canonical hash of the record without its `id`. A clock never enters an
identity: `recordedAt` is a host tick stored beside the hashed payload, never
inside it, so the same experiment re-derived tomorrow has the same address.

## The authority that does not exist

`EvolvePrincipal` carries `propose`, `execute` and `approve`. There is no
`merge`, `push` or `promote` member, and the schema refuses one — the capability
is absent from the vocabulary rather than defended at a call site. A decision to
keep a change produces a branch and a review bundle; a person merges it.

## The lifecycle

`proposed → isolated → applied → gated → measured → decided → recorded`, with
`abandoned`, `refused`, `uncertain` and `recorded` terminal.
`planExperimentTransition` is pure and exhaustive: every `(status, command)`
pair is either the one legal target or a refusal at `/status`, and a terminal
status accepts nothing.

## Refusals are values

`EVOLVE_CODES` is the one vocabulary (`TEVO1001`–`TEVO1011`). Nothing here
throws for content; a refusal carries its code, a JSON Pointer to the offending
member, prose, and — when it adapts another owner's refusal — that owner's own
code and message as `cause`.

## Storage

`EvolveStore` is a narrow contract: immutable `putRecord`, `getRecord`,
ordered `listRecords`, semantic-uniqueness keys, and
`transitionExperiment` under compare-and-swap. `createMemoryEvolveStore()` is
the reference; `@tangleai/store`'s `createEvolveStore(db)` is the persistent
one, and a parity test asserts the two answer identically.
