/** Environment receipt for real native queries. Timing is deliberately outside canonical conformance. */
import { writeFile } from 'node:fs/promises';
import { quantile } from '@jarenjs/core/stats';
import { openTangleDb, createTemporalDbStore, inspectTemporalSeek, selectTemporalDbAsOf } from '@tangleai/store';
import { createSourceOccurrence, createTemporalClaim, citeSource, createTemporalProjection, temporalStamp, temporalIso,
  type TemporalResult, type SourceOccurrence, type TemporalClaim } from '@tangleai/memory/temporal';
import { parseArgs } from './lib/args.ts';
const must = <T>(r: TemporalResult<T>): T => { if (r.status !== 'success') throw Error(`${r.reason}: ${r.detail}`); return r.value; };
const args = parseArgs(process.argv.slice(2), { flags: [], values: ['json'] });
if (args.rest.length) throw Error('unexpected argument');
const started = performance.now(), sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [];
const total = 10000, series = 100, repetitions = 25, scope = 'synthetic-native-v1';
for (let i = 0; i < total; i++) {
  const source = must(await createSourceOccurrence({ scope, sessionOrdinal: i, turnOrdinal: 0, role: 'host', text: `Series ${i % series} valid at ${i}.`,
    sourceLocator: `synthetic:${i}`, observedAt: must(temporalStamp(temporalIso(i))), knownAt: temporalIso(i) }));
  sources.push(source);
  claims.push(must(await createTemporalClaim({ scope, series: { subject: 'synthetic', key: String(i % series) }, value: String(i),
    time: { kind: 'state', from: temporalIso(i), until: { kind: 'at', at: temporalIso(i + series) }, precision: 'millisecond' },
    status: 'accepted', citations: [must(citeSource(source))], derivation: { method: 'host-asserted', identity: 'synthetic-native-v1' } }, [source])));
}
const bundle = must(await createTemporalProjection({ scope, sources, claims, sourceIdentity: 'synthetic-native-v1', viewIdentity: 'synthetic-native-v1',
  policyIdentity: 'synthetic-native-v1', modelIdentity: 'host-asserted', promptIdentity: 'none', embeddedBy: { model: 'none', dims: 1 },
  knowledge: { mode: 'provided-history' }, embeddings: [], complete: true }));
const corpusPreparationMs = performance.now() - started, openAt = performance.now(), db = await openTangleDb();
const openMs = performance.now() - openAt;
try {
  const activateAt = performance.now();
  const receipt = must(await createTemporalDbStore(db).apply(bundle, { key: 'prepare', expectedHead: null }));
  const activationMs = performance.now() - activateAt;
  const rows = [];
  for (const seek of [
    { kind: 'observed-range' as const, scope, from: 5000, until: 5100, limit: 101 },
    { kind: 'claim-asof' as const, scope, versionId: bundle.projection.versionId, subject: 'synthetic', series: '0', at: 9950, limit: 101 },
  ]) {
    const coldAt = performance.now(), cold = must(await inspectTemporalSeek(db, seek)), coldQueryMs = performance.now() - coldAt;
    const timings = [];
    for (let i = 0; i < repetitions; i++) { const at = performance.now(); must(await inspectTemporalSeek(db, seek)); timings.push(performance.now() - at); }
    const refinement = seek.kind === 'claim-asof' ? must(await selectTemporalDbAsOf(db, seek)) : null;
    rows.push({ shape: seek.kind, explain: cold.explain, stats: cold.stats, returnedCandidates: cold.rows.length,
      refined: refinement?.refined ?? 0, finalResults: refinement?.claims.length ?? cold.rows.length,
      uncertaintyCheck: refinement?.uncertaintyCheck ?? null,
      coldQueryMs, warm: { repetitions, p50Ms: quantile(timings, .5, { method: 'nearest-rank' }), p95Ms: quantile(timings, .95, { method: 'nearest-rank' }) } });
  }
  const report = { instrument: 'temporal-native-v1', runtime: process.versions.bun ? 'bun' : 'node', version: process.versions.bun ?? process.version,
    platform: `${process.platform}/${process.arch}`, corpus: { occurrences: total, claims: total, series, versionId: bundle.projection.versionId },
    setup: { corpusPreparationMs, openMs, activationMs, writes: receipt.writes }, rows,
    limits: 'Synthetic in-memory SQLite on this host; query timing includes explain and telemetry. Cold means first query on an already prepared store. No universal latency or model quality claim.' };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args.values.has('json')) await writeFile(args.values.get('json')!, output); else console.log(output);
} finally { await db.close(); }
