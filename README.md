# Tangle AI

Self-improving memory and retrieval for agents, built on the
[jarenjs](https://github.com/jklarenbeek/jarenjs) suite as the foundational
layer.

First-party source, tests, benchmarks and migration scripts use
**strict TypeScript**. The JavaScript received from Jaren has been converted. Vendor submodules and generated browser bundles keep their
upstream or output formats; `.mjs` browser/release harnesses remain JavaScript. Node 24 runs workspace source and tests directly;
public packages are built as ESM JavaScript with strict TypeScript declarations
and their JSON schemas. The sixteen public packages share one version,
starting at **0.20.0**. The major version remains zero during development.
`npm run check` validates source; `npm run release:verify` also installs and tests
the actual publication tarballs outside this checkout.

GMPL's parallel analysis, peer review, red team, structured debate, clarification
and Delphi patterns execute through MAS. The public host walkthrough demonstrates
text and numeric domains plus durable typed clarification. These keyless commands
use scripted clients or a plan with no transport:

```sh
npm run gmpl:smoke
npm run benchmark:gmpl -- --require complete
npm run benchmark:gmpl:locomo -- --plan
```

The [conformance report](docs/GMPL_BENCHMARK.md) retains all 288 comparisons,
seven diagnostic ablations and their costs, including clarification's loss.
The [LoCoMo plan](docs/GMPL_LOCOMO.md) freezes 64 questions and shared evidence;
live pattern-versus-single-agent quality remains unmeasured. Domain learning,
HERA and trading/research applications remain separate roadmap work.

## What runs today

```sh
# Use .nvmrc (Node 24.20.0), npm 11.12.1 and Bun 1.4.0:
git submodule update --init vendor/jarenjs
npm ci --ignore-scripts
npm run check      # strict typecheck + complete offline test suite
npm run skeleton   # the whole loop, end to end, offline
npm run desktop    # folder memory + versioned web/PDF document corpus
npm run documents:benchmark

# the LoCoMo benchmark dataset is a submodule and is never vendored here:
git submodule update --init benchmark/locomo
npm run benchmark:locomo:census

# after copying .env.example to .env and adding an OpenRouter key:
npm run documents:live-smoke
```

The skeleton ingests evidenced observations and runs them through the
policy chain — novelty gate → contradiction resolution → crystallization →
outcome learning → embedding-ranked recall — then mirrors the surviving
memories into an unmodified `@tangleai/context` ledger, where a Tangle
agent can recall them by tag:

```
ingest: 6 admitted, 0 filtered as near-verbatim repeats
contradiction: attempted 0 similar pairs, judged 0, resolved 0
crystallize: examined 6, planned 0, merged 0
outcome: "Deploys must run the full gate before shipping" boosted to confidence 0.65
recall: both the 100 and 500 requests/minute observations remain live
ledger mirror: 6 live memories admitted to a @tangleai/context ledger
```

The skeleton prints the exact selected cell and report identity. The measured
default disables the three ingest policies, retrieves up to 10 memories at
minScore 0, and uses 512-dimensional lexical hash embeddings offline. Retrieving
a conflicting observation does not establish which figure is current. Explicit
measured opt-ins and provenance are documented in
[packages/memory/README.md](packages/memory/README.md).

The vectors travel with their identity (`embeddedBy: { model, dims }`),
which is what lets the mirrored ledger rank them by meaning through the
same `@tangleai/models` embedder seam that wrote them — and what lets every
Tangle policy refuse to compare vectors from two models.

## Packages

| package | what it is |
|---|---|
| `@tangleai/models` | injected model clients, embeddings, replay, routing and structured generation ([API](packages/models/README.md)) |
| `@tangleai/context` | ledgers, bounded environments, evidence, recall and retention ([API](packages/context/README.md)) |
| `@tangleai/agents` | validated tools, bounded agents, checked programs, recursion and refinement ([API](packages/agents/README.md)) |
| `@tangleai/linq` | immutable document pens; the program pen tracks slot bindings and terminal answers ([API](packages/linq/README.md)) |
| `@tangleai/jaren` | Jaren grammar authors and revision-checked Studio/Data/Flow AI adapters ([API](packages/jaren/README.md)) |
| `@tangleai/assistant` | reusable headless assistant controller and scoped visual component ([API](components/assistant/README.md)) |
| `@tangleai/core` | coded errors, zero-dep k-means, token heuristics, and the memory-unit JSON Schema (a strict superset of the jarenjs ledger memory — evidence stays mandatory, and a vector never travels without its `embeddedBy` identity). Vector arithmetic is `@jarenjs/core/vector`'s, not ours |
| `@tangleai/memory` | the policy layer over an injected store: novelty gating, plan/apply crystallization, judge-injected contradiction resolution, per-report confidence adjustment, `recallByEmbedding` (identity-gated, skip-reporting) |
| `@tangleai/outcomes` | independently resolved decisions, deterministic scores, atomic confidence projection, bounded artifact proposals, held-out checks and explicit CAS promotion/rollback ([API](packages/outcomes/README.md)) |
| `@tangleai/config` | the capability-profile registry and effective-run-identity contract: schema-generated types, a pure resolver (single-parent RFC 7396 inheritance, stable `TCFG1xxx` refusals), canonical content-addressed identities — every host resolves through it and every new result references the exact stack that ran ([docs/CONFIGURATION.md](docs/CONFIGURATION.md)) |
| `@tangleai/search` | zero-dependency SearxNG JSON client; `compose/searxng/` holds the docker settings |
| `@tangleai/documents` | static-first HTTP(S) fetching with URL/DNS/redirect/stream budgets, typed HTML/Markdown/PDF extraction, recursive/semantic/S2 chunkers, versioned corpus contracts, optional browser adapters, and identity-gated chunk retrieval |
| `@tangleai/store` | persistence: the same 4-method `MemoryStore` contract over SQLite plus atomic outcome records/projection and transactional source/version/element/chunk activation, the run/event log, and the MAS host — eleven semantic collections, compare-and-swap activation, atomic node completion, and durable run segments over `@jarenjs/db`'s own job queue and flow checkpoints (never a queue or checkpoint twin) |
| `@tangleai/pipeline` | the loop as an executable `jaren-dag` document (`@jarenjs/flow` runs it, `@jarenjs/mermaid` draws it FROM it), with `@tangleai/models`'s hash embedder (at a measured width) and the rule judge as injectable stand-ins |
| `@tangleai/mas` | the durable typed multi-agent runtime: one closed content-addressed workflow IR (`agent`/`task`/`graph`/`loop`/`switch`/`interaction`), a pure nine-gate validator with stable `TMAS1xxx` refusals, LINQ-pen lowering to compile-proven `jaren-dag`/`jaren-fsm` documents, and the transactional node lifecycle over `createAgent`/`createToolbox`/`createStructuredOutput`/`createBudgetAccount` ([packages/mas/README.md](packages/mas/README.md)) |
| `@tangleai/gmpl` | immutable schemas, fourteen compiled TOML/JTLT prompt artifacts and six multi-agent pattern recipes; pure domain/host bindings materialize the canonical MAS workflow and use its durable executor ([packages/gmpl/README.md](packages/gmpl/README.md)) |

The MAS runtime is measured before it is claimed: the registered
conformance instrument (`npm run benchmark:mas`,
[docs/MAS_RUNTIME_BENCHMARK.md](docs/MAS_RUNTIME_BENCHMARK.md)) holds
**11/11 positive runtime oracles and 7/7 exact negative refusals** with a
mechanical `runtime-conformant` decision recomputed by the report schema:
the weekly-report fixture runs three drafting agents at measured
concurrency 3 with declared-edge-order fan-in under reverse completion,
loops execute exactly their bounded iterations, untaken branches record
zero attempts and spend, typed interactions pause and resume the same
durable run, and every registered crash boundary reclaims with zero
duplicate scripted provider calls. Its stated limits travel with the
claim: same-machine SQLite job durability, at-least-once external
effects behind idempotency keys with an explicit `uncertain` state, the
suite's token-overshoot bound under concurrency, and no
natural-language workflow authoring or desktop runtime surface
([docs/ROADMAP.md](docs/ROADMAP.md) keeps those open).

Embedding mechanisms live in `@tangleai/models`: the wire client
(`createEmbeddingClient`, the same OpenAI-compatible provider family the
chat client speaks), the deterministic reference (`createHashEmbedder`),
the probe and the `{ embed, model, dims }` seam are `@tangleai/models/embed`,
and the kernels are `@jarenjs/core/vector`. Tangle brings the policies
and the configuration.

## Evidenced outcome lifecycle

`@tangleai/outcomes` separates decision creation, independent resolution, scoring
and confidence projection from artifact proposals, held-out checks and host
approval. Checked promotion and rollback compare both head version and revision.
Artifacts are immutable outcome records; they are not generic memory units.

```sh
npm run outcomes:smoke
node examples/outcomes.ts --db /tmp/outcomes.sqlite
npm run benchmark:outcome -- --require complete
```

The [public example](examples/outcomes.ts) runs numeric and exact-label adapters,
checks two versions in each domain and restores a previously active version.
Repeating it against the same file adds no writes or evidence reads.
The [adapter kit](packages/outcomes/docs/ADAPTERS.md) explains the trusted resolver,
scope/principal wiring, contract operations, request receipts and recovery.

The [registered outcome report](docs/OUTCOME_BENCHMARK.md) compares static,
checked scripted, projection-disabled and proposal-only behavior over the same
32 decisions, with 24 available outcomes and eight pending. It publishes every
round/domain, rejected candidates and safety result. Scripted candidates measure
the checked mechanism on this fixture; real-domain quality and automatic learning
remain open work. Its predictor does not consume confidence, so its projection
ablation cannot establish confidence's effect on decisions.

## Measurement

Every published number names the command that produced it, and the
instruments live in [`benchmark/`](benchmark/README.md) — a private
workspace of its own, so that a comparison against a rival memory system
can be run without a single third-party dependency reaching a package a
user installs.

`benchmark/locomo` is the [LoCoMo](https://github.com/snap-research/locomo)
benchmark (Maharana et al., ACL 2024) as a **git submodule**: the data is
CC BY-NC 4.0 and this repository is MIT, so nothing here redistributes it,
and the submodule pins exactly which release produced a number. Every
instrument degrades to a stated skip when its submodule is absent.

`npm run benchmark:locomo:census` measures the release rather than
describing it, and what it found is why it exists — 272 transcribed
sessions against 288 timestamps, six integer answers where the schema
suggests strings, and 9 of 2,815 evidence ids that resolve to no turn at
all, which caps evidence recall at 0.996 and makes an oracle row that
scores 1.000 a bug rather than a triumph.

`npm run benchmark:locomo:recall` is the first number — the keyless
ceiling. Every turn is ingested through the real pipeline, one store per
conversation and one run per session, and each of the 1,540 scorable
questions asks for k memories; the official `recall_acc` says how much
of its gold evidence arrived. The gate reproduces the 0.996 ceiling
exactly at k = 20 (and its lower, k-dependent ceiling at 5 and 10) before
a row prints. The original 64-dimensional lexical run showed a **loss** from
the historical shipped policies: evidence recall at k = 20 fell from 0.250 to
0.241. That [baseline JSON](benchmark/results/locomo-recall-baseline.json) is
retained. [docs/LOCOMO_RECALL.md](docs/LOCOMO_RECALL.md) reports the current
512-dimensional run, including both the historical thresholds and the selected
default. These deterministic keyless scores measure lexical retrieval.

The [registered memory-policy experiment](docs/LOCOMO_POLICY.md) completed on
2026-09-12: 24 lexical screen cells, five live selection cells (64 scored plus
6 adversarial questions each), then inert, historical shipped and the frozen
challenger on 89 held-out scored plus 8 adversarial questions each. OpenRouter
served `z-ai/glm-5.3-flash` answers, `qwen/qwen3.8-27b` adversarial judgments and
1024-dimensional `baai/bge-m3` embeddings. All eight live rows were eligible;
258 physical requests succeeded within the approved 900-request ceiling.

Held-out F1 was 0.156189 inert, 0.166193 historical shipped and 0.156908 for the
contradiction-0.8/minScore-0.25 challenger. The challenger's delta was +0.000719,
95% interval [-0.001464, 0.003216], paired SD 0.011458 and minimum detectable
effect 0.002380. That last quantity is the registered 1.96 × standard-error
precision diagnostic, not an equivalence test or an 80%-power calculation.
The challenger passed category and cost bounds but failed the required positive
overall interval, so **inert is the default**. Its evidence recall was 0.237266,
cited recall 0.227903 and tokens per answer 998.494, at one call per answer.
The historical shipped control also failed the overall interval; it had no
incumbency privilege. This result is bounded to one model, dataset and sample.

The default is derived from report
`b003bccaac49b44931787955e5caa0efddb58fec706da029760e50540d8f5b14`.
Its independent offline width decision (512) comes from lexical evidence recall,
not live answer quality. The screen allocated live budget; it did not predict
the wire. The [full report](docs/LOCOMO_POLICY.md) retains every loss, category
bound, cost and raw evidence link. `npm run policy:check` verifies the generated
policy, evidence identities, registry reference and effective runtime behavior.

The scorer that reads a model's answers beside those ceilings is at
parity with the published one: `benchmark/lib/locomo-parity.ts` ports
`task_eval/evaluation.py` to the letter — the article-after-punctuation
order, `and` as an article, NLTK's own Porter variant — and
`npm run benchmark:locomo:parity` produces its fixtures by *running* the
official evaluator, which the port reproduces on every row: 45
hand-authored cases at ten decimals, every one of the release's 3,263
question-and-answer tokens stemmed identically, and 4,602 dataset-derived
rows checked locally. Category 5 is excluded with its reason in the
report, never folded into a number.

`npm run benchmark:locomo:qa` is the answer path — the first F1, and it
is published only beside its ceiling. The keyless tier runs on every
commit: the released answer must score exactly 1.000 against itself
before a row prints, and each configuration gets its evidence-recall
ceiling at k = 10 and a model-free floor (the ten memories quoted as the
answer, ≈ 0.02). `--live` puts a real model over a seeded sample of 64
questions through the desktop's own provider settings, answering with
`{ answer, citations }` so every citation is checked against the prompt,
and meters every call through `createBudgetAccount`. The baselines that
make the number mean something sit in the same table — one scorer, one
sample, one corpus: the whole conversation in the request (the paper's
headline baseline), retrieval over the paper's three corpora (raw dialog
turns, the release's own `observation` facts, its `session_summary`),
the suite's `createLongHorizonAgent` over `createEnvironment`, and
Tangle — each with its ceiling, cited recall, cost and latency in the
row. Six rows do not fit one request ceiling, so the table is the merge
of runs, each inside `TANGLE_AI_MAX_CALLS`, and everything a run buys is
kept in a wire cache (`benchmark/cache/`, deletable at will) so a re-run
replays what it holds and spends only on the rest. **The historical table**
(2026-08-27, `z-ai/glm-5.3-flash` at its default thinking — its endpoint
refuses to disable reasoning — over `baai/bge-m3`, four runs, zero wire
errors, every row 64 of 64): **Tangle loses to every rival.** Long
context answers at F1 0.421 under a ceiling of 0.998; RAG over the
release's observations at 0.331 (ceiling 0.573); RAG over its session
summaries at 0.182 (ceiling 0.804); RAG over raw dialog turns — the same
pipeline with every policy inert — at 0.148; Tangle at **0.139**
(ceiling 0.202): 28.2 points behind long context, 19.2 behind the
observation corpus, 4.4 behind the summaries and 0.9 behind the inert
pipeline, the last two within noise over a sample this size. The suite's
own long-horizon agent, bounded to 16 turns and 12 sub-calls per question
so that a 12-question subset fits one ceiling, answers at 0.020: it cuts
a conversation into 43–79 pieces, reads the 12 the cap allows, and
answers null whenever the gold turn was in one of the 526 of 670 pieces
it never read — Tangle is ahead of it by 23 points over those 12
questions, a count too small to decide anything and stated as such. The
pipeline pair says where the loss lives: the shipped policies left the
prompt byte-identical on 47 of the 64 questions (the cache replayed those
answers), and on the 17 they changed, Tangle scores 0.088 against 0.122
under the same ceiling — the policies cost F1 without changing what
evidence arrives, which is the number the policy matrix and the temporal
lane ([docs/ROADMAP.md](docs/ROADMAP.md)) exist to move. The
earlier win (0.161 against 0.095, under a rate-limited run that answered
unequal sets) did not survive a run without wire failures. The
category-5 judge lane (50–100 % refused the false premise, where the
official keyword rule would have scored every one of them 0) is reported
apart and folded into nothing.
[docs/LOCOMO_BENCHMARK.md](docs/LOCOMO_BENCHMARK.md) is the rendered
report; the live JSON beside it is a dated record the tests validate but
never regenerate.

Those are historical answer policies. The current bounded-agent default uses
whole-corpus coverage, checked evidence collection and a separate cited synthesis.
The [September repair comparison](docs/BOUNDED_AGENT_BENCHMARK.md) records its
fresh results, every question's score, remaining errors and increased token cost.

`npm run benchmark:grounding` measures the document lane the same way:
a retrieved chunk is a candidate, and only a cited, resolvable, eligible
passage supporting a material claim counts as grounding. The keyless
tier proves the claim oracle to exact 1.000 ceilings and drives every
named bad answer to its one terminal outcome
(`supporting` … `unknown-evidence`); the authorized paired tier compares
the same model over the same questions with and without the shipped
retrieval's exact evidence bytes. The measured result (2026-09-01,
`z-ai/glm-5.3-flash` over `baai/bge-m3`, 123 calls, zero errors):
supported-claim F1 0.838 grounded against a structural 0.000 without
documents (two-sided 95% delta [0.714, 0.952]), answer F1 0.760 against
0.195, with zero forbidden citation outcomes — and the loss beside it:
without evidence the model abstains on 14 of 16 answerable questions,
and the separately labelled LoCoMo projection scores a poor absolute
0.155. [docs/GROUNDING_BENCHMARK.md](docs/GROUNDING_BENCHMARK.md) is the
rendered report;
`npm run benchmark:grounding:handoff` regenerates the immutable
downstream handoff every later retrieval treatment must beat.

## The apps

The desktop keeps browser automation optional. Ordinary HTML, text, Markdown, and PDF
documents are fetched and parsed inside the application; only client-rendered shells need
a browser process.

**The house rule, and its one recorded exemption.** Everything here is
jarenjs-suite-only — no third-party runtime dependency — except the document
lane, which takes three, deliberately (CONVENTIONS §1 asks that a new exemption
be a recorded decision rather than a default):

| Dependency | Where | Why the suite cannot supply it |
|---|---|---|
| `unpdf` 1.6.2 | `@tangleai/documents` | A PDF text/geometry extractor. Out of scope for jarenjs for the foreseeable future; `@jarenjs/core/chunk` cuts text, it does not read page boxes. |
| `linkedom` 0.18.12 | `@tangleai/documents` | An HTML5 parse tree with browser error recovery, plus a CSS selector engine. `@jarenjs/md/html` is explicitly *not* an HTML5 parser: it is an allow-list for raw HTML inside Markdown and drops what it does not recognise — correct for rendering trusted fragments, unusable for scraping hostile pages. |
| `playwright-core` 1.62.1 | `apps/scraper` only | A browser driver, and a browser is not a library. It never enters `dist/tangle`; the desktop reaches it over the adapter seam or not at all. |

The first two DO travel inside the compiled binary. They are the price of reading
PDFs and real web pages; the boundary they must not cross is the API — no
LangChain `Document`, no DOM type, and no `unpdf` type appears in
`@tangleai/documents`' contracts.

**`apps/desktop`** — a self-hosting desktop app: point it at a folder,
sync it (content-hash incremental) through the pipeline, watch the DAG
run LIVE over an SSE stream and browse every past run's per-node story,
search the curated memory (superseded chains included), ingest/search versioned web and
PDF sources on the Documents page, and chat over the two explicit retrieval lanes.
A configured model answers under a measured claims-with-citations contract
(`createStructuredOutput` plus a supplied-reference gate that repairs a
fabricated id), so a citation is an id the answer actually used — retrieved
unused candidates never surface. Chat degrades honestly: with no model
configured, a dead wire, or a reply that stays invalid after its one repair,
you get grounded recall — the sources themselves, quoted and
cited — never an invention. The whole API is one
`@jarenjs/contract` document served over `node:http`; the UI is a
`@jarenjs/app` document rendered by `@jarenjs/view`; storage is SQLite
through `@jarenjs/db`.

```sh
npm run desktop            # dev (Node or Bun), http://127.0.0.1:4700
npm run desktop:compile    # one self-contained executable → dist/tangle
./dist/tangle --folder ~/notes
```

Document ingestion defaults to recursive heading-aware chunks. Changed sources activate
transactionally only after extraction, chunking, embedding, and persistence succeed;
unchanged content is not embedded again. Configure SearxNG discovery, experimental S2,
or a dynamic-page renderer in Settings. Results are recorded in
[docs/DOCUMENT_BENCHMARK.md](docs/DOCUMENT_BENCHMARK.md).
The opt-in live smoke uses the OpenRouter chat/embedding models configured in `.env`;
offline CI never requires those credentials.

**`apps/scraper`** — the optional isolated Playwright renderer. It is not required by the
desktop and is intended to run in the `ubuntu-playwright` distrobox or another sandboxed
container. See [apps/scraper/README.md](apps/scraper/README.md).

Cross-compile with Bun's targets, e.g.
`bun build --compile --target=bun-windows-x64 apps/desktop/src/main.ts`
(run `bun scripts/embed-assets.ts` first so the UI travels inside).

**`apps/pages`** — the GitHub Pages site (`bun apps/pages/build.ts` →
`apps/pages/dist`, deployed after CI independently of Tangle npm publication).
It builds Tangle's local workspace source and uses the recorded installed Jaren
artifacts. Its demo
is not a mock: the real pipeline document executes in your browser over
the in-memory store, and the recall you ask for afterwards is real
ranked retrieval — the superseded record provably cannot surface.

The private Pages build uses the official `@sqlite.org/sqlite-wasm`
`3.53.0-build1` initializer for its browser Data and project workers. This is a
narrow exception to the JarenJS-only dependency rule: it is a Pages build
dependency, bundled with its WASM asset for that private application. Published
Tangle packages and Jaren's shared editors contain no foreign initializer; the
workers inject it into the public `@jarenjs/studio/data/host` factories. The
shared Jaren driver, contract, transport and editor remain the execution path.

## JarenJS release integration

Tangle consumes 23 AI-free Jaren **0.87.0** packages from npm. The source
submodule at `vendor/jarenjs` pins `9b67ed8cb88d2dbe95cb3eb5fe0ac88cfb70f347`.
The [registry receipt](docs/integration/jaren-0.87.0-registry.json) verifies all
23 downloaded archives against the exact lockfile integrities.
`npm ci --ignore-scripts` installs from npm without a foundation bootstrap;
`npm run jaren:check` verifies source, manifests, installed versions and archive
URLs. Installed packages are never patched or source-linked. The existing
storage seam accepts supervised Node processes; `npm run store:supervised:smoke`
runs both outcome domains and proves zero-effect replay after reopening.
Native SQLite schema plans, column references and JSON type inspection are
qualified alongside Tangle records on Node and Bun. The current document model
requires no schema migration; host-owned physical entities use Jaren's bounded
mutation statement cache directly.
See the [migration handoff](docs/JAREN_AI_MIGRATION.md) for ownership and
historical source/archive qualification. Tangle publication remains manually
author-owned.
See [the integration audit](docs/JARENJS_INTEGRATION.md) for adopted APIs,
compatibility details and benchmark-based strategy choices, and
[the Node/Bun comparison](docs/JARENJS_BENCHMARK.md) for measured history reads.
The [paid refresh](docs/PAID_REFRESH.md) records fresh OpenRouter answer,
grounding and desktop checks, with their losses, coverage and request counts.
The [bounded-agent repair](docs/BOUNDED_AGENT_BENCHMARK.md) measures whole-corpus
coverage, checked evidence and cited synthesis under the original call cap,
with the earlier empty-answer result retained beside the new measurement.
`npm run mas:live-smoke` opts into the configured model for the durable
draft/review/resume workflow; `npm run mas:smoke` remains keyless.

## Package releases

Changesets records patch or minor intent for one fixed group of sixteen public
packages. `npm run release:prepare` updates their versions, all private workspace
versions and references, the lockfile, changelogs, and a checked release record
**before** the release commit is pushed. Major release intent is refused while
the project remains at major zero. The root, applications and benchmark stay
private. Public libraries use compatible internal ranges; private consumers pin
the suite exactly.

```sh
npm run release:install-hook
npm run changeset
npm run release:prepare
npm run release:verify
npm run release:closeout -- --message "Fix the affected behavior" --push
node scripts/release/tag.ts
release_tag="v$(node -p 'require("./package.json").version')"
git push origin "refs/tags/$release_tag"
```

A closeout request authorizes the complete sequence by default: verify, commit
directly on `main`, push `main`, create the annotated version tag and push it.
Run each command only after the preceding one succeeds, then confirm both
remote refs identify the release commit as described in the
[release protocol](docs/workflow/RELEASE.md). The current closeout helper needs
`--push` and the separate tag commands shown above. For an explicit local-only
closeout, omit `--push` and skip tagging/pushing. No pull request is created.
The author publishes manually from the clean committed checkout:

```sh
npm run publish -- --dry-run
npm run publish
```

The command verifies the final committed artifacts, verifies or creates the local
annotated tag, publishes the 16 tested JavaScript/declaration archives using local npm
authentication, and checks fresh registry installations. It does not push.
Separate edits, including `.env.example`, must be committed through closeout or
stashed and restored around publication. GitHub Actions verifies the release
and independently deploys Pages; it does not publish npm packages. See the
[release protocol](docs/workflow/RELEASE.md) for setup, recovery and the complete
closeout sequence.

Changesets and its configuration/package-discovery APIs are development-only
release tooling. They are exempt from the JarenJS runtime dependency policy and
are excluded from every public distribution.

## Where things stand

- [docs/LOCOMO_POLICY.md](docs/LOCOMO_POLICY.md) — registered policy screen, live census, selection and held-out decision, with paired uncertainty and cost
- [docs/ROADMAP.md](docs/ROADMAP.md) — what Tangle wants to have and does
  not yet: open work only, each entry with the constraint that makes it
  hard and the measurement that would close it; the LoCoMo instrument
  ([docs/LOCOMO_BENCHMARK.md](docs/LOCOMO_BENCHMARK.md)) gates every
  policy entry
- [docs/BOUNDARY.md](docs/BOUNDARY.md) — where generic Jaren foundations, Tangle mechanisms and host policies belong
  versus here, and the one test-pinned contract between them
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the loop, the two
  load-bearing ordering rules, the house style
- [docs/PAPERS.md](docs/PAPERS.md) — the research this implements, with
  per-paper status; PDFs archived in [docs/refs/](docs/refs/)
- [docs/workflow/](docs/workflow/README.md) — how this repo is changed and
  proved: conventions, the bootstrap prompt, campaigns (router, orders,
  session records — gitignored scratch), health pass, release — each with
  a machine-readable stage block, and [EVOLVE.md](docs/workflow/EVOLVE.md),
  the gated design for running these workflows as evolvable DAGs
- `prompts/` — memflow's TOML prompt packs, carried as data for the
  consolidation, skill-loop, outcome and pattern entries of the roadmap
