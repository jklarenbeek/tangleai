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

## Bounded web evidence

`createWebLane({ profile, client, modelIdentity, transport, store, budgets,
clock, now, ranker? })` executes an applied plan's web query with
`lane.retrieve(session, queryId)`. The native agent exposes only `web_search`
and `web_fetch`; one structured-output sufficiency call permits one repair.
Reflection changes query text, never authority policy or budget ceilings.
Every search response, page and redirect goes through `SafeStaticFetcher`.
The default browser-safe extractor handles HTML, Markdown and plain text.
Node/Bun hosts can provide `extractor: { id, extract: extractDocument }` from
`@tangleai/documents/extract` for PDF support; its declared identity is pinned
and recorded. The static default reports PDF as `unsupported-mime`.
Its per-hop admission runs after public-address validation and before robots.
Search API requests explicitly omit robots; page robots requests are themselves
admitted. DNS lookups are injected in browser hosts and replay.

`createReplayWebTransport(records, { searxBase })` verifies exact capture keys,
SHA-256 bytes and permitted response headers before use. It returns fresh
Responses without network or DNS fallback. The key format is exported by
`@tangleai/core/http-capture`; query parameter order is significant. The
transport's revision identifies the captured response set. A live host supplies
its own fetch, public-address lookup, search base and configuration revision.
Importing the package never selects a provider or performs network work.

The lane pins profile, model, prompt catalog, transport, plan and ranker
identities. Limits may only narrow the profile. Calls, tokens, active time,
searches, page fetch attempts and delivered bytes accumulate across every web
query of the same plan, including a reopened store. Every query of that plan keeps the same pinned
web configuration; a later query cannot widen an earlier limit. The native shared model
account includes sufficiency repairs and optional model reranking. Calls that
fail still count. A tool budget refusal stops before another model dispatch.
Token usage can exceed the remaining allowance on its final response; a
stream can similarly deliver a chunk larger than the remaining byte allowance.
The full delivered usage is retained, the stream is cancelled, and no further
request is dispatched. Search and robots bytes count toward the same allowance.

Each fetched page retains an exact-byte digest, original/final URL, redirects,
fetch time, extracted text and profile-derived authority. Snippets are counted
only as discovery hints. Title-only and empty pages produce no evidence.
Publication/effective/expiry/review dates come only from valid, unambiguous
structured HTML metadata. `Last-Modified` and ETag remain under `transport`;
fetch time never becomes publication time. HTML canonical links cannot rewrite
citation destinations. Freshness eligibility is a separate reconciliation step.

The default `web-rank/1` combines search order with lexical scores over the
fetched title and text through core's lexical index and reciprocal-rank fusion.
A `CandidateRanker<WebRankCandidate>` may reorder immutable evidence while
preserving its facts and raw scores. `createModelWebRanker({ client,
modelIdentity })` is optional and binds to the lane's shared account. Failure
or exhausted budget retains the deterministic ranking under its actual identity
and records a named stop; no model-ranking success is implied.

`putWebResult` atomically commits the complete run and its evidence through the
existing grounding store. Runs retain individual HTTP outcomes, denied hops,
failed operations, snippets, spend and stop reason. A completed run replay
returns identical retained records with zero fetches or model calls. Calls on
one lane instance serialize. Cross-process dispatch belongs to the host worker;
an interrupted uncommitted external read is not promised exactly-once delivery.
No web read promotes content into the persistent corpus or generates an answer.

### Reconciliation and claim ledgers

`reconcileEvidence(profile, candidates, context)` is a deterministic projection.
The host supplies the observation time, retained version status and jurisdiction,
and may register atomic predicate topics. Without topics, each atomic query is
the conservative comparison scope. Expired, future-effective, inactive and
jurisdiction-mismatched evidence is excluded. `authority.excludedTiers` can exclude
web tiers. Official authority wins over unofficial recency; two official sources
are ordered only when both have proven effective dates. Fetch timestamps and
Last-Modified never establish an effective date. Every comparison names its rule,
selected/excluded evidence and scope; ambiguous official comparisons remain
unresolved. A critical query treats its unresolved comparisons conservatively.

`generateGroundedClaims` consumes a retained session plan, its admitted evidence,
conflicts, corpus and grounding store. It uses installed reconcile/generate/repair
packs and the existing structured-output helper. A bounded interpretation can
only caveat or refuse unresolved comparisons. It cannot change eligibility,
authority, dates or source preference. Final conflicts are persisted before the
answer. The answer and optional expected session revision commit atomically.

The generated draft contains claims, evidence ids and caveats. There is no
confidence field or independent free-prose answer. `renderPrihaAnswer` derives
visible text from surviving claims. Refusals carry a reason; emergency rendering
may append the profile's optional `emergency.response.text`. Source keys are not
rendered as guidance. Every visible citation is used by a surviving claim; unused
retrieval stays in `GroundingTrace.unused`.

`createCitationResolver` resolves web ids to exact final URLs/page hashes and local
ids through the retained active corpus to chunk/version/content hashes.
`validatePrihaClaims` projects into the context package's one native claim
validator. This proves descriptors, references, visibility and critical-reference
requirements; it does not prove arbitrary prose entailment. Independent answer
quality evaluation is still required. Repair uses the context package's guarded
refiner and Jaren's compiled RFC 6902 applier. Only claim removal, citation removal
and caveat append are accepted. Claim text, ids, criticality, added citations and
policy edits are forbidden. The optional profile `budgets.repairs` defaults to one
and cannot exceed one. Invalid ledgers fail closed with `TGRD1008`.

Calls, tokens and elapsed time share a native budget account across interpretation,
generation and repair. Narrower caller caps are allowed. Reported final token or
time overshoot is charged and refuses the answer. A surrounding MAS host may wrap
the client in its workflow account to cover earlier planning and retrieval too.
