# Tangle releases

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
