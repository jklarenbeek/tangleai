/** Public API bindings for independent cases. No expected-value access or model-quality claims. */
import { createTemporalMemoryStore, createTemporalMemoryPersistence, createTemporalStoreAdapter, answerTemporal, temporalInstant, temporalStamp, resolveTemporalWindow,
  type TemporalResult, type Json, type TemporalStore, type TemporalQuery } from '@tangleai/memory/temporal';
import type { StrictTemporalOutcome } from '../../test/fixtures/temporal.ts';
import type { TemporalAdapters, TemporalAdapter, TemporalRuntimeScenario } from './temporal-conformance.ts';
import { buildTemporalFixture, rebuildTemporalFixture, completeTemporalFixtureInput, fixtureTime, type BuiltTemporalFixture } from './temporal-runtime-fixtures.ts';
import { scriptedTemporalPreparation } from './temporal-scripted.ts';
import { lmeStamp } from './longmemeval.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export function fixtureRefusal(result: Exclude<TemporalResult<unknown>, { status: 'success' }>): StrictTemporalOutcome {
  return { status: result.status, reason: result.reason, claimIds: [], sourceIds: [], value: null };
}
export function fixtureSuccess(value: Json = null, claimIds: string[] = [], sourceIds: string[] = []): StrictTemporalOutcome {
  return { status: 'success', reason: null, claimIds, sourceIds, value };
}
export async function runTemporalFixture(input: TemporalRuntimeScenario, store: TemporalStore, reopen?: () => Promise<TemporalStore>): ReturnType<TemporalAdapter> {
  const s = completeTemporalFixtureInput(input);
  if (s.action === 'date') {
    if (typeof s.input.sourceStamp === 'string') return lmeStamp(s.input.sourceStamp) === null ? fixtureRefusal({ status: 'refused', reason: 'invalid-time', detail: 'source loader refused stamp' }) : fixtureSuccess();
    const a = temporalInstant(s.input.at); if (a.status !== 'success') return fixtureRefusal(a);
    if (s.input.equivalent !== undefined) {
      const b = temporalInstant(s.input.equivalent); return b.status === 'success' ? fixtureSuccess({ equal: a.value === b.value }) : fixtureRefusal(b);
    }
    return fixtureSuccess({ epoch: a.value });
  }
  if (s.action === 'resolve') {
    const anchor = typeof s.input.anchor === 'string' ? temporalStamp(s.input.anchor) : null;
    if (anchor && anchor.status !== 'success') return fixtureRefusal(anchor);
    const result = resolveTemporalWindow(String(s.input.operand), anchor?.value, typeof s.input.zone === 'string' ? { zone: s.input.zone } : {});
    return result.status === 'success' ? fixtureSuccess({ ...result.value }) : fixtureRefusal(result);
  }
  const built = await buildTemporalFixture(s); if (built.status !== 'success') return fixtureRefusal(built);
  const { bundle, sourceNames, claimNames } = built.value;
  if (s.action === 'prepare') {
    const measured = await scriptedTemporalPreparation(bundle, String(s.input.mode), store);
    if (measured.result.status !== 'success') return fixtureRefusal(measured.result);
    if (s.input.mode === 'replay') return fixtureSuccess({ extraCalls: measured.extraCalls, extraWrites: measured.extraWrites, extraActivations: measured.extraActivations });
    if (s.input.mode === 'concurrent') return fixtureSuccess({ calls: measured.calls, activations: measured.activations });
    return fixtureSuccess();
  }
  if (s.action === 'projection' && s.input.mode === 'incomplete') {
    const missing = await store.snapshot(bundle.projection.scope);
    if (missing.status === 'success') return fixtureSuccess();
    const incomplete = await rebuildTemporalFixture(bundle, { complete: false });
    if (incomplete.status !== 'success') return fixtureRefusal(incomplete);
    const result = await store.apply(incomplete.value, { key: 'incomplete', expectedHead: null });
    return result.status === 'success' ? fixtureSuccess() : fixtureRefusal(result);
  }
  if (s.action === 'projection' && s.input.mode === 'profiles') {
    const other = await rebuildTemporalFixture(bundle, { knowledge: { mode: 'strict-as-of', cutoff: '1970-01-01T00:00:01.000Z' } });
    return other.status === 'success' ? fixtureSuccess({ different: other.value.projection.versionId !== bundle.projection.versionId }) : fixtureRefusal(other);
  }
  const apply = await store.apply(bundle, { key: 'initial', expectedHead: null });
  if (apply.status !== 'success') return fixtureRefusal(apply);
  if (s.action === 'projection' && s.input.mode === 'stale') {
    const next = await store.apply(bundle, { key: 'new-head', expectedHead: apply.value.head });
    if (next.status !== 'success') return fixtureRefusal(next);
    const result = await store.snapshot(bundle.projection.scope, apply.value.head);
    return result.status === 'success' ? fixtureSuccess() : fixtureRefusal(result);
  }
  if (s.action === 'projection' && s.input.mode === 'failed-activation') {
    const abort = new AbortController(); abort.abort();
    await store.apply(bundle, { key: 'cancelled', expectedHead: apply.value.head, signal: abort.signal });
    const after = await store.head(bundle.projection.scope);
    return after.status === 'success' ? fixtureSuccess({ unchangedHead: JSON.stringify(after.value) === JSON.stringify(apply.value.head) }) : fixtureRefusal(after);
  }
  const snapshot = await store.snapshot(bundle.projection.scope);
  if (snapshot.status !== 'success') return fixtureRefusal(snapshot);
  if (s.action === 'duplicate') return fixtureSuccess({ occurrences: snapshot.value.sources.length }, [], snapshot.value.sources.map(source => sourceNames[source.id]).sort());
  if (s.action === 'axes') {
    const source = snapshot.value.sources[0], claim = snapshot.value.claims[0];
    const observed = temporalInstant(source.observedAt.at), time = claim.time;
    const valid = time.kind === 'state' ? temporalInstant(time.from) : null;
    if (observed.status !== 'success') return fixtureRefusal(observed);
    return valid?.status === 'success' ? fixtureSuccess({ observed: observed.value, validFrom: valid.value }, [claimNames[claim.id]], [sourceNames[source.id]]) : { unavailable: 'fixture expects an evidenced state' };
  }
  const query: TemporalQuery = { scope: bundle.projection.scope, text: 'Independent temporal query', anchor: null, knowledge: bundle.projection.knowledge,
    subject: s.input.subject === null ? null : typeof s.input.subject === 'string' ? s.input.subject : 'alex',
    series: typeof s.input.series === 'string' ? s.input.series : null, embeddedBy: s.input.wrongEmbedding ? { model: 'wrong', dims: 2 } : bundle.projection.embeddedBy,
    embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: apply.value.head,
    operation: s.action === 'elapsed' ? { kind: 'elapsed', fromSeries: { subject: 'alex', key: 'recovery' }, toSeries: { subject: 'alex', key: 'jog' }, unit: s.input.unit as 'day' | 'week' | 'month' } :
      { kind: s.input.operation === 'as-of' ? 'as-of' : 'at', at: fixtureTime(s.input.at ?? 5) } };
  const answer = await answerTemporal(store, query);
  if (answer.status !== 'success') return fixtureRefusal(answer);
  const selectedClaims = answer.value.recall.claimIds.map(id => claimNames[id]).sort(), selectedSources = answer.value.recall.sourceIds.map(id => sourceNames[id]).sort();
  if (s.action === 'projection' && s.input.mode === 'reopen') {
    if (!reopen) return { unavailable: 'actual backend reopen hook is required' };
    const after = await answerTemporal(await reopen(), query);
    if (after.status !== 'success') return fixtureRefusal(after);
    return fixtureSuccess({ equal: JSON.stringify(after.value) === JSON.stringify(answer.value) }, selectedClaims, selectedSources);
  }
  if (s.action === 'elapsed') {
    // Operand order is semantically meaningful even when canonical source IDs sort differently.
    return fixtureSuccess(answer.value.value, selectedClaims.sort((a, b) => s.claims.findIndex(c => c.id === a) - s.claims.findIndex(c => c.id === b)), selectedSources.sort((a, b) => s.sources.findIndex(c => c.id === a) - s.sources.findIndex(c => c.id === b)));
  }
  return fixtureSuccess(null, selectedClaims, selectedSources);
}
export async function temporalRuntimeAdapters(): Promise<TemporalAdapters> {
  const adapters: TemporalAdapters = { memory: s => { const persistence = createTemporalMemoryPersistence(); return runTemporalFixture(s, createTemporalStoreAdapter(persistence), async () => createTemporalMemoryStore({ state: persistence.exportState() })); } };
  for (const runtime of ['node', 'bun'] as const) {
    const backend = runtime === 'node' ? 'node-sqlite' : 'bun-sqlite';
    const { stdout } = await promisify(execFile)(runtime, [fileURLToPath(new URL('../scripts/temporal-backend.ts', import.meta.url))], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const receipt = JSON.parse(stdout) as { backend: string; rows: { id: string; result: Awaited<ReturnType<TemporalAdapter>> }[] };
    if (receipt.backend !== backend || new Set(receipt.rows.map(r => r.id)).size !== receipt.rows.length) throw new Error('temporal backend receipt identity differs');
    adapters[backend] = async s => {
      const row = receipt.rows.find(r => r.id === s.id);
      if (!row) throw new Error('backend omitted a registered case');
      return row.result;
    };
  }
  return adapters;
}
