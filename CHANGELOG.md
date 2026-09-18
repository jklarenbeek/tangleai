# Tangle releases

## 0.30.0

Move onto the Jaren 0.91.3 registry foundation and source pin, and consume what
it delivers instead of keeping local copies. The paired bootstrap behind the
policy, grounding and consolidation intervals is now the suite's
`pairedBootstrap`, with the same intervals bit for bit. Consolidation's rank
fusion is the suite's `reciprocalRankFusion`, so equal fused scores now order by
code point id rather than by first appearance; the hybrid rows move by at most
0.002 recall. The evolve host's process runner keeps its refusal codes but
runs on the suite's named-process executor: a request whose signal is
already aborted is refused before spawning, and a process group's remaining
members are killed when its leader exits. A desktop run stream now opens on a
snapshot whose event id is the last frame it holds, so a reconnect right after
it repeats nothing, and the UI no longer de-duplicates frames or threads a
resume cursor through its document. Emitted contract bundles end with a single
newline. Every keyless benchmark document is requalified against the new
foundation.

Migration: `createProcessRunner` no longer accepts a `clock` option. The
executor times each run, so drop the option; `durationMs` is the executor's
figure. Callers of `fuseConsolidationRanks` that relied on first-appearance
order for equal scores now get code point id order.

## 0.29.8

Move the store onto the Jaren 0.91.2 registry foundation and source pin. The
underlying native store's relational, jobs, live-query and migration modules are
refactored around the new PostgreSQL parity work; Tangle reads them through the
existing `openStore`, `db.jobs` and `planPhysicalMigration` seams with no API
change. The PostgreSQL Store, its notifications and the asynchronous `asyncLive`
resnapshot mode are evaluated and not adopted: Tangle stays on local SQLite with
the synchronous incremental live-query engine. The desktop folder watcher now
serializes its passes through Jaren's `createLatestDelivery`, so a change window
that closes during the start scan runs right after it. Every keyless benchmark
document is requalified against the new foundation, and checkpoints written
under the previous foundation are refused rather than silently resumed.

## 0.29.7

Two experiments the durable lifecycle cannot finish are now driven and pinned rather than described, because the shapes turned out to differ and one of them was worse than suspected. A refused proposal parks on `await-isolate` and stays there: nothing was dispatched, so nothing will ever be enqueued, so no worker will ever be told to answer it — the refusal is still free, which is the one property the failure does not cost, but the run does not reach its record. A red-gate proposal does not park at all; it FAILS `TMAS2003`, "a 'interaction' node requires the control host", at `await-gate-rerun`, because the flake switch's branch owns that wait and a branch's members are executed as a dag subregion. The flake branch was therefore not merely unexercised but a live defect on every red-gate row. Together that is nine refused proposals of the sixteen registered plus every red-gate one, so the path completes only experiments that skip no stage — the clean end-to-end run passes because its proposal happens to run all of them. Both tests exist to be deleted: the fix is to make the effect middle a subgraph, which gets its own region walk, and when both of these become ordinary completed runs the restructure is done. No package source changed.

## 0.29.6

A crash matrix over the durable path — seven boundaries, each killed once and driven to convergence against a real repository and the real queue — found four things no unit test could. `createEffectDriver` closed the operation's job the moment the effect finished, which is right when the driver claimed that job and wrong when a worker supplied a lease: the worker still has to answer a wait, and a job closed first leaves that wait standing with nothing claimable behind it, so the documented "a crash between running and answering costs nothing" was false for want of a next pass; whoever claims the job now closes it, and the worker closes it only once the answer has landed. The worker also called an ordinary race unresolved — a dispatch writes the intent and its job in one transaction and the run parks on the paired wait a moment later, so a worker claiming in between finds nothing waiting — which escalated a routine timing overlap to a person; `WorkerPass` gained `deferred` for it, and such a job is simply left for its lease to lapse. A worker answering a base sample batch from a replay was re-sealing a batch it had not taken, spending processes to compare the base root to itself and report a seal that held about work done in another process; it now reports `sealHeld: null`, and the readback reads anything but `true` as uncertain, because nobody can say whether the base held while a batch somebody else ran was running, and reading a missing seal as fine would excuse exactly the failure a seal exists for. The fourth finding is not fixed and is named rather than implied: an interaction node waits once a run reaches it whether or not its dispatch wrote anything for a worker to answer, so a run that skips a stage parks forever — which is nine of the sixteen registered proposals, refused before anything runs, plus every red-gate one; a switch cannot guard it, because the partitioner carves branch members into a dag subregion and an interaction needs the control host, and a test now pins the exact six waits that carry the defect so the fix can be checked against a list. `EvolveEffectWorkerOptions.jobs` requires `complete`, and the sixteen registered rows are unchanged throughout.

## 0.29.5

The lifecycle version can now complete a run, which the released one could not. It authored a settle stage as a dispatch paired with a typed wait, but settling removes a worktree and deletes a branch — three spawns — so the dispatch did the work synchronously and nothing ever enqueued a job for the wait beside it; a run reached that wait and parked forever, and every unit test passed. Settling is a reconciler over stopped runs instead, `reconcileStoppedExperiments`, which is the conclusion cancellation had already reached for the same reason stated one way — a stopped run executes no further segment — and which is just as true of a completed one; `reconcileCancelledExperiments` is now its cancelled case. Two further defects only an end-to-end run could find: the envelope schema declared `decision`, `gate`, `rerun` and `fitness` non-nullable and so refused the very envelope every run is created with, failing in the first segment; and the handler registry declared the `json-schema` message adapter at a version no host binds, which validation accepts and runtime compilation refuses. The worker no longer expects a dispatch to hand it anything, because the fenced store owns the operation's job and writes its payload itself — it reads the plan out of the effect record and, through the new `createEffectAddressing`, answers the wait the run is actually parked on rather than one assembled from a stage name, which would address nothing for the rerun inside the flake branch, and refuses to answer at all when the run is parked on none or on more than one. A host built against the previous worker will not compile: `EvolveEffectWorkerOptions` gained required `effects` and `addressing`, `LifecycleJobQueue` is gone because preparing the intent is what enqueues, and `LifecycleContext` no longer takes a job queue, a settle duck or a run id. One experiment now runs end to end over a real repository, the real MAS runtime, the real queue and the real fenced store to a completed run with the registered verdict and the published leg census.

## 0.29.4

Pin the lifecycle version against a real store, and describe the capability where a stranger would look for it. The authored version stores under the identity the author computed, storing identical bytes twice is a read, a run binds the exact version it will run under, and no head is ever activated — an active head is a moving target, and experiments run under a moving target are not comparable with each other, which is the whole reason this package registers one immutable version instead. The resume path is the suite's own reconciler and this package adds no second one; with nothing pending it reports zeros twice over. The architecture document gains the section that says what never happens and why each of those is structural rather than guarded, the boundary document records that the worktree lifecycle and the bounded runner are Tangle-owned because the suite has neither, and names the upstream ask as a bounded process runner with nothing git-shaped above it, and the mutator surface policy is listed as something that must never migrate down: migrated into a general-purpose suite it would become a configurable file filter, which is the same mechanism with the argument removed. The roadmap entry is narrowed to what is actually still open, which corrects a claim that had spread to five separate files before anybody checked whether the round comparator had a caller: acceptance is still decided one experiment at a time, the comparator is published but nothing consults it, the instrument still drives the stages sequentially rather than through the workflow version, and nothing has been measured against a repository that was not the fixture.

## 0.29.3

Add the effect worker, cancellation and the read-only contract, and prove the durable path counts what the sequential one counts. The worker claims an experiment's effect job, runs it under the lease the workflow segment is deliberately not given, and answers the typed wait — using the effect record id as the response key, which is what makes a crash between running and answering cost nothing: the next pass prepares the same semantic plan id, finds every leg settled, replays without spawning and answers with the same key, so the store reads it as the same response rather than a conflict. The one case it will not answer is an unresolved leg; the wait stands and a person reconciles it, because inventing a settlement would turn "nobody can account for this" into a confident record. `cancelExperiment` is a host call rather than a wire operation, and the cleanup after it is a reconciler rather than a node, because a cancelled run executes no further segment and a cleanup node would simply never fire — the second reconciliation pass examines the same runs and settles none. The decision vocabulary is not widened for it: an operator cancel is `abandoned` / `command` / `TEVO1006` and an expiry is `abandoned` / `over-budget` / `TEVO1005`, while who asked lives in the run trace and never on the decision, which has no member for it. The published contract is three operations and all three are reads, with no operation that merges, promotes, approves, runs, cancels or stops an experiment — absent rather than guarded — and a frozen baseline the gate compares against, so adding one is a refused commit rather than a quiet change; a review bundle answers its diff digest and byte count and never the diff text or what the gate printed. The equivalence check earned its place immediately: settling an experiment is cleanup rather than evidence and contributes no leg, so a kept experiment publishes ten legs and not eleven, and counting it would have moved every measured row and broken the campaign's oracle at the end of a long regeneration with nothing to point at.

## 0.29.2

Split each experiment stage into the half that starts work and the half that reads what it settled, and author the lifecycle version those halves will run under. The effect driver now exposes `prepare` beside `run`, and `run` accepts a lease a caller already holds: the durable path writes an effect intent in one process and claims its job in another, and a driver that always claimed its own job would double-claim against a fence that asserts the lease belongs to the plan. `runGate` and `measureFitness` keep their signatures and their behaviour, and are now compositions of `readGateResult` and `readMeasurement` — readbacks that touch no job and spawn nothing, so a resumed experiment reproduces its measurement instead of taking it again. `sealBaseRoot` and `baseSealHolds` are separated for the same reason: sealing the base spawns git, and the seal has to bracket the base batch rather than sit inside a step that also measures.

The lifecycle workflow version is authored, validated and lowered, with its own handler registry: every stage that reaches a process is a task paired with a typed wait, because a segment holds no job lease and so no node may spawn. The base seal is deliberately not a node for exactly that reason — it belongs to the worker that runs the base batch. Authoring twice yields the same version id, since nothing in it reads a clock or a random source.

Nothing drives this yet. There is no worker, the instrument still runs the sequential path, and the sixteen registered rows are unchanged — so this release adds no capability a host can use, only the shape the next one will need.

## 0.29.1

Refuse to compare two rounds that answered a different number of experiments. `compareRounds` read the score alone, and the score is kept over attempted where an experiment that never ran is not an attempt — so the count moved the ratio on its own, in both directions. A candidate that broke on the fifteen hard proposals and kept the one easy one scored 1/1 against an incumbent's 1/16 and was accepted; a candidate that padded the round with ten trivial proposals scored 11/26 against the same incumbent and was accepted too. Neither had repaired anything. That is the goalpost move the surface policy refuses in a patch, arriving through the scoreboard instead, and it is now refused on the same grounds: a score is evidence only while it is still answering the same question. The registration an experiment round runs over is immutable, so two legitimate rounds always attempt the same count, and an inequality means something changed that the score cannot see — the incumbent stands. The published prose that said failures aggregate before anything is accepted is corrected in the same pass: the round score is evidence published beside the per-experiment decisions, nothing calls the comparator yet, and `planExperimentDecision` still owns every acceptance.

Make the experiment runner's deadline reach the whole process tree. `child.kill()` signals one process, and a gate command is rarely one process — `node --test` runs each test file in its own worker. So a gate that outran its deadline had its root killed and its workers left alive, reparented to init, each holding a CPU for as long as the machine stayed up, while the runner reported a tidy `SIGKILL` and a correct `TEVO1005`: the leak was invisible precisely where the deadline was supposed to be the proof that nothing escaped. The registered experiment pool contains a proposal whose whole purpose is to make the gate hang, so every run of the instrument leaked workers. The child is now spawned as its own process-group leader and the deadline signals the group by negative pid, with the single-process kill kept as the fallback and as the only option on Windows. A regression test spawns a grandchild that would outlive its parent and asserts it is gone after the deadline fires.

## 0.29.0

Add the contracts an isolated repository experiment is made of, as a zero-I/O package that cannot merge anything. Every record is closed and content-addressed — its id is the canonical hash of its own bytes without the id, and no clock enters that hash, so the same experiment re-derived later has the same address and a replay can prove it read what it claims to have read. The lifecycle is one pure exhaustive table: every status and command pair is either the single legal target or a refusal pointing at `/status`, and the four terminal statuses accept nothing, so a stopped experiment cannot be nudged back into motion by a second command. A principal carries `propose`, `execute` and `approve` and the schema refuses a `merge`, `push` or `promote` member: the authority to land a change is absent from the vocabulary rather than defended at a call site, and keeping a change produces a branch and a review bundle for a person to merge. Budgets name every bound an experiment can reach, with `attemptsPerLeg` pinned at one, because a process boundary that was lost is not evidence the effect did not happen. `EvolveStore` keeps immutable records apart from the one revision-fenced experiment row: writing the same bytes twice is a read, writing different bytes under an existing id is refused, and a status moves only under compare-and-swap — with an in-memory reference and a SQLite adapter whose answers are asserted identical over one recorded scenario. Strategies are written through the owners that already exist, one skill in the context ledger and one memory carrier in the outcome store, and a refusal from either is carried back with its own reason intact. The `evolve-experiment/v1` outcome adapter scores a kept change as success and an equal one as partial, and counts a refusal as a strategy failure rather than a neutral event.

Close the loop: a committed candidate is now gated, measured, decided, settled and recorded, and the instrument reproduces its registered oracle exactly — sixteen of sixteen adversarial proposals landing on the decision written down before any of them could run. The gate reads its exit code and nothing else, because a child that can print can print a convincing success; what it printed is kept beside the record for a reviewer and hashed into no identity. A gate that FAILED and a gate that never finished are kept apart, which is what the whole flake policy rests on: a clean non-zero exit is red and earns exactly one rerun, while a run killed at its deadline, drowned in output, or over its workspace budget reached no verdict at all and earns none — calling it red would credit it with an opinion it never formed and spend the rerun on running out of budget again. Red then red is red, red then green is ambiguous, and both abandon; there is no third attempt. Fitness runs only behind a green gate, over the registered instrument, and a sample that cannot be read is a counted refusal rather than a retry, because re-running a sample until it parses is how a measurement quietly becomes a search for the answer somebody wanted. The base median must still equal the registered truth or every number in the run is unverifiable, flattering ones included — a candidate number is only evidence while the base still measures what it claims to. The base side runs in the repository root under its own allow-list name, bracketed before and after by a revision, cleanliness and byte-digest seal, so an instrument that writes into the base invalidates the run instead of the run publishing a comparison against a moving target. One pure planner decides, total over its input and without a default branch, with two orderings that are not arbitrary: an unresolved effect outranks everything, because deriving a tidy abandon from evidence nobody can account for would be the most dangerous available convenience; and over budget outranks red, for the reason above. Only a strict improvement is kept, and keeping one removes the worktree and leaves the branch unmerged with a review bundle addressed to a person — every other outcome leaves nothing but records, and an uncertain one is left exactly as it is for somebody to look at. What an experiment meant is recorded through the outcome lifecycle and nowhere else: the sealed decision is pinned evidence a trusted resolver supplies, an unresolvable citation is a refusal rather than empty evidence, confidence moves only inside the outcome service's own transaction, and a cited carrier that is missing is reported and refused rather than created on the way past. Promotion is not taken at all — the selection artifact keeps empty weights, and the automation principal is refused if it asks to approve.

Add the guarded patch path, and with it the first refusals this campaign can measure rather than describe. A proposal is an RFC 6902 patch over a file map and nothing else: `move` and `copy` are absent because a rename written as one operation would be invisible to every rename detection here, and `test` is absent because a patch that can assert can branch. The immutable surface is compiled from the repository record rather than the worktree, so nothing a patch writes can reach the rules that judge it — a mutator cannot move goalposts that are not in the tree it edits. Five detections run in order, each naming its rule: a path that does not normalize or that case-folds onto another, a direct edit of a protected or generated file, a rename caught by identical content or a reappearing basename, a symlink among the changes, and a budget in bytes or files. The rename check runs a second time over git's own staged view, because the first is structurally blind to a rename made between reading the file map and writing it. The patch itself is applied on a copy through the suite's guarded editor — the one consumer of it in this package — whose failure keeps the engine's own code and pointer as the cause, and whose commit refuses outright, because preparation never writes: the host applies the plan as a recorded effect instead.

Add the Node-only host that runs an experiment without ever holding the authority to land one. A command is selected by name from a table the host wrote, so nothing that crossed a trust boundary can become an executable, an argument a validator did not accept, a working directory outside the declared root — checked after resolving both ends, so a symlink cannot walk out — or an environment variable the allow-list does not carry. The git vocabulary is an allow-list of whole argument vectors: `push`, `merge`, `switch`, `checkout`, `reset`, `rebase`, `remote` and `config` are not refused, they are absent, and so are the global options that would let git run something else or somewhere else. A ref is either an experiment branch or a pinned commit; every other spelling fails before a spawn. The worktree host refuses a root inside the repository, a dirty base, a second experiment on an existing branch, a write that traverses out through `..` or a symlinked parent, and a commit whose HEAD is read at the moment of committing rather than assumed. A removal that does not succeed is uncertain rather than failed, because a workspace that may still exist is a question for a person. Every effect is one leg of a fenced operation over the suite's external-effect store on the Tangle database: the intent is written before anything reaches the world, the outcome is classified from exit codes and never from what the child printed, a single-send leg is never retried, and a plan id is semantic — so a resumed experiment reads what happened instead of making it happen again. The instrument's four host probes now execute rather than declaring themselves missing.

Add the layer that reads failures as evidence rather than as instructions. Deciding one experiment at a time is the whole of what this package did, and a mechanism built only on that would be optimizing against the wrong thing: any single failure has two possible causes and no way to tell them apart, so treating each one as a direct instruction to change bends the mechanism around whatever it happened to see, narrows what it will accept, and makes it worse at cases nobody showed it. What separates evidence about the mechanism from evidence about one instance is recurrence across distinct instances, so failures are grouped into patterns and a pattern is called systematic only when at least two unrelated instances produced it — an inductive bias, stated as one named threshold rather than buried, with single-instance patterns kept as evidence rather than discarded. Groups form at two levels that disagree on purpose: read by reason a lone escape or a lone red looks like a one-off, and rolled up by the stage that produced it the same stage turns out to be indicted by unrelated instances wearing different names. The share of failures that recur is published as the evidence that would license a mechanism-level repair at all; the share of changes that merely accommodate one model's quirks is deliberately not computed, because that number needs modification decisions to exist and nothing here modifies itself yet. Beside it, a round now reduces to one scalar, and a candidate is accepted only on a strict improvement of that scalar — per-instance acceptance cannot see a change that fixes the case in front of it while quietly breaking two others, and a tie is rejected because equal evidence is not a reason to move and keeping the incumbent is the cheaper error. Every part of it is pure and total: it reads decided rows and answers counts, runs no process, reads no file, and decides nothing about any individual experiment.

## 0.28.0

Keep the evidence an accepted verdict was recorded against. The model gains `feedback_notes` — one row per evidence source, addressed by the source id the resolution names and indexed by the message it is about, holding the sealed snapshot with the digest that snapshot hashes to. A trusted evidence resolver reads that row back rather than rebuilding it, so a snapshot that is gone or whose bytes have moved is refused by the outcome lifecycle instead of quietly re-agreeing with itself. The transcript rows gain the decision a reply is and the verdict recorded against it, so a surface can show what was recorded without re-deriving it.

Move the store onto the Jaren 0.90.6 registry foundation and source pin. The
underlying native store now retries a classified busy failure of its idempotent
open sequence, yielding between bounded attempts so a competing opener can
finish, and closes capture's first-open transaction before the collection cores
are constructed. Bun connections drain their native statements on close. Tangle
reads these through the existing `openStore` seam: no Tangle API changes, and
the synchronous live-query engine the memory store depends on is retained
rather than traded for the new asynchronous worker, pool and process hosts.
Every keyless benchmark document is requalified against the new foundation; the
executable identity a run records moves with the installed suite version, so
checkpoints written under the previous foundation are refused rather than
silently resumed.

Publish the adapter-construction kit a host needs to register its own outcome domain: `adapterIdentity` builds the pinned schema-and-scorer identity the service re-hashes at registration, `domainValidator` compiles one domain schema into the validator that boundary uses, and `checkedAdapter` composes an adapter's four validators with its payload check. They were already the recipe every in-tree adapter follows; an out-of-tree host previously had to reimplement the identity hash to be accepted, and a reimplementation that drifted by one byte was refused as an unregistered revision rather than as the mistake it was.

Give every run a persisted, append-only frame stream addressed by `(runId, seq)`. The model gains `run_frames` — one row per thing a run did, its body closed per kind by a validator at the write and its sequence read from the store inside the appending transaction, so a restart, a second process or two concurrent appends can never mint the same address twice — and `runs.status` gains `cancelled`, a terminal state distinct from both success and failure. `createRunLog` adds `appendFrame`, `frames`, `replayPage`, `subscribeRun` and `subscribeRuns`: a subscriber names the run it watches and resumes by the sequence it reached, a replay page carries exactly the frames above a cursor and never asks for a reset, and the live emission's store-wide capture sequence is re-emitted under the appended frame's own, so a resume cursor means the same thing live and replayed. `finishRun` writes the run row and the run's single terminal frame in one transaction — including a refused finish — and `recordEvent` keeps its signature over the new stream. The existing `events` collection stays declared and is read-only: a run has rows in exactly one of the two, and `getRun` answers their union plus the run's frame count. Folder passes record what they counted: the `sync` frame kind carries the trigger that asked for a pass and the scanned, ingested, skipped, removed, truncated and orphaned-unit numbers it produced, closed like every other body so a member nobody declared is refused at the write.

Add immutable skill directories, the anchored directory-patch compiler and revision-fenced activation, with in-memory and SQLite storage, plus starting-directory import, a trajectory-blind draft, a bounded executor that uses a directory directly, a resumable labeled-rollout fan-out, and one independent analyst per rollout whose failure path may propose a patch only after the host evaluator passes over a repair made in an in-memory sandbox, and hierarchical conflict-free consolidation of the whole patch population into one patch applied exactly once through a guarded editor into a staged immutable candidate. Role prompts ship as five versioned TOML packs compiled into an immutable artifact set published at `./artifacts`, whose revisions are the prompt versions a run's idempotency keys name, and a host can use an active directory directly — its root page composed into the request as data and one read-only tool over the rest — with no retrieval index between the directory and the task.

Keep a produced measurement document under the identity its own instrument computed. The model gains `reports` — one row per document, keyed by that identity and indexed by instrument and instant, holding the document, its byte size, the run that produced it and the source manifest the document itself declares — so a host can address a report by identity, re-derive that identity from the stored bytes, and answer honestly when they no longer agree instead of repairing a row nobody is allowed to repair. Because an instrument re-run over an unchanged tree recomputes the same identity, the second write is a read: the row is already there, and the run that stored it keeps its name. Runs gain the two frame kinds a measurement needs: `progress`, a bounded batch of output lines from one stream with the number a producer had to drop rather than grow the stream without limit, and `report`, the identity, instrument, schema, byte size, file count and whether this run stored the document or found it already held. Both bodies are closed like every other frame body, so a member nobody declared is refused at the write.

## 0.27.3

Limit active release CI to Linux and the minimum supported Node consumer gate. Preserve the complete Windows workflow outside the active Actions directory for the future 1.0.0 release, with restoration instructions. Package runtime behavior is unchanged.

## 0.27.2

Integrate the Jaren 0.89.0 registry foundation and source pin. Qualify guarded host migrations with preserved Tangle evidence, durable replay and failure isolation, and native Markdown page breaks through the existing assistant renderer. Preserve the selected memory policy and requalify current benchmark evidence.

## 0.27.1

Keep consolidation source receipts portable across fresh and working checkouts by excluding ignored build outputs while preserving effective source edits and explicitly named inputs. Requalify the fixed consolidation and temporal measurements against clean-checkout source identities.

## 0.27.0

Add opt-in bounded extractive consolidation plans and Jaren lexical evidence routing, with atomic replay and matched LoCoMo attribution.

Label archived sizes in UTF-16 characters and refuse contradiction comparisons across embedding identities. Add registered, source-delivery controls for measuring context consolidation.

Add opt-in host-driven consolidation triggers and closed Jaren contract operations, with durable arrival/completion timing, restart-aware cooldown, bounded scheduling and drained close.

Add immutable consolidation source snapshots, artifacts, bounded pending buffers and atomic pass/operation receipts with memory and Node/Bun SQLite parity. Preserve source evidence and qualify replay, rollback, concurrent activation and installed consumers.

Add supported structured consolidation with durable callback reservations, staged restart, explicit unknown resolution, fresh embedding validation and atomic activation. Preserve overlapping evidence until active work is resolved, and expose logical-call accounting without claiming provider usage.

Reject duplicate synthesis claims before support or embedding and refuse malformed direct executor requests before effects. Document the opt-in tiers, host operations, durable recovery and measured retrieval limits, with an installed Node/Bun example.

## 0.26.3

Qualify concurrent outcome promotions without assuming which request wins, and replay the actual winning receipt while retaining every stale-head assertion.

Keep SQLite verification scratch owned by the Node parent until each tested runtime exits, preserving close/reopen checks and failing persistent cleanup errors.

## 0.26.2

Include the temporal memory and Jaren authoring guides linked by the package READMEs in npm distributions. Verify every package-owned Markdown guide against the actual npm archive inventory and read the installed temporal guide in both Node and Bun consumers.

Correct package ownership checks for native and escaped filesystem paths. Let the backup probe parent clean its temporary directory after the Node or Bun child exits, retaining every WAL snapshot, integrity, cancellation and zero-effect replay assertion and failing on persistent cleanup errors.

## 0.26.1

Normalize native repository paths before discovering GMPL prompt packs, selecting stage schemas and hashing benchmark source manifests. Share one development inventory across artifact and benchmark builds so Windows excludes the outcome pack consistently with POSIX hosts. Preserve the fourteen shipped prompt artifacts and existing benchmark controls.

## 0.26.0

Add opt-in evidenced temporal memory with distinct occurrence, observation, knowledge and validity semantics, bounded structured preparation, immutable SQLite projections and cited calendar answers. Qualify public Node, Bun and browser consumers, strict temporal fixtures and both full LongMemEval source profiles. Preserve ordinary recall defaults; live temporal QA gains and deployment costs remain unmeasured.

## 0.25.1

Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.

## 0.25.0

Add immutable schema-bound prompt artifacts, evidence-preserving pattern recipes and pure host bindings for the MAS runtime.

Enforce semantic template binding targets, monotone caps and tool subsets at admission and instantiation. Pin and capture host message adapter versions, check child graph bindings, and preserve optional no-change instantiation.

Enforce workflow concurrency through Jaren scheduling, retain failed physical request costs in durable receipts, restore switch outputs from committed branches, and preserve hierarchical message paths. Advance the runtime checkpoint ABI for the changed execution semantics.

Compose durable human waits through nested graphs, switches and loop iterations.
Derive interaction ids from full paths, reconcile the current reserved resume
segment, and reject conflicting response bytes under an existing key. Drain
started host lifetimes before reporting failure or suspension.

Enforce physical-request context and retained trace quotas, retain the shared
account's provider-total or estimated token charge, and claim-fence cumulative
active-time settlement across resumable segments. Quota refusals roll back the
attempted payload while retaining actual failure costs.

## 0.24.1

Update the Jaren foundation to 0.86.0 with exact registry and source pins. Qualify supervised Node SQLite execution, outcome replay after native backups, and physical-model authoring through the shared Data editor. Document the available relational, migration, cursor and collection-drag mechanisms and their host boundaries.

## 0.24.0

Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

## 0.23.0

Derive memory defaults from a registered held-out policy experiment and expose their values, evidence provenance and measured opt-ins through a public contract. Novelty filtering, contradiction resolution and crystallization now default to off; memory retrieval defaults to k 10 and minScore 0, and the independently measured offline hash width is 512.

Explicit policy overrides retain their meaning. Use the shipped-legacy policy data with a 64-dimensional hash embedder to reproduce the former settings; existing vectors retain their original embedding identity and require re-embedding to rank with the new offline default. Preserve the full live evidence, bounded-null decision and historical losses, enforce purchase and identity boundaries, and gate generated defaults, public contract compatibility, examples and documentation.

## 0.22.0

Convert the migrated source, tests, benchmarks and hosts to strict TypeScript,
with JavaScript and declarations emitted through one release build. Move the
program pen from `@tangleai/jaren/program` and the Jaren integration barrel to
`@tangleai/linq/program`, preserving its JSON format and phantom binding types.
The new `@tangleai/linq` root exposes the program namespace and shared build error.

Match the embedder declarations to unknown widths before the first response,
retain precise ledger result variants, and enforce the refinement-pressure
instrument's stated 60-second deadline through the chat client's abort signal.

## 0.21.1

Make npm publication an explicit local author command with final-commit verification, actionable dirty-tree errors, and no automatic CI publication.

Update the exact Jaren foundation dependencies and source pin to the published
0.84.3 release after verifying its AI-free archives against source-built bytes.
Retain Tangle's model, context and agent ownership and align the development
Node pin with 24.20.0. Tangle publication remains a manual author action.
Allow release preparation after an already committed local release while
preserving its record and rejecting unprepared version edits.

## 0.21.0

Use the models, context and agents owners of the inherited AI mechanisms. MAS
executable identity version 3 names all executed mechanism versions; an old
executable checkpoint is refused intact through the existing mismatch path.
Memory and ledger records retain their schemas and projection contracts.

Add independent model transport, evidence-backed context, and bounded agent/program packages. Preserve the JavaScript/JSDoc APIs, strict result contracts and injected host services, with JavaScript distributions and checked declarations. Toolbox browser registration delegates to Jaren's shared WebMCP contract.

Receive the reusable assistant and injected slot ledger storage, preserving
streaming, transcript and evidenced-memory behavior with owned cleanup.

Provide Jaren grammar authors, typed AI program construction and revision-checked shared editor adapters.

## 0.20.1

Wait for npm publish-time scanning before verifying fresh installations. Upload the complete suite, then poll full and install package indexes for up to 20 minutes, requiring matching versions, integrity and latest tags. Keep mismatched artifacts fatal and report packages that remain unavailable, so direct main releases can finish without manually retrying normal scan delays. Complete each release from the successful publication attempt's exact artifact ID, preserving earlier failed receipts without selecting them.

## 0.20.0

Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.
