# @tangleai/store

## 0.28.0

### Minor Changes

- f2eb14d: Keep the evidence an accepted verdict was recorded against. The model gains `feedback_notes` — one row per evidence source, addressed by the source id the resolution names and indexed by the message it is about, holding the sealed snapshot with the digest that snapshot hashes to. A trusted evidence resolver reads that row back rather than rebuilding it, so a snapshot that is gone or whose bytes have moved is refused by the outcome lifecycle instead of quietly re-agreeing with itself. The transcript rows gain the decision a reply is and the verdict recorded against it, so a surface can show what was recorded without re-deriving it.
- f2eb14d: Give every run a persisted, append-only frame stream addressed by `(runId, seq)`. The model gains `run_frames` — one row per thing a run did, its body closed per kind by a validator at the write and its sequence read from the store inside the appending transaction, so a restart, a second process or two concurrent appends can never mint the same address twice — and `runs.status` gains `cancelled`, a terminal state distinct from both success and failure. `createRunLog` adds `appendFrame`, `frames`, `replayPage`, `subscribeRun` and `subscribeRuns`: a subscriber names the run it watches and resumes by the sequence it reached, a replay page carries exactly the frames above a cursor and never asks for a reset, and the live emission's store-wide capture sequence is re-emitted under the appended frame's own, so a resume cursor means the same thing live and replayed. `finishRun` writes the run row and the run's single terminal frame in one transaction — including a refused finish — and `recordEvent` keeps its signature over the new stream. The existing `events` collection stays declared and is read-only: a run has rows in exactly one of the two, and `getRun` answers their union plus the run's frame count. Folder passes record what they counted: the `sync` frame kind carries the trigger that asked for a pass and the scanned, ingested, skipped, removed, truncated and orphaned-unit numbers it produced, closed like every other body so a member nobody declared is refused at the write.
- f2eb14d: Add immutable skill directories, the anchored directory-patch compiler and revision-fenced activation, with in-memory and SQLite storage, plus starting-directory import, a trajectory-blind draft, a bounded executor that uses a directory directly, a resumable labeled-rollout fan-out, and one independent analyst per rollout whose failure path may propose a patch only after the host evaluator passes over a repair made in an in-memory sandbox, and hierarchical conflict-free consolidation of the whole patch population into one patch applied exactly once through a guarded editor into a staged immutable candidate. Role prompts ship as five versioned TOML packs compiled into an immutable artifact set published at `./artifacts`, whose revisions are the prompt versions a run's idempotency keys name, and a host can use an active directory directly — its root page composed into the request as data and one read-only tool over the rest — with no retrieval index between the directory and the task.
- f2eb14d: Keep a produced measurement document under the identity its own instrument computed. The model gains `reports` — one row per document, keyed by that identity and indexed by instrument and instant, holding the document, its byte size, the run that produced it and the source manifest the document itself declares — so a host can address a report by identity, re-derive that identity from the stored bytes, and answer honestly when they no longer agree instead of repairing a row nobody is allowed to repair. Because an instrument re-run over an unchanged tree recomputes the same identity, the second write is a read: the row is already there, and the run that stored it keeps its name. Runs gain the two frame kinds a measurement needs: `progress`, a bounded batch of output lines from one stream with the number a producer had to drop rather than grow the stream without limit, and `report`, the identity, instrument, schema, byte size, file count and whether this run stored the document or found it already held. Both bodies are closed like every other frame body, so a member nobody declared is refused at the write.

### Patch Changes

- f2eb14d: Move the store onto the Jaren 0.90.6 registry foundation and source pin. The
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
- Updated dependencies [f2eb14d]
- Updated dependencies [f2eb14d]
  - @tangleai/outcomes@0.28.0
  - @tangleai/trace2skill@0.28.0
  - @tangleai/config@0.28.0
  - @tangleai/core@0.28.0
  - @tangleai/documents@0.28.0
  - @tangleai/mas@0.28.0
  - @tangleai/memory@0.28.0

## 0.27.3

### Patch Changes

- Updated dependencies [9f7d8c8]
  - @tangleai/core@0.27.3
  - @tangleai/config@0.27.3
  - @tangleai/documents@0.27.3
  - @tangleai/mas@0.27.3
  - @tangleai/memory@0.27.3
  - @tangleai/outcomes@0.27.3

## 0.27.2

### Patch Changes

- 1a1cf01: Integrate the Jaren 0.89.0 registry foundation and source pin. Qualify guarded host migrations with preserved Tangle evidence, durable replay and failure isolation, and native Markdown page breaks through the existing assistant renderer. Preserve the selected memory policy and requalify current benchmark evidence.
- @tangleai/config@0.27.2
  - @tangleai/core@0.27.2
  - @tangleai/documents@0.27.2
  - @tangleai/mas@0.27.2
  - @tangleai/memory@0.27.2
  - @tangleai/outcomes@0.27.2

## 0.27.1

### Patch Changes

- Updated dependencies [422afcd]
  - @tangleai/memory@0.27.1
  - @tangleai/config@0.27.1
  - @tangleai/core@0.27.1
  - @tangleai/documents@0.27.1
  - @tangleai/mas@0.27.1
  - @tangleai/outcomes@0.27.1

## 0.27.0

### Minor Changes

- d4d8d0b: Add immutable consolidation source snapshots, artifacts, bounded pending buffers and atomic pass/operation receipts with memory and Node/Bun SQLite parity. Preserve source evidence and qualify replay, rollback, concurrent activation and installed consumers.

### Patch Changes

- Updated dependencies [84fe0a2]
- Updated dependencies [6dcfde9]
- Updated dependencies [a6fa7f3]
- Updated dependencies [d4d8d0b]
- Updated dependencies [63504f3]
- Updated dependencies [7f2e26f]
  - @tangleai/memory@0.27.0
  - @tangleai/core@0.27.0
  - @tangleai/outcomes@0.27.0
  - @tangleai/documents@0.27.0
  - @tangleai/config@0.27.0
  - @tangleai/mas@0.27.0

## 0.26.3

### Patch Changes

- 9cc91c1: Keep SQLite verification scratch owned by the Node parent until each tested runtime exits, preserving close/reopen checks and failing persistent cleanup errors.
- Updated dependencies [36b6a1d]
- Updated dependencies [9cc91c1]
  - @tangleai/outcomes@0.26.3
  - @tangleai/memory@0.26.3
  - @tangleai/config@0.26.3
  - @tangleai/core@0.26.3
  - @tangleai/documents@0.26.3
  - @tangleai/mas@0.26.3

## 0.26.2

### Patch Changes

- b03ca31: Correct package ownership checks for native and escaped filesystem paths. Let the backup probe parent clean its temporary directory after the Node or Bun child exits, retaining every WAL snapshot, integrity, cancellation and zero-effect replay assertion and failing on persistent cleanup errors.
- Updated dependencies [4c42ba1]
  - @tangleai/memory@0.26.2
  - @tangleai/config@0.26.2
  - @tangleai/core@0.26.2
  - @tangleai/documents@0.26.2
  - @tangleai/mas@0.26.2
  - @tangleai/outcomes@0.26.2

## 0.26.1

### Patch Changes

- @tangleai/config@0.26.1
  - @tangleai/core@0.26.1
  - @tangleai/documents@0.26.1
  - @tangleai/mas@0.26.1
  - @tangleai/memory@0.26.1
  - @tangleai/outcomes@0.26.1

## 0.26.0

### Minor Changes

- 6e0f5be: Add opt-in evidenced temporal memory with distinct occurrence, observation, knowledge and validity semantics, bounded structured preparation, immutable SQLite projections and cited calendar answers. Qualify public Node, Bun and browser consumers, strict temporal fixtures and both full LongMemEval source profiles. Preserve ordinary recall defaults; live temporal QA gains and deployment costs remain unmeasured.

### Patch Changes

- Updated dependencies [6e0f5be]
  - @tangleai/core@0.26.0
  - @tangleai/memory@0.26.0
  - @tangleai/documents@0.26.0
  - @tangleai/outcomes@0.26.0
  - @tangleai/config@0.26.0
  - @tangleai/mas@0.26.0

## 0.25.1

### Patch Changes

- Consume the exact Jaren 0.87.0 registry packages and source pin. Qualify native SQLite schema changes, column references, JSON type inspection and per-call mutation semantics alongside Tangle records across Node, Bun and installed consumers. Preserve the existing document storage model and historical paid measurements.
- Updated dependencies
  - @tangleai/core@0.25.1
  - @tangleai/config@0.25.1
  - @tangleai/mas@0.25.1
  - @tangleai/documents@0.25.1
  - @tangleai/memory@0.25.1
  - @tangleai/outcomes@0.25.1

## 0.25.0

### Patch Changes

- Enforce semantic template binding targets, monotone caps and tool subsets at admission and instantiation. Pin and capture host message adapter versions, check child graph bindings, and preserve optional no-change instantiation.

  Enforce workflow concurrency through Jaren scheduling, retain failed physical request costs in durable receipts, restore switch outputs from committed branches, and preserve hierarchical message paths. Advance the runtime checkpoint ABI for the changed execution semantics.

  Compose durable human waits through nested graphs, switches and loop iterations.
  Derive interaction ids from full paths, reconcile the current reserved resume
  segment, and reject conflicting response bytes under an existing key. Drain
  started host lifetimes before reporting failure or suspension.

  Enforce physical-request context and retained trace quotas, retain the shared
  account's provider-total or estimated token charge, and claim-fence cumulative
  active-time settlement across resumable segments. Quota refusals roll back the
  attempted payload while retaining actual failure costs.
- Updated dependencies
  - @tangleai/mas@0.25.0
  - @tangleai/config@0.25.0
  - @tangleai/core@0.25.0
  - @tangleai/documents@0.25.0
  - @tangleai/memory@0.25.0
  - @tangleai/outcomes@0.25.0

## 0.24.1

### Patch Changes

- Update the Jaren foundation to 0.86.0 with exact registry and source pins. Qualify supervised Node SQLite execution, outcome replay after native backups, and physical-model authoring through the shared Data editor. Document the available relational, migration, cursor and collection-drag mechanisms and their host boundaries.
- @tangleai/config@0.24.1
  - @tangleai/core@0.24.1
  - @tangleai/documents@0.24.1
  - @tangleai/mas@0.24.1
  - @tangleai/memory@0.24.1
  - @tangleai/outcomes@0.24.1

## 0.24.0

### Minor Changes

- Add the outcomes package for independently evidenced decisions, deterministic scoring, atomic confidence projection, bounded artifact refinement and explicitly approved promotion and rollback. The public operation contract, two-domain adapter kit and keyless example share the same scoped request receipts, one-use held-out gates, full head revision checks and interruption recovery.

  The store adapter owns outcome records and memory changes in one SQLite transaction. The new pure confidence helper preserves fact fields; existing applyOutcome calls retain their original duplicate-citation and timestamp behavior and do not acquire a durable replay guarantee. No existing persisted memory format changes. Hosts opt into the new lifecycle, provide evidence and approval authority, and use a new artifact key for schema or policy changes. Scripted paired measurements and Node/Bun packed consumers qualify the mechanism; downstream domain integrations and automatic promotion remain separate work.

### Patch Changes

- Updated dependencies
  - @tangleai/outcomes@0.24.0
  - @tangleai/memory@0.24.0
  - @tangleai/config@0.24.0
  - @tangleai/core@0.24.0
  - @tangleai/documents@0.24.0
  - @tangleai/mas@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies
  - @tangleai/memory@0.23.0
  - @tangleai/config@0.23.0
  - @tangleai/core@0.23.0
  - @tangleai/documents@0.23.0
  - @tangleai/mas@0.23.0

## 0.22.0

### Patch Changes

- @tangleai/config@0.22.0
  - @tangleai/core@0.22.0
  - @tangleai/documents@0.22.0
  - @tangleai/mas@0.22.0
  - @tangleai/memory@0.22.0

## 0.21.1

### Patch Changes

- Update the exact Jaren foundation dependencies and source pin to the published
  0.84.3 release after verifying its AI-free archives against source-built bytes.
  Retain Tangle's model, context and agent ownership and align the development
  Node pin with 24.20.0. Tangle publication remains a manual author action.
  Allow release preparation after an already committed local release while
  preserving its record and rejecting unprepared version edits.
- Updated dependencies
  - @tangleai/core@0.21.1
  - @tangleai/config@0.21.1
  - @tangleai/mas@0.21.1
  - @tangleai/documents@0.21.1
  - @tangleai/memory@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.21.0
  - @tangleai/config@0.21.0
  - @tangleai/mas@0.21.0
  - @tangleai/documents@0.21.0
  - @tangleai/memory@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.1
  - @tangleai/config@0.20.1
  - @tangleai/documents@0.20.1
  - @tangleai/mas@0.20.1
  - @tangleai/memory@0.20.1

## 0.20.0

### Minor Changes

- Establish the coordinated 0.20.0 release with JavaScript and TypeScript declaration distributions, preserved public subpaths and JSON schemas, and verified Node and Bun consumers. Use published JarenJS 0.83.3 fixes without a consumer installation patch. Prepare versions before release commits, verify locally, push directly to main and publish CI-verified tarballs. Deploy the website independently from local Tangle workspace source with JarenJS packages from npm, verifying dependency sources and the live commit.

### Patch Changes

- Updated dependencies
  - @tangleai/core@0.20.0
  - @tangleai/config@0.20.0
  - @tangleai/mas@0.20.0
  - @tangleai/documents@0.20.0
  - @tangleai/memory@0.20.0
