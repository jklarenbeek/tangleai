/** Keyless temporal memory through installed public owners, including actual SQLite reopen. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createSourceOccurrence, citeSource, createTemporalClaim, temporalStamp, temporalValue, prepareTemporal, answerTemporal, renderTemporalAnswer,
  resolveTemporalWindow, type SourceOccurrence, type TemporalClaim, type TemporalQuery, type ClaimTime } from '@tangleai/memory/temporal';
const scope = 'temporal-public-example', cutoff = '2024-04-11T00:00:00Z';
const authored: { text: string; at: string; series: string; value: string; time: ClaimTime }[] = [
  { text: 'Alex lives on Elm from January 1 until February 1, 2024.', at: '2024-01-01T00:00:00Z', series: 'address', value: 'Elm',
    time: { kind: 'state', from: '2024-01-01T00:00:00Z', until: { kind: 'at', at: '2024-02-01T00:00:00Z' }, precision: 'day' } },
  { text: 'Alex lives on Oak from February 1, 2024 onward.', at: '2024-02-01T00:00:00Z', series: 'address', value: 'Oak',
    time: { kind: 'state', from: '2024-02-01T00:00:00Z', until: { kind: 'open' }, precision: 'day' } },
  { text: 'Alex once lived near the river; the dates are unknown.', at: '2024-03-01T00:00:00Z', series: 'older-address', value: 'river', time: { kind: 'unknown' } },
  { text: 'Alex completed recovery on January 19, 2023.', at: '2023-01-19T00:00:00Z', series: 'recovery', value: 'recovered', time: { kind: 'point', at: '2023-01-19T00:00:00Z', precision: 'day' } },
  { text: 'Alex completed the tenth jog on April 10, 2023.', at: '2023-04-10T00:00:00Z', series: 'jog', value: 'tenth jog', time: { kind: 'point', at: '2023-04-10T00:00:00Z', precision: 'day' } },
];
export async function runTemporalExample(path: string): Promise<void> {
  const sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [];
  for (const [sessionOrdinal, row] of authored.entries()) {
    const source = temporalValue(await createSourceOccurrence({ scope, sessionOrdinal, turnOrdinal: 0, role: 'host', text: row.text,
      sourceLocator: `tangle-example:${sessionOrdinal}`, observedAt: temporalValue(temporalStamp(row.at)), knownAt: row.at }));
    sources.push(source);
    claims.push(temporalValue(await createTemporalClaim({ scope, series: { subject: 'alex', key: row.series }, value: row.value, time: row.time,
      status: row.time.kind === 'unknown' ? 'unknown' : 'accepted', citations: [temporalValue(citeSource(source))], derivation: { method: 'host-asserted', identity: 'example-v1' } }, [source])));
  }
  const embedder = createHashEmbedder({ dims: 512 }), embeddedBy = { model: embedder.model, dims: embedder.dims };
  const vectors = await embedder.embed(sources.map(s => s.text));
  let db = await openTangleDb({ path });
  try {
    let store = createTemporalDbStore(db);
    const input = { scope, key: 'prepare', sources, claims, knowledge: { mode: 'strict-as-of' as const, cutoff }, expectedHead: null,
      sourceIdentity: 'tangle-public-example-v1', policyIdentity: 'explicit-temporal-v1', embeddedBy, embeddings: sources.map((s, i) => ({ sourceId: s.id, vector: Array.from(vectors[i]) })),
      limits: { maxInputTokens: 10000, maxOutputTokens: 100, maxPhysicalRequests: 0, maxSources: 10, maxClaims: 10, concurrency: 1, deadlineMs: 1000, maxRepairs: 0 } };
    const receipt = temporalValue(await prepareTemporal(input, { store }));
    const query: TemporalQuery = { scope, text: 'Where did Alex live on January 15, 2024?', anchor: null, knowledge: input.knowledge,
      subject: 'alex', series: 'address', operation: { kind: 'as-of', at: '2024-01-15T00:00:00Z' }, embeddedBy,
      embedding: Array.from((await embedder.embed(['Alex address']))[0]), candidatePool: 100, k: 10, minScore: 0, expectedHead: receipt.head };
    const historical = temporalValue(await answerTemporal(store, query)); assert.equal(historical.recall.claims[0].value, 'Elm');
    const elapsedQuery: TemporalQuery = { ...query, text: 'Time from recovery to the tenth jog?', series: null,
      embedding: Array.from((await embedder.embed(['Alex recovery jog']))[0]),
      operation: { kind: 'elapsed', fromSeries: { subject: 'alex', key: 'recovery' }, toSeries: { subject: 'alex', key: 'jog' }, unit: 'week' } };
    const elapsed = temporalValue(await answerTemporal(store, elapsedQuery));
    assert.deepEqual(elapsed.value, { whole: 11, remainder: 4, unit: 'week', remainderUnit: 'day' });
    const unanchored = resolveTemporalWindow('yesterday'); assert.equal(unanchored.status !== 'success' && unanchored.reason, 'unanchored-relative');
    const unknown = await answerTemporal(store, { ...query, series: 'older-address' }); assert.equal(unknown.status !== 'success' && unknown.reason, 'unknown-validity');
    await db.close(); db = await openTangleDb({ path }); store = createTemporalDbStore(db);
    assert.deepEqual(temporalValue(await answerTemporal(store, query)), historical);
    assert.deepEqual(temporalValue(await answerTemporal(store, elapsedQuery)), elapsed);
    const replay = temporalValue(await prepareTemporal(input, { store })); assert.equal(replay.writes, 0); assert.equal(store.stats().writes, 0);
    console.log(JSON.stringify({ historical: renderTemporalAnswer(historical), elapsed: renderTemporalAnswer(elapsed),
      unanchored, unknown, reopenedEqual: true, replayWrites: replay.writes, liveRequests: 0 }, null, 2));
  } finally { await db.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const directory = process.argv[2] ? null : await mkdtemp(join(tmpdir(), 'tangle-temporal-'));
  try { await runTemporalExample(process.argv[2] ?? join(directory!, 'example.db')); }
  finally { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}
