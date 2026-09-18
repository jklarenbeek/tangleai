# The measurement workspace

Every number this repository publishes is produced by an instrument in this
folder, and every instrument names the command that reproduces it. Nothing
here is needed to *use* Tangle — it is needed to *believe* it.

The shape is jarenjs's benchmark workspace, re-derived for this repo: upstream
suites arrive as git submodules, tools are plain scripts run from the
repository root, and a shared `lib/` holds host-specific instruments, report
shaping and adapters around the primitives the suite publishes.

Directory source receipts include tracked files and unignored new TypeScript/JSON
source, hashing their effective working-tree bytes. Ignored build/cache outputs
are excluded; tracked files remain included even if an ignore rule matches them.
Explicitly named inputs are always bound. This keeps a fresh checkout and a
working checkout comparable without hiding reviewed source edits or depending
on leftover compiled declarations.

## Why this is a workspace of its own

`package.json` here is private and separate on purpose. CONVENTIONS §1 binds
the shipped packages to `@jarenjs/*` and `@tangleai/*` only — but a benchmark
earns its credibility by measuring against **rivals**, and a rival is a
third-party dependency. Keeping them in this workspace is how a comparison
against another memory system can ever be run without a single new dependency
entering the packages a user installs. jarenjs does exactly this: turf,
sqlite-vec, ajv, XState and a dozen others live in its benchmark workspace and
nowhere else.

The [JarenJS integration comparison](../docs/JARENJS_BENCHMARK.md) records
Node/Bun history strategies; the [integration audit](../docs/JARENJS_INTEGRATION.md)
explains choices against the pinned upstream benchmarks. Reproduce it with
`npm run benchmark:jaren` (keyless).
The current foundation is Jaren 0.91.3. Its native migration, validation and rendering changes
are qualified by the [schema consumer](../test/store/native-foundation.test.ts),
[migration consumer](../test/store/physical-migration.test.ts) and installed
Node/Bun and browser gates. These compatibility checks do not measure an
application memory or speed improvement. Historical paid reports and selected
policy defaults retain their original identities; fresh keyless GMPL, MAS and
outcome reports identify the foundation used by each run.
The [bounded-agent repair](../docs/BOUNDED_AGENT_BENCHMARK.md) measures full-corpus
coverage and cited synthesis against the original twelve-question attempt. The
default `--rows long-horizon` uses `covered-evidence-v1`; pass
`--horizon-strategy legacy` only to reproduce the earlier policy. The repaired
agent keeps the original call cap and records abstentions, execution repairs,
validated leaf reuse and a policy fingerprint separately.

The [paid integration refresh](../docs/PAID_REFRESH.md) links separately dated
answer and grounding attempts, their exact reproduction commands and a live
desktop smoke. The earlier paid reports remain historical evidence. CI validates
the refreshed reports and their renderings without making model requests.
[`locomo-telemetry.ts`](locomo-telemetry.ts) recovers failed-program counters
from cached responses with the network disabled. It refuses score, coverage
or usage changes and emits a receipt that reconstructs the original report.

## Contents

| Instrument | What it answers | Command |
|---|---|---|
| [`consolidate.ts`](./consolidate.ts) | Nine frozen raw/deterministic/semantic/combined comparisons with fixed exact-source budgets, per-category and held-out LoCoMo recall/verbatim floors, counted failures, memory/Node/Bun activation/execution/trigger probes and existing compaction/program controls. [Report](../docs/CONSOLIDATE_BENCHMARK.md); keyless/scripted evidence never qualifies a live QA default. | `node benchmark/consolidate.ts --require --json /tmp/consolidation.json --md docs/CONSOLIDATE_BENCHMARK.md` |
| [`locomo-census.ts`](./locomo-census.ts) | What is actually in the LoCoMo release — categories, ground truth, parseable timestamps, and how many evidence ids resolve | `npm run benchmark:locomo:census` |
| [`scripts/locomo-parity-fixtures.py`](./scripts/locomo-parity-fixtures.py) | The parity oracle: loads the official `task_eval/evaluation.py` verbatim (`bert_score` stubbed) and RUNS it over a hand-authored table and over the release's vocabulary, writing `test/fixtures/locomo-parity*.json` — the rows the TypeScript scorer must reproduce at ten decimals. Needs Python with `nltk`, `regex`, `numpy` | `npm run benchmark:locomo:parity` |
| [`locomo-recall.ts`](./locomo-recall.ts) | The keyless ceiling: evidence recall@{5,10,20} per category over the 1,540 scorable questions, for the pipeline with its policies off and on, beside a recency baseline and the two gate rows — with the ingest census of what each policy did. Report: [`results/locomo-recall.json`](./results/locomo-recall.json), rendered as [`docs/LOCOMO_RECALL.md`](../docs/LOCOMO_RECALL.md) | `npm run benchmark:locomo:recall` (`--json`, `--md`, `--samples`, `--dims`, `--seed`, `--novelty`, `--contradiction`, `--crystallize`) |
| [`locomo-qa.ts`](./locomo-qa.ts) | The answer path, and the baselines that make it mean something: one table, one scorer, one sample — the whole conversation in the request (the paper's headline baseline), retrieval over raw dialog turns (the pipeline with every policy inert), retrieval over the release's own `observation` and `session_summary` corpora ingested as evidence-carrying memories, the suite's `createLongHorizonAgent` over `createEnvironment`, and Tangle — each with the evidence-recall ceiling at k beside the official F1 of a real model's answers, the cost (`createBudgetAccount`, provider `usage`) and p50/p95 latency in the same row; citations checked against the prompt; category 5 through an LLM judge, apart; per-question results kept so rows are compared over the questions they all answered. The keyless tier (the scorer's gate, every model-free ceiling, a verbatim floor, the seeded sample) is the committed, byte-reproducible report [`results/locomo-qa.json`](./results/locomo-qa.json); `--live --rows …` answers a chosen subset of rows through the desktop's provider settings read from `.env` and MERGES the run into the dated [`results/locomo-qa-live.json`](./results/locomo-qa-live.json) — six rows do not fit one `TANGLE_AI_MAX_CALLS`, so the document records every run with its plan and spend, and refuses a run that would put a second model in the table. No key is a stated skip; a plan over the ceiling is skipped before the first request; what an earlier run bought under the same model is replayed from the wire cache (`lib/wire-cache.ts`) and counted as such. Rendered as [`docs/LOCOMO_BENCHMARK.md`](../docs/LOCOMO_BENCHMARK.md) | `npm run benchmark:locomo:qa` (`--live`, `--rows`, `--json`, `--live-json`, `--md`, `--k`, `--questions`, `--adversarial`, `--seed`, `--samples`, `--dims`, `--thinking`, `--horizon-questions`, `--horizon-depth`, `--horizon-turns`, `--horizon-subcalls`, `--call-timeout`, `--author-thinking`, `--cache`, `--fresh`) |
| [`outcome-conformance.ts`](./outcome-conformance.ts) | Seven registered comparison/control rows: 32 planned decisions, 24 available outcomes, eight pending; 24 independent held-out cases and 24 named safety scenarios. Executes the public lifecycle on reference/Node/Bun SQLite and local/HTTP bindings, validates immutable traces and publishes paired losses, coverage, proposals, projection, replay and uncertainty. No network calls. [Report](../docs/OUTCOME_BENCHMARK.md) | `npm run benchmark:outcome -- --require complete` (`--check`, `--out-dir`) |
| [`config-conformance.ts`](./config-conformance.ts) | The identity instrument: 44 registered equivalence/sensitivity/refusal/legacy cases measured against the tree — every case `holds`, `gap` (a defect published as one, never encoded as expected) or `pending` — plus the construction-path census (the one factory pair, the host inputs, the run producers, the artifacts and the desktop contract revision). Keyless, clock-free, byte-reproducible; the schema's `$query` refuses a report whose counts do not reconcile and its gate counters are literal zeros. Report: [`results/config-conformance.json`](./results/config-conformance.json) | `npm run benchmark:config` (`--out`, `--contract-fixture`) |
| [`grounding.ts`](./grounding.ts) | The document-grounding instrument: a Tangle-authored MIT fixture (8 sources, 16 questions, 24 expected material claims under `fixtures/grounding/` — the corpus, the closed matching predicates, the per-question supply trace and the scripted answers are all committed data), the one `{ claims, citations }` answer contract both scripted and live paths generate through `createStructuredOutput` (the schema object is the DESKTOP's — `apps/desktop/src/grounding.ts` — so the measured contract and the shipped one cannot drift), one-to-one predicate claim matching, and a citation state machine whose every visible citation ends in exactly one terminal outcome (`supporting`, `resolved-not-supporting`, `not-supplied`, `inactive-version`, `future-evidence`, `unknown-evidence`). The oracle must reach exact 1.000 ceilings before a table prints; every named bad answer must land on its intended terminal reason. The keyless tier is clock-free and byte-reproducible; `--live` prints a frozen credential-free dry plan (exact cache hits, maximum fresh calls, ceilings) and spends NOTHING — only `--live --authorize <plan-id>` executes exactly it, running the paired `no-documents` / `documents-retrieved` / `grounded-answer` rows over the fixture and a seeded 16-question LoCoMo slice, both built through the shipped ingester/chunker/store/retriever at the current defaults; a replay reproduces the identical report identity with zero wire calls, and the document carries the mechanical product decision its own schema recomputes. `--web-live --searx <base> --authorize-web <plan-id>` runs the optional dated SearxNG-vs-curated diagnostic through the HTTP capture; without an endpoint or authorization it records a schema-valid not-run. Reports: [`results/grounding.json`](./results/grounding.json) (keyless, committed), [`results/grounding-live.json`](./results/grounding-live.json) (the dated paid attempt), [`results/grounding-web-live.json`](./results/grounding-web-live.json) (the dated web record), rendered together as [`docs/GROUNDING_BENCHMARK.md`](../docs/GROUNDING_BENCHMARK.md) | `npm run benchmark:grounding` (`--json`, `--md`, `--live`, `--authorize`, `--fresh`, `--thinking`, `--cache`, `--live-json`, `--web-live`, `--searx`, `--authorize-web`, `--web-json`, `--http-capture`, `--fresh-http`) |
| [`grounding-query.ts`](./grounding-query.ts) | The committed [`queries/grounding/flat-baseline.json`](../queries/grounding/flat-baseline.json) FLWOR document executed verbatim with `compileJsonQuery` over the validated live and web reports: one immutable, clock-free handoff naming the report/registration/fixture/plan/source/config identities, the exact flat-row treatment values and question ids, every metric with its bounds, all four registered decision clauses and the product decision, and the separately labelled diagnostics. Two renders are byte-identical; a stale decision or modified query is refused. This handoff — not a prose copy of favorable metrics — is what a later retrieval treatment must beat. Report: [`results/grounding-handoff.json`](./results/grounding-handoff.json) | `npm run benchmark:grounding:handoff` (`--out`, `--live`, `--web`) |
| [`config-queries.ts`](./config-queries.ts) | The three committed `@jarenjs/json` FLWOR documents under [`queries/config/`](../queries/config/) executed verbatim with `compileJsonQuery` over validated inputs: the identity inventory of every artifact row, the same-request-across-hosts comparison that never collapses different effective identities, and the temporal-stack question over the answer artifacts. Report: [`results/config-queries.json`](./results/config-queries.json) | `npm run benchmark:config:queries` (`--out`) |
| [`trace2skill.ts`](./trace2skill.ts) | Whether a skill directory can be evolved from labelled trajectories and *proved* better on a held-out split — asked before any evolving mechanism exists. Over a Tangle-authored MIT fixture (24 tabular-extraction tasks, a seeded 16/8 evolve–held-out split whose halves are hashed, a frozen human `SKILL.md` directory, 116 scripted units, a thirteen-patch pool whose eight refusals and two withholdings are registered, and a registered merge tree) it publishes two tables — deepening from the human directory, creation from a trajectory-blind draft — each with its own denominator. Two rows are analytic: the oracle answers every held-out task with its registered answer and must reach exactly 1.000, and a seeded control drawing uniformly from the pool of held-out answers must land inside an analytic band. Eight are executed: the same bounded executor runs the held-out split with no directory, with the frozen human directory, with the trajectory-blind draft, with the directory the deepening run evolved and with each of the three ablations, over a wire that reproduces each unit's registered turn count — so a scripted row says whether the instrument separates conditions, and nothing about model quality. Beside the tables, the analyst stage over the evolve half is published in its own block: one independent analyst per labelled rollout, both roles' yield and spend, every exclusion reason with its count including the reasons nobody reached, and the two isolation counters — a patch is stored only where the fixture's own evaluator passed over a repair made in an in-memory overlay, so a proven repair is a recorded verdict rather than a claim. Consolidation is published in a block of its own: the tree the whole patch population was cut into, what each group kept, folded and withheld, every decision name with its count including the ones nobody reached, and the single guarded application that staged the candidate the evolved row is then scored with. The held-out verdict and what may follow it get a block too: the gate and its identity, the mean and cost deltas, every clause the candidate failed, the tasks it scores lower on, what driving the same run a second time spent, and the activation matrix — one applied activation with the head revision it moved, beside five candidates that must not reach the head (regressing, under-covered, over-budget, evaluation-failed and stale-parent), each with the clause that stopped it and a receipt that the head did not move and the superseded directory is still readable byte for byte. The three ablations get a block of their own — each removes exactly one part of the method and keeps the corpus, the frozen directory, the trajectories, the gate, the split and the executor identity, and each publishes its counted differences and its signed held-out delta against the evolved directory, with any row that beat the method printed as it stands. The transfer rows and the creation candidate no rollout has produced stay explicit `not-run` skips carrying no tasks and no deltas and naming what is missing, so a row nobody executed cannot read as a measured zero. Where a starting directory scores below no directory on a held-out task, the document prints that task. Unanswered, excluded, failed, leakage, withheld and script-missing counts are published for every row whether or not they happened; a held-out id appearing in the evolve half is refused and counted, a truth read from the executor's side of the boundary is a counted leakage, and a descriptor with no scripted entry is a counted absence rather than a crash. Clock-free and byte-reproducible; no provider client exists and the zero of a counting network trap is published as a probe. `--live` reads the ambient environment only to say what an authorized run WOULD cost: it prints a credential-free plan naming the variable a key would come from, refuses an `--authorize` argument that is not this plan's id, and makes no request. The committed live record is the one an unconfigured clone renders, so its bytes never depend on whether the machine that wrote them had a key. Report: [`results/trace2skill.json`](./results/trace2skill.json) and [`results/trace2skill-live.json`](./results/trace2skill-live.json), rendered as [`docs/TRACE2SKILL_BENCHMARK.md`](../docs/TRACE2SKILL_BENCHMARK.md) | `npm run benchmark:trace2skill` (`--check`, `--out-dir`, `--json`, `--md`, `--live-json`, `--require`, `--live [--authorize <plan-id>]`) |
| [`scripts/trace2skill-fixture.ts`](./scripts/trace2skill-fixture.ts) | Regenerates the derived halves of the skill-evolution fixture — the manifest's digests and seeded split, the scripted wire, the oracle expectations — so the authored data is the only thing a reviewer reads and a corpus edit cannot leave a stale hash behind. `--check` proves the committed fixture is exactly what it produces, writes nothing, and exits non-zero on drift | `npm run trace2skill:fixture` (`--check`) |
| [`evolve.ts`](./evolve.ts) | Whether one small repository change can be isolated, gated, measured and kept or abandoned without ever moving its own goalposts — registered before any executor exists. Over a Tangle-authored MIT fixture repository (a toolchain-free ranking project committed as plain files and built into a git repository in a temporary directory under fixed authorship, so its base revision is a constant) it publishes sixteen adversarial proposals, each carrying the exact decision, reason and refusal code it must produce: one true improvement, one no-op, one regression, one flake that is red then green, seven goalpost moves aimed at the test expectations, CI, the gate script, the registered threshold, the fitness instrument, a rename that hides a deleted assertion and a generated file, two escapes by path and by patch size, and three hostile runtimes that never return, flood stdout or fill the workspace. The immutable-surface policy, the budgets, the registered gate and fitness commands and the benchmark truth all live outside the repository under experiment, so no patch can reach the thing that scores it. Two analytic rows license the rest: an oracle that reads the registration back per strategy (one strategy wins its only attempt; every other wins none) and a seeded selection of eight proposals drawn with no strategy at all. Every mechanism row is `implementation-missing` and the decision says so — no hit rate, no worktree, no process run is claimed, and the only numbers published are the registration's constants and what each patch costs on paper. Abandon and refusal reasons keep their columns whether or not they happened; protected-ref writes and live model calls are literal zeros the schema asserts. Keyless and clock-free: no provider, no credential, no `--live`, no duration or temporary path in the document. Report: [`results/evolve.json`](./results/evolve.json), rendered as [`docs/EVOLVE_BENCHMARK.md`](../docs/EVOLVE_BENCHMARK.md) | `npm run benchmark:evolve` (`--check`, `--out`) |
| [`scripts/evolve-fixture.ts`](./scripts/evolve-fixture.ts) | Writes the experiment registration from the authored material: the fixture repository's file digests, the base revision it materializes to, the strategy library revision, and every proposal's patch and canonical revision. Each derived patch is an exact single-occurrence replacement over committed bytes, so a fixture edit fails the author loudly instead of leaving a proposal that no longer does what its name says. `--check` writes nothing, re-materializes the repository and exits non-zero on any drift | `npm run evolve:fixture` (`--check`) |

`lib/` holds Tangle's benchmark-specific work exactly once here:

| Module | Why it is not an import |
|---|---|
| [`lib/stats.ts`](./lib/stats.ts) | Report shaping over `@jarenjs/core/stats`: nearest-rank p50/p95 and `null` for an empty rendered cell. No local arithmetic. |
| [`lib/table.ts`](./lib/table.ts) | The Markdown table idiom `docs/DOCUMENT_BENCHMARK.md` already publishes, extracted so a second instrument does not invent a second format. |
| [`lib/args.ts`](./lib/args.ts) | An unknown flag is an error, not a silent default — a benchmark that ignored `--sizes` would publish the wrong row under the right name. |
| [`lib/locomo.ts`](./lib/locomo.ts) | Loading, validating and reading the LoCoMo release. Nothing is repaired here. |
| [`lib/locomo-corpus.ts`](./lib/locomo-corpus.ts) | Turns as Tangle observations: one memory per turn, `evidence` = `<sample_id>/<dia_id>`, `at` = the session instant. The `seq` a turn has inside its session lives here, not on the record — LoCoMo stamps sessions, not turns. Also the release's two derived corpora as inputs (an observation cites the dia_ids it was written from, a summary its whole session — counted, never repaired) and the transcript as units whose ids are the release's own turn ids, for the long-context row. |
| [`lib/recall.ts`](./lib/recall.ts) | The official `recall_acc`, the k-dependent oracle ceiling, and the hypergeometric band a seeded draw must land in. Fractional recall, unlike jarenjs's recall@k — so an oracle is not 1.000 at every k, and the gate knows why. |
| [`lib/locomo-recall.ts`](./lib/locomo-recall.ts) | The run itself, the gate, and the Markdown derived from the report. Importable, so the tests run it. |
| [`lib/porter.ts`](./lib/porter.ts) | The Porter stemmer as NLTK runs it (`NLTK_EXTENSIONS`, the official scorer's default) — ported branch for branch over code points, because there is no stemmer anywhere in `@jarenjs/*` and the paper's variant would differ on the third decimal of every F1. |
| [`lib/locomo-ingest.ts`](./lib/locomo-ingest.ts) | One conversation through the real pipeline — one store, one `pipeline.run` per session, the clock the last session instant, the census of what each policy did — shared by the recall and answer instruments so the policy matrix tunes one ingest, not two. |
| [`lib/ai-env.ts`](./lib/ai-env.ts) | The ONE reader of the live-model environment (`TANGLE_AI_*`, `OPENROUTER_AI_KEY`), jarenjs's `readAiEnv` method: a missing key is a stated skip, the key is never printed, the spend guards are ceilings. It resolves to the desktop's `ChatSettings`/`EmbedSettings`, so a benchmark builds its clients with the app's own factories. |
| [`lib/locomo-qa.ts`](./lib/locomo-qa.ts) | The answer path: the six rows, the grounded prompt and its `{ answer, citations }` schema, the citation check, the seeded stratified sample and the long-horizon row's seeded subset of it, the keyless and live runs, the long-horizon harness (a fresh environment per question, the agent's client metered, deadlined and probed for the ceiling), the category-5 judge, the merge of live runs, and the Markdown. |
| [`lib/wire-cache.ts`](./lib/wire-cache.ts) | The SQLite adapter/audit trail for the cache seam on JarenJS's chat and embedding clients. JarenJS constructs the complete effective credential-free key, owns partial hits and marks replays; Tangle stores the full key beside its SHA-256 id, packs vectors, exposes endpoint-aware embedding hits to the spend preflight, and retains pre-0.56 rows as audit-only legacy data. `--fresh` ignores reads while still filling; `--cache PATH` moves it; `--cache none` disables it. |
| [`lib/grounding-run.ts`](./lib/grounding-run.ts) | The paired baseline: fixture and seeded LoCoMo corpora built through the shipped ingester/chunker/store/retriever at the current defaults, the three registered rows (`no-documents`, `documents-retrieved`, `grounded-answer`) sharing every control but the evidence, the frozen credential-free dry plan whose exact `planId` an explicit `--authorize` must match, one budget account, the suite's structured output and bounded mapper, and the clock/cost-free live report identity a zero-spend replay reproduces. |
| [`lib/grounding-web.ts`](./lib/grounding-web.ts) | The optional captured web diagnostic: six fixed RFC 9110 questions, the registered first-3-distinct-normalized-URLs SearxNG selection (order kept, refusals named, snippets counted and never evidence), acquisition through `ingestMany` into a real store, the two answer rows, and the schema-valid `notRun` state a missing SearxNG or declined authorization records instead of failing CI. |
| [`lib/http-capture.ts`](./lib/http-capture.ts) | The benchmark-owned SQLite HTTP capture (`benchmark/cache/grounding-http.sqlite`, gitignored): exact response bytes/status/headers per credential-free request, byte SHA-256s, replay serving stored bytes with zero network calls, missing/malformed captures as named failures, and the body-free manifest reports carry. It never touches the JarenJS model replay key. |
| [`lib/grounding.ts`](./lib/grounding.ts) | The grounding fixture loader (hash-verified, schema-validated, quotes pinned to exactly one occurrence), the answer renderer that derives visible text from the claim ledger, the predicate matcher, the terminal citation classifier, the oracle gate and the keyless report/Markdown. Types are generated from `schemas/grounding.schema.json` by `jaren-emit`; identities are `canonicalSha256` over explicit payloads; the answer-F1 diagnostic reuses the official LoCoMo normalizer and token F1. The suite claim envelope owns generic reference integrity in the desktop gate; the fixture matching predicates and terminal support scorer remain Tangle-specific. |
| [`lib/trace2skill-fixture.ts`](./lib/trace2skill-fixture.ts) | The one door the skill-evolution corpus comes through: every registered file re-hashed against the manifest, the evolve and held-out halves checked for disjointness, and ground truth handed out only against a named scope. It also owns the mapping from a registered patch document onto the compiler's operation shape, and the scope document a trajectory-blind draft is allowed to see. Refusals are returned as counted issues, not thrown, so the report can publish them and the capability gate can go false. |
| [`lib/trace2skill-adapter.ts`](./lib/trace2skill-adapter.ts) | What a host must supply before a skill can be evolved against a domain: prepared inputs, the executor's `read_file` surface over the task's inputs alone, the exact-normalized evaluator, and the wider surface an error analyst gets after a failure. The boundary between the last two is the point — crossing it returns a refusal and increments a counter. One bridge maps this surface onto the host contract the skill package executes against, so the boundary a row measures and the boundary an executor crosses are the same object. |
| [`lib/trace2skill-script.ts`](./lib/trace2skill-script.ts) | The scripted wire and the enumeration of every unit a complete run asks for. Keys are canonical digests of a logical unit descriptor and deliberately carry no content hash, so directory identity stays bound by the report rather than by the script. A descriptor with no entry is counted, never thrown. It also answers as a chat client, so the shipped executor and analyst loops run against it for real: a unit registered at three turns spends two tool rounds before it answers, a unit registered as budget-stopped never answers at all, and a registered repair takes the turns the method requires — read the registered answer through the sanctioned tool, rewrite the overlay, run the real evaluator, and only then propose — so no answer ever sits in the committed script. A merge group is answered the same way: the patches it was given are read back out of its own request and consolidated by one deterministic rule, so the committed script registers the decision and never the corpus. |
| [`lib/trace2skill-cli.ts`](./lib/trace2skill-cli.ts) | The non-interactive driver behind `npm run trace2skill`: plan, run, resume, inspect, evaluate, diff and activate over the committed corpus. It drives the package's own run rather than re-assembling its stages, prints ids, counts and codes with bounded excerpts, addresses a trajectory instead of printing it, and ends `--live` at a frozen credential-free plan that names where a key would be read from and spends nothing without a separate approval. Every refusal is an exit code, never a thrown stack. |
| [`lib/trace2skill-oracle.ts`](./lib/trace2skill-oracle.ts) | The scorer proven before any table prints: one normalization, one comparison, the analytic ceiling, and the Bernoulli band a seeded uniform draw over the registered answer pool must land in. Wide at eight tasks, and published that way rather than narrowed. |
| [`lib/trace2skill-live.ts`](./lib/trace2skill-live.ts) | The live tier that spends nothing: the rows an authorized run would cover, the ceiling each runs under, the stages it would drive and the packs it would render through, hashed into a `planId` an explicit `--authorize` must name. It reads an environment description rather than the environment, so the committed record is deterministic; a key is never read into it, never printed and never hashed — only the NAME of the variable one would come from. |
| [`lib/trace2skill-ablations.ts`](./lib/trace2skill-ablations.ts) | The method with one part removed, three times: the evaluator-proven repair loop replaced by one structured call, the hierarchical tree replaced by a fold, and the one preloaded directory replaced by the salvaged cluster-then-retrieve bank. A stage that is deliberately ablated is reimplemented here rather than imported — calling the shipped stage would measure the stage the row claims to have removed — while the patch gate, the merge operator, the guarded application and the held-out pass stay the package's own, so what moves is attributable to the part that was taken out. Keyless: the vectors are the hash embedder's and no provider is constructed. |
| [`lib/trace2skill-report.ts`](./lib/trace2skill-report.ts) | The row summarizer, the one drive of the shipped stage graph each mode runs, the analyst, consolidation and evaluation blocks, the activation matrix it attempts against the run's own store, the derived capability gates, the always-published failure counters, and the report/Markdown the instrument writes. Types are generated from `schemas/trace2skill.schema.json` by `jaren-emit`; the corpus binding is validated against the fixture a report claims to describe. |
| [`lib/evolve-fixture.ts`](./lib/evolve-fixture.ts) | The one materializer and the one loader for the experiment fixture repository. Materialization is hermetic — system and global git configuration off, exclude file silenced, identity, date and signing fixed, every call an argv array through `execFile` under a bound timeout, a bound buffer and an explicit environment allow-list — so the base revision is the same constant on any host. The loader reads committed bytes only and refuses a repository file, a strategy library or a proposal whose canonical revision moved. |
| [`lib/evolve.ts`](./lib/evolve.ts) | The registration read into a report: the two analytic controls, what each proposal costs before anything runs, the census over the rows, and the claim decision that may not outrun them in either direction. Types are generated from `schemas/evolve.schema.json` by `jaren-emit`; the source receipt binds the instrument's own bytes and the fixture manifest, and deliberately excludes commit HEAD so committing identical bytes does not invalidate a measurement. |
| [`lib/locomo-parity.ts`](./lib/locomo-parity.ts) | `normalize_answer`, `f1_score`, the multi-hop `f1` and the category routing of `task_eval/evaluation.py`, to the letter — including the punctuation-before-articles order, `and` as an article, Python's `\b` and whitespace, and NumPy's pairwise mean. Category 5 answers a reason, never a number. |

`cache/` (gitignored, absent in a fresh clone) is the wire cache above — a pure
accelerator that may be deleted at any moment; nothing published depends on it,
and a run says in its report how much of it was replayed.

`schemas/` holds the committed contracts — the release as measured
(`locomo10.schema.json`) and every report an instrument writes
(`locomo-recall.schema.json`; `locomo-qa.schema.json` and
`locomo-qa-live.schema.json` extend it by `$ref` rather than forking it),
validated by `@jarenjs/validate` before a byte is written. `results/` holds
the committed reports; a test asserts each keyless report is exactly what
its command produces today, so a published number whose command no longer
reproduces it goes red. The one exception is stated: `locomo-qa-live.json`
is a dated record of a real model's run — validated, rendered and pinned to
the keyless sample by the tests, never regenerated by them.

## Registered memory-policy experiment

The policy matrix preserves the historical lexical screen in
`results/locomo-policy-screen.json` and the current experiment in
`results/locomo-policy.json`. The latter retains the registered cells, both
splits, the embeddings-only census, every live attempt, paired statistics,
phase transition and raw evidence references.

```sh
# Lexical diagnostic: no key, no request, no overwrite of the saved experiment.
npm run benchmark:locomo:policy -- --cells all
# Render saved observations without loading live configuration or a wire cache.
npm run benchmark:locomo:policy -- --render --json benchmark/results/locomo-policy.json --md docs/LOCOMO_POLICY.md
# Print the actual provider plan; this makes no provider request.
node --env-file-if-exists=.env benchmark/locomo-policy.ts --live --phase census --json benchmark/results/locomo-policy.json
```

Paid execution requires the printed `--authorize` inference identity and a
persistent `--cache` path. The approved controls and source manifest are frozen
before the first purchase. A fresh replay bypass is refused. The purchase
journal counts physical requests before dispatch, including failures and
repairs, and enforces both the per-run and cumulative ceilings. Answering phases
run one pending cell per invocation unless an explicit eligible `--cells` subset
fits the run cap. The census must finish before selection; all selection cells
must be eligible before the challenger freezes; confirmation runs exactly inert,
shipped and that challenger. Successful replies are immutable across resumption.
Raw evidence files retain errors, usage, latency and category-5 judgments.
Memory contradiction checks use the existing local numeric-contrast judge; the
configured model judge scores category-5 answers. The measured source is
reconstructible from the report's HEAD plus `results/locomo-policy-source.patch`;
its file manifest verifies the resulting bytes. New registration identities bind
also the dataset digest directly. Historical registrations retain their original
identity; their report-root digest and every raw live evidence digest must agree.
The completed measurement used the identical dataset in all eight live rows.

These paid commands are never CI gates. Re-rendering saved data cannot reopen a
phase or purchase a replacement answer. A completed result remains evidence for
its recorded source revision even after runtime defaults are updated.

The completed experiment used 258 successful physical requests out of 900. The
challenger's held-out F1 delta was +0.000719 (95% interval [-0.001464, 0.003216]);
the registered rule therefore selects inert. The report's minimum detectable
effect is 0.002380, calculated as 1.96 × paired standard error. It is a precision
diagnostic, not an 80%-power calculation or evidence of equivalence. All-tied
samples yield a degenerate zero estimate and cannot establish population absence.
The 512-dimensional offline width came from lexical evidence recall separately;
all live cells used the same observed 1024-dimensional BGE-M3 identity.

All confirmation rows judged 7/8 adversarial answers correct (keyword-rule score
0/8), with no missing/invalid judgment or unresolved answer citation. Answer
latency medians/p95 were 2284/10718 ms for inert, 2453/12316 ms for historical
shipped and 2453/10709 ms for the challenger. These include recorded response
timings reused by the replay layer, so they are not fresh-provider speed trials.
Every raw response report retains its dated timings and lane-specific costs.

The current keyless recall and QA reports include `selected-default` and retain
`near` as the explicit historical shipped thresholds at the run's stated width.
The original full-corpus 64-dimensional reports remain at
`results/locomo-recall-baseline.json` and `results/locomo-qa-baseline.json`.
Regenerate the current reports and verify the public policy without buying answers:

```sh
npm run benchmark:locomo:recall -- --json benchmark/results/locomo-recall.json --md docs/LOCOMO_RECALL.md
npm run benchmark:locomo:qa -- --json benchmark/results/locomo-qa.json --live-json benchmark/results/locomo-qa-live.json --md docs/LOCOMO_BENCHMARK.md
npm run policy:check
npm run policy:contract:check
npm run emit:check
```


## The submodules

| Path | Upstream | Licence |
|---|---|---|
| `locomo/` | [`snap-research/locomo`](https://github.com/snap-research/locomo) — the ACL 2024 benchmark, data and official evaluator | **CC BY-NC 4.0** |
| `longmemeval/` | [`xiaowu0162/LongMemEval`](https://github.com/xiaowu0162/LongMemEval) — the ICLR 2025 benchmark code and official evaluator | **MIT** |

```sh
git submodule update --init benchmark/locomo benchmark/longmemeval
```

Each submodule keeps its upstream source and licence. The parent repository's
Git tree pins the exact upstream commit; `.gitmodules` records its path and URL.
LoCoMo includes `data/locomo10.json` in its source repository. Its sessions are
dated, but its QA objects have no explicit question timestamp.

LongMemEval is pinned to `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
Its [documented format](longmemeval/README.md) includes
`question_date` and aligned `haystack_dates`, making it a temporal-evaluation
companion. Its [cleaned datasets](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
are separate downloads; initializing the code submodule does not fetch them.
Keep downloaded files in ignored `benchmark/data/longmemeval/`, outside the
submodule, and pin dataset revision and checksums separately from the code.
The LongMemEval adapter verifies raw bytes, separates evaluator labels from
runtime inputs, preserves repeated occurrences and registers grouped development
and confirmation folds. The [generated census](../docs/LONGMEMEVAL_BENCHMARK.md)
records source defects and both provided-history and strict-as-of denominators.

```sh
npm run benchmark:longmemeval:census -- --download --require
npm run benchmark:longmemeval:census -- --require --json /tmp/longmemeval-census.json --md docs/LONGMEMEVAL_BENCHMARK.md
npm run benchmark:longmemeval:census -- --require --md docs/LONGMEMEVAL_BENCHMARK.md --check
```

Acquisition downloads the pinned cleaned S and oracle files with atomic size and
SHA-256 verification. Oracle inputs remain evaluator-only. Without the external
data or submodule the census reports `unavailable`; `--require` fails. These
commands make no model request, and a source census is not answer accuracy.

Existing LoCoMo instruments report a stated skip when the submodule is absent.
A plain `git clone` does not fetch submodules. Pass `--require` to make missing
required data a nonzero exit. New dataset instruments must retain that explicit
availability contract and must not download data implicitly during tests.

## The rules an instrument here follows

The strict temporal instrument is `npm run benchmark:temporal`. It registers
46 Tangle-authored exact scenarios across memory, Node SQLite and Bun SQLite;
missing adapters remain `not-implemented` rather than passing. Use `--require`
to require both corpora, `--complete` to require every runtime case, and `--json`,
`--md`, `--check` for deterministic artifacts. Its current results are generated
in [TEMPORAL_BENCHMARK.md](../docs/TEMPORAL_BENCHMARK.md).

`npm run benchmark:temporal:eval -- --require` runs the full cleaned-S keyless
matrix in both knowledge profiles. Use `--json /tmp/temporal-eval.json --md
docs/TEMPORAL_EVALUATION.md --receipt benchmark/receipts/temporal-keyless.json`
to reproduce the [matched report](../docs/TEMPORAL_EVALUATION.md),
or `--dry --json /tmp/temporal-plan.json` for the complete cold request plan.
`--check` compares generated files. Reference embeddings are local hash-trigram-512;
no key or environment file is loaded. The temporal default remains off while
live quality or deployment costs are unmeasured. All rows retain failures and
the original question denominator; whole-turn context trimming is counted.
The shared context cap is 12,000 serialized UTF-8 bytes, a conservative token
bound rather than measured tokenizer usage. The committed compact receipt pins
the full per-question rows by hash; it contains no raw source or model text.
Effective source-byte hashes exclude commit HEAD, so committing identical bytes
does not invalidate a measurement. Source or manifest changes require regeneration.

`npm run benchmark:longmemeval:roundtrip -- --require --backend sqlite --json
/tmp/longmemeval-roundtrip.json` qualifies all 500 questions and both source views
through actual SQLite; run the same script with Bun, or use `--backend memory`.
The three normalized receipts must agree. Empty observed turns are preserved,
but cannot provide a nonempty citation span. This source-persistence check has
empty claim sets and no embeddings; it does not measure model QA quality.

`npm run benchmark:longmemeval:qa` uses the keyless matrix by default. Its explicit
`--live` and `--replay` modes require `--plan`, `--approval`, `--journal` and
`--json` paths. First generate a dry plan with `--models <json>`: each extract,
resolve, answer and judge role specifies its HTTPS chat-completions endpoint,
model, input/output USD per million tokens and metadata identity. The approval
document binds `planHash`, `runId`, `perRunRequests`, `campaignRequests` and
`campaignUsd`. It represents a separately approved concrete spend plan; a plan
file alone grants no authorization. Live execution also requires an explicit
`--key-env NAME`. No `.env` file is loaded automatically. Journals and raw QA
outputs must be ignored paths (such as `benchmark/cache/`) or temporary files.
One exclusive journal lock covers the run; uncertain purchases are retained and
never automatically rebought. Replay verifies request/reply hashes and refuses
missing receipts without network. Scripted origin remains scripted. Paid evidence
never changes the default without the complete registered statistical/cost gate.

LoCoMo recall and QA envelopes optionally accept an independently registered
`temporal` comparison created by `temporalLocomoComparison`. It binds dataset,
source, metric, question/group pairs and bootstrap results. Canonical commands
omit the block entirely and retain their original report bytes. The profile is
`canonical-unanchored`: no evaluator annotation supplies a missing QA timestamp.

`npm run benchmark:longmemeval:parity` runs the pinned official prompt and
aggregation code over Tangle-authored fixtures with Python/numpy and no provider
imports or requests. The QA scorer preserves upstream off-by-one tolerance and
substring `yes` labels, with strict reply diagnostics reported separately.
Retrieval exposes upstream any/all evidence recall and separately named session
fraction/annotated-turn diagnostics. Abstentions are excluded from official
retrieval, retained in QA, and overlap the six question types. Scripted labels
qualify scorer semantics; they do not establish live judge accuracy.

Inherited from jarenjs's harness, where each was learned by getting it wrong:

1. **A gate passes by exit code, never by grepping output.** Once, in jarenjs,
   a crashed linter was declared green because something printed the word
   "pass".
2. **Prove the scorer before printing a score.** An oracle row must be exactly
   right and a seeded random row must land inside its analytic band, or the run
   exits 1 naming the row. This is what catches a corpus whose gold ids do not
   exist — and LoCoMo has nine of those, which `locomo-census.ts` counts.
3. **Publish the ceiling beside the score.** A model-free ceiling — was the
   evidence in the request at all — is keyless, deterministic and cheap enough
   for CI. The gap between it and a real model's score is what says whether a
   miss was retrieval or prompting.
4. **A missing key is a stated skip, not a failure**, and a run that would
   exceed its call ceiling is skipped up front rather than half-spent.
5. **Losses are published beside wins.** A comparison that only reports
   victories is marketing, and this repo does not ship marketing.
6. **Nothing is repaired silently.** Malformed upstream data is counted and
   named. A benchmark that quietly fixes its own ground truth can no longer be
   compared with the published numbers.

## Attribution

LoCoMo — *Evaluating Very Long-Term Conversational Memory of LLM Agents*,
Maharana, Lee, Tulyakov, Bansal, Barbieri and Fang, ACL 2024
([arXiv:2402.17753](https://arxiv.org/abs/2402.17753)). Data and evaluation
code © Snap Inc., CC BY-NC 4.0.

## GMPL patterns and LoCoMo planning

`npm run benchmark:gmpl -- --require complete` executes all six families and
six paired single-agent controls through MAS with a trapping network binding.
The frozen synthetic registration contains 24 cases per row (288 total), 30
protocol probes, three corrupted safety controls and seven diagnostic ablations
outside the primary denominator. Case receipts bind exact information/resources,
show every completion/normalization/repair and preserve failures, waiting and
unknown usage. The [generated report](../docs/GMPL_BENCHMARK.md) publishes ties
and clarification's lower utility. Scripted responses measure conformance only.
`--out-dir DIR` redirects JSON and Markdown; `--check` compares without writing.

`npm run gmpl:smoke` and `bun scripts/gmpl-consumer-smoke.ts` qualify public
text/numeric domain composition and a two-turn typed host response through the
existing worker/store, including reopened zero-effect reconciliation. Packed
consumers execute emitted JavaScript for each family outside the checkout.

`npm run benchmark:gmpl:locomo` defaults to `--plan`: seed 17753, 16 questions in
each category 1–4, category 5 excluded, with one shared near-raw offline evidence
slice per question. Missing data is `dataset-unavailable`. The plan records
source/dataset/sample/evidence/prompt/config/model identities, per-run caps and
worst-case campaign requests. A model is unassigned until explicitly bound and
prices remain null. No environment file or live transport is loaded.

`--replay PATH` accepts the bundle contract in
`schemas/gmpl-locomo.schema.json` (`$defs.bundle`). Its binding must reproduce
the exact plan. Runs pin their original input/evidence/config/model identities;
purchases carry the effective `@tangleai/models/replay` request key, request id,
response digest, normalized wire entry or original failure, and original cost.
The existing chat client consumes those entries with throwing cache misses and
zero network fallback. Partial/mismatched rows retain the full denominator and
are ineligible for a paired delta. All 64 planned answers, category scores,
citation validity and original versus incremental costs appear separately.
`scripted` receipts never become live evidence. `recorded-wire` is an operator
provenance assertion, not cryptographic proof of purchase; exact hashes establish
compatibility only. Live pattern-versus-single-agent LoCoMo quality remains
unmeasured. The [generated plan](../docs/GMPL_LOCOMO.md) records these limits.
