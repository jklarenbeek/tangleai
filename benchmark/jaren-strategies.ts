/** Keyless host strategy comparison; measures the shipped run log on real SQLite. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { JarenValidator } from '@jarenjs/validate';
import { quantile } from '@jarenjs/core/stats';
import jaren from '@jarenjs/db/package.json' with { type: 'json' };
import { asRows, createRunLog, openTangleDb, type RunRecord } from '@tangleai/store';

const db = await openTangleDb();
const total = 5000;
const limit = 50;
const repetitions = 25;
const measured = { type: 'object', required: ['p50Ms', 'p95Ms', 'hostRowsPerRead'], additionalProperties: false,
  properties: { p50Ms: { type: 'number', minimum: 0 }, p95Ms: { type: 'number', minimum: 0 }, hostRowsPerRead: { type: 'integer', minimum: 1 } } };
const validate = new JarenValidator({ collectErrors: true }).compile({
  type: 'object', required: ['instrument', 'jaren', 'generatedAt', 'runtime', 'runtimeVersion', 'platform', 'corpus', 'equivalence', 'streaming', 'previous', 'bounded', 'p95Speedup', 'limits'],
  additionalProperties: false, properties: {
    instrument: { const: 'tangle-jaren-strategies/1' }, jaren: { const: jaren.version },
    generatedAt: { type: 'string' }, runtime: { enum: ['node', 'bun'] }, runtimeVersion: { type: 'string' }, platform: { type: 'string' },
    corpus: { const: { rows: total, requested: limit, repetitions } }, equivalence: { const: true }, streaming: { const: 'row' },
    previous: measured, bounded: measured, p95Speedup: { type: 'number', exclusiveMinimum: 0 }, limits: { type: 'string', minLength: 1 },
  },
});
try {
  await db.transaction(async (tx) => {
    const runs = tx.collection<RunRecord>('runs');
    for (let i = 0; i < total; i++) await runs.put({
      id: `run-${String(i).padStart(6, '0')}`, kind: 'benchmark',
      startedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      finishedAt: null, status: 'running', summary: { detail: 'synthetic history '.repeat(32) },
    });
  });
  const runs = db.collection<RunRecord>('runs');
  const log = createRunLog(db);
  const oldRead = async () => {
    const rows = asRows(await runs.execute<RunRecord>({ $for: { r: '$[*]' }, $return: '$r' }));
    rows.sort((a, b) => a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0);
    return rows.slice(0, limit).map((row) => row.id);
  };
  const boundedRead = async () => (await log.listRuns(limit)).map((row) => row.id);
  const expected = await oldRead();
  assert.deepEqual(await boundedRead(), expected);
  const cursor = runs.query({ $for: { r: '$[*]' }, $orderby: { $key: '$r.startedAt', $dir: 'desc' }, $return: '$r' });
  assert.equal(cursor.streaming, 'row');
  await cursor.return();
  const measure = async (read: () => Promise<string[]>) => {
    const times: number[] = [];
    for (let i = 0; i < repetitions; i++) {
      const start = performance.now();
      const ids = await read();
      times.push(performance.now() - start);
      assert.deepEqual(ids, expected);
    }
    return { p50Ms: quantile(times, 0.5, { method: 'nearest-rank' })!, p95Ms: quantile(times, 0.95, { method: 'nearest-rank' })! };
  };
  const previous = await measure(oldRead);
  const bounded = await measure(boundedRead);
  const runtime = process.versions.bun ? 'bun' : 'node';
  const report = {
    instrument: 'tangle-jaren-strategies/1', jaren: jaren.version,
    generatedAt: new Date().toISOString(), runtime, runtimeVersion: process.versions.bun ?? process.versions.node,
    platform: `${process.platform}/${process.arch}`, corpus: { rows: total, requested: limit, repetitions },
    equivalence: true, streaming: cursor.streaming,
    previous: { ...previous, hostRowsPerRead: total }, bounded: { ...bounded, hostRowsPerRead: limit },
    p95Speedup: previous.p95Ms / bounded.p95Ms,
    limits: 'Synthetic warm in-memory SQLite history, unique timestamps, fixed order of strategies. Host row counts exclude SQLite scanning and sorting. No claim about production disk latency, vector recall or model quality.',
  };
  const checked = validate(report);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  await writeFile(`benchmark/results/jaren-strategies-${runtime}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await db.close(); }
