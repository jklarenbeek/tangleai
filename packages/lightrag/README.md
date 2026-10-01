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
Default claim/profile reads expose active contributions; historical or staged
reads must be requested explicitly. SQLite collections retain their own physical
membership metadata while the package owns the logical validation.

Content boundaries return `{ valid, value }` or `{ valid: false, issues }` with
`TLRAG1001`–`TLRAG1010`. The scoped apply helper throws an internal refusal to
unwind its caller's atomic transaction; the public store converts it to a value.
No root import opens a database, reads a prompt file, or constructs a model wire.

These are contract, lifecycle and scripted extraction guarantees. Live extraction,
keyword planning, graph retrieval and generated answer quality are not measured
by this package's fixtures. The independently registered benchmark keeps those graph rows
unexecuted until their mechanisms are qualified.

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
