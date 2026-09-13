# Evidenced temporal memory

`@tangleai/memory/temporal` is an explicit, opt-in API. The ordinary pipeline and
its selected memory policy do not enable it. Core owns the closed JSON contracts
at `@tangleai/core/schemas/temporal` and the matching `.schema.json` subpath;
memory owns evidence, preparation, retrieval and deterministic answers. Store
adapts the same transactional protocol to Jaren SQLite. Models owns provider
clients and structured generation. No runtime package imports benchmark data.

## Identities and the three time axes

A `SourceOccurrence` records scope, session/turn ordinals, role, exact text,
locator, observation stamp and `knownAt`. Its ID hashes scope, both ordinals and
the content hash; equal text in different occurrences keeps separate evidence.
The content hash is SHA-256 over the RFC 8785 canonical JSON string, not a hash
of raw UTF-8 text bytes. Locators and stamps are immutable record content. A
changed stamp under an existing occurrence ID is refused during persistence.
Empty observed turns are retained, but cannot support a nonempty citation.

| Axis | Field | Meaning |
|---|---|---|
| Observation | `source.observedAt` | When the source was observed; preserves raw stamp, precision, offset and normalization provenance |
| Knowledge | `source.knownAt` | When this occurrence was available to the host |
| Validity | `claim.time` | The event time or state bounds supported by cited text |

A session timestamp does not establish every event's validity. Neither the
legacy `MemoryUnit.at` nor `supersededAt` proves those bounds. Claims require a
qualified `{ subject, key }` series, a string value, time semantics, status,
derivation identity and exact source spans. Citation offsets are UTF-16,
half-open `[start, end)`, nonempty and cannot split a surrogate pair. Every
quote, scope, source ID and hash must resolve to the supplied immutable text.

`provided-history` permits all supplied knowledge. `strict-as-of` filters
`knownAt <= cutoff` before extraction and embedding. Each profile/cutoff gets
its own projection; a query with a different knowledge view refuses. The
question anchor is a separate explicit stamp used for relative calendar
resolution. There is no implicit `Date.now()` anchor or inferred benchmark QA
date. LoCoMo has session dates but no released question anchors.

## Time semantics

`temporalInstant` requires a valid RFC 3339 timestamp with explicit offset and
at most millisecond precision; invalid calendars, leap seconds and finer
fractions refuse. `temporalStamp` checks precision alignment and offset equality.

| `ClaimTime.kind` | Supported meaning |
|---|---|
| `point` | An event; precision is millisecond, second, minute or day. Coarser precision is an uncertainty bucket |
| `period` | An event occurred somewhere in exactly one aligned day, month or year |
| `state` | Continuous validity from an aligned bound, ending at an explicit exclusive bound, `open`, or `unknown` |
| `unknown` | Evidence does not establish event time or validity |

States use `[from, until)`; `open` is explicitly unbounded, while `unknown` is
uncertain. Exact membership inside a coarse event bucket or unknown-ended state
refuses; instants outside definite bounds can be excluded. An overlap query
accepts an uncertain event only when its whole bucket fits inside the query.
Partial overlap refuses. Incompatible overlapping states, exact coincident
events, and events wholly inside an incompatible state produce conflicts in
the same qualified series. Partial uncertainty overlap alone does not prove
two events coincided; it must not be interpreted as an exact contradiction.

`resolveTemporalWindow` supports `yesterday`, `previous-week`, `previous-month`
and `previous-year`; weeks start Monday. Fixed offsets use Jaren calendars.
Named zones require a host-supplied Jaren `ZoneProvider` and explicit ambiguity
policy; no timezone database is bundled. Seasons and ambiguous numeric date
conventions require a host definition and are unsupported by this resolver.
Relative extraction uses source observation anchors. A proposed `previous-week`
event cannot fit the single-unit period contract and refuses instead of inventing
a day; query windows can span a week.

## Prepare, query and answer

The runnable [public example](https://github.com/jklarenbeek/tangleai/blob/main/examples/temporal.ts)
creates cited host assertions, prepares real SQLite storage, answers a historical
address query and computes 11 weeks plus 4 days from January 19 to April 10, 2023.
It also demonstrates unknown/unanchored refusals and zero-write reopen replay.
From a checkout, run `npm run temporal:smoke`, or `bun examples/temporal.ts`.

The public sequence is:

1. Build validated occurrences with `createSourceOccurrence` and `temporalStamp`.
2. Supply host assertions via `createTemporalClaim` and `citeSource`, or inject
   the structured extractor into `prepareTemporal`. Model-derived claims cannot
   be imported as host assertions into another knowledge view.
3. Supply matching host embeddings, or an explicit embedding model and transport.
   Missing embeddings remain missing coverage. `embeddedBy` names model and dims.
4. Call `prepareTemporal(input, { store, ...providers })` with a stable key,
   expected head, identities, knowledge view and limits. Save its returned head.
5. Call `recallTemporal` or `answerTemporal` with scope, text, anchor or null,
   the same knowledge/embedder identities, query vector, qualified subject/series
   or null, operation, `candidatePool`, `k`, `minScore`, and expected head or null.

Retrieval ranks all comparable source occurrences by Jaren cosine similarity,
then takes the declared semantic pool before subject, series and time filters.
It does not silently expand the pool to find an answer. Every claim citation
must be in that pool; incompatible subjects, incomplete operands or evidence
exceeding final `k` refuse rather than hide evidence. Coverage reports source,
comparable, candidate, eligible and selected counts, truncation, completeness
and the actual refusal reason. A bounded miss is `incomplete-index`, not proof
that no evidence exists. Compatible duplicates retain all citations.

Operations are `at`, `as-of`, `overlaps`, `elapsed`, `order`, or ordinary `none`.
As-of first checks validity and conflicts; an expired latest assertion cannot
mask an older still-valid one. `elapsed` needs unique evidenced point operands:
hours use elapsed instants and require millisecond precision, days/weeks count
civil dates, and months/years use Jaren anchored calendar clamping with a civil
day remainder. Ordering requires millisecond precision; ties use stable claim
IDs. `renderTemporalAnswer` preserves the kernel's chronological order and
precision, and includes source-span citations. Model arithmetic is not an oracle.

All domain results are `{ status: 'success', value }`, a typed `refused` reason,
or an explicit `fallback`. `none` returns `ordinary-query`. Other reasons include
`unknown-validity`, `unanchored-relative`, `ambiguous-series`, `conflicting-claims`,
`future-source`, `identity-mismatch`, `stale-projection`, `incomplete-index`,
`no-match`, `invalid-time`, `provider-refusal`, `budget-exhausted` and
`storage-failure`. `recallTemporalWithFallback` returns the temporal result and,
on refusal/fallback, ordinary `recallByEmbedding` output separately. It retains
the original reason; ordinary retrieval is not counted as temporal success.

## Persistence and provider ownership

Use `createTemporalMemoryStore`, or `createTemporalDbStore(db)` from
`@tangleai/store`. Both share immutable projections, atomic activation and
version-plus-revision compare-and-swap heads, including ABA protection.
Projection identity covers source view, contracts, policy, model, prompts,
knowledge, embedder and versioned vectors. Identical completed preparation/apply
replay performs zero writes, activations, embeddings and model requests, including
after reopen. Changed inputs under the same key refuse. Concurrent owners cannot
spend the same reserved operation automatically.

Models and fetch are injected; there is no provider discovery or credential-file
read. `TemporalLimits` caps sources, claims, physical requests, request input,
output, concurrency (1–4), deadline (up to 120 seconds), and repairs (0–1).
`maxInputTokens` and attempt `inputTokens` currently reserve actual serialized
UTF-8 request **bytes as a conservative token ceiling**; they are not measured
tokenizer usage. Output usage is recorded when the provider returns it; absence
stays null. A reported output overrun refuses further progress. The host owns
provider pricing and any aggregate dollar limit beyond this per-operation API.

Every physical attempt is durably reserved before transport, uses one HTTP
attempt and refuses redirects; repairs and embedding calls count too. Responses
are persisted before activation. An uncertain external outcome never grants an
automatic retry. `recoverTemporalOperation` requires the host to establish that
the old owner stopped, then records uncertainty without buying another request.
Database transactions cannot make external provider effects exactly once.

`createTemporalSessionIndex` caches observation precision buckets once per
immutable projection using Jaren interval indexes. This is an observation-time
diagnostic, not a validity index. General retrieval still reads and validates a
projection and ranks its comparable sources in memory. SQLite's separately
qualified range/as-of seeks do not imply the full semantic query runs in SQL.

## What has been measured

The [strict instrument](https://github.com/jklarenbeek/tangleai/blob/main/docs/TEMPORAL_BENCHMARK.md)
executes 46 independent cases on memory and both SQLite runtimes. The
[matched LongMemEval report](https://github.com/jklarenbeek/tangleai/blob/main/docs/TEMPORAL_EVALUATION.md)
covers all 500 cleaned-S questions under both knowledge profiles. Full source
roundtrips retain every permitted occurrence, including empty turns, and replay
with no writes. Those source-only runs use empty claims and no embeddings;
scripted model tests and evidence oracles establish no live extraction/QA gain.
Live quality and deployment cost remain unmeasured; the shipped lane stays off.
