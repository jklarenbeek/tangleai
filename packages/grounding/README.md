# @tangleai/grounding

Versioned policy, evidence contracts and durable session state for governed
retrieval. Root imports work in browsers. The package supplies contract and lifecycle primitives, hybrid local retrieval
and explicit corpus promotion. Answer generation is not yet implemented.

```ts
import { createMemoryGroundingStore, loadGroundingProfile } from '@tangleai/grounding';
import document from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };

const profile = await loadGroundingProfile(document);
if (!profile.valid) throw new Error(profile.issues[0].detail);
const store = createMemoryGroundingStore();
await store.putProfile(profile.value);
const session = await store.createSession({
  conversationId: 'conversation-1',
  profileId: profile.value.id,
  profileRevision: profile.value.revision,
});
```

`loadGroundingProfile` validates the closed document and its canonical SHA-256
revision, then freezes it. `evaluateProfileRules` matches literal phrases after
NFKC normalization, with Unicode letter/number boundaries. Authority lookup uses
exact hosts and path boundaries; unknown hosts have no authority. Models are
host-resolved purpose identifiers. The included profile names Hong Kong as data
but uses only fictional Harbour District hosts and emergency test phrases. It is
not a healthcare service configuration or a clinically validated safety policy.

`groundingSchemaOf` and `validateGroundingShape` expose the draft-07 contracts;
generated record types are also exported from `./contracts`. Configuration model
identities reference the existing configuration schema, and persistence verifies
their canonical identity. `groundingIdOf` derives deterministic record addresses
from supplied JSON payloads without reading a clock.

`planSessionTransition` is the single pure state planner. `start` creates an open
session at revision 1; each command advances exactly one revision. Triage can
request and accept bounded clarification, then apply a retained intent and query
plan. Retrieval and reconciliation precede generation. `answer` without an id
enters `generating`; `answer` with a retained answer id completes it. Refusal and
failure are terminal; `refresh` requires an explicit reason and preserves prior
answer ids. Stores compare the expected revision in the same transaction as the
write.

The memory store and `createGroundingStore(db)` from `@tangleai/store` consume the
same guarded persistence owner. Profiles, manifest facts, intents, plans, evidence,
web runs, conflicts and answers are immutable: identical re-put returns
`changes: 0`, different bytes under an existing address refuse. `putAnswer` with
an expected session revision commits the answer and terminal session together.
Exceptions roll back every write, including a partially applied batch. Reads
return frozen JSON copies. Store failures return `{ ok: false, issue }`; content
validation returns `{ valid: false, issues }` with `TGRD1001`–`TGRD1010` and
preserves an upstream cause code and pointer.

Curated manifests require a retained profile revision and curator provenance; a
source may have only one active manifest. Curated local evidence must agree with that
manifest's authority and time facts. Uncurated local evidence is explicitly
unverified with null time provenance; fetched or last-modified dates cannot become
publication or effective dates. Evidence and conflict references stay inside
their session and profile. Dynamic web evidence cannot be written as a curated
manifest. Only claim-used evidence becomes visible citations; unused candidates
remain in `readTrace().unused`. Unsupported critical claims cannot be stored as
an answered result. These checks establish reference integrity, not entailment.

User context must be explicitly supplied. Durable records accept only named fields
in both `userContext.collectable` and `userContext.persistable`; other collected
fields remain the caller's request-local responsibility. The profile permits
administrative `service` and `purpose` fields and no inferred medical profile.

`createLocalRetriever` consumes a document corpus, an embedder, a named
`CandidateRanker`, session/profile identities, a clock and token budgets. It
ranks only active `parent-child/1` children through the shared document semantic
ranker and core lexical index. `createRrfRanker()` uses `rrf/1`; raw semantic and
lexical scores survive fusion. Hosts may supply another ranker, but it can only
add finite ranking scores to unchanged evidence. Explicit lane switches support
measurement of semantic-only and lexical-only variants.

The lexical index rebuilds when the active version set changes and records its
generation, source revision and rebuild time. Results include selected evidence,
unique expanded parents and a census of skips, deduplication, diversity losses,
parent budget refusals and issues. Empty success says `reason: 'no-evidence'`;
index or host failures are counted error values. Parents supply context under a
token budget without being embedded. Repeated queries reuse the resident index.

`promoteToCorpus(store, manifest, bundle)` requires an explicit curator record
and exact source/version/content/URL correspondence. The SQLite adapter runs
manifest changes and document activation inside one transaction. Promotion can
supersede the previous active manifest; its facts and document evidence remain
retained. Ordinary `putManifest` cannot perform that status transition. An exact
promotion replay writes nothing; old superseded versions cannot be implicitly
reactivated. An unbound memory store refuses promotion because it has no atomic
corpus binding. Dynamic retrieval never invokes this curator command itself.
