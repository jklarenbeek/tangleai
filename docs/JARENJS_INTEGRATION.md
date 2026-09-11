# JarenJS integration

Audited 2026-09-11 against **0.83.2**, source tag `v0.83.2`, commit
`f21b18fa123a6c72a0ca31dbad374ec5a8bf78ff`. All 14 installed JarenJS packages
resolve to this exact base release. The installed AI package additionally carries
the reviewed [program patch](../patches/README.md), applied and hash-checked by
`npm run jaren:patch` during installation. Runtime code uses these npm packages;
[`vendor/jarenjs`](../vendor/jarenjs) is the source and benchmark reference.

```sh
npm ci
git submodule update --init vendor/jarenjs
npm run jaren:check
npm run check
```

Do not recursively initialize the upstream benchmark datasets for an application
build. The source pin, direct dependency pins, lockfile and installed release are
checked together. The source checkout is optional for consumers and Pages builds;
the committed gitlink is always checked.

## Adopted surfaces

| Component | Suite authority and integration |
|---|---|
| Storage | `@jarenjs/db` owns SQLite drivers, transactions, validation, query plans, cursors, jobs and checkpoint persistence. Transaction callbacks now accept the actual scoped `TransactionStore`. `openTangleDb` exposes all suite host options, including runtime, transaction policy, native pragmas and maintenance/read-only profiles. |
| History and traces | Run history consumes an ordered suite cursor and closes it after the requested number of rows. MAS attempt/message/state/trace predicates and ordering execute through the query planner; document version filters execute before materialization. Document text ordering retains the existing locale comparison. |
| Durable workflows | `@jarenjs/linq/flow` authors versioned tasks; `@jarenjs/flow` compiles DAGs/FSMs, checks checkpoint identity and drains sibling work on abort. The executable identity includes the host ABI, suite versions, registry revision and CONFIG catalog revision. Stored checkpoint values carry the suite's provenance atomically. Changed input, mismatched executable revisions, mixed identities and old identity-free checkpoints refuse automatic restore. |
| Durable queue | Worker checkpoints follow the currently renewed lease. Completion/failure uses the claimed lease token; the suite owns renewal and fencing. The MAS worker exposes the full suite worker options, including renewal, effect admission and outcome observation, plus its lost/cancelled/renewed counts. Tangle owns semantic attempt commits, interaction resolution and uncertain external-effect policy. |
| Agent memory | `createMasAgentContext` composes the suite ledger, environment and JSON query engine. `createDbLedgerStorage` supplies atomic scoped mutations over the existing settings collection, so independent ledger instances share counters and publish complete changes in one transaction. Embedder, goal limits and archive retention limits pass directly to the suite. No second ledger, compactor or retention algorithm is introduced. |
| Grounded answers | `createStructuredOutput` owns generation and repair. `validateClaimEvidence` now owns generic claim identity and supplied-reference integrity through an envelope built from the evidence actually serialized into the prompt. The measured answer contract still allows uncited claims; Tangle's fixture oracle alone judges semantic support, source freshness and the six terminal citation states. |
| Memory policy | Ledger projection uses the published `LedgerMemory` type. Tangle's stored policy records specialize evidence to a nonempty source string, while the suite ledger also accepts structured claim evidence. Novelty, contradiction, crystallization, policy learning and benchmark-specific scoring remain application policies. |
| Bounded corpus QA | `createLongHorizonAgent` receives the query analyzer and type annotator. Tangle's `covered-evidence-v1` policy sizes line chunks for complete coverage within the call cap, validates leaf references, checks reducers on empty/single/multiple inputs, and synthesizes a nonempty cited answer. Runtime reducer repairs reuse identical validated leaf requests. Explicit abstentions and invalid answers remain separate. The legacy strategy is retained for historical replay. |
| Provider configuration | The suite owns endpoint resolution, completion/embedding transport, retries, replay keys, structured output and budgets. Optional `maxTokens` and `maxTokensField` settings reach the chat client and the effective run identity. Both `max_tokens` and `max_completion_tokens` are selectable. Historical identities remain readable. |
| Document transport | `@jarenjs/core/schedule` replaces the custom semaphore and host timers. Each robots, document and redirect request is scheduled by its actual host, through body consumption, with bounded queue/scope state, a suite LRU robots cache, cancellation and drained shutdown. URL/DNS/robots/terms/byte policies remain Tangle's. Clock and sleep are injectable. |
| Desktop host | One `createRuntime` record reaches the database and HTTP dispatcher; its clock supplies default application timestamps and request scheduling. Explicit host overrides retain precedence. Desktop shutdown drains document requests before closing the database. The UI uses bounded suite reconnects and reconciles completed syncs through the same contract snapshot read; late stream frames cannot replace newer state. |
| UI and website | `@jarenjs/app` and `/view` execute both UI documents; `/contract` owns HTTP, clients, subscriptions and contract diffs; `/json` owns queries and patches; `/mermaid`, `/charts` and `/md` supply the existing renderers. `/validate` and `/emit` validate contracts and generate all six declaration bundles. |
| Shared algorithms | `/core` supplies vectors, random draws, statistics, JSON cloning/equality, canonical helpers and bounded async work. `/ai` supplies embedders, chunking primitives, agent/toolbox/budget/environment/program execution. Existing parser exceptions remain `linkedom`, `unpdf`, and Playwright in the external scraper. |

Example durable context, using the same database as a host:

```ts
import { createMasAgentContext } from '@tangleai/mas';
import { createDbLedgerStorage, openTangleDb } from '@tangleai/store';

const db = await openTangleDb({ path: 'tangle.sqlite' });
const context = createMasAgentContext({
  storage: createDbLedgerStorage(db, 'assistant/main'),
  now: () => new Date().toISOString(),
  archiveLimits: { maxItems: 100, maxBytes: 1_000_000 },
});
await context.putCorpus('source/report', 'An addressed source document.');
// Finish active agent work before closing its host database.
await db.close();
```

## Strategy evidence

The pinned [upstream benchmark report](../vendor/jarenjs/benchmark/README.md)
and [database measurements](../vendor/jarenjs/packages/db/README.md) inform the
choices; they are separate from Tangle's own results.

* **Exact vector search remains the default.** The upstream labelled SciFact
  BGE-M3/1024 run over 5,183 documents and 300 queries reports exact recall@10
  0.783, MRR 0.608, nDCG 0.644 and p95 23.356 ms. Projection at 0.1 reports
  recall 0.597/p95 60.017 ms; at 0.5, 0.760/324.474 ms. None of six tested
  approximate settings passed all adoption bars. These particular strategies
  fail to justify replacing exact ranking; the result does not generalize to
  every ANN index or corpus.
* **Packed vectors need a dimension-specific migration and host measurement.**
  Upstream's synthetic 10k × 768 comparison reports 468 ms for JSON-document
  scanning, 30 ms for a packed plan and 5.8 ms for a resident scan. Packed
  storage also increases write cost and footprint. Tangle supports changing
  embedding models and widths; it keeps identity-gated exact ranking until a
  representative corpus justifies a persistent packed layout. A SQLite vector
  UDF cannot become a shared default because Bun lacks that registration seam.
* **Bounded history is adopted and measured locally.**
  [`benchmark/jaren-strategies.ts`](../benchmark/jaren-strategies.ts) compares
  the shipped ordered cursor with the former full-load/sort/slice path on real
  SQLite in Node and Bun. Both must return identical IDs. See
  [the recorded measurements](JARENJS_BENCHMARK.md): the reduction in host rows
  is reliable; elapsed time depends on runtime and query planning.
* **Virtual collections and lexical ranking have different semantics.**
  Upstream's fixed collection benchmark mounts 170 cells and retains 256 rows
  for 10,000 records, demonstrating bounded rendering and cache work. The
  current memory screen requests at most 200 rows and has no remote grid
  protocol. Introducing a virtual grid would require that product contract.
  Lexical search is available for a future ranked text endpoint; it cannot
  silently replace substring filtering or embedding scores. Current limited
  history reads use database cursors now.
* **Workflow and agent composition follows the existing contracts.** The new
  composed workflow/statechart formats, formulas/rules, ingestion providers,
  automatic model routing, skill evolution, format/localization/form builders
  and authoring studio have no separate shipped component to replace here.
  MAS still lowers its typed port, branch, loop and interaction policies into
  suite DAG/FSM documents. Model choice remains explicit in CONFIG; automatic
  routing would change benchmark identities and spending policy. Self-evolving
  policies still require the registered quality instrument before activation.

The upstream adoption report explicitly separates synthetic evidence from real
host qualification. This integration likewise does not claim production-scale
recall, browser-grid performance or paid model quality from keyless fixtures.

## Compatibility and verification

The optional token properties constrain previously unspecified extra input
members; the contract diff correctly reports two `R6` entries. The existing
citation output closure remains `R8`. Tests pin those exact changes while
preserving previously supported settings and credential redaction.

One upstream declaration defect needs a narrow, documented bridge:
[`jaren-flow.d.ts`](../packages/mas/src/jaren-flow.d.ts) adds the versioned
three-argument `task` overload that the 0.83.2 JavaScript runtime implements
but its published handwritten declaration omits. It changes no runtime code.
The upstream fix belongs in `packages/linq/types/flow.d.ts`.

The AI patch makes runner results a typed success/failure union with complete
accounting, including zero counts on compile refusal. The long-horizon benchmark
still reads historical step counts alongside aggregates without double-counting.
Recursive failure envelopes retain `value: null` and their error metadata, so a
failed leaf does not invalidate otherwise usable collected evidence.

The [bounded-agent repair](BOUNDED_AGENT_BENCHMARK.md) was measured using the
unmodified published release. The current installation applies
the explicit AI patch while preserving the source submodule. QA-specific prompt,
coverage, evidence, repair and synthesis policies live in
[`horizon-agent.ts`](../benchmark/lib/horizon-agent.ts). Its single host budget
includes all authoring, leaf and synthesis attempts. Full checked result slots
are now read through the suite's `readProgramAnswer` with Tangle's 64,000-character
bound, because the runner's answer field is a preview. JarenJS uses the same
reader for complete child results at recursive depth. Installed-consumer tests
exercise the actual default author example with a failed leaf and a child answer
beyond the preview, and typecheck the generated public result declarations.

Regression checks exercise checkpoint identity refusal, crash/reclaim without
duplicate calls, concurrent ledger counters, transaction rollback and SQLite
reopening, scheduling/abort/drain, both token-limit fields and run identity,
contract narrowing, all existing policy oracles and the keyless instruments.
The [paid refresh](PAID_REFRESH.md) exercises the configured OpenRouter chat,
judge and embedding models through all six answer strategies, the registered
grounding comparison, the durable MAS review/resume workflow and the desktop's
live document path. Failures and unequal coverage remain in the reports.
Historical paid reports retain their original identities and results. Browser,
compiled-binary and deployed-site checks validate the actual packaged surfaces.
