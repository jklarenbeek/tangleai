/** Render the small website summary from committed measurements, never copied numbers. */
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jaren from '@jarenjs/db/package.json' with { type: 'json' };
const read = async (name: string) => JSON.parse(await readFile(`benchmark/results/${name}.json`, 'utf8'));
const node = await read('jaren-strategies-node');
const bun = await read('jaren-strategies-bun');
const mas = await read('mas-conformance');
const config = await read('config-conformance');
assert.equal(node.jaren, jaren.version);
assert.equal(bun.jaren, jaren.version);
const summary = {
  jaren: jaren.version, measuredAt: node.generatedAt.slice(0, 10),
  history: [node, bun].map((row) => ({
    runtime: row.runtime, version: row.runtimeVersion, rows: row.corpus.rows, limit: row.corpus.requested,
    previousP95Ms: row.previous.p95Ms, boundedP95Ms: row.bounded.p95Ms, p95Speedup: row.p95Speedup,
  })),
  mas: mas.counts, config: config.counts,
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
for their own definitions and denominators. Historical paid runs are preserved;
this upgrade did not buy fresh model answers.

The [integration audit](JARENJS_INTEGRATION.md) explains why the upstream
labelled retrieval measurements keep exact search and recursive chunking as
the defaults, and which published facilities apply to this host.
`);
