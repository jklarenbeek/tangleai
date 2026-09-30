# @tangleai/forecast

Closed forecasting records, content identities, pure lifecycle transitions and an
atomic store seam. Hosts supply timestamps and persistence. The memory reference
store and `@tangleai/store` SQLite adapter share the same validation and ownership
rules. The package root performs no filesystem, database or network access.

Ordinary puts are immutable: identical bytes write nothing and different bytes
under the same id are refused. Only lifecycle commands can replace status and
artifact links in one transaction. Question scopes and checkpoint input identities
cannot change. Provisional harnesses belong to one question; checked references
are visible only in their recorded scope. Checked promotion belongs to
`@tangleai/outcomes`, not this persistence layer.

`createForecastExecutor` runs a single checkpoint through the bounded agent loop.
`createForecastToolbox` exposes only `web_search`, `web_read`, `harness_read` and
`evidence_read`; no-harness treatments omit `harness_read`. Replay sources are
scoped, hash-checked snapshots. Their availability must precede the cutoff;
future and undated captures are refused and counted. Live sources use injected
search, fetch and extraction functions, preserving document refusal codes.
Raw capture hashes and byte counts remain distinct from bounded excerpts.

The [registered instrument](../../docs/FORECAST_BENCHMARK.md) measures the real
executor, tools, note builder and memory publication on authored scripted
responses. This is conformance evidence, not a forecasting quality claim.

`sealForecastRecord(table, input)` checks closed records and computes their
content addresses. Commands such as `forecastQuestionCreate`,
`forecastCheckpointPlan`, `forecastCheckpointStart` and
`forecastCheckpointFinalize` return `{ ok, value, writes }` or coded issues.
Finalization retains prediction, trace, evidence, note and checkpoint status
atomically; a failed write publishes none of them. Duplicate finalized inputs
write zero rows. Unknown token usage remains `null` with `usageKnown: false`.
Only a provider-confirmed `stop` permits parsing the final boxed answer. Length,
tool-limit and budget stops retain failed traces without a prediction. Trace
storage bounds native tool results as well as rendered messages and counts
truncation. A failed note leaves the prediction finalized with `noteId: null`
and a separate `noteFailure`; execution failure and note failure are distinct.

`createNoteBuilder` accepts one completed artifact and requests exactly six
sections, with at most one repair. Pass the executor's `budgetSpent` into the
note budget's `spent` field so repairs consume the remaining checkpoint
allowance. Both roles retain actual request digests through the injected
client's `requestKey(request)` method, reported usage or null, and replay
markers. Each artifact identifies its own producer prompt and toolset; the
note builder has no tools. `forecastPromptRevisions()` computes constant-text
revisions lazily without filesystem access.

`createForecastHost` validates and lowers one MAS workflow, then exposes a
manual `tick(now)`, duplicate-aware `deliver(questionId, ordinal)` and queue
`resume()` reconciliation. Inject the forecast store, MAS store, model factories,
configuration/budget policy, clocks and segment adapter. The package opens no
database and starts no timer. The host uses the existing MAS queue and worker;
it selects the latest visible provisional, checked or seed harness as of the
scheduled instant. Static treatment always uses the seed.

Execution and note commands atomically retain stage artifacts and cumulative
budget receipts before the MAS attempt completes. Retrying after that commit
reuses the artifacts without calling a model. Unknown purchased usage stays
unknown while its budget estimate survives reopening. A crash before a stage
commits is outside this replay guarantee. MAS traces contain artifact references;
raw forecast transcripts stay in bounded forecast traces. Checkpoint one skips
revision. Later checkpoints use the injected `feedbackEditor` binding when a
successful note is retained; a host without that binding records a counted skip.

`createInternalFeedbackEditor` compares only an unresolved question's accumulated
notes, earlier revisions and immutable input harness. Its four read tools are
`harness_read`, `notes_read`, `revisions_read` and bounded `trace_read`. It cannot
read resolutions or another question's records. Structured decoding permits one
repair. The synchronous volatile-fact gate refuses dates, named entities, exact
outcomes, numbers with units, identifiers and copied evidence in reusable
guidance. Refused proposals remain counted in the question-local audit. An
optional `createVolatileFactClassifier` completes a recorded `revision.gate`
stage before final guarded validation; validators never call a model.

`createHarnessRefiner` projects a harness into exactly three schema-validated
ledger skills and uses the suite's guarded engine. The package constructs the
patch from cited guidance, checks every changed byte, and bounds component size,
growth and churn. It cannot rename a component or grant tools. Duplicate
procedure is deferred and calls no harness publisher. `forecastRevisionCommit`
atomically retains the revision, staged-to-provisional candidate, question head
and cumulative checkpoint spend. Retrying the same publication writes zero rows.
A no-op may retain the revision and spend receipt while creating no harness.
Only the same question's next scheduled checkpoint can select a provisional
candidate. The scripted evolving row measures this editing path; outcome-gated
evaluation and checked promotion are not yet part of that measurement.

Run `npm run forecast:tick -- --db /tmp/forecast.db --now
2025-01-25T00:00:00.000Z --fixture` for three scripted checkpoints. A second
tick starts no runs and spends nothing. Fixture mode requires an explicit clock.
For application execution, supply `--host path/to/bindings.ts`; its async
`forecastBindings({ db, now })` returns `profile`, `policy`, `executor` and
`noteBuilder` bindings, plus `feedbackEditor` when revisions are enabled.
Provider access requires those explicit host bindings.
Without `--now`, the application host records its wall-clock admission instant.

`forecastGet`, `forecastQuery` and `forecastTransaction` consume an opaque store
handle. The public transaction has immutable `put` and read methods; it cannot
replace lifecycle fields. Queries sort by id, accept an exclusive `after`
cursor and default to 1,000 rows (maximum 10,000). `dueCheckpoints` is a pure
result-valued query over supplied schedules and an explicit instant. No timer
or worker starts on import.

Trusted persistence adapters store an indexed ownership envelope beside the
payload. The package derives question and scope metadata through retained
references. An adapter must roll back all writes if its transaction callback
throws, including a refusal caught inside a caller callback. Memory and Node/Bun
SQLite run the same seventeen storage probes, including write faults, concurrent
ordinal claims, additive upgrades and zero-write replay after reopening.

Revision and retrospective ids bind their immutable inputs and omit forward
result references to candidates, which themselves cite the originating record.
Those result records remain immutable: publishing different result bytes under
the same id is refused. Checked references cannot be inserted directly; an
outcome activation event belongs to the promotion policy, never a raw store put.
