# @tangleai/trace2skill

Contracts and pure policy for evolving one bounded-domain **skill directory**
from labeled trajectories. A skill here is a directory — a root `SKILL.md`
plus optional `references/`, `scripts/` and `assets/` files — not a record, and
a directory is immutable once sealed: its id is the canonical hash of its
manifest, so activating it, archiving it or superseding it cannot rename it.

Importing this package performs no I/O. Everything that touches a filesystem
lives behind the `./node` subpath; storage lives in `@tangleai/store`; the chat
client, its budget account and the wire behind them are injected by the host.

```ts
import { importS0, runRollouts, createMemoryTrace2SkillStore } from '@tangleai/trace2skill';

const store = createMemoryTrace2SkillStore();
const frozen = await importS0(store, files, { scopeKey: 'tabular-extract', mode: 'deepening', origin: 'human-import' });
if (!frozen.valid) throw new Error(JSON.stringify(frozen.issues));

const fanOut = await runRollouts(run, tasks, {
  store, adapter, client, snapshot: frozen.value, condition: 'frozen-s0', modelIdentity,
});
console.log(fanOut.counts); // { success, failure, unanswered, refused, reused, written, calls }
```

## What it owns

- **Closed contracts** for every canonical artifact — directory, file, task,
  run, rollout, analyst result, patch, merge node, candidate, evaluation and
  head — generated from `schemas/trace2skill.schema.json`.
- **Import and sealing**: unsafe names, traversal, duplicates, oversized files
  and unsupported encodings are refused rather than repaired; binary bytes live
  behind an injected artifact seam so a stored row keeps a hash, never a blob.
- **An anchored text-edit compiler**: five verbs (`create_file`,
  `insert_before`, `insert_after`, `replace_section`, `delete_section`) over
  anchors that must resolve exactly once in the frozen page. Each operation
  compiles to a hunk carrying the page's base hash and an exact line interval;
  overlapping intervals on one page are withheld with a report naming both
  sides; a created file and every link that reaches it stand or fall together.
  Compilation and application are synchronous and pure, so a caller can inject
  them as the proposal, apply and candidate validators of a guarded editor.
- **A format validator**: one non-empty root page, safe paths, resolving
  internal links, no duplicates, size bounds, and optionally the frontmatter
  keys or declared tools a host profile requires.
- **Transitions**: lifecycle guards and a revision-fenced activation plan that
  reuses the outcomes head planner rather than forking a second compare-and-swap.
- **A store contract** with an in-memory implementation; `@tangleai/store`
  supplies the SQLite adapter over the same persistence seam.
- **Initialization**: `importS0` seals a starting directory from bytes the host
  already gathered and stores it staged, and `draftS0` writes one from the
  scope alone — a domain description, the tool names an executor will have and
  the shape of an answer. The draft's signature has no member a task, an input
  path or a registered answer could arrive through, and a directory that does
  not pass the format validator never becomes a bundle.
- **A bounded executor**: `createSkillExecutor` composes the active `SKILL.md`
  into the request as data and reaches the rest of the directory through one
  read-only tool. Nothing is retrieved — there is no ledger, no recalled skill
  bank and no index between the directory and the task. It returns a complete
  envelope: the transcript as the agent returned it, the tool steps with the
  turn that made them, the per-turn reasoning the transcript drops, the stop
  reason and the spend. A loop that stopped on its budget carries no answer.
- **A rollout fan-out**: `runRollouts` executes one task per unit under the
  run's concurrency, orders results by task id rather than by latency, and
  addresses every unit by an idempotency key over the run, stage, task,
  attempt, frozen directory, tool manifest, model identity and prompt version.
  A resumed run replays exactly the units it already paid for, a retry is a new
  attempt beside its predecessor, and a spent run budget stops a unit before
  dispatch as a counted refusal rather than an exception.
- **Two asymmetric analysts**: `dispatchAnalysts` gives every labeled rollout
  exactly one analyst and nothing else — a single structured pass over a
  success, a bounded agent over a repair sandbox for a failure. The sandbox is
  an in-memory overlay of what the failed rollout produced: the answer can be
  rewritten there and the host's own evaluator run over the rewrite, and no
  process, shell or file system exists in it. A patch is stored only when the
  last recorded evaluation passed and the diagnosis cites the failing steps,
  the mismatch, the repair, the passing attempt and why the guidance
  generalizes; an analyst's own assertion that its fix works is not evidence.
  Anything else is a typed exclusion — `exhausted`, `tool-failure`,
  `unsupported-artifacts`, `already-correct`, `no-causal-explanation`,
  `evaluator-disagrees` — stored as a first-class row with the spend it
  incurred. Both roles are gated by the same compiler, format validator and
  leak check, so guidance naming a task id, an input path or a registered
  answer is refused before it can reach a directory. An input carrying a peer's
  patch id, or a base hash that is not the run's, is refused before any model
  call.
- **Hierarchical consolidation**: `planMergeTree` sorts the whole patch
  population by id, cuts it into contiguous groups of at most `bMerge`, and
  takes as many levels as that division needs — refusing a plan deeper than
  the run allows rather than truncating the pool, and naming an empty and a
  single-patch pool as explicit terminals. `mergePatches` runs every group of a
  level concurrently against the FROZEN directory, so no group ever reads a
  directory a peer has edited, and the outputs of a level become the inputs of
  the next until one patch remains. Membership follows the sorted order rather
  than completion, so the topology, the node identities and the conflict
  decisions are the same whatever the wire's latencies do. A group answers with
  one patch and a changelog naming the patches each decision acted on; a
  decision naming a patch outside its own group is refused, and support,
  provenance and base hash are receipts the run computes from what it
  dispatched.
- **One guarded application**: `createCandidateCommitter` is a
  `createGuardedRefiner` consumer. Its synchronous validators re-run the same
  compiler, format validator and leak boundary the merge gate already applied,
  the plan is computed over copies, and the commit seals the directory and
  writes it with the candidate that names it in a single store transaction.
  A run applies exactly one patch: an intermediate result of a merge level is
  refused by identity, a second application is refused after the first has
  landed, and a run that already staged its candidate replays it without a
  model call. Every retained edit is attributed to the trajectories behind it,
  and an edit nothing explains is a counted number rather than a quiet credit.

- **One resumable run**: the coarse stage graph is a `@tangleai/mas` workflow —
  thirteen task nodes in one chain, validated and lowered by the suite rather
  than by a scheduler written here — and every stage's fan-out is recorded as
  this package's own rows, so the ports between stages carry ids and counts
  and never a trajectory. `runTrace2Skill` drives it once; `resumeRun` drives
  the same stages over what the store already holds, reusing only units whose
  idempotency key matches exactly, so a changed prompt version, model identity,
  tool manifest or frozen directory produces new units instead of quietly
  replaying work that answered a different question. A finished run driven
  again spends nothing and writes nothing. The host's run log receives one
  coarse header of ids and counts; no fan-out event is written to it.
- **Held-out evaluation**: `evaluateCandidate` scores the candidate against the
  directory it claims to improve on, over the held-out split and nothing else —
  a task from the evolve split is refused before a call is made. Eligibility is
  a gate with named clauses: strict improvement on the primary metric, no
  single task falling further than the tolerance allows, an answer coverage
  floor, a cost ceiling and zero counted leakage. Every clause a candidate
  fails is an issue on the evaluation, so a refusal says which promise broke.
  A recorded evaluation is replayed rather than recomputed, because it binds
  the head it was registered against.
- **Activation is a separate explicit call**: `activateCandidate` reads the
  head, the candidate and the held-out evaluation, applies the binding checks
  of `planSkillPromotion` and then the store's revision-fenced swap — the head
  planner is imported from `@tangleai/outcomes` and no revision arithmetic
  happens here. Twenty callers racing one scope produce exactly one activation.
  Every attempt is an event whether it applied or was refused; a refusal names
  the clause, leaves the prior directory active and readable and leaves the
  candidate inspectable. Making a directory active is never a workflow node: a
  run produces a candidate and a verdict, and a host decides afterwards.
- **Versioned prompt packs**: each of the five roles renders through one
  compiled artifact. A pack is authored as TOML — static system instructions
  and one user template, with `{{name}}` and balanced `{{#if name}}…{{/if}}`
  as the only two placeholder forms — and compiled once into an immutable
  artifact whose revision IS the prompt version every idempotency key of that
  role names. Moving a pack byte moves the revision, which moves the key, so a
  resumed run cannot replay an answer to a question the pack no longer asks.
  The compiled set is published as `@tangleai/trace2skill/artifacts` and every
  role takes an artifact as input; TOML is parsed by `@jarenjs/josl`, the
  template is rendered by `@jarenjs/json/jtlt`, and substituted text is data —
  it is written into the request as it reads and never scanned a second time.
  A pack that leaves a block unclosed, uses an undeclared name or puts a
  placeholder in its system half is refused with the pointer it happened at.
- **Direct use, with no retrieval index**: `composeSkillSystem` puts the active
  root page into a host's own system text as data and `skillReadTool` is the
  one read-only surface over the rest of the directory; `activeBundle` reads
  what a scope currently serves. That is the whole of inference time — the
  directory is preloaded and read, and nothing between it and the task ranks,
  recalls or retrieves. The package's own executor composes its request from
  these same two pieces, so a host request and a measured row differ in the
  task and in nothing else.

- **A reversible head**: `activateCandidate` is the one call that can make a
  directory active, and `rollbackHead` is the same revision-fenced swap
  backwards — it reinstates a directory the scope served before, which is
  possible precisely because a superseded directory is archived rather than
  deleted. Every attempt is a stored event whether it applied or was refused;
  a rollback names no evaluation, because none authorized it.

## What it measures, and what it does not

The mechanism is measured by [`docs/TRACE2SKILL_BENCHMARK.md`](../../docs/TRACE2SKILL_BENCHMARK.md),
regenerated by `npm run benchmark:trace2skill` over a Tangle-authored keyless
fixture with a scripted model wire. On its eight held-out tasks the evolved
directory scores 1.000 against 0.875 for the frozen starting directory and
0.750 for no directory, and three ablations are published with their losses:
the paper's `retrieval-bank` baseline scores 0.750 (−0.250), while
`single-call-error` and `sequential-merge` reach the same directory the method
reaches and differ only in proof and cost.

**A scripted answer is registered fixture data.** What those numbers establish
is that the instrument separates the conditions the corpus registers, and what
each ablation costs in calls, proof and withheld conflicts — not that any model
would answer the same way. Live quality on a real domain adapter is unmeasured;
so are cross-model and out-of-distribution transfer, whose rows are published
as `not-run` because the instrument builds no second executor identity and the
corpus registers a single domain. `benchmark/trace2skill.ts --live` prints a
frozen credential-free plan, writes a `not-run` record and makes no request:
executing it needs an operator approval naming that plan's id, and there is
nothing behind that door in this build.

## What it refuses

Content failures are values, never exceptions: `{ valid: false, issues: [{ code,
path, detail, cause? }] }`. The codes are `TT2S1001` (shape), `TT2S1002`
(identity or stale base), `TT2S1003` (unsafe file), `TT2S1004` (patch compile),
`TT2S1005` (format), `TT2S1006` (leakage), `TT2S1007` (analyst isolation),
`TT2S1008` (merge plan), `TT2S1009` (budget), `TT2S1010` (activation),
`TT2S1011` (missing evaluator proof), `TT2S1012` (idempotency) and `TT2S1013`
(host capability). An originating Jaren or Tangle code travels as `cause` with
its pointer; nothing is renumbered.

A directory never becomes active because it is structurally valid. Eligibility
comes only from a held-out evaluation, activation is an explicit host action,
a failed compare-and-swap leaves the prior directory active and the candidate
readable, and a superseded directory and its files are archived, never deleted.

## License

MIT
