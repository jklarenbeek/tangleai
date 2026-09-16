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

## The gate

`runGate` runs the target repository's own registered gate as one fenced
effect leg, and reads its **exit code alone**. Nothing parses what the gate
printed: a child that can print can print a convincing success. Stdout and
stderr are captured beside the record for a reviewer, never hashed into any
identity, and absent after a replay.

The distinction the flake policy rests on is between a gate that FAILED and a
gate that never finished:

| what happened | verdict | earns a rerun |
|---|---|---|
| exit 0 | `green` | no |
| clean non-zero exit | `red` | **yes, exactly once** |
| killed at `legMs`, or output truncated | `over-budget` | no |
| post-gate workspace walk over `workspaceBytes` | `over-budget` | no |
| command refused before it started | `command-refused` | no |

Calling a killed gate `red` would credit it with a verdict it never reached
and spend the single rerun on running out of budget again. Red earns one
rerun and one only: red then red is `red`; red then green is `ambiguous`, and
both abandon.

## Fitness

`measureFitness` runs only behind a green gate, taking the registered number
of samples on the base and the same number on the candidate. `parseSample`
reads the last non-empty line of stdout and validates it against the
registered metric; a sample that cannot be read is a counted refusal, never a
retry — re-running a sample until it parses is how a measurement quietly
becomes a search for the answer somebody wanted.

`compareFitness` answers `improved`, `equal`, `regression` or `unverifiable`.
The load-bearing rule is the **drift check**: if the base median differs from
the registered truth, every number in the run is `unverifiable` — including a
flattering one. A candidate number only means something while the base still
measures what the registration says it measures.

The base side runs at `cwd: 'base'`, which is the repository root under its
own allow-list name. That is the most dangerous thing this package does, so
it is bracketed: before and after every batch the root must still answer the
registered base revision on a clean tree with a byte-identical tracked
digest. A root that moved refuses `TEVO1003` and the experiment becomes
uncertain.

## The decision

`planExperimentDecision` is the campaign's one planner. It is pure, takes
records rather than hosts, is total over its input, and has **no default
branch** — so a new verdict fails to compile rather than falling quietly into
somebody else's row. Two orderings matter:

- **`uncertain` outranks everything.** A lost process boundary means the
  evidence is untrustworthy, so no keep and no cleanup is derived from it.
  Deriving a tidy `abandoned` from untrustworthy evidence would be the most
  dangerous available convenience.
- **Over-budget outranks red**, for the reason above.

Only a strict improvement behind a green gate is `kept`. Equal is abandoned,
a regression is abandoned, and an unmeasurable run is abandoned as
`unverifiable`.

`settleExperiment` is the only place a worktree dies. A keep removes the
worktree and **leaves the branch**, unmerged, with an `EvolveReviewBundle`
addressed to a person; a loss removes both, because a loss that leaves debris
is a loss nobody will clean up; an uncertain experiment is not touched at all. The
compare-and-swap happens before the removal, so a second settle loses the
swap rather than removing a workspace twice.

## The outcome

`recordExperimentOutcome` runs `create → resolve → score → project` against
an injected `createOutcomeService` and constructs nothing of its own. The
evidence is the sealed decision record, supplied as a pinned `Source` through
`resolveEvolveEvidence`; a citation the evolve store cannot produce resolves
to nothing, and an unresolvable citation is a refusal rather than empty
evidence.

Confidence moves there and nowhere else — `projectOutcomeConfidence`, inside
the service's own transaction, against the memory carrier the decision cited.
A missing carrier is reported and refused `TEVO1011`, never created on the way
past: a lifecycle that invents the thing it is measuring will always report
success. Nothing in this package writes a confidence number directly.

Promotion is deliberately not taken. The selection artifact keeps empty
weights, no `evaluate`, `approve` or `promote` runs, and the automation
principal is refused `OUTC1012` if something asks it to approve.

## The evidence trail

`createStrategyRefiner` appends one ledger memory citing the sealed decision,
through `createGuardedRefiner` — the package's only other guarded consumer
besides the patch path. Where the evidence lands is the ledger's decision,
not this package's: the ledger's refinement vocabulary cannot address inside
a record, and its skill schema is closed with no evidence member, so the
trail is an appended memory rather than an edited skill. Every pointer but
`/memories/-` is refused `TEVO1011`, both validators are synchronous, and no
refusal ever carries an empty `errors` — an empty one is indistinguishable
from the engine's accidental-Promise trap.

## What a round amounts to

`planExperimentDecision` decides one experiment. `aggregateFailures` sits
above it and says what a whole ROUND of decisions amounts to — and it exists
because a mechanism that revised itself once per observed failure would be
optimizing against the wrong thing.

Any single failure has two possible causes and no way to tell them apart: the
instance was peculiar, or the mechanism is deficient. Treating every failure
as a direct instruction to change bends the mechanism around whatever it
happened to see, narrowing what it will accept and making it worse at cases
nobody showed it. What distinguishes the two is **recurrence across distinct
instances** — so a failure group is `systematic` only when at least
`SYSTEMATIC_THRESHOLD` (2) unrelated instances produced it, and everything
else is `incidental` and kept as evidence rather than discarded.

Failures group at two levels, and the levels disagree on purpose. By reason,
a lone `escape` or `red` looks like a one-off; rolled up by the stage that
produced it, `escape` joins `goalpost` under `surface` and `red` joins
`ambiguous` under `gate`, and the same stage turns out to be indicted by
unrelated instances wearing different names. `systematicRatio` is the share
of failure evidence that would license a mechanism-level repair at all.

What is deliberately **not** computed is the share of changes that accommodate
one model's quirks rather than repairing the mechanism. That number needs
modification decisions to exist, and nothing in this package modifies itself.
`systematicRatio` is its measurable precursor.

`roundScore` reduces a round to one scalar and `compareRounds` accepts a
candidate only on a **strict** improvement of it. Per-instance acceptance
cannot see a change that fixes the case in front of it and quietly breaks two
others; the aggregate can. A tie is rejected on purpose — equal evidence is
not a reason to move, and keeping the incumbent is always the cheaper error.

Everything in this layer is pure and total: it reads decided rows and answers
counts, runs no process, reads no file, and decides nothing about any
individual experiment.
