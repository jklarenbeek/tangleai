/** Render the small website summary from committed measurements, never copied numbers. */
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jaren from '@jarenjs/db/package.json' with { type: 'json' };
import { summarizePaidRefresh } from './lib/paid-refresh.ts';
import { summarizeHorizonFix, renderHorizonFix } from './lib/horizon-summary.ts';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGroundingValidator } from './lib/grounding.ts';
import { createReportValidator } from './lib/validate.ts';
import RECALL_SCHEMA from './schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from './schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from './schemas/locomo-qa-live.schema.json' with { type: 'json' };
import IDENTITY_SCHEMA from '../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
const read = async (name: string) => JSON.parse(await readFile(`benchmark/results/${name}.json`, 'utf8'));
const node = await read('jaren-strategies-node');
const bun = await read('jaren-strategies-bun');
const mas = await read('mas-conformance');
const config = await read('config-conformance');
const qa = await read('locomo-qa-live-jaren-0832');
const grounding = await read('grounding-live-jaren-0832');
const qaValidation = createReportValidator(LIVE_SCHEMA, [RECALL_SCHEMA, QA_SCHEMA, IDENTITY_SCHEMA])(qa);
const groundingValidation = createGroundingValidator()(grounding);
assert.ok(qaValidation.valid, JSON.stringify(qaValidation.errors));
assert.ok(groundingValidation.valid, JSON.stringify(groundingValidation.errors));
assert.equal(qa.generated.provider, grounding.generated.provider);
assert.equal(qa.generated.model, grounding.generated.model);
assert.deepEqual(qa.generated.embedder, grounding.generated.embedder);
const paid = summarizePaidRefresh(qa, grounding);
const smoke = await read('documents-live-jaren-0832');
const masSmoke = await read('mas-live-jaren-0832');
const telemetry = await read('locomo-telemetry-replay-jaren-0832');
const repaired = await read('locomo-qa-live-horizon-fixed');
const repairedValidation = createReportValidator(LIVE_SCHEMA, [RECALL_SCHEMA, QA_SCHEMA, IDENTITY_SCHEMA])(repaired);
assert.ok(repairedValidation.valid, JSON.stringify(repairedValidation.errors));
const audit = await read('horizon-answer-audit');
assert.equal(audit.sourceSha256, await canonicalSha256(qa));
const bounded = summarizeHorizonFix(qa, repaired, audit);
await writeFile('docs/BOUNDED_AGENT_BENCHMARK.md', renderHorizonFix(bounded));
assert.equal(node.jaren, jaren.version);
assert.equal(bun.jaren, jaren.version);
const summary = {
  jaren: jaren.version, measuredAt: node.generatedAt.slice(0, 10),
  history: [node, bun].map((row) => ({
    runtime: row.runtime, version: row.runtimeVersion, rows: row.corpus.rows, limit: row.corpus.requested,
    previousP95Ms: row.previous.p95Ms, boundedP95Ms: row.bounded.p95Ms, p95Speedup: row.p95Speedup,
  })),
  mas: mas.counts, config: config.counts, paid, bounded, smoke, masSmoke,
};
await writeFile('benchmark/results/jaren-integration.json', JSON.stringify(summary, null, 2) + '\n');
const table = summary.history.map((row) => `| ${row.runtime} ${row.version} | ${row.previousP95Ms.toFixed(3)} | ${row.boundedP95Ms.toFixed(3)} | ${row.p95Speedup.toFixed(2)}× | ${row.rows} → ${row.limit} |`).join('\n');
await writeFile('docs/JARENJS_BENCHMARK.md', `# JarenJS host strategy benchmark

Measured ${summary.measuredAt} on ${node.platform}, JarenJS ${jaren.version}.
Reproduce with \`npm run benchmark:jaren\`. Instrument:
[benchmark/jaren-strategies.ts](../benchmark/jaren-strategies.ts).
Raw reports: [Node](../benchmark/results/jaren-strategies-node.json),
[Bun](../benchmark/results/jaren-strategies-bun.json).

Both strategies use the suite database and real in-memory SQLite: the previous
path loads all 5,000 synthetic run records, sorts them in JavaScript and keeps
50; the shipped path consumes an ordered database cursor and closes it after
50. IDs must match on every one of 25 timed repetitions, after one warm-up.
The cursor reports row streaming. Payloads and unique timestamps are fixed.

| Runtime | Previous p95 ms | Bounded p95 ms | p95 speedup | Host rows per read |
|---|---:|---:|---:|---:|
${table}

The main gain is bounded host materialization. SQLite may still scan and sort
all rows: these are not visited-row counts or an index claim. Strategy order
is fixed; timings are a dated diagnostic, not a CI threshold. Bun's result is
published alongside Node's, including any regression or near parity. This comparison
measures neither persistent-disk throughput nor vector or model quality.

The refreshed keyless MAS report records ${mas.counts.integrated.runtimePass}/11 runtime
oracles, ${mas.counts.integrated.refusedAsRegistered}/7 registered refusals,
${mas.counts.probes.passed}/${mas.counts.probes.total} suite probes and
${mas.counts.durability.passed}/${mas.counts.durability.total} durability checks.
CONFIG records ${config.counts.byStatus.holds}/${config.counts.cases} holding cases.
See [MAS](MAS_RUNTIME_BENCHMARK.md), [grounding](GROUNDING_BENCHMARK.md),
[document chunking](DOCUMENT_BENCHMARK.md) and [LoCoMo](LOCOMO_BENCHMARK.md)
for their own definitions and denominators. The separately dated
[paid refresh](PAID_REFRESH.md) exercises the configured OpenRouter models;
historical paid runs retain their original identities and results.

The [integration audit](JARENJS_INTEGRATION.md) explains why the upstream
labelled retrieval measurements keep exact search and recursive chunking as
the defaults, and which published facilities apply to this host.
`);

const f1 = (value: number | null) => value === null ? '—' : value.toFixed(3);
const paidQaTable = paid.qa.rows.map((row) => `| ${row.key} | ${row.answered - row.invalid}/${row.planned} | ${f1(row.f1)} | ${f1(row.ceiling)} | ${row.invalid} | ${row.unanswered.wire}/${row.unanswered.budget} | ${row.adversarial.judged}/${row.adversarial.planned} |`).join('\n');
const paidGroundingTable = paid.grounding.strata.flatMap((stratum) => stratum.rows.map((row) => `| ${stratum.key} / ${row.key} | ${row.answered}/${row.planned} | ${f1(row.answerF1)} | ${f1(row.claimMicroF1)} | ${row.invalid} | ${row.unanswered.wire}/${row.unanswered.budget} |`)).join('\n');
await writeFile('docs/PAID_REFRESH.md', `# Paid integration verification

JarenJS ${jaren.version}; answers by OpenRouter \`${paid.model}\`, adversarial
judgments by \`${paid.judge}\`, embeddings by
\`${paid.embedder.model}\`/${paid.embedder.dims}. Thinking stays at the model's
default. Each benchmark run checks its own configured 200-request ceiling
before purchasing calls, with at most four concurrent calls per run.

These are fresh dated attempts; the August/September baseline reports remain
unchanged. This is a current-stack verification, not a controlled attribution
of model-quality changes to the dependency upgrade. Reused embeddings and
completion replays are recorded separately in each raw run.

## Answer comparisons

This table retains the original integration attempt. The later
[bounded-agent repair](BOUNDED_AGENT_BENCHMARK.md) reports the fresh twelve-question
run separately, including its costs and remaining answer-quality failures. The
original agent's one completed answer was empty, so it yielded zero nonempty cited
answers despite the historical valid-reply label below.

Original run: ${paid.qa.at}. ${paid.qa.runs} runs,
${paid.qa.calls} charged logical requests, ${paid.qa.tokens} provider-reported tokens,
${paid.qa.wireErrors} wire errors. The five direct-answer rows use the same
seeded 64-question sample plus six separately judged adversarial questions;
the bounded long-horizon agent uses its registered 12-question subset.

| Strategy | Valid / planned | Answer F1 | Evidence recall ceiling | Invalid | Wire/budget unanswered | Adversarial judged |
|---|---:|---:|---:|---:|---:|---:|
${paidQaTable}

Invalid replies remain zero scores in the F1 denominator; wire failures remain
unanswered. The valid-reply count does not rescore the attempt.
Retrieval rows use k=10. The ceiling is measured over the evidence each row actually sees, including
sub-calls for the agent. Unequal sets must not be ranked as equal coverage.
The [complete rendering](LOCOMO_REFRESH.md) includes per-category results,
common-question comparisons, citation resolution, latency, token costs and
agent stops. [Raw report](../benchmark/results/locomo-qa-live-jaren-0832.json).
The answer instrument charges logical client calls; provider-internal retry
attempts are not a separate HTTP request census. Its ceiling applies to those
logical calls, not dollar spend.

The agent's failed reductions expose a telemetry omission upstream: completed
map steps survive a failure, while aggregate sub-call counts disappear.
[The replay instrument](../benchmark/locomo-telemetry.ts) replayed
${telemetry.completionReplays} saved completions with ${telemetry.modelNetworkRequests}
network requests and ${telemetry.cacheMisses} local cache miss(es), preserving
the original failed-wire outcomes. It recovered ${telemetry.countsAfter.made}
sub-calls (previous aggregate ${telemetry.countsBefore.made}) and their failure
reasons. Scores, coverage, usage and program outcomes were asserted unchanged;
original purchase times and costs are retained. The
[receipt](../benchmark/results/locomo-telemetry-replay-jaren-0832.json) contains
the before/after hashes and every changed field, so the original report is
exactly recoverable. Run it against a copy of the report and its saved cache:

\`\`\`sh
node --env-file=.env benchmark/locomo-telemetry.ts --live-json /tmp/locomo-refresh.json --cache /tmp/locomo-refresh.sqlite --receipt /tmp/telemetry-replay.json
\`\`\`

## Grounding

Run: ${paid.grounding.at}. ${paid.grounding.calls} purchased requests,
${paid.grounding.tokens} provider-reported tokens, ${paid.grounding.wireErrors}
wire errors. The registered decision is \`${paid.grounding.decision}\`.

| Stratum / treatment | Answered | Answer F1 | Supported-claim micro F1 | Invalid | Wire/budget unanswered |
|---|---:|---:|---:|---:|---:|
${paidGroundingTable}

Claim scores apply to the authored fixture's known predicates; they do not
measure semantic grounding for arbitrary documents. The no-generation
retrieval row remains in the [complete rendering](GROUNDING_REFRESH.md),
beside citation outcomes, paired intervals and adoption clauses. The registered
baseline scores raw structured answers; the desktop additionally applies
the suite's supplied-reference/unique-claim gate and one bounded repair.
[Raw report](../benchmark/results/grounding-live-jaren-0832.json).

## Desktop smoke

${smoke.measuredAt}: the actual desktop dispatcher ingested
[RFC 9110](${smoke.source}), extracted ${smoke.elements} elements into
${smoke.chunks} chunks, made ${smoke.embeddingCalls} ingest embedding requests
and returned an answer with ${smoke.citations} document citation(s), using
\`${smoke.chatProvider}\` and \`${smoke.embedder}\`. This proves the live path;
the benchmark above supplies the quality measurements.
[Raw smoke result](../benchmark/results/documents-live-jaren-0832.json).

## Durable agent smoke

${masSmoke.measuredAt}: a real \`${masSmoke.provider}/${masSmoke.model}\`
completion passed through the public MAS agent, SQLite job worker, typed review
pause, outbox reconciliation and resumed task. All three invocations completed
across ${masSmoke.completedSegments} segments using ${masSmoke.calls} model call(s)
and ${masSmoke.spent.tokens} reported tokens. Trace and Mermaid topology checks
passed. The review response is supplied by this test; no person was contacted.
This uses the smoke's controlled clock and is not a latency measurement.
[Raw result](../benchmark/results/mas-live-jaren-0832.json).

## Reproduction

Initialize the dataset with \`git submodule update --init benchmark/locomo\`.
Use a new output filename and empty cache directory to retain these attempts
and buy fresh answers. Run the four answer invocations sequentially, changing
\`--rows\` through \`near-raw,near\`, \`long-context,rag-summary\`,
\`rag-observation\`, and \`long-horizon\`:
For the original long-horizon request policy, also pass \`--horizon-strategy legacy\`;
the default now runs the repaired coverage and synthesis policy.

\`\`\`sh
node --env-file=.env benchmark/locomo-qa.ts --live --thinking default --rows near-raw,near --live-json /tmp/locomo-refresh.json --cache /tmp/locomo-refresh.sqlite --md /tmp/locomo-refresh.md
node --env-file=.env benchmark/grounding.ts --live --thinking default --cache /tmp/grounding-refresh.sqlite --md /tmp/grounding-plan.md
# Review the printed plan, then execute its exact id:
node --env-file=.env benchmark/grounding.ts --live --thinking default --cache /tmp/grounding-refresh.sqlite --authorize PLAN_ID --live-json /tmp/grounding-refresh.json --md /tmp/grounding-refresh.md
bun scripts/live-openrouter-smoke.ts
node --env-file=.env scripts/mas-consumer-smoke.ts --live
\`\`\`

To regenerate the published documents from the committed reports without model
calls, omit \`--live\` and point \`--live-json\`/\`--md\` at the corresponding
refresh files, then run \`node benchmark/jaren-summary.ts\`. The normal
\`npm run check\` validates the dated artifacts without spending credits.
`);
