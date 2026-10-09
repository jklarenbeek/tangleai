# @tangleai/lightrag

Evidence-bound graph contracts and atomic projections for experimental retrieval.
The package provides immutable entity and relation claims, canonical projections,
name and theme normalization, pure contribution plans, and an in-memory store.
`@tangleai/store` supplies the same write boundary over SQLite.

```ts
import { createMemoryLightRagStore, planContribution, planProjectionWrites } from '@tangleai/lightrag';
import { createLightRagStore, openTangleDb } from '@tangleai/store';

const memory = createMemoryLightRagStore();
const db = await openTangleDb();
const durable = createLightRagStore(db);
// Hosts provide validated claims, real chunk addresses, canonical candidates,
// prepared profiles and the expected source head to the pure planning functions.
// Apply a successful ProjectionWritePlan through memory.apply or durable.apply.
await db.close();
```

Claims bind source, document version, chunk, extraction prompt, model and ordinal.
Their content addresses exclude physical projection membership; the same immutable
claim can belong to recurring source contributions without a circular hash.
Canonical support is the exact union of supplied claims. Changed profile text
binds its complete current claim basis; withdrawing the last claim retains a
retracted row with empty support and profile. Unaffected revisions remain stable.

Names fold through NFKC, lowercase and collapsed whitespace. Different entity
types stay separate. An evidence-backed `identityClaimId` distinguishes reviewed
homonyms with the same name and type. A merge requires an explicit claim-bound
co-reference decision; its lowest canonical id survives, losing rows remain
addressable, and directed relations acquire new addresses when endpoints change.
Reversed relations and distinct theme sets remain distinct. Vectors never decide
a merge and must retain their declared embedding identity.

`planProjectionWrites` and `planRetraction` consume the shared outcomes head
transition. `apply` rechecks the real source head, expected canonical records,
matching names, adjacency and active claim membership inside one transaction.
A stale source head retains the originating outcomes refusal as its cause.
Each retained projection keeps its activation/retraction fences, contribution-plan
revision and claim-bound co-reference decisions with their reasons. Injected
failures roll back every write. Exact replay changes zero rows or
revisions. Identical retained contributions reactivate without new claim writes.

Write plans bind retained preparation in their request and prior projection
snapshots. Projection writes omit that duplicate payload; the checked apply
boundary restores its exact bytes before storage. The optional
`compactPreparations` planner setting stores an incoming contribution plan once
and binds prior cached preparations by their canonical hashes. The transaction
checks those hashes against retained bytes before resolving any writes or replay;
a missing or changed cache refuses the transition. This bounds serialization
without removing stored evidence. `checkLightRagWritePlanWithin` returns the
resolved `preparationSources`; pass them to
`storedLightRagWrite(write, preparationSources)` when inspecting physical writes.
The complete plan also supplies those sources for the default representation. Recompute
serialized write plans created with the older expanded representation before
applying them; stored projections and retained contributions keep their format.

Default claim/profile reads expose active contributions; historical or staged
reads must be requested explicitly. SQLite collections retain their own physical
membership metadata while the package owns the logical validation.
Large membership filters use bounded native queries within the same transaction,
preserving filter intersections, distinct physical rows and stable id ordering.

Content boundaries return `{ valid, value }` or `{ valid: false, issues }` with
`TLRAG1001`–`TLRAG1010`. The scoped apply helper throws an internal refusal to
unwind its caller's atomic transaction; the public store converts it to a value.
No root import opens a database, reads a prompt file, or constructs a model wire.

These are contract, lifecycle and scripted mechanism guarantees. The independently
registered benchmark executes low, high, hybrid and hybrid-no-original retrieval
beside unchanged dense, random and oracle controls. It publishes losses as well
as gains. Live model extraction, planning and generated answer quality remain
unmeasured; graph retrieval is experimental and does not change the default.

`buildContribution` prepares one source and document version through injected
extractor, profiler, candidate resolver and embedder functions. It returns a
validated contribution plan, content identity, partial failures, completed chunk
ids, warnings and counted calls, tokens and milliseconds. It receives no writable
graph store. Hosts decide whether a partial contribution is eligible to activate.

`createStructuredExtractor` uses the shared structured-output mechanism with at
most one repair and one additional gleaning pass by default. Claims retain the
credential-free client model and extraction prompt revision. Scripted variants
make no provider calls. Every live seam and the embedder share the caller's
`createBudgetAccount` instance and injected clock; reservation happens before
asynchronous work starts. Budget exhaustion returns `TLRAG1005` with incurred
spend and completed chunks. Invalid provider usage cannot poison the account.

`createCandidateResolver` queries existing evidence before considering a
co-reference decision. Only normalized-name and type collisions need review;
claim ids distinguish identical-name homonyms. Decisions must partition all
supplied claims, preserve existing groups and include reasons. A vector is never
an input to this judge. Name and relation-theme vectors are embedded in separate
batches and checked against one declared model and width.

Profiles use a deterministic bounded set of supporting descriptions and report
omitted contexts. The plan still binds each profile to its complete current
claim basis, including withdrawal and endpoint changes. Unaffected canonicals
are not reprofiled. `prepareGraphProfileBasis` returns evidence bases only;
`planContribution` retains the strict requirement for prepared profile text.

Four owned prompt roles are available through `lightRagPrompt` and the
`./artifacts` JSON export. Build-time TOML compiles static instructions; runtime
input follows as one canonical JSON block. The artifact revision binds the
resolved input and output schemas. No template interpolation or runtime file
read occurs. Run `npm run lightrag:prompts -- --check` to check source drift.

`readContributionSnapshot` queries matching names, affected adjacency and exact
support claims instead of scanning the whole graph. During replacement, withdrawn
claims remain available to co-reference resolution as identity context; they
never remain active support. An unchanged entity can preserve its canonical id,
while a reviewed replacement homonym receives a distinct one.

Retained projections store their original validated contribution. The source
contribution address excludes mutable canonical state. `rebaseRetainedContribution`
reuses immutable claims, profiles, vectors and persisted canonical lineage;
changed current profile bases become explicit deterministic description unions.
`prepareGraphRetraction` removes the withdrawn support using the same strict
planner. `@tangleai/store` verifies real document evidence and commits both heads
together. Activation audits bind the document bundle, previous source fence and
profile policy; exact replay and zero-call reactivation remain separate receipts.

`createKeywordPlanner` calls the shared structured-output mechanism with one
repair. `createScriptedPlanner` supplies the same checked plan from authored
questions. Both fold and bound low entity keywords and high relation keywords;
an empty required level returns `TLRAG1008`. The whole question is never used as
a replacement vector. The planner and query embeddings consume the host's shared
budget account, retain incurred spend on failure and use an injected clock.

`retrieveLightRag` matches entity names for low mode and relation themes for high
mode. Hybrid combines both. It adds relation endpoints and makes exactly one
indexed adjacency pass from the initial roots. Newly reached endpoints do not
start another pass. Identity or width mismatches are skipped and counted. Every
canonical support address must resolve to the source's active document version;
source and graph fences are checked again before a result is returned.

The optional `LightRagStore.rankRows` seam returns complete candidate rows or
`null` to request the ordinary sweep. Retrieval retains the same cosine kernel,
binary tie order, invalid-vector counts and full rejected-candidate trace.
Storage details stay in `@tangleai/store`'s explicit graph vector capability;
the default store uses the sweep. A bounded top-k native window alone cannot
reproduce this public trace. The [scale report](../../docs/VECTOR_SCALE.md)
measures the complete retrieval call, including its final validation and copy.

Complete embedding-identity swaps use the joint document/graph staging owner.
Inactive canonicals retain their own validated identity and evidence. Active
and incoming graph contributions still require the current settled identity.
A retained rollback can supply its original claim-bound profiles during rebase,
so exact rollback preserves profile text as well as vectors and support.

`LIGHTRAG_LIMITS` records 8 keywords per level, 10 candidates per keyword,
20 added entities, 40 added relations, 3 citation chunks per source and 4,000
estimated context tokens. Host overrides are explicit; the keyword artifact's
hard maximum is 32 per level. Ties use score descending then id ascending.
`serializeLightRagContext` owns the entity, relation and verbatim chunk sections.
The context budget drops chunks, then relations, then entities from the lowest
score, without altering retained evidence. Every prune is recorded in the trace.
Canonical support is filtered to the supplied citation vocabulary when rendered.

Hybrid-no-original selects under the same full-context budget as hybrid, then
omits verbatim chunks while keeping the same graph records and citation targets.
Its chunk recall therefore equals hybrid by construction; any independent answer
quality claim requires a measured generation experiment. Runtime phase timings
may be omitted with `includeTimings: false` for deterministic artifacts. A graph
or document head change during retrieval returns `TLRAG1008` for a host retry.
See `examples/lightrag.ts` for preparation, joint admission, reactivation and a
query through the public packages.

`createLightRagRetriever` composes a keyword planner and retrieval under the
caller's shared budget. `createLightRagEngine` consumes that retriever and the
shared `@tangleai/documents/grounding` answer contract. It returns a content
addressed answer record with query, mode, graph revision, source projections,
retrieval trace, prompt/model/embedding identities, spend and stop reason.
Generation treats all supplied profiles and chunks as untrusted evidence.
Only supplied document chunk ids are citable; entity and relation ids fail the
same reference gate. A named chunk is never replaced with a different citation.

A null client returns `no-model` grounded recall. Empty model output, invalid
citations after one repair, a dead wire and a spent budget return named recall
values containing the same evidence and citation targets. Model attempts reserve
budget before awaiting the client and retain incurred spend. An optional
`recordSink` receives the validated immutable record; the package does not choose
a persistence destination. `validateLightRagAnswerRecord` checks schema, content
identity and the exact relationship between generated claims and citations.

The desktop exposes experimental `lightrag.status` and `lightrag.retrieve` reads.
The Documents panel displays the returned mode, graph revision, three evidence
sections, skips, pruning, spend and citation links. Retrieval can call the
configured planner and embedder, but creates no chat, run or model-identity rows.
The answer engine remains a separate public composition. Inspecting evidence
does not establish an answer-quality improvement or change flat chat defaults.

Run `npm run lightrag:smoke` for the public keyless lifecycle, all four modes
through memory and SQLite graphs, a no-model answer and a conservative GC dry
run. Its ambient fetch trap must observe zero requests. The packed consumer runs
the same example from installed JavaScript under Node and Bun.

`npm run benchmark:lightrag` publishes the authored corpus's oracle, random,
dense and four graph rows, citation resolution, graph coverage and every loss.
It also measures replacement in the immutable grounding relay history without
re-extracting unrelated chunks or changing their canonical revisions.
`npm run benchmark:lightrag:ladder` records native SQLite observations at
100, 1,000 and 10,000 chunks; the registered target is hybrid p95 at most 250 ms
at 10,000. The receipt distinguishes logical records read from physical database
pages and records its machine, source and process peak RSS.
The command grants Node an 8 GiB old-space heap allowance for the full retained
10,000-chunk admission; this is not a process RSS cap. A default-heap run
exhausted memory during admission. Reopening that aborted SQLite transaction
confirmed zero persisted document or graph rows; the same preparation committed
successfully with the larger allowance. Query latency and peak RSS remain
separate measurements in the registered receipt.

`npm run benchmark:lightrag -- --live` prints a credential-free plan and spends
nothing. `--rows` selects separately authorizable rows; the exact plan id is
required by `--authorize`. Extraction is counted by active chunks and gleaning;
unknown profile/review work has explicit conservative bounds, including repairs.
A plan exceeding the configured request ceiling is refused. The regenerated
flat control retains the immutable handoff settings, records every scalar drift,
and shares the existing claim/citation scorer. Per-question attempts and all
failures survive in the receipt. Paid, replayed, mixed and scripted work are
labelled separately; the physical guard reserves before every request.

The paired default gate requires the registered positive supported-claim F1
interval and cost/latency limits. No measured keyless row changes the default.
`--judge --live-json <receipt>` prints a separate order-swapped diagnostic plan;
its four dimensions and both orders never enter that gate. The UltraDomain
entry, `npm run benchmark:lightrag:parity`, records a separate licensed-dataset
protocol and remains explicitly unrun. See the generated
[benchmark report](../../docs/LIGHTRAG_BENCHMARK.md) for current observations,
bound identities, approval commands and remaining limits.
