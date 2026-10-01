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

These are contract and lifecycle guarantees. Extraction, keyword planning,
graph retrieval and generated answer quality are not measured by this package's
contract fixture. The independently registered benchmark keeps those graph rows
unexecuted until their mechanisms are qualified.
