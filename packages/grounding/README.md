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

`createQueryOptimizer({ profile, store, clients, clock, factVocabulary,
clarification })` turns a user turn into a retained intent and atomic query plan.
Call `triage(session, text)` first. Deterministic emergency and out-of-scope rules
refuse with rule ids before any model call. Otherwise, `ready` can go directly to
`plan(session)`; `needs-clarification` goes to `clarify(session)`. A clarification
result contains one question, `interactionId`, `interactionRevision`, and the
current session. Send a host answer through `resume(session, { interactionId,
expectedRevision: interactionRevision, responseKey, value: { answers: { q1 } } })`.
The host supplies `clients.triage` and `clients.plan` as `{ client, identity }`
pairs, with effective CONFIG identities for resolved models; scripted fixtures
use null identities. Every result is an explicit `OptimizerOutcome` value.

Clarification uses the existing GMPL pattern and native MAS interactions. The
SQLite host is `createGroundingClarificationHost(db, { now, deadlineFor })` from
`@tangleai/store`, with jobs enabled on `openTangleDb`. Hosts can instead implement
the exported `GroundingClarificationHost` over their existing MAS worker. The
workflow fixes its input to this session and refresh revision. A repeated call
while waiting reads the same interaction without repeating a model request.
Responses must use its expected revision; repeated, stale or conflicting replies
surface `TGRD1003` with the MAS cause. Accepted responses and the MAS resume
outbox survive reopen, including a crash before the grounding turn update.

`ClarifiedIntent.answered` contains only verbatim accepted host answers to curated
profile questions. Unknown or unresolved fields remain outstanding; exhaustion
refuses with `insufficient_detail`. The resolved summary is a model proposal and
cannot write structured user facts. Query expansion is deterministic profile
policy; normalized duplicate text merges lane flags and rule provenance. New
plans pin profile, prompt and model identities. No optimizer step retrieves
sources or generates a grounded answer.

The mandatory `factVocabulary` is registered host data, copied when the optimizer
is created so caller mutation cannot change its pinned policy. The gate rejects an
unsupplied matching phrase after Unicode normalization. It covers this closed
vocabulary only, not arbitrary invented facts or medical inference. Prompt packs
are compiled into `./artifacts/catalog`; installed consumers do not read prompt
source files. `grounding:artifacts -- --check` detects artifact drift.

One shared account charges triage, clarification completion/normalization and
plan requests, including the single structured-output repair allowance. Narrower
call, token or active-time caps are optional; widening is refused. Named
`budget-turns`, `budget-tokens` and `budget-ms` stops retain incurred spend.
Inactive human waiting is excluded; clients and hosts remain responsible for
cooperative request cancellation. Durable checkpoints pin artifacts, vocabulary,
models and limits. A model operation with an unknown outcome is not retried
automatically. Explicit refresh starts a new clarification run while preserving
retained evidence and earlier answers.
