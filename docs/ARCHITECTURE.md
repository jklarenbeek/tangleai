# Architecture

Tangle builds model, context, agent, memory and orchestration mechanisms, and
the applications around them, on the JarenJS suite. Jaren supplies generic
engines, contracts, storage and complete editors; Tangle keeps only what Jaren
does not do. This document records what the source cannot say on its own: where
the ownership line runs, the invariants every package keeps, and the reasons
behind choices that look arbitrary in isolation. Each package's README and
`src/` are the reference for its API. [PAPERS.md](PAPERS.md) records where each
research idea stands and [ROADMAP.md](ROADMAP.md) what is still wanted.

## Where things live

| Area | Packages | Read first |
|---|---|---|
| Model, context and agent mechanisms | `models` (chat, embeddings, provider wires, structured output, replay), `context` (ledger, bounded environment, evidence, recall), `agents` (tool loops, budgets, programs, refinement) | their READMEs |
| Jaren-facing authoring | `jaren` (model authors over Jaren grammars and the Studio/Data/Flow editor operations), `linq` (immutable document pens; `/program`) | [AUTHORING](../packages/jaren/docs/AUTHORING.md), [PROGRAM-PEN](../packages/linq/docs/PROGRAM-PEN.md) |
| Shared data and policy | `core` (closed schemas, TA errors, k-means, lexical adapter), `memory`, `config`, `outcomes`, `search` | `packages/core/src/schemas/` |
| Durable execution | `mas` (workflow IR, gates, lowering, node lifecycle), `store` (SQLite host for memory, outcomes, MAS, run log), `pipeline` (the memory loop as a `jaren-dag` document) | `packages/mas/src/lower.ts`, `packages/store/README.md` |
| Domains over MAS | `gmpl`, `hera`, `research`, `trading`, `forecast`, `grounding`, `lightrag`, `trace2skill`, `evolve`, `experiential`, `documents` | each README; runnable `examples/*.ts` |
| Surfaces | `components/assistant`, `components/os`, `apps/desktop`, `apps/pages`, `apps/research-runner`, `apps/scraper` | [components/os/README.md](../components/os/README.md) |
| Measurement | `benchmark/` (private workspace, never imported by a package) | [benchmark/README.md](../benchmark/README.md) |

## The boundary

### The rule

Generic validation, guarded mutation, contract projection, typed document
capture, storage and Studio/Data/Flow editing stay in Jaren, and Jaren has no
Tangle dependency. `models`, `context` and `agents` are reusable mechanisms with
injected host services; they never import `core`, `config`, `memory`,
`pipeline`, `store`, `mas` or `outcomes`. Applications and policy packages own
databases, scheduling, configuration and product decisions.

A new seam needs a concrete consumer, deterministic tests and a written
dependency argument. Reuse a shipped compiler or component before adding an
implementation. A model proposal validates and publishes through the same
revision checks as a manual edit; the host keeps execution and lifecycle
ownership.

### What must never migrate down

Graph-database drivers, embedding wires that are not OpenAI-compatible,
SearxNG, TOML prompt packs, schedulers, HTTP servers, desktop shells, and any
policy whose justification is a paper rather than a measurement Jaren publishes.

The **mutator surface policy** of `@tangleai/evolve` stays here for a sharper
reason: it decides which files a proposed change may not touch, compiled from
the repository record rather than the tree being edited, so a change cannot
move the goalposts that judge it. Moved into a general suite it would become a
configurable file filter, which is the same mechanism without the argument.

### The one load-bearing contract

`toLedgerMemory()` in `packages/core/src/schemas/memory` projects a Tangle
memory unit onto a Jaren ledger memory: `id`, `text`, `evidence`, `tags`, `at`
and, when present, the `embedding` + `embeddedBy` pair (both or neither).
Tangle's schema is a strict superset under the same names. The ledger refuses
unknown members, so the projection is the only door.
`test/memory/ledger-mirror.test.ts` pins that the projection is admissible to an
unmodified `createLedger`, recallable there by tag and by meaning, stored
verbatim, and that a full Tangle unit is refused. If that test breaks, the two
projects have drifted at the seam that matters most.

### Changing a shared foundation

Use concrete friction to improve the package that owns the behaviour. For a
Jaren foundation: build in Tangle against today's seams and note the
workaround; when the same workaround appears a second time, write the minimal
seam proposal (contract, a Jaren-internal consumer, its test) into the
gitignored ask file for the sibling repository; once it lands upstream, delete
the workaround. Upstream friction is never patched into installed packages.

## What the suite already has

Read this before building. The expensive mistake downstream is not putting
something on the wrong side of the line; it is building something the line
already has.

| Need | Jaren owner | Tangle consumer |
|---|---|---|
| A question over a corpus that does not fit a request | `createEnvironment`, `compileProgram` + `createProgramRunner`, `createLongHorizonAgent` (in `@tangleai/context`/`agents`) | the `long-horizon` row of `benchmark/lib/locomo-qa.ts` |
| Cost and a run that stops instead of overrunning | `createBudgetAccount`, the agent `budget`, one account per recursion tree | every metered call; `estimateTokens` is a truncation helper, never a cost |
| Structured output with repair | `createStructuredOutput`, coded errors with `docPath` | judges, extraction, grounded answers |
| Guarded self-modification | `createGuardedRefiner` (`@jarenjs/core/guarded`), `@jarenjs/json/patch` | outcomes, trace2skill, evolve, research, forecast, HERA; `createRefiner` specializes it for the ledger |
| Bounded child processes | `createProcessExecutor` (`@jarenjs/core/process-node`), `createExternalEffects` | `@tangleai/evolve/host` (git allow-list and `TEVO` codes stay Tangle's) |
| Durable work | `@jarenjs/db` jobs, leases and `checkpointsFor`; `@jarenjs/flow` DAG/FSM with snapshot/resume | `@tangleai/mas`; there is no Tangle job, lease, retry or checkpoint table |
| Scheduling | `@jarenjs/core/schedule` | consolidation and document admission; eligibility, cooldown and default-off stay Tangle policy |
| Lexical search and rank fusion | `@jarenjs/core/search` (`compileLexical`, `reciprocalRankFusion`) | `packages/core/src/lexical` (normalization and tie rules only) |
| Vectors | `@jarenjs/core/vector`; `@jarenjs/db` vector columns and k-nearest plans | `recallByEmbedding`, `rankDocumentChunks`, optional graph vector columns |
| Time, series, geography, finance | `@jarenjs/core/dates`, `/calendar`, `/series`, `/geo`, `/finance`, `@jarenjs/locales` | `memory/temporal`, `memory/place`, `trading` |
| Statistics and seeded randomness | `@jarenjs/core/stats` (`pairedBootstrap`, `quantile`, …), `@jarenjs/core/random` | instruments; the temporal evaluation's group bootstrap is a different statistic and stays local |
| Bounded async mapping, latest-only delivery | `@jarenjs/core/async` (`mapConcurrent`, `createLatestDelivery`) | instruments, the desktop folder watcher |
| Identity of a dataset or report | `@jarenjs/json/canonical` (`canonicalSha256`) | every report and configuration identity |
| Dataset and report validation | `@jarenjs/validate` with `$query` cross-field assertions; `@jarenjs/emit` types | every instrument schema |
| TOML, CSV, iCalendar, GBNF | `@jarenjs/josl` | GMPL and trace2skill packs, instruments, the desktop Calendar |
| Contracts, live streams, shape gates | `@jarenjs/contract` (`subscribe` over a live query, `revision()`, `diffContracts`) | the desktop control plane |
| Replay of paid calls | the `cache` seam on `createChatClient` / `createEmbeddingClient` | `benchmark/lib/wire-cache.ts` is only the SQLite adapter |
| Pipelines as documents, and their drawings | `@jarenjs/flow`, `@jarenjs/mermaid` stylesheets | `packages/pipeline` derives its picture from the executable document |
| Text excerpting and sizing | `@jarenjs/core/chunk` | everywhere; it is not the document chunker (no element or heading model) |

**The suite genuinely lacks these; they are Tangle's:** scholarly metadata
adapters and the arXiv Atom reader (`research`); scientific claim verification
and research exports; a filesystem watcher (host policy,
`apps/desktop/src/watch.ts`); the LoCoMo loader, Porter stemmer and string
metrics written to the official evaluator's spelling (`benchmark/lib/`);
k-means (`core/clustering`, which needs squared distances the suite does not
publish); the grounding claim/citation scorer (`benchmark/lib/grounding*.ts`,
never under `packages/`); and trace2skill's anchored directory-patch compiler,
whose anchor, heading-section, overlap and link-group rules differ from
`@jarenjs/core/text/edits` on purpose. Delegating it would change which
proposals compile.

**Copy the method, not the code.** Jaren's benchmark scripts are not packages.
Their methods are copied: gate the scorer before any number prints (an oracle
row must be exact and a seeded random row must fall in its analytic band);
publish a model-free ceiling beside a model score, so the gap names a retrieval
or a prompt failure; and treat the live tier as never a test dependency, with a
spend ceiling planned up front (`benchmark/lib/ai-env.ts`).

## Invariants every package keeps

- **Edges are injected.** `fetch`, clock, RNG, store, judge, validator,
  embedder and budget arrive from the host. Nothing under `packages/` reaches
  for the network, the clock or the filesystem on import.
- **Plan, then apply.** A policy returns a pure plan value; only the applier
  touches a store.
- **Refusals are values with codes.** Each package owns a closed vocabulary
  (`TA`, `TCFG`, `TMAS`, `TEVO`, `TT2S`, `TRSH`, …). A content problem is a
  returned issue; a throw means a caller or transport defect.
- **Records are closed, immutable and content-addressed.** Schemas refuse
  undeclared members at the store boundary. A head moves only by a
  compare-and-swap of version and revision, and history is superseded or
  archived, never deleted. Evidence is mandatory on memories and outcome reports.
- **Absence is stated, never invented.** Omitted payloads carry an explicit
  state (`retained`, `redacted`, `truncated`, `expired`, `not-configured`,
  `not-run`); unknown cost is unknown, not zero; skipped vectors and refused
  rows are counted in the answer.
- **A person's database changes only by their decision.** Tangle never applies
  a schema change to it automatically, and no AI editor is offered destructive
  DDL; a migration is planned, shown and applied explicitly.
- **No mechanism is on by default without a measurement.** Opt-in lanes stay
  off until a registered report selects them; runtime code reads no benchmark
  artifact. Shipped TypeScript runs directly in the workspace on Node 24;
  published packages ship built JavaScript and declarations checked with
  `skipLibCheck: false`.

### The memory loop

`examples/skeleton.ts` runs the whole loop offline. Two ordering rules are
load-bearing and test-pinned when the ingest policies are enabled:
contradiction runs before crystallization, because a contradiction is nearly
identical to what it contradicts and would otherwise be merged away as a
duplicate; and a resolution equal to the winner's text writes nothing, because
ids are content-addressed and rewriting the winner as an un-embedded summary
would overwrite the embedded fact. The selected defaults and their provenance
live in `packages/memory/src/policy`, never in the config registry.

### Durable execution

`MasWorkflowVersion` is the one canonical IR: the declarative loader and the
imperative pen emit the same bytes, and `versionId` excludes provenance, so
authorship never moves a version. Validation is pure; lowering turns acyclic
regions into `jaren-dag` and control regions into `jaren-fsm` documents, proven
by compilation before activation. Node completion is one transaction (attempt,
messages, state, budget, artifacts); activation is compare-and-swap; a stale
worker commit refuses. Edge-document order is the only aggregation order,
independent of completion timing.

The executable identity (`packages/mas/src/lower.ts`) deliberately includes
the installed Flow, models, context and agents versions. A checkpoint made
under another engine is refused (`TMAS2002`) before any effect, rather than
resumed by a different implementation. A domain package composes MAS; it never
adds its own executor, scheduler or job table.

### Domain packages

Each domain README states its own invariants. The ones that are easy to break
from outside:

- **outcomes** is the only owner of a checked head transition. Research
  lessons, forecast harnesses and trace2skill directories reach activation
  only through it, after independent held-out evaluation and host approval.
- **evolve** can propose, execute and approve, never merge, push or promote:
  those words are absent from the schema and from the git allow-list, not
  refused at a call site. A gate is read by its exit code only, and the
  operator's root must be byte-identical before and after a measurement or the
  run is void.
- **trace2skill** pins one frozen directory hash before any model call; a unit
  whose base differs is refused. Activation is an explicit host action.
- **research**, **forecast** and **grounding** bind every input in a manifest
  before execution; reads outside it refuse, and a clock never creates an
  approval.
- **trading** admits observations by publication time at the snapshot
  boundary; recovery never repeats model spend or a financial effect.
- **experiential** keeps the training backend an injected seam (the suite has
  no parameter-training service); a verified receipt stages an artifact but
  cannot activate it.
- **lightrag** and **memory/consolidation** cite retained originals; a citation
  is a reference, and a reader receives evidence only when the host expands it
  within its context budget.

What a domain measures, and what it does not establish, is stated by its
generated report under `docs/*_BENCHMARK.md`; no surface claims more.

## Configuration identity

A profile name is intent; the run identity stored beside every result is what
actually ran. `config/profiles.json` is the only registry. Capability tags
(`reasoning`, `fast`, `cheap`, …) are declared intent with a required
`limitations` sentence; nothing treats the spelling as proof.

- **Resolution is pure and never falls back.** `resolveProfile` in
  `@tangleai/config` reads no environment, database or network. Inheritance is
  one RFC 7396 parent, revalidated whole. Every refusal is a sorted `TCFG`
  issue; an unservable candidate, a raised budget or a dimension disagreement
  refuses before a paid answer or an index mutation, never selects another model.
- **The identity is content-addressed** over everything that ran (provider,
  base, model, controls, prompt and schema revisions, tools, embedding,
  policy references, budget, rate card). It is never a replay key; the suite
  client's effective-request cache is the only cache identity.
- **Secrets are write-only slots.** A registry names a slot, never a value;
  reads return `null` with presence booleans; saving a read back keeps the
  stored value; only an explicit clear removes it. URL userinfo is refused.
- **One embedding identity per run.** `{ model, dims }` must agree with the
  host's probe; a wire embedder is provisional until its first reply proves
  the width. Changing an indexed corpus's identity is a vector migration, not
  a setting.
- **Named profiles are host policy by provider.** A slot is usable when the
  host holds a key for a provider some candidate names; under a selection, the
  identity is the client specification and stored settings cannot override it.
  `profile: null` is the legacy projection, byte for byte.
- **Probes are explicit**: resolution and every keyless gate make no network
  call. Cost is unknown unless a candidate carries a sourced rate card.

The host adapter is `apps/desktop/src/ai-host.ts`; clients are built only
through `chatClientFor`/`embedderFor` from an `ok` identity. The standing
questions are answered by the query documents in `queries/config/`
(`npm run benchmark:config:queries`).

## The operator control plane

Every live thing on the desktop is a run with an id and a sequence. Frames are
append-only rows in `run_frames` (`@tangleai/store`), and a frame's `seq` is
read inside the appending transaction, so no restart, second process or
concurrent append can mint an address twice. `finishRun` writes the run row and
its single terminal frame in one transaction; `cancelled` is distinct from
success and failure. `runs.live` and `run.live` are `subscribe` operations over
live queries; `Last-Event-ID` means the same live and replayed, so a resumed
subscriber loses and repeats nothing.

- The public contract's shape is gated: a frozen projection sits beside the
  tests, and an undeclared breaking or unclassifiable difference fails.
- A watched folder is a signal, never a list: bursts debounce into one full
  pass, a restart rescans, overflow is counted and answered by a full scan, and
  what was not ingested is published as counts.
- Feedback is an outcome, not a click: a verdict needs a reason and a cited
  item, and the evidence it named is pinned so moved evidence is refused.
- Instruments are host-injected child processes, never imports. Their output
  is screened for credential shapes and stored under its own canonical
  identity; a document whose bytes moved reads as unverified. Only keyless
  instruments register; a run that supplies a budget is refused.

Verified on Linux x64 only (full gate, desktop end to end in Chromium and
WebKit, the compiled binary and WebView). macOS and Windows are unverified, not
known broken.

## Browser hosts

Pages and the desktop mount the complete public Jaren Studio, Data and Flow
components; Tangle owns routes, seeds, storage identities, downloads and worker
bootstraps, and uses no private Jaren site code. The private Pages build pins
`@sqlite.org/sqlite-wasm` and only initializes the official driver; that
initializer never enters a published package. Storage is origin-scoped, and
moving data between origins is the explicit, idempotent procedure in
[BROWSER_DATA.md](migrations/jaren-ai/BROWSER_DATA.md); credentials never move.

Model tools reach the page through the one `@jarenjs/contract/webmcp` adapter.
Tool names are stable so saved callers keep working. Discovery prefers a usable
`document.modelContext`, then `navigator.modelContext`; `ready` must be awaited,
and a pending or partially refused registration is never reported as success.
Cancelling an assistant turn fences late replies, tool calls and child authors,
and an invalid or stale candidate never overwrites human work. Stock browsers
expose neither context root today, so native integration is unavailable and is
recorded separately from the injected compatibility matrix.

## The Jaren foundation and the consumer gate

Jaren is consumed from the source submodule `vendor/jarenjs` as candidate
tarballs, because the registry does not serve current releases.
`node scripts/jaren-artifacts.ts --capture vendor/jarenjs` packs them into the
gitignored `dist/jaren/`; `docs/migrations/jaren-ai/foundations.json` records
each archive's hash, member inventory and dependency edges and is the source of
truth for the version. A fresh checkout runs `--bootstrap` before
`npm ci --ignore-scripts`, which rebuilds the tarballs byte for byte from the
pinned commit. Installed packages are never patched or source-linked.
`release:publish` refuses candidate mode by design.

Three gates keep the pin honest, each small enough to copy into another suite
consumer:

1. **Exact pins** (`scripts/check-jaren.ts`, first in `npm run check`): every
   `@jarenjs/*` reference is one exact version, the lock deep-equals the
   manifests, every installed package resolves to its recorded archive, and the
   submodule gitlink in the index (what the next clone gets) matches.
2. **Packed consumers** (`scripts/release/consumers.ts`): real tarballs
   installed outside the checkout, every runtime fixture on Node and Bun, every
   export typechecked with `skipLibCheck: false`, a browser bundle run with
   browser globals only, and a tree-shaking byte ceiling
   (`scripts/check-program-bundle.ts`). Scratch directories are removed only
   after the child closes.
3. **Toolchain** (`.github/actions/setup/action.yml`): Node from `.nvmrc`, npm
   from `packageManager`, Bun from `release.config.json`, each shape-checked
   before use.

They prove publication and consumption integrity, not application quality.
Where these gates run in a release is in [workflow/RELEASE.md](workflow/RELEASE.md).
