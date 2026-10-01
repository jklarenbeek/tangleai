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
note builder has no tools. `forecastPromptRevisions(treatment?)` computes constant-text
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
candidate. The scripted evolving row measures editing and the outcome-gated lifecycle below.

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
Revision results remain immutable. Retrospective result links and the scoring receipt of an outcome/v1 resolution advance only through package commands; their immutable evidence and proposal identities do not change. Checked references cannot be inserted directly; publication verifies the outcome service’s current checked head and its retained activation event.


`createForecastHarnessAdapter` provides one outcome lineage for choice and numeric
questions. Its pure asynchronous interpreter hashes the supplied harness with
canonical SHA-256 and looks up an explicitly retained prediction. Missing digest
predictions score failure. Output carries the input-bound answer adapter; a new
question does not create a new artifact lineage. `SEED_HARNESS` is the fixed
baseline, with the same digest as the registered fixture.

`createForecastOutcomeHost` binds an opaque forecast store, an outcome store,
immutable scope key, subject, approval principal, clock and optional paired
prediction provider. It returns the outcome service and its evidence authority.
The resolver attests retained original facts for the exact decision and scope;
nonempty memory-id authorization is refused. `forecastQuestionCreateFromOutcome`
captures the verified checked head when admitting a question and replays its
original creation identity. The checkpoint host's optional `outcomeHost` binding
records finalized harness predictions in its final `decision-record` MAS stage.

`createForecastLifecycleHost` admits a separate typed resolution workflow through
the same MAS segment queue: resolution-record → predictions-score →
retrospective-run → harness-promote-or-retain. This separate admission reflects
that the outcome arrives after checkpoint execution. It starts no timer. The
retrospective client is constructed only inside a running MAS attempt. Its four
read tools expose the resolved question’s archived chain, notes and bounded
traces; they grant no web access or mutation capability. Exactly one verdict
covers each committed guidance item. The same guarded refiner checks every
procedural addition and the complete candidate against the captured checked
parent. Failed repairs retain their spend and no candidate.

`forecastResolutionBegin` retains an immutable evidence fact before the resolver
can attest it. `forecastPredictionsScore` calls the outcome service outside
forecast transactions, then attaches its score ids atomically. Stable request
keys recover a stop between those services with no duplicate outcomes. Decisions
finished after observation are counted as post-resolution skips. An explicit
`forecastResolutionCorrect` retains conflicting evidence and marks the question
disputed; it never changes the original scores. Rescoring and revoking previously
transferred guidance after a correction are not implemented.

Promotion consumes only other resolved questions in the same scope, with both
parent and candidate predictions, strictly earlier cutoffs and fresh held-out
content. The outcome service owns evaluation, approval and head CAS. All-validate
retains, all-reject records rejection, and a no-op creates no version. A tie,
regression, absent paired slot or stale parent cannot promote. Operational
refusals preserve the originating outcome issues, including retryability.

The keyless fixture resolves five questions and scores fifteen checkpoints:
one promotion, one retention, one rejection and two ineligible candidates. The
civic candidate improves held-out mean utility by two thirds; its successor
ties. The release-date candidate regresses by two thirds and that scope retains
an empty checked head. The next civic question starts from the checked harness.
These are conformance results from authored replies, not evidence of live model
quality. See the generated forecast benchmark for every count and candidate.

Run `npm run forecast:smoke -- --db /tmp/forecast-outcomes.db` twice. The second
run reports zero new forecast/outcome writes and zero model calls. The example
traps network access. Eight resolution publication/MAS boundaries reopen SQLite
with identical artifacts and no extra purchases; checkpoint and revision
recovery remain independently measured.

`@tangleai/forecast/contract` exports `forecastContractDocument`,
`createForecastContract` and `createForecastReadHandlers`. Thirteen read
operations cover question lists/detail, checkpoint lists/detail, notes,
evidence, trace metadata, revisions, harness versions/current head, resolutions,
retrospectives and due schedules. The same closed schemas validate local and
HTTP clients. There are no contract commands or subscriptions and no transport
idempotency ledger. The existing `createForecastHandlers` continues to serve
MAS task execution.

Bind an authenticated store, scope key, optional question-id allowlist and
`allowScope`; authority is checked before any storage read. An omitted question
allowlist grants the authenticated scope, while an empty list grants no
question records. Unknown ids return null. Existing foreign records return
`TFCT1003`, so these reads do not conceal whether a forbidden id exists.
Historical archived/rejected harnesses are readable only within the authorized
question view; this grants no permission to execute them. Checked references
and the seed are shared within their exact scope.

The current-head query also requires the scope's `ForecastOutcomeHost` bound to
the same forecast store. It reads `injectChecked` through that host, including
rollback effects; a retained checked-reference record alone is not an active
head. A missing outcome binding returns `TFCT1012`, and an empty service head
returns null. Resolution reads retain the original outcome and scores, list
correction evidence separately, and expose pending/complete scoring and disputed
question state.

Projections select named fields recursively and cap text and lists. They do
not return prediction raw text, stage-call payloads, trace messages or tool
results. Evidence excerpts expose truncation explicitly. Trace pagination uses
Unicode character offsets over step/tool metadata, with at most 4,096 excerpt
characters and 1,000 displayed steps. Stored byte and truncation counts stay
separate from projected omissions. These are display records, not executable
record exports; text in named evidence and note fields remains authored data.

`npm run emit:forecast-contract -- --check` verifies the generated bundle, and
`npm run forecast:contract:check` refuses breaking changes against its frozen
public baseline. Both are included in the repository gate.

Transport diagnostics retain Jaren's native codes: invalid input is `JC2050`,
local handler/output faults are `JC2070`, and HTTP handler/output faults are
`JC2008`/`JC2010`. Domain refusals remain `TFCT` values within successful
transport responses. The local client's idempotency capability is false; HTTP
advertises transport support independently of this read-only document. A host
can set `ledger: null` on `serveHttp`; no read operation sends or consumes an
idempotency key. Resolution histories scan past full pages to find their
original fact and signal when displayed corrections are truncated.

## Qualification and limits

The [complete controlled ablation](../../docs/FORECAST_BENCHMARK.md) measures
no-harness, static-harness, scaffold-no-harness and evolving-harness on the same
Tangle-authored fictional fixture. Scaffold uses the same checkpoint workflow,
evidence gate and six-section notes, with a prompt omitting harness discovery,
no harness tool and revisions disabled. The evolving row has utility 0.600
versus scaffold 0.533; its paired 95% interval is [-0.133, 0.267]. The registered
claim is **not demonstrated**. Costs are 89/72 scripted calls and 3240/2340
scripted tokens. Both retain pending checkpoints in their denominators.

Harness writeback is experimental and requires explicit host bindings and
`revise: true`; no background worker or default activation is installed.
Promotion is stricter than a retrospective verdict: an unchanged candidate
cannot strictly improve, and the outcome gate refuses ties, regressions and
unavailable pairs. Two full keyless replays preserve heads, generation tables
and retained artifact bytes. This establishes orchestration and accounting;
live forecasting quality is not measured.

`npm run benchmark:forecast -- --require complete` regenerates the report and
credential-free `not-run` live registration. `--check` verifies all artifacts.
`--live` reads the shared AI environment, states a skip without a configured
wire, or prints a dry plan with exact rows, caps and `planId`. It spends nothing.
A separate operator approval of that current plan is required before
`--live --authorize <planId>` sends requests. The live runner uses the public
MAS and outcome hosts over frozen cutoff evidence, records actual provider
usage, disables retries and bounds requests and output tokens. An exclusive
execution receipt prevents a repeated CLI invocation from purchasing again.
A stopped execution retains its database and incomplete receipt for review.

The live runner registers only predictions it actually executed. A newly
generated candidate has no retroactively purchased held-out prediction bag;
missing pairs remain ineligible and original decisions stay immutable.
Prospective real-domain evaluation, fresh candidate replay, the official
FutureX/FutureWorld protocols and disputed-outcome rescoring remain open.
