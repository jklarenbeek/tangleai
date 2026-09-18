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
`/memories/-` is refused `TEVO1011`, both validators are synchronous
(preparation uses the engine's synchronous path, which refuses an
asynchronous hook), and no refusal ever carries an empty `errors`.

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

`roundScore` reduces a round to one scalar, and `compareRounds` states the
acceptance rule that goes with it: a candidate is accepted only on a
**strict** improvement, and a tie is rejected on purpose — equal evidence is
not a reason to move, and keeping the incumbent is always the cheaper error.
The rule exists because per-instance acceptance cannot see a change that fixes
the case in front of it and quietly breaks two others; the aggregate can.

Two rounds that answered a **different number** of experiments are rejected
before the score is read, because they are not comparable. The score is kept
over attempted and an experiment that never ran is not an attempt, so the
count moves the ratio on its own, in both directions: a candidate that broke
on the fifteen hard proposals and kept the one easy one scores 1/1 against an
incumbent's 1/16, and a candidate that bolts ten trivial proposals onto the
round scores 11/26 against the same incumbent. Both win without fixing
anything. That is the goalpost move this package refuses at the surface,
arriving through the scoreboard instead of through a patch, and it is refused
on the same grounds: a score is evidence only while it is still answering the
same question. The registration is immutable, so two legitimate rounds over it
always attempt the same count — an inequality means something changed that the
score cannot see, and the incumbent stands.

**Nothing calls `compareRounds` yet.** `planExperimentDecision` still owns
every acceptance, one experiment at a time, and the round score is published
as evidence rather than consulted as a gate. The comparator is here so that
the loop which will need it — one that proposes changes to a harness instead
of to a repository — starts with this rule instead of inventing a weaker one.

Everything in this layer is pure and total: it reads decided rows and answers
counts, runs no process, reads no file, and decides nothing about any
individual experiment.

## The durable lifecycle

`@tangleai/evolve/lifecycle` authors one immutable workflow version, and
`@tangleai/evolve/host` runs it. The shape is forced by a single rule: **no
spawn happens inside a workflow segment.** A segment is never handed the
suite job lease, and the effect store asserts that a lease belongs to the
plan it is running, so every stage that reaches a process is a pair — a task
that writes the intent, and a typed wait that the effect worker answers from
another process. Writing the intent IS the enqueue: the fenced store creates
the operation's job in the same transaction, under the plan's own id, with a
payload of one field.

Two consequences are worth knowing before reading the graph. A switch branch
*owns* its nodes and has one result port, so the single rerun a red gate
earns lives inside the flake branch together with the readback that folds its
settlement back into the envelope. And there is no seal node: sealing the base
root spawns git, so the seal belongs to the worker running the base sample
batch, which brackets that batch on both sides and reports whether the base
held. A base that moved voids every number in the run, flattering ones
included. There is no settle node either, for the same reason and one more:
removing a worktree spawns git, and settling is already idempotent through
the experiment's own compare-and-swap, so putting it behind the effect fence
would give one operation two idempotency mechanisms that could disagree.

Authoring is deterministic — no clock, no random source — so the same options
produce the same version id, and the version is safe to store once and reuse.

`createEvolveEffectWorker` claims those jobs and answers the waits. It reads
the plan out of the effect record and the address out of the run rather than
out of the message, so a crash that lost every process that knew them loses
nothing; `createEffectAddressing` answers the path the run is actually parked
on, and refuses to answer when it is parked on none or on more than one.
It uses the effect record id as the response key, which is what makes a crash cheap: a
worker that dies after running and before answering will, next pass, prepare
the same semantic plan id, find every leg settled, replay without spawning,
and answer with the same key — the same response, not a conflict. The one
case it will not answer is an unresolved leg: the wait stands, and a person
reconciles it, because inventing a settlement would turn "nobody can account
for this" into a confident record.

## Stopping one, and cleaning up

`cancelExperiment` is a host call and deliberately not a wire operation. A
stopped run executes no further segment, so the cleanup cannot be a node — it
would never fire, and the worktree would outlive the run.
`reconcileStoppedExperiments` does it instead, for both ways a run can stop,
and is idempotent through the experiment's own compare-and-swap: the second
pass examines the same runs and settles none.
`reconcileCancelledExperiments` is its cancelled case, and supplies the one
thing specific to that case — the decision a cancel settles to.

The decision vocabulary is not widened for it. An operator cancel is
`abandoned` / `command` / `TEVO1006`; an expiry is `abandoned` /
`over-budget` / `TEVO1005` against the registered ceiling. Which it was, and
who asked, lives in the run trace — never on the decision, which has no
member for it.

## What the contract publishes

`@tangleai/evolve/contract` is three operations, and all three are reads:
`evolve.experiments.list`, `evolve.experiment.get` and `evolve.review.get`.

There is no operation that merges, promotes, approves, runs, cancels or stops
an experiment. Not guarded — absent. `npm run evolve:contract:check` compares
the published surface against a frozen baseline and refuses a commit that adds
one, that removes an operation a client depends on, or that narrows an input
so a call the freeze accepted would now be refused.

`evolve.review.get` answers the bundle's diff digest and byte count, and never
the diff text or what the gate printed. A reviewer reads those from the branch
the experiment left behind, where they are attributable to a commit, rather
than from a payload that could be rewritten on the way past. A list is bounded
whether or not the caller asked for a bound.
